import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { GatewayInvokeResponse } from "@switchboard/schemas";
import {
  SessionManager,
  applyGatewayOutcomeToSession,
  type GatewayOutcomeLogger,
  type SessionManagerDeps,
} from "@switchboard/core/sessions";
import type { PrismaDbClient } from "../prisma-db.js";
import { PrismaPauseStore } from "../storage/prisma-pause-store.js";
import { PrismaRoleOverrideStore } from "../storage/prisma-role-override-store.js";
import { PrismaRunStore } from "../storage/prisma-run-store.js";
import { PrismaSessionStore } from "../storage/prisma-session-store.js";
import { PrismaToolEventStore } from "../storage/prisma-tool-event-store.js";

export class RunCallbackRunNotFoundError extends Error {
  constructor(runId: string) {
    super(`Run not found: ${runId}`);
    this.name = "RunCallbackRunNotFoundError";
  }
}

export class RunCallbackSessionMismatchError extends Error {
  constructor() {
    super("Run does not belong to the given session");
    this.name = "RunCallbackSessionMismatchError";
  }
}

export class RunCallbackSessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = "RunCallbackSessionNotFoundError";
  }
}

/** Session statuses where gateway outcome application must be a no-op (late / replay callbacks). */
const TERMINAL_SESSION_STATUSES_FOR_CALLBACK = new Set(["completed", "failed", "cancelled"]);

export function isTerminalSessionStatusForGatewayCallback(status: string): boolean {
  return TERMINAL_SESSION_STATUSES_FOR_CALLBACK.has(status);
}

/** Params for the bound callback applier (prisma + sessionManagerBase injected by the API). */
export type ApplyGatewayOutcomeForRunParams = {
  sessionId: string;
  runId: string;
  response: GatewayInvokeResponse;
  logger: GatewayOutcomeLogger;
};

/**
 * Derive two int32 keys for pg_advisory_xact_lock (stable per session+run pair).
 */
export function advisoryLockInt32Pair(sessionId: string, runId: string): [number, number] {
  const buf = createHash("sha256").update(sessionId).update("\0").update(runId).digest();
  return [buf.readInt32BE(0), buf.readInt32BE(4)];
}

/** Build SessionManager backed by a transaction-scoped Prisma client. */
export function createSessionManagerForPrismaClient(
  client: PrismaDbClient,
  base: Pick<SessionManagerDeps, "maxConcurrentSessions" | "getRoleCheckpointValidator">,
): SessionManager {
  return new SessionManager({
    sessions: new PrismaSessionStore(client),
    runs: new PrismaRunStore(client),
    pauses: new PrismaPauseStore(client),
    toolEvents: new PrismaToolEventStore(client),
    roleOverrides: new PrismaRoleOverrideStore(client),
    maxConcurrentSessions: base.maxConcurrentSessions,
    getRoleCheckpointValidator: base.getRoleCheckpointValidator,
  });
}

/**
 * Single-writer application of a gateway outcome for one run, safe across API instances.
 * Uses advisory lock + row lock (FOR UPDATE) on the run, then:
 * - no-op if run.outcome is set (includes runs terminalized by cancelSession), or
 * - no-op if the session is already completed/failed/cancelled (late callbacks after cancel), or
 * - otherwise applies the outcome inside the same transaction.
 */
export async function applyGatewayOutcomeForRunWithAdvisoryLock(input: {
  prisma: PrismaClient;
  sessionManagerBase: Pick<
    SessionManagerDeps,
    "maxConcurrentSessions" | "getRoleCheckpointValidator"
  >;
  sessionId: string;
  runId: string;
  response: GatewayInvokeResponse;
  logger: GatewayOutcomeLogger;
}): Promise<{ duplicate: boolean }> {
  const { prisma, sessionManagerBase, sessionId, runId, response, logger } = input;
  const [k1, k2] = advisoryLockInt32Pair(sessionId, runId);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${k1}, ${k2})`;

    // Serialize with cancelSession (and other writers) updating this run row.
    const lockedRunRows = await tx.$queryRaw<Array<{ sessionId: string; outcome: string | null }>>(
      Prisma.sql`SELECT "sessionId", outcome FROM "AgentRun" WHERE id = ${runId}::uuid FOR UPDATE`,
    );
    const runRow = lockedRunRows[0];
    if (!runRow) {
      throw new RunCallbackRunNotFoundError(runId);
    }
    if (runRow.sessionId !== sessionId) {
      throw new RunCallbackSessionMismatchError();
    }
    if (runRow.outcome !== null) {
      return { duplicate: true };
    }

    const sessionRow = await tx.agentSession.findUnique({
      where: { id: sessionId },
      select: { status: true },
    });
    if (!sessionRow) {
      throw new RunCallbackSessionNotFoundError(sessionId);
    }
    if (isTerminalSessionStatusForGatewayCallback(sessionRow.status)) {
      return { duplicate: true };
    }

    const sm = createSessionManagerForPrismaClient(tx, sessionManagerBase);
    await applyGatewayOutcomeToSession({
      sessionManager: sm,
      sessionId,
      runId,
      response,
      logger,
    });
    return { duplicate: false };
  });
}
