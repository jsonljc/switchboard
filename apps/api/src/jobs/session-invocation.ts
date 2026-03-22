import { Worker, Queue } from "bullmq";
import type { ConnectionOptions, Job } from "bullmq";
import type { AgentSession, GatewayInvokeResponse } from "@switchboard/schemas";
import type { GatewayOutcomeLogger, SessionManager } from "@switchboard/core/sessions";
import { buildResumePayload, isFinalBullMqJobAttempt } from "@switchboard/core/sessions";
import type { ApplyGatewayOutcomeForRunParams } from "@switchboard/db";
import { issueSessionToken } from "../auth/session-token.js";
import type { LoadedManifest } from "../bootstrap/role-manifests.js";
import type { GatewayClient } from "../gateway/gateway-client.js";
import {
  GatewayCircuitOpenError,
  GatewayInvocationAbortedError,
  GatewayInvalidResponseError,
  GatewayRejectedAuthError,
  GatewayTimeoutError,
  GatewayTransportError,
} from "../gateway/gateway-errors.js";
import type { SessionGatewayInflightRegistry } from "../gateway/session-gateway-inflight.js";

export type ApplyGatewayOutcomeForRunFn = (
  input: ApplyGatewayOutcomeForRunParams,
) => Promise<{ duplicate: boolean }>;

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

async function invokeGatewayForJob(input: {
  sessionManager: SessionManager;
  gatewayClient: GatewayClient;
  sessionTokenSecret: string;
  loaded: LoadedManifest;
  session: AgentSession;
  sessionId: string;
  runId: string;
  resumeToken: string;
  abortSignal: AbortSignal;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  applyGatewayOutcomeForRun: ApplyGatewayOutcomeForRunFn;
}): Promise<void> {
  const {
    sessionManager,
    gatewayClient,
    sessionTokenSecret,
    loaded,
    session,
    sessionId,
    runId,
    resumeToken,
    abortSignal,
    logger,
    applyGatewayOutcomeForRun,
  } = input;

  const elapsed = Date.now() - session.startedAt.getTime();
  const sessionToken = await issueSessionToken({
    sessionId: session.id,
    organizationId: session.organizationId,
    principalId: session.principalId,
    roleId: session.roleId,
    secret: sessionTokenSecret,
    expiresInMs: Math.max(0, session.safetyEnvelope.sessionTimeoutMs - elapsed),
  });

  const idempotencyKey = `${runId}:${resumeToken || "initial"}`;

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

    logger.info(
      {
        sessionId,
        runId,
        traceId: session.traceId,
        kind: "resume",
      },
      "OpenClaw gateway resume starting",
    );

    const response = await gatewayClient.resume(
      {
        kind: "resume",
        sessionId,
        runId,
        roleId: session.roleId,
        sessionToken,
        traceId: session.traceId,
        idempotencyKey,
        resumePayload,
      },
      { signal: abortSignal },
    );

    logger.info(
      {
        sessionId,
        runId,
        traceId: session.traceId,
        gatewayRequestId: response.correlation?.gatewayRequestId,
        runtimeCorrelationId: response.correlation?.runtimeCorrelationId,
      },
      "OpenClaw gateway resume returned",
    );

    await applyOutcomeFromGatewayResponse({
      applyGatewayOutcomeForRun,
      sessionId,
      runId,
      response,
      logger,
    });
    return;
  }

  const packEmpty = session.allowedToolPack.length === 0;
  const govEmpty = !session.governanceProfile?.trim();
  if (packEmpty || govEmpty) {
    await sessionManager.failSession(sessionId, {
      runId,
      error:
        "Session is missing allowedToolPack or governanceProfile (legacy or invalid row); refusing gateway invoke",
      errorCode: "INVALID_SESSION_SNAPSHOT",
    });
    return;
  }

  logger.info(
    {
      sessionId,
      runId,
      traceId: session.traceId,
      kind: "initial",
    },
    "OpenClaw gateway initial invoke starting",
  );

  const response = await gatewayClient.invokeInitial(
    {
      kind: "initial",
      sessionId,
      runId,
      roleId: session.roleId,
      sessionToken,
      traceId: session.traceId,
      idempotencyKey,
      instruction: loaded.instruction,
      allowedToolPack: session.allowedToolPack,
      governanceProfile: session.governanceProfile,
      safetyLimits: session.safetyEnvelope,
    },
    { signal: abortSignal },
  );

  logger.info(
    {
      sessionId,
      runId,
      traceId: session.traceId,
      gatewayRequestId: response.correlation?.gatewayRequestId,
      runtimeCorrelationId: response.correlation?.runtimeCorrelationId,
    },
    "OpenClaw gateway initial invoke returned",
  );

  await applyOutcomeFromGatewayResponse({
    applyGatewayOutcomeForRun,
    sessionId,
    runId,
    response,
    logger,
  });
}

async function applyOutcomeFromGatewayResponse(input: {
  applyGatewayOutcomeForRun: ApplyGatewayOutcomeForRunFn;
  sessionId: string;
  runId: string;
  response: GatewayInvokeResponse;
  logger: GatewayOutcomeLogger;
}): Promise<void> {
  const { applyGatewayOutcomeForRun, sessionId, runId, response, logger } = input;
  const { duplicate } = await applyGatewayOutcomeForRun({
    sessionId,
    runId,
    response,
    logger,
  });
  if (duplicate) {
    logger.info(
      {
        sessionId,
        runId,
        gatewayRequestId: response.correlation?.gatewayRequestId,
        runtimeCorrelationId: response.correlation?.runtimeCorrelationId,
      },
      "Gateway outcome already applied; skipping duplicate apply",
    );
  }
}

/** Exported for unit tests (retry boundary vs BullMQ attemptsMade semantics). */
export async function handleGatewayInvocationError(input: {
  err: unknown;
  job: Job<SessionInvocationJobData>;
  sessionManager: SessionManager;
  sessionId: string;
  runId: string;
  logger: {
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}): Promise<"rethrow" | "done"> {
  const { err, job, sessionManager, sessionId, runId, logger } = input;
  const maxAttempts = job.opts.attempts ?? 3;
  const isTransport = err instanceof GatewayTimeoutError || err instanceof GatewayTransportError;

  if (err instanceof GatewayInvalidResponseError || err instanceof GatewayRejectedAuthError) {
    await sessionManager.failSession(sessionId, {
      runId,
      error: err instanceof Error ? err.message : "Gateway response error",
      errorCode:
        err instanceof GatewayRejectedAuthError
          ? "GATEWAY_AUTH_REJECTED"
          : "INVALID_GATEWAY_RESPONSE",
    });
    return "done";
  }

  if (err instanceof GatewayCircuitOpenError) {
    await sessionManager.failSession(sessionId, {
      runId,
      error: err instanceof Error ? err.message : "Gateway circuit open",
      errorCode: "GATEWAY_CIRCUIT_OPEN",
    });
    return "done";
  }

  if (err instanceof GatewayInvocationAbortedError) {
    const s = await sessionManager.getSession(sessionId);
    if (s?.status === "cancelled") {
      logger.warn(
        { sessionId, runId },
        "Gateway invocation aborted after session cancel (expected)",
      );
      return "done";
    }
    logger.warn(
      { sessionId, runId, status: s?.status },
      "Gateway invocation aborted; session not yet cancelled locally — cancel handler should follow",
    );
    return "done";
  }

  if (isTransport) {
    if (isFinalBullMqJobAttempt(job, maxAttempts)) {
      await sessionManager.failSession(sessionId, {
        runId,
        error: err instanceof Error ? err.message : "Gateway transport failed",
        errorCode: err instanceof GatewayTimeoutError ? "GATEWAY_TIMEOUT" : "GATEWAY_TRANSPORT",
      });
      return "done";
    }
    logger.error({ sessionId, runId, err }, "Gateway invocation failed (will retry)");
    return "rethrow";
  }

  await sessionManager.failSession(sessionId, {
    runId,
    error: err instanceof Error ? err.message : "Gateway invocation failed",
    errorCode: "GATEWAY_UNEXPECTED",
  });
  return "done";
}

export function createSessionInvocationWorker(config: {
  connection: ConnectionOptions;
  sessionManager: SessionManager;
  roleManifests: Map<string, LoadedManifest>;
  gatewayClient: GatewayClient;
  sessionTokenSecret: string;
  workerConcurrency: number;
  applyGatewayOutcomeForRun: ApplyGatewayOutcomeForRunFn;
  inflightRegistry: SessionGatewayInflightRegistry;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}): Worker {
  return new Worker(
    SESSION_INVOCATION_QUEUE,
    async (job: Job<SessionInvocationJobData>) => {
      const { sessionId, runId, resumeToken } = job.data;
      const {
        sessionManager,
        roleManifests,
        gatewayClient,
        logger,
        applyGatewayOutcomeForRun,
        inflightRegistry,
      } = config;

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

      const elapsed = Date.now() - session.startedAt.getTime();
      if (elapsed > session.safetyEnvelope.sessionTimeoutMs) {
        logger.warn({ sessionId }, "Session timed out, marking failed");
        await sessionManager.failSession(sessionId, {
          runId,
          error: "Session timed out",
          errorCode: "SESSION_TIMEOUT",
        });
        return;
      }

      const loaded = roleManifests.get(session.roleId);
      if (!loaded) {
        logger.error({ roleId: session.roleId }, "Role manifest not found");
        await sessionManager.failSession(sessionId, {
          runId,
          error: `Role manifest '${session.roleId}' not found`,
          errorCode: "MANIFEST_NOT_FOUND",
        });
        return;
      }

      logger.info({ sessionId, runId, attempt: job.attemptsMade }, "Invoking gateway");

      const abortController = inflightRegistry.beginInvocation(sessionId);
      try {
        await invokeGatewayForJob({
          sessionManager,
          gatewayClient,
          sessionTokenSecret: config.sessionTokenSecret,
          loaded,
          session,
          sessionId,
          runId,
          resumeToken,
          abortSignal: abortController.signal,
          logger,
          applyGatewayOutcomeForRun,
        });
      } catch (err) {
        const action = await handleGatewayInvocationError({
          err,
          job,
          sessionManager,
          sessionId,
          runId,
          logger,
        });
        if (action === "rethrow") throw err;
      } finally {
        inflightRegistry.endInvocation(sessionId, abortController);
      }
    },
    { connection: config.connection, concurrency: config.workerConcurrency },
  );
}
