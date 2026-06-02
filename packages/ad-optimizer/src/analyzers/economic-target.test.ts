import { describe, it, expect } from "vitest";
import {
  selectEconomicTier,
  calibrateTargetFromBooking,
  applyTier,
  resolveEconomicTarget,
  resolveEconomicTargetForCampaign,
  MIN_BOOKED_FOR_TIER1,
  MIN_LEADS_FOR_TIER2,
  TIER2_CONFIDENCE_PENALTY,
} from "./economic-target.js";
import type { ResolvedEconomicTarget } from "./economic-target.js";
import type { RecommendationOutputSchema as RecommendationOutput } from "@switchboard/schemas";
import { WatchOutputSchema } from "@switchboard/schemas";
import { resetsLearningFor } from "../action-reset-classification.js";

function rec(overrides: Partial<RecommendationOutput> = {}): RecommendationOutput {
  const action = overrides.action ?? "pause";
  return {
    type: "recommendation",
    action,
    campaignId: "c1",
    campaignName: "C1",
    confidence: 0.9,
    urgency: "immediate",
    estimatedImpact: "over target",
    steps: ["pause it"],
    learningPhaseImpact: "no impact",
    resetsLearning: resetsLearningFor(action),
    ...overrides,
  };
}

describe("selectEconomicTier", () => {
  it("Tier 1 booked_cac when a booked target exists and bookings >= MIN_BOOKED_FOR_TIER1", () => {
    expect(
      selectEconomicTier({ bookings: MIN_BOOKED_FOR_TIER1, leads: 200, hasBookedTarget: true }),
    ).toBe("booked_cac");
  });
  it("falls to cpl when no booked target is configured, even with bookings", () => {
    expect(selectEconomicTier({ bookings: 50, leads: 200, hasBookedTarget: false })).toBe("cpl");
  });
  it("Tier 2 cpl when bookings sparse but leads >= MIN_LEADS_FOR_TIER2", () => {
    expect(
      selectEconomicTier({ bookings: 3, leads: MIN_LEADS_FOR_TIER2, hasBookedTarget: true }),
    ).toBe("cpl");
  });
  it("Tier 3 cpc when both bookings and leads are sparse", () => {
    expect(selectEconomicTier({ bookings: 2, leads: 10, hasBookedTarget: true })).toBe("cpc");
  });
  it("respects custom minBooked / minLeads overrides", () => {
    expect(
      selectEconomicTier({ bookings: 10, leads: 5, hasBookedTarget: true, minBooked: 20 }),
    ).toBe("cpc");
    expect(selectEconomicTier({ bookings: 0, leads: 5, hasBookedTarget: false, minLeads: 5 })).toBe(
      "cpl",
    );
  });
});

describe("calibrateTargetFromBooking", () => {
  it("converts cost-per-booked into the equivalent per-conversion target", () => {
    // $200/booked × (20 booked / 100 conversions = 0.2 booked/conv) = $40/conversion
    expect(
      calibrateTargetFromBooking({
        targetCostPerBooked: 200,
        accountBookings: 20,
        accountConversions: 100,
      }),
    ).toBe(40);
  });
  it("returns null when there are no conversions (no rate)", () => {
    expect(
      calibrateTargetFromBooking({
        targetCostPerBooked: 200,
        accountBookings: 20,
        accountConversions: 0,
      }),
    ).toBeNull();
  });
});

describe("applyTier", () => {
  it("Tier 1 keeps strength, stamps tier + marginBasis", () => {
    const out = applyTier({
      recommendation: rec(),
      tier: "booked_cac",
      marginBasis: "unavailable",
    });
    expect(out.recommendation?.confidence).toBe(0.9);
    expect(out.recommendation?.urgency).toBe("immediate");
    expect(out.recommendation?.economicTier).toBe("booked_cac");
    expect(out.recommendation?.marginBasis).toBe("unavailable");
    expect(out.recommendation?.estimatedImpact).toContain("booked-CAC");
    expect(out.watch).toBeUndefined();
  });
  it("Tier 2 lowers confidence by the penalty and urgency one band", () => {
    const out = applyTier({
      recommendation: rec({ confidence: 0.8, urgency: "immediate" }),
      tier: "cpl",
      marginBasis: "unavailable",
    });
    expect(out.recommendation?.confidence).toBe(0.8 - TIER2_CONFIDENCE_PENALTY); // 0.65, no float drift
    expect(out.recommendation?.urgency).toBe("this_week");
    expect(out.recommendation?.economicTier).toBe("cpl");
    expect(out.recommendation?.estimatedImpact).toContain("CPL proxy");
  });
  it("Tier 2 floors urgency at next_cycle and confidence at 0", () => {
    const out = applyTier({
      recommendation: rec({ confidence: 0.1, urgency: "next_cycle" }),
      tier: "cpl",
      marginBasis: "unavailable",
    });
    expect(out.recommendation?.urgency).toBe("next_cycle");
    expect(out.recommendation?.confidence).toBe(0);
  });
  it("Tier 3 converts a destructive recommendation into a watch", () => {
    const out = applyTier({
      recommendation: rec({ action: "pause" }),
      tier: "cpc",
      marginBasis: "unavailable",
      checkBackDate: "2026-06-09",
    });
    expect(out.recommendation).toBeUndefined();
    expect(out.watch?.type).toBe("watch");
    expect(out.watch?.checkBackDate).toBe("2026-06-09");
    expect(out.watch?.pattern).toContain("cpc");
    expect(() => WatchOutputSchema.parse(out.watch)).not.toThrow();
  });
  it("Tier 3 keeps fix_signal_health as a recommendation", () => {
    const out = applyTier({
      recommendation: rec({ action: "fix_signal_health" }),
      tier: "cpc",
      marginBasis: "unavailable",
    });
    expect(out.recommendation?.action).toBe("fix_signal_health");
    expect(out.recommendation?.economicTier).toBe("cpc");
    expect(out.watch).toBeUndefined();
  });
  it("Tier 1 names margin-awareness when marginBasis is configured", () => {
    const out = applyTier({ recommendation: rec(), tier: "booked_cac", marginBasis: "configured" });
    expect(out.recommendation?.marginBasis).toBe("configured");
    expect(out.recommendation?.estimatedImpact).toContain("margin-aware");
  });
  it("respects a custom confidencePenalty override", () => {
    const out = applyTier({
      recommendation: rec({ confidence: 0.9 }),
      tier: "cpl",
      marginBasis: "unavailable",
      confidencePenalty: 0.3,
    });
    expect(out.recommendation?.confidence).toBe(0.6); // 0.9 - 0.3
  });
});

describe("resolveEconomicTarget", () => {
  it("booked_cac carries the calibrated target, never the legacy targetCPA", () => {
    const out = resolveEconomicTarget({
      targetCostPerBooked: 100,
      targetCPA: 50,
      accountBookings: 20,
      accountConversions: 100,
    });
    expect(out.economicTier).toBe("booked_cac");
    expect(out.effectiveTarget).toBe(20); // 100 × 20/100 = 20, NOT targetCPA 50
  });
  it("does not select booked_cac when calibration cannot run (zero conversions)", () => {
    const out = resolveEconomicTarget({
      targetCostPerBooked: 100,
      targetCPA: 50,
      accountBookings: 15,
      accountConversions: 0,
    });
    expect(out.economicTier).not.toBe("booked_cac");
    expect(out.effectiveTarget).toBe(50);
  });
  it("uses targetCPA when no booked target is configured", () => {
    const out = resolveEconomicTarget({
      targetCPA: 50,
      accountBookings: 100,
      accountConversions: 200,
    });
    expect(out.economicTier).toBe("cpl");
    expect(out.effectiveTarget).toBe(50);
  });
});

describe("resolveEconomicTargetForCampaign (Hybrid ladder)", () => {
  const accountTarget: ResolvedEconomicTarget = { economicTier: "cpl", effectiveTarget: 50 };

  it("Tier-1: campaign clears the booking floor → campaign-specific calibrated target", () => {
    const out = resolveEconomicTargetForCampaign({
      campaignBookings: MIN_BOOKED_FOR_TIER1, // 10
      campaignConversions: 50,
      targetCostPerBooked: 200,
      accountTarget,
    });
    expect(out.targetSource).toBe("campaign");
    expect(out.economicTier).toBe("booked_cac");
    expect(out.effectiveTarget).toBe(40); // 200 × (10/50)
  });

  it("Tier-2: thin campaign (booked < floor) → account fallback, verbatim, tagged 'account'", () => {
    const out = resolveEconomicTargetForCampaign({
      campaignBookings: 3,
      campaignConversions: 50,
      targetCostPerBooked: 200,
      accountTarget,
    });
    expect(out.targetSource).toBe("account");
    expect(out.economicTier).toBe("cpl"); // delegated from accountTarget
    expect(out.effectiveTarget).toBe(50);
  });

  it("Tier-1 still resolves a CAC target with no booked value (resolver ignores trueROAS)", () => {
    const out = resolveEconomicTargetForCampaign({
      campaignBookings: 12,
      campaignConversions: 40,
      targetCostPerBooked: 100,
      accountTarget,
    });
    expect(out.targetSource).toBe("campaign");
    expect(out.effectiveTarget).toBe(30); // 100 × (12/40)
  });

  it("falls back to account when calibration cannot run (zero campaign conversions)", () => {
    const out = resolveEconomicTargetForCampaign({
      campaignBookings: 15,
      campaignConversions: 0,
      targetCostPerBooked: 100,
      accountTarget,
    });
    expect(out.targetSource).toBe("account");
    expect(out).toMatchObject(accountTarget);
  });

  it("falls back to account when no targetCostPerBooked is configured", () => {
    const out = resolveEconomicTargetForCampaign({
      campaignBookings: 20,
      campaignConversions: 40,
      accountTarget,
    });
    expect(out.targetSource).toBe("account");
    expect(out.effectiveTarget).toBe(50);
  });
});
