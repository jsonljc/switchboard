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
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  costUsd?: number;
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

/**
 * Derive an honest [start, end] for a span: both set iff both anchors exist, the optional
 * parent-start clamp keeps the child from starting before its parent, AND the result is not
 * inverted. Any inconsistency (missing anchor, clock skew, clamp-induced inversion) degrades
 * to flat timing rather than emit a misleading/inverted span.
 */
function deriveSpanTiming(
  startRaw: number | undefined,
  endRaw: number | undefined,
  parentStartMs?: number,
): { startMs?: number; endMs?: number } {
  if (startRaw === undefined || endRaw === undefined) return {};
  let start = startRaw;
  if (parentStartMs !== undefined && start < parentStartMs) start = parentStartMs;
  if (start > endRaw) return {};
  return { startMs: start, endMs: endRaw };
}

function providerForModel(model: unknown): string | undefined {
  return typeof model === "string" && model.toLowerCase().includes("claude")
    ? "anthropic"
    : undefined;
}

/**
 * The work unit's model provider for the root invoke_agent span, derived from its executions
 * (Claude-only -> "anthropic"). Undefined when no execution ran a resolvable model — degrade,
 * never fabricate (consistent with the projection's honest-timing posture).
 */
function deriveWorkUnitProvider(executions: ReadonlyArray<unknown>): string | undefined {
  for (const execRaw of executions) {
    if (execRaw === null || typeof execRaw !== "object") continue;
    const provider = providerForModel((execRaw as WorkUnitExecution).model);
    if (provider !== undefined) return provider;
  }
  return undefined;
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
  // Guard against non-array executions (Prisma Json column can hold a non-array at runtime)
  const executions: unknown[] = Array.isArray(input.executions) ? input.executions : [];

  const rootStartRaw = finiteOrUndef(wu.requestedAtMs);
  const wuDuration = finiteOrUndef(wu.durationMs);
  const rootEndRaw =
    finiteOrUndef(wu.completedAtMs) ??
    (rootStartRaw !== undefined && wuDuration !== undefined
      ? rootStartRaw + wuDuration
      : undefined);
  // deriveSpanTiming: both or neither; clock-skew (completedAt < requestedAt) degrades to flat
  const { startMs: rootStartMs, endMs: rootEndMs } = deriveSpanTiming(rootStartRaw, rootEndRaw);

  // Work-unit (root) span — REAL requestedAt/completedAt timing (not marked synthetic)
  const root = tracer.startSpan("invoke_agent", undefined, undefined, {
    startTime: rootStartMs,
    kind: SPAN_KIND.INTERNAL,
  });
  root.setAttribute("gen_ai.operation.name", "invoke_agent");
  // gen_ai.provider.name (OTel GenAI semconv: Required on agent spans) = the real model provider,
  // derived from this work unit's executions (Claude-only -> "anthropic"); omitted when no model
  // ran. "Switchboard orchestrated this" lives in the switchboard.* namespace below — not on
  // gen_ai.system (deprecated alias of gen_ai.provider.name; "switchboard" is not a GenAI provider).
  setIfString(root, "gen_ai.provider.name", deriveWorkUnitProvider(executions));
  setIfString(root, "switchboard.work_unit.id", wu.workUnitId);
  setIfString(root, "switchboard.organization.id", wu.organizationId);
  setIfString(root, "switchboard.deployment.id", wu.deploymentId);
  setIfString(root, "switchboard.intent", wu.intent);
  setIfString(root, "switchboard.governance.outcome", wu.governanceOutcome);
  setIfString(root, "switchboard.work.outcome", wu.outcome);
  setIfFinite(root, "switchboard.risk_score", wu.riskScore);
  setIfFinite(root, "switchboard.duration_ms", wu.durationMs);
  root.setStatus(workUnitStatus(wu));

  for (const execRaw of executions) {
    // Narrow: null or non-object element -> skip (never throw)
    if (execRaw === null || typeof execRaw !== "object") continue;
    const execution = execRaw as WorkUnitExecution;

    // Execution span — end = REAL createdAt, start = createdAt - durationMs (derived, synthetic)
    const execEndRaw = finiteOrUndef(execution.createdAtMs);
    const execDuration = finiteOrUndef(execution.durationMs);
    const execStartRaw =
      execEndRaw !== undefined && execDuration !== undefined
        ? execEndRaw - execDuration
        : undefined;
    // deriveSpanTiming: clamps to rootStart and degrades to flat if start > end (inversion guard)
    const { startMs: execStartMs, endMs: execEndMs } = deriveSpanTiming(
      execStartRaw,
      execEndRaw,
      rootStartMs,
    );

    const execSpan = tracer.startSpan(`chat ${execution.skillSlug ?? "skill"}`, undefined, root, {
      startTime: execStartMs,
      kind: SPAN_KIND.CLIENT,
    });
    execSpan.setAttribute("gen_ai.operation.name", "chat");
    setIfString(execSpan, "gen_ai.request.model", execution.model);
    setIfString(execSpan, "gen_ai.provider.name", providerForModel(execution.model));
    setIfFinite(execSpan, "gen_ai.usage.cache_read_input_tokens", execution.cacheReadTokens);
    setIfFinite(
      execSpan,
      "gen_ai.usage.cache_creation_input_tokens",
      execution.cacheCreationTokens,
    );
    setIfFinite(execSpan, "switchboard.cost_usd", execution.costUsd);
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

    // Guard against non-array toolCalls (Prisma Json column can hold a non-array at runtime)
    const toolCalls: unknown[] = Array.isArray(execution.toolCalls) ? execution.toolCalls : [];
    // Tools packed sequentially within the exec window (synthetic)
    let cursorMs = execStartMs;
    for (const call of toolCalls) {
      cursorMs = emitToolSpan(call, execSpan, tracer, cursorMs, execEndMs);
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
  execEndMs: number | undefined,
): number | undefined {
  const timed = cursorMs !== undefined && execEndMs !== undefined;
  const clampStart = timed ? Math.min(cursorMs!, execEndMs!) : undefined;

  // DRY: emit a zero-width malformed span and leave the cursor unchanged
  const emitMalformed = (): number | undefined => {
    const s = tracer.startSpan("execute_tool <malformed>", undefined, execSpan, {
      startTime: clampStart,
      kind: SPAN_KIND.INTERNAL,
    });
    s.setAttribute("switchboard.tool.malformed", true);
    s.end(clampStart);
    return cursorMs;
  };

  // Defensive narrowing: non-object or null -> malformed
  if (call === null || typeof call !== "object") return emitMalformed();

  const rec = call as Record<string, unknown>;
  const toolId = rec["toolId"];

  // Non-string toolId -> malformed
  if (typeof toolId !== "string") return emitMalformed();

  // Floor dur at 0: negative durationMs would invert toolStart+dur < toolStart
  const dur = Math.max(0, finiteOrUndef(rec["durationMs"]) ?? 0);
  // Clamp tool start+end into [..., execEndMs] — no child exceeds parent; dur>=0 so start<=end always
  const toolStartMs = clampStart;
  const toolEndMs = timed ? Math.min(cursorMs! + dur, execEndMs!) : undefined;

  const toolSpan = tracer.startSpan(`execute_tool ${toolId}`, undefined, execSpan, {
    startTime: toolStartMs,
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

  if (toolStartMs !== undefined) toolSpan.setAttribute("switchboard.timing.synthetic", true);
  toolSpan.setStatus(toolStatus(resultStatus, rec["governanceDecision"]));
  toolSpan.end(toolEndMs);
  // advance cursor by REAL dur (ordering), not the clamped end
  return timed ? cursorMs! + dur : cursorMs;
}
