/**
 * Narrow shared helper for notifying the chat runtime that a managed channel
 * has been provisioned. Extracted so both the standard provision route
 * (organizations.ts) and the WhatsApp ESU onboarding route
 * (whatsapp-onboarding.ts) take the same hardened path: single retry with a
 * 200ms gap, env-gap detection, and a discriminated-union result that callers
 * map to their own response shape.
 *
 * Scope is intentionally narrow — this is the notify call only, not a broader
 * "provisioning service".
 */

export type NotifyChatResult =
  | { kind: "ok" }
  | { kind: "config_error"; reason: string }
  | { kind: "fail"; reason: string };

export interface NotifyChatInput {
  managedChannelId: string;
  /** Env-derived; helper accepts undefined/empty to detect config gap. */
  chatPublicUrl: string | undefined;
  /** Env-derived; helper accepts undefined/empty to detect config gap. */
  internalApiSecret: string | undefined;
  /** Test seam; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

const RETRY_DELAY_MS = 200;

export async function notifyChatProvisionedChannel(
  input: NotifyChatInput,
): Promise<NotifyChatResult> {
  const { managedChannelId, chatPublicUrl, internalApiSecret } = input;
  const fetchImpl = input.fetchImpl ?? fetch;

  if (!chatPublicUrl || !internalApiSecret) {
    const missing: string[] = [];
    if (!chatPublicUrl) missing.push("CHAT_PUBLIC_URL");
    if (!internalApiSecret) missing.push("INTERNAL_API_SECRET");
    return {
      kind: "config_error",
      reason: `missing ${missing.join(" / ")}`,
    };
  }

  let attempt = 0;
  let lastError: string | null = null;
  while (attempt < 2) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
    attempt++;
    try {
      const res = await fetchImpl(`${chatPublicUrl}/internal/provision-notify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${internalApiSecret}`,
        },
        body: JSON.stringify({ managedChannelId }),
      });
      if (res.ok) {
        return { kind: "ok" };
      }
      lastError = `Provision-notify HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : "fetch error";
    }
  }
  return {
    kind: "fail",
    reason: `Provision-notify failed after retry: ${lastError}`,
  };
}
