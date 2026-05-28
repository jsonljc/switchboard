import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { PrismaDeploymentLifecycleStore } from "../prisma-deployment-lifecycle-store.js";
import type { PrismaWorkTraceStore } from "../prisma-work-trace-store.js";

function makePrismaMock(opts: { findMany: unknown[]; updateCount: number }) {
  const tx = {
    agentDeployment: {
      findMany: vi.fn().mockResolvedValue(opts.findMany),
      updateMany: vi.fn().mockResolvedValue({ count: opts.updateCount }),
    },
  };
  return {
    tx,
    prisma: {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaClient,
  };
}

function makeWorkTraceStoreMock() {
  return {
    recordOperatorMutation: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue({ ok: true, trace: {} }),
  } as unknown as PrismaWorkTraceStore;
}

describe("PrismaDeploymentLifecycleStore.haltAll", () => {
  beforeEach(() => vi.clearAllMocks());

  it("flips active deployments to paused and writes an operator-mutation trace", async () => {
    const { prisma, tx } = makePrismaMock({
      findMany: [{ id: "d1" }, { id: "d2" }],
      updateCount: 2,
    });
    const wts = makeWorkTraceStoreMock();
    const store = new PrismaDeploymentLifecycleStore(prisma, wts);

    const result = await store.haltAll({
      organizationId: "org_1",
      operator: { type: "user", id: "u_1" },
      reason: "Security incident",
    });

    expect(result.count).toBe(2);
    expect(result.affectedDeploymentIds).toEqual(["d1", "d2"]);
    expect(result.workTraceId).toMatch(/^[0-9a-f-]{36}$/);

    expect(tx.agentDeployment.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1", status: "active" },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    expect(tx.agentDeployment.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1", status: "active" },
      data: { status: "paused" },
    });

    expect(wts.recordOperatorMutation).toHaveBeenCalledTimes(1);
    const [trace, ctx] = (wts.recordOperatorMutation as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(trace.intent).toBe("agent_deployment.halt");
    expect(trace.mode).toBe("operator_mutation");
    expect(trace.ingressPath).toBe("store_recorded_operator_mutation");
    expect(trace.hashInputVersion).toBe(2);
    expect(trace.outcome).toBe("running");
    expect(trace.actor).toEqual({ type: "user", id: "u_1" });
    expect(trace.parameters).toMatchObject({
      actionKind: "agent_deployment.halt",
      orgId: "org_1",
      before: { status: "active", ids: ["d1", "d2"] },
      after: { status: "paused", count: 2 },
      reason: "Security incident",
    });
    expect(ctx.tx).toBe(tx);

    expect(wts.update).toHaveBeenCalledTimes(1);
    const [updateId, fields] = (wts.update as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(updateId).toBe(result.workTraceId);
    expect(fields).toMatchObject({ outcome: "completed" });
    expect(fields.completedAt).toBeDefined();
  });

  it("writes a trace even when no deployments match (count: 0)", async () => {
    const { prisma } = makePrismaMock({ findMany: [], updateCount: 0 });
    const wts = makeWorkTraceStoreMock();
    const store = new PrismaDeploymentLifecycleStore(prisma, wts);

    const result = await store.haltAll({
      organizationId: "org_empty",
      operator: { type: "user", id: "u_1" },
      reason: null,
    });

    expect(result.count).toBe(0);
    expect(result.affectedDeploymentIds).toEqual([]);
    expect(wts.recordOperatorMutation).toHaveBeenCalledTimes(1);
  });
});

describe("PrismaDeploymentLifecycleStore.resumeAll", () => {
  beforeEach(() => vi.clearAllMocks());

  it("flips all paused deployments to active org-wide and writes an operator-mutation trace", async () => {
    // Multi-agent: halt paused Alex, Mira, AND Riley. resumeAll must restore all
    // three — the bug was scoping resume to skillSlug:"alex" so Riley/Mira stayed dark.
    const { prisma, tx } = makePrismaMock({
      findMany: [{ id: "d_alex" }, { id: "d_mira" }, { id: "d_riley" }],
      updateCount: 3,
    });
    const wts = makeWorkTraceStoreMock();
    const store = new PrismaDeploymentLifecycleStore(prisma, wts);

    const result = await store.resumeAll({
      organizationId: "org_1",
      operator: { type: "user", id: "u_1" },
    });

    expect(result.count).toBe(3);
    expect(result.affectedDeploymentIds).toEqual(["d_alex", "d_mira", "d_riley"]);
    expect(result.workTraceId).toMatch(/^[0-9a-f-]{36}$/);

    // Org-wide, paused-only, NO skillSlug filter. status:"paused" is the exact
    // inverse of haltAll's active→paused and leaves `suspended` rows (the separate
    // suspendAll billing lifecycle) untouched. The where-clause carries
    // organizationId, so this is tenant-scoped (no cross-org bleed).
    expect(tx.agentDeployment.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1", status: "paused" },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    expect(tx.agentDeployment.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1", status: "paused" },
      data: { status: "active" },
    });

    expect(wts.recordOperatorMutation).toHaveBeenCalledTimes(1);
    const [trace, ctx] = (wts.recordOperatorMutation as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(trace.intent).toBe("agent_deployment.resume");
    expect(trace.mode).toBe("operator_mutation");
    expect(trace.ingressPath).toBe("store_recorded_operator_mutation");
    expect(trace.hashInputVersion).toBe(2);
    expect(trace.actor).toEqual({ type: "user", id: "u_1" });
    expect(trace.parameters).toMatchObject({
      actionKind: "agent_deployment.resume",
      orgId: "org_1",
      before: { status: "paused", ids: ["d_alex", "d_mira", "d_riley"] },
      after: { status: "active", count: 3 },
    });
    // No per-skill scoping leaks into the trace.
    expect((trace.parameters as Record<string, unknown>).skillSlug).toBeUndefined();
    expect(ctx.tx).toBe(tx);

    expect(wts.update).toHaveBeenCalledTimes(1);
    const [updateId, fields] = (wts.update as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(updateId).toBe(result.workTraceId);
    expect(fields).toMatchObject({ outcome: "completed" });
  });

  it("writes a trace even when nothing is paused (count: 0, idempotent re-run)", async () => {
    const { prisma } = makePrismaMock({ findMany: [], updateCount: 0 });
    const wts = makeWorkTraceStoreMock();
    const store = new PrismaDeploymentLifecycleStore(prisma, wts);

    const result = await store.resumeAll({
      organizationId: "org_empty",
      operator: { type: "user", id: "u_1" },
    });

    expect(result.count).toBe(0);
    expect(result.affectedDeploymentIds).toEqual([]);
    expect(wts.recordOperatorMutation).toHaveBeenCalledTimes(1);
  });
});

describe("PrismaDeploymentLifecycleStore.suspendAll", () => {
  beforeEach(() => vi.clearAllMocks());

  it("flips active deployments to suspended and writes a service-actor trace", async () => {
    const { prisma, tx } = makePrismaMock({
      findMany: [{ id: "d1" }, { id: "d2" }, { id: "d3" }],
      updateCount: 3,
    });
    const wts = makeWorkTraceStoreMock();
    const store = new PrismaDeploymentLifecycleStore(prisma, wts);

    const result = await store.suspendAll({
      organizationId: "org_1",
      operator: { type: "service", id: "stripe-webhook" },
      reason: "subscription_canceled",
    });

    expect(result.count).toBe(3);
    expect(result.affectedDeploymentIds).toEqual(["d1", "d2", "d3"]);

    expect(tx.agentDeployment.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1", status: "active" },
      data: { status: "suspended" },
    });

    const [trace] = (wts.recordOperatorMutation as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(trace.intent).toBe("agent_deployment.suspend");
    // "internal" matches the Trigger union (chat|api|schedule|internal) and the
    // existing Stripe-driven pattern in apps/api/src/bootstrap/contained-workflows.ts.
    expect(trace.trigger).toBe("internal");
    expect(trace.actor).toEqual({ type: "service", id: "stripe-webhook" });
    expect(trace.parameters).toMatchObject({
      actionKind: "agent_deployment.suspend",
      orgId: "org_1",
      before: { status: "active", ids: ["d1", "d2", "d3"] },
      after: { status: "suspended", count: 3 },
      reason: "subscription_canceled",
    });
  });
});
