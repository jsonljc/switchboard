import type { PrismaClient } from "@prisma/client";

export interface WhatsAppStatusRecord {
  id: string;
  messageId: string;
  recipientId: string;
  status: string;
  timestamp: Date;
  errorCode?: string | null;
  errorTitle?: string | null;
  pricingCategory?: string | null;
  billable?: boolean | null;
  organizationId?: string | null;
}

export interface UpsertStatusInput {
  messageId: string;
  recipientId: string;
  status: string;
  timestamp: Date;
  errorCode?: string;
  errorTitle?: string;
  pricingCategory?: string;
  billable?: boolean;
  organizationId?: string;
}

export class PrismaWhatsAppStatusStore {
  constructor(private readonly prisma: PrismaClient) {}

  async upsert(input: UpsertStatusInput): Promise<WhatsAppStatusRecord> {
    return this.prisma.whatsAppMessageStatus.upsert({
      where: {
        messageId_status: {
          messageId: input.messageId,
          status: input.status,
        },
      },
      update: {
        timestamp: input.timestamp,
        errorCode: input.errorCode,
        errorTitle: input.errorTitle,
      },
      create: {
        messageId: input.messageId,
        recipientId: input.recipientId,
        status: input.status,
        timestamp: input.timestamp,
        errorCode: input.errorCode,
        errorTitle: input.errorTitle,
        pricingCategory: input.pricingCategory,
        billable: input.billable,
        organizationId: input.organizationId,
      },
    });
  }

  async getByMessageId(messageId: string): Promise<WhatsAppStatusRecord[]> {
    return this.prisma.whatsAppMessageStatus.findMany({
      where: { messageId },
      orderBy: { timestamp: "asc" },
    });
  }
}
