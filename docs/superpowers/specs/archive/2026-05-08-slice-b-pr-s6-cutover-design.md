# Slice B PR-S6 — Cutover (Minimal) — Design Spec

_2026-05-08 · final PR of Slice B · part of the agent-first redesign track_

---

## 1. Problem & scope

### 1.1 What this PR ships

Make `/alex` and `/riley` reachable in production for orgs with those agents
enabled. Remove the temporary production env gate and the now-unused fixture
file. This is the terminal PR of Slice B.

Three concerns, nothing else:

1. **Server gate removal** — drop the
   `process.env.NEXT_PUBLIC_DEPLOY_ENV === "production"` check at
   `apps/dashboard/src/app/(auth)/[agentKey]/page.tsx:15`. The
   `OrgAgentEnablement` allowlist on lines 12–13 remains the **sole**
   route-level gate.
2. **Fixture deletion** — delete `_fixtures.ts` (greeting-only at this point),
   delete `__tests__/fixtures.test.ts`, update the greeting mock in
   `__tests__/agent-home-client.test.tsx` to inline data (matching the existing
   inline-mock pattern this file already uses for wins/metrics/pipeline).
3. **Production-env test cleanup** — remove the
   "notFound() in production env" test case from `__tests__/page.test.tsx`.

### 1.2 What this PR explicitly does NOT ship

| Item | Why deferred |
| --- | --- |
| `useAgentFirstNav` flag wiring | Slice B locked it to Phase D (spec Q11 + §10). The flag exists, is set on org provisioning, and is unread anywhere in route gating. PR-S6 keeps that contract. |
| `FixtureFolioBadge` dead-code cleanup | Slice B spec §9 keeps it dormant in S6 ("returns null"); cleanup is a separate follow-up PR. |
| Mira's surface | Phase D after launch (`launchTier: "day-thirty"`). |
| Migration of legacy routes (`/console`, `/decide`, etc.) into editorial shell | Phase D. |

### 1.3 Doctrine deviation (deliberate)

CLAUDE.md says specs and plans should land on `main` via focused docs PRs
before implementation begins. PR-S6 folds the spec into the implementation
PR (three commits: gate removal, fixture cleanup, spec doc). Justification:
PR-S6 is terminal — no future PR consumes this spec — and the scope is
already locked through brainstorm review. The PR description calls out this
deviation explicitly.

---

## 2. Decisions ledger

| # | Question | Locked answer |
| --- | --- | --- |
| Q1 | Scope | Three concerns: gate removal, fixture deletion, prod-env test cleanup. Nothing else. |
| Q2 | Flag wiring | Out of scope. `useAgentFirstNav` stays unread route-side per Slice B Q11 + §10. |
| Q3 | `FixtureFolioBadge` cleanup | Out of scope. Component stays dormant per Slice B spec §9. Separate follow-up PR. |
| Q4 | Verification depth | Manual production-mode smoke is the new gate. Build with `NEXT_PUBLIC_DEPLOY_ENV=production`, run, browse `/alex` + `/riley` for both an older existing org and a newly seeded org. |
| Q5 | Spec landing | Folded into PR-S6 (deliberate doctrine deviation; rationale in §1.3). |
| Q6 | Commit count | 3: gate removal, fixture cleanup, spec doc. Squash-merge to main. |

---

## 3. Files touched

### 3.1 Modified (3)

| File | Change |
| --- | --- |
| `apps/dashboard/src/app/(auth)/[agentKey]/page.tsx` | Delete the line `if (process.env.NEXT_PUBLIC_DEPLOY_ENV === "production") notFound();`. Single-line removal. |
| `apps/dashboard/src/app/(auth)/[agentKey]/__tests__/page.test.tsx` | Remove the test case `notFound() in production env` and the now-unused `ORIG_ENV` save/restore plumbing. |
| `apps/dashboard/src/app/(auth)/[agentKey]/__tests__/agent-home-client.test.tsx` | Replace the `getFixtureGreeting`-based `vi.mock("@/hooks/use-agent-greeting", …)` block with an inline-data mock matching the shape `{ data, isLoading: false, isError: false, error: null }` already used by the file's wins/metrics/pipeline mocks. Drop the `getFixtureGreeting` import. |

### 3.2 Deleted (2)

| File | Reason |
| --- | --- |
| `apps/dashboard/src/app/(auth)/[agentKey]/_fixtures.ts` | All four block hooks fetch live; only the greeting test consumed it. |
| `apps/dashboard/src/app/(auth)/[agentKey]/__tests__/fixtures.test.ts` | Sole purpose was asserting fixture shape; without the fixture, the test is moot. |

### 3.3 Untouched but verified

- `FixtureFolioBadge` component + its test — stay dormant per locked decision.
- All four `use-agent-*` hooks (`use-agent-greeting`, `-wins`, `-pipeline`, `-metrics`) — already live, no changes.
- API routes for greeting / wins / pipeline / metrics — unaffected.
- `OrgAgentEnablement` server check (`fetchEnabledAgentsServer`) — remains the single route-level gate.

**Net delta:** ~30 lines removed across 5 files. Zero new code.

---

## 4. Test plan + verification gates

### 4.1 Pre-merge gates (CI-blocking)

| Gate | What it catches |
| --- | --- |
| `pnpm typecheck` | Stale `_fixtures` references; mock-shape mismatch on `useAgentGreeting` return type. |
| `pnpm lint` | Unused imports left over after fixture removal. |
| `pnpm test` | All existing tests pass; the 2 deleted tests don't drag others down; the modified `agent-home-client.test.tsx` still asserts the 5-block render for both alex and riley. |
| Architecture check | Layer rules unaffected. |

### 4.2 Manual verification (PR-author responsibility, recorded in PR description)

| Step | Command / location | Expected |
| --- | --- | --- |
| **Dev smoke** | `pnpm dev`, browse `http://localhost:3002/alex` and `/riley` while signed in to a seeded org | All 5 blocks render (Greeting, Decisions, Wins, Metrics, Pipeline); no FIXTURE badges anywhere; no console errors. |
| **Production-mode smoke (the new gate)** | `NEXT_PUBLIC_DEPLOY_ENV=production pnpm --filter @switchboard/dashboard build && pnpm --filter @switchboard/dashboard start`, browse same URLs | All 5 blocks render; no 404 (gate removed); no FIXTURE badges (badge always null in prod mode). |
| **Older-org smoke** | Sign in as an org created **before** the Slice A `seedOrgDayOneAgents` backfill, browse `/alex` and `/riley` | Both render. If 404, the `OrgAgentEnablement` backfill needs to run before merging. |
| **Newly-seeded-org smoke** | Sign in as a freshly provisioned org, browse `/alex` and `/riley` | Both render. |
| **Disabled-agent fallthrough** | Org without `mira` enabled, browse `/mira` | 404 (sole gate is `OrgAgentEnablement`). |
| **Unknown-key fallthrough** | Browse `/zelda` | 404 (`AGENT_KEYS.includes()` rejects). |

### 4.3 Tests not added (and why)

- **No new "production env renders" unit test.** The page test currently
  asserts production env 404s — that case is being deleted, not replaced.
  A positive-path "production env renders AgentHomeClient" test would
  duplicate the existing "valid + enabled + non-prod" test, since the env
  check no longer exists in code.
- **No new isolation test.** Cross-org isolation is already covered by
  per-route isolation tests (greeting, wins, pipeline, metrics) shipped in
  S2–S5.
- **No new e2e/Playwright test.** Outside Slice B's testing strategy;
  manual smoke is the documented gate.

### 4.4 Rollback plan

Single-commit `git revert <merge-sha>`. The change is behaviorally additive
from the user's perspective — it makes enabled routes reachable. Reverting
restores the previous gated state. No data migration to undo.

---

## 5. Risks + mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Org created before Slice A `seedOrgDayOneAgents` lacks `OrgAgentEnablement` rows → 404 on `/alex` | Low | High | Pre-merge: §4.2 older-org smoke. If row missing, run backfill before merging. |
| Hydration mismatch / asset-path bug only manifests in `NEXT_PUBLIC_DEPLOY_ENV=production` builds | Low | Medium | §4.2 production-mode smoke catches this. |
| A block's live endpoint throws 500 in production data, taking the whole page blank | Low | Medium | `AgentBlockBoundary` (PR-S1) wraps every block. One failed block degrades to fallback markup; siblings render. |
| `FixtureFolioBadge` somehow renders ` · FIXTURE` in production | Very Low | Low | Triple safety: live endpoints always return `dataSource: "live"`; badge returns null when `NEXT_PUBLIC_DEPLOY_ENV === "production"` regardless of data; prod-mode smoke confirms no badges. |
| Some unrelated file imports `_fixtures.ts` that we missed | Very Low | High (build break) | `pnpm typecheck` catches at CI; pre-spec grep confirmed only the 2 test files reference it. |
| Reviewer asks for `useAgentFirstNav` wiring or `FixtureFolioBadge` cleanup mid-review | Medium | Low | PR description leads with: "Per Slice B spec §10 + Q11, this PR explicitly excludes flag wiring and badge cleanup. Follow-up PR will remove the dormant badge." |
| Bug surfaces post-merge in production | Low | High | One-commit `git revert` (§4.4). No data migration to undo. |

**Risks NOT carried forward from Slice B spec §11:** all
projection-correctness, voice-divergence, fixture-leakage, and per-agent
ambiguity risks were owned by S2/S3/S4/S5 and are already shipped + reviewed.

---

## 6. Commit + PR sequencing

### 6.1 Commits (in this order)

1. `feat(dashboard): remove production env gate from agent home (PR-S6)` — `page.tsx` (single-line delete) + `__tests__/page.test.tsx` (drop the prod-env test case).
2. `chore(dashboard): delete agent home fixtures (PR-S6)` — delete `_fixtures.ts` + `__tests__/fixtures.test.ts`; update inline mock in `__tests__/agent-home-client.test.tsx`.
3. `docs(redesign): pr-s6 cutover spec` — this spec file.

### 6.2 Branch + worktree

- Branch: `feat/slice-b-pr-s6-cutover` off current `main`.
- Worktree: `/Users/jasonli/switchboard-pr-s6` (matches S2 convention).
- After branch creation: run `pnpm worktree:init`, then iterate.

### 6.3 PR

- **Title:** `feat(redesign): PR-S6 — Slice B cutover (production gate + fixture cleanup)`
- **Body lead-in (verbatim):** "Per Slice B spec §10 + Q11, this PR explicitly excludes `useAgentFirstNav` flag wiring and `FixtureFolioBadge` cleanup. The flag is set on org provisioning but stays unread route-side; the badge stays dormant. Follow-up PRs will handle each."
- **Body checklist:** every row of §4.1 (CI gates) and §4.2 (manual smoke), as Markdown checkboxes.
- **Merge style:** squash, `--delete-branch`, matching repo convention.

---

## 7. References

- **Roadmap:** `docs/superpowers/specs/2026-05-03-agent-first-redesign-roadmap.md` (Phase B section + critical path)
- **Slice B parent spec:** `docs/superpowers/specs/2026-05-04-slice-b-agent-home-design.md` (esp. §9 PR-S6 row, §10 deferred items, Q11 flag decision, §11 risk list)
- **Already-shipped Slice B PRs:** PR-S1 (#366), PR-S2 (#369), PR-S3 (#382), PR-S4 (#387), PR-S5 (#388)
- **Memory entries:**
  - `project_alex_home_reports_designs_locked.md`
  - `project_agent_first_redesign.md`
  - `project_canonical_agent_names.md`
- **Doctrine:**
  - `CLAUDE.md` — branch & worktree doctrine; layer rules
  - `docs/DOCTRINE.md` — architectural rules
