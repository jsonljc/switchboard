import type { Policy } from "@switchboard/schemas";

export const DEFAULT_PAYMENTS_POLICIES: Policy[] = [
  // Priority 1: Irreversible money outflow
  {
    id: "payments-refund-mandatory-approval",
    name: "Refunds Require Mandatory Approval",
    description: "All refunds require mandatory approval because they are irreversible money outflow",
    organizationId: null,
    cartridgeId: "payments",
    priority: 1,
    active: true,
    rule: {
      composition: "AND",
      conditions: [
        { field: "actionType", operator: "eq", value: "payments.refund.create" },
      ],
    },
    effect: "require_approval",
    approvalRequirement: "mandatory",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  // Priority 1: Revenue loss
  {
    id: "payments-subscription-cancel-mandatory-approval",
    name: "Subscription Cancellation Requires Mandatory Approval",
    description: "Subscription cancellations require mandatory approval due to revenue loss",
    organizationId: null,
    cartridgeId: "payments",
    priority: 1,
    active: true,
    rule: {
      composition: "AND",
      conditions: [
        { field: "actionType", operator: "eq", value: "payments.subscription.cancel" },
      ],
    },
    effect: "require_approval",
    approvalRequirement: "mandatory",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  // Priority 5: Blast radius multiplier
  {
    id: "payments-batch-elevated-approval",
    name: "Batch Operations Require Elevated Approval",
    description: "Batch invoicing requires elevated approval due to blast radius",
    organizationId: null,
    cartridgeId: "payments",
    priority: 5,
    active: true,
    rule: {
      composition: "AND",
      conditions: [
        { field: "actionType", operator: "eq", value: "payments.batch.invoice" },
      ],
    },
    effect: "require_approval",
    approvalRequirement: "elevated",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  // Priority 10: Dollar threshold
  {
    id: "payments-large-charge-elevated-approval",
    name: "Large Charges Require Elevated Approval",
    description: "Charges over $1000 require elevated approval",
    organizationId: null,
    cartridgeId: "payments",
    priority: 10,
    active: true,
    rule: {
      composition: "AND",
      conditions: [
        { field: "actionType", operator: "eq", value: "payments.charge.create" },
        { field: "parameters.amount", operator: "gt", value: 1000 },
      ],
    },
    effect: "require_approval",
    approvalRequirement: "elevated",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  // Priority 15: Deny charges to disputed customers
  {
    id: "payments-deny-disputed-customer",
    name: "Deny Charges to Disputed Customers",
    description: "Deny new charges to customers with open disputes",
    organizationId: null,
    cartridgeId: "payments",
    priority: 15,
    active: true,
    rule: {
      composition: "AND",
      conditions: [
        { field: "actionType", operator: "eq", value: "payments.charge.create" },
        { field: "metadata.hasOpenDispute", operator: "eq", value: true },
      ],
    },
    effect: "deny",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  // Priority 15: Escalate high-refund customers
  {
    id: "payments-high-refund-customer-escalation",
    name: "Escalate High-Refund Customers",
    description: "Require elevated approval for charges to customers with more than 3 previous refunds",
    organizationId: null,
    cartridgeId: "payments",
    priority: 15,
    active: true,
    rule: {
      composition: "AND",
      conditions: [
        { field: "actionType", operator: "eq", value: "payments.charge.create" },
        { field: "metadata.previousRefundCount", operator: "gt", value: 3 },
      ],
    },
    effect: "require_approval",
    approvalRequirement: "elevated",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  // Priority 20: Baseline gate for all charges
  {
    id: "payments-charge-standard-approval",
    name: "All Charges Require Standard Approval",
    description: "All charges require at least standard approval as a baseline gate",
    organizationId: null,
    cartridgeId: "payments",
    priority: 20,
    active: true,
    rule: {
      composition: "AND",
      conditions: [
        { field: "actionType", operator: "eq", value: "payments.charge.create" },
      ],
    },
    effect: "require_approval",
    approvalRequirement: "standard",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];
