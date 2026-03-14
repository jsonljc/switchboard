import { describe, it, expect } from "vitest";
import { FlowBuilder } from "../builder.js";

describe("FlowBuilder", () => {
  it("should build a minimal flow", () => {
    const flow = new FlowBuilder("test", "Test Flow")
      .describe("A test flow")
      .addMessage("greeting", "Hello!")
      .build();

    expect(flow.id).toBe("test");
    expect(flow.name).toBe("Test Flow");
    expect(flow.description).toBe("A test flow");
    expect(flow.steps).toHaveLength(1);
    expect(flow.steps[0]!.type).toBe("message");
  });

  it("should throw if no steps", () => {
    expect(() => new FlowBuilder("empty", "Empty").build()).toThrow(
      "Flow must have at least one step",
    );
  });

  it("should build a multi-step flow", () => {
    const flow = new FlowBuilder("qualify", "Qualification Flow")
      .addVariable("serviceInterest")
      .addMessage("greeting", "Welcome! What service are you interested in?")
      .addQuestion("service_q", "Pick a service:", ["Cleaning", "Whitening", "Checkup"])
      .addBranch("route", [
        { variable: "selectedOption", operator: "eq", value: 1, targetStepId: "cleaning_info" },
      ])
      .addAction("book", "appointment.book", { serviceId: "cleaning" })
      .addEscalate("escalate", "Complex case")
      .build();

    expect(flow.steps).toHaveLength(5);
    expect(flow.variables).toContain("serviceInterest");
    expect(flow.steps[1]!.options).toEqual(["Cleaning", "Whitening", "Checkup"]);
    expect(flow.steps[2]!.branches).toHaveLength(1);
    expect(flow.steps[3]!.actionType).toBe("appointment.book");
    expect(flow.steps[4]!.escalationReason).toBe("Complex case");
  });

  it("should add score and wait steps", () => {
    const flow = new FlowBuilder("scoring", "Scoring Flow")
      .addScore("compute_score")
      .addWait("wait_period", 60000)
      .addMessage("follow_up", "How are you?")
      .build();

    expect(flow.steps[0]!.type).toBe("score");
    expect(flow.steps[1]!.type).toBe("wait");
    expect(flow.steps[1]!.waitMs).toBe(60000);
  });

  it("should de-duplicate variables", () => {
    const flow = new FlowBuilder("test", "Test")
      .addVariable("name")
      .addVariable("name")
      .addMessage("m1", "Hi")
      .build();

    expect(flow.variables).toEqual(["name"]);
  });
});
