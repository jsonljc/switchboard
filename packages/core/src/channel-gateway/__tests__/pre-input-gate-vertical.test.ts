import { describe, it, expect, vi } from "vitest";
import { runPreInputGate } from "../pre-input-gate.js";
import { InMemoryGovernancePostureCache } from "../../governance/posture-cache.js";
import type { ChannelGatewayConfig, ReplySink } from "../types.js";

/**
 * SH-3: the pre-input gate must thread resolveVertical(config) into the
 * escalation-trigger loader (normal path) and cache the vertical in the posture
 * (for the fail-closed path).
 */
function makeConfig(
  governanceConfig: Record<string, unknown>,
  cache: InMemoryGovernancePostureCache,
  calls: Array<{ jurisdiction: unknown; vertical: unknown }>,
): ChannelGatewayConfig {
  return {
    governanceConfigResolver: async () => ({
      status: "resolved" as const,
      config: governanceConfig as never,
    }),
    escalationTriggerLoader: ((jurisdiction: unknown, vertical: unknown) => {
      calls.push({ jurisdiction, vertical });
      return [] as never; // empty triggers: no match, gate returns false
    }) as never,
    verdictStore: { save: vi.fn().mockResolvedValue(undefined) } as never,
    postureCache: cache,
  } as unknown as ChannelGatewayConfig;
}

const replySink: ReplySink = { send: vi.fn().mockResolvedValue(undefined) };

describe("runPreInputGate vertical threading (SH-3)", () => {
  it("threads the resolved vertical marker into the escalation-trigger loader", async () => {
    const calls: Array<{ jurisdiction: unknown; vertical: unknown }> = [];
    const cache = new InMemoryGovernancePostureCache();
    const config = makeConfig(
      {
        jurisdiction: "SG",
        clinicType: "nonMedical",
        deterministicGate: { mode: "observe" },
        vertical: "generic",
      },
      cache,
      calls,
    );
    await runPreInputGate(config, "hello there", "sess-1", "web", "dep-1", "org-1", replySink);
    expect(calls).toContainEqual({ jurisdiction: "SG", vertical: "generic" });
  });

  it("defaults to medspa with no marker (byte-identical) and caches the vertical", async () => {
    const calls: Array<{ jurisdiction: unknown; vertical: unknown }> = [];
    const cache = new InMemoryGovernancePostureCache();
    const config = makeConfig(
      { jurisdiction: "SG", clinicType: "medical", deterministicGate: { mode: "observe" } },
      cache,
      calls,
    );
    await runPreInputGate(config, "hello there", "sess-1", "web", "dep-1", "org-1", replySink);
    expect(calls).toContainEqual({ jurisdiction: "SG", vertical: "medspa" });
    expect(cache.lastKnown("dep-1")?.vertical).toBe("medspa");
  });
});
