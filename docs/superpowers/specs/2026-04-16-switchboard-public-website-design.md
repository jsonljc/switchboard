# Switchboard Public Website — Design Spec

**Date:** 2026-04-16
**Status:** Approved
**Author:** Jason

---

## Goal

Build a public-facing website for Switchboard within the existing `apps/dashboard` Next.js app, using the `(public)` route group. The site covers the full funnel: marketing homepage → agent browse → how it works → pricing → waitlist signup. Target buyer is SMB owners first (fitness studios, clinics, agencies), with marketing/growth teams and agent builders as secondary audiences.

CTA is "Get early access" (pre-launch waitlist). The deploy flow ships later once agents are working end-to-end.

---

## Technical Architecture

**Location:** `apps/dashboard/src/app/(public)/` — existing route group, no new app needed.

**Layout:** `(public)/layout.tsx` already wraps all public pages with `LandingNav` and `LandingFooter`. Both need updates (nav links, footer links).

**Design system:** Existing design tokens (`globals.css`), Cormorant Garamond display font, Inter body, operator amber accent (`hsl(30 55% 46%)`), warm parchment background. Dark hero sections use the `.dark` class wrapper to activate dark CSS vars locally.

**Data:** Agent listings from the Prisma DB via `getListedAgents()` (already in `lib/demo-data.ts`). Homepage and catalog pages are server components fetching real data. Agent profiles use dynamic `[slug]` routes.

**Animations:** CSS-only via existing keyframes (`fade-in`, `character-float`, etc.). Staggered `animation-delay` for hero reveals. No JS animation libraries added.

---

## Pages

### 1. Homepage (`/`)

**Replaces** the current "Meet your team" marketplace browser.

#### Sections (top to bottom)

**Hero** — Dark section (`.dark` wrapper), full-screen-ish height

- Eyebrow: "AI Agent Marketplace" with amber pulse dot
- Headline (Cormorant, ~6rem): "Your AI sales team, ready in minutes." — word "ready in minutes" in italic amber
- Subhead: "Browse AI agents built for growth. Deploy to WhatsApp, Telegram, or your website. They qualify leads, book calls, and earn your trust over time."
- CTA: "Get early access" (amber pill button) + "Browse agents →" (ghost link)
- Social proof line: "Join 200+ businesses on the early access list"
- Background: dot-grid radial-gradient at low opacity + subtle amber ambient glow
- Bottom: gradient fade to parchment background (seamless transition to next section)

**Problem / Solution strip** — 3 columns, icon-driven

- Missed leads → Speed-to-Lead
- Slow follow-up → Sales Closer
- No sales team → Nurture Specialist
- Framed as jobs-to-be-done, not product features

**How It Works preview** — Lightweight 3-step (teaser, links to full `/how-it-works`)

- Browse → Deploy → Earn trust
- Each step: large display number, short headline, 1-sentence description

**Agent preview cards** — 3 sales agents from DB

- Reuse `AgentMarketplaceCard` component
- Section headline: "Meet the team"
- "See all agents →" link to `/agents`

**Trust explainer** — Single focused section

- Headline: "Pricing that earns its way up"
- Copy: "Agents start free. As they prove themselves through real performance, they unlock more autonomy. You only pay for what's working."
- One visual: trust score progression (0 → 40 → 70 → 90+) as a simple horizontal bar or step indicator

**Bottom CTA** — Repeated from hero

- "Get early access" button → `/get-started`

---

### 2. How It Works (`/how-it-works`)

**Structure:**

**Hero**

- Headline: "How it works"
- Subhead: "Find the right agent, connect it to your channels, and let it earn autonomy through real performance."

**Intro line** (above the 3 acts)

- "From discovery to deployment to trusted automation."

**3-act explainer**

Act 1 — **Browse**

- Large display number: 01
- Headline: "Find the right agent for the job"
- Copy: "Every agent is built around a specific business outcome — qualifying leads, booking calls, re-engaging cold contacts. Browse by outcome, not by feature list."
- No screenshot needed; optional agent card preview

Act 2 — **Deploy**

- Large display number: 02
- Headline: "Connect it to your channels in minutes"
- Copy: "No code. Choose a channel (WhatsApp, Telegram, or web widget), connect it to your account, and the agent is live."
- Visual: 3 channel icons (WhatsApp, Telegram, web widget) → "Go live"
- Keep compressed — this is not integration documentation

Act 3 — **Earn trust**

- Large display number: 03
- Headline: "Earn trust. Earn autonomy."
- Copy (plain English): "Every agent starts supervised. It proves itself through real tasks — you review and approve its first actions. As its trust score climbs, it earns more operating freedom. You step in only when it flags something important."
- This is the strategic differentiator — make it land as the payoff, not a footnote

**Optional governance strip** (below 3 acts)

- Short, understated: "Switchboard's governance layer audits every action, tracks trust in real time, and puts humans back in control when it matters."

**Bottom CTA**

- Primary: "Browse agents" → `/agents`
- Secondary: "Join waitlist" → `/get-started`

---

### 3. Pricing (`/pricing`)

**Structure:**

**Header**

- Headline: "Pricing that grows with trust"
- Subhead: "Agents start free. As they prove themselves, they unlock more autonomy — and you only pay for what's working."

**Bridge sentence** (before table)

- "Every agent starts on Free. As it proves reliability, safety, and performance, it unlocks higher trust tiers with more autonomy."

**Tier table** — 4 columns: Free, Basic, Pro, Elite

Each column shows:

1. Tier name
2. Price / month
3. Trust score threshold (e.g., "Unlocks at 40+ trust")
4. Autonomy level (e.g., "Supervised", "Semi-autonomous", "Autonomous", "Fully autonomous")
5. Example permissions / operating range (3-4 bullets — what the agent can do independently at this tier)
6. CTA button

The **unlock mechanic and autonomy level are visually more prominent than the tier name**. The table is not a feature checklist — it's a trust progression story.

**Differentiator strip** (below table)

- "Unlike per-seat or per-call pricing, you pay more when your agent earns it. Agents that underperform stay on free."
- Visually distinct — pull-quote treatment or highlighted block

**Reassurance line** (below differentiator)

- "You can start free, monitor performance, and upgrade only when the agent has demonstrated it can handle more on its own."

**FAQ** — 4 questions

1. Can I downgrade an agent?
2. How does an agent earn trust?
3. Do I need a credit card to start?
4. What happens if an agent loses trust score?

**Bottom CTA**

- "Start with a free agent →" → `/get-started`

---

### 4. Agent Catalog (`/agents`)

**Structure:**

- Filter bar: category chips (Sales, Marketing, Support, Creative) + search input
- Grid of `AgentMarketplaceCard` components — real data from DB
- No auth required to browse
- Each card links to `/agents/[slug]`
- Empty state: "No agents listed yet" fallback

---

### 5. Agent Profile (`/agents/[slug]`)

Existing route at `(public)/agents/[slug]`. Check what's there and update or replace to match the marketing structure below. The existing page may have dashboard-internal framing that needs to be stripped.

**Sections:**

1. Header — name, category, trust score badge, "Get early access" CTA
2. Capabilities — 3-4 bullet list of what this agent does (outcome-led)
3. How it works — 3-step flow specific to this agent
4. Trust & pricing — which tier it starts at, what it unlocks
5. Channels — icons for supported channels (Telegram, WhatsApp, web widget)
6. FAQ — 3-4 agent-specific questions

Data: `AgentListing` model, slug-based lookup.

---

### 6. Get Started (`/get-started`)

**Two states** — same layout, toggled by `NEXT_PUBLIC_LAUNCH_MODE` env var (`"waitlist"` | `"live"`). Default is `"waitlist"`.

**State A: Pre-launch (current)**

- Headline: "Get early access"
- Subhead: "We're onboarding businesses one by one. We review every request personally and follow up with next steps."
- Two-column layout:
  - Left: email input + "Join waitlist" button
  - Right: one representative agent card (Speed-to-Lead) — makes the outcome concrete
- Trust signals below form (pre-launch appropriate):
  - "No credit card required"
  - "Early onboarding support included"
  - "We'll reach out when your access opens"
- No nav clutter — stripped-back layout

**State B: Post-launch**

- Same layout, CTA changes to "Create account" or "Book a demo"
- Trust signals update to: "No credit card required", "Cancel anytime", "Onboarding support included"

**Lead quality (optional):** small qualifier line: "Best for service businesses using chat, leads, or inbound sales." Not a required field — just sets expectations.

---

## Navigation Updates

**Desktop nav:**

```
[Switchboard]   Agents   How it works   Pricing   Sign in   [Get early access]
```

- "Sign in" as low-emphasis secondary text link (far right, before CTA)
- "Get early access" as amber pill button
- Scroll behavior: transparent → frosted/solid on scroll (already implemented)

**Mobile nav (hamburger):**

- Same 4 links + Sign in
- "Get early access" remains visually distinct (amber) in the stacked list — not just another text item

**Footer updates:**

- Add: Agents, How it works, Pricing, Get early access links
- Keep: "Build agents for the marketplace →" builder email link
- Keep: copyright

---

## Component Strategy

### New components

- `HomepageHero` (client) — dark hero with CSS animations, staggered fade-in on mount
- `ProblemSolutionStrip` (server) — 3-column outcome mapping
- `HowItWorksPreview` (server) — 3-step teaser for homepage
- `TrustExplainer` (server) — trust score progression visual
- `WaitlistForm` (client) — email input + submit, posts to `/api/waitlist` or mailto fallback
- `HowItWorksPage` sections — static server components
- `PricingTierTable` (server) — 4-column trust tier table
- `PricingFAQ` (server) — accordion or static list

### Reused components

- `AgentMarketplaceCard` — homepage preview, catalog, get-started right panel
- `LandingNav` — updated with new links
- `LandingFooter` — updated with new links

### Waitlist API

Simple `POST /api/waitlist` route in Next.js API routes:

- Saves `{ email, createdAt }` to DB via a new `WaitlistEntry` Prisma model — **requires a schema migration**
- Returns 200 on success, 400 on missing email, 409 on duplicate
- If DB not available at runtime, fallback: `mailto:hello@switchboard.ai` href on the button

**Schema addition required** (`packages/db/prisma/schema.prisma`):

```prisma
model WaitlistEntry {
  id        String   @id @default(cuid())
  email     String   @unique
  createdAt DateTime @default(now())
}
```

---

## What Is NOT Included

- Blog, docs, changelog — deferred
- Self-service deploy flow — deferred (needs working agents first)
- Agent demo embed / web chat widget — deferred (Track 2)
- Authentication on public pages — existing behavior unchanged
- Payments / subscription management — deferred

---

## Success Criteria

- All 6 pages render with real agent data (or graceful empty states)
- Homepage hero loads with staggered CSS animations
- "Get early access" CTA on every page routes to `/get-started`
- Waitlist form captures email and confirms submission
- Nav links work on desktop and mobile
- No auth required to browse any public page
- Existing authenticated routes unaffected
