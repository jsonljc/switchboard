// packages/core/src/__tests__/context-assembler.test.ts
import { describe, it, expect } from "vitest";
import { ContextAssembler } from "../context-assembler.js";
import type { ContextBudget } from "../context-budget.js";
import { DEFAULT_CONTEXT_BUDGET_LIMITS } from "../context-budget.js";

const budget: ContextBudget = {
  doctrine: "You are a creative content specialist.",
  memory: {
    brand: "Brand voice: concise, friendly.",
    skills: ["Use storytelling hooks.", "Keep paragraphs short."],
    performance: "Posts with questions get 2x engagement.",
  },
  task: {
    goal: "Draft an Instagram post",
    scope: ["instagram"],
    constraints: ["under 150 words"],
    expectedOutput: "Draft text ready for approval",
  },
  effort: "medium",
  orgId: "org-1",
  taskType: "content.draft",
};

describe("ContextAssembler", () => {
  const assembler = new ContextAssembler();

  it("includes doctrine, memory, and task in output", () => {
    const prompt = assembler.assemble(budget, DEFAULT_CONTEXT_BUDGET_LIMITS);
    expect(prompt).toContain("You are a creative content specialist.");
    expect(prompt).toContain("Brand voice: concise, friendly.");
    expect(prompt).toContain("Draft an Instagram post");
  });

  it("includes skills from memory", () => {
    const prompt = assembler.assemble(budget, DEFAULT_CONTEXT_BUDGET_LIMITS);
    expect(prompt).toContain("Use storytelling hooks.");
    expect(prompt).toContain("Keep paragraphs short.");
  });

  it("does not include orgId or taskType in prompt", () => {
    const prompt = assembler.assemble(budget, DEFAULT_CONTEXT_BUDGET_LIMITS);
    expect(prompt).not.toContain("org-1");
    expect(prompt).not.toContain("content.draft");
  });

  it("truncates doctrine when it exceeds doctrineBudget", () => {
    const limits = { ...DEFAULT_CONTEXT_BUDGET_LIMITS, doctrineBudget: 10 };
    const prompt = assembler.assemble(budget, limits);
    expect(prompt).toContain("[truncated");
    expect(prompt).not.toContain("You are a creative content specialist.");
  });

  it("handles empty memory gracefully", () => {
    const emptyMemoryBudget: ContextBudget = { ...budget, memory: {} };
    const prompt = assembler.assemble(emptyMemoryBudget, DEFAULT_CONTEXT_BUDGET_LIMITS);
    expect(prompt).toContain("You are a creative content specialist.");
    expect(prompt).toContain("Draft an Instagram post");
  });

  it("handles missing optional memory fields", () => {
    const partialBudget: ContextBudget = {
      ...budget,
      memory: { brand: "Brand voice: direct." },
    };
    const prompt = assembler.assemble(partialBudget, DEFAULT_CONTEXT_BUDGET_LIMITS);
    expect(prompt).toContain("Brand voice: direct.");
  });
});
