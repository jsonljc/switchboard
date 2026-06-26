import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  setRileyReallocateKillSwitch,
  setRileyReallocateSelfExecution,
} from "./riley-reallocate-flag-toggle.js";

function mockPrisma(governanceSettings: Record<string, unknown> | null) {
  const update = vi.fn(async (_a: { where: unknown; data: unknown }) => ({}));
  const tx = { agentDeployment: { update } };
  const transaction = vi.fn(async (cb: (txc: typeof tx) => Promise<unknown>) => cb(tx));
  const prisma = {
    agentListing: { findUnique: vi.fn(async () => ({ id: "listing_1" })) },
    agentDeployment: {
      findUnique: vi.fn(async () => ({ id: "dep_1", governanceSettings })),
    },
    $transaction: transaction,
  };
  return { prisma: prisma as unknown as PrismaClient, update, tx, transaction };
}

function fakeLedger() {
  const record = vi.fn(
    async (_entry: Record<string, unknown>, _options?: { tx?: unknown }) => ({}),
  );
  return { ledger: { record }, record };
}

describe("setRileyReallocateKillSwitch", () => {
  it("flips reallocateKillSwitch ON, preserving other governanceSettings keys + writing an audit row", async () => {
    const { prisma, update } = mockPrisma({ trustLevelOverride: "autonomous" });
    const { ledger, record } = fakeLedger();
    const result = await setRileyReallocateKillSwitch(prisma, ledger, {
      organizationId: "org_1",
      enabled: true,
      actor: "ops@x",
    });
    expect(result).toEqual({ previous: false, current: true });
    // Read-modify-write preserves the other key.
    expect(
      (update.mock.calls[0]![0].data as { governanceSettings: Record<string, unknown> })
        .governanceSettings,
    ).toEqual({
      trustLevelOverride: "autonomous",
      reallocateKillSwitch: true,
    });
    expect(record).toHaveBeenCalledTimes(1);
    const audit = record.mock.calls[0]![0] as { eventType: string; snapshot: { flag: string } };
    expect(audit.eventType).toBe("policy.updated");
    expect(audit.snapshot.flag).toBe("reallocateKillSwitch");
  });

  it("reports the previous value when already set", async () => {
    const { prisma } = mockPrisma({ reallocateKillSwitch: true });
    const { ledger } = fakeLedger();
    const result = await setRileyReallocateKillSwitch(prisma, ledger, {
      organizationId: "org_1",
      enabled: false,
      actor: "ops@x",
    });
    expect(result).toEqual({ previous: true, current: false });
  });
});

describe("setRileyReallocateSelfExecution", () => {
  it("flips the canary enable flag and audits the distinct key", async () => {
    const { prisma, update } = mockPrisma(null);
    const { ledger, record } = fakeLedger();
    const result = await setRileyReallocateSelfExecution(prisma, ledger, {
      organizationId: "org_1",
      enabled: true,
      actor: "ops@x",
    });
    expect(result).toEqual({ previous: false, current: true });
    expect(
      (update.mock.calls[0]![0].data as { governanceSettings: Record<string, unknown> })
        .governanceSettings,
    ).toEqual({
      reallocateSelfExecutionEnabled: true,
    });
    expect((record.mock.calls[0]![0] as { snapshot: { flag: string } }).snapshot.flag).toBe(
      "reallocateSelfExecutionEnabled",
    );
  });
});

describe("setRileyReallocate* error paths", () => {
  it("throws when the org has no Riley deployment", async () => {
    const prisma = {
      agentListing: { findUnique: vi.fn(async () => ({ id: "listing_1" })) },
      agentDeployment: { findUnique: vi.fn(async () => null), update: vi.fn() },
    } as unknown as PrismaClient;
    const { ledger } = fakeLedger();
    await expect(
      setRileyReallocateKillSwitch(prisma, ledger, {
        organizationId: "org_x",
        enabled: true,
        actor: "ops@x",
      }),
    ).rejects.toThrow(/no riley deployment/);
  });

  it("throws when the ad-optimizer listing is missing", async () => {
    const prisma = {
      agentListing: { findUnique: vi.fn(async () => null) },
      agentDeployment: { findUnique: vi.fn(), update: vi.fn() },
    } as unknown as PrismaClient;
    const { ledger } = fakeLedger();
    await expect(
      setRileyReallocateSelfExecution(prisma, ledger, {
        organizationId: "org_1",
        enabled: true,
        actor: "ops@x",
      }),
    ).rejects.toThrow(/listing not found/);
  });
});

describe("setRileyReallocate* audit atomicity (P3-2)", () => {
  it("wraps the flip + audit write in one transaction and threads the tx into ledger.record", async () => {
    // Both reallocate toggles share setRileyReallocateFlag, so the kill switch
    // exercises the same transactional path the canary enable flag uses.
    const { prisma, update, tx, transaction } = mockPrisma({ trustLevelOverride: "autonomous" });
    const { ledger, record } = fakeLedger();
    await setRileyReallocateKillSwitch(prisma, ledger, {
      organizationId: "org_1",
      enabled: true,
      actor: "ops@x",
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]![1]?.tx).toBe(tx);
  });

  it("rejects out of the transaction when the audit write fails (flip rolls back)", async () => {
    // Proving the ledger error escapes setRileyReallocateSelfExecution proves
    // the flip + audit are bound: a ledger failure can never leave a reallocate
    // self-execution flag flipped with no audit row.
    const { prisma, update } = mockPrisma(null);
    const { ledger, record } = fakeLedger();
    record.mockRejectedValueOnce(new Error("ledger chain write failed"));
    await expect(
      setRileyReallocateSelfExecution(prisma, ledger, {
        organizationId: "org_1",
        enabled: true,
        actor: "ops@x",
      }),
    ).rejects.toThrow(/ledger chain write failed/);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
