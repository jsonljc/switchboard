import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { PrismaActivityPreviewReader } from "../prisma-activity-preview-reader.js";

function buildPrismaMock(
  rows: Array<{
    contactId: string;
    direction: "inbound" | "outbound";
    content: string;
    createdAt: Date;
    metadata: Record<string, unknown>;
  }>,
) {
  return {
    conversationMessage: {
      findMany: vi.fn(async ({ where, orderBy: _orderBy, take: _take }) => {
        const contactIds: string[] = where.contactId.in ?? [where.contactId];
        return rows
          .filter((r) => contactIds.includes(r.contactId))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }),
    },
  } as unknown as PrismaClient;
}

describe("PrismaActivityPreviewReader", () => {
  it("returns one bucket per contactId, ordered desc", async () => {
    const now = new Date("2026-05-15T10:00:00Z");
    const prisma = buildPrismaMock([
      {
        contactId: "c1",
        direction: "inbound",
        content: "earlier",
        createdAt: new Date(now.getTime() - 60_000),
        metadata: {},
      },
      {
        contactId: "c1",
        direction: "outbound",
        content: "later",
        createdAt: now,
        metadata: {},
      },
      {
        contactId: "c2",
        direction: "inbound",
        content: "hello",
        createdAt: now,
        metadata: {},
      },
    ]);

    const reader = new PrismaActivityPreviewReader(prisma);
    const result = await reader.readRecentBatch({
      contactIds: ["c1", "c2"],
      orgId: "org-1",
      limit: 4,
    });

    expect(result.c1).toHaveLength(2);
    expect(result.c1![0]!.text).toBe("later");
    expect(result.c1![0]!.from).toBe("alex");
    expect(result.c1![1]!.from).toBe("contact");
    expect(result.c2).toHaveLength(1);
    expect(result.c2![0]!.text).toBe("hello");
  });

  it("maps metadata.author='operator' to from='operator' on outbound", async () => {
    const prisma = buildPrismaMock([
      {
        contactId: "c1",
        direction: "outbound",
        content: "operator wrote",
        createdAt: new Date(),
        metadata: { author: "operator" },
      },
    ]);
    const reader = new PrismaActivityPreviewReader(prisma);
    const result = await reader.readRecentBatch({
      contactIds: ["c1"],
      orgId: "org-1",
      limit: 4,
    });
    expect(result.c1![0]!.from).toBe("operator");
  });

  it("returns empty array for contactIds with no messages", async () => {
    const prisma = buildPrismaMock([]);
    const reader = new PrismaActivityPreviewReader(prisma);
    const result = await reader.readRecentBatch({
      contactIds: ["c1"],
      orgId: "org-1",
      limit: 4,
    });
    expect(result.c1).toEqual([]);
  });

  it("issues a single findMany call regardless of contactIds count", async () => {
    const prisma = buildPrismaMock([]);
    const reader = new PrismaActivityPreviewReader(prisma);
    await reader.readRecentBatch({
      contactIds: ["c1", "c2", "c3", "c4"],
      orgId: "org-1",
      limit: 4,
    });
    expect(prisma.conversationMessage.findMany as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(
      1,
    );
  });

  it("does not starve quiet contacts when a chatty contact dominates recency", async () => {
    // Regression for take-cap starvation bug: with the old take=N*limit
    // clause, a chatty contact whose N*limit newest messages dominate
    // global ORDER BY DESC would consume the entire fetch, leaving other
    // contacts empty even when they have messages.
    const now = new Date("2026-05-15T10:00:00Z");
    const chattyMessages = Array.from({ length: 20 }, (_, i) => ({
      contactId: "chatty",
      direction: "inbound" as const,
      content: `chatty #${i}`,
      createdAt: new Date(now.getTime() - i * 1000),
      metadata: {},
    }));
    const quietMessage = {
      contactId: "quiet",
      direction: "inbound" as const,
      content: "quiet hello",
      createdAt: new Date(now.getTime() - 100_000),
      metadata: {},
    };
    const prisma = buildPrismaMock([...chattyMessages, quietMessage]);
    const reader = new PrismaActivityPreviewReader(prisma);
    const result = await reader.readRecentBatch({
      contactIds: ["chatty", "quiet"],
      orgId: "org-1",
      limit: 4,
    });
    expect(result.chatty).toHaveLength(4);
    expect(result.quiet).toHaveLength(1);
    expect(result.quiet![0]!.text).toBe("quiet hello");
  });
});
