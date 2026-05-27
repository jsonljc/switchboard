# Reports Live-Mode Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing `useReportData` hook to real backend data by adding the missing Next.js proxy routes that bridge the dashboard hook to the already-implemented Fastify `/api/dashboard/reports` and `/api/dashboard/reports/refresh` endpoints.

**Architecture:** Dashboard-only PR. The Fastify backend (`apps/api/src/routes/dashboard-reports.ts`) already implements both endpoints with cache-read-or-compute (GET) and force-recompute (POST) semantics. The dashboard hook (`apps/dashboard/src/app/(auth)/(mercury)/reports/hooks/use-report-data.ts`) already calls `/api/dashboard/reports?window=...` and `/api/dashboard/reports/refresh?window=...` — but the Next.js routes at those paths do not exist, so when `NEXT_PUBLIC_REPORTS_LIVE=true` the fetch resolves to a Next.js 404. This plan adds two small Next.js proxy routes plus two methods on `SwitchboardDashboardClient` to forward the calls to Fastify. No schema, no UI, no fixture changes.

**Tech Stack:** Next.js 14 App Router (Route Handlers), Vitest + jsdom, `@switchboard/schemas` (`ReportDataV1`, `ReportWindow`).

**Prerequisites the engineer must read before starting:**

- This plan's sibling spec is implicit — there is no separate spec file. The contract is fully defined by `ReportDataV1` in `packages/schemas/src/reports/v1.ts` and the Fastify route in `apps/api/src/routes/dashboard-reports.ts`. Read both before starting.
- The hook this wires: `apps/dashboard/src/app/(auth)/(mercury)/reports/hooks/use-report-data.ts`.
- The mirror routes to copy patterns from: `apps/dashboard/src/app/api/dashboard/activity/route.ts` and its test at `apps/dashboard/src/app/api/dashboard/activity/__tests__/route.test.ts`.
- `CLAUDE.md` (ESM `.js` extensions, no `console.log`, no `any`, no premature abstractions).
- Project memory note `feedback_dashboard_build_not_in_ci.md`: CI does NOT run `next build`. Run `pnpm --filter @switchboard/dashboard build` locally before opening the PR.

**Out of scope:**

- Any change to the Fastify route, the period-rollup service, or the `PrismaReportCacheStore`. They already work.
- Any UI change. The hook, fixtures, page, components are untouched.
- Flipping `NEXT_PUBLIC_REPORTS_LIVE` in any deploy environment. That happens in a separate config PR after this lands, and gated on a connected Meta Ads `Connection` per `memory/project_reports_is_launch_priority.md`.
- Smoothing the live-mode error surface (current behavior: `useQuery.error` propagates as a render-time error; UI shows nothing useful). The hook's UX on failure is its own concern; **this plan does not redesign it**. The acceptance test only asserts the network call shape and that `error` is surfaced; we leave UX polish to a follow-up if it's needed after the first live trial.

**Working directory:** Cut a fresh worktree from `origin/main` per `CLAUDE.md` / `superpowers:using-git-worktrees`. Recommended path: `/Users/jasonli/switchboard/.worktrees/reports-live-mode` on branch `feat/reports-live-mode-wiring`. Run `pnpm worktree:init` after creating it.

**Error-handling convention (binding):** Every route handler in this plan uses the **same session/error pattern as `apps/dashboard/src/app/api/dashboard/activity/route.ts`** — no second proxy-error convention is introduced. The activity route flattens upstream status to either 401 (when the thrown error is `Unauthorized`) or 500 (everything else), keeping the upstream `error` message via `proxyError`. This plan inherits that flattening intentionally. If a future PR needs richer status passthrough, it ports the whole `proxyError` helper, not this single route.

---

## Pre-flight: verify environment

- [ ] **Step 1: Create the worktree (skip if already in it)**

```bash
git fetch origin main
git worktree add -b feat/reports-live-mode-wiring \
  /Users/jasonli/switchboard/.worktrees/reports-live-mode origin/main
cd /Users/jasonli/switchboard/.worktrees/reports-live-mode
pnpm worktree:init
```

Expected: worktree created, `.env` copied, deps installed.

- [ ] **Step 2: Confirm worktree + branch**

```bash
git rev-parse --show-toplevel
git branch --show-current
```

Expected:

```
/Users/jasonli/switchboard/.worktrees/reports-live-mode
feat/reports-live-mode-wiring
```

- [ ] **Step 3: Confirm starting tree is clean and baseline passes**

```bash
git status --short
pnpm typecheck
pnpm --filter @switchboard/dashboard test
```

Expected: clean status, typecheck passes, dashboard tests pass. If typecheck fails with missing exports from `@switchboard/schemas` / `@switchboard/db` / `@switchboard/core`, run `pnpm reset` first (per `CLAUDE.md`).

- [ ] **Step 4: Confirm the Fastify backend really exists and the gap is what we think**

```bash
grep -n '/api/dashboard/reports' apps/api/src/routes/dashboard-reports.ts
test ! -e 'apps/dashboard/src/app/api/dashboard/reports/route.ts' && echo 'GAP CONFIRMED: dashboard proxy missing'
```

Expected: two matches in the Fastify file (`GET` and `POST /refresh`), and the `GAP CONFIRMED` line. If either side disagrees, stop and re-read the audit before continuing — the plan assumes this exact split.

---

## Task 1: Add `getReport` and `refreshReport` to `SwitchboardDashboardClient`

**Files:**

- Modify: `apps/dashboard/src/lib/api-client/dashboard.ts`
- Create: `apps/dashboard/src/lib/api-client/__tests__/dashboard-reports.test.ts`

**Why this is first:** Layer-up step. The Next.js routes in Task 2/3 call these methods; writing them now means Task 2/3 tests can mock a single function instead of stubbing `fetch`.

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/lib/api-client/__tests__/dashboard-reports.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SwitchboardDashboardClient } from "../dashboard.js";
// Reuse production-shaped fixtures so this test never teaches a fake
// ReportDataV1 contract. `goodFixture` = THIS MONTH, `quietFixture` = THIS WEEK
// (per FIXTURES_BY_WINDOW). Mixing them keeps each test honest about which
// window it's exercising.
import { goodFixture, quietFixture } from "@/app/(auth)/(mercury)/reports/fixtures";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SwitchboardDashboardClient.getReport", () => {
  it("GETs /api/dashboard/reports with the window param URL-encoded", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => goodFixture,
    });

    const client = new SwitchboardDashboardClient("http://api.test", "key-123");
    const out = await client.getReport("THIS MONTH");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api.test/api/dashboard/reports?window=THIS+MONTH");
    expect(init).toMatchObject({
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer key-123",
      },
    });
    expect(out).toEqual(goodFixture);
  });

  it("propagates upstream error body", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: "Report dependencies not available" }),
    });

    const client = new SwitchboardDashboardClient("http://api.test", "key-123");

    await expect(client.getReport("THIS MONTH")).rejects.toThrow(
      "Report dependencies not available",
    );
  });
});

describe("SwitchboardDashboardClient.refreshReport", () => {
  it("POSTs /api/dashboard/reports/refresh and returns the recomputed payload", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => quietFixture,
    });

    const client = new SwitchboardDashboardClient("http://api.test", "key-123");
    const out = await client.refreshReport("THIS WEEK");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api.test/api/dashboard/reports/refresh?window=THIS+WEEK");
    expect(init).toMatchObject({ method: "POST" });
    expect(out).toEqual(quietFixture);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @switchboard/dashboard test -- dashboard-reports.test
```

Expected: FAIL with `client.getReport is not a function` (or similar — the methods don't exist yet).

- [ ] **Step 3: Add the methods to the client**

Edit `apps/dashboard/src/lib/api-client/dashboard.ts`. Add the import for `ReportDataV1` and `ReportWindow` at the top (next to existing schema imports) and append two methods next to `getActivity`:

```ts
import type { ReportDataV1, ReportWindow } from "@switchboard/schemas";

// ... inside class SwitchboardDashboardClient { ... }

  // ── Reports (Mercury /reports) ──

  async getReport(window: ReportWindow): Promise<ReportDataV1> {
    const params = new URLSearchParams({ window });
    return this.request<ReportDataV1>(`/api/dashboard/reports?${params.toString()}`);
  }

  async refreshReport(window: ReportWindow): Promise<ReportDataV1> {
    const params = new URLSearchParams({ window });
    return this.request<ReportDataV1>(
      `/api/dashboard/reports/refresh?${params.toString()}`,
      { method: "POST" },
    );
  }
```

The `request` helper (defined on `SwitchboardClientCore`) already attaches the `Authorization: Bearer ${apiKey}` header and throws on non-2xx with the upstream `error` field. Match the existing `getActivity` style exactly.

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @switchboard/dashboard test -- dashboard-reports.test
```

Expected: PASS.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/lib/api-client/dashboard.ts \
        apps/dashboard/src/lib/api-client/__tests__/dashboard-reports.test.ts
git commit -m "feat(dashboard): add getReport + refreshReport to SwitchboardDashboardClient"
```

---

## Task 2: Next.js GET proxy at `/api/dashboard/reports`

**Files:**

- Create: `apps/dashboard/src/app/api/dashboard/reports/route.ts`
- Create: `apps/dashboard/src/app/api/dashboard/reports/__tests__/route.test.ts`

**Why this shape:** Mirrors `apps/dashboard/src/app/api/dashboard/activity/route.ts` exactly. The route is a thin proxy: read `window` from the query string, validate it's one of the three accepted values, call the client, return the JSON. Validation is duplicated with Fastify on purpose — the Next.js layer fails fast with a clear 400 instead of letting an invalid value cross the network.

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/app/api/dashboard/reports/__tests__/route.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/get-api-client", () => ({ getApiClient: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireSession: vi.fn().mockResolvedValue(undefined),
}));

import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { GET } from "../route.js";
import { goodFixture } from "@/app/(auth)/(mercury)/reports/fixtures";

function mkRequest(url: string) {
  const u = new URL(url);
  return { nextUrl: u } as unknown as Parameters<typeof GET>[0];
}

describe("reports dashboard proxy — GET", () => {
  it("forwards window to client.getReport and returns the payload", async () => {
    const getReport = vi.fn().mockResolvedValue(goodFixture);
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ getReport });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const res = await GET(mkRequest("http://test/api/dashboard/reports?window=THIS+MONTH"));

    expect(getReport).toHaveBeenCalledWith("THIS MONTH");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(goodFixture);
  });

  it("returns 400 when window param is missing", async () => {
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      getReport: vi.fn(),
    });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const res = await GET(mkRequest("http://test/api/dashboard/reports"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/window/i) });
  });

  it("returns 400 when window value is not in the allowed set", async () => {
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      getReport: vi.fn(),
    });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const res = await GET(mkRequest("http://test/api/dashboard/reports?window=YESTERDAY"));
    expect(res.status).toBe(400);
  });

  it("returns 401 when session is missing", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Unauthorized"),
    );
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      getReport: vi.fn(),
    });

    const res = await GET(mkRequest("http://test/api/dashboard/reports?window=THIS+MONTH"));
    expect(res.status).toBe(401);
  });

  it("returns 500 surfacing the upstream error message on backend failure", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      getReport: vi.fn().mockRejectedValue(new Error("Report dependencies not available")),
    });

    const res = await GET(mkRequest("http://test/api/dashboard/reports?window=THIS+MONTH"));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({
      error: "Report dependencies not available",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @switchboard/dashboard test -- 'app/api/dashboard/reports/__tests__/route.test'
```

Expected: FAIL with module-not-found on `../route.js` — the file doesn't exist yet.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/dashboard/src/app/api/dashboard/reports/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { REPORT_WINDOWS, type ReportWindow } from "@switchboard/schemas";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { proxyError } from "@/lib/proxy-error";

const ALLOWED_WINDOWS: ReadonlySet<ReportWindow> = new Set(REPORT_WINDOWS);

export async function GET(req: NextRequest) {
  try {
    await requireSession();
    const raw = req.nextUrl.searchParams.get("window");
    if (!raw || !ALLOWED_WINDOWS.has(raw as ReportWindow)) {
      return NextResponse.json(
        { error: "Invalid window. Use THIS WEEK, THIS MONTH, or THIS QUARTER." },
        { status: 400 },
      );
    }
    const client = await getApiClient();
    const data = await client.getReport(raw as ReportWindow);
    return NextResponse.json(data);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @switchboard/dashboard test -- 'app/api/dashboard/reports/__tests__/route.test'
```

Expected: all five cases PASS.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/app/api/dashboard/reports/route.ts \
        apps/dashboard/src/app/api/dashboard/reports/__tests__/route.test.ts
git commit -m "feat(dashboard): add /api/dashboard/reports GET proxy"
```

---

## Task 3: Next.js POST proxy at `/api/dashboard/reports/refresh`

**Files:**

- Create: `apps/dashboard/src/app/api/dashboard/reports/refresh/route.ts`
- Create: `apps/dashboard/src/app/api/dashboard/reports/refresh/__tests__/route.test.ts`

**Why a separate path:** The hook in `use-report-data.ts:38` already calls `/api/dashboard/reports/refresh?window=...` with `method: "POST"`. Co-locating with `/reports/route.ts` (using a `POST` export on the same route) would require changing the hook; keeping the path the hook already targets is the smaller change.

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/app/api/dashboard/reports/refresh/__tests__/route.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/get-api-client", () => ({ getApiClient: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireSession: vi.fn().mockResolvedValue(undefined),
}));

import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { POST } from "../route.js";
import { quietFixture } from "@/app/(auth)/(mercury)/reports/fixtures";

function mkRequest(url: string) {
  const u = new URL(url);
  return { nextUrl: u } as unknown as Parameters<typeof POST>[0];
}

describe("reports refresh dashboard proxy — POST", () => {
  it("forwards window to client.refreshReport and returns the recomputed payload", async () => {
    // quietFixture is the THIS WEEK fixture per FIXTURES_BY_WINDOW.
    const refreshReport = vi.fn().mockResolvedValue(quietFixture);
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ refreshReport });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const res = await POST(mkRequest("http://test/api/dashboard/reports/refresh?window=THIS+WEEK"));

    expect(refreshReport).toHaveBeenCalledWith("THIS WEEK");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(quietFixture);
  });

  it("returns 400 when window param is missing or invalid", async () => {
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      refreshReport: vi.fn(),
    });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const r1 = await POST(mkRequest("http://test/api/dashboard/reports/refresh"));
    const r2 = await POST(mkRequest("http://test/api/dashboard/reports/refresh?window=YESTERDAY"));
    expect(r1.status).toBe(400);
    expect(r2.status).toBe(400);
  });

  it("returns 401 when session is missing", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Unauthorized"),
    );
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      refreshReport: vi.fn(),
    });

    const res = await POST(
      mkRequest("http://test/api/dashboard/reports/refresh?window=THIS+MONTH"),
    );
    expect(res.status).toBe(401);
  });

  it("returns 500 surfacing the upstream error message on backend failure", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      refreshReport: vi.fn().mockRejectedValue(new Error("Report dependencies not available")),
    });

    const res = await POST(
      mkRequest("http://test/api/dashboard/reports/refresh?window=THIS+MONTH"),
    );
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({
      error: "Report dependencies not available",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @switchboard/dashboard test -- 'app/api/dashboard/reports/refresh/__tests__/route.test'
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/dashboard/src/app/api/dashboard/reports/refresh/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { REPORT_WINDOWS, type ReportWindow } from "@switchboard/schemas";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { proxyError } from "@/lib/proxy-error";

const ALLOWED_WINDOWS: ReadonlySet<ReportWindow> = new Set(REPORT_WINDOWS);

export async function POST(req: NextRequest) {
  try {
    await requireSession();
    const raw = req.nextUrl.searchParams.get("window");
    if (!raw || !ALLOWED_WINDOWS.has(raw as ReportWindow)) {
      return NextResponse.json(
        { error: "Invalid window. Use THIS WEEK, THIS MONTH, or THIS QUARTER." },
        { status: 400 },
      );
    }
    const client = await getApiClient();
    const data = await client.refreshReport(raw as ReportWindow);
    return NextResponse.json(data);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @switchboard/dashboard test -- 'app/api/dashboard/reports/refresh/__tests__/route.test'
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/api/dashboard/reports/refresh/route.ts \
        apps/dashboard/src/app/api/dashboard/reports/refresh/__tests__/route.test.ts
git commit -m "feat(dashboard): add /api/dashboard/reports/refresh POST proxy"
```

---

## Task 4: Update the `use-report-data` PR-R1 fixture-only test to reflect live wiring

**Files:**

- Modify: `apps/dashboard/src/app/(auth)/(mercury)/reports/hooks/__tests__/use-report-data.test.tsx`

**Why:** The existing test (named per its body, roughly "when NEXT_PUBLIC_REPORTS_LIVE is 'true', the hook still returns fixture in PR-R1") was correct at PR-R1 time because the API route didn't exist. Once Tasks 1–3 land, that assertion is wrong: when the flag is set at module load, the hook now hits the real proxy. We change the test to assert the **wiring contract**, not to assert frozen-behavior.

- [ ] **Step 1: Read the current test to understand its harness**

```bash
sed -n '1,120p' apps/dashboard/src/app/(auth)/(mercury)/reports/hooks/__tests__/use-report-data.test.tsx
```

Note the import-time `isLive` capture in `use-report-data.ts:20` — the hook reads the env var **once at module load**. Re-importing the module mid-test is the only way to flip `isLive`; the test file likely already does this. Mirror that pattern.

- [ ] **Step 2: Replace the "still returns fixture in PR-R1" case with two cases**

Find the test whose body comment says "still returns fixture in PR-R1" (near line 61). Replace it with the following two test cases:

```tsx
it("calls /api/dashboard/reports with the window param when NEXT_PUBLIC_REPORTS_LIVE='true'", async () => {
  process.env.NEXT_PUBLIC_REPORTS_LIVE = "true";
  vi.resetModules();
  const { useReportData } = await import("../use-report-data");

  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(JSON.stringify(goodFixture), { status: 200 }));

  const { result } = renderHook(() => useReportData("THIS MONTH"), { wrapper });

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(fetchMock).toHaveBeenCalledWith("/api/dashboard/reports?window=THIS%20MONTH");
  await waitFor(() => expect(result.current.data).toEqual(goodFixture));
});

it("surfaces fetch errors as `error` (no silent fallback to fixtures in live mode)", async () => {
  process.env.NEXT_PUBLIC_REPORTS_LIVE = "true";
  vi.resetModules();
  const { useReportData } = await import("../use-report-data");

  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("nope", { status: 500 }));

  const { result } = renderHook(() => useReportData("THIS MONTH"), { wrapper });

  await waitFor(() => expect(result.current.error).not.toBeNull());
  expect(result.current.data).toBeUndefined();
});
```

Notes:

- The exact `URLSearchParams` serialization of `"THIS MONTH"` is `THIS+MONTH` if you pass it via `URLSearchParams`, but the hook does `encodeURIComponent("THIS MONTH")` which yields `THIS%20MONTH`. The proxy accepts both (Next.js decodes them identically into `req.nextUrl.searchParams.get("window")`). Assert against the hook's actual encoding (`%20`), not what feels symmetric with the client's encoding.
- Re-asserting fixture fallback behavior with the flag OFF is already covered by an existing test in the file; do not duplicate it.

- [ ] **Step 3: Run the test to verify it passes**

```bash
pnpm --filter @switchboard/dashboard test -- 'reports/hooks/__tests__/use-report-data'
```

Expected: all cases (including pre-existing fixture-mode cases) PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/app/(auth)/(mercury)/reports/hooks/__tests__/use-report-data.test.tsx
git commit -m "test(reports): assert live wiring instead of pinning fixture-only PR-R1 behavior"
```

---

## Task 5: Final verification

- [ ] **Step 1: Full dashboard test pass**

```bash
pnpm --filter @switchboard/dashboard test
```

Expected: all pass. No new failures.

- [ ] **Step 2: Full typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Lint**

```bash
pnpm lint
```

Expected: clean. Pre-existing warnings in unrelated files are fine.

- [ ] **Step 4: Local `next build` (CI does not run this)**

Per `memory/feedback_dashboard_build_not_in_ci.md`:

```bash
pnpm --filter @switchboard/dashboard build
```

Expected: build succeeds. Catches `.js`-extension import regressions that lint+typecheck miss.

- [ ] **Step 5: Manual smoke test with the flag on (optional but recommended)**

This step requires Postgres + the Fastify API running locally. If you do not have a Meta Ads `Connection` for an org, the route will still respond — it falls back to the `null` insights provider and returns a report with empty/zero ad data. That's a valid response.

```bash
# In one shell:
pnpm db:migrate
pnpm --filter @switchboard/api dev
# In another:
NEXT_PUBLIC_REPORTS_LIVE=true pnpm --filter @switchboard/dashboard dev
```

Then open `http://localhost:3002/reports`, sign in, and:

1. Verify the page loads without a render-time error.
2. Verify a `200` `GET /api/dashboard/reports?window=THIS%20MONTH` appears in the Network panel.
3. Click "Refresh" (if the UI exposes it); verify a `200` `POST /api/dashboard/reports/refresh?window=THIS%20MONTH` follows.
4. Stop the Fastify API and reload; verify the page now shows an error (it should — that's the honest failure mode we want).

Restart the Fastify API before closing this step.

- [ ] **Step 6: Verify the live flag was not changed**

```bash
git fetch origin main
git diff origin/main -- '**/.env*' '**/vercel.json' '**/render.yaml' '**/railway.json' \
  apps/dashboard/.env.example apps/dashboard/next.config.mjs
git diff origin/main | grep -i 'NEXT_PUBLIC_REPORTS_LIVE' || echo 'OK: no flag changes'
```

Expected: empty file-level diff in deploy configs, and `OK: no flag changes` (or only test-file references to the flag, no `.env*` / deploy-config mentions). This proves the PR ships wiring, not the launch flip.

- [ ] **Step 7: Open the PR**

```bash
git push -u origin feat/reports-live-mode-wiring
gh pr create --title "feat(reports): add dashboard proxy routes for live report data" --body "$(cat <<'EOF'
## Summary
- Adds the missing Next.js proxy routes at `/api/dashboard/reports` (GET) and `/api/dashboard/reports/refresh` (POST). The Fastify backend at `apps/api/src/routes/dashboard-reports.ts` already implements both endpoints — this PR is just the dashboard-side bridge so the existing `useReportData` hook can reach them.
- Adds `getReport(window)` and `refreshReport(window)` to `SwitchboardDashboardClient`.
- Updates the `use-report-data` test that previously asserted fixture-only behavior in PR-R1; now asserts the live wiring shape.

## What does NOT change
- Fastify route — already shipped.
- Hook signature, fixtures, components, page — already shipped.
- The `NEXT_PUBLIC_REPORTS_LIVE` flag — stays OFF in production. Flipping it is a separate config PR after launch, per `memory/project_reports_is_launch_priority.md`.

## Test plan
- [x] `pnpm --filter @switchboard/dashboard test` — all green
- [x] `pnpm typecheck` — clean
- [x] `pnpm lint` — clean
- [x] `pnpm --filter @switchboard/dashboard build` — succeeds
- [x] Manual smoke on `localhost:3002` with the flag on — `GET` and `POST` both return 200 against a running Fastify API

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Acceptance criteria

Before this PR is mergeable, all of the following must be demonstrably true:

1. **`GET /api/dashboard/reports?window=<valid>`** returns 200 with the JSON payload forwarded verbatim from Fastify.
2. **`POST /api/dashboard/reports/refresh?window=<valid>`** is forwarded to `client.refreshReport(window)`, which the unit test pins. Whether Fastify actually recomputes (vs. serves cached) is owned by `apps/api/src/routes/dashboard-reports.ts:168-200` and is verified by the optional manual smoke step, not by this PR's unit tests.
3. **Invalid `window` values** at either route return 400 with a clear error message.
4. **Missing session** at either route returns 401.
5. **`SwitchboardDashboardClient.getReport` and `.refreshReport`** are typed against `ReportWindow` and `ReportDataV1` from `@switchboard/schemas`, with no `any` casts.
6. **The hook test no longer asserts "still returns fixture in PR-R1"** for the flag-on path. It asserts the real fetch URL and surfaces fetch errors honestly.
7. **`NEXT_PUBLIC_REPORTS_LIVE` is unchanged in any deploy env.** This PR ships the wiring; the flag flip is a separate ops change.

---

## Out-of-scope follow-ups (for after this lands)

- **MANDATORY follow-up — PR-R2: Reports live-mode failure state.** When this PR's proxy returns 500 (Fastify down, `app.reportCacheStore` missing, transient Meta API error), the existing hook surfaces `error` and the page renders nothing useful. Once `NEXT_PUBLIC_REPORTS_LIVE=true` is flipped in production, this becomes operator-facing. Open a follow-up issue **at the same time as this PR merges** that defines: (a) a calm "Reports temporarily unavailable" placeholder, (b) a retry affordance, (c) optionally surfacing the previous cached payload with a "stale" banner, (d) explicit rule that live-mode must never silently fall back to fixtures. This must ship **before** the launch flag flip — it is not optional polish. The reason it is not absorbed into this PR is reviewer cognitive load, not priority.
- **Connection requirement (pre-launch ops, not engineering).** Per `memory/project_reports_is_launch_priority.md`, going live needs a connected Meta Ads `Connection`. Today, with no Connection, Fastify returns a payload with empty insights (not an error). Pre-launch ops should add a Connection-state check before flipping the flag, or the page will go live empty.
- **Caching headers (post-launch).** The Next.js proxy emits no `Cache-Control` headers. Fastify already controls cache via `ReportCacheStore` + TTL. If we later want CDN caching of the GET response, add headers in a separate PR.
