import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaRoleOverrideStore } from "../prisma-role-override-store.js";

function createMockPrisma() {
  return {
    agentRoleOverride: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
}

describe("PrismaRoleOverrideStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaRoleOverrideStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock Prisma client
    store = new PrismaRoleOverrideStore(prisma as any);
  });

  describe("update", () => {
    // Issue #594 sibling regression — direct organizationId scoping on a
    // governance-administration surface (operator role overlays).
    it("scopes update WHERE by id + organizationId (TI sibling)", async () => {
      prisma.agentRoleOverride.updateMany.mockResolvedValue({ count: 1 });

      await store.update("override_1", { allowedTools: ["a", "b"] }, "org_1");

      const callArgs = prisma.agentRoleOverride.updateMany.mock.calls[0]![0];
      expect(callArgs.where).toEqual({ id: "override_1", organizationId: "org_1" });
    });

    it("throws when update count=0 (tenant mismatch or missing row)", async () => {
      prisma.agentRoleOverride.updateMany.mockResolvedValue({ count: 0 });

      await expect(store.update("override_1", { allowedTools: ["a"] }, "org_X")).rejects.toThrow(
        /not found or tenant mismatch/,
      );
    });

    it("includes allowedTools + safetyEnvelopeOverride + governanceProfileOverride when provided", async () => {
      prisma.agentRoleOverride.updateMany.mockResolvedValue({ count: 1 });

      await store.update(
        "override_1",
        {
          allowedTools: ["x", "y"],
          safetyEnvelopeOverride: {
            maxToolCalls: 50,
            maxMutations: 5,
            maxDollarsAtRisk: 1000,
          },
          governanceProfileOverride: "strict",
        },
        "org_1",
      );

      const callArgs = prisma.agentRoleOverride.updateMany.mock.calls[0]![0];
      expect(callArgs.data).toMatchObject({
        allowedTools: ["x", "y"],
        governanceProfileOverride: "strict",
      });
      expect(callArgs.data.safetyEnvelopeOverride).toBeDefined();
    });
  });
});
