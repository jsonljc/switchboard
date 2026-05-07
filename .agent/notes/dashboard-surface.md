# Dashboard Surface (apps/dashboard)

**Generated:** 2026-05-07  
**Next.js App Router, port 3002**

## How to Use This Doc

This document indexes all public-facing pages (App Router route segments), API proxy routes (Next.js route handlers), and custom hooks (React Query hooks) in `apps/dashboard`. Pages are listed by path; API routes show upstream endpoints they proxy to; hooks show query keys and return types. For component props, refer to the source.

**Total pages:** 43+ | **Total API routes:** 25+ | **Total hooks:** 55

---

## Pages (App Router)

### Public Pages (Open Access)

- `/` (home) — marketing landing page. File: apps/dashboard/src/app/(public)/page.tsx
- `/login` — authentication entry point. File: apps/dashboard/src/app/login/page.tsx
- `/signup` — registration. File: apps/dashboard/src/app/(public)/signup/page.tsx
- `/agents` — product showcase. File: apps/dashboard/src/app/(public)/agents/page.tsx
- `/pricing` — pricing table. File: apps/dashboard/src/app/(public)/pricing/page.tsx
- `/how-it-works` — product features. File: apps/dashboard/src/app/(public)/how-it-works/page.tsx
- `/get-started` — onboarding CTA. File: apps/dashboard/src/app/(public)/get-started/page.tsx
- `/privacy` — privacy policy. File: apps/dashboard/src/app/(public)/privacy/page.tsx
- `/terms` — terms of service. File: apps/dashboard/src/app/(public)/terms/page.tsx

### Preview/Debug Pages (Dev)

- `/decisions-preview` — decision feed component test. File: apps/dashboard/src/app/(preview)/decisions-preview/page.tsx

### Post-Auth Pages

- `/post-auth` — post-authentication flow (org selection, setup). File: apps/dashboard/src/app/post-auth/page.tsx

### Authenticated Pages (App Router: `(auth)/`)

- `/dashboard` — owner home (overview, stats, activity). File: apps/dashboard/src/app/(auth)/dashboard/page.tsx
- `/decide` — decision inbox (recommendations + handoffs). File: apps/dashboard/src/app/(auth)/decide/page.tsx
- `/escalations` — escalation management (pending, resolved). File: apps/dashboard/src/app/(auth)/escalations/page.tsx
- `/conversations` — lead conversation browser. File: apps/dashboard/src/app/(auth)/conversations/page.tsx
- `/tasks` — owner tasks (TODO). File: apps/dashboard/src/app/(auth)/tasks/page.tsx
- `/my-agent` — agent config/settings. File: apps/dashboard/src/app/(auth)/my-agent/page.tsx
- `/[agentKey]` — dynamic agent detail page. File: apps/dashboard/src/app/(auth)/[agentKey]/page.tsx
- `/settings` — org settings. File: apps/dashboard/src/app/(auth)/settings/page.tsx
- `/me` — user profile. File: apps/dashboard/src/app/(auth)/me/page.tsx

### Additional Auth Pages (Found in tree)

- Various other authenticated route segments (exact routes vary by app layout structure).

---

## API Proxy Routes

All proxy routes enforce NextAuth session via `requireDashboardSession()` and route through `getApiClient()` to `apps/api` (port 3000).

### Decisions & Recommendations

- `GET /api/dashboard/decisions` — proxy to `GET /api/decisions`. Returns cross-agent inbox. File: apps/dashboard/src/app/api/dashboard/decisions/route.ts
- `POST /api/dashboard/recommendations/:id/act` — proxy to `POST /api/recommendations/:id/act`. File: apps/dashboard/src/app/api/dashboard/recommendations/route.ts
- `GET /api/dashboard/recommendations` — proxy to `GET /api/recommendations`. File: apps/dashboard/src/app/api/dashboard/recommendations/route.ts

### Escalations

- `GET /api/dashboard/escalations` — proxy to `GET /api/escalations`. File: apps/dashboard/src/app/api/dashboard/escalations/route.ts
- `GET /api/dashboard/escalations/:id` — proxy to `GET /api/escalations/:id`. File: apps/dashboard/src/app/api/dashboard/escalations/route.ts
- `POST /api/dashboard/escalations/:id/reply` — proxy to `POST /api/escalations/:id/reply`. File: apps/dashboard/src/app/api/dashboard/escalations/route.ts
- `POST /api/dashboard/escalations/:id/resolve` — proxy to `POST /api/escalations/:id/resolve`. File: apps/dashboard/src/app/api/dashboard/escalations/route.ts

### Conversations

- `GET /api/dashboard/conversations` — proxy to `GET /api/conversations`. File: apps/dashboard/src/app/api/dashboard/conversations/route.ts
- `GET /api/dashboard/conversations/:id` — proxy to `GET /api/conversations/:id`. File: apps/dashboard/src/app/api/dashboard/conversations/route.ts
- `PATCH /api/dashboard/conversations/:id` — proxy to `PATCH /api/conversations/:id`. File: apps/dashboard/src/app/api/dashboard/conversations/route.ts
- `POST /api/dashboard/conversations/:id/send-override` — proxy to `POST /api/conversations/:id/send-override`. File: apps/dashboard/src/app/api/dashboard/conversations/route.ts

### Agents & Roster

- `GET /api/dashboard/agents/roster` — proxy to `GET /api/agents/roster`. File: apps/dashboard/src/app/api/dashboard/agents/route.ts
- `GET /api/dashboard/agents/state` — proxy to `GET /api/agents/state`. File: apps/dashboard/src/app/api/dashboard/agents/route.ts
- `POST /api/dashboard/agents/roster` — proxy to `POST /api/agents/roster`. File: apps/dashboard/src/app/api/dashboard/agents/route.ts
- `PUT /api/dashboard/agents/roster/:id` — proxy to `PUT /api/agents/roster/:id`. File: apps/dashboard/src/app/api/dashboard/agents/route.ts

### Dashboard Overview

- `GET /api/dashboard/overview` — proxy to `GET /:orgId/dashboard/overview`. File: apps/dashboard/src/app/api/dashboard/health/route.ts (or dedicated)

### Audit & Governance

- `GET /api/dashboard/audit` — proxy to `GET /api/audit`. File: apps/dashboard/src/app/api/dashboard/audit/route.ts
- `GET /api/dashboard/audit/:id` — proxy to `GET /api/audit/:id`. File: apps/dashboard/src/app/api/dashboard/audit/route.ts

### Knowledge & Identity

- `GET /api/dashboard/knowledge` — proxy to `GET /api/knowledge/documents`. File: apps/dashboard/src/app/api/dashboard/knowledge/route.ts
- `POST /api/dashboard/identity/upload-avatar` — proxy to avatar endpoint. File: apps/dashboard/src/app/api/dashboard/identity/route.ts

### Connections & Integrations

- `GET /api/dashboard/connections` — proxy to `GET /api/connections`. File: apps/dashboard/src/app/api/dashboard/connections/route.ts
- `POST /api/dashboard/connections` — proxy to `POST /api/connections`. File: apps/dashboard/src/app/api/dashboard/connections/route.ts

### Tasks, Billing, Others

- `GET /api/dashboard/tasks` — proxy to `GET /:orgId/tasks`. File: apps/dashboard/src/app/api/dashboard/tasks/route.ts
- `PATCH /api/dashboard/tasks/:id` — proxy to `PATCH /:orgId/tasks/:id`. File: apps/dashboard/src/app/api/dashboard/tasks/route.ts
- `GET /api/dashboard/roi` — proxy to `GET /:orgId/roi/summary`. File: apps/dashboard/src/app/api/dashboard/roi/route.ts
- `POST /api/dashboard/playbook` — proxy to playbook routes. File: apps/dashboard/src/app/api/dashboard/playbook/route.ts
- `POST /api/dashboard/simulate` — proxy to simulate route. File: apps/dashboard/src/app/api/dashboard/simulate/route.ts
- `GET /api/dashboard/operator-chat` — server-sent events for operator chat. File: apps/dashboard/src/app/api/dashboard/operator-chat/route.ts
- `GET /api/dashboard/health` — proxy to health check. File: apps/dashboard/src/app/api/dashboard/health/route.ts

### Organizations

- `GET /api/dashboard/organizations` — list org config (via proxy). File: apps/dashboard/src/app/api/dashboard/organizations/route.ts

### Auth & Signup

- `POST /api/auth/register` — register new user. Auth: public. File: apps/dashboard/src/app/api/auth/register/route.ts
- `POST /api/auth/verify-email` — verify email token. Auth: public. File: apps/dashboard/src/app/api/auth/verify-email/route.ts
- `GET /api/auth/[...nextauth]` — NextAuth.js handler. Auth: NextAuth config. File: apps/dashboard/src/app/api/auth/[...nextauth]/route.ts

### Misc

- `GET /api/waitlist` — waitlist signup. Auth: public. File: apps/dashboard/src/app/api/waitlist/route.ts

---

## Hooks

All hooks use React Query and are scoped by organization/session via `useScopedQueryKeys()`.

### Agent Hooks

- `useAgentRoster() -> { data: { roster: AgentRosterEntry[] }, ... }` — fetch agent roster. Query key: `keys.agents.roster()`. File: apps/dashboard/src/hooks/use-agents.ts
- `useAgentState() -> { data: { states: AgentStateEntry[] }, ... }` — fetch agent activity state. Query key: `keys.agents.state()`. Refetch: 60s. File: apps/dashboard/src/hooks/use-agents.ts
- `useUpdateAgentRoster() -> useMutation({ ... })` — update roster entry. File: apps/dashboard/src/hooks/use-agents.ts
- `useInitializeRoster() -> useMutation({ ... })` — initialize default roster. File: apps/dashboard/src/hooks/use-agents.ts
- `useAgentMetrics(agentKey) -> { data: { metrics }, ... }` — fetch agent KPIs (conversations, conversions, etc.). File: apps/dashboard/src/hooks/use-agent-metrics.ts
- `useAgentGreeting(agentKey) -> { data: { greeting }, ... }` — fetch agent greeting message. File: apps/dashboard/src/hooks/use-agent-greeting.ts
- `useAgentPipeline(agentKey) -> { data: { funnel }, ... }` — fetch agent funnel (inquiry→qualified→booked). File: apps/dashboard/src/hooks/use-agent-pipeline.ts
- `useAgentWins(agentKey) -> { data: { wins }, ... }` — fetch agent win events. File: apps/dashboard/src/hooks/use-agent-wins.ts
- `useAgentActivity(agentKey) -> { data: { activity }, ... }` — fetch agent activity log. File: apps/dashboard/src/hooks/use-agent-activity.ts

### Decision & Approval Hooks

- `useDecisionFeed() -> { data: { decisions, counts }, ... }` — fetch cross-agent decision inbox. Query key: `keys.decisions()`. File: apps/dashboard/src/hooks/use-decision-feed.ts
- `useApprovals() -> { data: { approvals }, ... }` — fetch pending approvals. Query key: `keys.approvals()`. File: apps/dashboard/src/hooks/use-approvals.ts
- `useApprovalAction(id) -> useMutation({ ... })` — respond to approval (approve/reject/patch). File: apps/dashboard/src/hooks/use-approval-action.ts

### Recommendation Hooks

- `useRecommendations(surface, status) -> { data: { recommendations }, ... }` — fetch recommendations by surface. Query key: `keys.recommendations(surface, status)`. File: apps/dashboard/src/hooks/use-recommendations.ts
- `useRecommendationAction(id) -> useMutation({ ... })` — act on recommendation (primary/secondary/dismiss). File: apps/dashboard/src/hooks/use-recommendation-action.ts
- `useShadowActions() -> { data: { actions }, ... }` — fetch shadow actions (non-queue recommendations). Query key: `keys.shadowActions()`. File: apps/dashboard/src/hooks/use-shadow-actions.ts

### Escalation Hooks

- `useEscalations(status) -> { data: { escalations }, ... }` — fetch escalations filtered by status. Query key: `keys.escalations(status)`. File: apps/dashboard/src/hooks/use-escalations.ts
- `useEscalationReply(id) -> useMutation({ ... })` — post reply and release escalation. File: apps/dashboard/src/hooks/use-escalation-reply.ts

### Conversation Hooks

- `useConversations(opts) -> { data: { conversations, total }, ... }` — fetch conversations with pagination. Query key: `keys.conversations(opts)`. File: apps/dashboard/src/hooks/use-conversations.ts
- `useConversationOverride(threadId) -> useMutation({ ... })` — send owner override message. File: apps/dashboard/src/hooks/use-conversation-override.ts

### Dashboard Overview

- `useDashboardOverview() -> { data: DashboardOverview, ... }` — fetch aggregated dashboard (bookings, tasks, revenue, activity). Query key: `keys.dashboard()`. Refetch: on window focus. File: apps/dashboard/src/hooks/use-dashboard-overview.ts

### Analytics & Revenue

- `useRoi() -> { data: { roi }, ... }` — fetch ROI summary. Query key: `keys.roi()`. File: apps/dashboard/src/hooks/use-roi.ts
- `useBilling() -> { data: { subscriptionStatus, planName }, ... }` — fetch billing info. Query key: `keys.billing()`. File: apps/dashboard/src/hooks/use-billing.ts

### Knowledge & Identity

- `useKnowledge(agentId?) -> { data: { documents }, ... }` — fetch knowledge documents. Query key: `keys.knowledge(agentId)`. File: apps/dashboard/src/hooks/use-knowledge.ts
- `useIdentity() -> { data: { operators }, ... }` — fetch operator identities. Query key: `keys.identity()`. File: apps/dashboard/src/hooks/use-identity.ts

### Audit & Governance

- `useAudit(filters) -> { data: { entries }, ... }` — fetch audit log with optional filters. Query key: `keys.audit(filters)`. File: apps/dashboard/src/hooks/use-audit.ts
- `useGovernance(orgId) -> { data: { profile, posture }, ... }` — fetch governance profile. Query key: `keys.governance(orgId)`. File: apps/dashboard/src/hooks/use-governance.ts

### Marketplace & Deployment

- `useMarketplace() -> { data: { listings }, ... }` — fetch marketplace listings. Query key: `keys.marketplace()`. File: apps/dashboard/src/hooks/use-marketplace.ts
- `useCreativePipeline() -> { data: { jobs }, ... }` — fetch creative jobs. Query key: `keys.creativePipeline()`. File: apps/dashboard/src/hooks/use-creative-pipeline.ts
- `useManagedChannels() -> { data: { channels }, ... }` — fetch managed channels. Query key: `keys.managedChannels()`. File: apps/dashboard/src/hooks/use-managed-channels.ts

### Configuration & State

- `useOrgConfig() -> { data: { config }, ... }` — fetch org configuration. Query key: `keys.orgConfig()`. File: apps/dashboard/src/hooks/use-org-config.ts
- `useConnections() -> { data: { connections }, ... }` — fetch integrations. Query key: `keys.connections()`. File: apps/dashboard/src/hooks/use-connections.ts
- `usePlaybook() -> { data: { playbook }, ... }` — fetch playbook config. Query key: `keys.playbook()`. File: apps/dashboard/src/hooks/use-playbook.ts
- `useModuleStatus() -> { data: { status }, ... }` — fetch feature module status. Query key: `keys.moduleStatus()`. File: apps/dashboard/src/hooks/use-module-status.ts

### Simulation & Traces

- `useSimulation(params) -> useMutation({ ... })` — simulate agent execution. File: apps/dashboard/src/hooks/use-simulation.ts
- `useTraces(deploymentId) -> { data: { traces }, ... }` — fetch execution traces. Query key: `keys.traces(deploymentId)`. File: apps/dashboard/src/hooks/use-traces.ts

### UI & Utility Hooks

- `useScrollReveal() -> { ref, isVisible }` — intersection observer for scroll animations. File: apps/dashboard/src/hooks/use-scroll-reveal.ts
- `useTheme() -> { theme, setTheme }` — dark mode toggle. File: apps/dashboard/src/hooks/use-theme.ts
- `useEntrancePlayed() -> boolean` — track if entrance animation has played. File: apps/dashboard/src/hooks/use-entrance-played.ts
- `useFirstRun() -> boolean` — detect if org's first interaction. File: apps/dashboard/src/hooks/use-first-run.ts
- `useOnboardingDraft() -> { draft, saveDraft }` — persist onboarding form state. File: apps/dashboard/src/hooks/use-onboarding-draft.ts

### Query Key Factory

- `useScopedQueryKeys() -> { agents, decisions, approvals, ... }` — get organization-scoped query key factory. Used by all hooks to ensure multi-tenant isolation. File: apps/dashboard/src/hooks/use-query-keys.ts

### Ad Optimizer (Specialized)

- `useAdOptimizer() -> { data: { campaigns }, ... }` — fetch ad campaign insights. Query key: `keys.adOptimizer()`. File: apps/dashboard/src/hooks/use-ad-optimizer.ts

### Website Scan (Specialized)

- `useWebsiteScan(url) -> useMutation({ ... })` — scan website for SEO/engagement metrics. File: apps/dashboard/src/hooks/use-website-scan.ts

---

## Auth & Routing

**Session Enforcement:**

- `requireDashboardSession()` — ServerComponent guard in `libs/lib/require-dashboard-session.ts`. Throws if not authenticated; called by all proxy routes.

**API Client:**

- `getApiClient()` — returns authenticated fetch wrapper to `apps/api`. Injects session token / API key. File: `libs/lib/get-api-client.ts`.

**NextAuth Config:**

- `[...nextauth]/route.ts` — NextAuth.js handler. Supports email+password, OAuth providers. File: apps/dashboard/src/app/api/auth/[...nextauth]/route.ts

---

## Notable Patterns

### 1. Scoped Query Keys

All hooks use `useScopedQueryKeys()` which namespaces queries by organization:

```
keys.agents.roster() → ["orgs", orgId, "agents", "roster"]
keys.decisions() → ["orgs", orgId, "decisions"]
```

This ensures React Query caches are isolated per tenant.

### 2. Error Boundaries

Proxy routes return `NextResponse.json(error, { status: 401|500 })` on auth failure or upstream 5xx.

### 3. Refetch Strategies

- Dashboard overview: refetch on window focus
- Agent state: 60s refetch interval
- Most others: stale-while-revalidate, refetch on mutation

### 4. Pagination

Conversation/decision lists support `limit` and `offset` query parameters.

---

## Potential Gaps / Orphaned Routes

1. **Unused Playbook Proxy** — `POST /api/dashboard/playbook` proxies upstream but UI integration unclear.
2. **Simulate Route** — `POST /api/dashboard/simulate` for testing agent flows; minimal documentation.
3. **Operator Chat** — `GET /api/dashboard/operator-chat` (SSE) is mapped but no dedicated hook.
4. **Website Scan Hook** — `useWebsiteScan()` exists but no page integration found.
5. **Ad Optimizer** — `useAdOptimizer()` and `ad-optimizer.ts` route exist but status unknown.

---

## File Locations Summary

| Type       | Path                                         |
| ---------- | -------------------------------------------- |
| Pages      | `apps/dashboard/src/app/*/page.tsx`          |
| API Routes | `apps/dashboard/src/app/api/**/route.ts`     |
| Hooks      | `apps/dashboard/src/hooks/use-*.ts(x)`       |
| Types      | `apps/dashboard/src/lib/api-client-types.ts` |
| Query Keys | `apps/dashboard/src/hooks/use-query-keys.ts` |
