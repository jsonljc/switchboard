# Switchboard — aesthetic direction fan-out (shared brief)

You are one of six designers each building **one distinct aesthetic direction** for the
**Switchboard product app**. A human will compare all six rendered mockups side-by-side
and pick a direction to take forward. Your job: make YOUR direction the most compelling,
**resolved, production-grade** version of itself — not a wireframe, a portfolio piece.

Your specific direction (your thesis + differentiators) is in the dispatch message that
sent you here. This file is the shared context every direction must honor.

---

## The product, in one breath
A governed AI "revenue cockpit." Three AI teammates work for a **time-poor medspa owner**:
- **Alex** — answers leads & books consults, drafts offers, talks to clients (WhatsApp).
- **Riley** — runs & optimizes the ad campaigns.
- **Mira** — makes creative / short-form video (UGC).
They **spend her money and message her clients**, so the whole product is about **earned
trust**: she approves the risky moves; the agents handle the rest and report back honestly.

## Who it's for (design for HER)
A non-technical aesthetic-clinic owner. She lives in a world of **warm neutrals, one
precious-metal accent, soft editorial polish** (think premium medspa branding). She is NOT
a developer. Clinical-white dashboards and developer-console blue feel alien and cold to
her. She checks her phone between patients. She is trusting AI with real money — the
product must feel **calm, premium, decisive, and on her side**.

## How you will be judged (the bar)
1. **Feels good** — emotionally warm, alive, premium-through-restraint, want-to-open-it.
2. **Looks nice** — genuinely beautiful, resolved, coherent, top-decile craft.
3. **Intuitive** — the next action is obvious; the queue is easy to clear on a phone.
4. **Blends with the 8-bit avatars** — the pixel characters feel intentional and loved,
   not pasted on. This is the crux: a retro pixel cast inside a premium money product.
5. **Trustworthy at the money moment** — the approve/spend screen is the MOST finished,
   most legible surface, never a vibe at the expense of clarity.
6. **Ages well + performs** — won't look dated in 18 months; fine on a mid phone.

---

## NON-NEGOTIABLES (every direction keeps these)
- **ONE action color.** Pick a single accent (the product's is operator-amber) used for
  ALL commit/approve/primary buttons. **Agent identity hues are for IDENTITY ONLY** — an
  agent's color may NEVER back an action button. (Alex≈amber/coral, Riley≈lavender/indigo,
  Mira≈violet.) This discipline is load-bearing for trust; keep it.
- **Honest voice / no placeholders.** Where money or a client is involved, show real values
  or omit cleanly — NEVER an em-dash placeholder like "Money at risk: —". Use
  "handled / booked / answered / attributed," never "generated." Agents speak first person,
  never blaming ("I'll pause and ask," "Already handled by your teammate").
- **Legibility at the commit moment.** Approve/spend text & buttons must hit WCAG AA
  (≥4.5:1) on their real background. If your material is glassy/textured, the decision
  surfaces stay solid and high-contrast.
- **Calm motion budget.** At most ONE continuously-animated avatar per viewport; reduced
  motion strips it. Motion should make calm feel *occupied*, never busy.
- **Mobile-first AND desktop.** She's on her phone; power-use is on a laptop.

---

## What to mock (SAME content for all six → comparable). Use this exact copy.

### A) HOME — the evening briefing (mobile, 390px column)
- Masthead: `● Switchboard` wordmark · tiny status `● Live · Inbox 3 · Halt` · round account chip `D`.
- Eyebrow: `TUESDAY, JUN 2 · 7:18 PM`
- Greeting + **verdict hero** (the biggest type on the page):
  `Good evening, Dev` → **`Three things need you — start with Alex.`** (style "Alex" in his identity hue)
- Sub-line (humanized, never raw minutes): `2 open leads · oldest waiting ~5 days · 0 of 1 working`
- **Needs you** (2 cards):
  - HANDOFF · Sarah Tan · due 5d — "**Sarah Tan asked to talk to a human about their consultation.**" — actions `[Take this one]` `[Snooze]`
  - APPROVAL · Alex · **HIGH RISK** — "**Offer Priya a complimentary touch-up to resolve her concern about uneven volume.**" — actions `[Approve offer]` (the ONE action color) `[Adjust]` · tiny hint `Swipe primes · tap to commit`
- `See all in Inbox →`
- **Your team** roster — Alex / Riley / Mira, each with avatar + an honest live status, e.g.
  `Alex — working · drafting Priya's offer` · `Riley — watching · 3 ad sets` · `Mira — 2 drafts ready`.
- **Since you hired your team** value strip (the cumulative trust anchor):
  `14 leads answered · 9 consults booked · ~S$7,388 saved`
- **Week-so-far note** — Alex's signed letter (the love-worthy editorial moment; keep its
  spirit): a short note like "Two consults booked, four leads answered, and I paused one ad
  set before it burned budget." signed `— Alex`. (You may keep or reinterpret the drop-cap.)

### B) INBOX — the queue (mobile, 390px column)
- Title `inbox` (your treatment) · `● 3 things need you`
- Filter chips: `All · 3` | `Alex · 2` (avatar) | `Riley · 0` (avatar)
- Three decision cards (each: agent byline w/ small avatar · type · timestamp · body · meta):
  1. Alex · HANDOFF · **Overdue** — "Sarah Tan asked to talk to a human about their consultation." — `FOR Sarah Tan` · `TAP TO OPEN →`
  2. Alex · APPROVAL · 5d ago — "Offer Priya a complimentary touch-up to resolve her concern about uneven volume." — `● HIGH RISK` · `FOR Priya Nair` · `TAP TO REVIEW →`
  3. Alex · APPROVAL · 5d ago — "Send Maya a warm day-3 check-in while her lip filler settles." — `● LOW RISK` · `FOR Maya Lim` · `SWIPE →`

### C) THE COMMIT MOMENT — Priya's approval detail (mobile sheet). **The most important surface.**
- Agent (Alex) · APPROVAL · HIGH RISK.
- **The proposal:** `Complimentary touch-up — $480 value` · `Reason: client flagged uneven volume` · `Channel: WhatsApp`.
- Plain-English risk chips: `Spends from your budget` · `Messages a client directly`.
- **Honest "what this changes":** show what's known ($480, WhatsApp, Priya) and omit the rest
  cleanly. NO placeholder grid. (This is the whole trust thesis — make it feel finished.)
- Primary action `[Approve offer · $480]` (ONE action color, AA-contrast) + `[Adjust]`.
- Show the **Undo** concept post-commit: a branded `Approved — sent to Priya · Undo (12s)`.

### D) DESKTOP composition (~1100px) — Home OR Inbox, your call. Show you've thought past mobile.

### E) "MEET YOUR TEAM" hero — all three avatars at LARGE/hero scale (72–120px), the
   emotional peak where the cast carries the warmth. (Also satisfies "show avatars big.")

### F) (Optional) a DARK / dim variant of the Home verdict hero, if your direction has a
   dark story worth showing.

> Render these as **labeled, stacked sections in ONE page**, each with a small caption
> above it, so a single tall screenshot captures your whole direction. Center the mobile
> columns (390px) and the desktop block (~1100px) on a neutral backdrop.

---

## The avatars (read AVATARS.md in this same folder)
The real Alex & Riley pixel sprites + a Mira placeholder render via a tiny script.
**Inline the full contents of `avatars.js` (this folder) into a `<script>` tag** so your
mockup is self-contained and renders offline. Then place avatars with
`<span data-sb-avatar="alex"></span>` inside a sized box (it auto-fills). Names: `alex`,
`riley`, `mira`. **Keep them crisp — never blur the pixels.** The pixel ART is fixed; YOU
design the frame/tile/glow/halo/crop/scale/motion around them. Show them **small** (Inbox
chip, card byline ~24–28px) AND **large** (the team hero ~72–120px). Mira's real sprite is
an open deliverable — you may mock your own idea of her pixel character in your style.

---

## Deliverable
1. ONE self-contained file at **`/tmp/sb-aesthetic-fanout/mockups/<YOUR_SLUG>/index.html`**
   (your slug is in the dispatch message). Inline `<style>`; Google-Fonts `<link>` ok;
   inline `avatars.js`. Must render fully offline via `file://`. Production-grade craft —
   real type scale, real spacing rhythm, real color, micro-detail, hover/focus states.
2. **Use the `frontend-design` skill** (invoke it) for craft.
3. Return (as your final message) a tight **writeup**:
   - **THESIS** (the feel in one line)
   - **PALETTE** (canvas / ink / the ONE action color / 3 agent identity hues — with hex)
   - **TYPE** (display / body / numeric faces; italics or not; why)
   - **MATERIAL & DEPTH** (flat / glass / textured / soft-shadow — your signature)
   - **MOTION** (1–2 signature moves, within the calm budget)
   - **AVATAR TREATMENT** (how you frame the pixels at small + hero; why it blends; Mira)
   - **WHY IT FITS** (medspa owner · money-trust · ages-well · mobile/perf)
   - **RISKS / WATCH-OUTS** (be honest)
   - **ONE-LINE PITCH**

## Constraints
- **Do NOT modify the repo.** Write ONLY inside your `mockups/<YOUR_SLUG>/` folder.
- Self-contained, offline-renderable. Decorative avatars stay `aria-hidden` (already set).
- Don't sacrifice the money-moment's legibility for aesthetic effect.
