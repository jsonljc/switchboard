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
        // New users start as operator only — admin/approver roles must be granted explicitly
        roles: ["operator"],
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
          daily: 500,
          weekly: 2000,
          monthly: 5000,
          perAction: 100,
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
