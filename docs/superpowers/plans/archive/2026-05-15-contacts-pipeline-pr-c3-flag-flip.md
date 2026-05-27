# Contacts Pipeline PR-C3 — Flag Flip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flip `NEXT_PUBLIC_CONTACTS_LIVE` from `false` to `true` so operators see real opportunity data on `/contacts` instead of the SGD-medspa fixture board. Third and final PR of the C1 → C2 → C3 sequence.

**Architecture:** Single environment-level toggle. `apps/dashboard/src/lib/route-availability.ts` exposes `isMercuryToolLive("contacts")` which reads `process.env.NEXT_PUBLIC_CONTACTS_LIVE === "true"`. PR-C1 wired this gate into `use-opportunities-board.ts` (GET branch) and `use-opportunity-stage-transition.ts` (PATCH branch + optimistic rollback); PR-C2 shipped `/api/dashboard/opportunities` + `/api/dashboard/opportunities/:id/stage` behind dashboard proxy routes. No code in the helper, the hooks, the proxy routes, the Fastify routes, the projection, the schemas, or the audit emission changes. The repo carries the flag default in `.env.example` (root, line 113, currently `false`) and `apps/dashboard/.env.local.example` (line 35, currently commented). Both flip to `true`. Production deploys must also update their environment-var stores; that part is out-of-repo and noted in the PR body for the operator landing the deploy.

**Tech Stack:** Next.js 14 (App Router), `process.env.NEXT_PUBLIC_*` build-time inlining, pnpm workspace, Vitest, TanStack React Query, Fastify (backend untouched).

**Scope:** Two files modified. No new files. No new tests (existing route-availability tests cover both branches via `vi.stubEnv`; existing hook tests cover both branches via `vi.mocked(isMercuryToolLive)`). Smoke + rollback verification happen locally; staging is unavailable.

---

## Source documents

- C1 spec §11 ship-sequencing table: `docs/superpowers/specs/2026-05-13-contacts-pipeline-design.md` (PR-C3 row)
- C2 backend spec: `docs/superpowers/specs/2026-05-14-contacts-pipeline-backend-design.md`
- Flag helper: `apps/dashboard/src/lib/route-availability.ts`
- Hooks that consume the flag (do not modify):
  - `apps/dashboard/src/app/(auth)/(mercury)/contacts/hooks/use-opportunities-board.ts`
  - `apps/dashboard/src/app/(auth)/(mercury)/contacts/hooks/use-opportunity-stage-transition.ts`

---

## File structure

| Path                                | Action            | Responsibility                                                                                                         |
| ----------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `.env.example`                      | Modify (line 113) | Root example file documenting all repo-level env defaults. Flip `NEXT_PUBLIC_CONTACTS_LIVE=false` → `true`.            |
| `apps/dashboard/.env.local.example` | Modify (line 35)  | Dashboard-scoped example. Currently has `# NEXT_PUBLIC_CONTACTS_LIVE=false` (commented). Uncomment and flip to `true`. |

No other files change. The helper, hooks, fixtures, proxy routes, Fastify routes, projection, schemas, and tests stay untouched.

---

## Tasks

### Task 1: Verify clean baseline + worktree setup

**Files:**

- Read: `.env.example`
- Read: `apps/dashboard/.env.local.example`
- Read: `apps/dashboard/src/lib/route-availability.ts`

- [ ] **Step 1: Verify a worktree at `feat/contacts-pipeline-pr-c3` exists, branched from main**

Run from the parent of the repo, or use the `superpowers:using-git-worktrees` skill before this plan executes:

```bash
git fetch origin main
git worktree add ../switchboard-contacts-pr-c3 -b feat/contacts-pipeline-pr-c3 origin/main
cd ../switchboard-contacts-pr-c3
pnpm worktree:init
```

Expected: worktree created; `.env` copied; ports cleared; migrations applied if Postgres reachable. Pre-commit branch-relevance hook is non-blocking.

- [ ] **Step 2: Confirm baseline values are still `false`**

Run:

```bash
grep -n "^NEXT_PUBLIC_CONTACTS_LIVE" .env.example
grep -n "NEXT_PUBLIC_CONTACTS_LIVE" apps/dashboard/.env.local.example
```

Expected output:

```
113:NEXT_PUBLIC_CONTACTS_LIVE=false
35:# NEXT_PUBLIC_CONTACTS_LIVE=false
```

If the line numbers differ, the rest of the plan still applies — find the literal `NEXT_PUBLIC_CONTACTS_LIVE` line in each file and edit it. The plan instructs by content match, not by line number.

---

### Task 2: Flip the root `.env.example` default

**Files:**

- Modify: `.env.example` (the `NEXT_PUBLIC_CONTACTS_LIVE=` line, currently line 113)

- [ ] **Step 1: Edit the flag line**

Replace exactly:

```
NEXT_PUBLIC_CONTACTS_LIVE=false
```

With:

```
NEXT_PUBLIC_CONTACTS_LIVE=true
```

Leave every other `NEXT_PUBLIC_*_LIVE=false` line alone (automations, activity, reports, approvals). Their flip is governed by their own PRs.

- [ ] **Step 2: Verify the edit**

Run:

```bash
grep -n "^NEXT_PUBLIC_.*_LIVE" .env.example
```

Expected:

```
113:NEXT_PUBLIC_CONTACTS_LIVE=true
114:NEXT_PUBLIC_AUTOMATIONS_LIVE=false
115:NEXT_PUBLIC_ACTIVITY_LIVE=false
116:NEXT_PUBLIC_REPORTS_LIVE=false
117:NEXT_PUBLIC_APPROVALS_LIVE=false
```

Only `CONTACTS` flipped. Others unchanged.

---

### Task 3: Flip the dashboard-scoped `.env.local.example`

**Files:**

- Modify: `apps/dashboard/.env.local.example` (line 35, currently commented)

- [ ] **Step 1: Edit the flag line + the surrounding comment**

The current block (lines 30–35) reads:

```
# Mercury surface live-data flags. Each defaults to "false" (fixture mode).
# Flip to "true" in the build environment to consume the real API. Inlined
# at build time by Next.js — must be set before the dashboard build, not at
# runtime. Flip after a deliberate staging walkthrough; never on first deploy.
# NEXT_PUBLIC_REPORTS_LIVE=false
# NEXT_PUBLIC_CONTACTS_LIVE=false
```

Replace only the last line — uncomment it and flip the value:

```
# Mercury surface live-data flags. Each defaults to "false" (fixture mode).
# Flip to "true" in the build environment to consume the real API. Inlined
# at build time by Next.js — must be set before the dashboard build, not at
# runtime. Flip after a deliberate staging walkthrough; never on first deploy.
# NEXT_PUBLIC_REPORTS_LIVE=false
NEXT_PUBLIC_CONTACTS_LIVE=true
```

Leave the explanatory comment lines (the four `# Mercury surface…` lines) and the `# NEXT_PUBLIC_REPORTS_LIVE=false` line as-is. Reports is governed by its own PR.

- [ ] **Step 2: Verify the edit**

Run:

```bash
grep -n "NEXT_PUBLIC_CONTACTS_LIVE\|NEXT_PUBLIC_REPORTS_LIVE" apps/dashboard/.env.local.example
```

Expected:

```
34:# NEXT_PUBLIC_REPORTS_LIVE=false
35:NEXT_PUBLIC_CONTACTS_LIVE=true
```

Reports still commented, Contacts uncommented and set to `true`.

---

### Task 4: Confirm no other repo files need updating

**Files:**

- Read: search results only — no edits in this task

- [ ] **Step 1: Audit all repo references to the flag**

Run:

```bash
git grep -n "NEXT_PUBLIC_CONTACTS_LIVE" -- ':!docs/**' ':!**/node_modules/**'
```

Expected non-doc matches (verified against `origin/main` at plan-authoring time):

- `.env.example:113` — just flipped (Task 2)
- `apps/dashboard/.env.local.example:35` — just flipped (Task 3)
- `apps/dashboard/src/lib/route-availability.ts` — references the env var key inside a typed map (do **not** touch)
- `apps/dashboard/src/app/(auth)/(mercury)/contacts/[id]/hooks/__tests__/use-contact-detail.test.tsx` — test stubs the env explicitly (do **not** touch)

If `git grep` surfaces a deploy file (`vercel.json`, `render.yaml`, `Dockerfile`, `docker-compose.yml`, `.github/workflows/*.yml`, `infra/**`) with a hardcoded `NEXT_PUBLIC_CONTACTS_LIVE=false`, STOP. That's a deploy-env locus the C1 spec didn't anticipate; file a follow-up issue and reassess scope. As of `origin/main` HEAD at plan time, no such file exists.

- [ ] **Step 2: Confirm test files won't regress**

Every test that touches `isMercuryToolLive` mocks it directly (`vi.mock`, `vi.mocked(...).mockReturnValue(...)`, or `vi.stubEnv`). Tests do not read the example files. Run:

```bash
git grep -ln "isMercuryToolLive\|NEXT_PUBLIC_CONTACTS_LIVE" -- 'apps/dashboard/**/__tests__/**' 'apps/dashboard/**/*.test.*'
```

Confirm every match either uses `vi.mock("@/lib/route-availability", ...)` or `vi.stubEnv("NEXT_PUBLIC_CONTACTS_LIVE", ...)`. Tests are immune to the example-file change.

---

### Task 5: Run the full quality gate

**Files:**

- No code changes; this task is verification only.

- [ ] **Step 1: Typecheck**

Run:

```bash
pnpm typecheck
```

Expected: clean. If errors appear, they are unrelated to this PR (likely Prisma drift — `pnpm reset` first per CLAUDE.md). Investigate before continuing.

- [ ] **Step 2: Lint**

Run:

```bash
pnpm lint
```

Expected: clean (pre-existing `any` warnings in API routes and `auth.ts` are acceptable per CLAUDE.md).

- [ ] **Step 3: Tests**

Run:

```bash
pnpm test
```

Expected: all green. Key suites that exercise the flag — `route-availability.test.ts`, `use-opportunities-board.test.tsx`, `use-opportunity-stage-transition.test.tsx`, `use-contact-detail.test.tsx` — must all pass. If `prisma-work-trace-store-integrity` / `prisma-ledger-storage` / `prisma-greeting-signal-store` fail, they are pre-existing flakes per memory `feedback_db_integrity_tests_pg_advisory_lock.md` — confirm by running them against `origin/main` if uncertain.

- [ ] **Step 4: Dashboard build (Next.js)**

Required per memory `feedback_dashboard_build_not_in_ci.md` — CI does not run `next build`.

Run:

```bash
pnpm --filter @switchboard/dashboard build
```

Expected: build succeeds. If it fails on a `.js` extension import error or similar, that's pre-existing dashboard drift, not from this PR — investigate before continuing.

---

### Task 6: Local smoke — live drag-to-move

**Files:**

- No code changes; this task is browser verification.

Staging is not configured. Smoke happens against the local dev stack with `NEXT_PUBLIC_CONTACTS_LIVE=true` inlined from the freshly-edited `.env.example`.

- [ ] **Step 1: Ensure the local env consumes the flipped default**

If the worktree has a local `.env` that overrides `NEXT_PUBLIC_CONTACTS_LIVE` (the `pnpm worktree:init` script copies `.env`), check it:

```bash
grep -n "NEXT_PUBLIC_CONTACTS_LIVE" .env 2>/dev/null || echo "no .env override"
```

If `.env` sets `NEXT_PUBLIC_CONTACTS_LIVE=false`, override it locally for this smoke (do not commit `.env`):

```bash
sed -i.bak 's/^NEXT_PUBLIC_CONTACTS_LIVE=false/NEXT_PUBLIC_CONTACTS_LIVE=true/' .env && rm .env.bak
```

- [ ] **Step 2: Start the stack**

Run in two terminals (or use `pnpm dev` if the repo has a combined script):

```bash
pnpm --filter @switchboard/api dev    # port 3000
pnpm --filter @switchboard/dashboard dev   # port 3002
```

Expected: API listening on 3000, dashboard on 3002, no startup errors.

- [ ] **Step 3: Seed an org with opportunities**

If the dev DB lacks opportunities, run whatever seed pathway exists. Check by hitting the API directly:

```bash
curl -s -H "Cookie: $(cat ~/.switchboard-dev-cookie 2>/dev/null)" \
  http://localhost:3000/api/dashboard/opportunities | head -c 400
```

Expected: a JSON `PipelineBoardResponse` with at least one card across the columns. If empty, run the seed script (look under `apps/api/scripts/` or `packages/db/scripts/` — exact path depends on repo state at execution time).

- [ ] **Step 4: Visit `/contacts` in the browser**

Open `http://localhost:3002/contacts` after logging in. Expected:

- The board renders with **real** opportunity cards (not the SGD-medspa fixture names like "Sarah K.", "Aisha N.", etc. — those are PR-C1 fixtures).
- Column headers match the live stage order from `OpportunityStage`.
- The DevTools Network tab shows `GET /api/dashboard/opportunities` returning `200` with the same payload `curl` showed.

- [ ] **Step 5: Drag one card to a new column**

Pick any non-terminal card and drag it to an adjacent stage. Expected:

- The card visually moves immediately (optimistic update from `use-opportunity-stage-transition.ts`).
- DevTools Network shows `PATCH /api/dashboard/opportunities/<id>/stage` returning `200`.
- A success toast renders (copy: whatever PR-C1 wired — check `apps/dashboard/src/app/(auth)/(mercury)/contacts/components/*` if uncertain; do not modify the copy).
- A hard reload (Cmd-Shift-R) keeps the card in its new column (proves the audit-pathed write committed).

Capture a screenshot or screen recording of this step for the PR body.

---

### Task 7: Local rollback — simulated 500

**Files:**

- No code changes; this task is browser verification.

- [ ] **Step 1: Block the PATCH endpoint in DevTools**

Open DevTools → Network → right-click `/api/dashboard/opportunities/*/stage` row → "Block request URL" (or use the request-blocking panel). Alternatively, in the Network tab's filter, use "Block request domain" scoped to `/api/dashboard/opportunities`.

Refresh the board so it reloads cleanly with the block active.

- [ ] **Step 2: Drag a card**

Drag any card to a different column. Expected:

- The card optimistically moves to the new column (PR-C1's `onMutate` snapshots and applies).
- The PATCH fails (blocked → net::ERR_BLOCKED_BY_CLIENT, surfaces as fetch error in `mutationFn` → throws `Error("Stage transition failed: ...")`).
- The card **reverts** to its original column (PR-C1's `onError` restores `context.previous`).
- An **error toast** renders.

Capture a screenshot or recording.

- [ ] **Step 3: Unblock and confirm normal operation resumes**

Remove the request block. Drag the same card again. It should now move successfully (Task 6, Step 5 behavior). This proves the failure was the blocker, not a regression.

---

### Task 8: Commit + PR

**Files:**

- Modified: `.env.example`
- Modified: `apps/dashboard/.env.local.example`

- [ ] **Step 1: Verify branch + status**

Run:

```bash
git branch --show-current
git status --short
```

Expected:

```
feat/contacts-pipeline-pr-c3
 M .env.example
 M apps/dashboard/.env.local.example
```

If anything else is in the diff (a `.env` file, a `node_modules/` artifact, an accidental edit elsewhere), unstage and investigate before continuing.

- [ ] **Step 2: Commit**

Run:

```bash
git add .env.example apps/dashboard/.env.local.example
git commit -m "$(cat <<'EOF'
feat(contacts-pipeline): flip NEXT_PUBLIC_CONTACTS_LIVE on (PR-C3)

Flips the Mercury contacts flag from false to true so /contacts
consumes the live opportunities API shipped in PR-C2 instead of
the SGD-medspa fixture board shipped in PR-C1. Third and final PR
in the C1 (#477) → C2 (#486) → C3 sequence.

No code changes — both consuming hooks (use-opportunities-board,
use-opportunity-stage-transition) already branch on
isMercuryToolLive("contacts"). Existing tests stub the helper or
the env directly and are unaffected.

Production deploys must mirror the flip in their env-var store
before the next dashboard build (NEXT_PUBLIC_* is inlined at build
time by Next.js).
EOF
)"
```

Pre-commit branch-relevance hook may warn that the changes don't reference the branch slug — non-blocking per CLAUDE.md.

- [ ] **Step 3: Push and open the PR**

Run:

```bash
git push -u origin feat/contacts-pipeline-pr-c3
gh pr create --title "feat(contacts-pipeline): flip NEXT_PUBLIC_CONTACTS_LIVE on (PR-C3)" --body "$(cat <<'EOF'
## Summary

- Flips `NEXT_PUBLIC_CONTACTS_LIVE` from `false` → `true` in `.env.example` (line 113) and `apps/dashboard/.env.local.example` (line 35, also uncomments it).
- No code, no schema, no route, no projection, no test changes. The flag flip is one environment-level toggle that PR-C1 (#477) and PR-C2 (#486) deliberately designed for.
- Third and final PR in the C1 → C2 → C3 contacts pipeline rebuild sequence.

## What goes live

Operators visiting `/contacts` see real opportunity data from `GET /api/dashboard/opportunities` instead of the 20-card SGD-medspa fixture board. Drag-to-move emits a `PATCH /api/dashboard/opportunities/:id/stage` with atomic Prisma mutation + `WorkTrace` audit emission (`ingressPath: "store_recorded_operator_mutation"`).

## Deploy note

Production deploys must mirror the flip in their environment-var store **before** the next dashboard build — Next.js inlines `NEXT_PUBLIC_*` at build time, not at runtime. The repo files updated here are documentation defaults; CI/Vercel/Render env vars are authoritative for prod.

## Smoke evidence

Local smoke on this worktree:

- `/contacts` loaded real opportunity cards (verified against `curl /api/dashboard/opportunities`).
- Dragged a card to a new column → optimistic move, `PATCH` 200, success toast, hard-reload retains new stage.
- Blocked the PATCH URL in DevTools, dragged again → card optimistically moved, then reverted on failure, error toast rendered.

Screenshots in comments below.

## Out of scope

- Pagination, saved filter views, bulk operations, CSV export (PR-C1 §12 deferred).
- Mobile responsive collapse (deferred).
- `/pipeline` route migration (wave 1.5).
- Topbar Pipeline-tab promotion (wave 2).

## Test plan

- [x] `pnpm typecheck` clean
- [x] `pnpm lint` clean
- [x] `pnpm test` green (route-availability + opportunities-board + stage-transition + contact-detail suites)
- [x] `pnpm --filter @switchboard/dashboard build` succeeds
- [x] Local smoke: drag-to-move on live data
- [x] Local rollback: card reverts on simulated 500

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR opens against `main`. Note the PR number for the final session report.

- [ ] **Step 4: Attach screenshots**

If screenshots/recordings from Tasks 6 and 7 are available, attach them as PR comments (drag into the GitHub web UI on the PR page). If not practical, note "smoke verified locally, no capture available" in the PR description.

---

## What this PR does NOT do

- **No schema changes.** Wire shape locked since C1.
- **No backend route changes.** PR-C2 shipped them.
- **No frontend hook changes.** PR-C1 wired the gate.
- **No projection changes.** PR-C2 shipped it.
- **No new tests.** Existing tests cover both flag branches via mocks/stubs.
- **No removal of fixture-mode code.** Fixtures stay for tests + Claude Design dev work; same flag still toggles them off in prod.
- **No rename of the env var.** PR-C1 §10.2 deliberately kept the name `NEXT_PUBLIC_CONTACTS_LIVE` so this flip is a value-only change, not a rename refactor.

---

## Risks + rollback

- **Risk 1:** Pilot org has no opportunities → empty board. Mitigation: PR-C1's empty-state UI already exists (verified in `pipeline-page.test.tsx`); operators see "No opportunities yet" instead of an error.
- **Risk 2:** Backend 5xx → C1's optimistic-rollback hook reverts the card and surfaces a toast. Verified in Task 7.
- **Risk 3:** Audit emission failure → C2's atomic Prisma mutation rolls back the stage transition before the PATCH returns; from the operator's POV it's identical to Risk 2.
- **Rollback:** Revert this commit on `main` and redeploy. Flag returns to `false`, hooks switch back to fixtures, no data loss (the PATCH route still works — it's the dashboard's read/write branch that flips off).
