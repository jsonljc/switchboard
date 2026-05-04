import { randomUUID, createHash } from "crypto";
import type { PrismaClient } from "@prisma/client";
import { seedOrgDayOneAgents } from "@switchboard/db";
import { encryptApiKey } from "./crypto";

interface ProvisionDashboardUserInput {
  email: string;
  name?: string | null;
  emailVerified?: Date | null;
  googleId?: string | null;
  passwordHash?: string | null;
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
        // Slice A PR 2: brand-new orgs land on the agent-first nav. This is a
        // fresh `create()` (not an upsert) — there is no `update` branch to
        // worry about. Existing orgs are not affected by this code path.
        useAgentFirstNav: true,
      },
    });

    await tx.principal.create({
      data: {
        id: principalId,
        type: "user",
        name: displayName,
        organizationId: orgId,
        // Org creator gets full admin roles for self-serve setup
        roles: ["operator", "admin", "approver"],
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
        googleId: input.googleId ?? null,
        organizationId: orgId,
        principalId,
        apiKeyEncrypted: encryptApiKey(apiKey),
        apiKeyHash: createHash("sha256").update(apiKey).digest("hex"),
        ...(input.passwordHash ? { passwordHash: input.passwordHash } : {}),
      },
    });
  });

  // Slice A PR 2: seed day-one agent enablement (alex, riley) for the new
  // org. Run AFTER the transaction commits — the helper takes a PrismaClient
  // (not a transaction client) and is idempotent, so post-commit seeding is
  // safe and avoids transaction-client typing complications.
  await seedOrgDayOneAgents(prisma, orgId);

  return dashboardUser;
}
