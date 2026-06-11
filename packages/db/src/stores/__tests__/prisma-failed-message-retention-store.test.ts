import { describe, expect, it, vi } from "vitest";
import { PrismaFailedMessageRetentionStore } from "../prisma-failed-message-retention-store.js";
import type { PrismaDbClient } from "../../prisma-db.js";

function makePrisma(batches: string[][]) {
  // findMany returns successive batches of {id}; deleteMany echoes the count.
  let call = 0;
  const findMany = vi.fn(async () => {
    const ids = batches[call] ?? [];
    call += 1;
    return ids.map((id) => ({ id }));
  });
  const deleteMany = vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => ({
    count: where.id.in.length,
  }));
  const prisma = { failedMessage: { findMany, deleteMany } };
  return {
    prisma: prisma as unknown as PrismaDbClient,
    findMany,
    deleteMany,
  };
}

const SOFT = new Date("2026-05-12T00:00:00Z"); // now - 30d
const HARD = new Date("2026-03-13T00:00:00Z"); // now - 90d

describe("PrismaFailedMessageRetentionStore.purgeExpired", () => {
  it("selects with the soft-status-OR-hard-cap predicate, oldest first", async () => {
    const { prisma, findMany } = makePrisma([["a", "b"], []]);
    const store = new PrismaFailedMessageRetentionStore(prisma);
    await store.purgeExpired({
      softCutoff: SOFT,
      hardCutoff: HARD,
      softStatuses: ["resolved", "exhausted"],
      batchSize: 1000,
      maxBatches: 100,
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { status: { in: ["resolved", "exhausted"] }, createdAt: { lt: SOFT } },
          { createdAt: { lt: HARD } },
        ],
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: 1000,
    });
  });

  it("loops batched deletes until a batch is empty and sums the count", async () => {
    const { prisma, deleteMany } = makePrisma([["a", "b"], ["c"], []]);
    const store = new PrismaFailedMessageRetentionStore(prisma);
    const result = await store.purgeExpired({
      softCutoff: SOFT,
      hardCutoff: HARD,
      softStatuses: ["resolved", "exhausted"],
      batchSize: 2,
      maxBatches: 100,
    });
    expect(deleteMany).toHaveBeenNthCalledWith(1, { where: { id: { in: ["a", "b"] } } });
    expect(deleteMany).toHaveBeenNthCalledWith(2, { where: { id: { in: ["c"] } } });
    expect(result).toEqual({ purged: 3, batches: 2, truncated: false });
  });

  it("halts at maxBatches and reports truncated", async () => {
    const { prisma, deleteMany } = makePrisma([["a"], ["b"], ["c"]]); // would keep going
    const store = new PrismaFailedMessageRetentionStore(prisma);
    const result = await store.purgeExpired({
      softCutoff: SOFT,
      hardCutoff: HARD,
      softStatuses: ["resolved", "exhausted"],
      batchSize: 1,
      maxBatches: 2,
    });
    expect(result).toEqual({ purged: 2, batches: 2, truncated: true });
    expect(deleteMany).toHaveBeenCalledTimes(2);
  });

  it("does nothing when the first batch is empty", async () => {
    const { prisma, deleteMany } = makePrisma([[]]);
    const store = new PrismaFailedMessageRetentionStore(prisma);
    const result = await store.purgeExpired({
      softCutoff: SOFT,
      hardCutoff: HARD,
      softStatuses: ["resolved", "exhausted"],
      batchSize: 1000,
      maxBatches: 100,
    });
    expect(result).toEqual({ purged: 0, batches: 0, truncated: false });
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
