---
surface: 01-dashboard-core
discovered_at: 02fcaa4c3951b2c215b9fca7c5aad04f703f5ff9
dimensions_in_scope: [A, B, C, D, E, F, G, H, I-light]
session_started: 2026-05-01
session_closed: open
---

# Dashboard core — Findings

> Surface: authenticated, high-traffic. Routes audited: `/console`, `/decide` (incl. `/decide/[id]`), `/escalations`, `/conversations`. Tier: Deep. Calibration anchor for subsequent surfaces.

## Coverage

Checked: A — pending session
Checked: B — pending session
Checked: C — pending session
Checked: D — pending session
Checked: E — pending session
Checked: F — pending session
Checked: G — pending session
Checked: H — see findings below
Checked: I-light — see findings below (human two-tenant repro pending closeout)

## Calibration precedents (this surface)

_Populated during the calibration ritual at session closeout._

---

<!-- Findings appended below using the §6 template. Each finding starts with `## DC-NN`. -->

## DC-01

- **Surface:** /console
- **Sub-surface:** Nova panel (Zone 3 expanded)
- **Dimension:** H, C
- **Severity:** Launch-blocker
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 02fcaa4c3951b2c215b9fca7c5aad04f703f5ff9
- **Effort:** L

**What:**
The Nova "Ad actions" panel always renders the demo fixture rows ("Cleaning · retarget · 30d $596 · 2.4% CTR", "Whitening · Ad Set B $180 · 0.4% CTR · Recommended: Pause", etc.) regardless of the live data, because `mapConsoleData` short-circuits `novaPanel` to `consoleFixture.novaPanel`. To a paying operator this presents fabricated ad-set spend, CTR, sparklines, and "recommended pause" actions as if they came from their own ad accounts.

**Evidence:**
- File: apps/dashboard/src/components/console/console-mappers.ts:262
- Repro:
  1. Sign in as any tenant whose org config + dashboard overview load successfully (i.e. live data path runs, not the fixture fallback at use-console-data.ts:56).
  2. Navigate to `/console`.
  3. Scroll to the "Nova · Ad actions" panel under Zone 3.
  4. Observe the ad-set table renders the hardcoded demo rows from `consoleFixture.novaPanel` (cleaning/whitening/implants ad sets), the `$842` spend total, `0.87` confidence, and the "Drafting pause on Whitening · Ad Set B" cross-link to `#queue-pause-pending` — none of which are derived from the tenant's data.

**Fix:**
Either gate the Nova panel behind an explicit "no data yet" empty state until Option C wires real ad-set aggregation, or hide the panel for tenants without a live ad-optimizer deployment. Do not ship hardcoded fixture rows as live operator metrics.

---

## DC-02

- **Surface:** /console
- **Sub-surface:** Agent strip (Zone 3)
- **Dimension:** H, C
- **Severity:** High
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 02fcaa4c3951b2c215b9fca7c5aad04f703f5ff9
- **Effort:** S

**What:**
Every entry in the agent strip ("Alex", "Nova", "Mira") renders the literal string `pending option C` as its primary stat and `—` as its sub-stat. The text is rendered in the same body-weight style as a real metric (no muted/placeholder treatment in `console.css` for `.a-stat`), so internal jargon ("option C") leaks directly into the operator's primary at-a-glance view of agent activity.

**Evidence:**
- File: apps/dashboard/src/components/console/console-mappers.ts:180
- File: apps/dashboard/src/components/console/console.css:593

**Fix:**
Replace the literal with a user-facing copy choice (e.g. blank, em-dash, or "—" with the same muted treatment used by the placeholder numbers cells), or hide the stat row entirely until per-agent today-stats are wired.

---

## DC-03

- **Surface:** /console
- **Sub-surface:** Numbers strip (Zone 1.5)
- **Dimension:** H
- **Severity:** Medium
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 02fcaa4c3951b2c215b9fca7c5aad04f703f5ff9
- **Effort:** M

**What:**
Three of the five at-a-glance numbers cells — "Revenue today", "Spend today", "Reply time" — render as `—` with the secondary label `pending option C`. This is the known Option C deferral (revenueToday / spendToday / replyTime not served by `DashboardOverviewSchema`), and the cells are styled with the muted `.placeholder` class so the intent reads as "not yet available." The literal sub-line text "pending option C" still leaks internal jargon to the operator.

**Evidence:**
- File: apps/dashboard/src/components/console/console-mappers.ts:48-86
- File: packages/schemas/src/dashboard.ts:11-20

**Fix:**
Either (a) extend `DashboardOverviewSchema` with the three fields per the Option C plan, or (b) keep the placeholder cells but replace `pending option C` with neutral copy ("not tracked yet", blank, etc.) until the schema lands.

---

## DC-04

- **Surface:** /console
- **Sub-surface:** global (error + loading fallback)
- **Dimension:** H, C
- **Severity:** Medium
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 02fcaa4c3951b2c215b9fca7c5aad04f703f5ff9
- **Effort:** S

**What:**
On any hook error or while data is loading, `useConsoleData` returns the entire `consoleFixture` (Aurora Dental demo data: $1,240 revenue, "Sarah" booking, "Whitening · Ad Set B", etc.). The accompanying error banner reads "Couldn't load live data. **Showing the last known shape.**" — but the user is seeing a hardcoded demo, not a previously-cached snapshot, so the copy misrepresents the source of the displayed values.

**Evidence:**
- File: apps/dashboard/src/components/console/use-console-data.ts:56-58
- File: apps/dashboard/src/app/(auth)/console/page.tsx:18-22
- File: apps/dashboard/src/components/console/console-data.ts:155-392

**Fix:**
Either render a real skeleton/empty state when there is no live data (do not render demo fixture as a fallback), or if the fixture stays as a fallback, change the banner copy to make clear the values shown are illustrative and not the tenant's data.

---

## DC-05

- **Surface:** /escalations
- **Sub-surface:** EscalationCard expanded body
- **Dimension:** H
- **Severity:** High
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 02fcaa4c3951b2c215b9fca7c5aad04f703f5ff9
- **Effort:** S

**What:**
The expanded escalation card reads `escalation.leadName` and `escalation.leadChannel` as flat top-level fields, but the API (`GET /api/escalations`) returns lead context nested inside `leadSnapshot: { name, channel, ... }`. Both flat fields are therefore always `undefined`, so the `Lead: … · Channel: …` block never renders even when the data is present in the response.

**Evidence:**
- File: apps/dashboard/src/components/escalations/escalation-list.tsx:31-32
- File: apps/dashboard/src/components/escalations/escalation-list.tsx:172-176
- File: apps/api/src/routes/escalations.ts:51-66

**Fix:**
Read `escalation.leadSnapshot?.name` and `escalation.leadSnapshot?.channel` (mirroring how `console-mappers.ts:108-109` already handles the same shape), or normalize the API response into the flat fields the component expects.

---

## DC-06

- **Surface:** /console
- **Sub-surface:** Approval gate queue card
- **Dimension:** H
- **Severity:** Medium
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 02fcaa4c3951b2c215b9fca7c5aad04f703f5ff9
- **Effort:** S

**What:**
`mapApprovalGateCard` hardcodes `stageProgress: "—"` and `countdown: "—"` for every approval-gate card in the queue. The view template renders these as load-bearing slots ("Stage 2 of 5 · 3 hook variants ready · gate closes in 21h" in the design), so the live UI shows two em-dashes flanking the stage detail with no signal that progress/countdown data is pending. The schema (`PendingApproval`) does serve `expiresAt`, which is enough to compute a real countdown today.

**Evidence:**
- File: apps/dashboard/src/components/console/console-mappers.ts:142-145
- File: apps/dashboard/src/components/console/console-view.tsx:120-127
- File: apps/dashboard/src/hooks/use-approvals.ts:6-15

**Fix:**
Either compute `countdown` from `approval.expiresAt` (which is already in the response) and drop `stageProgress` until creative-pipeline stage data is available, or treat both as Option C placeholders with the same muted styling used in the numbers strip.

---

## DC-07

- **Surface:** /console
- **Sub-surface:** Activity trail (Zone 4)
- **Dimension:** H
- **Severity:** Medium
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 02fcaa4c3951b2c215b9fca7c5aad04f703f5ff9
- **Effort:** S

**What:**
Activity rows are rendered from a slug derived from `eventType` only (`e.action.replace(/^[^.]+\./, "").replace(/[._]/g, " ")` → e.g. `"approved"`, `"executed"`). The `AuditEntry` schema serves a populated `summary` string (`packages/schemas/src/audit.ts:84`) that the API already returns — but the console mapper drops it on the floor. Operators see one-word activity rows ("approved", "rejected") instead of the human-readable summary the backend already produces.

**Evidence:**
- File: apps/dashboard/src/components/console/console-mappers.ts:228-233
- File: packages/schemas/src/audit.ts:84
- File: apps/dashboard/src/hooks/use-audit.ts:6-18

**Fix:**
Use `e.summary` as the activity message (falling back to the eventType slug only when summary is empty), and surface it through the `AuditEntry` mapper in `use-console-data.ts:64-78`.

---

## DC-08

- **Surface:** /decide
- **Sub-surface:** History tab
- **Dimension:** H
- **Severity:** Medium
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 02fcaa4c3951b2c215b9fca7c5aad04f703f5ff9
- **Effort:** S

**What:**
The History tab filters audit entries to `["action.approved", "action.rejected", "action.expired"]`. The `AuditEventType` schema also serves approval-lifecycle events `action.denied`, `action.cancelled`, and `action.approval_expired`, which are silently dropped from the operator-facing approval history.

**Evidence:**
- File: apps/dashboard/src/app/(auth)/decide/page.tsx:22
- File: packages/schemas/src/audit.ts:17-63

**Fix:**
Expand `APPROVAL_EVENT_TYPES` to cover the full approval lifecycle (or document the reason for the filter and rename the constant), so the History tab matches the events Switchboard actually records against approvals.

---

## DC-09

- **Surface:** /console
- **Sub-surface:** Queue (escalation cards)
- **Dimension:** H
- **Severity:** Low
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 02fcaa4c3951b2c215b9fca7c5aad04f703f5ff9
- **Effort:** S

**What:**
Every escalation card in the console queue is labelled `agent: "alex"` regardless of which agent actually triggered the handoff. Approval gates are similarly hardcoded to `mira`. There is no field on the API response that determines agent attribution today, so the mapper guesses; the guess is wrong for any handoff that did not originate with Alex/Mira.

**Evidence:**
- File: apps/dashboard/src/components/console/console-mappers.ts:115
- File: apps/dashboard/src/components/console/console-mappers.ts:135

**Fix:**
Either add an agent-attribution field to the escalation/approval API response (Option C territory) or remove the agent badge from the card chrome until the data exists.

---

## DC-10

- **Surface:** /console, /escalations, /conversations
- **Sub-surface:** global (route guard)
- **Dimension:** I
- **Severity:** High
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 957356d44f1c28c642cc525261d00d834ba6b54e
- **Effort:** S

**What:**
The dashboard middleware (`apps/dashboard/src/middleware.ts`) enumerates protected route prefixes in `AUTH_PAGE_PREFIXES` and `matcher`, but **`/console`, `/escalations`, and `/conversations` are absent from both lists.** Three of the four surface routes audited here therefore have no edge-level redirect-to-login when the session cookie is missing. The `(auth)/layout.tsx` does call `getServerSession()` but never branches on a null result — it just hands the session (which may be `null`) to `AuthProvider`, so the layout does not enforce auth either. The only protection on `/console` and `/decide` is a *client-side* `useSession() === "unauthenticated"` redirect inside the page component, which fires after first render. `/escalations` is a server component with no session check at all; `/conversations` is a client component with no session check. Net effect: an unauthenticated visitor to `/escalations` or `/conversations` gets the page shell rendered, the data hooks fire and 401 from the dashboard API (which does enforce auth in `requireSession`), and the user sees a "Failed to fetch" empty state instead of a sign-in redirect. This is not a data leak (the API blocks), but it is a missing frontend trust boundary on three of the four audited routes — and it relies on the API as the sole guard for any future endpoint that forgets to call `requireSession()`.

**Evidence:**
- File: apps/dashboard/src/middleware.ts:13-25 (AUTH_PAGE_PREFIXES omits console/escalations/conversations)
- File: apps/dashboard/src/middleware.ts:111-127 (matcher omits the same routes)
- File: apps/dashboard/src/app/(auth)/layout.tsx:9-19 (no redirect on null session)
- File: apps/dashboard/src/app/(auth)/escalations/page.tsx:1-11 (server component, no session check)
- File: apps/dashboard/src/app/(auth)/conversations/page.tsx:158-210 (client component, no useSession redirect)
- Repro:
  1. In a clean browser (no `authjs.session-token` cookie), navigate directly to `https://<dashboard>/escalations`.
  2. Confirm the page renders the "Escalations" heading and the empty list (no redirect to `/login`).
  3. Repeat for `/conversations` — same result.
  4. Repeat for `/console` — note the brief render before the client-side redirect kicks in (the page paints once before `redirect("/login")` fires).

**Fix:**
Add `/console`, `/escalations`, `/conversations` to both `AUTH_PAGE_PREFIXES` and `matcher` in `middleware.ts` so they get the same edge-level cookie check the other authenticated routes already have. Optionally also have `(auth)/layout.tsx` redirect to `/login` when `getServerSession()` returns `null` as defense-in-depth, so future routes added under `(auth)/` are protected by default.

---

## DC-11

- **Surface:** /console, /decide, /decide/[id], /escalations, /conversations
- **Sub-surface:** global (React Query cache scoping)
- **Dimension:** I
- **Severity:** High
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 957356d44f1c28c642cc525261d00d834ba6b54e
- **Effort:** M

**What:**
Every query key in `apps/dashboard/src/lib/query-keys.ts` is **statically scoped to the resource only — no tenant, no organization, no session identifier appears anywhere in the keys.** Examples that the audited surfaces depend on directly:
- `dashboard.overview()` → `["dashboard", "overview"]`
- `approvals.pending()` → `["approvals", "pending"]`
- `approvals.detail(id)` → `["approvals", "detail", id]` (tenant-agnostic)
- `escalations.all` → `["escalations"]`
- `conversations.list({status})` → `["conversations", "list", filters]`
- `conversations.detail(id)` → `["conversations", "detail", id]` (tenant-agnostic)
- `audit.list(...)` → `["audit", "list", filters]`
- `agents.roster()` / `agents.state()` → `["agents", "roster"]` / `["agents", "state"]`
- `orgConfig.current()` → `["orgConfig", "current"]`

The shared `QueryClient` is constructed once per `QueryProvider` mount via `useState(() => new QueryClient())` (`apps/dashboard/src/providers/query-provider.tsx:7-24`) with `staleTime: 2 * 60 * 1000` and `gcTime: 10 * 60 * 1000`, and **the provider has no `useEffect` that resets the cache on session change.** As long as the same `QueryClient` instance lives, any tenant's data fetched under these keys is reused across sessions until staleTime expires.

In practice the cache is destroyed today by two facts: (1) `signOut({ callbackUrl: "/login" })` and (2) successful credentials sign-in (`window.location.href = callbackUrl` on login page) both perform full-page navigations that throw away the React tree and the QueryClient with it. So the *currently-shipping* sign-out → sign-in flow does not leak. **But** the missing tenant scoping means any future change that:
- replaces `window.location.href` with `router.push` on login,
- introduces a tenant-switcher UI,
- or relies on a soft signOut (`redirect: false`),
will silently turn into a cross-tenant leak. There is also a real today-risk via the browser **back button** after sign-out: bfcache-restored pages may resurrect the prior QueryClient state and render Tenant A's data after the user signed out (browser-dependent; Safari is the typical failure mode).

This finding is **High** rather than Launch-blocker because the leak path requires a browser-confirmed repro per spec §9 row I-light. The Repro block below is what the human runs at closeout.

**Evidence:**
- File: apps/dashboard/src/lib/query-keys.ts:1-133 (no key includes a tenant/session segment)
- File: apps/dashboard/src/providers/query-provider.tsx:6-24 (QueryClient created once; no session-change effect)
- File: apps/dashboard/src/app/(auth)/me/page.tsx:86 (signOut does not call queryClient.clear())
- File: apps/dashboard/src/app/login/page.tsx:48 (credentials path uses window.location, full nav — saves us today)
- Repro (human, two-tenant browser confirmation per spec §9 row I-light):
  1. Sign in as Tenant A in a single browser. Visit `/console`, `/escalations`, `/conversations`. Wait for data to load on each. Confirm Tenant A's data is rendered.
  2. Without closing the tab or hard-refreshing, click Sign out from `/me`. You should land on `/login`.
  3. Click the browser **Back button**. If the page returns rendering Tenant A's data (revenue counts, escalation summaries, conversation transcripts) instead of the `/login` form, the cache is leaking via bfcache → Launch-blocker. If the page either reloads to `/login` or shows a "Failed to fetch" 401 state, the cache was destroyed cleanly → downgrade to Medium.
  4. Sign in as Tenant B in the same browser. After the post-login navigation completes, visit `/console`. If you ever see Tenant A values flash in any zone (numbers strip, queue, approvals card, activity trail) before Tenant B's values populate, the cache is leaking → Launch-blocker. If only Tenant B values ever render, the full-page nav cleared the cache → no leak today.
  5. Repeat with two tabs of the same browser: Tab 1 signed in as Tenant A on `/console`, Tab 2 signs out and signs in as Tenant B. Switch back to Tab 1 without refreshing. If Tab 1's `/console` continues to render Tenant A data after Tab 2's session change, that's a stale-display issue; if Tab 1 then refetches and gets Tenant B's data under the same Tenant-A-rendered chrome, that's a confirmed cross-tenant leak → Launch-blocker.

**Fix:**
Two complementary changes. (1) Make every tenant-scoped query key carry a session-derived tenant prefix — e.g. read `session.organizationId` from `useSession()` and prepend it: `["dashboard", "overview", organizationId]`. Centralize this so individual hooks can't forget. (2) In `QueryProvider`, subscribe to `useSession()` and call `queryClient.clear()` (or invalidate by predicate) whenever `session?.user?.id` changes from a non-null value to a different non-null value or to null. This makes sign-out / re-auth defensive even if a future change replaces the full-page nav with a soft route push. Together these turn cache-scoping from "relies on full-page nav" to "scoped by construction."

---

## DC-12

- **Surface:** /console
- **Sub-surface:** global (loading-state render before redirect)
- **Dimension:** I, D
- **Severity:** Low
- **Affects:** unauthenticated visitors with stale session UI
- **Status:** Open
- **Discovered-at:** 957356d44f1c28c642cc525261d00d834ba6b54e
- **Effort:** S

**What:**
On `/console`, the page calls `useConsoleData()` *before* checking `useSession().status`. While `status === "loading"`, `useConsoleData` returns the hardcoded `consoleFixture` (per DC-04). Combined with the absence of `/console` in the middleware matcher (DC-10), an unauthenticated visitor briefly sees the Aurora Dental fixture content paint before the client-side `redirect("/login")` fires once `status` resolves to `"unauthenticated"`. This is not a tenant-data leak (the fixture is static demo data), but it is an "auth boundary leaks UX state" issue: the page should be treated as gated, not as something that paints first and gates after.

**Evidence:**
- File: apps/dashboard/src/app/(auth)/console/page.tsx:8-26 (data fetched before status check; redirect is post-render)
- File: apps/dashboard/src/components/console/use-console-data.ts:56-58 (returns fixture during loading)

**Fix:**
Either gate render on `status === "authenticated"` (return a skeleton/null while `loading`, and never render the fixture for unauthenticated users), or — preferred — fix DC-10 so middleware redirects unauthenticated visitors before the page mounts at all. The middleware fix subsumes this one.

---

## DC-13

- **Surface:** global (sign-out flow)
- **Sub-surface:** /me
- **Dimension:** I
- **Severity:** Medium
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 957356d44f1c28c642cc525261d00d834ba6b54e
- **Effort:** S

**What:**
The single sign-out call site (`signOut({ callbackUrl: "/login" })` at `apps/dashboard/src/app/(auth)/me/page.tsx:86`) does not explicitly clear the React Query cache. Today this is masked by NextAuth's default `signOut` behavior performing a full-page navigation to the callback URL, which destroys the in-memory QueryClient. But the protection is incidental — any future regression that passes `redirect: false`, calls `signOut` programmatically, or replaces the full-page nav with a soft `router.push` will leave the QueryClient holding the prior tenant's data (DC-11). Defensive sign-out should always invalidate the cache explicitly and not rely on a hard navigation as the cache-clear mechanism.

**Evidence:**
- File: apps/dashboard/src/app/(auth)/me/page.tsx:86
- File: apps/dashboard/src/providers/query-provider.tsx:6-24 (no session-change-driven reset)

**Fix:**
Wrap sign-out in a small handler that calls `queryClient.clear()` immediately before `signOut(...)`. Equivalent to: `const queryClient = useQueryClient(); const handleSignOut = () => { queryClient.clear(); signOut({ callbackUrl: "/login" }); };`. Pair with DC-11 fix #2 (session-change-driven cache reset in `QueryProvider`) so the protection holds even if a different sign-out path is added later.
