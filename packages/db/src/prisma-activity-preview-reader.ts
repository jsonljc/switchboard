import type { PrismaClient } from "@prisma/client";
import type { ActivityPreviewReader, ThreadMessageRecord } from "@switchboard/core";

export class PrismaActivityPreviewReader implements ActivityPreviewReader {
  constructor(private readonly prisma: PrismaClient) {}

  async readRecentBatch(args: {
    contactIds: readonly string[];
    orgId: string;
    limit: number;
  }): Promise<Record<string, ThreadMessageRecord[]>> {
    if (args.contactIds.length === 0) return {};

    const rows = await this.prisma.conversationMessage.findMany({
      where: {
        contactId: { in: [...args.contactIds] },
        orgId: args.orgId,
      },
      orderBy: { createdAt: "desc" },
      // Over-fetch so each contact's bucket has enough rows even when one
      // contact dominates. Final per-bucket slice happens after grouping.
      take: args.contactIds.length * args.limit,
      select: {
        contactId: true,
        direction: true,
        content: true,
        createdAt: true,
        metadata: true,
      },
    });

    const buckets: Record<string, ThreadMessageRecord[]> = {};
    for (const id of args.contactIds) buckets[id] = [];

    for (const row of rows) {
      const bucket = buckets[row.contactId];
      if (!bucket || bucket.length >= args.limit) continue;
      bucket.push({
        from: resolveFrom(row.direction, row.metadata as Record<string, unknown>),
        text: row.content,
        createdAt: row.createdAt.toISOString(),
      });
    }

    return buckets;
  }
}

function resolveFrom(
  direction: string,
  metadata: Record<string, unknown>,
): "contact" | "alex" | "operator" {
  if (direction === "inbound") return "contact";
  if (metadata && metadata.author === "operator") return "operator";
  return "alex";
}
