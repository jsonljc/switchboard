import { describe, it, expect, vi } from "vitest";
import { createPrismaApprovedComplianceClaimStore } from "../prisma-approved-compliance-claim-store.js";

function makePrismaMock(rows: unknown[]) {
  return {
    approvedComplianceClaim: {
      findMany: vi.fn().mockResolvedValue(rows),
    },
  } as const;
}

describe("PrismaApprovedComplianceClaimStore.list", () => {
  it("returns rows scoped to deployment + jurisdiction + claimType", async () => {
    const prisma = makePrismaMock([
      {
        id: "clm_1",
        deploymentId: "dep_1",
        jurisdiction: "SG",
        claimType: "efficacy",
        claimText: "visible slimming",
        reviewedBy: "Dr Lim",
        reviewedAt: new Date("2026-05-01T00:00:00.000Z"),
        validUntil: null,
        notes: null,
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
      },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = createPrismaApprovedComplianceClaimStore(prisma as any);
    const rows = await store.list({
      deploymentId: "dep_1",
      jurisdiction: "SG",
      claimType: "efficacy",
    });

    expect(rows).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(rows[0]!.claimText).toBe("visible slimming");
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(rows[0]!.reviewedAt).toBe("2026-05-01T00:00:00.000Z");
    expect(prisma.approvedComplianceClaim.findMany).toHaveBeenCalledWith({
      where: {
        deploymentId: "dep_1",
        jurisdiction: "SG",
        claimType: "efficacy",
      },
      orderBy: [{ reviewedAt: "desc" }],
    });
  });

  it("converts validUntil Date to ISO string when present", async () => {
    const prisma = makePrismaMock([
      {
        id: "clm_2",
        deploymentId: "dep_1",
        jurisdiction: "MY",
        claimType: "safety-claim",
        claimText: "minimal downtime",
        reviewedBy: "Dr Ahmad",
        reviewedAt: new Date("2026-04-01T00:00:00.000Z"),
        validUntil: new Date("2026-12-31T23:59:59.000Z"),
        notes: "expires end of year",
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
        updatedAt: new Date("2026-04-15T00:00:00.000Z"),
      },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = createPrismaApprovedComplianceClaimStore(prisma as any);
    const rows = await store.list({
      deploymentId: "dep_1",
      jurisdiction: "MY",
      claimType: "safety-claim",
    });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(rows[0]!.validUntil).toBe("2026-12-31T23:59:59.000Z");
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(rows[0]!.notes).toBe("expires end of year");
  });

  it("returns empty array when no rows match", async () => {
    const prisma = makePrismaMock([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = createPrismaApprovedComplianceClaimStore(prisma as any);
    const rows = await store.list({
      deploymentId: "dep_xyz",
      jurisdiction: "SG",
      claimType: "urgency",
    });
    expect(rows).toEqual([]);
  });
});
