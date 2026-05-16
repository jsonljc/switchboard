# Legacy Route + `useAgentFirstNav` Retirement (D4 + D5) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-10-legacy-route-and-flag-retirement-d4-d5-design.md`

**Goal:** Pre-launch cleanup — delete every legacy-nav (auth) route, every component/hook used only by those routes, the `OwnerShell`/`OwnerTabs` chrome, and the now-vestigial `OrganizationConfig.useAgentFirstNav` flag, in a single coordinated PR.

**Architecture:** Mostly deletions. The one structural code change is splitting `AppShell` into a two-branch model (editorial vs chrome-hidden) and decoupling visual-chrome from onboarding-gating via two distinct path lists (`CHROME_HIDDEN_PATHS` for chrome, `ONBOARDING_EXEMPT_PATHS` for gating). Sign-out functionality migrates from the deleted `/me` to `/settings/account` as a prerequisite.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind, Prisma, NextAuth.js, TanStack React Query, Vitest, pnpm + Turborepo.

**Branch:** Implementation lands on a fresh `feat/d4-d5-legacy-retirement` branch off `origin/main`. The `docs/d4-d5-legacy-retirement-spec` branch carries only the spec and is its own PR.

---

## Phase 0 — Branch setup

### Task 0: Create implementation branch off origin/main

**Files:** None (git only)

- [ ] **Step 1: Verify spec is committed and on `docs/d4-d5-legacy-retirement-spec`**

```bash
git fetch origin main --quiet
git log --oneline docs/d4-d5-legacy-retirement-spec | head -3
```

Expected: commits exist on the docs branch including the latest spec polish.

- [ ] **Step 2: Branch off `origin/main` for the implementation**

```bash
git fetch origin main --quiet
git checkout -b feat/d4-d5-legacy-retirement origin/main
git status --short
git branch --show-current
```

Expected: clean working tree, branch is `feat/d4-d5-legacy-retirement`, tracking `origin/main`.

- [ ] **Step 3: Run `pnpm worktree:init` if you're in a worktree (skip if in main checkout)**

Run: `pnpm worktree:init` (idempotent; copies `.env`, kills stale dev-port listeners, runs `pnpm db:migrate` if Postgres is reachable).

If you're in the main checkout (not a worktree), skip this step.

- [ ] **Step 4: Baseline build to confirm starting state is green**

```bash
pnpm reset
pnpm typecheck
pnpm lint
pnpm test
```

Expected: all four pass. If anything fails on this baseline, stop and investigate before making changes — failures here are not yours.

If `pnpm test` reports the known db integrity flake (`prisma-work-trace-store-integrity` / `prisma-ledger-storage` / `prisma-greeting-signal-store` per memory `feedback_db_integrity_tests_pg_advisory_lock`), record the failures and proceed — they reproduce on baseline and aren't blockers.

---

## Phase 1 — Sign-out migration prep

### Task 1: Add sign-out button to `/settings/account`

**Files:**

- Modify: `apps/dashboard/src/app/(auth)/settings/account/page.tsx`

**Why this comes first:** `/me/page.tsx` is the only sign-out surface in the dashboard today. Deleting `/me` (Phase 3) without first migrating sign-out would ship a dashboard with no operator sign-out path. The button must exist at `/settings/account` before `/me` is removed.

**Pattern to mirror:** `/me/page.tsx` lines 78–92 use `useQueryClient()` (from `@tanstack/react-query`) + `signOut(queryClient)` (from `@/lib/sign-out`). Reuse the **same** `useQueryClient()` hook to get the existing app-wide QueryClient. **Do not** instantiate a new `QueryClient` — that would create a detached cache.

- [ ] **Step 1: Read the current `/settings/account/page.tsx` end-of-page area**

Read `apps/dashboard/src/app/(auth)/settings/account/page.tsx` lines 1–50 (imports + hooks) and lines 200–231 (the existing JSX tail with `<TabsContent value="boundaries">` block) to see where the new "Account section" (sign-out) belongs.

- [ ] **Step 2: Add the imports**

Open `apps/dashboard/src/app/(auth)/settings/account/page.tsx`. The imports section already has `import { useQueryClient } from "@tanstack/react-query"`-equivalent need; check whether `useQueryClient` is already imported (it isn't, since the page only uses `useToast`). Add these two imports near the existing react-query / sign-out imports area:

```ts
import { useQueryClient } from "@tanstack/react-query";
import { signOut } from "@/lib/sign-out";
```

Confirm `signOut` is **not** already imported (it isn't today; verified by grep at spec time).

- [ ] **Step 3: Add the `useQueryClient` hook call inside the component**

Inside `SettingsAccountPage`, near the top of the component (after `const { status } = useSession();`), add:

```ts
const queryClient = useQueryClient();
```

- [ ] **Step 4: Add the Sign Out button to the JSX**

The page currently has a Tabs structure with `general` and `boundaries` content. Sign-out belongs in the General tab as its own section after the existing "Save Changes" button — it's an account-level operator action.

Locate the end of the `general` `<TabsContent>` block (the `<Button onClick={handleSaveGeneral} size="sm">Save Changes</Button>` line, around line 220 — verify exact line at write time). After the closing `</CardContent></Card>` of the existing General card, before the closing `</TabsContent>`, insert a new card containing the sign-out button:

```tsx
<Card>
  <CardContent className="pt-6 space-y-4">
    <div className="space-y-1">
      <h3 className="text-[15px] font-semibold tracking-tight text-foreground">Session</h3>
      <p className="text-[13px] text-muted-foreground">
        Sign out of this device. You can sign back in any time.
      </p>
    </div>
    <Button type="button" variant="outline" size="sm" onClick={() => signOut(queryClient)}>
      Sign out
    </Button>
  </CardContent>
</Card>
```

`Card`, `CardContent`, `Button` are already imported in this file — verify before saving.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: PASS.

- [ ] **Step 6: Run the dashboard tests for /settings/account if any**

```bash
pnpm --filter @switchboard/dashboard test -- --run src/app/\\(auth\\)/settings/account 2>&1 | tail -20
```

Expected: tests pass (or report "no tests found", which is fine — there is no existing settings/account test file at spec time).

- [ ] **Step 7: Manual smoke (interactive — operator must run dev server)**

If you can run `pnpm dev` in this session: navigate to `http://localhost:3002/settings/account`, confirm the new "Session" card with a "Sign out" button is rendered in the General tab, click it, and verify NextAuth signs you out and the React Query cache is cleared (you'll be redirected to `/login`).

If you can't run dev (e.g., no Postgres locally), skip the live smoke and rely on Phase 6 final smoke.

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/settings/account/page.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): add sign-out button to /settings/account

Mirrors the useQueryClient() + signOut(queryClient) pattern from
/me/page.tsx. Required prerequisite for deleting /me in this slice
— /me currently owns the only sign-out affordance in the dashboard.

Spec: docs/superpowers/specs/2026-05-10-legacy-route-and-flag-retirement-d4-d5-design.md §5.2
EOF
)"
```

Expected: commit succeeds (commitlint passes — subject is lowercase). If commit-msg hook complains, the issue is the message format; fix and retry without `--no-verify`.

---

## Phase 2 — AppShell rewrite + middleware + href cleanup + chrome deletion

This phase is structured TDD-style: the failing tests for the new AppShell shape get written first, then the production rewrite makes them pass, then dead chrome and stale references get cleaned up. The phase ends in a coherent state: no in-tree code links to the legacy routes, but the route directories themselves still exist (deletion is Phase 3).

### Task 2: Rewrite AppShell tests for the new two-branch shape

**Files:**

- Modify: `apps/dashboard/src/components/layout/__tests__/app-shell.test.tsx`

The current test file (verified at spec time) mocks `OwnerShell` and asserts it renders for default routes — those assertions are wrong post-cleanup. Replace the whole file with the new shape's expectations.

- [ ] **Step 1: Read the current test to know what `vi.mock` setup needs to change**

Read `apps/dashboard/src/components/layout/__tests__/app-shell.test.tsx` (the whole file — under 150 lines).

- [ ] **Step 2: Replace the file contents with the new test shape**

Overwrite `apps/dashboard/src/components/layout/__tests__/app-shell.test.tsx` with:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppShell, CHROME_HIDDEN_PATHS, ONBOARDING_EXEMPT_PATHS } from "../app-shell.js";

const pathnameRef = { current: "/contacts" };
const replaceMock = vi.fn();
const orgConfigMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameRef.current,
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock("@/hooks/use-org-config", () => ({
  useOrgConfig: (enabled?: boolean) => orgConfigMock(enabled),
}));

vi.mock("next/dynamic", () => ({
  default: (_loader: () => Promise<{ DevPanel: React.FC }>) => {
    const Component = () => <div data-testid="dev-panel" />;
    Component.displayName = "DynamicDevPanel";
    return Component;
  },
}));

beforeEach(() => {
  pathnameRef.current = "/contacts";
  replaceMock.mockReset();
  orgConfigMock.mockReset();
  orgConfigMock.mockReturnValue({
    data: { config: { onboardingComplete: true } },
    isLoading: false,
  });
});

describe("AppShell visual branches", () => {
  it("renders editorial paths without a wrapper <main>", () => {
    pathnameRef.current = "/alex";
    const { container } = render(
      <AppShell>
        <span>editorial-content</span>
      </AppShell>,
    );
    expect(container.querySelector("main")).toBeNull();
    expect(screen.getByText("editorial-content")).toBeDefined();
  });

  it("wraps non-editorial paths in a bare <main>", () => {
    pathnameRef.current = "/contacts";
    const { container } = render(
      <AppShell>
        <span>mercury-content</span>
      </AppShell>,
    );
    expect(container.querySelector("main")).not.toBeNull();
    expect(screen.getByText("mercury-content")).toBeDefined();
  });

  it("source does not reference OwnerShell or OwnerTabs", () => {
    // Source-text guardrail: prevents anyone from re-introducing the
    // legacy chrome via dynamic import or string-keyed lookup that
    // wouldn't be caught by typecheck. Reads the file off disk because
    // assertion-against-the-imported-module symbol can't see textual
    // references.
    // (After Phase 2 Task 5 deletes owner-shell.tsx, a static import of
    // OwnerShell would also fail typecheck — this is defense-in-depth.)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("node:path") as typeof import("node:path");
    const source = fs.readFileSync(path.join(__dirname, "../app-shell.tsx"), "utf8");
    expect(source).not.toContain("OwnerShell");
    expect(source).not.toContain("OwnerTabs");
  });
});

describe("CHROME_HIDDEN_PATHS membership", () => {
  it("includes login/onboarding/setup", () => {
    expect(CHROME_HIDDEN_PATHS).toContain("/login");
    expect(CHROME_HIDDEN_PATHS).toContain("/onboarding");
    expect(CHROME_HIDDEN_PATHS).toContain("/setup");
  });

  it("includes the Mercury Tools surfaces", () => {
    expect(CHROME_HIDDEN_PATHS).toContain("/contacts");
    expect(CHROME_HIDDEN_PATHS).toContain("/automations");
    expect(CHROME_HIDDEN_PATHS).toContain("/reports");
  });

  it("includes /settings (joined post-OwnerShell deletion)", () => {
    expect(CHROME_HIDDEN_PATHS).toContain("/settings");
  });

  it("includes /operator/reports", () => {
    expect(CHROME_HIDDEN_PATHS).toContain("/operator/reports");
  });
});

describe("ONBOARDING_EXEMPT_PATHS membership (gating, not chrome)", () => {
  it("contains only login/onboarding/setup — not Mercury surfaces or settings", () => {
    expect(ONBOARDING_EXEMPT_PATHS).toEqual(["/login", "/onboarding", "/setup"]);
  });
});

describe("Onboarding-redirect behavior", () => {
  it("redirects from a Mercury surface when onboarding is incomplete", () => {
    pathnameRef.current = "/contacts";
    orgConfigMock.mockReturnValue({
      data: { config: { onboardingComplete: false } },
      isLoading: false,
    });
    render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    expect(replaceMock).toHaveBeenCalledWith("/onboarding");
  });

  it("redirects from /settings when onboarding is incomplete", () => {
    pathnameRef.current = "/settings";
    orgConfigMock.mockReturnValue({
      data: { config: { onboardingComplete: false } },
      isLoading: false,
    });
    render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    expect(replaceMock).toHaveBeenCalledWith("/onboarding");
  });

  it("does not redirect from /onboarding (exempt)", () => {
    pathnameRef.current = "/onboarding";
    orgConfigMock.mockReturnValue({
      data: { config: { onboardingComplete: false } },
      isLoading: false,
    });
    render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("does not redirect from /login (exempt)", () => {
    pathnameRef.current = "/login";
    orgConfigMock.mockReturnValue({
      data: { config: { onboardingComplete: false } },
      isLoading: false,
    });
    render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("does not redirect from editorial paths (existing behavior preserved)", () => {
    pathnameRef.current = "/alex";
    orgConfigMock.mockReturnValue({
      data: { config: { onboardingComplete: false } },
      isLoading: false,
    });
    render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("does not redirect when onboarding is complete", () => {
    pathnameRef.current = "/contacts";
    orgConfigMock.mockReturnValue({
      data: { config: { onboardingComplete: true } },
      isLoading: false,
    });
    render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("skips org-config fetch on editorial paths", () => {
    pathnameRef.current = "/alex";
    render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    expect(orgConfigMock).toHaveBeenCalledWith(false);
  });

  it("skips org-config fetch on onboarding-exempt paths", () => {
    pathnameRef.current = "/login";
    render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    expect(orgConfigMock).toHaveBeenCalledWith(false);
  });

  it("fetches org-config on Mercury surfaces (gating active)", () => {
    pathnameRef.current = "/contacts";
    render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    expect(orgConfigMock).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 3: Run the new test suite — confirm it FAILS**

```bash
pnpm --filter @switchboard/dashboard test -- --run app-shell.test.tsx 2>&1 | tail -30
```

Expected: FAIL. Most failures will be `ReferenceError: ONBOARDING_EXEMPT_PATHS is not defined` or similar — the new export doesn't exist yet. That's fine; we wrote the tests first. Move to Task 3.

### Task 3: Rewrite `app-shell.tsx` to make the new tests pass

**Files:**

- Modify: `apps/dashboard/src/components/layout/app-shell.tsx`

- [ ] **Step 1: Replace the file contents**

Overwrite `apps/dashboard/src/components/layout/app-shell.tsx` with:

```tsx
"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useOrgConfig } from "@/hooks/use-org-config";

const DevPanel =
  process.env.NODE_ENV === "production"
    ? () => null
    : dynamic(() => import("../dev/dev-panel").then((mod) => mod.DevPanel), { ssr: false });

/**
 * Routes that mount their own EditorialAuthShell. The editorial shell owns
 * the page's <main> and chrome itself. /alex and /riley match the agent home
 * route; "/" is the Owner Home placeholder. Mira is intentionally absent —
 * /mira returns notFound().
 */
const EDITORIAL_SHELL_PATHS = new Set(["/", "/alex", "/riley"]);

/**
 * Visual decision: routes that own their own page chrome (no AppShell wrapping).
 * Includes Mercury Tools surfaces (/contacts, /automations, /reports), the
 * settings hub (/settings/* — its layout owns its sidebar), the onboarding/auth
 * flow, and the operator/reports admin surface.
 */
export const CHROME_HIDDEN_PATHS = [
  "/login",
  "/onboarding",
  "/setup",
  "/contacts",
  "/automations",
  "/reports",
  "/settings",
  "/operator/reports",
];

/**
 * Gating decision: routes where the onboarding-completeness check should NOT
 * fire. Intentionally narrower than CHROME_HIDDEN_PATHS — most chrome-hidden
 * routes (Mercury surfaces, /settings, /operator/reports) still need
 * onboarding to be complete. Only the auth/setup flow itself is exempt.
 *
 * Editorial paths (/, /alex, /riley) are also exempt by their own branch
 * below (existing behavior preserved).
 *
 * Reviewer flips (per spec §5.4):
 *   - To preserve the implicit /reports exemption that existed pre-D4+D5,
 *     add "/reports" here.
 *   - To exempt /operator for support/debugging, add "/operator" here.
 *   - To gate editorial paths too, remove the usesEditorialShell check
 *     from shouldCheckOnboarding below.
 */
export const ONBOARDING_EXEMPT_PATHS = ["/login", "/onboarding", "/setup"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const usesEditorialShell = EDITORIAL_SHELL_PATHS.has(pathname);
  const isOnboardingExempt = ONBOARDING_EXEMPT_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );

  const shouldCheckOnboarding = !usesEditorialShell && !isOnboardingExempt;
  const { data: orgData, isLoading: orgLoading } = useOrgConfig(shouldCheckOnboarding);

  const onboardingComplete = orgData?.config?.onboardingComplete ?? true;

  useEffect(() => {
    if (shouldCheckOnboarding && !orgLoading && !onboardingComplete) {
      router.replace("/onboarding");
    }
  }, [shouldCheckOnboarding, orgLoading, onboardingComplete, router]);

  if (usesEditorialShell) {
    return (
      <>
        {children}
        <DevPanel />
      </>
    );
  }

  // All non-editorial routes (Mercury surfaces, /settings, /operator/reports,
  // /login, /onboarding, /setup) get the bare <main> wrapper. The route's
  // own layout.tsx (e.g., SettingsLayout, ReportsLayout) is responsible for
  // any sidebar/header/back-link chrome.
  return (
    <main className="min-h-screen bg-background">
      {children}
      <DevPanel />
    </main>
  );
}
```

**Note on `CHROME_HIDDEN_PATHS`:** the constant is exported (used by tests in Task 2 to assert membership) but does not drive a runtime branch — after `OwnerShell` deletion, every non-editorial route renders identically. The export is kept as the single source of truth for which routes own their own chrome, primarily for the tests and as a documented invariant for future readers. **Do not** add a `void` statement or other lint-silencer to keep an unused local — the version above does not compute `isChromeHidden` inside the component for exactly this reason.

- [ ] **Step 2: Run the AppShell tests — confirm PASS**

```bash
pnpm --filter @switchboard/dashboard test -- --run app-shell.test.tsx 2>&1 | tail -30
```

Expected: PASS, 14+ tests.

If a test fails: read the failure, fix the AppShell code (or the test if the test is wrong). Do not commit until green.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @switchboard/dashboard typecheck 2>&1 | tail -20
```

Expected: PASS. There may be transient errors complaining about `OwnerShell` being unused elsewhere — those resolve in Task 5.

### Task 4: Update `middleware.ts` (drop deleted route names)

**Files:**

- Modify: `apps/dashboard/src/middleware.ts`

- [ ] **Step 1: Update `AUTH_PAGE_PREFIXES`**

In `apps/dashboard/src/middleware.ts`, replace:

```ts
const AUTH_PAGE_PREFIXES = [
  "/dashboard",
  "/marketplace",
  "/deploy",
  "/deployments",
  "/settings",
  "/onboarding",
  "/decide",
  "/me",
  "/my-agent",
  "/tasks",
  "/modules",
  "/escalations",
  "/conversations",
  "/post-auth",
  "/reports",
] as const;
```

with:

```ts
const AUTH_PAGE_PREFIXES = [
  "/marketplace",
  "/deploy",
  "/settings",
  "/onboarding",
  "/post-auth",
  "/reports",
  "/contacts",
  "/automations",
] as const;
```

Removed (deleted in Phase 3): `/dashboard`, `/deployments`, `/decide`, `/me`, `/my-agent`, `/tasks`, `/modules`, `/escalations`, `/conversations`. Added: `/contacts`, `/automations` (Mercury surfaces shipped after this middleware was last edited; belong in the auth-required allowlist alongside `/reports`).

**Kept intentionally:** `/marketplace` and `/deploy`. These are **not** part of the D4+D5 deletion scope — neither has a route directory under `apps/dashboard/src/app/(auth)/` at task time (verified by `ls apps/dashboard/src/app/(auth)/{marketplace,deploy} 2>/dev/null` returning nothing), but they appear in `(public)/` and the prefixes may exist for legacy/forwarding reasons. Disposition is a separate decision; preserving them here keeps this commit narrowly focused on D4+D5.

- [ ] **Step 2: Update the `matcher` config**

Replace:

```ts
export const config = {
  matcher: [
    "/signup",
    "/api/dashboard/:path*",
    "/dashboard/:path*",
    "/marketplace/:path*",
    "/deploy/:path*",
    "/deployments/:path*",
    "/settings/:path*",
    "/onboarding/:path*",
    "/decide/:path*",
    "/me/:path*",
    "/my-agent/:path*",
    "/tasks/:path*",
    "/modules/:path*",
    "/escalations/:path*",
    "/conversations/:path*",
    "/post-auth/:path*",
    "/reports/:path*",
  ],
};
```

with:

```ts
export const config = {
  matcher: [
    "/signup",
    "/api/dashboard/:path*",
    "/marketplace/:path*",
    "/deploy/:path*",
    "/settings/:path*",
    "/onboarding/:path*",
    "/post-auth/:path*",
    "/reports/:path*",
    "/contacts/:path*",
    "/automations/:path*",
  ],
};
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @switchboard/dashboard typecheck 2>&1 | tail -10
```

Expected: PASS.

### Task 5: Delete OwnerShell and OwnerTabs

**Files:**

- Delete: `apps/dashboard/src/components/layout/owner-shell.tsx`
- Delete: `apps/dashboard/src/components/layout/owner-tabs.tsx`
- Delete: `apps/dashboard/src/components/layout/__tests__/owner-tabs.test.tsx`

- [ ] **Step 1: Pre-deletion provider audit on OwnerShell**

```bash
grep -nE "createContext|Provider|useContext" apps/dashboard/src/components/layout/owner-shell.tsx
```

Expected: zero hits. If ANY hit comes back, OwnerShell provides context — STOP, hoist the provider into `apps/dashboard/src/app/(auth)/layout.tsx` first (before continuing this task), and re-grep all `OwnerShell` consumers for the lifted context.

Spec-time inspection confirmed OwnerShell is pure visual chrome (`<div>` + `<main>` + `<OwnerTabs/>`, no provider) — this step is the cheap insurance the spec calls for.

- [ ] **Step 2: Confirm OwnerShell has no remaining importers**

```bash
grep -rn "OwnerShell" apps/dashboard/src --include="*.tsx" --include="*.ts" 2>/dev/null
```

Expected: only the file itself (`owner-shell.tsx`). The previous AppShell import was removed in Task 3. If any other file still imports OwnerShell, fix that file first.

- [ ] **Step 3: Confirm OwnerTabs has no remaining importers (outside of OwnerShell, which is also being deleted)**

```bash
grep -rn "OwnerTabs" apps/dashboard/src --include="*.tsx" --include="*.ts" 2>/dev/null
```

Expected: `owner-shell.tsx` (consumer, dying) + `owner-tabs.tsx` itself + `__tests__/owner-tabs.test.tsx`. If any other file still imports OwnerTabs, fix that file first.

- [ ] **Step 4: Delete the three files**

```bash
rm apps/dashboard/src/components/layout/owner-shell.tsx
rm apps/dashboard/src/components/layout/owner-tabs.tsx
rm apps/dashboard/src/components/layout/__tests__/owner-tabs.test.tsx
```

- [ ] **Step 5: Run typecheck + AppShell tests**

```bash
pnpm --filter @switchboard/dashboard typecheck 2>&1 | tail -20
pnpm --filter @switchboard/dashboard test -- --run app-shell.test.tsx 2>&1 | tail -10
```

Expected: both PASS. Typecheck may surface transient errors from `useApprovalCount` / `useEscalationCount` in deleted-but-still-imported files — those resolve in Phase 4.

If typecheck reports errors in the surviving (auth) routes that you didn't anticipate, stop and investigate. Common cause: a hook (e.g., `useApprovals`) was being re-exported through a file that survives.

### Task 6: Update `not-found.tsx` (href + visible copy)

**Files:**

- Modify: `apps/dashboard/src/app/not-found.tsx`

- [ ] **Step 1: Replace href and copy**

Open `apps/dashboard/src/app/not-found.tsx`. The current file (10 lines) has:

```tsx
<Link href="/dashboard" ...>
  Back to Dashboard
</Link>
```

Change to:

```tsx
<Link href="/" ...>
  Back home
</Link>
```

Preserve all other attributes (className, etc.).

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @switchboard/dashboard typecheck 2>&1 | tail -5
```

Expected: PASS.

### Task 7: Update `landing-nav.tsx` (`/me` → `/settings/account`)

**Files:**

- Modify: `apps/dashboard/src/components/landing/landing-nav.tsx`

- [ ] **Step 1: Locate the two references**

```bash
grep -n 'href="/me"' apps/dashboard/src/components/landing/landing-nav.tsx
```

Expected: two hits (lines 99 and 246 at spec time; verify exact lines).

- [ ] **Step 2: Replace both**

Use sed-style replacement via Edit tool — for each occurrence, change `href="/me"` to `href="/settings/account"`. Both replacements; preserve any surrounding attributes.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @switchboard/dashboard typecheck 2>&1 | tail -5
```

Expected: PASS.

### Task 8: Phase-2 typecheck + test + commit

- [ ] **Step 1: Run the full validation sweep**

```bash
pnpm typecheck 2>&1 | tail -20
pnpm --filter @switchboard/dashboard test 2>&1 | tail -30
```

Expected: typecheck PASS. Dashboard tests: AppShell tests PASS; existing tests for components that survive (e.g., editorial-auth-shell, inbox-drawer) PASS. Tests in `__tests__` for deleted files (owner-tabs.test.tsx) are already gone.

**Tests that may fail at this commit:** any test under deleted-route directories that we'll delete in Phase 3 alongside the routes. If `pnpm test` surfaces failures in `(auth)/decide/__tests__`, `(auth)/me/__tests__`, etc., that's expected — those tests die with their routes in Phase 3. Proceed.

**Tests that should NOT fail:** anything outside the delete set. If `inbox-drawer.test.tsx` or any survivor fails, stop and investigate.

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/src/components/layout/app-shell.tsx \
        apps/dashboard/src/components/layout/__tests__/app-shell.test.tsx \
        apps/dashboard/src/middleware.ts \
        apps/dashboard/src/app/not-found.tsx \
        apps/dashboard/src/components/landing/landing-nav.tsx
git rm apps/dashboard/src/components/layout/owner-shell.tsx \
       apps/dashboard/src/components/layout/owner-tabs.tsx \
       apps/dashboard/src/components/layout/__tests__/owner-tabs.test.tsx
git commit -m "$(cat <<'EOF'
refactor(dashboard): split AppShell chrome from onboarding gating

- Replace AppShell three-branch model with two branches (editorial
  vs chrome-hidden); move /contacts, /automations, /settings into
  CHROME_HIDDEN_PATHS now that OwnerShell is going away.
- Introduce ONBOARDING_EXEMPT_PATHS = [/login, /onboarding, /setup]
  so onboarding-gating is no longer accidentally suppressed for the
  Mercury surfaces and /settings (the previous useOrgConfig() guard
  reused the chrome-hidden flag for both concerns).
- Delete OwnerShell + OwnerTabs (no remaining consumer once AppShell
  no longer references OwnerShell).
- Update middleware.ts allowlist + matcher to drop legacy route
  prefixes; add /contacts and /automations.
- not-found.tsx: /dashboard -> / and "Back to Dashboard" -> "Back home".
- landing-nav.tsx: /me -> /settings/account (two refs).

After this commit, no in-tree code links to the legacy routes; the
route directories themselves still exist (Phase 3 deletes them).

Spec: docs/superpowers/specs/2026-05-10-legacy-route-and-flag-retirement-d4-d5-design.md §5, §7
EOF
)"
```

Expected: commit succeeds.

---

## Phase 3 — Legacy route deletion

Each task here is a `rm -rf` of one route directory. There is no TDD for pure deletions — the test is `pnpm typecheck` after each, plus the final acceptance grep.

### Task 9: Delete the nine `(auth)/*` route directories + the modules-status proxy

**Files:**

- Delete: `apps/dashboard/src/app/(auth)/dashboard/` (whole tree)
- Delete: `apps/dashboard/src/app/(auth)/escalations/`
- Delete: `apps/dashboard/src/app/(auth)/decide/`
- Delete: `apps/dashboard/src/app/(auth)/tasks/`
- Delete: `apps/dashboard/src/app/(auth)/me/`
- Delete: `apps/dashboard/src/app/(auth)/my-agent/`
- Delete: `apps/dashboard/src/app/(auth)/modules/`
- Delete: `apps/dashboard/src/app/(auth)/conversations/`
- Delete: `apps/dashboard/src/app/(auth)/deployments/`
- Delete: `apps/dashboard/src/app/api/dashboard/modules/status/`

- [ ] **Step 1: Inventory what is being deleted (sanity check before rm)**

```bash
for d in dashboard escalations decide tasks me my-agent modules conversations deployments; do
  echo "=== /$d ==="
  ls "apps/dashboard/src/app/(auth)/$d" 2>/dev/null
done
ls apps/dashboard/src/app/api/dashboard/modules/status 2>/dev/null
```

Expected: each directory shows its pages/sub-routes. If any directory is empty or missing, note it (it may have already been cleaned up).

- [ ] **Step 2: Delete the route directories**

```bash
git rm -rf apps/dashboard/src/app/\(auth\)/dashboard
git rm -rf apps/dashboard/src/app/\(auth\)/escalations
git rm -rf apps/dashboard/src/app/\(auth\)/decide
git rm -rf apps/dashboard/src/app/\(auth\)/tasks
git rm -rf apps/dashboard/src/app/\(auth\)/me
git rm -rf apps/dashboard/src/app/\(auth\)/my-agent
git rm -rf apps/dashboard/src/app/\(auth\)/modules
git rm -rf apps/dashboard/src/app/\(auth\)/conversations
git rm -rf apps/dashboard/src/app/\(auth\)/deployments
git rm -rf apps/dashboard/src/app/api/dashboard/modules/status
```

`git rm -rf` removes the files and stages the deletion in one shot.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @switchboard/dashboard typecheck 2>&1 | tail -30
```

Expected: PASS. The deleted routes were the only consumers of their imported components (verified at spec time §3 + the audit in §4); typecheck should not complain about dangling imports in surviving code. **If typecheck fails** with "Cannot find module …" coming from a surviving file, it means the spec's consumer audit missed something. Either:

- The component is genuinely orphaned and its consumer can be deleted in Phase 4 (continue, fix in Phase 4).
- The component is needed by surviving code and the spec's delete set was wrong (stop, restore the relevant component, escalate to the spec author before continuing).

- [ ] **Step 4: Run dashboard tests**

```bash
pnpm --filter @switchboard/dashboard test 2>&1 | tail -30
```

Expected: PASS — the tests for deleted routes were colocated under the deleted directories and went with them. Survivor tests still pass.

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore(dashboard): delete legacy (auth) routes (D4)

Removed nine route directories and the modules-status Next-API proxy:
  /dashboard, /escalations, /decide, /tasks, /me, /my-agent,
  /modules, /conversations, /deployments,
  /api/dashboard/modules/status

All replaced surfaces have shipped:
  /dashboard -> / (Owner Home) + /[agentKey] editorial homes
  /escalations + /decide -> Inbox drawer (C1) + per-agent Needs You
  /tasks -> already redirected to /decide; both go
  /me -> /settings/account (sign-out migrated in earlier commit)
  /my-agent -> /[agentKey]
  /modules, /conversations, /deployments -> deleted outright
  (no editorial successor; pre-launch posture per spec §2)

Backend API endpoints (/api/escalations, /api/marketplace/*,
/api/conversations, /api/deployments) are intentionally NOT
deleted; that's its own slice (roadmap Track #10).

Spec: docs/superpowers/specs/2026-05-10-legacy-route-and-flag-retirement-d4-d5-design.md §3
EOF
)"
```

Expected: commit succeeds.

---

## Phase 4 — Component / hook pruning

Now that no route references them, dead components and hooks can be deleted in batches. Each task is a `git rm` for a cluster, followed by typecheck.

### Task 10: Delete the dashboard widget cluster

**Files:**

- Delete: `apps/dashboard/src/components/dashboard/owner-today.tsx`
- Delete: `apps/dashboard/src/components/dashboard/owner-task-list.tsx`
- Delete: `apps/dashboard/src/components/dashboard/revenue-summary.tsx`
- Delete: `apps/dashboard/src/components/dashboard/activity-feed.tsx`
- Delete: `apps/dashboard/src/components/dashboard/synergy-strip.tsx`
- Delete: `apps/dashboard/src/components/dashboard/recommendation-bar.tsx`
- Delete: `apps/dashboard/src/components/dashboard/module-card.tsx`
- Delete: `apps/dashboard/src/components/dashboard/module-cards.tsx`
- Audit: `apps/dashboard/src/components/dashboard/__tests__/`

- [ ] **Step 1: Re-grep each component for any surviving consumer**

For each (kebab filename, PascalCase symbol) pair, grep both names. Listed explicitly because portable PascalCase generation via `sed` is unreliable (macOS `sed` does not support `\u` for upper-casing).

```bash
# Pairs: kebab-file-name PascalCaseSymbol
PAIRS=(
  "owner-today OwnerToday"
  "owner-task-list OwnerTaskList"
  "revenue-summary RevenueSummary"
  "activity-feed ActivityFeed"
  "synergy-strip SynergyStrip"
  "recommendation-bar RecommendationBar"
  "module-card ModuleCard"
  "module-cards ModuleCards"
)
for pair in "${PAIRS[@]}"; do
  read -r kebab pascal <<<"$pair"
  echo "=== $kebab / $pascal ==="
  grep -rnE "\\b($kebab|$pascal)\\b" apps/dashboard/src --include="*.tsx" --include="*.ts" 2>/dev/null \
    | grep -v "components/dashboard/$kebab\.tsx" \
    | grep -v ".test."
done
```

Expected: zero hits per pair. After Phase 3 route deletion, no consumer of these widgets survives.

If any hit comes back, that's a missed consumer — open the file, decide if it's also dying or if the spec's delete set was wrong. Do not proceed until the grep is clean. Typecheck (Step 5) is the final safety net.

- [ ] **Step 2: List the dashboard component dir to find any sibling files not in the spec list**

```bash
ls apps/dashboard/src/components/dashboard/
```

For any file there NOT in the explicit delete list, grep for surviving consumers:

```bash
grep -rln "<component-name>" apps/dashboard/src --include="*.tsx" --include="*.ts" 2>/dev/null | grep -v ".test."
```

If a sibling file has zero surviving consumers, add it to the delete list. If it has surviving consumers, leave it.

- [ ] **Step 3: Delete the eight named files**

```bash
git rm apps/dashboard/src/components/dashboard/owner-today.tsx
git rm apps/dashboard/src/components/dashboard/owner-task-list.tsx
git rm apps/dashboard/src/components/dashboard/revenue-summary.tsx
git rm apps/dashboard/src/components/dashboard/activity-feed.tsx
git rm apps/dashboard/src/components/dashboard/synergy-strip.tsx
git rm apps/dashboard/src/components/dashboard/recommendation-bar.tsx
git rm apps/dashboard/src/components/dashboard/module-card.tsx
git rm apps/dashboard/src/components/dashboard/module-cards.tsx
```

Plus any sibling files identified in Step 2.

- [ ] **Step 4: Delete colocated tests for the deleted widgets**

```bash
ls apps/dashboard/src/components/dashboard/__tests__/ 2>/dev/null
```

For each test file under that directory whose subject component was just deleted, `git rm` it. Then check whether `__tests__` becomes empty and `git rm` the directory if so.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @switchboard/dashboard typecheck 2>&1 | tail -20
```

Expected: PASS.

### Task 11: Delete decide/approvals/tasks UI cluster + hooks

**Files:**

- Delete: `apps/dashboard/src/components/approvals/approval-card.tsx`
- Delete: `apps/dashboard/src/components/approvals/respond-dialog.tsx`
- Delete: `apps/dashboard/src/components/tasks/task-card.tsx`
- Delete: `apps/dashboard/src/components/tasks/creative-task-card.tsx`
- Delete: `apps/dashboard/src/components/tasks/task-review-dialog.tsx`
- Delete: `apps/dashboard/src/hooks/use-approval-action.ts`
- Delete: `apps/dashboard/src/hooks/use-approvals.ts`
- Delete: `apps/dashboard/src/hooks/__tests__/use-approvals.test.ts`
- Delete: `apps/dashboard/src/hooks/use-escalations.ts`
- Audit: `apps/dashboard/src/lib/approval-constants.ts`
- Audit: `apps/dashboard/src/components/approvals/`, `apps/dashboard/src/components/tasks/` for sibling files

- [ ] **Step 1: Re-grep each file for surviving consumers**

Listed explicitly (kebab file name + PascalCase symbol) because portable PascalCase generation via `sed` is unreliable across macOS/Linux.

```bash
# Pairs: kebab-file-name PascalCaseSymbol home-dir
COMPONENT_PAIRS=(
  "approval-card ApprovalCard approvals"
  "respond-dialog RespondDialog approvals"
  "task-card TaskCard tasks"
  "creative-task-card CreativeTaskCard tasks"
  "task-review-dialog TaskReviewDialog tasks"
)
for pair in "${COMPONENT_PAIRS[@]}"; do
  read -r kebab pascal dir <<<"$pair"
  echo "=== $dir/$kebab ($pascal) ==="
  grep -rnE "\\b($kebab|$pascal)\\b" apps/dashboard/src --include="*.tsx" --include="*.ts" 2>/dev/null \
    | grep -v "components/$dir/$kebab\.tsx" \
    | grep -v ".test."
done

for h in use-approval-action use-approvals use-escalations; do
  echo "=== $h ==="
  grep -rnE "from [\"']@/hooks/$h[\"']" apps/dashboard/src --include="*.tsx" --include="*.ts" 2>/dev/null
done
```

Expected: zero hits per. After Phase 3 + Task 5 (OwnerShell/OwnerTabs gone), there should be no consumer.

- [ ] **Step 2: Audit `lib/approval-constants.ts`**

```bash
grep -rln "approval-constants\|CONSEQUENCE\|approvalConstants" apps/dashboard/src --include="*.tsx" --include="*.ts" 2>/dev/null | grep -v ".test."
```

If only the file itself appears (or its test), `git rm` it. If anything else imports it, leave it.

- [ ] **Step 3: Audit `components/approvals/` and `components/tasks/` for sibling files**

```bash
ls apps/dashboard/src/components/approvals/ 2>/dev/null
ls apps/dashboard/src/components/tasks/ 2>/dev/null
```

For each sibling not in the explicit delete list, repeat the consumer grep. Delete any with zero surviving consumers.

- [ ] **Step 4: Delete the named files**

```bash
git rm apps/dashboard/src/components/approvals/approval-card.tsx
git rm apps/dashboard/src/components/approvals/respond-dialog.tsx
git rm apps/dashboard/src/components/tasks/task-card.tsx
git rm apps/dashboard/src/components/tasks/creative-task-card.tsx
git rm apps/dashboard/src/components/tasks/task-review-dialog.tsx
git rm apps/dashboard/src/hooks/use-approval-action.ts
git rm apps/dashboard/src/hooks/use-approvals.ts
git rm apps/dashboard/src/hooks/__tests__/use-approvals.test.ts
git rm apps/dashboard/src/hooks/use-escalations.ts
```

Plus any sibling files identified in Steps 2/3.

If `apps/dashboard/src/components/approvals/` or `apps/dashboard/src/components/tasks/` becomes empty after this, `git rm -rf` the directory.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @switchboard/dashboard typecheck 2>&1 | tail -20
```

Expected: PASS.

### Task 12: Delete escalations component cluster

**Files:**

- Delete: `apps/dashboard/src/components/escalations/escalation-list.tsx`
- Delete: `apps/dashboard/src/components/escalations/__tests__/` (whole directory)

- [ ] **Step 1: Confirm no surviving consumer**

```bash
grep -rln "EscalationList\|escalations/escalation-list\|components/escalations" apps/dashboard/src --include="*.tsx" --include="*.ts" 2>/dev/null \
  | grep -v "components/escalations/"
```

Expected: zero hits.

- [ ] **Step 2: Delete the directory**

```bash
git rm -rf apps/dashboard/src/components/escalations
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @switchboard/dashboard typecheck 2>&1 | tail -10
```

Expected: PASS.

### Task 13: Delete the modules cluster

**Files:**

- Delete: `apps/dashboard/src/components/modules/module-detail.tsx`
- Delete: `apps/dashboard/src/components/modules/module-setup-wizard.tsx`
- Audit: rest of `apps/dashboard/src/components/modules/`
- Delete: `apps/dashboard/src/lib/module-state-resolver.ts`
- Delete: `apps/dashboard/src/lib/module-types.ts`
- Delete: `apps/dashboard/src/hooks/use-module-status.ts`

- [ ] **Step 1: Grep all module-cluster consumers**

```bash
for c in ModuleDetail ModuleSetupWizard module-state-resolver moduleStateResolver use-module-status useModuleStatus module-types ModuleStatus; do
  echo "=== $c ==="
  grep -rln "$c" apps/dashboard/src --include="*.tsx" --include="*.ts" 2>/dev/null \
    | grep -v ".test." \
    | grep -v "components/modules/" \
    | grep -v "lib/module-" \
    | grep -v "hooks/use-module-status"
done
```

Expected: zero hits each. The `dashboard/synergy-strip`, `recommendation-bar`, `module-card(s)` consumers were already deleted in Task 10; the route consumers were deleted in Phase 3.

- [ ] **Step 2: List rest of modules dir**

```bash
ls apps/dashboard/src/components/modules/
```

For each file beyond `module-detail.tsx` and `module-setup-wizard.tsx`, run a consumer grep. Delete if no surviving consumer.

- [ ] **Step 3: Delete files**

```bash
git rm -rf apps/dashboard/src/components/modules
git rm apps/dashboard/src/lib/module-state-resolver.ts
git rm apps/dashboard/src/lib/module-types.ts
git rm apps/dashboard/src/hooks/use-module-status.ts
```

If `lib/__tests__/module-state-resolver.test.ts` (or similar) exists, delete it too.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @switchboard/dashboard typecheck 2>&1 | tail -10
```

Expected: PASS.

### Task 14: Delete dying marketplace components + conversations hooks

**Files:**

- Delete: `apps/dashboard/src/components/marketplace/channels-section.tsx`
- Delete: `apps/dashboard/src/components/marketplace/trust-score-badge.tsx`
- Delete: `apps/dashboard/src/components/marketplace/faq-review-queue.tsx`
- Delete: `apps/dashboard/src/hooks/use-conversations.ts`
- Delete: `apps/dashboard/src/hooks/use-conversation-override.ts`
- **Keep:** `apps/dashboard/src/components/marketplace/work-log-list.tsx`, `conversation-transcript.tsx`, `trust-history-chart.tsx` (consumed by `(public)/agents/[slug]/profile-tabs.tsx`)

- [ ] **Step 1: Verify the survival rule still holds (re-grep work-log-list, conversation-transcript, trust-history-chart)**

```bash
for c in WorkLogList ConversationTranscript TrustHistoryChart; do
  echo "=== $c ==="
  grep -rln "$c" apps/dashboard/src --include="*.tsx" --include="*.ts" 2>/dev/null \
    | grep -v ".test." \
    | grep -v "components/marketplace/"
done
```

Expected: each appears at least in `apps/dashboard/src/app/(public)/agents/[slug]/profile-tabs.tsx`. If any of the three has zero surviving consumers (the public-site consumer was removed elsewhere), demote it to the delete list — but ONLY after confirming via separate grep.

- [ ] **Step 2: Verify the dying three have zero surviving consumers**

```bash
for c in ChannelsSection TrustScoreBadge FaqReviewQueue; do
  echo "=== $c ==="
  grep -rln "$c" apps/dashboard/src --include="*.tsx" --include="*.ts" 2>/dev/null \
    | grep -v ".test." \
    | grep -v "components/marketplace/"
done
```

Expected: zero hits each.

- [ ] **Step 3: Delete the three marketplace components and the two conversations hooks**

```bash
git rm apps/dashboard/src/components/marketplace/channels-section.tsx
git rm apps/dashboard/src/components/marketplace/trust-score-badge.tsx
git rm apps/dashboard/src/components/marketplace/faq-review-queue.tsx
git rm apps/dashboard/src/hooks/use-conversations.ts
git rm apps/dashboard/src/hooks/use-conversation-override.ts
```

If colocated tests for any of these exist under `components/marketplace/__tests__/` or `hooks/__tests__/`, delete them too.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @switchboard/dashboard typecheck 2>&1 | tail -10
```

Expected: PASS.

### Task 15: Audit and prune `use-marketplace.ts`

**Files:**

- Audit + likely delete or prune: `apps/dashboard/src/hooks/use-marketplace.ts`

Per spec §4.7: "for each named export, grep for surviving consumers; delete dead exports; keep file only if at least one surviving consumer in `(public)/`, `(auth)/settings/`, `(auth)/operator/`, or another non-deleted surface; do not preserve exports because the backend endpoint still exists."

- [ ] **Step 1: Enumerate the exports**

```bash
grep -nE "^export " apps/dashboard/src/hooks/use-marketplace.ts
```

This lists every named export — typically `useTasks`, `useReviewTask`, possibly `useAgents`, `useDeployments`, `useDeployment`, `useDeploymentLogs`, etc. (varies; verify at task time).

- [ ] **Step 2: For each export, grep for surviving consumers**

```bash
for fn in $(grep -oE "^export (const|function) [A-Za-z]+" apps/dashboard/src/hooks/use-marketplace.ts | awk '{print $NF}'); do
  echo "=== $fn ==="
  grep -rln "\b$fn\b" apps/dashboard/src --include="*.tsx" --include="*.ts" 2>/dev/null \
    | grep -v "hooks/use-marketplace" \
    | grep -v ".test." \
    | grep -v "hooks/__tests__/use-marketplace"
done
```

For each export with zero surviving consumers: it dies.

- [ ] **Step 3: Decide file fate**

- If **all** exports have zero surviving consumers, `git rm` the whole file:

  ```bash
  git rm apps/dashboard/src/hooks/use-marketplace.ts
  ```

  And the colocated test if any:

  ```bash
  git rm apps/dashboard/src/hooks/__tests__/use-marketplace.test.ts
  ```

- If **some** exports survive, edit the file to remove only the dead exports. Update the colocated test to remove cases for deleted exports.

- [ ] **Step 4: Typecheck + test**

```bash
pnpm --filter @switchboard/dashboard typecheck 2>&1 | tail -10
pnpm --filter @switchboard/dashboard test -- --run use-marketplace 2>&1 | tail -10
```

Expected: PASS.

### Task 16: Phase-4 final commit

- [ ] **Step 1: Run a broad consumer-orphan grep to catch anything missed**

```bash
pnpm --filter @switchboard/dashboard typecheck 2>&1 | tail -20
pnpm --filter @switchboard/dashboard lint 2>&1 | tail -20
pnpm --filter @switchboard/dashboard test 2>&1 | tail -30
```

Expected: PASS, PASS, PASS.

- [ ] **Step 2: Commit Phase 4 in a single shot**

```bash
git status --short
git commit -m "$(cat <<'EOF'
chore(dashboard): prune components/hooks orphaned by D4 route deletion

Removed every component, hook, and lib file whose only consumers were
in the deleted route set:

- dashboard/ widget cluster: owner-today, owner-task-list,
  revenue-summary, activity-feed, synergy-strip, recommendation-bar,
  module-card, module-cards
- approvals/tasks UI: approval-card, respond-dialog, task-card,
  creative-task-card, task-review-dialog
- approvals/escalations hooks: use-approval-action, use-approvals,
  use-escalations
- escalations/: escalation-list and tests
- modules/: module-detail, module-setup-wizard, module-state-resolver,
  module-types, use-module-status
- marketplace/: channels-section, trust-score-badge, faq-review-queue
  (work-log-list, conversation-transcript, trust-history-chart kept
  for public marketing site at /(public)/agents/[slug])
- conversations: use-conversations, use-conversation-override
- use-marketplace.ts: <REPLACE WITH ACTUAL OUTCOME — either "deleted (no surviving consumer)" or "pruned to keep <export-name(s)> for <surviving-consumer>">.

Spec: docs/superpowers/specs/2026-05-10-legacy-route-and-flag-retirement-d4-d5-design.md §4
EOF
)"
```

If you split Phase-4 into intermediate commits because the diff was too large to review in one chunk, that's fine — coherence per commit is the goal, not commit count (per spec §12).

---

## Phase 5 — Flag retirement

### Task 17: Generate the Prisma migration

**Files:**

- Create: `packages/db/prisma/migrations/<TS>_drop_organization_config_use_agent_first_nav/migration.sql`

Per spec §6.3 + memory `feedback_prisma_migrate_dev_tty.md`. Run from the repo root.

- [ ] **Step 1: Confirm DATABASE_URL is reachable**

```bash
DATABASE_URL="$(awk -F= '/^DATABASE_URL=/ { sub(/^DATABASE_URL=/, ""); print; exit }' .env | tr -d '"')"
echo "DB host: $(echo "$DATABASE_URL" | sed 's|.*@||; s|/.*||')"
```

If the host is empty or you don't have a Postgres running, start one (the repo's `pnpm dev:db` or your usual local Postgres) before continuing. Without a DB, `migrate diff` cannot read the current state.

- [ ] **Step 2: Edit `schema.prisma` to remove the field**

Open `packages/db/prisma/schema.prisma` and locate line 431 (or whatever line `useAgentFirstNav` is on at task time). Remove the entire field line:

```prisma
  useAgentFirstNav     Boolean         @default(false)
```

Save.

- [ ] **Step 3: Generate the migration SQL via `migrate diff`**

```bash
TS=$(date -u +%Y%m%d%H%M%S)
MIGDIR="packages/db/prisma/migrations/${TS}_drop_organization_config_use_agent_first_nav"
mkdir -p "$MIGDIR"

DATABASE_URL="$(awk -F= '/^DATABASE_URL=/ { sub(/^DATABASE_URL=/, ""); print; exit }' .env | tr -d '"')"

(cd packages/db && pnpm exec prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script) > "$MIGDIR/migration.sql"

cat "$MIGDIR/migration.sql"
```

**Expected invariant:** the only SQL statement in the file is exactly:

```sql
ALTER TABLE "OrganizationConfig" DROP COLUMN "useAgentFirstNav";
```

Prisma may emit one or more leading comment lines (`-- …`) describing the migration. Those are fine; do not assert on the exact comment text. The only thing that matters is that the SQL statements (lines that don't start with `--`) are exactly the one `ALTER TABLE … DROP COLUMN` above.

Quick verifier:

```bash
grep -v '^--' "$MIGDIR/migration.sql" | grep -v '^[[:space:]]*$'
```

Expected: exactly one line — the `ALTER TABLE` statement.

If the SQL contains anything other than that single column drop, **stop** — that means the schema diverges from the DB in other ways, and you'd be bundling drift fixes into this migration. Investigate before proceeding.

- [ ] **Step 4: Apply the migration**

```bash
(cd packages/db && DATABASE_URL="$DATABASE_URL" pnpm exec prisma migrate deploy)
```

Expected: "1 migration applied" or similar confirmation.

- [ ] **Step 5: Verify no drift**

```bash
pnpm db:check-drift
```

Expected: "OK: no Prisma schema drift detected".

- [ ] **Step 6: Regenerate Prisma client**

```bash
pnpm db:generate
```

### Task 18: Drop `useAgentFirstNav` from `seed.ts`

**Files:**

- Modify: `packages/db/prisma/seed.ts`

- [ ] **Step 1: Locate the line**

```bash
grep -n "useAgentFirstNav" packages/db/prisma/seed.ts
```

Expected: one hit (line 82 at spec time).

- [ ] **Step 2: Delete the field from the seed call**

Open `packages/db/prisma/seed.ts` and remove the line containing `useAgentFirstNav: true,` from inside the `OrganizationConfig.create({...})` call. Preserve trailing-comma correctness on adjacent lines if needed.

### Task 19: Drop `useAgentFirstNav` from `provision-dashboard-user.ts`

**Files:**

- Modify: `apps/dashboard/src/lib/provision-dashboard-user.ts`

- [ ] **Step 1: Locate the line**

```bash
grep -n "useAgentFirstNav" apps/dashboard/src/lib/provision-dashboard-user.ts
```

Expected: one hit (line 36 at spec time).

- [ ] **Step 2: Delete the line**

Open the file and remove the `useAgentFirstNav: true,` line from inside the upsert payload.

### Task 20: Drop `useAgentFirstNav` from API `organizations.ts`

**Files:**

- Modify: `apps/api/src/routes/organizations.ts`

- [ ] **Step 1: Locate the line**

```bash
grep -n "useAgentFirstNav" apps/api/src/routes/organizations.ts
```

Expected: one hit (line 72 at spec time, in the `create` branch of the upsert). The `update` branch already does not pass the field.

- [ ] **Step 2: Delete the line**

Open the file and remove the `useAgentFirstNav: true,` line.

### Task 21: Delete `api-organizations-flag-safety.test.ts`

**Files:**

- Delete: `apps/api/src/__tests__/api-organizations-flag-safety.test.ts`

- [ ] **Step 1: Remove the file**

```bash
git rm apps/api/src/__tests__/api-organizations-flag-safety.test.ts
```

The file's entire purpose is pinning the create-only invariant; with the column gone, the invariant is meaningless.

### Task 22: Trim the round-trip case from `api-organizations.test.ts`

**Files:**

- Modify: `apps/api/src/__tests__/api-organizations.test.ts`

- [ ] **Step 1: Locate the case**

```bash
grep -n "useAgentFirstNav\|Slice A PR 2" apps/api/src/__tests__/api-organizations.test.ts
```

Expected: hits in lines ~228–266 (the `it("Slice A PR 2: lazy-create branch sets useAgentFirstNav=true …", …)` block).

- [ ] **Step 2: Delete the entire `it(...)` block**

Open the file. Remove the whole `it("Slice A PR 2: lazy-create branch sets useAgentFirstNav=true and round-trips it in the response", async () => { ... })` block, including the closing `});` brace. Do not delete adjacent test cases. Do not leave a stub `it.skip()`.

### Task 23: Reset, typecheck, test, commit

- [ ] **Step 1: Reset and rebuild**

```bash
pnpm reset
```

Expected: cleans `dist/`, regenerates Prisma client, rebuilds schemas → core → db. Takes ~30–60s.

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck 2>&1 | tail -20
```

Expected: PASS. If a `useAgentFirstNav` reference surfaces (it shouldn't, but in case): **fix at the source**. Do not cast `OrganizationConfig` to `any` to silence (per CLAUDE.md "No `any`" + spec §6.2).

- [ ] **Step 3: Test**

```bash
pnpm test 2>&1 | tail -30
```

Expected: PASS. The two test edits (deleted file + trimmed case) should leave the rest of `api-organizations` test green.

If the known db integrity flake (per memory `feedback_db_integrity_tests_pg_advisory_lock`) reproduces, that's expected. Other failures are not.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma \
        packages/db/prisma/seed.ts \
        packages/db/prisma/migrations/ \
        apps/dashboard/src/lib/provision-dashboard-user.ts \
        apps/api/src/routes/organizations.ts \
        apps/api/src/__tests__/api-organizations.test.ts
git rm apps/api/src/__tests__/api-organizations-flag-safety.test.ts || true
git status --short
git commit -m "$(cat <<'EOF'
refactor(db,api,dashboard): retire OrganizationConfig.useAgentFirstNav

The flag was scaffolding for an agent-first vs legacy nav split that
this slice (D4+D5) makes unnecessary by deleting the legacy nav
outright. Pre-launch posture means no production data is preserved.

- packages/db/prisma/schema.prisma: drop the field
- packages/db/prisma/migrations/<TS>_drop_organization_config_use_agent_first_nav: ALTER TABLE DROP COLUMN
- packages/db/prisma/seed.ts: drop the field from seed
- apps/dashboard/src/lib/provision-dashboard-user.ts: drop from upsert
- apps/api/src/routes/organizations.ts: drop from create branch
- apps/api/src/__tests__/api-organizations-flag-safety.test.ts: delete
  (the create-only invariant becomes meaningless once the column is gone)
- apps/api/src/__tests__/api-organizations.test.ts: drop the
  Slice A PR 2 round-trip case; rest of the file unchanged

Spec: docs/superpowers/specs/2026-05-10-legacy-route-and-flag-retirement-d4-d5-design.md §6
EOF
)"
```

Expected: commit succeeds.

---

## Phase 6 — Final pass + acceptance gate

### Task 24: Final acceptance grep (hard gate)

**Files:** None (verification only)

**Scope of the hard gate:** searches `apps` and `packages` only. `docs` is excluded by design — the current D4+D5 spec and plan necessarily mention deleted route names (e.g., the §3 disposition matrix lists every deleted route as a literal string, and this plan repeats those names in code blocks). Including `docs` would produce expected hits that drown the signal. An optional informational pass over `docs` is in Step 3.

- [ ] **Step 1: Run the quoted-string acceptance grep**

```bash
grep -rnE '["'"'"']/(dashboard|escalations|decide|tasks|me|my-agent|modules|conversations|deployments)(/|["'"'"']|\?|#)' \
  apps packages \
  | grep -vE '^(packages/db/prisma/migrations/|docs/superpowers/specs/archive/)' \
  | grep -v "useAgentFirstNav"
```

Expected: **zero hits**. Hits in `packages/db/prisma/migrations/` (historical SQL) are explicitly allowed via the `grep -vE` filter — historical SQL doesn't get rewritten.

If hits come back, classify and fix:

- **In `apps/`**: a missed reference — fix the file (re-target or delete the reference) and re-run.
- **In `packages/`**: same — fix and re-run.

- [ ] **Step 2: Run the backtick template-literal acceptance grep**

Quoted-string grep doesn't catch template literals like `` `/decide/${id}` `` or `` `/me` ``. Run a second pass:

```bash
grep -rnE '`/(dashboard|escalations|decide|tasks|me|my-agent|modules|conversations|deployments)(/|`|\?|#|\$)' \
  apps packages \
  | grep -vE '^(packages/db/prisma/migrations/)' \
  | grep -v "useAgentFirstNav"
```

Expected: **zero hits**. Same classification rules as Step 1.

- [ ] **Step 3: Optional informational pass over `docs/`**

This is informational only — failures here do **not** block the PR.

```bash
grep -rnE '["'"'"'`]/(dashboard|escalations|decide|tasks|me|my-agent|modules|conversations|deployments)(/|["'"'"'`]|\?|#|\$)' \
  docs \
  | grep -vE '^docs/superpowers/specs/archive/' \
  | grep -vE '^docs/superpowers/specs/2026-05-10-legacy-route-and-flag-retirement-d4-d5-design\.md' \
  | grep -vE '^docs/superpowers/plans/2026-05-10-legacy-route-and-flag-retirement-d4-d5\.md'
```

Expected: hits are likely (other specs/plans/docs may reference legacy routes for history). Skim the output — anything that looks like a current document still steering operators toward a deleted route (e.g., a runbook telling them to "go to `/decide`") should be updated. Stale historical references in archived material are fine.

### Task 25: Manual smoke (positive + negative)

**Files:** None (interactive verification)

- [ ] **Step 1: Start the dev stack**

```bash
pnpm dev
```

Expected: dashboard on `:3002`, API on `:3000` (per project memory `project_dev_env_split_files`). If "Unable to load dashboard data" appears, check API on `:3000`, workspace builds, and seed-vs-runtime encryption (per memory `feedback_dev_stack`).

- [ ] **Step 2: Positive smoke (each route renders without 404 or console error)**

Visit in a browser:

- Editorial: `/`, `/alex`, `/riley`
- Mercury: `/contacts`, `/contacts/<known-id-from-seed>`, `/automations`, `/reports`
- Settings deep routes: `/settings`, `/settings/account` (verify the new "Sign out" button is there and works), `/settings/billing`, `/settings/team`, `/settings/identity`, `/settings/playbook`, `/settings/channels`, `/settings/knowledge`
- Onboarding/auth: `/login`, `/onboarding`, `/setup`
- Admin: `/operator/reports`

For each: confirm the page renders, no 404, no missing-import error in the dev server log, no React boundary error.

- [ ] **Step 3: Public marketing smoke (survival check for marketplace components)**

Visit `/agents/<known-published-slug>` (a public marketing agent profile page). Confirm `profile-tabs` renders without errors. This is the surviving consumer for `work-log-list`, `conversation-transcript`, and `trust-history-chart`. If your dev DB has no published agent profiles, at minimum hit the route — a 404 from missing data is fine; a missing-import error is not.

- [ ] **Step 4: Negative smoke — top-level deleted routes return 404**

Visit each:

- `/dashboard`
- `/decide`
- `/me`
- `/my-agent`
- `/modules`
- `/escalations`
- `/conversations`

Expected: each returns Next.js 404 (the new copy from `not-found.tsx`: "404 / Page not found / Back home").

- [ ] **Step 5: Negative smoke — nested deleted routes return 404**

Visit each:

- `/dashboard/roi`
- `/decide/abc`
- `/my-agent/abc`
- `/modules/creative`
- `/modules/foo/setup`
- `/deployments/abc`

Expected: each 404. This is the middleware/matcher cleanup verification — nested-path 404s confirm the matcher config no longer matches deleted prefixes.

- [ ] **Step 6: Onboarding-gating spot-check (the §5.4 behavioral change)**

If you can flip `onboardingComplete=false` for your dev org (e.g., directly in the DB or via the dev panel), do so, then visit `/contacts`. Expected: redirect to `/onboarding` (this is the new behavior — under pre-D4+D5 code, `/contacts` would have rendered without the redirect).

If you can't easily flip the flag, skip this step and rely on the AppShell unit tests (Task 2) for coverage.

### Task 26: Final commit + PR readiness

- [ ] **Step 1: Final validation sweep**

```bash
pnpm reset
pnpm typecheck 2>&1 | tail -10
pnpm lint 2>&1 | tail -10
pnpm test 2>&1 | tail -30
```

Expected: all PASS. The known db integrity flake (per memory `feedback_db_integrity_tests_pg_advisory_lock`) is acceptable.

- [ ] **Step 2: Commit any final cleanups (if any surfaced in Phase 6)**

If Tasks 24–25 surfaced any stragglers (a missed link, a forgotten test edit), commit them now:

```bash
git status --short
git diff --stat
git add <files>
git commit -m "$(cat <<'EOF'
chore(dashboard): final cleanups from D4+D5 acceptance pass

<one-line description of what was missed and fixed>
EOF
)"
```

If nothing surfaced (clean Phase 6), skip this step.

- [ ] **Step 3: Push and open PR**

```bash
git push -u origin feat/d4-d5-legacy-retirement
gh pr create --base main --title "feat(redesign): retire legacy routes + useAgentFirstNav (D4 + D5)" --body "$(cat <<'EOF'
## Summary

Pre-launch cleanup. Deletes every legacy-nav route under `apps/dashboard/src/app/(auth)/`, every component/hook used only by those routes, the `OwnerShell` / `OwnerTabs` chrome, and the now-vestigial `OrganizationConfig.useAgentFirstNav` flag. Single coordinated PR.

- Spec: `docs/superpowers/specs/2026-05-10-legacy-route-and-flag-retirement-d4-d5-design.md`
- Plan: `docs/superpowers/plans/2026-05-10-legacy-route-and-flag-retirement-d4-d5.md`

## Notable behavioral change

`AppShell` no longer conflates visual chrome with onboarding gating. New `ONBOARDING_EXEMPT_PATHS = ["/login", "/onboarding", "/setup"]` is intentionally narrower than `CHROME_HIDDEN_PATHS` — this means `/reports`, `/contacts`, `/automations`, `/settings`, `/operator/reports` will now enforce onboarding completion when they previously did not (because they were chrome-hidden, the old `useOrgConfig(!hideChrome && …)` guard suppressed the redirect). Treated as a beneficial side-effect; reviewer flips documented in spec §5.4.

## Test plan

- [ ] `pnpm reset && pnpm typecheck && pnpm lint && pnpm test` — all green
- [ ] Manual smoke per plan Task 25 (positive routes, settings deep routes, public marketing, negative top-level + nested)
- [ ] Final acceptance grep (plan Task 24) — zero hits

## Out of scope (deferred)

- Backend API endpoint deletion (`/api/escalations`, `/api/marketplace/*`, etc.) — roadmap Track #10
- Editorial-shell Tools nav additions — separate Phase D wrap-up

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR opens with the URL printed.

- [ ] **Step 4: Return PR URL**

Print the PR URL so the human reviewer has the link.

---

## Reference: spec sections to consult

| Concern                               | Spec section |
| ------------------------------------- | ------------ |
| Why this slice, what's included       | §1           |
| Decisions ledger + reviewer redirects | §2           |
| Per-route disposition                 | §3           |
| Per-file delete inventory             | §4           |
| AppShell new shape                    | §5           |
| Flag-retirement mechanics + commands  | §6           |
| Surviving-code href cleanups + grep   | §7           |
| Known UX gaps (deferred)              | §8           |
| Test plan + smoke targets             | §9           |
| Risk register                         | §10          |
| Out-of-scope follow-ups               | §11          |
| Commit-sequence guidance              | §12          |
