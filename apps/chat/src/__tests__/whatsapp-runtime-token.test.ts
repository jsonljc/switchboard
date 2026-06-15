import { describe, it, expect } from "vitest";
import { resolveWhatsAppRuntimeToken } from "../managed/whatsapp-runtime-token.js";

describe("resolveWhatsAppRuntimeToken", () => {
  it("prefers a per-connection (BYOT) creds.token when present", () => {
    expect(resolveWhatsAppRuntimeToken({ token: "byot_tok" }, "SYSTEM_TOKEN")).toBe("byot_tok");
  });

  it("falls back to the central system-user token when creds.token is absent", () => {
    expect(resolveWhatsAppRuntimeToken({}, "SYSTEM_TOKEN")).toBe("SYSTEM_TOKEN");
    expect(resolveWhatsAppRuntimeToken({ phoneNumberId: "p1" }, "SYSTEM_TOKEN")).toBe(
      "SYSTEM_TOKEN",
    );
  });

  it("falls back when creds.token is an empty string", () => {
    expect(resolveWhatsAppRuntimeToken({ token: "" }, "SYSTEM_TOKEN")).toBe("SYSTEM_TOKEN");
  });

  it("returns undefined when neither a creds token nor a system token is available", () => {
    expect(resolveWhatsAppRuntimeToken({}, undefined)).toBeUndefined();
    expect(resolveWhatsAppRuntimeToken({ token: "" }, "")).toBeUndefined();
  });
});
