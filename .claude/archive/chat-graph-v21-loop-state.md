# chat-graph-v21 slice loop — externalized state (orchestration scratch, not committed)

Durable record lives in memory note project_whatsapp_tech_provider_roadmap.

Goal: bump apps/chat Graph v17.0 -> v21.0 stragglers (instagram adapter default + whatsapp health-check) to match the stack.
Authority: wa-tech-provider loop item 2 — no stop-glob -> AUTONOMOUS-WITH-GUARDRAILS (auto-merge IFF all gates+CI green AND independent review zero >=warn AND high confidence). Task-size: trivial.
Base: origin/main @ 00b890ff4 (re-fetched 2026-06-16) baseline_sha: 00b890ff4
Worktree: .claude/worktrees/chat-graph-v21 Branch: launch/chat-graph-v21
merge_safety: stop-glob touched=NO (files: apps/chat/src/adapters/instagram.ts, apps/chat/src/managed/health-checker.ts + their tests; none match _send_/_auth_/_credential_/prisma/etc). independent_review=CLEAR (opus, 0 >=warn) PR: #1120

Ground truth (verified vs origin/main @ 00b890ff4):

- instagram.ts:84 `this.apiVersion = config.apiVersion ?? "v17.0"` (send URL :287 uses this.apiVersion). whatsapp.ts:81 already "v21.0".
- health-checker.ts:175 `fetch("https://graph.facebook.com/v17.0/${phoneNumberId}")` hardcoded v17.0 (WhatsApp phone health check).
- Co-located tests exist: apps/chat/src/**tests**/instagram.test.ts, apps/chat/src/**tests**/health-checker.test.ts.

| step                        | done-condition (test/cmd)                                 | RED proof                | status | evidence (cmd->result / file:line)                                                    |
| --------------------------- | --------------------------------------------------------- | ------------------------ | ------ | ------------------------------------------------------------------------------------- |
| A. instagram default -> v21 | instagram.test.ts asserts send URL uses /v21.0/           | seen-red (URL had v17.0) | DONE   | instagram.ts:84 -> "v21.0"; test asserts sendTextReply hits /v21.0/me/messages        |
| B. health-check -> v21      | health-checker.test.ts asserts checkWhatsApp hits /v21.0/ | seen-red (URL had v17.0) | DONE   | health-checker.ts:175 -> v21.0; test asserts checkWhatsApp fetch URL contains /v21.0/ |

gate_results: typecheck=PASS(21/21) test=PASS(chat 333/333) lint=PASS(0 err) format=PASS arch=PASS verify-fast=PASS(6/6) build=PASS(chat) review=CLEAR(opus 0>=warn; independently re-confirmed RED + low risk)
carry_forward (<=150 words): fresh worktree -> needs `pnpm install` (+ `pnpm build` of workspace deps before vitest, per project_chat_test_layout). No DB needed (no schema/migration). Delegated EXECUTE+gates to a sonnet subagent; independent review to a separate fresh-context opus agent (non-self-gradable). Auto-merge-eligible per loop item 2 only if review is clean.

## Log

- 2026-06-16: ORIENT done. Credit-line sharing (item 1) DESCOPED by user (clients self-pay). Worktree+branch off origin/main@00b890ff4. Found a 2nd v17.0 straggler (health-checker.ts:175) the backlog missed -> bundled into this slice. -> EXECUTE.
- 2026-06-16: EXECUTE done (sonnet subagent, TDD both steps RED->GREEN, full local gates green). VERIFY: independent opus review CLEAR (0 >=warn; it reverted to v17.0 to re-confirm RED). Removed 1 new em-dash from a test describe title (no-em-dash rule > reviewer's nit rating). Amended -> bb9ec3118. CONVERGE: origin/main unmoved @ 00b890ff4 (no divergence); pushed; opened PR #1120. Auto-merge authorized (no stop-glob, gates+review clean) -> awaiting CI green, then squash-merge.
- 2026-06-16: Remaining backlog ORIENT (parallel read-only Explore while CI runs). item 3 verify-token = NO-GAP (WhatsApp webhooks already use per-connection creds.verifyToken w/ timingSafeEqual, whatsapp.ts:114-117; META_WEBHOOK_VERIFY_TOKEN is consumed by the Meta LEADS webhook ad-optimizer.ts:7/53/60, not unused; only a possible future hardening = decouple verifyToken from appSecret, credential-path/surface-only, NOT a confirmed gap). item 4 Flows = NO-GAP (inbound fully handled: sendFlowMessage + nfm_reply parse + /whatsapp/flows data-exchange; registration is WhatsApp-Manager/Meta-config, not code). item 5 number-migration = niche cross-account porting, needs live-Graph + product decision, surfaced-not-built. => after #1120 merges the wa-tech-provider CODE backlog is EXHAUSTED; remaining work is Meta-side config. LOOP WILL STOP + REPORT (no invented work).
- 2026-06-16: CI round 1: all REQUIRED gates GREEN (branch-protection required = [typecheck,lint,test 10m4s,security]); also analyze/evals/docker/arch/secrets green. Non-required CodeQL check RED = 1 NEW HIGH js/incomplete-url-substring-sanitization at health-checker.test.ts:188 (my OWN test's `url.includes("graph.facebook.com")` mock-call filter; not prod code, but a real pattern hit). Fixed: includes -> `startsWith("https://graph.facebook.com/")` (CodeQL-recommended anchored host check + tighter assertion, NOT a suppression). Re-verified: health-checker test 7/7 + prettier + eslint green. Amended 48fd6a865, force-pushed -> CI round 2. Lesson: the fresh-context independent review does NOT run CodeQL; CI CodeQL caught it. CodeQL is NOT a required check here so it would not block the merge button, but auto-merge bar = do not merge over an unexamined HIGH.
- 2026-06-16: CI round 2 fully GREEN for head 48fd6a865 (CodeQL=pass; required typecheck/lint/test/security=pass; mergeStateStatus=CLEAN, MERGEABLE). Pre-merge re-check: origin/main advanced 00b890ff4 -> 5c77f12ee under me (parallel session; no file overlap; GitHub CLEAN). Squash-merged #1120 -> main `110d72469`. HYGIENE: local main ff'd to 110d72469; worktree removed+pruned; local branch deleted; remote head auto-deleted; other sessions' worktrees untouched. Memory updated (roadmap residual-RESOLVED block + CodeQL incomplete-url-substring lesson). SLICE A CLOSED.
- 2026-06-16: LOOP STOPPED + REPORTED. wa-tech-provider CODE backlog EXHAUSTED: item1 credit-line sharing DESCOPED (self-pay), item2 v21 bump SHIPPED (#1120), item3 verify-token NO-GAP, item4 Flows NO-GAP, item5 number-migration deferred. Remaining Tech-Provider work = META-SIDE config only (not code).
