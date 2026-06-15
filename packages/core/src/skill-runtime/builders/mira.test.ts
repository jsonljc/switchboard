import { describe, expect, it, vi } from "vitest";
import { miraBuilder, hasSurfacedCreativeMemorySignal } from "./mira.js";
import { FRONTLINE_LEDGER_LIMIT } from "./frontline-conversion.js";
import { loadSkill } from "../skill-loader.js";
import { interpolate } from "../template-engine.js";
import { ParameterResolutionError } from "../parameter-builder.js";
import type { SkillStores } from "../parameter-builder.js";
import type { MiraCreativeReadModel } from "../../creative-read-model/types.js";

// builders/ is one level deeper than skill-runtime/, so five `../` reach root.
const SKILLS_DIR = new URL("../../../../../skills", import.meta.url).pathname;

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
  // Shapes mirror BusinessFactsSchema (object-valued openingHours/bookingPolicies,
  // enum escalation channel) so renderBusinessFacts coverage is realistic.
  return {
    businessName: "Glow Clinic",
    timezone: "Asia/Singapore",
    locations: [{ name: "Orchard", address: "1 Orchard Rd" }],
    services: [{ name: "Botox", description: "Anti-wrinkle treatment" }],
    openingHours: {},
    bookingPolicies: {},
    additionalFaqs: [],
    escalationContact: { name: "Ops", channel: "whatsapp", address: "+65 0000 0000" },
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

  it("renders revenue-proven rows FIRST so the cap never drops measured winners", async () => {
    // Worst case: 12+ taste rows outrank the revenue row on raw confidence
    // (listHighConfidence orders by confidence only), revenue row sorted LAST.
    const rows = [
      ...Array.from({ length: 14 }, (_, i) => ({
        id: `t${i}`,
        category: "taste",
        canonicalKey: `taste:kept_polished_segment_${i}`,
        sourceCount: 3,
        confidence: 0.9,
      })),
      {
        id: "r1",
        category: "revenue_proven",
        canonicalKey: "revenue_proven:polished_question",
        sourceCount: 4,
        confidence: 0.67,
      },
    ];
    const stores = makeStores({
      deploymentMemoryReader: { listHighConfidence: vi.fn().mockResolvedValue(rows) },
    });
    const result = await miraBuilder(weeklyConfig, stores);
    expect(result.parameters["TASTE_CONTEXT"] as string).toContain("Measured winner");
    expect(result.injectedPatternIds[0]).toBe("revenue_proven:polished_question");
    expect(result.injectedPatternIds).toHaveLength(12);
  });

  it("wraps a reader throw in ParameterResolutionError (failure honesty)", async () => {
    const stores = makeStores({
      miraReadModelReader: { read: vi.fn().mockRejectedValue(new Error("db down")) },
    });
    await expect(miraBuilder(weeklyConfig, stores)).rejects.toMatchObject({
      name: "ParameterResolutionError",
      code: "mira-memory-read-failed",
    });
  });

  it("renders recent negative examples (passed and stopped jobs)", async () => {
    const model = {
      jobs: [
        {
          id: "j1",
          title: "Glossy promo",
          stage: "complete",
          status: "draft_ready",
          reviewAction: { canContinue: false, canStop: false, label: "" },
          source: { engine: "legacy_creative_job", mode: "polished" },
          createdAt: "2026-06-01T00:00:00Z",
          updatedAt: "2026-06-03T00:00:00Z",
          reviewDecision: "passed",
        },
        {
          id: "j2",
          title: "Confession clip",
          stage: "complete",
          status: "stopped",
          reviewAction: { canContinue: false, canStop: false, label: "" },
          source: { engine: "legacy_creative_job", mode: "ugc" },
          createdAt: "2026-06-01T00:00:00Z",
          updatedAt: "2026-06-04T00:00:00Z",
          reviewDecision: null,
        },
      ],
      counts: {
        total: 2,
        shippedThisWeek: 0,
        shippedPrevWeek: 0,
        inFlight: 0,
        awaitingReview: 0,
        stopped: 1,
      },
    } as unknown as MiraCreativeReadModel;
    const stores = makeStores({ miraReadModelReader: { read: vi.fn().mockResolvedValue(model) } });
    const result = await miraBuilder(weeklyConfig, stores);
    const perf = result.parameters["PERFORMANCE_CONTEXT"] as string;
    expect(perf).toContain('Stopped: "Confession clip" (ugc).');
    expect(perf).toContain('Recently passed: "Glossy promo" (polished).');
  });

  it("renders business facts content into BUSINESS_FACTS", async () => {
    const result = await miraBuilder(weeklyConfig, makeStores());
    expect(result.parameters["BUSINESS_FACTS"] as string).toContain("Glow Clinic");
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

describe("miraBuilder frontline conversion feed (Alex -> Mira)", () => {
  it("surfaces the top converting treatments from the booking-outcome ledger", async () => {
    const listForOrg = vi.fn().mockResolvedValue([
      { service: "Botox", bookingStatus: "confirmed" },
      { service: "Botox", bookingStatus: "confirmed" },
      { service: "Lip filler", bookingStatus: "confirmed" },
    ]);
    const stores = makeStores({ bookingOutcomeLedgerReader: { listForOrg } });
    const result = await miraBuilder(weeklyConfig, stores);
    const ctx = result.parameters["FRONTLINE_CONVERSION_CONTEXT"] as string;
    expect(ctx).toContain("Botox (2)");
    expect(ctx).toContain("Lip filler (1)");
    // Fetched org-scoped, bounded by the ledger limit.
    expect(listForOrg).toHaveBeenCalledWith({ orgId: "org1", limit: FRONTLINE_LEDGER_LIMIT });
  });

  it("degrades to empty context when no ledger reader is wired (back-compat)", async () => {
    const result = await miraBuilder(weeklyConfig, makeStores());
    expect(result.parameters["FRONTLINE_CONVERSION_CONTEXT"]).toBe("");
  });

  it("renders empty context when the org has no bookings yet", async () => {
    const stores = makeStores({
      bookingOutcomeLedgerReader: { listForOrg: vi.fn().mockResolvedValue([]) },
    });
    const result = await miraBuilder(weeklyConfig, stores);
    expect(result.parameters["FRONTLINE_CONVERSION_CONTEXT"]).toBe("");
  });

  it("fails the compose loudly when the ledger read fails (no silent empty signal)", async () => {
    const stores = makeStores({
      bookingOutcomeLedgerReader: {
        listForOrg: vi.fn().mockRejectedValue(new Error("db down")),
      },
    });
    await expect(miraBuilder(weeklyConfig, stores)).rejects.toBeInstanceOf(
      ParameterResolutionError,
    );
  });

  it("renders the frontline signal into the REAL Mira prompt body (not inert)", async () => {
    // End-to-end seam: builder -> parameters -> real SKILL.md body interpolation.
    // Guards against a built-but-inert feed where the param is emitted but the
    // prompt template never references it.
    const stores = makeStores({
      bookingOutcomeLedgerReader: {
        listForOrg: vi.fn().mockResolvedValue([
          { service: "Botox", bookingStatus: "confirmed" },
          { service: "Botox", bookingStatus: "confirmed" },
        ]),
      },
    });
    const { parameters } = await miraBuilder(weeklyConfig, stores);
    const skill = loadSkill("mira", SKILLS_DIR);
    const rendered = interpolate(skill.body, parameters, skill.parameters);
    expect(rendered).toContain("Botox (2)");
  });
});
