// packages/db/src/stores/__tests__/prisma-scoped-stores.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaCustomerMemoryStore } from "../prisma-customer-memory-store.js";
import { PrismaOwnerMemoryStore } from "../prisma-owner-memory-store.js";
import { PrismaAggregateMemoryStore } from "../prisma-aggregate-memory-store.js";

function createMockPrisma() {
  return {
    deploymentMemory: {
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    interactionSummary: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    knowledgeChunk: {
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      updateMany: vi.fn(),
    },
    activityLog: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  };
}

describe("PrismaCustomerMemoryStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaCustomerMemoryStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaCustomerMemoryStore(prisma as never);
  });

  it("getHighConfidenceFacts filters by threshold and strips metadata", async () => {
    prisma.deploymentMemory.findMany.mockResolvedValue([
      {
        id: "1",
        organizationId: "o",
        deploymentId: "d",
        category: "hours",
        content: "Open 9-5",
        confidence: 0.8,
        sourceCount: 4,
      },
    ]);

    const facts = await store.getHighConfidenceFacts("o", "d");

    expect(prisma.deploymentMemory.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: "o",
        deploymentId: "d",
        confidence: { gte: 0.7 },
        sourceCount: { gte: 3 },
      },
      orderBy: { confidence: "desc" },
    });
    // Should strip sourceCount and confidence — customer sees fact only
    expect(facts[0]).toEqual({
      id: "1",
      category: "hours",
      content: "Open 9-5",
    });
    expect((facts[0] as unknown as Record<string, unknown>).confidence).toBeUndefined();
    expect((facts[0] as unknown as Record<string, unknown>).sourceCount).toBeUndefined();
  });

  it("getContactSummaries scopes to specific contact", async () => {
    prisma.interactionSummary.findMany.mockResolvedValue([]);

    await store.getContactSummaries("o", "d", "contact-1");

    expect(prisma.interactionSummary.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "o", deploymentId: "d", contactId: "contact-1" },
      }),
    );
  });

  it("getBusinessKnowledge includes global and deployment-scoped chunks", async () => {
    prisma.knowledgeChunk.findMany.mockResolvedValue([]);

    await store.getBusinessKnowledge("o", "d", "query");

    expect(prisma.knowledgeChunk.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "o",
          OR: [{ deploymentId: "d" }, { deploymentId: null }],
        }),
      }),
    );
  });
});

describe("PrismaOwnerMemoryStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaOwnerMemoryStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaOwnerMemoryStore(prisma as never);
  });

  it("listAllMemories returns all deployment memories", async () => {
    prisma.deploymentMemory.findMany.mockResolvedValue([]);
    await store.listAllMemories("o", "d");
    expect(prisma.deploymentMemory.findMany).toHaveBeenCalledWith({
      where: { organizationId: "o", deploymentId: "d" },
      orderBy: { confidence: "desc" },
    });
  });

  it("correctMemory updates content", async () => {
    prisma.deploymentMemory.update.mockResolvedValue({});
    await store.correctMemory("mem-1", "Updated content");
    expect(prisma.deploymentMemory.update).toHaveBeenCalledWith({
      where: { id: "mem-1" },
      data: { content: "Updated content" },
    });
  });

  it("approveDraftFAQ sets draftStatus to approved", async () => {
    prisma.knowledgeChunk.update.mockResolvedValue({});
    await store.approveDraftFAQ("faq-1");
    expect(prisma.knowledgeChunk.update).toHaveBeenCalledWith({
      where: { id: "faq-1" },
      data: { draftStatus: "approved" },
    });
  });

  it("rejectDraftFAQ deletes the draft", async () => {
    prisma.knowledgeChunk.delete.mockResolvedValue({});
    await store.rejectDraftFAQ("faq-1");
    expect(prisma.knowledgeChunk.delete).toHaveBeenCalledWith({
      where: { id: "faq-1" },
    });
  });

  it("listDraftFAQs returns pending drafts", async () => {
    prisma.knowledgeChunk.findMany.mockResolvedValue([]);
    await store.listDraftFAQs("o", "d");
    expect(prisma.knowledgeChunk.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ draftStatus: "pending" }),
      }),
    );
  });
});

describe("PrismaAggregateMemoryStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaAggregateMemoryStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaAggregateMemoryStore(prisma as never);
  });

  it("writeActivityLog creates an entry", async () => {
    prisma.activityLog.create.mockResolvedValue({});
    await store.writeActivityLog({
      organizationId: "o",
      deploymentId: "d",
      eventType: "fact_learned",
      description: "Learned something",
      metadata: {},
    });
    expect(prisma.activityLog.create).toHaveBeenCalled();
  });

  it("promoteDraftFAQs updates expired pending drafts", async () => {
    const cutoff = new Date();
    prisma.knowledgeChunk.updateMany.mockResolvedValue({ count: 2 });
    const count = await store.promoteDraftFAQs(cutoff);
    expect(count).toBe(2);
    expect(prisma.knowledgeChunk.updateMany).toHaveBeenCalledWith({
      where: {
        draftStatus: "pending",
        draftExpiresAt: { lt: cutoff },
      },
      data: { draftStatus: "approved" },
    });
  });

  it("decayStale decrements confidence", async () => {
    const cutoff = new Date();
    prisma.deploymentMemory.updateMany.mockResolvedValue({ count: 3 });
    const count = await store.decayStale(cutoff, 0.1);
    expect(count).toBe(3);
  });
});
