import { describe, it, expect, beforeEach } from "vitest";
import { IntentRegistry } from "./intent-registry.js";
import { registerSkillIntents } from "./skill-intent-registrar.js";
import type { SkillDefinition } from "../skill-runtime/types.js";

function makeSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    name: "Alex",
    slug: "alex",
    version: "1.0.0",
    description: "Frontline conversion agent",
    author: "test",
    parameters: [],
    tools: ["crm-write"],
    body: "You are Alex",
    context: [],
    intent: "alex.run",
    ...overrides,
  };
}

describe("registerSkillIntents — gateway respond contract", () => {
  let registry: IntentRegistry;

  beforeEach(() => {
    registry = new IntentRegistry();
  });

  it("registers the {slug}.respond intent the ChannelGateway submits (channel-gateway.ts:313)", () => {
    registerSkillIntents(registry, [makeSkill()]);
    expect(registry.lookup("alex.respond")).toBeDefined();
  });

  it("keeps the declared skill.intent registered (load-bearing for non-gateway callers)", () => {
    registerSkillIntents(registry, [makeSkill()]);
    expect(registry.lookup("alex.run")).toBeDefined();
  });

  it("allows the gateway 'chat' trigger on the respond intent", () => {
    registerSkillIntents(registry, [makeSkill()]);
    expect(registry.validateTrigger("alex.respond", "chat")).toBe(true);
  });

  it("binds the respond executor to the skill slug", () => {
    registerSkillIntents(registry, [makeSkill({ slug: "alex" })]);
    expect(registry.lookup("alex.respond")?.executor).toEqual({
      mode: "skill",
      skillSlug: "alex",
    });
  });

  it("adds {slug}.respond alongside a 3-part declared intent without a duplicate throw (mira)", () => {
    expect(() =>
      registerSkillIntents(registry, [
        makeSkill({
          name: "Mira",
          slug: "creative",
          intent: "creative.brief.compose",
          tools: [],
        }),
      ]),
    ).not.toThrow();
    expect(registry.lookup("creative.brief.compose")).toBeDefined();
    expect(registry.lookup("creative.respond")).toBeDefined();
  });

  it("does not double-register when a skill's declared intent already ends in .respond", () => {
    expect(() =>
      registerSkillIntents(registry, [makeSkill({ slug: "echo", intent: "echo.respond" })]),
    ).not.toThrow();
    expect(registry.lookup("echo.respond")).toBeDefined();
  });
});
