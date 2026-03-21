import { describe, it, expect } from "vitest";
import { createConversationState, executeNextStep } from "../engine.js";
import type { ConversationFlowDefinition } from "../types.js";

describe("conversation engine — extended step types", () => {
  describe("branch steps", () => {
    const branchFlow: ConversationFlowDefinition = {
      id: "branch-flow",
      name: "Branch Flow",
      description: "Tests branching",
      variables: ["score"],
      steps: [
        {
          id: "branch",
          type: "branch",
          branches: [
            { variable: "score", operator: "gte", value: 7, targetStepId: "high" },
            { variable: "score", operator: "lt", value: 7, targetStepId: "low" },
          ],
        },
        { id: "high", type: "message", template: "High score!" },
        { id: "low", type: "message", template: "Low score!" },
      ],
    };

    it("should follow the first matching branch (gte)", () => {
      const state = createConversationState(branchFlow, { score: 8 });
      const result = executeNextStep(branchFlow, state);
      expect(result.output).toBe("High score!");
    });

    it("should follow the second branch (lt)", () => {
      const state = createConversationState(branchFlow, { score: 3 });
      const result = executeNextStep(branchFlow, state);
      expect(result.output).toBe("Low score!");
    });

    it("should handle eq operator", () => {
      const flow: ConversationFlowDefinition = {
        id: "eq-flow",
        name: "Eq",
        description: "Tests eq",
        variables: [],
        steps: [
          {
            id: "b",
            type: "branch",
            branches: [{ variable: "val", operator: "eq", value: "yes", targetStepId: "matched" }],
          },
          { id: "matched", type: "message", template: "Matched!" },
        ],
      };
      const state = createConversationState(flow, { val: "yes" });
      const result = executeNextStep(flow, state);
      expect(result.output).toBe("Matched!");
    });

    it("should handle neq operator", () => {
      const flow: ConversationFlowDefinition = {
        id: "neq-flow",
        name: "Neq",
        description: "Tests neq",
        variables: [],
        steps: [
          {
            id: "b",
            type: "branch",
            branches: [{ variable: "val", operator: "neq", value: "no", targetStepId: "matched" }],
          },
          { id: "matched", type: "message", template: "Not no!" },
        ],
      };
      const state = createConversationState(flow, { val: "yes" });
      const result = executeNextStep(flow, state);
      expect(result.output).toBe("Not no!");
    });

    it("should handle gt operator", () => {
      const flow: ConversationFlowDefinition = {
        id: "gt-flow",
        name: "Gt",
        description: "Tests gt",
        variables: [],
        steps: [
          {
            id: "b",
            type: "branch",
            branches: [{ variable: "val", operator: "gt", value: 5, targetStepId: "high" }],
          },
          { id: "high", type: "message", template: "Greater!" },
        ],
      };
      const state = createConversationState(flow, { val: 10 });
      const result = executeNextStep(flow, state);
      expect(result.output).toBe("Greater!");
    });

    it("should handle lte operator", () => {
      const flow: ConversationFlowDefinition = {
        id: "lte-flow",
        name: "Lte",
        description: "Tests lte",
        variables: [],
        steps: [
          {
            id: "b",
            type: "branch",
            branches: [{ variable: "val", operator: "lte", value: 5, targetStepId: "low" }],
          },
          { id: "low", type: "message", template: "Low!" },
        ],
      };
      const state = createConversationState(flow, { val: 5 });
      const result = executeNextStep(flow, state);
      expect(result.output).toBe("Low!");
    });

    it("should handle contains operator", () => {
      const flow: ConversationFlowDefinition = {
        id: "contains-flow",
        name: "Contains",
        description: "Tests contains",
        variables: [],
        steps: [
          {
            id: "b",
            type: "branch",
            branches: [
              { variable: "msg", operator: "contains", value: "help", targetStepId: "help" },
            ],
          },
          { id: "help", type: "message", template: "Helping!" },
        ],
      };
      const state = createConversationState(flow, { msg: "I need HELP please" });
      const result = executeNextStep(flow, state);
      expect(result.output).toBe("Helping!");
    });

    it("should handle in operator", () => {
      const flow: ConversationFlowDefinition = {
        id: "in-flow",
        name: "In",
        description: "Tests in",
        variables: [],
        steps: [
          {
            id: "b",
            type: "branch",
            branches: [
              {
                variable: "tier",
                operator: "in",
                value: ["gold", "platinum"],
                targetStepId: "vip",
              },
            ],
          },
          { id: "vip", type: "message", template: "VIP!" },
        ],
      };
      const state = createConversationState(flow, { tier: "gold" });
      const result = executeNextStep(flow, state);
      expect(result.output).toBe("VIP!");
    });
  });

  describe("wait steps", () => {
    it("should output wait message with duration", () => {
      const flow: ConversationFlowDefinition = {
        id: "wait-flow",
        name: "Wait",
        description: "Tests wait",
        variables: [],
        steps: [{ id: "w", type: "wait", waitMs: 5000 }],
      };
      const state = createConversationState(flow);
      const result = executeNextStep(flow, state);
      expect(result.output).toBe("[Waiting 5 seconds]");
      expect(result.state.currentStepIndex).toBe(1);
    });
  });

  describe("score steps", () => {
    it("should compute lead score and set variables", () => {
      const flow: ConversationFlowDefinition = {
        id: "score-flow",
        name: "Score",
        description: "Tests scoring",
        variables: [],
        steps: [{ id: "s", type: "score", template: "Calculating your score..." }],
      };
      const state = createConversationState(flow, {
        selectedOption_timeline_question: 1, // ASAP → urgency 9
        selectedOption_budget_question: 1, // has budget → 8
        selectedOption_insurance_question: 1, // has insurance
      });
      const result = executeNextStep(flow, state);
      expect(result.output).toBe("Calculating your score...");
      expect(result.state.variables["leadScore"]).toBeDefined();
      expect(typeof result.state.variables["leadScore"]).toBe("number");
      expect(result.state.variables["leadScoreTier"]).toBeDefined();
    });

    it("should use defaults when no options selected", () => {
      const flow: ConversationFlowDefinition = {
        id: "score-flow",
        name: "Score",
        description: "Tests scoring defaults",
        variables: [],
        steps: [{ id: "s", type: "score" }],
      };
      const state = createConversationState(flow);
      const result = executeNextStep(flow, state);
      expect(result.state.variables["leadScore"]).toBeDefined();
    });
  });

  describe("objection steps", () => {
    it("should output objection template and advance", () => {
      const flow: ConversationFlowDefinition = {
        id: "obj-flow",
        name: "Objection",
        description: "Tests objection handling",
        variables: [],
        steps: [
          {
            id: "obj",
            type: "objection",
            template: "I understand your concern about {{concern}}.",
          },
          { id: "next", type: "message", template: "Let me address that." },
        ],
      };
      const state = createConversationState(flow, { concern: "pricing" });
      const result = executeNextStep(flow, state);
      expect(result.output).toBe("I understand your concern about pricing.");
      expect(result.state.currentStepIndex).toBe(1);
    });
  });

  describe("question with llmPersonalization", () => {
    it("should replace 'patient' with contact name", () => {
      const flow: ConversationFlowDefinition = {
        id: "llm-flow",
        name: "LLM",
        description: "Tests LLM personalization",
        variables: [],
        steps: [
          {
            id: "q",
            type: "question",
            template: "Dear patient, what service interests you?",
            options: ["Cleaning", "Filling"],
            llmPersonalization: true,
          },
        ],
      };
      const state = createConversationState(flow, { contactName: "Alice" });
      const result = executeNextStep(flow, state);
      expect(result.output).toContain("Dear Alice");
      expect(result.output).not.toContain("patient");
    });
  });

  describe("resolveNextStep with nextStepId", () => {
    it("should jump to a named step", () => {
      const flow: ConversationFlowDefinition = {
        id: "jump-flow",
        name: "Jump",
        description: "Tests step jumping",
        variables: [],
        steps: [
          { id: "start", type: "message", template: "Start", nextStepId: "end" },
          { id: "skip", type: "message", template: "Skipped" },
          { id: "end", type: "message", template: "End" },
        ],
      };
      const state = createConversationState(flow);
      const result = executeNextStep(flow, state);
      expect(result.output).toBe("Start");
      expect(result.state.currentStepIndex).toBe(2); // jumped to "end"
    });
  });

  describe("edge cases", () => {
    it("should return empty output for completed state", () => {
      const flow: ConversationFlowDefinition = {
        id: "done",
        name: "Done",
        description: "Already completed",
        variables: [],
        steps: [],
      };
      const state = createConversationState(flow);
      state.completed = true;
      const result = executeNextStep(flow, state);
      expect(result.output).toBe("");
    });

    it("should return empty output for escalated state", () => {
      const flow: ConversationFlowDefinition = {
        id: "done",
        name: "Done",
        description: "Already escalated",
        variables: [],
        steps: [],
      };
      const state = createConversationState(flow);
      state.escalated = true;
      const result = executeNextStep(flow, state);
      expect(result.output).toBe("");
    });

    it("should mark completed when step index exceeds flow length", () => {
      const flow: ConversationFlowDefinition = {
        id: "done",
        name: "Done",
        description: "Past end",
        variables: [],
        steps: [{ id: "only", type: "message", template: "Only step" }],
      };
      const state = createConversationState(flow);
      state.currentStepIndex = 5;
      const result = executeNextStep(flow, state);
      expect(result.state.completed).toBe(true);
    });
  });
});
