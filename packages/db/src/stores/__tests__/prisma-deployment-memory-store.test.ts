import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaDeploymentMemoryStore } from "../prisma-deployment-memory-store.js";
import { StaleVersionError } from "@switchboard/core";

function createMockPrisma() {
  return {
    deploymentMemory: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findFirstOrThrow: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
  };
}

describe("PrismaDeploymentMemoryStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaDeploymentMemoryStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaDeploymentMemoryStore(prisma as never);
  });

  it("creates a memory entry", async () => {
    const input = {
      organizationId: "org-1",
      deploymentId: "dep-1",
      category: "fact" as const,
      content: "Closed on Sundays",
    };
    const now = new Date();
    (prisma.deploymentMemory.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "mem-1",
      ...input,
      confidence: 0.5,
      sourceCount: 1,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const result = await store.create(input);
    expect(result.id).toBe("mem-1");
  });

  it("uses default confidence of 0.5 when not provided", async () => {
    const input = {
      organizationId: "org-1",
      deploymentId: "dep-1",
      category: "fact",
      content: "Closed on Sundays",
    };
    const now = new Date();
    (prisma.deploymentMemory.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "mem-1",
      ...input,
      confidence: 0.5,
      sourceCount: 1,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await store.create(input);
    expect(prisma.deploymentMemory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ confidence: 0.5, sourceCount: 1 }),
      }),
    );
  });

  it("increments sourceCount and updates confidence on upsert", async () => {
    const existing = {
      id: "mem-1",
      organizationId: "org-1",
      deploymentId: "dep-1",
      category: "fact",
      content: "Closed on Sundays",
      confidence: 0.5,
      sourceCount: 1,
      lastSeenAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    (prisma.deploymentMemory.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 1,
    });
    (prisma.deploymentMemory.findFirstOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...existing,
      sourceCount: 2,
      confidence: 0.6,
    });

    const result = await store.incrementConfidence("org-1", "mem-1", 0.6);
    expect(result.sourceCount).toBe(2);
    expect(prisma.deploymentMemory.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "mem-1", organizationId: "org-1" },
      }),
    );
  });

  it("incrementConfidence throws StaleVersionError when count === 0", async () => {
    (prisma.deploymentMemory.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 0,
    });

    await expect(store.incrementConfidence("org-1", "mem-1", 0.6)).rejects.toBeInstanceOf(
      StaleVersionError,
    );
  });

  it("lists high-confidence entries", async () => {
    (prisma.deploymentMemory.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const result = await store.listHighConfidence("org-1", "dep-1", 0.66, 3);
    expect(result).toEqual([]);
    expect(prisma.deploymentMemory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          confidence: { gte: 0.66 },
          sourceCount: { gte: 3 },
          invalidatedAt: null,
        }),
      }),
    );
  });

  it("listHighConfidence returns lastSeenAt and orders by confidence desc only (no lastSeenAt tiebreaker)", async () => {
    const higherConfidence = {
      id: "mem-higher",
      organizationId: "org-1",
      deploymentId: "dep-1",
      category: "fact",
      content: "high-confidence-older",
      confidence: 0.9,
      sourceCount: 5,
      lastSeenAt: new Date("2026-01-01"),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const lowerConfidence = {
      id: "mem-lower",
      organizationId: "org-1",
      deploymentId: "dep-1",
      category: "fact",
      content: "low-confidence-newer",
      confidence: 0.7,
      sourceCount: 5,
      lastSeenAt: new Date("2026-05-01"),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    // Mock Prisma returns the rows in confidence-desc order (matches the orderBy contract).
    (prisma.deploymentMemory.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      higherConfidence,
      lowerConfidence,
    ]);

    const rows = await store.listHighConfidence("org-1", "dep-1", 0.5, 1);

    // The store must propagate Prisma's order (no client-side resort).
    expect(rows[0]!.id).toBe("mem-higher");
    expect(rows[1]!.id).toBe("mem-lower");
    // lastSeenAt MUST be propagated (regression guard: no `select` that drops the column).
    expect(rows[0]!.lastSeenAt).toEqual(new Date("2026-01-01"));
    expect(rows[1]!.lastSeenAt).toEqual(new Date("2026-05-01"));
    // The orderBy clause must remain single-key confidence-desc — no lastSeenAt tiebreaker.
    expect(prisma.deploymentMemory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { confidence: "desc" },
      }),
    );
  });

  it("lists all entries by deployment ordered by confidence desc", async () => {
    (prisma.deploymentMemory.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await store.listByDeployment("org-1", "dep-1");
    expect(prisma.deploymentMemory.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", deploymentId: "dep-1", invalidatedAt: null },
      orderBy: { confidence: "desc" },
    });
  });

  it("finds entries by category", async () => {
    (prisma.deploymentMemory.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await store.findByCategory("org-1", "dep-1", "preference");
    expect(prisma.deploymentMemory.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        deploymentId: "dep-1",
        category: "preference",
        invalidatedAt: null,
      },
    });
  });

  it("deletes a memory entry by id and organizationId", async () => {
    (prisma.deploymentMemory.deleteMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 1,
    });
    await store.delete("org-1", "mem-1");
    expect(prisma.deploymentMemory.deleteMany).toHaveBeenCalledWith({
      where: { id: "mem-1", organizationId: "org-1" },
    });
  });

  it("delete throws StaleVersionError when count === 0", async () => {
    (prisma.deploymentMemory.deleteMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 0,
    });

    await expect(store.delete("org-1", "mem-1")).rejects.toBeInstanceOf(StaleVersionError);
  });

  it("counts memory entries by deployment", async () => {
    (prisma.deploymentMemory.count as ReturnType<typeof vi.fn>).mockResolvedValue(7);
    const result = await store.countByDeployment("org-1", "dep-1");
    expect(result).toBe(7);
    expect(prisma.deploymentMemory.count).toHaveBeenCalledWith({
      where: { organizationId: "org-1", deploymentId: "dep-1", invalidatedAt: null },
    });
  });

  it("findEvictionCandidate selects the lowest-confidence, oldest entry", async () => {
    (prisma.deploymentMemory.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "mem-stale",
      confidence: 0.31,
    });

    const result = await store.findEvictionCandidate("org-1", "dep-1");

    expect(result).toEqual({ id: "mem-stale", confidence: 0.31 });
    expect(prisma.deploymentMemory.findFirst).toHaveBeenCalledWith({
      where: { organizationId: "org-1", deploymentId: "dep-1", invalidatedAt: null },
      orderBy: [{ confidence: "asc" }, { lastSeenAt: "asc" }],
      select: { id: true, confidence: true },
    });
  });

  it("findEvictionCandidate returns null when the deployment has no entries", async () => {
    (prisma.deploymentMemory.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const result = await store.findEvictionCandidate("org-1", "dep-1");
    expect(result).toBeNull();
  });

  it("findByCategoryAndCanonicalKey filters by all four columns", async () => {
    (prisma.deploymentMemory.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "m1",
        content: "x",
        canonicalKey: "objection:downtime_work",
        confidence: 0.7,
        sourceCount: 2,
      },
    ]);
    const rows = await store.findByCategoryAndCanonicalKey(
      "org-1",
      "dep-1",
      "pattern",
      "objection:downtime_work",
    );
    expect(prisma.deploymentMemory.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        deploymentId: "dep-1",
        category: "pattern",
        canonicalKey: "objection:downtime_work",
        invalidatedAt: null,
      },
    });
    expect(rows).toHaveLength(1);
  });

  it("create accepts an optional canonicalKey", async () => {
    (prisma.deploymentMemory.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "m2" });
    await store.create({
      organizationId: "org-1",
      deploymentId: "dep-1",
      category: "pattern",
      content: "Customers ask about downtime",
      canonicalKey: "objection:downtime_work",
    });
    expect(prisma.deploymentMemory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ canonicalKey: "objection:downtime_work" }),
    });
  });

  it("create persists canonicalKey as null when omitted", async () => {
    (prisma.deploymentMemory.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "m3" });
    await store.create({
      organizationId: "org-1",
      deploymentId: "dep-1",
      category: "fact",
      content: "Closed on Sundays",
    });
    expect(prisma.deploymentMemory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ canonicalKey: null }),
    });
  });

  it("decays above-floor stale rows and invalidates at-floor stale rows (2-pass)", async () => {
    const prisma = createMockPrisma();
    prisma.deploymentMemory.updateMany
      .mockResolvedValueOnce({ count: 4 }) // pass 1: decrement
      .mockResolvedValueOnce({ count: 2 }); // pass 2: invalidate
    const store = new PrismaDeploymentMemoryStore(prisma as never);
    const cutoffDate = new Date("2026-01-01");
    const startOfDay = new Date("2026-06-22");
    const count = await store.decayStale({ cutoffDate, decayAmount: 0.1, floor: 0.3, startOfDay });
    expect(count).toBe(4); // returns the DECREMENTED count (metric meaning preserved)
    expect(prisma.deploymentMemory.updateMany).toHaveBeenCalledTimes(2);
    // Pin the FULL where on BOTH passes (toEqual, not toMatchObject) — the
    // staleness predicate lastSeenAt:{lt:cutoffDate} is safety-critical on pass 2
    // (it is the ONLY thing scoping decay; omitting it would invalidate
    // recently-seen low-confidence rows). This assertion is the RED guard.
    const pass1 = prisma.deploymentMemory.updateMany.mock.calls[0]![0]!;
    expect(pass1.where).toEqual({
      lastSeenAt: { lt: cutoffDate },
      confidence: { gt: 0.3 },
      invalidatedAt: null,
      OR: [{ lastDecayedAt: null }, { lastDecayedAt: { lt: startOfDay } }],
    });
    expect(pass1.data.confidence).toEqual({ decrement: 0.1 });
    const pass2 = prisma.deploymentMemory.updateMany.mock.calls[1]![0]!;
    expect(pass2.where).toEqual({
      lastSeenAt: { lt: cutoffDate },
      confidence: { lte: 0.3 },
      invalidatedAt: null,
    });
    expect(pass2.data).toEqual({ invalidatedAt: expect.any(Date), validTo: expect.any(Date) });
  });

  it("decayStale floor: rows already at floor are not decremented further", async () => {
    (prisma.deploymentMemory.updateMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ count: 0 }) // pass 1: none decremented
      .mockResolvedValueOnce({ count: 0 }); // pass 2: none invalidated
    const result = await store.decayStale({
      cutoffDate: new Date(),
      decayAmount: 0.1,
      floor: 0.3,
      startOfDay: new Date(),
    });
    expect(result).toBe(0);
  });

  describe("invalidate", () => {
    it("soft-removes by setting invalidatedAt + validTo, scoped to live rows", async () => {
      const prisma = createMockPrisma();
      prisma.deploymentMemory.updateMany.mockResolvedValue({ count: 1 });
      const store = new PrismaDeploymentMemoryStore(prisma as never);
      await store.invalidate("org-1", "mem-1");
      const arg = prisma.deploymentMemory.updateMany.mock.calls[0]![0]!;
      expect(arg.where).toEqual({ id: "mem-1", organizationId: "org-1", invalidatedAt: null });
      expect(arg.data.invalidatedAt).toBeInstanceOf(Date);
      expect(arg.data.validTo).toBeInstanceOf(Date);
    });
    it("throws StaleVersionError when the row is already gone/invalidated", async () => {
      const prisma = createMockPrisma();
      prisma.deploymentMemory.updateMany.mockResolvedValue({ count: 0 });
      const store = new PrismaDeploymentMemoryStore(prisma as never);
      await expect(store.invalidate("org-1", "mem-1")).rejects.toBeInstanceOf(StaleVersionError);
    });
  });

  describe("create provenance + resurrection", () => {
    it("persists source + validFrom on a fresh create", async () => {
      const prisma = createMockPrisma();
      prisma.deploymentMemory.create.mockResolvedValue({ id: "m1" });
      const store = new PrismaDeploymentMemoryStore(prisma as never);
      await store.create({
        organizationId: "o1",
        deploymentId: "d1",
        category: "fact",
        content: "c",
        source: "conversation-compounding",
      });
      const data = prisma.deploymentMemory.create.mock.calls[0]![0]!.data;
      expect(data.source).toBe("conversation-compounding");
      expect(data.validFrom).toBeInstanceOf(Date);
    });
    it("resurrects an invalidated colliding row on P2002", async () => {
      const prisma = createMockPrisma();
      prisma.deploymentMemory.create.mockRejectedValue({ code: "P2002" });
      prisma.deploymentMemory.findFirst.mockResolvedValue({
        id: "old",
        invalidatedAt: new Date(),
      });
      prisma.deploymentMemory.update.mockResolvedValue({ id: "old" });
      const store = new PrismaDeploymentMemoryStore(prisma as never);
      const r = await store.create({
        organizationId: "o1",
        deploymentId: "d1",
        category: "fact",
        content: "c",
        source: "conversation-compounding",
      });
      expect(prisma.deploymentMemory.findFirst).toHaveBeenCalled();
      const upd = prisma.deploymentMemory.update.mock.calls[0]![0]!;
      expect(upd.where).toEqual({ id: "old" });
      expect(upd.data.invalidatedAt).toBeNull();
      expect(upd.data.validTo).toBeNull();
      expect(upd.data.sourceCount).toBe(1);
      expect(r).toEqual({ id: "old" });
    });
    it("rethrows P2002 when the colliding row is LIVE (no resurrection)", async () => {
      const prisma = createMockPrisma();
      prisma.deploymentMemory.create.mockRejectedValue({ code: "P2002" });
      prisma.deploymentMemory.findFirst.mockResolvedValue({ id: "live", invalidatedAt: null });
      const store = new PrismaDeploymentMemoryStore(prisma as never);
      await expect(
        store.create({ organizationId: "o1", deploymentId: "d1", category: "fact", content: "c" }),
      ).rejects.toMatchObject({ code: "P2002" });
      expect(prisma.deploymentMemory.findFirst).toHaveBeenCalled();
      expect(prisma.deploymentMemory.update).not.toHaveBeenCalled();
    });
    it("rethrows P2002 when no colliding row is found (race)", async () => {
      const prisma = createMockPrisma();
      prisma.deploymentMemory.create.mockRejectedValue({ code: "P2002" });
      prisma.deploymentMemory.findFirst.mockResolvedValue(null);
      const store = new PrismaDeploymentMemoryStore(prisma as never);
      await expect(
        store.create({ organizationId: "o1", deploymentId: "d1", category: "fact", content: "c" }),
      ).rejects.toMatchObject({ code: "P2002" });
    });
  });
});
