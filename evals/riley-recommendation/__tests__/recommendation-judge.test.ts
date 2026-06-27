import { describe, it, expect } from "vitest";
import {
  judgeRecommendation,
  classifyPrimary,
  buildCampaignSummary,
  toJudgeInput,
  isMainPush,
  SKIP_MESSAGE,
  JUDGE_RUBRIC_VERSION,
  JUDGE_RUBRIC_HASH,
  type AnthropicClientLike,
  type JudgeRecommendationInput,
} from "../recommendation-judge.js";
import type { RileyCase } from "../schema.js";
import type { RileyDecision } from "../decide.js";

const input: JudgeRecommendationInput = {
  campaignSummary: "spend=500, conversions=0",
  rileyPrimary: "pause",
  rileyActions: ["pause"],
  rileyWatches: [],
};

const stubClient = (toolInput: unknown): AnthropicClientLike => ({
  messages: {
    create: async () => ({
      content: [{ type: "tool_use", name: "judge_recommendation", input: toolInput }],
    }),
  },
});

const noToolClient: AnthropicClientLike = {
  messages: { create: async () => ({ content: [{ type: "text", text: "no tool use" }] }) },
};

const throwingClient: AnthropicClientLike = {
  messages: {
    create: async () => {
      throw new Error("client boom");
    },
  },
};

describe("judgeRecommendation", () => {
  it("parses a well-formed agree verdict, normalises the action, and stamps the rubric", async () => {
    const v = await judgeRecommendation(input, {
      client: stubClient({
        agreesWithRiley: true,
        judgedAction: "kill",
        soundness: 5,
        notes: "zero conversions at $500 spend — pausing is sound",
      }),
      model: "claude-sonnet-4-6",
    });
    expect(v.agreesWithRiley).toBe(true);
    expect(v.judgedAction).toBe("kill");
    expect(v.soundness).toBe(5);
    expect(v.rubricVersion).toBe(JUDGE_RUBRIC_VERSION);
    expect(v.rubricHash).toBe(JUDGE_RUBRIC_HASH);
  });

  it("normalises free-text judge actions onto buckets (pause->kill, hold->abstain, junk->other)", async () => {
    const cases: Array<[string, string]> = [
      ["pause", "kill"],
      ["Stop", "kill"],
      ["increase", "scale"],
      ["hold", "abstain"],
      ["WATCH", "abstain"],
      ["frobnicate", "other"],
    ];
    for (const [raw, bucket] of cases) {
      const v = await judgeRecommendation(input, {
        client: stubClient({ agreesWithRiley: true, judgedAction: raw, soundness: 3, notes: "x" }),
        model: "m",
      });
      expect(v.judgedAction, raw).toBe(bucket);
    }
  });

  it("clamps and rounds soundness into [0,5]", async () => {
    const hi = await judgeRecommendation(input, {
      client: stubClient({
        agreesWithRiley: true,
        judgedAction: "kill",
        soundness: 9.6,
        notes: "x",
      }),
      model: "m",
    });
    expect(hi.soundness).toBe(5);
    const lo = await judgeRecommendation(input, {
      client: stubClient({
        agreesWithRiley: false,
        judgedAction: "scale",
        soundness: -3,
        notes: "x",
      }),
      model: "m",
    });
    expect(lo.soundness).toBe(0);
  });

  it("fails closed (error verdict) when no judge tool_use block is returned", async () => {
    const v = await judgeRecommendation(input, { client: noToolClient, model: "m" });
    expect(v.agreesWithRiley).toBe(false);
    expect(v.judgedAction).toBe("error");
    expect(v.soundness).toBe(0);
  });

  it("fails closed when the client call throws", async () => {
    const v = await judgeRecommendation(input, { client: throwingClient, model: "m" });
    expect(v.agreesWithRiley).toBe(false);
    expect(v.judgedAction).toBe("error");
  });

  it("fails closed when the tool input does not match the schema", async () => {
    const v = await judgeRecommendation(input, {
      client: stubClient({ agreesWithRiley: "yes", soundness: "high" }),
      model: "m",
    });
    expect(v.agreesWithRiley).toBe(false);
    expect(v.judgedAction).toBe("error");
  });
});

describe("classifyPrimary", () => {
  it("collapses Riley's reduced primary label into kill/scale/abstain/other", () => {
    expect(classifyPrimary("pause")).toBe("kill");
    expect(classifyPrimary("scale")).toBe("scale");
    expect(classifyPrimary("watch")).toBe("abstain");
    expect(classifyPrimary("insight")).toBe("abstain");
    expect(classifyPrimary("none")).toBe("abstain");
    expect(classifyPrimary("add_creative")).toBe("other");
  });
});

describe("buildCampaignSummary / toJudgeInput", () => {
  const baseCase: RileyCase = {
    id: "ao-zero-burn",
    current: {
      impressions: 10000,
      inlineLinkClicks: 50,
      spend: 500,
      conversions: 0,
      revenue: 0,
      frequency: 2,
    },
    previous: {
      impressions: 8000,
      inlineLinkClicks: 40,
      spend: 400,
      conversions: 0,
      revenue: 0,
      frequency: 1.8,
    },
    targetBreach: { periodsAboveTarget: 3, granularity: "weekly" },
    learningState: "success",
    economicTier: "booked_cac",
    effectiveTarget: 80,
    targetROAS: 3,
    measurementTrusted: false,
    expectedOutcome: "pause",
  };

  it("renders the RAW data the engine sees, including previous + untrusted-measurement", () => {
    const s = buildCampaignSummary(baseCase);
    expect(s).toContain("spend=500");
    expect(s).toContain("conversions=0");
    expect(s).toContain("3 period(s) above target (weekly)");
    expect(s).toContain("Previous period:");
    expect(s).toContain("UNTRUSTED");
    // The judge must reason from data, not Riley's framing — the summary names no Riley action.
    expect(s).not.toContain("pause");
  });

  it("threads the engine decision into the judge input", () => {
    const decision: RileyDecision = {
      actions: ["pause"],
      watchPatterns: [],
      hasInsight: false,
      primary: "pause",
      confidenceByAction: { pause: 0.9 },
    };
    const ji = toJudgeInput(baseCase, decision);
    expect(ji.rileyPrimary).toBe("pause");
    expect(ji.rileyActions).toEqual(["pause"]);
    expect(ji.campaignSummary).toContain("spend=500");
  });
});

describe("idiom (a) preflight", () => {
  it("isMainPush is true only on a push to refs/heads/main", () => {
    expect(isMainPush({ GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main" })).toBe(true);
    expect(isMainPush({ GITHUB_EVENT_NAME: "pull_request", GITHUB_REF: "refs/heads/main" })).toBe(
      false,
    );
    expect(isMainPush({ GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/feature" })).toBe(false);
    expect(isMainPush({})).toBe(false);
  });

  it("exposes a stable skip message", () => {
    expect(SKIP_MESSAGE).toContain("ANTHROPIC_API_KEY");
  });
});
