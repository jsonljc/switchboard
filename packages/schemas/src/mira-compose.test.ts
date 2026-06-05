import { describe, expect, it } from "vitest";
import {
  MiraComposeRequestSchema,
  MiraComposeOutputSchema,
  parseMiraComposeOutput,
} from "./mira-compose.js";

describe("MiraComposeRequestSchema", () => {
  it("accepts a weekly scan without recommendation", () => {
    const r = MiraComposeRequestSchema.safeParse({ composeSource: "weekly_scan" });
    expect(r.success).toBe(true);
  });

  it("rejects riley_handoff without recommendation", () => {
    const r = MiraComposeRequestSchema.safeParse({ composeSource: "riley_handoff" });
    expect(r.success).toBe(false);
  });

  it("accepts riley_handoff with full recommendation context", () => {
    const r = MiraComposeRequestSchema.safeParse({
      composeSource: "riley_handoff",
      recommendation: {
        actionType: "increase_budget",
        campaignId: "camp_1",
        rationale: "strong CTR, conversions trending up",
        evidence: { clicks: 240, conversions: 12, days: 14 },
      },
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown composeSource", () => {
    const r = MiraComposeRequestSchema.safeParse({ composeSource: "cron" });
    expect(r.success).toBe(false);
  });
});

describe("MiraComposeOutputSchema", () => {
  it("rejects propose without a brief", () => {
    const r = MiraComposeOutputSchema.safeParse({ decision: "propose", reason: "x" });
    expect(r.success).toBe(false);
  });

  it("accepts abstain without a brief", () => {
    const r = MiraComposeOutputSchema.safeParse({ decision: "abstain", reason: "thin signal" });
    expect(r.success).toBe(true);
  });

  it("enforces the 500-char caps on brief fields", () => {
    const r = MiraComposeOutputSchema.safeParse({
      decision: "propose",
      reason: "ok",
      brief: { productDescription: "a".repeat(501), targetAudience: "b" },
    });
    expect(r.success).toBe(false);
  });
});

describe("parseMiraComposeOutput", () => {
  const valid = {
    decision: "propose",
    reason: "kept question hooks performing",
    brief: { productDescription: "Botox intro offer", targetAudience: "women 30-45" },
  };

  it("parses clean JSON", () => {
    const r = parseMiraComposeOutput(JSON.stringify(valid));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.decision).toBe("propose");
  });

  it("strips a json markdown fence", () => {
    const r = parseMiraComposeOutput("```json\n" + JSON.stringify(valid) + "\n```");
    expect(r.ok).toBe(true);
  });

  it("strips a bare fence", () => {
    const r = parseMiraComposeOutput("```\n" + JSON.stringify(valid) + "\n```\n");
    expect(r.ok).toBe(true);
  });

  it("returns ok:false on prose", () => {
    const r = parseMiraComposeOutput("I think we should make an ad about Botox.");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("not JSON");
  });

  it("returns ok:false on schema-invalid JSON", () => {
    const r = parseMiraComposeOutput(JSON.stringify({ decision: "propose", reason: "x" }));
    expect(r.ok).toBe(false);
  });

  it("returns ok:false on truncated JSON", () => {
    const r = parseMiraComposeOutput(JSON.stringify(valid).slice(0, 40));
    expect(r.ok).toBe(false);
  });
});
