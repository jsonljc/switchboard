import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaDeploymentMemoryStore } from "../prisma-deployment-memory-store.js";

function createMockPrisma() {
  return {
    deploymentMemory: {
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
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
    (prisma.deploymentMemory.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...existing,
      sourceCount: 2,
      confidence: 0.6,
    });

    const result = await store.incrementConfidence("mem-1", 0.6);
    expect(result.sourceCount).toBe(2);
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
      where: { organizationId: "org-1", deploymentId: "dep-1" },
      orderBy: { confidence: "desc" },
    });
  });

  it("finds entries by category", async () => {
    (prisma.deploymentMemory.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await store.findByCategory("org-1", "dep-1", "preference");
    expect(prisma.deploymentMemory.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", deploymentId: "dep-1", category: "preference" },
    });
  });

  it("deletes a memory entry by id", async () => {
    (prisma.deploymentMemory.delete as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "mem-1" });
    await store.delete("mem-1");
    expect(prisma.deploymentMemory.delete).toHaveBeenCalledWith({ where: { id: "mem-1" } });
  });

  it("counts memory entries by deployment", async () => {
    (prisma.deploymentMemory.count as ReturnType<typeof vi.fn>).mockResolvedValue(7);
    const result = await store.countByDeployment("org-1", "dep-1");
    expect(result).toBe(7);
    expect(prisma.deploymentMemory.count).toHaveBeenCalledWith({
      where: { organizationId: "org-1", deploymentId: "dep-1" },
    });
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
});
