/**
 * MCP server authentication.
 * Maps API key to actor context (actorId + organizationId).
 * Fail-closed: rejects if no valid key is configured and we're not in dev mode.
 */

export interface McpAuthContext {
  actorId: string;
  organizationId: string | null;
}

interface ApiKeyEntry {
  actorId: string;
  organizationId: string | null;
}

/**
 * Load API key mappings from MCP_API_KEYS env var.
 * Format: "key:actorId:orgId" (orgId optional, comma-separated entries)
 * Falls back to a default dev context when no keys are configured and NODE_ENV !== "production".
 */
export function loadMcpApiKeys(): Map<string, ApiKeyEntry> {
  const raw = process.env["MCP_API_KEYS"] ?? "";
  if (!raw.trim()) return new Map();

  const out = new Map<string, ApiKeyEntry>();
  for (const entry of raw.split(",").map((e) => e.trim()).filter(Boolean)) {
    const parts = entry.split(":");
    const key = parts[0]?.trim();
    const actorId = parts[1]?.trim();
    if (!key || !actorId) continue;
    const organizationId = parts[2]?.trim() || null;
    out.set(key, { actorId, organizationId });
  }
  return out;
}

/**
 * Resolve auth context from an API key.
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
        "MCP_API_KEYS is required in production. " +
        "Format: key:actorId:orgId (comma-separated)",
      );
    }
    return { actorId: "default", organizationId: null };
  }

  if (!apiKey) {
    throw new Error("Authentication required: no API key provided");
  }

  const entry = keys.get(apiKey);
  if (!entry) {
    throw new Error("Invalid API key");
  }

  return { actorId: entry.actorId, organizationId: entry.organizationId };
}
