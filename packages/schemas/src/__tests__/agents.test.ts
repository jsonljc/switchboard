import { describe, expect, it } from "vitest";
import { AGENT_REGISTRY, AGENT_KEYS, AgentKeySchema, getAgent, isAgentKey } from "../agents.js";

describe("AGENT_REGISTRY", () => {
  it("contains exactly alex / riley / mira", () => {
    expect(AGENT_KEYS).toEqual(["alex", "riley", "mira"]);
  });

  it("alex is day-one with marketing orange accent", () => {
    expect(AGENT_REGISTRY.alex.displayName).toBe("Alex");
    expect(AGENT_REGISTRY.alex.role).toBe("lead-to-speed");
    expect(AGENT_REGISTRY.alex.launchTier).toBe("day-one");
    expect(AGENT_REGISTRY.alex.accent).toMatch(/^hsl\(/);
    expect(AGENT_REGISTRY.alex.slug).toBe("alex");
  });

  it("riley is day-one with warm clay accent", () => {
    expect(AGENT_REGISTRY.riley.displayName).toBe("Riley");
    expect(AGENT_REGISTRY.riley.role).toBe("ad-optimizer");
    expect(AGENT_REGISTRY.riley.launchTier).toBe("day-one");
  });

  it("mira is day-thirty (deferred)", () => {
    expect(AGENT_REGISTRY.mira.displayName).toBe("Mira");
    expect(AGENT_REGISTRY.mira.role).toBe("creative");
    expect(AGENT_REGISTRY.mira.launchTier).toBe("day-thirty");
  });

  it("slug equals key for every agent (Q4 = A)", () => {
    for (const key of AGENT_KEYS) {
      expect(AGENT_REGISTRY[key].slug).toBe(key);
    }
  });
});

describe("AgentKeySchema", () => {
  it("accepts each registry key", () => {
    for (const key of AGENT_KEYS) {
      expect(AgentKeySchema.safeParse(key).success).toBe(true);
    }
  });

  it("rejects stale names nova and jordan", () => {
    expect(AgentKeySchema.safeParse("nova").success).toBe(false);
    expect(AgentKeySchema.safeParse("jordan").success).toBe(false);
  });

  it("rejects unknown keys", () => {
    expect(AgentKeySchema.safeParse("zoe").success).toBe(false);
    expect(AgentKeySchema.safeParse("").success).toBe(false);
  });
});

describe("getAgent / isAgentKey", () => {
  it("getAgent returns the registry entry", () => {
    expect(getAgent("alex")).toBe(AGENT_REGISTRY.alex);
  });

  it("isAgentKey is a type guard", () => {
    expect(isAgentKey("alex")).toBe(true);
    expect(isAgentKey("nova")).toBe(false);
    expect(isAgentKey("")).toBe(false);
  });
});
