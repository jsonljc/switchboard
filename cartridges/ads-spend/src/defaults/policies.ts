import type { Policy } from "@switchboard/schemas";

export const DEFAULT_ADS_POLICIES: Policy[] = [
  {
    id: "ads-large-budget-increase",
    name: "Large Budget Increase Requires Approval",
    description: "Budget increases over 50% require elevated approval",
    organizationId: null,
    cartridgeId: "ads-spend",
    priority: 10,
    active: true,
    rule: {
      composition: "AND",
      conditions: [
        { field: "actionType", operator: "eq", value: "ads.budget.adjust" },
        { field: "parameters.percentageChange", operator: "gt", value: 50 },
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
