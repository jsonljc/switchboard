/**
 * Default guardrail configuration for the ad-operator role.
 * These are applied when no org-level override exists.
 */
export const defaultGuardrails = {
  /** Maximum single budget change as a percentage of current */
  maxBudgetChangePct: 25,
  /** Maximum single budget change in absolute dollars */
  maxBudgetChangeAbsolute: 1_000,
  /** Minimum campaign age in days before allowing pause */
  minCampaignAgeDaysForPause: 3,
  /** Require approval for budget changes above this threshold */
  budgetApprovalThreshold: 500,
  /** Blocked action types (always require escalation) */
  blockedActions: ["delete_campaign", "delete_ad_account"],
};
