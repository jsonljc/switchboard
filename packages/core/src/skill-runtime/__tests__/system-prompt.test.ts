/**
 * buildSystemPrompt is the SINGLE source of truth for assembling the system
 * prompt the skill executor sends the model: interpolated skill body + the
 * runtime governance tail. Extracted from SkillExecutorImpl.execute so the
 * golden prompt-diff harness snapshots byte-for-byte what production sends.
 */
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { buildSystemPrompt } from "../system-prompt.js";
import { interpolate } from "../template-engine.js";
import { getGovernanceConstraints } from "../governance-injector.js";
import { loadSkill } from "../skill-loader.js";
import type { SkillDefinition } from "../types.js";

const SKILLS_DIR = resolve(import.meta.dirname, "../../../../../skills");

const SYNTHETIC: SkillDefinition = {
  name: "t",
  slug: "t",
  version: "1.0.0",
  description: "d",
  author: "a",
  parameters: [{ name: "FOO", type: "string", required: true }],
  tools: [],
  body: "Hello {{FOO}}.",
  context: [],
};

describe("buildSystemPrompt", () => {
  it("interpolates params into the body then appends the runtime governance tail", () => {
    const out = buildSystemPrompt(SYNTHETIC, { FOO: "world" });
    expect(out).toBe(`Hello world.\n\n${getGovernanceConstraints()}`);
  });

  it("is the single assembly path: real alex skill equals interpolate(body) + governance tail", () => {
    const skill = loadSkill("alex", SKILLS_DIR);
    const params = {
      BUSINESS_NAME: "Acme Clinic",
      OPPORTUNITY_ID: "op_1",
      PERSONA_CONFIG: {
        tone: "warm",
        qualificationCriteria: {},
        disqualificationCriteria: {},
        escalationRules: {},
      },
    };
    const out = buildSystemPrompt(skill, params);
    expect(out).toBe(
      `${interpolate(skill.body, params, skill.parameters)}\n\n${getGovernanceConstraints()}`,
    );
    expect(out.endsWith(getGovernanceConstraints())).toBe(true);
  });
});
