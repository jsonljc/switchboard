# route-chain-integrity

**Charter:** Button → API route → store reachability. Flag broken chains, no-op routes, missing audit-trail.
**Method:** Ran `/Users/jasonli/switchboard/.agent/tools/check-routes` to identify mutating routes that don't reach PlatformIngress.submit. Traced each flagged route's button → API → store chains. Checked DOCTRINE.md for governance requirements.
**Scope exclusions applied:** All routes matching allowlist in `/Users/jasonli/switchboard/.agent/tools/route-allowlist.yaml` (91 findings suppressed)

## Findings

### [CRITICAL] Recommendation act endpoint architecture violation

- **Where:** `/Users/jasonli/switchboard/apps/api/src/routes/recommendations.ts:127` (POST `:id/act`)
- **Evidence:** Route calls `actOnRecommendation()` which persists recommendation state directly via `store.applyAct()` without reaching `PlatformIngress.submit()`. Dashboard component at `/Users/jasonli/switchboard/apps/dashboard/src/app/api/dashboard/recommendations/route.ts` proxies to this API route.
- **Why it matters:** DOCTRINE.md §119 explicitly requires this endpoint to be migrated: "**Recommendation act direct mutation** | ... | **Migrate to `PlatformIngress.submit({ intent: "operator.respond_recommendation" })`** when the executor lands (v2). Same migration as approval-response." This is a documented architectural debt item.
- **Fix:** Register `"operator.respond_recommendation"` intent; migrate recommendations.ts:127-213 to call `app.platformIngress.submit()` instead of `actOnRecommendation()` directly.
- **Effort:** L (requires executor implementation for operator.respond_recommendation intent per DOCTRINE Phase 2)
- **Risk if untouched:** Operator recommendation actions bypass governance, audit trail, and unified lifecycle management. Creates audit compliance gap.
- **Collides with active work?:** No

### [HIGH] Opportunity stage transition missing intent registration

- **Where:** `/Users/jasonli/switchboard/apps/api/src/routes/dashboard-opportunities.ts:42` (PATCH `:id/stage`)
- **Evidence:** Dashboard button → `/api/dashboard/opportunities/:id/stage` PATCH (dashboard proxy) → API calls `transitionOpportunityStage()` which persists via `opportunityStore.transitionStage()`. No PlatformIngress.submit(). This is a direct business action (moving opportunities through sales pipeline stages: "open" → "qualified" → "proposal" → "closed_won"/"closed_lost").
- **Why it matters:** Operator action that mutates sales object state. Should be governed (policy may restrict stage transitions, require approval for certain stages, or audit-log business-critical state changes). Current implementation bypasses governance spine.
- **Fix:** Either (a) migrate to PlatformIngress.submit({ intent: "opportunity.transition_stage" }) with governance, OR (b) add to allowlist if this is intentionally designed as direct lifecycle operation (like approval responses). Requires design decision.
- **Effort:** M (if ingress migration) / S (if allowlist + documentation)
- **Risk if untouched:** Opportunity state changes unaudited; no governance gate (could transition to closed_won with zero revenue if policy exists); compliance gap if stage transitions trigger SLA/approval obligations.
- **Collides with active work?:** No

### [HIGH] Admin consent operations missing audit trail integration

- **Where:** `/Users/jasonli/switchboard/apps/api/src/routes/admin-consent.ts:66, 90` (POST `/api/admin/consent/grant` and `/revoke`)
- **Evidence:** Routes call `deps.consentService.recordGrant()` and `recordRevocation()` which update consent state in database. These are operator-recorded PDPA/privacy consent decisions with legal implications. No PlatformIngress.submit(). No formal audit-trail ingestion.
- **Why it matters:** Privacy consent decisions are legally required to be auditable. Operator actions without governance gate means no policy enforcement on who can record consent, when, or under what conditions. Creates compliance risk (GDPR, CCPA).
- **Fix:** Either (a) register as governed intent and flow through PlatformIngress, OR (b) ensure these routes explicitly use AuditLedger.record() for consent events. Current code lacks explicit audit integration.
- **Effort:** M
- **Risk if untouched:** Consent records lack proper audit trail; cannot demonstrate compliance audit-ability; consent state mutations not gated by policy.
- **Collides with active work?:** No

### [HIGH] Lifecycle disqualifications confirm/dismiss missing intent registration

- **Where:** `/Users/jasonli/switchboard/apps/api/src/routes/lifecycle-disqualifications.ts:96, 162` (POST `:threadId/confirm` and `:threadId/dismiss`)
- **Evidence:** Dashboard button (disqualification-row.tsx) → `/api/dashboard/lifecycle/disqualifications/:threadId/{confirm|dismiss}` POST → API calls `deps.disqualificationHook.confirm()` / `.dismiss()`. These operator actions advance lifecycle state (proposed_disqualification → disqualified or back to qualified). No PlatformIngress.submit().
- **Why it matters:** Lifecycle transitions are state-machine operations that could have downstream effects (contact unqualification, deal cleanup, reporting). Without governance gate, cannot enforce policies like "disqualification requires reason" or "only qualified reps can disqualify."
- **Fix:** Determine if these are true "governed actions" (migrate to ingress) or "lifecycle admin" (allowlist with clear statement). DOCTRINE treats approval response as lifecycle, not new action — this may be similar. Needs design clarity.
- **Effort:** M (if ingress) / S (if allowlist)
- **Risk if untouched:** Lifecycle state changes not audited; no governance or policy enforcement on disqualifications.
- **Collides with active work?:** No

### [MED] WhatsApp send-test missing route allowlist

- **Where:** `/Users/jasonli/switchboard/apps/api/src/routes/whatsapp-send-test.ts:88` (POST `/send-test`)
- **Evidence:** Route persists test message send to `whatsAppTestSend.create()` after calling Meta Graph API. Does not reach PlatformIngress. This is QA/developer tooling, not a business action, but flagged by check-routes.
- **Why it matters:** Allowlist at `/Users/jasonli/switchboard/.agent/tools/route-allowlist.yaml` line 37-42 covers `whatsapp-test.ts` (credential verification helper) and `whatsapp-onboarding.ts` (OAuth) but not this route. Test message sending is intentionally outside business workflow but check-routes has no visibility into intent.
- **Fix:** Add to allowlist with reason: "WhatsApp test message send — QA/developer tooling; no business action intent; Meta Graph call + test message persistence."
- **Effort:** S
- **Risk if untouched:** Route is not broken, but false positive in check-routes keeps signal low. Low operational risk.
- **Collides with active work?:** No

### [MED] Meta deletion webhook missing allowlist entry

- **Where:** `/Users/jasonli/switchboard/apps/api/src/routes/meta-deletion.ts:30` (POST `/api/meta/deletion`)
- **Evidence:** Inbound webhook from Meta (HMAC-verified). Deletes contact PII via `contactStore.delete()` and persists deletion record. Does not call PlatformIngress. This is an inbound event handler, not a user-initiated action.
- **Why it matters:** Check-routes flags all mutating routes; this one mutates but is structurally an inbound webhook receiver (like ad-optimizer, managed-webhook). The allowlist documents this pattern but meta-deletion.ts is not explicitly listed.
- **Fix:** Add to allowlist with reason: "Meta GDPR deletion callback — HMAC-verified inbound webhook; not user-initiated action; pre-ingress channel receiver."
- **Effort:** S
- **Risk if untouched:** check-routes false positive persists. Operational risk: none, route is correctly implemented.
- **Collides with active work?:** No

### [MED] Dashboard reports refresh missing allowlist

- **Where:** `/Users/jasonli/switchboard/apps/api/src/routes/dashboard-reports.ts:168` (POST `/api/dashboard/reports/refresh`)
- **Evidence:** POST route calls `reportCacheStore.invalidate()` and `computeReport()`. This is cache refresh and read-side computation, not a business action mutation. No PlatformIngress.submit().
- **Why it matters:** This is a read-side operation (cache invalidation) not a business action. Allowlist rationale exists for similar operations but this route is not listed.
- **Fix:** Add to allowlist with reason: "Dashboard reports refresh — cache invalidation + read-side computation; no business state mutation."
- **Effort:** S
- **Risk if untouched:** False positive in check-routes. No operational risk.
- **Collides with active work?:** No

## Out of scope / deferred for this lane

- Recommendation act migration to ingress is Phase 2 work per DOCTRINE.md §133. Blocking decision: wait for "operator.respond_recommendation" executor implementation.
- Opportunity stage transition design choice: needs product/architecture decision on whether it should be governed action (ingress) or direct lifecycle operation (allowlist).
- Admin consent audit-trail integration: separate audit-trail hardening work; not a routing issue per se.
- Lifecycle disqualifications: similar design decision needed (governed vs. lifecycle).
