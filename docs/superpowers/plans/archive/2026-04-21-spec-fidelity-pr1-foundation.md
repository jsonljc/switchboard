# PR 1: Foundation — Compile + Interface Parity + Layout

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all build-breaking issues so the dashboard compiles, the layout renders correctly with rail + responsive behavior, and all component prop interfaces match what OwnerToday passes.

**Architecture:** Create missing `useEntrancePlayed` hook, define dashboard CSS classes in globals.css, add `translateY` prop to FadeIn, and declare (but don't implement) all missing props on StatCard, FunnelStrip, RevenueSummary, ActivityFeed, and ActionCard.

**Tech Stack:** React 18, Next.js 14, TypeScript, Vitest + Testing Library, Tailwind CSS, CSS custom properties

**Spec:** `docs/superpowers/specs/2026-04-21-login-redesign-delta-plan-design.md` — items C1–C3, C4a–C4e, L1, L2a, L5, L7

---

### Task 1: Create `useEntrancePlayed` hook (C1)

**Files:**

- Create: `apps/dashboard/src/hooks/use-entrance-played.ts`
- Create: `apps/dashboard/src/hooks/__tests__/use-entrance-played.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEntrancePlayed } from "../use-entrance-played";

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  sessionStorage.clear();
});

describe("useEntrancePlayed", () => {
  it("returns hasPlayed=false on first mount", () => {
    const { result } = renderHook(() => useEntrancePlayed());
    expect(result.current.hasPlayed).toBe(false);
  });

  it("sets hasPlayed=true after markPlayed is called", () => {
    const { result } = renderHook(() => useEntrancePlayed());
    act(() => result.current.markPlayed());
    expect(result.current.hasPlayed).toBe(true);
  });

  it("persists across remounts via sessionStorage", () => {
    const { result, unmount } = renderHook(() => useEntrancePlayed());
    act(() => result.current.markPlayed());
    unmount();
    const { result: result2 } = renderHook(() => useEntrancePlayed());
    expect(result2.current.hasPlayed).toBe(true);
  });

  it("resets when sessionStorage is cleared", () => {
    const { result, unmount } = renderHook(() => useEntrancePlayed());
    act(() => result.current.markPlayed());
    unmount();
    sessionStorage.clear();
    const { result: result2 } = renderHook(() => useEntrancePlayed());
    expect(result2.current.hasPlayed).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard test -- --run src/hooks/__tests__/use-entrance-played.test.ts`
Expected: FAIL — module `../use-entrance-played` not found

- [ ] **Step 3: Write minimal implementation**

```typescript
"use client";

import { useCallback, useState } from "react";

const KEY = "sw-entrance-played";

function readStorage(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function useEntrancePlayed() {
  const [hasPlayed, setHasPlayed] = useState(readStorage);

  const markPlayed = useCallback(() => {
    setHasPlayed(true);
    try {
      sessionStorage.setItem(KEY, "1");
    } catch {
      // sessionStorage unavailable — animation plays every time, harmless
    }
  }, []);

  return { hasPlayed, markPlayed };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard test -- --run src/hooks/__tests__/use-entrance-played.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/hooks/use-entrance-played.ts apps/dashboard/src/hooks/__tests__/use-entrance-played.test.ts && git commit -m "$(cat <<'EOF'
feat(dashboard): add useEntrancePlayed hook for first-mount animation gate

SessionStorage-backed boolean that prevents dashboard entrance
animations from replaying on re-renders or route changes.
EOF
)"
```

---

### Task 2: Add `translateY` prop to FadeIn (C3)

**Files:**

- Modify: `apps/dashboard/src/components/ui/fade-in.tsx`
- Modify: `apps/dashboard/src/components/ui/__tests__/fade-in.test.tsx`

- [ ] **Step 1: Add test for translateY prop**

Append to the existing test file `apps/dashboard/src/components/ui/__tests__/fade-in.test.tsx`:

```typescript
  it("uses custom translateY value", () => {
    const { container } = render(<FadeIn translateY={8}>x</FadeIn>);
    const div = container.firstChild as HTMLElement;
    expect(div.style.transform).toBe("translateY(0)");
  });

  it("applies style prop to wrapper", () => {
    const { container } = render(<FadeIn style={{ marginTop: "32px" }}>x</FadeIn>);
    const div = container.firstChild as HTMLElement;
    expect(div.style.marginTop).toBe("32px");
  });

  it("respects reduced motion preference", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    const { container } = render(<FadeIn>x</FadeIn>);
    const div = container.firstChild as HTMLElement;
    expect(div.style.opacity).toBe("1");
    expect(div.style.transform).toBe("translateY(0)");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard test -- --run src/components/ui/__tests__/fade-in.test.tsx`
Expected: FAIL — `translateY` and `style` are not accepted props

- [ ] **Step 3: Update FadeIn implementation**

Replace the entire content of `apps/dashboard/src/components/ui/fade-in.tsx`:

```typescript
"use client";

import { useEffect, useState } from "react";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";

interface FadeInProps {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  translateY?: number;
  style?: React.CSSProperties;
}

export function FadeIn({ children, delay = 0, className, translateY = 16, style }: FadeInProps) {
  const { ref, isVisible } = useScrollReveal({ threshold: 0.15, once: true });
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  const show = isVisible || reducedMotion;

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: show ? 1 : 0,
        transform: show ? "translateY(0)" : `translateY(${translateY}px)`,
        transition: reducedMotion
          ? "none"
          : `opacity 380ms ease-out ${delay}ms, transform 380ms ease-out ${delay}ms`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard test -- --run src/components/ui/__tests__/fade-in.test.tsx`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/ui/fade-in.tsx apps/dashboard/src/components/ui/__tests__/fade-in.test.tsx && git commit -m "$(cat <<'EOF'
fix(ui): add translateY prop and reduced-motion guard to FadeIn

FadeIn now accepts configurable translateY (default 16px) and style
prop. Adds explicit prefers-reduced-motion check for instant render.
EOF
)"
```

---

### Task 3: Remove `useEffect` for `markPlayed` in OwnerToday

**Files:**

- Modify: `apps/dashboard/src/components/dashboard/owner-today.tsx`

The current code has a bare `setTimeout` call outside useEffect (lines 91–93). This fires on every render. Fix it to use the existing pattern correctly.

- [ ] **Step 1: Fix the bare setTimeout**

In `apps/dashboard/src/components/dashboard/owner-today.tsx`, replace:

```typescript
if (!hasPlayed && overview) {
  setTimeout(() => markPlayed(), 1200);
}
```

with:

```typescript
useEffect(() => {
  if (hasPlayed || !overview) return;
  const timer = setTimeout(() => markPlayed(), 1200);
  return () => clearTimeout(timer);
}, [hasPlayed, overview, markPlayed]);
```

Also add `useEffect` to the import on line 3 (it was removed when the old `useEffect` was deleted). Change:

```typescript
import { useState } from "react";
```

to:

```typescript
import { useEffect, useState } from "react";
```

- [ ] **Step 2: Verify the dashboard compiles**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard build`
Expected: Build succeeds (the `useEntrancePlayed` hook now exists from Task 1)

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/dashboard/owner-today.tsx && git commit -m "$(cat <<'EOF'
fix(dashboard): wrap markPlayed setTimeout in useEffect

The bare setTimeout was firing on every render. Properly guard with
useEffect and cleanup.
EOF
)"
```

---

### Task 4: Define dashboard layout CSS classes (C2, L1, L5, L7)

**Files:**

- Modify: `apps/dashboard/src/app/globals.css`

- [ ] **Step 1: Add dashboard layout classes to globals.css**

Add the following block after the `.page-width` class (after line 241 in the existing `@layer components` block):

```css
/* ─── Dashboard layout: calm-grid with sticky activity rail ─── */
.dashboard-frame {
  max-width: 76rem;
  margin-left: auto;
  margin-right: auto;
  padding-left: 1.5rem;
  padding-right: 1.5rem;
}

@media (min-width: 768px) {
  .dashboard-frame {
    padding-left: 3rem;
    padding-right: 3rem;
  }
}

@media (min-width: 1440px) {
  .dashboard-frame {
    max-width: 88rem;
  }
}

.dashboard-content-grid {
  display: flex;
  flex-direction: column;
  gap: 32px;
}

@media (min-width: 1440px) {
  .dashboard-content-grid {
    display: grid;
    grid-template-columns: 1fr 320px;
    gap: 32px;
    align-items: start;
  }
}

.dashboard-main {
  min-width: 0;
}

.dashboard-rail {
  display: none;
}

@media (min-width: 1440px) {
  .dashboard-rail {
    display: block;
    position: sticky;
    top: 24px;
  }
}

.dashboard-activity-inline {
  display: block;
}

@media (min-width: 1440px) {
  .dashboard-activity-inline {
    display: none;
  }
}
```

- [ ] **Step 2: Remove inline `px-6 md:px-12` from OwnerToday**

In `apps/dashboard/src/components/dashboard/owner-today.tsx`, the `dashboard-frame` CSS class now handles padding. Remove the Tailwind overrides.

Change line 99:

```typescript
      <div className="dashboard-frame px-6 md:px-12">
```

to:

```typescript
      <div className="dashboard-frame">
```

Change line 295:

```typescript
    <div className="dashboard-frame px-6 md:px-12">
```

to:

```typescript
    <div className="dashboard-frame">
```

- [ ] **Step 3: Fix header → stat row spacing (L2a)**

In `apps/dashboard/src/components/dashboard/owner-today.tsx`, change the stat strip wrapper's marginTop from 32px to 48px.

Change:

```typescript
        <div style={{ marginTop: "32px" }}>
          <StatCardGrid stats={stats} />
```

to:

```typescript
        <div style={{ marginTop: "48px" }}>
          <StatCardGrid stats={stats} />
```

- [ ] **Step 4: Override OwnerShell content-width for dashboard route (L5)**

`OwnerShell` wraps all content in `.content-width` (max-width 42rem). The dashboard needs to break out of this. Instead of using CSS `:has()` (browser support concern), use a route-aware class on the shell.

In `apps/dashboard/src/components/layout/owner-shell.tsx`, replace:

```typescript
export function OwnerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-background">
      <main className="pb-20">
        <div key={pathname} className="content-width py-6 animate-fade-in">
          {children}
        </div>
      </main>
      <OwnerTabs />
    </div>
  );
}
```

with:

```typescript
export function OwnerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isDashboard = pathname === "/dashboard";

  return (
    <div className="min-h-screen bg-background">
      <main className="pb-20">
        <div
          key={pathname}
          className={`${isDashboard ? "py-6" : "content-width py-6"} animate-fade-in`}
        >
          {children}
        </div>
      </main>
      <OwnerTabs />
    </div>
  );
}
```

When on `/dashboard`, the `content-width` constraint is removed. The `dashboard-frame` class inside OwnerToday handles its own max-width and padding.

- [ ] **Step 5: Verify layout renders**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/app/globals.css apps/dashboard/src/components/dashboard/owner-today.tsx apps/dashboard/src/components/layout/owner-shell.tsx && git commit -m "$(cat <<'EOF'
feat(dashboard): define dashboard-frame layout with sticky activity rail

Adds dashboard-frame (76rem editorial / 88rem calm-grid at 1440px+),
dashboard-content-grid with 320px sticky rail, and responsive
show/hide for rail vs inline activity feed. OwnerShell bypasses
content-width constraint on /dashboard route. Fixes header→stat
spacing to 48px per approved spec.
EOF
)"
```

---

### Task 5: Declare missing prop interfaces — StatCard (C4a)

**Files:**

- Modify: `apps/dashboard/src/components/dashboard/stat-card.tsx`

This task only declares the props in the interface. Feature implementation (count-up animation, revenue tint) lands in PR 4.

- [ ] **Step 1: Update StatCard interface**

In `apps/dashboard/src/components/dashboard/stat-card.tsx`, replace the interface:

```typescript
interface StatCardProps {
  label: string;
  value: string | number;
  delta?: { direction: "up" | "down"; text: string };
  badge?: { text: string; variant: "overdue" };
}
```

with:

```typescript
interface StatCardProps {
  label: string;
  value: string | number;
  delta?: { direction: "up" | "down"; text: string };
  badge?: { text: string; variant: "overdue" };
  isRevenue?: boolean;
  animateCountUp?: boolean;
  countUpDelay?: number;
}
```

Update the destructuring to accept (and ignore for now) the new props:

```typescript
export function StatCard({ label, value, delta, badge, isRevenue: _isRevenue, animateCountUp: _animateCountUp, countUpDelay: _countUpDelay }: StatCardProps) {
```

- [ ] **Step 2: Verify build**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard build`
Expected: Build succeeds, no type errors on the `isRevenue`, `animateCountUp`, `countUpDelay` props passed from OwnerToday

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/dashboard/stat-card.tsx && git commit -m "$(cat <<'EOF'
chore(dashboard): declare StatCard animation and revenue props

Interface-only change. Feature implementation (count-up, revenue tint)
lands in PR 4.
EOF
)"
```

---

### Task 6: Declare missing prop interfaces — FunnelStrip (C4b)

**Files:**

- Modify: `apps/dashboard/src/components/dashboard/funnel-strip.tsx`

- [ ] **Step 1: Update FunnelStrip interface**

In `apps/dashboard/src/components/dashboard/funnel-strip.tsx`, change:

```typescript
interface FunnelStripProps {
  stages: FunnelStage[];
}
```

to:

```typescript
interface FunnelStripProps {
  stages: FunnelStage[];
  animate?: boolean;
}
```

Update the destructuring:

```typescript
export function FunnelStrip({ stages, animate: _animate }: FunnelStripProps) {
```

- [ ] **Step 2: Verify build**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/dashboard/funnel-strip.tsx && git commit -m "$(cat <<'EOF'
chore(dashboard): declare FunnelStrip animate prop

Interface-only. Entrance animation implementation lands in PR 5.
EOF
)"
```

---

### Task 7: Declare missing prop interfaces — RevenueSummary (C4c)

**Files:**

- Modify: `apps/dashboard/src/components/dashboard/revenue-summary.tsx`

- [ ] **Step 1: Update RevenueSummary interface**

In `apps/dashboard/src/components/dashboard/revenue-summary.tsx`, change:

```typescript
interface RevenueSummaryProps {
  total: number;
  count: number;
  topSource: { name: string; amount: number } | null;
}
```

to:

```typescript
interface RevenueSummaryProps {
  total: number;
  count: number;
  topSource: { name: string; amount: number } | null;
  dailyBreakdown?: number[];
  animate?: boolean;
}
```

Update the destructuring:

```typescript
export function RevenueSummary({ total, count, topSource, dailyBreakdown: _dailyBreakdown, animate: _animate }: RevenueSummaryProps) {
```

Also clean up the type assertion in OwnerToday that was needed because the prop didn't exist. In `apps/dashboard/src/components/dashboard/owner-today.tsx`, change:

```typescript
                dailyBreakdown={(overview.revenue as { dailyBreakdown?: number[] }).dailyBreakdown}
```

to:

```typescript
                dailyBreakdown={overview.revenue.dailyBreakdown}
```

This will only work if `DashboardOverview` in schemas already has `dailyBreakdown`. If it doesn't, keep the type assertion for now — the API contract change lands in PR 4.

- [ ] **Step 2: Verify build**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard build`
Expected: PASS (or the type assertion remains if schema doesn't include dailyBreakdown yet)

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/dashboard/revenue-summary.tsx apps/dashboard/src/components/dashboard/owner-today.tsx && git commit -m "$(cat <<'EOF'
chore(dashboard): declare RevenueSummary dailyBreakdown and animate props

Interface-only. Mini bar chart implementation lands in PR 4.
EOF
)"
```

---

### Task 8: Declare missing prop interfaces — ActivityFeed (C4d)

**Files:**

- Modify: `apps/dashboard/src/components/dashboard/activity-feed.tsx`

- [ ] **Step 1: Update ActivityFeed interface**

In `apps/dashboard/src/components/dashboard/activity-feed.tsx`, change:

```typescript
interface ActivityFeedProps {
  events: ActivityItem[];
}
```

to:

```typescript
interface ActivityFeedProps {
  events: ActivityItem[];
  animate?: boolean;
}
```

Update the destructuring:

```typescript
export function ActivityFeed({ events, animate: _animate }: ActivityFeedProps) {
```

- [ ] **Step 2: Verify build**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/dashboard/activity-feed.tsx && git commit -m "$(cat <<'EOF'
chore(dashboard): declare ActivityFeed animate prop

Interface-only. Entrance stagger implementation lands in PR 5.
EOF
)"
```

---

### Task 9: Declare missing prop interfaces — ActionCard (C4e)

**Files:**

- Modify: `apps/dashboard/src/components/dashboard/action-card.tsx`

- [ ] **Step 1: Update ActionCard interface**

In `apps/dashboard/src/components/dashboard/action-card.tsx`, change:

```typescript
interface ActionCardProps {
  summary: string;
  context: string | null;
  createdAt: string;
  actions: ActionCardAction[];
}
```

to:

```typescript
type RiskCategory = "high" | "medium" | "low";

interface ActionCardProps {
  summary: string;
  context: string | null;
  createdAt: string;
  actions: ActionCardAction[];
  riskCategory?: RiskCategory;
}
```

Update the destructuring:

```typescript
export function ActionCard({ summary, context, createdAt, actions, riskCategory: _riskCategory }: ActionCardProps) {
```

- [ ] **Step 2: Verify build**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/dashboard/action-card.tsx && git commit -m "$(cat <<'EOF'
chore(dashboard): declare ActionCard riskCategory prop

Interface-only. Left severity border implementation lands in PR 4.
EOF
)"
```

---

### Task 10: Run full test suite and typecheck

- [ ] **Step 1: Typecheck**

Run: `npx pnpm@9.15.4 typecheck`
Expected: PASS

- [ ] **Step 2: Run all dashboard tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard test -- --run`
Expected: All tests PASS

- [ ] **Step 3: Lint**

Run: `npx pnpm@9.15.4 lint`
Expected: PASS (unused `_`-prefixed variables are allowed by lint config)

- [ ] **Step 4: Build**

Run: `npx pnpm@9.15.4 build`
Expected: Full monorepo build PASS
