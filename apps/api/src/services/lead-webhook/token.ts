import { createHash, randomBytes } from "node:crypto";

const TOKEN_PREFIX = "whk_";
const TOKEN_BYTES = 24; // 24 bytes => 32 base64url chars

export function generateToken(): string {
  return TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function tokenPrefix(token: string): string {
  return token.slice(0, TOKEN_PREFIX.length + 6);
}
