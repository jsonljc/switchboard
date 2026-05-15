# Alex Cockpit A.5 — Composer + Command Palette (Slice Brief)

**Date:** 2026-05-15
**Parent spec:** [Alex Cockpit Home — Design Spec](../specs/2026-05-14-alex-cockpit-home-design.md) (§Implementation slices §A.5, §Composer)
**Predecessor slices:**
- A.1 — `feat(cockpit): A.1 shell + basic Alex composition` (shipped)
- A.2 — `feat(cockpit): A.2 mission popover + Day-1 narrator + setup checklist` (#485, squash `67eb0618`)
- A.3 — `feat(cockpit): A.3 — KPI strip + ROI bar on /alex` (#500, squash `ed54c4a8`)
- A.4 — `feat(cockpit): A.4 — activity richness + thread previews` (#529, squash `c3ee595d`)

---

## Why A.5 lands now

A.4 closed Phase A's data-plane work. The cockpit now renders identity + mission popover + KPI strip + ROI bar + approval block + activity stream with full expansion/preview affordances. **Only the input surface remains inert.** The composer at the bottom of `/alex` is the A.1 `ComposerPlaceholder` — a dimmed "Tell Alex what to do — coming soon" bar that accepts no input. The Topbar's "Tell Alex…" button renders disabled with `paletteEnabled={false}` (verified at `apps/dashboard/src/components/cockpit/cockpit-page.tsx:94` + `apps/dashboard/src/components/cockpit/topbar.tsx:17`). Operators have nothing to type into.

The umbrella spec calls this out as A.5 explicitly:

> **A.5 — Composer + command palette**
> **Ships:** `parse-command.ts` (TypeScript port of `commands.jsx:7`), `command-palette.tsx`, `composer.tsx` with staging + Confirm/Undo, `⌘K` keyboard shortcut, Alex command catalog, pause/resume/halt wired to local `HaltProvider`, settings/contact deep links for rule/handoff/context commands, stubbed `brief` / `followup`, `toastVoice` voice for action confirmations.
> — `docs/superpowers/specs/2026-05-14-alex-cockpit-home-design.md:79-81`

A.5 is the **last feature slice** in Phase A. A.6 is retirement-only (deletes legacy `agent-home-client.tsx` + `*-block.tsx` files); it does not add any new surface. After A.5 the Alex cockpit has every input + output affordance the locked design calls for.

### Downstream consumers

- **Riley B.3-followup** — Riley already ships `RILEY_COMMANDS` as a typed catalog (B.3 → #507/`3b59e4cc`, exported from `apps/dashboard/src/lib/cockpit/riley/riley-config.ts:61-69`) but has no `<CommandPalette>` to plug into. A.5 ships the palette as an **agent-agnostic** component so Riley B.3-followup is a small wiring PR: import `RILEY_COMMANDS` into `RileyCockpitPage`, build a Riley-side dispatcher hook, set `Topbar.paletteEnabled={true}`. **A.5 locks the `<CommandPalette>` props contract** below so Riley does not re-derive shape or behavior.
- **Riley `<Composer>` adoption** — Riley currently renders `<ComposerPlaceholder>` (the inert A.1 bar) and B.3-followup may or may not adopt the new `<Composer>` at that time. A.5 writes `<Composer>` to be agent-agnostic at the prop level (it takes `placeholder`, `commands`, `toastVoice`, `commandIdHandler?` props — no Alex hard-coding) so Riley adoption is one prop-set away.
- **A.6 (retirement)** — Independent. A.6 deletes legacy block components and their hooks; A.5 does not touch any of those files.

### Out-of-band: `<ComposerPlaceholder>` stays

`<ComposerPlaceholder>` is **not deleted** by A.5. Riley's `RileyCockpitPage` (`apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx`) continues to render it until Riley B.3-followup decides whether to adopt the new `<Composer>` or ship its own variant. The Alex cockpit page swaps its `<ComposerPlaceholder>` call site for `<Composer>`. No file deletion this slice.

---

## Slice goal

Operators on `/alex` can:
- Type free-form instructions ("pause Alex for 1h", "follow up with Maya tonight") into a composer at the bottom of the cockpit; the composer stages a parsed-action chip preview as they type and confirms on Enter.
- Press `⌘K` to open a command palette anchored to the Topbar's "Tell Alex…" button; the palette lists every command in `ALEX_COMMANDS`, filterable by typing.
- Have `pause` / `resume` / `halt` actions flip the local `HaltProvider.halted` state immediately, with a toast confirmation written in Alex's voice (`toastVoice(action)` port).
- Have `rule` / `handoff` / `context` actions route to `/settings?focus=rules` / `/contacts/[id]?takeover=true` / `/contacts/[id]?note=open` deep links, with the same toast confirmation.
- See `brief` / `followup` actions stub-confirmed via toast — no cron, no delivery, no persistence (deliberately deferred).

Composer voice is locked: `toastVoice` describes **what Alex did with the operator's instruction**, never causal claims (e.g. "Paused — standing by." not "Saved you from a misfire."). The locked design's honest-impact-language guardrail from A.2/A.3/A.4 carries over.

---

## What ships

### Catalog + parser data (no schema, no backend)

A.5 ships **no Zod schemas**, **no Prisma migration**, **no API route**. Commands are an in-memory UI catalog; the NL parser is a pure function. The full slice lives entirely under `apps/dashboard/src/`.

| Path | Change | Why touched |
|---|---|---|
| `apps/dashboard/src/lib/cockpit/parse-command.ts` | **New.** `parseCommand(raw: string): ParsedAction` — TypeScript port of `commands.jsx:7`. Pattern matchers per umbrella spec §Composer §NL parsing rules (lines 670-685): `pause N (m\|h)`, `pause until <when>`, `pause`, `resume`/`unpause`/`go`, `halt`/`stop`, `(fu\|follow up) <name> [<when>]`, `brief (me) (at) <time>`, `(stop\|don't) (offer\|send) <thing>`, `(reply to\|i'll reply to\|let me reply to) <name>`, `tell alex about <name>`, else `instruction` fallback. Returns `{ kind, icon, label, detail, raw }`. Pure function, no side effects. | NL parsing. |
| `apps/dashboard/src/lib/cockpit/parse-command.test.ts` | **New.** One case per pattern (10 cases) + 3 boundary cases (empty string → `instruction` with truncated detail; multi-line input → first non-empty line; mixed case `PAUSE` matches). | Coverage. |
| `apps/dashboard/src/lib/cockpit/alex-commands.ts` | **New.** Exports `ALEX_COMMANDS: readonly Command[]` per umbrella spec §Composer §Alex's contributions (lines 650-665). 14 entries across 4 groups: `control` (5), `thread` (3, dynamic), `rules` (2), `nav` (3). Also exports `ALEX_COMPOSER_PLACEHOLDER = 'Tell Alex what to do — "pause an hour", "follow up with Maya tonight"…'`. | Catalog. |
| `apps/dashboard/src/lib/cockpit/__tests__/alex-commands.test.ts` | **New.** Length + group-coverage assertion. | Coverage. |
| `apps/dashboard/src/lib/cockpit/alex-toast-voice.ts` | **New.** `toastVoice(action: ParsedAction): { title: string; description?: string }` — TypeScript port of `alex-config.jsx:41`. Returns shadcn-compatible toast payload per action.kind. Includes a `description` only for `instruction` (echoing the raw input ≤60 chars). | Voice port. |
| `apps/dashboard/src/lib/cockpit/alex-toast-voice.test.ts` | **New.** One case per `action.kind` (10 cases) asserting title + description shape. | Coverage. |
| `apps/dashboard/src/lib/cockpit/alex-action-dispatcher.ts` | **New.** `useAlexActionDispatcher(): (action: ParsedAction \| { kind: "command"; commandId: string }, threadContext?: ThreadContext) => void` — React hook that wires the action-kind dispatch table from umbrella spec §Composer §Action dispatch (lines 691-712). Uses `useHalt()`, `useRouter()`, `useToast()`, and the locked `toastVoice` to: flip `HaltProvider.halted` for `pause/resume/halt`; route to settings/contacts for `rule/handoff/context`; toast-only for `brief/followup/instruction`; and apply per-`id` overrides for `command`-group dispatches (`pause-1h` → synthetic `parseCommand("pause for 1h")`; `stop-founder` → `/settings?focus=rules&founderRateEnabled=false`; `raise-rule` → `/settings?focus=rules&priceApprovalThreshold=99`; `open-settings`/`open-rules`/`open-meta` → navigation). | Dispatch glue. |
| `apps/dashboard/src/lib/cockpit/__tests__/alex-action-dispatcher.test.ts` | **New.** Mocked `useHalt`/`useRouter`/`useToast`. Cases: pause flips halt true; resume flips halt false; halt flips halt true; rule routes to `/settings?focus=rules`; handoff routes to `/contacts/[id]?takeover=true` only when `threadContext` carries a `contactId`; context routes to `/contacts/[id]?note=open`; brief toast-only; per-id `pause-1h` flips halt; per-id `stop-founder` routes with query param; per-id `raise-rule` routes with both query params. | Coverage. |

### Shared types

| Path | Change | Why touched |
|---|---|---|
| `apps/dashboard/src/components/cockpit/types.ts` | Add `export type ParsedAction = { kind: ParsedActionKind; icon: string; label: string; detail: string; raw: string }` + `export type ParsedActionKind = "pause" \| "resume" \| "halt" \| "followup" \| "brief" \| "rule" \| "handoff" \| "context" \| "instruction" \| "command"`. Add `export interface Command { id: string; label: string; group: "control" \| "thread" \| "rules" \| "nav" }`. Add `export interface ThreadContext { contactId: string; displayName: string }`. | Shared shapes for Alex + Riley. |

`Command` is the **agent-agnostic shape** that `RileyCommand` (`apps/dashboard/src/lib/cockpit/riley/riley-config.ts:52-56`) already conforms to structurally. Riley B.3-followup swaps `RileyCommand` to a re-export of `Command` in a one-line edit; A.5 does **not** touch `riley-config.ts` because B.3 is already on `main` and the structural compatibility is verified at write-time by the new `<CommandPalette>` consuming both catalogs in test fixtures.

### Components

| Path | Change | Today | After A.5 |
|---|---|---|---|
| `apps/dashboard/src/components/cockpit/command-palette.tsx` | **New.** | n/a | `<CommandPalette open onClose commands onSelect threadContext? placeholder?>` — modal-style palette anchored under the Topbar. Renders a search input + grouped command list (order: `nav` → `rules` → `control` → `thread`). Thread-group commands render disabled when `threadContext` is `undefined`. Up/down arrows move selection; Enter fires `onSelect(command)`; Escape calls `onClose()`. **No agent-specific logic.** |
| `apps/dashboard/src/components/cockpit/__tests__/command-palette.test.tsx` | **New.** | n/a | Renders all groups; type-to-filter narrows visible commands; thread commands disabled when no thread context; arrow-key navigation; Enter fires `onSelect` with the focused command; Escape fires `onClose`. Riley fixture (`RILEY_COMMANDS`) renders identically — agent-agnostic guarantee. |
| `apps/dashboard/src/components/cockpit/composer.tsx` | **New.** | n/a | `<Composer placeholder commands onDispatch toastVoice halted>` — bottom-of-cockpit input. Wraps `<ComposerPlaceholder>`-equivalent layout (same border-top + paper background) but with an active `<input>`. On each keystroke, calls `parseCommand(value)` and renders the parsed-action chip preview (icon + label + detail) inline next to the input. Pressing Enter fires `onDispatch(parsed)` then `toastVoice(parsed)` (toast fires via `useToast` at the call site, hooked via `onDispatch`). Pressing Escape clears the input. When `halted=true`, the input is disabled and displays "Halted — resume to send instructions" (matches A.1 placeholder copy). |
| `apps/dashboard/src/components/cockpit/__tests__/composer.test.tsx` | **New.** | n/a | Renders placeholder; typing "pause" stages chip with kind=pause; Enter fires `onDispatch({ kind: "pause", ... })`; Escape clears input; `halted` disables input and swaps copy; agent-agnostic prop-set (Riley fixture renders without errors). |
| `apps/dashboard/src/components/cockpit/cockpit-page.tsx:8-25,94,135` | Modify. | Imports `ComposerPlaceholder`; passes `paletteEnabled={false}` to Topbar; renders `<ComposerPlaceholder halted={...}>`. | Imports `Composer` + `CommandPalette` + `useAlexActionDispatcher` + `ALEX_COMMANDS` + `ALEX_COMPOSER_PLACEHOLDER` + `toastVoice`. Adds `paletteOpen` state via `useState<boolean>(false)`. Adds keyboard-shortcut effect listening for `⌘K` / `Ctrl+K` (page-scoped — listener mounts on `CockpitPage` mount only, unmounts on unmount, no global registration). Passes `paletteEnabled={true} onOpenPalette={() => setPaletteOpen(true)}` to Topbar. Renders `<CommandPalette open={paletteOpen} onClose={...} commands={ALEX_COMMANDS} onSelect={(cmd) => dispatch({ kind: "command", commandId: cmd.id }, threadCtx)} threadContext={...} />`. Renders `<Composer placeholder={ALEX_COMPOSER_PLACEHOLDER} commands={ALEX_COMMANDS} onDispatch={(action) => { dispatch(action); }} toastVoice={toastVoice} halted={haltCtx.halted} />` in place of `<ComposerPlaceholder>`. |
| `apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx` | Extend. | Existing A.4 cases. | New cases: ⌘K opens palette; palette `onClose` clears `paletteOpen`; Topbar's "Tell Alex…" button click opens palette; selecting a command from palette fires the dispatcher; halted state disables composer input. |

### Files explicitly NOT modified

- `apps/dashboard/src/components/cockpit/composer-placeholder.tsx` — kept; Riley still renders it. A.5 does not touch its tests.
- `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx` — Riley B.3-followup does the Riley-side wiring; A.5 ships the shared `<CommandPalette>` only.
- `apps/dashboard/src/lib/cockpit/riley/riley-config.ts` — `RILEY_COMMANDS` is already on `main` and structurally compatible with the new `Command` type; Riley B.3-followup will optionally one-line-re-export `Command` from cockpit/types, but A.5 doesn't force the rename.
- `apps/dashboard/src/components/cockpit/topbar.tsx` — already accepts `paletteEnabled` + `onOpenPalette`; no edit. CockpitPage flips the flag.
- `apps/dashboard/src/components/layout/halt/halt-context.tsx` — `HaltProvider` already exposes `setHalted` + `toggleHalt`; A.5 calls them but does not modify the provider.
- `packages/schemas/**` — no wire-shape changes. Commands are UI catalog data only.
- `packages/core/**`, `packages/db/**`, `apps/api/**` — surface-agnostic backend layers are untouched. A.5 is dashboard-only.
- `packages/db/prisma/schema.prisma` — no migration.

### Tests added (summary)

| File | Cases |
|---|---|
| `apps/dashboard/src/lib/cockpit/__tests__/parse-command.test.ts` | One case per NL pattern (10) + empty-string fallback + multi-line input + case-insensitive match (3 boundary). |
| `apps/dashboard/src/lib/cockpit/__tests__/alex-commands.test.ts` | Length = 14; one entry per documented `id`; group coverage (nav: 3, rules: 2, control: 5, thread: 3, plus brief commands in control). |
| `apps/dashboard/src/lib/cockpit/__tests__/alex-toast-voice.test.ts` | One case per `action.kind` (10) asserting title text + description presence. |
| `apps/dashboard/src/lib/cockpit/__tests__/alex-action-dispatcher.test.ts` | Pause/resume/halt flip halt; rule/handoff/context route; brief/followup/instruction toast-only; per-id `pause-1h` / `stop-founder` / `raise-rule` / `open-settings` / `open-rules` / `open-meta`. |
| `apps/dashboard/src/components/cockpit/__tests__/command-palette.test.tsx` | All groups render in order; type-to-filter; thread commands disabled without context; arrow nav; Enter selects; Escape closes; agent-agnostic (Riley fixture). |
| `apps/dashboard/src/components/cockpit/__tests__/composer.test.tsx` | Placeholder render; chip preview on keystroke; Enter dispatches; Escape clears; halted disables; agent-agnostic. |
| `apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx` | ⌘K opens palette; Topbar click opens palette; close clears state; command selection fires dispatcher; halted disables composer. |

---

## What does NOT ship at A.5

Explicit non-goals — deferred to a later slice or out of Phase A entirely:

- ❌ **Backend wiring for `brief`.** Per umbrella spec §Composer §Action dispatch (line 697): "Stub: records intent locally, toasts. Scheduled-brief delivery is post-v1 (no cron yet)." A.5 ships the toast confirmation only.
- ❌ **Backend wiring for `followup`.** Per umbrella spec §Composer §Action dispatch (line 701): "Stub: records intent; toast. Scheduled follow-ups land alongside `brief` cron." Same as brief.
- ❌ **Backend wiring for `instruction`.** Per umbrella spec §Composer §Action dispatch (line 703): no backend. The composer toasts `"Got it. Acting on \"{detail}\"."` but no API call.
- ❌ **Inline-send for `handoff` / `context` actions.** They route to `/contacts/[id]?takeover=true` and `/contacts/[id]?note=open` respectively — the route handler at `/contacts/[id]` already accepts these query params (A.4 verified this for `takeover=true`). A.5 ships the deep link, not an inline-mutation call.
- ❌ **Brief / followup persistence.** No `Brief` or `Followup` table, no `AgentRoster.config.scheduledBriefs` field, no Inngest job. The composer treats both as toast-only intents until a follow-up slice ships cron + delivery.
- ❌ **Per-id thread-group command resolution.** `fu-named` / `reply-named` / `hold-named` are dynamic per umbrella spec §Composer §Action dispatch (line 712): "only enabled when there is an open thread context (e.g. an expanded activity row); the palette filters them out otherwise." A.5 ships the palette's disable behavior; the `threadContext` source from an expanded activity row is a **separate ramp** — at A.5, `threadContext` is always `undefined` (the page never wires an active thread). Riley B.3-followup or a post-Phase-A slice owns the wire-through.
- ❌ **Voice variations beyond `alex-config.jsx:41`.** `toastVoice` is a verbatim port. No new copy variants, no per-org tuning. Modes-not-knobs guardrail (`feedback_modes_not_knobs.md`) applies.
- ❌ **Composer history / multi-line / autocomplete.** Single-line input, no history recall, no autocomplete. Typing stages a parsed chip; Enter confirms; Escape clears. That is the entire UX.
- ❌ **Undo on the toast.** "Confirm/Undo" in the umbrella spec refers to the stage-then-Enter flow (Escape during staging = undo before commit). After Enter fires, the toast is informational. Reversal for `pause`/`resume` is a second user-typed action; reversal for navigation actions is not meaningful (route already pushed). A toast-level "Undo" button is out of scope.
- ❌ **Riley wiring (B.3-followup).** A.5 ships the agent-agnostic palette + composer. Riley B.3-followup imports `RILEY_COMMANDS` into Riley's `<CommandPalette>` call site, builds `useRileyActionDispatcher`, and flips `Topbar.paletteEnabled={true}` on `/riley`. Out of scope for A.5.
- ❌ **Composer adoption on Riley.** Riley keeps `<ComposerPlaceholder>` until B.3-followup explicitly opts in (or ships its own composer variant). A.5 does not force Riley adoption.
- ❌ **A.6 retirement work.** A.5 does not delete `agent-home-client.tsx` or `*-block.tsx`. A.6 is the cleanup slice.
- ❌ **`TALKING` status pill wiring.** Per umbrella spec §Status pill — `TALKING` (live-conversation truth) is deferred to a post-Phase-A slice with clean backend signals. A.5 only respects the existing `HALTED` state for composer disable copy.
- ❌ **Composer placeholder copy per-org.** The placeholder is the locked-design verbatim string (`ALEX_COMPOSER_PLACEHOLDER`). No per-org template, no rotation, no A/B variants.
- ❌ **Schema changes.** No Prisma migration. No new Zod schemas. Commands are UI catalog data.

---

## Adapter-boundary invariant

The shared invariant from A.1/A.2/A.3/A.4 and Riley B.1/B.3 continues to hold:

> Cockpit UI consumes view-models only. Only files under `apps/dashboard/src/lib/cockpit/**` may import `Recommendation` / `AuditEntry` / `@switchboard/db` / `@prisma` / `@switchboard/schemas/{recommendations,audit}`.

A.5 adds **zero** new imports of those types to `components/cockpit/**` or `hooks/use-agent-*`. The new `useAlexActionDispatcher` hook lives in `apps/dashboard/src/lib/cockpit/` (the permitted side of the boundary) and consumes only `useHalt` (context), `useRouter` (Next.js), and `useToast` (shadcn) — no audit-domain imports. The composer + palette are pure presentation components.

Pre-merge grep gate (same as A.4):

```bash
rg "Recommendation|AuditEntry|@switchboard/db|@prisma" \
   apps/dashboard/src/components/cockpit \
   apps/dashboard/src/hooks
```

Expected: same set of matches as `main` before A.5 — no new matches.

### Surface-agnostic backend invariant

Per `feedback_surface_agnostic_backend.md`: core/schemas/db must not reference UI surfaces. A.5 is **dashboard-only** — no edits to `packages/**`. Trivially clean.

---

## Dependencies

- ✅ A.1 merged — `<ComposerPlaceholder>` + `<Topbar paletteEnabled>` shells live; the `paletteEnabled` prop wiring is in place for A.5 to flip.
- ✅ A.2 merged (#485, `67eb0618`) — `<EmptyState>` cold-state branching unchanged by A.5. Composer is rendered in both cold-state and steady-state at A.5 (per umbrella spec §Day-1 empty state: "Composer remains enabled during cold state; contextual suggestion chips are empty.").
- ✅ A.3 merged (#500, `ed54c4a8`) — no shared surface.
- ✅ A.4 merged (#529, `c3ee595d`) — no shared surface. Activity-row expansion is independent.
- ✅ Riley B.3 merged (#507, `3b59e4cc`) — `RILEY_COMMANDS` already on `main`; the structural compatibility check happens at write-time in `command-palette.test.tsx` (Riley fixture).
- ✅ `HaltProvider` (`apps/dashboard/src/components/layout/halt/halt-context.tsx`) — exposes `setHalted` + `toggleHalt`; ready.
- ✅ `useToast` (`apps/dashboard/src/components/ui/use-toast.ts`) — shadcn pattern; A.5 calls `toast({ title, description })` matching the existing caller convention (verified at `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx:imports`).
- ❌ A.6 — does **not** depend on A.5 except that A.6 runs after Alex cockpit is stable in production through A.5. A.5 ships the input affordance; A.6 deletes legacy blocks.
- ❌ Riley B.3-followup — depends on A.5 (waits for the shared `<CommandPalette>` to merge).
- ❌ Source-of-truth design files (`cockpit.jsx`, `commands.jsx:7`, `alex-config.jsx:41`) — the umbrella spec already captures the locked snippets verbatim (§Composer lines 644-718). A.5 implements against the spec; the locked-design tarball is not a precondition.

---

## Design decisions ratified by this slice

These are the open questions the slice brief locks before implementation begins. Each decision is recorded with its reasoning so the executor doesn't re-litigate.

1. **NL parser is a verbatim port of `commands.jsx:7`.** No simplification. Every pattern in the umbrella spec §Composer §NL parsing rules table (lines 670-685) lands in `parse-command.ts`. Diverging from the locked design here would require a spec amendment, not a plan deviation.

2. **`<CommandPalette>` is agent-agnostic.** Props: `{ open, onClose, commands, onSelect, threadContext?, placeholder? }`. **No** Alex-specific logic inside the component. Riley B.3-followup consumes the same component by passing `commands={RILEY_COMMANDS}` + a Riley-side `onSelect` handler. The test suite asserts agent-agnostic by including a Riley fixture rendering case.

3. **`<Composer>` is agent-agnostic at the prop layer.** Props: `{ placeholder, commands, onDispatch, toastVoice, halted }`. The Composer does not call `useHalt` directly — the `halted` value is passed in, so the component can be rendered in tests without `<HaltProvider>`. Toast firing happens via the page-level dispatch (`onDispatch`'s implementation calls `useToast` + `toastVoice`).

4. **Action-dispatch glue lives in a Dashboard hook, not in the Composer.** `useAlexActionDispatcher()` is the Alex-specific dispatcher: it owns the action.kind → side-effect mapping, the per-id overrides for `command` group, and the toast firing. The Composer remains agent-agnostic by delegating dispatch to its `onDispatch` prop. Riley B.3-followup will ship `useRileyActionDispatcher()` with its own mapping; the Composer + Palette do not change.

5. **⌘K binding is page-scoped, not shell-scoped.** The keyboard listener mounts in `CockpitPage` via `useEffect`, attached to `document.addEventListener("keydown", ...)`, and unmounts on `CockpitPage` unmount. There is no global keymap registry. Conflict avoidance: the listener checks `event.metaKey || event.ctrlKey` + `event.key === "k"`, calls `event.preventDefault()`, and toggles `paletteOpen`. The browser's native ⌘K (focus URL bar) is preempted only while `/alex` is the active page. **Verification:** the cockpit-page test asserts the listener is removed on unmount.

6. **Confirm/Undo is staging-driven, not toast-driven.** Typing into the composer stages a parsed-action chip; Escape during staging undoes (clears input). After Enter fires, the action is committed — no in-toast Undo button. This matches the umbrella spec's wording "staging + Confirm/Undo flow" without inventing new UI. Reversal of pause/resume happens by the operator typing the opposite command.

7. **Composer placeholder is config-driven, not hardcoded.** `ALEX_COMPOSER_PLACEHOLDER` is exported from `apps/dashboard/src/lib/cockpit/alex-commands.ts` (a single Alex-config module shared with `ALEX_COMMANDS`). Riley already exports `RILEY_COMPOSER_PLACEHOLDER` from `apps/dashboard/src/lib/cockpit/riley/riley-config.ts:49-50` — structurally compatible.

8. **`toastVoice` returns the shadcn-compatible `{ title, description? }` shape.** Matches the existing caller convention at `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx` (imports `useToast` from `@/components/ui/use-toast`). The dispatcher hook calls `const { toast } = useToast(); ... toast(toastVoice(action))`.

9. **`Command` type lives in `apps/dashboard/src/components/cockpit/types.ts`.** Not in `@switchboard/schemas` — commands are never serialized over the wire. They are UI catalog data, dashboard-private. Riley's `RileyCommand` already conforms structurally and stays in `riley-config.ts` for backward compat; Riley B.3-followup may optionally re-export from `types.ts`.

10. **`ParsedAction` discriminated union lives in `types.ts`.** Same reasoning: dashboard-private, never wire-serialized.

11. **No schema additions.** Confirmed in the user prompt and ratified by the file list: zero edits under `packages/schemas/`, zero edits under `packages/db/prisma/`.

12. **`brief` and `followup` are toast-only stubs.** No `Brief` table, no `Followup` table, no Inngest job. The composer dispatches → toast → done. A future post-Phase-A slice will add cron + delivery without changing the composer's call site (the dispatcher's `case "brief":` and `case "followup":` arms swap from toast-only to API-call-then-toast).

13. **Per-id overrides for `command` group are hardcoded in the dispatcher.** `pause-1h` → `parseCommand("pause for 1h")`; `pause-3pm` → `parseCommand("pause until 3pm")`; `resume` → `parseCommand("resume")`; `halt` → `parseCommand("halt")`; `brief-noon`/`brief-eod` → stub + toast; `stop-founder` → `/settings?focus=rules&founderRateEnabled=false`; `raise-rule` → `/settings?focus=rules&priceApprovalThreshold=99`; `open-settings` → `/settings`; `open-rules` → `/settings?focus=rules`; `open-meta` → `/settings?focus=channels`. Each override is unit-tested in `alex-action-dispatcher.test.ts`.

14. **No backend route, no API change.** A.5 is dashboard-only. The pre-merge gate `rg "apps/dashboard|@/components|@/hooks" packages/` returns the same matches as `main` — trivially.

---

## Risks specific to A.5

1. **Regex correctness on the NL parser port.** `commands.jsx:7` is JavaScript; TypeScript port must reproduce every pattern verbatim. **Mitigation:** the parser test ships one case per pattern with input strings drawn from the umbrella spec's NL-parsing-rules table (lines 670-685). Boundary cases (empty string, multi-line, case-insensitive) ship explicit cases.

2. **⌘K conflict on macOS Safari / Chrome.** Browsers reserve ⌘K for the URL bar (Chrome on macOS) or "search the web" (Safari). **Mitigation:** the page-scoped listener calls `event.preventDefault()` and `event.stopPropagation()`. The behavior is identical to existing apps (Linear, Notion) — operators expect ⌘K to open in-app palettes. Test asserts the `preventDefault` call.

3. **`HaltProvider.setHalted(true)` for `pause N (min|h)` does not auto-resume.** The locked design specifies `"pause for 1h"` as "Pause Alex for 1 hour" — but `HaltProvider` has no scheduled-resume. **Mitigation:** the dispatcher does **not** ship auto-resume in A.5. The toast confirmation explicitly reads "Paused — resume to send instructions." The auto-resume timer is a post-Phase-A enhancement that requires a `pausedUntil` field on `HaltProvider`. A.5's `pause-Nh` action is functionally identical to `pause` until that enhancement lands. **This is a documented divergence from the locked-design copy** ("Pause Alex for 1 hour" implies auto-resume); operators see the labeled command but the resume is manual. Flagged here for visibility — if the user wants auto-resume in A.5, the slice expands to also touch `HaltProvider`. Default decision: ship without auto-resume.

4. **`useAlexActionDispatcher` calls `useToast` + `useRouter` + `useHalt` — all three must be available in the test render.** **Mitigation:** the dispatcher test wraps with `<HaltProvider>` and mocks `useRouter` + `useToast`. Tests follow the existing pattern at `apps/dashboard/src/app/(auth)/operator/__tests__/proposed-disqualifications-panel.test.tsx` (which mocks `useToast`).

5. **Composer staging chip flicker on rapid typing.** `parseCommand` runs on every keystroke; the staged chip re-renders. **Mitigation:** `parseCommand` is a synchronous pure function; React's batching handles the re-render at 60fps. No debounce needed. Vitest cases assert the chip renders deterministically.

6. **Thread-context wire-through for `fu-named` / `reply-named` / `hold-named`.** These commands need an `open thread` to be meaningful. **Mitigation:** A.5 ships `threadContext?: ThreadContext` on `<CommandPalette>` and `<Composer>`; both default `threadContext` to `undefined` at the CockpitPage call site (no wiring at A.5). The palette filters thread-group commands as disabled when `threadContext` is missing. The wire-through from an expanded activity row to the composer is a separate post-Phase-A ramp — explicit non-goal.

7. **`brief` / `followup` toast-only behavior may confuse operators.** They type "brief me at noon", see a confirmation toast, but no actual scheduled brief lands. **Mitigation:** the toast copy is locked to communicate honestly — `toastVoice({ kind: "brief", ... })` returns `{ title: "Noted — brief stub.", description: "I'll surface this when scheduled briefs ship." }`. The copy is reviewed in the toast-voice test.

8. **`<Composer>` accidentally re-renders the entire `<CockpitPage>` on each keystroke.** Composer owns its input value via `useState`; CockpitPage does not re-render unless `paletteOpen` or `haltCtx.halted` changes. **Mitigation:** the Composer is a leaf component; cockpit-page test asserts no extra render of sibling blocks on composer input changes (via `vi.fn()` mock of e.g. `<ApprovalBlock>`).

9. **Composer disable when `halted=true` collides with Topbar palette.** When `halted=true`, the Composer is disabled but the Topbar "Tell Alex…" button + ⌘K still open the palette. **Decision:** keep the palette open-able even when halted — the operator may want to issue a `resume` command from the palette. The palette's selected commands dispatch through `useAlexActionDispatcher`, which respects `halted` only for the input-disable UX, not for the command dispatch. `resume` from the palette flips halt false regardless of current state. **Mitigation:** the dispatcher test ships a case asserting `resume` works even when `halted=true`.

10. **Toast voice port from JavaScript.** `alex-config.jsx:41` is the locked source. The TypeScript port must produce identical strings. **Mitigation:** the test ships one case per `action.kind` with the expected `title` + `description` strings as locked-design fixtures.

---

## Test contract

- **Library tests** (Vitest, `apps/dashboard`): parser, command catalog, toast voice, dispatcher hook.
- **Component tests** (Vitest + Testing Library): `<CommandPalette>`, `<Composer>`, `<CockpitPage>`.
- **Pre-merge grep gate:** no new `Recommendation|AuditEntry|@switchboard/db|@prisma` imports under `components/cockpit/**` or `hooks/use-agent-*`. A.5 adds no dashboard hook files (the dispatcher lives under `lib/cockpit/`, not `hooks/`).
- **Surface-agnostic backend grep gate:** no edits under `packages/**`. Trivially clean.
- **Build gate:** `pnpm --filter @switchboard/dashboard build` clean (per `feedback_dashboard_build_not_in_ci.md`).
- **Format gate:** `pnpm format:check` clean (per `feedback_ci_prettier_not_in_local_lint.md` — CI catches prettier drift that `pnpm lint` misses; run before pushing).
- **Manual verification:** dev stack running on :3002; load `/alex`; type "pause for 1h" → see staged chip → press Enter → see halt-state pill flip + toast; press ⌘K → palette opens → arrow-select `Resume Alex` → Enter → halt-state flips back + toast. Halted state shows disabled composer copy "Halted — resume to send instructions."

- `pnpm typecheck`, `pnpm lint`, `pnpm test --filter @switchboard/dashboard`, `pnpm --filter @switchboard/dashboard build`, `pnpm format:check` — all clean.

---

## What comes after A.5

- **A.6 — Retirement + cleanup.** Deletes `agent-home-client.tsx` + `*-block.tsx` (greeting/needs-you/wins/metrics/pipeline) + `legacy-shapes.ts` + `use-agent-activity.ts` + `activity-kind-map.ts` after zero-reference verification. A.6 unblocks the deletion of `/[agentKey]` legacy-branch composition. Independent of A.5.
- **Riley B.3-followup.** Imports `RILEY_COMMANDS` into Riley's `<CommandPalette>` call site, ships `useRileyActionDispatcher`, flips `Topbar.paletteEnabled={true}` on `/riley`. One-PR effort; unblocked by A.5.
- **Composer adoption on Riley** — Riley may swap `<ComposerPlaceholder>` for `<Composer>` at B.3-followup or in a separate slice. The Composer is agent-agnostic at the prop layer; no re-architecture needed.
- **Thread-context wire-through.** Expand an activity row → composer's `threadContext` populates with the contact → `fu-named` / `reply-named` / `hold-named` palette commands enable. Post-Phase-A ramp.
- **`brief` / `followup` cron + delivery.** Separate slice ships the persistence layer (`Brief` + `Followup` Prisma models) + Inngest jobs + delivery channels. The composer's dispatch arms swap from toast-only to API-call-then-toast.
- **Auto-resume for `pause N (min|h)`.** Adds `pausedUntil` to `HaltProvider` + a setTimeout-or-cron that flips `halted=false` at the scheduled time. Not part of A.5.
- **`TALKING` status pill wiring.** Backend signal cleanup; composer-independent.

---

## Spec-conflict resolution

If anything in this slice brief expands A.5's scope beyond the umbrella spec — new action.kinds, backend wiring for `brief` / `followup`, inline-send for `handoff` / `context`, auto-resume on `pause N (min|h)`, schema additions, Riley wiring — the umbrella spec wins and the conflicting text here is wrong. Resolve in favor of `docs/superpowers/specs/2026-05-14-alex-cockpit-home-design.md` and flag the discrepancy.
