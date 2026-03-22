import type { GatewayInvokeResponse } from "@switchboard/schemas";
import type { SessionManager } from "./session-manager.js";

export type GatewayOutcomeLogger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

/**
 * Apply a gateway RPC or HTTP callback outcome to session state.
 * Callers that need cross-process idempotency should invoke this only while
 * holding a DB-backed lock (see @switchboard/db applyGatewayOutcomeForRunWithAdvisoryLock).
 */
export async function applyGatewayOutcomeToSession(input: {
  sessionManager: SessionManager;
  sessionId: string;
  runId: string;
  response: GatewayInvokeResponse;
  logger: GatewayOutcomeLogger;
}): Promise<void> {
  const { sessionManager, sessionId, runId, response, logger } = input;

  const session = await sessionManager.getSession(sessionId);
  if (!session) {
    logger.error({ sessionId, runId }, "applyGatewayOutcomeToSession: session missing");
    return;
  }

  const allowed = new Set(session.allowedToolPack);

  /**
   * Phase 2B: terminal batch ingestion only — `toolCalls` are validated here in one shot
   * before any persistence so invalid runtime tools cannot partially apply.
   */
  if (response.toolCalls?.length) {
    for (const tc of response.toolCalls) {
      if (!allowed.has(tc.toolName)) {
        await sessionManager.failSession(sessionId, {
          runId,
          error: `Gateway reported disallowed tool "${tc.toolName}" (not in session allowedToolPack)`,
          errorCode: "RUNTIME_TOOL_NOT_ALLOWED",
        });
        logger.error(
          { sessionId, runId, toolName: tc.toolName, traceId: session.traceId },
          "Rejected gateway tool call outside allowedToolPack",
        );
        return;
      }
    }

    for (const tc of response.toolCalls) {
      await sessionManager.recordToolCall(sessionId, {
        runId,
        toolName: tc.toolName,
        parameters: tc.parameters,
        result: tc.result,
        isMutation: tc.isMutation,
        dollarsAtRisk: tc.dollarsAtRisk,
        durationMs: tc.durationMs,
        envelopeId: tc.envelopeId,
        gatewayIdempotencyKey: tc.idempotencyKey,
      });
    }
  }

  switch (response.status) {
    case "completed":
      await sessionManager.completeSession(sessionId, { runId });
      logger.info({ sessionId, runId }, "Session completed");
      break;

    case "paused": {
      const checkpoint = response.checkpoint;
      if (!checkpoint) {
        await sessionManager.failSession(sessionId, {
          runId,
          error: "Gateway paused without checkpoint",
          errorCode: "MISSING_CHECKPOINT",
        });
        return;
      }
      const approvalId = checkpoint.pendingApprovalId;
      if (!approvalId) {
        await sessionManager.failSession(sessionId, {
          runId,
          error: "Gateway paused without pendingApprovalId on checkpoint",
          errorCode: "MISSING_APPROVAL_ID",
        });
        return;
      }
      try {
        await sessionManager.pauseSession(sessionId, {
          runId,
          approvalId,
          checkpoint,
        });
        logger.info({ sessionId, runId }, "Session paused for approval");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Pause failed";
        logger.error({ sessionId, runId, err }, "pauseSession rejected checkpoint");
        await sessionManager.failSession(sessionId, {
          runId,
          error: msg,
          errorCode: "INVALID_CHECKPOINT",
        });
      }
      break;
    }

    case "failed":
      await sessionManager.failSession(sessionId, {
        runId,
        error: response.error?.message ?? "Gateway reported failure",
        errorCode: response.error?.code ?? "GATEWAY_FAILED",
      });
      logger.error({ sessionId, runId, error: response.error }, "Session failed");
      break;
  }
}
