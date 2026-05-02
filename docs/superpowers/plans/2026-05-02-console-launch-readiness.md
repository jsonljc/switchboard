# Console Launch Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/console` as the operator's home at v1 launch by closing 6 launch-blocker findings (DC-01, DC-23, DC-39, DC-40, DC-58, DC-59) and 2 cross-tenant cache leak suspects (DC-11, DC-13) from the pre-launch surface audit, structured as 3 sequential PRs.

**Architecture:** Three short-lived branches off `main`, merged in sequence: **PR-1** wires queue-card actions via shared action hooks + slide-over UI, fixes login redirect, restores `OwnerTabs` on /console, hides the unwired Halt button. **PR-2** decomposes the whole-page fixture-fallback into per-zone graceful degradation, gates the Nova panel on module status, and branches the post-reply banner on delivery state. **PR-3** refactors React Query keys to be tenant-scoped and clears the cache on session change. Two-tenant browser repro before PR-3 merges to confirm or downgrade DC-11/DC-13 severity.

**Tech Stack:** Next.js 16 App Router, NextAuth v5 (JWT strategy), TanStack React Query v5, TypeScript ESM, Tailwind + Radix primitives (`@radix-ui/react-dialog` for the slide-over), Vitest + jsdom for tests (co-located in `__tests__/` folders), pnpm + Turborepo.

---

## Spec reference

The spec is the source of truth for: scope (in/out), the 8 question locks (Q1–Q8), architecture choices (slide-over pattern, per-zone degradation, scoped query keys), file paths verified against current main, success criteria.

**Read the spec before each phase:** `docs/superpowers/specs/2026-05-01-console-launch-readiness-design.md`.

## Branching strategy

- **PR-1** lands as `feat/console-pr1-actions-and-nav` off `main`. Merge before PR-2 branches.
- **PR-2** lands as `feat/console-pr2-truth-and-degradation` off the post-PR-1 `main`.
- **PR-3** lands as `feat/console-pr3-auth-integrity` off the post-PR-2 `main`. Run the two-tenant browser repro before PR-3 merges; the repro outcome determines whether DC-11 + DC-13 ship as Launch-blocker fixes (hard-prohibition: must Fix) or High defense-in-depth fixes.

This plan and the spec land together as a single `docs/superpowers/` PR off `main` (precedent: audit spec + plan PR #337). Implementation branches consume the spec + plan from main.

## File structure

### PR-1 files

| File / Path | What | Status |
|-------------|------|--------|
| `apps/dashboard/src/lib/auth.ts` | Plumb `Organization.onboardingComplete` through JWT + session callbacks (initial-sign-in only — see spec §12 caching guidance). | Modify |
| `apps/dashboard/src/types/next-auth.d.ts` | Add `onboardingComplete: boolean` to `Session`; `onboardingComplete?: boolean` to `JWT`. | Modify |
| `apps/dashboard/src/lib/__tests__/auth.test.ts` | Tests for the JWT/session callback extension. | Create |
| `apps/dashboard/src/app/login/page.tsx` | Replace precomputed `callbackUrl` default with session-aware logic in the post-auth `useEffect`. | Modify |
| `apps/dashboard/src/app/__tests__/login-redirect.test.ts` | Tests for `defaultCallback(session)` three-branch logic. | Create |
| `apps/dashboard/src/middleware.ts` | Add `/console`, `/escalations`, `/conversations` to `AUTH_PAGE_PREFIXES` (line 13) and `matcher` (line 113). | Modify |
| `apps/dashboard/src/__tests__/middleware.test.ts` | Add cases asserting protection for the three new prefixes. | Modify |
| `apps/dashboard/src/components/layout/app-shell.tsx` | Remove `"/console"` from `CHROME_HIDDEN_PATHS` (line 14). | Modify |
| `apps/dashboard/src/components/console/console.css` | Single-rule override for `[data-v6-console]` to coexist with the global `OwnerTabs` chrome (visual reconciliation). | Modify |
| `apps/dashboard/src/components/console/console-view.tsx` | Hide `op-halt` button (DC-41 deferral); add `onClick` wiring to queue card primary buttons; render `<ApprovalSlideOver>` + `<EscalationSlideOver>`; wire in-zone affordances as `<Link>`s. | Modify |
| `apps/dashboard/src/hooks/use-approval-action.ts` | Extracted shared mutation hook from `decide/page.tsx:115` `respondMutation`. | Create |
| `apps/dashboard/src/hooks/__tests__/use-approval-action.test.ts` | Tests for approve / reject / error paths + cache invalidation. | Create |
| `apps/dashboard/src/hooks/use-escalation-reply.ts` | Extracted shared mutation hook from inline reply submit in `escalation-list.tsx`. | Create |
| `apps/dashboard/src/hooks/__tests__/use-escalation-reply.test.ts` | Tests for 200 success path, 502 failure path. | Create |
| `apps/dashboard/src/components/console/slide-overs/console-slide-over.tsx` | Shared `Sheet` primitive (Radix dialog wrapper). | Create |
| `apps/dashboard/src/components/console/slide-overs/__tests__/console-slide-over.test.tsx` | Open/close + escape/click-outside behavior. | Create |
| `apps/dashboard/src/components/console/slide-overs/approval-slide-over.tsx` | Renders approval summary + Approve/Reject + "Open full detail →" deep-link. | Create |
| `apps/dashboard/src/components/console/slide-overs/__tests__/approval-slide-over.test.tsx` | Renders, calls `useApprovalAction.approve()` on click, deep-link present. | Create |
| `apps/dashboard/src/components/console/slide-overs/escalation-slide-over.tsx` | Renders transcript + reply textarea + Send + "Open full conversation →" deep-link. | Create |
| `apps/dashboard/src/components/console/slide-overs/__tests__/escalation-slide-over.test.tsx` | Renders, calls `useEscalationReply.send()` on click, deep-link present. | Create |
| `apps/dashboard/src/app/(auth)/decide/page.tsx` | Replace inline `respondMutation` with `useApprovalAction(id)`. Preserve `<RespondDialog>`. | Modify |
| `apps/dashboard/src/app/(auth)/decide/[id]/page.tsx` | Same swap. | Modify |
| `apps/dashboard/src/components/escalations/escalation-list.tsx` | Replace inline reply submit with `useEscalationReply(id)`. | Modify |
| `docs/audits/2026-05-01-pre-launch-surface/01-dashboard-core-findings.md` | Update Status of DC-39, DC-40, DC-41 (deferred), DC-59 to `Fixed (PR #__)` (or `Accepted (ship-with)` for DC-41 with re-evaluate date). | Modify |

### PR-2 files

| File / Path | What | Status |
|-------------|------|--------|
| `apps/dashboard/src/components/console/zones/zone-states.tsx` | Shared `<ZoneSkeleton>`, `<ZoneError>`, `<ZoneEmpty>` components. | Create |
| `apps/dashboard/src/components/console/zones/__tests__/zone-states.test.tsx` | Each renders correctly; `<ZoneError>` calls `onRetry`. | Create |
| `apps/dashboard/src/components/console/zones/op-strip.tsx` | Owns `useOrgConfig`; renders op-strip zone with own loading/error states. | Create |
| `apps/dashboard/src/components/console/zones/numbers-strip.tsx` | Owns `useDashboardOverview` for numbers; per-zone states. | Create |
| `apps/dashboard/src/components/console/zones/queue-zone.tsx` | Owns `useEscalations` + `useApprovals`; per-zone states. | Create |
| `apps/dashboard/src/components/console/zones/agent-strip.tsx` | Owns `useAgentRoster` + `useAgentState` + `useModuleStatus`; per-zone states. | Create |
| `apps/dashboard/src/components/console/zones/activity-trail.tsx` | Owns `useAudit`; per-zone states. | Create |
| `apps/dashboard/src/components/console/zones/nova-panel.tsx` | Owns `useModuleStatus()` gate (mirrors `moduleEnabled("ad-optimizer")` from `use-console-data.ts:80-86`); renders empty state when not live. | Create |
| `apps/dashboard/src/components/console/zones/__tests__/*.test.tsx` | Tests for each zone's loading/error/empty/data renders. | Create |
| `apps/dashboard/src/components/console/console-view.tsx` | Decompose: replace single composer with per-zone composition; remove `<div data-v6-console>`-level data prop; remove whole-page banner. | Modify |
| `apps/dashboard/src/app/(auth)/console/page.tsx` | Remove the page-level error banner block (lines 16-22); render `<ConsoleView />` directly without `data` prop. | Modify |
| `apps/dashboard/src/components/console/use-console-data.ts` | Delete file. | Delete |
| `apps/dashboard/src/components/console/console-data.ts` | Remove `consoleFixture` export from runtime; either delete or relocate to `__fixtures__/`. Tests previously consuming it import from new location. | Modify |
| `apps/dashboard/src/components/escalations/escalation-list.tsx` | Replace post-reply banner with state-branched copy: 200 → success toast/banner with channel-aware copy; 502 → failure copy + form preserved. Read `response.replySent` and `response.error` from existing API shape. | Modify |
| `apps/dashboard/src/components/escalations/__tests__/escalation-list-banner.test.tsx` | Test branched copy: success path, failure path, form-preservation on 502. | Create |
| `docs/audits/2026-05-01-pre-launch-surface/01-dashboard-core-findings.md` | Update Status of DC-01, DC-04, DC-23, DC-58 to `Fixed (PR #__)`. | Modify |

### PR-3 files

| File / Path | What | Status |
|-------------|------|--------|
| `apps/dashboard/src/lib/query-keys.ts` | Refactor: replace top-level `queryKeys` object with `scopedKeys(orgId)` factory function. Remove bare exports. | Modify |
| `apps/dashboard/src/lib/__tests__/query-keys.test.ts` | Test factory output shape; test scoping prefix on every key. | Create |
| `apps/dashboard/src/hooks/use-query-keys.ts` | New hook reading session.organizationId; returns `scopedKeys(orgId)` or `null`. | Create |
| `apps/dashboard/src/hooks/__tests__/use-query-keys.test.ts` | Test: returns `null` when unauthenticated; returns scoped factory output otherwise. | Create |
| `apps/dashboard/src/hooks/use-*.ts` (≈10 files) | Refactor every `useQuery` to consume `useScopedQueryKeys()` + `enabled: !!keys`. | Modify |
| `apps/dashboard/src/app/(auth)/decide/[id]/page.tsx:42` | Refactor inline `useQuery` to scoped keys. | Modify |
| `apps/dashboard/src/lib/sign-out.ts` | New wrapper exporting `signOut()` that calls `queryClient.clear()` then NextAuth `signOut`. | Create |
| `apps/dashboard/src/lib/__tests__/sign-out.test.ts` | Test: clear runs before NextAuth signOut. | Create |
| Every signOut call site | Swap `signOut` import from `next-auth/react` to local `@/lib/sign-out`. | Modify |
| `docs/audits/2026-05-01-pre-launch-surface/01-dashboard-core-findings.md` | Update Status of DC-11, DC-13 to `Fixed (PR #__)` (or `Accepted (ship-with)` if browser repro shows no leak today). Record two-tenant repro outcome inline in the finding. | Modify |
| `docs/audits/2026-05-01-pre-launch-surface/artifacts/01-dashboard-core/repros/two-tenant-cache-leak.md` | Document the three-case repro result (PASS/FAIL per case + screenshots if FAIL). | Create |

## Resume protocol (if resuming a partial session)

If a previous session was interrupted mid-task:

1. Find the latest in-progress phase by reading `git log --oneline` on the current branch and matching commit messages to task numbers in this plan.
2. Read the spec sections relevant to the current phase before continuing.
3. Resume from the first unchecked step in the next task.

---

# Phase A — PR-1: Operator can use /console

## Task 1: Pre-flight

**Files:** none modified.

- [ ] **Step 1:** Confirm branch context.

  ```bash
  cd /Users/jasonli/switchboard
  git fetch origin main
  git checkout -b feat/console-pr1-actions-and-nav origin/main
  git branch --show-current
  git status --short
  ```

  Expected: on `feat/console-pr1-actions-and-nav`, tree clean.

- [ ] **Step 2:** Verify baseline tests + typecheck pass.

  ```bash
  pnpm test
  pnpm typecheck
  ```

  Expected: both PASS. If `pnpm typecheck` reports missing exports from `@switchboard/schemas`, `@switchboard/db`, or `@switchboard/core`, run `pnpm reset` first per `CLAUDE.md`.

- [ ] **Step 3:** Confirm dashboard builds.

  ```bash
  pnpm --filter @switchboard/dashboard build
  ```

  Expected: build completes without errors.

---

## Task 2: Plumb `onboardingComplete` through NextAuth session

**Files:**
- Modify: `apps/dashboard/src/types/next-auth.d.ts`
- Modify: `apps/dashboard/src/lib/auth.ts:182-235` (jwt + session callbacks)
- Create: `apps/dashboard/src/lib/__tests__/auth-onboarding.test.ts`

Per spec §12: `Organization.onboardingComplete` exists in Prisma. Read it on initial sign-in only (the JWT callback's `if (user)` branch); do NOT re-query on every token refresh.

- [ ] **Step 1:** Extend the type augmentation.

  Open `apps/dashboard/src/types/next-auth.d.ts`. After the existing `Session` interface lines, add `onboardingComplete: boolean;`:

  ```ts
  declare module "next-auth" {
    interface Session {
      user: {
        id: string;
        email: string;
        name?: string | null;
      };
      organizationId: string;
      principalId: string;
      onboardingComplete: boolean;
    }

    interface User {
      organizationId?: string;
      principalId?: string;
    }
  }

  declare module "next-auth/jwt" {
    interface JWT {
      id?: string;
      organizationId?: string;
      principalId?: string;
      onboardingComplete?: boolean;
    }
  }
  ```

- [ ] **Step 2:** Write the failing test.

  Create `apps/dashboard/src/lib/__tests__/auth-onboarding.test.ts`:

  ```ts
  import { describe, it, expect, vi } from "vitest";

  // We test the callbacks in isolation by importing the config object.
  // If auth.ts doesn't export the config, refactor to export `authConfig`
  // alongside the NextAuth() invocation.
  import { authConfig } from "../auth";

  describe("auth callbacks: onboardingComplete plumbing", () => {
    it("populates token.onboardingComplete from Prisma on initial sign-in", async () => {
      const findUnique = vi.fn().mockResolvedValue({
        id: "org-1",
        onboardingComplete: true,
      });
      const prismaStub = {
        organization: { findUnique },
        dashboardUser: {
          findUnique: vi.fn().mockResolvedValue({ emailVerified: null }),
        },
      };
      const callbacks = authConfig.callbacks!;
      const token = await callbacks.jwt!({
        token: {},
        user: {
          id: "u-1",
          email: "a@b.c",
          organizationId: "org-1",
          principalId: "p-1",
        } as unknown as never,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prisma: prismaStub as any,
      } as never);
      expect(token.onboardingComplete).toBe(true);
      expect(findUnique).toHaveBeenCalledWith({
        where: { id: "org-1" },
        select: { onboardingComplete: true },
      });
    });

    it("does NOT re-query onboardingComplete on token refresh (no user object)", async () => {
      const findUnique = vi.fn();
      const callbacks = authConfig.callbacks!;
      const token = await callbacks.jwt!({
        token: { id: "u-1", organizationId: "org-1", onboardingComplete: true },
        user: undefined,
      } as never);
      expect(findUnique).not.toHaveBeenCalled();
      expect(token.onboardingComplete).toBe(true);
    });

    it("session callback copies onboardingComplete from token", async () => {
      const callbacks = authConfig.callbacks!;
      const session = await callbacks.session!({
        session: { user: { id: "", email: "a@b.c" } } as never,
        token: {
          id: "u-1",
          organizationId: "org-1",
          principalId: "p-1",
          onboardingComplete: false,
        } as never,
      } as never);
      expect((session as { onboardingComplete: boolean }).onboardingComplete).toBe(false);
    });
  });
  ```

  Note: this test assumes auth.ts exports `authConfig` separately from the `NextAuth(authConfig)` call. If it does not today, the next step also splits the export.

- [ ] **Step 3:** Run the test to verify it fails.

  ```bash
  pnpm --filter @switchboard/dashboard test src/lib/__tests__/auth-onboarding.test.ts
  ```

  Expected: FAIL — `authConfig` not exported, or callbacks don't set `onboardingComplete`.

- [ ] **Step 4:** Refactor `auth.ts` to export the config and extend the callbacks.

  In `apps/dashboard/src/lib/auth.ts`, change the bottom block from:

  ```ts
  export const { handlers, signIn, signOut, auth } = NextAuth({
    secret: process.env.NEXTAUTH_SECRET,
    providers,
    adapter: { /* ... existing ... */ },
    session: { strategy: "jwt" },
    pages: { /* ... existing ... */ },
    callbacks: {
      async jwt({ token, user }) { /* existing */ },
      async session({ session, token }) { /* existing */ },
    },
  });
  ```

  to:

  ```ts
  export const authConfig: NextAuthConfig = {
    secret: process.env.NEXTAUTH_SECRET,
    providers,
    adapter: { /* ... existing ... */ },
    session: { strategy: "jwt" },
    pages: { /* ... existing ... */ },
    callbacks: {
      async jwt({ token, user }) {
        if (user) {
          token.id = user.id;
          const credUser = user as typeof user & {
            organizationId?: string;
            principalId?: string;
          };
          if (credUser.organizationId) {
            token.organizationId = credUser.organizationId;
            token.principalId = credUser.principalId;
          } else {
            const dashUser = await prisma.dashboardUser.findUnique({ where: { id: user.id } });
            if (dashUser) {
              token.organizationId = dashUser.organizationId;
              token.principalId = dashUser.principalId;
            }
          }
          // ── NEW: read onboardingComplete on initial sign-in only ──
          if (token.organizationId) {
            const org = await prisma.organization.findUnique({
              where: { id: token.organizationId as string },
              select: { onboardingComplete: true },
            });
            token.onboardingComplete = org?.onboardingComplete ?? false;
          }
        }
        // Existing emailVerified refresh stays as-is — runs on every refresh.
        if (token.id) {
          const freshUser = await prisma.dashboardUser.findUnique({
            where: { id: token.id as string },
            select: { emailVerified: true },
          });
          token.emailVerified = freshUser?.emailVerified?.toISOString() ?? null;
        }
        return token;
      },
      async session({ session, token }) {
        if (token.id) session.user.id = token.id as string;
        const ext = session as unknown as Record<string, unknown>;
        ext.organizationId = token.organizationId;
        ext.principalId = token.principalId;
        ext.onboardingComplete = token.onboardingComplete ?? false;
        ext.emailVerified = token.emailVerified ?? null;
        return session;
      },
    },
  };

  export const { handlers, signIn, signOut, auth } = NextAuth(authConfig);
  ```

- [ ] **Step 5:** Run the test, watch it pass.

  ```bash
  pnpm --filter @switchboard/dashboard test src/lib/__tests__/auth-onboarding.test.ts
  ```

  Expected: 3/3 PASS.

- [ ] **Step 6:** Verify the rest of the dashboard tests still pass.

  ```bash
  pnpm --filter @switchboard/dashboard test
  pnpm --filter @switchboard/dashboard typecheck
  ```

  Expected: all PASS.

- [ ] **Step 7:** Commit.

  ```bash
  git add apps/dashboard/src/lib/auth.ts apps/dashboard/src/types/next-auth.d.ts apps/dashboard/src/lib/__tests__/auth-onboarding.test.ts
  git commit -m "feat(dashboard): plumb onboardingComplete through NextAuth session"
  ```

---

## Task 3: Login redirect — session-aware default

**Files:**
- Modify: `apps/dashboard/src/app/login/page.tsx:23,29,48` (redirect logic)
- Create: `apps/dashboard/src/app/__tests__/login-redirect.test.ts`

Per spec §4.4: `defaultCallback(session)` runs in the post-auth `useEffect`, not at render time.

- [ ] **Step 1:** Write the failing test.

  Create `apps/dashboard/src/app/__tests__/login-redirect.test.ts`:

  ```ts
  import { describe, it, expect } from "vitest";
  import { defaultCallback } from "../login/redirect-logic";

  describe("defaultCallback", () => {
    it("returns /onboarding when session has no organizationId", () => {
      expect(defaultCallback(null)).toBe("/onboarding");
      expect(defaultCallback({ user: { id: "u" } } as never)).toBe("/onboarding");
    });

    it("returns /onboarding when session has organizationId but onboardingComplete is false", () => {
      expect(
        defaultCallback({
          user: { id: "u" },
          organizationId: "org-1",
          onboardingComplete: false,
        } as never),
      ).toBe("/onboarding");
    });

    it("returns /console when session is fully onboarded", () => {
      expect(
        defaultCallback({
          user: { id: "u" },
          organizationId: "org-1",
          onboardingComplete: true,
        } as never),
      ).toBe("/console");
    });
  });
  ```

- [ ] **Step 2:** Run the test, watch it fail.

  ```bash
  pnpm --filter @switchboard/dashboard test src/app/__tests__/login-redirect.test.ts
  ```

  Expected: FAIL — module `../login/redirect-logic` not found.

- [ ] **Step 3:** Extract `defaultCallback` into its own module.

  Create `apps/dashboard/src/app/login/redirect-logic.ts`:

  ```ts
  import type { Session } from "next-auth";

  /**
   * Resolve the post-login destination based on session shape.
   * - No org → /onboarding (user hasn't been provisioned to a tenant yet)
   * - Org but onboarding incomplete → /onboarding (resume the wizard)
   * - Otherwise → /console (the operator's home at v1 launch)
   */
  export function defaultCallback(session: Session | null): string {
    if (!session?.organizationId) return "/onboarding";
    const onboardingComplete = (session as Session & { onboardingComplete?: boolean })
      .onboardingComplete;
    if (!onboardingComplete) return "/onboarding";
    return "/console";
  }
  ```

- [ ] **Step 4:** Run the test, watch it pass.

  ```bash
  pnpm --filter @switchboard/dashboard test src/app/__tests__/login-redirect.test.ts
  ```

  Expected: 3/3 PASS.

- [ ] **Step 5:** Wire the helper into `login/page.tsx`.

  In `apps/dashboard/src/app/login/page.tsx`:

  - At the top, add: `import { defaultCallback } from "./redirect-logic";`
  - Replace line 23 (`const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";`) with: `const explicitCallback = searchParams.get("callbackUrl");`
  - Update the `useEffect` (lines 25–31) to compute the destination at navigation time:

    ```ts
    const { data: session, status } = useSession();

    useEffect(() => {
      if (status !== "authenticated") return;
      const target = explicitCallback ?? defaultCallback(session);
      router.push(target);
    }, [status, session, explicitCallback, router]);
    ```

  - Update line 48 (`window.location.href = callbackUrl;`) to:

    ```ts
    window.location.href = explicitCallback ?? "/";
    ```

    (After credentials sign-in, NextAuth refreshes the session in the background; the `useEffect` above takes over once `status === "authenticated"`. Pushing to `/` is safe because the auth-page guard in middleware will route based on session shape; alternatively, push directly to a sentinel page that does the same `defaultCallback` resolution. For PR-1 simplicity, route through `/` and let the existing auth flow re-resolve.)

  - Update line 55 (`await signIn("email", { email, callbackUrl });`) to: `await signIn("email", { email, callbackUrl: explicitCallback ?? "/" });`
  - Update line 190 (`onClick={() => signIn("google", { callbackUrl })}`) similarly: `onClick={() => signIn("google", { callbackUrl: explicitCallback ?? "/" })}`

- [ ] **Step 6:** Run dashboard tests + typecheck.

  ```bash
  pnpm --filter @switchboard/dashboard test
  pnpm --filter @switchboard/dashboard typecheck
  ```

  Expected: all PASS.

- [ ] **Step 7:** Commit.

  ```bash
  git add apps/dashboard/src/app/login/page.tsx apps/dashboard/src/app/login/redirect-logic.ts apps/dashboard/src/app/__tests__/login-redirect.test.ts
  git commit -m "feat(dashboard): session-aware login redirect to console or onboarding"
  ```

---

## Task 4: Middleware — protect /console, /escalations, /conversations

**Files:**
- Modify: `apps/dashboard/src/middleware.ts:13` (`AUTH_PAGE_PREFIXES`)
- Modify: `apps/dashboard/src/middleware.ts:113` (`matcher`)
- Modify: `apps/dashboard/src/__tests__/middleware.test.ts` (add cases)

Closes audit DC-10 finding.

- [ ] **Step 1:** Add failing test cases.

  In `apps/dashboard/src/__tests__/middleware.test.ts`, find the existing test block (likely a `describe("middleware", ...)`). Add three cases (paste alongside existing tests; replace the placeholder request-helper with the file's existing pattern):

  ```ts
  it("redirects unauthenticated /console to /login", async () => {
    const req = new NextRequest("http://localhost:3002/console");
    // ... apply existing pattern from the file's other tests for stubbing session ...
    const res = await middleware(req);
    expect(res?.headers.get("location")).toMatch(/\/login/);
  });

  it("redirects unauthenticated /escalations to /login", async () => {
    const req = new NextRequest("http://localhost:3002/escalations");
    const res = await middleware(req);
    expect(res?.headers.get("location")).toMatch(/\/login/);
  });

  it("redirects unauthenticated /conversations to /login", async () => {
    const req = new NextRequest("http://localhost:3002/conversations");
    const res = await middleware(req);
    expect(res?.headers.get("location")).toMatch(/\/login/);
  });
  ```

  Read the existing test for `/dashboard` to copy the session-stub pattern exactly. Vitest test syntax is identical; the stubbing will use the same `vi.mock` calls already present.

- [ ] **Step 2:** Run, watch fail.

  ```bash
  pnpm --filter @switchboard/dashboard test src/__tests__/middleware.test.ts
  ```

  Expected: 3 new tests FAIL (middleware doesn't yet protect those routes).

- [ ] **Step 3:** Update `AUTH_PAGE_PREFIXES`.

  In `apps/dashboard/src/middleware.ts:13`, add three entries (preserve order; add at the end):

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
    "/console",
    "/escalations",
    "/conversations",
  ] as const;
  ```

- [ ] **Step 4:** Update `matcher`.

  In `apps/dashboard/src/middleware.ts:113`, add three matcher entries:

  ```ts
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
    "/console/:path*",
    "/escalations/:path*",
    "/conversations/:path*",
  ],
  ```

- [ ] **Step 5:** Run tests, watch them pass.

  ```bash
  pnpm --filter @switchboard/dashboard test src/__tests__/middleware.test.ts
  ```

  Expected: all PASS.

- [ ] **Step 6:** Commit.

  ```bash
  git add apps/dashboard/src/middleware.ts apps/dashboard/src/__tests__/middleware.test.ts
  git commit -m "fix(dashboard): protect /console, /escalations, /conversations via middleware (DC-10)"
  ```

---

## Task 5: Re-show OwnerTabs on /console

**Files:**
- Modify: `apps/dashboard/src/components/layout/app-shell.tsx:14` (`CHROME_HIDDEN_PATHS`)
- Modify: `apps/dashboard/src/components/console/console.css` (visual reconciliation override)

Closes audit DC-40.

- [ ] **Step 1:** Edit `CHROME_HIDDEN_PATHS`.

  In `apps/dashboard/src/components/layout/app-shell.tsx`, line 14, change:

  ```ts
  const CHROME_HIDDEN_PATHS = ["/login", "/onboarding", "/setup", "/console"];
  ```

  to:

  ```ts
  const CHROME_HIDDEN_PATHS = ["/login", "/onboarding", "/setup"];
  ```

- [ ] **Step 2:** Visual smoke check.

  Start the dashboard:

  ```bash
  pnpm --filter @switchboard/dashboard dev
  ```

  Navigate to http://localhost:3002/console. Confirm `OwnerTabs` (the global bottom-tab nav) is visible. Capture a screenshot for the audit's artifacts dir; you'll attach it to the PR description.

- [ ] **Step 3:** Reconcile visual clash.

  The `[data-v6-console]` warm-clay palette will likely visually clash with the global `OwnerTabs` chrome. Open `apps/dashboard/src/components/console/console.css` and add a single override block at the bottom (only if visual review shows the clash):

  ```css
  /* Visual reconciliation: OwnerTabs chrome on /console.
     /console keeps its scoped warm-clay design system (see audit DC-14
     ship-with) but the global nav bar must remain readable on top of it. */
  body:has([data-v6-console]) nav[data-owner-tabs] {
    background: var(--global-nav-bg, hsl(45 25% 98%));
    color: var(--global-nav-fg);
  }
  ```

  Verify the selector by inspecting the actual `OwnerTabs` element's `data-` attribute or class in DevTools; replace `[data-owner-tabs]` with whatever the component actually emits. If `OwnerTabs` accepts a className prop, threading a `console-mode` class is cleaner than a `:has()` selector.

  If visual review shows the clash is irreconcilable with a single rule, escalate per spec §10 — accelerate DC-14's fold-in pre-launch instead of post-30. Note the call in the PR description; do not attempt the fold-in inside this task.

- [ ] **Step 4:** Run tests + typecheck.

  ```bash
  pnpm --filter @switchboard/dashboard test
  pnpm --filter @switchboard/dashboard typecheck
  ```

  Expected: all PASS.

- [ ] **Step 5:** Commit.

  ```bash
  git add apps/dashboard/src/components/layout/app-shell.tsx apps/dashboard/src/components/console/console.css
  git commit -m "feat(dashboard): re-show OwnerTabs on /console (DC-40)"
  ```

---

## Task 6: Hide unwired Halt button

**Files:**
- Modify: `apps/dashboard/src/components/console/console-view.tsx`

Closes audit DC-41 deferral (move to post-launch backlog).

- [ ] **Step 1:** Locate the Halt button.

  ```bash
  grep -n "op-halt\|Halt" apps/dashboard/src/components/console/console-view.tsx
  ```

  Expected: a `<button className="op-halt" ...>Halt</button>` line in the op-strip section.

- [ ] **Step 2:** Remove the button + its surrounding affordance.

  Open `console-view.tsx`. Delete the `<button className="op-halt" ...>Halt</button>` element. The "Live"/"Halted" status pill stays (read-only indicator). If the parent `<div className="op-right">` becomes empty, leave it — it preserves spacing.

- [ ] **Step 3:** Smoke check.

  Reload http://localhost:3002/console. Confirm Halt button is gone; "Live" pulse remains.

- [ ] **Step 4:** Commit.

  ```bash
  git add apps/dashboard/src/components/console/console-view.tsx
  git commit -m "feat(dashboard): hide unwired Halt button (DC-41 deferred to post-launch)"
  ```

---

## Task 7: Extract `useApprovalAction(id)` hook

**Files:**
- Create: `apps/dashboard/src/hooks/use-approval-action.ts`
- Create: `apps/dashboard/src/hooks/__tests__/use-approval-action.test.ts`

Per spec §4.1: shared mutation logic between `<RespondDialog>` (decide page) and the new `<ApprovalSlideOver>`. Extract from the inline `respondMutation` at `apps/dashboard/src/app/(auth)/decide/page.tsx:115`.

- [ ] **Step 1:** Read the existing inline mutation for context.

  ```bash
  sed -n '110,140p' apps/dashboard/src/app/\(auth\)/decide/page.tsx
  ```

  Note the call signature, the API endpoint hit, the cache invalidation, the toast.

- [ ] **Step 2:** Write the failing test.

  Create `apps/dashboard/src/hooks/__tests__/use-approval-action.test.ts`:

  ```ts
  import { describe, it, expect, vi, beforeEach } from "vitest";
  import { renderHook, waitFor } from "@testing-library/react";
  import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
  import type { ReactNode } from "react";
  import { useApprovalAction } from "../use-approval-action";

  global.fetch = vi.fn();

  const wrapper = ({ children }: { children: ReactNode }) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };

  describe("useApprovalAction", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("posts to /api/dashboard/approvals/:id with kind=approved on approve()", async () => {
      (global.fetch as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
        ok: true,
        json: async () => ({ status: "approved" }),
      });
      const { result } = renderHook(() => useApprovalAction("a-1"), { wrapper });
      await result.current.approve();
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/dashboard/approvals/a-1",
          expect.objectContaining({
            method: "POST",
            body: expect.stringContaining('"action":"approved"'),
          }),
        );
      });
    });

    it("posts kind=rejected on reject()", async () => {
      (global.fetch as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
        ok: true,
        json: async () => ({ status: "rejected" }),
      });
      const { result } = renderHook(() => useApprovalAction("a-1"), { wrapper });
      await result.current.reject();
      await waitFor(() => {
        const call = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
        expect(call[1] as { body: string }).toMatchObject({
          body: expect.stringContaining('"action":"rejected"'),
        });
      });
    });

    it("throws on non-ok response", async () => {
      (global.fetch as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: "boom" }),
      });
      const { result } = renderHook(() => useApprovalAction("a-1"), { wrapper });
      await expect(result.current.approve()).rejects.toThrow();
    });
  });
  ```

  Note: the React `<>` JSX above requires the test file to be `.tsx` if your config requires it. If it does, name the file `use-approval-action.test.tsx`.

- [ ] **Step 3:** Run, watch fail.

  ```bash
  pnpm --filter @switchboard/dashboard test src/hooks/__tests__/use-approval-action
  ```

  Expected: FAIL — module not found.

- [ ] **Step 4:** Implement the hook.

  Create `apps/dashboard/src/hooks/use-approval-action.ts`:

  ```ts
  import { useMutation, useQueryClient } from "@tanstack/react-query";
  import { useSession } from "next-auth/react";
  import { queryKeys } from "@/lib/query-keys";

  export interface ApprovalActionPayload {
    note?: string;
  }

  /**
   * Shared mutation hook for approval responses.
   *
   * Used by:
   *   - /decide list page <RespondDialog>
   *   - /decide/[id] detail page
   *   - /console <ApprovalSlideOver>
   *
   * Both surfaces approve/reject through this single hook so they cannot
   * diverge on payload shape, cache invalidation, or error handling.
   */
  export function useApprovalAction(approvalId: string) {
    const queryClient = useQueryClient();
    const { data: session } = useSession();

    const respond = useMutation({
      mutationFn: async (input: { action: "approved" | "rejected" } & ApprovalActionPayload) => {
        const respondedBy =
          (session as unknown as { principalId?: string } | null)?.principalId ?? "dashboard-user";
        const res = await fetch(`/api/dashboard/approvals/${approvalId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...input, respondedBy }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            (body as { error?: string }).error ?? `Approval action failed (HTTP ${res.status})`,
          );
        }
        return res.json();
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.approvals.pending() });
      },
    });

    return {
      approve: (note?: string) => respond.mutateAsync({ action: "approved", note }),
      reject: (note?: string) => respond.mutateAsync({ action: "rejected", note }),
      isPending: respond.isPending,
      error: respond.error,
    };
  }
  ```

- [ ] **Step 5:** Run, watch pass.

  ```bash
  pnpm --filter @switchboard/dashboard test src/hooks/__tests__/use-approval-action
  ```

  Expected: 3/3 PASS.

- [ ] **Step 6:** Refactor `decide/page.tsx` to consume the hook.

  Open `apps/dashboard/src/app/(auth)/decide/page.tsx`. Replace the inline `respondMutation = useMutation(...)` block (lines ~115–140) and its call sites (lines ~341) with calls to `useApprovalAction(id).approve()` / `.reject()`. The `<RespondDialog>` props become straightforward — `onApprove`, `onReject`, `isPending` thread through.

  Preserve `<RespondDialog>`'s existing UX (confirmation dialog text, "Confirm Rejection" copy — which DC-26/DC-27 mark as Medium and stay open in the audit; do not change copy here).

- [ ] **Step 7:** Refactor `decide/[id]/page.tsx` similarly.

  Same pattern.

- [ ] **Step 8:** Run all tests + typecheck.

  ```bash
  pnpm --filter @switchboard/dashboard test
  pnpm --filter @switchboard/dashboard typecheck
  ```

  Expected: all PASS.

- [ ] **Step 9:** Commit.

  ```bash
  git add apps/dashboard/src/hooks/use-approval-action.ts apps/dashboard/src/hooks/__tests__/use-approval-action* apps/dashboard/src/app/\(auth\)/decide/
  git commit -m "feat(dashboard): extract useApprovalAction hook shared by decide and slide-over"
  ```

---

## Task 8: Extract `useEscalationReply(id)` hook

**Files:**
- Create: `apps/dashboard/src/hooks/use-escalation-reply.ts`
- Create: `apps/dashboard/src/hooks/__tests__/use-escalation-reply.test.tsx`

Per spec §4.2 + §5.2: shared mutation logic between the existing `/escalations` reply form and the new `<EscalationSlideOver>`. Branches on 200 vs 502.

- [ ] **Step 1:** Read existing reply submit logic.

  ```bash
  grep -n "respond\|/respond\|escalation.*reply" apps/dashboard/src/components/escalations/escalation-list.tsx
  ```

  Note the inline call to `/api/dashboard/escalations/[id]/respond`.

- [ ] **Step 2:** Write the failing test.

  Create `apps/dashboard/src/hooks/__tests__/use-escalation-reply.test.tsx`:

  ```tsx
  import { describe, it, expect, vi, beforeEach } from "vitest";
  import { renderHook, waitFor } from "@testing-library/react";
  import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
  import type { ReactNode } from "react";
  import { useEscalationReply } from "../use-escalation-reply";

  global.fetch = vi.fn();

  const wrapper = ({ children }: { children: ReactNode }) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };

  describe("useEscalationReply", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("returns { ok: true, ... } on 200 success", async () => {
      (global.fetch as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          escalation: { id: "e-1", channel: "telegram" },
          replySent: true,
        }),
      });
      const { result } = renderHook(() => useEscalationReply("e-1"), { wrapper });
      const out = await result.current.send("hello");
      expect(out.ok).toBe(true);
      expect(out.escalation.channel).toBe("telegram");
    });

    it("returns { ok: false, error } on 502 proactive-delivery failure", async () => {
      (global.fetch as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({
          escalation: { id: "e-1", channel: "telegram" },
          replySent: false,
          error: "Reply saved but channel delivery failed.",
          statusCode: 502,
        }),
      });
      const { result } = renderHook(() => useEscalationReply("e-1"), { wrapper });
      const out = await result.current.send("hello");
      expect(out.ok).toBe(false);
      expect(out.error).toContain("channel delivery failed");
    });

    it("throws on non-200/502 (true server error)", async () => {
      (global.fetch as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: "internal" }),
      });
      const { result } = renderHook(() => useEscalationReply("e-1"), { wrapper });
      await expect(result.current.send("hello")).rejects.toThrow();
    });
  });
  ```

- [ ] **Step 3:** Run, watch fail.

  ```bash
  pnpm --filter @switchboard/dashboard test src/hooks/__tests__/use-escalation-reply
  ```

  Expected: FAIL — module not found.

- [ ] **Step 4:** Implement the hook.

  Create `apps/dashboard/src/hooks/use-escalation-reply.ts`:

  ```ts
  import { useMutation, useQueryClient } from "@tanstack/react-query";
  import { queryKeys } from "@/lib/query-keys";

  export interface EscalationReplyResult {
    ok: boolean;
    escalation: { id: string; channel: string };
    error?: string;
  }

  /**
   * Shared mutation hook for escalation replies.
   *
   * The API at /api/dashboard/escalations/:id/respond returns:
   *   - 200 { escalation, replySent: true }
   *   - 502 { escalation, replySent: false, error, statusCode } — saved but delivery failed
   *   - 5xx (other) — true server error, surface as thrown
   *
   * The hook normalizes 200 and 502 into a result object so callers can
   * branch their UI without throwing on the expected delivery-failure path.
   */
  export function useEscalationReply(escalationId: string) {
    const queryClient = useQueryClient();

    const reply = useMutation({
      mutationFn: async (text: string): Promise<EscalationReplyResult> => {
        const res = await fetch(`/api/dashboard/escalations/${escalationId}/respond`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          escalation?: { id: string; channel: string };
          replySent?: boolean;
          error?: string;
          statusCode?: number;
        };
        if (res.status === 502 && body.escalation) {
          return {
            ok: false,
            escalation: body.escalation,
            error: body.error ?? "Channel delivery failed.",
          };
        }
        if (!res.ok) {
          throw new Error(body.error ?? `Escalation reply failed (HTTP ${res.status})`);
        }
        if (!body.escalation) throw new Error("Malformed escalation reply response");
        return { ok: true, escalation: body.escalation };
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.escalations.all });
      },
    });

    return {
      send: (text: string) => reply.mutateAsync(text),
      isPending: reply.isPending,
    };
  }
  ```

- [ ] **Step 5:** Run, watch pass.

  ```bash
  pnpm --filter @switchboard/dashboard test src/hooks/__tests__/use-escalation-reply
  ```

  Expected: 3/3 PASS.

- [ ] **Step 6:** Refactor `escalation-list.tsx` to consume the hook.

  Replace the inline reply submit logic with `useEscalationReply(id).send(text)`. On the result object, branch the UI:

  - `ok === true` → existing success state (will be replaced with branched copy in PR-2 Task 24; for PR-1, preserve current behavior).
  - `ok === false` → keep form open with text preserved, surface the existing error path.

  The full banner copy refactor lands in PR-2 Task 24; PR-1 only swaps the mutation source.

- [ ] **Step 7:** Run all tests + typecheck.

  ```bash
  pnpm --filter @switchboard/dashboard test
  pnpm --filter @switchboard/dashboard typecheck
  ```

  Expected: all PASS.

- [ ] **Step 8:** Commit.

  ```bash
  git add apps/dashboard/src/hooks/use-escalation-reply.ts apps/dashboard/src/hooks/__tests__/use-escalation-reply* apps/dashboard/src/components/escalations/escalation-list.tsx
  git commit -m "feat(dashboard): extract useEscalationReply hook with 200/502 branching"
  ```

---

## Task 9: Build shared `<ConsoleSlideOver>` Sheet primitive

**Files:**
- Create: `apps/dashboard/src/components/console/slide-overs/console-slide-over.tsx`
- Create: `apps/dashboard/src/components/console/slide-overs/__tests__/console-slide-over.test.tsx`

Per spec §4.1: a single Radix-based slide-over surface that approval and escalation variants ride on.

- [ ] **Step 1:** Confirm `@radix-ui/react-dialog` is available.

  ```bash
  grep '"@radix-ui/react-dialog"' apps/dashboard/package.json
  ```

  Expected: present (verified during spec self-review). If absent, install: `pnpm add --filter @switchboard/dashboard @radix-ui/react-dialog`.

- [ ] **Step 2:** Write the failing test.

  Create `apps/dashboard/src/components/console/slide-overs/__tests__/console-slide-over.test.tsx`:

  ```tsx
  import { describe, it, expect, vi } from "vitest";
  import { render, screen, fireEvent } from "@testing-library/react";
  import { ConsoleSlideOver } from "../console-slide-over";

  describe("ConsoleSlideOver", () => {
    it("renders children when open", () => {
      render(
        <ConsoleSlideOver open onOpenChange={() => {}} title="Test">
          <p>Body</p>
        </ConsoleSlideOver>,
      );
      expect(screen.getByText("Body")).toBeInTheDocument();
      expect(screen.getByText("Test")).toBeInTheDocument();
    });

    it("does not render children when closed", () => {
      render(
        <ConsoleSlideOver open={false} onOpenChange={() => {}} title="Test">
          <p>Body</p>
        </ConsoleSlideOver>,
      );
      expect(screen.queryByText("Body")).not.toBeInTheDocument();
    });

    it("calls onOpenChange(false) when close button clicked", () => {
      const onOpenChange = vi.fn();
      render(
        <ConsoleSlideOver open onOpenChange={onOpenChange} title="Test">
          <p>Body</p>
        </ConsoleSlideOver>,
      );
      fireEvent.click(screen.getByRole("button", { name: /close/i }));
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
  ```

- [ ] **Step 3:** Run, watch fail.

  ```bash
  pnpm --filter @switchboard/dashboard test src/components/console/slide-overs/__tests__/console-slide-over
  ```

  Expected: FAIL — module not found.

- [ ] **Step 4:** Implement the component.

  Create `apps/dashboard/src/components/console/slide-overs/console-slide-over.tsx`:

  ```tsx
  "use client";

  import * as Dialog from "@radix-ui/react-dialog";
  import type { ReactNode } from "react";

  interface ConsoleSlideOverProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    children: ReactNode;
  }

  /**
   * Shared slide-over surface for /console queue actions.
   *
   * Used by <ApprovalSlideOver> and <EscalationSlideOver>. Renders as a
   * right-edge panel using Radix Dialog primitives — Radix handles focus
   * trap, escape-to-close, click-outside-to-close, and body-scroll-lock.
   */
  export function ConsoleSlideOver({ open, onOpenChange, title, children }: ConsoleSlideOverProps) {
    return (
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
          <Dialog.Content
            className="fixed inset-y-0 right-0 z-50 w-full max-w-xl overflow-y-auto bg-background p-6 shadow-xl"
            data-v6-console
          >
            <header className="mb-4 flex items-center justify-between">
              <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
              <Dialog.Close
                aria-label="Close"
                className="rounded p-1 hover:bg-muted"
              >
                ✕
              </Dialog.Close>
            </header>
            {children}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }
  ```

  Note: `data-v6-console` on `Dialog.Content` ensures the slide-over inherits the warm-clay scoped styles so it visually belongs to the console (per DC-14 ship-with — the parallel design system stays at launch).

- [ ] **Step 5:** Run, watch pass.

  ```bash
  pnpm --filter @switchboard/dashboard test src/components/console/slide-overs/__tests__/console-slide-over
  ```

  Expected: 3/3 PASS.

- [ ] **Step 6:** Commit.

  ```bash
  git add apps/dashboard/src/components/console/slide-overs/console-slide-over.tsx apps/dashboard/src/components/console/slide-overs/__tests__/console-slide-over.test.tsx
  git commit -m "feat(dashboard): shared console slide-over Sheet primitive"
  ```

---

## Task 10: Build `<ApprovalSlideOver>` and wire from queue cards

**Files:**
- Create: `apps/dashboard/src/components/console/slide-overs/approval-slide-over.tsx`
- Create: `apps/dashboard/src/components/console/slide-overs/__tests__/approval-slide-over.test.tsx`
- Modify: `apps/dashboard/src/components/console/console-view.tsx` (slide-over state + onClick wiring)

- [ ] **Step 1:** Write the failing test.

  Create `apps/dashboard/src/components/console/slide-overs/__tests__/approval-slide-over.test.tsx`:

  ```tsx
  import { describe, it, expect, vi } from "vitest";
  import { render, screen, fireEvent, waitFor } from "@testing-library/react";
  import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
  import { SessionProvider } from "next-auth/react";
  import type { ReactNode } from "react";
  import { ApprovalSlideOver } from "../approval-slide-over";

  global.fetch = vi.fn();

  const wrapper = ({ children }: { children: ReactNode }) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return (
      <SessionProvider session={{ user: { id: "u" }, expires: "" } as never}>
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      </SessionProvider>
    );
  };

  describe("ApprovalSlideOver", () => {
    it("renders Approve and Reject buttons when open", () => {
      render(
        <ApprovalSlideOver approvalId="a-1" open onOpenChange={() => {}} />,
        { wrapper },
      );
      expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /reject/i })).toBeInTheDocument();
    });

    it("renders an 'Open full detail' deep-link to /decide/[id]", () => {
      render(
        <ApprovalSlideOver approvalId="a-1" open onOpenChange={() => {}} />,
        { wrapper },
      );
      const link = screen.getByRole("link", { name: /full detail/i });
      expect(link).toHaveAttribute("href", "/decide/a-1");
    });

    it("calls approve mutation on Approve click", async () => {
      (global.fetch as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
        ok: true,
        json: async () => ({ status: "approved" }),
      });
      render(
        <ApprovalSlideOver approvalId="a-1" open onOpenChange={() => {}} />,
        { wrapper },
      );
      fireEvent.click(screen.getByRole("button", { name: /approve/i }));
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/dashboard/approvals/a-1",
          expect.objectContaining({ method: "POST" }),
        );
      });
    });
  });
  ```

- [ ] **Step 2:** Run, watch fail.

  ```bash
  pnpm --filter @switchboard/dashboard test src/components/console/slide-overs/__tests__/approval-slide-over
  ```

  Expected: FAIL — module not found.

- [ ] **Step 3:** Implement the component.

  Create `apps/dashboard/src/components/console/slide-overs/approval-slide-over.tsx`:

  ```tsx
  "use client";

  import Link from "next/link";
  import { ConsoleSlideOver } from "./console-slide-over";
  import { useApprovalAction } from "@/hooks/use-approval-action";

  interface ApprovalSlideOverProps {
    approvalId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }

  export function ApprovalSlideOver({ approvalId, open, onOpenChange }: ApprovalSlideOverProps) {
    const { approve, reject, isPending } = useApprovalAction(approvalId);

    const handleApprove = async () => {
      await approve();
      onOpenChange(false);
    };
    const handleReject = async () => {
      await reject();
      onOpenChange(false);
    };

    return (
      <ConsoleSlideOver open={open} onOpenChange={onOpenChange} title="Approve or reject">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Approval {approvalId}. Choose an action below, or open the full detail page for binding
            hash, history, and conversation context.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleApprove}
              disabled={isPending}
              className="btn btn-primary-graphite"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={handleReject}
              disabled={isPending}
              className="btn btn-ghost"
            >
              Reject
            </button>
          </div>
          <Link
            href={`/decide/${approvalId}`}
            className="block text-sm text-muted-foreground underline"
          >
            Open full detail →
          </Link>
        </div>
      </ConsoleSlideOver>
    );
  }
  ```

- [ ] **Step 4:** Run, watch pass.

  ```bash
  pnpm --filter @switchboard/dashboard test src/components/console/slide-overs/__tests__/approval-slide-over
  ```

  Expected: 3/3 PASS.

- [ ] **Step 5:** Wire it from `console-view.tsx`.

  In `apps/dashboard/src/components/console/console-view.tsx`:

  - At the top, import: `import { useState } from "react"; import { ApprovalSlideOver } from "./slide-overs/approval-slide-over";`
  - Inside `ConsoleView`, add slide-over state:

    ```ts
    const [slideOver, setSlideOver] = useState<
      { kind: "approval"; id: string } | null
    >(null);
    ```

  - In the `ApprovalGateCardView` rendering (line ~107), change the primary button's no-op to:

    ```tsx
    <button
      className="btn btn-primary-graphite"
      type="button"
      onClick={() => setSlideOver({ kind: "approval", id: card.approvalId })}
    >
      {card.primary.label}
    </button>
    ```

    Note: `card.approvalId` may not exist on the current `ApprovalGateCard` view-model — verify by reading `console-data.ts`. If absent, add it to the view-model and to `mapApprovalGateCard` in `console-mappers.ts`. The mapper already has the source approval object (it constructs the card from it); pass through the id.

  - At the bottom of the `ConsoleView` return JSX, render the slide-over:

    ```tsx
    {slideOver?.kind === "approval" && (
      <ApprovalSlideOver
        approvalId={slideOver.id}
        open={true}
        onOpenChange={(open) => !open && setSlideOver(null)}
      />
    )}
    ```

- [ ] **Step 6:** Run all tests + typecheck.

  ```bash
  pnpm --filter @switchboard/dashboard test
  pnpm --filter @switchboard/dashboard typecheck
  ```

  Expected: all PASS.

- [ ] **Step 7:** Smoke-check in the browser.

  Reload `/console`. Click `Review →` on an approval-gate queue card. Slide-over opens. Click Approve. Slide-over closes; queue refetches; card disappears.

- [ ] **Step 8:** Commit.

  ```bash
  git add apps/dashboard/src/components/console/slide-overs/approval-slide-over.tsx apps/dashboard/src/components/console/slide-overs/__tests__/approval-slide-over.test.tsx apps/dashboard/src/components/console/console-view.tsx apps/dashboard/src/components/console/console-mappers.ts apps/dashboard/src/components/console/console-data.ts
  git commit -m "feat(dashboard): wire ApprovalSlideOver from console queue cards (DC-39)"
  ```

---

## Task 11: Build `<EscalationSlideOver>` and wire from queue cards

**Files:**
- Create: `apps/dashboard/src/components/console/slide-overs/escalation-slide-over.tsx`
- Create: `apps/dashboard/src/components/console/slide-overs/__tests__/escalation-slide-over.test.tsx`
- Modify: `apps/dashboard/src/components/console/console-view.tsx`

Mirrors Task 10 with the escalation reply hook.

- [ ] **Step 1:** Write the failing test.

  Create `apps/dashboard/src/components/console/slide-overs/__tests__/escalation-slide-over.test.tsx`:

  ```tsx
  import { describe, it, expect, vi } from "vitest";
  import { render, screen, fireEvent, waitFor } from "@testing-library/react";
  import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
  import type { ReactNode } from "react";
  import { EscalationSlideOver } from "../escalation-slide-over";

  global.fetch = vi.fn();

  const wrapper = ({ children }: { children: ReactNode }) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };

  describe("EscalationSlideOver", () => {
    it("renders textarea and Send button", () => {
      render(
        <EscalationSlideOver escalationId="e-1" open onOpenChange={() => {}} />,
        { wrapper },
      );
      expect(screen.getByRole("textbox", { name: /reply/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
    });

    it("renders 'Open full conversation' deep-link", () => {
      render(
        <EscalationSlideOver escalationId="e-1" open onOpenChange={() => {}} />,
        { wrapper },
      );
      const link = screen.getByRole("link", { name: /full conversation/i });
      expect(link).toHaveAttribute("href", "/conversations/e-1");
    });

    it("posts reply on Send and closes on 200", async () => {
      (global.fetch as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ escalation: { id: "e-1", channel: "telegram" }, replySent: true }),
      });
      const onOpenChange = vi.fn();
      render(
        <EscalationSlideOver escalationId="e-1" open onOpenChange={onOpenChange} />,
        { wrapper },
      );
      fireEvent.change(screen.getByRole("textbox", { name: /reply/i }), { target: { value: "hi" } });
      fireEvent.click(screen.getByRole("button", { name: /send/i }));
      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
    });

    it("preserves textarea text and shows error on 502", async () => {
      (global.fetch as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({
          escalation: { id: "e-1", channel: "telegram" },
          replySent: false,
          error: "delivery failed",
        }),
      });
      const onOpenChange = vi.fn();
      render(
        <EscalationSlideOver escalationId="e-1" open onOpenChange={onOpenChange} />,
        { wrapper },
      );
      const textarea = screen.getByRole("textbox", { name: /reply/i });
      fireEvent.change(textarea, { target: { value: "hi" } });
      fireEvent.click(screen.getByRole("button", { name: /send/i }));
      await waitFor(() => {
        expect(screen.getByText(/delivery failed/i)).toBeInTheDocument();
      });
      expect((textarea as HTMLTextAreaElement).value).toBe("hi");
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    });
  });
  ```

- [ ] **Step 2:** Run, watch fail.

  ```bash
  pnpm --filter @switchboard/dashboard test src/components/console/slide-overs/__tests__/escalation-slide-over
  ```

  Expected: FAIL — module not found.

- [ ] **Step 3:** Implement the component.

  Create `apps/dashboard/src/components/console/slide-overs/escalation-slide-over.tsx`:

  ```tsx
  "use client";

  import Link from "next/link";
  import { useState } from "react";
  import { ConsoleSlideOver } from "./console-slide-over";
  import { useEscalationReply } from "@/hooks/use-escalation-reply";

  interface EscalationSlideOverProps {
    escalationId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }

  export function EscalationSlideOver({
    escalationId,
    open,
    onOpenChange,
  }: EscalationSlideOverProps) {
    const { send, isPending } = useEscalationReply(escalationId);
    const [text, setText] = useState("");
    const [error, setError] = useState<string | null>(null);

    const handleSend = async () => {
      setError(null);
      try {
        const result = await send(text);
        if (result.ok) {
          setText("");
          onOpenChange(false);
        } else {
          setError(result.error ?? "Couldn't deliver reply.");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Reply failed.");
      }
    };

    return (
      <ConsoleSlideOver open={open} onOpenChange={onOpenChange} title="Reply to escalation">
        <div className="space-y-4">
          <label htmlFor="escalation-reply" className="block text-sm font-medium">
            Reply
          </label>
          <textarea
            id="escalation-reply"
            aria-label="Reply"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            className="w-full rounded border p-2"
          />
          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSend}
              disabled={isPending || !text.trim()}
              className="btn btn-primary-graphite"
              aria-label="Send reply"
            >
              Send
            </button>
          </div>
          <Link
            href={`/conversations/${escalationId}`}
            className="block text-sm text-muted-foreground underline"
          >
            Open full conversation →
          </Link>
        </div>
      </ConsoleSlideOver>
    );
  }
  ```

- [ ] **Step 4:** Run, watch pass.

  ```bash
  pnpm --filter @switchboard/dashboard test src/components/console/slide-overs/__tests__/escalation-slide-over
  ```

  Expected: 4/4 PASS.

- [ ] **Step 5:** Wire from `console-view.tsx`.

  Extend the `slideOver` state type to include the escalation variant:

  ```ts
  const [slideOver, setSlideOver] = useState<
    | { kind: "approval"; id: string }
    | { kind: "escalation"; id: string }
    | null
  >(null);
  ```

  In `EscalationCardView`'s primary button (line ~80–83):

  ```tsx
  <button
    className="btn btn-primary-coral"
    type="button"
    onClick={() => setSlideOver({ kind: "escalation", id: card.escalationId })}
  >
    {card.primary.label}
  </button>
  ```

  Verify `card.escalationId` exists on the view-model; if not, add to `mapEscalationCard` in `console-mappers.ts`.

  At the bottom of `ConsoleView`'s return, alongside the approval slide-over:

  ```tsx
  {slideOver?.kind === "escalation" && (
    <EscalationSlideOver
      escalationId={slideOver.id}
      open={true}
      onOpenChange={(open) => !open && setSlideOver(null)}
    />
  )}
  ```

- [ ] **Step 6:** Run all tests + typecheck.

  ```bash
  pnpm --filter @switchboard/dashboard test
  pnpm --filter @switchboard/dashboard typecheck
  ```

  Expected: all PASS.

- [ ] **Step 7:** Smoke-check.

  Click `Reply inline ▾` on an escalation queue card. Slide-over opens. Type a reply, hit Send. On 200, slide-over closes; queue refetches.

- [ ] **Step 8:** Commit.

  ```bash
  git add apps/dashboard/src/components/console/slide-overs/escalation-slide-over.tsx apps/dashboard/src/components/console/slide-overs/__tests__/escalation-slide-over.test.tsx apps/dashboard/src/components/console/console-view.tsx apps/dashboard/src/components/console/console-mappers.ts apps/dashboard/src/components/console/console-data.ts
  git commit -m "feat(dashboard): wire EscalationSlideOver from console queue cards (DC-39)"
  ```

---

## Task 12: Wire in-zone navigation affordances

**Files:**
- Modify: `apps/dashboard/src/components/console/console-view.tsx`

Closes spec Q5's "C" half — make agent-strip "view conversations →", activity-row arrows, queue heading link real navigation.

- [ ] **Step 1:** Locate the affordances.

  ```bash
  grep -n "view conversations\|activity-row\|queue.*heading\|qhead\|→" apps/dashboard/src/components/console/console-view.tsx
  ```

- [ ] **Step 2:** Wrap each as a `<Link>`.

  For each affordance, replace the inert `<span>` or `<button>` with a `next/link` import:

  ```tsx
  import Link from "next/link";
  // ...

  // agent-strip:
  <Link href="/conversations" className="agent-link">
    view conversations →
  </Link>

  // queue zone heading (e.g. "Queue") in console-view.tsx:
  <Link href="/escalations" className="qzone-heading-link">
    Queue
  </Link>

  // activity row "→":
  <Link href={`/conversations/${row.conversationId ?? ""}`} className="activity-row-link">
    →
  </Link>
  ```

  Verify each target route exists. The activity-row destination depends on what the activity row references — for now, link to `/conversations` if no specific id is available; this is a launch-acceptable improvement over the pure no-op.

- [ ] **Step 3:** Smoke-check.

  Click each affordance. Confirm navigation lands correctly. Use the global `OwnerTabs` (re-shown in Task 5) as the primary fallback nav; in-zone affordances are convenience.

- [ ] **Step 4:** Run tests + typecheck.

  ```bash
  pnpm --filter @switchboard/dashboard test
  pnpm --filter @switchboard/dashboard typecheck
  ```

- [ ] **Step 5:** Commit.

  ```bash
  git add apps/dashboard/src/components/console/console-view.tsx
  git commit -m "feat(dashboard): wire in-zone navigation affordances on /console (DC-40)"
  ```

---

## Task 13: PR-1 closeout — audit findings update + PR

**Files:**
- Modify: `docs/audits/2026-05-01-pre-launch-surface/01-dashboard-core-findings.md`

- [ ] **Step 1:** Update audit findings.

  Open `docs/audits/2026-05-01-pre-launch-surface/01-dashboard-core-findings.md`. For each of DC-39, DC-40, DC-59, change:

  ```
  - **Status:** Open
  ```

  to:

  ```
  - **Status:** Fixed (PR #__)
  ```

  Substitute the actual PR number after opening the PR (Step 4). For DC-41, change to:

  ```
  - **Status:** Accepted (ship-with)
  ```

  And add a structured ship-with entry to `docs/audits/2026-05-01-pre-launch-surface/index.md` per audit spec §10 step 5:

  ```
  Ship-with: DC-41
  Acknowledged-by: Jason
  Acknowledged-at: 2026-05-02
  Rationale: Halt button is hidden at launch; wiring requires backend runtime gate + new endpoint + audit trail, out of PR-1 scope.
  Mitigation: None at v1; operators contact support to halt dispatch in an emergency.
  Re-evaluate: 2026-06-01
  ```

- [ ] **Step 2:** Validate findings doc.

  ```bash
  cd /Users/jasonli/switchboard
  pnpm audit:validate docs/audits/2026-05-01-pre-launch-surface/01-dashboard-core-findings.md
  ```

  Expected: exits 0.

- [ ] **Step 3:** Commit findings update.

  ```bash
  git add docs/audits/2026-05-01-pre-launch-surface/
  git commit -m "docs(audit): mark dc-39 dc-40 dc-59 fixed and dc-41 ship-with"
  ```

- [ ] **Step 4:** Push + open PR.

  ```bash
  git push -u origin feat/console-pr1-actions-and-nav
  gh pr create --title "feat(dashboard): /console launch readiness PR-1 — actions and nav" --body "$(cat <<'EOF'
  ## Summary
  - Wire all /console queue card primary actions via shared `useApprovalAction` and `useEscalationReply` hooks + slide-over UI (Sheet pattern).
  - Re-show `OwnerTabs` on /console; wire in-zone affordances as `<Link>`s.
  - Login redirect: session-aware default — onboarded → /console, otherwise /onboarding.
  - Middleware: protect /console, /escalations, /conversations.
  - Hide unwired Halt button (DC-41 ship-with).

  ## Closes audit findings
  - DC-39 (queue cards no onClick): Fixed
  - DC-40 (no in-page nav from /console): Fixed
  - DC-59 (post-login orphans /console): Fixed
  - DC-41 (Halt unwired): Ship-with, deferred to post-launch (see index.md)

  ## Test plan
  - [ ] `pnpm test` and `pnpm typecheck` pass
  - [ ] Browser: sign in to onboarded tenant → lands on /console
  - [ ] Browser: sign in to fresh user → lands on /onboarding
  - [ ] Browser: click Approve on a queue card → slide-over opens → approve → toast → queue updates
  - [ ] Browser: click Reply on an escalation card → slide-over opens → send → toast (200) or banner (502) → queue updates
  - [ ] Browser: OwnerTabs visible on /console; navigates correctly
  - [ ] Browser: agent-strip / activity-row / queue-heading affordances navigate correctly
  - [ ] Browser: Halt button is gone

  Source spec: [docs/superpowers/specs/2026-05-01-console-launch-readiness-design.md](docs/superpowers/specs/2026-05-01-console-launch-readiness-design.md)
  EOF
  )"
  ```

- [ ] **Step 5:** After PR merge, update DC-39 / DC-40 / DC-59 Status with the actual PR number, commit, push.

---

# Phase B — PR-2: /console doesn't lie

## Task 14: Pre-flight for PR-2

**Files:** none modified.

- [ ] **Step 1:** Branch off post-PR-1 main.

  ```bash
  cd /Users/jasonli/switchboard
  git fetch origin main
  git checkout -b feat/console-pr2-truth-and-degradation origin/main
  git status --short
  ```

- [ ] **Step 2:** Verify baseline.

  ```bash
  pnpm test
  pnpm typecheck
  ```

  Expected: all PASS.

---

## Task 15: Build shared zone state components

**Files:**
- Create: `apps/dashboard/src/components/console/zones/zone-states.tsx`
- Create: `apps/dashboard/src/components/console/zones/__tests__/zone-states.test.tsx`

Per spec §4.2: each console zone composes one of these on its loading/error/empty states.

- [ ] **Step 1:** Write the failing test.

  Create `apps/dashboard/src/components/console/zones/__tests__/zone-states.test.tsx`:

  ```tsx
  import { describe, it, expect, vi } from "vitest";
  import { render, screen, fireEvent } from "@testing-library/react";
  import { ZoneSkeleton, ZoneError, ZoneEmpty } from "../zone-states";

  describe("zone state components", () => {
    it("ZoneSkeleton renders an aria-busy region", () => {
      render(<ZoneSkeleton label="Loading numbers" />);
      expect(screen.getByLabelText("Loading numbers")).toHaveAttribute("aria-busy", "true");
    });

    it("ZoneError renders message + retry button", () => {
      const onRetry = vi.fn();
      render(<ZoneError message="Couldn't load queue" onRetry={onRetry} />);
      expect(screen.getByText(/couldn't load queue/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /retry/i }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("ZoneEmpty renders message and optional cta", () => {
      render(<ZoneEmpty message="No items yet" />);
      expect(screen.getByText(/no items yet/i)).toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 2:** Run, watch fail.

- [ ] **Step 3:** Implement.

  Create `apps/dashboard/src/components/console/zones/zone-states.tsx`:

  ```tsx
  "use client";

  import type { ReactNode } from "react";

  export function ZoneSkeleton({ label }: { label: string }) {
    return (
      <div role="status" aria-label={label} aria-busy="true" className="zone-skeleton">
        <div className="skeleton-line" />
        <div className="skeleton-line" />
      </div>
    );
  }

  export function ZoneError({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
      <div role="alert" className="zone-error">
        <p>{message}</p>
        <button type="button" onClick={onRetry} className="btn btn-text">
          Retry
        </button>
      </div>
    );
  }

  export function ZoneEmpty({ message, cta }: { message: string; cta?: ReactNode }) {
    return (
      <div className="zone-empty">
        <p>{message}</p>
        {cta}
      </div>
    );
  }
  ```

- [ ] **Step 4:** Run, watch pass.

- [ ] **Step 5:** Commit.

  ```bash
  git add apps/dashboard/src/components/console/zones/zone-states.tsx apps/dashboard/src/components/console/zones/__tests__/zone-states.test.tsx
  git commit -m "feat(dashboard): shared zone state components (skeleton, error, empty)"
  ```

---

## Task 16: Extract `<NumbersStrip>` zone

**Files:**
- Create: `apps/dashboard/src/components/console/zones/numbers-strip.tsx`
- Create: `apps/dashboard/src/components/console/zones/__tests__/numbers-strip.test.tsx`

Mirrors the pattern for the other zones. Each subsequent zone task (17–21) follows the identical shape.

- [ ] **Step 1:** Write the failing test.

  ```tsx
  import { describe, it, expect, vi } from "vitest";
  import { render, screen } from "@testing-library/react";
  import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
  import type { ReactNode } from "react";
  import { NumbersStrip } from "../numbers-strip";

  vi.mock("@/hooks/use-dashboard-overview");

  const wrapper = ({ children }: { children: ReactNode }) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };

  describe("NumbersStrip", () => {
    it("renders skeleton while loading", async () => {
      const mod = await import("@/hooks/use-dashboard-overview");
      vi.mocked(mod.useDashboardOverview).mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
        refetch: vi.fn(),
      } as never);
      render(<NumbersStrip />, { wrapper });
      expect(screen.getByLabelText(/loading numbers/i)).toBeInTheDocument();
    });

    it("renders error state with retry on hook error", async () => {
      const refetch = vi.fn();
      const mod = await import("@/hooks/use-dashboard-overview");
      vi.mocked(mod.useDashboardOverview).mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error("boom"),
        refetch,
      } as never);
      render(<NumbersStrip />, { wrapper });
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    it("renders cells when data is present", async () => {
      const mod = await import("@/hooks/use-dashboard-overview");
      vi.mocked(mod.useDashboardOverview).mockReturnValue({
        data: {
          stats: { newInquiriesToday: 7, newInquiriesYesterday: 5 },
          bookings: [],
        },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      } as never);
      render(<NumbersStrip />, { wrapper });
      expect(screen.getByText(/leads today/i)).toBeInTheDocument();
      expect(screen.getByText("7")).toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 2:** Run, watch fail.

- [ ] **Step 3:** Implement.

  Create `apps/dashboard/src/components/console/zones/numbers-strip.tsx`:

  ```tsx
  "use client";

  import { useDashboardOverview } from "@/hooks/use-dashboard-overview";
  import { ZoneSkeleton, ZoneError } from "./zone-states";

  export function NumbersStrip() {
    const { data, isLoading, error, refetch } = useDashboardOverview();

    if (isLoading) return <ZoneSkeleton label="Loading numbers" />;
    if (error) return <ZoneError message="Couldn't load numbers." onRetry={() => refetch()} />;

    const leadsToday = data?.stats.newInquiriesToday ?? 0;
    const leadsYesterday = data?.stats.newInquiriesYesterday ?? 0;
    const bookingsCount = data?.bookings.length ?? 0;

    return (
      <section className="numbers-strip" aria-label="Today's numbers">
        <div className="cell">
          <span className="label">Leads today</span>
          <span className="value">{leadsToday}</span>
          <span className="delta">vs {leadsYesterday} yesterday</span>
        </div>
        <div className="cell">
          <span className="label">Appointments</span>
          <span className="value">{bookingsCount}</span>
        </div>
        <div className="cell placeholder">
          <span className="label">Revenue today</span>
          <span className="value muted">—</span>
        </div>
        <div className="cell placeholder">
          <span className="label">Spend today</span>
          <span className="value muted">—</span>
        </div>
        <div className="cell placeholder">
          <span className="label">Reply time</span>
          <span className="value muted">—</span>
        </div>
      </section>
    );
  }
  ```

  Note: the three placeholder cells preserve the existing Option-B behavior. The literal "pending option C" copy from DC-02/DC-03 is replaced by an em-dash + muted styling — neutral, no internal jargon. Real values are Option-C territory.

- [ ] **Step 4:** Run, watch pass.

- [ ] **Step 5:** Commit.

  ```bash
  git add apps/dashboard/src/components/console/zones/numbers-strip.tsx apps/dashboard/src/components/console/zones/__tests__/numbers-strip.test.tsx
  git commit -m "feat(dashboard): NumbersStrip zone with own loading and error states"
  ```

---

## Task 17: Extract `<OpStrip>` zone

**Files:**
- Create: `apps/dashboard/src/components/console/zones/op-strip.tsx`
- Create: `apps/dashboard/src/components/console/zones/__tests__/op-strip.test.tsx`

Same pattern as Task 16. Owns `useOrgConfig`. Renders `orgName`, current time, the live-pulse status dot. Halt button stays hidden (Task 6 already removed it from console-view; this extraction preserves that).

- [ ] **Step 1–3:** Write failing test, implement, run pass. Pattern identical to Task 16; substitute `useOrgConfig` for `useDashboardOverview`. Render an op-strip header `<header className="opstrip">` with org name + current time. Skeleton and error states identical.

- [ ] **Step 4:** Commit.

  ```bash
  git add apps/dashboard/src/components/console/zones/op-strip.tsx apps/dashboard/src/components/console/zones/__tests__/op-strip.test.tsx
  git commit -m "feat(dashboard): OpStrip zone with own loading and error states"
  ```

---

## Task 18: Extract `<QueueZone>` zone

**Files:**
- Create: `apps/dashboard/src/components/console/zones/queue-zone.tsx`
- Create: `apps/dashboard/src/components/console/zones/__tests__/queue-zone.test.tsx`

Same pattern. Owns `useEscalations` + `useApprovals` (composed). Renders the queue cards (delegates to existing card components). Slide-over state lives at the parent (`<ConsoleView>`) since both `<QueueZone>` and the slide-overs need to coordinate.

- [ ] **Step 1:** Write failing test (skeleton/error/data + cards rendered).

- [ ] **Step 2:** Implement.

  ```tsx
  "use client";

  import { useEscalations } from "@/hooks/use-escalations";
  import { useApprovals } from "@/hooks/use-approvals";
  import { ZoneSkeleton, ZoneError, ZoneEmpty } from "./zone-states";
  import { mapQueue } from "../console-mappers";
  // ... import the existing card view components ...

  interface QueueZoneProps {
    onOpenSlideOver: (sel: { kind: "approval" | "escalation"; id: string }) => void;
  }

  export function QueueZone({ onOpenSlideOver }: QueueZoneProps) {
    const escalations = useEscalations();
    const approvals = useApprovals();

    const isLoading = escalations.isLoading || approvals.isLoading;
    const error = escalations.error ?? approvals.error;

    if (isLoading) return <ZoneSkeleton label="Loading queue" />;
    if (error) {
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

    const cards = mapQueue({
      escalations: (escalations.data as { escalations?: unknown[] } | undefined)?.escalations ?? [],
      approvals: approvals.data?.approvals ?? [],
    });

    if (cards.length === 0) return <ZoneEmpty message="No queue items right now." />;

    // Render cards; pass onOpenSlideOver to card primaries.
    // (Existing card components accept onClick props after Tasks 10/11.)
    return <div className="queue-zone">{/* render each card */}</div>;
  }
  ```

- [ ] **Step 3:** Run pass.

- [ ] **Step 4:** Commit.

---

## Task 19: Extract `<AgentStrip>` zone

**Files:**
- Create: `apps/dashboard/src/components/console/zones/agent-strip.tsx`
- Create: `apps/dashboard/src/components/console/zones/__tests__/agent-strip.test.tsx`

Same pattern. Owns `useAgentRoster` + `useAgentState` + `useModuleStatus`. Per-agent today-stats render as muted em-dash (DC-02 jargon replaced).

- [ ] **Step 1–3:** Failing test, implement, run pass.
- [ ] **Step 4:** Commit.

---

## Task 20: Extract `<ActivityTrail>` zone

**Files:**
- Create: `apps/dashboard/src/components/console/zones/activity-trail.tsx`
- Create: `apps/dashboard/src/components/console/zones/__tests__/activity-trail.test.tsx`

Owns `useAudit`. Maps each entry's `summary` field as the row label (closes DC-07 — surfaces the human-readable summary the API already provides).

- [ ] **Step 1–3:** Failing test, implement, run pass.
- [ ] **Step 4:** Commit.

---

## Task 21: Extract `<NovaPanel>` zone with module-status gate

**Files:**
- Create: `apps/dashboard/src/components/console/zones/nova-panel.tsx`
- Create: `apps/dashboard/src/components/console/zones/__tests__/nova-panel.test.tsx`

Per spec §4.2: gate on `useModuleStatus()` mirroring `moduleEnabled("ad-optimizer")` from `use-console-data.ts:80-86`. Closes DC-01 (no more fabricated Aurora Dental rows).

- [ ] **Step 1:** Write the failing test.

  ```tsx
  import { describe, it, expect, vi } from "vitest";
  import { render, screen } from "@testing-library/react";
  import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
  import type { ReactNode } from "react";
  import { NovaPanel } from "../nova-panel";

  vi.mock("@/hooks/use-module-status");

  const wrapper = ({ children }: { children: ReactNode }) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };

  describe("NovaPanel", () => {
    it("renders empty state when ad-optimizer is not live", async () => {
      const mod = await import("@/hooks/use-module-status");
      vi.mocked(mod.useModuleStatus).mockReturnValue({
        data: [],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      } as never);
      render(<NovaPanel />, { wrapper });
      expect(screen.getByText(/no ad-optimizer deployed/i)).toBeInTheDocument();
    });

    it("renders empty state when ad-optimizer module is present but not live", async () => {
      const mod = await import("@/hooks/use-module-status");
      vi.mocked(mod.useModuleStatus).mockReturnValue({
        data: [{ id: "ad-optimizer", state: "draft" }],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      } as never);
      render(<NovaPanel />, { wrapper });
      expect(screen.getByText(/no ad-optimizer deployed/i)).toBeInTheDocument();
    });

    it("renders panel when ad-optimizer is live", async () => {
      const mod = await import("@/hooks/use-module-status");
      vi.mocked(mod.useModuleStatus).mockReturnValue({
        data: [{ id: "ad-optimizer", state: "live" }],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      } as never);
      render(<NovaPanel />, { wrapper });
      expect(screen.queryByText(/no ad-optimizer deployed/i)).not.toBeInTheDocument();
      // Panel headline check (e.g. "Nova · Ad actions")
      expect(screen.getByText(/Ad actions/i)).toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 2:** Run fail.

- [ ] **Step 3:** Implement.

  ```tsx
  "use client";

  import { useModuleStatus } from "@/hooks/use-module-status";
  import { ZoneSkeleton, ZoneError, ZoneEmpty } from "./zone-states";
  import Link from "next/link";

  export function NovaPanel() {
    const modules = useModuleStatus();

    if (modules.isLoading) return <ZoneSkeleton label="Loading ad actions" />;
    if (modules.error) {
      return <ZoneError message="Couldn't load ad actions." onRetry={() => modules.refetch()} />;
    }

    const list = (modules.data ?? []) as Array<{ id: string; state: string }>;
    const adOptimizerLive = list.some((m) => m.id === "ad-optimizer" && m.state === "live");

    if (!adOptimizerLive) {
      return (
        <ZoneEmpty
          message="No ad-optimizer deployed yet."
          cta={
            <Link href="/marketplace" className="btn btn-text">
              Connect ad-optimizer →
            </Link>
          }
        />
      );
    }

    // Live panel rendering: headline + ad-set rows.
    // Real row data is Option-C territory (see spec §3 out-of-scope).
    // For PR-2, render the headline + a placeholder "Ad rows pending" line —
    // honest about the data state, not the Aurora Dental fixture.
    return (
      <section className="nova-panel" aria-label="Nova ad actions">
        <header>
          <h2>Nova · Ad actions</h2>
        </header>
        <p className="muted">Ad-set rows render here once the aggregation is wired (Option C).</p>
      </section>
    );
  }
  ```

- [ ] **Step 4:** Run pass.

- [ ] **Step 5:** Commit.

  ```bash
  git add apps/dashboard/src/components/console/zones/nova-panel.tsx apps/dashboard/src/components/console/zones/__tests__/nova-panel.test.tsx
  git commit -m "feat(dashboard): NovaPanel zone gated on ad-optimizer module status (DC-01)"
  ```

---

## Task 22: Compose zones in `<ConsoleView>` and remove `useConsoleData`

**Files:**
- Modify: `apps/dashboard/src/components/console/console-view.tsx`
- Modify: `apps/dashboard/src/app/(auth)/console/page.tsx`
- Delete: `apps/dashboard/src/components/console/use-console-data.ts`
- Modify: `apps/dashboard/src/components/console/console-data.ts` (remove `consoleFixture` export from runtime; either delete or move to `__fixtures__/`)

- [ ] **Step 1:** Replace `console-view.tsx` body.

  Replace the existing `<ConsoleView>` (which currently takes `data: ConsoleData`) with a parent that composes zones. Keep slide-over state here.

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

  type SlideOverState =
    | { kind: "approval"; id: string }
    | { kind: "escalation"; id: string }
    | null;

  export function ConsoleView() {
    const [slideOver, setSlideOver] = useState<SlideOverState>(null);

    return (
      <div data-v6-console>
        <OpStrip />
        <NumbersStrip />
        <QueueZone onOpenSlideOver={setSlideOver} />
        <AgentStrip />
        <NovaPanel />
        <ActivityTrail />
        {slideOver?.kind === "approval" && (
          <ApprovalSlideOver
            approvalId={slideOver.id}
            open
            onOpenChange={(open) => !open && setSlideOver(null)}
          />
        )}
        {slideOver?.kind === "escalation" && (
          <EscalationSlideOver
            escalationId={slideOver.id}
            open
            onOpenChange={(open) => !open && setSlideOver(null)}
          />
        )}
      </div>
    );
  }
  ```

- [ ] **Step 2:** Update `page.tsx`.

  Replace `apps/dashboard/src/app/(auth)/console/page.tsx`:

  ```tsx
  "use client";

  import { useSession } from "next-auth/react";
  import { redirect } from "next/navigation";
  import { ConsoleView } from "@/components/console/console-view";

  export default function ConsolePage() {
    const { status } = useSession();
    if (status === "unauthenticated") redirect("/login");
    return <ConsoleView />;
  }
  ```

  Whole-page error banner is gone (DC-58 + DC-04 closed). Each zone now owns its loading/error path.

- [ ] **Step 3:** Delete `use-console-data.ts`.

  ```bash
  git rm apps/dashboard/src/components/console/use-console-data.ts
  ```

  If any other file imports it, fix the import (zones own their hooks now).

- [ ] **Step 4:** Remove `consoleFixture` from runtime.

  In `apps/dashboard/src/components/console/console-data.ts`, either:
  - **(a)** delete the `consoleFixture` export entirely, OR
  - **(b)** move it to `apps/dashboard/src/components/console/__fixtures__/console-fixture.ts` and update any test imports to point there.

  Pick (a) unless a test currently imports it; (b) only if needed for tests.

- [ ] **Step 5:** Run all tests + typecheck.

  ```bash
  pnpm --filter @switchboard/dashboard test
  pnpm --filter @switchboard/dashboard typecheck
  ```

  Expected: all PASS.

- [ ] **Step 6:** Smoke-check.

  Reload `/console`. Confirm: zones render independently. Kill the API. Reload — the page should show per-zone error states (not a blank body).

- [ ] **Step 7:** Commit.

  ```bash
  git add apps/dashboard/src/components/console/ apps/dashboard/src/app/\(auth\)/console/page.tsx
  git commit -m "feat(dashboard): per-zone graceful degradation, remove useConsoleData (DC-58, DC-04)"
  ```

---

## Task 23: Branched post-reply banner on /escalations

**Files:**
- Modify: `apps/dashboard/src/components/escalations/escalation-list.tsx`
- Create: `apps/dashboard/src/components/escalations/__tests__/escalation-list-banner.test.tsx`

Closes DC-23.

- [ ] **Step 1:** Write the failing test.

  ```tsx
  import { describe, it, expect, vi } from "vitest";
  import { render, screen, fireEvent, waitFor } from "@testing-library/react";
  // ... existing imports for SessionProvider, QueryClientProvider ...
  import { EscalationList } from "../escalation-list";

  global.fetch = vi.fn();

  describe("escalation reply banner branching", () => {
    it("renders success copy with channel name on 200", async () => {
      // mock: useEscalations returns [escalation with channel=telegram, leadName=Sarah]
      // mock: fetch on /respond returns 200 { escalation, replySent: true }
      // ... render, expand, type, send ...
      await waitFor(() => {
        expect(screen.getByText(/reply sent.*via telegram/i)).toBeInTheDocument();
      });
    });

    it("renders failure copy + preserves textarea on 502", async () => {
      // mock: fetch returns 502 { escalation, replySent: false, error: "Reply saved but channel delivery failed." }
      // ... render, expand, type "hello", send ...
      await waitFor(() => {
        expect(screen.getByText(/couldn't deliver.*telegram/i)).toBeInTheDocument();
      });
      // textarea retains "hello"
      expect(screen.getByRole("textbox", { name: /reply/i })).toHaveValue("hello");
    });
  });
  ```

  (Mock setup uses the same patterns as Tasks 7/8 tests — copy from there.)

- [ ] **Step 2:** Run fail.

- [ ] **Step 3:** Update `escalation-list.tsx` banner block.

  Find the existing post-reply banner. Replace with branched copy:

  ```tsx
  {replyState?.kind === "success" && (
    <div className="banner banner-success" role="status">
      <b>Reply sent</b> to {replyState.leadName} via {replyState.channel}.
    </div>
  )}
  {replyState?.kind === "failure" && (
    <div className="banner banner-error" role="alert">
      <b>Couldn't deliver</b> to {replyState.channel} right now — {replyState.error}
    </div>
  )}
  ```

  `replyState` is local state set by the result of `useEscalationReply.send()`:

  ```ts
  const [replyState, setReplyState] = useState<
    | { kind: "success"; leadName: string; channel: string }
    | { kind: "failure"; channel: string; error: string }
    | null
  >(null);

  const handleSend = async () => {
    const out = await reply.send(text);
    if (out.ok) {
      setReplyState({
        kind: "success",
        leadName: escalation.leadSnapshot?.name ?? "the customer",
        channel: out.escalation.channel,
      });
      setText("");
    } else {
      setReplyState({
        kind: "failure",
        channel: out.escalation.channel,
        error: out.error ?? "Channel delivery failed.",
      });
      // text stays preserved (no setText("") here)
    }
  };
  ```

- [ ] **Step 4:** Run, watch pass.

- [ ] **Step 5:** Commit.

  ```bash
  git add apps/dashboard/src/components/escalations/escalation-list.tsx apps/dashboard/src/components/escalations/__tests__/escalation-list-banner.test.tsx
  git commit -m "feat(dashboard): branch escalation reply banner on 200 vs 502 delivery state (DC-23)"
  ```

---

## Task 24: PR-2 closeout — audit findings update + PR

**Files:**
- Modify: `docs/audits/2026-05-01-pre-launch-surface/01-dashboard-core-findings.md`

- [ ] **Step 1:** Update Status of DC-01, DC-04, DC-23, DC-58 to `Fixed (PR #__)`. Validate with `pnpm audit:validate`.

- [ ] **Step 2:** Push + open PR.

  ```bash
  git push -u origin feat/console-pr2-truth-and-degradation
  gh pr create --title "feat(dashboard): /console launch readiness PR-2 — truth and degradation" --body "..."
  ```

  Use a PR body mirroring PR-1's structure: Summary, Closes findings (DC-01, DC-04, DC-23, DC-58), Test plan checkboxes, link to spec.

- [ ] **Step 3:** After merge, update Status with PR number; commit; push.

---

# Phase C — PR-3: Auth integrity

## Task 25: Pre-flight for PR-3

**Files:** none modified.

- [ ] **Step 1:** Branch off post-PR-2 main.

  ```bash
  git fetch origin main
  git checkout -b feat/console-pr3-auth-integrity origin/main
  ```

- [ ] **Step 2:** Verify baseline.

  ```bash
  pnpm test
  pnpm typecheck
  ```

---

## Task 26: Run two-tenant browser repro and record result

**Files:**
- Create: `docs/audits/2026-05-01-pre-launch-surface/artifacts/01-dashboard-core/repros/two-tenant-cache-leak.md`

Per spec §4.3: confirm or downgrade DC-11/DC-13 severity before refactoring.

- [ ] **Step 1:** Set up two test tenants with seeded data (org A and org B, each with ≥1 pending approval and ≥1 escalation; distinguishable lead names).

- [ ] **Step 2:** Run the three repros from `docs/audits/2026-05-01-pre-launch-surface/01-dashboard-core-human-walk.md` §H:

  - **Repro 1 — Sign-out + Back.** Sign in as Tenant A, navigate to /console, note data, sign out, hit browser Back. Expected: redirect to /login. Failure: /console re-renders briefly with Tenant A data.
  - **Repro 2 — Sign in as different tenant in same browser.** Sign in as A, sign out, sign in as B, watch /console first paint. Failure: A's data flashes before B's loads.
  - **Repro 3 — Two-tab cross-tenant.** Tab 1 = A on /console. Tab 2 = same browser, sign in as B. Switch back to Tab 1 without hard reload. Failure: Tab 1 picks up B's data on next refetch.

- [ ] **Step 3:** Record result.

  Create `docs/audits/2026-05-01-pre-launch-surface/artifacts/01-dashboard-core/repros/two-tenant-cache-leak.md`:

  ```markdown
  # Two-tenant cache-leak repro — DC-11 / DC-13

  **SHA at repro:** <commit SHA before PR-3 changes>
  **Repro date:** <YYYY-MM-DD>

  ## Repro 1 — Sign-out + Back
  - Result: <PASS | FAIL>
  - Notes: <what happened>
  - Screenshot: <path/if/FAIL>

  ## Repro 2 — Sign in as different tenant
  - Result: <PASS | FAIL>
  - Notes: <...>

  ## Repro 3 — Two-tab cross-tenant
  - Result: <PASS | FAIL>
  - Notes: <...>

  ## Severity calibration
  - If any FAIL → DC-11 + DC-13 escalate to **Launch-blocker** (audit hard-prohibition: data leak; Fixed-only).
  - If all PASS → DC-11 + DC-13 stay **High**; PR-3 still ships as defense-in-depth.
  ```

- [ ] **Step 4:** Commit.

  ```bash
  git add docs/audits/2026-05-01-pre-launch-surface/
  git commit -m "docs(audit): two-tenant cache-leak repro result for dc-11 dc-13"
  ```

---

## Task 27: Refactor `query-keys.ts` to scoped factory

**Files:**
- Modify: `apps/dashboard/src/lib/query-keys.ts`
- Create: `apps/dashboard/src/lib/__tests__/query-keys.test.ts`

- [ ] **Step 1:** Write the failing test.

  Create `apps/dashboard/src/lib/__tests__/query-keys.test.ts`:

  ```ts
  import { describe, it, expect } from "vitest";
  import { scopedKeys } from "../query-keys";

  describe("scopedKeys", () => {
    it("prefixes every key with the orgId", () => {
      const keys = scopedKeys("org-1");
      expect(keys.dashboard.overview()).toEqual(["org-1", "dashboard", "overview"]);
      expect(keys.approvals.pending()).toEqual(["org-1", "approvals", "pending"]);
      expect(keys.approvals.detail("a-1")).toEqual(["org-1", "approvals", "detail", "a-1"]);
      expect(keys.escalations.list("pending")).toEqual(["org-1", "escalations", "list", "pending"]);
    });

    it("produces different keys for different orgs", () => {
      const a = scopedKeys("org-a");
      const b = scopedKeys("org-b");
      expect(a.dashboard.overview()).not.toEqual(b.dashboard.overview());
    });
  });
  ```

- [ ] **Step 2:** Run fail.

- [ ] **Step 3:** Refactor `query-keys.ts`.

  Replace the entire file with:

  ```ts
  /**
   * React Query key factory.
   *
   * Every key is scoped by orgId so cross-tenant cache pollution is
   * structurally impossible. Use via `useScopedQueryKeys()` (see
   * apps/dashboard/src/hooks/use-query-keys.ts) — never construct
   * keys inline.
   */
  export const scopedKeys = (orgId: string) => ({
    identity: {
      all: () => [orgId, "identity"] as const,
      spec: (principalId: string) => [orgId, "identity", "spec", principalId] as const,
      specById: (id: string) => [orgId, "identity", "spec-by-id", id] as const,
    },
    approvals: {
      all: () => [orgId, "approvals"] as const,
      pending: () => [orgId, "approvals", "pending"] as const,
      detail: (id: string) => [orgId, "approvals", "detail", id] as const,
    },
    audit: {
      all: () => [orgId, "audit"] as const,
      list: (filters?: Record<string, string | undefined>) =>
        [orgId, "audit", "list", filters] as const,
    },
    // ... preserve every existing namespace, scoped under orgId ...
    dashboard: {
      all: () => [orgId, "dashboard"] as const,
      overview: () => [orgId, "dashboard", "overview"] as const,
    },
    escalations: {
      all: () => [orgId, "escalations"] as const,
      list: (status: string) => [orgId, "escalations", "list", status] as const,
    },
    conversations: {
      all: () => [orgId, "conversations"] as const,
      list: (filters?: Record<string, string | undefined>) =>
        [orgId, "conversations", "list", filters] as const,
      detail: (id: string) => [orgId, "conversations", "detail", id] as const,
    },
    agents: {
      all: () => [orgId, "agents"] as const,
      roster: () => [orgId, "agents", "roster"] as const,
      state: () => [orgId, "agents", "state"] as const,
      activity: () => [orgId, "agents", "activity"] as const,
    },
    orgConfig: {
      all: () => [orgId, "orgConfig"] as const,
      current: () => [orgId, "orgConfig", "current"] as const,
    },
    // ... and every other namespace currently in query-keys.ts ...
  });
  ```

  Preserve every namespace from the existing file. Each `[ "namespace", ... ]` becomes `[orgId, "namespace", ...]`.

- [ ] **Step 4:** Run, watch pass.

- [ ] **Step 5:** Commit.

  ```bash
  git add apps/dashboard/src/lib/query-keys.ts apps/dashboard/src/lib/__tests__/query-keys.test.ts
  git commit -m "feat(dashboard): refactor query-keys to scopedKeys(orgId) factory"
  ```

---

## Task 28: Add `useScopedQueryKeys()` hook

**Files:**
- Create: `apps/dashboard/src/hooks/use-query-keys.ts`
- Create: `apps/dashboard/src/hooks/__tests__/use-query-keys.test.tsx`

- [ ] **Step 1:** Write the failing test.

  ```tsx
  import { describe, it, expect, vi } from "vitest";
  import { renderHook } from "@testing-library/react";
  import { SessionProvider } from "next-auth/react";
  import type { ReactNode } from "react";
  import { useScopedQueryKeys } from "../use-query-keys";

  describe("useScopedQueryKeys", () => {
    it("returns null when session is unauthenticated", () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <SessionProvider session={null}>{children}</SessionProvider>
      );
      const { result } = renderHook(() => useScopedQueryKeys(), { wrapper });
      expect(result.current).toBeNull();
    });

    it("returns scoped factory output when session has organizationId", () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <SessionProvider
          session={
            {
              user: { id: "u", email: "a@b.c" },
              organizationId: "org-1",
              expires: "",
            } as never
          }
        >
          {children}
        </SessionProvider>
      );
      const { result } = renderHook(() => useScopedQueryKeys(), { wrapper });
      expect(result.current?.dashboard.overview()).toEqual(["org-1", "dashboard", "overview"]);
    });
  });
  ```

- [ ] **Step 2:** Run fail.

- [ ] **Step 3:** Implement.

  ```ts
  "use client";

  import { useSession } from "next-auth/react";
  import { useMemo } from "react";
  import { scopedKeys } from "@/lib/query-keys";

  export function useScopedQueryKeys() {
    const { data: session } = useSession();
    const orgId = (session as unknown as { organizationId?: string } | null)?.organizationId;
    return useMemo(() => (orgId ? scopedKeys(orgId) : null), [orgId]);
  }
  ```

- [ ] **Step 4:** Run pass.

- [ ] **Step 5:** Commit.

  ```bash
  git add apps/dashboard/src/hooks/use-query-keys.ts apps/dashboard/src/hooks/__tests__/use-query-keys.test.tsx
  git commit -m "feat(dashboard): useScopedQueryKeys hook"
  ```

---

## Task 29: Refactor every `useQuery` hook to scoped keys

**Files:**
- Modify: every file in `apps/dashboard/src/hooks/use-*.ts` that calls `useQuery` with a key from `query-keys`. Run `grep -l "queryKeys\." apps/dashboard/src/hooks/` to enumerate.
- Modify: `apps/dashboard/src/app/(auth)/decide/[id]/page.tsx:42` (inline `useQuery`)
- Modify: any other inline `useQuery` call sites — `grep -rn "useQuery({" apps/dashboard/src` to enumerate.

- [ ] **Step 1:** Enumerate.

  ```bash
  grep -l "queryKeys\." apps/dashboard/src/hooks/
  grep -rn "useQuery({" apps/dashboard/src --include="*.ts" --include="*.tsx"
  ```

  Record the list. Common: `use-approvals.ts`, `use-escalations.ts`, `use-audit.ts`, `use-dashboard-overview.ts`, `use-org-config.ts`, `use-module-status.ts`, `use-agents.ts`, `use-spend.ts`, `use-billing.ts`, `use-roi.ts`, `use-marketplace.ts`, `use-conversations.ts`, plus inline call sites.

- [ ] **Step 2:** Refactor each one.

  Pattern for each hook: replace the bare-key import with `useScopedQueryKeys()` + `enabled`:

  Before:

  ```ts
  import { queryKeys } from "@/lib/query-keys";

  export function useDashboardOverview() {
    return useQuery({
      queryKey: queryKeys.dashboard.overview(),
      queryFn: async () => { /* ... */ },
    });
  }
  ```

  After:

  ```ts
  import { useScopedQueryKeys } from "@/hooks/use-query-keys";

  export function useDashboardOverview() {
    const keys = useScopedQueryKeys();
    return useQuery({
      queryKey: keys?.dashboard.overview() ?? ["__disabled_dashboard_overview__"],
      queryFn: async () => { /* ... */ },
      enabled: !!keys,
    });
  }
  ```

  Repeat for every hook in the enumerated list.

- [ ] **Step 3:** Run all tests + typecheck after each batch of ≈3 hooks.

  ```bash
  pnpm --filter @switchboard/dashboard test
  pnpm --filter @switchboard/dashboard typecheck
  ```

  Tests will need updates to mock `useScopedQueryKeys` returning a stub orgId — fix as you go.

- [ ] **Step 4:** Commit in batches of related hooks (e.g. one commit for the dashboard-overview/escalations/approvals trio, another for marketplace/billing, etc. — each commit should leave tests green).

---

## Task 30: Build `signOut` wrapper that clears the cache

**Files:**
- Create: `apps/dashboard/src/lib/sign-out.ts`
- Create: `apps/dashboard/src/lib/__tests__/sign-out.test.ts`

- [ ] **Step 1:** Write the failing test.

  ```ts
  import { describe, it, expect, vi } from "vitest";

  vi.mock("next-auth/react", () => ({
    signOut: vi.fn().mockResolvedValue(undefined),
  }));

  describe("signOut wrapper", () => {
    it("calls queryClient.clear() before NextAuth signOut", async () => {
      const clear = vi.fn();
      const queryClient = { clear };
      const { signOut } = await import("../sign-out");
      const nextAuth = await import("next-auth/react");

      const order: string[] = [];
      clear.mockImplementation(() => order.push("clear"));
      vi.mocked(nextAuth.signOut).mockImplementation(async () => {
        order.push("signOut");
        return undefined as never;
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await signOut(queryClient as any);
      expect(order).toEqual(["clear", "signOut"]);
    });
  });
  ```

- [ ] **Step 2:** Run fail.

- [ ] **Step 3:** Implement.

  ```ts
  import { signOut as nextAuthSignOut } from "next-auth/react";
  import type { QueryClient } from "@tanstack/react-query";

  /**
   * Sign out wrapper that clears the React Query cache before delegating
   * to NextAuth's signOut. Defense-in-depth on top of scoped query keys
   * (see @/lib/query-keys + @/hooks/use-query-keys) — even a future hook
   * that bypasses useScopedQueryKeys() can't leak across sessions because
   * the cache is empty at the moment of session change.
   *
   * Call this from any sign-out UI:
   *   const queryClient = useQueryClient();
   *   await signOut(queryClient);
   */
  export async function signOut(queryClient: QueryClient): Promise<void> {
    queryClient.clear();
    await nextAuthSignOut();
  }
  ```

- [ ] **Step 4:** Run pass.

- [ ] **Step 5:** Commit.

  ```bash
  git add apps/dashboard/src/lib/sign-out.ts apps/dashboard/src/lib/__tests__/sign-out.test.ts
  git commit -m "feat(dashboard): signOut wrapper that clears query cache before NextAuth signOut"
  ```

---

## Task 31: Wire wrapper into all signOut call sites

**Files:**
- Modify: every file currently importing `signOut` from `next-auth/react` to import from `@/lib/sign-out` instead.

- [ ] **Step 1:** Enumerate.

  ```bash
  grep -rn 'signOut' apps/dashboard/src --include="*.ts" --include="*.tsx" | grep -v "next-auth/react.*types"
  grep -rn 'from "next-auth/react"' apps/dashboard/src --include="*.ts" --include="*.tsx"
  ```

- [ ] **Step 2:** For each call site, swap the import + adjust the call.

  Before:

  ```ts
  import { signOut } from "next-auth/react";
  // ...
  await signOut();
  ```

  After:

  ```ts
  import { useQueryClient } from "@tanstack/react-query";
  import { signOut } from "@/lib/sign-out";
  // ...
  const queryClient = useQueryClient();
  // ...
  await signOut(queryClient);
  ```

- [ ] **Step 3:** Run all tests + typecheck.

- [ ] **Step 4:** Smoke-check: sign out from any page; confirm the action completes; sign back in; confirm no Tenant A data persists from a prior session.

- [ ] **Step 5:** Commit.

  ```bash
  git add apps/dashboard/src
  git commit -m "feat(dashboard): wire signOut wrapper into all call sites"
  ```

---

## Task 32: PR-3 closeout — re-run repro, audit findings update, PR

**Files:**
- Modify: `docs/audits/2026-05-01-pre-launch-surface/artifacts/01-dashboard-core/repros/two-tenant-cache-leak.md`
- Modify: `docs/audits/2026-05-01-pre-launch-surface/01-dashboard-core-findings.md`

- [ ] **Step 1:** Re-run the three repros from Task 26 against the post-PR-3 build. All three must PASS.

- [ ] **Step 2:** Append a "post-fix verification" block to the repro doc with PASS/PASS/PASS + the post-fix SHA.

- [ ] **Step 3:** Update DC-11 + DC-13 Status to `Fixed (PR #__)`.

- [ ] **Step 4:** Validate.

  ```bash
  pnpm audit:validate docs/audits/2026-05-01-pre-launch-surface/01-dashboard-core-findings.md
  ```

- [ ] **Step 5:** Commit + push + PR.

  ```bash
  git push -u origin feat/console-pr3-auth-integrity
  gh pr create --title "feat(dashboard): /console launch readiness PR-3 — auth integrity (DC-11, DC-13)" --body "..."
  ```

  PR body: Summary, Closes findings (DC-11, DC-13), repro before/after, Test plan, link to spec.

- [ ] **Step 6:** After merge, update DC-11 + DC-13 Status with PR number; commit; push.

---

# Plan-level success criteria

The plan is fully executed when, in order:

1. PR-1 merged. /console queue cards open slide-overs; in-page nav works; login redirects correctly; Halt is hidden; middleware protects the three routes; audit DC-39, DC-40, DC-59 are `Fixed (PR #__)`; DC-41 is `Accepted (ship-with)` with a structured entry in `index.md`.
2. PR-2 merged. /console renders per-zone graceful degradation; Nova panel gates on `useModuleStatus()`; `consoleFixture` is gone from runtime; escalation reply banner branches on 200/502; audit DC-01, DC-04, DC-23, DC-58 are `Fixed (PR #__)`.
3. PR-3 merged. Two-tenant browser repro passes all three cases. Every `useQuery` consumes scoped keys via `useScopedQueryKeys()`. `signOut` wrapper clears the query cache. Audit DC-11, DC-13 are `Fixed (PR #__)` (or downgraded with rationale if pre-fix repro showed no leak today).
4. Post-launch backlog (DC-41 Halt button, DC-14 design-system fold-in, all Mediums and Lows) is recorded in `docs/audits/2026-05-01-pre-launch-surface/index.md`. Memory pointer at `~/.claude/projects/-Users-jasonli-switchboard/memory/reference_post_launch_backlog.md`.
5. Pre-launch re-audit gate (audit spec §13.7) runs against the launch-candidate SHA and produces no new Launch-blockers.

---

## Self-review notes

This plan was self-reviewed against the spec. Each spec section maps to one or more tasks:

- Spec §3 in-scope items → Tasks 2–12 (PR-1), Tasks 15–24 (PR-2), Tasks 27–32 (PR-3).
- Spec §3 out-of-scope items (DC-41 ship-with, DC-14 launch debt, Mediums/Lows) → Task 13 records DC-41 ship-with; rest land in `index.md` post-launch backlog after PR-3 (no task — captured by audit closeout flow).
- Spec §4.1 slide-over pattern → Tasks 9, 10, 11.
- Spec §4.2 per-zone degradation + Nova gate → Tasks 15–22.
- Spec §4.3 scoped query keys + signOut clear → Tasks 27–31.
- Spec §4.4 login redirect → Task 3.
- Spec §5 data flows → reflected in Tasks 7, 8, 10, 11, 23.
- Spec §6 error handling → Tasks 4 (middleware 401), 15–22 (per-zone 5xx), 23 (escalation 502).
- Spec §7 testing → every task has TDD steps + a final closeout PR with a Test plan checklist.
- Spec §8 PR sequence → Tasks 1–13 = PR-1; Tasks 14–24 = PR-2; Tasks 25–32 = PR-3.
- Spec §9 success criteria → mirrored at the bottom of this plan.
- Spec §10 risks → addressed inline (slide-over divergence via shared hooks; zone composition coupling via prop interfaces; query-key refactor scoped to one PR; OwnerTabs visual reconciliation called out in Task 5).
- Spec §11 operating procedures → Task 13 / 24 / 32 closeout structures.
- Spec §12 open questions → resolved (auth.ts plumbing in Task 2; escalation 502 shape in Task 8; module status in Task 21) or deferred (recommendation cards: not implemented per the scope trim; OwnerTabs visual: Task 5 calls it).
