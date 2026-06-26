import { describe, it, expect, vi } from "vitest";
import { PrismaGovernanceMarketWriter } from "../prisma-governance-market-writer.js";
import {
  DeploymentNotFoundError,
  GovernanceConfigInvalidError,
} from "../prisma-governance-gate-mode-writer.js";
import { buildObserveGovernanceConfig, readGateMode } from "@switchboard/schemas";

// Seeded SG/medical config with a non-default gate field, to prove the market write
// preserves gate sub-blocks.
const seeded = {
  ...buildObserveGovernanceConfig({ jurisdiction: "SG", clinicType: "medical" }),
  deterministicGate: { mode: "enforce" as const },
};

function buildPrisma(over: Record<string, unknown> = {}) {
  const prisma = {
    $transaction: vi.fn(),
    $queryRaw: vi.fn().mockResolvedValue([{ governanceConfig: seeded }]),
    agentDeployment: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    ...over,
  };
  (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
    (cb: (tx: unknown) => Promise<unknown>) => cb(prisma),
  );
  return prisma;
}

function writtenConfig(prisma: { agentDeployment: { updateMany: ReturnType<typeof vi.fn> } }) {
  return prisma.agentDeployment.updateMany.mock.calls[0]![0] as {
    where: unknown;
    data: { governanceConfig: { jurisdiction: string; clinicType: string } };
  };
}

describe("PrismaGovernanceMarketWriter.setMarket", () => {
  it("locks the row, sets market preserving gate sub-blocks, updates org-scoped", async () => {
    const prisma = buildPrisma();
    const writer = new PrismaGovernanceMarketWriter(prisma as never);

    const out = await writer.setMarket({
      organizationId: "org-1",
      deploymentId: "dep-1",
      jurisdiction: "MY",
      clinicType: "nonMedical",
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1); // the FOR UPDATE locked read
    const arg = writtenConfig(prisma);
    expect(arg.where).toEqual({ id: "dep-1", organizationId: "org-1" });
    expect(arg.data.governanceConfig.jurisdiction).toBe("MY");
    expect(arg.data.governanceConfig.clinicType).toBe("nonMedical");
    // gate sub-block preserved (not reset by the market write)
    expect(readGateMode(arg.data.governanceConfig as never, "deterministic")).toBe("enforce");
    expect(out).toEqual({ id: "dep-1", governanceConfig: arg.data.governanceConfig });
  });

  it("throws DeploymentNotFoundError when the locked read returns no row (org scope) and never writes", async () => {
    const prisma = buildPrisma({ $queryRaw: vi.fn().mockResolvedValue([]) });
    const writer = new PrismaGovernanceMarketWriter(prisma as never);

    await expect(
      writer.setMarket({
        organizationId: "other-org",
        deploymentId: "dep-1",
        jurisdiction: "MY",
        clinicType: "medical",
      }),
    ).rejects.toBeInstanceOf(DeploymentNotFoundError);
    expect(prisma.agentDeployment.updateMany).not.toHaveBeenCalled();
  });

  it("throws GovernanceConfigInvalidError on a corrupt stored config (never blind-overwrites)", async () => {
    const prisma = buildPrisma({
      $queryRaw: vi.fn().mockResolvedValue([{ governanceConfig: { bogus: 1 } }]),
    });
    const writer = new PrismaGovernanceMarketWriter(prisma as never);

    await expect(
      writer.setMarket({
        organizationId: "org-1",
        deploymentId: "dep-1",
        jurisdiction: "MY",
        clinicType: "medical",
      }),
    ).rejects.toBeInstanceOf(GovernanceConfigInvalidError);
    expect(prisma.agentDeployment.updateMany).not.toHaveBeenCalled();
  });

  it("passes deploymentId + organizationId into the locked read (the FOR UPDATE scope)", async () => {
    const prisma = buildPrisma();
    const writer = new PrismaGovernanceMarketWriter(prisma as never);
    await writer.setMarket({
      organizationId: "org-1",
      deploymentId: "dep-1",
      jurisdiction: "SG",
      clinicType: "medical",
    });
    const call = prisma.$queryRaw.mock.calls[0]!;
    expect(call).toContain("dep-1");
    expect(call).toContain("org-1");
  });
});
