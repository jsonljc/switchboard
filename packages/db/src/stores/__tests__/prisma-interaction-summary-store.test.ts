import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaInteractionSummaryStore } from "../prisma-interaction-summary-store.js";

function createMockPrisma() {
  return {
    interactionSummary: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  };
}

describe("PrismaInteractionSummaryStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaInteractionSummaryStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaInteractionSummaryStore(prisma as never);
  });

  it("creates an interaction summary", async () => {
    const input = {
      organizationId: "org-1",
      deploymentId: "dep-1",
      channelType: "telegram",
      summary: "Customer asked about pricing.",
      outcome: "info_request",
      extractedFacts: [],
      questionsAsked: ["What is the price?"],
      duration: 120,
      messageCount: 6,
    };
    (prisma.interactionSummary.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sum-1",
      ...input,
      contactId: null,
      createdAt: new Date(),
    });

    const result = await store.create(input);
    expect(result.id).toBe("sum-1");
    expect(prisma.interactionSummary.create).toHaveBeenCalledOnce();
  });

  it("lists summaries by deployment", async () => {
    (prisma.interactionSummary.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const result = await store.listByDeployment("org-1", "dep-1", { limit: 10 });
    expect(result).toEqual([]);
  });

  it("filters by contactId when provided", async () => {
    (prisma.interactionSummary.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await store.listByDeployment("org-1", "dep-1", { contactId: "contact-1" });
    expect(prisma.interactionSummary.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ contactId: "contact-1" }),
      }),
    );
  });

  it("counts summaries by deployment", async () => {
    (prisma.interactionSummary.count as ReturnType<typeof vi.fn>).mockResolvedValue(5);
    const result = await store.countByDeployment("org-1", "dep-1");
    expect(result).toBe(5);
    expect(prisma.interactionSummary.count).toHaveBeenCalledWith({
      where: { organizationId: "org-1", deploymentId: "dep-1" },
    });
  });

  it("sets contactId to null when not provided", async () => {
    const input = {
      organizationId: "org-1",
      deploymentId: "dep-1",
      channelType: "slack",
      summary: "Test summary",
      outcome: "resolved",
      extractedFacts: [],
      questionsAsked: [],
      duration: 60,
      messageCount: 3,
    };
    (prisma.interactionSummary.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sum-2",
      ...input,
      contactId: null,
      createdAt: new Date(),
    });

    await store.create(input);
    expect(prisma.interactionSummary.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ contactId: null }),
      }),
    );
  });
});
