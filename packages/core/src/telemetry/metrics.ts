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
  /** F15 — a policy-critical context slot (business-facts, claim-boundaries)
   *  resolved EMPTY for an entitled org running Alex. Observability-only: the
   *  slot still degrades to "" (fail-open per skills/alex/SKILL.md). Labeled by
   *  orgId + slot. */
  policyContextSlotEmpty: Counter;
  skillLlmTokensTotal: Counter;
  skillLlmCostUsdTotal: Counter;
  governanceVerdictsRecorded: Counter;
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
    policyContextSlotEmpty: new InMemoryCounter(),
    skillLlmTokensTotal: new InMemoryCounter(),
    skillLlmCostUsdTotal: new InMemoryCounter(),
    governanceVerdictsRecorded: new InMemoryCounter(),
  };
}
