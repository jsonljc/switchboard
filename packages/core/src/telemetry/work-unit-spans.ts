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

  // Work-unit (root) span
  const root = tracer.startSpan("invoke_agent");
  root.setAttribute("gen_ai.system", "switchboard");
  root.setAttribute("gen_ai.operation.name", "invoke_agent");
  root.setAttribute("switchboard.work_unit.id", wu.workUnitId);
  setIfString(root, "switchboard.organization.id", wu.organizationId);
  setIfString(root, "switchboard.deployment.id", wu.deploymentId);
  setIfString(root, "switchboard.intent", wu.intent);
  setIfString(root, "switchboard.governance.outcome", wu.governanceOutcome);
  setIfString(root, "switchboard.work.outcome", wu.outcome);
  setIfFinite(root, "switchboard.risk_score", wu.riskScore);
  setIfFinite(root, "switchboard.duration_ms", wu.durationMs);
  root.setStatus(workUnitStatus(wu));

  for (const execution of input.executions) {
    // Execution span
    const execSpan = tracer.startSpan(`chat ${execution.skillSlug ?? "skill"}`, undefined, root);
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
    execSpan.setStatus(executionStatus(execution.status));

    for (const call of execution.toolCalls) {
      emitToolSpan(call, execSpan, tracer);
    }

    execSpan.end();
  }

  root.end();
}

function emitToolSpan(call: unknown, execSpan: Span, tracer: Tracer): void {
  // Defensive narrowing: non-object or null -> malformed
  if (call === null || typeof call !== "object") {
    const s = tracer.startSpan("execute_tool <malformed>", undefined, execSpan);
    s.setAttribute("switchboard.tool.malformed", true);
    s.end();
    return;
  }

  const rec = call as Record<string, unknown>;
  const toolId = rec["toolId"];

  // Non-string toolId -> malformed
  if (typeof toolId !== "string") {
    const s = tracer.startSpan("execute_tool <malformed>", undefined, execSpan);
    s.setAttribute("switchboard.tool.malformed", true);
    s.end();
    return;
  }

  const toolSpan = tracer.startSpan(`execute_tool ${toolId}`, undefined, execSpan);
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

  toolSpan.setStatus(toolStatus(resultStatus, rec["governanceDecision"]));
  toolSpan.end();
}
