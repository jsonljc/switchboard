import client from "prom-client";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { SwitchboardMetrics, Counter, Histogram } from "@switchboard/core";

const register = new client.Registry();
client.collectDefaultMetrics({ register });

class PromCounter implements Counter {
  private counter: client.Counter;
  constructor(name: string, help: string, labelNames: string[]) {
    this.counter = new client.Counter({ name, help, labelNames, registers: [register] });
  }
  inc(labels?: Record<string, string>, value?: number): void {
    if (labels) {
      this.counter.inc(labels, value ?? 1);
    } else {
      this.counter.inc(value ?? 1);
    }
  }
}

class PromHistogram implements Histogram {
  private histogram: client.Histogram;
  constructor(name: string, help: string, labelNames: string[], buckets?: number[]) {
    this.histogram = new client.Histogram({
      name,
      help,
      labelNames,
      buckets,
      registers: [register],
    });
  }
  observe(labels: Record<string, string>, value: number): void {
    this.histogram.observe(labels, value);
  }
}

const COUNTER_LABELS = ["cartridge_id", "action_type"];
const HISTOGRAM_LABELS = ["cartridge_id"];
const LATENCY_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

export function createPromMetrics(): SwitchboardMetrics {
  const OUTCOME_PATTERN_LABELS = ["deployment_id"];
  const OUTCOME_PATTERN_TIER_LABELS = ["deployment_id", "attribution_tier"];
  const OUTCOME_PATTERN_REJECTED_LABELS = ["deployment_id", "reason"];
  const OUTCOME_PATTERN_COLLISION_LABELS = ["deployment_id", "current_key", "colliding_key"];
  // Labels are camelCase (matches the call site in executeDailyPatternDecay).
  // The carry-debt observability PR will retro-rename the older snake_case
  // outcome-pattern label sets to match.
  const OUTCOME_PATTERN_DECAYED_LABELS = ["deploymentTier", "canonicalCategory"];
  const CONFIDENCE_BUCKETS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];
  const FILL_RATIO_BUCKETS = [0.25, 0.5, 0.75, 0.9, 1.0];
  return {
    proposalsTotal: new PromCounter(
      "switchboard_proposals_total",
      "Total action proposals",
      COUNTER_LABELS,
    ),
    proposalsDenied: new PromCounter(
      "switchboard_proposals_denied_total",
      "Denied proposals",
      COUNTER_LABELS,
    ),
    approvalsCreated: new PromCounter(
      "switchboard_approvals_created_total",
      "Approvals created",
      COUNTER_LABELS,
    ),
    approvalsExpired: new PromCounter(
      "switchboard_approvals_expired_total",
      "Approvals expired",
      COUNTER_LABELS,
    ),
    executionsTotal: new PromCounter(
      "switchboard_executions_total",
      "Total executions",
      COUNTER_LABELS,
    ),
    executionsSuccess: new PromCounter(
      "switchboard_executions_success_total",
      "Successful executions",
      COUNTER_LABELS,
    ),
    executionsFailed: new PromCounter(
      "switchboard_executions_failed_total",
      "Failed executions",
      COUNTER_LABELS,
    ),
    circuitBreakerTrips: new PromCounter(
      "switchboard_circuit_breaker_trips_total",
      "Circuit breaker trips to open state",
      ["service"],
    ),
    proposalLatencyMs: new PromHistogram(
      "switchboard_proposal_latency_ms",
      "Proposal latency in ms",
      HISTOGRAM_LABELS,
      LATENCY_BUCKETS,
    ),
    approvalLatencyMs: new PromHistogram(
      "switchboard_approval_latency_ms",
      "Approval latency in ms",
      HISTOGRAM_LABELS,
      LATENCY_BUCKETS,
    ),
    executionLatencyMs: new PromHistogram(
      "switchboard_execution_latency_ms",
      "Execution latency in ms",
      HISTOGRAM_LABELS,
      LATENCY_BUCKETS,
    ),
    policyEngineLatencyMs: new PromHistogram(
      "switchboard_policy_engine_latency_ms",
      "Policy engine evaluation latency in ms",
      HISTOGRAM_LABELS,
      LATENCY_BUCKETS,
    ),
    outcomePatternsExtracted: new PromCounter(
      "switchboard_outcome_patterns_extracted_total",
      "Outcome patterns extracted from booked conversations, by attribution tier",
      OUTCOME_PATTERN_TIER_LABELS,
    ),
    outcomePatternsMerged: new PromCounter(
      "switchboard_outcome_patterns_merged_total",
      "Outcome patterns that incremented an existing DeploymentMemory entry",
      OUTCOME_PATTERN_LABELS,
    ),
    outcomePatternsCreated: new PromCounter(
      "switchboard_outcome_patterns_created_total",
      "Outcome patterns that created a new DeploymentMemory entry",
      OUTCOME_PATTERN_LABELS,
    ),
    outcomePatternsSurfaced: new PromCounter(
      "switchboard_outcome_patterns_surfaced_total",
      "Skill executions where at least one outcome pattern was injected",
      OUTCOME_PATTERN_LABELS,
    ),
    outcomePatternsRejected: new PromCounter(
      "switchboard_outcome_patterns_rejected_total",
      "Outcome patterns dropped during extraction; reason ∈ {invalid_canonical_key, unknown_canonical_key}",
      OUTCOME_PATTERN_REJECTED_LABELS,
    ),
    outcomePatternsCrossKeyCollision: new PromCounter(
      "switchboard_outcome_patterns_cross_key_collision_total",
      "Cross-canonical-key cosine match above legacy 0.92 — review signal for enum granularity",
      OUTCOME_PATTERN_COLLISION_LABELS,
    ),
    outcomePatternsDecayed: new PromCounter(
      "switchboard_outcome_patterns_decayed_total",
      "Pattern rows whose confidence was decreased during the daily decay sweep",
      OUTCOME_PATTERN_DECAYED_LABELS,
    ),
    outcomePatternConfidence: new PromHistogram(
      "switchboard_outcome_pattern_confidence",
      "Post-write confidence distribution for outcome-pattern memories",
      OUTCOME_PATTERN_LABELS,
      CONFIDENCE_BUCKETS,
    ),
    slotQueryZeroResult: new PromCounter(
      "switchboard_slot_query_zero_result_total",
      "Alex slots.query calls that returned zero available slots",
      ["orgId", "service"],
    ),
    rawErrorFallback: new PromCounter(
      "switchboard_raw_error_fallback_total",
      "Failed Alex turns where the raw error was suppressed and a neutral fallback sent",
      ["deploymentId", "code"],
    ),
    bookingConfirmed: new PromCounter(
      "switchboard_booking_confirmed_total",
      "Bookings confirmed (calendar event created + booking persisted in the confirm tx)",
      ["orgId"],
    ),
    bookingFailed: new PromCounter(
      "switchboard_booking_failed_total",
      "Booking attempts that failed; reason ∈ {provider_error, duplicate, confirmation_failed}",
      ["orgId", "reason"],
    ),
    bookingStageAdvanced: new PromCounter(
      "switchboard_booking_stage_advanced_total",
      "Bookings where the linked opportunity was advanced to the booked stage",
      ["orgId"],
    ),
    bookingSlotConflict: new PromCounter(
      "switchboard_booking_slot_conflict_total",
      "Booking attempts rejected because the slot was taken concurrently (retryable re-offer)",
      ["orgId"],
    ),
    bookingReschedule: new PromCounter(
      "switchboard_booking_reschedule_total",
      "Bookings rescheduled to a new slot",
      ["orgId"],
    ),
    bookingCancel: new PromCounter("switchboard_booking_cancel_total", "Bookings cancelled", [
      "orgId",
    ]),
    bookingConsentBlocked: new PromCounter(
      "switchboard_booking_consent_blocked_total",
      "Booking attempts blocked by the flag-gated consent precondition (enforce mode)",
      ["orgId", "reason"],
    ),
    bookedValueResolution: new PromCounter(
      "switchboard_booked_value_resolution_total",
      "Booked-value resolution outcome per booking.create attempt; outcome in {resolved, no_playbook, no_match, matched_unpriced, no_lookup, read_error}. `resolved` measures catalog alignment (the booked service matched a priced playbook entry), narrower than end-to-end booked-value coverage",
      ["orgId", "outcome"],
    ),
    policyContextSlotEmpty: new PromCounter(
      "switchboard_policy_context_slot_empty_total",
      "A policy-critical Alex context slot resolved empty for an entitled org (fail-open; output unchanged)",
      ["orgId", "slot"],
    ),
    skillLlmTokensTotal: new PromCounter(
      "switchboard_skill_llm_tokens_total",
      "LLM tokens per skill execution, labeled by model and kind (input/output/cache_read/cache_creation)",
      ["model", "kind"],
    ),
    skillLlmCostUsdTotal: new PromCounter(
      "switchboard_skill_llm_cost_usd_total",
      "Per-execution LLM cost in USD, by model",
      ["model"],
    ),
    governanceVerdictsRecorded: new PromCounter(
      "switchboard_governance_verdicts_total",
      "Governance gate verdicts persisted, by deployment, source guard, action, and audit level",
      ["deployment_id", "source_guard", "action", "audit_level"],
    ),
    whatsappProactiveSendSkipped: new PromCounter(
      "switchboard_whatsapp_proactive_send_skipped_total",
      "Proactive WhatsApp send skipped for an infra reason (reason=config_missing => no send token/phone id, the whole deployment dark-funnels); distinct from benign per-contact skips",
      ["intent", "reason"],
    ),
    robinRecoverySendFailed: new PromCounter(
      "switchboard_robin_recovery_send_failed_total",
      "Robin recovery sends that exhausted bounded retries and dead-lettered (terminal failed); labeled by intent + reason",
      ["intent", "reason"],
    ),
    llmCacheCallsTotal: new PromCounter(
      "switchboard_llm_cache_calls_total",
      "Per-LLM-call prompt-cache effectiveness by model and outcome (hit/populate/miss); a sustained miss rate is the silent cache-invalidation signal",
      ["model", "outcome"],
    ),
    skillContextFillRatio: new PromHistogram(
      "switchboard_skill_context_fill_ratio",
      "Per-skill-loop-turn context-fill ratio (billable tokens / maxTotalTokens) by model",
      ["model"],
      FILL_RATIO_BUCKETS,
    ),
  };
}

// --- Conversion pipeline metrics ---

export interface ConversionPipelineMetrics {
  outboxPublishSuccess: Counter;
  outboxPublishFailure: Counter;
  conversionRecordWriteSuccess: Counter;
  conversionRecordWriteFailure: Counter;
}

const CONVERSION_LABELS = ["event_type"];

export function createConversionPipelineMetrics(): ConversionPipelineMetrics {
  return {
    outboxPublishSuccess: new PromCounter(
      "switchboard_outbox_publish_success_total",
      "Outbox events successfully published to bus",
      CONVERSION_LABELS,
    ),
    outboxPublishFailure: new PromCounter(
      "switchboard_outbox_publish_failure_total",
      "Outbox events that failed to publish",
      CONVERSION_LABELS,
    ),
    conversionRecordWriteSuccess: new PromCounter(
      "switchboard_conversion_record_write_success_total",
      "Conversion records successfully persisted",
      CONVERSION_LABELS,
    ),
    conversionRecordWriteFailure: new PromCounter(
      "switchboard_conversion_record_write_failure_total",
      "Conversion record write failures",
      CONVERSION_LABELS,
    ),
  };
}

// Outbox backlog gauge — set by the outbox publisher bootstrap
let outboxBacklogSampler: (() => Promise<number>) | null = null;

const outboxBacklogGauge = new client.Gauge({
  name: "switchboard_outbox_backlog_size",
  help: "Number of pending outbox events",
  registers: [register],
  async collect() {
    if (outboxBacklogSampler) {
      this.set(await outboxBacklogSampler());
    }
  },
});

// Suppress unused-variable lint — the gauge self-registers with the registry
void outboxBacklogGauge;

export function setOutboxBacklogSampler(sampler: () => Promise<number>): void {
  outboxBacklogSampler = sampler;
}

export async function metricsRoute(_request: FastifyRequest, reply: FastifyReply) {
  const metrics = await register.metrics();
  return reply.type(register.contentType).send(metrics);
}
