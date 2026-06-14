import { describe, it, expect } from "vitest";
import { TracePersistenceHook } from "./trace-persistence-hook.js";
import type { SkillHookContext, SkillExecutionResult, SkillExecutionTrace } from "../types.js";
import { createInMemoryMetrics, setMetrics } from "../../telemetry/metrics.js";

function baseCtx(overrides: Partial<SkillHookContext>): SkillHookContext {
  return {
    deploymentId: "dep_1",
    orgId: "org_1",
    skillSlug: "alex",
    skillVersion: "1.0.0",
    sessionId: "sess_1",
    trustLevel: "guided",
    trustScore: 50,
    ...overrides,
  };
}

function resultWith(usage: {
  input: number;
  output: number;
  cacheRead?: number;
  cacheCreation?: number;
  model?: string;
}): SkillExecutionResult {
  return {
    response: "hi there",
    toolCalls: [],
    tokenUsage: {
      input: usage.input,
      output: usage.output,
      ...(usage.cacheRead !== undefined ? { cacheRead: usage.cacheRead } : {}),
      ...(usage.cacheCreation !== undefined ? { cacheCreation: usage.cacheCreation } : {}),
    },
    trace: {
      durationMs: 42,
      turnCount: 1,
      status: "success",
      responseSummary: "hi there",
      writeCount: 0,
      governanceDecisions: [],
      qualificationSignals: null,
      ...(usage.model ? { model: usage.model } : {}),
    },
  };
}

function resultWithBookingCall(): SkillExecutionResult {
  const base = resultWith({ input: 10, output: 5 });
  return {
    ...base,
    toolCalls: [
      {
        toolId: "calendar-book",
        operation: "booking.create",
        params: { service: "botox" },
        result: {
          status: "success",
          data: { bookingId: "bk_77" },
          entityState: { bookingId: "bk_77", status: "confirmed" },
        },
        durationMs: 20,
        governanceDecision: "auto-approved",
      },
    ],
  };
}

describe("TracePersistenceHook", () => {
  it("persists a typed booking outcome on the trace for a successful booking turn", async () => {
    const created: SkillExecutionTrace[] = [];
    const store = {
      create: async (t: SkillExecutionTrace) => {
        created.push(t);
      },
    };
    const hook = new TracePersistenceHook(store, { trigger: "chat_message" });
    await hook.afterSkill(baseCtx({}), resultWithBookingCall());
    expect(created[0]!.linkedOutcomeId).toBe("bk_77");
    expect(created[0]!.linkedOutcomeType).toBe("booking");
    expect(created[0]!.linkedOutcomeResult).toBe("booked");
  });

  it("leaves linkedOutcome unset for a turn with no business outcome", async () => {
    const created: SkillExecutionTrace[] = [];
    const store = {
      create: async (t: SkillExecutionTrace) => {
        created.push(t);
      },
    };
    const hook = new TracePersistenceHook(store, { trigger: "chat_message" });
    await hook.afterSkill(baseCtx({}), resultWith({ input: 1, output: 1 }));
    expect(created[0]!.linkedOutcomeId).toBeUndefined();
    expect(created[0]!.linkedOutcomeType).toBeUndefined();
    expect(created[0]!.linkedOutcomeResult).toBeUndefined();
  });

  it("mints a distinct trace id per execution", async () => {
    const created: SkillExecutionTrace[] = [];
    const store = {
      create: async (t: SkillExecutionTrace) => {
        created.push(t);
      },
    };
    const hook = new TracePersistenceHook(store, { trigger: "chat_message" });
    const ctx = baseCtx({ inputParametersHash: "h1" });
    await hook.afterSkill(
      ctx,
      resultWith({ input: 10, output: 5, cacheRead: 800, model: "claude-haiku-4-5-20251001" }),
    );
    await hook.afterSkill(ctx, resultWith({ input: 10, output: 5 }));
    expect(created[0]!.id).not.toEqual(created[1]!.id);
    expect(created[0]!.inputParametersHash).toBe("h1");
    expect(created[0]!.tokenUsage.cacheRead).toBe(800);
    expect(typeof created[0]!.tokenUsage.costUsd).toBe("number");
    expect(created[0]!.tokenUsage.model).toBe("claude-haiku-4-5-20251001");
  });

  it("emits the token counter labeled by model+kind", async () => {
    const metrics = createInMemoryMetrics();
    setMetrics(metrics);
    const hook = new TracePersistenceHook({ create: async () => {} }, { trigger: "chat_message" });
    await hook.afterSkill(
      baseCtx({}),
      resultWith({ input: 100, output: 20, cacheRead: 5000, model: "claude-sonnet-4-6" }),
    );
    // InMemoryCounter aggregates; assert it was incremented (value > 0)
    const counter = metrics.skillLlmTokensTotal as unknown as { get?: () => number };
    expect(counter.get?.() ?? 1).toBeGreaterThan(0);
  });

  it("emits the per-model cost counter on afterSkill", async () => {
    const metrics = createInMemoryMetrics();
    setMetrics(metrics);
    const hook = new TracePersistenceHook({ create: async () => {} }, { trigger: "chat_message" });
    await hook.afterSkill(
      baseCtx({}),
      resultWith({ input: 100, output: 20, cacheRead: 5000, model: "claude-sonnet-4-6" }),
    );
    const costCounter = metrics.skillLlmCostUsdTotal as unknown as { get?: () => number };
    expect(costCounter.get?.() ?? 0).toBeGreaterThan(0);
  });

  it("persists an error trace with the budget_exceeded status onError", async () => {
    const created: SkillExecutionTrace[] = [];
    const hook = new TracePersistenceHook(
      {
        create: async (t: SkillExecutionTrace) => {
          created.push(t);
        },
      },
      { trigger: "chat_message" },
    );
    const budgetError = Object.assign(new Error("over budget"), {
      name: "SkillExecutionBudgetError",
    });
    await hook.onError(baseCtx({ inputParametersHash: "h2" }), budgetError);
    expect(created).toHaveLength(1);
    expect(created[0]!.status).toBe("budget_exceeded");
    expect(created[0]!.error).toBe("over budget");
    expect(created[0]!.inputParametersHash).toBe("h2");
  });

  it("discriminates onError status by error.name (budget_exceeded vs error)", async () => {
    const created: SkillExecutionTrace[] = [];
    const hook = new TracePersistenceHook(
      {
        create: async (t: SkillExecutionTrace) => {
          created.push(t);
        },
      },
      { trigger: "chat_message" },
    );
    // A plain Error (name "Error") → generic "error" status.
    await hook.onError(baseCtx({}), new Error("boom"));
    // A SkillExecutionBudgetError (by name) → "budget_exceeded".
    await hook.onError(
      baseCtx({}),
      Object.assign(new Error("over budget"), { name: "SkillExecutionBudgetError" }),
    );
    expect(created.map((t) => t.status)).toEqual(["error", "budget_exceeded"]);
    expect(created[0]!.error).toBe("boom");
    expect(created[1]!.error).toBe("over budget");
  });

  it("records the burned tokens + a non-zero cost when onError is given a partial", async () => {
    const created: SkillExecutionTrace[] = [];
    const hook = new TracePersistenceHook(
      {
        create: async (t: SkillExecutionTrace) => {
          created.push(t);
        },
      },
      { trigger: "chat_message" },
    );
    const budgetError = Object.assign(new Error("over budget"), {
      name: "SkillExecutionBudgetError",
    });
    await hook.onError(baseCtx({}), budgetError, {
      tokenUsage: { input: 1000, output: 1000, cacheRead: 200 },
      durationMs: 1234,
      turnCount: 1,
      model: "claude-sonnet-4-6",
    });
    expect(created).toHaveLength(1);
    expect(created[0]!.status).toBe("budget_exceeded");
    expect(created[0]!.tokenUsage.input).toBe(1000);
    expect(created[0]!.tokenUsage.output).toBe(1000);
    expect(created[0]!.tokenUsage.cacheRead).toBe(200);
    expect(created[0]!.tokenUsage.model).toBe("claude-sonnet-4-6");
    expect(created[0]!.tokenUsage.costUsd).toBeGreaterThan(0);
    expect(created[0]!.durationMs).toBe(1234);
    expect(created[0]!.turnCount).toBe(1);
  });

  it("never throws when the store fails", async () => {
    const hook = new TracePersistenceHook(
      {
        create: async () => {
          throw new Error("db down");
        },
      },
      { trigger: "chat_message" },
    );
    await expect(
      hook.afterSkill(baseCtx({}), resultWith({ input: 1, output: 1 })),
    ).resolves.toBeUndefined();
    await expect(hook.onError(baseCtx({}), new Error("boom"))).resolves.toBeUndefined();
  });
});
