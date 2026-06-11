import type { PrismaDbClient } from "../prisma-db.js";

export interface PurgeExpiredInput {
  /** Rows whose status is in softStatuses and createdAt < softCutoff are purged. */
  softCutoff: Date;
  /** Rows of ANY status with createdAt < hardCutoff are purged (absolute cap). */
  hardCutoff: Date;
  softStatuses: string[];
  batchSize: number;
  maxBatches: number;
}

export interface PurgeExpiredResult {
  purged: number;
  batches: number;
  /** True when maxBatches was hit with rows still eligible (next run continues). */
  truncated: boolean;
}

/**
 * Retention purge for the dead-letter queue (`FailedMessage`). The DLQ stores
 * the entire inbound webhook (patient message text + phone) verbatim; without a
 * purge it retains PII forever (PDPA F6). This deletes terminal-status rows past
 * the soft window and any-status rows past the hard cap, in bounded batches so a
 * large backlog never holds long table locks. Cross-tenant by design — see the
 * store-mutation-global annotation below.
 */
export class PrismaFailedMessageRetentionStore {
  constructor(private prisma: PrismaDbClient) {}

  async purgeExpired(input: PurgeExpiredInput): Promise<PurgeExpiredResult> {
    const where = {
      OR: [
        { status: { in: input.softStatuses }, createdAt: { lt: input.softCutoff } },
        { createdAt: { lt: input.hardCutoff } },
      ],
    };

    let purged = 0;
    let batches = 0;
    let truncated = false;

    for (;;) {
      if (batches >= input.maxBatches) {
        truncated = true;
        break;
      }

      const rows = await this.prisma.failedMessage.findMany({
        where,
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take: input.batchSize,
      });
      if (rows.length === 0) break;

      const ids = rows.map((r: { id: string }) => r.id);
      // route-governance: store-mutation-global — daily cron-triggered (inngest
      // 0 4 * * *) cross-tenant PDPA retention purge of the dead-letter queue;
      // no tenant context, intentionally system-wide.
      const result = await this.prisma.failedMessage.deleteMany({ where: { id: { in: ids } } });
      purged += result.count;
      batches += 1;
    }

    return { purged, batches, truncated };
  }
}
