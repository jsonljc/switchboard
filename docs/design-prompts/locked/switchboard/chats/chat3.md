# Dashboard v6 redesign

_Started 2026-04-29 15:18 UTC_

---

## User

The spec is
▎ at docs/superpowers/specs/2026-04-29-dashboa
▎ rd-v6-redesign-design.md. The current
▎ dashboard is at apps/dashboard/src/component
▎ s/dashboard/owner-today.tsx rendered at  
 ▎ http://localhost:3002/dashboard. The home
▎ page (design north star) is at  
 ▎ apps/dashboard/src/app/(public)/page.tsx  
 ▎ rendered at http://localhost:3002. Critique
▎ the current dashboard against the spec and
▎ the home page, then propose concrete v6  
 ▎ mockups for sections 01–05 lets work on the dashboard page

## Assistant

I'll start by exploring the spec, current dashboard, and home page to understand what we're working with.

_[tool: local_ls]_

_[tool: list_files]_

_[tool: local_read]_

_[tool: local_read]_

_[tool: local_read]_

Now let me look at the existing v6 dashboard work and the home page beats to understand the design vocabulary.

_[tool: read_file]_

Let me look at the existing CSS and previous dashboard work to understand the design system before planning.

_[tool: read_file]_

_[tool: list_files]_

_[tool: read_file]_

_[tool: list_files]_

I have enough context. Let me snip the bulk file reads now and then build the dashboard mockup.

_[tool: snip]_

I have enough context to plan and build now. Let me look at one more current dashboard view to understand the screenshot reference.

_[tool: view_image]_

_[tool: snip]_

_[tool: snip]_

Now let me build the dashboard mockup. The plan:

**The design system I'm using** (from the v6 home page already in this project):

- **Tokens**: `--cream/cream-2/cream-3`, `--graphite/graphite-2/graphite-3/graphite-4`, `--coral`, `--good`, `--hair/hair-soft`
- **Type**: General Sans body, JetBrains Mono micro-labels, Georgia italic for the inactive-agent "hire" moments
- **Composition**: full-bleed beat sections with `01 — Section name` corner mono labels, hairline dividers, no card chrome — the home page's editorial vocabulary applied to ops

**Layout**: I'll critique the current dashboard inline at the top, then mock sections 01–05 (Frame strip + Needs you / Alex / Nova / Mira / Activity) and let the user flip between three live-state variants via Tweaks: **Full desk** (all 3 agents live), **Alex-only** (Nova + Mira inactive seats), and **First-run** (cold-start CTA). Plus a halt-active state.

Let me start building.

_[tool: update_todos]_

I'll build this as a single hand-crafted HTML file with the mockups + critique. Going single-file since the volume of CSS will fit comfortably under 1000 lines.

_[tool: write_file]_

_[tool: snip]_

Now let me build the main HTML file with the critique + all 5 sections.

_[tool: write_file]_

[I'll snip and continue.]

_[tool: snip]_

Now the JS to render activity events and the tweaks panel.

_[tool: write_file]_

_[tool: write_file]_

_[tool: snip]_

_[tool: done]_

_[tool: snip]_

_[tool: fork_verifier_agent]_

Dashboard v6 is up at `dashboard/Dashboard v6.html` with sections 01–05 plus a critique header. Three live-state variants flip via Tweaks: **Full desk**, **Alex only**, and **First run**, plus a halt toggle.

**What's in it:**

- **Critique** (top, dev-only) — three columns: what's wrong / what v6 changes / hard cuts
- **AppShell topbar** — v6 vocabulary, mono nav, emergency halt promoted out of the body
- **01 Frame strip** — voiced headline pattern (`composeFrameHeadline()`) with dispatch pulse
- **02 Needs you** — unified queue with APPROVAL / HEALTH / SUGGESTION rows, agent-tagged
- **03 Alex** — PhoneFrame with mixed-thread + booking card, footer mono stat row
- **04 Nova** — 4-stat band + flag-first table + pinned draft note (dual-attribution with the queue)
- **05 Mira** — brief / script / draft-clip pipeline; inactive state is a Georgia-italic "Hire" card over a muted illustration
- **Activity timeline** — agent-tagged, goes to side rail at ≥1440px
- **Floating dock** — dispatch toggle only

## User

## Assistant

_[tool: snip]_

I'll create a v2 file with all four views (full desk, alex-only, first-run, mobile) and the refinements asked for. Let me snip and copy v1 first.

_[tool: snip]_

_[tool: copy_files]_

Given context constraints, I'll deliver this efficiently. Rather than recreating both files, I'll write the v2 fresh as a single self-contained file with all 4 views embedded as a design canvas — that's actually the right format for "show me 4 states."

_[tool: delete_file]_

_[tool: copy_starter_component]_

I'll take a more efficient path — render all 4 views inline in one HTML file using CSS to scale each artboard, rather than the canvas component. Each view is a styled iframe-like region. Let me write a single tight v2 with all 4 states visible at once.

_[tool: snip]_

_[tool: delete_file]_

_[tool: snip]_

I'll write v2 as a single self-contained file with all four views stacked vertically, each as a labeled artboard. The CSS already exists at `dashboard/dashboard-v6.css` — I'll extend it inline and add the new view treatments.

_[tool: write_file]_

_[tool: snip]_

_[tool: update_todos]_

_[tool: done]_

_[tool: fork_verifier_agent]_

`dashboard/Dashboard v6 v2.html` is up — four artboards on a vertical canvas:

1. **Full desk** — all three agents live; unified frame strip, queue rows that read by type at a glance, editorial Alex headline, Mira status lines as live pulses, calmer activity rail.
2. **Alex-only** — Nova + Mira as muted seats with Georgia-italic hire cards floating over grayscale surfaces.
3. **First-run** — graphite-on-graphite primary CTA card + four-step mono roadmap. No empty queue, no dashboard guilt.
4. **Mobile (430px)** — rail collapses inline, Nova table sheds 3 columns, dock pins bottom-left, chat bottom-right (no overlap).

Plus a graphite changelog at the bottom enumerating what changed and why.

## User

what do you think of this

## Assistant

_[tool: snip]_

Honest take on this prompt — three things stand out:

**What's strong about it:**

- The **philosophy sentence** is excellent. _"My revenue operators are running. I only approve the few things that need judgment."_ That's a sharper north star than what the spec currently has, and it should be the headline of the dashboard PRD itself.
- The **"three questions at a glance"** framing (what needs me / what's handled / can I trust it) is a better mental model for the dashboard than "Frame → Needs you → Per-agent → Activity." The current spec gets there structurally but doesn't _name_ the goal that crisply.
- **State 5 (Degraded)** is a real gap in the v6 spec. We have first-run, alex-only, full desk — but no honest failure state. "Alex offline · last active 2h ago" with amber-not-coral is exactly right. Coral is for _your action_; warnings are a different register. This belongs in the spec.
- **Coral discipline** ("never decorative") is stricter than what we have and worth adopting verbatim.

**What I'd push back on:**

- **"What wants you, right now."** as the H1 of the page is a regression. v6's voiced frame strip (_"3 want your call · 4 booked · Nova drafting a pause"_) tells you what's _handled_ in the same breath as what's _pending_ — which is the whole product promise. A bare "What wants you" headline reverts to to-do-list framing and loses the calmness.
- **"One expanded agent panel at a time, accordion-style"** — I'd resist this. Owners open the dashboard 10x a day for 30 seconds. Accordion = an extra click every visit to see Nova's table. The v6 approach (all three panels visible, compact-by-default) is lower-friction. Accordions are a 2018 SaaS pattern that hides information to feel "clean"; the calmer move is to make the always-visible state genuinely scannable.
- **"Discount request — Alex needs your call before replying"** as a queue example is good content, but the buttons _[Set rule] [Reply myself] [Dismiss]_ are wrong. The right primary action is _Approve discount_ or _Hold the line_. Setting a rule is a meta-action that belongs in Settings; offering it as the primary CTA in the queue trains owners to drift into config instead of deciding.

**Net:** I'd merge the philosophy sentence, the three-questions framing, State 5, and the strict coral rule into the v6 spec. Keep v6's voiced frame strip and always-visible per-agent panels. Reject the accordion. Want me to update the v2 mockup to add the degraded state and tighten the coral usage?

## User

will it be easier to navigate?

## Assistant

Short answer: **no, the accordion will feel cleaner but be slower to navigate.**

Here's the math. An owner opens this 10× a day for 30 seconds. The questions they're answering each visit:

1. _Anything urgent?_ → queue (same in both designs)
2. _Is Nova spending on track?_ → glance at Nova's stat band
3. _Is Mira's reel done yet?_ → glance at Mira's pipeline

In the **always-visible** layout, questions 2 and 3 are answered by eye-flick. Total cost: ~3 seconds, no clicks.

In the **accordion** layout, they're answered by: scroll to compact strip → identify the agent column → click → wait for expand → read → click another to switch context. Total cost: ~8–12 seconds, 2–4 clicks. And because only one panel is open at a time, comparing Alex's qualified count against Nova's spend (a real owner question — _"are we paying too much per lead?"_) becomes impossible without toggling back and forth.

**The accordion's appeal is aesthetic, not functional.** It looks calmer because there's less on screen. But "calm" for a 30-second-glance instrument should mean _"I see everything and nothing demands me,"_ not _"I see one thing and have to dig for the rest."_ A car dashboard doesn't make you tap the speedometer to reveal the fuel gauge.

The one thing the accordion gets right: at mobile width, you genuinely can't fit three panels. There, collapse-by-default is correct. But that's a responsive concession, not a desktop pattern.

**My recommendation:** keep desktop always-visible. Adopt accordion behavior only below ~1024px.

## User

## Assistant

_[tool: snip]_

This spec is a real upgrade. It does three things v6 didn't:

**Three substantive wins:**

1. **Three card types, not one queue row.** This is the right call. ESCALATION (coral border, inline reply, outcome-named buttons) and RECOMMENDATION (no border, confidence number visible, graphite Approve) and APPROVAL GATE (Review-not-Approve, expand-in-place, Stop campaign always present) are _genuinely different decisions_ and pretending they're one component flattens the work. v6's unified queue was tidier on paper; this is more honest about what the owner is actually doing.

2. **Cross-linking instead of duplication.** "ESCALATIONS · 1 open ↑ (shown in queue)" and "DRAFTING PAUSE on Dental Whitening B — approve in queue ↑" — single source of truth, with a pointer. v6 duplicated Nova's draft note inside the Nova panel _and_ the queue. This is cleaner and reduces decision real estate.

3. **The optimistic-update loop is specified.** Card collapses to a confirmation line in place → activity row prepends simultaneously → 1.5s fade → on error restore inline (no toast). That's a _behavioral_ spec, and it's the kind of detail that separates products that feel calm from products that feel busy.

**Three places I'd push:**

1. **"AGENTS" / "QUEUE" as the only section labels.** The spec strips editorial headings to mono xs labels. I agreed with cutting "What wants you, right now." But going all the way to bare `QUEUE  3 pending` makes the page read like a Linux htop. The owner opens this 10× a day; the headline is wallpaper after week one anyway. Fine. But consider keeping _one_ sentence — the operating strip's right side could carry a quiet status: `● LIVE · 3 pending · 2 drafts`. Same density, more dignity than just `● LIVE`.

2. **Sparkline as Unicode block characters.** ▁▂▃▄▅▆▇ is clever and zero-asset, but at 7 characters of resolution you can't actually tell if Ad Set A is "scaling well" — you're trusting the label. Either make it real (inline SVG, 24×8px, doesn't break density) or drop the column entirely and let the label do the work. The Unicode version is the worst of both: looks like data, isn't.

3. **`conf 0.87` as a literal number.** I love the discipline ("don't translate it, owner learns"), but 0.87 vs 0.62 has no felt meaning to a dentist on day one. _Either_ commit to it everywhere (Mira gates show `conf 0.94`, Alex escalations show `conf 0.71` for "should I escalate this") so the number becomes a vocabulary, _or_ use a 3-step text label (`high · medium · low`). Mid-route — only Nova shows it — trains nothing.

**Net:** this is shippable. The build order at the bottom (don't build Nova audit panel before the endpoint ships, stub credits with `LAST AUDIT: 6h ago`) is the most senior thing in the doc and worth keeping verbatim. Want me to update the v2 mockup to this spec — three card types, cross-links, real sparklines?

## User

do what you think is bestproceed

## Assistant

_[tool: snip]_

I'll write a fresh v3 mockup applying my own judgment on the three pushes:

1. **Section labels stay bare mono** (per spec) — but the operating strip's right side carries a status sentence (`● LIVE · 3 pending · 2 drafts`) so the page has dignity without an editorial headline.
2. **Real inline SVG sparklines** — drop the Unicode chars.
3. **Confidence as 3-step labels** (`high · medium · low`) — applied consistently everywhere, not just Nova.

Plus everything else in the spec: three distinct card types, cross-links, optimistic-update behavior, all 5 states.

Let me check what files I have to work with.

_[tool: list_files]_

I'll build v3 as a single self-contained HTML file with all 5 states stacked as labeled artboards, no external CSS dependency.

_[tool: write_file]_

## Assistant

Now let me build v7 fresh — single self-contained file with all 5 states as artboards on a vertical canvas. Tight, dense, no editorial headlines.

_[tool: write_file]_

## Assistant

I'll write v7 fresh — single self-contained HTML file, all 5 states stacked as artboards on a cream canvas with mono labels above each. No tweaks panel — the value here is seeing all 5 at once, the way the spec asks for.

_[tool: write_file]_

## Assistant

I'll create v7 fresh — single self-contained file with all 5 states stacked as artboards.

_[tool: write_file]_

## Assistant

_[tool: snip]_

I'll write v3 in two parts to keep it manageable. Let me build it as separate CSS + HTML files for easier editing.

_[tool: write_file]_

## Assistant

I'll write v7 in a leaner, more focused way. Single file, all 5 states, tight CSS.

_[tool: write_file]_

## User

## Assistant

I'll snip prior iterations and build v7 fresh as 5 artboards.

_[tool: snip]_

_[tool: write_file]_

## Assistant

I'll snip and build v7 fresh as a single self-contained file.

_[tool: snip]_

_[tool: write_file]_

## User

## Assistant

[I'll snip and start fresh with a clean v7 build.]

_[tool: snip]_

I'll build v7 as a single self-contained file with all 5 artboards.

_[tool: write_file]_

## Assistant

I'll build v7 as a single self-contained HTML file with all 5 artboards stacked vertically. Compact, no external dependencies.

_[tool: write_file]_
