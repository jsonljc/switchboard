# Riley Cockpit B.3-followup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `RILEY_COMMANDS` into the shared `<CommandPalette>` on `/riley`, ship a single-owner `useRileyActionDispatcher` hook, flip `Topbar.paletteEnabled=true` with a "Tell Riley…" label, and relax the palette's thread-group filter to support Riley's non-`{contact}` thread commands.

**Architecture:** Mirror Alex A.5's dispatcher + page-scoped ⌘K + single-owner-toast pattern, in a parallel `useRileyActionDispatcher` hook that's switch-per-`RILEY_COMMANDS.id`. The hook is the only surface that imports `useToast`. The page mounts `<CommandPalette commands={RILEY_COMMANDS} />`, registers a page-scoped ⌘K listener, and force-opens the mission popover via a callback in the dispatcher's options bag. No package edits; dashboard-only.

**Tech Stack:** Next.js 14 App Router, React 18, TanStack Query, Vitest + Testing Library, shadcn/ui `useToast`.

**Parent design:** [Riley Cockpit B.3-followup — Palette wiring on `/riley`](./2026-05-15-riley-cockpit-b3-followup-slice-brief.md)

---

## File map

**Create:**

- `apps/dashboard/src/lib/cockpit/riley-action-dispatcher.ts` — the new dispatcher hook (~95 lines).
- `apps/dashboard/src/lib/cockpit/__tests__/riley-action-dispatcher.test.tsx` — 10 cases.

**Modify:**

- `apps/dashboard/src/components/cockpit/topbar.tsx` — add `paletteLabel?: string` prop (default `"Tell Alex…"`).
- `apps/dashboard/src/components/cockpit/__tests__/topbar.test.tsx` — add 1 case.
- `apps/dashboard/src/components/cockpit/command-palette.tsx` — relax thread-group filter to label-contains-`{`.
- `apps/dashboard/src/components/cockpit/__tests__/command-palette.test.tsx` — add 1 case for Riley `thread`-group enablement.
- `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx` — palette state, ⌘K listener, palette mount, dispatcher invocation, Topbar update.
- `apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx` — add `describe("RileyCockpitPage — B.3-followup palette wiring", …)` block with 7 cases.

**Do NOT touch:**

- `packages/**`, `apps/api/**`, `apps/chat/**`, `apps/mcp-server/**` (surface-agnostic backend invariant).
- `apps/dashboard/src/lib/cockpit/riley/riley-toast.ts` (verdict-based; orthogonal to palette toasts).
- `apps/dashboard/src/components/cockpit/cockpit-page.tsx` (Alex's render must be byte-identical via prop defaults).
- `apps/dashboard/src/components/cockpit/composer-placeholder.tsx` (composer deferral).

---

## Task 1: Add `paletteLabel` prop to `<Topbar>`

**Files:**

- Modify: `apps/dashboard/src/components/cockpit/topbar.tsx`
- Test: `apps/dashboard/src/components/cockpit/__tests__/topbar.test.tsx`

- [ ] **Step 1: Write the failing test**

Append at the end of the `describe("Topbar", …)` block in `apps/dashboard/src/components/cockpit/__tests__/topbar.test.tsx`:

```tsx
it("renders 'Tell Alex…' by default", () => {
  render(<Topbar paletteEnabled compact={false} onOpenPalette={() => {}} />);
  expect(screen.getByText("Tell Alex…")).toBeInTheDocument();
});

it("renders the custom paletteLabel when provided", () => {
  render(
    <Topbar paletteEnabled compact={false} onOpenPalette={() => {}} paletteLabel="Tell Riley…" />,
  );
  expect(screen.getByText("Tell Riley…")).toBeInTheDocument();
  expect(screen.queryByText("Tell Alex…")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/switchboard && pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/topbar.test.tsx
```

Expected: 2 new tests fail — `paletteLabel` prop is not yet accepted; the default case's button still reads `"Tell Alex…"` and passes accidentally; the override case fails because the prop is ignored.

- [ ] **Step 3: Add the prop**

In `apps/dashboard/src/components/cockpit/topbar.tsx`:

1. Add `paletteLabel?: string;` to the `TopbarProps` interface (after `tabs?:` at line 22).

```ts
export interface TopbarProps {
  paletteEnabled: boolean;
  onOpenPalette?: () => void;
  compact?: boolean;
  tabs?: readonly TopbarTab[];
  /**
   * Label rendered on the palette-affordance button. Defaults to "Tell Alex…"
   * so Alex's cockpit-page need not pass this prop. Riley passes "Tell Riley…".
   */
  paletteLabel?: string;
}
```

2. Destructure with default in the `Topbar` function signature (around line 60-65):

```ts
export function Topbar({
  paletteEnabled,
  onOpenPalette,
  compact = false,
  tabs = ALEX_CONFIG.tabs,
  paletteLabel = "Tell Alex…",
}: TopbarProps) {
```

3. Replace the hardcoded string at line 114 (`<span style={…}>Tell Alex…</span>`) with `{paletteLabel}`:

```tsx
<span style={{ fontSize: 12.5, color: T.ink3 }}>{paletteLabel}</span>
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/switchboard && pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/topbar.test.tsx
```

Expected: All `Topbar` tests pass (including the original 4 + 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/cockpit/topbar.tsx \
        apps/dashboard/src/components/cockpit/__tests__/topbar.test.tsx
git commit -m "feat(cockpit): add paletteLabel prop to Topbar"
```

---

## Task 2: Relax `<CommandPalette>` thread-group filter

**Goal:** The existing filter `c.group !== "thread" || threadContext !== undefined` disables Riley's `brief-eod` / `cpl-30` (both `thread`-group, neither contains `{contact}`) forever. Change to gate on the _label_ needing interpolation (`label.includes("{")`), which is back-compatible with Alex's `{contact}` labels and unblocks Riley.

**Files:**

- Modify: `apps/dashboard/src/components/cockpit/command-palette.tsx:55`
- Test: `apps/dashboard/src/components/cockpit/__tests__/command-palette.test.tsx`

- [ ] **Step 1: Write the failing test**

Append at the end of the `describe("<CommandPalette>", …)` block:

```tsx
it("Riley thread-group commands without {…} placeholders are enabled even when threadContext is undefined", () => {
  render(<CommandPalette open onClose={noop} commands={RILEY_COMMANDS} onSelect={noop} />);
  const brief = screen.getByText("Brief me at EOD").closest("button");
  const cpl = screen.getByText("Show CPL — last 30d").closest("button");
  expect(brief).not.toBeDisabled();
  expect(cpl).not.toBeDisabled();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/switchboard && pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/command-palette.test.tsx
```

Expected: the new case fails — Riley's `thread`-group commands are disabled because `threadContext` is undefined.

- [ ] **Step 3: Update the filter**

In `apps/dashboard/src/components/cockpit/command-palette.tsx` at line 55, replace:

```ts
const isEnabled = (c: Command) => c.group !== "thread" || threadContext !== undefined;
```

with:

```ts
// Gate enablement on whether the label needs contact interpolation, not on
// group membership. Alex's `fu-named`/`reply-named`/`hold-named` labels
// contain `{contact}` and stay disabled until threadContext lands. Riley's
// thread-group commands (`brief-eod`, `cpl-30`) carry no `{…}` placeholders
// and are always enabled.
const isEnabled = (c: Command) => !c.label.includes("{") || threadContext !== undefined;
```

- [ ] **Step 4: Run all command-palette tests to verify they pass**

```bash
cd ~/switchboard && pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/command-palette.test.tsx
```

Expected: all 11 cases pass (10 existing + 1 new). In particular, the existing "thread-group commands disabled when threadContext is undefined" case stays green because every Alex thread-group label contains `{contact}`.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/cockpit/command-palette.tsx \
        apps/dashboard/src/components/cockpit/__tests__/command-palette.test.tsx
git commit -m "feat(cockpit): gate command enablement on label interpolation, not group"
```

---

## Task 3: Create `useRileyActionDispatcher` hook (failing tests first)

**Files:**

- Create: `apps/dashboard/src/lib/cockpit/__tests__/riley-action-dispatcher.test.tsx`

- [ ] **Step 1: Write the test file**

Create `apps/dashboard/src/lib/cockpit/__tests__/riley-action-dispatcher.test.tsx` with the following contents:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRileyActionDispatcher } from "../riley-action-dispatcher";
import { RILEY_COMMANDS } from "../riley/riley-config";
import type { RileyCommand } from "../riley/riley-config";

const setHalted = vi.fn();
vi.mock("@/components/layout/halt/halt-context", () => ({
  useHalt: () => ({ halted: false, setHalted, toggleHalt: vi.fn() }),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const toast = vi.fn();
vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast }),
}));

function cmd(id: string): RileyCommand {
  const found = RILEY_COMMANDS.find((c) => c.id === id);
  if (!found) throw new Error(`unknown RILEY_COMMANDS id: ${id}`);
  return found;
}

describe("useRileyActionDispatcher", () => {
  let onShowMission: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setHalted.mockReset();
    push.mockReset();
    toast.mockReset();
    onShowMission = vi.fn();
  });

  it("open-meta routes to /settings?focus=channels and toasts", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    act(() => result.current(cmd("open-meta")));
    expect(push).toHaveBeenCalledWith("/settings?focus=channels");
    expect(toast).toHaveBeenCalledWith({ title: "Opening Meta connection." });
    expect(onShowMission).not.toHaveBeenCalled();
    expect(setHalted).not.toHaveBeenCalled();
  });

  it("open-rules routes to /settings?focus=rules and toasts", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    act(() => result.current(cmd("open-rules")));
    expect(push).toHaveBeenCalledWith("/settings?focus=rules");
    expect(toast).toHaveBeenCalledWith({ title: "Opening rules." });
  });

  it("open-targets invokes onShowMission callback (force-open, not toggle) and toasts", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    act(() => result.current(cmd("open-targets")));
    expect(onShowMission).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({ title: "Opened targets." });
  });

  it("pause-1h calls setHalted(true) and toasts with wall-clock projection", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    act(() => result.current(cmd("pause-1h")));
    expect(setHalted).toHaveBeenCalledWith(true);
    expect(toast).toHaveBeenCalledTimes(1);
    const payload = toast.mock.calls[0]![0] as { title: string; description?: string };
    expect(payload.title).toBe("Paused — standing by.");
    expect(payload.description).toMatch(/^until /);
  });

  it("resume calls setHalted(false) and toasts Riley copy", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    act(() => result.current(cmd("resume")));
    expect(setHalted).toHaveBeenCalledWith(false);
    expect(toast).toHaveBeenCalledWith({ title: "Resumed — back to scanning." });
  });

  it("brief-eod is a toast-only stub (no side effects)", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    act(() => result.current(cmd("brief-eod")));
    expect(setHalted).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(onShowMission).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({
      title: "Noted — brief stub.",
      description: "I'll surface scheduled briefs when that ships.",
    });
  });

  it("cpl-30 is a toast-only stub (no side effects)", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    act(() => result.current(cmd("cpl-30")));
    expect(setHalted).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({
      title: "Noted — CPL stub.",
      description: "I'll surface CPL trends when that ships.",
    });
  });

  it("fires exactly one toast per dispatch (single-owner doctrine)", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    for (const c of RILEY_COMMANDS) {
      toast.mockReset();
      act(() => result.current(c));
      expect(toast).toHaveBeenCalledTimes(1);
    }
  });

  it("returns a stable dispatcher across re-renders when options identity is preserved", () => {
    const stableOpts = { onShowMission };
    const { result, rerender } = renderHook(() => useRileyActionDispatcher(stableOpts));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("dispatching every command covers all of RILEY_COMMANDS", () => {
    // Defensive: if a future commit adds an id to RILEY_COMMANDS without
    // adding a dispatcher branch, this loop is the canary — the switch will
    // silently fall through and toast will not be called.
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    for (const c of RILEY_COMMANDS) {
      toast.mockReset();
      act(() => result.current(c));
      expect(toast).toHaveBeenCalledTimes(1);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/switchboard && pnpm --filter @switchboard/dashboard test -- src/lib/cockpit/__tests__/riley-action-dispatcher.test.tsx
```

Expected: import error — the module `../riley-action-dispatcher` does not exist yet.

---

## Task 4: Implement `useRileyActionDispatcher`

**Files:**

- Create: `apps/dashboard/src/lib/cockpit/riley-action-dispatcher.ts`

- [ ] **Step 1: Write the dispatcher**

Create `apps/dashboard/src/lib/cockpit/riley-action-dispatcher.ts` with:

```ts
"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useHalt } from "@/components/layout/halt/halt-context";
import { useToast } from "@/components/ui/use-toast";
import { parseCommand } from "./parse-command";
import { toastVoice } from "./alex-toast-voice";
import type { RileyCommand } from "./riley/riley-config";

export interface UseRileyActionDispatcherOptions {
  /**
   * Force-opens the mission popover. Wired from the page's
   * `setMissionOpen(true)`. The page's existing `onOpenMission` prop on
   * `<Identity>` is a toggle; using the toggle here would close the
   * popover if the operator opened it from Identity first. Force-open is
   * the operator-correct semantics for the "Open targets" intent.
   */
  onShowMission: () => void;
}

export type RileyActionDispatcher = (command: RileyCommand) => void;

/**
 * Single owner of the toast call for `/riley` palette actions. Mirrors
 * `useAlexActionDispatcher` (alex-action-dispatcher.ts). The shared
 * `<CommandPalette>` and `<Topbar>` MUST NOT import `useToast` directly;
 * double-toasts on dispatch are the failure mode this boundary prevents.
 */
export function useRileyActionDispatcher(
  options: UseRileyActionDispatcherOptions,
): RileyActionDispatcher {
  const { setHalted } = useHalt();
  const router = useRouter();
  const { toast } = useToast();
  const { onShowMission } = options;

  return useCallback<RileyActionDispatcher>(
    (command) => {
      switch (command.id) {
        case "open-meta":
          router.push("/settings?focus=channels");
          toast({ title: "Opening Meta connection." });
          return;
        case "open-rules":
          router.push("/settings?focus=rules");
          toast({ title: "Opening rules." });
          return;
        case "open-targets":
          onShowMission();
          toast({ title: "Opened targets." });
          return;
        case "pause-1h": {
          // Reuse Alex's parser + voice helper so Riley's pause toast carries
          // the same wall-clock projection (e.g. "until 3:23 PM"). The brand
          // line "Paused — standing by." is identical across both agents.
          const synthetic = parseCommand("pause for 1h");
          setHalted(true);
          toast(toastVoice(synthetic));
          return;
        }
        case "resume":
          setHalted(false);
          toast({ title: "Resumed — back to scanning." });
          return;
        case "brief-eod":
          toast({
            title: "Noted — brief stub.",
            description: "I'll surface scheduled briefs when that ships.",
          });
          return;
        case "cpl-30":
          toast({
            title: "Noted — CPL stub.",
            description: "I'll surface CPL trends when that ships.",
          });
          return;
      }
    },
    [setHalted, router, toast, onShowMission],
  );
}
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
cd ~/switchboard && pnpm --filter @switchboard/dashboard test -- src/lib/cockpit/__tests__/riley-action-dispatcher.test.tsx
```

Expected: all 10 cases pass.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/lib/cockpit/riley-action-dispatcher.ts \
        apps/dashboard/src/lib/cockpit/__tests__/riley-action-dispatcher.test.tsx
git commit -m "feat(cockpit): add useRileyActionDispatcher for palette commands"
```

---

## Task 5: Wire `RileyCockpitPage` (palette + ⌘K + dispatcher + Topbar)

**Files:**

- Modify: `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx`
- Test: `apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx`

- [ ] **Step 1: Write the page-level failing tests**

Append at the end of `apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx`, after the existing `describe("RileyCockpitPage — B.2a mission popover", …)` block:

```tsx
// ---------------------------------------------------------------------------
// B.3-followup tests — palette wiring on /riley
// ---------------------------------------------------------------------------

describe("RileyCockpitPage — B.3-followup palette wiring", () => {
  beforeEach(() => {
    rileyApprovalsState.approvals = [];
    rileyActivityState.rows = [];
    metricsState.data = null;
    metricsState.isLoading = false;
    metricsState.isError = false;
    metricsState.error = null;
    missionData = undefined;
    toast.mockReset();
  });

  it("renders 'Tell Riley…' on the Topbar palette button, not 'Tell Alex…'", () => {
    wrap(<RileyCockpitPage />);
    expect(screen.getByText("Tell Riley…")).toBeInTheDocument();
    expect(screen.queryByText("Tell Alex…")).not.toBeInTheDocument();
  });

  it("Topbar palette button is enabled (paletteEnabled=true)", () => {
    wrap(<RileyCockpitPage />);
    const btn = screen.getByText("Tell Riley…").closest("button")!;
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveAttribute("aria-disabled", "false");
  });

  it("clicking the Topbar palette button opens the command palette", async () => {
    wrap(<RileyCockpitPage />);
    fireEvent.click(screen.getByText("Tell Riley…").closest("button")!);
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: /Command palette/i })).toBeInTheDocument(),
    );
  });

  it("⌘K opens the command palette", async () => {
    wrap(<RileyCockpitPage />);
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: /Command palette/i })).toBeInTheDocument(),
    );
  });

  it("Escape closes the palette", async () => {
    wrap(<RileyCockpitPage />);
    fireEvent.click(screen.getByText("Tell Riley…").closest("button")!);
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: /Command palette/i })).toBeInTheDocument(),
    );
    const dialog = screen.getByRole("dialog", { name: /Command palette/i });
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /Command palette/i })).not.toBeInTheDocument(),
    );
  });

  it("selecting 'Resume Riley' fires the dispatcher (toast fires; palette closes)", async () => {
    wrap(<RileyCockpitPage />);
    fireEvent.click(screen.getByText("Tell Riley…").closest("button")!);
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: /Command palette/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Resume Riley"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /Command palette/i })).not.toBeInTheDocument(),
    );
    expect(toast).toHaveBeenCalledWith({ title: "Resumed — back to scanning." });
  });

  it("ComposerPlaceholder still renders (composer adoption deferred)", () => {
    wrap(<RileyCockpitPage />);
    // The placeholder copy is the locked Riley NL example.
    expect(screen.getByText(/pause the Cold Interests adset/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/switchboard && pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/riley-cockpit-page.test.tsx
```

Expected: the 7 new cases fail — Topbar still reads `"Tell Alex…"`, palette is not mounted, ⌘K listener is absent.

- [ ] **Step 3: Update `riley-cockpit-page.tsx`**

Edit `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx`:

1. Update the imports block (after the existing `useState` line, line 3):

```tsx
import { useEffect, useState } from "react";
```

2. Add three new imports below the existing cockpit imports (around lines 6-14):

```tsx
import { CommandPalette } from "./command-palette";
```

```tsx
import { RILEY_COMMANDS, ... } from "@/lib/cockpit/riley/riley-config";
```

(merge `RILEY_COMMANDS` into the existing `riley-config` import — the import already destructures `RILEY_ACCENT`, `RILEY_COMPOSER_PLACEHOLDER`, `RILEY_MISSION_SUBTITLE`, `RILEY_TABS`, `statusColor`, `statusPulse`).

```tsx
import { useRileyActionDispatcher } from "@/lib/cockpit/riley-action-dispatcher";
```

3. Inside `RileyCockpitPage`, after the existing state declarations (after line 88, `const [missionOpen, setMissionOpen] = useState(false);`), add:

```tsx
const [paletteOpen, setPaletteOpen] = useState(false);

const dispatch = useRileyActionDispatcher({
  onShowMission: () => setMissionOpen(true),
});

// Page-scoped ⌘K / Ctrl+K listener — opens the command palette. Mirrors
// Alex A.5's CockpitPage pattern (cockpit-page.tsx:55-65). The native
// browser ⌘K is preempted only while /riley is the active page; the
// listener is removed on unmount.
useEffect(() => {
  function onKey(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      e.stopPropagation();
      setPaletteOpen((o) => !o);
    }
  }
  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
}, []);
```

4. Update the `<Topbar>` mount (currently `<Topbar paletteEnabled={false} compact tabs={RILEY_TABS} />` at line 110):

```tsx
<Topbar
  paletteEnabled
  onOpenPalette={() => setPaletteOpen(true)}
  paletteLabel="Tell Riley…"
  compact
  tabs={RILEY_TABS}
/>
```

5. Add the palette mount after the existing `<ComposerPlaceholder>` (right before the closing `</div>` of the outer container, after line 162):

```tsx
<CommandPalette
  open={paletteOpen}
  onClose={() => setPaletteOpen(false)}
  commands={RILEY_COMMANDS}
  onSelect={(cmd) => {
    setPaletteOpen(false);
    dispatch(cmd);
  }}
/>
```

- [ ] **Step 4: Run page tests**

```bash
cd ~/switchboard && pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/riley-cockpit-page.test.tsx
```

Expected: all 25+ cases pass (B.1 + B.2a + B.2b + B.3 + B.3-followup describes).

- [ ] **Step 5: Run the full dashboard test suite**

```bash
cd ~/switchboard && pnpm --filter @switchboard/dashboard test
```

Expected: green. No regressions in Alex cockpit-page, Topbar, command-palette, or any other surface.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx \
        apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx
git commit -m "feat(riley-cockpit): wire palette + ⌘K on /riley (b.3-followup)"
```

---

## Task 6: Final verification

- [ ] **Step 1: Typecheck**

```bash
cd ~/switchboard && pnpm typecheck
```

Expected: clean. If errors mention missing exports from `@switchboard/schemas`/`@switchboard/db`/`@switchboard/core`, run `pnpm reset` first (per CLAUDE.md).

- [ ] **Step 2: Lint**

```bash
cd ~/switchboard && pnpm --filter @switchboard/dashboard lint
```

Expected: clean.

- [ ] **Step 3: Dashboard build (per `feedback_dashboard_build_not_in_ci`)**

```bash
cd ~/switchboard && pnpm --filter @switchboard/dashboard build
```

Expected: success. Catches `.js`-extension regressions and CSP/SSR issues that CI doesn't run.

- [ ] **Step 4: Prettier check (per `feedback_ci_prettier_not_in_local_lint`)**

```bash
cd ~/switchboard && pnpm format:check
```

Expected: clean.

- [ ] **Step 5: Adapter-boundary grep gate**

Capture baseline against `main` and confirm zero new matches:

```bash
cd ~/switchboard
echo "--- branch ---"
rg "Recommendation|AuditEntry|@switchboard/db|@prisma" \
   apps/dashboard/src/components/cockpit \
   apps/dashboard/src/hooks | wc -l
git stash --include-untracked
git checkout main
echo "--- main ---"
rg "Recommendation|AuditEntry|@switchboard/db|@prisma" \
   apps/dashboard/src/components/cockpit \
   apps/dashboard/src/hooks | wc -l
git checkout -
git stash pop || true
```

Expected: same count on branch and `main`.

- [ ] **Step 6: Single-owner toast grep gate**

```bash
cd ~/switchboard && rg "useToast|rileyToast" \
   apps/dashboard/src/components/cockpit/command-palette.tsx \
   apps/dashboard/src/components/cockpit/topbar.tsx \
   apps/dashboard/src/components/cockpit/composer-placeholder.tsx
```

Expected: zero matches.

- [ ] **Step 7: Push and open PR**

```bash
cd ~/switchboard && git push -u origin <branch-name>
gh pr create --title "feat(riley-cockpit): b.3-followup — palette wiring on /riley" --body "..."
```

PR body includes:

- One-line summary linking to slice brief.
- Per-command handler table reference (the brief locks the table).
- Flagged forced deviations:
  - `<Topbar>` `paletteLabel` prop addition (required for "Tell Riley…" copy correctness).
  - `<CommandPalette>` filter relaxation (gates on label-needs-interpolation, not group; back-compatible with Alex).
- Verification checklist (the 6 grep + build + test gates above).

---

## Risks & rollback

- **If `parseCommand("pause for 1h")` ever returns a `kind` other than `"pause"`**, the `toastVoice` call in the `pause-1h` branch returns the wrong-kind voice line. Mitigated by `apps/dashboard/src/lib/cockpit/__tests__/parse-command.test.ts` which locks this projection. Rollback: revert the entire feature commit chain; the four commits above are independent and revertable.
- **If a future Riley command is added to `RILEY_COMMANDS` without a dispatcher branch**, the switch falls through with no toast and no side effect. Task 3 includes a defensive "every command fires exactly one toast" test that catches this regression on PR.
- **If Alex's cockpit-page is found to depend implicitly on the `Topbar` button reading "Tell Alex…"** (e.g., an e2e test grepping for that string), the `paletteLabel` default keeps Alex's render byte-identical. Task 1's default-case test asserts this.

---

## Self-review notes

- Every command in `RILEY_COMMANDS` has a dispatcher branch (Task 4 switch) and a dispatcher test (Task 3).
- Spec requirement "single-owner toast" → Task 3's "fires exactly one toast per dispatch" case + Task 6 step 6 grep gate.
- Spec requirement "adapter boundary unchanged" → Task 6 step 5 grep gate.
- Spec requirement "Topbar reads 'Tell Riley…'" → Task 1 + Task 5 page-test case.
- Spec requirement "⌘K opens palette on /riley" → Task 5 page-test case.
- Spec requirement "Riley thread commands not gated by threadContext" → Task 2 palette-test case.
- Spec requirement "composer stays inert" → Task 5 page-test "ComposerPlaceholder still renders".
- No spec section left unimplemented.
