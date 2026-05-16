# doctrine-compliance

**Charter:** PlatformIngress as sole mutating entry; WorkTrace as canonical persistence; approval as lifecycle state; tools audited+idempotent; no bypass paths.
**Method:** Ran `.agent/tools/check-routes` to detect mutating HTTP routes that don't call `PlatformIngress.submit`; analyzed each finding against DOCTRINE.md and intent registry; traced persistence patterns to identify WorkTrace compliance gaps.
**Scope exclusions applied:** routes suppressed by allowlist (91); exclusion paths per spec (recommendations, riley not audited per scope); paths in workflows dated 2026-05-15 to 2026-05-28.

## Findings

### [CRITICAL] recommendations.ts — operator recommendation actions bypass ingress and WorkTrace

- **Where:** `apps/api/src/routes/recommendations.ts:184`
- **Evidence:** Route handler calls `actOnRecommendation(app.recommendationStore, { recommendationId, orgId, actor, action, note })` which mutates recommendation state via `store.applyAct()` without creating a WorkUnit or WorkTrace. Line 184 directly invokes the service; no `ingress.submit()` call.
- **Why it matters:** DOCTRINE §1 (invariant 1) mandates "Every governed action enters through `PlatformIngress.submit()`." DOCTRINE lines 119–120 explicitly mark this as debt: "Recommendation act direct mutation... Migrate to `PlatformIngress.submit({ intent: 'operator.respond_recommendation' })`". Without ingress, governance is bypassed, audit trail is incomplete, and idempotency cannot be guaranteed.
- **Fix:** Create `operator.respond_recommendation` intent registration; migrate route to call `ingress.submit({ intent: 'operator.respond_recommendation', ... })` instead of `actOnRecommendation()` directly. Requires intent executor that calls the recommendation service internally.
- **Effort:** M (need intent + executor + tests for the new ingress path)
- **Risk if untouched:** Recommendation actions are not governed; operators can act without audit trail; idempotency is not enforced; if governance is later tightened, this route cannot support it.
- **Collides with active work?:** no

### [CRITICAL] admin-consent.ts — admin consent mutations bypass ingress and WorkTrace

- **Where:** `apps/api/src/routes/admin-consent.ts:66,90,113` (three endpoints: grant, revoke, clear)
- **Evidence:** Route handlers call `consentService.recordGrant()`, `recordRevocation()`, `clearConsent()` which mutate contact consent state directly via Prisma (lines 208, 241, 300 in consent-service.ts) without ingress submission. No WorkTrace is created.
- **Why it matters:** Admin consent changes are operator actions that mutate contact jurisdiction and consent timestamps — core compliance/governance state. DOCTRINE §1 requires all mutations to enter through PlatformIngress. Without ingress, these actions are invisible to governance gate, approval lifecycle, and WorkTrace audit. If an admin revokes consent incorrectly, there is no governance record, no approval check, and no idempotency guarantee on retry.
- **Fix:** Create `admin.grant_consent`, `admin.revoke_consent`, `admin.clear_consent` intents; migrate route handlers to `ingress.submit()`. Consent service methods already exist; wrap them in executors.
- **Effort:** M (three intents + three executors + test coverage)
- **Risk if untouched:** Admin consent changes are ungoverned and unaudited; no idempotency on network retry; compliance liability if consent changes cannot be traced to governance decisions.
- **Collides with active work?:** no

### [CRITICAL] lifecycle-disqualifications.ts — operator lifecycle mutations bypass ingress and WorkTrace

- **Where:** `apps/api/src/routes/lifecycle-disqualifications.ts:128,195` (confirm and dismiss endpoints)
- **Evidence:** Route handlers call `disqualificationHook.confirm()` and `dismiss()` which mutate lifecycle state via `LifecycleTransitionStore` without ingress submission (lines 128, 195). No WorkTrace created. These are operator decisions that advance conversation thread state.
- **Why it matters:** Disqualification confirmation/dismissal are operator governance decisions (Phase 3b). DOCTRINE §1 mandates ingress entry for all mutations. Without it, the operator's decision is not logged in WorkTrace, approval cannot be enforced if policy changes, and idempotency is lost on retry. The routes correctly use a hook-based architecture (good), but the hook is called from a route handler instead of from an executor accessed via ingress.
- **Fix:** Create `operator.confirm_disqualification` and `operator.dismiss_disqualification` intents; migrate route handlers to `ingress.submit()`. The hook already handles the state transition; the ingress layer will provide governance + WorkTrace + idempotency.
- **Effort:** M (two intents + two executors + test updates)
- **Risk if untouched:** Operator decisions are unaudited; if disqualification policy is later restricted (approval required), cannot enforce it; no idempotency on network error; lifecycle state changes are not in WorkTrace.
- **Collides with active work?:** yes (PR #444 — feat(alex): SG/MY medspa Phase 3b. This was intentionally added in Phase 3b before ingress convergence; PR-1 of local-readiness is expected to migrate it. Track as local-readiness-followup.)

### [CRITICAL] dashboard-opportunities.ts — opportunity stage transitions bypass ingress and WorkTrace

- **Where:** `apps/api/src/routes/dashboard-opportunities.ts:55` (PATCH /api/dashboard/opportunities/:id/stage)
- **Evidence:** Route handler calls `transitionOpportunityStage({ orgId, id, stage, actor }, { opportunityStore })` which mutates opportunity state via `opportunityStore.transition()` without calling `ingress.submit()`. No WorkTrace is created. This is a direct business state mutation by an operator.
- **Why it matters:** Opportunity stage transitions are operator actions that affect business pipelines (sales kanban). DOCTRINE §1 requires ingress entry. Without it, the transition is unaudited, ungoverned, and lacks idempotency guarantees. If governance policy later requires approval for stage transitions to "closed_won" (high-value closures), this route cannot support it.
- **Fix:** Create `operator.transition_opportunity_stage` intent; migrate route to `ingress.submit()`. The opportunity store already has the transition logic; wrap it in an executor.
- **Effort:** M (one intent + one executor + test coverage)
- **Risk if untouched:** Opportunity mutations are unaudited and ungoverned; no idempotency; no WorkTrace record; approval cannot be added if policy changes.
- **Collides with active work?:** no

### [HIGH] meta-deletion.ts — data deletion webhook lacks proper traceability and error recovery

- **Where:** `apps/api/src/routes/meta-deletion.ts:88` (POST /api/meta/deletion)
- **Evidence:** Route handler calls `contactStore.delete(match.organizationId, match.id)` directly (line 88); persists deletion via `dataDeletionRequest.create()` (line 102). No WorkTrace created. This is a webhook-driven system action (not operator-initiated), but the cascade delete and audit record are not linked via WorkTrace.
- **Why it matters:** This is a GDPR deletion response from Meta (signed webhook). While not an operator action, it is a critical compliance mutation that should be traceable and retryable. The route currently logs to `dataDeletionRequest` table but does not use WorkTrace. If the route times out after deleting contacts but before persisting the request record, the deletion is lost to audit. Also, idempotency depends on the confirmation_code check, not on ingress-level idempotency.
- **Fix:** Create a `system.meta_gdpr_deletion` intent (actor="system:meta"); route webhook to `ingress.submit()` so deletion + confirmation are atomic via WorkTrace. This allows the governance gate to rate-limit GDPR requests (if needed) and ensures audit trail.
- **Effort:** M (one intent + one executor + test updates to verify idempotency)
- **Risk if untouched:** GDPR deletions are not idempotent; if deletion succeeds but confirmation record insert fails, retry will attempt to delete already-deleted contacts (benign but not ideal); no audit trail linking deletion to a WorkUnit.
- **Collides with active work?:** no

### [HIGH] dashboard-reports.ts — cache mutation lacks governance boundaries

- **Where:** `apps/api/src/routes/dashboard-reports.ts:101,184` (GET /api/dashboard/reports, POST /api/dashboard/reports/refresh)
- **Evidence:** Route handler calls `reportCacheStore.upsert(...)` at line 101 and `reportCacheStore.invalidate(orgId, reportWindow)` at line 184 without ingress submission. These are cache mutations triggered by operator endpoints.
- **Why it matters:** While report generation is not a direct business action, the cache refresh endpoint (`/refresh`) is operator-initiated and mutates cached state. Without ingress, there is no governance boundary around what reports an operator can refresh (e.g., if org is not entitled to this feature, there is no check). The route does check organization scope, but governance is not involved.
- **Fix:** Create `operator.refresh_report` intent; validate report window entitlement in governance gate (not just org scope); route POST /refresh to `ingress.submit()`. GET can remain read-only.
- **Effort:** S (one intent + minimal executor + governance rule)
- **Risk if untouched:** Operators can refresh reports for any window; no audit of who refreshed what; no idempotency on network error; no compliance if report refresh is later gated.
- **Collides with active work?:** no

### [HIGH] whatsapp-send-test.ts — test surface lacks audit and idempotency

- **Where:** `apps/api/src/routes/whatsapp-send-test.ts:88,226` (POST /send-test)
- **Evidence:** Route handler calls `app.prisma!.whatsAppTestSend.create({ organizationId, managedChannelId, messageId, ... })` at line 226 without ingress submission. No WorkTrace. This is an operator action (Tech Provider verification during channel setup).
- **Why it matters:** WhatsApp send-test is a diagnostic surface used during Tech Provider verification. While not a production business action, it IS an operator-initiated mutation of test send records. Without ingress, there is no idempotency guarantee; if the test send succeeds but the DB insert times out and is retried, a duplicate test record may be created. Also, audit trail of who ran which test sends is lost.
- **Fix:** Create `operator.whatsapp_send_test` intent; route to `ingress.submit()`. Governance gate can mark this as low-risk (no approval needed). Idempotency is then automatic.
- **Effort:** S (one intent + one executor + test updates)
- **Risk if untouched:** Test sends are not idempotent; duplicate test records on network error; no audit trail of who ran diagnostics; if the send-test feature is later restricted by policy, cannot enforce it.
- **Collides with active work?:** no

## Out of scope / deferred for this lane

- Recommendations package exclusions (per spec, paths `packages/schemas/src/recommendation*` and `packages/core/src/**/recommendation*` are out of scope for doctrine audit; recommendation action tracing debt is noted in DOCTRINE line 119 as Phase 2 work).
- Riley paths (`packages/core/src/**/riley*`) per audit spec scope exclusions.
- WorkTrace mirror paths in db/core (resolved via pattern; not independently audited).
- Specs/plans dated 2026-05-15 to 2026-05-28 (collides with active spec work).
- All 91 allowlisted routes (intentionally exempted or pre-ingress/non-ingress surfaces).
