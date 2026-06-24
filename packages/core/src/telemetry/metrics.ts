/**
 * Lightweight metrics abstraction compatible with Prometheus/prom-client.
 * When prom-client is installed, use createPromMetrics() to wire real counters.
 * Otherwise falls back to in-memory counters for testing/inspection.
 */

export interface SwitchboardMetrics {
  proposalsTotal: Counter;
  proposalsDenied: Counter;
  approvalsCreated: Counter;
  approvalsExpired: Counter;
  executionsTotal: Counter;
  executionsSuccess: Counter;
  executionsFailed: Counter;
  circuitBreakerTrips: Counter;
  proposalLatencyMs: Histogram;
  approvalLatencyMs: Histogram;
  executionLatencyMs: Histogram;
  policyEngineLatencyMs: Histogram;
  outcomePatternsExtracted: Counter;
  outcomePatternsMerged: Counter;
  outcomePatternsCreated: Counter;
  outcomePatternsSurfaced: Counter;
  outcomePatternsRejected: Counter;
  outcomePatternsCrossKeyCollision: Counter;
  outcomePatternsDecayed: Counter;
  outcomePatternConfidence: Histogram;
  slotQueryZeroResult: Counter;
  rawErrorFallback: Counter;
  bookingConfirmed: Counter;
  bookingFailed: Counter;
  bookingStageAdvanced: Counter;
  bookingSlotConflict: Counter;
  bookingReschedule: Counter;
  bookingCancel: Counter;
  /** F15 — booking attempts blocked by the flag-gated consent precondition
   *  (enforce mode only). Labeled by orgId + reason (consent_pending/consent_revoked). */
  bookingConsentBlocked: Counter;
  /** D3-1 booked-value resolution OUTCOME per booking.create attempt that reaches
   *  value resolution (i.e. after the contact/consent/provider checks pass). Makes
   *  the prod match-vs-abstain rate observable: outcome in {resolved, no_playbook,
   *  no_match, matched_unpriced, no_lookup, read_error}. The match-vs-abstain rate
   *  is the share of `resolved` across the outcomes, self-contained regardless of
   *  pre-resolution aborts. Observability-only; the resolver still abstains (null
   *  value) for every non-resolved outcome. NOTE: `resolved` measures CATALOG
   *  ALIGNMENT (the booked service matched a priced playbook entry), which is
   *  narrower than end-to-end booked-value coverage (that also needs the org to have
   *  a priced playbook and Alex to emit the matching service name). Labeled by orgId
   *  + outcome. */
  bookedValueResolution: Counter;
  /** F15 — a policy-critical context slot (business-facts, claim-boundaries)
   *  resolved EMPTY for an entitled org running Alex. Observability-only: the
   *  slot still degrades to "" (fail-open per skills/alex/SKILL.md). Labeled by
   *  orgId + slot. */
  policyContextSlotEmpty: Counter;
  skillLlmTokensTotal: Counter;
  skillLlmCostUsdTotal: Counter;
  governanceVerdictsRecorded: Counter;
  /** A proactive WhatsApp send (reminder/greeting/follow-up/Robin recovery) was
   *  skipped for an INFRASTRUCTURE reason rather than a per-contact eligibility
   *  decision. The dark-funnel signal: reason="config_missing" means the api service
   *  has no WhatsApp send token (neither WHATSAPP_ACCESS_TOKEN nor WHATSAPP_TOKEN) or
   *  no WHATSAPP_PHONE_NUMBER_ID, so EVERY send for the whole deployment silently
   *  no-ops; reason="org_phone_missing" means a tenant's own WhatsApp connection has
   *  no phone number id, so its campaign fails CLOSED org-wide rather than borrow a
   *  global/pilot number (a multi-tenant isolation guard, not an env gap). Distinct
   *  from the benign per-contact skips (unsupported_channel, consent_pending,
   *  missing_contact_phone …) which are recorded only as the work outcome's
   *  skipReason, never on this counter. Labeled by intent + reason. */
  whatsappProactiveSendSkipped: Counter;
  /** A Robin no-show recovery send EXHAUSTED its bounded retries (or hit a terminal config gap at
   *  retry) and dead-lettered (status=failed, nextRetryAt cleared). The never-silent per-recipient
   *  terminal-failure signal; a sustained rate (or the high-ratio cron alert) is a send-path outage.
   *  Labeled by intent + reason (max_retries_exhausted | permanent_send_error | config_missing |
   *  org_phone_missing | context_resolve_failed). permanent_send_error is a 4xx Graph failure that
   *  dead-lettered immediately without consuming the retry budget (D4: retry transient only). */
  robinRecoverySendFailed: Counter;
  /** Riley reallocate pre-write blast-radius cap evaluation OUTCOME, emitted once per
   *  `assertWithinBlastRadius` call in the reallocate executor (the ONLY active blast-radius
   *  protection). outcome in {within_cap, delta_cap, share_cap} mirrors the verdict union;
   *  share_cap also covers an unsizable/non-finite account spend (fails closed). Detective
   *  control (A6/D3): makes the cap accept-vs-refuse rate observable. Reachability EQUALS the
   *  reallocate executor's: it fires only when the executor runs, gated behind
   *  RILEY_REALLOCATE_SELF_EXECUTION_ENABLED (default OFF). NOT a separate flag, NOT observable
   *  while the executor is dark. Labeled by orgId + outcome. */
  rileyReallocationCapEvaluated: Counter;
  /** Per-LLM-call prompt-cache effectiveness, labeled by model + outcome:
   *  hit (cache_read>0), populate (read=0, creation>0 — benign first-touch of a
   *  prefix), miss (read=0 AND creation=0 — a cacheable static prefix that neither
   *  hit nor populated the cache: below the per-tier min-cacheable size, or a
   *  silently busted / non-deterministic prefix). A sustained outcome=miss rate is
   *  the silent cache-invalidation alert. Emitted per call by recordLlmCacheEffectiveness. */
  llmCacheCallsTotal: Counter;
  /** Per-skill-loop-turn context-fill ratio: billable (uncached input+output)
   *  tokens / the skill runtime's maxTotalTokens budget. A rising distribution is
   *  the "long loops are filling the window" signal (context-rot risk, f9/f10).
   *  Labeled by model. Emitted per turn by recordSkillContextFill. */
  skillContextFillRatio: Histogram;
}

export interface Counter {
  inc(labels?: Record<string, string>, value?: number): void;
}

export interface Histogram {
  observe(labels: Record<string, string>, value: number): void;
}

class InMemoryCounter implements Counter {
  private value = 0;
  inc(_labels?: Record<string, string>, amount = 1): void {
    this.value += amount;
  }
  get(): number {
    return this.value;
  }
}

class InMemoryHistogram implements Histogram {
  private values: number[] = [];
  observe(_labels: Record<string, string>, value: number): void {
    this.values.push(value);
  }
  getValues(): number[] {
    return [...this.values];
  }
}

let activeMetrics: SwitchboardMetrics | null = null;

export function setMetrics(metrics: SwitchboardMetrics): void {
  activeMetrics = metrics;
}

export function getMetrics(): SwitchboardMetrics {
  if (!activeMetrics) {
    activeMetrics = createInMemoryMetrics();
  }
  return activeMetrics;
}

export function createInMemoryMetrics(): SwitchboardMetrics {
  return {
    proposalsTotal: new InMemoryCounter(),
    proposalsDenied: new InMemoryCounter(),
    approvalsCreated: new InMemoryCounter(),
    approvalsExpired: new InMemoryCounter(),
    executionsTotal: new InMemoryCounter(),
    executionsSuccess: new InMemoryCounter(),
    executionsFailed: new InMemoryCounter(),
    circuitBreakerTrips: new InMemoryCounter(),
    proposalLatencyMs: new InMemoryHistogram(),
    approvalLatencyMs: new InMemoryHistogram(),
    executionLatencyMs: new InMemoryHistogram(),
    policyEngineLatencyMs: new InMemoryHistogram(),
    outcomePatternsExtracted: new InMemoryCounter(),
    outcomePatternsMerged: new InMemoryCounter(),
    outcomePatternsCreated: new InMemoryCounter(),
    outcomePatternsSurfaced: new InMemoryCounter(),
    outcomePatternsRejected: new InMemoryCounter(),
    outcomePatternsCrossKeyCollision: new InMemoryCounter(),
    outcomePatternsDecayed: new InMemoryCounter(),
    outcomePatternConfidence: new InMemoryHistogram(),
    slotQueryZeroResult: new InMemoryCounter(),
    rawErrorFallback: new InMemoryCounter(),
    bookingConfirmed: new InMemoryCounter(),
    bookingFailed: new InMemoryCounter(),
    bookingStageAdvanced: new InMemoryCounter(),
    bookingSlotConflict: new InMemoryCounter(),
    bookingReschedule: new InMemoryCounter(),
    bookingCancel: new InMemoryCounter(),
    bookingConsentBlocked: new InMemoryCounter(),
    bookedValueResolution: new InMemoryCounter(),
    policyContextSlotEmpty: new InMemoryCounter(),
    skillLlmTokensTotal: new InMemoryCounter(),
    skillLlmCostUsdTotal: new InMemoryCounter(),
    governanceVerdictsRecorded: new InMemoryCounter(),
    whatsappProactiveSendSkipped: new InMemoryCounter(),
    robinRecoverySendFailed: new InMemoryCounter(),
    rileyReallocationCapEvaluated: new InMemoryCounter(),
    llmCacheCallsTotal: new InMemoryCounter(),
    skillContextFillRatio: new InMemoryHistogram(),
  };
}

export type LlmCacheOutcome = "hit" | "populate" | "miss";

/**
 * Classify and record a single LLM call's prompt-cache effectiveness, returning
 * the outcome. `miss` (the static cacheable prefix neither read from nor wrote to
 * the cache) is the silent-invalidation signal — it also emits a console.warn so a
 * zero-read regression (a non-deterministic tool/prefix order, or a prefix below
 * the per-tier min-cacheable size) is visible in logs, not just metrics. Recorded
 * PER CALL (not summed per execution) so a mid-conversation cache bust is caught,
 * not blurred. Pass finite token counts (callers coerce the SDK's optional
 * cache_*_input_tokens with `?? 0`).
 */
export function recordLlmCacheEffectiveness(input: {
  model: string;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}): LlmCacheOutcome {
  const outcome: LlmCacheOutcome =
    input.cacheReadTokens > 0 ? "hit" : input.cacheCreationTokens > 0 ? "populate" : "miss";
  getMetrics().llmCacheCallsTotal.inc({ model: input.model, outcome });
  if (outcome === "miss") {
    console.warn(
      `[llm-cache] zero-read miss for model=${input.model}: a cacheable static ` +
        `prefix neither read from nor populated the prompt cache (below the ` +
        `per-tier min-cacheable size, or a busted / non-deterministic prefix).`,
    );
  }
  return outcome;
}

/**
 * Record a single skill-loop turn's context-fill ratio (billable tokens / the
 * runtime's maxTotalTokens budget) on the skillContextFillRatio histogram and
 * return the ratio. Instruments how full long multi-turn loops drive the context
 * window (findings f9/f10). NaN-safe and fail-quiet: a non-finite or non-positive
 * maxTokens (or a non-finite billable count) yields ratio 0 and observes nothing,
 * so a missing budget never produces a misleading observation
 * (feedback_nan_blind_comparison_gates). Observability-only; never gates.
 */
export function recordSkillContextFill(input: {
  model: string;
  billableTokens: number;
  maxTokens: number;
}): number {
  if (
    !Number.isFinite(input.maxTokens) ||
    input.maxTokens <= 0 ||
    !Number.isFinite(input.billableTokens)
  ) {
    return 0;
  }
  const ratio = input.billableTokens / input.maxTokens;
  getMetrics().skillContextFillRatio.observe({ model: input.model }, ratio);
  return ratio;
}
