# P0.2a calendar per-deployment creds loop — externalized state (orchestration scratch, not committed)

Durable record lives in memory note project_north_star_activation_gap.

Goal: factory builds a Google provider from the org's OWN per-deployment OAuth creds (DeploymentConnection google_calendar) when present; global env then Local then Noop fallback.
Authority: autonomous-with-guardrails, BUT touches connection-credentials (merge-stop) + OAuth -> auto-merge ONLY if all gates green + independent fresh-context review zero findings>=warn + divergence clean + high confidence; else SURFACE.
Task-size: standard (one bounded PR).
Base: origin/main @ 8c54d56d2 (re-fetch before merge) baseline_sha: 8c54d56d2 (pre-impl)
Worktree: .claude/worktrees/calendar-per-deployment-creds Branch: feat/calendar-per-deployment-creds
merge_safety: stop-glob touched=YES (connection-credentials/OAuth) independent_review=PENDING

## Ground truth (verified 2026-06-20 vs origin/main)

- Factory createCalendarProviderFactory(deps) keyed by orgId (calendar-provider-factory.ts:5,28); caches per org; queries organizationConfig.businessHours. Google branch :76-94 reads ONLY global env GOOGLE_CALENDAR_CREDENTIALS/GOOGLE_CALENDAR_ID (service-account JSON -> google.auth.JWT via google-calendar-factory.ts). Then Local (businessHours) -> Noop.
- OAuth callback google-calendar-oauth.ts:168-208 writes per-deployment DeploymentConnection (type google_calendar) OAuth tokens {refreshToken, accessToken, calendarId, calendarSummary, expiryDate} (encrypted). Read precedent :269 -> decrypt + google.auth.OAuth2 + setCredentials({refresh_token}). DIFFERENT auth than the JWT global path.
- Resolution: PrismaDeploymentConnectionStore has NO findByOrgAndType; deploymentConnection.findFirst({where:{type:"google_calendar", deployment:{organizationId}}}) works (relation org-scoping, mirrors findByDeploymentAndTypeForOrg). "Pilot: one deployment per org" (skill-mode.ts:669) => 1:1.
- Provider identity: instanceof GoogleCalendarAdapter (receipt-tier.ts -> T1_FETCH_BACK). decryptCredentials(blob, key?) throws w/o CREDENTIALS_ENCRYPTION_KEY. healthCheck() hits network but swallows errors. vi.mock precedent strong (googleapis, @switchboard/db importOriginal, relative siblings).
- Callers pass {prismaClient, logger} only (skill-mode.ts:175; erase via app.ts:947; meta-deletion.ts) => new deps MUST be optional/defaulted.
- Prompt "organizations.ts ~395 decrypts per-org google_calendar" = memory drift (that file seeds chat-channel DeploymentConnections at :332). Real precedent = oauth route.

## FRAME — locked design (autonomous judgment; no committed spec on impl branch)

- Resolution inside apps/api (NOT a new packages/db store method, NOT signature change): new module `apps/api/src/bootstrap/deployment-calendar-creds.ts` exporting `resolveOrgGoogleCalendarCreds(prisma, orgId, decrypt=decryptCredentials) -> {refreshToken, calendarId} | null` via `deploymentConnection.findFirst({where:{type:"google_calendar", deployment:{organizationId:orgId}}, orderBy:{updatedAt:"desc"}})` then decrypt; null if no row or no refreshToken; calendarId defaults "primary".
- New sibling in google-calendar-factory.ts: `createGoogleCalendarProviderFromOAuth({clientId, clientSecret, refreshToken, calendarId, businessHours})` -> google.auth.OAuth2 + setCredentials({refresh_token}) + GoogleCalendarAdapter. Pure of env (client creds passed in).
- Factory env gains GOOGLE_CALENDAR_CLIENT_ID + GOOGLE_CALENDAR_CLIENT_SECRET (ALREADY allowlisted; oauth route reads them) in both the deps.env type and the process.env fallback.
- Precedence in resolveForOrg: (1) per-deployment OAuth creds present AND clientId+secret present -> build OAuth provider, healthCheck, return (try/catch log + fall through on failure); (2) global env service-account JWT (existing); (3) Local (businessHours); (4) Noop.
- Cache staleness (connect-after-cache) OUT of scope; extend the :23-25 comment.
- Test seam: resolver unit-tested via encrypt->resolve round-trip (test key, real crypto, no network); factory branch test vi.mocks ../deployment-calendar-creds.js + ../google-calendar-factory.js (no Google client built); createGoogleCalendarProviderFromOAuth tested with vi.mock("googleapis") auth.OAuth2. NEVER hit real Google API.
- Doctrine: read-only (no mutation/bypass), org-scoped tenant-safe, creds never logged, confined to apps/api (no layer/cycle), signature unchanged (no caller ripple).

## Plan steps (TDD)

| step                                     | done-condition (test/cmd)                                            | RED proof                        | status      | evidence                                                          |
| ---------------------------------------- | -------------------------------------------------------------------- | -------------------------------- | ----------- | ----------------------------------------------------------------- |
| T1 createGoogleCalendarProviderFromOAuth | google-calendar-factory test green                                   | YES "is not a function" (2 fail) | DONE        | 6 passed; OAuth2 called (cid,sec)+setCredentials({refresh_token}) |
| T2 resolveOrgGoogleCalendarCreds         | deployment-calendar-creds test green                                 | pending                          | in_progress |                                                                   |
| T3 factory Option-1 branch + env         | calendar-provider-factory.google green + existing factory test green | pending                          | pending     |                                                                   |

gate_results: typecheck=PASS(21/21) test=PASS(api 2270; chat 338 isolated; full-suite chat flake under concurrent load, not mine) lint=PASS(0 err,82 pre-existing warn) format=PASS arch=PASS(no err-level) verify-fast=PASS security=PASS(audit exit 0) build=PASS(10/10) eval=n/a review=PENDING(2 reviewers dispatched)
Base now: origin/main @ 559628a5b (+2 since branch: #1194 skill-executor, #1195 contacts money; ZERO overlap with my apps/api/bootstrap files). My commit: 394acc6c4. Must rebase onto 559628a5b before any merge.
review: 2 independent fresh-context opus reviewers (security/tenant + correctness/test-quality) BOTH returned OVERALL PASS, ZERO findings >=warn. Only nits: em-dash in comment (FIXED), resolveForOrg complexity 18>15 (non-blocking lint warning, reviewers said skip, matches package norms). Tenant-isolation PROVEN safe (DeploymentConnection has no organizationId column; org-scoped relation join is only path).
CONVERGE: amended commit ea422f9db -> rebased onto origin/main 559628a5b -> now 09515143d. Three-dot diff = exactly 6 files. Post-rebase rebuild+typecheck+api-test running (bg bns1p7btg).
DECISION: bar MET for auto-merge per user's explicit slice authorization (all gates green + clean independent review + clean divergence + high confidence). Honoring user instruction over build-loop's default merge-stop-surface (instruction priority). Plan: push -> PR -> GitHub CI green -> squash-merge -> cleanup.
carry_forward: If post-rebase re-verify green, push+PR+CI-gated squash-merge. If CI flakes (chat known-flaky), rerun. After merge: remove worktree, update memory project_north_star_activation_gap (P0.2a done), then continue loop to P3.1.

## ACTIVATION BACKLOG LOOP PROGRESS (3 slices)

- SLICE 1 P0.2a (calendar per-deployment creds): MERGED PR #1197 (squash 0732c3d59). Worktree removed. DONE.
- SLICE 2 P3.1 (ledger weekly-report cron live-path test): MERGED PR #1198 (squash 907be3549). All gates green local+CI (lint/security/test/typecheck/architecture/docker/CodeQL), 1 indep review PASS (mutation-tested, 0 findings>=warn). Worktree+branch removed. DONE. main now @ 907be3549.
- SLICE 3 P3.2 (dashboard reports route real-store integration test: apps/api/src/routes/dashboard-reports.ts -> createPeriodRollup -> listForCohort; owner tiles tested only vs static fixtures, not real Prisma projection): NOT STARTED. PURE TEST, skip brainstorming. RECOMMENDED: do in a FRESH session (this one is long). To resume: new session + "Follow .claude/build-loop.md, drive activation slice P3.2, autonomous-with-guardrails" OR re-issue the /loop. STOP CONDITION after slice 3: report "activation code backlog exhausted." OUT of scope: P0.2b getBooking, P1 go-live config, P2 identity matcher/refunds.

## Log

- 2026-06-20: ORIENT complete. Ground truth verified vs origin/main @ 8c54d56d2. Worktree created. -> FRAME.
- 2026-06-20: SLICE P0.2a SHIPPED. PR #1197 squash-merged as 0732c3d59. All gates green (local+CI: typecheck/lint/test/security/build/audit), 2 independent reviews zero findings>=warn, divergence clean. Worktree+branch removed, primary main ff'd. Auto-merged per user's explicit slice authorization (bar met). -> next slice P3.1.
