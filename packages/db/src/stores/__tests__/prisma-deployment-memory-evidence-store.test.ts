import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaDeploymentMemoryEvidenceStore } from "../prisma-deployment-memory-evidence-store.js";

function createMockPrisma() {
  return {
    deploymentMemoryEvidence: {
      upsert: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

describe("PrismaDeploymentMemoryEvidenceStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaDeploymentMemoryEvidenceStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaDeploymentMemoryEvidenceStore(prisma as never);
  });

  it("recordEvidence upserts on the (deploymentMemoryId, bookingId) unique key", async () => {
    await store.recordEvidence({
      deploymentMemoryId: "mem-1",
      organizationId: "org-1",
      bookingId: "bk-1",
      conversionRecordId: null,
      workTraceId: "wt-A",
      attributionTier: "strong",
    });
    expect(prisma.deploymentMemoryEvidence.upsert).toHaveBeenCalledWith({
      where: { deploymentMemoryId_bookingId: { deploymentMemoryId: "mem-1", bookingId: "bk-1" } },
      create: expect.objectContaining({
        deploymentMemoryId: "mem-1",
        bookingId: "bk-1",
        attributionTier: "strong",
        workTraceId: "wt-A",
      }),
      update: {},
    });
  });

  it("countDistinctBookingIds returns count of evidence rows with non-null bookingId", async () => {
    (prisma.deploymentMemoryEvidence.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { bookingId: "bk-1" },
      { bookingId: "bk-2" },
    ]);
    const n = await store.countDistinctBookingIds("mem-1");
    expect(n).toBe(2);
    expect(prisma.deploymentMemoryEvidence.findMany).toHaveBeenCalledWith({
      where: { deploymentMemoryId: "mem-1", bookingId: { not: null } },
      select: { bookingId: true },
      distinct: ["bookingId"],
    });
  });

  it("skips the upsert when bookingId is null (no anchor → not a unique row)", async () => {
    await store.recordEvidence({
      deploymentMemoryId: "mem-1",
      organizationId: "org-1",
      bookingId: null,
      conversionRecordId: null,
      workTraceId: null,
      attributionTier: "fallback",
    });
    expect(prisma.deploymentMemoryEvidence.upsert).not.toHaveBeenCalled();
  });
});
