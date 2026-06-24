# A2 CTWA lead attribution — loop state (orchestration scratch, not committed)

Durable record: memory [[project_all_agents_improvement_audit]]; plan slice A2 in
docs/superpowers/plans/2026-06-20-all-agents-fix-plan.md.

Goal: CTWA inbound leads attribute their ActivityLog to the org's Alex AgentDeployment id (not the
channel-connection id), so a per-Alex activity feed includes CTWA leads. ActivityLog-only (Contact
has no deploymentId column).
Authority: SURFACE-before-merge (lead-intake/attribution path; review). Task-size: standard.
Base: origin/main @ 41fc94bac. Worktree: .claude/worktrees/agents-fix-a2-ctwa-attribution
branch fix/ctwa-lead-attribution. Independent of A1 (#1208) — different files.
merge_safety: stop-glob = lead-intake/attribution -> SURFACE.

## ORIENT (done, subagent brief)

- CTWA: managed-webhook.ts:161 passes `deploymentId: gatewayEntry.deploymentConnectionId` (channel id)
  -> ctwa-adapter.ts:71 (LeadIntake.deploymentId payload), submits intent "lead.intake" (ctwa-adapter.ts:117)
  -> lead-intake-handler.ts:68 (upsertContact, DROPPED: no Contact.deploymentId col) + :83 (createActivity ->
  ActivityLog.deploymentId via lead-intake-store.ts:112-126).
- IF (correct): meta-lead-intake-workflow.ts:128 uses workUnit.deployment.deploymentId = real Alex id
  (meta.lead.intake targetHint skillSlug "alex", EXCLUDED from PLATFORM_DIRECT set platform-deployment-resolver.ts:37-48,
  resolves via resolveByOrgAndSlug :87), then IF adapter re-submits intent "lead.intake" (instant-form-adapter.ts:99)
  carrying the resolved Alex id IN THE PAYLOAD. CTWA's lead.intake IS platform-direct (:46) -> WorkUnit deployment =
  "platform-direct"; the PAYLOAD deploymentId is the SOLE attribution source for BOTH paths. So fix = put Alex id in
  the CTWA payload (NOT use workUnit.deployment).
- resolveByOrgAndSlug(orgId, skillSlug) at prisma-deployment-resolver.ts:69-83 (status:"active", returns .deploymentId,
  THROWS "No active deployment found" if absent). PrismaDeploymentResolver already built on the chat side
  (gateway-bridge.ts:150, local const); prisma/getDb available where CtwaAdapter/webhook are wired (main.ts:215,239-247).
- Consumer: prisma-activity-log-store.ts:31 listByDeployment (where org+deploymentId); crm-query.ts:60 passes the
  agent's own deploymentId.
- Tests (all mocked, NO Postgres): managed-webhook-identity.test.ts (Fastify + registerManagedWebhookRoutes + fake
  GatewayEntry/mocked ctwaAdapter = best for producer attribution), ctwa-adapter.test.ts (direct fn + mock
  ingress.submit), lead-intake-handler.test.ts (direct handler, mocked store spies), ctwa-ingress-request.test.ts.
  CHAT tests need `pnpm --filter chat build` (tsc-over-tests catches untyped vi.fn -> [[feedback_vitest_untyped_fn_breaks_chat_build]]).

## FRAME (decided)

- Resolve Alex in the chat CTWA producer (option a). Inject a deployment resolver into the managed-webhook route deps
  (construct PrismaDeploymentResolver in main.ts); replace gatewayEntry.deploymentConnectionId with
  resolver.resolveByOrgAndSlug(gatewayEntry.orgId,"alex").deploymentId in the ctwa input.
- DEFENSIVE: resolveByOrgAndSlug THROWS if Alex absent. Wrap in try/catch -> on failure console.warn + FALL BACK to
  gatewayEntry.deploymentConnectionId (status-quo; never drop a paid lead; Alex is ensured for any onboarded org so
  failure is a latent edge per A-rank-30). ctwa-ingress-request.ts:30 targetHint.deploymentId follows the payload
  automatically. Layering OK (chat L5 imports core resolver; ad-optimizer L2 + core untouched).

## PLAN (TDD; RED proof per step)

| step | done-condition (test)                                                                                                                                                             | RED | status |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------ |
| 1    | managed-webhook-identity.test.ts: CTWA msg + resolver->"alex_dep", gatewayEntry conn "conn_1" => ctwaAdapter.ingest called with deploymentId "alex_dep" (RED: currently "conn_1") | yes | todo   |
| 2    | fallback test: resolver throws => ingest gets "conn_1" + a warn (lead NOT dropped)                                                                                                | yes | todo   |
| 3    | wire PrismaDeploymentResolver in main.ts into the webhook route deps; turbo typecheck + chat build green                                                                          | n/a | todo   |
| 4    | VERIFY: turbo typecheck + --filter chat build + --filter chat test + --filter core test + lint + format + arch + verify-fast + indep review                                       | n/a | todo   |

gate_results: typecheck=PASS(22/22) chat-build=PASS(tsc-over-tests clean) chat-test=PASS(340/0, 48 files) core-test=PASS(lead-intake-handler 7/7) lint=PASS(0err) format=PASS arch=PASS verify-fast=PASS review=SHIP-READY(0 crit/imp/minor; 1 nit em-dash fixed)
carry_forward: A2 DONE + SURFACED = PR #1210 (branch fix/ctwa-lead-attribution, off origin/main 41fc94bac). Fix was
PRODUCER-side in apps/chat (managed-webhook resolves Alex + main.ts wiring) -> it does NOT touch lead-intake-handler.ts,
so the planned "A2 before A4" overlap is MOOT (A4 = core handler, A2 = chat). All gates green; indep review ship-ready.
SURFACE-before-merge -> awaiting human merge. Worktree left until merge.

## Log

- 2026-06-21: worktree off origin/main 41fc94bac. ORIENT done. Frozen install; dashboard build env-fail pre-reset
  (stale prisma client, CI green on main) -> reset + turbo typecheck green. FRAME + PLAN set.
- 2026-06-21: EXECUTE (opus, TDD): resolve Alex in chat managed-webhook CTWA producer + try/catch fallback to conn id +
  warn; wired PrismaDeploymentResolver in main.ts. 2 new tests (attribution + fallback). VERIFY all green. Indep review
  ship-ready (fixed 4 authored em-dashes). Committed 6de0c8bdc.
- 2026-06-21: CONVERGE = SURFACED PR #1210 (do not merge; human call). A2 complete.
