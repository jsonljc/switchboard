# Landing Page Design Spec

## Overview

A single public landing page for Switchboard that positions the product as an AI agent platform across industries — not a marketplace directory. Leads with character-driven visuals and outcome proof. Sells the platform, uses the Sales Pipeline as the live proof point.

**Strategic context:** Marketplace-first fails due to cold start (3 agents on day one signals "early and empty"). Mission Control-first means the product is in production generating real data, trust scores, and outcome logs before anyone sees a marketing page. The landing page reflects this — it shows agents _working_, not agents _listed_.

**Target audiences:**

- Primary (demand): SMB owners who want AI to run business operations
- Primary (supply): Agent builders who want to list on the marketplace (light touch — footer link only until the builder program is real)
- Secondary: Technical buyers evaluating AI agent platforms

**Visual direction:** Notion/Figma-inspired — playful, accessible, warm. Not dark/developer-luxe. Personality comes from the character system (unique SVG agents with breathing auras) and 8-bit accent details (pixel-mono numbers, chunky connectors, stepped progress bars).

---

## Route Architecture

The landing page lives inside the existing Next.js dashboard app as a public route group.

```
apps/dashboard/src/app/(public)/page.tsx        — landing page
apps/dashboard/src/app/(public)/layout.tsx      — minimal layout (no AppShell, no auth)
apps/dashboard/src/app/(auth)/page.tsx          — current authenticated homepage (moved)
apps/dashboard/src/app/(auth)/layout.tsx        — wraps AppShell + auth providers
```

- `(public)` route group: no AuthProvider, no AppShell, no sidebar. Own minimal layout with landing nav + footer.
- `(auth)` route group: current app experience moves here unchanged. Everything behind login stays as-is.
- Root `/` serves the public landing page. Authenticated users see a "Dashboard" link in nav instead of "Sign in."
- `/login` stays at its current path (already excluded from AppShell via `CHROME_HIDDEN_PATHS`).
- Shares the existing design system: tailwind config, globals.css, fonts, character components.

---

## Page Sections

### 1. Navigation

Fixed top nav bar.

**Layout:**

```
Switchboard (wordmark)                              Sign in
```

- Left: "Switchboard" in Cormorant Garamond display weight. Text only, no icon/logo.
- Right: "Sign in" links to `/login`. If authenticated, shows "Dashboard" linking to `/(auth)`.
- Starts transparent with light text over the hero background. On scroll past the hero viewport, transitions to solid white (`--surface`) background with dark text and subtle `--border` bottom.
- Mobile: same layout, no hamburger needed — only 1-2 links.

### 2. Hero

The emotional hook. Platform positioning + characters + CTA.

**Headline:** "Hire AI agents that run your business." — Cormorant Garamond, `clamp(2.5rem, 5vw, 4rem)`. Centered.

**Subheadline:** "Sales. Creative. Trading. Finance. They start supervised. They earn your trust." — Inter, `--muted-foreground`. Shows platform breadth and trust mechanic in one line.

**Characters:** Four OperatorCharacter instances in a horizontal row, one per agent family:

- Sales — `leads` color (purple). Fully colored, floating animation, breathing aura. Label: "Sales" with "Live" badge beneath.
- Creative — muted/translucent (opacity ~0.4). Label: "Creative" with "Coming" beneath.
- Trading — muted/translucent. Label: "Trading" with "Coming" beneath.
- Finance — muted/translucent. Label: "Finance" with "Coming" beneath.

Characters sized ~120-150px tall. The muted characters signal the platform roadmap visually. As families launch, their characters "wake up" (change from muted to fully colored).

**CTAs:**

- Primary: "Get started" — solid button, links to `/login`
- Secondary: "See it in action" with down arrow — smooth scrolls to timeline section

**Background:** Warm `--background` (hsl 45 25% 98%) with a very subtle radial gradient wash centered behind the characters. Warm tinted, not dark — approachable for SMB owners.

**Animation on load:** Characters fade in left-to-right with 200ms stagger. Sales character begins floating/breathing immediately; muted characters have slowed/dampened float. CTA fades in last.

### 3. Timeline Story — "See it in action"

A concrete scenario showing agents working, framed as one example on the platform.

**Section header:** "See it in action: Sales Pipeline" — Cormorant Garamond, centered. The "Sales Pipeline" part framed as a tag/badge to signal this is one of many possible scenarios.

**Content:** A single large card containing a timeline/chat-log:

```
11:42 PM   A lead fills out your contact form.

11:42 PM   Speed-to-Lead responds. Qualifies the lead
  [purple]  in under 60 seconds.

11:58 PM   Qualified. Hands off to Sales Closer
  [purple→green]  with full context.

12:03 AM   Sales Closer handles objections.
  [green]   Books a call for tomorrow at 2 PM.

           You were asleep the whole time.
```

- Timestamps in Space Mono (pixel/mono font) on the left
- Descriptions in Inter on the right
- Small colored circles (matching agent role colors) appear inline when that agent acts
- Handoff moments show two circles with an arrow between them
- "You were asleep the whole time." as the punchline — muted, italic

**Below the card:** "Sales is live today. Creative, Trading, and Finance agents are coming — same trust system, same control." — one line, muted text.

**Card style:** `--surface` background, `--radius-lg` corners, subtle `--border`. The timeline inside uses a thin vertical line in `--border-subtle` connecting entries.

**Scroll animation:** Timeline entries fade in sequentially as section enters viewport, 300ms stagger between each.

**Future-proofing:** When additional families launch, this section can become tabbed (Sales | Creative | Trading) with different timeline stories per tab. The component structure should accommodate this without requiring a rewrite.

### 4. Platform Stats — "How Switchboard agents work"

Three universal properties that apply to every agent family.

**Section header:** "How Switchboard agents work" — Cormorant Garamond, centered.

**Three cards in a row:**

1. **< 60s** (Space Mono, large ~3rem) — "Agents act immediately on every trigger." (Inter, small, muted)
2. **100%** (Space Mono, large) — "Nothing falls through the cracks." — "follow-through" as the label
3. **Earns autonomy** (Space Mono, large) — "Start supervised. Trust grows with every approval."

**Card style:** No borders — just number + label on the warm cream background. Numbers are the visual weight. Generous spacing between cards.

**Animation:** Numbers count up from 0 on viewport entry (800ms, ease-out). Triggers once.

**Body copy below cards:** "These aren't vanity metrics. They're operational guarantees. The agents don't forget, don't sleep, don't get busy with another client." — centered, muted, slightly irreverent.

**Responsive:** 3-column on desktop, 2-column on tablet, single-column on mobile.

### 5. Trust Aside — "You're the boss. Literally."

Governance as reassurance, not a lecture. Three compact cards.

**Section header:** "You're the boss. Literally." — Cormorant Garamond, centered.

**Three cards:**

1. **Trust score** — Pixel-style progress bar (8-bit accent, stepped/segmented fill) showing 0. "Every agent starts at zero trust. No exceptions."
2. **Approval flow** — Row of small pixel-style checkmarks. "New agents need your OK on every task. Earn autonomy over time."
3. **Hard rules** — Small pixel-style shield icon. "They never claim to be human. Never promise what you can't deliver." (from actual `governance-constraints.ts`)

**Card style:** `--surface` background, `--radius-lg`, subtle border. Slightly smaller/more compact than pipeline cards.

**No animation** beyond standard fade-in-up on scroll. This section earns trust by being calm and still.

### 6. Footer

Minimal single line.

```
Switchboard          Build agents for the marketplace →          © 2026 Switchboard
```

- Wordmark on the left
- "Build agents for the marketplace →" centered — links to a simple page or mailto. Supply-side hook, honest about current state.
- Copyright on the right
- `--muted-foreground` text on `--surface-raised` background. Small type.

---

## 8-Bit Accent System

Pixel/retro accents add personality without dominating. Rules:

**USE pixel accents for:**

- Stat numbers — Space Mono font for all numbers (outcomes grid, trust score, timeline timestamps)
- Connectors — pixel-style chevrons/arrows in the timeline
- Progress bars — trust score bar uses stepped/segmented fill
- Status badges — "Live" / "Coming" labels use chunky 2px borders
- Background texture — optional subtle pixel dot-grid on one section (very low opacity ~3-5%)

**DO NOT use pixel accents for:**

- Characters — stay as smooth SVGs with auras (Switchboard's unique visual identity)
- Headlines — stay in Cormorant Garamond
- Body text — stays in Inter
- Buttons — stay polished
- Cards — stay clean with rounded corners

**Rule: Structure is polished, details are playful.**

---

## Typography

- **Headlines:** Cormorant Garamond (already loaded as `--font-display`). Light/regular weight, large sizes.
- **Body:** Inter (already loaded as `--font-sans`). Regular weight, 15-16px base.
- **Numbers/timestamps:** Space Mono (new — needs to be added). Used for stats, timeline timestamps, trust score number.
- **Labels:** Inter, small caps via `.section-label` utility (already exists).

---

## Color

Uses existing design tokens throughout. No new colors.

- Background: `--background` (warm cream)
- Cards: `--surface` (white)
- Text: `--foreground` / `--muted-foreground`
- Borders: `--border` / `--border-subtle`
- Agent role colors: existing `--char-*` CSS variables
- Status: existing `--positive`, `--caution` for Live/Coming badges

---

## Responsive Behavior

**Desktop (lg+, 1024px+):** Full horizontal layouts. Hero characters in a row. Timeline card centered at `--content-width`. Stats 3-column. Trust 3-column.

**Tablet (md, 768px+):** Hero characters smaller (~100px). Stats and trust cards stay 3-column but tighter. Timeline card full-width with padding.

**Mobile (sm, <768px):** Everything stacks. Hero characters in a tight horizontal row (~80px each) or 2x2 grid. Stats single-column. Trust cards stack. Timeline entries stack (timestamps above descriptions).

---

## New Components

1. **`LandingNav`** — transparent-to-solid nav with auth-aware CTA
2. **`HeroSection`** — headline, subheadline, 4 characters (1 live + 3 muted), CTAs
3. **`AgentFamilyCharacter`** — wrapper around OperatorCharacter that handles muted/live state, label, and badge
4. **`TimelineCard`** — timeline/chat-log with scroll-triggered staggered entries
5. **`StatCard`** — large number (Space Mono) + label + count-up animation
6. **`TrustCard`** — icon/visual + description, compact
7. **`LandingFooter`** — minimal footer
8. **`useScrollReveal`** — intersection observer hook for fade-in-up animations (reusable)

---

## New Dependencies

- **Space Mono** — Google Font, loaded via `next/font/google` alongside Inter and Cormorant Garamond. Used for numbers and timestamps only.

No other new dependencies.

---

## What This Does NOT Include

- Separate marketing site or domain
- Pricing page
- Builder signup flow or dedicated builder page
- Blog or content pages
- Analytics/tracking integration
- A/B testing infrastructure
- SEO optimization beyond basic meta tags
- Dark mode for the landing page (inherits light mode only)
