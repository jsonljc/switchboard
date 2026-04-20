# Switchboard Public Website — Design Spec

**Date:** 2026-04-16
**Status:** Approved
**Author:** Jason

---

## Goal

Build a public-facing website for Switchboard within the existing `apps/dashboard` Next.js app, using the `(public)` route group. The site covers the full funnel: marketing homepage → agent browse → how it works → pricing → waitlist signup. Target buyer is SMB owners first (fitness studios, clinics, agencies), with marketing/growth teams and agent builders as secondary audiences.

CTA is "Get early access" (pre-launch waitlist). The deploy flow ships later once agents are working end-to-end.

---

## Visual Direction

**Inspired by Claude-style product design: warm, playful, editorial, human.**

The site should feel intelligent and optimistic — not an enterprise SaaS dashboard, not a heavy operator tool. The tone is closer to a thoughtful product studio than a compliance platform.

**Mood:** Soft, confident, characterful. Like someone who knows what they're doing but doesn't need to prove it.

**What to avoid:**

- Heavy operator/infra framing ("audit ledger," "governance layer," "trust threshold" as dominant visual language)
- Hard enterprise grid layouts — 4-column tables, dense feature checklists, rigid strips
- Dark hero as the primary visual statement — use light or very soft dark, not "terminal operator mode"
- Clutter and internal-tool chrome

**What to lean into:**

- Warm off-white / cream base — soft, breathable, inviting
- Editorial typography used expressively: oversized Cormorant headlines, asymmetric line breaks, italic accents with charm not just emphasis
- Soft shapes and abstract illustration moments — not mascots, not cartoon startup. Gentle geometric forms, color washes, product metaphors
- Amber used sparingly as a warm accent, not a dominant brand hammer
- More breathing room — generous whitespace, staged reveals, guided discovery
- Governance and trust framed as **reassurance**, not compliance theater: "it starts careful and earns confidence" not "audit trails and thresholds"
- Agent cards that feel **curated and characterful**, not database-driven
- Motion that is gentle and charming — staggered CSS fade-ins, subtle floats, no jarring transitions

**Typography intent:** Cormorant Garamond for display used at scale (5–7rem) with personality — line breaks that feel like breathing, not paragraph formatting. Inter body kept clean and light.

**Color principles:**

- Base: warm off-white / cream (existing parchment vars are fine)
- Hero: light or very-soft tinted background — not full dark. A pale amber wash or soft cream-to-white gradient is preferable to black.
- Accent: amber used at most in 1–2 moments per page — CTA button, key emphasis word, pulse dot
- Supporting palette: soft blues, warm greens, and muted rose can appear in agent role colors — follow existing character color system

**Illustration / visual language:**

- Abstract product illustrations: soft gradient shapes, overlapping circles, gentle line art suggesting connection and flow
- The "switchboard" metaphor can appear as subtle connection lines, node clusters, or routing paths — decorative, not diagrammatic
- Agent cards can have a small visual "character" element (the existing OperatorCharacter system) that gives them personality
- Trust progression: visual steps or a soft ladder/arc — not a bar chart or threshold table

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

**Hero** — Light, soft, warm — NOT dark. Cream or pale amber-wash background.

- Eyebrow: "AI Agent Marketplace" with small amber pulse dot — understated
- Headline (Cormorant, ~6–7rem, light weight): "Your AI sales team, ready in minutes." — "ready in minutes" in italic, slightly warm-accented. Let the Cormorant scale and weight do the work.
- Subhead: "Browse AI agents built for growth. Deploy to WhatsApp, Telegram, or your website. They qualify leads, book calls, and earn your trust over time."
- CTA: "Get early access" (amber pill button) + "Browse agents →" (ghost link)
- Social proof line: "Join 200+ businesses on the early access list" — small, muted
- Background: soft warm gradient (cream → white, or pale amber wash). Add an abstract illustration or soft geometric shapes (overlapping circles, gentle curves) as a decorative right-side visual moment — no dot-grid, no dark mode.
- Feel: like opening a well-designed book. Inviting and confident, not a terminal or dashboard.

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

**Tier progression** — 4 stages: Free, Basic, Pro, Elite

**Do not use a hard comparison table.** Render as 4 soft cards or progression blocks arranged horizontally (or in a 2×2 on mobile). Each card feels like a stage of confidence, not a plan grid.

Each card shows:

1. Tier name (smaller, secondary)
2. Price / month (placeholder values — mark as `[TBD]` in implementation)
3. Trust score threshold (e.g., "Unlocks at 40+ trust") — **most visually prominent element**
4. Autonomy level (e.g., "Supervised → Semi-autonomous") — second most prominent
5. 2–3 short capability lines (what the agent can do at this stage)
6. CTA button

Visual style: soft card backgrounds (slightly different tones — cream, warm gray, soft amber tint for highest tier). Gentle progression arrow or connecting line between cards to reinforce "this is a journey, not a plan selector."

The pricing page should feel like a trust story, not a spreadsheet.

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

Existing route at `(public)/agents/[slug]`. Check what's there and update or replace. The existing page may have dashboard-internal framing that must be stripped.

**Tone rules for agent profile pages:**

- No auth-era chrome (no "manage deployment" buttons, no internal status indicators)
- No operational jargon ("task queue," "approval posture," "autonomy level label") as primary UI — this is a product page, not an admin view
- Must read like a **product page**: what this agent does for you, how it works, what you get
- Governance/trust framing appears as reassurance ("starts supervised, earns autonomy") — not compliance language
- Warm, specific, outcome-led — describe what a business owner experiences, not what the system does internally

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
  - Left: email input + "Join waitlist" button (soft amber, not aggressive)
  - Right: one representative agent card (Speed-to-Lead) with OperatorCharacter visual — warm, characterful, concrete
- Trust signals below form (pre-launch appropriate):
  - "No credit card required"
  - "Early onboarding support included"
  - "We'll reach out when your access opens"
- No nav clutter — stripped-back layout
- **Tone:** "Come in" — welcoming and calm, not lead-capture transactional. The page should feel like an invitation, not a form.

**State B: Post-launch** (`NEXT_PUBLIC_LAUNCH_MODE=live`)

- Same layout structure
- CTA label changes: "Join waitlist" → "Create account"
- Form action: POST to waitlist API → redirect to auth signup
- Trust signals update to: "No credit card required", "Cancel anytime", "Onboarding support included"
- "Sign in" link becomes more prominent (existing users returning)

**Launch-mode diff summary:**

| Element       | waitlist mode        | live mode                        |
| ------------- | -------------------- | -------------------------------- |
| CTA label     | "Join waitlist"      | "Create account"                 |
| Form action   | POST `/api/waitlist` | Redirect to `/login?signup=true` |
| Trust signals | waitlist-appropriate | subscription-appropriate         |
| Right panel   | agent card (preview) | agent card (same)                |

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
