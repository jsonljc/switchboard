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
          value: [
            "digital-ads.campaign.adjust_budget",
            "digital-ads.adset.adjust_budget",
          ],
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
          value: [
            "digital-ads.campaign.adjust_budget",
            "digital-ads.adset.adjust_budget",
          ],
        },
      ],
    },
    effect: "require_approval",
    approvalRequirement: "standard",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];
