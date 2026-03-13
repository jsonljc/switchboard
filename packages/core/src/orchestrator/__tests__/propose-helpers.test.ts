import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Policy, GuardrailConfig, ActionEnvelope } from "@switchboard/schemas";
import type { EvaluationContext } from "../../engine/rule-evaluator.js";
import {
  hydrateGuardrailState,
  extractQuorumFromPolicies,
  buildSpendLookup,
  buildCompositeContext,
  clearProposeCaches,
} from "../propose-helpers.js";
import { makeSharedContext, makeEnvelope } from "./helpers.js";

function makeGuardrailConfig(overrides?: Partial<GuardrailConfig>): GuardrailConfig {
  return { rateLimits: [], cooldowns: [], protectedEntities: [], ...overrides };
}

function makePolicy(overrides?: Partial<Policy>): Policy {
  return {
    id: "pol-1",
    name: "Test policy",
    description: "A test policy",
    organizationId: null,
    cartridgeId: null,
    priority: 10,
    active: true,
    rule: { composition: "AND", conditions: [] },
    effect: "require_approval",
    effectParams: { quorum: 2 },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeEvalContext(overrides?: Partial<EvaluationContext>): EvaluationContext {
  return {
    actionType: "send_payment",
    parameters: {},
    cartridgeId: "payments",
    principalId: "user-1",
    organizationId: null,
    riskCategory: "low",
    metadata: {},
    ...overrides,
  };
}

function makeStore() {
  return {
    getRateLimits: vi.fn().mockResolvedValue(new Map()),
    getCooldowns: vi.fn().mockResolvedValue(new Map()),
    setRateLimit: vi.fn(),
    setCooldown: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// hydrateGuardrailState
// ---------------------------------------------------------------------------

describe("hydrateGuardrailState", () => {
  it("returns early when guardrailStateStore is null", async () => {
    const ctx = makeSharedContext({ guardrailStateStore: null });
    const guardrails = makeGuardrailConfig({
      rateLimits: [{ scope: "global", maxActions: 10, windowMs: 60000 }],
    });
    await hydrateGuardrailState(ctx, guardrails, "send_payment", {});
    expect(ctx.guardrailState.actionCounts.size).toBe(0);
    expect(ctx.guardrailState.lastActionTimes.size).toBe(0);
  });

  it("returns early when guardrails is null", async () => {
    const store = makeStore();
    const ctx = makeSharedContext({ guardrailStateStore: store });
    await hydrateGuardrailState(ctx, null, "send_payment", {});
    expect(store.getRateLimits).not.toHaveBeenCalled();
    expect(store.getCooldowns).not.toHaveBeenCalled();
  });

  it("hydrates rate limits with global scope", async () => {
    const store = makeStore();
    store.getRateLimits.mockResolvedValue(new Map([["global", { count: 5, windowStart: 1000 }]]));
    const ctx = makeSharedContext({ guardrailStateStore: store });
    const guardrails = makeGuardrailConfig({
      rateLimits: [{ scope: "global", maxActions: 10, windowMs: 60000 }],
    });
    await hydrateGuardrailState(ctx, guardrails, "send_payment", {});
    expect(store.getRateLimits).toHaveBeenCalledWith(["global"]);
    expect(ctx.guardrailState.actionCounts.get("global")).toEqual({ count: 5, windowStart: 1000 });
  });

  it("hydrates rate limits with action-scoped keys", async () => {
    const key = "per_action:send_payment";
    const store = makeStore();
    store.getRateLimits.mockResolvedValue(new Map([[key, { count: 3, windowStart: 2000 }]]));
    const ctx = makeSharedContext({ guardrailStateStore: store });
    const guardrails = makeGuardrailConfig({
      rateLimits: [{ scope: "per_action", maxActions: 5, windowMs: 60000 }],
    });
    await hydrateGuardrailState(ctx, guardrails, "send_payment", {});
    expect(store.getRateLimits).toHaveBeenCalledWith([key]);
    expect(ctx.guardrailState.actionCounts.get(key)).toEqual({ count: 3, windowStart: 2000 });
  });

  it("hydrates cooldowns when actionType matches", async () => {
    const store = makeStore();
    store.getCooldowns.mockResolvedValue(new Map([["entity:ent-42", 99999]]));
    const ctx = makeSharedContext({ guardrailStateStore: store });
    const guardrails = makeGuardrailConfig({
      cooldowns: [{ actionType: "send_payment", cooldownMs: 5000, scope: "entity" }],
    });
    await hydrateGuardrailState(ctx, guardrails, "send_payment", { entityId: "ent-42" });
    expect(store.getCooldowns).toHaveBeenCalledWith(["entity:ent-42"]);
    expect(ctx.guardrailState.lastActionTimes.get("entity:ent-42")).toBe(99999);
  });

  it("hydrates cooldowns for wildcard actionType (*)", async () => {
    const store = makeStore();
    store.getCooldowns.mockResolvedValue(new Map([["entity:ent-7", 50000]]));
    const ctx = makeSharedContext({ guardrailStateStore: store });
    const guardrails = makeGuardrailConfig({
      cooldowns: [{ actionType: "*", cooldownMs: 5000, scope: "entity" }],
    });
    await hydrateGuardrailState(ctx, guardrails, "any_action", { entityId: "ent-7" });
    expect(ctx.guardrailState.lastActionTimes.get("entity:ent-7")).toBe(50000);
  });

  it("uses 'unknown' as entityId when not provided in parameters", async () => {
    const store = makeStore();
    const ctx = makeSharedContext({ guardrailStateStore: store });
    const guardrails = makeGuardrailConfig({
      cooldowns: [{ actionType: "send_payment", cooldownMs: 1000, scope: "entity" }],
    });
    await hydrateGuardrailState(ctx, guardrails, "send_payment", {});
    expect(store.getCooldowns).toHaveBeenCalledWith(["entity:unknown"]);
  });

  it("skips cooldown when actionType does not match", async () => {
    const store = makeStore();
    const ctx = makeSharedContext({ guardrailStateStore: store });
    const guardrails = makeGuardrailConfig({
      cooldowns: [{ actionType: "create_ad", cooldownMs: 1000, scope: "entity" }],
    });
    await hydrateGuardrailState(ctx, guardrails, "send_payment", { entityId: "ent-1" });
    expect(store.getCooldowns).not.toHaveBeenCalled();
  });

  it("handles empty rateLimits and cooldowns arrays", async () => {
    const store = makeStore();
    const ctx = makeSharedContext({ guardrailStateStore: store });
    const guardrails = makeGuardrailConfig({ rateLimits: [], cooldowns: [] });
    await hydrateGuardrailState(ctx, guardrails, "send_payment", {});
    expect(store.getRateLimits).not.toHaveBeenCalled();
    expect(store.getCooldowns).not.toHaveBeenCalled();
  });

  it("hydrates multiple rate limits and cooldowns concurrently", async () => {
    const store = makeStore();
    store.getRateLimits.mockResolvedValue(
      new Map([
        ["global", { count: 1, windowStart: 100 }],
        ["per_action:send_payment", { count: 2, windowStart: 200 }],
      ]),
    );
    store.getCooldowns.mockResolvedValue(new Map([["entity:ent-1", 55555]]));
    const ctx = makeSharedContext({ guardrailStateStore: store });
    const guardrails = makeGuardrailConfig({
      rateLimits: [
        { scope: "global", maxActions: 10, windowMs: 60000 },
        { scope: "per_action", maxActions: 5, windowMs: 60000 },
      ],
      cooldowns: [{ actionType: "send_payment", cooldownMs: 5000, scope: "entity" }],
    });
    await hydrateGuardrailState(ctx, guardrails, "send_payment", { entityId: "ent-1" });
    expect(ctx.guardrailState.actionCounts.size).toBe(2);
    expect(ctx.guardrailState.lastActionTimes.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// extractQuorumFromPolicies
// ---------------------------------------------------------------------------

describe("extractQuorumFromPolicies", () => {
  it("returns null when no policies are provided", () => {
    expect(extractQuorumFromPolicies([], makeEvalContext())).toBeNull();
  });

  it("returns null when no active policies exist", () => {
    expect(
      extractQuorumFromPolicies([makePolicy({ active: false })], makeEvalContext()),
    ).toBeNull();
  });

  it("returns null when no policy has require_approval effect", () => {
    expect(
      extractQuorumFromPolicies([makePolicy({ effect: "allow" })], makeEvalContext()),
    ).toBeNull();
  });

  it("returns null when policy has no effectParams", () => {
    expect(
      extractQuorumFromPolicies([makePolicy({ effectParams: undefined })], makeEvalContext()),
    ).toBeNull();
  });

  it("returns quorum when matching policy is found", () => {
    const policies = [
      makePolicy({
        effect: "require_approval",
        effectParams: { quorum: 3 },
        rule: { composition: "AND", conditions: [] },
      }),
    ];
    expect(extractQuorumFromPolicies(policies, makeEvalContext())).toBe(3);
  });

  it("skips policy when cartridgeId does not match", () => {
    const policies = [
      makePolicy({
        cartridgeId: "crm",
        effect: "require_approval",
        effectParams: { quorum: 2 },
        rule: { composition: "AND", conditions: [] },
      }),
    ];
    expect(
      extractQuorumFromPolicies(policies, makeEvalContext({ cartridgeId: "payments" })),
    ).toBeNull();
  });

  it("matches policy when cartridgeId matches", () => {
    const policies = [
      makePolicy({
        cartridgeId: "payments",
        effect: "require_approval",
        effectParams: { quorum: 5 },
        rule: { composition: "AND", conditions: [] },
      }),
    ];
    expect(extractQuorumFromPolicies(policies, makeEvalContext({ cartridgeId: "payments" }))).toBe(
      5,
    );
  });

  it("matches policy when cartridgeId is null (global policy)", () => {
    const policies = [
      makePolicy({
        cartridgeId: null,
        effect: "require_approval",
        effectParams: { quorum: 4 },
        rule: { composition: "AND", conditions: [] },
      }),
    ];
    expect(extractQuorumFromPolicies(policies, makeEvalContext())).toBe(4);
  });

  it("returns first matching policy by priority (lowest first)", () => {
    const policies = [
      makePolicy({ id: "high", priority: 100, effectParams: { quorum: 10 } }),
      makePolicy({ id: "low", priority: 1, effectParams: { quorum: 2 } }),
    ];
    expect(extractQuorumFromPolicies(policies, makeEvalContext())).toBe(2);
  });

  it("returns null when quorum value is not a number", () => {
    const policies = [makePolicy({ effectParams: { quorum: "two" } })];
    expect(extractQuorumFromPolicies(policies, makeEvalContext())).toBeNull();
  });

  it("returns null when quorum value is less than 1", () => {
    const policies = [makePolicy({ effectParams: { quorum: 0 } })];
    expect(extractQuorumFromPolicies(policies, makeEvalContext())).toBeNull();
  });

  it("skips policy when rule does not match the context", () => {
    const policies = [
      makePolicy({
        effectParams: { quorum: 3 },
        rule: {
          composition: "AND",
          conditions: [{ field: "actionType", operator: "eq", value: "create_ad" }],
        },
      }),
    ];
    expect(
      extractQuorumFromPolicies(policies, makeEvalContext({ actionType: "send_payment" })),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildSpendLookup
// ---------------------------------------------------------------------------

describe("buildSpendLookup", () => {
  const dayMs = 24 * 60 * 60 * 1000;

  beforeEach(() => {
    clearProposeCaches();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns zero spend when storage throws", async () => {
    const ctx = makeSharedContext();
    (ctx.storage.envelopes.list as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("DB"));
    const result = await buildSpendLookup(ctx, "principal-1");
    expect(result).toEqual({ dailySpend: 0, weeklySpend: 0, monthlySpend: 0 });
  });

  it("returns zero spend when no envelopes exist", async () => {
    const ctx = makeSharedContext();
    const result = await buildSpendLookup(ctx, "principal-1");
    expect(result).toEqual({ dailySpend: 0, weeklySpend: 0, monthlySpend: 0 });
  });

  it("ignores non-executed envelopes", async () => {
    const ctx = makeSharedContext();
    const env = makeEnvelope({
      status: "pending_approval",
      proposals: [{ id: "p1", actionType: "pay", parameters: { _principalId: "u1", amount: 100 } }],
    } as unknown as Partial<ActionEnvelope>);
    (ctx.storage.envelopes.list as ReturnType<typeof vi.fn>).mockResolvedValue([env]);
    expect(await buildSpendLookup(ctx, "u1")).toEqual({
      dailySpend: 0,
      weeklySpend: 0,
      monthlySpend: 0,
    });
  });

  it("ignores envelopes for a different principal", async () => {
    const ctx = makeSharedContext();
    const env = makeEnvelope({
      status: "executed",
      proposals: [
        { id: "p1", actionType: "pay", parameters: { _principalId: "other", amount: 500 } },
      ],
    } as unknown as Partial<ActionEnvelope>);
    (ctx.storage.envelopes.list as ReturnType<typeof vi.fn>).mockResolvedValue([env]);
    expect(await buildSpendLookup(ctx, "u1")).toEqual({
      dailySpend: 0,
      weeklySpend: 0,
      monthlySpend: 0,
    });
  });

  it("accumulates daily, weekly, and monthly spend from amount field", async () => {
    const now = Date.now();
    const ctx = makeSharedContext();
    const envs = [
      makeEnvelope({
        status: "executed",
        proposals: [
          { id: "p1", actionType: "pay", parameters: { _principalId: "u1", amount: 100 } },
        ],
        createdAt: new Date(now - 1000),
      } as unknown as Partial<ActionEnvelope>),
      makeEnvelope({
        id: "e2",
        status: "executed",
        proposals: [
          { id: "p2", actionType: "pay", parameters: { _principalId: "u1", amount: 200 } },
        ],
        createdAt: new Date(now - 3 * dayMs),
      } as unknown as Partial<ActionEnvelope>),
      makeEnvelope({
        id: "e3",
        status: "executed",
        proposals: [
          { id: "p3", actionType: "pay", parameters: { _principalId: "u1", amount: 400 } },
        ],
        createdAt: new Date(now - 15 * dayMs),
      } as unknown as Partial<ActionEnvelope>),
    ];
    (ctx.storage.envelopes.list as ReturnType<typeof vi.fn>).mockResolvedValue(envs);
    const result = await buildSpendLookup(ctx, "u1");
    expect(result.dailySpend).toBe(100);
    expect(result.weeklySpend).toBe(300);
    expect(result.monthlySpend).toBe(700);
  });

  it("accumulates spend from budgetChange field", async () => {
    const now = Date.now();
    const ctx = makeSharedContext();
    const env = makeEnvelope({
      status: "executed",
      proposals: [
        { id: "p1", actionType: "adj", parameters: { _principalId: "u1", budgetChange: -250 } },
      ],
      createdAt: new Date(now - 1000),
    } as unknown as Partial<ActionEnvelope>);
    (ctx.storage.envelopes.list as ReturnType<typeof vi.fn>).mockResolvedValue([env]);
    const result = await buildSpendLookup(ctx, "u1");
    expect(result.dailySpend).toBe(250);
    expect(result.weeklySpend).toBe(250);
    expect(result.monthlySpend).toBe(250);
  });

  it("ignores proposals with no amount or budgetChange", async () => {
    const now = Date.now();
    const ctx = makeSharedContext();
    const env = makeEnvelope({
      status: "executed",
      proposals: [{ id: "p1", actionType: "n", parameters: { _principalId: "u1" } }],
      createdAt: new Date(now - 1000),
    } as unknown as Partial<ActionEnvelope>);
    (ctx.storage.envelopes.list as ReturnType<typeof vi.fn>).mockResolvedValue([env]);
    expect(await buildSpendLookup(ctx, "u1")).toEqual({
      dailySpend: 0,
      weeklySpend: 0,
      monthlySpend: 0,
    });
  });

  it("excludes envelopes older than 30 days from monthly spend", async () => {
    const now = Date.now();
    const ctx = makeSharedContext();
    const env = makeEnvelope({
      status: "executed",
      proposals: [
        { id: "p1", actionType: "pay", parameters: { _principalId: "u1", amount: 1000 } },
      ],
      createdAt: new Date(now - 31 * dayMs),
    } as unknown as Partial<ActionEnvelope>);
    (ctx.storage.envelopes.list as ReturnType<typeof vi.fn>).mockResolvedValue([env]);
    expect(await buildSpendLookup(ctx, "u1")).toEqual({
      dailySpend: 0,
      weeklySpend: 0,
      monthlySpend: 0,
    });
  });

  it("passes organizationId to the storage query", async () => {
    const ctx = makeSharedContext();
    await buildSpendLookup(ctx, "u1", "org-42");
    expect(ctx.storage.envelopes.list).toHaveBeenCalledWith({
      limit: 500,
      organizationId: "org-42",
    });
  });
});

// ---------------------------------------------------------------------------
// buildCompositeContext
// ---------------------------------------------------------------------------

describe("buildCompositeContext", () => {
  beforeEach(() => {
    clearProposeCaches();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns undefined when storage throws", async () => {
    const ctx = makeSharedContext();
    (ctx.storage.envelopes.list as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("DB"));
    expect(await buildCompositeContext(ctx, "u1")).toBeUndefined();
  });

  it("returns undefined when no recent envelopes exist", async () => {
    expect(await buildCompositeContext(makeSharedContext(), "u1")).toBeUndefined();
  });

  it("returns undefined when all envelopes are older than 1 hour", async () => {
    const now = Date.now();
    const ctx = makeSharedContext();
    const env = makeEnvelope({
      proposals: [{ id: "p1", actionType: "pay", parameters: { _principalId: "u1" } }],
      createdAt: new Date(now - 2 * 60 * 60 * 1000),
    } as unknown as Partial<ActionEnvelope>);
    (ctx.storage.envelopes.list as ReturnType<typeof vi.fn>).mockResolvedValue([env]);
    expect(await buildCompositeContext(ctx, "u1")).toBeUndefined();
  });

  it("returns undefined when envelopes belong to a different principal", async () => {
    const now = Date.now();
    const ctx = makeSharedContext();
    const env = makeEnvelope({
      proposals: [{ id: "p1", actionType: "pay", parameters: { _principalId: "other" } }],
      createdAt: new Date(now - 1000),
    } as unknown as Partial<ActionEnvelope>);
    (ctx.storage.envelopes.list as ReturnType<typeof vi.fn>).mockResolvedValue([env]);
    expect(await buildCompositeContext(ctx, "u1")).toBeUndefined();
  });

  it("returns composite context with correct action count", async () => {
    const now = Date.now();
    const ctx = makeSharedContext();
    const dt = {
      actionId: "a",
      envelopeId: "e",
      checks: [],
      computedRiskScore: { rawScore: 0, category: "low" as const, factors: [] },
      finalDecision: "allow" as const,
      approvalRequired: "none" as const,
      explanation: "",
      evaluatedAt: new Date(),
    };
    const envs = [
      makeEnvelope({
        proposals: [{ id: "p1", actionType: "pay", parameters: { _principalId: "u1" } }],
        decisions: [dt],
        createdAt: new Date(now - 1000),
      } as unknown as Partial<ActionEnvelope>),
      makeEnvelope({
        id: "e2",
        proposals: [{ id: "p2", actionType: "x", parameters: { _principalId: "u1" } }],
        decisions: [dt],
        createdAt: new Date(now - 2000),
      } as unknown as Partial<ActionEnvelope>),
    ];
    (ctx.storage.envelopes.list as ReturnType<typeof vi.fn>).mockResolvedValue(envs);
    const result = await buildCompositeContext(ctx, "u1");
    expect(result).toBeDefined();
    expect(result!.recentActionCount).toBe(2);
    expect(result!.windowMs).toBe(3600000);
  });

  it("accumulates cumulativeExposure from dollars_at_risk factors", async () => {
    const now = Date.now();
    const ctx = makeSharedContext();
    const env = makeEnvelope({
      proposals: [{ id: "p1", actionType: "pay", parameters: { _principalId: "u1" } }],
      decisions: [
        {
          actionId: "a",
          envelopeId: "e",
          checks: [],
          computedRiskScore: {
            rawScore: 30,
            category: "medium",
            factors: [{ factor: "dollars_at_risk", weight: 1, contribution: 500, detail: "" }],
          },
          finalDecision: "allow",
          approvalRequired: "none",
          explanation: "",
          evaluatedAt: new Date(),
        },
      ],
      createdAt: new Date(now - 1000),
    } as unknown as Partial<ActionEnvelope>);
    (ctx.storage.envelopes.list as ReturnType<typeof vi.fn>).mockResolvedValue([env]);
    const result = await buildCompositeContext(ctx, "u1");
    expect(result!.cumulativeExposure).toBe(500);
  });

  it("counts distinct target entities", async () => {
    const now = Date.now();
    const ctx = makeSharedContext();
    const dt = {
      actionId: "a",
      envelopeId: "e",
      checks: [],
      computedRiskScore: { rawScore: 0, category: "low" as const, factors: [] },
      finalDecision: "allow" as const,
      approvalRequired: "none" as const,
      explanation: "",
      evaluatedAt: new Date(),
    };
    const env = makeEnvelope({
      proposals: [
        { id: "p1", actionType: "pay", parameters: { _principalId: "u1", entityId: "c1" } },
        { id: "p2", actionType: "pay", parameters: { _principalId: "u1", entityId: "c2" } },
        { id: "p3", actionType: "pay", parameters: { _principalId: "u1", entityId: "c1" } },
      ],
      decisions: [dt],
      createdAt: new Date(now - 1000),
    } as unknown as Partial<ActionEnvelope>);
    (ctx.storage.envelopes.list as ReturnType<typeof vi.fn>).mockResolvedValue([env]);
    expect((await buildCompositeContext(ctx, "u1"))!.distinctTargetEntities).toBe(2);
  });

  it("counts distinct cartridges", async () => {
    const now = Date.now();
    const ctx = makeSharedContext();
    const dt = {
      actionId: "a",
      envelopeId: "e",
      checks: [],
      computedRiskScore: { rawScore: 0, category: "low" as const, factors: [] },
      finalDecision: "allow" as const,
      approvalRequired: "none" as const,
      explanation: "",
      evaluatedAt: new Date(),
    };
    const envs = [
      makeEnvelope({
        proposals: [
          {
            id: "p1",
            actionType: "pay",
            parameters: { _principalId: "u1", _cartridgeId: "payments" },
          },
        ],
        decisions: [dt],
        createdAt: new Date(now - 1000),
      } as unknown as Partial<ActionEnvelope>),
      makeEnvelope({
        id: "e2",
        proposals: [
          { id: "p2", actionType: "x", parameters: { _principalId: "u1", _cartridgeId: "crm" } },
        ],
        decisions: [dt],
        createdAt: new Date(now - 2000),
      } as unknown as Partial<ActionEnvelope>),
    ];
    (ctx.storage.envelopes.list as ReturnType<typeof vi.fn>).mockResolvedValue(envs);
    expect((await buildCompositeContext(ctx, "u1"))!.distinctCartridges).toBe(2);
  });

  it("passes organizationId to the storage query", async () => {
    const ctx = makeSharedContext();
    await buildCompositeContext(ctx, "u1", "org-99");
    expect(ctx.storage.envelopes.list).toHaveBeenCalledWith({
      limit: 200,
      organizationId: "org-99",
    });
  });

  it("returns zero cumulative exposure when no dollars_at_risk factors exist", async () => {
    const now = Date.now();
    const ctx = makeSharedContext();
    const env = makeEnvelope({
      proposals: [{ id: "p1", actionType: "pay", parameters: { _principalId: "u1" } }],
      decisions: [
        {
          actionId: "a",
          envelopeId: "e",
          checks: [],
          computedRiskScore: {
            rawScore: 5,
            category: "low",
            factors: [{ factor: "blast_radius", weight: 0.5, contribution: 10, detail: "" }],
          },
          finalDecision: "allow",
          approvalRequired: "none",
          explanation: "",
          evaluatedAt: new Date(),
        },
      ],
      createdAt: new Date(now - 1000),
    } as unknown as Partial<ActionEnvelope>);
    (ctx.storage.envelopes.list as ReturnType<typeof vi.fn>).mockResolvedValue([env]);
    expect((await buildCompositeContext(ctx, "u1"))!.cumulativeExposure).toBe(0);
  });
});
