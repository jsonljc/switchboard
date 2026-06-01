# Desktop Layout Audit — 05: Design-System Responsive Maturity

**Scope:** `apps/dashboard` design system only (tokens, breakpoints, type/space scales,
responsive primitives). Layout shell / nav / individual screens are covered by sibling
audits. Read-only assessment.

**Date:** 2026-05-31
**Verdict (one line):** The design system is **mobile/tablet-complete but desktop-absent.**
It has a mature token system, but its responsive logic tops out at the **768px (tablet)**
step and then merely **centers a 640–720px phone-width column** on large screens. There is
no `lg:` (≥1024px) desktop treatment, no canonical desktop max-width, no responsive type
scale, no grid/bento primitive, and no desktop sidebar primitive. This is the literal cause
of "looks like a stretched mobile layout."

---

## 1. Token & Scale Inventory

### Color tokens — FACTS

Confirmed: colors are the **shadcn "raw HSL triplet" convention** — CSS vars hold bare
`H S% L%` components, consumed as `hsl(var(--token))`. Defined in
`apps/dashboard/src/app/globals.css:11-285` (`:root` light + `.dark`), mapped in
`apps/dashboard/tailwind.config.ts:9-100`.

Token families present:

- **Core shadcn:** `--background`, `--foreground`, `--surface(/-raised/-foreground)`,
  `--muted(-foreground)`, `--tertiary-foreground`, `--primary`, `--secondary`, `--accent`,
  `--border(-subtle)`, `--input`, `--ring`, `--card(-foreground)` (`globals.css:13-68`).
- **Semantic:** `--destructive`, `--positive(/-subtle/-foreground)`,
  `--caution(/-subtle)`, `--negative` (`globals.css:39-49`).
- **Action / operator amber:** `--action(/-foreground/-hover)` ("the ONE action color"),
  `--operator(/-subtle)` (migration alias) (`globals.css:51-59`).
- **Agent identity + status:** `--agent-active/-idle/-attention/-locked`,
  `--agent-alex/-riley/-mira` (+ `-deep`/`-tint` raw-triple variants)
  (`globals.css:62-74, 211-216`; tailwind `agent.*` at `tailwind.config.ts:73-81`).
- **`--sw-*` (public website "Stone & Weight"):** `--sw-base/-surface/-border/-text-*/
-accent/-dark-*/-ready` — **hex literals, NOT hsl-triplets** (`globals.css:88-99, 147`).
  These are a separate marketing-site family; not the authed-app convention.
- **`--mercury-*` (editorial register, /reports + agent home):** `--mercury-ink(-2/3/4)`,
  `--mercury-accent(-soft)`, `--mercury-hairline(-soft)`, `--mercury-pos/-neg`, etc. —
  stored as **complete `hsl(...)` values, consumed bare** (`globals.css:101-123`).
- **Editorial register (`--cream`, `--ink`, `--ink-2/3/4`, `--hairline`, `--hair(-soft)`,
  `--editorial-accent`):** also complete-value, consumed bare (`globals.css:174-199`).
- **`--char-*` character system:** per-role body/aura colors (`globals.css:149-168`).
- **`v6.*` landing palette:** literal `hsl(...)` in tailwind config (`tailwind.config.ts:83-99`).

> **Token-convention hazard (already a known gotcha):** THREE consumption conventions
> coexist — (a) raw triples → `hsl(var(--x))`; (b) complete `hsl(...)`/hex values →
> consumed bare as `var(--x)`. A desktop overhaul that introduces new tokens must declare
> which convention each follows or it will render transparent/invalid (see memory note
> `feedback_design_token_collision_hsl_triplet`).

### Radius — FACT

`--radius` 0.5rem, `--radius-sm` .375, `--radius-md` .5, `--radius-lg` .75, `--radius-xl` 1rem
(`globals.css:77-81`; tailwind `tailwind.config.ts:101-107`). Editorial CSS often hardcodes
literal px radii (e.g. `border-radius: 6px`) instead of tokens.

### Typography — FACTS

- Font stacks via CSS vars wired with `next/font`: `--font-sans` (Inter), `--font-display`
  (Instrument Sans), `--font-serif` (Source Serif 4), `--font-mono`/`--mono-editorial`
  (JetBrains Mono), plus home stacks `--font-home-sans` (Hanken Grotesk), `--font-home-serif`
  (Newsreader) (`globals.css:84-85, 183-224`; tailwind `fontFamily` at `tailwind.config.ts:108-112`).
- **No custom `fontSize` scale in tailwind** (config does NOT extend `fontSize` — verified).
  Type sizing is either Tailwind default `text-*` utilities or **literal px in CSS modules**.

### Spacing — FACTS

- **No custom `spacing` scale in tailwind** (config does NOT extend `spacing` — verified).
- Editorial spacing tokens exist but are coarse and partly desktop-blind:
  `--space-page-y` 2.5rem, `--space-page-x` 1.5rem, `--space-section` 3rem, `--space-block`
  1.5rem, `--content-width` 42rem (`globals.css:126-130`); section-gap tokens
  `--gap-section` 144 / `-tablet` 104 / `-mobile` 72 px (`globals.css:202-204`). Note there
  is a tablet step but **no separate desktop gap** — `--gap-section` doubles as the ≥1280
  value.

### Shadows / motion — FACTS

Shadow tokens `--shadow-card/-lift/-sheet` (complete values, bare) (`globals.css:218-220`).
Motion tokens `--ease-standard/-enter/-exit/-home`, `--duration-fast/default/slow/very-slow`
(`globals.css:132-144, 221`; tailwind `tailwind.config.ts:113-123`). These are well-formed.

### Tailwind config — FACT

`tailwind.config.ts` extends only `colors`, `borderRadius`, `fontFamily`,
`transitionTiming/Duration`, `keyframes`, `animation`. It **does NOT extend `screens`,
`spacing`, `fontSize`, or `maxWidth`** (verified by grep). One plugin: `tailwindcss-animate`.
`postcss.config.mjs` = tailwind + autoprefixer only. **No container-query plugin.**

---

## 2. Breakpoint Usage Census (with counts) — FACTS

### Breakpoint definitions

- **Tailwind:** defaults in force (no `screens` override): `sm=640 md=768 lg=1024 xl=1280
2xl=1536`.
- **Hand-rolled CSS** (`globals.css` + 21 `*.css`/`*.module.css` files) uses a DIFFERENT,
  app-invented set. `min-width` media-query frequencies across `src`:

  | min-width     |    count | role                                                      |
  | ------------- | -------: | --------------------------------------------------------- |
  | **768px**     |   **39** | the dominant "tablet" step — the de-facto only breakpoint |
  | **1280px**    |   **18** | editorial "large" step (globals editorial layer)          |
  | 1440px        |        4 | only the dashboard-frame/grid + a couple modules          |
  | 1024px        |        1 | essentially unused                                        |
  | 560/720/920/… | 1–3 each | one-off module tweaks                                     |

  `max-width` queries are similarly ad-hoc (860/720/900/640/620/480/559/540/520/440/1280 px).

  > **Mismatch:** Tailwind `lg:` = **1024px** but the CSS "desktop" steps live at **1280**
  > and **1440**. A class written `lg:` and a CSS rule written `@media(min-width:1280px)`
  > do NOT switch at the same width. There is no single source of truth for "desktop starts here."

### Tailwind responsive-prefix census (whole `src`, `.tsx`+`.ts`) — FACTS

`rg -o '\b(sm|md|lg|xl|2xl):' src` →

| prefix    |  count |
| --------- | -----: |
| `md:`     |     29 |
| `sm:`     |     26 |
| `lg:`     |     10 |
| `xl:`     |      3 |
| `2xl:`    |  **0** |
| **total** | **68** |

### Share of responsive treatment — FACTS

- Total `className=` occurrences in `.tsx`: **2,524**.
- Total responsive-prefixed class **tokens** (full `prefix:value`): **62**.
- ⇒ **≈ 2.4 %** of classNames carry any responsive prefix; **`lg:`+`xl:`+`2xl:` = 13 tokens
  total**, i.e. **~0.5 %** of styling is desktop-specific via Tailwind.
- Files containing any `lg:`/`xl:`/`2xl:`: **6 of 429 `.tsx` files** —
  `src/app/(public)/loading.tsx`, `settings/team/page.tsx`, `settings/identity/page.tsx`,
  `components/settings/connections-list.tsx`, `components/ui/button.tsx`,
  `components/character/agent-mark.tsx`. **None are core product screens.**

### Where the (sparse) responsive treatment lives — FACTS

Authed-app responsive prefixes (excluding marketing/landing): `md:24 sm:23 lg:9 xl:3`. They
cluster in **Settings** (`settings/identity` ×6, `settings/team` ×4, `settings/team/[agentId]`
×4, `connections-list` ×5) and **UI primitives** (`ui/toast` ×6, `ui/sheet` ×6, `ui/dialog`
×5, `ui/button` ×2). The **core screens carry essentially zero**:
`rg -o '(sm|md|lg|xl|2xl):' src/components/home src/components/inbox src/components/results
src/app/(auth)/results src/app/(auth)/alex/riley/mira` → **no matches.** Home/Inbox/Results
do all responsiveness through CSS modules, and those modules stop at 768px.

> **Interpretation:** A `lg:`/`xl:`/`2xl:` count this low (13 tokens, 0 on core screens,
> 0 `2xl:` anywhere) is the quantitative confirmation that **no desktop treatment exists**.

---

## 3. Typography / Spacing Responsiveness — FACTS

- **Responsive type via Tailwind is near-zero.** In the authed app the only responsive
  text-size prefixes are `md:text-6xl` (×2) and `sm:text-left` (×2). The type scale is
  effectively **fixed**, set as **literal px in CSS modules** (e.g. `home.module.css`,
  `inbox.css`, `results.module.css`).
- **Editorial hero type DOES step** — but via hardcoded px in `globals.css`, at 768 and 1280
  only: `.greeting-prose` 32→48→60px (`globals.css:702-765`); `.hero-num` 54→88→**140px**
  (`globals.css:874-919`); `.stat-num` 28→36→46px (`globals.css:958-991`). These are bespoke
  to the editorial home, not a reusable scale.
- **`clamp()` (fluid type) = 15 occurrences total**, but **9 are in `components/landing/v6/`
  (marketing)**; only **6 in the authed app** (`activity.module.css` ×1, `reports.module.css`
  ×4, `contacts/pipeline.module.css` ×1). The product UI is **not fluid-typographic**.
- **Container queries: NONE.** No `@container` / `container-type` in any source CSS (the two
  `container` hits are JS test-helper variables, not CSS). No container-query Tailwind plugin
  installed.
- **Max content-width: NO single canonical token/convention.** The codebase has at least
  **eight competing width ceilings**:
  - tokens: `--content-width` **42rem** (`globals.css:130`), `--col` **640px** /
    `--col-wide` **1080px** (`globals.css:200-201`);
  - component classes: `.content-width` 42rem, `.page-width` **74rem**, `.dashboard-frame`
    **76rem→88rem@1440** (`globals.css:316-352`), `.page`/`.page-wide` = 1080px
    (`globals.css:619-637`), `.measure-prose` 640px (`globals.css:638-643`);
  - reports/results `--max-w` **74rem** (`reports.module.css:34`);
  - arbitrary Tailwind values scattered in TSX: `max-w-[80rem]` ×16, `max-w-[78rem]` ×4,
    `max-w-[64rem]` ×2, `max-w-[60rem]`, `max-w-[36rem]` ×3, plus `max-w-{sm,md,lg,xl,2xl}`.

  > The widest the **content** ever goes is `--col-wide` **1080px** (editorial `.page-wide`)
  > or `74–88rem` (mercury frames). But **core CUX screens don't use any of those** — see §4.

---

## 4. Desktop-Readiness Assessment

**Rating: 2 / 5 — "tokens ready, layout not."** Strong color/motion token foundation; the
**responsive layer is the gap**, and it's a load-bearing one.

### The smoking gun (FACTS) — core screens are phone columns, centered

The P1-A / CUX screens lift their layout from phone-frame prototypes and cap at a phone
width, then merely center on desktop:

- **Home** — `home.module.css:19-27`: `.column { max-width: 640px; margin: 0 auto }` at the
  768px step and **never widens again.** On a 1440px monitor, Home is a 640px column in a sea
  of cream.
- **Results** — `results.module.css:1258-1266`: identical `.column { max-width: 640px }`.
- **Inbox** — `inbox-design-base.css:166-172`: `.inbox-page { max-width: 720px; margin-inline:
auto }`, with the candid comment _"the design's phone-frame shell that constrained width
  isn't present in the real app."_

### Shell offers no help (FACTS)

- `AppShell` → `EditorialAuthShellInner` renders a sticky `.app-header` (`globals.css:481-507`,
  header-row max **1280px**) + a **bare `<main>{children}</main>` with no width/grid of its
  own** (`editorial-auth-shell.tsx:46`). Width is delegated to each page — and the pages cap
  at 640/720.
- **No `lg:`/`xl:` anywhere in `components/layout/`** (verified) — the shell has zero desktop
  treatment.
- **Nav is not a desktop sidebar.** `.primary-nav` is a fixed bottom bar on mobile that, at
  768px, becomes an **inline horizontal strip** (`globals.css:1175-1246`). There is no
  left-rail / persistent-sidebar primitive; desktop just gets a horizontal nav.

### A desktop grid primitive EXISTS but is orphaned (FACT/OPPORTUNITY)

`globals.css:332-393` defines `.dashboard-frame` (76→88rem), `.dashboard-content-grid`
(`grid-template-columns: 1fr 320px` at **1440px**), `.dashboard-main`, `.dashboard-rail`
(sticky), `.dashboard-activity-inline`. This is a real two-column desktop layout — **but grep
finds no `.tsx` consuming any of these classes** on the current Home/Inbox/Results. It's dead
scaffolding from an earlier dashboard, and it switches at **1440px**, not 1024.

### Net diagnosis

"Stretched mobile" is generous — it doesn't stretch, it **pillarboxes a phone column**. The
breakpoint where the app should "become desktop" (≈1024px `lg:`) currently does **nothing**;
the only thing that happens past 768px is hero font-size bumps at 1280px and a centered
narrow column.

---

## 5. Missing Primitives (build these first) — OPPORTUNITIES / RECOMMENDATIONS

Prescriptive, ordered by leverage. All are additive (won't regress mobile if gated `≥lg`).

1. **One canonical desktop breakpoint + reconcile the two systems.**
   Decide the desktop switch (recommend **`lg` = 1024px** to use Tailwind's default and the
   real laptop floor; the editorial 1280/1440 steps become "wide" refinements). Either set
   `theme.screens` in `tailwind.config.ts:7` so prefixes match the CSS, or add named CSS
   custom-media — today `lg:` (1024) and `@media(min-width:1280px)` disagree.

2. **A canonical content-width scale (token set), replacing the 8 competing ceilings.**
   Define e.g. `--measure: 42rem` (prose), `--content: 72rem` (standard page), `--content-wide:
88rem` (dashboards/results). Collapse `--content-width` / `--col` / `--col-wide` /
   `.page-width` / `.dashboard-frame` / `--max-w` and the `max-w-[80rem]/[78rem]/[64rem]` ad-hoc
   values onto it. **First consumers:** `home.module.css:21`, `results.module.css:1260`,
   `inbox-design-base.css:169` — widen these from 640/720 at `≥lg`.

3. **A reusable responsive page/grid (bento) primitive.** Promote/replace the orphaned
   `.dashboard-content-grid` (`globals.css:354-393`) into a real, consumed primitive
   (`main · 1fr` + optional sticky rail) that engages at `lg`, not 1440px, and wire Home /
   Inbox / Results into it. Today every screen is a single column; desktop needs
   multi-column composition (e.g. Home modules as a 2–3-col bento, Inbox as list+detail,
   Results as a wider table/cards grid).

4. **A desktop sidebar layout primitive.** `.primary-nav` only flips bottom-bar→horizontal at
   768px (`globals.css:1175-1246`). For a real desktop app add a persistent left-rail variant
   at `lg` (and have the shell switch `<main>` to the sidebar grid). The shell's bare `<main>`
   (`editorial-auth-shell.tsx:46`) is the single insertion point.

5. **A responsive type scale (token-driven, ideally fluid).** Replace the per-component
   literal-px bumps (`.greeting-prose`, `.hero-num`, `.stat-num`, etc.) and the missing
   Tailwind `fontSize` extension with a shared scale — either `clamp()` tokens (the app
   already uses clamp in reports/activity, so the pattern is proven) or `text-*` +
   `lg:text-*` conventions. Right now responsive type is ~4 Tailwind prefixes total.

6. **(Optional, high-payoff) Container queries.** Zero today; no plugin. For card/module
   primitives that must reflow inside both a narrow rail and a wide bento cell,
   `@container` (add `@tailwindcss/container-queries`) avoids breakpoint-coupling. Lower
   priority than 1–4 but worth seeding when the grid primitive lands.

7. **Add desktop steps to the spacing/gap tokens.** `--gap-section` (`globals.css:202`) has
   mobile+tablet values but reuses one number for ≥1280; `--space-page-x/y` are single
   values. Add `lg` values so density (gutters, section rhythm) increases on desktop instead
   of staying tablet-sized.

---

## Appendix — exact census commands (reproducible)

```
rg -o '\b(sm|md|lg|xl|2xl):' apps/dashboard/src -g '*.tsx' -g '*.ts' --no-filename | sort | uniq -c
rg -o 'className=' apps/dashboard/src -g '*.tsx' --no-filename | wc -l            # 2524
rg -o '\b(sm|md|lg|xl|2xl):[A-Za-z0-9_\[\]./-]+' apps/dashboard/src --no-filename | wc -l  # 62
rg -l '\b(lg|xl|2xl):' apps/dashboard/src -g '*.tsx' -g '*.ts'                    # 6 files
rg -o 'min-width:\s*[0-9]+px' apps/dashboard/src --no-filename | sort | uniq -c   # 768:39, 1280:18 …
rg -o 'clamp\(' apps/dashboard/src --no-filename | wc -l                          # 15 (9 landing / 6 app)
rg '@container|container-type' apps/dashboard/src                                  # none (CSS)
```
