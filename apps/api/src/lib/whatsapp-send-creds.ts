/**
 * Per-org resolver for the WhatsApp Cloud API **send** credentials (token +
 * phone-number id), the multi-tenant fix for the proactive outbound paths
 * (reminder, follow-up, lead greeting, Robin recovery).
 *
 * Why this exists: those send sites historically read a single GLOBAL env
 * `WHATSAPP_PHONE_NUMBER_ID` (and a global token), so a second tenant would send
 * FROM the first tenant's number, a cross-tenant correctness/compliance bug. The
 * canonical per-org source is the org-level `Connection` row with serviceId
 * "whatsapp" (built by buildWhatsAppOnboardConnection: credentials carry `token`
 * and `phoneNumberId`). DeploymentConnection type "whatsapp" does NOT hold these
 * (no producer), so it is deliberately NOT consulted here.
 *
 * The resolver returns the org's creds when a connection exists, or `null` when
 * it does not, letting each call site apply a PER-FIELD fallback to the global
 * env values for the single-tenant pilot (where no per-org Connection is seeded).
 * Read is per-request with NO caching: a token/number rotation or a freshly
 * onboarded tenant takes effect on the next send, and one cached creds blob can
 * never bleed across orgs.
 *
 * Deliberate semantics (reviewed, not gaps): the global env fallback exists ONLY
 * for the single-tenant pilot, which has no per-org Connection at all. An
 * onboarded tenant's Connection always carries its own phoneNumberId (the onboard
 * route rejects a WABA with no phone), so it sends from its own number; only the
 * token may fall back to the global system-user token, matching the inbound
 * runtime-token precedence (the Meta Tech Provider model: one system token, many
 * per-org WABA numbers). Connection status is intentionally NOT gated here: a
 * revoked or broken connection fails at the Graph call on the org's OWN number
 * rather than silently rerouting the patient send through the global pilot number.
 */

/**
 * Narrow read surface this resolver needs. PrismaConnectionStore satisfies it
 * (its getByService returns a decrypted, org-scoped ConnectionRecord), but the
 * lib depends only on this method shape so it stays Prisma-free and unit-testable
 * and the workflow files importing it never pull in @switchboard/db.
 */
export interface ConnectionCredentialReader {
  getByService: (
    serviceId: string,
    organizationId?: string,
  ) => Promise<{ credentials: Record<string, unknown> } | null>;
}

/** Decrypted per-org WhatsApp send credentials. A field is null when the stored
 * connection omits it or holds a non-string value (never leak a non-string Bearer
 * / phone id into a Graph request). */
export interface OrgWhatsAppSendCreds {
  token: string | null;
  phoneNumberId: string | null;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Resolve the sending org's own WhatsApp send credentials from its canonical
 * "whatsapp" Connection. Returns null when the org has no such connection (the
 * call site then falls back to the global env values).
 */
export async function resolveOrgWhatsAppSendCreds(
  connectionStore: ConnectionCredentialReader,
  organizationId: string,
): Promise<OrgWhatsAppSendCreds | null> {
  const record = await connectionStore.getByService("whatsapp", organizationId);
  if (!record) return null;
  return {
    token: asStringOrNull(record.credentials.token),
    phoneNumberId: asStringOrNull(record.credentials.phoneNumberId),
  };
}
