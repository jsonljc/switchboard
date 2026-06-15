import { describe, expect, it, vi } from "vitest";
import { PrismaRecommendationStore } from "../recommendation-store.js";
import type { PrismaClient } from "@prisma/client";

// D7-2: the read side of Riley's first learning wire. Mirrors the mocked-Prisma style
// of recommendation-store.test.ts (CI has no Postgres). Split into its own file to keep
// the sibling test file under the line cap.
function mockPrisma() {
  return {
    pendingActionRecord: { findMany: vi.fn() },
  } as unknown as PrismaClient;
}

function verdictRow(action: string | null, status: string, org = "org-1") {
  return {
    organizationId: org,
    status,
    intent: `recommendation.${action ?? "untyped"}`,
    parameters: action === null ? {} : { __recommendation: { action } },
  };
}

describe("PrismaRecommendationStore.aggregateApprovalRateByKind (D7-2)", () => {
  it("groups resolved verdicts by action kind (acted -> approved, dismissed -> rejected)", async () => {
    const prisma = mockPrisma();
    (prisma.pendingActionRecord.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      verdictRow("pause", "acted"),
      verdictRow("pause", "dismissed"),
      verdictRow("refresh_creative", "acted"),
    ]);
    const store = new PrismaRecommendationStore(prisma);
    const agg = await store.aggregateApprovalRateByKind("org-1");
    expect(agg.get("pause")).toEqual({ approved: 1, rejected: 1 });
    expect(agg.get("refresh_creative")).toEqual({ approved: 1, rejected: 0 });
  });

  it("queries org-scoped, resolved, recommendation-intent rows in [acted,dismissed] only", async () => {
    const prisma = mockPrisma();
    (prisma.pendingActionRecord.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const store = new PrismaRecommendationStore(prisma);
    const agg = await store.aggregateApprovalRateByKind("org-7");
    expect(agg.size).toBe(0);
    const where = (prisma.pendingActionRecord.findMany as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0].where;
    expect(where.organizationId).toBe("org-7");
    expect(where.resolvedAt).toEqual({ not: null });
    expect(where.status).toEqual({ in: ["acted", "dismissed"] });
    expect(where.intent).toMatchObject({ startsWith: "recommendation." });
  });

  it("skips rows missing an action kind — never fabricates a bucket", async () => {
    const prisma = mockPrisma();
    (prisma.pendingActionRecord.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      verdictRow(null, "acted"),
      verdictRow("pause", "acted"),
    ]);
    const store = new PrismaRecommendationStore(prisma);
    const agg = await store.aggregateApprovalRateByKind("org-1");
    expect(agg.size).toBe(1);
    expect(agg.get("pause")).toEqual({ approved: 1, rejected: 0 });
  });
});
