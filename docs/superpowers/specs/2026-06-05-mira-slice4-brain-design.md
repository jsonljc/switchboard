# Mira Slice 4: the brain (SKILL.md, miraBuilder, brief-time memory, governed self-initiated briefs)

Status: design locked for implementation. Grounded against origin/main @ 2951510b (2026-06-05).
Roadmap anchor: `docs/superpowers/specs/2026-06-03-mira-roadmap.md` Slice 4 (P4, last).
Predecessors: slice 2 (`2026-06-04-mira-slice2-learning-loop-design.md`), slice 3
(`2026-06-04-mira-slice3-generator-quality-design.md`, PRs #896-#907).

## 1. Goal

The loop is closed: briefs generate, drafts get reviewed, kept creatives publish paused, taste and
measured performance accumulate. Slice 4 gives Mira judgment on top of that loop, in four legs:

- **An identity**: `skills/mira/SKILL.md`, mirroring Alex's skill (voice, judgment principles,
  taste vocabulary, claim boundaries, abstain-first escalation rules).
- **A builder**: `miraBuilder` in `packages/core/src/skill-runtime/builders/`, registered in the
  builder registry, assembling everything Mira reads at brief time from injected stores.
- **Brief-time memory**: DeploymentMemory taste buckets (both modes, mode-labeled) plus the
  measured performance read model enrich the compose context. The injected bucket keys thread to
  WorkTrace the same way Alex's `injectedPatternIds` do.
- **Governed self-initiation**: Mira composes briefs on a weekly performance scan and inside the
  Riley handoff path. Every mutation rides `PlatformIngress.submit()`; the only artifact she can
  create is a draft-only concept row a human later funds.

The brain proposes; the human disposes. Nothing in this slice adds a spend path, touches publish,
or weakens an existing approval gate.

## 2. Verified current state (origin/main @ 2951510b, 2026-06-05)

| #   | Fact                                                                                                                                                                                                                                                                                                                                   | Evidence                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Skill lookup at execution time is keyed by the deployment slug: `workUnit.deployment?.skillSlug ?? legacy` resolves the skill, and the builder lookup uses ONLY `workUnit.deployment?.skillSlug`                                                                                                                                       | `packages/core/src/platform/modes/skill-mode.ts:38,119-127`                                                                                                                            |
| 2   | Mira's seeded deployment slug is `"creative"`; `mira-brief.ts` resolves it via `resolveByOrgAndSlug(orgId, "creative")`                                                                                                                                                                                                                | `packages/db/src/seed/seed-mira-creative-deployment.ts:61`, `apps/api/src/routes/agent-home/mira-brief.ts:115`                                                                         |
| 3   | `skillsBySlug` is keyed by the FRONTMATTER slug (`alexSkill.slug`); only Alex is loaded today                                                                                                                                                                                                                                          | `apps/api/src/bootstrap/skill-mode.ts:130-131`                                                                                                                                         |
| 4   | `loadSkill(slug, dir)` resolves the path from its ARG (`skills/<arg>/SKILL.md`) but returns the frontmatter slug; the two are never cross-validated                                                                                                                                                                                    | `packages/core/src/skill-runtime/skill-loader.ts:190-203,249`                                                                                                                          |
| 5   | Loader trap: `validateToolReferences` regex `\b([a-z][\w-]*)\.\w+\.\w+` scans the BODY for any lowercase dotted triple and fails boot if the first segment is not a declared tool. A body mentioning a dotted intent name breaks API startup                                                                                           | `packages/core/src/skill-runtime/skill-loader.ts:84-101,239-241`                                                                                                                       |
| 6   | `registerSkillIntents` registers each skill's frontmatter `intent` as a skill-mode intent: mutationClass derived from tool NAMES (zero tools = `read`), approvalPolicy `none` for read, allowedTriggers `[chat, api, schedule, internal]`, timeoutMs 30_000                                                                            | `packages/core/src/platform/skill-intent-registrar.ts:23-47`                                                                                                                           |
| 7   | `SkillModeConfig` carries ONE executor for ALL skills; Alex's live executor runs four conversation gates (safety, claim classifier, PDPA consent, WhatsApp window), and the claim classifier costs an extra LLM call per execution                                                                                                     | `packages/core/src/platform/modes/skill-mode.ts:11-23,73`, `apps/api/src/bootstrap/skill-mode.ts:571-577,595-604`                                                                      |
| 8   | A second executor instance with a different hook set is established precedent (the simulation executor)                                                                                                                                                                                                                                | `apps/api/src/bootstrap/skill-mode.ts:704-738`                                                                                                                                         |
| 9   | The policy engine default-denies when no policy matches and the actor is not trusted for the action type                                                                                                                                                                                                                               | `packages/core/src/engine/policy-engine.ts:588-589,104`                                                                                                                                |
| 10  | The seeded creative allow policy matches `creative.job.*` (unanchored); it does NOT match a `creative.brief.*` intent. Every new workflow intent so far needed its own seeded org-scoped allow policy                                                                                                                                  | `packages/db/src/seed/creative-governance.ts:46-48`, `packages/db/src/seed/recommendation-handoff-governance.ts:26-53`                                                                 |
| 11  | `system_auto_approved` short-circuits the policy lookup before identity resolution; reserved for the draft-only concept intent because an agent-actor child has no IdentitySpec. Spend-bearing intents must not copy it                                                                                                                | `packages/core/src/platform/governance/governance-gate.ts:100-107`, `apps/api/src/bootstrap/contained-workflows.ts:345-362`                                                            |
| 12  | Cron-initiated work carries the seeded `{ id: "system", type: "system" }` principal verbatim; a bespoke `system:<x>` id has no IdentitySpec and hard-denies                                                                                                                                                                            | `apps/api/src/services/workflows/recommendation-handoff-request.ts:23-25,49`                                                                                                           |
| 13  | Top-level deployment resolution: `targetHint?.skillSlug ?? request.intent.split(".")[0]`; a `creative.*` intent prefix already resolves Mira's deployment                                                                                                                                                                              | `apps/api/src/bootstrap/platform-deployment-resolver.ts:13,22`                                                                                                                         |
| 14  | `creative.concept.draft` is the draft-only child intent: creates AgentTask + CreativeJob, never fires the pipeline ("the entire no-spend guarantee is that this module never imports creative-pipeline"), gated on Mira org enablement, internal-trigger-only                                                                          | `apps/api/src/services/workflows/creative-concept-draft-workflow.ts:46-67,140`, `apps/api/src/bootstrap/contained-workflows.ts:356-362`                                                |
| 15  | The Riley handoff flow is live: weekly cron resolves a mechanical brief via `synthesizeCreativeBrief(BusinessFacts)`, submits `adoptimizer.recommendation.handoff` (parks for seeded mandatory approval), and the post-approval handler re-checks abstention then submits the concept-draft child with a deterministic idempotency key | `apps/api/src/bootstrap/inngest.ts:279-306`, `apps/api/src/services/workflows/creative-brief-synthesis.ts`, `apps/api/src/services/workflows/recommendation-handoff-workflow.ts:71-88` |
| 16  | Alex's delegate tool submits the same concept-draft child; its input seam is the frozen `CreativeConceptDraftInput` (productDescription, targetAudience, optional valueContext)                                                                                                                                                        | `apps/api/src/bootstrap/delegation-targets.ts:15-52`, `packages/schemas/src/creative-concept-draft.ts:20-25`                                                                           |
| 17  | Taste buckets: written daily by the taste sweep as `taste:{kept\|passed}_{polished\|ugc}_{segment}` with content-deterministic dedup; READ today only by the polished pipeline provider, which explicitly skips non-polished buckets. UGC taste accumulates unread                                                                     | `apps/api/src/services/cron/creative-taste-sweep.ts`, `apps/api/src/services/creative-taste-context.ts:22,45-72` (skip at :66)                                                         |
| 18  | `DeploymentMemory.listHighConfidence(orgId, deploymentId, minConfidence, minSourceCount)` returns rows across ALL categories; the taste provider filters client-side. Surfacing thresholds: 0.66 confidence, 3 sources                                                                                                                 | `packages/db/src/stores/prisma-deployment-memory-store.ts`, `apps/api/src/services/creative-taste-context.ts:50-58`, `SURFACING_THRESHOLD` in `@switchboard/schemas`                   |
| 19  | `revenue_proven` exists in the DeploymentMemory category enum with ZERO writers (Riley promotion logic is unbuilt); Mira may read it, never write it                                                                                                                                                                                   | `packages/schemas/src/deployment-memory.ts`, slice-2 spec 3.7                                                                                                                          |
| 20  | `MiraCreativeReadModel` (core type, Prisma reader in db) carries per-job `reviewDecision`, measured `performance` (trueRoas, spend, bookedValueCents), `qa`, `ugcPhase`, and counts including `awaitingReview`                                                                                                                         | `packages/core/src/creative-read-model/types.ts`, `packages/db/src/stores/prisma-mira-creative-read-model-reader.ts`                                                                   |
| 21  | A concept-draft row (polished stage `trends`, empty stageOutputs) renders as `in_progress` ("Drafting") on the desk; that is the shipped delegation-v1 presentation                                                                                                                                                                    | `packages/core/src/creative-read-model/status-mapper.ts:57-66`                                                                                                                         |
| 22  | `alexBuilder(ctx, config, stores, services)` returns `{ parameters, injectedPatternIds }`; the rich result threads pattern IDs into the ExecutionResult for WorkTrace                                                                                                                                                                  | `packages/core/src/skill-runtime/builders/alex.ts:13-16,159-181`, `packages/core/src/platform/modes/skill-mode.ts:105,136-142`                                                         |
| 23  | Builder registration happens in apps/api bootstrap; the registry callback receives `{ workUnit, deployment, stores }` and adapts to the inner builder signature                                                                                                                                                                        | `apps/api/src/bootstrap/skill-mode.ts:606-633`, `packages/core/src/skill-runtime/builder-registry.ts`                                                                                  |
| 24  | Skill runtime budget: maxLlmTurns 6, maxRuntimeMs 120s, maxLlmCallMs 30s, maxTotalTokens 64k; skill-intent platform timeout is 30s                                                                                                                                                                                                     | `packages/core/src/skill-runtime/types.ts:342-350`, `packages/core/src/platform/skill-intent-registrar.ts:42`                                                                          |
| 25  | The attribution cron pair is the initiator pattern to mirror: dispatch always fires, per-org worker owns the kill-switch env flag, `retries: 2`, onFailure threaded from bootstrap                                                                                                                                                     | `apps/api/src/services/cron/creative-attribution.ts:65-86`, `apps/api/src/bootstrap/inngest.ts:878-903`                                                                                |
| 26  | Submit closures for cron-initiated intents are built in `bootstrapContainedWorkflows` (deployment resolve + `platformIngress.submit`) and threaded into inngest via options                                                                                                                                                            | `apps/api/src/bootstrap/contained-workflows.ts:441-449`, `apps/api/src/bootstrap/inngest.ts:281-306`                                                                                   |
| 27  | Every submit-calling site must branch on `"approvalRequired" in response` before destructuring outputs                                                                                                                                                                                                                                 | `apps/api/src/routes/agent-home/mira-brief.ts:145-147`, memory `feedback_ingress_route_must_handle_pending_approval`                                                                   |
| 28  | Medspa claim safety for creative output is human-gated: seeded mandatory-approval policy on publish, desk review before funding, paused-only publish. The #885 medical input scanner gates Alex's CONVERSATION inbound path, not creative briefs                                                                                       | `packages/db/src/seed/creative-governance.ts:75-107`, commit 3ada8c42                                                                                                                  |
| 29  | `creative.job.submit` is registered allowedTriggers `["api"]` only; a cron cannot legally submit it. The concept-draft child is the only internal-trigger creative write                                                                                                                                                               | `apps/api/src/bootstrap/contained-workflows.ts:310-316,356-362`                                                                                                                        |
| 30  | Real-pilot-org provisioning of the creative deployment + policies (`seedMiraCreativeDeployment`) runs for org_dev only; that workstream is separate and slice 4 must not block on it                                                                                                                                                   | `packages/db/src/seed/seed-mira-creative-deployment.ts:38`, enablement note at `packages/db/src/seed/creative-governance.ts:20-24`                                                     |
| 31  | The billing entitlement gate runs on EVERY submit when the resolver is wired (production refuses to boot without it); an org is entitled only via `subscriptionStatus` active/trialing or `entitlementOverride`. The org_dev seed sets neither (defaults "none"/false), so org_dev is unentitled by default                            | `packages/core/src/platform/platform-ingress.ts:177-190`, `apps/api/src/app.ts:635-639,655`, `packages/db/prisma/schema.prisma:444,449`, `packages/db/prisma/seed.ts:75-86`            |
| 32  | A keyed replay of an UNRESOLVED (running) work unit returns `ok:false` with `idempotency_in_flight`, retryable false; a completed replay returns the cached ExecutionResult with its outputs                                                                                                                                           | `packages/core/src/platform/platform-ingress.ts:117-140`                                                                                                                               |
| 33  | Read-model counters: `inFlight` includes BOTH `awaiting_review` and `in_progress` statuses, so unacted concept-draft rows count toward it; `awaitingReview` alone excludes them                                                                                                                                                        | `packages/core/src/creative-read-model/build-read-model.ts:70-73`                                                                                                                      |

## 3. Decisions

### 3.1 The brain is a governed skill-mode work unit, not an in-cron LLM call

**The shape.** A new intent, `creative.brief.compose`, registered from the skill's frontmatter via
the existing `registerSkillIntents` path (fact 6): defaultMode `skill`, zero tools so
mutationClass derives to `read`, approvalPolicy `none`. Initiators submit it through
`PlatformIngress.submit()` with the seeded system principal (fact 12); the platform resolves
Mira's creative deployment (fact 13), the GovernanceGate evaluates the seeded compose allow
policy (3.5), SkillMode runs `miraBuilder` then the executor, and the WorkTrace records the
reasoning step with its injected taste keys. Compose mutates nothing; its output is a structured
verdict the INITIATOR acts on (3.6).

**Why a work unit at all.** A plain LLM call inside the cron (the way ad-optimizer analyzers run)
would be cheaper to build, but it would put agent reasoning outside the governed surface: no
WorkTrace, no governance evaluation, no kill-switch by policy, no injected-pattern telemetry, and
no reuse of the skill runtime's budget enforcement. The roadmap's "wired to a governed executor"
names the skill runtime deliberately. Riley's analyzers predate the skill runtime; Mira should
not copy that debt.

**Rejected: brain as a creative-pipeline stage** (the pipeline is L2 and per-job; the brain
reasons across jobs, taste, and handoffs, and must run when NO job exists).
**Rejected: brain inside the workflow handler** (workflow mode bypasses the builder registry; the
roadmap requires miraBuilder in the skill-runtime registry).

### 3.2 skills/mira/SKILL.md: directory "mira", frontmatter slug "creative"

**The slug.** Execution-time lookups (skill AND builder) key off `deployment.skillSlug` (fact 1),
and Mira's deployment slug is `"creative"` everywhere (fact 2): the brief route, the concept
child resolver, the seeds. Renaming the deployment slug would break shipped resolution paths for
zero benefit. The frontmatter slug is therefore `creative` (the runtime identity), the directory
is `skills/mira/` (the roadmap-locked product identity), and bootstrap calls
`loadSkill("mira", skillsDir)` (the loader never cross-validates, fact 4). The asymmetry is
documented at the load site and in the frontmatter description.

**Frontmatter.** `name: Mira`, `slug: creative`, `intent: creative.brief.compose`,
`version: 1.0.0`, `author: switchboard`, a one-line `description` (both required by
`SkillFrontmatterSchema`), zero `tools`, NO `context` entries (the builder owns every parameter;
the knowledge-entry resolver has nothing to resolve and the merge-precedence question never
arises).
`minimumModelTier` omitted: compose is a single-turn judgment over pre-digested context; the
adapter default tier matches Alex's conversation turns. Parameters, all builder-supplied:

| Parameter             | Req | Content                                                                                                 |
| --------------------- | --- | ------------------------------------------------------------------------------------------------------- |
| `BUSINESS_NAME`       | yes | From BusinessFacts, fallback "the clinic"                                                               |
| `BUSINESS_FACTS`      | no  | `renderBusinessFacts` output, may be empty                                                              |
| `TASTE_CONTEXT`       | no  | Mode-labeled taste lines, both modes, plus measured-winner lines when `revenue_proven` rows exist (3.3) |
| `PERFORMANCE_CONTEXT` | yes | Deterministic read-model summary; says "no published creatives yet" when empty                          |
| `PIPELINE_STATE`      | yes | Draft backlog counts (awaiting review, in flight)                                                       |
| `TRIGGER_CONTEXT`     | yes | "weekly scan" or the Riley recommendation (action type, rationale, evidence numbers)                    |
| `CURRENT_DATETIME`    | no  | Org-timezone stamp, Alex's format                                                                       |

**Body sections** (mirroring Alex's outline at Mira's altitude):

1. **Identity**: creative director for {{BUSINESS_NAME}}, judgment over volume, drafts not spend.
2. **What you read**: explains each context block and the subjective/measured split. Taste lines
   are operator preference ("what they keep"); performance lines are measured outcomes ("what
   converted"). Never conflate them; when they conflict, say so in the reason and weight measured
   evidence for money questions, operator taste for tone questions.
3. **Judgment principles**: one strong concept beats three vague ones; a concept must name who it
   is for and what it promises them; reuse what worked before it experiments; respect mode
   character (polished is brand-true and styled, real-talk is unpolished and personal) when
   wording a concept, informed by which mode's taste signal is stronger.
4. **Claim boundaries (non-negotiable)**: concept briefs are upstream of ad copy, so claims are
   gated at the SOURCE. Never promise outcomes, results, safety, or timelines; never use
   superlatives a business fact does not substantiate; never name a medical result ("removes",
   "cures", "erases"); frame benefits as experiences and consultations, not clinical outcomes.
   The downstream human gates (desk review, mandatory publish approval) stay the enforcement
   layer; this section keeps claim-y briefs from being composed at all.
5. **When to abstain (the default posture)**: thin signal (no measured performance AND no
   surfaced taste), a backlog at or over the cap, nothing materially new since the last brief,
   or a trigger that taste/performance contradicts. Abstaining with a crisp reason is a
   first-class success outcome, not a failure.
6. **Output contract**: exactly one JSON object, no markdown fences, no prose before or after;
   the schema from 3.6 spelled out with field limits.

**Authoring constraint (loader trap, fact 5).** The body must contain NO lowercase dotted-triple
tokens: intent names, route paths, and file paths are written in prose ("the concept-draft
intent") or with the dots broken. This INCLUDES the output-contract example: the JSON sample in
the body must not contain the dotted intent name anywhere. The output-contract section also
instructs the model never to emit intent or qualification-signal tags (the executor's tag
stripper whitespace-collapses tagged responses, which would mangle JSON; the parse-abstain
fallback catches it, but the instruction keeps the path cold). A loader test in PR-1 loads the
REAL file so a violation fails unit tests, not API boot.

**References.** None in v1. Alex's references are jurisdiction/regulatory playbooks resolved per
market; Mira's equivalent (per-vertical creative playbooks) has no content source yet. The
`references/` directory loads automatically if added later (fact 4): named seam, nothing to build.

**Rejected: frontmatter slug "mira" + registry key remap in bootstrap** (two names for one
runtime identity invites a drift bug the first time someone keys a map off the definition's slug
field; one mismatch, documented, beats two).
**Rejected: a second AgentDeployment with skillSlug "mira"** (splits trust/spend/governance state
across two rows for one agent; the autonomy-fields gotcha is exactly this class of bug).

### 3.3 miraBuilder: brief-time memory read, both modes, measured and subjective kept apart

**Signature.** `miraBuilder(config, stores)` in
`packages/core/src/skill-runtime/builders/mira.ts`, returning
`{ parameters, injectedPatternIds }` (the alex-shaped rich result, fact 22). It takes no
`AgentContext`: compose has no conversation, persona, or contact; everything Alex pulls from
persona, Mira derives from BusinessFacts. The registry callback in bootstrap adapts
`{ workUnit, deployment, stores }` to `config` exactly as Alex's does (fact 23).
`config = { orgId, deploymentId, composeSource, recommendation?, now? }`, where `composeSource`
and `recommendation` are zod-parsed from `workUnit.parameters` (parse, don't cast).

**Stores.** `SkillStores` (core) gains two OPTIONAL members so every existing builder and test
compiles untouched:

- `deploymentMemoryReader?: { listHighConfidence(orgId, deploymentId, minConfidence, minSourceCount) }`
  (the `TasteContextMemoryReader` shape; `PrismaDeploymentMemoryStore` already satisfies it,
  fact 18).
- `miraReadModelReader?: MiraCreativeReadModelReader` (the EXISTING core interface at
  `packages/core/src/creative-read-model/types.ts:87-92`, whose `read(orgId, opts)` REQUIRES
  `{ now: Date; timezone: string }`; `PrismaMiraCreativeReadModelReader` implements it).

The builder also depends on the EXISTING `businessFactsStore` member of `SkillStores`: it reads
facts FIRST (business name, rendered facts, and the org timezone), then calls the read model with
`{ now: config.now?.() ?? new Date(), timezone }`. Two distinct timezone fallbacks, both explicit
(mirroring Alex): absent facts or absent field defaults to `"Asia/Singapore"`; an invalid IANA
string degrades via the try/catch fallback rather than throwing. Core stays L3-clean: interfaces
in core, Prisma implementations injected at bootstrap.

**Taste read (the scope-3 decision, made deliberately).** The builder reads
`listHighConfidence` at the standard surfacing thresholds and renders BOTH modes, mode-labeled,
with the mode named in every line:

- `In polished mode, the operator consistently keeps question hooks (5 keeps).`
- `In real-talk mode, the operator consistently passes confession-structure clips (3 passes).`

The slice-3 cross-mode bleed bug was a GENERATION-time problem: a UGC structure id rendered as a
polished hook instruction inside a generation prompt is incoherent guidance. At BRIEF time the
brain is reasoning about what to propose, and "operators keep demo-first real-talk clips" is
exactly the judgment signal it needs. Mode labels keep the segments from blurring. The polished
pipeline provider and its skip (fact 17) stay byte-identical; UGC GENERATION-time injection
(`runUgcScriptWriter` constraints) remains the named slice-3 follow-on, untouched here.

**Measured winners, forward-compatible.** The same scan parses `revenue_proven` canonical keys
when rows exist and renders them as measured lines, clearly distinct from taste. Zero writers
exist today (fact 19), so this path is inert until Riley's promotion logic ships; building the
read now means the brain picks the signal up the week it appears. Mira never writes either
category: the brain holds NO DeploymentMemory write path, which keeps the dedup-axis and
canonical-key invariants entirely out of this slice.

**Performance summary.** Deterministic prose from the read model: counts (shipped this week and
last, in flight, awaiting review), up to three top measured performers (trueRoas, spend, booked
value) with their review decisions, up to two stopped/passed jobs, and the most recent operator
decisions. No LLM summarization: same inputs, same string.

**injectedPatternIds.** The canonical keys of every memory row rendered into `TASTE_CONTEXT`.
They flow through the rich builder result into the ExecutionResult and WorkTrace (fact 22), so
"which remembered taste shaped this brief" is auditable per compose, at parity with Alex's
outcome patterns.

**Failure honesty.** Reader absent or read throws: the builder throws `ParameterResolutionError`;
SkillMode converts to a failed ExecutionResult; the initiator logs and abstains. No silent empty
context pretending signal was consulted (degrading to empty TASTE_CONTEXT is reserved for "reads
succeeded, nothing surfaced").

**Rejected: reusing `buildCreativeTasteProvider`** (it is the polished-only pipeline seam in
apps/api; the builder is core and needs both modes. Two small renderers with different contracts
beat one shared renderer with a mode flag that exists to undo its own filter).
**Rejected: builder-side LLM summarization of performance** (non-deterministic context, double
LLM cost, untestable).

### 3.4 A dedicated compose executor behind a per-slug executor seam

**The problem.** SkillMode holds ONE executor (fact 7). Alex's live executor runs four
conversation gates; on a compose run the consent and window gates do per-execution DB lookups for
a session that is not a conversation, the claim classifier adds a whole LLM call per compose, and
a deterministic-gate hit would both corrupt the JSON output into a customer-facing apology AND
write a `compliance_concern` Handoff row into the operator inbox for an internal reasoning step.
Wrong tools for a non-conversation surface.

**The seam.** `SkillModeConfig` gains `executorBySlug?: Map<string, SkillExecutor>`;
`execute()` picks `executorBySlug?.get(slug) ?? executor`. One additive core change, zero
behavior change for Alex, mirrored by a test. Bootstrap builds a `composeExecutor`:
`new SkillExecutorImpl(adapter, new Map(), undefined, [], undefined, undefined, undefined,
new TracePersistenceHook(traceStore, { trigger: "brief_compose" }))`. Zero tools, zero hooks,
no model router, execution-trace telemetry kept (cost and latency per compose remain observable).
The trace trigger union (`SkillExecutionTrace.trigger`, `packages/core/src/skill-runtime/types.ts:171`,
mirrored in the `TracePersistenceHook` constructor) is today `"chat_message" | "batch_job"`;
PR-1 widens it with `"brief_compose"` (additive core change) so the compose trace is honestly
labeled rather than masquerading as a batch job. The simulation executor precedent (fact 8)
already established "different surface, different hook chain" as the house pattern. To keep the
existing governance bootstrap test's call-index assertions meaningful, the compose executor is
constructed AFTER the simulation executor (calls 0 and 1 keep their identities; compose is
call 2), and `apps/api/src/bootstrap/__tests__/skill-mode-governance.test.ts` updates its
constructor-count assertions (executor 2 to 3, trace hook 1 to 2) in the same PR.

**Why dropping the gates is safe here.** The gates protect OUTBOUND CONVERSATION (banned phrases
to a lead, unsubstantiated claims to a lead, consent, messaging windows). Mechanically they are
afterSkill hooks that run REGARDLESS of tool count (zero tools alone would not silence them;
GovernanceHook, by contrast, is beforeToolCall-only and would be inert either way), which is why
the empty hook list, not the empty tool map, is the operative part of this decision. Compose
output is an internal artifact that cannot reach a customer without passing the desk review,
generation, and the seeded mandatory publish approval (fact 28). Claim discipline at the source is the SKILL.md
boundary section (3.2); claim enforcement stays where it already is, on the human-gated path.

**Rejected: sharing Alex's executor** (per-compose claim-classifier LLM cost, handoff-row noise,
JSON corruption on a gate hit; all three are concrete, not hypothetical).
**Rejected: a second SkillMode registration** (the mode registry keys by mode name; two "skill"
modes cannot coexist).
**Rejected: hook-level no-op guards keyed on session shape** (every future hook author must
remember compose exists; a separate executor is structural and forgettable-proof).

### 3.5 Governance: a seeded org-scoped allow policy; compose executes without parking

**The seed.** `creative-governance.ts` gains `buildCreativeBriefComposeAllowPolicyInput(orgId)`:
effect `allow`, anchored rule `^creative\.brief\.compose$`, priority 50, installed by
`seedMiraCreativeDeployment` next to the existing creative policies. Without it the engine
default-denies (facts 9, 10): the producer-population lesson says the seed ships in the SAME PR
as the intent (PR-2), with the real-gate test exercising the seeded posture.

**Why allow rather than require_approval.** The Riley handoff parks for mandatory approval
because it carries Riley's cross-agent advisory authority into Mira's domain; the human approves
the crossing. Compose is Mira reasoning inside her own domain, and its only consequence is a
draft-only concept row on the desk that the operator already curates (Keep/Pass/fund). Parking
compose would put an abstract "may Mira think about a brief?" card in the approval inbox weekly,
upstream of a concrete draft the desk is better at judging. The human gate is not removed; it is
already downstream, twice (desk review before any generation spend, mandatory approval before
publish), and the weekly idempotency key plus backlog cap (3.7) bound the proposal rate.

**Why NOT system_auto_approved.** The short-circuit skips the policy lookup entirely (fact 11),
which would permanently remove the operator's ability to throttle or deny compose per org with a
policy row. A real allow policy keeps the dial: in the engine, a matched deny ALWAYS wins
(short-circuit, regardless of priority) and any matched require_approval policy forces the
approval requirement, so the day an operator wants Mira quieter, one org-scoped policy row does
it. The concept-draft child keeps
its existing `system_auto_approved` registration (fact 14): it is the same no-spend draft row
whether Alex, the Riley handler, or the self-brief worker submits it.

**Actor.** The seeded system principal on both submits (fact 12). Mira has no IdentitySpec, and
minting one for an agent actor is an identity-model decision that belongs to a dedicated
workstream, not a side effect of this slice. Provenance is carried structurally:
`requestSource`-style fields in compose parameters, `parentWorkUnitId` linking draft to compose,
and the deployment context on both traces.

**Rejected: require_approval on compose** (approval-inbox noise for a zero-effect action;
the desk IS the review surface for the artifact that matters).
**Rejected: system_auto_approved on compose** (removes the per-org governance dial forever).
**Rejected: widening the creative.job.\* allow rule** (that rule governs spend-bearing pipeline
intents via the spend threshold; the compose posture is different and deserves its own anchored
rule, mirroring how publish got its own).

### 3.6 Output contract: structured verdict; the initiator acts

**The contract.** New schemas in `@switchboard/schemas` (L1):

- `MiraComposeRequestSchema`: `{ composeSource: "weekly_scan" | "riley_handoff",
recommendation?: { actionType, campaignId, rationale, evidence: { clicks, conversions, days } } }`,
  refined so `riley_handoff` requires `recommendation`. The field is deliberately NOT named
  `trigger`: the ingress request already has a `trigger` ("schedule"/"internal") and overloading
  the word at the same call site invites wiring the wrong one.
- `MiraComposeOutputSchema`: `{ decision: "propose" | "abstain", reason: string (1..500),
brief?: { productDescription: string (1..500), targetAudience: string (1..500) } }`, refined so
  `propose` requires `brief`. The brief shape is a constrained subset of the frozen
  `CreativeConceptDraftInput` seam (fact 16: tighter length caps, no `valueContext`), so the
  draft submit is a clean passthrough.
- `parseMiraComposeOutput(text)`: strips an optional markdown fence, JSON-parses, zod-validates;
  returns a discriminated `{ ok, value | error }`. Any failure means ABSTAIN at the caller, with
  the raw head of the text logged for diagnosis. A malformed compose can only ever cost a skipped
  week, never fabricate a draft.

**The actor split.** The skill REASONS and returns the verdict; the INITIATOR (cron worker or
handoff submitter) parses it and performs the mutation through ingress. Compose work units stay
read-class and reusable by any future initiator (the handoff path reuses compose without wanting
a side effect, which a tool-based design could not offer). Parent/child WorkTraces stay legible:
compose trace holds the reasoning and injected keys; the draft trace holds the mutation.

**Rejected: a mid-loop tool that submits the draft** (triples turns and tokens for the weekly
case, cannot serve the handoff case where the brief must come back WITHOUT a side effect, and
adds a tool-governance surface for no added control: the child intent is already governed).
**Rejected: frontmatter `output` enforcement** (the loader validates the declaration shape but
nothing enforces it at runtime; the zod parse at the caller is the real contract. The
frontmatter `output` block is included as documentation only.)

### 3.7 Self-initiation: a weekly dispatch/worker pair, draft-only, capped by construction

**Shape.** `apps/api/src/services/cron/mira-self-brief.ts`, mirroring the attribution pair
(fact 25): `createMiraSelfBriefDispatch` (cron `0 10 * * 1`, Mondays 10:00 UTC, after the daily
06:00 taste sweep, the daily 06:30 attribution refresh, and the Monday 09:00 UTC weekly Riley
audit (`packages/ad-optimizer/src/inngest-functions.ts:276`), so the week's freshest signal is
already persisted) fans out one `mira/self-brief.scan` event per org with an active creative
deployment; `createMiraSelfBriefWorker` owns everything per-org. `retries: 2` with the
onFailure audit contract threaded from bootstrap exactly like the attribution worker. Submit
closures (`submitMiraBriefCompose`, `submitMiraConceptDraft`) are built in
`bootstrapContainedWorkflows` and threaded via options (fact 26).

**Kill-switch.** `MIRA_SELF_BRIEF_ENABLED === "true"`, default off, read inside the worker
(dispatch always fires, the worker short-circuits dark: the attribution pattern). Added to the
`required_in_env_example` bucket of `scripts/env-allowlist.local-readiness.json` AND to
`.env.example` in the same PR (env-completeness checks both).

**Worker stages** (the function RETURNS one named JSON outcome; the implementation
deliberately uses no internal step state so retries replay idempotency claims):

1. `floor`: flag on; Mira org-enabled (`isAgentHomeAccessible`); creative deployment resolves;
   read model floor: `counts.inFlight < 5` (desk hygiene cap, constant
   `SELF_BRIEF_BACKLOG_CAP`; `inFlight` includes unacted concept-draft rows, fact 33, so Mira's
   own ignored proposals throttle her: self-limiting by construction) AND signal floor (at least
   one job whose performance projection reports measured delivery OR at least one surfaced taste
   row). A zero-signal org composes nothing: a brief from BusinessFacts alone is what the
   operator's own brief box is for, and pure job-count presence without measured performance or
   operator decisions is noise. Each skip returns a named reason in the step output.
2. `compose`: submit `creative.brief.compose` (trigger `schedule`, system actor, targetHint
   `{ deploymentId, skillSlug: "creative" }`, idempotencyKey
   `self-brief-compose:{deploymentId}:{isoWeek}`). Branch `!ok` with NAMED skips: an
   `entitlement_required` error (fact 31: fails fast, pre-LLM) records skip reason
   `org_not_entitled`; an `idempotency_in_flight` error (fact 32: a prior crashed attempt left a
   running claim) records `compose_claim_unresolved`. Then branch `approvalRequired` (logged and
   stopped: a future org policy may park compose, and a parked compose must not phantom-draft,
   fact 27), then failed outcome. Parse via `parseMiraComposeOutput`; a model abstain ends the
   run with `{ abstained: reason }`; a parse failure ends it with `{ skipped:
"compose_parse_failure" }` plus a structured warn carrying the raw head, so "Mira chose
   quiet" and "Mira stopped parsing" are distinguishable in the inngest run history.
3. `draft`: submit `creative.concept.draft` (trigger `internal`, system actor, the same
   targetHint, `parentWorkUnitId` = compose work unit id, idempotencyKey
   `self-brief:{deploymentId}:{isoWeek}`). Same three-way branch. The child re-checks enablement
   and tenancy itself (fact 14).

**At most one self-initiated draft per org per ISO week, by construction.** The deterministic
idempotency key makes a replayed or duplicated worker run a claim-first replay, not a second
draft (the D1 guard). UTC ISO week: the cadence needs uniqueness, not org-local calendar
semantics.

**The desk artifact.** The draft lands exactly like a Riley-handoff or Alex-delegate concept:
an `in_progress` ("Drafting") card (fact 21). Whether concept rows deserve their own desk
treatment and a one-tap "fund this" affordance is a desk UX decision deliberately left to the
post-roadmap list: slice 4 keeps the artifact contract identical across all three concept
producers, and at one per week the presentational wart is bounded.

**Rejected: event-driven triggers (attribution lands, taste flips)** (resume-on-event
infrastructure by another name; the weekly scan reads the same signals one cadence later with a
tenth of the machinery. Named seam: the worker's floor function is where an event trigger would
plug in).
**Rejected: submitting `creative.job.submit` instead of a concept draft** (it is api-trigger-only
(fact 29) BECAUSE generation costs money; self-initiated spend, even threshold-parked, inverts
the proposes/disposes posture this slice is built on).
**Rejected: a dedup query over recent drafts instead of idempotency keys** (requires tagging
draft provenance through the frozen brief seam or a schema change; the key achieves exactly-once
with zero new state).

### 3.8 Riley handoff enrichment: compose BEFORE the approval, fallback to synthesis

**Today** the handoff submitter resolves `synthesizeCreativeBrief(BusinessFacts)`: honest but
campaign-blind (fact 15: the rationale and evidence ride beside a generic brief). **This slice**,
behind `MIRA_HANDOFF_BRIEF_ENRICHMENT_ENABLED` (default off, own allowlist entry), the submitter
first submits a compose work unit (trigger `internal`, idempotencyKey
`handoff-compose:{recommendationId}:{actionType}`, `MiraComposeRequestSchema` composeSource
`riley_handoff` with the recommendation context). On `propose`, the composed brief rides the
handoff submit; on abstain, parse failure, ingress error, or parked compose, the synthesized
brief rides instead and a warn is logged. The handoff path NEVER gets blocked by the brain: the
fallback is the shipped behavior, byte-identical.

**Approval-binding integrity.** Composition happens BEFORE `adoptimizer.recommendation.handoff`
is submitted, so the brief the human approves on the parked card IS the brief the post-approval
handler maps into the draft (binding hash intact, fact 15). Enriching after approval would
execute something other than what was approved; that option is rejected on principle.

**Flag split.** Two flags, not one: the weekly scan is purely additive surface, while enrichment
changes the content a human sees on a shipped approval card. A pilot can run either without the
other.

**Rejected: enriching inside the post-approval handler** (approval-binding violation).
**Rejected: one shared brain flag** (couples two different risk profiles to one switch).

### 3.9 What the brain does NOT get in this slice

- **No DeploymentMemory writes** (taste is the sweep's, `revenue_proven` is Riley's; the brain is
  a reader. Every memory-write invariant stays untouched by construction).
- **No mode flag on concept drafts.** The brief seam is frozen (fact 16) and concept rows carry
  no mode. UGC taste shapes the WORDING of a concept; an operator choosing real-talk generation
  still does so at the desk. Named seam: a `recommendedMode` field on the concept input, the day
  the desk grows a concept-to-brief affordance.
- **No resume-on-event.** Parked-flow resumption on completion events is the handoff
  workstream's open item; the weekly cadence already picks up late-arriving signal one scan
  later. Building event-resume infrastructure as a side effect of the brain slice would couple
  two workstreams that fail independently today.
- **No new identity model.** Mira acts via the system principal; an agent-grade IdentitySpec is
  post-roadmap work.
- **No desk surface changes.** `mira-decision.ts` stays byte-untouched; no dashboard changes of
  any kind.

## 4. PR plan (four implementation branches off main, strict order, no stacking)

**PR-1: the brain exists (schemas + skill + builder + core seam).** `MiraComposeRequestSchema`,
`MiraComposeOutputSchema`, `parseMiraComposeOutput` (+ tests, schemas package).
`skills/mira/SKILL.md` plus a core loader test that loads the REAL file (parses clean, slug
`creative`, intent present, zero tools, no dotted-triple body tokens: the boot-safety test).
`miraBuilder` + tests (taste rendering both modes, revenue-proven lines, performance summary,
injected keys, ParameterResolutionError paths, datetime fallback). `SkillStores` optional
readers. `SkillMode.executorBySlug` + test. The `SkillExecutionTrace.trigger` union widened with
`"brief_compose"` (types + TracePersistenceHook constructor). Builders barrel export. Nothing
calls any of it; every package compiles and tests green standalone.

**PR-2: the brain is wired (bootstrap + governance seed).** Bootstrap loads the mira skill
(map asserts two distinct slugs), registers intents for both skills, builds the dedicated
compose executor (constructed after the simulation executor, 3.4), registers the `creative`
builder callback, injects the two Prisma readers into SkillMode stores, and updates
`skill-mode-governance.test.ts` (executor constructor count 2 to 3, trace-hook count 1 to 2, new
call-2 assertions). `buildCreativeBriefComposeAllowPolicyInput` + seed wiring + the apps/api
real-gate test proving: seeded org composes (execute), unseeded org default-denies, and the
compose intent resolves the creative deployment. After PR-2 the intent is live with no AUTOMATED
initiators; like every api-triggerable skill intent (alex included), an authenticated operator on
an entitled, seeded org could submit it manually through the generic actions route. That path is
governed (the seeded allow policy), read-class, entitlement-gated, and creates no draft (nothing
acts on the compose output until PR-3); it is accepted, not a gap.

**PR-3: the weekly loop.** `mira-self-brief.ts` dispatch + worker + submit closures + inngest
registration + onFailure + `MIRA_SELF_BRIEF_ENABLED` + allowlist and `.env.example` entries.
Tests: floor matrix (flag, enablement, deployment, inFlight cap, zero-signal), compose branch
matrix (!ok generic / entitlement_required named skip / idempotency_in_flight named skip /
approvalRequired / failed / model-abstain / parse-fail / propose), draft branch matrix,
idempotency key determinism, step-output JSON shape. Full apps/api suite.

**PR-4: handoff enrichment.** The submitter change + `MIRA_HANDOFF_BRIEF_ENRICHMENT_ENABLED` +
allowlist and `.env.example` entries. Tests: flag off = byte-identical behavior; propose =
composed brief on the submit; every degrade path = synthesized fallback + warn; compose
idempotency key per recommendation.

Each PR: typecheck, build, lint, format:check, arch:check, touched package suites + FULL apps/api
suite, check-routes (no new routes anywhere in this slice), env-completeness; two independent
adversarial reviews (fact-check lens, design/operational lens); squash-merge; next branch from
the merged tip.

## 5. Invariants held

1. Every mutation rides `PlatformIngress.submit()`: compose (read-class) and concept drafts both
   enter the front door; no route, cron, or skill writes around it.
2. WorkTrace per WorkUnit, parent-linked: compose traces carry injected taste keys; draft traces
   carry the mutation; `parentWorkUnitId` joins them.
3. Approval lifecycle untouched: publish stays seeded-mandatory; the Riley handoff stays parked;
   the spend threshold lever is never consulted by a draft-only path.
4. Medspa claim review stays human-gated at every trust tier: unchanged gates, plus source-level
   claim boundaries in the skill body.
5. Layer discipline: core imports no db/creative-pipeline (readers are injected interfaces);
   schemas stay dependency-free; the skill file is product surface, not code.
6. Honest degrade everywhere: builder read failure fails the compose; parse failure abstains;
   enrichment failure falls back to the shipped synthesized brief; no fabricated signal, ever.
7. `revenue_proven` is Riley-owned vocabulary: read-only here, zero writers added.
8. `pastPerformance` two-shapes firewall: the brain reads performance only through the read-model
   projection; it never touches the column.
9. `mira-decision.ts` byte-untouched; no desk/dashboard changes; paused-only publish unreachable
   from anything in this slice.

## 6. Risks and mitigations

| Risk                                                                                | Mitigation                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Malformed SKILL.md breaks API boot (loader throws at startup)                       | PR-1 loader test loads the real file; the dotted-triple trap is tested explicitly; PR-2 boot asserts two skills registered                                                                                                                                                                                                                                                 |
| Slow compose runs unbounded                                                         | The registrar's 30s intent timeoutMs is decorative at dispatch; the REAL bound is the skill-runtime budget enforced inside the executor (maxLlmCallMs 30s per call, maxRuntimeMs 120s total, SkillExecutionBudgetError -> honest failed trace). Zero tools, single turn, capped context keep typical latency far under it; per-compose latency recorded via the trace hook |
| LLM returns non-JSON or fenced JSON                                                 | Fence-stripping parser; any failure = abstain + logged head; a bad week costs a skipped brief, never a bad draft                                                                                                                                                                                                                                                           |
| Self-brief feed spam                                                                | One per org per ISO week by idempotency key; inFlight cap 5 (counts Mira's own unacted concept rows, fact 33, so ignored proposals throttle her); signal floor; org enablement; kill-switch default off                                                                                                                                                                    |
| A future org policy parks compose and the worker misreads it as success             | Explicit `approvalRequired` branch on BOTH submits, tested (the phantom-success gotcha)                                                                                                                                                                                                                                                                                    |
| Unentitled org makes the loop silently inert (fact 31: org_dev defaults unentitled) | `entitlement_required` maps to the named skip `org_not_entitled` (fails fast, pre-LLM); the flip checklist names entitlement as a prerequisite; never silently swallowed                                                                                                                                                                                                   |
| A crashed compose orphans a `running` claim and burns that org's week               | Honest by design: the in-flight replay returns `idempotency_in_flight` (fact 32), the worker records `compose_claim_unresolved`, and the key self-heals next ISO week; PR-3 asserts the named skip (never a phantom success)                                                                                                                                               |
| Conversation gates silently expected on compose output (reviewer assumption)        | 3.4 records the deliberate zero-hook decision and why claim safety lives downstream + at source                                                                                                                                                                                                                                                                            |
| Shared-executor regression for Alex                                                 | `executorBySlug` is additive; Alex resolves through the unchanged default path; core test pins it; the bootstrap governance test's constructor-count and call-index assertions are updated deliberately in PR-2 (3.4), never loosened                                                                                                                                      |
| Enrichment degrades the shipped handoff                                             | Fallback-to-synthesis on every failure mode, flag default off, flag-off path asserted byte-identical                                                                                                                                                                                                                                                                       |
| Duplicate compose cost on inngest retries                                           | Compose submit carries its own deterministic idempotency key; replay returns the claimed trace                                                                                                                                                                                                                                                                             |
| org_dev-only seeding misread as launch-ready                                        | 7 and fact 30 name real-org provisioning as the separate prerequisite workstream                                                                                                                                                                                                                                                                                           |

## 7. What flips it live

1. `MIRA_SELF_BRIEF_ENABLED=true` on the API host: weekly scans begin for orgs that are Mira-enabled
   AND have the seeded creative deployment + compose allow policy (`seedMiraCreativeDeployment`,
   org_dev only until real-org provisioning ships, fact 30). If a creative deployment predates
   the PR-2 seed change, re-run `seedMiraCreativeDeployment` for that org so the compose allow
   policy is installed; otherwise compose default-denies weekly with a warn (observable, named).
2. **The org must be billing-entitled** (fact 31): `subscriptionStatus` active/trialing or
   `entitlementOverride=true`. org_dev is unentitled by default (the known local-dev gotcha), so
   a local end-to-end run requires flipping the override on the org row deliberately; this spec
   does NOT make any seed flip billing state as a side effect. Until entitled, every scan records
   the named `org_not_entitled` skip.
3. `MIRA_HANDOFF_BRIEF_ENRICHMENT_ENABLED=true`: Riley handoff cards start carrying composed
   briefs, independently of (1). FLIP GATE: enrichment puts one synchronous LLM compose per
   candidate (a handful per org) INSIDE the weekly audit's per-deployment inngest step, which
   already serializes rate-limited Graph calls. At pilot tenancy this is minutes of headroom;
   before enabling at larger tenancy, move the compose onto its own step or event (named seam:
   the recommendation sink). A retry after a crash MID-compose falls back to the synthesized
   brief for that handoff (fail-safe; enrichment is not guaranteed to survive a step crash).
4. `ANTHROPIC_API_KEY` present (already required by skill mode at boot).
5. No schema migration in this slice; `db:check-drift` is expected clean unless PR review
   surfaces a needed index (none anticipated: all reads ride existing indexes).

**Rollback.** Flipping either flag off stops production of new compose work units immediately
(dispatch still fires; workers short-circuit dark). Concept rows already created are inert
draft-only CreativeJob rows: the operator can Keep/Pass/stop or simply ignore them, they hold no
spend and fire no pipeline, and no data migration or cleanup is required. Handoff enrichment off
restores the synthesized-brief behavior byte-identically for all FUTURE handoffs; already-parked
cards keep the brief that was bound at submit time, which is exactly what binding-hash integrity
requires.

## 8. Out of scope (deferred deliberately, with named seams)

- **UGC generation-time taste injection** (wiring point: `runUgcScriptWriter` constraints;
  trigger: surfaced UGC taste buckets with real source counts; carried from slice 3 verbatim).
- **Concept-to-brief desk affordance + concept-row presentation** (wiring point: the desk card
  for `in_progress` concept rows; trigger: pilot operators receiving weekly self-briefs).
- **`recommendedMode` on concept drafts** (wiring point: the frozen concept input seam, the day
  the desk affordance lands).
- **Resume-on-event** (wiring point: the self-brief worker's floor step; trigger: a pilot where
  weekly cadence demonstrably misses revenue).
- **Riley `revenue_proven` promotion writer** (owned by the Riley workstream; the brain's reader
  is already built and inert).
- **Agent-grade IdentitySpec for Mira** (post-roadmap identity-model work).
- **Real-pilot-org provisioning** (`seedMiraCreativeDeployment` at onboarding; separate pending
  workstream, fact 30).
