import { describe, expect, it, vi } from "vitest";
import type { ExecutionConstraints } from "../governance-types.js";
import type { WorkUnit } from "../work-unit.js";
import { OperatorMutationMode } from "../modes/operator-mutation-mode.js";

const constraints: ExecutionConstraints = {
  allowedModelTiers: ["default"],
  maxToolCalls: 5,
  maxLlmTurns: 1,
  maxTotalTokens: 0,
  maxRuntimeMs: 30_000,
  maxWritesPerExecution: 5,
  trustLevel: "guided",
};

function makeWorkUnit(intent: string): WorkUnit {
  return {
    id: "wu_op_1",
    requestedAt: new Date().toISOString(),
    organizationId: "org_1",
    actor: { id: "operator_1", type: "user" },
    intent,
    parameters: { opportunityId: "opp_1", stage: "qualified" },
    deployment: {
      deploymentId: "dep_operator",
      skillSlug: "operator",
      trustLevel: "guided",
      trustScore: 100,
    },
    resolvedMode: "operator_mutation",
    traceId: "trace_op_1",
    trigger: "api",
    priority: "normal",
  };
}

describe("OperatorMutationMode", () => {
  it("dispatches to the registered handler and returns its outputs", async () => {
    const execute = vi.fn().mockResolvedValue({
      outcome: "completed",
      summary: "Opportunity stage transitioned",
      outputs: { opportunityId: "opp_1", stage: "qualified" },
    });

    const mode = new OperatorMutationMode({
      handlers: new Map([["operator.transition_opportunity_stage", { execute }]]),
    });

    const result = await mode.execute(
      makeWorkUnit("operator.transition_opportunity_stage"),
      constraints,
      {
        traceId: "trace_op_1",
        governanceDecision: {
          outcome: "execute",
          riskScore: 0,
          budgetProfile: "cheap",
          constraints,
          matchedPolicies: [],
        },
      },
    );

    expect(execute).toHaveBeenCalledOnce();
    expect(result.outcome).toBe("completed");
    expect(result.mode).toBe("operator_mutation");
    expect(result.outputs).toEqual({ opportunityId: "opp_1", stage: "qualified" });
  });

  it("returns a failed execution result when no handler is registered", async () => {
    const mode = new OperatorMutationMode({ handlers: new Map() });

    const result = await mode.execute(makeWorkUnit("operator.unknown"), constraints, {
      traceId: "trace_op_1",
      governanceDecision: {
        outcome: "execute",
        riskScore: 0,
        budgetProfile: "cheap",
        constraints,
        matchedPolicies: [],
      },
    });

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("OPERATOR_MUTATION_NOT_REGISTERED");
  });

  it("propagates handler-returned failed outcomes with error details", async () => {
    const execute = vi.fn().mockResolvedValue({
      outcome: "failed",
      summary: "Opportunity not found",
      error: { code: "OPPORTUNITY_NOT_FOUND", message: "No opportunity with id opp_missing" },
    });
    const mode = new OperatorMutationMode({
      handlers: new Map([["operator.transition_opportunity_stage", { execute }]]),
    });

    const result = await mode.execute(
      makeWorkUnit("operator.transition_opportunity_stage"),
      constraints,
      {
        traceId: "trace_op_1",
        governanceDecision: {
          outcome: "execute",
          riskScore: 0,
          budgetProfile: "cheap",
          constraints,
          matchedPolicies: [],
        },
      },
    );

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("OPPORTUNITY_NOT_FOUND");
  });

  it("registers under the operator_mutation execution mode name", () => {
    const mode = new OperatorMutationMode({ handlers: new Map() });
    expect(mode.name).toBe("operator_mutation");
  });
});
