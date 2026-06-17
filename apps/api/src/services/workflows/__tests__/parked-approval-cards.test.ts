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

  it("humanizes the parked Riley pause with campaign, rationale, evidence, rollback note", () => {
    const s = summarizeParkedIntent({
      intent: "adoptimizer.campaign.pause",
      organizationId: "org_dev",
      actorId: "system",
      parameters: {
        recommendationId: "rec_1",
        actionType: "pause",
        campaignId: "camp-7",
        rationale: "sustained spend with zero booked revenue",
        evidence: { clicks: 1000, conversions: 100, days: 30 },
      },
    });
    expect(s).not.toBeNull();
    expect(s!.humanSummary).toMatch(/Riley wants to pause/);
    expect(s!.humanSummary).toContain("camp-7");
    expect(s!.humanSummary).toContain("sustained spend");
    const flat = (s!.dataLines ?? []).map((l) => (Array.isArray(l) ? l.join(" ") : l)).join("\n");
    expect(flat).toContain("1000 clicks");
    expect(flat).toContain("Resume");
    expect(s!.presentation?.primaryLabel).toBe("Approve pause");
    // A pause mutates live spend state on Meta: external + financial, high risk.
    expect(s!.riskContract).toMatchObject({
      riskLevel: "high",
      externalEffect: true,
      financialEffect: true,
      requiresConfirmation: true,
    });
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

  it("enriches the publish card with the asset link, ad account, and an expiry countdown", () => {
    const parkedAt = new Date("2026-06-17T10:00:00.000Z");
    const expiresAt = new Date("2026-06-18T10:00:00.000Z"); // 24h after parkedAt
    const s = summarizeParkedIntent({
      intent: "creative.job.publish",
      organizationId: "org_dev",
      actorId: "user_1",
      parameters: {
        jobId: "job_42",
        durableAssetUrl: "https://cdn.example.com/creatives/job_42.mp4",
        accountId: "act_998877",
      },
      parkedAt,
      expiresAt,
    });
    expect(s).not.toBeNull();
    const flat = (s!.dataLines ?? []).map((l) => (Array.isArray(l) ? l.join(" ") : l)).join("\n");
    // Operator can open the creative without navigating to Mira.
    expect(flat).toContain("https://cdn.example.com/creatives/job_42.mp4");
    // Operator sees which Meta ad account the draft lands in.
    expect(flat).toContain("act_998877");
    // Operator sees a real expiry signal (no more silent park expiries).
    expect(flat).toMatch(/expire/i);
    expect(flat).toContain("2026-06-18");
    // The durable URL is also exposed as a first-class review-in-place link.
    expect(s!.assetHref).toBe("https://cdn.example.com/creatives/job_42.mp4");
  });

  it("renders the publish card without asset/account/expiry lines when those are absent", () => {
    const s = summarizeParkedIntent({
      intent: "creative.job.publish",
      organizationId: "org_dev",
      actorId: "user_1",
      parameters: { jobId: "job_bare" },
    });
    expect(s).not.toBeNull();
    const flat = (s!.dataLines ?? []).map((l) => (Array.isArray(l) ? l.join(" ") : l)).join("\n");
    // Still has the static no-spend guidance even with no enrichment fields.
    expect(flat.toLowerCase()).toContain("paused");
    expect(flat).not.toMatch(/Creative:/);
    expect(flat).not.toMatch(/Ad account:/);
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
