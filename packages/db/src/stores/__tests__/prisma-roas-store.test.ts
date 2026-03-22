import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaRoasStore } from "../prisma-roas-store.js";

function mockPrisma() {
  return {
    roasSnapshot: {
      upsert: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

describe("PrismaRoasStore", () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let store: PrismaRoasStore;

  beforeEach(() => {
    prisma = mockPrisma();
    store = new PrismaRoasStore(prisma as never);
  });

  it("saveSnapshot upserts a daily snapshot", async () => {
    await store.saveSnapshot({
      orgId: "org-1",
      entityType: "campaign",
      entityId: "camp-1",
      platform: "meta",
      roas: 3.5,
      spend: 100,
      revenue: 350,
      snapshotDate: new Date("2026-03-22"),
    });

    expect(prisma.roasSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          orgId_entityType_entityId_snapshotDate: {
            orgId: "org-1",
            entityType: "campaign",
            entityId: "camp-1",
            snapshotDate: new Date("2026-03-22"),
          },
        },
      }),
    );
  });

  it("getWindow returns snapshots within lookback days", async () => {
    prisma.roasSnapshot.findMany.mockResolvedValue([
      {
        roas: 3.0,
        spend: 100,
        revenue: 300,
        snapshotDate: new Date("2026-03-21"),
        platform: "meta",
        campaignStatus: null,
      },
    ]);

    const results = await store.getWindow("org-1", "campaign", "camp-1", 30);
    expect(results).toHaveLength(1);
    expect(prisma.roasSnapshot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgId: "org-1",
          entityType: "campaign",
          entityId: "camp-1",
        }),
      }),
    );
  });
});
