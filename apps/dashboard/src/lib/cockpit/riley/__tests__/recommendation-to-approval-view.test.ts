// apps/dashboard/src/lib/cockpit/riley/__tests__/recommendation-to-approval-view.test.ts

import { describe, it, expect } from "vitest";
import type { RecommendationApiRow } from "@/lib/api-client-types";
import {
  recommendationToApprovalView,
  mapRecommendationsToApprovalViews,
} from "../recommendation-to-approval-view";
import {
  pauseFixture,
  scaleFixture,
  refreshCreativeFixture,
  restructureFixture,
  shiftBudgetFixture,
  switchEventFixture,
  hardenCapiFixture,
  holdFixture,
  addCreativeFixture,
  reviewBudgetFixture,
} from "../__fixtures__/riley-recommendation-fixtures";

// Helper to read presentation fields via cast (they live in __recommendation)
function pres(row: RecommendationApiRow) {
  return (row.parameters.__recommendation as Record<string, unknown>)?.presentation as
    | { primaryLabel: string; dismissLabel: string }
    | undefined;
}

function rileyParams(row: RecommendationApiRow) {
  return row.parameters.__recommendation as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Per-fixture single-row assertions
// ---------------------------------------------------------------------------

const SINGLE_FIXTURES = [
  {
    name: "pause",
    fixture: pauseFixture,
    kind: "pause",
    urgency: "immediate",
  },
  {
    name: "scale",
    fixture: scaleFixture,
    kind: "scale",
    urgency: "this_week",
  },
  {
    name: "refresh_creative",
    fixture: refreshCreativeFixture,
    kind: "refresh_creative",
    urgency: "this_week",
  },
  {
    name: "restructure",
    fixture: restructureFixture,
    kind: "restructure",
    urgency: "next_cycle",
  },
  {
    name: "shift_budget_to_source",
    fixture: shiftBudgetFixture,
    kind: "shift_budget_to_source",
    urgency: "this_week",
  },
  {
    name: "switch_optimization_event",
    fixture: switchEventFixture,
    kind: "switch_optimization_event",
    urgency: "this_week",
  },
  {
    name: "harden_capi_attribution",
    fixture: hardenCapiFixture,
    kind: "harden_capi_attribution",
    urgency: "this_week",
  },
  {
    name: "hold",
    fixture: holdFixture,
    kind: "hold",
    urgency: "this_week",
  },
  {
    name: "add_creative",
    fixture: addCreativeFixture,
    kind: "add_creative",
    urgency: "this_week",
  },
  {
    name: "review_budget",
    fixture: reviewBudgetFixture,
    kind: "review_budget",
    urgency: "this_week",
  },
] as const;

describe("recommendationToApprovalView — per-fixture", () => {
  describe.each(SINGLE_FIXTURES)("$name", ({ fixture, kind, urgency }) => {
    it("maps kind correctly", () => {
      const view = recommendationToApprovalView(fixture);
      expect(view).not.toBeNull();
      expect(view!.kind).toBe(kind);
    });

    it("maps urgency correctly", () => {
      const view = recommendationToApprovalView(fixture);
      expect(view!.urgency).toBe(urgency);
    });

    it("quote === humanSummary", () => {
      const view = recommendationToApprovalView(fixture);
      expect(view!.quote).toBe(fixture.humanSummary);
    });

    it("primary matches presentation.primaryLabel", () => {
      const view = recommendationToApprovalView(fixture);
      const p = pres(fixture);
      expect(view!.primary).toBe(p?.primaryLabel ?? "");
    });

    it("askedAt is a non-empty string", () => {
      const view = recommendationToApprovalView(fixture);
      expect(typeof view!.askedAt).toBe("string");
      expect(view!.askedAt.length).toBeGreaterThan(0);
    });

    it("confidence matches fixture.confidence", () => {
      const view = recommendationToApprovalView(fixture);
      expect(view!.confidence).toBe(fixture.confidence);
    });

    it("learningPhaseImpact matches", () => {
      const view = recommendationToApprovalView(fixture);
      const params = rileyParams(fixture);
      expect(view!.learningPhaseImpact).toBe(params.learningPhaseImpact);
    });

    it("reversible matches", () => {
      const view = recommendationToApprovalView(fixture);
      const params = rileyParams(fixture);
      expect(view!.reversible).toBe(params.reversible);
    });
  });
});

// ---------------------------------------------------------------------------
// Null-return cases
// ---------------------------------------------------------------------------

describe("recommendationToApprovalView — null cases", () => {
  it("returns null for a row missing __recommendation", () => {
    const row: RecommendationApiRow = {
      ...pauseFixture,
      id: "rec_no_params",
      parameters: {},
    };
    expect(recommendationToApprovalView(row)).toBeNull();
  });

  it("returns null for a signal-health row (campaignId starts with 'signal:')", () => {
    const row: RecommendationApiRow = {
      ...pauseFixture,
      id: "rec_signal",
      parameters: {
        __recommendation: {
          action: "fix_signal_health",
          campaignId: "signal:1234567890",
          urgency: "immediate",
        } as Record<string, unknown>,
      } as RecommendationApiRow["parameters"],
    };
    expect(recommendationToApprovalView(row)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Risk string formatting
// ---------------------------------------------------------------------------

describe("recommendationToApprovalView — risk field", () => {
  it('pause view.risk includes "$680"', () => {
    const view = recommendationToApprovalView(pauseFixture);
    expect(view!.risk).toContain("$680");
  });

  it('hold view.risk includes "$110"', () => {
    const view = recommendationToApprovalView(holdFixture);
    expect(view!.risk).toContain("$110");
  });

  it("scale view has no risk string (dollarsAtRisk === 0)", () => {
    const view = recommendationToApprovalView(scaleFixture);
    expect(view!.risk).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// primaryAction shape
// ---------------------------------------------------------------------------

describe("recommendationToApprovalView — primaryAction", () => {
  it('review_budget has primaryAction.kind === "external"', () => {
    const view = recommendationToApprovalView(reviewBudgetFixture);
    expect(view!.primaryAction.kind).toBe("external");
  });

  it('harden_capi_attribution has primaryAction.kind === "external"', () => {
    const view = recommendationToApprovalView(hardenCapiFixture);
    expect(view!.primaryAction.kind).toBe("external");
  });

  it('pause has primaryAction.kind === "internal" with intent "recommendation.pause"', () => {
    const view = recommendationToApprovalView(pauseFixture);
    expect(view!.primaryAction.kind).toBe("internal");
    if (view!.primaryAction.kind === "internal") {
      expect(view!.primaryAction.intent).toBe("recommendation.pause");
    }
  });
});

// ---------------------------------------------------------------------------
// campaign field
// ---------------------------------------------------------------------------

describe("recommendationToApprovalView — campaign", () => {
  it('pause has campaign.kind === "campaign" with name "Spring Sale — Awareness"', () => {
    const view = recommendationToApprovalView(pauseFixture);
    expect(view!.campaign.kind).toBe("campaign");
    if (view!.campaign.kind === "campaign") {
      expect(view!.campaign.name).toBe("Spring Sale — Awareness");
    }
  });
});

// ---------------------------------------------------------------------------
// mapRecommendationsToApprovalViews — sorting
// ---------------------------------------------------------------------------

describe("mapRecommendationsToApprovalViews — sort order", () => {
  it("sorts urgency: immediate before this_week before next_cycle", () => {
    const views = mapRecommendationsToApprovalViews([
      restructureFixture, // next_cycle
      scaleFixture, // this_week
      pauseFixture, // immediate
    ]);
    expect(views[0].urgency).toBe("immediate");
    expect(views[1].urgency).toBe("this_week");
    expect(views[2].urgency).toBe("next_cycle");
  });

  it("within urgency band sorts by dollarsAtRisk desc: addCreative ($480) > refreshCreative ($220) > hold ($110)", () => {
    const views = mapRecommendationsToApprovalViews([
      holdFixture, // this_week, $110
      refreshCreativeFixture, // this_week, $220
      addCreativeFixture, // this_week, $480
    ]);
    // All are this_week; sort by risk desc
    const risks = views.map((v) => (v.risk ? parseInt(v.risk.replace(/[^0-9]/g, ""), 10) : 0));
    expect(risks[0]).toBeGreaterThanOrEqual(risks[1]);
    expect(risks[1]).toBeGreaterThanOrEqual(risks[2]);
    // Verify specific order
    expect(views[0].id).toBe(addCreativeFixture.id);
    expect(views[1].id).toBe(refreshCreativeFixture.id);
    expect(views[2].id).toBe(holdFixture.id);
  });
});
