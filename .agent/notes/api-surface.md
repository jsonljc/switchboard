# API Surface (apps/api)

**Generated:** 2026-05-07  
**Fastify, port 3000**

## How to Use This Doc

This is a read-only reference of all Fastify routes in `apps/api/src/routes`. Routes are grouped by functional area. Each entry includes the HTTP method, path, return type identifier, and auth pattern. For exact request/response schemas, refer to the source file.

**Total routes:** 75+ (across ~50 route files)

---

## Agent Management

### Agents

- `GET /roster` — list enabled agents for org. Auth: NextAuth→orgId. Returns `AgentRosterEntry[]`. File: apps/api/src/routes/agents.ts:67
- `PUT /roster/:id` — update agent roster entry (name, config, status). Auth: NextAuth→orgId. Returns `AgentRosterEntry`. File: apps/api/src/routes/agents.ts:94
- `GET /state` — derived activity state for all agents. Auth: NextAuth→orgId. Returns `AgentStateEntry[]`. File: apps/api/src/routes/agents.ts:143
- `POST /roster` — initialize default roster for org. Auth: NextAuth→orgId. Returns `AgentRosterEntry[]`. File: apps/api/src/routes/agents.ts:185
- `POST /import` — import agents from legacy deployment. Auth: NextAuth→orgId. File: apps/api/src/routes/agents.ts:269
- `PUT /agentState/:id` — update agent state (blocked flag, etc.). Auth: NextAuth→orgId. File: apps/api/src/routes/agents.ts:347

### Dashboard Agents

- `GET /` — list enabled + coming-soon agents for org. Auth: x-org-id header (dev/test) or NextAuth. Returns agent registry with enablement status. File: apps/api/src/routes/dashboard-agents.ts:29

---

## Decisions & Recommendations

### Decisions

- `GET /agents/:key/decisions` — decision feed for one agent (recommendations + handoffs). Auth: NextAuth→orgId. Returns `Decision[]` + counts. File: apps/api/src/routes/decisions.ts:94
- `GET /decisions` — cross-agent inbox feed. Auth: NextAuth→orgId. Returns `Decision[]` + counts. File: apps/api/src/routes/decisions.ts:122

### Recommendations

- `GET /?surface=queue|shadow_action&status=pending&since=12h&limit=50` — list recommendations by surface. Auth: NextAuth→orgId. Returns `Recommendation[]`. File: apps/api/src/routes/recommendations.ts:86
- `POST /:id/act` — act on recommendation (primary|secondary|dismiss|confirm|undo). Auth: NextAuth→orgId. Rate-limited. File: apps/api/src/routes/recommendations.ts:127

---

## Approvals & Escalations

### Approvals

- `POST /:id/respond` — respond to approval (approve|reject|patch). Auth: NextAuth→orgId. Rate-limited. Returns `Envelope + ApprovalState`. File: apps/api/src/routes/approvals.ts:25
- `GET /pending` — list pending approval requests. Auth: NextAuth→orgId. Returns `ApprovalRequest[]`. File: apps/api/src/routes/approvals.ts:120
- `GET /:id` — get approval details. Auth: NextAuth→orgId. Returns `ApprovalRequest + State`. File: apps/api/src/routes/approvals.ts:151

### Escalations

- `GET /` — list escalations filtered by status. Auth: NextAuth→orgId. Returns `Handoff[]`. File: apps/api/src/routes/escalations.ts:13
- `GET /:id` — get escalation with conversation history. Auth: NextAuth→orgId. Returns `Handoff + conversationHistory`. File: apps/api/src/routes/escalations.ts:73
- `POST /:id/reply` — owner replies and releases escalation. Auth: NextAuth→orgId. Returns updated `Handoff`. File: apps/api/src/routes/escalations.ts:139
- `POST /:id/resolve` — mark escalation resolved. Auth: NextAuth→orgId. Returns `Handoff`. File: apps/api/src/routes/escalations.ts:280

---

## Conversations

- `GET /` — list conversations with filters (limit, offset, status, channel, principalId). Auth: NextAuth→orgId. Returns `ConversationSummary[]`. File: apps/api/src/routes/conversations.ts:196
- `GET /:id` — get conversation detail with message history. Auth: NextAuth→orgId. Returns `ConversationDetail`. File: apps/api/src/routes/conversations.ts:233
- `PATCH /:id` — update conversation status. Auth: NextAuth→orgId. File: apps/api/src/routes/conversations.ts:265
- `POST /:id/send-override` — send override message (owner interrupt). Auth: NextAuth→orgId. File: apps/api/src/routes/conversations.ts:307

---

## Billing

- `POST /checkout` — create Stripe checkout session. Auth: NextAuth→orgId. Returns `{ url }`. File: apps/api/src/routes/billing.ts:24
- `POST /portal` — create Stripe billing portal session. Auth: NextAuth→orgId. Returns `{ url }`. File: apps/api/src/routes/billing.ts:67
- `GET /status` — billing status for current org. Auth: NextAuth→orgId. Returns subscription status object. File: apps/api/src/routes/billing.ts:109
- `POST /webhook` — Stripe webhook handler (raw body, no auth). Handles subscription events. File: apps/api/src/routes/billing.ts:157

---

## Dashboard Overview

- `GET /:orgId/dashboard/overview` — aggregate dashboard data (bookings, tasks, revenue, approvals, activity). Auth: NextAuth→orgId. Returns `DashboardOverview`. File: apps/api/src/routes/dashboard-overview.ts:220

---

## Reports

- `GET /api/dashboard/reports` — list scheduled reports. Auth: NextAuth→orgId. File: apps/api/src/routes/dashboard-reports.ts:131
- `POST /api/dashboard/reports/refresh` — manually refresh reports. Auth: NextAuth→orgId. File: apps/api/src/routes/dashboard-reports.ts:168

---

## Audit

- `GET /` — query audit ledger with optional filters (eventType, entityType, entityId, envelopeId, after, before, limit). Auth: NextAuth→orgId. Returns `AuditEntry[]`. File: apps/api/src/routes/audit.ts:8
- `GET /verify` — verify audit hash chain integrity (shallow or deep). Auth: NextAuth + role check (admin|operator). Returns chain verification result. File: apps/api/src/routes/audit.ts:61
- `GET /:id` — get single audit entry. Auth: NextAuth→orgId. Returns `AuditEntry`. File: apps/api/src/routes/audit.ts:177

---

## Governance

- `GET /:orgId/status` — get governance profile and posture. Auth: NextAuth→orgId. Returns `GovernanceProfile + Posture`. File: apps/api/src/routes/governance.ts:36
- `PUT /:orgId/profile` — set governance profile. Auth: NextAuth→orgId. File: apps/api/src/routes/governance.ts:104
- `POST /:orgId/emergency-halt` — emergency halt all deployments. Auth: NextAuth→orgId + role check. File: apps/api/src/routes/governance.ts:146
- `POST /:orgId/resume` — resume halted deployments. Auth: NextAuth→orgId + role check. File: apps/api/src/routes/governance.ts:258

---

## Knowledge & Identity

### Knowledge

- `POST /upload` — upload document and chunk into knowledge base. Auth: NextAuth→orgId. Returns `{ documentId, chunksCreated }`. File: apps/api/src/routes/knowledge.ts:52
- `GET /documents` — list knowledge documents grouped by documentId. Auth: NextAuth→orgId. Returns `DocumentListItem[]`. File: apps/api/src/routes/knowledge.ts:146
- `DELETE /documents/:documentId` — delete all chunks for a document. Auth: NextAuth→orgId. File: apps/api/src/routes/knowledge.ts:192
- `POST /corrections` — create correction-type knowledge chunk. Auth: NextAuth→orgId. File: apps/api/src/routes/knowledge.ts:222

### Knowledge Entries (v2)

- `GET /` — list knowledge entries. Auth: NextAuth→orgId. File: apps/api/src/routes/knowledge-entries.ts:12
- `GET /:id` — get single entry. Auth: NextAuth→orgId. File: apps/api/src/routes/knowledge-entries.ts:39
- `POST /` — create entry. Auth: NextAuth→orgId. File: apps/api/src/routes/knowledge-entries.ts:58
- `PATCH /:id` — update entry. Auth: NextAuth→orgId. File: apps/api/src/routes/knowledge-entries.ts:85
- `DELETE /:id` — delete entry. Auth: NextAuth→orgId. File: apps/api/src/routes/knowledge-entries.ts:113

### Identity

- `POST /identity/refresh` — refresh session identity from upstream. Auth: NextAuth. File: apps/api/src/routes/identity.ts:25
- `GET /operators` — list operator identities for org. Auth: NextAuth→orgId. Returns `Operator[]`. File: apps/api/src/routes/identity.ts:60
- `GET /:id` — get operator identity. Auth: NextAuth→orgId. File: apps/api/src/routes/identity.ts:81
- `PUT /:id` — update operator config. Auth: NextAuth→orgId. File: apps/api/src/routes/identity.ts:106
- `POST /:id/avatar` — upload operator avatar. Auth: NextAuth→orgId. File: apps/api/src/routes/identity.ts:146
- `GET /:id/sessions` — list operator sessions. Auth: NextAuth→orgId. File: apps/api/src/routes/identity.ts:183
- `PUT /:id/mfa` — configure MFA. Auth: NextAuth→orgId. File: apps/api/src/routes/identity.ts:212

---

## Marketplace & Deployment

### Marketplace

- `GET /listings` — list product listings. Auth: NextAuth→orgId (optional). Returns `Listing[]`. File: apps/api/src/routes/marketplace.ts:83
- `GET /listings/:id` — get listing details. Auth: NextAuth→orgId (optional). File: apps/api/src/routes/marketplace.ts:104
- `POST /listings` — create listing. Auth: NextAuth→orgId. File: apps/api/src/routes/marketplace.ts:122
- `GET /listings/:id/trust` — get listing trust progression. Auth: public. File: apps/api/src/routes/marketplace.ts (line varies)
- `POST /listings/:id/deploy` — deploy listing. Auth: NextAuth→orgId. File: apps/api/src/routes/marketplace.ts (line varies)
- `GET /deployments` — list deployments. Auth: NextAuth→orgId. File: apps/api/src/routes/marketplace.ts (line varies)
- `GET /deployments/:id` — get deployment detail. Auth: NextAuth→orgId. File: apps/api/src/routes/marketplace.ts (line varies)
- `PATCH /deployments/:id` — update deployment. Auth: NextAuth→orgId. File: apps/api/src/routes/marketplace.ts (line varies)
- `POST /tasks` — create marketplace task. Auth: NextAuth→orgId. File: apps/api/src/routes/marketplace.ts (line varies)
- `GET /tasks` — list tasks. Auth: NextAuth→orgId. File: apps/api/src/routes/marketplace.ts (line varies)
- `POST /tasks/:id/submit` — submit task. Auth: NextAuth→orgId. File: apps/api/src/routes/marketplace.ts (line varies)
- `POST /tasks/:id/review` — review task. Auth: NextAuth→orgId. File: apps/api/src/routes/marketplace.ts (line varies)

### Marketplace Persona

- `GET /persona` — get persona config. Auth: NextAuth→orgId. File: apps/api/src/routes/marketplace-persona.ts:25
- `POST /persona` — create or update persona. Auth: NextAuth→orgId. File: apps/api/src/routes/marketplace-persona.ts:41
- `POST /persona/deploy` — deploy persona as agent. Auth: NextAuth→orgId. File: apps/api/src/routes/marketplace-persona.ts:68

### Deployment Memory

- `GET /:orgId/deployments/:deploymentId/memory` — list deployment memory. Auth: NextAuth→orgId. File: apps/api/src/routes/deployment-memory.ts:16
- `POST /:orgId/deployments/:deploymentId/memory` — create memory entry. Auth: NextAuth→orgId. File: apps/api/src/routes/deployment-memory.ts:29
- `DELETE /:orgId/deployments/:deploymentId/memory/:memoryId` — delete memory. Auth: NextAuth→orgId. File: apps/api/src/routes/deployment-memory.ts:56
- `GET /:orgId/deployments/:deploymentId/faq-drafts` — list FAQ drafts. Auth: NextAuth→orgId. File: apps/api/src/routes/deployment-memory.ts:75
- `POST /:orgId/deployments/:deploymentId/faq-drafts/:faqId/approve` — approve FAQ. Auth: NextAuth→orgId. File: apps/api/src/routes/deployment-memory.ts:88
- `POST /:orgId/deployments/:deploymentId/faq-drafts/:faqId/reject` — reject FAQ. Auth: NextAuth→orgId. File: apps/api/src/routes/deployment-memory.ts:106

---

## Creative Pipeline

- `POST /creative-jobs` — submit brief, create AgentTask + CreativeJob. Auth: NextAuth→orgId. Returns `{ task, job }`. File: apps/api/src/routes/creative-pipeline.ts:25
- `GET /creative-jobs` — list jobs for org (filterable by deploymentId). Auth: NextAuth→orgId. Returns `CreativeJob[]`. File: apps/api/src/routes/creative-pipeline.ts:102
- `GET /creative-jobs/:id` — get job with stage outputs. Auth: NextAuth→orgId. Returns `CreativeJob`. File: apps/api/src/routes/creative-pipeline.ts:123
- `POST /creative-jobs/:id/approve` — continue or stop pipeline. Auth: NextAuth→orgId. File: apps/api/src/routes/creative-pipeline.ts:145
- `GET /creative-jobs/:id/estimate` — estimate cost/timeline. Auth: NextAuth→orgId. File: apps/api/src/routes/creative-pipeline.ts:219

---

## Channel & OAuth

### Connections

- `POST /` — create connection (integration setup). Auth: NextAuth→orgId. File: apps/api/src/routes/connections.ts:19
- `GET /` — list connections. Auth: NextAuth→orgId. Returns `Connection[]`. File: apps/api/src/routes/connections.ts:77
- `GET /:id` — get connection detail. Auth: NextAuth→orgId. File: apps/api/src/routes/connections.ts:117
- `PUT /:id` — update connection. Auth: NextAuth→orgId. File: apps/api/src/routes/connections.ts:160
- `DELETE /:id` — delete connection. Auth: NextAuth→orgId. File: apps/api/src/routes/connections.ts:216
- `POST /:id/verify` — verify connection credentials. Auth: NextAuth→orgId. File: apps/api/src/routes/connections.ts:248

### Facebook OAuth

- `GET /facebook/authorize` — initiate Facebook OAuth. Auth: NextAuth→orgId (optional). File: apps/api/src/routes/facebook-oauth.ts:31
- `GET /facebook/callback` — Facebook OAuth callback. Auth: public. File: apps/api/src/routes/facebook-oauth.ts:59
- `GET /facebook/:deploymentId/accounts` — list linked Facebook accounts. Auth: NextAuth→orgId. File: apps/api/src/routes/facebook-oauth.ts:153

### Google Calendar OAuth

- `GET /google-calendar/authorize` — initiate Google Calendar OAuth. Auth: NextAuth→orgId. File: apps/api/src/routes/google-calendar-oauth.ts:66
- `GET /google-calendar/callback` — Google Calendar OAuth callback. Auth: public. File: apps/api/src/routes/google-calendar-oauth.ts:102
- `GET /google-calendar/:deploymentId/calendars` — list linked calendars. Auth: NextAuth→orgId. File: apps/api/src/routes/google-calendar-oauth.ts:217

### WhatsApp

- `POST /whatsapp/test` — send test WhatsApp message. Auth: NextAuth→orgId. File: apps/api/src/routes/whatsapp-test.ts (line varies)
- `POST /whatsapp/flows` — WhatsApp flow event webhook. Auth: API key or public. File: apps/api/src/routes/whatsapp-flows.ts (line varies)
- `POST /whatsapp/onboard` — WhatsApp onboarding. Auth: NextAuth→orgId. File: apps/api/src/routes/whatsapp-onboarding.ts (line varies)

---

## Revenue & Analytics

### Revenue

- `POST /:orgId/revenue` — record revenue event. Auth: NextAuth→orgId. File: apps/api/src/routes/revenue.ts (line varies)
- `GET /:orgId/revenue` — list revenue events. Auth: NextAuth→orgId. Returns `RevenueEvent[]`. File: apps/api/src/routes/revenue.ts (line varies)
- `GET /:orgId/revenue/summary` — revenue summary (total, count, period). Auth: NextAuth→orgId. File: apps/api/src/routes/revenue.ts (line varies)
- `GET /:orgId/revenue/by-campaign` — revenue aggregated by campaign. Auth: NextAuth→orgId. File: apps/api/src/routes/revenue.ts (line varies)

### ROI

- `GET /:orgId/roi/summary` — ROI summary by channel/campaign. Auth: NextAuth→orgId. File: apps/api/src/routes/roi.ts (line varies)

---

## Tasks & Workflows

### Owner Tasks

- `GET /:orgId/tasks` — list owner tasks. Auth: NextAuth→orgId. File: apps/api/src/routes/owner-tasks.ts:7
- `PATCH /:orgId/tasks/:taskId` — update task status. Auth: NextAuth→orgId. File: apps/api/src/routes/owner-tasks.ts:18

### Workflows

- `GET /:id` — get single workflow. Auth: optional organizationId query. File: apps/api/src/routes/workflows.ts:19
- `GET /` — list workflows (organizationId required). Auth: query param. File: apps/api/src/routes/workflows.ts:38
- `POST /:id/cancel` — cancel workflow. Auth: optional organizationId query. File: apps/api/src/routes/workflows.ts:65

### Scheduled Reports

- `GET /` — list scheduled reports. Auth: NextAuth→orgId. File: apps/api/src/routes/scheduled-reports.ts (line varies)
- `POST /` — create report schedule. Auth: NextAuth→orgId. File: apps/api/src/routes/scheduled-reports.ts (line varies)
- `PUT /:id` — update report schedule. Auth: NextAuth→orgId. File: apps/api/src/routes/scheduled-reports.ts (line varies)
- `DELETE /:id` — delete report schedule. Auth: NextAuth→orgId. File: apps/api/src/routes/scheduled-reports.ts (line varies)
- `POST /:id/run` — manually trigger report. Auth: NextAuth→orgId. File: apps/api/src/routes/scheduled-reports.ts (line varies)

---

## Competence & Policies

### Competence

- `GET /` — list competencies. Auth: NextAuth→orgId. File: apps/api/src/routes/competence.ts:6
- `GET /:key` — get competency detail. Auth: NextAuth→orgId. File: apps/api/src/routes/competence.ts:28
- `GET /:key/status` — get competency status. Auth: NextAuth→orgId. File: apps/api/src/routes/competence.ts:48
- `POST /` — create competency. Auth: NextAuth→orgId. File: apps/api/src/routes/competence.ts:67
- `PUT /:key` — update competency. Auth: NextAuth→orgId. File: apps/api/src/routes/competence.ts:100
- `DELETE /:key` — delete competency. Auth: NextAuth→orgId. File: apps/api/src/routes/competence.ts:131

### Policies

- `GET /` — list governance policies. Auth: NextAuth→orgId. File: apps/api/src/routes/policies.ts (line varies)
- `POST /` — create policy. Auth: NextAuth→orgId. File: apps/api/src/routes/policies.ts (line varies)
- `GET /:id` — get policy detail. Auth: NextAuth→orgId. File: apps/api/src/routes/policies.ts (line varies)
- `PUT /:id` — update policy. Auth: NextAuth→orgId. File: apps/api/src/routes/policies.ts (line varies)
- `DELETE /:id` — delete policy. Auth: NextAuth→orgId. File: apps/api/src/routes/policies.ts (line varies)

---

## Infrastructure & Health

### Health & Setup

- `GET /health` — basic health check. Auth: public. File: apps/api/src/routes/health.ts:6
- `GET /ready` — readiness probe (all stores + DB). Auth: public. File: apps/api/src/routes/health.ts:142
- `POST /bootstrap` — initialize org (onboarding). Auth: NextAuth→orgId. File: apps/api/src/routes/setup.ts (line varies)
- `POST /onboard` — WhatsApp/channel onboarding. Auth: NextAuth→orgId. File: apps/api/src/routes/onboard.ts:48

### Misc

- `POST /ingress/submit` — inbound message ingress webhook. Auth: public (external). File: apps/api/src/routes/ingress.ts:5
- `POST /api/simulate` — simulate agent execution. Auth: NextAuth→orgId. File: apps/api/src/routes/simulate.ts (line varies)
- `POST /execute` — execute action (internal). Auth: API key. File: apps/api/src/routes/execute.ts:25
- `GET /storefront/:slug` — get org storefront. Auth: public. File: apps/api/src/routes/storefront.ts (line varies)

---

## Test Setup

**Test entry point:** `apps/api/src/routes/__tests__/` (22 test files)

**Key test utilities:**

- `buildTestServer()` — creates test Fastify instance with mocked stores. File: `build-conversation-test-app.ts`
- `buildConversationTestApp()` — specialized builder for conversation/escalation tests.

**Cross-tenant isolation test:**

- `escalations-cross-tenant.test.ts` — verifies org scoping on ConversationState lookups (TI-5/TI-6). Ensures null organizationId rows are not leaked between orgs.

**Notable test files:**

- `conversations-send.test.ts` — end-to-end conversation send + trace
- `escalation-resolve.test.ts` — escalation workflow
- `billing.test.ts` — Stripe webhook idempotency
- `marketplace.test.ts` — deployment + listing CRUD
- `readiness.test.ts` — readiness probe edge cases

---

## Auth Patterns Summary

| Pattern                 | Usage                                                      | Example                                |
| ----------------------- | ---------------------------------------------------------- | -------------------------------------- |
| **NextAuth→orgId**      | Most dashboard routes. Session → `organizationIdFromAuth`. | GET /api/decisions                     |
| **NextAuth→role check** | Admin-only ops. `requireRole(req, reply, "admin")`.        | GET /api/audit/verify                  |
| **API Key**             | Backend integrations. Metadata resolves orgId.             | POST /execute                          |
| **Public**              | OAuth callbacks, health, ingress. No auth.                 | GET /health, GET /facebook/callback    |
| **x-org-id header**     | Dev/test only. `authDisabled=true` falls back to header.   | GET /agents/:key/decisions (test mode) |

---
