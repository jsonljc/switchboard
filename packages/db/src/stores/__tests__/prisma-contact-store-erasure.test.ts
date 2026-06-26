import { describe, it, expect, vi } from "vitest";
import {
  PrismaContactStore,
  payloadMentionsPhone,
  buildPhoneMatchCandidates,
} from "../prisma-contact-store.js";

// F5 (PDPA right-to-erasure): the Contact deletion cascade must also purge the
// audit log (WorkTrace) and the dead-letter queue (FailedMessage), which key PII
// off contactId/rawPayload rather than the contact graph and so survived before.

const now = new Date("2026-03-25T12:00:00Z");

function makeContact(overrides: Record<string, unknown> = {}) {
  return {
    id: "contact-1",
    organizationId: "org-1",
    name: "John Doe",
    phone: "+6591234567",
    phoneE164: "+6591234567",
    email: "john@example.com",
    primaryChannel: "whatsapp",
    firstTouchChannel: "facebook",
    stage: "new",
    source: "facebook_ad",
    attribution: null,
    roles: ["lead"],
    messagingOptIn: false,
    messagingOptInAt: null,
    messagingOptInSource: null,
    messagingOptOutAt: null,
    firstContactAt: now,
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function mockPrismaWithCascade() {
  const px = {
    contact: {
      findFirst: vi.fn().mockResolvedValue(makeContact({ phone: "+6591234567" })),
      delete: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    conversationThread: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    opportunity: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    lifecycleRevenueEvent: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    ownerTask: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    contactLifecycle: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    conversationMessage: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    conversationState: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    whatsAppMessageStatus: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    escalationRecord: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    handoff: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    interactionSummary: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    booking: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    conversionRecord: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    pendingLeadRetry: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    receipt: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    receiptedBooking: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    workTrace: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    conversationLifecycleSnapshot: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    conversationLifecycleTransition: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    scheduledFollowUp: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    scheduledReminder: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    robinRecoverySend: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    whatsAppTestSend: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    failedMessage: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
  // $transaction passes the same client to the callback so all calls hit our mocks.
  return Object.assign(px, {
    $transaction: vi.fn().mockImplementation(async (fn: (tx: typeof px) => unknown) => {
      if (typeof fn === "function") return fn(px);
      return fn;
    }),
  });
}

function waMessagePayload(senderWaId: string, body: string) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [{ wa_id: senderWaId }],
              messages: [{ from: senderWaId, text: { body } }],
            },
          },
        ],
      },
    ],
  };
}

describe("PrismaContactStore.delete — PDPA erasure (F5)", () => {
  it("purges WorkTrace audit rows for the contact, org-scoped", async () => {
    const px = mockPrismaWithCascade();
    const store = new PrismaContactStore(px as never);

    await store.delete("org-1", "contact-1");

    expect(px.workTrace.deleteMany).toHaveBeenCalledWith({
      where: { contactId: "contact-1", organizationId: "org-1" },
    });
  });

  it("purges the patient's FailedMessage (DLQ) rows whose rawPayload carries the contact phone", async () => {
    const px = mockPrismaWithCascade();
    px.contact.findFirst.mockResolvedValue(makeContact({ phone: "+6591234567" }));
    // The DLQ is org-keyed; the phone lives inside the raw WhatsApp webhook body
    // (messages[].from / contacts[].wa_id, digits-only, no leading +).
    px.failedMessage.findMany.mockResolvedValue([
      { id: "fm-patient", rawPayload: waMessagePayload("6591234567", "Can I book Tuesday?") },
      { id: "fm-other", rawPayload: waMessagePayload("6599999999", "A different patient") },
    ]);
    const store = new PrismaContactStore(px as never);

    await store.delete("org-1", "contact-1");

    // Candidates loaded org-scoped, with NO take cap — erasure must be complete,
    // and a SQL take-before-JS-filter would silently starve matches.
    expect(px.failedMessage.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1" },
      select: { id: true, rawPayload: true },
    });
    // Only the patient's row is purged; the other patient's row is left untouched.
    expect(px.failedMessage.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["fm-patient"] }, organizationId: "org-1" },
    });
  });

  it("leaves FailedMessage rows untouched when none carry the contact phone", async () => {
    const px = mockPrismaWithCascade();
    px.contact.findFirst.mockResolvedValue(makeContact({ phone: "+6591234567" }));
    px.failedMessage.findMany.mockResolvedValue([
      { id: "fm-other", rawPayload: waMessagePayload("6599999999", "different") },
    ]);
    const store = new PrismaContactStore(px as never);

    await store.delete("org-1", "contact-1");

    expect(px.failedMessage.deleteMany).not.toHaveBeenCalled();
  });

  it("skips the phone-keyed branch entirely when the contact has no phone at all", async () => {
    const px = mockPrismaWithCascade();
    px.contact.findFirst.mockResolvedValue(makeContact({ phone: null, phoneE164: null }));
    const store = new PrismaContactStore(px as never);

    await store.delete("org-1", "contact-1");

    expect(px.whatsAppMessageStatus.deleteMany).not.toHaveBeenCalled();
    expect(px.conversationState.deleteMany).not.toHaveBeenCalled();
    expect(px.whatsAppTestSend.deleteMany).not.toHaveBeenCalled();
    expect(px.failedMessage.findMany).not.toHaveBeenCalled();
    expect(px.failedMessage.deleteMany).not.toHaveBeenCalled();
  });

  it("purges WorkTrace + FailedMessage inside the single cascade transaction", async () => {
    const px = mockPrismaWithCascade();
    px.contact.findFirst.mockResolvedValue(makeContact({ phone: "+6591234567" }));
    px.failedMessage.findMany.mockResolvedValue([
      { id: "fm-patient", rawPayload: { from: "6591234567" } },
    ]);
    const store = new PrismaContactStore(px as never);

    await store.delete("org-1", "contact-1");

    expect(px.$transaction).toHaveBeenCalledTimes(1);
    expect(px.workTrace.deleteMany).toHaveBeenCalled();
    expect(px.failedMessage.deleteMany).toHaveBeenCalled();
  });

  it("purges all contactId-keyed lifecycle/follow-up/recovery tables, org-scoped", async () => {
    const px = mockPrismaWithCascade();
    const store = new PrismaContactStore(px as never);

    await store.delete("org-1", "contact-1");

    for (const table of [
      px.conversationLifecycleSnapshot,
      px.conversationLifecycleTransition,
      px.scheduledFollowUp,
      px.scheduledReminder,
      px.robinRecoverySend,
    ]) {
      expect(table.deleteMany).toHaveBeenCalledWith({
        where: { contactId: "contact-1", organizationId: "org-1" },
      });
    }
  });

  it("purges Receipt + ReceiptedBooking keyed by the contact's booking/opportunity/revenue ids", async () => {
    const px = mockPrismaWithCascade();
    px.booking.findMany.mockResolvedValue([{ id: "bk-1" }]);
    px.opportunity.findMany.mockResolvedValue([{ id: "op-1" }]);
    px.lifecycleRevenueEvent.findMany.mockResolvedValue([{ id: "rev-1" }]);
    const store = new PrismaContactStore(px as never);

    await store.delete("org-1", "contact-1");

    // Receipt/ReceiptedBooking are keyed by the parent ids (not contactId) and carry
    // transactional PII; they are purged like the sibling revenue tables.
    expect(px.receipt.deleteMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        OR: [
          { bookingId: { in: ["bk-1"] } },
          { opportunityId: { in: ["op-1"] } },
          { revenueEventId: { in: ["rev-1"] } },
        ],
      },
    });
    expect(px.receiptedBooking.deleteMany).toHaveBeenCalledWith({
      where: { bookingId: { in: ["bk-1"] }, organizationId: "org-1" },
    });
  });

  it("skips Receipt/ReceiptedBooking purge when the contact has no bookings/opportunities/revenue", async () => {
    const px = mockPrismaWithCascade();
    // findMany defaults to [] for booking/opportunity/lifecycleRevenueEvent
    const store = new PrismaContactStore(px as never);

    await store.delete("org-1", "contact-1");

    expect(px.receipt.deleteMany).not.toHaveBeenCalled();
    expect(px.receiptedBooking.deleteMany).not.toHaveBeenCalled();
  });

  it("matches phone-keyed children across +E.164 and digits-only shapes", async () => {
    const px = mockPrismaWithCascade();
    px.contact.findFirst.mockResolvedValue(
      makeContact({ phone: "+6591234567", phoneE164: "+6591234567" }),
    );
    const store = new PrismaContactStore(px as never);

    await store.delete("org-1", "contact-1");

    // recipient_id/wa_id arrive digits-only, principalId/toNumber may be +E.164;
    // the candidate set must cover both so no channel row escapes.
    const assertCandidateMatch = (
      deleteMany: { mock: { calls: unknown[][] } },
      field: string,
    ): void => {
      const arg = deleteMany.mock.calls[0]![0] as {
        where: Record<string, unknown> & { organizationId: string };
      };
      expect((arg.where[field] as { in: string[] }).in.slice().sort()).toEqual([
        "+6591234567",
        "6591234567",
      ]);
      expect(arg.where.organizationId).toBe("org-1");
    };
    assertCandidateMatch(px.whatsAppMessageStatus.deleteMany, "recipientId");
    assertCandidateMatch(px.conversationState.deleteMany, "principalId");
    assertCandidateMatch(px.whatsAppTestSend.deleteMany, "toNumber");
  });

  it("purges phone-keyed rows for a phoneE164-only contact (raw phone null)", async () => {
    const px = mockPrismaWithCascade();
    px.contact.findFirst.mockResolvedValue(makeContact({ phone: null, phoneE164: "+6591234567" }));
    px.failedMessage.findMany.mockResolvedValue([{ id: "fm", rawPayload: { from: "6591234567" } }]);
    const store = new PrismaContactStore(px as never);

    await store.delete("org-1", "contact-1");

    expect(px.whatsAppMessageStatus.deleteMany).toHaveBeenCalled();
    expect(px.conversationState.deleteMany).toHaveBeenCalled();
    // The DLQ scan still runs off phoneE164 when the raw phone is null.
    expect(px.failedMessage.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["fm"] }, organizationId: "org-1" },
    });
  });
});

describe("buildPhoneMatchCandidates", () => {
  it("yields the raw + digits-only forms, deduped", () => {
    expect(buildPhoneMatchCandidates("+6591234567", "+6591234567").slice().sort()).toEqual([
      "+6591234567",
      "6591234567",
    ]);
  });

  it("includes a digits-only contact phone as-is", () => {
    expect(buildPhoneMatchCandidates("6591234567", null)).toContain("6591234567");
  });

  it("keeps the raw value but drops a junk-short digit form", () => {
    expect(buildPhoneMatchCandidates("123", null)).toEqual(["123"]);
  });

  it("returns [] when there is no phone", () => {
    expect(buildPhoneMatchCandidates(null, null)).toEqual([]);
    expect(buildPhoneMatchCandidates(null, undefined)).toEqual([]);
  });
});

describe("payloadMentionsPhone (F5 DLQ matcher)", () => {
  const waPayload = waMessagePayload("6591234567", "hello there");

  it("matches the WhatsApp sender wa_id/from regardless of a leading +", () => {
    expect(payloadMentionsPhone(waPayload, "+6591234567")).toBe(true);
    expect(payloadMentionsPhone(waPayload, "6591234567")).toBe(true);
  });

  it("does not match a different patient's phone", () => {
    expect(payloadMentionsPhone(waPayload, "+6599999999")).toBe(false);
  });

  it("matches a phone that is the only number inside a free-text field", () => {
    expect(payloadMentionsPhone({ note: "call me on +65 9123 4567 please" }, "6591234567")).toBe(
      true,
    );
  });

  it("does NOT over-match a longer numeric id that merely contains the digits", () => {
    // Exact per-leaf equality, never substring — guards against cross-patient
    // over-deletion (e.g. a message/event id that embeds the phone digits).
    expect(payloadMentionsPhone({ messageId: "659123456700042" }, "6591234567")).toBe(false);
    expect(payloadMentionsPhone({ other: "16591234567" }, "6591234567")).toBe(false);
  });

  it("ignores too-short phones to avoid matching ids/counts", () => {
    expect(payloadMentionsPhone({ count: "123" }, "123")).toBe(false);
  });

  it("returns false for null/empty payloads", () => {
    expect(payloadMentionsPhone(null, "6591234567")).toBe(false);
    expect(payloadMentionsPhone({}, "6591234567")).toBe(false);
    expect(payloadMentionsPhone([], "6591234567")).toBe(false);
  });
});
