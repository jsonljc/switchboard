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

Checked: A — see findings below
Checked: B — see findings below
Checked: C — see findings below
Checked: D — pending session
Checked: E — pending session
Checked: F — see findings below (static a11y code-read; human axe + keyboard + VO at closeout)
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

---

## DC-14

- **Surface:** /console
- **Sub-surface:** global (entire route's design system)
- **Dimension:** A
- **Severity:** High
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 034813abf90358541353cf0e5fb76b7dc2c40502
- **Effort:** L

**What:**
The `/console` route ships a complete, parallel design system that has no overlap with the rest of the dashboard. `console.css` defines its own background (`hsl(28 30% 92%)` warm clay vs. the app's `hsl(45 25% 98%)` warm white), its own accent (coral `hsl(14 75% 55%)` vs. operator amber `hsl(30 55% 46%)`), its own type stack (General Sans + JetBrains Mono pulled from a third-party CDN vs. Inter + Cormorant Garamond), and its own tokens (`--c-bg`, `--c-coral`, `--c-text-2`, etc.) that do not reference any of `globals.css`'s `--background`, `--operator`, `--font-sans`, etc. The page is also placed in `CHROME_HIDDEN_PATHS` (`app-shell.tsx:14`) so the global owner-tabs nav is suppressed only for `/console`. Net effect: `/console` looks and feels like a different product than `/decide`, `/escalations`, `/conversations`, and `/dashboard`. For the highest-traffic surface this is a sustained brand-incoherence cost, not a one-off polish miss.

**Evidence:**
- File: apps/dashboard/src/components/console/console.css:9-23 (parallel token scope under `[data-v6-console]`)
- File: apps/dashboard/src/components/console/console.css:7 (external font @import bypassing the app's font system)
- File: apps/dashboard/src/app/globals.css:14-75 (the design system the rest of the dashboard uses)
- File: apps/dashboard/src/components/layout/app-shell.tsx:14 (`/console` listed in `CHROME_HIDDEN_PATHS` so global nav doesn't render)
- Repro: open `/console` and `/decide` side-by-side at 1440px. Compare background tone, primary type, accent color, button styling, and chrome.

**Fix:**
Decide whether `/console` is meant to be its own product surface or part of Switchboard. If part: rebuild console.css against the global tokens (`--background`, `--operator`, `--font-sans`, `--border`) and drop the parallel `--c-*` palette, fold the warm-clay surface into `--surface` if needed, and remove the external Fontshare import in favor of the existing Inter / display-font stack. If standalone: make that an explicit product decision, document it in the design system, and align typography weight/size scale at minimum so it does not read as accidental drift.

---

## DC-15

- **Surface:** /console
- **Sub-surface:** global (font loading)
- **Dimension:** A
- **Severity:** Medium
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 034813abf90358541353cf0e5fb76b7dc2c40502
- **Effort:** S

**What:**
`console.css:7` imports two font families ("General Sans" and "JetBrains Mono") via `@import url("https://api.fontshare.com/v2/css?...")` from a third-party CDN that is not the host the rest of the app uses. Until that stylesheet resolves the page renders in the system fallback stack (`ui-sans-serif, system-ui, -apple-system, sans-serif`), so first paint shows generic UI fonts and then re-flows when the custom faces arrive. This is a flash-of-fallback-text moment on the highest-traffic operator surface, and it is also a third-party font dependency the rest of the app does not have.

**Evidence:**
- File: apps/dashboard/src/components/console/console.css:7 (`@import url("https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600,700&f[]=jetbrains-mono@400,500,600&display=swap");`)
- File: apps/dashboard/src/components/console/console.css:22-23 (font-family stack falls back to system fonts before Fontshare resolves)
- Repro: open `/console` on a fresh load with throttled network in devtools and watch the operating strip / numbers strip re-flow as the Fontshare fonts swap in.

**Fix:**
Either drop the custom font stack and use the app's existing Inter / display font (preferred — folds into DC-14), or self-host the General Sans / JetBrains Mono faces via `next/font` so they ship with the app bundle, render with `font-display: swap` on the same origin, and don't add a third-party hop on every page load.

---

## DC-16

- **Surface:** /escalations, /conversations, global (operator chat widget)
- **Sub-surface:** status pills, banners, action buttons
- **Dimension:** A
- **Severity:** Medium
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 034813abf90358541353cf0e5fb76b7dc2c40502
- **Effort:** S

**What:**
Multiple components on the audited surfaces use raw Tailwind named colors (`bg-blue-50`, `border-blue-200`, `text-blue-800`, `bg-green-100`, `text-green-800`, `bg-amber-100`, `text-amber-800`, `bg-amber-500`, `text-red-600`, `bg-blue-600`, `bg-gray-100`, `text-gray-800`) instead of the design tokens defined in `globals.css` (`positive`, `positive-subtle`, `caution`, `caution-subtle`, `destructive`, `operator`, `muted`). The "Active / You control / Awaiting approval" status pills on `/conversations`, the post-reply info banner and SLA indicators on `/escalations`, the badge on the bottom nav, and the operator chat widget toggle button are all bypassing the warm-neutral / Claude-inspired palette and pulling stock Tailwind blue / green / amber / red. The result is a visibly louder, more web-app-generic palette than the rest of the dashboard.

**Evidence:**
- File: apps/dashboard/src/components/escalations/escalation-list.tsx:49 (`text-red-600` on Overdue chip)
- File: apps/dashboard/src/components/escalations/escalation-list.tsx:58 (`text-amber-600` on countdown chip)
- File: apps/dashboard/src/components/escalations/escalation-list.tsx:210 (`border-blue-200 bg-blue-50 text-blue-800` reply-confirmation banner)
- File: apps/dashboard/src/app/(auth)/conversations/page.tsx:21,28,35,41 (status pill colors via `bg-{color}-100` + `text-{color}-800`)
- File: apps/dashboard/src/app/(auth)/conversations/page.tsx:125-132 (`bg-blue-50`, `border-blue-200`, `bg-white`, `text-blue-700`, `border-blue-300` on the human-override panel)
- File: apps/dashboard/src/components/layout/owner-tabs.tsx:46 (`bg-amber-500 text-white` on the escalation count badge)
- File: apps/dashboard/src/components/operator-chat/operator-chat-widget.tsx:41 (`bg-blue-600 text-white hover:bg-blue-700` on the floating chat toggle)

**Fix:**
Replace the raw color names with semantic tokens: SLA / overdue → `text-destructive` or `text-caution`; "Active" / success → `bg-positive-subtle text-positive`; "You control" / informational → use a neutral `bg-surface-raised text-foreground` or introduce a token for it; "Awaiting approval" → `bg-caution-subtle text-caution`; nav badge → `bg-operator text-operator-foreground`; operator chat toggle → match the rest of the dashboard's primary surface (foreground/background or `bg-operator`).

---

## DC-17

- **Surface:** /escalations
- **Sub-surface:** page wrapper
- **Dimension:** A
- **Severity:** Medium
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 034813abf90358541353cf0e5fb76b7dc2c40502
- **Effort:** S

**What:**
`/escalations` (and `/conversations` — see DC-18) wraps its content in `max-w-2xl mx-auto py-6 px-4` instead of using the design-system containers (`page-width`, `content-width`). The ambient `OwnerShell` already wraps non-dashboard pages in `content-width py-6` (42rem max + auto margins + horizontal padding) — so the page nests an inner `max-w-2xl` (32rem) inside the outer `content-width` (42rem), producing double horizontal padding and a constrained 32rem column. Heading style is also `text-xl font-semibold` rather than the editorial display treatment used on `/decide` (`text-[22px] font-semibold tracking-tight`), so the same surface uses two different page-title typographic conventions.

**Evidence:**
- File: apps/dashboard/src/app/(auth)/escalations/page.tsx:4-9 (`<div className="max-w-2xl mx-auto py-6 px-4">` + `<h1 className="text-xl font-semibold mb-4">`)
- File: apps/dashboard/src/components/layout/owner-shell.tsx:14-16 (outer wrapper already applies `content-width py-6`)
- File: apps/dashboard/src/app/(auth)/decide/page.tsx:228-232 (sibling page uses `text-[22px] font-semibold tracking-tight` + a subtitle)
- Repro: open `/escalations` and `/decide` at 1440px. The `/escalations` content column is visibly narrower with a smaller, less editorial title; the `/decide` title carries a subtitle while `/escalations` does not.

**Fix:**
Drop the inner `max-w-2xl mx-auto py-6 px-4` wrapper — the shell already constrains width — and align the page title with the other authenticated pages: a `text-[22px] font-semibold tracking-tight` heading plus a subtitle line in `text-muted-foreground`.

---

## DC-18

- **Surface:** /conversations
- **Sub-surface:** page wrapper + heading
- **Dimension:** A
- **Severity:** Medium
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 034813abf90358541353cf0e5fb76b7dc2c40502
- **Effort:** S

**What:**
`/conversations` mirrors DC-17: the page wraps itself in `max-w-2xl mx-auto py-6 px-4 pb-24` and uses `text-xl font-semibold` for the H1 paired with a Lucide `MessageSquare` icon. This double-wraps the `content-width` shell (extra horizontal padding + a narrower column), and the icon-prefixed title contradicts the rest of the dashboard's editorial, text-only heading style. Filter pills below use `border-b-2` underline styling that visually competes with the bottom-tab nav.

**Evidence:**
- File: apps/dashboard/src/app/(auth)/conversations/page.tsx:169 (`<div className="max-w-2xl mx-auto py-6 px-4 pb-24">`)
- File: apps/dashboard/src/app/(auth)/conversations/page.tsx:170-173 (`<MessageSquare className="h-6 w-6" /> <h1 className="text-xl font-semibold">Conversations</h1>`)
- File: apps/dashboard/src/components/layout/owner-shell.tsx:14-16 (shell already applies `content-width py-6`)

**Fix:**
Same direction as DC-17: drop the inner `max-w-2xl … pb-24` wrapper, drop the icon, and use the same heading + subtitle pattern (`text-[22px] font-semibold tracking-tight` + a one-line subtitle) used by `/decide`. Keep the bottom padding only as needed to clear the fixed bottom-tab nav.

---

## DC-19

- **Surface:** /decide vs /decide/[id]
- **Sub-surface:** page chrome (heading, card containers)
- **Dimension:** A
- **Severity:** Medium
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 034813abf90358541353cf0e5fb76b7dc2c40502
- **Effort:** S

**What:**
The two pages of the Decide surface use visibly different design vocabularies. `/decide` (`page.tsx:230`) renders the heading as `text-[22px] font-semibold tracking-tight` with a muted subtitle, approval cards as `rounded-xl border border-border bg-surface p-6`, and bespoke buttons styled with `bg-positive` / muted ghost. `/decide/[id]` (`[id]/page.tsx:129`) renders the heading as `text-2xl font-bold`, wraps the body in shadcn `Card` / `CardHeader` / `CardContent` chrome with `Badge` components, and uses default `Button` primary / outline pairs for approve/reject. The detail page reads as a different visual style (heavier weight title, generic shadcn card) than the index page that links to it.

**Evidence:**
- File: apps/dashboard/src/app/(auth)/decide/page.tsx:230-232 (`text-[22px] font-semibold tracking-tight` + subtitle)
- File: apps/dashboard/src/app/(auth)/decide/page.tsx:41-62 (custom approval card chrome: `rounded-xl border border-border bg-surface p-6` + bespoke buttons)
- File: apps/dashboard/src/app/(auth)/decide/[id]/page.tsx:129 (`text-2xl font-bold` heading)
- File: apps/dashboard/src/app/(auth)/decide/[id]/page.tsx:132-227 (shadcn `<Card>` / `<CardHeader>` / `<CardContent>` + `<Badge>` + `<Button>` pairs)

**Fix:**
Pick one. Most of the rest of the dashboard tracks the editorial, low-chrome treatment used on `/decide` index — port `[id]/page.tsx` to that style: same heading scale and weight, same approval-card chrome, same approve/reject button pair. If the shadcn `Card` chrome stays, use it on the index page too so both pages match.

---

## DC-20

- **Surface:** /console
- **Sub-surface:** global (stylesheet size)
- **Dimension:** A
- **Severity:** Low
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 034813abf90358541353cf0e5fb76b7dc2c40502
- **Effort:** M

**What:**
`apps/dashboard/src/components/console/console.css` is 968 lines, which crosses both the 400-line warn and 600-line error thresholds in `CLAUDE.md`'s "Code Basics" section. The file holds tokens, layout, every zone's styles, every queue-card variant, the table, and the activity scroller in one scope. Files this large hide visual sprawl — multiple unrelated rule blocks share one cascade and minor edits in one zone routinely break another. The companion `console-view.tsx` is also 342 lines, which is fine on its own but compounds the "single-place-for-everything" pattern.

**Evidence:**
- File: apps/dashboard/src/components/console/console.css (968 lines; CLAUDE.md threshold: 400 warn / 600 error)
- File: apps/dashboard/src/components/console/console-view.tsx (342 lines)

**Fix:**
Split `console.css` along the zones already labeled in the file (op-strip, numbers, queue + card variants, agent strip + Nova panel, activity, error banner). Either co-locate per-zone CSS files or, better, fold the tokens into the global system (DC-14) so each zone's local CSS shrinks. Goal is per-file under the 400-line warn line.

---

## DC-21

- **Surface:** /escalations (also visible globally in bottom-tab nav)
- **Sub-surface:** SLA indicator + escalation count badge
- **Dimension:** A
- **Severity:** Low
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 034813abf90358541353cf0e5fb76b7dc2c40502
- **Effort:** S

**What:**
The "Overdue" / "h left" SLA chips on `/escalations` and the unread-count badge on the bottom-tab nav don't carry the dashboard's iconographic vocabulary. The chips pair `text-red-600` and `text-amber-600` with a tiny `Clock` icon — louder than the rest of the dashboard's quiet treatment of state — and the nav badge is a saturated `bg-amber-500` circle that does not match the warmer operator amber elsewhere. Each is small in isolation, but they're the only reds and the only saturated yellows on otherwise-warm-neutral surfaces, so they catch the eye disproportionately.

**Evidence:**
- File: apps/dashboard/src/components/escalations/escalation-list.tsx:42-63 (`SlaIndicator` uses `text-red-600` / `text-amber-600` with a Lucide `Clock`)
- File: apps/dashboard/src/components/layout/owner-tabs.tsx:45-48 (escalation count badge uses `bg-amber-500 text-white`)

**Fix:**
Move the chips to design tokens — `text-destructive` for overdue, `text-caution` for time-remaining — and either drop the icon or use the same muted chrome used elsewhere on the surface. Move the nav badge to the `--operator` token so the saturation matches the rest of the operator-amber accents.

---

## DC-22

- **Surface:** /decide, /escalations, /conversations (anywhere the OwnerShell is mounted)
- **Sub-surface:** floating operator chat widget
- **Dimension:** A
- **Severity:** Medium
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 034813abf90358541353cf0e5fb76b7dc2c40502
- **Effort:** S

**What:**
The operator chat widget is a permanent floating button at `fixed bottom-4 right-4 z-50` styled `rounded-full bg-blue-600 p-3 text-white shadow-lg hover:bg-blue-700` — the only blue surface in the dashboard. It's hidden only on `/console`, so on every other page in scope it overlays content and sits directly above the 64px-tall fixed bottom-tab nav (`owner-tabs.tsx:29` — `h-16`). The button's stock-blue color, "Close" / "Chat" text label (instead of an icon), and stacking position next to the nav read as a third-party widget bolted onto the surface rather than a native control.

**Evidence:**
- File: apps/dashboard/src/components/operator-chat/operator-chat-widget.tsx:8 (`HIDDEN_PATHS = ["/console"]` — visible on every other authenticated page)
- File: apps/dashboard/src/components/operator-chat/operator-chat-widget.tsx:39-45 (`fixed bottom-4 right-4 z-50 rounded-full bg-blue-600 p-3 text-white shadow-lg hover:bg-blue-700`)
- File: apps/dashboard/src/components/layout/owner-tabs.tsx:29 (`fixed bottom-0 … h-16` — the nav this button stacks on top of)
- Repro: open `/decide` at 375px width and at 1440px. Note that the floating chat button visually competes with the bottom-tab nav and on narrow viewports overlaps the rightmost tab's hit area.

**Fix:**
Re-style the toggle to use design tokens (e.g. `bg-foreground text-background` or `bg-operator text-operator-foreground`) and pick one form factor — either a small icon button or a labeled pill, not both. Lift the bottom offset above the 64px nav (`bottom-20` minimum on small viewports) so it never overlaps tab hit areas. Consider whether this widget should be visible on every authenticated page or limited to a subset (settings / dashboard) by default.

---

## DC-23

- **Surface:** /escalations
- **Sub-surface:** EscalationCard post-reply info banner
- **Dimension:** C, H
- **Severity:** Launch-blocker
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** d8a38023cb209d7c9d5e244c7675db8b15fb21ec
- **Effort:** S

**What:**
After a successful escalation reply, the card renders a blue info banner that reads: *"Your reply has been saved. It will be included in the conversation when the customer sends their next message. Direct message delivery is coming in a future update."* This is factually false today — the API path only returns 200 OK when proactive channel delivery to Telegram/WhatsApp/Slack succeeds (`apps/api/src/routes/escalations.ts:266-275` returns 502 unless `deliveryResult === "delivered"`). The mutation only fires `setSent(true)` on a 200, so by the time this banner appears the customer has already received the message via their channel. Telling the operator the reply will *only* arrive when the customer next messages — and that direct delivery is "coming in a future update" — risks the operator either re-sending the reply through another channel, or simply not trusting the system to deliver.

**Evidence:**
- File: apps/dashboard/src/components/escalations/escalation-list.tsx:209-217 (banner text + render condition `sent && !isResolved`)
- File: apps/dashboard/src/components/escalations/escalation-list.tsx:102-113 (`setSent(true)` only fires on `onSuccess`)
- File: apps/dashboard/src/hooks/use-escalations.ts:38-50 (mutation throws unless `res.ok`)
- File: apps/api/src/routes/escalations.ts:241-275 (200 path requires `agentNotifier.sendProactive` to succeed)
- Repro:
  1. Sign in as a tenant with at least one channel credential wired (so `agentNotifier` is non-null at API startup — see `apps/api/src/app.ts:320-346`).
  2. Trigger or open a pending escalation with a `sessionId` (i.e. has a real conversation thread). Navigate to `/escalations`, expand the card.
  3. Type any reply and click Send.
  4. On success (200 from `/api/dashboard/escalations/{id}/reply`), the blue info banner appears reading *"Your reply has been saved. It will be included in the conversation when the customer sends their next message. Direct message delivery is coming in a future update."*
  5. Inspect the customer's channel (Telegram/WhatsApp/Slack) — the message has already been delivered. The banner is making a claim that contradicts what the system just did.

**Fix:**
Replace the banner with a confirmation that matches reality: *"Reply sent to {customer} on {channel}."* If channel delivery is degraded (e.g. notifier missing, 502 path), surface that as an explicit error state with retry guidance, not the generic "saved" banner.

---

## DC-24

- **Surface:** /escalations
- **Sub-surface:** EscalationList empty state (filter = "released")
- **Dimension:** C
- **Severity:** Medium
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** d8a38023cb209d7c9d5e244c7675db8b15fb21ec
- **Effort:** S

**What:**
The empty state branches on `filter === "pending"` only. The else-branch covers both the *Released* and *Resolved* tabs and renders the literal string "No resolved escalations yet." When the operator clicks the *Released* filter and finds it empty, the page tells them they have no resolved escalations — wrong noun, different lifecycle stage. The pill they just clicked says *Released*; the empty state should match it.

**Evidence:**
- File: apps/dashboard/src/components/escalations/escalation-list.tsx:339-352 (else-branch fires for both `released` and `resolved`)
- File: apps/dashboard/src/components/escalations/escalation-list.tsx:315-328 (filter values: `pending`, `released`, `resolved`)

**Fix:**
Branch the empty-state copy on the actual filter value: "No pending escalations" / "No released escalations yet" / "No resolved escalations yet."

---

## DC-25

- **Surface:** /decide
- **Sub-surface:** ApprovalCard primary actions
- **Dimension:** C
- **Severity:** High
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** d8a38023cb209d7c9d5e244c7675db8b15fb21ec
- **Effort:** S

**What:**
The negative action on each pending approval reads "Not now," but the click flow is *not* a deferral — it opens the *Confirm Rejection* dialog and on confirm fires `action.rejected`, which is recorded in the audit log and prevents the action from ever executing. "Not now" reads like "I'll review this later" or "snooze," which suggests the approval re-queues. There is no defer/snooze path in the system — the only options are approve and reject. The mismatch risks an operator clicking what they think is a soft "later" and instead permanently rejecting the request. The dialog catches it, but the button label sets the wrong expectation on every approval.

**Evidence:**
- File: apps/dashboard/src/app/(auth)/decide/page.tsx:54-59 (button text "Not now"; onClick = onReject)
- File: apps/dashboard/src/app/(auth)/decide/page.tsx:177-191 (handleReject opens RespondDialog with `action: "reject"`)
- File: apps/dashboard/src/components/approvals/respond-dialog.tsx:41-47 (dialog title "Confirm Rejection"; description: "This will cancel the request.")

**Fix:**
Use a label that matches the action — "Reject" or "Decline" — and reserve "Not now" / "Snooze" for the day a real defer path exists. Pair with DC-26 to land one consistent verb across button, dialog, toast, and history.

---

## DC-26

- **Surface:** /decide, /decide/[id]
- **Sub-surface:** approval reject/decline terminology
- **Dimension:** C
- **Severity:** Medium
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** d8a38023cb209d7c9d5e244c7675db8b15fb21ec
- **Effort:** S

**What:**
The same negative-decision action surfaces under five different nouns/verbs on the same surface: button "Not now" (decide list) / "Reject" (decide detail), dialog title "Confirm Rejection," dialog button "Reject," toast title "Declined" (decide list approvals) / "Rejected" (decide list tasks), History item label "rejected" (audit eventType, derived from `action.rejected`), consequence sentence "Your assistant won't take this action." Operators see the action under a different label at every step of the flow, which makes it harder to mentally bind "the thing I just clicked" to "the row that appears in History."

**Evidence:**
- File: apps/dashboard/src/app/(auth)/decide/page.tsx:58 ("Not now" button)
- File: apps/dashboard/src/app/(auth)/decide/page.tsx:140 (toast title "Declined")
- File: apps/dashboard/src/app/(auth)/decide/page.tsx:211 (toast title "Rejected" for tasks)
- File: apps/dashboard/src/app/(auth)/decide/[id]/page.tsx:215 ("Reject" button)
- File: apps/dashboard/src/components/approvals/respond-dialog.tsx:41,47,68 (dialog title "Confirm Rejection"; description; primary "Reject")

**Fix:**
Pick one verb (recommended: *Decline*, since the dialog explicitly tells the user the action will be cancelled) and use it across button, dialog, toast, and history. Or pick *Reject* and ditch "Not now" / "Declined." Either choice is fine — the inconsistency is the issue.

---

## DC-27

- **Surface:** /decide/[id]
- **Sub-surface:** page heading
- **Dimension:** C
- **Severity:** Medium
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** d8a38023cb209d7c9d5e244c7675db8b15fb21ec
- **Effort:** S

**What:**
The detail page is titled "Decision Detail" — internal-feeling, code-name-shaped phrasing that contradicts the editorial "Decide" + subtitle "Decisions only you can make." voice on the index. Operators navigated here from a card titled by its summary; landing on a generic "Decision Detail" header strips the human voice the rest of /decide carries.

**Evidence:**
- File: apps/dashboard/src/app/(auth)/decide/[id]/page.tsx:129 (`<h1>Decision Detail</h1>`)
- File: apps/dashboard/src/app/(auth)/decide/page.tsx:230-232 ("Decide" + "Decisions only you can make.")

**Fix:**
Drop the heading or replace it with the approval summary itself (already shown as `CardTitle` on line 134, so the page H1 currently echoes nothing). If a heading is needed, something like "Decision" or "Approval" matches the parent voice.

---

## DC-28

- **Surface:** /decide/[id]
- **Sub-surface:** detail page metadata fields
- **Dimension:** C
- **Severity:** Medium
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** d8a38023cb209d7c9d5e244c7675db8b15fb21ec
- **Effort:** S

**What:**
The detail page renders a labeled, copy-pasteable "Binding Hash" field with a monospaced multi-line block, and an "Approvers" list of opaque principal IDs in monospace badges. *Binding hash* is an internal cryptographic primitive used for replay-prevention in the API request body (`packages/core` approval flow) — operators do not act on it, do not need to read it, and have nothing to do with it. *Approvers* shown as raw principal IDs (e.g. `op-abc123`) is similarly internal. Both leak the audit/security plumbing into the operator's primary decision view, which makes the page look engineering-facing rather than owner-facing.

**Evidence:**
- File: apps/dashboard/src/app/(auth)/decide/[id]/page.tsx:182-187 ("Binding Hash" label + monospace block of the raw hash)
- File: apps/dashboard/src/app/(auth)/decide/[id]/page.tsx:189-200 ("Approvers" + Badge per principal ID, monospace)

**Fix:**
Remove "Binding Hash" from the operator view entirely (it's still POSTed in the request body — the operator never needs to see it). Replace "Approvers" with named operator labels if that data is available, or hide the row when the only entries are opaque IDs.

---

## DC-29

- **Surface:** /decide/[id]
- **Sub-surface:** Status badge
- **Dimension:** C
- **Severity:** Medium
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** d8a38023cb209d7c9d5e244c7675db8b15fb21ec
- **Effort:** S

**What:**
The Status badge renders `{state.status}` directly, so the operator sees lowercase enum strings — `pending`, `approved`, `rejected`, `expired` — verbatim. No casing fix, no humanization, no badge variant copy ("Awaiting your call," "Approved," etc.). Reads as a debug field. The Risk Category badge sibling has the same issue (`{request.riskCategory} risk` → `low risk`, `medium risk`, etc.) but at least gets a noun appended; the status badge does not.

**Evidence:**
- File: apps/dashboard/src/app/(auth)/decide/[id]/page.tsx:142-152 (`{state.status}`)
- File: apps/dashboard/src/app/(auth)/decide/[id]/page.tsx:155-159 (`{request.riskCategory} risk`)

**Fix:**
Map the enum to user copy at render time: `pending → "Awaiting your call"`, `approved → "Approved"`, `rejected → "Declined"`, `expired → "Expired"`. Apply the same map on the index page and toast labels (DC-26) so all three render the same noun for the same state.

---

## DC-30

- **Surface:** /escalations
- **Sub-surface:** SlaIndicator chip
- **Dimension:** C
- **Severity:** High
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** d8a38023cb209d7c9d5e244c7675db8b15fb21ec
- **Effort:** S

**What:**
`SlaIndicator` floors the time-left to one hour: `Math.max(1, Math.ceil(diff / hour))`. An escalation that is 5 minutes from its SLA deadline displays the same `1h left` chip as one that is 59 minutes out. The chip is the only visible urgency signal on the collapsed card row, and it's positioned next to the relative timestamp ("4m ago") — so an operator scanning the list sees a calm-looking "1h left" right up until the deadline crosses zero and the chip flips to "Overdue." This understates urgency by up to an hour on the escalations that need attention most.

**Evidence:**
- File: apps/dashboard/src/components/escalations/escalation-list.tsx:42-63 (`hoursLeft = Math.max(1, Math.ceil(diff / hour))`)

**Fix:**
Drop the `Math.max(1, …)` clamp and switch to minutes when the diff is under an hour: `< 60min → "{n}m left"`, otherwise `"{n}h left"`. Mirrors `formatCountdown` on the approvals side.

---

## DC-31

- **Surface:** /conversations
- **Sub-surface:** StatusPill fallback branch
- **Dimension:** C
- **Severity:** Medium
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** d8a38023cb209d7c9d5e244c7675db8b15fb21ec
- **Effort:** S

**What:**
`StatusPill` only humanizes three of the six values in `ConversationStatusSchema` (`active`, `human_override`, `awaiting_approval`). The fallback branch renders the raw enum string verbatim, so an operator can see pills reading `awaiting_clarification`, `completed`, or `expired` (snake_case in a gray pill). On any conversation in those three states, the operator sees a code-shaped status string instead of a human label.

**Evidence:**
- File: apps/dashboard/src/app/(auth)/conversations/page.tsx:18-45 (StatusPill mapping; fallback at line 41-44)
- File: packages/schemas/src/chat.ts:37-44 (ConversationStatusSchema enumerates all six values)

**Fix:**
Add explicit cases for `awaiting_clarification`, `completed`, `expired` (e.g. "Waiting on customer," "Done," "Stale"), and only render the raw enum in development if a brand-new status arrives.

---

## DC-32

- **Surface:** /conversations
- **Sub-surface:** filter pill labels
- **Dimension:** C
- **Severity:** Low
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** d8a38023cb209d7c9d5e244c7675db8b15fb21ec
- **Effort:** S

**What:**
The filter pill for `human_override` reads "Overridden," but the StatusPill on every conversation in that state reads "You control." Two different terms for the same state on the same screen, ~40px apart vertically.

**Evidence:**
- File: apps/dashboard/src/app/(auth)/conversations/page.tsx:12-16 (`{ value: "human_override", label: "Overridden" }`)
- File: apps/dashboard/src/app/(auth)/conversations/page.tsx:26-32 (StatusPill for `human_override` reads "You control")

**Fix:**
Pick one. Either rename the filter to "You control" or rename the pill to "Overridden." Recommend "You control" — it's a verb, owner-second-person, and matches the rest of the dashboard's voice.

---

## DC-33

- **Surface:** /conversations
- **Sub-surface:** ConversationCard intent line
- **Dimension:** C
- **Severity:** Low
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** d8a38023cb209d7c9d5e244c7675db8b15fb21ec
- **Effort:** S

**What:**
When `currentIntent` is null, the conversation card renders the literal "No intent yet." *Intent* is internal taxonomy from the agent runtime; an operator scanning a list of customer threads doesn't think of conversations as having an "intent." The empty-state copy reads engineering-y and offers no signal as to why the field is blank.

**Evidence:**
- File: apps/dashboard/src/app/(auth)/conversations/page.tsx:115 (`{conversation.currentIntent ?? "No intent yet"}`)

**Fix:**
Replace with a humanized fallback such as "—" or "Just opened" or "Customer hasn't said much yet." Or hide the line entirely when null and surface the channel + last-activity instead.

---

## DC-34

- **Surface:** /decide, /escalations, /conversations (anywhere OwnerShell mounts the widget)
- **Sub-surface:** OperatorChatWidget header + placeholder hints
- **Dimension:** C
- **Severity:** Medium
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** d8a38023cb209d7c9d5e244c7675db8b15fb21ec
- **Effort:** S

**What:**
The widget header label reads "Operator Chat" and the empty-state hint inside the panel says: *"Type a command like 'show pipeline' or 'pause low-performing ads'."* Two issues: (1) "Operator" is internal/ops jargon — the dashboard elsewhere addresses the user as "you" / "your assistant," not as the operator. (2) The two example commands look like they are guaranteed to work, but neither is documented as a registered intent in `packages/core/src/intents/`. If those commands fail or return a generic "Sorry, something went wrong" (the widget's error fallback at `use-operator-chat.ts:54`), the empty-state hint sets up an embarrassing first interaction.

**Evidence:**
- File: apps/dashboard/src/components/operator-chat/operator-chat-widget.tsx:42 (`aria-label="Operator Chat"`)
- File: apps/dashboard/src/components/operator-chat/operator-chat-widget.tsx:52 (`<h3>Operator Chat</h3>`)
- File: apps/dashboard/src/components/operator-chat/operator-chat-widget.tsx:58-61 (placeholder hints "show pipeline" / "pause low-performing ads")
- File: apps/dashboard/src/components/operator-chat/use-operator-chat.ts:52-59 (error path message "Sorry, something went wrong. Please try again.")
- Repro (human, fact-check needed): open the widget, type each example command verbatim. If either returns a "Sorry, something went wrong" or a non-actionable system reply, the hint copy is making a promise the product can't keep.

**Fix:**
Rename "Operator Chat" to "Your assistant" or "Ask your assistant." Replace the example commands with hints that are guaranteed to work today (e.g. confirmed registered intents) — or drop the examples and use a generic prompt ("Ask anything…") until a real command catalogue exists.

---

## DC-35

- **Surface:** /decide, /decide/[id]
- **Sub-surface:** RespondDialog risk badge
- **Dimension:** C
- **Severity:** Low
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** d8a38023cb209d7c9d5e244c7675db8b15fb21ec
- **Effort:** S

**What:**
RespondDialog collapses the four risk categories (`low`, `medium`, `high`, `critical`) into two pills — "Lower impact" and "Higher impact." The list page already shows distinct consequence copy per category (`CONSEQUENCE`: "Routine — asked as a precaution" vs. "Affects a customer or involves money" vs. "Significant — take a moment to review"), so the operator was just shown a per-category sentence and is now told the four categories actually only have two tiers. The conflation also means a `medium`-risk approval shows the same badge as a `low`-risk one inside the confirm dialog, even though the consequence sentence differs.

**Evidence:**
- File: apps/dashboard/src/components/approvals/respond-dialog.tsx:51-57 (badge collapses 4 → 2)
- File: apps/dashboard/src/lib/approval-constants.ts:1-6 (CONSEQUENCE keeps all 4)

**Fix:**
Either show all four levels with distinct labels, or align the per-category consequence copy to the same two tiers so the dialog and the list agree.

---

## DC-36

- **Surface:** /console (Activity zone-head)
- **Sub-surface:** "+N more today ↓" subhead
- **Dimension:** C
- **Severity:** Low
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** d8a38023cb209d7c9d5e244c7675db8b15fb21ec
- **Effort:** S

**What:**
The Activity zone-head always renders "+{moreToday} more today ↓" — including when `moreToday === 0`. With nothing to show below, the operator reads "+0 more today ↓" with a downward arrow that points to no content.

**Evidence:**
- File: apps/dashboard/src/components/console/console-view.tsx:316-318 (unconditional render)
- File: apps/dashboard/src/components/console/console-mappers.ts:220-235 (`mapActivity` returns `moreToday: 0` when nothing's pending)

**Fix:**
Hide the "+N more today" affordance when `moreToday === 0`, or replace it with a quiet "All caught up" / "" when zero.

---

## DC-37

- **Surface:** /escalations, /console (activity row), /decide ("just now"-style relatives)
- **Sub-surface:** relative-time formatting
- **Dimension:** C
- **Severity:** Low
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** d8a38023cb209d7c9d5e244c7675db8b15fb21ec
- **Effort:** S

**What:**
Three local relative-time helpers are in use across the audited routes, with subtly inconsistent output: `formatRelative` (used by /decide list and history) returns capital "Just now"; `formatRelativeTime` (lib/utils, used by /decide/[id] indirectly) returns lowercase "just now"; `relativeTime` in `escalation-list.tsx` returns lowercase "just now"; `formatAge` in `console-mappers.ts` returns lowercase "just now". Same surface, two different casings depending on which page rendered the timestamp. Minor, but visible when comparing /decide and /escalations side-by-side.

**Evidence:**
- File: apps/dashboard/src/lib/format.ts:4 (`return "Just now"`)
- File: apps/dashboard/src/lib/utils.ts:36 (`return "just now"`)
- File: apps/dashboard/src/components/escalations/escalation-list.tsx:72 (`return "just now"`)
- File: apps/dashboard/src/components/console/console-mappers.ts:99 (`return "just now"`)

**Fix:**
Pick one casing (lowercase "just now" matches the rest) and consolidate the four helpers behind `formatRelativeTime` from `lib/utils.ts`. The console mapper's `formatAge` is currently the only helper that uses 24h time; the others abbreviate ("4m ago"). Align the units too while you're in there.

---

## DC-38

- **Surface:** /escalations
- **Sub-surface:** EscalationCard resolution form
- **Dimension:** C
- **Severity:** Low
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** d8a38023cb209d7c9d5e244c7675db8b15fb21ec
- **Effort:** S

**What:**
The trigger link reads "Resolve with note..." (sentence case) and the action button below reads "Mark Resolved" (Title Case) — same flow, two casings. The textarea label "Internal note (optional)" is sentence case; the success-state header in resolved cards reads "Internal note" (also sentence case, fine). Cancel button "Cancel" (Title Case). Mixed within a single inline form.

**Evidence:**
- File: apps/dashboard/src/components/escalations/escalation-list.tsx:254 ("Resolve with note...")
- File: apps/dashboard/src/components/escalations/escalation-list.tsx:278 ("Mark Resolved")
- File: apps/dashboard/src/components/escalations/escalation-list.tsx:289 ("Cancel")

**Fix:**
Pick a casing (sentence case matches the rest of the audited copy) and apply consistently: "Resolve with note", "Mark resolved", "Cancel."

---

## DC-39

- **Surface:** /console
- **Sub-surface:** Queue cards (escalation, recommendation, approval-gate) — every action button
- **Dimension:** B
- **Severity:** Launch-blocker
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 1ae14d88e75cf454696001939d73a266674933c7
- **Effort:** M

**What:**
Every button on every queue card is a stub with no `onClick` and no link wrapper. `EscalationCardView` renders "Reply inline ▾", primary ("Reply"), secondary ("Hold the line"), and self-handle ("I'll handle this") as `<button type="button">{label}</button>` with no handler (`console-view.tsx:48-61`). `ApprovalGateCardView` renders the primary "Review →" and the "Stop campaign" stop button the same way (`console-view.tsx:128-138`). `RecommendationCardView` renders "Approve pause", "Edit", "Dismiss" the same way (`console-view.tsx:90-100`). The view-model types `EscalationCard`, `ApprovalGateCard`, `RecommendationCard` carry only a `label: string` per action — there is no `href`, no `onClick` hook, no action descriptor in the data shape (`console-data.ts:47-89`). Net effect: an operator who spots a pending approval or escalation in the /console queue zone and clicks the obvious primary CTA gets nothing — the click is silently swallowed. **Task 1 (resolve approval) and Task 2 (drill into escalation and reply) cannot be completed via the /console queue zone today.** The user must instead know to navigate to `/decide` or `/escalations` separately. Combined with DC-40 (chrome hidden on /console means there's no nav out at all), this is a hard dead-end on the highest-traffic operator surface.

**Evidence:**
- File: apps/dashboard/src/components/console/console-view.tsx:48-50 ("Reply inline" button — no onClick)
- File: apps/dashboard/src/components/console/console-view.tsx:51-61 (escalation primary/secondary/selfHandle buttons — no onClick)
- File: apps/dashboard/src/components/console/console-view.tsx:90-100 (recommendation primary/secondary/dismiss — no onClick)
- File: apps/dashboard/src/components/console/console-view.tsx:128-138 (approval-gate primary/stop — no onClick)
- File: apps/dashboard/src/components/console/console-data.ts:47-89 (view-model types: `primary: { label: string }` — no href/onClick field)
- File: apps/dashboard/src/components/console/console-mappers.ts:107-148 (mappers fill `primary.label` but no action wiring exists in the type)
- Repro:
  1. Sign in as a tenant with at least one pending approval or escalation in the queue.
  2. Navigate to `/console`.
  3. Locate any queue card. Click "Reply" (escalation), "Review →" (approval gate), or "Approve pause" (recommendation).
  4. Observe: nothing happens. No navigation, no modal, no API call, no error. The button visibly takes click focus and that's it.
  5. Repeat for the secondary, dismiss, and stop buttons. Same result.

**Fix:**
Wire each queue-card primary action to the corresponding existing surface — escalation primary → expand inline reply (or navigate to `/escalations`); approval-gate primary → `/decide/${card.id}`; recommendation primary → either inline confirm or the relevant module. Extend the view-model types to carry either `href: string` or an `action: () => void`, and have `mapEscalationCard` / `mapApprovalGateCard` populate them. Until handlers exist, do not render bare `<button>`s that look like primary CTAs.

---

## DC-40

- **Surface:** /console
- **Sub-surface:** global (chrome / navigation)
- **Dimension:** B
- **Severity:** Launch-blocker
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 1ae14d88e75cf454696001939d73a266674933c7
- **Effort:** S

**What:**
`/console` is listed in `CHROME_HIDDEN_PATHS` (`app-shell.tsx:14`), so the bottom-tab nav (`OwnerTabs`) — the dashboard's only persistent navigation — is suppressed on the console route. The `/console` page itself contains zero internal navigation: the operating strip has no links, the queue cards have no handlers (DC-39), the agent-strip "view conversations →" labels are rendered as plain `<span>` text rather than anchors (`console-view.tsx:236`, see DC-42), the activity-row CTA arrows render as decorative `→` text when no `cta` is set (and the live mapper never sets one — `console-mappers.ts:228-233`, also see DC-43), and the only working link out of the page is the Nova-panel "View full ad actions →" pointing to `/modules/ad-optimizer` (out of audit scope). Net effect: an operator landing on `/console` has no in-page path to `/decide`, `/escalations`, `/conversations`, `/dashboard`, `/me`, or any other authenticated route. The only escape is the browser address bar or the back button. **Task 3 (orient as a new operator) ends in a literal dead-end: the user reads the page, forms a mental model, and then has nowhere to act on it from inside the surface.** This compounds DC-39 — even if a user knows what they want to do, they cannot navigate to do it.

**Evidence:**
- File: apps/dashboard/src/components/layout/app-shell.tsx:14 (`CHROME_HIDDEN_PATHS = ["/login", "/onboarding", "/setup", "/console"]` — bottom nav suppressed)
- File: apps/dashboard/src/components/console/console-view.tsx:158-342 (no `<Link>` or anchor element to any in-app route except the Nova panel's "View full ad actions" at line 306-308)
- File: apps/dashboard/src/components/console/console-view.tsx:236 (agent-strip view-link rendered as `<span>`, not `<a>`)
- Repro:
  1. Navigate to `/console` while signed in.
  2. Try to reach `/decide`, `/escalations`, or `/conversations` using only on-page elements (no address bar, no back button).
  3. Observe: there is no link, button, or click target on the page that takes you to any of those routes. The only outbound link is "View full ad actions →" in the Nova panel, which goes to `/modules/ad-optimizer`.
  4. Confirm the bottom-tab nav is not rendered (only present when `CHROME_HIDDEN_PATHS` does not match the current path).

**Fix:**
Either remove `/console` from `CHROME_HIDDEN_PATHS` so the bottom-tab nav is available (preferred — the console is "home base" for the operator and should sit inside the app chrome), or render the queue-card actions and agent-strip view-links as actual `<Link>` elements so the user can drill from the console into the per-domain pages. The current "console as full-bleed dashboard" framing only works if the page itself contains the navigation it currently lacks.

---

## DC-41

- **Surface:** /console
- **Sub-surface:** Op-strip — "Halt" button
- **Dimension:** B
- **Severity:** High
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 1ae14d88e75cf454696001939d73a266674933c7
- **Effort:** M

**What:**
The op-strip renders a primary "Halt" button (`console-view.tsx:178-180`) next to a "Live"/"Halted" status pulse — the visual treatment is that of an emergency stop / kill-switch for autonomous agent dispatch. The button has no `onClick` handler and the `dispatch` prop is hardcoded to `"live"` in `use-console-data.ts:98` with a `// TODO option C: read halt-state from useDispatchStatus or org config` comment. There is no API call, no confirmation dialog, no state change. The most safety-critical-looking control on the highest-traffic operator surface is a label, not a control. An operator who clicks Halt because something looks wrong (over-spend, runaway approvals, wrong-tenant data) will see no acknowledgment that anything happened, and dispatch will continue unchanged. This is dangerous specifically because the affordance reads "stop everything" — the user trusts it.

**Evidence:**
- File: apps/dashboard/src/components/console/console-view.tsx:178-180 (`<button className="op-halt" type="button">Halt</button>` — no onClick)
- File: apps/dashboard/src/components/console/use-console-data.ts:98 (`dispatch: "live"` hardcoded with a TODO)
- Repro:
  1. Navigate to `/console` while signed in.
  2. Click "Halt" in the top-right of the operating strip.
  3. Observe: nothing happens. No dialog, no toast, no status change, no network request. The "Live" pulse continues unchanged.

**Fix:**
Either wire Halt to a real `useDispatchStatus` mutation that flips the org-level dispatch flag (with confirmation dialog given the blast radius), or — until that exists — hide the button. Showing an unwired emergency stop on a live operator console is worse than not showing it.

---

## DC-42

- **Surface:** /console
- **Sub-surface:** Agent strip (Zone 3)
- **Dimension:** B
- **Severity:** Medium
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 1ae14d88e75cf454696001939d73a266674933c7
- **Effort:** S

**What:**
The agent-strip cards (Alex / Nova / Mira) carry a `viewLink: { label, href }` view-model field with hrefs `/conversations`, `/modules/ad-optimizer`, `/modules/creative` (`console-mappers.ts:170-184`). The view renders the agent column as a `<button>` and the view-link as a plain `<span className="a-view">{a.viewLink.label}</span>` — the href is never used (`console-view.tsx:222-238`). The label visually reads as a link ("view conversations →") but isn't one. An operator who wants to drill from the agent strip into per-agent details cannot, even though the data shape clearly anticipates that path. Compounded by DC-40, this is one of the few intended exit points from the console surface and it's silently inert.

**Evidence:**
- File: apps/dashboard/src/components/console/console-view.tsx:222-238 (agent column wrapped in `<button>`; viewLink rendered as `<span>` not `<a>`)
- File: apps/dashboard/src/components/console/console-data.ts:93-101 (`AgentStripEntry.viewLink: { label, href }` — href present in the shape)
- File: apps/dashboard/src/components/console/console-mappers.ts:170-184 (mapper sets the hrefs)

**Fix:**
Render the view-link as an `<a href={a.viewLink.href}>` (or a Next `<Link>`), styled as a link, so the documented destination actually opens. The outer agent-column button can stay as a "select agent" affordance; the view-link is a separate child action.

---

## DC-43

- **Surface:** /console
- **Sub-surface:** Activity trail (Zone 4) — row CTAs
- **Dimension:** B
- **Severity:** Low
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 1ae14d88e75cf454696001939d73a266674933c7
- **Effort:** S

**What:**
Each activity row renders either an `<a className="act-cta" href={row.cta.href}>{row.cta.label}</a>` if `cta` is set, or a decorative `<span className="act-arrow">→</span>` if not (`console-view.tsx:328-335`). The live activity mapper (`console-mappers.ts:228-233`) **never** sets `cta` — every row from real data falls through to the decorative arrow. So in the live UI every activity row ends with a `→` glyph that looks like a link, points nowhere, and isn't clickable. The fixture's recommendation row sets `cta: { label: "Approve", href: "#queue-pause-pending" }` (an in-page anchor that points at a recommendation card no longer emitted from real data), so even the fixture path resolves to a no-op when live data is loaded.

**Evidence:**
- File: apps/dashboard/src/components/console/console-view.tsx:328-335 (CTA branch vs. decorative arrow fallback)
- File: apps/dashboard/src/components/console/console-mappers.ts:228-233 (`mapActivity` rows never set `cta`)
- File: apps/dashboard/src/components/console/console-data.ts:339,352 (fixture CTAs point to `#queue-pause-pending` and `#`)

**Fix:**
Either drop the decorative `→` (make it visually clearly non-interactive — a divider, a muted dot, or nothing), or have `mapActivity` derive a real CTA per audit-eventType (e.g. `action.approval_requested` → `/decide/${approvalId}`, `action.rejected` → `/decide` History tab) so the arrow leads somewhere.

---

## DC-44

- **Surface:** /escalations
- **Sub-surface:** EscalationCard — post-reply state
- **Dimension:** B
- **Severity:** Medium
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 1ae14d88e75cf454696001939d73a266674933c7
- **Effort:** S

**What:**
After a successful reply, `setSent(true)` swaps the reply form for a stuck info banner ("Your reply has been saved…" — see DC-23 for the copy issue). The card stays expanded on the page; there is no auto-collapse, no jump to the next pending escalation, no "Done — close" button, and no visible cue that the operator should move on. With multiple escalations pending, the operator must manually scroll back up and click another card's header to expand it. The flow has no terminal state and no path to the next item — it just stops mid-page. For Task 2 (drill into escalation and reply), this means the user finishes the reply and the page tells them nothing about what to do next; the only signal that the work is done is the (factually wrong) blue banner.

**Evidence:**
- File: apps/dashboard/src/components/escalations/escalation-list.tsx:101-113 (`setSent(true)` on success, no further state transition)
- File: apps/dashboard/src/components/escalations/escalation-list.tsx:209-217 (info banner persists; no next-item affordance)
- File: apps/dashboard/src/components/escalations/escalation-list.tsx:84-300 (no jump-to-next or auto-collapse logic)

**Fix:**
After `sent`, either auto-collapse the card and scroll the next pending card into view, or surface a primary "Mark resolved & close" / "Next escalation →" affordance so the operator has a clear continuation path. The current "form replaced by a banner that just sits there" leaves the flow unfinished from the operator's perspective.

---

## DC-45

- **Surface:** /decide/[id]
- **Sub-surface:** post-mutation state (approve / reject)
- **Dimension:** B
- **Severity:** Medium
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 1ae14d88e75cf454696001939d73a266674933c7
- **Effort:** S

**What:**
On `/decide/[id]`, the approve/reject mutation `onSuccess` only invalidates two query keys and closes the dialog (`[id]/page.tsx:70-75`) — there is no toast, no auto-navigate back to `/decide`, and no inline confirmation. The detail page re-renders the same card with the status badge flipped from `pending` to `approved` / `rejected`, the Approve / Reject buttons disappear (because `isPending` is now false), and the user is left on a static detail page with no obvious next step. Compare with the `/decide` list page, which fires a toast on success and re-renders the queue minus the resolved card (`decide/page.tsx:138-149`) — same action, two completely different completion experiences. An operator who navigates `/decide → /decide/[id]` to approve a single decision then has to manually click the back arrow to return; an operator who approved on `/decide` directly stays on /decide and sees the next pending card. The detail-page completion flow is missing a return path.

**Evidence:**
- File: apps/dashboard/src/app/(auth)/decide/[id]/page.tsx:70-75 (mutation onSuccess: invalidate + close dialog only)
- File: apps/dashboard/src/app/(auth)/decide/page.tsx:138-149 (list-page mutation onSuccess: toast + invalidate + close)
- File: apps/dashboard/src/app/(auth)/decide/[id]/page.tsx:122-130 (no auto-redirect to `/decide` on success)

**Fix:**
On successful resolve from the detail page, fire the same toast as the list page and `router.push("/decide")` so the user lands back on the queue with one fewer pending item. Or, if the detail page is meant to support reviewing multiple resolutions in sequence, add a "Next decision" button. Either is fine; the current "page goes static, user has to find their own way out" is the issue.

---

## DC-46

- **Surface:** /escalations, /conversations
- **Sub-surface:** cross-page coupling (escalation ↔ conversation)
- **Dimension:** B
- **Severity:** Medium
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** 1ae14d88e75cf454696001939d73a266674933c7
- **Effort:** M

**What:**
An escalation has a `sessionId` that ties it to a conversation thread (`escalation-list.tsx:35`). The expanded escalation card renders an inline `ConversationTranscript` and an inline reply form — but there's no link from the escalation card to the corresponding conversation's full thread on `/conversations`, and no link from a `/conversations` thread (which has its own status pill "Awaiting approval" / "You control") to any related pending escalation. An operator who wants to "drill into an escalation conversation" (Task 2) gets only the inline transcript on `/escalations`; if they want to take over the agent on that thread (a feature that exists on `/conversations` via the "Take Over" button), they have to remember the lead's name and search the conversations list manually. Conversely, an operator browsing `/conversations` who sees an "Awaiting approval" pill has no jump to the related approval gate or escalation. The two pages cover overlapping ground without cross-links.

**Evidence:**
- File: apps/dashboard/src/components/escalations/escalation-list.tsx:35 (`sessionId?: string` field on the type)
- File: apps/dashboard/src/components/escalations/escalation-list.tsx:170-188 (transcript rendered inline; no link to /conversations)
- File: apps/dashboard/src/app/(auth)/conversations/page.tsx:99-156 (ConversationCard expands transcript; no link to /escalations even when status is awaiting_approval / human_override)

**Fix:**
Add a "Open in Conversations →" link on the expanded escalation card (linking to `/conversations` filtered by the thread / channel + lead), and on `/conversations` for any conversation in `awaiting_approval` or referenced by a pending escalation, show a "View pending decision →" link to the relevant `/decide/[id]` or `/escalations` deep-link. This is the kind of finding the human walk should confirm — it may be acceptable to leave the surfaces decoupled if the inline experience is sufficient.

---

## DC-47

- **Surface:** /console
- **Sub-surface:** global (page heading + heading order)
- **Dimension:** F
- **Severity:** High
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** e66874d05e1b6cdf0c96f2dec3a8fa2b97c1202a
- **Effort:** S

**What:**
`/console` ships with **no `<h1>`** anywhere on the page, and zone heads ("Queue", "Agents", "Activity") are rendered as `<span className="label">` rather than `<h2>`. Queue cards then jump straight to `<h3>` for `card.contactName` / `card.action` / `card.jobName` (`console-view.tsx:43,82,120`). Net effect: a screen-reader user navigating by heading on the highest-traffic operator surface lands directly on H3 rows with no top-level page name and no zone group above them, and the operator chat widget header (`<h3>Operator Chat</h3>`) is at the same heading level as a queue card. The other three audited routes (`/decide`, `/escalations`, `/conversations`) all have a single `<h1>`; `/console` is the outlier.

**Evidence:**
- File: apps/dashboard/src/components/console/console-view.tsx:158-342 (no h1; zone heads at lines 205, 218, 316 use `<span className="label">`)
- File: apps/dashboard/src/components/console/console-view.tsx:43,82,120 (queue-card titles render as `<h3>` with no preceding h1/h2)
- File: apps/dashboard/src/components/operator-chat/operator-chat-widget.tsx:52 (`<h3>Operator Chat</h3>` collides with queue-card h3s)
- Repro (human, screen-reader at closeout): with VoiceOver enabled, navigate `/console` by heading (VO+CMD+H). Confirm there is no H1, that zone heads are not announced as headings, and that queue cards announce as H3 with no parent group.

**Fix:**
Add an `<h1 className="sr-only">Console</h1>` (or visible if it fits the design) at the top of the page, promote each zone head to `<h2>` (Queue, Agents, Activity), and keep queue-card titles at `<h3>`. Apply the same fix in operator-chat-widget if it remains in scope: an `<h2>`-equivalent heading or downgrade to a non-heading element if the panel is not part of the page outline.

---

## DC-48

- **Surface:** /escalations
- **Sub-surface:** EscalationCard reply form — Send button
- **Dimension:** F
- **Severity:** High
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** e66874d05e1b6cdf0c96f2dec3a8fa2b97c1202a
- **Effort:** S

**What:**
The Send button on each expanded escalation card is icon-only — its only content is `<Loader2 />` while pending or `<Send />` otherwise. The button has no `aria-label`, no visible text, no `<span className="sr-only">` fallback. Screen readers announce the control as just "button" with no purpose. This is the primary CTA for the only mutating action on `/escalations` (sending an operator reply to a customer in escalation), so an AT user cannot identify which control sends their reply.

**Evidence:**
- File: apps/dashboard/src/components/escalations/escalation-list.tsx:233-244 (`<button …><Loader2 …/> | <Send …/></button>` — no aria-label, no text)
- Repro (human, VoiceOver at closeout): expand any escalation card, type a reply, navigate to the Send button. Confirm VO announces "button" with no name. Confirm with axe DevTools that the button shows a "button-name" violation.

**Fix:**
Add `aria-label="Send reply"` to the button (and `aria-label="Sending reply"` or similar live state when `replyMutation.isPending`), or render the icon with an adjacent `<span className="sr-only">Send reply</span>`.

---

## DC-49

- **Surface:** /decide, /escalations, /conversations (anywhere OperatorChatWidget mounts)
- **Sub-surface:** OperatorChatWidget input
- **Dimension:** F
- **Severity:** High
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** e66874d05e1b6cdf0c96f2dec3a8fa2b97c1202a
- **Effort:** S

**What:**
The operator-chat input (`<input type="text" placeholder="Type a command..." …>`) has no `<label>`, no `aria-label`, no `aria-labelledby`. Placeholder is not an accessible name — screen readers will announce the input as "edit text" with no purpose. The sibling toggle button at line 39-45 carries `aria-label="Operator Chat"` (and the panel header is also "Operator Chat"), so the form control inside the panel is the only unlabeled control in this widget. Compounded by the fact that the chat panel has no `role="dialog"` and no focus management — opening the panel does not move focus to the input.

**Evidence:**
- File: apps/dashboard/src/components/operator-chat/operator-chat-widget.tsx:71-78 (input with placeholder only, no label/aria-label, no `id`)
- File: apps/dashboard/src/components/operator-chat/operator-chat-widget.tsx:48-80 (panel `<div>` is not a dialog; opening it does not move focus)
- Repro (human, VoiceOver at closeout): on `/decide`, click the floating Chat button to open the panel, then VO+Right-Arrow to the input. Confirm VO announces "edit text" with no associated label.

**Fix:**
Add `aria-label="Ask your assistant"` (or similar — see DC-34 for naming) to the input, and either (a) render an actual `<label htmlFor>` paired with the input, or (b) add `aria-labelledby` pointing at the panel `<h3>`. Also wire focus to the input on panel open via a `ref.focus()` in a `useEffect` that fires when `isOpen` flips to true.

---

## DC-50

- **Surface:** /escalations
- **Sub-surface:** EscalationCard resolution form — internal note textarea
- **Dimension:** F
- **Severity:** Medium
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** e66874d05e1b6cdf0c96f2dec3a8fa2b97c1202a
- **Effort:** S

**What:**
The resolution form renders a `<label className="text-xs font-medium text-muted-foreground">Internal note (optional)</label>` immediately followed by a `<textarea …>`, but the label has no `htmlFor` and the textarea has no `id` — they are not programmatically associated. Visually adjacent, but a screen reader navigating into the textarea will not announce the label as the field's name. This is a secondary affordance (resolve flow), not the primary reply path, hence Medium not High.

**Evidence:**
- File: apps/dashboard/src/components/escalations/escalation-list.tsx:259-270 (`<label …>Internal note (optional)</label>` + `<textarea …>` with no id/htmlFor pair)

**Fix:**
Generate a unique id (e.g. `useId()`), set `htmlFor={id}` on the label and `id={id}` on the textarea. Or wrap the textarea inside the label element. Either correctly associates the two for AT.

---

## DC-51

- **Surface:** /console
- **Sub-surface:** global (focus visibility)
- **Dimension:** F
- **Severity:** Medium
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** e66874d05e1b6cdf0c96f2dec3a8fa2b97c1202a
- **Effort:** S

**What:**
`console.css` (968 lines) contains zero `:focus`, `:focus-visible`, or `outline` rules, and the global button reset at `[data-v6-console] button { … border: none; … padding: 0; }` removes the default border. Net effect: every interactive control in the `/console` subtree (`Halt`, `esc-reply`, queue-card primary/secondary/dismiss/stop, `agent-col`, panel-note anchor, Activity scroller `tabIndex={0}`) relies entirely on the browser's default outline ring for focus indication, with no scoped style. The rest of the dashboard uses the `--ring` token via shadcn primitives; the console subtree does not. Suspected low or absent focus visibility on the highest-traffic operator surface — confirm with keyboard walk at closeout.

**Evidence:**
- File: apps/dashboard/src/components/console/console.css (no focus / outline rules; `grep -c focus console.css` returns 0)
- File: apps/dashboard/src/components/console/console.css:41-48 (`[data-v6-console] button` reset removes background and border with no focus rule)
- File: apps/dashboard/src/components/console/console-view.tsx:222-238 (the agent-col toggle is the most consequential focusable control; relies on default outline)
- Repro (human, keyboard walk at closeout): navigate `/console` with Tab only. For every focusable element (op-halt, queue-card buttons once DC-39 is fixed, agent-col toggles, Nova panel-note, panel "View full ad actions", Activity scroller), confirm a visible focus ring. If any is missing or invisible against the warm-clay background, log here.

**Fix:**
Add a `[data-v6-console] :focus-visible` rule that produces a clearly visible ring against `--c-bg` (e.g. `outline: 2px solid var(--c-coral); outline-offset: 2px;`), and verify against the warm-clay background. Or — preferred — fold console.css into the global token system per DC-14, which inherits the existing `--ring` styling.

---

## DC-52

- **Surface:** /console
- **Sub-surface:** Error banner (above ConsoleView)
- **Dimension:** F
- **Severity:** Medium
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** e66874d05e1b6cdf0c96f2dec3a8fa2b97c1202a
- **Effort:** S

**What:**
The console error banner ("Couldn't load live data. Showing the last known shape.") is rendered as a plain `<div className="console-error">` with no `role="alert"`, no `aria-live`, no `aria-atomic`. When a hook fails mid-session and the banner appears, screen-reader users are not notified — the banner just enters the DOM silently. This is the only error surface on `/console`, so any contract-failure that happens after first paint is invisible to AT.

**Evidence:**
- File: apps/dashboard/src/app/(auth)/console/page.tsx:16-22 (`<div className="console-error">` — no role / aria-live)

**Fix:**
Add `role="alert"` (assertive — appropriate here because the message changes the operator's understanding of what they are seeing) or `role="status" aria-live="polite"` if a softer announcement is preferred. Either makes mid-session error appearance audible to AT.

---

## DC-53

- **Surface:** /console
- **Sub-surface:** placeholder text in numbers strip + agent strip sub-stats
- **Dimension:** F
- **Severity:** Medium
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** e66874d05e1b6cdf0c96f2dec3a8fa2b97c1202a
- **Effort:** S

**What:**
The "placeholder" treatment used by the numbers strip ("Revenue today" / "Spend today" / "Reply time" cells, see DC-03) and the agent-strip "pending option C" sub-stat (see DC-02) renders text with `--c-text-3` (a deliberately muted token) on the warm-clay `--c-bg` background. By design these read as "not yet available," but the contrast ratio between `--c-text-3` and `--c-bg` is suspected to fall below WCAG AA (4.5:1 for body text). Same suspicion applies to `text-blue-800` on `bg-blue-50` (escalation reply banner, DC-23) and the conversation card monospace channel text (`text-xs text-muted-foreground font-mono` against `bg-background`). Code-only, cannot confirm without axe — flag for closeout run.

**Evidence:**
- File: apps/dashboard/src/components/console/console.css (placeholder / muted-token usage; tokens in `:root[data-v6-console]` block at lines 9-23)
- File: apps/dashboard/src/components/console/console-view.tsx:188-199 (numbers cells with `placeholder` class)
- File: apps/dashboard/src/components/console/console-view.tsx:230-235 (a-stat / a-sub use muted tokens with `pending option C` text from DC-02)
- File: apps/dashboard/src/components/escalations/escalation-list.tsx:210 (`bg-blue-50 text-blue-800` reply banner)
- Repro (human, axe at closeout): run axe on `/console` and `/escalations`; check `color-contrast` violations on `.placeholder .n-value`, `.a-stat`, `.a-sub`, and the blue reply-confirmation banner. Confirm or downgrade.

**Fix:**
After axe confirms specific violations, either bump the token darkness for the muted text where it falls under 4.5:1 (or 3:1 for >= 18pt), or replace the placeholder treatment with a text-only fallback that meets contrast (e.g. body color on the same background). Pair with DC-16 to consolidate the colors against design tokens.

---

## DC-54

- **Surface:** /escalations, /conversations, /decide/[id]
- **Sub-surface:** decorative Lucide icons inside text-bearing elements
- **Dimension:** F
- **Severity:** Medium
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** e66874d05e1b6cdf0c96f2dec3a8fa2b97c1202a
- **Effort:** S

**What:**
Multiple Lucide SVG icons that are purely decorative (text label is adjacent and conveys the meaning) lack `aria-hidden="true"`. Screen readers announce each as a graphic with the icon's filename / role, adding noise to every traversal. Examples: `Clock` inside SlaIndicator chips ("Overdue" / "Nh left" — text already conveys the meaning, the clock is decoration), `ChevronUp`/`ChevronDown` inside the EscalationCard expand/collapse button (the whole button text already says what it does), `Info` inside the post-reply banner, `FileText` inside the resolution-note display, `CheckCircle2` / `AlertCircle` in empty states, `ChevronDown` / `ChevronRight` in conversation card toggles, `MessageSquare` next to the Conversations h1, `AlertTriangle` next to error / expired text on `/decide/[id]`. None are interactive, none carry their own meaning beyond decoration.

**Evidence:**
- File: apps/dashboard/src/components/escalations/escalation-list.tsx:50,59 (`Clock` in SlaIndicator)
- File: apps/dashboard/src/components/escalations/escalation-list.tsx:162-165 (ChevronUp/ChevronDown in expand toggle)
- File: apps/dashboard/src/components/escalations/escalation-list.tsx:194,211,343,348 (FileText, Info, CheckCircle2, AlertCircle)
- File: apps/dashboard/src/app/(auth)/conversations/page.tsx:105-108,171 (ChevronDown/ChevronRight, MessageSquare next to h1)
- File: apps/dashboard/src/app/(auth)/decide/[id]/page.tsx:93,222 (AlertTriangle next to error and expired text)

**Fix:**
Add `aria-hidden="true"` to each decorative Lucide icon. Lucide's React components accept the prop directly. Where the icon is the *only* indicator (none of the cases above qualify, but a future icon-only chip would), instead add an accessible name via `aria-label` on the parent.

---

## DC-55

- **Surface:** /console
- **Sub-surface:** global (page semantic landmarks)
- **Dimension:** F
- **Severity:** Low
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** e66874d05e1b6cdf0c96f2dec3a8fa2b97c1202a
- **Effort:** S

**What:**
On `/console` the layout chain renders **two nested `<main>` elements**: AppShell renders `<main className="min-h-screen bg-background">` because the path is in `CHROME_HIDDEN_PATHS` (`app-shell.tsx:36-42`), and ConsoleView renders its own `<main className="console-main">` inside that (`console-view.tsx:185`). HTML allows only one `<main>` per document; nested mains confuse landmark navigation and trip axe's `landmark-no-duplicate-main` rule. Additionally the `<header className="opstrip">` at line 164 sits *outside* either main, which means the operating-strip is not inside the main landmark even though it carries the page's brand + dispatch state.

**Evidence:**
- File: apps/dashboard/src/components/layout/app-shell.tsx:36-42 (outer `<main>` on `/console`)
- File: apps/dashboard/src/components/console/console-view.tsx:185 (inner `<main className="console-main">`)
- File: apps/dashboard/src/components/console/console-view.tsx:164-183 (operating-strip `<header>` outside the inner main)

**Fix:**
Either drop the outer `<main>` in `AppShell`'s `hideChrome` branch (use `<div>` and let ConsoleView own the landmark), or drop the inner `<main>` in ConsoleView (use `<div className="console-main">`). Whichever stays should wrap the operating-strip header so it's part of the page's main landmark.

---

## DC-56

- **Surface:** /console
- **Sub-surface:** Op-strip — Live/Halted status indicator
- **Dimension:** F
- **Severity:** Low
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** e66874d05e1b6cdf0c96f2dec3a8fa2b97c1202a
- **Effort:** S

**What:**
The dispatch-status indicator (`<span className="op-live"><span className="pulse" aria-hidden /> {dispatch === "live" ? "Live" : "Halted"}</span>`) flips its text content when org dispatch changes state. There is no `role="status"` and no `aria-live` on the wrapping span, so a screen-reader user has no way to know that dispatch transitioned from Live to Halted unless they re-traverse. The pulse is correctly marked `aria-hidden`. This is a Low because today (per DC-41) the Halt button is unwired, so the status never flips — but if/when DC-41 is fixed, the lack of live-region wiring will silently strand AT users.

**Evidence:**
- File: apps/dashboard/src/components/console/console-view.tsx:174-177 (`<span className="op-live">…</span>` no role/aria-live)

**Fix:**
Add `role="status" aria-live="polite"` to the `<span className="op-live">`. Pair with DC-41 — once Halt is wired, the announcement is meaningful.

---

## DC-57

- **Surface:** /escalations, /conversations
- **Sub-surface:** filter pill groups
- **Dimension:** F
- **Severity:** Low
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** e66874d05e1b6cdf0c96f2dec3a8fa2b97c1202a
- **Effort:** S

**What:**
Both `/escalations` (Pending / Released / Resolved) and `/conversations` (All / Active / Overridden) render filter pills as a row of `<button>` elements with no semantic grouping and no `aria-pressed` to indicate which is selected. A screen-reader user navigating the pills hears "Pending button. Released button. Resolved button." with no signal that exactly one is active. The active state is currently conveyed only by visual styling (`bg-foreground text-background` on /escalations, underline on /conversations).

**Evidence:**
- File: apps/dashboard/src/components/escalations/escalation-list.tsx:314-329 (filter buttons; no aria-pressed; no parent role)
- File: apps/dashboard/src/app/(auth)/conversations/page.tsx:175-190 (filter buttons; no aria-pressed; no parent role)

**Fix:**
Add `aria-pressed={filter === status}` to each filter button (toggle pattern), or wrap the group in `role="radiogroup" aria-label="Filter by status"` and switch each button to `role="radio"` with `aria-checked`. Either makes the active selection audible to AT.
