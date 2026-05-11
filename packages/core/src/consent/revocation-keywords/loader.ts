import type { PdpaJurisdiction } from "@switchboard/schemas";
import { normalizeRegex } from "../../governance/text/regex.js";
import { commonRevocationKeywords } from "./common.js";
import { sgRevocationKeywords } from "./sg.js";
import { myRevocationKeywords } from "./my.js";
import type { RevocationKeywordEntry } from "./types.js";

function normalizeEntry(entry: RevocationKeywordEntry): RevocationKeywordEntry {
  const patterns = entry.patterns.map((p) => (p instanceof RegExp ? normalizeRegex(p) : p));
  return Object.freeze({
    ...entry,
    patterns: Object.freeze([...patterns]),
  });
}

function buildJurisdictionTable(j: PdpaJurisdiction): ReadonlyArray<RevocationKeywordEntry> {
  const jurisdictionEntries = j === "SG" ? sgRevocationKeywords : myRevocationKeywords;
  const merged = [...commonRevocationKeywords, ...jurisdictionEntries].map(normalizeEntry);

  // Boot-time invariant: unique ids.
  const ids = new Set<string>();
  for (const e of merged) {
    if (ids.has(e.id)) {
      throw new Error(`Duplicate revocation keyword id "${e.id}" in jurisdiction ${j}`);
    }
    ids.add(e.id);
  }

  return Object.freeze(merged);
}

const tableCache = new Map<PdpaJurisdiction, ReadonlyArray<RevocationKeywordEntry>>();

export function loadRevocationKeywords(
  jurisdiction: PdpaJurisdiction,
): ReadonlyArray<RevocationKeywordEntry> {
  let cached = tableCache.get(jurisdiction);
  if (!cached) {
    cached = buildJurisdictionTable(jurisdiction);
    tableCache.set(jurisdiction, cached);
  }
  return cached;
}
