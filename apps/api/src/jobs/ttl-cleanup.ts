import type { PrismaClient } from "@switchboard/db";
import { createLogger } from "../logger.js";
import type { Logger } from "../logger.js";

export interface TtlCleanupJobConfig {
  prisma: PrismaClient;
  /** How often to run cleanup (default: 1 hour). */
  intervalMs?: number;
  /** Max age for idempotency records (default: 24 hours). */
  idempotencyTtlMs?: number;
  /** Max age for processed messages (default: 7 days). */
  processedMessageTtlMs?: number;
  /** Max age for resolved failed messages (default: 30 days). */
  failedMessageTtlMs?: number;
  logger?: Logger;
}

/**
 * Periodically purges expired records from TTL-managed tables:
 * - IdempotencyRecord (default: 24h)
 * - ProcessedMessage (default: 7d)
 * - FailedMessage with status=resolved (default: 30d)
 *
 * Returns a cleanup function that stops the interval.
 */
export function startTtlCleanupJob(config: TtlCleanupJobConfig): () => void {
  const {
    prisma,
    intervalMs = 3_600_000,
    idempotencyTtlMs = 24 * 60 * 60 * 1000,
    processedMessageTtlMs = 7 * 24 * 60 * 60 * 1000,
    failedMessageTtlMs = 30 * 24 * 60 * 60 * 1000,
    logger = createLogger("ttl-cleanup"),
  } = config;

  let stopped = false;

  const cleanup = async () => {
    if (stopped) return;
    try {
      const now = new Date();

      const idempotencyCutoff = new Date(now.getTime() - idempotencyTtlMs);
      const processedCutoff = new Date(now.getTime() - processedMessageTtlMs);
      const failedCutoff = new Date(now.getTime() - failedMessageTtlMs);

      const [idempotency, processed, failed] = await Promise.all([
        prisma.idempotencyRecord.deleteMany({
          where: { createdAt: { lt: idempotencyCutoff } },
        }),
        prisma.processedMessage.deleteMany({
          where: { createdAt: { lt: processedCutoff } },
        }),
        prisma.failedMessage.deleteMany({
          where: {
            status: "resolved",
            createdAt: { lt: failedCutoff },
          },
        }),
      ]);

      const total = idempotency.count + processed.count + failed.count;
      if (total > 0) {
        logger.info(
          { idempotency: idempotency.count, processed: processed.count, failed: failed.count },
          `TTL cleanup: purged ${total} expired records`,
        );
      }
    } catch (err) {
      logger.warn({ err }, "TTL cleanup failed (will retry next cycle)");
    }
  };

  const timer = setInterval(() => {
    void cleanup();
  }, intervalMs);

  // Run once on startup after a short delay
  setTimeout(() => {
    if (!stopped) void cleanup();
  }, 5_000);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
