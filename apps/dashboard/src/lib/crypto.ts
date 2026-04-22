import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const secret = process.env.CREDENTIALS_ENCRYPTION_KEY;
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
