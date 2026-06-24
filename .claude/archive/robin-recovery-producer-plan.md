# Robin v1 - Recovery-Campaign PRODUCER Implementation Plan

> **For agentic workers:** Execute task-by-task (RED -> GREEN -> REFACTOR). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Wire a default-off-flag-gated Inngest cron that assembles the no-show recovery cohort
per org and SUBMITS the already-built `robin.recovery_campaign.send` intent so it PARKS for manager
approval - keeping the fail-closed placeholder executor (no patient is contacted by this slice).

**Architecture:** Mirror the `appointment-reminder-dispatch` cron pattern (pure `execute*` fn + injected
deps + `create*Cron` wrapper). The cron resolves a per-deployment `governanceConfig.recovery.mode` flag
(new, mirrors `consentState.mode`), reduces to one mode per org, and for `enforce` orgs assembles the
real cohort (`findNoShowRecoveryCandidates` + a new batched rebooked-exclusion read +
`selectRecoveryCandidates`) and submits ONE campaign via `PlatformIngress.submit()` with the seeded
`{id:"system",type:"system"}` principal and an ISO-week+org idempotency key, branching on
`"approvalRequired" in response` before treating it as success. `observe` counts only; `off` no-ops.

**Tech Stack:** TypeScript ESM, Zod, Prisma, Inngest, Vitest, pnpm + Turborepo.

## Global Constraints (copied from spec + CLAUDE.md, apply to EVERY task)

- Layers: schemas (L1) -> core (L3, no db) -> db (L4) -> apps (L5). No cycles.
- Mutations enter ONLY through `PlatformIngress.submit`; WorkTrace canonical; no bypass.
- Cron actor MUST be the seeded `{id:"system",type:"system"}` principal (bespoke `system:<x>` hard-denies).
- The campaign intent PARKS (workflow mode, NOT `system_auto_approved`); the seeded
  `require_approval(mandatory)` policy is the gate. Keep the FAIL-CLOSED placeholder executor untouched.
- Submit-response handling MUST branch on `"approvalRequired" in response` before destructuring success.
- Idempotency-key the submit (ISO-week + org) so overlapping cron runs do not duplicate parked campaigns.
- Flag-gated control ships with its producer population in the SAME PR, tested from real defaults
  (default off -> cron no-ops).
- NO migration (idempotency-keyed submit, no new model). If a migration is needed, scope crept into the
  send slice - STOP.
- Every read/write leg org-scoped (F12). NaN-safe. Co-located `*.test.ts`. ESM `.js` extensions on
  relative imports. No `any`. No `console.log`. No em-dashes anywhere (incl. comments) - grep the diff
  before each commit. Prettier: semi, double quotes, 2-space, trailing commas, 100-char width.
- Lowercase Conventional-Commit subjects; body <=100 chars/line; trailer
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## How to use this plan (read before any task)

- SNIPPETS ARE THE INTENDED SHAPE, NOT A BLIND PASTE. Before editing each file, open the CURRENT file
  and verify the real types, imports, helper names, line numbers, and test-harness patterns. Adapt the
  snippet to the live code. Line numbers ("~line 639") are hints; the repo is the source of truth.
- IF A SNIPPET CONFLICTS WITH CURRENT CODE, STOP and preserve the INVARIANT (the safety property),
  never force the snippet. The snippets encode intent; if reality differs, satisfy the intent the way
  the live code is shaped.
- DO NOT WEAKEN A SAFETY PROOF TO MAKE A TEST PASS. The following assertions are load-bearing and must
  hold exactly; if a test is red, fix the code or the harness wiring, never relax the assertion:
  1. a seeded campaign PARKS at mandatory approval (never auto-approves);
  2. WITHOUT the carve-out, the SAME submit returns `deployment_not_found`;
  3. two same-ISO-week submits persist EXACTLY ONE parked campaign (no duplicate);
  4. `observe` mode never submits; `off` (the real default) does no scan and no submit;
  5. self-rebooked contacts are excluded from the cohort.
- Before EVERY commit, scan the staged diff for non-ASCII punctuation and fix any hit (the source +
  comments must stay ASCII). Run this check (Python, handles UTF-8, flags any byte > 0x7F in the diff):
  `git diff --cached | python3 -c "import sys; bad=[b for b in sys.stdin.buffer.read() if b > 0x7F]; print('NON-ASCII BYTES:', len(bad) or 'clean')"`
  A non-zero count means a non-ASCII glyph (em-dash, en-dash, arrow, ellipsis, curly quote, etc.) leaked
  into the diff; locate and replace it with the ASCII equivalent before committing.

## File Structure

**Create (3 new files):**

- `apps/api/src/services/cron/robin-recovery-dispatch.ts` - pure `executeRobinRecoveryDispatch` + deps
  interface + `createRobinRecoveryDispatchCron`.
- `apps/api/src/services/cron/__tests__/robin-recovery-dispatch.test.ts` - cron unit tests (fakes).
- `apps/api/src/__tests__/robin-recovery-cron-live-path.test.ts` - integration: parks via real
  PlatformIngress + prod-mirroring carve-out resolver + the deployment_not_found load-bearing proof +
  idempotency dedup.

**Modify:**

- `packages/schemas/src/governance-config.ts` - `RecoveryConfigSchema` + `resolveRecoveryConfig`.
- `packages/schemas/src/governance-config.test.ts` - recovery resolver tests.
- `packages/db/src/stores/prisma-booking-store.ts` - `findFutureBookingContactIds`.
- `packages/db/src/stores/__tests__/prisma-booking-store.test.ts` - its test.
- `apps/api/src/services/workflows/robin-recovery-request.ts` - ISO-week idempotency key + `asOf` input
  field + local `isoWeekStartUtc` helper.
- `apps/api/src/services/workflows/__tests__/robin-recovery-request.test.ts` - key + asOf assertions.
- `apps/api/src/__tests__/robin-recovery-gate.test.ts` - pass `asOf` to the builder call.
- `apps/api/src/bootstrap/contained-workflows.ts` - `submitRecoveryCampaign` closure + return + type.
- `apps/api/src/app.ts` - capture + thread `submitRecoveryCampaign` into `registerInngest`.
- `apps/api/src/bootstrap/inngest.ts` - option type + cron deps + register the cron in the functions array.

---

## Task 1: `recovery.mode` flag (schemas L1)

**Files:**

- Modify: `packages/schemas/src/governance-config.ts`
- Test: `packages/schemas/src/governance-config.test.ts`

**Interfaces:**

- Produces: `RecoveryConfigSchema` (Zod, `{ mode: GovernanceMode }`, default `{mode:"off"}`);
  `type RecoveryConfig`; `resolveRecoveryConfig(config: GovernanceConfig | null): RecoveryConfig`
  (fail-CLOSED: corrupt/missing -> `{mode:"off"}`).

- [ ] **Step 1: Write failing tests** in `packages/schemas/src/governance-config.test.ts` (append; mirror
      the existing `resolveConsentStateConfig` cases):

```ts
import { RecoveryConfigSchema, resolveRecoveryConfig } from "./governance-config.js";
// (add to the existing import if the file already imports from "./governance-config.js")

describe("resolveRecoveryConfig", () => {
  it("defaults to off when config is null", () => {
    expect(resolveRecoveryConfig(null)).toEqual({ mode: "off" });
  });
  it("defaults to off when the recovery sub-block is absent", () => {
    expect(resolveRecoveryConfig({ jurisdiction: "SG", clinicType: "medical" } as never)).toEqual({
      mode: "off",
    });
  });
  it("reads an explicit enforce mode", () => {
    expect(resolveRecoveryConfig({ recovery: { mode: "enforce" } } as never)).toEqual({
      mode: "enforce",
    });
  });
  it("reads an explicit observe mode", () => {
    expect(resolveRecoveryConfig({ recovery: { mode: "observe" } } as never)).toEqual({
      mode: "observe",
    });
  });
  it("fails CLOSED to off on a corrupt recovery sub-block (no throw)", () => {
    expect(resolveRecoveryConfig({ recovery: { mode: "bogus" } } as never)).toEqual({
      mode: "off",
    });
  });
  it("RecoveryConfigSchema applies the off default", () => {
    expect(RecoveryConfigSchema.parse({})).toEqual({ mode: "off" });
  });
});
```

- [ ] **Step 2: Run, verify it fails.** `pnpm --filter @switchboard/schemas test -- governance-config`
      Expected: FAIL (`RecoveryConfigSchema`/`resolveRecoveryConfig` not exported).

- [ ] **Step 3: Implement** in `packages/schemas/src/governance-config.ts` (after `resolveConsentStateConfig`,
      ~line 103). Mirror `ConsentStateConfig` exactly, including the fail-safe coercion + telemetry.

  L1 PURITY NOTE: the `console.error` below is allowed ONLY because the EXISTING
  `resolveConsentStateConfig` already logs from this layer (verify it still does: a `console.error`
  call inside `governance-config.ts`, the corrupt-consentState branch). This keeps the recovery
  resolver consistent with the established pattern. If that precedent is gone, keep schemas pure
  (return `{mode:"off"}` silently) and route the corrupt-config telemetry from the cron/app caller
  instead. Do not be the first to log from L1.

  Implement:

```ts
/**
 * Per-deployment configuration for Robin's no-show recovery campaign cron (v1).
 * Lives under `governanceConfig.recovery` as a passthrough sub-block - no Prisma
 * migration (the parent schema's `.passthrough()` already accepts arbitrary sub-blocks).
 *
 * Defaults: mode="off" (the cron is fully inert: no candidate scan, no campaigns, no sends).
 * Promote to "observe" to count recovery candidates in the cron (telemetry only, no submit),
 * then "enforce" to submit campaigns that PARK for manager approval before any send.
 */
export const RecoveryConfigSchema = z
  .object({
    mode: GovernanceModeSchema.default("off"),
  })
  .default({});

export type RecoveryConfig = z.infer<typeof RecoveryConfigSchema>;

export function resolveRecoveryConfig(config: GovernanceConfig | null): RecoveryConfig {
  const raw = (config as unknown as Record<string, unknown> | null)?.recovery;
  // Fail-CLOSED: a corrupt stored sub-block (bad mode enum, non-object) must NOT throw and crash the
  // cron. Coerce to the documented "off" default (no campaigns, no sends - the safe direction for a
  // mass-outbound capability). Log ONLY the Zod issue path+code (no raw value; the sub-block carries
  // no PII), so a corrupt config is not silently inert.
  const parsed = RecoveryConfigSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    console.error(
      "[governance-config] corrupt recovery sub-block; failing closed to mode=off (no recovery campaigns for this org)",
      { issues: parsed.error.issues.map((i) => ({ path: i.path, code: i.code })) },
    );
    return { mode: "off" };
  }
  return parsed.data;
}
```

- [ ] **Step 4: Run, verify pass.** `pnpm --filter @switchboard/schemas test -- governance-config` -> PASS.
      Then ensure the symbols are exported from the package barrel if `governance-config.ts` symbols are
      re-exported individually (check `packages/schemas/src/index.ts` - if it uses `export * from
"./governance-config.js"` no change is needed; otherwise add `RecoveryConfigSchema`,
      `resolveRecoveryConfig`, `RecoveryConfig`). Run `pnpm --filter @switchboard/schemas build` to confirm.

- [ ] **Step 5: Commit.**

```bash
git add packages/schemas/src/governance-config.ts packages/schemas/src/governance-config.test.ts packages/schemas/src/index.ts
git commit -m "feat(schemas): add governanceConfig.recovery.mode flag for robin recovery (default off)"
```

---

## Task 2: ISO-week idempotency key on the campaign builder (apps/api)

**Files:**

- Modify: `apps/api/src/services/workflows/robin-recovery-request.ts`
- Test: `apps/api/src/services/workflows/__tests__/robin-recovery-request.test.ts`
- Modify (call-site fix): `apps/api/src/__tests__/robin-recovery-gate.test.ts`

**Interfaces:**

- Consumes: existing `RecoveryCandidateInput`, `RobinRecoveryCampaignParamsSchema`.
- Produces: `RecoveryCampaignSubmitInput` gains a required `asOf: Date` field; the idempotency key is
  now `mutate:robin:${orgId}:${isoWeekStartUtc(asOf)}:recovery`. `isoWeekStartUtc(date)` returns the
  UTC Monday (ISO-week start) of `date` as `YYYY-MM-DD`.

- [ ] **Step 1: Update the builder test** `__tests__/robin-recovery-request.test.ts`. Add `asOf` to both
      existing calls and replace the key assertion; add a week-cadence test:

```ts
// in the "builds a system-principal..." test, change the call to include asOf and the key assertion:
const req = buildRecoveryCampaignSubmitRequest({
  organizationId: "org_1",
  windowFrom: new Date("2026-06-01T00:00:00Z"),
  windowTo: new Date("2026-06-08T00:00:00Z"),
  asOf: new Date("2026-06-03T09:00:00Z"), // Wed; ISO-week starts Mon 2026-06-01
  candidates: [candidate],
});
// ...
expect(req!.idempotencyKey).toBe("mutate:robin:org_1:2026-06-01:recovery");

// also add asOf to the empty-cohort test call (value irrelevant, type required):
// asOf: new Date("2026-06-03T09:00:00Z"),

// NEW test:
it("buckets the idempotency key by ISO-week+org (same week => same key; next week => new key)", () => {
  const base = {
    organizationId: "org_1",
    windowFrom: new Date("2026-06-01T00:00:00Z"),
    windowTo: new Date("2026-06-30T00:00:00Z"),
    candidates: [candidate],
  };
  const mon = buildRecoveryCampaignSubmitRequest({
    ...base,
    asOf: new Date("2026-06-15T00:00:00Z"),
  });
  const sun = buildRecoveryCampaignSubmitRequest({
    ...base,
    asOf: new Date("2026-06-21T23:59:00Z"),
  });
  const nextMon = buildRecoveryCampaignSubmitRequest({
    ...base,
    asOf: new Date("2026-06-22T00:00:00Z"),
  });
  expect(mon!.idempotencyKey).toBe("mutate:robin:org_1:2026-06-15:recovery");
  expect(sun!.idempotencyKey).toBe(mon!.idempotencyKey); // Mon..Sun same bucket
  expect(nextMon!.idempotencyKey).toBe("mutate:robin:org_1:2026-06-22:recovery"); // next week differs
});
```

- [ ] **Step 2: Run, verify it fails.**
      `pnpm --filter @switchboard/api test -- robin-recovery-request`
      Expected: FAIL (TS error: `asOf` not on `RecoveryCampaignSubmitInput`; key mismatch).

- [ ] **Step 3: Implement** in `robin-recovery-request.ts`. Add the `asOf` field + helper + new key:

```ts
// add to RecoveryCampaignSubmitInput:
asOf: Date; // the cron run time; the idempotency cadence anchor (ISO-week), decoupled from the scan window

// add this helper above buildRecoveryCampaignSubmitRequest:
/**
 * The UTC ISO-week start (Monday) of `date` as YYYY-MM-DD. Used as the idempotency cadence bucket:
 * two cron runs in the same Mon..Sun week yield the same key, so re-runs dedup to one parked campaign
 * per org per ISO week. Monday-anchored UTC date avoids ISO week-number/year-boundary edge cases.
 */
function isoWeekStartUtc(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const mondayOffset = (d.getUTCDay() + 6) % 7; // days since Monday (getUTCDay: 0=Sun..6=Sat)
  d.setUTCDate(d.getUTCDate() - mondayOffset);
  return d.toISOString().slice(0, 10);
}

// in buildRecoveryCampaignSubmitRequest, REPLACE the windowDay line + idempotencyKey:
//   const windowDay = input.windowFrom.toISOString().slice(0, 10);
//   idempotencyKey: `mutate:robin:${input.organizationId}:${windowDay}:recovery`,
// WITH:
const weekKey = isoWeekStartUtc(input.asOf);
//   idempotencyKey: `mutate:robin:${input.organizationId}:${weekKey}:recovery`,
```

Also update the builder's doc comment: replace "a deterministic per-org-per-window idempotency key"
with "a deterministic per-org-per-ISO-week idempotency key (so re-runs within a week dedup to one
parked campaign)".

- [ ] **Step 4: Fix the gate-test call site** `apps/api/src/__tests__/robin-recovery-gate.test.ts`
      (`recoveryParameters()`, ~line 89): add `asOf: new Date("2026-06-03T09:00:00Z"),` to the
      `buildRecoveryCampaignSubmitRequest({...})` call (params are unaffected; this only satisfies the type).

- [ ] **Step 5: Run, verify pass.**
      `pnpm --filter @switchboard/api test -- robin-recovery-request robin-recovery-gate` -> PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/api/src/services/workflows/robin-recovery-request.ts \
  apps/api/src/services/workflows/__tests__/robin-recovery-request.test.ts \
  apps/api/src/__tests__/robin-recovery-gate.test.ts
git commit -m "feat(api): key the robin recovery campaign idempotency by ISO-week and org"
```

---

## Task 3: Integration live-path test - parks via real ingress + carve-out + idempotency (apps/api)

**Files:**

- Create: `apps/api/src/__tests__/robin-recovery-cron-live-path.test.ts`

**Interfaces:**

- Consumes: `buildRecoveryCampaignSubmitRequest`, `ROBIN_RECOVERY_SEND_INTENT` (apps/api);
  `resolveAuthoritativeDeployment` (apps/api bootstrap); `buildRobinRecoveryAllowPolicyInput`,
  `buildRobinRecoveryApprovalPolicyInput` (@switchboard/db); `selectRecoveryCandidates`,
  `GovernanceGate`, `PlatformIngress`, `IntentRegistry`, `ExecutionModeRegistry`, `WorkflowMode`
  (@switchboard/core[/platform]).
- Produces: nothing (proof only).

This is the slice's central safety proof: the cron's submit MECHANISM (real builder -> real ingress ->
real gate) PARKS, the prod-mirroring carve-out resolver prevents `deployment_not_found`, and the
ISO-week key dedups overlapping runs to one parked campaign.

- [ ] **Step 1: Write the test file.** Mirror `recommendation-handoff-cron-live-path.test.ts` for the
      gate/ingress harness, but use the REAL `resolveAuthoritativeDeployment` carve-out resolver, the robin
      placeholder handler, and a faithful idempotency-aware in-memory trace store:

```ts
/**
 * LIVE-PATH proof for the Robin recovery PRODUCER. Drives the real submit MECHANISM the cron fires:
 * buildRecoveryCampaignSubmitRequest -> REAL PlatformIngress.submit -> REAL GovernanceGate with the
 * seeded allow + require_approval(mandatory) policies + the seeded {id:"system"} principal, resolved
 * through the REAL prod carve-out resolver (resolveAuthoritativeDeployment + isPlatformDirectIntent).
 *
 * Proves: (1) a campaign PARKS at mandatory and never auto-approves; (2) the carve-out is LOAD-BEARING:
 * with it the throwing resolver (prod has no "robin" deployment) yields a park, without it the SAME
 * submit returns deployment_not_found (the feedback_workflow_intent_deployment_not_found lesson, which
 * the api harness's null resolver would otherwise mask); (3) two submits with the same ISO-week key
 * dedup to ONE parked campaign (overlapping cron runs never duplicate). No Postgres (CI has none).
 */
import { describe, it, expect } from "vitest";
import {
  GovernanceGate,
  PlatformIngress,
  IntentRegistry,
  ExecutionModeRegistry,
  WorkflowMode,
  type GovernanceGateDeps,
  type IntentRegistration,
  type WorkflowHandler,
  type WorkTrace,
  type WorkTraceStore,
  type WorkTraceReadResult,
} from "@switchboard/core/platform";
import { evaluate, resolveIdentity, selectRecoveryCandidates } from "@switchboard/core";
import type { IdentitySpec, Policy } from "@switchboard/schemas";
import {
  buildRobinRecoveryAllowPolicyInput,
  buildRobinRecoveryApprovalPolicyInput,
} from "@switchboard/db";
import { resolveAuthoritativeDeployment } from "../bootstrap/platform-deployment-resolver.js";
import {
  buildRecoveryCampaignSubmitRequest,
  ROBIN_RECOVERY_SEND_INTENT,
} from "../services/workflows/robin-recovery-request.js";

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
function allowPolicy(): Policy {
  return {
    ...buildRobinRecoveryAllowPolicyInput(ORG),
    cartridgeId: null,
    effect: "allow",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  } as Policy;
}
function approvalPolicy(): Policy {
  return {
    ...buildRobinRecoveryApprovalPolicyInput(ORG),
    cartridgeId: null,
    effect: "require_approval",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  } as Policy;
}
function buildGate(policies: Policy[]): GovernanceGate {
  const deps: GovernanceGateDeps = {
    evaluate,
    resolveIdentity,
    loadPolicies: async () => policies,
    loadIdentitySpec: async () => ({ spec: systemSpec(), overlays: [] }),
    loadCartridge: async () => null,
    getGovernanceProfile: async () => null,
  };
  return new GovernanceGate(deps);
}
// Faithful idempotency-aware in-memory trace store: getByIdempotencyKey finds a persisted park
// (work-trace-recorder persists idempotencyKey + ingressPath="platform_ingress" on a park), so the
// ingress replay marks the second submit approvalRequired instead of creating a duplicate.
function inMemoryTraceStore(): { store: WorkTraceStore; traces: WorkTrace[] } {
  const traces: WorkTrace[] = [];
  const store = {
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
    getByIdempotencyKey: async (org: string, key: string): Promise<WorkTraceReadResult | null> => {
      const trace = traces.find((t) => t.organizationId === org && t.idempotencyKey === key);
      return trace ? { trace, integrity: { status: "ok" } } : null;
    },
  } as unknown as WorkTraceStore;
  return { store, traces };
}
function robinRegistration(): IntentRegistration {
  return {
    intent: ROBIN_RECOVERY_SEND_INTENT,
    defaultMode: "workflow",
    allowedModes: ["workflow"],
    executor: { mode: "workflow", workflowId: ROBIN_RECOVERY_SEND_INTENT },
    parameterSchema: {},
    mutationClass: "write",
    budgetClass: "cheap",
    approvalPolicy: "always",
    idempotent: false,
    allowedTriggers: ["schedule"],
    timeoutMs: 300_000,
    retryable: true,
  };
}
// Throwing resolver = prod (no seeded "robin" deployment). carveOut toggles the load-bearing predicate.
function throwingResolver() {
  return {
    resolveByOrgAndSlug: async () => {
      throw new Error("No active deployment found for org slug=robin");
    },
    resolveByDeploymentId: async () => {
      throw new Error("n/a");
    },
    resolveByChannelToken: async () => {
      throw new Error("n/a");
    },
  } as never;
}
function buildIngress(policies: Policy[], carveOut: boolean) {
  const intentRegistry = new IntentRegistry();
  intentRegistry.register(robinRegistration());
  const placeholder: WorkflowHandler = {
    async execute() {
      return {
        outcome: "failed",
        summary: "placeholder",
        outputs: {},
        error: { code: "ROBIN_RECOVERY_SEND_NOT_WIRED", message: "deferred" },
      };
    },
  };
  const modeRegistry = new ExecutionModeRegistry();
  modeRegistry.register(
    new WorkflowMode({
      handlers: new Map<string, WorkflowHandler>([[ROBIN_RECOVERY_SEND_INTENT, placeholder]]),
      services: {
        submitChildWork: async () => {
          throw new Error("no child work");
        },
      },
    }),
  );
  const { store, traces } = inMemoryTraceStore();
  const ingress = new PlatformIngress({
    intentRegistry,
    modeRegistry,
    governanceGate: buildGate(policies),
    deploymentResolver: resolveAuthoritativeDeployment(throwingResolver(), {
      isPlatformDirectIntent: (i) => (carveOut ? i === ROBIN_RECOVERY_SEND_INTENT : false),
    }),
    traceStore: store,
  });
  return { ingress, traces };
}
function campaignReq(asOf: Date) {
  const cohort = selectRecoveryCandidates(
    [
      {
        bookingId: "bk_1",
        contactId: "ct_1",
        service: "Botox",
        startsAt: new Date("2026-06-03T09:00:00Z"),
        attendeeName: "Jamie",
      },
    ],
    { existingFutureBookingContactIds: new Set() },
  );
  return buildRecoveryCampaignSubmitRequest({
    organizationId: ORG,
    windowFrom: new Date("2026-06-01T00:00:00Z"),
    windowTo: new Date("2026-06-15T00:00:00Z"),
    asOf,
    candidates: cohort,
  })!;
}

describe("robin recovery producer (live path through real ingress + carve-out resolver)", () => {
  it("PARKS at mandatory via the carve-out resolver (no deployment_not_found)", async () => {
    const { ingress } = buildIngress([allowPolicy(), approvalPolicy()], true);
    const res = await ingress.submit(campaignReq(new Date("2026-06-08T08:00:00Z")));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect("approvalRequired" in res && res.approvalRequired).toBe(true);
    expect(res.result.outcome).toBe("pending_approval");
    expect(res.workUnit?.actor).toEqual({ id: "system", type: "system" });
  });

  it("WITHOUT the carve-out, the SAME submit returns deployment_not_found (carve-out is load-bearing)", async () => {
    const { ingress } = buildIngress([allowPolicy(), approvalPolicy()], false);
    const res = await ingress.submit(campaignReq(new Date("2026-06-08T08:00:00Z")));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.type).toBe("deployment_not_found");
  });

  it("idempotent: two submits in the same ISO-week dedup to ONE parked campaign", async () => {
    const { ingress, traces } = buildIngress([allowPolicy(), approvalPolicy()], true);
    const first = await ingress.submit(campaignReq(new Date("2026-06-08T08:00:00Z"))); // Mon
    const second = await ingress.submit(campaignReq(new Date("2026-06-10T08:00:00Z"))); // Wed, same week
    expect(first.ok && "approvalRequired" in first && first.approvalRequired).toBe(true);
    expect(second.ok && "approvalRequired" in second && second.approvalRequired).toBe(true);
    // Same parked work unit returned; only ONE pending_approval campaign persisted (no duplicate).
    const parked = traces.filter(
      (t) => t.intent === ROBIN_RECOVERY_SEND_INTENT && t.outcome === "pending_approval",
    );
    expect(parked).toHaveLength(1);
  });

  it("un-seeded org default-DENIES (fail safe, no phantom park)", async () => {
    const { ingress } = buildIngress([], true); // no policies
    const res = await ingress.submit(campaignReq(new Date("2026-06-08T08:00:00Z")));
    const parked = res.ok && "approvalRequired" in res && res.approvalRequired === true;
    expect(parked).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify the suite is meaningful.**
      `pnpm --filter @switchboard/api test -- robin-recovery-cron-live-path`
      Expected: all PASS. If the idempotency test fails because the in-memory `persist` does not capture
      the keyed park trace, inspect a persisted trace (`console.error(traces)`) to confirm
      `idempotencyKey` + `ingressPath`; the recorder sets both on a park
      (`work-trace-recorder.ts:155,170`). If the trace shape differs, adjust the `getByIdempotencyKey`
      predicate to match the persisted fields - do NOT weaken the assertion.

- [ ] **Step 3: Commit.**

```bash
git add apps/api/src/__tests__/robin-recovery-cron-live-path.test.ts
git commit -m "test(api): prove robin recovery submit parks via the carve-out resolver and dedups by week"
```

---

## Task 4: Batched rebooked-exclusion read (db L4)

**Files:**

- Modify: `packages/db/src/stores/prisma-booking-store.ts`
- Test: `packages/db/src/stores/__tests__/prisma-booking-store.test.ts`

**Interfaces:**

- Produces: `PrismaBookingStore.findFutureBookingContactIds(orgId: string, contactIds: string[], now: Date)
: Promise<Set<string>>` - the subset of `contactIds` that hold an ACTIVE upcoming booking
  (`status notIn [cancelled, failed]`, `startsAt >= now`), org-scoped. Feeds
  `selectRecoveryCandidates({ existingFutureBookingContactIds })`.

- [ ] **Step 1: Write failing tests** (mirror the mocked-Prisma style already in the file):

```ts
describe("findFutureBookingContactIds", () => {
  it("returns an empty set without querying when contactIds is empty", async () => {
    const findMany = vi.fn();
    const store = new PrismaBookingStore({ booking: { findMany } } as never);
    const out = await store.findFutureBookingContactIds(
      "org_1",
      [],
      new Date("2026-06-10T00:00:00Z"),
    );
    expect(out.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
  it("maps active upcoming bookings to a contactId set, org-scoped", async () => {
    const findMany = vi.fn().mockResolvedValue([{ contactId: "c1" }, { contactId: "c3" }]);
    const store = new PrismaBookingStore({ booking: { findMany } } as never);
    const now = new Date("2026-06-10T00:00:00Z");
    const out = await store.findFutureBookingContactIds("org_1", ["c1", "c2", "c3"], now);
    expect(out).toEqual(new Set(["c1", "c3"]));
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org_1",
          contactId: { in: ["c1", "c2", "c3"] },
          status: { notIn: ["cancelled", "failed"] },
          startsAt: { gte: now },
        }),
        distinct: ["contactId"],
      }),
    );
  });
});
```

- [ ] **Step 2: Run, verify it fails.**
      `pnpm --filter @switchboard/db test -- prisma-booking-store`
      Expected: FAIL (`findFutureBookingContactIds` not a function).

- [ ] **Step 3: Implement** in `prisma-booking-store.ts` (after `findNoShowRecoveryCandidates`, ~line 345):

```ts
  // Org-scoped batched read: which of `contactIds` hold an ACTIVE upcoming booking as of `now`?
  // Robin's recovery cron uses this to exclude patients who already self-rebooked (no recovery
  // needed). Mirrors findUpcomingByContact's active-upcoming predicate. Org-scoped per F12 / IDOR.
  async findFutureBookingContactIds(
    orgId: string,
    contactIds: string[],
    now: Date,
  ): Promise<Set<string>> {
    if (contactIds.length === 0) return new Set();
    const rows = await this.prisma.booking.findMany({
      where: {
        organizationId: orgId,
        contactId: { in: contactIds },
        status: { notIn: ["cancelled", "failed"] },
        startsAt: { gte: now },
      },
      select: { contactId: true },
      distinct: ["contactId"],
    });
    return new Set(rows.map((r) => r.contactId));
  }
```

- [ ] **Step 4: Run, verify pass.**
      `pnpm --filter @switchboard/db test -- prisma-booking-store` -> PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/db/src/stores/prisma-booking-store.ts packages/db/src/stores/__tests__/prisma-booking-store.test.ts
git commit -m "feat(db): add org-scoped findFutureBookingContactIds for robin rebooked-exclusion"
```

---

## Task 5: The recovery-dispatch cron - pure fn + deps + unit tests (apps/api)

**Files:**

- Create: `apps/api/src/services/cron/robin-recovery-dispatch.ts`
- Test: `apps/api/src/services/cron/__tests__/robin-recovery-dispatch.test.ts`

**Interfaces:**

- Consumes: `resolveRecoveryConfig`, `GovernanceMode` (@switchboard/schemas); `selectRecoveryCandidates`,
  `RecoveryCandidateInput`, `makeOnFailureHandler`, `AsyncFailureContext` (@switchboard/core);
  `SubmitWorkResponse` (@switchboard/core/platform); `RecoveryCampaignSubmitInput`
  (../workflows/robin-recovery-request.js).
- Produces: `RobinRecoveryDispatchDeps`, `RecoveryDeploymentRow`, `RobinRecoveryDispatchResult`,
  `executeRobinRecoveryDispatch(step, deps)`, `createRobinRecoveryDispatchCron(deps)`.

- [ ] **Step 1: Write the cron unit tests** (mirror `appointment-reminder-dispatch.test.ts`):

```ts
import { describe, expect, it, vi } from "vitest";
import { executeRobinRecoveryDispatch } from "../robin-recovery-dispatch.js";

const step = { run: async <T>(_n: string, fn: () => T | Promise<T>) => fn() };
const NOW = new Date("2026-06-10T08:00:00.000Z");
const row = (o = {}) => ({
  bookingId: "bk_1",
  contactId: "ct_1",
  service: "Botox",
  startsAt: new Date("2026-06-02T09:00:00.000Z"),
  attendeeName: "Mei",
  ...o,
});

function deps(over: Record<string, unknown> = {}) {
  return {
    failure: {} as never,
    listRecoveryDeployments: vi
      .fn()
      .mockResolvedValue([
        { organizationId: "org_1", governanceConfig: { recovery: { mode: "enforce" } } },
      ]),
    findNoShowCandidates: vi.fn().mockResolvedValue([row()]),
    findFutureBookingContactIds: vi.fn().mockResolvedValue(new Set<string>()),
    submitRecoveryCampaign: vi.fn().mockResolvedValue({
      ok: true,
      approvalRequired: true,
      result: { outcome: "pending_approval" },
      workUnit: {},
    }),
    now: () => NOW,
    ...over,
  };
}

describe("robin recovery dispatch", () => {
  it("default off (real default): no scan, no submit", async () => {
    const d = deps({
      listRecoveryDeployments: vi.fn().mockResolvedValue([
        { organizationId: "org_1", governanceConfig: null }, // unconfigured => resolveRecoveryConfig => off
        { organizationId: "org_2", governanceConfig: { recovery: { mode: "off" } } },
      ]),
    });
    const out = await executeRobinRecoveryDispatch(step, d as never);
    expect(d.findNoShowCandidates).not.toHaveBeenCalled();
    expect(d.submitRecoveryCampaign).not.toHaveBeenCalled();
    expect(out).toMatchObject({ orgsEnforced: 0, orgsObserved: 0, campaignsParked: 0 });
  });

  it("observe: assembles the cohort and counts candidates, but never submits", async () => {
    const d = deps({
      listRecoveryDeployments: vi
        .fn()
        .mockResolvedValue([
          { organizationId: "org_1", governanceConfig: { recovery: { mode: "observe" } } },
        ]),
    });
    const out = await executeRobinRecoveryDispatch(step, d as never);
    expect(d.findNoShowCandidates).toHaveBeenCalledWith(
      "org_1",
      new Date("2026-05-27T08:00:00.000Z"),
      NOW,
    ); // [now-14d, now]
    expect(d.submitRecoveryCampaign).not.toHaveBeenCalled();
    expect(out).toMatchObject({ orgsObserved: 1, candidatesObserved: 1, campaignsParked: 0 });
  });

  it("enforce: submits ONE campaign with asOf=now and records it parked", async () => {
    const d = deps();
    const out = await executeRobinRecoveryDispatch(step, d as never);
    expect(d.submitRecoveryCampaign).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        asOf: NOW,
        candidates: [expect.objectContaining({ bookingId: "bk_1" })],
      }),
    );
    expect(out).toMatchObject({ orgsEnforced: 1, campaignsParked: 1, failed: 0 });
  });

  it("enforce: excludes self-rebooked contacts from the cohort (rebooked-exclusion)", async () => {
    const d = deps({
      findNoShowCandidates: vi
        .fn()
        .mockResolvedValue([row(), row({ contactId: "ct_2", bookingId: "bk_2" })]),
      findFutureBookingContactIds: vi.fn().mockResolvedValue(new Set(["ct_2"])),
    });
    await executeRobinRecoveryDispatch(step, d as never);
    const submitted = (d.submitRecoveryCampaign as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(submitted.candidates.map((c: { contactId: string }) => c.contactId)).toEqual(["ct_1"]);
  });

  it("enforce + empty cohort: never submits (an empty campaign must not park)", async () => {
    const d = deps({ findNoShowCandidates: vi.fn().mockResolvedValue([]) });
    const out = await executeRobinRecoveryDispatch(step, d as never);
    expect(d.submitRecoveryCampaign).not.toHaveBeenCalled();
    expect(out).toMatchObject({ orgsEnforced: 1, campaignsParked: 0 });
  });

  it("enforce: idempotency_in_flight is a safe skip, not a failure", async () => {
    const d = deps({
      submitRecoveryCampaign: vi.fn().mockResolvedValue({
        ok: false,
        error: { type: "idempotency_in_flight" },
      }),
    });
    const out = await executeRobinRecoveryDispatch(step, d as never);
    expect(out).toMatchObject({ skipped: 1, failed: 0, campaignsParked: 0 });
  });

  it("enforce: a non-park failure (e.g. governance deny) is recorded failed, nothing sent", async () => {
    const d = deps({
      submitRecoveryCampaign: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { type: "governance_denied" } }),
    });
    const out = await executeRobinRecoveryDispatch(step, d as never);
    expect(out).toMatchObject({ failed: 1, campaignsParked: 0 });
  });

  it("reduces multiple deployments of one org to a single enforce action (enforce > observe)", async () => {
    const d = deps({
      listRecoveryDeployments: vi.fn().mockResolvedValue([
        { organizationId: "org_1", governanceConfig: { recovery: { mode: "observe" } } },
        { organizationId: "org_1", governanceConfig: { recovery: { mode: "enforce" } } },
      ]),
    });
    const out = await executeRobinRecoveryDispatch(step, d as never);
    expect(d.findNoShowCandidates).toHaveBeenCalledTimes(1); // one org, one scan
    expect(d.submitRecoveryCampaign).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ deploymentsScanned: 2, orgsEnforced: 1 });
  });
});
```

- [ ] **Step 2: Run, verify it fails.**
      `pnpm --filter @switchboard/api test -- robin-recovery-dispatch`
      Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `apps/api/src/services/cron/robin-recovery-dispatch.ts`:

```ts
import { Inngest } from "inngest";
import {
  makeOnFailureHandler,
  selectRecoveryCandidates,
  type AsyncFailureContext,
  type RecoveryCandidateInput,
} from "@switchboard/core";
import type { SubmitWorkResponse } from "@switchboard/core/platform";
import { resolveRecoveryConfig, type GovernanceMode } from "@switchboard/schemas";
import type { RecoveryCampaignSubmitInput } from "../workflows/robin-recovery-request.js";

const inngestClient = new Inngest({ id: "switchboard" });

// Recent no-shows worth re-engaging. The scan window is decoupled from the idempotency cadence
// (which is ISO-week, anchored to the run time inside buildRecoveryCampaignSubmitRequest).
const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

export interface RecoveryDeploymentRow {
  organizationId: string;
  governanceConfig: unknown; // resolved via resolveRecoveryConfig (passthrough sub-block)
}

export interface RobinRecoveryDispatchDeps {
  failure: AsyncFailureContext;
  listRecoveryDeployments: () => Promise<RecoveryDeploymentRow[]>;
  findNoShowCandidates: (orgId: string, from: Date, to: Date) => Promise<RecoveryCandidateInput[]>;
  findFutureBookingContactIds: (
    orgId: string,
    contactIds: string[],
    now: Date,
  ) => Promise<Set<string>>;
  submitRecoveryCampaign: (
    input: RecoveryCampaignSubmitInput,
  ) => Promise<SubmitWorkResponse | null>;
  now?: () => Date;
}

export interface StepTools {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
}

export interface RobinRecoveryDispatchResult {
  deploymentsScanned: number;
  orgsEnforced: number;
  orgsObserved: number;
  candidatesObserved: number;
  campaignsParked: number;
  skipped: number;
  failed: number;
}

// Reduce per-deployment modes to one per org: enforce > observe > off. Any enforce-enabled deployment
// enables the org; the org-scoped ISO-week idempotency key dedups multi-deployment orgs at submit too.
const RANK: Record<GovernanceMode, number> = { off: 0, observe: 1, enforce: 2 };

export async function executeRobinRecoveryDispatch(
  step: StepTools,
  deps: RobinRecoveryDispatchDeps,
): Promise<RobinRecoveryDispatchResult> {
  const now = (deps.now ?? (() => new Date()))();
  const deployments = await step.run("list-recovery-deployments", () =>
    deps.listRecoveryDeployments(),
  );

  const orgMode = new Map<string, GovernanceMode>();
  for (const d of deployments) {
    const mode = resolveRecoveryConfig(d.governanceConfig as never).mode;
    if (mode === "off") continue;
    const prev = orgMode.get(d.organizationId);
    if (!prev || RANK[mode] > RANK[prev]) orgMode.set(d.organizationId, mode);
  }

  const result: RobinRecoveryDispatchResult = {
    deploymentsScanned: deployments.length,
    orgsEnforced: 0,
    orgsObserved: 0,
    candidatesObserved: 0,
    campaignsParked: 0,
    skipped: 0,
    failed: 0,
  };

  const windowFrom = new Date(now.getTime() - LOOKBACK_MS);
  const windowTo = now;

  for (const [organizationId, mode] of orgMode) {
    await step.run(`recovery-${organizationId}`, async () => {
      const rows = await deps.findNoShowCandidates(organizationId, windowFrom, windowTo);
      const futureSet = rows.length
        ? await deps.findFutureBookingContactIds(
            organizationId,
            rows.map((r) => r.contactId),
            now,
          )
        : new Set<string>();
      const cohort = selectRecoveryCandidates(rows, { existingFutureBookingContactIds: futureSet });

      if (mode === "observe") {
        result.orgsObserved++;
        result.candidatesObserved += cohort.length;
        return; // telemetry only; never submit
      }

      result.orgsEnforced++;
      if (cohort.length === 0) return; // an empty campaign must never park

      const res = await deps.submitRecoveryCampaign({
        organizationId,
        windowFrom,
        windowTo,
        asOf: now,
        candidates: cohort,
      });
      if (res === null) return; // empty-cohort guard (defense in depth)
      if ("approvalRequired" in res && res.approvalRequired) {
        result.campaignsParked++; // PARKED for manager approval (the intended outcome)
        return;
      }
      if (!res.ok) {
        // A concurrent cron run already claimed this ISO-week key. Safe: not a duplicate, not a failure.
        if (res.error.type === "idempotency_in_flight") {
          result.skipped++;
          return;
        }
        result.failed++; // governance deny / upstream error: fail-safe, nothing sent
        return;
      }
      // res.ok and NOT parked: a correctly-seeded org always parks (require_approval). A non-park
      // execute is anomalous (the placeholder executor returns failed anyway). Record as failed.
      result.failed++;
    });
  }

  return result;
}

export function createRobinRecoveryDispatchCron(deps: RobinRecoveryDispatchDeps) {
  return inngestClient.createFunction(
    {
      id: "robin-recovery-dispatch",
      name: "Robin No-Show Recovery Dispatch",
      retries: 2,
      // Daily; the ISO-week idempotency key dedups to one parked campaign per org per ISO-week, so a
      // daily cadence gives weekly campaigns with per-day retry resilience (a failed day retries into
      // the same week-key without duplicating).
      triggers: [{ cron: "0 8 * * *" }],
      onFailure: makeOnFailureHandler(
        {
          functionId: "robin-recovery-dispatch",
          eventDomain: "robin-recovery",
          riskCategory: "high",
          alert: true,
        },
        deps.failure,
      ) as (arg: unknown) => Promise<void>,
    },
    async ({ step }) => executeRobinRecoveryDispatch(step as unknown as StepTools, deps),
  );
}
```

- [ ] **Step 4: Run, verify pass.**
      `pnpm --filter @switchboard/api test -- robin-recovery-dispatch` -> PASS.
      (If `selectRecoveryCandidates` / `RecoveryCandidateInput` are not exported from `@switchboard/core`,
      confirm via `git grep "selectRecoveryCandidates" packages/core/src/index.ts` - they are re-exported
      there per the gate test's import; no change expected.)

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/services/cron/robin-recovery-dispatch.ts apps/api/src/services/cron/__tests__/robin-recovery-dispatch.test.ts
git commit -m "feat(api): add the flag-gated robin recovery dispatch cron (off/observe/enforce)"
```

- [ ] **Step 6: Typecheck the api package BEFORE wiring Task 6.** This file crosses package boundaries
      (`@switchboard/core`, `@switchboard/schemas`, `@switchboard/core/platform`) and uses the
      `SubmitWorkResponse` union; the cron unit tests use `as never` fakes, so vitest can green while `tsc`
      reds (the vitest-vs-tsc trap). Catch any cross-package type drift now, not after the wiring.

```bash
pnpm --filter @switchboard/api typecheck
```

Expected: clean. If it reports stale lower-layer exports (e.g. `resolveRecoveryConfig` missing from
`@switchboard/schemas`), run `pnpm reset` then re-run. Fix any real type errors before Task 6.

---

## Task 6: Wire the submit closure + register the cron (apps/api)

**Files:**

- Modify: `apps/api/src/bootstrap/contained-workflows.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/bootstrap/inngest.ts`

**Interfaces:**

- Consumes: `buildRecoveryCampaignSubmitRequest`, `RecoveryCampaignSubmitInput` (workflows),
  `createRobinRecoveryDispatchCron`, `RobinRecoveryDispatchDeps` (cron), `PrismaBookingStore`
  (already imported in inngest.ts).
- Produces: `submitRecoveryCampaign` on the `bootstrapContainedWorkflows` return; an optional
  `submitRecoveryCampaign` on the inngest bootstrap options; the registered cron function.

This task has no new unit test - it is integration wiring covered by `pnpm typecheck` + `pnpm build`
(apps/api) and proven end-to-end by Task 3's live-path test (the submit MECHANISM) + Task 5 (the cron
logic). Mirror the `submitScheduledReminder` wiring exactly.

- [ ] **Step 1: contained-workflows.ts - add the closure.**
  - Add imports near the other workflow-request imports:

```ts
import {
  buildRecoveryCampaignSubmitRequest,
  type RecoveryCampaignSubmitInput,
} from "../services/workflows/robin-recovery-request.js";
```

- Add to the return-type interface (next to `submitScheduledReminder`, ~line 76):

```ts
submitRecoveryCampaign: (input: RecoveryCampaignSubmitInput) => Promise<SubmitWorkResponse | null>;
```

- Construct the closure (next to `submitScheduledReminder`, ~line 639). Robin has NO deployment; the
  builder omits `targetHint` and the app.ts carve-out resolves slug "robin" to platform-direct, so
  there is no `resolveDeploymentForIntent` call here:

```ts
// Robin v1 no-show recovery campaign initiator (the recovery cron's submit MECHANISM). The builder
// omits targetHint (Robin has no deployment); the app.ts isPlatformDirectIntent carve-out resolves
// slug "robin" to platform-direct, so this never throws deployment_not_found. null => empty cohort
// (the builder refuses to park an empty campaign).
const submitRecoveryCampaign = async (
  input: RecoveryCampaignSubmitInput,
): Promise<SubmitWorkResponse | null> => {
  const req = buildRecoveryCampaignSubmitRequest(input);
  if (!req) return null;
  return platformIngress.submit(req);
};
```

- Add `submitRecoveryCampaign` to the returned object (~line 720).

- [ ] **Step 2: app.ts - capture + thread it.**
  - Declare the holder near `submitScheduledReminder` (~line 814):

```ts
let submitRecoveryCampaign:
  | ((
      input: import("./services/workflows/robin-recovery-request.js").RecoveryCampaignSubmitInput,
    ) => Promise<import("@switchboard/core/platform").SubmitWorkResponse | null>)
  | undefined;
```

- Capture from the bootstrap result (~line 870): `submitRecoveryCampaign = result.submitRecoveryCampaign;`
- Pass into `registerInngest(app, { ... })` options (~line 1191): add `submitRecoveryCampaign,`.

- [ ] **Step 3: inngest.ts - option type, deps, and registration.**
  - Add imports (near the appointment-reminder import, ~line 135):

```ts
import {
  createRobinRecoveryDispatchCron,
  type RobinRecoveryDispatchDeps,
} from "../services/cron/robin-recovery-dispatch.js";
import type { RecoveryCampaignSubmitInput } from "../services/workflows/robin-recovery-request.js";
```

- Add the option to the bootstrap options interface (next to `submitScheduledReminder`, ~line 201):

```ts
  /**
   * Top-level submit closure for the Robin no-show recovery dispatch cron. Built in
   * bootstrapContainedWorkflows and threaded here so the campaign submits through the same
   * PlatformIngress front door. Returns null on an empty cohort. No parentWorkUnitId (trace root).
   */
  submitRecoveryCampaign?: (
    input: RecoveryCampaignSubmitInput,
  ) => Promise<SubmitWorkResponse | null>;
```

- Build the deps (right after `appointmentReminderDispatchDeps`, ~line 973; reuses the existing
  `bookingStore` + `asyncFailure`). Bound the enumeration and log if truncated (no silent cap):

```ts
const RECOVERY_DEPLOYMENT_SCAN_LIMIT = 500;
const robinRecoveryDispatchDeps: RobinRecoveryDispatchDeps = {
  failure: asyncFailure,
  listRecoveryDeployments: async () => {
    const rows = await app.prisma!.agentDeployment.findMany({
      where: { status: "active" },
      select: { organizationId: true, governanceConfig: true },
      take: RECOVERY_DEPLOYMENT_SCAN_LIMIT,
    });
    if (rows.length === RECOVERY_DEPLOYMENT_SCAN_LIMIT) {
      console.warn(
        `[robin-recovery] deployment scan hit the ${RECOVERY_DEPLOYMENT_SCAN_LIMIT} cap; some orgs may be skipped this run`,
      );
    }
    return rows.map((r) => ({
      organizationId: r.organizationId,
      governanceConfig: r.governanceConfig,
    }));
  },
  findNoShowCandidates: (orgId, from, to) =>
    bookingStore.findNoShowRecoveryCandidates({ orgId, from, to }),
  findFutureBookingContactIds: (orgId, contactIds, now) =>
    bookingStore.findFutureBookingContactIds(orgId, contactIds, now),
  submitRecoveryCampaign: (input) => {
    if (!options.submitRecoveryCampaign) {
      throw new Error("submitRecoveryCampaign not wired");
    }
    return options.submitRecoveryCampaign(input);
  },
};
```

- Register the cron in the `functions: [ ... ]` array (next to
  `createAppointmentReminderDispatchCron(...)`, ~line 1414):

```ts
      createRobinRecoveryDispatchCron(robinRecoveryDispatchDeps),
```

- [ ] **Step 4: Typecheck + build the touched apps.**

```bash
pnpm --filter @switchboard/api typecheck && pnpm --filter @switchboard/api build
```

Expected: clean. (Fixes any `SubmitWorkResponse` import already present in inngest.ts - it is.)

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/bootstrap/contained-workflows.ts apps/api/src/app.ts apps/api/src/bootstrap/inngest.ts
git commit -m "feat(api): wire the robin recovery dispatch cron through platform ingress"
```

---

## Task 7: Full verification, env/route/governance gates, and review

**Files:** none (verification only). Per the user's mandate, run the COMPLETE gate suite before any
"green" claim.

- [ ] **Step 1: New-cron debt gate (env-allowlist / route).** A new cron may need an allowlist entry:

```bash
CI=1 npx tsx scripts/local-verify-fast.ts
```

If it flags an env-allowlist or cron-allowlist entry, add it (e.g.
`scripts/env-allowlist.local-readiness.json` or the cron registry the script names) and re-run until
clean. Document any allowlist edit in the commit.

- [ ] **Step 2: Governance eval (always - this slice touches the governance/ingress/flag path).**

```bash
pnpm eval:governance
```

Expected: PASS (no regression; the campaign intent's gate behavior is unchanged).

- [ ] **Step 3: Full gates.**

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm arch:check && \
pnpm --filter @switchboard/schemas test && pnpm --filter @switchboard/db test && \
pnpm --filter @switchboard/api test && pnpm --filter @switchboard/chat test && \
pnpm test && pnpm build
```

Notes: a core/db change must typecheck apps/api AND apps/chat (run the chat filter explicitly). If
typecheck reports stale lower-layer exports, run `pnpm reset` first. `arch:check` counts raw lines
(>600 errors) - the new cron file is well under.

- [ ] **Step 4: Em-dash + branch-context sweep before finalizing.**

```bash
git diff origin/main...HEAD | grep -nE '[--]' && echo "EM-DASH FOUND - fix" || echo "no em-dashes"
git branch --show-current   # feat/robin-recovery-producer
git status --short
```

- [ ] **Step 5: Fresh-context code review.** Use `superpowers:requesting-code-review` (independent
      subagent, fresh context) over `git diff origin/main...HEAD`. Triage with
      `superpowers:receiving-code-review`; fix every Critical/Important finding (and any >= warn) before
      merge. Re-run the relevant gates after fixes.

---

## Self-Review (spec coverage)

- Spec S2 "recovery.mode flag + resolver + producer" -> Task 1 (flag+resolver) + Tasks 5/6 (producer cron).
- Spec "cron mirroring appointment-reminder-dispatch, per-org enforce -> assemble + submit one intent
  via seeded system principal, parks" -> Tasks 5/6 + Task 3 proof.
- "off (default) fully inert; observe identify+count no submit; enforce assemble+submit+park" -> Task 5
  unit tests (off/observe/enforce).
- "flag ships with its producer, tested from real defaults" -> Task 5 "default off" test +
  same-PR wiring (Task 6).
- "seeded system principal; bespoke system:<x> hard-denies" -> builder sets `{id:"system",type:"system"}`
  (existing); Task 3 asserts `res.workUnit.actor`.
- "deployment_not_found carve-out, test against a prod-mirroring resolver" -> Task 3 (load-bearing
  positive+negative).
- "branch on approvalRequired before success" -> Task 5 cron logic + tests; Task 3 ingress proof.
- "ISO-week + org idempotency, no duplicate parked campaigns" -> Task 2 (builder) + Task 3 (dedup).
- "rebooked-exclusion read lands with the cron slice" -> Task 4 + Task 5 exclusion test.
- "no migration" -> none added; Task 7 confirms (no `**/migrations/**` in the diff).
- "keep the fail-closed placeholder executor" -> untouched; Task 3 registers the same placeholder shape.

## Out of scope (the NEXT, human-merge-gated slice)

The real consent-gated WhatsApp send (replacing the placeholder via `evaluateProactiveSendEligibility`

- phone resolution at dispatch), the `RobinRecoverySend` dedup-persistence model + migration, and any
  recipient-count auto-approve threshold. NOT in this PR.

## Deliberate scoping decisions (call out at review)

- `buildObserveGovernanceConfig` (the all-gates-observe posture factory) is intentionally NOT extended
  with `recovery`. Recovery stays off unless an operator explicitly sets `governanceConfig.recovery.mode`
  on a deployment - enabling a mass-outbound capability is an explicit go-live decision, not a
  side effect of the observe bake. (Avoids the observe-parity test churn too.)
- `recovery.mode` is stored per-AgentDeployment (where `consentState.mode` lives), reduced to one mode
  per org in the cron (enforce > observe > off). "Per-org" in the spec = per the org's deployment(s).
