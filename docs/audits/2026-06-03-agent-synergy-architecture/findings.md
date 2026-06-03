# Agent-to-Agent Synergy Architecture — Research & Audit

> **Scope.** The best architecture for seamless synergy (agent-to-agent handoff) between
> Switchboard's three agents — **Alex** (medspa booking/conversion), **Riley** (ad
> optimization), **Mira** (creative director). Read-only analysis. Verified against live
> code at **`origin/main` = `ae7fb758`** (`feat(ad-optimizer): … gate-4 hybrid (#835)`),
> read through the worktree `.claude/worktrees/agent-a24f5a57060afcaaf` (HEAD `ae7fb758`).
> Date: 2026-06-03.

> **Methodology note / correction.** Two of the prompt's "reported current state" leads were
> **stale** and are corrected here with `file:line` evidence: (a) "Mira→Riley push-to-ad is
> DEAD CODE" — the `creative.job.publish` hinge (#830) **is shipped and wired**, though it is
> a Mira→Meta-Ads-Manager edge (not Mira→Riley) and is **producer-blocked / inert
> end-to-end**; (b) "resume-on-event is the deferred NEXT" — still true, still unbuilt. A
> **process hazard** is documented in §2.0: the repo's main checkout was on a stale branch
> (`docs/production-env-checklist` @ `d2ad7e87`, pre-#819…#835); reading product code from
> `/Users/jasonli/switchboard` (the main checkout) instead of the worktree showed #830 as
> "absent." All findings below were re-grounded against the worktree at `ae7fb758`. **Verify
> any file:line in this doc against `origin/main` before acting — main moves fast (multiple
> concurrent sessions).**

---

## 1. Executive summary (the recommended synergy architecture, ≤10 bullets)

1. **Keep a hybrid, not a swarm.** Switchboard is a *governed operating system*, not a chat
   room of agents. The right model is **orchestration-where-it-mutates** (every cross-agent
   action is an Alex/cron-initiated *governed child WorkUnit* through `PlatformIngress.submit()`)
   plus **choreography/blackboard-where-it-reads** (Riley reads CRM + `ConversionRecord` that
   Alex's bookings produce). This is exactly what the codebase already half-implements; the
   doctrine forbids the alternative (no mutating bypass paths).

2. **There is exactly ONE true governed agent→agent handoff today: `Alex → Mira` (delegation
   v1, draft-only).** It is genuinely wired end-to-end (`delegate` tool → `ChildWorkSubmitter`
   port → `submitChildWork` → `PlatformIngress.submit({intent:"creative.concept.draft"})` →
   governed workflow). Build the rest of the synergy fabric **on this primitive**, not beside it.

3. **The Mira "push-to-ad" hinge exists but is Mira → *Meta Ads Manager*, not Mira → Riley, and
   it cannot complete today.** `creative.job.publish` (#830) is wired + correctly governed
   (mandatory human approval; activation structurally unreachable), but it is **producer-blocked**:
   nothing sets `durableAssetUrl` and nothing sets the Meta Page id, so `assertPublishable`
   fails closed at the route (422) — the loop's most valuable edge is *built-but-inert*.

4. **`Riley ↔ Alex` is not a handoff and should not become one — it is shared-data coupling, and
   that's correct.** Alex's `calendar-book` stamps a `booked` event → `ConversionBus` →
   `ConversionRecord` (which Riley reads for trueROAS via the `BookedValueByCampaignProvider`
   port) and → Meta CAPI. Model this edge as a **contract over the event/record schema**, never
   as an ingress handoff (reads are not governed mutations — routing them through ingress would
   violate the read-only route class).

5. **`Riley → Mira` and `Riley → Alex` handoffs do not exist in code** — the lever-routing
   "HANDOFF→Mira / HANDOFF→Alex" tree is *design-only* (zero `HANDOFF` tokens in
   `packages/ad-optimizer/src`; `refresh_creative`/`add_creative` are advisory recommendation
   types with `externalEffect:false`). Today a human reads Riley's advice and briefs Mira/Alex.

6. **Only Alex can *initiate* a handoff.** Alex is the **only** LLM tool-calling agent loaded
   into `SkillMode` (`skill-mode.ts:124-127`). Riley is a deterministic weekly cron
   (`packages/ad-optimizer`); Mira is an async pipeline + cockpit (`packages/creative-pipeline`)
   with **no persona/manifest/system prompt** ("no brain"). Riley/Mira can only be *targets* of a
   handoff or *producers/consumers* of shared data — they have no decision loop to *send* one.
   Any "Riley-initiated" / "Mira-initiated" handoff must therefore be a **cron/route-initiated
   system submit**, not an agent decision.

7. **Define synergy as three contract-first seams, then build to the seam.** (i) `Alex→Mira`:
   `creative.concept.draft` (exists — extend with reschedule/value context). (ii)
   `Mira→Ads`: `creative.job.publish` (exists — *unblock the producers*, then optionally add a
   `Riley`-visible record). (iii) `Riley→{Mira,Alex}`: a new **advisory→action handoff**
   (`adoptimizer.recommendation.handoff`) that turns a Riley `refresh_creative` recommendation
   into a *governed, human-approved* Mira brief (and a `lead_quality` finding into an Alex note).

8. **Every cross-agent edge must obey the four governance facts** (proven in §3): it flows
   through `PlatformIngress.submit()`; it re-runs `GovernanceGate.evaluate()` on the child; a
   **system/cron-initiated** submit must use the seeded `{id:"system",type:"system"}` principal
   (or `loadIdentitySpec` throws → hard-deny with empty `outputs:{}`); and it carries a
   **deterministic idempotency key** (the delegate tool already does — `delegate:<parentWUID>:…`).

9. **Sequence: unblock the hinge first, then wire advisory→action, then close the loop.** Lowest
   *new-risk* edge = extend `Alex→Mira` (the primitive already exists). **Highest *value* =
   unblock `Mira→Ads`** (the durable-asset + page-id producers are the single biggest synergy
   ROI in the repo — a fully-built, governed publish path that simply never fires). The
   "closed loop" (Mira publishes → Riley optimizes the live ad → economic truth flows back to
   both) only closes once `metaAdId`/`metaVideoId` are joined to Riley's per-creative attribution.

10. **The systemic risk to design against is the repo's own pattern: built-but-unwired + evals
    blind to the live seam.** Three of the "synergy" edges here are some flavor of inert
    (publish producer-blocked; Riley→agent handoffs design-only; resume-on-event unbuilt). Every
    new handoff PR must ship its **producer in the same PR** and include a **live-path
    integration test that drives the real ingress→governance→workflow seam** (not a spy/`[]`-hook
    eval), or it will green-light an edge that never executes in production.

---

## 2. Current-state audit

### 2.0 Ground-truth & the staleness hazard (read first)

- **Authoritative state read at `origin/main` = `ae7fb758` (#835)** via the worktree
  `.claude/worktrees/agent-a24f5a57060afcaaf` (its branch `worktree-agent-…` is at `ae7fb758`).
- The **main repo checkout** (`/Users/jasonli/switchboard`) is on `docs/production-env-checklist`
  @ `d2ad7e87`, whose history tops out at `1b165d63 (#781)` — i.e. **pre-#819/#828/#829/#830/#835**.
  Commit `7be3d5c7` (#830, publish) is **NOT an ancestor of `d2ad7e87`** but **IS** in
  `origin/main` (`git merge-base --is-ancestor 7be3d5c7 origin/main` → true). Reading product
  files from the main checkout shows #830 "absent" — a false negative. **This is the same
  class of trap the prompt warns about (verify vs the LIVE main, in the right worktree).**

### 2.1 Per-agent definition, manifest/identity, emits, consumes

| Agent | What it *is* in code | Identity / manifest | Initiates handoffs? |
| --- | --- | --- | --- |
| **Alex** | LLM tool-calling **skill** loaded into `SkillMode`. The **only** agent in the skill runtime. | `skills/alex/SKILL.md` (real persona + tools incl. `delegate`); builder `packages/core/src/skill-runtime/builders/alex.ts`; loaded at `apps/api/src/bootstrap/skill-mode.ts:124-127`. Registry row `AGENT_REGISTRY.alex` (`packages/schemas/src/agents.ts:4`, `role:"lead-to-speed"`). | **YES** — `delegate.creative_concept` → Mira. |
| **Riley** | Deterministic **weekly cron** over Meta insights → advisory recommendations. **No LLM loop.** | `packages/ad-optimizer` (engine: `audit-runner.ts`, `recommendation-engine.ts`, sink `recommendation-sink.ts`). Registry `AGENT_REGISTRY.riley` (`agents.ts:13`, `role:"ad-optimizer"`). A skill builder exists (`builders/ad-optimizer.ts`) **but is NOT registered in SkillMode** → no conversational Riley (any chat = `SKILL_NOT_FOUND`). | **NO** — has no decision loop / no `delegate` tool. |
| **Mira** | Async **creative pipeline** (Inngest jobs) + a real `/mira` cockpit. **No persona/manifest/system prompt** ("no brain"). | `packages/creative-pipeline` (jobs); cockpit `apps/dashboard` `/mira`; read model `MiraCreativeReadModel`. Registry `AGENT_REGISTRY.mira` (`agents.ts:20`, `role:"creative"`, `launchTier:"day-thirty"`, opt-in). `grep` for a Mira persona/manifest/builder → **empty**. | **NO** — not an agent in the runtime sense; it is a job pipeline + a cockpit. |

**Emits / consumes (the data substrate that *is* the real synergy fabric):**

- **Alex emits**: a `booked` conversion event (with `sourceCampaignId`, `sourceAdId`,
  `value` in **cents**, `currency`, attribution) stamped at `calendar-book` and published via
  the outbox → `ConversionBus` (`packages/core/src/events/conversion-bus.ts`). Alex also emits a
  governed child WorkUnit when it calls `delegate` (the Alex→Mira edge).
- **`ConversionBus` fans out** (`apps/api/src/bootstrap/conversion-bus-bootstrap.ts:43-87`) to:
  (1) `ConversionRecordStore.record()` (durable per-event row), and (2) `MetaCAPIDispatcher`
  (sends the conversion to Meta's Conversions API so Meta's optimizer learns) — env-gated on
  `META_PIXEL_ID` + `META_CAPI_ACCESS_TOKEN`.
- **Riley consumes**: per-campaign **booked value** from `ConversionRecord` via the
  `BookedValueByCampaignProvider` port (`packages/ad-optimizer/src/audit-runner.ts:100`), wired
  to `PrismaConversionRecordStore` at `apps/api/src/bootstrap/inngest.ts:234`. Riley also reads
  CRM funnel data (`RealCrmDataProvider`) and Meta insights. Riley **emits** advisory
  recommendations (persisted via `recommendation-sink.ts`; read by the dashboard).
- **Mira consumes**: a `creative.concept.draft` brief from Alex (the delegation target) and a
  `creative.job.submit/continue/stop/publish` lifecycle from the operator. Mira **emits**:
  rendered creative assets + (on publish) a **paused Meta draft package** (`metaAdId`, …) — but
  these `metaAdId`/`metaVideoId` fields are **not yet joined back to Riley's attribution**.

### 2.2 Per-edge audit — wired / stubbed / dead (with proof)

#### Edge A — `Alex → Mira` (creative concept draft): **WIRED & LIVE (draft-only).**

Verified end-to-end on the live path:

- **Tool**: `createDelegateToolFactory` — `packages/core/src/skill-runtime/tools/delegate.ts:40`.
  One operation per allowlisted target (`creative_concept`); `effectCategory:"propose"`; depth
  guard (`maxDepth=1`, refuses at `delegate.ts:54`); refuses if no `ctx.workUnitId`
  (`:60`); builds a **deterministic idempotency key**
  `delegate:${workUnitId}:${intent}:${hash(params)}` (`:74`); maps the child's outcome carefully
  (`failed`→`fail`, `pending_approval`→`pendingApproval`, only `completed`/`queued`→`ok`)
  so Alex never lies to the lead (`:87-112`).
- **Port**: `ChildWorkSubmitter` — `packages/core/src/skill-runtime/delegation-port.ts:24`
  (self-contained, no `platform` import → no Layer-3→Layer-5 cycle). One operation per
  `DelegationTarget` = the allowlist by construction.
- **Adapter**: `createChildWorkSubmitter` / `toDelegationResult` —
  `apps/api/src/bootstrap/delegation-submitter.ts:17,44` (maps `SubmitWorkResponse` 3-arm union;
  *executed-but-failed* (e.g. governance deny) → `ok:false` so it is reported as a failure).
- **Submit**: `createSubmitChildWork` — `apps/api/src/bootstrap/contained-workflows.ts:37` →
  resolves the child's deployment by intent, then `platformIngress.submit({trigger:"internal", …})`.
- **Target**: `CREATIVE_CONCEPT_TARGET` — `apps/api/src/bootstrap/delegation-targets.ts:7`
  (`operation:"creative_concept"`, `intent:"creative.concept.draft"`, typed brief
  productDescription/targetAudience).
- **Workflow**: `buildCreativeConceptDraftWorkflow` —
  `apps/api/src/services/workflows/creative-concept-draft-workflow.ts:52`. **Draft-only is
  structural**: the module never imports `@switchboard/creative-pipeline` and there is **no
  `inngestClient.send`** (`:140` comment: "NO inngestClient.send — draft-only, no spend").
  Gated on Mira enablement (`:59-67`, graceful skip). Fail-closed on missing/cross-org
  deployment (`:73-104`, `DEPLOYMENT_NOT_FOUND`).
- **Registration**: intent registered in `contained-workflows.ts:207-213`
  (`budgetClass:"cheap"`, `approvalPolicy:"none"`, `approvalMode:"system_auto_approved"`,
  `allowedTriggers:["internal"]`). Handler in the `handlers` map (`:156`).
- **Enabled in prod**: `app.ts:482` builds `childWorkSubmitter` (late-bound) and passes it to
  `bootstrapSkillMode` (`app.ts:495`); the tool is registered when present
  (`skill-mode.ts:271,331,348`). `skills/alex/SKILL.md:61` lists `delegate`; lines 319-321 give
  the "Handing off to Mira" guidance.

**Verdict on the delegation-v1 claims (prompt asked to confirm/refute):** **CONFIRMED.** The
`delegate` tool, the governed-child-WorkUnit mechanism, draft-only Alex→Mira, the depth guard,
the allowlist, and the system-principal/`system_auto_approved` reasoning are all present exactly
as the spec (`docs/superpowers/specs/2026-05-29-agent-handoff-design.md`) describes. The one live
prerequisite — a seeded `skillSlug="creative"` AgentDeployment — is satisfied for `org_dev` by
`seedMiraCreativeDeployment` (and only `org_dev`; pilot-org enablement remains a separate
workstream).

#### Edge B — `Mira → "push-to-ad"` (creative.job.publish, #830): **WIRED + GOVERNED, but a Mira→Meta-Ads-Manager edge (NOT Mira→Riley) and PRODUCER-BLOCKED / INERT end-to-end.**

The prompt's lead said this is "DEAD CODE." **Corrected:** it is *shipped and wired*, but it
**cannot complete today** and it does **not** hand off to Riley.

- **Route**: `POST /api/marketplace/creative-jobs/:id/publish` —
  `apps/api/src/routes/creative-pipeline.ts:267` (mounted `bootstrap/routes.ts:219`). Pre-flights
  via `assertPublishable` (immediate 4xx so a doomed publish never parks), then
  `platformIngress.submit({intent:"creative.job.publish", trigger:"api"})` (`:286`).
- **Workflow**: `buildCreativePublishWorkflow` —
  `apps/api/src/services/workflows/creative-publish-workflow.ts:51`. Builds a **self-contained
  PAUSED Meta package** (uploadCreativeAsset → createDraftCampaign → createDraftAdSet →
  createAdCreative → createAd), **idempotent/checkpointed** (each `metaXId` persisted; retry
  reuses it — `:67-78,95-138`). Persists `metaPublishStatus:"parked_paused"`.
- **Meta client methods exist** (refuting "the methods don't exist"):
  `MetaAdsClient.createAdCreative` (`packages/ad-optimizer/src/meta-ads-client.ts:266`) and
  `createAd` (`:289`), plus pre-existing `createDraftCampaign`/`createDraftAdSet`/
  `uploadCreativeAsset`.
- **Activation is structurally unreachable** (the safety property holds):
  `updateCampaignStatus("ACTIVE")` still hard-throws (`meta-ads-client.ts:174-179`) and is
  **never called**; `createAd` is PAUSED-only. Nothing named `activate`/`goLive` touches the
  campaign. Human activates in Ads Manager.
- **Governance is correct**: the seed installs an org-scoped `creative.job.*` **allow** policy
  AND a `require_approval(mandatory)` policy matching **only** `creative.job.publish`
  (`packages/db/src/seed/seed-mira-creative-deployment.ts:74-87`; tested
  `creative-governance.test.ts:8`). So publish **always parks for a human** — the route's 202
  `PENDING_APPROVAL` is the happy path.

**Why it is INERT (the built-but-unwired finding):**

- **No `durableAssetUrl` producer.** Every reference to `durableAssetUrl` is a *reader* or a
  schema field declaration — `creative-publish-preconditions.ts:67,105`,
  `creative-publish-workflow.ts:93`, and `packages/schemas/src/creative-job.ts:231` whose comment
  literally says "*and durableAssetUrl by PR A*". **Nothing sets it.** → `assertPublishable`
  returns `CREATIVE_ASSET_NOT_DURABLE` (422) for every real job.
- **No Meta Page-id setter.** `assertPublishable` reads `creds.pageId` only; the comment
  marks the operator setter as **PR C** (`creative-publish-preconditions.ts:43,96`). → without
  it, `META_PAGE_NOT_CONFIGURED` (422).
- **Inline Meta chain not dead-lettered.** The publish handler calls Meta synchronously; the
  client self-rate-limits 60s/call (`RATE_LIMIT_MS = 60_000`). The spec's go-live §11 says move
  it to an Inngest dead-lettered fn before pilot traffic.

**It is not a Mira→Riley edge.** The published artifact is a *paused draft an operator finalizes
in Ads Manager*. Riley never reads `metaAdId`/`metaVideoId` (no join exists). So the "closed
loop" remains open at both this seam and the learn-back seam.

#### Edge C — `Mira → Riley` (agent-to-agent): **DOES NOT EXIST.**

No code connects a Mira-published ad to Riley. `grep` for any Mira→Riley path
(`creative.job`/`creative.concept`/`notifyMira`/`miraBrief`) in `packages/ad-optimizer/src` →
**empty**. The would-be join key (`CreativeJob.metaVideoId` ↔ Riley's per-creative attribution)
is unbuilt; Riley's `creative-analyzer` ranks by `video_id` only for ads *already on Meta*, and
attribution is account/pixel-grained (no creative id), per the Mira audit. **This is the missing
"learn" edge of the closed loop.**

#### Edge D — `Riley → Alex` / `Alex → Riley` (economic truth): **NOT a handoff — shared-data / blackboard coupling (correct as-is).** (as data, not handoff)

- The direction is **Alex → (CRM/ConversionRecord) → Riley** (booked value), plus **Alex →
  Meta CAPI** (the optimizer signal). Riley does **not** push anything to Alex through ingress.
- **Substrate**: `ConversionBus` (`conversion-bus.ts`), `ConversionRecord`
  (`conversion-bus-bootstrap.ts:43-51`), the `BookedValueByCampaignProvider` port
  (`audit-runner.ts:100`, wired `inngest.ts:234`). Riley's #829/#835 per-campaign target work
  *reads* this; it does not *send* a handoff.
- **Correctly *not* an ingress handoff**: reads are not governed mutations. The agent-handoff
  spec explicitly lists "read handoff through ingress" as a **non-goal** (would violate the
  read-only route class). Model this as a **schema contract**, not a `delegate` target.

#### Edge E — `Riley → {Mira, Alex}` (lever-routing handoffs from the umbrella spec): **DESIGN-ONLY, ZERO CODE.**

- `grep -n "HANDOFF\|handoff\|authorityClass\|lever.*rout"` in `packages/ad-optimizer/src` →
  **empty**. The Phase-A work shipped **advisory-only** by design (the memory: "ZERO execution
  surface — no PlatformIngress / apply_ad_action / budget-mutation").
- `refresh_creative` / `add_creative` exist as recommendation **action types**
  (`evidence-floor.ts:18,22`, `recommendation-sink.ts:126-127,146,156,207,237`,
  `recommendation-engine.ts:127`) but are tagged `financialEffect:false, externalEffect:false`
  (advisory). **No code turns a Riley `refresh_creative` into a Mira brief or an Alex note.**
  Today: a human reads the recommendation card and acts.

**Summary table:**

| Edge | Claimed | **Actual (verified `ae7fb758`)** | Evidence |
| --- | --- | --- | --- |
| Alex→Mira (concept draft) | exists, draft-only | **WIRED, live, draft-only** | delegate.ts:40; creative-concept-draft-workflow.ts:52; skill-mode.ts:271 |
| Mira→push-to-ad | **DEAD CODE** | **WIRED+governed but PRODUCER-BLOCKED/inert; Mira→Ads-Manager, not Mira→Riley** | creative-pipeline.ts:267; creative-publish-workflow.ts:51; durableAssetUrl has no producer (creative-job.ts:231) |
| Mira→Riley (agent) | (implied loop) | **DOES NOT EXIST** | no join `metaVideoId`↔attribution; grep empty |
| Riley→Alex / Alex→Riley (econ truth) | substrate #829/#835 | **shared-data coupling, NOT a handoff (correct)** | conversion-bus-bootstrap.ts:43; audit-runner.ts:100; inngest.ts:234 |
| Riley→{Mira,Alex} (lever routing) | (umbrella spec) | **DESIGN-ONLY, zero code** | no `HANDOFF` in ad-optimizer; refresh_creative externalEffect:false |

---

## 3. Invariant & governance map (how a cross-agent handoff MUST flow)

A cross-agent handoff is a **governed child WorkUnit**. The required path and who-owns-what:

```
Initiator (Alex's delegate tool  OR  a cron/route system-submit)
   │  build deterministic idempotencyKey; pick an allowlisted intent
   ▼
PlatformIngress.submit({ intent, actor, parameters, parentWorkUnitId,
                         trigger:"internal", idempotencyKey })           [DOCTRINE #1: one control plane]
   │  1. idempotency claim-first  (platform-ingress.ts:100 — replay guard, #780/D1)
   │  2. entitlement / validateTrigger  (intent.allowedTriggers must include the trigger)
   │  3. GovernanceGate.evaluate()  EXACTLY ONCE                         [DOCTRINE #4: governance runs once]
   │       • approvalMode:"system_auto_approved" short-circuits the
   │         policy step  BEFORE  loadIdentitySpec (governance-gate.ts:100 precedes :121)
   │       • else loadIdentitySpec(actor.id)  (governance-gate.ts:121)   ← the SYSTEM-PRINCIPAL BITE
   │       • → GovernanceDecision: execute | require_approval | deny
   ▼
WorkflowMode dispatch → handler (creative.concept.draft / creative.job.publish / …)
   ▼
WorkTrace persisted (one per WorkUnit, parentWorkUnitId set)            [DOCTRINE #3: one persistence truth]
```

**Who owns approval.** Approval is **lifecycle state**, not a route side-effect (DOCTRINE #2/#8).
`PlatformLifecycle.respondToApproval()` owns it; the route only returns `202 PENDING_APPROVAL`.
For a handoff, the **target intent's policy** decides: draft/no-spend → `system_auto_approved`
(auto); spend/publish → seeded `require_approval(mandatory)` policy → **always parks for a human**.
Critically, `approvalPolicy` on the IntentRegistration is **decorative** — `determineApprovalRequirement`
reads `policyApprovalOverride ?? identity.effectiveRiskTolerance[...]`, never `approvalPolicy`
(this is why #830 seeds a real `require_approval` Policy row, not just `approvalPolicy:"always"`).

**Fail-closed behavior (verified).**
- *No seeded IdentitySpec for the actor* → `loadIdentitySpec` throws → `GOVERNANCE_ERROR` →
  **deny with empty `outputs:{}`** (a silent no-op). This is the **cross-agent / system-handoff
  gotcha**: a cron/system submit **must** use the seeded `{id:"system",type:"system"}` principal
  (the `instantFormAdapter`'s `system:meta-lead-intake` works only because *that* id is seeded).
  A bespoke `system:<x>` with no IdentitySpec hard-denies. The delegate tool sidesteps this for
  the agent-actor child precisely via `system_auto_approved` (short-circuits before
  `loadIdentitySpec`).
- *Workflow intent matches no org policy* → default-deny (`policyDecision=null`). #830's seed
  fixes this with an org-scoped `creative.job.*` **allow** policy (composes with the
  `require_approval` policy because `allow` does not short-circuit; only `deny` does).
- *Missing/cross-org deployment, missing brief, missing durable asset* → handler returns
  `outcome:"failed"` with an actionable code (never a phantom success).

**Idempotency / replay (DOCTRINE #6).**
- Ingress enforces idempotency when an `idempotencyKey` + traceStore are present
  (`platform-ingress.ts:100`, claim-first). The **delegate tool always supplies one**
  (`delegate.ts:74`) → a retried Alex turn dedupes instead of double-creating a draft.
- **Gap**: the workflow intents register `idempotent:false` (`contained-workflows.ts:414`) and
  the **publish route does not pass an `idempotencyKey`** to `submit()`
  (`creative-pipeline.ts:286-293`). The file is `// @route-class: lifecycle` yet hosts three
  *mutating* ingress submits (`/creative-jobs`, `/approve`, `/publish`) — strictly
  `operator-direct`, which would require `requireIdempotencyKey`. The publish *handler* is
  internally idempotent (metaAdId checkpoints) which mitigates, but a **duplicate
  paused-package-on-double-submit** is possible pre-approval. **Recommend**: reclassify the file
  `operator-direct` + add `requireIdempotencyKey` to all three (a known, documented follow-up).

**Where the current substrate violates / skips invariants (findings):**

1. **Publish route class mismatch + missing ingress idempotency key** (above) — doctrine #6/#12.
2. **Continue/Stop fire Inngest from the workflow** (`creative-job-decision-workflow.ts:51`) —
   this is *inside* the governed workflow (post-governance), so it is **compliant**; flagged only
   because an older audit called Continue/Stop a "bypass" — that was pre-#810 and is now fixed.
3. **`system_auto_approved` is a sharp tool.** It is correct for `creative.concept.draft`
   (no-spend, no outbound) but the registry comment and the Riley audit both warn: **financial
   intents must never use it** — the gate short-circuits to `execute` *before* the #788 spend
   post-processor, bypassing spend caps. Any future Riley/Mira spend handoff must use
   `require_approval`, not `system_auto_approved`.

---

## 4. External research — state of the art in multi-agent synergy

Patterns and how leading frameworks model agent-to-agent work, cross-checked across sources.

### 4.1 Orchestration vs. choreography (the foundational axis)

From the saga/microservices literature (directly analogous to multi-agent coordination):
**orchestration** is a centralized, command-driven coordinator that "communicates the intent of
the action"; **choreography** is decentralized and event-driven — "each service publishes events
… and other services subscribe and react." Orchestration is "simpler to implement and maintain …
you can manage and monitor service interactions"; choreography "reduces coupling … increases
scalability" but makes "timeouts, retries, and other resiliency patterns" harder to apply
globally. The mainstream recommendation is **hybrid**: "simple flows handled by choreography and
complex flows handled by orchestration." Regardless of choice, **every saga must handle
atomicity at step boundaries, idempotent consumers (at-least-once delivery → steps invoked more
than once), compensation correctness, and observability.**
([AWS Prescriptive Guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/saga-choreography.html),
[Temporal](https://temporal.io/blog/to-choreograph-or-orchestrate-your-saga-that-is-the-question),
[Milan Jovanović](https://www.milanjovanovic.tech/blog/orchestration-vs-choreography))

### 4.2 The "handoff" pattern — OpenAI Agents SDK (the canonical reference)

A **handoff is represented to the LLM as a tool call** — "if there's a handoff to an agent named
`Refund Agent`, the tool would be called `transfer_to_refund_agent`." Key levers:
- **`input_type`** — a schema for the handoff's tool-call arguments; "the SDK exposes that schema
  to the model as the handoff tool's `parameters`, validates the returned JSON locally, and
  passes the parsed value to `on_handoff`." (Structured, validated handoff payloads.)
- **`on_handoff`** — a callback that fires when the handoff is invoked (e.g. kick off a fetch).
- **`input_filter`** — controls *what context* the receiving agent sees (e.g. strip tool calls).
- **`is_enabled`** — boolean *or a function*, to **dynamically enable/disable a handoff at
  runtime**.
- By default, "the new agent takes over the conversation, and gets to see the entire previous
  conversation history" — i.e. **control transfers** (the originator does not resume) unless
  filtered.
([Handoffs — OpenAI Agents SDK](https://openai.github.io/openai-agents-python/handoffs/),
[Orchestration and handoffs — OpenAI](https://developers.openai.com/api/docs/guides/agents/orchestration))

### 4.3 LangGraph — supervisor vs. swarm (orchestration vs. choreography, made concrete)

- **Supervisor**: "specialized agents … coordinated by a central supervisor … controls all
  communication flow and task delegation." "Easier to reason about: one routing node, clear
  control flow, every decision visible in traces." Cost: "central orchestration introduces
  additional round-trip overhead."
- **Swarm**: "agents dynamically hand off control to one another based on their specializations
  … direct agent-to-agent handoffs, fewer LLM calls" via `Command(goto=…, graph=Command.PARENT)`
  returned from handoff tools.
- **Guidance**: "**Start with the supervisor.** It's simpler to build, simpler to debug, and the
  routing accuracy advantage matters more than the latency penalty in most early deployments.
  Graduate to swarm when you have data showing latency is the bottleneck and your agents rarely
  misroute."
([Focused.io](https://focused.io/lab/multi-agent-orchestration-in-langgraph-supervisor-vs-swarm-tradeoffs-and-architecture),
[LangGraph Supervisor](https://reference.langchain.com/python/langgraph-supervisor),
[LangGraph Swarm](https://reference.langchain.com/python/langgraph-swarm))

### 4.4 AutoGen vs. CrewAI — dynamic conversation vs. structured pipeline

- **CrewAI** = role-based **task pipeline** with a predefined `process` (sequential/hierarchical):
  "If you can draw your workflow as a flowchart with clear handoffs, CrewAI is the better choice."
  Hierarchical mode adds a manager agent making "an extra LLM call per dispatch" — for 5 agents/8
  tasks it "can triple your LLM costs" (a second source: "30-50% additional token usage … at
  least three calls" per manager↔specialist↔manager round).
- **AutoGen** = conversational **GroupChat** where a `GroupChatManager` selects the next speaker
  — "dynamic and context-sensitive, but also harder to predict in production." Adaptively invokes
  "only the agents needed to reach a decision."
- **Takeaway**: predictable, governable business flows → structured pipeline (CrewAI-like);
  open-ended negotiation → conversation (AutoGen-like). **Both confirm that adding an
  orchestrating brain costs real tokens/latency per delegation.**
([CrewAI vs AutoGen — MyEngineeringPath](https://myengineeringpath.dev/tools/crewai-vs-autogen/),
[CrewAI Hierarchical Process docs](https://docs.crewai.com/how-to/hierarchical-process),
[CallSphere](https://callsphere.ai/blog/crewai-process-types-sequential-hierarchical-consensual-workflows))

### 4.5 Anthropic — orchestrator-workers + the multi-agent cost reality (the counterweight)

- **Workflows vs. agents**: workflows are "systems where LLMs and tools are orchestrated through
  **predefined code paths**"; agents "**dynamically direct their own processes** and tool usage."
- **Orchestrator-workers**: "a central LLM dynamically breaks down tasks, delegates them to
  worker LLMs, and synthesizes their results … well-suited for complex tasks where you can't
  predict the subtasks needed." Anthropic's research system uses this (lead agent + parallel
  subagents) and "outperformed a single Claude Opus 4 agent by 90.2%."
- **The cost / when-NOT-to**: "agents typically use about 4× more tokens than chat … multi-agent
  systems use about **15× more tokens**." And crucially: "**Some domains that require all agents
  to share the same context or involve many dependencies between agents are not a good fit for
  multi-agent systems today.**" Subagents need "**an objective, an output format, guidance on the
  tools and sources to use, and clear task boundaries**" or they "misinterpret the task." Agents
  "are stateful and errors compound" → **resumable checkpoints + retry logic**.
- **Build principle**: "**finding the simplest solution possible, and only increasing complexity
  when needed**"; invest "just as much effort in creating good **agent-computer interfaces
  (ACI)**" — clear tool definitions, descriptive parameters, **poka-yoke** (error-proofing).
([Building effective agents — Anthropic](https://www.anthropic.com/engineering/building-effective-agents),
[Multi-agent research system — Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system))

### 4.6 Contract-first interfaces & interop (A2A) — the schema-as-the-artifact idea

Google's **A2A** (Apr 2025, now Linux Foundation) is explicitly **contract-first**: a remote
agent publishes an **Agent Card** — "structured metadata … skills, usage instructions,
input/output formats, supported protocols, and authentication requirements" — which "acts as
both an advertisement and **an interface contract**." The framing worth importing: **"MCP
standardizes execution primitives, while A2A standardizes delegation between autonomous
services"** — i.e. *tools* vs. *handoffs* are different layers, and the handoff layer deserves a
**stable, typed schema** (skills, tasks, messages/parts, artifacts).
([A2A spec](https://a2a-protocol.org/v0.1.0/specification/),
[A2A survey, arXiv 2505.02279](https://arxiv.org/html/2505.02279v1),
[IBM on A2A](https://www.ibm.com/think/topics/agent2agent-protocol))

### 4.7 Synthesis — what the SOTA says for Switchboard

1. **Prefer orchestration / supervisor-style for *mutating* coordination** (clear control flow,
   visible in traces, easier governance) — which is exactly `PlatformIngress` + `WorkTrace`.
2. **Use choreography/blackboard for *read* coordination** (loose coupling, scalability) — which
   is exactly `ConversionBus` + `ConversionRecord`.
3. **Model each handoff as a typed contract** (OpenAI `input_type`, A2A Agent Card). Switchboard
   already does this per target (`DelegationTarget.inputSchema` + `mapInput`).
4. **Do NOT build a swarm or an LLM "manager" for three agents.** Anthropic's 15×-token caution +
   the LangGraph/CrewAI "start with the supervisor / sequential" guidance + this repo's own prior
   conclusion ("single-agent is right for Alex/Riley; multi-agent swarms ~15× tokens — SKIP")
   all point the same way. The synergy is **governed point-to-point handoffs + a shared event
   substrate**, not a generalized agent mesh.
5. **The biggest SOTA-aligned wins here are unglamorous**: idempotent consumers, resumable
   checkpoints (the publish handler already checkpoints; resume-on-event is the inbound twin),
   and producer-population so the contract actually carries data.

---

## 5. Recommended architecture (grounded in THIS codebase)

### 5.1 The model: governed point-to-point handoffs over a shared event substrate

- **Orchestration plane (mutations):** every cross-agent *action* is a governed child WorkUnit
  via the **existing `delegate`/`submitChildWork` primitive**. Initiators are **Alex** (LLM, via
  the `delegate` tool) and **system crons/routes** (via `createSubmitChildWork` with the seeded
  `system` principal). Targets are **intents** (`creative.concept.draft`, `creative.job.publish`,
  and the proposed `adoptimizer.recommendation.handoff`). This is the LangGraph-supervisor /
  CrewAI-sequential shape, implemented as Switchboard's one control plane.
- **Choreography plane (reads/signals):** Alex's outcomes flow as **events** (`ConversionBus`) to
  durable records that **Riley** and (future) **Mira** read. No ingress, no coupling. This is the
  blackboard.
- **Why not a swarm / LLM-orchestrator:** §4.7. Three specialized agents with mostly-independent
  jobs and a governance requirement = orchestration+blackboard, not a mesh.

### 5.2 Extend delegation-v1; do NOT build a parallel resume-on-event loop *yet*

- **Extend the primitive** (`DelegationTarget` config + one workflow per target). It already
  honors every invariant. Adding a target is "a trivial future allowlist addition" (spec §non-goals).
- **Resume-on-event stays deferred** until there is a *real event producer* (the
  safety-gate-needs-producer trap). It is the inbound twin of handoff (external event → governed
  continuation) and the substrate is ~80% built but stranded (`ScheduledTriggerRecord`
  "event_match" + `matchEvent()` with no production caller). Build it **with** a producer (e.g.
  the Mira-publish-approved event, or a payment webhook), never the seam alone. **The crux is
  identical to handoff: resume MUST re-run governance.**

### 5.3 The three handoff contracts (concrete seams)

> **Design rule for all three:** *typed input schema (no min/max — Anthropic strict tools 400 on
> them), deterministic idempotency key, explicit approval owner, fail-closed outcome codes, and a
> live-path integration test driving real ingress→governance→workflow.*

#### Contract 1 — `Alex → Mira`: `creative.concept.draft` (EXISTS — extend)

| Field | Value |
| --- | --- |
| **Input** | `{ brief: { productDescription, targetAudience, platforms?, brandVoice?, … } }` (`delegation-targets.ts`). **Extend** with `valueContext` (the lead's interest signal / estimated value) so Mira can prioritize. |
| **Approval owner** | Auto (`approvalMode:"system_auto_approved"`) — no spend, no outbound, reversible draft row. |
| **Fail-closed** | Mira-disabled → graceful skip; missing/cross-org deployment → `DEPLOYMENT_NOT_FOUND`; bad brief → `INVALID_BRIEF`. |
| **Idempotency key** | `delegate:${parentWorkUnitId}:creative.concept.draft:${hash(brief)}` (already deterministic). |
| **Invariant honor** | Through ingress; child re-runs governance; draft-only is *structural* (no creative-pipeline import). |
| **Next step** | Add a `reschedule`-style sibling later (Alex booking-lifecycle), and a `valueContext` field. No new mechanism. |

#### Contract 2 — `Mira → Ads` (publish): `creative.job.publish` (EXISTS — **unblock producers**)

| Field | Value |
| --- | --- |
| **Input** | `{ jobId }` — handler resolves everything else from the persisted job + connection (`creative-publish-workflow.ts:54`). |
| **Approval owner** | **Mandatory human** (seeded `require_approval(mandatory)` policy matching only `creative.job.publish`). Always parks. |
| **Fail-closed** | `assertPublishable` → `CREATIVE_JOB_NOT_FOUND` / `CREATIVE_NOT_PUBLISHABLE` / `CREATIVE_ASSET_NOT_DURABLE` / `META_CONNECTION_NOT_FOUND` / `META_PAGE_NOT_CONFIGURED`; mid-chain Meta fail → `CREATIVE_PUBLISH_META_ERROR`; job-vanish race → `CREATIVE_JOB_NOT_FOUND`. |
| **Idempotency key** | **Handler-internal** (each `metaXId` is a checkpoint, reused on retry). **Gap**: the *route* passes no ingress key — add one (`publish:${jobId}`) + reclassify the route `operator-direct`. |
| **Invariant honor** | Through ingress; mandatory approval; **activation structurally unreachable** (createAd PAUSED-only; `updateCampaignStatus("ACTIVE")` throws, never called). |
| **Blockers to make it real (in priority order)** | **(B1)** a `durableAssetUrl` **producer** (PR A); **(B2)** an operator **Page-id setter** (PR C); **(B3)** move the inline Meta chain to a **dead-lettered Inngest fn**. Until B1+B2 land, this contract is **inert** (every publish 422s at the route). |

#### Contract 3 — `Riley → {Mira, Alex}`: `adoptimizer.recommendation.handoff` (NEW)

The missing advisory→action seam. Riley's weekly cron already produces typed recommendations;
turn the *creative* ones into a **governed Mira brief** and the *lead-quality* ones into an
**Alex note**, with a human in the loop.

| Field | Value |
| --- | --- |
| **Initiator** | The Riley **cron** (system), NOT an LLM decision — so it **must submit with the seeded `{id:"system",type:"system"}` principal** (or `loadIdentitySpec` throws → hard-deny). |
| **Input** | `{ recommendationId, actionType: "refresh_creative" \| "add_creative" \| "lead_quality", campaignId, rationale, evidence }`. For Mira: map to a `creative.concept.draft`-shaped brief (reuse Contract 1's target). For Alex: a non-mutating note/flag (read surface), **not** an ingress mutation. |
| **Approval owner** | Mira-bound creative brief that spends → **`require_approval`** (NEVER `system_auto_approved` for any spend path — see §3 finding 3). A no-spend draft → can auto. The Alex-note variant is read-only (no governance). |
| **Fail-closed** | If the recommendation is below Riley's evidence floor (`evidence-floor.ts`) or `resetsLearning:yes`, **do not hand off** (abstain). Target agent disabled → graceful skip. |
| **Idempotency key** | `handoff:riley:${recommendationId}:${actionType}` (one handoff per recommendation). |
| **Invariant honor** | Through ingress; child re-runs governance; cron uses the system principal; advisory-only Riley stays advisory until a human approves the resulting Mira/Alex action. |
| **Why it's safe** | It does **not** give Riley execution authority over budgets — it routes a *creative/lead* recommendation to the agent that *can* act on it, still gated by that agent's approval policy. Riley's own ad mutations remain a *separate, later* Phase-C concern (with #788 spend caps). |

### 5.4 The closed loop (target end-state, after the contracts land)

```
Alex (qualifies lead) ──delegate──▶ Mira (concept draft)
Riley (weekly, sees creative fatigue) ──recommendation.handoff──▶ Mira (governed brief, human-approved)
Mira (renders, human keeps) ──creative.job.publish (mandatory approval)──▶ PAUSED Meta draft (metaAdId…)
Human activates in Ads Manager ──▶ live ad
Live ad spends ──▶ Meta insights ──▶ Riley reads (per-creative attribution via metaVideoId)   ← B-side learn edge (Edge C, to build)
Lead books with Alex ──booked event──▶ ConversionRecord ──▶ Riley trueROAS (per campaign)      ← already wired (Edge D)
Riley judges each creative/campaign on booked-CAC/trueROAS ──▶ next recommendation.handoff      ← closes the loop
```

The loop closes when **(a)** Contract 2's producers are unblocked, **(b)** Contract 3 exists, and
**(c)** the **`metaVideoId` ↔ Riley per-creative attribution join (Edge C)** is built. Until then,
the loop is open at the publish-producer seam and the learn-back seam.

---

## 6. Sequencing & risk

### 6.1 The "build against the contract/seam, not the agent internals" rule

This is the load-bearing parallelism rule. Each of the three contracts is a **typed intent +
input schema** at the `PlatformIngress` boundary. As long as a workstream targets *the contract*,
the agents' internals can evolve independently:

- **Alex's** persona / model-router / booking-lifecycle work changes Alex's *internals* but not
  the `creative.concept.draft` *intent shape* → Mira work and Alex work don't collide.
- **Mira's** P0-de-stub / real-QA / avatar-UGC work changes how a `CreativeJob` is *produced* but
  not the `creative.job.publish` *intent* → publish-producer work (B1/B2) and Mira-quality work
  proceed in parallel.
- **Riley's** engine/eval/attribution work changes *how recommendations are computed* but not the
  `adoptimizer.recommendation.handoff` *intent* → Riley-brain work and the handoff seam don't
  collide.

**Operationally**: a handoff PR touches only (i) the intent registration in
`contained-workflows.ts`, (ii) one workflow file, (iii) a `DelegationTarget` (if Alex-initiated)
or a cron submit (if system-initiated), and (iv) a live-path test. It does **not** touch
`builders/alex.ts`, the creative pipeline internals, or `audit-runner.ts`. This is why the
contracts are the right unit of work in a repo with many concurrent agent sessions.

### 6.2 Which edge to wire first

| Priority | Edge | Why | Risk |
| --- | --- | --- | --- |
| **1 (do now)** | **Unblock Contract 2 producers (B1 durable asset, B2 page-id)** | **Highest value, lowest *new design***. The entire governed publish path is *already built and reviewed* — it is one `durableAssetUrl` producer + one operator page-id setter away from being a live, human-gated Mira→ad capability. This is the closest thing to "free synergy" in the repo. | Low-design / medium-integration. Needs R2 (or equivalent) durable storage + a settings form. Each is its own small PR; ship the producer in the SAME PR as any gate. |
| **2** | **Harden Contract 1 (Alex→Mira)** — add `valueContext`, fix the route idempotency-class debt on the publish/approve/submit routes | Lowest *new* risk: the primitive exists; this is additive. Folds in the doctrine-#6 idempotency-key + `operator-direct` reclassification. | Very low. |
| **3** | **Build Contract 3 (`adoptimizer.recommendation.handoff`)** | Turns Riley's advisory output into governed action — the first real "Riley participates in synergy" step. **Must** use the system principal + human approval for any spend. | Medium. The governance footguns (system-principal, no `system_auto_approved` for spend, evidence-floor abstention) are well-understood and documented here. |
| **4 (later)** | **Edge C learn-back** (`metaVideoId` ↔ per-creative attribution) + **resume-on-event** | Closes the loop. Both are gated on real producers (live Meta ad ids; a real event producer). | Higher; defer until 1-3 land and Meta gates clear. |

**Confirmation of the prompt's hypothesis:** "lowest-risk = extend Alex→Mira" — **agreed** (it's
Priority 2; the primitive exists, additive). "highest-value = Mira→Riley push-to-ad hinge" —
**refined**: the highest-value *edge* is the **Mira→Ads publish hinge** (Priority 1), but it is a
Mira→Ads-Manager edge, and its value is unlocked by **unblocking its producers**, not by writing
new push-to-ad code (that code is done). The true *Mira→Riley* edge (Edge C) is Priority 4.

### 6.3 Risks

1. **Built-but-unwired / eval-blind-to-live-seam (the systemic repo risk).** Three "synergy"
   edges are inert (publish producer-blocked; Riley→agent handoffs design-only; resume-on-event
   unbuilt). Green unit tests / spy-ingress tests **cannot see** these gaps (the publish gate
   default-denied through the real GovernanceGate and #810's spy tests missed it until the seed
   allow-policy was added). **Mitigation**: every handoff PR ships its producer in the same PR
   and includes a **live-path integration test** that drives the real
   `PlatformIngress→GovernanceGate→Workflow` seam with the **real seeded policies/principal**
   (the `creative-publish-gate.test.ts` pattern), not a mocked ingress or `[]` hooks.

2. **Contract drift.** If a handoff's input schema is redeclared per-app, the seams silently
   corrupt (DOCTRINE #11). **Mitigation**: keep every handoff payload type in
   `@switchboard/schemas`; the `DelegationTarget.inputSchema` is the single source; mirror it in
   any consumer test via the schema, not a hand-built fixture.

3. **System-principal hard-deny (the cross-agent bite).** A cron/system-initiated handoff with a
   bespoke actor id silently no-ops (`loadIdentitySpec` throws → empty `outputs:{}`).
   **Mitigation**: every system submit uses `{id:"system",type:"system"}`; assert it in the test.

4. **`system_auto_approved` on a spend path.** It short-circuits before the #788 spend
   post-processor → bypasses spend caps. **Mitigation**: forbid `system_auto_approved` for any
   intent that carries a spend/budget key; use a seeded `require_approval(mandatory)` policy
   instead (the publish pattern).

5. **Idempotency at the publish/approve/submit routes** (doctrine #6). Pre-approval double-submit
   could create duplicate work. **Mitigation**: add `requireIdempotencyKey` + reclassify the
   route `operator-direct` (the handler's metaAdId checkpoints already mitigate the worst case).

6. **Mira/Riley have no decision loop.** Any "Riley/Mira initiates X" feature is really a
   cron/route system-submit — do not design as if they can *decide* to hand off. (Mira's P4
   "actual agent" is a separate, large initiative.)

### 6.4 Concrete next-PR list

1. **PR-A — Durable asset producer (Mira publish B1).** Produce `durableAssetUrl` (R2 or
   equivalent) when a `CreativeJob` completes; fail-loud `CREATIVE_ASSET_NOT_DURABLE` stays until
   it lands. *Ship the producer + a live publish-precondition test together.* (Unblocks Contract 2.)
2. **PR-B — Operator Meta Page-id setter (Mira publish B2).** A `control-plane` settings write
   that stores `pageId` on the Meta connection; `assertPublishable` already reads it. (Unblocks
   Contract 2.) After A+B, a real org can publish a paused draft end-to-end (human-approved).
3. **PR-C — Publish route hardening.** Reclassify `routes/creative-pipeline.ts` →
   `operator-direct`; add `requireIdempotencyKey` to `/creative-jobs`, `/approve`, `/publish`;
   pass an ingress `idempotencyKey`. (Closes the doctrine-#6 gap; additive to Contract 1/2.)
4. **PR-D — Move the publish Meta chain to a dead-lettered Inngest fn (B3).** Before any pilot
   traffic. (Resilience for Contract 2.)
5. **PR-E — `adoptimizer.recommendation.handoff` (Contract 3).** New intent + workflow that maps
   a Riley `refresh_creative` recommendation to a governed Mira brief (human-approved) and a
   `lead_quality` finding to an Alex read-note. **System principal; no `system_auto_approved` on
   the spend path; evidence-floor/reset-class abstention.** Live-path test against the real gate.
6. **PR-F (later) — Edge C learn-back join.** `CreativeJob.metaVideoId` → `AssetRecord` → Riley
   per-creative ROAS → `pastPerformance`. Gated on real Meta ad ids (i.e. after A-D and Meta
   gates). This is what finally *closes the loop*.
7. **PR-G (later) — resume-on-event** (inbound twin of handoff), built **with** a real event
   producer (e.g. the publish-approved event), re-running governance on resume.

---

## Appendix — evidence index (file:line, verified at `ae7fb758`)

- **Alex→Mira (Edge A)**: `packages/core/src/skill-runtime/tools/delegate.ts:40,54,60,74,87`;
  `packages/core/src/skill-runtime/delegation-port.ts:24`;
  `apps/api/src/bootstrap/delegation-submitter.ts:17,44`;
  `apps/api/src/bootstrap/delegation-targets.ts:7`;
  `apps/api/src/bootstrap/contained-workflows.ts:37,156,207-213`;
  `apps/api/src/services/workflows/creative-concept-draft-workflow.ts:52,59,73,140`;
  `apps/api/src/bootstrap/skill-mode.ts:124-127,271,331,348`;
  `apps/api/src/app.ts:482,495`; `skills/alex/SKILL.md:61,319`.
- **Mira→Ads publish (Edge B)**: `apps/api/src/routes/creative-pipeline.ts:1,267,286`;
  `apps/api/src/bootstrap/routes.ts:219`;
  `apps/api/src/services/workflows/creative-publish-workflow.ts:51,67,93,128`;
  `apps/api/src/services/creative-publish-preconditions.ts:43,67,96,105`;
  `packages/ad-optimizer/src/meta-ads-client.ts:147,160,174,266,289`;
  `packages/schemas/src/creative-job.ts:231`;
  `packages/db/src/seed/seed-mira-creative-deployment.ts:74-87`.
- **Mira→Riley (Edge C, absent)**: no `metaVideoId`↔attribution join; grep empty in
  `packages/ad-optimizer/src` for `creative.job`/`creative.concept`/`notifyMira`.
- **Riley↔Alex data (Edge D)**: `packages/core/src/events/conversion-bus.ts`;
  `apps/api/src/bootstrap/conversion-bus-bootstrap.ts:43-87`;
  `packages/ad-optimizer/src/audit-runner.ts:100`; `apps/api/src/bootstrap/inngest.ts:234`.
- **Riley lever-routing (Edge E, design-only)**: no `HANDOFF` in `packages/ad-optimizer/src`;
  `packages/ad-optimizer/src/recommendation-sink.ts:126-127,146,156`;
  `packages/ad-optimizer/src/evidence-floor.ts:18,22`.
- **Governance mechanics**: `packages/core/src/platform/platform-ingress.ts:100`;
  `packages/core/src/platform/governance/governance-gate.ts:100,121`;
  `apps/api/src/bootstrap/contained-workflows.ts:414` (`idempotent:false`).
- **Agent identities**: `packages/schemas/src/agents.ts:4,13,20`;
  `apps/api/src/bootstrap/skill-mode.ts:124-127` (only Alex loaded).

## Appendix — external sources

- OpenAI Agents SDK — Handoffs: https://openai.github.io/openai-agents-python/handoffs/
- OpenAI — Orchestration and handoffs: https://developers.openai.com/api/docs/guides/agents/orchestration
- Anthropic — Building effective agents: https://www.anthropic.com/engineering/building-effective-agents
- Anthropic — How we built our multi-agent research system: https://www.anthropic.com/engineering/multi-agent-research-system
- LangGraph supervisor vs swarm (Focused.io): https://focused.io/lab/multi-agent-orchestration-in-langgraph-supervisor-vs-swarm-tradeoffs-and-architecture
- LangGraph Supervisor (ref): https://reference.langchain.com/python/langgraph-supervisor — Swarm (ref): https://reference.langchain.com/python/langgraph-swarm
- CrewAI vs AutoGen (MyEngineeringPath): https://myengineeringpath.dev/tools/crewai-vs-autogen/ — CrewAI Hierarchical Process: https://docs.crewai.com/how-to/hierarchical-process
- Saga orchestration vs choreography — AWS Prescriptive Guidance: https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/saga-choreography.html — Temporal: https://temporal.io/blog/to-choreograph-or-orchestrate-your-saga-that-is-the-question — Milan Jovanović: https://www.milanjovanovic.tech/blog/orchestration-vs-choreography
- A2A protocol spec: https://a2a-protocol.org/v0.1.0/specification/ — A2A survey (arXiv 2505.02279): https://arxiv.org/html/2505.02279v1 — IBM on A2A: https://www.ibm.com/think/topics/agent2agent-protocol
