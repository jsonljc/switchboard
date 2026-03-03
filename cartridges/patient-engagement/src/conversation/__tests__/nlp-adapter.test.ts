import { describe, it, expect } from "vitest";
import { ConversationNLPAdapter } from "../nlp-adapter.js";
import type { FlowStep } from "../types.js";

describe("ConversationNLPAdapter", () => {
  const adapter = new ConversationNLPAdapter();

  const questionStep: FlowStep = {
    id: "q1",
    type: "question",
    template: "Pick one",
    options: ["Weekday morning", "Weekday afternoon", "Weekend"],
  };

  const yesNoStep: FlowStep = {
    id: "q2",
    type: "question",
    template: "Do you agree?",
    options: ["Yes", "No"],
  };

  describe("numeric option selection", () => {
    it("returns numeric option directly without NLP", () => {
      const result = adapter.processMessage("2", questionStep);
      expect(result.resolvedOptionIndex).toBe(2);
      expect(result.nlpUsed).toBe(false);
      expect(result.extractedVariables).toEqual({ selectedOption: 2 });
    });
  });

  describe("no current step", () => {
    it("returns null resolvedOptionIndex when no step", () => {
      const result = adapter.processMessage("hello", null);
      expect(result.resolvedOptionIndex).toBeNull();
      expect(result.nlpUsed).toBe(true);
    });
  });

  describe("non-question step", () => {
    it("returns classification only for message step", () => {
      const msgStep: FlowStep = { id: "m1", type: "message", template: "Hi" };
      const result = adapter.processMessage("hello", msgStep);
      expect(result.resolvedOptionIndex).toBeNull();
      expect(result.nlpUsed).toBe(true);
    });
  });

  describe("yes/no mapping", () => {
    it("maps 'yes' to option 1 for 2-option step", () => {
      const result = adapter.processMessage("yes", yesNoStep);
      expect(result.resolvedOptionIndex).toBe(1);
      expect(result.nlpUsed).toBe(true);
      expect(result.classification.intent).toBe("option_selection");
    });

    it("maps 'nope' to option 2 for 2-option step", () => {
      const result = adapter.processMessage("nope", yesNoStep);
      expect(result.resolvedOptionIndex).toBe(2);
      expect(result.nlpUsed).toBe(true);
    });

    it("maps 'ok' to option 1", () => {
      const result = adapter.processMessage("ok", yesNoStep);
      expect(result.resolvedOptionIndex).toBe(1);
    });

    it("does not map yes/no for 3+ options", () => {
      const result = adapter.processMessage("yes", questionStep);
      // "yes" is affirmative but not mapped to options for 3-option step
      expect(result.resolvedOptionIndex).toBeNull();
    });
  });

  describe("fuzzy matching", () => {
    it("matches exact option text (case-insensitive)", () => {
      const result = adapter.processMessage("weekday morning", questionStep);
      expect(result.resolvedOptionIndex).toBe(1);
      expect(result.nlpUsed).toBe(true);
    });

    it("matches when user text starts with option", () => {
      const result = adapter.processMessage("weekend please", questionStep);
      expect(result.resolvedOptionIndex).toBe(3);
    });

    it("matches keyword overlap", () => {
      const result = adapter.processMessage("I prefer afternoon on weekday", questionStep);
      expect(result.resolvedOptionIndex).toBe(2);
    });

    it("returns null when no fuzzy match", () => {
      const result = adapter.processMessage("something completely different", questionStep);
      expect(result.resolvedOptionIndex).toBeNull();
    });
  });

  describe("escalation handling", () => {
    it("sets escalationRequested variable for escalation intent", () => {
      const result = adapter.processMessage("talk to a human", questionStep);
      expect(result.extractedVariables["escalationRequested"]).toBe(true);
    });
  });

  describe("freeform extraction", () => {
    it("includes lastMessage and lastMessageLower in extracted variables", () => {
      const result = adapter.processMessage("John Smith", questionStep);
      expect(result.extractedVariables["lastMessage"]).toBe("John Smith");
      expect(result.extractedVariables["lastMessageLower"]).toBe("john smith");
    });

    it("extracts email from freeform in question context", () => {
      const result = adapter.processMessage("my email is test@example.com", questionStep);
      expect(result.extractedVariables["email"]).toBe("test@example.com");
    });
  });
});
