// ---------------------------------------------------------------------------
// Escalation Config Service — per-org escalation settings with env var fallback
// ---------------------------------------------------------------------------

import type { PrismaClient } from "@prisma/client";

export interface EscalationConfig {
  emailRecipients: string[];
  slaMinutes: number;
  notifyOnBreach: boolean;
}

interface StoredEscalationConfig {
  emailRecipients?: string[];
  slaMinutes?: number;
  notifyOnBreach?: boolean;
}

const DEFAULT_SLA_MINUTES = 60;

/**
 * Reads per-org escalation config from OrganizationConfig.escalationConfig.
 * Falls back to env vars if not set.
 */
export async function getEscalationConfig(
  prisma: PrismaClient,
  organizationId: string,
): Promise<EscalationConfig> {
  const orgConfig = await prisma.organizationConfig.findUnique({
    where: { id: organizationId },
    select: { escalationConfig: true },
  });

  const stored = orgConfig?.escalationConfig as StoredEscalationConfig | null;

  if (stored && Array.isArray(stored.emailRecipients)) {
    return {
      emailRecipients: stored.emailRecipients,
      slaMinutes: stored.slaMinutes ?? DEFAULT_SLA_MINUTES,
      notifyOnBreach: stored.notifyOnBreach ?? true,
    };
  }

  // Fallback to env vars
  const envRecipients = process.env.ESCALATION_EMAIL_RECIPIENTS;
  return {
    emailRecipients: envRecipients
      ? envRecipients
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean)
      : [],
    slaMinutes: Number(process.env.ESCALATION_SLA_MINUTES) || DEFAULT_SLA_MINUTES,
    notifyOnBreach: process.env.ESCALATION_NOTIFY_ON_BREACH !== "false",
  };
}
