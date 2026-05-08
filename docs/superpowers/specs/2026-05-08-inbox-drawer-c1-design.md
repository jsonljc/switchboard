# Inbox Drawer (Phase C1) — Design Spec

_2026-05-08 · part of the agent-first redesign track · Phase C, surface 1_

---

## 1. Problem & scope

### 1.1 What this slice ships

A right-side drawer overlay accessible from the editorial header's `Inbox` link, listing every pending Decision (recommendations + handoffs) across all agents the org has enabled. The drawer reuses the existing per-agent Decision Feed plumbing — it is purely a frontend composition layer over backend, hooks, and components that already shipped in Slice A and Slice B.

The goals:

- Replace today's count-only placeholder (`InboxLinkClient` rendering `aria-disabled="true"` with title "Inbox drawer coming soon") with a working overlay.
- Give operators a single cross-agent triage surface so they don't have to flip between `/alex` and `/riley` to act on what's pending.
- Compose cleanly with the existing two-register split — the drawer overlays editorial-register surfaces and inherits the editorial vocabulary already locked in Slice B.

### 1.2 What this slice does NOT ship

- Backend changes — `GET /api/dashboard/decisions`, the cross-agent endpoint, already exists with tests
- Hook changes to `useDecisionFeed` — the cross-agent variant is already wired
- Changes to `DecisionCard`, `mapToDecisionCard`, or `dispatchDecisionAction` — all reused as-is
- New polling, SSE, or live-signal mechanism — drawer inherits the existing 60s React Query refetch
- A global keyboard shortcut to open the drawer (deferred; would require lifting state to a provider)
- Per-agent grouping, tabs, or sectioning — single urgency-sorted list with per-item agent chip
- Deep-link navigation from drawer items into agent home with the item focused (deferred to Phase D when contacts/threads detail routes land)
- Mira inclusion logic — Mira authors no decisions in v1; handoffs default to `alex` per `agent-key-resolver.ts`. The drawer is naturally Mira-free without special filtering.
- The Mercury-tier work register surfaces — drawer is editorial-only

### 1.3 Dependencies (already shipped or in flight)

| Item                                                                    | Source                                                          | Status                     |
| ----------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------- |
| `GET /api/dashboard/decisions` cross-agent route                        | `apps/dashboard/src/app/api/dashboard/decisions/route.ts`       | Shipped                    |
| `useDecisionFeed(null)` hook                                            | `apps/dashboard/src/hooks/use-decision-feed.ts`                 | Shipped                    |
| `DecisionCard` component                                                | `apps/dashboard/src/components/decisions/decision-card.tsx`     | Shipped                    |
| `mapToDecisionCard`                                                     | `apps/dashboard/src/lib/decisions/map-to-decision-card.ts`      | Shipped                    |
| `dispatchDecisionAction`                                                | `apps/dashboard/src/lib/decisions/dispatch-action.ts`           | Shipped                    |
| `Sheet` primitive (Radix-based, side variants)                          | `apps/dashboard/src/components/ui/sheet.tsx`                    | Shipped                    |
| `EditorialAuthShell` + header chrome with `InboxLinkClient` placeholder | `apps/dashboard/src/components/layout/editorial-auth-shell.tsx` | Shipped (Slice B)          |
| `AGENT_REGISTRY` (display names + accents per agent)                    | `@switchboard/schemas`                                          | Shipped                    |
| Slice B PR-S6 cutover (production env gate lifted)                      | `apps/dashboard/src/app/(auth)/[agentKey]/page.tsx`             | Shipped (#389, 2026-05-08) |

PR-S6 landed earlier today, so the editorial shell on `/`, `/alex`, and `/riley` is now production-visible for orgs with the agents enabled. C1 is therefore production-visible the moment it merges — no follow-on cutover, no separate gate. The only access control remaining on those routes is the org-enabled-agents check (`notFound()` if the requested agent isn't enabled for the org), which is unrelated to C1.

### 1.4 Decisions ledger

| #   | Question                | Locked answer                                                                                                                                                   |
| --- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Form factor             | Right-side sheet using existing `Sheet` primitive                                                                                                               |
| Q2  | Grouping                | Single list, urgency-sorted (existing API order), per-item agent chip                                                                                           |
| Q3  | Item layout             | Reuse `DecisionCard` as-is, full editorial card with action pills                                                                                               |
| Q4  | Post-action behavior    | Drawer stays open; acted item disappears via existing React Query invalidation; auto-close only when count hits 0 **after** a successful in-session action      |
| Q5  | Thread link             | Reuse `threadHref` as-is; Sheet auto-closes on navigation                                                                                                       |
| Q6  | Empty/loading copy      | First-person editorial voice (`I'll write again when something needs you`)                                                                                      |
| Q7  | Gating                  | None — the editorial shell is already prod-visible after PR-S6 (#389). C1 ships behind the same org-enabled-agents check the rest of Slice B uses. No new flag. |
| Q8  | Mira                    | No special handling; naturally absent in v1                                                                                                                     |
| Q9  | State management        | Local `useState` inside a single self-contained component; no provider, no lifted context                                                                       |
| Q10 | Agent label composition | Composed at drawer call site (`${displayName} · ${kindLabel}`); `mapToDecisionCard` and `DecisionCard` stay untouched                                           |
| Q11 | Tenant-null trigger     | Rendered as a real `disabled` button (the `disabled` HTML attribute on the `<button>` inside `SheetTrigger asChild`); clicking it does not open the dialog      |

---

## 2. Architecture

### 2.1 File layout

**New files:**

- `apps/dashboard/src/components/layout/inbox-drawer.tsx` — the new client component (trigger + Sheet content + list rendering)
- `apps/dashboard/src/components/layout/inbox-drawer.css` — drawer-specific tokens (per-agent accent dot via `data-agent` attribute, list spacing). Editorial register tokens are inherited from `globals.css`. The CSS file stays drawer-specific; if any rule grows broadly applicable, it moves up to globals.
- `apps/dashboard/src/components/layout/__tests__/inbox-drawer.test.tsx` — component tests

**Modified files:**

- `apps/dashboard/src/components/layout/editorial-auth-shell.tsx` — replace one import (`InboxLinkClient` → `InboxDrawer`) and one element. ~2-line diff.
- `apps/dashboard/src/hooks/use-decision-feed.ts` — delete the orphaned `useInboxCount` export (no remaining callers after `inbox-link-client.tsx` is deleted).
- `apps/dashboard/src/app/(auth)/[agentKey]/__tests__/agent-home-client.test.tsx` — remove the `useInboxCount: () => 0` line from the module mock (`useInboxCount` no longer exists to mock).

**Deleted files:**

- `apps/dashboard/src/components/layout/inbox-link-client.tsx` — its responsibility (render the count chip) moves into `InboxDrawer`'s trigger button. Git-blame continuity is not worth preserving a one-line wrapper.

### 2.2 Layer respect

All changes live in `apps/dashboard`. No edits to `packages/core`, `packages/schemas`, `packages/db`, or `apps/api`. Per the layered dependency rules in `CLAUDE.md`, this is purely a Layer-5 (apps) PR.

### 2.3 Why a self-contained component (not a provider)

The drawer's open/closed state is needed only by the trigger and the Sheet content — both of which can live in one component. No external surface needs to programmatically open the drawer in v1.

If a future Phase C feature needs cross-component drawer control (e.g., a notification toast deep-linking into a specific item, or a `?inbox=open` query param trigger), it is a small refactor: lift state into an `InboxDrawerProvider` mirroring `HaltProvider`, expose `useInboxDrawer()`, split trigger and content. The public API of `InboxDrawer` stays the same; only the internal state owner changes. **Don't pre-build the abstraction.**

---

## 3. Component shape & data flow

### 3.1 Sketch

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AGENT_REGISTRY } from "@switchboard/schemas";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useDecisionFeed } from "@/hooks/use-decision-feed";
import { useTenantContext } from "@/hooks/use-query-keys";
import { DecisionCard } from "@/components/decisions/decision-card";
import { mapToDecisionCard } from "@/lib/decisions/map-to-decision-card";
import { dispatchDecisionAction } from "@/lib/decisions/dispatch-action";
import "./inbox-drawer.css";

export function InboxDrawer() {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useDecisionFeed(null);
  const queryClient = useQueryClient();
  const tenant = useTenantContext();
  const actedInSessionRef = useRef(false);

  const decisions = data?.decisions ?? [];
  const total = data?.counts.total ?? 0;
  const tenantReady = !!tenant;

  // Reset session-action flag on every open/close transition.
  useEffect(() => {
    actedInSessionRef.current = false;
  }, [open]);

  // Auto-close when inbox hits zero AFTER a successful in-session action.
  useEffect(() => {
    if (open && total === 0 && actedInSessionRef.current) {
      setOpen(false);
    }
  }, [open, total]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="folio-link"
          disabled={!tenantReady}
          aria-label={total > 0 ? `Inbox, ${total} item${total === 1 ? "" : "s"}` : "Inbox, empty"}
        >
          {total > 0 && <span className="pip" />}
          <span>Inbox</span>
          {total > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="num">{total}</span>
            </>
          )}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="inbox-drawer sm:max-w-[28rem]">
        <SheetHeader>
          <SheetTitle className="font-display">Inbox</SheetTitle>
          <SheetDescription>{describeTotal(total)}</SheetDescription>
        </SheetHeader>
        {/* loading / error / empty / list — see §3.4 */}
      </SheetContent>
    </Sheet>
  );
}
```

### 3.2 Data sources

- **One hook, one query, one cache entry.** `InboxDrawer` calls `useDecisionFeed(null)` exactly once. The trigger count is derived from the same query result, not from `useInboxCount`. After `inbox-link-client.tsx` is deleted, `useInboxCount` becomes orphaned and is removed from `use-decision-feed.ts` (see §2.1).
- **No second fetch path.** The acceptance criterion: `InboxDrawer` must not introduce any subscription beyond `decisions.feed(null)`. Code review enforces this by checking the new file for exactly one `useDecisionFeed` call site and zero references to other decision-related queries.
- **Polling cadence stays at 60s** (the existing `refetchInterval` in `useDecisionFeed`). No new polling, no SSE.

### 3.3 Action behavior

- `onPrimary` and `onSecondary` for each item call `dispatchDecisionAction(d.sourceRef, "primary"|"secondary", undefined, { queryClient, orgId: tenant.orgId, agentKey: d.agentKey })`. **`agentKey` is the per-item value**, not a page-level constant — the dispatcher uses it to invalidate the per-agent feed query so an open Needs You block on `/alex` or `/riley` reflects the change too.
- After a dispatch promise resolves successfully, set `actedInSessionRef.current = true`. **Do not set it on dispatch failure.**
- The `useEffect` in §3.1 closes the drawer when `total === 0 && actedInSessionRef.current && open`. The flag resets on every open/close transition (in either direction) to prevent stale state from a prior session.
- Negative case (protected by test): if the count drops to 0 because another surface cleared the inbox while the drawer was open and the user did nothing inside the drawer, the drawer stays open.

### 3.4 List states inside the open drawer

- **Loading** (no cached data): `<p className="empty-state"><em>Reading your inbox…</em></p>`. Unlike Needs You, the drawer cannot stay silent — it is the destination, not one block of a larger page.
- **Error**: `<p className="empty-state"><em>Couldn't load your inbox.</em></p>`.
- **Empty** (data loaded, `total === 0`, no in-session action yet): `<p className="empty-state"><em>You're caught up across your team. I'll write again when something needs you.</em></p>`. First-person editorial voice matches Needs You's vocabulary. (Future-tightening alternative if the product voice trends operational: `New decisions will appear here when they need you.` — not adopted in v1.)
- **Populated**: `<div className="decisions">` (same class Needs You uses for spacing parity) wrapping one `<DecisionCard>` per item. Items render in API order (urgencyScore desc).

### 3.5 Per-item agent chip

Composed at the drawer call site:

```tsx
{
  decisions.map((d, i) => {
    const card = mapToDecisionCard(d, i);
    const agentName = AGENT_REGISTRY[d.agentKey].displayName;
    const folioWithAgent = {
      ...card.folio,
      kindLabel: `${agentName} · ${card.folio.kindLabel}`,
    };
    return (
      <div key={d.id} data-agent={d.agentKey} className="inbox-item">
        <DecisionCard
          {...card}
          folio={folioWithAgent}
          onPrimary={() => handleAction(d, "primary")}
          onSecondary={() => handleAction(d, "secondary")}
        />
      </div>
    );
  });
}
```

The card receives `folio={folioWithAgent}` and is wrapped in `<div data-agent={d.agentKey} className="inbox-item">` so drawer-scoped CSS in `inbox-drawer.css` can render a small accent dot in the agent's brand color (`AGENT_REGISTRY[key].accent`) by selecting `.inbox-item[data-agent="alex"]` etc. `DecisionCard` itself stays agent-agnostic — the wrapper owns cross-agent context, the card owns decision rendering.

`handleAction` is a local function that calls `dispatchDecisionAction(d.sourceRef, action, undefined, { queryClient, orgId: tenant.orgId, agentKey: d.agentKey })`, awaits the result, and on success sets `actedInSessionRef.current = true`.

---

## 4. Visual + behavior spec

### 4.1 Drawer chrome (editorial register)

- **Side:** `right`
- **Width:** ~28rem on desktop (`sm:max-w-[28rem]` className override of the Sheet default `sm:max-w-sm`); full-width on mobile
- **Background:** ambient cream, reading the existing `--ambient-cream` CSS variable so the drawer matches whatever cream tone the shell currently shows
- **Overlay:** Sheet's existing `bg-black/80` backdrop. A softer cream-tinted overlay variant would be nice-to-have but is explicitly deferred — not a v1 blocker.
- **Padding:** `p-6` (Sheet default)
- **Title typography:** `font-display` (Cormorant Garamond) for "Inbox", matching editorial vocabulary
- **Close affordance:** Sheet's built-in `<X>` close button at top-right (already in `SheetContent`)

### 4.2 Trigger button

- DOM is **identical** to today's `InboxLinkClient` — `<button class="folio-link">` containing `<span class="pip">` (when count > 0), the literal `Inbox` text, the `·` separator, and `<span class="num">{total}</span>` (when count > 0). Editorial header layout must not visibly shift after the swap.
- The placeholder behaviors are removed: `aria-disabled="true"` and `title="Inbox drawer coming soon"` no longer apply.
- `aria-label` is dynamic and count-aware:
  - `total === 0` → `"Inbox, empty"`
  - `total === 1` → `"Inbox, 1 item"`
  - `total >= 2` → `"Inbox, {total} items"`
- When `tenant === null` (race during initial mount, or unauthenticated edge): the trigger renders the static `Inbox` label with no count, `disabled` attribute set, and clicking it does not open the dialog. Once tenant resolves, full behavior takes over with no flicker (the same query was already running).

### 4.3 Polling and freshness

Unchanged. The existing 60s `refetchInterval` on `useDecisionFeed` continues whether the drawer is open or closed. After a successful action, the dispatcher's existing invalidation logic refetches both `decisions.feed(null)` and `decisions.feed(agentKey)` so the drawer list and any open Needs You block both update.

### 4.4 Keyboard / a11y

- `Esc` closes (Radix default)
- Focus traps inside the open Sheet (Radix default)
- `SheetTitle` and `SheetDescription` provide accessible name/description for screen readers
- Trigger has dynamic `aria-label`; pip dot and `·` separator are `aria-hidden="true"` (decorative)
- No global keyboard shortcut to open the drawer in v1 (deferred; would require lifting state to a provider)

---

## 5. Testing strategy

Tests live in `apps/dashboard/src/components/layout/__tests__/inbox-drawer.test.tsx`. Same vitest + React Testing Library pattern Slice B uses (mock `useDecisionFeed`, mock `dispatchDecisionAction`, render through `QueryClientProvider`).

For empty / loading / error / populated state tests, **open the drawer through the actual trigger** (click the `Inbox` button in the test) so the trigger ↔ Sheet integration is exercised, except in cases where the trigger is intentionally disabled.

### 5.1 Required tests

1. **Header DOM contract preservation** — render `InboxDrawer` with `total=3` (tenant present); assert the trigger button has class `folio-link`, contains `<span class="pip">`, the literal text `Inbox`, the `·` separator, and `<span class="num">3</span>`. This is the exact DOM `InboxLinkClient` produced; failing this test means the editorial header layout silently shifted.
2. **Trigger aria-label is count-aware** — `total=0` → `"Inbox, empty"`; `total=1` → `"Inbox, 1 item"`; `total=3` → `"Inbox, 3 items"`.
3. **Tenant-null trigger is disabled** — render with `useTenantContext` returning `null`; assert the trigger button has the `disabled` attribute set; simulate a click; assert the dialog does not open (no element with `role="dialog"` in the document, and `SheetContent` is not in the DOM).
4. **Empty state copy** — render with `total=0`, tenant present; click the trigger; assert the empty-state prose renders.
5. **Loading state copy** — render with `useDecisionFeed` returning `isLoading=true` and no cached data; click the trigger; assert `Reading your inbox…` renders.
6. **Error state copy** — render with `useDecisionFeed` returning `isError=true`; click the trigger; assert `Couldn't load your inbox.` renders.
7. **Populated list reuses DecisionCard with composed agent label** — feed returns one Alex approval and one Riley handoff; click the trigger; assert two cards render, the first card's folio reads `Alex · Approval` and the second `Riley · Handoff`, and `data-agent` attributes on the wrapping divs are `alex` and `riley` respectively.
8. **Action dispatches with the per-item agentKey** — feed returns one Riley handoff; click the trigger; click primary on the rendered card; assert `dispatchDecisionAction` was called with `agentKey: "riley"` (not the page-level agent).
9. **Auto-close on inbox-zero requires a successful in-session action.** Mock the feed return as a mutable value so `rerender` can simulate the post-dispatch refetch from `total=1` to `total=0`. Positive case: open with 1 item; act; mock dispatch resolves successfully; rerender feed to `total=0`; assert drawer is closed. Negative case: open with 1 item; do not act; rerender feed to `total=0` (simulating another surface clearing it); assert drawer stays open.
10. **Auto-close ref resets on close as well as open** — open with 1 item; act; dispatch resolves but rerender keeps `total=1`; drawer stays open; user closes manually; reopen; rerender feed to `total=0` without acting; assert drawer stays open. (Protects the bidirectional reset of `actedInSessionRef`.)
11. **Accessibility — drawer has accessible name** — open the drawer; assert there is an element with `role="dialog"` in the document with an accessible name matching `Inbox`.

### 5.2 Inspection-only acceptance (not a runtime test)

- `InboxDrawer` must not introduce any subscription beyond `decisions.feed(null)`. Code review confirms exactly one `useDecisionFeed` call site in the new file and zero references to other decision-related queries.
- No remaining imports or references to `inbox-link-client.tsx` or `useInboxCount` anywhere in `apps/dashboard/src` after the deletion.

### 5.3 Not tested in C1 (covered elsewhere or deferred)

- `threadHref` cross-page navigation — covered by existing `DecisionCard` tests
- The `/api/dashboard/decisions` route shape — covered by `apps/dashboard/src/app/api/dashboard/decisions/__tests__/route.test.ts` and the upstream Fastify route's tests
- Polling cadence — covered by existing `useDecisionFeed` tests
- React Query cache deduplication semantics — that is a library guarantee, not a C1 invariant
- Sheet primitive's focus trap and Esc-close — covered by Radix's tests

---

## 6. PR plan

Single PR titled `feat(dashboard): C1 — inbox drawer (cross-agent decisions overlay)`.

### 6.1 Diff shape

| File                                                         | Lines (approx) | Change kind             |
| ------------------------------------------------------------ | -------------- | ----------------------- |
| `components/layout/inbox-drawer.tsx`                         | +130           | New                     |
| `components/layout/inbox-drawer.css`                         | +30            | New                     |
| `components/layout/__tests__/inbox-drawer.test.tsx`          | +220           | New                     |
| `components/layout/editorial-auth-shell.tsx`                 | ~2 changed     | Modified                |
| `hooks/use-decision-feed.ts`                                 | -5             | `useInboxCount` removed |
| `app/(auth)/[agentKey]/__tests__/agent-home-client.test.tsx` | -1             | mock entry removed      |
| `components/layout/inbox-link-client.tsx`                    | -25            | Deleted                 |

Net new: ~350 lines, ~30 deleted.

### 6.2 Acceptance criteria

- All required component tests in §5.1 pass (eleven tests including the dialog accessible-name assertion)
- `pnpm lint && pnpm typecheck && pnpm --filter @switchboard/dashboard test` clean
- Visual smoke (dev): on `/alex` (or `/`), click `Inbox` in the header; verify a right-side drawer slides in with editorial chrome; click a card's primary action; verify the item disappears from the drawer and (with one item) the drawer closes
- Header DOM diff in `editorial-auth-shell.tsx` is exactly two lines (one import, one element swap)
- No remaining imports or references to `inbox-link-client.tsx` or `useInboxCount` anywhere in `apps/dashboard/src`
- Drawer is production-visible immediately upon merge (PR-S6 already lifted the editorial-shell route gate; the only remaining access control is the per-org agent-enablement check)

---

## 7. Risks + mitigations

| Risk                                                                                              | Impact                                               | Mitigation                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SheetTrigger asChild` + `disabled` button has unexpected Radix interaction                       | Tenant-null state silently opens drawer              | Test 3 in §5.1 explicitly asserts no dialog opens; verified via testing-library click simulation, not via internal state                                                                                                           |
| Sheet primitive mounts `SheetContent` regardless of open state, causing unintended fetch behavior | Hidden duplicate query work                          | Inspection acceptance in §5.2 — only one `useDecisionFeed(null)` call site. React Query dedupes anyway, but the structural rule is the load-bearing guarantee                                                                      |
| Auto-close-on-zero closes the drawer when an unrelated surface clears the inbox while it's open   | Confusing close-without-context                      | Action-driven gate: drawer only auto-closes when the user acted **inside this open session** (negative test case in §5.1 #9)                                                                                                       |
| Header layout shifts visibly because the new component renders different DOM than the deleted one | Visible regression on `/`, `/alex`, `/riley` headers | Test 1 in §5.1 protects the exact DOM contract                                                                                                                                                                                     |
| Editorial copy ("I'll write again when something needs you") drifts as product voice tightens     | Voice inconsistency over time                        | Empty-state copy is one string in one component; future tightening is a one-line change with a test update                                                                                                                         |
| Drawer renders for an org with zero enabled agents                                                | Empty/confusing inbox surface                        | The editorial shell already only renders the brand-nav for org-enabled agents (Slice B Q12). For orgs with zero enabled agents the inbox feed is naturally empty and the empty-state copy applies. No special-casing needed in C1. |
| `useInboxCount` deletion breaks an unaudited consumer                                             | Type error or runtime null                           | Audit performed (only `inbox-link-client.tsx` and a single test mock) — both updated atomically in this PR                                                                                                                         |

---

## 8. Out of scope (explicitly deferred)

| Item                                                            | Why deferred                                                        | Future track                                             |
| --------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| Global keyboard shortcut to open inbox                          | Requires lifting state to a provider; no v1 use case                | Future Phase C+                                          |
| Deep-link from drawer item into agent home with focus/scroll-to | Requires URL hash + focus state in agent home; net new spec surface | Phase D Tools tier or later                              |
| Per-agent grouping or tabs inside the drawer                    | Single urgency-sorted list is simpler and matches API order         | Reconsider if user research surfaces grouping demand     |
| Cream-tinted overlay variant for editorial Sheets               | Nice-to-have polish; not a v1 blocker                               | Future shell-token PR                                    |
| Mira-aware UX (badge, "launching +30" stub in drawer)           | Mira authors no decisions in v1                                     | Phase D after Mira goes live                             |
| Live signal / SSE for real-time inbox updates                   | 60s polling is sufficient for v1                                    | Future Phase C+ when product evidence justifies the lift |
| `?inbox=open` query-param trigger or notification deep-links    | Speculative; no v1 caller                                           | Future when a caller exists                              |
| Operational copy variant (`New decisions will appear here…`)    | Editorial voice matches the rest of the shell                       | Reconsider if product voice trends operational           |

---

## 9. References

- **Roadmap:** `docs/superpowers/specs/2026-05-03-agent-first-redesign-roadmap.md` (Phase C §4, inbox aggregator §5 #7, ordering §6)
- **Slice A spec (Decision Feed):** `docs/superpowers/specs/2026-05-03-agent-roster-and-decision-feed-design.md` — locked Decision shape, urgency scoring, adapters
- **Slice B spec (agent home):** `docs/superpowers/specs/2026-05-04-slice-b-agent-home-design.md` — header chrome ownership (Q8), inbox link is count-only deferred to C1 (§10)
- **Two-register doctrine:** memory `project_two_register_design.md` and roadmap §3
- **Existing implementations referenced:**
  - `apps/dashboard/src/components/layout/editorial-auth-shell.tsx` — header chrome
  - `apps/dashboard/src/components/layout/inbox-link-client.tsx` — placeholder being replaced
  - `apps/dashboard/src/hooks/use-decision-feed.ts` — feed hook
  - `apps/dashboard/src/components/decisions/decision-card.tsx` — card UI
  - `apps/dashboard/src/lib/decisions/{map-to-decision-card,dispatch-action}.ts`
  - `apps/dashboard/src/components/ui/sheet.tsx` — Sheet primitive
  - `apps/dashboard/src/app/api/dashboard/decisions/route.ts` — cross-agent endpoint
  - `apps/api/src/routes/decisions.ts` — upstream Fastify route
