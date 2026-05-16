# Cockpit v2 Audit — `/alex` + `/riley`

**Date:** 2026-05-16
**Branch audited:** `feat/alex-home-v2-frontend-alignment` (HEAD `a3418dbe`)
**Audit scope:** read-only; three parallel agents (frontend, backend, end-to-end traces).
**Purpose:** establish baseline before implementing two new Anthropic-shared designs (Alex Home v2, Riley Home v2). Distinguish "what just shipped" vs "what v2 still needs."

---

## 0. Branch state correction (read this first)

The audit was framed around the assumption that we're on a clean `main` with PR #600 merged. **We're not.** Ground truth from `git log origin/main` and `git branch --contains 504174cf`:

| Commit on `origin/main` | Description                                                                     |
| ----------------------- | ------------------------------------------------------------------------------- |
| `96a3ca77` (HEAD)       | feat(dashboard-demo-toggle): PR-1 — data-mode infrastructure (#599)             |
| `2bd8f1fc`              | feat(alex-cockpit): align /alex + /riley cockpit to agent-home-v3 design (#603) |
| `2c4c911c`              | docs(dashboard-demo-toggle): pr-1 infrastructure implementation plan (#595)     |
| `6db5669f`              | docs(dashboard-demo-toggle): spec for runtime data-mode toggle (#593)           |
| `504174cf`              | fix(api): wire cockpit live spend and calendar setup state (#600)               |
| `d21fb738`              | (this branch's merge base)                                                      |

The commit `2bd8f1fc` is the squash-merge of this branch's `a3418dbe` as PR #603. **PR #603 closed 9 frontend gaps from the agent-home-v3 design package; that work is already on main.** PR #600 (cockpit wiring) is also on main, as is PR #599 (data-mode infrastructure). This branch was branched from `d21fb738`, before any of those landed, so its working-tree state is "main-minus-#599-and-#600 plus an incomplete hand-port of #599 in uncommitted files."

**Implication for v2 implementation:** the v2 work should happen on a fresh worktree off `origin/main`, not on this stale branch. The uncommitted `apps/dashboard/src/lib/data-mode/shared.ts` and `apps/dashboard/src/components/layout/data-mode-banner.tsx` should be discarded (they duplicate, partially, what PR #599 has on main).

**Implication for this audit doc:** the findings below describe what the audit agents saw on `a3418dbe` (this branch). Each finding is tagged with `[main: fixed]`, `[main: same]`, or `[main: differs]` so the v2 implementor knows what to expect when they branch off `origin/main`. The tags are derived from inspecting `git show origin/main` for each relevant file plus the runbook at `docs/launch/cockpit-wiring-runbook.md` (landed in PR #600).

---

## 1. Executive summary

- **`/alex` cockpit shell exists and renders.** The KPI strip, ROI bar, mission popover, approvals list, activity feed (with "Today · <date>" eyebrow), Composer (stage→Confirm flow + suggestion chips + ⌘K), and command palette are all wired. Empty-state narrator + setup checklist render in cold state.
- **`/riley` cockpit shell exists and renders.** Riley uses the same shared components with a clay accent override; differences vs Alex are intentional (no greeting line, no suggestion chips, no inline ⌘K button, strict-no-fallback metrics adapter, cold state via fake activity rows instead of EmptyState).
- **Live data on this branch: largely degraded or dead.** KPI spend tile + ROI bar are always degraded because PR #600's `wireMetricsProvider` decoration is missing from `apps/api/src/app.ts`. The calendar setup row is hardcoded `done: false`. Both are fixed on main.
- **Persistent gaps that exist on main too:** Critical #3 (approval `kind` never written by orchestrator), OAuth→Connection upstream-writer gap, Riley `body` slot never populated, ThreadPreview "Send as me" doesn't send, `brand` field is `${name} · —` placeholder, Riley CTR permanently unavailable, Riley ROI always degraded, activity translator's UUID→"alex" fallback, Riley outcomes route fetch URL mismatch, command palette `commands[]` from mission API is a never-populated placeholder.
- **What the v2 design pass needs to decide:** scope of `kind` classification (block on Critical #3 or accept generic pricing?), Riley `body` slot fate, "Send as me" wire vs rename, double-header stacking (editorial shell + cockpit Topbar), avatar derivation from session principal, whether Riley adopts the suggestion chips / ⌘K affordance / greeting line, agent-keyed setup-row schema for Riley vs Alex.

---

## 2. What PR #603 already shipped (alignment pass, commit `a3418dbe`)

Per `git show a3418dbe` (this branch's HEAD = the pre-squash source of PR #603):

| File                  | What changed                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cockpit-page.tsx`    | `deriveSuggestions(...)`, `formatToday(now)`, wired `suggestions` + `onOpenPalette` + `today` to children                                                                                  |
| `composer.tsx`        | Stage→Confirm/Undo flow; halt-while-pending auto-discard; optional palette button beside Send; suggestion chip row above input                                                             |
| `activity-stream.tsx` | New `today?` prop; "Today · <date>" eyebrow when provided, legacy "Activity" when absent                                                                                                   |
| `activity-row.tsx`    | Renders as `<button>` only when expandable; rotating `›` chevron; expanded body adds "Open full thread →" and "I'll reply to {firstName}" alongside existing "Tell Alex about {firstName}" |
| `thread-preview.tsx`  | Inline reply input + "Send as me" + "Ask Alex to draft" — both navigate to `/contacts/[id]` without forwarding typed text (placeholder behavior, by design)                                |
| `empty-state.tsx`     | "ALEX · just now" eyebrow + 48px "A" monogram + NEXT MOVE pill; "Setup · X of N ready" counter + per-row circle/hint/Connect button                                                        |
| `identity.tsx`        | "✎" glyph after interactive subtitle to signal editability                                                                                                                                 |
| `approval-card.tsx`   | 22px monogram chip with `avatarLetter` prop (default "A", decoupled from `senderLabel`)                                                                                                    |
| `topbar.tsx`          | Ghost "Settings" link between palette button and avatar chip (hidden in `compact` mode → visible on Alex, hidden on Riley)                                                                 |

All nine changes carry matching tests under `__tests__/`. **None of these need to be re-shipped in v2.** What's on this branch as `a3418dbe` is now on main as `2bd8f1fc`.

---

## 3. Frontend audit — per-block summary (Agent A's findings)

Block-by-block. Health legend: ✅ live · 🟡 degraded · 🔴 dead · ⚪ demo-only.

### Editorial shell vs cockpit Topbar stacking

`/alex` and `/riley` render `EditorialAuthShell`'s `<header className="app-header">` (Switchboard mark, agent nav, LiveSignal, Inbox, HaltButton, ToolsOverflow) **and then** the cockpit's own `<Topbar>` (a second Switchboard mark, tabs row, ⌘K, optional Settings). Double-header today. The v2 design needs to settle whether cockpit Topbar replaces or augments the editorial header on agent home pages. `[main: same]`

### Status pill

- Hook: `useCockpitStatusAlex` / `useRileyStatus` — client-side derivation from approvals count + recent activity timestamp + halt state.
- API: derived from already-fetched data; no dedicated endpoint.
- Health: ✅ live for both.
- Alex vs Riley diff: Alex 4-state (`HALTED|WAITING|WORKING|IDLE`); Riley 6-state including `WATCHING`/`REVIEWING`; gated on `hasMetaConnection`.
- Issue: `deriveSuggestions` references `statusKey === "TALKING"` (a value the type union admits but Alex's deriver never produces) → unreachable branch. `[main: same]`

### Topbar (tabs + palette button + Settings link + avatar chip)

- Tabs static (`ALEX_CONFIG.tabs` / `RILEY_TABS`). Settings link hidden in `compact` mode (Riley passes `compact`, Alex doesn't). Avatar chip is hardcoded literal "M" — not derived from session principal. `[main: same]`

### Identity row

- Hook: `useAgentMission(agentKey)` (for `missionInteractive` flag) + `useAgentGreeting("alex")` (Alex only; Riley passes `line={null}`).
- API: `/api/dashboard/agents/[agentId]/mission`, `/api/dashboard/agents/[agentId]/greeting`.
- Health: ✅ live; Riley has no greeting line by design.
- Alex vs Riley diff: Riley overrides `displayName="Riley"`, clay `avatarAccent`, `colorFor`/`pulseFor` from `riley-config.ts`. `[main: same]`

### KPI strip

- Hook: `useAgentMetrics(agentKey)` → `GET /api/dashboard/agents/[agentId]/metrics?window=week`.
- Health: 🔴 **dead on this branch** (spend tile + ROI bar always render "—" / "degraded" because `app.metaSpendProvider` is undefined). `[main: fixed via PR #600 — wireMetricsProvider decorates the provider; spend tile lights up when an org has a Connection serviceId="meta-ads" status="connected"]`
- Alex vs Riley diff: Alex uses `legacyTiles` with `?? 0` fallbacks (renders 4 tiles always); Riley uses strict no-fallback adapter (renders no strip when wire VM lacks `tiles` or `roi`).
- Tile gap: "Open report →" button at `kpi-strip.tsx:42-55` has no `onClick` handler — dead button. `[main: same]`

### ROI bar

- Hook: same as KPI; `roi: RoiBar` discriminated union from `MetricsViewModelWire`.
- Health: 🔴 dead on this branch (same root cause as KPI spend). `[main: fixed for Alex; Riley v1 stays always-degraded by design — cost-per-lead derived; no booking attribution yet]`
- Riley CTR is permanently `unavailable: true` (no CTR provider exists). `[main: same]`

### Mission popover

- Hook: `useAgentMission` → `GET /api/dashboard/agents/[agentId]/mission`.
- Health: ✅ live for ROLE/PIPELINE/BRAND/RULES rows; 🔴 dead on this branch for the calendar channel row (hardcoded `calDone = false`). `[main: fixed via PR #600 — reads from Connection.serviceId="google_calendar" status="connected"]`
- `brand` field is `${brandName} · —` literal placeholder; no real brand metadata source. `[main: same]`
- Note: the canonical Connection `serviceId` is `"google_calendar"` (underscore), NOT `"google-calendar"` (hyphen). The user's prompt asserted hyphen-is-canonical — that assertion is **incorrect against the actual code** at OAuth writer `google-calendar-oauth.ts:184`, skill tool `calendar-book.ts:244`, and `/settings` dropdown `connections-list.tsx:36`. The route prefix `/api/dashboard/connections/google-calendar/authorize` uses hyphen but stores `serviceId: "google_calendar"`. Easy to confuse.

### Approvals list (Alex)

- Hook: `usePendingApprovals` → `GET /api/dashboard/approvals` (only when `NEXT_PUBLIC_APPROVALS_LIVE === "true"`; default fixture).
- Mutation: `useRespondToApproval` → `POST /api/dashboard/approvals` (handler at `apps/api/src/routes/approvals.ts`).
- Adapter: `richPendingApprovalToApprovalView` falls through to `legacyPendingApprovalToApprovalView` when `approval.kind` is undefined.
- Health: 🟡 degraded — Critical #3 architecturally unresolved (4 prior PRs failed). The orchestrator never writes `ApprovalRequest.payload.kind`, so every live row arrives with `kind: undefined` and the dashboard silently classifies every approval as "pricing". `[main: same — runbook §"Out-of-scope: Critical #3"]`
- Per-row wrapper `AlexApprovalRow` owns the mutation + toast + optimistic dismiss (single-owner-toast doctrine).

### Approvals list (Riley)

- Hook: `useRileyApprovals` → filters `useRecommendations({ surface: "queue", status: "pending" })` for `agentKey === "riley"`.
- API: `GET /api/dashboard/recommendations` (always live; no env gate).
- Health: ✅ live for shape, 🟡 for `body` slot (`RileyApprovalView.body` is never populated; adapter writes only `humanSummary → quote`). `[main: same — runbook follow-up #5]`
- Primary action: either `external` (opens Meta Ads URL in new window) or `internal` (calls `useRecommendationAction.primary()`).

### Activity feed (Alex)

- Hook: `useAgentActivityCockpit("alex", { limit: 50, expandPreview: true })` → `GET /api/dashboard/agents/[agentId]/activity`.
- Health: ✅ live; "Today · <date>" eyebrow added by PR #603. `[main: same]`
- Issue: `cockpit-activity-translator.ts` falls back to `kind: "replied"` for unrecognized event types AND attributes UUID-actorId-with-no-agentRole entries to "alex" (legacy audit rows skew Alex's count up, Riley's down). `[main: same]`
- Expanded-body buttons hardcode "Tell Alex about {firstName}" / "I'll reply to {firstName}" — Alex-named. `[main: same]`

### Activity feed (Riley)

- Hook: `useRileyActivity` composite — audit-driven Riley rows + cold-state synthetic rows + `/api/cockpit/riley/outcomes` outcome rows.
- Outcomes fetch: `fetch("/api/cockpit/riley/outcomes")` from `use-riley-activity.ts:15` — **no Next.js handler exists at this path**. The Fastify route at `apps/api/src/routes/cockpit/riley/outcomes.ts` is registered without an `/api/dashboard` prefix. In dashboard runtime the fetch 404s; the hook's `Array.isArray(data) ? … : []` defensive coercion silently no-ops, masked further by `RILEY_OUTCOME_ATTRIBUTION_ENABLED=false` default. `[main: same]`
- Riley does NOT pass `today` to `ActivityStream` — Riley shows legacy "Activity" eyebrow not "Today · <date>". `[main: same]`
- Riley rows have `replyable: false` — Alex-named expanded-body buttons never trigger on Riley.

### ThreadPreview

- Inline reply input + "Send as me" button + "Ask Alex to draft" button. **Both buttons navigate to `/contacts/[id]` without forwarding the typed reply text** — placeholder behavior per a3418dbe commit body. `[main: same]`
- `POST /api/conversations/:threadId/send` exists in apps/api but is not wired into a dashboard hook for operator-send.

### Composer (Alex)

- Dispatcher: `useAlexActionDispatcher` + `parseCommand`.
- Free-text input parses via `parseCommand`; many real intents (followup/handoff/context/instruction) fold into "Noted — not automated yet" toasts. `[main: same]`
- Suggestion chips: client-derived via `deriveSuggestions(halted, coldState, hasOpenApproval, statusKey)`. Backend-driven suggestions deferred (a3418dbe commit body §"Follow-ups").

### Composer (Riley)

- Dispatcher: `useRileyActionDispatcher` (different `PER_ID_NL` and `PER_ID_ROUTE` tables).
- Riley does NOT pass `suggestions` or `onOpenPalette` to Composer — chip row hidden, no inline ⌘K. `[main: same]`

### Command palette

- Static command lists (`ALEX_COMMANDS` 14 entries; `RILEY_COMMANDS` 7 entries). No backend source. `[main: same — `commands: never[]`placeholder in`MissionAggregatorResponse`]`
- Alex's thread-group commands (`fu-named`/`reply-named`/`hold-named`) are filtered out when `threadContext` is undefined, and `threadContext` is **never** passed by the page call site → those 3 entries never appear. `[main: same]`

### Empty state / narrator

- Hook: `useAgentMission("alex")` → `coldState = shouldRenderEmptyState(setup)` (true iff every setup row `!done`).
- Health: 🟡 degraded — narrator hardcodes Alex-named copy ("Alex · just now", "A" monogram, "I'm set up and quiet. Connect Meta Ads…"). `[main: same — deferred I6/I7]`
- "Connect consultation calendar" row will never tick `done` on this branch (calendar hardcoded off). `[main: fixed via PR #600]`
- Riley does NOT use EmptyState — cold state is faked via 3 hardcoded activity rows in the stream.

### Data-mode banner (uncommitted files on this branch)

- Files: `apps/dashboard/src/components/layout/data-mode-banner.tsx` (25 lines), `apps/dashboard/src/lib/data-mode/shared.ts` (38 lines) — both untracked.
- Modified: `apps/dashboard/src/app/(auth)/layout.tsx` — imports `@/lib/data-mode/server` (`getDataMode`) and `@/lib/data-mode/client` (`DataModeProvider`) — **neither module exists on this branch**.
- Diagnosis: this is a partial hand-port of PR #599's data-mode infrastructure. PR #599 on main ships `client.tsx` (54 lines), `server.ts` (18 lines), `shared.ts` (38 lines), `data-mode-banner.tsx` (29 lines), AppShell integration, DevPanel integration, and full test coverage.
- **Build state on this branch:** `pnpm --filter @switchboard/dashboard build` will fail because `(auth)/layout.tsx` imports missing modules.
- `[main: fully shipped via PR #599 — discard the uncommitted partial port and pick up the canonical version]`

---

## 4. Backend audit (Agent B's findings, condensed)

### Routes serving the cockpit (apps/api)

| Route                                                        | Health                                                                | Notes                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/dashboard/agents/:agentId/mission`                 | 🟡                                                                    | Channels list always populated; **calendar row dead on this branch** (`mission.ts:130-131` hardcoded). `metaDone = !!metaConnection` (lax). `brand` is literal `${name} · —`. `[main: calendar fixed via PR #600]`                                         |
| `GET /api/dashboard/agents/:agentId/metrics`                 | 🔴 on this branch                                                     | `metrics.ts:63` `const getMetaSpendCents = app.metaSpendProvider ?? (async () => null)` — on this branch the decorator is undefined. `[main: fixed via PR #600 wireMetricsProvider call in app.ts:368]`                                                    |
| `GET /api/dashboard/agents/:agentId/pipeline`                | ✅                                                                    | Drops contacts in stages other than `active`/`new` silently. Drops Riley rows with invalid `targetEntities` JSON or `riskLevel`.                                                                                                                           |
| `GET /api/dashboard/agents/:agentId/wins`                    | ✅                                                                    | Live; freshness always `dataSource: "live"`. Hardcoded `VISIBLE_LIMIT = 5`.                                                                                                                                                                                |
| `GET /api/dashboard/agents/:agentId/activity`                | 🟡                                                                    | Live shape; `kind: "replied"` is the catch-all fallback for unrecognized event types. UUID-actorId-with-no-agentRole rows attributed to **alex** (legacy data skew).                                                                                       |
| `GET /api/dashboard/agents/:agentKey/greeting`               | ✅                                                                    | Never returns null; variant defaults to `"welcome"` when no signal. Per-agent prose hardcoded in `greeting.ts:166-176`.                                                                                                                                    |
| `GET /api/dashboard/agents/:key/decisions` (and cross-agent) | ✅ when stores wired, 🔴 throws (500) when any of 4 stores undefined. |
| `GET /api/cockpit/riley/outcomes`                            | 🔴 in production                                                      | Route registered without `/api/dashboard` prefix; dashboard fetch from `/api/cockpit/...` lands on Next.js (no handler) not Fastify. Hook's defensive `[]` masks the 404. Plus `RILEY_OUTCOME_ATTRIBUTION_ENABLED=false` keeps the table empty by default. |
| `GET /api/approvals/pending`                                 | 🟡                                                                    | Forwards `payload.kind`/`body`/`quote`/`quoteFrom` conditionally; orchestrator never writes `kind` (Critical #3 unresolved).                                                                                                                               |
| `POST /api/approvals/:id/respond`                            | ✅                                                                    | Fully live; concurrent-response 409 handling intact.                                                                                                                                                                                                       |

### Silent fallbacks worth knowing about

- `mission.ts:109` `metaDone = !!metaConnection` — any row counts as done even when `degraded`. Asymmetric vs `calDone === "connected"` strict semantic post-#600.
- `mission.ts:116-125` — first ManagedChannel becomes inbox; defaults `inboxKind = "whatsapp" / status = "off"` when none.
- `mission.ts:152` — `rules = null` when either `priceApprovalThreshold` or `refundEscalationFloor` missing.
- `mission.ts:155` — `(unnamed organization)` placeholder when `org.name` blank.
- `metrics.ts:54-58` — `rosterRow ?? { config: {} }` → empty targets.
- `meta-spend-provider.ts:65-67` — `catch { return null }` swallows insights call failure with a warn log.
- `pipeline.ts:67` silent stage filter; `:88-101` invalid targetEntities → warn + drop; `:103-112` unknown riskLevel → warn + drop.
- `wins.ts:69-75` `null actedAt` → warn + drop. `wins.ts:131-137` `status === "acted"` always `not-reversible`.
- `cockpit-activity-translator.ts:39-41` UUID-actorId-with-no-agentRole → **alex** fallback. `:66-69` unrecognized eventType → `kind: "replied"` default.
- `approvals.ts:134` expired approvals silently dropped. `:150-153` `payload.kind` conditionally included only when truthy.
- `outcomes.ts:44,46` null `copyTemplate`/`copyValues` or off-allowlist template → row dropped (fail-closed).

### Structural gaps where producer never writes what consumer can render

1. **Critical #3 (approval kind classification).** Orchestrator writes nothing to `ApprovalRequest.payload.kind`; dashboard adapter, API route, and Prisma column all accept it. Per project memory `[[alex-cockpit-a7-shipped]]`: 4 prior PRs failed; needs brainstorm. `[main: same]`
2. **OAuth → Connection upstream-writer gap.** OAuth callbacks write `DeploymentConnection`; cockpit reads `Connection`. Operators must manually wire via `/settings`. Runbook §"Upstream-writer gap" tracks this. `[main: same]`
3. **`metaDone` lax vs `calDone` strict asymmetry.** A degraded Meta Connection ticks setup done; a degraded Calendar Connection does not. `[main: same — runbook follow-up #2]`
4. **`MissionAggregatorResponse.commands: never[]`** — server-side palette registry placeholder, never populated. Frontend uses static `ALEX_COMMANDS` / `RILEY_COMMANDS`. `[main: same]`
5. **`brand` is `${name} · —`.** No producer for brand metadata. `[main: same]`
6. **Riley CTR permanently `unavailable: true`.** No CTR provider. `[main: same]`
7. **Riley ROI permanently `degraded: true`.** No booking attribution; cost-per-lead is the only derived metric. `[main: same]`
8. **Riley outcomes route URL mismatch.** Dashboard fetches `/api/cockpit/riley/outcomes`; no Next.js handler; Fastify route is on apps/api at the same path but cross-server. Empty defensive `[]` hides the 404. `[main: same]`

---

## 5. End-to-end contract breaks (Agent C's findings, ranked)

Numbered for follow-up triage. Tags reflect main-branch state.

1. **Calendar mission row dead-hardcoded.** `[branch only — main fixed via PR #600]`
2. **KPI spend + ROI bar dead (metaSpendProvider undecorated).** `[branch only — main fixed via PR #600]`
3. **`serviceId` doc-vs-code mismatch.** The user's prompt says hyphen is canonical for `google_calendar`; the code consistently uses underscore (OAuth writer, skill tool, /settings dropdown, mission.ts on main). The runbook on main correctly uses underscore. The introductory narrative on this branch's planning doc and the user's prompt have hyphen typos. `[main: code-canonical underscore; track a `SERVICE_IDS.\*` constants module as runbook follow-up #3]`
4. **OAuth → Connection writer gap.** `[main: same]`
5. **Critical #3 — orchestrator never writes `payload.kind`.** `[main: same; needs brainstorm]`
6. **`/api/cockpit/riley/outcomes` URL mismatch (Fastify-only path fetched by dashboard).** `[main: same — needs dashboard proxy at `apps/dashboard/src/app/api/cockpit/riley/outcomes/route.ts`or rename Fastify route to`/api/dashboard/cockpit/riley/outcomes`]`
7. **Data-mode subsystem imports missing modules** (`@/lib/data-mode/client`, `@/lib/data-mode/server`). `[branch only — main has full PR #599; discard the uncommitted partial port]`
8. **`deriveSuggestions` references `statusKey === "TALKING"` which Alex's deriver never produces.** Unreachable dead branch. `[main: same]`
9. **Riley `RileyApprovalView.body` slot never populated.** `[main: same — runbook follow-up #5]`
10. **`metaDone` lax-vs-`calDone` strict semantic asymmetry.** `[main: same — runbook follow-up #2]`
11. **Setup-row schema asymmetry between Alex and Riley** — Alex has `[brand, channel, cal, brain]`; Riley has `[meta, rules]`. Implicit agent-keyed vocabulary; EmptyState narrator iterates per-agent. `[main: same]`
12. **ThreadPreview "Send as me" doesn't send** — navigates to `/contacts/[id]` instead of POSTing. Button label misleading vs behavior. `[main: same]`
13. **Greeting hook not invoked for Riley.** Backend supports it; frontend passes `line={null}` and never calls `useAgentGreeting("riley")`. `[main: same]`
14. **`NEXT_PUBLIC_APPROVALS_LIVE` flip is a "silent regression" risk** — flipping to live without Critical #3 keeps every approval generic. Documentation/UX break, not code break. `[main: same — runbook §"Flag 1" warns about this]`

---

## 6. Tokens audit (two-register sanity check)

Zero `--mercury-*` CSS custom-property usage inside `apps/dashboard/src/components/cockpit/` or `apps/dashboard/src/lib/cockpit/`. Zero `--sw-*` either — the cockpit uses inline JS-style tokens from `apps/dashboard/src/components/cockpit/tokens.ts` (the `T` object). Editorial register is intact; the cockpit is not contaminated by Mercury tokens, but it also doesn't consume the editorial CSS-custom-prop layer. The v2 design may want to migrate the cockpit onto `--sw-*` for consistency with the rest of the editorial register, or accept the parallel `T.*` namespace.

---

## 7. Open questions for v2 brainstorm

These are the design/scope questions that need user input before plan-writing. Numbered for reference in the brainstorm.

1. **Replacement or augmentation?** Is Cockpit v2 a wholesale replacement of `cockpit-page.tsx` / `riley-cockpit-page.tsx`, or a polish/alignment pass on top of `a3418dbe`/`2bd8f1fc` (which already implemented "v2 alignment" for 9 specific gaps)? The user's prompt says "implement two new designs" — but the existing branch and PR #603 are titled "align /alex + /riley cockpit to agent-home-v3 design", referencing the **same** Claude Design URLs. Need to compare what the design HTML asks for vs what PR #603 already shipped.
2. **Double-header stacking** (editorial shell `<header>` + cockpit `<Topbar>`) — does v2 collapse to one header, or keep both?
3. **Avatar derivation** — is the literal "M" placeholder in cockpit Topbar a v2 fix target, or stays?
4. **Settings link asymmetry** (visible on Alex, hidden on Riley via `compact` mode) — does v2 unify?
5. **Greeting line on Riley** — does v2 invoke `useAgentGreeting("riley")` and render a line, or stay silent?
6. **Suggestion chips on Riley** — does v2 wire them, or stay Alex-only?
7. **Inline ⌘K button on Riley** — same question.
8. **Setup-row schema agent-symmetry** — does Riley grow a unified EmptyState with its own setup rows, or stay with the 3-hardcoded-fake-activity-row pattern?
9. **Critical #3 scope** — does v2 land the orchestrator producer-side wire for `payload.kind`, or accept generic-pricing rendering for v2 and treat #3 as separate? (The user's prompt explicitly marks #3 as OUT of scope.)
10. **"Send as me" / "Ask Alex to draft" buttons** — do they get wired to real send/draft hooks in v2, or stay placeholder?
11. **Riley outcomes proxy URL** — does v2 add the dashboard proxy route, or rename Fastify?
12. **Approval kind classification UI** — even without Critical #3, does v2 render different urgency/CTA based on heuristics (riskCategory, summary parsing)?
13. **`brand` real source** — does v2 introduce a brand-metadata producer, or accept the placeholder?
14. **Token migration** — does v2 migrate cockpit components from `T.*` JS tokens to `--sw-*` CSS custom properties, or keep `T.*`?
15. **"Today · <date>" eyebrow on Riley** — symmetric with Alex (drop the legacy "Activity") or stays asymmetric?
16. **Activity translator UUID→"alex" fallback** — does v2 design assume migrated audit data with `agentRole` populated, or accept the skew?
17. **Empty/onboarding state when AgentRoster is missing** — `mission.ts:286-287` returns 404; v2 needs an empty UI for this (not yet defined).

---

## 8. Recommended next steps (priority order)

1. **Fetch + extract both v2 design tarballs** (URLs in prompt). Compare design HTML vs what PR #603 shipped — this clarifies whether v2 is a replacement or augmentation.
2. **Branch hygiene.** Discard this stale `feat/alex-home-v2-frontend-alignment` worktree's uncommitted data-mode hand-port (it duplicates PR #599 partially). Create a fresh worktree off `origin/main` per `superpowers:using-git-worktrees`.
3. **Brainstorm with user** on the 17 open questions in §7 — lock requirements before plan-writing.
4. **Write file-by-file plan** per `superpowers:writing-plans`. Plan must explicitly mark the 6 "explicitly OUT of scope" items from the prompt (OAuth→Connection dual-write, Critical #3, env-flag flips, metaDone alignment, SERVICE_IDS constants, Riley body slot / Alex accent backport).
5. **Implement via `superpowers:subagent-driven-development`** — fresh subagents per task + two-stage review.
6. **Verify gates** — `pnpm --filter @switchboard/dashboard test && pnpm --filter @switchboard/api test && pnpm --filter @switchboard/dashboard build` (the build step is critical; CI doesn't run it).
7. **Manual smoke on local dev** — start dashboard at :3002 with at least one connected `Connection` row for each agent; walk both pages.

---

## Appendix A: Files of interest for v2 implementation

- `apps/dashboard/src/components/cockpit/cockpit-page.tsx` (Alex page shell, ~250 lines)
- `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx` (Riley page shell)
- `apps/dashboard/src/lib/cockpit/alex/` (Alex-specific adapters, mutation owners)
- `apps/dashboard/src/lib/cockpit/riley/` (Riley-specific adapters, action dispatcher, recommendation-to-approval-view)
- `apps/dashboard/src/lib/cockpit/{alex,riley}-action-dispatcher.ts`, `parse-command.ts`
- `apps/dashboard/src/lib/cockpit/{alex,riley}-commands.ts` and `riley-config.ts`
- `apps/dashboard/src/components/cockpit/{composer,activity-row,activity-stream,thread-preview,approval-card,empty-state,identity,kpi-strip,mission-popover,roi-bar,status-pill,topbar,command-palette}.tsx`
- `apps/dashboard/src/components/cockpit/tokens.ts` (T.\* JS tokens)
- `apps/dashboard/src/hooks/use-cockpit-status.ts`, `use-riley-status.ts`, `use-riley-activity.ts`, `use-agent-metrics.ts`, `use-agent-mission.ts`, `use-agent-activity-cockpit.ts`, `use-recommendation-action.ts`
- `apps/api/src/routes/agent-home/mission.ts`, `metrics.ts`, `pipeline.ts`, `wins.ts`, `activity.ts`, `greeting.ts`
- `apps/api/src/routes/approvals.ts`, `apps/api/src/routes/cockpit/riley/outcomes.ts`
- `apps/api/src/lib/meta-spend-provider.ts`, `apps/api/src/bootstrap/wire-metrics.ts` (main only), `apps/api/src/lib/ads-client-factory.ts` (main only)
- `docs/launch/cockpit-wiring-runbook.md` — operational source of truth for PR #600's flips

## Appendix B: Memory pointers that informed this audit

- `project_alex_cockpit_a7_shipped` — Critical #3 architecturally unresolved after 4 PRs
- `project_phase_d_complete` — agent-first redesign closed
- `feedback_dashboard_no_js_on_any_import` — Next.js relative imports omit `.js`
- `feedback_dashboard_coverage_threshold` — dashboard is 40/35/40/40, not CLAUDE.md's global
- `feedback_dashboard_build_not_in_ci` — `next build` not in CI; must run locally
- `project_two_register_design` — editorial (--sw-_) vs Mercury (--mercury-_); cockpit is editorial
- `reference_deploy_host_vercel` — Vercel-hosted dashboard; `NEXT_PUBLIC_*` flags need env update + fresh build
