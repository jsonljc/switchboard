import { describe, it, expect } from "vitest";
import type { CampaignInsightSchema, CreativeJob } from "@switchboard/schemas";
import { MAX_DEPLOYMENT_MEMORY_ENTRIES } from "@switchboard/schemas";
import { StaleVersionError } from "@switchboard/core";
import type { RevenueProvenCandidate } from "@switchboard/db";
import { computePastPerformance } from "./creative-attribution.js";
import {
  passesRevenueProvenFloors,
  revenueProvenCanonicalKey,
  revenueProvenBucketContent,
  executeRevenueProvenPromotion,
  type RevenueProvenPromotionDeps,
} from "./revenue-proven-promotion.js";

const WINDOW = { from: new Date("2026-05-01T00:00:00Z"), to: new Date("2026-06-01T00:00:00Z") };
const NOW = new Date("2026-06-01T00:00:00Z");

// A complete CampaignInsight (15 required fields); the noise fields are fixed.
function fullInsight(spend: number): CampaignInsightSchema {
  return {
    campaignId: "c1",
    campaignName: "C1",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    impressions: 1000,
    inlineLinkClicks: 50,
    spend,
    conversions: 5,
    revenue: 0,
    frequency: 1.2,
    cpm: 10,
    inlineLinkClickCtr: 0.05,
    costPerInlineLinkClick: 2,
    dateStart: "2026-05-01",
    dateStop: "2026-06-01",
  };
}

// Build measured pastPerformance from the REAL producer (computePastPerformance),
// honoring "test from the real producer's output" (feedback_safety_gate_needs_producer_population).
export function measured(opts: { spend: number; valueCents: number; count: number }) {
  const job = { metaCampaignId: "c1", metaAdId: "a1", metaVideoId: "v1" } as unknown as CreativeJob;
  return computePastPerformance({
    job,
    insight: fullInsight(opts.spend),
    booked: { valueCents: opts.valueCents, count: opts.count },
    window: WINDOW,
    now: NOW,
  })!;
}

describe("passesRevenueProvenFloors", () => {
  it("passes when measured, spend>=50, bookedCount>=2, trueRoas>=1.5", () => {
    // $100 spend, $300 booked => trueRoas 3.0
    expect(passesRevenueProvenFloors(measured({ spend: 100, valueCents: 30000, count: 3 }))).toBe(
      true,
    );
  });
  it("fails below the spend floor", () => {
    expect(passesRevenueProvenFloors(measured({ spend: 40, valueCents: 30000, count: 3 }))).toBe(
      false,
    );
  });
  it("fails below the booked-count floor", () => {
    expect(passesRevenueProvenFloors(measured({ spend: 100, valueCents: 30000, count: 1 }))).toBe(
      false,
    );
  });
  it("fails below the trueRoas floor", () => {
    // $100 spend, $120 booked => 1.2 < 1.5
    expect(passesRevenueProvenFloors(measured({ spend: 100, valueCents: 12000, count: 3 }))).toBe(
      false,
    );
  });
  it("fails when trueRoas is null (count 0 => null, never 0)", () => {
    expect(passesRevenueProvenFloors(measured({ spend: 100, valueCents: 0, count: 0 }))).toBe(
      false,
    );
  });
  it("fails a no_delivery row", () => {
    const noDelivery = computePastPerformance({
      job: { metaCampaignId: "c1", metaAdId: null, metaVideoId: null } as unknown as CreativeJob,
      insight: undefined,
      booked: { valueCents: 30000, count: 3 },
      window: WINDOW,
      now: NOW,
    })!;
    expect(passesRevenueProvenFloors(noDelivery)).toBe(false);
  });
  it("guards NaN numerics (Number.isFinite)", () => {
    const perf = measured({ spend: 100, valueCents: 30000, count: 3 });
    expect(passesRevenueProvenFloors({ ...perf, trueRoas: Number.NaN })).toBe(false);
    expect(passesRevenueProvenFloors({ ...perf, meta: { ...perf.meta, spend: Number.NaN } })).toBe(
      false,
    );
  });
});

describe("revenueProvenCanonicalKey + content", () => {
  it("builds a polished hook key matching the Mira consumer regex", () => {
    const key = revenueProvenCanonicalKey({ mode: "polished", hookType: "question" });
    expect(key).toBe("revenue_proven:polished_question");
    expect(/^revenue_proven:(polished|ugc)_([a-z0-9_]+)$/.test(key)).toBe(true);
  });
  it("uses structureId for ugc", () => {
    expect(
      revenueProvenCanonicalKey({ mode: "ugc", hookType: "none", structureId: "confession" }),
    ).toBe("revenue_proven:ugc_confession");
  });
  it("content is a pure function of the bucket (no per-job text)", () => {
    const a = revenueProvenBucketContent("polished", "question", undefined);
    const b = revenueProvenBucketContent("polished", "question", undefined);
    expect(a).toBe(b);
    expect(a).not.toMatch(/c1|v1|\$/); // no campaign/video id, no per-job dollar amount
  });
});

// ── Sweep ──

interface Row {
  id: string;
  organizationId: string;
  deploymentId: string;
  category: string;
  content: string;
  canonicalKey: string | null;
  sourceCount: number;
  confidence: number;
}

class InMemoryMemoryStore {
  rows: Row[] = [];
  seq = 0;
  throwP2002Once = false;
  throwGenericOnce = false;

  private push(input: {
    organizationId: string;
    deploymentId: string;
    category: string;
    content: string;
    confidence?: number;
    canonicalKey?: string | null;
  }): string {
    const id = `m${++this.seq}`;
    this.rows.push({
      id,
      organizationId: input.organizationId,
      deploymentId: input.deploymentId,
      category: input.category,
      content: input.content,
      canonicalKey: input.canonicalKey ?? null,
      sourceCount: 1,
      confidence: input.confidence ?? 0.5,
    });
    return id;
  }

  async findByCategoryAndCanonicalKey(o: string, d: string, c: string, k: string) {
    return this.rows
      .filter(
        (r) =>
          r.organizationId === o &&
          r.deploymentId === d &&
          r.category === c &&
          r.canonicalKey === k,
      )
      .map((r) => ({ id: r.id, sourceCount: r.sourceCount, confidence: r.confidence }));
  }

  async create(input: {
    organizationId: string;
    deploymentId: string;
    category: string;
    content: string;
    confidence?: number;
    canonicalKey?: string | null;
  }) {
    if (this.throwP2002Once) {
      // Simulate a concurrent writer that created the row first, then our unique
      // violation: the row exists for the sweep's re-find to pick up.
      this.throwP2002Once = false;
      this.push(input);
      throw Object.assign(new Error("unique"), { code: "P2002" });
    }
    if (this.throwGenericOnce) {
      this.throwGenericOnce = false;
      throw new Error("boom");
    }
    if (
      this.rows.some(
        (r) =>
          r.organizationId === input.organizationId &&
          r.deploymentId === input.deploymentId &&
          r.category === input.category &&
          r.content === input.content,
      )
    ) {
      throw Object.assign(new Error("unique"), { code: "P2002" });
    }
    return { id: this.push(input) };
  }

  async incrementConfidence(o: string, id: string, conf: number) {
    const r = this.rows.find((x) => x.id === id && x.organizationId === o)!;
    r.sourceCount += 1;
    r.confidence = conf;
    return { id: r.id, sourceCount: r.sourceCount };
  }

  async countByDeployment(o: string, d: string) {
    return this.rows.filter((r) => r.organizationId === o && r.deploymentId === d).length;
  }

  async findEvictionCandidate(o: string, d: string) {
    const c = this.rows
      .filter((r) => r.organizationId === o && r.deploymentId === d)
      .sort((a, b) => a.confidence - b.confidence)[0];
    return c ? { id: c.id, confidence: c.confidence } : null;
  }

  async delete(o: string, id: string) {
    const i = this.rows.findIndex((r) => r.id === id && r.organizationId === o);
    if (i < 0) throw new StaleVersionError(id, -1, -1);
    this.rows.splice(i, 1);
  }
}

const POLISHED_QUESTION_OUTPUTS = {
  hooks: {
    hooks: [{ angleRef: "a", text: "t", type: "question", platformScore: 1, rationale: "r" }],
    topCombos: [],
  },
};

function candidate(over: Partial<RevenueProvenCandidate> & { id: string }): RevenueProvenCandidate {
  return {
    organizationId: "org1",
    deploymentId: "depMira",
    mode: "polished",
    stageOutputs: POLISHED_QUESTION_OUTPUTS,
    ugcPhaseOutputs: null,
    metaCampaignId: "c1",
    metaVideoId: "v1",
    pastPerformance: measured({ spend: 100, valueCents: 30000, count: 3 }),
    ...over,
  };
}

function makeDeps(
  jobStore: RevenueProvenPromotionDeps["jobStore"],
  memoryStore: RevenueProvenPromotionDeps["memoryStore"],
): RevenueProvenPromotionDeps {
  return {
    failure: {} as RevenueProvenPromotionDeps["failure"],
    jobStore,
    memoryStore,
    now: () => NOW,
    logger: { info() {}, warn() {}, error() {} },
  };
}

describe("executeRevenueProvenPromotion", () => {
  it("promotes a qualifying creative onto its deployment and watermarks it", async () => {
    const mem = new InMemoryMemoryStore();
    const watermarked: string[] = [];
    const deps = makeDeps(
      {
        listRevenueProvenCandidates: async () => [candidate({ id: "j1" })],
        setRevenueProvenPromotedAt: async (_o: string, id: string) => {
          watermarked.push(id);
        },
      },
      mem,
    );
    const summary = await executeRevenueProvenPromotion(deps);
    expect(summary.promoted).toBe(1);
    expect(mem.rows).toHaveLength(1);
    expect(mem.rows[0]!.category).toBe("revenue_proven");
    expect(mem.rows[0]!.canonicalKey).toBe("revenue_proven:polished_question");
    expect(mem.rows[0]!.deploymentId).toBe("depMira");
    expect(watermarked).toEqual(["j1"]);
  });

  it("increments the same bucket for a second distinct qualifying creative", async () => {
    const mem = new InMemoryMemoryStore();
    const deps = makeDeps(
      {
        listRevenueProvenCandidates: async () => [candidate({ id: "j1" }), candidate({ id: "j2" })],
        setRevenueProvenPromotedAt: async () => {},
      },
      mem,
    );
    await executeRevenueProvenPromotion(deps);
    expect(mem.rows).toHaveLength(1);
    expect(mem.rows[0]!.sourceCount).toBe(2);
  });

  it("does NOT promote or watermark a measured-but-below-floor creative", async () => {
    const mem = new InMemoryMemoryStore();
    const watermarked: string[] = [];
    const deps = makeDeps(
      {
        listRevenueProvenCandidates: async () => [
          candidate({
            id: "j1",
            pastPerformance: measured({ spend: 40, valueCents: 30000, count: 3 }),
          }),
        ],
        setRevenueProvenPromotedAt: async (_o: string, id: string) => {
          watermarked.push(id);
        },
      },
      mem,
    );
    const summary = await executeRevenueProvenPromotion(deps);
    expect(summary.promoted).toBe(0);
    expect(summary.belowFloor).toBe(1);
    expect(mem.rows).toHaveLength(0);
    expect(watermarked).toEqual([]); // re-evaluated next run as performance grows
  });

  it("skips a not-yet-measured creative without counting it as failed", async () => {
    const mem = new InMemoryMemoryStore();
    const deps = makeDeps(
      {
        listRevenueProvenCandidates: async () => [
          candidate({ id: "j1", pastPerformance: { kind: "garbage" } }),
        ],
        setRevenueProvenPromotedAt: async () => {},
      },
      mem,
    );
    const summary = await executeRevenueProvenPromotion(deps);
    expect(summary.notMeasured).toBe(1);
    expect(summary.skippedFailures).toBe(0);
    expect(mem.rows).toHaveLength(0);
  });

  it("re-finds and increments on a P2002 race instead of throwing", async () => {
    const mem = new InMemoryMemoryStore();
    mem.throwP2002Once = true; // a concurrent writer creates the bucket between our find and create
    const deps = makeDeps(
      {
        listRevenueProvenCandidates: async () => [candidate({ id: "j1" })],
        setRevenueProvenPromotedAt: async () => {},
      },
      mem,
    );
    const summary = await executeRevenueProvenPromotion(deps);
    expect(summary.promoted).toBe(1);
    expect(mem.rows).toHaveLength(1);
    expect(mem.rows[0]!.sourceCount).toBe(2); // concurrent create (1) + our increment (1)
  });

  it("isolates a job that throws (per-job try/catch) and still promotes the rest", async () => {
    const mem = new InMemoryMemoryStore();
    mem.throwGenericOnce = true; // first create throws a non-P2002 error
    const watermarked: string[] = [];
    const deps = makeDeps(
      {
        listRevenueProvenCandidates: async () => [
          candidate({ id: "bad" }),
          candidate({
            id: "ok",
            stageOutputs: {
              hooks: {
                hooks: [
                  {
                    angleRef: "a",
                    text: "t",
                    type: "bold_statement",
                    platformScore: 1,
                    rationale: "r",
                  },
                ],
                topCombos: [],
              },
            },
          }),
        ],
        setRevenueProvenPromotedAt: async (_o: string, id: string) => {
          watermarked.push(id);
        },
      },
      mem,
    );
    const summary = await executeRevenueProvenPromotion(deps);
    expect(summary.skippedFailures).toBe(1);
    expect(summary.promoted).toBe(1);
    expect(watermarked).toEqual(["ok"]); // the failed job is not watermarked → retried next run
    expect(mem.rows.map((r) => r.canonicalKey)).toEqual(["revenue_proven:polished_bold_statement"]);
  });

  it("evicts the weakest entry to admit a new bucket at the cap", async () => {
    const mem = new InMemoryMemoryStore();
    for (let i = 0; i < MAX_DEPLOYMENT_MEMORY_ENTRIES; i++) {
      mem.rows.push({
        id: `seed${i}`,
        organizationId: "org1",
        deploymentId: "depMira",
        category: "faq",
        content: `seed-${i}`,
        canonicalKey: null,
        sourceCount: 1,
        confidence: 0.1, // weaker than the 0.5 newcomer
      });
    }
    const deps = makeDeps(
      {
        listRevenueProvenCandidates: async () => [candidate({ id: "j1" })],
        setRevenueProvenPromotedAt: async () => {},
      },
      mem,
    );
    const summary = await executeRevenueProvenPromotion(deps);
    expect(summary.evictions).toBe(1);
    expect(summary.bucketsCreated).toBe(1);
    expect(mem.rows).toHaveLength(MAX_DEPLOYMENT_MEMORY_ENTRIES);
    expect(mem.rows.some((r) => r.canonicalKey === "revenue_proven:polished_question")).toBe(true);
  });

  it("drops a new bucket (still watermarking) when the cap is full of stronger entries", async () => {
    const mem = new InMemoryMemoryStore();
    for (let i = 0; i < MAX_DEPLOYMENT_MEMORY_ENTRIES; i++) {
      mem.rows.push({
        id: `seed${i}`,
        organizationId: "org1",
        deploymentId: "depMira",
        category: "faq",
        content: `seed-${i}`,
        canonicalKey: null,
        sourceCount: 5,
        confidence: 0.9, // stronger than the 0.5 newcomer
      });
    }
    const watermarked: string[] = [];
    const deps = makeDeps(
      {
        listRevenueProvenCandidates: async () => [candidate({ id: "j1" })],
        setRevenueProvenPromotedAt: async (_o: string, id: string) => {
          watermarked.push(id);
        },
      },
      mem,
    );
    const summary = await executeRevenueProvenPromotion(deps);
    expect(summary.drops).toBe(1);
    expect(mem.rows.some((r) => r.category === "revenue_proven")).toBe(false);
    expect(watermarked).toEqual(["j1"]); // observed-but-not-stored; counted once (cap full)
  });

  it("scopes writes per org (cross-org candidate read, org-scoped writes)", async () => {
    const mem = new InMemoryMemoryStore();
    const deps = makeDeps(
      {
        listRevenueProvenCandidates: async () => [
          candidate({ id: "j1", organizationId: "orgA", deploymentId: "depA" }),
          candidate({ id: "j2", organizationId: "orgB", deploymentId: "depB" }),
        ],
        setRevenueProvenPromotedAt: async () => {},
      },
      mem,
    );
    await executeRevenueProvenPromotion(deps);
    expect(mem.rows).toHaveLength(2);
    expect(mem.rows.find((r) => r.organizationId === "orgA")!.deploymentId).toBe("depA");
    expect(mem.rows.find((r) => r.organizationId === "orgB")!.deploymentId).toBe("depB");
  });
});
