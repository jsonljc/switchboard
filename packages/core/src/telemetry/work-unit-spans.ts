import type { Tracer } from "./tracing.js";
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

export function projectWorkUnitSpans(input: WorkUnitSpanInput, tracer: Tracer): void {
  const root = tracer.startSpan("invoke_agent", {
    "switchboard.work_unit.id": input.workUnit.workUnitId,
  });
  // Task 3 adds the full attribute set + status here.
  for (const execution of input.executions) {
    const execSpan = tracer.startSpan(`chat ${execution.skillSlug ?? "skill"}`, undefined, root);
    for (const call of execution.toolCalls) {
      const toolSpan = tracer.startSpan(`execute_tool ${readToolId(call)}`, undefined, execSpan);
      toolSpan.end();
    }
    execSpan.end();
  }
  root.end();
}

function readToolId(call: unknown): string {
  if (
    call &&
    typeof call === "object" &&
    typeof (call as { toolId?: unknown }).toolId === "string"
  ) {
    return (call as { toolId: string }).toolId;
  }
  return "unknown";
}
