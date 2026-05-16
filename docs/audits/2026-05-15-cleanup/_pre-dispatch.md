# Pre-Dispatch Verification — 2026-05-15

Baseline captured by orchestrator before Wave 1 dispatch. Subagents measure fresh; this doc is a sanity reference, not gospel.

## Lane 6 — file-size baseline (>400 LOC, excluding node_modules/dist/.next)

Top 30 of 106 files >400 LOC:

```
    1350 apps/dashboard/src/app/(auth)/(mercury)/reports/reports.module.css
    1193 apps/dashboard/src/app/globals.css
     972 packages/db/prisma/seed-marketplace.ts
     941 apps/dashboard/src/app/(auth)/(mercury)/activity/activity.module.css
     940 packages/schemas/src/__tests__/schemas.test.ts
     818 packages/core/src/orchestrator/propose-pipeline.ts
     815 apps/api/src/app.ts
     776 apps/api/src/routes/__tests__/whatsapp-management.test.ts
     753 packages/core/src/channel-gateway/__tests__/channel-gateway-deterministic-gate.test.ts
     729 packages/core/src/platform/__tests__/platform-lifecycle.test.ts
     723 apps/api/src/routes/marketplace.ts
     723 apps/api/src/__tests__/provision-end-to-end.test.ts
     676 apps/api/src/__tests__/provision-fixes.test.ts
     673 packages/core/src/lifecycle/__tests__/lifecycle-service.test.ts
     655 packages/core/src/orchestrator/__tests__/propose-helpers.test.ts
     654 apps/api/src/bootstrap/inngest.ts
     651 packages/ad-optimizer/src/__tests__/audit-runner.test.ts
     650 packages/db/src/stores/__tests__/prisma-contact-store.test.ts
     648 apps/api/src/bootstrap/skill-mode.ts
     632 packages/core/src/engine/policy-engine.ts
     622 packages/core/src/skill-runtime/hooks/whatsapp-window-gate.test.ts
     614 apps/chat/src/__tests__/whatsapp.test.ts
     613 packages/core/src/platform/platform-lifecycle.ts
     612 packages/db/prisma/seed.ts
     612 packages/core/src/approval/__tests__/lifecycle-service.test.ts
     604 packages/core/src/memory/__tests__/context-builder.test.ts
     594 apps/api/src/__tests__/cross-tenant-isolation.test.ts
     590 apps/mcp-server/src/__tests__/mcp-server.test.ts
     586 apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx
     580 apps/mcp-server/src/__tests__/api-governance-adapter.test.ts
```

Total files >400 LOC: **106** (full list at `/tmp/audit-file-sizes.txt` during this run).
Of those: 4 are `.module.css` >400 (reports=1350, activity=941, plus 2 more below the top-30 cutoff — subagent enumerates fresh). `apps/dashboard/src/app/globals.css` is a plain (non-module) CSS file at 1193 LOC — flag separately.

CSS-module offenders confirmed via earlier review: `reports.module.css` (1350), `activity.module.css` (941), `pipeline.module.css` (~564), `detail.module.css` (~518) — full enumeration is the subagent's job. The spec's prior list incorrectly named `contact-detail` (350 LOC, below threshold) and `landing.module.css` (does not exist).

## Lane 7 — type suppressions in `apps/dashboard/src` (glob `*.{ts,tsx}`)

```
apps/dashboard/src/app/(auth)/operator/__tests__/proposed-disqualifications-panel.test.tsx:3
apps/dashboard/src/app/api/waitlist/route.ts:1
```

**Files with at least one suppression: 2**
**Total suppressions: 4**

This count uses the regex `@ts-ignore|@ts-expect-error|\bas any\b|: any\b` over `apps/dashboard/src/**/*.{ts,tsx}` excluding `.next/`. The reviewer's verification (which surfaced this same number) decisively contradicts the original scout estimate of "~264 instances." Lane 7's subagent should measure fresh with a wider net (including `Record<string, any>` and similar `any`-leak patterns) but should NOT trust prior estimates.

Note: rg's `--type tsx` is not a valid type alias in the version available locally; use `-g '*.{ts,tsx}'` instead.

## Lane 13 — nullable `organizationId` in `packages/db/prisma/schema.prisma`

```
14:  organizationId String?
43:  organizationId       String?
83:  organizationId       String?
105:  organizationId   String?
133:  organizationId        String?
170:  organizationId    String?
200:  organizationId       String?
238:  organizationId String?
261:  organizationId              String?
528:  organizationId String?
1198:  organizationId  String?
```

**Total nullable `organizationId` fields: 11**

TI-9 in `.audit/12-pre-launch-security-audit.md` cited **11** models as orphan-row risk. Current count exactly matches — this is the baseline for Lane 13's delta classification (orphan-row risk vs intentional null per model).

## Lane 17 — Inngest function locations

Files containing `createFunction(` calls:

```
apps/api/src/services/cron/pcd-registry-backfill.ts
apps/api/src/services/cron/reconciliation.ts
apps/api/src/services/cron/meta-token-refresh.ts
apps/api/src/services/cron/lifecycle-stalled-sweep.ts
apps/api/src/services/cron/lead-retry.ts
apps/api/src/bootstrap/inngest.ts
packages/creative-pipeline/src/mode-dispatcher.ts
packages/creative-pipeline/src/creative-job-runner.ts
packages/ad-optimizer/src/inngest-functions.ts
packages/creative-pipeline/src/ugc/ugc-job-runner.ts
packages/core/src/skill-runtime/batch-executor-function.ts
```

**Total files with Inngest functions: 11**

`apps/api/src/bootstrap/inngest.ts` is the registration site (contains `createFunction` for the daily pattern-decay cron) but the bulk of function bodies live in the cron, creative-pipeline, ad-optimizer, and core/skill-runtime files above. Lane 17's subagent enumerates `createFunction` calls within each file and verifies `onFailure` + DLQ for each.

## Exclusion mask — file lists per active branch

```
== docs/local-readiness-spec ==
docs/superpowers/specs/2026-05-15-local-readiness-and-ci-gates-design.md
== docs/local-readiness-plan ==
docs/superpowers/plans/2026-05-15-local-readiness-pr1.md
```

Both local-readiness branches contain only their own spec/plan files. No code changes. Subagents may still produce findings outside these paths; collision-tagging only applies to findings whose `Where:` matches an entry above.

Riley-related branches: at dispatch time, none of `feat/riley-wave-b-pr1*` showed live diffs vs main — they are stale local refs after Wave B PR-1 (#538/#541/#543) merged. The always-excluded Riley paths from the design doc (`packages/core/src/**/riley*`, `packages/core/src/**/recommendation*`, `packages/schemas/src/recommendation*`) remain in effect regardless.

## Worktree + environment

- Worktree: `/Users/jasonli/switchboard/.claude/worktrees/audit-wave-1-execution`
- Branch: `audit/wave-1-execution-2026-05-15` (off `main` @ `68dabd6e`)
- Spec + plan present on main as commit `c9258237` (PR #544, merged 2026-05-15T13:38:40Z)
- `pnpm install --frozen-lockfile` completed; deps available for lanes that need `pnpm format:check` / `pnpm audit` / `pnpm db:check-drift`
- Postgres NOT reachable (per `pnpm worktree:init` output) — lanes requiring DB connectivity should fall back to static analysis and note the gap
