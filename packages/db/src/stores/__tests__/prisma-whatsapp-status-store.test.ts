import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaWhatsAppStatusStore } from "../prisma-whatsapp-status-store.js";

function makePrisma() {
  return {
    whatsAppMessageStatus: {
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

describe("PrismaWhatsAppStatusStore", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let store: PrismaWhatsAppStatusStore;

  beforeEach(() => {
    prisma = makePrisma();
    store = new PrismaWhatsAppStatusStore(prisma as never);
  });

  describe("upsert", () => {
    it("creates a new status record", async () => {
      const input = {
        messageId: "wamid.abc123",
        recipientId: "15551234567",
        status: "sent",
        timestamp: new Date("2026-04-25T10:00:00Z"),
        organizationId: "org_1",
      };
      const expected = {
        id: "ws_1",
        ...input,
        errorCode: null,
        errorTitle: null,
        pricingCategory: null,
        billable: null,
        createdAt: new Date(),
      };
      (prisma.whatsAppMessageStatus.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(expected);

      const result = await store.upsert(input);

      expect(result.id).toBe("ws_1");
      expect(result.messageId).toBe("wamid.abc123");
      expect(prisma.whatsAppMessageStatus.upsert).toHaveBeenCalledWith({
        where: {
          messageId_status: {
            messageId: "wamid.abc123",
            status: "sent",
          },
        },
        update: {
          timestamp: input.timestamp,
          errorCode: undefined,
          errorTitle: undefined,
        },
        create: {
          messageId: "wamid.abc123",
          recipientId: "15551234567",
          status: "sent",
          timestamp: input.timestamp,
          errorCode: undefined,
          errorTitle: undefined,
          pricingCategory: undefined,
          billable: undefined,
          organizationId: "org_1",
        },
      });
    });

    it("upserts a failed status with error details", async () => {
      const input = {
        messageId: "wamid.abc123",
        recipientId: "15551234567",
        status: "failed",
        timestamp: new Date("2026-04-25T10:01:00Z"),
        errorCode: "131047",
        errorTitle: "Re-engagement message",
        organizationId: "org_1",
      };
      const expected = {
        id: "ws_2",
        ...input,
        pricingCategory: null,
        billable: null,
        createdAt: new Date(),
      };
      (prisma.whatsAppMessageStatus.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(expected);

      const result = await store.upsert(input);

      expect(result.errorCode).toBe("131047");
      expect(result.errorTitle).toBe("Re-engagement message");
      expect(prisma.whatsAppMessageStatus.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            errorCode: "131047",
            errorTitle: "Re-engagement message",
          }),
        }),
      );
    });

    it("upserts with pricing metadata", async () => {
      const input = {
        messageId: "wamid.abc123",
        recipientId: "15551234567",
        status: "delivered",
        timestamp: new Date("2026-04-25T10:02:00Z"),
        pricingCategory: "business_initiated",
        billable: true,
      };
      const expected = {
        id: "ws_3",
        ...input,
        errorCode: null,
        errorTitle: null,
        organizationId: null,
        createdAt: new Date(),
      };
      (prisma.whatsAppMessageStatus.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(expected);

      const result = await store.upsert(input);

      expect(result.pricingCategory).toBe("business_initiated");
      expect(result.billable).toBe(true);
    });
  });

  describe("getByMessageId", () => {
    it("returns statuses ordered by timestamp ascending", async () => {
      const statuses = [
        {
          id: "ws_1",
          messageId: "wamid.abc123",
          recipientId: "15551234567",
          status: "sent",
          timestamp: new Date("2026-04-25T10:00:00Z"),
        },
        {
          id: "ws_2",
          messageId: "wamid.abc123",
          recipientId: "15551234567",
          status: "delivered",
          timestamp: new Date("2026-04-25T10:01:00Z"),
        },
        {
          id: "ws_3",
          messageId: "wamid.abc123",
          recipientId: "15551234567",
          status: "read",
          timestamp: new Date("2026-04-25T10:02:00Z"),
        },
      ];
      (prisma.whatsAppMessageStatus.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
        statuses,
      );

      const result = await store.getByMessageId("wamid.abc123");

      expect(result).toHaveLength(3);
      expect(result[0]!.status).toBe("sent");
      expect(result[2]!.status).toBe("read");
      expect(prisma.whatsAppMessageStatus.findMany).toHaveBeenCalledWith({
        where: { messageId: "wamid.abc123" },
        orderBy: { timestamp: "asc" },
      });
    });

    it("returns empty array when no statuses found", async () => {
      (prisma.whatsAppMessageStatus.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await store.getByMessageId("wamid.nonexistent");

      expect(result).toEqual([]);
    });
  });
});
