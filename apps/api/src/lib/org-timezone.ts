import type { PrismaClient } from "@switchboard/db";
import { BusinessHoursConfigSchema } from "@switchboard/schemas/calendar";

export const ORG_TIMEZONE_FALLBACK = "Asia/Singapore";

/**
 * Read the org's configured timezone from OrganizationConfig.businessHours
 * (a Json column conforming to BusinessHoursConfigSchema). Falls back to
 * "Asia/Singapore" when prisma is null, businessHours is null, unparseable,
 * or the timezone field is missing.
 */
export async function getOrgTimezone(prisma: PrismaClient | null, orgId: string): Promise<string> {
  if (!prisma) return ORG_TIMEZONE_FALLBACK;

  const row = await prisma.organizationConfig.findFirst({
    where: { id: orgId },
    select: { businessHours: true },
  });

  if (
    !row?.businessHours ||
    typeof row.businessHours !== "object" ||
    Array.isArray(row.businessHours)
  ) {
    return ORG_TIMEZONE_FALLBACK;
  }

  const parsed = BusinessHoursConfigSchema.safeParse(row.businessHours);
  if (!parsed.success) return ORG_TIMEZONE_FALLBACK;

  return parsed.data.timezone || ORG_TIMEZONE_FALLBACK;
}
