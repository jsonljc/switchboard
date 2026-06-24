## Provenance, source counting, attribution tiers & WorkTrace lineage

This pillar is about a single hard question that every AI-driven revenue platform eventually has to answer in court, in a compliance review, or in an analytics dashboard: **"who did what, on whose behalf, and what did it cause?"** When an LLM agent can pause an ad campaign, message a lead, or book a treatment, you cannot trust the model's own narration of what happened. You need a tamper-evident, server-authored record of every governed action, and you need a chain that links that action to a real customer, a real conversation, and ultimately a real dollar. Switchboard builds this out of four interlocking ideas: an immutable audit row (`WorkTrace`), server-resolved lineage fields welded onto it, a confidence ladder for revenue evidence, and a memory layer that counts corroborating sources before it trusts a fact. Below, each concept is taught from the general principle down to the exact code.

---

### WorkTrace: the canonical immutable audit row

**Concept.** In event-sourced and audit-heavy systems, you separate the _mutation_ (book the appointment) from the _record of the mutation_ (a row describing the decision, the actor, the outcome). The record is append-mostly and eventually sealed, so it can serve as evidence even if the underlying domain data later changes. This is the "custody of proof" pattern: the proof document is a first-class artifact, not a log line.

**In Switchboard.** A `WorkTrace` is the row recording one work-unit submission from governance through completion. Its shape lives at [`packages/core/src/platform/work-trace.ts:6-109`](../../../../packages/core/src/platform/work-trace.ts). It captures three things at once: the governance decision (`governanceOutcome`, `riskScore`, `matchedPolicies`), the execution result (`outcome`, `executionSummary`, `executionOutputs`, `durationMs`), and lineage (`workUnitId`, `traceId`, `parentWorkUnitId`, `contactId`, `conversationThreadId`).

The producer is `buildWorkTrace()` in [`work-trace-recorder.ts:66-122`](../../../../packages/core/src/platform/work-trace-recorder.ts), which derives the row's outcome from whether execution happened yet:

```ts
let outcome: WorkTrace["outcome"];
if (executionResult) {
  outcome = executionResult.outcome;
} else if (governanceDecision.outcome === "deny") {
  outcome = "failed";
} else {
  outcome = "pending_approval";
}
```

The orchestrator is `IngressTracePersister` ([`ingress-trace-persister.ts:59-90`](../../../../packages/core/src/platform/ingress-trace-persister.ts)). Note a subtlety the mapping under-stated: there is a **claim-first** path. Before the domain mutation runs, `claimIdempotency()` persists a `running` trace (built by `buildClaimTrace`) as a concurrency lock keyed on `(organizationId, idempotencyKey)`. After execution, `finalizeTrace()` updates that same row to its terminal outcome. The persister never throws; on terminal failure it emits exactly one infrastructure-failure audit plus one operator alert, then leaves the `running` claim in place so a retry fails closed.

**How it's used at runtime.** Inbound message arrives at a channel adapter, becomes a `WorkUnit`, and enters `PlatformIngress.submit()`. Ingress evaluates governance, calls `claimIdempotency()` (claim the key, persist `running`), dispatches the tool, then `finalizeTrace()` to seal the outcome. The store also writes an `audit.record({ eventType: "work_trace.persisted" })` inside the **same** Prisma transaction ([`prisma-work-trace-store.ts:52-90`](../../../../packages/db/src/stores/prisma-work-trace-store.ts)), so the audit anchor and the row can never diverge.

**Gotchas / what to study next.** (1) `update()` returns two different shapes by environment: a locked row returns `{ ok: false, code: "WORK_TRACE_LOCKED" }` in prod but throws `WorkTraceLockedError` in non-prod tests. Every consumer must handle both. (2) `persist()` deliberately swallows the unique-constraint error _only when_ `idempotencyKey` is set (line 92); `claim()` must not, because that void is its concurrency signal.

---

### Lineage chain-weld: `contactId` and `conversationThreadId`

**Concept.** To trace "which action caused which revenue," you need stable join keys that do not depend on the LLM. The trap is letting the model supply identity ("this is for customer Alice") because a hallucinated id corrupts your entire revenue ledger. The fix: resolve identity _server-side_ from request context, then weld it onto the audit row as an index, not as part of the integrity hash.

**In Switchboard.** `contactId` and `conversationThreadId` are the Spec-1A "chain weld." They flow `WorkUnit.contactId` -> `buildWorkTrace()` at [`work-trace-recorder.ts:119-120`](../../../../packages/core/src/platform/work-trace-recorder.ts) -> the Prisma row. Crucially they are **excluded from the content hash** at [`work-trace-hash.ts:23-29`](../../../../packages/core/src/platform/work-trace-hash.ts):

```ts
// Spec-1A chain weld: lineage/index columns ... Downstream-derivable from
// parameters, never the executed input. Excluded so the new nullable
// columns leave every existing row's contentHash byte-identical.
"contactId",
"conversationThreadId",
```

That exclusion is the load-bearing design choice: because lineage is derivable from `parameters`, hashing it is redundant, and excluding it means adding the columns did **not** invalidate every pre-existing row's hash (no `hashInputVersion` bump needed). They are indexed on the Prisma model for lineage queries.

**How it's used at runtime.** Revenue attribution joins `Booking.workTraceId` to `WorkTrace.workUnitId`, then reads the attached `contactId` to walk back to the conversation. This is what makes the booking-attribution resolver below possible without trusting any model output.

**Gotchas.** Anything in `EXCLUDED_BASE` (also `injectedPatternIds`, `lockedAt`, `traceVersion`, `contentHash` itself) is analytics/lineage metadata, _not_ execution integrity. When you add a new column, ask: "is this part of what was executed, or downstream-derivable from it?" Derivable means exclude.

---

### WorkTrace integrity: `contentHash`, `traceVersion`, sealed state

**Concept.** Tamper-evidence via content addressing: hash the canonical serialization of the meaningful fields; store the hash; later re-hash and compare. A monotonic version counter binds the hash to a specific revision so a stale-but-valid hash cannot be replayed.

**In Switchboard.** `computeWorkTraceContentHash()` ([`work-trace-hash.ts:96-98`](../../../../packages/core/src/platform/work-trace-hash.ts)) is `sha256(canonicalizeSync(buildWorkTraceHashInput(...)))`. The hash binds two versions: `hashVersion` (the algorithm/shape version) and `traceVersionForHash` (the row revision), the latter named distinctly so it cannot collide with the excluded `traceVersion` field. Two shapes exist: `V1` (legacy rows, pre-`ingressPath`) and `V2` (new rows include `ingressPath`), selected per-row by its own `hashInputVersion` so old rows keep verifying.

Verification is `verifyWorkTraceIntegrity()` ([`work-trace-integrity.ts:47-78`](../../../../packages/core/src/platform/work-trace-integrity.ts)). Correcting the mapping: the verdict union is **`ok | mismatch | missing_anchor | skipped`** (not `hash_mismatch | version_mismatch`). A row with `contentHash === null` but `requestedAt` before the migration cutoff returns `skipped: "pre_migration"`; one after cutoff returns `missing_anchor`. A re-hash disagreement returns `mismatch`. The anchor cross-check compares the row's hash/version against the audit-ledger snapshot:

```ts
const anchorHash = getString(anchor.snapshot, "contentHash");
const anchorVersion = getNumber(anchor.snapshot, "traceVersion");
if (anchorHash !== rowContentHash || anchorVersion !== rowTraceVersion) {
  return { status: "missing_anchor", expectedAtVersion: rowTraceVersion };
}
```

**How it's used at runtime.** `assertExecutionAdmissible()` throws `WorkTraceIntegrityError` on any non-`ok` verdict unless an explicit operator override is supplied, and the override path itself is audited at `riskCategory: "high"`. This is what lets WorkTrace serve as proof: you cannot consume a tampered row silently.

**Gotchas.** `contentHash` present but `traceVersion <= 0` is treated as `missing_anchor`, never `ok` (line 58). And canonical JSON ordering matters: the hash is over `canonicalizeSync` output, so two semantically equal objects with different key order must still hash identically.

---

### Ingress path discriminator

**Concept.** Not every audit row comes through the same door. Distinguishing the _provenance of the record itself_ lets compliance filter "rows that passed governance" from "operator side-writes" and "advisory emissions."

**In Switchboard.** `ingressPath` ([`work-trace.ts:72-75`](../../../../packages/core/src/platform/work-trace.ts)) is one of `platform_ingress` (default, passed the gate), `store_recorded_operator_mutation` (a store wrote it outside ingress, e.g. `ConversationStateStore`), or `agent_recommendation_emission` (an advisory Riley emission paired with a `Recommendation` row, _not_ a tool execution). It is part of the V2 hash input ([`work-trace-hash.ts:40`](../../../../packages/core/src/platform/work-trace-hash.ts)), which is precisely why V1 had to exclude it.

**How it's used.** "Which governance decisions touched this outcome?" filters `ingressPath = "platform_ingress"`. Advisory emissions surface separately so the operator can see what the agent _recommended_ versus what was actually _executed_ under governance.

---

### Attribution confidence tiers (revenue-proof strength)

**Concept.** Not all revenue evidence is equal. A hard ad-click id is proof; a bare channel guess is a hint. Bucketing into an ordered ladder lets downstream reporting weight or exclude weak evidence without throwing it away.

**In Switchboard.** `scoreAttribution()` ([`score-attribution.ts:28-40`](../../../../packages/core/src/receipts/score-attribution.ts)) is a precedence-ordered pure enum mapping over `AttributionEvidence`:

```ts
if (evidence.leadgenId || evidence.sourceAdId) return "deterministic";
if (
  evidence.sourceCampaignId &&
  evidence.sourceType &&
  FIRST_PARTY_SOURCE_TYPES.has(evidence.sourceType)
)
  return "high";
if (evidence.sourceCampaignId || evidence.sourceChannel) return "medium";
if (evidence.sourceType) return "low";
return "unattributed";
```

The five rungs are defined once in [`receipted-booking.ts:8-14`](../../../../packages/schemas/src/receipted-booking.ts). It is deliberately threshold-free: there are no numeric comparisons, so there is no NaN-blind gate to exploit (a recurring class of bug in this codebase, see `feedback_nan_blind_comparison_gates`).

**How it's used at runtime.** At booking-receipt issuance, `buildReceiptedBookingData()` ([`build-receipted-booking-data.ts:71`](../../../../packages/core/src/receipts/build-receipted-booking-data.ts)) calls `scoreAttribution` once and stamps the result as a **snapshot**. `unattributed` does not drop the booking; it raises a `missing_source` exception entry. The confidence is never live-recomputed; only exceptions (consent, PDPA, duplicate contact) are re-evaluated.

**Gotchas.** Snapshot semantics are the whole point: a receipt issued at confidence `high` stays `high` even if later evidence arrives, because the receipt is a point-in-time proof, not a live view. Exceptions are resolved by _stamping_ `resolvedAt`, never by deletion.

---

### Booking-backed outcome attribution (CTWA -> Alex -> work unit -> booking -> revenue)

**Concept.** To learn from outcomes, you must decide _how confidently_ a conversation caused a booking. A strong link is a direct tool-execution match; a weak link is "a booking appeared near this contact afterward." Mislabeling weak as strong poisons your learning loop.

**In Switchboard.** `resolveBookingAttribution()` ([`booking-attribution.ts:41-79`](../../../../packages/core/src/memory/booking-attribution.ts)) is two-tier. Tier 1 (`strong`) matches `Booking.workTraceId` against the conversation's executed-tool `workTraceIds`. Tier 2 (`fallback`) searches the same org+contact in the post-conversation 24h window. Otherwise `none`. The store contract mandates `createdAt ASC` ordering so "first row wins" is deterministic regardless of query plan.

**How it's used at runtime.** `ConversationCompoundingService` calls this when a conversation ends. `none` **suppresses pattern extraction entirely**, regardless of what the LLM's `summarization.outcome` claimed. `strong` enables precise pattern extraction tied to the exact tool turn.

**Gotchas.** The fallback window is post-conversation only; pre-conversation bookings are excluded because they were likely caused by an earlier touchpoint. Per-deployment scoping is intentionally _not_ enforced because neither `Booking` nor `Contact` carries a `deploymentId` today (a deliberate, documented limitation, not an oversight).

---

### Source counting with the confidence formula

**Concept.** An LLM extracting facts from one conversation is speculative. Requiring _corroboration across multiple independent sources_ before trusting a fact is the classic defense against single-shot hallucination, with a diminishing-returns curve so the tenth witness adds less than the second.

**In Switchboard.** Each `DeploymentMemory` row carries `sourceCount` (>= 1) and a `confidence` in [0,1]. The formula ([`deployment-memory.ts:79-82`](../../../../packages/schemas/src/deployment-memory.ts)) is logarithmic:

```ts
export function computeConfidenceScore(sourceCount, ownerConfirmed) {
  if (ownerConfirmed) return 1.0;
  return Math.min(0.95, 0.5 + 0.15 * Math.log(sourceCount));
}
```

So `sourceCount=1` -> 0.65, 3 -> ~0.66, 10 -> ~0.85, ceiling 0.95. Owner-confirmed jumps to a clean 1.0. The compounding service derives the new-fact constant from the formula rather than hardcoding it ([`compounding-service.ts:121-125`](../../../../packages/core/src/memory/compounding-service.ts)) so it cannot drift. Surfacing requires both `sourceCount >= 3` and `confidence >= 0.66` ([`deployment-memory.ts:85`](../../../../packages/schemas/src/deployment-memory.ts)), applied by `filterSurfaceablePatterns()` ([`outcome-pattern-extractor.ts:20-26`](../../../../packages/core/src/memory/outcome-pattern-extractor.ts)).

**How it's used.** Facts extracted from conversations only enter agent context once corroborated 3+ times. One-offs stay latent. Pilot deployments use looser thresholds (`PILOT_SURFACING_*`, source count 2) because small cohorts learn faster.

**Gotchas.** Corroboration is gated on similarity (0.92 for facts, 0.84 for outcome patterns) so two phrasings of the same fact merge instead of double-counting. And `CustomerFact` strips `sourceCount`/`confidence` before customer-facing output: the anti-regurgitation policy means the _agent_ knows the corroboration math but the customer never sees "we believe this with 0.77 confidence."

---

### Riley outcome attribution & the corroboration predicate

**Concept.** To claim an action _worked_, you compare a metric before and after over a window, then optionally check whether an _independent second estimate_ agrees. The discipline is refusing to over-claim: directional movement is not causal proof, and corroboration is agreement, not causation.

**In Switchboard.** `attributeOneRecommendation()` ([`outcome-attribution.ts:47-200`](../../../../packages/core/src/recommendations/outcome-attribution.ts)) builds a `RileyOutcomeRow` from a recommendation plus pre/post Meta `WindowMetrics`. Per-kind config ([`outcome-attribution-config.ts:7-23`](../../../../packages/core/src/recommendations/outcome-attribution-config.ts)) sets windows (pause: 7d/spend/down, refresh_creative: 14d/ctr/up). It raises visibility flags (`meta_data_missing`, `zero_pre_baseline`, `same_campaign_overlap`, `same_kind_retry`, `below_noise_floor`); any flag forces `causalStrength = "inconclusive"` and blocks rendering. The row's `executableWorkUnitId` ([`outcome-attribution-types.ts:174-200`](../../../../packages/core/src/recommendations/outcome-attribution-types.ts)) links back to the work unit that executed the recommendation, closing the loop to WorkTrace lineage.

The upgrade from `directional` to `corroborated` runs through `deriveCorroboration()` ([`outcome-corroboration.ts:123-200`](../../../../packages/core/src/recommendations/outcome-corroboration.ts)), six rejection gates then numeric floors: pause-only, no visibility flags, favorable delta, not operator-unstable, all inputs present and finite, then >=3 valued bookings per window, post account-spend within [0.5x, 1.5x] of pre (the comparable-regime band), and post booked-revenue-per-dollar ratio >= 0.8x pre. The `Number.isFinite` guard sits _before_ every comparison because `NaN >= 0` is false, so a single Meta-string-as-number could otherwise sail through to a fabricated `corroborated`.

**How it's used.** `cockpitRenderable` gates display; `trustDelta` (up/none/down) feeds the operator outcome feed. `shift_budget_to_source` is a fully designed blueprint (`KIND_CONFIG_PENDING`, `SPEC_1B_PENDING_KINDS`) but inert because it has no executor yet, so there is no executed anchor to attribute against.

**Gotchas.** The corroboration `reason` field exists purely so tests pin the exact rejecting gate and rollout debugging never reconstructs _why_ corroborated stayed off. And the spec is explicit: "no consumer may treat corroborated as causal proof." It only ever _upgrades_, never demotes.

---

### WorkTraceQualificationSignals sidecar (audit lineage only)

**Concept.** When you parse model output, preserve the _raw rejected text_ for post-hoc debugging, but keep that audit sidecar strictly separate from operational routing so a parse failure cannot stall a queue.

**In Switchboard.** `WorkTraceQualificationSignalsSchema` ([`qualification-signals.ts:42-52`](../../../../packages/schemas/src/qualification-signals.ts)) is a discriminated union on `validationStatus`: `ok` carries the parsed payload; `multiple_blocks`/`malformed_json`/`schema_mismatch` carry the raw string for replay. Stored on `WorkTrace.qualificationSignals` ([`work-trace.ts:88`](../../../../packages/core/src/platform/work-trace.ts)). The invariant: operational lifecycle queues **must not** scan this column; they read `ConversationLifecycleSnapshot`/`Transition` instead. The sidecar is for "what did the model output that was unparseable," nothing more.

---

### Injected pattern IDs (per-turn outcome-pattern lineage)

**Concept.** To measure whether a piece of injected context actually lifts conversion, you must record _which_ context entered _which_ turn, so you can later correlate turns-that-saw-pattern-X against turns-that-did-not.

**In Switchboard.** `injectedPatternIds` ([`work-trace.ts:92-95`](../../../../packages/core/src/platform/work-trace.ts)) records the `DeploymentMemory` ids rendered into the `<outcome-patterns>` envelope for that turn, populated from `ExecutionResult.injectedPatternIds` in `buildWorkTrace` ([`work-trace-recorder.ts:111`](../../../../packages/core/src/platform/work-trace-recorder.ts)), defaulting to `[]`. It is excluded from the content hash ([`work-trace-hash.ts:19-22`](../../../../packages/core/src/platform/work-trace-hash.ts)) as downstream-derivable analytics metadata. Stored as a JSON array for `unnest()`-style conversion-lift joins against `DeploymentMemory`.

**Gotchas.** This is the measurement primitive that lets the team prove the memory system's ROI rather than assume it: surfacing a pattern (gated by the source-count formula above) is only justified if conversations that saw it convert measurably better.

---

**The through-line.** Identity is resolved server-side, never by the model; the audit row is content-hashed and sealed so it is evidence; lineage fields weld the row to a contact, a conversation, and a booking; revenue evidence is bucketed by hardness and snapshotted at issuance; and facts the agent learns must be corroborated by counted sources before they are trusted. Study `EXCLUDED_BASE` and the two `hashInputVersion` shapes first; they encode the entire "what is integrity vs. what is lineage" distinction that the rest of this pillar depends on.
