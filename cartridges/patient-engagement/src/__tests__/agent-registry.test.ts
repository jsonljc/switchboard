// ---------------------------------------------------------------------------
// Tests: Agent Registry
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { resolveAgent } from "../agents/registry.js";
import { IntakeAgent } from "../agents/intake/index.js";
import { RetentionAgent } from "../agents/retention/index.js";
import type { AgentModule, AgentType } from "../agents/types.js";

function makeAgentMap(): Map<AgentType, AgentModule> {
  const map = new Map<AgentType, AgentModule>();
  map.set("intake", new IntakeAgent());
  map.set("retention", new RetentionAgent());
  return map;
}

describe("resolveAgent", () => {
  it("should route lead actions to intake agent", () => {
    const agents = makeAgentMap();
    const agent = resolveAgent("patient-engagement.lead.qualify", agents);
    expect(agent).not.toBeNull();
    expect(agent!.type).toBe("intake");
  });

  it("should route objection handling to intake agent", () => {
    const agents = makeAgentMap();
    const agent = resolveAgent("patient-engagement.conversation.handle_objection", agents);
    expect(agent).not.toBeNull();
    expect(agent!.type).toBe("intake");
  });

  it("should route cadence actions to retention agent", () => {
    const agents = makeAgentMap();
    const agent = resolveAgent("patient-engagement.cadence.start", agents);
    expect(agent).not.toBeNull();
    expect(agent!.type).toBe("retention");
  });

  it("should return null for pipeline diagnostic (direct action)", () => {
    const agents = makeAgentMap();
    const agent = resolveAgent("patient-engagement.pipeline.diagnose", agents);
    expect(agent).toBeNull();
  });

  it("should return null for LTV scoring (direct action)", () => {
    const agents = makeAgentMap();
    const agent = resolveAgent("patient-engagement.patient.score_ltv", agents);
    expect(agent).toBeNull();
  });

  it("should return null for unknown actions", () => {
    const agents = makeAgentMap();
    const agent = resolveAgent("unknown.action", agents);
    expect(agent).toBeNull();
  });
});
