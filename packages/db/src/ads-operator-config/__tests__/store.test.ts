import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaAdsOperatorConfigStore } from "../store.js";

function createMockPrisma() {
  return {
    adsOperatorConfig: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
}

const TEST_ROW = {
  id: "config-1",
  organizationId: "org-1",
  adAccountIds: ["act_123"],
  platforms: ["meta"],
  automationLevel: "copilot",
  targets: { cpa: 25, roas: 3.0 },
  schedule: { optimizerCronHour: 6, reportCronHour: 9, timezone: "UTC" },
  notificationChannel: { type: "telegram", chatId: "12345" },
  principalId: "user-1",
  active: true,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

describe("PrismaAdsOperatorConfigStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaAdsOperatorConfigStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaAdsOperatorConfigStore(prisma as never);
  });

  it("create() inserts and returns parsed config", async () => {
    prisma.adsOperatorConfig.create.mockResolvedValue(TEST_ROW);

    const result = await store.create({
      organizationId: "org-1",
      adAccountIds: ["act_123"],
      platforms: ["meta"],
      automationLevel: "copilot",
      targets: { cpa: 25, roas: 3.0 },
      schedule: { optimizerCronHour: 6, reportCronHour: 9, timezone: "UTC" },
      notificationChannel: { type: "telegram", chatId: "12345" },
      principalId: "user-1",
      active: true,
    });

    expect(result.id).toBe("config-1");
    expect(result.organizationId).toBe("org-1");
    expect(result.platforms).toEqual(["meta"]);
    expect(result.targets.cpa).toBe(25);
    expect(result.schedule.optimizerCronHour).toBe(6);
    expect(result.notificationChannel.type).toBe("telegram");
    expect(prisma.adsOperatorConfig.create).toHaveBeenCalledTimes(1);
  });

  it("getByOrg() returns config or null", async () => {
    prisma.adsOperatorConfig.findFirst.mockResolvedValue(TEST_ROW);
    const result = await store.getByOrg("org-1");
    expect(result).not.toBeNull();
    expect(result!.organizationId).toBe("org-1");

    prisma.adsOperatorConfig.findFirst.mockResolvedValue(null);
    const noResult = await store.getByOrg("org-missing");
    expect(noResult).toBeNull();
  });

  it("listActive() returns only active configs", async () => {
    prisma.adsOperatorConfig.findMany.mockResolvedValue([TEST_ROW]);
    const results = await store.listActive();
    expect(results).toHaveLength(1);
    expect(results[0]!.active).toBe(true);
    expect(prisma.adsOperatorConfig.findMany).toHaveBeenCalledWith({
      where: { active: true },
    });
  });

  it("update() applies partial updates", async () => {
    prisma.adsOperatorConfig.update.mockResolvedValue({
      ...TEST_ROW,
      automationLevel: "autonomous",
    });
    const result = await store.update("config-1", { automationLevel: "autonomous" });
    expect(result.automationLevel).toBe("autonomous");
    expect(prisma.adsOperatorConfig.update).toHaveBeenCalledWith({
      where: { id: "config-1" },
      data: { automationLevel: "autonomous" },
    });
  });

  it("deactivate() sets active to false", async () => {
    prisma.adsOperatorConfig.update.mockResolvedValue({ ...TEST_ROW, active: false });
    await store.deactivate("config-1");
    expect(prisma.adsOperatorConfig.update).toHaveBeenCalledWith({
      where: { id: "config-1" },
      data: { active: false },
    });
  });
});
