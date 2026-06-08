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
    delete process.env["INTERNAL_API_SECRET"];
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("warns (not errors) when no channel tokens are configured outside production", () => {
    const result = runStartupChecks();
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("No channel configured"))).toBe(true);
  });

  it("fails in production when no channel tokens are configured", () => {
    process.env.NODE_ENV = "production";
    process.env["DATABASE_URL"] = "postgresql://localhost/test";
    process.env["CREDENTIALS_ENCRYPTION_KEY"] = "fake-key";
    const result = runStartupChecks();
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("No channel configured"))).toBe(true);
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

  // F-15: managed-channel mode (DATABASE_URL set) requires INTERNAL_API_SECRET for the
  // chat-to-API ingress hop. Hard error in all environments.
  it("errors when DATABASE_URL is set but INTERNAL_API_SECRET is empty (managed mode)", () => {
    process.env["TELEGRAM_BOT_TOKEN"] = "fake-token";
    process.env["DATABASE_URL"] = "postgresql://localhost/test";
    const result = runStartupChecks();
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("INTERNAL_API_SECRET"))).toBe(true);
  });

  it("passes when DATABASE_URL and INTERNAL_API_SECRET are both set", () => {
    process.env["TELEGRAM_BOT_TOKEN"] = "fake-token";
    process.env["DATABASE_URL"] = "postgresql://localhost/test";
    process.env["INTERNAL_API_SECRET"] = "s3cr3t";
    const result = runStartupChecks();
    expect(result.errors.some((e) => e.includes("INTERNAL_API_SECRET"))).toBe(false);
  });

  it("does not require INTERNAL_API_SECRET when there is no database (non-managed dev mode)", () => {
    process.env["TELEGRAM_BOT_TOKEN"] = "fake-token";
    const result = runStartupChecks();
    expect(result.errors.some((e) => e.includes("INTERNAL_API_SECRET"))).toBe(false);
  });
});
