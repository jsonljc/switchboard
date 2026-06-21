import type { Span, Tracer } from "./tracing.js";
import type { ToolCallRecord } from "../skill-runtime/types.js";

export interface WorkUnitSpanParent {
  workUnitId: string;
  organizationId?: string;
  deploymentId?: string;
  intent?: string;
  governanceOutcome?: string;
  outcome?: string;
  riskScore?: number;
  durationMs?: number;
  requestedAtMs?: number;
  completedAtMs?: number;
}

export interface WorkUnitExecution {
  skillSlug?: string;
  skillVersion?: string;
  sessionId?: string;
  status?: string;
  durationMs?: number;
  turnCount?: number;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  createdAtMs?: number;
  toolCalls: ReadonlyArray<ToolCallRecord>;
}

export interface WorkUnitSpanInput {
  workUnit: WorkUnitSpanParent;
  executions: ReadonlyArray<WorkUnitExecution>;
}

// --- Pure helpers (not exported) ---

function setIfString(span: Span, key: string, value: unknown): void {
  if (typeof value === "string" && value.length > 0) span.setAttribute(key, value);
}

function setIfFinite(span: Span, key: string, value: unknown): void {
  if (typeof value === "number" && Number.isFinite(value)) span.setAttribute(key, value);
}

/** Mirrors @opentelemetry/api SpanKind numeric values (stable wire-level constants; lets core stay OTel-free). */
const SPAN_KIND = { INTERNAL: 0, CLIENT: 2 } as const;

function finiteOrUndef(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function workUnitStatus(wu: WorkUnitSpanParent): "OK" | "ERROR" {
  if (wu.governanceOutcome === "deny") return "ERROR";
  if (typeof wu.outcome === "string" && /fail|error|denied/i.test(wu.outcome)) return "ERROR";
  return "OK";
}

function executionStatus(status: unknown): "OK" | "ERROR" {
  return status === "error" || status === "budget_exceeded" || status === "denied" ? "ERROR" : "OK";
}

function toolStatus(resultStatus: unknown, governance: unknown): "OK" | "ERROR" {
  if (resultStatus === "error" || resultStatus === "denied") return "ERROR";
  if (governance === "denied") return "ERROR";
  return "OK";
}

// --- Main projection ---

export function projectWorkUnitSpans(input: WorkUnitSpanInput, tracer: Tracer): void {
  const wu = input.workUnit;

  const rootStartMs = finiteOrUndef(wu.requestedAtMs);
  const wuDuration = finiteOrUndef(wu.durationMs);
  const rootEndMs =
    finiteOrUndef(wu.completedAtMs) ??
    (rootStartMs !== undefined && wuDuration !== undefined ? rootStartMs + wuDuration : undefined);

  // Work-unit (root) span — REAL requestedAt/completedAt timing (not marked synthetic)
  const root = tracer.startSpan("invoke_agent", undefined, undefined, {
    startTime: rootStartMs,
    kind: SPAN_KIND.INTERNAL,
  });
  root.setAttribute("gen_ai.system", "switchboard");
  root.setAttribute("gen_ai.operation.name", "invoke_agent");
  setIfString(root, "switchboard.work_unit.id", wu.workUnitId);
  setIfString(root, "switchboard.organization.id", wu.organizationId);
  setIfString(root, "switchboard.deployment.id", wu.deploymentId);
  setIfString(root, "switchboard.intent", wu.intent);
  setIfString(root, "switchboard.governance.outcome", wu.governanceOutcome);
  setIfString(root, "switchboard.work.outcome", wu.outcome);
  setIfFinite(root, "switchboard.risk_score", wu.riskScore);
  setIfFinite(root, "switchboard.duration_ms", wu.durationMs);
  root.setStatus(workUnitStatus(wu));

  for (const execution of input.executions) {
    // Execution span — end = REAL createdAt, start = createdAt - durationMs (derived, synthetic)
    const execEndMs = finiteOrUndef(execution.createdAtMs);
    const execDuration = finiteOrUndef(execution.durationMs);
    const execStartMs =
      execEndMs !== undefined && execDuration !== undefined ? execEndMs - execDuration : undefined;

    const execSpan = tracer.startSpan(`chat ${execution.skillSlug ?? "skill"}`, undefined, root, {
      startTime: execStartMs,
      kind: SPAN_KIND.CLIENT,
    });
    execSpan.setAttribute("gen_ai.system", "switchboard");
    execSpan.setAttribute("gen_ai.operation.name", "chat");
    setIfString(execSpan, "gen_ai.request.model", execution.model);
    setIfFinite(execSpan, "gen_ai.usage.input_tokens", execution.inputTokens);
    setIfFinite(execSpan, "gen_ai.usage.output_tokens", execution.outputTokens);
    setIfString(execSpan, "switchboard.skill.slug", execution.skillSlug);
    setIfString(execSpan, "switchboard.skill.version", execution.skillVersion);
    setIfString(execSpan, "switchboard.session.id", execution.sessionId);
    setIfString(execSpan, "switchboard.execution.status", execution.status);
    setIfFinite(execSpan, "switchboard.turn_count", execution.turnCount);
    setIfFinite(execSpan, "switchboard.duration_ms", execution.durationMs);
    if (execStartMs !== undefined) execSpan.setAttribute("switchboard.timing.synthetic", true);
    execSpan.setStatus(executionStatus(execution.status));

    // Tools packed sequentially within the exec window (synthetic)
    let cursorMs = execStartMs;
    for (const call of execution.toolCalls) {
      cursorMs = emitToolSpan(call, execSpan, tracer, cursorMs);
    }

    execSpan.end(execEndMs);
  }

  root.end(rootEndMs);
}

function emitToolSpan(
  call: unknown,
  execSpan: Span,
  tracer: Tracer,
  cursorMs: number | undefined,
): number | undefined {
  // Defensive narrowing: non-object or null -> malformed
  if (call === null || typeof call !== "object") {
    const s = tracer.startSpan("execute_tool <malformed>", undefined, execSpan, {
      startTime: cursorMs,
      kind: SPAN_KIND.INTERNAL,
    });
    s.setAttribute("switchboard.tool.malformed", true);
    s.end(cursorMs);
    return cursorMs;
  }

  const rec = call as Record<string, unknown>;
  const toolId = rec["toolId"];

  // Non-string toolId -> malformed
  if (typeof toolId !== "string") {
    const s = tracer.startSpan("execute_tool <malformed>", undefined, execSpan, {
      startTime: cursorMs,
      kind: SPAN_KIND.INTERNAL,
    });
    s.setAttribute("switchboard.tool.malformed", true);
    s.end(cursorMs);
    return cursorMs;
  }

  const dur = finiteOrUndef(rec["durationMs"]) ?? 0;
  const toolEndMs = cursorMs !== undefined ? cursorMs + dur : undefined;

  const toolSpan = tracer.startSpan(`execute_tool ${toolId}`, undefined, execSpan, {
    startTime: cursorMs,
    kind: SPAN_KIND.INTERNAL,
  });
  toolSpan.setAttribute("gen_ai.operation.name", "execute_tool");
  toolSpan.setAttribute("gen_ai.tool.name", toolId);
  setIfString(toolSpan, "switchboard.tool.operation", rec["operation"]);

  // result fields
  const result = rec["result"];
  const resultStatus =
    result !== null && typeof result === "object"
      ? (result as Record<string, unknown>)["status"]
      : undefined;
  setIfString(toolSpan, "switchboard.tool.result_status", resultStatus);

  // error.code if present
  if (result !== null && typeof result === "object") {
    const resultRec = result as Record<string, unknown>;
    const errObj = resultRec["error"];
    if (errObj !== null && typeof errObj === "object") {
      setIfString(
        toolSpan,
        "switchboard.tool.error_code",
        (errObj as Record<string, unknown>)["code"],
      );
    }
  }

  setIfString(toolSpan, "switchboard.governance.decision", rec["governanceDecision"]);
  setIfFinite(toolSpan, "switchboard.tool.duration_ms", rec["durationMs"]);

  // Privacy: only record PRESENCE of params, never the values
  const params = rec["params"];
  toolSpan.setAttribute("switchboard.tool.params_present", params !== undefined && params !== null);

  if (cursorMs !== undefined) toolSpan.setAttribute("switchboard.timing.synthetic", true);
  toolSpan.setStatus(toolStatus(resultStatus, rec["governanceDecision"]));
  toolSpan.end(toolEndMs);
  return toolEndMs;
}
