import { describe, it, expect, vi } from "vitest";
import { DeterministicSafetyGateHook } from "../deterministic-safety-gate.js";
import type { DeterministicSafetyGateHookDeps } from "../deterministic-safety-gate.js";
import { InMemoryGovernancePostureCache } from "../../../governance/posture-cache.js";
import type { SaveGovernanceVerdictInput } from "../../../governance/governance-verdict-store/types.js";
import type { SkillHookContext, SkillExecutionResult } from "../../types.js";

// ---------------------------------------------------------------------------
// Mock store shapes — plain objects with vi.fn() spies (untyped generics)
// ---------------------------------------------------------------------------

type Spy = ReturnType<typeof vi.fn>;

interface VerdictStoreSpy {
  save: Spy;
  listByConversation: Spy;
  listByDeployment: Spy;
}

interface HandoffStoreSpy {
  save: Spy;
  getById: Spy;
  getBySessionId: Spy;
  updateStatus: Spy;
  listPending: Spy;
}

interface ConversationStoreSpy {
  setConversationStatus: Spy;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BANNED_ENTRIES = [
  {
    id: "g1",
    category: "guarantee" as const,
    patterns: ["guaranteed"],
    severity: "block" as const,
  },
];

const RESOLVED_VERDICT_RECORD = {
  id: "v1",
  action: "block" as const,
  reasonCode: "unsupported_claim" as const,
  jurisdiction: "SG" as const,
  clinicType: "medical" as const,
  sourceGuard: "banned_phrase_scanner" as const,
  auditLevel: "critical" as const,
  decidedAt: "2026-05-10T12:00:00.000Z",
  conversationId: "sess-1",
  deploymentId: "dep-1",
  details: null,
  createdAt: "2026-05-10T12:00:00.000Z",
};

function makeVerdictStoreSpy(): VerdictStoreSpy {
  return {
    save: vi.fn().mockResolvedValue(RESOLVED_VERDICT_RECORD),
    listByConversation: vi.fn(),
    listByDeployment: vi.fn(),
  };
}

function makeHandoffStoreSpy(): HandoffStoreSpy {
  return {
    save: vi.fn().mockResolvedValue(undefined),
    getById: vi.fn(),
    getBySessionId: vi.fn(),
    updateStatus: vi.fn(),
    listPending: vi.fn(),
  };
}

function makeConversationStoreSpy(): ConversationStoreSpy {
  return {
    setConversationStatus: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Builds deps with sensible vi.fn() defaults. Overrides replace specific deps.
 */
function buildDeps(
  overrides: {
    resolver?: DeterministicSafetyGateHookDeps["governanceConfigResolver"];
    store?: VerdictStoreSpy;
    handoff?: HandoffStoreSpy;
    conv?: ConversationStoreSpy;
    banned?: typeof BANNED_ENTRIES;
    cache?: InMemoryGovernancePostureCache;
  } = {},
): {
  deps: DeterministicSafetyGateHookDeps;
  spies: {
    verdictStore: VerdictStoreSpy;
    handoffStore: HandoffStoreSpy;
    conversationStore: ConversationStoreSpy;
  };
} {
  const verdictStore = overrides.store ?? makeVerdictStoreSpy();
  const handoffStore = overrides.handoff ?? makeHandoffStoreSpy();
  const conversationStore = overrides.conv ?? makeConversationStoreSpy();
  const banned = overrides.banned ?? BANNED_ENTRIES;
  const cache = overrides.cache ?? new InMemoryGovernancePostureCache();
  const resolver: DeterministicSafetyGateHookDeps["governanceConfigResolver"] =
    overrides.resolver ?? (async () => ({ status: "missing" as const }));

  const deps: DeterministicSafetyGateHookDeps = {
    governanceConfigResolver: resolver,
    bannedPhraseLoader: () => banned as never,
    verdictStore: verdictStore as never,
    handoffStore: handoffStore as never,
    conversationStore: conversationStore as never,
    postureCache: cache,
    clock: () => new Date("2026-05-10T12:00:00.000Z"),
  };

  return { deps, spies: { verdictStore, handoffStore, conversationStore } };
}

/**
 * Build a real SkillHookContext + SkillExecutionResult pair.
 * `text` is the LLM response string (the value the hook scans and may mutate).
 */
function makeCtxAndResult(
  text: string,
  deploymentId = "dep-1",
): { ctx: SkillHookContext; result: SkillExecutionResult } {
  const ctx: SkillHookContext = {
    deploymentId,
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DeterministicSafetyGateHook.afterSkill", () => {
  it("passes through when config is missing", async () => {
    const { deps, spies } = buildDeps();
    const hook = new DeterministicSafetyGateHook(deps);
    const { ctx, result } = makeCtxAndResult("This is guaranteed.");
    await hook.afterSkill(ctx, result);
    expect(result.response).toBe("This is guaranteed.");
    expect(spies.verdictStore.save).not.toHaveBeenCalled();
  });

  it("passes through and persists nothing when mode is off", async () => {
    const { deps, spies } = buildDeps({
      resolver: async () => ({
        status: "resolved",
        config: {
          jurisdiction: "SG",
          clinicType: "medical",
          deterministicGate: { mode: "off" },
        },
      }),
    });
    const hook = new DeterministicSafetyGateHook(deps);
    const { ctx, result } = makeCtxAndResult("This is guaranteed.");
    await hook.afterSkill(ctx, result);
    expect(result.response).toBe("This is guaranteed.");
    expect(spies.verdictStore.save).not.toHaveBeenCalled();
  });

  it("logs verdict but does not block in observe mode on match", async () => {
    const { deps, spies } = buildDeps({
      resolver: async () => ({
        status: "resolved",
        config: {
          jurisdiction: "SG",
          clinicType: "medical",
          deterministicGate: { mode: "observe" },
        },
      }),
    });
    const hook = new DeterministicSafetyGateHook(deps);
    const { ctx, result } = makeCtxAndResult("This is guaranteed.");
    await hook.afterSkill(ctx, result);
    // Output unchanged in observe mode.
    expect(result.response).toBe("This is guaranteed.");
    expect(spies.verdictStore.save).toHaveBeenCalledTimes(1);
    const savedArg = spies.verdictStore.save.mock.calls[0]![0] as SaveGovernanceVerdictInput;
    expect(savedArg.action).toBe("allow");
    expect(spies.handoffStore.save).not.toHaveBeenCalled();
    expect(spies.conversationStore.setConversationStatus).not.toHaveBeenCalled();
  });

  it("blocks, replaces output with handoff template, flips status, saves handoff in enforce mode", async () => {
    const { deps, spies } = buildDeps({
      resolver: async () => ({
        status: "resolved",
        config: {
          jurisdiction: "SG",
          clinicType: "medical",
          deterministicGate: { mode: "enforce" },
        },
      }),
    });
    const hook = new DeterministicSafetyGateHook(deps);
    const { ctx, result } = makeCtxAndResult("This is guaranteed.");
    await hook.afterSkill(ctx, result);
    expect(result.response).toContain("clinic team");
    const savedArg = spies.verdictStore.save.mock.calls[0]![0] as SaveGovernanceVerdictInput;
    expect(savedArg.action).toBe("block");
    expect(spies.handoffStore.save).toHaveBeenCalledTimes(1);
    expect(spies.conversationStore.setConversationStatus).toHaveBeenCalledWith(
      "sess-1",
      "org-1",
      "human_override",
    );
  });

  it("does not persist when mode is enforce and no banned phrase is present", async () => {
    const { deps, spies } = buildDeps({
      resolver: async () => ({
        status: "resolved",
        config: {
          jurisdiction: "SG",
          clinicType: "medical",
          deterministicGate: { mode: "enforce" },
        },
      }),
    });
    const hook = new DeterministicSafetyGateHook(deps);
    const { ctx, result } = makeCtxAndResult("Our consultation includes an honest assessment.");
    await hook.afterSkill(ctx, result);
    expect(spies.verdictStore.save).not.toHaveBeenCalled();
  });

  it("fail-open on resolver error with cold cache (no verdict, output unchanged)", async () => {
    const { deps, spies } = buildDeps({
      resolver: async () => ({ status: "error", error: new Error("db blip") }),
    });
    const hook = new DeterministicSafetyGateHook(deps);
    const { ctx, result } = makeCtxAndResult("This is guaranteed.");
    await hook.afterSkill(ctx, result);
    expect(result.response).toBe("This is guaranteed.");
    expect(spies.verdictStore.save).not.toHaveBeenCalled();
  });

  it("fail-closed on resolver error with cache lastKnown.mode=enforce (SG)", async () => {
    const cache = new InMemoryGovernancePostureCache();
    cache.remember("dep-1", { mode: "enforce", jurisdiction: "SG", clinicType: "medical" });
    const { deps, spies } = buildDeps({
      cache,
      resolver: async () => ({ status: "error", error: new Error("db blip") }),
    });
    const hook = new DeterministicSafetyGateHook(deps);
    const { ctx, result } = makeCtxAndResult("This is guaranteed.");
    await hook.afterSkill(ctx, result);
    expect(result.response).toContain("clinic team");
    expect(result.response).toContain("I'll get them"); // SG handoff phrasing
    expect(spies.verdictStore.save).toHaveBeenCalledTimes(1);
    const saved = spies.verdictStore.save.mock.calls[0]![0] as SaveGovernanceVerdictInput;
    expect(saved.reasonCode).toBe("governance_unavailable");
    expect(saved.jurisdiction).toBe("SG");
    expect(saved.clinicType).toBe("medical");
  });

  it("fail-closed uses cached MY/nonMedical posture (NOT a hardcoded SG default)", async () => {
    const cache = new InMemoryGovernancePostureCache();
    cache.remember("dep_my", { mode: "enforce", jurisdiction: "MY", clinicType: "nonMedical" });
    const { deps, spies } = buildDeps({
      cache,
      resolver: async () => ({ status: "error", error: new Error("db blip") }),
    });
    const hook = new DeterministicSafetyGateHook(deps);
    const { ctx, result } = makeCtxAndResult("This is guaranteed.", "dep_my");
    await hook.afterSkill(ctx, result);
    expect(result.response).toContain("I'll have them"); // MY handoff phrasing
    const saved = spies.verdictStore.save.mock.calls[0]![0] as SaveGovernanceVerdictInput;
    expect(saved.jurisdiction).toBe("MY");
    expect(saved.clinicType).toBe("nonMedical");
  });

  it("still applies the block when verdictStore.save throws", async () => {
    const failingVerdictStore = {
      save: vi.fn().mockRejectedValue(new Error("disk full")),
      listByConversation: vi.fn(),
      listByDeployment: vi.fn(),
    };
    const { deps, spies } = buildDeps({
      resolver: async () => ({
        status: "resolved",
        config: {
          jurisdiction: "SG",
          clinicType: "medical",
          deterministicGate: { mode: "enforce" },
        },
      }),
      store: failingVerdictStore,
    });
    const hook = new DeterministicSafetyGateHook(deps);
    const { ctx, result } = makeCtxAndResult("This is guaranteed.");
    await hook.afterSkill(ctx, result);
    expect(result.response).toContain("clinic team");
    expect(spies.conversationStore.setConversationStatus).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // EV-9b / GOV-8 — a persistence failure must NOT let a banned phrase through.
  // The existing case above covers verdictStore.save throwing; these cover the
  // other two side-stores. The hook's contract is emission integrity >
  // persistence completeness: when handoffStore or conversationStore throw, the
  // error is swallowed and the banned output is STILL replaced with the handoff
  // template. The redaction (`result.response = handoffText`) is the last step,
  // so any unguarded throw in those writes would skip it and leak the phrase.
  // -------------------------------------------------------------------------

  it("GOV-8: still blocks (redacts output) when handoffStore.save throws", async () => {
    const failingHandoffStore = {
      save: vi.fn().mockRejectedValue(new Error("handoff store down")),
      getById: vi.fn(),
      getBySessionId: vi.fn(),
      updateStatus: vi.fn(),
      listPending: vi.fn(),
    };
    const { deps, spies } = buildDeps({
      resolver: async () => ({
        status: "resolved",
        config: {
          jurisdiction: "SG",
          clinicType: "medical",
          deterministicGate: { mode: "enforce" },
        },
      }),
      handoff: failingHandoffStore,
    });
    const hook = new DeterministicSafetyGateHook(deps);
    const { ctx, result } = makeCtxAndResult("This is guaranteed.");
    await hook.afterSkill(ctx, result);
    // The banned phrase is gone; the handoff template is in its place.
    expect(result.response).not.toContain("guaranteed");
    expect(result.response).toContain("clinic team");
    expect(spies.handoffStore.save).toHaveBeenCalled();
  });

  it("GOV-8: still blocks (redacts output) when conversationStore.setConversationStatus throws", async () => {
    const failingConversationStore = {
      setConversationStatus: vi.fn().mockRejectedValue(new Error("status store down")),
    };
    const { deps, spies } = buildDeps({
      resolver: async () => ({
        status: "resolved",
        config: {
          jurisdiction: "SG",
          clinicType: "medical",
          deterministicGate: { mode: "enforce" },
        },
      }),
      conv: failingConversationStore,
    });
    const hook = new DeterministicSafetyGateHook(deps);
    const { ctx, result } = makeCtxAndResult("This is guaranteed.");
    await hook.afterSkill(ctx, result);
    expect(result.response).not.toContain("guaranteed");
    expect(result.response).toContain("clinic team");
    // The status flip was attempted (and threw); the handoff persist still ran.
    expect(spies.conversationStore.setConversationStatus).toHaveBeenCalled();
    expect(spies.handoffStore.save).toHaveBeenCalled();
  });
});

describe("DeterministicSafetyGateHook vertical threading (SH-3)", () => {
  function makeRecordingDeps(
    config: Record<string, unknown>,
    cache?: InMemoryGovernancePostureCache,
  ): {
    deps: DeterministicSafetyGateHookDeps;
    calls: Array<{ jurisdiction: unknown; vertical: unknown }>;
  } {
    const calls: Array<{ jurisdiction: unknown; vertical: unknown }> = [];
    const deps: DeterministicSafetyGateHookDeps = {
      governanceConfigResolver: async () => ({
        status: "resolved" as const,
        config: config as never,
      }),
      bannedPhraseLoader: ((jurisdiction: unknown, vertical: unknown) => {
        calls.push({ jurisdiction, vertical });
        return BANNED_ENTRIES as never;
      }) as never,
      verdictStore: makeVerdictStoreSpy() as never,
      handoffStore: makeHandoffStoreSpy() as never,
      conversationStore: makeConversationStoreSpy() as never,
      postureCache: cache ?? new InMemoryGovernancePostureCache(),
      clock: () => new Date("2026-05-10T12:00:00.000Z"),
    };
    return { deps, calls };
  }

  it("threads the resolved vertical marker into the banned-phrase loader", async () => {
    const { deps, calls } = makeRecordingDeps({
      jurisdiction: "SG",
      clinicType: "nonMedical",
      deterministicGate: { mode: "observe" },
      vertical: "generic",
    });
    const hook = new DeterministicSafetyGateHook(deps);
    const { ctx, result } = makeCtxAndResult("This is guaranteed.");
    await hook.afterSkill(ctx, result);
    expect(calls).toContainEqual({ jurisdiction: "SG", vertical: "generic" });
  });

  it("defaults to the medspa vertical when the config carries no marker (byte-identical)", async () => {
    const { deps, calls } = makeRecordingDeps({
      jurisdiction: "SG",
      clinicType: "medical",
      deterministicGate: { mode: "observe" },
    });
    const hook = new DeterministicSafetyGateHook(deps);
    const { ctx, result } = makeCtxAndResult("This is guaranteed.");
    await hook.afterSkill(ctx, result);
    expect(calls).toContainEqual({ jurisdiction: "SG", vertical: "medspa" });
  });

  it("caches the vertical in the posture so the fail-closed path can thread it", async () => {
    const cache = new InMemoryGovernancePostureCache();
    const { deps } = makeRecordingDeps(
      {
        jurisdiction: "SG",
        clinicType: "nonMedical",
        deterministicGate: { mode: "enforce" },
        vertical: "generic",
      },
      cache,
    );
    const hook = new DeterministicSafetyGateHook(deps);
    const { ctx, result } = makeCtxAndResult("A clean, honest sentence.");
    await hook.afterSkill(ctx, result);
    expect(cache.lastKnown("dep-1")?.vertical).toBe("generic");
  });

  // ---------------------------------------------------------------------------
  // Cached-enforce (resolver-error) path — asserts the SECOND argument passed
  // to bannedPhraseLoader (the vertical), mirroring handleResolverError's
  // `posture.vertical ?? DEFAULT_VERTICAL` expression at deterministic-safety-
  // gate.ts:249. Existing resolver-error tests above predate SH-3's vertical
  // threading and never assert this argument.
  // ---------------------------------------------------------------------------

  function makeResolverErrorRecordingDeps(cache: InMemoryGovernancePostureCache): {
    deps: DeterministicSafetyGateHookDeps;
    calls: Array<{ jurisdiction: unknown; vertical: unknown }>;
  } {
    const calls: Array<{ jurisdiction: unknown; vertical: unknown }> = [];
    const deps: DeterministicSafetyGateHookDeps = {
      governanceConfigResolver: async () => ({
        status: "error" as const,
        error: new Error("db blip"),
      }),
      bannedPhraseLoader: ((jurisdiction: unknown, vertical: unknown) => {
        calls.push({ jurisdiction, vertical });
        return BANNED_ENTRIES as never;
      }) as never,
      verdictStore: makeVerdictStoreSpy() as never,
      handoffStore: makeHandoffStoreSpy() as never,
      conversationStore: makeConversationStoreSpy() as never,
      postureCache: cache,
      clock: () => new Date("2026-05-10T12:00:00.000Z"),
    };
    return { deps, calls };
  }

  it("cached-enforce resolver-error path threads the cached vertical (MY/generic)", async () => {
    const cache = new InMemoryGovernancePostureCache();
    cache.remember("dep-1", {
      mode: "enforce",
      jurisdiction: "MY",
      clinicType: "nonMedical",
      vertical: "generic",
    });
    const { deps, calls } = makeResolverErrorRecordingDeps(cache);
    const hook = new DeterministicSafetyGateHook(deps);
    const { ctx, result } = makeCtxAndResult("This is guaranteed.");
    await hook.afterSkill(ctx, result);
    expect(calls).toContainEqual({ jurisdiction: "MY", vertical: "generic" });
  });

  it("cached-enforce resolver-error path falls back to DEFAULT_VERTICAL when the cached posture carries no vertical", async () => {
    const cache = new InMemoryGovernancePostureCache();
    cache.remember("dep-1", { mode: "enforce", jurisdiction: "MY", clinicType: "nonMedical" });
    const { deps, calls } = makeResolverErrorRecordingDeps(cache);
    const hook = new DeterministicSafetyGateHook(deps);
    const { ctx, result } = makeCtxAndResult("This is guaranteed.");
    await hook.afterSkill(ctx, result);
    expect(calls).toContainEqual({ jurisdiction: "MY", vertical: "medspa" });
  });
});
