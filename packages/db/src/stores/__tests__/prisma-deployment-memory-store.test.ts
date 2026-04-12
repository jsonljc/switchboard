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
    await store.findByContent("org-1", "dep-1", "preference");
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
});
