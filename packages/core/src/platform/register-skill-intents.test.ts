import { describe, it, expect } from "vitest";
import { registerSkillIntents } from "./register-skill-intents.js";
import { IntentRegistry } from "./intent-registry.js";
import type { SkillDefinition } from "../skill-runtime/types.js";

function makeSkill(slug: string): SkillDefinition {
  return {
    name: slug,
    slug,
    version: "1.0.0",
    description: `Test skill ${slug}`,
    author: "test",
    parameters: [],
    tools: [],
    body: "test body",
    context: [],
  };
}

describe("registerSkillIntents", () => {
  it("registers {slug}.respond intent for each skill", () => {
    const registry = new IntentRegistry();
    const skills = new Map<string, SkillDefinition>();
    skills.set("alex", makeSkill("alex"));
    skills.set("nurture", makeSkill("nurture"));

    registerSkillIntents(registry, skills);

    expect(registry.lookup("alex.respond")).toBeDefined();
    expect(registry.lookup("nurture.respond")).toBeDefined();
    expect(registry.resolveMode("alex.respond")).toBe("skill");
  });

  it("sets allowed triggers to chat, api, schedule", () => {
    const registry = new IntentRegistry();
    const skills = new Map<string, SkillDefinition>();
    skills.set("alex", makeSkill("alex"));

    registerSkillIntents(registry, skills);

    expect(registry.validateTrigger("alex.respond", "chat")).toBe(true);
    expect(registry.validateTrigger("alex.respond", "api")).toBe(true);
    expect(registry.validateTrigger("alex.respond", "schedule")).toBe(true);
  });

  it("does not throw when skills map is empty", () => {
    const registry = new IntentRegistry();
    registerSkillIntents(registry, new Map());
    expect(registry.size).toBe(0);
  });
});
