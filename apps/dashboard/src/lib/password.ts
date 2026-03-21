import bcrypt from "bcryptjs";
import { scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const SALT_ROUNDS = 12;
const scryptAsync = promisify(scrypt);

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  // Support scrypt hashes from bootstrap endpoint (format: "scrypt:salt:derivedKey")
  if (hash.startsWith("scrypt:")) {
    const parts = hash.split(":");
    if (parts.length !== 3) return false;
    const salt = parts[1]!;
    const storedKey = Buffer.from(parts[2]!, "hex");
    const derived = (await scryptAsync(plain, salt, 64)) as Buffer;
    return derived.length === storedKey.length && timingSafeEqual(derived, storedKey);
  }
  return bcrypt.compare(plain, hash);
}
