# Wave 1 — Token Unification & Foundational Layer — Design Spec

**Date:** 2026-06-02
**Status:** Draft for review
**Source:** `docs/audits/2026-06-02-ui-ux-feel-audit/direction.md` §6 (the foundational layer), §7 (Wave 1), Gap #4 + #9.
**Scope:** `apps/dashboard` only. Skin-agnostic foundational design-system work.

---

## 0. Scope & non-goals

**In scope (Wave 1):** collapse the four token systems onto one primitive→semantic source with enforced governance; structural type / elevation / spacing foundations; the `<QueryStates>` perceived-performance primitive + route shells; a voice spec + in-app banned-claims guard.

**Explicitly OUT of scope:**

- The Apple "Liquid Glass" aesthetic re-skin (paused separately).
- Authoring `.dark` palette **values** and re-enabling the theme toggle (Wave 3). This wave only makes dark **design-bounded** — single-source — it does **not** implement dark.
- Cockpit `var(--serif)` / italic agent-identity type (deferred to the aesthetic re-skin; honors the "no italics" preference).
- Marketing / brand-system tokens (`--v6-*`, `--sw-*`) and public surfaces — no brand-system migration.
- Restructuring Mercury (`/reports /activity /contacts`) — light-touch only (§4.7).
- Any change to Wave-0 functional behavior (#814–#827).

---

## 1. Problem (verified 2026-06-02)

Four token systems disagree on the brand's own colors; each agent hue is defined 3–4× with conflicting values; any color / contrast / dark / rebrand fix must be made 3+ times or it regresses (audit Gap #4 — the keystone).

| System | Where | Form | Examples |
|---|---|---|---|
| 1. globals `:root`/`.dark` | `app/globals.css` (178 tokens, ~40 dark) | HSL triplets + wrapped `hsl()` | `--action 30 55% 46%`, `--agent-alex 14 70% 58%`, `--ink hsl(20 10% 12%)` |
| 2. cockpit `T` | `components/cockpit/tokens.ts` (17) | **literal hex/rgba, zero `var()`** | `T.amber #B8782E`, `T.ink #0E0C0A` |
| 3. inbox scoped | `inbox-design-base.css` (26, under `.inbox-page/.sheet`) | **literal hex** | `--coral #e07856`, `--amber #c97b1a` |
| 4. Mercury | globals `--mercury-*` (14) + per-surface module aliases | `hsl()` | `--mercury-accent hsl(20 90% 55%)` |

**Agent-hue conflicts (verified):** Alex `14 70% 58%` / `#E07A53` / inbox `#e07856` / mktg `14 75% 55%`; Riley `180 33% 40%` / `#3F8C86` / `#2e8a87`; Mira `270 45% 58%` / inbox `#7e6bb2` / hand-rolled `#4A3A66` (`inbox-agent-avatar.tsx:26`). `mira-config.ts:13` **already** consumes `hsl(var(--agent-mira))` — the migration template.

**Amber triplication:** `--action` / `--operator` / `--char-accent` (`30 55% 46%`) + `T.amber #B8782E` + inbox `--amber #c97b1a` — three visually-distinct ambers all meaning "the one action color."

---

## 2. Architecture — primitive → semantic → (earned) component

Chosen depth: **primitive + semantic**, with component tokens **only where earned** (action button, card, agent-identity). Not an exhaustive component tier (YAGNI).

**The indirection principle (the low-blast-radius core):** add a primitive tier *beneath* the existing semantic names; keep every semantic name and every consumer untouched. CSS `var()` resolves the chain.

```css
/* Tier 1 — primitive: the ONLY place a literal value lives */
--palette-action: 30 58% 41%;          /* AA action amber */
--palette-action-bright: 30 55% 46%;   /* fills/stripes ONLY — see §4.5 */
--palette-coral: 14 70% 58%;  --palette-teal: 180 33% 40%;  --palette-violet: 270 45% 58%;
/* + deep/tint variants, the neutral ramp, status, surfaces */

/* Tier 2 — semantic: roles reference primitives via var() */
--action:   var(--palette-action);
--operator: var(--action);             /* alias — consumers unchanged */
--agent-alex: var(--palette-coral);

/* Tier 3 — component: only where earned; alias semantic */
/* cockpit T + the inbox scoped block become thin component maps → hsl(var(--semantic)) */
```

`hsl(var(--action))` → `hsl(var(--palette-action))` → `hsl(30 58% 41%)`. **No `home.module.css` / Home / Inbox consumer edits.** The semantic layer largely *already exists* (shadcn names) — the work is *formalize + dedupe + repoint the other three systems*, not rename-everything.

---

## 3. Token governance (normative)

This is the contract the drift guard and code review enforce.

### 3.1 Tiers & ownership
- **Tier 1 — Primitives (`--palette-*`):** raw, theme-agnostic values (HSL triplets for color). The single physical definition of every reusable value. **Defined / edited ONLY in `globals.css`.** Introduced only for a value used by ≥2 semantic tokens or ≥2 surfaces.
- **Tier 2 — Semantic (`--action`, `--agent-*`, `--text-*`, `--surface*`, `--positive`…):** role tokens. **Reference a primitive via `var()`.** A genuine one-off may hold a literal **only in `globals.css`, only when it is not reusable across surfaces, and only with a comment explaining why it is not promoted to `--palette-*`** — this closes the "temporary-permanent one-off" loophole. Consumed everywhere as `hsl(var(--x))` / `var(--x)`.
- **Tier 3 — Component tokens:** introduced ONLY where a component needs a named slot (action button, card, agent-identity avatar). Must alias a semantic token. No component tokens "for symmetry."

### 3.2 Where literal colors are allowed
- Literal color values (hex, `rgb()`, raw HSL triplet) are allowed **only** in (a) the Tier-1 primitive block in `globals.css`, and (b) explicitly out-of-scope zones: marketing `--v6-*` / `--sw-*`, and agent **sprite pixel data** (`cockpit/sprite/*-variants.ts`).
- **Components, CSS modules, and `.ts(x)` may NOT introduce a new literal color.** They consume semantic (or earned component) tokens via `var()`.
- The scoped inbox redeclaration (`.inbox-page/.sheet`) stays (load-bearing for the name-collision lesson) but its **values must be `hsl(var(--semantic))`, not literals.**
- **Governed paths** (where the drift guard applies): `apps/dashboard/src/app/**`, `apps/dashboard/src/components/**`, `apps/dashboard/src/lib/**`, `apps/dashboard/src/styles/**` — **excluding** marketing/public token namespaces (`--v6-*`, `--sw-*`) and sprite pixel data (`cockpit/sprite/*-variants.ts`). A file outside these paths is out of scope by definition — no "is this governed?" debate later.

### 3.3 Exceptions & expiry
- A temporary literal is permitted only when migration cannot yet resolve it, and **must** carry an inline marker:
  `/* token-debt: <reason> — <PR#/ticket> — expires <wave|YYYY-MM-DD> */`
- The drift guard **allowlists only marked debt** and **fails on any unmarked literal** in a governed path. An expired marker is a review blocker.

### 3.4 What the drift guard enforces (`tokens.test.ts`, CI)
1. No literal hex / `rgb` / raw-HSL on **action** or **agent** tokens outside the primitive block.
2. Each agent hue (`alex/riley/mira` + `-deep`/`-tint`) resolves to **exactly one** value app-wide.
3. The cockpit `T` object contains **only `hsl(var())` references** — zero literals.
4. `--palette-action-bright` (and any fills-only primitive) is **never used as a text/foreground color** (§4.5).
5. **Contrast:** every action foreground/background pair computes **≥ 4.5:1** (WCAG relative luminance), light mode (§4.6).
6. Only **marked** token-debt literals (§3.3) are exempt.

### 3.5 Why this is governance, not dust
Every implementation PR states the **one governance invariant** it introduces (§7). A reviewer who cannot name the invariant rejects the PR.

---

## 4. Color decisions

### 4.1 Amber: 3 → 1 (the visual-risk keystone)
Collapse to `--palette-action: 30 58% 41%` (the #824 AA target):

| today | where | → |
|---|---|---|
| `--action`/`-hover`/`-foreground` | globals:58–60 | `--action: var(--palette-action)` |
| `--operator*` | globals:52–54 | alias → `--action` |
| `--char-accent` | globals:152 | `hsl(var(--action))` |
| `T.amber` / `T.amberDeep` | tokens.ts:11–12 | action semantics (`--action`, `--action-hover`) |
| `T.amberSoft` / `T.amberPaper` | tokens.ts:13–14 | action **tint/surface** semantics (`--action-subtle` / `--action-tint`) — NOT the action foreground primitive |
| inbox `--amber` / `--amber-deep` | inbox-design-base:41–42 | action semantics |
| inbox `--amber-tint` | inbox-design-base:43 | action **tint** semantic (`--action-tint`) |

Visible shift on approve / cockpit buttons → **PR T1 is the "prove the method" PR**: screenshot diffs of *every* action affordance + a narrow rollback (a few globals lines + the alias). Also park `--action`'s `.dark` value (from `--operator`'s existing dark) — value only; **dark stays disabled** (Wave 3).

### 4.2 Agent hues: per-agent → 1
Canonical primitives = the existing globals triplets (`--agent-{alex,riley,mira}` + `-deep`/`-tint`). Repoint: `alex-config.ts` / `riley-config.ts` hexes → `hsl(var(--agent-*))`; inbox `--coral/teal/violet*` → `hsl(var(--agent-*))`; `inbox-agent-avatar.tsx:26` `#4A3A66` → `hsl(var(--agent-mira-deep))`. `mira-config.ts` already correct. Marketing `--v6-coral` OUT of scope.

### 4.3 Neutral ink ramp: 3 → 1 — **by role, not visual similarity**
Three close-but-distinct warm-neutral ramps (editorial `--ink*`, cockpit `T.ink*` 5-step, inbox `--ink-*`). **Rule: unify by hierarchy ROLE, not visual proximity.** Define one canonical primitive ramp mapped by job (primary text / secondary / tertiary / faint / hairline-on-light). **If two values serve different contrast or hierarchy jobs, keep them as distinct primitives — do not force a merge just because they're close.** Riskiest slice → its own PR (T5), **decoupled from the drift guard** (§7), deferrable if visually contentious.

### 4.4 Cockpit `T` semantic mapping
Migrate all color tokens to `hsl(var())`: ink ramp → neutral primitives (§4.3); `T.amber`/`T.amberDeep` → action semantics, **`T.amberSoft`/`T.amberPaper` → action tint/surface semantics (`--action-subtle`/`--action-tint`), not the action foreground primitive**; `T.green #3F7A36` → `--positive`; `T.red #A03A2E` → `--destructive`/`--negative`; `T.hair*` → border/hairline; `T.bg/paper` → canvas/surface. `T.blue` (unused) → delete. Exact semantic target confirmed per-token at implementation via screenshot (values differ slightly — a small, gated visible change).

### 4.5 `--palette-action-bright` — tightly bounded
Sole purpose: **non-text fills / stripes / the brand pip** where the AA-darkened `--action` reads muddy as a large fill. It is **not** a second action color. Enforced by drift-guard rule §3.4.4 — the gate that stops amber quietly re-forking.
- **Allowed:** decorative stripe, non-text brand pip, low-information background fill.
- **Not allowed:** a button background that carries text, an icon color, a label color, a border that conveys active/selected state.

Without these examples it silently becomes "old amber, renamed."

### 4.6 Contrast gate (automated, not screenshot-only)
Drift-guard rule §3.4.5 computes WCAG relative-luminance contrast for action fg/bg pairs and fails < 4.5:1. Extends the audit §6 "contrast gate." (Light mode now; dark pairs added with the Wave-3 palette.)

### 4.7 Mercury — light touch
Point Mercury's *shared* colors (`--mercury-accent`/`-soft`, `--mercury-pos`/`-neg`, `--mercury-ink*`) at the corresponding primitives so they can't drift independently. Do **not** restructure Mercury or its per-surface module aliases. The drift guard exempts Mercury *structure*; its shared colors still derive from primitives.

---

## 5. The rest of Wave 1 (structural; established patterns, not new design)

### 5.1 Type (structural only — serif/italic deferred)
- One `.num` / `[data-tabular]` utility with **real** `font-variant-numeric: tabular-nums` (fix the current no-op jitter), ONE instrument face (JetBrains Mono) across Results / Home / cockpit metric numbers.
- Collapse ~9 ad-hoc letter-spacings → 2–3 named `--track-*` tokens (`--track-label` 0.08em, `--track-eyebrow` 0.12em).
- **Delete the dead `--font-display: "Instrument Sans"`** (DM Sans actually loads — the font lie).

### 5.2 Elevation
5-level warm shadow ladder `--shadow-1 … --shadow-5` (one warm base, incrementing opacity), z-index-mapped (card-rest → hover → dropdown → sheet → modal), replacing ~35 ad-hoc shadows (four base colors today).

### 5.3 Spacing
Strict 4pt scale (4/8/12/16/24/32/48/64) exposed via Tailwind so the dead `--space-*` tokens become live; retire free-hand 7/9/11/14/18/22px. Inbox card = the benchmark fix.

### 5.4 `<QueryStates>` perceived-performance primitive
Extract the AgentPanel three-states-never-collapse invariant into a shared `<QueryStates loading error empty data>` (or `useQueryGate` returning `'loading'|'error'|'empty'|'data'`) using the keys-pending-safe **`!data && !error`** rule. Route every feed through it. Add `(auth)/loading.tsx` route shells for Home / Inbox / Results / Mira with layout-matched skeletons; the audit §5 failure matrix (offline / API-down / agent-errored / halted / designed-empty) is the `error`/`empty` vocabulary.

### 5.5 Voice
One-page in-repo voice spec (numbers spelled ≤ten in prose / tabular in display; attribution verbs handled/attributed/assisted/booked, never "generated"; absence omitted not place-held; agent first-person, never-blaming). Extend the `no-banned-claims` guard test from marketing into in-app copy.

---

## 6. Verification (per slice)
- **Live screenshots** of every touched surface (Home, Inbox, approval sheet, Results, Alex/Riley/Mira cockpits) via playwright-core + system Chrome — dashboard ESLint is stubbed and CI `format:check` is `.ts`-only, so CSS/token changes are **not** CI-gated.
- **Drift guard** (`tokens.test.ts`) per §3.4 — the CI-enforceable backstop; assertions added incrementally as each slice lands.
- **Contrast test** per §4.6.
- **`.ds-pending` removal:** verify orphaned by grepping TSX for the classNames post-#821 — do not trust the memory note or a lone CSS read ("build type-checks dead files" lesson).
- **Amber rollback:** T1 kept small + screenshot-gated.

---

## 7. Sequencing & per-PR invariants

Docs land on `main` via focused PRs first (branch doctrine). Each implementation PR is TDD'd, off `main`, and names its invariant.

| PR | Slice | Governance invariant introduced |
|---|---|---|
| PR-0 | This spec | — (the contract) |
| PR-V0 | Voice spec | — (the contract) |
| **T1** | Primitive+semantic layer + amber 3→1 + guard scaffold | *All amber action affordances resolve to one primitive; no literal amber in the action path.* |
| **TY1** | Tabular metric face (pulled forward — early visible win) | *Every metric number uses one tabular face (no jitter).* |
| **T2** | cockpit `T`→`hsl(var())` + delete dead `KPIStrip`/`ROIBar`/`ApprovalCard`-component (relocate live `ALEX_APPROVAL_ACCENT`) + config hexes→vars | *Cockpit color is themeable — `T` has zero literals; dead cockpit code gone.* |
| **T3** | inbox hues + `#4A3A66` avatar + inbox `--amber` + verify/remove `.ds-pending` | *Each agent hue has exactly one definition in the inbox/avatar path.* |
| **T4** | Mercury light-touch | *Mercury's shared colors derive from primitives (can't drift independently).* |
| **TG** | Drift-guard + contrast-gate finalization (**decoupled from T5**) | *Color drift + sub-AA action contrast are CI failures, not review catches.* |
| **T5** | Neutral ramp 3→1 (by role; deferrable) | *One warm-neutral ramp by role; no surface forks its own inks.* |
| TY2 | Tracking tokens + kill font-lie | *Letter-spacing is a closed named set; no font-stack lies.* |
| EL1 | Shadow ladder | *Elevation is a 5-step ladder; no ad-hoc shadows.* |
| SP1 | 4pt scale via Tailwind | *Spacing is a 4pt scale; `--space-*` are live.* |
| QS1 | `<QueryStates>` primitive | *Every feed renders loading/error/empty/data through one gate.* |
| QS2 | `(auth)/loading.tsx` shells | *Every daily route has a layout-matched shell.* |
| V1 | no-banned-claims in-app | *Banned over-claims fail CI in-app, not just marketing.* |

**Ordering note:** TG (the guard) lands after the color collapses T1–T4 and **before/independent of** T5, so a contentious neutral-ramp collapse can never hold the guardrail hostage (redline #2). **TY1 is pulled forward to right after T1** — independent, low-risk, and fixes currently-visible metric jitter, giving an early visible UX win while the color work stays governance-heavy. TY2/EL/SP/QS/V are independent of the token keystone and may interleave.

**T1 acceptance criterion (no consumer churn):** T1 introduces **no Home/Inbox/Results consumer edits** — only the token *definition* changes in `globals.css` plus test additions. That is the proof the indirection works; any consumer diff in T1 is a red flag.

---

## 8. Wave-0 base coordination
All of #814–#827 are OPEN (verified 2026-06-02). Docs PRs (PR-0, PR-V0) branch off `main` now, zero conflict. T1 edits the same `globals.css` amber lines as #824 → **recommended:** Wave 0 lands first, then Wave-1 implementation branches off clean `main`. Resolved with the operator at the plan→build transition; the spec/plan do not block on it.

---

## 9. Risks & open items
- **Neutral ramp (§4.3)** — highest visual risk; decoupled + deferrable.
- **Cockpit `T` semantic mapping (§4.4)** — green/red/ink targets confirmed per-token via screenshot, not assumed.
- **`.ds-pending` dispute** — memory says orphaned (grid markup deleted in #821), a lone CSS read says active; resolve by TSX grep before deleting.
- **`T.green`/`T.red` vs `--positive`/`--destructive`** — values differ slightly; mapping is a small, screenshot-gated visible change.
