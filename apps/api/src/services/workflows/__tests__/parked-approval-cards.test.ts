import { describe, it, expect } from "vitest";
import { summarizeParkedIntent } from "../parked-approval-cards.js";

describe("summarizeParkedIntent", () => {
  it("humanizes the Riley -> Mira handoff with rationale, campaign, evidence, brief", () => {
    const s = summarizeParkedIntent({
      intent: "adoptimizer.recommendation.handoff",
      organizationId: "org_dev",
      actorId: "system",
      parameters: {
        recommendationId: "rec_1",
        actionType: "refresh_creative",
        campaignId: "camp-42",
        rationale: "CTR halved while frequency climbed.",
        evidence: { clicks: 1000, conversions: 50, days: 7 },
        learningPhaseActive: false,
        brief: { productDescription: "Hydrafacial promo", targetAudience: "Local adults 25-45" },
      },
    });
    expect(s).not.toBeNull();
    expect(s!.humanSummary).toContain("camp-42");
    expect(s!.humanSummary).toContain("CTR halved");
    expect(s!.humanSummary).toMatch(/Riley/);
    expect(s!.humanSummary).toMatch(/Mira/);
    const flat = (s!.dataLines ?? []).map((l) => (Array.isArray(l) ? l.join(" ") : l)).join("\n");
    expect(flat).toContain("1000 clicks");
    expect(flat).toContain("Hydrafacial promo");
    expect(flat).toContain("Local adults 25-45");
    expect(s!.presentation?.primaryLabel).toBe("Approve handoff");
    expect(s!.riskContract).toMatchObject({ riskLevel: "medium", requiresConfirmation: true });
  });

  it("notes the learning phase when active", () => {
    const s = summarizeParkedIntent({
      intent: "adoptimizer.recommendation.handoff",
      organizationId: "org_dev",
      actorId: "system",
      parameters: { campaignId: "camp-1", learningPhaseActive: true },
    });
    const flat = (s!.dataLines ?? []).map((l) => (Array.isArray(l) ? l.join(" ") : l)).join("\n");
    expect(flat).toContain("learning phase");
  });

  it("humanizes creative.job.publish as a paused no-spend Meta draft (review #9)", () => {
    const s = summarizeParkedIntent({
      intent: "creative.job.publish",
      organizationId: "org_dev",
      actorId: "user_1",
      parameters: { jobId: "job_9" },
    });
    expect(s).not.toBeNull();
    expect(s!.humanSummary).toContain("job_9");
    expect(s!.humanSummary.toLowerCase()).toContain("paused");
    expect(s!.humanSummary).toContain("will not spend");
    expect(s!.riskContract).toEqual({
      riskLevel: "high",
      externalEffect: true,
      financialEffect: false,
      clientFacing: false,
      requiresConfirmation: true,
    });
  });

  it("returns null for intents without a bespoke card (default card upstream)", () => {
    expect(
      summarizeParkedIntent({
        intent: "conversation.reminder.send",
        organizationId: "org_dev",
        actorId: "system",
        parameters: {},
      }),
    ).toBeNull();
  });

  it("does not throw on malformed parameters (defensive reads)", () => {
    const s = summarizeParkedIntent({
      intent: "adoptimizer.recommendation.handoff",
      organizationId: "org_dev",
      actorId: "system",
      parameters: { campaignId: 42, evidence: "not-an-object", brief: null },
    });
    expect(s).not.toBeNull();
    expect(typeof s!.humanSummary).toBe("string");
  });
});
