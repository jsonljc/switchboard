// packages/ad-optimizer/src/learned-modifiers.ts
//
// Resolves Riley's per-org LEARNED confidence modifiers once per weekly audit from the
// bootstrap-injected providers: D7-2 (operator approval rate) and D7-1 (measured-outcome
// readback). Extracted from inngest-functions so the orchestration loop stays small and the
// resolution is unit-testable in isolation. Each modifier is bounded + abstaining; an absent
// provider yields `undefined` (no adjustment, back-compat).
import { confidenceModifierForKind } from "./confidence-modifier.js";
import { outcomeAdjustmentForKind } from "./outcome-readback.js";

export interface LearnedModifierProviders {
  /** D7-2: per-org operator approve/reject counts by action kind. */
  approvalRateProvider?: (
    orgId: string,
  ) => Promise<Map<string, { approved: number; rejected: number }>>;
  /** D7-1: per-org corroborated-direction counts by action kind. */
  outcomeSignalProvider?: (
    orgId: string,
  ) => Promise<Map<string, { corroboratedUp: number; corroboratedDown: number }>>;
}

export interface LearnedModifiers {
  /** D7-2 approval-rate modifier (absent ⇒ no provider wired). */
  confidenceModifierByKind?: (action: string) => number;
  /** D7-1 outcome readback multiplier (absent ⇒ no provider wired). */
  outcomeMultiplierByKind?: (action: string) => number;
}

/**
 * Resolve the per-org learned modifiers ONCE per audit. Reads each injected provider (a single DB
 * read per org), then closes a bounded, abstaining per-kind modifier over the aggregate: a kind
 * with no history resolves to the neutral default, which the underlying modifier abstains on.
 * `decideForCampaign` composes the two through the engine's single clamp.
 */
export async function resolveLearnedModifiers(
  providers: LearnedModifierProviders,
  orgId: string,
): Promise<LearnedModifiers> {
  const approvalAgg = providers.approvalRateProvider
    ? await providers.approvalRateProvider(orgId)
    : undefined;
  const outcomeAgg = providers.outcomeSignalProvider
    ? await providers.outcomeSignalProvider(orgId)
    : undefined;
  return {
    ...(approvalAgg
      ? {
          confidenceModifierByKind: (action: string): number =>
            confidenceModifierForKind(approvalAgg.get(action) ?? { approved: 0, rejected: 0 }),
        }
      : {}),
    ...(outcomeAgg
      ? {
          outcomeMultiplierByKind: (action: string): number =>
            outcomeAdjustmentForKind(
              outcomeAgg.get(action) ?? { corroboratedUp: 0, corroboratedDown: 0 },
            ).confidenceMultiplier,
        }
      : {}),
  };
}
