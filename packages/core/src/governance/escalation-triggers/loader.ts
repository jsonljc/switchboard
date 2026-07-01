import type { EscalationTriggerEntry } from "./types.js";
import { COMMON_ESCALATION_TRIGGERS, COMMON_ESCALATION_TRIGGERS_BY_VERTICAL } from "./common.js";
import { SG_ESCALATION_TRIGGERS, SG_ESCALATION_TRIGGERS_BY_VERTICAL } from "./sg.js";
import { MY_ESCALATION_TRIGGERS, MY_ESCALATION_TRIGGERS_BY_VERTICAL } from "./my.js";
import { DEFAULT_VERTICAL, type Vertical } from "../../vertical.js";

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

// Cache keyed on (vertical, jurisdiction), the composite the loader now keys on.
const cache = new Map<string, ReadonlyArray<EscalationTriggerEntry>>();

/**
 * Load the merged escalation-trigger table for a (vertical, jurisdiction) pair.
 *
 * `jurisdiction` stays the FIRST positional param and `vertical` is an optional
 * second param defaulting to `medspa`, so every existing single-arg caller (and
 * the by-reference `escalationTriggerLoader: loadEscalationTriggers` wiring)
 * stays byte-identical: same merged set, same order, same frozen instance per
 * key. A vertical without its own table inherits the medspa seed floor
 * (over-restrict is the safe direction until that vertical's pack lands).
 */
export function loadEscalationTriggers(
  jurisdiction: "SG" | "MY",
  vertical: Vertical = DEFAULT_VERTICAL,
): ReadonlyArray<EscalationTriggerEntry> {
  const cacheKey = `${vertical}:${jurisdiction}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const common = COMMON_ESCALATION_TRIGGERS_BY_VERTICAL[vertical] ?? COMMON_ESCALATION_TRIGGERS;
  const jurisdictionTable =
    jurisdiction === "SG"
      ? (SG_ESCALATION_TRIGGERS_BY_VERTICAL[vertical] ?? SG_ESCALATION_TRIGGERS)
      : (MY_ESCALATION_TRIGGERS_BY_VERTICAL[vertical] ?? MY_ESCALATION_TRIGGERS);

  const merged: EscalationTriggerEntry[] = [...common, ...jurisdictionTable].map(normalizeEntry);

  const seen = new Set<string>();
  for (const entry of merged) {
    if (seen.has(entry.id)) {
      throw new Error(
        `Duplicate escalation-trigger id "${entry.id}" in ${vertical}/${jurisdiction} merged set`,
      );
    }
    seen.add(entry.id);
  }

  const frozen = Object.freeze(merged);
  cache.set(cacheKey, frozen);
  return frozen;
}

export function _resetEscalationTriggerCache(): void {
  cache.clear();
}
