import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaGovernanceVerdictStore } from "../prisma-governance-verdict-store.js";

const buildPrismaMock = () => ({
  governanceVerdict: {
    create: vi.fn(),
    findMany: vi.fn(),
    groupBy: vi.fn(),
  },
});

type PrismaMock = ReturnType<typeof buildPrismaMock>;

const baseInput = {
  action: "block" as const,
  reasonCode: "banned_phrase" as const,
  jurisdiction: "SG" as const,
  clinicType: "medical" as const,
  sourceGuard: "banned_phrase_scanner" as const,
  originalText: "this is guaranteed",
  emittedText: "Thanks for sharing that — ...",
  auditLevel: "critical" as const,
  decidedAt: "2026-05-10T12:00:00.000Z",
  conversationId: "conv-1",
  deploymentId: "dep-1",
  details: { matchCategory: "guarantee", matchId: "guarantee_basic", matchedText: "guaranteed" },
};

describe("PrismaGovernanceVerdictStore", () => {
  let prisma: PrismaMock;
  let store: PrismaGovernanceVerdictStore;

  beforeEach(() => {
    prisma = buildPrismaMock();
    store = new PrismaGovernanceVerdictStore(prisma as never);
  });

  it("save passes input through to prisma.create with details serialized", async () => {
    prisma.governanceVerdict.create.mockResolvedValue({
      id: "v1",
      ...baseInput,
      decidedAt: new Date(baseInput.decidedAt),
      createdAt: new Date("2026-05-10T12:00:01.000Z"),
      modelLatencyMs: null,
    });

    const out = await store.save(baseInput);

    expect(prisma.governanceVerdict.create).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const arg = prisma.governanceVerdict.create.mock.calls[0]![0]!;
    expect(arg.data.deploymentId).toBe("dep-1");
    expect(arg.data.details).toEqual(baseInput.details);
    expect(out.id).toBe("v1");
    expect(out.details).toEqual(baseInput.details);
  });

  it("listByConversation returns mapped records sorted by decidedAt desc", async () => {
    prisma.governanceVerdict.findMany.mockResolvedValue([
      {
        id: "v2",
        ...baseInput,
        decidedAt: new Date(baseInput.decidedAt),
        createdAt: new Date("2026-05-10T12:00:01.000Z"),
        modelLatencyMs: null,
      },
    ]);

    const out = await store.listByConversation("conv-1");
    expect(prisma.governanceVerdict.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversationId: "conv-1" },
        orderBy: { decidedAt: "desc" },
      }),
    );
    expect(out).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(out[0]!.id).toBe("v2");
  });

  it("listByDeployment honours since and limit", async () => {
    prisma.governanceVerdict.findMany.mockResolvedValue([]);
    await store.listByDeployment("dep-1", { since: "2026-05-09T00:00:00.000Z", limit: 50 });
    expect(prisma.governanceVerdict.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deploymentId: "dep-1",
          decidedAt: expect.any(Object),
        }),
        orderBy: { decidedAt: "desc" },
        take: 50,
      }),
    );
  });

  it("countByDeploymentAndClaim counts verdicts by sourceGuard + window", async () => {
    const count = vi.fn(async () => 12);
    const prismaWithCount = buildPrismaMock();
    (prismaWithCount.governanceVerdict as never as Record<string, unknown>).count = count;
    const store = new PrismaGovernanceVerdictStore(prismaWithCount as never);
    const from = new Date("2026-05-25T00:00:00Z");
    const to = new Date("2026-06-01T00:00:00Z");

    const n = await store.countByDeploymentAndClaim({
      deploymentId: "dep-1",
      claimType: "safety-claim",
      from,
      to,
    });

    expect(n).toBe(12);
    expect(count).toHaveBeenCalledWith({
      where: {
        deploymentId: "dep-1",
        sourceGuard: "safety-claim",
        decidedAt: { gte: from, lt: to },
      },
    });
  });

  it("countByDeploymentAndClaim filters by action when provided", async () => {
    const count = vi.fn(async () => 5);
    const prismaWithCount = buildPrismaMock();
    (prismaWithCount.governanceVerdict as never as Record<string, unknown>).count = count;
    const store = new PrismaGovernanceVerdictStore(prismaWithCount as never);
    const from = new Date("2026-05-25T00:00:00Z");
    const to = new Date("2026-06-01T00:00:00Z");

    const n = await store.countByDeploymentAndClaim({
      deploymentId: "dep-1",
      claimType: "safety-claim",
      action: "block",
      from,
      to,
    });

    expect(n).toBe(5);
    expect(count).toHaveBeenCalledWith({
      where: {
        deploymentId: "dep-1",
        sourceGuard: "safety-claim",
        action: "block",
        decidedAt: { gte: from, lt: to },
      },
    });
  });

  it("summarizeByDeployment groups by (sourceGuard, reasonCode, action) and maps counts", async () => {
    prisma.governanceVerdict.groupBy.mockResolvedValue([
      {
        sourceGuard: "price_gate",
        reasonCode: "unsubstantiated_price",
        action: "allow",
        _count: { _all: 5 },
      },
      {
        sourceGuard: "whatsapp_window",
        reasonCode: "outside_whatsapp_window",
        action: "template_required",
        _count: { _all: 2 },
      },
    ]);

    const out = await store.summarizeByDeployment("dep-1", { since: "2026-05-09T00:00:00.000Z" });

    expect(prisma.governanceVerdict.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ["sourceGuard", "reasonCode", "action"],
        where: {
          deploymentId: "dep-1",
          decidedAt: { gte: new Date("2026-05-09T00:00:00.000Z") },
        },
        _count: { _all: true },
      }),
    );
    expect(out).toEqual([
      { sourceGuard: "price_gate", reasonCode: "unsubstantiated_price", action: "allow", count: 5 },
      {
        sourceGuard: "whatsapp_window",
        reasonCode: "outside_whatsapp_window",
        action: "template_required",
        count: 2,
      },
    ]);
  });

  it("summarizeByDeployment omits the decidedAt filter when since is absent", async () => {
    prisma.governanceVerdict.groupBy.mockResolvedValue([]);
    await store.summarizeByDeployment("dep-1");
    expect(prisma.governanceVerdict.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deploymentId: "dep-1" } }),
    );
  });

  describe("onWrite callback", () => {
    const buildCreatedRow = () => ({
      id: "v-onwrite",
      ...baseInput,
      decidedAt: new Date(baseInput.decidedAt),
      createdAt: new Date("2026-05-10T12:00:01.000Z"),
      modelLatencyMs: null,
    });

    it("invokes onWrite after successful verdict write with the saved record", async () => {
      const onWrite = vi.fn().mockResolvedValue(undefined);
      const prismaWithHook = buildPrismaMock();
      prismaWithHook.governanceVerdict.create.mockResolvedValue(buildCreatedRow());
      const storeWithHook = new PrismaGovernanceVerdictStore(prismaWithHook as never, { onWrite });

      const out = await storeWithHook.save(baseInput);

      expect(prismaWithHook.governanceVerdict.create).toHaveBeenCalledTimes(1);
      expect(onWrite).toHaveBeenCalledTimes(1);
      // The callback receives the same record that .save() returns.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      expect(onWrite.mock.calls[0]![0]!).toEqual(out);
      expect(out.id).toBe("v-onwrite");
    });

    it("propagates callback errors", async () => {
      const onWrite = vi.fn().mockRejectedValue(new Error("subscriber failed"));
      const prismaWithHook = buildPrismaMock();
      prismaWithHook.governanceVerdict.create.mockResolvedValue(buildCreatedRow());
      const storeWithHook = new PrismaGovernanceVerdictStore(prismaWithHook as never, { onWrite });

      await expect(storeWithHook.save(baseInput)).rejects.toThrow("subscriber failed");
      expect(onWrite).toHaveBeenCalledTimes(1);
    });

    it("does not call onWrite when create fails", async () => {
      const onWrite = vi.fn();
      const prismaWithHook = buildPrismaMock();
      prismaWithHook.governanceVerdict.create.mockRejectedValue(new Error("db down"));
      const storeWithHook = new PrismaGovernanceVerdictStore(prismaWithHook as never, { onWrite });

      await expect(storeWithHook.save(baseInput)).rejects.toThrow("db down");
      expect(onWrite).not.toHaveBeenCalled();
    });
  });
});
