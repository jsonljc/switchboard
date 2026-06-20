import { describe, it, expect, vi } from "vitest";
import { resolveOrgWhatsAppSendCreds } from "../whatsapp-send-creds.js";
import type { ConnectionCredentialReader } from "../whatsapp-send-creds.js";

/**
 * Minimal decrypted ConnectionRecord shape the reader hands back. The real
 * PrismaConnectionStore.getByService returns the full ConnectionRecord with
 * credentials already decrypted; the resolver only reads credentials.token /
 * credentials.phoneNumberId, so the stub returns just those.
 */
function makeReader(
  record: { credentials: Record<string, unknown> } | null,
): ConnectionCredentialReader {
  return {
    getByService: vi.fn().mockResolvedValue(record),
  };
}

describe("resolveOrgWhatsAppSendCreds", () => {
  it("reads the org's whatsapp connection and returns its decrypted {token, phoneNumberId}", async () => {
    const reader = makeReader({ credentials: { token: "T2", phoneNumberId: "P2" } });
    const creds = await resolveOrgWhatsAppSendCreds(reader, "org_2");
    expect(creds).toEqual({ token: "T2", phoneNumberId: "P2" });
    // Org-scoped read of the canonical "whatsapp" service connection.
    expect(reader.getByService).toHaveBeenCalledWith("whatsapp", "org_2");
  });

  it("returns null when the org has no whatsapp connection (env fallback at the call site)", async () => {
    const reader = makeReader(null);
    const creds = await resolveOrgWhatsAppSendCreds(reader, "org_1");
    expect(creds).toBeNull();
  });

  it("returns per-field nulls when the connection is missing a credential field", async () => {
    const reader = makeReader({ credentials: { token: "T2" } });
    const creds = await resolveOrgWhatsAppSendCreds(reader, "org_2");
    expect(creds).toEqual({ token: "T2", phoneNumberId: null });
  });

  it("coerces a non-string credential value to null (defensive, never leaks a non-string Bearer)", async () => {
    const reader = makeReader({ credentials: { token: 123, phoneNumberId: "P2" } });
    const creds = await resolveOrgWhatsAppSendCreds(reader, "org_2");
    expect(creds).toEqual({ token: null, phoneNumberId: "P2" });
  });
});
