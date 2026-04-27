# Navigation Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove dead navigation surface area (staff view, duplicate routes, stale links), fix inconsistencies, and ensure only live owner-first surfaces remain.

**Architecture:** Surgical removal pass — delete staff-only components, shell branches, and preference logic; fix DevPanel and footer; update dashboard page and Me page to remove staff view branching. No new features or IA changes.

**Tech Stack:** Next.js 14, React, TypeScript, Vitest, Tailwind CSS

---

### Task 1: Remove staff-nav, staff-mobile-menu, staff-shell, and their test

**Files:**

- Delete: `apps/dashboard/src/components/layout/staff-nav.tsx`
- Delete: `apps/dashboard/src/components/layout/staff-mobile-menu.tsx`
- Delete: `apps/dashboard/src/components/layout/staff-shell.tsx`
- Delete: `apps/dashboard/src/components/layout/__tests__/staff-nav.test.tsx`

- [ ] **Step 1: Verify no other files import these components**

Run:

```bash
grep -r "staff-nav\|staff-mobile-menu\|staff-shell\|StaffNav\|StaffMobileMenu\|StaffShell" apps/dashboard/src --include="*.ts" --include="*.tsx" -l
```

Expected files (only these should appear):

- `staff-nav.tsx` (itself)
- `staff-mobile-menu.tsx` (itself)
- `staff-shell.tsx` (itself + imports StaffNav and StaffMobileMenu)
- `__tests__/staff-nav.test.tsx` (test)
- `app-shell.tsx` (imports StaffShell — handled in Task 3)

If any unexpected files appear, investigate before proceeding.

- [ ] **Step 2: Delete the four files**

```bash
rm apps/dashboard/src/components/layout/staff-nav.tsx
rm apps/dashboard/src/components/layout/staff-mobile-menu.tsx
rm apps/dashboard/src/components/layout/staff-shell.tsx
rm apps/dashboard/src/components/layout/__tests__/staff-nav.test.tsx
```

- [ ] **Step 3: Run typecheck to confirm no broken imports remain**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: errors in `app-shell.tsx` (imports StaffShell) — this is fixed in Task 3. No other errors should appear.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: delete staff-nav, staff-mobile-menu, staff-shell components and test"
```

---

### Task 2: Remove staff-dashboard.tsx

**Files:**

- Delete: `apps/dashboard/src/components/dashboard/staff-dashboard.tsx`
- Modify: `apps/dashboard/src/app/(auth)/dashboard/page.tsx`

- [ ] **Step 1: Verify staff-dashboard is only imported in dashboard/page.tsx**

```bash
grep -r "staff-dashboard\|StaffDashboard" apps/dashboard/src --include="*.ts" --include="*.tsx" -l
```

Expected: only `staff-dashboard.tsx` (itself) and `dashboard/page.tsx`.

- [ ] **Step 2: Update dashboard/page.tsx to always render OwnerToday**

Replace the entire contents of `apps/dashboard/src/app/(auth)/dashboard/page.tsx` with:

```tsx
"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { OwnerToday } from "@/components/dashboard/owner-today";

export default function HomePage() {
  const { status } = useSession();

  if (status === "unauthenticated") redirect("/login");

  return <OwnerToday />;
}
```

This removes:

- `useViewPreference` import
- `StaffDashboard` import
- The `isOwner` conditional branch

- [ ] **Step 3: Delete staff-dashboard.tsx**

```bash
rm apps/dashboard/src/components/dashboard/staff-dashboard.tsx
```

- [ ] **Step 4: Run typecheck**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: errors only from `app-shell.tsx` (Task 3).

- [ ] **Step 5: Commit**

```bash
git commit -m "chore: remove StaffDashboard, dashboard always renders OwnerToday"
```

---

### Task 3: Simplify AppShell — remove staff branch and view preference

**Files:**

- Modify: `apps/dashboard/src/components/layout/app-shell.tsx`

- [ ] **Step 1: Write the test**

Create `apps/dashboard/src/components/layout/__tests__/app-shell.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AppShell } from "../app-shell.js";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("@/hooks/use-org-config", () => ({
  useOrgConfig: () => ({ data: { config: { onboardingComplete: true } }, isLoading: false }),
}));

vi.mock("@/components/layout/owner-shell", () => ({
  OwnerShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="owner-shell">{children}</div>
  ),
}));

vi.mock("@/components/dev/dev-panel", () => ({
  DevPanel: () => <div data-testid="dev-panel" />,
}));

describe("AppShell", () => {
  it("always renders OwnerShell for authenticated routes", () => {
    render(
      <AppShell>
        <span>content</span>
      </AppShell>,
    );
    expect(screen.getByTestId("owner-shell")).toBeDefined();
    expect(screen.getByText("content")).toBeDefined();
  });

  it("does not render StaffShell", () => {
    render(
      <AppShell>
        <span>content</span>
      </AppShell>,
    );
    expect(screen.queryByTestId("staff-shell")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @switchboard/dashboard test -- --run src/components/layout/__tests__/app-shell.test.tsx
```

Expected: FAIL (AppShell still imports StaffShell which was deleted in Task 1).

- [ ] **Step 3: Update app-shell.tsx**

Replace the entire contents of `apps/dashboard/src/components/layout/app-shell.tsx` with:

```tsx
"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { DevPanel } from "../dev/dev-panel";
import { useOrgConfig } from "@/hooks/use-org-config";
import { OwnerShell } from "@/components/layout/owner-shell";

const CHROME_HIDDEN_PATHS = ["/login", "/onboarding", "/setup"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const hideChrome = CHROME_HIDDEN_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );

  const { data: orgData, isLoading: orgLoading } = useOrgConfig(!hideChrome);

  const onboardingComplete = orgData?.config?.onboardingComplete ?? true;
  const isSetupPath = pathname === "/setup" || pathname.startsWith("/setup/");
  const isLoginPath = pathname === "/login";

  useEffect(() => {
    if (!orgLoading && !onboardingComplete && !isSetupPath && !isLoginPath) {
      router.replace("/onboarding");
    }
  }, [orgLoading, onboardingComplete, isSetupPath, isLoginPath, router]);

  if (hideChrome) {
    return (
      <main className="min-h-screen bg-background">
        {children}
        <DevPanel />
      </main>
    );
  }

  return (
    <>
      <OwnerShell>{children}</OwnerShell>
      <DevPanel />
    </>
  );
}
```

Changes:

- Removed `useViewPreference` import
- Removed `StaffShell` import
- Removed `view` destructure and conditional `Shell` assignment
- Always renders `OwnerShell` directly

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @switchboard/dashboard test -- --run src/components/layout/__tests__/app-shell.test.tsx
```

Expected: PASS

- [ ] **Step 5: Run typecheck**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: PASS (all StaffShell references now removed).

- [ ] **Step 6: Commit**

```bash
git commit -m "chore: AppShell always renders owner composition, remove staff branch"
```

---

### Task 4: Remove view preference hook and clean up Me page

**Files:**

- Delete: `apps/dashboard/src/hooks/use-view-preference.ts`
- Delete: `apps/dashboard/src/hooks/__tests__/use-view-preference.test.ts`
- Modify: `apps/dashboard/src/app/(auth)/me/page.tsx`

- [ ] **Step 1: Verify remaining consumers of useViewPreference**

```bash
grep -r "use-view-preference\|useViewPreference" apps/dashboard/src --include="*.ts" --include="*.tsx" -l
```

After Tasks 1–3, expected remaining consumers:

- `hooks/use-view-preference.ts` (itself)
- `hooks/__tests__/use-view-preference.test.ts` (its test)
- `app/(auth)/me/page.tsx` (uses `setView("staff")`)
- `components/layout/settings-layout.tsx` (uses `setView("owner")` — handled in Task 5)

- [ ] **Step 2: Update Me page to remove staff view toggle**

Replace the entire contents of `apps/dashboard/src/app/(auth)/me/page.tsx` with:

```tsx
"use client";

import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { useAgentRoster } from "@/hooks/use-agents";
import { Skeleton } from "@/components/ui/skeleton";
import { AGENT_ICONS } from "@/components/team/agent-icons";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/use-theme";
import { STATUS_DOT, STATUS_LABEL } from "@/lib/agent-status";

export default function MePage() {
  const { status } = useSession();
  const { data: rosterData, isLoading } = useAgentRoster();
  const { theme, setTheme } = useTheme();

  if (status === "unauthenticated") redirect("/login");

  if (status === "loading" || isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-40" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  const roster = rosterData?.roster ?? [];
  const primaryOperator = roster.find((a) => a.agentRole === "primary_operator");
  const specialists = roster.filter(
    (a) => a.agentRole !== "primary_operator" && a.status !== "locked",
  );

  return (
    <div className="space-y-8">
      <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Me</h1>

      {primaryOperator && (
        <section className="rounded-xl border border-border/60 bg-surface p-5 space-y-3">
          <h2 className="section-label">Your assistant</h2>
          <p className="text-[17px] font-semibold text-foreground">{primaryOperator.displayName}</p>
          <p className="text-[13px] text-muted-foreground">Primary operator</p>
        </section>
      )}

      {specialists.length > 0 && (
        <section>
          <h2 className="section-label mb-3">Team status</h2>
          <div className="space-y-2">
            {specialists.map((agent) => {
              const Icon = AGENT_ICONS[agent.agentRole] ?? AGENT_ICONS.primary_operator;
              const activityStatus = (agent.agentState?.activityStatus as string) ?? "idle";
              const dot = STATUS_DOT[activityStatus] ?? STATUS_DOT.idle;
              const label = STATUS_LABEL[activityStatus] ?? "Ready";

              return (
                <div
                  key={agent.id}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg bg-surface border border-border/40"
                >
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-[13.5px] text-foreground flex-1">{agent.displayName}</span>
                  <div className="flex items-center gap-1.5">
                    <div className={cn("h-[6px] w-[6px] rounded-full", dot)} />
                    <span className="text-[11px] text-muted-foreground">{label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="w-full text-left px-4 py-3.5 rounded-lg text-[15px] text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
        >
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>

        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-full text-left px-4 py-3.5 rounded-lg text-[15px] text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
        >
          Sign out
        </button>
      </section>

      <section>
        <h2 className="section-label mb-3">Settings</h2>
        <div className="space-y-2">
          {[
            { href: "/settings/channels", label: "Channels" },
            { href: "/settings/knowledge", label: "Knowledge" },
            { href: "/settings/identity", label: "Identity" },
            { href: "/settings/team", label: "Team" },
            { href: "/settings/account", label: "Account" },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block px-4 py-3.5 rounded-lg text-[15px] text-foreground hover:bg-surface border border-border/40 transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
```

Changes:

- Removed `useViewPreference` import
- Removed `setView` destructure
- Removed "Staff view →" button from quick actions section

- [ ] **Step 3: Run typecheck to confirm Me page compiles**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: errors only from `settings-layout.tsx` (still imports `useViewPreference` — handled in Task 5).

- [ ] **Step 4: Commit (do NOT delete hook yet — settings-layout still imports it)**

```bash
git commit -m "chore: remove staff view toggle from Me page"
```

---

### Task 5: Remove view toggle from settings-layout, then delete the hook

**Files:**

- Modify: `apps/dashboard/src/components/layout/settings-layout.tsx`
- Delete: `apps/dashboard/src/hooks/use-view-preference.ts`
- Delete: `apps/dashboard/src/hooks/__tests__/use-view-preference.test.ts`

- [ ] **Step 1: Update settings-layout.tsx**

Replace the entire contents of `apps/dashboard/src/components/layout/settings-layout.tsx` with:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Users, BookOpen, Radio, Palette, MessagesSquare, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";

const SIDEBAR_ITEMS = [
  { href: "/settings/playbook", label: "Your Playbook", icon: BookOpen },
  { href: "/settings/team", label: "Team", icon: Users },
  { href: "/settings/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/settings/channels", label: "Channels", icon: Radio },
  { href: "/settings/identity", label: "Identity", icon: Palette },
  { href: "/settings/test-chat", label: "Test Chat", icon: MessagesSquare },
  { href: "/settings/account", label: "Account", icon: Building2 },
] as const;

export function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="flex gap-10 min-h-[calc(100vh-120px)]">
      <aside className="hidden md:block w-[200px] shrink-0">
        <h2 className="text-[22px] font-semibold tracking-tight text-foreground mb-6">Settings</h2>
        <nav className="space-y-0.5">
          {SIDEBAR_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13.5px] transition-colors duration-fast",
                  active
                    ? "text-foreground font-medium bg-surface"
                    : "text-muted-foreground hover:text-foreground hover:bg-surface/50",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex-1 min-w-0">
        <div className="md:hidden">
          {pathname === "/settings" ? (
            <div className="space-y-1">
              <h2 className="text-[22px] font-semibold tracking-tight text-foreground mb-6">
                Settings
              </h2>
              {SIDEBAR_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex items-center gap-3 px-4 py-3.5 rounded-lg text-[15px] text-foreground hover:bg-surface transition-colors"
                  >
                    <Icon className="h-5 w-5 text-muted-foreground" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ) : (
            <div>
              <Link
                href="/settings"
                className="text-[13px] text-muted-foreground hover:text-foreground transition-colors mb-4 inline-block"
              >
                ← Settings
              </Link>
              {children}
            </div>
          )}
        </div>

        <div className="hidden md:block">{children}</div>
      </div>
    </div>
  );
}
```

Changes:

- Removed `useViewPreference` import
- Removed `setView` destructure
- Removed the entire `<div className="mt-8 pt-4 ...">` block containing "Switch to Owner view"

- [ ] **Step 2: Delete the view preference hook and its test**

```bash
rm apps/dashboard/src/hooks/use-view-preference.ts
rm apps/dashboard/src/hooks/__tests__/use-view-preference.test.ts
```

- [ ] **Step 3: Verify no remaining references**

```bash
grep -r "use-view-preference\|useViewPreference\|ViewPreference\|switchboard\.view-preference" apps/dashboard/src --include="*.ts" --include="*.tsx" -l
```

Expected: no results.

- [ ] **Step 4: Run typecheck**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "chore: remove view preference hook and staff toggle from settings"
```

---

### Task 6: Fix DevPanel — remove dead links, fix Home

**Files:**

- Modify: `apps/dashboard/src/components/dev/dev-panel.tsx`

- [ ] **Step 1: Update dev-panel.tsx**

In `apps/dashboard/src/components/dev/dev-panel.tsx`, replace the `NAV_LINKS` array (lines 9–18):

Old:

```tsx
const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/settings/team", label: "AI Team" },
  { href: "/crm", label: "CRM" },
  { href: "/decide", label: "Decide" },
  { href: "/performance", label: "Performance" },
  { href: "/settings", label: "Settings" },
  { href: "/onboarding", label: "Onboarding" },
  { href: "/login", label: "Login" },
];
```

New:

```tsx
const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/settings/team", label: "AI Team" },
  { href: "/decide", label: "Decide" },
  { href: "/settings", label: "Settings" },
  { href: "/onboarding", label: "Onboarding" },
  { href: "/login", label: "Login" },
];
```

Changes:

- `/` "Home" → `/dashboard` "Dashboard"
- Removed `/crm`
- Removed `/performance`

- [ ] **Step 2: Run typecheck**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git commit -m "fix: DevPanel links — remove dead routes, fix Home to /dashboard"
```

---

### Task 7: Clean up footer — remove stale links

**Files:**

- Modify: `apps/dashboard/src/components/landing/landing-footer.tsx`
- Modify: `apps/dashboard/src/components/landing/__tests__/landing-footer.test.tsx`

- [ ] **Step 1: Update the test to match the new footer**

Replace the entire contents of `apps/dashboard/src/components/landing/__tests__/landing-footer.test.tsx` with:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LandingFooter } from "../landing-footer";

describe("LandingFooter", () => {
  it("renders wordmark and product links", () => {
    render(<LandingFooter />);
    expect(screen.getByText("Switchboard")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /how it works/i })).toHaveAttribute(
      "href",
      "/how-it-works",
    );
    expect(screen.getByRole("link", { name: /pricing/i })).toHaveAttribute("href", "/pricing");
  });

  it("renders contact link", () => {
    render(<LandingFooter />);
    expect(screen.getByRole("link", { name: /contact us/i })).toHaveAttribute(
      "href",
      "mailto:hello@switchboard.ai",
    );
  });

  it("does not render removed links", () => {
    render(<LandingFooter />);
    expect(screen.queryByText(/build an agent/i)).toBeNull();
    expect(screen.queryByText(/get started/i)).toBeNull();
  });

  it("renders copyright", () => {
    render(<LandingFooter />);
    expect(screen.getByText(/© \d{4} Switchboard/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/dashboard test -- --run src/components/landing/__tests__/landing-footer.test.tsx
```

Expected: FAIL — "Build an agent" and "Get started" still in the footer.

- [ ] **Step 3: Update landing-footer.tsx**

Replace the entire contents of `apps/dashboard/src/components/landing/landing-footer.tsx` with:

```tsx
import Link from "next/link";

export function LandingFooter() {
  return (
    <footer style={{ background: "#EDEAE5", borderTop: "1px solid #DDD9D3" }}>
      <div className="page-width" style={{ paddingTop: "3rem", paddingBottom: "3rem" }}>
        <div
          style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "2rem" }}
          className="sm:grid-cols-3"
        >
          {/* Brand */}
          <div>
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: "1.125rem",
                letterSpacing: "-0.015em",
                color: "#1A1714",
              }}
            >
              Switchboard
            </span>
            <p
              style={{
                marginTop: "0.5rem",
                fontSize: "0.8125rem",
                color: "#9C958F",
                lineHeight: 1.5,
              }}
            >
              AI agents that earn your trust over time.
            </p>
          </div>

          {/* Product */}
          <div>
            <p
              style={{
                marginBottom: "0.75rem",
                fontSize: "0.6875rem",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: "#9C958F",
              }}
            >
              Product
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {[
                { href: "/how-it-works", label: "How it works" },
                { href: "/pricing", label: "Pricing" },
              ].map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: "0.875rem",
                    color: "#6B6560",
                    textDecoration: "none",
                  }}
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>

          {/* Company */}
          <div>
            <p
              style={{
                marginBottom: "0.75rem",
                fontSize: "0.6875rem",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: "#9C958F",
              }}
            >
              Company
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <a
                href="mailto:hello@switchboard.ai"
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "0.875rem",
                  color: "#6B6560",
                  textDecoration: "none",
                }}
              >
                Contact us
              </a>
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: "2.5rem",
            paddingTop: "2rem",
            borderTop: "1px solid #DDD9D3",
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
          }}
          className="sm:flex-row sm:items-center sm:justify-between"
        >
          <span style={{ fontSize: "0.75rem", color: "#9C958F" }}>
            &copy; {new Date().getFullYear()} Switchboard. All rights reserved.
          </span>
          <span style={{ fontSize: "0.75rem", color: "#9C958F" }}>
            AI agents that earn autonomy through trust.
          </span>
        </div>
      </div>
    </footer>
  );
}
```

Changes:

- Removed "Get started" from Product column
- Removed "Build an agent" from Company column
- Kept "Contact us" in Company column
- Adjusted grid from `sm:grid-cols-4` to `sm:grid-cols-3` (brand no longer spans 2 cols)

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/dashboard test -- --run src/components/landing/__tests__/landing-footer.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "chore: remove stale footer links (Build an agent, Get started)"
```

---

### Task 8: Delete legacy /agent/[slug] route and fix storefront URL

**Files:**

- Delete: `apps/dashboard/src/app/(public)/agent/` (entire directory)
- Modify: `apps/dashboard/src/app/(auth)/my-agent/[id]/my-agent-client.tsx`

- [ ] **Step 1: Check what's in the /agent/[slug] directory**

```bash
ls -la apps/dashboard/src/app/\(public\)/agent/
```

Note: The glob search earlier returned no files, so this directory may not exist or may be empty. If it doesn't exist, skip the delete step and proceed to fixing the storefront URL.

- [ ] **Step 2: Delete /agent/ directory if it exists**

```bash
rm -rf apps/dashboard/src/app/\(public\)/agent/
```

- [ ] **Step 3: Fix storefront URL in my-agent-client.tsx**

In `apps/dashboard/src/app/(auth)/my-agent/[id]/my-agent-client.tsx`, find line 50:

Old:

```tsx
const storefrontUrl = `/agent/${slug}`;
```

New:

```tsx
const storefrontUrl = `/agents/${slug}`;
```

- [ ] **Step 4: Check api-client.ts for any /agent/ singular references**

```bash
grep -n "/agent/" apps/dashboard/src/lib/api-client.ts
```

If any references to `/agent/` (singular, not `/agents/`) exist in type definitions or URL builders, update them to `/agents/`.

- [ ] **Step 5: Run typecheck**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git commit -m "chore: remove legacy /agent/[slug] route, fix storefront URL to /agents/"
```

---

### Task 9: Clean up localStorage residue and verify no staff references remain

**Files:**

- No file changes — verification and cleanup sweep

- [ ] **Step 1: Search for any remaining staff-view references**

```bash
grep -rn "staff\|Staff" apps/dashboard/src --include="*.ts" --include="*.tsx" | grep -v "node_modules" | grep -v ".test." | grep -vi "staffing\|staffed"
```

Review results. Expected legitimate hits:

- `auth-provider.tsx` line 14: `role: "staff"` in dev session mock — this is auth role data, not navigation. Leave it.

Any navigation-related `staff` references should be investigated and removed.

- [ ] **Step 2: Search for dead preference key references**

```bash
grep -rn "switchboard\.view-preference\|view-preference" apps/dashboard/src --include="*.ts" --include="*.tsx"
```

Expected: no results (hook was deleted in Task 5).

- [ ] **Step 3: Search for dead route references**

```bash
grep -rn '"/crm"\|"/performance"\|"/agent/"' apps/dashboard/src --include="*.ts" --include="*.tsx"
```

Expected: no results (all cleaned in Tasks 6 and 8). If `api-client.ts` has a `storefrontUrl` type with `/agent/`, that was caught in Task 8 Step 4.

- [ ] **Step 4: Run full test suite**

```bash
pnpm --filter @switchboard/dashboard test -- --run
```

Expected: all tests PASS. If any tests reference staff view components or hooks that no longer exist, they would have been caught in earlier tasks.

- [ ] **Step 5: Run full typecheck**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: PASS

- [ ] **Step 6: Commit (if any cleanup was needed)**

```bash
git commit -m "chore: sweep for remaining staff-view and dead route residue"
```

---

### Task 10: Final verification

- [ ] **Step 1: Run full project build**

```bash
pnpm build
```

Expected: PASS

- [ ] **Step 2: Run full lint**

```bash
pnpm lint
```

Expected: PASS (no unused imports or dead references).

- [ ] **Step 3: Run full test suite across all packages**

```bash
pnpm test
```

Expected: PASS

- [ ] **Step 4: Start dev server and verify manually**

```bash
cd apps/dashboard && pnpm dev
```

Verify in browser:

- `/dashboard` loads OwnerToday (no staff dashboard, no view toggle)
- Bottom tabs work: Today, Hire, Decide, Me
- `/me` page has no "Staff view" button
- `/settings` sidebar has no "Switch to Owner view" button
- Footer shows only: How it works, Pricing, Contact us
- DevPanel (if DEV_BYPASS enabled) shows corrected links
- `/agents` and `/agents/[slug]` still work from public site

- [ ] **Step 5: Commit any final fixes if needed, then done**
