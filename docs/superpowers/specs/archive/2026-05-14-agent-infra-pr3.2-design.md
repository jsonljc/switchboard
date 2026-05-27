# Agent Infrastructure Parity — PR-3.2 Design Spec

> Stacks on PR-3 (#461, merged) and PR-3.1 (#463, in review). Read those first: [`2026-05-13-agent-infra-parity-design.md`](./2026-05-13-agent-infra-parity-design.md) frames the PR sequence and defines the loop.

> **Framing.** PR-3 + PR-3.1 close the **architectural** learning loop: extract → persist → surface → observe, gated on booking evidence. PR-3.2 closes the **compounding-quality** loop: whether semantically similar patterns merge fast enough to actually surface at pilot scale, whether stale patterns stop steering Alex after the business changes, and whether you can later attribute a behavior change to a specific pattern.
>
> Said differently: **PR-3 + PR-3.1 make the loop correct and trustworthy. PR-3.2 makes the loop useful at pilot scale.**

## The metric smell PR-3.2 prevents

Without PR-3.2, the loop can ship green metrics that look healthy while doing nothing visible:

- `outcomePatternsExtracted_total` rising — patterns are being extracted from booked conversations.
- `outcomePatternsCreated_total` rising — those patterns are landing as fresh `DeploymentMemory` rows.
- `outcomePatternsSurfaced_total` flat at zero — nothing has reached `sourceCount ≥ 3` so nothing surfaces into `outcomePatternContext`.

The cause is fragmentation. `SIMILARITY_THRESHOLD = 0.92` over Voyage-3-lite (1024d) on short pattern strings will routinely cosine paraphrases at 0.85–0.91. So four extractions of the same commercial objection —

- "Customers ask about downtime before booking"
- "People want to know recovery time"
- "Clients ask how long redness lasts"
- "They need assurance about post-treatment side effects"

— land as four separate rows, none of which reach the `≥ 3` surfacing floor. At pilot volume (10–50 booked conversations / month), this is the realistic default.

PR-3.2 attacks fragmentation directly, plus the two other adjacent quality concerns (freshness, falsifiability).

## What changes

Five workstreams. They are sequenced inside PR-3.2 in dependency order — canonicalization unlocks two-stage merge, both unlock the lower pilot thresholds, decay is independent, pattern IDs in trace can ship at any point.

### 1. Canonical pattern key + evidence edge

Persist a `canonicalKey` slug alongside every pattern memory. The slug names what the pattern is _about_, not its exact phrasing. Crucially, also persist an **evidence edge** linking each pattern accumulation to the specific `Booking` / `ConversionRecord` it came from — without that, the pilot-mode multi-booking surfacing rule in step 5 is not implementable except by inference.

**Schema additions.**

```
DeploymentMemory:
  + canonicalKey: String?        -- nullable; existing rows stay null
  @@index([deploymentId, category, canonicalKey])

DeploymentMemoryEvidence (new):
  id: String @id
  deploymentMemoryId: String     -- FK to DeploymentMemory
  organizationId: String         -- redundant with parent, useful for queries
  bookingId: String?             -- FK to Booking when strong-tier attributed
  conversionRecordId: String?    -- FK to ConversionRecord; both nullable allows soft references
  workTraceId: String?           -- for strong-tier attribution back-reference
  attributionTier: String        -- "strong" | "fallback"
  observedAt: DateTime
  @@index([deploymentMemoryId])
  @@index([deploymentMemoryId, bookingId])
  @@unique([deploymentMemoryId, bookingId])  -- one evidence edge per (pattern, booking)
```

The `@@unique([deploymentMemoryId, bookingId])` is load-bearing: it guarantees that the pilot multi-booking rule (`distinct bookingIds ≥ 2`) cannot be tricked by the same booking landing multiple evidence rows under the same pattern. Two distinct conversations producing the same canonical pattern from the same downstream booking still count as one piece of booking evidence.

**Write path.** When `trackPattern` is called from `compounding-service.ts` (gated on `attribution.tier !== "none"` per PR-3.1), after merging/creating the `DeploymentMemory` row, write a `DeploymentMemoryEvidence` row with the `bookingId` from `BookingAttribution` and the `attributionTier` it resolved at. If attribution is `none` (impossible given PR-3.1's gate, but defensive), skip the evidence write.

The two writes are **sequential, not transactional** — wrapping them in a real `prisma.$transaction` would require passing a Prisma client across the schemas → core → db dependency layer (forbidden per CLAUDE.md "Dependency Layers"; the compounding service in `packages/core` injects the evidence store via interface, not the underlying Prisma client). Sequential is acceptable because the writes are **idempotent under retry**: `recordEvidence` is an `upsert` keyed on `@@unique([deploymentMemoryId, bookingId])` with `update: {}` (first-write wins on `observedAt`), so re-running the same `(memoryId, bookingId)` pair after a transient failure between the two writes lands the missing evidence row without duplicating it. The remaining failure mode — `trackPattern` succeeds, `recordEvidence` fails, and the conversation never replays — leaves the memory row without its evidence edge, which under the PR-3.2e multi-booking surfacing rule would under-count this booking by one. Monitor `recordEvidence` errors as part of the standard `processConversationEnd` error path; do not promote to atomicity unless the under-count materially affects the surfacing rule in production.

**Canonical-key enum (v1 — enum-only).**

The LLM extraction prompt is widened to return `{ patterns: Array<{ text: string; canonicalKey: string }> }`. The prompt presents the deployment's vertical enum and instructs the LLM to pick exactly one slug or return `unknown`. **There is no `other:*` freeform fallback in v1.**

Behavior:

- If `canonicalKey` matches the enum → write pattern + evidence row normally.
- If `canonicalKey` is `unknown` or anything not in the enum → drop the pattern from this conversation's writes, **but record the rejected candidate to a new `OutcomePatternCandidateReview` table** (or simpler, an analytics-only counter `outcomePatternsRejected_total{reason="unknown_canonical_key"}` plus a sampled debug log capturing the rejected slug + pattern text). This is the operator-review queue that lets us expand the enum manually over time without letting `other:*` recreate fragmentation under a new name.
- If `canonicalKey` is structurally malformed (fails the `^[a-z_]+:[a-z0-9_]+$` Zod refinement) → drop and count under `reason="invalid_canonical_key"`. Counted separately because malformed slugs indicate a prompt bug, not a missing enum entry.

The starting enum for the medspa pilot — intentionally narrow, slightly more granular than the original draft to avoid fat-bucket merge ambiguity:

- `objection:downtime_work` — return-to-work timing
- `objection:redness_side_effects` — post-treatment visible effects
- `objection:aftercare_restrictions` — sun, makeup, exercise after treatment
- `objection:pain` — discomfort during/after
- `objection:price_value` — cost vs. perceived value
- `objection:results_proof` — before/afters, evidence, expectations
- `objection:safety_credentials` — qualifications, equipment, brand trust
- `scheduling:availability` — appointment timing, slot pressure
- `scheduling:location_access` — travel, parking, neighborhood

Other verticals onboard with their own seed enum (separate config). The enum is intentionally small at launch: too many slots and the LLM picks inconsistent labels; too few and unrelated sub-intents get force-merged. Operators add new slugs after reviewing the rejection queue.

**Migration.** Add `canonicalKey` column + `DeploymentMemoryEvidence` table in one Prisma migration. Patterns already written under PR-3 / PR-3.1 keep `canonicalKey = null` and have no evidence rows — they continue to surface under the legacy `sourceCount ≥ 3 ∧ confidence ≥ 0.7` rule until either (a) they're re-merged by a future extraction (which carries the new key) or (b) a backfill job re-classifies them. Backfill is a separate follow-up; not in scope for PR-3.2a.

**Extraction-prompt widening — three-touch change.** The current shape is `ExtractionResult.patterns: string[]` (typed at `packages/core/src/memory/compounding-service.ts:84`), produced by the prompt template at `packages/core/src/memory/extraction-prompts.ts:44`. Widening to `{ text, canonicalKey }` requires three coordinated edits in PR-3.2a:

1. **Type** — change `ExtractionResult.patterns` from `string[]` to `Array<{ text: string; canonicalKey: string }>` in `compounding-service.ts`. Update the consumer at `compounding-service.ts:147` (the booking-gated extraction loop introduced by PR-3.1 Task 18) to read `pattern.text` and `pattern.canonicalKey` instead of treating the entry as a bare string.
2. **Prompt** — rewrite the patterns instruction in `extraction-prompts.ts:44` to ask for the new object shape, present the deployment's enum, and instruct `"return canonicalKey: 'unknown' if nothing fits"`.
3. **Test fixture** — `packages/core/src/memory/__tests__/compounding-service.test.ts:64` (and any other fixture mocking `extraction.patterns`) updates from `["pattern string"]` to `[{ text: "pattern string", canonicalKey: "objection:..." }]`.

No other consumer reads `extraction.patterns` on current main (verified). The change is therefore confined to these three files plus their test files.

### 2. Two-stage merge (conservative threshold, ratcheted by evidence)

Replace the single embedding-similarity check in `trackPattern` with:

1. **First stage**: `findByCategoryAndCanonicalKey(orgId, deploymentId, "pattern", canonicalKey)`. If any existing rows share the slug, jump to stage 2 against just those rows.
2. **Second stage**: embedding similarity against the canonical-bucket subset only. Threshold starts at **`0.84`** (not 0.78 as originally drafted). Merge with the highest-similarity match above threshold.
3. **Fallback**: if stage 1 returns nothing (new canonical key for this deployment) or stage 2 finds no match above `0.84`, create a new row with the new `canonicalKey`.

**Why 0.84, not 0.78.** Inside a single canonical bucket like `objection:aftercare_restrictions`, sub-intents can diverge enough that Alex needs different responses:

- "Can I wear makeup tomorrow?"
- "How long do I avoid sun?"
- "When can I work out again?"

These three all belong in the bucket but warrant different replies. Merging them into one prose row at a permissive 0.78 produces muddy patterns. `0.84` is conservative enough to keep distinguishable sub-intents apart while still catching the obvious paraphrases the canonical bucket is supposed to fix.

**Ratcheting protocol.** The threshold is a config (`OUTCOME_PATTERN_MERGE_THRESHOLD`), not a hardcode. After 4+ weeks of pilot data, if the cross-key collision counter (below) is quiet and the rejection queue shows the enum is well-calibrated, the threshold can be lowered to 0.80 → 0.78 in a follow-up PR. Don't lower it speculatively; lower it when metrics say it's safe.

**Cross-key collision guard.** Keep the legacy top-level `SIMILARITY_THRESHOLD = 0.92` as an inspection counter. If stage 1 finds no canonical-key match for an incoming pattern, but a broad search across all keys finds a row above `0.92`, log `outcomePatternsCrossKeyCollision_total{deploymentId, currentKey, collidingKey}` and do **not** auto-merge. The collision is either a sign that the canonical enum is too narrow (the same topic landed under two slugs) or that the LLM picked an inconsistent label this turn — either way, it's a review signal, not a merge signal.

Effect: the four downtime examples in the original metric-smell section all carry `canonicalKey = "objection:downtime_work"` (or `"objection:redness_side_effects"` depending on intent) and merge through stage 1 if they cosine ≥ 0.84 to an existing bucket member. Truly distinct sub-intents within the same canonical bucket land as separate rows, which is correct behavior.

### 3. Lower pilot-scale surfacing thresholds (flagged, evidence-based)

The current `SURFACING_THRESHOLD` (effectively `sourceCount ≥ 3 AND confidence ≥ 0.7`) is calibrated for steady-state volume, not for pilot. Add a per-deployment runtime config (`pilotMode: boolean`) that lowers the bar:

- **Pilot mode on**: surface if
  - `sourceCount ≥ 2 AND confidence ≥ 0.6`, OR
  - the pattern row has `≥ 2 distinct bookingIds` in `DeploymentMemoryEvidence` (regardless of `sourceCount`).
- **Pilot mode off (default)**: existing thresholds unchanged.

The second rule is what step 1's evidence table exists for. It says: even a single-extraction pattern is worth surfacing if independent bookings have touched it. The implementation is a `SELECT COUNT(DISTINCT bookingId) FROM DeploymentMemoryEvidence WHERE deploymentMemoryId = ? AND bookingId IS NOT NULL` per candidate row at surfacing time. With the `@@index([deploymentMemoryId, bookingId])` from step 1, this is cheap.

Flag location: `Deployment.config.outcomePatterns.pilotMode` (Zod-validated), defaults `false`. Operators flip it from the dashboard for newly-onboarded deployments and clear it once `outcomePatternsSurfaced_total` hits a sustained rate.

This is the most behavior-changing knob in the PR. It should land last in the sequence and be gated behind documentation that explains the tradeoff: more surfacing earlier, at the cost of acting on weaker evidence per individual pattern row (though still gated on booking-backed evidence — that part doesn't bend).

### 4. Decay cron (idempotent per day)

Wire `DeploymentMemoryStore.decayStale()` (exists at `packages/core/src/memory/scoped-stores.ts:136`, currently called only from tests) to a nightly Inngest cron, mirroring the ad-optimizer signal-health pattern.

**Placement convention (verified against `executeDailySignalHealthCheck`).** Inngest crons in this repo split across two locations:

- **Pure function** — lives in the owning package. For signal-health: `packages/ad-optimizer/src/inngest-functions.ts` exports `executeDailySignalHealthCheck` (id `"ad-optimizer-daily-signal-health"`, `triggers: [{ cron: "0 7 * * *" }]`). For pattern decay, the equivalent function lives in `packages/core/src/memory/inngest-functions.ts` (or `packages/core/src/jobs/pattern-decay.ts`; either is fine — pick one and document) and exports `executeDailyPatternDecay` with id `"memory-daily-pattern-decay"`.
- **Registration** — happens in `apps/api/src/bootstrap/inngest.ts`. Signal-health is registered at line ~567 via `createDailySignalHealthCron(signalHealthDeps)`. Pattern decay must be registered the same way alongside it, and is the boundary at which `DeploymentMemoryStore` is **injected** into the pure function. The `core` function cannot import from `@switchboard/db` (Layer 3 → Layer 4 forbidden); the store comes in via the registration call.

The `apps/api/src/services/cron/` directory holds a second Inngest pattern (e.g. `lead-retry`, `meta-token-refresh`) where the function and registration both live in `apps/api`. Do NOT use that pattern for pattern decay — it would either (a) put memory-domain logic in the app layer or (b) leak a `@switchboard/db` import into something that should be domain code. Follow the signal-health split.

- Schedule: daily at 07:00 UTC (same slot as ad-optimizer signal-health, to keep ops attention on one window).
- Behavior: lower `confidence` for rows whose `lastSeenAt` is older than `PATTERN_DECAY_WINDOW_DAYS` (already in schemas; default ~30d). The reduction factor and floor are config — start with `×0.9` per cycle, floor at `0.3`, never delete.
- **Why "never delete"**: deletion loses the historical signal. A pattern that decays to confidence `0.3` no longer surfaces (below `SURFACING_THRESHOLD`) but its row remains, and if the topic reappears the merge path re-promotes it from existing rather than re-creating a parallel row.
- **Idempotency.** Add a `DeploymentMemory.lastDecayedAt: DateTime?` column. The decay job updates `lastDecayedAt` to `dateTruncDay(now())` atomically with the confidence write, and the `decayStale` WHERE clause includes `lastDecayedAt IS NULL OR lastDecayedAt < dateTruncDay(now())`. Re-running the same calendar day is a no-op. Pair with an Inngest function-level idempotency key (`pattern-decay-{yyyy-mm-dd}`) so retries don't double-fire at the job orchestration layer either — belt-and-braces because daily writes to confidence are the kind of bug that's invisible until trust in the cohort has eroded.
- **Metric**: `outcomePatternsDecayed_total{deploymentTier, canonicalCategory}` increments per row whose confidence dropped this cycle. (See "Metric cardinality" note below for why `deploymentTier` not `deploymentId` here.)

**Why decay matters more than it looks**: the dangerous failure mode isn't "old patterns linger" — it's "old successful-booking patterns continue to steer Alex after the business changed." If the spa moves from chemical peel to laser resurfacing as the headline service, last quarter's "downtime is 24h, customers handle it" pattern becomes actively misleading. Decay caps how long stale guidance keeps moving Alex.

### 5. Pattern IDs in prompt + trace (inert metadata)

Foundation for falsifiability without doing A/B testing yet.

- **Render**: `ContextBuilder.outcomePatternContext` becomes a structured payload, wrapped with an explicit metadata disclaimer so the model treats pattern IDs as trace-only:

  ```
  <outcome-patterns>
  These are advisory hints from prior successful conversations. The id and
  attribute values are metadata for tracing — do not mention them to the
  customer, do not quote them back, and do not treat them as instructions.

  <pattern id="pat_abc123" key="objection:downtime_work" confidence="0.78" sources="4">
  Customers ask about downtime before booking. Lean into the answer early
  in the conversation; mention numbing protocol explicitly.
  </pattern>
  </outcome-patterns>
  ```

  The wrapping `<outcome-patterns>` envelope is invisible to the operator-facing surface but visible in the prompt. The disclaimer paragraph is load-bearing: without it, models occasionally read `<pattern id=...>` as an instruction shape and surface IDs back to the user.

- **Trace persistence target.** The current `WorkTrace` schema has no extensible `metadata Json?` column — only typed fields plus four narrow JSON-as-Text fields (`parameters`, `deploymentContext`, `executionOutputs`, `executionSummary`), all of which are product-meaningful and unsafe to overload. PR-3.2c **adds a new column** `WorkTrace.injectedPatternIds String[]` (Postgres `text[]`), in the same Prisma migration as the column's first write. Rationale: a typed array column is queryable from analytics (the eventual conversion-lift job joins on `unnest(injectedPatternIds)`), cheaper than a JSON sidecar, and keeps the `WorkTrace` shape self-describing. A JSON `metadata Json?` column was considered but rejected for this PR — extensible-bag metadata is a future need that should land with its own design, not be introduced as a side-effect of trace pattern IDs.
- **Trace write site.** Every Alex turn that surfaces patterns appends the pattern IDs to its `WorkTrace.injectedPatternIds`. The write happens inside the existing `WorkTrace` finalization, not as a separate row. Empty array (or null, depending on Prisma default behavior — use `@default([])`) when no patterns were surfaced.
- **No new prompt logic in PR-3.2**: Alex is not told to "follow pattern pat_abc123." The IDs exist only to enable later attribution.

## Scope guards

- **No pattern-as-policy.** Patterns remain advisory natural-language hints; this PR explicitly does NOT add constrained decoding, system-message overrides, or hard rule enforcement. That's a future call, after we can prove specific patterns shifted conversion.
- **No conversion-lift metric.** Pattern IDs in trace are the foundation; the analytics job that joins traces against `ConversionRecord` is a separate workstream once the trace data has accumulated.
- **No cross-deployment pattern sharing.** Each deployment's memory remains isolated. Operators on the same vertical may have overlapping patterns; that's fine.
- **No backfill of pre-PR-3.2 patterns.** Rows written under PR-3 / PR-3.1 keep `canonicalKey = null` and have no `DeploymentMemoryEvidence` rows. A backfill job is filed as a separate follow-up.
- **No `other:*` freeform canonical keys.** Enum-only at launch. Unknown candidates land in the rejection queue for manual enum expansion. This explicitly trades "patterns the LLM almost-classified" for "no second-axis fragmentation."
- **No threshold below 0.84 at launch.** The two-stage merge threshold can be ratcheted down only after the cross-key collision counter and rejection queue confirm the canonical enum is well-calibrated.

## Metric cardinality

Prometheus labels are not free. `deploymentId` as a label can explode the cardinality space once Switchboard scales past a handful of tenants. For PR-3.2:

- **Pilot-only allowance.** While we're in pilot (< 20 deployments), `deploymentId` is acceptable as a label on the new five series. This buys per-deployment visibility on the launch cohort without infrastructure cost.
- **GA guard.** Before GA (defined as: first deployment external to the pilot cohort), aggregate to `deploymentTier` (`pilot` | `early_access` | `production`) and/or `verticalCategory`. Per-deployment detail moves to logs + a `DeploymentMemoryEvidence` analytics view.
- **Decay metric exception.** `outcomePatternsDecayed_total` uses `deploymentTier` from day one, not `deploymentId`. Decay is a cron-driven aggregate; per-deployment decay rate is not actionable in real time.

Track this in the PR-3.2 implementation README as an explicit known-cost: the labels are temporary infrastructure-debt that we will repay before GA.

## Risk

Medium-to-high. The canonical-key generation is the load-bearing change: if the LLM picks slugs inconsistently, two-stage merge fragments along a new axis (canonical-key-as-prose instead of pattern-as-prose) and PR-3.2 inherits the same fragmentation problem under a different name.

Mitigations stacked in priority order:

1. **Enum-only at launch** — no `other:*` freeform fallback; unknown candidates land in the rejection queue. This is the single biggest risk reduction; without it, slug fragmentation is a near-certainty.
2. **Conservative initial merge threshold** at `0.84`, ratcheted down only after metrics confirm safety.
3. **Cross-key collision counter** — surfaces if the same topic is landing under multiple slugs.
4. **Tighter enum granularity** at the schema level — splitting `objection:downtime_recovery` into `objection:downtime_work`, `objection:redness_side_effects`, `objection:aftercare_restrictions` reduces forced over-merge inside any single bucket.

The evidence-table addition (`DeploymentMemoryEvidence`) is medium-risk on its own: a new table with `@@unique` constraints carries migration risk and slightly increases the write path's transactional surface. Mitigated by the constraint being narrowly-scoped (one row per pattern+booking) and the writes happening inside the existing `trackPattern` transaction.

The decay cron is low-risk on its own (additive, reversible, monotonic-down) but introduces a daily write path that _must_ be idempotent — the `lastDecayedAt` column + Inngest function-level idempotency key are the load-bearing protections.

The pilot-threshold flag is high-leverage but explicitly off by default, so risk is operator-controlled.

## Tests

**Canonical key + evidence:**

- Canonical key validator rejects structurally-malformed slugs; counts them under `outcomePatternsRejected_total{reason="invalid_canonical_key"}`.
- Canonical key validator rejects slugs not in the deployment's enum (e.g. `objection:something_made_up`); counts them under `outcomePatternsRejected_total{reason="unknown_canonical_key"}`; no pattern row is written.
- Extraction returns a pattern with enum-valid `canonicalKey`; `trackPattern` persists the slug **and** writes a `DeploymentMemoryEvidence` row with the `bookingId` + `attributionTier` from `BookingAttribution`.
- The `@@unique([deploymentMemoryId, bookingId])` constraint prevents duplicate evidence rows for the same (pattern, booking) pair across re-runs of the same conversation.

**Two-stage merge:**

- Two patterns with the same `canonicalKey` and cosine `0.86` (below the legacy `0.92` threshold, above the new `0.84`) merge into a single row; `sourceCount` accumulates; both bookings' evidence rows land.
- Two patterns with the same `canonicalKey` but cosine `0.81` (below `0.84`) do NOT merge; they create separate rows.
- A pattern with a new `canonicalKey` for the deployment creates a new row even if it cosines `≥ 0.92` against a row in a different canonical bucket.
- Cross-key collision counter `outcomePatternsCrossKeyCollision_total{currentKey, collidingKey}` increments when stage-0 broad search finds a `≥ 0.92` match outside the canonical bucket; no auto-merge happens.

**Pilot surfacing:**

- Pilot-mode surfacing returns rows at `sourceCount = 2 ∧ confidence = 0.65` for a deployment with `pilotMode = true`; skips them when `pilotMode = false`.
- Pilot-mode multi-booking rule surfaces a `sourceCount = 1` row when `DeploymentMemoryEvidence` has `≥ 2 distinct bookingId`s for that row.
- Pilot-mode multi-booking rule does NOT surface a `sourceCount = 1` row touched by only one `bookingId`, even if the same booking is referenced twice in evidence (`@@unique` makes this case structurally impossible, but assert anyway).

**Decay:**

- Decay cron lowers confidence on rows with `lastSeenAt > PATTERN_DECAY_WINDOW_DAYS`.
- Decay is idempotent within a single calendar day: running it twice updates `lastDecayedAt` once and only decays once. Implementation: WHERE clause excludes rows already decayed today.
- Decay floor is enforced — a row at the floor (`0.3`) does not drop further; `lastDecayedAt` is still updated so re-runs don't re-evaluate.
- Inngest function-level idempotency key (`pattern-decay-{yyyy-mm-dd}`) is set so orchestration-level retries don't double-fire even before the DB-level check.

**Pattern IDs in prompt + trace:**

- `outcomePatternContext` payload wraps patterns in `<outcome-patterns>...<pattern id=... key=... />` with the metadata-only disclaimer paragraph.
- `WorkTrace.injectedPatternIds` column persists the array; a turn that surfaced no patterns has `injectedPatternIds = []`.
- `WorkTrace` for a turn that surfaced patterns records `injectedPatternIds` matching what `outcomePatternContext` rendered (same order, same string IDs).
- Smoke test against a real Alex turn: customer asks about downtime; the model's response does NOT include the `pat_*` ID or the `<outcome-patterns>` markup verbatim. This pins the "metadata only" disclaimer's job.

**Cron placement (PR-3.2d):**

- The cron function lives in `packages/core/src/memory/` (not `apps/api/src/services/cron/`); `DeploymentMemoryStore` is injected via the registration call in `apps/api/src/bootstrap/inngest.ts`. Test: the `core` module has no `@switchboard/db` import (assert via dependency-cruiser or grep).

## Sequencing inside PR-3.2

Sub-PRs in dependency order:

1. **PR-3.2a — Canonical key foundation + evidence edge.** Two migrations (`DeploymentMemory.canonicalKey`, `DeploymentMemoryEvidence` table). Enum-only Zod validator (no `other:*` fallback). Extraction-prompt widening to return `{ text, canonicalKey }`. New `findByCategoryAndCanonicalKey` query. Evidence write path attached to `trackPattern` so every pattern accumulation records its `bookingId` + `attributionTier`. Backwards compatible: existing rows stay `canonicalKey = null` with no evidence rows. **Low risk** — migration + new write path only; existing surfacing logic unchanged until 3.2b/3.2e.

2. **PR-3.2b — Two-stage merge at `0.84`.** Wire `trackPattern` through the canonical-bucket lookup, threshold at `0.84` (not 0.78). Add the cross-key collision counter. Add the rejection metric for `unknown_canonical_key`. **Medium risk** — load-bearing behavior change for the write path.

3. **PR-3.2c — Pattern IDs in prompt + trace + metadata disclaimer.** Adds `WorkTrace.injectedPatternIds: String[]` column via Prisma migration, structural `<outcome-patterns>` payload with the "metadata only, do not mention" disclaimer, and the write at `WorkTrace` finalization. Independent of (a) and (b) but most useful after both. **Low risk** — the new column is additive and `@default([])`, so backfill is not required.

4. **PR-3.2d — Decay cron with daily idempotency.** Inngest job + `DeploymentMemory.lastDecayedAt` column + metric + config defaults. Fully independent of the others; can ship in parallel with (a)/(b)/(c). **Low risk.**

5. **PR-3.2e — Pilot-scale thresholds (flagged).** `Deployment.config.outcomePatterns.pilotMode` + threshold branching in `ContextBuilder`. The `sourceCount ≥ 1` multi-booking surfacing rule reads `DeploymentMemoryEvidence.distinct(bookingId)`. Ships last because it depends on (a) for the evidence table. **Medium risk** — operator-controlled.

Five PRs is more than the rest of the PR-3 sequence used, but each is genuinely independent. A single bundled PR would be hard to review and harder to back out.

## Release ordering

PR-3.2 should ship **after** PR-3.1 deploys, not before. PR-3.1's `bookingId` column on `ConversionRecord` is a precondition for the pilot-threshold multi-booking rule (step 5). Booking-backed attribution is also the upstream contract canonical-key extraction relies on — without it, the canonical bucket would aggregate evidence from LLM-classified-but-not-actually-booked conversations, defeating the trustworthiness guarantee PR-3.1 added.

There is no "binding requirement" the way PR-3.1 had relative to PR-3 — PR-3.1 corrects a durable-memory safety hole; PR-3.2 only improves visible loop quality. Operators can run PR-3.1 indefinitely without PR-3.2; the loop is correct, just quiet at pilot scale.

## Future (after PR-3.2)

- **Conversion-lift attribution.** Analytics job that joins `WorkTrace.injectedPatternIds` against `ConversionRecord` to compute per-pattern booking lift. Requires several weeks of trace data after PR-3.2c lands.
- **Cross-deployment vertical patterns.** A "vertical pattern library" that surfaces common medspa objections to new deployments before their own memory has accumulated. Requires consent + an architectural call on tenant boundaries.
- **Constrained decoding on patterns.** If conversion-lift attribution shows specific high-confidence patterns producing measurable lift, a typed `{trigger, action, support}` JSON shape with constrained decoding becomes worth the lift. Not before evidence.
