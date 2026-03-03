import type { Policy } from "@switchboard/schemas";

export const DEFAULT_CRM_POLICIES: Policy[] = [
  // Priority 10: Contact updates require standard approval
  {
    id: "crm-contact-update-approval",
    name: "Contact Updates Require Standard Approval",
    description: "Contact updates need approval to prevent accidental data corruption",
    organizationId: null,
    cartridgeId: "crm",
    priority: 10,
    active: true,
    rule: {
      composition: "AND",
      conditions: [{ field: "actionType", operator: "eq", value: "crm.contact.update" }],
    },
    effect: "require_approval",
    approvalRequirement: "standard",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  // Priority 5: Large deals require elevated approval
  {
    id: "crm-large-deal-approval",
    name: "Large Deals Require Elevated Approval",
    description: "Deals over $10,000 require elevated approval",
    organizationId: null,
    cartridgeId: "crm",
    priority: 5,
    active: true,
    rule: {
      composition: "AND",
      conditions: [
        { field: "actionType", operator: "eq", value: "crm.deal.create" },
        { field: "parameters.amount", operator: "gt", value: 10000 },
      ],
    },
    effect: "require_approval",
    approvalRequirement: "elevated",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  // Priority 15: All deal creation requires at least standard approval
  {
    id: "crm-deal-create-approval",
    name: "Deal Creation Requires Standard Approval",
    description: "All deal creation requires at least standard approval as a baseline gate",
    organizationId: null,
    cartridgeId: "crm",
    priority: 15,
    active: true,
    rule: {
      composition: "AND",
      conditions: [{ field: "actionType", operator: "eq", value: "crm.deal.create" }],
    },
    effect: "require_approval",
    approvalRequirement: "standard",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];
