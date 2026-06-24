## Freshness: decay windows, recency signals, TTL caches

Every autonomous revenue-actions platform is, underneath, a system that reasons over data that is constantly going stale. A conversation pattern learned six months ago, a pixel that fired this morning but not since, an operator who confirmed business hours two weeks ago, a spend total computed three seconds ago: each carries an implicit "as of" timestamp, and the correctness of a downstream decision depends on whether the platform treats that timestamp honestly.

This section teaches the three closely related techniques Switchboard uses to manage data age:

- **Decay windows** gradually reduce the _weight_ of old data (confidence scores ramp down over time).
- **Recency signals / freshness gates** make a binary or categorical judgment about whether data is recent enough to act on (fresh / stale / dead).
- **TTL caches** (time-to-live) hold expensive-to-compute values for a bounded window, trading a little staleness for a lot less load.

The unifying idea is the same in all three: read a timestamp, compute an age (`now - then`), and compare it to a window. The interesting engineering lives in _what you do at the boundary_ and _what failure looks like when the timestamp is missing_. Watch for those two themes throughout.

A transferable mental model: a TTL cache is a decay window with a step function (weight 1.0 inside the window, 0.0 outside), and a freshness gate is a TTL cache where the "value" is the data's own usability. They are the same primitive tuned for different jobs.

---

### Pattern Confidence Decay Window (learned-memory aging)

**Concept.** When an AI agent learns from past conversations, it accumulates "patterns" with confidence scores. Old patterns should not vanish (they may still be true), but they should weigh less than fresh evidence. The standard technique is _confidence decay_: on a schedule, subtract a small amount from the confidence of any pattern that has not been re-observed recently, with a floor so nothing decays to zero.

**In Switchboard.** The window is a schema constant; the schedule is an Inngest cron; the actual mutation is a single `updateMany` in the store.

[`packages/schemas/src/deployment-memory.ts:91-92`](packages/schemas/src/deployment-memory.ts)

```ts
export const DECAY_WINDOW_DAYS = 90;
export const PATTERN_DECAY_WINDOW_DAYS = 180;
```

The daily cron (`0 7 * * *`) wires the constants into the job at [`apps/api/src/bootstrap/inngest.ts:644-646`](apps/api/src/bootstrap/inngest.ts) (`windowDays: PATTERN_DECAY_WINDOW_DAYS, decayAmount: 0.1, floor: 0.3`) and registers `dailyPatternDecayCron` (lines 701-723). The producer computes the cutoff at [`packages/core/src/memory/inngest-functions.ts:42-53`](packages/core/src/memory/inngest-functions.ts):

```ts
const now = deps.now();
const startOfDay = startOfUtcDay(now);
const cutoffDate = new Date(now.getTime() - deps.windowDays * MS_PER_DAY);
const decayedCount = await step.run("decay-stale-patterns", () =>
  deps.memoryStore.decayStale({
    cutoffDate,
    decayAmount: deps.decayAmount,
    floor: deps.floor,
    startOfDay,
  }),
);
```

The enforcer is the store at [`packages/db/src/stores/prisma-deployment-memory-store.ts:116-135`](packages/db/src/stores/prisma-deployment-memory-store.ts):

```ts
const result = await this.prisma.deploymentMemory.updateMany({
  where: {
    lastSeenAt: { lt: input.cutoffDate },
    confidence: { gt: input.floor },
    OR: [{ lastDecayedAt: null }, { lastDecayedAt: { lt: input.startOfDay } }],
  },
  data: { confidence: { decrement: input.decayAmount }, lastDecayedAt: new Date() },
});
return result.count;
```

**How it's used at runtime.** Inngest fires at 07:00 UTC daily, the job computes `cutoffDate = now - 180d`, and the store decrements confidence by 0.1 for every memory row last seen before the cutoff that is still above the 0.3 floor. The returned count feeds a Prometheus-style counter (`outcomePatternsDecayed`). When an agent later scores its memory for surfacing to a customer, the decayed confidence is what gets compared against `SURFACING_THRESHOLD` (`minConfidence: 0.66`, line 85), so decay directly throttles which learned patterns are allowed to influence replies.

**Gotchas / what to study next.** (1) The `OR: [{ lastDecayedAt: null }, { lastDecayedAt: { lt: startOfDay } }]` clause is an _idempotency guard against double-decay within one day_. Because the job is a `set`-style `updateMany` rather than read-modify-write, re-running the cron (Inngest retries, manual replay) would otherwise decay the same row twice. `startOfDay` is UTC-floored, so the guard is "once per UTC calendar day," not "once per 24h." (2) Decay is deliberately a single global `updateMany` with no `organizationId` filter (the comment marks it `store-mutation-global`); this is a cross-tenant batch, which is why the metric only emits aggregate labels and never a `deploymentId`. Study why a learning-memory decay can safely be global while almost every other write in this codebase is org-scoped.

---

### Operational State Freshness Window (operator attestation aging)

**Concept.** Some data can only be vouched for by a human ("our hours are still 9-6, pricing unchanged"). An _attestation of normalcy_ is only trustworthy for a bounded time. This is a freshness gate over a human confirmation timestamp, not over machine data.

**In Switchboard.** The window is 14 days, chosen to equal two weekly-audit cycles. [`packages/schemas/src/operational-state-policy.ts:30-33`](packages/schemas/src/operational-state-policy.ts):

```ts
export const OPERATIONAL_STATE_VOUCH_DAYS = 14;
export const OPERATIONAL_STATE_VOUCH_MS = OPERATIONAL_STATE_VOUCH_DAYS * 24 * 60 * 60 * 1000;
```

The derivation is a three-valued function at [`packages/ad-optimizer/src/revenue-state.ts:111-119`](packages/ad-optimizer/src/revenue-state.ts):

```ts
export function deriveBusinessContextFreshness(
  latest: { confirmedAt: Date } | null,
  now: Date,
): BusinessContextFreshness {
  if (latest === null) return "unknown";
  return now.getTime() - latest.confirmedAt.getTime() <= OPERATIONAL_STATE_VOUCH_MS
    ? "fresh"
    : "stale";
}
```

**How it's used at runtime.** During Riley's weekly ad-optimization audit, `RevenueState` assembly resolves the operator's latest "everything still accurate" confirmation and calls `deriveBusinessContextFreshness`. A `stale` or `unknown` result downshifts recommendations to advisory-only rather than auto-executable: the agent will not pause a campaign on the strength of a two-week-old picture of the business.

**Gotchas / what to study next.** Note the boundary semantics encoded in the comment and the `<=`: a confirmation made _exactly_ 14 days ago still counts as fresh, and a future-dated `confirmedAt` (clock skew) is treated as fresh, never stale. This is a deliberate "fail-toward-trusting-the-human" boundary. Contrast it with the next concept, where the boundary fails _toward distrust_.

---

### Signal Health Freshness Threshold and Pixel Dead Age (machine-signal recency)

**Concept.** Tracking infrastructure (Meta pixel + Conversions API server events) is the platform's eyes. If events stop arriving, every downstream metric silently lies. Two recency checks guard this: a soft "freshness" check (events should be < 1 hour old) and a hard "dead" check (a pixel that has not fired in 24 hours is broken, not slow).

**In Switchboard.** Both thresholds are constants in [`packages/ad-optimizer/src/signal-health-checker.ts:12-13`](packages/ad-optimizer/src/signal-health-checker.ts):

```ts
const PIXEL_DEAD_AGE_MS = 24 * 60 * 60_000;
const FRESHNESS_THRESHOLD_MS = 60 * 60_000;
```

The CAPI freshness producer (lines 238-240):

```ts
const freshnessMs = latestServerTimestampMs === null ? Infinity : now - latestServerTimestampMs;
const isFresh = latestServerTimestampMs !== null && freshnessMs < FRESHNESS_THRESHOLD_MS;
```

The dead-pixel enforcer (lines 313-319):

```ts
function computeIsDead(lastFiredAt: string | null, isUnavailable: boolean, nowMs: number): boolean {
  if (isUnavailable) return true;
  if (!lastFiredAt) return true;
  const ts = Date.parse(lastFiredAt);
  if (Number.isNaN(ts)) return true;
  return nowMs - ts > PIXEL_DEAD_AGE_MS;
}
```

**How it's used at runtime.** The weekly signal-health audit pulls `last_event_time` (CAPI stats) and `last_fired_time` (pixel metadata) from the Meta Graph API, computes the two ages, and emits breach records: `freshness_stale` (CAPI > 1h) feeds a `fix_signal_health` recommendation, and a dead pixel produces a critical `pixel_dead` breach. These run _before_ Riley's decision layer so the operator is told "your tracking is broken" rather than the agent silently optimizing against phantom conversions.

**Gotchas / what to study next.** Both functions encode a "missing means broken" stance: a `null` timestamp produces `freshnessMs = Infinity` / `isFresh = false`, and `computeIsDead` returns `true` for null, unavailable, _and_ unparseable timestamps. This is the opposite boundary from the operator-attestation gate above, and it is correct: absent human attestation means "ask again" (`unknown`), but absent machine signal means "assume the worst." Internalize that the right default for a missing timestamp is domain-specific, not universal. Also note `60 * 60_000` uses a numeric separator on the milliseconds operand, a small readability habit worth copying.

---

### Attribution Window (causal recency, kind-specific)

**Concept.** To learn whether an action _worked_, you measure outcomes in a window around it. Too short and slow-moving metrics never settle; too long and unrelated effects leak in. Different action types need different windows.

**In Switchboard.** Per-kind windows live at [`packages/core/src/recommendations/outcome-attribution-config.ts:1-23`](packages/core/src/recommendations/outcome-attribution-config.ts): `SETTLEMENT_LAG_HOURS = 24`, `pause` uses `windowDays: 7`, `refresh_creative` uses `windowDays: 14`. The producer builds a symmetric interval around the action at [`packages/core/src/recommendations/outcome-attribution.ts:50-53`](packages/core/src/recommendations/outcome-attribution.ts):

```ts
const windowDays = config.windowDays;
const anchorAt = candidate.resolvedAt;
const windowStartedAt = new Date(anchorAt.getTime() - windowDays * MS_PER_DAY);
const windowEndedAt = new Date(anchorAt.getTime() + windowDays * MS_PER_DAY);
```

**How it's used at runtime.** When a recommendation resolves, attribution reads pre-window and post-window Meta metrics, and the 24h settlement lag guarantees the post-window has closed (Meta's numbers stop moving) before the read. A pause is judged on a 7-day spend swing; a creative refresh on a 14-day CTR swing.

**Gotchas / what to study next.** The window is _anchored on the action timestamp_ (`resolvedAt`), not on "now," so attribution is a backward-looking causal window, not a freshness gate. Sparse-data protection (line 58, `sparseThreshold = ceil(windowDays * 0.5)`) flags windows with too few daily rows. Study how settlement lag (a deliberate _delay_ before reading) interacts with the window: freshness usually means "act on the newest data," but here correctness requires _waiting_ for data to age into stability.

---

### Substantiation Staleness Window (compliance-evidence aging)

**Concept.** Regulated claims (medical efficacy, safety) need _recent_ approved evidence. Old approvals may no longer reflect current regulation, so a compliance resolver must reject substantiation that is too old.

**In Switchboard.** [`packages/core/src/governance/classifier/substantiation-resolver.ts:14`](packages/core/src/governance/classifier/substantiation-resolver.ts) defines `STALENESS_WINDOW_MS = 180 * 24 * 60 * 60 * 1000`. The staleness check (lines 116-120) is a _dual_ gate the mapping missed:

```ts
function isStale(claim: ApprovedComplianceClaimRecord, now: Date): boolean {
  if (claim.validUntil && new Date(claim.validUntil).getTime() < now.getTime()) return true;
  if (new Date(claim.reviewedAt).getTime() < now.getTime() - STALENESS_WINDOW_MS) return true;
  return false;
}
```

**How it's used at runtime.** When the governance classifier finds a claim-bearing sentence in agent output, it resolves substantiation against `approved_compliance_claim` records. A claim is rejected as evidence if it has an explicit `validUntil` in the past _or_ was reviewed more than 180 days ago. Only fresh, approved claims clear the gate.

**Gotchas / what to study next.** Two staleness paths coexist: an explicit per-claim expiry (`validUntil`) and an implicit global 180-day window from `reviewedAt`. The explicit one wins when present and can be _shorter_. Whenever you see a "default window plus optional override," check which direction the override is allowed to move the boundary; here it can only tighten, never extend.

---

### In-memory TTL caches: Policy, Spend, Composite Risk, Idempotency, Guardrail State

**Concept.** A TTL cache stores a computed value with an `expiresAt` and serves it until that timestamp passes. It trades bounded staleness for fewer recomputations. Switchboard uses the same `{ value, expiresAt }` shape in five hot paths, all checking `Date.now() > expiresAt` and lazily deleting expired entries on read.

**In Switchboard.**

- **Policy cache**, 60s, [`packages/core/src/policy-cache.ts:3,42,58`](packages/core/src/policy-cache.ts): `get()` deletes and returns `null` past `expiresAt`; `set()` stores `expiresAt = Date.now() + ttlMs`.
- **Spend lookup**, 10s, [`packages/core/src/orchestrator/propose-helpers.ts:89-148`](packages/core/src/orchestrator/propose-helpers.ts): caches daily/weekly/monthly spend aggregated from a 500-envelope scan, keyed by `principalId:organizationId`.
- **Composite risk**, 10s, same file lines 152-195: scans the last 60 minutes of envelopes (200 limit) for correlated high-risk actions.
- **Idempotency guard**, 5min, [`packages/core/src/idempotency/guard.ts:23-54`](packages/core/src/idempotency/guard.ts): key = `sha256(principalId + actionType + sorted JSON params)`.
- **Guardrail state**, configurable TTL, [`packages/core/src/guardrail-state/in-memory.ts:8-49`](packages/core/src/guardrail-state/in-memory.ts): rate-limit counters and cooldowns.

The spend cache shows the canonical read/refresh pattern:

```ts
const cached = spendCache.get(cacheKey);
if (cached && now < cached.expiresAt) return cached.value;
// ... expensive scan ...
spendCache.set(cacheKey, { value: result, expiresAt: now + SPEND_CACHE_TTL_MS });
```

**How it's used at runtime.** During a `propose()` burst (an agent submitting several actions in quick succession), the governance layer needs spend aggregates and composite-risk context for each proposal. Without caching, that is N full envelope scans per burst; the 10s TTL collapses them to one scan plus N cheap map reads, while still re-scanning often enough to catch a _new_ high-risk action within ten seconds. The policy cache similarly short-circuits repeated DB policy lookups, and the idempotency guard returns the cached governance response when an identical request re-arrives within five minutes.

**Gotchas / what to study next.** (1) These are _module-level_ `Map`s (`const spendCache = new Map(...)`), so they are per-process, not shared across the API/chat/dashboard processes. There is an exported `clearProposeCaches()` purely so tests can reset global state; that escape hatch is a tell that the cache is process-global. (2) The 10s window is a deliberate _safety-vs-load_ tradeoff: a freshly executed high-spend action can be invisible to the spend gate for up to 10 seconds. Study whether that window is acceptable for your SLA, and note that the idempotency guard's 5-minute window is much longer because re-arriving _identical_ requests within minutes are almost always retries, not legitimate distinct actions.

---

### Approval TTL and expiry-driven urgency (TTL that creates pressure)

**Concept.** A pending human approval should not block work forever. A TTL here does double duty: it expires stale approvals _and_ its remaining time drives an urgency score that surfaces the most time-critical decisions first.

**In Switchboard.** `DEFAULT_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000` at [`packages/core/src/workflows/workflow-engine.ts:23`](packages/core/src/workflows/workflow-engine.ts). `createApprovalCheckpoint` stamps `expiresAt = now + ttlMs` ([`approval-checkpoint.ts:35`](packages/core/src/workflows/approval-checkpoint.ts)). The enforcer is trivially `checkExpiry` ([`packages/core/src/approval/expiry.ts:3-5`](packages/core/src/approval/expiry.ts), `status === "pending" && now > expiresAt`). The interesting consumer is urgency scoring at [`packages/core/src/decisions/urgency.ts:47-53`](packages/core/src/decisions/urgency.ts):

```ts
const hoursUntilExpiry = (row.expiresAt.getTime() - nowMs) / 3_600_000;
if (hoursUntilExpiry <= 0) return 100;
if (hoursUntilExpiry >= 24) return floor;
return Math.round(100 - (hoursUntilExpiry / 24) * (100 - floor));
```

**How it's used at runtime.** A parked approval starts at a risk-based floor (45-70) and its score ramps linearly to 100 as expiry approaches; `decisionSortComparator` then sorts the operator's queue by score descending, so the closest-to-expiry, highest-risk items float to the top.

**Gotchas / what to study next.** The same `expiresAt` field is read by two unrelated consumers (expiry boolean and urgency ramp). When you change the TTL, you change _both_ behaviors. Note also that this TTL is `expiresAt`-persisted on a row, unlike the in-memory caches above; it survives restarts and is the same modeling choice as the report cache below.

---

### Persisted cache freshness: Report cache (caller-checks-freshness)

**Concept.** Expensive reports (funnel rollups, attribution) are cached in the database with `computedAt`/`expiresAt`. A key design choice: should the _store_ hide stale rows, or return them and let the _caller_ decide?

**In Switchboard.** The interface deliberately returns stale rows. [`packages/core/src/reports/interfaces.ts:18-19`](packages/core/src/reports/interfaces.ts) documents `findByKey` as "Returns the row if present (regardless of freshness)." The Prisma store ([`packages/db/src/stores/prisma-report-cache-store.ts:8-44`](packages/db/src/stores/prisma-report-cache-store.ts)) just reads and maps the row. The freshness decision lives in the consumer at [`apps/api/src/routes/dashboard-reports.ts:150-152`](apps/api/src/routes/dashboard-reports.ts):

```ts
const cached = await app.reportCacheStore.findByKey(orgId, reportWindow);
if (cached && cached.expiresAt > new Date()) {
  return cached.payload;
}
```

On miss or stale, the route recomputes and `upsert`s with `expiresAt = now + CACHE_TTL_MS` (1 hour, line 22/104-109). A `/refresh` route force-invalidates via `invalidate(orgId, window)`.

**How it's used at runtime.** A dashboard report request hits the route, which checks the cache, serves it if `expiresAt` is in the future, otherwise rolls up fresh data and re-caches. This prevents recompute storms when many dashboard tiles request the same window at once.

**Gotchas / what to study next.** The "store returns stale, caller checks freshness" split is a real design lever: it lets one caller serve a slightly-stale row deliberately (graceful degradation) while another insists on freshness, without two store methods. Compare this to the policy cache, where the _store_ enforces TTL and never hands back an expired entry. Both are valid; know which contract you are holding.

---

### Recency filters and time-decay on reads: Contact pipeline, Activity status, Lead intake

**Concept.** Not all freshness is a cache. Sometimes "recent" is just a query filter or a derived status. These are read-time recency signals.

**In Switchboard.**

- **Contact recency filter**, [`packages/db/src/stores/prisma-contact-store.ts:302-320`](packages/db/src/stores/prisma-contact-store.ts): `listForPipeline` filters `lastActivityAt >= activitySince`, orders `DESC`, and returns `{ rows, totalCount }` (a separate `count()`) so the UI badge reflects the true total even when `take` caps the rows.
- **Activity status time decay**, `ACTIVITY_STATUS_STALE_MS = 10 * 60_000` at [`packages/db/src/storage/agent-state-deriver.ts:40,54-64`](packages/db/src/storage/agent-state-deriver.ts): a transient `working`/`analyzing` status decays to `idle` once `now - lastActionAt > 10min`, but non-transient states (`waiting_approval`, `error`) pass through unchanged.
- **Lead intake recency**, [`packages/db/src/stores/lead-intake-store.ts:138-141`](packages/db/src/stores/lead-intake-store.ts): `hasRecentLead(orgId, sourceType, days)` counts contacts with `createdAt >= now - days*24h`, returning a boolean for Gate-0 intake routing.

The activity decay is the subtle one:

```ts
if (!TRANSIENT_STATUSES.has(status)) return status;
if (!lastActionAt) return "idle";
const elapsed = now.getTime() - lastActionAt.getTime();
if (!Number.isFinite(elapsed) || elapsed > ACTIVITY_STATUS_STALE_MS) return "idle";
return status;
```

**How it's used at runtime.** The agent-home UI derives each agent's live status from its event log; a stuck `working` claim from 11 minutes ago decays to `idle`, while a real `waiting_approval` persists, so an operator sees who is genuinely blocked versus merely dormant. The contact pipeline tile shows only recently-active contacts, newest first. Lead-intake Gate-0 checks per-source recency (e.g. ctwa 7d, instant_form 14d) before triggering intake workflows.

**Gotchas / what to study next.** The `!Number.isFinite(elapsed)` guard is load-bearing and reflects a repo-wide lesson: a raw `elapsed > stale` comparison is `false` for `NaN`, so a missing or invalid timestamp would _silently read as fresh_. Decaying-to-idle on non-finite age is the safe default. This is the same NaN-blind-comparison hazard that appears in the signal-health and OAuth checks below; once you see it, you will start guarding every external-timestamp comparison with `Number.isFinite`.

---

### OAuth state freshness (security replay window)

**Concept.** A freshness window can be a _security_ control: a signed, timestamped token that is only valid for a short window defeats replay attacks.

**In Switchboard.** `STATE_MAX_AGE_MS = 10 * 60 * 1000` at [`packages/ad-optimizer/src/facebook-oauth.ts:30`](packages/ad-optimizer/src/facebook-oauth.ts). `buildSignedState` embeds an issued-at into an HMAC-signed payload; `verifySignedState` (lines 58-85) recomputes the HMAC, constant-time-compares, then enforces the window:

```ts
const issuedAt = parseInt(payload.slice(sep + 1), 36);
if (!Number.isFinite(issuedAt)) return null;
const age = Date.now() - issuedAt;
if (age < 0 || age > maxAgeMs) return null;
```

**How it's used at runtime.** When an operator clicks "connect Facebook," the API signs a `state` bound to the `deploymentId` and the current time. On callback, `verifySignedState` rejects the request if the signature fails, the timestamp is unparseable, the age is negative (future-dated), or older than 10 minutes. Only then does the callback trust the embedded `deploymentId` without a Bearer token.

**Gotchas / what to study next.** Three things make this a security window rather than a convenience cache: the value is _signed_ (tampering is detected before the age check), `age < 0` is rejected (a future timestamp is suspicious, not lenient, unlike the operator-attestation gate), and the comparison is again `Number.isFinite`-guarded. Study the ordering: signature verification happens _before_ the freshness check, so an attacker cannot even reach the age logic with a forged timestamp. Freshness is the last gate, not the first.
