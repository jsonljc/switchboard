import type {
  IdentitySpec,
  RoleOverlay,
  RiskTolerance,
  SpendLimits,
  CompetenceAdjustment,
  GovernanceProfile,
} from "@switchboard/schemas";
import { GOVERNANCE_PROFILE_PRESETS } from "./governance-presets.js";

export interface ResolvedIdentity {
  spec: IdentitySpec;
  activeOverlays: RoleOverlay[];
  effectiveRiskTolerance: RiskTolerance;
  effectiveSpendLimits: SpendLimits;
  effectiveForbiddenBehaviors: string[];
  effectiveTrustBehaviors: string[];
  governanceProfile?: GovernanceProfile;
  delegatedApprovers: string[];
}

export function resolveIdentity(
  spec: IdentitySpec,
  overlays: RoleOverlay[],
  context: { cartridgeId?: string; riskCategory?: string; now?: Date },
): ResolvedIdentity {
  const now = context.now ?? new Date();

  // Filter active overlays that match conditions
  const activeOverlays = overlays
    .filter((o) => o.active)
    .filter((o) => matchesOverlayConditions(o, context, now))
    .sort((a, b) => a.priority - b.priority);

  // Start with base spec values
  let effectiveRiskTolerance = { ...spec.riskTolerance };
  let effectiveSpendLimits = { ...spec.globalSpendLimits };
  const effectiveForbiddenBehaviors = [...spec.forbiddenBehaviors];
  let effectiveTrustBehaviors = [...spec.trustBehaviors];

  // Apply governance profile presets as base (before overlays)
  const governanceProfile = spec.governanceProfile;
  if (governanceProfile) {
    const presets = GOVERNANCE_PROFILE_PRESETS[governanceProfile];
    effectiveRiskTolerance = { ...presets.riskTolerance };
    effectiveSpendLimits = { ...presets.spendLimits };
    for (const b of presets.forbiddenBehaviors) {
      if (!effectiveForbiddenBehaviors.includes(b)) {
        effectiveForbiddenBehaviors.push(b);
      }
    }
    for (const b of presets.trustBehaviors) {
      if (!effectiveTrustBehaviors.includes(b)) {
        effectiveTrustBehaviors.push(b);
      }
    }
  }

  // Apply overlays in priority order
  for (const overlay of activeOverlays) {
    if (overlay.overrides.riskTolerance) {
      if (overlay.mode === "restrict") {
        // Restrict: take the more restrictive of the two
        effectiveRiskTolerance = mergeRiskToleranceRestrictive(
          effectiveRiskTolerance,
          overlay.overrides.riskTolerance,
        );
      } else {
        // Extend: take the more permissive of the two
        effectiveRiskTolerance = mergeRiskTolerancePermissive(
          effectiveRiskTolerance,
          overlay.overrides.riskTolerance,
        );
      }
    }

    if (overlay.overrides.spendLimits) {
      if (overlay.mode === "restrict") {
        effectiveSpendLimits = mergeSpendLimitsRestrictive(
          effectiveSpendLimits,
          overlay.overrides.spendLimits,
        );
      } else {
        effectiveSpendLimits = mergeSpendLimitsPermissive(
          effectiveSpendLimits,
          overlay.overrides.spendLimits,
        );
      }
    }

    if (overlay.overrides.additionalForbiddenBehaviors) {
      for (const b of overlay.overrides.additionalForbiddenBehaviors) {
        if (!effectiveForbiddenBehaviors.includes(b)) {
          effectiveForbiddenBehaviors.push(b);
        }
      }
    }

    if (overlay.overrides.removeTrustBehaviors) {
      effectiveTrustBehaviors = effectiveTrustBehaviors.filter(
        (b) => !overlay.overrides.removeTrustBehaviors!.includes(b),
      );
    }
  }

  return {
    spec,
    activeOverlays,
    effectiveRiskTolerance,
    effectiveSpendLimits,
    effectiveForbiddenBehaviors,
    effectiveTrustBehaviors,
    governanceProfile,
    delegatedApprovers: spec.delegatedApprovers ?? [],
  };
}

export function matchesOverlayConditions(
  overlay: RoleOverlay,
  context: { cartridgeId?: string; riskCategory?: string },
  now: Date,
): boolean {
  const conds = overlay.conditions;

  // Check cartridge filter
  if (conds.cartridgeIds && conds.cartridgeIds.length > 0) {
    if (!context.cartridgeId || !conds.cartridgeIds.includes(context.cartridgeId)) {
      return false;
    }
  }

  // Check risk category filter
  if (conds.riskCategories && conds.riskCategories.length > 0) {
    if (!context.riskCategory || !conds.riskCategories.includes(context.riskCategory)) {
      return false;
    }
  }

  // Check time windows
  if (conds.timeWindows && conds.timeWindows.length > 0) {
    const matched = conds.timeWindows.some((tw) => {
      const day = now.getDay();
      const hour = now.getHours();
      return tw.dayOfWeek.includes(day) && hour >= tw.startHour && hour < tw.endHour;
    });
    if (!matched) return false;
  }

  return true;
}

const APPROVAL_ORDER = ["none", "standard", "elevated", "mandatory"] as const;

function approvalIndex(req: string): number {
  return APPROVAL_ORDER.indexOf(req as (typeof APPROVAL_ORDER)[number]);
}

function mergeRiskToleranceRestrictive(
  base: RiskTolerance,
  overlay: RiskTolerance,
): RiskTolerance {
  return {
    none: APPROVAL_ORDER[Math.max(approvalIndex(base.none), approvalIndex(overlay.none))]!,
    low: APPROVAL_ORDER[Math.max(approvalIndex(base.low), approvalIndex(overlay.low))]!,
    medium: APPROVAL_ORDER[Math.max(approvalIndex(base.medium), approvalIndex(overlay.medium))]!,
    high: APPROVAL_ORDER[Math.max(approvalIndex(base.high), approvalIndex(overlay.high))]!,
    critical: APPROVAL_ORDER[Math.max(approvalIndex(base.critical), approvalIndex(overlay.critical))]!,
  };
}

function mergeRiskTolerancePermissive(
  base: RiskTolerance,
  overlay: RiskTolerance,
): RiskTolerance {
  return {
    none: APPROVAL_ORDER[Math.min(approvalIndex(base.none), approvalIndex(overlay.none))]!,
    low: APPROVAL_ORDER[Math.min(approvalIndex(base.low), approvalIndex(overlay.low))]!,
    medium: APPROVAL_ORDER[Math.min(approvalIndex(base.medium), approvalIndex(overlay.medium))]!,
    high: APPROVAL_ORDER[Math.min(approvalIndex(base.high), approvalIndex(overlay.high))]!,
    critical: APPROVAL_ORDER[Math.min(approvalIndex(base.critical), approvalIndex(overlay.critical))]!,
  };
}

function mergeSpendLimitsRestrictive(
  base: SpendLimits,
  overlay: SpendLimits,
): SpendLimits {
  return {
    daily: minNullable(base.daily, overlay.daily),
    weekly: minNullable(base.weekly, overlay.weekly),
    monthly: minNullable(base.monthly, overlay.monthly),
    perAction: minNullable(base.perAction, overlay.perAction),
  };
}

function mergeSpendLimitsPermissive(
  base: SpendLimits,
  overlay: SpendLimits,
): SpendLimits {
  return {
    daily: maxNullable(base.daily, overlay.daily),
    weekly: maxNullable(base.weekly, overlay.weekly),
    monthly: maxNullable(base.monthly, overlay.monthly),
    perAction: maxNullable(base.perAction, overlay.perAction),
  };
}

function minNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

function maxNullable(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

export function applyCompetenceAdjustments(
  identity: ResolvedIdentity,
  adjustments: CompetenceAdjustment[],
): ResolvedIdentity {
  const newTrustBehaviors = [...identity.effectiveTrustBehaviors];

  for (const adj of adjustments) {
    if (
      adj.shouldTrust &&
      !identity.effectiveForbiddenBehaviors.includes(adj.actionType) &&
      !newTrustBehaviors.includes(adj.actionType)
    ) {
      newTrustBehaviors.push(adj.actionType);
    }
  }

  return {
    ...identity,
    effectiveTrustBehaviors: newTrustBehaviors,
  };
}
