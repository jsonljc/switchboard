import { createHash } from "node:crypto";
// Note: json-canonicalize provides RFC 8785 JCS canonicalization
// Using dynamic import for ESM compatibility

let canonicalizeImpl: ((obj: unknown) => string) | null = null;

async function getCanonicalize(): Promise<(obj: unknown) => string> {
  if (!canonicalizeImpl) {
    const mod = await import("json-canonicalize");
    canonicalizeImpl = mod.canonicalize;
  }
  return canonicalizeImpl;
}

export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export interface AuditHashInput {
  chainHashVersion: number;
  schemaVersion: number;
  id: string;
  eventType: string;
  timestamp: string; // ISO string
  actorType: string;
  actorId: string;
  entityType: string;
  entityId: string;
  riskCategory: string;
  snapshot: Record<string, unknown>;
  evidencePointers: Array<{ type: string; hash: string; storageRef: string | null }>;
  summary: string;
  previousEntryHash: string | null;
}

export async function computeAuditHash(input: AuditHashInput): Promise<string> {
  const canonicalize = await getCanonicalize();
  const canonical = canonicalize(input);
  return sha256(canonical);
}

export function computeAuditHashSync(input: AuditHashInput): string {
  // Fallback sync version using deterministic JSON serialization
  // For production, use the async version with RFC 8785
  const keys = Object.keys(input).sort();
  const ordered: Record<string, unknown> = {};
  for (const key of keys) {
    ordered[key] = input[key as keyof AuditHashInput];
  }
  return sha256(JSON.stringify(ordered));
}

export function verifyChain(
  entries: Array<{ entryHash: string; previousEntryHash: string | null }>,
): { valid: boolean; brokenAt: number | null } {
  for (let i = 1; i < entries.length; i++) {
    const entry = entries[i]!;
    const previous = entries[i - 1]!;
    if (entry.previousEntryHash !== previous.entryHash) {
      return { valid: false, brokenAt: i };
    }
  }
  return { valid: true, brokenAt: null };
}
