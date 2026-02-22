import type { DelegationRule } from "@switchboard/schemas";

export interface DelegationChainResult {
  authorized: boolean;
  chain: string[];
  depth: number;
  effectiveScope: string;
}

export interface ChainResolutionOptions {
  maxDepth?: number;
  now?: Date;
  requiredScope?: string;
}

const DEFAULT_MAX_DEPTH = 5;

/**
 * Resolve a delegation chain from `principalId` to any of `approverIds`
 * via BFS backward through grantee→grantor links.
 *
 * At each hop:
 * - Check expiration
 * - Check `maxChainDepth` on the rule (rule-level depth cap)
 * - Narrow scope (intersection of scopes along the chain)
 * - Cycle detection via visited set
 * - Global depth cap (default 5)
 *
 * If `requiredScope` is specified, the final effective scope must cover it.
 *
 * Returns full chain path for audit trail.
 */
export function resolveDelegationChain(
  principalId: string,
  approverIds: string[],
  delegations: DelegationRule[],
  options?: ChainResolutionOptions,
): DelegationChainResult {
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const now = options?.now ?? new Date();
  const requiredScope = options?.requiredScope;

  // Direct match: principalId is already an approver
  if (approverIds.includes(principalId)) {
    return {
      authorized: true,
      chain: [principalId],
      depth: 0,
      effectiveScope: requiredScope ?? "*",
    };
  }

  // BFS: each node is { id, chain, depth, effectiveScope }
  interface BFSNode {
    id: string;
    chain: string[];
    depth: number;
    effectiveScope: string;
  }

  const queue: BFSNode[] = [{
    id: principalId,
    chain: [principalId],
    depth: 0,
    effectiveScope: "*",
  }];

  const visited = new Set<string>();
  visited.add(principalId);

  while (queue.length > 0) {
    const current = queue.shift()!;

    // Find all delegation rules where current node is the grantee
    for (const rule of delegations) {
      if (rule.grantee !== current.id) continue;
      if (rule.expiresAt && rule.expiresAt < now) continue;

      const grantor = rule.grantor;

      // Cycle detection
      if (visited.has(grantor)) continue;

      const nextDepth = current.depth + 1;

      // Global depth cap
      if (nextDepth > maxDepth) continue;

      // Rule-level depth cap: maxChainDepth limits how far this rule
      // can participate in a chain. If maxChainDepth=1 (default), this rule
      // only supports direct delegation (depth 1).
      const ruleMaxDepth = rule.maxChainDepth ?? 1;
      if (nextDepth > ruleMaxDepth) continue;

      // Scope narrowing: the effective scope is narrowed by the rule scope.
      // Each hop can only narrow or maintain the scope, never widen.
      const narrowedScope = narrowScope(current.effectiveScope, rule.scope);
      if (narrowedScope === null) continue; // incompatible scopes

      const newChain = [...current.chain, grantor];

      // Check if grantor is an approver
      if (approverIds.includes(grantor)) {
        // If requiredScope is specified, verify the effective scope covers it
        if (requiredScope && !scopeCovers(narrowedScope, requiredScope)) {
          continue;
        }
        return {
          authorized: true,
          chain: newChain,
          depth: nextDepth,
          effectiveScope: narrowedScope,
        };
      }

      visited.add(grantor);
      queue.push({
        id: grantor,
        chain: newChain,
        depth: nextDepth,
        effectiveScope: narrowedScope,
      });
    }
  }

  // No valid path found
  return {
    authorized: false,
    chain: [],
    depth: 0,
    effectiveScope: "",
  };
}

/**
 * Narrow the scope: returns the most specific (narrowest) scope
 * that is valid given the current effective scope and a rule scope.
 *
 * The result is the intersection — always the narrower of the two,
 * as long as they are compatible (one is a subset of the other).
 *
 * Rules:
 * - "*" + anything = anything (wildcard defers)
 * - "ads.*" + "ads.budget.*" = "ads.budget.*" (narrowing OK)
 * - "ads.budget.*" + "ads.*" = "ads.budget.*" (keep the narrower)
 * - exact + exact = same if equal, null otherwise
 * - incompatible scopes = null
 */
export function narrowScope(parentScope: string, childScope: string): string | null {
  if (parentScope === "*") return childScope;
  if (childScope === "*") return parentScope;
  if (parentScope === childScope) return parentScope;

  // Check if child is a subset of parent → narrowed to child
  if (isScopeSubset(parentScope, childScope)) {
    return childScope;
  }

  // Check if parent is a subset of child → keep parent (already narrower)
  if (isScopeSubset(childScope, parentScope)) {
    return parentScope;
  }

  // Incompatible scopes
  return null;
}

/**
 * Returns true if `scope` covers `targetScope`.
 * e.g., "ads.*" covers "ads.budget.adjust", "*" covers everything.
 */
function scopeCovers(scope: string, targetScope: string): boolean {
  if (scope === "*") return true;
  if (scope === targetScope) return true;

  if (scope.endsWith(".*")) {
    const prefix = scope.slice(0, -2);
    return targetScope.startsWith(prefix + ".") || targetScope === prefix;
  }

  return false;
}

/**
 * Returns true if `childScope` is a subset of (or equal to) `parentScope`.
 * e.g., "ads.budget.*" is a subset of "ads.*"
 */
function isScopeSubset(parentScope: string, childScope: string): boolean {
  if (parentScope === "*") return true;
  if (parentScope === childScope) return true;

  if (parentScope.endsWith(".*")) {
    const prefix = parentScope.slice(0, -2);
    // childScope must start with prefix + "."
    if (childScope.startsWith(prefix + ".")) return true;
    // childScope could also be an exact match with prefix
    if (childScope === prefix) return true;
  }

  return false;
}
