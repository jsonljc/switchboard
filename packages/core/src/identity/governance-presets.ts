import type {
  GovernanceProfile,
  RiskTolerance,
  SpendLimits,
} from "@switchboard/schemas";

export interface GovernanceProfilePreset {
  riskTolerance: RiskTolerance;
  spendLimits: SpendLimits;
  forbiddenBehaviors: string[];
  trustBehaviors: string[];
}

export const GOVERNANCE_PROFILE_PRESETS: Record<GovernanceProfile, GovernanceProfilePreset> = {
  observe: {
    riskTolerance: {
      none: "none",
      low: "none",
      medium: "none",
      high: "none",
      critical: "none",
    },
    spendLimits: {
      daily: null,
      weekly: null,
      monthly: null,
      perAction: null,
    },
    forbiddenBehaviors: [],
    trustBehaviors: [],
  },
  guarded: {
    riskTolerance: {
      none: "none",
      low: "none",
      medium: "standard",
      high: "elevated",
      critical: "mandatory",
    },
    spendLimits: {
      daily: 10000,
      weekly: null,
      monthly: null,
      perAction: 5000,
    },
    forbiddenBehaviors: [],
    trustBehaviors: [],
  },
  strict: {
    riskTolerance: {
      none: "none",
      low: "standard",
      medium: "elevated",
      high: "mandatory",
      critical: "mandatory",
    },
    spendLimits: {
      daily: 5000,
      weekly: 20000,
      monthly: 50000,
      perAction: 1000,
    },
    forbiddenBehaviors: [],
    trustBehaviors: [],
  },
  locked: {
    riskTolerance: {
      none: "mandatory",
      low: "mandatory",
      medium: "mandatory",
      high: "mandatory",
      critical: "mandatory",
    },
    spendLimits: {
      daily: 0,
      weekly: 0,
      monthly: 0,
      perAction: 0,
    },
    forbiddenBehaviors: [],
    trustBehaviors: [],
  },
};
