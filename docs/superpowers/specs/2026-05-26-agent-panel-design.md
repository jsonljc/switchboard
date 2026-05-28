# CUX Agent Panel — read-only drill-in (v1) Design

**Status:** APPROVED for planning (9.0/10, minor edits applied 2026-05-26) → writing-plans · **Scope:** frontend-bounded (+ 2 backend deps owned separately)

## Codebase reconciliation (post-Explore 2026-05-26) — AUTHORITATIVE; corrects shapes the spec inherited from the prototype

Verified against the code; these override the body where they conflict:
- **Verdict segments:** `ProseSegment` = `{ kind: "text" | "accent"; text }` (NOT `"prose"`). Render text+accent as one sentence (accent = emphasis, same content stream). [`lib/agent-home/types.ts`]
- **Paused is GLOBAL.** `useHalt()` exposes only a global `halted` boolean — **no per-agent halt state**. "Paused" shows for the tapped agent whenever `halted` is true; the per-agent "still paused" differentiation is **not representable** and is moot once the launch-blocking resume-symmetry fix lands. Drop the per-agent badge concept. [`components/layout/halt/halt-context.tsx`]
- **Hero has no `unit`.** `HeroMetric` = `{ kind, value, comparator }` (+`currency` for revenue). Derive the label from `kind` (`tours-booked`→"consults booked", `ad-leads`→"leads"). [`lib/cockpit/metrics-types.ts`]
- **`useAgentMetrics` has no `window` arg** (hardcoded `week`). ADD 2 requires **extending the hook to accept `window: "week" | "all"`** (frontend, PR 2); the `window=all` endpoint is owned separately.
- **Decision gist + count.** `Decision` has `humanSummary` + `meta.contactName` (no `gistName`/`gistTail`, no client `status`). Compose the gist from those. There is **no client-side "open" predicate** — filtering is server-side; panel and Inbox both call `useDecisionFeed` (panel with `agentKey`, Inbox with all) and read `counts.total`. Equivalence is structural (same endpoint), not a shared selector. [`lib/decisions/types.ts`, `hooks/use-decision-feed.ts`]
- **Activation core-required uses the wire flag.** `MissionSetupRow` has `primary?: boolean` — trigger activation on the `primary && !done` row (verify `primary`'s semantics); fall back to Riley→`meta` / Alex→`inbox` only if `primary` proves unreliable. [`lib/cockpit/mission-types.ts`]
- **Identity:** color from the `--agent-{key}` CSS tokens (the `AGENT_REGISTRY.accent` values are STALE); name from `AGENT_REGISTRY.displayName`; `role` is an internal slug (`"lead-to-speed"`) → use a small dashboard display-label map ("Lead response" / "Ad optimizer" / "Creative"). Avatar = existing `InboxAgentAvatar` (`components/inbox/inbox-agent-avatar.tsx`, props `{ agentKey, size }`).
- **`activityStatus` is an untyped `string`** on the wire — map known values, default gracefully.
- **Sheet primitive** = Radix `Sheet` (`components/ui/sheet.tsx`), `side="bottom"` for the phone slide-up. **Open-state is per-surface and decoupled** — `AgentPanel` takes `agentKey/open/onOpenChange`; each host (Home/Inbox/Results) owns its own open-state. Do NOT couple Home/Results to the Inbox drawer (`RightDrawerKind` in `inbox-drawer.tsx` is Inbox-local); reuse a shared drawer model only if a genuinely dashboard-level one already exists.

## Goal

Build the **agent panel**: the read-only drill-in sheet an owner opens by tapping an AI agent (Alex / Riley / Mira) from the Team Pulse ribbon on Home **and from an agent chip/avatar anywhere** (Inbox, Results). It answers one human question — *"Is my employee doing their job, and does it need anything from me?"* — in a 2-minute, phone-first check-in. It is a **sheet/drawer over the current screen, NEVER a route, NEVER a 4th tab** (re-litigated and held; a "Team" tab reopens the deleted-cockpit failure). The IA stays Home · Inbox · Results.

## Source of visual truth

The refined prototype at `prototype-ref/agent-panel/panel/` — **do not commit it**. Refined 2026-05-26: traffic-lights removed, misleading-green CPL neutralized, zero≠inactivity, paused hero de-fabricated, made **read-only** (pause removed). Match its visual output; do **NOT** copy its `window.SBP` shape, hardcoded numbers, color literals, or `.ap` sheet shell — map onto the real hooks and ride the shared sheet primitive. (Its inline copy predates the **Copy contract** below; the contract wins where they differ.)

## Relationship to other docs

- `docs/design-prompts/2026-05-26-agent-panel.md` — **backend contract + honesty rules + wire shapes** (producer-audited). This spec is authoritative for *what the panel is* and supersedes that prompt's §5 / §2-v1.1 note / Deferred / Pause-Resume references.
- `docs/design-prompts/2026-05-25-inbox-detail.md` — the **decision-detail sheet** the decisions row opens, and the **shared sheet/drawer primitive** this panel rides (do not build a second sheet).

## Mental model (do not break)

A manager glancing at one employee, **not** an operator opening a console. Every label names an OUTCOME. The panel is **read-only**: it mutates nothing. Anything deeper (settings, charts, knobs, full history, pause/resume) routes OUT. That routing-out is the fuse that stops this panel re-becoming the deleted cockpit.

## Panel design — slots (top to bottom, set-up agent)

A phone-height slide-up sheet (grab handle, ✕), riding the shared decision-detail sheet primitive.

**① Identity + agent-voice verdict + status.**
- Agent color dot/initial + name + role. Identity color = **orientation only** (from the `--agent-{key}` tokens). **"Paused" badge** (`--agent-locked`, never red) when the global `useHalt().halted` is true (no per-agent halt — see Reconciliation).
- **Status line — forward health read is PRIMARY:** from `useAgentGreeting(agentKey).signal.oldestOpenItemAgeHours` (HOURS). Fresh → **"Nothing old is waiting"**; aging → **"Oldest lead has waited 6h."** Cutoff = the agent's `busyAgeHoursThreshold` (Alex 24h / Riley 12h; tunable). This read proves only that no item is aging on that one signal — it does **not** claim quality/health/uptime, so the copy must not imply a broad guarantee. Backward presence (`useAgentState`: `activityStatus` + `lastActionAt`) demotes to a **secondary, muted** line: **"Last action 12m ago"** / **"No recorded action in 24h."** Honesty: `oldestOpenItemAgeHours == null` → presence-only, no health read.
- **Verdict line** (`useAgentGreeting`): render the `segments` (`ProseSegment[]` = `text`|`accent`, see Reconciliation) as one warm first-person sentence. This is the one slot where warmth lives. Missing → **"No update yet,"** never a synthesized positive.

**② ONE key result — cumulative "since you hired" hero + week beat.** Precedence (first match wins):
1. **Paused** → *Paused composition* below. If paused **and** core-required setup is also incomplete: show the paused composition, then a small setup note **below the paused note** — do NOT replace the hero with the activation block (paused hierarchy wins; the blocker is still surfaced).
2. **Core-required setup incomplete** (not paused; agent can't do its primary job) → **activation block replaces the hero**: one agent-voiced, value-framed CTA in a tinted call-out. *Core-required keys* (the mission wire has no `required` flag today — verify against it): **Riley → `meta`**, **Alex → `inbox`**. **If the wire later exposes `required: true`, switch to the wire flag and DELETE this hardcoded map** — don't let the temporary mapping become permanent product logic. `agentKey` is `alex|riley` only.
3. **Otherwise (agent is set up) → proof hero.** Fetch sequence — the hero error is **week failure, not all-window failure**:
   - Try `window=all`. Succeeds → lifetime hero, labeled **"since you hired Alex."**
   - `window=all` unsupported (400)/unbuilt/errored → fall back to **week**. Week succeeds → week hero, labeled **"this week."** **Week also fails → "Couldn't load this week's number."**
   - **The label binds to the window that ACTUALLY returned** — NEVER render week data under a lifetime label.
   - Alex `tours-booked` → "consults booked" (never "tours"). Riley `ad-leads` → "leads"; CPL-vs-target composed from `targetCpbCents` + `spendCents` (**both CENTS → ÷100**), stated in **neutral words** (over/under), never green.
   - One number + a beat (not a second tile). True zero MUST show ("0 booked since you started" / "0 this week"), never coerced from null.
   - **Non-core gap while set up** (e.g., Riley's Google Ads off with Meta live; Alex's calendar not yet connected) → keep the proof hero and add a **small inline nudge below it** ("Connect Google Ads to expand Riley's reach"). Never hide proof behind activation for an optional gap.

**Paused composition (explicit — resolves the ambiguity):**
- Header: "Paused" badge. · Status: **"Paused from your workspace controls"** (no health read, no presence).
- Hero: the **real historical result**, correctly labeled per the window that returned, in a **muted, non-glowing** treatment — never a fabricated 0, never hidden.
- Note under hero: **"No new actions are going out while paused."**
- Decisions + work log: still render their real historical content.

**③ Open decisions → route OUT.** From `useDecisionFeed(agentKey)`: count + one-line gist (composed client-side); each row taps → the existing decision-detail sheet. **No approve/reject here.** Fetch error → "Couldn't load decisions," never "0 / nothing needs you." The count MUST **reuse the Inbox's exact open-decision predicate** (import a shared selector, or extract one both consume — do NOT re-derive "open"); counted statuses = whatever the Inbox counts (verify against `lib/decisions/types.ts`). Enforced by the equivalence test below.

**④ Recent work log.** From `useAgentActivityCockpit(agentKey)`: **3–5** factual timestamped rows, hard-capped, "since you last looked" header. **Compose first-person voice client-side** from `kind + head + who`. "See all in Results →" absorbs "more." Error → "Couldn't load recent work"; genuinely empty → "No actions in the last 24 hours."

- **Freshness foot:** single "as of 3:42pm" line. **No slot ⑤** — the panel mutates nothing.

### Mira — honest "Not set up" panel
For `agentKey === "mira"`, the **expected not-supported** 404/400 responses map to this panel: body is the truth — "Mira isn't set up yet" + one informational forward action — never a "Set up Mira" dead-end, never a zero-filled shell, never hidden. **Scope this narrowly:** only Mira's expected not-supported responses become "not set up"; an unexpected 400 for Alex/Riley (malformed request, schema drift) stays a real error, never softened into "not set up."

## Panel state matrix (canonical — implementers build to this)

| State | Header | Status line | Hero (slot ②) | Decisions | Work log |
|---|---|---|---|---|---|
| Loading | skeleton | skeleton | skeleton | skeleton | skeleton |
| Normal active | identity | health + presence | lifetime ("since you hired") or week fallback ("this week") | open list | recent rows |
| Metrics 400 (window=all unsupported) | identity | health + presence | **week hero, "this week" label** | open list | recent rows |
| Slot fetch error | identity | presence if available | "Couldn't load…" | "Couldn't load decisions" | "Couldn't load recent work" |
| True zero (set up) | identity | health + presence | `0` with honest label | "Nothing waiting" | "No actions in 24h" |
| Paused | "Paused" badge | "Paused from your workspace controls" | **real historical result + "No new actions… while paused"** (muted) | real list (or "Nothing waiting on you from {Agent}") | real historical rows |
| Core setup blocked | identity | presence/health | **activation CTA** (replaces hero) | typically empty | typically empty |
| Non-core gap (set up + proof) | identity | health + presence | proof hero **+ inline nudge** | open list | recent rows |
| Mira | Mira identity | "Not set up" | — (honest body) | — | — |

## Copy contract (canonical strings — do not invent variants)

| Slot / state | String |
|---|---|
| Health — fresh | `Nothing old is waiting` |
| Health — aging | `Oldest lead has waited {N}h` |
| Health — null signal | *(omit; show presence only)* |
| Presence — recent | `Last action {N}m ago` |
| Presence — stale | `No recorded action in 24h` |
| Verdict — empty | `No update yet` |
| Paused — status | `Paused from your workspace controls` |
| Paused — hero note | `No new actions are going out while paused` |
| Metrics — error | `Couldn't load this week's number` |
| Hero — true zero (lifetime) | `0 booked since you started` |
| Hero — true zero (week) | `0 booked this week` / `0 leads this week` |
| Decisions — error | `Couldn't load decisions` |
| Decisions — empty | `Nothing waiting on you from {Agent}` |
| Work log — error | `Couldn't load recent work` |
| Work log — empty | `No actions in the last 24 hours` |
| Mira | `Mira isn't set up yet` |

Warmth lives **only** in the agent-voice verdict line; every status/error/empty string above is factual and flat — no "working hard," no synthesized positivity.

## Honesty invariants (non-negotiable)

Three states never collapse (loading / error / true zero; `null ≠ 0`); status is a report with provenance, not a liveness claim; money is CENTS (÷100, incl. activity rows); bankable for `alex`+`riley` only (Mira honest "Not set up"); no red/yellow/green traffic lights.

## Backend dependencies (owned separately, in flight — panel does NOT block)

- **`GET …/metrics?window=all`** — same `MetricsViewModel` hero shape, aggregated `[AgentDeployment.createdAt, now]`, week comparator/spark dropped. Panel falls back to week-hero (labeled "this week") until it lands (`metrics.ts:10` is `z.enum(["week"])` today → **400** on `window=all`, treated as fallback not error). Separate TDD'd PR.
- **Resume-symmetry fix** (launch-blocking) — restore every paused deployment + re-activate force-paused campaigns. Separate TDD'd PR. Panel stays read-only; touches no shared files.

## Must-test before merge (launch-blockers)

1. **`window=all` miss/error fallback** — panel calls `all` first; on ANY `all` miss/error (400/unbuilt/5xx/network) falls back to week under the **"this week"** label, never "since you hired." Only a WEEK miss/error renders the hero error; the label always binds to the window that returned.
2. **True zero vs failed fetch vs null** — true `0` → "0 booked…"; failed fetch → "Couldn't load…"; `null` never renders as `0`.
3. **Paused with non-zero result** — paused Alex with 12 historical consults still shows **12** + paused note; no health read; no fabricated 0.
4. **Mira 404 (scoped)** — Mira's expected not-supported 404/400 → honest Mira panel (no Alex/Riley hook leakage into a zero shell; no dead "Set up Mira" CTA). An unexpected 400 for **Alex/Riley** renders a real error, NOT "not set up."
5. **Money cents** — `spendCents` / `targetCpbCents` / `avgValueCents` ÷100 everywhere, **including activity-row figures**.
6. **Greeting segments** — renders all `text`/`accent` segments (`ProseSegment`), not only the first.
7. **Decision-count equivalence** — `useDecisionFeed("alex").counts.total` (panel) equals the same agent-scoped, server-filtered set the Inbox shows for Alex (same hook/endpoint; no client filter).

## Fixture requirements (more valuable than broad snapshots)

Alex active with **lifetime** metric · Riley active with **cents** metric · all-metric **400 fallback** (→ week label) · **paused non-zero** · **core setup incomplete** (activation) · **non-core gap** (proof + nudge) · **decisions fetch error** · **activity empty** · **Mira 404**.

## PR shape

- **PR 1 — shell + state contract (infrastructure, not visual polish):** the sheet via the shared primitive, typed `agentKey`, **Team Pulse entry only**, honest Mira panel, and the loading/error/zero/paused state utilities + state-matrix scaffolding. Its job is to **prove the panel cannot become a route/tab/control surface**, rides the shared sheet, and handles Mira honestly.
- **PR 2 — Alex/Riley data slots (the trust PR):** greeting, status (health + presence), metrics with the window-label fallback (incl. extending `useAgentMetrics` to accept `window`), decision count (`useDecisionFeed` `counts.total`), work log. **All the launch-blocking tests live here** — all-window fallback + label, null/zero/error, paused non-zero, cents (incl. activity rows), prose segments, decision-count equivalence — plus the fixtures.
- **PR 3 — cross-surface entry points (surface wiring only):** Inbox + Results chip/avatar entry, kept isolated so they don't destabilize the core panel.

(If forced into one PR, structure commits in this order. Guard against implementation drift: don't let "nice UI" override the boring state contract.)

## Out of scope / deferred

- **Scheduled brief / digest** — a notification feature, not a panel metric; explicitly NOT folded into the cumulative headline; tracked separately so it doesn't silently rot like the composer.
- **Numbered autonomy line** — requires `spendApprovalThreshold` enforcement + reconciling the `trustLevel`/`trustLevelOverride` collision (separate backend workstream). Omitted.

## Build & wiring notes

- **Reuse, don't rebuild** (live for `alex`/`riley`): `use-agent-greeting`, `use-agent-metrics`, `use-decision-feed`, `use-agent-activity-cockpit`, `use-agent-mission`, `use-agents` (`useAgentState`), `halt-context` (**read-only**).
- **Ride the shared decision-detail sheet primitive** — not the prototype's bespoke `.ap` shell (it lacks focus-trap/Esc/scroll-lock).
- **Entry:** Team Pulse chip (`components/home/team-pulse.tsx`, presence-only today) opens the panel; plus Inbox + Results (PR 3).
- **Tokens:** consume warm-editorial `:root` tokens; do NOT redefine (`globals.css` shared with parallel worktrees). No red / general-green token exists → traffic-lights are structurally impossible if you use the system.
- **Gates:** `pnpm --filter @switchboard/dashboard test`, `pnpm typecheck`, `pnpm --filter @switchboard/dashboard build` (NOT in CI), `pnpm format:check`. Coverage 40/35/40/40. Co-located `*.test.tsx`. Dashboard imports omit `.js`. Own PR off `main`.

## Correctness traps (verify while wiring)

- **Decision gist:** real `Decision` likely doesn't pre-split `gistName`/`gistTail` — compose client-side.
- **Work-log cents:** activity `head`/`body` may carry raw cents — ÷100; handle the full `ActivityRow.kind` enum (safe default).
- **Paused ≠ zero-week:** render the real figure + paused note, never a fabricated 0.
- **AgentAvatar:** reuse the existing dashboard avatar component.
