export interface EscalationRule {
  riskCategory: string;
  approverIds: string[];
  notifyChannel: string | null;
  notifyThreadId: string | null;
  timeoutMs: number;
  fallbackApprover: string | null;
}

export const DEFAULT_ESCALATION_RULES: EscalationRule[] = [
  {
    riskCategory: "high",
    approverIds: [],
    notifyChannel: null,
    notifyThreadId: null,
    timeoutMs: 12 * 60 * 60 * 1000,
    fallbackApprover: null,
  },
  {
    riskCategory: "critical",
    approverIds: [],
    notifyChannel: null,
    notifyThreadId: null,
    timeoutMs: 4 * 60 * 60 * 1000,
    fallbackApprover: null,
  },
];

export function findEscalationRule(
  riskCategory: string,
  rules: EscalationRule[] = DEFAULT_ESCALATION_RULES,
): EscalationRule | undefined {
  return rules.find((r) => r.riskCategory === riskCategory);
}
