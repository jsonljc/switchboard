# Public Site Visual Uplift — Design Spec

**Date:** 2026-04-17
**Scope:** `apps/dashboard/src/app/(public)/` and its components
**Approach:** Option A (Polish pass) + hero card cluster from Option B

---

## Problem

The public marketing site's Stone & Weight redesign is directionally correct but reads as too flat. Specific issues:

- Current font lacks warmth and personality
- No motion — the page feels static and lifeless
- Cards have no interactive depth
- Hero reads as a product demo (single agent) rather than a marketplace

---

## Goals

1. Swap typography to DM Sans (humanist, warm, energetic)
2. Add scroll-triggered fade-rise animations site-wide
3. Enrich card and CTA hover states with depth
4. Restructure hero right column into a 3-card agent stack that signals marketplace

---

## Design

### 1. Typography — DM Sans

- Load **DM Sans** via `next/font/google` in the root layout
- Apply as `var(--font-display)` so it cascades across the entire public site without touching individual components
- No font size changes needed — DM Sans's optical warmth does the work
- Hero `h1` stays at `fontWeight: 700`; body copy benefits from DM Sans's lighter humanist feel at the same weight values

### 2. Scroll Animations — `useFadeIn` + `<FadeIn>`

- Implement a `useFadeIn` hook using native `IntersectionObserver` (no new library)
- Initial state: `opacity: 0; transform: translateY(16px)`
- Final state: `opacity: 1; transform: translateY(0)`
- Transition: `380ms ease-out`
- Trigger: fires once when 15% of the element is visible (`threshold: 0.15`)
- One-shot only — does not re-animate on scroll back up
- Wrap section content blocks in a `<FadeIn>` component
- Grid children (agent cards, problem cards, steps) receive staggered `transitionDelay` of `60ms` per index, cascading left to right

**Files to create:**

- `apps/dashboard/src/hooks/use-fade-in.ts`
- `apps/dashboard/src/components/ui/fade-in.tsx`

**Files to update:**

- `apps/dashboard/src/app/(public)/page.tsx` — wrap section content in `<FadeIn>`
- `apps/dashboard/src/components/landing/homepage-hero.tsx` — wrap hero content in `<FadeIn>`

### 3. Card & CTA Hover States

**Agent marketplace cards (`AgentMarketplaceCard`):**

- Component uses inline styles — add `useState(isHovered)` with `onMouseEnter`/`onMouseLeave` to drive hover styles (no Tailwind group available)
- Add `transition: box-shadow 220ms ease, transform 220ms ease` to the card root style
- Hover: `box-shadow: 0 8px 24px rgba(26,23,20,0.08)` + `transform: translateY(-2px)`
- Trust score badge border shifts to slightly more saturated amber on hover

**Problem cards (inline in `page.tsx`):**

- Same shadow lift on hover
- Border shifts from `#DDD9D3` → `#C8C3BC`

**Nav CTA — "Get early access" pill:**

- Hover background: `#1A1714` → `#2C2825` (warmer dark, not opacity fade)
- All nav text links: color shifts from muted to `#1A1714` on hover

### 4. Hero Agent Card Cluster

Replace the single agent card in the hero right column with a **3-card stack** that signals marketplace.

**Layout:**

- `position: relative` container ~22rem wide with `overflow: visible` — extra width gives clearance for the ±40px absolute-positioned back cards without clipping
- Primary card (Speed-to-Lead / Alex): `width: 17rem`, foreground, `transform: rotate(1.5deg)`, `box-shadow: 0 16px 48px rgba(26,23,20,0.10)`, border `#C8C3BC`, centered within the container
- Second card (Sales Closer): `position: absolute`, `transform: rotate(-2deg) translateX(-40px) translateY(8px)`, `opacity: 0.85`, z-index behind primary
- Third card (Nurture Specialist): `position: absolute`, `transform: rotate(3deg) translateX(40px) translateY(16px)`, `opacity: 0.7`, z-index furthest back

**Interaction:**

- On hover of the container, each card shifts gently outward (fan effect) — telegraphs that cards are distinct browseable items
- Transition: `transform 300ms ease, box-shadow 300ms ease`
- Primary card straightens to `rotate(0deg)` on hover (feels like picking it up)

**Mobile:**

- Back cards hidden (`display: none` on mobile)
- Primary card displayed normally (no rotation on mobile)

**Data:**

- The 3 preview agent slugs are already defined in `page.tsx` (`PREVIEW_SLUGS`) — pass all 3 into the hero component
- `HomepageHeroProps` expands to accept an array of preview agents instead of a single one

---

## Out of Scope

- Layout restructuring of any section below the hero
- Diagonal dividers or asymmetric grids (Option C)
- Authenticated app shell changes
- New page content or copy changes

---

## Files Affected

| File                                                               | Change                                                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `apps/dashboard/src/app/layout.tsx`                                | Add DM Sans font                                                                      |
| `apps/dashboard/src/app/(public)/page.tsx`                         | Wrap sections in `<FadeIn>`, pass 3 agents to hero, add hover styles to problem cards |
| `apps/dashboard/src/components/landing/homepage-hero.tsx`          | Accept array of agents, render card cluster                                           |
| `apps/dashboard/src/components/landing/agent-marketplace-card.tsx` | Add hover depth styles                                                                |
| `apps/dashboard/src/components/landing/landing-nav.tsx`            | Enrich CTA hover state                                                                |
| `apps/dashboard/src/hooks/use-fade-in.ts`                          | New — IntersectionObserver hook                                                       |
| `apps/dashboard/src/components/ui/fade-in.tsx`                     | New — wrapper component                                                               |
