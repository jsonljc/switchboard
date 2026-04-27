# Homepage Redesign — Paid Alex Wedge

**Date:** 2026-04-20
**Scope:** Public homepage (`apps/dashboard/src/app/(public)/page.tsx`) and supporting components
**Goal:** Redesign the Switchboard homepage to sell the paid Alex booking agent to SMB service business owners through demonstrated outcomes, not explained features.

---

## Target Audience

SMB service business owners — non-technical, care about results (more leads, more bookings), need to understand value in 5 seconds. Examples: dental clinics, fitness studios, salons, real estate agents.

## Design Principles

1. **One visual idea per section** — no competing ornaments. Each section has one dominant visual move.
2. **Outcome-first, not feature-first** — sell booked appointments, not "AI agents."
3. **No fake proof** — no placeholder testimonials, no unvalidated metrics. Honest capability proof only.
4. **Approachable + different** — consumer-app simplicity with a touch of "this isn't like other AI sites."
5. **Product as demo** — the site shows the product working, not describes it.
6. **Restrained polish** — premium means confident and calm, not over-decorated.

## Visual System

- **Keep** the warm neutral "Stone & Weight" palette (#F5F3F0, #EDEAE5, #1A1714, #A07850 amber accent)
- **Keep** Inter + Instrument Sans typography
- **Add** dark sections (#1E1C1A) for contrast at key moments
- **Add** Framer Motion for scroll-driven animations (restrained — crossfade and slide, no zoom/bounce)
- **Add** amber (#A07850) as the single CTA color in the final section only
- **Simplify** — fewer inline styles, more Tailwind utility classes where practical

---

## Page Flow

```
Hero → Before/After → How It Works → Trust & Proof → Pricing → Final CTA → Footer
```

---

## Section 1: Hero

**Layout:** Split — left text, right interactive conversation demo.

### Left Side

- **Label:** "AI booking agents for service businesses"
- **Headline:** "Never miss a lead again."
  - `clamp(3rem, 5.5vw, 5.5rem)`, weight 700, tight letter-spacing
- **Subline:** "Reply in seconds, qualify leads, and book appointments on WhatsApp, Telegram, or your website."
  - Separate tiny line below: "While you sleep."
- **Primary CTA:** "See Alex in action →" (dark pill button, scrolls/focuses conversation demo)
- **Secondary CTA:** "How it works" (text link, scrolls to Section 3)
- **Proof line:** "Setup in minutes. Starts supervised. Stays in your control."
  - Note: Do NOT use "Free to start" or "No credit card required" unless literally true for the paid Alex wedge.

### Right Side: Interactive Conversation Demo

- Styled as a phone frame (rounded rect, subtle shadow, ~320px wide)
- WhatsApp-style conversation interface
- Header: "Alex - Speed-to-Lead" with green "Online" dot
- Pre-populated customer message: "Hi, I saw your ad for teeth whitening. How much is it?"
- Text input at bottom with placeholder "Type a message..."

**Conversation script (auto-plays after 3s if visitor doesn't type, or triggers on any input):**

1. Typing indicator appears (1.2s)
2. Alex: "Hi! Great timing — we're running a whitening special this month. Have you done whitening before, or would this be your first time?"
3. Pause (1.5s), customer auto-responds: "No, first time"
4. Typing indicator (1s)
5. Alex: "Perfect! Our first-timer package is $199 (normally $299). Want me to book you a free 15-min consultation this week?"
6. Pause (1.2s), customer: "Yes please, Thursday works"
7. Typing indicator (0.8s)
8. Alex: "I can lock in Thursday at 2pm for you. You'll get a confirmation on WhatsApp shortly."

- Total sequence: ~12 seconds with realistic typing delays
- Below the phone: "This conversation took 47 seconds. Your lead is booked."

**Implementation notes:**

- Component: `InteractiveConversationDemo`
- State machine: idle → playing → complete
- If visitor types, display their message as a customer bubble, then continue the scripted Alex response sequence from wherever it left off. No actual AI — purely scripted responses regardless of input.
- Typing indicator: 3 animated dots, subtle bounce
- Messages appear with fade-in + slide-up (small, 4-6px)
- Mobile: phone mockup sits below the text, full-width

---

## Section 2: Before/After Scenarios

**Layout:** Dark background (#1E1C1A). Three scenario strips stacked vertically.

**Section intro line (warm white #EDE8E1):**

> "What changes when leads get answered in seconds, not hours."

### Scenario 1: "The lead you lost"

- **Before (dimmed/muted treatment):**
  - Phone notification mockup: "New message from Sarah — 11:47 PM"
  - Copy: "You replied the next morning. She'd already booked elsewhere."
- **After (bright treatment):**
  - Conversation snippet: Alex responds at 11:47 PM, qualifies, books Tuesday 10am
  - Micro-detail: "Responded in 12 sec"
  - Outcome tag (amber): **"Booked in 90 seconds."**

### Scenario 2: "The follow-up that never happened"

- **Before:**
  - An old chat thread visual, last message 6 days ago, no reply
  - Copy: "Interested lead. Quote sent. Then silence."
- **After:**
  - Automated follow-up messages on day 2 and day 5, ending in a booking
  - Micro-detail: "Followed up on day 2 and day 5"
  - Outcome tag: **"Booking recovered."**

### Scenario 3: "The weekend you worked"

- **Before:**
  - Notification stack: 4 unread lead messages
  - Copy: "You were with family. Your leads were waiting."
- **After:**
  - Summary: Alex handled all 4 — 2 booked, 1 tagged for later, 1 filtered
  - Micro-detail: "4 leads handled on Saturday"
  - Outcome tag: **"Handled without you."**

**Visual approach per strip:**

- Horizontal split: before on left, after on right
- Before side: muted colors, slightly desaturated
- After side: warm tones, amber accent on outcome tag
- One dominant visual cue per side, one short line, one outcome
- On mobile: vertical stack (before above, after below)

**Implementation notes:**

- Each strip uses Intersection Observer for fade-in-on-scroll
- Before side fades in first, after side follows with slight delay (staggered reveal)
- Keep visuals simple — styled divs, not full mockup images

---

## Section 3: How It Works (Scrollytelling)

**Layout:** Warm background (#F5F3F0). Sticky phone mockup on right, 3 text steps scroll on left.

**Implementation:** Intersection Observer on the 3 text blocks. As each scrolls into viewport center, the phone cross-fades to the matching screen. Framer Motion for transitions — smooth crossfade, no janky snap.

### Step 1

- **Label:** "01 — Choose"
- **Heading:** "Start with the outcome you need."
- **Body:** "Lead qualification, appointment booking, or follow-up recovery. Pick the first workflow you want handled and deploy it in minutes."
- **Phone shows:** Agent selector — Alex is dominant/selected, secondary agents shown as coming soon or dimmed.

### Step 2

- **Label:** "02 — Connect"
- **Heading:** "Go live on the channels your customers already use."
- **Body:** "Connect WhatsApp, Telegram, or add a widget to your site. Once connected, your agent can start replying immediately."
- **Phone shows:** Channel picker — WhatsApp highlighted with "Connected" and green dot.

### Step 3

- **Label:** "03 — Trust"
- **Heading:** "Starts supervised. Earns speed."
- **Body:** "Every action begins with your approval. As your agent proves itself, you can review less and move faster — without giving up control."
- **Phone shows:** Conversation where Alex handled a lead, with approval prompt: "Alex wants to book Sarah for Thursday 2pm. Approve / Edit" — showing the human-in-the-loop moment.

**Below the steps:**

> "From setup to first live lead conversation: minutes, not days."

**Mobile behavior:** Phone sits inline between steps instead of sticky. Each step gets its own phone state directly below.

---

## Section 4: Trust & Proof

**Layout:** Warm background (#F5F3F0). Two layers.

### Sub-section A: Proof Bar

Horizontal strip, 4 proof points evenly spaced. Each has a small amber line icon (on faint amber circle) + text.

| Icon          | Metric                        | Label                               |
| ------------- | ----------------------------- | ----------------------------------- |
| Clock         | **Seconds**                   | Designed for instant first response |
| Moon/sun      | **24/7**                      | Lead coverage across your channels  |
| Shield-check  | **Approval-first**            | Every action can start supervised   |
| Channel logos | **WhatsApp - Telegram - Web** | Deploy where leads already come in  |

Icons: very restrained, amber stroke on transparent/faint fill. No heavy illustration.

### Sub-section B: Trust Cards

3 cards in a row. White background (#F9F8F6), 1px border (#DDD9D3). Each card has one small visual element above the copy.

**Card 1: "Answers when you can't"**

- Visual: Mini conversation snippet — customer message timestamped "11:47 PM", Alex reply timestamped "11:47 PM". Just the timestamps — the visual is the proof.
- Copy: "After hours, weekends, or during busy periods — Alex keeps leads from sitting unanswered."

**Card 2: "Follows up without dropping the ball"**

- Visual: Tiny timeline — 3 dots on a horizontal line: "Day 1: Quote sent" → "Day 3: Follow-up" → "Day 5: Booked". Last dot is amber.
- Copy: "Quotes, reminders, and re-engagement happen on time instead of getting lost in the day."

**Card 3: "Keeps you in control"**

- Visual: Compact approval prompt mockup — "Alex wants to send a booking confirmation to Sarah. Approve / Edit." Styled as a real notification.
- Copy: "Alex can start by asking before it books, tags, or follows up. You review less only when you want to."

**Visual noise rule:** Proof bar icons = very restrained. Trust card visuals = one focal cue only. Card copy = scannable in under 3 seconds.

**Quiet line below cards:**

> "Built on governed AI. Every action audited. Every decision reviewable."

---

## Section 5: Pricing

**Layout:** Warm background (#EDEAE5). Single centered pricing card, max-width ~480px.

### Headline & Subline

- **Headline:** "Simple pricing for your first booking agent."
- **Subline:** "Launch Alex on the channels your customers already use. Stay in control from day one, then automate more as trust builds."

### Pricing Card

- **Top:** Alex agent mark (existing character circle component) centered, with "Alex" and "Your first booking agent" below
- **Feature list** (each with small amber check icon):
  - Instant lead response
  - Lead qualification and booking flow
  - WhatsApp, Telegram, and web
  - Approval-first controls
  - Full audit trail
  - Human handoff when needed
- **Price:** "From $49/month" (or actual starting price)
- **CTA:** Full-width dark pill button — "Get started →"
- **Card styling:** White background, subtle border (test whether gradient border adds value or feels ornamental — default to simple 1px border). Slight shadow for elevation.

**Below the card:**

> "Need higher volume, custom workflows, or multiple agents? → Talk to us"

**Supporting note:**

> "No long setup project. No dev team required to get started."

### FAQ (Accordion)

Simple expand/collapse — each question is a clickable row, answer reveals below with smooth height transition.

1. **"Do I need a credit card to get started?"** — Answer depends on actual onboarding flow. Only say "No" if true.
2. **"Will Alex act without my approval?"** — No. Alex can start in supervised mode, with approval on every action.
3. **"What happens as I trust it more?"** — You can choose to review less and let routine actions run faster, while keeping exceptions visible.
4. **"Can I cancel anytime?"** — Yes (if true).

---

## Section 6: Final CTA

**Layout:** Dark background (#1E1C1A), mirroring Section 2's dark treatment for bookend effect.

- **Headline (warm white #EDE8E1):** "Your next lead is already waiting."
- **Subline (#7A736C):** "Get Alex live where your leads already come in."
- **CTA button:** Amber background (#A07850), dark text (#1A1714), pill-shaped. **"Get started →"**
  - This is the only amber-filled button on the entire page — the culmination.
- **Below button, very small (#7A736C):** "No dev team required."

---

## Navigation

**Simplify the current nav links to match the paid wedge:**

- Logo: "Switchboard" (unchanged)
- Links: "How it works" | "Pricing"
- Right: "Sign in" (if auth exists) | "Get started" (dark pill CTA)

Remove "Agents" link from nav — the homepage now sells Alex directly. The agents catalog page remains but isn't primary nav.

---

## Footer

Largely unchanged. Minor updates:

- Remove "Browse agents" link from Product column (or keep as secondary)
- Ensure footer links match the nav structure
- Keep governance tagline: "AI agents that earn autonomy through trust."

---

## Technical Implementation Notes

### New Dependencies

- `framer-motion` — scroll-driven animations, crossfade transitions, staggered reveals

### New Components

- `InteractiveConversationDemo` — phone mockup with scripted conversation and text input
- `BeforeAfterStrip` — single before/after scenario with staggered reveal
- `ScrollytellingPhone` — sticky phone with state transitions driven by scroll position
- `ProofBar` — horizontal metrics strip with icons
- `TrustCard` — capability card with mini visual
- `PricingCard` — single product card with Alex identity
- `FaqAccordion` — expand/collapse question list

### Modified Components

- `HomepageHero` — full rewrite to new layout
- `LandingNav` — simplified links
- `LandingFooter` — minor link updates

### Removed Components (from homepage)

- `HeroCardCluster` — replaced by conversation demo
- `AgentMarketplaceCard` (homepage usage only) — replaced by pricing card
- `CategoryTabs` — not used in new flow

### Animation Approach

- Intersection Observer for scroll-triggered reveals
- Framer Motion for:
  - Conversation message appear (fade + slide, 4-6px)
  - Scrollytelling phone transitions (crossfade, ~300ms)
  - Before/after staggered reveal
  - FAQ accordion height animation
- Keep all animations under 600ms. No bounce. No zoom. Ease-in-out only.
- Respect `prefers-reduced-motion` — disable all animations.

### Responsive Behavior

- Hero: stacks vertically on mobile (text above, phone below full-width)
- Before/After: vertical stack per strip (before above, after below)
- Scrollytelling: phone inline between steps instead of sticky
- Trust cards: single column stack
- Pricing card: full-width with padding
- Proof bar: 2x2 grid on mobile instead of 4-across

### Pages NOT Changed in This Spec

- `/agents` catalog page — remains as-is
- `/agents/[slug]` detail page — remains as-is
- `/how-it-works` — remains as-is (homepage scrollytelling is a summary; full page has more detail)
- `/get-started` — remains as-is (waitlist form)
- `/pricing` — remains as-is (full pricing page can show more detail than homepage summary)
- All authenticated dashboard pages — no changes

---

## Success Criteria

For an SMB service business owner landing on this page:

1. **5-second test:** Can they articulate what the product does? ("It answers my leads and books appointments")
2. **Aha moment:** Does the interactive demo make them think "I need this"?
3. **Trust:** Do they feel confident this is controlled and safe, not a black-box AI?
4. **Action:** Is the path to getting started obvious and low-friction?
5. **Differentiation:** Does the page feel different from generic AI/SaaS landing pages?
