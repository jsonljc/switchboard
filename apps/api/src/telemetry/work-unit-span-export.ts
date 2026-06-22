import {
  projectWorkUnitSpans,
  getTracer,
  type WorkUnitSpanInput,
  type WorkUnitExecution,
} from "@switchboard/core";

/** Structural subset of a findByWorkUnitId row (avoids importing the store-local mirror type). */
export interface ExecutionTraceRow {
  organizationId?: string;
  deploymentId?: string;
  skillSlug?: string;
  skillVersion?: string;
  sessionId?: string;
  status?: string;
  durationMs?: number;
  turnCount?: number;
  createdAt?: Date | string | number;
  tokenUsage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheCreation?: number;
    costUsd?: number;
    model?: string;
  };
  toolCalls?: unknown[];
}

/** FLAT enrichment passed to the mapper (already lifted out of WorkTrace.trace). */
export interface WorkTraceSummary {
  organizationId?: string;
  intent?: string;
  governanceOutcome?: string;
  outcome?: string;
  riskScore?: number;
  durationMs?: number;
  requestedAt?: string;
  completedAt?: string;
}

/**
 * Structural subset of core's `WorkTraceReadResult` (= `{ trace: WorkTrace; integrity }`).
 * getByWorkUnitId returns the WorkTrace fields UNDER `.trace` — NOT flat. Fields are loose/optional
 * so the REAL `WorkTraceStore.getByWorkUnitId(): Promise<WorkTraceReadResult | null>` return is
 * assignable here when E4c wires the live store. (governanceOutcome/outcome are string unions on
 * WorkTrace -> assignable to string; if a field is not string-assignable, String()-coerce in the body.)
 */
export interface WorkTraceReadLike {
  trace: {
    organizationId?: string;
    intent?: string;
    governanceOutcome?: string;
    outcome?: string;
    riskScore?: number;
    durationMs?: number;
    requestedAt?: string;
    completedAt?: string;
  };
}

export interface WorkUnitSpanExportDeps {
  executionTraceStore: {
    findByWorkUnitId(orgId: string, workUnitId: string): Promise<ExecutionTraceRow[]>;
  };
  workTraceStore?: {
    getByWorkUnitId(workUnitId: string): Promise<WorkTraceReadLike | null>;
  };
}

/** ISO string, Date, or numeric epoch -> epoch milliseconds; undefined when unparseable. */
function toEpochMs(value: Date | string | number | undefined): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : undefined;
  }
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : undefined;
  }
  return undefined;
}

export function mapExecutionTracesToSpanInput(
  workUnitId: string,
  traces: ReadonlyArray<ExecutionTraceRow>,
  workTrace?: WorkTraceSummary,
): WorkUnitSpanInput {
  const first = traces[0];
  const executions: WorkUnitExecution[] = traces.map((t) => ({
    skillSlug: t.skillSlug,
    skillVersion: t.skillVersion,
    sessionId: t.sessionId,
    status: t.status,
    durationMs: t.durationMs,
    turnCount: t.turnCount,
    model: t.tokenUsage?.model,
    inputTokens: t.tokenUsage?.input,
    outputTokens: t.tokenUsage?.output,
    createdAtMs: toEpochMs(t.createdAt),
    cacheReadTokens: t.tokenUsage?.cacheRead,
    cacheCreationTokens: t.tokenUsage?.cacheCreation,
    costUsd: t.tokenUsage?.costUsd,
    // toolCalls is unknown[] from JSON; the core projection guards each field defensively.
    toolCalls: (t.toolCalls ?? []) as WorkUnitExecution["toolCalls"],
  }));
  return {
    workUnit: {
      workUnitId,
      organizationId: workTrace?.organizationId ?? first?.organizationId,
      deploymentId: first?.deploymentId,
      intent: workTrace?.intent,
      governanceOutcome: workTrace?.governanceOutcome,
      outcome: workTrace?.outcome,
      riskScore: workTrace?.riskScore,
      durationMs: workTrace?.durationMs,
      requestedAtMs: toEpochMs(workTrace?.requestedAt),
      completedAtMs: toEpochMs(workTrace?.completedAt),
    },
    executions,
  };
}

export function isWorkUnitTracingEnabled(): boolean {
  return Boolean(process.env["OTEL_EXPORTER_OTLP_ENDPOINT"]);
}

export async function exportWorkUnitSpans(
  deps: WorkUnitSpanExportDeps,
  orgId: string,
  workUnitId: string,
): Promise<void> {
  if (!isWorkUnitTracingEnabled()) return;
  const traces = await deps.executionTraceStore.findByWorkUnitId(orgId, workUnitId);

  // Lift the (tenant-guarded) WorkTrace enrichment. Fetched even with zero execution rows so a
  // non-executing work unit (deny / require_approval / governance-error: a WorkTrace but no
  // ExecutionTrace rows) still renders a root-only span. getByWorkUnitId returns
  // WorkTraceReadResult = { trace, integrity }; enrichment fields live under .trace.
  let workTrace: WorkTraceSummary | undefined;
  const wt = await deps.workTraceStore?.getByWorkUnitId(workUnitId);
  // tenant guard: only enrich from a WorkTrace that belongs to the same org (no cross-tenant leak).
  if (wt && wt.trace.organizationId === orgId) {
    workTrace = {
      organizationId: wt.trace.organizationId,
      intent: wt.trace.intent,
      governanceOutcome: wt.trace.governanceOutcome,
      outcome: wt.trace.outcome,
      riskScore: wt.trace.riskScore,
      durationMs: wt.trace.durationMs,
      requestedAt: wt.trace.requestedAt,
      completedAt: wt.trace.completedAt,
    };
  }

  // Nothing to render: no execution rows AND no tenant-matched WorkTrace (true no-op).
  if (traces.length === 0 && !workTrace) return;

  // Zero traces + a WorkTrace -> a root-only span (governance outcome / status / org). With rows,
  // the full work-unit -> execution -> tool waterfall (unchanged).
  projectWorkUnitSpans(mapExecutionTracesToSpanInput(workUnitId, traces, workTrace), getTracer());
}

/**
 * Build the PlatformIngress onWorkUnitComplete hook: a fire-and-forget, error-swallowing
 * span export for a processed work unit. Wire in app.ts ONLY when tracing is enabled.
 * The export is read-only and internally gated; a failure (sync or async) never propagates.
 */
export function buildWorkUnitSpanExportHook(
  deps: WorkUnitSpanExportDeps,
): (info: { organizationId: string; workUnitId: string }) => void {
  return ({ organizationId, workUnitId }) => {
    void exportWorkUnitSpans(deps, organizationId, workUnitId).catch((err) => {
      console.warn("[work-unit-span-export] span export failed for work unit", workUnitId, err);
    });
  };
}
