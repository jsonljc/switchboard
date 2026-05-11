import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaGovernanceVerdictStore } from "../prisma-governance-verdict-store.js";

const buildPrismaMock = () => ({
  governanceVerdict: {
    create: vi.fn(),
    findMany: vi.fn(),
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
});
