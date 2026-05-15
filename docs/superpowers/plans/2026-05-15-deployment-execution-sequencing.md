# Deployment Execution Sequencing Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the pilot deployment implementation as three reviewable PRs after cleaning up four orphan remote branches and one stale worktree.

**Architecture:** Operational / sequencing plan. The application-code work itself is specified in `docs/superpowers/plans/2026-05-15-deployment-hosting-implementation.md` (PR #506 — 10 tasks). This plan only governs *how* those 10 tasks are partitioned into PRs and what cleanup happens first. **Tasks 1–2 do cleanup. Task 3 is the merge gate** on the spec PR (#504) and implementation-plan PR (#506). **Tasks 4–6 are the three phased implementation PRs**, each consuming a named subset of the implementation plan.

**Tech Stack:** `git`, `git worktree`, `gh` CLI, `pnpm`. No application code changes — those live in the implementation plan PR #506.

**Related artifacts:**
- Spec: `docs/superpowers/specs/2026-05-15-deployment-hosting-design.md` (PR #504)
- Implementation plan: `docs/superpowers/plans/2026-05-15-deployment-hosting-implementation.md` (PR #506)

---

## Task 1: Cleanup — delete 4 orphan remote WhatsApp branches

**Why:** Four remote branches were the source heads for already-merged PRs but never got `--delete-branch` cleanup. They are post-merge orphans. Deletion is zero-risk (the work is on `main` under squash-merge commits) and removes confusion when listing remote branches.

**Files:** none modified. Operations against the GitHub remote and the local `refs/remotes/origin/*` cache.

**Branches to delete:**

| Branch | Merged via PR | Merge commit on main |
|---|---|---|
| `feat/whatsapp-send-test-backend` | #490 | `f5e03b08` |
| `feat/whatsapp-send-test-dashboard` | #502 | `a7a9304d` |
| `docs/whatsapp-send-test-slice-2-plan` | #483 | `0214c022` |
| `docs/whatsapp-send-test-plan-corrections` | #495 | `9a0b85de` |

---

- [ ] **Step 1.1: Verify each branch has a merged PR**

Run each command, expect `MERGED`:

```bash
gh pr list --state merged --head feat/whatsapp-send-test-backend --json number,state --jq '.[]'
gh pr list --state merged --head feat/whatsapp-send-test-dashboard --json number,state --jq '.[]'
gh pr list --state merged --head docs/whatsapp-send-test-slice-2-plan --json number,state --jq '.[]'
gh pr list --state merged --head docs/whatsapp-send-test-plan-corrections --json number,state --jq '.[]'
```

Expected: each prints a JSON object with `"state":"MERGED"` and a PR number from the table above. If any prints empty output or `"state":"OPEN"`, stop and investigate — do not delete that branch.

- [ ] **Step 1.2: Delete each remote branch via the GitHub API**

```bash
gh api -X DELETE /repos/jsonljc/switchboard/git/refs/heads/feat/whatsapp-send-test-backend
gh api -X DELETE /repos/jsonljc/switchboard/git/refs/heads/feat/whatsapp-send-test-dashboard
gh api -X DELETE /repos/jsonljc/switchboard/git/refs/heads/docs/whatsapp-send-test-slice-2-plan
gh api -X DELETE /repos/jsonljc/switchboard/git/refs/heads/docs/whatsapp-send-test-plan-corrections
```

Expected: each command exits 0 with no output. A 204 from the API confirms deletion.

- [ ] **Step 1.3: Prune local remote-tracking refs**

```bash
git fetch --prune origin
```

Expected: output includes lines like `- [deleted]         (none)     -> origin/feat/whatsapp-send-test-backend` (four such lines).

- [ ] **Step 1.4: Verify the orphans are gone**

```bash
git ls-remote --heads origin | grep -E 'whatsapp-send-test-(backend|dashboard|slice-2-plan|plan-corrections)'
```

Expected: no output (empty result). If anything prints, that branch wasn't deleted — re-run Step 1.2 for it.

This task involves no commits — it changes remote state and local refs only.

---

## Task 2: Cleanup — remove stale `business-knowledge-spec` worktree

**Why:** The worktree at `/Users/jasonli/switchboard/.worktrees/business-knowledge-spec` is on branch `docs/business-knowledge-onboarding-spec`, which has no open PR (the work was either abandoned or merged under a different head). The worktree is consuming disk and showing up in `git worktree list`, but contributes nothing.

**Files:** worktree on disk. Local branch ref.

---

- [ ] **Step 2.1: Confirm the branch has no open PR**

```bash
gh pr list --state open --head docs/business-knowledge-onboarding-spec --json number --jq '.[]'
```

Expected: empty output. If a PR is open, stop — do not delete this worktree.

- [ ] **Step 2.2: Confirm no uncommitted work in the worktree**

```bash
cd /Users/jasonli/switchboard/.worktrees/business-knowledge-spec && git status --short
```

Expected: empty output. If there are tracked changes you don't recognise, stop and surface them to the user before continuing — the worktree may hold in-progress work.

- [ ] **Step 2.3: Return to a safe cwd, remove the worktree, prune, delete the branch**

```bash
cd /Users/jasonli/switchboard
git worktree remove /Users/jasonli/switchboard/.worktrees/business-knowledge-spec
git worktree prune
git branch -D docs/business-knowledge-onboarding-spec
```

Expected: `Deleted branch docs/business-knowledge-onboarding-spec (was <sha>).`

- [ ] **Step 2.4: Verify the worktree is gone**

```bash
git worktree list | grep business-knowledge-spec
```

Expected: no output.

---

## Task 3: Merge gate — confirm spec PR #504 and implementation-plan PR #506 are on `main`

**Why:** Per `CLAUDE.md`'s branch doctrine, implementation branches must consume specs/plans from `main`. The phased PRs in Tasks 4–6 should not open until the spec and the implementation plan have landed. If they haven't merged yet, this task pauses execution.

**Files:** none modified. Read-only check.

---

- [ ] **Step 3.1: Check #504 state**

```bash
gh pr view 504 --json state,mergedAt,mergeCommit --jq '.'
```

Expected: `"state":"MERGED"` with a `mergeCommit.oid`. If state is `OPEN`, **stop the plan here** and report back to the user that the spec PR still needs review/merge. The remaining tasks resume after #504 lands.

- [ ] **Step 3.2: Check #506 state**

```bash
gh pr view 506 --json state,mergedAt,mergeCommit --jq '.'
```

Expected: `"state":"MERGED"`. Same gating as Step 3.1 — if `OPEN`, pause execution until merge.

- [ ] **Step 3.3: Update local main**

```bash
cd /Users/jasonli/switchboard
git checkout main
git pull --ff-only origin main
```

Expected: a fast-forward update including the spec + plan merge commits. The local `main` now contains:
- `docs/superpowers/specs/2026-05-15-deployment-hosting-design.md`
- `docs/superpowers/plans/2026-05-15-deployment-hosting-implementation.md`

Confirm with `ls docs/superpowers/specs/2026-05-15-* docs/superpowers/plans/2026-05-15-deployment*`.

---

## Task 4: Phase 1 — Foundations PR

**Why:** Phase 1 contains the implementation plan's five zero-conflict tasks: a `migrate:deploy` script in `@switchboard/db`, the Render IaC, two runbooks, and the production smoke script. None of these collide with any other open branch. Landing this phase first proves the topology, gives the operator the runbook templates to start filling, and de-risks the next two phases.

**Implementation plan tasks consumed:** 1, 5, 6, 7, 8 (plus a Phase-1-scoped run of plan task 10 for verification).

**Branch:** `feat/deploy-render-foundations`
**Worktree:** `/Users/jasonli/switchboard/.claude/worktrees/feat+deploy-render-foundations`
**Expected files at PR open:**
- Modified: `packages/db/package.json`
- New: `render.yaml`, `docs/runbooks/production-urls.md`, `docs/runbooks/secret-rotation.md`, `scripts/smoke-prod.sh`
- Conditionally new (only if implementation plan Task 5 Step 5.2 ran): `Dockerfile.api`, `Dockerfile.chat`

---

- [ ] **Step 4.1: Create the worktree off `origin/main`**

```bash
cd /Users/jasonli/switchboard
git fetch origin main
git worktree add /Users/jasonli/switchboard/.claude/worktrees/feat+deploy-render-foundations \
  -b feat/deploy-render-foundations origin/main
```

Expected: `Preparing worktree (new branch 'feat/deploy-render-foundations')` and the branch set up tracking `origin/main`.

- [ ] **Step 4.2: Run worktree init**

```bash
cd /Users/jasonli/switchboard/.claude/worktrees/feat+deploy-render-foundations
pnpm worktree:init
```

Expected: `.env` copied from a parent location, stale dev-port listeners killed, and (if Postgres is reachable) `pnpm db:migrate` runs cleanly. Refer to `scripts/worktree-init.sh` for the exact behaviour.

- [ ] **Step 4.3: Execute implementation-plan tasks 1, 5, 6, 7, 8 in this worktree**

Open `docs/superpowers/plans/2026-05-15-deployment-hosting-implementation.md` (now on `main`). Execute, in order, every step under:

- Task 1 (`migrate:deploy` script)
- Task 5 (`render.yaml`, including Step 5.0 verification gate against Render's current Blueprint reference, and Step 5.2 conditional fallback to per-service Dockerfiles if needed)
- Task 6 (`docs/runbooks/production-urls.md`)
- Task 7 (`docs/runbooks/secret-rotation.md`)
- Task 8 (`scripts/smoke-prod.sh`, including the `command -v jq` guard)

Follow each task's own commit boundaries — do **not** squash them prematurely; the PR squashes on merge.

- [ ] **Step 4.4: Run Phase 1 scoped verification**

```bash
cd /Users/jasonli/switchboard/.claude/worktrees/feat+deploy-render-foundations
pnpm typecheck
pnpm lint
pnpm --filter @switchboard/db test
pnpm --filter @switchboard/dashboard build
bash -n scripts/smoke-prod.sh
```

Expected: every command exits 0. The dashboard build is included even though Phase 1 doesn't touch the dashboard — it's a cheap regression check per `feedback_dashboard_build_not_in_ci`. The `bash -n` is a smoke-script syntax sanity check.

If any command fails, fix the issue in this worktree and re-run before opening the PR.

- [ ] **Step 4.5: Push and open the PR**

```bash
git push -u origin feat/deploy-render-foundations
gh pr create --base main --head feat/deploy-render-foundations \
  --title "feat(deploy): pilot launch foundations — render.yaml, runbooks, smoke script, migrate:deploy" \
  --body "$(cat <<'EOF'
## Summary

Phase 1 of the pilot deployment implementation per docs/superpowers/plans/2026-05-15-deployment-hosting-implementation.md.

Files in this PR (zero-conflict, all net-new except packages/db/package.json):
- `render.yaml` — Render Infrastructure-as-Code: api + chat web services, Postgres, Redis, region placeholder, env-var keys.
- `docs/runbooks/production-urls.md` — provisioning fill-in template (URLs, region, plan tiers, monitoring links, vault map).
- `docs/runbooks/secret-rotation.md` — per-provider rotation procedures (Anthropic, Meta, Telegram, Slack, Stripe, Voyage, Inngest, NextAuth).
- `scripts/smoke-prod.sh` — automates the deployment runbook's HTTP smoke checks; requires `curl` + `jq`.
- `packages/db/package.json` — adds `migrate:deploy` and `migrate:status` scripts used by Render's pre-deploy command.

Phases 2 (chat /api/health/deep) and 3 (Sentry env-var rename + .env.example docs) land in follow-up PRs per docs/superpowers/plans/2026-05-15-deployment-execution-sequencing.md.

## Test plan
- [ ] `pnpm typecheck` clean
- [ ] `pnpm lint` clean
- [ ] `pnpm --filter @switchboard/db test` passes
- [ ] `pnpm --filter @switchboard/dashboard build` succeeds (regression check)
- [ ] `bash -n scripts/smoke-prod.sh` passes
- [ ] Render blueprint validated against current Render docs (link in PR comments per Step 5.0)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. Record the PR number for Step 4.7.

- [ ] **Step 4.6: Wait for review + merge**

Stop here. The PR is open. Human review + merge happens externally. Resume Task 4 only after the PR is merged.

- [ ] **Step 4.7: Teardown the Phase 1 worktree (same day as merge, per CLAUDE.md)**

After Phase 1 merges:

```bash
cd /Users/jasonli/switchboard
git worktree remove /Users/jasonli/switchboard/.claude/worktrees/feat+deploy-render-foundations
git worktree prune
git branch -D feat/deploy-render-foundations
git fetch --prune origin
```

Expected: worktree removed, local branch deleted, remote-tracking ref pruned (the remote branch is typically auto-deleted by `gh pr merge --delete-branch` if used; verify with `git ls-remote --heads origin feat/deploy-render-foundations` returning empty).

---

## Task 5: Phase 2 — Chat deep readiness PR

**Why:** Phase 2 adds the `chat /api/health/deep` endpoint per spec §7. With Phase 1 merged, `render.yaml` already declares the production topology; Phase 2 is just the chat code change to make the endpoint actually exist. Conflict surface is small now that `feat/whatsapp-send-test-backend` is deleted (Task 1) — `apps/chat/src/main.ts` is the only modified existing file.

**Implementation plan tasks consumed:** 3, 4 (plus Phase-2-scoped verification).

**Branch:** `feat/chat-deep-readiness`
**Worktree:** `/Users/jasonli/switchboard/.claude/worktrees/feat+chat-deep-readiness`
**Expected files at PR open:**
- New: `apps/chat/src/routes/health.ts`, `apps/chat/src/routes/__tests__/health.test.ts`
- Modified: `apps/chat/src/main.ts`

---

- [ ] **Step 5.1: Create the worktree off latest `origin/main`**

```bash
cd /Users/jasonli/switchboard
git fetch origin main
git worktree add /Users/jasonli/switchboard/.claude/worktrees/feat+chat-deep-readiness \
  -b feat/chat-deep-readiness origin/main
```

Expected: worktree prepared, branch tracking `origin/main` which now includes Phase 1's render.yaml + runbooks (Phase 2 doesn't depend on them at runtime but the rebase baseline must be post-Phase-1).

- [ ] **Step 5.2: Run worktree init**

```bash
cd /Users/jasonli/switchboard/.claude/worktrees/feat+chat-deep-readiness
pnpm worktree:init
```

- [ ] **Step 5.3: Execute implementation-plan tasks 3 + 4**

Open `docs/superpowers/plans/2026-05-15-deployment-hosting-implementation.md`. Execute, in order:

- Task 3 — TDD pattern: write the failing test file first (4 test cases), run, watch fail, then implement `apps/chat/src/routes/health.ts` as a plain `FastifyPluginAsync` (no `fastify-plugin` wrapper — that package is not in chat's dependencies).
- Task 4 — register `chatHealthRoutes` in `apps/chat/src/main.ts` adjacent to the existing inline `/health` handler. Pass `healthPrisma`, `healthRedis`, `process.env["SWITCHBOARD_API_URL"]`, `process.env["INTERNAL_API_SECRET"]` into the plugin options.

- [ ] **Step 5.4: Run Phase 2 scoped verification**

```bash
cd /Users/jasonli/switchboard/.claude/worktrees/feat+chat-deep-readiness
pnpm --filter @switchboard/chat typecheck
pnpm --filter @switchboard/chat lint
pnpm --filter @switchboard/chat test
```

Expected: all four commands exit 0. The new `health.test.ts` reports 4 passing tests. No existing chat test regresses.

- [ ] **Step 5.5: Push and open the PR**

```bash
git push -u origin feat/chat-deep-readiness
gh pr create --base main --head feat/chat-deep-readiness \
  --title "feat(chat): /api/health/deep deep-readiness endpoint" \
  --body "$(cat <<'EOF'
## Summary

Phase 2 of the pilot deployment implementation. Adds chat's deep-readiness endpoint per spec §7 (`docs/superpowers/specs/2026-05-15-deployment-hosting-design.md` on main after PR #504).

- New plugin: `apps/chat/src/routes/health.ts` — exposes `GET /api/health/deep` checking DB + Redis + api reachability with 3s timeouts. Returns 503 if any check fails. Plain `FastifyPluginAsync` (no `fastify-plugin` wrapper).
- Tests: `apps/chat/src/routes/__tests__/health.test.ts` — 4 cases covering healthy, DB unreachable, api not configured (does NOT 503 — cascading-failures-safe), api 5xx (does 503).
- Wiring: `apps/chat/src/main.ts` registers the plugin under `/api/health` prefix.

Spec §7 deliberately places the api-reachability check in **readiness** (not liveness) to avoid cascading failures during api blips. Render's container-promotion gating uses shallow `/health` per Phase 1's render.yaml.

## Test plan
- [ ] `pnpm --filter @switchboard/chat typecheck` clean
- [ ] `pnpm --filter @switchboard/chat lint` clean
- [ ] `pnpm --filter @switchboard/chat test` — 4 new tests pass, no regressions
- [ ] After provisioning: `curl https://<chat-domain>/api/health/deep` returns 200 with `database: connected`, `redis: connected`, `api: connected`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5.6: Wait for review + merge**

Stop here until merge. Then proceed to teardown.

- [ ] **Step 5.7: Teardown the Phase 2 worktree**

```bash
cd /Users/jasonli/switchboard
git worktree remove /Users/jasonli/switchboard/.claude/worktrees/feat+chat-deep-readiness
git worktree prune
git branch -D feat/chat-deep-readiness
git fetch --prune origin
```

---

## Task 6: Phase 3 — Sentry env-var rename + `.env.example` documentation PR

**Why:** Phase 3 finishes the rename of `SENTRY_DSN` to `SENTRY_DSN_SERVER` in api + chat, updates the chat sentry-bootstrap test accordingly, and adds the `SWITCHBOARD_API_URL` + Inngest-Cloud env documentation to `.env.example`. `.env.example` carries a moderate conflict risk — bundling tasks 2 + 9 together means a single rebase point right before merge.

**Implementation plan tasks consumed:** 2, 9 (plus Phase-3-scoped verification).

**Branch:** `chore/rename-sentry-dsn-to-server`
**Worktree:** `/Users/jasonli/switchboard/.claude/worktrees/chore+rename-sentry-dsn-to-server`
**Expected files at PR open:**
- Modified: `apps/api/src/bootstrap/sentry.ts`, `apps/chat/src/bootstrap/sentry.ts`, `apps/chat/src/__tests__/sentry-bootstrap.test.ts`, `.env.example`

---

- [ ] **Step 6.1: Create the worktree off latest `origin/main`**

```bash
cd /Users/jasonli/switchboard
git fetch origin main
git worktree add /Users/jasonli/switchboard/.claude/worktrees/chore+rename-sentry-dsn-to-server \
  -b chore/rename-sentry-dsn-to-server origin/main
```

- [ ] **Step 6.2: Run worktree init**

```bash
cd /Users/jasonli/switchboard/.claude/worktrees/chore+rename-sentry-dsn-to-server
pnpm worktree:init
```

- [ ] **Step 6.3: Execute implementation-plan tasks 2 + 9**

Open `docs/superpowers/plans/2026-05-15-deployment-hosting-implementation.md`. Execute, in order:

- Task 2 — TDD pattern for the sentry rename: update the chat sentry-bootstrap test first (add the `reads SENTRY_DSN_SERVER, not SENTRY_DSN` case), watch it fail, rename `process.env["SENTRY_DSN"]` to `process.env["SENTRY_DSN_SERVER"]` in `apps/api/src/bootstrap/sentry.ts:14` and `apps/chat/src/bootstrap/sentry.ts:4`, rename `SENTRY_DSN=` to `SENTRY_DSN_SERVER=` in `.env.example`, run the broad-scope grep from Step 2.8 to confirm no stale `SENTRY_DSN` references survived outside `docker-compose.prod.yml`.
- Task 9 — annotate the `.env.example` Inngest block (already-present `INNGEST_EVENT_KEY=` + `INNGEST_SIGNING_KEY=`) with a comment explaining they are REQUIRED for Inngest Cloud (Render production) and unused in local `inngest dev` mode. Add the `SWITCHBOARD_API_URL=http://localhost:3000` line with the documented server-side-only / no-`NEXT_PUBLIC_` rationale.

- [ ] **Step 6.4: Run Phase 3 scoped verification**

```bash
cd /Users/jasonli/switchboard/.claude/worktrees/chore+rename-sentry-dsn-to-server
pnpm typecheck
pnpm lint
pnpm --filter @switchboard/api test
pnpm --filter @switchboard/chat test
```

Expected: all commands exit 0. The chat sentry-bootstrap test's new `reads SENTRY_DSN_SERVER, not SENTRY_DSN` case passes.

- [ ] **Step 6.5: Just-in-time rebase against latest `origin/main`**

Because `.env.example` is a high-conflict file, rebase right before push:

```bash
git fetch origin main
git rebase origin/main
```

If conflicts on `.env.example` appear, resolve them by keeping both the rename and the other workstream's additions, then re-run Step 6.4.

- [ ] **Step 6.6: Push and open the PR**

```bash
git push -u origin chore/rename-sentry-dsn-to-server
gh pr create --base main --head chore/rename-sentry-dsn-to-server \
  --title "chore(observability): rename SENTRY_DSN to SENTRY_DSN_SERVER; document SWITCHBOARD_API_URL and Inngest-Cloud env" \
  --body "$(cat <<'EOF'
## Summary

Phase 3 of the pilot deployment implementation. Two related env-var tasks bundled because they share `.env.example` as a touch-point.

- Rename `SENTRY_DSN` → `SENTRY_DSN_SERVER` in `apps/api/src/bootstrap/sentry.ts:14` and `apps/chat/src/bootstrap/sentry.ts:4`. Updates the chat sentry-bootstrap test to assert the new var name. Renames the line in `.env.example`. Dashboard's `NEXT_PUBLIC_SENTRY_DSN` is untouched (already correctly named).
- `.env.example` annotates the existing `INNGEST_EVENT_KEY=` / `INNGEST_SIGNING_KEY=` block: both are REQUIRED for Inngest Cloud in production, unused in local `inngest dev` mode.
- `.env.example` adds `SWITCHBOARD_API_URL=http://localhost:3000` with the rationale that this is server-side only (consumed by the dashboard's Next.js API routes which proxy to api; browser never calls api directly, so no `NEXT_PUBLIC_*` variant).

`docker-compose.prod.yml`'s `SENTRY_DSN` references are deliberately not synced — that file represents the prior self-hosted plan and is kept for local integration testing only per spec §12.

## Test plan
- [ ] `pnpm typecheck` clean
- [ ] `pnpm lint` clean
- [ ] `pnpm --filter @switchboard/api test` passes
- [ ] `pnpm --filter @switchboard/chat test` passes — chat sentry-bootstrap test's new "reads SENTRY_DSN_SERVER, not SENTRY_DSN" case is the TDD assertion
- [ ] Broad `grep -R "SENTRY_DSN" apps packages .env.example` returns only `SENTRY_DSN_SERVER` and `NEXT_PUBLIC_SENTRY_DSN` (and any deliberate doc references)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6.7: Wait for review + merge**

Stop here until merge.

- [ ] **Step 6.8: Teardown the Phase 3 worktree**

```bash
cd /Users/jasonli/switchboard
git worktree remove /Users/jasonli/switchboard/.claude/worktrees/chore+rename-sentry-dsn-to-server
git worktree prune
git branch -D chore/rename-sentry-dsn-to-server
git fetch --prune origin
```

---

## Closing notes

After Phase 3 merges, the **code surface** of the deployment work is complete. The remaining launch work is operational and lives in spec §10 + the runbooks shipped in Phase 1:

- Provision Vercel + Render via the committed `render.yaml`
- Copy secrets from vault → Render UI
- Update Vercel env (`SWITCHBOARD_API_URL`, `NEXT_PUBLIC_SENTRY_DSN`, NextAuth secrets, `NEXT_PUBLIC_*` flags)
- Register webhooks with Meta / Telegram / Slack
- Configure Sentry alert rules (especially the `test=true` exclusion)
- Set up UptimeRobot monitors
- Rollback rehearsal
- 24-hour first-user dry run

None of that is in scope for any further implementation PR. It is executed live against the deploy hosts following `docs/runbooks/production-urls.md` and `docs/runbooks/secret-rotation.md`.
