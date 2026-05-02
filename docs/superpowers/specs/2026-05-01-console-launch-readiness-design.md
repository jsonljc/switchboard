# Console Launch Readiness — Design

> Status: Draft (pending user review)
> Owner: Jason
> Date: 2026-05-01

## 1. Goal

Make `/console` the operator's home at v1 launch — the page they see immediately after signing in, where they can take action on every queue item without leaving the page (with deep-links to full-detail surfaces for cases that need it), navigate to other parts of the app, and never see fabricated metrics or false success messages. The page degrades gracefully when any individual hook fails.

This spec captures the minimum surface to ship `/console` as the launch home without embarrassment, derived from the 59-finding pre-launch surface audit (Surface 01 — Dashboard core, branch `audit/01-dashboard-core`).

## 2. Context

The "console-as-home dashboard direction supersedes v6 redesign" decision (PR #323) established `/console` as the post-launch operating home. Subsequent work landed `/console preview wired to backend hooks (option B)` (PR #328) plus 10+ wiring commits on `feat/console-preview`.

The pre-launch surface audit (commit `02fcaa4c`, branch `audit/01-dashboard-core`, 59 findings) revealed that despite the wiring being feature-complete in shape, the surface is not yet operationally viable as a launch home:

- **Operator can't take action.** Every queue-card primary action button (`Review →`, `Reply inline ▾`, `Approve`, `Edit`, `Dismiss`, `Stop campaign`, `I'll handle this`) is `<button type="button">` with no `onClick` (DC-39, Launch-blocker).
- **Operator can't navigate.** `/console` suppresses `OwnerTabs` and ships zero in-page links to other routes (DC-40, Launch-blocker).
- **Operator never lands on /console.** Post-login redirect is hardcoded to `/dashboard` (DC-59, High).
- **Operator sees fabricated metrics.** Nova "Ad actions" panel always renders Aurora Dental fixture rows, regardless of whether the tenant has an ad-optimizer deployment (DC-01, Launch-blocker).
- **Operator sees a blank page on any backend hiccup.** When any of five console hooks errors, the page renders the error banner over an empty body — `consoleFixture` fallback declared in `use-console-data.ts:56-58` does not visibly render (DC-58, Launch-blocker; reproduced by browser).
- **Operator gets false confirmations.** `/escalations` post-reply banner promises message-queueing-on-next-customer-message even when the API just performed direct delivery (DC-23, Launch-blocker).
- **Cross-tenant cache leak vectors.** Every React Query key is statically scoped, no tenant segment, no `clear()` on signOut (DC-11/DC-13, High pending two-tenant browser repro that escalates to Launch-blocker on confirmation).

The product cannot ship `/console` as the operator home until these are closed.

## 3. Scope

### In scope (3 PRs, this spec drives the implementation plan)

**PR-1: Operator can use /console.** (DC-39 + DC-40 + DC-59)

- Wire every queue-card primary action via shared action hooks + slide-over UI (`useApprovalAction`, `useEscalationReply`, `useRecommendationAction`).
- Re-show `OwnerTabs` on /console (remove from `CHROME_HIDDEN_PATHS`).
- Wire in-zone affordances as real navigation: agent-strip "view conversations →" links, activity-row arrows, queue-zone heading links to `/escalations`.
- Change `/login` callback default to `/console` for onboarded users; `/onboarding` for users without a complete onboarding state.

**PR-2: /console doesn't lie.** (DC-58 + DC-04 + DC-01 + DC-23)

- Replace whole-page fixture-fallback with per-zone graceful degradation. Each zone (numbers, queue, agents, activity, Nova panel) handles its own loading/error/empty independently.
- Gate Nova panel rendering on the existing `useModuleStatus()` hook, mirroring the pattern at `apps/dashboard/src/components/console/use-console-data.ts:80-86` (`moduleEnabled("ad-optimizer")` checks `state === "live"`). When ad-optimizer is not live for this org, render an inline empty/onboarding state ("No ad-optimizer deployed yet — connect one in Settings"), not the demo fixture. (Note: `useDeployment(id)` exists in `use-marketplace.ts:83` but takes a deployment id not a module slug — wrong primitive here. `useDeployments()` plus a filter could also work but `useModuleStatus()` is the established pattern.)
- Remove `consoleFixture` from runtime use; keep it as a Storybook/test-only artifact (or delete entirely).
- Replace `/escalations` post-reply banner with delivery-state-branched copy: 200 success → "Reply sent to {customer name} via {channel}." 502 proactive failure → "Couldn't deliver to {channel} right now — message saved; the customer will see it on their next message" (or whatever the actual fallback semantics are).

**PR-3: Auth integrity.** (DC-11 + DC-13)

- Tenant-scope every React Query key. Refactor `lib/query-keys.ts` (and any hook with inline keys) to require an org segment as the first key part: `[orgId, "dashboard", "overview"]`. Encode via a `useScopedQueryKey()` helper that throws if `orgId` is missing.
- Wire `signOut` (and any session-change handler) to call `queryClient.clear()` before the next session is established.
- Run the two-tenant browser repro (audit human-walk doc §H, three repros) before merging PR-3 to confirm or downgrade severity. If any repro reproduces, PR-3 is Launch-blocker per audit hard-prohibition; if none reproduce in current code, PR-3 ships as defense-in-depth at High severity.

### Out of scope (deferred — captured in audit `index.md` post-launch backlog)

- **DC-41 Halt button.** Hide from launch (remove `op-halt` button from /console op-strip). Wire properly post-launch — needs new `/api/dashboard/dispatch/halt` endpoint, runtime gate in agent loop, tenant-wide flag, audit trail. Memory pointer: `reference_post_launch_backlog.md`.
- **DC-14 design-system divergence.** Ship-with acknowledgment for launch — /console keeps its parallel warm-clay palette / General Sans / scoped `[data-v6-console]` rules. Fold console.css into globals.css within 30 days post-launch as launch-debt. The OwnerTabs nav re-shown on /console (PR-1) needs a single-rule override in console.css to play nicely with the global nav chrome; that's not a fold-in, it's a launch-time visual reconciliation.
- **All Mediums and Lows** from the 59-finding audit (DC-02 jargon, DC-03 placeholder copy, DC-15 font swap, DC-19 /decide visual divergence, DC-25 "Not now" copy, DC-30 SLA chip floor, DC-44 post-reply continuation, DC-46 escalation↔conversation cross-link, etc.).
- **A11y improvements DC-47..DC-57** beyond what the human-walk closeout flags as keyboard-unreachable critical paths. Static a11y findings are post-launch backlog except where the closeout walk upgrades them.
- **Nova-panel real ad-set aggregation** (Option C territory — `DashboardOverviewSchema` extension). PR-2 only gates the panel; populating it with real data is out of scope.
- **Per-agent today-stats real values** (DC-02). PR-2 replaces the literal "pending option C" with a neutral em-dash + muted treatment; populating the values is post-launch.

### Explicitly not addressed

- The `feat/console-preview` branch's pending work (Task 15 manual verification + final sweep per `2026-04-30-console-wiring-option-b.md`). This spec assumes that branch's existing wiring is the input; it does not retread Option B.
- Fixes for surfaces other than /console, /escalations, /decide, /conversations. The audit covered only Surface 01; remaining surfaces (02 Dashboard secondary, 03 Marketing, 04 Onboarding, 05 Chat, 06 Notifications, 07 Operator/admin) are scoped under their own audit sessions.

## 4. Architecture

### 4.1 Slide-over pattern (PR-1)

A single shared `Sheet` component (Radix-based; existing `@radix-ui/react-dialog` is already a dependency) renders the slide-over surface. Two content variants ride on top at launch:

- `<ApprovalSlideOver approvalId={id} />` — renders approve/reject/skip controls + summary; shared `useApprovalAction(approvalId)` hook drives the mutation. "Open full detail →" deep-links to `/decide/[id]`.
- `<EscalationSlideOver escalationId={id} />` — renders conversation transcript (truncated to last N turns) + reply textarea + Send. Shared `useEscalationReply(escalationId)` hook drives the mutation. "Open full conversation →" deep-links to `/conversations/[escalationId]` (or matched conversation id).

Recommendation cards are not implemented (no runtime emitter today; see §12). When the Option-C recommendation feed lands, a third `<RecommendationSlideOver>` follows the same pattern — but PR-1 ships nothing recommendation-shaped (no stub component, no stub hook). Queue cards of `kind: "recommendation"` continue to render their existing read-only view; their action buttons (already inert per DC-39) stay inert until the data feed exists.

The slide-over component itself does NOT own approve/reject/reply state — it consumes the shared hooks that the existing `/decide/[id]` and `/escalations` pages also consume. Mutation logic lives in `apps/dashboard/src/hooks/`. Both surfaces (slide-over and full page) render their own UI on top of identical mutation hooks. This prevents the two-flows divergence trap.

URL state: opening a slide-over does NOT push a route. The slide-over is local component state. Closing returns the operator to /console with no URL change. Deep-links inside the slide-over use `<Link href="/decide/[id]">` and trigger normal navigation. This is the canonical "peek vs full" pattern (Linear, Gmail).

### 4.2 Per-zone graceful degradation (PR-2)

Today `useConsoleData` is a single composer that returns either the full live shape or `consoleFixture`. PR-2 replaces this with per-zone composers. The page becomes:

```
<ConsoleView>
  <OpStrip />          // owns useOrgConfig + useDispatchStatus
  <NumbersStrip />     // owns useDashboardOverview (numbers)
  <QueueZone />        // owns useEscalations + useApprovals
  <AgentStrip />       // owns useAgentRoster + useAgentState + useModuleStatus
  <NovaPanel />        // owns useDeployment("ad-optimizer") gate + (when present) ad-set hook
  <ActivityTrail />    // owns useAudit
</ConsoleView>
```

Each zone renders its own loading skeleton, empty state, and error state. The whole-page banner is removed. A zone in error shows an inline message ("Couldn't load queue — retry") with a retry button bound to the local hook's `refetch`. Adjacent zones are unaffected.

`useConsoleData` is removed. `mapConsoleData` is decomposed into per-zone mappers (most already exist as `mapNumbersStrip`, `mapQueue`, `mapAgents`, `mapActivity` — these become each zone component's responsibility).

`consoleFixture` is removed from the runtime path. It is preserved (or deleted) as a Storybook/test fixture only — the runtime never reads it.

### 4.3 Tenant-scoped query keys (PR-3)

Single source of truth: `apps/dashboard/src/lib/query-keys.ts` is refactored to a factory function:

```ts
export const queryKeys = (orgId: string) => ({
  dashboard: {
    overview: () => [orgId, "dashboard", "overview"] as const,
    audit: (filters: AuditFilters) => [orgId, "audit", filters] as const,
    // ...
  },
  approvals: {
    pending: () => [orgId, "approvals", "pending"] as const,
    detail: (id: string) => [orgId, "approvals", "detail", id] as const,
  },
  // ...
});
```

A hook `useQueryKeys()` reads `session.organizationId` from NextAuth and returns either the scoped keys factory output (when authenticated) or `null` (when session is loading or unauthenticated). Callers compose this with React Query's `enabled` flag:

```ts
const keys = useQueryKeys();
const { data } = useQuery({
  queryKey: keys?.dashboard.overview() ?? ["__disabled__"],
  queryFn: () => apiClient.getDashboardOverview(orgId),
  enabled: !!keys,
});
```

The `["__disabled__"]` placeholder is never exercised because `enabled: false` short-circuits the fetch; it satisfies React Query's "queryKey must be defined" contract during the loading window. A test asserts that no real data lands under the placeholder key.

Every existing `useQuery` call in `apps/dashboard/src/hooks/` and inline call sites (e.g., `/decide/[id]:42`) is refactored to this pattern. Bare keys like `["dashboard", "overview"]` cease to compile because the helper is the only export from `query-keys.ts` (the file no longer exports a top-level `queryKeys` object — only the factory function).

Authentication-required pages already gate rendering on session via the auth layout / middleware; the brief loading window when `useQueryKeys()` returns `null` is the same window during which the page itself is rendering its session-loading state. No user-visible change.

`signOut` is wired (via NextAuth's `signOut` callback or a wrapper at the call sites) to call `queryClient.clear()` before the session change completes. This is defense-in-depth — even a future code path that bypasses `useQueryKeys()` would fail to leak across sessions because the cache is empty.

The two-tenant browser repro (audit human-walk doc §H) runs before PR-3 merges. If any of the three repros reproduces in current code, PR-3 escalates to Launch-blocker (audit hard-prohibition: data leak). If none reproduce, PR-3 ships as High defense-in-depth.

### 4.4 Login redirect logic (PR-1)

The existing `/login` page (`apps/dashboard/src/app/login/page.tsx`) computes `callbackUrl` from `searchParams` at render time and uses it for both the `useEffect` post-auth redirect (line 29) and the post-`signIn` `window.location.href` (line 48). PR-1 replaces this single computed string with a session-aware function that runs *after* authentication completes (i.e., inside the `useEffect` that fires when `status === "authenticated"`):

```ts
const defaultCallback = (session: Session | null) => {
  if (!session?.organizationId) return "/onboarding";
  if (!session.onboardingComplete) return "/onboarding";
  return "/console";
};
```

The `useEffect` reads `useSession()`'s `session.data` and computes the destination at navigation time:

```ts
useEffect(() => {
  if (status !== "authenticated") return;
  const explicit = searchParams.get("callbackUrl");
  router.push(explicit ?? defaultCallback(session.data));
}, [status, session.data, searchParams, router]);
```

Explicit `callbackUrl` from `searchParams` still wins (preserves "deep link to a specific route" flows like password reset → /settings/account). The session-aware default fires only when no explicit target was provided.

`session.onboardingComplete` is added to the NextAuth session shape (in `apps/dashboard/src/lib/auth.ts` JWT and session callbacks) by reading the `Organization.onboardingComplete` boolean — or, if no such field exists, derive from a concrete heuristic: "the org has ≥1 active connected channel AND ≥1 configured agent." Verify the schema during PR-1 implementation; if neither field nor heuristic source exists, the open question in §12 escalates to a small schema PR before PR-1.

The `signIn` flow in the same file (lines 38-48, 55, 190) is updated identically: the `callbackUrl` parameter passed to `signIn()` becomes either the explicit search-param value or a placeholder (`"/__post_auth_redirect"`) that the post-auth `useEffect` resolves once the session shape is available.

## 5. Data flow

### 5.1 Approval flow (Q1 = C)

Operator clicks "Review →" on an approval-gate card in /console queue.

1. Card's `onClick` handler calls `setSlideOver({ kind: "approval", id: card.approvalId })`.
2. `<ApprovalSlideOver approvalId={id} />` mounts.
3. Slide-over reads `useApprovalDetail(approvalId)` (a thin hook over the existing approvals detail endpoint — same endpoint `/decide/[id]` consumes).
4. Operator clicks "Approve" or "Reject."
5. Slide-over calls `useApprovalAction(id).approve()` or `.reject()`.
6. The shared hook calls the existing `/api/dashboard/approvals/[id]` mutation endpoint.
7. On success, the hook invalidates `queryKeys(orgId).approvals.pending()` and emits a toast. Slide-over closes via local state.
8. /console queue re-renders with the approval removed.

For full-detail cases, operator clicks "Open full detail →" inside the slide-over → navigates to `/decide/[id]` → identical mutation hook drives the same flow.

### 5.2 Escalation reply flow (Q2 = C)

Operator clicks "Reply inline ▾" on an escalation card in /console queue.

1. Card's `onClick` handler calls `setSlideOver({ kind: "escalation", id: card.escalationId })`.
2. `<EscalationSlideOver escalationId={id} />` mounts; reads `useEscalationDetail(id)` for transcript.
3. Operator types reply, clicks Send.
4. `useEscalationReply(id).send(text)` posts to `/api/dashboard/escalations/[id]/respond`.
5. On 200: toast "Reply sent to {customer name} via {channel}." Slide-over closes. Queue re-renders.
6. On 502: toast or inline banner "Couldn't deliver to {channel} right now — {fallback semantics from API response body}." Reply form stays open with text preserved so operator can retry or take another action.

For full-conversation cases, operator clicks "Open full conversation →" → navigates to `/conversations/[id]` → same `useEscalationReply` hook drives the same flow.

### 5.3 Per-zone error path (PR-2)

Each zone owns its hook and renders one of three shapes:

```
isLoading → <ZoneSkeleton />
error     → <ZoneError onRetry={refetch} />
data      → <ZoneContent data={data} />
empty     → <ZoneEmpty />        // for zones whose API can return validly empty (e.g., no escalations)
```

`<ZoneError />` renders a small inline state with a retry button. No whole-page banner. The op-strip and any zone whose hook succeeded continue to render normally.

`<NovaPanel />` adds a fourth shape: when `useDeployment("ad-optimizer").data === null`, render `<NovaPanelEmpty>` ("No ad-optimizer deployed yet. Connect one in Settings → Channels.") instead of any zone state. This subsumes DC-01.

## 6. Error handling

- **API 5xx on a console hook** → that zone enters error state with retry. Other zones unaffected.
- **API 401** (session expired mid-session) → middleware should redirect to /login already (audit DC-10 noted middleware matcher gaps for /console; address in PR-1's middleware update). Per spec §13 on the audit: `/console`, `/escalations`, `/conversations` need to be added to `AUTH_PAGE_PREFIXES` and the middleware matcher.
- **API 502 on escalation reply** → reply form stays open with text preserved; banner copy describes the failure and what the operator can do next.
- **Session has no `organizationId`** → middleware sends to `/onboarding`. /console never renders for an unboarded user (PR-1's redirect logic catches this at /login; middleware catches direct-URL access).
- **`useDeployment("ad-optimizer").data === null`** → Nova panel hides (renders empty-state). Not an error.
- **`queryClient.clear()` race with in-flight mutations** → mutations should be tied to the session via `mutationFn`'s session-id check (defense-in-depth — if a mutation lands after signOut, it's a no-op). Not load-bearing for the cache-leak fix; clear() is sufficient for the leak vector.

## 7. Testing

### 7.1 Unit tests

- `useApprovalAction(id)` — invalidates the right keys on success, emits toast, no-ops on session change. Mocked.
- `useEscalationReply(id)` — branches on 200 vs 502; preserves textarea text on 502.
- `useScopedQueryKey()` / `queryKeys(orgId)` factory — throws on missing orgId; produces stable scoped keys.
- `signOut` wrapper — calls `queryClient.clear()` before NextAuth `signOut`.
- `defaultCallback(session)` — three branches verified (`!orgId` → `/onboarding`, `!onboardingComplete` → `/onboarding`, otherwise → `/console`).

### 7.2 Integration tests

- /console renders with one zone in error state — the other zones keep working.
- /console renders without an ad-optimizer deployment — Nova panel shows empty state, no fixture.
- `/escalations` reply flow — 200 path closes form + toast; 502 path keeps form open + branched copy.
- /login redirect — session shapes drive the three callback branches.

### 7.3 Browser-verified (manual, recorded in audit closeout)

- **Two-tenant browser repro** (audit human-walk doc §H, three cases). Run before PR-3 merge. Records pass/fail + post-fix re-verification.
- **End-to-end approval slide-over** — sign in, click Review → on a queue card, approve, confirm queue updates, no /console nav.
- **End-to-end escalation reply slide-over** — sign in, click Reply on a queue card, send, confirm correct banner + queue update.
- **Cross-zone failure isolation** — kill API, observe /console renders per-zone error states (not a blank page); kill DB, observe same.

### 7.4 Lighthouse + axe re-runs

After PR-1, PR-2, PR-3 land, re-run `pnpm audit:lighthouse /console` and `pnpm audit:axe /console` against the launch-candidate SHA. New issues at Launch-blocker severity block the launch (audit spec §13.7).

## 8. PR sequence

PR-1 → PR-2 → PR-3, each merged to `main` before the next branches. Each PR is its own short-lived branch off `main`.

**PR-1 — Operator can use /console** (`feat/console-pr1-actions-and-nav`)

Files (anticipated; verify during implementation):
- New: `apps/dashboard/src/components/console/slide-overs/approval-slide-over.tsx`
- New: `apps/dashboard/src/components/console/slide-overs/escalation-slide-over.tsx`
- (No `recommendation-slide-over.tsx` — see note below; deferred until recommendation cards are emitted.)
- New: `apps/dashboard/src/hooks/use-approval-action.ts` (extracts the inline `respondMutation` at `apps/dashboard/src/app/(auth)/decide/page.tsx:115` and the same call site in `decide/[id]/page.tsx`. Wraps `respondToApproval` from the api-client. Both /decide pages and the new slide-over consume identical logic.)
- New: `apps/dashboard/src/hooks/use-escalation-reply.ts` (extracts the inline reply submit logic in `apps/dashboard/src/components/escalations/escalation-list.tsx`. Wraps the POST to `/api/dashboard/escalations/[id]/respond`. Both `/escalations` page and the new slide-over consume identical logic.)
- Modify: `apps/dashboard/src/app/(auth)/decide/page.tsx` and `decide/[id]/page.tsx` (replace inline `respondMutation` with `useApprovalAction(id)`; preserve the existing `<RespondDialog>` UI surface)
- Modify: `apps/dashboard/src/components/approvals/respond-dialog.tsx` (update to consume `useApprovalAction` if it currently receives mutation as a prop)
- Modify: `apps/dashboard/src/components/escalations/escalation-list.tsx` (replace inline reply submit with `useEscalationReply(id)`)
- (No `use-recommendation-action.ts` — recommendation cards are not emitted by the backend in Option B; do not implement the recommendation slide-over or its action hook unless recommendation cards exist at runtime. Adding a stub now creates fake surface area. Defer to a future PR alongside the Option-C recommendation feed.)
- Modify: `apps/dashboard/src/components/console/console-view.tsx` (queue cards get `onClick`; slide-over state hooks)
- Modify: `apps/dashboard/src/components/layout/app-shell.tsx:14` (`CHROME_HIDDEN_PATHS` array — remove `"/console"`)
- Modify: `apps/dashboard/src/components/console/console.css` (single-rule override for OwnerTabs visual reconciliation, if needed — the warm-clay `[data-v6-console]` palette will need to coexist with the global nav chrome)
- Modify: `apps/dashboard/src/middleware.ts` (add `/console`, `/escalations`, `/conversations` to `AUTH_PAGE_PREFIXES` and the `matcher` per audit finding DC-10)
- Modify: `apps/dashboard/src/app/login/page.tsx:23,29,48` (redirect logic per §4.4 — replace the precomputed `callbackUrl` with session-aware logic in the post-auth `useEffect`)
- Modify: `apps/dashboard/src/lib/auth.ts:182-235` (extend `jwt` callback to read `Organization.onboardingComplete` from Prisma and set `token.onboardingComplete`; extend `session` callback to set `session.onboardingComplete` from token). **Caching guidance:** read `onboardingComplete` from Prisma only on initial sign-in (when `user` is present in the JWT callback — the same branch that already initializes `organizationId`/`principalId`), not on every token refresh. Today's `jwt` callback DOES re-query `dashboardUser.emailVerified` on every refresh because the verification banner needs to disappear immediately after a user verifies; do NOT add `onboardingComplete` to that path. The trade-off: if `Organization.onboardingComplete` flips from `false` → `true` mid-session (a user finishes onboarding without re-authenticating), the session's `onboardingComplete` stays stale until the next token refresh on a NextAuth-session-update event or the user re-signs-in. Acceptable: onboarding completion is a once-per-org transition; the user is interacting with the wizard at the moment of flip and can reload after the wizard's own success state. PR-1 surfaces this as a `update()` call on `useSession()` from the wizard's success handler if needed (one-line addition); the writing-plans phase scopes whether that's part of PR-1 or a wizard-side follow-up.
- Modify: `apps/dashboard/src/types/next-auth.d.ts` (add `onboardingComplete: boolean` to the `Session` interface and `onboardingComplete?: boolean` to the `JWT` interface)

**PR-2 — /console doesn't lie** (`feat/console-pr2-truth-and-degradation`)

Files (anticipated):
- Modify: `apps/dashboard/src/components/console/console-view.tsx` (per-zone composition; remove single composer)
- Modify: `apps/dashboard/src/components/console/zones/op-strip.tsx` (extract; was inline)
- Modify: `apps/dashboard/src/components/console/zones/numbers-strip.tsx` (extract)
- Modify: `apps/dashboard/src/components/console/zones/queue-zone.tsx` (extract)
- Modify: `apps/dashboard/src/components/console/zones/agent-strip.tsx` (extract)
- Modify: `apps/dashboard/src/components/console/zones/nova-panel.tsx` (extract; gate on `useDeployment`)
- Modify: `apps/dashboard/src/components/console/zones/activity-trail.tsx` (extract)
- New: `apps/dashboard/src/components/console/zones/zone-error.tsx`, `zone-skeleton.tsx`, `zone-empty.tsx` (shared)
- (Use existing `apps/dashboard/src/hooks/use-module-status.ts`; no new hook needed.)
- Delete: `apps/dashboard/src/components/console/use-console-data.ts` (no replacement; logic moved into zones)
- Delete: `apps/dashboard/src/app/(auth)/console/page.tsx` whole-page error banner block (lines 16-22)
- Modify: `apps/dashboard/src/components/console/console-data.ts` (`consoleFixture` removed from runtime use; either deleted or moved to `__fixtures__/`)
- Modify: `apps/dashboard/src/components/escalations/escalation-list.tsx` (post-reply banner branches on 200 vs 502; reads `response.error` + `response.replySent` from the existing API shape)
- (No API change needed: `apps/api/src/routes/escalations.ts:266-275` already returns `{ escalation, replySent: false, error: "Reply saved but channel delivery failed. Retry or contact customer directly.", statusCode: 502 }` on the failure path and `{ escalation, replySent: true }` on success. The existing shape is sufficient for the branched copy.)

**PR-3 — Auth integrity** (`feat/console-pr3-auth-integrity`)

Files (anticipated):
- Modify: `apps/dashboard/src/lib/query-keys.ts` (refactor to factory; remove bare-key exports)
- New: `apps/dashboard/src/hooks/use-query-keys.ts` (returns factory output bound to session.orgId; throws if missing)
- Modify: every file in `apps/dashboard/src/hooks/use-*.ts` (~10 files; refactor to use scoped keys)
- Modify: any inline `useQuery({ queryKey: [...] })` call site (e.g., `/decide/[id]:42`)
- Modify: `apps/dashboard/src/providers/query-provider.tsx` (add `signOut` wrapper that calls `queryClient.clear()` before next session)
- New or modify: `apps/dashboard/src/lib/sign-out.ts` (wrapper exporting `signOut()` that clears + delegates to NextAuth)
- Update audit findings doc `01-dashboard-core-findings.md`: set DC-11 / DC-13 Status based on browser repro + fix outcome

Run two-tenant browser repro before merging PR-3.

## 9. Success criteria

- A new operator on a fully-seeded tenant signs in → lands on /console (not /dashboard).
- An unboarded user signs in → lands on /onboarding (not /console; not /dashboard).
- Every queue-card primary action button on /console opens a slide-over or navigates correctly. No no-op buttons remain.
- "Open full detail" deep-link from each slide-over lands on the correct full-detail surface (`/decide/[id]` for approvals, `/conversations/[id]` for escalations).
- `OwnerTabs` is visible on /console; clicking each tab navigates to the corresponding route.
- Killing the API mid-session → /console renders per-zone error states; the page is not blank; zones whose hooks succeed continue rendering.
- A tenant with no ad-optimizer deployment → Nova panel renders the empty state, not the Aurora Dental fixture.
- Replying to an escalation → 200 returns "Reply sent to … via …"; 502 returns the failure copy with form preserved.
- Sign in as Tenant A → sign out → sign in as Tenant B in the same browser, same tab → no Tenant A data visible at any point on /console.
- Two-tenant browser repro (3 cases) — pass.
- Audit findings DC-01, DC-23, DC-39, DC-40, DC-58, DC-59 carry Status `Fixed (PR #__)`. DC-11 + DC-13 carry either `Fixed (PR #__)` or downgrade-with-rationale based on browser repro.
- DC-41 + DC-14 are recorded in audit `index.md` post-launch backlog with re-evaluate dates.
- `pnpm audit:lighthouse /console` and `pnpm audit:axe /console` pass the §13.7 re-audit gate (no new Launch-blockers).

## 10. Risks and non-goals

- **Slide-over divergence trap.** If approve/reject/reply UI diverges between the slide-over and the full-detail page, operators get inconsistent flows. Mitigation: shared action hooks; both surfaces consume identical mutation logic (§4.1, §4.2).
- **Zone composition complexity.** Decomposing `useConsoleData` into per-zone hooks could explode coupling if not careful. Mitigation: each zone owns its data fetch + render; cross-zone dependencies (e.g., op-strip's "live"/"halted" state being read by Nova panel) explicitly route through React context, not prop drilling. Op-strip's halt button is hidden anyway (§3 out-of-scope), so that coupling doesn't exist at launch.
- **Query-key refactor breaks every test.** Tests that hard-code `["dashboard", "overview"]` will fail. Mitigation: tests import `queryKeys(orgId)` like production code; test setup provides a stub orgId.
- **Two-tenant repro doesn't reproduce in dev** but the production code path differs. Mitigation: PR-3 ships the fix regardless; the repro determines severity, not whether to fix.
- **`OwnerTabs` on /console looks visually wrong.** /console's warm-clay palette + General Sans clashes with the global nav chrome. Mitigation: a small CSS override (or tabs accept a per-route theme prop). If still bad, this becomes a vote for accelerating DC-14's design-system fold-in pre-launch instead of post-30 — call this at PR-1 visual review.
- **Onboarding completeness signal doesn't exist on the session.** PR-1's redirect logic depends on `session.onboardingComplete`. If no such field exists, derive it from existing schema (e.g., "Organization has ≥1 active channel"). Verify during PR-1 implementation; if neither exists, scope creep into onboarding schema.
- **Slide-over state survives unintended renders / route changes.** A slide-over open during an unexpected re-render (e.g., session refresh) loses state. Mitigation: slide-over state is local to the page; route change closes it. No URL state. This is intentional and matches the peek pattern.
- **Ad-optimizer deployment hook doesn't exist.** PR-2's Nova panel gate depends on `useDeployment("ad-optimizer")` (or the existing module-status hook). Verify the API serves enough info to distinguish "deployed" from "not deployed" — if not, extend the API in PR-2 or fall back to hiding Nova panel for everyone at launch (and accept that as launch debt).

### Non-goals

- Refactoring the dashboard architecture beyond what these three PRs require.
- Touching surfaces other than /console, /escalations, /decide, /conversations.
- Resolving any audit finding outside the 6 launch-blockers + DC-11/DC-13.
- Wiring real values into placeholder zones (numbers strip's three placeholder cells, per-agent today-stats, recommendation cards). Those are Option C.

## 11. Operating procedures

### 11.1 Branching and PR sequence

Each PR is a short-lived branch off `main`, named per §8. PR-1 merges to main; PR-2 branches off the new main; PR-3 branches off the post-PR-2 main. No long-lived integration branch.

The `feat/console-preview` branch (current jasonli working branch) is **not** the input for these PRs — its work has already merged via PR #328. PR-1 branches from current main (commit `02fcaa4c` or later).

### 11.2 Audit findings update protocol

When each PR merges, update `docs/audits/2026-05-01-pre-launch-surface/01-dashboard-core-findings.md`:

- Set Status of fixed findings to `Fixed (PR #__)`.
- Run `pnpm audit:validate` to confirm validation passes.
- Update `index.md` Launch-blocker queue with the new Status.

If browser repro escalates DC-11 / DC-13 to Launch-blocker, also update those findings + the index.

### 11.3 Pre-launch verification

After PR-3 merges, run the audit closeout protocol per the audit human-walk doc:
- All §A screenshots captured.
- All §D / §E manual walks recorded.
- §F axe + keyboard walk + VoiceOver run.
- §G Lighthouse on the launch-candidate SHA.
- §H two-tenant browser repro (final pass).

Re-audit gate per audit spec §13.7 runs before launch tag.

### 11.4 Trivial-fix bypass

The audit's trivial-fix bypass (spec §13.4) does not apply to any finding in this spec — all six launch-blockers + DC-11/DC-13 require their own implementation. The Mediums and Lows in the audit's High backlog may use the bypass at the team's discretion.

### 11.5 Rollback

If any of PR-1, PR-2, PR-3 ships and produces a regression discovered post-merge, the rollback path is a revert PR back to the prior main. /console is not yet the launch home (DC-59 redirect lands as part of PR-1; reverting PR-1 reverts the redirect alongside its own fix), so a rollback during PR-1/PR-2 phase doesn't affect public users. After launch, reverts follow the standard incident protocol.

## 12. Open questions

### Resolved during spec self-review (verified against current main)

- **`Organization.onboardingComplete` field exists** at `packages/db/prisma/schema.prisma:414` (`Boolean @default(false)`). Not currently plumbed through NextAuth's JWT/session callbacks (`apps/dashboard/src/lib/auth.ts:182-235` reads `organizationId` and `principalId` only). PR-1 plumbs it: extend the JWT callback to read `Organization.onboardingComplete` from Prisma when the token is initialized, set on token; extend the session callback to copy from token to session; declare on `Session` interface in `apps/dashboard/src/types/next-auth.d.ts`.
- **Ad-optimizer-deployed gate.** Use the existing `useModuleStatus()` hook (the same primitive `use-console-data.ts:80-86` already uses for `moduleEnabled("ad-optimizer")`). No new hook needed.
- **/escalations 502 response body.** The API at `apps/api/src/routes/escalations.ts:266-275` already returns `{ escalation, replySent: false, error: "<reason>", statusCode: 502 }` on failure and `{ escalation, replySent: true }` on success. PR-2's branched copy reads `replySent` and `error` directly. No API change needed.

### Still open (implementation-time)

- **Recommendation cards.** PR-1 creates a `useRecommendationAction` hook stub but recommendations don't render in /console today — `mapQueue` filters approvals to `riskCategory === "creative"` only and a code comment notes recommendations are not exposed by the backend in option B; option C wires them. Default assumption: recommendation slide-overs are out of scope for v1 launch; the queue's two real card kinds at launch are escalation and approval-gate. If the team wants recommendation cards live for launch, scope a thin backend feed alongside PR-1.
- **`/decide/[id]` integration with the new approval slide-over hook.** The existing `respondMutation` at `apps/dashboard/src/app/(auth)/decide/page.tsx:115` is consumed by `<RespondDialog>`. PR-1's extraction must preserve `<RespondDialog>`'s props/contract or update the dialog to consume `useApprovalAction(id)` directly. Read the dialog's signature during PR-1 implementation; the cleaner direction is the dialog consuming the hook (single source of truth).
- **OwnerTabs visual reconciliation on /console.** The warm-clay `[data-v6-console]` palette + General Sans typography may clash with `OwnerTabs`'s globals.css styling when re-shown on /console. PR-1 includes a single CSS override; if visual review at PR-1 finds it irreconcilable, this becomes a vote to accelerate DC-14's design-system fold-in pre-launch instead of post-30. Calibrate at PR-1 visual review.

These are implementation-time questions, not design-time. They don't block the spec; they get answered during the writing-plans phase or in PR-1 / PR-2 implementation.
