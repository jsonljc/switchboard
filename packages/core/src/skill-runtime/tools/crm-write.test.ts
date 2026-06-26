import { describe, it, expect, vi } from "vitest";
import { createCrmWriteToolFactory } from "./crm-write.js";
import { getToolGovernanceDecision } from "../governance.js";
import { StaleVersionError } from "../../approval/state-machine.js";
import type { SkillRequestContext } from "../types.js";

const TRUSTED_CTX: SkillRequestContext = {
  sessionId: "sess_1",
  orgId: "org_trusted",
  deploymentId: "dep_trusted",
};

describe("crm-write tool factory", () => {
  function setup() {
    const opportunityStore = {
      updateStage: vi.fn().mockResolvedValue({ id: "o1", stage: "qualified" }),
    };
    const activityStore = {
      write: vi.fn().mockResolvedValue(undefined),
    };
    const factory = createCrmWriteToolFactory(opportunityStore, activityStore);
    const tool = factory(TRUSTED_CTX);
    return { tool, opportunityStore, activityStore };
  }

  it("has correct id", () => {
    const { tool } = setup();
    expect(tool.id).toBe("crm-write");
  });

  it("stage.update inputSchema does NOT contain orgId", () => {
    const { tool } = setup();
    const schema = tool.operations["stage.update"]!.inputSchema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(schema.properties).not.toHaveProperty("orgId");
    expect(schema.required).not.toContain("orgId");
  });

  it("activity.log inputSchema does NOT contain organizationId or deploymentId", () => {
    const { tool } = setup();
    const schema = tool.operations["activity.log"]!.inputSchema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(schema.properties).not.toHaveProperty("organizationId");
    expect(schema.properties).not.toHaveProperty("deploymentId");
    expect(schema.required).not.toContain("organizationId");
    expect(schema.required).not.toContain("deploymentId");
  });

  it("stage.update delegates to opportunityStore.updateStage with ctx.orgId", async () => {
    const { tool, opportunityStore } = setup();
    const result = await tool.operations["stage.update"]!.execute({
      opportunityId: "o1",
      stage: "qualified",
    });
    expect(opportunityStore.updateStage).toHaveBeenCalledWith("org_trusted", "o1", "qualified");
    expect(result.status).toBe("success");
    expect(result.data).toEqual({ id: "o1", stage: "qualified" });
    expect(result.entityState).toEqual({ opportunityId: "o1", stage: "qualified" });
  });

  it("stage.update ignores LLM-supplied orgId (AI-1 hardening)", async () => {
    const { tool, opportunityStore } = setup();
    await tool.operations["stage.update"]!.execute({
      orgId: "evil-org",
      opportunityId: "o1",
      stage: "qualified",
    });
    // Trusted ctx wins over LLM input
    expect(opportunityStore.updateStage).toHaveBeenCalledWith("org_trusted", "o1", "qualified");
  });

  it("activity.log delegates to activityStore.write using ctx-derived org/deployment", async () => {
    const { tool, activityStore } = setup();
    const result = await tool.operations["activity.log"]!.execute({
      eventType: "opt-out",
      description: "Customer opted out",
    });
    expect(activityStore.write).toHaveBeenCalledWith({
      organizationId: "org_trusted",
      deploymentId: "dep_trusted",
      eventType: "opt-out",
      description: "Customer opted out",
    });
    expect(result.status).toBe("success");
    expect(result.entityState).toEqual({ eventType: "opt-out" });
  });

  it("activity.log ignores LLM-supplied organizationId / deploymentId", async () => {
    const { tool, activityStore } = setup();
    await tool.operations["activity.log"]!.execute({
      organizationId: "evil-org",
      deploymentId: "evil-dep",
      eventType: "opt-out",
      description: "Customer opted out",
    });
    expect(activityStore.write).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_trusted",
        deploymentId: "dep_trusted",
      }),
    );
  });

  it("stage.update has enum constraint in inputSchema", () => {
    const { tool } = setup();
    const schema = tool.operations["stage.update"]!.inputSchema as {
      properties: Record<string, { enum?: string[] }>;
    };
    expect(schema.properties["stage"]?.enum).toContain("qualified");
    expect(schema.properties["stage"]?.enum).toContain("nurturing");
  });

  // P1-A: Alex is instructed to advance the pipeline stage (SKILL.md Phase 2,
  // interested -> qualified). At the default "supervised" trust a "write" maps to
  // require-approval and the in-skill GovernanceHook short-circuits before
  // execute() — so the stage silently never moves while Alex tells the lead
  // they're qualified, and the cockpit/pipeline disagree with the conversation. A
  // scoped override auto-approves stage.update at supervised.
  it("stage.update auto-approves at the default 'supervised' trust so the pipeline stage actually advances", () => {
    const { tool } = setup();
    expect(getToolGovernanceDecision(tool.operations["stage.update"]!, "supervised")).toBe(
      "auto-approve",
    );
  });

  // P1-A: when a booking dead-ends, Alex's fallback is to log a failed-attempt
  // activity via crm-write.activity.log so the operator has a durable record. At
  // the default "supervised" trust a "write" maps to require-approval and the
  // in-skill GovernanceHook short-circuits before execute() — so the fallback
  // record is silently swallowed too. A scoped override auto-approves the
  // activity-log fallback at supervised (parity with escalate).
  it("activity.log auto-approves at the default 'supervised' trust so the failed-attempt fallback is recorded", () => {
    const { tool } = setup();
    expect(getToolGovernanceDecision(tool.operations["activity.log"]!, "supervised")).toBe(
      "auto-approve",
    );
  });
});

// P2-6 RESILIENCE: an LLM-supplied opportunityId that points at a deleted row or
// another deployment's opportunity makes the store's org-scoped updateMany match
// zero rows and throw StaleVersionError. Without a try/catch that throw propagates
// through the skill executor and kills the whole Alex turn. The recoverable fix:
// classify the not-found/foreign case as a structured fail and keep the turn
// alive, while a genuine store/infra error still propagates so it escalates.
describe("crm-write stage.update resilience (P2-6)", () => {
  function setupWithUpdateStage(updateStage: ReturnType<typeof vi.fn>) {
    const opportunityStore = { updateStage };
    const activityStore = { write: vi.fn().mockResolvedValue(undefined) };
    const tool = createCrmWriteToolFactory(opportunityStore, activityStore)(TRUSTED_CTX);
    return { tool, opportunityStore, activityStore };
  }

  it("returns a recoverable fail (not a thrown turn-kill) on a deleted/foreign opportunityId", async () => {
    const { tool, opportunityStore } = setupWithUpdateStage(
      vi.fn().mockRejectedValue(new StaleVersionError("o-gone", -1, -1)),
    );
    const result = await tool.operations["stage.update"]!.execute({
      opportunityId: "o-gone",
      stage: "qualified",
    });
    // org-scoped: the trusted ctx org reached the store
    expect(opportunityStore.updateStage).toHaveBeenCalledWith("org_trusted", "o-gone", "qualified");
    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("OPPORTUNITY_NOT_FOUND");
    // a gone/foreign id will not succeed on retry; guide the model, do not loop
    expect(result.error?.retryable).toBe(false);
    expect(result.error?.modelRemediation).toBeTruthy();
  });

  it("re-throws a genuine store/infra error so it still escalates (not swallowed)", async () => {
    const { tool } = setupWithUpdateStage(
      vi.fn().mockRejectedValue(new Error("connection terminated unexpectedly")),
    );
    await expect(
      tool.operations["stage.update"]!.execute({ opportunityId: "o1", stage: "qualified" }),
    ).rejects.toThrow("connection terminated unexpectedly");
  });
});
