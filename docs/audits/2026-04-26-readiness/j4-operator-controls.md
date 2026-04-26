# J4: Operator Monitors → Intervenes — Readiness Audit

> **Audit date:** 2026-04-26
> **Auditor:** Claude
> **Spec:** docs/superpowers/specs/2026-04-26-self-serve-readiness-audit-design.md

## Findings

---

### Step 1: Conversation List — Truth and Scope

### [P2] J4.1 — Completeness

**Message type information missing from conversation list**

**Evidence:** `apps/api/src/routes/conversations.ts:8-12` — `MessageEntry` contains only `role`, `text`, and `timestamp`. No tool call visibility, no media type, no structured metadata.

**Customer Impact:** Operator browsing conversations cannot see what tools the agent invoked (e.g., calendar bookings, CRM writes). They see only the text surface, not the agent's actions.

**Fix:** Extend `MessageEntry` to include optional `toolCalls` and `metadata` fields, and ensure the conversation store persists structured outputs from skill execution. (scope: days)

---

### [P2] J4.1 — Completeness

**No search or sort beyond filters**

**Evidence:** `apps/api/src/routes/conversations.ts:176-182` — Query schema supports only `status`, `channel`, `principalId`, `limit`, `offset`. No free-text search, no sort-by option.

**Customer Impact:** Operator with many conversations cannot search by customer name or keyword. Functional but limits efficiency at scale.

**Fix:** Add optional `search` parameter for text matching and `sortBy` parameter. (scope: days)

---

### Step 2: Conversation Detail

### [P2] J4.2 — Completeness

**No tool call visibility in conversation detail**

**Evidence:** `apps/api/src/routes/conversations.ts:147-170` — `buildConversationDetail` returns `messages: safeParseMessages(row.messages)` which casts to `MessageEntry[]` containing only `role`, `text`, `timestamp`. Skill execution outputs (tool invocations, CRM writes, booking attempts) are not included.

**Customer Impact:** Operator viewing a conversation detail cannot see what the agent actually did beyond text replies. If the agent booked a calendar slot or wrote to CRM, the operator has no visibility into those actions from this view.

**Fix:** Include structured tool call records from the audit ledger or skill execution log alongside messages. (scope: days)

---

### Step 3: Override Mechanism

### [P0] J4.3 — Completeness

**Override reply is not delivered to the customer's channel**

**Evidence:** `apps/api/src/routes/escalations.ts:181-206` — The `POST /api/escalations/:id/reply` endpoint appends the owner's reply to the `conversationState.messages` array in the database and sets status to `active`, but never sends the message to the customer through the actual channel (WhatsApp, Telegram, etc.). The response returns `replySent: true` (line 224) even though no channel delivery occurs.

**Customer Impact:** Owner replies to an escalation believing the customer received the message. The customer never sees it. The `replySent: true` response is a lie. The customer sits waiting indefinitely.

**Fix:** After updating conversation state, resolve the channel and deliver the message via the appropriate channel adapter (WhatsApp API, Telegram API, etc.). Only return `replySent: true` after actual channel delivery succeeds. (scope: days)

---

### [P1] J4.3 — Reliability & State Integrity

**Race condition between override toggle and in-flight agent response**

**Evidence:** `apps/api/src/routes/conversations.ts:258-293` — The PATCH override endpoint sets `status = "human_override"` in the database. The ChannelGateway checks this status at `packages/core/src/channel-gateway/channel-gateway.ts:56-60` before dispatching to PlatformIngress. However, there is no locking mechanism. If an agent response is already in-flight (between the status check at line 57 and the reply send at line 112), the agent response will still be delivered even after override is toggled.

**Customer Impact:** Operator enables override, but the customer receives one more agent message that was already in-flight. Confusing for both operator and customer.

**Fix:** Add an optimistic concurrency check: after the agent response is generated but before sending, re-check the override status. Alternatively, use a DB-level lock or version counter on the conversation state. (scope: days)

---

### [P1] J4.3 — Completeness

**No mechanism for operator to send messages through the customer's channel during override**

**Evidence:** `apps/api/src/routes/conversations.ts:258-293` — The PATCH endpoint only toggles the `status` field between `active` and `human_override`. There is no endpoint to send an ad-hoc message through the customer's channel while in override mode. The only way to send a message is through the escalation reply endpoint, which is tied to a specific escalation record.

**Customer Impact:** Operator takes over a conversation (non-escalation scenario, e.g., sees a confused customer) but has no way to actually communicate with the customer. The override silences the agent but provides no replacement communication path.

**Fix:** Add a `POST /api/conversations/:threadId/send` endpoint that resolves the channel and delivers the operator's message to the customer. (scope: days)

---

### Step 4: Escalation Notification Delivery

### [P1] J4.4 — Production Reality

**AgentNotifier is permanently null in the API server**

**Evidence:** `apps/api/src/app.ts:280` — `app.decorate("agentNotifier", null as AgentNotifier | null)`. The `agentNotifier` is decorated as `null` and never reassigned. The `ProactiveSender` class exists in `packages/core/src/notifications/proactive-sender.ts` but is never instantiated in any app bootstrap code.

**Customer Impact:** The `ProactiveSender` (which supports Telegram, Slack, WhatsApp proactive notifications) is dead code at runtime. However, escalation notifications do work through a different path — `HandoffNotifier` uses `ApprovalNotifier` (email via Resend + Telegram), wired in `apps/api/src/bootstrap/skill-mode.ts:111`. The proactive notification path for non-escalation events (T2/T3 classified notifications) has no delivery mechanism.

**Fix:** Either wire `ProactiveSender` into the app bootstrap or remove the dead `agentNotifier` decoration. For T2/T3 notifications (fact_learned, faq_drafted, etc.), implement a delivery pipeline that uses the classifier output. (scope: days)

---

### [P1] J4.4 — Reliability & State Integrity

**Escalation email notification uses allSettled — silent partial failure**

**Evidence:** `apps/api/src/services/notifications/email-escalation-notifier.ts:26-40` — Uses `Promise.allSettled` with individual `.catch` handlers that only `console.warn`. If email delivery fails for all approvers, the escalation still appears created successfully. No retry mechanism exists.

**Customer Impact:** Escalation is created in the database but operator never receives the notification email. The customer waits for a response that the operator doesn't know about. The SLA timer runs without the operator's awareness.

**Fix:** Record notification delivery status on the handoff record. Surface undelivered notifications in the dashboard. Add retry via the outbox pattern or a job queue. (scope: days)

---

### [P1] J4.4 — Production Reality

**SLA Monitor is not wired into any runtime**

**Evidence:** `packages/core/src/handoff/sla-monitor.ts:36-43` — The `checkBreaches` method returns an empty array with a comment "We'd need to scan all orgs in production." The `SlaMonitor` class is never instantiated in `apps/api/` or `apps/chat/` (confirmed via grep — zero matches in apps/ for `SlaMonitor`).

**Customer Impact:** SLA deadlines on escalations are decorative. No breach detection occurs. An operator who doesn't check the dashboard will never be alerted that an escalation SLA has expired.

**Fix:** Wire `SlaMonitor` into a scheduled job (BullMQ or cron) that scans pending handoffs and triggers breach notifications. (scope: days)

---

### [P2] J4.4 — Ops Readiness

**Notification classifier has no runtime integration**

**Evidence:** `packages/core/src/notifications/notification-classifier.ts` — The `classifyNotification` function exists with well-defined T1/T2/T3 tiers and trust-level modifiers. However, it is not called anywhere in the application code outside tests (confirmed via grep). There is no pipeline that takes runtime events, classifies them, and routes to appropriate channels.

**Customer Impact:** The notification tiering system is spec-complete but not connected. All escalation notifications go through the same email+Telegram path regardless of urgency. Non-escalation events (fact_learned, performance_stats) generate no notifications at all.

**Fix:** Build a notification pipeline that: (1) receives events from skill runtime, (2) classifies via `classifyNotification`, (3) routes T1 to push channels, T2 to dashboard + optional push, T3 to dashboard only. (scope: days)

---

### Step 5: Performance/ROI Data Accuracy

### [P1] J4.5 — Security / Multi-tenancy

**ROI summary endpoint accepts orgId from URL path, weak enforcement**

**Evidence:** `apps/api/src/routes/roi.ts:11` — Route is `GET /:orgId/roi/summary`. The orgId comes from the URL path parameter. While `requireOrganizationScope` at line 16 extracts the auth org, the route uses `request.params.orgId` only after the scope check. However, `requireOrganizationScope` returns the auth org — it does NOT compare it against the path `:orgId`. Looking at line 16-17: `const orgId = requireOrganizationScope(request, reply)` returns `request.organizationIdFromAuth` — the path param `orgId` is actually ignored.

The orgId from the path is unused — the auth orgId is used for queries. This means the path param is misleading but not a security issue. The data is correctly scoped.

**Customer Impact:** No data leak. However, the API contract is misleading — the URL contains an orgId that is silently ignored. Could confuse integrators.

**Fix:** Either remove the orgId from the path (use auth-only scoping) or validate that path orgId matches auth orgId. (scope: hours)

---

### [P2] J4.5 — Ops Readiness

**No data freshness indicator on ROI dashboard**

**Evidence:** `apps/api/src/routes/roi.ts:50-57` — The reconciliation `health` object includes `lastRun` from the latest reconciliation report. But if no reconciliation has ever run, it returns `{ status: "unknown", lastRun: null, checks: [] }`. The funnel data itself has no staleness indicator — the operator cannot tell if conversion records are minutes or days old.

**Customer Impact:** Operator sees ROI numbers but cannot assess whether they reflect current reality or stale data. If the conversion recording pipeline breaks, the dashboard shows zero new conversions with no explanation.

**Fix:** Include a `dataAsOf` timestamp from the most recent conversion record in the response. Surface a warning when the latest record is older than a configurable threshold. (scope: hours)

---

### Step 6: Emergency Halt Lifecycle

### [P1] J4.6 — Security / Multi-tenancy

**Governance status endpoint allows unauthenticated access to any org's governance profile**

**Evidence:** `apps/api/src/routes/governance.ts:42-46` — `GET /:orgId/status` reads orgId from the URL path. The auth check on line 44 is `if (request.organizationIdFromAuth && orgId !== request.organizationIdFromAuth)` — this only rejects if auth IS present AND mismatches. If `organizationIdFromAuth` is undefined (no auth / dev mode), the request proceeds with whatever orgId is in the URL, returning the full governance profile, posture, config, deployment status, and halt reason for any organization.

**Customer Impact:** In production with auth enabled, this is mitigated. But the pattern is inconsistent with the stricter `requireOrganizationScope` used elsewhere (conversations, escalations, dashboard). If auth middleware fails or is misconfigured, this endpoint leaks governance state for arbitrary orgs.

**Fix:** Use `requireOrganizationScope` and compare against the path param, consistent with other endpoints. (scope: hours)

---

### [P1] J4.6 — Security / Multi-tenancy

**Governance profile PUT endpoint has same auth bypass pattern**

**Evidence:** `apps/api/src/routes/governance.ts:108-116` — `PUT /:orgId/profile` uses the same `if (organizationIdFromAuth && mismatch)` pattern. Without auth, anyone can set any org's governance profile to any level including `locked`.

**Customer Impact:** Same as above — mitigated by auth middleware in production, but the defensive coding pattern is weaker than the rest of the API surface. A single auth middleware bug would allow arbitrary governance manipulation.

**Fix:** Use `requireOrganizationScope` and validate path param match. (scope: hours)

---

### [P2] J4.6 — Completeness

**Emergency halt does not pause in-flight conversations**

**Evidence:** `apps/api/src/routes/governance.ts:177-183` — Emergency halt pauses all `active` deployments via `updateMany`. The ChannelGateway at `packages/core/src/channel-gateway/channel-gateway.ts:16-33` checks deployment status on each new incoming message and replies "temporarily paused." However, any conversation already past the deployment check (in-flight at PlatformIngress) will complete normally. The halt is not atomic across all active conversations.

**Customer Impact:** During the brief window between halt and completion of in-flight requests, the agent may still send responses or take actions. For a true emergency (e.g., agent sending wrong information), this window allows a few more incorrect messages to go out.

**Fix:** Add a real-time halt signal (e.g., in-memory flag or Redis key) that the skill executor checks before returning results. (scope: days)

---

### [P2] J4.6 — Reliability & State Integrity

**Resume hardcodes governance profile to "guarded"**

**Evidence:** `apps/api/src/routes/governance.ts:310` — `await store.set(orgId, "guarded")`. When resuming after emergency halt, the governance profile is always set to "guarded" regardless of what it was before the halt.

**Customer Impact:** If the operator had their profile set to "observe" (most restrictive) or "strict" before the halt, resuming silently changes their governance posture. They may not realize their approval requirements have changed.

**Fix:** Store the pre-halt governance profile in the halt audit entry and restore it on resume, or let the operator choose the resume profile. (scope: hours)

---

### [P2] J4.6 — Completeness

**Emergency halt campaign pause depends on legacy cartridge interface**

**Evidence:** `apps/api/src/routes/governance.ts:202-236` — The campaign pause logic checks for a `digital-ads` cartridge via `app.storageContext.cartridges.get("digital-ads")` and the `isEmergencyHaltCapable` type guard. Per CLAUDE.md, cartridges are a retired concept with no implementations. This entire code path is dead — no campaigns will ever be paused.

**Customer Impact:** The response includes `campaignsPaused: []` which is technically accurate (no campaigns were paused because no cartridge exists). The operator may believe campaigns were checked and none needed pausing, when in reality the check was never performed. Ad spend continues during emergencies.

**Fix:** Replace the cartridge-based campaign pause with a direct Meta Ads API integration through the ad-optimizer package or deployment connections. (scope: days)

---

### Cross-Cutting Findings

### [P1] J4.X — Self-Serve Integrity

**Escalation notification channel configuration requires env vars, not self-serve**

**Evidence:** `apps/api/src/bootstrap/skill-mode.ts:70-108` — Escalation notifications are configured via environment variables: `TELEGRAM_BOT_TOKEN`, `ESCALATION_CHAT_ID`, `RESEND_API_KEY`, `ESCALATION_EMAIL`. There is no dashboard UI or API endpoint for operators to configure their own escalation notification preferences.

**Customer Impact:** An operator cannot self-serve configure where they receive escalation alerts. This requires founder intervention to set env vars. Every new customer onboarding requires manual env var configuration.

**Fix:** Move notification channel configuration to per-org settings in the database (e.g., `organizationConfig.notificationChannels`). Expose via settings API and dashboard UI. (scope: days)

---

### [P1] J4.X — Self-Serve Integrity

**Escalation approvers are global, not per-org**

**Evidence:** `apps/api/src/bootstrap/skill-mode.ts:103-105` — `escalationApprovers` is a single array populated from global env vars. All orgs share the same escalation recipients. In a multi-tenant deployment, Org A's escalations would go to Org B's operator.

**Customer Impact:** In the current single-tenant deployment (one operator), this works. The moment a second customer signs up, their escalations go to the first customer's email/Telegram. Data leak and operational confusion.

**Fix:** Store escalation recipients per-org. Look up the org's configured approvers when creating a handoff notification. (scope: days)

---

## Summary

| Severity | Count | Key Themes                                                                                    |
| -------- | ----- | --------------------------------------------------------------------------------------------- |
| P0       | 1     | Escalation reply never delivered to customer channel                                          |
| P1       | 8     | Auth bypass patterns, notification delivery gaps, SLA monitor unwired, per-org config missing |
| P2       | 7     | Tool call visibility, search, data freshness, halt edge cases                                 |

**Critical blocker:** The P0 finding (escalation reply not delivered) means the core J4 intervention loop is broken. An operator who replies to an escalation believes the customer received their message, but the message only exists in the database. The customer never sees it.

**Status: DONE_WITH_CONCERNS**

The J4 journey has solid structural foundations (conversation browser with org scoping, escalation inbox with full CRUD, governance halt/resume with audit logging, ROI data from real conversion records). However, the intervention path has a critical gap: operator replies don't reach the customer. The notification infrastructure has multiple reliability gaps (silent email failure, no SLA enforcement, global-not-per-org routing). The governance endpoints use a weaker auth pattern than the rest of the API.
