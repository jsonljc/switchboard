import type { DelegationRule, Principal } from "@switchboard/schemas";

export function canApprove(
  principal: Principal,
  approverIds: string[],
  delegations: DelegationRule[],
  now: Date = new Date(),
): boolean {
  // Direct approver
  if (approverIds.includes(principal.id) && principal.roles.includes("approver")) {
    return true;
  }

  // Delegated approval
  return delegations.some((rule) => {
    if (rule.grantee !== principal.id) return false;
    if (!approverIds.includes(rule.grantor)) return false;
    if (rule.expiresAt && rule.expiresAt < now) return false;
    return true;
  });
}
