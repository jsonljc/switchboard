# Alex Governance Enforce-Flip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator review the observe bake per gate, see per-gate enforce-readiness, and flip an Alex governance gate observe -> enforce per org, only when that gate's producer is populated, audited and reversible.

**Architecture:** Four PR-sized slices. (1) A read-only observe-review API that aggregates `GovernanceVerdict` rows into per-gate would-act counts. (2) A pure per-gate enforce-readiness evaluator + db producer probe + read endpoint. (3) A governed `governance.set_gate_mode` operator-mutation intent (through `PlatformIngress.submit()`) whose handler refuses an enforce flip when the gate is not ready, with a lost-update-safe config writer. (4) A dashboard `/settings/governance` page that combines review + readiness + a readiness-gated flip control.

**Tech Stack:** TypeScript (ESM), pnpm + Turborepo, Prisma, Fastify, Vitest, Zod, Next.js 14 (App Router), React Query.

## Global Constraints

- ESM only; `.js` extensions in all relative imports (except Next.js).
- No `any` (use `unknown` + narrowing); no `console.log` (use `console.warn`/`console.error`).
- Prettier: semi, double quotes, 2-space indent, trailing commas, 100-char width.
- Conventional Commits; commit subject lowercase; scope is the package (`feat(api): ...`).
- Every new module has a co-located `*.test.ts`.
- Pre-commit runs eslint + prettier only (NOT tsc). Run `pnpm --filter <pkg> exec tsc --noEmit` for each touched package before committing.
- No schema migration (the `governanceConfig` JSON column already exists; we write per-gate mode sub-blocks via the `.passthrough()` schema). No `db:check-drift`.
- Never hand-author governance config shapes in product code: reuse `buildObserveGovernanceConfig` and the helpers introduced here.
- Safety invariant: observe is the safe floor. An enforce flip MUST be refused server-side when the gate's producer is absent. Rollback (enforce -> observe/off) is NEVER readiness-gated.
- db tests use mocked Prisma (no Postgres in CI); mirror `prisma-governance-verdict-store.test.ts`. api tests are flat in `src/__tests__` or `src/routes/__tests__`.
- A new `SwitchboardMetrics` counter (if added) needs all THREE registries (core `createInMemoryMetrics` + api & chat `createPromMetrics`). This plan adds none.
- Each slice is its own worktree off `origin/main` under `.claude/worktrees/`, its own branch, its own PR. Read/Edit via the worktree absolute path.

---

## Shared vocabulary: the four flippable gate units

A "gate unit" is one flippable governance mode. There are exactly four, each a stable string key mapped to a `governanceConfig` sub-block:

| Unit key (`GovernanceGateUnit`) | Config sub-block    | Verdict `sourceGuard`(s)              |
| ------------------------------- | ------------------- | ------------------------------------- |
| `deterministic`                 | `deterministicGate` | `banned_phrase_scanner`, `price_gate` |
| `claims`                        | `claimClassifier`   | `claim_classifier`                    |
| `consent`                       | `consentState`      | `consent_gate`                        |
| `whatsapp`                      | `whatsappWindow`    | `whatsapp_window`                     |

`escalation_trigger` is not one of the four flippable units and is out of scope for these surfaces.

---

# Slice 1: Observe-review read surface (backend)

**PR:** `feat(schemas,core,db,api): per-gate observe-verdict review surface`
**Worktree:** `.claude/worktrees/gov-flip-s1-review`, branch `feat/gov-flip-s1-review`.

**What ships:** the gate-unit vocabulary, a pure `deriveEnforceAction` mapping, a bounded verdict aggregation store method, and a `GET /agents/:agentId/governance/observe-review` endpoint returning per-unit would-act counts + sample rows.

**Files:**

- Create: `packages/schemas/src/governance-gate-unit.ts`
- Create: `packages/schemas/src/governance-gate-unit.test.ts`
- Modify: `packages/schemas/src/index.ts` (export the new module)
- Create: `packages/core/src/governance/observe-review/derive-enforce-action.ts`
- Create: `packages/core/src/governance/observe-review/derive-enforce-action.test.ts`
- Create: `packages/core/src/governance/observe-review/summarize-observe-review.ts`
- Create: `packages/core/src/governance/observe-review/summarize-observe-review.test.ts`
- Modify: `packages/core/src/governance/governance-verdict-store/types.ts` (add `summarizeByDeployment`)
- Modify: `packages/core/src/index.ts` (export the observe-review module + new types)
- Modify: `packages/db/src/prisma-governance-verdict-store.ts` (impl `summarizeByDeployment`)
- Modify: `packages/db/src/__tests__/prisma-governance-verdict-store.test.ts`
- Create: `apps/api/src/routes/governance-observe-review.ts`
- Create: `apps/api/src/routes/__tests__/governance-observe-review.test.ts`
- Modify: wherever api routes are registered (the same place `readinessRoutes` is registered) to mount the new route.

**Interfaces (produced):**

- `GOVERNANCE_GATE_UNITS: readonly ["deterministic","claims","consent","whatsapp"]`
- `GovernanceGateUnitSchema: z.ZodEnum`, `type GovernanceGateUnit`
- `sourceGuardToGateUnit(sourceGuard: GovernanceVerdictSource): GovernanceGateUnit | null`
- `type EnforceAction = "block" | "rewrite" | "escalate" | "template" | "none"`
- `deriveEnforceAction(sourceGuard, reasonCode): EnforceAction`
- `summarizeByDeployment(deploymentId, opts: { since?: string }): Promise<VerdictSummaryRow[]>` where `VerdictSummaryRow = { sourceGuard: string; reasonCode: string; action: string; count: number }`
- `summarizeObserveReview(rows: VerdictSummaryRow[]): ObserveReviewByUnit` (pure roll-up to `Record<GovernanceGateUnit, { wouldBlock: number; wouldRewrite: number; wouldEscalate: number; wouldTemplate: number; total: number }>`)

### Task 1.1: gate-unit vocabulary

- [ ] **Step 1: Write the failing test** — `packages/schemas/src/governance-gate-unit.test.ts`

```ts
import { describe, it, expect } from "vitest";
import {
  GOVERNANCE_GATE_UNITS,
  GovernanceGateUnitSchema,
  sourceGuardToGateUnit,
  GATE_UNIT_CONFIG_KEY,
} from "./governance-gate-unit.js";

describe("governance gate units", () => {
  it("has exactly the four flippable units", () => {
    expect([...GOVERNANCE_GATE_UNITS]).toEqual(["deterministic", "claims", "consent", "whatsapp"]);
  });

  it("parses a valid unit and rejects an unknown one", () => {
    expect(GovernanceGateUnitSchema.parse("consent")).toBe("consent");
    expect(GovernanceGateUnitSchema.safeParse("recovery").success).toBe(false);
  });

  it("maps each unit to its config sub-block key", () => {
    expect(GATE_UNIT_CONFIG_KEY).toEqual({
      deterministic: "deterministicGate",
      claims: "claimClassifier",
      consent: "consentState",
      whatsapp: "whatsappWindow",
    });
  });

  it("maps the five flippable-gate sourceGuards to units; escalation_trigger -> null", () => {
    expect(sourceGuardToGateUnit("banned_phrase_scanner")).toBe("deterministic");
    expect(sourceGuardToGateUnit("price_gate")).toBe("deterministic");
    expect(sourceGuardToGateUnit("claim_classifier")).toBe("claims");
    expect(sourceGuardToGateUnit("consent_gate")).toBe("consent");
    expect(sourceGuardToGateUnit("whatsapp_window")).toBe("whatsapp");
    expect(sourceGuardToGateUnit("escalation_trigger")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @switchboard/schemas exec vitest run src/governance-gate-unit.test.ts` (FAIL: module missing).

- [ ] **Step 3: Implement** — `packages/schemas/src/governance-gate-unit.ts`

```ts
import { z } from "zod";
import type { GovernanceVerdictSource } from "./governance-verdict.js";

export const GOVERNANCE_GATE_UNITS = ["deterministic", "claims", "consent", "whatsapp"] as const;
export const GovernanceGateUnitSchema = z.enum(GOVERNANCE_GATE_UNITS);
export type GovernanceGateUnit = z.infer<typeof GovernanceGateUnitSchema>;

/** Each unit's `governanceConfig` sub-block key. */
export const GATE_UNIT_CONFIG_KEY: Record<
  GovernanceGateUnit,
  "deterministicGate" | "claimClassifier" | "consentState" | "whatsappWindow"
> = {
  deterministic: "deterministicGate",
  claims: "claimClassifier",
  consent: "consentState",
  whatsapp: "whatsappWindow",
};

const SOURCE_GUARD_TO_UNIT: Partial<Record<GovernanceVerdictSource, GovernanceGateUnit>> = {
  banned_phrase_scanner: "deterministic",
  price_gate: "deterministic",
  claim_classifier: "claims",
  consent_gate: "consent",
  whatsapp_window: "whatsapp",
};

/** Maps a verdict sourceGuard to its flippable unit, or null (e.g. escalation_trigger). */
export function sourceGuardToGateUnit(
  sourceGuard: GovernanceVerdictSource,
): GovernanceGateUnit | null {
  return SOURCE_GUARD_TO_UNIT[sourceGuard] ?? null;
}
```

- [ ] **Step 4: Export from the barrel** — add to `packages/schemas/src/index.ts`: `export * from "./governance-gate-unit.js";`

- [ ] **Step 5: Run + typecheck** — `pnpm --filter @switchboard/schemas exec vitest run src/governance-gate-unit.test.ts` (PASS) then `pnpm --filter @switchboard/schemas exec tsc --noEmit`.

- [ ] **Step 6: Commit** — `git commit -m "feat(schemas): governance gate-unit vocabulary"`

### Task 1.2: deriveEnforceAction mapping

- [ ] **Step 1: Write the failing test** — `packages/core/src/governance/observe-review/derive-enforce-action.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { deriveEnforceAction } from "./derive-enforce-action.js";

describe("deriveEnforceAction", () => {
  it("banned phrase + any banned reason -> block", () => {
    expect(deriveEnforceAction("banned_phrase_scanner", "banned_phrase")).toBe("block");
  });
  it("price gate + unsubstantiated price -> block", () => {
    expect(deriveEnforceAction("price_gate", "unsubstantiated_price")).toBe("block");
  });
  it("claim classifier rewrite vs escalate", () => {
    expect(deriveEnforceAction("claim_classifier", "unsupported_claim_rewritten")).toBe("rewrite");
    expect(deriveEnforceAction("claim_classifier", "unsupported_claim_escalated")).toBe("escalate");
    expect(deriveEnforceAction("claim_classifier", "unsupported_claim")).toBe("escalate");
    expect(deriveEnforceAction("claim_classifier", "claim_substantiation_stale")).toBe("escalate");
  });
  it("claim classifier timeout/error -> none (no enforce action in observe)", () => {
    expect(deriveEnforceAction("claim_classifier", "classifier_timeout")).toBe("none");
    expect(deriveEnforceAction("claim_classifier", "classifier_error")).toBe("none");
  });
  it("consent revoked -> block; disclosure/jurisdiction reasons -> none", () => {
    expect(deriveEnforceAction("consent_gate", "consent_revoked")).toBe("block");
    expect(deriveEnforceAction("consent_gate", "disclosure_not_shown")).toBe("none");
    expect(deriveEnforceAction("consent_gate", "disclosure_version_outdated")).toBe("none");
    expect(deriveEnforceAction("consent_gate", "jurisdiction_mismatch")).toBe("none");
  });
  it("whatsapp window: out-of-window -> block, template_required -> template", () => {
    expect(deriveEnforceAction("whatsapp_window", "outside_whatsapp_window")).toBe("block");
    expect(deriveEnforceAction("whatsapp_window", "template_required")).toBe("template");
  });
  it("governance_unavailable (fail-closed) -> block for deterministic/whatsapp, none for consent", () => {
    expect(deriveEnforceAction("price_gate", "governance_unavailable")).toBe("block");
    expect(deriveEnforceAction("consent_gate", "governance_unavailable")).toBe("none");
  });
});
```

- [ ] **Step 2: Run to verify it fails.** `pnpm --filter @switchboard/core exec vitest run src/governance/observe-review/derive-enforce-action.test.ts`

- [ ] **Step 3: Implement** — `packages/core/src/governance/observe-review/derive-enforce-action.ts`

```ts
import type { GovernanceVerdictReason, GovernanceVerdictSource } from "@switchboard/schemas";

export type EnforceAction = "block" | "rewrite" | "escalate" | "template" | "none";

/**
 * Derives the action enforce WOULD have taken, from (sourceGuard, reasonCode).
 * In observe the stored verdict.action is "allow", so this is the single source
 * of truth for "what enforce would have done", mirroring each hook's enforce path.
 */
export function deriveEnforceAction(
  sourceGuard: GovernanceVerdictSource,
  reasonCode: GovernanceVerdictReason,
): EnforceAction {
  switch (sourceGuard) {
    case "banned_phrase_scanner":
      return "block";
    case "price_gate":
      // unsubstantiated_price (steady-state) or governance_unavailable (fail-closed) both block.
      return "block";
    case "claim_classifier":
      if (reasonCode === "unsupported_claim_rewritten") return "rewrite";
      if (
        reasonCode === "unsupported_claim_escalated" ||
        reasonCode === "unsupported_claim" ||
        reasonCode === "claim_substantiation_stale"
      )
        return "escalate";
      // classifier_timeout / classifier_error / governance_unavailable: observe records, enforce does not act.
      return "none";
    case "consent_gate":
      // Enforce blocks ONLY a revoked-contact race; the disclosure path never blocks.
      return reasonCode === "consent_revoked" ? "block" : "none";
    case "whatsapp_window":
      if (reasonCode === "template_required") return "template";
      if (reasonCode === "outside_whatsapp_window" || reasonCode === "governance_unavailable")
        return "block";
      return "none";
    default:
      return "none";
  }
}
```

- [ ] **Step 4: Run to verify pass.** Same command. Then `pnpm --filter @switchboard/core exec tsc --noEmit`.

- [ ] **Step 5: Commit** — `git commit -m "feat(core): derive enforce action from observe verdict reason"`

### Task 1.3: summarizeObserveReview roll-up

- [ ] **Step 1: Write the failing test** — `packages/core/src/governance/observe-review/summarize-observe-review.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { summarizeObserveReview } from "./summarize-observe-review.js";

describe("summarizeObserveReview", () => {
  it("rolls verdict summary rows into per-unit would-act counts", () => {
    const out = summarizeObserveReview([
      { sourceGuard: "price_gate", reasonCode: "unsubstantiated_price", action: "allow", count: 5 },
      {
        sourceGuard: "banned_phrase_scanner",
        reasonCode: "banned_phrase",
        action: "allow",
        count: 2,
      },
      {
        sourceGuard: "claim_classifier",
        reasonCode: "unsupported_claim_rewritten",
        action: "allow",
        count: 3,
      },
      {
        sourceGuard: "claim_classifier",
        reasonCode: "unsupported_claim_escalated",
        action: "allow",
        count: 1,
      },
      {
        sourceGuard: "consent_gate",
        reasonCode: "disclosure_not_shown",
        action: "allow",
        count: 9,
      },
      {
        sourceGuard: "whatsapp_window",
        reasonCode: "template_required",
        action: "allow",
        count: 4,
      },
      {
        sourceGuard: "escalation_trigger",
        reasonCode: "medical_safety_trigger",
        action: "allow",
        count: 7,
      },
    ]);
    expect(out.deterministic).toEqual({
      wouldBlock: 7,
      wouldRewrite: 0,
      wouldEscalate: 0,
      wouldTemplate: 0,
      total: 7,
    });
    expect(out.claims).toEqual({
      wouldBlock: 0,
      wouldRewrite: 3,
      wouldEscalate: 1,
      wouldTemplate: 0,
      total: 4,
    });
    // consent disclosure_not_shown derives to "none": counted in total, zero would-act.
    expect(out.consent).toEqual({
      wouldBlock: 0,
      wouldRewrite: 0,
      wouldEscalate: 0,
      wouldTemplate: 0,
      total: 9,
    });
    expect(out.whatsapp).toEqual({
      wouldBlock: 0,
      wouldRewrite: 0,
      wouldEscalate: 0,
      wouldTemplate: 4,
      total: 4,
    });
    // escalation_trigger maps to no unit and is excluded entirely.
  });

  it("returns zeroed units for empty input", () => {
    const out = summarizeObserveReview([]);
    for (const unit of ["deterministic", "claims", "consent", "whatsapp"] as const) {
      expect(out[unit]).toEqual({
        wouldBlock: 0,
        wouldRewrite: 0,
        wouldEscalate: 0,
        wouldTemplate: 0,
        total: 0,
      });
    }
  });
});
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement** — `packages/core/src/governance/observe-review/summarize-observe-review.ts`

```ts
import {
  GOVERNANCE_GATE_UNITS,
  sourceGuardToGateUnit,
  type GovernanceGateUnit,
  type GovernanceVerdictReason,
  type GovernanceVerdictSource,
} from "@switchboard/schemas";
import { deriveEnforceAction } from "./derive-enforce-action.js";

export interface VerdictSummaryRow {
  sourceGuard: string;
  reasonCode: string;
  action: string;
  count: number;
}

export interface UnitReview {
  wouldBlock: number;
  wouldRewrite: number;
  wouldEscalate: number;
  wouldTemplate: number;
  total: number;
}

export type ObserveReviewByUnit = Record<GovernanceGateUnit, UnitReview>;

function emptyUnit(): UnitReview {
  return { wouldBlock: 0, wouldRewrite: 0, wouldEscalate: 0, wouldTemplate: 0, total: 0 };
}

export function summarizeObserveReview(rows: VerdictSummaryRow[]): ObserveReviewByUnit {
  const out = Object.fromEntries(
    GOVERNANCE_GATE_UNITS.map((u) => [u, emptyUnit()]),
  ) as ObserveReviewByUnit;

  for (const row of rows) {
    const unit = sourceGuardToGateUnit(row.sourceGuard as GovernanceVerdictSource);
    if (!unit) continue; // not a flippable unit (e.g. escalation_trigger)
    const review = out[unit];
    review.total += row.count;
    const action = deriveEnforceAction(
      row.sourceGuard as GovernanceVerdictSource,
      row.reasonCode as GovernanceVerdictReason,
    );
    if (action === "block") review.wouldBlock += row.count;
    else if (action === "rewrite") review.wouldRewrite += row.count;
    else if (action === "escalate") review.wouldEscalate += row.count;
    else if (action === "template") review.wouldTemplate += row.count;
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass.** Then export both modules from `packages/core/src/index.ts` (add `export * from "./governance/observe-review/derive-enforce-action.js";` and `.../summarize-observe-review.js";`). Typecheck core.

- [ ] **Step 5: Commit** — `git commit -m "feat(core): roll observe verdicts into per-unit would-act counts"`

### Task 1.4: `summarizeByDeployment` store method

- [ ] **Step 1: Add to the interface** — `packages/core/src/governance/governance-verdict-store/types.ts`, extend `GovernanceVerdictStore`:

```ts
  /**
   * Bounded aggregation for the observe-review surface: counts verdicts grouped
   * by (sourceGuard, reasonCode, action) for a deployment, optionally since a
   * timestamp. Accurate counts without an unbounded row fetch.
   */
  summarizeByDeployment(
    deploymentId: string,
    options?: { since?: string },
  ): Promise<Array<{ sourceGuard: string; reasonCode: string; action: string; count: number }>>;
```

- [ ] **Step 2: Write the failing db test** — extend `packages/db/src/__tests__/prisma-governance-verdict-store.test.ts` to assert `summarizeByDeployment` calls `prisma.governanceVerdict.groupBy` with the right `by`, `where` (deploymentId + optional `decidedAt: { gte }`), and `_count`, and maps the result to `{sourceGuard, reasonCode, action, count}`. Mirror the existing mocked-Prisma pattern in that file (mock `groupBy` to return `[{ sourceGuard, reasonCode, action, _count: { _all: 5 } }]`).

- [ ] **Step 3: Implement** in `packages/db/src/prisma-governance-verdict-store.ts`:

```ts
  async summarizeByDeployment(
    deploymentId: string,
    options?: { since?: string },
  ): Promise<Array<{ sourceGuard: string; reasonCode: string; action: string; count: number }>> {
    const grouped = await this.prisma.governanceVerdict.groupBy({
      by: ["sourceGuard", "reasonCode", "action"],
      where: {
        deploymentId,
        ...(options?.since ? { decidedAt: { gte: new Date(options.since) } } : {}),
      },
      _count: { _all: true },
    });
    return grouped.map((g) => ({
      sourceGuard: g.sourceGuard,
      reasonCode: g.reasonCode,
      action: g.action,
      count: g._count._all,
    }));
  }
```

(If `groupBy`'s generated types fight the `by` tuple, type the result via the mapped shape; do not use `any`.)

- [ ] **Step 4: Run db tests + typecheck** — `pnpm --filter @switchboard/db exec vitest run src/__tests__/prisma-governance-verdict-store.test.ts`; `pnpm --filter @switchboard/core exec tsc --noEmit`; `pnpm --filter @switchboard/db exec tsc --noEmit`.

- [ ] **Step 5: Commit** — `git commit -m "feat(core,db): summarizeByDeployment verdict aggregation"`

### Task 1.5: observe-review route

**Interfaces (consumed):** `summarizeByDeployment`, `summarizeObserveReview`, `deriveEnforceAction`, `GovernanceVerdictStore.listByDeployment`, the org-scope helper `requireOrganizationScope` (see `readiness.ts`), the deployment lookup by org (`prisma.agentDeployment.findFirst({ where: { organizationId, skillSlug: "alex" } })`).

- [ ] **Step 1: Write the failing route test** — `apps/api/src/routes/__tests__/governance-observe-review.test.ts`. Use the same Fastify-inject + mocked-prisma pattern as `readiness.test.ts`. Assert:
  - 200 with `{ window: { since }, units: { deterministic: {...counts}, ... }, samples: [...] }`.
  - The deployment is resolved by `organizationId` (org scope): a request whose org has no Alex deployment returns `404` (or `{ units: zeroed, samples: [] }` — pick 404 for "no deployment", documented in the test).
  - `samples` are capped at 20 and each carries `{ unit, reasonCode, enforceAction, decidedAt, conversationId, textPreview }` with `textPreview` truncated to <= 160 chars and NO full `originalText`.
  - `since` defaults to 7 days ago when the query param is absent; an explicit `?since=` is honoured.

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement** `apps/api/src/routes/governance-observe-review.ts`: a `FastifyPluginAsync` exposing `GET /:agentId/governance/observe-review`. Resolve org via `requireOrganizationScope`; resolve the Alex deployment by org; default `since` to `new Date(Date.now() - 7*24*3600*1000).toISOString()`; call `verdictStore.summarizeByDeployment(deploymentId, { since })` -> `summarizeObserveReview(...)`; call `verdictStore.listByDeployment(deploymentId, { since, limit: 20 })` and map to samples (compute `unit = sourceGuardToGateUnit`, `enforceAction = deriveEnforceAction`, `textPreview = (originalText ?? "").slice(0,160)`), dropping samples whose unit is null. The verdict store is read from the Fastify app decoration used elsewhere (find how `readiness`/governance routes obtain stores; if the verdict store is not yet decorated on the app, add it in the same bootstrap that builds `PrismaGovernanceVerdictStore`).

- [ ] **Step 4: Mount the route** next to `readinessRoutes` registration; run the route test + `pnpm --filter @switchboard/api exec tsc --noEmit`.

- [ ] **Step 5: Commit** — `git commit -m "feat(api): governance observe-review endpoint"`

### Task 1.6: Slice verification + PR

- [ ] `pnpm --filter @switchboard/schemas exec tsc --noEmit && pnpm --filter @switchboard/core exec tsc --noEmit && pnpm --filter @switchboard/db exec tsc --noEmit && pnpm --filter @switchboard/api exec tsc --noEmit`
- [ ] `pnpm --filter @switchboard/schemas test && pnpm --filter @switchboard/core test && pnpm --filter @switchboard/db test && pnpm --filter @switchboard/api test`
- [ ] Push, open PR, request code review (Slice-review checklist below), gate on `gh pr checks`, merge, tear down worktree.

---

# Slice 2: Enforce-readiness evaluator (backend, safety-critical core)

**PR:** `feat(core,db,api): per-gate enforce-readiness evaluator + endpoint`
**Worktree:** `.claude/worktrees/gov-flip-s2-readiness`, branch `feat/gov-flip-s2-readiness`.

**What ships:** a pure `evaluateGateEnforceReadiness`, a db producer probe assembling `GateProducerSignals`, and `GET /agents/:agentId/governance/enforce-readiness`.

**Files:**

- Create: `packages/core/src/governance/enforce-readiness/evaluate-gate-enforce-readiness.ts`
- Create: `packages/core/src/governance/enforce-readiness/evaluate-gate-enforce-readiness.test.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/db/src/governance-producer-probe.ts`
- Create: `packages/db/src/__tests__/governance-producer-probe.test.ts`
- Modify: `packages/db/src/index.ts`
- Create: `apps/api/src/routes/governance-enforce-readiness.ts`
- Create: `apps/api/src/routes/__tests__/governance-enforce-readiness.test.ts`
- Modify: route registration.

**Interfaces (produced):**

- `interface GateProducerSignals { approvedPriceCount: number; approvedClaimCount: number; approvedTemplateCount: number }`
- `interface GateEnforceReadiness { ready: boolean; blockingReason: string | null }`
- `evaluateGateEnforceReadiness(unit: GovernanceGateUnit, signals: GateProducerSignals): GateEnforceReadiness`
- `probeGovernanceProducers(deps): (orgId, deploymentId) => Promise<GateProducerSignals>`

### Task 2.0: Pin the producer accessors (grounding, no code)

- [ ] Read how the price gate, claim classifier, and whatsapp gate are wired in `apps/api` bootstrap to find the EXACT producer sources, and record them in the probe file's header comment:
  - approved prices: the same source as `PriceClaimGateHookDeps.getApprovedPrices` (playbook `services[].price`). Find its concrete impl.
  - approved claims: the `ApprovedComplianceClaim` store/Prisma model the claim classifier's substantiation resolver reads. Find the count accessor (or count rows by org).
  - approved templates: the source behind the whatsapp gate's `templateApprovalSource.resolve(deploymentId)`. Find how approved templates are counted.
  - If any producer's "count" is not directly available, add a minimal count query against the same underlying table the gate reads (org-scoped). Do NOT invent a different source — readiness MUST read what the gate reads.

### Task 2.1: pure evaluator

- [ ] **Step 1: Write the failing test** — table-driven over all four units x producer present/absent.

```ts
import { describe, it, expect } from "vitest";
import { evaluateGateEnforceReadiness } from "./evaluate-gate-enforce-readiness.js";

const present = { approvedPriceCount: 3, approvedClaimCount: 2, approvedTemplateCount: 1 };
const absent = { approvedPriceCount: 0, approvedClaimCount: 0, approvedTemplateCount: 0 };

describe("evaluateGateEnforceReadiness", () => {
  it("deterministic: ready iff >=1 approved price", () => {
    expect(evaluateGateEnforceReadiness("deterministic", present).ready).toBe(true);
    const r = evaluateGateEnforceReadiness("deterministic", absent);
    expect(r.ready).toBe(false);
    expect(r.blockingReason).toMatch(/approved price/i);
  });
  it("claims: ready iff >=1 approved compliance claim", () => {
    expect(evaluateGateEnforceReadiness("claims", present).ready).toBe(true);
    expect(evaluateGateEnforceReadiness("claims", absent).ready).toBe(false);
  });
  it("whatsapp: ready iff >=1 approved template", () => {
    expect(evaluateGateEnforceReadiness("whatsapp", present).ready).toBe(true);
    expect(evaluateGateEnforceReadiness("whatsapp", absent).ready).toBe(false);
  });
  it("consent: ALWAYS ready (fail-safe by construction, no producer gate)", () => {
    expect(evaluateGateEnforceReadiness("consent", absent).ready).toBe(true);
    expect(evaluateGateEnforceReadiness("consent", absent).blockingReason).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement**

```ts
import type { GovernanceGateUnit } from "@switchboard/schemas";

export interface GateProducerSignals {
  approvedPriceCount: number;
  approvedClaimCount: number;
  approvedTemplateCount: number;
}

export interface GateEnforceReadiness {
  ready: boolean;
  blockingReason: string | null;
}

const READY: GateEnforceReadiness = { ready: true, blockingReason: null };

/**
 * Decides whether a gate may be flipped to enforce, given its producer signals.
 * REFUSE-by-default when the producer that the gate reads is empty (fail-safe:
 * enforcing an empty-producer gate over-blocks legitimate replies). consent is
 * the principled exception: its enforce is fail-safe by construction (it blocks
 * only a revoked-contact race; the disclosure path never blocks), so no producer
 * gate applies.
 */
export function evaluateGateEnforceReadiness(
  unit: GovernanceGateUnit,
  signals: GateProducerSignals,
): GateEnforceReadiness {
  switch (unit) {
    case "deterministic":
      return signals.approvedPriceCount > 0
        ? READY
        : {
            ready: false,
            blockingReason:
              "Add at least one approved service price before enforcing — otherwise every priced reply is blocked.",
          };
    case "claims":
      return signals.approvedClaimCount > 0
        ? READY
        : {
            ready: false,
            blockingReason:
              "Add at least one approved compliance claim before enforcing — otherwise every efficacy claim is escalated.",
          };
    case "whatsapp":
      return signals.approvedTemplateCount > 0
        ? READY
        : {
            ready: false,
            blockingReason:
              "Approve at least one WhatsApp template before enforcing — otherwise out-of-window replies are blocked.",
          };
    case "consent":
      return READY;
  }
}
```

- [ ] **Step 4: Run to verify pass; export from core barrel; typecheck core.**

- [ ] **Step 5: Commit** — `git commit -m "feat(core): pure per-gate enforce-readiness evaluator"`

### Task 2.2: db producer probe

- [ ] **Step 1: Write the failing test** — `packages/db/src/__tests__/governance-producer-probe.test.ts`, mocked-Prisma. Inject the accessors found in Task 2.0; assert the probe returns the three counts for an org/deployment and that each count query is org-scoped (orgId in the WHERE).

- [ ] **Step 2-3: Implement** `packages/db/src/governance-producer-probe.ts`: `probeGovernanceProducers` takes the same producer sources the gates use (injected, not re-implemented) and returns `GateProducerSignals`. Org-scope every read.

- [ ] **Step 4: Run + typecheck db; export from db barrel.**

- [ ] **Step 5: Commit** — `git commit -m "feat(db): governance producer probe"`

### Task 2.3: enforce-readiness route

- [ ] **Step 1: Write the failing route test** — `GET /:agentId/governance/enforce-readiness` returns `{ units: { deterministic: { currentMode, ready, blockingReason, producer: { kind, count } }, ... } }`. Assert: org-scoped; `currentMode` read from the deployment's `governanceConfig` per unit (use `GATE_UNIT_CONFIG_KEY` + the resolvers; `consent` reads `resolveConsentStateConfig`, etc.); `ready` comes from `evaluateGateEnforceReadiness`; consent is always `ready: true`; deterministic is `ready: false` with a price-related `blockingReason` when `approvedPriceCount === 0`.

- [ ] **Step 2-3: Implement** the route: resolve org + Alex deployment; `probeGovernanceProducers(orgId, deploymentId)`; for each unit compute `currentMode` (read the sub-block mode via the schemas resolvers / a small `readGateMode(config, unit)` helper — add it to `governance-gate-unit.ts` if not present) and `evaluateGateEnforceReadiness(unit, signals)`; assemble the per-unit response with a `producer` summary `{ kind: "price"|"claim"|"template"|"none", count }`.

  Add to `packages/schemas/src/governance-gate-unit.ts` (and test) a pure `readGateMode(config: GovernanceConfig | null, unit: GovernanceGateUnit): GovernanceMode` that reads the right sub-block mode (deterministic via `resolveGovernanceMode`, claims via `resolveClaimClassifierConfig().mode`, consent via `resolveConsentStateConfig().mode`, whatsapp via the `whatsappWindow.mode` passthrough with a safe default of `"off"`).

- [ ] **Step 4: Run + typecheck api.**

- [ ] **Step 5: Commit** — `git commit -m "feat(api): governance enforce-readiness endpoint"`

### Task 2.4: Slice verification + PR

- [ ] Typecheck schemas, core, db, api; run their tests; push; PR; review; gate on `gh pr checks`; merge; tear down.

---

# Slice 3: Governed per-gate flip route (backend)

**PR:** `feat(schemas,core,db,api): governed readiness-guarded per-gate enforce flip`
**Worktree:** `.claude/worktrees/gov-flip-s3-flip`, branch `feat/gov-flip-s3-flip`.

**What ships:** the pure `setGateModeInConfig` writer-shape helper, a lost-update-safe store writer, the `governance.set_gate_mode` operator-mutation intent with a readiness-REFUSE handler, and the `POST /agents/:agentId/governance/gates/:unit/mode` route.

**Files:**

- Create: `packages/schemas/src/set-gate-mode-in-config.ts` (+ test)
- Modify: `packages/schemas/src/index.ts`
- Create: `packages/db/src/stores/prisma-governance-gate-mode-writer.ts` (+ test)
- Modify: `packages/db/src/index.ts`
- Create: `apps/api/src/bootstrap/operator-intents/governance-set-gate-mode.ts` (+ test)
- Modify: `apps/api/src/bootstrap/operator-intents/shared.ts` (intent string + error code)
- Modify: `apps/api/src/routes/operator-intents-schemas.ts` (param schema)
- Modify: `apps/api/src/bootstrap/operator-intents.ts` (register intent + handler)
- Modify: `apps/api/src/app.ts` (wire the writer + producer probe into the bootstrap deps)
- Create: `apps/api/src/routes/governance-set-gate-mode.ts` (+ test)
- Modify: route registration.

**Interfaces (produced):**

- `setGateModeInConfig(config: GovernanceConfig, unit: GovernanceGateUnit, mode: GovernanceMode): GovernanceConfig` — pure, preserves all sibling sub-blocks and sibling fields within the target sub-block.
- `GOVERNANCE_SET_GATE_MODE_INTENT = "governance.set_gate_mode"`
- param schema: `{ deploymentId: string; unit: GovernanceGateUnit; mode: GovernanceMode }`
- `PrismaGovernanceGateModeWriter.setGateMode({ organizationId, deploymentId, unit, mode }): Promise<{ id: string; governanceConfig: unknown }>` — lost-update-safe (locked read), org-scoped.

### Task 3.1: pure `setGateModeInConfig`

- [ ] **Step 1: Write the failing test** — assert it sets the target unit's mode while preserving every other sub-block AND the non-mode fields of the target sub-block (critical for `whatsappWindow.{enabled,allowMarketingTemplateSubstitution}` and `claimClassifier.{latencyBudgetMs,model,confidenceThreshold}`).

```ts
import { describe, it, expect } from "vitest";
import { buildObserveGovernanceConfig } from "./governance-config.js";
import { setGateModeInConfig } from "./set-gate-mode-in-config.js";

const base = buildObserveGovernanceConfig({ jurisdiction: "SG", clinicType: "medical" });

describe("setGateModeInConfig", () => {
  it("flips deterministic to enforce, preserving other units", () => {
    const next = setGateModeInConfig(base, "deterministic", "enforce");
    expect(next.deterministicGate.mode).toBe("enforce");
    expect(next.claimClassifier.mode).toBe("observe");
    expect(next.consentState.mode).toBe("observe");
    expect(next.whatsappWindow.mode).toBe("observe");
  });
  it("flips whatsapp mode while preserving enabled + allowMarketingTemplateSubstitution", () => {
    const next = setGateModeInConfig(base, "whatsapp", "enforce");
    expect(next.whatsappWindow).toEqual({
      enabled: true,
      mode: "enforce",
      allowMarketingTemplateSubstitution: false,
    });
  });
  it("flips claims mode while preserving classifier tuning fields if present", () => {
    const withTuning = {
      ...base,
      claimClassifier: {
        mode: "observe",
        latencyBudgetMs: 900,
        model: "m",
        confidenceThreshold: 0.8,
      },
    };
    const next = setGateModeInConfig(withTuning as never, "claims", "enforce");
    expect(next.claimClassifier).toEqual({
      mode: "enforce",
      latencyBudgetMs: 900,
      model: "m",
      confidenceThreshold: 0.8,
    });
  });
  it("is pure (does not mutate the input)", () => {
    const snapshot = JSON.stringify(base);
    setGateModeInConfig(base, "consent", "enforce");
    expect(JSON.stringify(base)).toBe(snapshot);
  });
});
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement** — `packages/schemas/src/set-gate-mode-in-config.ts`

```ts
import type { GovernanceConfig, GovernanceMode } from "./governance-config.js";
import { GATE_UNIT_CONFIG_KEY, type GovernanceGateUnit } from "./governance-gate-unit.js";

/**
 * Returns a new GovernanceConfig with `unit`'s mode set to `mode`, preserving
 * every other sub-block and every non-mode field within the target sub-block.
 * Pure. The single source of truth for the enforce-flip write shape (the store
 * writer merges this result into the JSON column).
 */
export function setGateModeInConfig(
  config: GovernanceConfig,
  unit: GovernanceGateUnit,
  mode: GovernanceMode,
): GovernanceConfig {
  const key = GATE_UNIT_CONFIG_KEY[unit];
  const existing = (config as unknown as Record<string, unknown>)[key];
  const existingObj =
    existing && typeof existing === "object" ? (existing as Record<string, unknown>) : {};
  return {
    ...(config as unknown as Record<string, unknown>),
    [key]: { ...existingObj, mode },
  } as unknown as GovernanceConfig;
}
```

- [ ] **Step 4: Run to verify pass; export from schemas barrel; typecheck schemas.**

- [ ] **Step 5: Commit** — `git commit -m "feat(schemas): pure sub-block-preserving gate-mode writer shape"`

### Task 3.2: lost-update-safe store writer

- [ ] **Step 1: Write the failing test** — `packages/db/src/stores/prisma-governance-gate-mode-writer.test.ts`, mocked Prisma. Assert:
  - reads the current config via a locked read (mock `$queryRaw` / the injected locked-load) and writes the merged config via `agentDeployment.update`;
  - the merge preserves sibling sub-blocks (drive with an observe config, flip `deterministic` -> enforce, assert the update payload has `claimClassifier.mode === "observe"`);
  - org scope: a row whose `organizationId` differs throws `DeploymentNotFoundError` and never writes;
  - the whole thing runs inside `prisma.$transaction`.

- [ ] **Step 2-3: Implement** — `packages/db/src/stores/prisma-governance-gate-mode-writer.ts`. Use an interactive transaction; lock the row with a raw `SELECT "governanceConfig" FROM "AgentDeployment" WHERE id = $1 AND "organizationId" = $2 FOR UPDATE`; parse with `GovernanceConfigSchema` (throw `GovernanceConfigInvalidError` on parse failure — do not write over a corrupt config blindly); `setGateModeInConfig`; `tx.agentDeployment.update({ where: { id }, data: { governanceConfig: next } })`. Throw `DeploymentNotFoundError` when the locked read returns no row. Org-scope the lock AND the update.

```ts
// sketch — the locked read is what makes concurrent per-gate flips lost-update-safe
async setGateMode(input: { organizationId: string; deploymentId: string; unit: GovernanceGateUnit; mode: GovernanceMode }) {
  return this.prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ governanceConfig: unknown }>>`
      SELECT "governanceConfig" FROM "AgentDeployment"
      WHERE "id" = ${input.deploymentId} AND "organizationId" = ${input.organizationId}
      FOR UPDATE`;
    if (rows.length === 0) throw new DeploymentNotFoundError(input.deploymentId);
    const parsed = GovernanceConfigSchema.safeParse(rows[0]!.governanceConfig);
    if (!parsed.success) throw new GovernanceConfigInvalidError(input.deploymentId);
    const next = setGateModeInConfig(parsed.data, input.unit, input.mode);
    const updated = await tx.agentDeployment.update({
      where: { id: input.deploymentId },
      data: { governanceConfig: next as object },
      select: { id: true, governanceConfig: true },
    });
    return updated;
  });
}
```

(For the mocked-Prisma test, inject `$transaction` to immediately invoke its callback with a `tx` whose `$queryRaw` + `agentDeployment.update` are vi.fn()s. Document that the real `FOR UPDATE` lock is exercised only against Postgres, not in CI — mirrors the db-tests-use-mocked-Prisma constraint.)

- [ ] **Step 4: Run db tests + typecheck.**

- [ ] **Step 5: Commit** — `git commit -m "feat(db): lost-update-safe per-gate governance config writer"`

### Task 3.3: the readiness-guarded operator-mutation handler (THE safety core)

**Interfaces (consumed):** `GOVERNANCE_SET_GATE_MODE_INTENT`, the param schema, `PrismaGovernanceGateModeWriter.setGateMode`, `probeGovernanceProducers`, `evaluateGateEnforceReadiness`, the `OperatorMutationHandler` shape (mirror `memory-write.ts`).

- [ ] **Step 1: Write the failing handler test** — `apps/api/src/bootstrap/operator-intents/governance-set-gate-mode.test.ts`. Assert, with injected fakes:
  - **REFUSE (safety invariant):** target `mode: "enforce"`, unit `deterministic`, probe returns `approvedPriceCount: 0` -> handler returns `{ outcome: "failed", error: { code: "GATE_NOT_ENFORCE_READY" } }` and the writer's `setGateMode` is NEVER called.
  - **ALLOW when ready:** same but `approvedPriceCount: 3` -> `setGateMode` called with `{ unit: "deterministic", mode: "enforce" }`, returns `{ outcome: "completed" }`.
  - **consent enforce always allowed:** unit `consent`, mode `enforce`, all producer counts 0 -> `setGateMode` called, `completed`.
  - **rollback never gated:** unit `deterministic`, mode `observe`, `approvedPriceCount: 0` -> `setGateMode` called (NO readiness check on a non-enforce target), `completed`.
  - **off never gated:** unit `claims`, mode `off`, counts 0 -> `setGateMode` called, `completed`.
  - org scope: the handler passes `workUnit.organizationId` into both the probe and the writer.
  - deployment-not-found from the writer -> `{ outcome: "failed", error: { code: "DEPLOYMENT_NOT_FOUND" } }` (caught, not rethrown).

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement** the handler factory:

```ts
export function buildGovernanceSetGateModeHandler(deps: {
  writer: {
    setGateMode(input: {
      organizationId: string;
      deploymentId: string;
      unit: GovernanceGateUnit;
      mode: GovernanceMode;
    }): Promise<{ id: string }>;
  };
  probeProducers: (orgId: string, deploymentId: string) => Promise<GateProducerSignals>;
}): OperatorMutationHandler {
  return {
    async execute(workUnit) {
      const params = GovernanceSetGateModeParametersSchema.parse(workUnit.parameters);
      // Readiness REFUSE applies ONLY to an enforce target. Rollback (observe/off) is unconditional.
      if (params.mode === "enforce") {
        const signals = await deps.probeProducers(workUnit.organizationId, params.deploymentId);
        const readiness = evaluateGateEnforceReadiness(params.unit, signals);
        if (!readiness.ready) {
          return {
            outcome: "failed" as const,
            summary: `Refused enforce flip for ${params.unit}: gate not ready`,
            error: {
              code: "GATE_NOT_ENFORCE_READY",
              message: readiness.blockingReason ?? "Gate not ready to enforce",
            },
          };
        }
      }
      try {
        await deps.writer.setGateMode({
          organizationId: workUnit.organizationId,
          deploymentId: params.deploymentId,
          unit: params.unit,
          mode: params.mode,
        });
      } catch (err) {
        if (err instanceof DeploymentNotFoundError) {
          return {
            outcome: "failed" as const,
            summary: "Deployment not found",
            error: { code: "DEPLOYMENT_NOT_FOUND", message: err.message },
          };
        }
        if (err instanceof GovernanceConfigInvalidError) {
          return {
            outcome: "failed" as const,
            summary: "Stored governance config invalid",
            error: { code: "GOVERNANCE_CONFIG_INVALID", message: err.message },
          };
        }
        throw err; // infra error -> 500 via ingress
      }
      return {
        outcome: "completed" as const,
        summary: `Set ${params.unit} gate to ${params.mode}`,
        outputs: { unit: params.unit, mode: params.mode, deploymentId: params.deploymentId },
      };
    },
  };
}
```

Add `GOVERNANCE_SET_GATE_MODE_INTENT` + error codes to `shared.ts`; add `GovernanceSetGateModeParametersSchema = z.object({ deploymentId: z.string().min(1), unit: GovernanceGateUnitSchema, mode: GovernanceModeSchema })` to `operator-intents-schemas.ts`.

- [ ] **Step 4: Run to verify pass; typecheck api.**

- [ ] **Step 5: Commit** — `git commit -m "feat(api): readiness-guarded governance.set_gate_mode handler"`

### Task 3.4: register the intent + wire bootstrap

- [ ] Register in `apps/api/src/bootstrap/operator-intents.ts` via the operator-intent helper, mirroring `memory.write`: `defaultMode/allowedModes/executor = operator_mutation`, `mutationClass: "write"`, `budgetClass: "cheap"`, `approvalPolicy: "none"`, `approvalMode: "system_auto_approved"`, `idempotent: true`, `allowedTriggers: ["api"]`, `retryable: false`. Wire `deploymentGovernanceGateModeWriter` + `probeGovernanceProducers` into the bootstrap deps in `app.ts`.
- [ ] **Test (bootstrap):** extend `apps/api/src/bootstrap/__tests__/operator-intents*.test.ts` to assert the intent registers with `approvalMode: "system_auto_approved"` and `operator_mutation` mode, and is NOT in `SERVICE_ONLY_INGRESS_INTENTS` (operator-initiated; an operator legitimately submits it).
- [ ] Typecheck api; commit — `git commit -m "feat(api): register governance.set_gate_mode operator intent"`

### Task 3.5: the flip route (full-response check)

- [ ] **Step 1: Write the failing route test** — `POST /:agentId/governance/gates/:unit/mode` with body `{ mode }`. Assert:
  - resolves org + Alex deployment; submits the intent through `app.platformIngress.submit`;
  - `completed` -> `200 { unit, mode }`;
  - `failed` with `GATE_NOT_ENFORCE_READY` -> `409` (or `422`) with `{ error: "gate_not_enforce_ready", reason }`;
  - `failed` with `DEPLOYMENT_NOT_FOUND` -> `404`;
  - the route reads the FULL `SubmitWorkResponse`: success requires `response.ok === true && response.result.outcome === "completed"` (a fake submit returning `{ ok: true, result: { outcome: "failed", ... } }` must NOT 200);
  - invalid `:unit` or `mode` -> `400`.

- [ ] **Step 2-3: Implement** the route: validate `unit` (`GovernanceGateUnitSchema`) + `mode` (`GovernanceModeSchema`); resolve org + deployment; `submit({ intent: GOVERNANCE_SET_GATE_MODE_INTENT, organizationId, actor: { id: <operator>, type: "user" }, parameters: { deploymentId, unit, mode }, trigger: "api", surface: { surface: "api" }, idempotencyKey })`. Map outcomes; never treat `ok` alone as success. (Reuse `requireOrganizationScope` + the same idempotency-key handling as the ingress route; pass the operator principal from auth.)

- [ ] **Step 4: Mount route; typecheck api; run route test.**

- [ ] **Step 5: Commit** — `git commit -m "feat(api): per-gate governance flip route"`

### Task 3.6: end-to-end behaviour proof + slice verification

- [ ] **Behavioural test (core)** in a new `packages/core/src/skill-runtime/hooks/__tests__/price-claim-gate-flip.test.ts` (or extend the existing price-gate test): drive `PriceClaimGateHook.afterSkill` with a resolver returning the config AFTER `setGateModeInConfig(observeConfig, "deterministic", "enforce")` and a NON-empty approved-price list; assert a non-approved priced reply is blocked (response replaced, status flip). Then with the OBSERVE config assert the same reply is unchanged. This proves the flip actually changes gate behaviour end-to-end and ties `setGateModeInConfig` to the live gate.
- [ ] Typecheck schemas/core/db/api; run their tests; push; PR; review (emphasise the REFUSE invariant + concurrency); gate on `gh pr checks`; merge; tear down.

---

# Slice 4: Dashboard governance surface (frontend)

**PR:** `feat(dashboard): compliance-gates governance surface (review + readiness + flip)`
**Worktree:** `.claude/worktrees/gov-flip-s4-dashboard`, branch `feat/gov-flip-s4-dashboard`.

**What ships:** `/settings/governance` page combining observe-review, enforce-readiness, and a readiness-gated flip control; Next proxy routes; React Query hooks.

**Files:**

- Create: `apps/dashboard/src/app/api/dashboard/governance/observe-review/route.ts`
- Create: `apps/dashboard/src/app/api/dashboard/governance/enforce-readiness/route.ts`
- Create: `apps/dashboard/src/app/api/dashboard/governance/gates/[unit]/mode/route.ts`
- Create: `apps/dashboard/src/hooks/use-governance-gates.ts` (+ test)
- Modify: `apps/dashboard/src/lib/query-keys.ts` (governance namespace additions)
- Modify: `apps/dashboard/src/lib/api-client/governance.ts` (client methods)
- Create: `apps/dashboard/src/app/(auth)/settings/governance/page.tsx`
- Create: `apps/dashboard/src/components/settings/governance-gates.tsx` (+ test)
- Modify: `apps/dashboard/src/components/layout/settings-layout.tsx` (nav entry "Compliance")

**Interfaces (consumed):** the three Slice 1-3 endpoints. Mirror `use-business-facts.ts` (query + mutation, `enabled: !!keys`, sentinel disabled key, `invalidateQueries` on success). Mirror the proxy-route pattern in `apps/dashboard/src/app/api/dashboard/governance/status/route.ts` (`requireSession` -> `getApiClient` -> client method -> `NextResponse.json`, `proxyError`).

### Task 4.1: proxy routes + query keys + client methods

- [ ] Add query-keys: `governance.observeReview(agentId)`, `governance.enforceReadiness(agentId)`, `governance.gateMode(agentId, unit)`.
- [ ] Add api-client methods `getObserveReview(agentId, since?)`, `getEnforceReadiness(agentId)`, `setGateMode(agentId, unit, mode)`.
- [ ] Add the three proxy routes (GET, GET, POST) following the existing pattern; the POST forwards `{ mode }` and the `unit` path param; org scope comes from `requireSession`.
- [ ] No standalone test for thin proxies beyond a smoke test if the repo has a pattern; otherwise covered by the hook test.
- [ ] Commit — `git commit -m "feat(dashboard): governance gates proxy routes + client"`

### Task 4.2: `use-governance-gates` hooks

- [ ] **Step 1: Write the failing test** (mirror an existing hook test) — `useGovernanceGates` exposes `observeReview`, `enforceReadiness` queries (gated on `!!keys`) and a `setGateMode` mutation that invalidates `enforceReadiness` + `observeReview` on success.
- [ ] **Step 2-3: Implement** the hooks. Loading UI gates as `!data && !error` (per the React-Query gotcha), not `isLoading`.
- [ ] **Step 4: Test + typecheck dashboard.**
- [ ] **Step 5: Commit** — `git commit -m "feat(dashboard): governance gates hooks"`

### Task 4.3: governance-gates component + page (readiness-gated flip)

- [ ] **Step 1: Write the failing component test** — `governance-gates.test.tsx`. Assert, per unit card:
  - shows current mode + the observe-review counts ("would have blocked N replies in the last 7 days");
  - the **enforce control is disabled when `ready === false`**, and the `blockingReason` is shown;
  - the enforce control is enabled when `ready === true`;
  - clicking enforce shows a confirmation that states the consequence (handoff on match + block-on-governance-outage), and only on confirm calls `setGateMode(unit, "enforce")`;
  - a "Return to observe" control is always enabled (rollback never gated) and calls `setGateMode(unit, "observe")`;
  - consent's enforce control is enabled even with zero producers (always ready).
- [ ] **Step 2-3: Implement** `governance-gates.tsx` (reuse `Card`, `Badge`, `Switch`/`Button`, `Dialog`) and the `/settings/governance` page (mirror `business-facts/page.tsx`: fetch hooks + query-state UI). Add the "Compliance" nav entry to `settings-layout.tsx` (distinct from the account-level "Governance mode").
- [ ] **Step 4: Test + typecheck dashboard; visual sanity (optional headless screenshot per the dashboard visual-verification reference).**
- [ ] **Step 5: Commit** — `git commit -m "feat(dashboard): compliance-gates settings page"`

### Task 4.4: Slice verification + PR

- [ ] `pnpm --filter @switchboard/dashboard exec tsc --noEmit`; dashboard tests; lint; push; PR; review; gate on `gh pr checks`; merge; tear down.

---

## Per-slice code-review checklist (use requesting-code-review)

For each slice, a fresh-context reviewer checks:

1. **Correctness/safety** — does the slice do what its spec section says? For Slice 2/3: is the REFUSE invariant actually enforced server-side and un-bypassable? Is rollback truly unconditional? Is the store write org-scoped and lost-update-safe?
2. **Runtime trace** — for Slice 3, does a flip actually change gate behaviour (the behavioural test), and does the route check the full `SubmitWorkResponse` (not `ok` alone)?
3. **No new gaps** — no inert producer (readiness reads the SAME source the gate reads); no missing registry; org scope on every read/write; no PII leak in samples.

## Self-Review (plan vs spec)

- Spec decision (a) per-gate granularity -> Slice 1 Task 1.1 (the four-unit vocabulary). ✓
- Spec decision (b) REFUSE-by-default + consent exception -> Slice 2 Task 2.1 (`evaluateGateEnforceReadiness`). ✓
- Spec decision (c) surfaces (review + readiness reads, governed flip route, dashboard) -> Slices 1, 2, 3 routes + Slice 4. ✓
- Spec decision (d) operator_mutation, system_auto_approved, server-side REFUSE, full-response check, rollback ungated -> Slice 3 Tasks 3.3/3.4/3.5. ✓
- Spec decision (e) per-gate would-act counts + samples over a window -> Slice 1 Tasks 1.2/1.3/1.5. ✓
- Safety: REFUSE proven (3.3), behaviour-change proven (3.6), concurrency-safe (3.2), rollback ungated (3.3). ✓
- Producer-reads-what-gate-reads risk -> Slice 2 Task 2.0 grounding step. ✓
- Placeholder scan: every code step has complete code or a precise interface + test assertions; the few "implement mirroring X" steps name the exact exemplar file. ✓
- Type consistency: `GovernanceGateUnit`, `GateProducerSignals`, `EnforceAction`, `setGateModeInConfig`, `GOVERNANCE_SET_GATE_MODE_INTENT` used identically across slices. ✓
