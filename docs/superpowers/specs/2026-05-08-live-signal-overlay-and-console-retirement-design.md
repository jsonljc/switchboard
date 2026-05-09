# Live Signal Overlay + Console Retirement (Phase C2) — Design Spec

_2026-05-08 · part of the agent-first redesign track · Phase C, surface 2_

---

## 1. Problem & scope

### 1.1 What this slice ships

C2 retires the legacy `/console` surface and extracts the only parts still
worth keeping — global Halt authority and a live-signal pulse — into the
editorial register. It is split into two PRs that land sequentially.

- **C2a · Console Retirement + Authority Cleanup.** Relocate the
  `HaltProvider` implementation into a layout-owned `halt/` cluster, replace
  `/console/page.tsx` with a server-component redirect shim, retarget
  post-login destination, lift global `H` / `?` keyboard shortcuts to the
  editorial shell, rewrite the HelpOverlay for the editorial register, and
  reduce the old `components/console/halt-context.tsx` to a temporary
  re-export shim so the dormant console tree still type-checks.
- **C2b · Live Signal Overlay.** Turn the static `Live` / `Halted` pip in
  the editorial header into a Radix Popover trigger. The popover renders
  system-state, a Halt/Resume action, and a read-only preview of the last
  10 audit events agent-tagged. C2b also deletes the entire
  `components/console/` tree, deletes `app/(auth)/console/`, removes
  `/console` from middleware, and prunes residual JSDoc references.

### 1.2 What this slice does NOT ship

- **Live as a behavioral mode.** Live is not a behavioral mode. It is a
  presentation surface — a system pulse. It does not gate behavior elsewhere
  in the app.
- **`/activity` Mercury surface.** The popover preview is bounded to the
  last 10 events. Filters, search, pagination, agent-nav, and detailed
  audit semantics are Phase D3 territory.
- **Toast layer in editorial.** Halt confirmation is the pip + popover
  content flipping `Live → Halted` in lockstep. The console's
  `ToastProvider` / `ToastShelf` / `toggleHaltWithToast` pattern is not
  carried into the editorial register.
- **`1` / `2` / `3` keyboard shortcuts** for opening agent panels. Those
  existed in the console because agent panels were inline; agent homes are
  real routes now. Deferred.
- **Pip-anchored keyboard shortcut** (e.g. `L` to open Live). The pip is
  clickable; no v1 use case for a global shortcut.
- **SSE / live push for the activity preview.** Inherits `useAudit()`'s
  existing React Query polling cadence. No new polling.
- **Audit invalidation on halt toggle.** Halt does not author an audit
  event in v1 (it is localStorage-backed).
- **Per-agent filtering inside the popover preview.** Live is system-wide.

### 1.3 Dependencies (already shipped or in flight)

| Item                                               | Source                                                             | Status                     |
| -------------------------------------------------- | ------------------------------------------------------------------ | -------------------------- |
| Editorial header chrome with the static `Live` pip | `apps/dashboard/src/components/layout/editorial-auth-shell.tsx:51` | Shipped (Slice B)          |
| `HaltProvider` + `useHalt` + `toggleHaltWithToast` | `apps/dashboard/src/components/console/halt-context.tsx`           | Shipped (relocated in C2a) |
| `HelpOverlay` (console copy)                       | `apps/dashboard/src/components/console/help-overlay.tsx`           | Shipped (rewritten in C2a) |
| `useKeyboardShortcuts`                             | `apps/dashboard/src/components/console/use-keyboard-shortcuts.ts`  | Shipped (relocated in C2a) |
| `useAudit` (audit feed hook)                       | `apps/dashboard/src/hooks/use-audit.ts`                            | Shipped                    |
| `useHalt` consumer in editorial header             | `apps/dashboard/src/components/layout/halt-button-client.tsx`      | Shipped                    |
| Cross-agent inbox drawer (C1)                      | `apps/dashboard/src/components/layout/inbox-drawer.tsx`            | Shipped (#393, 2026-05-08) |
| Slice B PR-S6 cutover (production env gate lifted) | `apps/dashboard/src/app/(auth)/[agentKey]/page.tsx`                | Shipped (#389, 2026-05-08) |

C1 landed earlier today, so the editorial shell is fully production-visible
for orgs with enabled agents. C2 inherits the same access boundary; no new
flag, no new gate.

### 1.4 Doctrine line locked into the spec

> Live is system pulse. Inbox is decisions needing action. Agent homes are
> agent workspaces. Activity is the full audit/history surface (Phase D).

Each surface has one job. C2 enforces this by deleting the legacy console
that blurred those jobs together.

### 1.5 Decisions ledger

| #   | Question                          | Locked answer                                                                                                                                                                                                                               |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Slice C overall direction         | Path B — Live Signal Overlay + Console Retirement, split into C2a + C2b                                                                                                                                                                     |
| Q2  | C2b form factor                   | Radix Popover anchored to the `Live` / `Halted` pip; ~22rem; content-sized; max-height bounded                                                                                                                                              |
| Q3  | `/console` route disposition      | C2a: replace `page.tsx` with `redirect("/")` + TODO referencing C2b. C2b: delete the shim and the entire console tree.                                                                                                                      |
| Q4  | HaltProvider survivor             | Editorial. C2a relocates the implementation into `components/layout/halt/halt-context.tsx`; the old `components/console/halt-context.tsx` becomes a re-export shim only. After C2a there is exactly one real `HaltProvider` implementation. |
| Q5  | Halt confirmation pattern         | Pip + popover content flip `Live → Halted` in lockstep. No toast layer in editorial.                                                                                                                                                        |
| Q6  | Activity preview source           | Reuse `useAudit()`. No new endpoint. Cap at 10 most recent events, agent-tagged via co-located helpers.                                                                                                                                     |
| Q7  | Activity preview interactivity    | Read-only. No filters, search, pagination, agent-nav, decision cards, or queue actions. Each row is static text.                                                                                                                            |
| Q8  | C2a delivers user-facing change   | Yes — global `H` halts from any editorial page; `?` opens the relocated HelpOverlay. Visible operator win independent of C2b.                                                                                                               |
| Q9  | HelpOverlay disposition           | Rewrite, not relocate. Body copy is editorial-register; shortcut list is `H`, `?`, `Esc` only.                                                                                                                                              |
| Q10 | `1` / `2` / `3` agent shortcuts   | Deferred. Agent homes are routes, not panels.                                                                                                                                                                                               |
| Q11 | Pip-anchored shortcut (e.g., `L`) | Deferred. Pip is clickable.                                                                                                                                                                                                                 |
| Q12 | Console tree deletion timing      | C2b. The grep audit in §2.7 confirmed no non-console-tree module imports outside the three known consumers retargeted in C2a.                                                                                                               |
| Q13 | Branch + spec filing              | New branch off `main`: `docs/live-signal-overlay-c2-spec`. One spec covers C2a + C2b; per-PR plans land separately.                                                                                                                         |
| Q14 | Middleware change timing          | Deferred to C2b. `/console` remains in `AUTH_PAGE_PREFIXES` + matcher through C2a so the redirect shim stays gated by the same auth boundary as today's page. C2b removes both entries alongside the route deletion.                        |
| Q15 | Audit ordering assumption         | Defensive. `LiveSignalPopover` sorts `entries` newest-first by `timestamp` before slicing to 10. Does not depend on upstream API ordering.                                                                                                  |
| Q16 | `EventRow` formatter origin       | Co-located fresh helpers inside `live-signal-popover.tsx` (or sibling `live-signal-helpers.ts`). May resemble `activity-trail.tsx`'s formatters but C2b creates them fresh, with zero import coupling on the retired tree.                  |

---

## 2. Architecture

### 2.1 Layer respect

All changes live in `apps/dashboard`. No edits to `packages/core`,
`packages/schemas`, `packages/db`, or `apps/api`. Per the layered dependency
rules in `CLAUDE.md`, this is purely a Layer-5 (apps) PR pair.

### 2.2 File layout — clusters and movers

**New `halt/` cluster (C2a):**

```
apps/dashboard/src/components/layout/halt/
  halt-context.tsx              ← relocated from components/console/halt-context.tsx
  halt-button-client.tsx        ← relocated from components/layout/halt-button-client.tsx
  __tests__/
    halt-context.test.tsx       ← relocated from components/console/__tests__/halt-context.test.tsx
```

`halt-context.tsx` is **relocated, not rewritten** — same `HaltProvider` +
`useHalt` exports, same `sb_halt_state` localStorage key, same semantics.
The `toggleHaltWithToast` helper stays exported through C2a (still imported
by the inert console tree); C2b deletes it during the tree sweep.

**Sibling layout-owned additions (C2a):**

```
apps/dashboard/src/components/layout/
  use-keyboard-shortcuts.ts     ← relocated as-is from components/console/
  help-overlay.tsx              ← rewritten (not relocated) for editorial register
  editorial-keys.tsx            ← NEW — global-shortcut + help-overlay binder
  __tests__/
    help-overlay.test.tsx       ← new
    editorial-keys.test.tsx     ← new
```

`editorial-keys.tsx` is the small client-component wrapper that calls
`useKeyboardShortcuts` and owns help-overlay open state. It is required
because `EditorialAuthShellInner` renders inside a server-component shell
and cannot call hooks directly. Sketch:

```tsx
"use client";
import { useState } from "react";
import { useKeyboardShortcuts } from "./use-keyboard-shortcuts";
import { useHalt } from "./halt/halt-context";
import { HelpOverlay } from "./help-overlay";

export function EditorialKeys() {
  const [helpOpen, setHelpOpen] = useState(false);
  const { toggleHalt } = useHalt();
  useKeyboardShortcuts({
    help: () => setHelpOpen((v) => !v),
    halt: toggleHalt,
    escape: () => setHelpOpen(false),
  });
  return helpOpen ? <HelpOverlay onClose={() => setHelpOpen(false)} /> : null;
}
```

It mounts inside `<HaltProvider>` in `EditorialAuthShellInner`. No chrome,
no rendered DOM unless help is open.

**New files (C2b):**

```
apps/dashboard/src/components/layout/
  live-signal-popover.tsx       ← new
  live-signal-popover.css       ← new (popover-scoped tokens)
  __tests__/
    live-signal-popover.test.tsx
```

Plus `apps/dashboard/src/components/ui/popover.tsx` if the Radix wrapper
does not already exist (verified during plan-write).

### 2.3 Provider topology

C2a relocates the `HaltProvider` _implementation_ into
`components/layout/halt/halt-context.tsx`. The old
`components/console/halt-context.tsx` becomes a temporary re-export shim
only. After C2a:

> There is exactly **one** real `HaltProvider` implementation in the
> codebase: `components/layout/halt/halt-context.tsx`. The shim at
> `components/console/halt-context.tsx` re-exports from it and contains no
> provider definition of its own.

This holds even though the dormant console tree still type-checks until
C2b deletion. "Authority cleanup" is literal — not merely runtime-true.

The `<HaltProvider>` rendered inside `<ConsoleView>` becomes irrelevant
the moment `/console` redirects, because `<ConsoleView>` is no longer
rendered anywhere. The duplicate-instance risk that drove the deferred
"Phase 2 lift" memory note is eliminated by construction.

### 2.4 Backwards-compat shim during C2a's lifespan

`components/console/halt-context.tsx` is reduced to a re-export shim in
C2a so the inert console tree still type-checks:

```ts
// Temporary C2a re-export shim — preserves type-check of the dormant
// console tree until C2b deletes the tree wholesale.
// Do not add new imports against this path.
export * from "@/components/layout/halt/halt-context";
```

C2b deletes the shim along with the rest of the tree.

### 2.5 Route + middleware changes

| File                                                | Change in C2a                                                                                                                                                                                                                                       | Change in C2b                                                    |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `app/(auth)/console/page.tsx`                       | Replaced with thin server component:<br>`// Temporary C2a compatibility shim.`<br>`// Delete in C2b when Live Signal Overlay lands.`<br>`import { redirect } from "next/navigation";`<br>`export default function ConsolePage() { redirect("/"); }` | Deleted (entire `app/(auth)/console/` directory)                 |
| `middleware.ts`                                     | **No change.** `/console` stays in `AUTH_PAGE_PREFIXES` (line 25) and matcher (line 131) so the redirect shim is gated by the same auth boundary as today's page.                                                                                   | Remove `/console` from both arrays alongside the route deletion. |
| `app/login/redirect-logic.ts`                       | `return "/console"` → `return "/"`. Update doc comment.                                                                                                                                                                                             | Unchanged                                                        |
| `app/post-auth/page.tsx`                            | Doc-comment touch-up: `/console` → `/`.                                                                                                                                                                                                             | Unchanged                                                        |
| `components/operator-chat/operator-chat-widget.tsx` | No change. The redirect path is technically still reachable for one PR.                                                                                                                                                                             | Remove `/console` from `HIDDEN_PATHS = ["/console"]`.            |

**Why middleware stays in C2a.** The `(auth)/layout.tsx` does _not_
perform an unauthenticated-user redirect. Auth gating lives entirely in
`middleware.ts:108-110`. Removing `/console` from middleware in C2a would
mean an unauthenticated request to `/console` skips middleware, hits the
redirect shim ungated, gets bounced to `/`, and is only then picked up by
middleware (which gates `/`). That two-hop flow is avoidable: keep
`/console` in middleware through C2a so the redirect shim is protected by
the same boundary as today's page; remove from middleware in C2b
alongside the route delete.

### 2.6 Console tree retirement plan (C2b)

C2b deletes:

- `app/(auth)/console/` — entire route, including the C2a redirect shim
- `components/console/` — entire tree (`console-view.tsx`, all `zones/*`,
  all `queue-cards/*`, `welcome-banner.tsx`, `use-welcome-banner.ts`,
  `toast-shelf.tsx`, `use-toast.tsx`, `console-data.ts`,
  `console-mappers.ts`, `console.css`, `help-overlay.tsx` (already
  rewritten and relocated by C2a — the original file dies here),
  `use-keyboard-shortcuts.ts` (already relocated; original dies here),
  `halt-context.tsx` (the C2a re-export shim dies here), all `__tests__/*`)
- `/console` entries in `middleware.ts` (`AUTH_PAGE_PREFIXES` + matcher)
- `/console` entry in `operator-chat-widget.tsx`'s `HIDDEN_PATHS`
- JSDoc references to `/console` in `hooks/use-approval-action.ts:15` and
  `hooks/use-escalation-reply.ts:17`

### 2.7 Spec-freeze grep audit

Performed 2026-05-08 against `docs/live-signal-overlay-c2-spec` HEAD.

```
$ git grep -n "/console" apps/dashboard/src/{hooks,lib,components}
  (excluding components/console/ and __tests__)

  components/operator-chat/operator-chat-widget.tsx:8 — HIDDEN_PATHS (C2b removal)
  hooks/use-approval-action.ts:15 — JSDoc comment (C2b cleanup)
  hooks/use-escalation-reply.ts:17 — JSDoc comment (C2b cleanup)
```

No runtime cache keys, navigation targets, or module imports outside the
console tree. The two hook hits are JSDoc comments listing surfaces, not
runtime paths.

```
$ git grep -n "@/components/console" apps/dashboard/src
  (excluding __tests__)

  app/(auth)/console/page.tsx:5 — replaced by redirect shim in C2a
  components/layout/halt-button-client.tsx:3 — retargeted in C2a
  components/layout/halt-provider-client.tsx:3 — file deleted in C2a
```

Three external module imports, all retargeted or deleted in C2a. The
re-export shim from §2.4 absorbs any remaining internal-tree imports
during C2a's lifespan.

### 2.8 Clean-boundary check

After C2b lands:

| Unit                                            | Single purpose                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| `components/layout/halt/halt-context.tsx`       | Source of truth for halted state (provider + hook). LocalStorage-backed.              |
| `components/layout/halt/halt-button-client.tsx` | Header halt-toggle button. Consumes `useHalt`.                                        |
| `components/layout/use-keyboard-shortcuts.ts`   | Pure utility: register `H` / `?` / `Esc` handlers; ignore editable targets.           |
| `components/layout/help-overlay.tsx`            | Modal listing global shortcuts, editorial copy.                                       |
| `components/layout/editorial-keys.tsx`          | Wire global shortcuts to `useHalt` and HelpOverlay state. No chrome.                  |
| `components/layout/live-signal-popover.tsx`     | Pip-anchored popover. Reads `useHalt` + `useAudit`. Read-only except for halt action. |
| `components/layout/editorial-auth-shell.tsx`    | Header chrome + provider mounts + child wrappers. Owns no behavior.                   |

Each unit has one job, communicates through a clean interface, and can be
tested independently.

---

## 3. Component shape & data flow (C2b)

### 3.1 Sketch

```tsx
"use client";
import { useState } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { useHalt } from "./halt/halt-context";
import { useAudit } from "@/hooks/use-audit";
import "./live-signal-popover.css";

const RECENT_LIMIT = 10;

export function LiveSignalPopover() {
  const [open, setOpen] = useState(false);
  const { halted, toggleHalt } = useHalt();
  const { data, isLoading, isError } = useAudit();

  const entries = (data?.entries ?? [])
    .slice() // don't mutate the React Query cache
    .sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""))
    .slice(0, RECENT_LIMIT);

  const stateLabel = halted ? "Halted" : "Live";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`live-pip${halted ? " halted" : ""}`}
          aria-label={`System ${stateLabel.toLowerCase()} — open live signal`}
          aria-expanded={open}
        >
          <span className="pulse" aria-hidden="true" />
          {stateLabel}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        role="dialog"
        aria-label="Live signal"
        className="live-popover"
        sideOffset={8}
      >
        <header className="live-popover-head">
          <span className={`status-dot${halted ? " halted" : ""}`} aria-hidden="true" />
          <span className="status-label font-display">System {stateLabel.toLowerCase()}</span>
          <button type="button" className="halt-action" onClick={toggleHalt} aria-pressed={halted}>
            {halted ? "Resume" : "Halt"}
          </button>
        </header>
        <section className="recent-events" aria-label="Recent activity">
          {isLoading && (
            <p className="muted-state">
              <em>Reading the trail…</em>
            </p>
          )}
          {isError && (
            <p className="muted-state">
              <em>Couldn't load activity.</em>
            </p>
          )}
          {!isLoading && !isError && entries.length === 0 && (
            <p className="muted-state">
              <em>Nothing to report.</em>
            </p>
          )}
          {!isLoading && !isError && entries.length > 0 && (
            <ul className="event-list">
              {entries.map((e) => (
                <EventRow key={e.id} entry={e} />
              ))}
            </ul>
          )}
        </section>
        <footer className="shortcut-hint">
          <kbd>?</kbd> shortcuts · <kbd>Esc</kbd> close
        </footer>
      </PopoverContent>
    </Popover>
  );
}
```

`<EventRow>` renders `time · agent · message` as static text — no `<a>`,
no `<button>`, no click handlers. It uses fresh co-located helpers
(`formatHHMM`, `agentTagFromActor`, `humanizeEventType`). The
implementations may _resemble_ the ones in the retired `activity-trail.tsx`
because the formatting need is the same, but C2b creates them fresh, with
zero import dependency on the console tree.

### 3.2 Popover primitive

`shadcn/ui` patterns are already established in the codebase (`Sheet`,
`Toaster`). The C2b plan verifies whether a `Popover` primitive exists at
`apps/dashboard/src/components/ui/popover.tsx`; if not, the plan adds a
thin Radix `@radix-ui/react-popover` wrapper following the existing Sheet
pattern. Flagged as a known unknown for plan-time verification, not a
spec-time blocker.

### 3.3 Data flow

One hook for state, one hook for activity, one cache entry each.

| Source          | Hook         | Existing | Cadence                               | Read-only?  |
| --------------- | ------------ | -------- | ------------------------------------- | ----------- |
| Halted state    | `useHalt()`  | Yes      | localStorage + React state            | No (toggle) |
| Recent activity | `useAudit()` | Yes      | Existing React Query refetch interval | Yes         |

No new hooks, no new API, no new polling. The popover takes the first 10
sorted entries from `useAudit()`.

`useAudit()` is called at the top of `LiveSignalPopover`, so the audit
query subscribes as soon as the editorial header renders, not only when
the popover opens. This is one additional existing-query subscription on
editorial pages — see §7 for the impact framing.

### 3.4 Action behavior

- The Halt button calls `toggleHalt()` from `useHalt`. No toast (locked).
- Visual feedback comes from the lockstep flip of:
  - Pip text (`Live` ↔ `Halted`)
  - Pip class (`.live-pip` ↔ `.live-pip.halted`)
  - Popover status dot (`.status-dot` ↔ `.status-dot.halted`)
  - Popover status label (`System live` ↔ `System halted`)
  - Halt button label (`Halt` ↔ `Resume`)
- All other content is read-only. Event rows render no link or button.

### 3.5 Close behavior

- Radix `Popover` defaults: `Esc` closes; click-outside closes; focus
  returns to trigger.
- No "auto-close after halt" pattern (unlike C1's auto-close-on-zero).
  Live mode's purpose is for the operator to _see_ the state flip, then
  close manually.
- Popover state lives in `useState` inside the component. Same
  self-contained-component principle as C1: no provider, no global
  control.

### 3.6 List states

| State                        | Copy                      | Notes                                                    |
| ---------------------------- | ------------------------- | -------------------------------------------------------- |
| Loading (no cached data)     | `Reading the trail…`      | Italic muted; matches C1's `Reading your inbox…` cadence |
| Error                        | `Couldn't load activity.` | Italic muted                                             |
| Empty (loaded, zero entries) | `Nothing to report.`      | Editorial register; succinct                             |
| Populated                    | `<ul>` of up to 10 rows   | Static rows; `time · agent · message`                    |

The status header (`System live` + Halt button) renders in **all** states
— even loading/error/empty — so the operator can always see and toggle
halt. The recent-events section is the only thing that switches between
empty/loading/error/list.

---

## 4. Visual + behavior spec

### 4.1 Trigger transformation

| Aspect          | Today (decorative)        | After C2b                                                                                                                        |
| --------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| DOM             | `<span class="live-pip">` | `<button class="live-pip">` (PopoverTrigger asChild)                                                                             |
| State coupling  | Static "Live"             | Dynamic from `useHalt()`: `Live` / `Halted`, plus `.halted` class                                                                |
| Pulse dot       | `<span class="pulse">`    | Same DOM node, same class. Halted state: pulse becomes a static dot via CSS (`.live-pip.halted .pulse { animation: none; ... }`) |
| `aria-label`    | none                      | `"System live — open live signal"` / `"System halted — open live signal"`                                                        |
| `aria-expanded` | none                      | reflects popover open state                                                                                                      |

**DOM-shape preservation rule.** The visual footprint of the pip in the
editorial header must not visibly shift between today and after C2b.
Test 1 in §5.2 protects this — same wrapper class, same children; the
button-vs-span swap is allowed but width / padding / font must match.

### 4.2 Popover chrome (editorial register)

- **Anchor:** `Live` pip in the editorial header
- **Side / align:** `bottom` / `end` (right-aligns under the pip; the pip
  is in the right cluster of the header)
- **Side offset:** `8px` from anchor
- **Width:** `~22rem` (mobile: `min(22rem, calc(100vw - 2rem))`)
- **Max-height:** `~28rem` with internal scroll for the events list. The
  status header + halt action + footer always remain visible; only the
  `<ul.event-list>` scrolls.
- **Background:** `--ambient-cream` (matches editorial shell)
- **Padding:** `p-4` (looser than `p-3`, tighter than C1's `p-6` —
  popover, not drawer)
- **Border / shadow:** `PopoverContent` defaults. Any added shadow must
  be subtle and drawer-scoped (`.live-popover` only); no global shadow
  tokens, no heavy chrome inconsistent with the editorial register.
- **Typography:** body inherits Inter; `status-label` uses `font-display`
  (Cormorant Garamond) to match editorial vocabulary; event rows use
  Inter at `text-xs` muted.

### 4.3 Halted-state visual

When `halted === true`:

- Pip text reads `Halted`; color shifts to a halted token; pulse dot
  loses animation.
- Popover header status dot fills with the halted token; label reads
  `System halted`.
- Halt button label reads `Resume`. No destructive coloring — Resume is
  the safe action when halted.

Editorial register is preserved across both states; halt is a tone shift,
not a different surface.

### 4.4 Polling & freshness

Inherits `useAudit()`'s existing React Query refetch cadence (configured
in `hooks/use-audit.ts`). The popover does not extend or override
polling. After `toggleHalt()`, no audit invalidation is needed — halt
does not author an audit event in v1.

### 4.5 Keyboard & a11y

- `Esc` closes (Radix default).
- Focus returns to the pip on close (Radix default).
- Pip is a real `<button>`, not a fake `<a>` or `<span>` — keyboard-
  accessible by default.
- `aria-expanded` on trigger toggles with open state.
- Halt button has `aria-pressed={halted}`.
- `<PopoverContent>` has `role="dialog"` and `aria-label="Live signal"`
  set explicitly — not relying on Radix Popover defaults.
- Event rows are `<li>` with full text content. No `aria-hidden`
  decorative bits inside row text.
- The decorative pulse dot is `aria-hidden="true"`.

### 4.6 Header layout invariant

After C2b lands, the editorial header right cluster is:

```
[ Live (popover) ]  [ Inbox (drawer from C1) ]  [ Halt button ]  [ Me chip ]
```

The Halt button stays in the header. The popover's halt action is a
_secondary_ affordance — useful when the operator opens the popover to
see state and decides to act there — but the header button remains the
primary halt control because it's faster (one click) and globally
visible.

This is a deliberate not-a-conflict: two halt controls, one source of
truth (`useHalt`), zero state divergence by construction.

---

## 5. Testing strategy

Tests live alongside the components they cover, mirroring C1.

### 5.1 C2a tests

#### Relocated

- `apps/dashboard/src/components/layout/halt/__tests__/halt-context.test.tsx`
  is relocated from `components/console/__tests__/halt-context.test.tsx`
  with import paths updated. **No semantic change.** Existing assertions
  on `useHalt` / `HaltProvider` / `toggleHaltWithToast` continue to
  apply.

#### New — `help-overlay.test.tsx`

1. Renders the editorial title (locked at copy-write time during plan).
2. Lists exactly three shortcuts in the keys section: `?`, `H`, `Esc`.
3. `Esc` keypress calls `onClose`.
4. Click on the backdrop closes; click on the card body does not close.
5. Focus is trapped inside the card while open (Tab cycles within;
   Shift+Tab from first focusable wraps to last).
6. Focus returns to the previously-focused element on close.

#### New — `editorial-keys.test.tsx`

7. `H` keypress with `EditorialKeys` mounted toggles halted state via
   `useHalt`.
8. `?` keypress opens the help overlay; second `?` closes it.
9. `Esc` keypress closes the help overlay if open.
10. Keypresses are ignored when target is an editable element
    (`input` / `textarea` / `contenteditable`) — verifies the wiring of
    `use-keyboard-shortcuts.ts`'s `isEditableTarget` guard.

#### Updated — `login-redirect.test.ts`

11. Post-login destination expectation flips from `/console` to `/`.

#### New — redirect shim

12. `apps/dashboard/src/app/(auth)/console/__tests__/redirect.test.ts`:
    The redirect shim is a server component. The test invokes the
    default export (does not just import it) and asserts that calling
    it triggers Next's `redirect("/")`. `next/navigation` is mocked.

### 5.2 C2b tests

`apps/dashboard/src/components/layout/__tests__/live-signal-popover.test.tsx`,
same vitest + React Testing Library pattern Slice B and C1 use. For
state tests, **open the popover through the actual trigger** so trigger
↔ Popover integration is exercised.

1. **Pip DOM contract preservation.** Render `LiveSignalPopover` with
   `halted=false` and audit data. Assert the trigger has class
   `live-pip`, contains `<span class="pulse">` and the literal text
   `Live`. Layout regression guard.
2. **Pip aria-label is state-aware.** `halted=false` →
   `"System live — open live signal"`; `halted=true` →
   `"System halted — open live signal"`.
3. **Halted visual class.** Render with `halted=true`; trigger has
   `live-pip halted`; in the opened popover, the status header has
   `status-dot halted`.
4. **Halt action toggles state.** Open popover; click `Halt`; assert
   `useHalt().halted` flips; pip text + popover label flip in lockstep.
5. **Resume action toggles state from halted.** Open with `halted=true`;
   click `Resume`; assert state flips back.
6. **Popover does not auto-close on halt.** Open; click `Halt`; assert
   popover is still open and now shows `Halted` + `Resume`. Inverse of
   C1's auto-close.
7. **Recent activity caps at 10.** Feed `useAudit` a mock with 25
   entries; assert exactly 10 `<li>` rendered.
8. **Loading state.** `isLoading=true`, no cached data; open; assert
   `Reading the trail…` renders. Status header + Halt button still
   render.
9. **Error state.** `isError=true`; open; assert `Couldn't load activity.`
   renders. Status header + Halt button still render.
10. **Empty state.** Loaded with `entries=[]`; open; assert
    `Nothing to report.` renders.
11. **Event rows are read-only structure.** Feed one entry; open; assert
    the rendered row is an `<li>` containing static text only — no
    descendant `<a>` or `<button>` elements. Do not assert against
    React handler attachment (not reliably inspectable).
12. **Esc closes the popover.** Open; press Esc; assert no element with
    `role="dialog"` is in the document. Verifies wrapper integration.
13. **Accessible name.** Open; assert the `role="dialog"` element has
    accessible name matching `Live signal` (set explicitly via
    `aria-label`).

### 5.3 Inspection-only acceptance

- **C2a:** `git grep "@/components/console" apps/dashboard/src` returns
  _only_ hits inside `components/console/` itself (the dormant tree
  referencing its own internals) plus the explicit re-export shim. No
  new external imports.
- **C2b:** `git grep -nE "components/console|/console" apps/dashboard/src`
  returns zero runtime/source references after the sweep. Any incidental
  hits (e.g. test snapshots, framework-generated path strings) must be
  explicitly reviewed in the PR.

### 5.4 Not tested in C2 (covered elsewhere or out of scope)

- `useAudit()` shape and refetch cadence — covered by existing audit
  hook tests.
- Radix Popover focus trap and click-outside — library guarantees, not
  retested at this layer.
- HelpOverlay's inner focus trap — covered by §5.1 #5.
- The pip's CSS `pulse` keyframes — visual, not a logic test.

---

## 6. PR plan

Two PRs, sequential. Each lands on `main` independently.

### 6.1 Branch plan

| Stage        | Branch                             | Off                         |
| ------------ | ---------------------------------- | --------------------------- |
| Spec + plans | `docs/live-signal-overlay-c2-spec` | `main`                      |
| C2a impl     | `feat/c2a-console-retirement`      | `main` after spec PR merges |
| C2b impl     | `feat/c2b-live-signal-overlay`     | `main` after C2a PR merges  |

Per `CLAUDE.md` branch doctrine: spec and plans land on `main` first;
implementation branches consume them.

### 6.2 PR-C2a — Console Retirement + Authority Cleanup

**Title:** `feat(dashboard): C2a — console retirement + authority cleanup`

#### Diff shape

| File                                                     | Lines (approx) | Change kind                                                           |
| -------------------------------------------------------- | -------------- | --------------------------------------------------------------------- |
| `components/layout/halt/halt-context.tsx`                | +90            | Relocated (semantically identical to console version)                 |
| `components/layout/halt/halt-button-client.tsx`          | +15            | Relocated; import paths updated                                       |
| `components/layout/halt/__tests__/halt-context.test.tsx` | +120           | Relocated; import paths updated                                       |
| `components/layout/use-keyboard-shortcuts.ts`            | +45            | Relocated as-is from `components/console/`                            |
| `components/layout/help-overlay.tsx`                     | +120           | Rewritten with editorial copy; H/?/Esc shortcuts only                 |
| `components/layout/editorial-keys.tsx`                   | +30            | New — global-shortcut + help-overlay binder                           |
| `components/layout/__tests__/help-overlay.test.tsx`      | +90            | New                                                                   |
| `components/layout/__tests__/editorial-keys.test.tsx`    | +110           | New                                                                   |
| `components/layout/editorial-auth-shell.tsx`             | ~3 changed     | Import path swap; `<EditorialKeys />` mounted inside `<HaltProvider>` |
| `components/layout/halt-button-client.tsx`               | -15            | Deleted (moved into `layout/halt/`)                                   |
| `components/layout/halt-provider-client.tsx`             | -3             | Deleted (1-line shim no longer needed)                                |
| `components/console/halt-context.tsx`                    | ~2             | Reduced to a re-export shim with TODO comment                         |
| `app/(auth)/console/page.tsx`                            | -10 / +5       | Replaced with server-component redirect shim + TODO                   |
| `app/(auth)/console/__tests__/redirect.test.ts`          | +30            | New                                                                   |
| `app/login/redirect-logic.ts`                            | ~2             | `/console` → `/`                                                      |
| `app/__tests__/login-redirect.test.ts`                   | ~2             | Updated expectation                                                   |
| `app/post-auth/page.tsx`                                 | ~1             | Doc-comment touch-up                                                  |

Net: ~500 added, ~30 deleted. Most additions are relocated lines, not
new logic.

#### Acceptance criteria

- All tests in §5.1 pass.
- `pnpm lint && pnpm typecheck && pnpm --filter @switchboard/dashboard test`
  clean.
- Visiting `/console` while logged in redirects to `/`.
- Visiting `/console` while logged out redirects to `/login` (middleware
  unchanged).
- On any editorial page (`/`, `/alex`, `/riley`), pressing `H` toggles
  halt globally; pressing `?` opens HelpOverlay; pressing `Esc` closes
  it.
- Login flow: post-login destination is `/` for onboarded users (was
  `/console`).
- `git grep "@/components/console"` outside `components/console/` returns
  zero results.
- The dormant console tree still type-checks (the re-export shim absorbs
  internal imports).

### 6.3 PR-C2b — Live Signal Overlay + Tree Deletion

**Title:** `feat(dashboard): C2b — live signal overlay + console tree retirement`

#### Diff shape

| File                                                       | Lines (approx) | Change kind                                                                       |
| ---------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------- |
| `components/ui/popover.tsx`                                | +80            | New (if absent) — Radix Popover wrapper following Sheet pattern                   |
| `components/layout/live-signal-popover.tsx`                | +180           | New                                                                               |
| `components/layout/live-signal-popover.css`                | +60            | New (popover-scoped tokens, halted-state styling)                                 |
| `components/layout/__tests__/live-signal-popover.test.tsx` | +280           | New                                                                               |
| `components/layout/editorial-auth-shell.tsx`               | ~2 changed     | Replace static `<span class="live-pip">…Live</span>` with `<LiveSignalPopover />` |
| `components/operator-chat/operator-chat-widget.tsx`        | -1             | Remove `/console` from `HIDDEN_PATHS`                                             |
| `app/(auth)/console/`                                      | -15            | Entire directory deleted (redirect shim included)                                 |
| `components/console/`                                      | ~-2000         | Entire tree deleted (zones, queue-cards, helpers, tests)                          |
| `middleware.ts`                                            | -2             | Remove `/console` from `AUTH_PAGE_PREFIXES` and matcher                           |
| `hooks/use-approval-action.ts`                             | ~1             | JSDoc: drop `/console` reference                                                  |
| `hooks/use-escalation-reply.ts`                            | ~1             | JSDoc: drop `/console` reference                                                  |

Net: ~600 added, ~2000+ deleted. Net negative by a large margin — the
cleanup is the point.

#### Acceptance criteria

- All tests in §5.2 pass.
- `pnpm lint && pnpm typecheck && pnpm --filter @switchboard/dashboard test`
  clean.
- `git grep -nE "components/console|/console" apps/dashboard/src` returns
  zero runtime/source references; any incidental hits (test snapshots,
  framework-generated path strings) are explicitly reviewed in the PR.
- Visiting `/console` returns Next's default 404 (no redirect, no shim).
- The pip in the editorial header is interactive; clicking it opens a
  popover anchored to it; popover content matches §3 + §4.
- Halt action inside the popover toggles state and the pip flips Live ↔
  Halted in lockstep, persisted across reload (localStorage
  `sb_halt_state`).
- Header layout: width / padding / visual rhythm of the right cluster
  (`Live ▸ Inbox ▸ Halt ▸ Me`) does not shift before/after C2b — visual
  smoke check on `/`, `/alex`, `/riley`.

### 6.4 Sequencing rules

- **C2a must merge before C2b is opened.** C2b assumes the relocated halt
  cluster, the global shortcuts, and the editorial HelpOverlay are
  already on `main`. Trying to land C2b first would re-create the
  duplicate-provider mess.
- **Spec lands first, on its own PR, off `main`.** No implementation
  branches accumulate planning docs. Per `CLAUDE.md` branch doctrine.
- **Memory note touch-up.** When C2a merges, update or remove
  `project_console_halt_state_phase2_lift.md` (the 5-day-old "lift
  HaltProvider" note). The lift happened — via relocation rather than a
  behavioral consolidation.

---

## 7. Risks + mitigations

| Risk                                                                                                                                                 | Impact                                                        | Mitigation                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useAudit()` upstream changes ordering (e.g., to oldest-first) and the popover preview renders stale events at the top                               | Operator looks at "recent activity" that isn't recent         | §3.1 sorts `entries` newest-first defensively before slicing. Test 7 in §5.2 covers the cap; ordering is not asserted in the test (the sort is the contract guard, not a test artifact)                                                                                            |
| `useAudit()` mounts with `LiveSignalPopover`, so the audit query subscribes as soon as the editorial header renders, not only when the popover opens | One additional existing-query subscription on editorial pages | C2b does not add a new endpoint or polling cadence; it reuses `useAudit()` exactly once. Acceptable for v1. If runtime cost becomes visible, a later PR can add an `enabled: open` option to `useAudit` without changing the popover API                                           |
| Removing `/console` from `middleware.ts` in C2b leaves a window where an authed user opens `/console` and sees a 404                                 | Brief muscle-memory friction                                  | C2b ships the popover _and_ the middleware cleanup in the same PR. The pip is now the canonical Live entry point. C2b release notes call out the deletion.                                                                                                                         |
| HelpOverlay focus-trap regression after rewrite                                                                                                      | Keyboard users escape the modal involuntarily                 | §5.1 #5 explicitly asserts focus trap. If the existing `FOCUSABLE_SELECTORS` constant + Tab interception pattern is preserved verbatim during rewrite, behavior is unchanged                                                                                                       |
| Two halt controls (header button + popover button) drift visually or label-wise                                                                      | Operator confusion ("does Halt mean different things?")       | Both controls bind to the same `useHalt()`. Visual styling: keep the header button's existing tokens; popover halt button uses an inline editorial style explicitly distinct (no destructive coloring). They're peers; one source of truth                                         |
| C2b deletion sweep removes a console-tree file that has an unaudited consumer outside the tree                                                       | Type error or runtime null after merge                        | Spec-freeze grep audit (§2.7) verified no external module imports beyond the three known ones. C2b's plan re-runs `git grep "@/components/console"` and `git grep "/console"` immediately before the delete commit and immediately after (must be zero outside the parent listing) |
| `ToastShelf` dropped → operators relying on halt-confirmation toast lose feedback                                                                    | Behavior change with no user-facing signal                    | Pip + popover lockstep flip is the confirmation. Acceptance criterion in §6.3 verifies the pip + popover lockstep flip. If user research surfaces toast demand later, a global toast layer can be re-added without touching halt — they're orthogonal                              |
| Memory note `project_console_halt_state_phase2_lift.md` not updated → future sessions act on stale "needs lifting" guidance                          | Wasted future agent effort                                    | §6.4 explicitly lists the memory note touch-up as a C2a merge step                                                                                                                                                                                                                 |

---

## 8. Out of scope (explicitly deferred)

| Item                                                          | Why deferred                                                       | Future track                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------ |
| Live = behavioral mode (gates other surfaces' behavior)       | Locked: Live is presentation only                                  | Not on roadmap                                   |
| `/activity` Mercury surface (full audit log, queryable)       | Phase D3 owns this                                                 | Phase D                                          |
| Toast layer in editorial register                             | Halt is reversible; pip + popover flip is sufficient               | Reconsider if user research surfaces demand      |
| `1` / `2` / `3` keyboard shortcuts to navigate to agent homes | Agent homes are routes, not panels; brand-nav links are fast       | Reconsider after user research                   |
| Pip-anchored shortcut (e.g., `L` to open Live)                | Pip is clickable; no v1 use case                                   | Future Phase C+                                  |
| Audit invalidation on halt toggle                             | Halt does not author an audit event in v1                          | If halt becomes server-backed, refetch on toggle |
| Per-agent filtering in popover preview                        | Live is system-wide; agent filtering is queryable-log territory    | Phase D `/activity`                              |
| Cross-page auto-close on halt                                 | Drawer auto-close (C1 pattern) doesn't apply; user closes manually | Not planned                                      |

---

## 9. References

- **Roadmap:** `docs/superpowers/specs/2026-05-03-agent-first-redesign-roadmap.md`
  (Phase C §4, ordering §6 — note that C2's roadmap line was authored
  before C1 was specced; this design supersedes the literal "lift
  `/console` into an overlay" reading)
- **C1 spec (sibling Phase C surface):**
  `docs/superpowers/specs/2026-05-08-inbox-drawer-c1-design.md` — locks
  the editorial register and the "right-side drawer for cross-agent
  triage" pattern. C2 deliberately does _not_ mirror that pattern; the
  popover is anchored to the pip, not a slab on the right.
- **Slice B spec (agent home):**
  `docs/superpowers/specs/2026-05-04-slice-b-agent-home-design.md` —
  header chrome ownership, the `Live` pip placement
- **Two-register doctrine:** memory `project_two_register_design.md` and
  roadmap §3
- **Existing implementations referenced:**
  - `apps/dashboard/src/components/layout/editorial-auth-shell.tsx` —
    header chrome and pip
  - `apps/dashboard/src/components/layout/halt-button-client.tsx` —
    header halt button (relocated in C2a)
  - `apps/dashboard/src/components/layout/halt-provider-client.tsx` —
    1-line re-export shim (deleted in C2a)
  - `apps/dashboard/src/components/console/halt-context.tsx` —
    HaltProvider source (relocated to `layout/halt/` in C2a; original
    becomes re-export shim, deleted in C2b)
  - `apps/dashboard/src/components/console/help-overlay.tsx` — console
    HelpOverlay (rewritten + relocated in C2a)
  - `apps/dashboard/src/components/console/use-keyboard-shortcuts.ts` —
    keyboard handler (relocated to `layout/` in C2a)
  - `apps/dashboard/src/components/console/console-view.tsx` and
    `zones/*` — retired wholesale in C2b
  - `apps/dashboard/src/hooks/use-audit.ts` — audit feed hook reused by
    the popover
  - `apps/dashboard/src/middleware.ts` — auth gating (kept through C2a;
    `/console` entries removed in C2b)
  - `apps/dashboard/src/app/login/redirect-logic.ts` — post-login
    destination (retargeted in C2a)
