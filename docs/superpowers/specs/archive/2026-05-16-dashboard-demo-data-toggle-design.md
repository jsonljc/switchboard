# Dashboard Demo Data Toggle — Design Spec

**Date:** 2026-05-16
**Scope:** `apps/dashboard` — all Mercury tool surfaces, cockpit pages (`/alex`, `/riley`), shared editorial shell
**Goal:** Replace the static, build-time `NEXT_PUBLIC_*_LIVE` flags with a single runtime toggle that lets dev/preview users flip between demo (fixture) data and live API data, with hard production safety guarantees.

---

## Problem

Today the dashboard exposes "fixture mode" through five build-time env vars (`NEXT_PUBLIC_CONTACTS_LIVE`, `_AUTOMATIONS_LIVE`, `_ACTIVITY_LIVE`, `_REPORTS_LIVE`, `_APPROVALS_LIVE`). Each Mercury tool's hook calls `isMercuryToolLive(id)`; when off the hook returns a `FIXTURE_RESPONSE` constant. Cockpit pages (`/alex`, `/riley`) have **no fixture mode at all** — they always hit the live API.

This produces three concrete problems:

1. **Toggling requires a rebuild.** Next.js inlines `NEXT_PUBLIC_*` at build time, so flipping a flag means stopping the dev server, editing `.env.local`, restarting. Not a runtime switch.
2. **Cockpit demos look empty.** `/alex` and `/riley` on a fresh org show zero approvals, zero KPIs, blank greeting — because there's no fixture path.
3. **Per-surface granularity that no one uses.** Five separate flags are toggled together in practice. The complexity costs more than it pays.

The fix is a single dev-only runtime toggle backed by a cookie, with explicit production-safety guards, that covers Mercury tools and cockpit pages alike.

---

## Approach

**Cookie-backed runtime toggle.** A single cookie `sw.data-mode` (`"demo"` | `"live"`) drives both server-rendered and client-rendered code paths. Production hard-denies fixture mode regardless of cookie state. The toggle UI lives in the existing DevPanel.

Chosen over two alternatives:

- **Layer cookie on top of `isMercuryToolLive`:** smaller diff but leaves dead per-surface env-flag plumbing.
- **Middleware-injected request header:** "purer" but adds middleware overhead for a dev-only flag.

---

## Architecture

```
                ┌─────────────────────────────┐
   user clicks  │ DevPanel switch (client)    │  document.cookie = ...
   "Demo/Live"  │ sets sw.data-mode cookie    │  router.refresh()
                └──────────────┬──────────────┘
                               │
                ┌──────────────▼──────────────┐
                │ Next.js request             │
                │ (server components + SSR)   │
                └──────────────┬──────────────┘
                               │
                ┌──────────────▼──────────────┐
                │ lib/data-mode/              │
                │   getDataMode()  (server)   │  ◄── reads sw.data-mode cookie
                │   useDataMode()  (client)   │      via next/headers cookies()
                │                             │      hardcodes "live" in production
                └──────────────┬──────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
   ┌────────────────┐ ┌────────────────┐ ┌──────────────────┐
   │ Mercury hooks  │ │ Cockpit hooks  │ │ ToolsOverflow    │
   │ use-activity-  │ │ use-agent-     │ │ DataModeBanner   │
   │ list, use-     │ │ metrics, use-  │ │ (visual cues)    │
   │ approvals, ... │ │ agent-greeting,│ │                  │
   │ → fixture or   │ │ ... → fixture  │ │                  │
   │   live API     │ │   or live API  │ │                  │
   └────────────────┘ └────────────────┘ └──────────────────┘
```

### Source-of-truth scope

Single source of truth **in non-production**: the `sw.data-mode` cookie. **In production**, the source of truth is always `"live"` regardless of cookie state — the resolver normalizes everything to live before any value reaches a component.

### Production safety

Helpers refuse fixture mode in real production. The guard chain (see `isFixtureModeAllowed` below) hard-denies on `VERCEL_ENV === "production"` **before** any explicit-opt-in flag is consulted. A misconfigured `ALLOW_FIXTURE_DATA_MODE=true` on a Vercel production deployment cannot open the escape hatch. See [[feedback-prod-safety-node-env-insufficient]].

### Hydration discipline

SSR reads the cookie and passes the resolved mode through a `DataModeProvider`. Client hooks receive the same value via context — no `useState` initializer, no post-hydration drift. First paint already reflects the correct mode.

---

## Module shape — `lib/data-mode/`

Three-file split per [[feedback-next-server-client-module-split]]:

```
apps/dashboard/src/lib/data-mode/
  shared.ts   — pure functions + types; safe to import anywhere
  server.ts   — server-only (next/headers); import only from RSC/route handlers
  client.ts   — "use client" provider + hook + cookie writer
```

### `shared.ts` — pure logic

```ts
export type DataMode = "demo" | "live";

export const DATA_MODE_COOKIE = "sw.data-mode";

/**
 * Pure resolver. Invalid, missing, or unknown cookie values resolve to "live".
 * When fixture mode is not allowed, always returns "live" regardless of cookie.
 */
export function resolveDataMode(
  rawCookieValue: string | undefined,
  env: { ALLOW_FIXTURE_DATA_MODE?: string; VERCEL_ENV?: string; NODE_ENV?: string },
): DataMode {
  if (!isFixtureModeAllowed(env)) return "live";
  return rawCookieValue === "demo" ? "demo" : "live";
}

/**
 * Guard chain. Hard-denies real production BEFORE honoring any explicit opt-in,
 * so a misconfigured ALLOW_FIXTURE_DATA_MODE on a Vercel production deployment
 * cannot expose demo data.
 */
export function isFixtureModeAllowed(env: {
  ALLOW_FIXTURE_DATA_MODE?: string;
  VERCEL_ENV?: string;
  NODE_ENV?: string;
}): boolean {
  if (env.VERCEL_ENV === "production") return false; // hard deny first
  if (env.ALLOW_FIXTURE_DATA_MODE === "true") return true; // explicit opt-in for preview/staging
  if (env.NODE_ENV === "production") return false; // fallback deny
  return true; // local dev default
}
```

100% unit-testable, zero Next.js coupling.

### `server.ts` — server-only

```ts
import "server-only";
import { cookies } from "next/headers";
import { DATA_MODE_COOKIE, resolveDataMode, type DataMode } from "./shared";

export async function getDataMode(): Promise<DataMode> {
  const store = await cookies();
  return resolveDataMode(store.get(DATA_MODE_COOKIE)?.value, process.env);
}
```

The `import "server-only"` line throws a compile-time error if a client component ever imports this file — defense in depth on top of the file-split rule.

### `client.ts` — provider + hook + writer

```tsx
"use client";
import { createContext, useContext, useCallback } from "react";
import { useRouter } from "next/navigation";
import { DATA_MODE_COOKIE, type DataMode } from "./shared";

const DataModeContext = createContext<DataMode>("live");

export function DataModeProvider({
  mode,
  children,
}: {
  mode: DataMode;
  children: React.ReactNode;
}) {
  return <DataModeContext.Provider value={mode}>{children}</DataModeContext.Provider>;
}

export function useDataMode(): DataMode {
  return useContext(DataModeContext);
}

/**
 * Set the local cookie and refresh the route tree so RSC re-renders with new mode.
 * In production, the server resolver still normalizes to "live", so this write is ignored.
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

export function useDataModeControls() {
  return { mode: useDataMode(), setMode: useSetDataMode() };
}
```

### Wiring into the layout

In `app/(auth)/layout.tsx`:

```tsx
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
        <AppShell>{children}</AppShell>
        <OperatorChatWidget />
        <DevPanel dataModeControlsAllowed={dataModeControlsAllowed} />
        <Toaster />
      </DataModeProvider>
    </AuthProvider>
  );
}
```

`dataModeControlsAllowed` is evaluated **server-side**. Never call `isFixtureModeAllowed(process.env)` inside a `"use client"` component — Next.js inlines only `NEXT_PUBLIC_*` vars into the client bundle, so `VERCEL_ENV` and `ALLOW_FIXTURE_DATA_MODE` are `undefined` there and the guard would give the wrong answer.

---

## Mercury surface migration

Scope: 9 files covering 10+ callsites, plus 2 collateral cleanups and 1 shared banner generalization.

### Conversion pattern

```ts
// before
const isLive = (): boolean => isMercuryToolLive("activity");
const live = isLive();
return useQuery({
  queryKey: ["activity", { filter }],
  queryFn: async () => (live ? await fetch(...) : FIXTURE_RESPONSE),
});

// after
const mode = useDataMode();
return useQuery({
  queryKey: ["activity", mode, { filter }],   // mode included in key
  queryFn: async () => (mode === "live" ? await fetch(...) : FIXTURE_RESPONSE),
});
```

**Mode goes into every queryKey.** Without it, react-query serves the previous mode's cached payload after a toggle (queryFn never re-runs).

### Callsite inventory (9 files, 10+ callsites)

| File                                                                      | Surface                                     |
| ------------------------------------------------------------------------- | ------------------------------------------- |
| `app/(auth)/(mercury)/activity/hooks/use-activity-list.ts`                | activity list                               |
| `app/(auth)/(mercury)/activity/activity-page.tsx`                         | activity scope label                        |
| `app/(auth)/(mercury)/contacts/hooks/use-opportunities-board.ts`          | pipeline board                              |
| `app/(auth)/(mercury)/contacts/hooks/use-opportunity-stage-transition.ts` | stage drag mutation                         |
| `app/(auth)/(mercury)/contacts/[id]/hooks/use-contact-detail.ts`          | contact detail                              |
| `app/(auth)/(mercury)/automations/hooks/use-automations-list.ts`          | automations                                 |
| `app/(auth)/(mercury)/approvals/hooks/use-approvals.ts`                   | approvals (3 callsites: list + 2 mutations) |
| `app/(auth)/(mercury)/reports/reports-page.tsx`                           | reports page mode flag                      |
| `app/(auth)/(mercury)/reports/hooks/use-report-data.ts`                   | report data                                 |

### Mutation discipline

Per [[feedback-demo-mode-mutations-must-branch-explicitly]]: every mutation hook must explicitly branch on mode. Demo branches return a deterministic fixture-success response matching the live response's TypeScript contract. No live fetch when `mode === "demo"`. Affected hooks: `use-opportunity-stage-transition.ts`, `useRespondToApproval` (inside `use-approvals.ts`).

Each mutation hook ships with a unit test that mocks `fetch` and asserts zero calls in demo mode.

### ToolsOverflow simplification

Today `components/layout/tools-overflow.tsx:38` filters by per-surface env flag. With the master toggle there's no per-surface gating — every tool is reachable in either mode. The filter + the "hide when zero live" branch are removed. The Tools ▾ dropdown becomes unconditional in any environment where the layout renders.

**Important:** removing the per-surface live/demo filter does **not** remove route-existence gating. `isAgentHomeLinkLive(kind)` in `lib/route-availability.ts` stays — it gates agent-home pipeline tile clickability for kinds whose destination routes don't exist yet (`ad-set`, `creative-job`, `agent-setup`, `all-wins`). Different concern.

### DataModeBanner generalization

`app/(auth)/(mercury)/reports/components/fixture-mode-banner.tsx` (reports-only) is replaced by `components/layout/data-mode-banner.tsx` (global). The new banner renders inside `AppShell` whenever `useDataMode() === "demo"`. Quiet amber strip at the top of the viewport. Short label "Demo data mode"; longer copy "Live systems are not being queried" goes in `title` for hover. Uses the existing design-system amber/warning token, not a hardcoded hex.

The old per-page reports banner is deleted in the same PR.

---

## Cockpit fixture layer (new work)

Today `/alex` and `/riley` have no fixture branching. Adding it requires both new fixture content and hook conversions.

### Hook inventory

**Read hooks (need fixture branching):**

| Hook                         | Used by                            | Has demo fixture today?                                                        |
| ---------------------------- | ---------------------------------- | ------------------------------------------------------------------------------ |
| `use-agent-greeting`         | both cockpits, greeting block      | no                                                                             |
| `use-agent-metrics`          | both cockpits, KPI strip + ROI bar | no                                                                             |
| `use-agent-mission`          | both cockpits, MissionPopover      | no                                                                             |
| `use-agent-activity-cockpit` | Alex activity stream               | no                                                                             |
| `use-riley-activity`         | Riley activity stream              | test-only at `lib/cockpit/riley/__fixtures__/riley-activity-fixtures.ts`       |
| `use-riley-approvals`        | Riley approvals lane               | test-only at `lib/cockpit/riley/__fixtures__/riley-recommendation-fixtures.ts` |
| `use-cockpit-status`         | Alex status pill                   | no                                                                             |
| `use-riley-status`           | Riley status pill                  | no                                                                             |

Existing hook names are retained — both `use-cockpit-status` and `use-riley-status` keep their current naming to avoid a rename-only diff.

**Mutation hook:** `use-recommendation-action` (accept/dismiss/snooze) gets an explicit demo branch returning a fixture-success response matching the live contract.

**Server-side fetch:** `fetchEnabledAgentsServer()` in `lib/api-client/agents-server.ts` branches on `await getDataMode() === "demo"` and returns `["alex", "riley"]` regardless of org enablement. This bypass widens visible cockpit destinations in demo mode; it must **not** bypass authentication or tenant resolution — the function still runs only inside the authenticated shell.

### Alex approvals — already covered

Alex's cockpit consumes the same Mercury approvals hooks (`usePendingApprovals`, `useRespondToApproval`) imported from `app/(auth)/(mercury)/approvals/hooks/use-approvals.ts` — see `cockpit-page.tsx:23` and `alex/alex-approval-row.tsx:6`. No separate Alex approvals fixture is needed; Mercury's approvals fixture (and its demo branch) covers both surfaces.

### Fixture file layout

```
apps/dashboard/src/lib/cockpit/fixtures/
  shared.ts            — common helpers (time anchors, persona)
  alex/
    greeting.ts        — AgentGreetingResponse
    metrics.ts         — AgentMetricsResponse (KPIs + ROI)
    mission.ts         — MissionAggregatorResponse
    activity.ts        — ActivityRow[]
    status.ts          — Alex status payload
  riley/
    greeting.ts
    metrics.ts
    mission.ts
    activity.ts        — promoted from lib/cockpit/riley/__fixtures__/riley-activity-fixtures.ts
    status.ts
    recommendations.ts — promoted from lib/cockpit/riley/__fixtures__/riley-recommendation-fixtures.ts
```

### Fixture promotion hygiene

Per [[feedback-fixtures-as-product-copy]]: the existing Riley `__fixtures__/` files are **promoted, not blindly moved**. Each fixture gets a sanitization pass before going into the canonical demo path:

- No fake PII that "looks real enough"
- No brittle frozen-test-clock timestamps — use stable seeded clock or relative-now
- No debug-style strings or internal jargon
- Vertical-correct copy (medspa per [[project-alex-vertical-medspa]]), not legacy "tours" / "SDR" wording
- Realistic numerical magnitudes for the vertical (e.g., medspa AOV ranges)
- Coherent scenario: Alex demonstrates lead follow-up → consultation booking → reactivation; Riley demonstrates marketing recommendation → budget/creative/action approval; shared metrics across surfaces must not contradict (e.g., KPI count matches activity row count for the same window)

Scrub diffs must be clearly visible in PR review.

### Bundle hygiene

Prefer scoped imports (`import { ALEX_GREETING_FIXTURE } from "@/lib/cockpit/fixtures/alex/greeting"`) over a single mega-barrel. With large activity/recommendation fixtures, a root barrel inflates client bundles unnecessarily. Per-domain barrels (`fixtures/greeting.ts`, `fixtures/metrics.ts`) are acceptable; one root barrel that re-exports everything is not.

### Conversion patterns

```ts
// Read hook example
export function useAgentGreeting(agentKey: AgentKey) {
  const mode = useDataMode();
  return useQuery({
    queryKey: ["agent-greeting", agentKey, mode],
    queryFn: async () => {
      if (mode === "demo") {
        return agentKey === "alex" ? ALEX_GREETING_FIXTURE : RILEY_GREETING_FIXTURE;
      }
      return await fetch(`/api/dashboard/agents/${agentKey}/greeting`).then((r) => r.json());
    },
  });
}

// Mutation hook example
export function useRecommendationAction() {
  const mode = useDataMode();
  return useMutation({
    mutationFn: async ({ recommendationId, action }) => {
      if (mode === "demo") {
        // Deterministic fixture-success — same TypeScript contract as live response.
        return { ok: true, recommendationId, action, persisted: false, outcome: null };
      }
      return await fetch(`/api/recommendations/${recommendationId}/${action}`, {
        method: "POST",
      }).then((r) => r.json());
    },
    // Invalidate mode-scoped keys only; demo mutations never invalidate live-only keys.
  });
}

// Server-side branch example
export async function fetchEnabledAgentsServer(): Promise<readonly AgentKey[]> {
  const mode = await getDataMode();
  if (mode === "demo") return ["alex", "riley"] as const;
  // ...existing live path unchanged...
}
```

---

## DevPanel UI

The existing `components/dev/dev-panel.tsx` (floating yellow button bottom-right) gets a two-row data-mode block above the nav links:

```
┌─────────────────────────────────┐
│  Data                           │
│  ◉ Live    ○ Demo               │
├─────────────────────────────────┤
│  Owner Home                     │
│  Alex                           │
│  ...                            │
└─────────────────────────────────┘
```

Radio-group semantics, not loose buttons: `role="radiogroup"` with `role="radio"` + `aria-checked` per option. The active mode's radio is `disabled` so clicking it does not call `useSetDataMode` again. Clicking the inactive radio calls `useSetDataMode(...)`, which writes the cookie and calls `router.refresh()`.

### Floating button visual

When `useDataMode() === "demo"`:

- Border + text → amber (existing design token, not hardcoded hex)
- Dot → amber
- Label → "DEV · DEMO"

Live mode keeps the existing green-dot yellow-pill — no visual debt for the default case.

### Visibility gate

```tsx
"use client";
export function DevPanel({ dataModeControlsAllowed }: { dataModeControlsAllowed: boolean }) {
  const { data: session } = useSession(); // existing pattern, retained
  if (!dataModeControlsAllowed) return null;
  if (session?.user?.id !== "dev-user") return null;
  // ...
}
```

`dataModeControlsAllowed` is computed server-side in the layout (above) and passed in as a new prop. Session lookup keeps the existing `useSession()` pattern. The client component never reads `process.env` for guard logic.

### Banner vs DevPanel: separate concerns

| Surface          | Audience                | Purpose                                 |
| ---------------- | ----------------------- | --------------------------------------- |
| `DevPanel`       | dev user only           | Control surface — writes the cookie     |
| `DataModeBanner` | everyone with a session | Visibility surface — shows current mode |

One cookie, two surfaces. Stakeholders viewing a preview deployment see the banner even though they can't toggle.

### Explicitly NOT included

- No keyboard shortcut (YAGNI; toggle is one click)
- No URL-param persistence (rejected during brainstorm)
- No analytics event on toggle (noise for a dev flag)
- No toast/snackbar on toggle (`router.refresh()` + banner is the feedback)

---

## Test plan

### Pure-function tests (`shared.test.ts`)

**`resolveDataMode`:**

| cookie value | allowed? | expected |
| ------------ | -------- | -------- |
| `"demo"`     | true     | `"demo"` |
| `"live"`     | true     | `"live"` |
| `undefined`  | true     | `"live"` |
| `"garbage"`  | true     | `"live"` |
| `""`         | true     | `"live"` |
| `"demo"`     | false    | `"live"` |
| `"live"`     | false    | `"live"` |

**`isFixtureModeAllowed` — safety-critical matrix:**

| `VERCEL_ENV`   | `ALLOW_FIXTURE_DATA_MODE` | `NODE_ENV`      | expected                                                    |
| -------------- | ------------------------- | --------------- | ----------------------------------------------------------- |
| `"production"` | `"true"`                  | `"production"`  | `false` ← **regression test for prod hard-deny precedence** |
| `"production"` | (unset)                   | `"production"`  | `false`                                                     |
| `"preview"`    | `"true"`                  | `"production"`  | `true`                                                      |
| `"preview"`    | (unset)                   | `"production"`  | `false`                                                     |
| (unset)        | `"true"`                  | `"production"`  | `true`                                                      |
| (unset)        | (unset)                   | `"production"`  | `false`                                                     |
| (unset)        | (unset)                   | `"development"` | `true`                                                      |

### Server-helper test (`server.test.ts`)

Test observable behavior, not implementation calls. Mock `cookies()`:

- cookie `sw.data-mode=demo` + env allows fixture → `getDataMode()` returns `"demo"`
- cookie missing → `"live"`
- env production + cookie `"demo"` → `"live"`

### Client-helper tests (`client.test.tsx`)

- `<DataModeProvider mode="demo">` + `useDataMode()` returns `"demo"`. Same for `"live"`.
- `useSetDataMode()` writes a cookie that **contains** `sw.data-mode=demo`, `path=/`, `max-age=`, `samesite=lax` (substring assertions, not full-string equality — jsdom cookie ordering is unreliable).
- When `window.location.protocol === "https:"`, the cookie also contains `secure` (one test per branch; covers the conditional flag).
- `router.refresh()` called exactly once per toggle.
- Hydration safety: provider's `value` equals `props.mode` on first render.

### Hook tests (one pattern per migrated hook)

Each migrated hook/server-fetch gets the same three-test sandwich:

```ts
describe("useFooBar", () => {
  it("calls fetch when mode is 'live'", async () => {
    renderHook(() => useFooBar(), { wrapper: providerWithMode("live") });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns fixture and does NOT call fetch when mode is 'demo'", async () => {
    renderHook(() => useFooBar(), { wrapper: providerWithMode("demo") });
    expect(fetchMock).not.toHaveBeenCalled();
    // assert fixture shape
  });

  it("uses a different react-query cache key per mode", () => {
    // Where hooks expose a query-key builder, assert builder("live") !== builder("demo").
    // Where they don't, assert behaviorally: toggling mode causes a new fetch/fixture
    // resolution rather than serving stale cached data.
  });
});
```

For mutation hooks, the "fetch not called in demo" assertion is the load-bearing regression test. Add two further assertions:

- Demo mutation's return value satisfies the **same TypeScript type** as the live response (compile-time assert).
- Demo mutation does **not** invalidate live-mode query keys.

### Component tests

- `DataModeBanner`: visible when mode=demo, absent when mode=live. No `role="alert"` (it's not an error).
- `DevPanel`:
  - Hidden when `dataModeControlsAllowed === false` regardless of session
  - Hidden when session user is not `dev-user` regardless of allowed flag
  - Visible only when both conditions met
  - Active mode's radio is `aria-checked="true" disabled`
  - Clicking the **disabled** (current-mode) radio does **not** call `useSetDataMode`
  - Clicking the inactive radio calls `useSetDataMode` with the right value
- `ToolsOverflow`: dropdown always rendered (regression test for filter removal)

### `fetchEnabledAgentsServer` test

- mode=demo → returns `["alex", "riley"]`; API mock not called
- mode=live → calls API and filters by enablement (existing test)
- mode=demo + API throws → still returns `["alex", "riley"]` (no API call attempted)

### Integration / smoke

Production hard-deny coverage at three layers: pure resolver, server wrapper, and one integration test.

- Cookie=demo on `VERCEL_ENV=production` simulated env → page renders live data, no banner (RSC integration test preferred; Playwright only if env simulation is already supported in the harness).
- Cookie=`"garbage"` → page renders live data, no banner (resolver fallback wired correctly).

### Coverage

Dashboard runs `40/35/40/40`, not the CLAUDE.md global ([[feedback-dashboard-coverage-threshold]]). The data-mode module exceeds this naturally because it's mostly pure functions — no need to write meaningless tests to hit the threshold.

---

## Migration plan

### PR sequencing (4 PRs, each independently shippable)

The system stays working after every PR — no flag-day cutover.

**PR-1: Infrastructure**

- Add `lib/data-mode/{shared,server,client}.ts` + tests
- Add `DataModeProvider` to `app/(auth)/layout.tsx`
- Add `components/layout/data-mode-banner.tsx` and mount it in `AppShell`. It renders only when mode=demo; since no toggle UI exists yet in this PR, it appears only if the cookie is manually set in non-production.
- Compute `dataModeControlsAllowed` server-side and pass to DevPanel as a new prop (toggle UI not added yet — prop is consumed in PR-4). **Preserve existing DevPanel props/behavior; this PR only adds `dataModeControlsAllowed`.**
- No fixtures changed, no hooks changed. Mode resolves to `"live"` until a consumer reads it.

**PR-2: Mercury migration + flag cleanup**

- Convert the 9 Mercury hook files (10+ callsites) to `useDataMode()`
- Include `mode` in every react-query key
- Mutation hooks: explicit demo branch + "fetch never called in demo" tests
- Simplify `ToolsOverflow` (delete per-surface filter)
- Delete `isMercuryToolLive` / `TOOLS_LIVE_ENV` / `ToolsNavId` from `lib/route-availability.ts`
- Delete five `NEXT_PUBLIC_*_LIVE` env vars from all env files, test stubs, setup files, and fixture/bootstrap utilities
- Replace per-page reports `FixtureModeBanner` with shared `DataModeBanner` (delete old file)

**PR-3: Cockpit fixtures + cockpit migration**

- Promote/sanitize Riley fixtures into `lib/cockpit/fixtures/riley/` with scrub diffs clearly visible in review
- Author Alex fixtures in `lib/cockpit/fixtures/alex/`
- Convert 8 cockpit read hooks + 1 mutation hook + `fetchEnabledAgentsServer`
- Update test imports from old `__fixtures__/` paths
- Delete `lib/cockpit/riley/__fixtures__/`

**PR-4: DevPanel UI**

- Add the radio-group toggle to `dev-panel.tsx`
- Render toggle only when `dataModeControlsAllowed === true` (the prop already exists from PR-1)
- Floating-button visual state (DEV vs DEV · DEMO) using existing design tokens
- ARIA: `role="radiogroup"` + `aria-checked` + `disabled` on matching mode
- DevPanel tests (visibility, ARIA, disabled-when-matching)

### Branch & worktree note

Per CLAUDE.md branch doctrine: **this spec doc itself lands on `main` via its own focused PR before any implementation branch is cut.** PR-1 through PR-4 each get their own implementation branch, consuming the spec from main. Don't bundle the spec into PR-1.

### Deletion inventory

| Path / symbol                                                                                                                                               | Removed in PR |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `NEXT_PUBLIC_CONTACTS_LIVE`, `NEXT_PUBLIC_AUTOMATIONS_LIVE`, `NEXT_PUBLIC_ACTIVITY_LIVE`, `NEXT_PUBLIC_REPORTS_LIVE`, `NEXT_PUBLIC_APPROVALS_LIVE` env vars | PR-2          |
| `isMercuryToolLive`, `TOOLS_LIVE_ENV`, `ToolsNavId` exports in `lib/route-availability.ts`                                                                  | PR-2          |
| `app/(auth)/(mercury)/reports/components/fixture-mode-banner.tsx`                                                                                           | PR-2          |
| `vi.stubEnv("NEXT_PUBLIC_*_LIVE", ...)` lines in test files, setup files, and shared test harnesses                                                         | PR-2          |
| `lib/cockpit/riley/__fixtures__/` (promoted → `lib/cockpit/fixtures/riley/`)                                                                                | PR-3          |
| (not removed — `isAgentHomeLinkLive` stays; different concern)                                                                                              | —             |

### Grep gates

Hard gates (CI-runnable; must return zero matches). **All gates scope to implementation paths and exclude `docs/**` so the spec doesn't trip its own gate** (`--glob '!docs/\*\*'`or explicit`apps/dashboard packages` scoping).

```bash
# After PR-2
rg "NEXT_PUBLIC_(CONTACTS|AUTOMATIONS|ACTIVITY|REPORTS|APPROVALS)_LIVE" apps/dashboard packages
rg "isMercuryToolLive|TOOLS_LIVE_ENV|ToolsNavId\b" apps/dashboard packages
rg "FixtureModeBanner|fixture-mode-banner" apps/dashboard packages

# After PR-3
rg "cockpit/riley/__fixtures__" apps/dashboard
rg "__fixtures__/riley-" apps/dashboard/src   # catches relative imports
```

Boundary gate (no `"use client"` file imports the server module). Use `xargs -r` (GNU) or `xargs` with `[ -n "$line" ]` guarding for BSD/macOS compatibility:

```bash
# Must show 0 matches in files that begin with "use client"
rg -l "@/lib/data-mode/server" apps/dashboard/src \
  | xargs -I {} -r sh -c 'head -1 "{}" | grep -q "use client" && echo "BOUNDARY VIOLATION: {}"'

# macOS/BSD-compatible fallback (no -r flag on BSD xargs):
rg -l "@/lib/data-mode/server" apps/dashboard/src | while read -r f; do
  [ -n "$f" ] && head -1 "$f" | grep -q "use client" && echo "BOUNDARY VIOLATION: $f"
done
```

Informational counts (print and review; not hard pass/fail unless tied to a migrated-file checklist):

```bash
rg -c "useDataMode|getDataMode" apps/dashboard/src --type ts --type tsx
```

Add `scripts/check-data-mode-migration.sh` so these are runnable locally and in CI.

### Per-PR verification baseline

After every PR, before requesting review:

```bash
pnpm --filter @switchboard/dashboard typecheck
pnpm --filter @switchboard/dashboard build          # catches .js-extension regressions per [[feedback-dashboard-no-js-on-any-import]]
pnpm --filter @switchboard/dashboard test
bash scripts/check-data-mode-migration.sh
```

All four must pass green before the PR is marked ready.

### Rollback posture

Reverts happen in **reverse dependency order**: PR-4 → PR-3 → PR-2 → PR-1. PR-1 is only independently revertable before PR-2 lands; after that, dependent PRs must be reverted first.

Production safety net: even with bugs in the migration, `isFixtureModeAllowed` hard-denies fixture mode on Vercel production. No cookie can downgrade prod. The worst-case prod regression would be a wrong fixture leaking into the live path — caught by the "live mode never returns FIXTURE_RESPONSE" tests.

---

## Out of scope

- **Backend changes.** `apps/api` is untouched. Toggle is dashboard-only.
- **New database tables.** Cookie state is per-browser; nothing persists server-side.
- **Production dependency on new env vars.** `ALLOW_FIXTURE_DATA_MODE` may exist for preview/staging, but production hard-denies before honoring it.
- **Agent-home pipeline tile changes.** `isAgentHomeLinkLive` and the `AgentHomeLink` union stay. Different domain (route-existence gating, not data-mode gating).
- **/operator route changes.** Tier 2 legacy-audit candidate; separate cleanup.
- **Cockpit page component refactors.** Page components stay dumb; the fixture/live decision is fully inside the hooks.

---

## References (project memory)

- [[feedback-next-server-client-module-split]] — three-file split rule for any helper with server-only deps
- [[feedback-prod-safety-node-env-insufficient]] — `NODE_ENV` alone insufficient on Vercel; hard-denies precede opt-ins; client-side `process.env` is different
- [[feedback-demo-mode-mutations-must-branch-explicitly]] — every `useMutation` needs an explicit demo branch; response shape must match live contract; no live-key invalidation in demo
- [[feedback-fixtures-as-product-copy]] — test fixtures get scrubbed before becoming demo product copy
- [[feedback-modes-not-knobs]] — opinionated single toggle, no per-surface knobs
- [[feedback-ship-clean-not-followup]] — no deferred TODOs for demo mutations or safety guards
- [[feedback-dashboard-coverage-threshold]] — dashboard runs 40/35/40/40 (not the global CLAUDE.md threshold)
- [[project-alex-vertical-medspa]] — canonical vertical for fixture copy (medspa, not legacy "tours" / "SDR")
- [[reference-deploy-host-vercel]] — Vercel hosting context for `VERCEL_ENV` guard
