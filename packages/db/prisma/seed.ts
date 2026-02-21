import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Create system principal
  const systemPrincipal = await prisma.principal.upsert({
    where: { id: "system" },
    update: {},
    create: {
      id: "system",
      type: "system",
      name: "Switchboard System",
      organizationId: null,
      roles: ["admin"],
    },
  });

  console.log("Seeded system principal:", systemPrincipal.id);

  // Create default identity spec
  const defaultSpec = await prisma.identitySpec.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      principalId: systemPrincipal.id,
      name: "Default Identity Spec",
      description: "Default governance identity with conservative risk tolerance",
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
    },
  });

  console.log("Seeded default identity spec:", defaultSpec.id);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
