import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runStartupChecks } from "../startup-checks.js";

describe("runStartupChecks", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset to minimal valid config
    delete process.env["DATABASE_URL"];
    delete process.env["REDIS_URL"];
    delete process.env["TELEGRAM_BOT_TOKEN"];
    delete process.env["WHATSAPP_TOKEN"];
    delete process.env["WHATSAPP_PHONE_NUMBER_ID"];
    delete process.env["SLACK_BOT_TOKEN"];
    delete process.env["CREDENTIALS_ENCRYPTION_KEY"];
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("fails when no channel tokens are configured", () => {
    const result = runStartupChecks();
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("At least one channel");
  });

  it("passes with just TELEGRAM_BOT_TOKEN", () => {
    process.env["TELEGRAM_BOT_TOKEN"] = "fake-token";
    const result = runStartupChecks();
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("passes with WhatsApp token + phone number ID", () => {
    process.env["WHATSAPP_TOKEN"] = "fake-token";
    process.env["WHATSAPP_PHONE_NUMBER_ID"] = "123456";
    const result = runStartupChecks();
    expect(result.ok).toBe(true);
  });

  it("warns when DATABASE_URL is not set", () => {
    process.env["TELEGRAM_BOT_TOKEN"] = "fake-token";
    const result = runStartupChecks();
    expect(result.warnings.some((w) => w.includes("DATABASE_URL"))).toBe(true);
  });

  it("warns when REDIS_URL is not set", () => {
    process.env["TELEGRAM_BOT_TOKEN"] = "fake-token";
    const result = runStartupChecks();
    expect(result.warnings.some((w) => w.includes("REDIS_URL"))).toBe(true);
  });

  it("fails in production without CREDENTIALS_ENCRYPTION_KEY when DB is set", () => {
    process.env["TELEGRAM_BOT_TOKEN"] = "fake-token";
    process.env["DATABASE_URL"] = "postgresql://localhost/test";
    process.env.NODE_ENV = "production";
    const result = runStartupChecks();
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("CREDENTIALS_ENCRYPTION_KEY"))).toBe(true);
  });
});
