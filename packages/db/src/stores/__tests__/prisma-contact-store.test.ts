import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaDbClient } from "../../prisma-db.js";
import { PrismaContactStore } from "../prisma-contact-store.js";

const now = new Date("2026-03-25T12:00:00Z");

function makeMockPrisma() {
  return {
    contact: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
      findFirstOrThrow: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      count: vi.fn(),
    },
  };
}

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
    attribution: { fbclid: "abc123", sourceCampaignId: "camp-1" },
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

describe("PrismaContactStore", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let store: PrismaContactStore;

  beforeEach(() => {
    prisma = makeMockPrisma();
    store = new PrismaContactStore(prisma as never);
  });

  describe("create", () => {
    it("creates a new contact with all fields", async () => {
      const input = {
        organizationId: "org-1",
        name: "Jane Smith",
        phone: "+6598765432",
        email: "jane@example.com",
        primaryChannel: "whatsapp" as const,
        firstTouchChannel: "instagram",
        source: "instagram_ad",
        attribution: { fbclid: "xyz789", sourceCampaignId: "camp-2" },
        roles: ["lead"],
      };

      const created = makeContact({
        name: "Jane Smith",
        phone: "+6598765432",
        email: "jane@example.com",
      });
      prisma.contact.create.mockResolvedValue(created);

      const result = await store.create(input);

      expect(prisma.contact.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: expect.any(String),
          organizationId: "org-1",
          name: "Jane Smith",
          phone: "+6598765432",
          email: "jane@example.com",
          primaryChannel: "whatsapp",
          firstTouchChannel: "instagram",
          source: "instagram_ad",
          attribution: { fbclid: "xyz789", sourceCampaignId: "camp-2" },
          roles: ["lead"],
          stage: "new",
          firstContactAt: expect.any(Date),
          lastActivityAt: expect.any(Date),
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        }),
      });

      expect(result.name).toBe("Jane Smith");
      expect(result.stage).toBe("new");
    });

    it("creates contact with minimal fields and defaults", async () => {
      const input = {
        organizationId: "org-1",
        primaryChannel: "telegram" as const,
      };

      const created = makeContact({
        name: null,
        phone: null,
        email: null,
        primaryChannel: "telegram",
      });
      prisma.contact.create.mockResolvedValue(created);

      await store.create(input);

      expect(prisma.contact.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: null,
          phone: null,
          email: null,
          primaryChannel: "telegram",
          roles: ["lead"],
          stage: "new",
          messagingOptIn: false,
          messagingOptInAt: null,
          messagingOptInSource: null,
        }),
      });
    });

    it("persists messagingOptIn with source and timestamp when opted in", async () => {
      const input = {
        organizationId: "org-1",
        phone: "+6591111111",
        primaryChannel: "whatsapp" as const,
        messagingOptIn: true,
        messagingOptInSource: "organic_inbound" as const,
      };

      prisma.contact.create.mockResolvedValue(
        makeContact({
          messagingOptIn: true,
          messagingOptInAt: now,
          messagingOptInSource: "organic_inbound",
        }),
      );

      const result = await store.create(input);

      expect(prisma.contact.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          messagingOptIn: true,
          messagingOptInAt: expect.any(Date),
          messagingOptInSource: "organic_inbound",
        }),
      });
      expect(result.messagingOptIn).toBe(true);
      expect(result.messagingOptInSource).toBe("organic_inbound");
      expect(result.messagingOptInAt).toBeInstanceOf(Date);
    });

    it("does not set messagingOptInAt when messagingOptIn is false", async () => {
      const input = {
        organizationId: "org-1",
        primaryChannel: "telegram" as const,
      };

      prisma.contact.create.mockResolvedValue(makeContact({ primaryChannel: "telegram" }));

      await store.create(input);

      const callArgs = prisma.contact.create.mock.calls[0]?.[0] as {
        data: { messagingOptIn: boolean; messagingOptInAt: Date | null };
      };
      expect(callArgs.data.messagingOptIn).toBe(false);
      expect(callArgs.data.messagingOptInAt).toBeNull();
    });
  });

  describe("findById", () => {
    it("returns null when contact not found", async () => {
      const result = await store.findById("org-1", "contact-999");

      expect(result).toBeNull();
      expect(prisma.contact.findFirst).toHaveBeenCalledWith({
        where: {
          id: "contact-999",
          organizationId: "org-1",
        },
      });
    });

    it("returns contact when found", async () => {
      const contact = makeContact();
      prisma.contact.findFirst.mockResolvedValue(contact);

      const result = await store.findById("org-1", "contact-1");

      expect(result).not.toBeNull();
      expect(result!.id).toBe("contact-1");
      expect(result!.name).toBe("John Doe");
      expect(result!.phone).toBe("+6591234567");
      expect(result!.stage).toBe("new");
    });

    it("maps attribution correctly", async () => {
      const contact = makeContact({
        attribution: { fbclid: "test123", gclid: null, sourceCampaignId: "camp-1" },
      });
      prisma.contact.findFirst.mockResolvedValue(contact);

      const result = await store.findById("org-1", "contact-1");

      expect(result!.attribution).toEqual({
        fbclid: "test123",
        gclid: null,
        sourceCampaignId: "camp-1",
      });
    });
  });

  describe("findByPhone", () => {
    it("returns null when no contact with phone exists", async () => {
      const result = await store.findByPhone("org-1", "+6599999999");

      expect(result).toBeNull();
      expect(prisma.contact.findFirst).toHaveBeenCalledWith({
        where: { organizationId: "org-1", phoneE164: "+6599999999" },
      });
    });

    it("returns first contact matching phone", async () => {
      const contact = makeContact({ phone: "+6591234567" });
      prisma.contact.findFirst.mockResolvedValue(contact);

      const result = await store.findByPhone("org-1", "+6591234567");

      expect(result).not.toBeNull();
      expect(result!.phone).toBe("+6591234567");
    });
  });

  describe("updateStage", () => {
    it("calls updateMany with tenant-scoped WHERE and maps the read-back row", async () => {
      prisma.contact.updateMany.mockResolvedValue({ count: 1 });
      const updated = makeContact({ stage: "active" });
      prisma.contact.findFirstOrThrow.mockResolvedValue(updated);

      const result = await store.updateStage("org-1", "contact-1", "active");

      expect(prisma.contact.updateMany).toHaveBeenCalledWith({
        where: { id: "contact-1", organizationId: "org-1" },
        data: {
          stage: "active",
          updatedAt: expect.any(Date),
        },
      });
      expect(prisma.contact.findFirstOrThrow).toHaveBeenCalledWith({
        where: { id: "contact-1", organizationId: "org-1" },
      });
      expect(result.stage).toBe("active");
    });

    it("throws StaleVersionError (matching /Stale version/) when count===0", async () => {
      prisma.contact.updateMany.mockResolvedValue({ count: 0 });

      await expect(store.updateStage("org-1", "contact-999", "active")).rejects.toThrow(
        /Stale version/,
      );
    });
  });

  describe("updateLastActivity", () => {
    it("calls updateMany with tenant-scoped WHERE (no pre-fetch)", async () => {
      prisma.contact.updateMany.mockResolvedValue({ count: 1 });

      await store.updateLastActivity("org-1", "contact-1");

      expect(prisma.contact.findFirst).not.toHaveBeenCalled();
      expect(prisma.contact.updateMany).toHaveBeenCalledWith({
        where: { id: "contact-1", organizationId: "org-1" },
        data: {
          lastActivityAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
      });
    });

    it("throws StaleVersionError (matching /Stale version/) when count===0", async () => {
      prisma.contact.updateMany.mockResolvedValue({ count: 0 });

      await expect(store.updateLastActivity("org-1", "contact-999")).rejects.toThrow(
        /Stale version/,
      );
    });
  });

  describe("delete", () => {
    function mockPrismaWithCascade() {
      const px = {
        contact: {
          findFirst: vi.fn().mockResolvedValue(makeContact({ phone: "+6591234567" })),
          delete: vi.fn().mockResolvedValue({}),
          deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
          create: vi.fn().mockResolvedValue({}),
          findMany: vi.fn().mockResolvedValue([]),
          update: vi.fn().mockResolvedValue({}),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        conversationThread: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        opportunity: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        lifecycleRevenueEvent: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        ownerTask: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        contactLifecycle: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        conversationMessage: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        conversationState: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        whatsAppMessageStatus: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        escalationRecord: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        handoff: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        interactionSummary: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        booking: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        conversionRecord: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        pendingLeadRetry: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        // F5 erasure cascade additions (assertions live in the dedicated
        // prisma-contact-store-erasure.test.ts); mocked here so delete() runs.
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
      // $transaction passes the same client to the callback so all deleteMany calls hit our mocks
      return Object.assign(px, {
        $transaction: vi.fn().mockImplementation(async (fn: (tx: typeof px) => unknown) => {
          if (typeof fn === "function") return fn(px);
          return fn;
        }),
      });
    }

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

  describe("recordMessagingOptOut", () => {
    it("calls updateMany with tenant-scoped WHERE (no pre-fetch)", async () => {
      prisma.contact.updateMany.mockResolvedValue({ count: 1 });

      await store.recordMessagingOptOut("org-1", "contact-1");

      expect(prisma.contact.findFirst).not.toHaveBeenCalled();
      expect(prisma.contact.updateMany).toHaveBeenCalledWith({
        where: { id: "contact-1", organizationId: "org-1" },
        data: {
          messagingOptIn: false,
          messagingOptOutAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
      });
    });

    it("throws StaleVersionError (matching /Stale version/) when count===0", async () => {
      prisma.contact.updateMany.mockResolvedValue({ count: 0 });

      await expect(store.recordMessagingOptOut("org-1", "contact-999")).rejects.toThrow(
        /Stale version/,
      );
    });
  });

  describe("list", () => {
    it("lists all contacts for org without filters", async () => {
      const contacts = [makeContact({ id: "c1" }), makeContact({ id: "c2" })];
      prisma.contact.findMany.mockResolvedValue(contacts);

      const result = await store.list("org-1");

      expect(prisma.contact.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org-1" },
        take: undefined,
        skip: undefined,
        orderBy: { lastActivityAt: "desc" },
      });
      expect(result).toHaveLength(2);
    });

    it("filters by stage", async () => {
      const contacts = [makeContact({ stage: "active" })];
      prisma.contact.findMany.mockResolvedValue(contacts);

      await store.list("org-1", { stage: "active" });

      expect(prisma.contact.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          stage: "active",
        },
        take: undefined,
        skip: undefined,
        orderBy: { lastActivityAt: "desc" },
      });
    });

    it("filters by source", async () => {
      const contacts = [makeContact({ source: "google_ad" })];
      prisma.contact.findMany.mockResolvedValue(contacts);

      await store.list("org-1", { source: "google_ad" });

      expect(prisma.contact.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          source: "google_ad",
        },
        take: undefined,
        skip: undefined,
        orderBy: { lastActivityAt: "desc" },
      });
    });

    it("applies limit and offset", async () => {
      prisma.contact.findMany.mockResolvedValue([]);

      await store.list("org-1", { limit: 10, offset: 20 });

      expect(prisma.contact.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org-1" },
        take: 10,
        skip: 20,
        orderBy: { lastActivityAt: "desc" },
      });
    });

    it("combines multiple filters", async () => {
      prisma.contact.findMany.mockResolvedValue([]);

      await store.list("org-1", {
        stage: "customer",
        source: "referral",
        limit: 5,
        offset: 0,
      });

      expect(prisma.contact.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          stage: "customer",
          source: "referral",
        },
        take: 5,
        skip: 0,
        orderBy: { lastActivityAt: "desc" },
      });
    });
  });

  describe("listByIds", () => {
    it("returns a Map keyed by contact id", async () => {
      prisma.contact.findMany.mockResolvedValue([
        makeContact({ id: "c1", name: "Maya" }),
        makeContact({ id: "c2", name: "Jordan" }),
      ]);

      const result = await store.listByIds("org-1", ["c1", "c2"]);

      expect(result.size).toBe(2);
      expect(result.get("c1")?.name).toBe("Maya");
      expect(result.get("c2")?.name).toBe("Jordan");
    });

    it("returns an empty Map for empty input (no DB call)", async () => {
      const result = await store.listByIds("org-1", []);

      expect(result.size).toBe(0);
      expect(prisma.contact.findMany).not.toHaveBeenCalled();
    });

    it("filters by orgId for tenant isolation", async () => {
      prisma.contact.findMany.mockResolvedValue([]);

      await store.listByIds("org-1", ["c1"]);

      expect(prisma.contact.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org-1", id: { in: ["c1"] } },
      });
    });
  });

  describe("countConsentCompleteness", () => {
    it("counts bookable (pdpaJurisdiction set) + validConsent (granted, not revoked)", async () => {
      prisma.contact.count = vi.fn().mockResolvedValueOnce(45).mockResolvedValueOnce(42);
      const res = await store.countConsentCompleteness({ orgId: "o1" });
      expect(res).toEqual({ bookable: 45, validConsent: 42 });
      expect(prisma.contact.count).toHaveBeenNthCalledWith(1, {
        where: { organizationId: "o1", pdpaJurisdiction: { not: null } },
      });
      expect(prisma.contact.count).toHaveBeenNthCalledWith(2, {
        where: {
          organizationId: "o1",
          pdpaJurisdiction: { not: null },
          consentGrantedAt: { not: null },
          consentRevokedAt: null,
        },
      });
    });
  });

  describe("listForPipeline", () => {
    it("returns recent active+new contacts ordered by lastActivityAt desc with totalCount", async () => {
      const prisma = {
        contact: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "c1",
              organizationId: "org-A",
              name: "Maya",
              phone: "+6591234567",
              email: null,
              primaryChannel: "whatsapp",
              firstTouchChannel: null,
              stage: "active",
              source: null,
              attribution: null,
              roles: ["lead"],
              firstContactAt: new Date("2026-05-01T00:00:00Z"),
              lastActivityAt: new Date("2026-05-07T08:00:00Z"),
              createdAt: new Date("2026-05-01T00:00:00Z"),
              updatedAt: new Date("2026-05-07T08:00:00Z"),
            },
          ]),
          count: vi.fn().mockResolvedValue(3),
        },
      } as unknown as PrismaDbClient;

      const store = new PrismaContactStore(prisma);
      const result = await store.listForPipeline({
        orgId: "org-A",
        activitySince: new Date("2026-04-30T00:00:00Z"),
        limit: 5,
      });

      expect(prisma.contact.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org-A",
          stage: { in: ["active", "new"] },
          lastActivityAt: { gte: new Date("2026-04-30T00:00:00Z") },
        },
        orderBy: { lastActivityAt: "desc" },
        take: 5,
      });
      expect(prisma.contact.count).toHaveBeenCalledWith({
        where: {
          organizationId: "org-A",
          stage: { in: ["active", "new"] },
          lastActivityAt: { gte: new Date("2026-04-30T00:00:00Z") },
        },
      });
      expect(result.totalCount).toBe(3);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]!.id).toBe("c1");
      expect(result.rows[0]!.stage).toBe("active");
    });

    it("returns empty rows + totalCount=0 when filter matches nothing", async () => {
      const prisma = {
        contact: {
          findMany: vi.fn().mockResolvedValue([]),
          count: vi.fn().mockResolvedValue(0),
        },
      } as unknown as PrismaDbClient;
      const store = new PrismaContactStore(prisma);
      const result = await store.listForPipeline({
        orgId: "org-A",
        activitySince: new Date(),
        limit: 5,
      });
      expect(result.rows).toEqual([]);
      expect(result.totalCount).toBe(0);
    });
  });
});
