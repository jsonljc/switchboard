import type { Principal, DelegationRule } from "@switchboard/schemas";

export function canActAs(
  principal: Principal,
  targetPrincipalId: string,
  delegations: DelegationRule[],
  actionScope: string,
  now: Date = new Date(),
): boolean {
  // A principal can always act as themselves
  if (principal.id === targetPrincipalId) return true;

  // System principals can act as anyone
  if (principal.type === "system") return true;

  // Check delegation rules
  return delegations.some((rule) => {
    if (rule.grantor !== targetPrincipalId) return false;
    if (rule.grantee !== principal.id) return false;
    if (rule.expiresAt && rule.expiresAt < now) return false;
    return matchesScope(rule.scope, actionScope);
  });
}

function matchesScope(ruleScope: string, actionScope: string): boolean {
  if (ruleScope === "*") return true;
  if (ruleScope === actionScope) return true;

  // Wildcard matching: "ads.*" matches "ads.budget.adjust"
  if (ruleScope.endsWith(".*")) {
    const prefix = ruleScope.slice(0, -2);
    return actionScope.startsWith(prefix + ".");
  }

  return false;
}

export function resolveApprovers(
  approverIds: string[],
  fallbackApprover: string | null,
  principals: Principal[],
): string[] {
  const validApprovers = approverIds.filter((id) =>
    principals.some((p) => p.id === id && p.roles.includes("approver")),
  );

  if (validApprovers.length === 0 && fallbackApprover) {
    return [fallbackApprover];
  }

  return validApprovers;
}
