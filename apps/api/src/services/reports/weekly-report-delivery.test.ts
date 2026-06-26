import { describe, it, expect, vi } from "vitest";
import type { ReportDataV1, WeeklyDigest } from "@switchboard/schemas";
import type { EmailMessage, EmailSendResult } from "../notifications/send-email.js";
import {
  createWeeklyReportDeliveryService,
  renderWeeklyDigestHtml,
  resolveReportLink,
  weekPeriodLabel,
} from "./weekly-report-delivery.js";

function mkDigest(overrides: Partial<WeeklyDigest> = {}): WeeklyDigest {
  return {
    subject: "Your week: 12 receipted bookings, $3,450.00 booked",
    headline: "Here is your receipted-bookings summary for Jun 8 to Jun 14.",
    periodLabel: "Jun 8 to Jun 14",
    metrics: [
      { key: "receipted_bookings", label: "Receipted bookings", value: "12" },
      {
        key: "receipted_revenue",
        label: "Receipted revenue",
        value: "$3,450.00",
        detail: "9 of 12 carried a value",
      },
    ],
    attention: [
      {
        service: "Botox consult",
        when: "Tue, Jun 9",
        confidence: "unattributed",
        issues: "missing source",
      },
    ],
    attentionNote: "1 booking needs attention.",
    dashboardUrl: "https://app.test/reports",
    ...overrides,
  };
}

// A minimal but runtime-valid ReportDataV1 covering all fields buildWeeklyDigest reads:
// receiptedBookings / revenue / quality / heldRate / consentCompleteness / attribution /
// campaigns (the last two were added when the digest gained riley economics lines).
const fakeReport = {
  label: "THIS WEEK",
  receiptedBookings: { count: 12 },
  receiptedBookingRevenue: {
    revenueCents: 345000,
    currency: "USD",
    bookingsWithValue: 9,
    cohortSize: 12,
    paidRevenueCents: 180000,
    paidBookings: 5,
  },
  receiptedBookingQuality: {
    cohortSize: 12,
    confidence: { deterministic: 8, high: 2, medium: 1, low: 1, unattributed: 0 },
    exceptions: {
      missing_source: 1,
      missing_consent: 0,
      manual_override: 0,
      duplicate_contact_risk: 0,
    },
    bookingsNeedingAttention: 1,
    worklist: [
      {
        bookingId: "bk_1",
        service: "Botox consult",
        startsAt: "2026-06-09T15:00:00.000Z",
        attributionConfidence: "unattributed",
        openExceptionCodes: ["missing_source"],
        issuedAt: "2026-06-09T15:05:00.000Z",
        overridden: false,
      },
    ],
  },
  heldRate: { attended: 8, matured: 10, rate: 0.8 },
  consentCompleteness: { validConsent: 11, bookable: 12, rate: 0.9167 },
  attribution: {
    total: 3450,
    delta: { kind: "pos", text: "+12%" },
    riley: { value: 1200, caption: "from paid campaigns" },
    alex: { value: 2250, caption: "from organic" },
  },
  campaigns: [
    {
      name: "Summer Promo",
      spend: 500,
      impressions: 10000,
      inlineLinkClicks: 300,
      costPerInlineLinkClick: 1.67,
      inlineLinkClickCtr: 0.03,
      leads: 15,
      revenue: 1200,
      cpl: 33.33,
      clickToLeadRate: 0.05,
      roas: 2.4,
    },
  ],
} as unknown as ReportDataV1;

describe("weekPeriodLabel", () => {
  it("formats the completed week deterministically in UTC", () => {
    // now = Wed Jun 17 2026 -> completed week Mon Jun 8 .. Sun Jun 14.
    const label = weekPeriodLabel(new Date("2026-06-17T12:00:00.000Z"));
    expect(label).toBe("Jun 8 to Jun 14");
  });
});

describe("renderWeeklyDigestHtml", () => {
  it("includes the subject/headline, a metric value, the attention item, the note, and the /reports link", () => {
    const html = renderWeeklyDigestHtml(mkDigest());
    expect(html).toContain("Here is your receipted-bookings summary for Jun 8 to Jun 14.");
    expect(html).toContain("Receipted bookings");
    expect(html).toContain("12");
    expect(html).toContain("$3,450.00");
    expect(html).toContain("Botox consult");
    expect(html).toContain("1 booking needs attention.");
    expect(html).toContain("https://app.test/reports");
  });

  it("never leaks a raw NaN and emits no en/em dash", () => {
    const html = renderWeeklyDigestHtml(mkDigest());
    expect(html).not.toContain("NaN");
    expect(html).not.toMatch(/[–—]/);
  });

  it("omits the attention section when there is nothing to flag", () => {
    const html = renderWeeklyDigestHtml(mkDigest({ attention: [], attentionNote: null }));
    expect(html).not.toContain("needing attention");
    expect(html).not.toContain("Botox consult");
  });
});

describe("createWeeklyReportDeliveryService", () => {
  function setup(
    opts: {
      recipients?: string[];
      sendResult?: EmailSendResult;
    } = {},
  ) {
    const sent: EmailMessage[] = [];
    const resolveRecipients = vi.fn<(orgId: string) => Promise<string[]>>(() =>
      Promise.resolve(opts.recipients ?? ["owner@clinic.test"]),
    );
    const assembleReport = vi.fn<(orgId: string, now: Date) => Promise<ReportDataV1>>(() =>
      Promise.resolve(fakeReport),
    );
    const sendEmail = vi.fn<(msg: EmailMessage) => Promise<EmailSendResult>>((msg) => {
      sent.push(msg);
      return Promise.resolve(opts.sendResult ?? { ok: true });
    });
    const service = createWeeklyReportDeliveryService({
      resolveRecipients,
      assembleReport,
      sendEmail,
      dashboardUrl: "https://app.test",
      now: () => new Date("2026-06-17T12:00:00.000Z"),
    });
    return { service, resolveRecipients, assembleReport, sendEmail, sent };
  }

  it("delivers: resolves recipients, assembles, sends, returns recipientCount", async () => {
    const { service, assembleReport, sendEmail, sent } = setup({
      recipients: ["a@clinic.test", "b@clinic.test"],
    });

    const result = await service.deliverReport({ orgId: "org_1", actorId: "system" });

    expect(result).toEqual({ status: "delivered", recipientCount: 2 });
    expect(assembleReport).toHaveBeenCalledWith("org_1", new Date("2026-06-17T12:00:00.000Z"));
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const msg = sent[0]!;
    expect(msg.to).toEqual(["a@clinic.test", "b@clinic.test"]);
    expect(typeof msg.subject).toBe("string");
    expect(msg.subject.length).toBeGreaterThan(0);
    expect(msg.html).toContain("https://app.test/reports");
    expect(typeof msg.text).toBe("string");
    expect(msg.text.length).toBeGreaterThan(0);
  });

  it("no_recipients: empty recipient list short-circuits before any send", async () => {
    const { service, assembleReport, sendEmail } = setup({ recipients: [] });

    const result = await service.deliverReport({ orgId: "org_1", actorId: "system" });

    expect(result).toEqual({ status: "no_recipients" });
    expect(assembleReport).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("send_failed: a send_error from the sender surfaces as send_failed with the reason", async () => {
    const { service } = setup({ sendResult: { ok: false, reason: "send_error" } });

    const result = await service.deliverReport({ orgId: "org_1", actorId: "system" });

    expect(result).toEqual({ status: "send_failed", reason: "send_error" });
  });

  it("not_configured: a not_configured sender result maps to its own status", async () => {
    const { service } = setup({ sendResult: { ok: false, reason: "not_configured" } });

    const result = await service.deliverReport({ orgId: "org_1", actorId: "system" });

    expect(result).toEqual({ status: "not_configured" });
  });
});

describe("report link omission (P3-8)", () => {
  it("renderWeeklyDigestHtml omits the link when the dashboard URL is empty", () => {
    const html = renderWeeklyDigestHtml(mkDigest({ dashboardUrl: "" }));
    expect(html).not.toContain("View the full report");
    expect(html).not.toContain("<a href");
  });

  it("renderWeeklyDigestHtml keeps the link when the dashboard URL is present", () => {
    const html = renderWeeklyDigestHtml(mkDigest({ dashboardUrl: "https://app.test/reports" }));
    expect(html).toContain('<a href="https://app.test/reports"');
  });

  it("resolveReportLink appends /reports to a usable absolute base, else returns empty", () => {
    expect(resolveReportLink("https://app.test")).toBe("https://app.test/reports");
    expect(resolveReportLink("http://app.test/")).toBe("http://app.test/reports");
    expect(resolveReportLink("")).toBe("");
    expect(resolveReportLink("   ")).toBe("");
    expect(resolveReportLink("/reports")).toBe("");
    expect(resolveReportLink("app.test")).toBe("");
  });

  it("sends no dead /reports link in the html when DASHBOARD_URL is unset", async () => {
    const sent: EmailMessage[] = [];
    const service = createWeeklyReportDeliveryService({
      resolveRecipients: () => Promise.resolve(["owner@clinic.test"]),
      assembleReport: () => Promise.resolve(fakeReport),
      sendEmail: (msg) => {
        sent.push(msg);
        return Promise.resolve({ ok: true });
      },
      dashboardUrl: "",
      now: () => new Date("2026-06-17T12:00:00.000Z"),
    });

    const result = await service.deliverReport({ orgId: "org_1", actorId: "system" });

    expect(result).toEqual({ status: "delivered", recipientCount: 1 });
    expect(sent[0]!.html).not.toContain("<a href");
    expect(sent[0]!.html).not.toContain("/reports");
  });
});
