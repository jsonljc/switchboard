import { describe, it, expect } from "vitest";
import { validateFlowDefinition } from "../validator.js";
import type { FlowDefinition } from "@switchboard/schemas";

function makeFlow(overrides?: Partial<FlowDefinition>): FlowDefinition {
  return {
    id: "test",
    name: "Test Flow",
    description: "desc",
    steps: [
      { id: "s1", type: "message", template: "Hello" },
      { id: "s2", type: "question", template: "Pick one", options: ["A", "B"] },
    ],
    variables: [],
    ...overrides,
  };
}

describe("validateFlowDefinition", () => {
  it("should validate a correct flow", () => {
    const result = validateFlowDefinition(makeFlow());
    expect(result.valid).toBe(true);
    expect(result.issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("should detect duplicate step IDs", () => {
    const result = validateFlowDefinition(
      makeFlow({
        steps: [
          { id: "dup", type: "message", template: "A" },
          { id: "dup", type: "message", template: "B" },
        ],
      }),
    );
    expect(result.issues.some((i) => i.message === "Duplicate step ID")).toBe(true);
  });

  it("should detect invalid nextStepId references", () => {
    const result = validateFlowDefinition(
      makeFlow({
        steps: [{ id: "s1", type: "message", template: "Hi", nextStepId: "nonexistent" }],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("nonexistent"))).toBe(true);
  });

  it("should detect invalid branch target references", () => {
    const result = validateFlowDefinition(
      makeFlow({
        steps: [
          {
            id: "s1",
            type: "branch",
            branches: [{ variable: "x", operator: "eq", value: 1, targetStepId: "missing" }],
          },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("missing"))).toBe(true);
  });

  it("should detect missing template on message step", () => {
    const result = validateFlowDefinition(
      makeFlow({
        steps: [{ id: "s1", type: "message" }],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("template"))).toBe(true);
  });

  it("should detect missing branches on branch step", () => {
    const result = validateFlowDefinition(
      makeFlow({
        steps: [{ id: "s1", type: "branch" }],
      }),
    );
    expect(result.valid).toBe(false);
  });

  it("should warn on wait step without positive waitMs", () => {
    const result = validateFlowDefinition(
      makeFlow({
        steps: [{ id: "s1", type: "wait", waitMs: 0 }],
      }),
    );
    expect(
      result.issues.some((i) => i.severity === "warning" && i.message.includes("waitMs")),
    ).toBe(true);
  });

  it("should detect missing actionType on action step", () => {
    const result = validateFlowDefinition(
      makeFlow({
        steps: [{ id: "s1", type: "action" }],
      }),
    );
    expect(result.valid).toBe(false);
  });
});
