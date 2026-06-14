import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, randomBytes, createCipheriv } from "crypto";
import { encryptApiKey, decryptApiKey } from "../api-key.js";

const TEST_SECRET = "test-encryption-secret-at-least-32-chars-long";

// Hand-rolled legacy vector: build a ciphertext by the literal steps the dashboard
// (apps/dashboard/src/lib/crypto.ts) and the API setup route encrypt with, so the
// canonical decryptApiKey is pinned byte-compatible with anything already at rest.
// Ported from apps/dashboard/src/lib/__tests__/crypto.test.ts:7-15.
function encryptLikeLegacy(apiKey: string, secret: string): string {
  const keyBuffer = createHash("sha256").update(secret).digest();
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", keyBuffer, iv);
  let encrypted = cipher.update(apiKey, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${Buffer.from(authTag).toString("hex")}:${encrypted}`;
}

describe("api-key crypto", () => {
  let savedEnv: string | undefined;

  beforeAll(() => {
    savedEnv = process.env["CREDENTIALS_ENCRYPTION_KEY"];
    process.env["CREDENTIALS_ENCRYPTION_KEY"] = TEST_SECRET;
  });

  afterAll(() => {
    if (savedEnv !== undefined) {
      process.env["CREDENTIALS_ENCRYPTION_KEY"] = savedEnv;
    } else {
      delete process.env["CREDENTIALS_ENCRYPTION_KEY"];
    }
  });

  it("round-trips encryptApiKey then decryptApiKey", () => {
    const original = "sk_abc123def456";
    expect(decryptApiKey(encryptApiKey(original))).toBe(original);
  });

  it("decrypts a key encrypted by the legacy sha256-derivation format", () => {
    const original = "sb_abc123def456";
    const encrypted = encryptLikeLegacy(original, TEST_SECRET);
    expect(decryptApiKey(encrypted)).toBe(original);
  });

  it("throws when CREDENTIALS_ENCRYPTION_KEY is not set", () => {
    const saved = process.env["CREDENTIALS_ENCRYPTION_KEY"];
    delete process.env["CREDENTIALS_ENCRYPTION_KEY"];
    try {
      expect(() => encryptApiKey("sk_x")).toThrow("CREDENTIALS_ENCRYPTION_KEY");
      expect(() => decryptApiKey("aa:bb:cc")).toThrow("CREDENTIALS_ENCRYPTION_KEY");
    } finally {
      if (saved !== undefined) {
        process.env["CREDENTIALS_ENCRYPTION_KEY"] = saved;
      }
    }
  });
});
