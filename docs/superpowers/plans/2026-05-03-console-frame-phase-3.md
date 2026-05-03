# Console Frame Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the `/console` Agent strip to expand into per-agent panels (Nova / Alex / Mira). Mutual-exclusive single-panel slot; default-Nova-on-first-visit; `1/2/3` keyboard toggles; per-agent today-stats from real data; Nova → queue cross-link reuses Phase 2's `id="q-${cardId}"` scroll targets.

**Architecture:** Foundation first — pure helpers (`format.ts`, `scroll-to-card.ts`, `agent-stats.ts`) before UI. Add an `<ExpandedAgentProvider>` context mirroring Phase 2's `<HaltProvider>` shape (state-only, `localStorage`-persisted). Build the three panel files independently under a new `panels/` directory, then a thin `<AgentsZone>` wrapper that conditionally renders the active panel. Modify `<AgentStrip>` to toggle expansion via the provider and render real stats. Extend `use-keyboard-shortcuts.ts` with `1/2/3` handlers. Wire it all together in `console-view.tsx`.

**Tech Stack:** React 18, Next.js 14 (App Router), TanStack React Query 5, Vitest + @testing-library/react. Existing shared hooks `useAdOptimizerAudit`, `useConversations`, `useCreativeJobs`, `useApprovals`, `useModuleStatus`, `useScopedQueryKeys` reused unchanged.

**Spec:** [`docs/superpowers/specs/2026-05-03-console-frame-phase-3-design.md`](../specs/2026-05-03-console-frame-phase-3-design.md) (committed on `feat/console-frame-phase-3`).

**Prerequisite:** Phase 2 (commit `cffb3c17` on `main`) must be merged. The plan rewrites `agent-strip.tsx` (currently `zones/agent-strip.tsx`), moves `zones/nova-panel.tsx` to `panels/nova-panel.tsx`, and extends `console-view.tsx` to wrap with `<ExpandedAgentProvider>`.

---

## File Map

**New files:**

- `apps/dashboard/src/components/console/expanded-agent-context.tsx`
- `apps/dashboard/src/components/console/__tests__/expanded-agent-context.test.tsx`
- `apps/dashboard/src/components/console/panels/format.ts`
- `apps/dashboard/src/components/console/panels/scroll-to-card.ts`
- `apps/dashboard/src/components/console/panels/agent-stats.ts`
- `apps/dashboard/src/components/console/panels/panel-chrome.tsx`
- `apps/dashboard/src/components/console/panels/nova-panel.tsx`
- `apps/dashboard/src/components/console/panels/nova-campaign-table.tsx`
- `apps/dashboard/src/components/console/panels/nova-recommendation-note.tsx`
- `apps/dashboard/src/components/console/panels/alex-panel.tsx`
- `apps/dashboard/src/components/console/panels/mira-panel.tsx`
- `apps/dashboard/src/components/console/panels/__tests__/format.test.ts`
- `apps/dashboard/src/components/console/panels/__tests__/scroll-to-card.test.ts`
- `apps/dashboard/src/components/console/panels/__tests__/agent-stats.test.ts`
- `apps/dashboard/src/components/console/panels/__tests__/panel-chrome.test.tsx`
- `apps/dashboard/src/components/console/panels/__tests__/nova-panel.test.tsx`
- `apps/dashboard/src/components/console/panels/__tests__/nova-campaign-table.test.tsx`
- `apps/dashboard/src/components/console/panels/__tests__/nova-recommendation-note.test.tsx`
- `apps/dashboard/src/components/console/panels/__tests__/alex-panel.test.tsx`
- `apps/dashboard/src/components/console/panels/__tests__/mira-panel.test.tsx`
- `apps/dashboard/src/components/console/zones/agents-zone.tsx`
- `apps/dashboard/src/components/console/zones/__tests__/agents-zone.test.tsx`

**Modified:**

- `apps/dashboard/src/components/console/zones/agent-strip.tsx` (drop `.zone3` wrapper + `.zone-head`, drop `enabledMap`/`activeKey`, drop nested `<Link>`, wire `toggle()` + stats)
- `apps/dashboard/src/components/console/zones/__tests__/agent-strip.test.tsx` (rewrite to match new behavior)
- `apps/dashboard/src/components/console/use-keyboard-shortcuts.ts` (add `agent1`/`agent2`/`agent3` handlers)
- `apps/dashboard/src/components/console/__tests__/use-keyboard-shortcuts.test.ts` (add coverage for new keys)
- `apps/dashboard/src/components/console/console-view.tsx` (wrap with `<ExpandedAgentProvider>`, register keyboard handlers, render `<AgentsZone />`)
- `apps/dashboard/src/components/console/__tests__/console-view.test.tsx` (assert new provider tree + keyboard wiring)
- `apps/dashboard/src/components/console/console.css` (panel-expand keyframe, `.conv-list`, `.creative-list`, `.conv-row`, `.creative-row`, `.stage-pill`)

**Deleted:**

- `apps/dashboard/src/components/console/zones/nova-panel.tsx` (moved to `panels/nova-panel.tsx`)
- `apps/dashboard/src/components/console/zones/__tests__/nova-panel.test.tsx` (replaced by `panels/__tests__/nova-panel.test.tsx`)

---

## Conventions used in every task

- All test files use **vitest** + **@testing-library/react**.
- React Query consumers wrap in this helper:

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

- Tests that need `useScopedQueryKeys` to return a real key factory mock `next-auth/react`:

  ```ts
  vi.mock("next-auth/react", () => ({
    useSession: () => ({ data: { organizationId: "org-1" }, status: "authenticated" }),
  }));
  ```

- Per-task verification commands run from repo root: `cd /Users/jasonli/switchboard-worktrees/feat-phase-3 && pnpm --filter @switchboard/dashboard test path/to/test.ts`.
- Full-suite verification at end of each task: `pnpm --filter @switchboard/dashboard test` and `pnpm --filter @switchboard/dashboard typecheck`.
- Commit messages follow Conventional Commits (`feat(console): …`, `test(dashboard): …`, `refactor(console): …`, `chore(console): …`, `style(console): …`).

---

## Task 1: format helpers

**Files:**

- Create: `apps/dashboard/src/components/console/panels/format.ts`
- Create: `apps/dashboard/src/components/console/panels/__tests__/format.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/components/console/panels/__tests__/format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { truncate, relativeTime, formatUSDCompact } from "../format";

describe("truncate", () => {
  it("returns input unchanged when shorter than limit", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("appends ellipsis and trims to limit when longer", () => {
    expect(truncate("hello world", 5)).toBe("hello…");
  });

  it("returns empty string for empty input", () => {
    expect(truncate("", 5)).toBe("");
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-05-03T12:00:00Z").getTime();

  it("returns 'now' for under a minute", () => {
    expect(relativeTime(new Date(now - 30_000).toISOString(), now)).toBe("now");
  });

  it("returns Nm ago for under an hour", () => {
    expect(relativeTime(new Date(now - 12 * 60_000).toISOString(), now)).toBe("12m ago");
  });

  it("returns Nh ago for under a day", () => {
    expect(relativeTime(new Date(now - 3 * 60 * 60_000).toISOString(), now)).toBe("3h ago");
  });

  it("returns Nd ago for over a day", () => {
    expect(relativeTime(new Date(now - 2 * 24 * 60 * 60_000).toISOString(), now)).toBe("2d ago");
  });
});

describe("formatUSDCompact", () => {
  it("renders dollars under 10k with thousands separator", () => {
    expect(formatUSDCompact(4820)).toBe("$ 4,820");
  });

  it("renders k-suffix for 10k and above", () => {
    expect(formatUSDCompact(48200)).toBe("$ 48.2k");
  });

  it("renders zero", () => {
    expect(formatUSDCompact(0)).toBe("$ 0");
  });

  it("rounds k-suffix to one decimal", () => {
    expect(formatUSDCompact(12345)).toBe("$ 12.3k");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test src/components/console/panels/__tests__/format.test.ts`
Expected: FAIL with module-not-found or `truncate is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/dashboard/src/components/console/panels/format.ts`:

```ts
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return "now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export function formatUSDCompact(n: number): string {
  if (n < 10_000) {
    return `$ ${n.toLocaleString("en-US")}`;
  }
  const k = n / 1000;
  return `$ ${k.toFixed(1)}k`;
}

export function startOfTodayLocal(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test src/components/console/panels/__tests__/format.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/panels/format.ts apps/dashboard/src/components/console/panels/__tests__/format.test.ts
git commit -m "$(cat <<'EOF'
feat(console): add format helpers for phase 3 panels

truncate, relativeTime, formatUSDCompact, startOfTodayLocal — pure helpers
used by Nova / Alex / Mira panels. Co-located with vitest tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: ExpandedAgentProvider context

**Files:**

- Create: `apps/dashboard/src/components/console/expanded-agent-context.tsx`
- Create: `apps/dashboard/src/components/console/__tests__/expanded-agent-context.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/components/console/__tests__/expanded-agent-context.test.tsx`:

```tsx
import { act, render, renderHook } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { ExpandedAgentProvider, useExpandedAgent } from "../expanded-agent-context";

const wrapper = ({ children }: { children: ReactNode }) => (
  <ExpandedAgentProvider>{children}</ExpandedAgentProvider>
);

describe("ExpandedAgentProvider + useExpandedAgent", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("starts expanded='nova' when no localStorage value (auto-expand on first visit)", () => {
    const { result } = renderHook(() => useExpandedAgent(), { wrapper });
    expect(result.current.expanded).toBe("nova");
  });

  it("reads stored 'alex' on mount", () => {
    window.localStorage.setItem("sb_expanded_agent", "alex");
    const { result } = renderHook(() => useExpandedAgent(), { wrapper });
    expect(result.current.expanded).toBe("alex");
  });

  it("reads stored 'mira' on mount", () => {
    window.localStorage.setItem("sb_expanded_agent", "mira");
    const { result } = renderHook(() => useExpandedAgent(), { wrapper });
    expect(result.current.expanded).toBe("mira");
  });

  it("reads '__null__' sentinel as null (explicit collapse persisted)", () => {
    window.localStorage.setItem("sb_expanded_agent", "__null__");
    const { result } = renderHook(() => useExpandedAgent(), { wrapper });
    expect(result.current.expanded).toBe(null);
  });

  it("falls back to 'nova' on unrecognized stored value", () => {
    window.localStorage.setItem("sb_expanded_agent", "bogus");
    const { result } = renderHook(() => useExpandedAgent(), { wrapper });
    expect(result.current.expanded).toBe("nova");
  });

  it("setExpanded persists to localStorage", () => {
    const { result } = renderHook(() => useExpandedAgent(), { wrapper });
    act(() => result.current.setExpanded("alex"));
    expect(result.current.expanded).toBe("alex");
    expect(window.localStorage.getItem("sb_expanded_agent")).toBe("alex");
  });

  it("setExpanded(null) writes the __null__ sentinel", () => {
    const { result } = renderHook(() => useExpandedAgent(), { wrapper });
    act(() => result.current.setExpanded(null));
    expect(result.current.expanded).toBe(null);
    expect(window.localStorage.getItem("sb_expanded_agent")).toBe("__null__");
  });

  it("toggle expands when collapsed", () => {
    window.localStorage.setItem("sb_expanded_agent", "__null__");
    const { result } = renderHook(() => useExpandedAgent(), { wrapper });
    act(() => result.current.toggle("mira"));
    expect(result.current.expanded).toBe("mira");
  });

  it("toggle collapses when same key already expanded", () => {
    const { result } = renderHook(() => useExpandedAgent(), { wrapper });
    // starts at nova
    act(() => result.current.toggle("nova"));
    expect(result.current.expanded).toBe(null);
  });

  it("toggle switches when a different key is expanded", () => {
    const { result } = renderHook(() => useExpandedAgent(), { wrapper });
    // starts at nova
    act(() => result.current.toggle("alex"));
    expect(result.current.expanded).toBe("alex");
  });

  it("two consumers share state across rapid toggles", () => {
    function ConsumerA() {
      const { expanded, toggle } = useExpandedAgent();
      return (
        <button data-testid="a" onClick={() => toggle("alex")}>
          A:{expanded ?? "none"}
        </button>
      );
    }
    function ConsumerB() {
      const { expanded } = useExpandedAgent();
      return <span data-testid="b">B:{expanded ?? "none"}</span>;
    }
    const { getByTestId } = render(
      <ExpandedAgentProvider>
        <ConsumerA />
        <ConsumerB />
      </ExpandedAgentProvider>,
    );
    // starts at nova
    expect(getByTestId("a").textContent).toBe("A:nova");
    expect(getByTestId("b").textContent).toBe("B:nova");
    act(() => getByTestId("a").click());
    expect(getByTestId("a").textContent).toBe("A:alex");
    expect(getByTestId("b").textContent).toBe("B:alex");
  });

  it("useExpandedAgent outside provider throws", () => {
    expect(() => renderHook(() => useExpandedAgent())).toThrow(
      /useExpandedAgent must be used inside <ExpandedAgentProvider>/,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test src/components/console/__tests__/expanded-agent-context.test.tsx`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write minimal implementation**

Create `apps/dashboard/src/components/console/expanded-agent-context.tsx`:

```tsx
"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

const STORAGE_KEY = "sb_expanded_agent";

export type AgentKey = "nova" | "alex" | "mira";
const VALID: ReadonlyArray<AgentKey> = ["nova", "alex", "mira"];

function readLocal(): AgentKey | null {
  if (typeof window === "undefined") return "nova";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return "nova";
    if (raw === "__null__") return null;
    return (VALID as readonly string[]).includes(raw) ? (raw as AgentKey) : "nova";
  } catch {
    return "nova";
  }
}

function writeLocal(v: AgentKey | null): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, v === null ? "__null__" : v);
  } catch {
    // private mode / quota: fail silent
  }
}

type ExpandedAgentValue = {
  expanded: AgentKey | null;
  setExpanded: (next: AgentKey | null) => void;
  toggle: (key: AgentKey) => void;
};

const ExpandedAgentContext = createContext<ExpandedAgentValue | null>(null);

// State-only provider. Do NOT call useToast() or any side-effect hook here —
// expansion is a silent UI state with no toast surface.
export function ExpandedAgentProvider({ children }: { children: ReactNode }) {
  const [expanded, setExpandedState] = useState<AgentKey | null>(() => readLocal());

  const value = useMemo<ExpandedAgentValue>(
    () => ({
      expanded,
      setExpanded: (next: AgentKey | null) => {
        writeLocal(next);
        setExpandedState(next);
      },
      toggle: (key: AgentKey) => {
        setExpandedState((cur) => {
          const next = cur === key ? null : key;
          writeLocal(next);
          return next;
        });
      },
    }),
    [expanded],
  );

  return (
    <ExpandedAgentContext.Provider value={value}>{children}</ExpandedAgentContext.Provider>
  );
}

export function useExpandedAgent(): ExpandedAgentValue {
  const ctx = useContext(ExpandedAgentContext);
  if (!ctx) {
    throw new Error("useExpandedAgent must be used inside <ExpandedAgentProvider>");
  }
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test src/components/console/__tests__/expanded-agent-context.test.tsx`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/expanded-agent-context.tsx apps/dashboard/src/components/console/__tests__/expanded-agent-context.test.tsx
git commit -m "$(cat <<'EOF'
feat(console): add ExpandedAgentProvider for phase 3 agent panels

Mirrors HaltProvider shape (state-only, localStorage-persisted). Defaults to
nova on first visit; uses __null__ sentinel to persist explicit collapse;
toggle swaps or collapses depending on current state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: scroll-to-card helper

**Files:**

- Create: `apps/dashboard/src/components/console/panels/scroll-to-card.ts`
- Create: `apps/dashboard/src/components/console/panels/__tests__/scroll-to-card.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/components/console/panels/__tests__/scroll-to-card.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { scrollToQueueCard, prefersReducedMotion } from "../scroll-to-card";

describe("prefersReducedMotion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false when matchMedia not present (SSR-style)", () => {
    const original = window.matchMedia;
    // @ts-expect-error -- simulate missing matchMedia
    window.matchMedia = undefined;
    expect(prefersReducedMotion()).toBe(false);
    window.matchMedia = original;
  });

  it("returns true when reduced-motion media query matches", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q === "(prefers-reduced-motion: reduce)",
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    expect(prefersReducedMotion()).toBe(true);
  });
});

describe("scrollToQueueCard", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("no-ops when no element with id matches", () => {
    expect(() => scrollToQueueCard("nonexistent")).not.toThrow();
  });

  it("calls scrollIntoView with smooth behavior by default", () => {
    const div = document.createElement("div");
    div.id = "q-card-1";
    const spy = vi.fn();
    div.scrollIntoView = spy;
    document.body.appendChild(div);

    scrollToQueueCard("card-1");

    expect(spy).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
  });

  it("uses behavior 'auto' when prefers-reduced-motion: reduce", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q === "(prefers-reduced-motion: reduce)",
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const div = document.createElement("div");
    div.id = "q-card-1";
    const spy = vi.fn();
    div.scrollIntoView = spy;
    document.body.appendChild(div);

    scrollToQueueCard("card-1");

    expect(spy).toHaveBeenCalledWith({ behavior: "auto", block: "center" });
    vi.unstubAllGlobals();
  });

  it("adds .is-flashing class then removes after 1000ms", () => {
    const div = document.createElement("div");
    div.id = "q-card-1";
    div.scrollIntoView = vi.fn();
    document.body.appendChild(div);

    scrollToQueueCard("card-1");
    expect(div.classList.contains("is-flashing")).toBe(true);

    vi.advanceTimersByTime(999);
    expect(div.classList.contains("is-flashing")).toBe(true);

    vi.advanceTimersByTime(1);
    expect(div.classList.contains("is-flashing")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test src/components/console/panels/__tests__/scroll-to-card.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write minimal implementation**

Create `apps/dashboard/src/components/console/panels/scroll-to-card.ts`:

```ts
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function scrollToQueueCard(cardId: string): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById(`q-${cardId}`);
  if (!el) return;
  el.scrollIntoView({
    behavior: prefersReducedMotion() ? "auto" : "smooth",
    block: "center",
  });
  el.classList.add("is-flashing");
  setTimeout(() => el.classList.remove("is-flashing"), 1000);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test src/components/console/panels/__tests__/scroll-to-card.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/panels/scroll-to-card.ts apps/dashboard/src/components/console/panels/__tests__/scroll-to-card.test.ts
git commit -m "$(cat <<'EOF'
feat(console): add scrollToQueueCard cross-link helper

Used by Nova's recommendation note to scroll to a queue approval-gate card by
id (set in Phase 2 as `id="q-${cardId}"`). Honors prefers-reduced-motion:
behavior 'auto' when reduce; 'smooth' otherwise. Adds .is-flashing for 1s,
matching the existing zone-flash keyframe.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: agent-stats derivation + wrapper hooks

**Files:**

- Create: `apps/dashboard/src/components/console/panels/agent-stats.ts`
- Create: `apps/dashboard/src/components/console/panels/__tests__/agent-stats.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/components/console/panels/__tests__/agent-stats.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  deriveNovaStats,
  deriveAlexStats,
  deriveMiraStats,
} from "../agent-stats";

describe("deriveNovaStats", () => {
  it("returns em-dashes when data is undefined", () => {
    expect(deriveNovaStats(undefined)).toEqual({ primary: "—", secondary: "—" });
  });

  it("returns em-dashes when data has no latestReport", () => {
    expect(deriveNovaStats({ latestReport: null, reports: [] })).toEqual({
      primary: "—",
      secondary: "—",
    });
  });

  it("formats spend + secondary line from latestReport", () => {
    const stats = deriveNovaStats({
      latestReport: {
        accountId: "a",
        dateRange: { since: "x", until: "y" },
        summary: {
          totalSpend: 4820,
          totalLeads: 42,
          totalRevenue: 0,
          overallROAS: 0,
          activeCampaigns: 5,
          campaignsInLearning: 1,
        },
        funnel: { stages: [], leakagePoint: "", leakageMagnitude: 0 },
        periodDeltas: [],
        insights: [],
        watches: [],
        recommendations: [
          { type: "recommendation" as const, action: "Pause", campaignId: "c1", campaignName: "C1", confidence: 0.9, urgency: "now", estimatedImpact: "x", steps: [], learningPhaseImpact: "n", draftId: "draft-1" },
          { type: "recommendation" as const, action: "Increase", campaignId: "c2", campaignName: "C2", confidence: 0.8, urgency: "soon", estimatedImpact: "y", steps: [], learningPhaseImpact: "n" },
        ],
      },
      reports: [],
    });
    expect(stats.primary).toBe("$ 4,820");
    expect(stats.secondary).toBe("5 campaigns · 1 recs pending");
  });
});

describe("deriveAlexStats", () => {
  it("returns em-dashes when data is undefined", () => {
    expect(deriveAlexStats(undefined)).toEqual({ primary: "—", secondary: "—" });
  });

  it("counts conversations from today and human_override", () => {
    const today = new Date();
    today.setHours(13, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    const stats = deriveAlexStats({
      conversations: [
        {
          id: "c1", threadId: "t1", channel: "whatsapp", principalId: "p1",
          organizationId: "o1", status: "active", currentIntent: null,
          firstReplyAt: null, lastActivityAt: today.toISOString(),
        },
        {
          id: "c2", threadId: "t2", channel: "email", principalId: "p2",
          organizationId: "o1", status: "human_override", currentIntent: null,
          firstReplyAt: null, lastActivityAt: today.toISOString(),
        },
        {
          id: "c3", threadId: "t3", channel: "whatsapp", principalId: "p3",
          organizationId: "o1", status: "active", currentIntent: null,
          firstReplyAt: null, lastActivityAt: yesterday.toISOString(),
        },
      ],
      total: 3,
    });
    expect(stats.primary).toBe("2 today");
    expect(stats.secondary).toBe("1 need owner");
  });

  it("returns 0/0 with empty list", () => {
    expect(deriveAlexStats({ conversations: [], total: 0 })).toEqual({
      primary: "0 today",
      secondary: "0 need owner",
    });
  });
});

describe("deriveMiraStats", () => {
  it("returns em-dashes when data is undefined", () => {
    expect(deriveMiraStats(undefined)).toEqual({ primary: "—", secondary: "—" });
  });

  it("counts in-flight and at-gate creative jobs", () => {
    const jobs = [
      { id: "j1", currentStage: "render", stoppedAt: null } as never,
      { id: "j2", currentStage: "review", stoppedAt: null } as never,
      { id: "j3", currentStage: "complete", stoppedAt: null } as never,
      { id: "j4", currentStage: "review", stoppedAt: "2026-01-01" } as never,
    ];
    const stats = deriveMiraStats(jobs);
    expect(stats.primary).toBe("2 in flight");
    expect(stats.secondary).toBe("1 awaiting approval");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test src/components/console/panels/__tests__/agent-stats.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write minimal implementation**

Create `apps/dashboard/src/components/console/panels/agent-stats.ts`:

```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import { useConversations } from "@/hooks/use-conversations";
import { useAdOptimizerAudit, type AuditReport } from "@/hooks/use-ad-optimizer";
import { useCreativeJobs } from "@/hooks/use-creative-pipeline";
import type { ConversationListItem } from "@/hooks/use-conversations";
import type { CreativeJobSummary } from "@/lib/api-client";
import type { AgentKey } from "../expanded-agent-context";
import { formatUSDCompact, startOfTodayLocal } from "./format";

export type AgentStats = { primary: string; secondary: string };
export type AgentStripStats = Record<AgentKey, AgentStats>;

type AuditDataset = {
  latestReport: AuditReport | null;
  reports: Array<AuditReport & { taskId: string; createdAt: string }>;
};

export function deriveNovaStats(data: AuditDataset | undefined): AgentStats {
  if (!data?.latestReport) return { primary: "—", secondary: "—" };
  const r = data.latestReport;
  const spend = formatUSDCompact(r.summary.totalSpend);
  const campaigns = r.summary.activeCampaigns;
  const pending = r.recommendations.filter((rec) => rec.draftId).length;
  return {
    primary: spend,
    secondary: `${campaigns} campaigns · ${pending} recs pending`,
  };
}

export function deriveAlexStats(
  data: { conversations: ConversationListItem[]; total: number } | undefined,
): AgentStats {
  if (!data) return { primary: "—", secondary: "—" };
  const today = startOfTodayLocal();
  const todayCount = data.conversations.filter(
    (c) => new Date(c.lastActivityAt) >= today,
  ).length;
  const ownerCount = data.conversations.filter((c) => c.status === "human_override").length;
  return { primary: `${todayCount} today`, secondary: `${ownerCount} need owner` };
}

export function deriveMiraStats(jobs: CreativeJobSummary[] | undefined): AgentStats {
  if (!jobs) return { primary: "—", secondary: "—" };
  const inFlight = jobs.filter(
    (j) => j.currentStage !== "complete" && !j.stoppedAt,
  ).length;
  const atGate = jobs.filter(
    (j) => j.currentStage === "review" && !j.stoppedAt,
  ).length;
  return { primary: `${inFlight} in flight`, secondary: `${atGate} awaiting approval` };
}

// Wrapper hooks: resolve deployment id via marketplace lookup, then call the
// data hook. Short-circuit cleanly when no deployment exists so derivation
// receives an explicit `undefined`.

function useDeploymentForModule(moduleId: "ad-optimizer" | "creative") {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.marketplace.deploymentForModule(moduleId) ?? [
      `__disabled_deployment_for_${moduleId}__`,
    ],
    queryFn: async () => {
      const res = await fetch(
        `/api/dashboard/marketplace/deployments?module=${encodeURIComponent(moduleId)}`,
      );
      if (!res.ok) return { deploymentId: null as string | null };
      const data = (await res.json()) as { deployments?: Array<{ id: string; moduleType: string; status: string }> };
      const live = (data.deployments ?? []).find(
        (d) => d.moduleType === moduleId && d.status === "active",
      );
      return { deploymentId: live?.id ?? null };
    },
    enabled: !!keys,
  });
}

export function useAdOptimizerAuditCurrent() {
  const dep = useDeploymentForModule("ad-optimizer");
  const audit = useAdOptimizerAudit(dep.data?.deploymentId ?? undefined);
  return {
    data: audit.data as AuditDataset | undefined,
    isLoading: dep.isLoading || audit.isLoading,
    error: dep.error || audit.error,
    refetch: () => {
      dep.refetch();
      audit.refetch();
    },
  };
}

export function useCreativeJobsCurrent() {
  const dep = useDeploymentForModule("creative");
  const jobs = useCreativeJobs(dep.data?.deploymentId ?? "");
  return {
    data: jobs.data,
    isLoading: dep.isLoading || jobs.isLoading,
    error: dep.error || jobs.error,
    refetch: () => {
      dep.refetch();
      jobs.refetch();
    },
  };
}

export function useAgentStripStats(): AgentStripStats {
  const audit = useAdOptimizerAuditCurrent();
  const conversations = useConversations();
  const creativeJobs = useCreativeJobsCurrent();
  return {
    nova: deriveNovaStats(audit.data),
    alex: deriveAlexStats(conversations.data),
    mira: deriveMiraStats(creativeJobs.data),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test src/components/console/panels/__tests__/agent-stats.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/panels/agent-stats.ts apps/dashboard/src/components/console/panels/__tests__/agent-stats.test.ts
git commit -m "$(cat <<'EOF'
feat(console): add agent-stats derivation + wrapper hooks

Pure derivation functions for Nova / Alex / Mira strip cards plus
useAgentStripStats hook. Wrapper hooks (useAdOptimizerAuditCurrent /
useCreativeJobsCurrent) resolve deployment id via marketplace lookup and
short-circuit when no deployment exists. All hooks use useScopedQueryKeys
for tenant-scoped cache keys.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: panel-chrome — shared PanelHead + PanelFoot

**Files:**

- Create: `apps/dashboard/src/components/console/panels/panel-chrome.tsx`
- Create: `apps/dashboard/src/components/console/panels/__tests__/panel-chrome.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/components/console/panels/__tests__/panel-chrome.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { PanelHead, PanelFoot } from "../panel-chrome";

describe("PanelHead", () => {
  it("renders the label", () => {
    render(<PanelHead label="Nova · Campaigns" />);
    expect(screen.getByText("Nova · Campaigns")).toBeInTheDocument();
  });

  it("renders meta when provided", () => {
    render(<PanelHead label="X" meta={<span>5 live</span>} />);
    expect(screen.getByText("5 live")).toBeInTheDocument();
  });

  it("does not render meta wrapper when meta is omitted", () => {
    const { container } = render(<PanelHead label="X" />);
    expect(container.querySelector(".meta")).toBeNull();
  });
});

describe("PanelFoot", () => {
  it("renders stats", () => {
    render(<PanelFoot stats={<span>foo</span>} />);
    expect(screen.getByText("foo")).toBeInTheDocument();
  });

  it("renders cta when provided", () => {
    render(<PanelFoot stats={<span>foo</span>} cta={<a href="/x">go →</a>} />);
    expect(screen.getByRole("link", { name: /go/ })).toBeInTheDocument();
  });

  it("renders without cta when omitted", () => {
    const { container } = render(<PanelFoot stats={<span>foo</span>} />);
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test src/components/console/panels/__tests__/panel-chrome.test.tsx`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write minimal implementation**

Create `apps/dashboard/src/components/console/panels/panel-chrome.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";

export function PanelHead({ label, meta }: { label: string; meta?: ReactNode }) {
  return (
    <header className="panel-head">
      <span className="label">{label}</span>
      {meta && <div className="meta">{meta}</div>}
    </header>
  );
}

export function PanelFoot({ stats, cta }: { stats: ReactNode; cta?: ReactNode }) {
  return (
    <footer className="panel-foot">
      <div className="stats">{stats}</div>
      {cta}
    </footer>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test src/components/console/panels/__tests__/panel-chrome.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/panels/panel-chrome.tsx apps/dashboard/src/components/console/panels/__tests__/panel-chrome.test.tsx
git commit -m "$(cat <<'EOF'
feat(console): add shared PanelHead + PanelFoot chrome

Reused across Nova / Alex / Mira panels. Reuses existing .panel-head and
.panel-foot CSS tokens already in console.css.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: nova-recommendation-note — cross-link panel-note

**Files:**

- Create: `apps/dashboard/src/components/console/panels/nova-recommendation-note.tsx`
- Create: `apps/dashboard/src/components/console/panels/__tests__/nova-recommendation-note.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/components/console/panels/__tests__/nova-recommendation-note.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { NovaRecommendationNote } from "../nova-recommendation-note";

vi.mock("@/hooks/use-approvals");
vi.mock("../scroll-to-card", () => ({
  scrollToQueueCard: vi.fn(),
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1" }, status: "authenticated" }),
}));

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

const baseRec = {
  type: "recommendation" as const,
  campaignId: "c1",
  campaignName: "C1",
  confidence: 0.9,
  urgency: "now",
  estimatedImpact: "x",
  steps: [],
  learningPhaseImpact: "n",
};

const reportWithRec = (overrides: Partial<typeof baseRec> & { action: string; draftId?: string | null }) => ({
  accountId: "a",
  dateRange: { since: "x", until: "y" },
  summary: { totalSpend: 0, totalLeads: 0, totalRevenue: 0, overallROAS: 0, activeCampaigns: 0, campaignsInLearning: 0 },
  funnel: { stages: [], leakagePoint: "", leakageMagnitude: 0 },
  periodDeltas: [],
  insights: [],
  watches: [],
  recommendations: [{ ...baseRec, ...overrides }],
});

describe("NovaRecommendationNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when report is null", async () => {
    const apMod = await import("@/hooks/use-approvals");
    vi.mocked(apMod.useApprovals).mockReturnValue({
      data: { approvals: [] },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never);
    const { container } = render(<NovaRecommendationNote report={null} />, { wrapper });
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when no recommendation has a matching draftId", async () => {
    const apMod = await import("@/hooks/use-approvals");
    vi.mocked(apMod.useApprovals).mockReturnValue({
      data: { approvals: [{ id: "ap-other" }] },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never);
    const { container } = render(
      <NovaRecommendationNote
        report={reportWithRec({ action: "Pause", draftId: "draft-1" })}
      />,
      { wrapper },
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the note when a recommendation draftId matches a pending approval id", async () => {
    const apMod = await import("@/hooks/use-approvals");
    vi.mocked(apMod.useApprovals).mockReturnValue({
      data: { approvals: [{ id: "draft-1" }] },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never);
    render(
      <NovaRecommendationNote
        report={reportWithRec({ action: "Pause", campaignName: "Whitening Ad Set B", draftId: "draft-1" })}
      />,
      { wrapper },
    );
    expect(screen.getByText(/drafting/i)).toBeInTheDocument();
    expect(screen.getByText(/Pause/)).toBeInTheDocument();
    expect(screen.getByText(/Whitening Ad Set B/)).toBeInTheDocument();
    expect(screen.getByText(/approve in queue above/i)).toBeInTheDocument();
  });

  it("clicking the jump button calls scrollToQueueCard with draftId", async () => {
    const apMod = await import("@/hooks/use-approvals");
    vi.mocked(apMod.useApprovals).mockReturnValue({
      data: { approvals: [{ id: "draft-1" }] },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never);
    const scrollMod = await import("../scroll-to-card");
    render(
      <NovaRecommendationNote
        report={reportWithRec({ action: "Pause", draftId: "draft-1" })}
      />,
      { wrapper },
    );
    await userEvent.click(screen.getByRole("button", { name: /jump to card/i }));
    expect(vi.mocked(scrollMod.scrollToQueueCard)).toHaveBeenCalledWith("draft-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test src/components/console/panels/__tests__/nova-recommendation-note.test.tsx`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write minimal implementation**

Create `apps/dashboard/src/components/console/panels/nova-recommendation-note.tsx`:

```tsx
"use client";

import { useApprovals } from "@/hooks/use-approvals";
import type { AuditReport } from "@/hooks/use-ad-optimizer";
import { scrollToQueueCard } from "./scroll-to-card";

export function NovaRecommendationNote({ report }: { report: AuditReport | null }) {
  const approvals = useApprovals();
  if (!report) return null;
  const pendingIds = new Set(
    (approvals.data?.approvals ?? []).map((a: { id: string }) => a.id),
  );
  const link = report.recommendations.find((r) => r.draftId && pendingIds.has(r.draftId));
  if (!link || !link.draftId) return null;

  return (
    <div className="panel-note">
      <span className="msg">
        Drafting <em>{link.action}</em> on <b>{link.campaignName}</b> — approve in queue above ↑
      </span>
      <button
        type="button"
        className="anchor"
        onClick={() => scrollToQueueCard(link.draftId!)}
      >
        Jump to card →
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test src/components/console/panels/__tests__/nova-recommendation-note.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/panels/nova-recommendation-note.tsx apps/dashboard/src/components/console/panels/__tests__/nova-recommendation-note.test.tsx
git commit -m "$(cat <<'EOF'
feat(console): add Nova recommendation cross-link note

Renders the .panel-note "approve in queue above ↑" affordance when a Nova
recommendation has a draftId that matches a pending approval-gate card.
Click jumps to the card via Phase 2's id="q-${draftId}" anchors.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: nova-campaign-table — campaign rows from audit

**Files:**

- Create: `apps/dashboard/src/components/console/panels/nova-campaign-table.tsx`
- Create: `apps/dashboard/src/components/console/panels/__tests__/nova-campaign-table.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/components/console/panels/__tests__/nova-campaign-table.test.tsx`:

```tsx
import { render, screen, within } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { NovaCampaignTable } from "../nova-campaign-table";
import type { AuditReport } from "@/hooks/use-ad-optimizer";

const baseRec = {
  type: "recommendation" as const,
  campaignId: "c1",
  campaignName: "C1",
  confidence: 0.9,
  urgency: "now",
  estimatedImpact: "x",
  steps: [],
  learningPhaseImpact: "n",
};

const makeReport = (overrides: Partial<AuditReport>): AuditReport => ({
  accountId: "a",
  dateRange: { since: "x", until: "y" },
  summary: { totalSpend: 1000, totalLeads: 10, totalRevenue: 0, overallROAS: 0, activeCampaigns: 1, campaignsInLearning: 0 },
  funnel: { stages: [], leakagePoint: "", leakageMagnitude: 0 },
  periodDeltas: [],
  insights: [],
  watches: [],
  recommendations: [],
  ...overrides,
});

describe("NovaCampaignTable", () => {
  it("renders muted single row when no recommendations", () => {
    render(<NovaCampaignTable report={makeReport({ recommendations: [] })} />);
    expect(screen.getByText(/no actions recommended/i)).toBeInTheDocument();
  });

  it("renders one row per recommendation with campaign name + action", () => {
    render(
      <NovaCampaignTable
        report={makeReport({
          recommendations: [
            { ...baseRec, action: "Pause", campaignName: "Camp A" },
            { ...baseRec, campaignId: "c2", action: "Increase budget", campaignName: "Camp B" },
          ],
        })}
      />,
    );
    expect(screen.getByText("Camp A")).toBeInTheDocument();
    expect(screen.getByText("Camp B")).toBeInTheDocument();
    expect(screen.getByText("Pause")).toBeInTheDocument();
    expect(screen.getByText("Increase budget")).toBeInTheDocument();
  });

  it("renders 'Pending approval' link to #q-${draftId} when recommendation has draftId", () => {
    render(
      <NovaCampaignTable
        report={makeReport({
          recommendations: [{ ...baseRec, action: "Pause", draftId: "draft-1" }],
        })}
      />,
    );
    const link = screen.getByRole("link", { name: /pending approval/i });
    expect(link).toHaveAttribute("href", "#q-draft-1");
  });

  it("renders 'Suggested' plain text when no draftId", () => {
    render(
      <NovaCampaignTable
        report={makeReport({
          recommendations: [{ ...baseRec, action: "Pause" }],
        })}
      />,
    );
    expect(screen.getByText(/suggested/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /suggested/i })).toBeNull();
  });

  it("renders source-comparison metrics when present", () => {
    render(
      <NovaCampaignTable
        report={makeReport({
          recommendations: [{ ...baseRec, action: "Pause", campaignId: "c1", campaignName: "Camp A" }],
          sourceComparison: {
            rows: [
              { source: "c1", cpl: 24, costPerQualified: null, costPerBooked: null, closeRate: null, trueRoas: null },
            ],
          },
        })}
      />,
    );
    expect(screen.getByText(/24/)).toBeInTheDocument();
  });

  it("renders trend ↑ or ↓ based on periodDeltas direction", () => {
    const { container } = render(
      <NovaCampaignTable
        report={makeReport({
          recommendations: [{ ...baseRec, action: "Pause" }],
          periodDeltas: [
            { metric: "cpl", current: 30, previous: 40, deltaPercent: -25, direction: "down", significant: true },
          ],
        })}
      />,
    );
    expect(container.querySelector(".spark.down")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test src/components/console/panels/__tests__/nova-campaign-table.test.tsx`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write minimal implementation**

Create `apps/dashboard/src/components/console/panels/nova-campaign-table.tsx`:

```tsx
"use client";

import Link from "next/link";
import type { AuditReport } from "@/hooks/use-ad-optimizer";
import { scrollToQueueCard } from "./scroll-to-card";

function trendCellFor(report: AuditReport): { className: string; symbol: string } | null {
  const cpl = report.periodDeltas.find((d) => d.metric === "cpl");
  if (!cpl) return null;
  if (cpl.direction === "down") return { className: "spark down", symbol: "↓" };
  if (cpl.direction === "up") return { className: "spark up", symbol: "↑" };
  return null;
}

function metricsFor(report: AuditReport, campaignId: string) {
  const row = report.sourceComparison?.rows?.find((r) => r.source === campaignId);
  return {
    cpl: row?.cpl,
    leads: null as number | null,
    spend: null as number | null,
  };
}

export function NovaCampaignTable({ report }: { report: AuditReport | null }) {
  if (!report || report.recommendations.length === 0) {
    return (
      <table className="adset">
        <tbody>
          <tr>
            <td className="muted" colSpan={7}>
              No actions recommended right now.
            </td>
          </tr>
        </tbody>
      </table>
    );
  }

  const trend = trendCellFor(report);

  return (
    <table className="adset">
      <thead>
        <tr>
          <th>Campaign</th>
          <th className="num">Spend</th>
          <th className="num">Leads</th>
          <th className="num">CPL</th>
          <th className="center">Trend</th>
          <th>Action</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {report.recommendations.map((rec) => {
          const m = metricsFor(report, rec.campaignId);
          return (
            <tr key={`${rec.campaignId}-${rec.action}`}>
              <td>{rec.campaignName}</td>
              <td className="num mono">{m.spend == null ? "—" : `$ ${m.spend}`}</td>
              <td className="num mono">{m.leads ?? "—"}</td>
              <td className="num mono">{m.cpl == null ? "—" : `$ ${m.cpl}`}</td>
              <td className={trend?.className ?? "spark"}>{trend?.symbol ?? "—"}</td>
              <td className="action">{rec.action}</td>
              <td className="status">
                {rec.draftId ? (
                  <Link
                    href={`#q-${rec.draftId}`}
                    onClick={(e) => {
                      e.preventDefault();
                      scrollToQueueCard(rec.draftId!);
                    }}
                  >
                    Pending approval
                  </Link>
                ) : (
                  <span>Suggested</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test src/components/console/panels/__tests__/nova-campaign-table.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/panels/nova-campaign-table.tsx apps/dashboard/src/components/console/panels/__tests__/nova-campaign-table.test.tsx
git commit -m "$(cat <<'EOF'
feat(console): add Nova campaign-row table

Renders one row per recommendation in the latest audit, with optional
per-campaign CPL/leads from sourceComparison rows. Status column links to
queue approval-gate card via #q-${draftId} when a draft exists. Reuses the
existing table.adset CSS tokens.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: nova-panel — moved + extended

**Files:**

- Create: `apps/dashboard/src/components/console/panels/nova-panel.tsx`
- Create: `apps/dashboard/src/components/console/panels/__tests__/nova-panel.test.tsx`
- Delete: `apps/dashboard/src/components/console/zones/nova-panel.tsx`
- Delete: `apps/dashboard/src/components/console/zones/__tests__/nova-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/components/console/panels/__tests__/nova-panel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { NovaPanel } from "../nova-panel";

vi.mock("@/hooks/use-module-status");
vi.mock("../agent-stats");
vi.mock("@/hooks/use-approvals");
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1" }, status: "authenticated" }),
}));

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

async function mockHooks(opts: {
  module?: { data?: unknown; isLoading?: boolean; error?: Error | null };
  audit?: { data?: unknown; isLoading?: boolean; error?: Error | null };
  approvals?: { data?: unknown };
}) {
  const modMod = await import("@/hooks/use-module-status");
  vi.mocked(modMod.useModuleStatus).mockReturnValue({
    data: opts.module?.data,
    isLoading: opts.module?.isLoading ?? false,
    error: opts.module?.error ?? null,
    refetch: vi.fn(),
  } as never);
  const statsMod = await import("../agent-stats");
  vi.mocked(statsMod.useAdOptimizerAuditCurrent).mockReturnValue({
    data: opts.audit?.data,
    isLoading: opts.audit?.isLoading ?? false,
    error: opts.audit?.error ?? null,
    refetch: vi.fn(),
  } as never);
  const apMod = await import("@/hooks/use-approvals");
  vi.mocked(apMod.useApprovals).mockReturnValue({
    data: opts.approvals?.data ?? { approvals: [] },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  } as never);
}

describe("NovaPanel", () => {
  it("renders skeleton while either hook is loading", async () => {
    await mockHooks({ module: { isLoading: true } });
    render(<NovaPanel />, { wrapper });
    expect(screen.getByLabelText(/loading nova/i)).toBeInTheDocument();
  });

  it("renders error state with retry when an error is present", async () => {
    await mockHooks({
      module: { data: [{ id: "ad-optimizer", state: "live" }] },
      audit: { error: new Error("boom") },
    });
    render(<NovaPanel />, { wrapper });
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders empty CTA when ad-optimizer module is not live", async () => {
    await mockHooks({
      module: { data: [{ id: "ad-optimizer", state: "draft" }] },
      audit: { data: { latestReport: null, reports: [] } },
    });
    render(<NovaPanel />, { wrapper });
    expect(screen.getByText(/no ad-optimizer deployed/i)).toBeInTheDocument();
  });

  it("renders panel header + ROI link when audit returns a report", async () => {
    await mockHooks({
      module: { data: [{ id: "ad-optimizer", state: "live" }] },
      audit: {
        data: {
          latestReport: {
            accountId: "a",
            dateRange: { since: "x", until: "y" },
            summary: { totalSpend: 4820, totalLeads: 42, totalRevenue: 0, overallROAS: 0, activeCampaigns: 5, campaignsInLearning: 1 },
            funnel: { stages: [], leakagePoint: "", leakageMagnitude: 0 },
            periodDeltas: [],
            insights: [],
            watches: [],
            recommendations: [],
          },
          reports: [],
        },
      },
    });
    render(<NovaPanel />, { wrapper });
    expect(screen.getByText(/Nova · Campaigns/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /see roi/i })).toHaveAttribute(
      "href",
      "/dashboard/roi",
    );
  });

  it("panel root has id agent-panel-nova", async () => {
    await mockHooks({
      module: { data: [{ id: "ad-optimizer", state: "live" }] },
      audit: {
        data: {
          latestReport: {
            accountId: "a",
            dateRange: { since: "x", until: "y" },
            summary: { totalSpend: 0, totalLeads: 0, totalRevenue: 0, overallROAS: 0, activeCampaigns: 0, campaignsInLearning: 0 },
            funnel: { stages: [], leakagePoint: "", leakageMagnitude: 0 },
            periodDeltas: [],
            insights: [],
            watches: [],
            recommendations: [],
          },
          reports: [],
        },
      },
    });
    const { container } = render(<NovaPanel />, { wrapper });
    expect(container.querySelector("#agent-panel-nova")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test src/components/console/panels/__tests__/nova-panel.test.tsx`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write minimal implementation**

Create `apps/dashboard/src/components/console/panels/nova-panel.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useModuleStatus } from "@/hooks/use-module-status";
import { ZoneSkeleton, ZoneError, ZoneEmpty } from "../zones/zone-states";
import { PanelHead, PanelFoot } from "./panel-chrome";
import { NovaCampaignTable } from "./nova-campaign-table";
import { NovaRecommendationNote } from "./nova-recommendation-note";
import { useAdOptimizerAuditCurrent } from "./agent-stats";
import { formatUSDCompact } from "./format";

export function NovaPanel() {
  const modules = useModuleStatus();
  const audit = useAdOptimizerAuditCurrent();

  if (modules.isLoading || audit.isLoading) return <ZoneSkeleton label="Loading Nova" />;
  if (modules.error || audit.error) {
    return (
      <ZoneError
        message="Couldn't load Nova."
        onRetry={() => {
          modules.refetch();
          audit.refetch();
        }}
      />
    );
  }

  const moduleList = (modules.data ?? []) as Array<{ id: string; state: string }>;
  const live = moduleList.some((m) => m.id === "ad-optimizer" && m.state === "live");

  if (!live) {
    return (
      <section
        id="agent-panel-nova"
        className="panel"
        role="region"
        aria-labelledby="agent-card-nova"
      >
        <ZoneEmpty
          message="No ad-optimizer deployed yet."
          cta={
            <Link href="/marketplace" className="btn btn-text">
              Connect ad-optimizer →
            </Link>
          }
        />
      </section>
    );
  }

  const report = audit.data?.latestReport ?? null;

  return (
    <section
      id="agent-panel-nova"
      className="panel"
      role="region"
      aria-labelledby="agent-card-nova"
    >
      <PanelHead
        label="Nova · Campaigns"
        meta={
          report ? (
            <span>
              <b>{report.summary.activeCampaigns}</b> live <span className="sep">·</span>{" "}
              <b>{report.summary.campaignsInLearning}</b> learning
            </span>
          ) : null
        }
      />
      <NovaCampaignTable report={report} />
      <NovaRecommendationNote report={report} />
      <PanelFoot
        stats={
          report ? (
            <span>
              <b>{formatUSDCompact(report.summary.totalSpend)}</b> spend{" "}
              <span className="sep">·</span> <b>{report.summary.totalLeads}</b> leads
            </span>
          ) : (
            <span>—</span>
          )
        }
        cta={
          <Link className="pill-graphite" href="/dashboard/roi">
            See ROI →
          </Link>
        }
      />
    </section>
  );
}
```

Delete the old files:

```bash
git rm apps/dashboard/src/components/console/zones/nova-panel.tsx apps/dashboard/src/components/console/zones/__tests__/nova-panel.test.tsx
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test src/components/console/panels/__tests__/nova-panel.test.tsx`
Expected: PASS, 5 tests.

Run also: `pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS — `console-view.tsx` still imports from `zones/nova-panel`; that import will be migrated in Task 14. Until then, you may temporarily comment-out the import or leave it; if typecheck fails, proceed but mark blocked. Recommended: keep the old `zones/nova-panel.tsx` in place via `git revert` of the delete until Task 14, and only delete it then.

(Practical adjustment: do **not** run `git rm` in this task. Instead, complete Step 5 with both files coexisting. The old `zones/nova-panel.tsx` still works because nothing references the new `panels/nova-panel.tsx` yet. Deletion happens in Task 14 when `console-view.tsx` switches to importing `<AgentsZone>`.)

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/panels/nova-panel.tsx apps/dashboard/src/components/console/panels/__tests__/nova-panel.test.tsx
git commit -m "$(cat <<'EOF'
feat(console): add Nova panel under panels/ with full chrome + table

Composes NovaCampaignTable + NovaRecommendationNote + shared PanelHead /
PanelFoot. ROI link in the foot points to /dashboard/roi as the foreshadow
for the post-lead attribution work that will fill in revenue/ROAS columns.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: alex-panel — conversation list

**Files:**

- Create: `apps/dashboard/src/components/console/panels/alex-panel.tsx`
- Create: `apps/dashboard/src/components/console/panels/__tests__/alex-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/components/console/panels/__tests__/alex-panel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AlexPanel } from "../alex-panel";

vi.mock("@/hooks/use-conversations");
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1" }, status: "authenticated" }),
}));

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

const conv = (id: string, lastActivityAt: string, status = "active") => ({
  id,
  threadId: `t-${id}`,
  channel: "whatsapp",
  principalId: `p-${id}`,
  organizationId: "org-1",
  status,
  currentIntent: `intent-${id}`,
  firstReplyAt: null,
  lastActivityAt,
});

describe("AlexPanel", () => {
  it("renders skeleton while loading", async () => {
    const mod = await import("@/hooks/use-conversations");
    vi.mocked(mod.useConversations).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    } as never);
    render(<AlexPanel />, { wrapper });
    expect(screen.getByLabelText(/loading alex/i)).toBeInTheDocument();
  });

  it("renders error retry on failure", async () => {
    const mod = await import("@/hooks/use-conversations");
    const refetch = vi.fn();
    vi.mocked(mod.useConversations).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("boom"),
      refetch,
    } as never);
    render(<AlexPanel />, { wrapper });
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders empty state when no conversations", async () => {
    const mod = await import("@/hooks/use-conversations");
    vi.mocked(mod.useConversations).mockReturnValue({
      data: { conversations: [], total: 0 },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never);
    render(<AlexPanel />, { wrapper });
    expect(screen.getByText(/no conversations yet/i)).toBeInTheDocument();
  });

  it("renders most recent 8 conversations sorted desc by lastActivityAt", async () => {
    const mod = await import("@/hooks/use-conversations");
    const now = Date.now();
    const items = Array.from({ length: 12 }, (_, i) =>
      conv(`c${i}`, new Date(now - i * 60_000).toISOString()),
    );
    vi.mocked(mod.useConversations).mockReturnValue({
      data: { conversations: items, total: items.length },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never);
    const { container } = render(<AlexPanel />, { wrapper });
    const rows = container.querySelectorAll(".conv-row");
    expect(rows).toHaveLength(8);
    // newest first → c0 in row[0]
    expect(rows[0].textContent).toContain("intent-c0");
  });

  it("rows link to /conversations", async () => {
    const mod = await import("@/hooks/use-conversations");
    vi.mocked(mod.useConversations).mockReturnValue({
      data: {
        conversations: [conv("c1", new Date().toISOString())],
        total: 1,
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never);
    render(<AlexPanel />, { wrapper });
    const link = screen.getByRole("link", { name: /intent-c1/i });
    expect(link).toHaveAttribute("href", "/conversations");
  });

  it("status pill is review-coral for human_override", async () => {
    const mod = await import("@/hooks/use-conversations");
    vi.mocked(mod.useConversations).mockReturnValue({
      data: {
        conversations: [conv("c1", new Date().toISOString(), "human_override")],
        total: 1,
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never);
    const { container } = render(<AlexPanel />, { wrapper });
    expect(container.querySelector(".stage-pill.review")).not.toBeNull();
  });

  it("PanelFoot 'All conversations →' links to /conversations", async () => {
    const mod = await import("@/hooks/use-conversations");
    vi.mocked(mod.useConversations).mockReturnValue({
      data: {
        conversations: [conv("c1", new Date().toISOString())],
        total: 1,
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never);
    render(<AlexPanel />, { wrapper });
    expect(screen.getByRole("link", { name: /all conversations/i })).toHaveAttribute(
      "href",
      "/conversations",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test src/components/console/panels/__tests__/alex-panel.test.tsx`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write minimal implementation**

Create `apps/dashboard/src/components/console/panels/alex-panel.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useConversations } from "@/hooks/use-conversations";
import { ZoneSkeleton, ZoneError, ZoneEmpty } from "../zones/zone-states";
import { PanelHead, PanelFoot } from "./panel-chrome";
import { relativeTime, startOfTodayLocal } from "./format";

export function AlexPanel() {
  const conversations = useConversations();

  if (conversations.isLoading) return <ZoneSkeleton label="Loading Alex" />;
  if (conversations.error) {
    return (
      <ZoneError
        message="Couldn't load Alex."
        onRetry={() => conversations.refetch()}
      />
    );
  }

  const all = conversations.data?.conversations ?? [];
  const sorted = [...all].sort(
    (a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime(),
  );
  const recent = sorted.slice(0, 8);

  if (recent.length === 0) {
    return (
      <section
        id="agent-panel-alex"
        className="panel"
        role="region"
        aria-labelledby="agent-card-alex"
      >
        <ZoneEmpty message="No conversations yet." />
      </section>
    );
  }

  const today = startOfTodayLocal();
  const todayCount = all.filter((c) => new Date(c.lastActivityAt) >= today).length;
  const ownerCount = all.filter((c) => c.status === "human_override").length;

  return (
    <section
      id="agent-panel-alex"
      className="panel"
      role="region"
      aria-labelledby="agent-card-alex"
    >
      <PanelHead
        label="Alex · Conversations"
        meta={
          <span>
            <b>{ownerCount}</b> owner <span className="sep">·</span>{" "}
            <b>{all.length - ownerCount}</b> agent
          </span>
        }
      />
      <ul className="conv-list">
        {recent.map((c) => (
          <li key={c.id}>
            <Link className="conv-row" href="/conversations">
              <span className="body">
                <span className="meta">{c.channel}</span>
                <span className="intent">{c.currentIntent ?? "No intent yet"}</span>
              </span>
              <span className="meta">{relativeTime(c.lastActivityAt)}</span>
              <span
                className={`stage-pill${c.status === "human_override" ? " review" : ""}`}
              >
                {c.status}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <PanelFoot
        stats={
          <span>
            <b>{todayCount}</b> today <span className="sep">·</span>{" "}
            <b>{ownerCount}</b> need owner
          </span>
        }
        cta={
          <Link className="pill-graphite" href="/conversations">
            All conversations →
          </Link>
        }
      />
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test src/components/console/panels/__tests__/alex-panel.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/panels/alex-panel.tsx apps/dashboard/src/components/console/panels/__tests__/alex-panel.test.tsx
git commit -m "$(cat <<'EOF'
feat(console): add Alex conversation-list panel

Renders the most recent 8 conversations sorted by lastActivityAt desc.
Status pill is coral when conversation is in human_override. Row click +
PanelFoot CTA both navigate to /conversations.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: mira-panel — creative-job list

**Files:**

- Create: `apps/dashboard/src/components/console/panels/mira-panel.tsx`
- Create: `apps/dashboard/src/components/console/panels/__tests__/mira-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/components/console/panels/__tests__/mira-panel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MiraPanel } from "../mira-panel";

vi.mock("@/hooks/use-module-status");
vi.mock("../agent-stats");
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1" }, status: "authenticated" }),
}));

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

const job = (
  id: string,
  updatedAt: string,
  currentStage = "render",
  stoppedAt: string | null = null,
) => ({
  id,
  updatedAt,
  currentStage,
  stoppedAt,
  brief: { productDescription: `desc-${id}` },
});

async function mockHooks(opts: {
  module?: { data?: unknown; isLoading?: boolean; error?: Error | null };
  jobs?: { data?: unknown; isLoading?: boolean; error?: Error | null };
}) {
  const modMod = await import("@/hooks/use-module-status");
  vi.mocked(modMod.useModuleStatus).mockReturnValue({
    data: opts.module?.data,
    isLoading: opts.module?.isLoading ?? false,
    error: opts.module?.error ?? null,
    refetch: vi.fn(),
  } as never);
  const statsMod = await import("../agent-stats");
  vi.mocked(statsMod.useCreativeJobsCurrent).mockReturnValue({
    data: opts.jobs?.data,
    isLoading: opts.jobs?.isLoading ?? false,
    error: opts.jobs?.error ?? null,
    refetch: vi.fn(),
  } as never);
}

describe("MiraPanel", () => {
  it("renders skeleton while loading", async () => {
    await mockHooks({ module: { isLoading: true } });
    render(<MiraPanel />, { wrapper });
    expect(screen.getByLabelText(/loading mira/i)).toBeInTheDocument();
  });

  it("renders error retry on failure", async () => {
    await mockHooks({
      module: { data: [{ id: "creative", state: "live" }] },
      jobs: { error: new Error("boom") },
    });
    render(<MiraPanel />, { wrapper });
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders empty CTA when creative module not live", async () => {
    await mockHooks({
      module: { data: [{ id: "creative", state: "draft" }] },
      jobs: { data: [] },
    });
    render(<MiraPanel />, { wrapper });
    expect(screen.getByText(/no creative module deployed/i)).toBeInTheDocument();
  });

  it("renders empty state when module is live but no jobs", async () => {
    await mockHooks({
      module: { data: [{ id: "creative", state: "live" }] },
      jobs: { data: [] },
    });
    render(<MiraPanel />, { wrapper });
    expect(screen.getByText(/no creative jobs in flight/i)).toBeInTheDocument();
  });

  it("renders most recent 8 jobs sorted desc by updatedAt", async () => {
    const now = Date.now();
    const jobs = Array.from({ length: 12 }, (_, i) =>
      job(`j${i}`, new Date(now - i * 60_000).toISOString()),
    );
    await mockHooks({
      module: { data: [{ id: "creative", state: "live" }] },
      jobs: { data: jobs },
    });
    const { container } = render(<MiraPanel />, { wrapper });
    expect(container.querySelectorAll(".creative-row")).toHaveLength(8);
  });

  it("review-stage pill is coral", async () => {
    await mockHooks({
      module: { data: [{ id: "creative", state: "live" }] },
      jobs: { data: [job("j1", new Date().toISOString(), "review")] },
    });
    const { container } = render(<MiraPanel />, { wrapper });
    expect(container.querySelector(".stage-pill.review")).not.toBeNull();
  });

  it("rows link to /marketplace/creative-jobs/${id}", async () => {
    await mockHooks({
      module: { data: [{ id: "creative", state: "live" }] },
      jobs: { data: [job("abc-123", new Date().toISOString())] },
    });
    render(<MiraPanel />, { wrapper });
    const link = screen.getByRole("link", { name: /desc-abc-123/i });
    expect(link).toHaveAttribute("href", "/marketplace/creative-jobs/abc-123");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test src/components/console/panels/__tests__/mira-panel.test.tsx`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write minimal implementation**

Create `apps/dashboard/src/components/console/panels/mira-panel.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useModuleStatus } from "@/hooks/use-module-status";
import { ZoneSkeleton, ZoneError, ZoneEmpty } from "../zones/zone-states";
import { PanelHead, PanelFoot } from "./panel-chrome";
import { useCreativeJobsCurrent } from "./agent-stats";
import { relativeTime, truncate } from "./format";

export function MiraPanel() {
  const modules = useModuleStatus();
  const jobs = useCreativeJobsCurrent();

  if (modules.isLoading || jobs.isLoading) return <ZoneSkeleton label="Loading Mira" />;
  if (modules.error || jobs.error) {
    return (
      <ZoneError
        message="Couldn't load Mira."
        onRetry={() => {
          modules.refetch();
          jobs.refetch();
        }}
      />
    );
  }

  const moduleList = (modules.data ?? []) as Array<{ id: string; state: string }>;
  const live = moduleList.some((m) => m.id === "creative" && m.state === "live");

  if (!live) {
    return (
      <section
        id="agent-panel-mira"
        className="panel"
        role="region"
        aria-labelledby="agent-card-mira"
      >
        <ZoneEmpty
          message="No creative module deployed yet."
          cta={
            <Link href="/marketplace" className="btn btn-text">
              Connect creative →
            </Link>
          }
        />
      </section>
    );
  }

  const all = jobs.data ?? [];
  const sorted = [...all].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  const recent = sorted.slice(0, 8);
  const inFlight = all.filter(
    (j) => j.currentStage !== "complete" && !j.stoppedAt,
  ).length;
  const atGate = all.filter(
    (j) => j.currentStage === "review" && !j.stoppedAt,
  ).length;

  if (recent.length === 0) {
    return (
      <section
        id="agent-panel-mira"
        className="panel"
        role="region"
        aria-labelledby="agent-card-mira"
      >
        <ZoneEmpty message="No creative jobs in flight." />
      </section>
    );
  }

  return (
    <section
      id="agent-panel-mira"
      className="panel"
      role="region"
      aria-labelledby="agent-card-mira"
    >
      <PanelHead
        label="Mira · Creatives"
        meta={
          <span>
            <b>{inFlight}</b> in flight <span className="sep">·</span>{" "}
            <b>{atGate}</b> at gate
          </span>
        }
      />
      <ul className="creative-list">
        {recent.map((job) => (
          <li key={job.id}>
            <Link className="creative-row" href={`/marketplace/creative-jobs/${job.id}`}>
              <span className="body">
                <span className="meta">
                  {truncate(job.brief?.productDescription ?? "", 48)}
                </span>
              </span>
              <span className="meta">{relativeTime(job.updatedAt)}</span>
              <span
                className={`stage-pill${job.currentStage === "review" ? " review" : ""}`}
              >
                {job.currentStage}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <PanelFoot
        stats={
          <span>
            <b>{inFlight}</b> in flight <span className="sep">·</span>{" "}
            <b>{atGate}</b> awaiting approval
          </span>
        }
        cta={
          <Link className="pill-graphite" href="/marketplace?module=creative">
            All creatives →
          </Link>
        }
      />
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test src/components/console/panels/__tests__/mira-panel.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/panels/mira-panel.tsx apps/dashboard/src/components/console/panels/__tests__/mira-panel.test.tsx
git commit -m "$(cat <<'EOF'
feat(console): add Mira creatives panel

Renders the most recent 8 creative jobs sorted by updatedAt desc. Stage pill
is coral when stage is "review" (operator action needed). Row click opens
the existing creative job detail page.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: extend use-keyboard-shortcuts with 1/2/3

**Files:**

- Modify: `apps/dashboard/src/components/console/use-keyboard-shortcuts.ts`
- Modify: `apps/dashboard/src/components/console/__tests__/use-keyboard-shortcuts.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `apps/dashboard/src/components/console/__tests__/use-keyboard-shortcuts.test.ts`:

```ts
describe("agent shortcuts (1/2/3)", () => {
  it("'1' fires agent1 handler", () => {
    const agent1 = vi.fn();
    renderHook(() => useKeyboardShortcuts({ agent1 }));
    fireEvent.keyDown(window, { key: "1" });
    expect(agent1).toHaveBeenCalledTimes(1);
  });

  it("'2' fires agent2 handler", () => {
    const agent2 = vi.fn();
    renderHook(() => useKeyboardShortcuts({ agent2 }));
    fireEvent.keyDown(window, { key: "2" });
    expect(agent2).toHaveBeenCalledTimes(1);
  });

  it("'3' fires agent3 handler", () => {
    const agent3 = vi.fn();
    renderHook(() => useKeyboardShortcuts({ agent3 }));
    fireEvent.keyDown(window, { key: "3" });
    expect(agent3).toHaveBeenCalledTimes(1);
  });

  it("'1' does not fire when target is a textarea", () => {
    const agent1 = vi.fn();
    renderHook(() => useKeyboardShortcuts({ agent1 }));
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    fireEvent.keyDown(ta, { key: "1", bubbles: true });
    expect(agent1).not.toHaveBeenCalled();
    ta.remove();
  });

  it("'1' does not fire when target is contentEditable", () => {
    const agent1 = vi.fn();
    renderHook(() => useKeyboardShortcuts({ agent1 }));
    const div = document.createElement("div");
    div.contentEditable = "true";
    document.body.appendChild(div);
    fireEvent.keyDown(div, { key: "1", bubbles: true });
    expect(agent1).not.toHaveBeenCalled();
    div.remove();
  });

  it("'4' (unmapped) is a no-op", () => {
    const agent1 = vi.fn();
    const agent2 = vi.fn();
    const agent3 = vi.fn();
    renderHook(() => useKeyboardShortcuts({ agent1, agent2, agent3 }));
    fireEvent.keyDown(window, { key: "4" });
    expect(agent1).not.toHaveBeenCalled();
    expect(agent2).not.toHaveBeenCalled();
    expect(agent3).not.toHaveBeenCalled();
  });
});
```

(Imports `renderHook` and `fireEvent` may already exist at top of file from Phase 1; add if missing.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test src/components/console/__tests__/use-keyboard-shortcuts.test.ts`
Expected: FAIL — `agent1`/`agent2`/`agent3` not in `Handlers` type, or never called.

- [ ] **Step 3: Add the handlers + branches**

Modify `apps/dashboard/src/components/console/use-keyboard-shortcuts.ts`:

```ts
"use client";

import { useEffect } from "react";

export type KeyboardShortcutHandlers = Partial<{
  help: () => void;
  halt: () => void;
  escape: () => void;
  agent1: () => void;
  agent2: () => void;
  agent3: () => void;
}>;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return true;
  if (target.contentEditable === "true") return true;
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
      if (e.key === "1") {
        if (handlers.agent1) handlers.agent1();
        return;
      }
      if (e.key === "2") {
        if (handlers.agent2) handlers.agent2();
        return;
      }
      if (e.key === "3") {
        if (handlers.agent3) handlers.agent3();
        return;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handlers]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test src/components/console/__tests__/use-keyboard-shortcuts.test.ts`
Expected: PASS — existing tests still green plus the new 6.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/use-keyboard-shortcuts.ts apps/dashboard/src/components/console/__tests__/use-keyboard-shortcuts.test.ts
git commit -m "$(cat <<'EOF'
feat(console): extend useKeyboardShortcuts with 1/2/3 agent toggles

Adds optional agent1 / agent2 / agent3 handlers fired by digit keys 1, 2, 3.
INPUT / TEXTAREA / contentEditable bail-out applies to the new keys.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: rewrite agent-strip — wire toggle + stats

**Files:**

- Modify: `apps/dashboard/src/components/console/zones/agent-strip.tsx`
- Modify: `apps/dashboard/src/components/console/zones/__tests__/agent-strip.test.tsx`

- [ ] **Step 1: Rewrite the test**

Replace `apps/dashboard/src/components/console/zones/__tests__/agent-strip.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AgentStrip } from "../agent-strip";
import { ExpandedAgentProvider } from "../../expanded-agent-context";

vi.mock("@/hooks/use-agents");
vi.mock("@/hooks/use-module-status");
vi.mock("../../panels/agent-stats");
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1" }, status: "authenticated" }),
}));

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <ExpandedAgentProvider>{children}</ExpandedAgentProvider>
    </QueryClientProvider>
  );
};

async function mockHooks(opts: {
  roster?: { data?: unknown; isLoading?: boolean; error?: Error | null; refetch?: () => void };
  state?: { data?: unknown; isLoading?: boolean; error?: Error | null; refetch?: () => void };
  modules?: { data?: unknown; isLoading?: boolean; error?: Error | null; refetch?: () => void };
  stats?: Record<string, { primary: string; secondary: string }>;
}) {
  const agentsMod = await import("@/hooks/use-agents");
  vi.mocked(agentsMod.useAgentRoster).mockReturnValue({
    data: opts.roster?.data,
    isLoading: opts.roster?.isLoading ?? false,
    error: opts.roster?.error ?? null,
    refetch: opts.roster?.refetch ?? vi.fn(),
  } as never);
  vi.mocked(agentsMod.useAgentState).mockReturnValue({
    data: opts.state?.data,
    isLoading: opts.state?.isLoading ?? false,
    error: opts.state?.error ?? null,
    refetch: opts.state?.refetch ?? vi.fn(),
  } as never);
  const modMod = await import("@/hooks/use-module-status");
  vi.mocked(modMod.useModuleStatus).mockReturnValue({
    data: opts.modules?.data,
    isLoading: opts.modules?.isLoading ?? false,
    error: opts.modules?.error ?? null,
    refetch: opts.modules?.refetch ?? vi.fn(),
  } as never);
  const statsMod = await import("../../panels/agent-stats");
  vi.mocked(statsMod.useAgentStripStats).mockReturnValue(
    (opts.stats as never) ?? {
      nova: { primary: "$ 4,820", secondary: "5 campaigns · 1 recs pending" },
      alex: { primary: "12 today", secondary: "2 need owner" },
      mira: { primary: "3 in flight", secondary: "1 awaiting approval" },
    },
  );
}

describe("AgentStrip", () => {
  it("renders skeleton while any hook is loading", async () => {
    await mockHooks({ roster: { isLoading: true } });
    render(<AgentStrip />, { wrapper });
    expect(screen.getByLabelText(/loading agents/i)).toBeInTheDocument();
  });

  it("renders error state with retry that calls all three refetches", async () => {
    const rosterRefetch = vi.fn();
    const stateRefetch = vi.fn();
    const moduleRefetch = vi.fn();
    await mockHooks({
      roster: { error: new Error("boom"), refetch: rosterRefetch },
      state: { data: { states: [] }, refetch: stateRefetch },
      modules: { data: [], refetch: moduleRefetch },
    });
    render(<AgentStrip />, { wrapper });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(rosterRefetch).toHaveBeenCalledTimes(1);
    expect(stateRefetch).toHaveBeenCalledTimes(1);
    expect(moduleRefetch).toHaveBeenCalledTimes(1);
  });

  it("renders three agents with real stats from useAgentStripStats", async () => {
    await mockHooks({
      roster: { data: { roster: [] } },
      state: { data: { states: [] } },
      modules: { data: [] },
    });
    render(<AgentStrip />, { wrapper });
    expect(screen.getByText("Nova")).toBeInTheDocument();
    expect(screen.getByText("$ 4,820")).toBeInTheDocument();
    expect(screen.getByText("5 campaigns · 1 recs pending")).toBeInTheDocument();
    expect(screen.getByText("12 today")).toBeInTheDocument();
    expect(screen.getByText("3 in flight")).toBeInTheDocument();
  });

  it("clicking a card toggles expansion (Nova → Alex via click)", async () => {
    await mockHooks({
      roster: { data: { roster: [] } },
      state: { data: { states: [] } },
      modules: { data: [] },
    });
    render(<AgentStrip />, { wrapper });
    const novaBtn = screen.getByRole("button", { name: /Nova panel open/i });
    expect(novaBtn).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: /open Alex panel/i }));
    expect(screen.getByRole("button", { name: /Alex panel open/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /open Nova panel/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("clicking the already-expanded card collapses it", async () => {
    await mockHooks({
      roster: { data: { roster: [] } },
      state: { data: { states: [] } },
      modules: { data: [] },
    });
    render(<AgentStrip />, { wrapper });
    await userEvent.click(screen.getByRole("button", { name: /Nova panel open/i }));
    expect(screen.getByRole("button", { name: /open Nova panel/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("does not render any nested <a> inside agent-col buttons", async () => {
    await mockHooks({
      roster: { data: { roster: [] } },
      state: { data: { states: [] } },
      modules: { data: [] },
    });
    const { container } = render(<AgentStrip />, { wrapper });
    const buttons = container.querySelectorAll("button.agent-col");
    expect(buttons.length).toBeGreaterThan(0);
    buttons.forEach((btn) => {
      expect(btn.querySelector("a")).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test src/components/console/zones/__tests__/agent-strip.test.tsx`
Expected: FAIL — current `agent-strip.tsx` still has the nested `<Link>` and no toggle wiring.

- [ ] **Step 3: Rewrite the implementation**

Replace `apps/dashboard/src/components/console/zones/agent-strip.tsx`:

```tsx
"use client";

import { useAgentRoster, useAgentState } from "@/hooks/use-agents";
import { useModuleStatus } from "@/hooks/use-module-status";
import { useExpandedAgent, type AgentKey } from "../expanded-agent-context";
import { useAgentStripStats } from "../panels/agent-stats";
import { ZoneError, ZoneSkeleton } from "./zone-states";

const AGENTS: ReadonlyArray<{ key: AgentKey; name: string }> = [
  { key: "alex", name: "Alex" },
  { key: "nova", name: "Nova" },
  { key: "mira", name: "Mira" },
];

export function AgentStrip() {
  const roster = useAgentRoster();
  const state = useAgentState();
  const modules = useModuleStatus();
  const { expanded, toggle } = useExpandedAgent();
  const stats = useAgentStripStats();

  if (roster.isLoading || state.isLoading || modules.isLoading) {
    return <ZoneSkeleton label="Loading agents" />;
  }

  if (roster.error || state.error || modules.error) {
    return (
      <ZoneError
        message="Couldn't load agents."
        onRetry={() => {
          roster.refetch();
          state.refetch();
          modules.refetch();
        }}
      />
    );
  }

  return (
    <div className="agent-strip">
      {AGENTS.map((a) => {
        const isOpen = expanded === a.key;
        return (
          <button
            key={a.key}
            id={`agent-card-${a.key}`}
            className={`agent-col${isOpen ? " active" : ""}`}
            type="button"
            aria-pressed={isOpen}
            aria-controls={`agent-panel-${a.key}`}
            aria-label={isOpen ? `${a.name} panel open` : `Open ${a.name} panel`}
            onClick={() => toggle(a.key)}
          >
            <span className="a-name">{a.name}</span>
            <span className="a-stat">{stats[a.key].primary}</span>
            <span className="a-sub muted">{stats[a.key].secondary}</span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test src/components/console/zones/__tests__/agent-strip.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/zones/agent-strip.tsx apps/dashboard/src/components/console/zones/__tests__/agent-strip.test.tsx
git commit -m "$(cat <<'EOF'
refactor(console): wire AgentStrip click → expand panel + real stats

Each card calls toggle(key) from useExpandedAgent. aria-pressed +
aria-controls reflect open state. Stats come from useAgentStripStats. The
nested <Link> "view conversations →" affordance is removed (a11y: no
interactive children inside button); per-agent deep links move into each
panel's PanelFoot. The .zone3 wrapper + .zone-head move out into AgentsZone
in the next task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: AgentsZone — strip + active panel slot

**Files:**

- Create: `apps/dashboard/src/components/console/zones/agents-zone.tsx`
- Create: `apps/dashboard/src/components/console/zones/__tests__/agents-zone.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/components/console/zones/__tests__/agents-zone.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AgentsZone } from "../agents-zone";
import {
  ExpandedAgentProvider,
  useExpandedAgent,
} from "../../expanded-agent-context";

vi.mock("../agent-strip", () => ({ AgentStrip: () => <div data-testid="strip" /> }));
vi.mock("../../panels/nova-panel", () => ({
  NovaPanel: () => <div data-testid="nova-panel" />,
}));
vi.mock("../../panels/alex-panel", () => ({
  AlexPanel: () => <div data-testid="alex-panel" />,
}));
vi.mock("../../panels/mira-panel", () => ({
  MiraPanel: () => <div data-testid="mira-panel" />,
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1" }, status: "authenticated" }),
}));

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <ExpandedAgentProvider>{children}</ExpandedAgentProvider>
    </QueryClientProvider>
  );
};

function Setter({ to }: { to: "nova" | "alex" | "mira" | null }) {
  const { setExpanded } = useExpandedAgent();
  // run synchronously on mount so the rendered tree reflects the chosen state
  if (to !== undefined) setExpanded(to);
  return null;
}

describe("AgentsZone", () => {
  it("renders section.zone3 with Agents label and the strip", () => {
    const { container } = render(<AgentsZone />, { wrapper });
    expect(container.querySelector("section.zone3")).not.toBeNull();
    expect(screen.getByText("Agents")).toBeInTheDocument();
    expect(screen.getByTestId("strip")).toBeInTheDocument();
  });

  it("renders only the Nova panel when expanded=nova (default)", () => {
    render(<AgentsZone />, { wrapper });
    expect(screen.getByTestId("nova-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("alex-panel")).toBeNull();
    expect(screen.queryByTestId("mira-panel")).toBeNull();
  });

  it("renders only Alex when expanded=alex", () => {
    render(
      <>
        <Setter to="alex" />
        <AgentsZone />
      </>,
      { wrapper },
    );
    expect(screen.getByTestId("alex-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("nova-panel")).toBeNull();
    expect(screen.queryByTestId("mira-panel")).toBeNull();
  });

  it("renders no panel when expanded=null", () => {
    render(
      <>
        <Setter to={null} />
        <AgentsZone />
      </>,
      { wrapper },
    );
    expect(screen.queryByTestId("nova-panel")).toBeNull();
    expect(screen.queryByTestId("alex-panel")).toBeNull();
    expect(screen.queryByTestId("mira-panel")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test src/components/console/zones/__tests__/agents-zone.test.tsx`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write minimal implementation**

Create `apps/dashboard/src/components/console/zones/agents-zone.tsx`:

```tsx
"use client";

import { AgentStrip } from "./agent-strip";
import { useExpandedAgent } from "../expanded-agent-context";
import { NovaPanel } from "../panels/nova-panel";
import { AlexPanel } from "../panels/alex-panel";
import { MiraPanel } from "../panels/mira-panel";

export function AgentsZone() {
  const { expanded } = useExpandedAgent();
  return (
    <section className="zone3" aria-label="Agents">
      <div className="zone-head">
        <span className="label">Agents</span>
      </div>
      <AgentStrip />
      {expanded === "nova" && <NovaPanel />}
      {expanded === "alex" && <AlexPanel />}
      {expanded === "mira" && <MiraPanel />}
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test src/components/console/zones/__tests__/agents-zone.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/zones/agents-zone.tsx apps/dashboard/src/components/console/zones/__tests__/agents-zone.test.tsx
git commit -m "$(cat <<'EOF'
feat(console): add AgentsZone wrapper for strip + active panel

Owns the .zone3 section + .zone-head label and conditionally renders one of
{NovaPanel, AlexPanel, MiraPanel} based on useExpandedAgent. Conditional
render means collapsed panels do not subscribe to their data hooks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: console-view — wrap with provider + wire keyboard + render AgentsZone

**Files:**

- Modify: `apps/dashboard/src/components/console/console-view.tsx`
- Modify: `apps/dashboard/src/components/console/__tests__/console-view.test.tsx`
- Delete: `apps/dashboard/src/components/console/zones/nova-panel.tsx`
- Delete: `apps/dashboard/src/components/console/zones/__tests__/nova-panel.test.tsx`

- [ ] **Step 1: Update the test**

Modify `apps/dashboard/src/components/console/__tests__/console-view.test.tsx` — add cases (existing tests should keep passing):

```tsx
// Append inside the existing describe('ConsoleView', ...) block:

it("wraps inner with ExpandedAgentProvider (no throw on useExpandedAgent)", () => {
  // Smoke test — render and assert AgentsZone-side artifact appears
  render(<ConsoleView />);
  // Nova auto-expanded by default; the AgentsZone renders agents label
  expect(screen.getByText("Agents")).toBeInTheDocument();
});

it("keyboard '1' toggles Nova panel via ExpandedAgentProvider", async () => {
  const user = userEvent.setup();
  render(<ConsoleView />);
  // Nova is auto-expanded → pressing '1' should collapse
  await user.keyboard("1");
  // If Nova is collapsed, the agent-card-nova button should have aria-pressed=false
  const novaBtn = await screen.findByRole("button", { name: /open Nova panel/i });
  expect(novaBtn).toHaveAttribute("aria-pressed", "false");
});

it("Esc priority — closes help first, then collapses panel", async () => {
  const user = userEvent.setup();
  render(<ConsoleView />);
  // Open help
  await user.keyboard("?");
  expect(screen.getByRole("dialog", { hidden: true })).toBeInTheDocument(); // help overlay role; adjust if HelpOverlay uses different role
  // Esc closes help
  await user.keyboard("{Escape}");
  // Now Nova is still expanded; Esc should collapse it
  await user.keyboard("{Escape}");
  expect(
    screen.getByRole("button", { name: /open Nova panel/i }),
  ).toHaveAttribute("aria-pressed", "false");
});
```

(The `dialog` role assertion is best-effort; if `HelpOverlay` does not expose `role="dialog"`, adapt to a stable selector — e.g. `screen.getByText(/keyboard shortcuts/i)`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test src/components/console/__tests__/console-view.test.tsx`
Expected: FAIL — no `ExpandedAgentProvider` in `console-view.tsx`; `1` and Esc-priority not wired.

- [ ] **Step 3: Modify console-view.tsx**

Replace `apps/dashboard/src/components/console/console-view.tsx`:

```tsx
"use client";

import "./console.css";
import { useState } from "react";
import { OpStrip } from "./zones/op-strip";
import { QueueZone } from "./zones/queue-zone";
import { AgentsZone } from "./zones/agents-zone";
import { ActivityTrail } from "./zones/activity-trail";
import { WelcomeBanner } from "./welcome-banner";
import { HelpOverlay } from "./help-overlay";
import { ToastShelf } from "./toast-shelf";
import { ToastProvider, useToast } from "./use-toast";
import { HaltProvider, toggleHaltWithToast, useHalt } from "./halt-context";
import {
  ExpandedAgentProvider,
  useExpandedAgent,
} from "./expanded-agent-context";
import { useKeyboardShortcuts } from "./use-keyboard-shortcuts";

function ConsoleViewInner() {
  const [helpOpen, setHelpOpen] = useState(false);

  const { halted, setHalted, toggleHalt } = useHalt();
  const { expanded, setExpanded, toggle } = useExpandedAgent();
  const { showToast } = useToast();

  useKeyboardShortcuts({
    help: () => setHelpOpen((v) => !v),
    halt: () => toggleHaltWithToast({ halted, setHalted, toggleHalt, showToast }),
    escape: () => {
      if (helpOpen) {
        setHelpOpen(false);
        return;
      }
      if (expanded) {
        setExpanded(null);
        return;
      }
    },
    agent1: () => toggle("nova"),
    agent2: () => toggle("alex"),
    agent3: () => toggle("mira"),
  });

  return (
    <div data-v6-console>
      <OpStrip onHelpOpen={() => setHelpOpen(true)} />
      <main className="console-main">
        <WelcomeBanner />
        <QueueZone />
        <AgentsZone />
        <ActivityTrail />
      </main>
      {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
      <ToastShelf />
    </div>
  );
}

export function ConsoleView() {
  return (
    <ToastProvider>
      <HaltProvider>
        <ExpandedAgentProvider>
          <ConsoleViewInner />
        </ExpandedAgentProvider>
      </HaltProvider>
    </ToastProvider>
  );
}
```

Now the old Nova path is unreferenced. Delete:

```bash
git rm apps/dashboard/src/components/console/zones/nova-panel.tsx apps/dashboard/src/components/console/zones/__tests__/nova-panel.test.tsx
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/dashboard test src/components/console/__tests__/console-view.test.tsx`
Expected: PASS — old + new cases green.

Run full suite: `pnpm --filter @switchboard/dashboard test`
Expected: PASS — all 458+ tests green plus the new ones.

Run typecheck: `pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/console/console-view.tsx apps/dashboard/src/components/console/__tests__/console-view.test.tsx
git commit -m "$(cat <<'EOF'
feat(console): wire phase 3 — provider tree, keyboard shortcuts, AgentsZone

ConsoleView now wraps with ExpandedAgentProvider (innermost). Keyboard
handlers register agent1/2/3 toggles; Esc priority chain closes help first,
then collapses the active panel. The legacy zones/nova-panel.tsx is removed
in favor of panels/nova-panel.tsx (now reachable through AgentsZone).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: CSS additions — panel-expand + conv/creative rows

**Files:**

- Modify: `apps/dashboard/src/components/console/console.css`

- [ ] **Step 1: Append the new rules**

Append to `apps/dashboard/src/components/console/console.css`:

```css
/* ---------- Phase 3 — panel expand transition ---------- */
[data-v6-console] .panel {
  animation: panel-expand 220ms ease-out;
  overflow: hidden;
}
@keyframes panel-expand {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media (prefers-reduced-motion: reduce) {
  [data-v6-console] .panel {
    animation: none;
  }
}

/* ---------- Phase 3 — Alex / Mira list rows ---------- */
[data-v6-console] .conv-list,
[data-v6-console] .creative-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
[data-v6-console] .conv-row,
[data-v6-console] .creative-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 0.85rem 1.4rem;
  align-items: center;
  padding: 0.75rem 0.85rem;
  border-bottom: 1px solid var(--c-hair-soft);
  font-size: 0.875rem;
  color: var(--c-text-2);
  transition: background 160ms ease;
}
[data-v6-console] .conv-row:hover,
[data-v6-console] .creative-row:hover {
  background: hsl(28 25% 87% / 0.5);
}
[data-v6-console] .conv-row .body,
[data-v6-console] .creative-row .body {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}
[data-v6-console] .conv-row .intent {
  font-size: 0.9375rem;
  color: var(--c-text);
  font-weight: 500;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}
[data-v6-console] .stage-pill {
  font-family: var(--c-mono);
  font-size: 10.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-weight: 600;
  color: var(--c-text-3);
  white-space: nowrap;
}
[data-v6-console] .stage-pill.review {
  color: var(--c-coral);
}
```

- [ ] **Step 2: Visual sanity check**

Run: `pnpm --filter @switchboard/dashboard dev` (port 3002).

Open `/console`. Verify:

- Nova panel renders with the existing `.adset` styling.
- Click "Alex" — panel transitions smoothly (220ms fade + slight slide-down).
- Conversation rows show channel meta + intent + relative time + status pill.
- `human_override` rows show coral pill.
- Click "Mira" — same shape, with stage pill coral when stage is `review`.
- DevTools → Rendering → Emulate `prefers-reduced-motion: reduce` — confirm no animation.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/console/console.css
git commit -m "$(cat <<'EOF'
style(console): add phase 3 css — panel-expand + conv/creative rows

Adds .panel animation (220ms fade + 4px translateY) honoring
prefers-reduced-motion. New .conv-row / .creative-row grid layout for the
Alex and Mira lists. New .stage-pill (review variant coral). Reuses every
other token already in tree.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: full-suite verification + acceptance walkthrough

**Files:** none — verification only.

- [ ] **Step 1: Run full test suite**

Run: `pnpm --filter @switchboard/dashboard test`
Expected: PASS, 458+ tests + the new phase-3 tests (~50 new across 11 files).

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS.

- [ ] **Step 3: Run lint**

Run: `pnpm --filter @switchboard/dashboard lint`
Expected: PASS — no new warnings.

- [ ] **Step 4: File-size check**

Run: `find apps/dashboard/src/components/console -name '*.tsx' -o -name '*.ts' | xargs wc -l | sort -rn | head -20`
Expected: no file exceeds 400 lines.

- [ ] **Step 5: Manual acceptance walkthrough**

Run: `pnpm dev`. Open `http://localhost:3002/console`.

Walk the spec's acceptance criteria:

1. ☐ First visit → Agents zone shows strip + Nova panel auto-expanded; Nova card has coral underline.
2. ☐ Click Alex → Nova collapses, Alex expands in one transition; underline moves.
3. ☐ Click Alex again → collapses; no underline.
4. ☐ Press `1` / `2` / `3` → toggles Nova / Alex / Mira; pressing again collapses.
5. ☐ Open help (`?`); press `Esc` → help closes; press `Esc` again with a panel expanded → panel collapses; press `Esc` with nothing open → no-op.
6. ☐ Press `1` while focused inside a textarea (e.g. an Escalation reply form) → does NOT toggle Nova.
7. ☐ Strip cards show real today-stats (assuming seeded data; em-dashes if signed-out).
8. ☐ Nova table renders campaign rows; recommendations with draftId match a queue card show "Pending approval" linking to `#q-${draftId}`.
9. ☐ When at least one such cross-link is live, `panel-note` appears with "approve in queue above ↑" + Jump to card →; click smooth-scrolls + flashes the queue card.
10. ☐ DevTools emulate `prefers-reduced-motion: reduce` → panel animation gone; cross-link scroll uses `auto`.
11. ☐ Alex shows recent 8 conversations; row click → `/conversations`.
12. ☐ Mira shows recent 8 creative jobs; review-stage pill is coral; row click → `/marketplace/creative-jobs/${id}`.
13. ☐ Reload page → expansion choice survives (or default-Nova if cleared).
14. ☐ Nova foot has "See ROI →" link to `/dashboard/roi`.

- [ ] **Step 6: Commit (if any housekeeping changes from walkthrough, otherwise skip)**

```bash
# only if the walkthrough surfaced fixes:
git add -p
git commit -m "fix(console): phase 3 acceptance walkthrough fixes"
```

If the walkthrough is clean, this task is verification-only — no commit.

- [ ] **Step 7: Open the implementation PR**

```bash
git push -u origin feat/console-frame-phase-3
gh pr create --title "feat(console): phase 3 (agents) — click-to-expand panels + per-agent stats" --body "$(cat <<'EOF'
## Summary

- Wires `/console` Agent strip click + `1/2/3` keyboard to expand the matching agent panel (Nova / Alex / Mira) below the strip
- Mutually-exclusive single-panel slot; default-Nova on first visit; explicit collapse persists via `localStorage`
- Nova reads campaign rows from `useAdOptimizerAudit`; Alex from `useConversations`; Mira from `useCreativeJobs`
- Per-agent today-stats wired in the strip cards
- Nova → queue cross-link uses Phase 2's `id="q-${cardId}"` scroll targets

## Test plan

- [ ] `pnpm --filter @switchboard/dashboard test` passes
- [ ] `pnpm --filter @switchboard/dashboard typecheck` passes
- [ ] `pnpm --filter @switchboard/dashboard lint` passes
- [ ] Manual walkthrough on `/console` with seeded data confirms acceptance criteria
- [ ] No file in `apps/dashboard/src/components/console/` exceeds 400 lines

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Notes

**Spec coverage check.**
- ExpandedAgentProvider — Task 2.
- format helpers (truncate / relativeTime / formatUSDCompact / startOfTodayLocal) — Task 1.
- scroll-to-card with prefers-reduced-motion — Task 3.
- agent-stats derivation + wrapper hooks (`useAdOptimizerAuditCurrent`, `useCreativeJobsCurrent`, `useAgentStripStats`) — Task 4.
- panel-chrome (PanelHead / PanelFoot) — Task 5.
- nova-recommendation-note — Task 6.
- nova-campaign-table — Task 7.
- nova-panel (moved + extended) — Task 8.
- alex-panel — Task 9.
- mira-panel — Task 10.
- use-keyboard-shortcuts extension (1/2/3) — Task 11.
- agent-strip rewrite (drop nested Link, drop activeKey stub, wire toggle + stats, drop .zone3 wrapper) — Task 12.
- AgentsZone wrapper — Task 13.
- console-view (ExpandedAgentProvider, keyboard wiring incl. Esc priority, AgentsZone render, delete legacy zones/nova-panel) — Task 14.
- CSS additions (panel-expand + conv/creative rows + stage-pill) — Task 15.
- Verification + manual walkthrough + PR — Task 16.

All spec sections covered. No placeholders or TODOs in the plan.

**Type consistency check.**
- `AgentKey` exported from `expanded-agent-context.tsx`, imported by `agent-stats.ts`, `agent-strip.tsx`. Consistent.
- `AgentStripStats` is `Record<AgentKey, AgentStats>`. Used identically in `useAgentStripStats` and `<AgentStrip>`.
- `useAdOptimizerAuditCurrent` / `useCreativeJobsCurrent` exported from `agent-stats.ts`, imported by `nova-panel.tsx` / `mira-panel.tsx`. Consistent.
- `scrollToQueueCard(cardId)` signature consistent across `nova-recommendation-note.tsx`, `nova-campaign-table.tsx`, and the helper.

**Sequencing check.**
- Foundation layer (Tasks 1–5) has no dependency on later tasks.
- Panel composers (Tasks 6–10) depend only on the foundation.
- AgentStrip rewrite (Task 12) depends on `useExpandedAgent` (Task 2) and `useAgentStripStats` (Task 4) — both ready.
- AgentsZone (Task 13) depends on AgentStrip (Task 12) and panels (Tasks 8/9/10) — all ready.
- console-view (Task 14) depends on AgentsZone (Task 13) and the keyboard extension (Task 11) — all ready. This task also performs the legacy `zones/nova-panel.tsx` deletion safely (the new `panels/nova-panel.tsx` is reachable via `AgentsZone` only after this task lands).

No forward references; no missing pieces.
