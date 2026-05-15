// Riley activity fixtures — adapted to the real TranslatedAction shape.
//
// TranslatedAction fields (from use-agent-activity.ts):
//   id, agentRole, text, icon, timestamp, eventType, entityType, entityId
//
// The plan skeleton used intent/summary/status/agentKey/actorKind/actorId/occurredAt —
// none of those exist on the real type. The mapping used here is:
//   intent   → eventType   (semantic event identifier)
//   summary  → text        (human-readable description)
//   status ok/acted/warn   → icon: "success"|"info"|"warning"  (closest icon values)
//   agentKey "riley"       → agentRole "riley"
//   actorKind/Id removed   → entityType/entityId used instead

import type { TranslatedAction } from "@/hooks/use-agent-activity";

function base(overrides: Partial<TranslatedAction>): TranslatedAction {
  return {
    id: "act_base",
    agentRole: "riley",
    text: "",
    icon: "info",
    timestamp: "2026-05-14T10:00:00.000Z",
    eventType: "system.daily_scan_started",
    entityType: "campaign",
    entityId: "entity_base",
    ...overrides,
  };
}

// --- System / watching fixtures ---

export const watchingFixture = base({
  id: "act_watching",
  eventType: "system.daily_scan_completed",
  text: "Daily scan complete — 14 campaigns reviewed.",
  icon: "success",
  entityId: "entity_scan",
});

export const reviewingFixture = base({
  id: "act_reviewing",
  eventType: "system.scoring_run_in_progress",
  text: "Scoring run in progress.",
  icon: "pending",
  entityId: "entity_scoring",
});

// --- Recommendation action fixtures (acted = success icon) ---

export const pausedFixture = base({
  id: "act_paused",
  eventType: "recommendation.pause",
  text: "Paused Cold Interests adset (Spring Sale).",
  icon: "success",
  entityId: "adset_cold_interests",
});

export const scaledFixture = base({
  id: "act_scaled",
  eventType: "recommendation.scale",
  text: "Scaled Lookalike 1% by $40/day.",
  icon: "success",
  entityId: "adset_lookalike_1pct",
});

export const rotatedFixture = base({
  id: "act_rotated",
  eventType: "recommendation.refresh_creative",
  text: "Refreshed Retargeting creative.",
  icon: "success",
  entityId: "adset_retargeting",
});

export const shiftedFixture = base({
  id: "act_shifted",
  eventType: "recommendation.shift_budget_to_source",
  text: "Shifted budget to Google.",
  icon: "success",
  entityId: "campaign_google",
});

export const restructuredFixture = base({
  id: "act_restructured",
  eventType: "recommendation.restructure",
  text: "Expanded targeting on Lookalike 1%.",
  icon: "success",
  entityId: "adset_lookalike_1pct",
});

// --- Signal fixtures ---

export const startedFixture = base({
  id: "act_started",
  eventType: "signal.learning_phase_active",
  text: "Learning phase active — 3–5 days.",
  icon: "info",
  entityId: "adset_new",
});

export const alertFixture = base({
  id: "act_alert",
  eventType: "signal.connection_health_degraded",
  text: "Pixel signal degraded.",
  icon: "warning",
  entityId: "pixel_main",
});

// Three-vocabulary drift coverage — same semantic event, different eventType spellings
export const vocabularyDriftFixtures: TranslatedAction[] = [
  base({
    id: "act_vocab_1",
    eventType: "recommendation.pause",
    text: "v1: pause",
    icon: "success",
    entityId: "entity_vocab_1",
  }),
  base({
    id: "act_vocab_2",
    eventType: "recommendation.pause_adset",
    text: "v2: pause_adset",
    icon: "success",
    entityId: "entity_vocab_2",
  }),
  base({
    id: "act_vocab_3",
    eventType: "recommendation.ad_set_pause",
    text: "v3: ad_set_pause",
    icon: "success",
    entityId: "entity_vocab_3",
  }),
];

export const ALL_RILEY_ACTIVITY_FIXTURES: TranslatedAction[] = [
  watchingFixture,
  reviewingFixture,
  pausedFixture,
  scaledFixture,
  rotatedFixture,
  shiftedFixture,
  restructuredFixture,
  startedFixture,
  alertFixture,
];
