import { describe, it, expect } from "vitest";
import { CommandGuardrailEvaluator } from "../command-guardrail-evaluator.js";
import type { InterpretResult } from "../operator-types.js";

describe("CommandGuardrailEvaluator", () => {
  const evaluator = new CommandGuardrailEvaluator();

  it("allows high-confidence read-only commands without confirmation", () => {
    const input: InterpretResult = {
      intent: "show_pipeline",
      entities: [],
      parameters: {},
      confidence: 0.95,
      ambiguityFlags: [],
    };

    const result = evaluator.evaluate(input);

    expect(result.canExecute).toBe(true);
    expect(result.requiresConfirmation).toBe(false);
    expect(result.riskLevel).toBe("low");
  });

  it("requires confirmation for write intents", () => {
    const input: InterpretResult = {
      intent: "pause_campaigns",
      entities: [{ type: "campaign", id: "camp-1" }],
      parameters: {},
      confidence: 0.9,
      ambiguityFlags: [],
    };

    const result = evaluator.evaluate(input);

    expect(result.canExecute).toBe(true);
    expect(result.requiresConfirmation).toBe(true);
    expect(result.riskLevel).toBe("medium");
  });

  it("blocks execution when confidence is too low", () => {
    const input: InterpretResult = {
      intent: "pause_campaigns",
      entities: [],
      parameters: {},
      confidence: 0.3,
      ambiguityFlags: ["vague_input"],
    };

    const result = evaluator.evaluate(input);

    expect(result.canExecute).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("flags missing entities", () => {
    const input: InterpretResult = {
      intent: "reassign_leads",
      entities: [],
      parameters: {},
      confidence: 0.85,
      ambiguityFlags: [],
    };

    const result = evaluator.evaluate(input);

    expect(result.missingEntities.length).toBeGreaterThan(0);
    expect(result.requiresConfirmation).toBe(true);
  });

  it("marks unknown intents as non-executable", () => {
    const input: InterpretResult = {
      intent: "unknown",
      entities: [],
      parameters: {},
      confidence: 0,
      ambiguityFlags: ["llm_error"],
    };

    const result = evaluator.evaluate(input);

    expect(result.canExecute).toBe(false);
  });

  it("requires preview for high-risk intents", () => {
    const input: InterpretResult = {
      intent: "pause_campaigns",
      entities: [{ type: "campaign", filter: { status: "active" } }],
      parameters: { scope: "all" },
      confidence: 0.92,
      ambiguityFlags: [],
    };

    const result = evaluator.evaluate(input);

    expect(result.requiresPreview).toBe(true);
  });
});
