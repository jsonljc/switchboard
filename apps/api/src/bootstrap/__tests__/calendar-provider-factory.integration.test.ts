import { describe, it, expect } from "vitest";
import { PrismaClient, PrismaBookingStore } from "@switchboard/db";
import { buildLocalStore } from "../calendar-provider-factory.js";

// Real-Postgres concurrency proof for F12. Fires CONCURRENCY simultaneous local-calendar
// bookings for the SAME slot but DIFFERENT patients (different contactId). With the advisory
// lock, exactly one wins and the rest get SLOT_CONFLICT, leaving exactly one Booking row.
// Different contactIds ensure the active-booking partial-unique index is not what fires; the
// advisory lock is. Booking has no foreign keys (verified against the live schema), so
// free-string org/contact ids are safe and cleanup is a deleteMany.
//
// Double-gated: needs a real DATABASE_URL AND an explicit RUN_DB_INTEGRATION=1 opt-in, because
// it writes and deletes real rows. CI (no Postgres, no opt-in) skips it; it never blocks a merge.
const DB_INTEGRATION_ENABLED =
  !!process.env["DATABASE_URL"] && process.env["RUN_DB_INTEGRATION"] === "1";

describe.skipIf(!DB_INTEGRATION_ENABLED)(
  "buildLocalStore.createInTransaction concurrency (integration, F12)",
  () => {
    it("N concurrent same-slot bookings for different patients yield exactly one success", async () => {
      const CONCURRENCY = 8;
      const prisma = new PrismaClient();
      const orgId = `f12-it-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const store = buildLocalStore(prisma, orgId);

      const startsAt = new Date("2026-09-01T02:00:00.000Z");
      const endsAt = new Date("2026-09-01T03:00:00.000Z");

      const bookFor = (n: number) =>
        store.createInTransaction({
          organizationId: orgId,
          contactId: `patient-${n}`,
          service: "consultation",
          startsAt,
          endsAt,
          timezone: "Asia/Singapore",
          status: "confirmed",
          calendarEventId: `local-${n}`,
          createdByType: "agent",
        });

      try {
        const results = await Promise.allSettled(
          Array.from({ length: CONCURRENCY }, (_, n) => bookFor(n)),
        );

        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const rejected = results.filter((r) => r.status === "rejected");

        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(CONCURRENCY - 1);
        for (const r of rejected) {
          const reason = (r as PromiseRejectedResult).reason as Error;
          expect(reason).toBeInstanceOf(Error);
          expect(reason.message).toBe("SLOT_CONFLICT");
        }

        const rows = await prisma.booking.findMany({ where: { organizationId: orgId } });
        expect(rows).toHaveLength(1);
      } finally {
        await prisma.booking.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
        await prisma.$disconnect();
      }
    });
  },
);

// Companion proof for the durable store. The same advisory-lock cast bug (Prisma sends the
// namespace as bigint; pg_advisory_xact_lock(bigint, integer) does not exist) was latent in
// PrismaBookingStore.create, which mocks $executeRaw in its unit tests and so never exercised
// the lock against real Postgres. With the ::int4 cast the durable booking write serializes too.
describe.skipIf(!DB_INTEGRATION_ENABLED)(
  "PrismaBookingStore.create concurrency (integration, F12 lock cast)",
  () => {
    it("N concurrent same-slot bookings for different patients yield exactly one success", async () => {
      const CONCURRENCY = 8;
      const prisma = new PrismaClient();
      const store = new PrismaBookingStore(prisma);
      const orgId = `f12-pbs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const startsAt = new Date("2026-09-03T02:00:00.000Z");
      const endsAt = new Date("2026-09-03T03:00:00.000Z");

      const bookFor = (n: number) =>
        store.create({
          organizationId: orgId,
          contactId: `patient-${n}`,
          service: "consultation",
          startsAt,
          endsAt,
        });

      try {
        const results = await Promise.allSettled(
          Array.from({ length: CONCURRENCY }, (_, n) => bookFor(n)),
        );

        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const rejected = results.filter((r) => r.status === "rejected");

        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(CONCURRENCY - 1);
        for (const r of rejected) {
          const reason = (r as PromiseRejectedResult).reason as { code?: string };
          expect(reason.code).toBe("SLOT_CONFLICT");
        }

        const rows = await prisma.booking.findMany({ where: { organizationId: orgId } });
        expect(rows).toHaveLength(1);
      } finally {
        await prisma.booking.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
        await prisma.$disconnect();
      }
    });
  },
);

// Finding A (race): two concurrent reschedules of two different bookings onto the SAME free
// slot for one org. The advisory lock serializes them; exactly one wins and the other gets
// SLOT_CONFLICT, so the target slot is never double-held and the loser stays put.
describe.skipIf(!DB_INTEGRATION_ENABLED)(
  "buildLocalStore.reschedule concurrency (integration, F12 follow-up)",
  () => {
    it("two concurrent reschedules onto one slot yield exactly one success + one SLOT_CONFLICT", async () => {
      const prisma = new PrismaClient();
      const orgId = `f12r-it-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const store = buildLocalStore(prisma, orgId);

      const slotA = { start: "2026-09-05T02:00:00.000Z", end: "2026-09-05T03:00:00.000Z" };
      const slotB = { start: "2026-09-05T04:00:00.000Z", end: "2026-09-05T05:00:00.000Z" };
      const target = { start: "2026-09-05T06:00:00.000Z", end: "2026-09-05T07:00:00.000Z" };

      const mk = (n: number, slot: { start: string; end: string }) =>
        store.createInTransaction({
          organizationId: orgId,
          contactId: `patient-${n}`,
          service: "consultation",
          startsAt: new Date(slot.start),
          endsAt: new Date(slot.end),
          timezone: "Asia/Singapore",
          status: "confirmed",
          calendarEventId: `local-${n}`,
          createdByType: "agent",
        });

      try {
        const a = await mk(1, slotA);
        const b = await mk(2, slotB);

        const results = await Promise.allSettled([
          store.reschedule(a.id, target),
          store.reschedule(b.id, target),
        ]);

        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const rejected = results.filter((r) => r.status === "rejected");
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        const reason = (rejected[0] as PromiseRejectedResult).reason as Error;
        expect(reason).toBeInstanceOf(Error);
        expect(reason.message).toBe("SLOT_CONFLICT");

        // The target slot is held by exactly one LIVE booking (not double-held).
        const inTarget = await prisma.booking.findMany({
          where: {
            organizationId: orgId,
            status: { notIn: ["cancelled", "failed"] },
            startsAt: { lt: new Date(target.end) },
            endsAt: { gt: new Date(target.start) },
          },
        });
        expect(inTarget).toHaveLength(1);

        // The loser is byte-for-byte unchanged at its original slot.
        const all = await prisma.booking.findMany({ where: { organizationId: orgId } });
        expect(all).toHaveLength(2);
        const winners = all.filter((r) => r.startsAt.toISOString() === target.start);
        const losers = all.filter((r) => r.startsAt.toISOString() !== target.start);
        expect(winners).toHaveLength(1);
        expect(winners[0]!.rescheduleCount).toBe(1);
        expect(losers).toHaveLength(1);
        expect(losers[0]!.rescheduleCount).toBe(0);
        expect([slotA.start, slotB.start]).toContain(losers[0]!.startsAt.toISOString());
      } finally {
        await prisma.booking.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
        await prisma.$disconnect();
      }
    });
  },
);

// Finding B (IDOR): a store bound to org-B must not reschedule or cancel org-A's booking.
// Both reject (BOOKING_NOT_FOUND, not a silent no-op) and org-A's row stays untouched; org-A
// can still reschedule it, proving the guard is org-scoping, not a freeze.
describe.skipIf(!DB_INTEGRATION_ENABLED)(
  "buildLocalStore reschedule/cancel cross-org isolation (integration, F12 follow-up)",
  () => {
    it("org-B cannot reschedule or cancel org-A's booking; org-A's row is untouched", async () => {
      const prisma = new PrismaClient();
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const orgA = `f12x-a-${suffix}`;
      const orgB = `f12x-b-${suffix}`;
      const storeA = buildLocalStore(prisma, orgA);
      const storeB = buildLocalStore(prisma, orgB);

      const slot = { start: "2026-09-07T02:00:00.000Z", end: "2026-09-07T03:00:00.000Z" };
      const newSlot = { start: "2026-09-07T08:00:00.000Z", end: "2026-09-07T09:00:00.000Z" };

      try {
        const created = await storeA.createInTransaction({
          organizationId: orgA,
          contactId: "patient-a",
          service: "consultation",
          startsAt: new Date(slot.start),
          endsAt: new Date(slot.end),
          timezone: "Asia/Singapore",
          status: "confirmed",
          calendarEventId: "local-a",
          createdByType: "agent",
        });

        await expect(storeB.reschedule(created.id, newSlot)).rejects.toThrow("BOOKING_NOT_FOUND");
        await expect(storeB.cancel(created.id)).rejects.toThrow("BOOKING_NOT_FOUND");

        const row = await prisma.booking.findUnique({ where: { id: created.id } });
        expect(row).not.toBeNull();
        expect(row!.startsAt.toISOString()).toBe(slot.start);
        expect(row!.endsAt.toISOString()).toBe(slot.end);
        expect(row!.status).toBe("confirmed");
        expect(row!.rescheduleCount).toBe(0);

        // org-A can still reschedule its own booking (guard is org-scoping, not a freeze).
        const moved = await storeA.reschedule(created.id, newSlot);
        expect(moved).toEqual({ id: created.id });
        const after = await prisma.booking.findUnique({ where: { id: created.id } });
        expect(after!.startsAt.toISOString()).toBe(newSlot.start);
        expect(after!.rescheduleCount).toBe(1);
      } finally {
        await prisma.booking
          .deleteMany({ where: { organizationId: { in: [orgA, orgB] } } })
          .catch(() => {});
        await prisma.$disconnect();
      }
    });
  },
);
