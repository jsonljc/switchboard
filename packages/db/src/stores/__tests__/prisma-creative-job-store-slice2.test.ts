import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaCreativeJobStore } from "../prisma-creative-job-store.js";
import { StaleVersionError } from "@switchboard/core";

function createMockPrisma() {
  return {
    creativeJob: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findFirstOrThrow: vi.fn(),
    },
    // listTasteCandidates Leg-2 pushes the re-decided watermark into raw SQL.
    $queryRaw: vi.fn(),
  };
}

// Slice-2 store surface: attribution writes/reads (PR-A) + taste-sweep
// watermark queries (PR-B). Split from prisma-creative-job-store.test.ts
// to respect the 600-line cap.
describe("PrismaCreativeJobStore (slice-2 attribution + taste)", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaCreativeJobStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaCreativeJobStore(prisma as never);
  });

  describe("setPastPerformance", () => {
    it("writes org-scoped via updateMany and resolves void", async () => {
      prisma.creativeJob.updateMany.mockResolvedValue({ count: 1 });

      await expect(
        store.setPastPerformance("org_1", "cj_1", { kind: "measured_performance" }),
      ).resolves.toBeUndefined();

      expect(prisma.creativeJob.updateMany).toHaveBeenCalledWith({
        where: { id: "cj_1", organizationId: "org_1" },
        data: { pastPerformance: { kind: "measured_performance" } },
      });
      // The daily sweep never needs the row back; no read-back query.
      expect(prisma.creativeJob.findFirstOrThrow).not.toHaveBeenCalled();
    });

    it("throws StaleVersionError when count=0 (cross-org / missing)", async () => {
      prisma.creativeJob.updateMany.mockResolvedValue({ count: 0 });
      await expect(store.setPastPerformance("org_other", "cj_1", {})).rejects.toThrow(
        StaleVersionError,
      );
    });
  });

  describe("listPublished", () => {
    it("filters to non-null metaCampaignId for the org, oldest first", async () => {
      prisma.creativeJob.findMany.mockResolvedValue([]);

      await store.listPublished("org_1");

      expect(prisma.creativeJob.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org_1", metaCampaignId: { not: null } },
        orderBy: { createdAt: "asc" },
      });
    });
  });

  describe("setTasteCapturedAt", () => {
    it("writes the OBSERVED decidedAt org-scoped, resolves void", async () => {
      prisma.creativeJob.updateMany.mockResolvedValue({ count: 1 });
      const observed = new Date("2026-06-03T10:00:00Z");

      await expect(store.setTasteCapturedAt("org_1", "cj_1", observed)).resolves.toBeUndefined();

      expect(prisma.creativeJob.updateMany).toHaveBeenCalledWith({
        where: { id: "cj_1", organizationId: "org_1" },
        data: { tasteCapturedAt: observed },
      });
    });

    it("throws StaleVersionError when count=0 (cross-org / missing)", async () => {
      prisma.creativeJob.updateMany.mockResolvedValue({ count: 0 });
      await expect(store.setTasteCapturedAt("org_x", "cj_1", new Date())).rejects.toThrow(
        StaleVersionError,
      );
    });
  });

  describe("listTasteCandidates", () => {
    const SELECT = {
      id: true,
      organizationId: true,
      deploymentId: true,
      mode: true,
      stageOutputs: true,
      ugcPhaseOutputs: true,
      reviewDecision: true,
      reviewDecidedAt: true,
      tasteCapturedAt: true,
    };

    function decided(over: Record<string, unknown>) {
      return {
        id: "a",
        organizationId: "o",
        deploymentId: "d",
        mode: "polished",
        stageOutputs: {},
        reviewDecision: "kept",
        reviewDecidedAt: new Date("2026-06-03T10:00:00Z"),
        tasteCapturedAt: null,
        ...over,
      };
    }

    it("leg 1 bounds NEVER-CAPTURED rows in SQL so old captured rows cannot starve new gestures", async () => {
      prisma.creativeJob.findMany.mockResolvedValueOnce([decided({ id: "uncaptured" })]); // leg 1
      prisma.$queryRaw.mockResolvedValueOnce([]); // leg 2: re-decided (raw SQL)

      const out = await store.listTasteCandidates(500);

      expect(prisma.creativeJob.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.creativeJob.findMany).toHaveBeenNthCalledWith(1, {
        where: { reviewDecision: { not: null }, tasteCapturedAt: null },
        select: SELECT,
        orderBy: { reviewDecidedAt: "asc" },
        take: 500,
      });
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(out.map((j) => j.id)).toEqual(["uncaptured"]);
    });

    it("leg 2 filters re-decided rows in SQL (no take-before-JS-filter) so an old re-decision is not starved", async () => {
      prisma.creativeJob.findMany.mockResolvedValueOnce([]); // leg 1
      // The raw SQL already applies WHERE reviewDecidedAt > tasteCapturedAt + ORDER
      // + LIMIT, so the store receives only re-decided rows — there is no second
      // findMany scan and no JS watermark filter that could starve old re-decisions.
      prisma.$queryRaw.mockResolvedValueOnce([
        decided({ id: "redecided", tasteCapturedAt: new Date("2026-06-01T00:00:00Z") }),
      ]);

      const out = await store.listTasteCandidates(500);

      expect(prisma.creativeJob.findMany).toHaveBeenCalledTimes(1); // leg 1 only
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(out.map((j) => j.id)).toEqual(["redecided"]);
    });

    it("merges both legs oldest-decision-first and respects the overall cap", async () => {
      prisma.creativeJob.findMany.mockResolvedValueOnce([
        decided({ id: "new-gesture", reviewDecidedAt: new Date("2026-06-04T09:00:00Z") }),
      ]); // leg 1
      prisma.$queryRaw.mockResolvedValueOnce([
        decided({
          id: "old-redecision",
          reviewDecidedAt: new Date("2026-06-02T09:00:00Z"),
          tasteCapturedAt: new Date("2026-06-01T00:00:00Z"),
        }),
      ]); // leg 2

      const out = await store.listTasteCandidates(1);

      // Oldest decision processes first; the cap bounds the merged set.
      expect(out.map((j) => j.id)).toEqual(["old-redecision"]);
    });

    it("drops rows with a null reviewDecidedAt defensively", async () => {
      prisma.creativeJob.findMany.mockResolvedValueOnce([decided({ reviewDecidedAt: null })]); // leg 1
      prisma.$queryRaw.mockResolvedValueOnce([]); // leg 2
      const out = await store.listTasteCandidates(500);
      expect(out).toEqual([]);
    });
  });

  // ── F4 revenue-proven promotion (same attribution/watermark store surface) ──

  describe("setRevenueProvenPromotedAt", () => {
    it("writes the watermark org-scoped via updateMany, resolves void", async () => {
      prisma.creativeJob.updateMany.mockResolvedValue({ count: 1 });
      const at = new Date("2026-06-11T07:00:00Z");

      await expect(store.setRevenueProvenPromotedAt("org_1", "cj_1", at)).resolves.toBeUndefined();

      expect(prisma.creativeJob.updateMany).toHaveBeenCalledWith({
        where: { id: "cj_1", organizationId: "org_1" },
        data: { revenueProvenPromotedAt: at },
      });
    });

    it("throws StaleVersionError when count=0 (cross-org / missing)", async () => {
      prisma.creativeJob.updateMany.mockResolvedValue({ count: 0 });
      await expect(store.setRevenueProvenPromotedAt("org_x", "cj_1", new Date())).rejects.toThrow(
        StaleVersionError,
      );
    });
  });

  describe("listRevenueProvenCandidates", () => {
    it("filters published-and-not-yet-promoted FOR THE ORG (per-org cap, P2-11), oldest first", async () => {
      prisma.creativeJob.findMany.mockResolvedValue([]);

      await store.listRevenueProvenCandidates("org_x", 500);

      expect(prisma.creativeJob.findMany).toHaveBeenCalledWith({
        // organizationId in the WHERE makes the fetch cap PER-ORG, so one
        // high-volume org's never-qualifying backlog cannot starve the fleet.
        where: {
          organizationId: "org_x",
          metaCampaignId: { not: null },
          revenueProvenPromotedAt: null,
        },
        select: {
          id: true,
          organizationId: true,
          deploymentId: true,
          mode: true,
          stageOutputs: true,
          ugcPhaseOutputs: true,
          pastPerformance: true,
          metaCampaignId: true,
          metaVideoId: true,
        },
        orderBy: { createdAt: "asc" },
        take: 500,
      });
    });
  });

  describe("listRevenueProvenCandidateOrgIds", () => {
    it("returns the DISTINCT orgs with pending candidates, capped, for per-org fair dispatch", async () => {
      prisma.creativeJob.findMany.mockResolvedValue([
        { organizationId: "org_a" },
        { organizationId: "org_b" },
      ]);

      const orgIds = await store.listRevenueProvenCandidateOrgIds(1000);

      expect(orgIds).toEqual(["org_a", "org_b"]);
      expect(prisma.creativeJob.findMany).toHaveBeenCalledWith({
        where: { metaCampaignId: { not: null }, revenueProvenPromotedAt: null },
        select: { organizationId: true },
        distinct: ["organizationId"],
        orderBy: { organizationId: "asc" },
        take: 1000,
      });
    });
  });
});
