import { createHash } from "node:crypto";
import { canonicalizeSync } from "./canonical-json.js";

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

export function computeAuditHash(input: AuditHashInput): string {
  const canonical = canonicalizeSync(input);
  return sha256(canonical);
}

export function computeAuditHashSync(input: AuditHashInput): string {
  return computeAuditHash(input);
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
