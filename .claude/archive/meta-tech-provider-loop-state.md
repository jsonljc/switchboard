# meta-tech-provider slice 1 (meta-ads oauth connect) loop — externalized state (orchestration scratch, not committed)

Durable record lives in memory note project_launch_readiness_state / moc_launch_readiness.

Goal: make the dashboard "Connect with Meta" flow click-through + recordable (no 400, no 404). Authority: SURFACE-before-merge (open PR, human makes merge call). Task-size: standard
Base: origin/main @ 692ed8b7 (re-fetched 2026-06-15) baseline_sha: 692ed8b76fa8c1344232ae724601788fbb106462
Worktree: .claude/worktrees/meta-oauth-connect Branch: launch/meta-oauth-connect
merge_safety: stop-glob touched=YES-cosmetic (new file under `app/(auth)/...` matches `**/*auth*` via the route-group name; connection/credential UI area). No real authn/authz/schema/money change. AUTHORITY=surface anyway -> human merge call. independent_review=ADDRESSED (google-cal callback mislabel FIXED+test; stray em-dash FIXED; multi-deployment first-deployment anchor doc'd; Connection-vs-DeploymentConnection badge gap surfaced as known-limit, API-side/out-of-scope)

Scope (slice 1 of 11; do ONLY this): dashboard click-path. apps/api OAuth legs (authorize/callback/token-exchange/store) are REAL+tested -> UNTOUCHED. Out: WhatsApp Embedded Signup, act-leg/money, connect-time account chooser, CAPI.

Ground truth (confirmed vs origin/main):

- service-field-configs.ts:14,49 getUrl(deploymentId?) ALREADY accepts the id. Bug = call site connections-list.tsx:332 calls .getUrl() with NO arg -> authorize 400.
- useOrgDeploymentId() exists (use-deployments.ts:28-35), returns org's first deployment id as anchor, already tested -> reuse for fix #1 (no new picker; honors "no connect-time chooser").
- callback redirect target = ${DASHBOARD_URL}/connections/callback?connected=true&deploymentId=... ; page absent -> 404 (fix #2).
- useConnections lists ORG connections; OAuth writes a DEPLOYMENT connection (Connection vs DeploymentConnection split) -> badge surfacing is API's domain; fix #3 = trigger the refetch at dashboard layer + back-link. Caveat in PR.

| step                                     | done-condition (test/cmd)           | RED proof                                                 | status | evidence (cmd->result / file:line)                                                                |
| ---------------------------------------- | ----------------------------------- | --------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------- |
| A. wire real deploymentId + guard button | connections-list.test.tsx           | seen-red (href lacked ?deploymentId; button not disabled) | DONE   | 2 tests green; connections-list.tsx:92 useOrgDeploymentId; button disabled={!oauthDeploymentId}   |
| B. /connections/callback page render     | connections-callback-page.test.tsx  | seen-red (module 404 / wrong product label)               | DONE   | 5 tests green; page reads connected/deploymentId/service (Suspense); back-link /settings/channels |
| C. refresh connections on return         | callback test invalidateQueries spy | seen-red (not called)                                     | DONE   | invalidate keys.connections.all() on connected; not called otherwise                              |

gate_results: typecheck=PASS(21/21) test=PASS(dashboard 2302 + new 7) lint=PASS(16/16) format=PASS arch=PASS verify-fast=PASS build=PASS(next, /connections/callback emitted) review=ADDRESSED
carry_forward (<=150 words): worktree:init ran but DB unreachable -> skipped migrate/build/seed; ran manual `pnpm install` (done) + `pnpm build` (warming) so typecheck/next-build have dist. next build may not run locally without DB (pre-existing worktree limit) -> CI covers; verifier falls back to typecheck + --filter dashboard test + lint + format + arch + verify-fast. Self-execute the 3 small edits (full context held); DELEGATE the gate-run + a fresh-context independent review (non-waivable). No 2B fan-out (proportionate to contained UI slice); adversarial budget spent on VERIFY review.

## Log

- 2026-06-15: ORIENT done. Worktree + branch created off origin/main@692ed8b7; install ok; build warming. Ground-truth brief above tool-backed. -> FRAME/PLAN.
- 2026-06-15: EXECUTE done (TDD A/B/C, each seen-red->green). Committed d012999. VERIFY: gate-runner ALL GREEN (typecheck needed 1x db:generate for pre-existing stale prisma artifact, not my diff); independent review surfaced 5 findings, fixed the 2 code ones (google-cal mislabel, em-dash) + tightened comment, down-scoped fix#3 (data-model). Re-ran gates green post-amend.
- 2026-06-15: SURFACED. origin/main advanced 692ed8b7->cd93cd1c during work (no file overlap; clean three-dot). Pushed launch/meta-oauth-connect; opened PR #1078. STOPPED before merge per AUTHORITY (human merge call). Slice 1 of 11 complete.
- 2026-06-15: MERGED (user authorized merge). All 14 CI checks green (test 9m51s, typecheck, lint, architecture, security, CodeQL, evals, docker). Squash-merged PR #1078 -> main squash `5ab1d05` (now ancestor of origin/main 002260769 after #1077 landed on top). HYGIENE DONE: remote head auto-deleted; local main ref ff'd to origin/main; feature worktree removed+pruned; local branch launch/meta-oauth-connect deleted; parallel session worktree (feat/receipted-booking-write-path-revenue) untouched + no MERGE_HEAD. Memory: slice-1-shipped + lessons recorded in [[project_whatsapp_tech_provider_roadmap]]. SLICE CLOSED. Next: campaign slices 2-11 (scope decisions D-a..D-d).
