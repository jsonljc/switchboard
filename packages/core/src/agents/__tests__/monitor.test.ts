import { describe, it, expect, vi, beforeEach } from "vitest";
import { MonitorAgent, DEFAULT_ALERT_CONDITIONS } from "../monitor.js";
import type { AgentContext } from "../types.js";
import type { MonitorSnapshot } from "../monitor.js";
import type { AdsOperatorConfig } from "@switchboard/schemas";

function makeConfig(overrides?: Partial<AdsOperatorConfig>): AdsOperatorConfig {
  return {
    id: "op_1",
    organizationId: "org_dental",
    adAccountIds: ["act_123"],
    platforms: ["meta"],
    automationLevel: "supervised",
    targets: { cpa: 15, roas: 3, dailyBudgetCap: 33 },
    schedule: { optimizerCronHour: 3, reportCronHour: 9, timezone: "America/New_York" },
    notificationChannel: { type: "telegram", chatId: "chat_1" },
    principalId: "user_1",
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AdsOperatorConfig;
}

function makeMockContext(config?: Partial<AdsOperatorConfig>): AgentContext {
  return {
    config: makeConfig(config),
    orchestrator: {
      resolveAndPropose: vi.fn().mockResolvedValue({
        denied: false,
        envelope: { id: "env_1" },
      }),
      executeApproved: vi.fn().mockResolvedValue({
        success: true,
        data: [
          {
            id: "camp_1",
            name: "Teeth Whitening Promo",
            metrics: { spend: 18, leads: 6, qualified: 4, booked: 3, revenue: 840, conversions: 6 },
            budget: 20,
            status: "ACTIVE",
          },
          {
            id: "camp_2",
            name: "General Dentistry",
            metrics: { spend: 6.5, leads: 2, qualified: 1, booked: 0, revenue: 0, conversions: 2 },
            budget: 13,
            status: "ACTIVE",
          },
        ],
      }),
    } as unknown as AgentContext["orchestrator"],
    storage: {} as AgentContext["storage"],
    notifier: {
      sendProactive: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe("MonitorAgent", () => {
  let agent: MonitorAgent;

  beforeEach(() => {
    agent = new MonitorAgent();
  });

  describe("tick", () => {
    it("fetches snapshot and sends daily report", async () => {
      const ctx = makeMockContext();
      const result = await agent.tick(ctx);

      expect(result.agentId).toBe("monitor");
      expect(result.actions).toContainEqual({ actionType: "monitor.fetch", outcome: "fetched" });
      expect(result.actions).toContainEqual({ actionType: "monitor.report", outcome: "sent" });
      expect(ctx.notifier.sendProactive).toHaveBeenCalledTimes(1);
    });

    it("includes spend and lead data in daily report", async () => {
      const ctx = makeMockContext();
      await agent.tick(ctx);

      const reportText = (ctx.notifier.sendProactive as ReturnType<typeof vi.fn>).mock
        .calls[0]![2] as string;
      expect(reportText).toContain("$24.50");
      expect(reportText).toContain("Leads: 8");
    });

    it("shows zero-lead campaigns as warnings", async () => {
      const ctx = makeMockContext();
      (ctx.orchestrator.executeApproved as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: [
          {
            id: "camp_1",
            name: "Active Campaign",
            metrics: { spend: 10, leads: 5, conversions: 5 },
            budget: 20,
            status: "ACTIVE",
          },
          {
            id: "camp_2",
            name: "Dead Campaign",
            metrics: { spend: 8, leads: 0, conversions: 0 },
            budget: 15,
            status: "ACTIVE",
          },
        ],
      });

      await agent.tick(ctx);

      const reportText = (ctx.notifier.sendProactive as ReturnType<typeof vi.fn>).mock
        .calls[0]![2] as string;
      expect(reportText).toContain('"Dead Campaign" has 0 leads today');
    });

    it("handles no data gracefully", async () => {
      const ctx = makeMockContext();
      (ctx.orchestrator.resolveAndPropose as ReturnType<typeof vi.fn>).mockResolvedValue({
        denied: true,
      });

      const result = await agent.tick(ctx);

      expect(result.actions).toContainEqual({ actionType: "monitor.fetch", outcome: "denied" });
      const reportText = (ctx.notifier.sendProactive as ReturnType<typeof vi.fn>).mock
        .calls[0]![2] as string;
      expect(reportText).toContain("No performance data available");
    });

    it("handles fetch errors gracefully", async () => {
      const ctx = makeMockContext();
      (ctx.orchestrator.resolveAndPropose as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("API down"),
      );

      const result = await agent.tick(ctx);

      expect(result.actions).toContainEqual({ actionType: "monitor.fetch", outcome: "error" });
    });

    it("handles notification send error", async () => {
      const ctx = makeMockContext();
      (ctx.notifier.sendProactive as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Telegram error"),
      );

      const result = await agent.tick(ctx);

      expect(result.actions).toContainEqual({ actionType: "monitor.report", outcome: "error" });
    });

    it("schedules next tick for the following day", async () => {
      const ctx = makeMockContext();
      const result = await agent.tick(ctx);

      expect(result.nextTickAt).toBeDefined();
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      expect(result.nextTickAt!.getDate()).toBe(tomorrow.getDate());
      expect(result.nextTickAt!.getHours()).toBe(9); // reportCronHour
    });

    it("generates weekly report on Monday", async () => {
      // Find the next Monday
      const monday = new Date();
      monday.setDate(monday.getDate() + ((1 - monday.getDay() + 7) % 7 || 7));
      vi.useFakeTimers({ now: monday });

      const ctx = makeMockContext();
      await agent.tick(ctx);

      const reportText = (ctx.notifier.sendProactive as ReturnType<typeof vi.fn>).mock
        .calls[0]![2] as string;
      expect(reportText).toContain("Weekly Report");

      vi.useRealTimers();
    });

    it("formats weekly report with campaign ranking", async () => {
      const monday = new Date();
      monday.setDate(monday.getDate() + ((1 - monday.getDay() + 7) % 7 || 7));
      vi.useFakeTimers({ now: monday });

      const ctx = makeMockContext();
      (ctx.orchestrator.executeApproved as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: [
          {
            id: "camp_1",
            name: "Whitening",
            metrics: { spend: 100, booked: 15, leads: 40, revenue: 4200 },
            budget: 150,
            status: "ACTIVE",
          },
          {
            id: "camp_2",
            name: "General",
            metrics: { spend: 68, booked: 3, leads: 12, revenue: 840 },
            budget: 100,
            status: "ACTIVE",
          },
        ],
      });

      await agent.tick(ctx);

      const reportText = (ctx.notifier.sendProactive as ReturnType<typeof vi.fn>).mock
        .calls[0]![2] as string;
      expect(reportText).toContain("Best:");
      expect(reportText).toContain("Worst:");

      vi.useRealTimers();
    });
  });
});

describe("DEFAULT_ALERT_CONDITIONS", () => {
  it("has 4 default conditions", () => {
    expect(DEFAULT_ALERT_CONDITIONS).toHaveLength(4);
  });

  it("detects overspend", () => {
    const overspend = DEFAULT_ALERT_CONDITIONS.find((c) => c.id === "overspend")!;
    const snapshot: MonitorSnapshot = {
      accountId: "act_1",
      totalSpend: 40,
      dailyBudget: 33,
      leads: 5,
      qualified: 3,
      booked: 2,
      revenue: 500,
      campaigns: [],
      hoursSinceLastLead: null,
    };

    const result = overspend.evaluate(snapshot);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("critical");
    expect(result!.message).toContain("exceeds 120%");
  });

  it("does not trigger overspend within budget", () => {
    const overspend = DEFAULT_ALERT_CONDITIONS.find((c) => c.id === "overspend")!;
    const snapshot: MonitorSnapshot = {
      accountId: "act_1",
      totalSpend: 30,
      dailyBudget: 33,
      leads: 5,
      qualified: 3,
      booked: 2,
      revenue: 500,
      campaigns: [],
      hoursSinceLastLead: null,
    };

    expect(overspend.evaluate(snapshot)).toBeNull();
  });

  it("detects no leads in 48 hours", () => {
    const noLeads = DEFAULT_ALERT_CONDITIONS.find((c) => c.id === "no_leads_48h")!;
    const snapshot: MonitorSnapshot = {
      accountId: "act_1",
      totalSpend: 20,
      dailyBudget: 33,
      leads: 0,
      qualified: 0,
      booked: 0,
      revenue: 0,
      campaigns: [],
      hoursSinceLastLead: 52,
    };

    const result = noLeads.evaluate(snapshot);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("critical");
    expect(result!.message).toContain("52 hours");
  });

  it("detects budget exhaustion for a campaign", () => {
    const exhaustion = DEFAULT_ALERT_CONDITIONS.find((c) => c.id === "budget_exhaustion")!;
    const snapshot: MonitorSnapshot = {
      accountId: "act_1",
      totalSpend: 20,
      dailyBudget: 33,
      leads: 5,
      qualified: 3,
      booked: 2,
      revenue: 500,
      campaigns: [
        {
          id: "c_1",
          name: "Promo",
          spend: 19,
          budget: 20,
          conversions: 5,
          leads: 5,
          qualified: 3,
          booked: 2,
          revenue: 500,
          status: "ACTIVE",
        },
      ],
      hoursSinceLastLead: null,
    };

    const result = exhaustion.evaluate(snapshot);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("warning");
    expect(result!.message).toContain("Promo");
  });

  it("detects CPL spike", () => {
    const cplSpike = DEFAULT_ALERT_CONDITIONS.find((c) => c.id === "cpl_spike")!;
    const snapshot: MonitorSnapshot = {
      accountId: "act_1",
      totalSpend: 200,
      dailyBudget: 200,
      leads: 2,
      qualified: 0,
      booked: 0,
      revenue: 0,
      campaigns: [],
      hoursSinceLastLead: null,
    };

    const result = cplSpike.evaluate(snapshot);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("warning");
  });
});
