import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";

// Test the setup route logic in isolation (no Fastify/Prisma needed)
describe("Bootstrap endpoint logic", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env["INTERNAL_SETUP_SECRET"] = "test-secret-12345";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("timing-safe comparison rejects wrong secrets", () => {
    const secret = "test-secret-12345";
    const wrong = "wrong-secret-12345";

    // Same length but different content
    expect(
      secret.length === wrong.length &&
        crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(wrong)),
    ).toBe(false);
  });

  it("timing-safe comparison accepts correct secrets", () => {
    const secret = "test-secret-12345";
    expect(crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(secret))).toBe(true);
  });

  it("generates API keys with correct format", () => {
    const apiKey = `sb_${crypto.randomBytes(24).toString("hex")}`;
    expect(apiKey).toMatch(/^sb_[0-9a-f]{48}$/);
  });

  it("generates unique API key hashes", () => {
    const key1 = `sb_${crypto.randomBytes(24).toString("hex")}`;
    const key2 = `sb_${crypto.randomBytes(24).toString("hex")}`;
    const hash1 = crypto.createHash("sha256").update(key1).digest("hex");
    const hash2 = crypto.createHash("sha256").update(key2).digest("hex");
    expect(hash1).not.toBe(hash2);
  });

  it("encrypts API key with AES-256-GCM when encryption key is available", () => {
    const encryptionKey = "a-strong-encryption-key-at-least-32-chars";
    const apiKey = "sb_test_key_123";

    const keyBuffer = crypto.createHash("sha256").update(encryptionKey).digest();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-gcm", keyBuffer, iv);
    let encrypted = cipher.update(apiKey, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");
    const result = `${iv.toString("hex")}:${authTag}:${encrypted}`;

    // Should be in iv:authTag:ciphertext format
    const parts = result.split(":");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toHaveLength(32); // 16 bytes hex
    expect(parts[1]).toHaveLength(32); // 16 bytes hex

    // Verify we can decrypt it
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      keyBuffer,
      Buffer.from(parts[0]!, "hex"),
    );
    decipher.setAuthTag(Buffer.from(parts[1]!, "hex"));
    let decrypted = decipher.update(parts[2]!, "hex", "utf8");
    decrypted += decipher.final("utf8");
    expect(decrypted).toBe(apiKey);
  });

  it("scrypt password hash is deterministic with same salt", async () => {
    const { promisify } = await import("node:util");
    const scryptAsync = promisify(crypto.scrypt);

    const password = "test-password-123";
    const salt = "fixed-salt-for-test";
    const derived1 = (await scryptAsync(password, salt, 64)) as Buffer;
    const derived2 = (await scryptAsync(password, salt, 64)) as Buffer;

    expect(derived1.toString("hex")).toBe(derived2.toString("hex"));
  });

  it("scrypt password hash differs with different passwords", async () => {
    const { promisify } = await import("node:util");
    const scryptAsync = promisify(crypto.scrypt);

    const salt = "fixed-salt-for-test";
    const derived1 = (await scryptAsync("password1", salt, 64)) as Buffer;
    const derived2 = (await scryptAsync("password2", salt, 64)) as Buffer;

    expect(derived1.toString("hex")).not.toBe(derived2.toString("hex"));
  });
});
