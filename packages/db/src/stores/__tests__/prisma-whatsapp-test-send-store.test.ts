import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaWhatsAppTestSendStore } from "../prisma-whatsapp-test-send-store.js";

function makePrisma() {
  return {
    whatsAppTestSend: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };
}

describe("PrismaWhatsAppTestSendStore", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let store: PrismaWhatsAppTestSendStore;

  beforeEach(() => {
    prisma = makePrisma();
    store = new PrismaWhatsAppTestSendStore(prisma as never);
  });

  describe("create", () => {
    it("calls whatsAppTestSend.create with the input and returns the row", async () => {
      const input = {
        organizationId: "org_1",
        managedChannelId: "mc_1",
        messageId: "wamid.abc123",
        phoneNumberId: "pn_1",
        templateName: "hello_world",
        languageCode: "en_US",
        toNumber: "15551234567",
        sentBy: "user_1",
        sentAt: new Date("2026-05-15T10:00:00Z"),
        apiStatus: "sent" as const,
      };
      const expected = {
        id: "wts_1",
        ...input,
        lastWebhookStatus: null,
        lastWebhookAt: null,
      };
      (prisma.whatsAppTestSend.create as ReturnType<typeof vi.fn>).mockResolvedValue(expected);

      const result = await store.create(input);

      expect(result).toEqual(expected);
      expect(prisma.whatsAppTestSend.create).toHaveBeenCalledWith({ data: input });
    });
  });

  describe("listRecent", () => {
    it("queries by organizationId, orders by sentAt desc, takes limit", async () => {
      const rows = [
        {
          id: "wts_2",
          organizationId: "org_1",
          managedChannelId: "mc_1",
          messageId: "wamid.def456",
          phoneNumberId: "pn_1",
          templateName: "hello_world",
          languageCode: "en_US",
          toNumber: "15551234568",
          sentBy: "user_1",
          sentAt: new Date("2026-05-15T11:00:00Z"),
          apiStatus: "sent",
          lastWebhookStatus: "delivered",
          lastWebhookAt: new Date("2026-05-15T11:00:05Z"),
        },
      ];
      (prisma.whatsAppTestSend.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(rows);

      const result = await store.listRecent("org_1", 10);

      expect(result).toEqual(rows);
      expect(prisma.whatsAppTestSend.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org_1" },
        orderBy: { sentAt: "desc" },
        take: 10,
      });
    });
  });

  describe("updateWebhookStatus", () => {
    it("returns null when no row exists for messageId and does not call update", async () => {
      (prisma.whatsAppTestSend.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await store.updateWebhookStatus({
        messageId: "wamid.missing",
        status: "delivered",
        at: new Date("2026-05-15T12:00:00Z"),
      });

      expect(result).toBeNull();
      expect(prisma.whatsAppTestSend.findUnique).toHaveBeenCalledWith({
        where: { messageId: "wamid.missing" },
      });
      expect(prisma.whatsAppTestSend.update).not.toHaveBeenCalled();
    });

    it("updates lastWebhookStatus and lastWebhookAt when row exists", async () => {
      const existing = {
        id: "wts_3",
        organizationId: "org_1",
        managedChannelId: "mc_1",
        messageId: "wamid.xyz789",
        phoneNumberId: "pn_1",
        templateName: "hello_world",
        languageCode: "en_US",
        toNumber: "15551234569",
        sentBy: "user_1",
        sentAt: new Date("2026-05-15T13:00:00Z"),
        apiStatus: "sent",
        lastWebhookStatus: null,
        lastWebhookAt: null,
      };
      const updatedAt = new Date("2026-05-15T13:00:05Z");
      const updated = {
        ...existing,
        lastWebhookStatus: "delivered",
        lastWebhookAt: updatedAt,
      };
      (prisma.whatsAppTestSend.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(existing);
      (prisma.whatsAppTestSend.update as ReturnType<typeof vi.fn>).mockResolvedValue(updated);

      const result = await store.updateWebhookStatus({
        messageId: "wamid.xyz789",
        status: "delivered",
        at: updatedAt,
      });

      expect(result).toEqual(updated);
      expect(prisma.whatsAppTestSend.update).toHaveBeenCalledWith({
        where: { messageId: "wamid.xyz789" },
        data: { lastWebhookStatus: "delivered", lastWebhookAt: updatedAt },
      });
    });
  });
});
