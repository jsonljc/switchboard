# Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single public landing page that positions Switchboard as an AI agent platform — character-led visuals, outcome proof, trust system, Notion/Figma-inspired playful aesthetic.

**Architecture:** Next.js route groups split the app into `(public)` (landing page, no auth shell) and `(auth)` (existing dashboard). The root layout becomes a minimal shell; auth/chrome wrapping moves into `(auth)/layout.tsx`. Landing page is composed of 5 sections: hero, timeline, stats, trust, footer.

**Tech Stack:** Next.js 14, React, Tailwind CSS, existing shadcn/ui components, Space Mono font (new), existing OperatorCharacter SVG component, Intersection Observer for scroll animations.

---

## File Structure

```
apps/dashboard/src/
├── app/
│   ├── layout.tsx                          ← MODIFY: strip to minimal shell
│   ├── not-found.tsx                       ← stays (root level)
│   ├── error.tsx                           ← stays (root level)
│   ├── login/page.tsx                      ← stays (root level)
│   ├── onboarding/page.tsx                 ← stays (root level)
│   ├── (public)/
│   │   ├── layout.tsx                      ← CREATE: landing layout (nav + footer)
│   │   └── page.tsx                        ← CREATE: landing page
│   └── (auth)/
│       ├── layout.tsx                      ← CREATE: auth shell (AppShell + providers)
│       ├── page.tsx                        ← MOVE: current homepage
│       ├── me/page.tsx                     ← MOVE
│       ├── decide/page.tsx                 ← MOVE
│       ├── decide/[id]/page.tsx            ← MOVE
│       ├── settings/layout.tsx             ← MOVE
│       ├── settings/page.tsx               ← MOVE
│       ├── settings/channels/page.tsx      ← MOVE
│       ├── settings/identity/page.tsx      ← MOVE
│       ├── settings/team/page.tsx          ← MOVE
│       ├── settings/team/[agentId]/page.tsx ← MOVE
│       ├── settings/test-chat/page.tsx     ← MOVE
│       ├── settings/knowledge/page.tsx     ← MOVE
│       ├── settings/account/page.tsx       ← MOVE
│       ├── marketplace/page.tsx            ← MOVE
│       ├── marketplace/[id]/page.tsx       ← MOVE
│       ├── marketplace/[id]/deploy/page.tsx ← MOVE
│       └── tasks/page.tsx                  ← MOVE
├── components/
│   └── landing/
│       ├── landing-nav.tsx                 ← CREATE
│       ├── hero-section.tsx                ← CREATE
│       ├── agent-family-character.tsx      ← CREATE
│       ├── timeline-section.tsx            ← CREATE
│       ├── stats-section.tsx               ← CREATE
│       ├── stat-card.tsx                   ← CREATE
│       ├── trust-section.tsx               ← CREATE
│       ├── trust-card.tsx                  ← CREATE
│       ├── landing-footer.tsx              ← CREATE
│       └── __tests__/
│           ├── landing-nav.test.tsx         ← CREATE
│           ├── hero-section.test.tsx        ← CREATE
│           ├── timeline-section.test.tsx    ← CREATE
│           ├── stats-section.test.tsx       ← CREATE
│           └── trust-section.test.tsx       ← CREATE
├── hooks/
│   └── use-scroll-reveal.ts                ← CREATE
└── app/globals.css                         ← MODIFY: add scroll-behavior, reduced-motion
```

---

### Task 1: Route Group Migration — Create `(auth)` layout and move pages

This is the structural refactor. No new UI — just reorganize routes so the root layout is minimal and all authenticated pages live under `(auth)/`.

**Files:**

- Modify: `apps/dashboard/src/app/layout.tsx`
- Create: `apps/dashboard/src/app/(auth)/layout.tsx`
- Create: `apps/dashboard/src/app/(public)/layout.tsx` (placeholder)
- Move: all authenticated page files into `(auth)/`

- [ ] **Step 1: Create `(auth)/layout.tsx`**

This layout takes over the auth wrapping that currently lives in the root layout.

```tsx
// apps/dashboard/src/app/(auth)/layout.tsx
import { AuthProvider } from "@/providers/auth-provider";
import { AppShell } from "@/components/layout/app-shell";
import { ErrorBoundary } from "@/components/error-boundary";
import { OperatorChatWidget } from "@/components/operator-chat/operator-chat-widget";
import { Toaster } from "@/components/ui/toaster";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ErrorBoundary>
        <AppShell>{children}</AppShell>
      </ErrorBoundary>
      <OperatorChatWidget />
      <Toaster />
    </AuthProvider>
  );
}
```

- [ ] **Step 2: Create placeholder `(public)/layout.tsx`**

Minimal for now — just renders children. Will be fleshed out in Task 6.

```tsx
// apps/dashboard/src/app/(public)/layout.tsx
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
```

- [ ] **Step 3: Strip root `layout.tsx` to minimal shell**

Remove AuthProvider, AppShell, ErrorBoundary, OperatorChatWidget, and Toaster. Keep fonts, metadata, QueryProvider, and HTML shell only.

**Note:** `QueryProvider` has no dependency on `AuthProvider` — it's a standalone `QueryClientProvider` wrapper. Safe to hoist to root level. Verified by reading `providers/query-provider.tsx`.

```tsx
// apps/dashboard/src/app/layout.tsx
import type { Metadata } from "next";
import { Inter, Cormorant_Garamond } from "next/font/google";
import "./globals.css";
import { QueryProvider } from "@/providers/query-provider";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Switchboard",
  description: "Your AI team runs the business. Stay in control, without the clutter.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${cormorant.variable}`} suppressHydrationWarning>
      <body className={inter.className}>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Move authenticated pages into `(auth)/`**

Move these directories/files from `apps/dashboard/src/app/` into `apps/dashboard/src/app/(auth)/`:

```bash
cd apps/dashboard/src/app
mkdir -p "(auth)"
# Move page files
mv page.tsx "(auth)/page.tsx"
mv me "(auth)/me"
mv decide "(auth)/decide"
mv settings "(auth)/settings"
mv marketplace "(auth)/marketplace"
mv tasks "(auth)/tasks"
```

Do NOT move: `login/`, `onboarding/`, `layout.tsx`, `globals.css`, `not-found.tsx`, `error.tsx`, or `api/`.

- [ ] **Step 5: Create placeholder `(public)/page.tsx`**

Temporary — just so `/` resolves to something.

```tsx
// apps/dashboard/src/app/(public)/page.tsx
export default function LandingPage() {
  return <div>Landing page — coming soon</div>;
}
```

- [ ] **Step 6: Verify the app still works**

Run:

```bash
cd apps/dashboard && npx pnpm@9.15.4 run build
```

Expected: Build succeeds. All existing pages now render at the same URLs (route groups are transparent to the URL structure). The root `/` shows the placeholder landing page.

- [ ] **Step 7: Run existing tests**

Run:

```bash
npx pnpm@9.15.4 --filter @switchboard/dashboard test
```

Expected: All existing tests pass. The route group migration is purely structural.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "refactor: split app into (public) and (auth) route groups

Move all authenticated pages into (auth)/ route group.
Root layout stripped to minimal shell (fonts + QueryProvider).
Auth wrapping (AuthProvider, AppShell, etc.) moves to (auth)/layout.tsx.
Public route group added with placeholder landing page."
```

---

### Task 2: Add Space Mono font and global CSS updates

**Files:**

- Modify: `apps/dashboard/src/app/layout.tsx`
- Modify: `apps/dashboard/src/app/globals.css`
- Modify: `apps/dashboard/tailwind.config.ts`

- [ ] **Step 1: Add Space Mono to root layout**

Add the font import alongside Inter and Cormorant Garamond:

```tsx
import { Inter, Cormorant_Garamond, Space_Mono } from "next/font/google";

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-mono",
  display: "swap",
});
```

Add `${spaceMono.variable}` to the `<html>` className.

- [ ] **Step 2: Add font-mono to tailwind config**

In `tailwind.config.ts`, add to `theme.extend.fontFamily`:

```ts
mono: ["var(--font-mono)"],
```

- [ ] **Step 3: Add scroll-behavior and reduced-motion to globals.css**

Add to the existing `@layer base` section in `globals.css`:

```css
html {
  scroll-behavior: smooth;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 4: Verify build**

Run:

```bash
cd apps/dashboard && npx pnpm@9.15.4 run build
```

Expected: Build succeeds. Space Mono font is loaded.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add Space Mono font and reduced-motion support

Add Space Mono (400, 700) for landing page numbers/timestamps.
Add smooth scroll and prefers-reduced-motion media query."
```

---

### Task 3: `useScrollReveal` hook

**Files:**

- Create: `apps/dashboard/src/hooks/use-scroll-reveal.ts`
- Create: `apps/dashboard/src/hooks/__tests__/use-scroll-reveal.test.ts`

- [ ] **Step 1: Write the test**

```tsx
// apps/dashboard/src/hooks/__tests__/use-scroll-reveal.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useScrollReveal } from "../use-scroll-reveal";

// Mock IntersectionObserver
const mockObserve = vi.fn();
const mockDisconnect = vi.fn();

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    vi.fn((callback: IntersectionObserverCallback) => ({
      observe: mockObserve,
      disconnect: mockDisconnect,
      unobserve: vi.fn(),
    })),
  );
});

describe("useScrollReveal", () => {
  it("returns a ref and isVisible defaults to false", () => {
    const { result } = renderHook(() => useScrollReveal());
    expect(result.current.isVisible).toBe(false);
    expect(result.current.ref).toBeDefined();
  });

  it("calls IntersectionObserver with correct threshold", () => {
    renderHook(() => useScrollReveal({ threshold: 0.3 }));
    expect(IntersectionObserver).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ threshold: 0.3 }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard test -- use-scroll-reveal`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

```tsx
// apps/dashboard/src/hooks/use-scroll-reveal.ts
"use client";

import { useEffect, useRef, useState } from "react";

interface UseScrollRevealOptions {
  threshold?: number;
  once?: boolean;
}

export function useScrollReveal({ threshold = 0.2, once = true }: UseScrollRevealOptions = {}) {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          if (once) observer.disconnect();
        }
      },
      { threshold },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold, once]);

  return { ref, isVisible };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard test -- use-scroll-reveal`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add useScrollReveal intersection observer hook

Reusable hook for scroll-triggered fade-in animations.
Supports threshold and once-only trigger."
```

---

### Task 4: `AgentFamilyCharacter` wrapper component

**Files:**

- Create: `apps/dashboard/src/components/landing/agent-family-character.tsx`
- Create: `apps/dashboard/src/components/landing/__tests__/agent-family-character.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// apps/dashboard/src/components/landing/__tests__/agent-family-character.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentFamilyCharacter } from "../agent-family-character";

describe("AgentFamilyCharacter", () => {
  it("renders name and Live badge for live status", () => {
    render(<AgentFamilyCharacter name="Sales" roleFocus="leads" status="live" />);
    expect(screen.getByText("Sales")).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("renders name and Coming badge for coming status", () => {
    render(<AgentFamilyCharacter name="Creative" roleFocus="default" status="coming" />);
    expect(screen.getByText("Creative")).toBeInTheDocument();
    expect(screen.getByText("Coming")).toBeInTheDocument();
  });

  it("applies opacity-40 class when muted", () => {
    const { container } = render(
      <AgentFamilyCharacter name="Trading" roleFocus="default" status="coming" />,
    );
    const characterWrapper = container.querySelector(".opacity-40");
    expect(characterWrapper).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard test -- agent-family-character`

Expected: FAIL — module not found.

- [ ] **Step 3: Create the component**

```tsx
// apps/dashboard/src/components/landing/agent-family-character.tsx
"use client";

import { cn } from "@/lib/utils";
import { OperatorCharacter, type RoleFocus } from "@/components/character/operator-character";

interface AgentFamilyCharacterProps {
  name: string;
  roleFocus: RoleFocus;
  status: "live" | "coming";
  className?: string;
}

export function AgentFamilyCharacter({
  name,
  roleFocus,
  status,
  className,
}: AgentFamilyCharacterProps) {
  const isMuted = status === "coming";

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <div
        className={cn("w-[120px] h-[160px] lg:w-[150px] lg:h-[200px]", isMuted && "opacity-40")}
        style={isMuted ? { animationDuration: "12s" } : undefined}
      >
        <OperatorCharacter roleFocus={roleFocus} />
      </div>
      <span className="text-sm font-medium text-foreground">{name}</span>
      <span
        className={cn(
          "text-xs font-mono px-2 py-0.5 rounded border-2",
          status === "live"
            ? "text-positive border-positive bg-positive-subtle"
            : "text-muted-foreground border-border bg-muted",
        )}
      >
        {status === "live" ? "Live" : "Coming"}
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard test -- agent-family-character`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/landing/agent-family-character.tsx apps/dashboard/src/components/landing/__tests__/agent-family-character.test.tsx && git commit -m "feat: add AgentFamilyCharacter wrapper component

Wraps OperatorCharacter with muted/live state, label, and status badge.
Muted characters render at 40% opacity with slower animation."
```

---

### Task 5: `LandingNav` component

**Files:**

- Create: `apps/dashboard/src/components/landing/landing-nav.tsx`
- Create: `apps/dashboard/src/components/landing/__tests__/landing-nav.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// apps/dashboard/src/components/landing/__tests__/landing-nav.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LandingNav } from "../landing-nav";

describe("LandingNav", () => {
  it("renders wordmark and sign in link when not authenticated", () => {
    render(<LandingNav isAuthenticated={false} />);
    expect(screen.getByText("Switchboard")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/login");
  });

  it("renders dashboard link when authenticated", () => {
    render(<LandingNav isAuthenticated={true} />);
    expect(screen.getByRole("link", { name: /dashboard/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard test -- landing-nav`

Expected: FAIL

- [ ] **Step 3: Implement `LandingNav`**

**Note:** The spec says LandingNav should be a server component, but it needs `useState`/`useEffect` for scroll detection. Instead, it's a client component that receives `isAuthenticated` as a prop from the server-side `(public)/layout.tsx`. This is an intentional deviation — auth detection still happens server-side, just passed as a prop.

```tsx
// apps/dashboard/src/components/landing/landing-nav.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface LandingNavProps {
  isAuthenticated: boolean;
}

export function LandingNav({ isAuthenticated }: LandingNavProps) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header>
      <nav
        aria-label="Main navigation"
        className={cn(
          "fixed top-0 left-0 right-0 z-50 transition-all duration-default",
          scrolled ? "bg-surface border-b border-border shadow-sm" : "bg-transparent",
        )}
      >
        <div className="page-width flex items-center justify-between h-16">
          <Link
            href="/"
            className="font-display text-xl font-medium tracking-tight text-foreground"
          >
            Switchboard
          </Link>
          {isAuthenticated ? (
            <Link
              href="/me"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md px-2 py-1"
            >
              Dashboard
            </Link>
          ) : (
            <Link
              href="/login"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md px-2 py-1"
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard test -- landing-nav`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add LandingNav with transparent-to-solid scroll transition

Shows Switchboard wordmark + Sign in / Dashboard link.
Transparent on hero, solid white with border on scroll."
```

---

### Task 6: `LandingFooter` component and `(public)/layout.tsx`

**Files:**

- Create: `apps/dashboard/src/components/landing/landing-footer.tsx`
- Create: `apps/dashboard/src/components/landing/__tests__/landing-footer.test.tsx`
- Modify: `apps/dashboard/src/app/(public)/layout.tsx`

- [ ] **Step 1: Write footer test**

```tsx
// apps/dashboard/src/components/landing/__tests__/landing-footer.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LandingFooter } from "../landing-footer";

describe("LandingFooter", () => {
  it("renders wordmark and builder link", () => {
    render(<LandingFooter />);
    expect(screen.getByText("Switchboard")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /build agents/i })).toHaveAttribute(
      "href",
      "mailto:builders@switchboard.ai",
    );
  });

  it("renders copyright", () => {
    render(<LandingFooter />);
    expect(screen.getByText(/switchboard/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Create `LandingFooter`**

```tsx
// apps/dashboard/src/components/landing/landing-footer.tsx
import Link from "next/link";

export function LandingFooter() {
  return (
    <footer className="bg-surface-raised py-6">
      <div className="page-width flex items-center justify-between text-sm text-muted-foreground">
        <span className="font-display font-medium text-foreground">Switchboard</span>
        <Link
          href="mailto:builders@switchboard.ai"
          className="hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md px-2 py-1"
        >
          Build agents for the marketplace &rarr;
        </Link>
        <span>&copy; {new Date().getFullYear()} Switchboard</span>
      </div>
    </footer>
  );
}
```

- [ ] **Step 3: Update `(public)/layout.tsx`**

```tsx
// apps/dashboard/src/app/(public)/layout.tsx
import type { Metadata } from "next";
import { getServerSession } from "@/lib/session";
import { LandingNav } from "@/components/landing/landing-nav";
import { LandingFooter } from "@/components/landing/landing-footer";

export const metadata: Metadata = {
  title: "Switchboard — Hire AI agents that run your business",
  description:
    "Deploy AI agents for sales, creative, trading, and finance. They start supervised, earn your trust, and work 24/7.",
  openGraph: {
    title: "Switchboard — Hire AI agents that run your business",
    description:
      "Deploy AI agents for sales, creative, trading, and finance. They start supervised, earn your trust, and work 24/7.",
    type: "website",
  },
};

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  const isAuthenticated = session !== null;

  return (
    <div className="light min-h-screen flex flex-col bg-background">
      <LandingNav isAuthenticated={isAuthenticated} />
      <main className="flex-1">{children}</main>
      <LandingFooter />
    </div>
  );
}
```

- [ ] **Step 4: Verify build**

Run: `cd apps/dashboard && npx pnpm@9.15.4 run build`

Expected: Build succeeds. Landing page at `/` renders nav + placeholder + footer.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add LandingFooter and wire up (public) layout

Public layout uses server-side auth detection for nav state.
Forces light mode. Includes metadata for SEO/OG."
```

---

### Task 7: `HeroSection` component

**Files:**

- Create: `apps/dashboard/src/components/landing/hero-section.tsx`
- Create: `apps/dashboard/src/components/landing/__tests__/hero-section.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// apps/dashboard/src/components/landing/__tests__/hero-section.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HeroSection } from "../hero-section";

describe("HeroSection", () => {
  it("renders headline and subheadline", () => {
    render(<HeroSection />);
    expect(screen.getByText(/hire ai agents that run your business/i)).toBeInTheDocument();
    expect(screen.getByText(/they start supervised/i)).toBeInTheDocument();
  });

  it("renders all four agent family characters", () => {
    render(<HeroSection />);
    expect(screen.getByText("Sales")).toBeInTheDocument();
    expect(screen.getByText("Creative")).toBeInTheDocument();
    expect(screen.getByText("Trading")).toBeInTheDocument();
    expect(screen.getByText("Finance")).toBeInTheDocument();
  });

  it("renders CTA buttons", () => {
    render(<HeroSection />);
    expect(screen.getByRole("link", { name: /get started/i })).toHaveAttribute("href", "/login");
  });

  it("marks Sales as live and others as coming", () => {
    render(<HeroSection />);
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getAllByText("Coming")).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard test -- hero-section`

Expected: FAIL

- [ ] **Step 3: Implement `HeroSection`**

```tsx
// apps/dashboard/src/components/landing/hero-section.tsx
"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AgentFamilyCharacter } from "./agent-family-character";
import type { RoleFocus } from "@/components/character/operator-character";

const AGENT_FAMILIES: Array<{
  name: string;
  roleFocus: RoleFocus;
  status: "live" | "coming";
}> = [
  { name: "Sales", roleFocus: "leads", status: "live" },
  { name: "Creative", roleFocus: "default", status: "coming" },
  { name: "Trading", roleFocus: "default", status: "coming" },
  { name: "Finance", roleFocus: "default", status: "coming" },
];

export function HeroSection() {
  return (
    <section className="pt-28 pb-20 lg:pt-36 lg:pb-28" aria-label="Hero">
      <div className="page-width text-center">
        <h1
          className="font-display font-light tracking-tight text-foreground"
          style={{ fontSize: "clamp(2.5rem, 5vw, 4rem)" }}
        >
          Hire AI agents that run your business.
        </h1>
        <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
          Sales. Creative. Trading. Finance.
          <br />
          They start supervised. They earn your trust.
        </p>

        <div className="mt-12 flex items-end justify-center gap-6 lg:gap-10">
          {AGENT_FAMILIES.map((family, i) => (
            <div
              key={family.name}
              className="animate-fade-in-up"
              style={{ animationDelay: `${i * 200}ms`, animationFillMode: "both" }}
            >
              <AgentFamilyCharacter
                name={family.name}
                roleFocus={family.roleFocus}
                status={family.status}
              />
            </div>
          ))}
        </div>

        <div className="mt-12 flex items-center justify-center gap-4">
          <Button asChild size="lg">
            <Link href="/login">Get started</Link>
          </Button>
          <a
            href="#see-it-in-action"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            See it in action &darr;
          </a>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard test -- hero-section`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add HeroSection with 4 agent family characters

Headline, subheadline, 4 characters (1 live + 3 muted coming),
Get started CTA and smooth-scroll anchor to timeline."
```

---

### Task 8: `TimelineSection` component

**Files:**

- Create: `apps/dashboard/src/components/landing/timeline-section.tsx`
- Create: `apps/dashboard/src/components/landing/__tests__/timeline-section.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// apps/dashboard/src/components/landing/__tests__/timeline-section.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { TimelineSection } from "../timeline-section";

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    vi.fn(() => ({ observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() })),
  );
});

describe("TimelineSection", () => {
  it("renders the section header", () => {
    render(<TimelineSection />);
    expect(screen.getByText(/see it in action/i)).toBeInTheDocument();
    expect(screen.getByText(/sales pipeline/i)).toBeInTheDocument();
  });

  it("renders all timeline entries", () => {
    render(<TimelineSection />);
    expect(screen.getByText(/fills out your contact form/i)).toBeInTheDocument();
    expect(screen.getByText(/speed-to-lead/i)).toBeInTheDocument();
    expect(screen.getByText(/sales closer/i)).toBeInTheDocument();
    expect(screen.getByText(/you were asleep/i)).toBeInTheDocument();
  });

  it("has the scroll target id", () => {
    const { container } = render(<TimelineSection />);
    expect(container.querySelector("#see-it-in-action")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard test -- timeline-section`

Expected: FAIL

- [ ] **Step 3: Implement `TimelineSection`**

```tsx
// apps/dashboard/src/components/landing/timeline-section.tsx
"use client";

import { cn } from "@/lib/utils";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";

interface TimelineEntry {
  time: string;
  text: string;
  agentColor?: string;
  isHandoff?: boolean;
  isPunchline?: boolean;
}

const SALES_TIMELINE: TimelineEntry[] = [
  {
    time: "11:42 PM",
    text: "A lead fills out your contact form.",
  },
  {
    time: "11:42 PM",
    text: "Speed-to-Lead responds. Qualifies the lead in under 60 seconds.",
    agentColor: "hsl(238 28% 52%)",
  },
  {
    time: "11:58 PM",
    text: "Qualified. Hands off to Sales Closer with full context.",
    agentColor: "hsl(238 28% 52%)",
    isHandoff: true,
  },
  {
    time: "12:03 AM",
    text: "Sales Closer handles objections. Books a call for tomorrow at 2 PM.",
    agentColor: "hsl(152 28% 36%)",
  },
  {
    time: "",
    text: "You were asleep the whole time.",
    isPunchline: true,
  },
];

export function TimelineSection() {
  const { ref, isVisible } = useScrollReveal({ threshold: 0.15 });

  return (
    <section id="see-it-in-action" className="py-20 lg:py-28" aria-label="See it in action">
      <div className="page-width">
        <h2 className="font-display text-3xl lg:text-4xl font-light text-center text-foreground mb-12">
          See it in action:{" "}
          <span className="inline-block px-3 py-1 text-base font-mono font-normal rounded border-2 border-border text-muted-foreground align-middle">
            Sales Pipeline
          </span>
        </h2>

        <div
          ref={ref}
          className="max-w-2xl mx-auto rounded-xl border border-border bg-surface p-8 lg:p-10"
        >
          <div className="relative">
            {/* Vertical timeline line */}
            <div className="absolute left-[3.25rem] top-2 bottom-2 w-px bg-border-subtle" />

            <div className="space-y-6">
              {SALES_TIMELINE.map((entry, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex gap-4 items-start",
                    isVisible && "animate-fade-in-up",
                    entry.isPunchline && "mt-8 justify-center",
                  )}
                  style={
                    isVisible
                      ? { animationDelay: `${i * 300}ms`, animationFillMode: "both" }
                      : { opacity: 0 }
                  }
                >
                  {entry.isPunchline ? (
                    <p className="text-muted-foreground italic text-center">{entry.text}</p>
                  ) : (
                    <>
                      <span className="font-mono text-xs text-muted-foreground w-16 shrink-0 pt-0.5">
                        {entry.time}
                      </span>
                      <div className="flex items-start gap-3">
                        {entry.agentColor && (
                          <div className="flex items-center gap-1 shrink-0 pt-1">
                            <div
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: entry.agentColor }}
                            />
                            {entry.isHandoff && (
                              <>
                                <span className="text-xs text-muted-foreground">&rarr;</span>
                                <div
                                  className="w-3 h-3 rounded-full"
                                  style={{ backgroundColor: "hsl(152 28% 36%)" }}
                                />
                              </>
                            )}
                          </div>
                        )}
                        <p className="text-sm text-foreground leading-relaxed">{entry.text}</p>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <p className="text-center text-sm text-muted-foreground mt-8 max-w-lg mx-auto">
          Sales is live today. Creative, Trading, and Finance agents are coming — same trust system,
          same control.
        </p>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard test -- timeline-section`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add TimelineSection with scroll-triggered stagger animation

Concrete sales pipeline scenario as chat-log timeline.
Agent color dots, handoff arrows, punchline ending.
Framed as one example on the platform."
```

---

### Task 9: `StatCard` and `StatsSection` components

**Files:**

- Create: `apps/dashboard/src/components/landing/stat-card.tsx`
- Create: `apps/dashboard/src/components/landing/stats-section.tsx`
- Create: `apps/dashboard/src/components/landing/__tests__/stats-section.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// apps/dashboard/src/components/landing/__tests__/stats-section.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatsSection } from "../stats-section";

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    vi.fn(() => ({ observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() })),
  );
});

describe("StatsSection", () => {
  it("renders section header", () => {
    render(<StatsSection />);
    expect(screen.getByText(/how switchboard agents work/i)).toBeInTheDocument();
  });

  it("renders all three stat labels", () => {
    render(<StatsSection />);
    expect(screen.getByText(/response time/i)).toBeInTheDocument();
    expect(screen.getByText(/follow-through/i)).toBeInTheDocument();
    expect(screen.getByText(/trust levels/i)).toBeInTheDocument();
  });

  it("renders the body copy", () => {
    render(<StatsSection />);
    expect(screen.getByText(/operational guarantees/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard test -- stats-section`

Expected: FAIL

- [ ] **Step 3: Implement `StatCard`**

```tsx
// apps/dashboard/src/components/landing/stat-card.tsx
"use client";

import { useEffect, useState } from "react";

interface StatCardProps {
  value: number;
  prefix?: string;
  suffix?: string;
  label: string;
  description: string;
  animate: boolean;
}

export function StatCard({ value, prefix, suffix, label, description, animate }: StatCardProps) {
  const [displayed, setDisplayed] = useState(0);

  useEffect(() => {
    if (!animate) return;

    // Respect prefers-reduced-motion — show final value immediately
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) {
      setDisplayed(value);
      return;
    }

    const duration = 800;
    const startTime = performance.now();

    function tick(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setDisplayed(Math.round(eased * value));
      if (progress < 1) requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }, [animate, value]);

  return (
    <div className="text-center">
      <div className="font-mono text-4xl lg:text-5xl font-bold text-foreground">
        {prefix}
        {displayed}
        {suffix}
      </div>
      <div className="mt-1 text-sm font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
```

- [ ] **Step 4: Implement `StatsSection`**

```tsx
// apps/dashboard/src/components/landing/stats-section.tsx
"use client";

import { StatCard } from "./stat-card";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";

const STATS = [
  {
    value: 60,
    prefix: "< ",
    suffix: "s",
    label: "response time",
    description: "Agents act immediately on every trigger.",
  },
  {
    value: 100,
    suffix: "%",
    label: "follow-through",
    description: "Nothing falls through the cracks.",
  },
  {
    value: 4,
    label: "trust levels",
    description: "Supervised → Guided → Autonomous → Autonomous+. Earned, not assigned.",
  },
];

export function StatsSection() {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section className="py-20 lg:py-28 bg-surface-raised" aria-label="Platform stats">
      <div className="page-width" ref={ref}>
        <h2 className="font-display text-3xl lg:text-4xl font-light text-center text-foreground mb-16">
          How Switchboard agents work
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-12 lg:gap-16">
          {STATS.map((stat) => (
            <StatCard key={stat.label} {...stat} animate={isVisible} />
          ))}
        </div>

        <p className="mt-16 text-center text-sm text-muted-foreground max-w-lg mx-auto">
          These aren&apos;t vanity metrics. They&apos;re operational guarantees. The agents
          don&apos;t forget, don&apos;t sleep, don&apos;t get busy with another client.
        </p>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard test -- stats-section`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add StatsSection with count-up animation

Three platform stats: <60s response, 100% follow-through, 4 trust levels.
Numbers count up on viewport entry via StatCard component."
```

---

### Task 10: `TrustCard` and `TrustSection` components

**Files:**

- Create: `apps/dashboard/src/components/landing/trust-card.tsx`
- Create: `apps/dashboard/src/components/landing/trust-section.tsx`
- Create: `apps/dashboard/src/components/landing/__tests__/trust-section.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// apps/dashboard/src/components/landing/__tests__/trust-section.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrustSection } from "../trust-section";

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    vi.fn(() => ({ observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() })),
  );
});

describe("TrustSection", () => {
  it("renders section header", () => {
    render(<TrustSection />);
    expect(screen.getByText(/you're the boss/i)).toBeInTheDocument();
  });

  it("renders all three trust cards", () => {
    render(<TrustSection />);
    expect(screen.getByText(/starts at zero/i)).toBeInTheDocument();
    expect(screen.getByText(/your ok/i)).toBeInTheDocument();
    expect(screen.getByText(/never claim to be human/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard test -- trust-section`

Expected: FAIL

- [ ] **Step 3: Implement `TrustCard`**

```tsx
// apps/dashboard/src/components/landing/trust-card.tsx
interface TrustCardProps {
  visual: React.ReactNode;
  text: string;
}

export function TrustCard({ visual, text }: TrustCardProps) {
  return (
    <div className="rounded-lg border border-border bg-surface p-6">
      <div className="mb-4">{visual}</div>
      <p className="text-sm text-foreground leading-relaxed">{text}</p>
    </div>
  );
}
```

- [ ] **Step 4: Implement `TrustSection`**

```tsx
// apps/dashboard/src/components/landing/trust-section.tsx
"use client";

import { TrustCard } from "./trust-card";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";
import { cn } from "@/lib/utils";

function PixelProgressBar() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "w-3 h-4 rounded-sm border",
              i === 0 ? "bg-foreground border-foreground" : "bg-transparent border-border",
            )}
          />
        ))}
      </div>
      <span className="font-mono text-sm font-bold text-foreground">0</span>
    </div>
  );
}

function PixelCheckmarks() {
  return (
    <div className="flex gap-1">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="w-6 h-6 rounded border-2 border-positive bg-positive-subtle flex items-center justify-center"
        >
          <span className="text-positive text-xs font-bold">&check;</span>
        </div>
      ))}
    </div>
  );
}

function PixelShield() {
  return (
    <div className="w-8 h-9 rounded border-2 border-foreground flex items-center justify-center">
      <span className="text-foreground text-sm font-bold">&hearts;</span>
    </div>
  );
}

export function TrustSection() {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section className="py-20 lg:py-28" aria-label="Trust and governance">
      <div className="page-width" ref={ref}>
        <h2 className="font-display text-3xl lg:text-4xl font-light text-center text-foreground mb-12">
          You&apos;re the boss. Literally.
        </h2>

        <div
          className={cn(
            "grid grid-cols-1 md:grid-cols-3 gap-6 max-w-3xl mx-auto",
            isVisible && "animate-fade-in-up",
          )}
          style={isVisible ? { animationFillMode: "both" } : { opacity: 0 }}
        >
          <TrustCard
            visual={<PixelProgressBar />}
            text="Every agent starts at zero trust. No exceptions."
          />
          <TrustCard
            visual={<PixelCheckmarks />}
            text="New agents need your OK on every task. Earn autonomy over time."
          />
          <TrustCard
            visual={<PixelShield />}
            text="They never claim to be human. Never promise what you can't deliver."
          />
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard test -- trust-section`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add TrustSection with pixel-style trust visuals

Three trust cards: zero-start progress bar, approval checkmarks,
governance guardrails. 8-bit accent style for visuals."
```

---

### Task 11: Assemble the landing page

**Files:**

- Modify: `apps/dashboard/src/app/(public)/page.tsx`

- [ ] **Step 1: Wire up all sections into the landing page**

```tsx
// apps/dashboard/src/app/(public)/page.tsx
import { HeroSection } from "@/components/landing/hero-section";
import { TimelineSection } from "@/components/landing/timeline-section";
import { StatsSection } from "@/components/landing/stats-section";
import { TrustSection } from "@/components/landing/trust-section";

export default function LandingPage() {
  return (
    <>
      <HeroSection />
      <TimelineSection />
      <StatsSection />
      <TrustSection />
    </>
  );
}
```

- [ ] **Step 2: Build and verify**

Run:

```bash
cd apps/dashboard && npx pnpm@9.15.4 run build
```

Expected: Build succeeds. Landing page at `/` renders all sections.

- [ ] **Step 3: Run all tests**

Run:

```bash
npx pnpm@9.15.4 --filter @switchboard/dashboard test
```

Expected: All tests pass (existing + new landing page tests).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: assemble landing page from all sections

Wire HeroSection, TimelineSection, StatsSection, TrustSection
into the (public) landing page at /."
```

---

### Task 12: Visual polish and responsive tuning

**Files:**

- Modify: various landing components as needed

- [ ] **Step 1: Dev server visual check**

Start the dev server and visually check the landing page at all breakpoints:

```bash
cd apps/dashboard && npx pnpm@9.15.4 run dev
```

Open `http://localhost:3002` and check:

- Desktop (1440px): characters in a row, stats 3-column, timeline centered
- Tablet (768px): everything still readable, characters smaller
- Mobile (375px): everything stacks, no horizontal overflow

- [ ] **Step 2: Fix any spacing, alignment, or responsive issues found**

Adjust padding, gaps, font sizes, character sizes as needed. Common fixes:

- Hero characters may overflow on small screens — adjust gap and size
- Timeline card may need horizontal padding on mobile
- Footer may need to stack on mobile

- [ ] **Step 3: Run all tests one final time**

Run:

```bash
npx pnpm@9.15.4 --filter @switchboard/dashboard test
```

Expected: All pass.

- [ ] **Step 4: Run full project typecheck and lint**

Run:

```bash
npx pnpm@9.15.4 typecheck && npx pnpm@9.15.4 lint
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "fix: landing page responsive polish and alignment tuning"
```
