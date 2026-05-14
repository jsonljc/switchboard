// apps/dashboard/src/lib/cockpit/riley/__fixtures__/riley-recommendation-fixtures.ts
//
// One fixture per Riley action variant + a multi-row signal-health scenario.
// All adapter tests pull from these.

import type { RecommendationApiRow } from "@/lib/api-client-types";

// Fixture parameters carry domain-specific keys (campaignId, urgency, breach, etc.)
// that the strict __recommendation type doesn't declare. Cast through unknown to
// preserve the data shape while satisfying the compiler.
function rec(data: Record<string, unknown>): RecommendationApiRow["parameters"] {
  return { __recommendation: data } as RecommendationApiRow["parameters"];
}

function baseRow(overrides: Partial<RecommendationApiRow>): RecommendationApiRow {
  return {
    id: "rec_base",
    orgId: "org_test",
    intent: "recommendation.pause",
    agentKey: "riley",
    humanSummary: "",
    dollarsAtRisk: 0,
    confidence: 0.8,
    riskLevel: "low",
    surface: "queue",
    status: "pending",
    action: "pause",
    parameters: rec({
      campaignId: "camp_001",
      learningPhaseImpact: "no impact",
      reversible: false,
      action: "pause",
      urgency: "immediate",
    }),
    targetEntities: {},
    sourceAgent: "riley",
    sourceWorkflow: null,
    actedBy: null,
    actedAt: null,
    note: null,
    createdAt: "2026-05-14T10:00:00.000Z",
    expiresAt: null,
    undoableUntil: null,
    ...overrides,
  };
}

export const pauseFixture = baseRow({
  id: "rec_pause_01",
  intent: "recommendation.pause",
  action: "pause",
  humanSummary: "CPL $42 vs $25 target for 3 days. Spend $680 at risk this week.",
  dollarsAtRisk: 680,
  confidence: 0.9,
  riskLevel: "high",
  targetEntities: { campaignName: "Spring Sale — Awareness", adSetName: "Cold Interests" },
  parameters: rec({
    campaignId: "camp_spring",
    learningPhaseImpact: "no impact",
    reversible: true,
    action: "pause",
    urgency: "immediate",
    presentation: {
      primaryLabel: "Pause adset",
      secondaryLabel: "Decline",
      dismissLabel: "Decline",
      dataLines: [],
    },
  }),
});

export const scaleFixture = baseRow({
  id: "rec_scale_01",
  intent: "recommendation.scale",
  action: "scale",
  humanSummary: "ROAS 3.2× sustained for 7 days; running under your daily cap. Suggest +$40/day.",
  dollarsAtRisk: 0,
  confidence: 0.7,
  riskLevel: "low",
  targetEntities: { campaignName: "Lookalike 1%" },
  parameters: rec({
    campaignId: "camp_lal1",
    learningPhaseImpact: "no impact",
    reversible: true,
    action: "scale",
    urgency: "this_week",
    presentation: {
      primaryLabel: "Scale +$40/day",
      secondaryLabel: "Decline",
      dismissLabel: "Decline",
      dataLines: [],
    },
  }),
});

export const refreshCreativeFixture = baseRow({
  id: "rec_refresh_01",
  intent: "recommendation.refresh_creative",
  action: "refresh_creative",
  humanSummary: "CTR down 38% over 5 days; same creative live 14 days. Three fresh variants ready.",
  dollarsAtRisk: 220,
  confidence: 0.85,
  riskLevel: "medium",
  targetEntities: { campaignName: "Retargeting — Hot" },
  parameters: rec({
    campaignId: "camp_retar",
    learningPhaseImpact: "will reset learning",
    reversible: false,
    action: "refresh_creative",
    urgency: "this_week",
    presentation: {
      primaryLabel: "Refresh creative",
      secondaryLabel: "Decline",
      dismissLabel: "Decline",
      dataLines: [],
    },
  }),
});

export const restructureFixture = baseRow({
  id: "rec_restructure_01",
  intent: "recommendation.restructure",
  action: "restructure",
  humanSummary: "Audience is saturated — expanding targeting will find new reach.",
  dollarsAtRisk: 150,
  confidence: 0.65,
  riskLevel: "medium",
  targetEntities: { campaignName: "Lookalike 1%" },
  parameters: rec({
    campaignId: "camp_lal1",
    learningPhaseImpact: "will reset learning",
    reversible: false,
    action: "restructure",
    urgency: "next_cycle",
    presentation: {
      primaryLabel: "Create expanded ad set",
      secondaryLabel: "Decline",
      dismissLabel: "Decline",
      dataLines: [],
    },
  }),
});

export const shiftBudgetFixture = baseRow({
  id: "rec_shift_01",
  intent: "recommendation.shift_budget_to_source",
  action: "shift_budget_to_source",
  humanSummary: "Google trueROAS is 2.4× Meta — consider shifting budget.",
  dollarsAtRisk: 0,
  confidence: 0.6,
  riskLevel: "low",
  targetEntities: { campaignName: "Multi-source · Hot" },
  parameters: rec({
    campaignId: "camp_multi",
    learningPhaseImpact: "no impact",
    reversible: false,
    action: "shift_budget_to_source",
    urgency: "this_week",
    presentation: {
      primaryLabel: "Shift to Google",
      secondaryLabel: "Decline",
      dismissLabel: "Decline",
      dataLines: [],
    },
  }),
});

export const switchEventFixture = baseRow({
  id: "rec_switch_01",
  intent: "recommendation.switch_optimization_event",
  action: "switch_optimization_event",
  humanSummary: "Optimizing on chat starts is attracting low-intent clickers — switch to Schedule.",
  dollarsAtRisk: 90,
  confidence: 0.75,
  riskLevel: "medium",
  targetEntities: { campaignName: "CTWA · Cold" },
  parameters: rec({
    campaignId: "camp_ctwa",
    learningPhaseImpact: "will reset learning",
    reversible: false,
    action: "switch_optimization_event",
    urgency: "this_week",
    presentation: {
      primaryLabel: "Switch to Schedule",
      secondaryLabel: "Decline",
      dismissLabel: "Decline",
      dataLines: [],
    },
  }),
});

export const hardenCapiFixture = baseRow({
  id: "rec_capi_01",
  intent: "recommendation.harden_capi_attribution",
  action: "harden_capi_attribution",
  humanSummary:
    "No CAPI Schedule events received in 7+ days — Meta cannot optimize without signal.",
  dollarsAtRisk: 0,
  confidence: 0.7,
  riskLevel: "medium",
  targetEntities: { campaignName: "Account-wide" },
  parameters: rec({
    campaignId: "account_capi",
    learningPhaseImpact: "no impact",
    reversible: false,
    action: "harden_capi_attribution",
    urgency: "this_week",
    externalUrl: "https://business.facebook.com/events_manager2/list/pixel/CAPI_SETUP",
    presentation: {
      primaryLabel: "Open CAPI settings",
      secondaryLabel: "Decline",
      dismissLabel: "Decline",
      dataLines: [],
    },
  }),
});

export const holdFixture = baseRow({
  id: "rec_hold_01",
  intent: "recommendation.hold",
  action: "hold",
  humanSummary: "Landing page issues are driving up costs — fix before increasing spend.",
  dollarsAtRisk: 110,
  confidence: 0.75,
  riskLevel: "medium",
  targetEntities: { campaignName: "Spring Sale — Awareness" },
  parameters: rec({
    campaignId: "camp_spring",
    learningPhaseImpact: "no impact",
    reversible: false,
    action: "hold",
    urgency: "this_week",
    presentation: {
      primaryLabel: "Hold budget changes",
      secondaryLabel: "Decline",
      dismissLabel: "Decline",
      dataLines: [],
    },
  }),
});

export const addCreativeFixture = baseRow({
  id: "rec_addc_01",
  intent: "recommendation.add_creative",
  action: "add_creative",
  humanSummary: "CPA significantly above target — add fresh creatives and reduce budget.",
  dollarsAtRisk: 480,
  confidence: 0.8,
  riskLevel: "high",
  targetEntities: { campaignName: "Retargeting — Cold" },
  parameters: rec({
    campaignId: "camp_retar_cold",
    learningPhaseImpact: "will reset learning",
    reversible: false,
    action: "add_creative",
    urgency: "this_week",
    presentation: {
      primaryLabel: "Approve plan",
      secondaryLabel: "Decline",
      dismissLabel: "Decline",
      dataLines: [],
    },
  }),
});

export const reviewBudgetFixture = baseRow({
  id: "rec_review_01",
  intent: "recommendation.review_budget",
  action: "review_budget",
  humanSummary: "Campaign appears above target CPA (1.8×). Review in Ads Manager.",
  dollarsAtRisk: 0,
  confidence: 0.65,
  riskLevel: "low",
  targetEntities: { campaignName: "Spring Sale — Awareness" },
  parameters: rec({
    campaignId: "camp_spring",
    learningPhaseImpact: "no impact",
    reversible: false,
    action: "review_budget",
    urgency: "this_week",
    externalUrl: "https://business.facebook.com/adsmanager/manage/campaigns?act=000",
    presentation: {
      primaryLabel: "Open in Ads Manager",
      secondaryLabel: "Decline",
      dismissLabel: "Decline",
      dataLines: [],
    },
  }),
});

// Signal-health: three rows for the same pixel — adapter must collapse to one card
export const signalHealthFixtures: RecommendationApiRow[] = [
  baseRow({
    id: "rec_sh_pixel_dead",
    intent: "recommendation.fix_signal_health",
    action: "fix_signal_health",
    humanSummary: "Pixel is dead — check website installation.",
    targetEntities: { pixelId: "1234567890" },
    parameters: rec({
      campaignId: "signal:1234567890",
      learningPhaseImpact: "no impact",
      reversible: false,
      action: "fix_signal_health",
      urgency: "immediate",
      breach: "pixel_dead",
      externalUrl: "https://business.facebook.com/events_manager2/list/pixel/1234567890",
      presentation: {
        primaryLabel: "Open Events Manager",
        secondaryLabel: "",
        dismissLabel: "Decline",
        dataLines: [],
      },
    }),
  }),
  baseRow({
    id: "rec_sh_s2b_low",
    intent: "recommendation.fix_signal_health",
    action: "fix_signal_health",
    humanSummary: "Server-to-browser ratio is below target — missing CAPI signal.",
    targetEntities: { pixelId: "1234567890" },
    parameters: rec({
      campaignId: "signal:1234567890",
      learningPhaseImpact: "no impact",
      reversible: false,
      action: "fix_signal_health",
      urgency: "this_week",
      breach: "server_to_browser_low",
      presentation: {
        primaryLabel: "Open Events Manager",
        secondaryLabel: "",
        dismissLabel: "Decline",
        dataLines: [],
      },
    }),
  }),
  baseRow({
    id: "rec_sh_freshness",
    intent: "recommendation.fix_signal_health",
    action: "fix_signal_health",
    humanSummary: "CAPI server events are stale — Meta's optimizer cannot react.",
    targetEntities: { pixelId: "1234567890" },
    parameters: rec({
      campaignId: "signal:1234567890",
      learningPhaseImpact: "no impact",
      reversible: false,
      action: "fix_signal_health",
      urgency: "this_week",
      breach: "freshness_stale",
      presentation: {
        primaryLabel: "Open Events Manager",
        secondaryLabel: "",
        dismissLabel: "Decline",
        dataLines: [],
      },
    }),
  }),
];

export const ALL_RILEY_FIXTURES = [
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
  ...signalHealthFixtures,
];
