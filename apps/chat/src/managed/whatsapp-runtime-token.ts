/**
 * Resolve the Bearer the WhatsApp runtime adapter authenticates Graph calls
 * with, per token-model decision D-b.
 *
 * Order:
 *   1. A per-connection token stored in `creds.token` (the BYOT path, and the
 *      token ESU onboarding persists today) takes precedence.
 *   2. Otherwise the central `META_SYSTEM_USER_TOKEN` (the Tech-Provider system
 *      user) is used, so a connection provisioned WITHOUT a per-tenant token
 *      still runs instead of failing to load.
 *   3. If neither is present, `undefined` — the caller treats that as an
 *      unconfigured channel (returns no adapter) rather than sending with no
 *      credential.
 *
 * Kept as a pure function so the precedence is unit-tested without constructing
 * an adapter or touching the registry.
 */
export function resolveWhatsAppRuntimeToken(
  creds: Record<string, unknown>,
  systemUserToken: string | undefined,
): string | undefined {
  return (creds["token"] as string | undefined) || systemUserToken || undefined;
}
