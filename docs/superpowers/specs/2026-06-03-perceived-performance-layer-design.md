# Perceived-Performance Layer — `<QueryStates>` + `(auth)/loading.tsx` shells — Design Spec

**Date:** 2026-06-03
**Status:** Draft for review
**Source:** `docs/audits/2026-06-02-ui-ux-feel-audit/direction.md` §4 (Gap #7, #12), §5 ("Failure & empty states — a system"), §6 ("The perceived-performance primitive"), §7 (Wave 1, item 4). Realizes deliverables **QS1 + QS2** of `docs/superpowers/specs/2026-06-02-wave-1-token-unification-foundation-design.md` §5.4 / §7.
**Scope:** `apps/dashboard` only. Skin-agnostic. Branches off `main` (token keystone #832 already merged).

---

## 0. Scope & non-goals

**In scope.**
1. A shared `<QueryStates>` primitive (+ a pure `resolveQueryState()` core) that extracts the AgentPanel "three-states-never-collapse" invariant and applies the **keys-pending-safe `!data && !error` rule** (never `isLoading`).
2. A small **failure-state vocabulary** (the §5 matrix) in Alex's honest first-person voice: connection-trouble (offline / API-down aware), designed all-clear, agent-paused.
3. Routing the **daily feeds** through the primitive where it is conflict-free: Mira desk, the AgentPanel slots, the Results page, and the Inbox header-drawer.
4. **`(auth)/loading.tsx` route shells** for Home, Inbox, Results, Mira — layout-matched skeletons matching the quality of the only existing one (`(public)/loading.tsx`).

**Explicitly OUT of scope.**
- The **in-component Inbox page** feed gate (`inbox-screen.tsx`). It is owned by the in-flight Wave-0 stack (#816 fixes the exact `if (filtered.isLoading)` → `!data && !isError` gate; #818/#821/#822 stack on the same file). We do **not** touch it — see §8. QueryStates is the generalization it adopts in a trivial follow-up once that stack lands.
- **Offline action-disabling** / persistent global offline banner / queue-hold mutation gating (§5 "queue actions disabled"). We ship the offline *error-state copy*; disabling mutations is a separate mutation-layer change.
- The **mutation-error "started but didn't finish" split** (§5 agent-errored-mid-action). That is a commit-path concern already handled by `handoff-detail-sheet.tsx` and Wave-0 #821/#822 — not a read-feed state.
- **Mira desk re-skin** (Wave 3) — we add a layout-matched skeleton + honest states, not the warm-editorial redesign.
- Authoring `.dark` palette **values** (Wave 3). New files must be token-driven so they inherit dark for free later, but we add no dark values.
- Home in-component module rewrite / cumulative "since you hired" strip (Wave 2 roadmap item) — Home gets its **route shell** only here.

---

## 1. Problem (verified 2026-06-03 against `origin/main` @ f7dc170f)

**Gap #7 — perceived-performance is backwards.** Only `(auth)/(public)/loading.tsx` is a polished route shell; **no `loading.tsx` exists anywhere under `(auth)`** (verified). The Inbox in-component loading is a bare unstyled `<div className="inbox-loading">Loading…</div>` (`inbox-screen.tsx:182`) — and **no CSS rule for `.inbox-loading` exists anywhere** (verified by grep). Its gate is `if (filtered.isLoading)` (`:181`).

**The keys-pending trap (the load-bearing bug).** Every read hook in the dashboard is `enabled: !!keys`, where `useScopedQueryKeys()` (`hooks/use-query-keys.ts:19-23`) returns `null` until the NextAuth session resolves `organizationId`. A query with `enabled:false` is `status:"pending"`, `fetchStatus:"idle"` → **`isLoading` is `false`, `data` is `undefined`, `error` is `null`** (React Query v5). So any gate written `if (isLoading)` is *skipped during keys-pending* and falls through to render with empty data — which is exactly how the Inbox flashes a false "That's everything" (`inbox-screen.tsx:194`) with items still pending. `mira-desk-page.tsx:34` already proves the correct rule: `const pending = !desk && !deskQ.error`.

**Inconsistent state handling across surfaces (verified):**
| Surface | File | Current gate | Verdict |
|---|---|---|---|
| Inbox **page** | `inbox-screen.tsx:181` | `if (filtered.isLoading)` → bare unstyled div | buggy (keys-pending) — **owned by Wave-0 #816** |
| Inbox **drawer** | `layout/inbox-drawer.tsx:126` | `isLoading && !data ? … : isError ? … : total===0 ? …` | correct-ish, bespoke; free to migrate |
| Home | `home/home-page.tsx` | **no aggregate gate at all** (Gap #12) | renders fallback shape of every module on cold start |
| Results | `results/results-page.tsx:77` | `if (isLoading) return <ResultsSkeleton/>` | keys-pending hole in live mode |
| Mira desk | `cockpit/mira/mira-desk-page.tsx:34` | `!desk && !deskQ.error` | **the gold standard to extract** |
| AgentPanel slots | `agent-panel/key-result.tsx:44`, `open-decisions.tsx:32` | `if (*.isLoading)` | three-states invariant, but isLoading-gated |

**§5 — failure states are not a system.** Offline / API-down / agent-halted / designed-empty have no honest, voiced treatment. Errors read as blanks or raw text; "all-clear" reads as a dead account.

---

## 2. The primitive — `resolveQueryState()` + `<QueryStates>`

Two layers: a **pure resolver** (the exhaustively-testable core) and a **declarative component** (the ergonomic API). The audit's "or `useQueryGate`" string-status form is exposed via the resolver's discriminated union `.status`.

### 2.1 Pure resolver (the keys-pending-safe rule)
```ts
// components/query-states/resolve-query-state.ts
export type QueryState<T> =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "empty" }
  | { status: "data"; data: T };

export interface QueryLike<T> { data: T | undefined; error: unknown }

export function resolveQueryState<T>(
  q: QueryLike<T>,
  isEmpty?: (data: T) => boolean,
): QueryState<T> {
  // Prefer data even when a background refetch errored (stale-while-revalidate),
  // mirroring mira-desk-page's `!desk && !deskQ.error`.
  if (q.data != null) {
    return isEmpty?.(q.data) ? { status: "empty" } : { status: "data", data: q.data };
  }
  // No data: a present error is a genuine failure; otherwise we are still
  // pending — INCLUDING the enabled:false keys-pending window where isLoading
  // is false. We deliberately never read isLoading.
  if (q.error != null) return { status: "error", error: q.error };
  return { status: "loading" };
}
```
**Precedence (normative):** `data` (incl. empty) ▸ `error` ▸ `loading`. `data != null` wins over `error` so a cached list survives a failed background poll. `!data && error` → error. `!data && !error` → loading (catches keys-pending). This is the single rule the whole layer is built on.

### 2.2 Component
```tsx
// components/query-states/query-states.tsx
export interface QueryStatesProps<T> {
  query: QueryLike<T>;                 // structurally satisfied by UseQueryResult<T>
  isEmpty?: (data: T) => boolean;
  loading?: React.ReactNode;           // default: a generic token-driven skeleton
  error?: React.ReactNode | ((error: unknown) => React.ReactNode); // default: <ConnectionTrouble/>
  empty?: React.ReactNode;             // default: <AllClear/>
  onRetry?: () => void;                // wired into the DEFAULT error state
  children: (data: T) => React.ReactNode; // render-prop; data is non-empty & narrowed
}
```
Consumers pass `query={feed}` (we read only `data`/`error` — never `isLoading`, by design) and a render-prop. **Every slot has a safe default**, so a feed routed through `<QueryStates>` can *never* render a blank, a spinner-forever, or a raw error — the property the audit demands.

### 2.3 The `isLoading` lint boundary
The primitive's contract is "never gate on `isLoading`." Consumers stop reading `*.isLoading` for the gate. We do **not** add an ESLint rule (dashboard lint is stubbed); instead the resolver makes `isLoading` structurally unnecessary, and the component tests assert the keys-pending case (a `{data:undefined,error:null}` query renders `loading`, not `empty`).

---

## 3. Failure-state vocabulary (§5 matrix, Alex's voice)

Three small components in `components/query-states/states.tsx`, token-only, no new literal colors. Copy follows the voice principles (first-person, never-blaming, honest absence, "I'll…"). `agentName` defaults to **"your team"** (the feeds aggregate Alex/Riley/Mira; halt is workspace-global per product decision).

| State | Trigger | Component | Copy |
|---|---|---|---|
| **Offline** | `error` branch **and** `navigator.onLine === false` | `<ConnectionTrouble>` (offline branch) | **"You're offline."** / "I'll hold your decisions here until you're back." (no retry button — auto-recovers) |
| **API / agent backend down** | `error` branch, online | `<ConnectionTrouble>` (online branch) | **"I can't reach your team right now."** / "Nothing you've approved is lost — I'll keep trying." + **[Try again]** when `onRetry` is wired |
| **Designed empty / all-clear** | `empty` branch | `<AllClear>` | **"You're all caught up."** / "Your team is on top of it." (or a passed `sub`) |
| **Agent halted / paused** | `empty` branch **and** `useHalt().halted` | `<AgentPaused>` | **"{agentName} is paused."** / "Resume when you're ready — nothing new will go out until you do." |

`<ConnectionTrouble>` reads `navigator.onLine` at render and via an `online`/`offline` listener so it flips live. Halt-awareness is a *consumer* choice: a surface with `useHalt()` passes `empty={halted ? <AgentPaused/> : <AllClear/>}`. We wire this on Mira (already imports `useHalt`) and leave it opt-in elsewhere; the default empty is `<AllClear>`.

**Contrast:** failure copy uses `--ink` / `--ink-2` (high-emphasis) for the title and `--ink-3` (≥14px only) for the sub-line; verified ≥4.5:1 on the warm canvas live. The `[Try again]` control uses the canonical action token (`--action`, AA-passing post-#832) — never a new color.

---

## 4. Routing the daily feeds (QS1)

Route each daily **feed** through `<QueryStates>` where conflict-free. This satisfies the QS1 invariant *"every feed renders loading/error/empty/data through one gate"* for every surface we own; the one we don't (`inbox-screen.tsx`) gets the same predicate via #816 (§8).

| Surface | File | Change |
|---|---|---|
| **Mira desk** | `cockpit/mira/mira-desk-page.tsx` | Replace inline `pending/error/data` with `<QueryStates query={deskQ} loading={<MiraDeskSkeleton/>} empty={halted ? <AgentPaused agentName="Mira"/> : <AllClear/>}>`. Upgrades the bare "Loading…" text to a real skeleton. Mira-family surface → consume `T.*` tokens (now `hsl(var())`-backed post-#832). |
| **AgentPanel — open-decisions** | `agent-panel/open-decisions.tsx` | Migrate the loading/error/empty/data quad to `<QueryStates>` (keeps the tailored "Nothing waiting on you from {Name}" empty copy). Fixes the latent isLoading→keys-pending gap. |
| **AgentPanel — key-result** | `agent-panel/key-result.tsx` | Swap only the **loading gate** (`if (all.isLoading || …)`) to the keys-pending-safe predicate via `resolveQueryState`; the paused/activation/proof sub-states are domain logic and stay. |
| **Results** | `results/results-page.tsx` | Change `if (isLoading)` to route the live feed through `<QueryStates query={{data, error}} loading={<ResultsSkeleton/>}>` (reuse existing `ResultsSkeleton`), closing the live-mode keys-pending hole. Fixture mode unaffected. |
| **Inbox drawer** | `layout/inbox-drawer.tsx` | Migrate its bespoke `isLoading && !data ? …` triad to `<QueryStates>` — a clean inbox-feed demonstration, **not touched by any Wave-0 PR** (verified). |

`useDecisionFeed` (the inbox feed) is thereby routed through QueryStates via the drawer + open-decisions, even though the inbox *page* defers to #816.

---

## 5. Route shells (QS2)

`loading.tsx` is the App-Router Suspense fallback rendered **inside** the app shell (`(auth)/layout.tsx` → AppShell → `.app-body > AppSidebar + .app-main > .app-content > {children}`). A shell skeleton fills `.app-content` only — masthead + sidebar are already painted around it.

### 5.1 Home — scoped via a route group
Home is `(auth)/page.tsx`, so a naïve `(auth)/loading.tsx` would leak a Home-shaped skeleton to **every** `(auth)` child without its own shell (settings, onboarding, operator, all of `(mercury)`, …) — wrong for full-bleed onboarding/operator especially. Fix: move Home into a **pathless route group** `(auth)/(home)/page.tsx` and put `(auth)/(home)/loading.tsx` there. Route groups don't change the URL (`/` stays `/`), so middleware (`pathname === "/"`), nav active-state, the brand link, and onboarding's `router.push("/")` are all unaffected (verified). The only code touch is one test import (`(auth)/__tests__/home-route.test.ts`: `../page` → `../(home)/page`). **Risk: low** (Agent-audited).

### 5.2 The four shells
- `(auth)/(home)/loading.tsx` — verdict-hero block + bento module placeholders (matches the desktop bento / mobile stack).
- `(auth)/inbox/loading.tsx` — masthead + filter-chip row + 3–4 ghost decision rows.
- `(auth)/results/loading.tsx` — renders the **existing** `ResultsSkeleton` (single source for the Results loading shape).
- `(auth)/mira/loading.tsx` — renders the shared `MiraDeskSkeleton` (also used by the in-component Mira loading slot — one source).

Skeleton building blocks: the shadcn `<Skeleton>` primitive (`components/ui/skeleton.tsx` → `animate-pulse rounded-md bg-muted`) for className surfaces, matching `(public)/loading.tsx`'s `bg-border/30 animate-pulse` idiom. Mira's skeleton matches the cockpit idiom (`var(--canvas-2)` fill + opacity pulse). All inherit the global reduced-motion clamp (`globals.css:308-315`) for free.

---

## 6. Token governance compliance (normative — §3 of the wave-1 spec)

Every new file lives under governed paths (`src/app`, `src/components`) and is swept by `app/__tests__/token-governance.test.ts`. Rules we hold:
- **Zero literal colors.** Skeleton fills + state text use `hsl(var(--…))` / `var(--…)` (Mira: `T.*`) / Tailwind token classes (`bg-muted`, `bg-border/30`, `text-muted-foreground`). No hex, no `rgb()`, no raw HSL triple.
- No re-fork of any `--action` / `--agent-*` brand token (we define no color tokens at all).
- The `[Try again]` action affordance resolves to `--action` (AA white-on-amber, post-#832).
- We add a **drift-guard assertion** asserting the new `query-states/` + skeleton sources contain no hex (cheap regression lock, consistent with how T-slices grew the guard).

---

## 7. Testing strategy (TDD, co-located `*.test.ts(x)`)

- **`resolveQueryState`** — the exhaustive truth table: `{data:X,error:null}`→data; `{data:[],error:null,isEmpty}`→empty; `{data:undefined,error:null}`→**loading (the keys-pending case)**; `{data:undefined,error:E}`→error; `{data:X,error:E}`→**data (stale-wins)**; null vs undefined data. This pure test is the spine.
- **`<QueryStates>`** — RTL: renders each branch; default slots (no blank ever); render-prop receives narrowed non-empty data; **a disabled-query-shaped input renders the loading slot, not empty** (the regression the whole layer prevents); `onRetry` wired into the default error.
- **Failure components** — copy assertions; `<ConnectionTrouble>` offline vs online branch (mock `navigator.onLine`); `[Try again]` calls `onRetry`; `<AgentPaused>` names the agent.
- **Routed surfaces** — update/extend existing tests (Mira desk, open-decisions, results) to assert the keys-pending input renders loading (not empty/error) through the new gate.
- **Route shells** — light render/smoke test per `loading.tsx` (renders, exposes `role="status"`/`aria-label`); home-route test import fixed and still green.

---

## 8. Wave-0 coordination (explicit boundaries)

All of #814–#827 are **open** (verified). Confirmed via `gh pr diff --name-only`: **none** of them add any `(auth)/**/loading.tsx` or move `(auth)/page.tsx` — the **route-shell slot is uncontested**. The only overlap is the Inbox *page* in-component gate:
- **#816** rewrites `inbox-screen.tsx:181` `if (filtered.isLoading)` → `if (!filtered.data && !filtered.isError)` — the **same predicate** `resolveQueryState` encodes.
- **#818/#821/#822** stack on `inbox-screen.tsx` (optimistic removal, commit-moment, undo).

**Decision:** we do **not** touch `inbox-screen.tsx`. QueryStates is the generalization of #816's predicate; after the Wave-0 stack merges, swapping the inbox page's gate to `<QueryStates>` is a one-file follow-up. We *do* migrate the **drawer** (`inbox-drawer.tsx`, untouched by Wave-0) so the inbox feed is demonstrably routed through the primitive. This is the "complementary, not conflicting" boundary the operator asked for.

---

## 9. PR structure

Two independent slices, both off clean `main`, no stacking (route shells don't import the primitive):
- **PR-QS1** — `resolveQueryState` + `<QueryStates>` + failure vocabulary + route Mira / AgentPanel / Results / Inbox-drawer through it + `MiraDeskSkeleton` + drift-guard assertion.
- **PR-QS2** — the four `(auth)/loading.tsx` shells + the `(home)` route-group move.

Ship as **one PR** if it stays reviewable (cohesive, conflict-free); split into the two above if review burden warrants. Each slice is TDD'd and live-screenshot-verified (Home / Inbox / Results / Mira × loading / empty / error). Required checks: typecheck / lint / test / security all green. **The author does not merge** — hand off for operator review.

---

## 10. Risks & open items
- **`(home)` route-group move** — lowest-confidence change. Mitigation: verify the URL stays `/` live (nav active-state, middleware, brand link, onboarding redirect) via screenshots before finalizing.
- **`navigator.onLine`** is a coarse signal (true on captive portals). Acceptable: the online branch copy ("I'll keep trying") is honest either way, and the offline branch only *adds* reassurance.
- **Mira `T.*` vs CSS-var skeleton idiom** — Mira consumes `T.*` (hsl(var())-backed); the rest use Tailwind/CSS tokens. Two idioms, one rule (no literals). Screenshot-confirm the Mira skeleton reads on its `T.paper` surface.
- **Stale-wins precedence** — if a feed legitimately wants "show error over stale data," it opts out by passing its own `error` node and not relying on the default; the resolver's default is stale-wins (the safer UX for a polling feed).
