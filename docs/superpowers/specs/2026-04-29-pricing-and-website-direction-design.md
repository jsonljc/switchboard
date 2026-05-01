# Pricing & Website Direction — Per-Agent Hires

**Date:** 2026-04-29
**Scope:** Pricing model and public-facing marketing site (`apps/dashboard/src/app/(public)/page.tsx` and supporting `apps/dashboard/src/components/landing/*`).
**Goal:** Reposition Switchboard from "an AI revenue operator" (single product) to "hire your revenue desk, one agent at a time" (per-agent product). Update pricing to reflect honest per-agent COGS, and rebuild the landing page to match.

This spec supersedes the pricing details in `2026-04-20-homepage-redesign-design.md`. The visual system (warm neutrals, editorial type, restrained motion) and several sections (notably "Built so you stay in control") carry forward unchanged.

---

## 1. Pricing Model

### Structure

Per-agent base pricing with bundle discounts and a 14-day pilot. The "Solo / Duo / Team" naming is retained as **bundle labels**, not as feature tiers.

| Component                         | Base                   | Included                                     | Overage                                     |
| --------------------------------- | ---------------------- | -------------------------------------------- | ------------------------------------------- |
| **Alex** (lead replies)           | $199/mo                | 1,500 conversations                          | $0.15 / conversation                        |
| **Nova** (ad optimizer)           | $149/mo                | $5,000 managed ad spend + 200 operator chats | 0.75% of incremental spend / $0.20 per chat |
| **Mira** (creative pipeline)      | $249/mo                | 500 credits                                  | $0.50 / credit                              |
| **Bundle: any 2 agents**          | −15% off combined base | —                                            | —                                           |
| **Bundle: all 3 agents ("Team")** | −25% off combined base | —                                            | —                                           |
| **Pilot**                         | $199 / 14 days         | Light caps across all 3 agents               | —                                           |
| **Enterprise**                    | Custom                 | —                                            | —                                           |

### Mira credit table

The "credit" unit is the only honest meter for creative generation because per-generation cost varies ~100× by media type.

| Generation type                         | Credits |
| --------------------------------------- | ------- |
| Image (DALL-E, Imagen, etc.)            | 1       |
| Avatar video (HeyGen, etc.)             | 20      |
| Short video (Runway Gen-3, Kling, etc.) | 10      |
| HD video (Sora, Veo, etc.)              | 50      |

500 credits = 500 images, OR 50 short videos, OR 10 HD videos, OR a realistic mix. Credits do not roll over.

### Why this shape

- **Each meter matches the COGS shape of its agent.**
  - Alex: high conversation volume, moderate per-message LLM cost → soft caps with conversation-level overage.
  - Nova: heuristic-driven analysis (no LLM in the analytical path — verified in `packages/ad-optimizer/src/recommendation-engine.ts`); LLM is only the conversational layer. Overage is value-based (% of managed spend), not cost-based.
  - Mira: low volume, highly variable per-generation cost → credits are the only honest unit; hard cap with "buy more" prompt is mandatory to prevent runaway COGS.
- **Per-agent pricing matches per-agent positioning.** The landing page sells three named hires; the pricing card mirrors that exactly.
- **Bundle discounts preserve the upsell path** without forcing customers into pre-defined tiers that mis-price their actual agent mix.

### Pilot economics

$199 / 14 days is approximately break-even or slightly negative on COGS. It is a customer-acquisition mechanism, not a margin product. **Required:** instrument pilot-to-paid conversion rate. If conversion < 40% after 50 pilots, revisit pricing or pilot duration.

### Mandatory implementation guardrails

These ship with the pricing change, not after.

1. **Hard usage caps in product**, not just on the marketing page. Especially Mira credits. At 70/90/100% of cap, surface in-product prompts: _"You're at 90% of this month's credits. Buy 100 more for $50, or upgrade to a bundle."_
2. **Per-tenant COGS instrumentation** from day one — token spend, generation count by media type, conversation volume, managed ad spend. Without this, you cannot validate whether the pricing model holds after 30–50 paying customers.
3. **Surprise bills are existential.** Email warnings at 70/90/100% are non-negotiable. A single $2k surprise overage bill ends customer trust faster than underpricing ends margin.

### Bundle math examples (for the landing page footer copy and FAQ)

- **Alex + Nova (2-agent bundle):** $199 + $149 = $348 → −15% = **$295.80/mo**
- **Alex + Mira (2-agent bundle):** $199 + $249 = $448 → −15% = **$380.80/mo**
- **Nova + Mira (2-agent bundle):** $149 + $249 = $398 → −15% = **$338.30/mo**
- **All three ("Team"):** $199 + $149 + $249 = $597 → −25% = **$447.75/mo**

### Things explicitly out of scope for this spec

- Billing infrastructure, Stripe integration, dunning, proration logic — handled in the implementation plan.
- Free tier — none. Pilot is the entry point.
- Tier-based feature gating — there is none. All agents have all their features at the per-agent base price; differences are usage-cap and overage-rate, not feature surface.

---

## 2. Positioning Shift

**From:** "An AI revenue operator for service businesses."
**To:** "Hire your revenue desk. One agent at a time."

The new positioning is per-agent. Each agent is a named, distinct hire with one job and its own price. The bundle is a discount on hiring multiple, not a separate product.

### Why this is defensible

1. **It matches the per-agent pricing model exactly** — the page and the bill tell the same story.
2. **It's harder to copy.** Competitors sell "AI assistants" and "AI agents" generically. Switchboard sells named characters with distinct jobs and personalities.
3. **It carries the existing "operator-led" governance frame.** Alex/Nova/Mira are individually approval-first, individually auditable, individually controllable. The desk metaphor reinforces, doesn't replace, the existing Doctrine.
4. **The "they share what they learn" beat creates a synergy story** that justifies the bundle without forcing it. Buyers can rationally hire one agent and rationally upgrade to two or three.

---

## 3. Page Structure

```
Nav
  ↓
Hero (rotating per-agent toggle, single focal point)
  ↓
Synergy beat (~80 words + diagram, "they share what they learn")
  ↓
Alex story (text left, phone-frame conversation right)
  ↓
Nova story (full-bleed dashboard fragment, text floating right)
  ↓
Mira story (storyboard reel left, text right) — conditional, see §4.5
  ↓
"Built so you stay in control" (existing accordion section, unchanged)
  ↓
Pricing (three agent cards, bundle savings line below)
  ↓
Editorial closer (single line, parallel to hero, not a black slab)
  ↓
Footer (unchanged)
```

---

## 4. Section Specifications

### 4.1 Nav

Unchanged from current implementation. Links: _How it works · Pricing · Sign in · Get started_. The "Get started" CTA in the nav routes to the same flow as the hero's primary CTA (defaults to Alex on first visit).

### 4.2 Hero

**Replace the current dial widget + "Never miss a lead again" hero entirely.**

#### Structure

- **Headline (rotates with toggle):**
  - Alex (default): _"Alex replies in twelve seconds."_
  - Nova: _"Nova catches what you miss."_
  - Mira: _"Mira ships what you can't."_
- **Subline (constant, does not rotate):**
  > "Hire one. Or hire the desk — they share what they learn."
- **Agent toggle:** three small character marks below the subline, labeled `Alex · Nova · Mira`. Click swaps headline + character mark + primary CTA in place. Toggle is the page's single most important interaction — it teaches the per-agent product structure by demonstration.
- **Primary CTA (rotates):** _"See Alex work →"_ / _"See Nova work →"_ / _"See Mira work →"_ — scrolls to the matching agent's story section.
- **Secondary CTA (constant):** _"Or meet the desk →"_ — scrolls to the synergy section or pricing.
- **Proof line (constant):** _"Setup in minutes. Approval-first. Stays in your control."_

#### Default behavior

- First visit: Alex selected by default. Alex is the wedge agent (lead response is universal).
- Return visits: last-selected agent is restored from `localStorage` (key: `switchboard.landing.agent.v1`).

#### Animation

- Headline + character + CTA crossfade on toggle (~200ms, ease-in-out).
- No carousel auto-rotation. The toggle is user-driven only.

### 4.3 Synergy beat (new section)

A short section immediately after the hero, before the three agent stories. Its single job is to plant the bundle thesis without bloating the hero.

- **Layout:** centered, narrow column (`content-width`, ~42rem max).
- **Headline:** _"They're better together."_
- **Body (~80 words):**
  > Alex sees a lead asking about a product Nova is currently advertising — and tells Nova which audience converted. Nova spots a saturated ad set — and tells Mira which angle to retire. Mira ships a new variant — and Alex knows how to talk about it. The desk shares one memory.
- **Diagram:** three character marks connected by faint lines. Each line is labeled with what flows between them:
  - Alex → Nova: _"converting audiences"_
  - Nova → Mira: _"angles to retire"_
  - Mira → Alex: _"how to pitch new creative"_
- Diagram is static SVG, not interactive. Restrained — the three marks are smaller than in the hero, the lines are thin and warm-gray.

### 4.4 Alex story section

- **Section label:** `a 01 / · alex · lead reply`
- **Layout:** text left (~40%), phone-frame conversation right (~60%).
- **Headline:** _"Leads die in twelve minutes. Alex replies in twelve seconds."_ (the current strongest line, promoted into Alex's section).
- **Body (~3 sentences):** "Across WhatsApp, Telegram, and your site. Sleeps zero. Qualifies through natural conversation, books to your real calendar, hands off the ones that need a human."
- **Phone frame:** WhatsApp-style conversation with real timestamps. Conversation script as in the prior `2026-04-20-homepage-redesign-design.md` spec, ending in a booking confirmation. _Reuse the existing `InteractiveConversationDemo` component if it shipped; otherwise a static styled mockup is acceptable for v1._
- **Bullets (below body):**
  - 12-second median first reply
  - Qualifies through natural conversation
  - Books to your real calendar
  - Handoff path you control
- **Section CTA:** _"See Alex →"_ — links to a deeper Alex page (or, if not yet built, the pricing card).

### 4.5 Nova story section

- **Section label:** `a 02 / · nova · ad optimization`
- **Layout:** full-bleed horizontal section (page-width, breaks the content-width column). Dashboard fragment dominates ~70% of the section width, text floats to the right or overlays a quiet area.
- **Headline:** _"Bad ad sets don't pause themselves. Nova noticed before you did."_
- **Body (~3 sentences):** "Period-over-period diagnosis on Meta. Drafts the shifts. Never auto-publishes. You review. You publish. Or you don't."
- **Dashboard fragment:**
  - Realistic anonymized Meta campaign table.
  - 4–5 rows. One row visually marked (red highlight or strikethrough) — the paused ad set Nova flagged.
  - Period-over-period delta columns (CPA Δ, CTR Δ, ROAS Δ) with up/down arrows in warm/cool tones.
  - Margin annotation from Nova ("Period-over-period CPA up 38% vs. 7-day baseline. Recommend pause.").
  - **Credibility rule:** plausible campaign names (e.g., "Whitening — CTWA," "Cleaning retarget"), realistic numbers (CPA $25–80, ROAS 1.5–3.5x). No `Lorem` or `$$$` placeholders. If real-looking data cannot be sourced from a sandboxed account, the implementation plan must call this out as a blocker.
- **Bullets (below body, optional — match Alex's rhythm):**
  - Period-over-period diagnosis
  - Drafts. Never auto-publishes
  - Connects to Meta Ads via OAuth
  - Works inside your spending limits
- **Section CTA:** _"See Nova →"_

### 4.6 Mira story section

- **Section label:** `a 03 / · mira · creative pipeline`
- **Layout (default):** text right (~40%), horizontally scrolling storyboard reel left (~60%).
- **Headline:** _"Your next ad has been 'almost ready' for two weeks. Mira ships while you're in a meeting."_
- **Body (~3 sentences):** "Trend scan, hook generation, scripts, storyboards, video. Stops at any stage and takes what fits. You stay director — Mira never auto-publishes."
- **Storyboard reel:**
  - 5–6 horizontal frames: brief → trend insight → script → storyboard → video draft → published clip.
  - Each frame is a discrete card with one creative artifact and a one-line label.
  - Auto-scrolls slowly (~6s per frame) or scrolls on hover. Respects `prefers-reduced-motion`.
- **Bullets (below body):**
  - Trend scan → hook generation
  - Scripts, storyboards, video drafts
  - Stop at any stage and take what fits
  - You stay director, always
- **Section CTA:** _"See Mira →"_

#### Conditional fallback

The storyboard reel requires real creative artifacts. If the creative pipeline (`packages/creative-pipeline/`) has not shipped enough real output to populate 5–6 plausible frames at landing-page launch:

- **Fallback layout:** Mira section becomes text right (~40%), static three-frame strip left (~60%) showing only brief → script → published clip.
- **Headline and body unchanged.**
- The fallback ships first; the full storyboard reel is a follow-up once real samples exist.
- The implementation plan must check whether real artifacts exist and choose the layout accordingly. **Stock-photo placeholders are not acceptable** — they undermine the credibility the per-agent positioning depends on.

### 4.7 Coherence rules across the three story sections

These are the rules that keep editorial calm intact while breaking the rhythmic monotony of the current page.

| Element                                                | Rule                                                                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------- |
| Typography (headline, body, bullets, label)            | **Identical** across all three sections                                    |
| Color palette                                          | **Identical** — warm white background, amber accent on outcome words only  |
| Section labels (`a 0X / · agent · job`)                | **Identical** format and treatment                                         |
| Layout (column-weight ratio, full-bleed vs. contained) | **Different per agent** — this is the variation lever                      |
| Artifact (phone / dashboard / storyboard)              | **Different per agent** — matches the kind of evidence each agent produces |
| Bullets                                                | Same shape (4 short lines), different content                              |
| Section CTA                                            | Same shape (_"See [Agent] →"_), routes differ                              |

### 4.8 "Built so you stay in control" section

Unchanged from current implementation. The accordion (Approval-first / Audited / Where your work lives / Hands-off when ready) is working and reinforces the governance frame the per-agent positioning depends on.

### 4.9 Pricing section

**Replace the current single-card pricing entirely.**

#### Layout

- **Headline:** _"Hire one. Or hire the desk."_
- **Subline:** _"Each agent does one thing exceptionally. Bundle when you're ready — they share what they learn."_
- **Three agent cards in a row** (stack on mobile):

  | Card | Price headline | Sub-line                            | Bullets                                                                                            | CTA                   |
  | ---- | -------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------- |
  | Alex | **$199**/mo    | "Replies to leads in seconds"       | 1,500 conversations · WhatsApp + Telegram + Web · Approval-first · Books to your calendar          | _"Start with Alex →"_ |
  | Nova | **$149**/mo    | "Catches bad ad sets before you do" | $5,000 managed ad spend · Period-over-period diagnosis · Never auto-publishes · Meta Ads connected | _"Start with Nova →"_ |
  | Mira | **$249**/mo    | "Ships creative while you're busy"  | 500 credits · Image, video, storyboard · Stops at any stage · You stay director                    | _"Start with Mira →"_ |

- Each card: agent character mark at top, name + price + sub-line + 4 bullets + CTA.
- Card styling: white background, 1px warm-gray border, subtle shadow, no gradient. Default agent (Alex) gets a faint amber border to suggest "start here," but no "Most popular" badge.
- **Below the row of cards, a single subtle line:**
  > _"Pick any two → save 15% · Hire all three → save 25% · 14-day pilot of the desk: $199 · Talk to us about Enterprise"_
- **Optional small link below:** _"Not sure where to start? → We recommend Alex."_ This is a static link to Alex's pricing card (or scrolls/focuses it), not an interactive recommender tool.

#### Overage details

Do not put the overage table on the pricing card itself. Use an expander (_"What happens if I go over?"_) that reveals the overage rates from §1. Overage anxiety on the card kills conversion.

### 4.10 Editorial closer (replaces black-slab section)

**Remove the current `Wake up to booked calls` black-slab closer entirely.**

- **Layout:** same warm background as the rest of the page.
- **Headline (large but not billboard-scale):** _"Hire your first agent. Live in a day."_
- **Below:** the same agent toggle from the hero, repeated. Three small marks, click selects the agent, primary CTA reads _"Start with [Agent] →"_.
- **Toggle state:** the closer toggle reads from and writes to the same `localStorage` key as the hero (`switchboard.landing.agent.v1`). Selecting an agent in the hero updates the closer's selection, and vice versa, without a page reload. Both toggles always reflect the same agent.
- **Quiet line below the toggle:** _"Or meet the desk →"_.
- **Parallel structure:** the closer mirrors the hero ("Hire one. Or hire the desk." → "Hire your first agent. Live in a day."). Same voice, same toggle. The page is bookended editorially, not dramatically.

### 4.11 Footer

Unchanged from current implementation.

---

## 5. Visual System (carries forward)

- Warm neutral palette (`#F5F3F0` warm white, `#1A1714` dark text, `#A07850` amber accent).
- Inter (body) + Cormorant Garamond / Instrument Sans (display) — match current `font-display` class.
- Restrained motion: crossfades, fades, slides under 6px. No bounce, no zoom. Respect `prefers-reduced-motion`.
- The amber accent is used sparingly: outcome words in headlines (e.g., _"twelve **seconds**"_), the active toggle indicator, the Alex card's faint border. **No amber-filled buttons** anywhere — the dark pill remains the primary CTA style.
- Dark sections are removed entirely from this page (the black-slab closer was the only one and it's been cut).

---

## 6. Components

### New components

- `AgentToggle` — three-mark selector with labels, controlled by parent state, persists selection to `localStorage`. Used in hero and closer.
- `RotatingHero` — wraps `AgentToggle`; renders headline + character mark + primary CTA based on selected agent.
- `SynergyBeat` — short section component with the three-mark diagram and labeled lines.
- `NovaDashboardFragment` — anonymized Meta campaign table mockup with annotation.
- `MiraStoryboardReel` — horizontally scrolling reel of 5–6 creative-artifact cards. Has a `fallback` prop that renders the static three-frame strip when real artifacts aren't available.
- `AgentPricingCard` — single card; the pricing section composes three of these.

### Modified components

- `HomepageHero` (or current hero) — full rewrite using `RotatingHero`.
- `PricingSection` — full rewrite.
- `LandingNav` — no structural change.
- `LandingFooter` — no change.

### Removed components (from homepage)

- The current dial-widget hero element.
- The current single-card pricing component.
- The "Wake up to booked calls" closer.

The three story sections (Alex/Nova/Mira) replace the current three-section storytelling block but reuse the section-label and typography primitives.

---

## 7. Success Criteria

For an SMB service business owner landing on this page:

1. **5-second test:** Can they articulate the product? _"They have three AI agents — one for leads, one for ads, one for creative. You can hire them individually or as a team."_
2. **Hero toggle interaction:** Within ~10 seconds, do they click at least one alternate agent in the hero toggle? (Instrument click-through rate per agent.)
3. **Pricing scannability:** Can they tell which agent matches their problem and what it costs in <15 seconds? (Pricing card hover/scroll telemetry.)
4. **Trust:** Does the per-agent framing reinforce, not undermine, the governance/approval-first positioning?
5. **Conversion:** Pilot signup conversion rate from landing page ≥ industry SMB benchmark (~2–4%). Pilot-to-paid conversion ≥ 40%.

---

## 8. Out of Scope

This spec covers the public marketing landing page and the pricing model. **Out of scope** (handled by separate plans/specs):

- Billing system implementation (Stripe, dunning, proration).
- In-product cap enforcement and "buy more" prompts.
- Per-agent deep pages (`/agents/alex`, `/agents/nova`, `/agents/mira`) — the section CTAs link to these, but their content is its own spec.
- Onboarding flow changes for per-agent purchase paths.
- COGS instrumentation and dashboards.

**Hard release dependencies** — the new pricing on the marketing page **must not go live** until the following ship in parallel work:

1. Billing system supports per-agent purchase, bundle discounts, pilot, and metered overage.
2. In-product hard caps + 70/90/100% warnings + "buy more" prompts are live for all three agents (especially Mira credits).
3. Per-tenant COGS instrumentation is recording token spend, generation count by media type, conversation volume, and managed ad spend.

Until those three ship, the marketing page can be built and merged behind a feature flag, but the public-facing prices must remain at the current values. Shipping new prices on the page without product enforcement creates surprise-bill risk that the spec's pricing math depends on avoiding.

---

## 9. Open Questions for Implementation Plan

1. Does `InteractiveConversationDemo` from the 2026-04-20 spec exist in code, or does the Alex story need a static phone mockup as v1?
2. Are real Meta campaign artifacts available (anonymized) for Nova's dashboard fragment, or does the implementation plan need to include a "build a credible mock dataset" task?
3. Has the creative pipeline shipped enough real artifacts to populate Mira's storyboard reel, or does the section ship in fallback (three-frame static strip) form?
4. Does the existing `localStorage` identity key (`switchboard.identity.v1`) conflict with the new `switchboard.landing.agent.v1` key? Both are read on landing-page mount.
5. What's the routing target for the per-agent CTAs (_"See Alex →"_) — agent detail pages, pricing card focus, or pilot signup?

The implementation plan should resolve these before the first PR.
