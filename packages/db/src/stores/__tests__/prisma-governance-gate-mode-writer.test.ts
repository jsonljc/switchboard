import { describe, it, expect, vi } from "vitest";
import {
  PrismaGovernanceGateModeWriter,
  DeploymentNotFoundError,
  GovernanceConfigInvalidError,
} from "../prisma-governance-gate-mode-writer.js";
import { buildObserveGovernanceConfig, readGateMode } from "@switchboard/schemas";

const observe = buildObserveGovernanceConfig({ jurisdiction: "SG", clinicType: "medical" });

function buildPrisma(over: Record<string, unknown> = {}) {
  const prisma = {
    $transaction: vi.fn(),
    $queryRaw: vi.fn().mockResolvedValue([{ governanceConfig: observe }]),
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
    data: { governanceConfig: unknown };
  };
}

describe("PrismaGovernanceGateModeWriter.setGateMode", () => {
  it("locks the row, merges the unit's mode preserving siblings, updates org-scoped", async () => {
    const prisma = buildPrisma();
    const writer = new PrismaGovernanceGateModeWriter(prisma as never);

    const out = await writer.setGateMode({
      organizationId: "org-1",
      deploymentId: "dep-1",
      unit: "deterministic",
      mode: "enforce",
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1); // the FOR UPDATE locked read
    const arg = writtenConfig(prisma);
    expect(arg.where).toEqual({ id: "dep-1", organizationId: "org-1" });
    expect(readGateMode(arg.data.governanceConfig as never, "deterministic")).toBe("enforce");
    expect(readGateMode(arg.data.governanceConfig as never, "claims")).toBe("observe"); // sibling preserved
    expect(out).toEqual({ id: "dep-1", governanceConfig: arg.data.governanceConfig });
  });

  it("throws DeploymentNotFoundError when the locked read returns no row (org scope) and never writes", async () => {
    const prisma = buildPrisma({ $queryRaw: vi.fn().mockResolvedValue([]) });
    const writer = new PrismaGovernanceGateModeWriter(prisma as never);

    await expect(
      writer.setGateMode({
        organizationId: "other-org",
        deploymentId: "dep-1",
        unit: "consent",
        mode: "enforce",
      }),
    ).rejects.toBeInstanceOf(DeploymentNotFoundError);
    expect(prisma.agentDeployment.updateMany).not.toHaveBeenCalled();
  });

  it("throws GovernanceConfigInvalidError on a corrupt stored config (never blind-overwrites)", async () => {
    const prisma = buildPrisma({
      $queryRaw: vi.fn().mockResolvedValue([{ governanceConfig: { bogus: 1 } }]),
    });
    const writer = new PrismaGovernanceGateModeWriter(prisma as never);

    await expect(
      writer.setGateMode({
        organizationId: "org-1",
        deploymentId: "dep-1",
        unit: "consent",
        mode: "enforce",
      }),
    ).rejects.toBeInstanceOf(GovernanceConfigInvalidError);
    expect(prisma.agentDeployment.updateMany).not.toHaveBeenCalled();
  });

  it("passes deploymentId + organizationId into the locked read (the FOR UPDATE scope)", async () => {
    const prisma = buildPrisma();
    const writer = new PrismaGovernanceGateModeWriter(prisma as never);
    await writer.setGateMode({
      organizationId: "org-1",
      deploymentId: "dep-1",
      unit: "whatsapp",
      mode: "off",
    });
    const call = prisma.$queryRaw.mock.calls[0]!;
    expect(call).toContain("dep-1");
    expect(call).toContain("org-1");
  });
});
