import type { PrismaClient } from "@prisma/client";

// Local interfaces matching @switchboard/core ConversationStore shape.
// Structural typing avoids db→core layer violation.

type LifecycleStage = "lead" | "qualified" | "booked" | "treated" | "churned";

interface Message {
  id: string;
  contactId: string;
  direction: "inbound" | "outbound";
  content: string;
  timestamp: string;
  channel: "whatsapp" | "telegram" | "dashboard";
  metadata?: Record<string, unknown>;
}

export class PrismaConversationStore {
  constructor(
    private prisma: PrismaClient,
    private orgId: string,
  ) {}

  async getHistory(contactId: string): Promise<Message[]> {
    const rows = await this.prisma.conversationMessage.findMany({
      where: { contactId, orgId: this.orgId },
      orderBy: { createdAt: "asc" },
    });

    return rows.map((r) => ({
      id: r.id,
      contactId: r.contactId,
      direction: r.direction as "inbound" | "outbound",
      content: r.content,
      timestamp: r.createdAt.toISOString(),
      channel: r.channel as "whatsapp" | "telegram" | "dashboard",
      metadata: (r.metadata as Record<string, unknown>) ?? {},
    }));
  }

  async appendMessage(contactId: string, message: Message): Promise<void> {
    await this.prisma.conversationMessage.create({
      data: {
        id: message.id,
        contactId,
        orgId: this.orgId,
        direction: message.direction,
        content: message.content,
        channel: message.channel,
        metadata: (message.metadata as object) ?? {},
      },
    });
  }

  async getStage(contactId: string): Promise<LifecycleStage> {
    const record = await this.prisma.contactLifecycle.findUnique({
      where: { contactId_orgId: { contactId, orgId: this.orgId } },
    });
    return (record?.stage as LifecycleStage) ?? "lead";
  }

  async setStage(contactId: string, stage: LifecycleStage): Promise<void> {
    await this.prisma.contactLifecycle.upsert({
      where: { contactId_orgId: { contactId, orgId: this.orgId } },
      create: { contactId, orgId: this.orgId, stage },
      update: { stage },
    });
  }

  async isOptedOut(contactId: string): Promise<boolean> {
    const record = await this.prisma.contactLifecycle.findUnique({
      where: { contactId_orgId: { contactId, orgId: this.orgId } },
    });
    return record?.optedOut ?? false;
  }

  async setOptOut(contactId: string, optedOut: boolean): Promise<void> {
    await this.prisma.contactLifecycle.upsert({
      where: { contactId_orgId: { contactId, orgId: this.orgId } },
      create: { contactId, orgId: this.orgId, optedOut },
      update: { optedOut },
    });
  }
}
