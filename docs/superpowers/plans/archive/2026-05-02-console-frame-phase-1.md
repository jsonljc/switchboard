# Console Frame Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the chrome of `/console` (OpStrip Halt+Help, Welcome banner, Help overlay, Toast/Undo, keyboard shortcuts, drop NumbersStrip) so the live screen matches the user's claude.ai/design handoff bundle.

**Architecture:** Three localStorage-backed hooks (`useHaltState`, `useWelcomeBanner`, `useToast` via `<ToastProvider>` context), four presentational components (`WelcomeBanner`, `HelpOverlay`, `ToastShelf`, modified `OpStrip`), one `useKeyboardShortcuts` hook bound at the `ConsoleView` level. All UI; zero backend changes. Halt is visual-only (Phase 2 re-evaluates the real pause endpoint).

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind (existing tokens via `console.css` scoped under `[data-v6-console]`), Vitest + React Testing Library + jest-dom matchers, jsdom environment.

**Spec:** [`docs/superpowers/specs/2026-05-02-console-frame-phase-1-design.md`](../specs/2026-05-02-console-frame-phase-1-design.md) (PR #350).

---

## Pre-flight (do this once before Task 1)

This plan is implemented on a feature branch off `main`, **not** on `feat/console-preview` (which carries unrelated WIP). Worktree pattern:

```bash
cd /Users/jasonli/switchboard
git fetch origin
git worktree add .worktrees/console-frame-phase-1 -b feat/console-frame-phase-1 origin/main
cd .worktrees/console-frame-phase-1
pnpm worktree:init
pnpm install   # only if .worktrees lockfile is stale
```

All file paths in this plan are relative to the worktree root.

---

## Task 1: CSS additions for tour-flash and OpStrip controls

**Goal:** Add the keyframe animation that the Welcome tour applies to target zones, and verify the OpStrip help/halt button rules are present in the scoped `console.css`. No JS changes.

**Files:**

- Modify: `apps/dashboard/src/components/console/console.css` (append rules at end)

- [ ] **Step 1: Inspect current CSS for the rules we need**

```bash
grep -n "op-help\|op-halt\|is-flashing\|zone-flash" apps/dashboard/src/components/console/console.css
```

Expected: `op-help`/`op-halt` rules already present (ported from design); `is-flashing`/`zone-flash` not present.

If `op-help`/`op-halt` are missing, port from the design's `console.css` lines 60-68 — prefix every selector with `[data-v6-console]`.

- [ ] **Step 2: Append tour-flash keyframe and target classes to `console.css`**

Append at the end of the file:

```css
/* ---------- Tour flash (applied transiently by useWelcomeBanner.tour()) ---------- */
[data-v6-console] section.is-flashing,
[data-v6-console] .zone3.is-flashing,
[data-v6-console] .zone4.is-flashing {
  animation: zone-flash 1000ms ease-out;
}

@keyframes zone-flash {
  from {
    box-shadow: inset 0 0 0 2px var(--c-coral);
  }
  to {
    box-shadow: inset 0 0 0 2px transparent;
  }
}
```

- [ ] **Step 3: Verify CSS parses (no test framework for CSS in this repo; use `pnpm typecheck` as a smoke proxy since the import survives)**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/console/console.css
git commit -m "style(console): add zone-flash keyframe for welcome tour highlight"
```

---

## Task 2: `useHaltState` hook (localStorage-backed)

**Goal:** A hook that reads/writes a halted boolean to localStorage under key `sb_halt_state`. SSR-safe.

**Files:**

- Create: `apps/dashboard/src/components/console/use-halt-state.ts`
- Test: `apps/dashboard/src/components/console/__tests__/use-halt-state.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/components/console/__tests__/use-halt-state.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useHaltState } from "../use-halt-state";

describe("useHaltState", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("starts halted=false when localStorage is empty", () => {
    const { result } = renderHook(() => useHaltState());
    expect(result.current.halted).toBe(false);
  });

  it("starts halted=true when localStorage has '1'", () => {
    window.localStorage.setItem("sb_halt_state", "1");
    const { result } = renderHook(() => useHaltState());
    expect(result.current.halted).toBe(true);
  });

  it("toggleHalt flips and persists the state", () => {
    const { result } = renderHook(() => useHaltState());
    act(() => result.current.toggleHalt());
    expect(result.current.halted).toBe(true);
    expect(window.localStorage.getItem("sb_halt_state")).toBe("1");
    act(() => result.current.toggleHalt());
    expect(result.current.halted).toBe(false);
    expect(window.localStorage.getItem("sb_halt_state")).toBe("0");
  });

  it("setHalted writes the explicit value to localStorage", () => {
    const { result } = renderHook(() => useHaltState());
    act(() => result.current.setHalted(true));
    expect(result.current.halted).toBe(true);
    expect(window.localStorage.getItem("sb_halt_state")).toBe("1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/dashboard test src/components/console/__tests__/use-halt-state.test.ts
```

Expected: FAIL with "Cannot find module '../use-halt-state'".

- [ ] **Step 3: Implement the hook**

Create `apps/dashboard/src/components/console/use-halt-state.ts`:

```ts
"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "sb_halt_state";

function readInitial(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function useHaltState() {
  const [halted, setHaltedState] = useState<boolean>(readInitial);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, halted ? "1" : "0");
    } catch {
      // localStorage may be unavailable (private mode, quota); fail silent
    }
  }, [halted]);

  const setHalted = useCallback((next: boolean) => setHaltedState(next), []);
  const toggleHalt = useCallback(() => setHaltedState((v) => !v), []);

  return { halted, setHalted, toggleHalt };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/dashboard test src/components/console/__tests__/use-halt-state.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/use-halt-state.ts apps/dashboard/src/components/console/__tests__/use-halt-state.test.ts
git commit -m "feat(console): add useHaltState hook with localStorage persistence"
```

---

## Task 3: `useWelcomeBanner` hook (dismiss + tour)

**Goal:** A hook that reads/writes `dismissed` to localStorage and exposes `tour(stop)` that smooth-scrolls to the matching zone selector and applies `.is-flashing` for 1000ms.

**Files:**

- Create: `apps/dashboard/src/components/console/use-welcome-banner.ts`
- Test: `apps/dashboard/src/components/console/__tests__/use-welcome-banner.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/components/console/__tests__/use-welcome-banner.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWelcomeBanner } from "../use-welcome-banner";

describe("useWelcomeBanner", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("starts dismissed=false when localStorage is empty", () => {
    const { result } = renderHook(() => useWelcomeBanner());
    expect(result.current.dismissed).toBe(false);
  });

  it("starts dismissed=true when localStorage has '1'", () => {
    window.localStorage.setItem("sb_welcome_dismissed", "1");
    const { result } = renderHook(() => useWelcomeBanner());
    expect(result.current.dismissed).toBe(true);
  });

  it("dismiss persists to localStorage", () => {
    const { result } = renderHook(() => useWelcomeBanner());
    act(() => result.current.dismiss());
    expect(result.current.dismissed).toBe(true);
    expect(window.localStorage.getItem("sb_welcome_dismissed")).toBe("1");
  });

  it("tour('queue') scrolls to section[aria-label=Queue] and flashes for 1000ms", () => {
    const queueSection = document.createElement("section");
    queueSection.setAttribute("aria-label", "Queue");
    queueSection.scrollIntoView = vi.fn();
    document.body.appendChild(queueSection);

    const { result } = renderHook(() => useWelcomeBanner());
    act(() => result.current.tour("queue"));

    expect(queueSection.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
    expect(queueSection.classList.contains("is-flashing")).toBe(true);

    act(() => vi.advanceTimersByTime(1000));
    expect(queueSection.classList.contains("is-flashing")).toBe(false);
  });

  it("tour('agents') targets .zone3", () => {
    const zone3 = document.createElement("section");
    zone3.className = "zone3";
    zone3.scrollIntoView = vi.fn();
    document.body.appendChild(zone3);

    const { result } = renderHook(() => useWelcomeBanner());
    act(() => result.current.tour("agents"));

    expect(zone3.scrollIntoView).toHaveBeenCalled();
    expect(zone3.classList.contains("is-flashing")).toBe(true);
  });

  it("tour('activity') targets .zone4", () => {
    const zone4 = document.createElement("section");
    zone4.className = "zone4";
    zone4.scrollIntoView = vi.fn();
    document.body.appendChild(zone4);

    const { result } = renderHook(() => useWelcomeBanner());
    act(() => result.current.tour("activity"));

    expect(zone4.scrollIntoView).toHaveBeenCalled();
    expect(zone4.classList.contains("is-flashing")).toBe(true);
  });

  it("tour() is a no-op if the target element is not in the DOM", () => {
    const { result } = renderHook(() => useWelcomeBanner());
    expect(() => act(() => result.current.tour("queue"))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/dashboard test src/components/console/__tests__/use-welcome-banner.test.ts
```

Expected: FAIL with "Cannot find module '../use-welcome-banner'".

- [ ] **Step 3: Implement the hook**

Create `apps/dashboard/src/components/console/use-welcome-banner.ts`:

```ts
"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "sb_welcome_dismissed";
const FLASH_DURATION_MS = 1000;

const SELECTORS: Record<TourStop, string> = {
  queue: 'section[aria-label="Queue"]',
  agents: ".zone3",
  activity: ".zone4",
};

export type TourStop = "queue" | "agents" | "activity";

function readInitial(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function useWelcomeBanner() {
  const [dismissed, setDismissed] = useState<boolean>(readInitial);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!dismissed) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore quota / private-mode failures
    }
  }, [dismissed]);

  const dismiss = useCallback(() => setDismissed(true), []);

  const tour = useCallback((stop: TourStop) => {
    if (typeof document === "undefined") return;
    const el = document.querySelector(SELECTORS[stop]);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("is-flashing");
    setTimeout(() => el.classList.remove("is-flashing"), FLASH_DURATION_MS);
  }, []);

  return { dismissed, dismiss, tour };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/dashboard test src/components/console/__tests__/use-welcome-banner.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/use-welcome-banner.ts apps/dashboard/src/components/console/__tests__/use-welcome-banner.test.ts
git commit -m "feat(console): add useWelcomeBanner hook with tour scroll-and-flash"
```

---

## Task 4: `useToast` hook + `<ToastProvider>` context

**Goal:** A React context that exposes `showToast`, `dismissToast`, `toast` state. 4500ms auto-dismiss timer. SSR-safe (timer logic only fires in `useEffect`).

**Files:**

- Create: `apps/dashboard/src/components/console/use-toast.tsx`
- Test: `apps/dashboard/src/components/console/__tests__/use-toast.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/components/console/__tests__/use-toast.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { ReactNode } from "react";
import { ToastProvider, useToast } from "../use-toast";

const wrapper = ({ children }: { children: ReactNode }) => (
  <ToastProvider>{children}</ToastProvider>
);

describe("useToast", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts with toast=null", () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    expect(result.current.toast).toBeNull();
  });

  it("showToast sets the toast state", () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => {
      result.current.showToast({
        title: "Halted",
        detail: "all agents halted",
        undoable: false,
      });
    });
    expect(result.current.toast).toEqual({
      title: "Halted",
      detail: "all agents halted",
      undoable: false,
    });
  });

  it("auto-dismisses after 4500ms", () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => result.current.showToast({ title: "X", detail: "Y", undoable: false }));
    expect(result.current.toast).not.toBeNull();
    act(() => vi.advanceTimersByTime(4499));
    expect(result.current.toast).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.toast).toBeNull();
  });

  it("dismissToast clears immediately and cancels the timer", () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => result.current.showToast({ title: "X", detail: "Y", undoable: false }));
    act(() => result.current.dismissToast());
    expect(result.current.toast).toBeNull();
    act(() => vi.advanceTimersByTime(10000));
    expect(result.current.toast).toBeNull();
  });

  it("preserves onUndo callback through state", () => {
    const onUndo = vi.fn();
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() =>
      result.current.showToast({
        title: "Halted",
        detail: "all agents halted",
        undoable: true,
        onUndo,
      }),
    );
    expect(result.current.toast?.onUndo).toBe(onUndo);
  });

  it("throws when used outside <ToastProvider>", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useToast())).toThrow(
      /useToast must be used within a ToastProvider/,
    );
    consoleError.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/dashboard test src/components/console/__tests__/use-toast.test.tsx
```

Expected: FAIL with "Cannot find module '../use-toast'".

- [ ] **Step 3: Implement the provider + hook**

Create `apps/dashboard/src/components/console/use-toast.tsx`:

```tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

const AUTO_DISMISS_MS = 4500;

export type ToastState = {
  title: string;
  detail: string;
  undoable: boolean;
  onUndo?: () => void;
};

type ToastContextValue = {
  toast: ToastState | null;
  showToast: (next: ToastState) => void;
  dismissToast: () => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const dismissToast = useCallback(() => {
    clearTimer();
    setToast(null);
  }, [clearTimer]);

  const showToast = useCallback(
    (next: ToastState) => {
      clearTimer();
      setToast(next);
      timerRef.current = setTimeout(() => {
        setToast(null);
        timerRef.current = null;
      }, AUTO_DISMISS_MS);
    },
    [clearTimer],
  );

  useEffect(() => clearTimer, [clearTimer]);

  return (
    <ToastContext.Provider value={{ toast, showToast, dismissToast }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/dashboard test src/components/console/__tests__/use-toast.test.tsx
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/use-toast.tsx apps/dashboard/src/components/console/__tests__/use-toast.test.tsx
git commit -m "feat(console): add useToast hook with 4.5s auto-dismiss and ToastProvider"
```

---

## Task 5: `useKeyboardShortcuts` hook

**Goal:** A hook that attaches one `keydown` listener to `window` and dispatches to named handlers (`help`, `halt`, `escape`). Ignores key events when target is INPUT, TEXTAREA, or contentEditable.

**Files:**

- Create: `apps/dashboard/src/components/console/use-keyboard-shortcuts.ts`
- Test: `apps/dashboard/src/components/console/__tests__/use-keyboard-shortcuts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/components/console/__tests__/use-keyboard-shortcuts.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboardShortcuts } from "../use-keyboard-shortcuts";

function fireKey(key: string, opts: KeyboardEventInit = {}, target?: Element) {
  const ev = new KeyboardEvent("keydown", { key, bubbles: true, ...opts });
  if (target) {
    Object.defineProperty(ev, "target", { value: target, writable: false });
  }
  window.dispatchEvent(ev);
}

describe("useKeyboardShortcuts", () => {
  it("calls help handler on '?'", () => {
    const help = vi.fn();
    renderHook(() => useKeyboardShortcuts({ help }));
    fireKey("?");
    expect(help).toHaveBeenCalledOnce();
  });

  it("calls help handler on Shift+/", () => {
    const help = vi.fn();
    renderHook(() => useKeyboardShortcuts({ help }));
    fireKey("/", { shiftKey: true });
    expect(help).toHaveBeenCalledOnce();
  });

  it("calls halt handler on 'h' and 'H'", () => {
    const halt = vi.fn();
    renderHook(() => useKeyboardShortcuts({ halt }));
    fireKey("h");
    fireKey("H");
    expect(halt).toHaveBeenCalledTimes(2);
  });

  it("calls escape handler on 'Escape'", () => {
    const escape = vi.fn();
    renderHook(() => useKeyboardShortcuts({ escape }));
    fireKey("Escape");
    expect(escape).toHaveBeenCalledOnce();
  });

  it("ignores keys when target is INPUT", () => {
    const help = vi.fn();
    renderHook(() => useKeyboardShortcuts({ help }));
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireKey("?", {}, input);
    expect(help).not.toHaveBeenCalled();
    input.remove();
  });

  it("ignores keys when target is TEXTAREA", () => {
    const help = vi.fn();
    renderHook(() => useKeyboardShortcuts({ help }));
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    fireKey("?", {}, ta);
    expect(help).not.toHaveBeenCalled();
    ta.remove();
  });

  it("ignores keys when target is contentEditable", () => {
    const help = vi.fn();
    renderHook(() => useKeyboardShortcuts({ help }));
    const div = document.createElement("div");
    div.contentEditable = "true";
    document.body.appendChild(div);
    fireKey("?", {}, div);
    expect(help).not.toHaveBeenCalled();
    div.remove();
  });

  it("does nothing for unbound keys", () => {
    const help = vi.fn();
    const halt = vi.fn();
    const escape = vi.fn();
    renderHook(() => useKeyboardShortcuts({ help, halt, escape }));
    fireKey("a");
    fireKey("1");
    expect(help).not.toHaveBeenCalled();
    expect(halt).not.toHaveBeenCalled();
    expect(escape).not.toHaveBeenCalled();
  });

  it("removes the listener on unmount", () => {
    const help = vi.fn();
    const { unmount } = renderHook(() => useKeyboardShortcuts({ help }));
    unmount();
    fireKey("?");
    expect(help).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/dashboard test src/components/console/__tests__/use-keyboard-shortcuts.test.ts
```

Expected: FAIL with "Cannot find module '../use-keyboard-shortcuts'".

- [ ] **Step 3: Implement the hook**

Create `apps/dashboard/src/components/console/use-keyboard-shortcuts.ts`:

```ts
"use client";

import { useEffect } from "react";

export type KeyboardShortcutHandlers = Partial<{
  help: () => void;
  halt: () => void;
  escape: () => void;
}>;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return true;
  if (target.isContentEditable) return true;
  return false;
}

export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;

      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        if (handlers.help) {
          e.preventDefault();
          handlers.help();
        }
        return;
      }
      if (e.key === "h" || e.key === "H") {
        if (handlers.halt) handlers.halt();
        return;
      }
      if (e.key === "Escape") {
        if (handlers.escape) handlers.escape();
        return;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handlers]);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/dashboard test src/components/console/__tests__/use-keyboard-shortcuts.test.ts
```

Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/use-keyboard-shortcuts.ts apps/dashboard/src/components/console/__tests__/use-keyboard-shortcuts.test.ts
git commit -m "feat(console): add useKeyboardShortcuts hook for ?, H, Esc"
```

---

## Task 6: `ToastShelf` component

**Goal:** Render the toast pill at bottom-center. Reads from `useToast()`. Renders nothing when `toast === null`. Shows Undo button when `undoable=true`; clicking Undo calls `onUndo` (if provided) and dismisses.

**Files:**

- Create: `apps/dashboard/src/components/console/toast-shelf.tsx`
- Test: `apps/dashboard/src/components/console/__tests__/toast-shelf.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/components/console/__tests__/toast-shelf.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider, useToast } from "../use-toast";
import { ToastShelf } from "../toast-shelf";

function Harness() {
  const { showToast } = useToast();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          showToast({
            title: "Halted",
            detail: "all agents halted — actions queued",
            undoable: true,
            onUndo: () => undoSpy(),
          })
        }
      >
        fire
      </button>
      <button
        type="button"
        onClick={() => showToast({ title: "Saved", detail: "draft", undoable: false })}
      >
        fire-no-undo
      </button>
      <ToastShelf />
    </>
  );
}

const undoSpy = vi.fn();

describe("ToastShelf", () => {
  beforeEach(() => {
    undoSpy.mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("renders nothing when no toast is active", () => {
    render(
      <ToastProvider>
        <ToastShelf />
      </ToastProvider>,
    );
    expect(screen.queryByText(/halted/i)).not.toBeInTheDocument();
  });

  it("renders title and detail when a toast is fired", () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText("fire").click();
    });
    expect(screen.getByText("Halted")).toBeInTheDocument();
    expect(screen.getByText(/all agents halted — actions queued/i)).toBeInTheDocument();
  });

  it("renders Undo button only when undoable=true", () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText("fire").click();
    });
    expect(screen.getByRole("button", { name: /undo/i })).toBeInTheDocument();

    act(() => screen.getByText("fire-no-undo").click());
    expect(screen.queryByRole("button", { name: /undo/i })).not.toBeInTheDocument();
  });

  it("clicking Undo calls onUndo and dismisses the toast", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText("fire").click();
    });
    await user.click(screen.getByRole("button", { name: /undo/i }));
    expect(undoSpy).toHaveBeenCalledOnce();
    expect(screen.queryByText("Halted")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/dashboard test src/components/console/__tests__/toast-shelf.test.tsx
```

Expected: FAIL with "Cannot find module '../toast-shelf'".

- [ ] **Step 3: Implement the component**

Create `apps/dashboard/src/components/console/toast-shelf.tsx`:

```tsx
"use client";

import { useToast } from "./use-toast";

export function ToastShelf() {
  const { toast, dismissToast } = useToast();
  if (!toast) return null;

  const handleUndo = () => {
    toast.onUndo?.();
    dismissToast();
  };

  return (
    <div className="toast-shelf">
      <div className="toast">
        <span>
          <b>{toast.title}</b> · {toast.detail}
        </span>
        {toast.undoable && (
          <button className="undo" type="button" onClick={handleUndo}>
            Undo
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/dashboard test src/components/console/__tests__/toast-shelf.test.tsx
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/toast-shelf.tsx apps/dashboard/src/components/console/__tests__/toast-shelf.test.tsx
git commit -m "feat(console): add ToastShelf bottom-center pill with Undo"
```

---

## Task 7: `WelcomeBanner` component

**Goal:** Render the design's `.welcome` markup. Reads `dismissed`/`dismiss`/`tour` from `useWelcomeBanner()`. Returns `null` when dismissed.

**Files:**

- Create: `apps/dashboard/src/components/console/welcome-banner.tsx`
- Test: `apps/dashboard/src/components/console/__tests__/welcome-banner.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/components/console/__tests__/welcome-banner.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WelcomeBanner } from "../welcome-banner";

describe("WelcomeBanner", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = "";
  });

  it("renders heading + 3 step buttons + close button when not dismissed", () => {
    render(<WelcomeBanner />);
    expect(
      screen.getByRole("heading", { name: /welcome to your switchboard/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /1\..*decide what's in queue/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /2\..*check what each agent is doing/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /3\..*scan the activity trail/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dismiss welcome/i })).toBeInTheDocument();
  });

  it("renders nothing once dismissed (localStorage already set)", () => {
    window.localStorage.setItem("sb_welcome_dismissed", "1");
    const { container } = render(<WelcomeBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("clicking close persists dismissal and unmounts the banner", async () => {
    const user = userEvent.setup();
    render(<WelcomeBanner />);
    await user.click(screen.getByRole("button", { name: /dismiss welcome/i }));
    expect(window.localStorage.getItem("sb_welcome_dismissed")).toBe("1");
    expect(
      screen.queryByRole("heading", { name: /welcome to your switchboard/i }),
    ).not.toBeInTheDocument();
  });

  it("clicking step 1 scrolls Queue section into view", async () => {
    const user = userEvent.setup();
    const queue = document.createElement("section");
    queue.setAttribute("aria-label", "Queue");
    queue.scrollIntoView = vi.fn();
    document.body.appendChild(queue);
    render(<WelcomeBanner />);
    await user.click(screen.getByRole("button", { name: /1\..*decide what's in queue/i }));
    expect(queue.scrollIntoView).toHaveBeenCalled();
    expect(queue.classList.contains("is-flashing")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/dashboard test src/components/console/__tests__/welcome-banner.test.tsx
```

Expected: FAIL with "Cannot find module '../welcome-banner'".

- [ ] **Step 3: Implement the component**

Create `apps/dashboard/src/components/console/welcome-banner.tsx`:

```tsx
"use client";

import { useWelcomeBanner } from "./use-welcome-banner";

export function WelcomeBanner() {
  const { dismissed, dismiss, tour } = useWelcomeBanner();
  if (dismissed) return null;

  return (
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
          <button type="button" className="step" onClick={() => tour("queue")}>
            <b>1.</b> Decide what's in queue
          </button>
          <button type="button" className="step" onClick={() => tour("agents")}>
            <b>2.</b> Check what each agent is doing
          </button>
          <button type="button" className="step" onClick={() => tour("activity")}>
            <b>3.</b> Scan the activity trail
          </button>
        </div>
      </div>
      <button
        type="button"
        className="welcome-close"
        onClick={dismiss}
        aria-label="Dismiss welcome"
      >
        Got it ✕
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/dashboard test src/components/console/__tests__/welcome-banner.test.tsx
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/welcome-banner.tsx apps/dashboard/src/components/console/__tests__/welcome-banner.test.tsx
git commit -m "feat(console): add WelcomeBanner with 3-step tour"
```

---

## Task 8: `HelpOverlay` component

**Goal:** Modal explaining agents and shortcuts. Closes on backdrop click or close button. The `Esc` key closes via the parent's `useKeyboardShortcuts` (Task 10), not from inside this component.

**Files:**

- Create: `apps/dashboard/src/components/console/help-overlay.tsx`
- Test: `apps/dashboard/src/components/console/__tests__/help-overlay.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/components/console/__tests__/help-overlay.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HelpOverlay } from "../help-overlay";

describe("HelpOverlay", () => {
  it("renders the heading and shortcut groups", () => {
    render(<HelpOverlay onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /how switchboard works/i })).toBeInTheDocument();
    expect(screen.getByText("?")).toBeInTheDocument();
    expect(screen.getByText("1 / 2 / 3")).toBeInTheDocument();
    expect(screen.getByText("H")).toBeInTheDocument();
    expect(screen.getByText("Esc")).toBeInTheDocument();
  });

  it("clicking the close button calls onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<HelpOverlay onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clicking the backdrop calls onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(<HelpOverlay onClose={onClose} />);
    const overlay = container.querySelector(".overlay");
    expect(overlay).not.toBeNull();
    await user.click(overlay!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clicking inside the help-card does NOT call onClose (event stopped)", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<HelpOverlay onClose={onClose} />);
    await user.click(screen.getByRole("heading", { name: /how switchboard works/i }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/dashboard test src/components/console/__tests__/help-overlay.test.tsx
```

Expected: FAIL with "Cannot find module '../help-overlay'".

- [ ] **Step 3: Implement the component**

Create `apps/dashboard/src/components/console/help-overlay.tsx`:

```tsx
"use client";

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="help-card" onClick={(e) => e.stopPropagation()}>
        <div className="head-row">
          <h2>How Switchboard works</h2>
          <button type="button" className="close" onClick={onClose}>
            Close ✕
          </button>
        </div>
        <p>
          Three agents work on your behalf around the clock. <b>Alex</b> handles inbound
          conversations, <b>Nova</b> manages ad spend, and <b>Mira</b> develops creative. They act
          on their own — and stop to ask only when judgment is needed.
        </p>
        <p>
          The <b>Queue</b> at the top is the only thing that needs you. The <b>Agent strip</b> below
          it shows what each one is doing right now. The <b>Activity trail</b> at the bottom is the
          running record.
        </p>
        <div className="keys">
          <kbd>?</kbd>
          <span>Open this help</span>
          <kbd>1 / 2 / 3</kbd>
          <span>Open Alex / Nova / Mira panel</span>
          <kbd>H</kbd>
          <span>Halt or resume all agents</span>
          <kbd>Esc</kbd>
          <span>Close panels & overlays</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/dashboard test src/components/console/__tests__/help-overlay.test.tsx
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/help-overlay.tsx apps/dashboard/src/components/console/__tests__/help-overlay.test.tsx
git commit -m "feat(console): add HelpOverlay with shortcut reference"
```

---

## Task 9: Modify `OpStrip` — Halt + Help buttons, halted state, 15s clock, toast wiring

**Goal:** Extend the existing `OpStrip` to match the design: live clock that ticks every 15s, halted state styling, Halt button (fires undoable toast), Help button (calls `onHelpOpen` prop).

**Files:**

- Modify: `apps/dashboard/src/components/console/zones/op-strip.tsx`
- Modify: `apps/dashboard/src/components/console/zones/__tests__/op-strip.test.tsx`

- [ ] **Step 1: Replace the existing OpStrip test with the new contract**

Overwrite `apps/dashboard/src/components/console/zones/__tests__/op-strip.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { OpStrip } from "../op-strip";
import { ToastProvider } from "../../use-toast";

vi.mock("@/hooks/use-org-config");

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>
  );
}

function mockOrgConfig(name = "Aurora Dental") {
  return import("@/hooks/use-org-config").then((mod) => {
    vi.mocked(mod.useOrgConfig).mockReturnValue({
      data: {
        config: {
          id: "org-1",
          name,
          runtimeType: "default",
          runtimeConfig: {},
          governanceProfile: "default",
          onboardingComplete: true,
          managedChannels: [],
          provisioningStatus: "active",
        },
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never);
  });
}

describe("OpStrip", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());

  it("renders skeleton while loading", async () => {
    const mod = await import("@/hooks/use-org-config");
    vi.mocked(mod.useOrgConfig).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    } as never);
    render(wrap(<OpStrip onHelpOpen={vi.fn()} />));
    expect(screen.getByLabelText(/loading op strip/i)).toBeInTheDocument();
  });

  it("renders error with retry on hook error", async () => {
    const mod = await import("@/hooks/use-org-config");
    vi.mocked(mod.useOrgConfig).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("boom"),
      refetch: vi.fn(),
    } as never);
    render(wrap(<OpStrip onHelpOpen={vi.fn()} />));
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders org name, Live status, Halt button, Help button when loaded", async () => {
    await mockOrgConfig("Aurora Dental");
    render(wrap(<OpStrip onHelpOpen={vi.fn()} />));
    expect(screen.getByText("Aurora Dental")).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /halt/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /\? help/i })).toBeInTheDocument();
  });

  it("clicking Halt swaps Live → Halted and fires undoable toast", async () => {
    await mockOrgConfig();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(wrap(<OpStrip onHelpOpen={vi.fn()} />));
    await user.click(screen.getByRole("button", { name: "Halt" }));
    expect(screen.getByText("Halted")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
    expect(window.localStorage.getItem("sb_halt_state")).toBe("1");
    expect(screen.getByText(/all agents halted/i)).toBeInTheDocument();
  });

  it("clicking Resume from halted state restores Live", async () => {
    window.localStorage.setItem("sb_halt_state", "1");
    await mockOrgConfig();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(wrap(<OpStrip onHelpOpen={vi.fn()} />));
    expect(screen.getByText("Halted")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Resume" }));
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(window.localStorage.getItem("sb_halt_state")).toBe("0");
  });

  it("Undo on the halt toast restores the previous halted state", async () => {
    await mockOrgConfig();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(wrap(<OpStrip onHelpOpen={vi.fn()} />));
    await user.click(screen.getByRole("button", { name: "Halt" }));
    expect(screen.getByText("Halted")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /undo/i }));
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("clicking Help calls onHelpOpen", async () => {
    await mockOrgConfig();
    const onHelpOpen = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(wrap(<OpStrip onHelpOpen={onHelpOpen} />));
    await user.click(screen.getByRole("button", { name: /\? help/i }));
    expect(onHelpOpen).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails (existing OpStrip lacks new props/behaviors)**

```bash
pnpm --filter @switchboard/dashboard test src/components/console/zones/__tests__/op-strip.test.tsx
```

Expected: multiple FAILs (no Halt button, no Help button, etc.).

- [ ] **Step 3: Rewrite `op-strip.tsx`**

Overwrite `apps/dashboard/src/components/console/zones/op-strip.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useOrgConfig } from "@/hooks/use-org-config";
import { useHaltState } from "../use-halt-state";
import { useToast } from "../use-toast";
import { ZoneSkeleton, ZoneError } from "./zone-states";

const CLOCK_TICK_MS = 15_000;

function fmtClock(d: Date): string {
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

function fmtDate(d: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate().toString().padStart(2, "0")}`;
}

function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function OpStrip({ onHelpOpen }: { onHelpOpen: () => void }) {
  const { data, isLoading, error, refetch } = useOrgConfig();
  const { halted, toggleHalt, setHalted } = useHaltState();
  const { showToast } = useToast();
  const now = useNow(CLOCK_TICK_MS);

  if (isLoading) return <ZoneSkeleton label="Loading op strip" />;
  if (error) return <ZoneError message="Couldn't load org config." onRetry={() => refetch()} />;

  const orgName = data?.config?.name ?? "Switchboard";

  const handleHaltClick = () => {
    const wasHalted = halted;
    toggleHalt();
    showToast({
      title: wasHalted ? "Resumed" : "Halted",
      detail: wasHalted ? "All agents resumed." : "all agents halted — actions queued",
      undoable: true,
      onUndo: () => setHalted(wasHalted),
    });
  };

  return (
    <header className="opstrip">
      <div className="opstrip-row">
        <div className="op-left">
          <span className="brand">Switchboard</span>
          <span className="sep">·</span>
          <span className="org">{orgName}</span>
          <span className="sep">·</span>
          <span>
            {fmtDate(now)} · <time>{fmtClock(now)}</time>
          </span>
        </div>
        <div className="op-right">
          <span className={`op-live${halted ? " halted" : ""}`}>
            <span className="pulse" aria-hidden="true" />
            {halted ? "Halted" : "Live"}
          </span>
          <button
            type="button"
            className="op-help"
            onClick={onHelpOpen}
            title="Keyboard shortcuts (?)"
          >
            ? Help
          </button>
          <button
            type="button"
            className={`op-halt${halted ? " is-halted" : ""}`}
            onClick={handleHaltClick}
            title={halted ? "Resume autonomous agents" : "Pause all autonomous agent actions"}
          >
            {halted ? "Resume" : "Halt"}
          </button>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @switchboard/dashboard test src/components/console/zones/__tests__/op-strip.test.tsx
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/zones/op-strip.tsx apps/dashboard/src/components/console/zones/__tests__/op-strip.test.tsx
git commit -m "feat(console): OpStrip Halt + Help buttons, halted state, 15s live clock"
```

---

## Task 10: Modify `console-view.tsx` — wire ToastProvider, WelcomeBanner, HelpOverlay, keyboard shortcuts; remove NumbersStrip

**Goal:** Compose all Phase-1 surfaces inside `ConsoleView`. Remove the `NumbersStrip` import and usage. Wrap the entire view in `<ToastProvider>` and add `<ToastShelf />`. Render `<WelcomeBanner />` above `QueueZone`. Add help-open state and `<HelpOverlay />`. Wire `useKeyboardShortcuts`. Replace the existing `console-view-halt.test.tsx` (which asserts the Halt button is NOT present — Phase 1 reverses that decision) with a new `console-view.test.tsx`.

**Files:**

- Modify: `apps/dashboard/src/components/console/console-view.tsx`
- Delete: `apps/dashboard/src/components/console/__tests__/console-view-halt.test.tsx` (its DC-41 deferral assertion is no longer correct)
- Create: `apps/dashboard/src/components/console/__tests__/console-view.test.tsx`

- [ ] **Step 1: Delete the old halt-deferral test**

```bash
git rm apps/dashboard/src/components/console/__tests__/console-view-halt.test.tsx
```

- [ ] **Step 2: Write the new console-view test (creates the file from scratch)**

Create `apps/dashboard/src/components/console/__tests__/console-view.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ConsoleView } from "../console-view";

vi.mock("@/hooks/use-org-config");
vi.mock("@/hooks/use-dashboard-overview");
vi.mock("@/hooks/use-escalations");
vi.mock("@/hooks/use-approvals");
vi.mock("@/hooks/use-agents");
vi.mock("@/hooks/use-module-status");
vi.mock("@/hooks/use-audit");

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

async function mockAllZoneHooks() {
  // Org loaded so OpStrip renders past skeleton.
  const orgMod = await import("@/hooks/use-org-config");
  vi.mocked(orgMod.useOrgConfig).mockReturnValue({
    data: {
      config: {
        id: "org-1",
        name: "Aurora Dental",
        runtimeType: "default",
        runtimeConfig: {},
        governanceProfile: "default",
        onboardingComplete: true,
        managedChannels: [],
        provisioningStatus: "active",
      },
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  } as never);

  // Other zones can stay loading — Phase 1 only asserts on chrome.
  const loading = { data: undefined, isLoading: true, error: null, refetch: vi.fn() };
  const overviewMod = await import("@/hooks/use-dashboard-overview");
  vi.mocked(overviewMod.useDashboardOverview).mockReturnValue(loading as never);
  const escMod = await import("@/hooks/use-escalations");
  vi.mocked(escMod.useEscalations).mockReturnValue(loading as never);
  const apMod = await import("@/hooks/use-approvals");
  vi.mocked(apMod.useApprovals).mockReturnValue(loading as never);
  const agentsMod = await import("@/hooks/use-agents");
  vi.mocked(agentsMod.useAgentRoster).mockReturnValue(loading as never);
  vi.mocked(agentsMod.useAgentState).mockReturnValue(loading as never);
  const modulesMod = await import("@/hooks/use-module-status");
  vi.mocked(modulesMod.useModuleStatus).mockReturnValue(loading as never);
  const auditMod = await import("@/hooks/use-audit");
  vi.mocked(auditMod.useAudit).mockReturnValue(loading as never);
}

describe("ConsoleView (Phase 1 frame)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());

  it("does NOT render NumbersStrip", async () => {
    await mockAllZoneHooks();
    render(wrap(<ConsoleView />));
    expect(screen.queryByLabelText(/today's numbers/i)).not.toBeInTheDocument();
  });

  it("renders the Halt button (Phase 1 reverses DC-41 deferral)", async () => {
    await mockAllZoneHooks();
    render(wrap(<ConsoleView />));
    expect(screen.getByRole("button", { name: "Halt" })).toBeInTheDocument();
  });

  it("renders the WelcomeBanner above the Queue when not dismissed", async () => {
    await mockAllZoneHooks();
    render(wrap(<ConsoleView />));
    expect(
      screen.getByRole("heading", { name: /welcome to your switchboard/i }),
    ).toBeInTheDocument();
  });

  it("hides the WelcomeBanner when localStorage flag is set", async () => {
    window.localStorage.setItem("sb_welcome_dismissed", "1");
    await mockAllZoneHooks();
    render(wrap(<ConsoleView />));
    expect(
      screen.queryByRole("heading", { name: /welcome to your switchboard/i }),
    ).not.toBeInTheDocument();
  });

  it("? key opens the HelpOverlay; Esc closes it", async () => {
    await mockAllZoneHooks();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(wrap(<ConsoleView />));
    await user.keyboard("?");
    expect(screen.getByRole("heading", { name: /how switchboard works/i })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("heading", { name: /how switchboard works/i }),
    ).not.toBeInTheDocument();
  });

  it("H key toggles halt and fires a toast", async () => {
    await mockAllZoneHooks();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(wrap(<ConsoleView />));
    await user.keyboard("h");
    expect(screen.getByText("Halted")).toBeInTheDocument();
    expect(screen.getByText(/all agents halted/i)).toBeInTheDocument();
  });

  it("clicking Help button opens overlay; clicking close button closes it", async () => {
    await mockAllZoneHooks();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(wrap(<ConsoleView />));
    await user.click(screen.getByRole("button", { name: /\? help/i }));
    expect(screen.getByRole("heading", { name: /how switchboard works/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(
      screen.queryByRole("heading", { name: /how switchboard works/i }),
    ).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
pnpm --filter @switchboard/dashboard test src/components/console/__tests__/console-view.test.tsx
```

Expected: FAILs (NumbersStrip still imported; no WelcomeBanner; no Halt button; ? key has no effect).

- [ ] **Step 4: Rewrite `console-view.tsx`**

Overwrite `apps/dashboard/src/components/console/console-view.tsx`:

```tsx
"use client";

import "./console.css";
import { useState } from "react";
import { OpStrip } from "./zones/op-strip";
import { QueueZone } from "./zones/queue-zone";
import { AgentStrip } from "./zones/agent-strip";
import { NovaPanel } from "./zones/nova-panel";
import { ActivityTrail } from "./zones/activity-trail";
import { ApprovalSlideOver } from "./slide-overs/approval-slide-over";
import { EscalationSlideOver } from "./slide-overs/escalation-slide-over";
import { WelcomeBanner } from "./welcome-banner";
import { HelpOverlay } from "./help-overlay";
import { ToastShelf } from "./toast-shelf";
import { ToastProvider, useToast } from "./use-toast";
import { useHaltState } from "./use-halt-state";
import { useKeyboardShortcuts } from "./use-keyboard-shortcuts";

type SlideOverState =
  | { kind: "approval"; approvalId: string; bindingHash: string }
  | { kind: "escalation"; escalationId: string }
  | null;

function ConsoleViewInner() {
  const [slideOver, setSlideOver] = useState<SlideOverState>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const { halted, toggleHalt, setHalted } = useHaltState();
  const { showToast } = useToast();

  const haltViaShortcut = () => {
    const wasHalted = halted;
    toggleHalt();
    showToast({
      title: wasHalted ? "Resumed" : "Halted",
      detail: wasHalted ? "All agents resumed." : "all agents halted — actions queued",
      undoable: true,
      onUndo: () => setHalted(wasHalted),
    });
  };

  useKeyboardShortcuts({
    help: () => setHelpOpen((v) => !v),
    halt: haltViaShortcut,
    escape: () => setHelpOpen(false),
  });

  return (
    <div data-v6-console>
      <OpStrip onHelpOpen={() => setHelpOpen(true)} />
      <main className="console-main">
        <WelcomeBanner />
        <QueueZone onOpenSlideOver={setSlideOver} />
        <AgentStrip />
        <NovaPanel />
        <ActivityTrail />
      </main>

      {slideOver?.kind === "approval" && (
        <ApprovalSlideOver
          approvalId={slideOver.approvalId}
          bindingHash={slideOver.bindingHash}
          open
          onOpenChange={(open) => {
            if (!open) setSlideOver(null);
          }}
        />
      )}

      {slideOver?.kind === "escalation" && (
        <EscalationSlideOver
          escalationId={slideOver.escalationId}
          open
          onOpenChange={(open) => {
            if (!open) setSlideOver(null);
          }}
        />
      )}

      {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
      <ToastShelf />
    </div>
  );
}

export function ConsoleView() {
  return (
    <ToastProvider>
      <ConsoleViewInner />
    </ToastProvider>
  );
}
```

Note: `useHaltState` is imported here AND in `OpStrip`. Both subscribe to localStorage; React renders are independent but state stays in sync via the localStorage write-through (each hook re-reads on its own mount). For Phase 1 this is acceptable — `OpStrip` is the single source of UI; `ConsoleView` only reads `halted` to fire the keyboard-shortcut toast that mirrors the button. If a divergence bug surfaces during manual testing, lift state to a `<HaltProvider>` in Phase 2.

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter @switchboard/dashboard test src/components/console/__tests__/console-view.test.tsx
```

Expected: PASS (existing tests + 5 new).

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/console/console-view.tsx apps/dashboard/src/components/console/__tests__/console-view.test.tsx
git commit -m "feat(console): wire ToastProvider, WelcomeBanner, HelpOverlay, shortcuts"
```

---

## Task 11: Delete `NumbersStrip`

**Goal:** Remove the dead component now that `console-view.tsx` no longer imports it.

**Files:**

- Delete: `apps/dashboard/src/components/console/zones/numbers-strip.tsx`
- Delete: `apps/dashboard/src/components/console/zones/__tests__/numbers-strip.test.tsx`

- [ ] **Step 1: Confirm nothing else imports NumbersStrip**

```bash
grep -rn "NumbersStrip\|numbers-strip" apps/dashboard/src --include="*.ts" --include="*.tsx"
```

Expected: only matches inside the two files about to be deleted (and possibly `use-console-data.ts` — verify; if it imports the component, this task fails until that import is also cleaned).

- [ ] **Step 2: Delete both files**

```bash
git rm apps/dashboard/src/components/console/zones/numbers-strip.tsx
git rm apps/dashboard/src/components/console/zones/__tests__/numbers-strip.test.tsx
```

- [ ] **Step 3: Run typecheck and full test to verify nothing broke**

```bash
pnpm --filter @switchboard/dashboard typecheck
pnpm --filter @switchboard/dashboard test
```

Expected: both PASS.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(console): remove NumbersStrip (replaced by WelcomeBanner)"
```

---

## Task 12: Final verification + manual smoke

**Goal:** Confirm Phase 1 is shippable. Run the full toolchain and walk through the acceptance criteria from the spec by hand.

- [ ] **Step 1: Full check**

```bash
pnpm --filter @switchboard/dashboard test
pnpm --filter @switchboard/dashboard typecheck
pnpm --filter @switchboard/dashboard lint
```

Expected: all three PASS.

- [ ] **Step 2: File-size check (CLAUDE.md soft cap is 400, hard cap 600)**

```bash
find apps/dashboard/src/components/console -name "*.tsx" -o -name "*.ts" | xargs wc -l | sort -n | tail -5
```

Expected: no Phase-1 file over 400 lines. (`console.css` is allowed to exceed; CSS is exempt from the cap.)

- [ ] **Step 3: Boot the dev stack and smoke test in browser**

From the worktree root:

```bash
pnpm dev
```

In the browser, open `http://localhost:3002/console` (log in if NextAuth bounces to `/login`; if `DEV_BYPASS_AUTH=true` is set in `apps/dashboard/.env.local`, you'll land directly).

Walk the spec's acceptance criteria:

- [ ] OpStrip clock visible (e.g. "Sat May 02 · 9:48 PM")
- [ ] Coral pulse next to "Live" animates
- [ ] Click "? Help" → overlay opens, lists `?`, `1 / 2 / 3`, `H`, `Esc`
- [ ] Click backdrop OR press `Esc` → overlay closes
- [ ] Click "Halt" → "Live" → "Halted", pulse dims, button text → "Resume"
- [ ] Toast appears bottom-center: "**HALTED** · all agents halted — actions queued" with Undo
- [ ] Click Undo → state flips back to "Live", toast disappears
- [ ] Hard-refresh page; if Halt was active, "Halted" is restored
- [ ] First visit (clear localStorage `sb_welcome_dismissed`): Welcome banner appears above queue
- [ ] Click "1. Decide what's in queue" → smooth-scroll, brief coral inset border
- [ ] Click "Got it ✕" → banner disappears; refresh confirms persistence
- [ ] NumbersStrip is gone (no leads/appointments/revenue cells)
- [ ] Press `?` (no input focused) → help opens; press `H` → halt fires + toast
- [ ] Focus a text input (e.g. on `/decide` or `/conversations` if reachable) and press `?` → no overlay (target-INPUT bail-out)

- [ ] **Step 4: Open the implementation PR**

```bash
git push -u origin feat/console-frame-phase-1
gh pr create --title "feat(console): phase 1 (frame) — opstrip halt/help, welcome, help, toast" --body "$(cat <<'EOF'
## Summary

Implements [Phase 1 Frame spec](docs/superpowers/specs/2026-05-02-console-frame-phase-1-design.md) (PR #350):

- OpStrip: Halt + ? Help buttons, halted state with dimmed pulse, 15s live clock
- Dismissible Welcome banner with 3-step tour (smooth-scroll + 1s coral flash); localStorage `sb_welcome_dismissed`
- Help overlay (`?` key or button); closes on backdrop / `Esc` / Close
- Toast shelf bottom-center with Undo, wired to Halt; 4.5s auto-dismiss
- Keyboard shortcuts: `?`, `H`, `Esc`
- NumbersStrip removed
- Halt is **visual-only** in Phase 1 (localStorage `sb_halt_state`); backend pause-all is Phase 2

## Phases 2-4 (deferred)

- Queue: switch slide-overs → inline interaction model + transcript reveal + fade-out resolve
- Agents: click-to-expand strip, Nova/Alex/Mira panels with real data
- Activity: filters, CTA-back-to-queue, flash-on-new

## Test plan

- [ ] `pnpm --filter @switchboard/dashboard test` passes
- [ ] `pnpm --filter @switchboard/dashboard typecheck` passes
- [ ] `pnpm --filter @switchboard/dashboard lint` passes
- [ ] Manual smoke per spec acceptance criteria

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

---

## Notes for the implementing engineer

- **Conventional Commits** are enforced by commitlint. Subjects must start with `feat`/`fix`/`chore`/`docs`/`style`/`refactor`/`test` — case-sensitive lowercase.
- **`useDashboardOverview` is NOT removed.** Other callers (`owner-today.tsx`, `use-console-data.ts`) still need it. Only the `NumbersStrip` consumer is deleted.
- **`use-console-data.ts` is left alone.** It's a parallel (unused-by-this-view) Option-B composer; out of Phase 1 scope.
- **`slide-overs/` directory stays.** `QueueZone` still calls `onOpenSlideOver` for primary actions; Phase 2 replaces this pattern with inline.
- If you discover a Phase-1 surface where the design's CSS rule is not present in the scoped `console.css`, port it (Task 1 step 1 should have caught the obvious ones; if a rule like `.welcome` or `.help-card` is missing, port from `console.css` lines in the design bundle at `/tmp/console-design/switchboard/project/dashboard/console.css`). Prefix with `[data-v6-console]`.
- If a test is flaky around timers, prefer `vi.useFakeTimers({ shouldAdvanceTime: true })` and `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })` — that pattern is already used in `op-strip.test.tsx` (Task 9) and avoids real-time interactions during user clicks.
