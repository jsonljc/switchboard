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
