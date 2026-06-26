import { describe, it, expect } from "vitest";
import { miraBuilder } from "@switchboard/core/skill-runtime";
import { SURFACING_THRESHOLD } from "@switchboard/schemas";
import type { CampaignInsightSchema, CreativeJob } from "@switchboard/schemas";
import { computePastPerformance } from "./creative-attribution.js";
import {
  executeRevenueProvenPromotion,
  type RevenueProvenPromotionDeps,
} from "./revenue-proven-promotion.js";

const WINDOW = { from: new Date("2026-05-01T00:00:00Z"), to: new Date("2026-06-01T00:00:00Z") };
const NOW = new Date("2026-06-01T00:00:00Z");

function measured(spend: number, valueCents: number, count: number) {
  const insight: CampaignInsightSchema = {
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
  return computePastPerformance({
    job: { metaCampaignId: "c1", metaAdId: "a1", metaVideoId: "v1" } as unknown as CreativeJob,
    insight,
    booked: { valueCents, count },
    window: WINDOW,
    now: NOW,
  })!;
}

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

// Implements BOTH the promotion writer interface AND the reader (listHighConfidence)
// the Mira brain builder uses — the single substrate that closes the loop.
class SharedMemoryStore {
  rows: Row[] = [];
  seq = 0;

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
    return { id };
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
  async findEvictionCandidate() {
    return null;
  }
  async delete() {}

  // Reader side (mira builder): the surfacing threshold filter.
  async listHighConfidence(o: string, d: string, minConf: number, minSrc: number) {
    return this.rows
      .filter(
        (r) =>
          r.organizationId === o &&
          r.deploymentId === d &&
          r.confidence >= minConf &&
          r.sourceCount >= minSrc,
      )
      .sort((a, b) => b.confidence - a.confidence)
      .map((r) => ({
        id: r.id,
        category: r.category,
        canonicalKey: r.canonicalKey,
        sourceCount: r.sourceCount,
        confidence: r.confidence,
      }));
  }
}

const POLISHED_QUESTION_OUTPUTS = {
  hooks: {
    hooks: [{ angleRef: "a", text: "t", type: "question", platformScore: 1, rationale: "r" }],
    topCombos: [],
  },
};

describe("Riley revenue_proven write surfaces in Mira's brief (F4 loop closed)", () => {
  it("3 attributed winners in one bucket cross the 0.66/3 threshold and render in TASTE_CONTEXT", async () => {
    const ORG = "org1";
    const MIRA_DEP = "dep-mira-creative";
    const mem = new SharedMemoryStore();

    const makeJob = (id: string) => ({
      id,
      organizationId: ORG,
      deploymentId: MIRA_DEP,
      mode: "polished",
      stageOutputs: POLISHED_QUESTION_OUTPUTS,
      ugcPhaseOutputs: null,
      metaCampaignId: "c1",
      metaVideoId: "v1",
      pastPerformance: measured(100, 30000, 3),
    });

    // PRODUCER: promote three distinct qualifying creatives (same polished/question bucket).
    const deps: RevenueProvenPromotionDeps = {
      failure: {} as RevenueProvenPromotionDeps["failure"],
      jobStore: {
        listRevenueProvenCandidateOrgIds: async (_maxOrgs: number) => [ORG],
        listRevenueProvenCandidates: async (organizationId: string, _limit: number) =>
          organizationId === ORG ? [makeJob("j1"), makeJob("j2"), makeJob("j3")] : [],
        setRevenueProvenPromotedAt: async () => {},
      },
      memoryStore: mem,
      now: () => NOW,
      logger: { info() {}, warn() {}, error() {} },
    };
    await executeRevenueProvenPromotion(deps);

    const bucket = mem.rows.find((r) => r.category === "revenue_proven")!;
    expect(bucket.sourceCount).toBe(3);
    expect(bucket.confidence).toBeGreaterThanOrEqual(SURFACING_THRESHOLD.minConfidence); // ~0.665 >= 0.66

    // CONSUMER: the real Mira brain builder, reading the SAME deployment.
    const result = await miraBuilder(
      {
        orgId: ORG,
        deploymentId: MIRA_DEP,
        request: { composeSource: "weekly_scan" },
        now: () => NOW,
      },
      {
        deploymentMemoryReader: {
          listHighConfidence: (o: string, d: string, c: number, s: number) =>
            mem.listHighConfidence(o, d, c, s),
        },
        miraReadModelReader: {
          read: async () => ({
            jobs: [],
            counts: {
              total: 0,
              shippedThisWeek: 0,
              shippedPrevWeek: 0,
              inFlight: 0,
              awaitingReview: 0,
              stopped: 0,
            },
          }),
        },
        businessFactsStore: { get: async () => null },
      } as unknown as Parameters<typeof miraBuilder>[1],
    );

    // The string builders/mira.ts renders from the canonicalKey via its OWN
    // HOOK_PHRASE/describeSegment (question -> "question hooks"), not the stored content.
    expect(result.parameters.TASTE_CONTEXT).toContain(
      "Measured winner in polished mode: question hooks (3 sources)",
    );
    expect(result.injectedPatternIds).toContain("revenue_proven:polished_question");
  });
});
