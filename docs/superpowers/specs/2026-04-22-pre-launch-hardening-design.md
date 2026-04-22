# Pre-Launch Hardening — Staged C Program

> Full-stack audit and remediation before public launch.
> Structured as 3 tracks with stabilization gates.
> Every change tied to one of 3 goals: fix a broken flow, reduce known maintenance risk, or create consistency in a surface we will actively keep using.

---

## Scope Fence

### Must-Be-Solid User Flows

- Marketplace browse → agent detail → hire → deploy
- Onboarding end-to-end (entry → training → test center → go-live)
- Business facts capture/edit on deployed agents
- Task update flow (approve/reject from Decide)
- Settings: identity persistence, knowledge with correct agent targeting
- ROI and operator chat reachable from dashboard navigation
- Channel connection flows: web widget, Telegram, WhatsApp

### Must-Be-Solid Engineering Contracts

- Consistent proxy error shape across all backend-calling proxies
- Consistent API client usage pattern (no raw fetch to backend)
- No dead or misleading routes
- No duplicated surfaces without intentional role split
- No hardcoded agent IDs in generalized pages
- No launch-visible placeholder behavior disguised as real behavior

---

## Upfront Decisions (Locked)

### 1. Catalog Ownership

- `/agents` is the canonical public catalog (SSR, marketing hero, SEO)
- Public `/marketplace` redirects to `/agents`
- `(auth)/marketplace/page.tsx` is the authenticated operational browse (Hire tab)
- `/agents` = discovery/SEO. Authenticated `/marketplace` = operational hire/deploy workflow.

### 2. Error Contract

Every non-2xx backend and proxy response returns:

```typescript
{
  error: string;
  statusCode: number;
}
```

- `hint` and `details` optional, only when genuinely useful
- No plain text error responses
- No alternate shapes like `{ message: ... }`
- No empty body on failure

### 3. Identity Persistence

- API-backed identity is canonical (backend identity API + `useIdentity` hook)
- Settings page rewired to `useIdentity`
- localStorage removed as persistence layer for identity fields
- No dual persistence

### 4. Channel Status

- Launch model is binary: **connected** / **not connected**
- Health test results surfaced as transient feedback only (toast/alert after "Test" click)
- No pending/error/disconnected lifecycle introduced yet

### 5. Creative Deployment Gating

- Creative pipeline UI renders only when `listing.metadata.family === "creative"`
- Gate is structural: non-creative deployments do not render creative sections, actions, or fetches
- Ad optimizer already correctly gated behind `paid_media` family + `ad-optimizer` slug

---

## Track 1: Launch-Critical Repair

> Fix visible brokenness, broken nav, fake persistence, misleading UI.
> Every item either causes a runtime error, sends users to a broken surface, or fakes persistence.

### Phase A: Fix Broken Backend Paths

Unblocks everything else. Do first.

1. **Add `PrismaDeploymentStore.update()`** — partial `inputConfig` updates via Prisma `update` with merge semantics
2. **Add `PATCH /api/marketplace/deployments/:id` route** — accepts partial `inputConfig`, calls store `update()`
3. **Fix `updateTask()` in api-client** — change path from `/tasks/${taskId}` to `/api/${orgId}/tasks/${taskId}`, thread orgId through
4. **Rewire `getBusinessFacts`/`upsertBusinessFacts`** — point to deployment `inputConfig` via new PATCH endpoint instead of non-existent `/deployments/:id/config`

**Regression check after A:** Verify no dashboard proxy 404s on task update and business facts flows.

### Phase B: Route & Navigation Coherence

5. **Create `(auth)/marketplace/page.tsx`** — operational browse for Hire tab (category filter, listing cards, deploy flow links)
6. **Redirect `(public)/marketplace` → `/agents`** — permanent redirect, do after step 5
7. **Fold `/tasks` into Decide** — add task review section to Decide page. Old `/tasks` route redirects to `/decide` (safer than immediate deletion; delete the route later only if safe).
8. **Link `/my-agent/[id]` from Today dashboard** — use actual deployment/agent context, not hardcoded path
9. **Link `/dashboard/roi` from revenue summary** on Today dashboard
10. **Add Playbook to Me page settings list** — add `/settings/playbook` alongside existing settings links
11. **Remove Connections tab from Account page** — Channels page (`/settings/channels`) is the single home for connection management
12. **Fix `#test-lead` CTA** — point to `/my-agent/[deploymentId]` test chat, resolved from user's actual deployment context

**Regression check after B:** Verify all nav destinations resolve, tab-bar continuity intact, all changed routes loadable by direct URL.

### Phase C: Persistence & Data Fixes

13. **Rewire `/settings/identity` from localStorage to `useIdentity` hook** — delete localStorage path entirely
14. **Fix `agentId="creative"` hardcode in knowledge page** — derive from user's actual deployment/agent context
15. **Fix widget token fallback** — show explicit "no widget connected" state instead of silently using deploymentId as token

**Regression check after C:** Identity persists after reload/sign-out/sign-in. Knowledge page resolves correct deployment context.

### Phase D: Coming-Soon Gating

16. **Gate creative pipeline section** behind `listing.metadata.family === "creative"` — structural gate: no render, no fetch, no empty state, no buttons for non-creative deployments
17. **Verify ad-optimizer gate** — confirm `paid_media` family + `ad-optimizer` slug check is correct
18. **Verify WhatsApp connection flow end-to-end** — if broken, show "Coming Soon" badge instead of broken connect button

**Regression check after D:** Hidden sections verified not to fetch in network logs.

### Phase E: Dead Code Removal

Last in Track 1, after all live paths are green.

19. **Delete old onboarding wizard files:**
    - `components/onboarding/wizard-shell.tsx`
    - `components/onboarding/step-ad-platform.tsx`
    - `components/onboarding/step-channels.tsx`
    - `components/onboarding/step-knowledge-rules.tsx`
    - `components/onboarding/step-review-launch.tsx`
20. **Delete unused mission-control components** (5 files) — verify no imports first
21. **Replace `(public)/marketplace/page.tsx`** with redirect (from step 6, if not already done inline)

### Track 1 Exit Criteria

- Every nav item resolves to a coherent destination
- Every primary CTA either works or is explicitly labeled otherwise
- No user can land on a route that looks production-ready but is broken
- Zero runtime 404s from the dashboard proxy layer
- Identity settings persist across sessions and devices
- All primary CTAs clicked once manually
- All changed routes loaded directly by URL
- All hidden sections verified not to fetch in network logs

---

## Track 2: Consistency Hardening

> Only starts after Track 1 is green. No cross-track mixing.

### 2.1 Error Contract Enforcement

**Backend:** Audit every route file, add `statusCode` to error responses where missing. Governance routes already include it; marketplace, conversations, knowledge, creative-pipeline routes don't. ~15 route files, one-line addition per error response.

**Proxy normalization:** Create shared helper:

```typescript
// apps/dashboard/src/lib/proxy-error.ts
function proxyError(backendBody: unknown, fallbackStatus: number): NextResponse;
```

Behavioral rule: if backend returns malformed or empty error body, helper still returns `{ error: "Request failed", statusCode: fallbackStatus }`.

All proxy catch blocks use this instead of ad-hoc error construction.

**Frontend:** No changes — `api-client-base.ts` already reads `body.error`.

### 2.2 Proxy Consolidation

Rewire ROI and operator-chat proxies from raw `fetch` to `getApiClient()`. ~20 lines per file.

Scope: only these 2 proxies. Don't touch proxies that already use `getApiClient()`.

### 2.3 Auth/Header Propagation

Solved by 2.2 — once ROI and operator-chat use `getApiClient()`, all backend-calling proxies use the same auth propagation path.

### Track 2 Exit Criteria

- Every non-2xx response from backend and proxy matches `{ error: string; statusCode: number }`
- All dashboard proxy routes that call the backend use `getApiClient()` (exceptions allowed only for clearly documented non-backend cases)
- Proxy error handling uses the shared `proxyError()` helper
- **Regression check:** Re-test all primary flows from Track 1. Verify error states render predictably (400, 404, 500, session expiry).

---

## Track 3: Structural Cleanup

> Only starts after Track 2 is green.

### 3.1 Split `api-client.ts`

Current file exceeds 600 lines with `/* eslint-disable max-lines */`. Split by domain:

```
apps/dashboard/src/lib/
  api-client/
    core.ts          — shared transport (request method, auth, base URL)
    marketplace.ts   — listings, deployments, tasks, trust, creative jobs
    dashboard.ts     — overview, ROI, simulate, playbook, website-scan
    settings.ts      — identity, connections
    knowledge.ts     — knowledge endpoints
    governance.ts    — approvals, audit, escalations, DLQ
    agents.ts        — roster, state, activity, wizard
    index.ts         — re-export assembled client
```

Each domain file extends or composes from `core.ts`. Hooks import from the same `api-client` path — no consumer changes needed if the index re-exports the full client interface.

### 3.2 Remaining Dead Code

After Track 1 deletions, verify and remove:

- Orphaned imports or type definitions left behind
- Unused hooks that only served deleted components
- Empty directories

### 3.3 Channel Connection Flow Audit

End-to-end verification of all three launch channels:

| Channel    | Flow                                                              | Verify                                                    |
| ---------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| Web Widget | Deploy → widget token generated → embed script → messages arrive  | Token generation, script tag correctness, chat server URL |
| Telegram   | Deploy → bot token entered → webhook registered → messages arrive | Webhook URL, bot API integration                          |
| WhatsApp   | Deploy → phone number connected → messages arrive                 | Connection flow completeness, message routing             |

For each channel, test happy path and failure path. Record explicit status:

- **Works** — end-to-end verified
- **Partially works** — with exact description of what breaks
- **Blocked** — with exact blocker and whether launch-blocking
- **Deferred** — with rationale

### 3.4 Missing Proxies (Shipped Surfaces Only)

Add dashboard proxies only for backend endpoints that the shipped UI needs but currently lacks. Do not speculatively add proxies for admin/system endpoints. Any new proxy added in Track 3 must immediately use `getApiClient()` and `proxyError()` — the consistency contract from Track 2 must not regress.

### Track 3 Exit Criteria

- `api-client.ts` split complete, no `max-lines` disable, all hooks still work
- Zero orphaned imports or dead files from Track 1/2 deletions
- All three channel flows verified end-to-end with documented, classified results
- Engineers can trace any route → proxy → backend without archaeology
- **Final regression check:** Full production-style walkthrough of all user flows

---

## Stabilization Gates

| Gate   | When          | Pass Criteria                                                                                                                                                                   |
| ------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gate 1 | After Track 1 | Phase-level checks (A→E). Zero proxy 404s. Nav coherent. Identity persists. Hidden sections don't fetch. All primary CTAs clicked manually. All changed routes loadable by URL. |
| Gate 2 | After Track 2 | All error states render predictably. No raw fetch to backend in proxies. All Track 1 flows re-tested.                                                                           |
| Gate 3 | After Track 3 | Full walkthrough complete. Channel flows documented with explicit status. Code traceable. Release notes drafted.                                                                |

**Stop rule:** If regression risk rises at any gate, stop and fix before proceeding to next track. The program can ship after any green gate — Track 1 alone is launch-viable.

---

## Risk Controls

1. **No cross-track mixing** — do not split api-client.ts while still discovering broken user flows
2. **No invisible rewrites** — architecturally large changes with indirect user benefit wait until Track 1 is green
3. **One source of truth per decision** — especially for marketplace route ownership, settings persistence, proxy error contract, API client access pattern
4. **Delete aggressively, but only with proof** — removable only if no route references it, no current flow references it, no near-term planned use justifies keeping it
5. **Every "coming soon" surface must be explicit** — never let users discover non-working features by clicking into them

---

## What's Deferred (Even in C)

- Broad backend redesigns not tied to surfaced pain
- Speculative abstraction layers
- Large re-orgs across untouched domains
- Generalized framework creation "for future use"
- Fixing internal ugliness where no current feature depends on it
- Additional channel status lifecycle (pending/error/disconnected)
- Richer error contract fields (code, details as structured types)

---

## Done Criteria

C is done when:

1. A first user can move through the product without encountering fake, broken, or contradictory surfaces
2. The visible product behaves coherently across nav, settings, tasks, marketplace, onboarding, and key dashboard surfaces
3. Backend/proxy/frontend error handling is consistent enough that failures do not look random
4. Code ownership is clearer in the touched areas
5. Major dead code and duplicate surface confusion are removed
6. The next round of work is easier, not harder
