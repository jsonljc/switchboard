import { describe, it, expect, vi } from "vitest";
import { fetchAccountSnapshots } from "../shared.js";
import type { AgentContext } from "../types.js";

function makeMockContext(
  overrides?: Partial<{
    proposeResult: unknown;
    execResult: unknown;
    adAccountIds: string[];
  }>,
): AgentContext {
  const mockOrchestrator = {
    resolveAndPropose: vi.fn().mockResolvedValue(
      overrides?.proposeResult ?? {
        denied: false,
        envelope: { id: "env_1" },
      },
    ),
    executeApproved: vi.fn().mockResolvedValue(
      overrides?.execResult ?? {
        success: true,
        data: [
          {
            id: "camp_1",
            name: "Test Campaign",
            metrics: { spend: 100, conversions: 10 },
            budget: 200,
            status: "ACTIVE",
          },
        ],
      },
    ),
  };

  return {
    config: {
      id: "op_1",
      organizationId: "org_1",
      adAccountIds: overrides?.adAccountIds ?? ["act_123"],
      platforms: ["meta"],
      automationLevel: "supervised",
      targets: { cpa: 15, roas: 3, dailyBudgetCap: 100 },
      schedule: { optimizerCronHour: 6, reportCronHour: 9, timezone: "UTC" },
      notificationChannel: { type: "telegram", chatId: "chat_1" },
      principalId: "user_1",
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    orchestrator: mockOrchestrator as unknown as AgentContext["orchestrator"],
    storage: {} as AgentContext["storage"],
    notifier: { sendProactive: vi.fn() },
  } as unknown as AgentContext;
}

describe("fetchAccountSnapshots", () => {
  it("fetches campaigns from all accounts", async () => {
    const ctx = makeMockContext({ adAccountIds: ["act_1", "act_2"] });

    const result = await fetchAccountSnapshots(ctx, "test");

    expect(result.campaigns).toHaveLength(2); // one campaign per account
    expect(result.actions).toHaveLength(2);
    expect(result.actions[0]).toEqual({
      actionType: "digital-ads.snapshot.fetch",
      outcome: "fetched",
    });
    expect(ctx.orchestrator.resolveAndPropose).toHaveBeenCalledTimes(2);
    expect(ctx.orchestrator.executeApproved).toHaveBeenCalledTimes(2);
  });

  it("includes agent name in propose message", async () => {
    const ctx = makeMockContext();

    await fetchAccountSnapshots(ctx, "optimizer");

    const call = (ctx.orchestrator.resolveAndPropose as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.message).toContain("optimizer");
    expect(call.actionType).toBe("digital-ads.snapshot.fetch");
  });

  it("returns empty campaigns when proposal is denied", async () => {
    const ctx = makeMockContext({ proposeResult: { denied: true } });

    const result = await fetchAccountSnapshots(ctx, "test");

    expect(result.campaigns).toHaveLength(0);
    expect(result.actions).toContainEqual({
      actionType: "digital-ads.snapshot.fetch",
      outcome: "denied",
    });
    expect(ctx.orchestrator.executeApproved).not.toHaveBeenCalled();
  });

  it("handles fetch errors gracefully", async () => {
    const ctx = makeMockContext();
    (ctx.orchestrator.resolveAndPropose as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("network error"),
    );

    const result = await fetchAccountSnapshots(ctx, "test");

    expect(result.campaigns).toHaveLength(0);
    expect(result.actions).toContainEqual({
      actionType: "digital-ads.snapshot.fetch",
      outcome: "error",
    });
  });

  it("handles empty execution data", async () => {
    const ctx = makeMockContext({
      execResult: { success: true, data: null },
    });

    const result = await fetchAccountSnapshots(ctx, "test");

    expect(result.campaigns).toHaveLength(0);
    expect(result.actions).toContainEqual({
      actionType: "digital-ads.snapshot.fetch",
      outcome: "fetched",
    });
  });

  it("returns empty result for zero accounts", async () => {
    const ctx = makeMockContext({ adAccountIds: [] });

    const result = await fetchAccountSnapshots(ctx, "test");

    expect(result.campaigns).toHaveLength(0);
    expect(result.actions).toHaveLength(0);
    expect(ctx.orchestrator.resolveAndPropose).not.toHaveBeenCalled();
  });
});
