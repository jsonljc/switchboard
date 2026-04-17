import { describe, it, expect, vi } from "vitest";
import { PrismaDeploymentResolver } from "../prisma-deployment-resolver.js";
import { DeploymentInactiveError } from "../deployment-resolver.js";

function makeDeploymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "dep-1",
    organizationId: "org-1",
    listingId: "list-1",
    status: "active",
    skillSlug: "sales-pipeline",
    inputConfig: { businessName: "Test Co", tone: "friendly" },
    governanceSettings: {},
    circuitBreakerThreshold: null,
    maxWritesPerHour: null,
    allowedModelTiers: [],
    spendApprovalThreshold: 50,
    listing: {
      id: "list-1",
      trustScore: 42,
      status: "active",
    },
    connections: [],
    ...overrides,
  };
}

function makeMockPrisma(deploymentRow: ReturnType<typeof makeDeploymentRow> | null = null) {
  return {
    agentDeployment: {
      findUnique: vi.fn().mockResolvedValue(deploymentRow),
      findFirst: vi.fn().mockResolvedValue(deploymentRow),
    },
    deploymentConnection: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          deploymentRow
            ? {
                id: "conn-1",
                deploymentId: deploymentRow.id,
                channel: "telegram",
                token: "tok-123",
              }
            : null,
        ),
    },
  } as any;
}

describe("PrismaDeploymentResolver", () => {
  describe("resolveByDeploymentId", () => {
    it("returns DeploymentResolverResult for an active deployment", async () => {
      const row = makeDeploymentRow();
      const prisma = makeMockPrisma(row);
      const resolver = new PrismaDeploymentResolver(prisma);

      const result = await resolver.resolveByDeploymentId("dep-1");

      expect(result.deploymentId).toBe("dep-1");
      expect(result.skillSlug).toBe("sales-pipeline");
      expect(result.trustScore).toBe(42);
      expect(result.trustLevel).toBe("guided");
      expect(result.organizationId).toBe("org-1");
    });

    it("throws DeploymentInactiveError when deployment status is not active", async () => {
      const row = makeDeploymentRow({ status: "deactivated" });
      const prisma = makeMockPrisma(row);
      const resolver = new PrismaDeploymentResolver(prisma);

      await expect(resolver.resolveByDeploymentId("dep-1")).rejects.toThrow(
        DeploymentInactiveError,
      );
    });

    it("throws DeploymentInactiveError when listing is delisted", async () => {
      const row = makeDeploymentRow({
        listing: { id: "list-1", trustScore: 42, status: "delisted" },
      });
      const prisma = makeMockPrisma(row);
      const resolver = new PrismaDeploymentResolver(prisma);

      await expect(resolver.resolveByDeploymentId("dep-1")).rejects.toThrow(
        DeploymentInactiveError,
      );
    });

    it("throws when deployment not found", async () => {
      const prisma = makeMockPrisma(null);
      const resolver = new PrismaDeploymentResolver(prisma);

      await expect(resolver.resolveByDeploymentId("dep-missing")).rejects.toThrow("not found");
    });

    it("computes trust level correctly", async () => {
      const autonomous = makeDeploymentRow({
        listing: { id: "l", trustScore: 60, status: "active" },
      });
      const supervised = makeDeploymentRow({
        listing: { id: "l", trustScore: 10, status: "active" },
      });

      const p1 = makeMockPrisma(autonomous);
      const p2 = makeMockPrisma(supervised);

      const r1 = await new PrismaDeploymentResolver(p1).resolveByDeploymentId("dep-1");
      const r2 = await new PrismaDeploymentResolver(p2).resolveByDeploymentId("dep-1");

      expect(r1.trustLevel).toBe("autonomous");
      expect(r2.trustLevel).toBe("supervised");
    });

    it("extracts persona from inputConfig", async () => {
      const row = makeDeploymentRow({
        inputConfig: {
          businessName: "Acme",
          tone: "professional",
          bookingLink: "https://cal.com/acme",
        },
      });
      const prisma = makeMockPrisma(row);
      const resolver = new PrismaDeploymentResolver(prisma);

      const result = await resolver.resolveByDeploymentId("dep-1");
      expect(result.persona?.businessName).toBe("Acme");
      expect(result.persona?.tone).toBe("professional");
      expect(result.persona?.bookingLink).toBe("https://cal.com/acme");
    });

    it("extracts policyOverrides from deployment columns", async () => {
      const row = makeDeploymentRow({
        circuitBreakerThreshold: 5,
        maxWritesPerHour: 100,
        allowedModelTiers: ["default", "premium"],
        spendApprovalThreshold: 25,
      });
      const prisma = makeMockPrisma(row);
      const resolver = new PrismaDeploymentResolver(prisma);

      const result = await resolver.resolveByDeploymentId("dep-1");
      expect(result.policyOverrides).toEqual({
        circuitBreakerThreshold: 5,
        maxWritesPerHour: 100,
        allowedModelTiers: ["default", "premium"],
        spendApprovalThreshold: 25,
      });
    });

    it("throws DeploymentInactiveError when skillSlug is missing", async () => {
      const row = makeDeploymentRow({ skillSlug: null });
      const prisma = makeMockPrisma(row);
      const resolver = new PrismaDeploymentResolver(prisma);

      await expect(resolver.resolveByDeploymentId("dep-1")).rejects.toThrow(
        DeploymentInactiveError,
      );
    });
  });

  describe("resolveByOrgAndSlug", () => {
    it("resolves by organization and skill slug", async () => {
      const row = makeDeploymentRow();
      const prisma = makeMockPrisma(row);
      const resolver = new PrismaDeploymentResolver(prisma);

      const result = await resolver.resolveByOrgAndSlug("org-1", "sales-pipeline");

      expect(result.deploymentId).toBe("dep-1");
      expect(prisma.agentDeployment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: "org-1", skillSlug: "sales-pipeline", status: "active" },
        }),
      );
    });
  });

  describe("resolveByChannelToken", () => {
    it("resolves by channel and token", async () => {
      const row = makeDeploymentRow();
      const prisma = makeMockPrisma(row);
      const resolver = new PrismaDeploymentResolver(prisma);

      const result = await resolver.resolveByChannelToken("telegram", "tok-123");

      expect(result.deploymentId).toBe("dep-1");
      expect(prisma.deploymentConnection.findFirst).toHaveBeenCalled();
    });

    it("throws when no connection found", async () => {
      const prisma = {
        agentDeployment: { findUnique: vi.fn(), findFirst: vi.fn() },
        deploymentConnection: { findFirst: vi.fn().mockResolvedValue(null) },
      } as any;
      const resolver = new PrismaDeploymentResolver(prisma);

      await expect(resolver.resolveByChannelToken("telegram", "bad-token")).rejects.toThrow(
        "No deployment connection found",
      );
    });
  });
});
