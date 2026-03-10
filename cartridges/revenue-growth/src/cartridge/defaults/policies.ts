// ---------------------------------------------------------------------------
// Default Policies — Revenue Growth
// ---------------------------------------------------------------------------

import type { Policy } from "@switchboard/schemas";

export const DEFAULT_REVENUE_GROWTH_POLICIES: Policy[] = [
  // Diagnostic runs are read-only and auto-approved
  {
    id: "revenue-growth-diagnostic-auto-approve",
    name: "Revenue Growth Diagnostic Auto-Approve",
    description: "Diagnostic runs and connector checks are read-only and auto-approved.",
    organizationId: null,
    cartridgeId: "revenue-growth",
    priority: 1,
    active: true,
    rule: {
      composition: "OR",
      conditions: [
        {
          field: "actionType",
          operator: "in",
          value: [
            "revenue-growth.diagnostic.run",
            "revenue-growth.diagnostic.latest",
            "revenue-growth.connectors.status",
          ],
        },
      ],
    },
    effect: "allow",
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  // Intervention approvals require standard approval
  {
    id: "revenue-growth-intervention-approval",
    name: "Revenue Growth Intervention Approval Required",
    description: "Intervention approvals require human review before execution.",
    organizationId: null,
    cartridgeId: "revenue-growth",
    priority: 5,
    active: true,
    rule: {
      composition: "AND",
      conditions: [
        {
          field: "actionType",
          operator: "eq",
          value: "revenue-growth.intervention.approve",
        },
      ],
    },
    effect: "require_approval",
    approvalRequirement: "standard",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];
