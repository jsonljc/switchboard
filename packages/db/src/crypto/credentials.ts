import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;

/**
 * Derives an AES-256 key from the master secret using scrypt.
 * The salt is stored alongside the ciphertext so the same key can be re-derived.
 */
function deriveKey(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, KEY_LENGTH);
}

/**
 * Encrypt a JSON-serializable credentials object.
 * Returns a base64 string containing: salt + iv + authTag + ciphertext.
 *
 * Requires CREDENTIALS_ENCRYPTION_KEY env var (or passed explicitly).
 */
export function encryptCredentials(
  credentials: Record<string, unknown>,
  masterKey?: string,
): string {
  const secret = masterKey ?? process.env["CREDENTIALS_ENCRYPTION_KEY"];
  if (!secret) {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY is required for credential encryption. " +
      "Set this environment variable to a strong random secret (min 32 chars).",
    );
  }

  const plaintext = JSON.stringify(credentials);
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(secret, salt);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Pack: salt(32) + iv(16) + authTag(16) + ciphertext
  const packed = Buffer.concat([salt, iv, authTag, encrypted]);
  return packed.toString("base64");
}

/**
 * Decrypt a credentials string produced by encryptCredentials().
 * Returns the original JSON object.
 */
export function decryptCredentials(
  encryptedBase64: string,
  masterKey?: string,
): Record<string, unknown> {
  const secret = masterKey ?? process.env["CREDENTIALS_ENCRYPTION_KEY"];
  if (!secret) {
    throw new Error("CREDENTIALS_ENCRYPTION_KEY is required for credential decryption.");
  }

  const packed = Buffer.from(encryptedBase64, "base64");

  const salt = packed.subarray(0, SALT_LENGTH);
  const iv = packed.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = packed.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = packed.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

  const key = deriveKey(secret, salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8")) as Record<string, unknown>;
}

/**
 * Check if a value looks like an encrypted credential (base64 with correct min length).
 */
export function isEncrypted(value: unknown): boolean {
  if (typeof value !== "string") return false;
  // Minimum: salt(32) + iv(16) + authTag(16) + at least 1 byte ciphertext = 65 bytes → ~88 base64 chars
  if (value.length < 80) return false;
  return /^[A-Za-z0-9+/]+=*$/.test(value);
}
