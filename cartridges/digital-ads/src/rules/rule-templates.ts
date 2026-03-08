// ---------------------------------------------------------------------------
// Rule Templates — Pre-built rule templates
// ---------------------------------------------------------------------------

import type { AutomatedRuleConfig } from "../optimization/types.js";

export const RULE_TEMPLATES: Record<string, AutomatedRuleConfig> = {
  pause_low_performers: {
    name: "Pause Low-Performing Ads",
    schedule: { type: "DAILY" },
    evaluation: {
      filters: [
        { field: "entity_type", operator: "EQUAL", value: "AD" },
        { field: "time_preset", operator: "EQUAL", value: "LAST_7_DAYS" },
      ],
      trigger: {
        type: "STATS_CHANGE",
        field: "cost_per_action_type:purchase",
        operator: "GREATER_THAN",
        value: 100,
      },
    },
    execution: { type: "PAUSE" },
  },
  scale_winners: {
    name: "Scale Winning Campaigns",
    schedule: { type: "DAILY" },
    evaluation: {
      filters: [
        { field: "entity_type", operator: "EQUAL", value: "CAMPAIGN" },
        { field: "time_preset", operator: "EQUAL", value: "LAST_7_DAYS" },
      ],
      trigger: {
        type: "STATS_CHANGE",
        field: "purchase_roas",
        operator: "GREATER_THAN",
        value: 3,
      },
    },
    execution: { type: "CHANGE_BUDGET", field: "daily_budget", value: 1.2 },
  },
  high_frequency_alert: {
    name: "High Frequency Alert",
    schedule: { type: "DAILY" },
    evaluation: {
      filters: [
        { field: "entity_type", operator: "EQUAL", value: "AD_SET" },
        { field: "time_preset", operator: "EQUAL", value: "LAST_3_DAYS" },
      ],
      trigger: {
        type: "STATS_CHANGE",
        field: "frequency",
        operator: "GREATER_THAN",
        value: 4,
      },
    },
    execution: { type: "SEND_NOTIFICATION" },
  },
  cpa_guard: {
    name: "CPA Guard",
    schedule: { type: "SEMI_HOURLY" },
    evaluation: {
      filters: [
        { field: "entity_type", operator: "EQUAL", value: "AD_SET" },
        { field: "time_preset", operator: "EQUAL", value: "TODAY" },
      ],
      trigger: {
        type: "STATS_CHANGE",
        field: "cost_per_action_type:lead",
        operator: "GREATER_THAN",
        value: 50,
      },
    },
    execution: { type: "PAUSE" },
  },
};

export function getRuleTemplate(id: string): AutomatedRuleConfig | undefined {
  return RULE_TEMPLATES[id];
}

export function listRuleTemplates(): Array<{ id: string; name: string; description: string }> {
  return Object.entries(RULE_TEMPLATES).map(([id, config]) => ({
    id,
    name: config.name,
    description: `${config.execution.type} when ${config.evaluation.trigger.field} ${config.evaluation.trigger.operator} ${config.evaluation.trigger.value}`,
  }));
}
