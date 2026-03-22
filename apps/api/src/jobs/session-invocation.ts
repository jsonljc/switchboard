import { Worker, Queue } from "bullmq";
import type { ConnectionOptions, Job } from "bullmq";
import type { SessionManager } from "@switchboard/core/sessions";
import { buildResumePayload } from "@switchboard/core/sessions";
import { issueSessionToken } from "../auth/session-token.js";
import type { LoadedManifest } from "../bootstrap/role-manifests.js";
import type { GatewayInvokeRequest, GatewayInvokeResponse } from "@switchboard/schemas";
import { GatewayInvokeResponseSchema } from "@switchboard/schemas";

export interface SessionInvocationJobData {
  sessionId: string;
  runId: string;
  resumeToken: string;
  attempt: number;
}

export const SESSION_INVOCATION_QUEUE = "session-invocation";

export function createSessionInvocationQueue(connection: ConnectionOptions): Queue {
  return new Queue<SessionInvocationJobData>(SESSION_INVOCATION_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { count: 500 },
      removeOnFail: false,
    },
  });
}

export function createSessionInvocationWorker(config: {
  connection: ConnectionOptions;
  sessionManager: SessionManager;
  roleManifests: Map<string, LoadedManifest>;
  openclawGatewayUrl: string;
  sessionTokenSecret: string;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}): Worker {
  return new Worker(
    SESSION_INVOCATION_QUEUE,
    async (job: Job<SessionInvocationJobData>) => {
      const { sessionId, runId, resumeToken, attempt } = job.data;
      const { sessionManager, roleManifests, logger } = config;

      // 1. Load session, verify running + active run
      const session = await sessionManager.getSession(sessionId);
      if (!session) {
        logger.warn({ sessionId }, "Session not found, skipping invocation");
        return;
      }
      if (session.status !== "running") {
        logger.warn(
          { sessionId, status: session.status },
          "Session not running, skipping invocation",
        );
        return;
      }

      // 2. Check session timeout
      const elapsed = Date.now() - session.startedAt.getTime();
      if (elapsed > session.safetyEnvelope.sessionTimeoutMs) {
        logger.warn({ sessionId }, "Session timed out, marking failed");
        await sessionManager.failSession(sessionId, {
          runId,
          error: "Session timed out",
        });
        return;
      }

      // 3. Load role manifest
      const loaded = roleManifests.get(session.roleId);
      if (!loaded) {
        logger.error({ roleId: session.roleId }, "Role manifest not found");
        await sessionManager.failSession(sessionId, {
          runId,
          error: `Role manifest '${session.roleId}' not found`,
        });
        return;
      }

      // 4. Issue session token
      const sessionToken = await issueSessionToken({
        sessionId: session.id,
        organizationId: session.organizationId,
        principalId: session.principalId,
        roleId: session.roleId,
        secret: config.sessionTokenSecret,
        expiresInMs: Math.max(0, session.safetyEnvelope.sessionTimeoutMs - elapsed),
      });

      // 5. Build invoke request
      let invokeRequest: GatewayInvokeRequest;

      if (resumeToken) {
        const pause = await sessionManager.getPauseByResumeToken(sessionId, resumeToken);
        if (!pause) {
          logger.error({ sessionId, resumeToken }, "Pause not found for resume token");
          return;
        }

        const toolHistory = await sessionManager.getToolHistory(sessionId);

        const resumePayload = buildResumePayload({
          session,
          pause,
          toolHistory,
          runId,
          instruction: loaded.instruction,
        });

        invokeRequest = {
          sessionId,
          runId,
          roleId: session.roleId,
          sessionToken,
          resumePayload,
        };
      } else {
        invokeRequest = {
          sessionId,
          runId,
          roleId: session.roleId,
          sessionToken,
          instruction: loaded.instruction,
          toolPack: loaded.manifest.toolPack,
          safetyLimits: session.safetyEnvelope,
        };
      }

      // 6. Call Gateway RPC (placeholder — will be replaced with real implementation)
      logger.info({ sessionId, runId, attempt }, "Invoking OpenClaw Gateway (placeholder)");

      try {
        const response = await invokeGateway(config.openclawGatewayUrl, invokeRequest);

        // 7. Handle response — record tool calls via SessionManager
        if (response.toolCalls) {
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
            });
          }
        }

        switch (response.status) {
          case "completed":
            await sessionManager.completeSession(sessionId, { runId });
            logger.info({ sessionId, runId }, "Session completed");
            break;

          case "paused":
            if (response.checkpoint) {
              await sessionManager.pauseSession(sessionId, {
                runId,
                approvalId: response.checkpoint.pendingApprovalId ?? "unknown",
                checkpoint: response.checkpoint,
              });
              logger.info({ sessionId, runId }, "Session paused for approval");
            }
            break;

          case "failed":
            await sessionManager.failSession(sessionId, {
              runId,
              error: response.error?.message ?? "Gateway reported failure",
            });
            logger.error({ sessionId, runId, error: response.error }, "Session failed");
            break;
        }
      } catch (err) {
        // Transient failure — BullMQ will retry
        logger.error({ sessionId, runId, err }, "Gateway invocation failed");
        throw err;
      }
    },
    { connection: config.connection, concurrency: 3 },
  );
}

/**
 * Call the OpenClaw Gateway RPC endpoint.
 * This is a placeholder — Phase 2 will implement the real Gateway.
 */
async function invokeGateway(
  gatewayUrl: string,
  request: GatewayInvokeRequest,
): Promise<GatewayInvokeResponse> {
  const response = await fetch(`${gatewayUrl}/invoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`Gateway returned ${response.status}: ${await response.text()}`);
  }

  const body = await response.json();
  return GatewayInvokeResponseSchema.parse(body);
}
