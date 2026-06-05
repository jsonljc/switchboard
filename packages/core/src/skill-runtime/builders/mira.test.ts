import { describe, expect, it, vi } from "vitest";
import { miraBuilder, hasSurfacedCreativeMemorySignal } from "./mira.js";
import { ParameterResolutionError } from "../parameter-builder.js";
import type { SkillStores } from "../parameter-builder.js";
import type { MiraCreativeReadModel } from "../../creative-read-model/types.js";

const FIXED_NOW = new Date("2026-06-05T10:00:00Z");

const emptyModel: MiraCreativeReadModel = {
  jobs: [],
  counts: {
    total: 0,
    shippedThisWeek: 0,
    shippedPrevWeek: 0,
    inFlight: 0,
    awaitingReview: 0,
    stopped: 0,
  },
};

function makeFacts(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    businessName: "Glow Clinic",
    timezone: "Asia/Singapore",
    locations: [],
    services: [],
    openingHours: [],
    bookingPolicies: [],
    additionalFaqs: [],
    escalationContact: { name: "Ops", channel: "phone", address: "+65 0000 0000" },
    ...overrides,
  };
}

function makeStores(overrides: Partial<Record<string, unknown>> = {}): SkillStores {
  return {
    opportunityStore: { findActiveByContact: vi.fn() },
    contactStore: { findById: vi.fn() },
    activityStore: { listByDeployment: vi.fn() },
    businessFactsStore: {
      get: vi.fn().mockResolvedValue(makeFacts()),
    },
    deploymentMemoryReader: {
      listHighConfidence: vi.fn().mockResolvedValue([]),
    },
    miraReadModelReader: {
      read: vi.fn().mockResolvedValue(emptyModel),
    },
    ...overrides,
  } as unknown as SkillStores;
}

const weeklyConfig = {
  orgId: "org1",
  deploymentId: "dep1",
  request: { composeSource: "weekly_scan" },
  now: () => FIXED_NOW,
};

describe("miraBuilder", () => {
  it("throws ParameterResolutionError when the memory reader is missing", async () => {
    const stores = makeStores({ deploymentMemoryReader: undefined });
    await expect(miraBuilder(weeklyConfig, stores)).rejects.toBeInstanceOf(
      ParameterResolutionError,
    );
  });

  it("throws ParameterResolutionError when the read-model reader is missing", async () => {
    const stores = makeStores({ miraReadModelReader: undefined });
    await expect(miraBuilder(weeklyConfig, stores)).rejects.toBeInstanceOf(
      ParameterResolutionError,
    );
  });

  it("throws ParameterResolutionError on an invalid compose request", async () => {
    await expect(
      miraBuilder({ ...weeklyConfig, request: { composeSource: "riley_handoff" } }, makeStores()),
    ).rejects.toBeInstanceOf(ParameterResolutionError);
  });

  it("renders mode-labeled taste lines for BOTH modes and returns their keys", async () => {
    const stores = makeStores({
      deploymentMemoryReader: {
        listHighConfidence: vi.fn().mockResolvedValue([
          {
            id: "m1",
            category: "taste",
            canonicalKey: "taste:kept_polished_question",
            sourceCount: 5,
            confidence: 0.8,
          },
          {
            id: "m2",
            category: "taste",
            canonicalKey: "taste:passed_ugc_confession",
            sourceCount: 3,
            confidence: 0.7,
          },
          // Non-taste category with a taste-shaped key: ignored.
          {
            id: "m3",
            category: "preference",
            canonicalKey: "taste:kept_polished_question",
            sourceCount: 9,
            confidence: 0.9,
          },
          // Unparseable key: ignored.
          { id: "m4", category: "taste", canonicalKey: "garbage", sourceCount: 9, confidence: 0.9 },
        ]),
      },
    });
    const result = await miraBuilder(weeklyConfig, stores);
    const taste = result.parameters["TASTE_CONTEXT"] as string;
    expect(taste).toContain("polished mode");
    expect(taste).toContain("question hooks");
    expect(taste).toContain("real-talk mode");
    expect(taste).toContain("confession structure");
    expect(result.injectedPatternIds).toEqual([
      "taste:kept_polished_question",
      "taste:passed_ugc_confession",
    ]);
  });

  it("renders revenue-proven rows as measured-winner lines", async () => {
    const stores = makeStores({
      deploymentMemoryReader: {
        listHighConfidence: vi.fn().mockResolvedValue([
          {
            id: "r1",
            category: "revenue_proven",
            canonicalKey: "revenue_proven:polished_question",
            sourceCount: 4,
            confidence: 0.9,
          },
        ]),
      },
    });
    const result = await miraBuilder(weeklyConfig, stores);
    const taste = result.parameters["TASTE_CONTEXT"] as string;
    expect(taste).toContain("Measured winner");
    expect(result.injectedPatternIds).toEqual(["revenue_proven:polished_question"]);
  });

  it("summarizes measured performance deterministically (cents to dollars)", async () => {
    const model = {
      jobs: [
        {
          id: "j1",
          title: "Question hook reel",
          stage: "complete",
          status: "shipped",
          reviewAction: { canContinue: false, canStop: false, label: "" },
          source: { engine: "legacy_creative_job", mode: "polished" },
          createdAt: "2026-06-01T00:00:00Z",
          updatedAt: "2026-06-02T00:00:00Z",
          reviewDecision: "kept",
          performance: {
            asOf: "2026-06-04T00:00:00Z",
            delivery: "measured",
            spend: 40,
            trueRoas: 2.1,
            bookedValueCents: 8400,
            bookedCount: 2,
            metaConversions: 3,
          },
        },
      ],
      counts: {
        total: 1,
        shippedThisWeek: 1,
        shippedPrevWeek: 0,
        inFlight: 0,
        awaitingReview: 0,
        stopped: 0,
      },
    } as unknown as MiraCreativeReadModel;
    const stores = makeStores({ miraReadModelReader: { read: vi.fn().mockResolvedValue(model) } });
    const result = await miraBuilder(weeklyConfig, stores);
    const perf = result.parameters["PERFORMANCE_CONTEXT"] as string;
    expect(perf).toContain("Question hook reel");
    expect(perf).toContain("true ROAS 2.1");
    expect(perf).toContain("$84.00 booked");
    expect(perf).toContain("kept");
  });

  it("says so when nothing is measured yet", async () => {
    const result = await miraBuilder(weeklyConfig, makeStores());
    expect(result.parameters["PERFORMANCE_CONTEXT"]).toContain(
      "No published creatives with measured performance yet",
    );
  });

  it("falls back to the clinic default when facts are absent", async () => {
    const stores = makeStores({ businessFactsStore: { get: vi.fn().mockResolvedValue(null) } });
    const result = await miraBuilder(weeklyConfig, stores);
    expect(result.parameters["BUSINESS_NAME"]).toBe("the clinic");
    expect(
      (stores.miraReadModelReader as unknown as { read: ReturnType<typeof vi.fn> }).read,
    ).toHaveBeenCalledWith("org1", expect.objectContaining({ timezone: "Asia/Singapore" }));
  });

  it("degrades an invalid IANA timezone instead of throwing", async () => {
    const stores = makeStores({
      businessFactsStore: {
        get: vi.fn().mockResolvedValue(makeFacts({ businessName: "X", timezone: "SGT" })),
      },
    });
    const result = await miraBuilder(weeklyConfig, stores);
    expect(result.parameters["CURRENT_DATETIME"]).toContain("Asia/Singapore");
    expect(
      (stores.miraReadModelReader as unknown as { read: ReturnType<typeof vi.fn> }).read,
    ).toHaveBeenCalledWith("org1", expect.objectContaining({ timezone: "Asia/Singapore" }));
  });

  it("renders the riley recommendation into TRIGGER_CONTEXT", async () => {
    const result = await miraBuilder(
      {
        ...weeklyConfig,
        request: {
          composeSource: "riley_handoff",
          recommendation: {
            actionType: "increase_budget",
            campaignId: "camp_9",
            rationale: "CTR strong",
            evidence: { clicks: 100, conversions: 5, days: 7 },
          },
        },
      },
      makeStores(),
    );
    const trigger = result.parameters["TRIGGER_CONTEXT"] as string;
    expect(trigger).toContain("increase_budget");
    expect(trigger).toContain("camp_9");
    expect(trigger).toContain("100 clicks");
  });

  it("caps taste lines at 12", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: `m${i}`,
      category: "taste",
      canonicalKey: `taste:kept_polished_segment_${i}`,
      sourceCount: 3,
      confidence: 0.7,
    }));
    const stores = makeStores({
      deploymentMemoryReader: { listHighConfidence: vi.fn().mockResolvedValue(rows) },
    });
    const result = await miraBuilder(weeklyConfig, stores);
    expect(result.injectedPatternIds).toHaveLength(12);
  });
});

describe("hasSurfacedCreativeMemorySignal", () => {
  it("is true for a parseable surfaced taste row", () => {
    expect(
      hasSurfacedCreativeMemorySignal([
        {
          id: "1",
          category: "taste",
          canonicalKey: "taste:kept_polished_question",
          sourceCount: 3,
          confidence: 0.7,
        },
      ]),
    ).toBe(true);
  });

  it("is true for a parseable revenue-proven row", () => {
    expect(
      hasSurfacedCreativeMemorySignal([
        {
          id: "1",
          category: "revenue_proven",
          canonicalKey: "revenue_proven:ugc_demo_first",
          sourceCount: 4,
          confidence: 0.8,
        },
      ]),
    ).toBe(true);
  });

  it("is false for unparseable or non-creative rows", () => {
    expect(
      hasSurfacedCreativeMemorySignal([
        { id: "1", category: "faq", canonicalKey: null, sourceCount: 5, confidence: 0.9 },
        { id: "2", category: "taste", canonicalKey: "nope", sourceCount: 5, confidence: 0.9 },
      ]),
    ).toBe(false);
  });
});
