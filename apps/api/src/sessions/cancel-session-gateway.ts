import type { AgentRun, AgentSession } from "@switchboard/schemas";
import type { SessionManager } from "@switchboard/core/sessions";
import { issueSessionToken } from "../auth/session-token.js";
import type { GatewayClient } from "../gateway/gateway-client.js";
import type { SessionGatewayInflightRegistry } from "../gateway/session-gateway-inflight.js";

/**
 * Pick a run id to pass to OpenClaw cancel: prefer the in-flight run (outcome null),
 * else when paused use the latest run as a best-effort hint for runtime cleanup.
 */
export function resolveOpenClawRunIdForCancel(
  session: AgentSession,
  runs: AgentRun[],
): string | null {
  const ordered = [...runs].sort((a, b) => a.runIndex - b.runIndex);
  const active = ordered.find((r) => r.outcome === null);
  if (active) return active.id;
  if (session.status === "paused") {
    const latest = ordered[ordered.length - 1];
    return latest?.id ?? null;
  }
  return null;
}

/**
 * Propagates cancel to the gateway (best effort), then applies local terminal state via SessionManager.
 */
export async function cancelSessionWithGatewayPropagation(input: {
  sessionManager: SessionManager;
  gatewayClient: GatewayClient;
  sessionTokenSecret: string;
  sessionId: string;
  inflightRegistry: SessionGatewayInflightRegistry;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  };
}): Promise<void> {
  const { sessionManager, gatewayClient, sessionTokenSecret, sessionId, inflightRegistry, logger } =
    input;

  const session = await sessionManager.getSession(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  inflightRegistry.abortInvocation(sessionId);

  const runs = await sessionManager.listRunsForSession(sessionId);
  const runIdForGateway = resolveOpenClawRunIdForCancel(session, runs);

  if (runIdForGateway) {
    const elapsed = Date.now() - session.startedAt.getTime();
    const sessionToken = await issueSessionToken({
      sessionId: session.id,
      organizationId: session.organizationId,
      principalId: session.principalId,
      roleId: session.roleId,
      secret: sessionTokenSecret,
      expiresInMs: Math.max(0, session.safetyEnvelope.sessionTimeoutMs - elapsed),
    });
    try {
      await gatewayClient.cancel({
        sessionId: session.id,
        runId: runIdForGateway,
        sessionToken,
        traceId: session.traceId,
      });
      logger.info(
        {
          sessionId,
          runId: runIdForGateway,
          traceId: session.traceId,
        },
        "OpenClaw gateway cancel acknowledged",
      );
    } catch (err) {
      logger.warn(
        { sessionId, runId: runIdForGateway, traceId: session.traceId, err },
        "OpenClaw gateway cancel failed; applying local cancel only",
      );
    }
  } else {
    logger.info(
      { sessionId, traceId: session.traceId },
      "Skipping gateway cancel (no run id resolved)",
    );
  }

  await sessionManager.cancelSession(sessionId);
}
