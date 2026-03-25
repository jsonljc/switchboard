import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaContactStore } from "../prisma-contact-store.js";

const now = new Date("2026-03-25T12:00:00Z");

function makeMockPrisma() {
  return {
    contact: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
  };
}

function makeContact(overrides: Record<string, unknown> = {}) {
  return {
    id: "contact-1",
    organizationId: "org-1",
    name: "John Doe",
    phone: "+6591234567",
    email: "john@example.com",
    primaryChannel: "whatsapp",
    firstTouchChannel: "facebook",
    stage: "new",
    source: "facebook_ad",
    attribution: { fbclid: "abc123", sourceCampaignId: "camp-1" },
    roles: ["lead"],
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
        }),
      });
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
        where: {
          organizationId: "org-1",
          phone: "+6599999999",
        },
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
    it("updates contact stage", async () => {
      const existing = makeContact();
      prisma.contact.findFirst.mockResolvedValue(existing);
      const updated = makeContact({ stage: "active" });
      prisma.contact.update.mockResolvedValue(updated);

      const result = await store.updateStage("org-1", "contact-1", "active");

      expect(prisma.contact.findFirst).toHaveBeenCalledWith({
        where: { id: "contact-1", organizationId: "org-1" },
      });
      expect(prisma.contact.update).toHaveBeenCalledWith({
        where: { id: "contact-1" },
        data: {
          stage: "active",
          updatedAt: expect.any(Date),
        },
      });
      expect(result.stage).toBe("active");
    });

    it("throws when contact not found or wrong org", async () => {
      prisma.contact.findFirst.mockResolvedValue(null);

      await expect(store.updateStage("org-1", "contact-999", "active")).rejects.toThrow(
        /not found or does not belong/,
      );
    });
  });

  describe("updateLastActivity", () => {
    it("updates lastActivityAt timestamp", async () => {
      const existing = makeContact();
      prisma.contact.findFirst.mockResolvedValue(existing);

      await store.updateLastActivity("org-1", "contact-1");

      expect(prisma.contact.findFirst).toHaveBeenCalledWith({
        where: { id: "contact-1", organizationId: "org-1" },
      });
      expect(prisma.contact.update).toHaveBeenCalledWith({
        where: { id: "contact-1" },
        data: {
          lastActivityAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
      });
    });

    it("throws when contact not found or wrong org", async () => {
      prisma.contact.findFirst.mockResolvedValue(null);

      await expect(store.updateLastActivity("org-1", "contact-999")).rejects.toThrow(
        /not found or does not belong/,
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
});
