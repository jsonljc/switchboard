import type { PrismaClient } from "@prisma/client";
import type { BusinessFacts } from "@switchboard/schemas";

export class PrismaBusinessFactsStore {
  constructor(private prisma: PrismaClient) {}

  async get(organizationId: string): Promise<BusinessFacts | null> {
    const row = await this.prisma.businessConfig.findUnique({
      where: { organizationId },
    });
    if (!row) return null;
    return row.config as unknown as BusinessFacts;
  }

  async upsert(organizationId: string, facts: BusinessFacts): Promise<void> {
    await this.prisma.businessConfig.upsert({
      where: { organizationId },
      create: { organizationId, config: facts as object },
      update: { config: facts as object },
    });
  }
}
