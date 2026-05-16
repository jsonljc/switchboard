/**
 * Dev-only seed expansion: populates domain data so live-mode surfaces
 * render non-empty after `pnpm db:seed` on a fresh local clone.
 *
 * Called from seed.ts only when NODE_ENV !== "production". Idempotent —
 * uses upserts keyed on stable IDs (`dev_*`).
 *
 * Targets (per local-readiness spec §1.5):
 *   - ≥ 5 opportunities across all pipeline stages (seeded with Contact FKs)
 *   - ≥ 15 audit entries (seed.ts already creates 8; we add 7 more → 15 total)
 *   - ≥ 2 ApprovalRecord rows (status "pending")
 *   - ≥ 1 ScheduledTriggerRecord (backs /automations browse)
 */
/* eslint-disable no-console */
import type { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";

const ORG_ID = "org_dev";

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export async function seedDevData(prisma: PrismaClient): Promise<void> {
  if (process.env["NODE_ENV"] === "production") {
    console.warn("[seed-dev-data] NODE_ENV=production — skipping dev seed");
    return;
  }
  console.warn("[seed-dev-data] populating dev domain data for", ORG_ID);

  await seedContacts(prisma);
  await seedOpportunities(prisma);
  await seedExtraAuditEntries(prisma);
  await seedApprovals(prisma);
  await seedAutomations(prisma);

  console.warn("[seed-dev-data] done");
}

async function seedContacts(prisma: PrismaClient): Promise<void> {
  const sources = ["ctwa", "instant_form", "organic", "web"];
  const channels = ["whatsapp", "telegram", "slack"];

  const rows = Array.from({ length: 8 }).map((_, i) => ({
    id: `dev_contact_${String(i + 1).padStart(3, "0")}`,
    organizationId: ORG_ID,
    name: `Lead ${String.fromCharCode(65 + i)}`,
    phone: `+1555010${String(i).padStart(4, "0")}`,
    email: `lead-${i + 1}@example.com`,
    primaryChannel: channels[i % channels.length]!,
    firstTouchChannel: channels[i % channels.length]!,
    stage: i < 4 ? "new" : "qualified",
    source: sources[i % sources.length]!,
    sourceType: sources[i % sources.length]!,
    firstContactAt: new Date(Date.now() - (8 - i) * 24 * 60 * 60 * 1000),
    lastActivityAt: new Date(Date.now() - (8 - i) * 12 * 60 * 60 * 1000),
  }));

  for (const row of rows) {
    await prisma.contact.upsert({
      where: { id: row.id },
      update: {},
      create: row,
    });
  }
  console.warn(`[seed-dev-data] contacts: ${rows.length}`);
}

async function seedOpportunities(prisma: PrismaClient): Promise<void> {
  const stages = ["interested", "qualifying", "qualified", "booked", "won", "lost"];
  const services = [
    { id: "svc_botox", name: "Botox Consultation" },
    { id: "svc_filler", name: "Dermal Filler" },
    { id: "svc_laser", name: "Laser Treatment" },
  ];

  const rows = Array.from({ length: 8 }).map((_, i) => {
    const service = services[i % services.length]!;
    const stage = stages[i % stages.length]!;
    return {
      id: `dev_opp_${String(i + 1).padStart(3, "0")}`,
      organizationId: ORG_ID,
      contactId: `dev_contact_${String(i + 1).padStart(3, "0")}`,
      serviceId: service.id,
      serviceName: service.name,
      stage,
      estimatedValue: 50000 + i * 25000,
      notes: `Sample opportunity for ${service.name} at stage "${stage}"`,
      openedAt: new Date(Date.now() - (8 - i) * 24 * 60 * 60 * 1000),
      closedAt:
        stage === "won" || stage === "lost"
          ? new Date(Date.now() - (8 - i) * 12 * 60 * 60 * 1000)
          : null,
    };
  });

  for (const row of rows) {
    await prisma.opportunity.upsert({
      where: { id: row.id },
      update: {},
      create: row,
    });
  }
  console.warn(`[seed-dev-data] opportunities: ${rows.length}`);
}

async function seedExtraAuditEntries(prisma: PrismaClient): Promise<void> {
  // Concurrent seed runs are safe: both readers see the same anchor hash,
  // both compute identical entry shapes (id is deterministic), and the
  // upserts below no-op on existing dev_audit_* IDs. First writer wins.
  const latest = await prisma.auditEntry.findFirst({
    where: { organizationId: ORG_ID },
    orderBy: { timestamp: "desc" },
    select: { entryHash: true },
  });
  let previousHash: string | null = latest?.entryHash ?? null;

  const entries = [
    {
      event: "action.proposed",
      actor: "principal_dev",
      entity: "automation",
      entityId: "auto_001",
      risk: "low",
      summary: "Proposed: auto-pause campaigns when CPL > $40",
    },
    {
      event: "action.approved",
      actor: "admin-user",
      entity: "automation",
      entityId: "auto_001",
      risk: "low",
      summary: "Approved: auto-pause rule",
    },
    {
      event: "action.executed",
      actor: "system",
      entity: "automation",
      entityId: "auto_001",
      risk: "low",
      summary: "Executed: rule armed",
    },
    {
      event: "action.proposed",
      actor: "principal_dev",
      entity: "contact",
      entityId: "crm_002",
      risk: "none",
      summary: "Proposed: import 12 leads from CSV",
    },
    {
      event: "action.executed",
      actor: "system",
      entity: "contact",
      entityId: "crm_002",
      risk: "none",
      summary: "Executed: imported 12 leads",
    },
    {
      event: "action.proposed",
      actor: "principal_dev",
      entity: "campaign",
      entityId: "camp_003",
      risk: "medium",
      summary: "Proposed: increase Spring Sale budget to $1200",
    },
    {
      event: "action.executed",
      actor: "system",
      entity: "campaign",
      entityId: "camp_003",
      risk: "medium",
      summary: "Executed: budget increased to $1200",
    },
  ];

  const baseId = "dev_audit_";
  const baseTime = Date.now();
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const id = `${baseId}${String(i + 1).padStart(3, "0")}`;
    const timestamp = new Date(baseTime - (entries.length - i) * 60 * 60 * 1000);
    const entryHash = sha256(
      JSON.stringify({
        id,
        eventType: e.event,
        timestamp: timestamp.toISOString(),
        actorId: e.actor,
        entityId: e.entityId,
        previousEntryHash: previousHash,
      }),
    );
    await prisma.auditEntry.upsert({
      where: { id },
      update: {},
      create: {
        id,
        eventType: e.event,
        timestamp,
        actorType: e.actor === "system" ? "system" : "user",
        actorId: e.actor,
        entityType: e.entity,
        entityId: e.entityId,
        riskCategory: e.risk,
        summary: e.summary,
        snapshot: {},
        evidencePointers: [],
        entryHash,
        previousEntryHash: previousHash,
        organizationId: ORG_ID,
      },
    });
    previousHash = entryHash;
  }
  console.warn(`[seed-dev-data] audit entries: +${entries.length}`);
}

async function seedApprovals(prisma: PrismaClient): Promise<void> {
  const futureExpiry = (hoursAhead: number) => new Date(Date.now() + hoursAhead * 60 * 60 * 1000);

  // Dashboard /approvals reads `id`, `summary`, `riskCategory`, `bindingHash`,
  // `createdAt` from the `request` JSON (apps/api/src/routes/approvals.ts:137-145).
  // The detail page returns the entire `request` object as-is. Mirror `id` and
  // `createdAt` into the JSON so list rendering and detail navigation work.
  //
  // Seeded approvals can be browsed but NOT submitted through the UI: the
  // bindingHash here is sha256(id) for shape only, and validateBindingHash
  // (packages/core/src/approval/binding.ts) computes from real action data.
  // Acceptable for v1 — spec scope is "render non-empty surfaces".
  const a1Id = "dev_approval_001";
  const a1CreatedAt = new Date(Date.now() - 30 * 60 * 1000);
  const a2Id = "dev_approval_002";
  const a2CreatedAt = new Date(Date.now() - 5 * 60 * 1000);

  const approvals = [
    {
      id: a1Id,
      envelopeId: "dev_envelope_001",
      organizationId: ORG_ID,
      request: {
        id: a1Id,
        createdAt: a1CreatedAt.toISOString(),
        riskCategory: "medium",
        summary: "Spend $1,200 on Meta Ads campaign 'Spring Sale 2026'",
        bindingHash: sha256(a1Id),
        actionType: "campaign.update",
        principalId: "principal_dev",
      },
      status: "pending",
      expiresAt: futureExpiry(24),
      createdAt: a1CreatedAt,
    },
    {
      id: a2Id,
      envelopeId: "dev_envelope_002",
      organizationId: ORG_ID,
      request: {
        id: a2Id,
        createdAt: a2CreatedAt.toISOString(),
        riskCategory: "high",
        summary: "Pause underperforming campaign 'Awareness Q1'",
        bindingHash: sha256(a2Id),
        actionType: "campaign.pause",
        principalId: "principal_dev",
      },
      status: "pending",
      expiresAt: futureExpiry(48),
      createdAt: a2CreatedAt,
    },
  ];

  for (const a of approvals) {
    await prisma.approvalRecord.upsert({
      where: { id: a.id },
      update: {},
      create: a,
    });
  }
  console.warn(`[seed-dev-data] approval records: ${approvals.length}`);
}

async function seedAutomations(prisma: PrismaClient): Promise<void> {
  const automations = [
    {
      id: "dev_auto_001",
      organizationId: ORG_ID,
      type: "cron",
      cronExpression: "0 9 * * *",
      action: {
        type: "notification.send",
        payload: {
          channel: "telegram",
          label: "Daily ROI digest",
          description: "Post a daily ROI summary to Telegram operators",
        },
      },
      status: "active",
      createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    },
    {
      id: "dev_auto_002",
      organizationId: ORG_ID,
      type: "event_match",
      eventPattern: {
        type: "metric.threshold_breached",
        filters: { metric: "cpl", op: "gt", value: 40 },
      },
      action: {
        type: "campaign.pause",
        payload: {
          label: "Auto-pause high-CPL campaigns",
          description: "Pause any campaign where cost-per-lead exceeds $40 for 3 consecutive days",
        },
      },
      status: "active",
      createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    },
  ];

  for (const a of automations) {
    await prisma.scheduledTriggerRecord.upsert({
      where: { id: a.id },
      update: {},
      create: a,
    });
  }
  console.warn(`[seed-dev-data] scheduled triggers: ${automations.length}`);
}
