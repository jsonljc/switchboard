import { describe, it, expect } from "vitest";
import { composeSkillRequestContext } from "./skill-request-context.js";
import type { SkillExecutionParams } from "./types.js";

const baseParams = (over: Partial<SkillExecutionParams> = {}): SkillExecutionParams => ({
  skill: { slug: "alex", tools: [] } as unknown as SkillExecutionParams["skill"],
  parameters: {},
  messages: [],
  deploymentId: "dep-1",
  orgId: "org-1",
  trustScore: 0,
  trustLevel: "guided",
  sessionId: "sess-1",
  ...over,
});

describe("composeSkillRequestContext", () => {
  it("carries workUnitId and delegationDepth into the context", () => {
    const ctx = composeSkillRequestContext(baseParams({ workUnitId: "wu-7", delegationDepth: 1 }));
    expect(ctx.workUnitId).toBe("wu-7");
    expect(ctx.delegationDepth).toBe(1);
    expect(ctx.orgId).toBe("org-1");
    expect(ctx.sessionId).toBe("sess-1");
  });

  it("defaults delegationDepth/workUnitId to undefined when absent", () => {
    const ctx = composeSkillRequestContext(baseParams());
    expect(ctx.workUnitId).toBeUndefined();
    expect(ctx.delegationDepth).toBeUndefined();
  });
});
