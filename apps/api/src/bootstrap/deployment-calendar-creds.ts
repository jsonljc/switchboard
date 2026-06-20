import { decryptCredentials, type PrismaClient } from "@switchboard/db";

export interface DeploymentCalendarCreds {
  refreshToken: string;
  calendarId: string;
}

/**
 * Resolve a clinic's OWN Google Calendar OAuth credentials from the per-deployment
 * DeploymentConnection that the google-calendar-oauth callback writes (type "google_calendar").
 *
 * Tenant safety: the lookup is org-scoped through the deployment relation, so one org can never
 * read another's tokens (mirrors PrismaDeploymentConnectionStore.findByDeploymentAndTypeForOrg).
 * The pilot runs one deployment per org (skill-mode.ts), so findFirst is deterministic; ordering by
 * updatedAt desc picks the freshest connection if that ever stops holding.
 *
 * Returns null when the org has no connected calendar (or the stored creds lack a refresh token),
 * letting the calendar factory fall back to the global service account / Local / Noop.
 *
 * `decrypt` is injectable for hermetic tests; production uses the real CREDENTIALS_ENCRYPTION_KEY
 * path. Never log the returned tokens.
 */
export async function resolveOrgGoogleCalendarCreds(
  prismaClient: PrismaClient,
  orgId: string,
  decrypt: (blob: string) => Record<string, unknown> = decryptCredentials,
): Promise<DeploymentCalendarCreds | null> {
  const connection = await prismaClient.deploymentConnection.findFirst({
    where: { type: "google_calendar", deployment: { organizationId: orgId } },
    orderBy: { updatedAt: "desc" },
    select: { credentials: true },
  });
  if (!connection) return null;

  const creds = decrypt(connection.credentials);
  const refreshToken = typeof creds["refreshToken"] === "string" ? creds["refreshToken"] : "";
  if (!refreshToken) return null;

  const calendarId =
    typeof creds["calendarId"] === "string" && creds["calendarId"]
      ? creds["calendarId"]
      : "primary";

  return { refreshToken, calendarId };
}
