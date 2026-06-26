import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaContactStore } from "../prisma-contact-store.js";

// Gated real-Postgres proof of the PDPA right-to-erasure cascade. The other
// erasure tests mock Prisma (they prove the store CALLS the right deletes); this
// proves the cascade actually COMMITS against real Postgres: the contact and every
// populated child row are gone, the new parent-id-keyed receipts are purged via the
// collect-then-delete, a digits-only phone-keyed row is matched via the candidate
// set, and a different-org contact with the SAME phone survives (tenant isolation).
//
// Skips when DATABASE_URL is unset (so it is a no-op in CI, which has no Postgres),
// mirroring the package's other real-PG tests. Uses unique per-run org ids and
// cleans up after itself, so it is safe against the shared local dev database.

const SKIP = !process.env["DATABASE_URL"];
const uniq = (): string => `${Date.now()}_${Math.random().toString(36).slice(2)}`;

describe.skipIf(SKIP)("PrismaContactStore.delete PDPA erasure (real Postgres)", () => {
  const prisma = new PrismaClient();
  const store = new PrismaContactStore(prisma);
  const orgA = `org_erase_a_${uniq()}`;
  const orgB = `org_erase_b_${uniq()}`;
  const phone = "+6591234567";
  const waId = "6591234567"; // digits-only, the shape WhatsApp recipient_id/wa_id is stored in
  let contactAId = "";
  let contactBId = "";
  let bookingAId = "";
  let bookingBId = "";

  beforeAll(async () => {
    // --- Contact A (org A): a row in several cascade tables, incl. the newly-added
    //     parent-id-keyed receipts and a digits-only phone-keyed status row. ---
    const contactA = await store.create({
      organizationId: orgA,
      phone,
      primaryChannel: "whatsapp",
    });
    contactAId = contactA.id;
    const bookingA = await prisma.booking.create({
      data: {
        organizationId: orgA,
        contactId: contactAId,
        service: "consult",
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 3_600_000),
      },
    });
    bookingAId = bookingA.id;
    await prisma.receipt.create({
      data: {
        organizationId: orgA,
        kind: "calendar",
        tier: "T1_FETCH_BACK",
        status: "booked",
        bookingId: bookingAId,
        evidence: {},
        capturedBy: "erasure-it",
      },
    });
    await prisma.receiptedBooking.create({
      data: {
        organizationId: orgA,
        bookingId: bookingAId,
        attributionConfidence: "deterministic",
        attributionUpdatedAt: new Date(),
        exceptions: [],
        lastEvaluatedAt: new Date(),
      },
    });
    await prisma.scheduledReminder.create({
      data: {
        organizationId: orgA,
        contactId: contactAId,
        bookingId: bookingAId,
        startsAt: new Date(),
        timezone: "Asia/Singapore",
        templateIntentClass: "reminder",
        dedupeKey: `dk_a_${uniq()}`,
      },
    });
    await prisma.whatsAppMessageStatus.create({
      data: {
        messageId: `wamid_a_${uniq()}`,
        recipientId: waId,
        status: "delivered",
        timestamp: new Date(),
        organizationId: orgA,
      },
    });

    // --- Contact B (org B): same phone digits; MUST survive A's erasure. ---
    const contactB = await store.create({
      organizationId: orgB,
      phone,
      primaryChannel: "whatsapp",
    });
    contactBId = contactB.id;
    const bookingB = await prisma.booking.create({
      data: {
        organizationId: orgB,
        contactId: contactBId,
        service: "consult",
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 3_600_000),
      },
    });
    bookingBId = bookingB.id;
    await prisma.receipt.create({
      data: {
        organizationId: orgB,
        kind: "calendar",
        tier: "T1_FETCH_BACK",
        status: "booked",
        bookingId: bookingBId,
        evidence: {},
        capturedBy: "erasure-it",
      },
    });
    await prisma.whatsAppMessageStatus.create({
      data: {
        messageId: `wamid_b_${uniq()}`,
        recipientId: waId,
        status: "delivered",
        timestamp: new Date(),
        organizationId: orgB,
      },
    });
  });

  afterAll(async () => {
    // Best-effort cleanup (covers the case where an assertion failed before delete ran).
    for (const org of [orgA, orgB]) {
      await prisma.receipt.deleteMany({ where: { organizationId: org } }).catch(() => undefined);
      await prisma.receiptedBooking
        .deleteMany({ where: { organizationId: org } })
        .catch(() => undefined);
      await prisma.scheduledReminder
        .deleteMany({ where: { organizationId: org } })
        .catch(() => undefined);
      await prisma.whatsAppMessageStatus
        .deleteMany({ where: { organizationId: org } })
        .catch(() => undefined);
      await prisma.booking.deleteMany({ where: { organizationId: org } }).catch(() => undefined);
      await prisma.contact.deleteMany({ where: { organizationId: org } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it("erases the contact and every populated child, org-scoped, against real Postgres", async () => {
    await store.delete(orgA, contactAId);

    // Contact A and all its children (incl. the new parent-id-keyed receipts and the
    // digits-only phone-keyed status row) are gone.
    expect(await prisma.contact.count({ where: { id: contactAId } })).toBe(0);
    expect(await prisma.booking.count({ where: { contactId: contactAId } })).toBe(0);
    expect(await prisma.receipt.count({ where: { bookingId: bookingAId } })).toBe(0);
    expect(await prisma.receiptedBooking.count({ where: { bookingId: bookingAId } })).toBe(0);
    expect(await prisma.scheduledReminder.count({ where: { contactId: contactAId } })).toBe(0);
    expect(
      await prisma.whatsAppMessageStatus.count({
        where: { organizationId: orgA, recipientId: waId },
      }),
    ).toBe(0);

    // Tenant isolation: org B's contact + children (SAME phone) are untouched.
    expect(await prisma.contact.count({ where: { id: contactBId } })).toBe(1);
    expect(await prisma.booking.count({ where: { contactId: contactBId } })).toBe(1);
    expect(await prisma.receipt.count({ where: { bookingId: bookingBId } })).toBe(1);
    expect(
      await prisma.whatsAppMessageStatus.count({
        where: { organizationId: orgB, recipientId: waId },
      }),
    ).toBe(1);
  });
});
