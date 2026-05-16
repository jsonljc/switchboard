# Marketing Site Pre-Launch Fitness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the public marketing surface with the actual pilot/email-only GTM by deleting fictional/self-serve routes, cleaning up every internal reference (middleware, auth pages, landing chrome, tests), polishing surviving home-page links, and adding a drift guard so the fiction can't return.

**Architecture:** One cut-first PR on a focused branch. Deletes 5 route directories + 4 dead support files; modifies 7 files (v6 topbar/footer/test, landing-nav, landing-footer, landing-nav.test, middleware, login). No new components. No home redesign. Spec: `docs/superpowers/specs/2026-05-11-marketing-site-pre-launch-fitness-design.md`.

**Tech Stack:** Next.js 14 App Router (apps/dashboard), TypeScript, Tailwind, vitest. No backend or DB changes.

---

## Pre-flight: branch and base context

This plan is a single PR landing on `main`. Per `CLAUDE.md` branch doctrine, work on a focused feature branch — no worktree needed.

### Task 0: Sync local main and create branch

**Files:** none modified yet — environment setup only.

- [ ] **Step 0.1: Confirm clean working tree on main**

```bash
git status --short
git branch --show-current
```

Expected: working tree clean, branch is `main`. If dirty, stop and surface to user.

- [ ] **Step 0.2: Pull origin/main (gets E1a Nova→Riley rename)**

```bash
git pull --ff-only origin main
git log --oneline -3
```

Expected: top commit includes `5441a6c1 refactor(dashboard): rename marketing-site Nova to Riley (E1a)` and the docs/spec commits from this session. After this, `apps/dashboard/src/components/landing/v6/beat-riley.tsx` exists (not `beat-nova.tsx`).

If `pull --ff-only` fails, stop and surface to user — do not force-merge.

- [ ] **Step 0.3: Create feature branch**

```bash
git checkout -b chore/marketing-truth-up
```

- [ ] **Step 0.4: Verify spec is on disk and readable**

```bash
ls docs/superpowers/specs/2026-05-11-marketing-site-pre-launch-fitness-design.md
```

Expected: file exists.

---

## File Structure

This plan touches the following files. **Delete** means `git rm -r` the path. **Modify** means edit in place. No new files are created (the test extension lives inside an existing file).

**Deleted (12 paths):**

```
apps/dashboard/src/app/(public)/agents/                          (directory, includes page.tsx and [slug]/page.tsx)
apps/dashboard/src/app/(public)/how-it-works/                    (directory)
apps/dashboard/src/app/(public)/pricing/                         (directory)
apps/dashboard/src/app/(public)/signup/                          (directory)
apps/dashboard/src/app/(public)/get-started/                     (directory)
apps/dashboard/src/components/landing/agent-marketplace-card.tsx
apps/dashboard/src/components/landing/__tests__/agent-marketplace-card.test.tsx
apps/dashboard/src/lib/demo-data.ts
apps/dashboard/src/lib/launch-mode.ts
```

**Modified (7 files):**

```
apps/dashboard/src/components/landing/v6/__tests__/no-banned-claims.test.ts   (extend ban lists)
apps/dashboard/src/components/landing/v6/topbar.tsx                            (2 href changes)
apps/dashboard/src/components/landing/v6/footer.tsx                            (Contact mailto, anchor fix, drop Status col, grid-cols)
apps/dashboard/src/components/landing/landing-nav.tsx                          (strip dead nav links and CTA)
apps/dashboard/src/components/landing/landing-footer.tsx                       (strip Product col with dead links)
apps/dashboard/src/components/landing/__tests__/landing-nav.test.tsx           (update assertions to match stripped nav)
apps/dashboard/src/middleware.ts                                                (remove /signup matcher + redirect)
apps/dashboard/src/app/login/page.tsx                                          (remove "Sign up" link to deleted /signup)
```

**Untouched and verified to remain functional:**

```
apps/dashboard/src/app/(public)/page.tsx                  (v6 home root)
apps/dashboard/src/app/(public)/layout.tsx                (v6 home metadata)
apps/dashboard/src/app/(public)/privacy/page.tsx          (legal — uses LandingChrome)
apps/dashboard/src/app/(public)/terms/page.tsx            (legal — uses LandingChrome)
apps/dashboard/src/components/landing/landing-chrome.tsx  (still wraps privacy/terms)
apps/dashboard/src/components/landing/v6/*                (all v6 components except topbar/footer edits)
```

---

## Task 1: Extend drift-guard test (TDD-style forward guard)

**Files:**

- Modify: `apps/dashboard/src/components/landing/v6/__tests__/no-banned-claims.test.ts`

The existing test scans `v6/*.tsx`, `(public)/page.tsx`, `(public)/layout.tsx` for a `BANNED` array of `{ pattern, reason }`. Extend it. After the cuts and link fixes, the scan still has the same scope — so these new patterns are forward-looking guards.

- [ ] **Step 1.1: Add new patterns to the `BANNED` array**

Open `apps/dashboard/src/components/landing/v6/__tests__/no-banned-claims.test.ts`. Locate the `BANNED` array (the array of `{ pattern: RegExp, reason: string }` entries). Append the following entries at the end of the array (keep existing entries as-is):

```ts
// --- Fictional-agent / marketplace / self-serve copy fingerprints. ---
// The pilot GTM is a fixed 3-agent desk (Alex/Riley/Mira) with email-only
// onboarding. Anything resembling a marketplace catalog or self-serve flow is
// product fiction and must not return.
{ pattern: /Sales Closer/i, reason: "fictional agent — only Alex/Riley/Mira ship" },
{ pattern: /Nurture Specialist/i, reason: "fictional agent — only Alex/Riley/Mira ship" },
{ pattern: /Browse by outcome/i, reason: "marketplace framing — GTM is fixed 3-agent desk" },
{ pattern: /Agent marketplace/i, reason: "marketplace framing — GTM is fixed 3-agent desk" },
{ pattern: /Browse agents/i, reason: "marketplace framing — GTM is fixed 3-agent desk" },
{ pattern: /Choose an agent/i, reason: "marketplace framing — GTM is fixed 3-agent desk" },
{ pattern: /Free trial/i, reason: "self-serve framing — GTM is pilot/email-only" },
{ pattern: /Start free/i, reason: "self-serve framing — GTM is pilot/email-only" },
{ pattern: /Self[- ]serve/i, reason: "self-serve framing — GTM is pilot/email-only" },

// --- Banned route hrefs (link literals only — do NOT ban the phrase "Get started"). ---
// "Get started" is still a legitimate CTA label when it points to #pricing. We
// only ban the hrefs that target deleted self-serve/marketplace routes.
{ pattern: /href="\/signup"/, reason: "/signup route deleted — pilot is email-only" },
{ pattern: /href="\/get-started"/, reason: "/get-started route deleted — pilot is email-only" },
{ pattern: /href="\/agents"/, reason: "/agents route deleted — no marketplace catalog" },
{ pattern: /href="\/pricing"/, reason: "/pricing route deleted — home #pricing is source of truth" },
{ pattern: /href="\/how-it-works"/, reason: "/how-it-works route deleted — home #synergy covers this" },
```

- [ ] **Step 1.2: Run the test — expect PASS**

```bash
pnpm --filter @switchboard/dashboard exec vitest run src/components/landing/v6/__tests__/no-banned-claims.test.ts
```

Expected: PASS. The test's scan scope (v6 dir + `(public)/page.tsx` + `(public)/layout.tsx`) doesn't include the routes being deleted or `landing-nav.tsx` / `landing-footer.tsx`, so adding these patterns to the existing array won't fail on the unchanged source. These bans are forward-looking guards.

If the test FAILS, surface to user — the scan scope or v6 source has unexpected content; investigate before proceeding.

- [ ] **Step 1.3: Commit the guard**

```bash
git add apps/dashboard/src/components/landing/v6/__tests__/no-banned-claims.test.ts
git commit -m "test(dashboard): extend no-banned-claims with marketplace/self-serve fingerprints + dead-route hrefs"
```

---

## Task 2: Delete the 5 self-serve / marketplace route directories

**Files:**

- Delete: `apps/dashboard/src/app/(public)/agents/` (entire directory, includes `page.tsx` and `[slug]/page.tsx`)
- Delete: `apps/dashboard/src/app/(public)/how-it-works/`
- Delete: `apps/dashboard/src/app/(public)/pricing/`
- Delete: `apps/dashboard/src/app/(public)/signup/`
- Delete: `apps/dashboard/src/app/(public)/get-started/`

- [ ] **Step 2.1: Confirm directories exist before deleting**

```bash
ls apps/dashboard/src/app/\(public\)/{agents,how-it-works,pricing,signup,get-started}
```

Expected: all five directories list their contents.

- [ ] **Step 2.2: Delete the five directories**

```bash
git rm -r \
  apps/dashboard/src/app/\(public\)/agents \
  apps/dashboard/src/app/\(public\)/how-it-works \
  apps/dashboard/src/app/\(public\)/pricing \
  apps/dashboard/src/app/\(public\)/signup \
  apps/dashboard/src/app/\(public\)/get-started
```

- [ ] **Step 2.3: Sanity-check surviving public route-group dirs**

```bash
find apps/dashboard/src/app/\(public\) -maxdepth 2 -type d
```

Expected output (order may vary):

```
apps/dashboard/src/app/(public)
apps/dashboard/src/app/(public)/privacy
apps/dashboard/src/app/(public)/terms
```

If anything else shows up, investigate before proceeding.

- [ ] **Step 2.4: Commit the route cuts (do not run build yet — orphan imports still exist)**

```bash
git commit -m "feat(dashboard): delete fictional /agents, /how-it-works, /pricing, /signup, /get-started routes"
```

Tip: the rest of the app currently imports or references the deleted routes (middleware, login page, landing-nav/footer). Tasks 3–7 fix every consumer. Don't run the full build until then.

---

## Task 3: Strip dead links from LandingNav, LandingFooter, and their tests

**Files:**

- Modify: `apps/dashboard/src/components/landing/landing-nav.tsx`
- Modify: `apps/dashboard/src/components/landing/landing-footer.tsx`
- Modify: `apps/dashboard/src/components/landing/__tests__/landing-nav.test.tsx`

These wrap `/privacy` and `/terms` via `LandingChrome`. They currently link to deleted routes. We strip the dead Product nav and the `/signup` CTA so legal pages stay honest. Wordmark + Sign in / Dashboard CTA remain.

- [ ] **Step 3.1: Read the current LandingNav to confirm structure**

```bash
cat apps/dashboard/src/components/landing/landing-nav.tsx
```

Observe: imports `getCtaHref`/`getCtaLabel` from `@/lib/launch-mode`; renders "How it works" + "Pricing" links pointing to `/how-it-works` + `/pricing`; renders a "Get Started" CTA pointing to `getCtaHref()` (→ `/signup`); renders "Sign in" → `/login` when unauthenticated and "Dashboard" → `/` when authenticated.

- [ ] **Step 3.2: Rewrite LandingNav to drop the dead nav + CTA**

Open `apps/dashboard/src/components/landing/landing-nav.tsx`. Replace the entire file with the following. This drops `NAV_LINKS` (links to deleted routes), `getCtaHref`/`getCtaLabel` (the helper is deleted in Task 5), the mobile hamburger and mobile menu (now redundant — only one auth-state link remains, fits in the top bar at all sizes), and `usePathname` / `menuOpen` (no longer used).

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface LandingNavProps {
  isAuthenticated: boolean;
}

export function LandingNav({ isAuthenticated }: LandingNavProps) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 48);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header>
      <nav
        aria-label="Main navigation"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          transition: "background 250ms ease, border-color 250ms ease",
          background: scrolled ? "rgba(249, 248, 246, 0.96)" : "transparent",
          borderBottom: scrolled ? "1px solid #DDD9D3" : "1px solid transparent",
          backdropFilter: scrolled ? "blur(8px)" : "none",
        }}
      >
        <div
          className="page-width"
          style={{
            display: "flex",
            height: "4rem",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          {/* Wordmark */}
          <Link
            href="/"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: "1.125rem",
              letterSpacing: "-0.015em",
              color: "#1A1714",
              textDecoration: "none",
            }}
          >
            Switchboard
          </Link>

          {/* Right action — auth-state dependent */}
          {isAuthenticated ? (
            <Link
              href="/settings/account"
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 600,
                fontSize: "0.875rem",
                color: "#6B6560",
                textDecoration: "none",
              }}
            >
              Dashboard
            </Link>
          ) : (
            <Link
              href="/login"
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 600,
                fontSize: "0.875rem",
                color: "#6B6560",
                textDecoration: "none",
              }}
            >
              Sign in
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
```

If the existing `Dashboard` link in the file points somewhere other than `/settings/account` (per MEMORY.md, `/settings` is a real post-redesign route), preserve whatever target the original used — do not introduce a new route. The structure above mirrors the original's targets.

- [ ] **Step 3.3: Read the current LandingFooter to confirm structure**

```bash
cat apps/dashboard/src/components/landing/landing-footer.tsx
```

Observe: three-column grid — Brand, Product (with `/how-it-works` + `/pricing` links), Company (Contact mailto + `/privacy` + `/terms`).

- [ ] **Step 3.4: Remove the Product column from LandingFooter**

Open `apps/dashboard/src/components/landing/landing-footer.tsx`. Delete the entire `{/* Product */}` `<div>` block (the `<div>` containing the "Product" heading and the `/how-it-works` + `/pricing` link map). Update the grid to two columns:

- Change `gridTemplateColumns: "repeat(2, 1fr)"` to `gridTemplateColumns: "1fr 1fr"` (or leave the `repeat(2, 1fr)` and update the responsive `className="sm:grid-cols-3"` to `className="sm:grid-cols-2"` so wide layouts stay two-column).

The result is a two-column footer: Brand on the left, Company (Contact / Privacy / Terms) on the right.

- [ ] **Step 3.5: Update the LandingNav test to match the stripped nav**

Open `apps/dashboard/src/components/landing/__tests__/landing-nav.test.tsx`.

1. Delete the test `it("shows How it works and Pricing links", …)` entirely — those links no longer render.
2. Keep the wordmark test, the "does not show Agents link" test (still true), the "shows sign in when not authenticated" test, and the "shows dashboard link when authenticated" test.
3. Add a new assertion to guard the truth-up: `it("does not show How it works or Pricing links", () => { … })` that calls `screen.queryByRole("link", { name: /how it works/i, hidden: true })` and asserts `.not.toBeInTheDocument()`, same for `pricing`.
4. Add another guard: `it("does not show a Get Started CTA pointing to /signup", () => { … })` that asserts no link in the nav has `href="/signup"`.

Concrete code to add at the end of the existing `describe("LandingNav", () => { ... })`:

```ts
it("does not show How it works or Pricing links", () => {
  render(<LandingNav isAuthenticated={false} />);
  expect(
    screen.queryByRole("link", { name: /how it works/i, hidden: true }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /^pricing$/i, hidden: true })).not.toBeInTheDocument();
});

it("does not link to deleted /signup or /get-started routes", () => {
  const { container } = render(<LandingNav isAuthenticated={false} />);
  const anchors = Array.from(container.querySelectorAll("a"));
  for (const a of anchors) {
    expect(a.getAttribute("href")).not.toBe("/signup");
    expect(a.getAttribute("href")).not.toBe("/get-started");
  }
});
```

- [ ] **Step 3.6: Run the LandingNav test**

```bash
pnpm --filter @switchboard/dashboard exec vitest run src/components/landing/__tests__/landing-nav.test.tsx
```

Expected: PASS. All assertions match the stripped nav.

- [ ] **Step 3.7: Commit chrome cleanup**

```bash
git add apps/dashboard/src/components/landing/landing-nav.tsx \
        apps/dashboard/src/components/landing/landing-footer.tsx \
        apps/dashboard/src/components/landing/__tests__/landing-nav.test.tsx
git commit -m "refactor(dashboard): strip dead /how-it-works /pricing /signup refs from LandingNav and LandingFooter"
```

---

## Task 4: Clean up auth-adjacent signup references

**Files:**

- Modify: `apps/dashboard/src/middleware.ts`
- Modify: `apps/dashboard/src/app/login/page.tsx`

The middleware has explicit `/signup` matching and redirect logic; the login page has a "Sign up" link to the deleted route. Both must go.

- [ ] **Step 4.1: Remove the /signup block in middleware.ts**

Open `apps/dashboard/src/middleware.ts`. Delete this block (currently around lines 83–89):

```ts
// Block /signup in non-beta mode at the middleware level
if (pathname === "/signup") {
  const launchMode = process.env.NEXT_PUBLIC_LAUNCH_MODE || "waitlist";
  if (launchMode !== "beta") {
    return NextResponse.redirect(new URL("/get-started", request.url));
  }
}
```

- [ ] **Step 4.2: Remove "/signup" from the middleware matcher**

In the same file, locate `export const config = { matcher: [ ... ] }` (currently around lines 112–124). Remove the `"/signup",` line from the matcher array.

After: matcher should start with `"/api/dashboard/:path*"` and contain only the existing auth-page prefixes.

- [ ] **Step 4.3: Remove the /signup link from the login page**

Open `apps/dashboard/src/app/login/page.tsx`. Locate this block near the end of the JSX (currently around lines 487–505):

```tsx
{
  /* Footer note */
}
<p className="mt-6 text-center" style={{ fontSize: "13px", color: "var(--sw-text-muted)" }}>
  Don&apos;t have an account?{" "}
  <Link
    href="/signup"
    style={{
      color: "var(--sw-text-secondary)",
      textDecoration: "none",
    }}
    onMouseEnter={(e) => {
      (e.currentTarget as HTMLAnchorElement).style.color = "var(--sw-text-primary)";
    }}
    onMouseLeave={(e) => {
      (e.currentTarget as HTMLAnchorElement).style.color = "var(--sw-text-secondary)";
    }}
  >
    Get started
  </Link>
</p>;
```

Delete the entire `{/* Footer note */}` comment AND the `<p className="mt-6 text-center" …>…</p>` element that contains the `/signup` link.

- [ ] **Step 4.3b: Check whether the `Link` import is now unused**

```bash
rg "<Link " apps/dashboard/src/app/login/page.tsx
```

If no matches remain in this file, remove the `import Link from "next/link";` line at the top of `apps/dashboard/src/app/login/page.tsx` to keep the file lint-clean. If other `<Link>` usages remain (the main login form may have them), leave the import.

- [ ] **Step 4.4: Run typecheck to confirm no orphan imports**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: no errors related to middleware.ts or login/page.tsx. (Errors from missing `launch-mode.ts` may surface in landing-nav.tsx if Task 3.2's import removal was missed — fix before proceeding.)

- [ ] **Step 4.5: Commit auth cleanup**

```bash
git add apps/dashboard/src/middleware.ts apps/dashboard/src/app/login/page.tsx
git commit -m "chore(dashboard): remove /signup middleware redirect + login-page link (route deleted)"
```

---

## Task 5: Delete dead support code

**Files:**

- Delete: `apps/dashboard/src/components/landing/agent-marketplace-card.tsx`
- Delete: `apps/dashboard/src/components/landing/__tests__/agent-marketplace-card.test.tsx`
- Delete: `apps/dashboard/src/lib/demo-data.ts`
- Delete: `apps/dashboard/src/lib/launch-mode.ts`

Order matters: confirm zero remaining importers before each `git rm`.

- [ ] **Step 5.1: Confirm no surviving imports of `agent-marketplace-card`**

```bash
rg "agent-marketplace-card|AgentMarketplaceCard" apps/dashboard/src
```

Expected: no matches (or only matches inside the file being deleted, which we'll remove next).

If unexpected consumers appear, surface to user before deleting.

- [ ] **Step 5.2: Confirm no surviving imports of `demo-data`**

```bash
rg "lib/demo-data|from.*demo-data" apps/dashboard/src
```

Expected: no matches.

- [ ] **Step 5.3: Confirm no surviving imports of `launch-mode`**

```bash
rg "lib/launch-mode|getCtaHref|getCtaLabel" apps/dashboard/src
```

Expected: no matches (Task 3.2 removed the only consumer in `landing-nav.tsx`).

If matches appear, fix the consumer first — do not orphan the import.

- [ ] **Step 5.4: Delete the four files**

```bash
git rm \
  apps/dashboard/src/components/landing/agent-marketplace-card.tsx \
  apps/dashboard/src/components/landing/__tests__/agent-marketplace-card.test.tsx \
  apps/dashboard/src/lib/demo-data.ts \
  apps/dashboard/src/lib/launch-mode.ts
```

- [ ] **Step 5.5: Commit support-code deletion**

```bash
git commit -m "chore(dashboard): delete unused landing marketplace card, demo-data, and launch-mode helpers"
```

---

## Task 6: Fix surviving v6 home links (topbar + footer)

**Files:**

- Modify: `apps/dashboard/src/components/landing/v6/topbar.tsx`
- Modify: `apps/dashboard/src/components/landing/v6/footer.tsx`

- [ ] **Step 6.1: Fix topbar.tsx — two href changes**

Open `apps/dashboard/src/components/landing/v6/topbar.tsx`. Make these changes:

1. The `<a href="#how">How it works</a>` element → change `href="#how"` to `href="#synergy"`.
2. The `<a href="#closer">Get started</a>` element (the rounded-pill CTA with `ArrowSig`) → change `href="#closer"` to `href="#pricing"`.

All surrounding markup, classes, and `<ArrowSig />` use stays the same.

- [ ] **Step 6.2: Fix footer.tsx — Contact mailto, anchor fix, drop Status column, update grid**

Open `apps/dashboard/src/components/landing/v6/footer.tsx`. Make these changes:

1. **The desk col**: the link `<a href="#how">How it works</a>` → change `href="#how"` to `href="#synergy"`. Leave the `#alex`, `#riley`, `#mira`, `#pricing` siblings as-is (E1a already renamed `#nova` → `#riley`; verify it reads `#riley`).
2. **Company col**: the link `<a href="#">Contact</a>` → change `href="#"` to `href="mailto:hello@switchboard.ai"`.
3. **Status col**: delete the entire `<FooterCol heading="Status"> … </FooterCol>` block (three `href="#"` placeholder links: Status, status.switchboard.live, @switchboard).
4. **Grid columns**: the parent `<div>` wrapping the FooterCols currently has `className="mb-16 grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-12 max-[900px]:grid-cols-2 max-[900px]:gap-10"` (4 columns). Update it to 3 columns: `className="mb-16 grid grid-cols-[1.4fr_1fr_1fr] gap-12 max-[900px]:grid-cols-2 max-[900px]:gap-10"`.

- [ ] **Step 6.3: Run the v6 banned-claims test to confirm topbar/footer source is clean**

```bash
pnpm --filter @switchboard/dashboard exec vitest run src/components/landing/v6/__tests__/no-banned-claims.test.ts
```

Expected: PASS. None of the banned hrefs (`href="/signup"` etc.) appear in v6 source, and no banned copy fingerprints appear.

- [ ] **Step 6.4: Commit v6 polish**

```bash
git add apps/dashboard/src/components/landing/v6/topbar.tsx \
        apps/dashboard/src/components/landing/v6/footer.tsx
git commit -m "fix(dashboard): fix v6 landing topbar/footer anchors, Contact mailto, drop placeholder Status col"
```

---

## Task 7: Full validation sweep

Run the validation gauntlet end-to-end. Fix any orphan or regression before merging.

- [ ] **Step 7.1: rg sweep for deleted-route references**

```bash
rg '/signup|/get-started|/agents|/pricing|/how-it-works' apps/dashboard/src
```

Expected: no output (rg exits with code 1). If any matches appear:

- **Allowed false positives** to verify and skip: API path segments under `/api/dashboard/agents/...` (e.g., `agents/${agentKey}/metrics`). These are unrelated to the marketplace route.
- **Anything else** (a stray `Link`/`<a>` href, a string constant, a metadata description, a doc/README mention) must be fixed before continuing. Surface to user if intent is unclear.

A safer filtered sweep that ignores the `api/dashboard/agents` API namespace:

```bash
rg '/signup|/get-started|/agents|/pricing|/how-it-works' apps/dashboard/src \
  | rg -v '/api/dashboard/agents|/api/agents'
```

- [ ] **Step 7.2: rg sweep for deleted support code and banned copy**

```bash
rg 'demo-data|agent-marketplace-card|launch-mode|getCtaHref|getCtaLabel' apps/dashboard/src
rg 'Sales Closer|Nurture Specialist|Browse by outcome|Agent marketplace|Browse agents|Choose an agent|Free trial|Self-serve|Start free' apps/dashboard/src
```

Expected: no output for either sweep. Any match must be fixed.

- [ ] **Step 7.3: Public route-group sanity check**

```bash
find apps/dashboard/src/app/\(public\) -maxdepth 2 -type d
```

Expected output:

```
apps/dashboard/src/app/(public)
apps/dashboard/src/app/(public)/privacy
apps/dashboard/src/app/(public)/terms
```

Three lines, exactly. If `agents`, `how-it-works`, `pricing`, `signup`, or `get-started` appear, Task 2 wasn't fully completed.

- [ ] **Step 7.4: Typecheck**

```bash
pnpm typecheck
```

Expected: PASS. If errors mention missing exports from `@switchboard/schemas`, `@switchboard/db`, or `@switchboard/core`, run `pnpm reset` first (per CLAUDE.md guidance) and retry.

- [ ] **Step 7.5: Lint**

```bash
pnpm lint
```

Expected: PASS. Pre-existing `any` warnings in API routes and `auth.ts` are acceptable per MEMORY.md.

- [ ] **Step 7.6: Full test suite**

```bash
pnpm test
```

Expected: PASS. Specifically, the modified `no-banned-claims.test.ts` and `landing-nav.test.tsx` must pass with their new assertions, and the deleted `agent-marketplace-card.test.tsx` should no longer appear in the run summary.

If `db prisma-work-trace-store-integrity`, `prisma-ledger-storage`, or `prisma-greeting-signal-store` fail, those are pre-existing flakes per MEMORY.md `feedback_db_integrity_tests_pg_advisory_lock.md` — confirm the same tests fail on `origin/main` before continuing. Do not let them block this PR.

- [ ] **Step 7.7: Dashboard `next build` (CI does NOT run this — required locally)**

```bash
pnpm --filter @switchboard/dashboard build
```

Expected: build succeeds. Per MEMORY.md `feedback_dashboard_build_not_in_ci.md`, this is the only place `.js`-extension and import regressions get caught. If build fails, fix the underlying issue — do not skip.

---

## Task 8: Manual smoke test

The validation in Task 7 is automated; this is the human-eyes pass.

- [ ] **Step 8.1: Start the dashboard dev server**

```bash
pnpm --filter @switchboard/dashboard dev
```

Wait for "Ready" line. The dashboard runs on `http://localhost:3002` per CLAUDE.md.

- [ ] **Step 8.2: Walk the home page in a browser**

Open `http://localhost:3002/`. Confirm:

1. Page renders without console errors (open devtools, no red).
2. **Topbar links**:
   - "How it works" → scrolls to the "They're better together" synergy section (`#synergy`).
   - "Pricing" → scrolls to the per-agent pricing cards section (`#pricing`).
   - "Sign in" → navigates to `/login` (page loads).
   - "Get started" CTA → scrolls to `#pricing` (lands on the mailto cards).
3. **Footer links**:
   - The desk → `#alex`, `#riley`, `#mira` each scroll to the corresponding beat section.
   - "How it works" (footer) → scrolls to `#synergy`.
   - "Pricing" (footer) → scrolls to `#pricing`.
   - "Contact" → opens mailto handler (or copies hello@switchboard.ai depending on OS default).
   - "Privacy" → navigates to `/privacy` (renders).
   - "Terms" → navigates to `/terms` (renders).
   - No Status column visible.
4. **Layout**: footer is 3 columns on wide viewports (Brand / The desk / Company), not 4.

- [ ] **Step 8.3: Visit deleted routes directly**

Open these URLs one by one; each should return the default Next 404 page (this is acceptable launch behavior — no redirects were configured):

- `http://localhost:3002/agents`
- `http://localhost:3002/agents/alex`
- `http://localhost:3002/how-it-works`
- `http://localhost:3002/pricing`
- `http://localhost:3002/signup`
- `http://localhost:3002/get-started`

- [ ] **Step 8.4: Verify legal pages still work**

- `http://localhost:3002/privacy` — renders. Top nav shows only wordmark + "Sign in" (not "How it works" or "Pricing" or "Get Started"). Footer shows Brand + Company (not Product col).
- `http://localhost:3002/terms` — same expectations.

- [ ] **Step 8.5: Verify the login page**

- `http://localhost:3002/login` — renders. No "Sign up" link near the auth form.

- [ ] **Step 8.6: Stop the dev server**

`Ctrl-C` in the terminal.

---

## Task 9: Push branch and open the PR

- [ ] **Step 9.1: Confirm branch state**

```bash
git status --short
git log --oneline main..HEAD
```

Expected: clean working tree; commit list shows the 5–7 commits from Tasks 1–6 (test extension, route cuts, chrome cleanup, auth cleanup, dead-code deletion, v6 polish).

- [ ] **Step 9.2: Push the branch**

```bash
git push -u origin chore/marketing-truth-up
```

- [ ] **Step 9.3: Open the PR**

```bash
gh pr create --title "chore(dashboard): marketing truth-up — delete self-serve/marketplace surfaces" --body "$(cat <<'EOF'
## Summary

Align the public marketing surface with the actual pilot/email-only GTM. Deletes fictional/self-serve routes (`/agents`, `/how-it-works`, `/pricing`, `/signup`, `/get-started`), strips every internal reference (middleware, login page, LandingNav/LandingFooter, demo helpers), polishes v6 home topbar/footer (broken anchors, placeholder Status column, Contact mailto), and adds a banned-claims drift guard so the fiction cannot return.

Spec: `docs/superpowers/specs/2026-05-11-marketing-site-pre-launch-fitness-design.md`

## Why now

WhatsApp / App Review is the launch gate; while we wait, the site must match what we actually sell today: email-only pilot → 3 fixed operational agents (Alex / Riley / Mira) → founder-led setup → pilot pricing. The home page already tells that story; the secondary routes (and the LandingChrome wrapping /privacy + /terms) described a self-serve marketplace product that does not exist.

## What's deleted

- `apps/dashboard/src/app/(public)/agents/` (including `[slug]/`)
- `apps/dashboard/src/app/(public)/how-it-works/`
- `apps/dashboard/src/app/(public)/pricing/`
- `apps/dashboard/src/app/(public)/signup/`
- `apps/dashboard/src/app/(public)/get-started/`
- `apps/dashboard/src/components/landing/agent-marketplace-card.tsx` (+ test)
- `apps/dashboard/src/lib/demo-data.ts`
- `apps/dashboard/src/lib/launch-mode.ts`

## What's modified

- `landing-nav.tsx` + `landing-footer.tsx` — strip dead Product nav and /signup CTA; legal pages stay clean.
- `landing-nav.test.tsx` — updated assertions + new guards.
- `middleware.ts` — drop /signup matcher and redirect logic.
- `app/login/page.tsx` — remove "Sign up" link to deleted /signup.
- `v6/topbar.tsx` — `#how` → `#synergy`, `#closer` → `#pricing`.
- `v6/footer.tsx` — Contact → mailto, `#how` → `#synergy`, drop Status column, grid 4→3 cols.
- `v6/__tests__/no-banned-claims.test.ts` — extend with marketplace/self-serve copy + dead-route href bans.

## Test plan

- [ ] `pnpm typecheck` passes.
- [ ] `pnpm lint` passes.
- [ ] `pnpm test` passes (db integrity pre-existing flakes acceptable per MEMORY).
- [ ] `pnpm --filter @switchboard/dashboard build` passes locally (CI does not run this).
- [ ] Manual smoke: every topbar/footer link on `/` resolves to a real destination.
- [ ] `/privacy` and `/terms` render with stripped nav (no Product col, no Get Started CTA).
- [ ] `/login` page has no "Sign up" link.
- [ ] Deleted routes return Next 404.
EOF
)"
```

- [ ] **Step 9.4: Return the PR URL**

The `gh pr create` command prints the PR URL. Capture it for the user.

---

## Self-review notes

After plan write-up:

- **Spec coverage:** every spec section maps to a task — route cuts (T2), drift guards (T1 + T6.3), home polish (T6), validation (T7), manual smoke (T8). The auth-adjacent fixes (middleware, launch-mode, login page) and the LandingChrome consumer cleanup (LandingNav/LandingFooter/test) were not explicit in the original spec — they emerged during plan write-up as required fallout from the deletions, and were authorized in the brainstorming session before this plan was written. Single-PR shape is preserved.
- **Placeholder scan:** no TBDs, no "implement appropriately" steps. Every code edit is described with the actual change.
- **Type consistency:** test names (`no-banned-claims.test.ts`, `landing-nav.test.tsx`) match across tasks. CTA target (`#pricing`) matches between topbar and Get-started cards. mailto target (`hello@switchboard.ai`) consistent.
- **Ordering:** dead-code deletion (T5) waits until after its consumers are updated (T3, T4), so no orphan-import window exists between commits.
