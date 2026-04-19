import { describe, it, expect, vi } from "vitest";
import { createCrmQueryTool } from "./crm-query.js";

const mockContactStore = {
  findById: vi.fn().mockResolvedValue({ id: "c1", name: "Alice", phone: "+1234" }),
};

const mockActivityStore = {
  listByDeployment: vi.fn().mockResolvedValue([{ id: "a1", eventType: "message" }]),
};

describe("crm-query tool", () => {
  const tool = createCrmQueryTool(mockContactStore, mockActivityStore);

  it("has correct id", () => {
    expect(tool.id).toBe("crm-query");
  });

  it("contact.get delegates to contactStore.findById", async () => {
    const result = await tool.operations["contact.get"]!.execute({
      contactId: "c1",
      orgId: "org1",
    });
    expect(mockContactStore.findById).toHaveBeenCalledWith("org1", "c1");
    expect(result.status).toBe("success");
    expect(result.data).toEqual({ id: "c1", name: "Alice", phone: "+1234" });
  });

  it("activity.list delegates to activityStore.listByDeployment", async () => {
    const result = await tool.operations["activity.list"]!.execute({
      orgId: "org1",
      deploymentId: "d1",
      limit: 10,
    });
    expect(mockActivityStore.listByDeployment).toHaveBeenCalledWith("org1", "d1", { limit: 10 });
    expect(result.status).toBe("success");
    expect((result.data as { activities: unknown[] }).activities).toHaveLength(1);
  });

  it("activity.list defaults limit to 20", async () => {
    await tool.operations["activity.list"]!.execute({
      orgId: "org1",
      deploymentId: "d1",
    });
    expect(mockActivityStore.listByDeployment).toHaveBeenCalledWith("org1", "d1", { limit: 20 });
  });

  it("has valid inputSchema for contact.get", () => {
    const schema = tool.operations["contact.get"]!.inputSchema as { required: string[] };
    expect(schema.required).toContain("contactId");
    expect(schema.required).toContain("orgId");
  });
});
