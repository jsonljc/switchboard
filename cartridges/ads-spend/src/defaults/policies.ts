import type { Policy } from "@switchboard/schemas";

export const DEFAULT_ADS_POLICIES: Policy[] = [
  {
    id: "ads-pause-resume-approval",
    name: "Pause/Resume Requires Standard Approval",
    description: "Pausing or resuming a campaign requires standard approval",
    organizationId: null,
    cartridgeId: "ads-spend",
    priority: 20,
    active: true,
    rule: {
      composition: "AND",
      conditions: [
        {
          field: "actionType",
          operator: "in",
          value: ["ads.campaign.pause", "ads.campaign.resume"],
        },
      ],
    },
    effect: "require_approval",
    approvalRequirement: "standard",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "ads-budget-adjust-approval",
    name: "Budget Adjustments Require Standard Approval",
    description: "All budget adjustments require at least standard approval",
    organizationId: null,
    cartridgeId: "ads-spend",
    priority: 20,
    active: true,
    rule: {
      composition: "AND",
      conditions: [
        { field: "actionType", operator: "eq", value: "ads.budget.adjust" },
      ],
    },
    effect: "require_approval",
    approvalRequirement: "standard",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "ads-large-budget-increase",
    name: "Large Budget Increase Requires Elevated Approval",
    description: "Budget increases over $5000 require elevated approval",
    organizationId: null,
    cartridgeId: "ads-spend",
    priority: 10,
    active: true,
    rule: {
      composition: "AND",
      conditions: [
        { field: "actionType", operator: "eq", value: "ads.budget.adjust" },
        { field: "parameters.newBudget", operator: "gt", value: 5000 },
      ],
    },
    effect: "require_approval",
    approvalRequirement: "elevated",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "ads-deny-during-learning",
    name: "Block Changes During Learning Phase",
    description: "Deny budget/targeting changes on campaigns in LEARNING delivery status",
    organizationId: null,
    cartridgeId: "ads-spend",
    priority: 5,
    active: true,
    rule: {
      composition: "AND",
      conditions: [
        {
          field: "actionType",
          operator: "in",
          value: ["ads.budget.adjust", "ads.targeting.modify"],
        },
        { field: "metadata.deliveryStatus", operator: "eq", value: "LEARNING" },
      ],
    },
    effect: "deny",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];
