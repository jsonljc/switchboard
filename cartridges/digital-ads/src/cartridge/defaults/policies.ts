// ---------------------------------------------------------------------------
// Default Policies
// ---------------------------------------------------------------------------
// Governance policies for the digital-ads cartridge covering both
// read-only diagnostics and write mutations.
//
// Uses the Policy type from @switchboard/schemas so these can be passed
// directly to seedDefaultStorage().
// ---------------------------------------------------------------------------

import type { Policy } from "@switchboard/schemas";

/**
 * DEFAULT_DIGITAL_ADS_POLICIES — governance policies for the full cartridge.
 * These are seeded into the policy store at bootstrap time.
 */
export const DEFAULT_DIGITAL_ADS_POLICIES: Policy[] = [
  // Priority 5: Deny budget/targeting changes during learning phase
  {
    id: "digital-ads-deny-during-learning",
    name: "Digital Ads Deny During Learning Phase",
    description:
      "Deny budget and targeting changes when the entity is in LEARNING delivery status.",
    organizationId: null,
    cartridgeId: "digital-ads",
    priority: 5,
    active: true,
    rule: {
      composition: "AND",
      conditions: [
        {
          field: "actionType",
          operator: "in",
          value: [
            "digital-ads.campaign.adjust_budget",
            "digital-ads.adset.adjust_budget",
            "digital-ads.targeting.modify",
          ],
        },
        { field: "metadata.learningPhase", operator: "eq", value: true },
      ],
    },
    effect: "deny",
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  // Priority 10: Large budget increases require elevated approval
  {
    id: "digital-ads-large-budget-increase",
    name: "Digital Ads Large Budget Increase",
    description: "Budget adjustments over $5,000 require elevated approval.",
    organizationId: null,
    cartridgeId: "digital-ads",
    priority: 10,
    active: true,
    rule: {
      composition: "AND",
      conditions: [
        {
          field: "actionType",
          operator: "in",
          value: ["digital-ads.campaign.adjust_budget", "digital-ads.adset.adjust_budget"],
        },
        { field: "parameters.newBudget", operator: "gt", value: 5000 },
      ],
    },
    effect: "require_approval",
    approvalRequirement: "elevated",
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  // Priority 20: Pause/resume actions require standard approval
  {
    id: "digital-ads-pause-resume-approval",
    name: "Digital Ads Pause/Resume Approval",
    description: "Pause and resume actions require standard approval.",
    organizationId: null,
    cartridgeId: "digital-ads",
    priority: 20,
    active: true,
    rule: {
      composition: "AND",
      conditions: [
        {
          field: "actionType",
          operator: "in",
          value: [
            "digital-ads.campaign.pause",
            "digital-ads.campaign.resume",
            "digital-ads.adset.pause",
            "digital-ads.adset.resume",
          ],
        },
      ],
    },
    effect: "require_approval",
    approvalRequirement: "standard",
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  // Priority 20: Budget adjustments require standard approval
  {
    id: "digital-ads-budget-adjust-approval",
    name: "Digital Ads Budget Adjustment Approval",
    description: "All budget adjustments require standard approval.",
    organizationId: null,
    cartridgeId: "digital-ads",
    priority: 20,
    active: true,
    rule: {
      composition: "AND",
      conditions: [
        {
          field: "actionType",
          operator: "in",
          value: ["digital-ads.campaign.adjust_budget", "digital-ads.adset.adjust_budget"],
        },
      ],
    },
    effect: "require_approval",
    approvalRequirement: "standard",
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  // Priority 5: Deny bid/budget changes during learning phase
  {
    id: "digital-ads-deny-bid-during-learning",
    name: "Digital Ads Deny Bid Changes During Learning",
    description: "Deny bid strategy updates when the entity is in learning phase.",
    organizationId: null,
    cartridgeId: "digital-ads",
    priority: 5,
    active: true,
    rule: {
      composition: "AND",
      conditions: [
        { field: "actionType", operator: "in", value: ["digital-ads.bid.update_strategy"] },
        { field: "metadata.learningPhase", operator: "eq", value: true },
      ],
    },
    effect: "deny",
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  // Priority 8: Deny budget reallocation >30% shift
  {
    id: "digital-ads-deny-large-reallocation",
    name: "Digital Ads Deny Large Budget Reallocation",
    description: "Deny budget reallocation that shifts more than 30% of any campaign's budget.",
    organizationId: null,
    cartridgeId: "digital-ads",
    priority: 8,
    active: true,
    rule: {
      composition: "AND",
      conditions: [
        { field: "actionType", operator: "eq", value: "digital-ads.budget.reallocate" },
        { field: "parameters.maxShiftPercent", operator: "gt", value: 30 },
      ],
    },
    effect: "deny",
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  // Priority 10: Audience deletion requires elevated approval
  {
    id: "digital-ads-audience-delete-elevated",
    name: "Digital Ads Audience Deletion",
    description: "Audience deletion requires elevated approval — irreversible action.",
    organizationId: null,
    cartridgeId: "digital-ads",
    priority: 10,
    active: true,
    rule: {
      composition: "AND",
      conditions: [{ field: "actionType", operator: "eq", value: "digital-ads.audience.delete" }],
    },
    effect: "require_approval",
    approvalRequirement: "elevated",
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  // Priority 10: Campaign objective change requires elevated approval
  {
    id: "digital-ads-objective-change-elevated",
    name: "Digital Ads Objective Change",
    description: "Campaign objective changes require elevated approval — resets learning.",
    organizationId: null,
    cartridgeId: "digital-ads",
    priority: 10,
    active: true,
    rule: {
      composition: "AND",
      conditions: [
        { field: "actionType", operator: "eq", value: "digital-ads.campaign.update_objective" },
      ],
    },
    effect: "require_approval",
    approvalRequirement: "elevated",
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  // Priority 10: Experiments >$1000 require elevated approval
  {
    id: "digital-ads-experiment-high-budget",
    name: "Digital Ads High-Budget Experiment",
    description: "Experiments with total budget over $1,000 require elevated approval.",
    organizationId: null,
    cartridgeId: "digital-ads",
    priority: 10,
    active: true,
    rule: {
      composition: "AND",
      conditions: [
        { field: "actionType", operator: "eq", value: "digital-ads.experiment.create" },
        { field: "parameters.budget", operator: "gt", value: 1000 },
      ],
    },
    effect: "require_approval",
    approvalRequirement: "elevated",
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  // Priority 20: Rule creation requires standard approval
  {
    id: "digital-ads-rule-create-approval",
    name: "Digital Ads Rule Creation Approval",
    description: "Automated rule creation requires standard approval.",
    organizationId: null,
    cartridgeId: "digital-ads",
    priority: 20,
    active: true,
    rule: {
      composition: "AND",
      conditions: [
        {
          field: "actionType",
          operator: "in",
          value: ["digital-ads.rule.create", "digital-ads.rule.delete"],
        },
      ],
    },
    effect: "require_approval",
    approvalRequirement: "standard",
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  // Priority 20: Pacing auto-adjust requires standard approval
  {
    id: "digital-ads-pacing-adjust-approval",
    name: "Digital Ads Pacing Auto-Adjust Approval",
    description: "Pacing auto-adjust requires standard approval — modifies live campaign budgets.",
    organizationId: null,
    cartridgeId: "digital-ads",
    priority: 20,
    active: true,
    rule: {
      composition: "AND",
      conditions: [
        { field: "actionType", operator: "eq", value: "digital-ads.pacing.auto_adjust" },
      ],
    },
    effect: "require_approval",
    approvalRequirement: "standard",
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  // Priority 20: Catalog product set creation requires standard approval
  {
    id: "digital-ads-catalog-productset-approval",
    name: "Digital Ads Product Set Creation Approval",
    description: "Catalog product set creation requires standard approval.",
    organizationId: null,
    cartridgeId: "digital-ads",
    priority: 20,
    active: true,
    rule: {
      composition: "AND",
      conditions: [
        { field: "actionType", operator: "eq", value: "digital-ads.catalog.product_sets" },
      ],
    },
    effect: "require_approval",
    approvalRequirement: "standard",
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  // Priority 10: Lift study creation with high budget requires elevated approval
  {
    id: "digital-ads-lift-study-high-budget",
    name: "Digital Ads High-Budget Lift Study",
    description: "Lift study creation with budget over $5,000 requires elevated approval.",
    organizationId: null,
    cartridgeId: "digital-ads",
    priority: 10,
    active: true,
    rule: {
      composition: "AND",
      conditions: [
        { field: "actionType", operator: "eq", value: "digital-ads.measurement.lift_study.create" },
        { field: "parameters.budget", operator: "gt", value: 5000 },
      ],
    },
    effect: "require_approval",
    approvalRequirement: "elevated",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];
