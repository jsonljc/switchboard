import { describe, it, expect } from "vitest";
import { PrismaClient, PrismaBookingStore } from "@switchboard/db";
import { LocalCalendarProvider } from "@switchboard/core/calendar";
import {
  buildRescheduleOperations,
  createCalendarBookToolFactory,
} from "@switchboard/core/skill-runtime";
import type { BusinessHoursConfig } from "@switchboard/schemas";
import { buildLocalStore } from "../calendar-provider-factory.js";
import { isNoopCalendarProvider } from "../noop-calendar-provider.js";
import { receiptTierForCalendarProvider } from "../receipt-tier.js";

// Gated real-Postgres proofs for the local-calendar booking seams (F12 + #1018 + the create
// double-write fix). Double-gated: needs a real DATABASE_URL AND an explicit RUN_DB_INTEGRATION=1
// opt-in, because they write and delete real rows. CI (no Postgres, no opt-in) skips them; they
// never block a merge. Booking has no foreign keys (verified against the live schema), so
// free-string org/contact ids are safe and cleanup is a deleteMany.
const DB_INTEGRATION_ENABLED =
  !!process.env["DATABASE_URL"] && process.env["RUN_DB_INTEGRATION"] === "1";

const BUSINESS_HOURS: BusinessHoursConfig = {
  timezone: "Asia/Singapore",
  days: [
    { day: 1, open: "00:00", close: "23:59" },
    { day: 2, open: "00:00", close: "23:59" },
    { day: 3, open: "00:00", close: "23:59" },
    { day: 4, open: "00:00", close: "23:59" },
    { day: 5, open: "00:00", close: "23:59" },
  ],
  defaultDurationMinutes: 60,
  bufferMinutes: 0,
  slotIncrementMinutes: 60,
};

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

// Migrated from the deleted buildLocalStore reschedule proofs: the F12 reschedule guarantees
// now live on the durable PrismaBookingStore, which is the store that actually runs in
// production (skill-mode.ts wires `new PrismaBookingStore(...)` as the reschedule tool's
// bookingStore). Two concurrent reschedules onto one slot: the advisory lock serializes them,
// exactly one wins and the other gets the TYPED conflict; the loser stays put.
describe.skipIf(!DB_INTEGRATION_ENABLED)(
  "PrismaBookingStore.reschedule concurrency (integration, F12 on the live path)",
  () => {
    it("two concurrent reschedules onto one slot yield exactly one success + one typed conflict", async () => {
      const prisma = new PrismaClient();
      const store = new PrismaBookingStore(prisma);
      const orgId = `f12pr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const slotA = {
        startsAt: new Date("2026-10-05T02:00:00.000Z"),
        endsAt: new Date("2026-10-05T03:00:00.000Z"),
      };
      const slotB = {
        startsAt: new Date("2026-10-05T04:00:00.000Z"),
        endsAt: new Date("2026-10-05T05:00:00.000Z"),
      };
      const target = {
        startsAt: new Date("2026-10-05T06:00:00.000Z"),
        endsAt: new Date("2026-10-05T07:00:00.000Z"),
      };

      try {
        const a = await store.create({
          organizationId: orgId,
          contactId: "p1",
          service: "consultation",
          ...slotA,
        });
        const b = await store.create({
          organizationId: orgId,
          contactId: "p2",
          service: "consultation",
          ...slotB,
        });

        const results = await Promise.allSettled([
          store.reschedule(orgId, a.id, target),
          store.reschedule(orgId, b.id, target),
        ]);

        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const rejected = results.filter((r) => r.status === "rejected");
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        const reason = (rejected[0] as PromiseRejectedResult).reason as { code?: string };
        expect(reason.code).toBe("SLOT_CONFLICT");

        const inTarget = await prisma.booking.findMany({
          where: {
            organizationId: orgId,
            status: { notIn: ["cancelled", "failed"] },
            startsAt: { lt: target.endsAt },
            endsAt: { gt: target.startsAt },
          },
        });
        expect(inTarget).toHaveLength(1);
        expect(inTarget[0]!.rescheduleCount).toBe(1);

        const all = await prisma.booking.findMany({ where: { organizationId: orgId } });
        const losers = all.filter(
          (r) => r.startsAt.toISOString() !== target.startsAt.toISOString(),
        );
        expect(losers).toHaveLength(1);
        expect(losers[0]!.rescheduleCount).toBe(0);
      } finally {
        await prisma.booking.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
        await prisma.$disconnect();
      }
    });
  },
);

// Migrated cross-org IDOR proof: a reschedule/cancel for the wrong org rejects (count===0
// guard), not a silent no-op, and the row stays untouched; the owning org can still act.
describe.skipIf(!DB_INTEGRATION_ENABLED)(
  "PrismaBookingStore reschedule/cancel cross-org isolation (integration, F12 on the live path)",
  () => {
    it("org-B cannot reschedule or cancel org-A's booking; org-A still can", async () => {
      const prisma = new PrismaClient();
      const store = new PrismaBookingStore(prisma);
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const orgA = `f12px-a-${suffix}`;
      const orgB = `f12px-b-${suffix}`;

      const slot = {
        startsAt: new Date("2026-10-07T02:00:00.000Z"),
        endsAt: new Date("2026-10-07T03:00:00.000Z"),
      };
      const newSlot = {
        startsAt: new Date("2026-10-07T08:00:00.000Z"),
        endsAt: new Date("2026-10-07T09:00:00.000Z"),
      };

      try {
        const a = await store.create({
          organizationId: orgA,
          contactId: "pa",
          service: "consultation",
          ...slot,
        });

        await expect(store.reschedule(orgB, a.id, newSlot)).rejects.toThrow();
        await expect(store.cancel(orgB, a.id)).rejects.toThrow();

        const row = await prisma.booking.findUnique({ where: { id: a.id } });
        expect(row!.startsAt.toISOString()).toBe(slot.startsAt.toISOString());
        expect(row!.rescheduleCount).toBe(0);
        expect(row!.status).not.toBe("cancelled");

        const moved = await store.reschedule(orgA, a.id, newSlot);
        expect(moved.id).toBe(a.id);
        const after = await prisma.booking.findUnique({ where: { id: a.id } });
        expect(after!.startsAt.toISOString()).toBe(newSlot.startsAt.toISOString());
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

// Read-side cross-org isolation (this slice, F12 read-scoping leg): a read keyed to the wrong org
// returns null for BOTH the per-org local store (buildLocalStore, the getBooking read path) and the
// durable PrismaBookingStore.findById; the owning org still reads the row. Mirrors the write-path proof.
describe.skipIf(!DB_INTEGRATION_ENABLED)(
  "calendar booking read-side cross-org isolation (integration, F12 read-scoping)",
  () => {
    it("a findById keyed to another org returns null; the owning org still reads it", async () => {
      const prisma = new PrismaClient();
      const durable = new PrismaBookingStore(prisma);
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const orgA = `f12rd-a-${suffix}`;
      const orgB = `f12rd-b-${suffix}`;

      try {
        const a = await durable.create({
          organizationId: orgA,
          contactId: "pa",
          service: "consultation",
          startsAt: new Date("2026-10-09T02:00:00.000Z"),
          endsAt: new Date("2026-10-09T03:00:00.000Z"),
        });

        // Durable store: org B cannot read org A's booking; org A can.
        expect(await durable.findById(orgB, a.id)).toBeNull();
        expect((await durable.findById(orgA, a.id))?.id).toBe(a.id);

        // Per-org local store (the getBooking read path): org B's store returns null; org A's returns it.
        expect(await buildLocalStore(prisma, orgB).findById(a.id)).toBeNull();
        expect((await buildLocalStore(prisma, orgA).findById(a.id))?.id).toBe(a.id);
      } finally {
        await prisma.booking
          .deleteMany({ where: { organizationId: { in: [orgA, orgB] } } })
          .catch(() => {});
        await prisma.$disconnect();
      }
    });
  },
);

// THE RESCHEDULE BUG-FIX PROOF (#1018): drive the reschedule TOOL exactly as production wires it
// for a no-PMS org (a real LocalCalendarProvider whose rescheduleBooking is a no-op, plus a real
// PrismaBookingStore as the durable bookingStore). The row moves once (no double-count) and a
// genuine clash is re-offered retryably instead of escalating. Bookings are seeded via the durable
// create + confirm (the production single-writer flow) now that createInTransaction is gone.
describe.skipIf(!DB_INTEGRATION_ENABLED)(
  "calendar.reschedule end-to-end for a local provider (integration)",
  () => {
    function wire(prisma: PrismaClient, orgId: string, contactId: string) {
      const localStore = buildLocalStore(prisma, orgId);
      const durable = new PrismaBookingStore(prisma);
      const ops = buildRescheduleOperations({ orgId, contactId } as never, {
        calendarProviderFactory: async () =>
          new LocalCalendarProvider({ businessHours: BUSINESS_HOURS, bookingStore: localStore }),
        isCalendarProviderConfigured: () => true,
        bookingStore: durable,
      });
      return { localStore, durable, ops };
    }

    it("moves the booking row exactly once via the durable store", async () => {
      const prisma = new PrismaClient();
      const orgId = `f12e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const contactId = "patient-e2e";
      const { durable, ops } = wire(prisma, orgId, contactId);
      try {
        const created = await durable.create({
          organizationId: orgId,
          contactId,
          service: "consultation",
          startsAt: new Date("2026-11-01T02:00:00.000Z"),
          endsAt: new Date("2026-11-01T03:00:00.000Z"),
        });
        await durable.confirm(orgId, created.id, "local-e2e-1");

        const res = await ops["booking.reschedule"]!.execute({
          slotStart: "2026-11-01T06:00:00.000Z",
          slotEnd: "2026-11-01T07:00:00.000Z",
          calendarId: "local",
        });

        expect(res.status).toBe("success");
        const row = await prisma.booking.findUnique({ where: { id: created.id } });
        expect(row!.startsAt.toISOString()).toBe("2026-11-01T06:00:00.000Z");
        expect(row!.endsAt.toISOString()).toBe("2026-11-01T07:00:00.000Z");
        // Single write: no double-increment from a redundant provider write.
        expect(row!.rescheduleCount).toBe(1);
      } finally {
        await prisma.booking.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
        await prisma.$disconnect();
      }
    });

    it("returns retryable SLOT_TAKEN and leaves the booking put when the target is held", async () => {
      const prisma = new PrismaClient();
      const orgId = `f12e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const contactId = "patient-mover";
      const { durable, ops } = wire(prisma, orgId, contactId);
      try {
        const mover = await durable.create({
          organizationId: orgId,
          contactId,
          service: "consultation",
          startsAt: new Date("2026-11-03T02:00:00.000Z"),
          endsAt: new Date("2026-11-03T03:00:00.000Z"),
        });
        await durable.confirm(orgId, mover.id, "local-mover");
        // A different patient already holds the target slot.
        const holder = await durable.create({
          organizationId: orgId,
          contactId: "patient-holder",
          service: "consultation",
          startsAt: new Date("2026-11-03T06:00:00.000Z"),
          endsAt: new Date("2026-11-03T07:00:00.000Z"),
        });
        await durable.confirm(orgId, holder.id, "local-holder");

        const res = await ops["booking.reschedule"]!.execute({
          slotStart: "2026-11-03T06:00:00.000Z",
          slotEnd: "2026-11-03T07:00:00.000Z",
          calendarId: "local",
        });

        expect(res.status).toBe("error");
        expect(res.error?.code).toBe("SLOT_TAKEN");
        expect(res.error?.retryable).toBe(true);
        // The mover's booking is untouched at its original slot.
        const row = await prisma.booking.findUnique({ where: { id: mover.id } });
        expect(row!.startsAt.toISOString()).toBe("2026-11-03T02:00:00.000Z");
        expect(row!.rescheduleCount).toBe(0);
      } finally {
        await prisma.booking.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
        await prisma.$disconnect();
      }
    });
  },
);

// THE CREATE BUG-FIX PROOF: drive the real booking.create tool exactly as production wires it for a
// no-PMS org (a real LocalCalendarProvider that mints a local-<uuid> without a DB write, plus a real
// PrismaBookingStore as the durable single writer). Before this slice the provider inserted a SECOND
// row whose org-wide overlap matched the durable step-1 row and threw, so every local booking died
// with a non-retryable BOOKING_FAILURE and a failed orphan. Now exactly one confirmed row persists,
// and a genuine clash is re-offered retryably instead of escalating.
describe.skipIf(!DB_INTEGRATION_ENABLED)(
  "calendar.booking.create end-to-end for a local provider (integration)",
  () => {
    function wireCreate(prisma: PrismaClient, orgId: string, contactId: string) {
      const localStore = buildLocalStore(prisma, orgId);
      const provider = new LocalCalendarProvider({
        businessHours: BUSINESS_HOURS,
        bookingStore: localStore,
      });
      const durable = new PrismaBookingStore(prisma);
      const factory = createCalendarBookToolFactory({
        calendarProviderFactory: async () => provider,
        isCalendarProviderConfigured: (p) => !isNoopCalendarProvider(p),
        bookingStore: durable as never,
        contactStore: {
          findById: async () => ({
            name: "E2E Patient",
            email: null,
            phone: null,
            attribution: null,
          }),
        } as never,
        opportunityStore: {
          findActiveByContact: async () => null,
          create: async () => ({ id: `opp-${orgId}` }),
        } as never,
        runTransaction: ((fn: (tx: unknown) => Promise<unknown>) =>
          prisma.$transaction((tx) =>
            fn({
              booking: tx.booking,
              outboxEvent: tx.outboxEvent,
              opportunity: tx.opportunity,
              receipt: tx.receipt,
            }),
          )) as never,
        // Must never run in these paths: a clash aborts at the durable create (step 1), and the
        // happy path confirms cleanly. A throw here surfaces an unexpected failure-handler hop.
        failureHandler: {
          handle: async () => {
            throw new Error("failureHandler must not be called on the create happy/clash path");
          },
        } as never,
        defaultCurrency: "SGD",
        receiptTierForProvider: receiptTierForCalendarProvider,
        isProduction: false,
      });
      return factory({ sessionId: "s", orgId, deploymentId: "d", contactId } as never);
    }

    async function cleanup(prisma: PrismaClient, orgId: string) {
      const rows = await prisma.booking.findMany({
        where: { organizationId: orgId },
        select: { id: true },
      });
      const bookedEventIds = rows.map((r) => `evt_booked_${r.id}`);
      await prisma.outboxEvent
        .deleteMany({ where: { eventId: { in: bookedEventIds } } })
        .catch(() => {});
      await prisma.receipt.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
      await prisma.booking.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    }

    it("persists exactly one confirmed booking with a local- calendarEventId", async () => {
      const prisma = new PrismaClient();
      const orgId = `e2ec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const tool = wireCreate(prisma, orgId, "patient-create");
      try {
        const result = await tool.operations["booking.create"]!.execute({
          service: "consultation",
          slotStart: "2026-12-01T02:00:00.000Z",
          slotEnd: "2026-12-01T03:00:00.000Z",
          calendarId: "local",
        });

        expect(result.status).toBe("success");
        expect(result.data?.status).toBe("confirmed");
        expect(String(result.data?.calendarEventId)).toMatch(/^local-/);

        const rows = await prisma.booking.findMany({ where: { organizationId: orgId } });
        expect(rows).toHaveLength(1);
        expect(rows[0]!.status).toBe("confirmed");
        expect(rows[0]!.calendarEventId).toMatch(/^local-/);
      } finally {
        await cleanup(prisma, orgId);
        await prisma.$disconnect();
      }
    });

    it("returns retryable SLOT_TAKEN (no orphan) when the slot is already held", async () => {
      const prisma = new PrismaClient();
      const orgId = `e2ec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const slot = { slotStart: "2026-12-03T02:00:00.000Z", slotEnd: "2026-12-03T03:00:00.000Z" };
      const first = wireCreate(prisma, orgId, "patient-first");
      const second = wireCreate(prisma, orgId, "patient-second");
      try {
        const ok = await first.operations["booking.create"]!.execute({
          service: "consultation",
          calendarId: "local",
          ...slot,
        });
        expect(ok.status).toBe("success");

        const clash = await second.operations["booking.create"]!.execute({
          service: "consultation",
          calendarId: "local",
          ...slot,
        });
        expect(clash.status).toBe("error");
        expect(clash.error?.code).toBe("SLOT_TAKEN");
        expect(clash.error?.retryable).toBe(true);

        // The clash aborted at the durable create: no second row, no orphan.
        const rows = await prisma.booking.findMany({ where: { organizationId: orgId } });
        expect(rows).toHaveLength(1);
        expect(rows[0]!.status).toBe("confirmed");
      } finally {
        await cleanup(prisma, orgId);
        await prisma.$disconnect();
      }
    });
  },
);
