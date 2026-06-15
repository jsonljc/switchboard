/**
 * Pure builder for the `Connection` row persisted after a WhatsApp Embedded
 * Signup (ESU) onboard. Kept side-effect-free (no Prisma, no crypto) so it is
 * unit-testable in isolation; the caller encrypts `credentials` with
 * `encryptCredentials` and writes the row.
 *
 * Why this exists: the previous inline persistence (bootstrap/routes.ts) wrote
 * `token: <wabaId>` (the WABA id, NOT an access token) and `organizationId: ""`,
 * with no `appSecret`/`verifyToken`. The runtime adapter
 * (apps/chat runtime-registry.ts:167-172) reads `creds.token` as the Bearer and
 * `creds.appSecret`/`creds.verifyToken` for inbound verification, so that row
 * could never send or receive. This builder produces a row the runtime can
 * actually run.
 *
 * Token model (decision D-b): the runtime credential is the central
 * System-User token (`META_SYSTEM_USER_TOKEN`), passed in here as
 * `runtimeToken`. The onboard route already performs all real Graph calls with
 * that same system token; persisting it as `creds.token` keeps the runtime on
 * one long-lived credential with no per-tenant token to rotate.
 */

export interface WhatsAppOnboardConnectionInput {
  /** The authenticated operator's organization. Never empty in prod (resolved
   *  via resolveOrganizationForMutation, which 403s without an org binding). */
  organizationId: string;
  /** WhatsApp Business Account id (stored as Connection.externalAccountId). */
  wabaId: string;
  /** Cloud API phone-number id the runtime sends from. */
  phoneNumberId: string;
  /** Human-readable number for display, if Graph returned one. */
  displayPhoneNumber?: string;
  /** The Bearer the runtime adapter authenticates Graph sends with. */
  runtimeToken: string;
  /** Meta app secret — inbound POST X-Hub-Signature-256 HMAC key. */
  appSecret: string;
  /** Webhook GET handshake token — MUST equal the `verify_token` registered
   *  with Meta via subscribed_apps, or the GET handshake 403s. */
  verifyToken: string;
}

export interface WhatsAppOnboardConnectionData {
  /** Fields for `prisma.connection.create({ data })` (sans `id`/`credentials`). */
  connection: {
    organizationId: string;
    serviceId: "whatsapp";
    serviceName: "whatsapp";
    authType: "bot_token";
    scopes: string[];
    externalAccountId: string;
  };
  /** PLAINTEXT credentials — the caller encrypts these before persisting. */
  credentials: {
    token: string;
    phoneNumberId: string;
    primaryPhoneNumberId: string;
    displayPhoneNumber?: string;
    appSecret: string;
    verifyToken: string;
  };
}

export function buildWhatsAppOnboardConnection(
  input: WhatsAppOnboardConnectionInput,
): WhatsAppOnboardConnectionData {
  return {
    connection: {
      organizationId: input.organizationId,
      serviceId: "whatsapp",
      serviceName: "whatsapp",
      authType: "bot_token",
      scopes: [],
      externalAccountId: input.wabaId,
    },
    credentials: {
      token: input.runtimeToken,
      phoneNumberId: input.phoneNumberId,
      // The management page reads `primaryPhoneNumberId`; the runtime reads
      // `phoneNumberId`. Keep both, as the prior persistence did.
      primaryPhoneNumberId: input.phoneNumberId,
      displayPhoneNumber: input.displayPhoneNumber,
      appSecret: input.appSecret,
      verifyToken: input.verifyToken,
    },
  };
}
