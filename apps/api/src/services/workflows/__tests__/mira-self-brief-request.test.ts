import { describe, expect, it } from "vitest";
import {
  isoWeekKey,
  buildMiraBriefComposeSubmitRequest,
  buildMiraConceptDraftSubmitRequest,
} from "../mira-self-brief-request.js";

const DEPLOYMENT = { deploymentId: "dep1", skillSlug: "creative" };

describe("isoWeekKey", () => {
  it("computes the ISO 8601 week from a UTC date", () => {
    // 2026-06-08 is a Monday in ISO week 24 of 2026.
    expect(isoWeekKey(new Date("2026-06-08T10:00:00Z"))).toBe("2026-W24");
  });

  it("handles year boundaries per ISO 8601", () => {
    // 2026-01-01 is a Thursday: ISO week 1 of 2026.
    expect(isoWeekKey(new Date("2026-01-01T00:00:00Z"))).toBe("2026-W01");
    // 2027-01-01 is a Friday: it belongs to ISO week 53 of 2026.
    expect(isoWeekKey(new Date("2027-01-01T00:00:00Z"))).toBe("2026-W53");
    // 2024-12-30 is a Monday: it belongs to ISO week 1 of 2025.
    expect(isoWeekKey(new Date("2024-12-30T00:00:00Z"))).toBe("2025-W01");
  });

  it("pads single-digit weeks", () => {
    expect(isoWeekKey(new Date("2026-02-03T00:00:00Z"))).toMatch(/^2026-W0\d$/);
  });
});

describe("buildMiraBriefComposeSubmitRequest", () => {
  it("builds the canonical weekly-scan compose submit", () => {
    const req = buildMiraBriefComposeSubmitRequest(
      {
        organizationId: "org1",
        composeSource: "weekly_scan",
        idempotencyKey: "self-brief-compose:dep1:2026-W24",
      },
      DEPLOYMENT,
    );
    expect(req).toMatchObject({
      organizationId: "org1",
      actor: { id: "system", type: "system" },
      intent: "creative.brief.compose",
      parameters: { composeSource: "weekly_scan" },
      trigger: "schedule",
      surface: { surface: "api" },
      idempotencyKey: "self-brief-compose:dep1:2026-W24",
      targetHint: { deploymentId: "dep1", skillSlug: "creative" },
    });
    expect(req.parameters).not.toHaveProperty("recommendation");
  });

  it("carries the recommendation context and internal trigger for handoff composes", () => {
    const req = buildMiraBriefComposeSubmitRequest(
      {
        organizationId: "org1",
        composeSource: "riley_handoff",
        recommendation: {
          actionType: "increase_budget",
          campaignId: "c1",
          rationale: "r",
          evidence: { clicks: 1, conversions: 1, days: 7 },
        },
        idempotencyKey: "handoff-compose:rec1:increase_budget",
        trigger: "internal",
      },
      DEPLOYMENT,
    );
    expect(req.trigger).toBe("internal");
    expect(req.parameters).toMatchObject({
      composeSource: "riley_handoff",
      recommendation: { campaignId: "c1" },
    });
  });
});

describe("buildMiraConceptDraftSubmitRequest", () => {
  it("builds the draft-only child with parent linkage and the weekly key", () => {
    const req = buildMiraConceptDraftSubmitRequest(
      {
        organizationId: "org1",
        brief: { productDescription: "p", targetAudience: "t" },
        parentWorkUnitId: "wu-compose",
        idempotencyKey: "self-brief:dep1:2026-W24",
      },
      DEPLOYMENT,
    );
    expect(req).toMatchObject({
      organizationId: "org1",
      actor: { id: "system", type: "system" },
      intent: "creative.concept.draft",
      trigger: "internal",
      parentWorkUnitId: "wu-compose",
      idempotencyKey: "self-brief:dep1:2026-W24",
      parameters: { brief: { productDescription: "p", targetAudience: "t" } },
      targetHint: { deploymentId: "dep1", skillSlug: "creative" },
    });
  });
});
