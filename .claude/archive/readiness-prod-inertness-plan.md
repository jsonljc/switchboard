# Plan: readiness prod-inertness gates (TDD, ephemeral scratch)

Worktree: `.claude/worktrees/readiness-prod-inertness` (branch `feat/readiness-prod-inertness-gates`, off origin/main @ 7942503).
Files touched: `apps/api/src/routes/readiness.ts` + `apps/api/src/routes/__tests__/readiness.test.ts` ONLY.

## Final gate set (ground-truth-locked)

- **C. `proactive-governance-seeded` — BLOCKING.** Pass iff per-org allow policy `proactiveIntakeAllowPolicyId(orgId)` (=`policy_allow_proactive_intake_${orgId}`) exists AND `active===true`. Without it, greeting/reminder/followup/lead-intake sends are prod-inert by PolicyEngine default-deny.
- **A. `recovery-mode` — ADVISORY.** Read `governanceConfig.recovery.mode` across ALL org deployments, reduce `enforce>observe>off`. `off`=>advisory fail (nudge); `observe`/`enforce`=>pass (distinct messages).
- **B. `weekly-report-enabled` — ADVISORY.** `process.env["LEDGER_WEEKLY_REPORT_ENABLED"]==="true"` => pass; else advisory fail (platform-wide flag note).

Order appended after the existing 13: `...,"alex-skill-pack-seeded","business-facts-present","proactive-governance-seeded","recovery-mode","weekly-report-enabled"`. Count 13 -> 16.

## Imports to add to readiness.ts

```ts
import { /* existing */ proactiveIntakeAllowPolicyId } from "@switchboard/db";
import {
  resolveRecoveryConfig,
  type GovernanceConfig,
  type GovernanceMode,
} from "@switchboard/schemas";
```

## Type additions

ReadinessContext gains:

```ts
recoveryMode: GovernanceMode; // reduced across org deployments; "off" when none/error
weeklyReportEnabled: boolean;
proactiveGovernanceSeeded: boolean;
```

PrismaLike gains:

```ts
agentDeployment.findMany(args: { where: { organizationId: string }; select: { governanceConfig: true } })
  : Promise<Array<{ governanceConfig: unknown }>>;   // ALONGSIDE the existing findFirst
policy: {
  findUnique(args: { where: { id: string }; select: { active: true } })
    : Promise<{ active: boolean } | null>;
};
```

---

## Step 1 — pure checks + context fields + structure test (RED→GREEN)

**RED:** In `readiness.test.ts` add, BEFORE implementing:

- `proactive-governance-seeded`: fails (blocking, ready=false) when `proactiveGovernanceSeeded:false`; passes when true.
- `recovery-mode`: `recoveryMode:"off"` => status fail, blocking=false, report.ready stays true; `"observe"` => pass; `"enforce"` => pass (assert message differs from observe).
- `weekly-report-enabled`: `weeklyReportEnabled:false` => fail, blocking=false, ready stays true; `true` => pass.
- Update the all-pass test `toHaveLength(13)` -> `16`; update the structure id-list `toEqual([...])` to append the 3 ids; add the 3 new fields to `makeContext()` defaults as PASSING values: `recoveryMode:"enforce"`, `weeklyReportEnabled:true`, `proactiveGovernanceSeeded:true`.
  These reference `ctx.recoveryMode` / `ctx.weeklyReportEnabled` / `ctx.proactiveGovernanceSeeded` which don't exist yet -> tsc/vitest RED. Capture the failing assertion (the new checks are absent / fields missing).

**GREEN:** In `readiness.ts`:

1. Add the 3 fields to `ReadinessContext`.
2. Add 3 pure check fns following the existing `checkX(ctx): ReadinessCheck` shape:
   - `checkProactiveGovernanceSeeded`: blocking=true; pass message e.g. "Proactive sends (greetings, reminders, follow-ups) are enabled"; fail message operator-friendly + non-leaky e.g. "Proactive messaging isn't enabled yet — greetings, reminders and follow-ups won't send. Reload your agent configuration, or contact support if this persists."
   - `checkRecoveryMode`: blocking=false; `enforce` => pass "No-show recovery is active — campaigns are created and parked for your approval."; `observe` => pass "No-show recovery is in observe mode (counting no-shows, not sending yet)."; `off` => fail "No-show recovery is off — no recovery campaigns will be created. Enable it to re-engage no-show patients."
   - `checkWeeklyReportEnabled`: blocking=false; pass "Weekly revenue report is enabled."; fail "Weekly revenue report is disabled — owners won't receive the weekly summary. (Platform-wide setting.)"
3. Wire the 3 into `checkReadiness` after `checkBusinessFactsPresent`.
   Done-condition: `pnpm --filter @switchboard/api exec vitest run src/routes/__tests__/readiness.test.ts` green; the all-pass + structure tests pass at 16.

## Step 2 — buildReadinessContext IO wiring (RED→GREEN)

**RED:** Extend `makePrismaMock` to stub `agentDeployment.findMany` (default `[]`) and `policy.findUnique` (default a row `{active:true}`), and add `buildReadinessContext` tests:

- recoveryMode: given two deployment rows with governanceConfig `{recovery:{mode:"observe"}}` and `{recovery:{mode:"enforce"}}` => ctx.recoveryMode === "enforce" (rank reduce); empty => "off".
- proactiveGovernanceSeeded: `policy.findUnique` returns `{active:true}` => true; returns `null` => false; returns `{active:false}` => false. Assert the queried id equals `proactiveIntakeAllowPolicyId(orgId)` (spy on the `where.id`).
- weeklyReportEnabled: stub `process.env.LEDGER_WEEKLY_REPORT_ENABLED` via `vi.stubEnv("LEDGER_WEEKLY_REPORT_ENABLED","true")` => true; unset/"false" => false. (Use afterEach `vi.unstubAllEnvs()`.)
  These fail because `buildReadinessContext` doesn't set the fields yet (undefined). Capture RED.

**GREEN:** In `buildReadinessContext`:

1. `weeklyReportEnabled = process.env["LEDGER_WEEKLY_REPORT_ENABLED"] === "true";` (mirror inngest.ts:1341 exactly).
2. recovery: wrapped fail-safe (mirror alexSkillPack/businessFacts try/catch). `let recoveryMode: GovernanceMode = "off";` then `try { const deps = await prisma.agentDeployment.findMany({ where:{ organizationId: orgId }, select:{ governanceConfig:true } }); recoveryMode = reduceRecoveryMode(deps); } catch { console.warn(...); }`. `reduceRecoveryMode` = inline: for each dep `resolveRecoveryConfig(gc as GovernanceConfig|null).mode`, keep max by `{off:0,observe:1,enforce:2}`. (A separate findMany alongside the existing alex findFirst — comment WHY: faithful cross-deployment reduction without disturbing the alex deployment load.)
3. governance: conservative. `let proactiveGovernanceSeeded = false; try { const row = await prisma.policy.findUnique({ where:{ id: proactiveIntakeAllowPolicyId(orgId) }, select:{ active:true } }); proactiveGovernanceSeeded = row?.active === true; } catch { console.warn(...); /* stays false => blocks, mirrors alexSkillPack */ }`.
4. Add the 3 fields to the returned object.
   Done-condition: full `readiness.test.ts` green incl. new builder tests.

## Step 3 — VERIFY

Dispatch verifier: `pnpm --filter @switchboard/api exec tsc --noEmit`; `pnpm --filter @switchboard/api test`; `pnpm --filter @switchboard/db exec tsc --noEmit` (consumer of nothing new, but cheap); `pnpm lint`; `pnpm format:check`; `pnpm arch:check`; `CI=1 npx tsx scripts/local-verify-fast.ts` (env-allowlist — expect green, no new var); `pnpm build` (api app changed). Security `pnpm audit --audit-level=high`. NO migration, NO eval (engine untouched). Then independent fresh-context review on `git diff origin/main...HEAD`.

## Acceptance criteria

1. 3 new checks present; ids/order exactly as listed; count 16.
2. Gate C blocking flips `ready` false when policy absent/inactive; advisory A/B never block.
3. buildReadinessContext derives all 3 from real producers (policy row id == canonical builder; recovery reduced across deployments; env mirrors live read).
4. No merge-stop glob touched; diff = 2 files; reuse exported helpers (no id drift).
5. All VERIFY gates green; independent review 0 findings >=warn.
