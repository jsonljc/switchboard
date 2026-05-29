# Riley Cockpit B.3-followup — Palette wiring on `/riley`

**Date:** 2026-05-15
**Parent spec:** [Riley Cockpit — Wave A Slicing Design](../specs/2026-05-14-riley-cockpit-wave-a-slicing-design.md) (§Slice B.3, §"Composer constraint (locked, verbatim)")
**Target spec:** [Riley Cockpit Home — Design Spec](../specs/2026-05-13-riley-cockpit-home-design.md) (§Command palette)
**Predecessor slices:**

- Riley B.3 — `feat(riley-cockpit): B.3 — voice + accent + toast schema` (#507, squash `3b59e4cc`) — shipped the `RILEY_COMMANDS` typed catalog + `rileyToast` voice helper.
- Alex A.5 — `feat(cockpit): A.5 — composer + command palette on /alex` (#542, squash `5a4fe7dc`) — shipped the agent-agnostic `<CommandPalette>` component, page-scoped ⌘K listener pattern, and the single-owner-toast dispatcher pattern (`useAlexActionDispatcher`).

---

## Why this slice now

Riley B.3 (#507) deliberately split the B.3 deliverable into "what does not depend on Alex A.5 infra" and "what does." B.3 shipped the **typed catalog** (`RILEY_COMMANDS` at `apps/dashboard/src/lib/cockpit/riley/riley-config.ts:61`) and the **voice helper** (`rileyToast` at `apps/dashboard/src/lib/cockpit/riley/riley-toast.ts:48`). Both have been on `main` for one day with zero consumers — the Riley `<Topbar>` still passes `paletteEnabled={false}` (`riley-cockpit-page.tsx:110`) and the composer remains a non-interactive `<ComposerPlaceholder>`.

Alex A.5 (#542) merged 2026-05-15 and shipped exactly the four pieces B.3-followup needs:

1. The agent-agnostic `<CommandPalette>` component (`apps/dashboard/src/components/cockpit/command-palette.tsx`) — `{ open, onClose, commands, onSelect, threadContext?, placeholder? }`. Filters via multi-token query, renders by group, gates the `thread` group on `threadContext` presence.
2. The page-scoped ⌘K `useEffect` pattern (`cockpit-page.tsx:55-65`).
3. The single-owner-toast dispatcher pattern (`useAlexActionDispatcher` at `lib/cockpit/alex-action-dispatcher.ts`).
4. `Topbar.paletteEnabled` already accepts `true` + `onOpenPalette` (`topbar.tsx:96-127`).

This slice flips the switch: imports `RILEY_COMMANDS`, ships a parallel `useRileyActionDispatcher`, mounts `<CommandPalette>` on `/riley`, and turns the Topbar palette affordance on. The composer is **deliberately deferred** (see Non-goals).

---

## Slice goal

A `/riley` operator can press ⌘K, see seven Riley-specific commands grouped by intent, select one, and have Riley do the right thing — with one toast firing per selection. Nothing about Riley's data plane changes. No schema. No package edits.

---

## What ships

### New file — `apps/dashboard/src/lib/cockpit/riley-action-dispatcher.ts`

Mirrors Alex's dispatcher location (top-level under `lib/cockpit/`, not under `lib/cockpit/riley/`) — symmetric file naming makes the agent-pair pattern legible. Approximately 80–100 lines.

```ts
"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useHalt } from "@/components/layout/halt/halt-context";
import { useToast } from "@/components/ui/use-toast";
import { parseCommand } from "./parse-command";
import { toastVoice } from "./alex-toast-voice";
import type { RileyCommand } from "./riley/riley-config";

export interface UseRileyActionDispatcherOptions {
  /** Force-opens the mission popover. Wired from the page's `setMissionOpen(true)`. */
  onShowMission: () => void;
}

export type RileyActionDispatcher = (command: RileyCommand) => void;

export function useRileyActionDispatcher(
  options: UseRileyActionDispatcherOptions,
): RileyActionDispatcher {
  const { setHalted } = useHalt();
  const router = useRouter();
  const { toast } = useToast();
  const { onShowMission } = options;

  return useCallback<RileyActionDispatcher>(
    (command) => {
      switch (command.id) {
        case "open-meta":
          router.push("/settings?focus=channels");
          toast({ title: "Opening Meta connection." });
          return;
        case "open-rules":
          router.push("/settings?focus=rules");
          toast({ title: "Opening rules." });
          return;
        case "open-targets":
          onShowMission();
          toast({ title: "Opened targets." });
          return;
        case "pause-1h": {
          // Reuse Alex's parser + voice helper for the wall-clock projection.
          // toastVoice's "pause" case returns { title: "Paused — standing by.",
          // description: action.detail } — Riley's brand voice matches Alex
          // here, so reuse is honest, not borrowed.
          const synthetic = parseCommand("pause for 1h");
          setHalted(true);
          toast(toastVoice(synthetic));
          return;
        }
        case "resume":
          setHalted(false);
          toast({ title: "Resumed — back to scanning." });
          return;
        case "brief-eod":
          toast({
            title: "Noted — brief stub.",
            description: "I'll surface scheduled briefs when that ships.",
          });
          return;
        case "cpl-30":
          toast({
            title: "Noted — CPL stub.",
            description: "I'll surface CPL trends when that ships.",
          });
          return;
      }
    },
    [setHalted, router, toast, onShowMission],
  );
}
```

**Single-owner toast doctrine preserved.** The hook is the only file in the slice that imports `useToast`. The page and the palette never do.

### Modified — `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx`

Six edits, all in the page body:

1. Add `paletteOpen` state (`useState<boolean>(false)`).
2. Add a page-scoped ⌘K / Ctrl+K listener (`useEffect`, mirroring Alex `cockpit-page.tsx:55-65`).
3. Instantiate the dispatcher: `const dispatch = useRileyActionDispatcher({ onShowMission: () => setMissionOpen(true) });`.
4. Flip `<Topbar paletteEnabled={false}` → `paletteEnabled onOpenPalette={() => setPaletteOpen(true)} paletteLabel="Tell Riley…"`.
5. Mount `<CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={RILEY_COMMANDS} onSelect={(cmd) => { setPaletteOpen(false); dispatch(cmd); }} />` at the bottom of the tree (after `<ComposerPlaceholder>`).
6. No change to `<ComposerPlaceholder>` — it stays inert. The composer adoption on `/riley` is its own future slice.

### Modified — `apps/dashboard/src/components/cockpit/topbar.tsx`

Add one optional prop: `paletteLabel?: string` (default `"Tell Alex…"`). Replace the hardcoded `"Tell Alex…"` string at `topbar.tsx:114` with `{paletteLabel}`. Alex's `cockpit-page.tsx` continues to call `<Topbar paletteEnabled onOpenPalette={…} />` without passing `paletteLabel` — default keeps Alex's chrome literally identical.

This is a **forced deviation** from the locked "palette only, no Topbar edits" reading of the scope — but flipping `paletteEnabled=true` without changing the label would ship a `/riley` page whose primary affordance reads "Tell Alex…". That is a copy regression a reviewer will (correctly) reject. The fix is one prop, three lines, and Alex's render is byte-identical via the default.

### New test — `apps/dashboard/src/lib/cockpit/__tests__/riley-action-dispatcher.test.tsx`

Seven cases (one per command) plus three structural cases:

| Case               | Assertion                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `open-meta`        | `router.push` called with `"/settings?focus=channels"`; toast fires "Opening Meta connection."                                             |
| `open-rules`       | `router.push` called with `"/settings?focus=rules"`; toast fires "Opening rules."                                                          |
| `open-targets`     | `onShowMission` callback invoked; `router.push` not called; toast fires "Opened targets."                                                  |
| `pause-1h`         | `setHalted(true)`; toast title is "Paused — standing by." and description starts with "until" (wall-clock projection from `parseCommand`). |
| `resume`           | `setHalted(false)`; toast fires "Resumed — back to scanning."                                                                              |
| `brief-eod`        | No `router.push`, no `setHalted`; toast fires stub copy.                                                                                   |
| `cpl-30`           | No `router.push`, no `setHalted`; toast fires stub copy.                                                                                   |
| Single-owner toast | Each command fires exactly one `toast` call.                                                                                               |
| Stable identity    | Repeated invocations with the same options return identical dispatcher reference (`useCallback` correctness).                              |
| Unknown command id | Switch is exhaustive on the seven `RILEY_COMMANDS`; an unknown id is a TypeScript error at compile time, not a runtime branch.             |

### Extended test — `apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx`

A new `describe("RileyCockpitPage — B.3-followup palette wiring", …)` block:

| Case                                         | Assertion                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Topbar palette button is enabled             | The `"Tell Riley…"` button has `disabled={false}` and `aria-disabled="false"`.                          |
| Topbar palette label reads "Tell Riley…"     | The button text is `"Tell Riley…"`, not `"Tell Alex…"`.                                                 |
| Clicking the Topbar button opens the palette | Palette dialog with `aria-label="Command palette"` appears.                                             |
| ⌘K opens the palette                         | `keydown` event with `metaKey` and `key: "k"` fires and the palette opens.                              |
| Escape closes the palette                    | After opening, pressing Escape removes the dialog.                                                      |
| Selecting a command fires the dispatcher     | Selecting `"Pause Riley for 1h"` calls `setHalted(true)` and fires a toast.                             |
| Palette closes after selection               | Dialog is removed after `onSelect` resolves.                                                            |
| `<ComposerPlaceholder>` still renders        | The composer remains the non-interactive placeholder — this slice does not adopt the live `<Composer>`. |

### Extended test — `apps/dashboard/src/components/cockpit/__tests__/topbar.test.tsx`

One case: passing `paletteLabel="Tell Riley…"` renders that label; omitting the prop renders `"Tell Alex…"`.

---

## Per-command handler table (final)

The brief locks this table. **Three handlers differ from the proposing-message defaults; each deviation is documented inline.**

| Command        | Group     | Handler                                                                                                          | Toast title                                                              | Deviation from proposed defaults?                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------- | --------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open-meta`    | `nav`     | `router.push("/settings?focus=channels")`                                                                        | "Opening Meta connection."                                               | **Yes.** Proposed was `window.open(metaAdsManagerUrl)`. No per-org Meta Ads Manager URL is plumbed to the dispatcher level today (the only external Meta URLs in the cockpit come from `approval.primaryAction.url` populated server-side). Routing to the channels settings page is symmetric with Alex's `open-meta` handler (which routes to `/settings?focus=channels`) and uses infrastructure that exists. If a future slice adds an `org.metaAdsManagerUrl`, the handler can flip to `window.open` without changing the catalog or the palette.                                                               |
| `open-rules`   | `rules`   | `router.push("/settings?focus=rules")`                                                                           | "Opening rules."                                                         | **Yes.** Proposed was `router.push("/automations")` (flagged uncertain in the proposing message). Riley's standing-rules surface lives in agent settings, symmetric with Alex's `open-rules` handler (`/settings?focus=rules`). `/automations` is a real route but hosts org-wide automation rules, not Riley's per-agent standing rules. Going symmetric is the safe call; can flip later if `/automations` becomes the per-agent rules home.                                                                                                                                                                       |
| `open-targets` | `rules`   | call page-supplied `onShowMission()` (force-open, not toggle)                                                    | "Opened targets."                                                        | **No** (modulo the toggle-vs-force decision). The dispatcher cannot reach the page's `missionOpen` local state directly. The hook takes an `onShowMission` callback in its options bag; the page wires it as `() => setMissionOpen(true)` so palette selection always opens the popover (never closes a popover that's already open). The Identity component's existing `onOpenMission` prop is a toggle (`(o) => !o`); using the toggle here would close the popover if the operator opens it from the palette while it's already open from Identity — non-intuitive. Force-open is the operator-correct semantics. |
| `pause-1h`     | `control` | `setHalted(true)` via `useHalt`; reuses `toastVoice(parseCommand("pause for 1h"))` for the wall-clock projection | "Paused — standing by." + "until 3:23 PM" (example)                      | **No.** Matches Alex A.5 #7 (no auto-resume in v1). Reusing Alex's `parseCommand` + `toastVoice` for the projection is intentional — the brand voice line "Paused — standing by." is identical across both agents, and `parseCommand`/`toastVoice` are agent-agnostic by design (the file path `alex-toast-voice.ts` is incidental; the function operates on a `ParsedAction` shape with no Alex-specific assumptions).                                                                                                                                                                                              |
| `resume`       | `control` | `setHalted(false)`                                                                                               | "Resumed — back to scanning."                                            | **No** (Riley-specific copy). Riley says "back to scanning" — the idiom established by Riley's approval-decline fallbacks at `riley-toast.ts:10-46`. Alex's resume toast says "picking up where I left off." — different idioms, both honest, kept distinct.                                                                                                                                                                                                                                                                                                                                                         |
| `brief-eod`    | `thread`  | toast-only stub; no side effect                                                                                  | "Noted — brief stub." + "I'll surface scheduled briefs when that ships." | **No.** Matches Alex A.5 #8.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `cpl-30`       | `thread`  | toast-only stub; no side effect                                                                                  | "Noted — CPL stub." + "I'll surface CPL trends when that ships."         | **No.** Same pattern as `brief-eod`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

**No command in `RILEY_COMMANDS` requires `threadContext`.** Riley's catalog has no contact-targeted commands like Alex's `fu-named` / `reply-named` / `hold-named`. So `threadContext` is never plumbed and never consulted by the dispatcher — the palette filter at `command-palette.tsx:55` (which gates the `thread` group on `threadContext` presence) would in theory hide Riley's `thread`-group commands. **This is a real concern**: Riley's `brief-eod` and `cpl-30` are in the `thread` group per `RILEY_COMMANDS`, but they are agent-level commands (no per-contact context), so the palette filter would hide them under `threadContext === undefined`.

**Resolution:** the existing `command-palette.tsx:55` rule is too strict for Riley's catalog. The rule was designed for Alex's `fu-named` etc., which contain `{contact}` placeholders that need a contact name. Riley's `thread`-group commands have no `{…}` placeholders. The fix is to relax the gate at the palette: gate on the _command label_ containing `{` (i.e., needs interpolation), not on group membership. One-line change in `command-palette.tsx`, fully back-compatible (Alex's labels all contain `{contact}`; Riley's contain none).

If the user prefers not to touch `command-palette.tsx`, the alternative is to re-classify Riley's `brief-eod` / `cpl-30` to a different group (e.g., a new `summary` group, or move them into `control`). That would touch the catalog (`riley-config.ts`) and the `RILEY_COMMANDS` test. Either path works; the palette change is the smaller, more honest fix. **The slice brief picks the palette change** — the implementation plan locks the diff and the test case.

---

## Architectural invariants (all carried from Alex A.5)

1. **Toast boundary is locked at exactly one owner.** Only `useRileyActionDispatcher` imports `useToast`. `<CommandPalette>` and `<Topbar>` never do. Verified post-merge by `rg "useToast" apps/dashboard/src/components/cockpit/{command-palette,topbar}.tsx` returning zero matches.
2. **⌘K is page-scoped, not shell-scoped.** The `document.addEventListener("keydown", …)` lives in `RileyCockpitPage`'s `useEffect` and is removed on unmount. No global keymap registry. The native browser ⌘K is preempted only while `/riley` is the active page.
3. **Adapter boundary unchanged.** Zero new imports of `Recommendation` / `AuditEntry` / `@switchboard/db` / `@prisma` under `apps/dashboard/src/components/cockpit/**` or `apps/dashboard/src/hooks/use-riley-*`. Pre-merge grep:

   ```bash
   rg "Recommendation|AuditEntry|@switchboard/db|@prisma" \
      apps/dashboard/src/components/cockpit \
      apps/dashboard/src/hooks
   ```

   Expected: same match count as `main` baseline.

4. **Surface-agnostic backend.** Zero edits under `packages/`, `apps/api`, `apps/chat`, `apps/mcp-server`. This slice is dashboard-only.
5. **Honest-impact-language audit clean.** Toast copy describes what Riley did, never causal claims. "Paused — standing by." not "Saved you from a misfire."
6. **Composer-deferral preserved.** `<ComposerPlaceholder>` continues to render on `/riley` — the live `<Composer>` is not adopted in this slice. Composer adoption would require Riley-side NL parsing decisions (Riley's brand-voice composer would dispatch a wider set of actions than the palette covers); that brainstorm is deferred to a future slice.

---

## What does NOT ship

Explicit non-goals:

- ❌ **Live composer on `/riley`.** The non-interactive `<ComposerPlaceholder>` stays. No Riley NL parser, no Riley free-form input. A future "Alex-on-Riley" slice will scope this; it requires its own brainstorm because Riley's command surface differs from Alex's.
- ❌ **Topbar avatar / identity fix.** The Topbar still shows the placeholder `M` avatar. Unrelated to palette wiring; out of scope.
- ❌ **`statusColor`/`statusPulse` halted-arg handling.** The B.3 reviewer-flagged follow-up (Riley `statusColor`/`statusPulse` ignore the `halted` argument) is a separate one-line fix; not bundled.
- ❌ **`<Identity>` hardcoded "Alex" name on `/riley`.** B.1 limitation; explicitly out of scope.
- ❌ **Wave B PRs 2–6.** Bake-period gated; not relevant here.
- ❌ **A.6 retirement.** Alex's last Phase A slice; separate workstream.
- ❌ **New mutation paths.** B.3-followup adds zero new endpoints, zero new actions.
- ❌ **`threadContext` wire-through.** Riley's catalog doesn't need it; the palette-filter relaxation handles Riley correctly without plumbing thread context to the cockpit.

---

## Dependencies

- ✅ Alex A.5 merged (#542, `5a4fe7dc`) — `<CommandPalette>`, page-scoped ⌘K pattern, dispatcher pattern, `Topbar.paletteEnabled` accept-true contract. All present on `main`.
- ✅ Riley B.3 merged (#507, `3b59e4cc`) — `RILEY_COMMANDS` typed catalog + `rileyToast` fallback table both on `main`. (Note: `rileyToast` is verdict-based, used by approval-resolution. The palette slice does not import it — palette-side toasts are inline copy via `useToast` from the dispatcher.)
- ✅ Riley B.2a merged (#493, `221d711f`) — `RileyCockpitPage` already plumbs `missionInteractive` + `onOpenMission` to `<Identity>` and tracks `missionOpen` state. The new `onShowMission` dispatcher callback wires `() => setMissionOpen(true)` against existing state; no new state needed.
- ✅ Riley B.2b merged (#522, `80f6d242`) — orthogonal; not a dependency.

No blocking docs PRs. The Riley Wave A slicing spec is already on `main` (#497, squash `0afb2323`).

---

## Risks specific to B.3-followup

1. **`command-palette.tsx:55` thread-group filter is too strict for Riley.** Without fixing, Riley's `brief-eod` / `cpl-30` commands would render disabled forever (`threadContext === undefined` always at the cockpit-page call site). **Mitigation:** the implementation plan opens with this fix; gate on label-contains-`{` instead of group-membership. The fix preserves Alex's behavior exactly (every Alex `thread`-group label contains `{contact}`) and unblocks Riley's catalog. The palette test gets one new case asserting Riley's `thread` commands render enabled.

2. **Topbar label regression.** Flipping `paletteEnabled` without the new `paletteLabel` prop would ship a `/riley` button reading "Tell Alex…". **Mitigation:** the `paletteLabel` prop addition is bundled in this slice; a test asserts the Riley page renders "Tell Riley…". The default value keeps Alex's render byte-identical.

3. **`onShowMission` dispatcher coupling.** The dispatcher hook now requires an options bag — a future Riley call site forgetting `onShowMission` is a TypeScript error (the option is required, not optional). **Mitigation:** the type system enforces this; no runtime fallback needed.

4. **Double-toast risk if a future maintainer routes palette → composer → dispatcher.** If a future "Alex on Riley" slice wires the palette through the composer (Composer sees command-staged input, dispatches via the same dispatcher), the chain must not fire two toasts. **Mitigation:** Alex A.5's locked doctrine (toast only in the dispatcher) carries forward; explicit comment in `useRileyActionDispatcher` notes the single-owner rule. The composer-adoption brainstorm will re-validate.

5. **`parseCommand("pause for 1h")` time projection drifts every minute.** Tests must not assert the exact projected wall-clock time. **Mitigation:** the dispatcher test asserts only that the description starts with `"until "` (same loose match used by `parse-command.test.ts:120-…`).

6. **External Meta link plumbing is genuinely missing.** The "open external Meta Ads Manager" intent the user originally proposed for `open-meta` is a real operator need — but it requires the org's Meta connection state at the dispatcher level. **Mitigation:** flagged explicitly in PR description; the symmetric `/settings?focus=channels` handler is correct-for-now (it routes to the page where Meta connection is configured, so the user reaches Meta one click downstream). A follow-up slice can plumb the URL when there's a clean place to read it.

---

## Test contract

- **Vitest, `apps/dashboard`**:
  - `lib/cockpit/__tests__/riley-action-dispatcher.test.tsx` — 10 cases (7 command cases + 3 structural).
  - `components/cockpit/__tests__/riley-cockpit-page.test.tsx` — new `describe("RileyCockpitPage — B.3-followup palette wiring", …)` block, 8 cases.
  - `components/cockpit/__tests__/topbar.test.tsx` — 1 case for `paletteLabel`.
  - `components/cockpit/__tests__/command-palette.test.tsx` — 1 case asserting commands without `{…}` placeholders in their labels render enabled regardless of `threadContext`.
- **Adapter-boundary grep** (gate): no new `Recommendation|AuditEntry|@switchboard/db|@prisma` imports under `components/cockpit/**` or `hooks/use-riley-*`.
- **Single-owner toast grep** (gate): `rg "useToast|rileyToast" apps/dashboard/src/components/cockpit/{command-palette,topbar}.tsx apps/dashboard/src/components/cockpit/composer-placeholder.tsx` returns zero matches.
- `pnpm typecheck`, `pnpm lint`, `pnpm --filter @switchboard/dashboard test`, `pnpm --filter @switchboard/dashboard build` (per `feedback_dashboard_build_not_in_ci`) all clean before the PR opens.

---

## What comes after B.3-followup

- **Riley composer adoption** (separate brainstorm) — bring the live `<Composer>` to `/riley`. Requires Riley-side NL parsing decisions: which natural-language phrases dispatch which actions, how `parseCommand`'s Alex-shaped output maps to Riley's command vocabulary, whether Riley wants its own parser. Composer adoption is its own slice; this followup ships the palette only.
- **Riley `statusColor`/`statusPulse` halted-arg fix** — small separate PR (B.3 reviewer follow-up).
- **`<Identity>` per-agent name + avatar** — separate slice; B.1 deferred.
- **External Meta Ads Manager link** — if a per-org URL becomes available at the dispatcher level, `open-meta` flips from `router.push` to `window.open`. Requires plumbing decision; out of scope here.
