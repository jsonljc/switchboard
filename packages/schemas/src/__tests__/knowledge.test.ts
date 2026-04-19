import { describe, it, expect } from "vitest";
import {
  KnowledgeKindSchema,
  KnowledgeEntryCreateSchema,
  KnowledgeEntryUpdateSchema,
  ContextRequirementSchema,
} from "../knowledge.js";

describe("KnowledgeKindSchema", () => {
  it("accepts valid kinds", () => {
    expect(KnowledgeKindSchema.parse("playbook")).toBe("playbook");
    expect(KnowledgeKindSchema.parse("policy")).toBe("policy");
    expect(KnowledgeKindSchema.parse("knowledge")).toBe("knowledge");
  });

  it("accepts business-facts kind", () => {
    expect(KnowledgeKindSchema.parse("business-facts")).toBe("business-facts");
  });

  it("rejects invalid kinds", () => {
    expect(() => KnowledgeKindSchema.parse("playbok")).toThrow();
    expect(() => KnowledgeKindSchema.parse("")).toThrow();
  });
});

describe("KnowledgeEntryCreateSchema", () => {
  const valid = {
    organizationId: "org_dev",
    kind: "playbook" as const,
    scope: "objection-handling",
    title: "Objection Handling Playbook",
    content: "When a lead says price is too high...",
  };

  it("accepts valid create input", () => {
    const result = KnowledgeEntryCreateSchema.parse(valid);
    expect(result.priority).toBe(0);
  });

  it("enforces kebab-case scope", () => {
    expect(() =>
      KnowledgeEntryCreateSchema.parse({ ...valid, scope: "ObjectionHandling" }),
    ).toThrow(/kebab-case/);
    expect(() =>
      KnowledgeEntryCreateSchema.parse({ ...valid, scope: "objection_handling" }),
    ).toThrow(/kebab-case/);
  });

  it("rejects blank content", () => {
    expect(() => KnowledgeEntryCreateSchema.parse({ ...valid, content: "   " })).toThrow();
  });

  it("rejects blank title", () => {
    expect(() => KnowledgeEntryCreateSchema.parse({ ...valid, title: "  " })).toThrow();
  });

  it("rejects empty organizationId", () => {
    expect(() => KnowledgeEntryCreateSchema.parse({ ...valid, organizationId: "" })).toThrow();
  });
});

describe("KnowledgeEntryUpdateSchema", () => {
  it("accepts partial updates", () => {
    expect(KnowledgeEntryUpdateSchema.parse({ title: "New Title" })).toEqual({
      title: "New Title",
    });
  });

  it("rejects blank content on update", () => {
    expect(() => KnowledgeEntryUpdateSchema.parse({ content: "  " })).toThrow();
  });
});

describe("ContextRequirementSchema", () => {
  it("accepts valid requirement", () => {
    const result = ContextRequirementSchema.parse({
      kind: "playbook",
      scope: "objection-handling",
      injectAs: "PLAYBOOK_CONTEXT",
    });
    expect(result.required).toBe(true);
  });

  it("accepts optional requirement", () => {
    const result = ContextRequirementSchema.parse({
      kind: "knowledge",
      scope: "offer-catalog",
      injectAs: "KNOWLEDGE_CONTEXT",
      required: false,
    });
    expect(result.required).toBe(false);
  });

  it("enforces SCREAMING_SNAKE_CASE for injectAs", () => {
    expect(() =>
      ContextRequirementSchema.parse({
        kind: "playbook",
        scope: "test",
        injectAs: "playbookContext",
      }),
    ).toThrow();
  });

  it("enforces kebab-case for scope", () => {
    expect(() =>
      ContextRequirementSchema.parse({
        kind: "playbook",
        scope: "Objection_Handling",
        injectAs: "TEST",
      }),
    ).toThrow();
  });
});
