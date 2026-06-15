import { describe, it, expect } from "vitest";
import type { ConversationStore, Message, LifecycleStage } from "../conversation-store.js";

describe("ConversationStore interface", () => {
  it("can be implemented with an in-memory store", async () => {
    const history = new Map<string, Message[]>();
    const stages = new Map<string, LifecycleStage>();

    const store: ConversationStore = {
      async getHistory(contactId: string): Promise<Message[]> {
        return history.get(contactId) ?? [];
      },
      async appendMessage(contactId: string, message: Message): Promise<void> {
        const msgs = history.get(contactId) ?? [];
        msgs.push(message);
        history.set(contactId, msgs);
      },
      async getStage(contactId: string): Promise<LifecycleStage> {
        return stages.get(contactId) ?? "lead";
      },
      async setStage(contactId: string, stage: LifecycleStage): Promise<void> {
        stages.set(contactId, stage);
      },
    };

    await store.appendMessage("c1", {
      id: "m1",
      contactId: "c1",
      direction: "inbound",
      content: "Hello",
      timestamp: new Date().toISOString(),
      channel: "whatsapp",
    });
    const msgs = await store.getHistory("c1");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.content).toBe("Hello");

    expect(await store.getStage("c1")).toBe("lead");
    await store.setStage("c1", "qualified");
    expect(await store.getStage("c1")).toBe("qualified");
  });
});
