import { describe, it, expect, vi, beforeEach } from "vitest";
import { StaleVersionError } from "@switchboard/core";
import { PrismaWhatsAppTestSendStore } from "../prisma-whatsapp-test-send-store.js";

function makePrisma() {
  return {
    whatsAppTestSend: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirstOrThrow: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
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
    it("throws StaleVersionError when no row matches messageId + organizationId", async () => {
      (prisma.whatsAppTestSend.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({
        count: 0,
      });

      await expect(
        store.updateWebhookStatus({
          messageId: "wamid.missing",
          organizationId: "org_1",
          status: "delivered",
          at: new Date("2026-05-15T12:00:00Z"),
        }),
      ).rejects.toBeInstanceOf(StaleVersionError);

      expect(prisma.whatsAppTestSend.updateMany).toHaveBeenCalledWith({
        where: { messageId: "wamid.missing", organizationId: "org_1" },
        data: { lastWebhookStatus: "delivered", lastWebhookAt: new Date("2026-05-15T12:00:00Z") },
      });
      expect(prisma.whatsAppTestSend.findFirstOrThrow).not.toHaveBeenCalled();
    });

    it("updates lastWebhookStatus and lastWebhookAt and returns the row (Pattern B)", async () => {
      const updatedAt = new Date("2026-05-15T13:00:05Z");
      const updated = {
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
        lastWebhookStatus: "delivered",
        lastWebhookAt: updatedAt,
      };
      (prisma.whatsAppTestSend.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({
        count: 1,
      });
      (prisma.whatsAppTestSend.findFirstOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
        updated,
      );

      const result = await store.updateWebhookStatus({
        messageId: "wamid.xyz789",
        organizationId: "org_1",
        status: "delivered",
        at: updatedAt,
      });

      expect(result).toEqual(updated);
      expect(prisma.whatsAppTestSend.updateMany).toHaveBeenCalledWith({
        where: { messageId: "wamid.xyz789", organizationId: "org_1" },
        data: { lastWebhookStatus: "delivered", lastWebhookAt: updatedAt },
      });
      expect(prisma.whatsAppTestSend.findFirstOrThrow).toHaveBeenCalledWith({
        where: { messageId: "wamid.xyz789", organizationId: "org_1" },
      });
    });

    it("throws StaleVersionError when organizationId mismatches (no matching row)", async () => {
      (prisma.whatsAppTestSend.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({
        count: 0,
      });

      await expect(
        store.updateWebhookStatus({
          messageId: "wamid.cross",
          status: "delivered",
          at: new Date("2026-05-15T14:00:05Z"),
          organizationId: "org_other",
        }),
      ).rejects.toBeInstanceOf(StaleVersionError);

      expect(prisma.whatsAppTestSend.findFirstOrThrow).not.toHaveBeenCalled();
    });
  });
});
