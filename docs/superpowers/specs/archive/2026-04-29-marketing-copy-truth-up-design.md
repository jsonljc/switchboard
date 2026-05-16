# Marketing copy truth-up — v6 landing page (slice A)

**Date:** 2026-04-29
**Author:** Jason
**Branch:** `docs/marketing-copy-truth-up` (spec) → `feat/landing-v6-truth-up` (implementation)
**Sequencing:** A (this spec) ships first. B (Nova approval gate) and C (public-surface visual convergence) are independent follow-on workstreams with their own specs.

## Principle

**Sell the vision, but only claim the current product.**

The website is allowed to be aspirational about direction. It is not allowed to make specific claims that the product does not back today — particularly around metering, overage rates, bundle discounts, Mira credits, integration coverage, SLA telemetry, exports, and any approval-first language that is not yet enforced for every agent.

This is a focused trust fix on the v6 landing page (`apps/dashboard/src/app/(public)/page.tsx` and `apps/dashboard/src/components/landing/v6/*`). It does not touch product code, billing, telemetry, integrations, or visual styling. Deletions and copy edits only.

## Goals

1. Remove every claim that the codebase audit on 2026-04-29 marked as ❌ NOT FOUND or ⚠️ CONTRADICTED.
2. Soften every claim marked 🟡 PARTIAL to honest directional language.
3. Preserve the page's architecture (eight beats), visual rhythm (three pricing cards), and emotional throughline.
4. Land in a single PR. No phased rollout.

## Non-goals

- Building any of the deferred missing capabilities (billing, telemetry, Cal.com API, Notion connector, audit export, Mira credit system, autonomy toggle UI). Those are slice D and slice E and are explicitly out of scope.
- Restyling, layout changes, or font system changes. Brand polish is slice C.
- Adding new sections or features. The page keeps its eight beats.
- Touching `(public)/pricing/page.tsx`, `/how-it-works`, `/agents`, or any other public route. Only the home page and its components.
- Strengthening the approval-first language back to "no external change goes live without approval." That can only happen after slice B (Nova approval gate) ships.

## Copy rules (apply across the page)

These rules drive every change in this spec. If a future copy revision is proposed, it must obey these rules until B ships and the billing/metering workstream begins.

1. **Remove specific timing claims unless measured.**
   - "twelve seconds" → "seconds"
   - "12-second median" → "fast first reply"
2. **Replace hard automation claims with draft/review language.**
   - "pauses" → "drafts the pause"
   - "launches" → "drafts launches"
   - "moves money" → "drafts budget moves"
3. **Replace unsupported shared-memory claims with softer context language.**
   - "one memory" → "shared context"
   - Drop specific cross-agent telemetry examples until the cross-agent signal pipe is wired.
4. **Remove unsupported integrations.**
   - Keep: WhatsApp, Telegram, Meta Ads, Google Calendar.
   - Drop: Notion, Cal.com — until the actual integration exists beyond URL handling.
5. **Mark illustrative mocks clearly.**
   - Add small caption under the Nova dashboard mock: _Illustrative example. Actual results vary._
6. **Drop export / search / auditor claims for now.**
   - Use: _Logged with timestamp, agent, and reasoning. Queryable from your dashboard._

## Section-by-section copy diff

Each row gives the file, the current string in the code, and the new string. Strings inside `< >` are component or attribute references, not copy. Where a row says **DELETE**, the entire element is removed (with its surrounding whitespace).

Component paths are relative to `apps/dashboard/src/components/landing/v6/`.

### Hero (`hero.tsx`, `agent-context.tsx`)

| Location                               | Current                                                     | New                                                                  |
| -------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------- |
| `agent-context.tsx` `AGENTS.alex.head` | `replies in twelve <em ...>seconds</em>.`                   | `replies in <em ...>seconds</em>.`                                   |
| `agent-context.tsx` `AGENTS.nova.head` | `catches what you <em ...>miss</em>.`                       | (keep)                                                               |
| `agent-context.tsx` `AGENTS.mira.head` | `ships what you <em ...>can't</em>.`                        | (keep)                                                               |
| `hero.tsx` sub copy                    | `Hire one. Or hire the desk — they share what they learn.`  | `Hire one. Or hire the desk — they share context as they go.`        |
| `hero.tsx` proof line                  | `Setup in minutes · Approval-first · Stays in your control` | `Setup in a day · Agents draft, you publish · Stays in your control` |
| `hero.tsx` primary CTA label           | `See {meta.name} work`                                      | (keep)                                                               |

### Synergy (`synergy.tsx`)

| Location                                                             | Current                                                                                                                                                                                                                                                                                  | New                                                                                                                                                                                        |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Heading                                                              | `They're better <em>together</em>.`                                                                                                                                                                                                                                                      | (keep)                                                                                                                                                                                     |
| Body paragraph                                                       | "Alex sees a lead asking about a product Nova is currently advertising — and tells Nova which audience converted. Nova spots a saturated ad set — and tells Mira which angle to retire. Mira ships a new variant — and Alex knows how to talk about it. **The desk shares one memory.**" | "Built so each agent's signal can flow to the others — what Alex hears in chat, what Nova sees in spend, what Mira learns from creative reviews. **The desk shares context as it grows.**" |
| Flow list (Alex/Nova/Mira → tells … → which audiences/angles/how-to) | (the three `sf-item` rows)                                                                                                                                                                                                                                                               | (keep — they describe the _direction_ of the flow, not a measured feature)                                                                                                                 |

### Alex beat (`beat-alex.tsx`)

| Location             | Current                                                                                                                                                             | New                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| H2 light line        | `Leads die in twelve <em>minutes</em>.`                                                                                                                             | (keep — market framing)                                                                                                                        |
| H2 heavy line        | `Alex replies in twelve <em>seconds</em>.`                                                                                                                          | `Alex replies in <em>seconds</em>.`                                                                                                            |
| Deadpan paragraph    | `Across WhatsApp, Telegram, and your site. Sleeps zero. Qualifies through natural conversation, books to your real calendar, hands off the ones that need a human.` | (keep)                                                                                                                                         |
| Bullet 1             | `12-second median first reply`                                                                                                                                      | `Fast first reply, every time`                                                                                                                 |
| Bullet 2             | `Qualifies through natural conversation`                                                                                                                            | (keep)                                                                                                                                         |
| Bullet 3             | `Books to your real calendar`                                                                                                                                       | (keep)                                                                                                                                         |
| Bullet 4             | `Handoff path you control`                                                                                                                                          | (keep)                                                                                                                                         |
| WhatsApp thread mock | (the entire `THREAD` array of fake messages)                                                                                                                        | (keep — the bezel + "Marisol · whitening enquiry" framing already reads as illustrative; no caption needed because the framing is unambiguous) |

### Nova beat (`beat-nova.tsx`)

| Location                     | Current                                                                                                                                                                                                                                                                                                       | New                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H2 light line                | `Plans the campaign. Watches it run.`                                                                                                                                                                                                                                                                         | `Bad ad sets don't pause themselves.`                                                                                                                                                                                                                                                                                                                                                                                                      |
| H2 heavy line                | `Pauses what's <em>underperforming</em>.`                                                                                                                                                                                                                                                                     | `Nova finds the waste and drafts the fix.`                                                                                                                                                                                                                                                                                                                                                                                                 |
| Deadpan paragraph            | "Nova is your full digital marketing optimizer on shift 24/7. She plans and launches campaigns, builds audiences, picks budgets, watches every ad set, drafts the fix when something slips, and measures lift after you ship. **Never auto-publishes the big stuff.** You review. You publish. Or you don't." | "Nova is your ad operator on shift. She plans campaigns, reads performance, spots budget leaks, prepares changes, and turns the next move into a reviewable draft. **You approve what goes live.**"                                                                                                                                                                                                                                        |
| Bullet 1                     | `**Plans** campaigns from a brief — objectives, audiences, budgets`                                                                                                                                                                                                                                           | `**Plans** campaigns from a brief — objective, audience, budget, structure`                                                                                                                                                                                                                                                                                                                                                                |
| Bullet 2                     | `**Launches** ad sets, creative variants, lookalikes, retargeting`                                                                                                                                                                                                                                            | `**Reads** spend, CPL, CPA, ROAS by ad set`                                                                                                                                                                                                                                                                                                                                                                                                |
| Bullet 3                     | `**Scans** spend, CPL, CPA, ROAS by ad set, every hour`                                                                                                                                                                                                                                                       | `**Finds** budget leaks before they become habits`                                                                                                                                                                                                                                                                                                                                                                                         |
| Bullet 4                     | `**Drafts** pauses, budget reallocations, audience swaps`                                                                                                                                                                                                                                                     | `**Drafts** pauses, reallocations, audience swaps, and launch plans`                                                                                                                                                                                                                                                                                                                                                                       |
| Bullet 5                     | `**Tests** new variants against control with a guardrail`                                                                                                                                                                                                                                                     | `**Compares** what changed against what happened`                                                                                                                                                                                                                                                                                                                                                                                          |
| Bullet 6                     | `**Reports** a Monday recap: what shipped, what it earned`                                                                                                                                                                                                                                                    | `**Reports** the next move in plain English`                                                                                                                                                                                                                                                                                                                                                                                               |
| Dashboard mock — new caption | (none)                                                                                                                                                                                                                                                                                                        | Add a new caption line **immediately below** the dashboard surface (i.e., outside the dashboard `<aside>` / table block, _between_ the closing `</Reveal>` of the dashboard and the start of the body-text grid). Copy: _Illustrative example. Actual numbers vary by account._ Rendered in the existing mono-eyebrow style — `font-mono-v6`, `text-[10.5px]`, uppercase tracked, `text-v6-graphite-3`, centered, max-width unconstrained. |

### Mira beat (`beat-mira.tsx`)

| Location                                               | Current                                                                                                                                              | New                                                                                                                                                                                                                           |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H2 lines 1-2                                           | `Your next ad has been <em>"almost ready"</em> for two weeks.`                                                                                       | (keep)                                                                                                                                                                                                                        |
| H2 heavy line                                          | `Mira ships while you're in a meeting.`                                                                                                              | (keep)                                                                                                                                                                                                                        |
| Deadpan paragraph                                      | "Trend scan, hook generation, scripts, storyboards, video. **Stop at any stage** and take what fits. You stay director — Mira never auto-publishes." | "Hooks, scripts, storyboards, video drafts. **Stop at any stage** and take what fits. You stay director — Mira never auto-publishes." (drops "trend scan" until verified; "never auto-publishes" stays — it is TRUE for Mira) |
| Bullet 1                                               | `Trend scan + <b>hook generation</b>`                                                                                                                | `<b>Hook generation</b> tuned to your brief`                                                                                                                                                                                  |
| Bullet 2                                               | `Scripts, storyboards, video drafts`                                                                                                                 | (keep)                                                                                                                                                                                                                        |
| Bullet 3                                               | `Stop at any stage and take what fits`                                                                                                               | (keep)                                                                                                                                                                                                                        |
| Bullet 4                                               | `You stay director, always`                                                                                                                          | (keep)                                                                                                                                                                                                                        |
| Three creative-pipeline frames (brief / script / clip) | (keep — illustrative mock, framed as such)                                                                                                           | (keep)                                                                                                                                                                                                                        |

### Control accordion (`control.tsx`)

| Location       | Current                                                                                                                                                                                                                | New                                                                                                                                                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Headline       | `Built so you stay <em>in control</em>. Always.`                                                                                                                                                                       | (keep)                                                                                                                                                                                                                    |
| Lede           | "Every agent runs through the same controls. Approval-first by default. You loosen the leash on your own time, not ours."                                                                                              | "Every agent runs through the same controls. Agents draft, you publish. You loosen the leash on your own time, not ours."                                                                                                 |
| Item 01 title  | `Approval-first`                                                                                                                                                                                                       | `Agents draft. You publish.`                                                                                                                                                                                              |
| Item 01 detail | "Every action can start supervised — you see the draft, you click send. Loosen specific actions to autonomous when you trust the pattern. **No agent ever publishes ads, posts creative, or moves money on its own.**" | "Every action can start supervised — you see the draft, you click send. Loosen specific actions to autonomous when you trust the pattern. **The desk is built around reviewable drafts, clear logs, and human control.**" |
| Item 02 title  | `Audited`                                                                                                                                                                                                              | (keep)                                                                                                                                                                                                                    |
| Item 02 detail | "Every reply, every ad-set change, every draft — logged with timestamp, agent, and reasoning. **Exportable. Searchable. Your auditor will love it.**"                                                                  | "Every reply, every ad-set change, every draft — logged with timestamp, agent, and reasoning. **Queryable from your dashboard.**"                                                                                         |
| Item 03 title  | `Where your work lives`                                                                                                                                                                                                | (keep)                                                                                                                                                                                                                    |
| Item 03 detail | "Connects to the tools you already pay for: WhatsApp Business, Meta Ads, Google Calendar, **Cal.com, Notion**. We don't ask you to migrate. Disconnect with one click."                                                | "Connects to the tools you already pay for: **WhatsApp, Telegram, Meta Ads, Google Calendar**. We don't ask you to migrate. Disconnect with one click."                                                                   |
| Item 04 title  | `Hands-off when ready`                                                                                                                                                                                                 | (keep)                                                                                                                                                                                                                    |
| Item 04 detail | "Once a workflow is proven — Alex's first replies, Nova's pause-on-CPL — graduate it to autonomous **in one toggle**. Revoke just as fast. **You decide the leash, per agent, per action.**"                           | "Once a workflow is proven — Alex's first replies, Nova's draft pauses — **graduate it to autonomous as the agent earns trust.** You stay in control of the leash."                                                       |

### Pricing cards (`pricing.tsx`)

This is the largest change. The three cards keep a real commercial anchor — a **pilot price labelled "From $X/month"** — but lose every claim that requires billing/metering infrastructure that does not yet exist (capacity caps, overage rates, bundle discounts, credit accounting, the "$199 14-day pilot" SKU). Bullets and the per-card capacity bullet list are dropped.

#### Card structure

Replace the existing card body (price + per-month, strap, bullet list, primary CTA, optional hint) with:

| Element                                                        | Alex                                                  | Nova                                                  | Mira                                                  |
| -------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------- |
| Card head: mark + name + job tag                               | (unchanged: glyph + name + small mono job label)      | (unchanged)                                           | (unchanged)                                           |
| Price block                                                    | Eyebrow `From` + amount `$249` + per-month `/ month`. | Eyebrow `From` + amount `$249` + per-month `/ month`. | Eyebrow `From` + amount `$399` + per-month `/ month`. |
| Subtitle (replaces strap line)                                 | `Lead response and booking operator.`                 | `Ad planning and optimization operator.`              | `Creative direction and production operator.`         |
| Featured ribbon ("Recommended starting point" under Alex card) | (keep on Alex card)                                   | —                                                     | —                                                     |
| CTA button                                                     | `Start with Alex →`                                   | `Start with Nova →`                                   | `Start with Mira →`                                   |
| CTA target                                                     | `mailto:hello@switchboard.ai?subject=Start with Alex` | `mailto:hello@switchboard.ai?subject=Start with Nova` | `mailto:hello@switchboard.ai?subject=Start with Mira` |
| Bullet list (capacity claims)                                  | (DELETE the four current bullets)                     | (DELETE)                                              | (DELETE)                                              |

The price layout reuses the existing `pcard-amount` / `pcard-num` / `pcard-per` styles with one addition: a small mono eyebrow `From` rendered above (or inline-prefix to) the dollar amount, in the same `font-mono-v6` / `text-[10.5px]` / uppercase / tracked / `text-v6-graphite-3` style used elsewhere on the page. "From" is the load-bearing word — it signals that pilot pricing is directional, not a binding tier.

The featured-card visual treatment (coral border-top accent, white background, "Recommended starting point" eyebrow under Alex) is preserved. The visual rhythm of three cards stays.

The `mailto:` CTA target is intentional: until a pilot-onboarding flow exists in product, the most honest action a click can take is to open an email. Same mailbox as `(public)/privacy/page.tsx` and `(public)/terms/page.tsx`.

#### Pricing footer

Replace the existing pricing-foot block (bundle pills + overage `<details>` + "We recommend Alex" line) with **one line** below the cards:

> **Pilot pricing. Final pricing may vary by channels, spend level, and operator setup.**

Render in the existing mono-eyebrow style (font-mono, ~11px, tracked, `text-v6-graphite-3`), centered, max-width ~36rem.

**Items deleted from this section:**

- The four `pb-pill` bundle pills: "Pick any two save 15%", "Hire all three save 25%", "14-day pilot of the desk $199", "Talk to us about Enterprise".
- The entire `<details class="pricing-overage">` block including the "What happens if I go over?" summary, the soft-cap copy, the four-row overage rate table, and the Mira-credits paragraph ("image = 1 credit · short video = 10 · avatar video = 20 · HD video = 50 …").
- The `pricing-rec` line "Not sure where to start? We recommend Alex →" — already rendered as a hint on the Alex card; second placement is redundant after the simplification.

**Explicitly NOT claimed by the new cards:** automatic billing enforcement, conversation/spend caps, overage rates, Mira credits, bundle discounts, a "$199 14-day pilot of the desk", "locks at GA" or any equivalent commercial commitment about future pricing. The "From $X/month" framing is allowed because (a) "From" signals directional pricing, (b) "Pilot pricing" in the footer makes the non-final nature explicit, and (c) the price discovery and contracting happen via the human-in-the-loop `mailto:` flow until the billing/metering workstream (slice D) ships.

### Closer (`closer.tsx`)

| Location           | Current                                                                               | New                                                                                                                                                                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H2 line 1          | `Hire your first agent.`                                                              | (keep)                                                                                                                                                                                                                                                                                                 |
| H2 line 2          | `<em>Live</em> in a day.`                                                             | (keep)                                                                                                                                                                                                                                                                                                 |
| Sub copy           | `Pick the seat that hurts most. Add another when ready. Approval-first from day one.` | `Pick the seat that hurts most. Add another when ready. Agents draft, you publish — from day one.`                                                                                                                                                                                                     |
| Foot proof line    | `14-day pilot of the desk · $199 · Cancel anytime`                                    | `Pilot access · Cancel anytime` (the new pricing cards already advertise "From $249/$249/$399"; the closer foot does not repeat the number)                                                                                                                                                            |
| Primary CTA label  | `Start with {meta.name}`                                                              | (keep)                                                                                                                                                                                                                                                                                                 |
| Primary CTA target | (current `meta.anchor` — `#alex` / `#nova` / `#mira`)                                 | replace with the same `mailto:` per agent used by the pricing cards, **OR** keep as anchor and let the user click through to the pricing card. **Decision: keep as anchor.** Closer's job is to anchor the visitor back to the agent beat; the request-pricing action lives once, on the pricing card. |

### Footer (`footer.tsx`)

| Location                                                    | Current                                                                                                                          | New                                                                                                                                                                                                                     |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand tagline                                               | `Hire your revenue desk one agent at a time. Alex replies. Nova watches spend. Mira ships creative. They share what they learn.` | `Hire your revenue desk one agent at a time. Alex replies. Nova watches spend. Mira ships creative. They share context as they go.`                                                                                     |
| Status link                                                 | `<span class="pulse"></span>All systems normal`                                                                                  | Drop the live-pulse status pill. Replace with a static link reading `Status` pointing to `#` (placeholder route). The pulsing indicator implies a real status feed that doesn't exist; replace once a status page does. |
| Footer column 3 ("The desk", "Company", "Status") link sets | (keep otherwise)                                                                                                                 | (keep otherwise)                                                                                                                                                                                                        |

### Page metadata (`(public)/page.tsx`)

| Location               | Current                                                                                                                          | New                                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `metadata.title`       | `Switchboard — Hire your revenue desk. One agent at a time.`                                                                     | (keep)                                                                                                                              |
| `metadata.description` | `Hire your revenue desk one agent at a time. Alex replies. Nova watches spend. Mira ships creative. They share what they learn.` | `Hire your revenue desk one agent at a time. Alex replies. Nova watches spend. Mira ships creative. They share context as they go.` |

The same description string lives in `(public)/layout.tsx` `metadata` (title + description + openGraph + twitter). Update all four occurrences in lockstep.

## Things explicitly NOT changing in this spec

- The Nova dashboard mock numbers ($3,184 spend, 87 leads, $36.60 CPL, 2.4× ROAS) — they are illustrative; the new caption marks them as such. No need to scrub the numbers.
- The Alex WhatsApp thread copy ("$99 first session", "Tue 10am, Wed 9am, Thu 11am") — illustrative inside a phone bezel, framing is clear.
- Visual styling, palette, fonts. Slice C.
- Public-route layout / nav / footer behaviour. Slice C.
- Any backend, billing, telemetry, or integration code. Slice D / E / B / out of scope.

## Implementation outline

Single PR, single commit acceptable. Files touched (all under `apps/dashboard/`):

- `src/components/landing/v6/agent-context.tsx` — hero rotating headline (Alex line)
- `src/components/landing/v6/hero.tsx` — sub copy + proof line
- `src/components/landing/v6/synergy.tsx` — body paragraph
- `src/components/landing/v6/beat-alex.tsx` — H2 + bullet 1
- `src/components/landing/v6/beat-nova.tsx` — H2 + deadpan + bullets 2/3/6 + dashboard caption
- `src/components/landing/v6/beat-mira.tsx` — deadpan + bullet 1
- `src/components/landing/v6/control.tsx` — lede + 4 accordion items
- `src/components/landing/v6/pricing.tsx` — restructure card bodies (price block prefixed `From`, drop strap + capacity bullets, change CTA to `mailto:`); replace footer (drop bundle pills + overage `<details>` + Mira credits + "We recommend Alex"; keep one mono caption "Pilot pricing. Final pricing may vary by channels, spend level, and operator setup.")
- `src/components/landing/v6/closer.tsx` — sub copy + foot
- `src/components/landing/v6/footer.tsx` — tagline + drop pulsing status indicator
- `src/app/(public)/page.tsx` — `metadata.description`
- `src/app/(public)/layout.tsx` — `metadata.description` (title + description + openGraph + twitter)

No new files. No deleted files. No dependency or config changes. No CSS or Tailwind changes.

## Verification

- `pnpm typecheck` passes.
- `pnpm test` passes (303 tests, no new tests required for copy-only changes).
- `pnpm build` produces `○ /` as a static prerender.
- Manual scan: `rg -n "twelve seconds|12-second|one memory|14-day pilot|\$199|Cal\.com|Notion|Exportable|Searchable|Pick any two|all three|save 15|save 25|0\.15 / conversation|0\.75% of incremental|\$0\.20 / chat|\$0\.50 / credit|image = 1 credit|short video = 10|avatar video = 20|HD video = 50|in one toggle|per agent, per action|moves money|Never auto-publishes the big stuff|All systems normal|approval-first|Approval-first" apps/dashboard/src/components/landing/v6/ apps/dashboard/src/app/\(public\)/page.tsx apps/dashboard/src/app/\(public\)/layout.tsx` returns no hits. The `approval-first` / `Approval-first` patterns are intentionally checked here because the entire spec softens that language until slice B ships; any leftover instance is a regression to be caught in code review.

## Restoration plan (after slice B)

When B (Nova approval gate) ships, this spec's "agents draft, you publish" softening can be restored to the stronger doctrine language:

- Hero proof: `Setup in a day · Approval-first · Stays in your control`
- Closer sub: `Approval-first from day one.`
- Control item 1 detail final sentence: `No external change goes live without approval.`

That restoration is a copy-only follow-up PR after B is merged, and is **not** part of this spec.

When the billing/metering workstream (D) ships and Stripe/metering is wired, the pricing cards and footer can be restored from the pre-truth-up version, with the actual enforced numbers. Until then: pilot access only.

## Risks

- **Sales handle on inbound.** Every priced CTA opens a `mailto:` until a real onboarding flow exists. Manual sales loop. If volume is meaningful, the follow-up is a short pricing-request form routed somewhere lightweight. For v1, `mailto:` is the smallest honest thing.
- **"From $X/month" is still a number on the page.** Even with the "Pilot pricing" caveat under the cards, a visitor can interpret `From $249/month` as a binding floor. The mitigation is the explicit footer line ("Pilot pricing. Final pricing may vary by channels, spend level, and operator setup.") plus the mailto-driven discovery flow. If sales sees inbound expecting $249 flat, tighten the caveat copy in a follow-up.
- **SEO / OG description drift.** Updating the description across `(public)/page.tsx` and `(public)/layout.tsx` will refresh OG previews. Acceptable.
- **Pricing parity check needed before merge.** Confirm the prices in this spec ($249 / $249 / $399) match anything sales is currently quoting. If sales is quoting different numbers in calls, fix the spec before implementation, not after.

## Out-of-scope follow-ups (do not bundle)

- B — Nova approval gate (doctrine fix; CLAUDE.md "external spend-changing actions require explicit human approval by default").
- C — public-surface visual convergence (palette, inline-hex elimination, font tokens, light/dark for legal pages).
- D — billing & metering MVP (conversation cap, Mira credits, overages, bundles, in-product 70/90/100% warnings).
- E — audit export endpoint.
- F — auth-vs-public visual unification (deferred indefinitely).
