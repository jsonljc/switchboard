import { describe, it, expect, afterEach } from "vitest";
import { resolveWhatsAppSendToken } from "./whatsapp-send-token.js";

describe("resolveWhatsAppSendToken", () => {
  afterEach(() => {
    delete process.env["WHATSAPP_ACCESS_TOKEN"];
    delete process.env["WHATSAPP_TOKEN"];
  });

  it("returns WHATSAPP_ACCESS_TOKEN when set", () => {
    process.env["WHATSAPP_ACCESS_TOKEN"] = "access_tok";
    delete process.env["WHATSAPP_TOKEN"];
    expect(resolveWhatsAppSendToken()).toBe("access_tok");
  });

  it("falls back to WHATSAPP_TOKEN when WHATSAPP_ACCESS_TOKEN is unset", () => {
    delete process.env["WHATSAPP_ACCESS_TOKEN"];
    process.env["WHATSAPP_TOKEN"] = "legacy_tok";
    expect(resolveWhatsAppSendToken()).toBe("legacy_tok");
  });

  it("prefers WHATSAPP_ACCESS_TOKEN over WHATSAPP_TOKEN when both set", () => {
    process.env["WHATSAPP_ACCESS_TOKEN"] = "access_tok";
    process.env["WHATSAPP_TOKEN"] = "legacy_tok";
    expect(resolveWhatsAppSendToken()).toBe("access_tok");
  });

  it("returns undefined when neither name is set", () => {
    delete process.env["WHATSAPP_ACCESS_TOKEN"];
    delete process.env["WHATSAPP_TOKEN"];
    expect(resolveWhatsAppSendToken()).toBeUndefined();
  });
});
