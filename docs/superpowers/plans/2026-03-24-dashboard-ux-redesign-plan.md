# Dashboard UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the dashboard into role-based Owner (mobile-first, 4 tabs) and Staff (desktop-first, 5 nav + settings) views, consolidate CRM, add dark mode.

**Architecture:** Two shell components (`OwnerShell`, `StaffShell`) replace the single `Shell`. View resolution from session role + localStorage override. CRM merges 4 existing pages into a tabbed master-detail. Settings sidebar absorbs 6 config pages. Dark mode via CSS variable swap.

**Tech Stack:** Next.js 15, Tailwind CSS, Radix UI, React Query, next-auth, lucide-react

**Spec:** `docs/superpowers/specs/2026-03-24-dashboard-ux-redesign-design.md`

---

## File Map

### New Files

```
src/hooks/use-view-preference.ts          — View switching hook (owner/staff toggle + localStorage)
src/components/layout/owner-shell.tsx     — Owner shell: bottom tabs + content
src/components/layout/owner-tabs.tsx      — 4-item bottom tab bar
src/components/layout/staff-shell.tsx     — Staff shell: top bar + content
src/components/layout/staff-nav.tsx       — 5-item top bar + gear icon
src/components/layout/staff-mobile-menu.tsx — Hamburger drawer for staff on mobile
src/components/layout/settings-layout.tsx — Settings sidebar + content
src/app/crm/page.tsx                      — CRM page (tabbed master-detail)
src/app/crm/[contactId]/page.tsx          — Contact detail page
src/components/crm/contact-list.tsx       — Contact list component (shared between tabs)
src/components/crm/contact-detail.tsx     — Contact detail panel (info + conversation + timeline)
src/components/crm/crm-tabs.tsx           — Tab bar for CRM (Leads, Chats, Escalations, Inbox)
src/app/performance/page.tsx              — Performance page (tabbed: Results | Growth)
src/app/decide/page.tsx                   — Decide page (renamed approvals)
src/app/decide/[id]/page.tsx              — Decide detail page
src/app/me/page.tsx                       — Owner Me page
src/app/settings/layout.tsx               — Settings layout with sidebar
src/app/settings/team/page.tsx            — Settings > Team (moved from /team)
src/app/settings/team/[agentId]/page.tsx  — Settings > Team > Agent config (moved from /team/[agentId])
src/app/settings/knowledge/page.tsx       — Settings > Knowledge (moved from /knowledge)
src/app/settings/channels/page.tsx        — Settings > Channels (moved from /connections)
src/app/settings/identity/page.tsx        — Settings > Identity (moved from /)
src/app/settings/test-chat/page.tsx       — Settings > Test Chat (moved from /test-chat)
src/app/settings/account/page.tsx         — Settings > Account (moved from /settings)
src/components/dashboard/owner-today.tsx  — Owner Today view (mobile-optimized)
src/components/dashboard/staff-dashboard.tsx — Staff Dashboard view (desktop-optimized)
src/components/dashboard/stat-cards.tsx   — Owner stat cards (large type, 3 numbers)
```

### Modified Files

```
src/components/layout/app-shell.tsx       — View routing logic (owner vs staff)
src/app/layout.tsx                        — Dark mode class on <html>
src/app/globals.css                       — Dark mode CSS variables
tailwind.config.ts                        — darkMode: "class"
src/app/page.tsx                          — Replaced: becomes Today/Dashboard router
src/providers/auth-provider.tsx           — Add role to dev session
```

### Deleted Files (after migration complete)

```
src/components/layout/shell.tsx           — Replaced by staff-nav + owner-tabs
src/app/mission/page.tsx                  — Merged into / (page.tsx)
src/app/leads/page.tsx                    — Merged into /crm
src/app/leads/[id]/page.tsx              — Merged into /crm/[contactId]
src/app/conversations/page.tsx            — Merged into /crm
src/app/inbox/page.tsx                    — Merged into /crm
src/app/escalations/page.tsx              — Merged into /crm
src/app/results/page.tsx                  — Merged into /performance
src/app/growth/page.tsx                   — Merged into /performance
src/app/agents/page.tsx                   — Moved to /settings/team
src/app/knowledge/page.tsx                — Moved to /settings/knowledge
src/app/test-chat/page.tsx                — Moved to /settings/test-chat
src/app/connections/page.tsx              — Moved to /settings/channels
src/app/boundaries/page.tsx               — Moved to /settings/account
src/app/activity/page.tsx                 — Removed (absorbed into dashboard)
src/app/team/page.tsx                     — Moved to /settings/team
src/app/team/[agentId]/page.tsx          — Moved to /settings/team/[agentId]
```

---

## Task 1: View Preference Hook

**Files:**
- Create: `src/hooks/use-view-preference.ts`
- Create: `src/hooks/__tests__/use-view-preference.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/hooks/__tests__/use-view-preference.test.ts
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useViewPreference } from "../use-view-preference.js";

describe("useViewPreference", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to staff when no preference set", () => {
    const { result } = renderHook(() => useViewPreference());
    expect(result.current.view).toBe("staff");
  });

  it("reads owner preference from localStorage", () => {
    localStorage.setItem("switchboard.view-preference", "owner");
    const { result } = renderHook(() => useViewPreference());
    expect(result.current.view).toBe("owner");
  });

  it("toggles between owner and staff", () => {
    const { result } = renderHook(() => useViewPreference());
    expect(result.current.view).toBe("staff");

    act(() => {
      result.current.setView("owner");
    });
    expect(result.current.view).toBe("owner");
    expect(localStorage.getItem("switchboard.view-preference")).toBe("owner");
  });

  it("returns isOwner and isStaff booleans", () => {
    localStorage.setItem("switchboard.view-preference", "owner");
    const { result } = renderHook(() => useViewPreference());
    expect(result.current.isOwner).toBe(true);
    expect(result.current.isStaff).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- use-view-preference`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/hooks/use-view-preference.ts
"use client";

import { useState, useCallback, useEffect } from "react";

export type ViewPreference = "owner" | "staff";

const STORAGE_KEY = "switchboard.view-preference";

function readPreference(): ViewPreference {
  if (typeof window === "undefined") return "staff";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "owner" || stored === "staff") return stored;
  return "staff";
}

export function useViewPreference() {
  const [view, setViewState] = useState<ViewPreference>("staff");

  useEffect(() => {
    setViewState(readPreference());
  }, []);

  const setView = useCallback((v: ViewPreference) => {
    setViewState(v);
    localStorage.setItem(STORAGE_KEY, v);
  }, []);

  return {
    view,
    setView,
    isOwner: view === "owner",
    isStaff: view === "staff",
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- use-view-preference`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
jf submit -m "feat: add useViewPreference hook for owner/staff view switching"
```

---

## Task 2: Owner Tabs Component

**Files:**
- Create: `src/components/layout/owner-tabs.tsx`
- Create: `src/components/layout/__tests__/owner-tabs.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// src/components/layout/__tests__/owner-tabs.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { OwnerTabs } from "../owner-tabs.js";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("@/hooks/use-approvals", () => ({
  useApprovalCount: () => 3,
}));

describe("OwnerTabs", () => {
  it("renders 4 tab items", () => {
    render(<OwnerTabs />);
    expect(screen.getByText("Today")).toBeDefined();
    expect(screen.getByText("CRM")).toBeDefined();
    expect(screen.getByText("Decide")).toBeDefined();
    expect(screen.getByText("Me")).toBeDefined();
  });

  it("shows approval count badge on Decide", () => {
    render(<OwnerTabs />);
    expect(screen.getByText("3")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- owner-tabs`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/components/layout/owner-tabs.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Users, ShieldCheck, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useApprovalCount } from "@/hooks/use-approvals";

const TABS = [
  { href: "/", label: "Today", icon: Home },
  { href: "/crm", label: "CRM", icon: Users },
  { href: "/decide", label: "Decide", icon: ShieldCheck },
  { href: "/me", label: "Me", icon: User },
] as const;

export function OwnerTabs() {
  const pathname = usePathname();
  const pendingCount = useApprovalCount();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 h-16 border-t border-border/50 bg-background/95 backdrop-blur-sm">
      <div className="flex items-center justify-around h-full">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = isActive(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 w-1/4 min-h-[44px] text-[10px] tracking-wide transition-colors duration-fast",
                active ? "text-foreground font-medium" : "text-muted-foreground",
              )}
            >
              <div className="relative">
                <Icon className="h-[20px] w-[20px]" />
                {tab.href === "/decide" && pendingCount > 0 && (
                  <span className="absolute -top-1 -right-2 text-[9px] font-medium text-foreground bg-caution/20 rounded-full h-4 min-w-[16px] flex items-center justify-center px-1">
                    {pendingCount}
                  </span>
                )}
              </div>
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- owner-tabs`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
jf submit -m "feat: add OwnerTabs bottom tab bar component"
```

---

## Task 3: Staff Nav Component

**Files:**
- Create: `src/components/layout/staff-nav.tsx`
- Create: `src/components/layout/__tests__/staff-nav.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// src/components/layout/__tests__/staff-nav.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { StaffNav } from "../staff-nav.js";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("next-auth/react", () => ({
  signOut: vi.fn(),
}));

vi.mock("@/hooks/use-approvals", () => ({
  useApprovalCount: () => 2,
}));

vi.mock("@/hooks/use-org-config", () => ({
  useOrgConfig: () => ({ data: { config: { name: "Test Gym" } } }),
}));

vi.mock("@/hooks/use-view-preference", () => ({
  useViewPreference: () => ({ view: "staff", setView: vi.fn(), isOwner: false, isStaff: true }),
}));

describe("StaffNav", () => {
  it("renders 5 nav items plus settings", () => {
    render(<StaffNav />);
    expect(screen.getByText("Dashboard")).toBeDefined();
    expect(screen.getByText("CRM")).toBeDefined();
    expect(screen.getByText("Campaigns")).toBeDefined();
    expect(screen.getByText("Performance")).toBeDefined();
    expect(screen.getByText("Decide")).toBeDefined();
  });

  it("shows Switchboard logo linking to home", () => {
    render(<StaffNav />);
    expect(screen.getByText("Switchboard")).toBeDefined();
  });

  it("shows org name", () => {
    render(<StaffNav />);
    expect(screen.getByText("Test Gym")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- staff-nav`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/components/layout/staff-nav.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { useApprovalCount } from "@/hooks/use-approvals";
import { useOrgConfig } from "@/hooks/use-org-config";

const NAV = [
  { href: "/", label: "Dashboard", exact: true },
  { href: "/crm", label: "CRM" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/performance", label: "Performance" },
  { href: "/decide", label: "Decide" },
] as const;

export function StaffNav() {
  const pathname = usePathname();
  const pendingCount = useApprovalCount();
  const { data: orgData } = useOrgConfig();

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="hidden md:block fixed top-0 left-0 right-0 z-40 h-14 border-b border-border/50 bg-background/92 backdrop-blur-sm">
      <div className="page-width h-full flex items-center justify-between gap-8">
        <Link
          href="/"
          className="text-[14px] font-medium text-foreground tracking-tight shrink-0 hover:text-muted-foreground transition-colors duration-fast"
        >
          Switchboard
        </Link>

        <nav className="flex items-center gap-0 flex-1 justify-center">
          {NAV.map((item) => {
            const active = isActive(item.href, "exact" in item ? item.exact : false);
            const count = item.href === "/decide" && pendingCount > 0 ? pendingCount : null;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative px-4 py-4 text-[13.5px] tracking-[0.01em] transition-colors duration-fast whitespace-nowrap",
                  active
                    ? "text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
                {count !== null && (
                  <span className="ml-1.5 text-muted-foreground font-normal">· {count}</span>
                )}
                {active && (
                  <span className="absolute bottom-0 left-4 right-4 h-[2px] bg-foreground rounded-full" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          {orgData?.config?.name && (
            <span className="text-[12px] text-muted-foreground/70 truncate max-w-[140px]">
              {orgData.config.name}
            </span>
          )}
          <Link
            href="/settings"
            className={cn(
              "p-2 rounded-lg transition-colors duration-fast",
              pathname.startsWith("/settings")
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            aria-label="Settings"
          >
            <Settings className="h-4 w-4" />
          </Link>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-[13px] text-muted-foreground hover:text-foreground transition-colors duration-fast py-1"
            aria-label="Sign out"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- staff-nav`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
jf submit -m "feat: add StaffNav top bar component with 5 nav items"
```

---

## Task 4: Staff Mobile Menu

**Files:**
- Create: `src/components/layout/staff-mobile-menu.tsx`

- [ ] **Step 1: Write the implementation**

```typescript
// src/components/layout/staff-mobile-menu.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useApprovalCount } from "@/hooks/use-approvals";
import { useViewPreference } from "@/hooks/use-view-preference";

const MENU_ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/crm", label: "CRM" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/performance", label: "Performance" },
  { href: "/decide", label: "Decide" },
] as const;

export function StaffMobileMenu() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const pendingCount = useApprovalCount();
  const { setView } = useViewPreference();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="md:hidden">
      <header className="fixed top-0 left-0 right-0 z-40 h-14 border-b border-border/50 bg-background/95 backdrop-blur-sm flex items-center justify-between px-4">
        <button
          onClick={() => setOpen(!open)}
          className="p-2 text-foreground"
          aria-label={open ? "Close menu" : "Open menu"}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <span className="text-[14px] font-medium text-foreground tracking-tight">
          Switchboard
        </span>
        <div className="w-9" />
      </header>

      {open && (
        <div className="fixed inset-0 z-30 pt-14 bg-background">
          <nav className="px-6 py-8 space-y-1">
            {MENU_ITEMS.map((item) => {
              const active = isActive(item.href);
              const count = item.href === "/decide" && pendingCount > 0 ? pendingCount : null;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "block px-4 py-3 rounded-lg text-[15px] transition-colors",
                    active
                      ? "text-foreground font-medium bg-surface"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {item.label}
                  {count !== null && (
                    <span className="ml-2 text-muted-foreground font-normal">· {count}</span>
                  )}
                </Link>
              );
            })}

            <div className="border-t border-border/40 my-4" />

            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="block px-4 py-3 rounded-lg text-[15px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Settings
            </Link>

            <button
              onClick={() => {
                setView("owner");
                setOpen(false);
              }}
              className="block w-full text-left px-4 py-3 rounded-lg text-[15px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Switch to Owner view
            </button>

            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="block w-full text-left px-4 py-3 rounded-lg text-[15px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign out
            </button>
          </nav>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
jf submit -m "feat: add StaffMobileMenu hamburger drawer"
```

---

## Task 5: Owner Shell & Staff Shell

**Files:**
- Create: `src/components/layout/owner-shell.tsx`
- Create: `src/components/layout/staff-shell.tsx`

- [ ] **Step 1: Write OwnerShell**

```typescript
// src/components/layout/owner-shell.tsx
"use client";

import { OwnerTabs } from "./owner-tabs.js";

export function OwnerShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <main className="pb-20">
        <div className="content-width py-6">{children}</div>
      </main>
      <OwnerTabs />
    </div>
  );
}
```

- [ ] **Step 2: Write StaffShell**

```typescript
// src/components/layout/staff-shell.tsx
"use client";

import { StaffNav } from "./staff-nav.js";
import { StaffMobileMenu } from "./staff-mobile-menu.js";

export function StaffShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <StaffNav />
      <StaffMobileMenu />
      <main className="md:pt-14">
        <div className="page-width py-10 md:py-14">{children}</div>
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
jf submit -m "feat: add OwnerShell and StaffShell layout components"
```

---

## Task 6: Wire View Routing in AppShell

**Files:**
- Modify: `src/components/layout/app-shell.tsx`
- Modify: `src/providers/auth-provider.tsx` (add role to dev session)

- [ ] **Step 1: Read current files**

Read `src/components/layout/app-shell.tsx` and `src/providers/auth-provider.tsx`.

- [ ] **Step 2: Update auth provider dev session with role**

Add `role: "staff"` to the `DEV_SESSION` object in `auth-provider.tsx`:

```typescript
const DEV_SESSION = {
  user: {
    id: "dev-user",
    email: "dev@switchboard.local",
    name: "Dev User",
    role: "staff",
  },
  organizationId: "org_dev",
  principalId: "principal_dev",
  expires: "2099-01-01",
};
```

- [ ] **Step 3: Rewrite AppShell with view routing**

Replace `app-shell.tsx` with:

```typescript
"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { DevPanel } from "../dev/dev-panel";
import { useOrgConfig } from "@/hooks/use-org-config";
import { useViewPreference } from "@/hooks/use-view-preference";
import { OwnerShell } from "./owner-shell.js";
import { StaffShell } from "./staff-shell.js";

const CHROME_HIDDEN_PATHS = ["/login", "/onboarding", "/setup"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { view } = useViewPreference();

  const hideChrome = CHROME_HIDDEN_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );

  const { data: orgData, isLoading: orgLoading } = useOrgConfig(!hideChrome);

  const onboardingComplete = orgData?.config?.onboardingComplete ?? true;
  const isSetupPath = pathname === "/setup" || pathname.startsWith("/setup/");
  const isLoginPath = pathname === "/login";

  useEffect(() => {
    if (!orgLoading && !onboardingComplete && !isSetupPath && !isLoginPath) {
      router.replace("/setup");
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

  const Shell = view === "owner" ? OwnerShell : StaffShell;

  return (
    <>
      <Shell>{children}</Shell>
      <DevPanel />
    </>
  );
}
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
jf submit -m "feat: wire view routing in AppShell (owner/staff shells)"
```

---

## Task 7: Settings Layout with Sidebar

**Files:**
- Create: `src/components/layout/settings-layout.tsx`
- Create: `src/app/settings/layout.tsx`

- [ ] **Step 1: Write the settings layout component**

```typescript
// src/components/layout/settings-layout.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Users, BookOpen, Radio, Palette, MessagesSquare, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useViewPreference } from "@/hooks/use-view-preference";

const SIDEBAR_ITEMS = [
  { href: "/settings/team", label: "Team", icon: Users },
  { href: "/settings/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/settings/channels", label: "Channels", icon: Radio },
  { href: "/settings/identity", label: "Identity", icon: Palette },
  { href: "/settings/test-chat", label: "Test Chat", icon: MessagesSquare },
  { href: "/settings/account", label: "Account", icon: Building2 },
] as const;

export function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { setView } = useViewPreference();

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="flex gap-10 min-h-[calc(100vh-120px)]">
      {/* Desktop sidebar */}
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

        <div className="mt-8 pt-4 border-t border-border/40">
          <button
            onClick={() => setView("owner")}
            className="text-[12px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Switch to Owner view
          </button>
        </div>
      </aside>

      {/* Mobile: stacked list when at /settings exactly, otherwise content with back */}
      <div className="flex-1 min-w-0">
        {/* Mobile nav (shown only at /settings root on mobile) */}
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

        {/* Desktop content */}
        <div className="hidden md:block">{children}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the Next.js layout route**

```typescript
// src/app/settings/layout.tsx
import { SettingsLayout } from "@/components/layout/settings-layout";

export default function SettingsRouteLayout({ children }: { children: React.ReactNode }) {
  return <SettingsLayout>{children}</SettingsLayout>;
}
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
jf submit -m "feat: add settings layout with sidebar navigation"
```

---

## Task 8: Migrate Settings Sub-Pages

> **IMPORTANT ordering note:** This task must be completed BEFORE Task 18 (redirect old routes). Task 8 copies content from existing pages; Task 18 replaces those pages with redirects. Also note Task 13 (Performance Page) extracts from results/growth pages and must also complete before Task 18.

This task moves existing pages into the settings area. Each is a thin wrapper that imports the existing components.

**Files:**
- Create: `src/app/settings/account/page.tsx`
- Create: `src/app/settings/team/page.tsx`
- Create: `src/app/settings/team/[agentId]/page.tsx`
- Create: `src/app/settings/knowledge/page.tsx`
- Create: `src/app/settings/channels/page.tsx`
- Create: `src/app/settings/identity/page.tsx`
- Create: `src/app/settings/test-chat/page.tsx`
- Modify: `src/app/settings/page.tsx` (becomes redirect to /settings/team)

- [ ] **Step 1: Read current pages being moved**

Read: `src/app/team/page.tsx`, `src/app/team/[agentId]/page.tsx`, `src/app/knowledge/page.tsx`, `src/app/test-chat/page.tsx`, `src/app/connections/page.tsx`, `src/app/boundaries/page.tsx`

- [ ] **Step 2: Create settings/account page**

Copy current `/settings/page.tsx` content to `/settings/account/page.tsx`. Keep all imports and logic — just the file location changes.

- [ ] **Step 3: Create settings/team page**

Copy current `/team/page.tsx` content to `/settings/team/page.tsx`. Update any internal links from `/team/` to `/settings/team/`.

- [ ] **Step 4: Create settings/team/[agentId] page**

Copy current `/team/[agentId]/page.tsx` content to `/settings/team/[agentId]/page.tsx`. Update breadcrumb back-link from `/team` to `/settings/team`.

- [ ] **Step 5: Create settings/knowledge page**

Copy current `/knowledge/page.tsx` content to `/settings/knowledge/page.tsx`.

- [ ] **Step 6: Create settings/channels page**

Merge current `/connections/page.tsx` and channel management from `/settings` into `/settings/channels/page.tsx`. Import `ConnectionsList` and `ChannelManagement` components.

- [ ] **Step 7: Create settings/identity page**

Move the character customization from current `/page.tsx` (the `IdentityPage` component) to `/settings/identity/page.tsx`. This is the 3-column layout with name, role focus, working style, tone, autonomy.

- [ ] **Step 8: Create settings/test-chat page**

Copy current `/test-chat/page.tsx` content to `/settings/test-chat/page.tsx`.

- [ ] **Step 9: Update /settings/page.tsx**

On desktop, this page is never directly visible (sidebar always shows content). On mobile, `SettingsLayout` renders the stacked list of sub-pages when pathname is exactly `/settings`. So this page should render nothing (the layout handles the mobile view), but redirect on desktop.

```typescript
// src/app/settings/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SettingsPage() {
  const router = useRouter();

  // On desktop, redirect to first settings sub-page.
  // On mobile, SettingsLayout renders the stacked nav list — this page is never shown.
  useEffect(() => {
    const isDesktop = window.matchMedia("(min-width: 768px)").matches;
    if (isDesktop) {
      router.replace("/settings/team");
    }
  }, [router]);

  // Return null — the SettingsLayout handles the mobile view
  return null;
}
```

- [ ] **Step 10: Run typecheck**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
jf submit -m "feat: migrate settings sub-pages (team, knowledge, channels, identity, test-chat, account)"
```

---

## Task 9: CRM Tabs Component

**Files:**
- Create: `src/components/crm/crm-tabs.tsx`
- Create: `src/components/crm/__tests__/crm-tabs.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// src/components/crm/__tests__/crm-tabs.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CrmTabs, type CrmTab } from "../crm-tabs.js";

describe("CrmTabs", () => {
  const defaultProps = {
    activeTab: "leads" as CrmTab,
    onTabChange: vi.fn(),
    counts: { leads: 12, chats: 3, escalations: 1, inbox: 5 },
  };

  it("renders all 4 tabs with counts", () => {
    render(<CrmTabs {...defaultProps} />);
    expect(screen.getByText(/Leads/)).toBeDefined();
    expect(screen.getByText(/12/)).toBeDefined();
    expect(screen.getByText(/Chats/)).toBeDefined();
    expect(screen.getByText(/3/)).toBeDefined();
    expect(screen.getByText(/Escalations/)).toBeDefined();
    expect(screen.getByText(/Inbox/)).toBeDefined();
  });

  it("calls onTabChange when tab clicked", () => {
    render(<CrmTabs {...defaultProps} />);
    fireEvent.click(screen.getByText(/Chats/));
    expect(defaultProps.onTabChange).toHaveBeenCalledWith("chats");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- crm-tabs`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/components/crm/crm-tabs.tsx
"use client";

import { cn } from "@/lib/utils";

export type CrmTab = "leads" | "chats" | "escalations" | "inbox";

const TAB_LABELS: Record<CrmTab, string> = {
  leads: "Leads",
  chats: "Chats",
  escalations: "Escalations",
  inbox: "Inbox",
};

interface CrmTabsProps {
  activeTab: CrmTab;
  onTabChange: (tab: CrmTab) => void;
  counts: Record<CrmTab, number>;
}

export function CrmTabs({ activeTab, onTabChange, counts }: CrmTabsProps) {
  return (
    <div className="flex items-center gap-0 border-b border-border/60">
      {(Object.keys(TAB_LABELS) as CrmTab[]).map((tab) => {
        const active = activeTab === tab;
        const count = counts[tab];
        return (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            className={cn(
              "relative px-0 py-3 mr-6 text-[13.5px] transition-colors duration-fast whitespace-nowrap",
              active
                ? "text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {TAB_LABELS[tab]}
            {count > 0 && (
              <span className="ml-1.5 text-muted-foreground font-normal">· {count}</span>
            )}
            {active && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground rounded-full" />
            )}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- crm-tabs`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
jf submit -m "feat: add CrmTabs component for CRM page tab filtering"
```

---

## Task 10: Contact List Component

**Files:**
- Create: `src/components/crm/contact-list.tsx`

This extracts the lead row pattern from the current leads page and the conversation row pattern from the conversations page into a unified contact list.

- [ ] **Step 1: Read current components for patterns**

Read: `src/app/leads/page.tsx` (LeadRow component), `src/app/conversations/page.tsx` (ConversationRow component)

- [ ] **Step 2: Write the implementation**

```typescript
// src/components/crm/contact-list.tsx
"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

export interface ContactListItem {
  id: string;
  displayName: string;
  channel?: string;
  stage?: string;
  lastMessage?: string;
  lastActivityAt: string;
  isEscalated?: boolean;
  isUnread?: boolean;
}

const STAGE_BADGE: Record<string, string> = {
  NEW: "bg-muted text-muted-foreground",
  QUALIFIED: "bg-caution/15 text-foreground",
  BOOKED: "bg-positive/15 text-positive",
  LOST: "bg-muted/50 text-muted-foreground/70",
  ESCALATED: "bg-destructive/15 text-destructive",
};

const STAGE_LABELS: Record<string, string> = {
  NEW: "New",
  QUALIFIED: "Qualified",
  BOOKED: "Booked",
  LOST: "Lost",
  ESCALATED: "Escalated",
};

function formatRelative(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "Yesterday" : `${d}d ago`;
}

interface ContactListProps {
  contacts: ContactListItem[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  compact?: boolean;
}

export function ContactList({ contacts, selectedId, onSelect, compact }: ContactListProps) {
  if (contacts.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-[14px] text-muted-foreground">No contacts found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {contacts.map((contact) => {
        const isSelected = selectedId === contact.id;
        const stage = contact.isEscalated ? "ESCALATED" : contact.stage;
        const stageClass = stage ? STAGE_BADGE[stage] ?? STAGE_BADGE.NEW : null;
        const stageLabel = stage ? STAGE_LABELS[stage] ?? stage : null;

        if (compact) {
          return (
            <Link
              key={contact.id}
              href={`/crm/${contact.id}`}
              className="block px-4 py-3.5 rounded-xl border border-border/60 hover:border-border bg-surface transition-colors duration-fast"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium text-foreground truncate">
                      {contact.displayName}
                    </span>
                    {stageClass && stageLabel && (
                      <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0", stageClass)}>
                        {stageLabel}
                      </span>
                    )}
                  </div>
                  {contact.lastMessage && (
                    <p className="text-[12.5px] text-muted-foreground mt-0.5 truncate">
                      {contact.lastMessage}
                    </p>
                  )}
                </div>
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {formatRelative(contact.lastActivityAt)}
                </span>
              </div>
            </Link>
          );
        }

        return (
          <button
            key={contact.id}
            onClick={() => onSelect?.(contact.id)}
            className={cn(
              "w-full text-left rounded-xl border border-border/60 p-4 transition-colors duration-fast",
              isSelected ? "bg-surface border-foreground/20" : "bg-background hover:bg-surface/60",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13.5px] font-medium text-foreground">
                    {contact.displayName}
                  </span>
                  {contact.channel && (
                    <span className="text-[11px] text-muted-foreground capitalize">
                      {contact.channel}
                    </span>
                  )}
                  {stageClass && stageLabel && (
                    <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium", stageClass)}>
                      {stageLabel}
                    </span>
                  )}
                  {contact.isUnread && (
                    <span className="h-2 w-2 rounded-full bg-foreground shrink-0" />
                  )}
                </div>
                {contact.lastMessage && (
                  <p className="text-[12px] text-muted-foreground line-clamp-1">
                    {contact.lastMessage}
                  </p>
                )}
              </div>
              <span className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0">
                {formatRelative(contact.lastActivityAt)}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
jf submit -m "feat: add ContactList component for unified CRM contact display"
```

---

## Task 11: Contact Detail Component

**Files:**
- Create: `src/components/crm/contact-detail.tsx`

- [ ] **Step 1: Read current conversation detail pattern**

Read: `src/app/conversations/page.tsx` (MessageThread component), `src/app/leads/[id]/page.tsx`

- [ ] **Step 2: Write the implementation**

```typescript
// src/components/crm/contact-detail.tsx
"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useConversationDetail } from "@/hooks/use-conversations";
import { cn } from "@/lib/utils";

function formatRelative(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "Yesterday" : `${d}d ago`;
}

interface ContactInfo {
  displayName: string;
  email?: string;
  phone?: string;
  channel?: string;
  stage?: string;
  createdAt: string;
}

interface ContactDetailProps {
  contactId: string;
  contactInfo?: ContactInfo;
  conversationId?: string;
}

export function ContactDetail({ contactId, contactInfo, conversationId }: ContactDetailProps) {
  const { data: convData, isLoading: convLoading } = useConversationDetail(
    conversationId ?? contactId,
  );

  return (
    <div className="space-y-6">
      {/* Info section */}
      {contactInfo && (
        <section>
          <h3 className="section-label mb-3">Contact</h3>
          <div className="rounded-xl border border-border/60 bg-surface p-4 space-y-2">
            <p className="text-[15px] font-medium text-foreground">{contactInfo.displayName}</p>
            {contactInfo.email && (
              <p className="text-[13px] text-muted-foreground">{contactInfo.email}</p>
            )}
            {contactInfo.phone && (
              <div className="flex items-center gap-2">
                <p className="text-[13px] text-muted-foreground">{contactInfo.phone}</p>
                <a
                  href={`tel:${contactInfo.phone}`}
                  className="text-[12px] text-foreground underline underline-offset-2"
                >
                  Call
                </a>
              </div>
            )}
            {contactInfo.channel && (
              <p className="text-[12px] text-muted-foreground capitalize">
                Channel: {contactInfo.channel}
              </p>
            )}
            <p className="text-[12px] text-muted-foreground">
              Created: {formatRelative(contactInfo.createdAt)}
            </p>
          </div>
        </section>
      )}

      {/* Conversation section */}
      <section>
        <h3 className="section-label mb-3">Conversation</h3>
        {convLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : !convData?.messages || convData.messages.length === 0 ? (
          <div className="rounded-xl border border-border/60 bg-surface p-5">
            <p className="text-[13px] text-muted-foreground">No messages yet.</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
            {convData.messages.map((msg, idx) => {
              const isUser = msg.role === "user" || msg.role === "lead";
              return (
                <div key={idx} className={cn("flex", isUser ? "justify-start" : "justify-end")}>
                  <div
                    className={cn(
                      "rounded-xl px-3.5 py-2.5 max-w-[80%]",
                      isUser ? "bg-muted text-foreground" : "bg-foreground/10 text-foreground",
                    )}
                  >
                    <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {msg.role} · {formatRelative(msg.timestamp)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
jf submit -m "feat: add ContactDetail component with info and conversation thread"
```

---

## Task 12: CRM Page

**Files:**
- Create: `src/app/crm/page.tsx`
- Create: `src/app/crm/[contactId]/page.tsx`

- [ ] **Step 1: Write the CRM page**

This page uses `useViewPreference` to render compact (owner) or master-detail (staff) layouts. It pulls data from existing hooks (`useLeads`, `useConversations`, `useEscalations`, `useInbox`) and maps them to a unified `ContactListItem` shape.

```typescript
// src/app/crm/page.tsx
"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { CrmTabs, type CrmTab } from "@/components/crm/crm-tabs.js";
import { ContactList, type ContactListItem } from "@/components/crm/contact-list.js";
import { ContactDetail } from "@/components/crm/contact-detail.js";
import { useLeads } from "@/hooks/use-leads";
import { useConversations } from "@/hooks/use-conversations";
import { useViewPreference } from "@/hooks/use-view-preference";

export default function CrmPage() {
  const { status } = useSession();
  const { isOwner } = useViewPreference();
  const [activeTab, setActiveTab] = useState<CrmTab>("leads");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("ALL");

  const { data: leads = [], isLoading: leadsLoading } = useLeads();
  const { data: convsData, isLoading: convsLoading } = useConversations({});

  if (status === "unauthenticated") redirect("/login");

  const conversations = convsData?.conversations ?? [];

  // Map leads to ContactListItem
  const leadContacts: ContactListItem[] = leads.map((l) => ({
    id: l.contact.id,
    displayName: l.displayName,
    channel: l.contact.channel,
    stage: l.stage,
    lastMessage: undefined,
    lastActivityAt: l.contact.createdAt,
  }));

  // Map conversations to ContactListItem
  const chatContacts: ContactListItem[] = conversations.map((c) => ({
    id: c.id,
    displayName: c.principalId, // TODO: resolve to contact name
    channel: c.channel,
    stage: undefined,
    lastMessage: c.currentIntent ?? undefined,
    lastActivityAt: c.lastActivityAt,
    isEscalated: c.status === "human_override",
  }));

  // Escalated subset
  const escalatedContacts = chatContacts.filter((c) => c.isEscalated);

  const counts = {
    leads: leadContacts.length,
    chats: chatContacts.length,
    escalations: escalatedContacts.length,
    inbox: 0, // TODO: wire up inbox count
  };

  const tabContacts: Record<CrmTab, ContactListItem[]> = {
    leads: leadContacts,
    chats: chatContacts,
    escalations: escalatedContacts,
    inbox: [],
  };

  const activeContacts = tabContacts[activeTab];
  const isLoading = leadsLoading || convsLoading;

  // Owner: compact list with filter chips
  if (isOwner) {
    const filteredLeads =
      filter === "ALL" ? leadContacts : leadContacts.filter((l) => l.stage === filter);

    return (
      <div className="space-y-6">
        <section>
          <h1 className="text-[22px] font-semibold tracking-tight text-foreground">CRM</h1>
        </section>

        {/* Filter chips */}
        <div className="flex gap-2 flex-wrap">
          {["ALL", "NEW", "QUALIFIED", "BOOKED"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-[12.5px] font-medium transition-colors duration-fast ${
                filter === f
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : (
          <ContactList contacts={filteredLeads} compact />
        )}
      </div>
    );
  }

  // Staff: master-detail with tabs
  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">CRM</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          Your contacts, conversations, and escalations in one place.
        </p>
      </section>

      <CrmTabs activeTab={activeTab} onTabChange={setActiveTab} counts={counts} />

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-6">
          <ContactList
            contacts={activeContacts}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId(selectedId === id ? null : id)}
          />

          <div className="lg:sticky lg:top-20 lg:self-start">
            {selectedId ? (
              <div className="rounded-xl border border-border/60 bg-surface p-5">
                <ContactDetail contactId={selectedId} conversationId={selectedId} />
              </div>
            ) : (
              <div className="rounded-xl border border-border/60 bg-surface p-8 text-center">
                <p className="text-[13.5px] text-muted-foreground">
                  Select a contact to view details.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write the contact detail page**

```typescript
// src/app/crm/[contactId]/page.tsx
"use client";

import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ContactDetail } from "@/components/crm/contact-detail.js";

export default function ContactDetailPage() {
  const { status } = useSession();
  const params = useParams();
  const router = useRouter();
  const contactId = params.contactId as string;

  if (status === "unauthenticated") redirect("/login");

  return (
    <div className="space-y-6">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <ContactDetail contactId={contactId} conversationId={contactId} />
    </div>
  );
}
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
jf submit -m "feat: add CRM page with tabbed master-detail and contact detail route"
```

---

## Task 13: Performance Page

> **IMPORTANT ordering note:** This task must be completed BEFORE Task 18 (redirect old routes), because it extracts content from the existing results and growth pages into reusable components. Task 18 will replace those pages with redirects.

**Files:**
- Create: `src/components/performance/results-content.tsx`
- Create: `src/components/performance/growth-content.tsx`
- Create: `src/app/performance/page.tsx`

- [ ] **Step 1: Read current results and growth pages**

Read: `src/app/results/page.tsx`, `src/app/growth/page.tsx` (full files)

- [ ] **Step 2: Extract results content into a reusable component**

Copy the content of `src/app/results/page.tsx` into `src/components/performance/results-content.tsx`. Rename the default export to `ResultsContent`. Remove the `useSession` / `redirect` auth check (the parent performance page handles that).

- [ ] **Step 3: Extract growth content into a reusable component**

Copy the content of `src/app/growth/page.tsx` into `src/components/performance/growth-content.tsx`. Rename the default export to `GrowthContent`. Remove the `useSession` / `redirect` auth check.

- [ ] **Step 4: Write the performance page**

Create a tabbed page that switches between the extracted Results and Growth content components.

```typescript
// src/app/performance/page.tsx
"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { cn } from "@/lib/utils";
import { ResultsContent } from "@/components/performance/results-content.js";
import { GrowthContent } from "@/components/performance/growth-content.js";

type PerfTab = "results" | "growth";

export default function PerformancePage() {
  const { status } = useSession();
  const [tab, setTab] = useState<PerfTab>("results");

  if (status === "unauthenticated") redirect("/login");

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Performance</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          Your results and growth metrics.
        </p>
      </section>

      <div className="flex items-center gap-0 border-b border-border/60">
        {(["results", "growth"] as PerfTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "relative px-0 py-3 mr-6 text-[13.5px] transition-colors duration-fast whitespace-nowrap capitalize",
              tab === t
                ? "text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t}
            {tab === t && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground rounded-full" />
            )}
          </button>
        ))}
      </div>

      {tab === "results" ? <ResultsContent /> : <GrowthContent />}
    </div>
  );
}
```

- [ ] **Step 5: Run typecheck**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
jf submit -m "feat: add Performance page with extracted Results and Growth content"
```

---

## Task 14: Decide Page (Renamed Approvals)

**Files:**
- Create: `src/app/decide/page.tsx`
- Create: `src/app/decide/[id]/page.tsx`

- [ ] **Step 1: Read current approvals pages**

Read: `src/app/approvals/page.tsx`, `src/app/approvals/[id]/page.tsx`

- [ ] **Step 2: Create decide page as copy of approvals**

Copy `src/app/approvals/page.tsx` to `src/app/decide/page.tsx`. Update any internal links from `/approvals` to `/decide`.

- [ ] **Step 3: Create decide detail page**

Copy `src/app/approvals/[id]/page.tsx` to `src/app/decide/[id]/page.tsx`. Update links from `/approvals` to `/decide`.

- [ ] **Step 4: Commit**

```bash
jf submit -m "feat: add Decide page (renamed approvals)"
```

---

## Task 15: Owner Me Page

**Files:**
- Create: `src/app/me/page.tsx`

- [ ] **Step 1: Write the Me page**

```typescript
// src/app/me/page.tsx
"use client";

import { useSession, signOut } from "next-auth/react";
import { redirect } from "next/navigation";
import { useAgentRoster } from "@/hooks/use-agents";
import { useViewPreference } from "@/hooks/use-view-preference";
import { Skeleton } from "@/components/ui/skeleton";
import { AGENT_ICONS, AGENT_ROLE_LABELS } from "@/components/team/agent-icons";
import { cn } from "@/lib/utils";

const STATUS_DOT: Record<string, string> = {
  idle: "bg-agent-idle",
  working: "bg-agent-active",
  analyzing: "bg-agent-active",
  waiting_approval: "bg-agent-attention",
  error: "bg-destructive",
};

const STATUS_LABEL: Record<string, string> = {
  idle: "Ready",
  working: "Working",
  analyzing: "Analyzing",
  waiting_approval: "Waiting",
  error: "Error",
};

export default function MePage() {
  const { status } = useSession();
  const { data: rosterData, isLoading } = useAgentRoster();
  const { setView } = useViewPreference();

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
  const specialists = roster.filter((a) => a.agentRole !== "primary_operator" && a.status !== "locked");

  return (
    <div className="space-y-8">
      <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Me</h1>

      {/* Identity summary */}
      {primaryOperator && (
        <section className="rounded-xl border border-border/60 bg-surface p-5 space-y-3">
          <h2 className="section-label">Your assistant</h2>
          <p className="text-[17px] font-semibold text-foreground">
            {primaryOperator.displayName}
          </p>
          <p className="text-[13px] text-muted-foreground">Primary operator</p>
        </section>
      )}

      {/* Team status */}
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
                  <span className="text-[13.5px] text-foreground flex-1">
                    {agent.displayName}
                  </span>
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

      {/* Quick actions */}
      <section className="space-y-2">
        <button
          onClick={() => setView("staff")}
          className="w-full text-left px-4 py-3.5 rounded-lg text-[15px] text-foreground hover:bg-surface border border-border/40 transition-colors"
        >
          Staff view →
          <span className="block text-[12px] text-muted-foreground mt-0.5">
            Full dashboard access
          </span>
        </button>

        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-full text-left px-4 py-3.5 rounded-lg text-[15px] text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
        >
          Sign out
        </button>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
jf submit -m "feat: add Owner Me page with team status and view toggle"
```

---

## Task 16: Dashboard Home Page (Today / Dashboard)

**Files:**
- Create: `src/components/dashboard/stat-cards.tsx`
- Create: `src/components/dashboard/owner-today.tsx`
- Create: `src/components/dashboard/staff-dashboard.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Write stat cards component**

```typescript
// src/components/dashboard/stat-cards.tsx
"use client";

interface StatCardsProps {
  stats: { label: string; value: string | number }[];
}

export function StatCards({ stats }: StatCardsProps) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="rounded-xl border border-border/60 bg-surface p-4 text-center"
        >
          <p className="text-[24px] font-semibold text-foreground leading-none">
            {stat.value}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1.5 uppercase tracking-wide">
            {stat.label}
          </p>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Write OwnerToday component**

```typescript
// src/components/dashboard/owner-today.tsx
"use client";

import Link from "next/link";
import { useAgentRoster } from "@/hooks/use-agents";
import { useApprovals } from "@/hooks/use-approvals";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { queryKeys } from "@/lib/query-keys";
import { StatCards } from "./stat-cards.js";
import { TodayActivityFeed } from "@/components/mission-control/today-activity-feed";
import { useLeads } from "@/hooks/use-leads";

function isTodayLead(createdAt: string): boolean {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  return new Date(createdAt).getTime() >= midnight.getTime();
}

const CONSEQUENCE: Record<string, string> = {
  low: "Routine — asked as a precaution.",
  medium: "Affects a customer or involves money.",
  high: "Significant — take a moment to review.",
  critical: "Significant — take a moment to review.",
};

export function OwnerToday() {
  const { data: session } = useSession();
  const { data: rosterData } = useAgentRoster();
  const { data: approvalsData } = useApprovals();
  const { data: leads = [] } = useLeads();
  const queryClient = useQueryClient();
  const [respondingId, setRespondingId] = useState<string | null>(null);

  const operatorName =
    rosterData?.roster?.find((a) => a.agentRole === "primary_operator")?.displayName ??
    "Your assistant";

  const todayLeads = leads.filter((l) => isTodayLead(l.contact.createdAt));
  const bookedToday = todayLeads.filter((l) => l.stage === "BOOKED").length;
  const topApproval = approvalsData?.approvals?.[0];
  const remainingApprovals = (approvalsData?.approvals?.length ?? 0) - 1;

  const respondMutation = useMutation({
    mutationFn: async ({ approvalId, action, bindingHash }: { approvalId: string; action: string; bindingHash: string }) => {
      const res = await fetch("/api/dashboard/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvalId,
          action,
          respondedBy: (session as { principalId?: string })?.principalId ?? "dashboard-user",
          bindingHash,
        }),
      });
      if (!res.ok) throw new Error("Failed to respond");
      return res.json();
    },
    onSettled: () => {
      setRespondingId(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all });
    },
  });

  // Greeting based on time
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-8">
      <p className="text-[20px] font-semibold text-foreground">{greeting}.</p>

      {/* Stat cards */}
      <StatCards
        stats={[
          { label: "Leads today", value: todayLeads.length },
          { label: "Booked", value: bookedToday },
          { label: "Revenue", value: "$0" },
        ]}
      />

      {/* Top approval */}
      {topApproval && (
        <section>
          <h2 className="section-label mb-3">Needs you</h2>
          <div className="rounded-xl border border-border bg-surface p-5 space-y-3">
            <p className="text-[14.5px] text-foreground leading-relaxed">{topApproval.summary}</p>
            <p className="text-[12.5px] text-muted-foreground italic leading-snug">
              {CONSEQUENCE[topApproval.riskCategory] ?? CONSEQUENCE.medium}
            </p>
            <div className="flex items-center gap-2 pt-0.5">
              <button
                onClick={() => {
                  setRespondingId(topApproval.id);
                  respondMutation.mutate({
                    approvalId: topApproval.id,
                    action: "approve",
                    bindingHash: topApproval.bindingHash,
                  });
                }}
                disabled={respondingId === topApproval.id}
                className="px-4 py-2 rounded-lg text-[13px] font-medium bg-positive text-positive-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                Approve
              </button>
              <button
                onClick={() => {
                  setRespondingId(topApproval.id);
                  respondMutation.mutate({
                    approvalId: topApproval.id,
                    action: "reject",
                    bindingHash: topApproval.bindingHash,
                  });
                }}
                disabled={respondingId === topApproval.id}
                className="px-3 py-2 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                Not now
              </button>
              {remainingApprovals > 0 && (
                <Link
                  href="/decide"
                  className="ml-auto text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  {remainingApprovals} more →
                </Link>
              )}
            </div>
          </div>
        </section>
      )}

      {!topApproval && (
        <section>
          <div className="rounded-xl border border-border/60 bg-surface-raised px-6 py-6 text-center">
            <p className="text-[14px] text-foreground font-medium">You're all caught up.</p>
            <p className="text-[13px] text-muted-foreground mt-1">
              {operatorName} will reach out when something needs you.
            </p>
          </div>
        </section>
      )}

      {/* Activity feed */}
      <section>
        <h2 className="section-label mb-3">What happened</h2>
        <TodayActivityFeed />
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Write StaffDashboard component**

```typescript
// src/components/dashboard/staff-dashboard.tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useApprovalCount, useApprovals } from "@/hooks/use-approvals";
import { useAgentRoster } from "@/hooks/use-agents";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys } from "@/lib/query-keys";
import { TodayBanner } from "@/components/mission-control/today-banner";
import { TodayActivityFeed } from "@/components/mission-control/today-activity-feed";
import { MonthlyScorecard } from "@/components/mission-control/monthly-scorecard";
import { AGENT_ICONS } from "@/components/team/agent-icons";
import { cn } from "@/lib/utils";

const CONSEQUENCE: Record<string, string> = {
  low: "Routine — asked as a precaution.",
  medium: "Affects a customer or involves money.",
  high: "Significant — take a moment to review.",
  critical: "Significant — take a moment to review.",
};

const STATUS_DOT: Record<string, string> = {
  idle: "bg-agent-idle",
  working: "bg-agent-active animate-pulse",
  analyzing: "bg-agent-active animate-pulse",
  waiting_approval: "bg-agent-attention animate-pulse",
  error: "bg-destructive animate-pulse",
};

const STATUS_LABEL: Record<string, string> = {
  idle: "Ready",
  working: "Working",
  analyzing: "Analyzing",
  waiting_approval: "Waiting",
  error: "Error",
};

export function StaffDashboard() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const pendingCount = useApprovalCount();
  const { data: approvalsData } = useApprovals();
  const { data: rosterData, isLoading: rosterLoading } = useAgentRoster();

  const [respondingId, setRespondingId] = useState<string | null>(null);

  const respondMutation = useMutation({
    mutationFn: async ({
      approvalId,
      action,
      bindingHash,
    }: {
      approvalId: string;
      action: string;
      bindingHash: string;
    }) => {
      const res = await fetch("/api/dashboard/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvalId,
          action,
          respondedBy: (session as { principalId?: string })?.principalId ?? "dashboard-user",
          bindingHash,
        }),
      });
      if (!res.ok) throw new Error("Failed to respond");
      return res.json();
    },
    onSettled: () => {
      setRespondingId(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.audit.all });
    },
  });

  const operatorName =
    rosterData?.roster?.find((a) => a.agentRole === "primary_operator")?.displayName ??
    "Your assistant";

  const approvals = approvalsData?.approvals?.slice(0, 3) ?? [];
  const roster = rosterData?.roster ?? [];
  const activeAgents = roster.filter((a) => a.status !== "locked");

  if (rosterLoading) {
    return (
      <div className="space-y-14">
        <Skeleton className="h-12 w-72" />
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-10">
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
          <Skeleton className="h-40" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-14">
      <TodayBanner operatorName={operatorName} />

      <section className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-12 lg:gap-16">
        <div>
          <h2 className="section-label mb-5">What happened</h2>
          <TodayActivityFeed />
        </div>

        <div>
          <h2 className="section-label mb-5">Needs attention</h2>

          {approvals.length === 0 ? (
            <div className="rounded-xl border border-border/60 bg-surface-raised px-6 py-8 text-center">
              <p className="text-[14px] text-foreground font-medium">You&apos;re all caught up.</p>
              <p className="text-[13px] text-muted-foreground mt-1.5 leading-relaxed">
                {operatorName} will reach out when something needs you.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {approvals.map((approval) => (
                <div key={approval.id} className="rounded-xl border border-border bg-surface p-5 space-y-3">
                  <p className="text-[14.5px] text-foreground leading-relaxed">{approval.summary}</p>
                  <p className="text-[12.5px] text-muted-foreground italic leading-snug">
                    {CONSEQUENCE[approval.riskCategory] ?? CONSEQUENCE.medium}
                  </p>
                  <div className="flex items-center gap-2 pt-0.5">
                    <button
                      onClick={() => {
                        setRespondingId(approval.id);
                        respondMutation.mutate({
                          approvalId: approval.id,
                          action: "approve",
                          bindingHash: approval.bindingHash,
                        });
                      }}
                      disabled={respondingId === approval.id && respondMutation.isPending}
                      className="px-4 py-2 rounded-lg text-[13px] font-medium bg-positive text-positive-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => {
                        setRespondingId(approval.id);
                        respondMutation.mutate({
                          approvalId: approval.id,
                          action: "reject",
                          bindingHash: approval.bindingHash,
                        });
                      }}
                      disabled={respondingId === approval.id && respondMutation.isPending}
                      className="px-3 py-2 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    >
                      Not now
                    </button>
                    <Link
                      href="/decide"
                      className="ml-auto text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      See all →
                    </Link>
                  </div>
                </div>
              ))}
              {pendingCount > 3 && (
                <Link
                  href="/decide"
                  className="block text-center text-[13px] text-muted-foreground hover:text-foreground transition-colors py-2"
                >
                  {pendingCount - 3} more waiting →
                </Link>
              )}
            </div>
          )}
        </div>
      </section>

      <MonthlyScorecard />

      {/* Agent status strip */}
      {activeAgents.length > 0 && (
        <section>
          <h2 className="section-label mb-4">Agent status</h2>
          <div className="flex flex-wrap gap-4">
            {activeAgents.map((agent) => {
              const Icon = AGENT_ICONS[agent.agentRole] ?? AGENT_ICONS.primary_operator;
              const activityStatus = (agent.agentState?.activityStatus as string) ?? "idle";
              const dot = STATUS_DOT[activityStatus] ?? STATUS_DOT.idle;
              const label = STATUS_LABEL[activityStatus] ?? "Ready";

              return (
                <Link
                  key={agent.id}
                  href={`/settings/team/${agent.id}`}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/40 bg-surface hover:border-border transition-colors"
                >
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-[13px] text-foreground">{agent.displayName}</span>
                  <div className={cn("h-[6px] w-[6px] rounded-full", dot)} />
                  <span className="text-[11px] text-muted-foreground">{label}</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Rewrite the home page to route between views**

Replace `src/app/page.tsx`:

```typescript
// src/app/page.tsx
"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { useViewPreference } from "@/hooks/use-view-preference";
import { OwnerToday } from "@/components/dashboard/owner-today";
import { StaffDashboard } from "@/components/dashboard/staff-dashboard";

export default function HomePage() {
  const { status } = useSession();
  const { isOwner } = useViewPreference();

  if (status === "unauthenticated") redirect("/login");

  return isOwner ? <OwnerToday /> : <StaffDashboard />;
}
```

- [ ] **Step 5: Run typecheck**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
jf submit -m "feat: add Owner Today and Staff Dashboard home page views"
```

---

## Task 17: Dark Mode

**Files:**
- Modify: `src/app/globals.css`
- Modify: `tailwind.config.ts`
- Modify: `src/app/layout.tsx`
- Create: `src/hooks/use-theme.ts`

- [ ] **Step 1: Add darkMode config to tailwind**

Read `tailwind.config.ts`, then add `darkMode: "class"` to the config object:

```typescript
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  // ... rest unchanged
};
```

- [ ] **Step 2: Add dark theme variables to globals.css**

Read `src/app/globals.css`, then add after the `:root` block inside `@layer base`:

```css
.dark {
  /* Surfaces */
  --background: 30 8% 8%;
  --foreground: 40 15% 90%;
  --surface: 30 6% 12%;
  --surface-foreground: 40 15% 90%;
  --surface-raised: 30 6% 15%;

  /* Text */
  --muted: 30 5% 20%;
  --muted-foreground: 30 6% 55%;
  --tertiary-foreground: 30 5% 48%;

  /* Interactive */
  --primary: 40 15% 90%;
  --primary-foreground: 30 8% 8%;
  --secondary: 30 5% 20%;
  --secondary-foreground: 40 15% 90%;
  --accent: 30 8% 18%;
  --accent-foreground: 40 15% 90%;

  /* Borders */
  --border: 30 5% 18%;
  --border-subtle: 30 5% 14%;
  --input: 30 5% 18%;
  --ring: 40 15% 90%;

  /* Semantic */
  --destructive: 0 38% 45%;
  --destructive-foreground: 0 0% 98%;
  --positive: 152 24% 38%;
  --positive-foreground: 0 0% 98%;
  --positive-subtle: 152 18% 16%;
  --caution: 38 36% 42%;
  --caution-foreground: 0 0% 98%;
  --caution-subtle: 38 28% 16%;
  --negative: 0 32% 45%;
  --negative-foreground: 0 0% 98%;

  /* Operator amber */
  --operator: 30 50% 52%;
  --operator-foreground: 0 0% 98%;
  --operator-subtle: 32 40% 16%;

  /* Cards */
  --card: 30 6% 12%;
  --card-foreground: 40 15% 90%;

  /* Agent status */
  --agent-active: 152 26% 42%;
  --agent-idle: 30 5% 45%;
  --agent-attention: 38 38% 48%;
  --agent-locked: 30 5% 32%;

  /* Character */
  --char-body: hsl(30 8% 58%);
  --char-aura: hsl(30 8% 42%);
  --char-accent: hsl(30 50% 52%);
}
```

- [ ] **Step 3: Write useTheme hook**

```typescript
// src/hooks/use-theme.ts
"use client";

import { useState, useCallback, useEffect } from "react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "switchboard.theme";

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const resolved = theme === "system" ? getSystemTheme() : theme;
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("system");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    const initial = stored === "light" || stored === "dark" ? stored : "system";
    setThemeState(initial);
    applyTheme(initial);

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      const current = (localStorage.getItem(STORAGE_KEY) as Theme) ?? "system";
      if (current === "system") applyTheme("system");
    };
    mq.addEventListener("change", handleChange);
    return () => mq.removeEventListener("change", handleChange);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    localStorage.setItem(STORAGE_KEY, t);
    applyTheme(t);
  }, []);

  return { theme, setTheme };
}
```

- [ ] **Step 4: Add suppressHydrationWarning to html tag in layout.tsx**

Read `src/app/layout.tsx`, then add `suppressHydrationWarning` to the `<html>` tag (needed because dark class is applied client-side):

```typescript
<html lang="en" className={`${inter.variable} ${cormorant.variable}`} suppressHydrationWarning>
```

- [ ] **Step 5: Add theme toggle to Settings Account page**

Read `src/app/settings/account/page.tsx`, then add a "Theme" section with three options (Light / Dark / System) using the existing Pill-style buttons pattern. Import and use `useTheme`:

```typescript
import { useTheme } from "@/hooks/use-theme";

// Inside the component:
const { theme, setTheme } = useTheme();

// In the JSX, add a section:
<section>
  <h3 className="section-label mb-3">Theme</h3>
  <div className="flex gap-2">
    {(["light", "dark", "system"] as const).map((t) => (
      <button
        key={t}
        onClick={() => setTheme(t)}
        className={cn(
          "px-4 py-2 rounded-lg text-[13px] font-medium border transition-all duration-default",
          theme === t
            ? "bg-surface border-foreground/70 text-foreground shadow-sm"
            : "bg-surface-raised border-border text-muted-foreground hover:text-foreground",
        )}
      >
        {t.charAt(0).toUpperCase() + t.slice(1)}
      </button>
    ))}
  </div>
</section>
```

- [ ] **Step 6: Add theme toggle to Owner Me page**

Read `src/app/me/page.tsx`, then add a theme toggle in the "Quick actions" section before the sign out button. Same `useTheme` pattern but simplified to a single toggle button:

```typescript
import { useTheme } from "@/hooks/use-theme";

// Inside the component:
const { theme, setTheme } = useTheme();

// In JSX, add before the sign out button:
<button
  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
  className="w-full text-left px-4 py-3.5 rounded-lg text-[15px] text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
>
  {theme === "dark" ? "Light mode" : "Dark mode"}
</button>
```

- [ ] **Step 7: Run typecheck**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
jf submit -m "feat: add dark mode with CSS variable swap, useTheme hook, and UI toggles"
```

---

## Task 18: Redirect Old Routes

**Files:**
- Modify: `src/app/mission/page.tsx` → redirect to `/`
- Modify: `src/app/leads/page.tsx` → redirect to `/crm`
- Modify: `src/app/conversations/page.tsx` → redirect to `/crm`
- Modify: `src/app/inbox/page.tsx` → redirect to `/crm`
- Modify: `src/app/escalations/page.tsx` → redirect to `/crm`
- Modify: `src/app/results/page.tsx` → redirect to `/performance`
- Modify: `src/app/agents/page.tsx` → redirect to `/settings/team`
- Modify: `src/app/knowledge/page.tsx` → redirect to `/settings/knowledge`
- Modify: `src/app/test-chat/page.tsx` → redirect to `/settings/test-chat`
- Modify: `src/app/connections/page.tsx` → redirect to `/settings/channels`
- Modify: `src/app/boundaries/page.tsx` → redirect to `/settings/account`
- Modify: `src/app/team/page.tsx` → redirect to `/settings/team`
- Modify: `src/app/approvals/page.tsx` → redirect to `/decide`
- Modify: `src/app/activity/page.tsx` → redirect to `/`

- [ ] **Step 1: Replace each old page with a redirect**

For each file above, replace the entire contents with:

```typescript
import { redirect } from "next/navigation";

export default function Page() {
  redirect("<new-route>");
}
```

Specific mappings:
- `/mission` → `/`
- `/leads` → `/crm`
- `/leads/[id]` → `/crm` (no 1:1 mapping for old lead IDs to new contact IDs)
- `/conversations` → `/crm`
- `/inbox` → `/crm`
- `/escalations` → `/crm`
- `/results` → `/performance`
- `/growth` → `/performance`
- `/agents` → `/settings/team`
- `/knowledge` → `/settings/knowledge`
- `/test-chat` → `/settings/test-chat`
- `/connections` → `/settings/channels`
- `/boundaries` → `/settings/account`
- `/team` → `/settings/team`
- `/team/[agentId]` → `/settings/team` (can't preserve agent ID mapping without more work)
- `/approvals` → `/decide`
- `/approvals/[id]` → `/decide`
- `/activity` → `/`

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS

- [ ] **Step 3: Run all tests**

Run: `pnpm --filter @switchboard/dashboard test`
Expected: PASS (some tests may need mock updates for removed components)

- [ ] **Step 4: Commit**

```bash
jf submit -m "feat: redirect old routes to new locations"
```

---

## Task 19: Update AppShell Chrome-Hidden Paths

**Files:**
- Modify: `src/components/layout/app-shell.tsx`

- [ ] **Step 1: Read current app-shell.tsx**

- [ ] **Step 2: Remove FULL_VIEWPORT_PATHS constant**

It's no longer needed since the identity page moved to `/settings/identity`. The full viewport treatment was only for `/`.

- [ ] **Step 3: Verify CHROME_HIDDEN_PATHS is still correct**

Should remain: `["/login", "/onboarding", "/setup"]`. These pages don't show the nav shell.

- [ ] **Step 4: Run typecheck**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
jf submit -m "chore: clean up AppShell chrome paths after route migration"
```

---

## Task 20: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 2: Run typecheck across monorepo**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 4: Run format check**

Run: `pnpm format:check`
Expected: PASS (run `pnpm format` to fix if needed)

- [ ] **Step 5: Manual smoke test**

Start the dashboard: `pnpm --filter @switchboard/dashboard dev`

Verify:
1. `/` renders Staff Dashboard by default
2. Toggle to Owner view → renders Owner Today with stat cards
3. Navigate to `/crm` → tabbed master-detail in Staff, compact list in Owner
4. Navigate to `/settings` → sidebar with Team, Knowledge, Channels, Identity, Test Chat, Account
5. `/settings/identity` shows the character customization page
6. Old routes (`/mission`, `/leads`, `/conversations`, etc.) redirect correctly
7. Dark mode: add `class="dark"` to `<html>` manually → colors invert properly
8. Mobile viewport: Owner shows bottom tabs, Staff shows hamburger

- [ ] **Step 6: Commit any fixes**

```bash
jf submit -m "fix: address smoke test findings"
```
