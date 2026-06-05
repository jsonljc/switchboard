# Live Visual Pass — 2026-06-02

The source-based audit ([direction.md](direction.md)) read code, not pixels. This pass booted the **real stack** — API `:3000` + dashboard `:3002` (Next 16 Turbopack), Postgres seeded, `DEV_BYPASS_AUTH` — and captured **13 screenshots** across mobile (390×844) and desktop (1440×900), plus DOM and theme-code probes. It **confirms** most of the audit, **corrects one CRITICAL-ranked claim**, and surfaces **new live-only findings**. Screenshots in [`screenshots/`](screenshots/).

## TL;DR

- The audit's **#1 critical** (commit-moment-prototype) is **confirmed verbatim** — the strongest finding, Wave-0 priority stands.
- The audit's **#3 critical** (dark-mode "illegible on first open") is **overstated**: dark never auto-applies (the theme hook isn't global). The _broken palette_ is real, but it's reachable only via Settings → downgrade to HIGH, and the Wave-0 fix simplifies.
- The blue chat widget and the agent-avatar fragmentation are **worse in pixels** than on paper.
- One new daily-visible bug: **"OLDEST WAITING 6975 MIN."**

---

## ✅ Confirmed (pixels match the audit)

### Gap #1 — the commit moment is a prototype — **VERBATIM** `[11, 12]`

Selecting Priya's **HIGH-RISK** approval ($480 touch-up) renders, on both the desktop detail pane and the mobile sheet:

> **WHAT THIS CHANGES** · `PREVIEW NOT YET WIRED` · BEFORE **—** → AFTER **—** · CONFIDENCE **—** · **MONEY AT RISK —** · _"We're saving a slot here for live before-and-after numbers — wiring it up next week."_

…sitting **directly below real, usable data** in "THE PROPOSAL": _Complimentary touch-up (**$480 value**) · Reason · Client flagged uneven volume · Channel · WhatsApp._ This is exactly why the audit's fix ("delete the grid, render what you have, omit the rest") is correct — the honest content already exists one box up. The rest of the sheet (serif proposal, plain-English RISK list, amber "Approve offer…") is clean. The placeholder is the single thing breaking the highest-trust moment.

### Gap #6 — the blue chat widget — **CONFIRMED + worse** `[03, 04, 05, 07, 08]`

A `fixed bottom-4 right-4 … bg-blue-600` bubble (computed `rgb(37,99,235)`) floats on **every authed screen** — and it doesn't just sit there, it **collides with content**: it clips the Priya card on Home, overlaps mid-scroll text on Results, and covers "…ready to review" on Mira. A floating **"DEV" badge** rides alongside it. Pure developer-console blue in a warm-cream system, on every page.

### Gap #5 — soul offstage + avatar fragmentation — **CONFIRMED + extended** `[03, 05, 08]`

Three _different_ agent-avatar systems within three taps:

- **Home** → flat grey letter-discs labelled **"Not set up"** (no life, no color)
- **Inbox** → illustrated **sprite faces** (Alex, Riley) in the chips and per-card
- **Mira** → a purple rounded-**square "M"**

No breathing `OperatorCharacter` appears anywhere in the daily app. And the API boot log prints `Escalation: no notification channels configured — handoff records saved only` — the escalation backend is live but unconfigurable from the UI, exactly as the audit said.

### Gap #12 — Home contradicts itself — **CONFIRMED** `[03, 04]`

The serif hero says **"3 things need you — start with Alex"** while, lower on the same screen: **"0 consults booked · 0 new leads,"** **"All quiet overnight,"** and **"No active handoffs right now."** The mixed message is right there on first paint.

### The aesthetic ceiling is real `[01, 02, 03, 07]`

The landing hero ("Riley catches what you **miss**."), the serif verdict hero, the drop-cap weeknote, and the Results narrative + ROI ladder ("S$7,388 you saved" vs an SDR) all read genuinely premium. The audit's "the aesthetic is already right" is true in pixels.

---

## ⚠️ Corrected (pixels diverge from the audit)

### Gap #3 — dark mode — **SEVERITY OVERSTATED** `[09, 13]`

The audit ranked this **CRITICAL** because it "auto-applies on a dark-OS phone with zero user action, rendering Home/Mira/cockpits illegible on first open." The live + code evidence says otherwise:

- **The mechanism is real:** `use-theme.ts:17` toggles `.dark` on `<html>`; default theme is `"system"` (`:21`/`:25`), resolved from `prefers-color-scheme` (`:11`); `globals.css` has exactly **one** `.dark {` block (line 231) reassigning ~40 of ~178 tokens.
- **But it never auto-applies.** `useTheme()` is consumed in **exactly one component — `settings/account/page.tsx:41`** — and is mounted in **no layout or app-shell**. So a fresh dark-OS load of Home/Inbox/Results/Mira calls `applyTheme()` **never** → stays light. **Verified:** an emulated `prefers-color-scheme: dark` context rendered Home fully light, `<html>` with no `.dark` class `[09]`.
- **When `.dark` _is_ forced on, the palette is genuinely broken** `[13]`: the page background stays cream while the Priya approval card and the weeknote card flip to near-black, producing a **half-dark Frankenstein** with **light-on-light text** (body bg `rgb(241,237,230)` + body color `rgb(233,231,226)`) and illegible "Not set up" discs.

**Corrected severity: HIGH, not CRITICAL.** The broken dark palette is real and worth fixing, but it's gated behind Settings → Account, not a first-impression failure. **The Wave-0 fix simplifies** to: _hide the Dark/System toggle in Settings until the palette is complete._ The audit's companion step "remove the `prefers-color-scheme` auto-apply" is largely **moot** — there is no global auto-apply to remove (the listener at `use-theme.ts:29–34` only runs while the Settings page is mounted).

_Bonus:_ forcing dark is the clearest possible proof of **Gap #4 (token fragmentation)** — within one screen, some cards share `.dark`-covered tokens and flip; others don't and stay light. The surfaces demonstrably do not share a token system.

---

## 🆕 New findings (live-only)

- **"OLDEST WAITING 6975 MIN"** `[03, 04]` — the Home eyebrow renders a raw, un-humanized minute count (~5 days) as `6975 MIN`. Quick win: humanize durations (`~5 days`), and it reinforces the audit's voice-layer point about number formatting.
- **The "DEV" floating badge** `[all authed]` ships in this build's authed shell next to the blue Chat bubble — extra chrome noise on every page (dev-gated, but present here).
- **Two-pane Inbox empty state** `[06]` reads "Select an item to see details" — a reasonable desktop master-detail, contradicting any worry the desktop tier is unfinished; it's clean.

## ◻️ Not exercised live

- **Gap #2 (stale feed)** — code-verified (`use-recommendation-action.ts:38–39` omits `decisions.feed()` invalidation) but **not** exercised live, because confirming it means _approving_ a real seeded item and watching the count desync — a mutation of seed data I deliberately avoided. The code path is unambiguous; treat as confirmed-by-code.

---

## How it was run (for the next session)

1. Postgres was already up; `pnpm db:generate` (client was ungenerated); workspace `dist/` present.
2. Stack booted from repo root: API `node --env-file=.env --import tsx apps/api/src/server.ts` (:3000); dashboard `pnpm --filter @switchboard/dashboard dev` (:3002). `DEV_BYPASS_AUTH=true` in `apps/dashboard/.env.local` auto-logs in.
3. **Both servers were reaped twice** despite `nohup`/`disown` (the hazard in `feedback_local_dev_server_launch`). What finally held: a Node launcher using `child_process.spawn(cmd, args, { detached: true, stdio: [ignore, log, log] }).unref()` — a new session that survives harness process-group cleanup. See `/tmp/sbshot/launch.mjs`.
4. Screenshots via `playwright-core` + system Chrome (`executablePath`), `waitUntil: "domcontentloaded"` + fixed timeout (never `networkidle`), per `reference_dashboard_visual_verification`.

## Screenshot index

| #   | File                                   | Surface / what it shows                                                         |
| --- | -------------------------------------- | ------------------------------------------------------------------------------- |
| 01  | `01-landing-hero-desktop.png`          | Landing hero (above fold) — premium first impression                            |
| 02  | `02-landing-full-desktop.png`          | Landing, full scroll                                                            |
| 03  | `03-home-mobile.png`                   | Home mobile — blue widget collision, "6975 MIN", flat discs, self-contradiction |
| 04  | `04-home-desktop.png`                  | Home desktop — bento/sidebar tier                                               |
| 05  | `05-inbox-mobile.png`                  | Inbox mobile — sprite-face avatars, decision cards                              |
| 06  | `06-inbox-desktop.png`                 | Inbox desktop — two-pane master-detail                                          |
| 07  | `07-results-mobile.png`                | Results — narrative + ROI ladder + honest footnote                              |
| 08  | `08-mira-mobile.png`                   | Mira desk — purple-square avatar, chip/form register                            |
| 09  | `09-home-dark-mobile.png`              | Home under emulated dark-OS — **stays light** (no auto-apply)                   |
| 10  | `10-inbox-approval-sheet-mobile.png`   | Handoff detail sheet (Sarah Tan)                                                |
| 11  | `11-inbox-desktop-approval-detail.png` | **Approval detail — "PREVIEW NOT YET WIRED / MONEY AT RISK —"**                 |
| 12  | `12-inbox-mobile-approval-sheet.png`   | Same, mobile sheet                                                              |
| 13  | `13-home-forced-dark-mobile.png`       | **Forced `.dark` — broken half-dark Frankenstein**                              |
