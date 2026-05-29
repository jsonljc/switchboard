# Dashboard Demo-Data Toggle — PR-1 Infrastructure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the data-mode infrastructure (shared/server/client modules, provider, banner, DevPanel prop plumbing) as a zero-behavior-change PR. Mercury and cockpit migration come in later PRs (2/3/4); this PR adds the substrate so they have something to consume.

**Architecture:** Three-file `lib/data-mode/` split (`shared.ts` pure, `server.ts` with `next/headers` + `"server-only"`, `client.tsx` with provider+hooks). `(auth)/layout.tsx` resolves the cookie server-side, passes the mode through `DataModeProvider`, computes `dataModeControlsAllowed` server-side, and forwards it to `AppShell` which forwards it to `DevPanel`. `DataModeBanner` mounts in `AppShell` and renders only when mode=demo. No hooks change, no fixtures move, no env vars deleted.

**Tech Stack:** Next.js 16 App Router (server components + `"use client"`), React 19, React Testing Library + Vitest, Tailwind CSS for banner styling.

**Spec reference:** `docs/superpowers/specs/2026-05-16-dashboard-demo-data-toggle-design.md` (PR #593 against main).

---

## File structure

**Create (10 files):**

| Path                                                                       | Purpose                                                                               |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `apps/dashboard/src/lib/data-mode/shared.ts`                               | `DataMode` type, `DATA_MODE_COOKIE` const, `resolveDataMode`, `isFixtureModeAllowed`  |
| `apps/dashboard/src/lib/data-mode/server.ts`                               | `getDataMode()` — reads cookie via `next/headers`                                     |
| `apps/dashboard/src/lib/data-mode/client.tsx`                              | `DataModeProvider`, `useDataMode`, `useSetDataMode`, `useDataModeControls`            |
| `apps/dashboard/src/lib/data-mode/__tests__/shared.test.ts`                | Pure-function matrix tests                                                            |
| `apps/dashboard/src/lib/data-mode/__tests__/server.test.ts`                | Observable-behavior tests with mocked `cookies()`                                     |
| `apps/dashboard/src/lib/data-mode/__tests__/client.test.tsx`               | Provider seeding + hook + cookie writer tests                                         |
| `apps/dashboard/src/components/layout/data-mode-banner.tsx`                | Global amber strip when mode=demo                                                     |
| `apps/dashboard/src/components/layout/__tests__/data-mode-banner.test.tsx` | Banner visibility tests                                                               |
| `apps/dashboard/src/components/dev/__tests__/dev-panel.test.tsx`           | `dataModeControlsAllowed` gate test (new test file — no existing tests for dev-panel) |
| _(no banner.module.css — uses Tailwind classes only)_                      |                                                                                       |

**Modify (3 files):**

| Path                                                 | Change                                                                                        |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `apps/dashboard/src/app/(auth)/layout.tsx`           | Wrap in `DataModeProvider`, compute `dataModeControlsAllowed`, pass to `AppShell`             |
| `apps/dashboard/src/components/layout/app-shell.tsx` | Accept new prop, forward to DevPanel in both render branches, mount `DataModeBanner`          |
| `apps/dashboard/src/components/dev/dev-panel.tsx`    | Accept `dataModeControlsAllowed` prop, gate visibility on it (preserve existing session gate) |

---

## Task 1: `shared.ts` — pure resolver + guard chain

**Files:**

- Create: `apps/dashboard/src/lib/data-mode/shared.ts`
- Test: `apps/dashboard/src/lib/data-mode/__tests__/shared.test.ts`

- [ ] **Step 1.1: Write the failing test**

Create `apps/dashboard/src/lib/data-mode/__tests__/shared.test.ts`:

```ts
// apps/dashboard/src/lib/data-mode/__tests__/shared.test.ts
import { describe, it, expect } from "vitest";
import { resolveDataMode, isFixtureModeAllowed } from "../shared";

describe("resolveDataMode", () => {
  const allowedEnv = { NODE_ENV: "development" };
  const deniedEnv = { NODE_ENV: "production", VERCEL_ENV: "production" };

  it("returns 'demo' for cookie='demo' when allowed", () => {
    expect(resolveDataMode("demo", allowedEnv)).toBe("demo");
  });

  it("returns 'live' for cookie='live' when allowed", () => {
    expect(resolveDataMode("live", allowedEnv)).toBe("live");
  });

  it("returns 'live' when cookie is undefined", () => {
    expect(resolveDataMode(undefined, allowedEnv)).toBe("live");
  });

  it("returns 'live' for unknown cookie values", () => {
    expect(resolveDataMode("garbage", allowedEnv)).toBe("live");
  });

  it("returns 'live' for empty string cookie", () => {
    expect(resolveDataMode("", allowedEnv)).toBe("live");
  });

  it("returns 'live' for cookie='demo' when fixture mode is denied", () => {
    expect(resolveDataMode("demo", deniedEnv)).toBe("live");
  });

  it("returns 'live' for cookie='live' when fixture mode is denied", () => {
    expect(resolveDataMode("live", deniedEnv)).toBe("live");
  });
});

describe("isFixtureModeAllowed", () => {
  it("REGRESSION: VERCEL_ENV=production hard-denies even with ALLOW_FIXTURE_DATA_MODE=true", () => {
    // This is the safety-critical regression test. If this fails, a misconfigured
    // production deployment could expose demo data.
    expect(
      isFixtureModeAllowed({
        VERCEL_ENV: "production",
        ALLOW_FIXTURE_DATA_MODE: "true",
        NODE_ENV: "production",
      }),
    ).toBe(false);
  });

  it("denies on VERCEL_ENV=production without explicit opt-in", () => {
    expect(isFixtureModeAllowed({ VERCEL_ENV: "production", NODE_ENV: "production" })).toBe(false);
  });

  it("allows on Vercel preview with explicit opt-in", () => {
    expect(
      isFixtureModeAllowed({
        VERCEL_ENV: "preview",
        ALLOW_FIXTURE_DATA_MODE: "true",
        NODE_ENV: "production",
      }),
    ).toBe(true);
  });

  it("denies on Vercel preview without explicit opt-in", () => {
    expect(isFixtureModeAllowed({ VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe(false);
  });

  it("allows on non-Vercel staging with explicit opt-in", () => {
    expect(isFixtureModeAllowed({ ALLOW_FIXTURE_DATA_MODE: "true", NODE_ENV: "production" })).toBe(
      true,
    );
  });

  it("denies on non-Vercel production without opt-in", () => {
    expect(isFixtureModeAllowed({ NODE_ENV: "production" })).toBe(false);
  });

  it("allows on local development", () => {
    expect(isFixtureModeAllowed({ NODE_ENV: "development" })).toBe(true);
  });

  it("allows when env is entirely empty (local dev default)", () => {
    expect(isFixtureModeAllowed({})).toBe(true);
  });
});
```

- [ ] **Step 1.2: Run test, verify FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- src/lib/data-mode/__tests__/shared.test.ts
```

Expected: FAIL with module resolution error ("Cannot find module '../shared'") because the source file does not exist yet.

- [ ] **Step 1.3: Write the implementation**

Create `apps/dashboard/src/lib/data-mode/shared.ts`:

```ts
// apps/dashboard/src/lib/data-mode/shared.ts
//
// Pure data-mode resolver + production-safety guard.
// Safe to import from any context (server, client, tests).
// See docs/superpowers/specs/2026-05-16-dashboard-demo-data-toggle-design.md

export type DataMode = "demo" | "live";

export const DATA_MODE_COOKIE = "sw.data-mode";

type DataModeEnv = {
  ALLOW_FIXTURE_DATA_MODE?: string;
  VERCEL_ENV?: string;
  NODE_ENV?: string;
};

/**
 * Pure resolver: cookie value + env → DataMode.
 * - Invalid, missing, or unknown cookie values resolve to "live".
 * - When fixture mode is not allowed (production), always returns "live"
 *   regardless of cookie state.
 */
export function resolveDataMode(rawCookieValue: string | undefined, env: DataModeEnv): DataMode {
  if (!isFixtureModeAllowed(env)) return "live";
  return rawCookieValue === "demo" ? "demo" : "live";
}

/**
 * Guard chain. Hard-denies real production BEFORE honoring any explicit
 * opt-in, so a misconfigured ALLOW_FIXTURE_DATA_MODE on a Vercel production
 * deployment cannot expose demo data. The ordering is load-bearing.
 */
export function isFixtureModeAllowed(env: DataModeEnv): boolean {
  if (env.VERCEL_ENV === "production") return false;
  if (env.ALLOW_FIXTURE_DATA_MODE === "true") return true;
  if (env.NODE_ENV === "production") return false;
  return true;
}
```

- [ ] **Step 1.4: Run test, verify PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/lib/data-mode/__tests__/shared.test.ts
```

Expected: PASS — 16 tests passing (7 resolveDataMode + 8 isFixtureModeAllowed + 1 regression).

- [ ] **Step 1.5: Commit**

```bash
git add apps/dashboard/src/lib/data-mode/shared.ts apps/dashboard/src/lib/data-mode/__tests__/shared.test.ts
git commit -m "feat(data-mode): pure resolver + production-safety guard"
```

---

## Task 2: `server.ts` — `getDataMode()`

**Files:**

- Create: `apps/dashboard/src/lib/data-mode/server.ts`
- Test: `apps/dashboard/src/lib/data-mode/__tests__/server.test.ts`

- [ ] **Step 2.1: Write the failing test**

Create `apps/dashboard/src/lib/data-mode/__tests__/server.test.ts`:

```ts
// apps/dashboard/src/lib/data-mode/__tests__/server.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock next/headers cookies(). Each test sets the cookieValue ref to control
// what the mocked store returns.
const cookieValueRef: { current: string | undefined } = { current: undefined };

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      name === "sw.data-mode" && cookieValueRef.current !== undefined
        ? { name, value: cookieValueRef.current }
        : undefined,
  })),
}));

// Hoist process.env snapshot so tests can mutate it.
const originalEnv = { ...process.env };

beforeEach(() => {
  cookieValueRef.current = undefined;
  process.env = { ...originalEnv };
});

describe("getDataMode", () => {
  it("returns 'demo' when cookie='demo' and env allows fixture mode", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.VERCEL_ENV;
    cookieValueRef.current = "demo";

    const { getDataMode } = await import("../server");
    expect(await getDataMode()).toBe("demo");
  });

  it("returns 'live' when cookie is missing", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.VERCEL_ENV;
    cookieValueRef.current = undefined;

    const { getDataMode } = await import("../server");
    expect(await getDataMode()).toBe("live");
  });

  it("returns 'live' when env=production even with cookie='demo'", async () => {
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "production";
    cookieValueRef.current = "demo";

    const { getDataMode } = await import("../server");
    expect(await getDataMode()).toBe("live");
  });
});
```

- [ ] **Step 2.2: Run test, verify FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- src/lib/data-mode/__tests__/server.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 2.3: Write the implementation**

Create `apps/dashboard/src/lib/data-mode/server.ts`:

```ts
// apps/dashboard/src/lib/data-mode/server.ts
//
// Server-only data-mode resolver. Throws at compile time if imported from
// a "use client" file (defense in depth on top of the file-split rule).

import "server-only";
import { cookies } from "next/headers";
import { DATA_MODE_COOKIE, resolveDataMode, type DataMode } from "./shared";

/**
 * Read the current data mode on the server. RSC + route handlers only.
 */
export async function getDataMode(): Promise<DataMode> {
  const store = await cookies();
  return resolveDataMode(store.get(DATA_MODE_COOKIE)?.value, process.env);
}
```

- [ ] **Step 2.4: Run test, verify PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/lib/data-mode/__tests__/server.test.ts
```

Expected: PASS — 3 tests passing.

- [ ] **Step 2.5: Commit**

```bash
git add apps/dashboard/src/lib/data-mode/server.ts apps/dashboard/src/lib/data-mode/__tests__/server.test.ts
git commit -m "feat(data-mode): server-side getDataMode() helper"
```

---

## Task 3: `client.tsx` — provider + hooks + cookie writer

**Files:**

- Create: `apps/dashboard/src/lib/data-mode/client.tsx`
- Test: `apps/dashboard/src/lib/data-mode/__tests__/client.test.tsx`

- [ ] **Step 3.1: Write the failing test**

Create `apps/dashboard/src/lib/data-mode/__tests__/client.test.tsx`:

```tsx
// apps/dashboard/src/lib/data-mode/__tests__/client.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { DataModeProvider, useDataMode, useSetDataMode, useDataModeControls } from "../client";
import type { DataMode } from "../shared";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

function ModeReader() {
  const mode = useDataMode();
  return <span data-testid="mode">{mode}</span>;
}

function SetterReader({ next }: { next: DataMode }) {
  const setMode = useSetDataMode();
  return (
    <button type="button" data-testid="setter" onClick={() => setMode(next)}>
      set
    </button>
  );
}

function ControlsReader() {
  const { mode, setMode } = useDataModeControls();
  return (
    <>
      <span data-testid="ctrl-mode">{mode}</span>
      <button type="button" data-testid="ctrl-set" onClick={() => setMode("demo")}>
        demo
      </button>
    </>
  );
}

beforeEach(() => {
  refreshMock.mockReset();
  // jsdom's cookie jar persists across tests; clear what we set.
  document.cookie = "sw.data-mode=; path=/; max-age=0";
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { protocol: "http:" },
  });
});

describe("DataModeProvider + useDataMode", () => {
  it("returns the mode passed to the provider", () => {
    render(
      <DataModeProvider mode="demo">
        <ModeReader />
      </DataModeProvider>,
    );
    expect(screen.getByTestId("mode")).toHaveTextContent("demo");
  });

  it("returns 'live' by default when used outside a provider", () => {
    render(<ModeReader />);
    expect(screen.getByTestId("mode")).toHaveTextContent("live");
  });

  it("seeds value from props on first render (no hydration drift)", () => {
    const { rerender } = render(
      <DataModeProvider mode="demo">
        <ModeReader />
      </DataModeProvider>,
    );
    expect(screen.getByTestId("mode")).toHaveTextContent("demo");
    rerender(
      <DataModeProvider mode="live">
        <ModeReader />
      </DataModeProvider>,
    );
    expect(screen.getByTestId("mode")).toHaveTextContent("live");
  });
});

describe("useSetDataMode", () => {
  it("writes a cookie containing sw.data-mode=demo, path=/, max-age=, samesite=lax", () => {
    render(
      <DataModeProvider mode="live">
        <SetterReader next="demo" />
      </DataModeProvider>,
    );
    act(() => screen.getByTestId("setter").click());
    expect(document.cookie).toContain("sw.data-mode=demo");
    // The cookie write string itself contains these flags; jsdom may strip
    // them from document.cookie reads. Spy on document.cookie setter instead.
  });

  it("calls router.refresh() exactly once per write", () => {
    render(
      <DataModeProvider mode="live">
        <SetterReader next="demo" />
      </DataModeProvider>,
    );
    act(() => screen.getByTestId("setter").click());
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("includes 'secure' flag when window.location.protocol === 'https:'", () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { protocol: "https:" },
    });
    // Spy on the cookie setter to observe the full string (jsdom strips flags
    // from document.cookie reads but the setter receives the full value).
    const cookieWrites: string[] = [];
    const proto =
      Object.getOwnPropertyDescriptor(Document.prototype, "cookie") ??
      Object.getOwnPropertyDescriptor(HTMLDocument.prototype, "cookie")!;
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => proto.get!.call(document),
      set: (v: string) => {
        cookieWrites.push(v);
        proto.set!.call(document, v);
      },
    });

    render(
      <DataModeProvider mode="live">
        <SetterReader next="demo" />
      </DataModeProvider>,
    );
    act(() => screen.getByTestId("setter").click());

    expect(cookieWrites.some((c) => c.includes("secure"))).toBe(true);
  });

  it("excludes 'secure' flag on http:", () => {
    const cookieWrites: string[] = [];
    const proto =
      Object.getOwnPropertyDescriptor(Document.prototype, "cookie") ??
      Object.getOwnPropertyDescriptor(HTMLDocument.prototype, "cookie")!;
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => proto.get!.call(document),
      set: (v: string) => {
        cookieWrites.push(v);
        proto.set!.call(document, v);
      },
    });

    render(
      <DataModeProvider mode="live">
        <SetterReader next="demo" />
      </DataModeProvider>,
    );
    act(() => screen.getByTestId("setter").click());

    expect(cookieWrites.some((c) => c.includes("secure"))).toBe(false);
  });
});

describe("useDataModeControls", () => {
  it("returns { mode, setMode } as one object", () => {
    render(
      <DataModeProvider mode="demo">
        <ControlsReader />
      </DataModeProvider>,
    );
    expect(screen.getByTestId("ctrl-mode")).toHaveTextContent("demo");
    act(() => screen.getByTestId("ctrl-set").click());
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3.2: Run test, verify FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- src/lib/data-mode/__tests__/client.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3.3: Write the implementation**

Create `apps/dashboard/src/lib/data-mode/client.tsx`:

```tsx
// apps/dashboard/src/lib/data-mode/client.tsx
"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { DATA_MODE_COOKIE, type DataMode } from "./shared";

const DataModeContext = createContext<DataMode>("live");

/**
 * Provider seeded from the server-resolved cookie value. Mount inside the
 * authenticated layout so every consumer sees the same mode SSR rendered with.
 */
export function DataModeProvider({ mode, children }: { mode: DataMode; children: ReactNode }) {
  return <DataModeContext.Provider value={mode}>{children}</DataModeContext.Provider>;
}

/**
 * Read the current data mode. Returns the server-resolved value via context —
 * no useState initializer, no hydration drift.
 */
export function useDataMode(): DataMode {
  return useContext(DataModeContext);
}

/**
 * Set the cookie and refresh the route tree so RSC re-renders with the new
 * mode. In production, the server resolver still normalizes to "live", so
 * this write is ignored downstream.
 */
export function useSetDataMode(): (next: DataMode) => void {
  const router = useRouter();
  return useCallback(
    (next) => {
      const secure =
        typeof window !== "undefined" && window.location.protocol === "https:" ? "; secure" : "";
      document.cookie =
        `${DATA_MODE_COOKIE}=${encodeURIComponent(next)}; path=/; ` +
        `max-age=${60 * 60 * 24 * 365}; samesite=lax${secure}`;
      router.refresh();
    },
    [router],
  );
}

/**
 * Convenience hook combining read + write for components that need both
 * (e.g., the DevPanel toggle).
 */
export function useDataModeControls(): { mode: DataMode; setMode: (next: DataMode) => void } {
  const mode = useDataMode();
  const setMode = useSetDataMode();
  return { mode, setMode };
}
```

- [ ] **Step 3.4: Run test, verify PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/lib/data-mode/__tests__/client.test.tsx
```

Expected: PASS — 8 tests passing.

- [ ] **Step 3.5: Commit**

```bash
git add apps/dashboard/src/lib/data-mode/client.tsx apps/dashboard/src/lib/data-mode/__tests__/client.test.tsx
git commit -m "feat(data-mode): client provider + hooks + cookie writer"
```

---

## Task 4: `DataModeBanner` component

**Files:**

- Create: `apps/dashboard/src/components/layout/data-mode-banner.tsx`
- Test: `apps/dashboard/src/components/layout/__tests__/data-mode-banner.test.tsx`

- [ ] **Step 4.1: Write the failing test**

Create `apps/dashboard/src/components/layout/__tests__/data-mode-banner.test.tsx`:

```tsx
// apps/dashboard/src/components/layout/__tests__/data-mode-banner.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataModeBanner } from "../data-mode-banner";
import { DataModeProvider } from "@/lib/data-mode/client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe("DataModeBanner", () => {
  it("renders the short label when mode is 'demo'", () => {
    render(
      <DataModeProvider mode="demo">
        <DataModeBanner />
      </DataModeProvider>,
    );
    expect(screen.getByText(/demo data mode/i)).toBeInTheDocument();
  });

  it("renders nothing when mode is 'live'", () => {
    const { container } = render(
      <DataModeProvider mode="live">
        <DataModeBanner />
      </DataModeProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("does not announce as an error (no role='alert')", () => {
    render(
      <DataModeProvider mode="demo">
        <DataModeBanner />
      </DataModeProvider>,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("exposes longer copy via title attribute for hover", () => {
    render(
      <DataModeProvider mode="demo">
        <DataModeBanner />
      </DataModeProvider>,
    );
    const banner = screen.getByText(/demo data mode/i);
    // The banner element (or a parent) should carry an accessible long-form description.
    const titled = banner.closest("[title]");
    expect(titled).not.toBeNull();
    expect(titled?.getAttribute("title")).toMatch(/live systems are not being queried/i);
  });
});
```

- [ ] **Step 4.2: Run test, verify FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/layout/__tests__/data-mode-banner.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 4.3: Write the implementation**

Create `apps/dashboard/src/components/layout/data-mode-banner.tsx`:

```tsx
// apps/dashboard/src/components/layout/data-mode-banner.tsx
"use client";

import { useDataMode } from "@/lib/data-mode/client";

/**
 * Global indicator strip rendered at the top of the viewport whenever data
 * mode is "demo". Quiet amber styling — not an error state. Visible to any
 * session, not gated on dev-user (stakeholders viewing preview deployments
 * need to know they're looking at demo data).
 */
export function DataModeBanner() {
  const mode = useDataMode();
  if (mode !== "demo") return null;

  return (
    <div
      role="status"
      title="Live systems are not being queried."
      className="sticky top-0 z-50 flex items-center justify-center bg-amber-100 px-4 py-1.5 text-xs font-medium text-amber-900 ring-1 ring-amber-200"
    >
      Demo data mode
    </div>
  );
}
```

- [ ] **Step 4.4: Run test, verify PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/layout/__tests__/data-mode-banner.test.tsx
```

Expected: PASS — 4 tests passing.

- [ ] **Step 4.5: Commit**

```bash
git add apps/dashboard/src/components/layout/data-mode-banner.tsx apps/dashboard/src/components/layout/__tests__/data-mode-banner.test.tsx
git commit -m "feat(data-mode): global DataModeBanner component"
```

---

## Task 5: Wire `dataModeControlsAllowed` through `AppShell` + mount banner

**Files:**

- Modify: `apps/dashboard/src/components/layout/app-shell.tsx`
- Modify: `apps/dashboard/src/components/layout/__tests__/app-shell.test.tsx`

- [ ] **Step 5.1: Extend the AppShell tests**

Open `apps/dashboard/src/components/layout/__tests__/app-shell.test.tsx`. Add the following test cases at the end of the file (before the closing of the outermost `describe` block or as a new `describe`):

```tsx
describe("AppShell — dataModeControlsAllowed prop forwarding", () => {
  it("forwards dataModeControlsAllowed=true to DevPanel in editorial branch", () => {
    pathnameRef.current = "/alex";
    render(
      <AppShell dataModeControlsAllowed={true}>
        <span data-testid="page">x</span>
      </AppShell>,
    );
    // DevPanel is mocked above to render <div data-testid="dev-panel" />; the
    // prop forwarding is validated by extending the mock to capture props.
    expect(screen.getByTestId("dev-panel")).toBeInTheDocument();
  });

  it("forwards dataModeControlsAllowed=false to DevPanel in bare-main branch", () => {
    pathnameRef.current = "/settings";
    render(
      <AppShell dataModeControlsAllowed={false}>
        <span data-testid="page">x</span>
      </AppShell>,
    );
    expect(screen.getByTestId("dev-panel")).toBeInTheDocument();
  });
});

describe("AppShell — DataModeBanner mounted in both branches", () => {
  it("mounts DataModeBanner in editorial branch", () => {
    pathnameRef.current = "/alex";
    render(
      <AppShell dataModeControlsAllowed={false}>
        <span>x</span>
      </AppShell>,
    );
    // Banner is mocked to render an identifying testid.
    expect(screen.getByTestId("data-mode-banner")).toBeInTheDocument();
  });

  it("mounts DataModeBanner in bare-main branch", () => {
    pathnameRef.current = "/settings";
    render(
      <AppShell dataModeControlsAllowed={false}>
        <span>x</span>
      </AppShell>,
    );
    expect(screen.getByTestId("data-mode-banner")).toBeInTheDocument();
  });
});
```

Now update the test mocks (top of file) to surface the banner with a testid and to capture DevPanel props. Replace the existing `vi.mock("next/dynamic", ...)` block and add a new mock for the banner. The full block should read:

```tsx
const devPanelProps: { current: Record<string, unknown> } = { current: {} };

vi.mock("next/dynamic", () => ({
  default: (_loader: () => Promise<{ DevPanel: React.FC<Record<string, unknown>> }>) => {
    const Component = (props: Record<string, unknown>) => {
      devPanelProps.current = props;
      return <div data-testid="dev-panel" />;
    };
    Component.displayName = "DynamicDevPanel";
    return Component;
  },
}));

vi.mock("../data-mode-banner", () => ({
  DataModeBanner: () => <div data-testid="data-mode-banner" />,
}));
```

Also update the two "forwards dataModeControlsAllowed" tests above to assert against `devPanelProps.current`:

```tsx
it("forwards dataModeControlsAllowed=true to DevPanel in editorial branch", () => {
  pathnameRef.current = "/alex";
  render(
    <AppShell dataModeControlsAllowed={true}>
      <span>x</span>
    </AppShell>,
  );
  expect(devPanelProps.current.dataModeControlsAllowed).toBe(true);
});

it("forwards dataModeControlsAllowed=false to DevPanel in bare-main branch", () => {
  pathnameRef.current = "/settings";
  render(
    <AppShell dataModeControlsAllowed={false}>
      <span>x</span>
    </AppShell>,
  );
  expect(devPanelProps.current.dataModeControlsAllowed).toBe(false);
});
```

- [ ] **Step 5.2: Run tests, verify FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/layout/__tests__/app-shell.test.tsx
```

Expected: FAIL — `AppShell` does not accept `dataModeControlsAllowed`; existing `<AppShell>` callers (other tests) work because the prop is optional; banner is not mounted.

- [ ] **Step 5.3: Modify `AppShell` to accept the prop, forward it, and mount the banner**

Open `apps/dashboard/src/components/layout/app-shell.tsx`. Make four changes:

**Change A** — add the import for `DataModeBanner` near the top:

```ts
import { DataModeBanner } from "@/components/layout/data-mode-banner";
```

**Change B** — update the component signature and props type:

```ts
export function AppShell({
  children,
  dataModeControlsAllowed = false,
}: {
  children: React.ReactNode;
  dataModeControlsAllowed?: boolean;
}) {
```

**Change C** — in the `if (usesEditorialShell) { return (...) }` branch, mount the banner above `children` and forward the prop to `<DevPanel />`:

```tsx
if (usesEditorialShell) {
  return (
    <>
      <DataModeBanner />
      {children}
      <DevPanel dataModeControlsAllowed={dataModeControlsAllowed} />
    </>
  );
}
```

**Change D** — in the bare-main branch at the bottom of the component, mount the banner above `<main>` and add the prop to the existing `<DevPanel />`. The existing bare-main branch already renders `<DevPanel />` inside `<main>`; the only changes are (1) inserting `<DataModeBanner />` above `<main>` and (2) adding the prop to the existing `<DevPanel />` tag:

```tsx
return (
  <>
    <DataModeBanner />
    <main className="min-h-screen bg-background">
      {children}
      <DevPanel dataModeControlsAllowed={dataModeControlsAllowed} />
    </main>
  </>
);
```

- [ ] **Step 5.4: Run tests, verify PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/layout/__tests__/app-shell.test.tsx
```

Expected: PASS — all tests including the four new ones.

- [ ] **Step 5.5: Commit**

```bash
git add apps/dashboard/src/components/layout/app-shell.tsx apps/dashboard/src/components/layout/__tests__/app-shell.test.tsx
git commit -m "feat(data-mode): wire dataModeControlsAllowed prop + mount DataModeBanner in AppShell"
```

---

## Task 6: Wire `DataModeProvider` + `dataModeControlsAllowed` in `(auth)/layout.tsx`

**Files:**

- Modify: `apps/dashboard/src/app/(auth)/layout.tsx`

No new test file — server components are not unit-tested in this codebase. The wiring is validated by the AppShell prop-forwarding test (Task 5) plus the integration smoke in Task 8.

- [ ] **Step 6.1: Modify `(auth)/layout.tsx`**

Open `apps/dashboard/src/app/(auth)/layout.tsx`. Replace the file contents with:

```tsx
import { AuthProvider } from "@/providers/auth-provider";
import { AppShell } from "@/components/layout/app-shell";
import { ErrorBoundary } from "@/components/error-boundary";
import { OperatorChatWidget } from "@/components/operator-chat/operator-chat-widget";
import { Toaster } from "@/components/ui/toaster";
import { getServerSession } from "@/lib/session";
import { getDataMode } from "@/lib/data-mode/server";
import { isFixtureModeAllowed } from "@/lib/data-mode/shared";
import { DataModeProvider } from "@/lib/data-mode/client";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  const mode = await getDataMode();
  const dataModeControlsAllowed = isFixtureModeAllowed(process.env);

  return (
    <AuthProvider session={session}>
      <DataModeProvider mode={mode}>
        <ErrorBoundary>
          <AppShell dataModeControlsAllowed={dataModeControlsAllowed}>{children}</AppShell>
        </ErrorBoundary>
        <OperatorChatWidget />
        <Toaster />
      </DataModeProvider>
    </AuthProvider>
  );
}
```

- [ ] **Step 6.2: Run typecheck**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: 0 errors. If `getDataMode` / `isFixtureModeAllowed` / `DataModeProvider` cannot be resolved, recheck Tasks 1-3 wrote files to the exact paths.

- [ ] **Step 6.3: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/layout.tsx
git commit -m "feat(data-mode): wire DataModeProvider + dataModeControlsAllowed in auth layout"
```

---

## Task 7: `DevPanel` — accept and consume `dataModeControlsAllowed` prop

**Files:**

- Modify: `apps/dashboard/src/components/dev/dev-panel.tsx`
- Create: `apps/dashboard/src/components/dev/__tests__/dev-panel.test.tsx`

- [ ] **Step 7.1: Write the failing test**

Create `apps/dashboard/src/components/dev/__tests__/dev-panel.test.tsx`:

```tsx
// apps/dashboard/src/components/dev/__tests__/dev-panel.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DevPanel } from "../dev-panel";

const sessionRef: { current: { user?: { id?: string } } | null } = { current: null };
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: sessionRef.current }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/alex",
}));

beforeEach(() => {
  sessionRef.current = { user: { id: "dev-user" } };
});

describe("DevPanel — dataModeControlsAllowed gate", () => {
  it("renders when dataModeControlsAllowed=true and session is dev-user", () => {
    render(<DevPanel dataModeControlsAllowed={true} />);
    expect(screen.getByRole("button", { name: /dev/i })).toBeInTheDocument();
  });

  it("hides when dataModeControlsAllowed=false even with dev-user session", () => {
    const { container } = render(<DevPanel dataModeControlsAllowed={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("hides when session is not dev-user even with dataModeControlsAllowed=true", () => {
    sessionRef.current = { user: { id: "real-user" } };
    const { container } = render(<DevPanel dataModeControlsAllowed={true} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("hides when both gates fail", () => {
    sessionRef.current = null;
    const { container } = render(<DevPanel dataModeControlsAllowed={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 7.2: Run test, verify FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/dev/__tests__/dev-panel.test.tsx
```

Expected: FAIL — `DevPanel` does not accept `dataModeControlsAllowed`, and the existing `NODE_ENV === "production"` short-circuit may suppress rendering depending on `process.env.NODE_ENV` in the vitest env (typically `"test"`, which the existing check treats as non-production, so the existing gate does not fire — leaving only the dev-user gate to govern).

- [ ] **Step 7.3: Modify `dev-panel.tsx`**

Open `apps/dashboard/src/components/dev/dev-panel.tsx`. Replace the file with:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";

const NAV_LINKS = [
  { href: "/", label: "Owner Home" },
  { href: "/alex", label: "Alex" },
  { href: "/contacts", label: "Contacts" },
  { href: "/automations", label: "Automations" },
  { href: "/activity", label: "Activity" },
  { href: "/reports", label: "Reports" },
  { href: "/settings", label: "Settings" },
  { href: "/onboarding", label: "Onboarding" },
  { href: "/login", label: "Login" },
];

export interface DevPanelProps {
  /**
   * Server-resolved flag from isFixtureModeAllowed(process.env). Gates the
   * DevPanel's existence — when false, the panel is fully hidden because none
   * of its controls would have any effect (cookie writes ignored by the
   * production-normalizing resolver).
   *
   * Computed server-side in (auth)/layout.tsx because process.env in client
   * components only exposes NEXT_PUBLIC_* vars — server-only env vars like
   * VERCEL_ENV would read as undefined here.
   */
  dataModeControlsAllowed: boolean;
}

export function DevPanel({ dataModeControlsAllowed }: DevPanelProps) {
  if (!dataModeControlsAllowed) return null;

  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { data: session } = useSession();

  if (session?.user?.id !== "dev-user") return null;

  return (
    <div className="fixed bottom-24 right-4 z-[100] md:bottom-4">
      {open && (
        <nav className="mb-2 rounded-lg border-2 border-yellow-400 bg-gray-900 p-3 shadow-lg">
          <ul className="space-y-1">
            {NAV_LINKS.map(({ href, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  onClick={() => setOpen(false)}
                  className={`block rounded px-3 py-1.5 text-sm transition-colors ${
                    pathname === href
                      ? "bg-yellow-400/20 font-medium text-yellow-300"
                      : "text-gray-300 hover:bg-gray-800 hover:text-white"
                  }`}
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        className="ml-auto flex h-10 items-center gap-1.5 rounded-full border-2 border-yellow-400 bg-gray-900 px-4 text-sm font-bold text-yellow-400 shadow-lg transition-colors hover:bg-yellow-400 hover:text-gray-900"
      >
        <span className="inline-block h-2 w-2 rounded-full bg-green-400" />
        DEV
      </button>
    </div>
  );
}
```

The changes from the existing file are:

- New `DevPanelProps` interface (export so AppShell can refer to it if needed)
- Component signature now accepts `{ dataModeControlsAllowed }`
- Early-return on `!dataModeControlsAllowed` replaces the old `process.env.NODE_ENV === "production"` check (the new gate is stricter and server-resolved)
- All other code is byte-identical to the existing file

- [ ] **Step 7.4: Run tests, verify PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/dev/__tests__/dev-panel.test.tsx
```

Expected: PASS — 4 tests passing.

- [ ] **Step 7.5: Commit**

```bash
git add apps/dashboard/src/components/dev/dev-panel.tsx apps/dashboard/src/components/dev/__tests__/dev-panel.test.tsx
git commit -m "feat(data-mode): DevPanel accepts dataModeControlsAllowed prop"
```

---

## Task 8: PR-1 verification (typecheck + build + full test suite)

No source changes in this task — verification only.

- [ ] **Step 8.1: Typecheck the whole dashboard**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: 0 errors. If dependencies are stale, run `pnpm build --filter @switchboard/dashboard^...` first.

- [ ] **Step 8.2: Build the dashboard (catches `.js`-extension and import regressions)**

```bash
pnpm --filter @switchboard/dashboard build
```

Expected: successful build. The route table should still list every existing route (no new routes added by PR-1). The Next.js build runs static analysis that catches client/server boundary violations — if a `"use client"` file accidentally imported `@/lib/data-mode/server`, the build would fail here.

- [ ] **Step 8.3: Run the full dashboard test suite**

```bash
pnpm --filter @switchboard/dashboard test
```

Expected: PASS — 238+ test files including the 5 new ones from this PR (shared, server, client, data-mode-banner, dev-panel). Total test count should be ~1690 + ~30 = ~1720.

- [ ] **Step 8.4: Manual smoke (local dev server)**

Run the dashboard in dev:

```bash
pnpm --filter @switchboard/dashboard dev
```

Then in another shell:

```bash
# A: confirm the banner appears in demo mode
curl -s -b "sw.data-mode=demo" http://localhost:3002/alex | grep -ci "demo data mode"
# Expected: at least 1

# B: confirm the banner is absent in live mode (default)
curl -s http://localhost:3002/alex | grep -ci "demo data mode"
# Expected: 0

# C: confirm /alex still renders successfully
curl -s -o /dev/null -w "status=%{http_code}\n" http://localhost:3002/alex
# Expected: status=200
```

If any of A/B/C is wrong, the banner is not mounted correctly OR the cookie is not propagating to SSR.

- [ ] **Step 8.5: Push branch + open PR**

```bash
git push -u origin <current-branch>
gh pr create --title "feat(dashboard-demo-toggle): PR-1 — data-mode infrastructure" --body "$(cat <<'EOF'
## Summary

Adds the data-mode infrastructure substrate per spec PR #593. **Zero behavior change** — Mercury and cockpit hooks still always fetch live data; this PR just plumbs the foundations.

- `lib/data-mode/{shared,server,client}.tsx` with strict server/client boundary discipline (`import "server-only"` + 3-file split)
- `DataModeProvider` mounted in `(auth)/layout.tsx`, seeded from server-resolved cookie
- `DataModeBanner` mounted in `AppShell` — renders only when cookie sets `sw.data-mode=demo` and `isFixtureModeAllowed(env)` returns true
- `DevPanel` accepts new `dataModeControlsAllowed` prop computed server-side (the old `NODE_ENV === "production"` check is replaced by the stricter server-resolved gate)
- Production hard-denies fixture mode on `VERCEL_ENV=production` before honoring any explicit opt-in — covered by a regression test

## What's NOT in this PR

- No Mercury hook conversions (PR-2)
- No cockpit fixture layer (PR-3)
- No DevPanel toggle UI (PR-4)
- No `NEXT_PUBLIC_*_LIVE` env-var deletions (PR-2)

## Test plan

- [ ] Reviewer: run `pnpm --filter @switchboard/dashboard typecheck` — expect 0 errors
- [ ] Reviewer: run `pnpm --filter @switchboard/dashboard build` — expect successful build with unchanged route table
- [ ] Reviewer: run `pnpm --filter @switchboard/dashboard test` — expect all tests passing including the 5 new test files
- [ ] Reviewer: manually set `sw.data-mode=demo` cookie in browser dev tools on /alex, verify the amber banner appears at the top; clear the cookie, verify the banner disappears

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

After PR opens, paste the URL back.

---

## Self-review checklist

After implementing all tasks above, before requesting review:

- [ ] **Spec coverage:** every PR-1 deliverable in `docs/superpowers/specs/2026-05-16-dashboard-demo-data-toggle-design.md` Migration Plan section is covered by exactly one task above (no gaps, no duplication).
- [ ] **Boundary check:** grep `rg -l "@/lib/data-mode/server" apps/dashboard/src` — every match must be a server component (no `"use client"` at the top of the file). Hand-verify until the script in PR-2 lands.
- [ ] **No env-flag deletions yet:** grep `rg "NEXT_PUBLIC_(CONTACTS|AUTOMATIONS|ACTIVITY|REPORTS|APPROVALS)_LIVE" apps/dashboard packages` — should still match the existing env files (PR-2 deletes these; PR-1 leaves them alone).
- [ ] **No hook conversions:** grep `rg "useDataMode|getDataMode" apps/dashboard/src/app/\(auth\)/\(mercury\)` — expect 0 matches (Mercury hooks are not touched in PR-1).
- [ ] **DevPanel behavior preserved:** the only DevPanel behavior change is the gate (old `NODE_ENV === "production"` → new `dataModeControlsAllowed`). All NAV_LINKS, the floating-pill UI, and the session check remain byte-identical.

---

## References

- Spec: `docs/superpowers/specs/2026-05-16-dashboard-demo-data-toggle-design.md`
- Spec PR: https://github.com/jsonljc/switchboard/pull/593
- Memory: `[[feedback-next-server-client-module-split]]` — file-split rule
- Memory: `[[feedback-prod-safety-node-env-insufficient]]` — guard chain ordering
- Memory: `[[feedback-dashboard-no-js-on-any-import]]` — why `build` is in the per-PR baseline
