# A15 — operator/escalation per-org WA send + window gate — loop state (orchestration scratch, not committed)

Durable record lives in memory note project_launch_readiness_state / MEMORY index. Slice closes P1-1 + P1-2 (second-wave gap eval).

Goal: per-org WhatsApp send creds + org-scoped 24h window gate on the two human-reply routes (operator send + escalation release).
Authority: SURFACE-before-merge (external WA send + multi-tenant isolation merge-stop globs; human makes the merge call).
Task-size: standard (one bounded PR).
Base: origin/main @ a2de9564f baseline_sha: a2de9564f (re-confirm before merge)
Worktree: .claude/worktrees/agents-fix-a15 branch: fix/a15-operator-send-window-gate
merge_safety: stop-glob touched = YES (external WA send path + multi-tenant). independent_review = pending.

## ORIENT ground-truth brief (all tool-verified vs a2de9564f)

THE LEAK (both confirmed at cited lines):

- Send creds: `app.ts:432-442` builds ONE `ProactiveSender` from process-global env (`resolveWhatsAppSendToken()` + `WHATSAPP_PHONE_NUMBER_ID`). Both reply routes call `app.agentNotifier.sendProactive(destinationPrincipalId, channel, message)` with NO org -> org B's reply ships from org A's WABA number.
- Window gate: `app.ts:423-431` `conversationState.findFirst({ where:{ principalId, channel:"whatsapp" }, orderBy:{ lastInboundAt:"desc" } })` — NO organizationId. principalId non-unique + organizationId nullable -> freshest cross-org row opens the window for the wrong org.

BLAST RADIUS (narrow): `app.agentNotifier.sendProactive` is called by EXACTLY two routes — conversations.ts:341 (operator send) + escalations.ts:367 (escalation reply). The 4 proactive workflows do NOT use the singleton (own send path in contained-workflows.ts). `new ProactiveSender` only at app.ts:432 + tests. Both routes have `orgId = request.organizationIdFromAuth` in scope (conversations.ts:296). `storeResult` has NO organizationId (confirmed).

REUSE (A1 pattern, contained-workflows.ts:365-369 + followup-workflow:117-119):

- `resolveOrgWhatsAppSendCreds(connectionStore, orgId)` (lib/whatsapp-send-creds.ts:62) reads org `Connection` serviceId="whatsapp" (NOT DeploymentConnection, NOT "meta-ads"); returns `{token,phoneNumberId}|null`.
- Per-field env fallback at call site: `perOrg?.token ?? resolveWhatsAppSendToken()`, `perOrg?.phoneNumberId ?? process.env["WHATSAPP_PHONE_NUMBER_ID"]`.
- `new PrismaConnectionStore(prismaClient)`; `prismaClient` is in scope at the app.ts notifier wiring (used at :424).

THE RATE-LIMIT TRAP: `ProactiveSender` (packages/core/.../proactive-sender.ts:51) holds `private dailyCounts = new Map` (line 53) + `MAX_DAILY_MESSAGES=20`. Construction-bound. MUST NOT reconstruct per request. Creds also construction-bound (`this.credentials.whatsapp`). -> thread per-org creds INTO the single sender via an injected resolver + an org param on sendProactive.

WINDOW-SOURCE CONVERGENCE (the one open design question — SETTLED, see FRAME below): reply path uses ConversationState.lastInboundAt (phone-keyed, org NULLABLE); every other WA-window consumer (4 workflows + skill-mode:606 + proactive-eligibility:83) uses ConversationThread.lastWhatsAppInboundAt (contact-keyed, org NON-NULL, dedicated `@@index([organizationId,lastWhatsAppInboundAt])`, written by gateway-conversation-store.ts:101 on WA inbound). Decision: keep reply path on ConversationState, org-scope it. Rationale in FRAME.

NO migration (existing indexes suffice; org-scope is a WHERE filter). NO new env var (reuse A1 fallback). NO new metric (not required by plan).

Test patterns to mirror: whatsapp-send-creds.test.ts (`makeReader` ConnectionCredentialReader fake -> drives REAL resolver); whatsapp-send-test.test.ts (assert Graph URL contains phoneNumberId + `Authorization: Bearer <token>`; here via `vi.stubGlobal('fetch')` since ProactiveSender.sendWhatsApp uses global fetch). Harness build-conversation-test-app.ts injects a FAKE notifier -> A15 needs a real-ProactiveSender path via a testable factory.

| step                   | done-condition (test/cmd) | RED proof | status | evidence |
| ---------------------- | ------------------------- | --------- | ------ | -------- |
| (to be filled at PLAN) |                           |           |        |          |

gate_results: typecheck=PASS test=PASS(core 4449/api 2407) lint=PASS(0err) format=PASS arch=PASS verify-fast=PASS check-routes=PASS security=PASS(audit exit0) build=PASS eval=N/A(launch) review=SHIP(0 findings>=warn) plan-grade=PASS(3/3 opus)

OUTCOME: SUPERSEDED. Pre-surface divergence re-check found rival OPEN PR #1253 (fix/wa-reply-per-org, same author, MERGEABLE, all checks green except `test` pending) = a complete A15 from a concurrent session that appeared AFTER my clean ORIENT scan. #1253 made the CORRECT window-source decision (ConversationThread.lastWhatsAppInboundAt). My Option A (org-scope ConversationState.lastInboundAt) is DEFECTIVE: that column is DEAD in production (no producer ever writes it a fresh value — verified whole-repo; gateway-bridge.ts upsert sets neither lastInboundAt nor a non-null org), so my gate would evaluate isWithinWhatsAppWindow(null) -> always false -> every operator/escalation reply throws WhatsAppWindowClosedError and never sends. My green gates + SHIP review MISSED it because tests SEEDED the dead row (false-fixture trap, [[feedback_safety_gate_needs_producer_population]]). DECISION: do NOT fork a competing PR (doctrine: do not fork a rival); recommend the human merge #1253; my branch fix/a15-operator-send-window-gate (6 commits, never pushed) is local-only and can be torn down (e2e route->Graph test is the only possibly-salvageable piece). NO MERGE (SURFACE-before-merge + #1253 test pending).
carry_forward: PLAN written (.claude/agents-fix-A15-plan.md, 5 TDD tasks) + fan-out grade PASS (3 opus, all PASS, no >=2-overlap). Refinements folded: app.ts Task3 Edit spans 403-449 inclusive (no dup `let agentNotifier`); no-direct-conversation-state-mutation.test.ts also calls sendProactive but asserts only sendOperatorMessage/updateSpy (org_1) -> unaffected by 4th arg, whole-suite VERIFY safe; makeReader fake mirrors PrismaConnectionStore.getByService decrypted ConnectionRecord shape (credentials: Record<string,unknown> confirmed matching). No migration (single-col indexes serve the org-scoped query; composite considered+rejected as perf nicety). Next: EXECUTE Tasks 1-5 (TDD inline), then VERIFY (verifier + independent review), then SURFACE.

## Log

- 2026-06-22: ORIENT complete. Worktree was missing (stale list entry); recreated off origin/main@a2de9564f + pnpm install (DB down, build/migrate/seed skipped) + built schemas/core/db. All cites re-verified vs a2de9564f; none drifted. Blast radius narrow (2 routes). Convergence decision = Option A (org-scope ConversationState).
- 2026-06-22: FRAME settled (Option A window source + injected resolveWhatsAppCredentials, single sender). PLAN written (5 tasks). FAN-OUT plan grade: CRITIC/COMPLETENESS/CODE-GROUNDED all PASS; 3 non-overlapping minor warns folded in. -> EXECUTE.
- 2026-06-22: EXECUTE complete (5 TDD tasks, 6 commits 498ec92de..a6d2987a3). VERIFY: all 11 gates GREEN; independent opus review SHIP (0 findings>=warn, criteria a/b/c MET). Em-dash nit fixed.
- 2026-06-22: CONVERGE pre-surface divergence re-check found rival OPEN PR #1253 (concurrent session, correct window source). Verified whole-repo that ConversationState.lastInboundAt is DEAD (no producer) -> my Option A window gate is non-functional in prod (always closed). #1253's ConversationThread.lastWhatsAppInboundAt source is correct + live. SUPERSEDED. Surfacing #1253 recommendation to human; NOT forking a competing PR; no merge. Durable lesson appended to feedback_safety_gate_needs_producer_population.
