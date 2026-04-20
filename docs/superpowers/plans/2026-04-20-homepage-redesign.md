# Homepage Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Switchboard public homepage to sell the paid Alex booking agent to SMB service business owners through demonstrated outcomes — interactive conversation demo, before/after scenarios, scrollytelling, trust proof, and simplified pricing.

**Architecture:** The homepage is a Next.js page at `apps/dashboard/src/app/(public)/page.tsx` composed of section components under `apps/dashboard/src/components/landing/`. Each section is its own component. Interactive elements use Framer Motion for scroll-driven animations and `useScrollReveal` (existing hook) for fade-in reveals. The page is server-rendered with client components only where interactivity is needed (`"use client"` directive).

**Tech Stack:** Next.js 14, React, TypeScript, Tailwind CSS, Framer Motion (new dep), existing `useScrollReveal` hook, existing `AgentMark` character component, Vitest + React Testing Library for tests.

**Spec:** `docs/superpowers/specs/2026-04-20-homepage-redesign-design.md`

**Important codebase conventions:**

- Next.js uses **extensionless imports** — do NOT add `.js` extensions in dashboard code
- Use `@/` path alias for imports (resolves to `apps/dashboard/src/`)
- Existing pattern: inline `style={{}}` props are used heavily in landing components — follow this pattern for consistency
- All landing components live in `apps/dashboard/src/components/landing/`
- Tests go in `apps/dashboard/src/components/landing/__tests__/`
- Test setup: Vitest + jsdom + `@testing-library/react` + `@testing-library/jest-dom/vitest`
- Use `cn()` from `@/lib/utils` for conditional class merging
- The public layout at `apps/dashboard/src/app/(public)/layout.tsx` wraps all public pages with `LandingNav` and `LandingFooter`

---

## File Structure

### New Files

| File                                                           | Responsibility                                                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `components/landing/conversation-demo.tsx`                     | Interactive phone mockup with scripted WhatsApp-style conversation. Client component.            |
| `components/landing/before-after-section.tsx`                  | Dark section with 3 before/after scenario strips. Client component (scroll reveal).              |
| `components/landing/before-after-strip.tsx`                    | Single before → after scenario row with staggered fade-in. Client component.                     |
| `components/landing/scrollytelling-section.tsx`                | Sticky phone + 3 scrolling text steps. Client component (Intersection Observer + Framer Motion). |
| `components/landing/phone-screen-choose.tsx`                   | Phone screen content: agent selector (Step 1). Server component.                                 |
| `components/landing/phone-screen-connect.tsx`                  | Phone screen content: channel picker (Step 2). Server component.                                 |
| `components/landing/phone-screen-trust.tsx`                    | Phone screen content: approval prompt (Step 3). Server component.                                |
| `components/landing/proof-bar.tsx`                             | Horizontal 4-metric strip with amber icons. Server component.                                    |
| `components/landing/trust-cards.tsx`                           | 3 capability proof cards with mini visuals. Server component.                                    |
| `components/landing/pricing-section.tsx`                       | Pricing headline + Alex card + expansion link. Server component.                                 |
| `components/landing/faq-accordion.tsx`                         | Expand/collapse FAQ list. Client component.                                                      |
| `components/landing/final-cta.tsx`                             | Dark section with amber CTA button. Server component.                                            |
| `components/landing/__tests__/conversation-demo.test.tsx`      | Tests for conversation demo state machine.                                                       |
| `components/landing/__tests__/before-after-strip.test.tsx`     | Tests for before/after strip rendering.                                                          |
| `components/landing/__tests__/faq-accordion.test.tsx`          | Tests for FAQ expand/collapse behavior.                                                          |
| `components/landing/__tests__/scrollytelling-section.test.tsx` | Tests for scrollytelling step rendering.                                                         |
| `components/landing/__tests__/pricing-section.test.tsx`        | Tests for pricing card content.                                                                  |

### Modified Files

| File                                                   | Changes                                                                |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| `apps/dashboard/package.json`                          | Add `framer-motion` dependency                                         |
| `components/landing/landing-nav.tsx`                   | Simplify nav links: remove "Agents", keep "How it works" and "Pricing" |
| `components/landing/landing-footer.tsx`                | Remove "Browse agents" from Product column                             |
| `components/landing/homepage-hero.tsx`                 | Full rewrite — split layout with conversation demo                     |
| `app/(public)/page.tsx`                                | Full rewrite — new section composition                                 |
| `app/(public)/layout.tsx`                              | Update metadata for new headline/description                           |
| `components/landing/__tests__/landing-nav.test.tsx`    | Update tests for simplified nav                                        |
| `components/landing/__tests__/landing-footer.test.tsx` | Update test for removed link                                           |

All paths below are relative to `apps/dashboard/src/` unless otherwise noted.

---

## Task 1: Install Framer Motion

**Files:**

- Modify: `apps/dashboard/package.json`

- [ ] **Step 1: Install framer-motion**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 add framer-motion --filter @switchboard/dashboard
```

- [ ] **Step 2: Verify installation**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 ls framer-motion --filter @switchboard/dashboard
```

Expected: `framer-motion` listed with a version number.

- [ ] **Step 3: Commit**

```bash
cd /Users/jasonljc/switchboard && git add apps/dashboard/package.json pnpm-lock.yaml && git commit -m "$(cat <<'EOF'
chore: add framer-motion dependency for homepage animations
EOF
)"
```

---

## Task 2: Simplify LandingNav

**Files:**

- Modify: `components/landing/landing-nav.tsx`
- Test: `components/landing/__tests__/landing-nav.test.tsx`

- [ ] **Step 1: Write the failing test**

Replace the contents of `components/landing/__tests__/landing-nav.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LandingNav } from "../landing-nav";

describe("LandingNav", () => {
  it("renders wordmark", () => {
    render(<LandingNav isAuthenticated={false} />);
    expect(screen.getByText("Switchboard")).toBeInTheDocument();
  });

  it("shows How it works and Pricing links", () => {
    render(<LandingNav isAuthenticated={false} />);
    expect(screen.getByRole("link", { name: /how it works/i })).toHaveAttribute(
      "href",
      "/how-it-works",
    );
    expect(screen.getByRole("link", { name: /pricing/i })).toHaveAttribute("href", "/pricing");
  });

  it("does not show Agents link", () => {
    render(<LandingNav isAuthenticated={false} />);
    expect(screen.queryByRole("link", { name: /^agents$/i })).not.toBeInTheDocument();
  });

  it("shows sign in when not authenticated", () => {
    render(<LandingNav isAuthenticated={false} />);
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/login");
  });

  it("shows dashboard link when authenticated", () => {
    render(<LandingNav isAuthenticated={true} />);
    expect(screen.getByRole("link", { name: /dashboard/i })).toBeInTheDocument();
  });

  it("shows Get started CTA", () => {
    render(<LandingNav isAuthenticated={false} />);
    expect(screen.getByRole("link", { name: /get started/i })).toHaveAttribute(
      "href",
      "/get-started",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify the "Agents" test fails**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard test -- --run components/landing/__tests__/landing-nav.test.tsx
```

Expected: The "does not show Agents link" test FAILS because the current nav still has an "Agents" link.

- [ ] **Step 3: Update LandingNav to remove Agents link**

In `components/landing/landing-nav.tsx`, change the `NAV_LINKS` array from:

```tsx
const NAV_LINKS = [
  { href: "/agents", label: "Agents" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
];
```

To:

```tsx
const NAV_LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
];
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard test -- --run components/landing/__tests__/landing-nav.test.tsx
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonljc/switchboard && git add apps/dashboard/src/components/landing/landing-nav.tsx apps/dashboard/src/components/landing/__tests__/landing-nav.test.tsx && git commit -m "$(cat <<'EOF'
feat: simplify landing nav for paid Alex wedge

Remove Agents link from primary navigation. The homepage now
sells Alex directly rather than linking to a marketplace catalog.
EOF
)"
```

---

## Task 3: Update LandingFooter

**Files:**

- Modify: `components/landing/landing-footer.tsx`

- [ ] **Step 1: Read existing footer test**

```bash
cd /Users/jasonljc/switchboard && cat apps/dashboard/src/components/landing/__tests__/landing-footer.test.tsx
```

- [ ] **Step 2: Update footer — remove "Browse agents" link**

In `components/landing/landing-footer.tsx`, change the Product links array from:

```tsx
{[
  { href: "/agents", label: "Browse agents" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/get-started", label: "Get early access" },
].map(({ href, label }) => (
```

To:

```tsx
{[
  { href: "/how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/get-started", label: "Get started" },
].map(({ href, label }) => (
```

- [ ] **Step 3: Run footer tests**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard test -- --run components/landing/__tests__/landing-footer.test.tsx
```

Expected: PASS (update test if it asserts on "Browse agents" — remove that assertion).

- [ ] **Step 4: Commit**

```bash
cd /Users/jasonljc/switchboard && git add apps/dashboard/src/components/landing/landing-footer.tsx apps/dashboard/src/components/landing/__tests__/landing-footer.test.tsx && git commit -m "$(cat <<'EOF'
feat: update footer links for Alex wedge positioning
EOF
)"
```

---

## Task 4: Interactive Conversation Demo

**Files:**

- Create: `components/landing/conversation-demo.tsx`
- Test: `components/landing/__tests__/conversation-demo.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `components/landing/__tests__/conversation-demo.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConversationDemo } from "../conversation-demo";

vi.useFakeTimers();

describe("ConversationDemo", () => {
  beforeEach(() => {
    vi.clearAllTimers();
  });

  it("renders the phone frame with header", () => {
    render(<ConversationDemo />);
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByText("Speed-to-Lead")).toBeInTheDocument();
    expect(screen.getByText("Online")).toBeInTheDocument();
  });

  it("shows the initial customer message", () => {
    render(<ConversationDemo />);
    expect(screen.getByText(/I saw your ad for teeth whitening/i)).toBeInTheDocument();
  });

  it("shows text input with placeholder", () => {
    render(<ConversationDemo />);
    expect(screen.getByPlaceholderText("Type a message...")).toBeInTheDocument();
  });

  it("auto-plays conversation after 3 seconds", () => {
    render(<ConversationDemo />);
    expect(screen.queryByText(/Great timing/i)).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3000 + 1200);
    });

    expect(screen.getByText(/Great timing/i)).toBeInTheDocument();
  });

  it("shows result line after conversation completes", () => {
    render(<ConversationDemo />);

    act(() => {
      vi.advanceTimersByTime(15000);
    });

    expect(screen.getByText(/This conversation took 47 seconds/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard test -- --run components/landing/__tests__/conversation-demo.test.tsx
```

Expected: FAIL — `ConversationDemo` module not found.

- [ ] **Step 3: Create the ConversationDemo component**

Create `components/landing/conversation-demo.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Message {
  sender: "customer" | "alex";
  text: string;
}

const SCRIPT: { sender: "customer" | "alex"; text: string; delay: number }[] = [
  {
    sender: "alex",
    text: "Hi! Great timing — we're running a whitening special this month. Have you done whitening before, or would this be your first time?",
    delay: 1200,
  },
  { sender: "customer", text: "No, first time", delay: 1500 },
  {
    sender: "alex",
    text: "Perfect! Our first-timer package is $199 (normally $299). Want me to book you a free 15-min consultation this week?",
    delay: 1000,
  },
  { sender: "customer", text: "Yes please, Thursday works", delay: 1200 },
  {
    sender: "alex",
    text: "I can lock in Thursday at 2pm for you. You'll get a confirmation on WhatsApp shortly.",
    delay: 800,
  },
];

type DemoState = "idle" | "playing" | "complete";

export function ConversationDemo() {
  const [messages, setMessages] = useState<Message[]>([
    {
      sender: "customer",
      text: "Hi, I saw your ad for teeth whitening. How much is it?",
    },
  ]);
  const [state, setState] = useState<DemoState>("idle");
  const [showTyping, setShowTyping] = useState(false);
  const [scriptIndex, setScriptIndex] = useState(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const playNext = useCallback(() => {
    if (scriptIndex >= SCRIPT.length) {
      setState("complete");
      return;
    }

    const step = SCRIPT[scriptIndex];

    if (step.sender === "alex") {
      setShowTyping(true);
      timeoutRef.current = setTimeout(() => {
        setShowTyping(false);
        setMessages((prev) => [...prev, { sender: step.sender, text: step.text }]);
        setScriptIndex((i) => i + 1);
      }, step.delay);
    } else {
      timeoutRef.current = setTimeout(() => {
        setMessages((prev) => [...prev, { sender: step.sender, text: step.text }]);
        setScriptIndex((i) => i + 1);
      }, step.delay);
    }
  }, [scriptIndex]);

  useEffect(() => {
    if (state === "playing") {
      playNext();
    }
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [state, scriptIndex, playNext]);

  useEffect(() => {
    if (state !== "idle") return;
    const autoStart = setTimeout(() => {
      setState("playing");
    }, 3000);
    return () => clearTimeout(autoStart);
  }, [state]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, showTyping]);

  const handleInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const input = e.currentTarget;
    const value = input.value.trim();
    if (!value) return;
    input.value = "";

    setMessages((prev) => [...prev, { sender: "customer", text: value }]);

    if (state === "idle") {
      setState("playing");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      {/* Phone frame */}
      <div
        style={{
          width: "100%",
          maxWidth: "340px",
          background: "#FFFFFF",
          borderRadius: "2rem",
          border: "1px solid #DDD9D3",
          boxShadow: "0 8px 32px rgba(26,23,20,0.08)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.625rem",
            padding: "0.875rem 1rem",
            borderBottom: "1px solid #EDEAE5",
            background: "#F9F8F6",
          }}
        >
          <div
            style={{
              width: "2rem",
              height: "2rem",
              borderRadius: "9999px",
              background: "#EDEAE5",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.75rem",
              fontWeight: 700,
              color: "#6B6560",
            }}
          >
            A
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
              <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "#1A1714" }}>Alex</span>
              <span style={{ fontSize: "0.75rem", color: "#9C958F" }}>Speed-to-Lead</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
              <div
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "9999px",
                  background: "#4CAF50",
                }}
              />
              <span style={{ fontSize: "0.625rem", color: "#4CAF50", fontWeight: 600 }}>
                Online
              </span>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div
          ref={containerRef}
          style={{
            height: "320px",
            overflowY: "auto",
            padding: "1rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.625rem",
          }}
        >
          {messages.map((msg, i) => (
            <div
              key={i}
              style={{
                alignSelf: msg.sender === "customer" ? "flex-end" : "flex-start",
                maxWidth: "85%",
                padding: "0.625rem 0.875rem",
                borderRadius:
                  msg.sender === "customer" ? "1rem 1rem 0.25rem 1rem" : "1rem 1rem 1rem 0.25rem",
                background: msg.sender === "customer" ? "#DCF8C6" : "#F5F3F0",
                fontSize: "0.8125rem",
                lineHeight: 1.5,
                color: "#1A1714",
                animation: "fade-in 0.3s ease-out forwards",
              }}
            >
              {msg.text}
            </div>
          ))}
          {showTyping && (
            <div
              style={{
                alignSelf: "flex-start",
                padding: "0.625rem 0.875rem",
                borderRadius: "1rem 1rem 1rem 0.25rem",
                background: "#F5F3F0",
                display: "flex",
                gap: "0.25rem",
                alignItems: "center",
              }}
            >
              {[0, 1, 2].map((dot) => (
                <div
                  key={dot}
                  style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "9999px",
                    background: "#9C958F",
                    animation: `typing-dot 1.2s ease-in-out ${dot * 0.15}s infinite`,
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Input */}
        <div
          style={{
            borderTop: "1px solid #EDEAE5",
            padding: "0.625rem 1rem",
            background: "#F9F8F6",
          }}
        >
          <input
            type="text"
            placeholder="Type a message..."
            onKeyDown={handleInput}
            style={{
              width: "100%",
              border: "1px solid #DDD9D3",
              borderRadius: "1.5rem",
              padding: "0.5rem 0.875rem",
              fontSize: "0.8125rem",
              background: "#FFFFFF",
              outline: "none",
              color: "#1A1714",
            }}
          />
        </div>
      </div>

      {/* Result line */}
      {state === "complete" && (
        <p
          style={{
            marginTop: "1rem",
            fontSize: "0.8125rem",
            fontWeight: 600,
            color: "#A07850",
            textAlign: "center",
            animation: "fade-in 0.5s ease-out forwards",
          }}
        >
          This conversation took 47 seconds. Your lead is booked.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add typing-dot keyframe to globals.css**

In `app/globals.css`, add inside the existing `@keyframes` section (before `@layer utilities`):

```css
@keyframes typing-dot {
  0%,
  60%,
  100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  30% {
    transform: translateY(-4px);
    opacity: 1;
  }
}
```

- [ ] **Step 5: Run tests**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard test -- --run components/landing/__tests__/conversation-demo.test.tsx
```

Expected: All 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/jasonljc/switchboard && git add apps/dashboard/src/components/landing/conversation-demo.tsx apps/dashboard/src/components/landing/__tests__/conversation-demo.test.tsx apps/dashboard/src/app/globals.css && git commit -m "$(cat <<'EOF'
feat: add interactive conversation demo component

WhatsApp-style phone mockup with scripted conversation sequence.
Auto-plays after 3s or on user input. Shows lead qualification
and booking flow in ~12 seconds.
EOF
)"
```

---

## Task 5: Rewrite Homepage Hero

**Files:**

- Modify: `components/landing/homepage-hero.tsx`

- [ ] **Step 1: Rewrite HomepageHero**

Replace the entire contents of `components/landing/homepage-hero.tsx`:

```tsx
"use client";

import Link from "next/link";
import { FadeIn } from "@/components/ui/fade-in";
import { ConversationDemo } from "@/components/landing/conversation-demo";

export function HomepageHero() {
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
          {/* Left column */}
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
                AI booking agents for service businesses
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
                Never miss
                <br />a lead again.
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
                Reply in seconds, qualify leads, and book appointments on WhatsApp, Telegram, or
                your website.
              </p>
              <p
                style={{
                  marginTop: "0.375rem",
                  fontSize: "0.9375rem",
                  fontWeight: 600,
                  color: "#6B6560",
                  fontStyle: "italic",
                }}
              >
                While you sleep.
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
                <a
                  href="#conversation-demo"
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
                  See Alex in action →
                </a>
                <Link
                  href="/how-it-works"
                  style={{
                    fontSize: "0.9375rem",
                    fontWeight: 600,
                    color: "#6B6560",
                    textDecoration: "none",
                  }}
                >
                  How it works
                </Link>
              </div>

              <p style={{ marginTop: "2rem", fontSize: "0.8125rem", color: "#9C958F" }}>
                Setup in minutes. Starts supervised. Stays in your control.
              </p>
            </div>
          </FadeIn>

          {/* Right column: conversation demo */}
          <div id="conversation-demo" className="flex justify-center md:justify-end">
            <ConversationDemo />
          </div>
        </div>
      </div>
    </section>
  );
}
```

Note: The `HomepageHero` no longer takes `previewAgents` props. It renders the `ConversationDemo` directly.

- [ ] **Step 2: Run existing hero tests (expect failures from changed interface)**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard test -- --run components/landing/__tests__/hero-card-cluster.test.tsx 2>&1 || true
```

Note: The `HeroCardCluster` tests will still pass since that component is unchanged — it's just no longer used by the hero. We will clean it up later.

- [ ] **Step 3: Commit**

```bash
cd /Users/jasonljc/switchboard && git add apps/dashboard/src/components/landing/homepage-hero.tsx && git commit -m "$(cat <<'EOF'
feat: rewrite homepage hero with conversation demo

Split layout: outcome-first headline on left, interactive
WhatsApp-style conversation demo on right. Replaces card
cluster with live product demonstration.
EOF
)"
```

---

## Task 6: Before/After Section

**Files:**

- Create: `components/landing/before-after-strip.tsx`
- Create: `components/landing/before-after-section.tsx`
- Test: `components/landing/__tests__/before-after-strip.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `components/landing/__tests__/before-after-strip.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BeforeAfterStrip } from "../before-after-strip";

describe("BeforeAfterStrip", () => {
  const props = {
    title: "The lead you lost",
    before: {
      visual: <div data-testid="before-visual">11:47 PM</div>,
      copy: "You replied the next morning. She'd already booked elsewhere.",
    },
    after: {
      visual: <div data-testid="after-visual">Booked</div>,
      copy: "Alex responded at 11:47 PM, qualified, and booked Tuesday 10am.",
      microDetail: "Responded in 12 sec",
      outcomeTag: "Booked in 90 seconds.",
    },
  };

  it("renders the scenario title", () => {
    render(<BeforeAfterStrip {...props} />);
    expect(screen.getByText("The lead you lost")).toBeInTheDocument();
  });

  it("renders before copy", () => {
    render(<BeforeAfterStrip {...props} />);
    expect(screen.getByText(/You replied the next morning/i)).toBeInTheDocument();
  });

  it("renders after copy and outcome tag", () => {
    render(<BeforeAfterStrip {...props} />);
    expect(screen.getByText(/Alex responded at 11:47 PM/i)).toBeInTheDocument();
    expect(screen.getByText("Booked in 90 seconds.")).toBeInTheDocument();
  });

  it("renders micro detail", () => {
    render(<BeforeAfterStrip {...props} />);
    expect(screen.getByText("Responded in 12 sec")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard test -- --run components/landing/__tests__/before-after-strip.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create BeforeAfterStrip component**

Create `components/landing/before-after-strip.tsx`:

```tsx
"use client";

import { FadeIn } from "@/components/ui/fade-in";

interface BeforeAfterStripProps {
  title: string;
  before: {
    visual: React.ReactNode;
    copy: string;
  };
  after: {
    visual: React.ReactNode;
    copy: string;
    microDetail: string;
    outcomeTag: string;
  };
}

export function BeforeAfterStrip({ title, before, after }: BeforeAfterStripProps) {
  return (
    <div style={{ paddingTop: "2.5rem", paddingBottom: "2.5rem" }}>
      <p
        style={{
          fontSize: "0.6875rem",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: "#7A736C",
          marginBottom: "1.25rem",
        }}
      >
        {title}
      </p>
      <div
        className="grid grid-cols-1 md:grid-cols-2"
        style={{ gap: "1.5rem", alignItems: "start" }}
      >
        {/* Before */}
        <FadeIn>
          <div
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "1rem",
              padding: "1.5rem",
              opacity: 0.7,
            }}
          >
            <div style={{ marginBottom: "1rem" }}>{before.visual}</div>
            <p style={{ fontSize: "0.875rem", lineHeight: 1.55, color: "#7A736C" }}>
              {before.copy}
            </p>
          </div>
        </FadeIn>

        {/* After */}
        <FadeIn delay={150}>
          <div
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: "1rem",
              padding: "1.5rem",
            }}
          >
            <div style={{ marginBottom: "1rem" }}>{after.visual}</div>
            <p style={{ fontSize: "0.875rem", lineHeight: 1.55, color: "#EDE8E1" }}>{after.copy}</p>
            <p
              style={{
                marginTop: "0.5rem",
                fontSize: "0.75rem",
                color: "#7A736C",
              }}
            >
              {after.microDetail}
            </p>
            <p
              style={{
                marginTop: "0.75rem",
                fontSize: "0.875rem",
                fontWeight: 700,
                color: "#A07850",
              }}
            >
              {after.outcomeTag}
            </p>
          </div>
        </FadeIn>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard test -- --run components/landing/__tests__/before-after-strip.test.tsx
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Create BeforeAfterSection component**

Create `components/landing/before-after-section.tsx`:

```tsx
import { BeforeAfterStrip } from "./before-after-strip";

function NotificationMockup({ name, time }: { name: string; time: string }) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.08)",
        borderRadius: "0.75rem",
        padding: "0.75rem 1rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <span style={{ fontSize: "0.8125rem", color: "#EDE8E1" }}>New message from {name}</span>
      <span style={{ fontSize: "0.75rem", color: "#7A736C" }}>{time}</span>
    </div>
  );
}

function ChatSnippet({ messages }: { messages: { sender: string; text: string; time: string }[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
      {messages.map((msg, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "0.5rem",
          }}
        >
          <span style={{ fontSize: "0.6875rem", color: "#7A736C", flexShrink: 0 }}>{msg.time}</span>
          <span style={{ fontSize: "0.8125rem", color: "#EDE8E1" }}>
            <span style={{ fontWeight: 600 }}>{msg.sender}:</span> {msg.text}
          </span>
        </div>
      ))}
    </div>
  );
}

function ThreadMockup() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
      <div
        style={{
          background: "rgba(255,255,255,0.06)",
          borderRadius: "0.5rem",
          padding: "0.5rem 0.75rem",
          fontSize: "0.8125rem",
          color: "#7A736C",
        }}
      >
        <span style={{ fontWeight: 600 }}>You:</span> Here&rsquo;s your quote — $850 for the full
        package.
      </div>
      <div
        style={{
          fontSize: "0.6875rem",
          color: "#5A5550",
          paddingLeft: "0.75rem",
          fontStyle: "italic",
        }}
      >
        6 days ago · no reply
      </div>
    </div>
  );
}

function FollowUpTimeline() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
      {[
        { day: "Day 1", text: "Quote sent", color: "#7A736C" },
        { day: "Day 3", text: "Alex followed up", color: "#EDE8E1" },
        { day: "Day 5", text: "James replied — booked", color: "#A07850" },
      ].map(({ day, text, color }) => (
        <div key={day} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.6875rem", fontWeight: 600, color: "#7A736C", width: "3rem" }}>
            {day}
          </span>
          <span style={{ fontSize: "0.8125rem", color }}>{text}</span>
        </div>
      ))}
    </div>
  );
}

function NotificationStack() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      {["Lisa", "Mark", "Priya", "Tom"].map((name) => (
        <div
          key={name}
          style={{
            background: "rgba(255,255,255,0.06)",
            borderRadius: "0.5rem",
            padding: "0.375rem 0.75rem",
            fontSize: "0.75rem",
            color: "#7A736C",
          }}
        >
          New lead: {name}
        </div>
      ))}
    </div>
  );
}

function SaturdaySummary() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      {[
        { name: "Lisa", result: "Booked Mon 9am", color: "#A07850" },
        { name: "Mark", result: "Booked Tue 2pm", color: "#A07850" },
        { name: "Priya", result: "Tagged: not ready yet", color: "#7A736C" },
        { name: "Tom", result: "Filtered: spam", color: "#5A5550" },
      ].map(({ name, result, color }) => (
        <div
          key={name}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0.375rem 0.75rem",
            background: "rgba(255,255,255,0.06)",
            borderRadius: "0.5rem",
          }}
        >
          <span style={{ fontSize: "0.8125rem", color: "#EDE8E1" }}>{name}</span>
          <span style={{ fontSize: "0.75rem", fontWeight: 600, color }}>{result}</span>
        </div>
      ))}
    </div>
  );
}

export function BeforeAfterSection() {
  return (
    <section style={{ background: "#1E1C1A", paddingTop: "5rem", paddingBottom: "5rem" }}>
      <div className="page-width">
        <p
          style={{
            fontSize: "clamp(1.4rem, 2.5vw, 1.8rem)",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: "#EDE8E1",
            marginBottom: "1rem",
          }}
        >
          What changes when leads get answered in seconds, not hours.
        </p>

        <div
          style={{
            width: "100%",
            height: "1px",
            background: "rgba(255,255,255,0.08)",
            marginBottom: "1rem",
          }}
        />

        <BeforeAfterStrip
          title="The lead you lost"
          before={{
            visual: <NotificationMockup name="Sarah" time="11:47 PM" />,
            copy: "You replied the next morning. She'd already booked elsewhere.",
          }}
          after={{
            visual: (
              <ChatSnippet
                messages={[
                  {
                    sender: "Sarah",
                    text: "Hi, do you have availability this week?",
                    time: "11:47 PM",
                  },
                  {
                    sender: "Alex",
                    text: "Yes! I have Tuesday at 10am or Thursday at 3pm.",
                    time: "11:47 PM",
                  },
                ]}
              />
            ),
            copy: "Alex responded at 11:47 PM, qualified the lead, and booked Tuesday 10am.",
            microDetail: "Responded in 12 sec",
            outcomeTag: "Booked in 90 seconds.",
          }}
        />

        <div
          style={{
            width: "100%",
            height: "1px",
            background: "rgba(255,255,255,0.06)",
          }}
        />

        <BeforeAfterStrip
          title="The follow-up that never happened"
          before={{
            visual: <ThreadMockup />,
            copy: "Interested lead. Quote sent. Then silence.",
          }}
          after={{
            visual: <FollowUpTimeline />,
            copy: "Alex followed up automatically on day 2 and day 5. James replied and booked.",
            microDetail: "Followed up on day 2 and day 5",
            outcomeTag: "Booking recovered.",
          }}
        />

        <div
          style={{
            width: "100%",
            height: "1px",
            background: "rgba(255,255,255,0.06)",
          }}
        />

        <BeforeAfterStrip
          title="The weekend you worked"
          before={{
            visual: <NotificationStack />,
            copy: "You were with family. Your leads were waiting.",
          }}
          after={{
            visual: <SaturdaySummary />,
            copy: "Alex handled all 4: 2 booked, 1 tagged for later, 1 filtered out.",
            microDetail: "4 leads handled on Saturday",
            outcomeTag: "Handled without you.",
          }}
        />
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Commit**

```bash
cd /Users/jasonljc/switchboard && git add apps/dashboard/src/components/landing/before-after-strip.tsx apps/dashboard/src/components/landing/before-after-section.tsx apps/dashboard/src/components/landing/__tests__/before-after-strip.test.tsx && git commit -m "$(cat <<'EOF'
feat: add before/after scenarios section

Dark section with 3 pain-point scenarios showing before (missed
lead, dropped follow-up, weekend overload) and after (instant
response, automatic follow-up, hands-free handling).
EOF
)"
```

---

## Task 7: Scrollytelling How It Works

**Files:**

- Create: `components/landing/phone-screen-choose.tsx`
- Create: `components/landing/phone-screen-connect.tsx`
- Create: `components/landing/phone-screen-trust.tsx`
- Create: `components/landing/scrollytelling-section.tsx`
- Test: `components/landing/__tests__/scrollytelling-section.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `components/landing/__tests__/scrollytelling-section.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScrollytellingSection } from "../scrollytelling-section";

describe("ScrollytellingSection", () => {
  it("renders all three step headings", () => {
    render(<ScrollytellingSection />);
    expect(screen.getByText("Start with the outcome you need.")).toBeInTheDocument();
    expect(
      screen.getByText("Go live on the channels your customers already use."),
    ).toBeInTheDocument();
    expect(screen.getByText("Starts supervised. Earns speed.")).toBeInTheDocument();
  });

  it("renders step labels", () => {
    render(<ScrollytellingSection />);
    expect(screen.getByText("01 — Choose")).toBeInTheDocument();
    expect(screen.getByText("02 — Connect")).toBeInTheDocument();
    expect(screen.getByText("03 — Trust")).toBeInTheDocument();
  });

  it("renders the closing line", () => {
    render(<ScrollytellingSection />);
    expect(screen.getByText(/From setup to first live lead conversation/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard test -- --run components/landing/__tests__/scrollytelling-section.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create phone screen components**

Create `components/landing/phone-screen-choose.tsx`:

```tsx
import { AgentMark } from "@/components/character/agent-mark";

export function PhoneScreenChoose() {
  return (
    <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.625rem" }}>
      <p
        style={{
          fontSize: "0.6875rem",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "#9C958F",
          marginBottom: "0.25rem",
        }}
      >
        Choose your agent
      </p>
      {/* Alex — selected */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.75rem",
          background: "#F5F3F0",
          border: "1.5px solid #A07850",
          borderRadius: "0.75rem",
        }}
      >
        <AgentMark agent="alex" size="sm" />
        <div>
          <p style={{ fontSize: "0.8125rem", fontWeight: 700, color: "#1A1714" }}>Alex</p>
          <p style={{ fontSize: "0.6875rem", color: "#6B6560" }}>Lead qualification & booking</p>
        </div>
        <span
          style={{
            marginLeft: "auto",
            fontSize: "0.625rem",
            fontWeight: 600,
            color: "#A07850",
            background: "rgba(160,120,80,0.1)",
            borderRadius: "9999px",
            padding: "0.2rem 0.5rem",
          }}
        >
          Selected
        </span>
      </div>
      {/* Riley — coming soon */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.75rem",
          background: "#F9F8F6",
          border: "1px solid #EDEAE5",
          borderRadius: "0.75rem",
          opacity: 0.5,
        }}
      >
        <AgentMark agent="riley" size="sm" />
        <div>
          <p style={{ fontSize: "0.8125rem", fontWeight: 700, color: "#1A1714" }}>Riley</p>
          <p style={{ fontSize: "0.6875rem", color: "#9C958F" }}>Coming soon</p>
        </div>
      </div>
      {/* Jordan — coming soon */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.75rem",
          background: "#F9F8F6",
          border: "1px solid #EDEAE5",
          borderRadius: "0.75rem",
          opacity: 0.5,
        }}
      >
        <AgentMark agent="jordan" size="sm" />
        <div>
          <p style={{ fontSize: "0.8125rem", fontWeight: 700, color: "#1A1714" }}>Jordan</p>
          <p style={{ fontSize: "0.6875rem", color: "#9C958F" }}>Coming soon</p>
        </div>
      </div>
    </div>
  );
}
```

Create `components/landing/phone-screen-connect.tsx`:

```tsx
export function PhoneScreenConnect() {
  const channels = [
    { name: "WhatsApp", connected: true },
    { name: "Telegram", connected: false },
    { name: "Web widget", connected: false },
  ];

  return (
    <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.625rem" }}>
      <p
        style={{
          fontSize: "0.6875rem",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "#9C958F",
          marginBottom: "0.25rem",
        }}
      >
        Connect a channel
      </p>
      {channels.map(({ name, connected }) => (
        <div
          key={name}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0.75rem 1rem",
            background: connected ? "#F5F3F0" : "#F9F8F6",
            border: `1px solid ${connected ? "#A07850" : "#EDEAE5"}`,
            borderRadius: "0.75rem",
          }}
        >
          <span
            style={{
              fontSize: "0.8125rem",
              fontWeight: 600,
              color: "#1A1714",
            }}
          >
            {name}
          </span>
          {connected ? (
            <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
              <div
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "9999px",
                  background: "#4CAF50",
                }}
              />
              <span style={{ fontSize: "0.6875rem", fontWeight: 600, color: "#4CAF50" }}>
                Connected
              </span>
            </div>
          ) : (
            <span style={{ fontSize: "0.6875rem", color: "#9C958F" }}>Connect →</span>
          )}
        </div>
      ))}
    </div>
  );
}
```

Create `components/landing/phone-screen-trust.tsx`:

```tsx
export function PhoneScreenTrust() {
  return (
    <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.625rem" }}>
      {/* Conversation context */}
      <div
        style={{
          background: "#F5F3F0",
          borderRadius: "0.75rem",
          padding: "0.75rem",
        }}
      >
        <p style={{ fontSize: "0.6875rem", color: "#9C958F", marginBottom: "0.25rem" }}>
          Latest conversation
        </p>
        <p style={{ fontSize: "0.8125rem", color: "#1A1714", lineHeight: 1.45 }}>
          Sarah asked about availability. Alex qualified her and found a match on Thursday.
        </p>
      </div>

      {/* Approval prompt */}
      <div
        style={{
          background: "#FFFFFF",
          border: "1.5px solid #DDD9D3",
          borderRadius: "0.75rem",
          padding: "1rem",
          boxShadow: "0 2px 8px rgba(26,23,20,0.06)",
        }}
      >
        <p
          style={{
            fontSize: "0.6875rem",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "#A07850",
            marginBottom: "0.5rem",
          }}
        >
          Approval required
        </p>
        <p style={{ fontSize: "0.8125rem", color: "#1A1714", lineHeight: 1.45 }}>
          Alex wants to book Sarah for Thursday 2pm.
        </p>
        <div
          style={{
            marginTop: "0.75rem",
            display: "flex",
            gap: "0.5rem",
          }}
        >
          <div
            style={{
              flex: 1,
              padding: "0.5rem",
              background: "#1A1714",
              color: "#F5F3F0",
              borderRadius: "0.5rem",
              fontSize: "0.75rem",
              fontWeight: 600,
              textAlign: "center",
            }}
          >
            Approve
          </div>
          <div
            style={{
              flex: 1,
              padding: "0.5rem",
              background: "#F5F3F0",
              border: "1px solid #DDD9D3",
              color: "#1A1714",
              borderRadius: "0.5rem",
              fontSize: "0.75rem",
              fontWeight: 600,
              textAlign: "center",
            }}
          >
            Edit
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create ScrollytellingSection component**

Create `components/landing/scrollytelling-section.tsx`:

```tsx
"use client";

import { useRef, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PhoneScreenChoose } from "./phone-screen-choose";
import { PhoneScreenConnect } from "./phone-screen-connect";
import { PhoneScreenTrust } from "./phone-screen-trust";

const STEPS = [
  {
    label: "01 — Choose",
    heading: "Start with the outcome you need.",
    body: "Lead qualification, appointment booking, or follow-up recovery. Pick the first workflow you want handled and deploy it in minutes.",
  },
  {
    label: "02 — Connect",
    heading: "Go live on the channels your customers already use.",
    body: "Connect WhatsApp, Telegram, or add a widget to your site. Once connected, your agent can start replying immediately.",
  },
  {
    label: "03 — Trust",
    heading: "Starts supervised. Earns speed.",
    body: "Every action begins with your approval. As your agent proves itself, you can review less and move faster — without giving up control.",
  },
];

const PHONE_SCREENS = [PhoneScreenChoose, PhoneScreenConnect, PhoneScreenTrust];

function PhoneFrame({ activeStep }: { activeStep: number }) {
  return (
    <div
      style={{
        width: "280px",
        background: "#FFFFFF",
        borderRadius: "2rem",
        border: "1px solid #DDD9D3",
        boxShadow: "0 8px 32px rgba(26,23,20,0.08)",
        overflow: "hidden",
      }}
    >
      {/* Phone header */}
      <div
        style={{
          padding: "0.75rem 1rem",
          borderBottom: "1px solid #EDEAE5",
          background: "#F9F8F6",
        }}
      >
        <p
          style={{ fontSize: "0.6875rem", fontWeight: 600, color: "#9C958F", textAlign: "center" }}
        >
          Switchboard
        </p>
      </div>

      {/* Screen content */}
      <div style={{ minHeight: "320px" }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={activeStep}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            {(() => {
              const Screen = PHONE_SCREENS[activeStep];
              return <Screen />;
            })()}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

export function ScrollytellingSection() {
  const [activeStep, setActiveStep] = useState(0);
  const stepRefs = useRef<(HTMLDivElement | null)[]>([]);
  const prefersReducedMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (prefersReducedMotion) return;

    const observers: IntersectionObserver[] = [];

    stepRefs.current.forEach((el, index) => {
      if (!el) return;
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setActiveStep(index);
          }
        },
        { threshold: 0.6 },
      );
      observer.observe(el);
      observers.push(observer);
    });

    return () => observers.forEach((o) => o.disconnect());
  }, [prefersReducedMotion]);

  return (
    <section style={{ background: "#F5F3F0", paddingTop: "5rem", paddingBottom: "5rem" }}>
      <div className="page-width">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto]" style={{ gap: "4rem" }}>
          {/* Left: scrolling steps */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8rem" }}>
            {STEPS.map((step, i) => (
              <div key={step.label}>
                <div
                  ref={(el) => {
                    stepRefs.current[i] = el;
                  }}
                  style={{ minHeight: "16rem" }}
                >
                  <p
                    style={{
                      fontSize: "0.6875rem",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      color: "#A07850",
                      marginBottom: "1rem",
                    }}
                  >
                    {step.label}
                  </p>
                  <h3
                    style={{
                      fontSize: "clamp(1.6rem, 2.5vw, 2.2rem)",
                      fontWeight: 700,
                      letterSpacing: "-0.02em",
                      color: "#1A1714",
                      marginBottom: "1rem",
                    }}
                  >
                    {step.heading}
                  </h3>
                  <p
                    style={{
                      fontSize: "1rem",
                      lineHeight: 1.65,
                      color: "#6B6560",
                      maxWidth: "40ch",
                    }}
                  >
                    {step.body}
                  </p>
                </div>

                {/* Mobile: inline phone */}
                <div
                  className="lg:hidden"
                  style={{ marginTop: "2rem", display: "flex", justifyContent: "center" }}
                >
                  <PhoneFrame activeStep={i} />
                </div>
              </div>
            ))}
          </div>

          {/* Right: sticky phone (desktop only) */}
          <div
            className="hidden lg:block"
            style={{
              position: "sticky",
              top: "8rem",
              alignSelf: "start",
            }}
          >
            <PhoneFrame activeStep={activeStep} />
          </div>
        </div>

        {/* Closing line */}
        <p
          style={{
            marginTop: "4rem",
            fontSize: "1rem",
            fontWeight: 600,
            color: "#6B6560",
            textAlign: "center",
          }}
        >
          From setup to first live lead conversation: minutes, not days.
        </p>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run tests**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard test -- --run components/landing/__tests__/scrollytelling-section.test.tsx
```

Expected: All 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/jasonljc/switchboard && git add apps/dashboard/src/components/landing/phone-screen-choose.tsx apps/dashboard/src/components/landing/phone-screen-connect.tsx apps/dashboard/src/components/landing/phone-screen-trust.tsx apps/dashboard/src/components/landing/scrollytelling-section.tsx apps/dashboard/src/components/landing/__tests__/scrollytelling-section.test.tsx && git commit -m "$(cat <<'EOF'
feat: add scrollytelling how-it-works section

Sticky phone mockup on desktop that transitions between three
screens (choose, connect, trust) as text steps scroll. Uses
Intersection Observer + Framer Motion crossfade.
EOF
)"
```

---

## Task 8: Trust & Proof Section

**Files:**

- Create: `components/landing/proof-bar.tsx`
- Create: `components/landing/trust-cards.tsx`

- [ ] **Step 1: Create ProofBar component**

Create `components/landing/proof-bar.tsx`:

```tsx
import { FadeIn } from "@/components/ui/fade-in";

const PROOF_POINTS = [
  {
    metric: "Seconds",
    label: "Designed for instant first response",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="8" stroke="#A07850" strokeWidth="1.5" />
        <line
          x1="10"
          y1="5"
          x2="10"
          y2="10"
          stroke="#A07850"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <line
          x1="10"
          y1="10"
          x2="14"
          y2="12"
          stroke="#A07850"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    metric: "24/7",
    label: "Lead coverage across your channels",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="4" fill="#A07850" opacity="0.3" />
        <circle cx="10" cy="10" r="8" stroke="#A07850" strokeWidth="1.5" opacity="0.6" />
        <circle cx="10" cy="10" r="4" stroke="#A07850" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    metric: "Approval-first",
    label: "Every action can start supervised",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path
          d="M10 2L12.5 7H17.5L13.5 10.5L15 16L10 12.5L5 16L6.5 10.5L2.5 7H7.5L10 2Z"
          stroke="#A07850"
          strokeWidth="1.5"
          strokeLinejoin="round"
          fill="none"
        />
        <path
          d="M7 10l2 2 4-4"
          stroke="#A07850"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    metric: "WhatsApp · Telegram · Web",
    label: "Deploy where leads already come in",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="3" y="5" width="14" height="10" rx="2" stroke="#A07850" strokeWidth="1.5" />
        <path d="M3 8h14" stroke="#A07850" strokeWidth="1.5" />
      </svg>
    ),
  },
];

export function ProofBar() {
  return (
    <FadeIn>
      <div
        className="grid grid-cols-2 md:grid-cols-4"
        style={{ gap: "1.5rem", paddingTop: "3rem", paddingBottom: "3rem" }}
      >
        {PROOF_POINTS.map(({ metric, label, icon }) => (
          <div key={metric} style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
            <div
              style={{
                width: "2.5rem",
                height: "2.5rem",
                borderRadius: "0.75rem",
                background: "rgba(160,120,80,0.08)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {icon}
            </div>
            <div>
              <p style={{ fontSize: "0.875rem", fontWeight: 700, color: "#1A1714" }}>{metric}</p>
              <p style={{ fontSize: "0.75rem", color: "#6B6560", lineHeight: 1.45 }}>{label}</p>
            </div>
          </div>
        ))}
      </div>
    </FadeIn>
  );
}
```

- [ ] **Step 2: Create TrustCards component**

Create `components/landing/trust-cards.tsx`:

```tsx
import { FadeIn } from "@/components/ui/fade-in";

function TimestampVisual() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span style={{ fontSize: "0.6875rem", color: "#9C958F" }}>11:47 PM</span>
        <span style={{ fontSize: "0.8125rem", color: "#6B6560" }}>
          Customer: &ldquo;Hi, are you available?&rdquo;
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span style={{ fontSize: "0.6875rem", color: "#A07850", fontWeight: 600 }}>11:47 PM</span>
        <span style={{ fontSize: "0.8125rem", color: "#1A1714", fontWeight: 600 }}>
          Alex: &ldquo;Hi! Yes — let me check for you.&rdquo;
        </span>
      </div>
    </div>
  );
}

function TimelineVisual() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
      {[
        { label: "Day 1", sublabel: "Quote sent", active: false },
        { label: "Day 3", sublabel: "Follow-up", active: false },
        { label: "Day 5", sublabel: "Booked", active: true },
      ].map(({ label, sublabel, active }, i) => (
        <div
          key={label}
          style={{ display: "flex", alignItems: "center", gap: "0.375rem", flex: 1 }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "0.125rem",
            }}
          >
            <div
              style={{
                width: "0.625rem",
                height: "0.625rem",
                borderRadius: "9999px",
                background: active ? "#A07850" : "#DDD9D3",
              }}
            />
            <span
              style={{
                fontSize: "0.5625rem",
                fontWeight: 600,
                color: active ? "#A07850" : "#9C958F",
              }}
            >
              {label}
            </span>
            <span style={{ fontSize: "0.5rem", color: "#9C958F" }}>{sublabel}</span>
          </div>
          {i < 2 && <div style={{ flex: 1, height: "1px", background: "#DDD9D3" }} />}
        </div>
      ))}
    </div>
  );
}

function ApprovalVisual() {
  return (
    <div
      style={{
        background: "#F5F3F0",
        borderRadius: "0.5rem",
        padding: "0.625rem 0.75rem",
        border: "1px solid #EDEAE5",
      }}
    >
      <p style={{ fontSize: "0.75rem", color: "#1A1714", marginBottom: "0.375rem" }}>
        Alex wants to send a booking confirmation to Sarah.
      </p>
      <div style={{ display: "flex", gap: "0.375rem" }}>
        <span
          style={{
            fontSize: "0.625rem",
            fontWeight: 600,
            background: "#1A1714",
            color: "#F5F3F0",
            borderRadius: "0.25rem",
            padding: "0.2rem 0.5rem",
          }}
        >
          Approve
        </span>
        <span
          style={{
            fontSize: "0.625rem",
            fontWeight: 600,
            border: "1px solid #DDD9D3",
            color: "#1A1714",
            borderRadius: "0.25rem",
            padding: "0.2rem 0.5rem",
          }}
        >
          Edit
        </span>
      </div>
    </div>
  );
}

const CARDS = [
  {
    title: "Answers when you can't",
    copy: "After hours, weekends, or during busy periods — Alex keeps leads from sitting unanswered.",
    visual: <TimestampVisual />,
  },
  {
    title: "Follows up without dropping the ball",
    copy: "Quotes, reminders, and re-engagement happen on time instead of getting lost in the day.",
    visual: <TimelineVisual />,
  },
  {
    title: "Keeps you in control",
    copy: "Alex can start by asking before it books, tags, or follows up. You review less only when you want to.",
    visual: <ApprovalVisual />,
  },
];

export function TrustCards() {
  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-3" style={{ gap: "1rem" }}>
        {CARDS.map(({ title, copy, visual }, i) => (
          <FadeIn key={title} delay={i * 80}>
            <div
              style={{
                background: "#F9F8F6",
                border: "1px solid #DDD9D3",
                borderRadius: "1rem",
                padding: "1.5rem",
              }}
            >
              <div style={{ marginBottom: "1.25rem" }}>{visual}</div>
              <h3
                style={{
                  fontSize: "1.0625rem",
                  fontWeight: 700,
                  letterSpacing: "-0.01em",
                  color: "#1A1714",
                  marginBottom: "0.5rem",
                }}
              >
                {title}
              </h3>
              <p style={{ fontSize: "0.875rem", lineHeight: 1.55, color: "#6B6560" }}>{copy}</p>
            </div>
          </FadeIn>
        ))}
      </div>

      {/* Governance line */}
      <p
        style={{
          marginTop: "3rem",
          fontSize: "0.875rem",
          color: "#9C958F",
          textAlign: "center",
        }}
      >
        Built on governed AI. Every action audited. Every decision reviewable.
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/jasonljc/switchboard && git add apps/dashboard/src/components/landing/proof-bar.tsx apps/dashboard/src/components/landing/trust-cards.tsx && git commit -m "$(cat <<'EOF'
feat: add trust & proof section components

ProofBar with 4 honest capability metrics (seconds, 24/7,
approval-first, channels). TrustCards with mini visuals:
timestamp contrast, follow-up timeline, approval prompt.
EOF
)"
```

---

## Task 9: Pricing Section + FAQ Accordion

**Files:**

- Create: `components/landing/pricing-section.tsx`
- Create: `components/landing/faq-accordion.tsx`
- Test: `components/landing/__tests__/pricing-section.test.tsx`
- Test: `components/landing/__tests__/faq-accordion.test.tsx`

- [ ] **Step 1: Write FAQ accordion test**

Create `components/landing/__tests__/faq-accordion.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FaqAccordion } from "../faq-accordion";

const ITEMS = [
  { question: "Is it free?", answer: "No, it starts at $49/month." },
  { question: "Can I cancel?", answer: "Yes, anytime." },
];

describe("FaqAccordion", () => {
  it("renders all questions", () => {
    render(<FaqAccordion items={ITEMS} />);
    expect(screen.getByText("Is it free?")).toBeInTheDocument();
    expect(screen.getByText("Can I cancel?")).toBeInTheDocument();
  });

  it("hides answers by default", () => {
    render(<FaqAccordion items={ITEMS} />);
    expect(screen.queryByText("No, it starts at $49/month.")).not.toBeVisible();
  });

  it("shows answer when question is clicked", async () => {
    const user = userEvent.setup();
    render(<FaqAccordion items={ITEMS} />);
    await user.click(screen.getByText("Is it free?"));
    expect(screen.getByText("No, it starts at $49/month.")).toBeVisible();
  });

  it("hides answer when clicked again", async () => {
    const user = userEvent.setup();
    render(<FaqAccordion items={ITEMS} />);
    await user.click(screen.getByText("Is it free?"));
    await user.click(screen.getByText("Is it free?"));
    expect(screen.queryByText("No, it starts at $49/month.")).not.toBeVisible();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard test -- --run components/landing/__tests__/faq-accordion.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create FaqAccordion component**

Create `components/landing/faq-accordion.tsx`:

```tsx
"use client";

import { useState } from "react";

interface FaqItem {
  question: string;
  answer: string;
}

interface FaqAccordionProps {
  items: FaqItem[];
}

export function FaqAccordion({ items }: FaqAccordionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {items.map(({ question, answer }, i) => {
        const isOpen = openIndex === i;
        return (
          <div
            key={question}
            style={{
              borderBottom: "1px solid #DDD9D3",
            }}
          >
            <button
              onClick={() => setOpenIndex(isOpen ? null : i)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "1.25rem 0",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
              }}
              aria-expanded={isOpen}
            >
              <span
                style={{
                  fontSize: "1rem",
                  fontWeight: 700,
                  color: "#1A1714",
                  letterSpacing: "-0.01em",
                }}
              >
                {question}
              </span>
              <span
                style={{
                  fontSize: "1.25rem",
                  color: "#9C958F",
                  transform: isOpen ? "rotate(45deg)" : "rotate(0deg)",
                  transition: "transform 200ms ease",
                  flexShrink: 0,
                  marginLeft: "1rem",
                }}
              >
                +
              </span>
            </button>
            <div
              style={{
                overflow: "hidden",
                maxHeight: isOpen ? "10rem" : "0",
                opacity: isOpen ? 1 : 0,
                transition: "max-height 300ms ease, opacity 200ms ease",
              }}
              aria-hidden={!isOpen}
            >
              <p
                style={{
                  fontSize: "0.9375rem",
                  lineHeight: 1.65,
                  color: "#6B6560",
                  paddingBottom: "1.25rem",
                }}
              >
                {answer}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run FAQ tests**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard test -- --run components/landing/__tests__/faq-accordion.test.tsx
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Write pricing section test**

Create `components/landing/__tests__/pricing-section.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PricingSection } from "../pricing-section";

describe("PricingSection", () => {
  it("renders pricing headline", () => {
    render(<PricingSection />);
    expect(screen.getByText("Simple pricing for your first booking agent.")).toBeInTheDocument();
  });

  it("renders Alex card with price", () => {
    render(<PricingSection />);
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByText("Your first booking agent")).toBeInTheDocument();
    expect(screen.getByText(/\$49/)).toBeInTheDocument();
  });

  it("renders all feature items", () => {
    render(<PricingSection />);
    expect(screen.getByText("Instant lead response")).toBeInTheDocument();
    expect(screen.getByText("Approval-first controls")).toBeInTheDocument();
    expect(screen.getByText("Full audit trail")).toBeInTheDocument();
  });

  it("renders CTA button", () => {
    render(<PricingSection />);
    expect(screen.getByRole("link", { name: /get started/i })).toBeInTheDocument();
  });

  it("renders FAQ questions", () => {
    render(<PricingSection />);
    expect(screen.getByText(/credit card/i)).toBeInTheDocument();
    expect(screen.getByText(/without my approval/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard test -- --run components/landing/__tests__/pricing-section.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 7: Create PricingSection component**

Create `components/landing/pricing-section.tsx`:

```tsx
import Link from "next/link";
import { FadeIn } from "@/components/ui/fade-in";
import { AgentMark } from "@/components/character/agent-mark";
import { FaqAccordion } from "./faq-accordion";

const FEATURES = [
  "Instant lead response",
  "Lead qualification and booking flow",
  "WhatsApp, Telegram, and web",
  "Approval-first controls",
  "Full audit trail",
  "Human handoff when needed",
];

const FAQ_ITEMS = [
  {
    question: "Do I need a credit card to get started?",
    answer:
      "We'll walk you through setup on a short call. No surprise charges — you'll know exactly what to expect before anything is billed.",
  },
  {
    question: "Will Alex act without my approval?",
    answer:
      "No. Alex can start in supervised mode, with approval required on every action. You decide when to loosen the controls.",
  },
  {
    question: "What happens as I trust it more?",
    answer:
      "You can choose to review less and let routine actions run faster, while keeping exceptions visible. You stay in control the whole time.",
  },
  {
    question: "Can I cancel anytime?",
    answer: "Yes. No lock-in, no long-term contracts.",
  },
];

export function PricingSection() {
  return (
    <section style={{ background: "#EDEAE5", paddingTop: "5rem", paddingBottom: "5rem" }}>
      <div className="page-width" style={{ maxWidth: "42rem", margin: "0 auto" }}>
        <FadeIn>
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
            Pricing
          </p>
          <h2
            style={{
              fontSize: "clamp(1.8rem, 3vw, 2.4rem)",
              fontWeight: 700,
              letterSpacing: "-0.025em",
              color: "#1A1714",
              marginBottom: "0.75rem",
            }}
          >
            Simple pricing for your first booking agent.
          </h2>
          <p
            style={{
              fontSize: "1rem",
              lineHeight: 1.6,
              color: "#6B6560",
              marginBottom: "3rem",
            }}
          >
            Launch Alex on the channels your customers already use. Stay in control from day one,
            then automate more as trust builds.
          </p>
        </FadeIn>

        {/* Alex pricing card */}
        <FadeIn delay={80}>
          <div
            style={{
              background: "#F9F8F6",
              border: "1px solid #DDD9D3",
              borderRadius: "1.25rem",
              padding: "2rem",
              boxShadow: "0 4px 16px rgba(26,23,20,0.06)",
            }}
          >
            {/* Agent identity */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                marginBottom: "1.5rem",
              }}
            >
              <AgentMark agent="alex" size="lg" />
              <h3
                style={{
                  marginTop: "0.75rem",
                  fontSize: "1.5rem",
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  color: "#1A1714",
                }}
              >
                Alex
              </h3>
              <p style={{ fontSize: "0.875rem", color: "#6B6560" }}>Your first booking agent</p>
            </div>

            {/* Price */}
            <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
              <span
                style={{
                  fontSize: "2.5rem",
                  fontWeight: 700,
                  letterSpacing: "-0.03em",
                  color: "#1A1714",
                }}
              >
                $49
              </span>
              <span style={{ fontSize: "0.875rem", color: "#9C958F" }}>/month</span>
            </div>

            {/* Features */}
            <ul
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.625rem",
                padding: 0,
                listStyle: "none",
                marginBottom: "1.5rem",
              }}
            >
              {FEATURES.map((feature) => (
                <li
                  key={feature}
                  style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    style={{ flexShrink: 0 }}
                  >
                    <circle cx="8" cy="8" r="7" fill="rgba(160,120,80,0.1)" />
                    <path
                      d="M5 8l2 2 4-4"
                      stroke="#A07850"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span style={{ fontSize: "0.875rem", color: "#1A1714" }}>{feature}</span>
                </li>
              ))}
            </ul>

            {/* CTA */}
            <Link
              href="/get-started"
              style={{
                display: "block",
                width: "100%",
                padding: "0.875rem",
                background: "#1A1714",
                color: "#F5F3F0",
                borderRadius: "9999px",
                fontSize: "0.9375rem",
                fontWeight: 600,
                textAlign: "center",
                textDecoration: "none",
              }}
            >
              Get started →
            </Link>
          </div>
        </FadeIn>

        {/* Expansion link */}
        <p style={{ marginTop: "1.5rem", textAlign: "center" }}>
          <a
            href="mailto:hello@switchboard.ai"
            style={{
              fontSize: "0.875rem",
              fontWeight: 600,
              color: "#A07850",
              textDecoration: "none",
            }}
          >
            Need higher volume, custom workflows, or multiple agents? → Talk to us
          </a>
        </p>

        {/* Supporting note */}
        <p
          style={{
            marginTop: "0.75rem",
            textAlign: "center",
            fontSize: "0.8125rem",
            color: "#9C958F",
          }}
        >
          No long setup project. No dev team required to get started.
        </p>

        {/* FAQ */}
        <div style={{ marginTop: "4rem" }}>
          <h3
            style={{
              fontSize: "1.25rem",
              fontWeight: 700,
              letterSpacing: "-0.015em",
              color: "#1A1714",
              marginBottom: "1.5rem",
            }}
          >
            Common questions
          </h3>
          <FaqAccordion items={FAQ_ITEMS} />
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 8: Run pricing tests**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard test -- --run components/landing/__tests__/pricing-section.test.tsx
```

Expected: All 5 tests PASS.

- [ ] **Step 9: Commit**

```bash
cd /Users/jasonljc/switchboard && git add apps/dashboard/src/components/landing/faq-accordion.tsx apps/dashboard/src/components/landing/__tests__/faq-accordion.test.tsx apps/dashboard/src/components/landing/pricing-section.tsx apps/dashboard/src/components/landing/__tests__/pricing-section.test.tsx && git commit -m "$(cat <<'EOF'
feat: add pricing section and FAQ accordion

Single Alex pricing card ($49/month) with feature list and
agent identity. FAQ accordion with expand/collapse for common
questions about approval, control, and cancellation.
EOF
)"
```

---

## Task 10: Final CTA Section

**Files:**

- Create: `components/landing/final-cta.tsx`

- [ ] **Step 1: Create FinalCta component**

Create `components/landing/final-cta.tsx`:

```tsx
import Link from "next/link";
import { FadeIn } from "@/components/ui/fade-in";

export function FinalCta() {
  return (
    <section style={{ background: "#1E1C1A", paddingTop: "5rem", paddingBottom: "5rem" }}>
      <div className="page-width" style={{ textAlign: "center" }}>
        <FadeIn>
          <h2
            style={{
              fontSize: "clamp(2rem, 4vw, 3.2rem)",
              fontWeight: 700,
              letterSpacing: "-0.025em",
              color: "#EDE8E1",
              marginBottom: "0.75rem",
            }}
          >
            Your next lead is already waiting.
          </h2>
          <p
            style={{
              fontSize: "1rem",
              color: "#7A736C",
              marginBottom: "2.5rem",
            }}
          >
            Get Alex live where your leads already come in.
          </p>
          <Link
            href="/get-started"
            style={{
              display: "inline-flex",
              alignItems: "center",
              background: "#A07850",
              color: "#1A1714",
              borderRadius: "9999px",
              padding: "0.875rem 2rem",
              fontSize: "0.9375rem",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Get started →
          </Link>
          <p
            style={{
              marginTop: "1.5rem",
              fontSize: "0.8125rem",
              color: "#7A736C",
            }}
          >
            No dev team required.
          </p>
        </FadeIn>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/jasonljc/switchboard && git add apps/dashboard/src/components/landing/final-cta.tsx && git commit -m "$(cat <<'EOF'
feat: add final CTA section

Dark section with amber CTA button — the only amber-filled
button on the page. Creates bookend effect with the before/after
dark section.
EOF
)"
```

---

## Task 11: Assemble Homepage + Update Layout

**Files:**

- Modify: `app/(public)/page.tsx`
- Modify: `app/(public)/layout.tsx`

- [ ] **Step 1: Rewrite the homepage**

Replace the entire contents of `app/(public)/page.tsx`:

```tsx
import type { Metadata } from "next";
import { HomepageHero } from "@/components/landing/homepage-hero";
import { BeforeAfterSection } from "@/components/landing/before-after-section";
import { ScrollytellingSection } from "@/components/landing/scrollytelling-section";
import { ProofBar } from "@/components/landing/proof-bar";
import { TrustCards } from "@/components/landing/trust-cards";
import { PricingSection } from "@/components/landing/pricing-section";
import { FinalCta } from "@/components/landing/final-cta";

export const metadata: Metadata = {
  title: "Switchboard — Never miss a lead again",
  description:
    "AI booking agents that reply in seconds, qualify leads, and book appointments on WhatsApp, Telegram, or your website.",
};

export default function HomePage() {
  return (
    <>
      <HomepageHero />
      <BeforeAfterSection />
      <ScrollytellingSection />
      <section style={{ background: "#F5F3F0", paddingBottom: "5rem" }}>
        <div className="page-width">
          <ProofBar />
          <TrustCards />
        </div>
      </section>
      <PricingSection />
      <FinalCta />
    </>
  );
}
```

Note: The homepage is now a simple server component. No `getListedAgents()` or `getDemoTaskStats()` calls needed — the hero no longer requires database agent data.

- [ ] **Step 2: Update layout metadata**

In `app/(public)/layout.tsx`, update the metadata:

```tsx
export const metadata: Metadata = {
  title: "Switchboard — Never miss a lead again",
  description:
    "AI booking agents that reply in seconds, qualify leads, and book appointments on WhatsApp, Telegram, or your website.",
  openGraph: {
    title: "Switchboard — Never miss a lead again",
    description:
      "AI booking agents that reply in seconds, qualify leads, and book appointments on WhatsApp, Telegram, or your website.",
    type: "website",
  },
};
```

- [ ] **Step 3: Run typecheck**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard typecheck
```

Expected: PASS with no errors.

- [ ] **Step 4: Run all landing tests**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard test -- --run
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonljc/switchboard && git add apps/dashboard/src/app/\(public\)/page.tsx apps/dashboard/src/app/\(public\)/layout.tsx && git commit -m "$(cat <<'EOF'
feat: assemble redesigned homepage

New page flow: Hero (conversation demo) → Before/After (dark
scenarios) → How It Works (scrollytelling) → Trust & Proof →
Pricing (Alex card) → Final CTA (amber button).

Replaces marketplace-oriented homepage with paid Alex wedge
positioning focused on SMB service businesses.
EOF
)"
```

---

## Task 12: Visual Verification + Polish

**Files:**

- Possibly: `app/globals.css` (minor tweaks)

- [ ] **Step 1: Start dev server**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard dev
```

- [ ] **Step 2: Open http://localhost:3002 in a browser and verify:**

1. **Hero:** Headline "Never miss a lead again." visible, conversation demo auto-plays after 3s, phone mockup looks correct on both desktop and mobile viewport
2. **Before/After:** Dark section renders, 3 strips visible, staggered fade-in works on scroll
3. **Scrollytelling:** Sticky phone on desktop transitions between 3 screens as text scrolls. On mobile, phone is inline.
4. **Trust & Proof:** 4 proof metrics in row (2x2 on mobile), 3 trust cards with mini visuals, governance line at bottom
5. **Pricing:** Alex card centered, features listed, FAQ accordion expands/collapses
6. **Final CTA:** Dark section, amber "Get started →" button
7. **Nav:** Only "How it works" and "Pricing" links, no "Agents"
8. **Footer:** No "Browse agents" link
9. **Responsive:** Check at 375px, 768px, 1024px, and 1440px widths

- [ ] **Step 3: Fix any visual issues found**

Common issues to watch for:

- Overflow on mobile (phone mockup too wide)
- Typing animation keyframe not working (check globals.css has `typing-dot`)
- Framer Motion hydration warnings (ensure `"use client"` on components using `motion`)
- Sticky phone not sticking (check `position: sticky` and `top` value)

- [ ] **Step 4: Run full test suite one final time**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/dashboard test -- --run && npx pnpm@9.15.4 --filter @switchboard/dashboard typecheck
```

Expected: All tests PASS, typecheck PASS.

- [ ] **Step 5: Commit any polish fixes**

```bash
cd /Users/jasonljc/switchboard && git add -A apps/dashboard/src/ && git commit -m "$(cat <<'EOF'
fix: polish homepage visual issues from browser testing
EOF
)"
```

(Only if changes were needed.)
