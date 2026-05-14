import { describe, it, expect } from "vitest";
import { deriveRileyStatus } from "../riley-status-deriver";

const now = new Date("2026-05-14T12:00:00.000Z");
const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60_000 + 1_000);
const sixteenMinutesAgo = new Date(now.getTime() - 16 * 60_000);

describe("deriveRileyStatus", () => {
  it("HALTED takes precedence over everything", () => {
    expect(
      deriveRileyStatus({
        halted: true,
        hasMetaConnection: true,
        hasActiveCampaign: true,
        pendingApprovals: 5,
        recentActivityAt: fifteenMinutesAgo,
        now,
      }),
    ).toBe("HALTED");
  });

  it("IDLE when no Meta Ads Connection (even if pending recs exist)", () => {
    expect(
      deriveRileyStatus({
        halted: false,
        hasMetaConnection: false,
        hasActiveCampaign: false,
        pendingApprovals: 3,
        recentActivityAt: fifteenMinutesAgo,
        now,
      }),
    ).toBe("IDLE");
  });

  it("IDLE when Connection exists but no active campaigns", () => {
    expect(
      deriveRileyStatus({
        halted: false,
        hasMetaConnection: true,
        hasActiveCampaign: false,
        pendingApprovals: 0,
        recentActivityAt: null,
        now,
      }),
    ).toBe("IDLE");
  });

  it("WAITING when Connection + active campaign + pending recs", () => {
    expect(
      deriveRileyStatus({
        halted: false,
        hasMetaConnection: true,
        hasActiveCampaign: true,
        pendingApprovals: 2,
        recentActivityAt: fifteenMinutesAgo,
        now,
      }),
    ).toBe("WAITING");
  });

  it("WATCHING when Connection + active campaign + no pending + recent activity within 15min", () => {
    expect(
      deriveRileyStatus({
        halted: false,
        hasMetaConnection: true,
        hasActiveCampaign: true,
        pendingApprovals: 0,
        recentActivityAt: fifteenMinutesAgo,
        now,
      }),
    ).toBe("WATCHING");
  });

  it("IDLE when Connection + active campaign + no pending + activity older than 15min", () => {
    expect(
      deriveRileyStatus({
        halted: false,
        hasMetaConnection: true,
        hasActiveCampaign: true,
        pendingApprovals: 0,
        recentActivityAt: sixteenMinutesAgo,
        now,
      }),
    ).toBe("IDLE");
  });

  it("IDLE when Connection + active campaign + no pending + no activity at all", () => {
    expect(
      deriveRileyStatus({
        halted: false,
        hasMetaConnection: true,
        hasActiveCampaign: true,
        pendingApprovals: 0,
        recentActivityAt: null,
        now,
      }),
    ).toBe("IDLE");
  });

  it("does not return REVIEWING in B.1 (deferred — no signal source)", () => {
    const result = deriveRileyStatus({
      halted: false,
      hasMetaConnection: true,
      hasActiveCampaign: true,
      pendingApprovals: 0,
      recentActivityAt: fifteenMinutesAgo,
      now,
    });
    expect(result).not.toBe("REVIEWING");
  });
});
