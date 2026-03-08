// ---------------------------------------------------------------------------
// PrismaAdsOperatorConfigStore — DB-backed AdsOperatorConfig persistence
// ---------------------------------------------------------------------------

import type { PrismaClient } from "@prisma/client";
import {
  AdsOperatorConfigSchema,
  type AdsOperatorConfig,
  type AdsOperatorTargets,
  type AdsOperatorSchedule,
  type NotificationChannel,
  type PlatformType,
  type AutomationLevel,
} from "@switchboard/schemas";

/**
 * Maps a Prisma row (with JSON fields) to a validated AdsOperatorConfig.
 */
function toAdsOperatorConfig(row: {
  id: string;
  organizationId: string;
  adAccountIds: string[];
  platforms: string[];
  automationLevel: string;
  targets: unknown;
  schedule: unknown;
  notificationChannel: unknown;
  principalId: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}): AdsOperatorConfig {
  return AdsOperatorConfigSchema.parse({
    id: row.id,
    organizationId: row.organizationId,
    adAccountIds: row.adAccountIds,
    platforms: row.platforms as PlatformType[],
    automationLevel: row.automationLevel as AutomationLevel,
    targets: row.targets as AdsOperatorTargets,
    schedule: row.schedule as AdsOperatorSchedule,
    notificationChannel: row.notificationChannel as NotificationChannel,
    principalId: row.principalId,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export class PrismaAdsOperatorConfigStore {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    input: Omit<AdsOperatorConfig, "id" | "createdAt" | "updatedAt">,
  ): Promise<AdsOperatorConfig> {
    const row = await this.prisma.adsOperatorConfig.create({
      data: {
        organizationId: input.organizationId,
        adAccountIds: input.adAccountIds,
        platforms: input.platforms,
        automationLevel: input.automationLevel,
        targets: input.targets as object,
        schedule: input.schedule as object,
        notificationChannel: input.notificationChannel as object,
        principalId: input.principalId,
        active: input.active,
      },
    });
    return toAdsOperatorConfig(row);
  }

  async getByOrg(organizationId: string): Promise<AdsOperatorConfig | null> {
    const row = await this.prisma.adsOperatorConfig.findFirst({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
    });
    return row ? toAdsOperatorConfig(row) : null;
  }

  async listActive(): Promise<AdsOperatorConfig[]> {
    const rows = await this.prisma.adsOperatorConfig.findMany({
      where: { active: true },
    });
    return rows.map(toAdsOperatorConfig);
  }

  async update(
    id: string,
    updates: Partial<
      Omit<AdsOperatorConfig, "id" | "organizationId" | "principalId" | "createdAt" | "updatedAt">
    >,
  ): Promise<AdsOperatorConfig> {
    const data: Record<string, unknown> = {};
    if (updates.adAccountIds !== undefined) data["adAccountIds"] = updates.adAccountIds;
    if (updates.platforms !== undefined) data["platforms"] = updates.platforms;
    if (updates.automationLevel !== undefined) data["automationLevel"] = updates.automationLevel;
    if (updates.targets !== undefined) data["targets"] = updates.targets as object;
    if (updates.schedule !== undefined) data["schedule"] = updates.schedule as object;
    if (updates.notificationChannel !== undefined)
      data["notificationChannel"] = updates.notificationChannel as object;
    if (updates.active !== undefined) data["active"] = updates.active;

    const row = await this.prisma.adsOperatorConfig.update({
      where: { id },
      data,
    });
    return toAdsOperatorConfig(row);
  }

  async deactivate(id: string): Promise<void> {
    await this.prisma.adsOperatorConfig.update({
      where: { id },
      data: { active: false },
    });
  }
}
