import { randomUUID } from "node:crypto";
import type { PrismaDbClient } from "../prisma-db.js";
import type { Receipt, ReceiptEvidence } from "@switchboard/schemas";
import type { MintReceiptInput, ReceiptStore } from "@switchboard/core";

// Structural match with @switchboard/core ReceiptStore (db imports core types directly;
// the local re-import keeps the impl decoupled from core internals, mirroring
// prisma-revenue-store.ts). If drift becomes a problem, hoist into @switchboard/schemas.

export class PrismaReceiptStore implements ReceiptStore {
  constructor(private prisma: PrismaDbClient) {}

  async mint(input: MintReceiptInput, tx?: PrismaDbClient): Promise<Receipt> {
    const client = tx ?? this.prisma;
    // Idempotency: an externally-referenced receipt (PSP chargeId / external event id) dedupes on
    // the (organizationId, kind, externalRef) partial-unique. A replayed charge must be a no-op,
    // not a P2002 tx-abort. Calendar receipts have a NULL externalRef (dedup is a 1B concern), so
    // they skip this guard. We findFirst-before-create rather than catch P2002, because mint runs
    // inside the handler's $transaction and Postgres aborts the tx on first error; a rare concurrent
    // replay loser aborts and the PSP retry then no-ops here.
    if (input.externalRef) {
      const existing = await client.receipt.findFirst({
        where: {
          organizationId: input.organizationId,
          kind: input.kind,
          externalRef: input.externalRef,
        },
      });
      if (existing) return mapRowToReceipt(existing);
    }

    const created = await client.receipt.create({
      data: {
        id: randomUUID(),
        organizationId: input.organizationId,
        kind: input.kind,
        tier: input.tier,
        status: input.status,
        bookingId: input.bookingId ?? null,
        opportunityId: input.opportunityId ?? null,
        revenueEventId: input.revenueEventId ?? null,
        connectionId: input.connectionId ?? null,
        provider: input.provider ?? null,
        externalRef: input.externalRef ?? null,
        amount: input.amount ?? null,
        currency: input.currency ?? null,
        evidence: input.evidence,
        capturedBy: input.capturedBy,
        verifiedAt: input.verifiedAt ?? null,
        workTraceId: input.workTraceId ?? null,
      },
    });
    return mapRowToReceipt(created);
  }

  /**
   * Promote a booking's calendar receipt booked -> held once attendance is confirmed.
   * Scoped to (org, booking, kind=calendar, status=booked) so it never touches a payment
   * receipt, a void, or an already-held row, and stays org-isolated. Returns the number of
   * rows promoted. Unlike recordAttendance, a zero count is a legitimate no-op (a booking may
   * carry no calendar receipt yet, or attendance was re-recorded) — best-effort, never throws.
   */
  async promoteCalendarBookedToHeld(organizationId: string, bookingId: string): Promise<number> {
    const result = await this.prisma.receipt.updateMany({
      where: {
        organizationId,
        bookingId,
        kind: "calendar",
        status: "booked",
      },
      data: { status: "held" },
    });
    return result.count;
  }

  async findByBooking(orgId: string, bookingId: string): Promise<Receipt[]> {
    const rows = await this.prisma.receipt.findMany({
      where: { organizationId: orgId, bookingId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(mapRowToReceipt);
  }

  /**
   * Receipted-bookings north-star count: non-void CALENDAR receipts (status booked|held) created
   * in [from, to), org-scoped. A calendar receipt is minted at booking time, so each one is a
   * booking that produced a proof receipt. Scalar count, mirroring countMaturedAttendance.
   * Org-scoped per the F12 read-side IDOR lesson; voids (status "void") are excluded by the
   * booked|held filter.
   */
  async countReceiptedBookingsInWindow(input: {
    orgId: string;
    from: Date;
    to: Date;
  }): Promise<number> {
    // Count DISTINCT bookings, not rows: calendar receipts carry a NULL externalRef, so the
    // (org, kind, externalRef) partial-unique does NOT dedupe them — a confirm-failure + same-slot
    // retry can mint a second "booked" receipt for one booking (see mint-calendar-receipt.ts). As
    // the first receipt-counting consumer we must dedupe by bookingId or the metric over-reports.
    const rows = await this.prisma.receipt.findMany({
      where: {
        organizationId: input.orgId,
        kind: "calendar",
        status: { in: ["booked", "held"] },
        createdAt: { gte: input.from, lt: input.to },
        bookingId: { not: null },
      },
      select: { bookingId: true },
      distinct: ["bookingId"],
    });
    return rows.length;
  }
}

interface ReceiptRow {
  id: string;
  organizationId: string;
  kind: string;
  tier: string;
  status: string;
  bookingId: string | null;
  opportunityId: string | null;
  revenueEventId: string | null;
  connectionId: string | null;
  provider: string | null;
  externalRef: string | null;
  amount: number | null;
  currency: string | null;
  evidence: unknown;
  capturedBy: string;
  verifiedAt: Date | null;
  workTraceId: string | null;
  createdAt: Date;
}

function mapRowToReceipt(row: ReceiptRow): Receipt {
  return {
    id: row.id,
    organizationId: row.organizationId,
    kind: row.kind as Receipt["kind"],
    tier: row.tier as Receipt["tier"],
    status: row.status as Receipt["status"],
    bookingId: row.bookingId,
    opportunityId: row.opportunityId,
    revenueEventId: row.revenueEventId,
    connectionId: row.connectionId,
    provider: row.provider,
    externalRef: row.externalRef,
    amount: row.amount,
    currency: row.currency,
    evidence: row.evidence as ReceiptEvidence,
    capturedBy: row.capturedBy,
    verifiedAt: row.verifiedAt,
    workTraceId: row.workTraceId,
    createdAt: row.createdAt,
  };
}
