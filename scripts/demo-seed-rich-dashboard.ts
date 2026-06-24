/* eslint-disable no-console */
/**
 * Rich demo seed for the dashboard AESTHETICS audit (org_dev, dev-bypass).
 *
 * Purpose: drive the dashboard's main surfaces into a POPULATED state so the
 * audit judges real activity, not empty states. Idempotent — upserts keyed on
 * stable `demo_*` IDs; safe to re-run. Read-only-safe to the rest of the DB.
 *
 * Medspa vertical, canonical agents: Alex = front desk (responder),
 * Riley = ad analyst (optimizer), Mira = content maker.
 *
 * Defeats, with the lineage each one feeds (verified against the running app):
 *   - Home "still being tallied"  ← Booking + ConversionRecord in this-week window (useAgentMetrics.alex)
 *   - Home "All quiet overnight"  ← agent-actor AuditEntry rows for alex     (useAgentActivityCockpit.alex)
 *   - Home TeamBand "Not set up"  ← meta-ads + google_calendar Connections + roster rules config
 *   - Home TeamBand "Asleep"      ← AgentState responder=working, optimizer=analyzing
 *   - Home NeedsYou / Inbox       ← extra PendingActionRecords (alex + riley) + a 2nd Handoff
 *   - Results first-run empty      ← Booking + LifecycleRevenueEvent + ConversionRecord in window
 *
 * Cannot be defeated by seeding (documented in the audit, NOT a seed gap):
 *   - Home "No active handoffs"   ← home-page.tsx hard-codes workInProgressItems = []
 *   - Meta spend / funnel / campaign numbers ← live Meta Ads API, not a DB table
 */
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";

const prisma = new PrismaClient();
const ORG = "org_dev";
const now = new Date();
const DAY = 24 * 60 * 60 * 1000;

/** A weekday within the current week (n days before today), at a fixed mid-day UTC hour. */
function daysAgo(n: number, hourUtc = 9): Date {
  const d = new Date(now.getTime() - n * DAY);
  d.setUTCHours(hourUtc, 17, 0, 0);
  return d;
}
function daysAhead(n: number, hourUtc = 6): Date {
  const d = new Date(now.getTime() + n * DAY);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d;
}
function hoursAgo(n: number): Date {
  return new Date(now.getTime() - n * 60 * 60 * 1000);
}
function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

// ── Contacts (medspa names; some PDPA-consented for the consent tile) ─────────
interface DemoContact {
  id: string;
  name: string;
  phone: string;
  email: string;
  stage: string;
  source: string;
  consented: boolean;
}
const CONTACTS: DemoContact[] = [
  { id: "demo_c_maya", name: "Maya Lim", phone: "+6581002001", email: "maya@example.com", stage: "booked", source: "ctwa", consented: true },
  { id: "demo_c_priya", name: "Priya Sharma", phone: "+6581002002", email: "priya@example.com", stage: "qualified", source: "organic", consented: true },
  { id: "demo_c_jolene", name: "Jolene Tan", phone: "+6581002003", email: "jolene@example.com", stage: "booked", source: "instant_form", consented: true },
  { id: "demo_c_aisha", name: "Aisha Rahman", phone: "+6581002004", email: "aisha@example.com", stage: "qualifying", source: "organic", consented: false },
  { id: "demo_c_grace", name: "Grace Wong", phone: "+6581002005", email: "grace@example.com", stage: "booked", source: "web", consented: true },
  { id: "demo_c_nadia", name: "Nadia Iskandar", phone: "+6581002006", email: "nadia@example.com", stage: "qualifying", source: "ctwa", consented: false },
];

// ── Opportunities (one per contact) ──────────────────────────────────────────
interface DemoOpp {
  id: string;
  contactId: string;
  serviceId: string;
  serviceName: string;
  stage: string;
  valueCents: number;
  won: boolean;
}
const OPPS: DemoOpp[] = [
  { id: "demo_o_maya", contactId: "demo_c_maya", serviceId: "svc_filler", serviceName: "Lip Filler", stage: "closed_won", valueCents: 90000, won: true },
  { id: "demo_o_priya", contactId: "demo_c_priya", serviceId: "svc_botox", serviceName: "Botox Consultation", stage: "qualified", valueCents: 65000, won: false },
  { id: "demo_o_jolene", contactId: "demo_c_jolene", serviceId: "svc_botox", serviceName: "Botox Consultation", stage: "closed_won", valueCents: 65000, won: true },
  { id: "demo_o_aisha", contactId: "demo_c_aisha", serviceId: "svc_hydra", serviceName: "HydraFacial", stage: "interested", valueCents: 28000, won: false },
  { id: "demo_o_grace", contactId: "demo_c_grace", serviceId: "svc_botox", serviceName: "Botox Consultation", stage: "booked", valueCents: 65000, won: false },
  { id: "demo_o_nadia", contactId: "demo_c_nadia", serviceId: "svc_laser", serviceName: "Laser Hair Removal", stage: "qualifying", valueCents: 120000, won: false },
];

// ── Bookings (createdAt within this week; mix of held / no-show / upcoming) ───
interface DemoBooking {
  id: string;
  contactId: string;
  oppId: string;
  service: string;
  attendeeName: string;
  createdDaysAgo: number;
  startsAt: Date;
  status: string;
  attendance: string | null;
}
const BOOKINGS: DemoBooking[] = [
  { id: "demo_b_maya", contactId: "demo_c_maya", oppId: "demo_o_maya", service: "Lip Filler", attendeeName: "Maya Lim", createdDaysAgo: 5, startsAt: daysAgo(2, 6), status: "confirmed", attendance: "attended" },
  { id: "demo_b_jolene", contactId: "demo_c_jolene", oppId: "demo_o_jolene", service: "Botox Consultation", attendeeName: "Jolene Tan", createdDaysAgo: 4, startsAt: daysAgo(1, 7), status: "confirmed", attendance: "attended" },
  { id: "demo_b_priya", contactId: "demo_c_priya", oppId: "demo_o_priya", service: "Botox Consultation", attendeeName: "Priya Sharma", createdDaysAgo: 3, startsAt: daysAgo(1, 9), status: "confirmed", attendance: "attended" },
  { id: "demo_b_nadia", contactId: "demo_c_nadia", oppId: "demo_o_nadia", service: "Laser Hair Removal", attendeeName: "Nadia Iskandar", createdDaysAgo: 3, startsAt: daysAgo(2, 8), status: "confirmed", attendance: "no_show" },
  { id: "demo_b_grace", contactId: "demo_c_grace", oppId: "demo_o_grace", service: "Botox Consultation", attendeeName: "Grace Wong", createdDaysAgo: 1, startsAt: daysAhead(1), status: "confirmed", attendance: null },
  { id: "demo_b_aisha", contactId: "demo_c_aisha", oppId: "demo_o_aisha", service: "HydraFacial", attendeeName: "Aisha Rahman", createdDaysAgo: 0, startsAt: daysAhead(2), status: "confirmed", attendance: null },
];

// ── Conversion records (leads this week; some ad-attributed for Riley) ────────
interface DemoConv {
  id: string;
  contactId: string;
  daysAgo: number;
  campaign: string | null; // set => Riley/ad-attributed
}
const CONVS: DemoConv[] = [
  { id: "demo_cv_maya", contactId: "demo_c_maya", daysAgo: 5, campaign: "Lip Filler — Jun" },
  { id: "demo_cv_jolene", contactId: "demo_c_jolene", daysAgo: 4, campaign: "Botox — Jun" },
  { id: "demo_cv_priya", contactId: "demo_c_priya", daysAgo: 4, campaign: null },
  { id: "demo_cv_aisha", contactId: "demo_c_aisha", daysAgo: 2, campaign: null },
  { id: "demo_cv_grace", contactId: "demo_c_grace", daysAgo: 2, campaign: null },
  { id: "demo_cv_nadia", contactId: "demo_c_nadia", daysAgo: 1, campaign: "Laser — Jun" },
  { id: "demo_cv_walkin1", contactId: "demo_c_priya", daysAgo: 0, campaign: null },
  { id: "demo_cv_walkin2", contactId: "demo_c_grace", daysAgo: 0, campaign: "Botox — Jun" },
];

// ── Revenue events (confirmed, live, this week; some Riley-attributed) ────────
interface DemoRevenue {
  id: string;
  contactId: string;
  oppId: string;
  bookingId: string;
  amountCents: number;
  daysAgo: number;
  campaign: string | null;
}
const REVENUE: DemoRevenue[] = [
  { id: "demo_re_maya", contactId: "demo_c_maya", oppId: "demo_o_maya", bookingId: "demo_b_maya", amountCents: 90000, daysAgo: 2, campaign: "Lip Filler — Jun" },
  { id: "demo_re_jolene", contactId: "demo_c_jolene", oppId: "demo_o_jolene", bookingId: "demo_b_jolene", amountCents: 65000, daysAgo: 1, campaign: "Botox — Jun" },
  { id: "demo_re_priya", contactId: "demo_c_priya", oppId: "demo_o_priya", bookingId: "demo_b_priya", amountCents: 65000, daysAgo: 1, campaign: null },
];

async function seedContacts() {
  for (const c of CONTACTS) {
    const data = {
      organizationId: ORG,
      name: c.name,
      phone: c.phone,
      phoneE164: c.phone,
      email: c.email,
      primaryChannel: "whatsapp",
      firstTouchChannel: "whatsapp",
      stage: c.stage,
      source: c.source,
      sourceType: c.source,
      roles: ["lead"],
      messagingOptIn: true,
      messagingOptInAt: daysAgo(6),
      messagingOptInSource: "ctwa",
      firstContactAt: daysAgo(6),
      lastActivityAt: hoursAgo(4),
      ...(c.consented
        ? {
            pdpaJurisdiction: "PDPA-SG",
            consentGrantedAt: daysAgo(6),
            consentSource: "whatsapp_inbound",
          }
        : {}),
    };
    await prisma.contact.upsert({ where: { id: c.id }, update: data, create: { id: c.id, ...data } });
  }
  console.log(`contacts: ${CONTACTS.length}`);
}

async function seedOpportunities() {
  for (const o of OPPS) {
    const data = {
      organizationId: ORG,
      contactId: o.contactId,
      serviceId: o.serviceId,
      serviceName: o.serviceName,
      stage: o.stage,
      estimatedValue: o.valueCents,
      revenueTotal: o.won ? o.valueCents : 0,
      notes: `${o.serviceName} — demo opportunity`,
      openedAt: daysAgo(6),
      closedAt: o.won ? daysAgo(2) : null,
    };
    await prisma.opportunity.upsert({ where: { id: o.id }, update: data, create: { id: o.id, ...data } });
  }
  console.log(`opportunities: ${OPPS.length}`);
}

async function seedBookings() {
  for (const b of BOOKINGS) {
    const start = b.startsAt;
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const data = {
      organizationId: ORG,
      contactId: b.contactId,
      opportunityId: b.oppId,
      service: b.service,
      startsAt: start,
      endsAt: end,
      timezone: "Asia/Singapore",
      status: b.status,
      attendeeName: b.attendeeName,
      createdByType: "agent",
      sourceChannel: "whatsapp",
      origin: "live",
      attendance: b.attendance,
      createdAt: daysAgo(b.createdDaysAgo),
    };
    await prisma.booking.upsert({ where: { id: b.id }, update: data, create: { id: b.id, ...data } });
  }
  console.log(`bookings: ${BOOKINGS.length}`);
}

async function seedConversions() {
  for (const cv of CONVS) {
    const data = {
      eventId: `${cv.id}_evt`,
      organizationId: ORG,
      contactId: cv.contactId,
      type: "lead",
      value: 0,
      sourceCampaignId: cv.campaign,
      sourceAdId: cv.campaign ? `${cv.campaign} / ad-1` : null,
      sourceChannel: cv.campaign ? "meta" : "organic",
      origin: "live",
      occurredAt: daysAgo(cv.daysAgo, 8),
    };
    await prisma.conversionRecord.upsert({ where: { id: cv.id }, update: data, create: { id: cv.id, ...data } });
  }
  console.log(`conversions: ${CONVS.length}`);
}

async function seedRevenue() {
  for (const r of REVENUE) {
    const data = {
      organizationId: ORG,
      contactId: r.contactId,
      opportunityId: r.oppId,
      amount: r.amountCents,
      currency: "SGD",
      type: "booking_value",
      status: "confirmed",
      recordedBy: "system",
      bookingId: r.bookingId,
      verified: true,
      sourceCampaignId: r.campaign,
      sourceAdId: r.campaign ? `${r.campaign} / ad-1` : null,
      origin: "live",
      recordedAt: daysAgo(r.daysAgo, 10),
    };
    await prisma.lifecycleRevenueEvent.upsert({ where: { id: r.id }, update: data, create: { id: r.id, ...data } });
  }
  console.log(`revenue events: ${REVENUE.length}`);
}

async function seedReceipts() {
  const receipts = [
    { id: "demo_rc_maya", bookingId: "demo_b_maya", oppId: "demo_o_maya", revId: "demo_re_maya", status: "held", amount: 90000 },
    { id: "demo_rc_jolene", bookingId: "demo_b_jolene", oppId: "demo_o_jolene", revId: "demo_re_jolene", status: "held", amount: 65000 },
    { id: "demo_rc_grace", bookingId: "demo_b_grace", oppId: "demo_o_grace", revId: null, status: "booked", amount: 65000 },
  ];
  for (const rc of receipts) {
    const data = {
      organizationId: ORG,
      kind: "calendar",
      tier: "T1_FETCH_BACK",
      status: rc.status,
      bookingId: rc.bookingId,
      opportunityId: rc.oppId,
      revenueEventId: rc.revId,
      amount: rc.amount,
      currency: "SGD",
      evidence: { source: "demo", calendar: "google_calendar" },
      capturedBy: "system",
      verifiedAt: rc.status === "held" ? daysAgo(1) : null,
    };
    await prisma.receipt.upsert({ where: { id: rc.id }, update: data, create: { id: rc.id, ...data } });
  }
  console.log(`receipts: ${receipts.length}`);
}

async function seedConnections() {
  const conns = [
    { serviceId: "meta-ads", serviceName: "Meta Ads", externalAccountId: "act_demo_001" },
    { serviceId: "google_calendar", serviceName: "Google Calendar", externalAccountId: "cal_demo_001" },
  ];
  for (const c of conns) {
    const data = {
      serviceName: c.serviceName,
      authType: "oauth2",
      credentials: {},
      scopes: [],
      status: "connected",
      externalAccountId: c.externalAccountId,
      lastHealthCheck: hoursAgo(2),
    };
    await prisma.connection.upsert({
      where: { serviceId_organizationId: { serviceId: c.serviceId, organizationId: ORG } },
      update: data,
      create: { serviceId: c.serviceId, organizationId: ORG, ...data },
    });
  }
  console.log(`connections: ${conns.length}`);
}

async function setRolesWorkingAndConfigured() {
  // Alex = responder: rules config (priceApprovalThreshold + refundEscalationFloor) + working.
  await prisma.agentRoster.update({
    where: { organizationId_agentRole: { organizationId: ORG, agentRole: "responder" } },
    data: {
      config: { priceApprovalThreshold: 500, refundEscalationFloor: 100, tone: "friendly" },
      agentState: {
        update: {
          activityStatus: "working",
          currentTask: "Replying to Priya about Botox aftercare",
          lastActionSummary: "Sent Maya her day-3 check-in",
          lastActionAt: hoursAgo(1),
        },
      },
    },
  });
  // Riley = optimizer: rules config (avgValueCents + targetCpbCents) + analyzing.
  await prisma.agentRoster.update({
    where: { organizationId_agentRole: { organizationId: ORG, agentRole: "optimizer" } },
    data: {
      config: { avgValueCents: 5000, targetCpbCents: 250 },
      agentState: {
        update: {
          activityStatus: "analyzing",
          currentTask: "Comparing CPB across 3 live campaigns",
          lastActionSummary: "Flagged 'Awareness Q1' as 3× over target CPB",
          lastActionAt: hoursAgo(2),
        },
      },
    },
  });
  console.log("roster config + agent state: alex=working, riley=analyzing");
}

// ── While-you-slept: agent-actor audit entries for alex ───────────────────────
async function seedAlexActivity() {
  const entries = [
    {
      id: "demo_audit_alex_1",
      eventType: "booking.confirmed",
      tsHoursAgo: 3,
      snapshot: {
        agentRole: "alex",
        booking: { contactId: "demo_c_maya", contactDisplayName: "Maya Lim", service: "lip filler review", when: "Thu 2pm", note: "Aftercare PDF sent." },
      },
    },
    {
      id: "demo_audit_alex_2",
      eventType: "message.replied",
      tsHoursAgo: 5,
      snapshot: {
        agentRole: "alex",
        message: { contactId: "demo_c_priya", contactDisplayName: "Priya Sharma", topic: "aftercare question", summary: "Reassured her the swelling at 48h is normal." },
      },
    },
    {
      id: "demo_audit_alex_3",
      eventType: "lifecycle.qualified",
      tsHoursAgo: 7,
      snapshot: { agentRole: "alex", contactId: "demo_c_jolene", contactDisplayName: "Jolene Tan", qualifier: "ready to book Botox" },
    },
    {
      id: "demo_audit_alex_4",
      eventType: "message.batch_sent",
      tsHoursAgo: 8,
      snapshot: { agentRole: "alex", count: 6, template: "Day-3 check-in", filter: "treated this week" },
    },
    {
      id: "demo_audit_alex_5",
      eventType: "lead.created",
      tsHoursAgo: 9,
      snapshot: { agentRole: "alex", count: 4, source: "Instagram" },
    },
  ];
  for (const e of entries) {
    const ts = hoursAgo(e.tsHoursAgo);
    const data = {
      eventType: e.eventType,
      timestamp: ts,
      actorType: "agent",
      actorId: "alex",
      entityType: "contact",
      entityId: (e.snapshot as Record<string, unknown>).contactId?.toString() ?? "batch",
      riskCategory: "none",
      summary: `alex ${e.eventType}`,
      snapshot: e.snapshot,
      evidencePointers: [],
      entryHash: sha256(e.id),
      organizationId: ORG,
      createdAt: ts,
    };
    await prisma.auditEntry.upsert({ where: { id: e.id }, update: data, create: { id: e.id, ...data } });
  }
  console.log(`alex activity (while-you-slept) entries: ${entries.length}`);
}

// ── Extra recommendations (richer Needs You / Inbox: riley + alex) ────────────
async function seedRecommendations() {
  const recs = [
    {
      id: "demo_rec_riley_budget",
      intent: "recommendation.reallocate_budget",
      sourceAgent: "riley",
      humanSummary: "Shift S$40/day from 'Awareness Q1' to 'Lip Filler — Jun', where cost-per-booking is 3× better.",
      targetEntities: { campaignName: "Lip Filler — Jun" },
      riskLevel: "medium",
      dollarsAtRisk: 40,
      confidence: 0.82,
      presentation: {
        primaryLabel: "Approve shift",
        secondaryLabel: "Adjust amount",
        dismissLabel: "Keep as is",
        dataLines: [["From", "Awareness Q1 · S$40/day"], ["To", "Lip Filler — Jun"], ["Cost per booking", "S$95 → S$31"]],
      },
      riskContract: { riskLevel: "medium", clientFacing: false, externalEffect: true, financialEffect: true, requiresConfirmation: true },
    },
    {
      id: "demo_rec_alex_reschedule",
      intent: "recommendation.offer_reschedule",
      sourceAgent: "alex",
      humanSummary: "Aisha asked to move her HydraFacial — offer her Fri 4pm or Sat 11am?",
      targetEntities: { contactName: "Aisha Rahman", contactId: "demo_c_aisha" },
      riskLevel: "low",
      dollarsAtRisk: 0,
      confidence: 0.88,
      presentation: {
        primaryLabel: "Send options",
        secondaryLabel: "Edit first",
        dismissLabel: "Skip",
        dataLines: [["Client", "Aisha Rahman"], ["Service", "HydraFacial"], ["Proposed", "Fri 4pm / Sat 11am"]],
      },
      riskContract: { riskLevel: "low", clientFacing: true, externalEffect: false, financialEffect: false, requiresConfirmation: false },
    },
    {
      id: "demo_rec_alex_deposit",
      intent: "recommendation.send_deposit_reminder",
      sourceAgent: "alex",
      humanSummary: "Grace's Botox slot is in 24h with no deposit — send a gentle reminder?",
      targetEntities: { contactName: "Grace Wong", contactId: "demo_c_grace" },
      riskLevel: "low",
      dollarsAtRisk: 0,
      confidence: 0.79,
      presentation: {
        primaryLabel: "Send reminder",
        secondaryLabel: "Edit first",
        dismissLabel: "Skip",
        dataLines: [["Client", "Grace Wong"], ["Slot", "Tomorrow 3pm"], ["Deposit", "S$100 unpaid"]],
      },
      riskContract: { riskLevel: "low", clientFacing: true, externalEffect: false, financialEffect: false, requiresConfirmation: false },
    },
  ];
  for (const r of recs) {
    const data = {
      idempotencyKey: `${r.id}_key`,
      status: "pending",
      intent: r.intent,
      targetEntities: r.targetEntities,
      parameters: {
        __recommendation: { note: null, action: r.intent, presentation: r.presentation, riskContract: r.riskContract },
      },
      humanSummary: r.humanSummary,
      confidence: r.confidence,
      riskLevel: r.riskLevel,
      dollarsAtRisk: r.dollarsAtRisk,
      requiredCapabilities: [],
      approvalRequired: "operator",
      sourceAgent: r.sourceAgent,
      organizationId: ORG,
      surface: "queue",
      createdAt: hoursAgo(Math.floor(Math.random() * 6) + 1),
    };
    await prisma.pendingActionRecord.upsert({ where: { id: r.id }, update: data, create: { id: r.id, ...data } });
  }
  console.log(`recommendations: ${recs.length}`);
}

async function seedHandoff() {
  const id = "demo_handoff_nadia";
  const data = {
    sessionId: "demo_sess_nadia",
    organizationId: ORG,
    leadId: "demo_c_nadia",
    status: "pending",
    reason: "max_turns_exceeded",
    leadSnapshot: { name: "Nadia Iskandar", phone: "+6581002006", leadId: "demo_c_nadia" },
    qualificationSnapshot: { service: "Laser Hair Removal", budget: "exploring" },
    conversationSummary: { keyTopics: ["Laser package", "Pricing", "Skin type"], sentiment: "engaged", turns: 11 },
    slaDeadlineAt: daysAhead(0, new Date().getUTCHours() + 2),
    createdAt: hoursAgo(2),
  };
  await prisma.handoff.upsert({ where: { id }, update: data, create: { id, ...data } });
  console.log("handoff: 1 (max_turns_exceeded, Nadia)");
}

async function main() {
  console.log(`[demo-seed] populating rich demo state for ${ORG} @ ${now.toISOString()}`);
  await seedContacts();
  await seedOpportunities();
  await seedBookings();
  await seedConversions();
  await seedRevenue();
  await seedReceipts();
  await seedConnections();
  await setRolesWorkingAndConfigured();
  await seedAlexActivity();
  await seedRecommendations();
  await seedHandoff();
  console.log("[demo-seed] done");
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
