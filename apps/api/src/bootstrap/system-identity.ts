import type { PrismaClient } from "@switchboard/db";

export async function ensureSystemIdentity(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction([
    prisma.principal.upsert({
      where: { id: "system" },
      update: {
        type: "system",
        name: "Switchboard System",
        organizationId: null,
        roles: ["admin"],
      },
      create: {
        id: "system",
        type: "system",
        name: "Switchboard System",
        organizationId: null,
        roles: ["admin"],
      },
    }),
    prisma.identitySpec.upsert({
      where: { id: "default" },
      update: {
        principalId: "system",
        organizationId: null,
        name: "Default Identity Spec",
        description: "Default governance identity for system-managed actions",
        riskTolerance: {
          none: "none",
          low: "none",
          medium: "standard",
          high: "elevated",
          critical: "mandatory",
        },
        globalSpendLimits: {
          daily: 10000,
          weekly: 50000,
          monthly: 200000,
          perAction: 5000,
        },
        cartridgeSpendLimits: {},
        forbiddenBehaviors: [],
        trustBehaviors: [],
        delegatedApprovers: [],
      },
      create: {
        id: "default",
        principalId: "system",
        organizationId: null,
        name: "Default Identity Spec",
        description: "Default governance identity for system-managed actions",
        riskTolerance: {
          none: "none",
          low: "none",
          medium: "standard",
          high: "elevated",
          critical: "mandatory",
        },
        globalSpendLimits: {
          daily: 10000,
          weekly: 50000,
          monthly: 200000,
          perAction: 5000,
        },
        cartridgeSpendLimits: {},
        forbiddenBehaviors: [],
        trustBehaviors: [],
        delegatedApprovers: [],
      },
    }),
  ]);
}
