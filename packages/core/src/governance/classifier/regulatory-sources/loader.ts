import type { RegulatoryPublicSourceEntry } from "./types.js";
import { SG_REGULATORY_SOURCES } from "./sg.js";
import { MY_REGULATORY_SOURCES } from "./my.js";
import { normalizeRegex } from "../../text/regex.js";

function normalize(
  entries: readonly RegulatoryPublicSourceEntry[],
): readonly RegulatoryPublicSourceEntry[] {
  const ids = new Set<string>();
  const out: RegulatoryPublicSourceEntry[] = [];
  for (const entry of entries) {
    if (ids.has(entry.id)) {
      throw new Error(`Duplicate regulatory source id: ${entry.id}`);
    }
    ids.add(entry.id);
    out.push({
      ...entry,
      patterns: entry.patterns.map((p) => (p instanceof RegExp ? normalizeRegex(p) : p)),
    });
  }
  return Object.freeze(out);
}

const CACHE: Partial<Record<"SG" | "MY", readonly RegulatoryPublicSourceEntry[]>> = {};

export function loadRegulatoryPublicSources(
  jurisdiction: "SG" | "MY",
): readonly RegulatoryPublicSourceEntry[] {
  const cached = CACHE[jurisdiction];
  if (cached) return cached;
  const raw = jurisdiction === "SG" ? SG_REGULATORY_SOURCES : MY_REGULATORY_SOURCES;
  const normalized = normalize(raw);
  CACHE[jurisdiction] = normalized;
  return normalized;
}

export function _resetRegulatorySourceCache(): void {
  delete CACHE["SG"];
  delete CACHE["MY"];
}
