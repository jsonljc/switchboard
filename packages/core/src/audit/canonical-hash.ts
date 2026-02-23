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

/**
 * Ensure the canonicalize function is loaded before any sync hash computation.
 * Await this in code paths that need deterministic hashing.
 */
export async function ensureCanonicalize(): Promise<void> {
  if (!canonicalizeImpl) {
    await getCanonicalize();
  }
}

// Eagerly start loading
getCanonicalize().catch(() => {});

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
  if (canonicalizeImpl) {
    return sha256(canonicalizeImpl(input));
  }
  // Fallback: deterministic key-sorted JSON (used only before dynamic import resolves)
  const keys = Object.keys(input).sort();
  const ordered: Record<string, unknown> = {};
  for (const key of keys) {
    ordered[key] = input[key as keyof AuditHashInput];
  }
  return sha256(JSON.stringify(ordered));
}

export function verifyChain(
  entries: Array<AuditHashInput & { entryHash: string; previousEntryHash: string | null }>,
): { valid: boolean; brokenAt: number | null } {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;

    // Extract only AuditHashInput fields for hash recomputation
    const hashInput: AuditHashInput = {
      chainHashVersion: entry.chainHashVersion,
      schemaVersion: entry.schemaVersion,
      id: entry.id,
      eventType: entry.eventType,
      timestamp: entry.timestamp,
      actorType: entry.actorType,
      actorId: entry.actorId,
      entityType: entry.entityType,
      entityId: entry.entityId,
      riskCategory: entry.riskCategory,
      snapshot: entry.snapshot,
      evidencePointers: entry.evidencePointers,
      summary: entry.summary,
      previousEntryHash: entry.previousEntryHash,
    };

    // Recompute hash from data and verify it matches
    const recomputed = computeAuditHashSync(hashInput);
    if (recomputed !== entry.entryHash) {
      return { valid: false, brokenAt: i };
    }

    // Check chain linkage
    if (i > 0 && entry.previousEntryHash !== entries[i - 1]!.entryHash) {
      return { valid: false, brokenAt: i };
    }
  }
  return { valid: true, brokenAt: null };
}
