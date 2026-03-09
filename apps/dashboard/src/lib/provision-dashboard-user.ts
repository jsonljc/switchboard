import { randomUUID, createHash } from "crypto";
import type { PrismaClient } from "@prisma/client";
import { encryptApiKey } from "./crypto";

interface ProvisionDashboardUserInput {
  email: string;
  name?: string | null;
  emailVerified?: Date | null;
}

export async function provisionDashboardUser(
  prisma: PrismaClient,
  input: ProvisionDashboardUserInput,
) {
  const orgId = `org_${randomUUID()}`;
  const principalId = `principal_${randomUUID()}`;
  const specId = `spec_${randomUUID()}`;
  const apiKey = `sk_${randomUUID().replace(/-/g, "")}`;
  const displayName = input.name?.trim() || input.email;

  const dashboardUser = await prisma.$transaction(async (tx) => {
    await tx.organizationConfig.create({
      data: {
        id: orgId,
        name: displayName,
        runtimeType: "managed",
        governanceProfile: "guarded",
        tier: "smb",
        onboardingComplete: false,
        provisioningStatus: "pending",
      },
    });

    await tx.principal.create({
      data: {
        id: principalId,
        type: "user",
        name: displayName,
        organizationId: orgId,
        roles: ["admin", "approver", "operator"],
      },
    });

    await tx.identitySpec.create({
      data: {
        id: specId,
        principalId,
        organizationId: orgId,
        name: `${displayName} Identity`,
        description: `Primary owner identity for ${displayName}`,
        riskTolerance: {
          none: "none",
          low: "none",
          medium: "standard",
          high: "elevated",
          critical: "mandatory",
        },
        globalSpendLimits: {
          daily: 5000,
          weekly: 20000,
          monthly: 50000,
          perAction: 1000,
        },
        cartridgeSpendLimits: {},
        forbiddenBehaviors: [],
        trustBehaviors: [],
        delegatedApprovers: [],
      },
    });

    return tx.dashboardUser.create({
      data: {
        id: randomUUID(),
        email: input.email,
        name: input.name,
        emailVerified: input.emailVerified,
        organizationId: orgId,
        principalId,
        apiKeyEncrypted: encryptApiKey(apiKey),
        apiKeyHash: createHash("sha256").update(apiKey).digest("hex"),
      },
    });
  });

  return dashboardUser;
}
