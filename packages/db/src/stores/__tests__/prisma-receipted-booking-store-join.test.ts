// ---------------------------------------------------------------------------
// PrismaReceiptedBookingStore — booking → WorkTrace join regression guard (EV-1)
//
// Real-Postgres integration suite. Requires DATABASE_URL (CI: the "Integration —
// Real Postgres" job; see vitest.integration.config.ts). Skips when unset, so it
// no-ops in every Postgres-free lane.
//
// Guards the #1269 fix: the receipted-booking view joins Booking.workTraceId →
// WorkTrace.workUnitId (the @unique business key), NOT WorkTrace.id (the cuid PK).
// Booking.workTraceId stores ctx.workUnitId (calendar-book.ts / channel-gateway.ts),
// which equals WorkTrace.workUnitId — joining on `id` never matched, leaving
// traceId / matchedPolicies / humanApprovalId null for every booking.
//
// The mocked unit suite (prisma-receipted-booking-store.test.ts) stubs
// workTrace.findFirst, so the join COLUMN is invisible there — only a real Postgres
// read distinguishes a workUnitId join from an id join. That distinction is the
// whole point of this suite: every WorkTrace below is seeded with id, workUnitId,
// and traceId all DISTINCT, so an id-keyed join surfaces null (or, with the decoy,
// the WRONG trace), failing the assertions.
// ---------------------------------------------------------------------------

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaReceiptedBookingStore } from "../prisma-receipted-booking-store.js";

const ORG_ID = "test-org:ev1-booking-join";

// Seed a WorkTrace with caller-chosen id / workUnitId / traceId / approvalId so the
// join column under test is observable. Only the fields the view selects matter; the
// rest are plausible filler to satisfy the non-null schema columns.
async function seedWorkTrace(
  prisma: PrismaClient,
  fields: {
    id: string;
    workUnitId: string;
    traceId: string;
    matchedPolicies: string;
    approvalId: string | null;
  },
): Promise<void> {
  const at = new Date("2026-06-15T00:00:00Z");
  await prisma.workTrace.create({
    data: {
      id: fields.id,
      workUnitId: fields.workUnitId,
      traceId: fields.traceId,
      intent: "calendar.book",
      mode: "execute",
      organizationId: ORG_ID,
      actorId: "agent:alex",
      actorType: "agent",
      trigger: "internal",
      governanceOutcome: "approved",
      riskScore: 0.1,
      matchedPolicies: fields.matchedPolicies,
      approvalId: fields.approvalId,
      outcome: "completed",
      durationMs: 12,
      requestedAt: at,
      governanceCompletedAt: at,
    },
  });
}

// Seed a Booking whose workTraceId carries the WorkTrace.workUnitId value (mirrors the
// producer: Booking.workTraceId = ctx.workUnitId). A non-existent contactId is fine —
// the Contact leg resolves to null and the view still assembles.
async function seedBooking(prisma: PrismaClient, workTraceId: string | null): Promise<string> {
  const startsAt = new Date("2026-06-16T02:00:00Z");
  const row = await prisma.booking.create({
    data: {
      organizationId: ORG_ID,
      contactId: "ct:ev1-booking-join",
      service: "Botox consult",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      workTraceId,
    },
    select: { id: true },
  });
  return row.id;
}

describe.skipIf(!process.env["DATABASE_URL"])(
  "PrismaReceiptedBookingStore — booking→WorkTrace join (EV-1 regression guard)",
  () => {
    const prisma = new PrismaClient();
    const store = new PrismaReceiptedBookingStore(prisma);

    beforeAll(async () => {
      await prisma.$connect();
    });

    afterEach(async () => {
      // Booking.workTraceId is a bare String column (no Prisma relation), so delete
      // order is unconstrained; clean both legs for the test org.
      await prisma.booking.deleteMany({ where: { organizationId: ORG_ID } });
      await prisma.workTrace.deleteMany({ where: { organizationId: ORG_ID } });
    });

    afterAll(async () => {
      await prisma.$disconnect();
    });

    it("joins on WorkTrace.workUnitId — surfaces traceId / matchedPolicies / humanApprovalId from the seeded trace", async () => {
      // DISTINCT keys: a wrong-column join on `id` (where the column value equals the
      // Booking.workTraceId = workUnitId) matches no row, surfacing null for all three.
      const wtId = "ev1-wt-id-PRIMARY";
      const workUnitId = "ev1-wu-PRIMARY";
      const traceId = "ev1-trace-PRIMARY";
      const approvalId = "ev1-approval-PRIMARY";
      const matchedPolicies = '["policy:ev1-primary"]';
      // Invariant guard: if the seed ever lets id == workUnitId, an id-keyed join would
      // coincidentally match and this suite would stop catching the regression.
      expect(wtId).not.toBe(workUnitId);

      await seedWorkTrace(prisma, {
        id: wtId,
        workUnitId,
        traceId,
        matchedPolicies,
        approvalId,
      });
      // Booking.workTraceId carries the workUnitId, NOT the id PK.
      const bookingId = await seedBooking(prisma, workUnitId);

      const view = await store.getView(ORG_ID, bookingId);

      expect(view).not.toBeNull();
      // The three fields the join surfaces — non-null proves the join keyed on workUnitId.
      expect(view?.traceId).toBe(traceId);
      expect(view?.matchedPolicies).toBe(matchedPolicies);
      expect(view?.humanApprovalId).toBe(approvalId);
    });

    it("does NOT surface a decoy WorkTrace whose id equals Booking.workTraceId (an id-keyed join would leak the wrong trace)", async () => {
      // The correct trace: matched by workUnitId.
      const correct = {
        id: "ev1-wt-id-CORRECT",
        workUnitId: "ev1-wu-SHARED",
        traceId: "ev1-trace-CORRECT",
        approvalId: "ev1-approval-CORRECT",
        matchedPolicies: '["policy:ev1-correct"]',
      };
      // The decoy: its PRIMARY KEY (id) equals the Booking.workTraceId value, so an
      // id-keyed join would match the decoy and surface the WRONG trace's fields. Its
      // workUnitId is something else, so the correct workUnitId-keyed join skips it.
      const decoy = {
        id: "ev1-wu-SHARED",
        workUnitId: "ev1-wu-DECOY",
        traceId: "ev1-trace-DECOY",
        approvalId: "ev1-approval-DECOY",
        matchedPolicies: '["policy:ev1-decoy"]',
      };
      expect(decoy.id).toBe(correct.workUnitId);
      expect(decoy.id).not.toBe(correct.id);

      await seedWorkTrace(prisma, correct);
      await seedWorkTrace(prisma, decoy);
      const bookingId = await seedBooking(prisma, correct.workUnitId);

      const view = await store.getView(ORG_ID, bookingId);

      expect(view).not.toBeNull();
      // Sharper than a null check: an id-keyed join returns the DECOY row's data, so
      // asserting the CORRECT trace's values catches the regression even when the wrong
      // column has a (decoy) match.
      expect(view?.traceId).toBe(correct.traceId);
      expect(view?.matchedPolicies).toBe(correct.matchedPolicies);
      expect(view?.humanApprovalId).toBe(correct.approvalId);
      expect(view?.traceId).not.toBe(decoy.traceId);
    });

    it("surfaces a null trace trio when the booking has no workTraceId", async () => {
      // No trace linked → the join leg short-circuits and the view exposes nulls.
      const bookingId = await seedBooking(prisma, null);

      const view = await store.getView(ORG_ID, bookingId);

      expect(view).not.toBeNull();
      expect(view?.traceId).toBeNull();
      expect(view?.matchedPolicies).toBeNull();
      expect(view?.humanApprovalId).toBeNull();
    });
  },
);
