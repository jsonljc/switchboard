import type { PrismaClient } from "@prisma/client";

export type ApiStatus = "sent" | "failed";
export type WebhookStatus = "sent" | "delivered" | "read" | "failed";

export interface WhatsAppTestSendRow {
  id: string;
  organizationId: string;
  managedChannelId: string;
  messageId: string;
  phoneNumberId: string;
  templateName: string;
  languageCode: string;
  toNumber: string;
  sentBy: string;
  sentAt: Date;
  apiStatus: ApiStatus;
  lastWebhookStatus: WebhookStatus | null;
  lastWebhookAt: Date | null;
}

export interface WhatsAppTestSendCreateInput {
  organizationId: string;
  managedChannelId: string;
  messageId: string;
  phoneNumberId: string;
  templateName: string;
  languageCode: string;
  toNumber: string;
  sentBy: string;
  sentAt: Date;
  apiStatus: ApiStatus;
}

export interface UpdateWebhookStatusInput {
  messageId: string;
  status: WebhookStatus;
  at: Date;
}

export class PrismaWhatsAppTestSendStore {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: WhatsAppTestSendCreateInput): Promise<WhatsAppTestSendRow> {
    const row = await this.prisma.whatsAppTestSend.create({ data: input });
    return row as WhatsAppTestSendRow;
  }

  async listRecent(organizationId: string, limit: number): Promise<WhatsAppTestSendRow[]> {
    const rows = await this.prisma.whatsAppTestSend.findMany({
      where: { organizationId },
      orderBy: { sentAt: "desc" },
      take: limit,
    });
    return rows as WhatsAppTestSendRow[];
  }

  async updateWebhookStatus(input: UpdateWebhookStatusInput): Promise<WhatsAppTestSendRow | null> {
    const existing = await this.prisma.whatsAppTestSend.findUnique({
      where: { messageId: input.messageId },
    });
    if (!existing) return null;
    const updated = await this.prisma.whatsAppTestSend.update({
      where: { messageId: input.messageId },
      data: { lastWebhookStatus: input.status, lastWebhookAt: input.at },
    });
    return updated as WhatsAppTestSendRow;
  }
}
