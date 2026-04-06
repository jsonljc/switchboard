import { describe, it, expect } from "vitest";
import { createTestHarness, mockPersona } from "../index.js";
import type { AgentHandler } from "../../handler.js";

describe("createTestHarness", () => {
  const echoHandler: AgentHandler = {
    async onMessage(ctx) {
      const lastMsg = ctx.conversation?.messages.at(-1);
      await ctx.chat.send(`Echo: ${lastMsg?.content ?? "nothing"}`);
    },
  };

  it("creates a chat session and processes messages", async () => {
    const harness = createTestHarness({
      handler: echoHandler,
      persona: mockPersona({ businessName: "Test Co" }),
    });
    const session = harness.chat();
    await session.userSays("hello");
    expect(session.lastResponse).toBe("Echo: hello");
  });

  it("tracks messages sent", async () => {
    const harness = createTestHarness({
      handler: echoHandler,
      persona: mockPersona(),
    });
    const session = harness.chat();
    await session.userSays("one");
    await session.userSays("two");
    expect(session.messagesSent).toHaveLength(2);
  });

  it("provides working state store", async () => {
    const statefulHandler: AgentHandler = {
      async onMessage(ctx) {
        const count = (await ctx.state.get<number>("count")) ?? 0;
        await ctx.state.set("count", count + 1);
        await ctx.chat.send(`Count: ${count + 1}`);
      },
    };
    const harness = createTestHarness({
      handler: statefulHandler,
      persona: mockPersona(),
    });
    const session = harness.chat();
    await session.userSays("inc");
    await session.userSays("inc");
    expect(session.lastResponse).toBe("Count: 2");
    expect(await session.state.get("count")).toBe(2);
  });

  it("tracks handoffs", async () => {
    const handoffHandler: AgentHandler = {
      async onMessage(ctx) {
        await ctx.handoff("sales-closer", {
          reason: "qualified",
          context: { budget: 5000 },
        });
      },
    };
    const harness = createTestHarness({
      handler: handoffHandler,
      persona: mockPersona(),
    });
    const session = harness.chat();
    await session.userSays("I'm interested");
    expect(session.handoffs).toHaveLength(1);
    expect(session.handoffs[0]).toMatchObject({
      to: "sales-closer",
      reason: "qualified",
    });
  });

  it("tracks notifications", async () => {
    const notifyHandler: AgentHandler = {
      async onMessage(ctx) {
        await ctx.notify("Lead flagged for review");
      },
    };
    const harness = createTestHarness({
      handler: notifyHandler,
      persona: mockPersona(),
    });
    const session = harness.chat();
    await session.userSays("trigger");
    expect(session.notifications).toEqual(["Lead flagged for review"]);
  });

  it("simulates governance — supervised queues actions", async () => {
    const harness = createTestHarness({
      handler: echoHandler,
      persona: mockPersona(),
    });
    const session = harness.chat({ trustLevel: "supervised" });
    await session.userSays("hello");
    expect(session.pendingApprovals).toHaveLength(1);
    expect(session.messagesSent).toHaveLength(0);
  });

  it("simulates governance — autonomous executes immediately", async () => {
    const harness = createTestHarness({
      handler: echoHandler,
      persona: mockPersona(),
    });
    const session = harness.chat({ trustLevel: "autonomous" });
    await session.userSays("hello");
    expect(session.pendingApprovals).toHaveLength(0);
    expect(session.messagesSent).toHaveLength(1);
  });
});

describe("mockPersona", () => {
  it("returns a valid persona with defaults", () => {
    const persona = mockPersona();
    expect(persona.businessName).toBe("Test Business");
    expect(persona.tone).toBe("professional");
  });

  it("accepts overrides", () => {
    const persona = mockPersona({ businessName: "Bloom Flowers", tone: "casual" });
    expect(persona.businessName).toBe("Bloom Flowers");
    expect(persona.tone).toBe("casual");
  });
});
