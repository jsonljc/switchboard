/**
 * Synchronous WhatsApp health probe used during provision.
 *
 * Calls Meta Graph API GET /<apiVersion>/<phoneNumberId> with the
 * customer-decrypted access token to confirm the credentials work.
 *
 * Mirrored independent implementation of the probe in
 * apps/chat/src/managed/health-checker.ts (around line 140).
 * Duplication is intentional: apps/api MUST NOT import from apps/chat.
 * If either implementation changes, update both — the parity is contract.
 *
 * @param userToken Customer-decrypted Meta token (NOT the app token).
 */
export interface HealthProbeOkResult {
  ok: true;
  reason: null;
  checkedAt: Date;
}

export interface HealthProbeFailResult {
  ok: false;
  reason: string;
  checkedAt: Date;
}

export type HealthProbeResult = HealthProbeOkResult | HealthProbeFailResult;

export async function probeWhatsAppHealth(args: {
  apiVersion: string;
  userToken: string;
  phoneNumberId: string;
  fetchImpl?: typeof fetch;
}): Promise<HealthProbeResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const url = `https://graph.facebook.com/${args.apiVersion}/${args.phoneNumberId}`;
  try {
    const res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${args.userToken}` },
    });
    const checkedAt = new Date();
    if (!res.ok) {
      return {
        ok: false,
        reason: `health probe returned HTTP ${res.status}`,
        checkedAt,
      };
    }
    return { ok: true, reason: null, checkedAt };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "fetch error",
      checkedAt: new Date(),
    };
  }
}
