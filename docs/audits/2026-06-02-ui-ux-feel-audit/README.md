# UI/UX Feel Audit & Direction — 2026-06-02

How to make `apps/dashboard` (the Switchboard "website") **feel amazing to use** — a governed AI revenue cockpit for time-poor medspa operators trusting Alex, Riley, and Mira to spend their money and talk to their customers.

## What's here

| File                                 | What it is                                                                                                                                                                                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **[direction.md](direction.md)**     | **The deliverable** — _"Switchboard — How to Make It Feel Amazing."_ Verdict, north star + 7 principles, prioritized gaps, surface-by-surface moves (mapped to real files, tagged quick-win/systemic), the foundational design-system layer, a sequenced roadmap, and an inspiration board. Read this. |
| **[visual-pass.md](visual-pass.md)** | **Live pixel verification** (2026-06-02) — booted the real stack + 13 screenshots ([`screenshots/`](screenshots/)). Confirms gap #1 _verbatim_, **corrects gap #3** (dark mode never auto-applies — downgrade to HIGH), and adds new findings ("6975 MIN").                                            |
| [gaps.json](gaps.json)               | The current-state gap synthesis that merged all 15 audits (structured).                                                                                                                                                                                                                                |
| [audits.json](audits.json)           | All 15 raw internal-audit findings (one object per surface/dimension lens).                                                                                                                                                                                                                            |
| [research.json](research.json)       | All 10 raw best-in-class research findings (web-sourced, cited).                                                                                                                                                                                                                                       |
| [critique.json](critique.json)       | The adversarial peer-review pass (score **91/100**) whose must-fixes were folded into the final direction.                                                                                                                                                                                             |

## How it was produced

A 4-phase, 29-agent background workflow (2.7M tokens, 1,125 tool calls, ~46 min):

1. **Audit** — 15 auditors (Opus) read the actual source. 10 cross-cutting lenses (design-system, typography, color+a11y, motion, IA/nav, decision flows, empty/error states, content/voice, emotional-delight, responsive) + 5 deep-dives (marketing landing, onboarding, Home, Inbox, agent cockpits).
2. **Synthesize gaps** — merge + dedupe + prioritize into a current-state map and a research agenda.
3. **Research** — 10 researchers (Sonnet, web) on best-in-class feel, targeted at the real gaps (operator-tool craft, calm-tech/money-trust, AI-agent UX, motion language, emotional-delight theory, decision-triage, the medspa/SMB audience, 2026 visual craft, onboarding, results dataviz).
4. **Direction** — draft → ruthless critic (91/100) → final revision.

Auditors read source (dev server was down). A **live visual pass** — boot the dashboard headless, screenshot Home/Inbox/Results/landing, pressure-test the findings against pixels — is the recommended follow-up.

## The one-line verdict

> **Switchboard has a top-decile ceiling and a hobbyist floor, and the gap between them — not any single bug — is the product.** The aesthetic is already right and the soul is already built; what remains is to _finish_ it. Of 14 named gaps, **9 are predominantly wiring or correcting code that already exists.** The fix is finishing, not redesigning.

## The seven principles (north star)

1. **Tell the truth at the commit moment** — never a placeholder where money or a customer is at stake.
2. **The card leaves before the server answers** — optimistic act, reconcile in background, Undo is the net.
3. **Friction proportional to irreversibility, not importance** — make the existing risk-gate _visible_.
4. **Bring the soul onstage** — agents present, alive, one identity everywhere, able to reach you when away.
5. **One source of truth, enforced** — every brand color defined once as `hsl(var(--x))`; drift is a lint failure.
6. **Calm is not inert — but calm has a motion budget** — the surface arrives, never busy; one breathing avatar per viewport.
7. **Reversible by default, honest when it fails** — recovery visible, every failure mode a designed state.

## The three critical gaps

1. 🔴 **The commit moment is a prototype** — "Money at risk: —" / "preview not yet wired" on the approval sheet; Undo silently evicts; no optimistic feedback. _(`approval-detail-sheet.tsx`, `use-toast.ts`)_
2. 🔴 **Stale feed: actions don't register** — approving never invalidates `decisions.feed()`; header says 5 after you cleared 3. _(`use-recommendation-action.ts:38–39`)_
3. 🟠 **Dark mode is broken but gated** — _revised by the [live pass](visual-pass.md).\_ The palette is genuinely broken (~138/178 tokens unstyled → a half-dark "Frankenstein"), but it does **not** auto-apply: `useTheme()` is mounted only in `settings/account/page.tsx:41`, not the app-shell, so a fresh dark-OS load stays light. Not a first-paint failure → fix is simply to hide the toggle. _(`use-theme.ts:17,21`)\*

## Start here (Wave 0 — this week, mostly hours)

Delete the em-dash "preview not wired" grid · hide Dark/System + kill auto-apply · fix the false inbox-zero gate (`!data && !error`) · wire `decisions.feed()` invalidation + optimistic removal · wire the built `alreadyHandled` path · darken action amber to AA (`30 58% 41%`) + global `:focus-visible` · re-skin/flag-hide the blue operator-chat widget · close "Go live anyway" · instrument the metrics so later waves are falsifiable.
