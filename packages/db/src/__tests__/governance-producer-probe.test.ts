import { describe, it, expect, vi } from "vitest";
import {
  createGovernanceProducerProbe,
  type GovernanceProducerProbeDeps,
} from "../governance-producer-probe.js";

function makeDeps(over: Partial<GovernanceProducerProbeDeps> = {}): GovernanceProducerProbeDeps {
  return {
    playbookReader: {
      readForOrganization: vi
        .fn()
        .mockResolvedValue({ services: [{ price: 250 }, { price: undefined }, { price: 100 }] }),
    },
    prisma: {
      approvedComplianceClaim: { count: vi.fn().mockResolvedValue(2) },
      organizationConfig: {
        findUnique: vi.fn().mockResolvedValue({
          runtimeConfig: {
            whatsappTemplateApprovals: { tmpl_a: "approved", tmpl_b: "draft", tmpl_c: "approved" },
          },
        }),
      },
    },
    clock: () => new Date("2026-06-25T00:00:00.000Z"),
    ...over,
  };
}

describe("createGovernanceProducerProbe", () => {
  it("counts finite prices, valid deployment-scoped claims, and approved templates", async () => {
    const deps = makeDeps();
    const signals = await createGovernanceProducerProbe(deps)("org-1", "dep-1");

    expect(signals).toEqual({
      approvedPriceCount: 2, // 250 + 100; undefined excluded
      approvedClaimCount: 2,
      approvedTemplateCount: 2, // tmpl_a + tmpl_c; draft excluded
    });
    expect(deps.prisma.approvedComplianceClaim.count).toHaveBeenCalledWith({
      where: {
        deploymentId: "dep-1",
        OR: [{ validUntil: null }, { validUntil: { gte: new Date("2026-06-25T00:00:00.000Z") } }],
      },
    });
    expect(deps.playbookReader.readForOrganization).toHaveBeenCalledWith("org-1");
    expect(deps.prisma.organizationConfig.findUnique).toHaveBeenCalledWith({
      where: { id: "org-1" },
      select: { runtimeConfig: true },
    });
  });

  it("treats a missing playbook / runtimeConfig as zero producers", async () => {
    const deps = makeDeps({
      playbookReader: { readForOrganization: vi.fn().mockResolvedValue(null) },
      prisma: {
        approvedComplianceClaim: { count: vi.fn().mockResolvedValue(0) },
        organizationConfig: { findUnique: vi.fn().mockResolvedValue(null) },
      },
    });
    expect(await createGovernanceProducerProbe(deps)("org-x", "dep-x")).toEqual({
      approvedPriceCount: 0,
      approvedClaimCount: 0,
      approvedTemplateCount: 0,
    });
  });

  it("counts a finite 0 price (matches the gate's finite-number filter) and excludes NaN", async () => {
    const deps = makeDeps({
      playbookReader: {
        readForOrganization: vi
          .fn()
          .mockResolvedValue({ services: [{ price: Number.NaN }, { price: 0 }, {}] }),
      },
    });
    expect((await createGovernanceProducerProbe(deps)("o", "d")).approvedPriceCount).toBe(1);
  });
});
