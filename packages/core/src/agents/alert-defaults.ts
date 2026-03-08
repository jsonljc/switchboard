// ---------------------------------------------------------------------------
// Alert Defaults — Default alert rules created during business onboarding
// ---------------------------------------------------------------------------
// Provides a list of default AlertRule templates and a factory function to
// create them in the database for a new organization.
// ---------------------------------------------------------------------------

export interface AlertRuleTemplate {
  name: string;
  metricPath: string;
  operator: string;
  threshold: number;
  cooldownMinutes: number;
  description: string;
}

/**
 * Default alert rules provisioned for every new business:
 * 1. Overspend — daily spend exceeds 120% of budget
 * 2. CPL spike — cost per lead jumps above 2x threshold
 * 3. Ad disapproved — any ad review failure
 * 4. No leads in 48h — lead generation stalls
 * 5. Budget exhaustion — campaign ran out of budget early
 */
export const DEFAULT_ALERT_TEMPLATES: AlertRuleTemplate[] = [
  {
    name: "Daily overspend",
    metricPath: "spend.budgetRatio",
    operator: "gt",
    threshold: 1.2,
    cooldownMinutes: 60 * 24, // Once per day
    description: "Triggers when daily spend exceeds 120% of the daily budget",
  },
  {
    name: "CPL spike",
    metricPath: "costPerLead.ratio",
    operator: "gt",
    threshold: 2.0,
    cooldownMinutes: 60 * 12, // 12h cooldown
    description: "Triggers when cost per lead exceeds 2x the vertical benchmark",
  },
  {
    name: "Ad disapproved",
    metricPath: "adReview.disapprovedCount",
    operator: "gt",
    threshold: 0,
    cooldownMinutes: 60, // 1h cooldown
    description: "Triggers when any ad is disapproved or rejected",
  },
  {
    name: "No leads in 48h",
    metricPath: "leads.hoursSinceLast",
    operator: "gt",
    threshold: 48,
    cooldownMinutes: 60 * 24, // Daily reminder
    description: "Triggers when no leads have been received for 48 hours",
  },
  {
    name: "Campaign budget exhausted",
    metricPath: "campaign.budgetExhausted",
    operator: "gt",
    threshold: 0,
    cooldownMinutes: 60 * 6, // 6h cooldown
    description: "Triggers when a campaign exhausts its budget early in the day",
  },
];

/**
 * Build alert rule records for a new organization.
 * Returns objects ready to be inserted into the database.
 */
export function buildDefaultAlertRules(
  organizationId: string,
  notifyChannels: string[],
  notifyRecipients: string[],
): Array<{
  organizationId: string;
  name: string;
  enabled: boolean;
  metricPath: string;
  operator: string;
  threshold: number;
  notifyChannels: string[];
  notifyRecipients: string[];
  cooldownMinutes: number;
}> {
  return DEFAULT_ALERT_TEMPLATES.map((template) => ({
    organizationId,
    name: template.name,
    enabled: true,
    metricPath: template.metricPath,
    operator: template.operator,
    threshold: template.threshold,
    notifyChannels,
    notifyRecipients,
    cooldownMinutes: template.cooldownMinutes,
  }));
}
