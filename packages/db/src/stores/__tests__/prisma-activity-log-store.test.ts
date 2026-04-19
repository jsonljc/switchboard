import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaActivityLogStore } from "../prisma-activity-log-store.js";

function createMockPrisma() {
  return {
    activityLog: {
      create: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
}

describe("PrismaActivityLogStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaActivityLogStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaActivityLogStore(prisma as never);
  });

  it("writes a log entry", async () => {
    prisma.activityLog.create.mockResolvedValue({ id: "log-1" });
    await store.write({
      organizationId: "org-1",
      deploymentId: "dep-1",
      eventType: "fact_learned",
      description: "Learned: busiest day is Tuesday",
      metadata: { category: "business_hours" },
    });
    expect(prisma.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        eventType: "fact_learned",
        description: "Learned: busiest day is Tuesday",
      }),
    });
  });

  it("lists entries by deployment", async () => {
    prisma.activityLog.findMany.mockResolvedValue([]);
    await store.listByDeployment("org-1", "dep-1", { limit: 10 });
    expect(prisma.activityLog.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", deploymentId: "dep-1" },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
  });

  it("defaults limit to 50", async () => {
    prisma.activityLog.findMany.mockResolvedValue([]);
    await store.listByDeployment("org-1", "dep-1");
    expect(prisma.activityLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
  });

  it("cleans up old entries", async () => {
    const cutoff = new Date();
    prisma.activityLog.deleteMany.mockResolvedValue({ count: 3 });
    const count = await store.cleanup(cutoff);
    expect(count).toBe(3);
    expect(prisma.activityLog.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: cutoff } },
    });
  });
});
