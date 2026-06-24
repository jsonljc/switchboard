# S8b — `memory.write` governance intent (Implementation Plan)

> **For agentic workers:** TDD-shaped, executed via the build-loop EXECUTE phase (RED proof per step). `.claude/` scratch (uncommitted). Plan is FINAL after the 2B fan-out plan-grade.

**Goal:** Register a governed `memory.write` intent so DeploymentMemory writes can flow through `PlatformIngress` (audited via WorkTrace, idempotent, governed) — as an **operator_mutation** + **system_auto_approved** + **non-financial** intent, mirroring `receipt.reconcile_booking`. REGISTER the reachable path only (S8c reroutes the actual writers). Plus the S8a follow-up: tag the operator memory-correction route create with `source:"operator"`.

**Architecture (resolved against the code, per `feedback_operator_mutation_owner_action_recipe`):** operator_mutation means NO anchored allow policy (GovernanceGate short-circuits non-financial `system_auto_approved` BEFORE the policy engine — governance-gate.ts:162-193), NO deployment seed / no PLATFORM_DIRECT_WORKFLOW_INTENTS entry (operator_mutation auto-resolves platform-direct — platform-deployment-resolver.ts:67-73), NO route-allowlist (flows through `submit`), NO eval:governance fixture, NO SKILL.md. The prompt scope's "anchored allow Policy + executorBySlug" is the SKILL-MODE recipe, which the operator_mutation recipe explicitly flags as WRONG for an owner/system-direct mutation. NO db/prisma/migration change (S8a's `PrismaDeploymentMemoryStore.create` already accepts `source`). `spendBearing` omitted (=false) -> passes the F4 guard.

**Layers:** schemas (param schema) -> apps/api (intent const + handler + bootstrap wiring + app.ts producer + live-path test + route fold-in). No core/db change.

**Tech:** TS ESM monorepo (pnpm + Turbo), Zod, Vitest (mocked Prisma / injected fakes; CI has no Postgres). Reachability proof = real `bootstrapOperatorIntents` + real `GovernanceGate`(`evaluate`/`resolveIdentity`) + real `PlatformIngress` + real `resolveAuthoritativeDeployment`/`buildPlatformDirectIntentPredicate`, injected fake store.

## Global Constraints (verbatim, every task)

- ESM only; `.js` extensions on relative imports. No `console.log`. No `any` (use `unknown`/proper types). Prettier: semi, double quotes, 2-space, trailing commas, 100 width. **No em-dashes anywhere.**
- Co-located `*.test.ts` for every module touched. Per-package `pnpm --filter X exec tsc --noEmit` before commit (pre-commit hook is eslint+prettier ONLY, NOT tsc). Rebuild a lower package's dist (`pnpm --filter X build`) after its task so apps/tests consuming the dist see new types (schemas -> api).
- Layers: schemas -> sdk -> core -> db -> apps; no cycles. apps may import anything. Lowercase commit subjects (Conventional Commits).
- Invariant context: S8b of S8 (govern memory writes through PlatformIngress). REGISTER the path; do NOT reroute writers (S8c). Do NOT touch core/db/prisma, the compounding service, or the decay cron.

**baseline_sha:** captured at worktree creation (origin/main @ a2de9564f or later — re-fetch).

---

### Task 1: `MemoryWriteParametersSchema` (schemas, Layer 1)

**Files:**

- Modify: `packages/schemas/src/deployment-memory.ts` (add after `DeploymentMemorySchema`, ~line 93)
- Test: `packages/schemas/src/__tests__/deployment-memory.test.ts` (append a describe; add `MemoryWriteParametersSchema` to the existing import from `"../deployment-memory.js"`)

**Interfaces produced:** `MemoryWriteParametersSchema` (z.object) + `type MemoryWriteParameters`. Consumed by Task 2 (handler) and S8c (caller params). `organizationId` is NOT a param (comes from `workUnit.organizationId`). `source` REQUIRED. `validFrom` intentionally omitted (store sets it to write-time `now`; see FRAME pt 3).

- [ ] **Step 1: Write the failing test.** Append to `packages/schemas/src/__tests__/deployment-memory.test.ts` (and add `MemoryWriteParametersSchema` to the import):

```ts
describe("MemoryWriteParametersSchema", () => {
  const base = {
    deploymentId: "d1",
    category: "fact",
    content: "Closed on Sundays",
    source: "conversation-compounding",
  };
  it("parses a minimal valid governed memory write", () => {
    expect(MemoryWriteParametersSchema.safeParse(base).success).toBe(true);
  });
  it("parses with optional confidence + canonicalKey", () => {
    expect(
      MemoryWriteParametersSchema.safeParse({ ...base, confidence: 0.8, canonicalKey: "k1" })
        .success,
    ).toBe(true);
  });
  it("requires source (provenance is mandatory for a governed write)", () => {
    const { source: _omit, ...noSource } = base;
    expect(MemoryWriteParametersSchema.safeParse(noSource).success).toBe(false);
  });
  it("rejects an unknown category", () => {
    expect(MemoryWriteParametersSchema.safeParse({ ...base, category: "nope" }).success).toBe(
      false,
    );
  });
  it("rejects an unknown source", () => {
    expect(MemoryWriteParametersSchema.safeParse({ ...base, source: "magic" }).success).toBe(false);
  });
  it("rejects confidence outside [0,1]", () => {
    expect(MemoryWriteParametersSchema.safeParse({ ...base, confidence: 1.5 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify RED.** `pnpm --filter @switchboard/schemas test -- deployment-memory` -> FAIL (`MemoryWriteParametersSchema` not exported).
- [ ] **Step 3: Implement.** In `deployment-memory.ts`, after `DeploymentMemorySchema` / `export type DeploymentMemory` (~line 93) add (both enums `DeploymentMemoryCategorySchema`@7 + `DeploymentMemorySourceSchema`@32 are already in scope):

```ts
/**
 * Parameters for the governed `memory.write` operator intent (S8b) — the
 * non-conversation path for writing a DeploymentMemory through PlatformIngress
 * (operator_mutation + system_auto_approved + non-financial), so the write is
 * audited via WorkTrace, idempotent, and routed through the governance gate.
 * organizationId is NOT a parameter: it comes from the authenticated
 * workUnit.organizationId, never a body field (mirrors ReconcileBookingParametersSchema).
 * `source` is REQUIRED — provenance ("who asserted this fact") is the point of S8.
 * `validFrom` is intentionally NOT a parameter: the store sets it to write-time
 * `now`; writer-asserted valid-time is a deliberate future extension (no current
 * or planned writer asserts one).
 */
export const MemoryWriteParametersSchema = z.object({
  deploymentId: z.string().min(1),
  category: DeploymentMemoryCategorySchema,
  content: z.string().min(1),
  source: DeploymentMemorySourceSchema,
  confidence: z.number().min(0).max(1).optional(),
  canonicalKey: z.string().min(1).nullable().optional(),
});
export type MemoryWriteParameters = z.infer<typeof MemoryWriteParametersSchema>;
```

- [ ] **Step 4: GREEN.** `pnpm --filter @switchboard/schemas test -- deployment-memory` -> PASS. Then `pnpm --filter @switchboard/schemas build` (api consumes the dist).
- [ ] **Step 5: Commit.** `git add packages/schemas/src/deployment-memory.ts packages/schemas/src/__tests__/deployment-memory.test.ts && git commit -m "feat(schemas): add MemoryWriteParametersSchema for the governed memory.write intent (S8b)"`

---

### Task 2: `memory.write` intent const + handler + handler unit test (apps/api)

**Files:**

- Modify: `apps/api/src/bootstrap/operator-intents/shared.ts` (add the intent const)
- Create: `apps/api/src/bootstrap/operator-intents/memory-write.ts` (handler + `MemoryWriteStore`)
- Create: `apps/api/src/bootstrap/operator-intents/memory-write.test.ts`
- Modify: `apps/api/src/bootstrap/operator-intents.ts` (barrel re-exports only)

**Interfaces produced:** `MEMORY_WRITE_INTENT="memory.write"`, `buildMemoryWriteHandler(store): OperatorMutationHandler`, `interface MemoryWriteStore`. Consumed by Task 3 (wiring + live-path test).

- [ ] **Step 1: Add the intent const.** In `shared.ts`, after `ERASE_CONTACT_INTENT` (line 25): `export const MEMORY_WRITE_INTENT = "memory.write";`
- [ ] **Step 2: Write the failing handler test** `apps/api/src/bootstrap/operator-intents/memory-write.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  buildMemoryWriteHandler,
  MEMORY_WRITE_INTENT,
  type MemoryWriteStore,
} from "./memory-write.js";

function workUnit(parameters: Record<string, unknown>, orgId = "org_1", actorId = "system") {
  return {
    organizationId: orgId,
    actor: { id: actorId, type: "system" as const },
    intent: MEMORY_WRITE_INTENT,
    parameters,
  } as never;
}
function makeStore(): { create: ReturnType<typeof vi.fn> } & MemoryWriteStore {
  return { create: vi.fn<MemoryWriteStore["create"]>().mockResolvedValue({ id: "mem_1" }) };
}
const valid = {
  deploymentId: "dep_1",
  category: "fact",
  content: "Closed on Sundays",
  source: "conversation-compounding",
};

describe("buildMemoryWriteHandler", () => {
  it("writes through the store with the AUTHENTICATED org (never a body field) + provenance", async () => {
    const store = makeStore();
    const res = await buildMemoryWriteHandler(store).execute(
      workUnit({ ...valid, confidence: 0.8 }, "org_42"),
    );
    expect(res.outcome).toBe("completed");
    expect(res.outputs).toMatchObject({ id: "mem_1", source: "conversation-compounding" });
    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_42",
        deploymentId: "dep_1",
        category: "fact",
        content: "Closed on Sundays",
        source: "conversation-compounding",
        confidence: 0.8,
      }),
    );
  });
  it("defaults canonicalKey to null when omitted", async () => {
    const store = makeStore();
    await buildMemoryWriteHandler(store).execute(workUnit(valid));
    expect(store.create.mock.calls[0][0].canonicalKey).toBeNull();
  });
  it("throws (Zod) on invalid params without calling the store", async () => {
    const store = makeStore();
    await expect(
      buildMemoryWriteHandler(store).execute(workUnit({ ...valid, source: "bogus" })),
    ).rejects.toThrow();
    expect(store.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: RED.** `pnpm --filter @switchboard/api test -- memory-write` -> FAIL (`./memory-write.js` does not exist).
- [ ] **Step 4: Implement the handler** `apps/api/src/bootstrap/operator-intents/memory-write.ts`:

```ts
// apps/api/src/bootstrap/operator-intents/memory-write.ts
// memory.write handler (S8b). The governed, non-conversation path for writing a learned
// DeploymentMemory through PlatformIngress: operator_mutation + system_auto_approved +
// non-financial (no outbound spend, no second approver), fully audited via the WorkTrace
// PlatformIngress writes around the handler. S8b REGISTERS this path; S8c reroutes the
// conversation-compounding + decay writers to submit through it.
import type { OperatorMutationHandler } from "@switchboard/core/platform";
import { MemoryWriteParametersSchema, type DeploymentMemorySource } from "@switchboard/schemas";
import { MEMORY_WRITE_INTENT } from "./shared.js";

export { MEMORY_WRITE_INTENT };

/**
 * Minimal store surface the handler writes through; PrismaDeploymentMemoryStore satisfies it
 * structurally (its create() already accepts source — S8a). organizationId is the AUTHENTICATED
 * actor's org from the work unit, never a body field.
 */
export interface MemoryWriteStore {
  create(input: {
    organizationId: string;
    deploymentId: string;
    category: string;
    content: string;
    confidence?: number;
    canonicalKey?: string | null;
    source?: DeploymentMemorySource | null;
  }): Promise<{ id: string }>;
}

export function buildMemoryWriteHandler(store: MemoryWriteStore): OperatorMutationHandler {
  return {
    async execute(workUnit) {
      const params = MemoryWriteParametersSchema.parse(workUnit.parameters);
      const entry = await store.create({
        organizationId: workUnit.organizationId,
        deploymentId: params.deploymentId,
        category: params.category,
        content: params.content,
        confidence: params.confidence,
        canonicalKey: params.canonicalKey ?? null,
        source: params.source,
      });
      return {
        outcome: "completed" as const,
        summary: `Wrote ${params.category} memory for deployment ${params.deploymentId}`,
        outputs: { id: entry.id, source: params.source },
      };
    },
  };
}
```

- [ ] **Step 5: Barrel re-exports.** In `apps/api/src/bootstrap/operator-intents.ts`: add `MEMORY_WRITE_INTENT` to the `export { ... } from "./operator-intents/shared.js"` block (line ~88-102), and add `export { buildMemoryWriteHandler } from "./operator-intents/memory-write.js";` + `export type { MemoryWriteStore } from "./operator-intents/memory-write.js";` alongside the other handler re-exports (~line 103-123).
- [ ] **Step 6: GREEN + typecheck.** `pnpm --filter @switchboard/api test -- memory-write` -> PASS. `pnpm --filter @switchboard/api exec tsc --noEmit` -> clean.
- [ ] **Step 7: Commit.** `git add apps/api/src/bootstrap/operator-intents/shared.ts apps/api/src/bootstrap/operator-intents/memory-write.ts apps/api/src/bootstrap/operator-intents/memory-write.test.ts apps/api/src/bootstrap/operator-intents.ts && git commit -m "feat(api): add memory.write operator-mutation handler (S8b)"`

---

### Task 3: bootstrap wiring + app.ts producer + reachability live-path test (apps/api)

**Files:**

- Create: `apps/api/src/__tests__/memory-write-live-path.test.ts`
- Modify: `apps/api/src/bootstrap/operator-intents.ts` (deps interface + bootstrap body + intentCount)
- Modify: `apps/api/src/app.ts` (construct + pass `memoryWriteStore` in the `if (prismaClient)` block)

**This is the producer-population step** (`feedback_safety_gate_needs_producer_population`): the intent is inert until `bootstrapOperatorIntents` registers it AND app.ts passes the store. The live-path test proves the bootstrap producer; app.ts mirrors the existing store wiring (typecheck + review verified).

- [ ] **Step 1: Add the dep to the interface (so the test compiles).** In `operator-intents.ts`: import `buildMemoryWriteHandler, type MemoryWriteStore` from `./operator-intents/memory-write.js` and `MEMORY_WRITE_INTENT` from `./operator-intents/shared.js` (add to the existing shared.js import block). Add to `OperatorIntentsBootstrapDeps` (after `contactEraser`, ~line 154): `/** Optional: registers the memory.write intent + handler when provided (S8b). The governed, non-conversation DeploymentMemory write path. */ memoryWriteStore?: MemoryWriteStore;`. Do NOT add the handlers.set / register yet.
- [ ] **Step 2: Write the failing live-path test** `apps/api/src/__tests__/memory-write-live-path.test.ts` (model on `recommendation-handoff-cron-live-path.test.ts` for `systemSpec`/`inMemoryTraceStore`, and on `revenue-proof-digest-delivery-e2e.test.ts` for `throwingResolver` + the `carveOut` toggle — copy those helpers verbatim, adjusting types):

```ts
import { describe, it, expect, vi } from "vitest";
import {
  GovernanceGate,
  PlatformIngress,
  IntentRegistry,
  ExecutionModeRegistry,
  type GovernanceGateDeps,
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
  /* copy verbatim from recommendation-handoff-cron-live-path.test.ts */
}
function inMemoryTraceStore(): WorkTraceStore {
  /* copy verbatim from recommendation-handoff-cron-live-path.test.ts */
}
function throwingResolver() {
  /* copy from revenue-proof-digest-delivery-e2e.test.ts — resolveByOrgAndSlug throws */
}

function buildGate(): GovernanceGate {
  const deps: GovernanceGateDeps = {
    evaluate,
    resolveIdentity,
    loadPolicies: async () => [], // NO policy seeded — proves the system_auto_approved short-circuit
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
    expect(res.error.type).toBe("deployment_not_found"); // VERIFY exact field/value vs platform-ingress.ts at execute time
  });
});
```

- [ ] **Step 3: RED.** `pnpm --filter @switchboard/api test -- memory-write-live-path` -> FAIL: the intent is not registered (no handlers.set/register yet), so the submit does NOT complete (the first test fails; lookup returns undefined in the second). Capture the failing excerpt.
- [ ] **Step 4: Implement the bootstrap wiring.** In `bootstrapOperatorIntents` (operator-intents.ts): destructure `memoryWriteStore` from deps; after the `contactEraser` handler block (~line 281) add `if (memoryWriteStore) { handlers.set(MEMORY_WRITE_INTENT, buildMemoryWriteHandler(memoryWriteStore)); }`; after the `contactEraser` register block (~line 320) add `if (memoryWriteStore) { registerOperatorIntent(intentRegistry, MEMORY_WRITE_INTENT, ["internal", "schedule"]); }`; add `(memoryWriteStore ? 1 : 0)` to `intentCount`.
- [ ] **Step 5: GREEN.** `pnpm --filter @switchboard/api test -- memory-write-live-path` -> PASS (adjust the deployment_not_found assertion to the real error shape if needed). Also re-run `-- memory-write` (Task 2 still green).
- [ ] **Step 6: Wire the prod producer (app.ts).** In `app.ts`, inside the `if (prismaClient)` block (the one that calls `bootstrapOperatorIntents`, ~line 945-1085): add `const { PrismaDeploymentMemoryStore } = await import("@switchboard/db");` near the other store imports (~line 947-950) and `const memoryWriteStore = new PrismaDeploymentMemoryStore(prismaClient);` near the other store constructions (~line 951-957); then add `memoryWriteStore,` to the `bootstrapOperatorIntents({ ... })` call object (~line 1060+). (`PrismaDeploymentMemoryStore.create` satisfies `MemoryWriteStore` structurally.)
- [ ] **Step 7: typecheck + build.** `pnpm --filter @switchboard/api exec tsc --noEmit` -> clean. (`pnpm --filter @switchboard/api build` deferred to VERIFY; chat does not consume these symbols.)
- [ ] **Step 8: Commit.** `git add apps/api/src/bootstrap/operator-intents.ts apps/api/src/app.ts apps/api/src/__tests__/memory-write-live-path.test.ts && git commit -m "feat(api): register + wire the memory.write governed path through PlatformIngress (S8b)"`

---

### Task 4: S8a follow-up — tag the operator memory-correction route `source:"operator"` (apps/api)

**Files:**

- Modify: `apps/api/src/routes/deployment-memory.ts` (the POST create, line 60-66)
- Test: `apps/api/src/routes/__tests__/deployment-memory-cross-tenant.test.ts` (add a provenance describe; reuses the module-scope `buildApp` + `buildMockPrisma`, whose `deploymentMemory.create` is a `vi.fn` spy)

- [ ] **Step 1: Write the failing test.** Append to `deployment-memory-cross-tenant.test.ts` a new describe (after the A1 describe):

```ts
describe("deployment-memory provenance — owner corrections tag source=operator (S8a follow-up)", () => {
  it("passes source=operator to the store on a same-org correction", async () => {
    const prisma = buildMockPrisma();
    const app = await buildApp({ prisma, organizationId: "org_a" });
    const res = await app.inject({
      method: "POST",
      url: "/api/marketplace/org_a/deployments/dep-1/memory",
      payload: { content: "Closed on Sundays", category: "fact" },
    });
    expect(res.statusCode).toBe(201);
    expect(prisma.deploymentMemory.create).toHaveBeenCalledTimes(1);
    expect(prisma.deploymentMemory.create.mock.calls[0][0].data.source).toBe("operator");
  });
});
```

(If `prisma`/`buildApp`/`buildMockPrisma` are not module-scoped-accessible from a new describe, hoist or reuse the existing `beforeEach` `prisma`. Confirm at execute time.)

- [ ] **Step 2: RED.** `pnpm --filter @switchboard/api test -- deployment-memory-cross-tenant` -> FAIL (`data.source` is `null`/undefined — route does not pass source).
- [ ] **Step 3: Implement.** In `deployment-memory.ts`, the POST create (line 60-66), add `source: "operator",` to the `store.create({...})` object (the route is the owner-correction surface, so its provenance is `"operator"`; matches `DeploymentMemorySourceSchema`). Add a one-line comment: `// S8a provenance: owner corrections are operator-sourced.`
- [ ] **Step 4: GREEN + typecheck.** `pnpm --filter @switchboard/api test -- deployment-memory-cross-tenant` -> PASS. `pnpm --filter @switchboard/api exec tsc --noEmit` -> clean.
- [ ] **Step 5: Commit.** `git add apps/api/src/routes/deployment-memory.ts apps/api/src/routes/__tests__/deployment-memory-cross-tenant.test.ts && git commit -m "fix(api): tag operator memory corrections with source=operator (S8a follow-up)"`

---

## Self-review (against the S8 design + FRAME)

- **Spec coverage:** memory.write IntentRegistration (operator_mutation/system_auto_approved/non-spend, via `registerOperatorIntent`) ✓ (T3); parameterSchema reusing DeploymentMemorySourceSchema ✓ (T1); executor binding (operator_mutation handler, NOT executorBySlug — resolved to the operator_mutation recipe) ✓ (T2/T3); governance reachable (gate short-circuit, NO policy needed) ✓ (T3 live-path, empty policies); entitlement (org-level automatic, not S8b) — documented; intent SEEDED/reachable not prod-inert (carve-out auto-resolves; producer-populated in app.ts) ✓ (T3); source:"operator" fold-in ✓ (T4).
- **Recipe resolution:** operator_mutation (`feedback_operator_mutation_owner_action_recipe`) -> NO anchored allow policy / NO deployment seed / NO route-allowlist / NO eval fixture / NO SKILL.md. The live-path test PROVES the short-circuit (empty `loadPolicies`) + carve-out are each load-bearing.
- **Producer-population:** app.ts constructs + passes `memoryWriteStore` (same PR as the gate); the live-path test drives the real `bootstrapOperatorIntents`. (app.ts construction = typecheck + review verified, mirrors 10 existing stores.)
- **Scope boundary:** NO core/db/prisma/migration change (store already accepts `source`). NO compounding-service or decay-cron change (S8c). NO writer reroute. `validFrom` omitted (FRAME pt 3, YAGNI + ship-clean).
- **No new decision:** internal write, no consent surface; principal = authenticated/seeded; system_auto_approved settled by design; entitlement org-level standard -> the hard-stop does NOT fire.
- **VERIFY must run:** `pnpm typecheck` (all pkgs); `pnpm test` AND `pnpm --filter @switchboard/api test`; `pnpm --filter @switchboard/schemas test`; `pnpm lint`; `pnpm format:check`; `pnpm arch:check`; `CI=1 npx tsx scripts/local-verify-fast.ts` (should be a no-op — no new route/env/flag; the intent flows through `submit`); `pnpm exec tsx .agent/tools/check-routes.ts --mode=error` (SEPARATE gate; expect 0 — no new store mutation in packages/db); `pnpm build` (app pkgs changed); `pnpm audit --audit-level=high`. NO migration -> no db:check-drift. NO engine change -> no workstream eval (operator_mutation is orthogonal to eval:governance's grid, per the recipe).
