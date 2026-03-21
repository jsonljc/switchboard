// ---------------------------------------------------------------------------
// Prisma Business Config Store — runtime persistence for business profiles
// ---------------------------------------------------------------------------

import type { PrismaClient } from "@prisma/client";
import type { BusinessProfile } from "@switchboard/schemas";

export interface ConfigVersionRecord {
  id: string;
  version: string;
  changedBy: string;
  changeDescription?: string;
  status: string;
  createdAt: Date;
}

export class PrismaBusinessConfigStore {
  constructor(private prisma: PrismaClient) {}

  async getByOrgId(organizationId: string): Promise<BusinessProfile | null> {
    const record = await this.prisma.businessConfig.findUnique({
      where: { organizationId },
    });
    if (!record) return null;
    return record.config as unknown as BusinessProfile;
  }

  async save(
    organizationId: string,
    config: BusinessProfile,
    changedBy: string,
    changeDescription?: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.businessConfig.findUnique({
        where: { organizationId },
      });

      if (existing) {
        // Create version snapshot of previous config
        await tx.configVersion.create({
          data: {
            businessConfigId: existing.id,
            version: config.version,
            config: JSON.parse(JSON.stringify(config)),
            changedBy,
            changeDescription,
            status: "active",
          },
        });

        // Update current config
        await tx.businessConfig.update({
          where: { organizationId },
          data: { config: JSON.parse(JSON.stringify(config)) },
        });
      } else {
        const created = await tx.businessConfig.create({
          data: {
            organizationId,
            config: JSON.parse(JSON.stringify(config)),
          },
        });

        await tx.configVersion.create({
          data: {
            businessConfigId: created.id,
            version: config.version,
            config: JSON.parse(JSON.stringify(config)),
            changedBy,
            changeDescription,
            status: "active",
          },
        });
      }
    });
  }

  async listVersions(organizationId: string): Promise<ConfigVersionRecord[]> {
    const businessConfig = await this.prisma.businessConfig.findUnique({
      where: { organizationId },
      include: {
        versions: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });

    if (!businessConfig) return [];

    return businessConfig.versions.map((v) => ({
      id: v.id,
      version: v.version,
      changedBy: v.changedBy,
      changeDescription: v.changeDescription ?? undefined,
      status: v.status,
      createdAt: v.createdAt,
    }));
  }
}
