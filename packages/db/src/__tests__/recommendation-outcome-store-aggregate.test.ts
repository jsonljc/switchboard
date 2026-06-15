import { describe, expect, it, vi } from "vitest";
import { PrismaRecommendationOutcomeStore } from "../recommendation-outcome-store.js";
import type { PrismaClient } from "@prisma/client";

// D7-1: the read side of the outcome readback. Mocked Prisma (CI has no Postgres). The aggregate's
// WHERE filters to causalStrength:"corroborated", so the mock returns only corroborated rows (as the
// DB would); the selected columns are actionKind + trustDelta.
function mockPrisma() {
  return { recommendationOutcome: { findMany: vi.fn() } } as unknown as PrismaClient;
}

function corrRow(actionKind: string | null, trustDelta: string) {
  return { actionKind, trustDelta };
}

describe("PrismaRecommendationOutcomeStore.aggregateOutcomeSignalByKind (D7-1)", () => {
  it("counts corroborated rows by action kind into corroboratedUp / corroboratedDown", async () => {
    const prisma = mockPrisma();
    (prisma.recommendationOutcome.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      corrRow("pause", "up"),
      corrRow("pause", "up"),
      corrRow("pause", "down"),
      corrRow("pause", "none"), // corroborated but no trust direction -> contributes nothing
      corrRow("refresh_creative", "up"),
    ]);
    const store = new PrismaRecommendationOutcomeStore(prisma);
    const agg = await store.aggregateOutcomeSignalByKind("org-1");
    expect(agg.get("pause")).toEqual({ corroboratedUp: 2, corroboratedDown: 1 });
    expect(agg.get("refresh_creative")).toEqual({ corroboratedUp: 1, corroboratedDown: 0 });
  });

  it("queries org-scoped Riley CORROBORATED rows only", async () => {
    const prisma = mockPrisma();
    (prisma.recommendationOutcome.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const store = new PrismaRecommendationOutcomeStore(prisma);
    const agg = await store.aggregateOutcomeSignalByKind("org-9");
    expect(agg.size).toBe(0);
    const where = (prisma.recommendationOutcome.findMany as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0].where;
    expect(where.organizationId).toBe("org-9");
    expect(where.agentRole).toBe("riley");
    expect(where.causalStrength).toBe("corroborated");
  });

  it("skips rows with no action kind (never fabricates a bucket)", async () => {
    const prisma = mockPrisma();
    (prisma.recommendationOutcome.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      corrRow(null, "up"),
      corrRow("pause", "up"),
    ]);
    const store = new PrismaRecommendationOutcomeStore(prisma);
    const agg = await store.aggregateOutcomeSignalByKind("org-1");
    expect(agg.size).toBe(1);
    expect(agg.get("pause")).toEqual({ corroboratedUp: 1, corroboratedDown: 0 });
  });
});
