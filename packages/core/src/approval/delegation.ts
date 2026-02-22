import type { DelegationRule, Principal } from "@switchboard/schemas";
import { resolveDelegationChain } from "./chain.js";
import type { DelegationChainResult } from "./chain.js";

export function canApprove(
  principal: Principal,
  approverIds: string[],
  delegations: DelegationRule[],
  now: Date = new Date(),
): boolean {
  // Direct approver: must be in the approver list AND have the approver role
  if (approverIds.includes(principal.id) && principal.roles.includes("approver")) {
    return true;
  }

  // Chain-based delegation resolution
  // Note: resolveDelegationChain has its own direct-match check that doesn't
  // consider roles. Since we already handled the direct case above (with role check),
  // we only proceed with chain resolution if there are delegations to traverse.
  if (delegations.length === 0) {
    return false;
  }

  const result = resolveDelegationChain(
    principal.id,
    approverIds,
    delegations,
    { now },
  );

  return result.authorized;
}

export function canApproveWithChain(
  principal: Principal,
  approverIds: string[],
  delegations: DelegationRule[],
  now: Date = new Date(),
): DelegationChainResult {
  // Direct approver
  if (approverIds.includes(principal.id) && principal.roles.includes("approver")) {
    return {
      authorized: true,
      chain: [principal.id],
      depth: 0,
      effectiveScope: "*",
    };
  }

  // Chain-based delegation resolution
  return resolveDelegationChain(
    principal.id,
    approverIds,
    delegations,
    { now },
  );
}
