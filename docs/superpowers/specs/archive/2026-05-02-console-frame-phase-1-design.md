# Console Redesign — Phase 1 (Frame)

**Status:** Draft
**Date:** 2026-05-02
**Scope:** `apps/dashboard/src/components/console/` — the chrome of `/console`: OpStrip, Welcome banner, Help overlay, Toast/Undo shelf, Halt toggle (visual-only), keyboard shortcuts. **Drops** the NumbersStrip.
**Amends:** [`2026-04-30-console-as-home-dashboard-design.md`](./2026-04-30-console-as-home-dashboard-design.md) — that spec specified a 5-cell numbers strip as zone 2; the design bundle the user finalized in claude.ai/design replaces that slot with a one-time Welcome banner. The five-zone Queue → Agents → Activity hierarchy is preserved; only the framing chrome changes.
**Defers:** Phase 2 (Queue inline interaction model, transcript reveal, fade-out resolve), Phase 3 (Agent expandable panels — Nova/Alex/Mira), Phase 4 (Activity filters + CTA-jump-to-queue + flash-on-new). Each gets its own spec under `docs/superpowers/specs/`.

## Background

The user iterated `/console` in claude.ai/design across six chats and finalized the layout in `switchboard/project/dashboard/Console.html` + `console.css` + `console-app.jsx` (the handoff bundle). The chat-6 summary documents the intent in the user's own words:

> _"Welcome banner with three numbered steps that scroll to each zone, dismissable (persists in localStorage). Help overlay (`?` button or key) explains agents and shortcuts. Section headers carry an inline hint... Keyboard: `?` help, `1/2/3` agent panels, `H` halt, `Esc` close. Halt toggle in the op strip flips Live → Halted; clock ticks live."_

The current `feat/console-preview` branch ships the four-zone shell and most of the CSS tokens (`apps/dashboard/src/components/console/console.css`, 968 lines, scoped under `[data-v6-console]`), the queue card primitives (`queue-cards.tsx`), and the `OpStrip` / `AgentStrip` / `ActivityTrail` / `NovaPanel` zone components. It does **not** ship the chrome surfaces above. The user's words: _"console UI UX and design is a far cry from what I designed"_ — the gap is mostly behavior + missing chrome surfaces, not styles.

## Goal

Ship the static frame around the console so that, after Phase 1 lands, an operator landing on `/console` for the first time sees:

1. A live-clock OpStrip with **Halt** and **? Help** controls and a pulse indicator that swaps to a dimmed dot when halted.
2. A dismissible **Welcome banner** above the queue with three smooth-scroll buttons that flash the target zone briefly.
3. A **Help overlay** triggered by `?` (or the Help button) explaining the agents and shortcut keys.
4. A bottom-center **Toast shelf** that the only Phase-1 action (Halt) fires undoable confirmations through.
5. Working keyboard shortcuts: `?` toggles help, `H` toggles halt, `Esc` closes overlays.

The NumbersStrip — currently between OpStrip and Queue — is removed from `/console`. The hook `useDashboardOverview` is preserved (other callers use it).

## Non-goals (deferred to later phases)

- Switching the queue interaction model from slide-over to inline (Phase 2).
- Inline transcript reveal on escalation cards (Phase 2).
- Fade-out resolve animation on queue cards (Phase 2).
- Agent strip click-to-expand (Phase 3).
- Full Nova ad-set table, Alex conv-list, Mira camp-list (Phase 3).
- Per-agent today-stats wired to real metrics (Phase 3).
- Activity filter buttons, CTA-jump-to-queue, flash-on-new (Phase 4).
- Wiring Halt to a real backend pause-all endpoint (Phase 2 — re-evaluated when "actions queued" copy needs to hold).
- Replacing the existing `slide-overs/` directory (Phase 2).

## Architecture

### State ownership

Phase 1 introduces three pieces of UI state. Each lives in a single hook so the surfaces that need it can subscribe without prop-drilling, and so test setup is one import per concern.

| Hook                 | Owns                                                      | Persisted?                          |
| -------------------- | --------------------------------------------------------- | ----------------------------------- |
| `useHaltState()`     | `halted: boolean`, `setHalted`, `toggleHalt`              | localStorage `sb_halt_state`        |
| `useWelcomeBanner()` | `dismissed: boolean`, `dismiss()`, `tour(stop)`           | localStorage `sb_welcome_dismissed` |
| `useToast()`         | `toast`, `showToast(...)`, `dismissToast()`, `undoLast()` | in-memory only                      |

`useHaltState` and `useWelcomeBanner` are simple `useState` + `useEffect` wrappers around `localStorage`. Both guard against SSR (`typeof window === "undefined"` early-return on read; lazy initial state).

`useToast` is exposed via a `<ToastProvider>` context wrapping `<ConsoleView>` so any Phase 2/3/4 surface can call `useToast().showToast({...})` without a new import contract. The hook returns:

```ts
type ToastState = {
  title: string;
  detail: string;
  undoable: boolean;
  onUndo?: () => void;
};
type UseToastReturn = {
  toast: ToastState | null;
  showToast: (t: ToastState) => void;
  dismissToast: () => void;
};
```

A 4500ms auto-dismiss timer lives inside the provider; `showToast` resets it. `dismissToast` clears it and the toast.

### Keyboard shortcuts

A single `useKeyboardShortcuts(handlers, options)` hook attaches one `keydown` listener to `window`. Handlers receive `{key, shiftKey, target}`. The hook returns nothing.

Phase-1 wiring:

- `?` (or `Shift+/`) → toggle help overlay
- `h` / `H` → toggle halt (fires undoable toast)
- `Escape` → close help overlay (Phase 3 will also collapse expanded agent panel)

Bail-out predicate: `target.tagName in {INPUT, TEXTAREA}` or `target.isContentEditable === true` → ignore. Keys `1/2/3` are reserved by Phase 3; the help card lists them as shortcuts but Phase 1 registers no handler.

### Tour scroll-and-flash

`tour(stop)` from `useWelcomeBanner` accepts `'queue' | 'agents' | 'activity'` and:

1. `document.querySelector(SELECTOR[stop])?.scrollIntoView({ behavior: 'smooth', block: 'start' })`.
2. Apply `.is-flashing` class on the target zone in the same tick (no delay needed — the CSS animation runs over ~1s while the smooth-scroll resolves; both effects align without timer coordination).
3. Remove the class after 1000ms via `setTimeout`.

The flash animation lives in CSS — `@keyframes zone-flash { from{box-shadow: inset 0 0 0 2px var(--c-coral)} to{box-shadow: inset 0 0 0 2px transparent} }` applied to the target zone for 1s. CSS only; no JS animation engine.

Selector map:

- `queue` → `section[aria-label="Queue"]`
- `agents` → `.zone3`
- `activity` → `.zone4`

(These selectors already exist in the current implementation — verified.)

## Components

### `OpStrip` — modified

Current `zones/op-strip.tsx` reads `useOrgConfig()` and renders brand · org · clock · static "Live" pill. Modifications:

- **Live clock** — replace static `formatNow(new Date())` with `useNow(15000)` matching the design (15s tick).
- **Pulse animation** — already in `console.css` (`.op-live .pulse::after`); current TSX sets `<span className="pulse" aria-hidden="true" />` correctly. **No change needed.**
- **Halted state** — when `halted`, swap `Live → Halted`, add `.halted` class on `.op-live` (CSS already styles this), pulse stops.
- **Help button** — `<button className="op-help">? Help</button>` triggers help overlay open.
- **Halt button** — `<button className="op-halt">Halt|Resume</button>` calls `toggleHalt()` and fires undoable toast.

Props: `onHelpOpen: () => void` (the help open state is owned by `ConsoleView`, see below). Halted state is read from `useHaltState()`; toasts are fired via `useToast()`. No other new props.

### `welcome-banner.tsx` — new

Renders the design's `.welcome` markup:

```tsx
<div className="welcome">
  <div className="welcome-icon">SB</div>
  <div className="welcome-body">
    <h2>Welcome to your Switchboard.</h2>
    <p>
      Three agents are running on your behalf. They handle routine work autonomously and surface
      here only when they need a decision. Anything in <b>Queue</b> below is waiting on you.
      Everything else is in motion.
    </p>
    <div className="welcome-tour">
      <button className="step" onClick={() => tour("queue")}>
        <b>1.</b> Decide what's in queue
      </button>
      <button className="step" onClick={() => tour("agents")}>
        <b>2.</b> Check what each agent is doing
      </button>
      <button className="step" onClick={() => tour("activity")}>
        <b>3.</b> Scan the activity trail
      </button>
    </div>
  </div>
  <button className="welcome-close" onClick={dismiss} aria-label="Dismiss welcome">
    Got it ✕
  </button>
</div>
```

Reads `dismissed` from `useWelcomeBanner()`; returns `null` when dismissed. Calls `tour()` for buttons. Calls `dismiss()` for close.

### `help-overlay.tsx` — new

Renders the design's `.overlay` + `.help-card` markup. Open state is local to `ConsoleView` (provider-level `helpOpen` would couple help to toast unnecessarily). Closes on:

- Backdrop click
- `Esc` key (via `useKeyboardShortcuts`)
- Close button click

Lists all four shortcuts (`?`, `1/2/3`, `H`, `Esc`) even though `1/2/3` are no-ops in Phase 1 — the help card describes the intent of the design, and the keys will work in Phase 3 without help-card edits.

### `toast-shelf.tsx` + `use-toast.ts` — new

`<ToastProvider>` provides context. `<ToastShelf />` reads context and renders the design's `.toast-shelf` + `.toast` markup at body bottom (no portal — the existing `console-view.tsx` already wraps everything; visual position uses `position: fixed`).

Markup mirrors `console-app.jsx::Toast`:

```tsx
<div className="toast-shelf">
  <div className="toast">
    <span>
      <b>{toast.title}</b> · {toast.detail}
    </span>
    {toast.undoable && (
      <button className="undo" onClick={onUndo}>
        Undo
      </button>
    )}
  </div>
</div>
```

### `use-halt-state.ts` — new

```ts
export function useHaltState() {
  const [halted, setHalted] = useState<boolean>(() => readLocal());
  useEffect(() => {
    writeLocal(halted);
  }, [halted]);
  return { halted, setHalted, toggleHalt: () => setHalted((v) => !v) };
}
```

`readLocal`/`writeLocal` are guarded by `typeof window` for SSR. localStorage key: `sb_halt_state` (`"1"`/`"0"`).

### `use-welcome-banner.ts` — new

```ts
export function useWelcomeBanner() {
  const [dismissed, setDismissed] = useState<boolean>(() => readLocal());
  const dismiss = () => {
    setDismissed(true);
    writeLocal(true);
  };
  const tour = (stop: "queue" | "agents" | "activity") => {
    /* scroll + flash */
  };
  return { dismissed, dismiss, tour };
}
```

localStorage key: `sb_welcome_dismissed` (`"1"`).

### `use-keyboard-shortcuts.ts` — new

```ts
type Handlers = Partial<Record<"help" | "halt" | "escape", () => void>>;
export function useKeyboardShortcuts(handlers: Handlers): void;
```

Single `useEffect` attaches/detaches `window.addEventListener("keydown", ...)`. Each named handler maps to a fixed key set:

- `help` → `'?'` or `Shift+'/'`
- `halt` → `'h'` or `'H'`
- `escape` → `'Escape'`

Bails out when target is INPUT, TEXTAREA, or `isContentEditable`.

### `console-view.tsx` — modified

```tsx
<ToastProvider>
  <div data-v6-console>
    <OpStrip onHelpOpen={() => setHelpOpen(true)} />
    <main className="console-main">
      <WelcomeBanner />        {/* removed: NumbersStrip */}
      <QueueZone ... />
      <AgentStrip />
      <NovaPanel />
      <ActivityTrail />
    </main>
    {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
    <ToastShelf />
  </div>
</ToastProvider>
```

`useKeyboardShortcuts({ help: () => setHelpOpen(v => !v), halt: ..., escape: () => setHelpOpen(false) })` lives at the `ConsoleView` level so it has access to all three.

## CSS

Most rules are already in `console.css` (Welcome, OpStrip pulse + halted, agent-strip hover, toast-shelf, overlay, help-card). Verified by grep. Additions for Phase 1:

- `[data-v6-console] .op-help`, `.op-halt`, `.op-halt.is-halted` (button styling — already in design's `console.css`, port if missing).
- `[data-v6-console] .welcome.dismissed { display: none }` (already there but verify the dismissal mechanism — Phase 1 returns `null` from React rather than relying on this class).
- `@keyframes zone-flash` for tour-flash effect — new.
- `.zone3.is-flashing`, `section[aria-label="Queue"].is-flashing`, `.zone4.is-flashing` apply the keyframe.

If any rule in the design's `console.css` is missing from the current scoped `console.css`, port it (prefix all selectors with `[data-v6-console]`). The OpStrip help/halt button rules are the most likely candidates.

## Removals

- `apps/dashboard/src/components/console/zones/numbers-strip.tsx` — delete.
- `apps/dashboard/src/components/console/zones/__tests__/numbers-strip.test.tsx` — delete.
- Import + `<NumbersStrip />` line in `console-view.tsx` — delete.
- The hook `useDashboardOverview` stays (other callers in `owner-today.tsx` and `use-console-data.ts`).
- `use-console-data.ts` itself is left alone — it's the Option-B composer for an alternate code path; out of Phase 1 scope.

## Tests

Each new module ships a co-located test (per CLAUDE.md). Vitest + React Testing Library.

| Module                        | Tests                                                                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `use-halt-state.ts`           | reads localStorage on mount, writes on change, toggleHalt flips state, SSR-safe (no `window` access at import)                                                    |
| `use-welcome-banner.ts`       | reads/writes localStorage, dismiss persists, tour calls `scrollIntoView` on the matching selector and applies `.is-flashing` immediately, removes it after 1000ms |
| `use-toast.ts`                | showToast sets state, 4500ms auto-dismiss, dismissToast clears it, undoable=false hides Undo button, undoable=true shows it and onUndo fires                      |
| `use-keyboard-shortcuts.ts`   | `?` triggers help handler, `H` triggers halt, `Escape` triggers escape, ignores when target is INPUT/TEXTAREA/contentEditable                                     |
| `welcome-banner.tsx`          | renders three step buttons, clicking step 1 calls tour('queue'), clicking close calls dismiss, returns null when dismissed=true                                   |
| `help-overlay.tsx`            | renders shortcut list, backdrop click calls onClose, close button calls onClose, lists all four shortcut groups                                                   |
| `toast-shelf.tsx`             | renders nothing when toast=null, renders title+detail, Undo button only when undoable=true, clicking Undo calls onUndo and dismisses                              |
| `op-strip.tsx` (modified)     | live clock present, halted state swaps "Live" → "Halted", clicking Halt calls toggleHalt + showToast({undoable:true}), Undo flips Halt back, ? Help opens overlay |
| `console-view.tsx` (modified) | renders WelcomeBanner above QueueZone (NOT NumbersStrip), ToastProvider wraps everything, keyboard shortcuts wired                                                |

The existing `__tests__/console-view.test.tsx` and `__tests__/console-view-halt.test.tsx` are updated to match the new shell. The existing `numbers-strip.test.tsx` is deleted with the component.

Coverage target: keep at the global 55/50/52/55 minimum (per CLAUDE.md). Phase 1 should comfortably exceed that on the new modules.

## Acceptance criteria

A reviewer running `pnpm dev` and opening `/console` for the first time sees:

1. ☐ OpStrip has live clock that ticks every ~15s.
2. ☐ OpStrip has a coral pulse next to "Live" that animates.
3. ☐ "? Help" button opens the help overlay; clicking the backdrop or `Esc` closes it.
4. ☐ "Halt" button changes the strip to a dimmed dot + "Halted" text + coral "Halt" → graphite "Resume". Clicking again restores. Halted state survives page reload.
5. ☐ Halt firing the toast — bottom-center pill says "**HALTED** · all agents halted — actions queued" with an Undo button. Clicking Undo restores Live and dismisses the toast. Auto-dismisses after 4.5s.
6. ☐ A first-time visitor sees the Welcome banner above the queue. Clicking "1. Decide what's in queue" smooth-scrolls to the Queue zone, which briefly shows a coral inset border.
7. ☐ Clicking "Got it ✕" hides the banner. Refreshing the page does not bring it back.
8. ☐ NumbersStrip is gone.
9. ☐ `pnpm --filter @switchboard/dashboard test` passes.
10. ☐ `pnpm --filter @switchboard/dashboard typecheck` passes.
11. ☐ `pnpm --filter @switchboard/dashboard lint` passes.
12. ☐ No file in `apps/dashboard/src/components/console/` exceeds 400 lines (per CLAUDE.md soft cap).

## Open questions

None at this time. Phases 2–4 will resolve their own scope when they're spec'd.

## Risks

- **localStorage key collision.** `sb_welcome_dismissed` and `sb_halt_state` are short. Mitigated by their `sb_` prefix.
- **Tour-flash animation visible to a user who hadn't asked for the tour** (e.g. hash-link to `/console#queue`). Mitigated: `is-flashing` class is only applied by the tour handler in `useWelcomeBanner`, never by route-level effects.
- **Help overlay z-index** must clear the OpStrip's sticky `z-index: 20` (current scoped value in `console.css`) — design's `.overlay` uses `z-index: 60` and `.toast-shelf` uses `z-index: 50`. Both are already in `console.css`; verify by inspection during code review, no spec change.
- **SSR.** All three hooks guard against missing `window`. Confirmed by `useEffect` deferral of any read that touches `localStorage`.

## Out-of-scope follow-ups (track when Phase 2 begins)

- The chat6 transcript references "Drafting pause on Whitening Ad Set B — approve in queue above ↑" that jumps to a queue card — that's Phase 3 (Nova panel) overlapping Phase 2 (queue card scroll-target IDs). Phase 2 should add stable `id="q-${cardId}"` attributes to queue cards for Phase 3 to scroll to.
- The activity row CTA to scroll-to queue (Phase 4) depends on the same scroll-target IDs.
- The Halt button currently fires a visual-only state. When Phase 2 lands, re-evaluate whether Halt should call a real org-wide pause endpoint — see Q2 in the brainstorming session for the three options considered.
