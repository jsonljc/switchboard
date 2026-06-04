import { describe, it, expect } from "vitest";
import { buildPerformanceHistory } from "../services/workflows/creative-performance-history.js";
import type { CreativeJob } from "@switchboard/schemas";

const NOW = new Date("2026-06-04T12:00:00.000Z");

const HOOKS = {
  hooks: [{ angleRef: "0", text: "What if?", type: "question", platformScore: 9, rationale: "r" }],
  topCombos: [{ angleRef: "0", hookRef: "0", score: 9 }],
};

function measuredRow(over: Record<string, unknown> = {}) {
  return {
    kind: "measured_performance",
    version: 1,
    asOf: "2026-06-04T06:30:00.000Z",
    window: { from: "2026-05-05T00:00:00.000Z", to: "2026-06-04T06:30:00.000Z", days: 30 },
    delivery: "measured",
    join: { metaCampaignId: "camp-1", metaAdId: null, metaVideoId: null },
    meta: {
      spend: 50,
      impressions: 1000,
      inlineLinkClicks: 40,
      inlineLinkClickCtr: 4,
      conversions: 3,
      cpm: 50,
    },
    booked: { valueCents: 25000, count: 2 },
    trueRoas: 5,
    source: { insights: "meta_campaign_insights", conversions: "conversion_records" },
    ...over,
  };
}

function job(
  id: string,
  pastPerformance: unknown,
  over: Record<string, unknown> = {},
): CreativeJob {
  return {
    id,
    taskId: `t-${id}`,
    organizationId: "org-1",
    deploymentId: "dep-1",
    productDescription: "Promo",
    targetAudience: "Aud",
    platforms: ["meta"],
    brandVoice: null,
    productImages: [],
    references: [],
    pastPerformance: pastPerformance as Record<string, unknown> | null,
    generateReferenceImages: false,
    currentStage: "complete",
    stageOutputs: { hooks: HOOKS },
    stoppedAt: null,
    mode: "polished",
    createdAt: new Date("2026-05-04T00:00:00.000Z"),
    updatedAt: new Date("2026-05-04T00:00:00.000Z"),
    ...over,
  } as CreativeJob;
}

describe("buildPerformanceHistory", () => {
  it("returns null when no measured row exists (caller leaves pastPerformance null)", () => {
    expect(buildPerformanceHistory([], NOW)).toBeNull();
    expect(buildPerformanceHistory([job("a", null)], NOW)).toBeNull();
    expect(
      buildPerformanceHistory([job("a", measuredRow({ delivery: "no_delivery" }))], NOW),
    ).toBeNull();
    expect(
      buildPerformanceHistory(
        [
          job("a", {
            kind: "performance_history",
            version: 1,
            generatedAt: "x",
            topPerformers: [],
            summary: "s",
          }),
        ],
        NOW,
      ),
    ).toBeNull();
  });

  it("aggregates measured rows: trueRoas desc, nulls last, capped at 3, descriptor vocabulary", () => {
    const jobs = [
      job("low", measuredRow({ trueRoas: 1.2 })),
      job("nullroas", measuredRow({ trueRoas: null })),
      job("high", measuredRow({ trueRoas: 6 })),
      job("mid", measuredRow({ trueRoas: 3 })),
    ];
    const history = buildPerformanceHistory(jobs, NOW);

    expect(history).not.toBeNull();
    expect(history!.kind).toBe("performance_history");
    expect(history!.generatedAt).toBe(NOW.toISOString());
    expect(history!.topPerformers).toHaveLength(3);
    expect(history!.topPerformers.map((p) => p.jobId)).toEqual(["high", "mid", "low"]);
    expect(history!.topPerformers[0]).toMatchObject({
      descriptor: "polished:question",
      trueRoas: 6,
      spend: 50,
      bookedValueCents: 25000,
    });
    expect(history!.summary).toContain("4 measured");
  });

  it("skips unparseable rows but keeps the valid ones", () => {
    const jobs = [job("junk", { some: "legacy" }), job("good", measuredRow())];
    const history = buildPerformanceHistory(jobs, NOW);
    expect(history!.topPerformers.map((p) => p.jobId)).toEqual(["good"]);
    expect(history!.summary).toContain("1 measured");
  });
});
