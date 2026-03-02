import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaIdentityStore } from "../prisma-identity-store.js";

function createMockPrisma() {
  return {
    identitySpec: {
      upsert: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    roleOverlay: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    principal: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    delegationRule: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
  };
}

const NOW = new Date("2025-01-01");

const TEST_SPEC_ROW = {
  id: "spec_1",
  principalId: "principal_1",
  organizationId: "org_1",
  name: "Test Spec",
  description: "A test spec",
  riskTolerance: { maxRiskCategory: "medium" },
  globalSpendLimits: { daily: 1000 },
  cartridgeSpendLimits: {},
  forbiddenBehaviors: ["delete"],
  trustBehaviors: ["read"],
  delegatedApprovers: ["approver_1"],
  createdAt: NOW,
  updatedAt: NOW,
};

const TEST_PRINCIPAL_ROW = {
  id: "principal_1",
  type: "agent",
  name: "Test Agent",
  organizationId: "org_1",
  roles: ["operator"],
};

const TEST_DELEGATION_ROW = {
  id: "rule_1",
  grantorId: "principal_1",
  granteeId: "principal_2",
  scope: "ad.create",
  expiresAt: NOW,
};

describe("PrismaIdentityStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaIdentityStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaIdentityStore(prisma as any);
  });

  describe("saveSpec", () => {
    it("upserts identity spec", async () => {
      prisma.identitySpec.upsert.mockResolvedValue({});

      const spec = {
        id: "spec_1",
        principalId: "principal_1",
        organizationId: "org_1",
        name: "Test Spec",
        description: "A test spec",
        riskTolerance: { maxRiskCategory: "medium" },
        globalSpendLimits: { daily: 1000 },
        cartridgeSpendLimits: {},
        forbiddenBehaviors: ["delete"],
        trustBehaviors: ["read"],
        delegatedApprovers: ["approver_1"],
        createdAt: NOW,
        updatedAt: NOW,
      };

      await store.saveSpec(spec as any);

      expect(prisma.identitySpec.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "spec_1" },
          create: expect.objectContaining({
            id: "spec_1",
            principalId: "principal_1",
            name: "Test Spec",
          }),
          update: expect.objectContaining({
            principalId: "principal_1",
            name: "Test Spec",
          }),
        }),
      );
    });
  });

  describe("getSpecByPrincipalId", () => {
    it("returns identity spec when found", async () => {
      prisma.identitySpec.findFirst.mockResolvedValue(TEST_SPEC_ROW);

      const result = await store.getSpecByPrincipalId("principal_1");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("spec_1");
      expect(result!.principalId).toBe("principal_1");
      expect(result!.forbiddenBehaviors).toEqual(["delete"]);
      expect(prisma.identitySpec.findFirst).toHaveBeenCalledWith({
        where: { principalId: "principal_1" },
      });
    });

    it("returns null when not found", async () => {
      prisma.identitySpec.findFirst.mockResolvedValue(null);

      const result = await store.getSpecByPrincipalId("missing");
      expect(result).toBeNull();
    });
  });

  describe("getSpecById", () => {
    it("returns identity spec by id", async () => {
      prisma.identitySpec.findUnique.mockResolvedValue(TEST_SPEC_ROW);

      const result = await store.getSpecById("spec_1");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("Test Spec");
      expect(prisma.identitySpec.findUnique).toHaveBeenCalledWith({
        where: { id: "spec_1" },
      });
    });

    it("returns null when not found", async () => {
      prisma.identitySpec.findUnique.mockResolvedValue(null);

      const result = await store.getSpecById("missing");
      expect(result).toBeNull();
    });
  });

  describe("getPrincipal", () => {
    it("returns principal when found", async () => {
      prisma.principal.findUnique.mockResolvedValue(TEST_PRINCIPAL_ROW);

      const result = await store.getPrincipal("principal_1");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("principal_1");
      expect(result!.type).toBe("agent");
      expect(result!.name).toBe("Test Agent");
      expect(result!.roles).toEqual(["operator"]);
      expect(prisma.principal.findUnique).toHaveBeenCalledWith({
        where: { id: "principal_1" },
      });
    });

    it("returns null when not found", async () => {
      prisma.principal.findUnique.mockResolvedValue(null);

      const result = await store.getPrincipal("missing");
      expect(result).toBeNull();
    });
  });

  describe("savePrincipal", () => {
    it("upserts principal", async () => {
      prisma.principal.upsert.mockResolvedValue({});

      await store.savePrincipal({
        id: "principal_1",
        type: "agent",
        name: "Test Agent",
        organizationId: "org_1",
        roles: ["operator"],
      } as any);

      expect(prisma.principal.upsert).toHaveBeenCalledWith({
        where: { id: "principal_1" },
        create: expect.objectContaining({
          id: "principal_1",
          type: "agent",
          name: "Test Agent",
          organizationId: "org_1",
          roles: ["operator"],
        }),
        update: expect.objectContaining({
          type: "agent",
          name: "Test Agent",
          organizationId: "org_1",
          roles: ["operator"],
        }),
      });
    });
  });

  describe("listDelegationRules", () => {
    it("returns mapped delegation rules", async () => {
      prisma.delegationRule.findMany.mockResolvedValue([TEST_DELEGATION_ROW]);

      const result = await store.listDelegationRules();
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: "rule_1",
        grantor: "principal_1",
        grantee: "principal_2",
        scope: "ad.create",
        expiresAt: NOW,
      });
      expect(prisma.delegationRule.findMany).toHaveBeenCalled();
    });
  });

  describe("saveDelegationRule", () => {
    it("upserts delegation rule with connect syntax", async () => {
      prisma.delegationRule.upsert.mockResolvedValue({});

      await store.saveDelegationRule({
        id: "rule_1",
        grantor: "principal_1",
        grantee: "principal_2",
        scope: "ad.create",
        expiresAt: NOW,
      });

      expect(prisma.delegationRule.upsert).toHaveBeenCalledWith({
        where: { id: "rule_1" },
        create: expect.objectContaining({
          id: "rule_1",
          grantor: { connect: { id: "principal_1" } },
          grantee: { connect: { id: "principal_2" } },
          scope: "ad.create",
          expiresAt: NOW,
        }),
        update: expect.objectContaining({
          grantor: { connect: { id: "principal_1" } },
          grantee: { connect: { id: "principal_2" } },
          scope: "ad.create",
          expiresAt: NOW,
        }),
      });
    });
  });
});
