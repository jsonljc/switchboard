# Console Frame Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch the `/console` queue from slide-over actions to an inline interaction model (transcript reveal + inline approve/reject + fade-out resolve animation), and lift Halt state into a `<HaltProvider>` context to remove Phase 1's DOM querySelector race workaround.

**Architecture:** Foundation first — replace `useHaltState` with a context-backed `useHalt()` so OpStrip and the keyboard handler share one source of state. Then split `queue-cards.tsx` into per-kind files under `queue-cards/`, each owning its mutation/expand state. Add a `resolvingIds: Set<string>` in `QueueZone` driving a CSS `.is-resolving` collapse animation; `setTimeout` invalidates queries after 320ms. Delete the `slide-overs/` directory once the inline parity tests pass.

**Tech Stack:** React 18, Next.js 14 (App Router), TanStack React Query 5, Vitest + @testing-library/react. Existing shared hooks `useEscalationReply`, `useApprovalAction`, `useEscalationDetail` are reused unchanged.

**Spec:** [`docs/superpowers/specs/2026-05-03-console-frame-phase-2-design.md`](../specs/2026-05-03-console-frame-phase-2-design.md) (commit `9e1e34c7` on `feat/console-preview`).

**Prerequisite:** Phase 1 (commit `a69dd455` and the in-progress chrome work on `feat/console-preview`) must be merged or rebased so `apps/dashboard/src/components/console/use-halt-state.ts` exists, OpStrip renders a Halt button, and `<ConsoleView>` has the `H` keyboard handler with the `document.querySelector<HTMLButtonElement>(".op-halt")?.click()` workaround. The plan rewrites those surfaces.

---

## File Map

**New files:**

- `apps/dashboard/src/components/console/halt-context.tsx`
- `apps/dashboard/src/components/console/__tests__/halt-context.test.tsx`
- `apps/dashboard/src/components/console/queue-cards/index.tsx`
- `apps/dashboard/src/components/console/queue-cards/rich-text.tsx`
- `apps/dashboard/src/components/console/queue-cards/escalation-card.tsx`
- `apps/dashboard/src/components/console/queue-cards/transcript-panel.tsx`
- `apps/dashboard/src/components/console/queue-cards/reply-form.tsx`
- `apps/dashboard/src/components/console/queue-cards/recommendation-card.tsx`
- `apps/dashboard/src/components/console/queue-cards/approval-gate-card.tsx`
- `apps/dashboard/src/components/console/queue-cards/__tests__/escalation-card.test.tsx`
- `apps/dashboard/src/components/console/queue-cards/__tests__/transcript-panel.test.tsx`
- `apps/dashboard/src/components/console/queue-cards/__tests__/reply-form.test.tsx`
- `apps/dashboard/src/components/console/queue-cards/__tests__/recommendation-card.test.tsx`
- `apps/dashboard/src/components/console/queue-cards/__tests__/approval-gate-card.test.tsx`
- `apps/dashboard/src/components/console/queue-cards/__tests__/index.test.tsx`
- `apps/dashboard/src/components/console/zones/__tests__/queue-zone.test.tsx`

**Modified:**

- `apps/dashboard/src/components/console/console-view.tsx` (HaltProvider wrap, remove slide-over wiring)
- `apps/dashboard/src/components/console/zones/op-strip.tsx` (use `useHalt` instead of `useHaltState`)
- `apps/dashboard/src/components/console/zones/queue-zone.tsx` (remove `onOpenSlideOver`, add `resolvingIds` + `beginResolve`)
- `apps/dashboard/src/components/console/console.css` (`.qcard` transition, `.is-resolving`, `.esc-panel`, `.transcript-row`, `.reply-form`, `.qerror`, reduced-motion query)
- `apps/dashboard/src/components/console/__tests__/console-view.test.tsx` (drop slide-over assertions, add HaltProvider wrap)
- `apps/dashboard/src/components/console/__tests__/console-view-halt.test.tsx` (replace DC-41 deferral test with single-source state assertion)

**Deleted:**

- `apps/dashboard/src/components/console/use-halt-state.ts`
- `apps/dashboard/src/components/console/__tests__/use-halt-state.test.ts`
- `apps/dashboard/src/components/console/queue-cards.tsx`
- `apps/dashboard/src/components/console/slide-overs/console-slide-over.tsx`
- `apps/dashboard/src/components/console/slide-overs/escalation-slide-over.tsx`
- `apps/dashboard/src/components/console/slide-overs/approval-slide-over.tsx`
- `apps/dashboard/src/components/console/slide-overs/__tests__/console-slide-over.test.tsx`
- `apps/dashboard/src/components/console/slide-overs/__tests__/escalation-slide-over.test.tsx`
- `apps/dashboard/src/components/console/slide-overs/__tests__/approval-slide-over.test.tsx`
- `apps/dashboard/src/components/console/slide-overs/` (empty directory after files are removed)

---

## Conventions used in every task

- All test files use **vitest** + **@testing-library/react**.
- React Query consumers wrap in this helper (already used in existing tests):

  ```tsx
  import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
  import type { ReactNode } from "react";

  function makeWrapper() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
  }
  ```

- Per-task verification commands run from repo root.
- Commit messages follow Conventional Commits (`feat(console): …`, `test(dashboard): …`, `refactor(console): …`, `chore(console): …`).

---

## Task 1: HaltProvider context

**Files:**

- Create: `apps/dashboard/src/components/console/halt-context.tsx`
- Create: `apps/dashboard/src/components/console/__tests__/halt-context.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/components/console/__tests__/halt-context.test.tsx`:

```tsx
import { act, render, renderHook } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { HaltProvider, useHalt } from "../halt-context";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <HaltProvider>{children}</HaltProvider>
);

describe("HaltProvider + useHalt", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("starts halted=false when no localStorage value", () => {
    const { result } = renderHook(() => useHalt(), { wrapper });
    expect(result.current.halted).toBe(false);
  });

  it("reads sb_halt_state='1' as halted=true on mount", () => {
    window.localStorage.setItem("sb_halt_state", "1");
    const { result } = renderHook(() => useHalt(), { wrapper });
    expect(result.current.halted).toBe(true);
  });

  it("toggleHalt flips state and writes to localStorage", () => {
    const { result } = renderHook(() => useHalt(), { wrapper });
    act(() => result.current.toggleHalt());
    expect(result.current.halted).toBe(true);
    expect(window.localStorage.getItem("sb_halt_state")).toBe("1");
    act(() => result.current.toggleHalt());
    expect(result.current.halted).toBe(false);
    expect(window.localStorage.getItem("sb_halt_state")).toBe("0");
  });

  it("setHalted(true) sets halted to true", () => {
    const { result } = renderHook(() => useHalt(), { wrapper });
    act(() => result.current.setHalted(true));
    expect(result.current.halted).toBe(true);
  });

  it("two consumers share state across rapid toggles (Phase 1 race regression)", () => {
    function ConsumerA() {
      const { halted, toggleHalt } = useHalt();
      return (
        <button data-testid="a" onClick={toggleHalt}>
          {halted ? "A:halted" : "A:live"}
        </button>
      );
    }
    function ConsumerB() {
      const { halted, toggleHalt } = useHalt();
      return (
        <button data-testid="b" onClick={toggleHalt}>
          {halted ? "B:halted" : "B:live"}
        </button>
      );
    }
    const { getByTestId } = render(
      <HaltProvider>
        <ConsumerA />
        <ConsumerB />
      </HaltProvider>,
    );
    act(() => getByTestId("a").click());
    expect(getByTestId("a").textContent).toBe("A:halted");
    expect(getByTestId("b").textContent).toBe("B:halted");
    act(() => getByTestId("b").click());
    expect(getByTestId("a").textContent).toBe("A:live");
    expect(getByTestId("b").textContent).toBe("B:live");
    act(() => getByTestId("a").click());
    expect(getByTestId("a").textContent).toBe("A:halted");
    expect(getByTestId("b").textContent).toBe("B:halted");
  });

  it("useHalt outside provider throws", () => {
    expect(() => renderHook(() => useHalt())).toThrow(/useHalt must be used inside <HaltProvider>/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- halt-context.test`
Expected: FAIL — module `../halt-context` does not exist.

- [ ] **Step 3: Implement HaltProvider + useHalt**

Create `apps/dashboard/src/components/console/halt-context.tsx`:

```tsx
"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const STORAGE_KEY = "sb_halt_state";

function readLocal(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeLocal(halted: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, halted ? "1" : "0");
  } catch {
    // localStorage may be unavailable (private mode, quota); fail silent
  }
}

type HaltContextValue = {
  halted: boolean;
  setHalted: (next: boolean) => void;
  toggleHalt: () => void;
};

const HaltContext = createContext<HaltContextValue | null>(null);

export function HaltProvider({ children }: { children: ReactNode }) {
  const [halted, setHaltedState] = useState<boolean>(() => readLocal());

  useEffect(() => {
    writeLocal(halted);
  }, [halted]);

  const value = useMemo<HaltContextValue>(
    () => ({
      halted,
      setHalted: (next: boolean) => setHaltedState(next),
      toggleHalt: () => setHaltedState((v) => !v),
    }),
    [halted],
  );

  return <HaltContext.Provider value={value}>{children}</HaltContext.Provider>;
}

export function useHalt(): HaltContextValue {
  const ctx = useContext(HaltContext);
  if (!ctx) throw new Error("useHalt must be used inside <HaltProvider>");
  return ctx;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/dashboard test -- halt-context.test`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/halt-context.tsx \
        apps/dashboard/src/components/console/__tests__/halt-context.test.tsx
git commit -m "feat(console): add HaltProvider context with single-source halt state"
```

---

## Task 2: Wire OpStrip to useHalt

**Files:**

- Modify: `apps/dashboard/src/components/console/zones/op-strip.tsx`

**Note:** This task assumes Phase 1 OpStrip already imports `useHaltState` and renders a `.op-halt` button + `.op-help` button. The diff is a one-import + one-line swap.

- [ ] **Step 1: Write a failing test in op-strip.test.tsx**

If `apps/dashboard/src/components/console/zones/__tests__/op-strip.test.tsx` already exists from Phase 1, add this test case. If it does not, create it:

```tsx
import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { OpStrip } from "../op-strip";
import { HaltProvider } from "../../halt-context";

vi.mock("@/hooks/use-org-config", () => ({
  useOrgConfig: () => ({
    data: { config: { name: "Acme" } },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <HaltProvider>{children}</HaltProvider>
    </QueryClientProvider>
  );
};

describe("OpStrip with useHalt", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("reflects halted state from HaltProvider", () => {
    window.localStorage.setItem("sb_halt_state", "1");
    const { container } = render(<OpStrip onHelpOpen={() => {}} />, { wrapper });
    expect(container.querySelector(".op-halt")?.textContent).toMatch(/Resume/);
  });

  it("shows Live label when not halted", () => {
    const { container } = render(<OpStrip onHelpOpen={() => {}} />, { wrapper });
    expect(container.querySelector(".op-live")?.textContent).toMatch(/Live/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- op-strip.test`
Expected: FAIL — OpStrip still imports `useHaltState`, not `useHalt`; the test wraps in `<HaltProvider>` but the component does not consume the context.

- [ ] **Step 3: Replace useHaltState with useHalt in OpStrip**

In `apps/dashboard/src/components/console/zones/op-strip.tsx`, replace:

```tsx
import { useHaltState } from "../use-halt-state";
```

with:

```tsx
import { useHalt } from "../halt-context";
```

And replace any `const { halted, toggleHalt } = useHaltState();` with:

```tsx
const { halted, toggleHalt } = useHalt();
```

(If Phase 1 wires the toast inside OpStrip's halt click handler, leave that wiring intact — only swap the state hook.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/dashboard test -- op-strip.test halt-context.test`
Expected: PASS — both files green.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/zones/op-strip.tsx \
        apps/dashboard/src/components/console/zones/__tests__/op-strip.test.tsx
git commit -m "refactor(console): consume halt state from HaltProvider in OpStrip"
```

---

## Task 3: Lift Halt + remove querySelector workaround in ConsoleView

**Files:**

- Modify: `apps/dashboard/src/components/console/console-view.tsx`
- Modify: `apps/dashboard/src/components/console/__tests__/console-view-halt.test.tsx`

- [ ] **Step 1: Replace the DC-41 deferral test with a single-source state test**

Open `apps/dashboard/src/components/console/__tests__/console-view-halt.test.tsx` and replace its contents with:

```tsx
import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
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

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

async function mockAllZoneHooksLoaded() {
  const orgMod = await import("@/hooks/use-org-config");
  vi.mocked(orgMod.useOrgConfig).mockReturnValue({
    data: { config: { name: "Acme" } },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  } as never);
  const overviewMod = await import("@/hooks/use-dashboard-overview");
  vi.mocked(overviewMod.useDashboardOverview).mockReturnValue({
    data: undefined,
    isLoading: true,
    error: null,
    refetch: vi.fn(),
  } as never);
  const escMod = await import("@/hooks/use-escalations");
  vi.mocked(escMod.useEscalations).mockReturnValue({
    data: { escalations: [] },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  } as never);
  const apMod = await import("@/hooks/use-approvals");
  vi.mocked(apMod.useApprovals).mockReturnValue({
    data: { approvals: [] },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  } as never);
  const agentsMod = await import("@/hooks/use-agents");
  vi.mocked(agentsMod.useAgentRoster).mockReturnValue({
    data: undefined,
    isLoading: true,
    error: null,
    refetch: vi.fn(),
  } as never);
  vi.mocked(agentsMod.useAgentState).mockReturnValue({
    data: undefined,
    isLoading: true,
    error: null,
    refetch: vi.fn(),
  } as never);
  const modulesMod = await import("@/hooks/use-module-status");
  vi.mocked(modulesMod.useModuleStatus).mockReturnValue({
    data: undefined,
    isLoading: true,
    error: null,
    refetch: vi.fn(),
  } as never);
  const auditMod = await import("@/hooks/use-audit");
  vi.mocked(auditMod.useAudit).mockReturnValue({
    data: undefined,
    isLoading: true,
    error: null,
    refetch: vi.fn(),
  } as never);
}

describe("ConsoleView Halt — single source", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("button click and H key share the same halted state", async () => {
    await mockAllZoneHooksLoaded();
    const { container } = render(<ConsoleView />, { wrapper });

    const haltButton = container.querySelector<HTMLButtonElement>(".op-halt");
    expect(haltButton).not.toBeNull();
    expect(haltButton!.textContent).toMatch(/Halt/);

    // Click button → halted
    act(() => haltButton!.click());
    expect(haltButton!.textContent).toMatch(/Resume/);

    // Press H → live (same state, no double-toggle)
    act(() => {
      fireEvent.keyDown(window, { key: "h" });
    });
    expect(haltButton!.textContent).toMatch(/Halt/);

    // Click button again → halted (third toggle, no race)
    act(() => haltButton!.click());
    expect(haltButton!.textContent).toMatch(/Resume/);
  });

  it("does not call document.querySelector on .op-halt during keyboard handler", async () => {
    await mockAllZoneHooksLoaded();
    const spy = vi.spyOn(document, "querySelector");
    const { container } = render(<ConsoleView />, { wrapper });
    spy.mockClear();
    act(() => {
      fireEvent.keyDown(window, { key: "h" });
    });
    const calledForOpHalt = spy.mock.calls.some(
      ([selector]) => typeof selector === "string" && selector.includes(".op-halt"),
    );
    expect(calledForOpHalt).toBe(false);
    spy.mockRestore();
    expect(container).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- console-view-halt.test`
Expected: FAIL — Phase 1 ConsoleView still uses `useHaltState` + `document.querySelector(".op-halt")?.click()`.

- [ ] **Step 3: Wire ConsoleView to HaltProvider + useHalt**

Open `apps/dashboard/src/components/console/console-view.tsx`. Make these changes (the slide-over wiring is removed in Task 11; this task only touches Halt):

1. Replace `import { useHaltState } from "./use-halt-state";` with `import { HaltProvider, useHalt } from "./halt-context";`.
2. Wrap the component body's return in `<HaltProvider>...</HaltProvider>` if not already wrapped (at the _outermost_ level so OpStrip and the keyboard handler are inside it).
3. Move the keyboard handler + Halt-related state into a separate inner component (so it lives **inside** `<HaltProvider>` and can call `useHalt()`):

```tsx
"use client";

import "./console.css";
import { useState } from "react";
import { OpStrip } from "./zones/op-strip";
import { NumbersStrip } from "./zones/numbers-strip";
import { QueueZone } from "./zones/queue-zone";
import { AgentStrip } from "./zones/agent-strip";
import { NovaPanel } from "./zones/nova-panel";
import { ActivityTrail } from "./zones/activity-trail";
import { ApprovalSlideOver } from "./slide-overs/approval-slide-over";
import { EscalationSlideOver } from "./slide-overs/escalation-slide-over";
import { HaltProvider, useHalt } from "./halt-context";
// (any Phase 1 imports — ToastProvider, useToast, useKeyboardShortcuts, HelpOverlay, ToastShelf, WelcomeBanner — stay)

type SlideOverState =
  | { kind: "approval"; approvalId: string; bindingHash: string }
  | { kind: "escalation"; escalationId: string }
  | null;

function ConsoleViewBody() {
  const [slideOver, setSlideOver] = useState<SlideOverState>(null);
  // (Phase 1 helpOpen / showToast wiring stays here)
  const { halted, setHalted, toggleHalt } = useHalt();
  // ... rest of body, with the H keyboard handler calling toggleHalt() and showToast() directly.
  // No document.querySelector(".op-halt") anywhere.
  return <div data-v6-console>{/* unchanged children */}</div>;
}

export function ConsoleView() {
  return (
    <HaltProvider>
      <ConsoleViewBody />
    </HaltProvider>
  );
}
```

The literal H-handler block, replacing whatever Phase 1 wired:

```tsx
useKeyboardShortcuts({
  help: () => setHelpOpen((v) => !v),
  halt: () => {
    const wasHalted = halted;
    toggleHalt();
    showToast({
      title: wasHalted ? "RESUMED" : "HALTED",
      detail: wasHalted ? "agents resumed" : "all agents halted — actions queued",
      undoable: true,
      onUndo: () => setHalted(wasHalted),
    });
  },
  escape: () => setHelpOpen(false),
});
```

Search the file for `document.querySelector` and `.op-halt` — both must be absent.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/dashboard test -- console-view-halt.test halt-context.test op-strip.test`
Expected: PASS — all halt-related tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/console-view.tsx \
        apps/dashboard/src/components/console/__tests__/console-view-halt.test.tsx
git commit -m "refactor(console): lift halt state to HaltProvider, drop querySelector workaround"
```

---

## Task 4: Delete use-halt-state.ts and its test

**Files:**

- Delete: `apps/dashboard/src/components/console/use-halt-state.ts`
- Delete: `apps/dashboard/src/components/console/__tests__/use-halt-state.test.ts`

- [ ] **Step 1: Verify zero remaining imports**

Run:

```bash
grep -rn "use-halt-state\|useHaltState" apps/dashboard/src/ packages/
```

Expected: zero matches. (If matches appear, fix them — they should all have been migrated to `useHalt` in Task 2/3.)

- [ ] **Step 2: Delete the files**

```bash
git rm apps/dashboard/src/components/console/use-halt-state.ts \
       apps/dashboard/src/components/console/__tests__/use-halt-state.test.ts
```

- [ ] **Step 3: Run typecheck + tests**

Run:

```bash
pnpm --filter @switchboard/dashboard typecheck
pnpm --filter @switchboard/dashboard test -- halt
```

Expected: typecheck clean, halt tests still pass.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(console): remove use-halt-state hook (replaced by HaltProvider)"
```

---

## Task 5: Extract RichTextSpan into queue-cards/rich-text.tsx

**Files:**

- Create: `apps/dashboard/src/components/console/queue-cards/rich-text.tsx`

This is the first piece of the queue-cards split. We start here because every card kind imports it.

- [ ] **Step 1: Create the directory and write a small smoke test**

Create `apps/dashboard/src/components/console/queue-cards/__tests__/rich-text.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { RichTextSpan } from "../rich-text";

describe("RichTextSpan", () => {
  it("renders plain string segments", () => {
    const { container } = render(<RichTextSpan value={["hello ", "world"]} />);
    expect(container.textContent).toBe("hello world");
  });

  it("wraps {bold} segments in <b>", () => {
    const { container } = render(<RichTextSpan value={[{ bold: "bold" }]} />);
    expect(container.querySelector("b")?.textContent).toBe("bold");
  });

  it("wraps {coral} segments in <em>", () => {
    const { container } = render(<RichTextSpan value={[{ coral: "warn" }]} />);
    expect(container.querySelector("em")?.textContent).toBe("warn");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- rich-text.test`
Expected: FAIL — module `../rich-text` does not exist.

- [ ] **Step 3: Create rich-text.tsx**

Create `apps/dashboard/src/components/console/queue-cards/rich-text.tsx`:

```tsx
"use client";

import type { RichText } from "../console-data";

export function RichTextSpan({ value }: { value: RichText }) {
  return (
    <>
      {value.map((seg, i) => {
        if (typeof seg === "string") return <span key={i}>{seg}</span>;
        if ("bold" in seg) return <b key={i}>{seg.bold}</b>;
        return (
          <em key={i} style={{ fontStyle: "normal" }}>
            {seg.coral}
          </em>
        );
      })}
    </>
  );
}

export function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/dashboard test -- rich-text.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/queue-cards/rich-text.tsx \
        apps/dashboard/src/components/console/queue-cards/__tests__/rich-text.test.tsx
git commit -m "refactor(console): extract RichTextSpan + capitalize into queue-cards/rich-text"
```

---

## Task 6: TranscriptPanel

**Files:**

- Create: `apps/dashboard/src/components/console/queue-cards/transcript-panel.tsx`
- Create: `apps/dashboard/src/components/console/queue-cards/__tests__/transcript-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

Create the test file:

```tsx
import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { TranscriptPanel } from "../transcript-panel";

vi.mock("@/hooks/use-escalations");

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(ui, { wrapper: Wrapper });
}

describe("TranscriptPanel", () => {
  it("shows loading skeleton while fetching", async () => {
    const mod = await import("@/hooks/use-escalations");
    vi.mocked(mod.useEscalationDetail).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as never);
    const { container } = wrap(<TranscriptPanel escalationId="e1" />);
    expect(container.querySelector(".transcript-loading")).not.toBeNull();
  });

  it("renders the last 5 messages, oldest-to-newest", async () => {
    const mod = await import("@/hooks/use-escalations");
    const history = Array.from({ length: 8 }, (_, i) => ({
      role: i % 2 === 0 ? "lead" : "agent",
      text: `msg ${i + 1}`,
      timestamp: `2026-05-03T10:0${i}:00Z`,
    }));
    vi.mocked(mod.useEscalationDetail).mockReturnValue({
      data: { conversationHistory: history },
      isLoading: false,
      error: null,
    } as never);
    const { container } = wrap(<TranscriptPanel escalationId="e1" />);
    const rows = container.querySelectorAll(".transcript-row");
    expect(rows.length).toBe(5);
    expect(rows[0].textContent).toContain("msg 4");
    expect(rows[4].textContent).toContain("msg 8");
  });

  it("shows an error fallback when the fetch errors", async () => {
    const mod = await import("@/hooks/use-escalations");
    vi.mocked(mod.useEscalationDetail).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("boom"),
    } as never);
    const { container } = wrap(<TranscriptPanel escalationId="e1" />);
    expect(container.querySelector(".transcript-error")).not.toBeNull();
  });

  it('includes a "Open full conversation" link to /conversations/:id', async () => {
    const mod = await import("@/hooks/use-escalations");
    vi.mocked(mod.useEscalationDetail).mockReturnValue({
      data: { conversationHistory: [{ role: "lead", text: "hi", timestamp: "t" }] },
      isLoading: false,
      error: null,
    } as never);
    const { container } = wrap(<TranscriptPanel escalationId="e1" />);
    const link = container.querySelector<HTMLAnchorElement>("a[href='/conversations/e1']");
    expect(link?.textContent).toMatch(/Open full conversation/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- transcript-panel.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement TranscriptPanel**

Create `apps/dashboard/src/components/console/queue-cards/transcript-panel.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useEscalationDetail } from "@/hooks/use-escalations";

const VISIBLE_COUNT = 5;

type Message = { role: string; text: string; timestamp: string };

export function TranscriptPanel({ escalationId }: { escalationId: string }) {
  const { data, isLoading, error } = useEscalationDetail(escalationId);

  if (isLoading) {
    return (
      <div className="transcript-loading" aria-label="Loading transcript">
        <div className="transcript-row transcript-skeleton" />
        <div className="transcript-row transcript-skeleton" />
        <div className="transcript-row transcript-skeleton" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="transcript-error">
        Couldn&apos;t load transcript —{" "}
        <Link href={`/conversations/${escalationId}`}>open full conversation →</Link>
      </div>
    );
  }

  const history =
    (data as { conversationHistory?: Message[] } | undefined)?.conversationHistory ?? [];

  if (history.length === 0) {
    return (
      <div className="transcript-empty">
        No messages yet —{" "}
        <Link href={`/conversations/${escalationId}`}>open full conversation →</Link>
      </div>
    );
  }

  const visible = history.slice(-VISIBLE_COUNT);

  return (
    <div className="transcript-panel" aria-label="Recent messages">
      {visible.map((msg, i) => {
        const role: "lead" | "agent" | "owner" =
          msg.role === "user" || msg.role === "lead"
            ? "lead"
            : msg.role === "owner"
              ? "owner"
              : "agent";
        return (
          <div key={i} className={`transcript-row role-${role}`}>
            <div className="transcript-meta">
              <span className="transcript-role">{role}</span>
              <span className="transcript-time">{msg.timestamp}</span>
            </div>
            <div className="transcript-text">{msg.text}</div>
          </div>
        );
      })}
      <Link className="transcript-open-full" href={`/conversations/${escalationId}`}>
        Open full conversation →
      </Link>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/dashboard test -- transcript-panel.test`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/queue-cards/transcript-panel.tsx \
        apps/dashboard/src/components/console/queue-cards/__tests__/transcript-panel.test.tsx
git commit -m "feat(console): add TranscriptPanel for inline escalation transcript"
```

---

## Task 7: ReplyForm

**Files:**

- Create: `apps/dashboard/src/components/console/queue-cards/reply-form.tsx`
- Create: `apps/dashboard/src/components/console/queue-cards/__tests__/reply-form.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ReplyForm } from "../reply-form";

vi.mock("@/hooks/use-escalation-reply");

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(ui, { wrapper: Wrapper });
}

describe("ReplyForm", () => {
  it("calls onSent and clears the textarea on 200 success", async () => {
    const mod = await import("@/hooks/use-escalation-reply");
    const send = vi.fn().mockResolvedValue({ ok: true, escalation: { id: "e1" } });
    vi.mocked(mod.useEscalationReply).mockReturnValue({ send, isPending: false } as never);
    const onSent = vi.fn();
    const { container, getByLabelText } = wrap(
      <ReplyForm escalationId="e1" channelName="email" onSent={onSent} />,
    );
    const textarea = getByLabelText("Reply") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "thanks!" } });
    fireEvent.click(container.querySelector<HTMLButtonElement>(".reply-form-send")!);
    await waitFor(() => expect(onSent).toHaveBeenCalled());
    expect(textarea.value).toBe("");
  });

  it("preserves textarea and shows channel-aware error on 502", async () => {
    const mod = await import("@/hooks/use-escalation-reply");
    const send = vi
      .fn()
      .mockResolvedValue({
        ok: false,
        escalation: { id: "e1" },
        error: "channel delivery failed.",
      });
    vi.mocked(mod.useEscalationReply).mockReturnValue({ send, isPending: false } as never);
    const { container, getByLabelText } = wrap(
      <ReplyForm escalationId="e1" channelName="email" onSent={vi.fn()} />,
    );
    const textarea = getByLabelText("Reply") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "thanks!" } });
    fireEvent.click(container.querySelector<HTMLButtonElement>(".reply-form-send")!);
    await waitFor(() =>
      expect(container.querySelector(".reply-error")?.textContent).toMatch(
        /Couldn't deliver to email right now — channel delivery failed\./,
      ),
    );
    expect(textarea.value).toBe("thanks!");
  });

  it("preserves textarea and shows error message on thrown error", async () => {
    const mod = await import("@/hooks/use-escalation-reply");
    const send = vi.fn().mockRejectedValue(new Error("network down"));
    vi.mocked(mod.useEscalationReply).mockReturnValue({ send, isPending: false } as never);
    const { container, getByLabelText } = wrap(
      <ReplyForm escalationId="e1" channelName="sms" onSent={vi.fn()} />,
    );
    const textarea = getByLabelText("Reply") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "still here" } });
    fireEvent.click(container.querySelector<HTMLButtonElement>(".reply-form-send")!);
    await waitFor(() =>
      expect(container.querySelector(".reply-error")?.textContent).toMatch(/network down/),
    );
    expect(textarea.value).toBe("still here");
  });

  it("disables Send while pending", async () => {
    const mod = await import("@/hooks/use-escalation-reply");
    vi.mocked(mod.useEscalationReply).mockReturnValue({
      send: vi.fn().mockResolvedValue({ ok: true, escalation: { id: "e1" } }),
      isPending: true,
    } as never);
    const { container } = wrap(
      <ReplyForm escalationId="e1" channelName="email" onSent={vi.fn()} />,
    );
    expect(container.querySelector<HTMLButtonElement>(".reply-form-send")?.disabled).toBe(true);
  });

  it("does not submit empty text", async () => {
    const mod = await import("@/hooks/use-escalation-reply");
    const send = vi.fn();
    vi.mocked(mod.useEscalationReply).mockReturnValue({ send, isPending: false } as never);
    const { container } = wrap(
      <ReplyForm escalationId="e1" channelName="email" onSent={vi.fn()} />,
    );
    fireEvent.click(container.querySelector<HTMLButtonElement>(".reply-form-send")!);
    expect(send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- reply-form.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement ReplyForm**

Create `apps/dashboard/src/components/console/queue-cards/reply-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useEscalationReply } from "@/hooks/use-escalation-reply";

interface ReplyFormProps {
  escalationId: string;
  channelName: string;
  onSent: () => void;
}

export function ReplyForm({ escalationId, channelName, onSent }: ReplyFormProps) {
  const { send, isPending } = useEscalationReply(escalationId);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    if (!text.trim()) return;
    setError(null);
    try {
      const result = await send(text.trim());
      if (result.ok) {
        setText("");
        onSent();
      } else {
        const upstream = result.error ?? "channel delivery failed.";
        setError(`Couldn't deliver to ${channelName} right now — ${upstream}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reply.");
    }
  };

  return (
    <div className="reply-form">
      <textarea
        aria-label="Reply"
        className="reply-form-text"
        rows={3}
        value={text}
        disabled={isPending}
        onChange={(e) => setText(e.target.value)}
      />
      {error && (
        <p role="alert" className="reply-error">
          {error}
        </p>
      )}
      <div className="reply-form-actions">
        <button
          type="button"
          className="btn btn-primary-graphite reply-form-send"
          disabled={isPending}
          onClick={handleSend}
        >
          Send
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/dashboard test -- reply-form.test`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/queue-cards/reply-form.tsx \
        apps/dashboard/src/components/console/queue-cards/__tests__/reply-form.test.tsx
git commit -m "feat(console): add inline ReplyForm with channel-aware error path"
```

---

## Task 8: EscalationCardView (inline expand)

**Files:**

- Create: `apps/dashboard/src/components/console/queue-cards/escalation-card.tsx`
- Create: `apps/dashboard/src/components/console/queue-cards/__tests__/escalation-card.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { EscalationCardView } from "../escalation-card";
import type { EscalationCard } from "../../console-data";

vi.mock("@/hooks/use-escalation-reply");
vi.mock("@/hooks/use-escalations");

const card: EscalationCard = {
  kind: "escalation",
  id: "card-e1",
  escalationId: "e1",
  agent: "alex",
  contactName: "Jane Doe",
  channel: "email",
  timer: { label: "Urgent", ageDisplay: "4 min ago" },
  issue: ["asked about return policy"],
  primary: { label: "Send templated reply" },
  secondary: { label: "Escalate" },
  selfHandle: { label: "I'll handle" },
};

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(ui, { wrapper: Wrapper });
}

describe("EscalationCardView", () => {
  it("collapsed by default — no transcript or reply form", async () => {
    const escMod = await import("@/hooks/use-escalations");
    vi.mocked(escMod.useEscalationDetail).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    } as never);
    const replyMod = await import("@/hooks/use-escalation-reply");
    vi.mocked(replyMod.useEscalationReply).mockReturnValue({
      send: vi.fn(),
      isPending: false,
    } as never);
    const { container } = wrap(
      <EscalationCardView card={card} resolving={false} onResolve={vi.fn()} />,
    );
    expect(container.querySelector(".transcript-panel")).toBeNull();
    expect(container.querySelector(".reply-form")).toBeNull();
  });

  it("expands transcript + reply form on Reply inline click; caret rotates", async () => {
    const escMod = await import("@/hooks/use-escalations");
    vi.mocked(escMod.useEscalationDetail).mockReturnValue({
      data: { conversationHistory: [{ role: "lead", text: "hi", timestamp: "t" }] },
      isLoading: false,
      error: null,
    } as never);
    const replyMod = await import("@/hooks/use-escalation-reply");
    vi.mocked(replyMod.useEscalationReply).mockReturnValue({
      send: vi.fn(),
      isPending: false,
    } as never);
    const { container } = wrap(
      <EscalationCardView card={card} resolving={false} onResolve={vi.fn()} />,
    );
    fireEvent.click(container.querySelector<HTMLButtonElement>(".esc-reply")!);
    expect(container.querySelector(".transcript-panel")).not.toBeNull();
    expect(container.querySelector(".reply-form")).not.toBeNull();
    expect(container.querySelector(".esc-reply")?.classList.contains("is-open")).toBe(true);
  });

  it("primary button calls send + onResolve on success", async () => {
    const escMod = await import("@/hooks/use-escalations");
    vi.mocked(escMod.useEscalationDetail).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    } as never);
    const replyMod = await import("@/hooks/use-escalation-reply");
    const send = vi.fn().mockResolvedValue({ ok: true, escalation: { id: "e1" } });
    vi.mocked(replyMod.useEscalationReply).mockReturnValue({ send, isPending: false } as never);
    const onResolve = vi.fn();
    const { container } = wrap(
      <EscalationCardView card={card} resolving={false} onResolve={onResolve} />,
    );
    fireEvent.click(container.querySelector<HTMLButtonElement>(".btn-primary-coral")!);
    await waitFor(() => expect(onResolve).toHaveBeenCalled());
    expect(send).toHaveBeenCalled();
  });

  it("renders id=q-${card.id} on the card root", async () => {
    const escMod = await import("@/hooks/use-escalations");
    vi.mocked(escMod.useEscalationDetail).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    } as never);
    const replyMod = await import("@/hooks/use-escalation-reply");
    vi.mocked(replyMod.useEscalationReply).mockReturnValue({
      send: vi.fn(),
      isPending: false,
    } as never);
    const { container } = wrap(
      <EscalationCardView card={card} resolving={false} onResolve={vi.fn()} />,
    );
    expect(container.querySelector("#q-card-e1")).not.toBeNull();
  });

  it("applies is-resolving class when resolving=true", async () => {
    const escMod = await import("@/hooks/use-escalations");
    vi.mocked(escMod.useEscalationDetail).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    } as never);
    const replyMod = await import("@/hooks/use-escalation-reply");
    vi.mocked(replyMod.useEscalationReply).mockReturnValue({
      send: vi.fn(),
      isPending: false,
    } as never);
    const { container } = wrap(
      <EscalationCardView card={card} resolving={true} onResolve={vi.fn()} />,
    );
    expect(container.querySelector(".qcard")?.classList.contains("is-resolving")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- escalation-card.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement EscalationCardView**

Create `apps/dashboard/src/components/console/queue-cards/escalation-card.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { EscalationCard } from "../console-data";
import { useEscalationReply } from "@/hooks/use-escalation-reply";
import { capitalize } from "./rich-text";
import { RichTextSpan } from "./rich-text";
import { TranscriptPanel } from "./transcript-panel";
import { ReplyForm } from "./reply-form";

interface Props {
  card: EscalationCard;
  resolving: boolean;
  onResolve: () => void;
}

export function EscalationCardView({ card, resolving, onResolve }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { send, isPending } = useEscalationReply(card.escalationId);

  const handlePrimary = async () => {
    try {
      const result = await send(card.primary.label);
      if (result.ok) onResolve();
    } catch {
      // primary path uses the canned label; full error UI is in <ReplyForm>.
      // Keep the card in place so the operator can expand and retry.
    }
  };

  return (
    <article id={`q-${card.id}`} className={`qcard escalation${resolving ? " is-resolving" : ""}`}>
      <div>
        <div className="qhead">
          <span className="who">
            <span className="type">Escalation</span>
            <span className="sep">·</span>
            <span className="agent">{capitalize(card.agent)}</span>
          </span>
          <span className="timer">
            <span className="urgent">{card.timer.label}</span> · {card.timer.ageDisplay}
          </span>
        </div>
        <h3 className="esc-name">{card.contactName}</h3>
        <div className="esc-channel">{card.channel}</div>
        <p className="esc-issue">
          <RichTextSpan value={card.issue} />
        </p>
        <button
          className={`esc-reply${expanded ? " is-open" : ""}`}
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          Reply inline <span className="caret">▾</span>
        </button>
        {expanded && (
          <div className="esc-panel">
            <TranscriptPanel escalationId={card.escalationId} />
            <ReplyForm
              escalationId={card.escalationId}
              channelName={card.channel}
              onSent={onResolve}
            />
          </div>
        )}
        <div className="qactions">
          <button
            className="btn btn-primary-coral"
            type="button"
            disabled={isPending}
            onClick={handlePrimary}
          >
            {card.primary.label}
          </button>
          <button className="btn btn-ghost" type="button">
            {card.secondary.label}
          </button>
          <button className="btn btn-text" type="button">
            {card.selfHandle.label}
          </button>
        </div>
      </div>
    </article>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/dashboard test -- escalation-card.test`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/queue-cards/escalation-card.tsx \
        apps/dashboard/src/components/console/queue-cards/__tests__/escalation-card.test.tsx
git commit -m "feat(console): inline transcript + reply on escalation cards"
```

---

## Task 9: RecommendationCardView (visual-only handlers)

**Files:**

- Create: `apps/dashboard/src/components/console/queue-cards/recommendation-card.tsx`
- Create: `apps/dashboard/src/components/console/queue-cards/__tests__/recommendation-card.test.tsx`

**Note:** This task assumes Phase 1 has shipped `useToast()` from a `<ToastProvider>`. The card calls `useToast().showToast(...)` directly. The test wraps in a `<ToastProvider>`.

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ToastProvider } from "../../toast/toast-context"; // Phase 1 location
import { RecommendationCardView } from "../recommendation-card";
import type { RecommendationCard } from "../../console-data";

const card: RecommendationCard = {
  kind: "recommendation",
  id: "card-r1",
  agent: "nova",
  action: "Pause Whitening Ad Set B",
  timer: { label: "Immediate", confidence: "0.87" },
  dataLines: [["spend $42 last 24h"]],
  primary: { label: "Pause" },
  secondary: { label: "Reduce 50%" },
  dismiss: { label: "Dismiss" },
};

function wrap(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe("RecommendationCardView", () => {
  it("primary fires non-undoable toast and onResolve", () => {
    const onResolve = vi.fn();
    const { container } = wrap(
      <RecommendationCardView card={card} resolving={false} onResolve={onResolve} />,
    );
    fireEvent.click(container.querySelector<HTMLButtonElement>(".btn-primary-graphite")!);
    expect(onResolve).toHaveBeenCalled();
    // Toast: bottom-center pill exists with "PAUSE" text and no Undo button
    const toast = document.querySelector(".toast");
    expect(toast?.querySelector(".undo")).toBeNull();
  });

  it("secondary fires non-undoable toast and onResolve", () => {
    const onResolve = vi.fn();
    const { container } = wrap(
      <RecommendationCardView card={card} resolving={false} onResolve={onResolve} />,
    );
    fireEvent.click(container.querySelector<HTMLButtonElement>(".btn-ghost")!);
    expect(onResolve).toHaveBeenCalled();
  });

  it("dismiss fires non-undoable toast and onResolve", () => {
    const onResolve = vi.fn();
    const { container } = wrap(
      <RecommendationCardView card={card} resolving={false} onResolve={onResolve} />,
    );
    fireEvent.click(container.querySelector<HTMLButtonElement>(".btn-text")!);
    expect(onResolve).toHaveBeenCalled();
  });

  it("renders id=q-${card.id}", () => {
    const { container } = wrap(
      <RecommendationCardView card={card} resolving={false} onResolve={vi.fn()} />,
    );
    expect(container.querySelector("#q-card-r1")).not.toBeNull();
  });

  it("applies is-resolving class when resolving=true", () => {
    const { container } = wrap(
      <RecommendationCardView card={card} resolving={true} onResolve={vi.fn()} />,
    );
    expect(container.querySelector(".qcard")?.classList.contains("is-resolving")).toBe(true);
  });
});
```

> **Plan-execution note:** The exact import path for `ToastProvider` depends on where Phase 1 placed the file. Check `git log -p -- apps/dashboard/src/components/console/` for the Phase 1 file. If Phase 1 placed `<ToastProvider>` at a different relative path, fix the import in this test before running it.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- recommendation-card.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement RecommendationCardView**

Create `apps/dashboard/src/components/console/queue-cards/recommendation-card.tsx`:

```tsx
"use client";

import type { RecommendationCard } from "../console-data";
import { useToast } from "../toast/toast-context"; // adjust to Phase 1 actual path
import { capitalize, RichTextSpan } from "./rich-text";

interface Props {
  card: RecommendationCard;
  resolving: boolean;
  onResolve: () => void;
}

export function RecommendationCardView({ card, resolving, onResolve }: Props) {
  const { showToast } = useToast();

  const fire = (label: string, detail: string) => {
    showToast({ title: label.toUpperCase(), detail, undoable: false });
    onResolve();
  };

  return (
    <article
      id={`q-${card.id}`}
      className={`qcard recommendation${resolving ? " is-resolving" : ""}`}
    >
      <div>
        <div className="qhead">
          <span className="who">
            <span className="type">Recommendation</span>
            <span className="sep">·</span>
            <span className="agent">{capitalize(card.agent)}</span>
          </span>
          <span className="timer">
            <span className="urgent">{card.timer.label}</span> · conf{" "}
            <span className="conf">{card.timer.confidence}</span>
          </span>
        </div>
        <h3 className="rec-action">{card.action}</h3>
        <ul className="rec-data">
          {card.dataLines.map((line, i) => (
            <li key={i}>
              <RichTextSpan value={line} />
            </li>
          ))}
        </ul>
        <div className="qactions">
          <button
            className="btn btn-primary-graphite"
            type="button"
            onClick={() => fire(card.primary.label, card.action)}
          >
            {card.primary.label}
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => fire(card.secondary.label, card.action)}
          >
            {card.secondary.label}
          </button>
          <button
            className="btn btn-text"
            type="button"
            onClick={() => fire(card.dismiss.label, card.action)}
          >
            {card.dismiss.label}
          </button>
        </div>
      </div>
    </article>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/dashboard test -- recommendation-card.test`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/queue-cards/recommendation-card.tsx \
        apps/dashboard/src/components/console/queue-cards/__tests__/recommendation-card.test.tsx
git commit -m "feat(console): inline visual-only handlers on recommendation cards"
```

---

## Task 10: ApprovalGateCardView (inline approve/reject)

**Files:**

- Create: `apps/dashboard/src/components/console/queue-cards/approval-gate-card.tsx`
- Create: `apps/dashboard/src/components/console/queue-cards/__tests__/approval-gate-card.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ApprovalGateCardView } from "../approval-gate-card";
import type { ApprovalGateCard } from "../../console-data";

vi.mock("@/hooks/use-approval-action");

const card: ApprovalGateCard = {
  kind: "approval_gate",
  id: "card-a1",
  approvalId: "a1",
  bindingHash: "bh1",
  agent: "mira",
  jobName: "Whitening campaign",
  timer: { stageLabel: "Hooks ready", ageDisplay: "2h ago" },
  stageProgress: "Stage 2 of 5",
  stageDetail: "10 hooks ready",
  countdown: "gate closes in 21h",
  primary: { label: "Approve at stage 2" },
  stop: { label: "Stop job" },
};

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(ui, { wrapper: Wrapper });
}

describe("ApprovalGateCardView", () => {
  it("primary calls approve(bindingHash) + onResolve", async () => {
    const mod = await import("@/hooks/use-approval-action");
    const approve = vi.fn().mockResolvedValue({});
    const reject = vi.fn();
    vi.mocked(mod.useApprovalAction).mockReturnValue({
      approve,
      reject,
      isPending: false,
      error: null,
    } as never);
    const onResolve = vi.fn();
    const { container } = wrap(
      <ApprovalGateCardView card={card} resolving={false} onResolve={onResolve} />,
    );
    fireEvent.click(container.querySelector<HTMLButtonElement>(".btn-primary-graphite")!);
    await waitFor(() => expect(approve).toHaveBeenCalledWith("bh1"));
    expect(onResolve).toHaveBeenCalled();
  });

  it("reject calls reject(bindingHash) + onResolve", async () => {
    const mod = await import("@/hooks/use-approval-action");
    const approve = vi.fn();
    const reject = vi.fn().mockResolvedValue({});
    vi.mocked(mod.useApprovalAction).mockReturnValue({
      approve,
      reject,
      isPending: false,
      error: null,
    } as never);
    const onResolve = vi.fn();
    const { container } = wrap(
      <ApprovalGateCardView card={card} resolving={false} onResolve={onResolve} />,
    );
    fireEvent.click(container.querySelector<HTMLButtonElement>(".btn-ghost")!);
    await waitFor(() => expect(reject).toHaveBeenCalledWith("bh1"));
    expect(onResolve).toHaveBeenCalled();
  });

  it("shows .qerror row + leaves card on failure", async () => {
    const mod = await import("@/hooks/use-approval-action");
    const approve = vi.fn().mockRejectedValue(new Error("403 forbidden"));
    vi.mocked(mod.useApprovalAction).mockReturnValue({
      approve,
      reject: vi.fn(),
      isPending: false,
      error: null,
    } as never);
    const onResolve = vi.fn();
    const { container } = wrap(
      <ApprovalGateCardView card={card} resolving={false} onResolve={onResolve} />,
    );
    fireEvent.click(container.querySelector<HTMLButtonElement>(".btn-primary-graphite")!);
    await waitFor(() =>
      expect(container.querySelector(".qerror")?.textContent).toMatch(/403 forbidden/),
    );
    expect(onResolve).not.toHaveBeenCalled();
  });

  it("disables both buttons while pending", async () => {
    const mod = await import("@/hooks/use-approval-action");
    vi.mocked(mod.useApprovalAction).mockReturnValue({
      approve: vi.fn(),
      reject: vi.fn(),
      isPending: true,
      error: null,
    } as never);
    const { container } = wrap(
      <ApprovalGateCardView card={card} resolving={false} onResolve={vi.fn()} />,
    );
    expect(container.querySelector<HTMLButtonElement>(".btn-primary-graphite")?.disabled).toBe(
      true,
    );
    expect(container.querySelector<HTMLButtonElement>(".btn-ghost")?.disabled).toBe(true);
  });

  it("renders id=q-${card.id} and stop button", async () => {
    const mod = await import("@/hooks/use-approval-action");
    vi.mocked(mod.useApprovalAction).mockReturnValue({
      approve: vi.fn(),
      reject: vi.fn(),
      isPending: false,
      error: null,
    } as never);
    const { container } = wrap(
      <ApprovalGateCardView card={card} resolving={false} onResolve={vi.fn()} />,
    );
    expect(container.querySelector("#q-card-a1")).not.toBeNull();
    expect(container.querySelector(".stop")?.textContent).toMatch(/Stop job/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- approval-gate-card.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement ApprovalGateCardView**

Create `apps/dashboard/src/components/console/queue-cards/approval-gate-card.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { ApprovalGateCard } from "../console-data";
import { useApprovalAction } from "@/hooks/use-approval-action";
import { capitalize } from "./rich-text";

interface Props {
  card: ApprovalGateCard;
  resolving: boolean;
  onResolve: () => void;
}

export function ApprovalGateCardView({ card, resolving, onResolve }: Props) {
  const { approve, reject, isPending } = useApprovalAction(card.approvalId);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      onResolve();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval action failed");
    }
  };

  return (
    <article
      id={`q-${card.id}`}
      className={`qcard approval-gate${resolving ? " is-resolving" : ""}`}
    >
      <div>
        <div className="qhead">
          <span className="who">
            <span className="type">Approval Gate</span>
            <span className="sep">·</span>
            <span className="agent">{capitalize(card.agent)}</span>
          </span>
          <span className="timer">
            <span className="stage">{card.timer.stageLabel}</span> · {card.timer.ageDisplay}
          </span>
        </div>
        <h3 className="gate-job">{card.jobName}</h3>
        <div className="gate-prog">
          <span>{card.stageProgress}</span>
          <span className="sep">·</span>
          <span>{card.stageDetail}</span>
          <span className="sep">·</span>
          <span className="countdown">{card.countdown}</span>
        </div>
        {error && (
          <p role="alert" className="qerror">
            Approval failed — {error}
          </p>
        )}
        <div className="qactions">
          <button
            className="btn btn-primary-graphite"
            type="button"
            disabled={isPending}
            onClick={() => run(() => approve(card.bindingHash))}
          >
            {card.primary.label}
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            disabled={isPending}
            onClick={() => run(() => reject(card.bindingHash))}
          >
            Reject
          </button>
        </div>
      </div>
      <div className="qside">
        <button className="stop" type="button">
          {card.stop.label}
        </button>
      </div>
    </article>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/dashboard test -- approval-gate-card.test`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/queue-cards/approval-gate-card.tsx \
        apps/dashboard/src/components/console/queue-cards/__tests__/approval-gate-card.test.tsx
git commit -m "feat(console): inline approve/reject on approval gate cards"
```

---

## Task 11: queue-cards/index.tsx dispatcher

**Files:**

- Create: `apps/dashboard/src/components/console/queue-cards/index.tsx`
- Create: `apps/dashboard/src/components/console/queue-cards/__tests__/index.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { QueueCardView } from "../index";
import type { QueueCard } from "../../console-data";
import { ToastProvider } from "../../toast/toast-context"; // adjust per Phase 1

vi.mock("@/hooks/use-escalations");
vi.mock("@/hooks/use-escalation-reply");
vi.mock("@/hooks/use-approval-action");

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  return render(ui, { wrapper: Wrapper });
}

const escalation: QueueCard = {
  kind: "escalation",
  id: "card-e1",
  escalationId: "e1",
  agent: "alex",
  contactName: "n",
  channel: "email",
  timer: { label: "Urgent", ageDisplay: "1m" },
  issue: ["x"],
  primary: { label: "Send" },
  secondary: { label: "Esc" },
  selfHandle: { label: "Self" },
};
const recommendation: QueueCard = {
  kind: "recommendation",
  id: "card-r1",
  agent: "nova",
  action: "do thing",
  timer: { label: "Immediate", confidence: "0.9" },
  dataLines: [["x"]],
  primary: { label: "Go" },
  secondary: { label: "Maybe" },
  dismiss: { label: "No" },
};
const approval: QueueCard = {
  kind: "approval_gate",
  id: "card-a1",
  approvalId: "a1",
  bindingHash: "bh",
  agent: "mira",
  jobName: "j",
  timer: { stageLabel: "s", ageDisplay: "1h" },
  stageProgress: "1/5",
  stageDetail: "d",
  countdown: "21h",
  primary: { label: "Approve" },
  stop: { label: "Stop" },
};

describe("QueueCardView dispatcher", () => {
  beforeEach(async () => {
    const escMod = await import("@/hooks/use-escalations");
    vi.mocked(escMod.useEscalationDetail).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    } as never);
    const replyMod = await import("@/hooks/use-escalation-reply");
    vi.mocked(replyMod.useEscalationReply).mockReturnValue({
      send: vi.fn(),
      isPending: false,
    } as never);
    const apMod = await import("@/hooks/use-approval-action");
    vi.mocked(apMod.useApprovalAction).mockReturnValue({
      approve: vi.fn(),
      reject: vi.fn(),
      isPending: false,
      error: null,
    } as never);
  });

  it("dispatches escalation kind to EscalationCardView", () => {
    const { container } = wrap(
      <QueueCardView card={escalation} resolving={false} onResolve={vi.fn()} />,
    );
    expect(container.querySelector(".qcard.escalation")).not.toBeNull();
  });
  it("dispatches recommendation kind", () => {
    const { container } = wrap(
      <QueueCardView card={recommendation} resolving={false} onResolve={vi.fn()} />,
    );
    expect(container.querySelector(".qcard.recommendation")).not.toBeNull();
  });
  it("dispatches approval_gate kind", () => {
    const { container } = wrap(
      <QueueCardView card={approval} resolving={false} onResolve={vi.fn()} />,
    );
    expect(container.querySelector(".qcard.approval-gate")).not.toBeNull();
  });
  it("forwards resolving prop to children", () => {
    const { container } = wrap(
      <QueueCardView card={recommendation} resolving={true} onResolve={vi.fn()} />,
    );
    expect(container.querySelector(".qcard")?.classList.contains("is-resolving")).toBe(true);
  });
});
```

> **Note for executor:** add `import { beforeEach } from "vitest";` at the top alongside `describe/it/expect/vi`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- queue-cards/__tests__/index.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the dispatcher**

Create `apps/dashboard/src/components/console/queue-cards/index.tsx`:

```tsx
"use client";

import type { QueueCard } from "../console-data";
import { EscalationCardView } from "./escalation-card";
import { RecommendationCardView } from "./recommendation-card";
import { ApprovalGateCardView } from "./approval-gate-card";

export { EscalationCardView } from "./escalation-card";
export { RecommendationCardView } from "./recommendation-card";
export { ApprovalGateCardView } from "./approval-gate-card";
export { RichTextSpan, capitalize } from "./rich-text";

interface QueueCardViewProps {
  card: QueueCard;
  resolving: boolean;
  onResolve: () => void;
}

export function QueueCardView({ card, resolving, onResolve }: QueueCardViewProps) {
  switch (card.kind) {
    case "escalation":
      return <EscalationCardView card={card} resolving={resolving} onResolve={onResolve} />;
    case "recommendation":
      return <RecommendationCardView card={card} resolving={resolving} onResolve={onResolve} />;
    case "approval_gate":
      return <ApprovalGateCardView card={card} resolving={resolving} onResolve={onResolve} />;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/dashboard test -- queue-cards/__tests__/index.test`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/queue-cards/index.tsx \
        apps/dashboard/src/components/console/queue-cards/__tests__/index.test.tsx
git commit -m "feat(console): queue-cards dispatcher with new resolving/onResolve contract"
```

---

## Task 12: Update QueueZone — resolvingIds + beginResolve

**Files:**

- Modify: `apps/dashboard/src/components/console/zones/queue-zone.tsx`
- Create: `apps/dashboard/src/components/console/zones/__tests__/queue-zone.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/components/console/zones/__tests__/queue-zone.test.tsx`:

```tsx
import { act, render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { QueueZone } from "../queue-zone";

vi.mock("@/hooks/use-escalations");
vi.mock("@/hooks/use-approvals");
vi.mock("@/hooks/use-escalation-reply");
vi.mock("@/hooks/use-approval-action");

const escRow = {
  id: "e1",
  contactName: "Jane",
  channel: "email",
  agent: "alex",
  issue: "asked about returns",
  createdAt: new Date().toISOString(),
  ageMinutes: 4,
  isUrgent: true,
};

function wrap(ui: React.ReactElement, qc?: QueryClient) {
  const client = qc ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { ...render(ui, { wrapper: Wrapper }), client };
}

async function mockHooks(escalations: unknown[], approvals: unknown[]) {
  const escMod = await import("@/hooks/use-escalations");
  vi.mocked(escMod.useEscalations).mockReturnValue({
    data: { escalations },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  } as never);
  vi.mocked(escMod.useEscalationDetail).mockReturnValue({
    data: undefined,
    isLoading: false,
    error: null,
  } as never);
  const apMod = await import("@/hooks/use-approvals");
  vi.mocked(apMod.useApprovals).mockReturnValue({
    data: { approvals },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  } as never);
  const replyMod = await import("@/hooks/use-escalation-reply");
  vi.mocked(replyMod.useEscalationReply).mockReturnValue({
    send: vi.fn().mockResolvedValue({ ok: true, escalation: { id: "e1" } }),
    isPending: false,
  } as never);
  const acMod = await import("@/hooks/use-approval-action");
  vi.mocked(acMod.useApprovalAction).mockReturnValue({
    approve: vi.fn(),
    reject: vi.fn(),
    isPending: false,
    error: null,
  } as never);
}

describe("QueueZone resolvingIds + beginResolve", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies is-resolving class on the card when its onResolve fires", async () => {
    await mockHooks([escRow], []);
    const { container } = wrap(<QueueZone />);
    const escCard = container.querySelector(".qcard.escalation") as HTMLElement;
    expect(escCard.classList.contains("is-resolving")).toBe(false);
    // Click the primary button which calls onResolve via the escalation card's send success path
    const primary = escCard.querySelector<HTMLButtonElement>(".btn-primary-coral")!;
    await act(async () => {
      primary.click();
    });
    expect(escCard.classList.contains("is-resolving")).toBe(true);
  });

  it("invalidates queries 320ms after resolve", async () => {
    await mockHooks([escRow], []);
    const { container, client } = wrap(<QueueZone />);
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const primary = container.querySelector<HTMLButtonElement>(".btn-primary-coral")!;
    await act(async () => {
      primary.click();
    });
    expect(invalidateSpy).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(320);
    });
    expect(invalidateSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- queue-zone.test`
Expected: FAIL — `QueueZone` still expects `onOpenSlideOver` and does not own `resolvingIds`.

- [ ] **Step 3: Implement the new QueueZone**

Replace the entire contents of `apps/dashboard/src/components/console/zones/queue-zone.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useApprovals } from "@/hooks/use-approvals";
import { useEscalations } from "@/hooks/use-escalations";
import { queryKeys } from "@/lib/query-keys";
import { QueueCardView } from "../queue-cards";
import { mapQueue, type ApprovalApiRow, type EscalationApiRow } from "../console-mappers";
import { ZoneEmpty, ZoneError, ZoneSkeleton } from "./zone-states";

const RESOLVE_DURATION_MS = 320;

export function QueueZone() {
  const escalations = useEscalations();
  const approvals = useApprovals();
  const queryClient = useQueryClient();
  const [resolvingIds, setResolvingIds] = useState<Set<string>>(() => new Set());

  const beginResolve = useCallback(
    (cardId: string) => {
      setResolvingIds((prev) => {
        const next = new Set(prev);
        next.add(cardId);
        return next;
      });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: queryKeys.escalations.all });
        queryClient.invalidateQueries({ queryKey: queryKeys.approvals.pending() });
        setResolvingIds((prev) => {
          const next = new Set(prev);
          next.delete(cardId);
          return next;
        });
      }, RESOLVE_DURATION_MS);
    },
    [queryClient],
  );

  if (escalations.isLoading || approvals.isLoading) {
    return <ZoneSkeleton label="Loading queue" />;
  }

  if (escalations.error || approvals.error) {
    return (
      <ZoneError
        message="Couldn't load queue."
        onRetry={() => {
          escalations.refetch();
          approvals.refetch();
        }}
      />
    );
  }

  const escalationRows: EscalationApiRow[] =
    (escalations.data as { escalations?: EscalationApiRow[] } | undefined)?.escalations ?? [];
  const approvalRows: ApprovalApiRow[] =
    (approvals.data as { approvals?: ApprovalApiRow[] } | undefined)?.approvals ?? [];

  const cards = mapQueue(escalationRows, approvalRows, new Date());

  if (cards.length === 0) {
    return <ZoneEmpty message="No queue items right now." />;
  }

  return (
    <section aria-label="Queue">
      <div className="queue-head">
        <Link className="label" href="/escalations">
          Queue
        </Link>
        <span className="count">{cards.length} pending</span>
      </div>
      <div className="queue">
        {cards.map((card) => (
          <QueueCardView
            key={card.id}
            card={card}
            resolving={resolvingIds.has(card.id)}
            onResolve={() => beginResolve(card.id)}
          />
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/dashboard test -- queue-zone.test`
Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/zones/queue-zone.tsx \
        apps/dashboard/src/components/console/zones/__tests__/queue-zone.test.tsx
git commit -m "feat(console): QueueZone owns resolvingIds + setTimeout invalidate"
```

---

## Task 13: Add CSS for fade-out resolve, esc-panel, transcript, reply form, qerror

**Files:**

- Modify: `apps/dashboard/src/components/console/console.css`

- [ ] **Step 1: Append the new rules to console.css**

Open `apps/dashboard/src/components/console/console.css` and append at the end of the file (all selectors prefixed with `[data-v6-console]`):

```css
/* ---------- Phase 2 — fade-out resolve ---------- */
[data-v6-console] .qcard {
  transition:
    opacity 220ms ease,
    transform 220ms ease,
    max-height 320ms ease,
    margin 320ms ease,
    padding 320ms ease;
  overflow: hidden;
}
[data-v6-console] .qcard.is-resolving {
  opacity: 0;
  transform: translateY(-4px);
  max-height: 0;
  margin-top: 0;
  margin-bottom: 0;
  padding-top: 0;
  padding-bottom: 0;
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  [data-v6-console] .qcard,
  [data-v6-console] .qcard.is-resolving {
    transition: none;
  }
}

/* ---------- Phase 2 — escalation inline panel ---------- */
[data-v6-console] .esc-reply.is-open .caret {
  transform: rotate(180deg);
}
[data-v6-console] .esc-panel {
  border-top: 1px dashed var(--c-hair);
  padding: 0.85rem 0;
  margin-bottom: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

/* ---------- Phase 2 — transcript rows ---------- */
[data-v6-console] .transcript-panel {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}
[data-v6-console] .transcript-row {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.5rem 0.65rem;
  border-radius: 4px;
  background: var(--c-bg-2);
  max-width: 80%;
}
[data-v6-console] .transcript-row.role-lead {
  align-self: flex-start;
}
[data-v6-console] .transcript-row.role-agent,
[data-v6-console] .transcript-row.role-owner {
  align-self: flex-end;
}
[data-v6-console] .transcript-row.role-owner {
  background: hsl(from var(--c-coral) h s 96%);
}
[data-v6-console] .transcript-meta {
  display: inline-flex;
  gap: 0.5rem;
  align-items: baseline;
}
[data-v6-console] .transcript-role {
  font-family: var(--c-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--c-text-3);
}
[data-v6-console] .transcript-time {
  font-family: var(--c-mono);
  font-size: 10px;
  color: var(--c-text-4);
}
[data-v6-console] .transcript-text {
  font-size: 0.875rem;
  color: var(--c-text-2);
  line-height: 1.5;
}
[data-v6-console] .transcript-skeleton {
  height: 1.5rem;
  background: linear-gradient(90deg, var(--c-hair), var(--c-bg-2), var(--c-hair));
  background-size: 200% 100%;
  animation: console-pulse 1.4s ease-in-out infinite;
  max-width: 60%;
}
[data-v6-console] .transcript-empty,
[data-v6-console] .transcript-error,
[data-v6-console] .transcript-loading {
  font-size: 0.85rem;
  color: var(--c-text-3);
}
[data-v6-console] .transcript-open-full {
  align-self: flex-start;
  font-family: var(--c-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--c-text-2);
  border-bottom: 1px dashed var(--c-hair);
  padding: 0 0 0.2rem 0;
}

/* ---------- Phase 2 — inline reply form ---------- */
[data-v6-console] .reply-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
[data-v6-console] .reply-form-text {
  width: 100%;
  border: 1px solid var(--c-hair);
  background: var(--c-bg);
  padding: 0.55rem 0.65rem;
  font-family: var(--c-sans);
  font-size: 0.9rem;
  color: var(--c-text);
  border-radius: 2px;
  resize: vertical;
}
[data-v6-console] .reply-form-text:focus {
  outline: 1px solid var(--c-text-3);
  outline-offset: 1px;
}
[data-v6-console] .reply-form-actions {
  display: flex;
  gap: 0.6rem;
}
[data-v6-console] .reply-error {
  font-size: 0.85rem;
  color: var(--c-coral);
}

/* ---------- Phase 2 — approval inline error ---------- */
[data-v6-console] .qerror {
  font-size: 0.85rem;
  color: var(--c-coral);
  margin-bottom: 0.6rem;
}
```

> **Note:** if `--c-bg-2` does not exist in the existing token set, fall back to `var(--c-bg)`; tokens are defined at the top of `console.css`. Match existing values; do not invent new ones.

- [ ] **Step 2: Verify the CSS compiles (Next.js dev server picks up changes; rely on the next typecheck/test cycle)**

Run: `pnpm --filter @switchboard/dashboard lint`
Expected: PASS (no CSS syntax linter, but ESLint should not complain about unrelated changes).

- [ ] **Step 3: Run the queue tests to confirm class hooks still match**

Run: `pnpm --filter @switchboard/dashboard test -- queue-zone.test escalation-card.test approval-gate-card.test recommendation-card.test`
Expected: PASS — class names referenced in tests (`is-resolving`, `esc-panel`, `transcript-panel`, `reply-form`, `qerror`) match the CSS.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/console/console.css
git commit -m "feat(console): CSS for fade-out resolve, esc-panel, transcript, reply form, qerror"
```

---

## Task 14: Update ConsoleView — drop slide-overs, keep HaltProvider wrap

**Files:**

- Modify: `apps/dashboard/src/components/console/console-view.tsx`
- Modify: `apps/dashboard/src/components/console/__tests__/console-view.test.tsx`

- [ ] **Step 1: Update the existing console-view.test.tsx**

Open `apps/dashboard/src/components/console/__tests__/console-view.test.tsx`. Remove any `slideOver` / `<ApprovalSlideOver>` / `<EscalationSlideOver>` assertions. Add a test asserting no slide-over is rendered:

```tsx
it("does not render approval or escalation slide-overs", async () => {
  // (use the existing mockAllZoneHooks helper in this file or copy the one from console-view-halt.test)
  await mockAllZoneHooksLoaded();
  const { container } = render(<ConsoleView />, { wrapper });
  expect(container.querySelector("[data-slot='dialog-content']")).toBeNull();
  expect(container.querySelector("[role='dialog']")).toBeNull();
});
```

(The exact selector for the slide-over content depends on `console-slide-over.tsx`. Looking at the source: the wrapper renders a `<Sheet>`/`<Dialog>` from shadcn. After deletion, no element with `role=dialog` should appear.)

- [ ] **Step 2: Run tests to confirm the new assertion fails on the current implementation**

Run: `pnpm --filter @switchboard/dashboard test -- console-view.test`
Expected: this specific assertion may already pass if no slide-over is open by default — but the imports in `console-view.tsx` still pull in dead code. Continue to Step 3.

- [ ] **Step 3: Trim ConsoleView**

Open `apps/dashboard/src/components/console/console-view.tsx`. Remove:

- `import { ApprovalSlideOver } from "./slide-overs/approval-slide-over";`
- `import { EscalationSlideOver } from "./slide-overs/escalation-slide-over";`
- The `SlideOverState` type alias.
- The `const [slideOver, setSlideOver] = useState<SlideOverState>(null);` line.
- The two `{slideOver?.kind === "..." && (...)}` blocks.

Update the `<QueueZone />` invocation to pass no props (its prop signature changed in Task 12).

The simplified render tree (assuming Phase 1 chrome wiring stays inside `ConsoleViewBody`):

```tsx
function ConsoleViewBody() {
  // (Phase 1 helpOpen / showToast / WelcomeBanner / HelpOverlay / ToastShelf wiring stays)
  const { halted, setHalted, toggleHalt } = useHalt();
  // ... keyboard shortcut wiring from Task 3 ...

  return (
    <div data-v6-console>
      <OpStrip onHelpOpen={() => setHelpOpen(true)} />
      <main className="console-main">
        <WelcomeBanner />
        <QueueZone />
        <AgentStrip />
        <NovaPanel />
        <ActivityTrail />
      </main>
      {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
      <ToastShelf />
    </div>
  );
}

export function ConsoleView() {
  return (
    <HaltProvider>
      <ConsoleViewBody />
    </HaltProvider>
  );
}
```

If Phase 1's `<ToastProvider>` wraps the children, place it inside `<HaltProvider>` so the keyboard handler can call both `useHalt()` and `useToast()`:

```tsx
export function ConsoleView() {
  return (
    <HaltProvider>
      <ToastProvider>
        <ConsoleViewBody />
      </ToastProvider>
    </HaltProvider>
  );
}
```

- [ ] **Step 4: Run all console tests**

Run: `pnpm --filter @switchboard/dashboard test -- console-view`
Expected: PASS — both `console-view.test.tsx` and `console-view-halt.test.tsx` green.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/console-view.tsx \
        apps/dashboard/src/components/console/__tests__/console-view.test.tsx
git commit -m "refactor(console): drop slide-over wiring from ConsoleView"
```

---

## Task 15: Delete old queue-cards.tsx + slide-overs/ directory

**Files:**

- Delete: `apps/dashboard/src/components/console/queue-cards.tsx`
- Delete: `apps/dashboard/src/components/console/slide-overs/console-slide-over.tsx`
- Delete: `apps/dashboard/src/components/console/slide-overs/escalation-slide-over.tsx`
- Delete: `apps/dashboard/src/components/console/slide-overs/approval-slide-over.tsx`
- Delete: `apps/dashboard/src/components/console/slide-overs/__tests__/console-slide-over.test.tsx`
- Delete: `apps/dashboard/src/components/console/slide-overs/__tests__/escalation-slide-over.test.tsx`
- Delete: `apps/dashboard/src/components/console/slide-overs/__tests__/approval-slide-over.test.tsx`

- [ ] **Step 1: Verify zero remaining imports**

Run:

```bash
grep -rn "from \"\./queue-cards\"\|from \"\.\./queue-cards\"\|slide-overs/" apps/dashboard/src/
```

Expected: matches limited to the files being deleted in this task. The new `queue-cards/index.tsx` directory import (`from "../queue-cards"`) resolves via Node's directory-index resolution and is fine.

If any production file outside `slide-overs/` imports from `slide-overs/`, fix it before deleting.

- [ ] **Step 2: Delete the files**

```bash
git rm apps/dashboard/src/components/console/queue-cards.tsx
git rm -r apps/dashboard/src/components/console/slide-overs/
```

- [ ] **Step 3: Run typecheck + full dashboard tests**

Run:

```bash
pnpm --filter @switchboard/dashboard typecheck
pnpm --filter @switchboard/dashboard test
```

Expected: typecheck clean; entire dashboard test suite green.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(console): remove legacy queue-cards.tsx and slide-overs/ directory"
```

---

## Task 16: End-to-end verification

**Files:** none modified — verification only.

- [ ] **Step 1: Lint**

Run: `pnpm --filter @switchboard/dashboard lint`
Expected: PASS, zero errors.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS, zero errors.

- [ ] **Step 3: Full test suite**

Run: `pnpm --filter @switchboard/dashboard test`
Expected: PASS.

- [ ] **Step 4: File-size check (CLAUDE.md soft cap)**

Run:

```bash
find apps/dashboard/src/components/console -type f \( -name '*.ts' -o -name '*.tsx' \) -exec wc -l {} + | awk '$1 > 400 { print }'
```

Expected: empty output (no file over 400 lines).

- [ ] **Step 5: Source-search for the dropped patterns**

Run:

```bash
grep -rn "useHaltState\|use-halt-state\|document\.querySelector.*op-halt\|onOpenSlideOver\|ApprovalSlideOver\|EscalationSlideOver" apps/dashboard/src/
```

Expected: empty output.

- [ ] **Step 6: Manual smoke (dev server)**

Run `pnpm dev` (or whichever launches the dashboard on port 3002) and on `/console`:

- Click `Reply inline ▾` on an Escalation card → transcript + textarea appear above the buttons.
- Send a reply → card fades out (~220ms opacity, ~320ms collapse), next card rises.
- Approve / Reject on an Approval Gate card → fades on success.
- Recommendation primary/secondary/dismiss → fade + non-undoable toast.
- OpStrip Halt button → halted styling, undoable toast.
- Press `H` → toggles halted state. Press `H` again → back to live. No double-toggle.
- Search source for `.op-halt"?.click()` — zero matches.

- [ ] **Step 7: Final commit (if any incidental fixes were needed during verification)**

```bash
# only if there were fixups
git add -A
git commit -m "chore(console): verification fixups for Phase 2"
```

---

## Self-Review Checklist (post-write)

**Spec coverage:** every section/requirement in the spec maps to a task —

- Halt context lift → Task 1 + Task 2 + Task 3 + Task 4
- Queue split → Task 5 (rich-text) + Task 6 (transcript) + Task 7 (reply form) + Task 8 (escalation) + Task 9 (recommendation) + Task 10 (approval) + Task 11 (dispatcher)
- Fade-out resolve animation → Task 12 (state) + Task 13 (CSS)
- Slide-over removal → Task 14 (drop wiring) + Task 15 (delete files)
- ConsoleView updates → Task 14
- console-view-halt test rewrite → Task 3 (the test gets rewritten as part of the same commit that wires the new behavior)
- `id="q-${card.id}"` on card root → enforced by Task 8 / 9 / 10 tests
- `prefers-reduced-motion` → Task 13
- End-to-end checks → Task 16

**Placeholder scan:** none.

**Type consistency:**

- `QueueCardViewProps`, `EscalationCardView`, `RecommendationCardView`, `ApprovalGateCardView` all take `{ card, resolving, onResolve }` — same shape across Tasks 8/9/10/11/12.
- `useHalt()` returns `{ halted, setHalted, toggleHalt }` — used identically in Tasks 1, 2, 3.
- `useEscalationReply(escalationId).send(text) → Promise<{ ok, escalation, error? }>` — matches the existing hook (Task 7 + Task 8).
- `useApprovalAction(approvalId).{approve, reject}(bindingHash) → Promise<unknown>` — matches the existing hook (Task 10).
- `queryKeys.escalations.all` and `queryKeys.approvals.pending()` — both exist in `apps/dashboard/src/lib/query-keys.ts`; used in Task 12.
- `RESOLVE_DURATION_MS = 320` matches the longest CSS transition in Task 13.

**Open carry-overs from spec, intentionally deferred (not bugs):**

- Real backend Halt — own spec.
- Recommendation backend wiring — own spec.
- Full threaded transcript rendering — Phase 3.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-03-console-frame-phase-2.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for this plan because the task chain has clear contracts and most steps run in isolation.

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints. Use this if you want to follow each step in real time.

**Which approach?**
