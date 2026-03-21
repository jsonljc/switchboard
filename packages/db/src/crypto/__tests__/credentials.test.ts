import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encryptCredentials, decryptCredentials, isEncrypted } from "../credentials.js";

const TEST_KEY = "test-encryption-key-at-least-32-characters-long!!";

describe("credentials encryption", () => {
  const originalEnv = process.env["CREDENTIALS_ENCRYPTION_KEY"];

  beforeEach(() => {
    delete process.env["CREDENTIALS_ENCRYPTION_KEY"];
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env["CREDENTIALS_ENCRYPTION_KEY"] = originalEnv;
    } else {
      delete process.env["CREDENTIALS_ENCRYPTION_KEY"];
    }
  });

  describe("encryptCredentials", () => {
    it("encrypts and produces a base64 string", () => {
      const creds = { apiKey: "sk_test_123", secret: "my-secret" };
      const encrypted = encryptCredentials(creds, TEST_KEY);
      expect(typeof encrypted).toBe("string");
      expect(encrypted.length).toBeGreaterThan(80);
      expect(encrypted).not.toContain("sk_test_123");
    });

    it("produces different ciphertext for the same input (random salt/IV)", () => {
      const creds = { apiKey: "sk_test_123" };
      const a = encryptCredentials(creds, TEST_KEY);
      const b = encryptCredentials(creds, TEST_KEY);
      expect(a).not.toBe(b);
    });

    it("throws when no master key is provided", () => {
      expect(() => encryptCredentials({ key: "val" })).toThrow(
        "CREDENTIALS_ENCRYPTION_KEY is required",
      );
    });

    it("uses env var when no explicit key is passed", () => {
      process.env["CREDENTIALS_ENCRYPTION_KEY"] = TEST_KEY;
      const encrypted = encryptCredentials({ key: "val" });
      expect(typeof encrypted).toBe("string");
    });
  });

  describe("decryptCredentials", () => {
    it("round-trips encryption and decryption", () => {
      const creds = { apiKey: "sk_test_123", nested: { deep: true }, count: 42 };
      const encrypted = encryptCredentials(creds, TEST_KEY);
      const decrypted = decryptCredentials(encrypted, TEST_KEY);
      expect(decrypted).toEqual(creds);
    });

    it("throws with wrong key", () => {
      const encrypted = encryptCredentials({ key: "val" }, TEST_KEY);
      expect(() =>
        decryptCredentials(encrypted, "wrong-key-that-is-long-enough-32chars!!"),
      ).toThrow();
    });

    it("throws when no master key is provided", () => {
      const encrypted = encryptCredentials({ key: "val" }, TEST_KEY);
      expect(() => decryptCredentials(encrypted)).toThrow("CREDENTIALS_ENCRYPTION_KEY is required");
    });

    it("throws on tampered ciphertext", () => {
      const encrypted = encryptCredentials({ key: "val" }, TEST_KEY);
      const buf = Buffer.from(encrypted, "base64");
      const lastIdx = buf.length - 1;
      buf.writeUInt8((buf.readUInt8(lastIdx) ^ 0xff) & 0xff, lastIdx);
      const tampered = buf.toString("base64");
      expect(() => decryptCredentials(tampered, TEST_KEY)).toThrow();
    });
  });

  describe("isEncrypted", () => {
    it("returns true for encrypted values", () => {
      const encrypted = encryptCredentials({ key: "val" }, TEST_KEY);
      expect(isEncrypted(encrypted)).toBe(true);
    });

    it("returns false for non-string values", () => {
      expect(isEncrypted(null)).toBe(false);
      expect(isEncrypted(undefined)).toBe(false);
      expect(isEncrypted(42)).toBe(false);
      expect(isEncrypted({})).toBe(false);
    });

    it("returns false for short strings", () => {
      expect(isEncrypted("short")).toBe(false);
      expect(isEncrypted("abc123")).toBe(false);
    });

    it("returns false for strings with non-base64 characters", () => {
      expect(isEncrypted("a".repeat(100) + "!@#$")).toBe(false);
    });
  });
});
