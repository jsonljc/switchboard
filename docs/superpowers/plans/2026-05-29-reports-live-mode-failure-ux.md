# Reports Live-Mode Failure UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/reports` render a calm loading skeleton, a "temporarily unavailable" + retry state, and a stale-cache banner instead of a blank page when live mode fails (issue #472).

**Architecture:** Presentation-layer only. `useReportData` already surfaces `data`/`isLoading`/`error` independently and never falls back to fixtures in live mode (proven by `use-report-data.test.tsx:96`). We (1) add an additive `retry` export to the hook, (2) add three small presentational components, (3) add their CSS to the existing module, and (4) make `reports-page.tsx` consume `error`/`isLoading`/`retry` and branch on hook state. Fixture mode is structurally unable to reach the new states (it always returns `data` + `error: null`), so "no fixture fallback in live mode" holds by construction.

**Tech Stack:** Next.js 14 (App Router, client components), React, `@tanstack/react-query` v5, CSS Modules, Vitest + `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-05-29-reports-live-mode-failure-ux-design.md`

---

## File Structure

- **Modify** `apps/dashboard/src/app/(auth)/(mercury)/reports/hooks/use-report-data.ts` — add `retry` (backed by React Query `refetch`).
- **Modify** `.../reports/hooks/__tests__/use-report-data.test.tsx` — cover `retry`.
- **Create** `.../reports/components/reports-unavailable.tsx` + `__tests__/reports-unavailable.test.tsx`
- **Create** `.../reports/components/reports-skeleton.tsx` + `__tests__/reports-skeleton.test.tsx`
- **Create** `.../reports/components/stale-data-banner.tsx` + `__tests__/stale-data-banner.test.tsx`
- **Modify** `.../reports/reports.module.css` — `.unavailable*`, `.skeleton*`, `.bannerStale`.
- **Modify** `.../reports/reports-page.tsx` — consume `error`/`isLoading`/`retry`, branch render.
- **Create** `.../reports/__tests__/reports-page-live.test.tsx` — live-mode render branches (hook mocked).

Path prefix for all files below: `apps/dashboard/src/app/(auth)/(mercury)/reports/`

---

### Task 1: Add `retry` to `useReportData`

**Files:**

- Modify: `hooks/use-report-data.ts`
- Test: `hooks/__tests__/use-report-data.test.tsx`

- [ ] **Step 1: Write the failing test** — append inside the `describe(...)` block in `hooks/__tests__/use-report-data.test.tsx`, before its closing `});`:

```tsx
it("retry() refetches in live mode (a second fetch is issued)", async () => {
  process.env.NEXT_PUBLIC_REPORTS_LIVE = "true";
  vi.resetModules();
  vi.doMock("@/hooks/use-query-keys", () => ({
    useScopedQueryKeys: () => ({
      reports: {
        all: () => ["test-org", "reports"] as const,
        byWindow: (w: string) => ["test-org", "reports", w] as const,
      },
    }),
  }));
  const { useReportData: liveUseReportData } = await import("../use-report-data");

  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify(goodFixture), { status: 200 }));

  const { result } = renderHook(() => liveUseReportData("THIS MONTH"), {
    wrapper: createWrapper(),
  });

  const { waitFor } = await import("@testing-library/react");
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

  await act(async () => {
    await result.current.retry();
  });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

  fetchMock.mockRestore();
  vi.doUnmock("@/hooks/use-query-keys");
});

it("retry() is a safe no-op in fixture mode", async () => {
  const { result } = renderHook(() => useReportData("THIS MONTH"), { wrapper: createWrapper() });
  await act(async () => {
    await result.current.retry();
  });
  expect(result.current.data).toEqual(goodFixture);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- use-report-data`
Expected: FAIL — `result.current.retry is not a function`.

- [ ] **Step 3: Implement `retry` in `hooks/use-report-data.ts`**

In the `UseReportData` interface, add the field after `refresh`:

```ts
refresh: () => Promise<void>;
retry: () => Promise<void>;
```

Replace the `useQuery` destructure to also pull `refetch`:

```ts
  const { data, isLoading, isFetching, error, refetch } = useQuery<ReportData>({
```

Add a `retry` callback next to `refresh` (after the `refresh` `useCallback`):

```ts
const retry = useCallback(async () => {
  if (!isLive || !keys) return;
  await refetch();
}, [keys, refetch]);
```

Add `retry` to the fixture-mode early return:

```ts
if (!isLive) {
  return {
    data: FIXTURES_BY_WINDOW[window],
    isLoading: false,
    isFetching: false,
    error: null,
    refresh: async () => {},
    retry: async () => {},
  };
}
```

Add `retry` to the live-mode return:

```ts
return {
  data,
  isLoading,
  isFetching,
  error: error as Error | null,
  refresh,
  retry,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- use-report-data`
Expected: PASS (all existing + 2 new tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/dashboard/src/app/(auth)/(mercury)/reports/hooks/use-report-data.ts" \
        "apps/dashboard/src/app/(auth)/(mercury)/reports/hooks/__tests__/use-report-data.test.tsx"
git commit -m "feat(reports): expose retry() refetch from useReportData (#472)"
```

---

### Task 2: `ReportsUnavailable` component

**Files:**

- Create: `components/reports-unavailable.tsx`
- Test: `components/__tests__/reports-unavailable.test.tsx`

- [ ] **Step 1: Write the failing test** — `components/__tests__/reports-unavailable.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportsUnavailable } from "../reports-unavailable";

describe("ReportsUnavailable", () => {
  it("renders an alert with a temporarily-unavailable message", () => {
    render(<ReportsUnavailable onRetry={() => {}} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/temporarily unavailable/i)).toBeInTheDocument();
  });

  it("does not reuse empty-state 'all clear' copy", () => {
    const { container } = render(<ReportsUnavailable onRetry={() => {}} />);
    expect(container.textContent).not.toMatch(/all clear|nothing to show|no reports yet/i);
  });

  it("fires onRetry when Try again is clicked", async () => {
    const onRetry = vi.fn();
    render(<ReportsUnavailable onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- reports-unavailable`
Expected: FAIL — cannot find module `../reports-unavailable`.

- [ ] **Step 3: Implement `components/reports-unavailable.tsx`**

```tsx
"use client";

import styles from "../reports.module.css";

export interface ReportsUnavailableProps {
  onRetry: () => void;
}

/**
 * Live-mode failure state for /reports (issue #472). Calm, not a stack trace,
 * not a blank page. Never reuses empty-state copy — an error is an error.
 */
export function ReportsUnavailable({ onRetry }: ReportsUnavailableProps) {
  return (
    <div className={styles.unavailable} role="alert">
      <span className={styles.eyebrow}>Temporarily unavailable</span>
      <p className={styles.unavailableMsg}>
        We couldn&apos;t load your report just now. This is usually momentary — your numbers are
        safe. Try again in a moment.
      </p>
      <button type="button" className={styles.btn} onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- reports-unavailable`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/dashboard/src/app/(auth)/(mercury)/reports/components/reports-unavailable.tsx" \
        "apps/dashboard/src/app/(auth)/(mercury)/reports/components/__tests__/reports-unavailable.test.tsx"
git commit -m "feat(reports): add ReportsUnavailable failure state (#472)"
```

---

### Task 3: `ReportsSkeleton` component

**Files:**

- Create: `components/reports-skeleton.tsx`
- Test: `components/__tests__/reports-skeleton.test.tsx`

- [ ] **Step 1: Write the failing test** — `components/__tests__/reports-skeleton.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReportsSkeleton } from "../reports-skeleton";

describe("ReportsSkeleton", () => {
  it("renders an aria-busy loading region", () => {
    render(<ReportsSkeleton />);
    const region = screen.getByLabelText(/loading report/i);
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute("aria-busy", "true");
  });

  it("renders no report numbers (purely structural placeholders)", () => {
    const { container } = render(<ReportsSkeleton />);
    expect(container.textContent).toBe("");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- reports-skeleton`
Expected: FAIL — cannot find module `../reports-skeleton`.

- [ ] **Step 3: Implement `components/reports-skeleton.tsx`**

```tsx
"use client";

import styles from "../reports.module.css";

/**
 * Loading placeholder for /reports while live data is in flight (issue #472).
 * Structural only — no data, no copy.
 */
export function ReportsSkeleton() {
  return (
    <div className={styles.skeleton} aria-busy="true" aria-label="Loading report">
      <div className={styles.skelHero} />
      <div className={styles.skelLine} />
      <div className={styles.skelLine} />
      <div className={styles.skelBlock} />
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- reports-skeleton`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/dashboard/src/app/(auth)/(mercury)/reports/components/reports-skeleton.tsx" \
        "apps/dashboard/src/app/(auth)/(mercury)/reports/components/__tests__/reports-skeleton.test.tsx"
git commit -m "feat(reports): add ReportsSkeleton loading state (#472)"
```

---

### Task 4: `StaleDataBanner` component

**Files:**

- Create: `components/stale-data-banner.tsx`
- Test: `components/__tests__/stale-data-banner.test.tsx`

Note on `cacheAge`: the page's `cacheAge` resets to `0` whenever fetching settles (success or error), so at error time it is typically `0`. The banner therefore treats `0`/`null` as "moments ago" and only shows a minute count when `cacheAge > 0`. This keeps the copy honest without depending on the (intentionally simple) page-side timer.

- [ ] **Step 1: Write the failing test** — `components/__tests__/stale-data-banner.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StaleDataBanner } from "../stale-data-banner";

describe("StaleDataBanner", () => {
  it("renders a status banner explaining the refresh failed", () => {
    render(<StaleDataBanner cacheAge={null} onRetry={() => {}} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/couldn't refresh/i)).toBeInTheDocument();
  });

  it("shows a minute count when cacheAge > 0", () => {
    render(<StaleDataBanner cacheAge={3} onRetry={() => {}} />);
    expect(screen.getByText(/3 min ago/i)).toBeInTheDocument();
  });

  it("says 'moments ago' when cacheAge is 0 or null", () => {
    render(<StaleDataBanner cacheAge={0} onRetry={() => {}} />);
    expect(screen.getByText(/moments ago/i)).toBeInTheDocument();
  });

  it("fires onRetry when the retry cta is clicked", async () => {
    const onRetry = vi.fn();
    render(<StaleDataBanner cacheAge={null} onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- stale-data-banner`
Expected: FAIL — cannot find module `../stale-data-banner`.

- [ ] **Step 3: Implement `components/stale-data-banner.tsx`**

```tsx
"use client";

import styles from "../reports.module.css";

export interface StaleDataBannerProps {
  cacheAge: number | null;
  onRetry: () => void;
}

/**
 * Shown when live /reports has cached data but the latest refresh failed
 * (issue #472). The report below remains visible; this banner is honest that
 * it may be stale and offers a retry.
 */
export function StaleDataBanner({ cacheAge, onRetry }: StaleDataBannerProps) {
  const ageLabel = cacheAge != null && cacheAge > 0 ? `${cacheAge} min ago` : "moments ago";
  return (
    <div className={styles.bannerStale} role="status">
      <span className={styles.eyebrow}>Couldn&apos;t refresh</span>
      <span className={styles.msg}>
        Showing the version we loaded {ageLabel}. We&apos;ll pick up the latest once the connection
        recovers.
      </span>
      <button type="button" className={styles.cta} onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- stale-data-banner`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/dashboard/src/app/(auth)/(mercury)/reports/components/stale-data-banner.tsx" \
        "apps/dashboard/src/app/(auth)/(mercury)/reports/components/__tests__/stale-data-banner.test.tsx"
git commit -m "feat(reports): add StaleDataBanner for failed-refresh-with-cache (#472)"
```

---

### Task 5: CSS for the three new states

**Files:**

- Modify: `reports.module.css`

No test of its own (styling). The `css-class-integrity` and `css-no-perf-red-green` tests in `reports/__tests__/` validate it — they run in Task 7. Uses only existing `--paper*`/`--ink*`/`--accent*`/`--hair*` tokens (no red/green literals).

- [ ] **Step 1: Append to `reports.module.css`** (after the existing `.fadeIn` block, at end of file):

```css
/* ============== Stale-data banner (#472) ============== */
.bannerStale {
  max-width: var(--max-w);
  margin: 18px auto 0;
  padding: 16px 22px;
  background: var(--paper-warm);
  border: 1px solid var(--hair-strong);
  border-left: 3px solid var(--accent);
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 18px;
  align-items: center;
}
@media (max-width: 720px) {
  .bannerStale {
    grid-template-columns: 1fr;
    gap: 12px;
  }
}

/* ============== Temporarily-unavailable state (#472) ============== */
.unavailable {
  max-width: var(--max-w);
  margin: 64px auto;
  padding: 48px var(--page-x);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 18px;
  border-top: 1px solid var(--ink);
  border-bottom: 1px solid var(--ink);
}
.unavailableMsg {
  font-family: var(--serif);
  font-style: italic;
  font-size: 20px;
  line-height: 1.4;
  color: var(--ink-2);
  max-width: 32em;
  text-wrap: pretty;
}

/* ============== Loading skeleton (#472) ============== */
.skeleton {
  max-width: var(--max-w);
  margin: 44px auto;
  padding: 0 var(--page-x);
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.skeleton > div {
  background: linear-gradient(
    90deg,
    var(--paper-deep) 25%,
    var(--paper-warm) 37%,
    var(--paper-deep) 63%
  );
  background-size: 400% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
  border-radius: 2px;
}
.skelHero {
  height: 120px;
}
.skelLine {
  height: 18px;
  width: 60%;
}
.skelBlock {
  height: 220px;
}
@keyframes shimmer {
  from {
    background-position: 100% 0;
  }
  to {
    background-position: 0 0;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add "apps/dashboard/src/app/(auth)/(mercury)/reports/reports.module.css"
git commit -m "style(reports): css for skeleton, unavailable, and stale states (#472)"
```

---

### Task 6: Wire `reports-page.tsx` to render all hook states

**Files:**

- Modify: `reports-page.tsx`
- Test (create): `__tests__/reports-page-live.test.tsx`

The new page test file mocks the hook directly so render branches are tested in isolation from the hook's module-load env coupling. It mocks `isMercuryToolLive` to `true` (live mode), and stubs `useConnections`.

- [ ] **Step 1: Write the failing test** — `__tests__/reports-page-live.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { UseReportData } from "../hooks/use-report-data";
import { goodFixture } from "../fixtures";

vi.mock("@/lib/route-availability", () => ({
  isMercuryToolLive: () => true,
  isAgentHomeLinkLive: () => false,
}));
vi.mock("@/hooks/use-connections", () => ({
  useConnections: () => ({
    data: { connections: [{ serviceId: "meta-ads", status: "connected" }] },
    isLoading: false,
  }),
}));

const hookState: { current: UseReportData } = {
  current: {
    data: undefined,
    isLoading: false,
    isFetching: false,
    error: null,
    refresh: async () => {},
    retry: vi.fn(async () => {}),
  },
};
vi.mock("../hooks/use-report-data", () => ({
  useReportData: () => hookState.current,
}));

import { ReportsPage } from "../reports-page";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ReportsPage />
    </QueryClientProvider>,
  );
}

describe("ReportsPage (live mode failure states, #472)", () => {
  beforeEach(() => {
    hookState.current = {
      data: undefined,
      isLoading: false,
      isFetching: false,
      error: null,
      refresh: async () => {},
      retry: vi.fn(async () => {}),
    };
  });

  it("renders the skeleton while loading with no data (not a blank body)", () => {
    hookState.current = { ...hookState.current, isLoading: true };
    renderPage();
    expect(screen.getByLabelText(/loading report/i)).toBeInTheDocument();
  });

  it("renders the unavailable state on error with no data (not blank, not a crash)", () => {
    hookState.current = { ...hookState.current, error: new Error("500") };
    renderPage();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/temporarily unavailable/i)).toBeInTheDocument();
  });

  it("never shows fixture content in the live error state", () => {
    hookState.current = { ...hookState.current, error: new Error("500") };
    const { container } = renderPage();
    expect(container.textContent).not.toMatch(/14,720/);
  });

  it("retry button click calls the hook retry", async () => {
    const retry = vi.fn(async () => {});
    hookState.current = { ...hookState.current, error: new Error("500"), retry };
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("renders the report AND a stale banner when data is present but refresh errored", () => {
    hookState.current = { ...hookState.current, data: goodFixture, error: new Error("500") };
    renderPage();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/couldn't refresh/i)).toBeInTheDocument();
    // report still rendered
    expect(screen.getAllByText(/14,720/).length).toBeGreaterThan(0);
  });

  it("renders the report cleanly when data is present and no error", () => {
    hookState.current = { ...hookState.current, data: goodFixture };
    renderPage();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getAllByText(/14,720/).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- reports-page-live`
Expected: FAIL — skeleton/alert/status not found (page still ignores `error`/`isLoading`).

- [ ] **Step 3: Implement the wiring in `reports-page.tsx`**

Add imports alongside the existing component imports:

```tsx
import { ReportsUnavailable } from "./components/reports-unavailable";
import { ReportsSkeleton } from "./components/reports-skeleton";
import { StaleDataBanner } from "./components/stale-data-banner";
```

Change the hook destructure (currently `const { data: fx, isFetching, refresh } = useReportData(activeWindow);`) to:

```tsx
const { data: fx, isLoading, isFetching, error, refresh, retry } = useReportData(activeWindow);
```

Replace the body block (currently the `{fx && ( ... )}` JSX, lines ~79-94) with explicit state branches:

```tsx
{
  showNoConnBanner && <NoConnectionBanner />;
}

{
  !fx && isLoading && <ReportsSkeleton />;
}

{
  !fx && !isLoading && error && <ReportsUnavailable onRetry={() => void retry()} />;
}

{
  fx && (
    <>
      {error && <StaleDataBanner cacheAge={cacheAge} onRetry={() => void retry()} />}
      <PullQuote q={fx.pullquote} />
      <Attribution data={fx.attribution} />
      <Funnel rows={fx.funnel} narrative={fx.funnelNarrative} />
      <Campaigns campaigns={fx.campaigns} />
      <CostVsValue cost={fx.cost} narrative={fx.costNarrative} />
      {fx.managedComparison && <ManagedComparison data={fx.managedComparison} />}
      <Colophon
        period={fx.period}
        org={ORG_PLACEHOLDER}
        generatedAt={new Date()}
        liveMode={liveMode}
      />
    </>
  );
}
```

- [ ] **Step 4: Run the new test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- reports-page-live`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the existing fixture-mode page test to verify no regression**

Run: `pnpm --filter @switchboard/dashboard test -- reports-page.test`
Expected: PASS (unchanged — fixture mode always has `data`, `error: null`, so it renders the report branch exactly as before).

- [ ] **Step 6: Commit**

```bash
git add "apps/dashboard/src/app/(auth)/(mercury)/reports/reports-page.tsx" \
        "apps/dashboard/src/app/(auth)/(mercury)/reports/__tests__/reports-page-live.test.tsx"
git commit -m "fix(reports): render loading/error/stale states instead of blank page (#472)"
```

---

### Task 7: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Typecheck the dashboard**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: no errors. (If it reports missing exports from `@switchboard/*`, run `pnpm reset` first — see CLAUDE.md.)

- [ ] **Step 2: Run the full reports test suite (incl. CSS-integrity guards)**

Run: `pnpm --filter @switchboard/dashboard test -- reports`
Expected: PASS, including `css-class-integrity.test.ts` and `css-no-perf-red-green.test.ts`. If `css-class-integrity` flags an unreferenced/missing class, reconcile the class names between `reports.module.css` and the new components.

- [ ] **Step 3: Lint + format check**

Run: `pnpm --filter @switchboard/dashboard lint && pnpm format:check`
Expected: clean. (CI runs prettier; local lint does not — `format:check` catches it.)

- [ ] **Step 4: Production build (not in CI — must run locally)**

Run: `pnpm --filter @switchboard/dashboard build`
Expected: build succeeds. (Catches `.js`-extension import mistakes and dead-file type errors that `tsc` alone misses.)

- [ ] **Step 5: Final commit if any fixups were needed**

```bash
git add -A
git commit -m "chore(reports): verification fixups for live-mode failure UX (#472)"
```

---

## Self-Review

**Spec coverage:**

- Calm "temporarily unavailable" placeholder → Task 2 + Task 6 (`error && !data`). ✓
- Retry affordance (manual button) → Task 1 (`retry`) + Tasks 2/4 buttons + Task 6 wiring. ✓
- Surface previous cached payload with stale banner → Task 4 + Task 6 (`fx && error`). ✓
- Live mode never silently falls back to fixtures → holds by construction (fixture mode → `data`+`error:null` → report branch only); asserted in Task 6 ("never shows fixture content in the live error state"). ✓
- Loading skeleton (full-scope decision) → Task 3 + Task 6 (`!fx && isLoading`). ✓
- Acceptance #1 (error renders unavailable, not blank/crash) → Task 6 test. ✓
- Acceptance #2 (retry refetches) → Task 1 hook test + Task 6 retry-click test. ✓
- Acceptance #3 (no fixture in live failure) → Task 6 test. ✓
- Acceptance #4 (tests cover all three) → Tasks 1, 6. ✓
- Convention cross-check → documented in spec; mirrors `inbox-error-state.tsx`; no `/activity` or `/approvals` rework. ✓

**Placeholder scan:** none — every code/CSS/test step shows complete content.

**Type consistency:** `retry: () => Promise<void>` defined in Task 1 (interface + both returns), consumed identically in Task 6 wiring and the Task 6 mock (`UseReportData` shape). `cacheAge: number | null` matches the page state type and the `StaleDataBanner` prop. Component prop names (`onRetry`, `cacheAge`) match between component files and page usage.
