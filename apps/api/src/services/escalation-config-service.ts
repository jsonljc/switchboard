// ---------------------------------------------------------------------------
// Escalation Config Service — per-org escalation settings with env var fallback
// ---------------------------------------------------------------------------

import type { PrismaClient } from "@switchboard/db";

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

/**
 * Owner-report-safe recipient read: returns ONLY the per-org STORED escalation
 * recipients (OrganizationConfig.escalationConfig.emailRecipients), with NO env
 * fallback. Unlike getEscalationConfig, this never reads the process-global
 * ESCALATION_EMAIL_RECIPIENTS, so a config-less org can never inherit another
 * tenant's shared inbox. The weekly owner-report resolver consumes this and
 * falls through to the org's own verified dashboard users when it is empty.
 *
 * Do NOT add an env fallback here — that would re-open the cross-tenant leak
 * (P1-3) this function exists to close.
 */
export async function getStoredEscalationRecipients(
  prisma: PrismaClient,
  organizationId: string,
): Promise<string[]> {
  const orgConfig = await prisma.organizationConfig.findUnique({
    where: { id: organizationId },
    select: { escalationConfig: true },
  });

  const stored = orgConfig?.escalationConfig as StoredEscalationConfig | null;
  return stored && Array.isArray(stored.emailRecipients) ? stored.emailRecipients : [];
}
