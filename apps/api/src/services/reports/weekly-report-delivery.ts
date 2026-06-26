// apps/api/src/services/reports/weekly-report-delivery.ts
// ---------------------------------------------------------------------------
// The weekly owner-report delivery service: resolve recipients -> assemble the
// completed-week ReportDataV1 -> build the slice-1 WeeklyDigest -> render text +
// html -> send via the injected EmailSender. Every collaborator is injected so
// this is pure-unit testable; the handler maps the DeliveryResult to a governed
// outcome. The digest carries only display-ready strings (slice 1 is NaN-safe),
// so this layer does no number or date math beyond the period label.
// ---------------------------------------------------------------------------
import type { ReportDataV1, WeeklyDigest } from "@switchboard/schemas";
import { buildWeeklyDigest, renderWeeklyDigestText } from "@switchboard/core/reports";
import type { EmailSender } from "../notifications/send-email.js";
import { completedWeekRange } from "./assemble-weekly-report.js";

export type DeliveryResult =
  | { status: "delivered"; recipientCount: number }
  | { status: "no_recipients" }
  | { status: "send_failed"; reason: string }
  | { status: "not_configured" };

const MAX_ATTENTION_ITEMS = 5;

const PERIOD_DAY_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
});

/**
 * Deterministic, UTC, display-ready label for the completed week `now` belongs
 * after, e.g. "Jun 8 to Jun 14". The end is exclusive in the range, so the last
 * INCLUDED day is end - 1 day.
 */
export function weekPeriodLabel(now: Date): string {
  const { start, end } = completedWeekRange(now);
  const lastIncluded = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  return `${PERIOD_DAY_FORMAT.format(start)} to ${PERIOD_DAY_FORMAT.format(lastIncluded)}`;
}

/**
 * Minimal HTML escape for the few digest strings that originate from org data
 * (service names, the period label). The numeric/label fields are slice-1
 * literals, but service names are operator-entered, so escape defensively.
 */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The "view report" link is only useful in an email as an ABSOLUTE url: a relative
 * `/reports` (what an empty base produces) has no origin in a mail client, so the
 * link is dead. Return `${base}/reports` when `base` is a usable http(s) origin,
 * otherwise "" so both renderers omit the link entirely (P3-8). A misconfigured
 * absolute base (e.g. localhost in prod) is a deployment-config concern, not handled here.
 */
export function resolveReportLink(base: string): string {
  const trimmed = base.trim();
  if (!/^https?:\/\//i.test(trimmed)) return "";
  return `${trimmed.replace(/\/+$/, "")}/reports`;
}

/**
 * Render a WeeklyDigest as a minimal inline-styled HTML email body. Pure: it does
 * no math and reads only display-ready digest fields, so it can never leak a raw
 * NaN. Contains the headline, the metric list (label + value + optional detail),
 * the attention list, the attention note, and a link to the dashboard report.
 */
export function renderWeeklyDigestHtml(digest: WeeklyDigest): string {
  const metricRows = digest.metrics
    .map((m) => {
      const detail = m.detail
        ? `<div style="color:#6B6560;font-size:13px;margin-top:2px;">${esc(m.detail)}</div>`
        : "";
      return (
        `<tr><td style="padding:8px 0;border-bottom:1px solid #EFEAE4;">` +
        `<div style="color:#1A1714;font-weight:600;">${esc(m.label)}</div>` +
        `<div style="color:#1A1714;font-size:20px;">${esc(m.value)}</div>${detail}` +
        `</td></tr>`
      );
    })
    .join("");

  let attentionBlock = "";
  if (digest.attention.length > 0) {
    const items = digest.attention
      .map(
        (a) =>
          `<li style="margin-bottom:6px;">${esc(a.service)}, ${esc(a.when)}: ` +
          `${esc(a.issues)} (${esc(a.confidence)})</li>`,
      )
      .join("");
    attentionBlock =
      `<h3 style="color:#1A1714;margin-top:24px;">Bookings needing attention</h3>` +
      `<ul style="color:#1A1714;padding-left:18px;margin:8px 0;">${items}</ul>`;
  }

  const note = digest.attentionNote
    ? `<p style="color:#6B6560;font-size:13px;">${esc(digest.attentionNote)}</p>`
    : "";

  // Omit the report CTA entirely when there is no usable absolute URL, rather than
  // emit a dead/relative link in a real owner email (P3-8).
  const reportLink = digest.dashboardUrl
    ? `<p style="margin-top:28px;"><a href="${esc(digest.dashboardUrl)}" ` +
      `style="color:#1A1714;font-weight:600;">View the full report</a></p>`
    : "";

  return (
    `<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:600px;` +
    `margin:0 auto;padding:32px 20px;">` +
    `<p style="color:#1A1714;font-size:16px;">${esc(digest.headline)}</p>` +
    `<table style="width:100%;border-collapse:collapse;margin-top:16px;">${metricRows}</table>` +
    `${attentionBlock}${note}${reportLink}` +
    `</div>`
  );
}

export interface WeeklyReportDeliveryDeps {
  resolveRecipients: (orgId: string) => Promise<string[]>;
  assembleReport: (orgId: string, now: Date) => Promise<ReportDataV1>;
  sendEmail: EmailSender;
  /**
   * Dashboard base URL. When it is a usable absolute http(s) origin the digest
   * links to `${dashboardUrl}/reports`; otherwise the link is omitted (P3-8).
   */
  dashboardUrl: string;
  /** Injectable clock for deterministic tests; defaults to wall-clock. */
  now?: () => Date;
}

export interface WeeklyReportDeliveryService {
  deliverReport(input: { orgId: string; actorId: string }): Promise<DeliveryResult>;
}

export function createWeeklyReportDeliveryService(
  deps: WeeklyReportDeliveryDeps,
): WeeklyReportDeliveryService {
  return {
    async deliverReport(input): Promise<DeliveryResult> {
      const recipients = await deps.resolveRecipients(input.orgId);
      if (recipients.length === 0) {
        // No verified owner inbox: nothing to send. A soft, non-failing outcome.
        return { status: "no_recipients" };
      }

      const now = deps.now?.() ?? new Date();
      const report = await deps.assembleReport(input.orgId, now);
      const periodLabel = weekPeriodLabel(now);
      const digest = buildWeeklyDigest(report, {
        periodLabel,
        dashboardUrl: resolveReportLink(deps.dashboardUrl),
        maxAttentionItems: MAX_ATTENTION_ITEMS,
      });

      const res = await deps.sendEmail({
        to: recipients,
        subject: digest.subject,
        html: renderWeeklyDigestHtml(digest),
        text: renderWeeklyDigestText(digest),
      });

      if (!res.ok) {
        return res.reason === "not_configured"
          ? { status: "not_configured" }
          : { status: "send_failed", reason: res.reason ?? "unknown" };
      }

      return { status: "delivered", recipientCount: recipients.length };
    },
  };
}
