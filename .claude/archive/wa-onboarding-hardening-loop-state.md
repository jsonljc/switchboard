# wa-onboarding-hardening loop — externalized state (orchestration scratch, not committed)

Durable record lives in memory note project_whatsapp_tech_provider_roadmap.md.

Goal: harden WhatsApp ESU onboarding — primarily phone /register two-step PIN handling.
Authority: SURFACE-before-merge for EVERYTHING (credential/onboarding/send path). Brainstorm/plan/execute/review autonomous; merges are the user's.
Task-size: multi-PR bounded universe (4 PRs); each PR = standard (one bounded PR). Drive ONE PR per iteration.
Base: origin/main @ 58457c9e1 (re-fetch each slice).
Brainstorm: .claude/wa-onboarding-hardening-brainstorm.md (Option A chosen). Plan: .claude/wa-onboarding-hardening-plan.md.

Bounded universe (priority order; each its own focused PR; ALL surface-before-merge):

1. PR-1 server: onboard route accepts optional `pin`, uses `pin||"000000"`, surfaces register failure (422+code for PIN; 502+detail else). PRIMARY. <- IN PROGRESS
2. PR-2 dashboard: ESU component optional PIN field + actionable-error surfacing; proxy + api-client forward `pin`. CONSUMER (after PR-1).
3. PR-3 server: assigned_users `tasks=['MANAGE']` -> URL-encoded JSON array `["MANAGE"]` (audit #7). Same file as PR-1.
4. PR-4 core: notifier Graph v18.0 -> v21.0 (whatsapp-notifier.ts:17, proactive-sender.ts:147). Independent pkg.

Seam (PR-1->PR-2): body `pin?:string` (empty->"000000"); 422 `{error,code:"whatsapp_registration_pin_required",detail}`; 502 `{error,detail}` for other register failures. Order PR-1 before PR-2.

merge_safety: stop-glob touched = YES (credential/onboarding for PR-1/2/3; external-send for PR-4). independent_review = pending per PR. Auto-merge DISALLOWED for all.

| step (PR) | done-condition (test/cmd)                                                  | RED proof                                        | status         | evidence (cmd->result / file:line)                                                                                        |
| --------- | -------------------------------------------------------------------------- | ------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| PR-1      | api test green: 422 on 2SV register err + pin forwarded; helper unit tests | helper import fails; 422 test gets 200 (phantom) | SURFACED #1102 | all gates GREEN; review 1 BLOCK (em-dash) FIXED; HEAD 82e94d0bd; merges clean into main c86360d1c                         |
| PR-2      | dashboard test: PIN field sends `pin`; 422+code renders actionable         | label-not-found (RED)                            | SURFACED #1105 | gates GREEN (format:check is .ts-only=PASS; .tsx clean); review mergeable, 3 nits only; merge AFTER #1102; HEAD 6a0afe8d0 |
| PR-3      | api test: assigned_users URL = JSON array, not `['MANAGE']`                | URL contains `['MANAGE']`                        | SURFACED #1106 | gates GREEN; review mergeable; HEAD 92bb7f401; CROSS-PR: shares test file w/ #1102 (max-lines at 2nd merge)               |
| PR-4      | core test: proactive-sender URL = v21.0                                    | URL contains v18.0                               | SURFACED #1107 | gates GREEN; review mergeable; HEAD f3628d03f; follow-up: instagram adapter still v17.0                                   |

LOOP CLOSED 2026-06-15 — ALL MERGED to main (user authorized merge). Final main: 70ca54e1a.

- #1107 MERGED 70f70d1ec (notifier v18->v21)
- #1102 MERGED c26b83c84 (server /register 2SV pin)
- #1105 MERGED f86e4f366 (dashboard pin field)
- #1109 MERGED 4c7d98932 (flake-fix: aria-invalid waitFor race from #1105; surfaced by #1106 CI)
- #1106 MERGED 70ca54e1a (assigned_users JSON array; test moved to new sibling file to dodge the shared-file max-lines landmine)
  Merge order respected seams (#1102 before #1105) + the #1102/#1106 shared-test-file hazard (split, not compact). Hygiene DONE: all 5 worktrees + local branches removed, remote branches auto-deleted, local main synced to 70ca54e1a, all 5 changes grep-verified present on main. Two surfaced-NOT-built follow-ups remain: number migration + credit-line sharing; plus instagram adapter v17.0 (own follow-up). Memory note project_whatsapp_tech_provider_roadmap.md updated. SAFE TO CLOSE SESSION.
  gate_results PR-3: typecheck=PASS test(api)=PASS lint=PASS format=PASS arch=PASS verify-fast=PASS security=PASS build=PASS review=mergeable
  gate_results PR-4: typecheck=PASS test(core)=PASS lint=PASS format=PASS arch=PASS verify-fast=PASS security=PASS build=PASS review=mergeable(instagram-v17 follow-up)

gate_results PR-1: typecheck=PASS test(api)=PASS lint=PASS format=PASS arch=PASS verify-fast=PASS security=PASS build=PASS review=1-block-fixed
gate_results PR-2: typecheck=PASS test(dash)=PASS lint=PASS(dash-stub;build+tsc cover) format=PASS(.ts-only) arch=PASS verify-fast=PASS security=PASS build=PASS review=mergeable(3 nits)
carry_forward (<=150 words): First run done: ORIENT (synced main to origin/main 58457c9e1, read all 7 ground-truth files, verified audit line numbers drift -> register L188-191, assigned_users L171), brainstorm (Option A), plan (4 PRs) all written. Audit refinement: a 2SV register failure is NOT a 502 (audit stale) but a PHANTOM 200 — prod graphApiFetch ignores res.ok and the route discards the register result. PR-1 worktree: .claude/worktrees/wa-onboard-register-pin (branch launch/wa-onboard-register-pin). Execute PR-1 via subagent (TDD, RED proof), then delegated gate-run, then independent review, then SURFACE for user merge. Then iterate PR-2/3/4 (PR-2 after PR-1; PR-3 same file as PR-1 -> rebase; PR-4 independent).

## Log

- 2026-06-15: ORIENT+FRAME+PLAN done (first run). Brainstorm Option A, plan 4 PRs, ledger created. Next: EXECUTE PR-1.
- 2026-06-15: PR-1 EXECUTE (TDD subagent, RED proven both legs) + plan-grade PASS + gate-run all GREEN + independent Opus review (1 BLOCK em-dash, FIXED, amended). main advanced 58457c9e1->c86360d1c (concurrent #1097/#1098, no overlap). PR #1102 OPEN, surfaced for merge. Next: PR-2 dashboard (consumer).
- 2026-06-15: PR-2 (#1105) dashboard PIN field + 422 surfacing; TDD RED (label-not-found); gates GREEN (format:check is .ts-only=PASS; .tsx clean separately; dashboard lint is a stub -> build+tsc are the real catches); review mergeable (3 nits). SURFACED, merge after #1102.
- 2026-06-15: PR-3 (#1106) assigned_users JSON array + PR-4 (#1107) notifier v18->v21 done in PARALLEL (2 impl subagents) + combined verify+review (Opus) each GREEN/mergeable. PR-3 shares whatsapp-onboarding.test.ts with #1102 -> max-lines cross-PR note in PR body. PR-4 review flagged instagram adapter v17.0 as out-of-scope follow-up. LOOP COMPLETE: all 4 bounded-universe items surfaced; stopping per terminal condition.
