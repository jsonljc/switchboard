import { describe, it, expect } from "vitest";
import { InMemoryRevenueDb } from "./revenue-loop-substrate.js";

/**
 * Unit-pins the InMemoryRevenueDb substrate's matcher + guards directly (repo norm: co-located tests).
 * The whole-loop e2e (revenue-proof-e2e / revenue-proof-paid-leg-e2e) leans on these being faithful;
 * a silent matcher bug there would surface as a confusing false-green four layers up. Each behavior is
 * driven by a REAL store call pattern the slice-2 payment/attendance legs exercise:
 *  - PrismaRevenueStore.record: lifecycleRevenueEvent.findFirst (idempotency) + create
 *  - getView paymentEventIds: lifecycleRevenueEvent.findMany({ where: { org, bookingId } })
 *  - PrismaOutboxStore.write: outboxEvent.createMany({ data, skipDuplicates })
 *  - a bare-Date equality where must match by instant, not object identity
 *  - an unmodeled client method/model must fail LOUD ("model it before use"), never opaque-TypeError
 */

const ORG = "org-1";

function seedCalendarReceipt(db: InMemoryRevenueDb, id: string, createdAt: Date, org = ORG): void {
  db.seedReceipt({
    id,
    organizationId: org,
    kind: "calendar",
    status: "booked",
    bookingId: `bk-${id}`,
    createdAt,
  });
}

describe("InMemoryRevenueDb substrate", () => {
  describe("matchWhere bare-Date equality", () => {
    it("matches a Date column by instant, not object identity", async () => {
      const db = new InMemoryRevenueDb();
      const at = new Date("2026-06-17T12:00:00.000Z");
      seedCalendarReceipt(db, "r1", at);
      // A reference-DISTINCT Date of the same instant must still match (Prisma equality semantics).
      const rows = await db.client.receipt.findMany({
        where: { organizationId: ORG, createdAt: new Date(at.getTime()) },
      });
      expect(rows.map((r) => r["id"])).toEqual(["r1"]);
    });

    it("does not match a Date column at a different instant", async () => {
      const db = new InMemoryRevenueDb();
      seedCalendarReceipt(db, "r1", new Date("2026-06-17T12:00:00.000Z"));
      const rows = await db.client.receipt.findMany({
        where: { createdAt: new Date("2020-01-01T00:00:00.000Z") },
      });
      expect(rows).toEqual([]);
    });
  });

  describe("throw-guard on unmodeled surface", () => {
    it("throws a friendly error for an unmodeled client method (not an opaque TypeError)", () => {
      const db = new InMemoryRevenueDb();
      const receipt = db.client.receipt as unknown as { aggregate: () => unknown };
      expect(() => receipt.aggregate()).toThrow(/model it before use/);
    });

    it("throws a friendly error for an unmodeled model", () => {
      const db = new InMemoryRevenueDb();
      const client = db.client as unknown as Record<string, { findMany: () => unknown }>;
      expect(() => client["paymentIntent"]!.findMany()).toThrow(/model it before use/);
    });

    it("still rejects an unmodeled where operator", async () => {
      const db = new InMemoryRevenueDb();
      seedCalendarReceipt(db, "r1", new Date());
      await expect(
        db.client.receipt.findMany({ where: { amount: { contains: 1 } } as never }),
      ).rejects.toThrow(/unsupported where operator/);
    });
  });

  describe("lifecycleRevenueEvent (stateful for the payment leg)", () => {
    it("create then findFirst by (org, externalReference) returns the row", async () => {
      const db = new InMemoryRevenueDb();
      await db.client.lifecycleRevenueEvent.create({
        data: {
          id: "rev1",
          organizationId: ORG,
          bookingId: "bk1",
          externalReference: "pi_1",
          amount: 30000,
        },
      });
      const found = await db.client.lifecycleRevenueEvent.findFirst({
        where: { organizationId: ORG, externalReference: "pi_1" },
      });
      expect(found).toMatchObject({ id: "rev1", amount: 30000 });
    });

    it("findMany by (org, bookingId) returns the events (getView paymentEventIds)", async () => {
      const db = new InMemoryRevenueDb();
      await db.client.lifecycleRevenueEvent.create({
        data: {
          id: "rev1",
          organizationId: ORG,
          bookingId: "bk1",
          externalReference: "pi_1",
          amount: 30000,
        },
      });
      const rows = await db.client.lifecycleRevenueEvent.findMany({
        where: { organizationId: ORG, bookingId: "bk1" },
      });
      expect(rows.map((r) => r["id"])).toEqual(["rev1"]);
    });

    it("is org-scoped: another org's bookingId match is excluded", async () => {
      const db = new InMemoryRevenueDb();
      await db.client.lifecycleRevenueEvent.create({
        data: {
          id: "rev1",
          organizationId: "org-2",
          bookingId: "bk1",
          externalReference: "pi_1",
          amount: 1,
        },
      });
      const rows = await db.client.lifecycleRevenueEvent.findMany({
        where: { organizationId: ORG, bookingId: "bk1" },
      });
      expect(rows).toEqual([]);
    });
  });

  describe("outboxEvent.createMany (PrismaOutboxStore.write)", () => {
    it("dedups a duplicate eventId under skipDuplicates (one row)", async () => {
      const db = new InMemoryRevenueDb();
      const data = [{ eventId: "evt_1", type: "purchased", payload: {}, status: "pending" }];
      await db.client.outboxEvent.createMany({ data, skipDuplicates: true });
      await db.client.outboxEvent.createMany({ data, skipDuplicates: true });
      expect(db.listOutbox().filter((e) => e["eventId"] === "evt_1")).toHaveLength(1);
    });
  });
});
