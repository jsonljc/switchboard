import { describe, it, expect, vi } from "vitest";
import { PrismaContactStore } from "../prisma-contact-store.js";

// Unit tests for PrismaContactStore.delete() cascade mechanics (tenant isolation,
// StaleVersion guard, contactId/phone-keyed child deletes, single transaction).
// The F5/PDPA erasure-completeness assertions (WorkTrace, DLQ, the lifecycle/
// follow-up/recovery tables, Receipt/ReceiptedBooking, phone-shape matching) live
// in the dedicated prisma-contact-store-erasure.test.ts. Split out of
// prisma-contact-store.test.ts to keep both files within the 600-line budget.

function makeContact(overrides: Record<string, unknown> = {}) {
  return {
    id: "contact-1",
    organizationId: "org-1",
    phone: "+6591234567",
    phoneE164: "+6591234567",
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
  // $transaction passes the same client to the callback so all deleteMany calls hit our mocks.
  return Object.assign(px, {
    $transaction: vi.fn().mockImplementation(async (fn: (tx: typeof px) => unknown) => {
      if (typeof fn === "function") return fn(px);
      return fn;
    }),
  });
}

describe("PrismaContactStore.delete — cascade mechanics", () => {
  it("throws when contact not found or wrong org (tenant isolation)", async () => {
    const px = mockPrismaWithCascade();
    px.contact.findFirst.mockResolvedValue(null);
    const cascadeStore = new PrismaContactStore(px as never);

    await expect(cascadeStore.delete("org-1", "contact-999")).rejects.toThrow(
      /not found or does not belong/,
    );
    expect(px.contact.deleteMany).not.toHaveBeenCalled();
  });

  it("uses tenant-scoped deleteMany for the final contact row", async () => {
    const px = mockPrismaWithCascade();
    const cascadeStore = new PrismaContactStore(px as never);

    await cascadeStore.delete("org-1", "contact-1");

    expect(px.contact.deleteMany).toHaveBeenCalledWith({
      where: { id: "contact-1", organizationId: "org-1" },
    });
    expect(px.contact.delete).not.toHaveBeenCalled();
  });

  it("throws StaleVersionError (matching /Stale version/) when deleteMany count===0", async () => {
    const px = mockPrismaWithCascade();
    px.contact.deleteMany.mockResolvedValue({ count: 0 });
    const cascadeStore = new PrismaContactStore(px as never);

    await expect(cascadeStore.delete("org-1", "contact-1")).rejects.toThrow(/Stale version/);
  });

  it("deletes contact and all child records keyed by contactId", async () => {
    const px = mockPrismaWithCascade();
    const cascadeStore = new PrismaContactStore(px as never);

    await cascadeStore.delete("org-1", "contact-1");

    expect(px.conversationThread.deleteMany).toHaveBeenCalledWith({
      where: { contactId: "contact-1" },
    });
    expect(px.opportunity.deleteMany).toHaveBeenCalledWith({
      where: { contactId: "contact-1" },
    });
    expect(px.lifecycleRevenueEvent.deleteMany).toHaveBeenCalledWith({
      where: { contactId: "contact-1" },
    });
    expect(px.ownerTask.deleteMany).toHaveBeenCalledWith({
      where: { contactId: "contact-1" },
    });
    expect(px.contactLifecycle.deleteMany).toHaveBeenCalledWith({
      where: { contactId: "contact-1" },
    });
    expect(px.conversationMessage.deleteMany).toHaveBeenCalledWith({
      where: { contactId: "contact-1" },
    });
    expect(px.escalationRecord.deleteMany).toHaveBeenCalledWith({
      where: { contactId: "contact-1" },
    });
    expect(px.handoff.deleteMany).toHaveBeenCalledWith({ where: { leadId: "contact-1" } });
    expect(px.interactionSummary.deleteMany).toHaveBeenCalledWith({
      where: { contactId: "contact-1" },
    });
    expect(px.booking.deleteMany).toHaveBeenCalledWith({ where: { contactId: "contact-1" } });
    expect(px.conversionRecord.deleteMany).toHaveBeenCalledWith({
      where: { contactId: "contact-1" },
    });
    expect(px.pendingLeadRetry.deleteMany).toHaveBeenCalledWith({
      where: { leadId: "contact-1" },
    });
  });

  it("deletes phone-keyed records (WhatsAppMessageStatus, ConversationState) org-scoped, across phone shapes", async () => {
    // The exact `where` asserted here (recipientId/principalId `in` + organizationId)
    // also guards #643 cross-org data loss: the deletes are org-scoped.
    const px = mockPrismaWithCascade();
    px.contact.findFirst.mockResolvedValue(makeContact({ phone: "+6591234567" }));
    const cascadeStore = new PrismaContactStore(px as never);

    await cascadeStore.delete("org-1", "contact-1");

    expect(px.whatsAppMessageStatus.deleteMany).toHaveBeenCalledWith({
      where: { recipientId: { in: ["+6591234567", "6591234567"] }, organizationId: "org-1" },
    });
    expect(px.conversationState.deleteMany).toHaveBeenCalledWith({
      where: { principalId: { in: ["+6591234567", "6591234567"] }, organizationId: "org-1" },
    });
  });

  it("skips phone-keyed records when contact has no phone", async () => {
    const px = mockPrismaWithCascade();
    px.contact.findFirst.mockResolvedValue(makeContact({ phone: null, phoneE164: null }));
    const cascadeStore = new PrismaContactStore(px as never);

    await cascadeStore.delete("org-1", "contact-1");

    expect(px.whatsAppMessageStatus.deleteMany).not.toHaveBeenCalled();
    expect(px.conversationState.deleteMany).not.toHaveBeenCalled();
    expect(px.contact.deleteMany).toHaveBeenCalled();
  });

  it("runs the cascade inside a single transaction", async () => {
    const px = mockPrismaWithCascade();
    const cascadeStore = new PrismaContactStore(px as never);

    await cascadeStore.delete("org-1", "contact-1");

    expect(px.$transaction).toHaveBeenCalledTimes(1);
  });
});
