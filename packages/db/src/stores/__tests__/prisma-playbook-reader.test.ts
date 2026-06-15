import { describe, it, expect, vi, afterEach } from "vitest";
import { createEmptyPlaybook, type Playbook } from "@switchboard/schemas";
import { resolveBookedValueCents } from "@switchboard/core/skill-runtime";
import { PrismaPlaybookReader } from "../prisma-playbook-reader.js";

function mockPrisma(onboardingPlaybook: unknown, orgExists = true) {
  const findUnique = vi.fn().mockResolvedValue(orgExists ? { onboardingPlaybook } : null);
  const prisma = {
    organizationConfig: { findUnique },
  } as unknown as import("@prisma/client").PrismaClient;
  return { prisma, findUnique };
}

function pricedPlaybook(): Playbook {
  const base = createEmptyPlaybook();
  return {
    ...base,
    services: [
      {
        id: "svc_botox",
        name: "Botox",
        price: 250,
        bookingBehavior: "ask_first",
        status: "ready",
        source: "manual",
      },
    ],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PrismaPlaybookReader", () => {
  it("returns the parsed playbook when onboardingPlaybook is a valid PlaybookSchema", async () => {
    const reader = new PrismaPlaybookReader(mockPrisma(pricedPlaybook()).prisma);
    const result = await reader.readForOrganization("org_1");
    expect(result?.services[0]?.id).toBe("svc_botox");
    expect(result?.services[0]?.price).toBe(250);
  });

  it("queries OrganizationConfig by id (= orgId) and selects only onboardingPlaybook", async () => {
    const { prisma, findUnique } = mockPrisma(pricedPlaybook());
    await new PrismaPlaybookReader(prisma).readForOrganization("org_42");
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "org_42" },
      select: { onboardingPlaybook: true },
    });
  });

  it("abstains (null) when the org config is not found", async () => {
    const reader = new PrismaPlaybookReader(mockPrisma(null, false).prisma);
    expect(await reader.readForOrganization("missing")).toBeNull();
  });

  it("abstains (null) when onboardingPlaybook was never persisted (null column)", async () => {
    const reader = new PrismaPlaybookReader(mockPrisma(null).prisma);
    expect(await reader.readForOrganization("org_1")).toBeNull();
  });

  it("abstains (null) without throwing when onboardingPlaybook is malformed, warning PII-safely", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const reader = new PrismaPlaybookReader(
      mockPrisma({ services: "not-an-array", junk: 1 }).prisma,
    );
    expect(await reader.readForOrganization("org_1")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    // The warn must not dump the raw config (it can hold business PII).
    const dumped = JSON.stringify(warn.mock.calls[0]);
    expect(dumped).not.toContain("not-an-array");
  });

  // Producer-with-consumer seam: the reader's REAL parsed output feeds the REAL
  // resolveBookedValueCents consumer (the exact wire D3-1 activates).
  describe("seam: reader output feeds resolveBookedValueCents", () => {
    it("resolves a booked value (cents) from a real persisted playbook by name or id", async () => {
      const reader = new PrismaPlaybookReader(mockPrisma(pricedPlaybook()).prisma);
      const playbook = await reader.readForOrganization("org_1");
      expect(resolveBookedValueCents({ service: "Botox", services: playbook?.services })).toBe(
        25000,
      );
      expect(resolveBookedValueCents({ service: "svc_botox", services: playbook?.services })).toBe(
        25000,
      );
      expect(
        resolveBookedValueCents({ service: "not-a-service", services: playbook?.services }),
      ).toBeNull();
    });
  });
});
