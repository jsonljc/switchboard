// ---------------------------------------------------------------------------
// Tests for startAgentRunner — background cron job that ticks agents
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the core agents so we can control tick behavior per test
const mockTick = vi.fn();
vi.mock("@switchboard/core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  class StubAgent {
    constructor(
      public id: string,
      public name: string,
    ) {}
    tick = mockTick;
  }
  return {
    ...actual,
    OptimizerAgent: class extends StubAgent {
      constructor() {
        super("optimizer", "Optimizer Agent");
      }
    },
    ReporterAgent: class extends StubAgent {
      constructor() {
        super("reporter", "Reporter Agent");
      }
    },
    MonitorAgent: class extends StubAgent {
      constructor() {
        super("monitor", "Monitor Agent");
      }
    },
    GuardrailAgent: class extends StubAgent {
      constructor() {
        super("guardrail", "Guardrail Agent");
      }
    },
    StrategistAgent: class extends StubAgent {
      constructor() {
        super("strategist", "Strategist Agent");
      }
    },
  };
});

import { startAgentRunner } from "../jobs/agent-runner.js";
import type { AgentRunnerConfig } from "../jobs/agent-runner.js";
import type { AdsOperatorConfig } from "@switchboard/schemas";

// ── Mock helpers ────────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<AdsOperatorConfig>): AdsOperatorConfig {
  return {
    id: "op_1",
    organizationId: "org_1",
    adAccountIds: ["act_123"],
    platforms: ["meta"],
    automationLevel: "supervised",
    targets: { cpa: 15, roas: 3, dailyBudgetCap: 100 },
    schedule: { optimizerCronHour: 6, reportCronHour: 9, timezone: "UTC" },
    notificationChannel: { type: "telegram", chatId: "chat_1" },
    principalId: "user_1",
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AdsOperatorConfig;
}

function makeRunnerConfig(overrides?: Partial<AgentRunnerConfig>): AgentRunnerConfig {
  return {
    storageContext: {} as AgentRunnerConfig["storageContext"],
    orchestrator: {
      resolveAndPropose: vi.fn().mockResolvedValue({ denied: false, envelope: { id: "env-1" } }),
      executeApproved: vi.fn().mockResolvedValue({ success: true, data: [], externalRefs: {} }),
    } as unknown as AgentRunnerConfig["orchestrator"],
    notifier: { sendProactive: vi.fn().mockResolvedValue(undefined) },
    operatorConfigs: [makeConfig()],
    intervalMs: 100, // fast interval for testing
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as unknown as AgentRunnerConfig["logger"],
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("startAgentRunner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockTick.mockResolvedValue({ agentId: "stub", actions: [], summary: "ok" });
  });

  afterEach(() => {
    vi.useRealTimers();
    mockTick.mockReset();
  });

  it("returns a cleanup function", () => {
    // Set time to a non-matching hour so no agents tick on start
    vi.setSystemTime(new Date(Date.UTC(2026, 2, 8, 0, 0, 0)));

    const cleanup = startAgentRunner(makeRunnerConfig());
    expect(typeof cleanup).toBe("function");
    cleanup();
  });

  it("ticks agents when cron hour matches", async () => {
    // Set the hour to 6 so optimizerCronHour (6) matches
    vi.setSystemTime(new Date(Date.UTC(2026, 2, 8, 6, 15, 0)));

    const cfg = makeRunnerConfig();

    const cleanup = startAgentRunner(cfg);

    // The runner runs immediately on start — flush the initial cycle
    await vi.advanceTimersByTimeAsync(150);

    // Agents whose cron hour matches (optimizer, guardrail at hour 6) should tick
    expect(mockTick).toHaveBeenCalled();
    // optimizer and guardrail run at optimizerCronHour = 6
    // reporter and monitor run at reportCronHour = 9
    // strategist runs weekly at reportCronHour on strategistCronDay (Monday, not Sunday)
    expect(mockTick.mock.calls.length).toBeGreaterThanOrEqual(2);

    cleanup();
  });

  it("does not tick when cron hour does not match", async () => {
    // Set hour to 14 — neither optimizerCronHour (6) nor reportCronHour (9) match
    vi.setSystemTime(new Date(Date.UTC(2026, 2, 8, 14, 0, 0)));

    const cfg = makeRunnerConfig();

    const cleanup = startAgentRunner(cfg);

    // Let the immediate cycle + one interval run
    await vi.advanceTimersByTimeAsync(150);

    expect(mockTick).not.toHaveBeenCalled();

    cleanup();
  });

  it("stops when cleanup is called", async () => {
    // Set hour to 6 to match
    vi.setSystemTime(new Date(Date.UTC(2026, 2, 8, 6, 0, 0)));

    const cfg = makeRunnerConfig();

    const cleanup = startAgentRunner(cfg);

    // Flush the immediate cycle
    await vi.advanceTimersByTimeAsync(50);

    const callCountBefore = mockTick.mock.calls.length;

    // Stop the runner
    cleanup();

    // Advance well past the next interval
    await vi.advanceTimersByTimeAsync(500);

    // No additional ticks should have occurred after cleanup
    expect(mockTick.mock.calls.length).toBe(callCountBefore);
  });

  it("handles tick errors gracefully", async () => {
    // Set hour to 6 so ticks fire
    vi.setSystemTime(new Date(Date.UTC(2026, 2, 8, 6, 0, 0)));

    // Make agent tick throw
    mockTick.mockRejectedValue(new Error("network failure"));

    const cfg = makeRunnerConfig();
    const logger = cfg.logger as unknown as {
      error: ReturnType<typeof vi.fn>;
      info: ReturnType<typeof vi.fn>;
    };

    // startAgentRunner should not throw even if agent ticks fail
    const cleanup = startAgentRunner(cfg);

    await vi.advanceTimersByTimeAsync(150);

    // The runner logs errors rather than crashing
    expect(logger.error).toHaveBeenCalled();

    cleanup();
  });

  it("skips inactive configs", async () => {
    // Set hour to 6
    vi.setSystemTime(new Date(Date.UTC(2026, 2, 8, 6, 0, 0)));

    const inactiveConfig = makeConfig({ active: false });
    const cfg = makeRunnerConfig({ operatorConfigs: [inactiveConfig] });

    const cleanup = startAgentRunner(cfg);

    await vi.advanceTimersByTimeAsync(150);

    // No agents should tick because the only config is inactive
    expect(mockTick).not.toHaveBeenCalled();

    cleanup();
  });

  it("does not double-tick same agent within the hour", async () => {
    // Set hour to 6
    vi.setSystemTime(new Date(Date.UTC(2026, 2, 8, 6, 10, 0)));

    const cfg = makeRunnerConfig();

    const cleanup = startAgentRunner(cfg);

    // Flush immediate cycle
    await vi.advanceTimersByTimeAsync(50);

    const callCountAfterFirst = mockTick.mock.calls.length;
    expect(callCountAfterFirst).toBeGreaterThan(0);

    // Advance through several more intervals — still within hour 6
    await vi.advanceTimersByTimeAsync(300);

    // Should not have gained any new calls since markRun prevents re-execution
    expect(mockTick.mock.calls.length).toBe(callCountAfterFirst);

    cleanup();
  });

  it("uses configLoader when provided to fetch configs dynamically", async () => {
    // Set hour to 6 so agents tick
    vi.setSystemTime(new Date(Date.UTC(2026, 2, 8, 6, 0, 0)));

    const dynamicConfig = makeConfig({ id: "dynamic_1" });
    const configLoader = vi.fn().mockResolvedValue([dynamicConfig]);

    const cfg = makeRunnerConfig({
      operatorConfigs: [], // empty static configs
      configLoader,
    });

    const cleanup = startAgentRunner(cfg);

    // Flush the immediate cycle
    await vi.advanceTimersByTimeAsync(150);

    // configLoader should have been called to fetch configs
    expect(configLoader).toHaveBeenCalled();
    // Agents should have ticked because configLoader returned a config
    expect(mockTick).toHaveBeenCalled();

    cleanup();
  });

  it("falls back to static operatorConfigs when configLoader is not set", async () => {
    // Set hour to 6
    vi.setSystemTime(new Date(Date.UTC(2026, 2, 8, 6, 0, 0)));

    const cfg = makeRunnerConfig({ operatorConfigs: [makeConfig()] });

    const cleanup = startAgentRunner(cfg);
    await vi.advanceTimersByTimeAsync(150);

    // Agents should tick from static config
    expect(mockTick).toHaveBeenCalled();

    cleanup();
  });

  it("records agent tick actions to audit ledger when provided", async () => {
    // Set hour to 6 so agents tick
    vi.setSystemTime(new Date(Date.UTC(2026, 2, 8, 6, 0, 0)));

    mockTick.mockResolvedValue({
      agentId: "optimizer",
      actions: [
        { actionType: "digital-ads.budget.adjust", outcome: "executed" },
        { actionType: "digital-ads.campaign.pause", outcome: "skipped" },
      ],
      summary: "Budget rebalanced",
    });

    const mockRecord = vi.fn().mockResolvedValue({});
    const ledger = { record: mockRecord } as unknown as import("@switchboard/core").AuditLedger;

    const cfg = makeRunnerConfig({ ledger });
    const cleanup = startAgentRunner(cfg);

    await vi.advanceTimersByTimeAsync(150);

    // Each agent tick's actions should be recorded individually
    expect(mockRecord).toHaveBeenCalled();
    const calls = mockRecord.mock.calls;
    // Find calls from any agent — at least the first one that ticked should have recorded
    const agentCalls = calls.filter(
      (c: unknown[]) => (c[0] as Record<string, unknown>).actorType === "agent",
    );
    expect(agentCalls.length).toBeGreaterThan(0);

    // Verify the audit entry shape
    const entry = agentCalls[0]![0] as Record<string, unknown>;
    expect(entry.eventType).toBe("action.executed");
    expect(entry.actorType).toBe("agent");
    expect(entry.entityType).toBe("ads_operator_config");
    expect(entry.entityId).toBe("op_1");
    expect(entry.organizationId).toBe("org_1");

    cleanup();
  });

  it("does not fail when audit ledger recording throws", async () => {
    // Set hour to 6 so agents tick
    vi.setSystemTime(new Date(Date.UTC(2026, 2, 8, 6, 0, 0)));

    mockTick.mockResolvedValue({
      agentId: "optimizer",
      actions: [{ actionType: "test.action", outcome: "ok" }],
      summary: "done",
    });

    const mockRecord = vi.fn().mockRejectedValue(new Error("ledger write failed"));
    const ledger = { record: mockRecord } as unknown as import("@switchboard/core").AuditLedger;

    const cfg = makeRunnerConfig({ ledger });
    const logger = cfg.logger as unknown as { error: ReturnType<typeof vi.fn> };

    const cleanup = startAgentRunner(cfg);
    await vi.advanceTimersByTimeAsync(150);

    // Agent tick should still have run (audit failure is non-fatal)
    expect(mockTick).toHaveBeenCalled();
    // Error should be logged
    expect(logger.error).toHaveBeenCalled();

    cleanup();
  });
});
