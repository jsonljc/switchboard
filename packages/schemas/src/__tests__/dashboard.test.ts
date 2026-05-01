import { describe, it, expect } from "vitest";
import {
  AgentKeySchema,
  AdSetRowSchema,
  StageProgressSchema,
  STALE_AFTER_MINUTES,
} from "../dashboard.js";

describe("STALE_AFTER_MINUTES", () => {
  it("is 30", () => {
    expect(STALE_AFTER_MINUTES).toBe(30);
  });
});

describe("AgentKeySchema", () => {
  it("accepts alex / nova / mira / system", () => {
    for (const k of ["alex", "nova", "mira", "system"] as const) {
      expect(AgentKeySchema.parse(k)).toBe(k);
    }
  });
  it("rejects unknown agents", () => {
    expect(() => AgentKeySchema.parse("zoe")).toThrow();
  });
});

describe("AdSetRowSchema", () => {
  it("parses a complete row", () => {
    const row = AdSetRowSchema.parse({
      adSetId: "ad-1",
      adSetName: "Test Ad Set",
      deploymentId: "dep-1",
      spend: { amount: 42.5, currency: "USD" },
      conversions: 3,
      cpa: 14.17,
      trend: "up",
      status: "delivering",
      pausePending: false,
    });
    expect(row.adSetId).toBe("ad-1");
    expect(row.cpa).toBe(14.17);
  });
  it("accepts null cpa", () => {
    const row = AdSetRowSchema.parse({
      adSetId: "ad-1",
      adSetName: "x",
      deploymentId: "d",
      spend: { amount: 0, currency: "USD" },
      conversions: 0,
      cpa: null,
      trend: "flat",
      status: "learning",
      pausePending: false,
    });
    expect(row.cpa).toBeNull();
  });
  it("rejects unknown trend / status", () => {
    const base = {
      adSetId: "x",
      adSetName: "x",
      deploymentId: "d",
      spend: { amount: 0, currency: "USD" },
      conversions: 0,
      cpa: null,
      pausePending: false,
    };
    expect(() =>
      AdSetRowSchema.parse({ ...base, trend: "sideways", status: "delivering" }),
    ).toThrow();
    expect(() => AdSetRowSchema.parse({ ...base, trend: "up", status: "spinning" })).toThrow();
  });
});

describe("StageProgressSchema", () => {
  it("parses a row with a closesAt", () => {
    const sp = StageProgressSchema.parse({
      stageIndex: 1,
      stageTotal: 5,
      stageLabel: "hooks",
      closesAt: "2026-05-02T10:00:00Z",
    });
    expect(sp.stageLabel).toBe("hooks");
  });
  it("accepts null closesAt", () => {
    const sp = StageProgressSchema.parse({
      stageIndex: 0,
      stageTotal: 5,
      stageLabel: "trends",
      closesAt: null,
    });
    expect(sp.closesAt).toBeNull();
  });
  it("rejects negative stageIndex", () => {
    expect(() =>
      StageProgressSchema.parse({ stageIndex: -1, stageTotal: 5, stageLabel: "x", closesAt: null }),
    ).toThrow();
  });
  it("rejects zero stageTotal", () => {
    expect(() =>
      StageProgressSchema.parse({ stageIndex: 0, stageTotal: 0, stageLabel: "x", closesAt: null }),
    ).toThrow();
  });
});
