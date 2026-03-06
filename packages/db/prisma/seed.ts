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

  // ── 11. CRM Contacts (demo data) ──
  const contacts = [
    {
      id: "crm_contact_001",
      firstName: "Sarah",
      lastName: "Johnson",
      email: "sarah.johnson@example.com",
      phone: "+15551001001",
      channel: "telegram",
      status: "active",
      organizationId: "org_dev",
      sourceAdId: "ad_whitening_spring",
      utmSource: "meta_ads",
      tags: ["whitening", "cosmetic"],
      properties: { notes: "Interested in teeth whitening package" },
    },
    {
      id: "crm_contact_002",
      firstName: "Michael",
      lastName: "Chen",
      email: "michael.chen@example.com",
      phone: "+15551001002",
      channel: "web_chat",
      status: "active",
      organizationId: "org_dev",
      tags: ["checkup", "new-patient"],
      properties: { notes: "Referred by existing patient" },
    },
    {
      id: "crm_contact_003",
      firstName: "Emily",
      lastName: "Rodriguez",
      email: "emily.rodriguez@example.com",
      phone: "+15551001003",
      channel: "telegram",
      status: "active",
      organizationId: "org_dev",
      sourceAdId: "ad_implants_q1",
      utmSource: "google_ads",
      tags: ["implants", "restorative"],
      properties: { notes: "Needs implant consultation" },
    },
    {
      id: "crm_contact_004",
      firstName: "James",
      lastName: "Williams",
      email: "james.williams@example.com",
      phone: "+15551001004",
      channel: "sms",
      status: "active",
      organizationId: "org_dev",
      tags: ["orthodontics"],
      assignedStaffId: "dr-patel",
      properties: { notes: "Invisalign inquiry" },
    },
    {
      id: "crm_contact_005",
      firstName: "Lisa",
      lastName: "Park",
      email: "lisa.park@example.com",
      phone: "+15551001005",
      channel: "telegram",
      status: "active",
      organizationId: "org_dev",
      sourceAdId: "ad_cleaning_promo",
      utmSource: "meta_ads",
      tags: ["cleaning", "preventive"],
      properties: { notes: "Booked cleaning, upsold to whitening" },
    },
    {
      id: "crm_contact_006",
      firstName: "David",
      lastName: "Kim",
      email: "david.kim@example.com",
      phone: "+15551001006",
      channel: "web_chat",
      status: "active",
      organizationId: "org_dev",
      tags: ["emergency"],
      assignedStaffId: "dr-chen",
      properties: { notes: "Emergency visit — chipped tooth" },
    },
    {
      id: "crm_contact_007",
      firstName: "Maria",
      lastName: "Gonzalez",
      email: "maria.gonzalez@example.com",
      phone: "+15551001007",
      channel: "whatsapp",
      status: "active",
      organizationId: "org_dev",
      tags: ["crowns", "restorative"],
      properties: { notes: "Crown replacement — 2 units" },
    },
    {
      id: "crm_contact_008",
      firstName: "Robert",
      lastName: "Taylor",
      email: "robert.taylor@example.com",
      phone: "+15551001008",
      channel: "telegram",
      status: "active",
      organizationId: "org_dev",
      sourceAdId: "ad_whitening_spring",
      utmSource: "meta_ads",
      tags: ["whitening"],
      properties: { notes: "Clicked ad, started chat, went silent" },
    },
    {
      id: "crm_contact_009",
      firstName: "Jennifer",
      lastName: "Martinez",
      email: "jennifer.martinez@example.com",
      phone: "+15551001009",
      channel: "sms",
      status: "active",
      organizationId: "org_dev",
      tags: ["checkup", "cleaning"],
      assignedStaffId: "hygienist-jones",
      properties: { notes: "Repeat patient — regular cleanings" },
    },
    {
      id: "crm_contact_010",
      firstName: "Andrew",
      lastName: "Lee",
      email: "andrew.lee@example.com",
      phone: "+15551001010",
      channel: "telegram",
      status: "active",
      organizationId: "org_dev",
      tags: ["implants", "cosmetic"],
      properties: { notes: "Multiple implant consultation" },
    },
    {
      id: "crm_contact_011",
      firstName: "Rachel",
      lastName: "Brown",
      email: "rachel.brown@example.com",
      phone: "+15551001011",
      channel: "web_chat",
      status: "archived",
      organizationId: "org_dev",
      tags: ["lost"],
      properties: { notes: "Went to competitor — price sensitivity" },
    },
    {
      id: "crm_contact_012",
      firstName: "Kevin",
      lastName: "Nguyen",
      email: "kevin.nguyen@example.com",
      phone: "+15551001012",
      channel: "telegram",
      status: "active",
      organizationId: "org_dev",
      sourceAdId: "ad_cleaning_promo",
      utmSource: "instagram",
      tags: ["cleaning"],
      properties: { notes: "Instagram ad click — first visit" },
    },
    {
      id: "crm_contact_013",
      firstName: "Amanda",
      lastName: "White",
      email: "amanda.white@example.com",
      phone: "+15551001013",
      channel: "whatsapp",
      status: "active",
      organizationId: "org_dev",
      tags: ["orthodontics", "cosmetic"],
      assignedStaffId: "dr-patel",
      properties: { notes: "Braces consultation completed, payment plan pending" },
    },
    {
      id: "crm_contact_014",
      firstName: "Thomas",
      lastName: "Jackson",
      email: "thomas.jackson@example.com",
      phone: "+15551001014",
      channel: "sms",
      status: "active",
      organizationId: "org_dev",
      tags: ["checkup"],
      properties: { notes: "New patient from referral program" },
    },
    {
      id: "crm_contact_015",
      firstName: "Sophia",
      lastName: "Davis",
      email: "sophia.davis@example.com",
      phone: "+15551001015",
      channel: "telegram",
      status: "active",
      organizationId: "org_dev",
      sourceAdId: "ad_implants_q1",
      utmSource: "meta_ads",
      tags: ["implants"],
      properties: { notes: "Price objection — sent financing info" },
    },
    {
      id: "crm_contact_016",
      firstName: "Daniel",
      lastName: "Wilson",
      email: "daniel.wilson@example.com",
      phone: "+15551001016",
      channel: "web_chat",
      status: "archived",
      organizationId: "org_dev",
      tags: ["lost"],
      properties: { notes: "No-show twice, stopped responding" },
    },
    {
      id: "crm_contact_017",
      firstName: "Olivia",
      lastName: "Moore",
      email: "olivia.moore@example.com",
      phone: "+15551001017",
      channel: "telegram",
      status: "active",
      organizationId: "org_dev",
      tags: ["whitening", "cleaning"],
      properties: { notes: "Repeat patient — loyal customer" },
    },
    {
      id: "crm_contact_018",
      firstName: "Chris",
      lastName: "Anderson",
      email: "chris.anderson@example.com",
      phone: "+15551001018",
      channel: "whatsapp",
      status: "active",
      organizationId: "org_dev",
      sourceAdId: "ad_whitening_spring",
      utmSource: "meta_ads",
      tags: ["whitening"],
      properties: { notes: "Scheduled whitening — new patient from ad" },
    },
  ];

  for (const contact of contacts) {
    await prisma.crmContact.upsert({
      where: { id: contact.id },
      update: {},
      create: contact,
    });
  }
  console.log("Seeded", contacts.length, "CRM contacts");

  // ── 12. CRM Deals (demo data) ──
  const deals = [
    {
      id: "crm_deal_001",
      name: "Sarah Johnson — Teeth Whitening",
      stage: "consultation_booked",
      pipeline: "default",
      amount: 350,
      contactId: "crm_contact_001",
      organizationId: "org_dev",
      assignedStaffId: "dr-chen",
    },
    {
      id: "crm_deal_002",
      name: "Michael Chen — General Checkup",
      stage: "qualified",
      pipeline: "default",
      amount: 100,
      contactId: "crm_contact_002",
      organizationId: "org_dev",
    },
    {
      id: "crm_deal_003",
      name: "Emily Rodriguez — Dental Implants",
      stage: "service_proposed",
      pipeline: "default",
      amount: 3500,
      contactId: "crm_contact_003",
      organizationId: "org_dev",
      assignedStaffId: "dr-chen",
    },
    {
      id: "crm_deal_004",
      name: "James Williams — Invisalign",
      stage: "service_accepted",
      pipeline: "default",
      amount: 5000,
      contactId: "crm_contact_004",
      organizationId: "org_dev",
      assignedStaffId: "dr-patel",
    },
    {
      id: "crm_deal_005",
      name: "Lisa Park — Cleaning + Whitening",
      stage: "service_completed",
      pipeline: "default",
      amount: 500,
      contactId: "crm_contact_005",
      organizationId: "org_dev",
    },
    {
      id: "crm_deal_006",
      name: "David Kim — Emergency Visit",
      stage: "service_completed",
      pipeline: "default",
      amount: 250,
      contactId: "crm_contact_006",
      organizationId: "org_dev",
      assignedStaffId: "dr-chen",
    },
    {
      id: "crm_deal_007",
      name: "Maria Gonzalez — Crown Replacement",
      stage: "service_scheduled",
      pipeline: "default",
      amount: 2400,
      contactId: "crm_contact_007",
      organizationId: "org_dev",
    },
    {
      id: "crm_deal_008",
      name: "Amanda White — Orthodontics",
      stage: "service_proposed",
      pipeline: "default",
      amount: 4800,
      contactId: "crm_contact_013",
      organizationId: "org_dev",
      assignedStaffId: "dr-patel",
    },
    {
      id: "crm_deal_009",
      name: "Sophia Davis — Implant Consultation",
      stage: "qualified",
      pipeline: "default",
      amount: 3500,
      contactId: "crm_contact_015",
      organizationId: "org_dev",
    },
    {
      id: "crm_deal_010",
      name: "Rachel Brown — Cleaning",
      stage: "closed_lost",
      pipeline: "default",
      amount: 150,
      contactId: "crm_contact_011",
      organizationId: "org_dev",
    },
    {
      id: "crm_deal_011",
      name: "Chris Anderson — Whitening Package",
      stage: "consultation_booked",
      pipeline: "default",
      amount: 350,
      contactId: "crm_contact_018",
      organizationId: "org_dev",
    },
  ];

  for (const deal of deals) {
    await prisma.crmDeal.upsert({
      where: { id: deal.id },
      update: {},
      create: deal,
    });
  }
  console.log("Seeded", deals.length, "CRM deals");

  // ── 13. CRM Activities (demo data) ──
  const DAY = 24 * 60 * 60 * 1000;
  const activities = [
    {
      id: "crm_act_001",
      type: "message",
      subject: "Inbound: Whitening inquiry",
      body: "Hi, I saw your ad about teeth whitening. How much does it cost?",
      contactId: "crm_contact_001",
      dealId: "crm_deal_001",
      organizationId: "org_dev",
      daysAgo: 28,
    },
    {
      id: "crm_act_002",
      type: "message",
      subject: "AI reply: Whitening details",
      body: "Thanks for reaching out! Our professional teeth whitening starts at $350 and includes a consultation. Would you like to book an appointment?",
      contactId: "crm_contact_001",
      dealId: "crm_deal_001",
      organizationId: "org_dev",
      daysAgo: 28,
    },
    {
      id: "crm_act_003",
      type: "note",
      subject: "Lead qualified",
      body: "Qualified via automated scoring — high intent, ad-sourced lead",
      contactId: "crm_contact_001",
      dealId: "crm_deal_001",
      organizationId: "org_dev",
      daysAgo: 27,
    },
    {
      id: "crm_act_004",
      type: "call",
      subject: "Consultation call",
      body: "Discussed whitening options. Patient prefers in-office treatment. Booked for next week.",
      contactId: "crm_contact_001",
      dealId: "crm_deal_001",
      organizationId: "org_dev",
      daysAgo: 25,
    },
    {
      id: "crm_act_005",
      type: "message",
      subject: "Inbound: Checkup request",
      body: "I'd like to schedule a general checkup. Do you accept Blue Cross insurance?",
      contactId: "crm_contact_002",
      organizationId: "org_dev",
      daysAgo: 20,
    },
    {
      id: "crm_act_006",
      type: "message",
      subject: "AI reply: Insurance info",
      body: "Yes, we accept Blue Cross! We can verify your coverage before your visit. Would you like to book a checkup?",
      contactId: "crm_contact_002",
      organizationId: "org_dev",
      daysAgo: 20,
    },
    {
      id: "crm_act_007",
      type: "note",
      subject: "Deal created",
      body: "Created deal for general checkup. Referral source: existing patient.",
      contactId: "crm_contact_002",
      dealId: "crm_deal_002",
      organizationId: "org_dev",
      daysAgo: 19,
    },
    {
      id: "crm_act_008",
      type: "message",
      subject: "Inbound: Implant inquiry",
      body: "I need dental implants. What's the process and cost?",
      contactId: "crm_contact_003",
      dealId: "crm_deal_003",
      organizationId: "org_dev",
      daysAgo: 22,
    },
    {
      id: "crm_act_009",
      type: "message",
      subject: "AI reply: Implant details",
      body: "Dental implants at Bright Smile start at $3,500. The process includes consultation, CT scan, placement, and crown. We offer financing options.",
      contactId: "crm_contact_003",
      dealId: "crm_deal_003",
      organizationId: "org_dev",
      daysAgo: 22,
    },
    {
      id: "crm_act_010",
      type: "note",
      subject: "Treatment plan sent",
      body: "Sent detailed treatment plan with financing breakdown. Awaiting patient response.",
      contactId: "crm_contact_003",
      dealId: "crm_deal_003",
      organizationId: "org_dev",
      daysAgo: 18,
    },
    {
      id: "crm_act_011",
      type: "meeting",
      subject: "Invisalign consultation",
      body: "In-person consultation with Dr. Patel. Patient agreed to Invisalign treatment plan.",
      contactId: "crm_contact_004",
      dealId: "crm_deal_004",
      organizationId: "org_dev",
      daysAgo: 15,
    },
    {
      id: "crm_act_012",
      type: "note",
      subject: "Payment plan approved",
      body: "CareCredit financing approved — $5,000 over 18 months.",
      contactId: "crm_contact_004",
      dealId: "crm_deal_004",
      organizationId: "org_dev",
      daysAgo: 14,
    },
    {
      id: "crm_act_013",
      type: "message",
      subject: "Appointment reminder",
      body: "Hi Lisa, just a reminder about your cleaning appointment tomorrow at 10 AM. See you then!",
      contactId: "crm_contact_005",
      dealId: "crm_deal_005",
      organizationId: "org_dev",
      daysAgo: 11,
    },
    {
      id: "crm_act_014",
      type: "note",
      subject: "Service completed",
      body: "Cleaning completed. Upsold whitening add-on ($150). Total deal: $500.",
      contactId: "crm_contact_005",
      dealId: "crm_deal_005",
      organizationId: "org_dev",
      daysAgo: 10,
    },
    {
      id: "crm_act_015",
      type: "message",
      subject: "Review request",
      body: "Thank you for visiting Bright Smile! Would you mind leaving us a Google review?",
      contactId: "crm_contact_005",
      dealId: "crm_deal_005",
      organizationId: "org_dev",
      daysAgo: 9,
    },
    {
      id: "crm_act_016",
      type: "call",
      subject: "Emergency intake",
      body: "Patient called with chipped tooth. Scheduled emergency visit same day.",
      contactId: "crm_contact_006",
      dealId: "crm_deal_006",
      organizationId: "org_dev",
      daysAgo: 7,
    },
    {
      id: "crm_act_017",
      type: "note",
      subject: "Emergency resolved",
      body: "Temporary crown placed. Follow-up in 2 weeks for permanent crown.",
      contactId: "crm_contact_006",
      dealId: "crm_deal_006",
      organizationId: "org_dev",
      daysAgo: 7,
    },
    {
      id: "crm_act_018",
      type: "message",
      subject: "Inbound: Crown inquiry",
      body: "I need two crowns replaced. How soon can I get an appointment?",
      contactId: "crm_contact_007",
      dealId: "crm_deal_007",
      organizationId: "org_dev",
      daysAgo: 12,
    },
    {
      id: "crm_act_019",
      type: "note",
      subject: "Appointment scheduled",
      body: "Crown replacement scheduled for next Thursday. Two units at $1,200 each.",
      contactId: "crm_contact_007",
      dealId: "crm_deal_007",
      organizationId: "org_dev",
      daysAgo: 11,
    },
    {
      id: "crm_act_020",
      type: "message",
      subject: "Objection: Too expensive",
      body: "That's more than I expected. Is there a cheaper option?",
      contactId: "crm_contact_015",
      dealId: "crm_deal_009",
      organizationId: "org_dev",
      daysAgo: 16,
    },
    {
      id: "crm_act_021",
      type: "message",
      subject: "AI: Financing response",
      body: "We understand cost is important. We offer CareCredit financing with 0% APR for 12 months, making it about $292/month. Would you like to learn more?",
      contactId: "crm_contact_015",
      dealId: "crm_deal_009",
      organizationId: "org_dev",
      daysAgo: 16,
    },
    {
      id: "crm_act_022",
      type: "message",
      subject: "Follow-up cadence: Day 3",
      body: "Hi Sophia, just checking in — have you had a chance to think about the implant treatment plan? Happy to answer any questions.",
      contactId: "crm_contact_015",
      dealId: "crm_deal_009",
      organizationId: "org_dev",
      daysAgo: 13,
    },
    {
      id: "crm_act_023",
      type: "message",
      subject: "Inbound: Schedule request",
      body: "Yes, I'd like to move forward. Can you book me in?",
      contactId: "crm_contact_015",
      dealId: "crm_deal_009",
      organizationId: "org_dev",
      daysAgo: 10,
    },
    {
      id: "crm_act_024",
      type: "note",
      subject: "Lead lost",
      body: "Patient chose competitor clinic. Reason: lower quoted price.",
      contactId: "crm_contact_011",
      dealId: "crm_deal_010",
      organizationId: "org_dev",
      daysAgo: 24,
    },
    {
      id: "crm_act_025",
      type: "message",
      subject: "Inbound: Braces inquiry",
      body: "I'm interested in braces for my teenager. What options do you have?",
      contactId: "crm_contact_013",
      dealId: "crm_deal_008",
      organizationId: "org_dev",
      daysAgo: 8,
    },
    {
      id: "crm_act_026",
      type: "meeting",
      subject: "Orthodontics consultation",
      body: "Dr. Patel consultation — traditional braces vs. Invisalign discussed. Treatment plan prepared.",
      contactId: "crm_contact_013",
      dealId: "crm_deal_008",
      organizationId: "org_dev",
      daysAgo: 5,
    },
    {
      id: "crm_act_027",
      type: "message",
      subject: "AI: Appointment confirmation",
      body: "Hi Chris, your teeth whitening appointment is confirmed for March 10 at 2 PM with Dr. Chen. See you then!",
      contactId: "crm_contact_018",
      dealId: "crm_deal_011",
      organizationId: "org_dev",
      daysAgo: 3,
    },
    {
      id: "crm_act_028",
      type: "note",
      subject: "6-month recall",
      body: "Triggered 6-month recall cadence for regular cleaning.",
      contactId: "crm_contact_009",
      organizationId: "org_dev",
      daysAgo: 2,
    },
    {
      id: "crm_act_029",
      type: "message",
      subject: "Recall reminder",
      body: "Hi Jennifer, it's been 6 months since your last cleaning. Time to schedule your next one! Reply BOOK to find a time.",
      contactId: "crm_contact_009",
      organizationId: "org_dev",
      daysAgo: 2,
    },
    {
      id: "crm_act_030",
      type: "message",
      subject: "Inbound: Cleaning booking",
      body: "BOOK — Thursday afternoon works for me.",
      contactId: "crm_contact_009",
      organizationId: "org_dev",
      daysAgo: 1,
    },
    {
      id: "crm_act_031",
      type: "note",
      subject: "Repeat patient booked",
      body: "Cleaning booked for Thursday 2 PM. Repeat visit #4.",
      contactId: "crm_contact_009",
      organizationId: "org_dev",
      daysAgo: 1,
    },
    {
      id: "crm_act_032",
      type: "message",
      subject: "Inbound: New inquiry",
      body: "Do you do same-day cleanings? I just moved to the area.",
      contactId: "crm_contact_014",
      organizationId: "org_dev",
      daysAgo: 4,
    },
    {
      id: "crm_act_033",
      type: "message",
      subject: "AI: Welcome + booking",
      body: "Welcome to the neighborhood! We do have same-day availability for cleanings. Would you like to book one for today?",
      contactId: "crm_contact_014",
      organizationId: "org_dev",
      daysAgo: 4,
    },
    {
      id: "crm_act_034",
      type: "task",
      subject: "Follow-up: Robert Taylor",
      body: "No response in 5 days. Auto-escalated to human follow-up.",
      contactId: "crm_contact_008",
      organizationId: "org_dev",
      daysAgo: 6,
    },
    {
      id: "crm_act_035",
      type: "message",
      subject: "Win-back attempt",
      body: "Hi Robert, we noticed you were interested in teeth whitening. We're running a special this month — $299 instead of $350. Would you like to book?",
      contactId: "crm_contact_008",
      organizationId: "org_dev",
      daysAgo: 5,
    },
  ];

  for (const act of activities) {
    const { daysAgo, ...data } = act;
    await prisma.crmActivity.upsert({
      where: { id: data.id },
      update: {},
      create: {
        ...data,
        createdAt: new Date(now.getTime() - daysAgo * DAY),
      },
    });
  }
  console.log("Seeded", activities.length, "CRM activities");

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

  // ── 15. Alert Rules (demo data) ──
  const alertRules = [
    {
      id: "alert_rule_001",
      organizationId: "org_dev",
      name: "High monthly spend",
      enabled: true,
      metricPath: "spend.current",
      operator: "gt",
      threshold: 2000,
      vertical: "services",
      notifyChannels: ["telegram"],
      notifyRecipients: ["principal_dev"],
      cooldownMinutes: 1440,
    },
    {
      id: "alert_rule_002",
      organizationId: "org_dev",
      name: "New lead volume drop",
      enabled: true,
      metricPath: "findings.critical.count",
      operator: "lt",
      threshold: 2,
      vertical: "services",
      notifyChannels: ["telegram"],
      notifyRecipients: ["principal_dev"],
      cooldownMinutes: 720,
    },
    {
      id: "alert_rule_003",
      organizationId: "org_dev",
      name: "Denied actions spike",
      enabled: true,
      metricPath: "primaryKPI.current",
      operator: "pctChange_gt",
      threshold: 50,
      vertical: "services",
      notifyChannels: ["telegram", "slack"],
      notifyRecipients: ["principal_dev"],
      cooldownMinutes: 360,
    },
  ];

  for (const rule of alertRules) {
    await prisma.alertRule.upsert({
      where: { id: rule.id },
      update: {},
      create: rule,
    });
  }
  console.log("Seeded", alertRules.length, "alert rules");

  // ── 16. Alert History (demo data) ──
  const alertHistoryEntries = [
    {
      id: "alert_hist_001",
      alertRuleId: "alert_rule_001",
      organizationId: "org_dev",
      metricValue: 2150,
      threshold: 2000,
      findingsSummary: "Monthly spend reached $2,150, exceeding $2,000 threshold",
      notificationsSent: [{ channel: "telegram", recipient: "principal_dev", success: true }],
      daysAgo: 20,
    },
    {
      id: "alert_hist_002",
      alertRuleId: "alert_rule_002",
      organizationId: "org_dev",
      metricValue: 1,
      threshold: 2,
      findingsSummary: "Only 1 new lead this week, below minimum threshold of 2",
      notificationsSent: [{ channel: "telegram", recipient: "principal_dev", success: true }],
      daysAgo: 14,
    },
    {
      id: "alert_hist_003",
      alertRuleId: "alert_rule_001",
      organizationId: "org_dev",
      metricValue: 2480,
      threshold: 2000,
      findingsSummary: "Monthly spend reached $2,480 — 24% over threshold",
      notificationsSent: [{ channel: "telegram", recipient: "principal_dev", success: true }],
      daysAgo: 10,
    },
    {
      id: "alert_hist_004",
      alertRuleId: "alert_rule_003",
      organizationId: "org_dev",
      metricValue: 75,
      threshold: 50,
      findingsSummary: "Denied actions up 75% week-over-week — review governance policies",
      notificationsSent: [
        { channel: "telegram", recipient: "principal_dev", success: true },
        { channel: "slack", recipient: "principal_dev", success: false },
      ],
      daysAgo: 8,
    },
    {
      id: "alert_hist_005",
      alertRuleId: "alert_rule_002",
      organizationId: "org_dev",
      metricValue: 0,
      threshold: 2,
      findingsSummary: "Zero new leads this week — check ad campaigns and chat bot status",
      notificationsSent: [{ channel: "telegram", recipient: "principal_dev", success: true }],
      daysAgo: 4,
    },
    {
      id: "alert_hist_006",
      alertRuleId: "alert_rule_001",
      organizationId: "org_dev",
      metricValue: 2890,
      threshold: 2000,
      findingsSummary: "Monthly spend at $2,890 — approaching governance limit of $3,000",
      notificationsSent: [{ channel: "telegram", recipient: "principal_dev", success: true }],
      daysAgo: 2,
    },
  ];

  for (const hist of alertHistoryEntries) {
    const { daysAgo, ...data } = hist;
    await prisma.alertHistory.upsert({
      where: { id: data.id },
      update: {},
      create: {
        ...data,
        triggeredAt: new Date(now.getTime() - daysAgo * DAY),
      },
    });
  }
  console.log("Seeded", alertHistoryEntries.length, "alert history entries");

  // ── 17. Scheduled Reports (demo data) ──
  const scheduledReports = [
    {
      id: "sched_report_001",
      organizationId: "org_dev",
      name: "Weekly Funnel Report",
      enabled: true,
      cronExpression: "0 9 * * 1",
      timezone: "America/New_York",
      reportType: "funnel",
      vertical: "services",
      deliveryChannels: ["telegram"],
      deliveryTargets: ["principal_dev"],
    },
    {
      id: "sched_report_002",
      organizationId: "org_dev",
      name: "Daily Activity Digest",
      enabled: true,
      cronExpression: "0 8 * * *",
      timezone: "America/New_York",
      reportType: "portfolio",
      vertical: "services",
      deliveryChannels: ["telegram"],
      deliveryTargets: ["principal_dev"],
    },
  ];

  for (const report of scheduledReports) {
    await prisma.scheduledReport.upsert({
      where: { id: report.id },
      update: {},
      create: report,
    });
  }
  console.log("Seeded", scheduledReports.length, "scheduled reports");
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
