# Alex Cockpit A.5 — Composer + Command Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Alex cockpit's input affordance — a TypeScript NL parser (`apps/dashboard/src/lib/cockpit/parse-command.ts`), the `ALEX_COMMANDS` catalog + `ALEX_COMPOSER_PLACEHOLDER` constant (`apps/dashboard/src/lib/cockpit/alex-commands.ts`), the `toastVoice` port (`apps/dashboard/src/lib/cockpit/alex-toast-voice.ts`), an Alex-side dispatcher hook (`apps/dashboard/src/lib/cockpit/alex-action-dispatcher.ts`), an agent-agnostic `<CommandPalette>` and `<Composer>` (`apps/dashboard/src/components/cockpit/`), shared `Command` / `ParsedAction` / `ThreadContext` types, and the CockpitPage wiring that ⌘K-binds the palette + swaps `<ComposerPlaceholder>` for `<Composer>`. `paletteEnabled` flips from `false` to `true` on the Alex Topbar. Riley keeps `<ComposerPlaceholder>` until B.3-followup.

**Architecture:** **Dashboard-only.** Zero edits under `packages/`, zero new API routes, zero Prisma migrations. The slice introduces five Dashboard-private library modules (parser, catalog, voice, dispatcher, types) + two agent-agnostic components (Palette, Composer) + a single page-level wiring change (CockpitPage). The `<CommandPalette>` + `<Composer>` are written agent-agnostic at the prop layer so Riley B.3-followup re-uses them by swapping `commands`, `placeholder`, and the Alex-side dispatcher for a Riley-side one. The action-dispatch glue (action.kind → side-effect mapping + per-id overrides) lives in `useAlexActionDispatcher` — a thin React hook that wires `useHalt`, `useRouter`, and `useToast` together. No `<HaltProvider>` modification. No backend signal change.

**Tech Stack:** Vitest + React Testing Library (Dashboard tests), TypeScript ESM (extensionless imports in `apps/dashboard/**` per `feedback_dashboard_no_js_on_any_import.md`), Next.js 14 App Router + React 18 (page-scoped ⌘K listener via `useEffect`), shadcn `useToast` + `useRouter` from `next/navigation` (existing patterns at `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx`).

**Parent docs:**

- [`docs/superpowers/plans/2026-05-15-alex-cockpit-a5-slice-brief.md`](./2026-05-15-alex-cockpit-a5-slice-brief.md) — scope, what-ships-vs-defers, risks, design decisions.
- [`docs/superpowers/specs/2026-05-14-alex-cockpit-home-design.md`](../specs/2026-05-14-alex-cockpit-home-design.md) — §A.5 (lines 79-81), §Composer (lines 640-718), §Status pill (authoritative).
- [`docs/superpowers/plans/2026-05-15-alex-cockpit-a4-implementation.md`](./2026-05-15-alex-cockpit-a4-implementation.md) — structural template (A.4 precedent for layered TDD slice).
- [`docs/superpowers/plans/2026-05-15-riley-cockpit-b3-implementation.md`](./2026-05-15-riley-cockpit-b3-implementation.md) — B.3 precedent for typed command catalog (Riley side).

> **The umbrella spec is authoritative.** If anything in this plan expands A.5's scope — new action.kinds, backend wiring for stubs, inline-send for handoff/context, auto-resume on pause-Nh, schema additions, Riley wiring — the spec wins and the conflicting text here is wrong. Resolve in favor of the umbrella spec.

## Boundary locks (read before every task)

These contracts are easy to violate accidentally. Executors must respect them across every task:

1. **The Composer never toasts.** `<Composer>` parses, stages, and calls `onDispatch(parsedAction)`. It does **not** call `useToast`, `toastVoice`, or any other side effect. Toast firing is the dispatcher hook's responsibility. Double-toasting is the failure mode this lock prevents: if both Composer and dispatcher fire on the same Enter press, the operator sees two toasts for one action.
2. **The dispatcher is the only toast owner for composer-action paths.** `useAlexActionDispatcher` calls `useToast` + `toastVoice` inside its switch. Composer, Palette, and CockpitPage never call `useToast` for composer-action paths.
3. **"Confirm/Undo" is staging-driven, NOT toast-driven.** "Confirm" is the operator pressing Enter on a staged chip; "Undo" is the operator pressing Escape during staging (before Enter). After Enter fires, the action is committed — there is **no in-toast Undo button**, no post-dispatch rollback affordance, no `setTimeout` to rewind state. Implementers must not add toast-level Undo regardless of how natural it seems. Reversal of `pause`/`resume` happens by the operator typing the opposite command.
4. **`hold-named` is catalog-visible but inert in A.5.** The command appears in `ALEX_COMMANDS` but `ParsedActionKind` does not include a `hold` variant and the dispatcher does not handle one. Because `threadContext` is always `undefined` at the CockpitPage call site in A.5, `hold-named` is permanently disabled in the palette and never reaches the dispatcher. Do not add a `hold` case to `ParsedActionKind` or the dispatcher in this slice — that is a future thread-context slice's decision.
5. **Palette group order is `control → thread → rules → nav`.** Operational commands lead because the palette's primary job is "tell Alex what to do," not navigation. Nav routes away from the cockpit, so it is last. Do not reorder to alphabetical or insertion-order.

---

## Precondition checks

Run before Task 1.

- [ ] **Step 0a: Confirm worktree, branch, and base.**

```bash
git branch --show-current
git status --short
git log --oneline origin/main..HEAD
```

Expected: branch `feat/alex-cockpit-a5` (implementation branch, not the docs branch). Status clean. Zero commits ahead of `origin/main` at start of implementation. If commits exist, verify they belong to this slice; otherwise stop.

- [ ] **Step 0b: Verify A.4 artifacts exist on `main`.**

```bash
ls apps/dashboard/src/components/cockpit/cockpit-page.tsx \
   apps/dashboard/src/components/cockpit/composer-placeholder.tsx \
   apps/dashboard/src/components/cockpit/topbar.tsx \
   apps/dashboard/src/components/cockpit/types.ts \
   apps/dashboard/src/components/cockpit/activity-row.tsx \
   apps/dashboard/src/components/cockpit/thread-preview.tsx \
   apps/dashboard/src/components/layout/halt/halt-context.tsx \
   apps/dashboard/src/components/ui/use-toast.ts \
   apps/dashboard/src/lib/cockpit/riley/riley-config.ts
```

Expected: all 9 files exist. If any is missing, the A.4 baseline has shifted — stop and investigate.

- [ ] **Step 0c: Verify `paletteEnabled={false}` is still the call site on Alex's CockpitPage.**

```bash
grep -n "paletteEnabled" apps/dashboard/src/components/cockpit/cockpit-page.tsx
grep -n "paletteEnabled" apps/dashboard/src/components/cockpit/topbar.tsx
```

Expected: `cockpit-page.tsx:94` (or thereabouts) shows `<Topbar paletteEnabled={false} />`; `topbar.tsx` declares the prop. A.5 flips the CockpitPage call site to `true`.

- [ ] **Step 0d: Verify `RILEY_COMMANDS` shape on `main`.**

```bash
grep -A8 "RILEY_COMMANDS" apps/dashboard/src/lib/cockpit/riley/riley-config.ts
```

Expected: declared as `readonly RileyCommand[]` with `id: string; label: string; group: "control" | "thread" | "rules" | "nav"`. A.5's new `Command` type in `types.ts` must be structurally identical (verified at write-time in `command-palette.test.tsx` via a Riley fixture render case).

- [ ] **Step 0e: Verify baseline tests pass.**

```bash
pnpm --filter @switchboard/dashboard test -- --run cockpit
```

Expected: all green. Pre-existing dashboard cockpit tests (`composer-placeholder.test.tsx`, `topbar.test.tsx`, `cockpit-page.test.tsx`, plus A.2/A.3/A.4 component tests) must pass on the baseline before A.5 begins.

- [ ] **Step 0f: Verify dev stack builds.**

```bash
pnpm reset
pnpm typecheck
pnpm --filter @switchboard/dashboard build
```

Expected: clean. Per `feedback_dashboard_build_not_in_ci.md`: `next build` is not in CI; run it locally now to confirm the baseline is clean.

---

## File Structure

### Files created

| Path                                                                       | Responsibility                                                                                                                        |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/dashboard/src/lib/cockpit/parse-command.ts`                          | `parseCommand(raw: string): ParsedAction` — verbatim port of `commands.jsx:7`. Pure function.                                         |
| `apps/dashboard/src/lib/cockpit/__tests__/parse-command.test.ts`           | One case per NL pattern + 3 boundary cases.                                                                                           |
| `apps/dashboard/src/lib/cockpit/alex-commands.ts`                          | `ALEX_COMMANDS: readonly Command[]` (14 entries) + `ALEX_COMPOSER_PLACEHOLDER: string`.                                               |
| `apps/dashboard/src/lib/cockpit/__tests__/alex-commands.test.ts`           | Length + group-coverage assertion.                                                                                                    |
| `apps/dashboard/src/lib/cockpit/alex-toast-voice.ts`                       | `toastVoice(action: ParsedAction): { title: string; description?: string }` — verbatim port of `alex-config.jsx:41`.                  |
| `apps/dashboard/src/lib/cockpit/__tests__/alex-toast-voice.test.ts`        | One case per `action.kind` (10) — title + description shape.                                                                          |
| `apps/dashboard/src/lib/cockpit/alex-action-dispatcher.ts`                 | `useAlexActionDispatcher()` React hook — wires `useHalt` + `useRouter` + `useToast` + `toastVoice` into a single dispatcher function. |
| `apps/dashboard/src/lib/cockpit/__tests__/alex-action-dispatcher.test.ts`  | Mocked-hooks coverage for each action.kind + per-id overrides.                                                                        |
| `apps/dashboard/src/components/cockpit/command-palette.tsx`                | Agent-agnostic palette component.                                                                                                     |
| `apps/dashboard/src/components/cockpit/__tests__/command-palette.test.tsx` | Group order, type-to-filter, thread-disable, arrow nav, Enter selects, Escape closes, agent-agnostic.                                 |
| `apps/dashboard/src/components/cockpit/composer.tsx`                       | Agent-agnostic composer with staging chip.                                                                                            |
| `apps/dashboard/src/components/cockpit/__tests__/composer.test.tsx`        | Placeholder render, chip preview, Enter dispatches, Escape clears, halted disables.                                                   |

### Files modified

| Path                                                                    | Change                                                                                                                                                                            | Why touched    |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `apps/dashboard/src/components/cockpit/types.ts`                        | Add `Command`, `ParsedActionKind`, `ParsedAction`, `ThreadContext` exports.                                                                                                       | Shared shapes. |
| `apps/dashboard/src/components/cockpit/cockpit-page.tsx`                | Swap `<ComposerPlaceholder>` for `<Composer>`; flip Topbar `paletteEnabled={true}` + `onOpenPalette`; add `paletteOpen` state; add ⌘K keyboard effect; render `<CommandPalette>`. | Wiring.        |
| `apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx` | Extend with palette + composer + ⌘K cases.                                                                                                                                        | Coverage.      |

### Files explicitly NOT modified

- `apps/dashboard/src/components/cockpit/composer-placeholder.tsx` — Riley still renders it.
- `apps/dashboard/src/components/cockpit/__tests__/composer-placeholder.test.tsx` — unchanged.
- `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx` — Riley B.3-followup owns the Riley side.
- `apps/dashboard/src/components/cockpit/topbar.tsx` — already accepts `paletteEnabled` + `onOpenPalette`; CockpitPage flips the flag.
- `apps/dashboard/src/lib/cockpit/riley/riley-config.ts` — `RILEY_COMMANDS` stays; structurally compatible with new `Command` type.
- `apps/dashboard/src/components/layout/halt/halt-context.tsx` — dispatcher calls `setHalted` / `toggleHalt`; no provider change.
- `apps/dashboard/src/components/ui/use-toast.ts` — existing shadcn hook; no change.
- `packages/**` — surface-agnostic backend untouched.
- `apps/api/**`, `apps/chat/**`, `apps/mcp-server/**` — no backend change.
- `packages/db/prisma/schema.prisma` — no migration.

---

## Adapter-boundary invariant (unchanged from A.1–A.4 and Riley B.1/B.3)

A.5 adds **zero** new imports of `Recommendation` / `AuditEntry` / `@switchboard/db` / `@prisma` / `@switchboard/schemas/recommendations` / `@switchboard/schemas/audit` under `apps/dashboard/src/components/cockpit/**` or `apps/dashboard/src/hooks/use-agent-*`. A.5 adds no new files under `apps/dashboard/src/hooks/`. The dispatcher hook lives in `apps/dashboard/src/lib/cockpit/` (the permitted side of the adapter boundary).

Pre-merge grep gate (Task 10):

```bash
rg "Recommendation|AuditEntry|@switchboard/db|@prisma" \
   apps/dashboard/src/components/cockpit \
   apps/dashboard/src/hooks
```

Expected: same set of matches as `main` before A.5 — no new matches.

## Surface-agnostic backend invariant (per `feedback_surface_agnostic_backend.md`)

A.5 makes **no** edits under `packages/**`. Trivially clean.

```bash
git diff origin/main..HEAD -- packages/ | head
```

Expected: empty output.

---

## Locked code references from the umbrella spec

These snippets are the **source of truth** for the implementation. Reproduce verbatim where indicated.

### `ALEX_COMMANDS` catalog (umbrella spec §Composer §Alex's contributions, lines 650-665)

```ts
ALEX_COMPOSER_PLACEHOLDER =
  'Tell Alex what to do — "pause an hour", "follow up with Maya tonight"…';

ALEX_COMMANDS = [
  { id: "pause-1h", label: "Pause Alex for 1 hour", group: "control" },
  { id: "pause-3pm", label: "Pause until 3 PM", group: "control" },
  { id: "resume", label: "Resume Alex", group: "control" },
  { id: "halt", label: "Halt — stop everything", group: "control" },
  { id: "brief-noon", label: "Brief me at noon", group: "control" },
  { id: "brief-eod", label: "Brief me at end of day", group: "control" },
  { id: "fu-named", label: "Follow up with {contact} tonight", group: "thread" },
  { id: "reply-named", label: "Reply to {contact} myself", group: "thread" },
  { id: "hold-named", label: "Hold {contact}, don't send anything", group: "thread" },
  { id: "stop-founder", label: "Stop offering the founder rate", group: "rules" },
  { id: "raise-rule", label: "Raise approval threshold to $99", group: "rules" },
  { id: "open-settings", label: "Open settings", group: "nav" },
  { id: "open-rules", label: "Open standing rules", group: "nav" },
  { id: "open-meta", label: "Open Meta Ads campaigns", group: "nav" },
];
```

### NL parsing rules (umbrella spec §Composer §NL parsing rules, lines 670-685)

| Pattern (case-insensitive on input)                 | Returns                                                                                       |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `pause (for) N (min\|m\|h\|hour\|hours)`            | `{ kind: "pause", icon: "⏸", label: "pause · Nh", detail: "until HH:MM AM" }`                 |
| `pause until <when>`                                | `{ kind: "pause", icon: "⏸", label: "pause", detail: "until <when>" }`                        |
| `pause` / `pause alex`                              | `{ kind: "pause", icon: "⏸", label: "pause", detail: "until you resume" }`                    |
| `resume` / `unpause` / `go`                         | `{ kind: "resume", icon: "▶", label: "resume", detail: "pick up where I left off" }`          |
| `halt` / `stop`                                     | `{ kind: "halt", icon: "⏹", label: "halt", detail: "stop everything now" }`                   |
| `(fu\|follow up) (with) <name> [<when>]`            | `{ kind: "followup", icon: "↻", label: "follow up · Name", detail: "today" }`                 |
| `brief (me) (at) <time>`                            | `{ kind: "brief", icon: "☼", label: "brief me", detail: "at <time>" }`                        |
| `(stop\|don't) (offer(ing)\|sending) <thing>`       | `{ kind: "rule", icon: "⊘", label: "rule change", detail: "stop offering <thing>" }`          |
| `(reply to\|i'll reply to\|let me reply to) <name>` | `{ kind: "handoff", icon: "✎", label: "handoff · Name", detail: "you take the thread" }`      |
| `tell alex about <name>`                            | `{ kind: "context", icon: "ⓘ", label: "context · Name", detail: "add a note to the thread" }` |
| anything else                                       | `{ kind: "instruction", icon: "→", label: "instruction", detail: "<truncated to 60>" }`       |

Every returned `ParsedAction` also carries the original `raw: string` field for downstream toast echo.

### Action dispatch (umbrella spec §Composer §Action dispatch, lines 691-712)

| `action.kind` | v1 behavior                                                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `pause`       | `HaltProvider.setHalted(true)`; toast `"Paused — …"`                                                                                |
| `resume`      | `HaltProvider.setHalted(false)`; toast                                                                                              |
| `halt`        | `HaltProvider.setHalted(true)` (no auto-resume); toast                                                                              |
| `brief`       | Stub: toast only. Cron-side delivery deferred.                                                                                      |
| `rule`        | `router.push("/settings?focus=rules")`; toast                                                                                       |
| `handoff`     | `router.push("/contacts/[id]?takeover=true")` when `threadContext.contactId` set; else toast-only fallback `"Open a thread first."` |
| `context`     | `router.push("/contacts/[id]?note=open")` when `threadContext.contactId` set; else toast-only fallback                              |
| `followup`    | Stub: toast only. Cron deferred.                                                                                                    |
| `command`     | Per-id dispatch (see below).                                                                                                        |
| `instruction` | Toast only: `"Got it. Acting on \"{detail}\"."` No backend.                                                                         |

Per-id overrides for `command` group:

| `command.id`               | Dispatch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pause-1h`                 | `dispatch(parseCommand("pause for 1h"))`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `pause-3pm`                | `dispatch(parseCommand("pause until 3pm"))`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `resume`                   | `dispatch(parseCommand("resume"))`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `halt`                     | `dispatch(parseCommand("halt"))`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `brief-noon` / `brief-eod` | Stub + toast (matches `brief` action.kind)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `stop-founder`             | `router.push("/settings?focus=rules&founderRateEnabled=false")`                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `raise-rule`               | `router.push("/settings?focus=rules&priceApprovalThreshold=99")`                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `open-settings`            | `router.push("/settings")`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `open-rules`               | `router.push("/settings?focus=rules")`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `open-meta`                | `router.push("/settings?focus=channels")`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `fu-named` / `reply-named` | Disabled in palette when `threadContext` is undefined; when defined, dispatches via the matching action.kind (`followup` / `handoff`). At A.5, **always** undefined at the CockpitPage call site, so these never fire.                                                                                                                                                                                                                                                                                                         |
| `hold-named`               | Disabled in palette when `threadContext` is undefined. **No corresponding `ParsedActionKind` exists** — `ParsedActionKind` declares no `hold` variant in A.5. Because `threadContext` is always undefined at the A.5 call site, the command is permanently disabled and never reaches the dispatcher. A future thread-context slice owns the choice to add `hold` to `ParsedActionKind` + dispatch table, or remove the command from `ALEX_COMMANDS`. A.5 does neither. The palette test asserts the command renders disabled. |

### Toast voice (umbrella spec §Composer §Toast voice + `alex-config.jsx:41`)

| `action.kind` | Returned `{ title, description? }`                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| `pause`       | `{ title: "Paused — standing by.", description: action.detail }`                                       |
| `resume`      | `{ title: "Resumed — picking up where I left off." }`                                                  |
| `halt`        | `{ title: "Halted — stopped everything." }`                                                            |
| `brief`       | `{ title: "Noted — brief stub.", description: "I'll surface this when scheduled briefs ship." }`       |
| `rule`        | `{ title: "Opening rules.", description: action.detail }`                                              |
| `handoff`     | `{ title: \`Handing \${action.label.replace("handoff · ", "")} to you.\` }`                            |
| `context`     | `{ title: \`Got context on \${action.label.replace("context · ", "")}.\` }`                            |
| `followup`    | `{ title: "Noted — followup stub.", description: "I'll surface this when scheduled followups ship." }` |
| `instruction` | `{ title: "Got it.", description: \`Acting on "\${action.detail}".\` }`                                |
| `command`     | `{ title: \`On it — \${action.label}.\` }` (covers any unmatched palette dispatch)                     |

All copy is honest-impact-language compliant: describes what Alex did, never causal claims.

---

## Tasks

### Task 1: Add shared types to `cockpit/types.ts`

**Files:**

- Modify: `apps/dashboard/src/components/cockpit/types.ts`

- [ ] **Step 1: Append the new types to `types.ts`.**

Add these declarations at the bottom of the file (after `CockpitKpiData`, line ~127):

```ts
// ─── A.5 Composer + Command Palette ───────────────────────────

export type ParsedActionKind =
  | "pause"
  | "resume"
  | "halt"
  | "followup"
  | "brief"
  | "rule"
  | "handoff"
  | "context"
  | "instruction"
  | "command";

export interface ParsedAction {
  kind: ParsedActionKind;
  icon: string;
  label: string;
  detail: string;
  raw: string;
  /** Optional `command` id when the action originated from the palette. */
  commandId?: string;
}

export type CommandGroup = "control" | "thread" | "rules" | "nav";

export interface Command {
  id: string;
  label: string;
  group: CommandGroup;
}

export interface ThreadContext {
  contactId: string;
  displayName: string;
}
```

- [ ] **Step 2: Commit.**

```
feat(cockpit): A.5 — shared Command / ParsedAction / ThreadContext types

Adds the agent-agnostic shapes the composer + palette consume. RileyCommand
already conforms structurally; Riley B.3-followup may optionally re-export
Command from this module in a one-line follow-up.
```

---

### Task 2: Port `parseCommand` from JavaScript to TypeScript

**Files:**

- Create: `apps/dashboard/src/lib/cockpit/parse-command.ts`
- Create: `apps/dashboard/src/lib/cockpit/__tests__/parse-command.test.ts`

- [ ] **Step 1: Write the failing test.**

Create `apps/dashboard/src/lib/cockpit/__tests__/parse-command.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseCommand } from "../parse-command";

describe("parseCommand", () => {
  it("pause for N hours", () => {
    const r = parseCommand("pause for 2h");
    expect(r.kind).toBe("pause");
    expect(r.icon).toBe("⏸");
    expect(r.label).toContain("pause");
    expect(r.detail).toMatch(/until/);
  });

  it("pause an hour (word quantifier)", () => {
    const r = parseCommand("pause an hour");
    expect(r.kind).toBe("pause");
    expect(r.label).toMatch(/1h/);
    expect(r.detail).toMatch(/until/);
  });

  it("pause for an hour (word quantifier + 'for')", () => {
    expect(parseCommand("pause for an hour").kind).toBe("pause");
    expect(parseCommand("pause for an hour").label).toMatch(/1h/);
  });

  it("pause one hour (word quantifier)", () => {
    const r = parseCommand("pause one hour");
    expect(r.kind).toBe("pause");
    expect(r.label).toMatch(/1h/);
  });

  it("pause half an hour (fractional word quantifier)", () => {
    const r = parseCommand("pause half an hour");
    expect(r.kind).toBe("pause");
    expect(r.label).toMatch(/30m/);
  });

  it("pause until <when>", () => {
    const r = parseCommand("pause until 3pm");
    expect(r.kind).toBe("pause");
    expect(r.detail).toContain("3pm");
  });

  it("pause (bare)", () => {
    const r = parseCommand("pause");
    expect(r.kind).toBe("pause");
    expect(r.detail).toBe("until you resume");
  });

  it("pause alex", () => {
    expect(parseCommand("pause alex").kind).toBe("pause");
  });

  it("resume / unpause / go", () => {
    expect(parseCommand("resume").kind).toBe("resume");
    expect(parseCommand("unpause").kind).toBe("resume");
    expect(parseCommand("go").kind).toBe("resume");
  });

  it("halt / stop", () => {
    expect(parseCommand("halt").kind).toBe("halt");
    expect(parseCommand("stop").kind).toBe("halt");
  });

  it("follow up with <name>", () => {
    const r = parseCommand("follow up with Maya tonight");
    expect(r.kind).toBe("followup");
    expect(r.label).toContain("Maya");
    expect(r.detail).toBeTruthy();
  });

  it("fu <name>", () => {
    expect(parseCommand("fu Jordan").kind).toBe("followup");
  });

  it("brief me at <time>", () => {
    const r = parseCommand("brief me at noon");
    expect(r.kind).toBe("brief");
    expect(r.detail).toContain("noon");
  });

  it("stop offering <thing>", () => {
    const r = parseCommand("stop offering the founder rate");
    expect(r.kind).toBe("rule");
    expect(r.detail).toContain("founder rate");
  });

  it("don't send <thing>", () => {
    expect(parseCommand("don't send afternoon batches").kind).toBe("rule");
  });

  it("reply to <name>", () => {
    const r = parseCommand("reply to Maya");
    expect(r.kind).toBe("handoff");
    expect(r.label).toContain("Maya");
  });

  it("i'll reply to <name>", () => {
    expect(parseCommand("i'll reply to Maya").kind).toBe("handoff");
  });

  it("tell alex about <name>", () => {
    const r = parseCommand("tell alex about Maya");
    expect(r.kind).toBe("context");
    expect(r.label).toContain("Maya");
  });

  it("fallback to instruction with truncation", () => {
    const long = "x".repeat(120);
    const r = parseCommand(long);
    expect(r.kind).toBe("instruction");
    expect(r.detail.length).toBeLessThanOrEqual(60);
  });

  it("empty input falls back to instruction", () => {
    const r = parseCommand("");
    expect(r.kind).toBe("instruction");
  });

  it("case-insensitive match", () => {
    expect(parseCommand("PAUSE").kind).toBe("pause");
    expect(parseCommand("Resume").kind).toBe("resume");
  });

  it("multi-line input parses first non-empty line", () => {
    const r = parseCommand("\n  pause\nstuff");
    expect(r.kind).toBe("pause");
  });

  it("carries raw input on every action", () => {
    expect(parseCommand("pause for 1h").raw).toBe("pause for 1h");
    expect(parseCommand("").raw).toBe("");
  });
});
```

Run: `pnpm --filter @switchboard/dashboard test -- --run parse-command` — expect compile error.

- [ ] **Step 2: Implement `parseCommand`.**

Create `apps/dashboard/src/lib/cockpit/parse-command.ts`:

```ts
import type { ParsedAction } from "@/components/cockpit/types";

const PAUSE_FOR = /^pause\s+(?:for\s+)?(\d+)\s*(min|m|h|hour|hours)\b/i;
const PAUSE_WORD =
  /^pause\s+(?:for\s+)?(half\s+an?|an|one|two|three|four|five|six)\s+(hour|hours|min|minute|minutes)\b/i;
const PAUSE_UNTIL = /^pause\s+until\s+(.+)$/i;
const PAUSE_BARE = /^pause(?:\s+alex)?$/i;

const WORD_TO_NUM: Record<string, number> = {
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
};
const RESUME = /^(resume|unpause|go)$/i;
const HALT = /^(halt|stop)$/i;
const FOLLOWUP =
  /^(?:fu|follow\s+up)\s+(?:with\s+)?([\w'.\- ]+?)(?:\s+(tonight|today|tomorrow|now|later))?$/i;
const BRIEF = /^brief(?:\s+me)?(?:\s+at\s+(.+))?$/i;
const RULE = /^(?:stop|don't|do not)\s+(?:offer(?:ing)?|send(?:ing)?)\s+(.+)$/i;
const HANDOFF = /^(?:reply to|i'?ll\s+reply\s+to|let\s+me\s+reply\s+to)\s+([\w'.\- ]+)$/i;
const CONTEXT = /^tell\s+alex\s+about\s+([\w'.\- ]+)$/i;

function firstNonEmptyLine(raw: string): string {
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return "";
}

function truncate(s: string, max = 60): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function untilHourLabel(hours: number): string {
  // Locked-design copy: "until HH:MM AM" relative to current time.
  // We use a deterministic format so tests are stable; the actual
  // wall-clock-aware variant is a polish ramp.
  const target = new Date(Date.now() + hours * 60 * 60 * 1000);
  const h = target.getHours();
  const m = target.getMinutes();
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  const mm = m.toString().padStart(2, "0");
  return `until ${h12}:${mm} ${period}`;
}

export function parseCommand(raw: string): ParsedAction {
  const original = raw;
  const text = firstNonEmptyLine(raw);

  let match = text.match(PAUSE_FOR);
  if (match) {
    const n = Number(match[1]);
    const unit = match[2]!.toLowerCase();
    const hours = unit.startsWith("m") ? n / 60 : n;
    return {
      kind: "pause",
      icon: "⏸",
      label: hours >= 1 ? `pause · ${hours}h` : `pause · ${n}m`,
      detail: untilHourLabel(hours),
      raw: original,
    };
  }

  match = text.match(PAUSE_WORD);
  if (match) {
    const quantifierRaw = match[1]!.toLowerCase().trim();
    const unit = match[2]!.toLowerCase();
    let n: number;
    if (quantifierRaw.startsWith("half")) {
      n = 0.5;
    } else {
      n = WORD_TO_NUM[quantifierRaw] ?? 1;
    }
    const hours = unit.startsWith("m") ? n / 60 : n;
    return {
      kind: "pause",
      icon: "⏸",
      label: hours >= 1 ? `pause · ${hours}h` : `pause · ${Math.round(hours * 60)}m`,
      detail: untilHourLabel(hours),
      raw: original,
    };
  }

  match = text.match(PAUSE_UNTIL);
  if (match) {
    return {
      kind: "pause",
      icon: "⏸",
      label: "pause",
      detail: `until ${match[1]!.trim()}`,
      raw: original,
    };
  }

  if (PAUSE_BARE.test(text)) {
    return {
      kind: "pause",
      icon: "⏸",
      label: "pause",
      detail: "until you resume",
      raw: original,
    };
  }

  if (RESUME.test(text)) {
    return {
      kind: "resume",
      icon: "▶",
      label: "resume",
      detail: "pick up where I left off",
      raw: original,
    };
  }

  if (HALT.test(text)) {
    return {
      kind: "halt",
      icon: "⏹",
      label: "halt",
      detail: "stop everything now",
      raw: original,
    };
  }

  match = text.match(FOLLOWUP);
  if (match) {
    const name = match[1]!.trim();
    const when = (match[2] ?? "today").trim();
    return {
      kind: "followup",
      icon: "↻",
      label: `follow up · ${name}`,
      detail: when,
      raw: original,
    };
  }

  match = text.match(BRIEF);
  if (match) {
    const when = (match[1] ?? "noon").trim();
    return {
      kind: "brief",
      icon: "☼",
      label: "brief me",
      detail: `at ${when}`,
      raw: original,
    };
  }

  match = text.match(RULE);
  if (match) {
    return {
      kind: "rule",
      icon: "⊘",
      label: "rule change",
      detail: `stop offering ${match[1]!.trim()}`,
      raw: original,
    };
  }

  match = text.match(HANDOFF);
  if (match) {
    const name = match[1]!.trim();
    return {
      kind: "handoff",
      icon: "✎",
      label: `handoff · ${name}`,
      detail: "you take the thread",
      raw: original,
    };
  }

  match = text.match(CONTEXT);
  if (match) {
    const name = match[1]!.trim();
    return {
      kind: "context",
      icon: "ⓘ",
      label: `context · ${name}`,
      detail: "add a note to the thread",
      raw: original,
    };
  }

  return {
    kind: "instruction",
    icon: "→",
    label: "instruction",
    detail: truncate(text, 60),
    raw: original,
  };
}
```

Run the test — expect green. Note: the `pause-for` test asserts `.detail` matches `/until/` (intentionally loose because wall-clock-aware output varies). Tighten only if a fixed `Date` mock is wired in a separate prep step; the loose match is sufficient for v1.

- [ ] **Step 3: Commit.**

```
feat(cockpit): A.5 — parseCommand port from commands.jsx

Verbatim TypeScript port of the locked-design NL parser. 10 patterns
plus instruction fallback. Pure function — no side effects, no toasts.
Carries raw input on every returned ParsedAction so downstream toast
voice can echo the operator's exact phrasing.
```

---

### Task 3: Ship the `ALEX_COMMANDS` catalog

**Files:**

- Create: `apps/dashboard/src/lib/cockpit/alex-commands.ts`
- Create: `apps/dashboard/src/lib/cockpit/__tests__/alex-commands.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it } from "vitest";
import { ALEX_COMMANDS, ALEX_COMPOSER_PLACEHOLDER } from "../alex-commands";

describe("ALEX_COMMANDS", () => {
  it("has 14 entries", () => {
    expect(ALEX_COMMANDS).toHaveLength(14);
  });

  it("declares every locked command id exactly once", () => {
    const ids = ALEX_COMMANDS.map((c) => c.id);
    const expected = [
      "pause-1h",
      "pause-3pm",
      "resume",
      "halt",
      "brief-noon",
      "brief-eod",
      "fu-named",
      "reply-named",
      "hold-named",
      "stop-founder",
      "raise-rule",
      "open-settings",
      "open-rules",
      "open-meta",
    ];
    expect(ids.sort()).toEqual(expected.sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("groups every entry into one of control/thread/rules/nav", () => {
    for (const c of ALEX_COMMANDS) {
      expect(["control", "thread", "rules", "nav"]).toContain(c.group);
    }
  });

  it("exports the locked composer placeholder string", () => {
    expect(ALEX_COMPOSER_PLACEHOLDER).toMatch(/Tell Alex what to do/);
    expect(ALEX_COMPOSER_PLACEHOLDER).toMatch(/pause an hour/);
    expect(ALEX_COMPOSER_PLACEHOLDER).toMatch(/follow up with Maya/);
  });
});
```

- [ ] **Step 2: Implement.**

```ts
import type { Command } from "@/components/cockpit/types";

export const ALEX_COMPOSER_PLACEHOLDER =
  'Tell Alex what to do — "pause an hour", "follow up with Maya tonight"…';

export const ALEX_COMMANDS: readonly Command[] = [
  { id: "pause-1h", label: "Pause Alex for 1 hour", group: "control" },
  { id: "pause-3pm", label: "Pause until 3 PM", group: "control" },
  { id: "resume", label: "Resume Alex", group: "control" },
  { id: "halt", label: "Halt — stop everything", group: "control" },
  { id: "brief-noon", label: "Brief me at noon", group: "control" },
  { id: "brief-eod", label: "Brief me at end of day", group: "control" },
  { id: "fu-named", label: "Follow up with {contact} tonight", group: "thread" },
  { id: "reply-named", label: "Reply to {contact} myself", group: "thread" },
  { id: "hold-named", label: "Hold {contact}, don't send anything", group: "thread" },
  { id: "stop-founder", label: "Stop offering the founder rate", group: "rules" },
  { id: "raise-rule", label: "Raise approval threshold to $99", group: "rules" },
  { id: "open-settings", label: "Open settings", group: "nav" },
  { id: "open-rules", label: "Open standing rules", group: "nav" },
  { id: "open-meta", label: "Open Meta Ads campaigns", group: "nav" },
];
```

Run test — expect green.

- [ ] **Step 3: Commit.**

```
feat(cockpit): A.5 — ALEX_COMMANDS catalog + placeholder string

14 commands across 4 groups (control/thread/rules/nav). Verbatim
from umbrella spec §Composer §Alex's contributions. Thread-group
labels carry `{contact}` template tokens that the palette will
substitute when threadContext is present (post-A.5 ramp).
```

---

### Task 4: Port `toastVoice` from JavaScript

**Files:**

- Create: `apps/dashboard/src/lib/cockpit/alex-toast-voice.ts`
- Create: `apps/dashboard/src/lib/cockpit/__tests__/alex-toast-voice.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it } from "vitest";
import { toastVoice } from "../alex-toast-voice";
import type { ParsedAction } from "@/components/cockpit/types";

function action(kind: ParsedAction["kind"], extras: Partial<ParsedAction> = {}): ParsedAction {
  return {
    kind,
    icon: "·",
    label: kind,
    detail: extras.detail ?? "",
    raw: extras.raw ?? "",
    ...extras,
  };
}

describe("toastVoice", () => {
  it("pause has title + description", () => {
    const t = toastVoice(action("pause", { detail: "until 3 PM" }));
    expect(t.title).toMatch(/Paused/);
    expect(t.description).toBe("until 3 PM");
  });

  it("resume", () => {
    expect(toastVoice(action("resume")).title).toMatch(/Resumed/);
  });

  it("halt", () => {
    expect(toastVoice(action("halt")).title).toMatch(/Halted/);
  });

  it("brief is a stub with deferred-cron description", () => {
    const t = toastVoice(action("brief"));
    expect(t.title).toMatch(/stub/i);
    expect(t.description).toMatch(/scheduled briefs/i);
  });

  it("rule echoes detail", () => {
    const t = toastVoice(action("rule", { detail: "stop offering founder rate" }));
    expect(t.title).toMatch(/rules/i);
    expect(t.description).toBe("stop offering founder rate");
  });

  it("handoff names the contact", () => {
    const t = toastVoice(action("handoff", { label: "handoff · Maya" }));
    expect(t.title).toMatch(/Maya/);
  });

  it("context names the contact", () => {
    const t = toastVoice(action("context", { label: "context · Jordan" }));
    expect(t.title).toMatch(/Jordan/);
  });

  it("followup is a stub", () => {
    const t = toastVoice(action("followup"));
    expect(t.title).toMatch(/stub/i);
    expect(t.description).toMatch(/scheduled followups/i);
  });

  it("instruction echoes detail in description", () => {
    const t = toastVoice(action("instruction", { detail: "do the thing" }));
    expect(t.title).toBe("Got it.");
    expect(t.description).toBe('Acting on "do the thing".');
  });

  it("command falls back to On it · label", () => {
    const t = toastVoice(action("command", { label: "Open settings" }));
    expect(t.title).toMatch(/On it/);
    expect(t.title).toMatch(/Open settings/);
  });
});
```

- [ ] **Step 2: Implement.**

```ts
import type { ParsedAction } from "@/components/cockpit/types";

export interface ToastPayload {
  title: string;
  description?: string;
}

export function toastVoice(action: ParsedAction): ToastPayload {
  switch (action.kind) {
    case "pause":
      return { title: "Paused — standing by.", description: action.detail };
    case "resume":
      return { title: "Resumed — picking up where I left off." };
    case "halt":
      return { title: "Halted — stopped everything." };
    case "brief":
      return {
        title: "Noted — brief stub.",
        description: "I'll surface this when scheduled briefs ship.",
      };
    case "rule":
      return { title: "Opening rules.", description: action.detail };
    case "handoff": {
      const name = action.label.replace(/^handoff · /, "");
      return { title: `Handing ${name} to you.` };
    }
    case "context": {
      const name = action.label.replace(/^context · /, "");
      return { title: `Got context on ${name}.` };
    }
    case "followup":
      return {
        title: "Noted — followup stub.",
        description: "I'll surface this when scheduled followups ship.",
      };
    case "instruction":
      return { title: "Got it.", description: `Acting on "${action.detail}".` };
    case "command":
      return { title: `On it — ${action.label}.` };
  }
}
```

Run test — expect green.

- [ ] **Step 3: Commit.**

```
feat(cockpit): A.5 — toastVoice port from alex-config.jsx

Returns shadcn-compatible { title, description? } payloads per
action.kind. Honest-impact-language compliant: describes what Alex
did, never causal claims. Brief and followup are explicitly stubbed
in copy so operators see the deferred-cron status.
```

---

### Task 5: Ship the Alex action dispatcher hook

**Files:**

- Create: `apps/dashboard/src/lib/cockpit/alex-action-dispatcher.ts`
- Create: `apps/dashboard/src/lib/cockpit/__tests__/alex-action-dispatcher.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { ReactNode } from "react";
import { HaltProvider, useHalt } from "@/components/layout/halt/halt-context";
import { useAlexActionDispatcher } from "../alex-action-dispatcher";

const pushMock = vi.fn();
const toastMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: pushMock, prefetch: vi.fn() }),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <HaltProvider>{children}</HaltProvider>;
}

// CRITICAL: dispatcher + halt must share ONE provider instance, otherwise
// the dispatcher's setHalted call writes to a different provider than the
// halt.halted assertion reads from. Use a single renderHook with a combined
// hook to guarantee one wrapper render = one HaltProvider.
function setup() {
  return renderHook(
    () => ({
      dispatch: useAlexActionDispatcher(),
      halt: useHalt(),
    }),
    { wrapper },
  );
}

beforeEach(() => {
  pushMock.mockReset();
  toastMock.mockReset();
  if (typeof window !== "undefined") window.localStorage.clear();
});

describe("useAlexActionDispatcher", () => {
  it("pause flips halt true and toasts", () => {
    const { result } = setup();
    act(() => {
      result.current.dispatch({
        kind: "pause",
        icon: "⏸",
        label: "pause",
        detail: "until you resume",
        raw: "pause",
      });
    });
    expect(result.current.halt.halted).toBe(true);
    expect(toastMock).toHaveBeenCalledOnce();
  });

  it("resume flips halt false", () => {
    const { result } = setup();
    act(() => result.current.halt.setHalted(true));
    act(() => {
      result.current.dispatch({
        kind: "resume",
        icon: "▶",
        label: "resume",
        detail: "",
        raw: "resume",
      });
    });
    expect(result.current.halt.halted).toBe(false);
  });

  it("halt flips halt true (no auto-resume)", () => {
    const { result } = setup();
    act(() => {
      result.current.dispatch({
        kind: "halt",
        icon: "⏹",
        label: "halt",
        detail: "",
        raw: "halt",
      });
    });
    expect(result.current.halt.halted).toBe(true);
  });

  it("rule routes to /settings?focus=rules", () => {
    const { result } = setup();
    act(() => {
      result.current.dispatch({
        kind: "rule",
        icon: "⊘",
        label: "rule change",
        detail: "stop offering founder rate",
        raw: "stop offering founder rate",
      });
    });
    expect(pushMock).toHaveBeenCalledWith("/settings?focus=rules");
  });

  it("handoff with threadContext routes to /contacts/[id]?takeover=true", () => {
    const { result } = setup();
    act(() => {
      result.current.dispatch(
        {
          kind: "handoff",
          icon: "✎",
          label: "handoff · Maya",
          detail: "",
          raw: "reply to Maya",
        },
        { contactId: "c1", displayName: "Maya" },
      );
    });
    expect(pushMock).toHaveBeenCalledWith("/contacts/c1?takeover=true");
  });

  it("handoff without threadContext toasts a fallback (no route)", () => {
    const { result } = setup();
    act(() => {
      result.current.dispatch({
        kind: "handoff",
        icon: "✎",
        label: "handoff · Maya",
        detail: "",
        raw: "reply to Maya",
      });
    });
    expect(pushMock).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledOnce();
  });

  it("context with threadContext routes to /contacts/[id]?note=open", () => {
    const { result } = setup();
    act(() => {
      result.current.dispatch(
        {
          kind: "context",
          icon: "ⓘ",
          label: "context · Maya",
          detail: "",
          raw: "tell alex about Maya",
        },
        { contactId: "c1", displayName: "Maya" },
      );
    });
    expect(pushMock).toHaveBeenCalledWith("/contacts/c1?note=open");
  });

  it("brief is toast-only stub", () => {
    const { result } = setup();
    act(() => {
      result.current.dispatch({
        kind: "brief",
        icon: "☼",
        label: "brief me",
        detail: "at noon",
        raw: "brief me at noon",
      });
    });
    expect(pushMock).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledOnce();
  });

  it("command pause-1h flips halt true via synthetic parseCommand", () => {
    const { result } = setup();
    act(() => {
      result.current.dispatch({
        kind: "command",
        icon: "·",
        label: "Pause Alex for 1 hour",
        detail: "",
        raw: "",
        commandId: "pause-1h",
      });
    });
    expect(result.current.halt.halted).toBe(true);
  });

  it("command stop-founder routes with founderRateEnabled=false", () => {
    const { result } = setup();
    act(() => {
      result.current.dispatch({
        kind: "command",
        icon: "·",
        label: "Stop offering the founder rate",
        detail: "",
        raw: "",
        commandId: "stop-founder",
      });
    });
    expect(pushMock).toHaveBeenCalledWith("/settings?focus=rules&founderRateEnabled=false");
  });

  it("command raise-rule routes with priceApprovalThreshold=99", () => {
    const { result } = setup();
    act(() => {
      result.current.dispatch({
        kind: "command",
        icon: "·",
        label: "Raise approval threshold to $99",
        detail: "",
        raw: "",
        commandId: "raise-rule",
      });
    });
    expect(pushMock).toHaveBeenCalledWith("/settings?focus=rules&priceApprovalThreshold=99");
  });

  it("command open-settings routes to /settings", () => {
    const { result } = setup();
    act(() => {
      result.current.dispatch({
        kind: "command",
        icon: "·",
        label: "Open settings",
        detail: "",
        raw: "",
        commandId: "open-settings",
      });
    });
    expect(pushMock).toHaveBeenCalledWith("/settings");
  });

  it("command open-meta routes to /settings?focus=channels", () => {
    const { result } = setup();
    act(() => {
      result.current.dispatch({
        kind: "command",
        icon: "·",
        label: "Open Meta Ads campaigns",
        detail: "",
        raw: "",
        commandId: "open-meta",
      });
    });
    expect(pushMock).toHaveBeenCalledWith("/settings?focus=channels");
  });

  it("resume works even when currently halted", () => {
    const { result } = setup();
    act(() => result.current.halt.setHalted(true));
    expect(result.current.halt.halted).toBe(true);
    act(() => {
      result.current.dispatch({
        kind: "resume",
        icon: "▶",
        label: "resume",
        detail: "",
        raw: "",
      });
    });
    expect(result.current.halt.halted).toBe(false);
  });
});
```

- [ ] **Step 2: Implement.**

```ts
"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useHalt } from "@/components/layout/halt/halt-context";
import { useToast } from "@/components/ui/use-toast";
import { parseCommand } from "./parse-command";
import { toastVoice } from "./alex-toast-voice";
import type { ParsedAction, ThreadContext } from "@/components/cockpit/types";

const PER_ID_NL: Record<string, string> = {
  "pause-1h": "pause for 1h",
  "pause-3pm": "pause until 3pm",
  resume: "resume",
  halt: "halt",
};

const PER_ID_ROUTE: Record<string, string> = {
  "stop-founder": "/settings?focus=rules&founderRateEnabled=false",
  "raise-rule": "/settings?focus=rules&priceApprovalThreshold=99",
  "open-settings": "/settings",
  "open-rules": "/settings?focus=rules",
  "open-meta": "/settings?focus=channels",
};

export type AlexActionDispatcher = (action: ParsedAction, threadContext?: ThreadContext) => void;

export function useAlexActionDispatcher(): AlexActionDispatcher {
  const { setHalted } = useHalt();
  const router = useRouter();
  const { toast } = useToast();

  return useCallback<AlexActionDispatcher>(
    (action, threadContext) => {
      // Per-id command overrides resolve first (synthetic NL or route).
      if (action.kind === "command" && action.commandId) {
        const nl = PER_ID_NL[action.commandId];
        if (nl) {
          const synthetic = parseCommand(nl);
          // Re-enter dispatch via direct kind handling — same closure.
          // Note: avoiding recursion to keep the call stack shallow.
          handleByKind(synthetic, threadContext, setHalted, router, toast);
          return;
        }
        const route = PER_ID_ROUTE[action.commandId];
        if (route) {
          router.push(route);
          toast(toastVoice(action));
          return;
        }
        if (action.commandId === "brief-noon" || action.commandId === "brief-eod") {
          toast(toastVoice({ ...action, kind: "brief" }));
          return;
        }
        // Thread-group commands (fu-named/reply-named/hold-named) only fire
        // when threadContext is set; the palette filters them otherwise.
        // At A.5, threadContext is always undefined at the page call site,
        // so this branch is unreachable in production. Tested implicitly
        // via the palette's disabled-state assertion.
        toast(toastVoice(action));
        return;
      }
      handleByKind(action, threadContext, setHalted, router, toast);
    },
    [setHalted, router, toast],
  );
}

function handleByKind(
  action: ParsedAction,
  threadContext: ThreadContext | undefined,
  setHalted: (next: boolean) => void,
  router: ReturnType<typeof useRouter>,
  toast: ReturnType<typeof useToast>["toast"],
): void {
  switch (action.kind) {
    case "pause":
      setHalted(true);
      toast(toastVoice(action));
      return;
    case "resume":
      setHalted(false);
      toast(toastVoice(action));
      return;
    case "halt":
      setHalted(true);
      toast(toastVoice(action));
      return;
    case "rule":
      router.push("/settings?focus=rules");
      toast(toastVoice(action));
      return;
    case "handoff":
      if (threadContext) {
        router.push(`/contacts/${encodeURIComponent(threadContext.contactId)}?takeover=true`);
        toast(toastVoice(action));
      } else {
        toast({ title: "Open a thread first.", description: "Expand a row to take it over." });
      }
      return;
    case "context":
      if (threadContext) {
        router.push(`/contacts/${encodeURIComponent(threadContext.contactId)}?note=open`);
        toast(toastVoice(action));
      } else {
        toast({ title: "Open a thread first.", description: "Expand a row to add context." });
      }
      return;
    case "brief":
    case "followup":
    case "instruction":
      toast(toastVoice(action));
      return;
    case "command":
      // Unmatched commandId fallthrough — toast the generic.
      toast(toastVoice(action));
      return;
  }
}
```

Run test — expect green.

- [ ] **Step 3: Commit.**

```
feat(cockpit): A.5 — useAlexActionDispatcher hook

Wires useHalt + useRouter + useToast into a single dispatcher per the
umbrella spec §Composer §Action dispatch table. Per-id overrides for
pause-1h/pause-3pm/resume/halt fire synthetic parseCommand; stop-founder/
raise-rule/open-* route directly. Handoff/context fall back to toast
when threadContext is absent. brief/followup/instruction toast-only.
```

---

### Task 6: Ship `<CommandPalette>`

**Files:**

- Create: `apps/dashboard/src/components/cockpit/command-palette.tsx`
- Create: `apps/dashboard/src/components/cockpit/__tests__/command-palette.test.tsx`

- [ ] **Step 1: Write the failing test.**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandPalette } from "../command-palette";
import { ALEX_COMMANDS } from "@/lib/cockpit/alex-commands";
import { RILEY_COMMANDS } from "@/lib/cockpit/riley/riley-config";
import type { Command } from "../types";

const noop = () => {};

describe("<CommandPalette>", () => {
  it("renders all groups when open", () => {
    render(<CommandPalette open onClose={noop} commands={ALEX_COMMANDS} onSelect={noop} />);
    expect(screen.getByText("Open settings")).toBeInTheDocument();
    expect(screen.getByText("Pause Alex for 1 hour")).toBeInTheDocument();
    expect(screen.getByText("Stop offering the founder rate")).toBeInTheDocument();
  });

  it("does not render when open=false", () => {
    render(<CommandPalette open={false} onClose={noop} commands={ALEX_COMMANDS} onSelect={noop} />);
    expect(screen.queryByText("Open settings")).not.toBeInTheDocument();
  });

  it("type-to-filter narrows visible commands", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={noop} commands={ALEX_COMMANDS} onSelect={noop} />);
    await user.type(screen.getByRole("searchbox"), "pause");
    expect(screen.getByText("Pause Alex for 1 hour")).toBeInTheDocument();
    expect(screen.queryByText("Open settings")).not.toBeInTheDocument();
  });

  it("thread-group commands disabled when threadContext is undefined", () => {
    render(<CommandPalette open onClose={noop} commands={ALEX_COMMANDS} onSelect={noop} />);
    const followup = screen.getByText("Follow up with {contact} tonight").closest("button");
    expect(followup).toBeDisabled();
  });

  it("hold-named is rendered but disabled (inert in A.5)", () => {
    // hold-named appears in ALEX_COMMANDS but has no corresponding
    // ParsedActionKind in A.5. The palette's thread-group disable behavior
    // keeps it inert because threadContext is always undefined at the A.5
    // CockpitPage call site. This case locks the catalog/dispatcher
    // asymmetry — see slice brief §"Typed `hold` action kind" non-goal.
    render(<CommandPalette open onClose={noop} commands={ALEX_COMMANDS} onSelect={noop} />);
    const hold = screen.getByText("Hold {contact}, don't send anything").closest("button");
    expect(hold).toBeInTheDocument();
    expect(hold).toBeDisabled();
  });

  it("renders groups in operational-first order (control → thread → rules → nav)", () => {
    render(<CommandPalette open onClose={noop} commands={ALEX_COMMANDS} onSelect={noop} />);
    const labels = screen.getAllByText(/^(Control|Thread|Rules|Navigate)$/);
    expect(labels.map((el) => el.textContent)).toEqual(["Control", "Thread", "Rules", "Navigate"]);
  });

  it("thread-group commands enabled when threadContext present", () => {
    render(
      <CommandPalette
        open
        onClose={noop}
        commands={ALEX_COMMANDS}
        onSelect={noop}
        threadContext={{ contactId: "c1", displayName: "Maya" }}
      />,
    );
    const followup = screen.getByText(/Follow up/).closest("button");
    expect(followup).not.toBeDisabled();
  });

  it("Enter fires onSelect with the focused command", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<CommandPalette open onClose={noop} commands={ALEX_COMMANDS} onSelect={onSelect} />);
    await user.type(screen.getByRole("searchbox"), "pause 1");
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalled();
    const firstCall = onSelect.mock.calls[0]![0] as Command;
    expect(firstCall.id).toBe("pause-1h");
  });

  it("Escape fires onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} commands={ALEX_COMMANDS} onSelect={noop} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("agent-agnostic: renders Riley fixture without errors", () => {
    render(<CommandPalette open onClose={noop} commands={RILEY_COMMANDS} onSelect={noop} />);
    expect(screen.getByText("Open Meta")).toBeInTheDocument();
    expect(screen.getByText("Pause Riley for 1h")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement.**

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { T } from "./tokens";
import type { Command, CommandGroup, ThreadContext } from "./types";

// Order: control → thread → rules → nav. The palette's primary job is
// "tell Alex what to do" — operational commands lead. Nav routes away
// from the cockpit, so it's last. Do not reorder.
const GROUP_ORDER: CommandGroup[] = ["control", "thread", "rules", "nav"];
const GROUP_LABEL: Record<CommandGroup, string> = {
  control: "Control",
  thread: "Thread",
  rules: "Rules",
  nav: "Navigate",
};

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: readonly Command[];
  onSelect: (command: Command) => void;
  threadContext?: ThreadContext;
  placeholder?: string;
}

export function CommandPalette({
  open,
  onClose,
  commands,
  onSelect,
  threadContext,
  placeholder = "Type a command…",
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [focusIndex, setFocusIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setFocusIndex(0);
      inputRef.current?.focus();
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchesQuery = (c: Command) =>
      q.length === 0 || c.label.toLowerCase().includes(q) || c.id.toLowerCase().includes(q);
    const isEnabled = (c: Command) => c.group !== "thread" || threadContext !== undefined;
    const byGroup = new Map<CommandGroup, Command[]>();
    for (const c of commands) {
      if (!matchesQuery(c)) continue;
      const arr = byGroup.get(c.group) ?? [];
      arr.push(c);
      byGroup.set(c.group, arr);
    }
    const flat: { cmd: Command; enabled: boolean }[] = [];
    for (const g of GROUP_ORDER) {
      const arr = byGroup.get(g) ?? [];
      for (const cmd of arr) flat.push({ cmd, enabled: isEnabled(cmd) });
    }
    return { byGroup, flat };
  }, [commands, query, threadContext]);

  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIndex((i) => Math.min(i + 1, Math.max(filtered.flat.length - 1, 0)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const entry = filtered.flat[focusIndex];
      if (entry && entry.enabled) onSelect(entry.cmd);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onKeyDown={handleKeyDown}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(14,12,10,0.18)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: 72,
        zIndex: 50,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 520,
          maxWidth: "92vw",
          background: T.bg,
          border: `1px solid ${T.hair}`,
          borderRadius: 8,
          boxShadow: "0 12px 32px rgba(14,12,10,0.18)",
          overflow: "hidden",
        }}
      >
        <input
          ref={inputRef}
          role="searchbox"
          aria-label="Filter commands"
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setFocusIndex(0);
          }}
          style={{
            width: "100%",
            padding: "14px 18px",
            border: "none",
            borderBottom: `1px solid ${T.hair}`,
            background: T.bg,
            color: T.ink,
            fontSize: 14,
            outline: "none",
            fontFamily: "inherit",
            boxSizing: "border-box",
          }}
        />
        <ul style={{ listStyle: "none", margin: 0, padding: 8, maxHeight: 360, overflowY: "auto" }}>
          {GROUP_ORDER.map((group) => {
            const entries = filtered.byGroup.get(group) ?? [];
            if (entries.length === 0) return null;
            return (
              <li key={group} style={{ padding: "6px 0" }}>
                <div
                  style={{
                    padding: "4px 10px",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.14em",
                    color: T.ink4,
                    textTransform: "uppercase",
                  }}
                >
                  {GROUP_LABEL[group]}
                </div>
                {entries.map((cmd) => {
                  const flatIndex = filtered.flat.findIndex((e) => e.cmd.id === cmd.id);
                  const focused = flatIndex === focusIndex;
                  const enabled = filtered.flat[flatIndex]?.enabled ?? false;
                  return (
                    <button
                      key={cmd.id}
                      type="button"
                      disabled={!enabled}
                      onClick={() => enabled && onSelect(cmd)}
                      onMouseEnter={() => setFocusIndex(flatIndex)}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "8px 10px",
                        background: focused ? "rgba(184,120,46,0.08)" : "transparent",
                        border: "none",
                        cursor: enabled ? "pointer" : "not-allowed",
                        fontSize: 13,
                        color: enabled ? T.ink : T.ink4,
                        fontFamily: "inherit",
                        borderRadius: 4,
                      }}
                    >
                      {cmd.label}
                    </button>
                  );
                })}
              </li>
            );
          })}
          {filtered.flat.length === 0 && (
            <li style={{ padding: "16px 14px", color: T.ink4, fontSize: 13 }}>
              No commands match.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
```

Run test — expect green.

- [ ] **Step 3: Commit.**

```
feat(cockpit): A.5 — agent-agnostic CommandPalette component

Renders { commands, onSelect, threadContext?, placeholder? } with
group ordering nav → rules → control → thread. Thread-group commands
disabled when threadContext is undefined. Arrow nav + Enter selects +
Escape closes. Riley fixture renders identically — the catalog drives
behavior, no Alex hard-coding.
```

---

### Task 7: Ship `<Composer>`

**Files:**

- Create: `apps/dashboard/src/components/cockpit/composer.tsx`
- Create: `apps/dashboard/src/components/cockpit/__tests__/composer.test.tsx`

- [ ] **Step 1: Write the failing test.**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Composer } from "../composer";
import { ALEX_COMPOSER_PLACEHOLDER } from "@/lib/cockpit/alex-commands";

const noop = () => {};

describe("<Composer>", () => {
  it("renders the placeholder", () => {
    render(<Composer placeholder={ALEX_COMPOSER_PLACEHOLDER} onDispatch={noop} halted={false} />);
    expect(screen.getByPlaceholderText(/Tell Alex what to do/)).toBeInTheDocument();
  });

  it("stages a chip preview when typing a recognized pattern", async () => {
    const user = userEvent.setup();
    render(<Composer placeholder={ALEX_COMPOSER_PLACEHOLDER} onDispatch={noop} halted={false} />);
    await user.type(screen.getByRole("textbox"), "pause");
    expect(screen.getByTestId("composer-chip")).toHaveTextContent(/pause/);
  });

  it("Enter calls onDispatch with the parsed action", async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    render(
      <Composer placeholder={ALEX_COMPOSER_PLACEHOLDER} onDispatch={onDispatch} halted={false} />,
    );
    await user.type(screen.getByRole("textbox"), "pause for 1h{Enter}");
    expect(onDispatch).toHaveBeenCalledOnce();
    expect(onDispatch.mock.calls[0]![0]).toMatchObject({ kind: "pause" });
  });

  it("Enter clears the input after dispatch", async () => {
    const user = userEvent.setup();
    render(<Composer placeholder={ALEX_COMPOSER_PLACEHOLDER} onDispatch={noop} halted={false} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    await user.type(input, "pause{Enter}");
    expect(input.value).toBe("");
  });

  it("Escape clears input without dispatching", async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    render(
      <Composer placeholder={ALEX_COMPOSER_PLACEHOLDER} onDispatch={onDispatch} halted={false} />,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    await user.type(input, "pause{Escape}");
    expect(input.value).toBe("");
    expect(onDispatch).not.toHaveBeenCalled();
  });

  it("halted disables input and swaps copy", () => {
    render(<Composer placeholder={ALEX_COMPOSER_PLACEHOLDER} onDispatch={noop} halted={true} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input).toBeDisabled();
    expect(input.placeholder).toMatch(/Halted/);
  });
});
```

- [ ] **Step 2: Implement.**

```tsx
"use client";

import { useState } from "react";
import { T } from "./tokens";
import { parseCommand } from "@/lib/cockpit/parse-command";
import type { ParsedAction } from "./types";

export interface ComposerProps {
  placeholder: string;
  onDispatch: (action: ParsedAction) => void;
  halted: boolean;
  senderLabel?: string;
  accentColor?: string;
  compact?: boolean;
}

export function Composer({
  placeholder,
  onDispatch,
  halted,
  senderLabel = "ALEX",
  accentColor = T.amber,
  compact = false,
}: ComposerProps) {
  const [value, setValue] = useState("");
  const parsed: ParsedAction | null = value.trim().length > 0 ? parseCommand(value) : null;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (value.trim().length === 0) return;
      const action = parseCommand(value);
      setValue("");
      onDispatch(action);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setValue("");
    }
  };

  return (
    <div
      style={{
        borderTop: `1px solid ${T.hair}`,
        background: T.bg,
        padding: compact ? "10px 18px 12px" : "12px 28px 14px",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: T.paper,
          border: `1px solid ${T.hair}`,
          borderRadius: 6,
          padding: "5px 14px",
          opacity: halted ? 0.55 : 1,
        }}
      >
        <span
          style={{
            fontFamily: "JetBrains Mono",
            fontSize: 11,
            color: accentColor,
            letterSpacing: "0.08em",
          }}
        >
          → {senderLabel}
        </span>
        <input
          type="text"
          role="textbox"
          aria-label="Composer input"
          disabled={halted}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={halted ? "Halted — resume to send instructions" : placeholder}
          style={{
            flex: 1,
            border: "none",
            background: "transparent",
            outline: "none",
            fontSize: 13,
            color: T.ink,
            padding: "8px 0",
            fontFamily: "inherit",
          }}
        />
        {parsed ? (
          <span
            data-testid="composer-chip"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontFamily: "JetBrains Mono",
              fontSize: 11,
              color: T.ink3,
              background: T.bg,
              border: `1px solid ${T.hair}`,
              borderRadius: 3,
              padding: "2px 6px",
              whiteSpace: "nowrap",
            }}
          >
            <span>{parsed.icon}</span>
            <span>{parsed.label}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
```

Run test — expect green.

- [ ] **Step 3: Commit.**

```
feat(cockpit): A.5 — agent-agnostic Composer with staging chip

Active input wrapper. On each keystroke, parseCommand(value) renders a
chip preview inline (icon + label). Enter dispatches and clears; Escape
clears without dispatch; halted disables input and swaps placeholder
copy. Layout mirrors ComposerPlaceholder so the visual swap on
CockpitPage is invisible to operators in cold state.
```

---

### Task 8: Wire `<CockpitPage>` — palette + composer + ⌘K

**Files:**

- Modify: `apps/dashboard/src/components/cockpit/cockpit-page.tsx`
- Modify: `apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx`

- [ ] **Step 1: Edit `cockpit-page.tsx`.**

Replace the imports section + the body of `CockpitPage`:

- Add imports:

  ```ts
  import { Composer } from "./composer";
  import { CommandPalette } from "./command-palette";
  import { ALEX_COMMANDS, ALEX_COMPOSER_PLACEHOLDER } from "@/lib/cockpit/alex-commands";
  import { useAlexActionDispatcher } from "@/lib/cockpit/alex-action-dispatcher";
  ```

- Remove import:

  ```ts
  import { ComposerPlaceholder } from "./composer-placeholder";
  ```

- Inside `CockpitPage`, add (after the existing hook calls):

  ```ts
  const dispatch = useAlexActionDispatcher();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopPropagation();
        setPaletteOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  ```

- Swap the Topbar prop pair:

  ```tsx
  <Topbar paletteEnabled onOpenPalette={() => setPaletteOpen(true)} />
  ```

- Swap the bottom composer:

  ```tsx
  <Composer
    placeholder={ALEX_COMPOSER_PLACEHOLDER}
    onDispatch={(action) => dispatch(action)}
    halted={haltCtx.halted}
  />
  ```

- Add the palette as a sibling inside the outer flex column (e.g., just before the closing `</div>` of the root):
  ```tsx
  <CommandPalette
    open={paletteOpen}
    onClose={() => setPaletteOpen(false)}
    commands={ALEX_COMMANDS}
    onSelect={(cmd) => {
      setPaletteOpen(false);
      dispatch({
        kind: "command",
        icon: "·",
        label: cmd.label,
        detail: "",
        raw: "",
        commandId: cmd.id,
      });
    }}
  />
  ```

The full file should resemble (minus unchanged top imports):

```tsx
// apps/dashboard/src/components/cockpit/cockpit-page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { T } from "./tokens";
import { Topbar } from "./topbar";
import { Identity } from "./identity";
import { ApprovalBlock } from "./approval-block";
import { ActivityStream, type ActivityFilter } from "./activity-stream";
import { Composer } from "./composer";
import { CommandPalette } from "./command-palette";
import { MissionPopover } from "./mission-popover";
import { EmptyState, shouldRenderEmptyState } from "./empty-state";
import { KPIStrip } from "./kpi-strip";
import type { CockpitKpiData } from "./types";
import { ALEX_CONFIG } from "@/lib/cockpit/alex-config";
import { ALEX_COMMANDS, ALEX_COMPOSER_PLACEHOLDER } from "@/lib/cockpit/alex-commands";
import { useAlexActionDispatcher } from "@/lib/cockpit/alex-action-dispatcher";
import { legacyPendingApprovalToApprovalView } from "@/lib/cockpit/legacy-pending-approval-to-approval-view";
import { metricsViewModelToLegacyKpiInput } from "@/lib/cockpit/metrics-to-kpi-input";
import { useCockpitStatusAlex } from "@/hooks/use-cockpit-status";
import { usePendingApprovals } from "@/app/(auth)/(mercury)/approvals/hooks/use-approvals";
import { useAgentActivityCockpit } from "@/hooks/use-agent-activity-cockpit";
import { useAgentGreeting } from "@/hooks/use-agent-greeting";
import { useAgentMission } from "@/hooks/use-agent-mission";
import { useAgentMetrics } from "@/hooks/use-agent-metrics";
import { useHalt } from "@/components/layout/halt/halt-context";

export function CockpitPage() {
  const haltCtx = useHalt();
  const approvalsQ = usePendingApprovals();
  const activityQ = useAgentActivityCockpit("alex", { limit: 50, expandPreview: true });
  const greetingQ = useAgentGreeting("alex");
  const mission = useAgentMission("alex");
  const metricsQ = useAgentMetrics("alex");
  const router = useRouter();
  const dispatch = useAlexActionDispatcher();
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [missionOpen, setMissionOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopPropagation();
        setPaletteOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const approvals = (approvalsQ.data?.approvals ?? []).map((a) =>
    legacyPendingApprovalToApprovalView(a, now),
  );
  const activityRows = activityQ.data?.rows ?? [];
  const recentActivityAt =
    activityRows.length > 0 && activityRows[0]!.timestampIso
      ? new Date(activityRows[0]!.timestampIso)
      : null;

  const statusKey = useCockpitStatusAlex({
    halted: haltCtx.halted,
    pendingApprovals: approvals.length,
    recentActivityAt,
    now,
  });

  const coldState = mission.data ? shouldRenderEmptyState(mission.data.setup) : false;

  const kpis: CockpitKpiData | null = metricsQ.data
    ? {
        range: `This week · ${metricsQ.data.folioRange}`,
        ...metricsViewModelToLegacyKpiInput(metricsQ.data),
      }
    : null;

  const line = greetingQ.data?.segments
    ? greetingQ.data.segments
        .map((s) => s.text)
        .join(" ")
        .trim() || null
    : null;

  return (
    <div
      style={{
        background: T.bg,
        color: T.ink,
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <Topbar paletteEnabled onOpenPalette={() => setPaletteOpen(true)} />
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ position: "relative" }}>
          <Identity
            statusKey={statusKey}
            halted={haltCtx.halted}
            subtitle={ALEX_CONFIG.missionSubtitle}
            line={line}
            onHaltToggle={haltCtx.toggleHalt}
            missionInteractive={!!mission.data}
            onOpenMission={() => setMissionOpen((o) => !o)}
          />
          {mission.data ? (
            <MissionPopover
              open={missionOpen}
              onClose={() => setMissionOpen(false)}
              mission={mission.data.mission}
            />
          ) : null}
        </div>
        {!coldState && kpis ? <KPIStrip kpis={kpis} collapsed={approvals.length > 0} /> : null}
        {approvals.length > 0 && (
          <ApprovalBlock
            data={approvals}
            onResolve={(_verdict, _idx) => {
              // A.5 does not wire approval resolution. That belongs to a later
              // slice once useRespondToApproval is integrated.
            }}
          />
        )}
        {coldState && mission.data ? (
          <EmptyState
            rules={mission.data.mission.rules}
            setup={mission.data.setup}
            onConnect={(key) => router.push(`/setup?step=${key}`)}
          />
        ) : (
          <ActivityStream rows={activityRows} filter={filter} setFilter={setFilter} />
        )}
      </div>
      <Composer
        placeholder={ALEX_COMPOSER_PLACEHOLDER}
        onDispatch={(action) => dispatch(action)}
        halted={haltCtx.halted}
      />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={ALEX_COMMANDS}
        onSelect={(cmd) => {
          setPaletteOpen(false);
          dispatch({
            kind: "command",
            icon: "·",
            label: cmd.label,
            detail: "",
            raw: "",
            commandId: cmd.id,
          });
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Extend the cockpit-page test.**

Add these cases (or merge into the existing test file):

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CockpitPage } from "../cockpit-page";
import { HaltProvider } from "@/components/layout/halt/halt-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// All the existing hook mocks from the A.4 cockpit-page test stay in place
// (useAgentActivityCockpit, useAgentMission, useAgentMetrics, useAgentGreeting,
// usePendingApprovals, useCockpitStatusAlex). Add these:

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

function renderCockpit() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <HaltProvider>
        <CockpitPage />
      </HaltProvider>
    </QueryClientProvider>,
  );
}

describe("<CockpitPage> — A.5 composer + palette", () => {
  it("⌘K opens the palette", async () => {
    const user = userEvent.setup();
    renderCockpit();
    expect(screen.queryByRole("dialog", { name: /command palette/i })).not.toBeInTheDocument();
    await user.keyboard("{Meta>}k{/Meta}");
    expect(screen.getByRole("dialog", { name: /command palette/i })).toBeInTheDocument();
  });

  it("Escape closes the palette after opening", async () => {
    const user = userEvent.setup();
    renderCockpit();
    await user.keyboard("{Meta>}k{/Meta}");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: /command palette/i })).not.toBeInTheDocument();
  });

  it("Topbar 'Tell Alex…' click opens the palette", async () => {
    const user = userEvent.setup();
    renderCockpit();
    await user.click(screen.getByRole("button", { name: /Tell Alex…/i }));
    expect(screen.getByRole("dialog", { name: /command palette/i })).toBeInTheDocument();
  });

  it("renders the Composer at the bottom of the cockpit (not ComposerPlaceholder)", () => {
    renderCockpit();
    expect(screen.getByLabelText("Composer input")).toBeInTheDocument();
  });

  it("Composer input is disabled when halt is active", async () => {
    const user = userEvent.setup();
    renderCockpit();
    // Toggle halt via Identity opstrip — fixture-dependent. Skip detail: assert
    // the disable wiring by triggering halt via the localStorage seed and
    // re-rendering.
    window.localStorage.setItem("sb_halt_state", "1");
    renderCockpit();
    expect((await screen.findAllByLabelText("Composer input"))[1]).toBeDisabled();
  });
});
```

(The test setup borrows the existing A.4 mock harness; consult the live `cockpit-page.test.tsx` for the precise existing-mocks block — extend rather than replace.)

- [ ] **Step 3: Run dashboard tests + build.**

```bash
pnpm --filter @switchboard/dashboard test
pnpm --filter @switchboard/dashboard build
```

Per `feedback_dashboard_build_not_in_ci.md`: `next build` is not in CI. Run it locally now to catch any `.js`-extension regression.

- [ ] **Step 4: Commit.**

```
feat(cockpit): A.5 — wire CockpitPage to Composer + CommandPalette

Flips Topbar.paletteEnabled to true on /alex; adds ⌘K page-scoped
keyboard binding via document keydown listener (cleaned up on unmount);
swaps <ComposerPlaceholder> for <Composer> with ALEX_COMPOSER_PLACEHOLDER
+ useAlexActionDispatcher wiring; renders <CommandPalette> with
ALEX_COMMANDS. Riley page (riley-cockpit-page.tsx) untouched —
paletteEnabled stays false, ComposerPlaceholder stays mounted until
Riley B.3-followup.
```

---

### Task 9: Manual verification on the dev stack

- [ ] **Step 1: Start the dev stack.**

```bash
pnpm dev
# Open http://localhost:3002/alex
```

- [ ] **Step 2: Verify composer behavior.**

- Type `pause for 1h` — a chip with icon `⏸` + label `pause · 1h` renders inline.
- Press Enter — input clears, toast appears with title `"Paused — standing by."`, halt-state pill flips to `HALTED`, Composer input becomes disabled with copy "Halted — resume to send instructions".
- Type into the (still disabled) input — nothing happens.
- Press ⌘K — palette opens, search input is focused.
- Type `resume` — `Resume Alex` is the only visible command. Press Enter — palette closes, halt-state pill flips back to `IDLE` / `WORKING`, Composer re-enables.

- [ ] **Step 3: Verify palette behavior.**

- Press ⌘K — palette opens.
- Arrow down to `Stop offering the founder rate` — Enter routes to `/settings?focus=rules&founderRateEnabled=false`.
- Return to `/alex`, press ⌘K — confirm `Follow up with {contact} tonight` and other thread-group commands are disabled (greyed cursor, no click handler).
- Press Escape — palette closes.
- Click the Topbar "Tell Alex…" button — palette opens (same as ⌘K).

- [ ] **Step 4: Verify dispatch fallbacks.**

- Type `reply to Maya` — chip stages with kind=handoff. Press Enter — toast says "Open a thread first." (no route push because `threadContext` is undefined at A.5).
- Type `tell alex about Jordan` — chip stages with kind=context. Press Enter — same toast fallback.

- [ ] **Step 5: Verify cold state.**

- Force cold state by clearing your seed connections (or test against a fresh tenant). Verify `<EmptyState>` renders above the Composer (Composer remains at the bottom and is enabled — per umbrella spec §Day-1 empty state).

- [ ] **Step 6: Verify Riley is unchanged.**

- Load `/riley`. Confirm:
  - The Topbar "Tell Alex…" button renders disabled with "Coming soon" tooltip (`paletteEnabled={false}` per Riley page).
  - The bottom shows `<ComposerPlaceholder>` (greyed inactive bar), not `<Composer>`.
  - ⌘K on `/riley` does **not** open the palette (the listener is mounted in Alex's `CockpitPage` only).

If anything diverges, fix before declaring A.5 done.

---

### Task 10: Pre-merge gates

- [ ] **Step 1: Adapter-boundary grep gate.**

```bash
rg "Recommendation|AuditEntry|@switchboard/db|@prisma" \
   apps/dashboard/src/components/cockpit \
   apps/dashboard/src/hooks
```

Expected: same match set as `main` before A.5. A.5 adds no new dashboard `hooks/` files and no new imports of audit-domain types under `components/cockpit/**`.

- [ ] **Step 2: Surface-agnostic backend grep gate.**

```bash
git diff origin/main -- packages/ apps/api apps/chat apps/mcp-server
```

Expected: empty. A.5 is dashboard-only.

- [ ] **Step 3: Full test sweep.**

```bash
pnpm reset
pnpm typecheck
pnpm lint
pnpm --filter @switchboard/dashboard test
pnpm --filter @switchboard/dashboard build
```

Per `CLAUDE.md`: `pnpm reset` clears any stale `dist/` artifacts before the typecheck pass. Per `feedback_dashboard_build_not_in_ci.md`: the dashboard build is the only gate that catches `.js`-extension regressions in Next.js imports.

- [ ] **Step 4: Prettier format check.**

```bash
pnpm format:check
```

Per `feedback_ci_prettier_not_in_local_lint.md`: CI catches prettier formatting drift that local `pnpm lint` misses. Run before pushing.

- [ ] **Step 5: PR description checklist (paste into the PR body).**

```markdown
## A.5 — Composer + Command Palette

### Layers shipped

- **Dashboard library** — `parse-command.ts` (NL parser port), `alex-commands.ts` (catalog + placeholder), `alex-toast-voice.ts` (voice port), `alex-action-dispatcher.ts` (action.kind dispatch hook).
- **Dashboard components** — `<CommandPalette>` (agent-agnostic), `<Composer>` (agent-agnostic with staging chip).
- **Dashboard wiring** — `cockpit-page.tsx` flips `paletteEnabled={true}`, adds ⌘K keyboard binding, swaps `<ComposerPlaceholder>` for `<Composer>`, renders `<CommandPalette>`.
- **Shared types** — `Command`, `ParsedAction`, `ParsedActionKind`, `CommandGroup`, `ThreadContext` added to `cockpit/types.ts`.

### Decision locks

- No backend, no API route, no Prisma migration, no Zod schema.
- Composer is dashboard-only; commands are UI catalog data.
- `<CommandPalette>` + `<Composer>` are agent-agnostic at the prop layer; Riley B.3-followup reuses without re-derive.
- ⌘K is page-scoped (listener mounts in CockpitPage, unmounts on unmount).
- `pause N (min|h)` does not auto-resume in A.5 (post-Phase-A ramp); copy is honest about manual resume.
- `brief` and `followup` are toast-only stubs; cron + delivery deferred.
- `handoff` and `context` route to `/contacts/[id]` deep links when `threadContext` is set, else fall back to a "Open a thread first" toast. At A.5, `threadContext` is always undefined at the CockpitPage call site (thread-row wire-through deferred).
- Riley keeps `<ComposerPlaceholder>` and `paletteEnabled={false}` until B.3-followup.

### Honest-impact-language review

- [ ] Composer toast voice describes what Alex did with the operator's instruction, never causal claims.
- [ ] "Paused — standing by." not "Saved you from a misfire."
- [ ] `brief` / `followup` toasts explicitly say "stub" to communicate the deferred-cron status.

### Test contract

- [ ] parseCommand green (10 NL patterns + 3 boundary cases)
- [ ] ALEX_COMMANDS green (catalog shape + placeholder string)
- [ ] toastVoice green (10 action.kinds)
- [ ] useAlexActionDispatcher green (kind dispatch + per-id overrides + threadContext fallbacks)
- [ ] CommandPalette green (group order, filter, thread-disable, arrow nav, Enter selects, Escape closes, Riley fixture)
- [ ] Composer green (placeholder, chip, Enter dispatches, Escape clears, halted disables)
- [ ] CockpitPage green (⌘K opens palette, Topbar click opens palette, Escape closes, Composer renders)
- [ ] Pre-merge adapter-boundary grep clean
- [ ] Pre-merge surface-agnostic grep clean (empty packages/ diff)
- [ ] `pnpm --filter @switchboard/dashboard build` clean
- [ ] `pnpm format:check` clean

### What does NOT ship here

(Mirror the slice brief's §"What does NOT ship at A.5" list. Reviewers can grep for "❌" to confirm.)

### Downstream

- Riley B.3-followup: imports `RILEY_COMMANDS` into `<CommandPalette>` + ships `useRileyActionDispatcher` + flips Riley `Topbar.paletteEnabled={true}`. Unblocked by this PR.
- A.6 (retirement): deletes legacy `agent-home-client.tsx` + `*-block.tsx`. Independent of A.5.
- Composer adoption on Riley: optional; the component is agent-agnostic so Riley can swap whenever it wants.
```

---

## Risk Watchlist

These are the same risks listed in the slice brief, with the implementation-side mitigations called out at the relevant tasks:

| #   | Risk                                                | Mitigation                                                                                                                                           | Task |
| --- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | Regex correctness on the NL parser port             | One unit case per pattern (table-driven); boundary cases for empty/multiline/case.                                                                   | 2    |
| 2   | ⌘K conflict with browser native shortcuts           | `event.preventDefault()` + `event.stopPropagation()` in the page-scoped listener; test asserts preventDefault on cockpit-page case.                  | 8    |
| 3   | `pause N (min\|h)` has no auto-resume               | Documented in slice brief; toast copy says "resume to send" (honest manual-resume signal). Auto-resume is a post-Phase-A `HaltProvider` enhancement. | 5    |
| 4   | Dispatcher mocks (`useToast`/`useRouter`/`useHalt`) | Test wraps with `<HaltProvider>` and `vi.mock` for the other two. Pattern matches `proposed-disqualifications-panel.test.tsx`.                       | 5    |
| 5   | Composer keystroke re-renders                       | `parseCommand` is synchronous pure; React batching. No debounce.                                                                                     | 7    |
| 6   | Thread-context wire-through deferred                | Palette filters thread commands as disabled when `threadContext` undefined; dispatcher returns a toast fallback. Both tested.                        | 5, 6 |
| 7   | `brief` / `followup` stub-only behavior             | Toast copy explicitly says "stub"; coverage in `alex-toast-voice.test.ts`.                                                                           | 4    |
| 8   | Composer re-render perf                             | Composer is a leaf; cockpit-page test asserts sibling blocks don't re-render on input change (optional perf case).                                   | 7, 8 |
| 9   | Palette open while halted                           | `resume` from palette still flips halt false; dispatcher test ships the case.                                                                        | 5    |
| 10  | Toast voice port from JS                            | One test case per `action.kind` with locked-design fixture strings.                                                                                  | 4    |

---

## Out-of-band guardrails

Carry-over from prior cockpit slices and CLAUDE.md memories:

- **Worktree discipline (`CLAUDE.md` §Branch & Worktree Doctrine):** This slice runs on its own implementation branch; `docs/alex-cockpit-a5-plan` (the slice brief PR) is a separate docs branch and must merge to `main` before this implementation branch is rebased. Do not stack the two.
- **Test alignment (`feedback_api_test_mocked_prisma.md`):** Not relevant — A.5 ships no API or DB tests. Dashboard tests use the existing Testing-Library + Vitest pattern.
- **Migrate discipline (`feedback_prisma_migrate_dev_tty.md`):** Not relevant — A.5 ships no migration.
- **Module size (`CLAUDE.md`):** `<CommandPalette>` should stay under 400 lines (warn) / 600 lines (error). The locked code above is ≈170 lines — well within limits.
- **Reset before typecheck (`CLAUDE.md`):** If `pnpm typecheck` reports missing exports after editing `apps/dashboard/src/components/cockpit/types.ts`, run `pnpm reset` and retry — turbo's stale `dist/` is the usual cause.
- **Dashboard imports omit `.js` (`feedback_dashboard_no_js_on_any_import.md`):** All imports in `apps/dashboard/**` are extensionless; the `.js` requirement applies to `packages/**` only. A.5 is dashboard-only — every import is extensionless.
- **Dashboard build is not in CI (`feedback_dashboard_build_not_in_ci.md`):** `pnpm --filter @switchboard/dashboard build` is the only way to catch a `.js`-extension regression — run it locally before opening the PR.
- **Modes not knobs (`feedback_modes_not_knobs.md`):** Composer commands are opinionated defaults — no operator-tunable parser, no per-org template, no A/B variants.
- **Adapter-boundary invariant:** The dispatcher hook lives in `apps/dashboard/src/lib/cockpit/` (permitted side); no `Recommendation` / `AuditEntry` / `@switchboard/db` / `@prisma` imports under `components/cockpit/**` or `hooks/use-agent-*`.
- **Surface-agnostic backend invariant:** A.5 touches zero files under `packages/**`, `apps/api/**`, `apps/chat/**`, `apps/mcp-server/**`. Trivially clean.

---

## Estimated effort

Two layers (library + components), 10 implementation tasks. Estimated 4–6 hours for a focused executor using `superpowers:subagent-driven-development`. Risk concentration is at Task 2 (parser regex) and Task 8 (CockpitPage wiring + ⌘K listener + test harness extension); both have well-defined precedents (Riley B.3's typed catalog pattern; A.2's page-level effect pattern).
