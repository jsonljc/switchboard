import { randomUUID, createHash } from "crypto";
import type { PrismaClient } from "@prisma/client";
import { DEFAULT_BUSINESS_HOURS } from "@switchboard/schemas";
import { encryptApiKey } from "../crypto/api-key.js";
import { seedOrgDayOneAgents } from "./seed-org-day-one-agents.js";
import { provisionOrgAgentDeployments, ensureAlexForOrg } from "./provision-org-agents.js";
import { seedAlexSkillPack } from "./seed-alex-skill-pack.js";

export interface ProvisionOrgWithOwnerInput {
  email: string;
  name?: string | null;
  emailVerified?: Date | null;
  googleId?: string | null;
  passwordHash?: string | null;
}

/**
 * Canonical "create an org + its owner" provisioning. Creates the OrganizationConfig
 * (comped + default business hours so a fresh org books and acts out of the box),
 * the owner Principal (full admin roles), the owner IdentitySpec, and the
 * DashboardUser (with an encrypted apiKey that the request path decrypts), then seeds
 * day-one agent enablement post-commit.
 *
 * This is the single source for org+owner creation. The dashboard signup paths
 * (register route, OAuth adapter) re-export this as `provisionDashboardUser`.
 *
 * It deliberately does NOT provision Riley's deployment — signup defers that to the
 * lazy GET /config (agent tiering). Eager Riley provisioning is a script-only concern;
 * see `provisionPilotOrg`.
 */
export async function provisionOrgWithOwner(
  prisma: PrismaClient,
  input: ProvisionOrgWithOwnerInput,
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
        // F-01: seed valid default business hours so a fresh org resolves
        // LocalCalendarProvider (not Noop) and the booking loop works out of the box.
        businessHours: DEFAULT_BUSINESS_HOURS,
        // F-02: comp the pilot org so a freshly provisioned org is entitled and can act
        // out of the box. entitlementOverride is the documented comped-pilot field. Set
        // ONLY by trusted provisioning; launch/pilot-only, unwound at billing-live. See
        // docs/superpowers/specs/2026-06-14-fresh-org-entitlement-design.md
        entitlementOverride: true,
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

/**
 * Provisions a fully-usable pilot clinic org: the owner (via provisionOrgWithOwner)
 * PLUS Riley's deployment, eagerly. Unlike signup (which defers Riley to the lazy
 * GET /config), an operator-onboarded pilot org is provisioned whole so the clinic is
 * immediately actionable while self-serve signup is closed (waitlist launch mode).
 */
export async function provisionPilotOrg(prisma: PrismaClient, input: ProvisionOrgWithOwnerInput) {
  const user = await provisionOrgWithOwner(prisma, input);
  await provisionOrgAgentDeployments(prisma, user.organizationId, { mira: false });
  // Eagerly provision Alex whole (global listing + this org's active deployment + the
  // medspa skill pack) so a CLI-onboarded pilot org is immediately actionable on the
  // first inbound lead, without waiting for the lazy GET /config route to seed Alex.
  // Both are idempotent, so a re-run converges a partially-provisioned org.
  await ensureAlexForOrg(prisma, user.organizationId);
  await seedAlexSkillPack(prisma, user.organizationId);
  return user;
}
