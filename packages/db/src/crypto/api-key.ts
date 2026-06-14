import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

// Canonical apiKey crypto: AES-256-GCM with a key derived as
// sha256(CREDENTIALS_ENCRYPTION_KEY), serialized as `iv:authTag:encrypted` hex.
// This is the single source for the dashboard (apps/dashboard/src/lib/crypto.ts
// re-exports it) and the dev seed (packages/db/prisma/seed.ts imports encryptApiKey
// from here). The request-time decryptor (apps/dashboard/src/lib/get-api-client.ts)
// rides this impl, so this must stay byte-compatible with anything already at rest —
// the legacy-format compat assertion in __tests__/api-key.test.ts pins that.
//
// NOTE: this is deliberately NOT the scryptSync credentials.ts crypto. apiKeys use the
// lighter sha256 derivation; the two formats are not interchangeable.
const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const secret = process.env["CREDENTIALS_ENCRYPTION_KEY"];
  if (!secret) {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY is not set. " +
        "This must match the secret used by the API server for encryption.",
    );
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptApiKey(apiKey: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  let encrypted = cipher.update(apiKey, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

export function decryptApiKey(encryptedApiKey: string): string {
  const [ivHex, authTagHex, encrypted] = encryptedApiKey.split(":");
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex!, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex!, "hex"));
  let decrypted = decipher.update(encrypted!, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
