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
  const CONFIDENCE_BUCKETS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];
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
    outcomePatternConfidence: new PromHistogram(
      "switchboard_outcome_pattern_confidence",
      "Post-write confidence distribution for outcome-pattern memories",
      OUTCOME_PATTERN_LABELS,
      CONFIDENCE_BUCKETS,
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
