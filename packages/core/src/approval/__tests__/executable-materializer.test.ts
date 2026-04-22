import { describe, it, expect } from "vitest";
import { buildMaterializationInput } from "../executable-materializer.js";

describe("buildMaterializationInput", () => {
  const baseRevision = {
    id: "rev-1",
    lifecycleId: "lc-1",
    revisionNumber: 1,
    parametersSnapshot: { budget: 5000, target: "us-west" },
    approvalScopeSnapshot: { approvers: ["user-1"], riskCategory: "medium" },
    bindingHash: "a".repeat(64),
    rationale: null,
    supersedesRevisionId: null,
    createdBy: "user-1",
    createdAt: new Date(),
  };

  const baseWorkUnit = {
    id: "wu-1",
    intent: "campaign.pause",
    parameters: { budget: 5000, target: "us-west" },
    deployment: {
      deploymentId: "dep-1",
      skillSlug: "campaign",
      trustLevel: "supervised" as const,
      trustScore: 0,
    },
    resolvedMode: "skill" as const,
    actor: { id: "user-1", type: "user" as const },
    organizationId: "org-1",
    traceId: "trace-1",
    trigger: "api" as const,
    priority: "normal" as const,
    requestedAt: new Date().toISOString(),
  };

  const baseConstraints = { maxRetries: 3, timeoutMs: 30000 };

  it("produces a complete MaterializeWorkUnitInput", () => {
    const result = buildMaterializationInput({
      revision: baseRevision,
      workUnit: baseWorkUnit,
      actionEnvelopeId: "env-1",
      constraints: baseConstraints,
      executableUntilMs: 3600000,
    });

    expect(result.lifecycleId).toBe("lc-1");
    expect(result.approvalRevisionId).toBe("rev-1");
    expect(result.actionEnvelopeId).toBe("env-1");
    expect(result.frozenPayload).toEqual({
      intent: "campaign.pause",
      parameters: { budget: 5000, target: "us-west" },
      actor: { id: "user-1", type: "user" },
      organizationId: "org-1",
      resolvedMode: "skill",
      traceId: "trace-1",
    });
    expect(result.frozenBinding).toEqual({
      deploymentId: "dep-1",
      skillSlug: "campaign",
      trustLevel: "supervised",
      trustScore: 0,
    });
    expect(result.frozenExecutionPolicy).toEqual(baseConstraints);
    expect(result.executableUntil).toBeInstanceOf(Date);
  });

  it("uses revision parametersSnapshot for frozen payload, not workUnit parameters", () => {
    const modifiedWorkUnit = { ...baseWorkUnit, parameters: { budget: 99999 } };
    const result = buildMaterializationInput({
      revision: baseRevision,
      workUnit: modifiedWorkUnit,
      actionEnvelopeId: "env-1",
      constraints: baseConstraints,
      executableUntilMs: 3600000,
    });
    expect(result.frozenPayload.parameters).toEqual({ budget: 5000, target: "us-west" });
  });

  it("sets executableUntil based on executableUntilMs from now", () => {
    const before = Date.now();
    const result = buildMaterializationInput({
      revision: baseRevision,
      workUnit: baseWorkUnit,
      actionEnvelopeId: "env-1",
      constraints: baseConstraints,
      executableUntilMs: 60000,
    });
    const after = Date.now();
    expect(result.executableUntil.getTime()).toBeGreaterThanOrEqual(before + 60000);
    expect(result.executableUntil.getTime()).toBeLessThanOrEqual(after + 60000);
  });
});
