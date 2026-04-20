import { describe, it, expect, vi } from "vitest";
import { createCrmWriteTool } from "./crm-write.js";

const mockOpportunityStore = {
  updateStage: vi.fn().mockResolvedValue({ id: "o1", stage: "qualified" }),
};

const mockActivityStore = {
  write: vi.fn().mockResolvedValue(undefined),
};

describe("crm-write tool", () => {
  const tool = createCrmWriteTool(mockOpportunityStore, mockActivityStore);

  it("has correct id", () => {
    expect(tool.id).toBe("crm-write");
  });

  it("stage.update delegates to opportunityStore.updateStage", async () => {
    const result = await tool.operations["stage.update"]!.execute({
      orgId: "org1",
      opportunityId: "o1",
      stage: "qualified",
    });
    expect(mockOpportunityStore.updateStage).toHaveBeenCalledWith("org1", "o1", "qualified");
    expect(result.status).toBe("success");
    expect(result.data).toEqual({ id: "o1", stage: "qualified" });
    expect(result.entityState).toEqual({ opportunityId: "o1", stage: "qualified" });
  });

  it("activity.log delegates to activityStore.write", async () => {
    const result = await tool.operations["activity.log"]!.execute({
      organizationId: "org1",
      deploymentId: "d1",
      eventType: "opt-out",
      description: "Customer opted out",
    });
    expect(mockActivityStore.write).toHaveBeenCalledWith({
      organizationId: "org1",
      deploymentId: "d1",
      eventType: "opt-out",
      description: "Customer opted out",
    });
    expect(result.status).toBe("success");
    expect(result.entityState).toEqual({ eventType: "opt-out" });
  });

  it("stage.update has enum constraint in inputSchema", () => {
    const schema = tool.operations["stage.update"]!.inputSchema as {
      properties: Record<string, { enum?: string[] }>;
    };
    expect(schema.properties["stage"]?.enum).toContain("qualified");
    expect(schema.properties["stage"]?.enum).toContain("nurturing");
  });
});
