import type { PrismaClient, WebhookRegistration } from "@prisma/client";

export class PrismaWebhookStore {
  constructor(private prisma: PrismaClient) {}

  async create(data: {
    organizationId: string;
    url: string;
    events: string[];
    secret: string;
  }): Promise<WebhookRegistration> {
    return this.prisma.webhookRegistration.create({ data });
  }

  async list(organizationId: string): Promise<WebhookRegistration[]> {
    return this.prisma.webhookRegistration.findMany({
      where: { organizationId, active: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async getById(id: string): Promise<WebhookRegistration | null> {
    return this.prisma.webhookRegistration.findUnique({ where: { id } });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.webhookRegistration.update({
      where: { id },
      data: { active: false },
    });
  }

  async updateLastTriggered(id: string): Promise<void> {
    await this.prisma.webhookRegistration.update({
      where: { id },
      data: { lastTriggeredAt: new Date() },
    });
  }
}
