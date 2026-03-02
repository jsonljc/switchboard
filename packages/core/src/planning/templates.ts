import type { PlanTemplate } from "./types.js";

/**
 * Plan templates as pure data — no code execution.
 * Each template maps to a GoalType and produces a DataFlowPlan.
 *
 * Binding syntax:
 *   $step[N]   — reference to step N's result
 *   $prev      — reference to previous step's result
 *   $entity    — entity graph resolution
 *   $goal      — goal brief fields
 */

export const PLAN_TEMPLATES: Record<string, PlanTemplate> = {
  optimizeLeads: {
    id: "optimizeLeads",
    name: "Optimize Lead Generation",
    goalTypes: ["optimize"],
    strategy: "sequential",
    approvalMode: "per_action",
    steps: [
      {
        stepType: "FETCH",
        actionPattern: "digital-ads.snapshot.fetch",
        parameterTemplate: {
          platform: "meta",
          entityId: "$goal.entityRefs.adAccount",
          periodDays: 7,
        },
        description: "Fetch current performance snapshot",
      },
      {
        stepType: "COMPUTE",
        actionPattern: "digital-ads.funnel.diagnose",
        parameterTemplate: {
          platform: "meta",
          entityId: "$goal.entityRefs.adAccount",
          vertical: "commerce",
          periodDays: 7,
        },
        description: "Analyze funnel performance",
      },
      {
        stepType: "DECIDE",
        actionPattern: "digital-ads.campaign.adjust_budget",
        parameterTemplate: {
          campaignRef: "$step[1].result.data.recommendations[0].campaignId",
          budgetChange: "$step[1].result.data.recommendations[0].budgetChange",
        },
        condition: "$step[1].result.data.recommendations.length > 0",
        description: "Adjust budget based on analysis",
      },
      {
        stepType: "LOG",
        actionPattern: "system.log",
        parameterTemplate: {
          event: "optimization_complete",
          snapshotStepIndex: 0,
          analysisStepIndex: 1,
          adjustmentStepIndex: 2,
        },
        description: "Log optimization outcome",
      },
    ],
  },

  investigate: {
    id: "investigate",
    name: "Investigate Performance Issue",
    goalTypes: ["investigate"],
    strategy: "sequential",
    approvalMode: "single_approval",
    steps: [
      {
        stepType: "FETCH",
        actionPattern: "digital-ads.snapshot.fetch",
        parameterTemplate: {
          platform: "meta",
          entityId: "$goal.entityRefs.adAccount",
          periodDays: 14,
        },
        description: "Fetch extended performance snapshot",
      },
      {
        stepType: "COMPUTE",
        actionPattern: "digital-ads.funnel.diagnose",
        parameterTemplate: {
          platform: "meta",
          entityId: "$goal.entityRefs.adAccount",
          vertical: "commerce",
          periodDays: 14,
        },
        description: "Run diagnostic analysis",
      },
      {
        stepType: "SUMMARIZE",
        actionPattern: "digital-ads.structure.analyze",
        parameterTemplate: {
          platform: "meta",
          entityId: "$goal.entityRefs.adAccount",
        },
        description: "Analyze campaign structure for issues",
      },
      {
        stepType: "LOG",
        actionPattern: "system.log",
        parameterTemplate: {
          event: "investigation_complete",
          findings: "$prev.result.data",
        },
        description: "Log investigation findings",
      },
    ],
  },

  executeSingle: {
    id: "executeSingle",
    name: "Execute Single Action",
    goalTypes: ["execute"],
    strategy: "sequential",
    approvalMode: "per_action",
    steps: [
      {
        stepType: "EXECUTE",
        actionPattern: "$goal.slots.actionType",
        parameterTemplate: {
          _passthrough: "$goal.slots",
        },
        description: "Execute the requested action",
      },
      {
        stepType: "LOG",
        actionPattern: "system.log",
        parameterTemplate: {
          event: "action_executed",
          result: "$prev.result",
        },
        description: "Log execution result",
      },
    ],
  },

  reportPerformance: {
    id: "reportPerformance",
    name: "Generate Performance Report",
    goalTypes: ["report"],
    strategy: "sequential",
    approvalMode: "single_approval",
    steps: [
      {
        stepType: "FETCH",
        actionPattern: "digital-ads.snapshot.fetch",
        parameterTemplate: {
          platform: "meta",
          entityId: "$goal.entityRefs.adAccount",
          periodDays: 7,
        },
        description: "Fetch performance data",
      },
      {
        stepType: "COMPUTE",
        actionPattern: "digital-ads.funnel.diagnose",
        parameterTemplate: {
          platform: "meta",
          entityId: "$goal.entityRefs.adAccount",
          vertical: "commerce",
          periodDays: 7,
        },
        description: "Compute performance metrics",
      },
      {
        stepType: "SUMMARIZE",
        actionPattern: "digital-ads.portfolio.diagnose",
        parameterTemplate: {
          platform: "meta",
          entityId: "$goal.entityRefs.adAccount",
          periodDays: 7,
        },
        description: "Generate portfolio summary",
      },
    ],
  },

  maintain: {
    id: "maintain",
    name: "Maintain Performance Target",
    goalTypes: ["maintain"],
    strategy: "sequential",
    approvalMode: "per_action",
    steps: [
      {
        stepType: "FETCH",
        actionPattern: "digital-ads.snapshot.fetch",
        parameterTemplate: {
          platform: "meta",
          entityId: "$goal.entityRefs.adAccount",
          periodDays: 3,
        },
        description: "Fetch recent performance",
      },
      {
        stepType: "COMPUTE",
        actionPattern: "digital-ads.funnel.diagnose",
        parameterTemplate: {
          platform: "meta",
          entityId: "$goal.entityRefs.adAccount",
          vertical: "commerce",
          periodDays: 3,
        },
        description: "Check against target constraints",
      },
      {
        stepType: "DECIDE",
        actionPattern: "digital-ads.campaign.adjust_budget",
        parameterTemplate: {
          campaignRef: "$step[1].result.data.recommendations[0].campaignId",
          budgetChange: "$step[1].result.data.recommendations[0].budgetChange",
        },
        condition: "$step[1].result.data.metrics.cpl > $goal.constraints[0].value",
        description: "Adjust if constraint violated",
      },
    ],
  },
};
