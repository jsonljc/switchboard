import { describe, it, expect, vi } from "vitest";
import { StateMachine } from "../machine.js";
import type { StateMachineConfig } from "../types.js";

type TestState = "idle" | "active" | "done";
type TestEvent = "start" | "finish" | "reset";
interface TestContext {
  value: number;
}

function createTestConfig(): StateMachineConfig<TestState, TestEvent, TestContext> {
  return {
    initialState: "idle",
    transitions: [
      { from: "idle", event: "start", to: "active" },
      { from: "active", event: "finish", to: "done" },
      { from: "done", event: "reset", to: "idle" },
      {
        from: "active",
        event: "reset",
        to: "idle",
        guard: (ctx) => ctx.value > 10,
      },
    ],
  };
}

describe("StateMachine", () => {
  it("should start in the initial state", () => {
    const machine = new StateMachine(createTestConfig());
    expect(machine.currentState).toBe("idle");
  });

  it("should transition on valid events", async () => {
    const machine = new StateMachine(createTestConfig());
    const result = await machine.transition("start", { value: 0 });
    expect(result.success).toBe(true);
    expect(result.previousState).toBe("idle");
    expect(result.currentState).toBe("active");
    expect(machine.currentState).toBe("active");
  });

  it("should reject transitions on invalid events", async () => {
    const machine = new StateMachine(createTestConfig());
    const result = await machine.transition("finish", { value: 0 });
    expect(result.success).toBe(false);
    expect(machine.currentState).toBe("idle");
  });

  it("should respect guards", async () => {
    const machine = new StateMachine(createTestConfig());
    await machine.transition("start", { value: 0 });

    // Guard should fail (value <= 10)
    const result1 = await machine.transition("reset", { value: 5 });
    expect(result1.success).toBe(false);
    expect(machine.currentState).toBe("active");

    // Guard should pass (value > 10)
    const result2 = await machine.transition("reset", { value: 15 });
    expect(result2.success).toBe(true);
    expect(machine.currentState).toBe("idle");
  });

  it("should fire onEnter and onExit callbacks", async () => {
    const onEnter = vi.fn();
    const onExit = vi.fn();

    const machine = new StateMachine<TestState, TestEvent, TestContext>({
      ...createTestConfig(),
      onEnter: { active: onEnter },
      onExit: { idle: onExit },
    });

    await machine.transition("start", { value: 0 });
    expect(onExit).toHaveBeenCalledWith("idle", { value: 0 });
    expect(onEnter).toHaveBeenCalledWith("active", { value: 0 });
  });

  it("should list valid events from current state", () => {
    const machine = new StateMachine(createTestConfig());
    expect(machine.validEvents()).toEqual(["start"]);

    machine.hydrate("active");
    expect(machine.validEvents()).toContain("finish");
    expect(machine.validEvents()).toContain("reset");
  });

  it("should support hydration", () => {
    const machine = new StateMachine(createTestConfig());
    machine.hydrate("done");
    expect(machine.currentState).toBe("done");
  });

  it("should handle multiple transitions in sequence", async () => {
    const machine = new StateMachine(createTestConfig());
    await machine.transition("start", { value: 0 });
    await machine.transition("finish", { value: 0 });
    await machine.transition("reset", { value: 0 });
    expect(machine.currentState).toBe("idle");
  });
});
