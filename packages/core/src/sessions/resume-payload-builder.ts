import type { AgentSession, AgentPause, ToolEvent, ResumePayload } from "@switchboard/schemas";

/**
 * Build the payload sent to the Gateway when resuming a paused session.
 * toolHistory is passed in (loaded from ToolEventStore) rather than read
 * from the session row, to avoid denormalizing a growing array.
 */
export function buildResumePayload(input: {
  session: AgentSession;
  pause: AgentPause;
  toolHistory: ToolEvent[];
  runId: string;
  instruction: string;
  now?: Date;
}): ResumePayload {
  const { session, pause, toolHistory, runId, instruction, now = new Date() } = input;
  const env = session.safetyEnvelope;

  const elapsedMs = now.getTime() - session.startedAt.getTime();
  const timeRemainingMs = Math.max(0, env.sessionTimeoutMs - elapsedMs);

  return {
    sessionId: session.id,
    runId,
    roleId: session.roleId,
    checkpoint: pause.checkpoint,
    approvalOutcome: pause.approvalOutcome ?? {},
    toolHistory,
    instruction,
    safetyBudgetRemaining: {
      toolCalls: Math.max(0, env.maxToolCalls - session.toolCallCount),
      mutations: Math.max(0, env.maxMutations - session.mutationCount),
      dollarsAtRisk: Math.max(0, env.maxDollarsAtRisk - session.dollarsAtRisk),
      timeRemainingMs,
    },
  };
}
