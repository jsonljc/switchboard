import { describe, it, expect, vi } from "vitest";
import { setRileyPauseSelfExecution } from "./riley-pause-flag-toggle.js";

function harness(opts?: {
  listing?: { id: string } | null;
  deployment?: { id: string; governanceSettings: Record<string, unknown> | null } | null;
}) {
  const update = vi.fn(
    async (_args: { where: { id: string }; data: Record<string, unknown> }) => ({}),
  );
  const tx = { agentDeployment: { update } };
  const prisma = {
    agentListing: {
      findUnique: vi.fn(async () =>
        opts?.listing === undefined ? { id: "listing_1" } : opts.listing,
      ),
    },
    agentDeployment: {
      findUnique: vi.fn(async () =>
        opts?.deployment === undefined
          ? { id: "dep_1", governanceSettings: { trustLevelOverride: "autonomous" } }
          : opts.deployment,
      ),
    },
    $transaction: vi.fn(async (cb: (txc: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  const record = vi.fn(
    async (_params: Record<string, unknown>, _options?: { tx?: unknown }) => ({}),
  );
  return { prisma, update, tx, ledger: { record } };
}

describe("setRileyPauseSelfExecution (audited capability toggle)", () => {
  it("flips OFF -> ON, preserves other governanceSettings keys, writes one audit row", async () => {
    const h = harness();
    const result = await setRileyPauseSelfExecution(h.prisma as never, h.ledger, {
      organizationId: "org_1",
      enabled: true,
      actor: "jason",
    });
    expect(result).toEqual({ previous: false, current: true });
    const data = h.update.mock.calls[0]![0].data as {
      governanceSettings: Record<string, unknown>;
    };
    expect(data.governanceSettings).toEqual({
      trustLevelOverride: "autonomous",
      pauseSelfExecutionEnabled: true,
    });
    expect(h.ledger.record).toHaveBeenCalledTimes(1);
    const entry = h.ledger.record.mock.calls[0]![0] as Record<string, unknown>;
    expect(entry.actorId).toBe("jason");
    expect(entry.entityType).toBe("deployment");
    expect(String(entry.summary)).toContain("false -> true");
    expect(entry.snapshot).toMatchObject({
      flag: "pauseSelfExecutionEnabled",
      previous: false,
      current: true,
      organizationId: "org_1",
    });
  });

  it("flips ON -> OFF and reports the previous value truthfully", async () => {
    const h = harness({
      deployment: { id: "dep_1", governanceSettings: { pauseSelfExecutionEnabled: true } },
    });
    const result = await setRileyPauseSelfExecution(h.prisma as never, h.ledger, {
      organizationId: "org_1",
      enabled: false,
      actor: "jason",
    });
    expect(result).toEqual({ previous: true, current: false });
  });

  it("throws on a missing riley deployment (no silent creation)", async () => {
    const h = harness({ deployment: null });
    await expect(
      setRileyPauseSelfExecution(h.prisma as never, h.ledger, {
        organizationId: "org_x",
        enabled: true,
        actor: "jason",
      }),
    ).rejects.toThrow(/no riley deployment/);
    expect(h.update).not.toHaveBeenCalled();
    expect(h.ledger.record).not.toHaveBeenCalled();
  });

  it("throws when the ad-optimizer listing is missing", async () => {
    const h = harness({ listing: null });
    await expect(
      setRileyPauseSelfExecution(h.prisma as never, h.ledger, {
        organizationId: "org_1",
        enabled: true,
        actor: "jason",
      }),
    ).rejects.toThrow(/listing/);
  });

  it("wraps the flip + audit write in one transaction and threads the tx into ledger.record", async () => {
    // True atomicity: the audit chain-append joins the same transaction as the
    // flag flip (ledger.record({ tx }) -> appendAtomic({ externalTx })), so the
    // capability flip and its audit row commit or roll back together.
    const h = harness();
    await setRileyPauseSelfExecution(h.prisma as never, h.ledger, {
      organizationId: "org_1",
      enabled: true,
      actor: "jason",
    });
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.ledger.record).toHaveBeenCalledTimes(1);
    expect(h.ledger.record.mock.calls[0]![1]?.tx).toBe(h.tx);
  });

  it("rejects out of the transaction when the audit write fails (flip rolls back, never armed without an audit row)", async () => {
    // A mock cannot prove a real Postgres rollback, but proving the ledger error
    // is NOT swallowed - it escapes setRileyPauseSelfExecution - proves the flip
    // + audit are bound in one $transaction, so a ledger failure can never leave
    // pauseSelfExecutionEnabled flipped with no audit row.
    const h = harness();
    h.ledger.record.mockRejectedValueOnce(new Error("ledger chain write failed"));
    await expect(
      setRileyPauseSelfExecution(h.prisma as never, h.ledger, {
        organizationId: "org_1",
        enabled: true,
        actor: "jason",
      }),
    ).rejects.toThrow(/ledger chain write failed/);
    expect(h.update).toHaveBeenCalledTimes(1);
  });
});
