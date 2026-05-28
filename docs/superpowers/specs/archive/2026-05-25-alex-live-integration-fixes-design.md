# Alex Live-Integration Fixes — Design (post-merge follow-up)

**Date:** 2026-05-25
**Branch (this spec):** `docs/alex-live-integration-fixes` (based on `origin/main`)
**Author:** Claude Opus 4.7 (1M context), at user request
**Status:** Implementation design (spec). Awaiting user review → then writing-plans (two plans, one per PR).
**Parent:** Track A follow-up to the merged PR-1 work — `docs/superpowers/specs/2026-05-24-alex-sales-skill-pack-and-eval-design.md`. Fixes two VERIFIED integration gaps in MERGED code (#664 A1 skill pack, #668 partial tool-name fix, #674 A0 eval).

**Locked summary (the one-paragraph contract):**

> Two independent fixes restore Alex's live conversational path, which is currently broken in two ways the merged work did not catch. **Critical 1 (keystone):** the live execution mode (`SkillMode`) never resolves curated knowledge context, so the seeded medspa skill pack (`PLAYBOOK_CONTEXT` / `POLICY_CONTEXT` / `QUALIFICATION_CONTEXT` / `CLAIM_BOUNDARIES`) interpolates to empty strings in every live conversation — it reaches batch jobs only. We wire `ContextResolverImpl` into `SkillMode` as a minimal mirror of the batch handler, resolving only knowledge-entry context (the builder already owns `BUSINESS_FACTS`), **failing open** so a provisioning gap degrades to today's empty behavior instead of 500-ing a live lead, with presence enforced loudly at provisioning/eval-preflight. **Critical 2:** the Anthropic adapter re-sends decoded dotted tool names (e.g. `calendar-book.booking.create`) in multi-turn message history, violating the API's tool-name pattern, so Alex 400s the moment he calls a tool and continues; we re-encode tool-use names in the adapter's outgoing message mapping and add a loud validation guard. Three coupled lesser findings fold in. No new tools, ingress paths, routing, or `Agent*` core types.

---

## 0. Operating context (read first)

- **Local `main` has diverged from `origin/main`.** Local `main` (`98d5ddfc`) carries one unpushed automation commit (daily superpowers auto-archive); `origin/main` (`b97a218d`) has #674 (A0 eval) + #675 (audit plan) that are not local. **A0's `evals/alex-conversation/` exists only on `origin/main`.** This spec and the two implementation branches are based on `origin/main` so they include A0. The local automation commit is left untouched for the user to reconcile.
- **Doctrine:** this spec and the two plans land on `main` via focused PRs; each implementation branch is its own worktree consuming the spec. Mutations still flow through `PlatformIngress`; `WorkTrace` stays canonical; no `Agent*` types added to core; tools remain audited/idempotent.

---

## 1. Goal & non-goals

**Goal.** Make Alex actually work in live conversations: (1) his seeded skill pack must reach the live prompt, and (2) he must be able to call a tool and continue the conversation without a 400.

**Non-goals (scope fence).** No new tools or tool authority. No model-routing changes. No proactive/outbound flow. No learning-loop code. No prompt-caching work (separately tracked). No change to the claim classifier (mid-bake). The A0 live baseline re-lock is out of scope (blocked on Anthropic credits, #672). The prod claim-classifier over-flag is out of scope (#673).

---

## 2. Critical 1 — Alex's skill pack is inert in live conversations (keystone)

### 2.1 The gap (verified)

- Live conversations run through `SkillMode.execute` → `SkillMode.resolveParameters` (`packages/core/src/platform/modes/skill-mode.ts:91-120`), which runs **only the builder registry** and **never calls a context resolver**.
- The executor interpolates `params.parameters` into the skill body (`packages/core/src/skill-runtime/skill-executor.ts:174`). `template-engine.ts:26-31` returns `""` for any `{{VAR}}` that is neither provided nor a required declared _parameter_.
- `PLAYBOOK_CONTEXT`, `POLICY_CONTEXT`, `QUALIFICATION_CONTEXT`, `CLAIM_BOUNDARIES` are declared under `context:` in `skills/alex/SKILL.md:54-71` (not under `parameters:`), so they have no declaration in the interpolation map and render **empty** live (body slots at SKILL.md:149, 166, 181, 258).
- The batch path does resolve+merge (`packages/core/src/skill-runtime/batch-skill-handler.ts:71-85`): `contextResolver.resolve(orgId, skill.context)` → `{ ...parameters, ...contextVariables }`. `SkillMode` does not.
- `BUSINESS_FACTS` is **not** affected: the builder sets it directly (`packages/core/src/skill-runtime/builders/alex.ts:91-97, 124` via `renderBusinessFacts`). The builder sets nothing else among the four context slots.

**Net:** the seeded medspa playbook reaches batch jobs, not live chats. A1's value is unrealized where it matters.

### 2.2 Decisions (locked with user)

- **Fail posture: fail-open + `required:false`.** The four knowledge slots are advisory _steering_; the claim classifier is the hard safety gate. We make resolution non-fatal on the live path.
- **Caching: none.** Resolve once per inbound message (not per LLM turn — the system prompt is built once at `skill-executor.ts:174` and reused across the loop). The cost is ~1 indexed `findActive` query, dwarfed by the model call; always-fresh so operator knowledge edits take effect next message. Mirrors batch's resolve-per-execute.
- **Scope: knowledge-entry context only.** The resolver excludes `business-facts` (the builder owns `BUSINESS_FACTS`).
- **No feature flag.** Blast radius is Alex-only today (§2.4); fail-open + the provisioning guarantee bound the risk.

### 2.3 The change

**(a) `packages/core/src/platform/modes/skill-mode.ts`** — add an optional resolver dependency, typed exactly like the batch handler:

```ts
// in SkillModeConfig
contextResolver?: { resolve: ContextResolverImpl["resolve"] };
```

In `execute`, after `resolveParameters`, resolve and merge before calling the executor:

```ts
const { parameters, injectedPatternIds } = await this.resolveParameters(workUnit, skill);
const contextVariables = await this.resolveContextVariables(workUnit.organizationId, skill);
const mergedParameters = { ...parameters, ...contextVariables };
// → executor.execute({ ..., parameters: mergedParameters, ... })
```

New private method:

```ts
private async resolveContextVariables(
  orgId: string,
  skill: SkillDefinition,
): Promise<Record<string, string>> {
  if (!this.config.contextResolver) return {}; // backward-compatible no-op
  // The builder owns BUSINESS_FACTS — never resolve it here (avoids double-source
  // and the required-business-facts throw).
  const knowledgeReqs = skill.context.filter((r) => r.kind !== "business-facts");
  if (knowledgeReqs.length === 0) return {};
  try {
    const { variables } = await this.config.contextResolver.resolve(orgId, knowledgeReqs);
    return variables;
  } catch (err) {
    // FAIL-OPEN: a live conversation must never 500 on a context-resolution miss.
    console.warn(
      `[SkillMode] context resolution failed for ${skill.slug}/${orgId} (continuing with empty context): ${err instanceof Error ? err.message : String(err)}`,
    );
    return {};
  }
}
```

The `kind !== "business-facts"` filter is **load-bearing** and must be unit-tested (§2.6): without it, an un-filtered call against a resolver with no `BusinessFactsStore` would throw `ContextResolutionError` on the `required:true` business-facts requirement and break every live conversation.

**(b) `skills/alex/SKILL.md`** — set `required: false` on the three knowledge requirements currently relying on the loader default of `true` (`packages/schemas/src/knowledge.ts:48`, `skill-loader.ts:49`): `playbook/objection-handling` → `PLAYBOOK_CONTEXT`, `policy/messaging-rules` → `POLICY_CONTEXT`, `playbook/qualification-framework` → `QUALIFICATION_CONTEXT`. `claim-boundaries` is already `required:false`. `business-facts/operator-approved` stays `required:true` (builder-owned; filtered out of the resolver call regardless). Add a comment stating the posture explicitly so `required:false` is not misread later as "not important": **advisory at runtime, required by provisioning/eval preflight** — the claim classifier is the runtime hard gate, and presence is guaranteed loudly at provisioning/preflight rather than by failing live traffic.

**(c) `apps/api/src/bootstrap/skill-mode.ts`** — construct the resolver and wire it in. This is the **first** live `ContextResolverImpl` construction in the app (none exists today), so it is net-new, not threading an existing instance:

```ts
// PrismaKnowledgeEntryStore from @switchboard/db; ContextResolverImpl from
// @switchboard/core/skill-runtime (NOT the core root barrel).
const knowledgeEntryStore = new PrismaKnowledgeEntryStore(prismaClient);
const contextResolver = new ContextResolverImpl(knowledgeEntryStore); // NO businessFactsStore
// ... in the SkillMode({ ... }) config:
contextResolver,
```

`PrismaKnowledgeEntryStore.findActive` (`packages/db/src/stores/prisma-knowledge-entry-store.ts:29`) structurally satisfies `KnowledgeEntryStoreForResolver`. Deliberately **no** `BusinessFactsStore` is passed — the builder owns `BUSINESS_FACTS` and the resolve call filters business-facts out. Because this is the first live `ContextResolverImpl` construction, extend the existing startup gate-deps assertion (`bootstrap/skill-mode.ts:594-616`) to verify the resolver actually reached `SkillMode`, so a wiring / package-boundary mistake fails fast at boot rather than silently degrading every conversation to empty context.

### 2.4 Blast radius & why it is bounded

- `SkillMode` is the **only** live execution mode that runs a `SkillExecutor` (cartridge / workflow / operator-mutation modes do not). So only `SkillMode` needs the fix.
- `apps/api/src/bootstrap/skill-mode.ts:113` registers `skillsBySlug` with **Alex only** — Alex is the sole skill running through `SkillMode` today. "Flips on for every conversation skill" is theoretical (N=1).
- `sales-pipeline.md:51-67` also declares a `context:` block with the same three `(kind, scope)` pairs, but: (i) this change edits only Alex's frontmatter (each skill is parsed independently — no shared contract), and (ii) the batch path is currently **unwired** in production (`BatchSkillHandler` / `createBatchExecutorFunction` are never constructed in any app). So no other skill's behavior changes. Latent note: if sales-pipeline's batch path is ever wired, it keeps `required:true` and would throw on missing knowledge — divergent from Alex's new posture; revisit then.
- The change is otherwise backward-compatible: existing `new SkillMode({...})` call sites (one in bootstrap, several in tests) pass **no** `contextResolver`, so `resolveContextVariables` returns `{}` and behavior is unchanged. Existing `skill-mode.test.ts` assertions that compare executor params to the bare builder output stay green.

### 2.5 Failure handling & the provisioning guarantee (fail-open + fail-loud)

- **Runtime (live): fail-open.** With `required:false` on the knowledge reqs and business-facts filtered out, `ContextResolverImpl.resolve` cannot raise `ContextResolutionError` for Alex; a missing scope leaves the var unset → renders `""` (today's behavior). The `try/catch` then guards only genuine infra errors (e.g. DB failure in `findActive`) — warn and proceed.
- **Provisioning/eval (loud guarantee).** Presence is enforced where it is safe to fail loudly, not on live traffic: the A0 eval preflight (§4.2) refuses to run when the skill-pack content is empty. (`business-facts` `required:true` remains unenforced on the live path — the builder renders `""` when facts are absent; this is pre-existing behavior and the fix does **not** claim to restore batch-parity enforcement there.)
- **Note:** the four knowledge slots are now subject to the resolver's `maxCharsPerRequirement: 4000` cap (`context-resolver.ts:8-10, 211`). With a single active row per scope (the current seed), the first entry is always included in full (`context-resolver.ts:221-224`) — so nothing truncates today. The cap only bites if a scope ever holds multiple active rows.

### 2.6 Tests (Critical 1)

- **Headline regression (live-path proof):** with a stub `contextResolver` returning populated slots, assert the executor receives `parameters` containing them; with no resolver (or one returning empty), it does not — flips empty→populated at the live `SkillMode` seam.
- **Fail-open:** a `contextResolver` whose `resolve` throws → `execute` still calls the executor with empty context + a warning (the live conversation survives).
- **Business-facts excluded (load-bearing filter):** assert `resolve` is invoked with requirements filtered to exclude `kind === "business-facts"`.
- **Backward-compat:** existing `skill-mode.test.ts` cases (no resolver) pass unchanged.
- **End-to-end interpolation** (mirror `__tests__/alex-claim-boundaries-slot.test.ts`): real `ContextResolverImpl` + stub knowledge store with seeded rows + real Alex body → the assembled system prompt contains the objection-handling content.

---

## 3. Critical 2 — multi-turn tool-name 400 (adapter)

### 3.1 The gap (verified)

- `packages/core/src/skill-runtime/adapters/anthropic-tool-adapter.ts:68-71` maps `params.messages` to Anthropic messages **verbatim** (a blind `m.content as ...` cast). Only tool _definitions_ are encoded (`:76` `encodeToolName`) and only _incoming_ tool-use blocks are decoded (`:103` `decodeToolName`).
- The executor pushes the **decoded** assistant content (dotted tool-use names) into history (`skill-executor.ts:333`) and recovers the tool id by `name.split(".")` (`:349`). The `messages` array is reused across the `while` loop and re-sent each turn.
- So on turn ≥2 the adapter re-sends a dotted name (e.g. `calendar-book.booking.create`) in the message history, violating Anthropic's `^[a-zA-Z0-9_-]{1,128}$` → **400**. Alex 400s the moment he calls a tool and continues (the entire booking flow).

Scope is limited to this one adapter: the legacy `tool-calling-adapter.ts` is now a re-export shim (fixed transitively); the classifier and text-only `agent-runtime` adapters are single-turn / tool-less; no other live multi-turn tool loop exists.

### 3.2 The change

In `chatWithTools`, replace the verbatim message map with a walk over the provider-neutral content union (`string | LLMContentBlock[] | LLMToolResultBlock[]`, `llm-types.ts:28`):

- `string` content → passthrough.
- array content → map each block: `type === "tool_use"` → re-encode `name` via `encodeToolName`; `text` and `tool_result` (which carry no `name`, only `tool_use_id`) → passthrough.

Use a real type guard (not a blind cast) so a future block type can't silently bypass encoding again — mirroring the response-side `LLMAdapterShapeMismatchError` discipline at `:107`.

**Loud-failure guard.** Add `assertValidAnthropicToolName(name)` that throws on `!/^[a-zA-Z0-9_-]{1,128}$/.test(name)`, called **inside `encodeToolName` on the ENCODED return value** (after `.`→`__`) — never on the dotted input, or every legitimate name throws. This makes both encode sites (definitions at `:76`, history in the new walk) validate, turning future naming drift into a loud local/test throw instead of a live 400.

Minor cleanup: the now-stale comment at `:12-15` (refers to a literal no longer in the referenced file) — one line. Do **not** touch the unrelated stale literal in `agent-runtime/anthropic-adapter.ts` (out of scope).

### 3.3 Tests (Critical 2)

- **The gating regression (the test whose absence let #668 ship incomplete):** drive `chatWithTools` (real `AnthropicToolAdapter`, mocked `Anthropic` client) with a `messages` array that already contains an assistant `tool_use` block with a **dotted** name (turn-2 state); assert the mocked `client.messages.create` received the **encoded** (`__`) name in the message history and no `.`.
- **Unit:** `assertValidAnthropicToolName` rejects an illegal name; `encodeToolName` validates its encoded output.
- Existing encode/decode unit + single-turn outgoing + incoming decode tests stay green.

### 3.4 Blast radius

Adapter-only; no change to single-turn or non-tool conversations. The deprecated `AnthropicToolCallingAdapter` alias resolves to the same class and is fixed transitively.

---

## 4. Folded-in lesser findings

### 4.1 A0 model pin Haiku→Sonnet-4.6 (split the dual constant)

Live Alex runs on **Sonnet-4.6**: the live executor is built with no router (`bootstrap/skill-mode.ts:516-524`) → `resolveProfile` returns undefined (`skill-executor.ts:146`) → adapter default `DEFAULT_MODEL = "claude-sonnet-4-6"` (`anthropic-tool-adapter.ts:16, 83`). The A0 eval runs Alex on Haiku — a mismatch.

The eval aliases **one** constant for two purposes (`run-eval.ts:23` `const HAIKU`, comment wrongly says "Alex production model"): used at `:205` for the **Alex run** (wrong → must be Sonnet-4.6) and at `:243` `classifierModel: HAIKU` for the **claim-classifier checker** (correct → stays Haiku, matching the production classifier). **Split into two named constants** — `ALEX_MODEL = "claude-sonnet-4-6"` (`:205`) and `CLASSIFIER_MODEL = "claude-haiku-4-5-20251001"` (`:243`) — and fix the comment. Naively editing the value would flip the classifier too. The judge `SONNET` (`:26`, used `:264`) is unaffected. No `baseline.json` is committed yet, so the model flip invalidates nothing now; the eventual live baseline re-lock (#672) must be on Sonnet.

### 4.2 Stub-aware skill-pack preflight assertion (mechanism note)

The user's choice was "wire `assertAlexSkillPackSeeded` → A0 preflight." That prisma function (`packages/db/src/seed/seed-alex-skill-pack.ts:93`, queries `prisma.knowledgeEntry`) **cannot** be used directly: the A0 eval is DB-free by design — context comes from `createStubContextStore` reading the canonical medspa markdown (`run-conversation.ts:187-189`), no Prisma client.

Implement the **intent** with a **stub-aware** assertion: before the fixture loop in `run-eval.ts` (or a new helper in `eval-preflight.ts`), construct the stub context store and assert it returns non-empty content for the skill-pack scopes, reusing the exported `ALEX_SKILL_PACK_SCOPES` (from `@switchboard/db`) to avoid the stub-vs-seed scope-list drift. This catches the real A0 failure mode (a skill-pack `.md` deleted/emptied → Alex graded with no guidance). The failure message must be **loud and specific** — name the missing `(kind, scope)`, the markdown file it expected, and state that Alex would otherwise run without the medspa playbook — because the live path's fail-open `console.warn` (§2.5) is deliberately quiet, so this preflight (and the deferred provisioning assertion) is where a provisioning regression must be impossible to miss. The prisma `assertAlexSkillPackSeeded` **remains exported-but-unwired** until the _deferred_ prod-provisioning slice — so the original "unwired" finding only fully closes when that is pulled forward.

(Faithfulness note: the eval's `resolveParameters` resolves the _full_ `skill.context` including business-facts via a stub store (`run-conversation.ts:188`), whereas the live path sources `BUSINESS_FACTS` from the builder and filters business-facts out of the resolver. Both yield a populated `BUSINESS_FACTS`; the four knowledge slots — what Critical 1 fixes — populate identically. The sourcing difference is immaterial to what the eval grades. **A0 must not be oversold as full production parity:** it uses stub context (and stub business-facts), the live path uses the builder + real resolver, and no live baseline is locked until #672 resumes. A0 proves the skill pack reaches the prompt and grades selling behavior — not byte-parity with production.)

### 4.3 Provision happy-path test

`apps/api/src/routes/organizations.ts:89-93` calls `seedAlexSkillPack` in a best-effort `try/catch` that `console.warn`s on failure. No api test asserts the seed actually ran on the happy path — two tests define a `knowledgeEntry.upsert` mock only to prevent throws (`api-organizations.test.ts:38-39`, `provision-end-to-end.test.ts:152-153`) but never assert on it, so the swallowed failure is invisible. Add to the Decision-10 happy-path test (`api-organizations.test.ts:135`): `expect(mockPrisma.knowledgeEntry.upsert).toHaveBeenCalledTimes(3)` (optionally pinning the scopes), separate from the resilience behavior.

### Deferred / out of scope (noted, not done here)

- **`assertAlexSkillPackSeeded` → prod provisioning** (and the related question of whether a seed failure should set a provisioning status rather than `console.warn` silently) — deferred per user; the prisma guard's natural home.
- **A0 baseline content-hash / rubric drift gate** — `baseline.json` stores `skillContentHash` + `judgeRubricVersion` (`run-eval.ts:347-348`) but `compareAgainstBaseline` never checks them. Pure logic + a unit test, no credits needed, but only matters once a real baseline exists → deferred to the #672 resume.
- **#673** prod claim-classifier conversational over-flag; **#672** A0 live baseline re-lock (Anthropic credits). Both out of scope.
- Prompt caching (agent-patterns catalog): Critical 1 enlarges the live system prompt, which strengthens the case for the separately-tracked caching work — not in these PRs.

---

## 5. PR shape & sequencing (2 PRs)

- **PR-1 — Critical 2 (adapter):** `anthropic-tool-adapter.ts` outgoing-history re-encode + `assertValidAnthropicToolName` + the multi-turn round-trip regression test + comment cleanup. Small, independent, adapter-only; ships first and unblocks tool use.
- **PR-2 — Critical 1 (keystone) + coupled fold-ins:** `SkillMode` resolve+merge+fail-open; `SKILL.md` `required:false`; bootstrap resolver construction; the Critical-1 test suite; **plus** §4.1 (A0 Sonnet pin), §4.2 (stub-aware preflight), §4.3 (provision happy-path test). PR-2 is what makes the A0 eval faithful to live.

The two PRs touch disjoint files and can proceed in either order / parallel worktrees. Each implementation branch is created from an up-to-date `origin/main` (with A0), per doctrine.

---

## 6. Doctrine alignment

- **Layering:** `ContextResolverImpl` already lives in core (batch handler imports its type) — adding an optional field to `SkillModeConfig` introduces no new cross-layer import; core still does not import db. Constructing `PrismaKnowledgeEntryStore` (db) + `ContextResolverImpl` (core) in `apps/api` (layer 5) is legal and already-precedented (`routes/knowledge-entries.ts`). Imports: `ContextResolverImpl` from `@switchboard/core/skill-runtime` (subpath), `PrismaKnowledgeEntryStore` from `@switchboard/db`.
- **Invariants:** no new ingress/tool/runtime-state surface; the resolver only reads; no `Agent*` type added to core; mutations still via `PlatformIngress`; `WorkTrace` unchanged. Alex's intent `alex.run` maps only to `SkillMode` (mode names are unique; nothing routes it elsewhere).

---

## 7. Verification summary (independent fan-out)

Four read-only subagents confirmed, with file:line evidence: both gaps are real; `SkillMode` is the only live skill path; the fail-open posture makes `ContextResolutionError` unreachable for Alex; the merge is collision-free; backward-compat holds; doctrine/layering is clean; the Critical-2 fix scope is one file. They surfaced the refinements now folded into this spec: the `encodeToolName`-validates-encoded-output ordering, the type-guarded content walk, the dual-constant split for the A0 pin, the stub-aware FOLD-IN 2 mechanism, and the load-bearing business-facts filter. The premise "only Alex has a context block" was corrected (sales-pipeline also does, but its batch path is unwired → no impact).

---

## 8. Open implementation details (resolve in the plans)

- Confirm exact exports/symbols while implementing (read, don't invent): `ContextResolverImpl` from `@switchboard/core/skill-runtime`; `PrismaKnowledgeEntryStore`, `ALEX_SKILL_PACK_SCOPES` from `@switchboard/db`; `SkillDefinition.context` shape.
- Exact home of the stub-aware preflight assertion (a helper in `eval-preflight.ts` called from `run-eval.ts:main` vs inline) — pick the lower-import-coupling option; watch for circular imports with the stub module.
- `.js` import extensions on all relative ESM imports; Prettier (double quotes, semis, 100 width); co-located `*.test.ts`. Run `pnpm test` + `pnpm typecheck` before committing; api-suite tests for the provisioning change (CI has no Postgres — mirror the mocked-Prisma pattern).

---

## 9. Next step

On approval of this spec → invoke writing-plans to produce two implementation plans (PR-1 adapter fix; PR-2 SkillMode keystone + coupled fold-ins), then implement on separate branches/worktrees consuming this spec.
