# A1 multi-tenant WhatsApp send identity — loop state (orchestration scratch, not committed)

Durable record: memory [[project_all_agents_improvement_audit]]; plan slice A1 in
docs/superpowers/plans/2026-06-20-all-agents-fix-plan.md.

Goal: all 4 proactive WhatsApp send sites resolve the sending org's OWN {token, phoneNumberId}
(per-org), falling back to global env for the single-tenant pilot. Fixes the cross-tenant send bug
(tenant #2 sending from tenant #1's number).
Authority: SURFACE-before-merge (touches external send + credentials; merge-stop -> human merge).
Task-size: standard (one bounded PR).
Base: origin/main @ 10fd9a24e (re-fetch before merge). Worktree: .claude/worktrees/agents-fix-a1-mt-send
branch fix/multitenant-whatsapp-send.
merge_safety: stop-glob touched = YES (external send paths + credentials) -> SURFACE.

## ORIENT (done)

- 4 send sites (apps/api): conversation-reminder-send-workflow.ts (token :103, phoneId :104, POST inlined :126),
  conversation-followup-send-workflow.ts (:104/:105, POST :125), meta-lead-greeting-workflow.ts
  (:125/:126, POST :148, has a LOCAL resolveWhatsAppSendToken copy :17), bootstrap/robin-recovery-executor.ts
  (token resolveToken() :134 dep :55 default :111, phoneId resolvePhoneId() :135 dep :56 default :113,
  send via injectable sendTemplate).
- Shared token alias: apps/api/src/lib/whatsapp-send-token.ts:16 (WHATSAPP_ACCESS_TOKEN ?? WHATSAPP_TOKEN).
  phoneId read directly as process.env WHATSAPP_PHONE_NUMBER_ID at every site (no shared resolver).
- Per-org cred SOURCE = org-level Connection serviceId "whatsapp" (canonical, holds {token, phoneNumberId};
  shape apps/api/src/lib/whatsapp-connection-data.ts:52-59). Read via PrismaConnectionStore.getByService("whatsapp", orgId)
  (decrypted, org-scoped). DeploymentConnection type "whatsapp" does NOT hold these (no producer). Inbound/reply
  reads the same Connection (runtime-registry.ts:63-64 getById + resolveWhatsAppRuntimeToken: creds.token -> META_SYSTEM_USER_TOKEN).
- Template to mirror (#1197): deployment-calendar-creds.ts resolveOrgGoogleCalendarCreds(prisma, orgId, decrypt) +
  calendar-provider-factory.ts (precedence per-org -> global -> Local -> Noop). We mirror the per-org->global precedence
  but read via the Connection store and resolve PER-REQUEST (no process-lifetime cache; avoids the rank-13 staleness twin).
- Wiring: all 4 constructed in apps/api/src/bootstrap/contained-workflows.ts (followup :343, reminder :363,
  robin :387, greeting :410); each receives orgId (workUnit.organizationId) at send time. buildWhatsAppSendContext :302
  already reads per-org data. Keep workflow files prisma-free: inject a resolveOrgSendCreds dep from contained-workflows.ts.
- Tests: services/workflows/**tests**/{reminder,followup,greeting}-\*.test.ts + bootstrap/**tests**/robin-recovery-executor.test.ts.
  Pattern: pure unit, vi.fn-mocked getSendContext, vi.stubGlobal fetch for inlined sites, env in beforeEach/afterEach.
  No Postgres.

## ENV NOTE (resolved)

Local non-frozen install drifted TS to 6.0.3 + stale lower-layer dist -> false TS7006 implicit-any on untouched files.
CI (`pnpm typecheck` = turbo, builds deps first) is GREEN on main (#1201 merged, #1204 off-main). Fix = `pnpm reset`
then `pnpm typecheck` (CI-faithful). Re-running now for a trustworthy baseline.

## FRAME (decided)

- Source = org Connection serviceId "whatsapp" via connectionStore.getByService (rejected DeploymentConnection: no producer
  writes the creds; rejected re-implementing decrypt: getByService already decrypts + org-scopes).
- Resolver = NEW apps/api/src/lib/whatsapp-send-creds.ts: resolveOrgWhatsAppSendCreds(connectionStore, orgId) ->
  Promise<{token: string|null, phoneNumberId: string|null} | null>. Per-request (no cache).
- Each send site applies PER-FIELD fallback: phoneNumberId = perOrg?.phoneNumberId ?? env WHATSAPP_PHONE_NUMBER_ID;
  token = perOrg?.token ?? resolveWhatsAppSendToken(). (Critical fix = phoneNumberId becomes per-org; token may be the
  per-org BYOT or the global system token, mirroring inbound resolveWhatsAppRuntimeToken.)
- Injection: add OPTIONAL dep resolveOrgSendCreds?: (orgId)=>Promise<{token,phoneNumberId}|null> defaulting to
  `async () => null` (so existing tests that omit it fall back to env and stay green); wire the real one from
  contained-workflows.ts via a PrismaConnectionStore(prismaClient).

## PLAN (TDD; RED proof per step)

| step | done-condition (test)                                                                                                                                      | RED proof    | status | evidence |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------ | -------- |
| 1    | apps/api/src/lib/**tests**/whatsapp-send-creds.test.ts: getByService stub returns creds -> {token,phoneNumberId}; no conn -> null; missing fields -> nulls | yes          | todo   |          |
| 2    | reminder test: inject resolveOrgSendCreds->{T2,P2} -> POST URL has P2 + Bearer T2; resolver null -> env fallback                                           | yes          | todo   |          |
| 3    | followup test: same per-org + fallback                                                                                                                     | yes          | todo   |          |
| 4    | greeting test: same per-org + fallback; local token alias consolidated                                                                                     | yes          | todo   |          |
| 5    | robin-recovery-executor test: per-org creds -> send uses them; null -> env/global fallback                                                                 | yes          | todo   |          |
| 6    | contained-workflows wires resolveOrgSendCreds (PrismaConnectionStore) into all 4; api typecheck + build green                                              | n/a (wiring) | todo   |          |
| 7    | VERIFY: turbo typecheck + --filter api test + lint + format + arch + independent review                                                                    | n/a          | todo   |          |

gate_results: typecheck=PASS(22/22) test=PASS(api 2295/0) lint=PASS(0err) format=PASS arch=PASS(yellow-exempt) verify-fast=PASS build=PASS(10/10) review=SHIP-READY(2 minor pushed-back+documented, 1 nit fixed)
carry_forward: A1 DONE + SURFACED = PR #1208 (branch fix/multitenant-whatsapp-send). All gates green; indep review
ship-ready. SURFACE-before-merge (external send + credentials stop-glob) -> awaiting human merge. A3 + A5 consume the
new resolver, so they should run after #1208 merges. Worktree .claude/worktrees/agents-fix-a1-mt-send left in place
until merge (teardown on merge). Next loop slice (per plan) = A2 (CTWA attribution), independent of A1.

## Log

- 2026-06-21: ORIENT done (subagent brief). Worktree off origin/main 10fd9a24e. Docs PR #1204 (plan) opened.
- 2026-06-21: Diagnosed local TS-6.0.3 + stale-dist false TS7006 typecheck (CI green); fixed via `pnpm reset` +
  `pnpm typecheck` (turbo). DURABLE: in a fresh worktree `pnpm --filter <app> typecheck` reds on stale lower-layer
  dist; run reset then turbo typecheck (= CI). FRAME + PLAN set.
- 2026-06-21: EXECUTE (opus subagent, TDD) implemented resolveOrgWhatsAppSendCreds + threaded all 4 sites; 56 tests.
  VERIFY green (typecheck/test/lint/format/arch/verify-fast/build). Independent review ship-ready; triaged 3 findings
  (pushed back on status-gate + empty-string -> documented deliberate fail-closed; fixed em-dashes). Committed 551350096.
- 2026-06-21: CONVERGE = SURFACED PR #1208 (do not merge; human call). A1 complete.
- 2026-06-21: user-requested architecture+intent review (superpowers:requesting-code-review). Verdict ARCHITECTURE-ALIGNED + WORKS-AS-INTENDED + ship-ready (reviewer re-ran 56 tests + apps/api tsc exit 0, traced all 4 sites to the Graph POST). Acted on the 1 [minor]: added symmetric two-org isolation tests to followup + greeting (now 58 tests). Amended -> dfd6aea3a, force-pushed #1208 (CI re-running on new HEAD; merge after green). DURABLE [nit]: turbo `pnpm typecheck` can be a cross-worktree FULL-TURBO cache replay -> confirm credential PRs with package-level `tsc --noEmit` -> recorded in [[feedback_worktree_init_postgres_down]].
