import type { Playbook } from "@switchboard/schemas";

export type TreatmentResolution =
  | { resolved: true; serviceId: string; serviceName: string }
  | { resolved: false; candidate: string | null };

/**
 * Resolves a sidecar's `treatmentInterest` against `Playbook.services`.
 * Case-insensitive equality on trimmed name. Returns unresolved for
 * free-text candidates that don't match a known service — those leads
 * cannot be marked `qualified` (spec §5.1).
 *
 * Aliases are NOT supported in v1 (PlaybookService schema has no
 * aliases[] field). 3c follow-up will add aliases once knowledge-gap
 * recommendations identify common variants.
 */
export function resolveTreatmentInterest(
  playbook: Playbook,
  treatmentInterest: string | null,
): TreatmentResolution {
  if (treatmentInterest === null) {
    return { resolved: false, candidate: null };
  }
  const trimmed = treatmentInterest.trim();
  if (trimmed.length === 0) {
    return { resolved: false, candidate: null };
  }
  const needle = trimmed.toLowerCase();
  for (const service of playbook.services ?? []) {
    if (service.name.trim().toLowerCase() === needle) {
      return { resolved: true, serviceId: service.id, serviceName: service.name };
    }
  }
  return { resolved: false, candidate: trimmed };
}
