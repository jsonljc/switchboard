import { describe, it, expect } from "vitest";
import type { AgentHandler, AgentContext } from "../index.js";

describe("AgentHandler type contracts", () => {
  it("accepts a handler with only onMessage", () => {
    const handler: AgentHandler = {
      async onMessage(_ctx: AgentContext) {
        // no-op
      },
    };
    expect(handler.onMessage).toBeDefined();
    expect(handler.onTask).toBeUndefined();
  });

  it("accepts a handler with all methods", () => {
    const handler: AgentHandler = {
      async onMessage(_ctx: AgentContext) {},
      async onTask(_ctx: AgentContext) {},
      async onSetup(_ctx: AgentContext) {},
      async onSchedule(_ctx: AgentContext) {},
      async onHandoff(_ctx: AgentContext) {},
    };
    expect(handler.onMessage).toBeDefined();
    expect(handler.onTask).toBeDefined();
    expect(handler.onSetup).toBeDefined();
    expect(handler.onSchedule).toBeDefined();
    expect(handler.onHandoff).toBeDefined();
  });
});
