## Citation grounding & regulated-claim classification

This is the part of Switchboard's governance layer that stops the medspa agent (Alex) from telling a lead "this treatment guarantees visible slimming" when no approved evidence backs that claim. It is a three-layer pipeline: a deterministic banned-phrase gate (layer 1b-1, covered elsewhere), an LLM **claim-type classifier** (layer 2), and a **substantiation resolver** that grounds each flagged sentence against approved or regulatory sources (layer 3). The transferable idea is **citation grounding for generated text**: never let an LLM's free-text output assert a regulated fact unless that assertion can be traced to a pre-approved, dated source. For a revenue-actions platform operating in regulated verticals (SG/MY medical aesthetics under HSA/MOH/SMC rules), an ungrounded efficacy or safety claim is not a quality bug, it is a compliance liability. The whole subsystem lives under `packages/core/src/governance/classifier/` and is wired into the agent reply path by a single skill hook.

### Claim Type Enum (the 9 categories)

**Concept.** Before you can ground claims, you need a vocabulary of _what kinds of claims exist_. A closed enum turns an open-ended "is this risky?" question into a finite classification problem, and each category can then carry its own policy.

**In Switchboard.** The enum is a Zod schema, the single source of truth shared between the LLM tool schema and the runtime:

```ts
// packages/schemas/src/claim-classifier.ts:12
export const ClaimTypeSchema = z.enum([
  "efficacy",
  "safety-claim",
  "superiority",
  "urgency",
  "testimonial",
  "medical-advice",
  "diagnosis",
  "credentials",
  "none",
]);
```

The same nine strings are described in plain language in the classifier system prompt (`packages/core/src/governance/classifier/prompt.ts:16-32`) and re-listed as a raw array used to compute the prompt hash. The kebab-case values (`safety-claim`, `medical-advice`) are deliberate: the comment at `claim-classifier.ts:7-11` notes these strings are _LLM-facing_, so the enum and the prompt must change in lockstep.

**Runtime path.** Each category routes differently in the hook: `efficacy`/`safety-claim`/`superiority`/`urgency` are `REWRITEABLE`, `testimonial`/`medical-advice`/`diagnosis` are `ESCALATE_ONLY`, `credentials` is checked against regulatory sources only, and `none` always passes (`packages/core/src/skill-runtime/hooks/claim-classifier.ts:55-61`).

**Gotcha.** Three artifacts encode these nine values (the Zod enum, the prompt prose, the hash array in `prompt.ts:45-55`) plus the tool's `input_schema.enum` in `anthropic-classifier.ts:42-52`. Adding a tenth claim type means editing all four and bumping `CLASSIFIER_PROMPT_VERSION`, or the eval baseline silently diverges.

### Claim Type Classification (Layer 2, Haiku 4.5)

**Concept.** Use a small, fast LLM as a _semantic classifier_ with **structured tool output** (constrained JSON) rather than free-text parsing. Tool-use with a strict schema means the model cannot return prose, only a typed object, which eliminates a whole class of parse failures.

**In Switchboard.** `createAnthropicClaimClassifier` calls `claude-haiku-4-5-20251001` (a real, current Anthropic model id), forcing the `classify_claim` tool:

```ts
// packages/core/src/governance/classifier/anthropic-classifier.ts:69-90
const response = await client.messages.create(
  {
    model,
    max_tokens: 256,
    system: [
      { type: "text", text: CLASSIFIER_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    ],
    tools: [{ ...CLASSIFIER_TOOL, cache_control: { type: "ephemeral" } }],
    tool_choice: { type: "tool", name: "classify_claim" },
    messages: [{ role: "user", content: sentence }],
  },
  { signal },
);
```

Two production details worth internalizing. First, **prompt caching**: both the system prompt and the tool definition carry `cache_control: { type: "ephemeral" }`, so Anthropic caches that prefix and only the per-sentence `messages` content is fresh input. The code reads `usage.cache_read_input_tokens` and feeds `recordLlmCacheEffectiveness` (`anthropic-classifier.ts:99-103`) so a silent cache bust (for example a prompt edit) surfaces in telemetry. Second, the tool is `strict: true` with `additionalProperties: false` and only `claimType` + `confidence` (`anthropic-classifier.ts:32-58`); note there are deliberately **no min/max** on `confidence` because strict tool schemas reject those, so the Zod parse (`ClassifierSentenceResultSchema`, with `.min(0).max(1)`) does the range check after the fact at `anthropic-classifier.ts:117`.

**Parallel dispatch under a budget.** `runClassifier` fans every sentence out concurrently under one `AbortController` and a per-turn `latencyBudgetMs` (default 800ms):

```ts
// packages/core/src/governance/classifier/run-classifier.ts:34-44
const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), input.latencyBudgetMs);
const settled = await Promise.allSettled(
  input.sentences.map((s) =>
    input.classifier.classify({ sentence: s, model, signal: ctrl.signal }),
  ),
);
```

Budget exhaustion yields `{ status: "timeout" }` and an API/parse failure yields `{ status: "error" }`, _not_ a silent allow (`run-classifier.ts:51-56`). Outcome order maps 1:1 to input order, which the hook relies on.

**Gotcha.** Timeouts and errors **escalate**, they do not fail open (`claim-classifier.ts:215-242`). The classifier failing is treated as "we could not verify this claim," which is the conservative direction.

### Confidence Threshold Gating

**Concept.** A probabilistic classifier should not act on low-confidence guesses. A confidence floor converts "model thinks maybe efficacy at 0.4" into "treat as a non-claim," trading recall for precision to avoid over-flagging.

**In Switchboard.** The floor is the first gate inside `decideAction`, applied uniformly to every non-`none` type:

```ts
// packages/core/src/skill-runtime/hooks/claim-classifier.ts:255-261
if (result.claimType === "none") return { kind: "allow" };
// T1.1 confidence floor: a sub-threshold classification is not trusted to act.
if (result.confidence < confidenceThreshold) return { kind: "allow" };
```

The default is `0.7`, defined in the config schema as a _principled default, not an operator UI knob_ (`packages/schemas/src/governance-config.ts:46`). The comment there ties it directly to "the off->enforce flip; root of over-flag #673."

**Gotcha.** The floor only gates _acting on a successful classification_. Timeout/error outcomes carry no confidence and are handled _before_ this check, so they still escalate. Read `decideAction` top-to-bottom: status branches first, then `none`, then confidence, then per-type dispatch.

### Substantiation Resolver (Layer 3) and Paraphrase Matching

**Concept.** Once a sentence is classified as a regulated claim, **ground it**: search a tiered set of approved sources for evidence. The dispatch table encodes policy ("efficacy claims may only be backed by an operator-approved claim," "credentials may only be backed by a public regulatory source").

**In Switchboard.** The tier table is a static `Record<ClaimType, ...>`:

```ts
// packages/core/src/governance/classifier/substantiation-resolver.ts:16-26
efficacy: ["approved_compliance_claim"],
"safety-claim": ["approved_compliance_claim", "regulatory_public_source"],
superiority: ["approved_compliance_claim"],
credentials: ["regulatory_public_source"],
testimonial: [], "medical-advice": [], diagnosis: [], none: [],
```

`createSubstantiationResolver().resolve()` (`substantiation-resolver.ts:194-244`) walks the tiers in order: for `approved_compliance_claim` it calls `matchClaim`, for `regulatory_public_source` it calls `matchRegulatory`. An empty tier list returns `{ status: "missing" }` immediately (this is how `testimonial`/`medical-advice`/`diagnosis` become "always escalate"). A matched source returns `matched`, an approved claim past its freshness window returns `stale` (`isStale`: `validUntil < now` OR `reviewedAt` older than 180 days, `substantiation-resolver.ts:116-120`).

**Paraphrase matching** is the careful part. Exact-substring matching is too brittle for natural language, but fuzzy distance matching risks false positives, and the failure mode of a false positive here is _an unsubstantiated claim allowed through_. The solution is conservative containment:

```ts
// packages/core/src/governance/classifier/substantiation-resolver.ts:108-114
function paraphraseMatches(sentenceLower: string, claimLower: string): boolean {
  if (NEGATION_RE.test(sentenceLower)) return false;
  const claimTokens = significantTokens(claimLower);
  if (claimTokens.length < 2) return false;
  const sentenceTokens = new Set(significantTokens(sentenceLower));
  return claimTokens.every((t) => sentenceTokens.has(t)); // ALL tokens present, order-free
}
```

Every significant claim token (length >= 2, not a stopword) must be present in the sentence, order does not matter, and the sentence must not be negated. Numbers stay significant so "50%" never substantiates "80%". The known bound (documented in the long comment at `:92-107`): a 2-token claim can be satisfied by any sentence containing both words, but that is the _under-escalation_ direction and only runs against the org's own approved list after the classifier already flagged the sentence.

**Gotcha.** A thrown `approvedClaimStore.list` is caught and treated as a missing tier (`substantiation-resolver.ts:224-227`): emit-integrity beats observability, a DB hiccup must not crash the booking turn, it just means "not substantiated."

### Approved Compliance Claims Store and Regulatory Public Sources

**Concept.** Two complementary evidence stores: a **per-tenant operator-approved store** (dynamic, dated, reviewer-attributed) and a **static curated reference set** (jurisdiction-wide public facts). The first lets each clinic pre-approve its own marketing phrasings, the second encodes regulator-published facts everyone can cite.

**In Switchboard.** `ApprovedComplianceClaimRecord` carries the audit metadata that makes a claim citable: `reviewedBy`, `reviewedAt`, `validUntil`, scoped by `(deploymentId, jurisdiction, claimType)` (`packages/core/src/governance/classifier/approved-compliance-claim-store/types.ts:9-21`). The Prisma store is a narrow `list()` filtered by that triple, newest first:

```ts
// packages/db/src/prisma-approved-compliance-claim-store.ts:44-51
const rows = await prisma.approvedComplianceClaim.findMany({
  where: { deploymentId, jurisdiction, claimType },
  orderBy: [{ reviewedAt: "desc" }],
});
```

There is no authoring UI in this phase, claims arrive via seed/admin script. The **regulatory sources** are curated TS arrays with no live fetch: each `RegulatoryPublicSourceEntry` has `patterns` (strings or `RegExp`), an `authority` (HSA/MOH/SMC), and `sources` (URLs for the audit trail) (`regulatory-sources/types.ts:7-15`). For example `Thermage FLX` -> HSA device listing, `MOH-licensed` -> Healthcare Services Act (`regulatory-sources/sg.ts:7-42`). `loadRegulatoryPublicSources` normalizes regex flags, dedupes ids, freezes, and caches per jurisdiction (`regulatory-sources/loader.ts:26-35`).

**Gotcha.** The SG entries themselves carry compliance nuance in `notes`: `MOH-licensed` matches _generic_ licence language, but "this _named_ clinic is licensed" must still escalate (`sg.ts:40-42`). The pattern match grounds the generic phrasing, not the specific entity.

### Substantiation Cache (in-memory LRU)

**Concept.** A bounded LRU avoids re-running DB reads and regex sweeps for repeated sentences in chatty conversations. The subtlety is _what you are allowed to cache_: cache only positive, stable results so freshness changes do not require invalidation.

**In Switchboard.** `createInMemoryLRU` uses JS `Map` insertion order for LRU (delete+reinsert on `get` promotes to most-recently-used, evict the first key on overflow), default 5000 entries (`substantiation-cache.ts:46-72`). The key is `deploymentId|jurisdiction|claimType|sentenceHash`, so a match cached for tenant A is structurally impossible to serve to tenant B. Crucially, only `matched` resolutions are cached: in the resolver, `stale` and `missing` are returned without a `cache.set` (`substantiation-resolver.ts:230, 237`). That is why a newly-approved claim takes effect on the next lookup with no invalidation step.

**Gotcha.** `sentenceHash` is `sha256(lowercase(sentence))`, the hash of the _model output_, not of the approved `claimText` it matched (the comment at `substantiation-cache.ts:6-12` calls this out). Caching a `stale` result would be a latent bug: a claim re-approved tomorrow would still read stale from cache. The code avoids it by never caching non-matches.

### Rewrite Template Registry

**Concept.** When a claim cannot be grounded, you have two repair strategies: _rewrite_ it into compliant phrasing, or _escalate_ to a human. Deterministic templates (no second LLM call) make rewrites auditable and fast.

**In Switchboard.** `RewriteTemplateEntry` is keyed by `(jurisdiction, claimType)` over the four rewriteable types (`rewrite-templates/types.ts:3-14`). The SG efficacy template is the canonical example:

```ts
// packages/core/src/governance/classifier/rewrite-templates/sg.ts:5-11
{ id: "sg_efficacy_results_vary", jurisdiction: "SG", claimType: "efficacy",
  template: "Results vary between individuals, the doctor will go through what's realistic for you during consultation.",
  notes: "HSA / SMC aesthetic-practice guideline, avoids implied outcome guarantee." },
```

The hook looks up the template by claim type and, if found, splices it into the response (`claim-classifier.ts:300-324`). If no template exists for a `(claimType, jurisdiction)` pair, it escalates rather than silently allowing (`:304-313`).

**Gotcha.** Replacement is `response.replace(originalSentence, replacement)` (`claim-classifier.ts:462`), first-occurrence string replace. It depends on the exact sentence string the splitter produced still being present verbatim in `result.response`.

### ClaimClassifierHook, Governance Config Mode (off/observe/enforce), and the Verdict Audit Trail

**Concept.** Wire all of the above into the agent's reply path as a **post-generation governance hook** with a staged-rollout switch. `off`/`observe`/`enforce` is the standard safe-rollout ladder: ship dark, then telemetry-only, then enforcing.

**In Switchboard.** `ClaimClassifierHook.afterSkill` runs after the deterministic gate in the skill-runtime hook chain. It resolves per-deployment config, returns early on `mode === "off"`, and forks on mode:

- **observe** (`claim-classifier.ts:101-121`): runs the full pipeline _fire-and-forget on a detached shallow clone_ of the result, so the lead-visible reply pays zero added latency and a bug in the apply helpers cannot mutate the live `response` string. Verdicts are written with `action: "allow"` and `auditLevel: "warning"`.
- **enforce** (`:122-131`): awaits the pipeline, splices rewrites and replaces escalated replies with a handoff message, then sets `conversationStatus` to `human_override` (`applyEscalate`, `:419-420`).

There is also a **fail-closed** path: if the config resolver errors and the posture cache last saw `enforce`, the hook blocks the whole turn with a handoff (`failClosed`, `:336-371`).

Every decision writes a `GovernanceVerdict` (`claim-classifier.ts:390-404` for escalate, `:436-450` for rewrite). The record stamps `sourceGuard: "claim_classifier"`, `originalText`, `emittedText`, and a `details` blob carrying `promptVersion` (`claim-classifier@1.0.0`), `promptHash`, `schemaVersion`, `model`, `claimType`, `confidence`, and the matched source id/type/text. The reason codes are an enum with classifier-specific values: `unsupported_claim_rewritten`, `unsupported_claim_escalated`, `claim_substantiation_stale`, `classifier_timeout`, `classifier_error` (`packages/schemas/src/governance-verdict.ts:33-37`). This is what lets an auditor answer "why was this sentence flagged last Thursday, under which prompt version, at what confidence."

**Runtime path end-to-end.** Inbound lead message -> skill executor generates Alex's reply -> `afterSkill` hook fires -> `splitSentences(result.response)` -> `runClassifier` (parallel Haiku calls under the 800ms budget) -> per sentence `decideAction` (status branch, then `none`, then confidence floor, then per-type dispatch, then `substantiationResolver.resolve`) -> if any escalate, build handoff + flip conversation status; else if any rewrite, splice templates -> save one `GovernanceVerdict` per acted sentence.

**Gotcha / study next.** Escalate takes precedence over rewrite for the whole turn (`classifyAndApply`, `:176-201`): one escalate-worthy sentence converts the entire reply into a handoff, even if other sentences would only have been rewritten. And the offline **eval harness** (`evals/claim-classifier/run-eval.ts`) is the safety net for prompt drift: it runs fixtures through Haiku and Sonnet, scores per-type accuracy, and _gates on prompt-hash stability_ (a changed hash requires `--write-baseline`). It is a soft CI gate (warns, does not block), and it loads fixtures from `evals/claim-classifier/fixtures` rather than importing `GOLDEN_SET` directly, so keep both fixture sets in mind when editing claim semantics.
