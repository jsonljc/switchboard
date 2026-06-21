import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  PrismaReceiptedBookingStore,
  PrismaReceiptStore,
  PrismaRevenueStore,
  PrismaOutboxStore,
} from "@switchboard/db";
import type { IdentitySpec, VerifiedPayment } from "@switchboard/schemas";
import {
  GovernanceGate,
  PlatformIngress,
  IntentRegistry,
  ExecutionModeRegistry,
  OperatorMutationMode,
  type GovernanceGateDeps,
  type IntentRegistration,
  type OperatorMutationHandler,
  type DeploymentResolver,
  type Trigger,
  type WorkTrace,
  type WorkTraceStore,
  type WorkTraceClaimResult,
  type WorkTraceReadResult,
  type WorkTraceUpdateResult,
} from "@switchboard/core/platform";
import { evaluate, resolveIdentity } from "@switchboard/core";
import {
  buildWeeklyDigest,
  renderWeeklyDigestText,
  createInMemoryBaselineStore,
} from "@switchboard/core/reports";
import { buildTestServer } from "./test-server.js";
import { InMemoryRevenueDb, buildCalendarBookTool } from "./revenue-loop-substrate.js";
import {
  RECORD_ATTENDANCE_INTENT,
  RECORD_VERIFIED_PAYMENT_INTENT,
} from "../bootstrap/operator-intents.js";
import {
  resolveAuthoritativeDeployment,
  buildPlatformDirectIntentPredicate,
} from "../bootstrap/platform-deployment-resolver.js";
import { DELIVER_WEEKLY_REPORT_INTENT } from "../bootstrap/operator-intents/shared.js";
import { buildDeliverWeeklyReportHandler } from "../bootstrap/operator-intents/deliver-weekly-report.js";
import { buildDeliverWeeklyReportSubmitRequest } from "../services/workflows/ledger-weekly-report-request.js";
import {
  createWeeklyReportDeliveryService,
  renderWeeklyDigestHtml,
  weekPeriodLabel,
} from "../services/reports/weekly-report-delivery.js";
import { assembleWeeklyReport } from "../services/reports/assemble-weekly-report.js";
import type { EmailMessage, EmailSendResult } from "../services/notifications/send-email.js";

/**
 * Slice 3 (the LAST) of the whole-loop revenue-proof e2e (decomposition plan:
 * docs/superpowers/plans/2026-06-21-revenue-proof-e2e-decomposition.md). The ASSEMBLE-AND-DELIVER
 * CONTENT seam.
 *
 * Slices 1-2 proved the booking WRITE populates the owner read projection and that attendance + payment
 * surface proven-paid revenue. This slice proves the final link: the owner-facing numbers assembled from
 * that SAME substrate-backed projection (1) render into the WeeklyDigest, and (2) reach the outbound
 * email payload UNALTERED when ledger.deliver_weekly_report is driven through the REAL PlatformIngress +
 * the REAL platform-direct carve-out resolver + the REAL operator-mutation handler + the REAL delivery
 * service (createWeeklyReportDeliveryService -> assembleWeeklyReport -> createPeriodRollup -> the Prisma
 * stores over the in-memory substrate -> buildWeeklyDigest -> render text/html).
 *
 * Mocked external edges ONLY: Prisma (the shared substrate), Resend (the injected EmailSender that
 * captures the payload), and recipient resolution (a DB read, injected as a fixed list - the delivery
 * service's own injection boundary). Everything between - ingress, governance gate, carve-out resolver,
 * handler, delivery service, report rollup, the projection stores, the digest renderer - is production
 * code. P3.1 (#1198) already proved the cron SUBMIT seam; this proves the assemble-and-deliver CONTENT.
 *
 * DETERMINISM (load-bearing): assembleWeeklyReport keys on completedWeekRange(now) = the PRIOR
 * fully-elapsed UTC Mon..Sun week (NOT slices 1-2's route "THIS WEEK"). So the cohort is booked at
 * T_BOOK (a frozen system instant) and the digest is delivered with an injected now = T_DELIVER one week
 * later, so completedWeekRange(T_DELIVER) CONTAINS T_BOOK. The booked calendar receipt's createdAt is
 * stamped at the frozen system time (the substrate stamps `new Date()`; buildCalendarReceiptData sets no
 * createdAt), which is why time is frozen at T_BOOK across the booking/attendance/payment writes while
 * the delivery clock is injected independently.
 *
 * Figures are RE-DERIVED from the seeded journey, not fixtured: cohort 1; expected (booked) value 45000c
 * (the opportunity snapshot at issuance); proven-paid 30000c (the PSP fetch-back, deliberately != the
 * expected value); 0 bookings needing attention (a clean lead). currency "SGD" is snapshotted at
 * issuance from the tool's defaultCurrency, so the money renders "SGD 450.00" / "SGD 300.00" (Intl,
 * en-US). completedWeekRange(T_DELIVER) = [2026-06-15, 2026-06-22) so the period label is
 * "Jun 15 to Jun 21".
 */

const ORG = "org-1";
// Wed 2026-06-17 12:00 UTC: the booked calendar receipt's createdAt lands here (frozen system time).
const T_BOOK = new Date("2026-06-17T12:00:00.000Z");
// Wed 2026-06-24 12:00 UTC (one week later): completedWeekRange(T_DELIVER) = [2026-06-15, 2026-06-22),
// which CONTAINS T_BOOK. Injected as the delivery clock so the digest covers the booking's week.
const T_DELIVER = new Date("2026-06-24T12:00:00.000Z");
const SLOT_START = "2026-06-17T14:00:00.000Z";
const SLOT_END = "2026-06-17T15:00:00.000Z";
// EXPECTED (booked pipeline) is the opportunity value snapshotted at issuance; PAID (proven) is the PSP
// fetch-back. Deliberately DIFFERENT so the digest's two money figures can be told apart and neither can
// be a copy of the other.
const EXPECTED_VALUE_CENTS = 45000;
const PAID_CENTS = 30000;
const EXTERNAL_REF = "pi_digest_1";
const RECIPIENT = "owner@org-1.test";
const DASHBOARD_URL = "https://app.switchboard.test";
const IDEMPOTENCY_KEY = "ledger-weekly-report:org-1:2026-W25";

// Display figures hand-derived from the seeded journey (NOT read back from the digest under test):
// formatMoneyFromCents(45000,"SGD") / (30000,"SGD"), weekPeriodLabel(T_DELIVER).
const EXPECTED_MONEY = "SGD 450.00";
const PAID_MONEY = "SGD 300.00";
const PERIOD_LABEL = "Jun 15 to Jun 21";

/** Intl currency rendering separates the code from the amount with a NO-BREAK SPACE (U+00A0 in this
 *  ICU); normalize it to a plain space so the human-readable money assertions match the literals above
 *  and stay robust to the ICU space variant. The byte-exact digest==email checks below stay
 *  un-normalized, so they still prove the payload (including the original spacing) is unaltered. */
const normalizeSpace = (s: string): string => s.replace(/[\u00a0\u202f]/g, " ");

/** Fake Stripe fetch-back. The payment handler reads amount/currency/provider from THIS, never the body. */
function paidStripeCharge(over: Partial<VerifiedPayment> = {}): VerifiedPayment {
  return {
    provider: "stripe",
    externalReference: EXTERNAL_REF,
    amountCents: PAID_CENTS,
    currency: "sgd",
    status: "paid",
    bookingId: null,
    ...over,
  };
}

// --- delivery-ingress fixtures (mirror ledger-weekly-report-cron-live-path.test.ts; the load-bearing
// difference is that THIS harness wires the REAL delivery service writer, not a fake) ---

function systemSpec(): IdentitySpec {
  return {
    id: "spec-system",
    principalId: "system",
    organizationId: ORG,
    name: "System",
    description: "Seeded system principal",
    riskTolerance: {
      none: "none",
      low: "none",
      medium: "standard",
      high: "elevated",
      critical: "mandatory",
    },
    globalSpendLimits: { daily: null, weekly: null, monthly: null, perAction: null },
    cartridgeSpendLimits: {},
    forbiddenBehaviors: [],
    trustBehaviors: [],
    delegatedApprovers: [],
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

// ledger.deliver_weekly_report is system_auto_approved + non-financial, so the gate short-circuits to
// execute BEFORE loading any approval policy; the seeded system spec keeps the deps production-faithful.
function buildGate(): GovernanceGate {
  const deps: GovernanceGateDeps = {
    evaluate,
    resolveIdentity,
    loadPolicies: async () => [],
    loadIdentitySpec: async () => ({ spec: systemSpec(), overlays: [] }),
    loadCartridge: async () => null,
    getGovernanceProfile: async () => null,
  };
  return new GovernanceGate(deps);
}

// Faithful idempotency-aware in-memory trace store: the operator_mutation path is claim-first (claim()
// persists a `running` trace keyed on (organizationId, idempotencyKey) BEFORE dispatch, then update()
// finalizes it). Slice 3 submits once; the full shape keeps the dispatch path honest.
function inMemoryTraceStore(): WorkTraceStore {
  const traces: WorkTrace[] = [];
  return {
    persist: async (t: WorkTrace): Promise<void> => {
      traces.push(t);
    },
    claim: async (t: WorkTrace): Promise<WorkTraceClaimResult> => {
      const clash = traces.find(
        (existing) =>
          existing.organizationId === t.organizationId &&
          existing.idempotencyKey != null &&
          existing.idempotencyKey === t.idempotencyKey,
      );
      if (clash) return { claimed: false };
      traces.push(t);
      return { claimed: true };
    },
    getByWorkUnitId: async (id: string): Promise<WorkTraceReadResult | null> => {
      const trace = traces.find((t) => t.workUnitId === id);
      return trace ? { trace, integrity: { status: "ok" } } : null;
    },
    update: async (id: string, fields: Partial<WorkTrace>): Promise<WorkTraceUpdateResult> => {
      const idx = traces.findIndex((t) => t.workUnitId === id);
      if (idx < 0) {
        return { ok: false, code: "WORK_TRACE_LOCKED", traceUnchanged: true, reason: "not found" };
      }
      traces[idx] = { ...traces[idx]!, ...fields };
      return { ok: true, trace: traces[idx]! };
    },
    getByIdempotencyKey: async (org: string, key: string): Promise<WorkTraceReadResult | null> => {
      const trace = traces.find((t) => t.organizationId === org && t.idempotencyKey === key);
      return trace ? { trace, integrity: { status: "ok" } } : null;
    },
  } as unknown as WorkTraceStore;
}

// Mirrors the production registerOperatorIntent for ledger.deliver_weekly_report (operator_mutation,
// system_auto_approved, idempotent, allowedTriggers ["schedule","api"]).
function ledgerRegistration(): IntentRegistration {
  const allowedTriggers: Trigger[] = ["schedule", "api"];
  return {
    intent: DELIVER_WEEKLY_REPORT_INTENT,
    defaultMode: "operator_mutation",
    allowedModes: ["operator_mutation"],
    executor: { mode: "operator_mutation" },
    parameterSchema: {},
    mutationClass: "write",
    budgetClass: "cheap",
    approvalPolicy: "none",
    approvalMode: "system_auto_approved",
    idempotent: true,
    allowedTriggers,
    timeoutMs: 30_000,
    retryable: false,
  };
}

// Production resolves the "ledger" slug to no deployment (THROWS); the carve-out predicate decides
// whether resolveAuthoritativeDeployment short-circuits platform-direct instead of surfacing the throw.
function throwingResolver(): DeploymentResolver {
  return {
    resolveByOrgAndSlug: async () => {
      throw new Error("No active deployment found for org=org-1 slug=ledger");
    },
    resolveByDeploymentId: async () => {
      throw new Error("not used in this test");
    },
    resolveByChannelToken: async () => {
      throw new Error("not used in this test");
    },
  } as unknown as DeploymentResolver;
}

let openApp: FastifyInstance | null = null;

/**
 * Seed the proven-paid cohort over the shared substrate (book -> attendance -> payment, the slice-2
 * pattern), then expose: the assembled-report deps (the REAL projection stores over the substrate behind
 * the test-server stub for the non-receipted dimensions), a delivery-ingress builder wired to the REAL
 * delivery service, and the captured-email sink.
 */
async function makeHarness(opts: { withPayment?: boolean } = {}) {
  const withPayment = opts.withPayment ?? true;
  const db = new InMemoryRevenueDb();
  // A deterministic-attribution lead (leadgenId) with a priced active opportunity and no PDPA
  // jurisdiction: the clean "perfect" receipted booking (0 exceptions -> 0 needing attention).
  db.seedContact({
    id: "ct-1",
    organizationId: ORG,
    leadgenId: "lead-1",
    sourceType: null,
    firstTouchChannel: null,
    pdpaJurisdiction: null,
    consentGrantedAt: null,
    consentRevokedAt: null,
    name: "Test Patient",
    email: null,
  });
  db.seedOpportunity({
    id: "opp-1",
    organizationId: ORG,
    contactId: "ct-1",
    estimatedValue: EXPECTED_VALUE_CENTS,
    stage: "qualified",
  });

  // REAL stores over the substrate (mirrors app.ts: one PrismaReceiptStore is both the payment-receipt
  // writer and the held-promoter).
  const prismaReceipts = new PrismaReceiptStore(db.client as never);
  const prismaRevenue = new PrismaRevenueStore(db.client as never);
  const prismaOutbox = new PrismaOutboxStore(db.client as never);

  const app = (
    await buildTestServer({
      revenueStore: prismaRevenue,
      outboxWriter: {
        write: (eventId, type, payload, tx) =>
          prismaOutbox.write(eventId, type, payload, tx as never).then(() => {}),
      },
      runInTransaction: (fn) => fn(db.client),
      receiptWriter: {
        write: (input, tx) => prismaReceipts.mint(input, tx as never).then(() => {}),
      },
      paymentVerifier: async () => paidStripeCharge(),
      bookingAttendanceWriter: {
        recordAttendance: async (_organizationId: string, bookingId: string, outcome: string) => {
          await db.client.booking.update({
            where: { id: bookingId },
            data: { attendance: outcome },
          });
          return { id: bookingId, attendance: outcome };
        },
      },
      receiptHeldPromoter: prismaReceipts,
    })
  ).app;
  openApp = app;

  // Book through the REAL tool op at the frozen system time so the calendar receipt lands in the
  // completed week. Done BEFORE the decoy is seeded so the real receipt is unambiguous.
  const tool = buildCalendarBookTool(db, {
    sessionId: "s",
    orgId: ORG,
    deploymentId: "dep-1",
    contactId: "ct-1",
  });
  const booked = await tool.operations["booking.create"]!.execute({
    service: "Botox consult",
    slotStart: SLOT_START,
    slotEnd: SLOT_END,
    calendarId: "cal-1",
  });
  expect(booked.status).toBe("success");
  const calendarReceipt = db
    .listReceipts()
    .find((r) => r["organizationId"] === ORG && r["kind"] === "calendar");
  const bookingId = calendarReceipt?.bookingId;
  expect(bookingId).toBeTruthy();

  // OUT-OF-WINDOW decoy: a real, value-less booking whose booked calendar receipt was created in the
  // CURRENT week (T_DELIVER's week), OUTSIDE completedWeekRange(T_DELIVER). The booking ROW exists so a
  // broken (current-week / union) window would OVER-COUNT it instead of silently orphan-dropping it.
  // Proves the digest path targets the COMPLETED week, not the current one.
  db.seedBooking({
    id: "bk-decoy",
    organizationId: ORG,
    contactId: null,
    opportunityId: null,
    service: "Decoy current-week",
    startsAt: new Date("2026-06-24T14:00:00.000Z"),
  });
  db.seedReceipt({
    id: "rcpt-decoy",
    organizationId: ORG,
    kind: "calendar",
    status: "booked",
    bookingId: "bk-decoy",
    createdAt: new Date("2026-06-24T12:00:00.000Z"),
    tier: "T1_FETCH_BACK",
    provider: null,
    amount: null,
  });

  // Attendance (booked -> held) then verified payment (paid receipt + revenue event), through real
  // ingress + the real operator-mutation handlers.
  const att = await app.platformIngress.submit({
    intent: RECORD_ATTENDANCE_INTENT,
    parameters: { bookingId, outcome: "attended", recordedBy: "owner" },
    actor: { id: "owner-1", type: "user" },
    organizationId: ORG,
    trigger: "api",
    surface: { surface: "api" },
    idempotencyKey: `att-${bookingId}`,
  });
  // Fail loud AT the seeding point if the real ingress did not EXECUTE the write (a governed deny keeps
  // res.ok true with a non-completed outcome, and would otherwise surface only as a confusing zero in
  // the downstream digest figures).
  if (!att.ok) throw new Error(`attendance seeding failed: ${JSON.stringify(att.error)}`);
  expect(att.result.outcome).toBe("completed");

  if (withPayment) {
    const pay = await app.platformIngress.submit({
      intent: RECORD_VERIFIED_PAYMENT_INTENT,
      actor: { id: "system", type: "service" },
      organizationId: ORG,
      trigger: "api",
      surface: { surface: "api" },
      idempotencyKey: `pay-${bookingId}`,
      parameters: {
        contactId: "ct-1",
        opportunityId: "opp-1",
        bookingId,
        amountCents: PAID_CENTS,
        currency: "SGD",
        externalReference: EXTERNAL_REF,
        provider: "stripe",
      },
    });
    if (!pay.ok) throw new Error(`payment seeding failed: ${JSON.stringify(pay.error)}`);
    expect(pay.result.outcome).toBe("completed");
  }

  // Wire the REAL receipted-booking projection over the substrate behind the test-server stub for the
  // non-receipted report dimensions (the same wiring slices 1-2 drive through the route).
  const receiptedStore = new PrismaReceiptedBookingStore(db.client as never);
  app.reportStores!.receiptedBookings = {
    listForCohort: (input) => receiptedStore.listForCohort(input.orgId, input.from, input.to),
  };
  app.reportStores!.receipts = {
    countReceiptedBookingsInWindow: (input) => prismaReceipts.countReceiptedBookingsInWindow(input),
  };

  const reportDeps = {
    stores: app.reportStores!,
    reportCache: app.reportCacheStore!,
    baselineStore: createInMemoryBaselineStore(),
  };

  const capturedEmails: EmailMessage[] = [];
  const capturingSender = async (msg: EmailMessage): Promise<EmailSendResult> => {
    capturedEmails.push(msg);
    return { ok: true };
  };

  /** Build the delivery ingress (cron-live-path shape) wired to the REAL delivery service. carveOut
   *  toggles whether the throwing "ledger" resolver short-circuits platform-direct. */
  function buildDeliveryIngress(carveOut: boolean): PlatformIngress {
    const intentRegistry = new IntentRegistry();
    intentRegistry.register(ledgerRegistration());

    const deliveryService = createWeeklyReportDeliveryService({
      resolveRecipients: async () => [RECIPIENT],
      assembleReport: (orgId, now) => assembleWeeklyReport(reportDeps, orgId, now),
      sendEmail: capturingSender,
      dashboardUrl: DASHBOARD_URL,
      now: () => T_DELIVER,
    });
    const handler = buildDeliverWeeklyReportHandler(deliveryService);

    const modeRegistry = new ExecutionModeRegistry();
    modeRegistry.register(
      new OperatorMutationMode({
        handlers: new Map<string, OperatorMutationHandler>([
          [DELIVER_WEEKLY_REPORT_INTENT, handler],
        ]),
      }),
    );

    return new PlatformIngress({
      intentRegistry,
      modeRegistry,
      governanceGate: buildGate(),
      deploymentResolver: resolveAuthoritativeDeployment(throwingResolver(), {
        isPlatformDirectIntent: carveOut
          ? buildPlatformDirectIntentPredicate(intentRegistry)
          : () => false,
      }),
      traceStore: inMemoryTraceStore(),
    });
  }

  return { db, app, reportDeps, capturedEmails, buildDeliveryIngress };
}

function deliverReq() {
  return buildDeliverWeeklyReportSubmitRequest({
    organizationId: ORG,
    idempotencyKey: IDEMPOTENCY_KEY,
  });
}

describe("revenue-proof e2e slice 3: weekly digest assemble + deliver content seam (real ingress)", () => {
  beforeEach(() => {
    // Fake ONLY Date (leave timers real) so Fastify's async internals are unaffected.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T_BOOK);
  });

  afterEach(async () => {
    if (openApp) await openApp.close();
    openApp = null;
    vi.useRealTimers();
  });

  it("renders the seeded journey's owner numbers into the digest from the real substrate-backed report path", async () => {
    const h = await makeHarness({ withPayment: true });

    // The REAL report path: assembleWeeklyReport -> createPeriodRollup -> the projection stores over the
    // substrate. The completed-week cohort excludes the current-week decoy.
    const report = await assembleWeeklyReport(h.reportDeps, ORG, T_DELIVER);
    expect(report.receiptedBookings.count).toBe(1);
    expect(report.receiptedBookingRevenue).toMatchObject({
      cohortSize: 1,
      bookingsWithValue: 1,
      revenueCents: EXPECTED_VALUE_CENTS,
      paidRevenueCents: PAID_CENTS,
      paidBookings: 1,
      currency: "SGD",
    });
    expect(report.receiptedBookingQuality.bookingsNeedingAttention).toBe(0);

    // The owner-facing numbers as rendered by the digest (re-derived literals, not fixtured).
    const digest = buildWeeklyDigest(report, {
      periodLabel: weekPeriodLabel(T_DELIVER),
      dashboardUrl: `${DASHBOARD_URL}/reports`,
      maxAttentionItems: 5,
    });
    const metric = (key: string) => digest.metrics.find((m) => m.key === key);
    expect(metric("receipted_bookings")?.value).toBe("1");
    expect(normalizeSpace(metric("paid_revenue")?.value ?? "")).toBe(PAID_MONEY);
    expect(metric("paid_revenue")?.detail).toBe("1 of 1 bookings paid");
    expect(normalizeSpace(metric("receipted_revenue")?.value ?? "")).toBe(EXPECTED_MONEY);
    expect(metric("receipted_revenue")?.detail).toBe("1 of 1 carried a value");
    expect(metric("needs_attention")?.value).toBe("0");
    expect(normalizeSpace(digest.subject)).toBe(
      `Your week: 1 receipted booking, ${EXPECTED_MONEY} booked`,
    );
    expect(digest.periodLabel).toBe(PERIOD_LABEL);

    // Anti-vacuity: the out-of-window decoy IS in the substrate but excluded from the completed-week
    // cohort (count stayed 1 above with it present).
    expect(h.db.listReceipts().some((r) => r["bookingId"] === "bk-decoy")).toBe(true);
  });

  it("delivers the assembled digest figures to the email payload unaltered through real ingress + carve-out", async () => {
    const h = await makeHarness({ withPayment: true });
    const ingress = h.buildDeliveryIngress(true);

    const res = await ingress.submit(deliverReq());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // system_auto_approved short-circuits the gate to execute; it does not park.
    expect("approvalRequired" in res && res.approvalRequired === true).toBe(false);
    expect(res.result.outcome).toBe("completed");
    expect(res.result.outputs?.["delivered"]).toBe(true);
    expect(res.result.outputs?.["recipientCount"]).toBe(1);
    // The cron uses the seeded system principal verbatim.
    expect(res.workUnit?.actor).toEqual({ id: "system", type: "system" });

    // Exactly one email, to the resolved recipient.
    expect(h.capturedEmails).toHaveLength(1);
    const sent = h.capturedEmails[0]!;
    expect(sent.to).toEqual([RECIPIENT]);

    // The SAME owner numbers (re-derived literals) reached the email payload. Currency NBSP (U+00A0
    // from Intl) is normalized to a plain space for these human-readable checks; the byte-exact block
    // below proves nothing was altered, original spacing included.
    const text = normalizeSpace(sent.text);
    const html = normalizeSpace(sent.html);
    expect(normalizeSpace(sent.subject)).toBe(
      `Your week: 1 receipted booking, ${EXPECTED_MONEY} booked`,
    );
    expect(text).toContain("Receipted bookings: 1");
    expect(text).toContain(`Receipted revenue (paid): ${PAID_MONEY}`);
    expect(text).toContain("1 of 1 bookings paid");
    expect(text).toContain(`Booked value (expected): ${EXPECTED_MONEY}`);
    expect(text).toContain("1 of 1 carried a value");
    expect(text).toContain("Bookings needing attention: 0");
    expect(html).toContain(EXPECTED_MONEY);
    expect(html).toContain(PAID_MONEY);

    // UNALTERED: the email body IS the assembled digest rendered, byte-for-byte (nothing mutated between
    // assemble and send). Re-derived independently here from the SAME substrate-backed report path.
    const report = await assembleWeeklyReport(h.reportDeps, ORG, T_DELIVER);
    const expectedDigest = buildWeeklyDigest(report, {
      periodLabel: weekPeriodLabel(T_DELIVER),
      dashboardUrl: `${DASHBOARD_URL}/reports`,
      maxAttentionItems: 5,
    });
    expect(sent.subject).toBe(expectedDigest.subject);
    expect(sent.text).toBe(renderWeeklyDigestText(expectedDigest));
    expect(sent.html).toBe(renderWeeklyDigestHtml(expectedDigest));
  });

  it("does NOT deliver (or leak an email) without the carve-out resolver (carve-out is load-bearing)", async () => {
    const h = await makeHarness({ withPayment: true });
    const ingress = h.buildDeliveryIngress(false);

    const res = await ingress.submit(deliverReq());
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.type).toBe("deployment_not_found");
    // No email is sent when the resolver fails: delivery is gated on the carve-out reaching execution.
    expect(h.capturedEmails).toHaveLength(0);
  });
});
