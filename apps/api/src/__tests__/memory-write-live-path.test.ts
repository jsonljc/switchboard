/**
 * LIVE-PATH reachability proof for the governed `memory.write` intent (S8b).
 *
 * Drives the REAL producer wiring (`bootstrapOperatorIntents` with `memoryWriteStore`)
 * -> a REAL `PlatformIngress` -> the REAL `GovernanceGate` (evaluate / resolveIdentity)
 * with the seeded { id:"system" } principal and NO seeded policy -> the REAL
 * `resolveAuthoritativeDeployment` + `buildPlatformDirectIntentPredicate` carve-out.
 *
 * Proves (the anti-"built-but-unwired" requirement):
 *   - a seeded {id:"system"} submit EXECUTES with NO policy seeded (the
 *     system_auto_approved + non-financial short-circuit BEFORE the policy engine),
 *     writing through the injected store with the AUTHENTICATED org;
 *   - the intent registers as operator_mutation + system_auto_approved + non-spend
 *     with the internal/schedule triggers;
 *   - WITHOUT the platform-direct carve-out the same submit is rejected
 *     deployment_not_found ("memory" has no seeded deployment) -- the carve-out is
 *     load-bearing.
 *
 * No Postgres (CI has none for apps/api): the store is an injected fake; everything
 * between (bootstrap, ingress, gate, carve-out resolver, handler) is production code.
 * Helpers copied verbatim from recommendation-handoff-cron-live-path.test.ts
 * (systemSpec / inMemoryTraceStore) and revenue-proof-digest-delivery-e2e.test.ts
 * (throwingResolver).
 */
import { describe, it, expect, vi } from "vitest";
import {
  GovernanceGate,
  PlatformIngress,
  IntentRegistry,
  ExecutionModeRegistry,
  type GovernanceGateDeps,
  type DeploymentResolver,
  type WorkTrace,
  type WorkTraceStore,
  type WorkTraceReadResult,
} from "@switchboard/core/platform";
import { evaluate, resolveIdentity } from "@switchboard/core";
import type { IdentitySpec } from "@switchboard/schemas";
import {
  bootstrapOperatorIntents,
  MEMORY_WRITE_INTENT,
  type MemoryWriteStore,
} from "../bootstrap/operator-intents.js";
import {
  resolveAuthoritativeDeployment,
  buildPlatformDirectIntentPredicate,
} from "../bootstrap/platform-deployment-resolver.js";

const ORG = "org-acme";

function systemSpec(): IdentitySpec {
  return {
    id: "spec-system",
    principalId: "system",
    organizationId: ORG,
    name: "System",
    description: "Seeded system principal",
    riskTolerance: {
      none: "none",
      low: "none",
      medium: "standard",
      high: "elevated",
      critical: "mandatory",
    },
    globalSpendLimits: { daily: null, weekly: null, monthly: null, perAction: null },
    cartridgeSpendLimits: {},
    forbiddenBehaviors: [],
    trustBehaviors: [],
    delegatedApprovers: [],
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

function inMemoryTraceStore(): WorkTraceStore {
  const traces: WorkTrace[] = [];
  return {
    claim: async () => ({ claimed: true }),
    persist: async (t: WorkTrace) => {
      traces.push(t);
    },
    getByWorkUnitId: async (id: string): Promise<WorkTraceReadResult | null> => {
      const trace = traces.find((t) => t.workUnitId === id);
      return trace ? { trace, integrity: { status: "ok" } } : null;
    },
    update: async (id: string, fields: Partial<WorkTrace>) => {
      const idx = traces.findIndex((t) => t.workUnitId === id);
      if (idx >= 0) traces[idx] = { ...traces[idx]!, ...fields };
      return { ok: true, trace: traces[idx >= 0 ? idx : 0] ?? ({} as never) };
    },
    getByIdempotencyKey: async () => null,
  } as unknown as WorkTraceStore;
}

// Production resolves the "memory" slug to no deployment (THROWS); the carve-out predicate decides
// whether resolveAuthoritativeDeployment short-circuits platform-direct instead of surfacing the throw.
function throwingResolver(): DeploymentResolver {
  return {
    resolveByOrgAndSlug: async () => {
      throw new Error("No active deployment found for org=org-acme slug=memory");
    },
    resolveByDeploymentId: async () => {
      throw new Error("not used in this test");
    },
    resolveByChannelToken: async () => {
      throw new Error("not used in this test");
    },
  } as unknown as DeploymentResolver;
}

// memory.write is system_auto_approved + non-financial, so the gate short-circuits to execute BEFORE
// loading any approval policy; the seeded system spec keeps the deps production-faithful and the empty
// loadPolicies proves the short-circuit (a default-deny would otherwise fire with no allow seeded).
function buildGate(): GovernanceGate {
  const deps: GovernanceGateDeps = {
    evaluate,
    resolveIdentity,
    loadPolicies: async () => [],
    loadIdentitySpec: async () => ({ spec: systemSpec(), overlays: [] }),
    loadCartridge: async () => null,
    getGovernanceProfile: async () => null,
  };
  return new GovernanceGate(deps);
}

function makeStore(): { create: ReturnType<typeof vi.fn> } & MemoryWriteStore {
  return { create: vi.fn<MemoryWriteStore["create"]>().mockResolvedValue({ id: "mem_1" }) };
}

function buildHarness(opts?: { carveOut?: boolean; store?: MemoryWriteStore }) {
  const carveOut = opts?.carveOut ?? true;
  const store = opts?.store ?? makeStore();
  const intentRegistry = new IntentRegistry();
  const modeRegistry = new ExecutionModeRegistry();
  bootstrapOperatorIntents({ intentRegistry, modeRegistry, memoryWriteStore: store });
  // no entitlementResolver: this harness isolates the governance gate. Entitlement is an orthogonal
  // org-level check (in prod it runs before the gate on every submit and returns entitled for an
  // active org); omitting it here keeps the test focused on the auto-approve short-circuit.
  const ingress = new PlatformIngress({
    intentRegistry,
    modeRegistry,
    governanceGate: buildGate(),
    deploymentResolver: resolveAuthoritativeDeployment(throwingResolver(), {
      isPlatformDirectIntent: carveOut
        ? buildPlatformDirectIntentPredicate(intentRegistry)
        : () => false,
    }),
    traceStore: inMemoryTraceStore(),
  });
  return { ingress, store, intentRegistry };
}

const params = {
  deploymentId: "dep_1",
  category: "fact",
  content: "Closed on Sundays",
  source: "conversation-compounding",
};

function submit(ingress: PlatformIngress) {
  return ingress.submit({
    organizationId: ORG,
    actor: { id: "system", type: "system" },
    intent: MEMORY_WRITE_INTENT,
    parameters: params,
    trigger: "internal",
    surface: { surface: "api" },
    idempotencyKey: "mw:org-acme:dep_1:fact:1",
  });
}

describe("memory.write governed path (live: real bootstrap + ingress + gate + carve-out)", () => {
  it("a seeded {id:'system'} submit EXECUTES with NO policy (auto-approve short-circuit) + writes through the store", async () => {
    const { ingress, store } = buildHarness();
    const res = await submit(ingress);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect("approvalRequired" in res && res.approvalRequired).toBeFalsy();
    expect(res.result.outcome).toBe("completed");
    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG,
        deploymentId: "dep_1",
        source: "conversation-compounding",
      }),
    );
  });

  it("registers operator_mutation + system_auto_approved + non-spend (+ internal/schedule triggers)", () => {
    const { intentRegistry } = buildHarness();
    const reg = intentRegistry.lookup(MEMORY_WRITE_INTENT);
    expect(reg?.defaultMode).toBe("operator_mutation");
    expect(reg?.approvalMode).toBe("system_auto_approved");
    expect(reg?.spendBearing ?? false).toBe(false);
    expect(reg?.allowedTriggers).toEqual(expect.arrayContaining(["internal", "schedule"]));
  });

  it("WITHOUT the platform-direct carve-out the same submit is rejected deployment_not_found (carve-out load-bearing)", async () => {
    const { ingress } = buildHarness({ carveOut: false });
    const res = await submit(ingress);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.type).toBe("deployment_not_found");
  });
});
