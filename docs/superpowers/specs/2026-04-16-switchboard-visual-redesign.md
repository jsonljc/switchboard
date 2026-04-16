# Switchboard Public Website — Visual Redesign Spec

**Date:** 2026-04-16
**Status:** Approved
**Supersedes:** Visual direction section of `2026-04-16-switchboard-public-website-design.md`

---

## Goal

Full visual redesign of the Switchboard public website. Same 6-page structure and content as the first spec. Everything else changes: typography, color system, layout approach, component patterns, and character design. The existing implementation is the starting point to rewrite against.

---

## Design Direction — "Stone & Weight"

Bold sans-serif typography doing the structural work. Desaturated, warm-neutral palette. Left-aligned confidence. No decorative illustration. Characters as quiet editorial marks, not mascots.

**References:** Closer to a serious modern product brand than an editorial magazine or enterprise SaaS. Confident without edge. Warm without being artisanal.

**What's gone:**

- Cormorant Garamond serif display font
- Cream/amber editorial warmth
- Abstract SVG node illustration
- Centered hero layouts
- Decorative radial gradients and color washes
- Pulse dots and eyebrow animations

**What defines the new direction:**

- Instrument Sans Extra Bold at scale — the headline is the visual
- Warm stone neutrals, desaturated throughout
- Left-aligned, section-alternating layouts
- Actual product UI (an agent card) as the homepage hero visual
- Characters as contained SVG marks — secondary to type and layout

---

## Typography System

**Font family:** Instrument Sans (Google Fonts, free)

| Role             | Weight           | Usage                           |
| ---------------- | ---------------- | ------------------------------- |
| Display headline | 800 (Extra Bold) | Page heroes, section openers    |
| Section header   | 700 (Bold)       | Sub-section titles, card titles |
| UI label         | 600 (SemiBold)   | Nav, tags, badges, captions     |
| Body             | 400 (Regular)    | All body copy                   |

**Scale:**

| Level           | Size                         | Weight |
| --------------- | ---------------------------- | ------ |
| Hero headline   | `clamp(3rem, 6vw, 6rem)`     | 800    |
| Section header  | `clamp(1.8rem, 3vw, 2.8rem)` | 700    |
| Card title      | `1.25rem`                    | 700    |
| Body            | `1rem`                       | 400    |
| Caption / label | `0.75rem`                    | 600    |

**Rules:**

- No italic accents. Weight carries the emphasis.
- No second display font. One typeface family, multiple weights.
- Letter-spacing on display: `-0.02em`. Body: `0`. Labels: `0.06em` uppercase.
- Line height: headlines `1.0–1.05`, body `1.6`.

---

## Color System

All values are warm-undertoned. Nothing is cool gray or pure neutral.

| Token              | Value       | Role                                  |
| ------------------ | ----------- | ------------------------------------- |
| `--base`           | `#F5F3F0`   | Page background                       |
| `--surface`        | `#EDEAE5`   | Alternate section background          |
| `--surface-raised` | `#F9F8F6`   | Card backgrounds                      |
| `--border`         | `#DDD9D3`   | Card edges, dividers                  |
| `--border-strong`  | `#C8C3BC`   | Emphasized borders                    |
| `--text-primary`   | `#1A1714`   | Headlines, body                       |
| `--text-secondary` | `#6B6560`   | Supporting copy                       |
| `--text-muted`     | `#9C958F`   | Labels, captions, meta                |
| `--accent`         | `#A07850`   | CTAs, key emphasis — dusty terracotta |
| `--accent-soft`    | `#A0785015` | Accent backgrounds                    |
| `--dark-surface`   | `#1E1C1A`   | Elite pricing card only               |
| `--dark-text`      | `#EDE8E1`   | Text on dark surface                  |
| `--dark-muted`     | `#7A736C`   | Muted text on dark surface            |

**Usage rules:**

- Accent (`#A07850`) appears in at most 2–3 moments per page: primary CTA, one key emphasis. Not scattered.
- Dark surface (`#1E1C1A`) appears only on the Elite pricing card.
- All other elements use the stone neutral range.
- No gradients except one permitted exception: the bottom CTA section may use a subtle stone-to-surface gradient (`#F5F3F0` → `#EDEAE5`).
- Agent role colors: if needed for differentiation, use very subtle tinting within the stone palette. Not distinct brand colors per agent. Recognition comes from character mark, not color.

---

## Layout Principles

**Alignment:** Left-aligned throughout. Not centered. Headlines, copy, and CTAs align left. Only exceptions: pricing cards (centered within card), footer copyright line.

**Section structure:**

- Sections alternate between `--base` (#F5F3F0) and `--surface` (#EDEAE5)
- No decorative dividers or gradient transitions — background change is the signal
- Each section opens with a display header (700–800 weight), left-aligned
- Max content width: `1200px`. Horizontal padding: `clamp(1.25rem, 5vw, 4rem)`.

**Spacing:**

- Section vertical padding: `py-20` to `py-28` (80px–112px)
- Component internal padding: `p-6` to `p-8`
- Gap between headline and body: `mt-5` to `mt-6`
- Gap between body and CTA: `mt-8` to `mt-10`

**CTA pattern:**

- Primary: dark pill (`#1A1714` bg, `#F5F3F0` text), `px-7 py-3.5`, `rounded-full`
- Secondary: ghost text link (`--text-secondary` color, no border)
- Nav CTA specifically: dark pill — not accent. Too small for terracotta.
- Section CTAs: accent pill (`#A07850` bg, white text) where one warm moment is needed per page

**Cards:**

- Background: `--surface-raised` (#F9F8F6)
- Border: `1px solid --border` (#DDD9D3)
- Border radius: `16px` (rounded-2xl)
- No heavy box shadow. Hover: `border-color: --border-strong`, `translateY(-2px)`

---

## Navigation

**Desktop:**

```
[Switchboard]    Agents   How it works   Pricing    Sign in   [Get early access]
```

- Wordmark: Instrument Sans 700, `--text-primary`
- Nav links: 600 weight, `--text-secondary`, active state `--text-primary`
- "Sign in": secondary text link, `--text-secondary`
- "Get early access": dark pill (`#1A1714` bg)
- Scroll behavior: transparent → `--surface-raised` bg with `border-bottom: 1px solid --border` on scroll

**Mobile:**

- Hamburger icon (clean 3-line, `--text-primary`)
- Full-width dropdown: stacked links + dark pill CTA at bottom

---

## Character Design System

### Core Principle

Character in concept, restraint in execution. Typography and product UI are the visual hero. Characters add memorability and warmth without competing with the interface.

### Visual Style

- Stylized geometric or simplified human-like forms
- Minimal detail, clean outlines, quiet shapes
- Consistent structural system across all three agents
- Must work at small sizes (24px), medium (64px), and large (160px)
- Monochrome fallback required
- Accent tinting supported via design tokens, not hardcoded colors
- Built as reusable SVG React components with size variants

### Agent Directions

**Alex — Lead Qualifier** (was: Speed-to-Lead / `roleFocus="leads"`)

- Visual cue: alert, sharp, scanning
- Motif: signal / radar / detection
- Character feel: quick, attentive, forward-looking
- Form direction: tighter shape language, more angular or directional structure, subtle sense of readiness

**Riley — Sales Follow-Up** (was: Sales Closer / `roleFocus="growth"`)

- Visual cue: grounded, forward-moving, assured
- Motif: arrow / path / momentum
- Character feel: steady, confident, purposeful
- Form direction: balanced structure, more anchored posture, quiet sense of movement or progress

**Jordan — Nurture Specialist** (was: `roleFocus="care"`)

- Visual cue: calm, open, patient
- Motif: wave / loop / return
- Character feel: low-pressure, measured, reassuring
- Form direction: softer curves, more open spacing, relaxed but intentional presence

### Size Variants

| Variant | Size      | Usage                               |
| ------- | --------- | ----------------------------------- |
| `xs`    | 24×24px   | Chat message level (optional)       |
| `sm`    | 40×40px   | Agent card beside name              |
| `md`    | 64×64px   | Nav/widget header, deployment badge |
| `lg`    | 120×120px | Profile page, get-started panel     |
| `xl`    | 160×160px | Onboarding, hero moments            |

### Rules

- No expressive emotional states
- No speech bubbles or visual catchphrases
- No mascot-style hero illustrations
- No animated personality behaviors
- No context-based appearance changes
- No visual treatment that competes with headlines or core UI
- Monochrome must look intentional, not degraded

### Component Interface

```tsx
interface OperatorCharacterProps {
  agent: "alex" | "riley" | "jordan";
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  monochrome?: boolean;
  className?: string;
}
```

Replace existing `roleFocus` prop with explicit `agent` name. Update all call sites.

---

## Page-by-Page Structure

### Homepage (`/`)

**Sections (top to bottom):**

1. **Hero** — `--base` bg
   - Left column: eyebrow label (uppercase, `--text-muted`), ExtraBold headline, body copy, dark pill CTA + ghost "Browse agents →"
   - Right column (desktop): a rendered agent card component — real product UI, not illustration
   - No animation on mount. Static. The weight does the work.

2. **Problem strip** — `--surface` bg
   - 3 columns, each: bold short label + one sentence outcome copy
   - No icons. Typography only.

3. **How it works preview** — `--base` bg
   - 3 steps numbered in large ExtraBold (`--border-strong` color, very muted)
   - Step label + one sentence
   - Link to `/how-it-works`

4. **Agent cards** — `--surface` bg
   - 3 cards (Alex, Riley, Jordan) using the redesigned `AgentMarketplaceCard`
   - Character mark `sm` size beside agent name

5. **Trust progression** — `--base` bg
   - 4-step horizontal strip: 0 → 40 → 70 → 90+
   - Bold tier names, muted descriptions
   - Connecting line in `--border` color

6. **Bottom CTA** — subtle gradient `--base` → `--surface`
   - Single centered accent pill CTA

### Agent Catalog (`/agents`)

- Hero: ExtraBold "Meet the team." left-aligned, subhead, "Get early access" dark pill
- Grid of agent cards below
- Empty state: plain copy, no decorative elements

### Agent Profile (`/agents/[slug]`)

- Header: character mark `lg` size + agent name ExtraBold + tagline + dark pill CTA
- Sections follow existing structure (capabilities, how it works, trust, channels, FAQ) with new visual treatment
- Character is beside the headline, not above it

### How It Works (`/how-it-works`)

- 3-act alternating layout stays
- Large display numbers: ExtraBold, `--border` color (very muted), purely typographic
- No abstract visuals

### Pricing (`/pricing`)

- 4-card grid stays
- Cards redesigned with new tokens
- Elite card: `--dark-surface` bg, `--dark-text` text — only dark moment on the page
- Trust score circles stay: clearest visual shorthand for the tier mechanic
- "Most popular" badge: dark fill, not accent

### Get Started (`/get-started`)

- Two-column: form left, agent card right
- Agent card shows Alex (lead qualifier) at `lg` size
- Form: Instrument Sans, clean inputs, dark pill submit button
- Trust signals below form

---

## Implementation Scope

**What changes in code:**

1. **`globals.css`** — add new CSS custom properties for all color tokens; update `font-family` to Instrument Sans
2. **`layout.tsx` (public)** — load Instrument Sans from `next/font/google`
3. **`OperatorCharacter` component** — full SVG redesign for Alex, Riley, Jordan; new `agent` prop replacing `roleFocus`; size variants
4. **`LandingNav`** — dark pill CTA, new color tokens, updated scroll behavior
5. **`LandingFooter`** — new color tokens
6. **`HomepageHero`** — remove animation, remove SVG illustration, add agent card right column, left-align layout
7. **`AgentMarketplaceCard`** — new card visual with stone palette, `sm` character mark
8. **All 6 public pages** — swap inline style values to new tokens; update section backgrounds
9. **`AgentProfileHeader`** — character mark repositioned beside headline

**What stays the same:**

- Page routing and structure
- Content (copy, sections)
- Data fetching pattern
- Waitlist API

---

## Success Criteria

- Instrument Sans loads correctly at all weights with no FOUT
- All inline color values replaced with CSS custom properties or new token values
- `OperatorCharacter` renders correctly at all 5 size variants for all 3 agents
- Dark Elite pricing card is the only dark surface on the pricing page
- Accent (`#A07850`) appears in at most 2–3 moments per page
- No Cormorant Garamond references remain in public-facing components
- All call sites updated from `roleFocus` to `agent` prop
