import type { FastifyBaseLogger } from "fastify";
import type { PrismaClient } from "@switchboard/db";
import type { SessionManager } from "@switchboard/core/sessions";

export interface SessionBootstrapResult {
  sessionManager: SessionManager;
}

export async function bootstrapSessionRuntime(
  prisma: PrismaClient,
  logger: FastifyBaseLogger,
): Promise<SessionBootstrapResult | null> {
  const sessionTokenSecret = process.env["SESSION_TOKEN_SECRET"];
  if (!sessionTokenSecret) return null;

  const { SessionManager } = await import("@switchboard/core/sessions");
  const {
    PrismaSessionStore,
    PrismaRunStore,
    PrismaPauseStore,
    PrismaToolEventStore,
    PrismaRoleOverrideStore,
  } = await import("@switchboard/db");

  const maxConcurrent = parseInt(process.env["MAX_CONCURRENT_SESSIONS"] ?? "10", 10);

  const sessionManager = new SessionManager({
    sessions: new PrismaSessionStore(prisma),
    runs: new PrismaRunStore(prisma),
    pauses: new PrismaPauseStore(prisma),
    toolEvents: new PrismaToolEventStore(prisma),
    roleOverrides: new PrismaRoleOverrideStore(prisma),
    maxConcurrentSessions: maxConcurrent,
    getRoleCheckpointValidator: () => undefined,
  });

  logger.info("Session runtime enabled (checkpoint validation skipped — use workflow API)");
  return { sessionManager };
}
