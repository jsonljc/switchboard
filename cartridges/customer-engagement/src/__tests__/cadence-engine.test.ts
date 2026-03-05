// ---------------------------------------------------------------------------
// Tests: Cadence Engine
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { evaluateCadenceStep } from "../cadence/engine.js";
import type { CadenceDefinition, CadenceInstance } from "../cadence/types.js";

const testCadence: CadenceDefinition = {
  id: "test-cadence",
  name: "Test Cadence",
  description: "Test cadence",
  trigger: { event: "test" },
  steps: [
    {
      index: 0,
      actionType: "customer-engagement.reminder.send",
      parameters: { contactId: "{{contactId}}", message: "Hello {{contactName}}" },
      delayMs: 0,
    },
    {
      index: 1,
      actionType: "customer-engagement.reminder.send",
      parameters: { contactId: "{{contactId}}", message: "Follow up" },
      delayMs: 86400000,
      condition: { variable: "responded", operator: "neq", value: true },
    },
    {
      index: 2,
      actionType: "customer-engagement.review.request",
      parameters: { contactId: "{{contactId}}" },
      delayMs: 604800000,
    },
  ],
};

function makeInstance(overrides: Partial<CadenceInstance> = {}): CadenceInstance {
  return {
    id: "inst-1",
    cadenceDefinitionId: "test-cadence",
    contactId: "patient-1",
    organizationId: "org-1",
    status: "active",
    currentStepIndex: 0,
    startedAt: new Date("2024-01-01"),
    nextExecutionAt: null,
    variables: { contactId: "patient-1", contactName: "Alice" },
    completedSteps: [],
    skippedSteps: [],
    ...overrides,
  };
}

describe("evaluateCadenceStep", () => {
  it("should execute first step immediately", () => {
    const instance = makeInstance();
    const result = evaluateCadenceStep(testCadence, instance);

    expect(result.shouldExecute).toBe(true);
    expect(result.actionType).toBe("customer-engagement.reminder.send");
    expect(result.parameters.message).toBe("Hello Alice");
    expect(result.nextStepIndex).toBe(1);
    expect(result.completed).toBe(false);
  });

  it("should not execute when not yet due", () => {
    const futureExecution = new Date(Date.now() + 86400000);
    const instance = makeInstance({
      currentStepIndex: 1,
      nextExecutionAt: futureExecution,
    });

    const result = evaluateCadenceStep(testCadence, instance);
    expect(result.shouldExecute).toBe(false);
  });

  it("should skip step when condition is not met", () => {
    const instance = makeInstance({
      currentStepIndex: 1,
      variables: { contactId: "patient-1", contactName: "Alice", responded: true },
    });

    const result = evaluateCadenceStep(testCadence, instance);
    expect(result.shouldExecute).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.nextStepIndex).toBe(2);
  });

  it("should execute step when condition is met", () => {
    const instance = makeInstance({
      currentStepIndex: 1,
      variables: { contactId: "patient-1", contactName: "Alice", responded: false },
    });

    const result = evaluateCadenceStep(testCadence, instance);
    expect(result.shouldExecute).toBe(true);
  });

  it("should mark as completed after last step", () => {
    const instance = makeInstance({ currentStepIndex: 2 });

    const result = evaluateCadenceStep(testCadence, instance);
    expect(result.shouldExecute).toBe(true);
    expect(result.completed).toBe(true);
  });

  it("should not execute for inactive cadences", () => {
    const instance = makeInstance({ status: "stopped" });

    const result = evaluateCadenceStep(testCadence, instance);
    expect(result.shouldExecute).toBe(false);
  });

  it("should mark completed when beyond all steps", () => {
    const instance = makeInstance({ currentStepIndex: 99 });

    const result = evaluateCadenceStep(testCadence, instance);
    expect(result.completed).toBe(true);
  });
});
