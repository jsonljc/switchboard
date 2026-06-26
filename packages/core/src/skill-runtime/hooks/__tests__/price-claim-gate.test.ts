import { describe, it, expect, vi } from "vitest";
import { PriceClaimGateHook } from "../price-claim-gate.js";
import type { PriceClaimGateHookDeps } from "../price-claim-gate.js";
import { InMemoryGovernancePostureCache } from "../../../governance/posture-cache.js";
import type { SaveGovernanceVerdictInput } from "../../../governance/governance-verdict-store/types.js";
import type { SkillHookContext, SkillExecutionResult } from "../../types.js";
import { buildObserveGovernanceConfig, setGateModeInConfig } from "@switchboard/schemas";

type Spy = ReturnType<typeof vi.fn>;

function makeVerdictStore(): { save: Spy; listByConversation: Spy; listByDeployment: Spy } {
  return {
    save: vi.fn().mockResolvedValue({ id: "v1" }),
    listByConversation: vi.fn(),
    listByDeployment: vi.fn(),
  };
}
function makeHandoffStore() {
  return {
    save: vi.fn().mockResolvedValue(undefined),
    getById: vi.fn(),
    getBySessionId: vi.fn(),
    updateStatus: vi.fn(),
    listPending: vi.fn(),
  };
}
function makeConvStore() {
  return { setConversationStatus: vi.fn().mockResolvedValue(undefined) };
}

const HANDOFF_TEXT = "Let me have a teammate confirm the exact pricing for you.";

function buildDeps(
  overrides: {
    resolver?: PriceClaimGateHookDeps["governanceConfigResolver"];
    approvedPrices?: readonly number[];
    cache?: InMemoryGovernancePostureCache;
    verdictStore?: ReturnType<typeof makeVerdictStore>;
    handoffStore?: ReturnType<typeof makeHandoffStore>;
    convStore?: ReturnType<typeof makeConvStore>;
  } = {},
) {
  const verdictStore = overrides.verdictStore ?? makeVerdictStore();
  const handoffStore = overrides.handoffStore ?? makeHandoffStore();
  const conversationStore = overrides.convStore ?? makeConvStore();
  const cache = overrides.cache ?? new InMemoryGovernancePostureCache();
  const deps: PriceClaimGateHookDeps = {
    governanceConfigResolver: overrides.resolver ?? (async () => ({ status: "missing" as const })),
    getApprovedPrices: async () => overrides.approvedPrices ?? [50, 1200],
    verdictStore: verdictStore as never,
    handoffStore: handoffStore as never,
    conversationStore: conversationStore as never,
    postureCache: cache,
    clock: () => new Date("2026-06-24T12:00:00.000Z"),
    renderHandoff: () => HANDOFF_TEXT,
  };
  return { deps, spies: { verdictStore, handoffStore, conversationStore }, cache };
}

function resolved(mode: "off" | "observe" | "enforce") {
  return async () => ({
    status: "resolved" as const,
    config: {
      jurisdiction: "SG" as const,
      clinicType: "medical" as const,
      deterministicGate: { mode },
    },
  });
}

function makeCtxAndResult(text: string): {
  ctx: SkillHookContext;
  result: SkillExecutionResult;
} {
  const ctx: SkillHookContext = {
    deploymentId: "dep-1",
    orgId: "org-1",
    skillSlug: "alex-medspa",
    skillVersion: "1.0.0",
    sessionId: "sess-1",
    trustLevel: "guided",
    trustScore: 60,
  };
  const result: SkillExecutionResult = {
    response: text,
    toolCalls: [],
    tokenUsage: { input: 100, output: 50 },
    trace: {
      durationMs: 1000,
      turnCount: 2,
      status: "success",
      responseSummary: text.slice(0, 500),
      writeCount: 0,
      governanceDecisions: [],
      qualificationSignals: null,
    },
  };
  return { ctx, result };
}

describe("PriceClaimGateHook.afterSkill", () => {
  it("passes through when governance config is missing", async () => {
    const { deps, spies } = buildDeps();
    const hook = new PriceClaimGateHook(deps);
    const { ctx, result } = makeCtxAndResult("It's $999 for that.");
    await hook.afterSkill(ctx, result);
    expect(result.response).toBe("It's $999 for that.");
    expect(spies.verdictStore.save).not.toHaveBeenCalled();
  });

  it("passes through when mode is off", async () => {
    const { deps, spies } = buildDeps({ resolver: resolved("off"), approvedPrices: [50] });
    const hook = new PriceClaimGateHook(deps);
    const { ctx, result } = makeCtxAndResult("It's $999 for that.");
    await hook.afterSkill(ctx, result);
    expect(result.response).toBe("It's $999 for that.");
    expect(spies.verdictStore.save).not.toHaveBeenCalled();
  });

  it("P2-A inertness: the seeded observe config never blocks, even with zero approved prices", async () => {
    const { deps, spies } = buildDeps({
      resolver: async () => ({
        status: "resolved" as const,
        config: buildObserveGovernanceConfig({ jurisdiction: "SG", clinicType: "medical" }),
      }),
      approvedPrices: [], // worst case: the org has no approved prices yet
    });
    const hook = new PriceClaimGateHook(deps);
    const { ctx, result } = makeCtxAndResult("Our HydraFacial is $250.");
    await hook.afterSkill(ctx, result);

    // Telemetry only: response unchanged, no handoff, no status flip.
    expect(result.response).toBe("Our HydraFacial is $250.");
    expect(spies.conversationStore.setConversationStatus).not.toHaveBeenCalled();
    expect(spies.handoffStore.save).not.toHaveBeenCalled();
    // A verdict IS recorded (observe = log) with action "allow".
    expect(spies.verdictStore.save).toHaveBeenCalledWith(
      expect.objectContaining({ action: "allow", sourceGuard: "price_gate" }),
    );
  });

  it("allows a price that matches an operator-approved service price (enforce)", async () => {
    const { deps, spies } = buildDeps({
      resolver: resolved("enforce"),
      approvedPrices: [50, 1200],
    });
    const hook = new PriceClaimGateHook(deps);
    const { ctx, result } = makeCtxAndResult("The consult is $50.");
    await hook.afterSkill(ctx, result);
    expect(result.response).toBe("The consult is $50.");
    expect(spies.verdictStore.save).not.toHaveBeenCalled();
  });

  it("blocks an unsubstantiated price in enforce mode: replaces output, saves verdict + handoff, flips status", async () => {
    const { deps, spies } = buildDeps({ resolver: resolved("enforce"), approvedPrices: [50] });
    const hook = new PriceClaimGateHook(deps);
    const { ctx, result } = makeCtxAndResult("That treatment is $999.");
    await hook.afterSkill(ctx, result);

    expect(result.response).toBe(HANDOFF_TEXT);
    expect(spies.verdictStore.save).toHaveBeenCalledTimes(1);
    const v = spies.verdictStore.save.mock.calls[0]![0] as SaveGovernanceVerdictInput;
    expect(v.action).toBe("block");
    expect(v.reasonCode).toBe("unsubstantiated_price");
    expect(v.sourceGuard).toBe("price_gate");
    expect(spies.handoffStore.save).toHaveBeenCalledTimes(1);
    expect(spies.conversationStore.setConversationStatus).toHaveBeenCalledWith(
      "sess-1",
      "org-1",
      "human_override",
    );
  });

  it("fails closed: blocks ANY price when the org has no approved prices (enforce)", async () => {
    const { deps, spies } = buildDeps({ resolver: resolved("enforce"), approvedPrices: [] });
    const hook = new PriceClaimGateHook(deps);
    const { ctx, result } = makeCtxAndResult("It's $50.");
    await hook.afterSkill(ctx, result);
    expect(result.response).toBe(HANDOFF_TEXT);
    expect(spies.verdictStore.save).toHaveBeenCalledTimes(1);
  });

  it("passes through when the reply states no price (enforce)", async () => {
    const { deps, spies } = buildDeps({ resolver: resolved("enforce"), approvedPrices: [] });
    const hook = new PriceClaimGateHook(deps);
    const { ctx, result } = makeCtxAndResult("Happy to get you booked for a consult!");
    await hook.afterSkill(ctx, result);
    expect(result.response).toBe("Happy to get you booked for a consult!");
    expect(spies.verdictStore.save).not.toHaveBeenCalled();
  });

  it("observe mode: logs an allow verdict but does NOT block", async () => {
    const { deps, spies } = buildDeps({ resolver: resolved("observe"), approvedPrices: [50] });
    const hook = new PriceClaimGateHook(deps);
    const { ctx, result } = makeCtxAndResult("That's $999.");
    await hook.afterSkill(ctx, result);
    expect(result.response).toBe("That's $999.");
    expect(spies.verdictStore.save).toHaveBeenCalledTimes(1);
    const v = spies.verdictStore.save.mock.calls[0]![0] as SaveGovernanceVerdictInput;
    expect(v.action).toBe("allow");
    expect(spies.handoffStore.save).not.toHaveBeenCalled();
    expect(spies.conversationStore.setConversationStatus).not.toHaveBeenCalled();
  });

  it("fails CLOSED on resolver error when the posture cache holds an enforce posture", async () => {
    const cache = new InMemoryGovernancePostureCache();
    cache.remember("dep-1", { mode: "enforce", jurisdiction: "SG", clinicType: "medical" });
    const { deps, spies } = buildDeps({
      resolver: async () => ({ status: "error" as const, error: new Error("db down") }),
      approvedPrices: [50],
      cache,
    });
    const hook = new PriceClaimGateHook(deps);
    const { ctx, result } = makeCtxAndResult("It's $999.");
    await hook.afterSkill(ctx, result);
    expect(result.response).toBe(HANDOFF_TEXT);
    expect(spies.verdictStore.save).toHaveBeenCalledTimes(1);
  });

  it("fails OPEN on resolver error when no cached enforce posture exists", async () => {
    const { deps, spies } = buildDeps({
      resolver: async () => ({ status: "error" as const, error: new Error("db down") }),
      approvedPrices: [50],
    });
    const hook = new PriceClaimGateHook(deps);
    const { ctx, result } = makeCtxAndResult("It's $999.");
    await hook.afterSkill(ctx, result);
    expect(result.response).toBe("It's $999.");
    expect(spies.verdictStore.save).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Enforce-flip slice 3 end-to-end proof: a config produced by the SAME
// setGateModeInConfig the writer uses, flipped deterministic -> enforce, actually
// changes the gate's behaviour at runtime — and only when flipped. This ties the
// pure write-shape to the live gate, closing the "does the flip do anything?" gap.
// ---------------------------------------------------------------------------
describe("PriceClaimGateHook — setGateModeInConfig flip changes behaviour end-to-end", () => {
  const observe = buildObserveGovernanceConfig({ jurisdiction: "SG", clinicType: "medical" });

  it("flipping deterministic -> enforce blocks an unapproved priced reply (producer populated)", async () => {
    const enforceConfig = setGateModeInConfig(observe, "deterministic", "enforce");
    const { deps, spies } = buildDeps({
      resolver: async () => ({ status: "resolved" as const, config: enforceConfig }),
      approvedPrices: [50, 1200], // populated -> the gate is ready; $250 is NOT approved
    });
    const hook = new PriceClaimGateHook(deps);
    const { ctx, result } = makeCtxAndResult("Our HydraFacial is $250.");
    await hook.afterSkill(ctx, result);

    expect(result.response).toBe(HANDOFF_TEXT); // reply replaced -> blocked
    expect(spies.conversationStore.setConversationStatus).toHaveBeenCalledWith(
      "sess-1",
      "org-1",
      "human_override",
    );
    expect(spies.verdictStore.save).toHaveBeenCalledWith(
      expect.objectContaining({ action: "block", sourceGuard: "price_gate" }),
    );
  });

  it("the same reply under the un-flipped observe config is unchanged (telemetry only)", async () => {
    const { deps, spies } = buildDeps({
      resolver: async () => ({ status: "resolved" as const, config: observe }),
      approvedPrices: [50, 1200],
    });
    const hook = new PriceClaimGateHook(deps);
    const { ctx, result } = makeCtxAndResult("Our HydraFacial is $250.");
    await hook.afterSkill(ctx, result);

    expect(result.response).toBe("Our HydraFacial is $250."); // unchanged
    expect(spies.conversationStore.setConversationStatus).not.toHaveBeenCalled();
    expect(spies.verdictStore.save).toHaveBeenCalledWith(
      expect.objectContaining({ action: "allow", sourceGuard: "price_gate" }),
    );
  });
});
