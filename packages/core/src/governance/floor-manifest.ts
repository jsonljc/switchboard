/**
 * Floor manifest: the minimum safety coverage every vertical's governance
 * tables MUST satisfy.
 *
 * The universal safe-harbor floor (docs/superpowers/specs/2026-07-02-safe-harbor-floor.md,
 * D4) requires that a vertical pack may ADD boundaries but may NEVER remove a
 * floor one. This manifest encodes that as a superset assertion: each probe
 * below must match at least one entry in a vertical's merged table, else the
 * loader throws (fail-closed at load, the same posture as `composePackBody`).
 *
 * The manifest is authored so the medspa seed passes with ZERO edits: every
 * probe already matches a medspa COMMON entry (verified in floor-manifest.test.ts).
 * A candidate floor boundary that medspa does NOT already cover in its loader
 * tables (e.g. an explicit financial/legal boundary) does NOT belong here; it
 * rides the prompt floor (SH-5), keeping the loader floor a strict subset of
 * medspa so this assertion never perturbs medspa.
 */
export interface FloorCoverageRequirement {
  /** Stable id for the required coverage category. */
  id: string;
  /** Why this coverage is a floor safety boundary. */
  rationale: string;
  /** Canonical text that MUST match at least one entry in the merged table. */
  probe: string;
}

/**
 * Banned-phrase floor: the universal (vertical-agnostic) claim boundaries. The
 * pattern-scannable subset of the floor content; affirmative boundaries
 * ("disclose AI", "no financial/legal advice") ride the prompt floor (SH-5).
 */
export const BANNED_PHRASE_FLOOR_MANIFEST: ReadonlyArray<FloorCoverageRequirement> = [
  {
    id: "guarantee",
    rationale: "No outcome guarantees (universal claim boundary).",
    probe: "guaranteed results",
  },
  {
    id: "superlative",
    rationale: "No unsubstantiated superlatives (universal claim boundary).",
    probe: "world-class results",
  },
  {
    id: "health_claim",
    rationale: "No cure / health-outcome overclaims (universal claim boundary).",
    probe: "this cures everything",
  },
];

/**
 * Escalation floor: the universally pattern-scannable, safety-critical
 * escalation categories every agent must hand to a human. Broader
 * "escalate on regulated topics" is affirmative and rides the prompt floor (SH-5).
 */
export const ESCALATION_FLOOR_MANIFEST: ReadonlyArray<FloorCoverageRequirement> = [
  {
    id: "minor",
    rationale: "A self-disclosed minor must escalate to a human (universal safety).",
    probe: "i'm 15",
  },
  {
    id: "mental_health_crisis",
    rationale: "A mental-health crisis disclosure must escalate to a human (universal safety).",
    probe: "i feel suicidal",
  },
];

/**
 * Assert a merged table covers every floor requirement, else THROW (fail-closed).
 *
 * `isCovered` is injected (rather than importing a scanner) so this module stays
 * agnostic to the banned-phrase vs escalation matcher, so each loader passes its
 * own scanner. Called once per (vertical, jurisdiction) on the loader's cache
 * miss, so the cost is paid at most once per key.
 */
export function assertFloorCoverage<T>(
  entries: ReadonlyArray<T>,
  manifest: ReadonlyArray<FloorCoverageRequirement>,
  isCovered: (probe: string, entries: ReadonlyArray<T>) => boolean,
  label: string,
): void {
  for (const requirement of manifest) {
    if (!isCovered(requirement.probe, entries)) {
      throw new Error(
        `Floor coverage violation in ${label}: no entry matches the required "${requirement.id}" ` +
          `probe ${JSON.stringify(requirement.probe)}. A vertical pack must not remove a floor ` +
          `safety boundary (${requirement.rationale}).`,
      );
    }
  }
}
