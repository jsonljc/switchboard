import type { EscalationTriggerEntry } from "./types.js";
import { COMMON_ESCALATION_TRIGGERS } from "./common.js";
import { SG_ESCALATION_TRIGGERS } from "./sg.js";
import { MY_ESCALATION_TRIGGERS } from "./my.js";

function normalizePattern(p: string | RegExp): string | RegExp {
  if (typeof p === "string") return p;
  const flags = p.flags.replace(/g/g, "");
  return new RegExp(p.source, flags.includes("i") ? flags : flags + "i");
}

function normalizeEntry(entry: EscalationTriggerEntry): EscalationTriggerEntry {
  return {
    ...entry,
    patterns: entry.patterns.map(normalizePattern),
    negations: entry.negations?.map(normalizePattern),
  };
}

const cache = new Map<"SG" | "MY", ReadonlyArray<EscalationTriggerEntry>>();

export function loadEscalationTriggers(
  jurisdiction: "SG" | "MY",
): ReadonlyArray<EscalationTriggerEntry> {
  const cached = cache.get(jurisdiction);
  if (cached) return cached;

  const merged: EscalationTriggerEntry[] = [
    ...COMMON_ESCALATION_TRIGGERS,
    ...(jurisdiction === "SG" ? SG_ESCALATION_TRIGGERS : MY_ESCALATION_TRIGGERS),
  ].map(normalizeEntry);

  const seen = new Set<string>();
  for (const entry of merged) {
    if (seen.has(entry.id)) {
      throw new Error(
        `Duplicate escalation-trigger id "${entry.id}" in ${jurisdiction} merged set`,
      );
    }
    seen.add(entry.id);
  }

  const frozen = Object.freeze(merged);
  cache.set(jurisdiction, frozen);
  return frozen;
}

export function _resetEscalationTriggerCache(): void {
  cache.clear();
}
