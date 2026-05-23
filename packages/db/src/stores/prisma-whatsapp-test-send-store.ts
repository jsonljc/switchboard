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
  /** Required tenant guard. Enforces that the updated row belongs to this org. */
  organizationId: string;
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
    // Best-effort, tenant-scoped status sink. WhatsAppTestSend tracks only operator
    // test sends, but WhatsApp delivery webhooks fire for ALL outbound messages — a
    // messageId not in this table (the common case) is expected and must no-op, not
    // throw. The required organizationId still scopes the write to the caller's tenant.
    const result = await this.prisma.whatsAppTestSend.updateMany({
      where: { messageId: input.messageId, organizationId: input.organizationId },
      data: { lastWebhookStatus: input.status, lastWebhookAt: input.at },
    });
    if (result.count === 0) return null;
    const updated = await this.prisma.whatsAppTestSend.findFirstOrThrow({
      where: { messageId: input.messageId, organizationId: input.organizationId },
    });
    return updated as WhatsAppTestSendRow;
  }
}
