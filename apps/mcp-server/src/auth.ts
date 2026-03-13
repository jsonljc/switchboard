/**
 * MCP server authentication.
 * Maps API key to actor context (actorId + organizationId).
 * Fail-closed: rejects if no valid key is configured and we're not in dev mode.
 *
 * Keys are hashed on load and compared with timingSafeEqual to prevent
 * timing side-channel attacks on key lookup.
 */

import { createHash, timingSafeEqual } from "node:crypto";

export interface McpAuthContext {
  actorId: string;
  organizationId: string | null;
}

interface ApiKeyEntry {
  actorId: string;
  organizationId: string | null;
}

/** Hash an API key with SHA-256 for storage and comparison. Exported for testing. */
export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Load API key mappings from MCP_API_KEYS env var.
 * Format: "key:actorId:orgId" (orgId optional, comma-separated entries)
 * Keys are hashed on load for timing-safe comparison.
 * Falls back to a default dev context when no keys are configured and NODE_ENV !== "production".
 */
export function loadMcpApiKeys(): Map<string, ApiKeyEntry> {
  const raw = process.env["MCP_API_KEYS"] ?? "";
  if (!raw.trim()) return new Map();

  const out = new Map<string, ApiKeyEntry>();
  for (const entry of raw
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean)) {
    const parts = entry.split(":");
    const key = parts[0]?.trim();
    const actorId = parts[1]?.trim();
    if (!key || !actorId) continue;
    const organizationId = parts[2]?.trim() || null;
    out.set(hashKey(key), { actorId, organizationId });
  }
  return out;
}

/**
 * Resolve auth context from an API key.
 * Uses timing-safe comparison by hashing the provided key and comparing
 * against pre-hashed stored keys.
 * In development mode (no keys configured), returns a default actor.
 */
export function resolveAuth(
  apiKey: string | undefined,
  keys: Map<string, ApiKeyEntry>,
): McpAuthContext {
  // Dev mode: no keys configured → default actor
  if (keys.size === 0) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "MCP_API_KEYS is required in production. " + "Format: key:actorId:orgId (comma-separated)",
      );
    }
    return { actorId: "default", organizationId: null };
  }

  if (!apiKey) {
    throw new Error("Authentication required: no API key provided");
  }

  const candidateHash = hashKey(apiKey);

  // Iterate all keys with timing-safe comparison to prevent timing leaks
  for (const [storedHash, entry] of keys) {
    const a = Buffer.from(candidateHash, "hex");
    const b = Buffer.from(storedHash, "hex");
    if (a.length === b.length && timingSafeEqual(a, b)) {
      return { actorId: entry.actorId, organizationId: entry.organizationId };
    }
  }

  throw new Error("Invalid API key");
}
