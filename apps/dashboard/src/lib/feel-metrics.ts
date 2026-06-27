/**
 * Falsifiability instrumentation for the §2 "feel" metrics
 * (UI/UX feel audit, docs/audits/2026-06-02-ui-ux-feel-audit/direction.md).
 *
 * Deliberately NOT a full analytics pipeline — the dashboard has no client
 * analytics today. This is a tiny typed emitter whose default sink is
 * console.warn (repo-legal; no console.log). Swap it via setEmitter() to route
 * to a real sink (e.g. a Sentry breadcrumb or a POST) without touching call
 * sites. The point is that later waves can assert these events fire in tests.
 */

export type FeelMetricName =
  | "false_inbox_zero" // app showed "that's everything" while pending items exist
  | "stale_count_incident" // header count !== visible list after an action
  | "approve_to_feedback_ms" // commit -> card moves + count drops (Doherty < 100ms)
  | "queue_clear_ms"; // time to clear a morning queue

export interface FeelMetricPayloads {
  false_inbox_zero: { serverCount: number; renderedEmpty: boolean; filtered: boolean };
  stale_count_incident: { headerCount: number; listLength: number; agentFilter: string | null };
  approve_to_feedback_ms: { latencyMs: number; decisionKind: string; agentKey: string };
  queue_clear_ms: { durationMs: number; itemsCleared: number };
}

export interface FeelMetricsEmitter {
  emit<K extends FeelMetricName>(name: K, payload: FeelMetricPayloads[K]): void;
}

const defaultEmitter: FeelMetricsEmitter = {
  emit(name, payload) {
    // console.warn is the repo-legal logger. Replace with a real sink via
    // setEmitter() when one exists; until then this keeps events observable.
    console.warn("[feel-metrics]", name, payload);
  },
};

let current: FeelMetricsEmitter = defaultEmitter;

/** Swap the metrics sink. Pass null to restore the default console.warn sink. */
export function setEmitter(emitter: FeelMetricsEmitter | null): void {
  current = emitter ?? defaultEmitter;
}

export const feelMetrics: FeelMetricsEmitter = {
  emit(name, payload) {
    current.emit(name, payload);
  },
};
