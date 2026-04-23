import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, randomBytes, createCipheriv } from "crypto";
import { decryptApiKey } from "../crypto";

const TEST_SECRET = "test-encryption-secret-at-least-32-chars-long";

function encryptLikeSetup(apiKey: string, secret: string): string {
  const keyBuffer = createHash("sha256").update(secret).digest();
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", keyBuffer, iv);
  let encrypted = cipher.update(apiKey, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

describe("crypto roundtrip", () => {
  let savedEnv: string | undefined;

  beforeAll(() => {
    savedEnv = process.env.CREDENTIALS_ENCRYPTION_KEY;
    process.env.CREDENTIALS_ENCRYPTION_KEY = TEST_SECRET;
  });

  afterAll(() => {
    if (savedEnv !== undefined) {
      process.env.CREDENTIALS_ENCRYPTION_KEY = savedEnv;
    } else {
      delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    }
  });

  it("decrypts a key encrypted with setup.ts-style SHA-256 derivation", () => {
    const originalKey = "sb_abc123def456";
    const encrypted = encryptLikeSetup(originalKey, TEST_SECRET);
    const decrypted = decryptApiKey(encrypted);
    expect(decrypted).toBe(originalKey);
  });

  it("throws when CREDENTIALS_ENCRYPTION_KEY is not set", () => {
    const saved = process.env.CREDENTIALS_ENCRYPTION_KEY;
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    try {
      expect(() => decryptApiKey("aa:bb:cc")).toThrow("CREDENTIALS_ENCRYPTION_KEY");
    } finally {
      process.env.CREDENTIALS_ENCRYPTION_KEY = saved;
    }
  });
});
