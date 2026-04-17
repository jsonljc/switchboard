import { describe, it, expect } from "vitest";
import { toActionProposal, toEvaluationContext } from "../governance/work-unit-adapter.js";
import type { WorkUnit } from "../work-unit.js";
import type { IntentRegistration } from "../intent-registration.js";

function makeWorkUnit(overrides?: Partial<WorkUnit>): WorkUnit {
  return {
    id: "wu-1",
    requestedAt: "2026-04-16T00:00:00.000Z",
    organizationId: "org-1",
    actor: { id: "user-1", type: "user" },
    intent: "crm.deal.update",
    parameters: { dealId: "d-1", stage: "closed" },
    deployment: {
      deploymentId: "dep-1",
      skillSlug: "test-skill",
      trustLevel: "guided",
      trustScore: 42,
    },
    resolvedMode: "skill",
    traceId: "trace-1",
    trigger: "chat",
    priority: "normal",
    ...overrides,
  };
}

function makeRegistration(overrides?: Partial<IntentRegistration>): IntentRegistration {
  return {
    intent: "crm.deal.update",
    defaultMode: "skill",
    allowedModes: ["skill"],
    executor: { mode: "skill", skillSlug: "update-deal" },
    parameterSchema: {},
    mutationClass: "write",
    budgetClass: "standard",
    approvalPolicy: "none",
    idempotent: false,
    allowedTriggers: ["chat", "api"],
    timeoutMs: 30_000,
    retryable: false,
    ...overrides,
  };
}

describe("toActionProposal", () => {
  it("maps intent to actionType", () => {
    const wu = makeWorkUnit({ intent: "crm.contact.create" });
    const proposal = toActionProposal(wu, makeRegistration());
    expect(proposal.actionType).toBe("crm.contact.create");
  });

  it("passes parameters through", () => {
    const params = { dealId: "d-1", amount: 5000 };
    const wu = makeWorkUnit({ parameters: params });
    const proposal = toActionProposal(wu, makeRegistration());
    expect(proposal.parameters).toEqual(params);
  });

  it("sets stub fields for chat-domain compatibility", () => {
    const wu = makeWorkUnit();
    const proposal = toActionProposal(wu, makeRegistration());
    expect(proposal.evidence).toBe("platform-governance");
    expect(proposal.confidence).toBe(1);
    expect(proposal.originatingMessageId).toBe(wu.id);
  });
});

describe("toEvaluationContext", () => {
  it("builds all required fields", () => {
    const wu = makeWorkUnit();
    const reg = makeRegistration();
    const ctx = toEvaluationContext(wu, reg);

    expect(ctx.actionType).toBe("crm.deal.update");
    expect(ctx.parameters).toEqual(wu.parameters);
    expect(ctx.principalId).toBe("user-1");
    expect(ctx.organizationId).toBe("org-1");
    expect(ctx.riskCategory).toBe("medium");
    expect(ctx.metadata).toMatchObject({
      workUnitId: "wu-1",
      trigger: "chat",
      mutationClass: "write",
      budgetClass: "standard",
      approvalPolicy: "none",
    });
  });

  it("derives cartridgeId from executor binding for cartridge mode", () => {
    const reg = makeRegistration({
      executor: { mode: "cartridge", actionId: "crm-cartridge:update" },
    });
    const ctx = toEvaluationContext(makeWorkUnit(), reg);
    expect(ctx.cartridgeId).toBe("crm-cartridge:update");
  });

  it("falls back to intent as cartridgeId for non-cartridge modes", () => {
    const wu = makeWorkUnit({ intent: "crm.deal.update" });
    const reg = makeRegistration({
      executor: { mode: "skill", skillSlug: "update-deal" },
    });
    const ctx = toEvaluationContext(wu, reg);
    expect(ctx.cartridgeId).toBe("crm.deal.update");
  });

  it("maps read mutationClass to low risk", () => {
    const reg = makeRegistration({ mutationClass: "read" });
    const ctx = toEvaluationContext(makeWorkUnit(), reg);
    expect(ctx.riskCategory).toBe("low");
  });

  it("maps destructive mutationClass to high risk", () => {
    const reg = makeRegistration({ mutationClass: "destructive" });
    const ctx = toEvaluationContext(makeWorkUnit(), reg);
    expect(ctx.riskCategory).toBe("high");
  });
});
