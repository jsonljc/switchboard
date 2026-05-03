import { describe, expect, it } from "vitest";
import {
  RecommendationActionSchema,
  RecommendationSurfaceSchema,
  RecommendationStatusSchema,
  RecommendationInputSchema,
  RecommendationPresentationSchema,
  ActOnRecommendationInputSchema,
} from "../recommendations.js";

describe("RecommendationSurfaceSchema", () => {
  it("accepts queue, shadow_action, dropped", () => {
    expect(RecommendationSurfaceSchema.parse("queue")).toBe("queue");
    expect(RecommendationSurfaceSchema.parse("shadow_action")).toBe("shadow_action");
    expect(RecommendationSurfaceSchema.parse("dropped")).toBe("dropped");
  });
  it("rejects unknown values", () => {
    expect(() => RecommendationSurfaceSchema.parse("queueable")).toThrow();
  });
});

describe("RecommendationStatusSchema", () => {
  it("accepts pending, acted, dismissed, confirmed, dismissed_by_undo, expired", () => {
    for (const s of [
      "pending",
      "acted",
      "dismissed",
      "confirmed",
      "dismissed_by_undo",
      "expired",
    ]) {
      expect(RecommendationStatusSchema.parse(s)).toBe(s);
    }
  });
  it("rejects unknown status values", () => {
    expect(() => RecommendationStatusSchema.parse("archived")).toThrow();
    expect(() => RecommendationStatusSchema.parse("PENDING")).toThrow();
  });
});

describe("RecommendationActionSchema", () => {
  it("accepts the five operator actions", () => {
    for (const a of ["primary", "secondary", "dismiss", "confirm", "undo"]) {
      expect(RecommendationActionSchema.parse(a)).toBe(a);
    }
  });
  it("rejects unknown action values", () => {
    expect(() => RecommendationActionSchema.parse("approve")).toThrow();
    expect(() => RecommendationActionSchema.parse("PRIMARY")).toThrow();
  });
});

describe("RecommendationPresentationSchema", () => {
  it("accepts the four presentation fields", () => {
    const ok = RecommendationPresentationSchema.parse({
      primaryLabel: "Pause",
      secondaryLabel: "Reduce 50%",
      dismissLabel: "Dismiss",
      dataLines: [["text"]],
    });
    expect(ok.primaryLabel).toBe("Pause");
  });
  it("requires all four label fields", () => {
    expect(() =>
      RecommendationPresentationSchema.parse({ primaryLabel: "x", dataLines: [] }),
    ).toThrow();
  });
});

describe("RecommendationInputSchema", () => {
  it("accepts a minimal valid input", () => {
    const ok = RecommendationInputSchema.parse({
      orgId: "org-1",
      agentKey: "alex",
      intent: "recommendation.ad_set_pause",
      action: "pause",
      humanSummary: "Pause Whitening Ad Set B",
      confidence: 0.9,
      dollarsAtRisk: 25,
      riskLevel: "low",
      parameters: {},
      presentation: {
        primaryLabel: "Pause",
        secondaryLabel: "Reduce 50%",
        dismissLabel: "Dismiss",
        dataLines: [],
      },
    });
    expect(ok.confidence).toBe(0.9);
  });
  it("clamps confidence to 0..1", () => {
    expect(() =>
      RecommendationInputSchema.parse({
        orgId: "o",
        agentKey: "alex",
        intent: "recommendation.x",
        action: "pause",
        humanSummary: "x",
        confidence: 1.5,
        dollarsAtRisk: 0,
        riskLevel: "low",
        parameters: {},
        presentation: { primaryLabel: "x", secondaryLabel: "x", dismissLabel: "x", dataLines: [] },
      }),
    ).toThrow();
  });
  it("rejects unknown agentKey", () => {
    expect(() =>
      RecommendationInputSchema.parse({
        orgId: "o",
        agentKey: "zoe",
        intent: "recommendation.x",
        action: "pause",
        humanSummary: "x",
        confidence: 0.5,
        dollarsAtRisk: 0,
        riskLevel: "low",
        parameters: {},
        presentation: { primaryLabel: "x", secondaryLabel: "x", dismissLabel: "x", dataLines: [] },
      }),
    ).toThrow();
  });
  it("rejects negative confidence", () => {
    expect(() =>
      RecommendationInputSchema.parse({
        orgId: "o",
        agentKey: "alex",
        intent: "recommendation.x",
        action: "pause",
        humanSummary: "x",
        confidence: -0.1,
        dollarsAtRisk: 0,
        riskLevel: "low",
        parameters: {},
        presentation: { primaryLabel: "x", secondaryLabel: "x", dismissLabel: "x", dataLines: [] },
      }),
    ).toThrow();
  });
});

describe("ActOnRecommendationInputSchema", () => {
  it("accepts a minimal valid input", () => {
    const ok = ActOnRecommendationInputSchema.parse({
      recommendationId: "rec-1",
      orgId: "org-1",
      actor: { principalId: "user-1", type: "operator" },
      action: "primary",
    });
    expect(ok.action).toBe("primary");
  });
  it("rejects non-operator actor type", () => {
    expect(() =>
      ActOnRecommendationInputSchema.parse({
        recommendationId: "rec-1",
        orgId: "org-1",
        actor: { principalId: "user-1", type: "system" },
        action: "primary",
      }),
    ).toThrow();
  });
  it("rejects unknown action", () => {
    expect(() =>
      ActOnRecommendationInputSchema.parse({
        recommendationId: "rec-1",
        orgId: "org-1",
        actor: { principalId: "user-1", type: "operator" },
        action: "approve",
      }),
    ).toThrow();
  });
  it("accepts optional note", () => {
    const ok = ActOnRecommendationInputSchema.parse({
      recommendationId: "rec-1",
      orgId: "org-1",
      actor: { principalId: "user-1", type: "operator" },
      action: "dismiss",
      note: "stale data",
    });
    expect(ok.note).toBe("stale data");
  });
});
