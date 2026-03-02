// ---------------------------------------------------------------------------
// Tests: Conversation Engine
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  createConversationState,
  executeNextStep,
  interpolate,
} from "../conversation/engine.js";
import type { ConversationFlowDefinition } from "../conversation/types.js";

const simpleFlow: ConversationFlowDefinition = {
  id: "test-flow",
  name: "Test Flow",
  description: "A test flow",
  variables: ["patientName", "clinicName"],
  steps: [
    { id: "greeting", type: "message", template: "Hello {{patientName}}!" },
    {
      id: "question",
      type: "question",
      template: "How can we help?",
      options: ["Book", "Info"],
    },
    { id: "thanks", type: "message", template: "Thank you!" },
  ],
};

describe("interpolate", () => {
  it("should replace variables", () => {
    const result = interpolate("Hello {{name}}!", { name: "Alice" });
    expect(result).toBe("Hello Alice!");
  });

  it("should leave unresolved variables as-is", () => {
    const result = interpolate("Hello {{name}}!", {});
    expect(result).toBe("Hello {{name}}!");
  });

  it("should handle multiple variables", () => {
    const result = interpolate("{{greeting}} {{name}} at {{place}}!", {
      greeting: "Hi",
      name: "Bob",
      place: "Clinic",
    });
    expect(result).toBe("Hi Bob at Clinic!");
  });
});

describe("conversation engine", () => {
  it("should create initial state", () => {
    const state = createConversationState(simpleFlow, { patientName: "Alice" });
    expect(state.flowId).toBe("test-flow");
    expect(state.currentStepIndex).toBe(0);
    expect(state.completed).toBe(false);
  });

  it("should execute message steps with interpolation", () => {
    const state = createConversationState(simpleFlow, { patientName: "Alice" });
    const { output, state: newState } = executeNextStep(simpleFlow, state);

    expect(output).toBe("Hello Alice!");
    expect(newState.currentStepIndex).toBe(1);
    expect(newState.history.length).toBe(1);
  });

  it("should execute question steps with options", () => {
    let state = createConversationState(simpleFlow, { patientName: "Alice" });
    // Execute greeting
    const result1 = executeNextStep(simpleFlow, state);
    // Execute question
    const result2 = executeNextStep(simpleFlow, result1.state);

    expect(result2.output).toContain("How can we help?");
    expect(result2.output).toContain("1. Book");
    expect(result2.output).toContain("2. Info");
  });

  it("should complete after all steps", () => {
    let state = createConversationState(simpleFlow, { patientName: "Alice" });

    for (let i = 0; i < simpleFlow.steps.length; i++) {
      const result = executeNextStep(simpleFlow, state);
      state = result.state;
    }

    const final = executeNextStep(simpleFlow, state);
    expect(final.state.completed).toBe(true);
  });

  it("should handle escalation steps", () => {
    const flowWithEscalation: ConversationFlowDefinition = {
      id: "escalation-test",
      name: "Escalation Test",
      description: "Test",
      variables: [],
      steps: [
        {
          id: "escalate",
          type: "escalate",
          template: "Connecting you to a human.",
          escalationReason: "Test escalation",
        },
      ],
    };

    const state = createConversationState(flowWithEscalation);
    const { output, state: newState } = executeNextStep(flowWithEscalation, state);

    expect(output).toBe("Connecting you to a human.");
    expect(newState.escalated).toBe(true);
  });

  it("should handle action steps with actionRequired", () => {
    const flowWithAction: ConversationFlowDefinition = {
      id: "action-test",
      name: "Action Test",
      description: "Test",
      variables: ["patientId"],
      steps: [
        {
          id: "book",
          type: "action",
          template: "Booking...",
          actionType: "patient-engagement.appointment.book",
          actionParameters: { patientId: "{{patientId}}" },
        },
      ],
    };

    const state = createConversationState(flowWithAction, { patientId: "p-123" });
    const { actionRequired } = executeNextStep(flowWithAction, state);

    expect(actionRequired).toBeDefined();
    expect(actionRequired!.actionType).toBe("patient-engagement.appointment.book");
    expect(actionRequired!.parameters.patientId).toBe("p-123");
  });
});
