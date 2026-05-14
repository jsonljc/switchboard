/**
 * Lightweight telemetry emitter for /approvals.
 *
 * Calls `window.__switchboardTelemetry(event)` when present, otherwise no-ops.
 * This is a stub so the page can emit useful operator-behavior signals once
 * a real telemetry sink is wired into the dashboard. Until then the events
 * are inert.
 */
export type ApprovalsTelemetryEvent =
  | { type: "approvals.viewed"; pendingCount: number }
  | { type: "approvals.row_selected"; id: string; riskCategory: string }
  | { type: "approvals.code_copied"; id: string }
  | { type: "approvals.approve_clicked"; id: string; riskCategory: string; quorum: boolean }
  | { type: "approvals.advanced_json_opened"; id: string }
  | { type: "approvals.patch_submitted"; id: string; changedKeys: string[] }
  | { type: "approvals.reject_clicked"; id: string }
  | { type: "approvals.expired_during_view"; id: string }
  | { type: "approvals.conflict_409"; id: string };

type Sink = (event: ApprovalsTelemetryEvent) => void;

interface WindowWithSink {
  __switchboardTelemetry?: Sink;
}

export function emit(event: ApprovalsTelemetryEvent): void {
  if (typeof window === "undefined") return;
  const sink = (window as unknown as WindowWithSink).__switchboardTelemetry;
  if (typeof sink === "function") sink(event);
}
