# C2a — Console Retirement + Authority Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relocate the `HaltProvider` implementation into a layout-owned cluster, lift global `H` / `?` / `Esc` keyboard shortcuts to the editorial shell, rewrite the HelpOverlay for the editorial register, replace `/console/page.tsx` with a server-side redirect shim, and retarget post-login destinations — without deleting the dormant console tree (deferred to C2b).

**Architecture:** Move `halt-context.tsx` to `components/layout/halt/`; reduce the old console path to a temporary re-export shim so the dormant tree still type-checks; introduce a small `<EditorialKeys />` client component that calls `useKeyboardShortcuts` and owns help-overlay open state, mounted inside the editorial shell's `<HaltProvider>`.

**Tech Stack:** Next.js App Router (server + client components), TypeScript, vitest + React Testing Library, existing `@radix-ui/react-dialog` and `next-auth` v5.

**Spec:** [`docs/superpowers/specs/2026-05-08-live-signal-overlay-and-console-retirement-design.md`](../specs/2026-05-08-live-signal-overlay-and-console-retirement-design.md) — sections §1, §2, §5.1, §6.2 cover this PR.

---

## File Structure

**New files:**

- `apps/dashboard/src/components/layout/halt/halt-context.tsx` — relocated provider source of truth
- `apps/dashboard/src/components/layout/halt/halt-button-client.tsx` — relocated header halt button
- `apps/dashboard/src/components/layout/halt/__tests__/halt-context.test.tsx` — relocated tests
- `apps/dashboard/src/components/layout/use-keyboard-shortcuts.ts` — relocated pure utility
- `apps/dashboard/src/components/layout/help-overlay.tsx` — rewritten for editorial register
- `apps/dashboard/src/components/layout/__tests__/help-overlay.test.tsx` — new
- `apps/dashboard/src/components/layout/editorial-keys.tsx` — new shortcut + help-overlay binder
- `apps/dashboard/src/components/layout/__tests__/editorial-keys.test.tsx` — new
- `apps/dashboard/src/app/(auth)/console/__tests__/redirect.test.ts` — new

**Modified files:**

- `apps/dashboard/src/components/console/halt-context.tsx` — reduced to re-export shim
- `apps/dashboard/src/components/layout/editorial-auth-shell.tsx` — import path swap; mount `<EditorialKeys />`
- `apps/dashboard/src/app/(auth)/console/page.tsx` — replaced with server-component redirect shim
- `apps/dashboard/src/app/login/redirect-logic.ts` — `/console` → `/`
- `apps/dashboard/src/app/__tests__/login-redirect.test.ts` — updated expectation
- `apps/dashboard/src/app/post-auth/page.tsx` — doc-comment touch-up

**Deleted files:**

- `apps/dashboard/src/components/layout/halt-button-client.tsx` — replaced by clustered version
- `apps/dashboard/src/components/layout/halt-provider-client.tsx` — 1-line shim no longer needed

---

## Task 1: Relocate `halt-context.tsx` (and tests) into `layout/halt/`

**Files:**

- Move: `apps/dashboard/src/components/console/halt-context.tsx` → `apps/dashboard/src/components/layout/halt/halt-context.tsx`
- Move: `apps/dashboard/src/components/console/__tests__/halt-context.test.tsx` → `apps/dashboard/src/components/layout/halt/__tests__/halt-context.test.tsx`

The file content does not change — same `HaltProvider`, `useHalt`, `toggleHaltWithToast` exports; same `sb_halt_state` localStorage key.

- [ ] **Step 1: Create the target directory and move the source file**

```bash
mkdir -p apps/dashboard/src/components/layout/halt/__tests__
git mv apps/dashboard/src/components/console/halt-context.tsx \
       apps/dashboard/src/components/layout/halt/halt-context.tsx
```

- [ ] **Step 2: Move the test file**

```bash
git mv apps/dashboard/src/components/console/__tests__/halt-context.test.tsx \
       apps/dashboard/src/components/layout/halt/__tests__/halt-context.test.tsx
```

The test imports from `"../halt-context"` — a relative path that still resolves correctly after the move. No content change required.

- [ ] **Step 3: Run the relocated tests to verify they pass**

```bash
pnpm --filter @switchboard/dashboard test halt-context.test
```

Expected: all existing assertions pass at the new location.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/layout/halt/
git add apps/dashboard/src/components/console/halt-context.tsx
git add apps/dashboard/src/components/console/__tests__/halt-context.test.tsx
git commit -m "refactor(dashboard): relocate halt-context.tsx into layout/halt/ cluster"
```

---

## Task 2: Reduce `console/halt-context.tsx` to a re-export shim

The dormant console tree (e.g. `console-view.tsx`, `op-strip.tsx`) still imports from `@/components/console/halt-context`. C2a keeps those imports valid via a re-export shim.

**Files:**

- Create: `apps/dashboard/src/components/console/halt-context.tsx`

- [ ] **Step 1: Write the shim file**

```bash
cat > apps/dashboard/src/components/console/halt-context.tsx <<'EOF'
// Temporary C2a re-export shim — preserves type-check of the dormant
// console tree until C2b deletes the tree wholesale.
// Do not add new imports against this path.
export * from "@/components/layout/halt/halt-context";
EOF
```

- [ ] **Step 2: Run typecheck to verify the dormant tree still compiles**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: no errors. The console tree's `import { HaltProvider, useHalt, toggleHaltWithToast } from "../halt-context"` style imports continue to resolve via the shim.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/console/halt-context.tsx
git commit -m "refactor(dashboard): reduce console/halt-context.tsx to a re-export shim (c2a)"
```

---

## Task 3: Relocate `halt-button-client.tsx` into `layout/halt/`

**Files:**

- Move: `apps/dashboard/src/components/layout/halt-button-client.tsx` → `apps/dashboard/src/components/layout/halt/halt-button-client.tsx`
- Modify the moved file: update its `useHalt` import to point at the new layout-owned location

- [ ] **Step 1: Move the file**

```bash
git mv apps/dashboard/src/components/layout/halt-button-client.tsx \
       apps/dashboard/src/components/layout/halt/halt-button-client.tsx
```

- [ ] **Step 2: Update the import in the moved file**

Open `apps/dashboard/src/components/layout/halt/halt-button-client.tsx` and change:

```ts
import { useHalt } from "@/components/console/halt-context";
```

to:

```ts
import { useHalt } from "./halt-context";
```

- [ ] **Step 3: Run typecheck**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/layout/halt/halt-button-client.tsx
git add apps/dashboard/src/components/layout/halt-button-client.tsx
git commit -m "refactor(dashboard): relocate halt-button-client into layout/halt/ cluster"
```

---

## Task 4: Delete `halt-provider-client.tsx` and update `editorial-auth-shell.tsx`

`halt-provider-client.tsx` is a 1-line re-export of `HaltProvider`. After Task 1, the editorial shell can import `HaltProvider` directly from the new location.

**Files:**

- Delete: `apps/dashboard/src/components/layout/halt-provider-client.tsx`
- Modify: `apps/dashboard/src/components/layout/editorial-auth-shell.tsx`

- [ ] **Step 1: Update the import in `editorial-auth-shell.tsx`**

Find the line:

```ts
import { HaltProvider } from "./halt-provider-client";
```

and replace with:

```ts
import { HaltProvider } from "./halt/halt-context";
```

Also update the `HaltButtonClient` import:

```ts
import { HaltButtonClient } from "./halt-button-client";
```

becomes:

```ts
import { HaltButtonClient } from "./halt/halt-button-client";
```

- [ ] **Step 2: Delete the now-unused shim**

```bash
git rm apps/dashboard/src/components/layout/halt-provider-client.tsx
```

- [ ] **Step 3: Run typecheck and dashboard tests**

```bash
pnpm --filter @switchboard/dashboard typecheck
pnpm --filter @switchboard/dashboard test
```

Expected: clean. The editorial shell mounts `<HaltProvider>` from the new location; no consumer breaks.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/layout/editorial-auth-shell.tsx
git add apps/dashboard/src/components/layout/halt-provider-client.tsx
git commit -m "refactor(dashboard): drop halt-provider-client shim, import HaltProvider directly from layout/halt/"
```

---

## Task 5: Relocate `use-keyboard-shortcuts.ts` into `components/layout/`

The hook is a pure utility — no internal imports, no behavioral coupling to the console tree.

**Files:**

- Move: `apps/dashboard/src/components/console/use-keyboard-shortcuts.ts` → `apps/dashboard/src/components/layout/use-keyboard-shortcuts.ts`

- [ ] **Step 1: Move the file**

```bash
git mv apps/dashboard/src/components/console/use-keyboard-shortcuts.ts \
       apps/dashboard/src/components/layout/use-keyboard-shortcuts.ts
```

- [ ] **Step 2: Run typecheck — `console-view.tsx` still imports it via `./use-keyboard-shortcuts`**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: **fails**. `console-view.tsx:15` references `from "./use-keyboard-shortcuts"`, which no longer exists at that path.

- [ ] **Step 3: Add a re-export shim at the old path so the dormant tree still type-checks**

```bash
cat > apps/dashboard/src/components/console/use-keyboard-shortcuts.ts <<'EOF'
// Temporary C2a re-export shim — preserves type-check of the dormant
// console tree until C2b deletes the tree wholesale.
// Do not add new imports against this path.
export * from "@/components/layout/use-keyboard-shortcuts";
EOF
```

- [ ] **Step 4: Run typecheck again**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/layout/use-keyboard-shortcuts.ts
git add apps/dashboard/src/components/console/use-keyboard-shortcuts.ts
git commit -m "refactor(dashboard): relocate use-keyboard-shortcuts.ts into layout/, leave shim for dormant tree"
```

---

## Task 6: Write failing tests for the new editorial `HelpOverlay`

The console's HelpOverlay is rewritten for the editorial register: editorial copy, only `H` / `?` / `Esc` shortcuts listed.

**Files:**

- Create: `apps/dashboard/src/components/layout/__tests__/help-overlay.test.tsx`

- [ ] **Step 1: Write the test file**

```tsx
// apps/dashboard/src/components/layout/__tests__/help-overlay.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { HelpOverlay } from "../help-overlay";

describe("HelpOverlay (editorial)", () => {
  it("renders an editorial title", () => {
    render(<HelpOverlay onClose={() => {}} />);
    // Title is editorial-register; matches the heading element with role="heading"
    expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
  });

  it("lists exactly H, ?, and Esc shortcuts", () => {
    render(<HelpOverlay onClose={() => {}} />);
    const kbds = screen.getAllByText((_, el) => el?.tagName === "KBD");
    const labels = kbds.map((k) => k.textContent?.trim());
    expect(labels).toEqual(["?", "H", "Esc"]);
  });

  it("does not list 1, 2, or 3 (deferred per spec)", () => {
    render(<HelpOverlay onClose={() => {}} />);
    const kbds = screen.getAllByText((_, el) => el?.tagName === "KBD");
    const labels = kbds.map((k) => k.textContent?.trim());
    expect(labels).not.toContain("1");
    expect(labels).not.toContain("2");
    expect(labels).not.toContain("3");
  });

  it("calls onClose when the Close button is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<HelpOverlay onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when the backdrop is clicked but not when the card body is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<HelpOverlay onClose={onClose} />);
    // Backdrop is the outer presentation element
    const backdrop = container.querySelector('[role="presentation"]');
    expect(backdrop).not.toBeNull();
    await user.click(backdrop as Element);
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    const card = screen.getByRole("dialog");
    await user.click(card);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("traps focus inside the card while open", async () => {
    const user = userEvent.setup();
    render(<HelpOverlay onClose={() => {}} />);
    const card = screen.getByRole("dialog");
    const focusables = card.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    expect(focusables.length).toBeGreaterThan(0);
    // Tab from the last focusable should wrap back to the first
    const last = focusables[focusables.length - 1];
    last.focus();
    await user.tab();
    expect(document.activeElement).toBe(focusables[0]);
  });

  it("restores focus to the previously-focused element on unmount", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = render(<HelpOverlay onClose={() => {}} />);
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @switchboard/dashboard test help-overlay.test
```

Expected: FAIL — `Cannot find module '../help-overlay'`.

---

## Task 7: Implement the editorial `HelpOverlay`

The new overlay reuses the focus-trap scaffolding pattern from the original console version (`FOCUSABLE_SELECTORS`, Tab interception, focus restoration on unmount) but with editorial copy and only the three shortcuts listed.

**Files:**

- Create: `apps/dashboard/src/components/layout/help-overlay.tsx`

- [ ] **Step 1: Write the component**

```tsx
// apps/dashboard/src/components/layout/help-overlay.tsx
"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTORS = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const card = cardRef.current;
    if (card) {
      const first = card.querySelector<HTMLElement>(FOCUSABLE_SELECTORS);
      first?.focus();
    }

    return () => {
      previouslyFocusedRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const card = cardRef.current;
      if (!card) return;
      const focusables = card.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="overlay" role="presentation" onClick={onClose}>
      <div
        ref={cardRef}
        className="help-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-overlay-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="head-row">
          <h2 id="help-overlay-title" className="font-display">
            Quick reference
          </h2>
          <button type="button" className="close" onClick={onClose}>
            Close ✕
          </button>
        </div>
        <p>
          Three agents work on your behalf. The <b>Inbox</b> shows decisions that need you. Each
          agent has a home page with their own work. <b>Live</b> in the header is the system pulse —
          open it to halt or resume everyone, or to glance at recent activity.
        </p>
        <div className="keys">
          <kbd>?</kbd>
          <span>Open this reference</span>
          <kbd>H</kbd>
          <span>Halt or resume all agents</span>
          <kbd>Esc</kbd>
          <span>Close this reference</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/dashboard test help-overlay.test
```

Expected: PASS — all 7 assertions.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/layout/help-overlay.tsx
git add apps/dashboard/src/components/layout/__tests__/help-overlay.test.tsx
git commit -m "feat(dashboard): editorial HelpOverlay with H/?/Esc shortcut list (c2a)"
```

---

## Task 8: Write failing tests for `EditorialKeys`

`EditorialKeys` is a small client component that calls `useKeyboardShortcuts`, owns help-overlay open state, and binds `H` to `useHalt().toggleHalt`.

**Files:**

- Create: `apps/dashboard/src/components/layout/__tests__/editorial-keys.test.tsx`

- [ ] **Step 1: Write the test file**

```tsx
// apps/dashboard/src/components/layout/__tests__/editorial-keys.test.tsx
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { HaltProvider } from "../halt/halt-context";
import { EditorialKeys } from "../editorial-keys";

function pressKey(key: string, opts: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, ...opts }));
  });
}

describe("EditorialKeys", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("opens the HelpOverlay when ? is pressed and closes on second ?", () => {
    render(
      <HaltProvider>
        <EditorialKeys />
      </HaltProvider>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    pressKey("?");
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    pressKey("?");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the HelpOverlay when Esc is pressed", () => {
    render(
      <HaltProvider>
        <EditorialKeys />
      </HaltProvider>,
    );
    pressKey("?");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    pressKey("Escape");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("toggles halted state when H is pressed", () => {
    render(
      <HaltProvider>
        <EditorialKeys />
      </HaltProvider>,
    );
    expect(window.localStorage.getItem("sb_halt_state")).not.toBe("1");
    pressKey("h");
    expect(window.localStorage.getItem("sb_halt_state")).toBe("1");
    pressKey("h");
    expect(window.localStorage.getItem("sb_halt_state")).toBe("0");
  });

  it("ignores keypresses dispatched on input/textarea targets", () => {
    render(
      <>
        <input data-testid="ed" />
        <HaltProvider>
          <EditorialKeys />
        </HaltProvider>
      </>,
    );
    const input = screen.getByTestId("ed");
    input.focus();
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "h", bubbles: true }));
    });
    expect(window.localStorage.getItem("sb_halt_state")).not.toBe("1");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @switchboard/dashboard test editorial-keys.test
```

Expected: FAIL — `Cannot find module '../editorial-keys'`.

---

## Task 9: Implement `EditorialKeys`

**Files:**

- Create: `apps/dashboard/src/components/layout/editorial-keys.tsx`

- [ ] **Step 1: Write the component**

```tsx
// apps/dashboard/src/components/layout/editorial-keys.tsx
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

- [ ] **Step 2: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/dashboard test editorial-keys.test
```

Expected: PASS — all 4 assertions.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/layout/editorial-keys.tsx
git add apps/dashboard/src/components/layout/__tests__/editorial-keys.test.tsx
git commit -m "feat(dashboard): EditorialKeys binder for global H/?/Esc shortcuts (c2a)"
```

---

## Task 10: Mount `<EditorialKeys />` inside `<HaltProvider>` in the editorial shell

**Files:**

- Modify: `apps/dashboard/src/components/layout/editorial-auth-shell.tsx`

- [ ] **Step 1: Add the import**

At the top of the file, add:

```ts
import { EditorialKeys } from "./editorial-keys";
```

- [ ] **Step 2: Mount the component inside `<HaltProvider>`**

Find the JSX section starting `<HaltProvider>`. Add `<EditorialKeys />` as a sibling of `<AmbientCream />`:

```tsx
<HaltProvider>
  <AmbientCream />
  <EditorialKeys />
  <header className="app-header">{/* ... unchanged ... */}</header>
  <main>{children}</main>
  <TweaksPanelMount />
</HaltProvider>
```

`<EditorialKeys />` renders no DOM unless the help overlay is open.

- [ ] **Step 3: Run dashboard tests**

```bash
pnpm --filter @switchboard/dashboard test
```

Expected: clean. No existing tests should regress because `EditorialKeys` only listens to global keypresses.

- [ ] **Step 4: Manual smoke test (dev server)**

Start the dev server:

```bash
pnpm --filter @switchboard/dashboard dev
```

Then in a browser at `http://localhost:3002`:

1. Visit `/` — press `?`. Expected: HelpOverlay appears with three shortcuts listed.
2. Press `Esc`. Expected: overlay closes.
3. Press `H`. Expected: header `Halt` button label flips to `Resume`; refresh and verify state persists (localStorage).
4. Press `H` again. Expected: label returns to `Halt`.
5. Click into a text input (e.g. on `/settings` if available, or any text field) and press `H`. Expected: halt state does NOT toggle (editable-target guard).
6. Visit `/alex` and `/riley` — repeat steps 1, 3 to confirm shortcuts work on every editorial page.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/layout/editorial-auth-shell.tsx
git commit -m "feat(dashboard): mount EditorialKeys in editorial shell — global H/?/Esc on every editorial page (c2a)"
```

---

## Task 11: Write failing test for the `/console` redirect shim

The new `/console/page.tsx` is a thin server component that calls `redirect("/")`. The test mocks `next/navigation` and asserts the redirect target.

**Files:**

- Create: `apps/dashboard/src/app/(auth)/console/__tests__/redirect.test.ts`

- [ ] **Step 1: Write the test file**

```ts
// apps/dashboard/src/app/(auth)/console/__tests__/redirect.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

import { redirect } from "next/navigation";
import ConsolePage from "../page";

describe("/console redirect shim (C2a)", () => {
  beforeEach(() => {
    vi.mocked(redirect).mockClear();
  });

  it("calls Next's redirect with '/'", () => {
    ConsolePage();
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith("/");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @switchboard/dashboard test "console.*redirect"
```

Expected: FAIL — the existing `page.tsx` is a client component using `useSession`, not a server-side redirect. The test will either fail compilation or fail the `expect(redirect).toHaveBeenCalledWith("/")` assertion.

---

## Task 12: Replace `/console/page.tsx` with the redirect shim

**Files:**

- Modify (overwrite): `apps/dashboard/src/app/(auth)/console/page.tsx`

- [ ] **Step 1: Replace the file content**

Overwrite the file with:

```tsx
// apps/dashboard/src/app/(auth)/console/page.tsx
// Temporary C2a compatibility shim.
// Delete in C2b when Live Signal Overlay lands.
import { redirect } from "next/navigation";

export default function ConsolePage() {
  redirect("/");
}
```

Note: there is no `"use client"` directive — this is a server component. `redirect` from `next/navigation` is the App Router server-side redirect.

- [ ] **Step 2: Run the test to verify it passes**

```bash
pnpm --filter @switchboard/dashboard test "console.*redirect"
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/console/page.tsx
git add apps/dashboard/src/app/\(auth\)/console/__tests__/redirect.test.ts
git commit -m "feat(dashboard): replace /console with server-side redirect shim to / (c2a)"
```

---

## Task 13: Retarget post-login destination from `/console` to `/`

**Files:**

- Modify: `apps/dashboard/src/app/login/redirect-logic.ts`
- Modify: `apps/dashboard/src/app/__tests__/login-redirect.test.ts`
- Modify: `apps/dashboard/src/app/post-auth/page.tsx` (doc-comment touch-up only)

- [ ] **Step 1: Update `redirect-logic.ts`**

Open `apps/dashboard/src/app/login/redirect-logic.ts` and change:

```ts
/**
 * Resolve the post-login destination based on session shape.
 * - No org → /onboarding (user hasn't been provisioned to a tenant yet)
 * - Org but onboarding incomplete → /onboarding (resume the wizard)
 * - Otherwise → /console (the operator's home at v1 launch)
 */
export function defaultCallback(session: Session | null): string {
  if (!session?.organizationId) return "/onboarding";
  const onboardingComplete = (session as Session & { onboardingComplete?: boolean })
    .onboardingComplete;
  if (!onboardingComplete) return "/onboarding";
  return "/console";
}
```

to:

```ts
/**
 * Resolve the post-login destination based on session shape.
 * - No org → /onboarding (user hasn't been provisioned to a tenant yet)
 * - Org but onboarding incomplete → /onboarding (resume the wizard)
 * - Otherwise → / (editorial home)
 */
export function defaultCallback(session: Session | null): string {
  if (!session?.organizationId) return "/onboarding";
  const onboardingComplete = (session as Session & { onboardingComplete?: boolean })
    .onboardingComplete;
  if (!onboardingComplete) return "/onboarding";
  return "/";
}
```

- [ ] **Step 2: Update the existing test**

Open `apps/dashboard/src/app/__tests__/login-redirect.test.ts` and change the third test from:

```ts
it("returns /console when session is fully onboarded", () => {
  expect(
    defaultCallback({
      user: { id: "u" },
      organizationId: "org-1",
      onboardingComplete: true,
    } as never),
  ).toBe("/console");
});
```

to:

```ts
it("returns / when session is fully onboarded", () => {
  expect(
    defaultCallback({
      user: { id: "u" },
      organizationId: "org-1",
      onboardingComplete: true,
    } as never),
  ).toBe("/");
});
```

- [ ] **Step 3: Update the doc comment in `post-auth/page.tsx`**

Open `apps/dashboard/src/app/post-auth/page.tsx`. Find the comment block referencing `/console` (around line 12 per the spec's audit) and change `→ /console` to `→ /`. The runtime behavior of `post-auth/page.tsx` does not change (it delegates to `defaultCallback`); only the comment's example destination shifts.

- [ ] **Step 4: Run the login redirect test**

```bash
pnpm --filter @switchboard/dashboard test login-redirect.test
```

Expected: PASS — all three assertions, with the third now expecting `/`.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/login/redirect-logic.ts
git add apps/dashboard/src/app/__tests__/login-redirect.test.ts
git add apps/dashboard/src/app/post-auth/page.tsx
git commit -m "feat(dashboard): retarget post-login destination from /console to / (c2a)"
```

---

## Task 14: Final acceptance verification

This task is verification-only. It catches anything missed and asserts the C2a acceptance criteria from the spec §6.2.

- [ ] **Step 1: Run full lint + typecheck + dashboard tests**

```bash
pnpm --filter @switchboard/dashboard lint
pnpm --filter @switchboard/dashboard typecheck
pnpm --filter @switchboard/dashboard test
```

Expected: all clean.

- [ ] **Step 2: Verify the `@/components/console` import grep**

```bash
git grep -n "@/components/console" apps/dashboard/src
```

Expected: hits ONLY inside `apps/dashboard/src/components/console/` itself (the dormant tree referencing its own internals via the relative path it actually uses) plus the explicit re-export shims at `components/console/halt-context.tsx` and `components/console/use-keyboard-shortcuts.ts`. **No external imports** from elsewhere in `apps/dashboard/src` outside `components/console/`.

If you see hits in `components/layout/` or anywhere else outside `components/console/`, fix them before proceeding.

- [ ] **Step 3: Manual smoke test (dev server)**

Start the dev server: `pnpm --filter @switchboard/dashboard dev`

1. **Logged-in `/console` redirect.** Sign in. Visit `http://localhost:3002/console`. Expected: 307 redirect to `/`; you land on the editorial home.
2. **Logged-out `/console` redirect.** Sign out (or use an incognito window without the session cookie). Visit `http://localhost:3002/console`. Expected: redirect to `/login` (middleware-gated; the route is still in `AUTH_PAGE_PREFIXES` per spec §2.5).
3. **Global shortcuts on every editorial page.** Visit `/`, `/alex`, `/riley`. On each: press `H` (header `Halt` button label flips), press `?` (HelpOverlay opens), press `Esc` (closes).
4. **Halt persists across reload.** Press `H` to halt; reload the page; verify header shows `Resume` (state restored from `sb_halt_state`).
5. **Post-login goes to `/`.** Sign out, sign back in as an onboarded user. Expected: lands on `/`, not `/console`.

- [ ] **Step 4: Verify the dormant console tree still type-checks**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: clean. The shims at `components/console/halt-context.tsx` and `components/console/use-keyboard-shortcuts.ts` keep the dormant tree compiling.

- [ ] **Step 5: Update memory note**

Open `/Users/jasonli/.claude/projects/-Users-jasonli-switchboard/memory/project_console_halt_state_phase2_lift.md`. Mark the lift as complete, citing this PR. (One-line append or replace; the exact wording is at the implementer's discretion. The MEMORY.md index entry stays — it just now points at "lift completed" instead of "lift pending".)

- [ ] **Step 6: Open the C2a PR**

```bash
gh pr create --base main --title "feat(dashboard): C2a — console retirement + authority cleanup" --body "$(cat <<'EOF'
## Summary

- Relocate `HaltProvider` implementation into `components/layout/halt/`; old console path becomes a re-export shim
- Lift global `H` / `?` / `Esc` keyboard shortcuts to the editorial shell via new `<EditorialKeys />` binder
- Rewrite HelpOverlay for the editorial register (only `H` / `?` / `Esc` listed)
- Replace `/console/page.tsx` with a server-side redirect shim to `/` (route stays middleware-gated through C2a)
- Retarget post-login destination from `/console` to `/`

Per spec: `docs/superpowers/specs/2026-05-08-live-signal-overlay-and-console-retirement-design.md` §1, §2, §5.1, §6.2

## Test plan

- [ ] `pnpm lint && pnpm typecheck && pnpm --filter @switchboard/dashboard test` clean
- [ ] Logged-in `/console` redirects to `/`
- [ ] Logged-out `/console` redirects to `/login`
- [ ] On `/`, `/alex`, `/riley`: `H` toggles halt; `?` opens help; `Esc` closes
- [ ] Halt state persists across reload (`sb_halt_state` localStorage)
- [ ] Post-login destination is `/` for onboarded users
- [ ] `git grep "@/components/console"` outside `components/console/` returns zero
- [ ] Dormant console tree still type-checks via shims

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## C2a complete

After this plan executes and the PR merges, C2a's user-facing wins are live:

- Global `H` / `?` / `Esc` work on every editorial page
- `/console` redirects to `/`
- Post-login lands on `/`
- One real `HaltProvider` implementation in the codebase

The dormant console tree still type-checks via shims and is rendered nowhere. C2b takes the next step: build the Live Signal Popover and delete the entire console tree.
