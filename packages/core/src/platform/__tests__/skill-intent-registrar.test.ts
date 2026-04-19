import { describe, it, expect, beforeEach } from "vitest";
import { IntentRegistry } from "../intent-registry.js";
import { registerSkillIntents } from "../skill-intent-registrar.js";
import type { SkillDefinition } from "../../skill-runtime/types.js";

function makeSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    name: "Sales Pipeline",
    slug: "sales-pipeline",
    version: "1.0.0",
    description: "Run the sales pipeline",
    author: "test",
    parameters: [],
    tools: ["crm.read"],
    body: "Do something useful",
    context: [],
    intent: "sales-pipeline.run",
    ...overrides,
  };
}

describe("registerSkillIntents", () => {
  let registry: IntentRegistry;

  beforeEach(() => {
    registry = new IntentRegistry();
  });

  it("registers intents for all skills with intent field", () => {
    const skills = [
      makeSkill({ slug: "skill-a", intent: "skill-a.run" }),
      makeSkill({ slug: "skill-b", intent: "skill-b.run" }),
    ];
    registerSkillIntents(registry, skills);

    expect(registry.size).toBe(2);
    expect(registry.lookup("skill-a.run")).toBeDefined();
    expect(registry.lookup("skill-b.run")).toBeDefined();
  });

  it("skips skills without intent", () => {
    const skills = [
      makeSkill({ slug: "with-intent", intent: "with-intent.run" }),
      makeSkill({ slug: "no-intent", intent: undefined }),
    ];
    registerSkillIntents(registry, skills);

    expect(registry.size).toBe(1);
    expect(registry.lookup("with-intent.run")).toBeDefined();
  });

  it("sets executor binding with skill slug", () => {
    const skills = [makeSkill({ slug: "my-skill", intent: "my-skill.run" })];
    registerSkillIntents(registry, skills);

    const reg = registry.lookup("my-skill.run");
    expect(reg?.executor).toEqual({ mode: "skill", skillSlug: "my-skill" });
  });

  it("sets defaultMode to skill", () => {
    const skills = [makeSkill()];
    registerSkillIntents(registry, skills);

    const reg = registry.lookup("sales-pipeline.run");
    expect(reg?.defaultMode).toBe("skill");
    expect(reg?.allowedModes).toEqual(["skill"]);
  });

  it("derives mutationClass from tools (write tools -> write)", () => {
    const readSkill = makeSkill({
      slug: "reader",
      intent: "reader.run",
      tools: ["crm.read", "analytics.query"],
    });
    const writeSkill = makeSkill({
      slug: "writer",
      intent: "writer.run",
      tools: ["crm.read", "crm.write"],
    });
    const deleteSkill = makeSkill({
      slug: "deleter",
      intent: "deleter.run",
      tools: ["crm.delete"],
    });

    registerSkillIntents(registry, [readSkill, writeSkill, deleteSkill]);

    expect(registry.lookup("reader.run")?.mutationClass).toBe("read");
    expect(registry.lookup("writer.run")?.mutationClass).toBe("write");
    expect(registry.lookup("deleter.run")?.mutationClass).toBe("write");
  });

  it("sets budgetClass from minimumModelTier", () => {
    const cheapSkill = makeSkill({ slug: "cheap", intent: "cheap.run" });
    const standardSkill = makeSkill({
      slug: "standard",
      intent: "standard.run",
      minimumModelTier: "premium",
    });
    const expensiveSkill = makeSkill({
      slug: "expensive",
      intent: "expensive.run",
      minimumModelTier: "critical",
    });

    registerSkillIntents(registry, [cheapSkill, standardSkill, expensiveSkill]);

    expect(registry.lookup("cheap.run")?.budgetClass).toBe("cheap");
    expect(registry.lookup("standard.run")?.budgetClass).toBe("standard");
    expect(registry.lookup("expensive.run")?.budgetClass).toBe("expensive");
  });

  it("allows all triggers by default", () => {
    const skills = [makeSkill()];
    registerSkillIntents(registry, skills);

    const reg = registry.lookup("sales-pipeline.run");
    expect(reg?.allowedTriggers).toEqual(["chat", "api", "schedule", "internal"]);
  });
});
