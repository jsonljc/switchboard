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

### 1. Canonical pattern key

Persist a `canonicalKey` slug alongside every pattern memory. The slug names what the pattern is _about_, not its exact phrasing.

- Shape: `<category>:<topic>`, e.g. `objection:downtime_recovery`, `objection:price_value`, `trust:proof_results`, `timing:morning_preference`.
- **Generation**: the existing extraction LLM call (in `compounding-service.ts`) is widened to return `{ patterns: Array<{ text: string; canonicalKey: string }> }` instead of `patterns: string[]`. The prompt constrains the LLM to pick from a known enum first; only if no enum entry fits does it propose a freeform slug under an `other:*` namespace.
- **Validator**: a Zod refinement enforces `^[a-z_]+:[a-z0-9_]+$` and rejects empty/structural-invalid slugs. Patterns failing validation are dropped (counted in a new `outcomePatternsRejected_total{reason="invalid_canonical_key"}` series), not written.
- **Migration**: add nullable `canonicalKey` column on `DeploymentMemory` with index `(deploymentId, category, canonicalKey)`. Patterns already written under PR-3 / PR-3.1 keep `canonicalKey = null` until a backfill job (separate, low-priority) re-classifies them.

The starting enum is the pilot vertical's known objection map (medspa beauty): downtime, price/value, results-proof, pain, scheduling, location, brand-trust. Other verticals onboard with their own seed enum. Keeping the enum small at launch is intentional — too many slots and the LLM picks inconsistent labels, defeating the canonicalization gain.

### 2. Two-stage merge

Replace the single embedding-similarity check in `trackPattern` with:

1. **First stage**: `findByCategoryAndCanonicalKey(orgId, deploymentId, "pattern", canonicalKey)`. If any existing rows share the slug, jump to stage 2 against just those rows.
2. **Second stage**: embedding similarity against the canonical-bucket subset only. Use a _lower_ threshold here — proposed `0.78` — because we've already narrowed to the right topic. Merge with the highest-similarity match above threshold.
3. **Fallback**: if stage 1 returns nothing (new canonical key for this deployment) or stage 2 finds no match above `0.78`, create a new row with the new `canonicalKey`.

Effect: the four downtime examples above all carry `canonicalKey = "objection:downtime_recovery"` and merge through stage 1 even if their embeddings cosine at 0.85. `sourceCount` accumulates on a single row.

Keep the existing top-level `SIMILARITY_THRESHOLD = 0.92` available as a guard against accidental cross-canonical merge — if stage 1 finds no key match but a stage-0 broad search (across all keys) finds a row above `0.92`, log a `outcomePatternsCrossKeyCollision_total` counter for inspection. Don't auto-merge across canonical keys; that's the failure mode canonicalization was meant to prevent.

### 3. Lower pilot-scale surfacing thresholds (flagged)

The current `SURFACING_THRESHOLD` (effectively `sourceCount ≥ 3 AND confidence ≥ 0.7`) is calibrated for steady-state volume, not for pilot. Add a per-deployment runtime config (`pilotMode: boolean`) that lowers the bar:

- **Pilot mode on**: surface if `sourceCount ≥ 2 AND confidence ≥ 0.6`, OR `sourceCount ≥ 1` if the canonical cluster has been touched by `≥ 2 distinct bookingIds`. The second rule uses the `bookingId` column PR-3.1 starts populating on `ConversionRecord`: when a pattern's row aggregates evidence from multiple booking events, the canonical cluster has multi-booking support even if no individual row has high count.
- **Pilot mode off (default)**: existing thresholds unchanged.

Flag location: `Deployment.config.outcomePatterns.pilotMode` (Zod-validated), defaults `false`. Operators flip it from the dashboard for newly-onboarded deployments and clear it once `outcomePatternsSurfaced_total` hits a sustained rate.

This is the most behavior-changing knob in the PR. It should land last in the sequence and be ungated behind documentation that explains the tradeoff: more surfacing earlier, at the cost of acting on weaker evidence.

### 4. Decay cron

Wire `DeploymentMemoryStore.decayStale()` (exists, currently called only from tests) to a nightly Inngest cron, mirroring the ad-optimizer signal-health pattern (see `project_gap2_signal_health_status` memory).

- Schedule: daily at 07:00 UTC (same slot as ad-optimizer signal-health, to keep ops attention on one window).
- Behavior: lower `confidence` for rows whose `lastSeenAt` is older than `PATTERN_DECAY_WINDOW_DAYS` (already in schemas; default ~30d). The reduction factor and floor are config — start with `×0.9` per cycle, floor at `0.3`, never delete.
- **Why "never delete"**: deletion loses the historical signal. A pattern that decays to confidence `0.3` no longer surfaces (below `SURFACING_THRESHOLD`) but its row remains, and if the topic reappears the merge path re-promotes it from existing rather than re-creating a parallel row.
- **Metric**: `outcomePatternsDecayed_total{deploymentId, canonicalCategory}` increments per row whose confidence dropped this cycle.

**Why decay matters more than it looks**: the dangerous failure mode isn't "old patterns linger" — it's "old successful-booking patterns continue to steer Alex after the business changed." If the spa moves from chemical peel to laser resurfacing as the headline service, last quarter's "downtime is 24h, customers handle it" pattern becomes actively misleading. Decay caps how long stale guidance keeps moving Alex.

### 5. Pattern IDs in prompt + trace

Foundation for falsifiability without doing A/B testing yet.

- **Render**: `ContextBuilder.outcomePatternContext` becomes a structured payload, e.g.:
  ```
  <pattern id="pat_abc123" key="objection:downtime_recovery" confidence="0.78" sources="4">
  Customers ask about downtime before booking. Lean into the answer early
  in the conversation; mention numbing protocol explicitly.
  </pattern>
  ```
  The wrapping `<pattern>` envelope is invisible to the operator-facing surface but visible in the prompt. Alex's response generation sees the IDs as inert metadata.
- **Trace**: every Alex turn that surfaces patterns appends `injectedPatternIds: string[]` onto the `WorkTrace` entry for that turn. This is durable — once enough turns and outcomes accumulate, a separate analytics job can compute per-pattern lift retroactively without needing a live A/B framework.
- **No new prompt logic in PR-3.2**: Alex is not told to "follow pattern pat_abc123." The IDs exist only to enable later attribution.

## Scope guards

- **No pattern-as-policy.** Patterns remain advisory natural-language hints; this PR explicitly does NOT add constrained decoding, system-message overrides, or hard rule enforcement. That's a future call, after we can prove specific patterns shifted conversion.
- **No conversion-lift metric.** Pattern IDs in trace are the foundation; the analytics job that joins traces against `ConversionRecord` is a separate workstream once the trace data has accumulated.
- **No cross-deployment pattern sharing.** Each deployment's memory remains isolated. Operators on the same vertical may have overlapping patterns; that's fine.
- **No backfill of pre-PR-3.2 patterns.** Rows written under PR-3 / PR-3.1 keep `canonicalKey = null`. A backfill job is filed as separate follow-up.

## Risk

Medium-to-high. The canonical-key generation is the load-bearing change: if the LLM picks slugs inconsistently, two-stage merge fragments along a new axis (canonical-key-as-prose instead of pattern-as-prose) and PR-3.2 inherits the same fragmentation problem under a different name. Mitigation: aggressive enum constraints at launch, smaller LLM responses (one slug per pattern, not free-form), and a `outcomePatternsCrossKeyCollision_total` counter that surfaces if the same topic is landing under multiple slugs.

The decay cron is low-risk (additive, reversible, monotonic-down).

The pilot-threshold flag is high-leverage but explicitly off by default, so risk is operator-controlled.

## Tests

- Canonical key validator rejects malformed slugs and counts them in the rejected counter.
- Extraction returns a pattern with `canonicalKey`; `trackPattern` persists the slug.
- Two-stage merge: two patterns with the same `canonicalKey` and cosine `0.85` (below the legacy `0.92` threshold) merge into a single row; their `sourceCount` accumulates.
- Two-stage merge: a pattern with a new `canonicalKey` for the deployment creates a new row even if it cosines highly against a row in a different canonical bucket.
- Cross-key collision counter increments when stage-0 broad search finds a `≥ 0.92` match outside the canonical bucket.
- Pilot-mode surfacing threshold returns rows at `sourceCount = 2 ∧ confidence = 0.65` for a deployment with `pilotMode = true` and skips them otherwise.
- Pilot-mode multi-booking rule surfaces a `sourceCount = 1` row when its row was touched by `≥ 2 distinct bookingIds` (joins through `ConversionRecord.bookingId`).
- Decay cron lowers confidence on rows with `lastSeenAt > PATTERN_DECAY_WINDOW_DAYS` and is idempotent (re-running on the same day does not double-decay).
- Decay floor is enforced — a row at the floor (`0.3`) does not drop further.
- `outcomePatternContext` payload includes pattern IDs in the `<pattern id=...>` envelope.
- `WorkTrace` for a turn that surfaced patterns records `injectedPatternIds` matching what `outcomePatternContext` rendered.

## Sequencing inside PR-3.2

Sub-PRs in dependency order:

1. **PR-3.2a — Canonical key foundation.** Migration + Zod validator + extraction-prompt widening + `findByCategoryAndCanonicalKey`. Backwards compatible (existing rows carry `canonicalKey = null`; new rows populate it). Metrics-only impact on `outcomePatternsRejected_total`. **Low risk.**

2. **PR-3.2b — Two-stage merge.** Wire `trackPattern` through the new lookup. Add the cross-key collision counter. **Medium risk** — this is the load-bearing behavior change.

3. **PR-3.2c — Pattern IDs in prompt + trace.** Structural payload + `WorkTrace.injectedPatternIds`. Independent of (a) and (b) but most useful after both, since pattern IDs are most informative when they're stable across re-extractions of the same canonical topic. **Low risk.**

4. **PR-3.2d — Decay cron.** Inngest job + metric + config defaults. Fully independent of the others; can ship in parallel with (a)/(b)/(c). **Low risk.**

5. **PR-3.2e — Pilot-scale thresholds (flagged).** `Deployment.config.outcomePatterns.pilotMode` + threshold branching in `ContextBuilder`. Ships last because it depends on (a)+(b) for the canonical-key cluster aggregation that makes the `sourceCount ≥ 1` multi-booking rule meaningful. **Medium risk** — operator-controlled.

Five PRs is more than the rest of the PR-3 sequence used, but each is genuinely independent. A single bundled PR would be hard to review and harder to back out.

## Release ordering

PR-3.2 should ship **after** PR-3.1 deploys, not before. PR-3.1's `bookingId` column on `ConversionRecord` is a precondition for the pilot-threshold multi-booking rule (step 5). Booking-backed attribution is also the upstream contract canonical-key extraction relies on — without it, the canonical bucket would aggregate evidence from LLM-classified-but-not-actually-booked conversations, defeating the trustworthiness guarantee PR-3.1 added.

There is no "binding requirement" the way PR-3.1 had relative to PR-3 — PR-3.1 corrects a durable-memory safety hole; PR-3.2 only improves visible loop quality. Operators can run PR-3.1 indefinitely without PR-3.2; the loop is correct, just quiet at pilot scale.

## Future (after PR-3.2)

- **Conversion-lift attribution.** Analytics job that joins `WorkTrace.injectedPatternIds` against `ConversionRecord` to compute per-pattern booking lift. Requires several weeks of trace data after PR-3.2c lands.
- **Cross-deployment vertical patterns.** A "vertical pattern library" that surfaces common medspa objections to new deployments before their own memory has accumulated. Requires consent + an architectural call on tenant boundaries.
- **Constrained decoding on patterns.** If conversion-lift attribution shows specific high-confidence patterns producing measurable lift, a typed `{trigger, action, support}` JSON shape with constrained decoding becomes worth the lift. Not before evidence.
