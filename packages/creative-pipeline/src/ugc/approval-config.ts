// packages/core/src/creative-pipeline/ugc/approval-config.ts

const UGC_PHASE_ORDER = ["planning", "scripting", "production", "delivery"] as const;
export type UgcPhase = (typeof UGC_PHASE_ORDER)[number];
export { UGC_PHASE_ORDER };

export interface ApprovalConfig {
  autoApproveThresholds: Record<UgcPhase, number>;
  alwaysRequireApproval: UgcPhase[];
}

export const DEFAULT_APPROVAL_CONFIG: ApprovalConfig = {
  autoApproveThresholds: {
    planning: 55,
    scripting: 55,
    production: 80,
    delivery: 80,
  },
  alwaysRequireApproval: [],
};

export function shouldRequireApproval(ctx: {
  phase: string;
  trustLevel: number;
  deploymentType: string;
}): boolean {
  const config = DEFAULT_APPROVAL_CONFIG;
  const phase = ctx.phase as UgcPhase;
  if (config.alwaysRequireApproval.includes(phase)) return true;
  const threshold = config.autoApproveThresholds[phase];
  if (threshold === undefined) return true;
  return ctx.trustLevel < threshold;
}
