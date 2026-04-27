# Public Site Visual Uplift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the public marketing site feel alive — humanist font (DM Sans), scroll-triggered fade-rise animations, richer card hover depth, and a 3-card hero stack that signals marketplace.

**Architecture:** Four independent changes applied in sequence: (1) font swap in root layout, (2) a `<FadeIn>` wrapper component built on the existing `useScrollReveal` hook applied to all public sections, (3) hover state enrichment on cards and nav CTA, (4) a new `HeroCardCluster` client component replacing the single hero card.

**Tech Stack:** Next.js 15 App Router, `next/font/google` (DM Sans), native `IntersectionObserver` via existing `useScrollReveal` hook, React inline styles + `onMouseEnter`/`onMouseLeave` for hover, Vitest + Testing Library for tests.

---

## File Map

| File                                                                         | Action | Responsibility                                                            |
| ---------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------- |
| `apps/dashboard/src/app/layout.tsx`                                          | Modify | Swap `Instrument_Sans` → `DM_Sans`                                        |
| `apps/dashboard/src/components/ui/fade-in.tsx`                               | Create | `<FadeIn>` wrapper using `useScrollReveal`                                |
| `apps/dashboard/src/components/ui/__tests__/fade-in.test.tsx`                | Create | FadeIn tests                                                              |
| `apps/dashboard/src/app/(public)/page.tsx`                                   | Modify | Wrap sections in `<FadeIn>`, stagger grid children, pass 3 agents to hero |
| `apps/dashboard/src/components/landing/homepage-hero.tsx`                    | Modify | Accept `previewAgents[]`, delegate card cluster to new component          |
| `apps/dashboard/src/components/landing/hero-card-cluster.tsx`                | Create | Client component rendering 3-card stacked layout with hover fan           |
| `apps/dashboard/src/components/landing/__tests__/hero-card-cluster.test.tsx` | Create | Card cluster tests                                                        |
| `apps/dashboard/src/components/landing/agent-marketplace-card.tsx`           | Modify | Add `"use client"`, add box-shadow to existing hover handler              |
| `apps/dashboard/src/components/landing/landing-nav.tsx`                      | Modify | Enrich CTA pill hover (already a client component)                        |

---

## Task 1: Swap font to DM Sans

**Files:**

- Modify: `apps/dashboard/src/app/layout.tsx`

No automated test possible for a font swap — verify manually after the commit by opening `http://localhost:3002` and confirming the body text feels warmer/rounder than Instrument Sans.

- [ ] **Step 1: Update layout.tsx**

Replace the `Instrument_Sans` import and variable with `DM_Sans`:

```tsx
import type { Metadata } from "next";
import { Inter, DM_Sans, Space_Mono } from "next/font/google";
import "./globals.css";
import { QueryProvider } from "@/providers/query-provider";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Switchboard",
  description: "Your AI team runs the business. Stay in control, without the clutter.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${dmSans.variable} ${spaceMono.variable}`}
      suppressHydrationWarning
    >
      <body className={inter.className}>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/app/layout.tsx
git commit -m "feat(dashboard): swap display font to DM Sans"
```

---

## Task 2: Create `<FadeIn>` wrapper component

**Files:**

- Create: `apps/dashboard/src/components/ui/fade-in.tsx`
- Create: `apps/dashboard/src/components/ui/__tests__/fade-in.test.tsx`

The existing `useScrollReveal` hook at `apps/dashboard/src/hooks/use-scroll-reveal.ts` already implements `IntersectionObserver` with `threshold` and `once` options — use it directly rather than creating a new hook.

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/components/ui/__tests__/fade-in.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { FadeIn } from "../fade-in";

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    vi.fn().mockImplementation((callback) => ({
      observe: vi.fn((el) => {
        // Immediately fire as visible so we can test the visible state
        callback([{ isIntersecting: true, target: el }]);
      }),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    })),
  );
});

describe("FadeIn", () => {
  it("renders children", () => {
    const { getByText } = render(<FadeIn>hello</FadeIn>);
    expect(getByText("hello")).toBeInTheDocument();
  });

  it("applies visible styles when intersecting", () => {
    const { container } = render(<FadeIn>content</FadeIn>);
    const div = container.firstChild as HTMLElement;
    expect(div.style.opacity).toBe("1");
    expect(div.style.transform).toBe("translateY(0)");
  });

  it("forwards className to wrapper div", () => {
    const { container } = render(<FadeIn className="test-class">x</FadeIn>);
    expect((container.firstChild as HTMLElement).classList.contains("test-class")).toBe(true);
  });

  it("applies delay to transition", () => {
    const { container } = render(<FadeIn delay={120}>x</FadeIn>);
    const div = container.firstChild as HTMLElement;
    expect(div.style.transition).toContain("120ms");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/dashboard test src/components/ui/__tests__/fade-in.test.tsx
```

Expected: FAIL — `Cannot find module '../fade-in'`

- [ ] **Step 3: Implement `<FadeIn>`**

Create `apps/dashboard/src/components/ui/fade-in.tsx`:

```tsx
"use client";

import { useScrollReveal } from "@/hooks/use-scroll-reveal";

interface FadeInProps {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}

export function FadeIn({ children, delay = 0, className }: FadeInProps) {
  const { ref, isVisible } = useScrollReveal({ threshold: 0.15, once: true });

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? "translateY(0)" : "translateY(16px)",
        transition: `opacity 380ms ease-out ${delay}ms, transform 380ms ease-out ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/dashboard test src/components/ui/__tests__/fade-in.test.tsx
```

Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/ui/fade-in.tsx apps/dashboard/src/components/ui/__tests__/fade-in.test.tsx
git commit -m "feat(dashboard): add FadeIn wrapper component using useScrollReveal"
```

---

## Task 3: Apply `<FadeIn>` to public page sections

**Files:**

- Modify: `apps/dashboard/src/app/(public)/page.tsx`

Wrap each section's inner content in `<FadeIn>`. For grid children (problem cards, steps, agent cards), pass a staggered `delay` of `index * 60` ms.

- [ ] **Step 1: Add FadeIn import and wrap sections**

In `apps/dashboard/src/app/(public)/page.tsx`, add the import at the top:

```tsx
import { FadeIn } from "@/components/ui/fade-in";
```

Then update each section. The pattern is: wrap the inner `<div className="page-width">` content (not the `<section>` itself) in `<FadeIn>`. For grid children, pass `delay={index * 60}`.

**Problem → Solution strip** — replace the grid `{PROBLEMS.map(...)}` with:

```tsx
{
  PROBLEMS.map(({ problem, solution, description }, index) => (
    <FadeIn key={problem} delay={index * 60}>
      <div
        style={{
          background: "#F9F8F6",
          border: "1px solid #DDD9D3",
          borderRadius: "1rem",
          padding: "1.75rem",
        }}
      >
        {/* ...existing card content unchanged... */}
      </div>
    </FadeIn>
  ));
}
```

**How It Works strip** — wrap each step:

```tsx
{
  STEPS.map(({ n, title, desc }, index) => (
    <FadeIn key={n} delay={index * 60}>
      <div>{/* ...existing step content unchanged... */}</div>
    </FadeIn>
  ));
}
```

**Agent preview cards strip** — wrap each card:

```tsx
{previewWithStats.map(({ agent, stats }, index) => (
  <FadeIn key={agent.id} delay={index * 60}>
    <AgentMarketplaceCard ... />
  </FadeIn>
))}
```

**Trust progression strip** — wrap the heading block above the strip in `<FadeIn>` (no stagger needed, it's a single block):

```tsx
<FadeIn>
  <p ...>Pricing</p>
  <h2 ...>Starts free. Earns its way up.</h2>
  <p ...>You only pay...</p>
</FadeIn>
<FadeIn delay={120}>
  {/* trust strip + link */}
</FadeIn>
```

**Bottom CTA** — wrap the whole content in `<FadeIn>`:

```tsx
<FadeIn>
  <h2 ...>Ready to meet your team?</h2>
  <p ...>Join 200+...</p>
  <Link ...>Get early access</Link>
</FadeIn>
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/app/(public)/page.tsx
git commit -m "feat(dashboard): apply FadeIn scroll animations to public page sections"
```

---

## Task 4: Enrich AgentMarketplaceCard hover depth

**Files:**

- Modify: `apps/dashboard/src/components/landing/agent-marketplace-card.tsx`
- Modify: `apps/dashboard/src/components/landing/__tests__/agent-marketplace-card.test.tsx`

The component already uses `onMouseEnter`/`onMouseLeave` for hover but is missing `"use client"` and the box-shadow lift. Add both.

- [ ] **Step 1: Add `"use client"` and box-shadow**

Replace the entire `apps/dashboard/src/components/landing/agent-marketplace-card.tsx` with:

```tsx
"use client";

import Link from "next/link";
import { AgentMark, SLUG_TO_AGENT } from "@/components/character/agent-mark";
import type { AgentId } from "@/components/character/agent-mark";

interface AgentMarketplaceCardProps {
  name: string;
  slug: string;
  description: string;
  trustScore: number;
  autonomyLevel: string;
  stats: {
    totalTasks: number;
    approvalRate: number;
    lastActiveAt: string | null;
  };
  className?: string;
}

export function AgentMarketplaceCard({
  name,
  slug,
  description,
  trustScore,
  autonomyLevel,
  className,
}: AgentMarketplaceCardProps) {
  const agent: AgentId = SLUG_TO_AGENT[slug] ?? "alex";

  return (
    <div
      className={className}
      style={{
        background: "#F9F8F6",
        border: "1px solid #DDD9D3",
        borderRadius: "1rem",
        padding: "1.5rem",
        display: "flex",
        flexDirection: "column",
        transition: "border-color 220ms ease, transform 220ms ease, box-shadow 220ms ease",
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = "#C8C3BC";
        el.style.transform = "translateY(-2px)";
        el.style.boxShadow = "0 8px 24px rgba(26,23,20,0.08)";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = "#DDD9D3";
        el.style.transform = "translateY(0)";
        el.style.boxShadow = "none";
      }}
    >
      {/* Character mark + category */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
        <AgentMark agent={agent} size="sm" />
        <span
          style={{
            fontSize: "0.6875rem",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: "#9C958F",
          }}
        >
          {autonomyLevel}
        </span>
      </div>

      {/* Name */}
      <h3
        style={{
          fontWeight: 700,
          fontSize: "1.125rem",
          letterSpacing: "-0.015em",
          color: "#1A1714",
          margin: 0,
        }}
      >
        {name}
      </h3>

      {/* Description */}
      <p
        style={{
          marginTop: "0.5rem",
          fontSize: "0.875rem",
          lineHeight: 1.55,
          color: "#6B6560",
          flex: 1,
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {description}
      </p>

      {/* Trust score */}
      <div
        style={{
          marginTop: "1.25rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <div
            style={{
              width: "1.875rem",
              height: "1.875rem",
              borderRadius: "9999px",
              background: "rgba(160,120,80,0.1)",
              border: "1.5px solid rgba(160,120,80,0.38)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.6875rem",
              fontWeight: 700,
              color: "#A07850",
            }}
          >
            {trustScore}
          </div>
          <span style={{ fontSize: "0.75rem", color: "#9C958F" }}>trust score</span>
        </div>

        <Link
          href={`/agents/${slug}`}
          style={{
            fontSize: "0.8125rem",
            fontWeight: 600,
            color: "#1A1714",
            textDecoration: "none",
          }}
        >
          Learn more →
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run existing tests**

```bash
pnpm --filter @switchboard/dashboard test src/components/landing/__tests__/agent-marketplace-card.test.tsx
```

Expected: the existing snapshot/render tests pass. If any test references `Hire` or `bundleSlug` props that don't exist in the component, delete those specific test cases — they were aspirational and never matched the real component.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/landing/agent-marketplace-card.tsx apps/dashboard/src/components/landing/__tests__/agent-marketplace-card.test.tsx
git commit -m "feat(dashboard): add box-shadow hover depth to AgentMarketplaceCard"
```

---

## Task 5: Enrich nav CTA hover

**Files:**

- Modify: `apps/dashboard/src/components/landing/landing-nav.tsx`

`LandingNav` is already a client component. Add `onMouseEnter`/`onMouseLeave` to the "Get early access" pill in both desktop and mobile nav.

- [ ] **Step 1: Update desktop CTA pill**

Find the desktop "Get early access" `<Link>` (around line 124) and add mouse handlers:

```tsx
<Link
  href="/get-started"
  style={{
    fontFamily: "var(--font-display)",
    fontWeight: 600,
    fontSize: "0.875rem",
    background: "#1A1714",
    color: "#F5F3F0",
    borderRadius: "9999px",
    padding: "0.5rem 1.25rem",
    textDecoration: "none",
    whiteSpace: "nowrap",
    transition: "background 150ms ease",
  }}
  onMouseEnter={(e) => {
    (e.currentTarget as HTMLElement).style.background = "#2C2825";
  }}
  onMouseLeave={(e) => {
    (e.currentTarget as HTMLElement).style.background = "#1A1714";
  }}
>
  Get early access
</Link>
```

- [ ] **Step 2: Update mobile CTA pill**

Find the mobile "Get early access" `<Link>` (around line 267) and apply the same handlers:

```tsx
<Link
  href="/get-started"
  style={{
    fontFamily: "var(--font-display)",
    fontWeight: 600,
    fontSize: "0.9375rem",
    background: "#1A1714",
    color: "#F5F3F0",
    borderRadius: "9999px",
    padding: "0.75rem 1rem",
    textAlign: "center",
    textDecoration: "none",
    marginTop: "0.25rem",
    transition: "background 150ms ease",
  }}
  onMouseEnter={(e) => {
    (e.currentTarget as HTMLElement).style.background = "#2C2825";
  }}
  onMouseLeave={(e) => {
    (e.currentTarget as HTMLElement).style.background = "#1A1714";
  }}
>
  Get early access
</Link>
```

- [ ] **Step 3: Run existing nav tests**

```bash
pnpm --filter @switchboard/dashboard test src/components/landing/__tests__/landing-nav.test.tsx
```

Expected: PASS — 2 tests passing (these only test link presence, not hover behavior).

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/landing/landing-nav.tsx
git commit -m "feat(dashboard): enrich landing nav CTA hover state"
```

---

## Task 6: Create `HeroCardCluster` component

**Files:**

- Create: `apps/dashboard/src/components/landing/hero-card-cluster.tsx`
- Create: `apps/dashboard/src/components/landing/__tests__/hero-card-cluster.test.tsx`

This is a client component because it has hover state. It renders 3 mini agent cards in a stacked/fanned layout. The primary card is fully visible; the back cards peek out behind it.

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/components/landing/__tests__/hero-card-cluster.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HeroCardCluster } from "../hero-card-cluster";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/character/agent-mark", () => ({
  AgentMark: ({ agent }: { agent: string }) => <div data-testid={`mark-${agent}`} />,
  SLUG_TO_AGENT: {
    "speed-to-lead": "alex",
    "sales-closer": "morgan",
    "nurture-specialist": "jordan",
  },
}));

const agents = [
  {
    name: "Speed-to-Lead",
    slug: "speed-to-lead",
    description: "Qualifies leads fast.",
    trustScore: 84,
  },
  { name: "Sales Closer", slug: "sales-closer", description: "Books and closes.", trustScore: 76 },
  {
    name: "Nurture Specialist",
    slug: "nurture-specialist",
    description: "Keeps contacts warm.",
    trustScore: 62,
  },
];

describe("HeroCardCluster", () => {
  it("renders primary agent name", () => {
    render(<HeroCardCluster agents={agents} />);
    expect(screen.getByText("Speed-to-Lead")).toBeInTheDocument();
  });

  it("renders primary trust score", () => {
    render(<HeroCardCluster agents={agents} />);
    // Trust score appears in the primary card
    expect(screen.getByText("84")).toBeInTheDocument();
  });

  it("renders Learn more link for primary agent", () => {
    render(<HeroCardCluster agents={agents} />);
    const link = screen.getByRole("link", { name: /learn more/i });
    expect(link).toHaveAttribute("href", "/agents/speed-to-lead");
  });

  it("renders without crashing when fewer than 3 agents provided", () => {
    render(<HeroCardCluster agents={agents.slice(0, 1)} />);
    expect(screen.getByText("Speed-to-Lead")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/dashboard test src/components/landing/__tests__/hero-card-cluster.test.tsx
```

Expected: FAIL — `Cannot find module '../hero-card-cluster'`

- [ ] **Step 3: Implement `HeroCardCluster`**

Create `apps/dashboard/src/components/landing/hero-card-cluster.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { AgentMark, SLUG_TO_AGENT } from "@/components/character/agent-mark";
import type { AgentId } from "@/components/character/agent-mark";

interface PreviewAgent {
  name: string;
  slug: string;
  description: string;
  trustScore: number;
}

interface HeroCardClusterProps {
  agents: PreviewAgent[];
}

function MiniCard({
  agent,
  style,
  dimmed,
}: {
  agent: PreviewAgent;
  style?: React.CSSProperties;
  dimmed?: boolean;
}) {
  const agentId: AgentId = SLUG_TO_AGENT[agent.slug] ?? "alex";

  return (
    <div
      style={{
        width: "17rem",
        background: "#F9F8F6",
        border: "1px solid #C8C3BC",
        borderRadius: "1.25rem",
        padding: "1.5rem",
        ...style,
      }}
    >
      <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: "1rem" }}>
        <AgentMark agent={agentId} size="lg" />
      </div>
      <h3
        style={{
          fontSize: "1.125rem",
          fontWeight: 700,
          letterSpacing: "-0.015em",
          color: dimmed ? "#9C958F" : "#1A1714",
          margin: 0,
        }}
      >
        {agent.name}
      </h3>
      {!dimmed && (
        <>
          <p
            style={{
              marginTop: "0.5rem",
              fontSize: "0.8125rem",
              lineHeight: 1.55,
              color: "#6B6560",
            }}
          >
            {agent.description}
          </p>
          <div
            style={{
              marginTop: "1.25rem",
              display: "flex",
              alignItems: "center",
              gap: "0.625rem",
            }}
          >
            <div
              style={{
                width: "2rem",
                height: "2rem",
                borderRadius: "9999px",
                background: "rgba(160,120,80,0.1)",
                border: "1.5px solid rgba(160,120,80,0.38)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.75rem",
                fontWeight: 700,
                color: "#A07850",
              }}
            >
              {agent.trustScore}
            </div>
            <span style={{ fontSize: "0.8125rem", color: "#9C958F" }}>trust score</span>
          </div>
          <Link
            href={`/agents/${agent.slug}`}
            style={{
              display: "block",
              marginTop: "1.25rem",
              padding: "0.625rem 1rem",
              background: "#EDEAE5",
              border: "1px solid #DDD9D3",
              borderRadius: "9999px",
              fontSize: "0.8125rem",
              fontWeight: 600,
              color: "#1A1714",
              textAlign: "center",
              textDecoration: "none",
            }}
          >
            Learn more →
          </Link>
        </>
      )}
    </div>
  );
}

export function HeroCardCluster({ agents }: HeroCardClusterProps) {
  const [hovered, setHovered] = useState(false);
  const [primary, second, third] = agents;

  return (
    <div
      style={{ position: "relative", width: "22rem", overflow: "visible" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Back card — right */}
      {third && (
        <div
          className="hidden md:block"
          style={{
            position: "absolute",
            top: 0,
            left: "calc(50% - 8.5rem)",
            zIndex: 1,
            opacity: 0.7,
            transform: hovered
              ? "rotate(4deg) translate(3.5rem, 1.25rem)"
              : "rotate(3deg) translate(2.5rem, 1rem)",
            transition: "transform 300ms ease, opacity 300ms ease",
            pointerEvents: "none",
          }}
        >
          <MiniCard agent={third} dimmed />
        </div>
      )}

      {/* Back card — left */}
      {second && (
        <div
          className="hidden md:block"
          style={{
            position: "absolute",
            top: 0,
            left: "calc(50% - 8.5rem)",
            zIndex: 2,
            opacity: 0.85,
            transform: hovered
              ? "rotate(-3deg) translate(-3.5rem, 0.75rem)"
              : "rotate(-2deg) translate(-2.5rem, 0.5rem)",
            transition: "transform 300ms ease, opacity 300ms ease",
            pointerEvents: "none",
          }}
        >
          <MiniCard agent={second} dimmed />
        </div>
      )}

      {/* Primary card — foreground */}
      {primary && (
        <div
          style={{
            position: "relative",
            zIndex: 3,
            margin: "0 auto",
            transform: hovered ? "rotate(0deg)" : "rotate(1.5deg)",
            boxShadow: hovered
              ? "0 20px 56px rgba(26,23,20,0.13)"
              : "0 16px 48px rgba(26,23,20,0.10)",
            transition: "transform 300ms ease, box-shadow 300ms ease",
            borderRadius: "1.25rem",
          }}
        >
          <MiniCard agent={primary} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/dashboard test src/components/landing/__tests__/hero-card-cluster.test.tsx
```

Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/landing/hero-card-cluster.tsx apps/dashboard/src/components/landing/__tests__/hero-card-cluster.test.tsx
git commit -m "feat(dashboard): add HeroCardCluster component with 3-card stacked layout"
```

---

## Task 7: Wire HeroCardCluster into page and HomepageHero

**Files:**

- Modify: `apps/dashboard/src/app/(public)/page.tsx`
- Modify: `apps/dashboard/src/components/landing/homepage-hero.tsx`

- [ ] **Step 1: Update `HomepageHeroProps` and render cluster**

Replace the entire `apps/dashboard/src/components/landing/homepage-hero.tsx`. The left column content is wrapped in `<FadeIn>` so the hero text fades in on load (threshold 0 fires immediately for above-fold content):

```tsx
import Link from "next/link";
import { FadeIn } from "@/components/ui/fade-in";
import { HeroCardCluster } from "@/components/landing/hero-card-cluster";

interface PreviewAgent {
  name: string;
  description: string;
  trustScore: number;
  slug: string;
}

interface HomepageHeroProps {
  previewAgents: PreviewAgent[];
}

export function HomepageHero({ previewAgents }: HomepageHeroProps) {
  return (
    <section style={{ background: "#F5F3F0", minHeight: "92vh" }}>
      <div
        className="page-width"
        style={{
          display: "flex",
          alignItems: "center",
          minHeight: "92vh",
          paddingTop: "8rem",
          paddingBottom: "5rem",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: "3rem",
            alignItems: "center",
            width: "100%",
          }}
          className="md:grid-cols-[1fr_auto] md:gap-16 lg:gap-24"
        >
          {/* ── Left column ── */}
          <FadeIn>
            <div>
              <p
                style={{
                  marginBottom: "1.5rem",
                  fontSize: "0.6875rem",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: "#9C958F",
                }}
              >
                AI Agent Marketplace
              </p>

              <h1
                style={{
                  fontSize: "clamp(3rem, 5.5vw, 5.5rem)",
                  fontWeight: 700,
                  lineHeight: 1.02,
                  letterSpacing: "-0.028em",
                  color: "#1A1714",
                  margin: 0,
                }}
              >
                Your AI sales team.
                <br />
                Ready in minutes.
              </h1>

              <p
                style={{
                  marginTop: "1.5rem",
                  fontSize: "1.125rem",
                  lineHeight: 1.6,
                  color: "#6B6560",
                  maxWidth: "44ch",
                }}
              >
                Browse AI agents built for growth. Deploy to WhatsApp, Telegram, or your website.
                They qualify leads, book calls, and earn your trust over time.
              </p>

              <div
                style={{
                  marginTop: "2.5rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "1.5rem",
                  flexWrap: "wrap",
                }}
              >
                <Link
                  href="/get-started"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    background: "#1A1714",
                    color: "#F5F3F0",
                    borderRadius: "9999px",
                    padding: "0.875rem 1.75rem",
                    fontSize: "0.9375rem",
                    fontWeight: 600,
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                  }}
                >
                  Get early access
                </Link>
                <Link
                  href="/agents"
                  style={{
                    fontSize: "0.9375rem",
                    fontWeight: 600,
                    color: "#6B6560",
                    textDecoration: "none",
                  }}
                >
                  Browse agents →
                </Link>
              </div>

              <p style={{ marginTop: "2rem", fontSize: "0.8125rem", color: "#9C958F" }}>
                Join 200+ businesses on the early access list
              </p>
            </div>
          </FadeIn>

          {/* ── Right column: card cluster (desktop only) ── */}
          <div className="hidden md:flex" style={{ justifyContent: "flex-end" }}>
            <HeroCardCluster agents={previewAgents} />
          </div>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Update `page.tsx` to pass 3 agents to hero**

In `apps/dashboard/src/app/(public)/page.tsx`, replace the `alexAgent` extraction and `<HomepageHero>` call:

**Remove** these lines:

```tsx
const alexAgent = agents.find((a) => a.slug === "speed-to-lead") ?? null;
```

**Replace** the `<HomepageHero>` block:

```tsx
<HomepageHero
  previewAgent={
    alexAgent
      ? {
          name: alexAgent.name,
          description: alexAgent.description,
          trustScore: alexAgent.trustScore,
          slug: alexAgent.slug,
        }
      : null
  }
/>
```

**With:**

```tsx
<HomepageHero
  previewAgents={previewWithStats.map(({ agent }) => ({
    name: agent.name,
    description: agent.description,
    trustScore: agent.trustScore,
    slug: agent.slug,
  }))}
/>
```

Note: `previewWithStats` is already computed from `PREVIEW_SLUGS` above — no new data fetching needed.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: no errors.

- [ ] **Step 4: Run all landing tests**

```bash
pnpm --filter @switchboard/dashboard test src/components/landing/
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/(public)/page.tsx apps/dashboard/src/components/landing/homepage-hero.tsx
git commit -m "feat(dashboard): wire HeroCardCluster into hero — 3-agent marketplace stack"
```

---

## Task 8: Full test run and visual verify

- [ ] **Step 1: Run full dashboard test suite**

```bash
pnpm --filter @switchboard/dashboard test
```

Expected: all tests pass with no regressions.

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: no errors.

- [ ] **Step 3: Open browser and verify**

With the dev server running at `http://localhost:3002`, check:

- [ ] Font is noticeably warmer/rounder (DM Sans vs Instrument Sans)
- [ ] Page sections fade+rise in as you scroll down
- [ ] Grid items (problem cards, steps, agent cards) stagger left to right
- [ ] Agent marketplace cards lift on hover with shadow
- [ ] "Get early access" pill darkens slightly on hover (not just opacity)
- [ ] Hero shows 3 stacked cards on desktop, fans out on hover
- [ ] Hero shows single card only on mobile (back cards hidden)
- [ ] Primary hero card straightens on hover (rotate 1.5deg → 0)

- [ ] **Step 4: Final commit if any lint fixes needed**

```bash
pnpm --filter @switchboard/dashboard lint
```

Fix any lint issues, then commit with `fix(dashboard): lint` if needed.
