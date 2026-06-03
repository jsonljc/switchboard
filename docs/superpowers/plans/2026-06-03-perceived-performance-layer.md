# Perceived-Performance Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `<QueryStates>` perceived-performance primitive + `(auth)/loading.tsx` route shells from the 2026-06-02 UI/UX feel audit (Wave-1 QS1+QS2), so every daily feed renders honest loading/error/empty/data through one keys-pending-safe gate and every daily route paints a layout-matched skeleton instantly.

**Architecture:** A pure `resolveQueryState()` core (the testable spine) implements the `!data && !error` keys-pending-safe rule; a `<QueryStates>` component wraps it with safe defaults; a small failure-state vocabulary (`ConnectionTrouble`/`AllClear`/`AgentPaused`) supplies the §5 matrix copy in Alex's voice. Conflict-free daily feeds (Mira desk, AgentPanel slots, Results, Inbox drawer) route through it; the Inbox *page* is left to the in-flight Wave-0 stack. Four `loading.tsx` shells (Home scoped via a `(home)` route group) cover the navigation moment.

**Tech Stack:** Next.js 14 App Router, React 18, React Query v5, TypeScript (ESM, no `.js` ext in dashboard), Vitest + React Testing Library, Tailwind + design tokens (`hsl(var(--…))`).

**Spec:** `docs/superpowers/specs/2026-06-03-perceived-performance-layer-design.md`

**Worktree:** `.claude/worktrees/query-states` (branch `feat/perceived-performance-layer`, off `main` @ f7dc170f). Run all commands from there. Test runner: `pnpm --filter @switchboard/dashboard test`. Typecheck: `pnpm --filter @switchboard/dashboard typecheck`.

**Governance invariants this plan introduces (named for review):**
- QS1: *Every feed we own renders loading/error/empty/data through one gate; the gate never reads `isLoading`.*
- QS2: *Every daily route has a layout-matched shell; no shell leaks to a non-daily route.*
- Token: *No new file introduces a literal color — only `hsl(var(--…))` / `var(--…)` / Tailwind token classes.*

---

## File Structure

**PR-QS1 — primitive + routing**
- Create `apps/dashboard/src/components/query-states/resolve-query-state.ts` — pure resolver + types.
- Create `apps/dashboard/src/components/query-states/resolve-query-state.test.ts`
- Create `apps/dashboard/src/components/query-states/states.tsx` — `ConnectionTrouble`, `AllClear`, `AgentPaused`.
- Create `apps/dashboard/src/components/query-states/states.test.tsx`
- Create `apps/dashboard/src/components/query-states/query-states.tsx` — the component.
- Create `apps/dashboard/src/components/query-states/query-states.test.tsx`
- Create `apps/dashboard/src/components/query-states/index.ts` — barrel.
- Create `apps/dashboard/src/components/cockpit/mira/mira-desk-skeleton.tsx` (+ `.test.tsx`) — shared Mira skeleton.
- Modify `apps/dashboard/src/components/cockpit/mira/mira-desk-page.tsx` — route through QueryStates.
- Modify `apps/dashboard/src/components/agent-panel/open-decisions.tsx` — route through QueryStates.
- Modify `apps/dashboard/src/components/agent-panel/key-result.tsx` — keys-pending-safe loading gate.
- Modify `apps/dashboard/src/components/results/results-page.tsx` — route the live feed through QueryStates.
- Modify `apps/dashboard/src/components/layout/inbox-drawer.tsx` — route through QueryStates.
- Modify `apps/dashboard/src/app/__tests__/token-governance.test.ts` — add no-hex assertion for the new dir.

**PR-QS2 — route shells**
- Move `apps/dashboard/src/app/(auth)/page.tsx` → `apps/dashboard/src/app/(auth)/(home)/page.tsx`.
- Modify `apps/dashboard/src/app/(auth)/__tests__/home-route.test.ts` — import path.
- Create `apps/dashboard/src/app/(auth)/(home)/loading.tsx`
- Create `apps/dashboard/src/app/(auth)/inbox/loading.tsx`
- Create `apps/dashboard/src/app/(auth)/results/loading.tsx`
- Create `apps/dashboard/src/app/(auth)/mira/loading.tsx`
- Create `apps/dashboard/src/app/(auth)/__tests__/loading-shells.test.tsx` — render smoke tests for all four shells.

---

## Task 1: `resolveQueryState()` pure resolver

**Files:**
- Create: `apps/dashboard/src/components/query-states/resolve-query-state.ts`
- Test: `apps/dashboard/src/components/query-states/resolve-query-state.test.ts`

- [ ] **Step 1: Write the failing test (the exhaustive truth table)**

```ts
import { describe, it, expect } from "vitest";
import { resolveQueryState } from "./resolve-query-state";

describe("resolveQueryState", () => {
  it("data present, non-empty → data (and narrows the value)", () => {
    expect(resolveQueryState({ data: [1, 2], error: null })).toEqual({
      status: "data",
      data: [1, 2],
    });
  });

  it("data present but isEmpty → empty", () => {
    expect(
      resolveQueryState({ data: [], error: null }, (d) => d.length === 0),
    ).toEqual({ status: "empty" });
  });

  it("no data, no error → loading (the keys-pending case: isLoading is false but we are pending)", () => {
    expect(resolveQueryState({ data: undefined, error: null })).toEqual({
      status: "loading",
    });
  });

  it("no data, error → error (carries the error)", () => {
    const error = new Error("boom");
    expect(resolveQueryState({ data: undefined, error })).toEqual({
      status: "error",
      error,
    });
  });

  it("data present AND error → data (stale-wins: a cached list survives a failed background poll)", () => {
    const error = new Error("poll failed");
    expect(resolveQueryState({ data: [1], error })).toEqual({
      status: "data",
      data: [1],
    });
  });

  it("treats null data the same as undefined (still loading when no error)", () => {
    expect(resolveQueryState({ data: null as unknown as number[], error: null })).toEqual({
      status: "loading",
    });
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @switchboard/dashboard test resolve-query-state`
Expected: FAIL ("Failed to resolve import './resolve-query-state'").

- [ ] **Step 3: Implement the resolver**

```ts
/**
 * The keys-pending-safe state machine behind <QueryStates>.
 *
 * Every dashboard read hook is `enabled: !!keys` (useScopedQueryKeys() is null
 * until the session resolves orgId). A query with enabled:false is pending+idle,
 * so React Query reports isLoading:false, data:undefined, error:null. Any gate
 * written `if (isLoading)` is therefore SKIPPED during keys-pending and flashes
 * a false-empty. We never read isLoading; we derive state from {data, error}.
 *
 * Precedence: data (incl. empty) ▸ error ▸ loading.
 * `data != null` wins over `error` so a cached list survives a failed poll.
 */
export type QueryState<T> =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "empty" }
  | { status: "data"; data: T };

export interface QueryLike<T> {
  data: T | undefined;
  error: unknown;
}

export function resolveQueryState<T>(
  query: QueryLike<T>,
  isEmpty?: (data: T) => boolean,
): QueryState<T> {
  if (query.data != null) {
    return isEmpty?.(query.data) ? { status: "empty" } : { status: "data", data: query.data };
  }
  if (query.error != null) return { status: "error", error: query.error };
  return { status: "loading" };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @switchboard/dashboard test resolve-query-state`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/query-states/resolve-query-state.ts apps/dashboard/src/components/query-states/resolve-query-state.test.ts
git commit -m "feat(dashboard): add keys-pending-safe resolveQueryState core"
```

---

## Task 2: Failure-state vocabulary (`states.tsx`)

**Files:**
- Create: `apps/dashboard/src/components/query-states/states.tsx`
- Test: `apps/dashboard/src/components/query-states/states.test.tsx`

The §5 failure matrix in Alex's voice. Token-only (Tailwind token classes). `agentName` defaults to "your team". `ConnectionTrouble` flips on `navigator.onLine`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ConnectionTrouble, AllClear, AgentPaused } from "./states";

afterEach(cleanup);

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true });
}

describe("ConnectionTrouble", () => {
  it("online: names the API-down state, reassures nothing is lost, offers retry", () => {
    setOnline(true);
    const onRetry = vi.fn();
    render(<ConnectionTrouble onRetry={onRetry} />);
    expect(screen.getByText(/can't reach your team/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing you've approved is lost/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("offline: holds decisions, no retry button (it auto-recovers)", () => {
    setOnline(false);
    render(<ConnectionTrouble onRetry={vi.fn()} />);
    expect(screen.getByText(/you're offline/i)).toBeInTheDocument();
    expect(screen.getByText(/hold your decisions/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
    setOnline(true);
  });

  it("names a specific agent when given", () => {
    setOnline(true);
    render(<ConnectionTrouble agentName="Riley" />);
    expect(screen.getByText(/can't reach Riley/i)).toBeInTheDocument();
  });
});

describe("AllClear", () => {
  it("renders the calm all-caught-up state with a default sub-line", () => {
    render(<AllClear />);
    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
    expect(screen.getByText(/on top of it/i)).toBeInTheDocument();
  });
  it("accepts an override sub-line", () => {
    render(<AllClear sub="Nothing waiting from Mira." />);
    expect(screen.getByText(/nothing waiting from mira/i)).toBeInTheDocument();
  });
});

describe("AgentPaused", () => {
  it("names the agent and explains nothing will go out", () => {
    render(<AgentPaused agentName="Mira" />);
    expect(screen.getByText(/Mira is paused/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing new will go out/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @switchboard/dashboard test states.test`
Expected: FAIL (cannot import `./states`).

- [ ] **Step 3: Implement `states.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";

export interface StateProps {
  /** The agent (or "your team") the surface speaks for. Defaults to "your team". */
  agentName?: string;
}

/** True when the browser reports an offline network. Re-renders on online/offline. */
function useIsOffline(): boolean {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const sync = () => setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  return offline;
}

function StatePanel({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div role="status" className="flex flex-col items-center justify-center gap-1 px-6 py-10 text-center">
      <p className="text-foreground text-[0.95rem] font-medium">{title}</p>
      <p className="text-muted-foreground text-sm">{body}</p>
      {children}
    </div>
  );
}

/** §5: network offline + API/agent backend down — one offline-aware component. */
export function ConnectionTrouble({ agentName = "your team", onRetry }: StateProps & { onRetry?: () => void }) {
  const offline = useIsOffline();
  if (offline) {
    return (
      <StatePanel
        title="You're offline."
        body="I'll hold your decisions here until you're back."
      />
    );
  }
  return (
    <StatePanel
      title={`I can't reach ${agentName} right now.`}
      body="Nothing you've approved is lost — I'll keep trying."
    >
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 text-[hsl(var(--action))] text-sm font-medium underline underline-offset-2"
        >
          Try again
        </button>
      ) : null}
    </StatePanel>
  );
}

/** §5: designed empty / all-clear — completion as reward, never a dead-account blank. */
export function AllClear({ sub }: { sub?: string }) {
  return <StatePanel title="You're all caught up." body={sub ?? "Your team is on top of it."} />;
}

/** §5: agent halted / paused — not an empty feed that looks broken. */
export function AgentPaused({ agentName = "Your team" }: StateProps) {
  return (
    <StatePanel
      title={`${agentName} is paused.`}
      body="Resume when you're ready — nothing new will go out until you do."
    />
  );
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @switchboard/dashboard test states.test`
Expected: PASS (6 tests). If `toBeInTheDocument` is unavailable, the suite already configures `@testing-library/jest-dom` globally (other component tests use it) — confirm by grepping `setup` in `vitest.config`.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/query-states/states.tsx apps/dashboard/src/components/query-states/states.test.tsx
git commit -m "feat(dashboard): add honest failure-state vocabulary for QueryStates"
```

---

## Task 3: `<QueryStates>` component

**Files:**
- Create: `apps/dashboard/src/components/query-states/query-states.tsx`
- Test: `apps/dashboard/src/components/query-states/query-states.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryStates } from "./query-states";

afterEach(cleanup);

const renderData = (data: string[]) => <ul>{data.map((d) => <li key={d}>{d}</li>)}</ul>;

describe("QueryStates", () => {
  it("renders data via the render-prop when data is present and non-empty", () => {
    render(
      <QueryStates query={{ data: ["a"], error: null }}>{renderData}</QueryStates>,
    );
    expect(screen.getByText("a")).toBeInTheDocument();
  });

  it("keys-pending ({data:undefined,error:null}) renders LOADING, never the empty slot", () => {
    render(
      <QueryStates
        query={{ data: undefined, error: null }}
        loading={<div>shimmer</div>}
        empty={<div>all caught up</div>}
      >
        {renderData}
      </QueryStates>,
    );
    expect(screen.getByText("shimmer")).toBeInTheDocument();
    expect(screen.queryByText("all caught up")).toBeNull();
  });

  it("empty data renders the empty slot", () => {
    render(
      <QueryStates
        query={{ data: [], error: null }}
        isEmpty={(d) => d.length === 0}
        empty={<div>all caught up</div>}
      >
        {renderData}
      </QueryStates>,
    );
    expect(screen.getByText("all caught up")).toBeInTheDocument();
  });

  it("error renders the default ConnectionTrouble when no error slot is given (never a blank)", () => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    render(
      <QueryStates query={{ data: undefined, error: new Error("x") }}>{renderData}</QueryStates>,
    );
    expect(screen.getByText(/can't reach your team/i)).toBeInTheDocument();
  });

  it("wires onRetry into the default error state", () => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    const onRetry = vi.fn();
    render(
      <QueryStates query={{ data: undefined, error: new Error("x") }} onRetry={onRetry}>
        {renderData}
      </QueryStates>,
    );
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("supports a function error slot receiving the error", () => {
    render(
      <QueryStates
        query={{ data: undefined, error: new Error("nope") }}
        error={(e) => <div>err:{(e as Error).message}</div>}
      >
        {renderData}
      </QueryStates>,
    );
    expect(screen.getByText("err:nope")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @switchboard/dashboard test query-states.test`
Expected: FAIL (cannot import `./query-states`).

- [ ] **Step 3: Implement `query-states.tsx`**

```tsx
"use client";

import type { ReactNode } from "react";
import { resolveQueryState, type QueryLike } from "./resolve-query-state";
import { ConnectionTrouble, AllClear } from "./states";

export interface QueryStatesProps<T> {
  /** Read-only view of a React Query result. We read ONLY data + error (never isLoading). */
  query: QueryLike<T>;
  /** Treat present-but-empty data as the empty state (e.g. (d) => d.items.length === 0). */
  isEmpty?: (data: T) => boolean;
  /** Loading slot. Defaults to a minimal token-driven shimmer; pass a layout-matched skeleton. */
  loading?: ReactNode;
  /** Error slot (node or fn-of-error). Defaults to <ConnectionTrouble/> so it is never a blank. */
  error?: ReactNode | ((error: unknown) => ReactNode);
  /** Empty slot. Defaults to <AllClear/>. */
  empty?: ReactNode;
  /** Wired into the DEFAULT error state's "Try again". Ignored if a custom error slot is given. */
  onRetry?: () => void;
  /** Render-prop; receives non-empty, narrowed data. */
  children: (data: T) => ReactNode;
}

function DefaultLoading() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-3 px-6 py-8">
      <div className="h-5 w-2/5 animate-pulse rounded-md bg-muted" />
      <div className="h-16 w-full animate-pulse rounded-md bg-muted" />
      <div className="h-16 w-full animate-pulse rounded-md bg-muted" />
    </div>
  );
}

export function QueryStates<T>({
  query,
  isEmpty,
  loading,
  error,
  empty,
  onRetry,
  children,
}: QueryStatesProps<T>) {
  const state = resolveQueryState(query, isEmpty);
  switch (state.status) {
    case "loading":
      return <>{loading ?? <DefaultLoading />}</>;
    case "error":
      if (typeof error === "function") return <>{error(state.error)}</>;
      return <>{error ?? <ConnectionTrouble onRetry={onRetry} />}</>;
    case "empty":
      return <>{empty ?? <AllClear />}</>;
    case "data":
      return <>{children(state.data)}</>;
  }
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @switchboard/dashboard test query-states.test`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/query-states/query-states.tsx apps/dashboard/src/components/query-states/query-states.test.tsx
git commit -m "feat(dashboard): add QueryStates component with safe defaults"
```

---

## Task 4: Barrel + drift-guard assertion

**Files:**
- Create: `apps/dashboard/src/components/query-states/index.ts`
- Modify: `apps/dashboard/src/app/__tests__/token-governance.test.ts` (add one assertion)

- [ ] **Step 1: Write the barrel**

```ts
export { QueryStates, type QueryStatesProps } from "./query-states";
export { resolveQueryState, type QueryState, type QueryLike } from "./resolve-query-state";
export { ConnectionTrouble, AllClear, AgentPaused } from "./states";
```

- [ ] **Step 2: Add the drift-guard assertion (write the failing test first)**

Append this `describe` block to `apps/dashboard/src/app/__tests__/token-governance.test.ts` (it already imports `readFileSync`, `readdirSync`, `path`):

```ts
describe("token governance — query-states layer carries no literal color", () => {
  it("query-states/* sources contain no hex literal", () => {
    const dir = path.resolve(process.cwd(), "src/components/query-states");
    const HEX = /#[0-9a-fA-F]{3,8}\b/;
    for (const name of readdirSync(dir)) {
      if (!/\.(ts|tsx)$/.test(name) || /\.test\./.test(name)) continue;
      const content = readFileSync(`${dir}/${name}`, "utf8");
      expect(HEX.test(content), `hex literal in query-states/${name}`).toBe(false);
    }
  });
});
```

- [ ] **Step 3: Run it, verify it passes** (our files already use `hsl(var(--action))`, never hex)

Run: `pnpm --filter @switchboard/dashboard test token-governance`
Expected: PASS (existing assertions + the new one).

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/query-states/index.ts apps/dashboard/src/app/__tests__/token-governance.test.ts
git commit -m "feat(dashboard): barrel + drift-guard for query-states layer"
```

---

## Task 5: Route Mira desk through QueryStates + shared skeleton

**Files:**
- Create: `apps/dashboard/src/components/cockpit/mira/mira-desk-skeleton.tsx`
- Create: `apps/dashboard/src/components/cockpit/mira/mira-desk-skeleton.test.tsx`
- Modify: `apps/dashboard/src/components/cockpit/mira/mira-desk-page.tsx`

Current Mira gate (verified): `const pending = !desk && !deskQ.error;` then a `pending ? <p>Loading…</p> : deskQ.error ? <p>error</p> : <>…modules…</>` triad (`mira-desk-page.tsx:34,68-81`). We keep the keys-pending-safe predicate (it is already correct) but express it through `<QueryStates>` and upgrade the bare "Loading…" text to a real skeleton. Mira is a cockpit-family surface → consume `T.*` tokens (now `hsl(var())`-backed).

- [ ] **Step 1: Write the skeleton test**

```tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MiraDeskSkeleton } from "./mira-desk-skeleton";

afterEach(cleanup);

describe("MiraDeskSkeleton", () => {
  it("renders a labelled loading status with placeholder blocks", () => {
    const { container } = render(<MiraDeskSkeleton />);
    expect(screen.getByRole("status", { name: /loading mira/i })).toBeInTheDocument();
    // At least 3 placeholder blocks (hero + tray rows).
    expect(container.querySelectorAll("[data-skeleton-block]").length).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @switchboard/dashboard test mira-desk-skeleton`
Expected: FAIL (cannot import).

- [ ] **Step 3: Implement the skeleton** (cockpit `T` tokens; opacity-pulse via inline style is fine, matches the cockpit idiom)

```tsx
import { T } from "@/components/cockpit/tokens";

const block: React.CSSProperties = {
  background: T.paperDeep ?? "var(--canvas-3)",
  borderRadius: 10,
  animation: "skeleton-pulse 1.4s ease-in-out infinite",
};

/** Layout-matched skeleton for Mira's desk (hero CTA + in-production tray rows). */
export function MiraDeskSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading Mira's desk"
      style={{ display: "flex", flexDirection: "column", gap: 16, padding: 16 }}
    >
      <div data-skeleton-block style={{ ...block, height: 96 }} />
      <div data-skeleton-block style={{ ...block, height: 64 }} />
      <div data-skeleton-block style={{ ...block, height: 64 }} />
    </div>
  );
}
```

NOTE during implementation: confirm `T.paperDeep` exists in `components/cockpit/tokens.ts`; if not, use `"var(--canvas-3)"` directly (a token, not a literal — passes the drift guard). The `skeleton-pulse` keyframe is global (agent-panel CSS defines it); confirm it is in a globally-loaded stylesheet, else fall back to Tailwind `animate-pulse` on a `className` wrapper.

- [ ] **Step 4: Run it, verify it passes**

Run: `pnpm --filter @switchboard/dashboard test mira-desk-skeleton`
Expected: PASS.

- [ ] **Step 5: Route the desk through QueryStates**

In `mira-desk-page.tsx`: import `QueryStates` and `AgentPaused` from `@/components/query-states`, `MiraDeskSkeleton` from `./mira-desk-skeleton`, and `AllClear`. Replace the body block (currently lines ~67-82, the `pending ? … : deskQ.error ? … : <>…</>`) with:

```tsx
<div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
  <QueryStates
    query={deskQ}
    loading={<MiraDeskSkeleton />}
    onRetry={deskQ.refetch}
    error={<ConnectionTrouble agentName="Mira" onRetry={deskQ.refetch} />}
    empty={haltCtx.halted ? <AgentPaused agentName="Mira" /> : <AllClear sub="Mira has nothing waiting for you." />}
    isEmpty={(d) =>
      d.readyToReviewCount === 0 && d.inProduction.length === 0 && d.keptDrafts.length === 0
    }
  >
    {(desk) => (
      <>
        <MiraBriefBox />
        <MiraReadyToReview count={desk.readyToReviewCount} />
        <MiraInProductionTray items={desk.inProduction} />
        <MiraKeptShelf items={desk.keptDrafts} />
      </>
    )}
  </QueryStates>
</div>
```

Remove the now-unused `const desk = deskQ.data;` / `const pending = …` lines and the `desk!` non-null assertions. Import `ConnectionTrouble` too.

- [ ] **Step 6: Update/extend the Mira desk test**

Confirm the existing `mira-desk-page` test (if any) still passes; add a case that a keys-pending query (`{data:undefined,error:null}`) renders the skeleton (role=status), not the modules and not an error. Run: `pnpm --filter @switchboard/dashboard test mira-desk`
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

```bash
pnpm --filter @switchboard/dashboard typecheck
git add apps/dashboard/src/components/cockpit/mira/
git commit -m "feat(dashboard): route Mira desk through QueryStates with a real skeleton"
```

---

## Task 6: Route AgentPanel open-decisions through QueryStates

**Files:**
- Modify: `apps/dashboard/src/components/agent-panel/open-decisions.tsx`
- Test: `apps/dashboard/src/components/agent-panel/open-decisions.test.tsx` (extend if present; else create)

Current (verified): `if (feed.isLoading) {skeleton}`; `if (feed.isError || !feed.data) {error}`; `if (decisions.length === 0) {empty}`; else list (`open-decisions.tsx:32-61`). Replace the isLoading-gated triad with `<QueryStates>` keeping the existing skeleton + tailored copy.

- [ ] **Step 1: Write the failing test (keys-pending → skeleton, not empty)**

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { OpenDecisions } from "./open-decisions";

vi.mock("@/hooks/use-decision-feed", () => ({ useDecisionFeed: vi.fn() }));
import { useDecisionFeed } from "@/hooks/use-decision-feed";
afterEach(cleanup);

it("keys-pending (data undefined, no error) shows the skeleton, never 'Nothing waiting'", () => {
  (useDecisionFeed as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    data: undefined,
    error: null,
    isLoading: false, // the keys-pending trap: disabled query, isLoading is false
    isError: false,
  });
  const { container } = render(<OpenDecisions agentKey="alex" onOpenDecision={vi.fn()} />);
  expect(screen.queryByText(/nothing waiting/i)).toBeNull();
  expect(container.querySelector('[data-kind="loading"]')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it, verify it fails** (today's `isLoading:false` falls through to the empty/“Nothing waiting” path)

Run: `pnpm --filter @switchboard/dashboard test open-decisions`
Expected: FAIL (it currently renders "Nothing waiting…").

- [ ] **Step 3: Refactor `open-decisions.tsx` to QueryStates**

Replace the three `if (...)` gates (loading/error/empty) and the data render with:

```tsx
import { QueryStates } from "@/components/query-states";
// …
export function OpenDecisions({ agentKey, onOpenDecision }: OpenDecisionsProps) {
  const feed = useDecisionFeed(agentKey);
  const display = agentDisplay[agentKey];

  return (
    <QueryStates
      query={feed}
      isEmpty={(d) => d.decisions.length === 0}
      loading={
        <div className={styles.decisionSection} data-kind="loading" aria-busy="true">
          <div className={styles.decisionSkeleton} />
        </div>
      }
      error={
        <div className={styles.decisionSection}>
          <p className={`${styles.decisionEmptyLine} ${styles.decisionEmptyErr}`}>
            {"Couldn't load decisions"}
          </p>
        </div>
      }
      empty={
        <div className={styles.decisionSection}>
          <p className={styles.decisionEmptyLine}>{`Nothing waiting on you from ${display.name}`}</p>
        </div>
      }
    >
      {({ decisions, counts }) => (
        <div className={styles.decisionSection}>
          {/* …existing header + <ul> list markup, unchanged… */}
        </div>
      )}
    </QueryStates>
  );
}
```

Keep the exact existing list/header JSX inside the render-prop (copy it verbatim from the current data branch). Preserve the tailored error and empty copy.

- [ ] **Step 4: Run the test, verify it passes; run the whole open-decisions + agent-panel suite**

Run: `pnpm --filter @switchboard/dashboard test open-decisions agent-panel`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter @switchboard/dashboard typecheck
git add apps/dashboard/src/components/agent-panel/open-decisions.tsx apps/dashboard/src/components/agent-panel/open-decisions.test.tsx
git commit -m "feat(dashboard): route AgentPanel open-decisions through QueryStates"
```

---

## Task 7: Keys-pending-safe loading gate in key-result

**Files:**
- Modify: `apps/dashboard/src/components/agent-panel/key-result.tsx`
- Test: extend `key-result` test (create if absent)

`key-result` has domain sub-states (paused/activation/proof/error) that are NOT a plain query gate, so we do NOT wrap it in `<QueryStates>`. We only make its **loading gate** keys-pending-safe: today `if (all.isLoading || week.isLoading || mission.isLoading)`. The risk: a keys-pending hook is `isLoading:false`, so the gate is skipped and `selectKeyResult` may flash an error/empty. Fix: also treat "no data and no error yet" as loading.

- [ ] **Step 1: Write the failing test**

```tsx
// keys-pending on the lifetime metrics query → render the loading skeleton, not error
it("keys-pending metrics (data undefined, isLoading false, no error) renders loading", () => {
  mockMetrics("all", { data: undefined, isLoading: false, isError: false, error: null });
  mockMetrics("week", { data: undefined, isLoading: false, isError: false, error: null });
  mockMission({ data: undefined, isLoading: false, isError: false });
  const { container } = render(<KeyResult agentKey="alex" />);
  expect(container.querySelector('[data-kind="loading"]')).toBeInTheDocument();
});
```

(Use the file's existing hook-mock helpers; if none, mock `@/hooks/use-agent-metrics` and `@/hooks/use-agent-mission` like Task 6.)

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @switchboard/dashboard test key-result`
Expected: FAIL.

- [ ] **Step 3: Implement the keys-pending-safe gate**

Replace the loading guard (`key-result.tsx:44`) with a predicate that also catches keys-pending:

```tsx
import { resolveQueryState } from "@/components/query-states";
// …
const stillPending =
  resolveQueryState({ data: all.data, error: all.isError ? all.error : null }).status === "loading" ||
  resolveQueryState({ data: week.data, error: week.isError ? week.error : null }).status === "loading" ||
  resolveQueryState({ data: mission.data, error: mission.isError ? mission.error : null }).status === "loading";

if (stillPending) {
  return (
    <div className={styles.heroCard} data-kind="loading" aria-busy="true">
      <div className={styles.heroSkeleton} />
    </div>
  );
}
```

This renders loading while any of the three is pending OR keys-pending (no data, no error), and only proceeds to `selectKeyResult` once each has either resolved data or a real error.

- [ ] **Step 4: Run it, verify it passes (+ the existing key-result cases still pass)**

Run: `pnpm --filter @switchboard/dashboard test key-result`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter @switchboard/dashboard typecheck
git add apps/dashboard/src/components/agent-panel/key-result.tsx apps/dashboard/src/components/agent-panel/key-result.test.tsx
git commit -m "fix(dashboard): make key-result loading gate keys-pending-safe"
```

---

## Task 8: Route the Results live feed through QueryStates

**Files:**
- Modify: `apps/dashboard/src/components/results/results-page.tsx`
- Test: extend `results-page` test

Current (verified): inside `renderBody()`, `if (isLoading) return <ResultsSkeleton/>;` (`results-page.tsx:77`) then `if (!data) return error ? null : <FirstRunNote/>;`. The `isLoading` gate has a keys-pending hole in live mode. Route the `{data, error}` through QueryStates, reusing `ResultsSkeleton`.

- [ ] **Step 1: Write the failing test**

```tsx
it("keys-pending live feed (data undefined, isLoading false, no error) renders the skeleton, not first-run", () => {
  mockReportData({ data: undefined, isLoading: false, error: null, isFetching: false });
  const { container } = render(<ResultsPage />);
  expect(container.querySelector('[aria-label="Loading results"]')).toBeInTheDocument();
  expect(screen.queryByText(/first/i)).toBeNull();
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @switchboard/dashboard test results-page`
Expected: FAIL (today `isLoading:false` + `!data` → FirstRunNote).

- [ ] **Step 3: Refactor `renderBody()`**

Replace the `if (isLoading)` / `if (!data)` ladder with a QueryStates gate that preserves the first-run-vs-error and Meta-banner behavior. Keep the `error` banner rendered above the body as-is; inside the body:

```tsx
import { QueryStates } from "@/components/query-states";
import { ResultsSkeleton } from "./states";
// inside renderBody():
return (
  <QueryStates
    query={{ data, error }}
    loading={<ResultsSkeleton />}
    onRetry={retry}
    empty={<FirstRunNote />}
    isEmpty={(d) => d.attribution.total === 0 && d.bookings === 0}
    error={null /* the ErrorBanner above already speaks; body stays quiet */}
  >
    {(d) => /* …existing model-build + section render using d… */}
  </QueryStates>
);
```

Adapt the `isEmpty` predicate to the real `ReportData` shape (the audit notes `firstRun = attribution.total===0 && bookings===0`). Confirm field names against `results-model.ts` during implementation. The render-prop body is the current "has data" render path.

- [ ] **Step 4: Run it, verify it passes (+ existing results suite)**

Run: `pnpm --filter @switchboard/dashboard test results`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter @switchboard/dashboard typecheck
git add apps/dashboard/src/components/results/results-page.tsx apps/dashboard/src/components/results/
git commit -m "feat(dashboard): route Results live feed through QueryStates"
```

---

## Task 9: Route the Inbox drawer through QueryStates

**Files:**
- Modify: `apps/dashboard/src/components/layout/inbox-drawer.tsx`
- Test: extend `inbox-drawer` test (create if absent)

Current (verified): `inbox-drawer.tsx:126` `{isLoading && !data ? (…Reading…) : isError ? … : total === 0 ? … : …list…}`. This is bespoke and NOT touched by any Wave-0 PR (verified). Migrate to `<QueryStates>` for consistency. Preserve its existing copy and `Reading…` affordance.

- [ ] **Step 1: Write the failing test (keys-pending → loading, not empty)**

```tsx
it("keys-pending drawer feed renders the loading affordance, not the empty state", () => {
  mockDecisionFeed({ data: undefined, error: null, isLoading: false, isError: false });
  render(<InboxDrawer open onClose={() => {}} />);
  expect(screen.queryByText(/that's everything|all caught up|on top of it/i)).toBeNull();
  // the drawer's existing loading text/affordance is present
  expect(screen.getByText(/reading|loading/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @switchboard/dashboard test inbox-drawer`
Expected: FAIL.

- [ ] **Step 3: Refactor the drawer body to QueryStates**

Wrap the feed body in `<QueryStates query={feed} loading={<existing Reading… node>} error={<existing error node>} empty={<existing total===0 node>} isEmpty={(d)=>computeTotal(d)===0}>{(d)=> existing list }</QueryStates>`. Lift the current inline copy verbatim into the slots. (Read the file first; the exact node markup for each branch must be preserved.)

- [ ] **Step 4: Run it, verify it passes (+ existing drawer suite)**

Run: `pnpm --filter @switchboard/dashboard test inbox-drawer`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter @switchboard/dashboard typecheck
git add apps/dashboard/src/components/layout/inbox-drawer.tsx apps/dashboard/src/components/layout/
git commit -m "feat(dashboard): route Inbox drawer through QueryStates"
```

---

## Task 10: Move Home into a `(home)` route group

**Files:**
- Move: `apps/dashboard/src/app/(auth)/page.tsx` → `apps/dashboard/src/app/(auth)/(home)/page.tsx`
- Modify: `apps/dashboard/src/app/(auth)/__tests__/home-route.test.ts` (import path)

This scopes a Home-shaped `loading.tsx` to Home only (a pathless group keeps the URL `/`).

- [ ] **Step 1: Move the file with git**

```bash
mkdir -p "apps/dashboard/src/app/(auth)/(home)"
git mv "apps/dashboard/src/app/(auth)/page.tsx" "apps/dashboard/src/app/(auth)/(home)/page.tsx"
```

- [ ] **Step 2: Fix the test import**

In `apps/dashboard/src/app/(auth)/__tests__/home-route.test.ts` change `import HomePage from "../page";` → `import HomePage from "../(home)/page";`. (Confirm the exact current import line first.)

- [ ] **Step 3: Verify routing intact**

Run: `pnpm --filter @switchboard/dashboard test home-route agent-routes`
Expected: PASS. Then `pnpm --filter @switchboard/dashboard typecheck` → clean.

- [ ] **Step 4: Commit**

```bash
git add -A "apps/dashboard/src/app/(auth)/"
git commit -m "refactor(dashboard): scope Home under a (home) route group for its loading shell"
```

(Live URL verification happens in the screenshot pass — Home must still serve at `/`.)

---

## Task 11: Home route shell

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(home)/loading.tsx`

Layout-matched to the Home verdict-hero + bento. Fills `.app-content` (masthead/sidebar already painted). Tailwind token classes only.

- [ ] **Step 1: Implement** (no separate test file; covered by Task 15's shared smoke test)

```tsx
import { Skeleton } from "@/components/ui/skeleton";

/** Route shell for Home — verdict hero + bento module placeholders. */
export default function HomeLoading() {
  return (
    <div role="status" aria-label="Loading your briefing" className="flex flex-col gap-6 py-2">
      {/* Verdict hero */}
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-12 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      {/* Bento grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="h-40 lg:col-span-2" />
        <Skeleton className="h-40" />
        <Skeleton className="h-28 lg:col-span-2" />
        <Skeleton className="h-28" />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "apps/dashboard/src/app/(auth)/(home)/loading.tsx"
git commit -m "feat(dashboard): add Home route-shell skeleton"
```

---

## Task 12: Inbox route shell

**Files:**
- Create: `apps/dashboard/src/app/(auth)/inbox/loading.tsx`

Masthead + filter-chip row + 3–4 ghost decision rows.

- [ ] **Step 1: Implement**

```tsx
import { Skeleton } from "@/components/ui/skeleton";

/** Route shell for the Inbox — masthead, filter chips, ghost decision rows. */
export default function InboxLoading() {
  return (
    <div role="status" aria-label="Loading your inbox" className="flex flex-col gap-5 py-2">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-8 w-20 rounded-full" />
        ))}
      </div>
      <div className="flex flex-col gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @switchboard/dashboard typecheck
git add "apps/dashboard/src/app/(auth)/inbox/loading.tsx"
git commit -m "feat(dashboard): add Inbox route-shell skeleton"
```

---

## Task 13: Results route shell

**Files:**
- Create: `apps/dashboard/src/app/(auth)/results/loading.tsx`

Reuse the existing `ResultsSkeleton` (single source for the Results loading shape).

- [ ] **Step 1: Implement**

```tsx
import { ResultsSkeleton } from "@/components/results/states";

/** Route shell for Results — reuses the in-component ResultsSkeleton. */
export default function ResultsLoading() {
  return <ResultsSkeleton />;
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @switchboard/dashboard typecheck
git add "apps/dashboard/src/app/(auth)/results/loading.tsx"
git commit -m "feat(dashboard): add Results route-shell skeleton"
```

---

## Task 14: Mira route shell

**Files:**
- Create: `apps/dashboard/src/app/(auth)/mira/loading.tsx`

Reuse the shared `MiraDeskSkeleton` from Task 5.

- [ ] **Step 1: Implement**

```tsx
import { MiraDeskSkeleton } from "@/components/cockpit/mira/mira-desk-skeleton";

/** Route shell for Mira's desk — reuses the in-component MiraDeskSkeleton. */
export default function MiraLoading() {
  return <MiraDeskSkeleton />;
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @switchboard/dashboard typecheck
git add "apps/dashboard/src/app/(auth)/mira/loading.tsx"
git commit -m "feat(dashboard): add Mira route-shell skeleton"
```

---

## Task 15: Route-shell smoke tests

**Files:**
- Create: `apps/dashboard/src/app/(auth)/__tests__/loading-shells.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import HomeLoading from "../(home)/loading";
import InboxLoading from "../inbox/loading";
import ResultsLoading from "../results/loading";
import MiraLoading from "../mira/loading";

afterEach(cleanup);

describe("route-shell skeletons", () => {
  it.each([
    ["home", HomeLoading, /loading your briefing/i],
    ["inbox", InboxLoading, /loading your inbox/i],
    ["mira", MiraLoading, /loading mira/i],
  ])("%s shell renders a labelled loading status", (_name, Comp, label) => {
    render(<Comp />);
    expect(screen.getByRole("status", { name: label })).toBeInTheDocument();
  });

  it("results shell renders the ResultsSkeleton", () => {
    render(<ResultsLoading />);
    expect(screen.getByRole("status", { name: /loading results/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it, verify it passes**

Run: `pnpm --filter @switchboard/dashboard test loading-shells`
Expected: PASS (4 cases).

- [ ] **Step 3: Commit**

```bash
git add "apps/dashboard/src/app/(auth)/__tests__/loading-shells.test.tsx"
git commit -m "test(dashboard): smoke-test the four route-shell skeletons"
```

---

## Task 16: Full verification gate

- [ ] **Step 1: Full dashboard suite + typecheck + format**

```bash
pnpm --filter @switchboard/dashboard test
pnpm --filter @switchboard/dashboard typecheck
pnpm format:check
```
Expected: all green. (Run `pnpm format:write` then re-`git add` if format:check flags anything — CI runs prettier; local lint does not.)

- [ ] **Step 2: Drift guard explicitly green**

```bash
pnpm --filter @switchboard/dashboard test token-governance
```
Expected: PASS (existing + the new query-states no-hex assertion).

- [ ] **Step 3: Live screenshots** (start Postgres, then the detached stack — see `reference_dashboard_visual_verification`): capture loading + empty + error for Home, Inbox, Results, Mira. Drive states by (a) navigating for the route-shell loading, (b) toggling `navigator.onLine`/blocking the API for the error state, (c) a seeded empty org for all-clear. Confirm Home still serves at `/` after the route-group move. Attach to the PR body.

- [ ] **Step 4: Push + open PR(s)**

Open against `main`. If shipping one PR, title `feat(dashboard): perceived-performance layer — QueryStates + (auth) loading shells`. Put the screenshots and the §8 Wave-0 coordination note in the body. Do NOT merge.

---

## Self-Review (run before execution)

- **Spec coverage:** §2 primitive → Tasks 1,3; §3 failure vocab → Task 2; §4 routing (Mira/open-decisions/key-result/Results/drawer) → Tasks 5–9; §5 route shells + (home) group → Tasks 10–14; §6 token governance → Task 4 + token-only code throughout; §7 testing → tests in every task + Task 16; §8 Wave-0 (no inbox-screen touch) → respected (Tasks touch drawer, not page). All covered.
- **Type consistency:** `QueryLike<T>`, `QueryState<T>`, `resolveQueryState(query, isEmpty?)`, `QueryStatesProps<T>` used identically across Tasks 1,3,4,6,7,8. `ConnectionTrouble`/`AllClear`/`AgentPaused` signatures match Tasks 2 and their consumers.
- **No placeholders:** every code step shows real code; file:line anchors verified against `origin/main` @ f7dc170f. Two implementation-time confirmations are flagged inline (Mira `T.paperDeep` fallback; Results `ReportData` field names) — both have a concrete fallback, not a TODO.
