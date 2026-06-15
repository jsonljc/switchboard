import { describe, it, expect } from "vitest";
import { buildWhatsAppOnboardConnection } from "../whatsapp-connection-data.js";

describe("buildWhatsAppOnboardConnection", () => {
  const input = {
    organizationId: "org_real_123",
    wabaId: "waba_abc",
    phoneNumberId: "phone_xyz",
    displayPhoneNumber: "+15551230000",
    runtimeToken: "SYSTEM_USER_TOKEN_VALUE",
    appSecret: "app_secret_value",
    verifyToken: "verify_token_value",
  };

  it("persists a real org binding (regression: organizationId was hardcoded '')", () => {
    const built = buildWhatsAppOnboardConnection(input);
    expect(built.connection.organizationId).toBe("org_real_123");
    expect(built.connection.organizationId).not.toBe("");
  });

  it("stores the runtime Bearer in creds.token (regression: the bug stored the WABA id there)", () => {
    const built = buildWhatsAppOnboardConnection(input);
    expect(built.credentials.token).toBe("SYSTEM_USER_TOKEN_VALUE");
    expect(built.credentials.token).not.toBe(input.wabaId);
  });

  it("stores appSecret + verifyToken so inbound POST-signature + GET-handshake can verify", () => {
    const built = buildWhatsAppOnboardConnection(input);
    expect(built.credentials.appSecret).toBe("app_secret_value");
    expect(built.credentials.verifyToken).toBe("verify_token_value");
  });

  it("keeps phoneNumberId (runtime) + primaryPhoneNumberId (mgmt page) + externalAccountId=wabaId", () => {
    const built = buildWhatsAppOnboardConnection(input);
    expect(built.credentials.phoneNumberId).toBe("phone_xyz");
    expect(built.credentials.primaryPhoneNumberId).toBe("phone_xyz");
    expect(built.credentials.displayPhoneNumber).toBe("+15551230000");
    expect(built.connection.externalAccountId).toBe("waba_abc");
    expect(built.connection.serviceId).toBe("whatsapp");
    expect(built.connection.serviceName).toBe("whatsapp");
    expect(built.connection.authType).toBe("bot_token");
    expect(built.connection.scopes).toEqual([]);
  });

  it("produces creds satisfying the runtime adapter contract (seam pin: runtime-registry.ts:167-172)", () => {
    // The chat RuntimeRegistry.createAdapterForConnection whatsapp branch requires
    // creds.token + creds.phoneNumberId (else the adapter is null and the channel
    // cannot load) and reads creds.appSecret + creds.verifyToken for inbound
    // verification. Pin the producer->consumer seam so this shape can't drift.
    const creds = buildWhatsAppOnboardConnection(input).credentials;
    expect(typeof creds.token).toBe("string");
    expect(creds.token.length).toBeGreaterThan(0);
    expect(typeof creds.phoneNumberId).toBe("string");
    expect(creds.phoneNumberId.length).toBeGreaterThan(0);
    expect(typeof creds.appSecret).toBe("string");
    expect(creds.appSecret.length).toBeGreaterThan(0);
    expect(typeof creds.verifyToken).toBe("string");
    expect(creds.verifyToken.length).toBeGreaterThan(0);
  });
});
