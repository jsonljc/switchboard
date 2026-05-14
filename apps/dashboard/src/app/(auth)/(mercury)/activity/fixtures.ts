import type { AuditEntryBrowseRow } from "@switchboard/schemas";
import { SKETCHES } from "./fixtures.data";

/**
 * Fixture rows for /activity behind NEXT_PUBLIC_ACTIVITY_LIVE=false.
 *
 * v2 distribution (locked design `activity-v2/data.js`):
 *  - 30 rows, DESC by timestamp, anchored at NOW = 2026-05-09T14:23:11+08:00.
 *  - 30 distinct event types across all 4 bands (action / identity / event / agent).
 *  - All 4 actor types represented.
 *  - All 5 risk categories represented.
 *  - 9 rows with envelopeId set (approval lineage).
 *  - 2 rows with notable redactedKeyCount (5 and 7).
 *  - 1 row outside the operational allowlist (event.published) so toggling to
 *    "All" surfaces it.
 *  - Full hash chain: rows[i].previousEntryHash === rows[i+1].entryHash.
 *    The oldest row anchors to a GENESIS hash string.
 *
 * The chain is deterministic — entryHash is hash64("entry::" + id), evidence
 * hashes are hash64(seed). hash64 is a stable seeded pseudo-hex generator that
 * mirrors the locked data.js so the fixtures' visual character matches the
 * mock 1:1.
 *
 * The raw 30-row sketch table lives in `./fixtures.data.ts` so this file stays
 * under the 600-line architecture-check limit. This file owns the projection
 * + hash-chain threading.
 */

const NOW = new Date("2026-05-09T14:23:11+08:00").getTime();
const iso = (ago: number) => new Date(NOW - ago).toISOString();

// Deterministic 64-char hex from a seed string — mirrors data.js hash64.
function hash64(seed: string): string {
  const out: string[] = [];
  let x = 0;
  for (let i = 0; i < seed.length; i++) x = (x * 31 + seed.charCodeAt(i)) >>> 0;
  while (out.length < 64) {
    x = (x * 1103515245 + 12345 + out.length * 7) >>> 0;
    out.push((x.toString(16) + "00000000").slice(0, 8));
  }
  return out.join("").slice(0, 64);
}

const GENESIS = "0000000000000000000000000000000000000000000000000000000000000000";

// Project sketches → AuditEntryBrowseRow rows and thread the hash chain
// (rows[i].previousEntryHash === rows[i+1].entryHash; oldest anchors at GENESIS).
const projected: AuditEntryBrowseRow[] = SKETCHES.map((s) => ({
  id: s.id,
  eventType: s.eventType,
  timestamp: iso(s.ago),
  actorType: s.actorType,
  actorId: s.actorId,
  entityType: s.entityType,
  entityId: s.entityId,
  riskCategory: s.risk,
  visibilityLevel: s.vis,
  summary: s.summary,
  snapshotKeys: s.snapshotKeys,
  redactedKeyCount: s.redacted,
  evidencePointers: s.evidence.map((e) => {
    const full = hash64(e.seed);
    return { type: e.type, hash: full, hashPrefix: full.slice(0, 16) };
  }),
  entryHash: hash64("entry::" + s.id),
  previousEntryHash: null,
  envelopeId: s.envelope,
  traceId: s.trace,
}));

for (let i = 0; i < projected.length; i++) {
  projected[i]!.previousEntryHash =
    i < projected.length - 1 ? projected[i + 1]!.entryHash : GENESIS;
}

export const ACTIVITY_FIXTURES: AuditEntryBrowseRow[] = projected;
