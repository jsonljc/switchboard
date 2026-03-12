// ---------------------------------------------------------------------------
// Revenue Growth Cartridge — Action Manifest
// ---------------------------------------------------------------------------

import type { ActionDefinition, CartridgeManifest } from "@switchboard/schemas";

export const REVENUE_GROWTH_ACTIONS: ActionDefinition[] = [
  {
    actionType: "revenue-growth.diagnostic.run",
    name: "Run Diagnostic Cycle",
    description:
      "Execute a full diagnostic cycle: collect data, run all scorers, identify the binding constraint, and propose an intervention.",
    parametersSchema: {
      accountId: { type: "string" },
      organizationId: { type: "string" },
    },
    baseRiskCategory: "none",
    reversible: false,
  },
  {
    actionType: "revenue-growth.diagnostic.latest",
    name: "Get Latest Diagnostic",
    description: "Retrieve the most recent diagnostic cycle results for an account.",
    parametersSchema: {
      accountId: { type: "string" },
    },
    baseRiskCategory: "none",
    reversible: false,
  },
  {
    actionType: "revenue-growth.connectors.status",
    name: "Check Connector Status",
    description: "Check the health and status of all data connectors for an account.",
    parametersSchema: {
      accountId: { type: "string" },
    },
    baseRiskCategory: "none",
    reversible: false,
  },
  {
    actionType: "revenue-growth.intervention.approve",
    name: "Approve Intervention",
    description: "Approve a proposed intervention for execution.",
    parametersSchema: {
      interventionId: { type: "string" },
    },
    baseRiskCategory: "low",
    reversible: false,
  },
  {
    actionType: "revenue-growth.intervention.defer",
    name: "Defer Intervention",
    description: "Defer a proposed intervention to a future cycle.",
    parametersSchema: {
      interventionId: { type: "string" },
      reason: { type: "string" },
    },
    baseRiskCategory: "none",
    reversible: false,
  },
  {
    actionType: "revenue-growth.digest.generate",
    name: "Generate Weekly Digest",
    description:
      "Generate a weekly digest summarizing diagnostic history, constraint transitions, and intervention outcomes.",
    parametersSchema: {
      accountId: { type: "string" },
    },
    baseRiskCategory: "none",
    reversible: false,
  },
  {
    actionType: "revenue-growth.intervention.execute",
    name: "Execute Intervention",
    description:
      "Transition an approved intervention to EXECUTING status and start measurement tracking.",
    parametersSchema: {
      interventionId: { type: "string" },
    },
    baseRiskCategory: "low",
    reversible: false,
  },
  {
    actionType: "revenue-growth.monitoring.check",
    name: "Run Monitoring Check",
    description:
      "Check all executing interventions for due monitoring checkpoints and detect anomalies.",
    parametersSchema: {
      accountId: { type: "string" },
      organizationId: { type: "string" },
    },
    baseRiskCategory: "none",
    reversible: false,
  },
  {
    actionType: "revenue-growth.creative.analyze-gaps",
    name: "Analyze Creative Gaps",
    description: "Evaluate the creative portfolio across 7 criteria and identify significant gaps.",
    parametersSchema: {
      accountId: { type: "string" },
      organizationId: { type: "string" },
    },
    baseRiskCategory: "none",
    reversible: false,
  },
  {
    actionType: "revenue-growth.creative.generate-strategy",
    name: "Generate Creative Strategy",
    description:
      "Generate a prioritized creative strategy with recommendations and test hypotheses.",
    parametersSchema: {
      accountId: { type: "string" },
      organizationId: { type: "string" },
    },
    baseRiskCategory: "none",
    reversible: false,
  },
  {
    actionType: "revenue-growth.creative.deploy-test",
    name: "Deploy Creative Test",
    description:
      "Run the full creative pipeline: analyze gaps, generate strategy, create images, review, and deploy a test campaign.",
    parametersSchema: {
      accountId: { type: "string" },
      organizationId: { type: "string" },
    },
    baseRiskCategory: "low",
    reversible: false,
  },
];

export const REVENUE_GROWTH_MANIFEST: CartridgeManifest = {
  id: "revenue-growth",
  name: "Revenue Growth",
  version: "0.1.0",
  description:
    "Cyclic constraint-based controller that identifies the primary constraint limiting revenue growth and proposes targeted interventions.",
  actions: REVENUE_GROWTH_ACTIONS,
  requiredConnections: ["digital-ads", "crm"],
  defaultPolicies: ["revenue-growth-diagnostic-auto-approve"],
};
