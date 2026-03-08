import { describe, it, expect, vi, beforeEach } from "vitest";
import { OptimizerAgent } from "../optimizer-agent.js";
import { ReporterAgent } from "../reporter-agent.js";
import type { AgentContext, AgentNotifier } from "../types.js";
import type { AdsOperatorConfig } from "@switchboard/schemas";

function createMockConfig(overrides?: Partial<AdsOperatorConfig>): AdsOperatorConfig {
  return {
    id: "op-1",
    organizationId: "org-1",
    adAccountIds: ["act_123"],
    platforms: ["meta"],
    automationLevel: "supervised",
    targets: {
      cpa: 15,
      roas: 3.0,
      dailyBudgetCap: 500,
    },
    schedule: {
      optimizerCronHour: 6,
      reportCronHour: 8,
      timezone: "America/New_York",
    },
    notificationChannel: {
      type: "telegram",
      chatId: "12345",
    },
    principalId: "user-1",
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createMockNotifier(): AgentNotifier & {
  calls: Array<{ chatId: string; type: string; message: string }>;
} {
  const calls: Array<{ chatId: string; type: string; message: string }> = [];
  return {
    calls,
    async sendProactive(chatId: string, channelType: string, message: string) {
      calls.push({ chatId, type: channelType, message });
    },
  };
}

function createMockOrchestrator(options?: {
  snapshotData?: unknown;
  proposeResult?: "denied" | "approved" | "pending";
}) {
  const { snapshotData, proposeResult = "approved" } = options ?? {};

  return {
    resolveAndPropose: vi.fn().mockImplementation(async (req: { actionType: string }) => {
      if (req.actionType === "digital-ads.snapshot.fetch") {
        return {
          denied: false,
          envelope: { id: "env-snap", status: "approved" },
          explanation: "auto-approved",
        };
      }

      if (proposeResult === "denied") {
        return {
          denied: true,
          envelope: { id: "env-denied" },
          explanation: "denied by policy",
          decisionTrace: { checks: [], explanation: "denied" },
        };
      }

      if (proposeResult === "pending") {
        return {
          denied: false,
          envelope: { id: "env-pending", status: "pending_approval" },
          approvalRequest: { id: "apr-1", summary: "test" },
          explanation: "needs approval",
        };
      }

      return {
        denied: false,
        envelope: { id: "env-exec", status: "approved" },
        explanation: "auto-approved",
      };
    }),
    executeApproved: vi.fn().mockImplementation(async (envelopeId: string) => {
      if (envelopeId === "env-snap" && snapshotData) {
        return { success: true, summary: "snapshot fetched", data: snapshotData, externalRefs: {} };
      }
      return { success: true, summary: "executed", data: null, externalRefs: {} };
    }),
    respondToApproval: vi.fn(),
    requestUndo: vi.fn(),
  };
}

function createMockStorage() {
  return {
    envelopes: { list: vi.fn().mockResolvedValue([]), get: vi.fn(), save: vi.fn() },
    policies: { list: vi.fn().mockResolvedValue([]), save: vi.fn(), get: vi.fn(), delete: vi.fn() },
    identity: {
      getPrincipal: vi.fn().mockResolvedValue(null),
      savePrincipal: vi.fn(),
      getSpec: vi.fn().mockResolvedValue(null),
      saveSpec: vi.fn(),
    },
    approvals: { get: vi.fn(), save: vi.fn(), list: vi.fn().mockResolvedValue([]) },
    cartridges: { list: vi.fn().mockReturnValue([]), get: vi.fn(), register: vi.fn() },
    competence: {
      get: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
    },
  };
}

describe("OptimizerAgent", () => {
  let agent: OptimizerAgent;

  beforeEach(() => {
    agent = new OptimizerAgent();
  });

  it("has correct id and name", () => {
    expect(agent.id).toBe("optimizer");
    expect(agent.name).toBe("Optimizer Agent");
  });

  it("handles empty campaign data gracefully", async () => {
    const notifier = createMockNotifier();
    const orchestrator = createMockOrchestrator({ snapshotData: [] });

    const ctx: AgentContext = {
      config: createMockConfig(),
      orchestrator: orchestrator as unknown as AgentContext["orchestrator"],
      storage: createMockStorage() as unknown as AgentContext["storage"],
      notifier,
    };

    const result = await agent.tick(ctx);

    expect(result.agentId).toBe("optimizer");
    expect(result.summary).toContain("No campaign data");
    expect(notifier.calls).toHaveLength(1);
  });

  it("proposes budget adjustments for underperformers", async () => {
    const campaigns = [
      {
        id: "c1",
        name: "Top Performer",
        metrics: { roas: 5.0, cpa: 8 },
        budget: 100,
        status: "ACTIVE",
      },
      { id: "c2", name: "Average", metrics: { roas: 2.5, cpa: 14 }, budget: 80, status: "ACTIVE" },
      {
        id: "c3",
        name: "Underperformer",
        metrics: { roas: 0.5, cpa: 30 },
        budget: 60,
        status: "ACTIVE",
      },
    ];

    const notifier = createMockNotifier();
    const orchestrator = createMockOrchestrator({ snapshotData: campaigns });

    const ctx: AgentContext = {
      config: createMockConfig(),
      orchestrator: orchestrator as unknown as AgentContext["orchestrator"],
      storage: createMockStorage() as unknown as AgentContext["storage"],
      notifier,
    };

    const result = await agent.tick(ctx);

    expect(result.agentId).toBe("optimizer");
    // Should have proposed adjustments (snapshot + budget changes)
    expect(result.actions.length).toBeGreaterThan(1);
    expect(notifier.calls).toHaveLength(1);
    expect(notifier.calls[0]!.chatId).toBe("12345");
    expect(notifier.calls[0]!.type).toBe("telegram");
  });

  it("skips campaigns performing within range", async () => {
    const campaigns = [
      { id: "c1", name: "Good", metrics: { roas: 3.5, cpa: 12 }, budget: 100, status: "ACTIVE" },
      {
        id: "c2",
        name: "Also Good",
        metrics: { roas: 3.2, cpa: 13 },
        budget: 100,
        status: "ACTIVE",
      },
    ];

    const notifier = createMockNotifier();
    const orchestrator = createMockOrchestrator({ snapshotData: campaigns });

    const ctx: AgentContext = {
      config: createMockConfig(),
      orchestrator: orchestrator as unknown as AgentContext["orchestrator"],
      storage: createMockStorage() as unknown as AgentContext["storage"],
      notifier,
    };

    const result = await agent.tick(ctx);

    expect(result.summary).toContain("No adjustments needed");
  });

  it("handles denied proposals", async () => {
    const campaigns = [
      { id: "c1", name: "Top", metrics: { roas: 5.0, cpa: 8 }, budget: 100, status: "ACTIVE" },
      { id: "c2", name: "Bottom", metrics: { roas: 0.3, cpa: 50 }, budget: 60, status: "ACTIVE" },
    ];

    const notifier = createMockNotifier();
    const orchestrator = createMockOrchestrator({
      snapshotData: campaigns,
      proposeResult: "denied",
    });

    const ctx: AgentContext = {
      config: createMockConfig(),
      orchestrator: orchestrator as unknown as AgentContext["orchestrator"],
      storage: createMockStorage() as unknown as AgentContext["storage"],
      notifier,
    };

    const result = await agent.tick(ctx);

    expect(result.actions.some((a) => a.outcome === "denied")).toBe(true);
    expect(result.summary).toContain("denied");
  });
});

describe("ReporterAgent", () => {
  let agent: ReporterAgent;

  beforeEach(() => {
    agent = new ReporterAgent();
  });

  it("has correct id and name", () => {
    expect(agent.id).toBe("reporter");
    expect(agent.name).toBe("Reporter Agent");
  });

  it("sends a daily report", async () => {
    const campaigns = [
      {
        id: "c1",
        name: "Spring Sale",
        metrics: { spend: 52, conversions: 8, revenue: 400, roas: 7.7 },
        budget: 100,
        status: "ACTIVE",
      },
      {
        id: "c2",
        name: "Brand Awareness",
        metrics: { spend: 16, conversions: 2, revenue: 80, roas: 5.0 },
        budget: 50,
        status: "ACTIVE",
      },
    ];

    const notifier = createMockNotifier();
    const orchestrator = createMockOrchestrator({ snapshotData: campaigns });

    const ctx: AgentContext = {
      config: createMockConfig({ targets: { cpa: 15, roas: 3.0 } }),
      orchestrator: orchestrator as unknown as AgentContext["orchestrator"],
      storage: createMockStorage() as unknown as AgentContext["storage"],
      notifier,
    };

    const result = await agent.tick(ctx);

    expect(result.agentId).toBe("reporter");
    expect(result.summary).toContain("report sent");
    expect(notifier.calls).toHaveLength(1);
    const report = notifier.calls[0]!.message;
    expect(report).toContain("Daily Report");
    expect(report).toContain("Spend:");
    expect(report).toContain("CPA:");
  });

  it("handles no data gracefully", async () => {
    const notifier = createMockNotifier();
    const orchestrator = createMockOrchestrator();
    // Make executeApproved return no data
    orchestrator.executeApproved.mockResolvedValue({
      success: true,
      summary: "ok",
      data: null,
      externalRefs: {},
    });

    const ctx: AgentContext = {
      config: createMockConfig(),
      orchestrator: orchestrator as unknown as AgentContext["orchestrator"],
      storage: createMockStorage() as unknown as AgentContext["storage"],
      notifier,
    };

    const result = await agent.tick(ctx);

    expect(result.agentId).toBe("reporter");
    expect(notifier.calls).toHaveLength(1);
    expect(notifier.calls[0]!.message).toContain("No performance data");
  });

  it("includes alerts when targets are missed", async () => {
    const campaigns = [
      {
        id: "c1",
        name: "Expensive Campaign",
        metrics: { spend: 300, conversions: 5, revenue: 200, roas: 0.67 },
        budget: 300,
        status: "ACTIVE",
      },
    ];

    const notifier = createMockNotifier();
    const orchestrator = createMockOrchestrator({ snapshotData: campaigns });

    const ctx: AgentContext = {
      config: createMockConfig({ targets: { cpa: 15, roas: 3.0 } }),
      orchestrator: orchestrator as unknown as AgentContext["orchestrator"],
      storage: createMockStorage() as unknown as AgentContext["storage"],
      notifier,
    };

    const result = await agent.tick(ctx);

    expect(result.agentId).toBe("reporter");
    const report = notifier.calls[0]!.message;
    expect(report).toContain("Alert:");
  });

  it("returns nextTickAt for next day", async () => {
    const notifier = createMockNotifier();
    const orchestrator = createMockOrchestrator({ snapshotData: [] });
    orchestrator.executeApproved.mockResolvedValue({
      success: true,
      summary: "ok",
      data: null,
      externalRefs: {},
    });

    const ctx: AgentContext = {
      config: createMockConfig(),
      orchestrator: orchestrator as unknown as AgentContext["orchestrator"],
      storage: createMockStorage() as unknown as AgentContext["storage"],
      notifier,
    };

    const result = await agent.tick(ctx);

    expect(result.nextTickAt).toBeInstanceOf(Date);
    expect(result.nextTickAt!.getTime()).toBeGreaterThan(Date.now());
  });
});
