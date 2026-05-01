import { describe, it, expect, vi } from "vitest";
import { createCrmWriteToolFactory } from "./crm-write.js";
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
});
