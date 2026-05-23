import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaOwnerMemoryStore } from "../prisma-owner-memory-store.js";
import { StaleVersionError } from "@switchboard/core";

function createMockPrisma() {
  return {
    deploymentMemory: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    knowledgeChunk: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    activityLog: {
      findMany: vi.fn(),
    },
    interactionSummary: {
      findMany: vi.fn(),
    },
  };
}

describe("PrismaOwnerMemoryStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaOwnerMemoryStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaOwnerMemoryStore(prisma as never);
  });

  // ---------------------------------------------------------------------------
  // correctMemory
  // ---------------------------------------------------------------------------

  it("correctMemory updates content with tenant-scoped WHERE", async () => {
    (prisma.deploymentMemory.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 1,
    });

    await store.correctMemory("org-1", "mem-1", "Updated content");

    expect(prisma.deploymentMemory.updateMany).toHaveBeenCalledWith({
      where: { id: "mem-1", organizationId: "org-1" },
      data: { content: "Updated content" },
    });
  });

  it("correctMemory throws StaleVersionError when count === 0", async () => {
    (prisma.deploymentMemory.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 0,
    });

    await expect(store.correctMemory("org-1", "mem-1", "Updated content")).rejects.toBeInstanceOf(
      StaleVersionError,
    );
  });

  // ---------------------------------------------------------------------------
  // deleteMemory
  // ---------------------------------------------------------------------------

  it("deleteMemory deletes with tenant-scoped WHERE", async () => {
    (prisma.deploymentMemory.deleteMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 1,
    });

    await store.deleteMemory("org-1", "mem-1");

    expect(prisma.deploymentMemory.deleteMany).toHaveBeenCalledWith({
      where: { id: "mem-1", organizationId: "org-1" },
    });
  });

  it("deleteMemory throws StaleVersionError when count === 0", async () => {
    (prisma.deploymentMemory.deleteMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 0,
    });

    await expect(store.deleteMemory("org-1", "mem-1")).rejects.toBeInstanceOf(StaleVersionError);
  });

  // ---------------------------------------------------------------------------
  // approveDraftFAQ
  // ---------------------------------------------------------------------------

  it("approveDraftFAQ updates KnowledgeChunk with tenant-scoped WHERE", async () => {
    (prisma.knowledgeChunk.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });

    await store.approveDraftFAQ("org-1", "faq-1");

    expect(prisma.knowledgeChunk.updateMany).toHaveBeenCalledWith({
      where: { id: "faq-1", organizationId: "org-1" },
      data: { draftStatus: "approved" },
    });
  });

  it("approveDraftFAQ throws StaleVersionError when count === 0", async () => {
    (prisma.knowledgeChunk.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });

    await expect(store.approveDraftFAQ("org-1", "faq-1")).rejects.toBeInstanceOf(StaleVersionError);
  });

  // ---------------------------------------------------------------------------
  // rejectDraftFAQ
  // ---------------------------------------------------------------------------

  it("rejectDraftFAQ deletes KnowledgeChunk with tenant-scoped WHERE", async () => {
    (prisma.knowledgeChunk.deleteMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });

    await store.rejectDraftFAQ("org-1", "faq-1");

    expect(prisma.knowledgeChunk.deleteMany).toHaveBeenCalledWith({
      where: { id: "faq-1", organizationId: "org-1" },
    });
  });

  it("rejectDraftFAQ throws StaleVersionError when count === 0", async () => {
    (prisma.knowledgeChunk.deleteMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });

    await expect(store.rejectDraftFAQ("org-1", "faq-1")).rejects.toBeInstanceOf(StaleVersionError);
  });
});
