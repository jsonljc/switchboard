// apps/api/src/services/reports/weekly-report-recipients.ts
// ---------------------------------------------------------------------------
// Resolve who receives the weekly owner report. The owner's own email is NOT
// patient PDPA data, so this is recipient-gated rather than consent-gated.
//
// Resolution order (per-org ONLY — never a process-global env list, or every
// config-less org would email its private digest to one shared inbox, P1-3):
//   1. The org's STORED recipients (OrganizationConfig.escalationConfig.emailRecipients)
//      win when present. There is no env fallback on this path.
//   2. Otherwise fall back to the org's OWN verified dashboard-user emails.
//
// Dependencies are injected so this is pure-unit testable without Prisma (CI has
// no Postgres). app.ts wires getStoredRecipients -> getStoredEscalationRecipients
// (stored-only, no env) and listVerifiedUserEmails -> the org-scoped emailVerified
// DashboardUser query.
// ---------------------------------------------------------------------------

export interface WeeklyReportRecipientDeps {
  /**
   * The org's STORED escalation recipients, with NO env fallback (see
   * getStoredEscalationRecipients). Returns [] when the org has none stored.
   */
  getStoredRecipients: (orgId: string) => Promise<string[]>;
  /** Verified dashboard-user emails for the org (emailVerified is non-null). */
  listVerifiedUserEmails: (orgId: string) => Promise<string[]>;
}

export async function resolveOwnerReportRecipients(
  deps: WeeklyReportRecipientDeps,
  orgId: string,
): Promise<string[]> {
  const stored = await deps.getStoredRecipients(orgId);
  if (stored.length > 0) {
    return stored;
  }
  return deps.listVerifiedUserEmails(orgId);
}
