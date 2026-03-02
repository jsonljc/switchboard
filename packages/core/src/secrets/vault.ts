import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * SecretsVault — encrypts and decrypts sensitive credential data.
 *
 * Uses AES-256-GCM with key from VAULT_ENCRYPTION_KEY env var.
 * Supports key rotation by storing the key version alongside ciphertext.
 */

export interface SecretsVault {
  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
}

interface EncryptedPayload {
  /** Ciphertext encoded as hex */
  ct: string;
  /** Initialization vector as hex */
  iv: string;
  /** Auth tag as hex */
  tag: string;
  /** Key version for rotation support */
  kv: number;
}

export class EncryptedVault implements SecretsVault {
  private keys: Map<number, Buffer>;
  private currentKeyVersion: number;

  constructor(config?: {
    /** Primary encryption key (hex or base64). Defaults to VAULT_ENCRYPTION_KEY env var. */
    encryptionKey?: string;
    /** Previous keys for rotation, keyed by version number. */
    previousKeys?: Record<number, string>;
  }) {
    this.keys = new Map();

    const primaryKey = config?.encryptionKey ?? process.env["VAULT_ENCRYPTION_KEY"];
    if (!primaryKey) {
      throw new Error(
        "VAULT_ENCRYPTION_KEY must be set (32-byte key as hex or base64)",
      );
    }

    const keyBuffer = this.parseKey(primaryKey);
    if (keyBuffer.length !== 32) {
      throw new Error(
        `Encryption key must be 32 bytes (got ${keyBuffer.length}). Provide as 64 hex chars or 44 base64 chars.`,
      );
    }

    // Current key is version 1 by default
    this.currentKeyVersion = 1;
    this.keys.set(this.currentKeyVersion, keyBuffer);

    // Add previous keys for rotation
    if (config?.previousKeys) {
      for (const [version, key] of Object.entries(config.previousKeys)) {
        const vNum = parseInt(version, 10);
        this.keys.set(vNum, this.parseKey(key));
        if (vNum > this.currentKeyVersion) {
          this.currentKeyVersion = vNum;
        }
      }
    }
  }

  async encrypt(plaintext: string): Promise<string> {
    const key = this.keys.get(this.currentKeyVersion);
    if (!key) throw new Error("No encryption key available");

    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);

    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");

    const tag = cipher.getAuthTag();

    const payload: EncryptedPayload = {
      ct: encrypted,
      iv: iv.toString("hex"),
      tag: tag.toString("hex"),
      kv: this.currentKeyVersion,
    };

    return Buffer.from(JSON.stringify(payload)).toString("base64");
  }

  async decrypt(ciphertext: string): Promise<string> {
    let payload: EncryptedPayload;
    try {
      payload = JSON.parse(
        Buffer.from(ciphertext, "base64").toString("utf8"),
      ) as EncryptedPayload;
    } catch {
      throw new Error("Invalid encrypted payload format");
    }

    const key = this.keys.get(payload.kv);
    if (!key) {
      throw new Error(
        `No key found for version ${payload.kv}. Key rotation may be needed.`,
      );
    }

    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(payload.iv, "hex"),
    );
    decipher.setAuthTag(Buffer.from(payload.tag, "hex"));

    let decrypted = decipher.update(payload.ct, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }

  /**
   * Re-encrypt a value with the current key version.
   * Useful for key rotation: decrypt with old key, encrypt with new.
   */
  async rotate(ciphertext: string): Promise<string> {
    const plaintext = await this.decrypt(ciphertext);
    return this.encrypt(plaintext);
  }

  private parseKey(key: string): Buffer {
    // Try hex first (64 chars = 32 bytes)
    if (/^[0-9a-fA-F]+$/.test(key) && key.length === 64) {
      return Buffer.from(key, "hex");
    }
    // Try base64
    return Buffer.from(key, "base64");
  }
}
