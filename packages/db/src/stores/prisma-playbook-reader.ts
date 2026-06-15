import type { PrismaClient } from "@prisma/client";
import { PlaybookSchema, type Playbook } from "@switchboard/schemas";
import type { PlaybookReader } from "@switchboard/core";

/**
 * Reads an org's structured onboarding playbook (`OrganizationConfig.onboardingPlaybook`,
 * a `Json?` column whose `id` IS the orgId, written by the onboarding flow / playbook
 * route) and implements the core `PlaybookReader` port.
 *
 * A missing or malformed playbook degrades to `null` (abstain) rather than throwing
 * mid-turn: both consumers (the booking-value resolver and the qualification hook)
 * treat `null` as "no playbook", which is the safe default. Mirrors
 * `PrismaBusinessFactsStore`: it warns WITHOUT dumping the raw config, which can
 * hold business PII (names, locations, escalation contacts).
 */
export class PrismaPlaybookReader implements PlaybookReader {
  constructor(private prisma: PrismaClient) {}

  async readForOrganization(organizationId: string): Promise<Playbook | null> {
    const config = await this.prisma.organizationConfig.findUnique({
      where: { id: organizationId },
      select: { onboardingPlaybook: true },
    });
    const raw = config?.onboardingPlaybook ?? null;
    if (raw === null) return null; // no org config row, or no playbook persisted
    const parsed = PlaybookSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn("[PrismaPlaybookReader] malformed OrganizationConfig.onboardingPlaybook", {
        organizationId,
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), code: i.code })),
      });
      return null; // abstain on invalid
    }
    return parsed.data;
  }
}
