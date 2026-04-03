/* eslint-disable max-lines, no-console */
import { PrismaClient } from "@prisma/client";
import { createCipheriv, createHash, randomBytes } from "crypto";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// ── Encryption for dev seed data ──
// WARNING: This key is for dev seeding only. Never use a static key in production.
const DEV_ENCRYPTION_KEY = Buffer.from(
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "hex",
);

function encryptApiKey(apiKey: string): string {
  // AES-256-GCM requires a unique IV per encryption — use random bytes
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", DEV_ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(apiKey, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

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
  console.log("Seeded system principal:", systemPrincipal.id);

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
  console.log("Seeded dev principal:", devPrincipal.id);

  // ── 3. Organization config ──
  await prisma.organizationConfig.upsert({
    where: { id: "org_dev" },
    update: {},
    create: {
      id: "org_dev",
      name: "Dev Organization",
      runtimeType: "http",
      governanceProfile: "guarded",
      tier: "smb",
      onboardingComplete: true,
      provisioningStatus: "active",
    },
  });
  console.log("Seeded organization config: org_dev");

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
  console.log("Seeded default identity spec:", defaultSpec.id);

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
  console.log("Seeded dev identity spec: spec_dev");

  // ── 6. Dashboard user ──
  const devApiKey = "sb_dev_key_0123456789abcdef";
  await prisma.dashboardUser.upsert({
    where: { id: "dev-user" },
    update: {},
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
  console.log("Seeded dashboard user: dev-user");

  // ── 6b. Admin dashboard user (with password) ──
  const adminApiKey = "sb_admin_key_0123456789abcdef";
  const adminPasswordHash = await bcrypt.hash("admin123", 12);
  await prisma.dashboardUser.upsert({
    where: { id: "admin-user" },
    update: { passwordHash: adminPasswordHash },
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
  console.log("Seeded admin user: admin@switchboard.local / admin123");

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
  console.log("Seeded system risk posture: normal");

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
  console.log("Seeded", policies.length, "policies");

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
  console.log("Seeded", cartridges.length, "cartridge registrations");

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
  console.log("Seeded", auditEntries.length, "audit entries with hash chain");

  const DAY = 24 * 60 * 60 * 1000;

  // (CRM Contacts, Deals, Activities removed — models deleted)

  // ── 14. SMB Activity Log Entries (demo data) ──
  const smbLogs = [
    {
      id: "log_001",
      actorId: "system",
      actorType: "agent",
      actionType: "contact.create",
      result: "executed",
      summary: "AI created contact Sarah Johnson from Telegram conversation",
      daysAgo: 28,
    },
    {
      id: "log_002",
      actorId: "system",
      actorType: "agent",
      actionType: "lead.qualify",
      result: "executed",
      summary: "AI qualified Sarah Johnson — high intent (ad-sourced, whitening inquiry)",
      daysAgo: 27,
    },
    {
      id: "log_003",
      actorId: "system",
      actorType: "agent",
      actionType: "appointment.book",
      result: "executed",
      summary: "AI booked whitening consultation for Sarah Johnson — Mar 15 at 10 AM",
      daysAgo: 25,
      amount: 350,
    },
    {
      id: "log_004",
      actorId: "system",
      actorType: "agent",
      actionType: "message.send",
      result: "executed",
      summary: "AI sent appointment confirmation to Sarah Johnson via Telegram",
      daysAgo: 25,
    },
    {
      id: "log_005",
      actorId: "system",
      actorType: "agent",
      actionType: "contact.create",
      result: "executed",
      summary: "AI created contact Emily Rodriguez from web chat",
      daysAgo: 22,
    },
    {
      id: "log_006",
      actorId: "system",
      actorType: "agent",
      actionType: "deal.create",
      result: "executed",
      summary: "AI created deal: Emily Rodriguez — Dental Implants ($3,500)",
      daysAgo: 22,
      amount: 3500,
    },
    {
      id: "log_007",
      actorId: "system",
      actorType: "agent",
      actionType: "objection.handle",
      result: "executed",
      summary: "AI handled price objection from Sophia Davis — sent financing options",
      daysAgo: 16,
    },
    {
      id: "log_008",
      actorId: "system",
      actorType: "agent",
      actionType: "cadence.start",
      result: "executed",
      summary: "AI started follow-up cadence for Sophia Davis (implant inquiry)",
      daysAgo: 15,
    },
    {
      id: "log_009",
      actorId: "system",
      actorType: "agent",
      actionType: "reminder.send",
      result: "executed",
      summary: "AI sent appointment reminder to Lisa Park — cleaning tomorrow",
      daysAgo: 11,
    },
    {
      id: "log_010",
      actorId: "system",
      actorType: "agent",
      actionType: "review.request",
      result: "executed",
      summary: "AI sent Google review request to Lisa Park after completed cleaning",
      daysAgo: 9,
    },
    {
      id: "log_011",
      actorId: "system",
      actorType: "agent",
      actionType: "appointment.book",
      result: "executed",
      summary: "AI booked emergency visit for David Kim — chipped tooth",
      daysAgo: 7,
      amount: 250,
    },
    {
      id: "log_012",
      actorId: "system",
      actorType: "agent",
      actionType: "escalate",
      result: "executed",
      summary: "AI escalated David Kim case to Dr. Chen — emergency triage",
      daysAgo: 7,
    },
    {
      id: "log_013",
      actorId: "system",
      actorType: "agent",
      actionType: "cadence.send",
      result: "executed",
      summary: "AI sent follow-up message to Sophia Davis (day 3 of cadence)",
      daysAgo: 13,
    },
    {
      id: "log_014",
      actorId: "principal_dev",
      actorType: "user",
      actionType: "deal.update",
      result: "executed",
      summary: "Manual: Advanced Amanda White deal to 'service_proposed' stage",
      daysAgo: 5,
    },
    {
      id: "log_015",
      actorId: "system",
      actorType: "agent",
      actionType: "message.send",
      result: "executed",
      summary: "AI sent whitening appointment confirmation to Chris Anderson",
      daysAgo: 3,
    },
    {
      id: "log_016",
      actorId: "system",
      actorType: "agent",
      actionType: "contact.create",
      result: "executed",
      summary: "AI created contact Thomas Jackson from SMS referral",
      daysAgo: 4,
    },
    {
      id: "log_017",
      actorId: "system",
      actorType: "agent",
      actionType: "cadence.start",
      result: "executed",
      summary: "AI started 6-month recall cadence for Jennifer Martinez",
      daysAgo: 2,
    },
    {
      id: "log_018",
      actorId: "system",
      actorType: "agent",
      actionType: "message.send",
      result: "executed",
      summary: "AI sent recall reminder to Jennifer Martinez — 6-month cleaning due",
      daysAgo: 2,
    },
    {
      id: "log_019",
      actorId: "system",
      actorType: "agent",
      actionType: "appointment.book",
      result: "executed",
      summary: "AI booked cleaning for Jennifer Martinez — Thursday 2 PM",
      daysAgo: 1,
      amount: 150,
    },
    {
      id: "log_020",
      actorId: "system",
      actorType: "agent",
      actionType: "message.send",
      result: "executed",
      summary: "AI sent win-back offer to Robert Taylor — $299 whitening special",
      daysAgo: 5,
    },
    {
      id: "log_021",
      actorId: "system",
      actorType: "agent",
      actionType: "escalate",
      result: "executed",
      summary: "AI escalated Robert Taylor to human follow-up (no response 5 days)",
      daysAgo: 6,
    },
    {
      id: "log_022",
      actorId: "system",
      actorType: "agent",
      actionType: "lead.score",
      result: "executed",
      summary: "AI scored Kevin Nguyen — medium intent (Instagram ad, first visit)",
      daysAgo: 8,
    },
    {
      id: "log_023",
      actorId: "system",
      actorType: "system",
      actionType: "payment.process",
      result: "executed",
      summary: "Processed payment: Lisa Park — $500 (cleaning + whitening)",
      daysAgo: 10,
      amount: 500,
    },
    {
      id: "log_024",
      actorId: "system",
      actorType: "system",
      actionType: "payment.process",
      result: "executed",
      summary: "Processed payment: David Kim — $250 (emergency visit)",
      daysAgo: 7,
      amount: 250,
    },
    {
      id: "log_025",
      actorId: "system",
      actorType: "agent",
      actionType: "message.send",
      result: "denied",
      summary: "Blocked: AI attempted to share competitor pricing (policy violation)",
      daysAgo: 12,
    },
  ];

  for (const log of smbLogs) {
    const { daysAgo, ...data } = log;
    await prisma.smbActivityLogEntry.upsert({
      where: { id: data.id },
      update: {},
      create: {
        ...data,
        organizationId: "org_dev",
        timestamp: new Date(now.getTime() - daysAgo * DAY),
        snapshot: {},
      },
    });
  }
  console.log("Seeded", smbLogs.length, "SMB activity log entries");

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
  console.log("Seeded agent roster (7 agents) for org_dev");
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
