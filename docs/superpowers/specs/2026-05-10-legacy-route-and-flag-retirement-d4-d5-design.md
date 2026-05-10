# Legacy Route + `useAgentFirstNav` Retirement (Slices D4 + D5) — Design Spec

_2026-05-10 · part of the agent-first redesign track · Phase D, slices 4 + 5 bundled (legacy-route disposition + migration-flag retirement)_

> **Reading posture:** brainstormed 2026-05-10 with the user. Pre-launch state is the load-bearing premise — there are no flag=false production orgs to preserve, so the slice is a clean cut rather than a dual-shell coexistence. Decisions are bound in §2; flip notes preserved so reviewer redirection is cheap.

---

## 1. Problem & scope

### 1.0 One-line scope

Pre-launch cleanup. Delete every legacy-nav route under `apps/dashboard/src/app/(auth)/`, every component / hook used only by those routes, the `OwnerShell` / `OwnerTabs` chrome, and the now-vestigial `OrganizationConfig.useAgentFirstNav` flag. Single PR.

### 1.1 What this slice ships

**Route deletions.** Nine top-level directories under `apps/dashboard/src/app/(auth)/` go away: `dashboard/`, `escalations/`, `decide/`, `tasks/`, `me/`, `my-agent/`, `modules/`, `conversations/`, `deployments/`. The dashboard Next-API proxy `apps/dashboard/src/app/api/dashboard/modules/status/` goes with them.

**Layout chrome deletion.** `OwnerShell`, `OwnerTabs`, and their tests die. `AppShell` collapses from a three-branch model (editorial / chrome-hidden / OwnerShell-default) to a two-branch model (editorial / chrome-hidden) with `/settings` joining the chrome-hidden set.

**Component / hook deletion.** Every component, hook, and lib file whose only consumers are in the deleted route set is deleted. This includes the entire `dashboard/` widget cluster (OwnerToday, OwnerTaskList, RevenueSummary, ActivityFeed, SynergyStrip, RecommendationBar, ModuleCard, ModuleCards), the `decide`/approvals/tasks UI cluster (`approval-card`, `respond-dialog`, `task-card`, `creative-task-card`, `task-review-dialog`, `use-approval-action`, `use-approvals`, `use-escalations`), the escalation list, the modules cluster (`module-detail`, `module-setup-wizard`, `module-state-resolver`, `module-types`, `use-module-status`), and three marketplace components (`channels-section`, `trust-score-badge`, `faq-review-queue`). The exhaustive list is in §4.

**Surviving marketplace cluster.** `work-log-list`, `conversation-transcript`, and `trust-history-chart` stay because the public marketing site (`/(public)/agents/[slug]/profile-tabs.tsx`) still consumes them. `use-marketplace` is audited and pruned (or deleted) based on which exports remain reachable.

**Flag retirement.** `OrganizationConfig.useAgentFirstNav` is dropped via Prisma migration. All five code references (schema, seed, dashboard provisioner, API route, two test files) go in the same PR. The "create-only invariant" guardrail (`api-organizations-flag-safety.test.ts`) is deleted entirely — the invariant becomes meaningless once the column is gone.

**Internal href cleanups.** Two surviving files link to deleted routes: `not-found.tsx:9` (`/dashboard` → `/`) and `landing-nav.tsx:99,246` (`/me` → `/settings/account`).

**Middleware cleanup.** `apps/dashboard/src/middleware.ts` drops the deleted route names from both the auth allowlist (line 24-ish) and the matcher config (line 129-ish).

**Test cleanups.** All `__tests__/` files alongside deleted code go with the code they cover. `AppShell` test is updated to assert the two-branch shape. `api-organizations.test.ts` drops the Slice A PR 2 round-trip case (rest of file stays). `api-organizations-flag-safety.test.ts` is deleted.

### 1.2 What this slice does **not** ship

- **Backend API endpoint deletion.** `/api/escalations`, `/api/marketplace/*`, `/api/conversations`, `/api/deployments`, etc. keep running with no dashboard consumer. The roadmap (`2026-05-03-agent-first-redesign-roadmap.md` §5 Track #10) explicitly defers backend cleanup until consumer removal lands. Backend deletion is its own future slice; this spec does **not** touch `apps/api/src/routes/` outside of the one-line `useAgentFirstNav` removal in `organizations.ts` and the two test edits.
- **Editorial-shell Tools nav.** Adding `Contacts / Automations / Reports / Settings` links to `editorial-auth-shell.tsx` is a separate concern (the roadmap calls it "Editorial-header expansion is a Phase D wrap-up after D1/D2/D3 all ship"). After this slice, a user on `/` or `/alex` has no in-shell affordance to reach Tools-tier surfaces — they must type the URL. This gap is real and is recorded in §8.
- **D3 (`/activity` Mercury surface).** Separate slice, not bundled here.
- **`/operator/*` admin subtree.** Untouched. Already in `CHROME_HIDDEN_PATHS` and orthogonal to the legacy-nav era.
- **Backfill migration to set `useAgentFirstNav=true` on existing orgs.** The flag column is dropped outright; there is nothing to flip first.
- **Dual-shell coexistence behind the flag.** The originally-planned D5 work (wiring `useAgentFirstNav` into `AppShell` to branch nav style per org) is moot now and explicitly cancelled.

### 1.3 Why this surface, why now

Three forces converge:

1. **Pre-launch is the cheapest moment to cut.** The user confirmed during brainstorming: "we haven't launched yet so all previous don't need redirect, can just opt for deletion." There are no production orgs to preserve at flag=false, no migration story to author, no cross-shell UX coexistence to design. Every day the legacy routes stay alive is a day of dead-code maintenance debt accruing for zero user benefit.
2. **The agent-first redesign now covers the legacy surface area.** Slice B (agent homes), C1 (Inbox drawer), C2 (live signal overlay + console retirement), and the contacts/automations/reports Mercury triplet have all landed on `main` between 2026-05-04 and 2026-05-09. Every legacy route in the disposition matrix has a documented editorial-or-Mercury successor (or, for the orphan routes `/conversations`, `/modules`, `/deployments/[id]`, an explicit "no successor; delete" decision per §2).
3. **The `useAgentFirstNav` flag was scaffolding for a coexistence we're no longer building.** The flag was added in Slice A PR 2 to gate a future agent-first vs. legacy nav split. The user chose to retire the flag in this same slice rather than leave a vestigial column behind. Doing it now keeps the schema honest; doing it later means a second migration and a second round of test updates.

### 1.4 Out-of-scope decisions inherited from prior specs

These are **already locked** elsewhere and not re-debated here:

- Two-register split — Editorial for agent homes, Mercury for Tools tier (`memory/project_two_register_design.md`; `2026-05-03-agent-first-redesign-roadmap.md` §3).
- Surface-agnostic backend rule (`memory/feedback_surface_agnostic_backend.md`). Backend route files are untouched in this slice.
- Prisma agent-friendly migration path (`memory/feedback_prisma_migrate_dev_tty.md`): use `migrate diff --from-url --to-schema-datamodel --script` then `migrate deploy`, not `migrate dev`.
- The `EDITORIAL_SHELL_PATHS` set in `app-shell.tsx` (`/`, `/alex`, `/riley`) — not changing membership in this slice.
- The Inbox drawer (C1) is the canonical replacement for `/decide` and `/escalations`. Per-agent Needs You blocks (B2) are the per-agent surface for the same data.

---

## 2. Decisions

### 2.0 Decisions ledger

| #   | Question                                                                          | Locked answer                                                                                                                                                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Slice shape                                                                       | **D4 + D5 bundled in one spec, one PR.** Disposition + flag retirement are tightly coupled; splitting them creates a vestigial-column intermediate state.                                                                                                                                                                                          |
| 2   | Treatment of existing flag=false orgs                                             | **No backfill, no preservation.** Pre-launch posture means no production orgs to preserve. Legacy routes are deleted outright; flag column is dropped outright.                                                                                                                                                                                    |
| 3   | Fate of `useAgentFirstNav` flag                                                   | **Retire in this same slice.** Drop the Prisma column, remove all five code references, delete the `api-organizations-flag-safety.test.ts` guardrail, drop the round-trip case from `api-organizations.test.ts`.                                                                                                                                   |
| 4   | Disposition for orphan routes (`/conversations`, `/modules`, `/deployments/[id]`) | **Delete.** No editorial successor today, but pre-launch state means no operator workflow to break. Future Tools surfaces (e.g., `/conversations` as a Mercury list, drill-downs from `/contacts/[id]`) are separate decisions.                                                                                                                    |
| 5   | PR shape                                                                          | **Single PR.** Mostly deletions; review well as a coordinated cut. Splitting into 2–3 PRs would leave half-broken intermediate states (e.g., flag column without consumer; OwnerShell rendering deleted routes).                                                                                                                                   |
| 6   | `/settings` after OwnerShell deletion                                             | **`/settings` joins `CHROME_HIDDEN_PATHS`.** It already has its own `layout.tsx`. AppShell collapses to a two-branch model (editorial / chrome-hidden). No third "default app shell" branch survives.                                                                                                                                              |
| 7   | Editorial-shell Tools nav additions in this slice                                 | **No.** Out of scope. Recorded as known UX gap (§8); operator can reach Tools surfaces by URL. Adding nav links is the editorial-header expansion follow-up the roadmap already tracks.                                                                                                                                                            |
| 8   | Backend API endpoint deletion in this slice                                       | **No.** Roadmap Track #10 owns that follow-up. Spec records this explicitly so reviewers don't ask why the API didn't shrink.                                                                                                                                                                                                                      |
| 9   | Marketplace cluster retention rule                                                | **Per-component grep, not "delete the whole directory."** `work-log-list`, `conversation-transcript`, `trust-history-chart` survive (consumed by `(public)/agents/[slug]/profile-tabs.tsx`). `channels-section`, `trust-score-badge`, `faq-review-queue` die. `use-marketplace` is audited at implementation time and pruned to surviving exports. |
| 10  | Migration mechanics                                                               | **`migrate diff --from-url --to-schema-datamodel --script` then `migrate deploy`.** Per `feedback_prisma_migrate_dev_tty.md` — `migrate dev` blocks on a TTY prompt in agent sessions even with `--create-only`.                                                                                                                                   |

### 2.1 Decisions explicitly considered and rejected

| Rejected option                                                                                                                | Why rejected                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Honor the create-only invariant; keep legacy routes alive for flag=false orgs indefinitely.                                    | Pre-launch state means there are no production flag=false orgs to honor. The invariant only matters if real users are bound to a particular shell.                                                                                                                           |
| Add a one-time backfill migration to flip all orgs to `useAgentFirstNav=true`, then delete legacy code.                        | Migration adds risk and maintenance for zero benefit when the column is also being dropped.                                                                                                                                                                                  |
| Delete legacy routes but keep the `useAgentFirstNav` column "for safety" / "in case we need to bring back a flag-gated split." | YAGNI. Vestigial schema columns rot. If a future need to gate a nav split emerges, a fresh flag with a real semantic name will serve better than reanimating a dead one.                                                                                                     |
| Three PRs: legacy routes → AppShell simplification → flag drop.                                                                | Smaller diffs, but each intermediate state has a different broken-ness (e.g., PR-1 leaves OwnerShell rendering 404 routes; PR-2 leaves a dead column; PR-3 finally clean). For a pre-launch delete, the single coordinated cut reviews more honestly than three half-states. |
| Redirect-to-`/` from each deleted route instead of true deletion.                                                              | Adds `redirect()` shim files that have to be maintained, type-checked, and eventually deleted. True 404 (Next.js default behavior for missing pages) is the right semantic — these routes are gone, not relocated.                                                           |
| Bundle the editorial-shell Tools nav additions into this slice.                                                                | Different concern (UX addition vs. cleanup), different design ownership (header IA vs. delete inventory), different review reflexes. Conflating them risks both being half-done.                                                                                             |

### 2.2 Reviewer redirect notes (one-paragraph flips)

If a reviewer pushes back on **single-PR** in §2 #5: "Splitting D4+D5 means publishing a Prisma migration that drops a column whose code references still exist in the same branch (PR-1) — that's a temporarily-broken main between merges. The single PR avoids that."

If a reviewer pushes back on **delete-without-redirect** in §2 #4 / rejected-options: "A 404 from `/me` after this PR is a stronger signal than a `redirect("/settings")` shim: the route is gone, not relocated. We're not preserving any deep links from email or external integrations because there are no production users."

If a reviewer pushes back on **/settings into CHROME_HIDDEN_PATHS** in §2 #6: "A third `default app shell` branch in `AppShell` for exactly one route is premature abstraction. `/settings` already owns its own `layout.tsx`. If a future surface wants the old wrapping behavior, we can resurrect a branch then with a clear consumer in mind."

---

## 3. Disposition matrix

Every legacy route in the (auth) tree, with its disposition (under flag=true and flag=false alike — they collapse to the same answer once the flag is gone):

| Route                                               | Disposition | Successor / why                                                                                                            |
| --------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| `/dashboard/page.tsx`                               | **Delete**  | `OwnerToday` widget; replaced by `/` (Owner Home placeholder) and per-agent `/[agentKey]` editorial homes.                 |
| `/dashboard/roi/page.tsx`                           | **Delete**  | ROI surface absorbed by `/reports`.                                                                                        |
| `/escalations/page.tsx`                             | **Delete**  | Folded into Inbox drawer (C1) + per-agent Needs You blocks (B2).                                                           |
| `/decide/page.tsx`                                  | **Delete**  | 335-line approvals + tasks page; superseded by `useDecisionFeed` + `DecisionCard` surfaced in Inbox drawer + Needs You.    |
| `/decide/[id]/page.tsx`                             | **Delete**  | Decision detail now lives inside the Inbox drawer interaction.                                                             |
| `/tasks/page.tsx`                                   | **Delete**  | Currently a 5-line `redirect("/decide")`. Both target and source go.                                                       |
| `/me/page.tsx`                                      | **Delete**  | Profile/theme/sign-out (119 lines). `/settings` already has account/billing/team/identity/playbook/channels/knowledge.     |
| `/my-agent/page.tsx`                                | **Delete**  | Pre-launch redirector to `/my-agent/[id]`.                                                                                 |
| `/my-agent/[id]/page.tsx` (+ `my-agent-client.tsx`) | **Delete**  | Replaced by `/[agentKey]` editorial agent home.                                                                            |
| `/modules/page.tsx`                                 | **Delete**  | Module install index. No editorial-era equivalent.                                                                         |
| `/modules/[module]/page.tsx`                        | **Delete**  | Module detail. No editorial-era equivalent.                                                                                |
| `/modules/[module]/setup/page.tsx`                  | **Delete**  | Module setup wizard. Onboarding now lives in `/onboarding` and `/setup`.                                                   |
| `/modules/creative/page.tsx`                        | **Delete**  | Creative module page. No editorial-era equivalent.                                                                         |
| `/conversations/page.tsx`                           | **Delete**  | No incoming hrefs from surviving code; only reachable via `OwnerTabs`. Future drill-down lives elsewhere (e.g., contacts). |
| `/deployments/[id]/page.tsx` (+ client)             | **Delete**  | Admin-ish detail page. No editorial replacement.                                                                           |
| `/api/dashboard/modules/status/route.ts`            | **Delete**  | Next-API proxy for module status; only consumer is `use-module-status`, which dies with `/modules`.                        |

**Routes that stay (not in scope but listed for completeness):**
`/`, `/[agentKey]`, `/contacts`, `/contacts/[id]`, `/automations`, `/reports`, `/settings/*`, `/onboarding`, `/setup`, `/operator/*`, `/login`, `/post-auth`, plus all `/api/*` routes outside the modules/status proxy above.

---

## 4. Delete inventory

**Policy:** delete every file whose only consumers are in the deleted route set. Keep anything with at least one consumer outside the deleted set — primarily the public marketing site under `apps/dashboard/src/app/(public)/*`, plus `/settings` and `/operator`.

The implementation plan re-runs each per-file `grep` immediately before deletion (not just at spec time), in case new consumers land on `main` between this spec and the PR. `pnpm typecheck` is the safety net for any static-import survivors missed by grep.

### 4.1 Routes (whole directories)

```
apps/dashboard/src/app/(auth)/dashboard/
apps/dashboard/src/app/(auth)/escalations/
apps/dashboard/src/app/(auth)/decide/
apps/dashboard/src/app/(auth)/tasks/
apps/dashboard/src/app/(auth)/me/
apps/dashboard/src/app/(auth)/my-agent/
apps/dashboard/src/app/(auth)/modules/
apps/dashboard/src/app/(auth)/conversations/
apps/dashboard/src/app/(auth)/deployments/
apps/dashboard/src/app/api/dashboard/modules/status/
```

### 4.2 Layout chrome

```
apps/dashboard/src/components/layout/owner-shell.tsx
apps/dashboard/src/components/layout/owner-tabs.tsx
apps/dashboard/src/components/layout/__tests__/owner-tabs.test.tsx
```

### 4.3 Dashboard widgets (only consumed by `/dashboard`)

```
apps/dashboard/src/components/dashboard/owner-today.tsx
apps/dashboard/src/components/dashboard/owner-task-list.tsx
apps/dashboard/src/components/dashboard/revenue-summary.tsx
apps/dashboard/src/components/dashboard/activity-feed.tsx
apps/dashboard/src/components/dashboard/synergy-strip.tsx
apps/dashboard/src/components/dashboard/recommendation-bar.tsx
apps/dashboard/src/components/dashboard/module-card.tsx
apps/dashboard/src/components/dashboard/module-cards.tsx
```

The implementation plan also greps the rest of `apps/dashboard/src/components/dashboard/` to find anything else only consumed by deleted code, and any tests under `apps/dashboard/src/components/dashboard/__tests__/`.

### 4.4 Decide / approvals / tasks UI

```
apps/dashboard/src/components/approvals/approval-card.tsx
apps/dashboard/src/components/approvals/respond-dialog.tsx
apps/dashboard/src/components/tasks/task-card.tsx
apps/dashboard/src/components/tasks/creative-task-card.tsx
apps/dashboard/src/components/tasks/task-review-dialog.tsx
apps/dashboard/src/hooks/use-approval-action.ts
apps/dashboard/src/hooks/use-approvals.ts
apps/dashboard/src/hooks/__tests__/use-approvals.test.ts
apps/dashboard/src/hooks/use-escalations.ts
```

The implementation plan audits `apps/dashboard/src/components/approvals/` and `apps/dashboard/src/components/tasks/` directories exhaustively (more files may be present and only-consumed-by-deleted-code), plus `apps/dashboard/src/lib/approval-constants.ts` and any companion files.

### 4.5 Escalations

```
apps/dashboard/src/components/escalations/escalation-list.tsx
apps/dashboard/src/components/escalations/__tests__/  (whole directory)
```

### 4.6 Modules cluster

No surviving consumer for any of these — the entire module state-machine dies.

```
apps/dashboard/src/components/modules/module-detail.tsx
apps/dashboard/src/components/modules/module-setup-wizard.tsx
apps/dashboard/src/lib/module-state-resolver.ts
apps/dashboard/src/lib/module-types.ts
apps/dashboard/src/hooks/use-module-status.ts
```

The implementation plan greps `apps/dashboard/src/components/modules/` for any companion files and deletes them too.

### 4.7 Marketplace cluster (mixed survival)

| File                                                 | Verdict                   | Reason                                                                                                                                                                                            |
| ---------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/marketplace/work-log-list.tsx`           | **Stay**                  | Consumed by `apps/dashboard/src/app/(public)/agents/[slug]/profile-tabs.tsx`.                                                                                                                     |
| `components/marketplace/conversation-transcript.tsx` | **Stay**                  | Transitively consumed via `work-log-list`.                                                                                                                                                        |
| `components/marketplace/trust-history-chart.tsx`     | **Stay**                  | Consumed by `(public)/agents/[slug]/profile-tabs.tsx`.                                                                                                                                            |
| `components/marketplace/channels-section.tsx`        | **Delete**                | Only consumers (`my-agent-client`, `deployment-detail-client`, `module-detail`) all die.                                                                                                          |
| `components/marketplace/trust-score-badge.tsx`       | **Delete**                | Only consumers are deleted.                                                                                                                                                                       |
| `components/marketplace/faq-review-queue.tsx`        | **Delete**                | Only consumer was `/deployments/[id]`.                                                                                                                                                            |
| `hooks/use-marketplace.ts`                           | **Audit + likely delete** | After deletions, all `useTasks`/`useReviewTask` consumers die. If `work-log-list` (the public-site survivor) imports any export from this file, prune to the surviving exports; otherwise delete. |
| `hooks/use-conversations.ts`                         | **Delete**                | Only consumer was `/conversations`.                                                                                                                                                               |
| `hooks/use-conversation-override.ts`                 | **Delete**                | Only consumer was `/conversations`.                                                                                                                                                               |

### 4.8 Survives explicitly (heads-up for the implementer)

These look like they might be in the delete set but are kept:

- `lib/sign-out.ts` — re-target landing-nav reference from `/me` to `/settings/account` (or wherever sign-out actually lives in `/settings/*`); audit during plan-writing.
- `hooks/use-theme.ts` — kept; consumed by `/settings/account/page.tsx`.
- `components/team/agent-icons.ts` (exporting `AGENT_ICONS`) — kept; consumed by `/settings/team/page.tsx` and `components/team/agent-card.tsx` and `components/team/agent-config-identity.tsx`.
- The whole `apps/dashboard/src/app/(public)/*` subtree — untouched.
- `(auth)/operator/*` subtree — untouched (admin tooling, orthogonal to this slice).
- `apps/api/src/routes/escalations.ts`, `marketplace.ts`, `conversations.ts`, etc. — untouched (backend cleanup is its own slice).

---

## 5. AppShell post-deletion shape

The current three-branch AppShell (`apps/dashboard/src/components/layout/app-shell.tsx`) collapses to two branches.

### 5.1 Final shape

```ts
const EDITORIAL_SHELL_PATHS = new Set(["/", "/alex", "/riley"]);

const CHROME_HIDDEN_PATHS = [
  "/login",
  "/onboarding",
  "/setup",
  "/contacts",
  "/automations",
  "/reports",
  "/settings",
  "/operator/reports",
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const usesEditorialShell = EDITORIAL_SHELL_PATHS.has(pathname);
  const isChromeHidden = CHROME_HIDDEN_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );

  const { data: orgData, isLoading: orgLoading } = useOrgConfig(
    !isChromeHidden && !usesEditorialShell,
  );

  const onboardingComplete = orgData?.config?.onboardingComplete ?? true;
  const isSetupPath = pathname === "/setup" || pathname.startsWith("/setup/");
  const isLoginPath = pathname === "/login";

  useEffect(() => {
    if (!usesEditorialShell && !orgLoading && !onboardingComplete && !isSetupPath && !isLoginPath) {
      router.replace("/onboarding");
    }
  }, [usesEditorialShell, orgLoading, onboardingComplete, isSetupPath, isLoginPath, router]);

  if (usesEditorialShell) {
    return (
      <>
        {children}
        <DevPanel />
      </>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      {children}
      <DevPanel />
    </main>
  );
}
```

Differences from the current AppShell:

- `OwnerShell` import and the third `return <OwnerShell>` branch are deleted.
- `CHROME_HIDDEN_PATHS` gains `/contacts`, `/automations`, `/settings` (the previously implicit defaults).
- The `isChromeHidden` flag becomes the only "anything that isn't editorial" gate; the file shrinks from ~80 lines to ~30.
- `useOrgConfig` and the onboarding-redirect effect are preserved as-is — they're orthogonal to chrome shape.

### 5.2 `/settings` confirmation

`apps/dashboard/src/app/(auth)/settings/layout.tsx` already exists (per the file listing) and owns its own page chrome. Implementation plan confirms during plan-writing that this layout renders the necessary back-link / sub-nav so that joining `CHROME_HIDDEN_PATHS` doesn't leave settings users stranded. If the existing `layout.tsx` lacks any chrome that `OwnerShell` was providing (e.g., a content-width wrapper), the plan adds it inside `settings/layout.tsx` rather than in `AppShell`.

### 5.3 Test update for `AppShell`

The existing `__tests__/app-shell.test.tsx` (or equivalent) is updated to assert:

- Editorial paths render children directly (no wrapper `<main>`).
- `/contacts`, `/automations`, `/reports`, `/settings`, `/onboarding`, `/setup`, `/login`, `/operator/reports` render with the bare `<main>` wrapper and no OwnerShell.
- Any pre-existing assertion about `OwnerShell` or `OwnerTabs` rendering is dropped.
- Onboarding-redirect behavior is unchanged.

---

## 6. Flag retirement (`useAgentFirstNav`)

### 6.1 Touched files

| Location                                                                       | Action                                                                                                                                                                              |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/prisma/schema.prisma:431` (`OrganizationConfig.useAgentFirstNav`) | Drop the column. New migration generated with the agent-friendly two-step pattern from `feedback_prisma_migrate_dev_tty.md` (see §6.3 below for the exact commands).                |
| `packages/db/prisma/seed.ts:82`                                                | Drop `useAgentFirstNav: true` from the `OrganizationConfig.create({...})` call. Re-run `pnpm db:generate` after migration.                                                          |
| `apps/dashboard/src/lib/provision-dashboard-user.ts:36`                        | Drop `useAgentFirstNav: true` from the upsert payload.                                                                                                                              |
| `apps/api/src/routes/organizations.ts:72`                                      | Drop `useAgentFirstNav: true` from the `create` branch of the upsert. The `update` branch already does not pass the field.                                                          |
| `apps/api/src/__tests__/api-organizations-flag-safety.test.ts`                 | **Delete entire file.** The "create-only invariant" guardrail becomes meaningless once the column is gone; deleting the test is more honest than leaving an empty `describe` block. |
| `apps/api/src/__tests__/api-organizations.test.ts:228-266`                     | Drop the "Slice A PR 2: lazy-create branch sets useAgentFirstNav=true" `it()` block entirely. The other test cases in the file stay.                                                |

### 6.2 Migration safety

- The migration is **forward-only**. There is no rollback story authored. Pre-launch posture (no production data) makes that acceptable; the spec records it explicitly so the implementation plan does not waste effort preserving the column "just in case."
- Use `migrate diff` + `migrate deploy` per `feedback_prisma_migrate_dev_tty.md`. `prisma migrate dev` blocks on a TTY warning prompt in agent sessions even with `--create-only`, which prevents the migration from being authored cleanly inside a Claude Code session.
- After the migration runs, `pnpm reset` cleans `dist/`, regenerates the Prisma client, and rebuilds schemas / db / core in dependency order. This must happen before `pnpm typecheck` runs reliably.

### 6.3 Migration command (concrete)

Per `feedback_prisma_migrate_dev_tty.md`, the agent-friendly two-step pattern, run from the repo root:

```bash
TS=$(date -u +%Y%m%d%H%M%S)
MIGDIR="packages/db/prisma/migrations/${TS}_drop_organization_config_use_agent_first_nav"
mkdir -p "$MIGDIR"

DATABASE_URL="$(awk -F= '/^DATABASE_URL=/ { sub(/^DATABASE_URL=/, ""); print; exit }' .env | tr -d '"')"

(cd packages/db && pnpm exec prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script) > "$MIGDIR/migration.sql"

(cd packages/db && DATABASE_URL="$DATABASE_URL" pnpm exec prisma migrate deploy)

pnpm db:check-drift
pnpm db:generate
```

Expected `migration.sql` content (single statement):

```sql
ALTER TABLE "OrganizationConfig" DROP COLUMN "useAgentFirstNav";
```

After `pnpm db:generate`, run `pnpm reset` from the repo root to rebuild the dependency chain (schemas → core → db → apps) before `pnpm typecheck`. Skipping `pnpm reset` produces stale-artifact false alarms (per CLAUDE.md).

### 6.4 What does **not** need touching

- The dashboard's `useOrgConfig` hook does not read `useAgentFirstNav` (verified via grep — only `apps/api` and `apps/dashboard/src/lib/provision-dashboard-user.ts` reference it). No client-side cleanup needed beyond the provisioner.
- No frontend feature flag or env var reads the column. There is no UI-level flag to retire.

---

## 7. Surviving-code href / link cleanups

Greps from §4 found exactly two surviving files that link to deleted routes:

| File                                                           | Current             | New                        |
| -------------------------------------------------------------- | ------------------- | -------------------------- |
| `apps/dashboard/src/app/not-found.tsx:9`                       | `href="/dashboard"` | `href="/"`                 |
| `apps/dashboard/src/components/landing/landing-nav.tsx:99,246` | `href="/me"`        | `href="/settings/account"` |

The implementation plan re-runs `grep -rn 'href="/(dashboard\|escalations\|decide\|tasks\|me\|my-agent\|modules\|conversations\|deployments)' apps/dashboard/src` against post-deletion state to catch anything new that landed on `main` between this spec and the PR.

`apps/dashboard/src/middleware.ts` also has the deleted route names in its auth allowlist (line 24-ish: `"/decide", "/me", "/my-agent", "/tasks", "/modules", "/escalations", "/conversations"`) and matcher config (line 129-ish). Both go.

---

## 8. Known UX gap (recorded, deferred)

After this slice ships:

- A user landing on `/` or `/alex` has no in-shell affordance to reach `/contacts`, `/automations`, `/reports`, or `/settings`. They must type the URL directly.
- This is a real gap, but it is **not a regression introduced by this slice** — those Tools links were never wired into the editorial shell. The `editorial-auth-shell.tsx` brand-nav has only `Home` + agent links today.
- Adding Tools nav links is the editorial-header expansion follow-up the roadmap (`2026-05-03-agent-first-redesign-roadmap.md` §4 Phase D wrap-up bullet) already tracks as a separate Phase D concern, ordered after D1/D2/D3 ship.

This callout is for reviewers: do not expect Tools nav inside this PR.

---

## 9. Test plan

| Layer                                    | Action                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Component / route tests for deleted code | Delete the corresponding `__tests__/` files alongside the code they cover. (e.g. `components/escalations/__tests__/`, `hooks/__tests__/use-approvals.test.ts`, `components/layout/__tests__/owner-tabs.test.tsx`, any `(auth)/decide/__tests__/`, etc.)                                                |
| `AppShell` test                          | Update to assert two-branch shape per §5.3. Drop any `OwnerShell` / `OwnerTabs` references.                                                                                                                                                                                                            |
| `api-organizations.test.ts`              | Drop the Slice A PR 2 `useAgentFirstNav` round-trip case. Other cases unchanged.                                                                                                                                                                                                                       |
| `api-organizations-flag-safety.test.ts`  | Delete entire file.                                                                                                                                                                                                                                                                                    |
| Inbox drawer + decision feed tests       | No changes — they don't reference deleted code, and the surface they cover is the canonical replacement for `/decide` and `/escalations`.                                                                                                                                                              |
| E2E / integration specs                  | Audit any e2e specs that visit deleted routes; re-target to surviving routes (`/`, `/alex`, etc.) or delete if obsolete. The implementation plan includes a `grep -rn "/dashboard\|/decide\|/me\|/my-agent\|/modules\|/escalations\|/conversations\|/deployments" apps/dashboard/src/__tests__` check. |
| Validation gates                         | `pnpm reset && pnpm typecheck && pnpm lint && pnpm test`. Smoke (manual): `pnpm dev` and verify `/`, `/alex`, `/riley`, `/contacts`, `/automations`, `/reports`, `/settings`, `/setup`, `/onboarding`, `/operator/reports` all render with no 404 and no missing-import errors.                        |

---

## 10. Risks and mitigations

| Risk                                                                                                                                                                                  | Mitigation                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A component marked "delete" turns out to have a surviving consumer not caught by static grep (dynamic import, lazy load, string-keyed component lookup).                              | Implementation plan re-runs per-file grep immediately before delete. `pnpm typecheck` catches all static-import survivors. `pnpm test` catches anything else. If a consumer does survive, restore that file and re-classify.                                                          |
| Prisma column drop fails locally because of stale seed data or a running session holding the column.                                                                                  | Spec records the documented agent-friendly path: `migrate diff` → `migrate deploy`. `pnpm reset` after the migration regenerates Prisma client and rebuilds the dependency chain (schemas → core → db → apps).                                                                        |
| `OperatorChatWidget` (rendered by `(auth)/layout.tsx`) depends on something in the deleted set.                                                                                       | Quick audit during plan-writing: grep its imports. Component lives at `apps/dashboard/src/components/operator-chat/`; expected to be self-contained, but verify.                                                                                                                      |
| `/settings` becomes unreachable or visually broken after joining `CHROME_HIDDEN_PATHS` because its `layout.tsx` did not own all the chrome that `OwnerShell` was providing.           | Plan-writing audits `apps/dashboard/src/app/(auth)/settings/layout.tsx`. If chrome is missing, the plan adds it inside `settings/layout.tsx` (not in AppShell). Smoke test verifies visually.                                                                                         |
| Backend API endpoints (`/api/escalations`, `/api/marketplace/*`, `/api/conversations`, `/api/deployments`) keep running with no consumer; some have integration tests that may break. | Intentional — out of scope per §1.2 and §2 #8. Spec records this so reviewers don't ask why the API didn't shrink. Backend cleanup is a separate slice owned by roadmap Track #10. Existing API integration tests stay green because the API code is unchanged.                       |
| A hidden lint or commitlint rule complains about the size of the diff (>600 lines per file rule, etc.).                                                                               | Most of the diff is whole-file deletes, which don't trigger per-file size rules. If a remaining file approaches the 600-line error threshold or 400-line warn threshold (CLAUDE.md), the implementation plan splits it independently rather than bundling refactor into this slice.   |
| The `(public)/agents/[slug]/profile-tabs.tsx` consumer of `work-log-list` / `trust-history-chart` is itself unreachable in some routing config we forgot.                             | Verify during plan-writing that `(public)/agents/[slug]/page.tsx` is reachable in current routing. If the entire `(public)/agents/*` tree is also dead (it shouldn't be — it's the public marketing site), the survival rule for those marketplace components changes (they die too). |
| A test fails for a non-obvious reason (e.g., a snapshot test of a deleted route).                                                                                                     | `pnpm test` is a hard gate. Snapshot tests of deleted routes go with the route. Diagnose root cause, do not skip or `--no-verify`.                                                                                                                                                    |

---

## 11. Out-of-scope follow-ups (for traceability)

These are referenced from this spec but explicitly do **not** ship in this PR:

1. **Backend API endpoint deletion.** Roadmap §5 Track #10. Owns: `apps/api/src/routes/escalations.ts`, `marketplace.ts`, `conversations.ts`, `modules.ts` (if any), `deployments.ts`, plus any associated services / stores that lose their last consumer. Deferred until this consumer-removal PR has merged.
2. **Editorial-shell Tools nav.** Roadmap §4 Phase D wrap-up. Adds `Contacts / Automations / Reports / Settings` (and any other Tools surfaces) to `editorial-auth-shell.tsx` brand-nav. Recorded as a known UX gap in §8.
3. **D3 (`/activity` Mercury surface).** Separate slice in the original roadmap order; not bundled with D4+D5.
4. **Backfill / migration of legacy operator workflows.** Pre-launch posture means no operator workflows to migrate. If a workflow is discovered after launch, it gets a real spec, not a rollback.
