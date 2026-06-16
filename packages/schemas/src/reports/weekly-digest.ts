/**
 * Weekly owner-report digest: the presentation-ready content model for Ledger-lite v1.
 *
 * A WeeklyDigest is built purely from a ReportDataV1 (by core's buildWeeklyDigest) and rendered
 * to text/html by the delivery layer. It carries only display-ready strings: every figure is
 * already formatted and NaN-safe, so the renderer does no number or date math and cannot leak a
 * raw NaN. This is the trustworthy weekly summary the owner receives by email.
 *
 * Source fields (all from ReportDataV1): receiptedBookings, receiptedBookingRevenue,
 * receiptedBookingQuality (incl. the worklist), heldRate, consentCompleteness.
 */

/** One headline figure in the digest body. `value` and `detail` are display-ready and NaN-safe. */
export interface WeeklyDigestMetric {
  /** Stable machine key for ordering and tests, e.g. "receipted_bookings". */
  key: string;
  /** Human label, e.g. "Receipted bookings". */
  label: string;
  /** Display-ready primary figure, e.g. "12", "$3,450.00", "62%", or "no data yet". */
  value: string;
  /** Optional supporting line, display-ready, e.g. "38 of 45 attended". */
  detail?: string;
}

/** One bookings-needing-attention row, mapped from a ReceiptedBookingWorklistItem for the owner. */
export interface WeeklyDigestAttentionItem {
  /** The booked service, e.g. "Botox consult". */
  service: string;
  /** Appointment day, display-ready in UTC, e.g. "Tue, Jun 9". */
  when: string;
  /** Attribution-confidence label, e.g. "unattributed". */
  confidence: string;
  /** Open exception codes, human-labeled and comma-joined, e.g. "missing source". */
  issues: string;
}

/** The full owner-facing weekly digest content model. */
export interface WeeklyDigest {
  /** Email subject, e.g. "Your week: 12 receipted bookings, $3,450.00 booked". */
  subject: string;
  /** Body headline line, e.g. "Here is your receipted-bookings summary for Jun 9 to Jun 15." */
  headline: string;
  /** The period covered, display-ready, e.g. "Jun 9 to Jun 15". */
  periodLabel: string;
  /** Ordered headline metrics (receipted bookings, revenue, attribution quality, attention, held, consent). */
  metrics: WeeklyDigestMetric[];
  /** The bookings-needing-attention drill-down (may be empty). */
  attention: WeeklyDigestAttentionItem[];
  /** Honest "showing first N of M" note; null when nothing needs attention. */
  attentionNote: string | null;
  /** Absolute link to the full dashboard report. */
  dashboardUrl: string;
}
