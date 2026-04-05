# Marketplace Landing Page Design Spec

## Overview

The landing page IS the marketplace. Not a marketing page that describes agents, not a dashboard that requires context, not a catalog of static listings. A living marketplace where AI agents have profiles, trust scores, work logs, and you can hire them.

**Mental model:** Fiverr for AI agents, with Mission Control data baked into every listing.

**What makes it not an ad:** The content is real product data — trust scores earned through work, conversation transcripts, task completion rates. The marketing wrapper is two lines of text and a sign-in button. Everything else is the product itself.

**Target audience:** SMB owners who want AI to run business operations.

**Tone:** Claude-style — warm, conversational, serious when it matters, playful when there's room. The agents have personality. The page has minimal copy. The product speaks.

---

## Page Structure

```
Header           — Switchboard wordmark + Sign in
Hero             — "Meet your team." + one line of context
Category tabs    — Sales (live) | Creative | Trading | Finance
Featured bundle  — Sales Pipeline team card with demo stats
Agent cards      — 3 individual profiles with live data
Footer           — Minimal (same as current)
```

For coming-soon tabs: character + description + email capture.

Each agent card links to a full profile page at `/agents/[slug]`.

---

## Route Architecture

Builds on the existing `(public)` / `(auth)` route group split.

```
apps/dashboard/src/app/
├── (public)/
│   ├── layout.tsx              — existing (nav + footer + auth detection)
│   ├── page.tsx                — marketplace landing (REPLACE current)
│   └── agents/
│       └── [slug]/
│           └── page.tsx        — agent profile page (NEW)
├── (auth)/
│   ├── layout.tsx              — existing
│   ├── dashboard/page.tsx      — existing
│   ├── deploy/
│   │   └── [slug]/page.tsx     — deploy flow page (NEW)
│   └── ... (existing auth pages)
```

- `/` — marketplace browse (public, no auth)
- `/agents/speed-to-lead` — agent profile (public, no auth)
- `/deploy/sales-pipeline-bundle` — deploy flow (auth required)

---

## Section Details

### 1. Header

Same as current `LandingNav`. Transparent-to-solid on scroll. "Switchboard" wordmark left, "Sign in" / "Dashboard" right.

No changes needed.

### 2. Hero

Minimal. Two lines.

**Headline:** "Meet your team." — Cormorant Garamond, `clamp(2rem, 4vw, 3rem)`. Centered. Warm, not corporate.

**Subline:** "Browse AI agents. Deploy them to your business. They earn your trust over time." — Inter, muted. Explains the model in one sentence: marketplace (browse/deploy) + governance (earn trust) + expectation setting (over time).

No characters in the hero. No CTAs. The marketplace below IS the CTA.

### 3. Category Tabs

Horizontal tab bar below the hero.

```
Sales ●       Creative       Trading       Finance
3 agents      coming soon    coming soon   coming soon
```

- Green pulsing dot next to "Sales" — indicates live. Not a badge, just a dot.
- Active tab has underline or subtle background highlight.
- Coming-soon tabs are styled in muted text.
- Clicking a coming-soon tab transitions the content area below to show:
  - That family's agent character (muted, slow breathing, opacity 0.4)
  - One-line description: "Creative agents — content, social media, ad copy."
  - Email input: "Get notified when Creative launches"
  - Social proof counter: "34 people waiting" (increments as emails are collected)

**Data:** Tab metadata comes from `AgentListing` records. Sales Pipeline agents have `status: "listed"`. Future families have `status: "pending_review"`. The tab component queries listings grouped by family/category.

### 4. Featured Team Bundle

A wide card introducing the Sales Pipeline as a coordinated team.

**Content:**

- "Sales Pipeline" — title in display font
- "3 agents, one pipeline. Leads come in, calls get booked." — one-line description
- Three agent characters in a row, connected by arrow lines showing handoff flow: Speed-to-Lead → Sales Closer → Nurture Specialist
- Agent names below each character with one-word role: "qualifies" / "closes" / "re-engages"
- Demo label: "Demo: Austin Bakery Co" — transparent about being a showcase
- Stats line: "last 24h · 12 leads · 3 calls booked · 0 errors" — Space Mono numbers
- CTA: "Deploy this team" — primary button

**Card style:** `--surface` background, `--radius-lg`, subtle border. The arrow connectors between characters use `--border` color with small chevrons.

**Characters:** Smaller than in the individual cards (~80px). All three fully colored (not muted) since they're all live. Subtle float animation.

### 5. Individual Agent Cards

Three cards below the bundle. Each is a marketplace listing with live Mission Control data.

**Card contents (top to bottom):**

1. **Character** — ~120px, breathing aura, full color. Role-specific colors (Speed-to-Lead = leads/purple, Sales Closer = closer/green, Nurture = nurture/amber).
2. **Name** — display font, medium weight.
3. **Trust score** — pixel-segmented bar (8-bit style, 10 segments) + numeric score + delta ("+3"). Space Mono for numbers.
4. **Autonomy badge** — "Supervised" / "Guided" / "Autonomous". Small, muted.
5. **Description** — 2 lines max. What the agent does. Inter, small.
6. **Divider** — subtle `--border-subtle` line.
7. **Today section** — "today" label in small caps, then 2-3 stat lines: "12 qualified", "98% approved", "last active 3m". Space Mono numbers, Inter labels. All muted color.
8. **Divider**
9. **Actions** — "Hire" (primary small button) + "See work →" (text link)

**Card style:** `--surface` background, `--radius-lg`, subtle border. Hover: slight elevation/shadow increase.

**Data source:** Agent cards pull from `AgentListing` (name, description, trust score, autonomy level) joined with `AgentTask` aggregates (today's counts) for the demo organization. The "last active" timestamp comes from the most recent task's `updatedAt`.

**Responsive:** 3-column on desktop (lg+), 2-column on tablet (md), single-column stacked on mobile.

### 6. Footer

Same as current `LandingFooter`. "Switchboard" / "Build agents for the marketplace →" / "© 2026 Switchboard". Stacks on mobile.

No changes needed.

---

## Agent Profile Page

Full page at `/agents/[slug]`. The agent's portfolio and proof page.

### Layout

```
[Back to marketplace ←]

[Character — large ~200px, breathing, full aura]

Agent Name
Trust 47 · ████████░░ · Supervised
Description paragraph.

[Hire this agent]

───────────────────────────────────────────────

Overview    |    Work log    |    Trust history

[Tab content]
```

### Overview Tab (default)

- **Stats row:** Response time (< 60s) | Tasks completed (23) | Approval rate (98%). Space Mono numbers, Inter labels.
- **Team context:** "Part of: Sales Pipeline team" with link to bundle. "Works with: Sales Closer, Nurture Specialist" with links to their profiles.
- **How it works:** Numbered steps explaining the agent's workflow. 3-4 steps. Plain language. E.g., "1. Lead fills out a form → 2. Agent qualifies through conversation → 3. Qualified → hands to Sales Closer → 4. Not ready → hands to Nurture Specialist."

### Work Log Tab

List of recent tasks from the demo account.

Each task entry:

- Status icon: ✓ (completed/approved), ✗ (rejected/disqualified), ⏳ (pending)
- Summary: "Qualified lead · 'Bakery in Austin, $500/mo budget'"
- Metadata: "3 min ago · 4 messages · approved"
- Expand button → reveals full conversation transcript

**Expanded conversation:** Chat-style layout. Lead messages on left (muted background), agent messages on right (surface background). Timestamps on each message. Agent character avatar next to agent messages.

**Honest display:** Show rejections and disqualifications alongside successes. "Disqualified · 'Student asking about internships'" with ✓ approved shows the agent made a correct call. Honesty builds trust.

### Trust History Tab

- **Sparkline chart:** Trust score over time, from 0 to current value. Shows the growth trajectory. Dots at each approval/rejection event.
- **Breakdown:** Total approvals, total rejections, current streak, highest score reached.
- **Autonomy progression:** Timeline showing when the agent moved from Supervised → Guided (if applicable). "Reached Guided at trust score 30 after 15 approved tasks."
- **Auto-approval note:** "Tasks are auto-approved when trust exceeds 30" — makes the governance system visible without explanation.

### Agent Profile Data

All data comes from the demo organization's records:

- `AgentListing` for static profile info
- `AgentTask` for work log entries
- `TrustScoreRecord` for trust history
- Conversation transcripts stored in task `output` field

---

## Deploy Flow

Auth-required page at `/deploy/[slug]`. Reached by clicking "Hire" on an agent card or "Deploy this team" on the bundle.

### Auth Gate

If not signed in, compact modal appears: "Sign in to deploy Speed-to-Lead." Google auth button + email option. After auth, redirect to `/deploy/[slug]`. No detour to dashboard.

### Step 1: Website Scan

```
Let's get Speed-to-Lead up to speed.

First, your website — I'll study up.
[https://                                    ]
[Learn my business →]
```

The agent's character is visible, small, breathing beside the form. The copy is in the agent's voice — warm, eager.

**Backend:** A server action or API endpoint fetches the URL, extracts text content (title, meta description, headings, body text — no JS rendering needed for v1), and sends it to Claude API with a prompt to extract: business name, what they sell, value proposition, tone, and pricing range. Returns structured JSON.

### Step 2: Review + Brief

```
Here's what I learned:

You're Austin Bakery Co. You sell custom wedding cakes
and pastries, with catering for events. Your vibe is
warm and personal. Orders range from $200–2,000.
                                                [edit]

────────────────────────────────────────────────────────

A few things that'll help me do great work:

What makes someone a good lead for you?
[Planning a wedding or event, budget over $300...    ]

When should I hand off to you?
☑ They're frustrated or upset
☑ They ask to speak to a person
☐ They mention a competitor
☐ Question outside my knowledge

Anything I should never say?
[Never promise same-week delivery...                 ]

Got a booking link?
[https://cal.com/austinbakery                        ]

────────────────────────────────────────────────────────

[Deploy — I'm ready to start →]
```

- The summary paragraph is conversational, not key-value pairs.
- [edit] opens the summary as editable fields if the AI got something wrong.
- The "few things" questions are phrased as what a new hire would ask.
- Escalation rules are checkboxes with sensible defaults pre-checked.
- All fields below the summary are optional. The agent works with just the website context.
- CTA speaks in the agent's voice: "Deploy — I'm ready to start →"

**Backend:** On submit, calls the existing `POST /api/marketplace/persona` endpoint to upsert the persona, then `POST /api/marketplace/persona/deploy` to create deployments. Same backend as the current deploy flow, just a better frontend.

### Post-Deploy

Redirect to the dashboard (`/dashboard`). The user sees their new agent(s) in Mission Control — trust score at 0, first task pending, character breathing. They're in the product now.

---

## Demo Data Strategy

The marketplace landing page shows data from a demo organization ("Austin Bakery Co"). This data must look real, fresh, and varied.

### Generation Approach

**LLM-generated at seed time.** A seed script uses Claude API to generate:

1. **20-30 conversations** across the three agents. Each conversation is a realistic lead interaction with natural language, varying scenarios (wedding planning, corporate event, birthday party, etc.), different outcomes (qualified, disqualified, booked, lost).

2. **Trust score progression** matching the conversation outcomes. Starting at 0, approvals add +3 (with streak bonuses), rejections subtract -10. The progression should reach a realistic score (40-55 range) after 20-30 tasks.

3. **Task records** with proper status, timestamps, and metadata.

### Freshness

Timestamps are stored as relative offsets (e.g., "task completed 180 minutes before current time") and rendered as relative strings ("3 hours ago"). This means the demo always looks active regardless of when the visitor arrives.

A daily cron job (or on-demand script) can regenerate conversations to keep the content varied. Not required for v1 — initial seed is sufficient.

### Seed Script Location

Extends the existing `packages/db/prisma/seed-marketplace.ts`. Adds a `seedDemoData()` function that:

1. Creates a demo organization ("Austin Bakery Co", `org_demo`)
2. Creates demo deployments for all three Sales Pipeline agents
3. Generates conversations via Claude API (or uses pre-generated fixtures as fallback if API is unavailable)
4. Creates `AgentTask` records with conversation transcripts
5. Creates `TrustScoreRecord` entries matching the task outcomes

### Demo Data Visibility

The public marketplace pages query data for `org_demo` only. This is a read-only, public view. No auth required to browse. The demo organization is never shown in the authenticated dashboard for real users.

---

## New Components

1. **`CategoryTabs`** — horizontal tab bar with live indicator, coming-soon state
2. **`TeamBundleCard`** — featured team card with characters, arrows, demo stats
3. **`AgentMarketplaceCard`** — individual agent card with trust bar, live stats, actions
4. **`TrustBar`** — pixel-segmented trust score visualization (8-bit style)
5. **`AgentProfileHeader`** — large character + name + trust + hire CTA
6. **`WorkLogList`** — expandable task list with conversation transcripts
7. **`ConversationTranscript`** — chat-style message layout
8. **`TrustHistoryChart`** — sparkline of trust score over time
9. **`DeployWizard`** — website scan + review + brief flow
10. **`ComingSoonFamily`** — character + description + email capture

### Reused from Current Implementation

- `LandingNav` — no changes
- `LandingFooter` — no changes
- `(public)/layout.tsx` — no changes (server-side auth, metadata, light mode)
- `useScrollReveal` — used for fade-in animations on marketplace elements
- `AgentFamilyCharacter` — used in coming-soon tab content (muted state)
- Root layout — no changes (fonts, QueryProvider)
- Space Mono, Cormorant Garamond, Inter fonts — all stay

### Removed

- `HeroSection` — replaced by minimal hero + marketplace content
- `TimelineSection` — replaced by Work Log on agent profiles
- `StatsSection` / `StatCard` — replaced by stats on agent cards + profiles
- `TrustSection` / `TrustCard` — replaced by trust scores on agent cards + profiles

---

## Typography

Same as current implementation:

- **Headlines:** Cormorant Garamond (`--font-display`)
- **Body/descriptions:** Inter (`--font-sans`)
- **Numbers/scores/timestamps:** Space Mono (`--font-mono`)

---

## Color

Uses existing design tokens. No new colors.

- Agent role colors from existing `--char-*` CSS variables
- Trust bar segments use `--foreground` (filled) and `--border` (empty)
- Live dot uses `--positive`
- Card backgrounds use `--surface`
- Page background uses `--background` (warm cream)

---

## 8-Bit Accent System

Carried over from original spec. Pixel accents appear in:

- Trust score bars (segmented fill)
- Numbers (Space Mono font)
- Status badges (chunky 2px borders)
- Live indicator dot

NOT in: characters (smooth SVGs), headlines, buttons, cards.

---

## Responsive Behavior

**Desktop (lg+):** Agent cards 3-column. Bundle card full-width. Profile page with sidebar for stats.

**Tablet (md):** Agent cards 2-column. Bundle card full-width. Profile page single-column.

**Mobile (sm):** Everything stacks. Agent cards single-column. Category tabs horizontally scrollable. Bundle card stacks characters vertically. Deploy form full-width.

---

## Accessibility

Same standards as original spec:

- `prefers-reduced-motion`: all character animations and scroll reveals respect it
- Focus-visible outlines on all interactive elements
- Semantic landmarks: `<header>`, `<main>`, `<footer>`, `<section>` with aria-labels
- Character SVGs remain `aria-hidden="true"` (decorative)
- Agent profile tabs use proper `role="tablist"` / `role="tab"` / `role="tabpanel"`

---

## Meta Tags

```ts
// (public)/page.tsx
export const metadata: Metadata = {
  title: "Switchboard — Meet your team",
  description:
    "Browse AI agents for your business. Deploy them in minutes. They earn your trust over time.",
};

// agents/[slug]/page.tsx — dynamic
export async function generateMetadata({ params }): Promise<Metadata> {
  return {
    title: `${agent.name} — Switchboard`,
    description: agent.description,
  };
}
```

---

## Future Enhancements (not in v1)

- **Agent character customization:** Allow agent builders to customize their agent's appearance — color palette, shape variant, emblem, aura style. Turns each marketplace listing into a visually unique identity. Tracked for builder-tools spec.
- **Search and filtering:** As the marketplace grows, add search, category filters, sort by trust score / price tier.
- **Reviews/testimonials:** Allow deployers to leave reviews on agent listings.
- **Third-party agent submissions:** Builder portal for external developers to list agents.
- **Pricing display:** Show price tiers on cards when monetization is active.

---

## What This Does NOT Include

- Blog or content pages
- Pricing page
- Builder signup flow
- Analytics/tracking
- A/B testing
- Dark mode for public pages
- Real-time WebSocket updates on demo data (relative timestamps are sufficient)
