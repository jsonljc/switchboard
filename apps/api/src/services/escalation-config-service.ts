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

export interface EscalationRecipientResolutionDeps {
  /**
   * The org's STORED escalation recipients, with NO env fallback (see
   * getStoredEscalationRecipients). Returns [] when the org has none stored.
   */
  getStoredRecipients: (orgId: string) => Promise<string[]>;
  /** Verified dashboard-user emails for the org (emailVerified is non-null). */
  listVerifiedUserEmails: (orgId: string) => Promise<string[]>;
}

/**
 * Resolves who is notified when an agent escalates a conversation to a human,
 * PER organization. A handoff carries leadSnapshot PII, so it must route to the
 * escalating org's OWN recipients — never a process-global env list, which would
 * broadcast one tenant's handoff to a shared inbox.
 *
 * Resolution order (per-org ONLY, no env fallback):
 *   1. The org's STORED escalation recipients win when present.
 *   2. Otherwise fall back to the org's OWN verified dashboard-user emails.
 *
 * Structurally mirrors resolveOwnerReportRecipients (same isolation rule) but is
 * a DISTINCT function on purpose: a future change to owner-report routing must
 * never silently alter live human-escalation routing.
 */
export async function resolveEscalationRecipients(
  deps: EscalationRecipientResolutionDeps,
  orgId: string,
): Promise<string[]> {
  const stored = await deps.getStoredRecipients(orgId);
  if (stored.length > 0) {
    return stored;
  }
  return deps.listVerifiedUserEmails(orgId);
}
