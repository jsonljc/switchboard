# Switchboard — How to Make It Feel Amazing

> A governed AI revenue cockpit for time-poor medspa operators who are trusting Alex, Riley, and Mira to **spend their money and talk to their customers**. This is the definitive UI/UX direction. Print it. Pin it.

> **On the numbers in this document.** Every code/TS `file:line` citation was verified exact against the live tree; CSS line anchors land on the relevant rule but may be a line or two off the exact selector. Every contrast ratio was recomputed independently against the actual shipped token value and the surface it sits on (method: WCAG 2.x relative-luminance). Where an audience claim is a hypothesis rather than telemetry, it is labeled **[HYPOTHESIS — validate]**. We hold ourselves to the same "tell the truth" standard we are asking of the product.

---

## 1. The verdict

**Switchboard has a top-decile ceiling and a hobbyist floor, and the gap between them — not any single bug — is the product.**

At its best it already feels like a calm, premium colleague you would hand your ad budget to. Alex's signed, drop-capped "week-so-far note" — a `::first-letter` drop cap (`this-week.module.css:96`), tabular figures, and an em-dash monogram sign-off (`:107`, `:124`) on a Newsreader optical-size axis — is best-in-class editorial type craft and the single most love-worthy moment in the app. The risk-gated swipe (`swipe-policy.ts:8` — `canSwipeApprove()` only permits low-risk, no-side-effect items; everything financial rubber-bands back to detail) is exactly the right trust posture, enforced at the predicate, not inferred from copy. The Results "— Riley" pull-quote and the AgentPanel "three-states-never-collapse" invariant (`agent-panel/key-result.tsx:44` shows zero dimmed-but-present, never as an error) are the gold standard the rest of the app should be measured against. The warm-white canvas, the one operator-amber action color, agent hues for identity only, editorial serif + tabular numerics — this aesthetic bet is correct and largely consistent in light mode. **This is real, intentional craft. It is the product's biggest asset.**

But the product loses trust in exactly the places that carry the most of it, and three patterns recur across all fifteen audits:

**(1) The trust-critical instant behaves like a prototype.** The approval detail's "What this changes" panel — the screen where a cautious owner decides whether to trust AI with her money — ships four literal em-dashes including **"Money at risk: —"** and a tag that reads **"preview not yet wired"** with the caption "wiring it up next week" (`approval-detail-sheet.tsx:188–232`, verified). The Undo safety net renders through the stock shadcn toaster with `TOAST_LIMIT = 1` and `TOAST_REMOVE_DELAY = 1000000` (~16 minutes) — so a second approval _silently evicts_ the first item's undo before the operator could use it, and the toast effectively never auto-dismisses (`use-toast.ts:8–9`, verified). Approving on the main Inbox page invalidates only `recommendations.all()` and `audit.all()` — **never `decisions.feed()`** (`use-recommendation-action.ts:38–39`, verified) — so an operator clears three items, the header still says five, and items silently reappear on the 60s poll. The already-built `alreadyHandled` stale-409 path is a fully-wired prop (`approval-detail-sheet.tsx:96, 128, 178`) that the inbox screen never passes, so approving a teammate-handled item hits a 409 the hook swallows as `silent` and closes with zero confirmation.

**(2) The product's soul is offstage.** The breathing `OperatorCharacter` and 1,100+ lines of animated agent sprites are disconnected from every daily screen. The AgentPanel header hardcodes the avatar to `state="idle"` so the agents **literally never move** (`inbox-agent-avatar.tsx:56`, verified), and Home renders agents as flat letter-discs. The same agent wears different faces and colors one tap apart — `inbox-agent-avatar.tsx:24–26` hand-defines a Mira hex (`#4A3A66`) that ignores the live `--agent-mira` token entirely (verified). And the entire out-of-app escalation loop — the one thing that pulls the operator back when an agent needs her — exists as a built backend (`packages/core/src/notifications/*`: slack/whatsapp/telegram/webhook notifiers + batcher; `apps/chat/src/escalation/rules.ts` with per-risk timeouts) with **no operator-facing surface in the dashboard at all**.

**(3) The foundation is four design systems wearing a trench coat.** `cockpit/tokens.ts` is 18 literal hex/rgba values — `amber: "#B8782E"`, `blue: "#3A5A80"`, zero `var()` references (verified) — structurally un-themeable and un-rebrandable. A shipped Light/Dark/System toggle covers ~40 of ~178 declared tokens (`globals.css`, verified count) and can auto-trigger on a dark-OS phone with zero user action, rendering Home, Mira, and every cockpit as illegible black-on-dark. And a globally-mounted `bg-blue-600` "Operator Chat — Type a command" widget floats on every authed screen (`operator-chat-widget.tsx:41, 52, 59`, verified) — a color nowhere in the warm system, reframing a trustworthy-colleague product as a developer console.

**The net:** a $100/mo premium frame, undercut at the moments that matter most by an unfinished finish. The fix is not a redesign. It is **finishing** — wiring the soul that is already built, telling the truth at the commit moment, and collapsing four token systems into one. Of the 14 named gaps below, **9 are predominantly wiring or correction of code that already exists** (#1, #2, #3 stale-feed, #5 soul-offstage, #6 chat-widget, #7 perceived-perf, #11 motion, #12 Home cold-start, #13 onboarding's orphaned `useFirstRun`); **4 are net-new design-and-build** (token architecture + full dark palette, IA unification, Mira re-skin, marketing floor); **1 is mixed** (escalation surface — backend built, UI new). That ledger — not a vibe — is why the framing is _finishing, not redesigning._

---

## 2. The north star

**The target feel:** Opening Switchboard should feel like your most capable employee just looked up from their desk and said _"here's what I handled, here's the one thing I need you on, and here's exactly what it'll cost."_ Calm, but unmistakably **alive** — an agent that breathes when it's working and sleeps when it's halted. Premium through restraint, not flash: a warm editorial broadsheet, not a noisy dashboard. Every number is real or honestly absent — never a placeholder, never a fabricated time anchor. The decisive moment — approving real spend, sending a real message — is the _most_ finished surface in the product: the card leaves the instant you commit, the count drops in the same breath, the cost is named in plain English, and a branded undo with a real countdown means you are never punished for trusting it. Bad news is glanceable, not buried. And when an agent needs you while you're away, the app reaches _out_ — it does not wait for you to discover it. The whole thing should feel **decisive, receipted, reversible, and on your side.**

### Success metrics — how "amazing" gets graded

Qualitative principles are unfalsifiable without targets. These are the north-star outcomes every PR and every roadmap wave is measured against. (Baselines marked _measure first_ require instrumentation we do not yet have — standing up that telemetry is itself a Wave-0 task, because we are currently grading ourselves on assertion.)

| Metric                                                                                 | Today                                                       | Target                                                                         | Why it's the right number                                                 |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| **False inbox-zero rate** (app shows "that's everything" with pending items on screen) | Reproducible bug (`inbox-screen.tsx:181`)                   | **0**                                                                          | A single false "all clear" on a money product is a trust-ending event.    |
| **Stale-count incidents** (header count ≠ visible list after an action)                | Reproducible (no `decisions.feed()` invalidation)           | **0**                                                                          | Trains distrust of every number; non-negotiable for a numbers product.    |
| **Dark-mode illegible first-paint rate**                                               | Possible on any dark-OS device                              | **0**                                                                          | Auto-applies with zero user action; a pure first-impression failure.      |
| **Perceived approve-to-feedback latency** (commit → card moves + count drops)          | Network round-trip (no optimistic path)                     | **< 100 ms** (Doherty threshold)                                               | Below ~100 ms the action feels instantaneous; this _is_ the trust moment. |
| **AA pass rate, interactive controls** (text/glyph on its own background)              | Amber CTA fails (3.76:1); negative-delta near-miss (4.36:1) | **100% ≥ 4.5:1**                                                               | The "spend" button failing AA on a money product is indefensible.         |
| **Keyboard-operability of the core decision flow**                                     | 0% (pointer-only `div`, WCAG 2.1.1 fail)                    | **100% operable**                                                              | Hard accessibility floor on the most-used flow.                           |
| **Time-to-clear a 5-item morning queue**                                               | _measure first_                                             | **Set a baseline, then −30%**                                                  | The product's core job-to-be-done; the headline efficiency claim.         |
| **Escalation-to-operator latency** (agent needs you → you're notified out-of-app)      | ∞ (no surface)                                              | **Honor the backend timeouts: 4h critical / 12h high** (`escalation/rules.ts`) | The whole pitch is "handled while you were away"; this is the lifeline.   |

### The seven principles

Memorize them. Every PR is measured against them — and against the metric each one maps to.

### I. Tell the truth at the commit moment

_Never ship a placeholder where money or a customer is at stake — show what you know, honestly omit what you don't._ For a governed AI product, the approval panel **is** the trust contract. "Money at risk: —" actively manufactures doubt at the highest-stakes moment; an honest "No direct cost — this is a comms-only action" earns it. → _Grades: AA pass rate, false-inbox-zero._ _(Stripe/Wise gold standard: name the exact before/after/amount before commit, never a summary of the request.)_

### II. The card leaves before the server answers

_Act optimistically, reconcile in the background, make Undo the safety net — never a frozen card on faith._ A time-poor operator clearing a morning queue needs the stack to visibly shrink as she works. A 60s-stale count trains her to distrust every number in the product. → _Grades: perceived latency < 100 ms, stale-count = 0._ _(Superhuman/Linear: the card leaving IS the confirmation; the undo is the hedge.)_

### III. Friction proportional to irreversibility, not to importance

_Zero friction on reversible low-risk items; deliberate, named friction on irreversible spend._ Uniform confirmation everywhere trains operators to dismiss reflexively, which is the opposite of safety. This is already encoded in `canSwipeApprove()` — it must become **visible**, so the operator _sees_ the system route high-stakes items to review. _(Monzo's positive-friction doctrine: spend the friction budget on stakes, not frequency.)_

### IV. Bring the soul onstage

_The agent is the brand — it must be present, alive, the same entity on every screen, and able to reach you when it needs you._ A breathing avatar derived from real status ("Riley is working on your ad sets right now") is the strongest "this is alive and on my side" signal available, and it is already built. An agent hardcoded to `idle` that wears five faces one tap apart reads as unreliable at a subconscious level. Aliveness also means the agent escalates _to_ you out-of-app — the notification backend exists; the operator just can't see or configure it. _(Calm-tech periphery: present at the edge of attention, never demanding it.)_

### V. One source of truth, enforced

_Every brand color is defined exactly once and consumed as `hsl(var(--x))` — drift is a lint failure, not a style choice._ Four token systems that disagree on the brand's own colors mean every dark-mode, contrast, or rebrand fix must be made three times or it regresses. `mira-config.ts:13` already proves the consumption pattern. _(W3C Design Tokens / Material 3: primitives → semantic → component, single source, generated outputs.)_

### VI. Calm is not inert — but calm has a motion budget

_Restraint is the premium signal, but the daily surface must arrive, not just appear — and no surface runs two persistent animations at once._ Calm means quiet chrome and one action color — not a motion-dead page that cold-starts into a fallback that looks broken. The agents reporting in, the queue closing the gap with FLIP physics, a hero number settling: these make calm feel _occupied_. **The ceiling:** at most one continuously-breathing avatar in a viewport at a time (the focal agent), all others static until interaction; one grain layer on the canvas, never on cards; reduced-motion strips all of it. A broadsheet that flickers everywhere is the noisy dashboard we are escaping. _(Linear's "structure felt, not seen" — but always felt, never busy.)_

### VII. Reversible by default, honest when it fails

_Make recovery visible and the failure path a moment of grace, not a silent ghost — and treat every failure mode as a designed state, not an afterthought._ "Already handled by your teammate · 4m ago" converts a confusing 409 into a trust signal. A worsening ROI delta read as a gentle, legible "cool" — not alarmist red, not invisible gray — tells the operator you don't hide the ball. Offline, API-down, agent-errored, and agent-halted are first-class screens, not blanks. _(Rams: good design is honest; it never appears more capable than it is.)_

---

## 3. Keep these

These are load-bearing assets. **Do not break them. Extend them.**

- **The warm-editorial aesthetic itself** — warm-white canvas, ONE operator-amber action color, agent hues for IDENTITY ONLY (`home.module.css:448–451` literally documents "identity color may NEVER back an action button"). This discipline is correct for the audience and is the product's biggest asset. Make it _coherent across surfaces_, never redesign it.
- **The Home "weeknote"** (`this-week.module.css:96` drop-cap, `:124` "—" signoff, tabular figures). A colleague's letter, not a dashboard. The model to extend everywhere, never flatten.
- **The risk-gated swipe model** (`swipe-policy.ts:8`) and its hand-tuned physics (`components/decisions/use-card-swipe.ts` — 0.65-power rubber-band, 6px axis-lock, trailing-click suppression). "Reversible by default, friction proportional to stakes," enforced at the predicate.
- **The AgentPanel "three-states-never-collapse" invariant** (`agent-panel/key-result.tsx:44`, `open-decisions.tsx:42`). Each slot owns its own loading/error/empty branch; error never reads as "0"; zero is shown dimmed-but-present. **Promote this to a shared `<QueryStates>` primitive** and route every feed through it.
- **The "since you hired Alex" cumulative hero** (56px serif numeral, eyebrow bound strictly to whichever window returned so the number is never mislabeled). Reframes the agent as an investment. **Bring it to Home.**
- **The honest, never-blaming voice** in the strong surfaces — `handoff-detail-sheet.tsx:421–432` distinguishing "saved but undelivered" from "nothing was saved"; plain-English risk chips (`risk-chips.ts:13–18`); the work-log refusing to invent a "since you last looked" time anchor. **This honesty is the emotional moat.**
- **Mira's draft-only safety contract** ("Nothing goes live without you"), cost-confirm gating with a live $ estimate, and the off-scope-redirect brief box.
- **The v6 landing's Riley beat** (live faux Meta-Ads dashboard that _flags_ the saturated ad set with a plain-English Approve/Edit/Dismiss card, `beat-riley.tsx:96–298`) and the Mira pipeline. The product working, not a feature list — the best proof in the product.
- **The honest-marketing guard tests** (`v6/__tests__/no-banned-claims.test.ts`) banning ~40 over-claims. Codifying "we will not lie on the landing page" is rare and exactly right. Extend the pattern to in-app copy.
- **The built escalation/notification backend** (`packages/core/src/notifications/*`, `apps/chat/src/escalation/*`) — multi-channel notifiers, a batcher, and per-risk timeouts already exist. Do not rebuild it; **surface it.**
- **Globally-respected reduced-motion** (`globals.css:308–315` + `:466–472`) and the performance-conscious `OperatorCharacter` (gradient aura not blur, pauses on hidden tab). This is exactly the motion budget Principle VI codifies.
- **The 3-noun primary IA courage (Home/Inbox/Results)** and the deliberate _hiding_ (not deleting) of forensic surfaces. The right altitude. The fix is coherence across breakpoints, not more nav.

---

## 4. The gaps that matter most

Prioritized by trust-cost. The top three are critical-severity and share a theme: **the product is least finished exactly where it carries the most trust.**

> **A note on the CRITICAL ranking of dark mode.** Ranking #3 critical leans on the claim that this audience skews mobile-first and default-dark. That is a **[HYPOTHESIS — validate]**, not telemetry. What is _not_ a hypothesis: the toggle auto-applies from `prefers-color-scheme` with zero user action and leaves ~138 of ~178 tokens unstyled. Even if only a minority of operators run dark-OS, a feature that can render the whole app illegible on first open without the user touching anything is a shipped liability. The fix (hide it now) is an hour and risk-free, so it stays in Wave 0 regardless of how the audience-device question resolves.

### 🔴 CRITICAL — 1. The commit moment is a prototype

**The single highest-severity gap.** At the exact instant an operator decides to trust AI with her money:

- The "What this changes / Money at risk" grid is four hardcoded em-dashes labeled "preview not yet wired / wiring it up next week" (`approval-detail-sheet.tsx:188–232`).
- The Undo toast renders un-branded, never auto-dismisses (`TOAST_REMOVE_DELAY = 1000000`), and `TOAST_LIMIT = 1` evicts the prior undo on the next approval (`use-toast.ts:8–9`) — destroying the safety net for every item but the last in a queue-clearing session.
- There is no optimistic/in-flight feedback, so the card freezes for the network round-trip.
- The built `alreadyHandled` path is never passed (`inbox-screen.tsx` mounts `ApprovalDetailItem` without it), so a stale 409 closes silently with no confirmation.

**Surfaces:** Inbox + Home approval/decision detail sheets, the Undo path. _The most-used flow, the moment of maximum trust._

### 🔴 CRITICAL — 2. Stale feed: actions don't register

Approving on the main Inbox never refreshes the feed or the "things need you" count — `useRecommendationAction` invalidates only `recommendations.all()` + `audit.all()`, never `decisions.feed()` (`use-recommendation-action.ts:38–39`); no `onMutate` optimistic removal exists; `refetchInterval` is 60s. The operator clears 3, the header still says 5, items silently reappear/reorder on the poll. **The OLD header-drawer path DOES invalidate `decisions.feed()` — so the primary surface has the worse behavior.**

**Surfaces:** Inbox (the core decision loop) + Home Needs-You count.

### 🔴 CRITICAL — 3. Dark mode is a shipped liability

The Light/Dark/System toggle leaves most surfaces unstyled and can auto-activate on a dark-OS phone with zero user action. Only ~40 of ~178 declared tokens (`globals.css`, verified) have a `.dark` value; all editorial, agent-identity, shadow, Mercury, and the entire hex `cockpit/tokens.ts` (un-themeable) have none. Home, Mira desk, and every cockpit render illegible black-on-dark on first open.

**Surfaces:** Whole app via Settings → Account; worst on Home / Mira / all cockpits.

### 🟠 HIGH — 4. Four parallel token systems disagree on the brand's own colors

`cockpit/tokens.ts` (18 literal hex, zero `var()`, verified) collides with globals HSL vars; each agent hue is defined 2–4× with conflicting values (Alex coral `14 70% 58%` vs `14 75% 55%` vs `#E07A53`; Mira `--agent-mira` vs the hand-rolled `#4A3A66` at `inbox-agent-avatar.tsx:26`). Any color/a11y/dark fix must be made 3+ times or it regresses. **This is the keystone.** Note honestly: the _consumption_ migration (hex → `hsl(var())`) is mechanical and `mira-config.ts:13` proves it; the _new_ semantic-token architecture and the full dark palette it unblocks are genuine design work (see §6).

### 🟠 HIGH — 5. The soul is offstage; agents never move, and never reach out

1,100+ lines of animated sprites + the breathing `OperatorCharacter` are disconnected from every daily surface. `inbox-agent-avatar.tsx:56` hardcodes `state="idle"`; Home renders flat letter-discs; the same agent wears 2–5 faces/colors one tap apart. Separately, the out-of-app escalation loop has a complete backend but **no dashboard surface** — the operator cannot configure where "Alex needs you" lands, and the app never pings her while she's away. The strongest "alive and on my side" signals were built and unplugged.

### 🟠 HIGH — 6. The operator-chat widget reframes the whole product

A globally-mounted `bg-blue-600` "Operator Chat — Type a command like show pipeline" widget (`operator-chat-widget.tsx:41, 52, 59`, mounted in `(auth)/layout.tsx`) floats on every authed screen — developer-console jargon in a color nowhere in the warm system, contradicting the Alex/Riley/Mira personas on every page.

### 🟠 HIGH — 7. Perceived-performance is backwards

Only the marketing page has a polished skeleton (`(public)/loading.tsx` is the only one, verified). The three daily authed surfaces have no `loading.tsx`, and the Inbox in-component state is a bare unstyled `<div className="inbox-loading">Loading…</div>` (`inbox-screen.tsx:182`) with no CSS rule. Worse, the gate is `if (filtered.isLoading)` (`:181`) — skipped during keys-pending — so it can flash "That's everything" _false inbox-zero_ with pending approvals on screen. **Mira desk already fixed this exact bug** with `!desk && !deskQ.error` (`mira-desk-page.tsx:34`).

### 🟠 HIGH — 8. The IA is incoherent across breakpoints

Nav changes shape 3× (mobile bottom-bar Home/Inbox/Results vs desktop sidebar adding Pipeline/Automations/Mira/Full-reports, unreachable on phone); "Inbox" is two destinations (drawer AND page) on the same feed; agents have no nav home and "open agent" does two contradictory things; the help overlay teaches "each agent has a home page" — which no longer exists.

### 🟠 HIGH — 9. Bad news reads as low-priority; the agent voice splits in two

Results encodes positive deltas in amber (`hsl(var(--action))`) but a worsening delta in `--ink-3` (`results.module.css:24`) — the _same muted-ink family as the "flat" state_ (`--ink-4`). Recomputed against the shipped values: `--ink-3` = `hsl(20 6% 46%)` ≈ **4.36:1** on the `#FAF8F2` canvas (a near-miss for 12px small text, not a clear fail) and `--ink-4` ≈ 2.54:1. The defensible problem is **perceptual, not purely a contrast failure**: "money leaking" is rendered in the same low-emphasis grey as "nothing changed," so bad news doesn't read as bad — and where the delta sits on a tinted card the effective contrast only drops. Separately, the cockpit uses a serif-less inline-px Inter type system (`cockpit/tokens.ts` exports zero type tokens) so the _same agent_ speaks in Newsreader-italic in Inbox and generic Inter in their own cockpit. The trust-critical money screens are the least crafted.

### 🟡 MEDIUM — 10. The WCAG floor is soft on the most trust-critical controls

The ONE amber "approve/spend" button fails AA at rest (white-on-amber **3.76:1** at `--operator: 30 55% 46%`, `globals.css:52` — recomputed and confirmed failing); the entire Inbox decision card is a pointer-only `div` with no `tabIndex`/`role`/`onKeyDown` (hard 2.1.1 failure on the core flow); there is no global `:focus-visible` rule.

### 🟡 MEDIUM — 11. Motion is built but unwired

`framer-motion@12` is a paid dependency with **zero imports in `src`** (verified) — list enter/exit/FLIP is absent, the card's `data-exiting` hook is dead, `EXIT_MS=280` races the 320ms CSS transition, the queue snaps closed, and under reduced-motion a committed card teleports 600px.

### 🟡 MEDIUM — 12. Home cold-starts looking broken

No `isLoading` branch (`home-page.tsx`), no skeleton, so first paint on a slow phone is the fallback verdict ("we don't have a read on today") + "All quiet overnight" + "No active handoffs" — indistinguishable from a dead account. `workInProgressItems` is hardcoded `[]` (`home-page.tsx:198`) so a labeled module _always_ reads empty. No cumulative "since you hired" anchor (Home's longest lens is 7 days).

### 🟡 MEDIUM — 13. Onboarding disowns the app and lets an untested money-agent go live

"Go live anyway" launches a customer-messaging, money-spending Alex with zero passing tests one soft click away; the wizard uses near-black system-font CTAs (`--sw-text-primary`) instead of amber and a disabled-gray agent mark; the launch dumps the operator onto an empty "All caught up · 0 open enquiries" Home; and the purpose-built `useFirstRun` checklist sits as dead code.

### 🟡 MEDIUM — 14. The marketing funnel has no floor

Every primary CTA dead-ends in a `mailto:` (`pricing.tsx`) — a sold mobile buyer must compose an email while the real `(auth)/onboarding` + register API exist unlinked; a doubled-word typo ("One you you don't recognize," `beat-mira.tsx:129`) sits on the page selling AI-written copy; and ZERO social proof — every number is stamped "illustrative."

---

## 5. The direction, surface by surface

Each move tagged **[quick win]** (hours–1 day, mostly wiring) or **[systemic]** (multi-day, structural). Impact/effort are first-pass engineering estimates, not commitments; any "High/Low" that touches a reducer, queue, or cross-surface state carries a one-line basis so the estimate is auditable.

### Marketing / Landing — `(public)/welcome`, `components/landing/v6/*`

| Move                                                                                                                                                                                                                               | Tag         | Impact / Effort                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------ |
| **Wire every primary CTA to `(auth)/onboarding`** (the route exists, never linked); demote `mailto:` in `pricing.tsx` to a tertiary "or email us." Add one persistent "Start" affordance in topbar + dock.                         | [quick win] | High / Low — _the funnel currently has no floor_ |
| **Lead the hero with felt pain over abstract category.** Pull the already-written "Leads die in twelve minutes" / "almost-ready for two weeks" energy above the fold (it's stranded in beats 3 & 5); keep the rotating agent verb. | [quick win] | High / Low                                       |
| **Fix the doubled-word typo** "One you you don't recognize" (`beat-mira.tsx:129` and `:234`) — uniquely self-defeating on the page selling AI copy.                                                                                | [quick win] | Med / Trivial                                    |
| **Add ONE honest credibility anchor** the guard-tests permit (real pilot quote with clinic+city, or "N clinics running").                                                                                                          | [systemic]  | High / Med                                       |
| **Close the brand seams:** reconcile marketing coral `14 75% 55%` with in-app amber `30 55% 46%` (or document the split), and re-skin `/privacy` + `/terms` into the v6 cream register.                                            | [systemic]  | Med / Med                                        |

### Onboarding — `(auth)/onboarding` wizard, `useFirstRun`, post-launch Home

| Move                                                                                                                                                                                                                               | Tag         | Impact / Effort                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------- |
| **Close "Go live anyway."** Require ≥1 passing simulated scenario, or make it a deliberate copy-heavy confirm ("Alex will message real customers untested — continue?").                                                           | [quick win] | High / Low — _safety, not polish_ |
| **Wire the orphaned `useFirstRun`** (zero non-test consumers today) into a post-launch Home hero: "Alex is live on {channel}" + a 3-step "what happens next" checklist, replacing the empty "All caught up · 0 enquiries" landing. | [systemic]  | High / Med                        |
| **Add a "text Alex from your own phone" real-channel proof** immediately after launch — the strongest possible aha, turning "it's live" into a visceral, real-channel demonstration.                                               | [systemic]  | High / Med                        |
| **Re-skin the wizard to the app's language:** amber CTAs (not `--sw-text-primary` near-black), Alex's `AgentMark` in its identity hue + breathing aura (not disabled-gray), normalized wordmark.                                   | [quick win] | High / Low                        |
| **Add a slim step rail + "~2 minutes" effort promise**; replace bare "Loading…" / "Signing you in…" with a branded breathing mark.                                                                                                 | [quick win] | Med / Low                         |

### Home — `home-page.tsx`, `components/home/*`

| Move                                                                                                                                                                                                                                                                                                                                   | Tag         | Impact / Effort |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------------- |
| **Add a real loading skeleton** (verdict shimmer + chip/ThisWeek skeletons) and split loading vs calm vs error, so cold-start never paints the "we don't have a read on today / all quiet / no active handoffs" broken-looking combo.                                                                                                  | [systemic]  | High / Med      |
| **Kill the permanently-empty "work in progress" module** (`workInProgressItems = []`, `:198`) and reclaim the 320px rail slot for a cumulative **"Since you hired your team: N leads answered · M consults booked · ~$X saved"** value strip — the trust anchor Home lacks (the framing already exists in the AgentPanel; promote it). | [systemic]  | High / Med      |
| **Bring the soul onstage:** render the focal breathing `OperatorCharacter` in the verdict hero, replacing the flat letter-disc (one breathing avatar per viewport — Principle VI).                                                                                                                                                     | [systemic]  | High / Med      |
| **Make the proof line self-consistent** — drop zero/empty clauses so it can never read "0 open leads" under "Two things need you."                                                                                                                                                                                                     | [quick win] | Med / Low       |
| **Coordinate the first composed paint** (gate verdict + main column on the hooks that define the headline) so the briefing fades in finished, not assembling. Wire the already-built `useEntrancePlayed` + fade-in keyframe for a once-per-session staggered settle.                                                                   | [systemic]  | Med / Med       |
| **Unify the hero number voice** (spell counts through ten) and drop the stale-prone minute from the eyebrow clock.                                                                                                                                                                                                                     | [quick win] | Low / Low       |

### Inbox — `inbox-screen.tsx`, `components/inbox/*`, `components/decisions/*`

| Move                                                                                                                                                                                                                                                                                                                                                                                                 | Tag         | Impact / Effort |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------------- |
| **Wire feed freshness: `onMutate` optimistic removal (snapshot + rollback-on-error + poll-reconcile) + invalidate `decisions.feed()`** in `useRecommendationAction` (mirror what `dispatch-action.ts` already does). **The #1 trust/momentum fix.** _Basis for Med effort: the invalidation is trivial, but correct optimistic removal must restore on error and not fight the 60s poll on reorder._ | [systemic]  | High / Med      |
| **Delete the "preview not yet wired" em-dash grid** (`approval-detail-sheet.tsx:188–232`). Render the data you have (risk chips, any budget/spend in the payload, plain-English action) and _omit_ the before/after block until it's real. Never show "Money at risk: —" on a spend decision.                                                                                                        | [quick win] | High / Low      |
| **Fix the false inbox-zero:** change the gate from `if (filtered.isLoading)` to `if (!filtered.data && !filtered.isError)` (the exact fix `mira-desk-page.tsx:34` already ships).                                                                                                                                                                                                                    | [quick win] | High / Trivial  |
| **Rebuild Undo as a real safety net:** brand it with the existing `.toast-undo` styling, give it a countdown bound to `undoableUntil`, stop it auto-evicting on the next approval (raise `TOAST_LIMIT`, queue don't replace; bind `TOAST_REMOVE_DELAY` to the real window). _Touches the toast reducer + queueing + countdown binding — a genuine subsystem, not a one-liner._                       | [systemic]  | High / Med      |
| **Wire the built-but-unused `alreadyHandled` path** so a stale 409 reads "Already handled by [teammate] · 4m ago" instead of a silent close.                                                                                                                                                                                                                                                         | [quick win] | High / Low      |
| **Replace the bare "Loading…" with a layout-matched skeleton** (masthead + filter row + 3–4 ghost decision rows).                                                                                                                                                                                                                                                                                    | [quick win] | Med / Low       |
| **Make the decision card keyboard-operable** (`role="button"`, `tabIndex={0}`, Enter/Space → open; j/k navigate; a/e approve/skip for swipe-eligible items) — fixes the WCAG 2.1.1 failure and unlocks desktop power-triage. _Desktop affordance; the touch equivalent is the swipe system in §5a._                                                                                                  | [systemic]  | High / Med      |
| **Sort the queue by SLA/urgency** (`urgencyScore`/`slaDeadlineAt` exist) and render the already-styled "Needs you now / Can wait" group headers (`.queue-group-h` is dead CSS). Wire the dead `data-exiting` hook via framer-motion `AnimatePresence` `mode="popLayout"` so removal FLIPs the gap closed and the reduced-motion teleport dies.                                                       | [systemic]  | High / Med      |
| **Unify Home and Inbox into ONE approve interaction** + one confirm surface + one amber-button token set (`.btnPrimary` vs `.ds-action-primary` are maintained separately today).                                                                                                                                                                                                                    | [systemic]  | High / Med      |
| **Collapse the dual Inbox** (drawer + page on the same `useDecisionFeed`): one canonical surface, the other an explicit "peek → View all."                                                                                                                                                                                                                                                           | [systemic]  | Med / Med       |

### 5a. Mobile & touch — the primary surface, treated as primary

The audience being mobile-first is **[HYPOTHESIS — validate]** (no device telemetry today), but the app already ships a bottom-bar nav and a swipe-to-approve gesture, so it is _de facto_ a touch product whose touch layer is under-specified. Do not let the keyboard-triage investment (§Inbox) imply the desktop is the priority device — that investment is for power-users on laptops; the gestures below are for the operator on her phone between patients. **If validation shows the audience is desktop-dominant, defer this section — but decide on evidence, not silence.**

| Move                                                                                                                                                                                                                                                                                                                                                       | Tag         | Impact / Effort |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------------- |
| **Touch-target audit to a 44×44px floor** across the decision card actions, bottom-bar, filter chips, and sheet controls (several render smaller today). One pass, one benchmark component (the Inbox card).                                                                                                                                               | [quick win] | High / Med      |
| **Promote the swipe into a real interaction system, not a single gesture.** The hand-tuned `use-card-swipe.ts` physics is excellent — extend it: a short directional reveal showing the _named_ consequence under the card ("→ Approve · sends to customer"); the rubber-band already there for financial items as the _felt_ expression of Principle III. | [systemic]  | High / Med      |
| **Make sheets thumb-reachable bottom-sheets on phone:** primary action within the bottom third, drag-to-dismiss, safe-area insets. The `ui/sheet.tsx` primitive exists; specify the mobile ergonomics on top of it.                                                                                                                                        | [systemic]  | Med / Med       |
| **Add restrained haptics** (`navigator.vibrate` where supported): a single light tick on commit and on swipe-threshold-cross — the physical receipt that makes "it registered" visceral. Off under reduced-motion / when unsupported; never on scroll.                                                                                                     | [quick win] | Med / Low       |

### Results — `components/results/*`

| Move                                                                                                                                                                                                                                                                                                                                                                                                           | Tag         | Impact / Effort |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------------- |
| **Stop burying bad news.** Move the worsening delta out of the muted-ink family it currently shares with "flat" (`--ink-3`, ~4.36:1): give `deltaNeg` a distinct, AA-passing cool treatment (a muted slate/terra-cotta ≥ 4.5:1 against the actual card it sits on, not alarmist red) + a directional glyph so a worsening ROI is glanceable. _Verify against the tinted card background, not only the canvas._ | [quick win] | High / Low      |
| **Lead with a single earned ratio:** cost-per-booked-appointment as the hero (not impressions/CPL), with a "since Riley launched" cumulative framing as a first-class one-tap button.                                                                                                                                                                                                                          | [systemic]  | High / Med      |
| **Add a "so what" sentence under each hero metric**, auto-generated from real data ("Riley's cost-per-booked dropped 34% since you raised the cap May 12"); omit the causal clause when unknown — never fabricate.                                                                                                                                                                                             | [systemic]  | High / Med      |
| **Switch all attribution language** from "generated" to "handled / attributed / assisted" ("Alex handled 14 leads; 9 booked") — conservative and verifiable against the operator's own calendar.                                                                                                                                                                                                               | [quick win] | Med / Low       |
| **Add inline 7/14-day sparklines** beside each hero number; add `font-variant-numeric: tabular-nums` (the current `data-tabular` is a no-op so KPI numbers jitter).                                                                                                                                                                                                                                            | [quick win] | Med / Low       |
| **Add `results/loading.tsx`** with a layout-matched skeleton, gated `!data && !error`.                                                                                                                                                                                                                                                                                                                         | [quick win] | Med / Low       |

### Agent cockpits — Alex / Riley / Mira (`components/cockpit/*`, `components/agent-panel/*`)

| Move                                                                                                                                                                                                                                                                                                                                                                                         | Tag         | Impact / Effort |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------------- |
| **Switch the agents on.** Replace the hardcoded `state="idle"` (`inbox-agent-avatar.tsx:56`) with state derived from real agent status (busy/idle/halted → working/idle/sleep), and give Home TeamPulse + the AgentPanel header the same avatar — honoring the one-breathing-avatar-per-viewport budget (§VI). **Highest aliveness-per-effort win in the product — almost entirely wiring.** | [systemic]  | High / Med      |
| **Unify agent identity to ONE avatar + one color source** (`hsl(var(--agent-*))`) across Home, Inbox rows, AgentPanel, Mira desk — kill the serif-letter-circle vs hex-pixel-sprite-square split and the hand-rolled `#4A3A66` Mira.                                                                                                                                                         | [systemic]  | High / Med      |
| **Re-skin Mira's desk into the warm-editorial register:** a 36px sans "count" hero (Alex keeps the 56px serif hero), fewer JetBrains-Mono uppercase eyebrows, panel-grade loading/empty states, violet-as-identity warmth. The taste-and-warmth agent has the least creative-feeling surface.                                                                                                | [systemic]  | High / High     |
| **Give Mira a real 4-slot drill-in** in the AgentPanel instead of the "Open workspace →" stub, so all three teammates honor the same "tap to see what they're up to" promise.                                                                                                                                                                                                                | [systemic]  | Med / Med       |
| **Make the cockpit speak the editorial serif:** render agent name (`identity.tsx`) + approval title (`approval-card.tsx`) in `var(--serif)` italic so Alex's voice is continuous from Inbox into the cockpit.                                                                                                                                                                                | [quick win] | High / Low      |
| **Recolor the Halt/Resume control to operator-amber** (retiring the saturated `T.red`/`T.green` stop-go at `identity.tsx:163`); reserve red strictly for irreversible Mira actions, restoring one-action-color discipline.                                                                                                                                                                   | [quick win] | Med / Low       |
| **Delete or quarantine the dead cockpit family** (`ApprovalCard`/`roi-bar`/`kpi-strip` are orphaned — `ApprovalCard`'s only importer is the unused `roi-bar`) to shrink the hex-`T` footprint before migration.                                                                                                                                                                              | [quick win] | Med / Low       |

### Settings, escalation & the chat widget — `settings/*`, `(auth)/layout.tsx`

| Move                                                                                                                                                                                                                                                                                                                                                                                                                         | Tag         | Impact / Effort |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------------- |
| **Hide Dark/System in Settings → Account** until a complete dark palette exists; remove the `prefers-color-scheme` auto-apply in `use-theme.ts`. **One-hour change that eliminates a class of first-impression failures.**                                                                                                                                                                                                   | [quick win] | High / Trivial  |
| **Surface the escalation channel** (backend exists; dashboard has zero UI). A "How should I reach you when I need a decision?" panel binding the operator to WhatsApp/Slack/email/SMS via the existing notifiers, exposing the already-defined per-risk timeouts in plain English ("Critical: I'll wait up to 4 hours, then ping your fallback"). **The lifeline the whole "handled while you were away" pitch depends on.** | [systemic]  | High / Med      |
| **Rewrite Spend Limits with consequence-framing.** Turn the bare "Daily Limit ($)" / "Save" / "No limit" form into "How much can Alex spend before asking you?" with per-field helper ("Above this, I'll pause and ask") and a plain-English policy readback. Replace the "No limit" default with "Always ask me."                                                                                                           | [systemic]  | High / Med      |
| **Make the index mirror its rail** (index shows 3, rail shows 7) and de-Alex the agent-agnostic copy (Team/Channels are workspace-level).                                                                                                                                                                                                                                                                                    | [quick win] | Med / Low       |
| **Re-skin or flag-hide the operator-chat widget** (`operator-chat-widget.tsx`, mounted in `(auth)/layout.tsx`): kill `bg-blue-600` + "Type a command," voice it as "Ask Alex" in the warm register behind a focused trigger, or gate behind a flag until NL is real.                                                                                                                                                         | [quick win] | High / Low      |

### Failure & empty states — a system, not a footnote — `components/*/states.tsx`, error boundaries

The happy path is well-specified; the failure surface is not. For a product that spends money and messages customers, every one of these must be a _designed_ screen in Alex's honest voice — never a blank, a spinner-forever, or a raw error.

| State                          | Today                           | Direction                                                                                                                                                |
| ------------------------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Network offline**            | Undefined                       | A calm persistent banner ("You're offline — I'll hold your decisions until you're back"); queue actions disabled, not failing silently.                  |
| **API / agent backend down**   | Generic error boundary          | "I can't reach the agents right now — nothing you've approved is lost. Retrying…" with a manual retry. Never imply data loss.                            |
| **Agent errored mid-action**   | Unspecified                     | Lean on the existing honest split (`handoff-detail-sheet.tsx:421–432`): distinguish "started but didn't finish" from "nothing happened," and name which. |
| **Agent halted / paused**      | No dedicated treatment          | The avatar sleeps (state already supports it); the surface says "Alex is paused — resume when you're ready," not an empty feed that looks broken.        |
| **Designed empty / all-clear** | Reads as dead account (#7, #12) | A _composed_ "you're all caught up" with the cumulative "since you hired" anchor — completion as reward (Things 3), never a blank.                       |

---

## 6. The foundational layer

**This is what makes everything else cohere.** Token unification is the keystone: it unblocks dark mode, kills color drift, and makes every elevation/spacing/type/a11y fix enforceable instead of regression-prone. Be honest about its shape: it is **one mechanical half and one design half.**

### Resolve the four-token tension — collapse onto ONE system

**Half A — mechanical (low risk).** Pure value substitution; `mira-config.ts:13–16` already proves the consumption pattern:

```ts
// the pattern that must become universal:
base: "hsl(var(--agent-mira))",
deep: "hsl(var(--agent-mira-deep))",
```

1. **Rewrite every literal in `cockpit/tokens.ts`** (`amber: "#B8782E"` → `hsl(var(--action))`, `ink: "#0E0C0A"` → `hsl(var(--ink))`, etc.) and each `*_ACCENT` constant (incl. the hand-rolled `#4A3A66` Mira in `inbox-agent-avatar.tsx:26`) to `hsl(var(--...))`. Components already read `T.x`/`accent.base`, so they barely change — but the cockpit instantly becomes dark-capable and rebrandable.
2. **Scope to the live footprint.** Verify `ApprovalCard`/`roi-bar`/`kpi-strip` are dead, delete them, and migrate only what operators can see.
3. **Collapse each agent hue to one definition** in `globals.css` and delete the conflicting copies (`#E07A53`, `v6.coral`, `#4A3A66`).
4. **Add a drift-guard** to the existing `tokens.test.ts`: assert no agent hex lives outside `globals.css`, and that the `T` object resolves to `var()` references only. Drift becomes a CI failure.

**Half B — design work (real cost; do not call it mechanical).** This is where Wave 1's true effort lives and must be budgeted as design, not find-and-replace:

5. **Define a three-tier architecture:** primitive tokens (raw HSL) → semantic tokens (`--action-primary`, `--surface-raised`, `--text-muted`) → component tokens. _Naming the semantic layer is a design decision_ — which roles exist, what each maps to in light and dark. Components reference only semantic.
6. **Author the full `.dark` palette for all ~178 tokens** (see below) — luminance-step choices, the warm-near-black value, agent-hue lift. This is bespoke visual design, not substitution.

### Dark mode — ship light-only, then complete it as a system

A broken dark mode is worse than none. Hide Dark/System now (`use-theme.ts`). Then, after token unification, design the full `.dark` block for all ~178 tokens following the Linear/Material 3 luminance-step model: warm near-black for editorial backgrounds, agent hues lifted to 60–65% lightness (up from 55–58%) for legibility on dark, shadows replaced with tonal surface steps, and the now-`var()`-backed cockpit participating automatically. Test on OLED and LCD before re-enabling.

### Color & contrast _(all values recomputed against shipped tokens)_

- **Darken the action amber** from `--operator: 30 55% 46%` (**3.76:1** white-on-amber, fails AA) to **`30 58% 41%` (≈ 4.51:1, passes AA while keeping warmth)** — note: a deeper `30 58% 38%` overshoots to ~5.13:1 and loses vibrancy, so prefer the 41% L. Resolve `T.amber` + inbox `--amber` to the same chosen value. Keep the brighter 46% only for non-text uses (stripes, fills, the brand pip).
- **Lift the negative/flat delta out of the muted-ink family** (Gap #9): `--ink-3` ≈ 4.36:1 and `--ink-4` ≈ 2.54:1 are both _low-emphasis_, so bad news reads as neutral. Give a worsening delta its own AA-passing cool token, verified against the card it sits on.
- **One global `:focus-visible` rule** in `globals.css`: `:focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: 2px; }` — replacing today's ~4-element opt-in patchwork.
- **Promote the failing micro-text tiers** (`--tertiary-foreground` ~2.9:1, `--ink-4` ~2.54:1) up one step wherever they carry real info (Results labels, section labels, cockpit captions).

### Type system

- **One canonical metric-number treatment:** a single `.num`/`[data-tabular]` utility with real `font-variant-numeric: tabular-nums` (fixing the no-op jitter) and ONE face — adopt the JetBrains-Mono "instrument-grade" treatment Results uses for big numbers and make Home/cockpit match. Kills the serif-vs-mono-vs-Inter three-fonts split.
- **Give the cockpit a type scale** and adopt `var(--serif)` italic for agent identity (it exports zero type tokens today).
- **Collapse the ~9 ad-hoc letter-spacing values** into 2–3 named tracking tokens (`--track-label` 0.08em, `--track-eyebrow` 0.12em).
- **Fix the lies:** delete the dead "Instrument Sans" `--font-display` fallback (DM Sans actually loads), curly-quote the cockpit pull-quote (`approval-card.tsx:178`), document the Space-Mono-vs-JetBrains-Mono split.

### Spacing & density

Adopt a strict 4pt scale (4/8/12/16/24/32/48/64), expose it via Tailwind so the dead `--space-*` tokens become live, and retire the free-hand 7/9/11/14/18/22px module spacing. Fix the highest-frequency component first (the Inbox card) to set the visible benchmark.

### Depth / elevation

Replace ~35 ad-hoc shadows (four different base colors today) with a 5-level ladder using ONE warm base at incrementing opacity (`--shadow-1` … `--shadow-5`), z-index-mapped (card-rest → hover → dropdown → sheet → modal). In dark mode, swap shadows for tonal luminance steps — which is _why_ the system must move off shadow-only to be dark-capable.

### Motion language _(governed by the Principle-VI motion budget)_

- **Use the already-installed `framer-motion`** (zero usages today): wrap the Inbox + Home decision lists in `AnimatePresence` `mode="popLayout"` + `layout`, exit at ~150ms ease-in transform+opacity, let the library own exit timing — killing the dead `data-exiting` hook, the 280ms-vs-320ms race, and the reduced-motion teleport in one move.
- **Adopt Carbon's Productive/Expressive split:** triage = Productive (100–200ms ease-out, no spring); Home weeknote, agent panel, approval confirm, Mira desk = Expressive (250–350ms spring, bounce ≤ 0.1).
- **Never animate at keyboard-triage frequency** (j/k/a/e must respond < 80ms or not move spatially).
- **Hold the aliveness ceiling:** one breathing avatar per viewport, one grain layer on the canvas only. Persistent motion is a budget, not a default.
- **Add a 4% SVG `fractalNoise` grain** over the warm-cream base (Arc Browser technique) — one CSS rule, the highest ROI-to-effort craft upgrade, felt-not-seen premium warmth. Remove it on cards/buttons and in dark mode.

### The perceived-performance primitive

Extract the AgentPanel three-states invariant into a shared `<QueryStates loading={…} error={…} empty={…}>` (or `useQueryGate` returning `'loading'|'error'|'empty'|'data'` via the `!data && !error` keys-pending-safe rule). Route every feed through it, add `(auth)/loading.tsx` route shells for Home/Inbox/Results/Mira, and make the failure-state matrix (§5) the `error` branch's vocabulary. This kills the `isLoading` false-empty class **and** the bare-text tier in a single change.

### The voice & copy layer — write the principle down once

So much of the trust thesis rides on words that "tell the truth at the commit moment" will otherwise be re-litigated every PR. Consolidate the honest voice (already strong in `handoff-detail-sheet.tsx`, `risk-chips.ts`) into a one-page in-repo voice spec + a thin copy-token layer, and extend the `no-banned-claims` guard from marketing into the app:

- **Numbers:** spell counts through ten in prose ("Two things need you"); always tabular in metric display.
- **Attribution verbs:** "handled / attributed / assisted / booked" — never "generated"; conservative and operator-verifiable.
- **Absence phrasing:** omit, never placeholder — "No direct cost — comms-only" over "Money at risk: —."
- **Agent as actor, first person, never blaming:** "I'll pause and ask," "Already handled by your teammate," "started but didn't finish."

### How we'll know it landed — verification gates

"Amazing" must be checkable, not asserted. Wire these into CI/review alongside the token drift-guard:

- **Contrast gate:** an automated check (or a reviewed checklist) asserting every interactive text/glyph hits ≥ 4.5:1 against its real background — the exact regression class this document had to recompute by hand.
- **Visual-regression snapshots** on the trust-critical surfaces (approval sheet, Inbox card states, Home verdict, Results deltas) so "the commit moment looks finished" is enforced, not eyeballed.
- **Perf budget** tied to §perceived-performance: route-shell present on all four daily surfaces; commit→optimistic-removal measured < 100ms in the harness.
- **A11y gate:** keyboard-operability of the decision card asserted in test; global `:focus-visible` present.

---

## 7. Sequenced roadmap

Ordered so the feel compounds — and so trust is repaired _before_ delight is added (Walter's hierarchy: a product is delightful only if it is reliable). Each wave's outcome is bound to the §2 metrics it must move. **Parallelism note:** several Wave-2 wins (Undo rebuild, switch-the-agents-on state-wiring, framer-motion, keyboard/touch) do **not** depend on the Wave-1 token work and can start the moment Wave 0 lands — only the _one canonical avatar color source_ and anything dark-mode-bound must wait for unification. Don't strand independent quick wins behind the foundation.

### Wave 0 — Stop the bleeding (this week, mostly hours)

_The lowest-effort, highest-trust-cost fixes. All quick wins. Plus: stand up the metric instrumentation, because we cannot grade anything we don't measure._

1. **Delete the "preview not yet wired" em-dash grid** — render what you have, omit the rest. (`approval-detail-sheet.tsx:188–232`)
2. **Hide Dark/System + remove the auto-apply.** (`use-theme.ts`, `settings/account`)
3. **Fix the false inbox-zero gate** → `!data && !error`. (`inbox-screen.tsx:181`)
4. **Wire `decisions.feed()` invalidation + `onMutate` optimistic removal (with rollback).** (`use-recommendation-action.ts:38`)
5. **Wire the built `alreadyHandled` path** → "Already handled by [teammate] · 4m ago."
6. **Darken the action amber to AA (`30 58% 41%`)** + add the one global `:focus-visible`. (`globals.css:52`)
7. **Re-skin or flag-hide the blue operator-chat widget.** (`operator-chat-widget.tsx`)
8. **Close "Go live anyway"** with a real gate or hard confirm.
9. **Instrument the §2 metrics** (false-inbox-zero, stale-count, perceived-latency, queue-clear time) so later waves are falsifiable.

_Outcome → metrics: false-inbox-zero = 0, stale-count = 0, dark-illegible-first-paint = 0, amber AA pass. The commit moment stops lying; the app stops breaking itself._

### Wave 1 — The foundation (1–2 weeks)

_The keystone that makes everything after it enforceable. Half mechanical, half real design work — budget both._

1. **Token unification** — (mechanical) migrate `cockpit/tokens.ts` + `*_ACCENT` to `hsl(var())`, collapse each agent hue to one source, delete the dead cockpit family, add the `tokens.test.ts` drift guard; (design) author the three-tier semantic architecture.
2. **Type system** — one metric-number treatment with real tabular figures; cockpit adopts `var(--serif)` for agent identity; named tracking tokens; kill the font lies.
3. **Elevation + spacing ladders** — 5-level shadow, 4pt scale via Tailwind, retire dead tokens.
4. **The `<QueryStates>` primitive + `(auth)/loading.tsx` shells** for Home/Inbox/Results/Mira, with layout-matched skeletons and the failure-state matrix as the error branch.
5. **Write the voice spec + extend the `no-banned-claims` guard into the app.**

_Outcome → metrics: one coherent system; every later contrast/dark/a11y fix is single-source and CI-guarded against regression._

### Wave 2 — Bring the soul onstage + finish the loop (1–2 weeks; items 2–4 can run parallel to Wave 1)

1. **Switch the agents on** — derive avatar state from real status; one canonical breathing avatar on Home hero + AgentPanel header + Inbox rows (one per viewport). _(Color-unification leg depends on Wave 1; the state-wiring leg does not — start it early.)_
2. **Rebuild Undo** — branded `.toast-undo`, real countdown bound to `undoableUntil`, queue-not-evict. _(Independent of Wave 1.)_
3. **Wire framer-motion `AnimatePresence`** on the Inbox + Home lists — FLIP removal, reduced-motion fade. _(Independent of Wave 1.)_
4. **Keyboard triage + the mobile touch pass** — Inbox card role/tabIndex/Enter/j/k/a/e; 44px targets, swipe-reveal consequence, bottom-sheet ergonomics, commit haptic. _(Independent of Wave 1.)_
5. **Home cumulative "since you hired" strip** replacing the empty WIP module + Home loading skeleton.
6. **Results bad-news legibility** (cool AA delta + sparklines + "so what" sentences).
7. **Surface the escalation channel** in Settings (bind to existing notifiers + per-risk timeouts).

_Outcome → metrics: perceived approve-to-feedback < 100 ms, keyboard-operability 100%, escalation-latency finite. The product feels alive, decisive, reversible, and reaches out._

### Wave 3 — Coherence + activation (2–3 weeks)

1. **Complete the dark palette** (now design-bounded, not blocked, post-unification) and re-enable the toggle.
2. **Unify the IA** — one responsive nav, one Inbox surface, a real Agents nav home, one outcomes label, one halt control, corrected help copy.
3. **Re-skin Mira's desk** into the warm-editorial register + the 4-slot drill-in.
4. **Onboarding arc** — wire `useFirstRun` post-launch hero, "text Alex from your phone" proof, amber wizard re-skin.
5. **Marketing floor** — CTA → `(auth)/onboarding`, pain-first hero, one credibility anchor, brand-seam cleanup, the typo.
6. **Spend Limits consequence-framing.**

_Outcome → metrics: monolithic brand landing → signup → daily use; time-to-clear-queue baseline set and trending toward −30%; activation lands instead of deflating._

---

## 8. Inspiration board

The exemplars to emulate — each with the **one specific thing to steal**, mapped to a Switchboard surface. (Three of these point at the same approval panel; that is the point — it is the highest-leverage surface in the product, and the best four products in the world all solved it the same way.)

- **Superhuman** → _Optimistic removal + the card leaves at 50ms; undo (Z) is the safety net, not a modal._ Steal it for the Inbox commit: the card flies off and the Needs-You count drops the instant you swipe, reconcile behind. (Gaps #1, #2.)
- **Linear** → _FLIP list animation + "structure felt, not seen."_ Steal `AnimatePresence` `mode="popLayout"` so the queue closes the gap instead of snapping — plus the dimmed-chrome restraint so the inbox dominates. (Gap #11.)
- **Stripe → Wise → Ramp (the approval panel, three angles)** → Stripe: _the confirmation names the exact amount/fee/destination before commit, never a summary._ Wise: _before → after → fee → ETA on one screen, so the user verifies rather than trusts._ Ramp: _policy-as-UX — the card shows which rule triggered the review ("estimated spend $340 exceeds your $200 threshold")._ Steal all three for "What this changes" once the data is wired; until then, honest absence over a placeholder. (Gap #1, Principle I.)
- **Monzo** → _Positive friction calibrated to stakes._ Steal "good friction at the right moment" — make `canSwipeApprove()`'s gating _visible_ so the operator sees the system protect her, expressed as the swipe rubber-band on financial items. (Principle III, §5a.)
- **Mercury** → _Financial figures as a distinct typographic tier (custom weight, tight tracking, tabular numerals)._ Steal it for the one canonical metric-number treatment across Home/Results/cockpit. (Gaps #4, #9.)
- **Intercom Fin** → _Names the agent as the actor; layers summary → involvement → resolution → why._ Steal "Alex handled 14 leads; 9 booked" attribution and the navigable work-log as proof-of-work. (Gap #9, voice layer.)
- **Things 3** → _Calm through ruthless exclusion + haptic completion satisfaction._ Steal the discipline that the all-clear state is _designed_ and completing the queue is a felt reward, not a blank screen. (Gaps #7, #12; §5a haptics.)
- **GitHub Copilot / Cursor** → _Agents are first-class objects in a persistent sessions view — live status, what's running, what's done._ Steal it for the AgentPanel: a "currently working on" surface derived from real `WorkTrace` status, not a stats sheet. (Principle IV.)
- **Arc Browser** → _A 4% `fractalNoise` grain over a warm background — invisible at arm's length, felt as "crafted."_ Steal the one CSS rule for the warm-cream canvas. (Foundational warmth.)
- **Premium medspa websites (the audience's own world)** → _Warm neutrals + one precious-metal accent + serif-sans editorial pairing._ This is the visual language operators live in professionally — exactly Switchboard's existing bet. Steal the reminder: never drift into clinical-white or developer-console blue, because for _this_ audience the clash is maximally jarring. (Gap #6.)

---

_The aesthetic is already right. The soul is already built. The voice is already honest where it speaks. What remains is to finish it — tell the truth at the commit moment, plug the soul (and its escalation lifeline) into the daily surface, and collapse four token systems into one — so the floor finally rises to meet the ceiling. And every one of those claims is now something we can measure._
