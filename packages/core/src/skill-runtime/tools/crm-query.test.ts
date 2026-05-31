import { describe, it, expect, vi } from "vitest";
import { createCrmQueryToolFactory } from "./crm-query.js";
import type { SkillRequestContext } from "../types.js";

const CTX: SkillRequestContext = {
  sessionId: "s1",
  orgId: "org1",
  deploymentId: "d1",
  contactId: "c1",
};

function makeStores() {
  return {
    contactStore: {
      findById: vi.fn().mockResolvedValue({
        id: "c1",
        name: "Alice",
        phone: "+1234",
        email: "alice@example.com",
        stage: "new",
        source: "whatsapp",
      }),
    },
    activityStore: {
      listByDeployment: vi
        .fn()
        .mockResolvedValue([{ id: "a1", eventType: "message", description: "called +1234" }]),
    },
  };
}

describe("crm-query ctx-factory", () => {
  it("contact.get uses ctx.contactId/ctx.orgId, not model input", async () => {
    const stores = makeStores();
    const tool = createCrmQueryToolFactory(stores.contactStore, stores.activityStore)(CTX);
    // Model tries to supply a DIFFERENT contactId — it must be ignored.
    await tool.operations["contact.get"]!.execute({ contactId: "ATTACKER", orgId: "ATTACKER_ORG" });
    expect(stores.contactStore.findById).toHaveBeenCalledWith("org1", "c1");
  });

  it("contact.get output is redacted to {name, stage, source} — no phone/email/id", async () => {
    const stores = makeStores();
    const tool = createCrmQueryToolFactory(stores.contactStore, stores.activityStore)(CTX);
    const result = await tool.operations["contact.get"]!.execute({});
    expect(result.status).toBe("success");
    expect(result.data).toEqual({ name: "Alice", stage: "new", source: "whatsapp" });
    expect(JSON.stringify(result.data)).not.toContain("+1234");
    expect(JSON.stringify(result.data)).not.toContain("alice@example.com");
    expect(JSON.stringify(result.data)).not.toContain("c1");
  });

  it("contact.get fails closed when ctx.contactId is absent", async () => {
    const stores = makeStores();
    const tool = createCrmQueryToolFactory(
      stores.contactStore,
      stores.activityStore,
    )({
      ...CTX,
      contactId: undefined,
    });
    const result = await tool.operations["contact.get"]!.execute({});
    expect(result.status).not.toBe("success");
    expect(stores.contactStore.findById).not.toHaveBeenCalled();
  });

  it("contact.get inputSchema omits contactId and orgId", () => {
    const stores = makeStores();
    const tool = createCrmQueryToolFactory(stores.contactStore, stores.activityStore)(CTX);
    const schema = tool.operations["contact.get"]!.inputSchema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(schema.properties).not.toHaveProperty("contactId");
    expect(schema.properties).not.toHaveProperty("orgId");
    expect(schema.required).toHaveLength(0);
  });

  it("contact.get fails closed when the contact record is missing (findById returns null)", async () => {
    const stores = makeStores();
    stores.contactStore.findById.mockResolvedValue(null);
    const tool = createCrmQueryToolFactory(stores.contactStore, stores.activityStore)(CTX);
    const result = await tool.operations["contact.get"]!.execute({});
    expect(result.status).not.toBe("success");
  });

  it("activity.list uses ctx.orgId and drops the free-text description", async () => {
    const stores = makeStores();
    const tool = createCrmQueryToolFactory(stores.contactStore, stores.activityStore)(CTX);
    const result = await tool.operations["activity.list"]!.execute({
      deploymentId: "d1",
      limit: 5,
    });
    expect(stores.activityStore.listByDeployment).toHaveBeenCalledWith("org1", "d1", { limit: 5 });
    const activities = (result.data as { activities: Array<Record<string, unknown>> }).activities;
    expect(activities[0]).not.toHaveProperty("description");
    expect(JSON.stringify(result.data)).not.toContain("+1234");
  });
});
