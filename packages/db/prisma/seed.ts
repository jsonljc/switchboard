/* eslint-disable max-lines, no-console */
import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";
import bcrypt from "bcryptjs";
import { encryptApiKey } from "../src/crypto/api-key.js";
import { seedMarketplace, seedDemoData } from "./seed-marketplace.js";
import { seedKnowledge } from "./seed-knowledge.js";
import { seedDevData } from "./seed-dev-data.js";
import { seedOrgDayOneAgents } from "../src/seed/seed-org-day-one-agents.js";
import { seedAlexSkillPack } from "../src/seed/seed-alex-skill-pack.js";
import { seedMiraPilotOrgs } from "../src/seed/seed-mira-pilot-orgs.js";
import { seedMiraDemoCreatives } from "../src/seed/seed-mira-demo-creatives.js";
import { seedMiraCreativeDeployment } from "../src/seed/seed-mira-creative-deployment.js";
import { seedRileyAdOptimizerDeployment } from "../src/seed/seed-riley-ad-optimizer-deployment.js";
import { seedRobinRecoveryPolicies } from "../src/seed/robin-recovery-governance.js";

const prisma = new PrismaClient();

// ── Encryption for dev seed data ──
// encryptApiKey is the canonical impl from @switchboard/db (src/crypto/api-key.ts):
// AES-256-GCM keyed by sha256(CREDENTIALS_ENCRYPTION_KEY). Sharing one impl with the
// dashboard/API runtime guarantees every seeded user's apiKeyEncrypted stays
// decryptable at request time (the previous local copy carried that invariant by hand).
function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

async function main() {
  // ── 1. System principal ──
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
  console.warn("Seeded system principal:", systemPrincipal.id);

  // ── 2. Dev user principal ──
  const devPrincipal = await prisma.principal.upsert({
    where: { id: "principal_dev" },
    update: {},
    create: {
      id: "principal_dev",
      type: "user",
      name: "Dev User",
      organizationId: "org_dev",
      roles: ["admin", "approver", "operator"],
    },
  });
  console.warn("Seeded dev principal:", devPrincipal.id);

  // ── 3. Organization config ──
  await prisma.organizationConfig.upsert({
    where: { id: "org_dev" },
    update: {},
    create: {
      id: "org_dev",
      name: "Dev Organization",
      runtimeType: "http",
      governanceProfile: "guarded",
      onboardingComplete: true,
      provisioningStatus: "active",
    },
  });
  console.warn("Seeded organization config: org_dev");

  // Slice A PR 2: seed day-one agent enablement for the dev org. Idempotent.
  await seedOrgDayOneAgents(prisma, "org_dev");
  console.warn("Seeded day-one agent enablement for org_dev");

  // PR6: enable Mira for the local dev pilot org (opt-in only — no global flip).
  // Mira is launchTier "day-thirty" and is NOT in seedOrgDayOneAgents.
  await seedMiraPilotOrgs(prisma, ["org_dev"]);
  console.warn("Seeded Mira pilot enablement for org_dev");

  // ── 4. Default identity spec ──
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
  console.warn("Seeded default identity spec:", defaultSpec.id);

  // ── 5. Dev user identity spec ──
  await prisma.identitySpec.upsert({
    where: { id: "spec_dev" },
    update: {},
    create: {
      id: "spec_dev",
      principalId: devPrincipal.id,
      organizationId: "org_dev",
      name: "Dev User Identity",
      description: "Identity spec for local development user",
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
        monthly: 80000,
        perAction: 2000,
      },
      cartridgeSpendLimits: {},
      forbiddenBehaviors: [],
      trustBehaviors: [],
    },
  });
  console.warn("Seeded dev identity spec: spec_dev");

  // ── 6. Dashboard user ──
  // Refresh apiKeyEncrypted on update so re-seeding self-heals rows that were
  // encrypted under a different CREDENTIALS_ENCRYPTION_KEY.
  const devApiKey = "sb_dev_key_0123456789abcdef";
  await prisma.dashboardUser.upsert({
    where: { id: "dev-user" },
    update: {
      apiKeyEncrypted: encryptApiKey(devApiKey),
      apiKeyHash: sha256(devApiKey),
    },
    create: {
      id: "dev-user",
      email: "dev@switchboard.local",
      name: "Dev User",
      organizationId: "org_dev",
      principalId: "principal_dev",
      apiKeyEncrypted: encryptApiKey(devApiKey),
      apiKeyHash: sha256(devApiKey),
    },
  });
  console.warn("Seeded dashboard user: dev-user");

  // ── 6b. Admin dashboard user (with password) ──
  const adminApiKey = "sb_admin_key_0123456789abcdef";
  const adminPasswordHash = await bcrypt.hash("admin123", 12);
  await prisma.dashboardUser.upsert({
    where: { id: "admin-user" },
    update: {
      passwordHash: adminPasswordHash,
      apiKeyEncrypted: encryptApiKey(adminApiKey),
      apiKeyHash: sha256(adminApiKey),
    },
    create: {
      id: "admin-user",
      email: "admin@switchboard.local",
      name: "Admin User",
      organizationId: "org_dev",
      principalId: "principal_dev",
      apiKeyEncrypted: encryptApiKey(adminApiKey),
      apiKeyHash: sha256(adminApiKey),
      passwordHash: adminPasswordHash,
    },
  });
  console.warn("Seeded admin user: admin@switchboard.local / admin123");

  // ── 7. System risk posture ──
  await prisma.systemRiskPosture.upsert({
    where: { id: "singleton" },
    update: {},
    create: {
      id: "singleton",
      posture: "normal",
      updatedBy: "system",
    },
  });
  console.warn("Seeded system risk posture: normal");

  // ── 8. Sample policies ──
  const policies = [
    {
      id: "policy_spend_approval",
      name: "Require approval for high spend",
      description: "Actions with estimated spend above $1000 require manual approval",
      organizationId: "org_dev",
      priority: 10,
      active: true,
      rule: {
        conditions: [
          {
            field: "estimatedSpend",
            operator: "gt",
            value: 1000,
          },
        ],
      },
      effect: "require_approval",
      approvalRequirement: "standard",
    },
    {
      id: "policy_block_delete",
      name: "Block destructive actions",
      description: "Prevent deletion of campaigns or ad sets without elevated approval",
      organizationId: "org_dev",
      priority: 5,
      active: true,
      rule: {
        conditions: [
          {
            field: "actionType",
            operator: "in",
            value: ["campaign.delete", "adset.delete", "ad.delete"],
          },
        ],
      },
      effect: "require_approval",
      approvalRequirement: "elevated",
      riskCategoryOverride: "high",
    },
    {
      id: "policy_allow_read",
      name: "Allow read-only operations",
      description: "Read and list operations are always allowed without approval",
      organizationId: "org_dev",
      priority: 100,
      active: true,
      rule: {
        conditions: [
          {
            field: "actionType",
            operator: "matches",
            value: "*.read|*.list|*.get",
          },
        ],
      },
      effect: "allow",
    },
  ];

  for (const policy of policies) {
    await prisma.policy.upsert({
      where: { id: policy.id },
      update: {},
      create: policy,
    });
  }
  console.warn("Seeded", policies.length, "policies");

  // ── 9. Cartridge registrations ──
  const cartridges = [
    {
      id: "cart_digital_ads",
      cartridgeId: "digital-ads",
      name: "Digital Ads",
      version: "1.0.0",
      manifest: {
        actions: [
          "campaign.create",
          "campaign.update",
          "campaign.pause",
          "campaign.delete",
          "adset.create",
          "adset.update",
          "ad.create",
        ],
        providers: ["meta-ads", "google-ads", "tiktok-ads"],
      },
    },
    {
      id: "cart_payments",
      cartridgeId: "payments",
      name: "Payments",
      version: "1.0.0",
      manifest: {
        actions: ["payment.create", "payment.refund", "subscription.create", "subscription.cancel"],
        providers: ["stripe"],
      },
    },
    {
      id: "cart_crm",
      cartridgeId: "crm",
      name: "CRM",
      version: "1.0.0",
      manifest: {
        actions: ["contact.create", "contact.update", "deal.create", "deal.update", "deal.advance"],
        providers: ["internal"],
      },
    },
  ];

  for (const cart of cartridges) {
    await prisma.cartridgeRegistration.upsert({
      where: { cartridgeId: cart.cartridgeId },
      update: {},
      create: cart,
    });
  }
  console.warn("Seeded", cartridges.length, "cartridge registrations");

  // ── 10. Sample audit entries with valid hash chain ──
  const now = new Date();
  const auditEntries = [
    {
      eventType: "action.proposed",
      actorType: "agent",
      actorId: "principal_dev",
      entityType: "campaign",
      entityId: "camp_001",
      riskCategory: "medium",
      summary: "Proposed: Create Meta Ads campaign 'Spring Sale 2025'",
      snapshot: {
        actionType: "campaign.create",
        cartridgeId: "digital-ads",
        parameters: { name: "Spring Sale 2025", budget: 500 },
      },
      evidencePointers: [],
      daysAgo: 6,
    },
    {
      eventType: "action.executed",
      actorType: "system",
      actorId: "system",
      entityType: "campaign",
      entityId: "camp_001",
      riskCategory: "medium",
      summary: "Executed: Created Meta Ads campaign 'Spring Sale 2025' ($500 budget)",
      snapshot: {
        actionType: "campaign.create",
        result: "success",
        spend: 0,
      },
      evidencePointers: [],
      daysAgo: 6,
    },
    {
      eventType: "action.proposed",
      actorType: "agent",
      actorId: "principal_dev",
      entityType: "campaign",
      entityId: "camp_002",
      riskCategory: "high",
      summary: "Proposed: Increase budget on 'Brand Awareness' to $5000",
      snapshot: {
        actionType: "campaign.update",
        cartridgeId: "digital-ads",
        parameters: { budget: 5000 },
      },
      evidencePointers: [],
      daysAgo: 4,
    },
    {
      eventType: "action.denied",
      actorType: "system",
      actorId: "system",
      entityType: "campaign",
      entityId: "camp_002",
      riskCategory: "high",
      summary: "Denied: Budget increase to $5000 exceeds per-action spend limit",
      snapshot: {
        actionType: "campaign.update",
        reason: "spend_limit_exceeded",
        limit: 2000,
        requested: 5000,
      },
      evidencePointers: [],
      daysAgo: 4,
    },
    {
      eventType: "action.proposed",
      actorType: "agent",
      actorId: "principal_dev",
      entityType: "payment",
      entityId: "pay_001",
      riskCategory: "low",
      summary: "Proposed: Process refund of $45.00 for order #1234",
      snapshot: {
        actionType: "payment.refund",
        cartridgeId: "payments",
        parameters: { amount: 45.0, orderId: "1234" },
      },
      evidencePointers: [],
      daysAgo: 3,
    },
    {
      eventType: "action.executed",
      actorType: "system",
      actorId: "system",
      entityType: "payment",
      entityId: "pay_001",
      riskCategory: "low",
      summary: "Executed: Refund of $45.00 processed for order #1234",
      snapshot: {
        actionType: "payment.refund",
        result: "success",
        spend: 45.0,
      },
      evidencePointers: [],
      daysAgo: 3,
    },
    {
      eventType: "action.proposed",
      actorType: "agent",
      actorId: "principal_dev",
      entityType: "contact",
      entityId: "crm_001",
      riskCategory: "none",
      summary: "Proposed: Create CRM contact 'Jane Smith'",
      snapshot: {
        actionType: "contact.create",
        cartridgeId: "crm",
        parameters: {
          firstName: "Jane",
          lastName: "Smith",
          email: "jane@example.com",
        },
      },
      evidencePointers: [],
      daysAgo: 1,
    },
    {
      eventType: "action.executed",
      actorType: "system",
      actorId: "system",
      entityType: "contact",
      entityId: "crm_001",
      riskCategory: "none",
      summary: "Executed: Created CRM contact 'Jane Smith'",
      snapshot: {
        actionType: "contact.create",
        result: "success",
      },
      evidencePointers: [],
      daysAgo: 1,
    },
  ];

  let previousHash: string | null = null;
  for (let i = 0; i < auditEntries.length; i++) {
    const entry = auditEntries[i]!;
    const timestamp = new Date(now.getTime() - entry.daysAgo * 24 * 60 * 60 * 1000 + i * 1000);
    const entryId = `audit_seed_${String(i + 1).padStart(3, "0")}`;

    const hashInput = JSON.stringify({
      id: entryId,
      eventType: entry.eventType,
      timestamp: timestamp.toISOString(),
      actorId: entry.actorId,
      entityId: entry.entityId,
      previousEntryHash: previousHash,
    });
    const entryHash = sha256(hashInput);

    await prisma.auditEntry.upsert({
      where: { id: entryId },
      update: {},
      create: {
        id: entryId,
        eventType: entry.eventType,
        timestamp,
        actorType: entry.actorType,
        actorId: entry.actorId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        riskCategory: entry.riskCategory,
        summary: entry.summary,
        snapshot: entry.snapshot,
        evidencePointers: entry.evidencePointers,
        entryHash,
        previousEntryHash: previousHash,
        organizationId: "org_dev",
      },
    });

    previousHash = entryHash;
  }
  console.warn("Seeded", auditEntries.length, "audit entries with hash chain");

  // (CRM Contacts, Deals, Activities removed — models deleted)
  // (SMB Activity Log Entries removed — model deleted)

  // ── Agent Roster ──
  const agentDefaults = [
    {
      agentRole: "primary_operator",
      displayName: "Ava",
      description:
        "Your AI growth operator — coordinates all tasks and communicates with your team.",
      status: "active",
      tier: "starter",
      config: { tone: "friendly", workingStyle: "Friendly & Warm" },
    },
    {
      agentRole: "monitor",
      displayName: "Monitor",
      description: "Watches your ad performance, alerts you to anomalies and pacing issues.",
      status: "active",
      tier: "starter",
      config: {},
    },
    {
      agentRole: "responder",
      displayName: "Responder",
      description: "Handles inbound leads, qualifies prospects, and manages conversations.",
      status: "active",
      tier: "starter",
      config: {},
    },
    {
      agentRole: "strategist",
      displayName: "Strategist",
      description: "Plans campaigns, allocates budgets, and develops growth strategies.",
      status: "locked",
      tier: "pro",
      config: {},
    },
    {
      agentRole: "optimizer",
      displayName: "Optimizer",
      description: "Fine-tunes bids, targeting, and creative rotation for better performance.",
      status: "locked",
      tier: "pro",
      config: {},
    },
    {
      agentRole: "booker",
      displayName: "Booker",
      description: "Manages appointments, scheduling, and calendar coordination.",
      status: "locked",
      tier: "business",
      config: {},
    },
    {
      agentRole: "guardian",
      displayName: "Guardian",
      description: "Enforces governance rules, spending limits, and compliance policies.",
      status: "locked",
      tier: "business",
      config: {},
    },
  ];

  for (const entry of agentDefaults) {
    const agent = await prisma.agentRoster.upsert({
      where: {
        organizationId_agentRole: { organizationId: "org_dev", agentRole: entry.agentRole },
      },
      update: {},
      create: {
        organizationId: "org_dev",
        ...entry,
        config: entry.config as object,
      },
    });
    await prisma.agentState.upsert({
      where: { agentRosterId: agent.id },
      update: {},
      create: {
        agentRosterId: agent.id,
        organizationId: "org_dev",
        activityStatus: "idle",
        metrics: { actionsToday: 0 } as object,
      },
    });
  }
  console.warn("Seeded agent roster (7 agents) for org_dev");

  // ── Marketplace Listings ──
  console.warn("\n--- Marketplace Listings ---");
  await seedMarketplace(prisma);

  // ── Mira creative deployment (Alex→Mira handoff live prereq) ──
  // Mira is enabled for org_dev (seedMiraPilotOrgs above) and /mira renders
  // org_dev. The draft-only handoff also needs an ACTIVE skillSlug="creative"
  // deployment in the SAME org, or the child resolver fails closed. Must run
  // after seedMarketplace (depends on the performance-creative-director listing).
  await seedMiraCreativeDeployment(prisma, "org_dev");
  console.warn("Seeded Mira creative deployment for org_dev");

  // ── Riley ad-optimizer deployment (Contract 3 cron prerequisite) ──
  // org_dev already has the handoff governance + creative deployment + Mira
  // enablement (above); this is the missing fifth piece (an ACTIVE ad-optimizer
  // deployment) so the governed Riley -> Mira handoff can fire end-to-end on
  // org_dev (the org /mira renders under dev-auth). org_demo keeps its own Riley
  // deployment (seedDemoData) untouched. Must run after seedMarketplace.
  // Wrapped in a transaction so the deployment + the both-or-neither pause
  // policies (seedRileyPausePolicies) land atomically: a mid-seed crash can never
  // leave the allow policy alone (which self-executes). Mirrors the production
  // provisionOrgAgentDeployments path, which also runs this inside $transaction.
  await prisma.$transaction(async (tx) => {
    await seedRileyAdOptimizerDeployment(tx, "org_dev");
    // Robin v1 recovery gate for the dev org, mirroring the prod provision path so org_dev can
    // exercise the governed campaign locally.
    await seedRobinRecoveryPolicies(tx, "org_dev");
  });
  console.warn("Seeded Riley ad-optimizer deployment for org_dev");

  // ── Marketplace Demo Data ──
  console.warn("\n--- Marketplace Demo Data ---");
  await seedDemoData(prisma);

  // ── Knowledge Entries ──
  console.warn("\n--- Knowledge Entries ---");
  await seedKnowledge(prisma);

  // ── Alex Skill Pack ──
  console.warn("\n--- Alex Skill Pack ---");
  await seedAlexSkillPack(prisma, "org_demo");

  // ── Dev-only domain data ──
  // Skipped in production. Idempotent — keyed on `dev_*` IDs.
  await seedDevData(prisma);

  // ── Mira demo creative drafts (dev-only) ──
  // Requires a deployment to exist for org_dev (created by seedDemoData above)
  // and Mira enablement (created by seedMiraPilotOrgs above). Idempotent.
  await seedMiraDemoCreatives(prisma, "org_dev");
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
