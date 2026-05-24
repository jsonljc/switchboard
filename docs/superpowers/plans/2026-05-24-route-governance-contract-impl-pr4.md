# Route Governance Contract v1 — Impl PR-4 Plan: Backfill + Flip Enforcement

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the three Route Governance Contract advisories (route-class, cross-app-types, store-mutation) trustworthy, then flip them from warning mode to **blocking, repo-wide error mode** — after the AST upgrade, the back-compat alias sweep, and the `@route-class` header backfill make a clean flip possible.

**Architecture:** Three sequenced sub-PRs that land on `main` independently in order (**4A → 4B → 4C**). The architecture mirrors PR-3's execution-split discipline. **4A** is validator correctness only (AST-level `where`-object inspection in `store-mutation-check.ts`; dynamic `SCHEMAS_EXPORT_NAMES` enumeration in `cross-app-types-check.ts`) plus the triage of the new, accurate warning baselines — still warning-only. **4B** is the mechanical back-compat alias sweep (`HandoffPackage`→`Handoff`, `ConversationSummary`→`HandoffConversationSummary`, `ConversationStateData`→`ConversationState`, `DashboardOverview`→`OperatorOverview`) plus the two missing `RouteTemplates` sub-barrel re-exports — no validator behaviour change. **4C** backfills `@route-class` headers on the remaining ~63 `apps/api` routes + 3 chat routes, adds a directory-level `dashboard-proxy` convention, and flips all three advisories to a repo-wide blocking `--mode=error` in CI, plus the doctrine/architecture docs.

**Tech Stack:** TypeScript (strict, ESM, `.js` import extensions), ts-morph (AST walking — already in `.agent/tools/`), Vitest (TDD), Prisma ORM (mocked in unit tests — CI has no Postgres), pnpm/Turborepo monorepo, GitHub Actions (CI advisory wiring at `.github/workflows/ci.yml:317-321`).

**Consumes:** `docs/superpowers/specs/2026-05-16-route-governance-contract-v1.md` Sections 8 (cross-app types), 10.4 (store-mutation check), 12 (PR-4 envelope), 15 (success criteria). Builds on:

- PR-1 (#614 → `5617dbf0`) — the `check-routes --mode=warn-touched` CLI branch + `route-class-validator.ts` + `@route-class` headers on the 4 ingress-migrated routes.
- PR-2 (#624 → `f99d0c6f`) — cross-app type relocation; landed the back-compat aliases this PR sweeps (`HandoffPackage`/`ConversationSummary`/`ConversationStateData`/`DashboardOverview`).
- PR-2.5 (#627 → `295e95ab`) — `cross-app-types-check.ts` (static `SCHEMAS_EXPORT_NAMES`) + `RouteTemplates` interface in the core root barrel.
- PR-3 (3A #632 `c404c66f` / 3B #641 `2e0c9caa` / 3C #636 `d18a4f6e` / 3D #638 `8e46b34c`) — `store-mutation-check.ts` (text-scan) + its `--mode=warn-touched` wiring. PR-3D's Task 17 **mandates** the AST upgrade in this plan as a hard prerequisite to any error-mode flip.

**Independence within the workstream:** PR-4 is the terminal phase. It depends on PR-1/2/2.5/3 all being merged (they are, as of 2026-05-23). No other Phase 3A work remains.

---

## Decisions locked during brainstorming (2026-05-24)

Recorded so reviewers can audit them. All confirmed by the user.

1. **Three sub-PRs, flip lands last.** 4A = validator correctness + triage (warning-only). 4B = alias sweep + sub-barrel re-exports (no validator change). 4C = `@route-class` backfill + flip to error. You do not flip warnings to errors until the validator is trustworthy; the AST upgrade in 4A is the real prerequisite.

2. **4A owns validator correctness only — it does not drift into alias cleanup, docs, or enforcement behaviour.** The dynamic `SCHEMAS_EXPORT_NAMES` swap belongs in 4A because it is *also* validator correctness; the alias sweep does not.

3. **Deferred store sites are allowlisted now, migrated later.** `prisma-creator-identity-store` (×5 mutators) and `storage/prisma-lifecycle-store.updateDispatchRecord` (×1) reach `organizationId` only through an FK with **no Prisma `@relation`** to walk. PR-4 stays migration-free: suppress both via the `// route-governance: store-mutation-global` directive + a 1-line rationale, and open a **tracked follow-up issue** for the `@relation`-adding migration. (The directive token is reused; the rationale text distinguishes "deferred-needs-migration" from "genuinely-global" — see Task 2.)

4. **PR-4A triage rule (the load-bearing boundary).** After the AST upgrade re-baselines the store-mutation warnings:
   - **Fix in-PR** any genuinely-unscoped store mutation whose fix is **local** — it can be closed by adding an *already-available* `organizationId`/`orgId`/relation filter, with **no** schema migration, new `@relation`, API-contract change, or business-logic ambiguity.
   - **Defer** (suppress + 1-line rationale + tracked issue) **only** when the fix requires a schema migration, a new relation, an API-contract change, or has unclear business semantics.
   - The AST upgrade is expected to clear the contact-store ×8 and ~26 `storage/**` false-positives (those rows are already org-scoped; the text scan over-counted). Whatever genuinely-unscoped residual remains gets the rule above applied per-site. 4A must not be a validator upgrade that knowingly leaves easy governance gaps behind.

5. **Dashboard proxies use a directory-level `dashboard-proxy` convention, not per-file headers or a silent allowlist.** The validator treats `apps/dashboard/src/app/api/**` as `dashboard-proxy` *by convention* (a recognised class, machine-checkable coverage), unless a file carries an explicit `@route-class` override header. Non-dashboard `app/api` routes still require explicit headers. A dashboard route that is **not** a proxy must carry an explicit override.

6. **Flip enforcement coverage (4C).** Blocking in error mode: (a) every in-scope route carries a valid `@route-class` header *or* is covered by the `dashboard-proxy` directory convention; (b) the existing operator-direct + read-only matrix cells; (c) cross-app-type duplicate violations (minus directive-suppressed); (d) un-scoped store mutations (minus directive-suppressed). **Explicitly NOT yet blocking:** stricter lifecycle/control-plane/ingress-receiver matrix cells, Cat 3.15, Cat 3.16, and the deferred `@relation`-migration sites.

7. **Cat 3.15 (typed Graph API response wrapper) + Cat 3.16 (agentContext null guard) are deferred to a tracked follow-up issue.** Neither shares PR-4's theme; folding them dilutes review and couples unrelated risk to the flip.

8. **Enforcement scope is repo-wide.** A new `--mode=error` scans ALL routes/stores/app-types repo-wide and exits non-zero on any violation (spec §15 criteria 1 + 2). The backfill (Task 13) must be complete before the flip (Task 16) so the gate is green on merge.

---

## Schema boundary rule

This plan does **not** add or modify any Zod schema. The only `@switchboard/schemas` edits are **deletions** of two back-compat alias *type* declarations (`DashboardOverview` in `dashboard.ts`, and the `HandoffPackage`/`ConversationSummary` aliases live in **core** `handoff/types.ts`, not schemas). No `z.object(...)`, no `z.infer`, no Date-vs-string boundary decision anywhere in PR-4. If a task code-block shows a new `z.object(...)`, that is a plan bug — flag and skip.

---

## Pre-flight verification — done during plan-writing

Captured so the implementing agent does not redo it and reviewers can audit the assumptions. Verified on `origin/main` at `8e46b34c` (re-confirm exact SHA in each sub-PR's Task 0).

| Question | Answer |
| --- | --- |
| Is `HandoffPackage` a semantic type or a pure alias? | **Pure alias.** `packages/core/src/handoff/types.ts:25` declares `export type HandoffPackage = Handoff;` and `:28` `export type ConversationSummary = HandoffConversationSummary;`. The sweep is a mechanical rename + import retarget, **not** a semantic merge. The `HandoffStore` interface in the same file references `HandoffPackage` and stays in core (it is a store contract, not a cross-app value type) — only its type references rename to `Handoff`. |
| Where is the `DashboardOverview` alias? | `packages/schemas/src/dashboard.ts` (`export type DashboardOverview = OperatorOverview;` + `DashboardOverviewSchema = OperatorOverviewSchema`). Consumers: `apps/dashboard/src/app/api/dashboard/overview/route.ts`, `hooks/use-dashboard-overview.ts`, `lib/api-client/dashboard.ts`. Method/hook/file names (`getDashboardOverview`, `use-dashboard-overview.ts`) stay — only the **type** renames. |
| Where is `ConversationStateData`? | `apps/chat/src/conversation/state.ts` re-export shim + consumers in `prisma-store.ts`, `store.ts`, `threads.ts` (+ test). Canonical is `ConversationState` from `@switchboard/schemas`. |
| `HandoffPackage` consumer count? | ~18 files across `packages/core/**` (handoff/, skill-runtime/hooks/, decisions/, consent/, contacts/, channel-gateway/, index.ts), `packages/db/src/stores/handoff-store.ts`, `apps/api/src/{bootstrap/skill-mode.ts,routes/decisions.ts}`. Exact list re-derived by grep in Task 6. |
| How many `@route-class` headers exist / are missing? | `apps/api/src/routes/` has 104 `.ts` files (incl. tests); **4** carry `@route-class` (the PR-1 ingress routes). Spec §12 PR-4 says "~63 remaining" non-test routes. `apps/chat/src/routes/` has 3 `.ts` files (0 headers). `apps/dashboard/src/app/api/**` has ~100 `route.ts(x)` proxy files → covered by the directory convention, **not** per-file headers. |
| Header format? | First line of file: `// @route-class: operator-direct` (see `apps/api/src/routes/recommendations.ts:1`). `parseRouteClass` reads the first 2048 chars. |
| Current advisory wiring? | `.agent/tools/check-routes.ts` `isMain` branch: `--mode=warn-touched` runs all three advisories via `Promise.all`, merges warnings, prints `::warning file=...`, **`process.exit(0)`**. CI step `.github/workflows/ci.yml:317-321` runs it with `continue-on-error: true`. |
| Current `store-mutation-check.ts` heuristic? | **Text scan.** `windowHasOrgToken` returns true if `/\b(organizationId|orgId)\b/` appears anywhere in ±10 lines — including param lists/comments/unrelated statements. This is the false-negative Task 1 upgrades to AST `where`-object inspection. |
| Current `cross-app-types-check.ts` matcher? | **Static `SCHEMAS_EXPORT_NAMES`** (21 hand-curated names). `scanFile` flags exported local interfaces/type-aliases whose name is in the set, minus `// route-governance: local-view-model`-suppressed decls. Task 3 swaps the static set for a ts-morph walk of `packages/schemas/src/index.ts` `getExportedDeclarations()`. |
| Does the dashboard proxy allowlist already exist? | Yes — `route-allowlist.yaml:14` allowlists `apps/dashboard/src/app/api/dashboard/**` for the **ingress** check. That is separate from the `@route-class` header convention (Task 12 adds the latter in the validator). |
| ts-morph available in `.agent/tools`? | Yes — both existing advisories import from `"ts-morph"`. `.agent/tools/package.json` declares it; `.agent/tools/node_modules` is cached in CI (`ci.yml:308`). |
| Test command for `.agent/tools`? | Tests live in `.agent/tools/__tests__/*.test.ts`. Confirm the exact runner in Task 0 (`cat .agent/tools/package.json` — likely `pnpm --filter <agent-tools-pkg> test` or `vitest` invoked from `.agent/tools/`). The existing `store-mutation-check.test.ts` + `cross-app-types-check.test.ts` + `check-routes-warn-mode.test.ts` are the mirrors. |
| `mcp-server` interaction? | `cross-app-types-check.ts` `APP_SRC_RX` includes `mcp-server`. A parallel branch (`chore/kill-mcp-server`) removes `apps/mcp-server`. Harmless either way — if the dir is gone, no files match the regex. Task 3's dynamic swap touches only the *schemas* enumeration, not `APP_SRC_RX`. Leave the regex tolerant; do **not** couple PR-4 to the mcp-server removal. |

---

## Execution split — three PRs (4A → 4B → 4C)

PR-4 is **not** one PR. Each sub-PR cuts a **fresh worktree from `origin/main`**, runs **Task 0**, executes only its mapped tasks, runs its own gate, and opens an independent PR to `main`.

| Sub-PR | Theme | Tasks | Posture |
| --- | --- | --- | --- |
| **PR-4A** | Validator correctness + triage | Task 0 → **Tasks 1, 2, 3, 4** → gate (Task 5) | Still **warning-only**. AST `where`-inspection + dynamic schema enumeration + re-baseline triage. No enforcement change, no alias sweep, no docs. |
| **PR-4B** | Back-compat alias sweep + sub-barrel re-exports | Task 0 → **Tasks 6, 7, 8, 9, 10** → gate (Task 11) | Mechanical. Rename aliases to canonical, delete alias decls, add `RouteTemplates` sub-barrel re-exports. **No validator behaviour change.** Grep contract proves aliases gone. |
| **PR-4C** | `@route-class` backfill + flip to error | Task 0 → **Tasks 12, 13, 14, 15, 16, 17** → gate (Task 18) | The flip. Adds `dashboard-proxy` convention + header-presence enforcement, backfills headers, adds repo-wide `--mode=error`, wires it blocking in CI, updates docs. Lands **last**. |

**Per-sub-PR workflow (apply to each of 4A–4C):**

1. `git fetch origin main`, then cut a fresh worktree from `origin/main` and run `pnpm worktree:init` (or, for the gate-light advisory-only work, at minimum `pnpm install` so husky hooks resolve — PR-3 hit a husky-resolution snag on docs commits in a bare worktree).
2. Run **Task 0** (preflight) in the new worktree.
3. Execute only the tasks mapped to this sub-PR. Commit per task.
4. Run the sub-PR's gate (Task 5 / 11 / 18). **A store-mutation or advisory change MUST run api + chat tests, not just db** — PR-3 learned that `update`→`updateMany` and signature changes break app-level call-shape spies while db typecheck stays green (`feedback_store_tightening_gate_needs_app_tests`). Rebuild `dist` before app typecheck if cross-package exports changed (`pnpm reset` if stale missing-export errors appear).
5. Open the PR. **4C's body must list the expected steady-state advisory output** so reviewers do not mistake the deferred sites for regressions.
6. **Stacking rule (PR-3 gotcha):** CI fires on `pull_request: branches:[main]` only. Cut each sub-PR fresh from `origin/main` and target `main` directly — do **not** stack 4B on an unmerged 4A. If you must stack, retarget the base to `main` BEFORE pushing, then push an empty commit (fires `synchronize`) so CI runs. Never `gh pr merge --delete-branch` the base of an open child (auto-closes it). Do **not** arm `--auto` on a stacked child (fires instantly when base lacks protection).
7. Tear down the worktree the day the sub-PR merges.

**Merge order:** 4A → 4B → 4C. 4C's flip is only safe once 4A's validator is AST-accurate and 4B's aliases are gone (otherwise the flip errors on legitimate back-compat imports or noisy text-scan false-positives).

> Task numbering below (Task 0–18) is the **catalogue**; the table above is the **execution order**.

---

## File structure

### PR-4A

| Path | Change |
| --- | --- |
| `.agent/tools/store-mutation-check.ts` | Replace `windowHasOrgToken` text scan with `whereObjectHasOrgFilter` AST inspection of the mutation call's first-arg `where` object literal. |
| `.agent/tools/__tests__/store-mutation-check.test.ts` | Add cases: relation-filter passes, org-only-in-param-list now **fails**, nested relation key, false-positive regressions. |
| `.agent/tools/cross-app-types-check.ts` | Replace static `SCHEMAS_EXPORT_NAMES` with `enumerateSchemaTypeNames(repoRoot)` (ts-morph `getExportedDeclarations()` over `packages/schemas/src/index.ts`, filtered to interface/type-alias names). |
| `.agent/tools/__tests__/cross-app-types-check.test.ts` | Add cases: dynamic enumeration picks up a schema type, ignores value-only exports, suppression directive still works. |
| `packages/db/src/stores/*.ts` | **Triage-driven (Task 2).** Tighten any locally-fixable unscoped mutation; add suppression directive + rationale to `prisma-creator-identity-store.ts` (×5) + `storage/prisma-lifecycle-store.ts` `updateDispatchRecord`. |
| `apps/{api,chat,dashboard}/src/**` | **Triage-driven (Task 4).** Annotate legitimate narrower local types surfaced by the broadened cross-app enumeration with `// route-governance: local-view-model`, or migrate true duplicates to `@switchboard/schemas` imports. |

### PR-4B

| Path | Change |
| --- | --- |
| `packages/core/src/handoff/types.ts` | Delete `export type HandoffPackage = Handoff;` + `export type ConversationSummary = HandoffConversationSummary;`. Rename in-file refs (`HandoffStore` methods) to `Handoff` / `HandoffConversationSummary`. |
| ~18 `HandoffPackage` consumer files | Rename `HandoffPackage` → `Handoff` (import + usage). |
| ~6 handoff-flavoured `ConversationSummary` consumers | Rename → `HandoffConversationSummary` (only the handoff-flavoured ones; the api `/conversations` route's projection is the *new* canonical `ConversationSummary` — do not touch). |
| `apps/chat/src/conversation/{state.ts,prisma-store.ts,store.ts,threads.ts}` | `ConversationStateData` → `ConversationState`; delete the `state.ts` re-export shim alias. |
| `packages/schemas/src/dashboard.ts` | Delete `DashboardOverview` type alias + `DashboardOverviewSchema` alias. |
| `apps/dashboard/src/app/api/dashboard/overview/route.ts`, `hooks/use-dashboard-overview.ts`, `lib/api-client/dashboard.ts` | `DashboardOverview` → `OperatorOverview` (type only; keep method/hook/file names). |
| `packages/core/src/decisions/index.ts` | Add `export type { RouteTemplates } from "../lib/route-templates.js";`. |
| `packages/core/src/contacts/index.ts` | Add the same `RouteTemplates` re-export. |

### PR-4C

| Path | Change |
| --- | --- |
| `.agent/tools/route-class-validator.ts` | Add `"dashboard-proxy"` to `RouteClass`/`KNOWN_CLASSES`; add `resolveRouteClass(sf, repoPath)` (explicit header ?? `dashboard-proxy` if path under `apps/dashboard/src/app/api/` else null); add header-presence warning when effective class is null. |
| `.agent/tools/__tests__/route-class-validator.test.ts` | Cases: dashboard path defaults to proxy, explicit override beats default, non-dashboard missing header → warning, dashboard non-proxy override respected. |
| `apps/api/src/routes/*.ts` (~63) | Add `// @route-class: <class>` first-line header per spec §1 decision table. |
| `apps/chat/src/routes/*.ts` (3) | Same. |
| `.agent/tools/check-routes.ts` | Add `--mode=error`: glob all in-scope files repo-wide, run all three advisories + header-presence, print `::error`, `process.exit(1)` if any. |
| `.agent/tools/__tests__/check-routes-warn-mode.test.ts` (or new `check-routes-error-mode.test.ts`) | Cases: error mode exits 1 on a violation, exits 0 on a clean tree, scans repo-wide not just touched. |
| `.github/workflows/ci.yml` | Add a blocking `--mode=error` step (no `continue-on-error`); keep or retire the advisory `warn-touched` step per Task 16. |
| `docs/DOCTRINE.md` | Add the route taxonomy + per-class matrix (spec §15 criterion 7). |
| `docs/ARCHITECTURE.md` | Same. |
| `docs/superpowers/specs/2026-05-16-route-governance-contract-v1.md` | Update §11 crosswalk: mark 3.15/3.16 deferred-to-follow-up-issue; note deferred store-migration sites. |

---

## Implementation tasks

### Task 0: Preflight — confirm baseline + advisory test runner

> Run at the **start of every sub-PR (4A–4C)**, in that sub-PR's fresh worktree.

**Files:** none (verification-only).

- [ ] **Step 1: Confirm `main` HEAD + capture baseline SHA.** Run: `git fetch origin main && git log --oneline origin/main -3`. Expected top commit `8e46b34c` (PR-3D) or newer. Record `git rev-parse origin/main` in the PR description.

- [ ] **Step 2: Confirm the `.agent/tools` test + typecheck commands.** Run: `cat .agent/tools/package.json`. Note the `test` + `typecheck` scripts and the package name (used as `pnpm --filter <name> test`, or run vitest from inside `.agent/tools`). Re-confirm how `cross-app-types-check.test.ts` is run — every advisory task below uses the same command.

- [ ] **Step 3: Confirm the advisory source shapes are unchanged from this plan's assumptions.** Run:
```bash
sed -n '1,20p' .agent/tools/store-mutation-check.ts
sed -n '30,60p' .agent/tools/cross-app-types-check.ts
sed -n '1,45p' .agent/tools/route-class-validator.ts
```
Expected: `store-mutation-check.ts` has `windowHasOrgToken` (text scan); `cross-app-types-check.ts` has the static `SCHEMAS_EXPORT_NAMES` set; `route-class-validator.ts` has 5 classes (no `dashboard-proxy`). If any diverged, fix the affected task inline.

- [ ] **Step 4: No commit.** Verification only.

---

## ── PR-4A: Validator correctness + triage ──

### Task 1: AST upgrade — `store-mutation-check.ts` `where`-object inspection (TDD)

**Why:** PR-3D Task 17's hard mandate. The text scan passes a mutation if `organizationId`/`orgId` appears anywhere in ±10 lines — including a param list or comment — even when the actual Prisma `where` object carries no org filter. PR-4C cannot flip to error while the check is text-based.

**Files:**
- Modify: `.agent/tools/store-mutation-check.ts`
- Modify: `.agent/tools/__tests__/store-mutation-check.test.ts`

- [ ] **Step 1: Write the failing tests.** Append to `store-mutation-check.test.ts`:

```ts
describe("store-mutation advisory — AST where-object inspection", () => {
  it("FAILS a mutation whose org token is only in the param list, not the where", () => {
    const w = scan(`export class S {
      async f(organizationId: string, id: string) {
        await this.prisma.contact.updateMany({ where: { id }, data: {} });
      }
    }`);
    expect(w).toHaveLength(1);
  });

  it("passes a direct-column where org filter", () => {
    const w = scan(`export class S {
      async f(organizationId: string, id: string) {
        await this.prisma.contact.updateMany({ where: { id, organizationId }, data: {} });
      }
    }`);
    expect(w).toHaveLength(0);
  });

  it("passes an orgId-keyed where", () => {
    const w = scan(`export class S {
      async f(orgId: string, agentKey: string) {
        await this.prisma.orgAgentEnablement.updateMany({ where: { orgId, agentKey }, data: {} });
      }
    }`);
    expect(w).toHaveLength(0);
  });

  it("passes a relation-filter where (Pattern C)", () => {
    const w = scan(`export class S {
      async f(organizationId: string, id: string) {
        await this.prisma.deploymentConnection.updateMany({ where: { id, deployment: { organizationId } }, data: {} });
      }
    }`);
    expect(w).toHaveLength(0);
  });

  it("FAILS a relation-filter where whose nested object lacks org", () => {
    const w = scan(`export class S {
      async f(id: string) {
        await this.prisma.approvalCheckpointRecord.updateMany({ where: { id, workflow: { status: "x" } }, data: {} });
      }
    }`);
    expect(w).toHaveLength(1);
  });

  it("still honors the suppression directive", () => {
    const w = scan(`export class S {
      async f(id: string) {
        // route-governance: store-mutation-global
        await this.prisma.agentListing.update({ where: { id }, data: {} });
      }
    }`);
    expect(w).toHaveLength(0);
  });

  it("passes a where bound to a same-scope const object literal carrying org", () => {
    // Same-scope `const where = { id, organizationId }` is statically
    // resolvable — accept it so the rule does not force ugly inline rewrites.
    const w = scan(`export class S {
      async f(organizationId: string, id: string) {
        const where = { id, organizationId };
        await this.prisma.contact.updateMany({ where, data: {} });
      }
    }`);
    expect(w).toHaveLength(0);
  });

  it("FAILS a where built from an unresolvable identifier (conservative)", () => {
    // A where passed in as a param (no resolvable object-literal initializer)
    // cannot be proven scoped — flag it so a human annotates or inlines.
    const w = scan(`export class S {
      async f(where: any) {
        await this.prisma.contact.updateMany({ where, data: {} });
      }
    }`);
    expect(w).toHaveLength(1);
  });

  it("honors the distinct store-mutation-deferred directive", () => {
    const w = scan(`export class S {
      async f(id: string) {
        // route-governance: store-mutation-deferred
        await this.prisma.creatorIdentity.update({ where: { id }, data: {} });
      }
    }`);
    expect(w).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run → FAIL.** Run the advisory test command (Task 0 Step 2). Expected: the param-list, missing-nested-org, and identifier-where cases fail (text scan currently passes them).

- [ ] **Step 3a: Widen the suppression directive to two distinct tokens.** Replace `SUPPRESS_DIRECTIVE_RX` so the advisory recognises both the genuinely-global exemption and the deferred-migration marker as separate, self-documenting tokens (resolves the semantic overload — `global` and `deferred tenant-scoping migration` are not the same category):
```ts
const SUPPRESS_DIRECTIVE_RX =
  /\/\/\s*route-governance:\s*store-mutation-(global|deferred)\b/;
```
`hasSuppressDirectiveAbove` is otherwise unchanged. PR-3D's existing `store-mutation-global` annotations (AgentListing, OutboxEvent, decayStale) keep working; Task 2 uses `store-mutation-deferred` for the migration-needing sites.

- [ ] **Step 3b: Implement AST inspection.** In `.agent/tools/store-mutation-check.ts`, replace `windowHasOrgToken` with a `where`-object walk. Keep `getMutationMethod` + `hasSuppressDirectiveAbove` unchanged. New logic in `scanStoreFileForTest`:

```ts
import {
  Project,
  type SourceFile,
  SyntaxKind,
  type CallExpression,
  type ObjectLiteralExpression,
  Node,
} from "ts-morph";

// ...constants unchanged except remove WINDOW_LINES + ORG_TOKEN_RX...
const ORG_KEYS = new Set(["organizationId", "orgId"]);

export function scanStoreFileForTest(sf: SourceFile, repoPath: string): ValidatorWarning[] {
  const out: ValidatorWarning[] = [];
  const fullText = sf.getFullText();
  const lines = fullText.split("\n");

  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const method = getMutationMethod(call);
    if (!method) continue;
    const callStartLine = call.getStartLineNumber();
    if (hasSuppressDirectiveAbove(lines, callStartLine)) continue;
    if (mutationWhereHasOrgFilter(call)) continue;
    out.push({
      path: repoPath,
      message: `Prisma '${method}' near line ${callStartLine} has no organizationId/orgId in its WHERE clause — scope the where object (audit §10) or annotate '// route-governance: store-mutation-global' if genuinely global`,
    });
  }
  return out;
}

/** True if the call's first-arg object literal has a `where` whose object
 *  literal carries an org key directly, or a relation key whose nested object
 *  literal carries one. Accepts a `where` bound to a same-scope const whose
 *  initializer is a resolvable object literal. Conservative: returns false
 *  when `where` is absent, or built from an unresolvable expression. */
function mutationWhereHasOrgFilter(call: CallExpression): boolean {
  const arg = call.getArguments()[0];
  if (!arg || !Node.isObjectLiteralExpression(arg)) return false;
  const whereProp = arg.getProperty("where");
  const whereObj = resolveWhereObject(whereProp);
  return whereObj ? objectHasOrgKey(whereObj) : false;
}

/** Resolve the `where` value to an object literal. Handles both the inline
 *  `where: { ... }` form and the `where` shorthand / `where: identifier` form
 *  when the identifier resolves to a same-file const with an object-literal
 *  initializer (no cross-file dataflow). */
function resolveWhereObject(
  whereProp: ReturnType<ObjectLiteralExpression["getProperty"]>,
): ObjectLiteralExpression | null {
  if (!whereProp) return null;
  // Inline: `where: { ... }`
  if (Node.isPropertyAssignment(whereProp)) {
    const init = whereProp.getInitializer();
    if (init && Node.isObjectLiteralExpression(init)) return init;
    if (init && Node.isIdentifier(init)) return resolveIdentifierToObjectLiteral(init);
    return null;
  }
  // Shorthand: `where` (a local named `where`)
  if (Node.isShorthandPropertyAssignment(whereProp)) {
    const nameNode = whereProp.getNameNode();
    if (Node.isIdentifier(nameNode)) return resolveIdentifierToObjectLiteral(nameNode);
  }
  return null;
}

function resolveIdentifierToObjectLiteral(id: Node): ObjectLiteralExpression | null {
  if (!Node.isIdentifier(id)) return null;
  for (const decl of id.getSymbol()?.getDeclarations() ?? []) {
    if (Node.isVariableDeclaration(decl)) {
      const init = decl.getInitializer();
      if (init && Node.isObjectLiteralExpression(init)) return init;
    }
  }
  return null;
}

/** Org key directly present, OR any nested object-literal value carries one
 *  (one level of relation nesting: `deployment: { organizationId }`). */
function objectHasOrgKey(obj: ObjectLiteralExpression): boolean {
  for (const prop of obj.getProperties()) {
    if (Node.isPropertyAssignment(prop) || Node.isShorthandPropertyAssignment(prop)) {
      const name = prop.getName();
      if (ORG_KEYS.has(name)) return true;
      if (Node.isPropertyAssignment(prop)) {
        const init = prop.getInitializer();
        if (init && Node.isObjectLiteralExpression(init) && objectHasOrgKey(init)) return true;
      }
    }
  }
  return false;
}
```

Note: shorthand (`{ organizationId }`) and longhand (`{ organizationId: orgId }`) both match via `getName()`. Recursion depth is unbounded but Prisma `where` nesting is shallow; the existing relation patterns are one level.

- [ ] **Step 4: Run → PASS.** Re-run the advisory test command. All cases green.

- [ ] **Step 5: Typecheck `.agent/tools`.** Run the tools typecheck (Task 0 Step 2). Expected: PASS (remove the now-unused `WINDOW_LINES`/`ORG_TOKEN_RX`/`windowHasOrgToken` — an unused const/function would lint-fail).

- [ ] **Step 6: Commit.**
```bash
git add .agent/tools/store-mutation-check.ts .agent/tools/__tests__/store-mutation-check.test.ts
git commit -m "feat(audit): upgrade store-mutation check to AST where-object inspection (PR-4 Task 17 mandate)"
```

---

### Task 2: Re-baseline + triage the store-mutation warnings

**Files:** `packages/db/src/stores/**`, `packages/db/src/storage/prisma-lifecycle-store.ts` (triage-driven — exact set determined by Step 1).

- [ ] **Step 1: Re-run the AST-correct advisory against the full store tree.** Build a one-off invocation feeding `touchedFiles` = the full `packages/db/src/{stores,storage}/**/*.ts` non-test list, e.g.:
```bash
pnpm exec tsx -e '
import { runStoreMutationAdvisory } from "./.agent/tools/store-mutation-check.ts";
import { globSync } from "glob";
const files = globSync("packages/db/src/{stores,storage}/**/*.ts").filter(f => !f.includes("__tests__"));
runStoreMutationAdvisory({ touchedFiles: files, repoRoot: process.cwd() }).then(r => {
  for (const w of r.warnings) console.log(w.path + " :: " + w.message);
  console.log("TOTAL:", r.warnings.length);
});'
```
Record the warning list. The contact-store ×8 and the bulk of the ~26 `storage/**` warnings from the old text-scan baseline should be **gone** (those rows are org-scoped; the text scan over-counted). What remains is the genuinely-unscoped set.

- [ ] **Step 2: Triage each remaining warning per the locked rule (Decision 4).** For each warning, classify:
  - **Local-fixable** (an already-available `organizationId`/`orgId` arg or relation can be added to the `where` with no schema change) → **fix in-PR**. Apply the relevant PR-3 pattern (A: direct column; C: relation filter) — `updateMany`/`deleteMany` with the org-scoped `where`, `if (result.count === 0) throw new StaleVersionError(id, -1, -1);`, `import { StaleVersionError } from "@switchboard/core";`. Add/extend a co-located mock-Prisma test asserting the scoped `where` + `count===0` throw (mirror `packages/db/src/stores/__tests__/prisma-deployment-connection-store.test.ts`). If the mutator gains an org arg, thread it from callers (grep `rg -n "<store>\.<method>\(" apps packages --type ts | grep -v __tests__`).
  - **Migration-needed** (`prisma-creator-identity-store` ×5 + `storage/prisma-lifecycle-store.updateDispatchRecord` ×1, or any other site needing a new `@relation`/schema migration/API-contract change/ambiguous semantics) → **defer**: see Step 3.

- [ ] **Step 3: Suppress the deferred sites with the distinct deferred directive.** Above each deferred Prisma call, use the dedicated `store-mutation-deferred` token (recognised by Task 1 Step 3a) — semantically separate from the genuinely-global `store-mutation-global` exemptions (AgentListing/OutboxEvent/decayStale) so the two categories never conflate:
```ts
// route-governance: store-mutation-deferred — org reachable only via an FK
// with no Prisma @relation to walk; tenant-scoping needs a schema migration.
// Tracked in <follow-up issue #>. See PR-4 plan Decision 3.
```

- [ ] **Step 4: Open the tracked follow-up issue** for the `@relation`-adding migration covering `CreatorIdentity` + `DispatchRecord` (+ any other deferred site). Title e.g. `audit: add @relation for CreatorIdentity.deployment + DispatchRecord lineage to enable tenant-scoping`. Reference it from the Step 3 comments. (If `gh` issue creation is unavailable, record the intended issue body in the PR description and create it at PR-open time.)

- [ ] **Step 5: Re-run the advisory.** Confirm the only remaining warnings are the deferred (annotated) sites — and they are silenced by the directive, so the advisory output is **empty** for the store tree. (If a deferred site's directive is mis-placed, the warning persists — fix placement.)

- [ ] **Step 6: Gate.** `pnpm --filter @switchboard/db test` (minus known advisory-lock flakes) + `pnpm --filter @switchboard/db typecheck`. If any mutator signature changed, **also** `pnpm --filter @switchboard/api test && pnpm --filter @switchboard/chat test` (the store-tightening gate rule). `pnpm reset` first if stale missing-export errors appear.

- [ ] **Step 7: Commit.**
```bash
git add packages/db/src/stores packages/db/src/storage/prisma-lifecycle-store.ts <threaded callers>
git commit -m "fix(db): tenant-scope remaining locally-fixable store mutations + suppress deferred migration sites (audit Round-2, #601)"
```

---

### Task 3: Dynamic `SCHEMAS_EXPORT_NAMES` enumeration (TDD)

**Files:**
- Modify: `.agent/tools/cross-app-types-check.ts`
- Modify: `.agent/tools/__tests__/cross-app-types-check.test.ts`

**Why:** spec §8.6 says the rule flags "a type that matches a `@switchboard/schemas` export." The static 21-name set drifts (PR-2.5 reviewer flagged it). A ts-morph walk of the schemas barrel keeps the matcher honest and broadens coverage; the `local-view-model` directive remains the escape hatch for legitimate narrower local shapes.

- [ ] **Step 1: Write the failing test.** The existing tests construct an in-memory `Project` and call `scanFile`. The dynamic enumeration needs the schemas index, so the entrypoint test feeds a fixture schemas tree. Add:

```ts
import { enumerateSchemaTypeNames } from "../cross-app-types-check.js";

describe("dynamic schema type enumeration", () => {
  it("collects exported interface + type-alias names from the schemas barrel", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile("packages/schemas/src/handoff.ts", `
      export interface Handoff { id: string; }
      export const HandoffSchema = 1; // value export — must be ignored
      export type HandoffStatus = "open" | "closed";
    `);
    project.createSourceFile("packages/schemas/src/index.ts", `
      export * from "./handoff.js";
    `);
    const names = enumerateSchemaTypeNames(project, "packages/schemas/src/index.ts");
    expect(names.has("Handoff")).toBe(true);
    expect(names.has("HandoffStatus")).toBe(true);
    expect(names.has("HandoffSchema")).toBe(false); // value, not a type
  });
});
```

- [ ] **Step 2: Run → FAIL.** `enumerateSchemaTypeNames` not exported.

- [ ] **Step 3: Implement.** Add to `cross-app-types-check.ts`:

```ts
import { Project, Node } from "ts-morph";

/** Walk the schemas barrel's resolved exports; return the set of exported
 *  interface + type-alias names (the cross-app *type* surface). Value exports
 *  (Zod schema consts) are excluded — only their inferred types matter. */
export function enumerateSchemaTypeNames(project: Project, indexRelPath: string): Set<string> {
  const index = project.getSourceFile((sf) => sf.getFilePath().endsWith(indexRelPath));
  if (!index) return new Set();
  const names = new Set<string>();
  for (const [name, decls] of index.getExportedDeclarations()) {
    if (decls.some((d) => Node.isInterfaceDeclaration(d) || Node.isTypeAliasDeclaration(d))) {
      names.add(name);
    }
  }
  return names;
}
```

Then in `runCrossAppTypesAdvisory`, build the set once from the real schemas index and pass it into `scanFile` (replace the module-level `SCHEMAS_EXPORT_NAMES` reference):

```ts
const project = new Project({ useInMemoryFileSystem: false });
const schemaIndexAbs = join(opts.repoRoot, "packages/schemas/src/index.ts");
let schemaNames: Set<string>;
try {
  project.addSourceFilesAtPaths(join(opts.repoRoot, "packages/schemas/src/**/*.ts"));
  schemaNames = enumerateSchemaTypeNames(project, "packages/schemas/src/index.ts");
} catch {
  schemaNames = new Set(); // schemas unreadable — degrade to no-op rather than crash CI
}
// ...scanFile(sf, repoPath, schemaNames) for each in-scope file...
```

Change `scanFile(sf, repoPath)` → `scanFile(sf, repoPath, schemaNames: ReadonlySet<string>)` and use `schemaNames.has(name)` instead of the deleted static set. Delete the `SCHEMAS_EXPORT_NAMES` const + its doc comment.

- [ ] **Step 4: Run → PASS.** Re-run; also confirm the existing `scanFile` tests pass (update their `scanFile` calls to pass a fixture `new Set([...])` of names).

- [ ] **Step 5: Typecheck `.agent/tools`.** PASS.

- [ ] **Step 6: Commit.**
```bash
git add .agent/tools/cross-app-types-check.ts .agent/tools/__tests__/cross-app-types-check.test.ts
git commit -m "feat(audit): enumerate SCHEMAS_EXPORT_NAMES dynamically from schemas barrel"
```

---

### Task 4: Re-baseline + triage the cross-app-types warnings

**Files:** `apps/{api,chat,dashboard}/src/**` (triage-driven).

- [ ] **Step 1: Run the dynamic advisory against the full app tree.**
```bash
pnpm exec tsx -e '
import { runCrossAppTypesAdvisory } from "./.agent/tools/cross-app-types-check.ts";
import { globSync } from "glob";
const files = globSync("apps/{api,chat,dashboard}/src/**/*.{ts,tsx}").filter(f => !f.includes("__tests__"));
runCrossAppTypesAdvisory({ touchedFiles: files, repoRoot: process.cwd() }).then(r => {
  for (const w of r.warnings) console.log(w.path + " :: " + w.message);
  console.log("TOTAL:", r.warnings.length);
});'
```
The broadened (now-dynamic) set will surface collisions the static 21-name set missed.

- [ ] **Step 2: Count the real migrations, then decide split.** Tally the warnings that need a *true-duplicate migration* (not just a directive annotation). **If that count is >~20, split the migrations into a follow-on `PR-4A2`** — keep the validator change (Task 3) **and** the directive annotations for legitimate local-view-models in PR-4A so the warning baseline is clean, but land the bulk app-type migrations as their own reviewable PR. This keeps PR-4A from becoming a mixed validator-refactor-plus-broad-app-migration PR. The flip (4C) only requires the advisory output to be *empty* (every collision either migrated or directive-suppressed) — so PR-4A2, if needed, must merge before 4C, slotting in as 4A → 4A2 → 4B → 4C.

- [ ] **Step 3 (triage each warning):**
  - **True duplicate** of a schemas type → delete the local decl, import from `@switchboard/schemas`. (Confirm shape-identical first; if it diverges, it is a local-view-model.) Migrations beyond the ~20 threshold move to PR-4A2 per Step 2.
  - **Legitimate narrower/different local shape** that happens to share a name (e.g. a Prisma-row type, a view-model) → add `// route-governance: local-view-model` directly above the decl. Optionally rename for clarity (e.g. `ConversationDbRow`) but renaming is not required. **Annotations stay in PR-4A** regardless of the split (they are the clean-baseline work, not migration churn).

- [ ] **Step 4: Re-run → empty.** The app-tree advisory output must be empty (every collision either migrated *in this PR or PR-4A2* or directive-suppressed). If PR-4A2 is in play, the empty baseline is achieved once 4A2 merges — 4A itself lands with the annotations + the validator + a documented residual-migration list.

- [ ] **Step 5: Gate.** `pnpm --filter @switchboard/api typecheck && pnpm --filter @switchboard/chat typecheck && pnpm --filter @switchboard/dashboard typecheck`. For any file whose type was migrated to a schemas import, run that app's tests. `pnpm --filter @switchboard/dashboard build` if a dashboard file changed (`.js`-import + next-build gotcha; build is not in CI).

- [ ] **Step 6: Commit.**
```bash
git add apps/api apps/chat apps/dashboard
git commit -m "refactor(apps): resolve cross-app type duplicates surfaced by dynamic enumeration"
```

---

### Task 5: PR-4A gate

**Files:** none (gate). Open the PR after this passes.

- [ ] **Step 1: Branch sanity.** `git branch --show-current` + `git status --short` — confirm all commits on the 4A branch, no stray files.
- [ ] **Step 2: Full `.agent/tools` test suite + typecheck.** Confirm all advisory tests green.
- [ ] **Step 3: db + api + chat tests** (store-tightening gate rule). PASS minus documented flakes (`prisma-work-trace-store-integrity`/`prisma-ledger-storage`/`prisma-greeting-signal-store` advisory-lock; api `bootstrap-smoke`/`db-sanity` npm-warning).
- [ ] **Step 4: Typecheck closure.** `pnpm --filter @switchboard/db typecheck && pnpm --filter @switchboard/core typecheck && pnpm --filter @switchboard/api typecheck && pnpm --filter @switchboard/chat typecheck`. `pnpm reset` if stale.
- [ ] **Step 5: `pnpm format:check`** (CI runs it; local `pnpm lint` does not). `pnpm format` if needed.
- [ ] **Step 6: Confirm both advisories are still warning-only.** `check-routes.ts` still `process.exit(0)` in `warn-touched`; CI step still `continue-on-error: true`. PR-4A changes **no** enforcement behaviour.
- [ ] **Step 7: Open PR-4A.** Title: `feat(audit): Route Governance Contract v1 — Impl PR-4A (advisory AST upgrade + dynamic enumeration + triage)`. Body: baseline SHA, the AST upgrade, the store + cross-app triage dispositions (what was fixed in-PR vs deferred), and the follow-up issue link.

---

## ── PR-4B: Alias sweep + sub-barrel re-exports ──

### Task 6: Sweep `HandoffPackage` → `Handoff`

**Files:** ~18 consumer files + `packages/core/src/handoff/types.ts` (re-derive exact list in Step 1).

- [ ] **Step 1: Enumerate consumers.** `rg -ln "\bHandoffPackage\b" packages apps | grep -v __tests__` (and a second pass *with* `__tests__` — tests reference it too and must be swept to keep the grep contract clean). Expected ~18 production files + test files.
- [ ] **Step 2: Rename usages.** In each file, replace identifier `HandoffPackage` → `Handoff`. Where a file imports `HandoffPackage` from `@switchboard/core` or `../handoff/types.js`, change the named import to `Handoff` (re-exported from the same module). Do **not** change the file/method/store names — only the type identifier.
- [ ] **Step 3: Update the `HandoffStore` interface** in `packages/core/src/handoff/types.ts` — its `save`/`getById`/`getBySessionId`/`listPending` signatures reference `HandoffPackage`; change to `Handoff`.
- [ ] **Step 4: Delete the alias.** Remove `export type HandoffPackage = Handoff;` (and its comment) from `handoff/types.ts`. Leave `export type ConversationSummary = HandoffConversationSummary;` for Task 7.
- [ ] **Step 5: Typecheck + test.** `pnpm --filter @switchboard/core typecheck && pnpm --filter @switchboard/db typecheck && pnpm --filter @switchboard/api typecheck` + `pnpm --filter @switchboard/core test && pnpm --filter @switchboard/db test`. PASS (mind core flakes). `pnpm reset` if stale.
- [ ] **Step 6: Grep contract.** `rg "\bHandoffPackage\b" packages apps` → 0 production hits (docs/changelog references OK).
- [ ] **Step 7: Commit.**
```bash
git add packages apps
git commit -m "refactor: rename HandoffPackage → Handoff, remove back-compat alias (Route Governance §8.3)"
```

---

### Task 7: Sweep handoff-flavoured `ConversationSummary` → `HandoffConversationSummary`

**Files:** the handoff-flavoured consumers only (`packages/core/src/handoff/{package-assembler.ts,types.ts}`, `packages/core/src/index.ts`, `packages/db/src/stores/handoff-store.ts`; re-derive in Step 1). **Do NOT touch** `apps/api/src/routes/conversations.ts` or `packages/schemas/src/conversations.ts` — those use the *new canonical* `ConversationSummary` (the api projection), which is a different type that legitimately keeps the name.

- [ ] **Step 1: Disambiguate.** `rg -ln "\bConversationSummary\b" packages apps`. For each hit, check the import source: if it resolves to the handoff alias (core `handoff/types.ts` or `@switchboard/schemas`'s `HandoffConversationSummary` re-exported as `ConversationSummary`), it is in scope. If it resolves to `packages/schemas/src/conversations.ts`'s `ConversationSummary` (the api projection), it is **out of scope** — leave it.
- [ ] **Step 2: Rename in-scope usages** `ConversationSummary` → `HandoffConversationSummary`; update imports to the canonical name (re-exported from core `handoff/types.ts` and `@switchboard/schemas`).
- [ ] **Step 3: Delete the alias** `export type ConversationSummary = HandoffConversationSummary;` from `packages/core/src/handoff/types.ts`.
- [ ] **Step 4: Typecheck + test.** Core + db + api typecheck; core + db tests. PASS.
- [ ] **Step 5: Grep contract.** `rg "\bConversationSummary\b" packages/core packages/db` → only the canonical api-projection re-export path remains (no handoff-alias hits). The api route keeps its `ConversationSummary` legitimately.
- [ ] **Step 6: Commit.**
```bash
git add packages
git commit -m "refactor(core): rename handoff ConversationSummary → HandoffConversationSummary, remove alias"
```

---

### Task 8: Sweep `ConversationStateData` → `ConversationState` (chat)

**Files:** `apps/chat/src/conversation/{state.ts,prisma-store.ts,store.ts,threads.ts}` + test.

- [ ] **Step 1: Enumerate.** `rg -ln "\bConversationStateData\b" apps/chat`.
- [ ] **Step 2: Rename usages** → `ConversationState` (imported from `@switchboard/schemas`). The `state.ts` shim currently re-exports / aliases `ConversationStateData` — point consumers at `ConversationState` directly and **delete the alias** in `state.ts`.
- [ ] **Step 3: Typecheck + test.** `pnpm --filter @switchboard/chat typecheck && pnpm --filter @switchboard/chat test`. PASS.
- [ ] **Step 4: Grep contract.** `rg "\bConversationStateData\b" apps/chat` → 0.
- [ ] **Step 5: Commit.**
```bash
git add apps/chat
git commit -m "refactor(chat): rename ConversationStateData → ConversationState, remove shim alias"
```

---

### Task 9: Sweep `DashboardOverview` → `OperatorOverview`

**Files:** `packages/schemas/src/dashboard.ts` + `apps/dashboard/src/app/api/dashboard/overview/route.ts`, `apps/dashboard/src/hooks/use-dashboard-overview.ts`, `apps/dashboard/src/lib/api-client/dashboard.ts`.

- [ ] **Step 1: Enumerate.** `rg -ln "\bDashboardOverview\b" apps packages | grep -v __tests__` (+ a test pass).
- [ ] **Step 2: Rename type usages** `DashboardOverview` → `OperatorOverview` (imported from `@switchboard/schemas`). **Keep** the method `getDashboardOverview`, hook `useDashboardOverview`, and file `use-dashboard-overview.ts` names — only the type renames.
- [ ] **Step 3: Delete the aliases** `export type DashboardOverview = OperatorOverview;` + `export const DashboardOverviewSchema = OperatorOverviewSchema;` from `packages/schemas/src/dashboard.ts`.
- [ ] **Step 4: Typecheck + test + build.** `pnpm --filter @switchboard/schemas typecheck && pnpm --filter @switchboard/dashboard typecheck && pnpm --filter @switchboard/dashboard test && pnpm --filter @switchboard/dashboard build` (next build not in CI; `.js`-import gotcha). PASS.
- [ ] **Step 5: Grep contract.** `rg "\bDashboardOverview\b" apps packages` → 0 production hits.
- [ ] **Step 6: Commit.**
```bash
git add packages/schemas apps/dashboard
git commit -m "refactor: rename DashboardOverview → OperatorOverview, remove back-compat alias (Route Governance §8.4)"
```

---

### Task 10: Add `RouteTemplates` sub-barrel re-exports

**Files:** `packages/core/src/decisions/index.ts`, `packages/core/src/contacts/index.ts`.

- [ ] **Step 1: Confirm the source.** `rg -n "RouteTemplates" packages/core/src/lib/route-templates.ts packages/core/src/index.ts` — confirm `RouteTemplates` is exported (type-only) from `lib/route-templates.ts` and re-exported from the root barrel.
- [ ] **Step 2: Add the re-export** to `packages/core/src/decisions/index.ts`:
```ts
export type { RouteTemplates } from "../lib/route-templates.js";
```
- [ ] **Step 3: Add the same** to `packages/core/src/contacts/index.ts` (adjust the relative path if `contacts/` is one level deeper — verify with `ls packages/core/src/contacts/`; the import is `../lib/route-templates.js` from `contacts/index.ts`).
- [ ] **Step 4: Typecheck.** `pnpm --filter @switchboard/core typecheck`. PASS.
- [ ] **Step 5: Commit.**
```bash
git add packages/core/src/decisions/index.ts packages/core/src/contacts/index.ts
git commit -m "chore(core): re-export RouteTemplates from decisions + contacts sub-barrels"
```

---

### Task 11: PR-4B gate

**Files:** none (gate).

- [ ] **Step 1: Branch sanity.** `git branch --show-current` + `git status --short`.
- [ ] **Step 2: Full grep contract.** `rg "HandoffPackage|ConversationStateData|DashboardOverview" packages apps` → **zero** production references (changelog/spec docs OK). `rg "\bConversationSummary\b" packages/core packages/db` → no handoff-alias hits (api projection name is fine).
- [ ] **Step 3: Full build + test + typecheck.** `pnpm build && pnpm test && pnpm typecheck` → PASS minus documented flakes. `pnpm format:check`.
- [ ] **Step 4: Dashboard build.** `pnpm --filter @switchboard/dashboard build` → PASS.
- [ ] **Step 5: Confirm no validator behaviour change.** `git diff origin/main --stat -- .agent/tools/` → empty (4B touches no advisory code).
- [ ] **Step 6: Open PR-4B.** Title: `refactor: Route Governance Contract v1 — Impl PR-4B (back-compat alias sweep + RouteTemplates re-exports)`. Body: the grep contract result + the four renamed aliases.

---

## ── PR-4C: @route-class backfill + flip to error ──

### Task 12: Add `dashboard-proxy` directory convention to the validator (TDD)

**Files:**
- Modify: `.agent/tools/route-class-validator.ts`
- Modify: `.agent/tools/__tests__/route-class-validator.test.ts`

- [ ] **Step 1: Write failing tests.** Append:

```ts
import { resolveRouteClass } from "../route-class-validator.js";

describe("dashboard-proxy directory convention", () => {
  const proxyPath = "apps/dashboard/src/app/api/dashboard/overview/route.ts";
  const apiPath = "apps/api/src/routes/widgets.ts";

  it("defaults a dashboard app/api route to dashboard-proxy with no header", () => {
    const sf = makeSf(`export async function GET() {}`); // helper in this test file
    expect(resolveRouteClass(sf, proxyPath)).toBe("dashboard-proxy");
  });

  it("lets an explicit header override the dashboard-proxy default", () => {
    const sf = makeSf(`// @route-class: operator-direct\nexport async function POST() {}`);
    expect(resolveRouteClass(sf, proxyPath)).toBe("operator-direct");
  });

  it("returns null (missing header) for a non-dashboard api route with no header", () => {
    const sf = makeSf(`export async function POST() {}`);
    expect(resolveRouteClass(sf, apiPath)).toBeNull();
  });

  it("honors an explicit header on a non-dashboard route", () => {
    const sf = makeSf(`// @route-class: control-plane\nexport async function PUT() {}`);
    expect(resolveRouteClass(sf, apiPath)).toBe("control-plane");
  });
});
```
(Add a `makeSf` helper that creates an in-memory ts-morph source file, mirroring the existing test setup in this file.)

- [ ] **Step 2: Run → FAIL.** `resolveRouteClass` not exported.

- [ ] **Step 3: Implement.** In `route-class-validator.ts`:
```ts
export type RouteClass =
  | "operator-direct"
  | "lifecycle"
  | "control-plane"
  | "ingress-receiver"
  | "read-only"
  | "dashboard-proxy";

const KNOWN_CLASSES: ReadonlySet<RouteClass> = new Set([
  "operator-direct", "lifecycle", "control-plane",
  "ingress-receiver", "read-only", "dashboard-proxy",
]);

const DASHBOARD_PROXY_RX = /^apps\/dashboard\/src\/app\/api\//;

/** Effective class: explicit header wins; else dashboard app/api defaults to
 *  dashboard-proxy; else null (missing header → enforced as an error in
 *  --mode=error). */
export function resolveRouteClass(sf: SourceFile, repoPath: string): RouteClass | null {
  const explicit = parseRouteClass(sf);
  if (explicit) return explicit;
  if (DASHBOARD_PROXY_RX.test(repoPath)) return "dashboard-proxy";
  return null;
}
```
`validateRouteClass` keeps using `parseRouteClass` for the matrix-cell checks (dashboard-proxy has no operator-direct/read-only obligations, so it produces no cell warnings). The **header-presence** enforcement lives in Task 14's error-mode entrypoint via `resolveRouteClass`.

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Typecheck `.agent/tools`.** PASS.
- [ ] **Step 6: Commit.**
```bash
git add .agent/tools/route-class-validator.ts .agent/tools/__tests__/route-class-validator.test.ts
git commit -m "feat(audit): add dashboard-proxy directory convention to route-class validator"
```

---

### Task 13: Backfill `@route-class` headers on ~63 api routes + 3 chat routes

**Files:** `apps/api/src/routes/*.ts` (non-test, un-headered) + `apps/chat/src/routes/*.ts`.

This is classification work, not code logic. Apply spec §1's decision table (first "yes" wins) to each route.

- [ ] **Step 1: List the routes needing headers.**
```bash
comm -23 \
  <(rg -l --type ts "" apps/api/src/routes | grep -v __tests__ | sort) \
  <(rg -l "@route-class" apps/api/src/routes | grep -v __tests__ | sort)
rg -L "@route-class" apps/chat/src/routes -l | grep -v __tests__
```
Expected ~63 api + 3 chat files.

- [ ] **Step 2: Classify each** per spec §1/§2. Reference points from the spec's own examples:
  - **operator-direct:** `dashboard-opportunities.ts`, `recommendations.ts`, `lifecycle-disqualifications.ts`, `admin-consent.ts` (already headered — skip).
  - **lifecycle:** `approvals.ts`, `dlq.ts`, `escalations.ts`.
  - **control-plane:** `governance.ts`, `policies.ts`, `identity.ts`, `organizations.ts`, `agents.ts` (mutating), `connections.ts`, `billing.ts`, `marketplace.ts`, `knowledge.ts`, `knowledge-entries.ts`, `deployment-memory.ts`, `playbook.ts`.
  - **ingress-receiver:** `ad-optimizer.ts`, `meta-deletion.ts`, `managed-webhook.ts`, `whatsapp-onboarding.ts`, `whatsapp-flows.ts`, `facebook-oauth.ts`, `google-calendar-oauth.ts`.
  - **read-only:** `dashboard-overview.ts`, `dashboard-activity.ts`, `dashboard-contacts.ts`, `dashboard-reports.ts`, `health.ts`, `readiness.ts`, `roi.ts`, `whatsapp-send-test.ts` (diagnostic-write, §2.5).
  For routes not in the spec's examples, walk the §1 questions in order; when genuinely ambiguous, prefer the most restrictive applicable class and note the call in the PR body for reviewer confirmation (the warning-mode period already ran — this backfill is the considered classification).
- [ ] **Step 3: Add the header.** Prepend `// @route-class: <class>` as the **first line** of each file (before the first import). For chat routes, same.
- [ ] **Step 4: Run the route-class advisory in warning mode against the backfilled set** to confirm no operator-direct/read-only matrix cell regressions surfaced:
```bash
pnpm exec tsx -e '
import { runRouteClassAdvisory } from "./.agent/tools/check-routes.ts";
import { globSync } from "glob";
const files = [...globSync("apps/api/src/routes/**/*.ts"), ...globSync("apps/chat/src/routes/**/*.ts")].filter(f=>!f.includes("__tests__"));
runRouteClassAdvisory({ repoRoot: process.cwd(), touchedFiles: files }).then(r => { r.warnings.forEach(w=>console.log(w.path+" :: "+w.message)); console.log("TOTAL:", r.warnings.length); });'
```
Triage any operator-direct/read-only warnings (they indicate a route that needs `requireIdempotencyKey`/`requireOrgForMutation` wiring, or a misclassification). For this backfill, if a route is correctly operator-direct but predates the decorator wiring, **either** wire it (if local) **or** reclassify if the §1 table actually points elsewhere — do not leave a known matrix violation that will block the flip.
- [ ] **Step 5: Typecheck (headers are comments — no type impact).** `pnpm --filter @switchboard/api typecheck && pnpm --filter @switchboard/chat typecheck` → PASS.
- [ ] **Step 6: Produce the route classification appendix** (for the PR-4C body). Tally the assigned classes and capture every non-obvious call:
```bash
for c in operator-direct lifecycle control-plane ingress-receiver read-only; do
  printf "%-18s %s\n" "$c:" "$(rg -l "@route-class:\s*$c" apps/api/src/routes apps/chat/src/routes | grep -v __tests__ | wc -l)"
done
echo "dashboard-proxy (by convention): $(rg -lc "" apps/dashboard/src/app/api/**/route.ts* 2>/dev/null | wc -l)"
```
Write a `## Route classification` section listing the per-class counts **and** a bulleted list of any route whose class was non-obvious, each with a one-line §1-decision-table rationale.

- [ ] **Step 7: Commit.**
```bash
git add apps/api/src/routes apps/chat/src/routes
git commit -m "feat(audit): backfill @route-class headers on all api + chat routes (Route Governance §1)"
```

---

### Task 14: Add repo-wide `--mode=error` to `check-routes` (TDD)

**Files:**
- Modify: `.agent/tools/check-routes.ts`
- Create: `.agent/tools/__tests__/check-routes-error-mode.test.ts`

- [ ] **Step 1: Write failing tests.** Test a pure function (not the CLI `process.exit`). Add an exported `runErrorMode({ repoRoot, files })` that returns `{ violations: ValidatorWarning[]; missingHeaders: string[]; exitCode: 0 | 1 }`:

```ts
import { runErrorMode } from "../check-routes.js";
import { writeFileSync, mkdirSync, mkdtempSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";

function fixtureRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "rg-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}

describe("check-routes --mode=error (repo-wide)", () => {
  it("exits 1 when an api route is missing a @route-class header", async () => {
    const root = fixtureRepo({
      "apps/api/src/routes/widgets.ts": `export async function POST() {}`,
    });
    const r = await runErrorMode({ repoRoot: root });
    expect(r.exitCode).toBe(1);
    expect(r.missingHeaders).toContain("apps/api/src/routes/widgets.ts");
  });

  it("exits 0 when a dashboard proxy route has no explicit header (convention covers it)", async () => {
    const root = fixtureRepo({
      "apps/dashboard/src/app/api/dashboard/x/route.ts": `export async function GET() {}`,
    });
    const r = await runErrorMode({ repoRoot: root });
    expect(r.exitCode).toBe(0);
  });

  it("exits 1 on an un-scoped store mutation", async () => {
    const root = fixtureRepo({
      "packages/db/src/stores/x.ts": `export class S { async f(id:string){ await this.prisma.contact.update({ where: { id }, data: {} }); } }`,
    });
    const r = await runErrorMode({ repoRoot: root });
    expect(r.exitCode).toBe(1);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `runErrorMode` not exported.

- [ ] **Step 3: Implement `runErrorMode`.** It globs the in-scope sets repo-wide, runs the three advisories with the full lists, plus header-presence via `resolveRouteClass`:

```ts
import { glob } from "glob";
import { resolveRouteClass } from "./route-class-validator.js";

export interface ErrorModeResult {
  violations: ValidatorWarning[];
  missingHeaders: string[];
  exitCode: 0 | 1;
}

const ROUTE_GLOB_PATTERNS = [
  "apps/api/src/routes/**/*.ts",
  "apps/chat/src/routes/**/*.ts",
  "apps/dashboard/src/app/api/**/route.ts",
  "apps/dashboard/src/app/api/**/route.tsx",
];

export async function runErrorMode(opts: { repoRoot: string }): Promise<ErrorModeResult> {
  const { repoRoot } = opts;
  const rel = (p: string) => relative(repoRoot, p);

  const routeFiles = (
    await Promise.all(
      ROUTE_GLOB_PATTERNS.map((p) => glob(join(repoRoot, p), { absolute: true, nodir: true })),
    )
  ).flat().filter((f) => !f.includes("__tests__")).map(rel);

  const storeFiles = (
    await glob(join(repoRoot, "packages/db/src/{stores,storage}/**/*.ts"), { absolute: true, nodir: true })
  ).filter((f) => !f.includes("__tests__")).map(rel);

  const appTypeFiles = (
    await glob(join(repoRoot, "apps/{api,chat,dashboard}/src/**/*.{ts,tsx}"), { absolute: true, nodir: true })
  ).filter((f) => !f.includes("__tests__")).map(rel);

  // Header-presence: every route file must resolve to a class.
  const project = new Project({ useInMemoryFileSystem: false });
  const missingHeaders: string[] = [];
  for (const repoPath of routeFiles) {
    try {
      const sf = project.addSourceFileAtPath(join(repoRoot, repoPath));
      if (resolveRouteClass(sf, repoPath) === null) missingHeaders.push(repoPath);
    } catch { /* skip unreadable */ }
  }

  const [routeClass, crossAppTypes, storeMutation] = await Promise.all([
    runRouteClassAdvisory({ repoRoot, touchedFiles: routeFiles }),
    runCrossAppTypesAdvisory({ repoRoot, touchedFiles: appTypeFiles }),
    runStoreMutationAdvisory({ repoRoot, touchedFiles: storeFiles }),
  ]);

  const violations = [...routeClass.warnings, ...crossAppTypes.warnings, ...storeMutation.warnings];
  const failed = violations.length > 0 || missingHeaders.length > 0;
  return { violations, missingHeaders, exitCode: failed ? 1 : 0 };
}
```

Then in the `isMain` block add the branch:
```ts
if (mode === "error") {
  const r = await runErrorMode({ repoRoot });
  for (const p of r.missingHeaders) {
    console.error(`::error file=${p}::missing or invalid @route-class header (Route Governance §1)`);
  }
  for (const w of r.violations) {
    console.error(`::error file=${w.path}::${w.message}`);
  }
  console.error(
    `\n${r.violations.length} matrix/type/store violation(s) + ${r.missingHeaders.length} missing header(s).`,
  );
  process.exit(r.exitCode);
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Smoke-test against the real tree.** `pnpm exec tsx .agent/tools/check-routes.ts --mode=error`. Expected exit **0** (after Tasks 1–13: headers backfilled, stores scoped/suppressed, types deduped). If it exits 1, the printed `::error` lines name exactly what the backfill/triage missed — fix before wiring CI.
- [ ] **Step 6: Typecheck `.agent/tools`.** PASS.
- [ ] **Step 7: Commit.**
```bash
git add .agent/tools/check-routes.ts .agent/tools/__tests__/check-routes-error-mode.test.ts
git commit -m "feat(audit): add repo-wide --mode=error to check-routes (header-presence + 3 advisories)"
```

---

### Task 15: Confirm error-mode steady state is green

**Files:** none (gate). This is the go/no-go before wiring CI to block.

- [ ] **Step 1: Run `--mode=error` against the full worktree.** Must exit **0**. If not, the violation list is the punch list — return to Task 2 (store), Task 4 (types), or Task 13 (headers) and close each, then re-run.
- [ ] **Step 2: Record the expected steady state** for the PR body: error mode is green; the deferred store sites are directive-suppressed (Task 2); the lifecycle/control-plane/ingress-receiver matrix cells are intentionally not yet enforced.
- [ ] **Step 3: No commit.**

---

### Task 16: Wire `--mode=error` blocking into CI

**Files:** `.github/workflows/ci.yml`.

- [ ] **Step 1: Add a blocking step** after the existing advisory step (`:317-321`):
```yaml
      - name: Route governance enforcement (Route Governance Contract v1)
        run: pnpm exec tsx .agent/tools/check-routes.ts --mode=error
```
**No `continue-on-error`** — this step blocks merge.

- [ ] **Step 2: Decide the fate of the warn-touched step.** The `warn-touched` advisory (`:317-321`, `continue-on-error: true`) is now redundant with the blocking repo-wide check. **Remove it** to avoid duplicate output — the error mode is strictly stronger. (If you prefer to keep the touched-files advisory for richer PR annotations, leave it; it does not conflict. Default: remove.)

- [ ] **Step 3: Validate the workflow YAML.** `pnpm exec tsx -e 'import {readFileSync} from "fs"; import yaml from "yaml"; yaml.parse(readFileSync(".github/workflows/ci.yml","utf8")); console.log("ok");'` (or `yamllint`/`actionlint` if available). Confirm it parses.

- [ ] **Step 4: Commit.**
```bash
git add .github/workflows/ci.yml
git commit -m "ci(audit): flip route-governance advisories to blocking --mode=error"
```

---

### Task 17: Docs — taxonomy, matrix, crosswalk update

**Files:** `docs/DOCTRINE.md`, `docs/ARCHITECTURE.md`, `docs/superpowers/specs/2026-05-16-route-governance-contract-v1.md`.

- [ ] **Step 1: Add the route taxonomy + per-class matrix to `docs/DOCTRINE.md`.** A "Route Governance" section: the five classes + dashboard-proxy convention, the §3 contract matrix (condensed), and the enforcement statement ("`check-routes --mode=error` blocks CI on missing headers, operator-direct/read-only matrix violations, cross-app type duplicates, and un-scoped store mutations; lifecycle/control-plane/ingress-receiver stricter cells are future tightening"). Cite the spec path.
- [ ] **Step 2: Add the same taxonomy reference to `docs/ARCHITECTURE.md`** (a pointer + the class table; do not duplicate the full matrix — link to DOCTRINE).
- [ ] **Step 3: Update the spec §11 crosswalk.** Mark rows 3.15 + 3.16 as **deferred to follow-up issue #<n>** (the issue from Task 2 / a new one). Add a one-line note under §10 that the `CreatorIdentity` + `DispatchRecord` tenant-scoping awaits the `@relation` migration tracked in the same follow-up.
- [ ] **Step 4: Commit.**
```bash
git add docs/DOCTRINE.md docs/ARCHITECTURE.md docs/superpowers/specs/2026-05-16-route-governance-contract-v1.md
git commit -m "docs(audit): document route taxonomy + per-class matrix; update Cat 3 crosswalk (Route Governance §15)"
```

---

### Task 18: PR-4C end-to-end gate

**Files:** none (gate). Open the PR after this passes.

- [ ] **Step 1: Branch sanity.** `git branch --show-current` + `git status --short`.
- [ ] **Step 2: `--mode=error` exits 0.** `pnpm exec tsx .agent/tools/check-routes.ts --mode=error` → exit 0.
- [ ] **Step 3: Full build + test + typecheck + format.** `pnpm build && pnpm test && pnpm typecheck && pnpm format:check` → PASS minus documented flakes.
- [ ] **Step 4: `.agent/tools` suite.** All advisory + validator tests green.
- [ ] **Step 5: Confirm header coverage.** Re-run Task 13 Step 1 listing → **zero** un-headered non-dashboard routes.
- [ ] **Step 6: Open PR-4C.** Title: `feat(audit): Route Governance Contract v1 — Impl PR-4C (@route-class backfill + flip to error mode)`. Body MUST include: baseline SHA; the **route classification appendix from Task 13 Step 6** (per-class counts + non-obvious-classification rationale); the enforcement coverage (what blocks vs what is deferred per Decision 6); the expected steady state (error mode green, deferred sites suppressed); and links to the Cat 3.15/3.16 + `@relation`-migration follow-up issue(s).

---

## Self-review

**1. Spec coverage (§§8, 10.4, 12, 15).**
- §8.1–8.4 alias relocation residue (back-compat alias removal) → Tasks 6–9 (PR-4B). §8.5 RouteTemplates sub-barrel → Task 10. §8.6 doctrine line is already in DOCTRINE (PR-2.5); the dynamic enumeration that makes "matches a schemas export" honest → Task 3.
- §10.4 bullet 2 (store-mutation check upgraded to inspect the `where`) → Task 1 (AST). The contract's own store sweep was PR-3; PR-4 closes the validator + the deferred-site disposition → Task 2.
- §12 PR-4 envelope: "@route-class headers on remaining routes" → Task 13; "flip check-routes warning→error" → Tasks 14+16; "remove DashboardOverview alias" → Task 9; "document class exceptions" → Task 16 Step 2 + the dashboard-proxy convention (Task 12); "update DOCTRINE + ARCHITECTURE" → Task 17.
- §15 success criteria: (1) every route carries a header / convention → Task 13 + Task 12; (2) check-routes enforces in CI with errors → Tasks 14+16; (5) no cross-app type declared locally → Tasks 3+4; (6) store mutations carry the contract, validated by check-routes → Tasks 1+2; (7) DOCTRINE + ARCHITECTURE document the taxonomy → Task 17. Criteria 3 (operator-direct uniformity) + 4 (Cat 3 crosswalk) are PR-1/2/3 work, surfaced/closed via Task 17's crosswalk update. Criterion 8 (Phase 3B consumes §4+§9) is out of PR-4 scope (future phase).
- **Deliberately deferred (Decision 7):** Cat 3.15, Cat 3.16, the `@relation` migration — tracked follow-up issue, recorded in Task 2 Step 4 + Task 17 Step 3.

**2. Placeholder scan.** Store/type triage tasks (2, 4) hand the implementer a re-baseline command + a decision rule rather than enumerating sites, because the AST-correct baseline cannot be known until Task 1/3 land — that is the load-bearing work, and the disposition rule (Decision 4) is concrete. The header backfill (13) gives the spec's classification examples + the §1 decision procedure for the long tail. `<threaded callers>` / `<follow-up issue #>` in commit/comment lines are deliberately variable — filled from the task's own grep/issue-creation step. All advisory-code tasks (1, 3, 12, 14) carry complete implementations + tests.

**3. Type/name consistency.** `resolveRouteClass` (Task 12) is the name used by Task 14's `runErrorMode`. `enumerateSchemaTypeNames` (Task 3) signature `(project, indexRelPath)` matches its test + call site. `runErrorMode({ repoRoot })` returns `{ violations, missingHeaders, exitCode }` consistently across Task 14's impl + test + Task 15/18 gates. `mutationWhereHasOrgFilter`/`objectHasOrgKey` (Task 1) are internal to `store-mutation-check.ts`; `scanStoreFileForTest` keeps its exported name (tests depend on it). The directive token `store-mutation-global` is unchanged (Task 1 keeps `hasSuppressDirectiveAbove`); only its rationale comment text varies (Task 2).

**Open risks to verify during execution:**
- Task 1 accepts inline object literals **and** same-scope `const where = {...}` (resolved via `resolveIdentifierToObjectLiteral`), so the common `const where = { id, organizationId }; updateMany({ where })` pattern does not force ugly rewrites. A `where` that resolves to neither (param-passed, or built across functions) is still flagged — Task 2's triage catches it (fix-in-PR if local, suppress if it needs refactor). Do not relax the AST rule further to silence dynamic-`where` sites; annotate (`store-mutation-global`/`-deferred`) or inline.
- Task 3's dynamic enumeration broadens the matched name set vs the static 21 — Task 4 is the triage that absorbs the new collisions. **If true-duplicate migrations exceed ~20, split them into PR-4A2** (Task 4 Step 2): the validator + local-view-model annotations stay in 4A; the bulk migrations land as 4A → 4A2 → 4B → 4C. This is the single biggest scope-control lever — do not let 4A become a mixed validator-refactor + broad-app-migration PR.
- Task 13's classification of the long-tail routes is judgement work; the warning-mode period already ran, so reviewers have signal, but flag any non-obvious call in the PR body.

---

## Execution handoff

Plan complete. **Execute one sub-PR at a time, in order 4A → 4B → 4C.** Start with **PR-4A** — it makes the validator trustworthy (the AST upgrade is the hard prerequisite for the flip). Do not bundle the sub-PRs; do not flip to error mode (4C) until 4A's validator is AST-accurate and 4B's aliases are gone.

Within each sub-PR, two execution styles:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks. Verify `git branch --show-current` after each subagent task (subagent dispatches have drifted cwd across worktrees before).

**2. Inline Execution** — execute the sub-PR's tasks in-session via executing-plans with review checkpoints.

Recommended next action: land **this plan** as its own small docs PR to `main` first (CLAUDE.md branch doctrine), then cut the PR-4A worktree from `origin/main`, run Task 0, and start Task 1.
