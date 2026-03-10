// ---------------------------------------------------------------------------
// RevenueGrowthAgent — Tests
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { RevenueGrowthAgent } from "../revenue-growth-agent.js";
import { MockConnector } from "../../data/normalizer.js";
import {
  InMemoryInterventionStore,
  InMemoryDiagnosticCycleStore,
  InMemoryRevenueAccountStore,
  InMemoryWeeklyDigestStore,
} from "../../stores/in-memory.js";
import type { AgentContext } from "@switchboard/core";

function buildDeps() {
  return {
    connectors: [new MockConnector()],
    interventionStore: new InMemoryInterventionStore(),
    cycleStore: new InMemoryDiagnosticCycleStore(),
    accountStore: new InMemoryRevenueAccountStore(),
    digestStore: new InMemoryWeeklyDigestStore(),
  };
}

function buildCtx(): AgentContext {
  return {
    config: {} as never,
    orchestrator: {} as never,
    storage: {} as never,
    notifier: { sendProactive: vi.fn() },
  };
}

describe("RevenueGrowthAgent", () => {
  it("has correct id and name", () => {
    const agent = new RevenueGrowthAgent(buildDeps());
    expect(agent.id).toBe("revenue-growth");
    expect(agent.name).toBe("Revenue Growth Agent");
  });

  it("returns empty result when no accounts are due", async () => {
    const deps = buildDeps();
    const agent = new RevenueGrowthAgent(deps);

    const result = await agent.tick(buildCtx());
    expect(result.agentId).toBe("revenue-growth");
    expect(result.actions).toHaveLength(0);
    expect(result.summary).toContain("0 account");
  });

  it("processes due accounts and runs diagnostics", async () => {
    const deps = buildDeps();

    // Enroll a due account
    await deps.accountStore.upsert({
      organizationId: "org_1",
      accountId: "acc_1",
      active: true,
      cadenceMinutes: 60,
      nextCycleAt: new Date(Date.now() - 1000).toISOString(),
      lastCycleId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const agent = new RevenueGrowthAgent(deps);
    const result = await agent.tick(buildCtx());

    expect(result.actions.length).toBeGreaterThan(0);
    expect(result.actions[0]!.actionType).toBe("revenue-growth.diagnostic.run");
    expect(result.summary).toContain("1 account");
  });

  it("updates nextCycleAt after processing", async () => {
    const deps = buildDeps();
    const originalNextCycle = new Date(Date.now() - 1000).toISOString();

    await deps.accountStore.upsert({
      organizationId: "org_1",
      accountId: "acc_1",
      active: true,
      cadenceMinutes: 60,
      nextCycleAt: originalNextCycle,
      lastCycleId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const agent = new RevenueGrowthAgent(deps);
    await agent.tick(buildCtx());

    const updated = await deps.accountStore.getByAccountId("org_1", "acc_1");
    expect(updated).not.toBeNull();
    expect(updated!.nextCycleAt > originalNextCycle).toBe(true);
  });

  it("persists diagnostic cycle to cycle store", async () => {
    const deps = buildDeps();

    await deps.accountStore.upsert({
      organizationId: "org_1",
      accountId: "acc_1",
      active: true,
      cadenceMinutes: 60,
      nextCycleAt: new Date(Date.now() - 1000).toISOString(),
      lastCycleId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const agent = new RevenueGrowthAgent(deps);
    await agent.tick(buildCtx());

    const latest = await deps.cycleStore.getLatest("acc_1");
    expect(latest).not.toBeNull();
    expect(latest!.accountId).toBe("acc_1");
  });

  it("handles errors gracefully", async () => {
    const deps = {
      connectors: [],
      accountStore: {
        upsert: vi.fn(),
        getByAccountId: vi.fn(),
        listDue: vi.fn().mockResolvedValue([
          {
            organizationId: "org_1",
            accountId: "acc_1",
            active: true,
            cadenceMinutes: 60,
            nextCycleAt: new Date(Date.now() - 1000).toISOString(),
            lastCycleId: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ]),
      },
    };

    // Deliberately provide no cycle store or intervention store — should not crash
    const agent = new RevenueGrowthAgent(deps);
    const result = await agent.tick(buildCtx());

    expect(result.actions.length).toBeGreaterThan(0);
  });
});
