# Customer UX Overhaul — Phase 0 + Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-agent-cockpit dashboard with the unified "Front Desk" — a single shell with `Home · Inbox · Results` nav, a real server-backed Pause, and a mobile-first Home — per the approved blueprint at `docs/superpowers/specs/2026-05-24-customer-ux-overhaul-design.md`.

**Architecture:** Next.js 14 App Router (`apps/dashboard`, port 3002). One editorial shell lifted to `(auth)/layout.tsx`; authed `/` becomes Home; agents become presence/filter/light-panel, never routes. Decision data flows from the already-built core `Decision`/`useDecisionFeed` path; this plan adds a risk contract to it. Pause is wired to the dormant, already-built `/api/dashboard/governance/halt` hooks.

**Tech Stack:** TypeScript, Next.js App Router, React Query (TanStack), Tailwind + CSS vars, Vitest + Testing Library. Monorepo: pnpm + Turborepo.

---

## HARD CONSTRAINTS (do not violate — from the approved spec)

- **Do NOT redesign.** Implement the approved blueprint in dependency order. Phase 0/1 only.
- **Preserve the IA exactly:** `Home · Inbox · Results`. **No "Team" tab. No agent routes.** Agent views are sheets, never routes.
- **Sequencing lock:** real server-backed Pause (P0-C) MUST land before any agent panel ships. (No agent panel in this plan — that is Phase 2 — but P0-C is still a prerequisite.)
- **Decision risk contract:** every decision carries `riskLevel`/`externalEffect`/`financialEffect`/`clientFacing`/`requiresConfirmation`. UI reads flags; it never infers risk from copy.
- **Outcome-not-concept copy:** visible labels name outcomes (Home, Needs You, This Week, Work in Progress, Work Log, "Why X recommends this", Permissions). No internal language in the UI.

## Dashboard testing rules (apply to every task)

- Coverage threshold is **40/35/40/40** (statements/branches/functions/lines) — `apps/dashboard/vitest.config.ts`. NOT the CLAUDE.md global.
- **Dashboard imports omit `.js` extensions** (Next.js rejects them); `next build` is **NOT** in CI. After any Next code change run `pnpm --filter @switchboard/dashboard build` locally before claiming done.
- Hook test scaffold: `renderHook` + `QueryClientProvider({ retry:false })` wrapper + `vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { organizationId: "org-1" }, status: "authenticated" }) }))` + `vi.stubGlobal("fetch", mockFetch)`. Fixture-mode hooks also `vi.mock("@/lib/route-availability")`.
- Page/component test scaffold: `render` + QueryClient wrapper + `vi.mock` each hook (module-level mutable state objects flipped per test); mock `next/navigation` `useRouter` and `@/components/ui/use-toast`. Pure presentational components need no wrapper.
- Schemas/core changes: if `pnpm typecheck` reports missing exports/Prisma fields, run `pnpm reset` first. `db`/`api` tests mock Prisma (no Postgres in CI).
- Run `pnpm --filter @switchboard/dashboard test` and `pnpm typecheck` before each commit. CI lint runs `pnpm format:check` — run it before pushing.

## Scope decisions made explicit (resolve ambiguity up front)

1. **`/` collision → Option A (spec-aligned):** create `(auth)/page.tsx` (Home) and relocate the marketing landing to `(public)/welcome/page.tsx`. Logged-out visitors to `/` are redirected to `/login` by middleware.
2. **Results route:** the `Results` tab points at **`/results`** — owner-facing nav must not show old `/reports` naming. `(auth)/results/page.tsx` **renders** the existing reports surface for now (no redirect — a redirect would break the Results active-state highlight), so the tab is non-empty without rebuilding it. MV-Results polish (period toggle etc., spec §6.5) is deferred.
3. **Inbox in P0-A** is a **basic** decision list backed by the existing `useDecisionFeed(null)` (so the tab is not dead). Rich detail, swipe, and the risk-tiered actions are Phase 2 — except the swipe-gating predicate helper, which we build in P1-B.
4. **Per-agent Pause does not exist server-side** — `/api/dashboard/governance/halt` is org-global (resume hardcodes `skillSlug:"alex"`). P0-C wires the existing global semantics honestly; a per-agent pause is a separate server change, out of scope.
5. **`--sw-*` (marketing) and `v6.*` (landing) palettes are OUT of scope** — this overhaul is the authed operator app. P0-B touches only the editorial/operator registers.
6. **`/alex` & `/riley` during migration:** route-reachable for back-compat ONLY. In P0-A they are removed from ALL nav, links, and customer-facing entry points (the shell nav drops them in A4; also grep and remove stray `href="/alex"`/`"/riley"`). **Phase 2 retirement path:** redirect `/alex → /?agent=alex` and `/riley → /?agent=riley` (opens the agent light panel), then delete the routes.
7. **Risk-contract safety default:** a decision with NO risk contract is treated as UNSAFE — `canSwipeApprove` returns `false` and `needsConfirm` returns `true` when the contract is missing. Legacy/unknown decisions can never be swipe-approved.

---

## File Structure

**PR P0-A — shell + routing**

- Create: `apps/dashboard/src/app/(auth)/page.tsx` (Home shell), `(auth)/inbox/page.tsx`, `(auth)/results/page.tsx`, `apps/dashboard/src/components/layout/primary-nav.tsx` (+ `primary-nav.module.css` if needed)
- Move: `apps/dashboard/src/app/(public)/page.tsx` → `(public)/welcome/page.tsx`
- Modify: `(auth)/layout.tsx` (lift `HaltProvider`/`RightDrawerProvider`, mount shell), `components/layout/editorial-auth-shell.tsx` (nav → primary-nav, drop agent links), `components/cockpit/cockpit-page.tsx` + `riley-cockpit-page.tsx` (delete `<Topbar>`), `app/login/redirect-logic.ts` (no change if Home stays at `/`), `middleware.ts`, `components/layout/app-shell.tsx` (route sets)
- Delete: `components/cockpit/topbar.tsx` + its test
- Test: `components/layout/__tests__/primary-nav.test.tsx`, update `editorial-auth-shell.test.tsx`, `app/__tests__/marketing-route.test.ts`

**PR P0-B — tokens + visual system**

- Modify: `apps/dashboard/src/app/globals.css` (canonical tokens + alias `--mercury-*`), `apps/dashboard/tailwind.config.ts` (`action`, `agent.*`), `apps/dashboard/src/lib/cockpit/alex-config.ts` + `riley/riley-config.ts` (identity colors off amber)
- Test: `apps/dashboard/src/app/__tests__/tokens.test.ts`

**PR P0-C — real server-backed halt**

- Modify: `apps/dashboard/src/components/layout/halt/halt-context.tsx` (wire to server), `apps/dashboard/src/hooks/use-governance.ts` (parse resume readiness 400)
- Test: rewrite `components/layout/halt/__tests__/halt-context.test.tsx`; update cockpit-page/riley mocks

**PR P1-A — Home module shell**

- Create: `apps/dashboard/src/components/home/` — `home-page.tsx`, `team-pulse.tsx`, `needs-you.tsx`, `this-week.tsx`, `while-you-slept.tsx`, `work-in-progress.tsx`, `permissions.tsx`, `home.module.css`
- Modify: `(auth)/page.tsx` to render `<HomePage>`
- Test: co-located `*.test.tsx` per module

**PR P1-B — risk contract + Needs You wiring**

- Modify: `packages/schemas/src/recommendations.ts`, `packages/core/src/decisions/types.ts`, `packages/core/src/decisions/adapters/recommendation-adapter.ts`, `packages/core/src/decisions/adapters/handoff-adapter.ts`, `apps/dashboard/src/lib/decisions/types.ts`
- Create: `apps/dashboard/src/lib/decisions/swipe-policy.ts` (the gating predicate)
- Test: co-located tests in schemas/core; `swipe-policy.test.ts`

---

# PR P0-A — App shell + routing

### Task A1: Relocate marketing off `/` to resolve the route collision

**Files:**

- Move: `apps/dashboard/src/app/(public)/page.tsx` → `apps/dashboard/src/app/(public)/welcome/page.tsx`
- Test: `apps/dashboard/src/app/__tests__/marketing-route.test.ts`

- [ ] **Step 1: Write the failing test** — assert marketing lives at `/welcome` and `/` is free for an authed page.

```ts
// apps/dashboard/src/app/__tests__/marketing-route.test.ts
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";

const APP = join(__dirname, "..");

describe("marketing relocation", () => {
  it("marketing landing now lives under (public)/welcome", () => {
    expect(existsSync(join(APP, "(public)/welcome/page.tsx"))).toBe(true);
  });
  it("(public) no longer owns the root path", () => {
    expect(existsSync(join(APP, "(public)/page.tsx"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `pnpm --filter @switchboard/dashboard test marketing-route` → fails (file still at old path).
- [ ] **Step 3: Move the file** — `git mv apps/dashboard/src/app/\(public\)/page.tsx apps/dashboard/src/app/\(public\)/welcome/page.tsx`. Update any internal relative imports in that file (`../` depth increases by one). If it imported `./landing/v6/...`, change to `../landing/v6/...`.
- [ ] **Step 4: Update marketing CTAs/links** that point to `/` for marketing context to `/welcome` (grep `href="/"` inside `landing/v6/` and the public layout). Leave authed `/` links alone.
- [ ] **Step 5: Run test, expect PASS.** Then `pnpm --filter @switchboard/dashboard build` to confirm no route conflict.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "refactor(dashboard): relocate marketing landing to /welcome to free authed /"`

### Task A2: Create the authed Home shell at `/`

**Files:**

- Create: `apps/dashboard/src/app/(auth)/page.tsx`
- Test: `apps/dashboard/src/app/(auth)/__tests__/home-route.test.ts`

- [ ] **Step 1: Failing test** — assert `(auth)/page.tsx` exists and default-exports a component.

```ts
// apps/dashboard/src/app/(auth)/__tests__/home-route.test.ts
import { describe, it, expect } from "vitest";
import HomePage from "../page";
describe("authed home route", () => {
  it("exports a Home page component", () => {
    expect(typeof HomePage).toBe("function");
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (module not found).
- [ ] **Step 3: Implement minimal Home shell** (P1-A fills modules; here just the routed shell + greeting):

```tsx
// apps/dashboard/src/app/(auth)/page.tsx
export default function HomePage() {
  return (
    <div className="home-shell">
      <h1 className="home-greeting">Your team is on shift.</h1>
      {/* Home modules land in P1-A */}
    </div>
  );
}
```

- [ ] **Step 4: Run test, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(dashboard): add authed Home route at /"`

### Task A3: Build the primary nav (Home · Inbox · Results), no Team tab

**Files:**

- Create: `apps/dashboard/src/components/layout/primary-nav.tsx`
- Test: `apps/dashboard/src/components/layout/__tests__/primary-nav.test.tsx`

- [ ] **Step 1: Failing test** — exactly three links, correct hrefs, no agent/Team links, active state from `usePathname`.

```tsx
// apps/dashboard/src/components/layout/__tests__/primary-nav.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
import { PrimaryNav } from "../primary-nav";

describe("PrimaryNav", () => {
  it("renders exactly Home, Inbox, Results", () => {
    render(<PrimaryNav />);
    expect(screen.getByRole("link", { name: /home/i })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: /inbox/i })).toHaveAttribute("href", "/inbox");
    expect(screen.getByRole("link", { name: /results/i })).toHaveAttribute("href", "/results");
    expect(screen.queryByRole("link", { name: /team|alex|riley|mira/i })).toBeNull();
  });
  it("marks Home active on /", () => {
    render(<PrimaryNav />);
    expect(screen.getByRole("link", { name: /home/i })).toHaveAttribute("aria-current", "page");
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** — client component; bottom-fixed on mobile, inline on desktop via Tailwind (`fixed bottom-0 inset-x-0 md:static`). Three items only.

```tsx
// apps/dashboard/src/components/layout/primary-nav.tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { label: "Home", href: "/" },
  { label: "Inbox", href: "/inbox" },
  { label: "Results", href: "/results" }, // /results renders the reports surface for now
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function PrimaryNav() {
  const pathname = usePathname() ?? "/";
  return (
    <nav className="primary-nav" aria-label="Primary">
      {ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={isActive(pathname, item.href) ? "page" : undefined}
          className="primary-nav__item"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Add `.primary-nav` styles** to `globals.css` (mobile bottom bar + desktop inline). Reference spec §6 for placement; use `var(--action)` for the active indicator (token lands in P0-B; until then it resolves to `--operator`).
- [ ] **Step 5: Run test, expect PASS.**
- [ ] **Step 6: Commit** — `git commit -am "feat(dashboard): primary Home·Inbox·Results nav (no Team tab)"`

### Task A4: Replace shell nav with primary-nav; drop agent links + me-chip

**Files:**

- Modify: `apps/dashboard/src/components/layout/editorial-auth-shell.tsx`
- Test: update `apps/dashboard/src/components/layout/__tests__/editorial-auth-shell.test.tsx`

- [ ] **Step 1: Update the existing test** — it currently asserts Home + Alex + Riley links (lines ~40-43). Rewrite to assert the shell renders `<PrimaryNav>` (Home·Inbox·Results) and NOT per-agent links.

```tsx
// in editorial-auth-shell.test.tsx — replace the nav assertions
expect(screen.getByRole("link", { name: /inbox/i })).toBeInTheDocument();
expect(screen.queryByRole("link", { name: /^alex$/i })).toBeNull();
expect(screen.queryByRole("link", { name: /^riley$/i })).toBeNull();
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Edit the shell** — in `editorial-auth-shell.tsx`, replace the `brand-nav` block (the hardcoded Home link + `enabledAgents.map` agent links + the `+` add-agent at ~lines 44-54) with `<PrimaryNav />`. Remove the now-unused `fetchEnabledAgentsServer()` call **only** if nothing else in the shell uses it (the Team Pulse ribbon in P1-A will fetch enabled agents itself; keep the helper exported). Remove the `me-chip` span or fold it into an avatar menu (avatar menu is fine to keep as a placeholder).
- [ ] **Step 4: Run shell test, expect PASS.** Run `pnpm --filter @switchboard/dashboard build`.
- [ ] **Step 5: Commit** — `git commit -am "feat(dashboard): shell uses primary nav, drops per-agent header links"`

### Task A5: Delete the cockpit Topbar (kill the double header)

**Files:**

- Delete: `apps/dashboard/src/components/cockpit/topbar.tsx`, `apps/dashboard/src/components/cockpit/__tests__/topbar.test.tsx`
- Modify: `apps/dashboard/src/components/cockpit/cockpit-page.tsx` (remove import + `<Topbar>` at ~line 172), `riley-cockpit-page.tsx` (remove import + `<Topbar>` at ~lines 147-153), drop now-unused `RILEY_TABS`/`ALEX_CONFIG.tabs`/`TopbarTab` imports

- [ ] **Step 1: Update cockpit-page tests** — `cockpit-page.test.tsx` / `riley-cockpit-page.test.tsx` may assert Topbar presence; remove those assertions. (They mock `@/components/layout/halt/halt-context`; leave that.)
- [ ] **Step 2: Run, expect FAIL** where tests still reference Topbar.
- [ ] **Step 3: Remove** the `import { Topbar }` and the `<Topbar ... />` JSX from both cockpit pages. Delete `topbar.tsx` and its test. Remove dangling `RILEY_TABS` (riley-config) and `tabs` (alex-config) + the `TopbarTab` type import in `riley-config.ts:2` if now unused (run typecheck to confirm).
- [ ] **Step 4: Run tests + `pnpm typecheck`, expect PASS** (one header now). Build the dashboard.
- [ ] **Step 5: Commit** — `git commit -am "fix(dashboard): remove cockpit Topbar — kills the double header"`

### Task A6: Lift HaltProvider + shell to (auth)/layout.tsx; create Inbox & Results routes

**Files:**

- Modify: `apps/dashboard/src/app/(auth)/layout.tsx` (wrap with `HaltProvider` + `RightDrawerProvider` + the shell), remove per-page `EditorialAuthShell` wrappers from `alex/page.tsx`, `riley/page.tsx`, and the `(mercury)/layout.tsx`
- Create: `apps/dashboard/src/app/(auth)/inbox/page.tsx`, `apps/dashboard/src/app/(auth)/results/page.tsx`
- Test: `apps/dashboard/src/app/(auth)/__tests__/inbox-route.test.ts`

- [ ] **Step 1: Failing test** — Inbox + Results routes exist.

```ts
// apps/dashboard/src/app/(auth)/__tests__/inbox-route.test.ts
import { describe, it, expect } from "vitest";
import InboxPage from "../inbox/page";
import ResultsPage from "../results/page";
describe("new primary routes", () => {
  it("inbox + results pages export components", () => {
    expect(typeof InboxPage).toBe("function");
    expect(typeof ResultsPage).toBe("function");
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Lift providers + shell.** Move `<HaltProvider>` and `<RightDrawerProvider>` (currently inside `editorial-auth-shell.tsx` lines ~33-34) up to wrap `AppShell` in `(auth)/layout.tsx`, so Home/Inbox/Results all get halt context. Mount the editorial shell chrome (header) once here. Strip the direct `EditorialAuthShell` wrappers from `alex/page.tsx` and `riley/page.tsx` (they now inherit the shell from the layout) and delete the `(auth)/(mercury)/layout.tsx` shell wrapper (its routes now inherit too). Keep `<EditorialKeys/>`, `<AmbientCream/>` mounted in the shared shell.
- [ ] **Step 4: Inbox basic list** — `inbox/page.tsx` renders decisions from the existing `useDecisionFeed(null)`:

```tsx
// apps/dashboard/src/app/(auth)/inbox/page.tsx
"use client";
import { useDecisionFeed } from "@/hooks/use-decision-feed";

export default function InboxPage() {
  const { data, isLoading } = useDecisionFeed(null);
  if (isLoading) return <div className="inbox-loading">Loading…</div>;
  const decisions = data?.decisions ?? [];
  if (decisions.length === 0) return <div className="inbox-empty">That’s everything.</div>;
  return (
    <ul className="inbox-list">
      {decisions.map((d) => (
        <li key={d.id} className="inbox-row">
          {d.humanSummary}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 5: Results route RENDERS reports** — `results/page.tsx` renders the existing reports surface component (find it under `(auth)/(mercury)/reports/` and re-export/compose it) so the URL stays `/results` and the nav active-state matches. **Do NOT redirect to `/reports`** — that would break the Results highlight. MV-Results polish is deferred.
- [ ] **Step 6: Run tests + build, expect PASS.**
- [ ] **Step 7: Commit** — `git commit -am "feat(dashboard): lift shell+HaltProvider to (auth) layout; add Inbox & Results routes"`

### Task A7: Fix front-door routing + middleware + app-shell route sets

**Files:**

- Modify: `apps/dashboard/src/middleware.ts`, `apps/dashboard/src/components/layout/app-shell.tsx`
- Test: `apps/dashboard/src/app/__tests__/login-redirect.test.ts` (verify still green), add middleware assertion

- [ ] **Step 1: Verify redirect** — `defaultCallback` already returns `/` for onboarded users (`redirect-logic.ts:14`), which is now the authed Home. Confirm `app/__tests__/login-redirect.test.ts:27` ("returns / when fully onboarded") still passes — no change needed. Confirm `onboarding/page.tsx` `router.push("/")` now lands on Home.
- [ ] **Step 2: Failing test** — middleware protects `/`, `/inbox`, `/results`.

```ts
// add to a middleware test (mirror existing middleware test setup)
it("gates / and /inbox for logged-out users", () => {
  // request "/" with no session cookie → redirect to /login
});
```

- [ ] **Step 3: Update middleware** — add `/`, `/inbox`, `/results` (and keep `/alex`,`/riley` until Phase 2 removes them) to `AUTH_PAGE_PREFIXES` + `config.matcher`. For `/` use exact-match logic (`pathname === "/"`) so it doesn't over-match.
- [ ] **Step 4: Update `app-shell.tsx` route sets** — add `/inbox`, `/results` to `SHELL_OWNED_PREFIXES`; keep `/` in `SHELL_OWNED_EXACT`. Remove `/` from `ONBOARDING_GATE_EXEMPT_EXACT` (an un-onboarded user on Home should be pushed to `/onboarding`).
- [ ] **Step 5: Run tests + build, expect PASS.**
- [ ] **Step 6: Commit** — `git commit -am "feat(dashboard): authed front door — / is Home, gate new routes"`

---

# PR P0-B — Tokens + visual system

**Scope rule:** P0-B introduces the canonical tokens and updates only the shell / Home / cockpit-identity references it touches. **Full inline-hex retirement across all cockpit components is Phase 2** — do not attempt it here, or this PR balloons.

### Task B1: Introduce the canonical token set + alias dead registers

**Files:**

- Modify: `apps/dashboard/src/app/globals.css`
- Test: `apps/dashboard/src/app/__tests__/tokens.test.ts`

- [ ] **Step 1: Failing test** — assert the canonical tokens are declared and `--mercury-*` aliases them (read globals.css as text).

```ts
// apps/dashboard/src/app/__tests__/tokens.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const css = readFileSync(join(__dirname, "../globals.css"), "utf8");

describe("canonical tokens", () => {
  it("declares one action color and three agent identity colors", () => {
    expect(css).toMatch(/--action:\s/);
    expect(css).toMatch(/--agent-alex:\s/);
    expect(css).toMatch(/--agent-riley:\s/);
    expect(css).toMatch(/--agent-mira:\s/);
  });
  it("aliases the dead mercury register to canonical vars", () => {
    expect(css).toMatch(/--mercury-cream:\s*var\(--canvas\)/);
    expect(css).toMatch(/--mercury-accent:\s*var\(/);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Add canonical tokens to `:root`** (after the operator block). `--action` reuses the existing operator amber HSL; agent colors are net-new identity hues:

```css
/* ─── Canonical: warm operational editorial ─── */
--canvas: 40 25% 94%; /* was --cream / --mercury-cream */
--action: 30 55% 46%; /* the ONE action amber (== --operator) */
--action-foreground: 0 0% 98%;
--action-hover: 30 55% 40%;
/* Per-agent IDENTITY ONLY — never on action buttons */
--agent-alex: 14 70% 58%; /* coral */
--agent-riley: 180 33% 40%; /* teal */
--agent-mira: 270 45% 58%; /* violet */
```

- [ ] **Step 4: Alias the dead `--mercury-*` register** to canonical vars (byte-identical today, per audit) so no consumer edits are needed:

```css
--mercury-cream: var(--canvas);
--mercury-ink: var(--ink);
--mercury-hairline: var(--hairline);
/* --mercury-accent stays the editorial red-orange unless reclassified; see Task B2 */
```

- [ ] **Step 5: Run test, expect PASS.** Build the dashboard.
- [ ] **Step 6: Commit** — `git commit -am "feat(dashboard): canonical warm-editorial tokens; alias mercury register"`

### Task B2: Tailwind `action` + `agent.*` color keys

**Files:**

- Modify: `apps/dashboard/tailwind.config.ts`
- Test: extend `tokens.test.ts`

- [ ] **Step 1: Failing test** — config exposes `action` and `agent.alex/riley/mira`.

```ts
// tokens.test.ts (add)
import config from "../../../tailwind.config";
it("tailwind exposes action + agent identity colors", () => {
  const colors = (config.theme?.extend?.colors ?? {}) as Record<string, unknown>;
  expect(colors.action).toBeTruthy();
  expect((colors.agent as Record<string, unknown>).alex).toBe("hsl(var(--agent-alex))");
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Add to `theme.extend.colors`** (keep `operator` as an alias of `action` during migration):

```ts
action: {
  DEFAULT: "hsl(var(--action))",
  foreground: "hsl(var(--action-foreground))",
  hover: "hsl(var(--action-hover))",
},
agent: {
  // keep existing active/idle/attention/locked, add identity:
  alex: "hsl(var(--agent-alex))",
  riley: "hsl(var(--agent-riley))",
  mira: "hsl(var(--agent-mira))",
},
```

- [ ] **Step 4: Run test, expect PASS.** Build the dashboard.
- [ ] **Step 5: Commit** — `git commit -am "feat(dashboard): tailwind action + agent identity color keys"`

### Task B3: Move agent identity colors off the action amber

**Files:**

- Modify: `apps/dashboard/src/lib/cockpit/alex-config.ts`, `apps/dashboard/src/lib/cockpit/riley/riley-config.ts`
- Test: `apps/dashboard/src/lib/cockpit/__tests__/agent-identity.test.ts`

- [ ] **Step 1: Failing test** — Alex's identity is NOT the action amber; Riley's is teal-family, not amber.

```ts
// apps/dashboard/src/lib/cockpit/__tests__/agent-identity.test.ts
import { describe, it, expect } from "vitest";
import { ALEX_CONFIG } from "../alex-config";
import { RILEY_ACCENT } from "../riley/riley-config";
describe("agent identity colors are not the action amber", () => {
  it("Alex identity moved off #B8782E", () => {
    expect(ALEX_CONFIG.accent.base.toUpperCase()).not.toBe("#B8782E");
  });
  it("Riley identity is distinct from Alex and amber", () => {
    expect(RILEY_ACCENT.base.toUpperCase()).not.toBe("#B8782E");
    expect(RILEY_ACCENT.base).not.toBe(ALEX_CONFIG.accent.base);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (Alex is currently `#B8782E`).
- [ ] **Step 3: Update the accents** — Alex → coral, Riley → teal (hexes corresponding to the `--agent-*` HSLs; e.g. Alex base `#E07A53`, Riley base `#3F8C86`). Update `base/deep/soft/paper` consistently. **Do NOT** change `T.amber` in `tokens.ts` (it stays the action color). Verify the cockpit `statusColor` logic (which uses `T.green/red/amber` for working/halted/waiting) still reads from `T`, not the agent accent.
- [ ] **Step 4: Run test + build, expect PASS.** Visually confirm cockpit avatar rings/labels show coral/teal, buttons stay amber.
- [ ] **Step 5: Commit** — `git commit -am "feat(dashboard): agent identity colors (Alex coral, Riley teal) off the action amber"`

---

# PR P0-C — Real server-backed halt

**Ship rule:** C1–C3 land **together** in PR P0-C. C2 changes the provider shape and breaks the existing halt tests; C3 repairs the consumers. **Never merge C2 without C3.**

### Task C1: Parse the resume readiness-400 body in useResume

**Files:**

- Modify: `apps/dashboard/src/hooks/use-governance.ts`
- Test: `apps/dashboard/src/hooks/__tests__/use-governance.test.tsx`

- [ ] **Step 1: Failing test** — a 400 with `{ resumed:false, readiness:{checks:[{label:"Meta Ads", ok:false}]} }` surfaces a readable error, not "Failed to resume".

```tsx
// apps/dashboard/src/hooks/__tests__/use-governance.test.tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1" }, status: "authenticated" }),
}));
import { useResume } from "../use-governance";

const wrap = () => {
  const c = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: c }, children);
};

it("surfaces readiness blockers on a 400 resume", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          resumed: false,
          readiness: { checks: [{ label: "Meta Ads", ok: false }] },
        }),
    }),
  );
  const { result } = renderHook(() => useResume(), { wrapper: wrap() });
  result.current.mutate();
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(String(result.current.error)).toMatch(/Meta Ads/);
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Edit `useResume`** — on non-2xx, read the body; if `data.readiness?.checks`, throw an Error listing the failed checks; else fall back to `data.error ?? "Failed to resume"`.
- [ ] **Step 4: Run test, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(dashboard): useResume surfaces readiness blockers"`

### Task C2: Wire HaltProvider to the server (optimistic + rollback + server-seeded)

**Files:**

- Modify: `apps/dashboard/src/components/layout/halt/halt-context.tsx`
- Test: rewrite `apps/dashboard/src/components/layout/halt/__tests__/halt-context.test.tsx`

- [ ] **Step 1: Rewrite the test** — provider now needs a QueryClient; `toggleHalt` fires the halt mutation; `halted` seeds from `useGovernanceStatus` (`deploymentStatus === "paused"`); failure rolls back. Mock `useEmergencyHalt`/`useResume`/`useGovernanceStatus`.

```tsx
// halt-context.test.tsx (new shape)
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
const haltMutate = vi.fn();
const resumeMutate = vi.fn();
const statusState = { data: { deploymentStatus: "active" as string } };
vi.mock("@/hooks/use-governance", () => ({
  useEmergencyHalt: () => ({
    mutate: haltMutate,
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
  useResume: () => ({
    mutate: resumeMutate,
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
  useGovernanceStatus: () => ({ data: statusState.data, isLoading: false }),
}));
import { HaltProvider, useHalt } from "../halt-context";

function Probe() {
  const { halted, toggleHalt } = useHalt();
  return <button onClick={toggleHalt}>{halted ? "HALTED" : "LIVE"}</button>;
}

it("seeds halted from server deploymentStatus", () => {
  statusState.data = { deploymentStatus: "paused" };
  render(
    <HaltProvider>
      <Probe />
    </HaltProvider>,
  );
  expect(screen.getByText("HALTED")).toBeInTheDocument();
});
it("toggling from live fires the halt mutation", () => {
  statusState.data = { deploymentStatus: "active" };
  render(
    <HaltProvider>
      <Probe />
    </HaltProvider>,
  );
  fireEvent.click(screen.getByText("LIVE"));
  expect(haltMutate).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Rewrite `halt-context.tsx`** — call `useGovernanceStatus`/`useEmergencyHalt`/`useResume`; derive initial `halted` from `data?.deploymentStatus === "paused"`; `setHalted(next)`/`toggleHalt()` optimistically set local state then `emergencyHalt.mutate("Operator pause")` (true) or `resume.mutate()` (false); `onError` rolls back; expose `{ halted, isPending, error, setHalted, toggleHalt }`. Keep the provider free of `useToast` (the comment constraint) — surface `error`/`isPending` for call sites. Downgrade `localStorage` to a pre-hydration hint only (server status wins once loaded), or remove it entirely.
- [ ] **Step 4: Run test, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "fix(dashboard): wire Pause to server-backed halt (real emergency-halt/resume)"`

### Task C3: Update consumers for the new context shape + QueryClient

**Files:**

- Modify: `apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx` + `riley-cockpit-page.test.tsx` (mocks), any test rendering `<HaltProvider>` without a QueryClient
- Test: existing suites

- [ ] **Step 1: Run the full dashboard suite** — `pnpm --filter @switchboard/dashboard test`. Expect failures: cockpit-page mocks of `useHalt` now miss `isPending`/`error`; tests rendering `HaltProvider` bare throw "No QueryClient set".
- [ ] **Step 2: Fix the cockpit mocks** — add `isPending: false, error: null` to the `vi.mock(".../halt-context", () => ({ useHalt: () => ({ ... }) }))` objects in both cockpit page tests.
- [ ] **Step 3: Wrap any bare `HaltProvider` test renders** in `QueryClientProvider`. (Production is fine — `QueryProvider` is mounted at `app/layout.tsx`.)
- [ ] **Step 4: Optional — surface resume errors** at a call site (e.g. the cockpit Identity Pause button reads `error` from `useHalt()` and fires a toast via `@/components/ui/use-toast`). Add a test for the toast-on-error if you wire it.
- [ ] **Step 5: Run full suite + build + typecheck, expect PASS.**
- [ ] **Step 6: Commit** — `git commit -am "test(dashboard): update halt consumers for server-backed context"`

---

# PR P1-A — Home module shell

> Each module is a focused presentational component fed by an existing hook. Render order (mobile, spec §6.1): Team Pulse → Needs You → This Week → While You Slept → Work in Progress → Permissions. Above the fold = greeting + Team Pulse + Needs You + top of This Week (spec §8.1).

**Resilience rule:** each module is fed by a view-model/adapter that tolerates missing/loading/error data and renders a graceful empty or skeleton state. **Home must never crash or block because one lower-priority module's hook failed** — modules degrade independently.

### Task D1: Team Pulse ribbon

**Files:**

- Create: `apps/dashboard/src/components/home/team-pulse.tsx`
- Test: `apps/dashboard/src/components/home/__tests__/team-pulse.test.tsx`

- [ ] **Step 1: Failing test** — renders enabled agents with status dots; a not-set-up agent shows "Not set up" (Mira honesty guardrail, spec §10).

```tsx
// team-pulse.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TeamPulse } from "../team-pulse";
it("renders agents and labels a not-set-up agent", () => {
  render(
    <TeamPulse
      agents={[
        { key: "alex", name: "Alex", status: "working", setUp: true },
        { key: "mira", name: "Mira", status: "idle", setUp: false },
      ]}
    />,
  );
  expect(screen.getByText("Alex")).toBeInTheDocument();
  expect(screen.getByText(/not set up/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** — thin ribbon; each agent = a status dot (`bg-agent-active`/`bg-agent-idle`) + name (colored `text-agent-{key}` when `setUp`, muted + "Not set up" when not). Pure component; props typed `{ agents: { key; name; status; setUp }[] }`. The Home page derives `agents` from the enabled-agents fetch + `useGovernanceStatus`. No agent links (no routes).
- [ ] **Step 4: Run test, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(dashboard): Home Team Pulse ribbon (Mira honesty guardrail)"`

### Task D2: Needs You (top-2 decisions + all-clear state)

**Files:**

- Create: `apps/dashboard/src/components/home/needs-you.tsx`
- Test: `apps/dashboard/src/components/home/__tests__/needs-you.test.tsx`

- [ ] **Step 1: Failing test** — shows ≤2 cards (spec §8.1); >2 shows "See all in Inbox"; zero shows the calm all-clear line.

```tsx
// needs-you.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NeedsYou } from "../needs-you";
const d = (id: string) => ({ id, humanSummary: `Decision ${id}`, agentKey: "riley" }) as never;
it("caps at two cards and links to Inbox when more", () => {
  render(<NeedsYou decisions={[d("1"), d("2"), d("3")]} />);
  expect(screen.getAllByTestId("decision-card")).toHaveLength(2);
  expect(screen.getByText(/see all in inbox/i)).toBeInTheDocument();
});
it("shows the calm all-clear when empty", () => {
  render(<NeedsYou decisions={[]} />);
  expect(screen.getByText(/nothing needs you/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** — props `{ decisions: Decision[] }`; render `decisions.slice(0, 2)` using the editorial `<DecisionCard>` (`@/components/decisions/decision-card` via `mapToDecisionCard`); "Why X recommends this" collapsed; actions Approve/Edit/Skip wired to `useRecommendationAction`/`useRespondToApproval` (a thin `onResolve` prop the Home page supplies). Empty → "Nothing needs you. Your team's running clean." Each card has `data-testid="decision-card"`.
- [ ] **Step 4: Run test, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(dashboard): Home Needs You (top-2 + all-clear)"`

### Task D3: This Week

**Files:** Create `apps/dashboard/src/components/home/this-week.tsx`; Test `__tests__/this-week.test.tsx`

- [ ] **Step 1: Failing test** — renders the headline number, the baseline comparison, and the agent-voice line; numbers are tappable into Results.

```tsx
it("renders headline revenue + baseline + drill link", () => {
  render(
    <ThisWeek
      vm={{
        revenue: 18400,
        baseline: 11200,
        consults: 24,
        spend: 1240,
        ret: 4.1,
        voice: "Alex booked 24 consults.",
      }}
    />,
  );
  expect(screen.getByText(/\$18,?400/)).toBeInTheDocument();
  expect(screen.getByText(/11,?200/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /\$18,?400|revenue/i })).toHaveAttribute(
    "href",
    "/results",
  );
});
```

- [ ] **Step 2-5:** Run fail → implement (props from `MetricsViewModelWire`/`useDashboardOverview`; current week only, NO period toggle — spec §5; serif voice paragraph is the one editorial moment; numbers wrapped in `<Link href="/results">`; **if metrics are unavailable, render skeleton/empty copy — NEVER fabricate revenue, consults, spend, return, or "saved X hrs"**) → run pass → commit `feat(dashboard): Home This Week module`. Add a test asserting the empty/skeleton state when `vm` is undefined.

### Task D4: While You Slept

**Files:** Create `apps/dashboard/src/components/home/while-you-slept.tsx`; Test `__tests__/while-you-slept.test.tsx`

- [ ] **Step 1: Failing test** — renders ≤3 factual log lines with timestamps + "View all"; empty → calm line. (Work Log guardrail: factual, never introspection — spec §5.)
- [ ] **Step 2-5:** Run fail → implement (props `{ rows: ActivityRow[] }` from `useAgentActivityCockpit`; show `time` + `head`; cap 3 + "View all" → `/activity`) → pass → commit `feat(dashboard): Home While You Slept module`.

### Task D5: Work in Progress (trace-honest)

**Files:** Create `apps/dashboard/src/components/home/work-in-progress.tsx`; Test `__tests__/work-in-progress.test.tsx`

- [ ] **Step 1: Failing test** — with a real handoff trace, renders the agent chain; without, renders the simple form; with nothing, "No active handoffs right now." (spec §7 guardrail).

```tsx
it("shows the chain only with a real trace, else the simple form", () => {
  const { rerender } = render(
    <WorkInProgress
      items={[
        {
          title: "Slow-slot recovery",
          chain: ["riley", "mira", "alex"],
          summary: "Offer drafted · 8 leads queued for Alex",
        },
      ]}
    />,
  );
  expect(screen.getByText(/riley/i)).toBeInTheDocument();
  rerender(
    <WorkInProgress
      items={[
        {
          title: "Slow-slot recovery",
          chain: null,
          summary: "Offer drafted · 8 leads queued for Alex",
        },
      ]}
    />,
  );
  expect(screen.getByText(/offer drafted/i)).toBeInTheDocument();
  expect(screen.queryByText(/→/)).toBeNull();
});
it("empty shows the calm line", () => {
  render(<WorkInProgress items={[]} />);
  expect(screen.getByText(/no active handoffs/i)).toBeInTheDocument();
});
```

- [ ] **Step 2-5:** Run fail → implement (`chain` renders only when non-null; outcome-phrased copy, never "Plays") → pass → commit `feat(dashboard): Home Work in Progress (trace-honest)`.

### Task D6: Permissions

**Files:** Create `apps/dashboard/src/components/home/permissions.tsx`; Test `__tests__/permissions.test.tsx`

- [ ] **Step 1: Failing test** — renders plain "what they do without you" lines + "Adjust →" to autonomy modes in settings.
- [ ] **Step 2-5:** Run fail → implement (props from `MissionAggregatorResponse.rules`/role; plain-language autonomy boundary per agent; "Adjust →" links to `/settings`) → pass → commit `feat(dashboard): Home Permissions module`.

### Task D7: Compose HomePage + wire hooks; mount in (auth)/page.tsx

**Files:** Create `apps/dashboard/src/components/home/home-page.tsx`; Modify `(auth)/page.tsx`; Test `__tests__/home-page.test.tsx`

- [ ] **Step 1: Failing test** — `<HomePage>` renders all six modules in order; above-the-fold order is Team Pulse → Needs You → This Week (assert DOM order).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `home-page.tsx`** — client component; calls `useDecisionFeed(null)` (Needs You), `useDashboardOverview()`/`useAgentMetrics` (This Week), `useAgentActivityCockpit` (While You Slept), `useAgentMission` (Permissions + Team Pulse), enabled-agents + `useGovernanceStatus` (Team Pulse). **Each module receives an already-resolved view-model and renders its own empty/skeleton state; Home renders immediately and does NOT block on all hooks resolving — a failed lower-priority hook degrades only its own module.** Compose modules in spec §6.1 order. Mobile-first CSS in `home.module.css`. Replace `(auth)/page.tsx` body with `<HomePage/>`.
- [ ] **Step 4: Run test + build + typecheck, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(dashboard): compose Home from existing data hooks"`

---

# PR P1-B — Risk contract + Needs You wiring

### Task E1: Add the risk-contract fields to the recommendation schema

**Files:**

- Modify: `packages/schemas/src/recommendations.ts`
- Test: `packages/schemas/src/__tests__/recommendations.test.ts` (or co-located)

- [ ] **Step 1: Failing test** — `RecommendationInputSchema` accepts and defaults the four new fields.

```ts
import { describe, it, expect } from "vitest";
import { RecommendationInputSchema } from "../recommendations";
it("carries the risk contract booleans", () => {
  const parsed = RecommendationInputSchema.parse({
    /* ...existing required fields..., */ riskLevel: "low",
    externalEffect: false,
    financialEffect: true,
    clientFacing: false,
    requiresConfirmation: true,
  });
  expect(parsed.financialEffect).toBe(true);
  expect(parsed.requiresConfirmation).toBe(true);
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Add fields** near `riskLevel` (line ~52): `externalEffect: z.boolean().default(false)`, `financialEffect: z.boolean().default(false)`, `clientFacing: z.boolean().default(false)`, `requiresConfirmation: z.boolean().default(false)`. (These defaults apply only to explicitly-created recommendations; the UI treats a **missing** contract as unsafe — Task E4 — so legacy decisions can't be swipe-approved regardless.)
- [ ] **Step 4: Run `pnpm --filter @switchboard/schemas test` + `pnpm reset` if exports go stale, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(schemas): add risk-contract fields to recommendation input"`

### Task E2: Add the risk contract to the core Decision type + adapters

**Files:**

- Modify: `packages/core/src/decisions/types.ts`, `packages/core/src/decisions/adapters/recommendation-adapter.ts`, `packages/core/src/decisions/adapters/handoff-adapter.ts`
- Test: `packages/core/src/decisions/adapters/__tests__/recommendation-adapter.test.ts`

- [ ] **Step 1: Failing test** — `adaptRecommendation` threads the four booleans into `Decision.meta.riskContract`; `adaptHandoff` defaults `clientFacing:true, financialEffect:false`.

```ts
it("adaptRecommendation carries the risk contract", () => {
  const decision = adaptRecommendation({
    /* row with */ riskLevel: "high",
    externalEffect: true,
    financialEffect: true,
    clientFacing: false,
    requiresConfirmation: true /* ... */,
  });
  expect(decision.meta.riskContract).toEqual({
    riskLevel: "high",
    externalEffect: true,
    financialEffect: true,
    clientFacing: false,
    requiresConfirmation: true,
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** — add `riskContract?: { riskLevel; externalEffect; financialEffect; clientFacing; requiresConfirmation }` to `Decision["meta"]` in `types.ts`. In `recommendation-adapter.ts` (where `meta.riskLevel` is set, ~line 30) build `meta.riskContract` from the row. In `handoff-adapter.ts` set a derived default contract (handoffs: `clientFacing:true, financialEffect:false, externalEffect:false, riskLevel:"medium", requiresConfirmation:false`).
- [ ] **Step 4: Run `pnpm --filter @switchboard/core test`, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(core): thread risk contract through decision adapters"`

### Task E3: Mirror the contract in the dashboard Decision type

**Files:** Modify `apps/dashboard/src/lib/decisions/types.ts`; Test: typecheck

- [ ] **Step 1:** Add the same `meta.riskContract` shape to the dashboard wire mirror of `Decision`.
- [ ] **Step 2:** Run `pnpm typecheck` (and `pnpm reset` if `@switchboard/core` exports look stale). Build the dashboard.
- [ ] **Step 3: Commit** — `git commit -am "feat(dashboard): mirror decision risk contract type"`

### Task E4: The swipe-gating predicate (pure helper)

**Files:**

- Create: `apps/dashboard/src/lib/decisions/swipe-policy.ts`
- Test: `apps/dashboard/src/lib/decisions/__tests__/swipe-policy.test.ts`

- [ ] **Step 1: Failing test** — swipe-to-approve only when low + no external/financial/client-facing; everything else requires a tap; `requiresConfirmation` adds a confirm.

```ts
import { describe, it, expect } from "vitest";
import { canSwipeApprove, needsConfirm } from "../swipe-policy";
const base = {
  riskLevel: "low",
  externalEffect: false,
  financialEffect: false,
  clientFacing: false,
  requiresConfirmation: false,
} as const;
describe("swipe policy", () => {
  it("allows swipe-approve only for pure low-risk", () => {
    expect(canSwipeApprove(base)).toBe(true);
    expect(canSwipeApprove({ ...base, financialEffect: true })).toBe(false);
    expect(canSwipeApprove({ ...base, clientFacing: true })).toBe(false);
    expect(canSwipeApprove({ ...base, riskLevel: "medium" })).toBe(false);
  });
  it("requiresConfirmation forces a confirm step", () => {
    expect(needsConfirm({ ...base, requiresConfirmation: true })).toBe(true);
  });
  it("treats a MISSING contract as unsafe (legacy decisions)", () => {
    expect(canSwipeApprove(undefined)).toBe(false);
    expect(needsConfirm(undefined)).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** — param typed `c?: RiskContract` (optional). **A missing contract is unsafe:** `canSwipeApprove(c) = !!c && c.riskLevel === "low" && !c.externalEffect && !c.financialEffect && !c.clientFacing`; `needsConfirm(c) = !c || c.requiresConfirmation || c.riskLevel === "high"`.
- [ ] **Step 4: Run test, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(dashboard): swipe-gating risk policy helper"`

### Task E5: Apply the policy in Needs You + Inbox actions

**Files:** Modify `apps/dashboard/src/components/home/needs-you.tsx` (+ the Inbox basic list); Test: extend `needs-you.test.tsx`

- [ ] **Step 1: Failing test** — a decision with `financialEffect:true` does NOT enable swipe-approve (only a button tap); a pure low-risk one does.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** — read `decision.meta.riskContract`; pass `canSwipeApprove(...)` to the card so swipe-approve is enabled only when true; when `needsConfirm(...)`, the Approve button opens a confirm step before committing. Swipe-to-Skip is always allowed.
- [ ] **Step 4: Run test + build + typecheck, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(dashboard): gate swipe-approve by decision risk contract"`

---

## Self-Review (completed)

- **Spec coverage:** §4 IA (A1–A7), §5 vocab/Work-Log (D4/D5 copy rules), §6 surfaces (A6 Inbox, D1–D7 Home), §8 rules (D2 max-2, E4/E5 swipe tiers, C2 real pause), §9 visual (B1–B3), §11 structural fixes (A4/A5 single shell, A7 front door, C2 halt), §12 phasing (this plan = Phase 0+1 sliced). Phase 2 (rich Inbox, agent panels), Phase 3 (push-to-approve), Phase 4 (signup/first-run) are deliberately out — separate plans.
- **Placeholder scan:** test/impl code present per step; UI-module tasks (D3/D4/D6) reference earlier full-fidelity patterns (D1/D2/D5) and the spec wireframes rather than repeating boilerplate — acceptable since they share one component shape.
- **Type consistency:** `riskContract` shape identical across schema (E1) → core type/adapter (E2) → dashboard mirror (E3) → swipe-policy (E4) → consumer (E5). `useDecisionFeed(null)`/`Decision` names match the grounded codebase.

**Risks to watch during execution:** (1) the `/` route-group move (A1) must land before A2 or the build throws a parallel-route error; (2) C2 breaks the 6 existing halt-context tests and the cockpit mocks — C3 must accompany it in the same PR; (3) `pnpm reset` after E1–E3 if schema/core exports look stale.
