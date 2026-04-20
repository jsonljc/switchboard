# Onboarding Redesign — Playbook-First, Scan-Assisted, Split-Screen Training

**Date:** 2026-04-20
**Status:** Design approved (architecture + UX treatment)
**Depends on:** Homepage redesign (PR #218), Alex wedge live wiring (PR #210)

---

## Problem

The current onboarding is a 3-step wizard (paste knowledge, pick channels, review/launch). It works but feels like admin setup — a sharp emotional drop from the polished homepage. The homepage says "this is sharp, modern, alive." The onboarding says "fill out these forms."

## Design Principle

**Homepage wow = attention and intrigue. App wow = confidence and delight in control.**

The wow comes from seeing Alex come alive, interacting with real previews, feeling progress, and watching setup choices visibly change behavior. Not from decorative animation or gratuitous polish.

The star of onboarding is the **playbook** — a structured, living document that represents Alex's understanding of the business. The website scan and conversational interview are input methods that help build it. The playbook is the source of truth.

## Core Model

**Playbook-first, conversation-shaped, scan-assisted.**

- Website scan creates a draft (lightweight — homepage + a few linked pages)
- Alex interviews the owner to fill gaps the scan couldn't resolve
- The owner reviews and edits structured state directly
- The playbook maps to existing config structures post-onboarding

The scan is the opening move, not the hero. If the scan finds little, the experience still works because Alex interviews from scratch.

**Internal north star:** Alex drafts your business playbook, you shape it, then you watch it work.

## Design North Star

**"Apple-guided, Stripe-disciplined, quietly magical."**

- **Apple** for flow: one thing at a time, calm confidence, large type, guided sequencing, trust through inevitability
- **Stripe** for control surfaces: spacing discipline, sharp information hierarchy, serious tone, confidence through clarity
- **Selective modern product magic** for delight: beautiful state changes at the right moments, not everywhere

During onboarding: Apple device setup designing an AI business assistant.
During daily operations: Stripe with a warmer, more conversational surface.
During magic moments: premium consumer app, but only in flashes.

---

## Visual Language System

Governs every onboarding screen. Layered on top of existing Stone & Weight tokens.

### Typography Hierarchy

Three levels only. Fewer decisions = calmer screens.

- **Page title:** Instrument Sans, 32px/40px, `--sw-text-primary`, semibold. One per screen. Large, confident, unhurried.
- **Section label:** Inter, 13px, `--sw-text-muted`, uppercase tracking 0.05em. Quiet structural markers. Used selectively — not forced on every label.
- **Body/input:** Inter, 16px/24px, `--sw-text-primary`. Generous line height. Never smaller than 16px anywhere in onboarding (prevents iOS zoom on input focus, respects non-tech users).

No 12px body text anywhere in onboarding. The only exception: badges ("Start here," "Test lead," "TEST LEAD") which are labels, not body copy.

### Spacing Philosophy

**Apple rule — let things breathe.** Every element gets more whitespace than feels necessary in a mockup.

- Section gaps: 48px minimum
- Card internal padding: 24px
- Between interactive elements: 16px minimum
- Screen edge padding: 24px mobile, 48px desktop
- Playbook panel: 32px internal padding (document feel, not sidebar)

**Stripe rule — alignment creates calm.** Everything on a screen shares one left edge where possible. No floating elements that break the grid. Cards align. Labels align.

### Motion Principles

Three tiers. Each has a strict purpose.

**Tier 1 — Structural transitions** (between screens, panel switches):

- Crossfade, 400ms, ease-out
- Screen-level: no sliding, no bouncing. Screens dissolve like turning a page.
- Local panels (slide-overs, tab content, expandable sections): slight slide allowed where it improves spatial understanding.

**Tier 2 — Feedback responses** (button states, status changes, confirmation):

- 200ms, ease-out
- Status dot color shifts (gray → amber → green): 600ms ease-in-out — trust transitions feel weighted, not snappy.
- Button press: subtle `scale(0.98)` on mousedown, release on mouseup. A press, not a bounce.

**Tier 3 — Magic moments** (scan findings appearing, playbook populating, launch sequence):

- Content fades in from 0 opacity over 300ms with simultaneous 4px upward translate
- Section left border briefly flashes amber (200ms on, 400ms fade out)
- The animation just makes sure the user notices. The content itself is the wow.

**Reduced motion:** All Tier 2/3 animations respect `prefers-reduced-motion` → instant cuts. Status changes still happen without animated transitions.

### Color in Onboarding

Existing Stone & Weight palette plus three onboarding-specific states:

- **Scan-populated fields:** `rgba(160, 120, 80, 0.06)` warm tint behind value. Disappears when user confirms.
- **Active section highlight:** Left border gets `--sw-accent` for 600ms, then fades to status color.
- **Ready state green:** `hsl(145, 45%, 42%)` — muted, confident. Not neon. Test carefully against warm stone palette; may need sage-leaning adjustment.

### CTA Color System

Intentional escalation through the onboarding:

| Screen                | CTA Style                                              | Rationale                        |
| --------------------- | ------------------------------------------------------ | -------------------------------- |
| Screen 1: Entry       | Dark neutral fill (`--sw-text-primary` bg, white text) | "Begin" — not a commitment       |
| Screen 2: Training    | Dark neutral fill                                      | "Continue" — still building      |
| Screen 3: Test Center | Dark neutral fill                                      | "Proceed" — still evaluating     |
| Screen 4: Go Live     | **Amber fill (`--sw-accent`)** — the only one          | "Launch" — the commitment moment |

This progression makes the launch button feel earned.

### Interactive Elements

**Buttons — two styles only in onboarding:**

- **Primary:** Dark neutral or amber (per CTA system above), 48px height, rounded-lg (8px), 16px+ horizontal padding. One dominant CTA per screen. Other actions can exist but must be clearly subordinate.
- **Secondary:** No fill, `--sw-text-secondary` text, same height. For "back" and alternatives.

**Input fields:** 48px height, 16px internal padding, `--sw-border` border, rounded-lg. On focus: border shifts to `--sw-accent` (200ms). Placeholder in `--sw-text-muted`. Plain label above, 8px gap. No floating labels.

**Cards:** `--sw-surface-raised` background, 1px `--sw-border`, rounded-xl (12px), 24px padding. No shadows in onboarding — flat cards with borders are calmer.

**Status dots:** 8px diameter, centered vertically with section label. Three states: gray/amber/green. No pulse animation.

### Density Escalation

The visual language adapts by product stage:

- **Onboarding:** Spacious. Maximum breathing room.
- **Post-launch dashboard:** Slightly denser, but still calm.
- **Operational screens (leads, approvals):** Denser still, but never cluttered.

---

## Information Architecture

```
/onboarding
  Screen 1: Entry          — "Let Alex learn your business"
  Screen 2: Training        — Split-screen (Alex chat + live playbook)
  Screen 3: Test Center     — "Try Alex before you go live"
  Screen 4: Go Live         — Channel activation + launch moment

Post-onboarding:
  Dashboard first-run layer — Welcome banner + guided first-week actions
```

**Routing:** The existing `AppShell` redirects to `/onboarding` when `onboardingComplete` is false. After Screen 4 launch, `onboardingComplete` is set to true and the user lands on the dashboard with the first-run layer active.

**State persistence:** The playbook is persisted as a draft throughout. If the user leaves mid-onboarding, they resume where they left off. The current step is stored on the org config.

---

## Screen 1: Entry

### The Feel

Opening a premium app for the first time. One breath. One action. No noise.

### Layout

Full-width, centered content, vertically centered with 40/60 upward bias (40% from top). No shell chrome, no nav. Switchboard wordmark top-left (fixed, 24px from edges).

Alex character mark at `lg` size (120px), centered above headline. Existing `aura-breathe` animation (6s infinite subtle pulse) — the only animation on screen. Almost felt more than seen.

### Content

**Headline:** "Let Alex learn your business" — 32px Instrument Sans semibold, center-aligned.

**Subtext:** "Paste your website and Alex will draft your services, hours, rules, and lead flow." — 16px Inter, `--sw-text-secondary`, center-aligned.

**URL input — the centerpiece:** `max-width: 480px`, `height: 56px` (taller than standard), `20px` horizontal padding. On focus: border transitions to `--sw-accent` with outer glow `0 0 0 3px rgba(160, 120, 80, 0.12)`. Placeholder: `https://yourwebsite.com`.

**Helper text:** Below input, 14px Inter, `--sw-text-muted`: "We'll draft your setup from this. You can edit everything before going live."

**CTA:** "Start scanning" — dark neutral fill, centered below input. 48px height, 32px horizontal padding. On hover: lighten slightly. On press: `scale(0.98)`. Disabled (empty input): `opacity: 0.4`.

**Secondary sources:** "── or use another page ──" in 14px Inter, `--sw-text-muted`, with thin horizontal rules on either side (1px, `--sw-border`, 40px wide). "Instagram · Google Business · Facebook" as 14px text links, `--sw-text-secondary`, underline on hover. Not buttons.

**Skip path:** "No website? Start from a few questions →" — 14px Inter, `--sw-text-muted`. On hover: `--sw-text-secondary`. On click: bottom section smoothly expands (300ms, ease-out) to reveal category pills: `Dental · Salon · Fitness · Med Spa · Coaching · Other`. Each pill: bordered chip (rounded-full, 36px height, 16px horizontal padding, `--sw-border`). Selected: `--sw-accent` border + text.

### Transition

On submit: button text crossfades to "Scanning..." (200ms). After 300ms, entire screen crossfades (400ms) into Screen 2. Screen 2 arrives with Alex's first message already visible. No loading spinner. No intermediate state.

### Mobile

Identical layout, naturally responsive. Content at `max-width: 480px` with 24px edge padding. URL input stretches full width.

---

## Screen 2: Training

### The Feel

Alex guides, the playbook grounds. A workspace and a guided experience simultaneously. The two panels feel like two pages of an open book, not two app panes bolted together.

### Desktop Layout

**Left panel (~45%):** Alex chat. `--sw-base` background (warm stone).
**Right panel (~55%):** Live playbook. `--sw-surface-raised` background (slightly lighter).
**Divider:** 1px `--sw-border` with 16px breathing room on each side.

Switchboard wordmark top-left. Progress indicator top-right in 14px Inter, `--sw-text-secondary`:

- "3 of 5 required sections ready"
- "Almost ready: set your approval mode" (names the remaining section when 1 left)
- "Ready to test Alex" (text shifts to muted green when all required sections Ready)

### Scrolling

Both panels scroll independently with care:

- Playbook auto-scroll never hijacks user's scroll position
- When a section updates below viewport, a "↓ Services updated" indicator appears at bottom of playbook panel (tappable to scroll there)
- Quick-jump anchors in playbook header

### Chat Panel (left side)

**Alex's messages:** Left-aligned bubbles, `--sw-surface-raised` background, rounded-2xl (16px), max-width 85%. No bubble tails. Alex character mark at `xs` (24px) to the left of each message cluster (not every individual message).

**User's messages:** Right-aligned, `--sw-accent` at 10% opacity background with `--sw-accent` text.

**Typing indicator:** Three dots in `--sw-text-muted`, existing `typing-dot` keyframe. Appears 500ms before response. Sits inside a bubble shape.

**Input field:** Pinned to bottom. Full width minus 16px padding each side. 48px height. Placeholder: "Type a message..." On focus: bottom border shifts to `--sw-accent`. Send arrow appears only when text is present (150ms fade-in).

**Chat scroll:** Auto-scrolls to bottom on new Alex message. Does NOT auto-scroll when user is scrolled up. "↓ New message" pill appears if user is scrolled up.

### Playbook Panel (right side)

Feels like a clean document — more paper than app.

**Header:** "ALEX'S PLAYBOOK" in section-label style (13px uppercase, muted). "for [Business Name]" in 20px Instrument Sans below. Left-aligned, 32px top padding. Generous spacing before first section.

**Section anatomy:**

Each section: bordered container (1px `--sw-border`, rounded-xl), with:

- Header bar: section name (16px Inter semibold) left, status label + dot right
- 3px left border accent, color matches status (green/amber/gray), rounded corners
- Collapsible content below

Default state: populated sections expanded, "Missing" sections collapsed (expand when content arrives or user clicks). Expand/collapse: 200ms height transition with `overflow: hidden`.

**Visual hierarchy between required and recommended sections:** Required sections use `--sw-border-strong` for their container border. Recommended sections use the lighter `--sw-border`. This creates a subtle but legible weight difference — required sections feel slightly more present without any labels or badges explaining the distinction.

**Section status:** Dot before label:

- ● Ready (muted green)
- ● Check this (amber)
- ● Missing (gray)

**Source indicators:** Website-imported fields have `rgba(160, 120, 80, 0.06)` tint. "from website" or "Alex suggested" in small muted text. Tint fades out (300ms) when user confirms.

### Service Cards

Nested cards within Services section. White background (one step lighter than panel), 1px `--sw-border`, rounded-lg (8px), 16px padding.

```
Service name                          ✕
Price · Duration
Booking behavior ▾
```

- **Service name:** 16px Inter semibold. Click to edit inline.
- **Price · Duration:** 14px Inter, `--sw-text-secondary`. Missing price: "Needs price" in amber. Click to edit.
- **Booking behavior:** Subtle select dropdown. "Book directly" / "Consultation only" / "Ask first".
- **Delete (✕):** Top-right, `--sw-text-muted`. On hover: `--sw-text-primary`. Inline confirm: "Remove? / Yes / Cancel".
- **"+ Add service":** Bottom of section.

### Approval Mode — Scenario Cards

The scenario question in 16px Inter, `--sw-text-primary`, plain business language.

Each option: its own card (white bg, 1px border, rounded-lg, 12px padding).

- Unselected: `--sw-border`
- Hover: `--sw-border-strong`
- Selected: `--sw-accent` border, 3px `--sw-accent` left bar, radio dot fills `--sw-accent`. 200ms transition.

Selection immediately updates playbook state. No submit button. If chat active, Alex acknowledges.

**Scenarios:**

> **A customer wants to book Thursday 2pm.**
>
> - ○ Alex books it, then notifies me
> - ○ Alex asks me before booking
> - ● Alex books if the slot is open, asks me if something looks off

> **A customer asks about a service you offer but doesn't mention price.**
>
> - ○ Alex quotes the price from the playbook
> - ● Alex describes the service but says "I'll confirm pricing for you"
> - ○ Alex always asks me before discussing pricing

### Chat-to-Playbook Sync (the core emotional beat)

**Chat → Playbook:**

1. Alex's message appears in chat (normal)
2. 300ms later: playbook section's left border flashes `--sw-accent`, new content fades in (300ms, 4px upward translate)
3. If section was collapsed, it auto-expands (200ms)
4. If section is below viewport, "↓ [Section] updated" indicator appears (no auto-scroll hijack)
5. Section shows "Check this" (amber dot)
6. After 600ms, left border fades to amber status color

**Playbook → Chat:**
User edits a field directly → Alex acknowledges instantly in chat (no typing indicator — it's a reaction, not a thought): "Got it — updated your hours."

### Alex Interview Logic

**Tone:** Direct, professional, slightly warm. Business language.

Good: "I found 4 services on your site — teeth whitening, Invisalign consults, scale & polish, and dental checkups. Prices were listed for the first two. Does that look right, or should I adjust?"

Bad: "Great news! 🎉 I scanned your website and extracted 4 service entities!"

**Priority order:**

1. Confirm/correct scan findings
2. Fill required missing sections
3. Ask about recommended sections
4. Offer to refine details

**Idle nudge:** One gentle nudge after ~30 seconds with missing required sections. No repeated prompting. Disabled if user is actively editing playbook.

### Scan-to-Interview Transition

**With URL:**

1. "Looking at yourwebsite.com now..."
2. Findings stream over 5-10 seconds as individual messages
3. Each finding populates the playbook simultaneously
4. "That's what I found on your site. A few things I couldn't tell — mind if I ask?"
5. Interview begins, gaps only

**Without URL:**

1. "No problem. Let's build your playbook together. What's your business called, and what do you do?"
2. Full interview, seeded with category-relevant questions

### Sticky Footer

64px height, `--sw-surface-raised`, top border 1px `--sw-border`. CTA right-aligned, 24px right padding.

- **Disabled:** "Complete the sections marked 'Missing' to continue" — 14px, `--sw-text-muted`. No button visible.
- **Enabled:** "Playbook ready." in 14px `--sw-text-secondary`, then **"Try Alex →"** button — dark neutral fill. Transition: guidance text fades out (200ms), button + text fades in (300ms).

### Mobile

**Tabs:** "Chat with Alex" / "Your Playbook" at top. Active: `--sw-text-primary` + 2px `--sw-accent` underline. Inactive: `--sw-text-muted`. Tab switch: content crossfades (200ms).

**Mini readiness bar:** Between tabs and content, 40px height: "3 of 5 ready" with inline status dots. Tappable to switch to Playbook tab.

**Cross-tab awareness:** When chat updates playbook, Playbook tab label gets one amber flash (400ms). Limited to one flash per major update cluster. Suppressed if user switched tabs recently.

---

## Screen 3: Test Center

### The Feel

A private demo room. The work is done — now you're watching your creation perform. Calmer than Training, but with a quiet thrill when Alex gets it right. Emotional shift from "building together" to "evaluating with confidence."

### Layout

**Page title:** "Try Alex with real scenarios" — 32px Instrument Sans semibold, left-aligned at page level above both panels. Below it (8px gap): "These scenarios use your actual services and rules." — 14px Inter, `--sw-text-secondary`.

**Desktop:** Left (~40%) prompt selector on `--sw-base`. Right (~60%) simulated chat on `--sw-surface-raised`. No playbook visible.

**Mobile:** Single column. Prompts stack vertically above chat, collapsible after first prompt sent. "Show scenarios" toggle to reopen.

### Left Panel: Prompt Selector

**Category labels:** 13px uppercase, `--sw-text-muted`, tracking 0.05em: BOOKING, PRICING, CHANGES, EDGE CASES.

**Prompt cards:** Bordered cards (1px `--sw-border`, rounded-lg, 16px padding, `--sw-surface-raised` background). Prompt text in 14px Inter, truncated to first line or two.

States:

- Default: `--sw-border`
- Hover: `--sw-border-strong`, cursor pointer
- Active/selected: `--sw-accent` border + 3px left bar (while response showing)
- Tested: Small muted ✓ top-right (12px, `--sw-text-muted`)

**"Start here" badge:** On the most commercially central prompt. Small pill: "Start here" in 12px Inter, `--sw-accent` text, `rgba(160, 120, 80, 0.1)` background, rounded-full.

**Custom input:** Below prompts, separated by thin rule. "Or type your own question" — 14px label. Standard 48px input field.

**Counter:** Bottom of panel, 14px Inter, `--sw-text-muted`: "Tested 1 of 4 scenarios."

### Right Panel: Simulated Chat

**Empty state:** Centered in panel — Alex mark (md, 64px) above "Send a scenario to see how Alex would respond." — 14px Inter, `--sw-text-muted`, center-aligned. Stage waiting for the performance.

**Chat rendering:** Same visual language as Training chat. Same bubbles, same avatar, same typography.

**Typing indicator timing:** Variable for realism:

- Minimum: ~700-900ms
- Typical: ~900-1400ms
- Longer only when actual LLM execution takes longer
- Always show indicator for at least 700ms even if response is instant

### Annotations — "Why this answer?"

Below each Alex response: **"▸ Why this answer?"** — 14px Inter, `--sw-text-muted`.

On click (200ms ease-out expand):

```
▾ Why this answer?
  ℹ  Used: Teeth Whitening — $350, 60 min
  ℹ  Rule: Approval required before confirming
  ℹ  Hours: Within operating hours (Mon-Sat)
```

Annotations: 13px Inter, `--sw-text-muted`. Inside subtle container (`--sw-surface` bg, 1px `--sw-border`, rounded-lg, 12px padding). Only one expanded at a time.

### Action Buttons

Horizontal row below each response, 24px between buttons. No borders, no backgrounds — text links with hover underline. 14px Inter, `--sw-text-secondary`.

- **"Looks good"** — On click: text shifts to muted green, small ✓ fades in (200ms). Becomes inert.
- **"Fix this"** — Opens slide-over panel (see below).
- **"Re-run"** — Appears only after a fix has been made. Re-sends prompt, new response appears below. Previous response fades to ~65-75% opacity for comparison.

### "Fix this" Slide-Over

Slides from right edge of chat panel (not full screen). Adaptive width: ~320px ideal, narrower on small viewports. White background, 1px left border, full panel height. On mobile: slides up from bottom as half-sheet (60% viewport, rounded top corners, drag handle).

**Header:** "What needs fixing?" — 16px Inter semibold. ✕ close top-right.

**Three clickable rows:**

| Option            | Description                           | On select                                                                               |
| ----------------- | ------------------------------------- | --------------------------------------------------------------------------------------- |
| Wrong information | The facts are incorrect               | Shows relevant playbook section for inline edit                                         |
| Tone is off       | Alex should say this differently      | Text input → mapped to structured tone preference                                       |
| Missing context   | Alex should know something it doesn't | Text input → system classifies into appropriate playbook section with user confirmation |

Each row: 16px Inter label, 14px `--sw-text-secondary` description. 16px padding, bottom borders. Hover: `--sw-surface` background.

After fix: slide-over closes (200ms), "Re-run" button appears.

### Sticky Footer

Same treatment as Training. Dark neutral CTA: **"Alex is ready. Go live →"**

Zero-test confirmation: replaces button area for ~5 seconds (not 3 — gives user time to decide):
"You haven't tested Alex yet." + "Test first" (text link) + "Go live →" (dark neutral button, slightly smaller).

---

## Screen 4: Go Live

### The Feel

Two emotional beats. First: a quiet launchpad — everything ready, one button remains. Second: confident activation — the amber moment. This screen mirrors Screen 1's centered simplicity. Bookend closure.

### Layout

Single centered column, `max-width: 520px`, 40/60 upward bias (matching Screen 1). No split-screen, no panels, no nav besides wordmark.

Alex mark at `lg` (120px), centered, with `aura-breathe` animation — bookend callback to Screen 1.

**Page title:** "Alex is ready for your business" — 32px Instrument Sans semibold, center-aligned.

### Required vs. Good To Have

Explicitly separated sections.

**"REQUIRED TO LAUNCH"** — 13px section label. Each item: single row, 16px Inter.

- Completed: `--sw-text-primary`, muted green ✓ right
- Incomplete: `--sw-text-primary`, no checkmark

Read-only summary — cannot undo playbook from here.

**Channel cards:** Single bordered container (1px `--sw-border`, rounded-xl). Rows separated by 1px internal dividers. Each row:

- Channel icon (20px monochrome, `--sw-text-muted`)
- Channel name (16px Inter semibold)
- One-line description (14px Inter, `--sw-text-secondary`)
- "Connect →" (14px, `--sw-accent`) or "Connected ✓" (muted green) or "Coming soon" (muted)
- Row padding: 16px vertical, 20px horizontal

**Recommended channel:** Based on business type from the playbook, one channel gets a small "Recommended" pill (12px, `--sw-accent` text, subtle background). Dental/salon/med spa → WhatsApp. Coaching/consulting → WhatsApp or Telegram by region. This makes the step feel intelligent, not generic.

**Inline channel connection:** "Connect →" expands row downward (200ms, ease-out) to reveal compact form (2 fields max + "Connect" button, dark neutral fill). If a provider requires more than two fields, the inline form becomes a tight guided microflow: step 1 → step 2, still within the expanded row, never leaving the page. After connection: form collapses, row shows "Connected ✓", checklist updates.

**"GOOD TO HAVE"** — 13px section label, 32px below channel cards. Informational items only:

- "3 scenarios tested ✓" or "No scenarios tested" (muted)
- "Approval mode reviewed ✓" or "Using default: approval-first" (muted)

### Playbook Summary

Compact strip, `--sw-surface` background, rounded-lg, 16px padding. One line, 14px Inter, `--sw-text-secondary`:

> 6 services · Mon-Sat 9am-6pm · Approval-first · WhatsApp

### The Launch Button

**The only amber-filled button in the entire onboarding.**

`--sw-accent` background, white text, 16px Inter semibold, **52px height** (taller than standard — more gravity), `min-width: 200px`, rounded-lg, centered.

- **Disabled** (no channel): `opacity: 0.35`. Below it: "Connect a channel to launch." in 14px `--sw-text-muted`.
- **Enabled:** Full opacity. Hover: `brightness(1.08)`. Press: `scale(0.98)`.

**"← Back to training"** — 16px below button. 14px Inter, `--sw-text-muted`.

### The Launch Moment (~3.5 seconds total)

**Beat 1 (0-600ms) — Button transition:**
Text crossfades (200ms): "Launch Alex" → "Going live..."
Background stays amber with extremely subtle pulse (opacity 1.0↔0.85, 1.2s cycle). Almost imperceptible — meaning comes from state transition, not animation.

**Beat 2 (600-1200ms) — Channel activation:**
Channel row status transitions (300ms crossfade): "Connected ✓" → "Live" with green dot. Green dot appears with brief scale-up (0→1, 300ms, ease-out).

**Beat 3 (1200-1800ms) — Status confirmation:**
Button fades out (200ms). In its place, status line fades in (300ms):

> ◉ Alex is live on WhatsApp

16px Inter, `--sw-text-primary`, green dot (pulses once, then steady). Action becomes status — the core emotional beat.

**Beat 4 (2500-3500ms) — Test lead:**
After deliberate pause. Notification card slides up (300ms, ease-out, 8px upward translate + fade-in):

```
┌──────────────────────────────────────────┐
│  TEST LEAD                               │
│                                          │
│  "Hi, I saw your clinic online —         │
│   do you do teeth whitening?"            │
│                                          │
│            See Alex's response →         │
└──────────────────────────────────────────┘
```

- "TEST LEAD" badge: 12px uppercase, `--sw-text-muted`. Clearly simulated.
- Quote: 16px Inter, `--sw-text-primary`.
- "See Alex's response →": 14px, `--sw-accent`. Links to approval queue (if approval-first) or conversation view (if lower-review mode).
- Card: `--sw-surface-raised`, 1px `--sw-border`, rounded-xl, 20px padding.

**Beat 5 — Transition CTA (appears with test lead):**
16px below card: **"Go to your dashboard →"** — 14px Inter, `--sw-text-secondary`. Text link, not button. Consider slightly stronger treatment (secondary button) if testing shows users hesitate.

**What this is NOT:** No confetti. No fireworks. No celebration modal. Satisfaction from seeing it work.

### Mobile

Same single-column layout, naturally responsive. Launch button: `width: 100%`, still 52px height. Test lead card: full-width.

---

## Post-Launch: Dashboard First-Run Layer

The existing OwnerToday/StaffDashboard with a first-run overlay that fades based on user behavior.

### Welcome Banner

Top of dashboard content area, full-width within `content-width` (42rem). `--sw-surface-raised`, 1px `--sw-border`, rounded-xl, 24px padding. Dismissible (✕ top-right).

> "Alex is live. Here are your next best steps."

Three action cards in horizontal row (stack vertically on mobile). Each: `--sw-surface` bg, 1px `--sw-border`, rounded-lg, 16px padding. Entire card is tap target.

| Card                       | Links to                                   |
| -------------------------- | ------------------------------------------ |
| Review first conversations | Decide screen                              |
| Send a test lead           | Inline action (triggers test, shows toast) |
| Refine your playbook       | Settings → Your Playbook                   |

Card title: 14px Inter semibold. Arrow →: bottom-right, `--sw-accent`.

### Stat Cards

Contextual copy instead of zeros (16px Inter, `--sw-text-muted`, centered):

- "Waiting for first lead" / "Ready to respond instantly" / "Ready to book"
- When first real metric arrives: 300ms crossfade to actual number.

### Activity Feed

Shows launch test lead: "Test lead · just now" with "Test" badge (12px, muted). Pushed down naturally by real items.

### Your Playbook in Settings

New top-level settings nav item: "Your Playbook" with Alex mark (xs, 20px — subtle, not over-branded). Links to `PlaybookView` component reusing Training's visual treatment.

### Fade-Out Rules

Individual elements fade based on behavior, not a single event:

| Element                | Fades when                            | Animation                                      |
| ---------------------- | ------------------------------------- | ---------------------------------------------- |
| Welcome banner         | Dismissed (✕) or 3 days               | 300ms fade-out, 8px upward translate           |
| "Review chats" card    | User has viewed Decide screen         | 50% opacity on next visit, removed visit after |
| "Send test lead" card  | Test sent or first real lead received | Same                                           |
| "Refine playbook" card | User has visited playbook settings    | Same                                           |
| Stat card copy         | First real metric for that stat       | 300ms crossfade to number                      |
| Activity test lead     | First real activity arrives           | Pushed down naturally                          |

Individual card fade: when trigger fires, card renders at 50% opacity with "Done ✓" overlay on next visit, removed on visit after that. No elements disappear while user is looking.

A composite `firstRunPhase` on org config tracks overall state (not a single timestamp).

---

## Technical Architecture

### Website Scan (v1 — Lightweight)

**Scope:** Fetch homepage + up to 3 linked pages (services, about, contact if discoverable). No SPA rendering, no login-wall handling, no deep crawling.

**Extraction:** Send page content to Claude API with structured extraction prompt. Return:

- Business name (confidence: high/medium/low)
- Services (name, price if found, duration if found)
- Hours, contact methods, FAQ-like content, booking/inquiry intent hints

**Confidence model:**

- High confidence → "Check this" (amber, pre-populated)
- Low confidence → "Alex suggested" (more muted, needs confirmation)
- Not found → "Missing" (gray)

**Failure handling:** If scan fails: "I couldn't read much from that site — let's build your playbook together instead." Falls back to skip-scan interview flow.

### Playbook Data Model

Stored as JSON field (`onboardingPlaybook`) on existing org config record. Avoids new Prisma model for transient draft state. On launch, decomposed and written to existing structures, draft field cleared:

| Playbook Section     | Maps to                                         |
| -------------------- | ----------------------------------------------- |
| Business Identity    | Org config (name, category, location)           |
| Services             | Knowledge entries (structured service records)  |
| Hours & Availability | Org config (operating hours, timezone)          |
| Booking Rules        | Deployment config (booking behavior settings)   |
| Approval Mode        | Governance settings (approval routing rules)    |
| Escalation           | Governance settings (escalation triggers)       |
| Channels             | Channel connections (existing connection model) |

### Alex Interview Engine

Structured interview state machine, not freeform LLM conversation. Tracks:

- Which sections populated / confirmed / scan-populated-unconfirmed
- Next highest-priority question

LLM generates natural phrasing. Interview logic (what to ask, when to advance, when to nudge) is deterministic.

### Test Center Simulation

Prompts generated from playbook via Claude API — realistic customer scenarios grouped by intent.

Responses use the same skill executor path as real messages, with `simulation: true` flag (no real side effects).

Annotations from skill execution trace inspection.

---

## Components (New)

| Component          | Location                                        | Purpose                                                     |
| ------------------ | ----------------------------------------------- | ----------------------------------------------------------- |
| `OnboardingEntry`  | `components/onboarding/entry.tsx`               | Screen 1: URL input, category selector, skip path           |
| `TrainingShell`    | `components/onboarding/training-shell.tsx`      | Screen 2: split-screen layout, panel management             |
| `AlexChat`         | `components/onboarding/alex-chat.tsx`           | Chat interface with interview engine integration            |
| `PlaybookPanel`    | `components/onboarding/playbook-panel.tsx`      | Structured playbook with sections, status, inline edit      |
| `PlaybookSection`  | `components/onboarding/playbook-section.tsx`    | Individual collapsible section with status indicator        |
| `ServiceCard`      | `components/onboarding/service-card.tsx`        | Service entry card with booking behavior field              |
| `ApprovalScenario` | `components/onboarding/approval-scenario.tsx`   | Scenario-driven approval mode selector                      |
| `TestCenter`       | `components/onboarding/test-center.tsx`         | Screen 3: prompt selector + simulated chat                  |
| `PromptCard`       | `components/onboarding/prompt-card.tsx`         | Clickable test scenario card                                |
| `GoLive`           | `components/onboarding/go-live.tsx`             | Screen 4: channel setup + launch moment                     |
| `LaunchSequence`   | `components/onboarding/launch-sequence.tsx`     | Animated launch flow (status transitions, test lead)        |
| `FirstRunBanner`   | `components/dashboard/first-run-banner.tsx`     | Post-launch welcome overlay with action cards               |
| `PlaybookView`     | `components/settings/playbook-view.tsx`         | Post-onboarding playbook in settings (reuses PlaybookPanel) |
| `FixThisSlideOver` | `components/onboarding/fix-this-slide-over.tsx` | Test Center correction panel (wrong info, tone, context)    |

### Reused Existing Components

- `AgentMark` — Alex character mark (already exists)
- `WizardShell` — replaced, not reused
- All shadcn/ui primitives (Card, Button, Input, Tabs, Badge, etc.)

---

## What This Design Does NOT Include

- **Multi-agent onboarding.** Alex-only. Other agents use existing deploy wizard.
- **Real Google Calendar integration.** Uses existing stub `CalendarProvider`.
- **Deep website scanning.** v1 is lightweight (homepage + 3 pages).
- **Post-onboarding playbook editing via chat.** Settings view is structured-only.
- **Billing or payment setup.** Not part of onboarding in v1.

---

## Success Criteria

1. A new user can go from signup to live Alex in under 10 minutes (aspiration, not hard promise — validate in practice)
2. The playbook captures enough operational truth for Alex to handle a real booking inquiry correctly
3. The test center surfaces at least one "I need to fix this" moment before launch
4. The post-launch dashboard does not feel like a different product from onboarding
5. Users who skip the website scan still complete onboarding (interview path is fully functional)
6. Non-technical SMB owners (dentists, salon owners, fitness coaches) can complete onboarding without confusion or help
