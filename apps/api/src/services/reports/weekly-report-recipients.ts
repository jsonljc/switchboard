// apps/api/src/services/reports/weekly-report-recipients.ts
// ---------------------------------------------------------------------------
// Resolve who receives the weekly owner report. The owner's own email is NOT
// patient PDPA data, so this is recipient-gated rather than consent-gated.
//
// Resolution order:
//   1. The per-org escalation config recipients (OrganizationConfig.escalationConfig
//      or the ESCALATION_EMAIL_RECIPIENTS env fallback) win when present.
//   2. Otherwise fall back to the org's verified dashboard-user emails.
//
// Dependencies are injected so this is pure-unit testable without Prisma (CI has
// no Postgres). app.ts wires getConfig -> getEscalationConfig and
// listVerifiedUserEmails -> the emailVerified DashboardUser query.
// ---------------------------------------------------------------------------

export interface WeeklyReportRecipientDeps {
  /** Per-org escalation config read; only `emailRecipients` is consumed. */
  getConfig: (orgId: string) => Promise<{ emailRecipients: string[] }>;
  /** Verified dashboard-user emails for the org (emailVerified is non-null). */
  listVerifiedUserEmails: (orgId: string) => Promise<string[]>;
}

export async function resolveOwnerReportRecipients(
  deps: WeeklyReportRecipientDeps,
  orgId: string,
): Promise<string[]> {
  const config = await deps.getConfig(orgId);
  if (config.emailRecipients.length > 0) {
    return config.emailRecipients;
  }
  return deps.listVerifiedUserEmails(orgId);
}
