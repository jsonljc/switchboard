# Riley Cockpit — Composer adoption on `/riley`

**Date:** 2026-05-15
**Parent spec:** [Riley Cockpit — Wave A Slicing Design](../specs/2026-05-14-riley-cockpit-wave-a-slicing-design.md) (§Slice B.3, §"Composer constraint (locked, verbatim)")
**Target spec:** [Riley Cockpit Home — Design Spec](../specs/2026-05-13-riley-cockpit-home-design.md) (§Composer)
**Predecessor slices:**

- Alex A.5 — `feat(cockpit): A.5 — composer + command palette on /alex` (#542, squash `5a4fe7dc`) — shipped the agent-agnostic `<Composer>` component, `parseCommand` NL parser, `toastVoice` helper, `useAlexActionDispatcher` ParsedAction-shaped pattern.
- Riley B.3-followup — `feat(riley-cockpit): b.3-followup — palette wiring on /riley` (#548, squash `994f5e0e`) — shipped `useRileyActionDispatcher({ onShowMission })` with `RileyCommand` signature, `Topbar.paletteLabel`, page-scoped ⌘K. **Composer adoption deliberately deferred** with note "Riley's NL surface differs from Alex's — needs its own brainstorm."

---

## Why this slice now

`/riley` is one surface short of operator parity with `/alex`. The Topbar's "Tell Riley…" button opens the palette; ⌘K opens the palette; but the input strip at the bottom of the page is still a non-interactive `<ComposerPlaceholder>` (`riley-cockpit-page.tsx:187`). The locked placeholder copy ("Tell Riley what to do — pause the Cold Interests adset, raise daily budget to $200…") already sits in `riley-config.ts:49` waiting for a consumer.

Adopting the live `<Composer>` is a small, contained slice — the heavy lifting (toast doctrine, page-scoped keydown, agent-agnostic composer props, single-owner dispatcher) was already done by Alex A.5 and Riley B.3-followup. The work here is wiring + a tiny parser extension + dispatcher widening, plus the operator-facing decision of which NL phrases dispatch which actions.

The brainstorm session preceding this brief confirmed the v1 NL vocabulary (table below) and the four locked architectural decisions (parser reuse, dispatcher signature widening, single-owner toast, approval-card workflow out of scope).

---

## Slice goal

A `/riley` operator types free-form natural language into the composer at the bottom of the cockpit. Recognized phrases (pause/resume/halt/brief/rule) dispatch real actions; anything else falls through to an `instruction` toast that honestly says "Got it. Acting on '<raw>'." — explicitly **without** firing an unintended mutation. Pressing Escape during staging clears the input; pressing Enter commits the parsed action; the dispatcher is the single owner of toast firing.

The palette continues to work exactly as it does today (B.3-followup); the dispatcher is widened internally so palette commands and composer-parsed actions flow through the same `ParsedAction` shape.

---

## v1 NL vocabulary (locked)

This table was confirmed in the brainstorm session before this brief was committed. **No other phrases dispatch real side effects in v1.** Approval-card workflow for campaign-targeted NL ("pause Cold Interests", "scale BR-Whitening 20%") is explicitly out of scope.

| Operator types                                                                                                                               | Parsed kind   | Dispatcher action                                                  | Toast title (+ description)                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `pause`, `pause for 1h`, `pause 30m`, `pause an hour`, `pause Riley for 1h`, `pause until 3pm`, `pause half an hour`                         | `pause`       | `setHalted(true)` via `useHalt`; reuse `toastVoice(action)`        | "Paused — standing by." + wall-clock projection (e.g. "until 3:23 PM")                  |
| `resume`, `unpause`, `go`                                                                                                                    | `resume`      | `setHalted(false)` via `useHalt`                                   | "Resumed — back to scanning." (Riley-specific copy, distinct from Alex's "picking up…") |
| `halt`, `stop`                                                                                                                               | `halt`        | `setHalted(true)` via `useHalt`; reuse `toastVoice(action)`        | "Halted — stopped everything."                                                          |
| `brief`, `brief me`, `brief me at EOD`                                                                                                       | `brief`       | toast-only stub                                                    | "Noted — brief stub." + "I'll surface scheduled briefs when that ships."                |
| `stop offering X`, `don't send X`, `do not send X`                                                                                           | `rule`        | `router.push("/settings?focus=rules")`; reuse `toastVoice(action)` | "Opening rules." + the rule detail                                                      |
| `follow up with X`, `fu X`                                                                                                                   | `followup`    | fold into `instruction` toast — Riley has no contact threads       | "Got it." + `Acting on "<raw>".`                                                        |
| `reply to X`, `i'll reply to X`                                                                                                              | `handoff`     | fold into `instruction` toast — Riley has no contact threads       | "Got it." + `Acting on "<raw>".`                                                        |
| `tell alex about X`                                                                                                                          | `context`     | fold into `instruction` toast — Riley has no contact threads       | "Got it." + `Acting on "<raw>".`                                                        |
| anything else (`pause the Cold Interests adset`, `raise daily budget to $200`, `scale BR-Whitening 20%`, `shift budget to MED-Awareness`, …) | `instruction` | toast-only stub (no mutation)                                      | "Got it." + `Acting on "<raw>".`                                                        |
| palette selection                                                                                                                            | `command`     | unchanged — per-`commandId` switch from B.3-followup               | unchanged                                                                               |

**Three folded-to-instruction kinds:** `followup`, `handoff`, `context`. Alex's `parseCommand` recognizes these because Alex's surface has contact threads (deep-link to `/contacts/[id]?…`). Riley's `/riley` has no contact-thread surface. The Riley dispatcher routes these three kinds through the `instruction` toast path — same copy, same no-side-effects guarantee — so the parser stays pure and shared, and Riley's behavior is honest ("Got it." not "Replying to Maya" when there's no Maya in scope).

---

## What ships

### Modified — `apps/dashboard/src/lib/cockpit/parse-command.ts`

Three pause regexes widened to accept an optional `(alex|riley)` agent-name prefix between `pause` and the duration:

```ts
// Before:
const PAUSE_FOR = /^pause\s+(?:for\s+)?(\d+)\s*(min|m|h|hour|hours)\b/i;
const PAUSE_WORD =
  /^pause\s+(?:for\s+)?(half\s+an?|an|one|two|three|four|five|six)\s+(hour|hours|min|minute|minutes)\b/i;
const PAUSE_UNTIL = /^pause\s+until\s+(.+)$/i;
const PAUSE_BARE = /^pause(?:\s+alex)?$/i;

// After:
const PAUSE_FOR = /^pause\s+(?:(?:alex|riley)\s+)?(?:for\s+)?(\d+)\s*(min|m|h|hour|hours)\b/i;
const PAUSE_WORD =
  /^pause\s+(?:(?:alex|riley)\s+)?(?:for\s+)?(half\s+an?|an|one|two|three|four|five|six)\s+(hour|hours|min|minute|minutes)\b/i;
const PAUSE_UNTIL = /^pause\s+(?:(?:alex|riley)\s+)?until\s+(.+)$/i;
const PAUSE_BARE = /^pause(?:\s+(?:alex|riley))?$/i;
```

The added group is non-capturing, optional, and tolerant — every existing Alex parse still matches the same arm (the optional group consumes zero characters when absent). Riley operators saying "pause Riley for 1h" now parse honestly into `{ kind: "pause", label: "pause · 1h", detail: "until …" }`.

**No new parser kinds. No new file.** Riley's free-form ad-ops phrases (campaign targeting, budget changes, scale percentages) intentionally fall through to `instruction` — the parser is honest about what it can and can't act on.

### Extended test — `apps/dashboard/src/lib/cockpit/__tests__/parse-command.test.ts`

Five new cases (one per regex arm that learned the agent prefix):

| Case                    | Assertion                                                               |
| ----------------------- | ----------------------------------------------------------------------- |
| `pause riley for 1h`    | `kind === "pause"`, label `"pause · 1h"`, detail starts with `"until "` |
| `pause riley 30m`       | `kind === "pause"`, label `"pause · 30m"`                               |
| `pause riley an hour`   | `kind === "pause"`, label `"pause · 1h"`                                |
| `pause riley until 3pm` | `kind === "pause"`, detail contains `"3pm"`                             |
| `pause riley` (bare)    | `kind === "pause"`, detail `"until you resume"`                         |

Plus one regression test: `pause alex for 1h` (a phrase that previously fell to `instruction` because PAUSE_FOR didn't admit a name between `pause` and the number) now parses as `kind === "pause"`. Documents the symmetric improvement; protects Alex's surface from accidental regression in the opposite direction.

### Modified — `apps/dashboard/src/lib/cockpit/riley-action-dispatcher.ts`

Signature widens from `(command: RileyCommand) => void` to `(action: ParsedAction) => void`. The hook stays a `useCallback` with the same options bag. Internal structure becomes a two-level switch mirroring Alex's `useAlexActionDispatcher`:

```ts
"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useHalt } from "@/components/layout/halt/halt-context";
import { useToast } from "@/components/ui/use-toast";
import { parseCommand } from "./parse-command";
import { toastVoice } from "./alex-toast-voice";
import type { ParsedAction } from "@/components/cockpit/types";

export interface UseRileyActionDispatcherOptions {
  onShowMission: () => void;
}

export type RileyActionDispatcher = (action: ParsedAction) => void;

// Palette command-id → synthetic NL. `parseCommand` does the projection
// (wall-clock for pause-1h, etc.). Mirrors Alex's PER_ID_NL pattern.
const PER_ID_NL: Record<string, string> = {
  "pause-1h": "pause for 1h",
  resume: "resume",
};

const PER_ID_ROUTE: Record<string, string> = {
  "open-meta": "/settings?focus=channels",
  "open-rules": "/settings?focus=rules",
};

export function useRileyActionDispatcher(
  options: UseRileyActionDispatcherOptions,
): RileyActionDispatcher {
  const { setHalted } = useHalt();
  const router = useRouter();
  const { toast } = useToast();
  const { onShowMission } = options;

  return useCallback<RileyActionDispatcher>(
    (action) => {
      // Palette path — discriminated by kind === "command" + commandId.
      if (action.kind === "command" && action.commandId) {
        const nl = PER_ID_NL[action.commandId];
        if (nl) {
          handleParsedKind(parseCommand(nl), setHalted, router, toast);
          return;
        }
        const route = PER_ID_ROUTE[action.commandId];
        if (route) {
          router.push(route);
          if (action.commandId === "open-meta") {
            toast({ title: "Opening Meta connection." });
          } else if (action.commandId === "open-rules") {
            toast({ title: "Opening rules." });
          }
          return;
        }
        if (action.commandId === "open-targets") {
          onShowMission();
          toast({ title: "Opened targets." });
          return;
        }
        if (action.commandId === "brief-eod") {
          toast({
            title: "Noted — brief stub.",
            description: "I'll surface scheduled briefs when that ships.",
          });
          return;
        }
        if (action.commandId === "cpl-30") {
          toast({
            title: "Noted — CPL stub.",
            description: "I'll surface CPL trends when that ships.",
          });
          return;
        }
        // Unmatched commandId — defensive fallthrough to instruction toast.
        toast({ title: "Got it.", description: `Acting on "${action.detail || action.label}".` });
        return;
      }
      // Composer path — ParsedAction from parseCommand.
      handleParsedKind(action, setHalted, router, toast);
    },
    [setHalted, router, toast, onShowMission],
  );
}

function handleParsedKind(
  action: ParsedAction,
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
      // Riley-specific resume copy; toastVoice's Alex idiom ("picking up
      // where I left off") would read wrong on /riley's "scan" mental model.
      toast({ title: "Resumed — back to scanning." });
      return;
    case "halt":
      setHalted(true);
      toast(toastVoice(action));
      return;
    case "rule":
      router.push("/settings?focus=rules");
      toast(toastVoice(action));
      return;
    case "brief":
      toast({
        title: "Noted — brief stub.",
        description: "I'll surface scheduled briefs when that ships.",
      });
      return;
    case "followup":
    case "handoff":
    case "context":
    case "instruction":
      // Riley has no contact-thread surface; followup/handoff/context fold
      // into the same honest "Got it." instruction toast. Same copy as
      // raw instruction so the operator sees identical UX whether they
      // typed "fu Maya" or "raise daily budget to $200".
      toast({
        title: "Got it.",
        description: `Acting on "${action.detail || action.label}".`,
      });
      return;
    case "command":
      // Unreachable — top-level palette discriminator handles this kind.
      // Defensive fallthrough to avoid exhaustiveness errors.
      return;
  }
}
```

**Note on `halt` palette command:** `RILEY_COMMANDS` does NOT include a `halt` entry today (only `pause-1h` + `resume`). The `halt` kind only fires from composer-typed input ("halt", "stop"). PER_ID_NL therefore has no `halt` entry. If a future palette adds Riley `halt`, it follows Alex's pattern: `PER_ID_NL.halt = "halt"`.

**Single-owner toast doctrine preserved.** The hook is the only file in the slice that imports `useToast`. The `<Composer>` and `<CommandPalette>` never do.

### Modified — `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx`

Three edits:

1. Swap `<ComposerPlaceholder ... />` for `<Composer placeholder={RILEY_COMPOSER_PLACEHOLDER} onDispatch={(action) => dispatch(action)} halted={haltCtx.halted} senderLabel="RILEY" accentColor={RILEY_ACCENT.deep} />`. The `senderLabel` and `accentColor` props match the placeholder's existing values (already props in `<Composer>` at composer.tsx:8–15).
2. Update the palette `onSelect` to wrap the command as a `ParsedAction`:
   ```tsx
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
   ```
   Symmetric with Alex's `cockpit-page.tsx:160-175`.
3. Remove the now-unused `ComposerPlaceholder` import (and remove `<ComposerPlaceholder>` entirely from the file).

### Extended test — `apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx`

A new `describe("RileyCockpitPage — composer adoption", …)` block:

| Case                                         | Assertion                                                                                                                                                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Composer renders (not placeholder)           | The bottom input has `role="textbox"` and `aria-label="Composer input"` (the live `<Composer>`'s a11y attributes).                                                                                                                         |
| Composer placeholder is Riley's              | The input `placeholder` attribute matches `RILEY_COMPOSER_PLACEHOLDER`.                                                                                                                                                                    |
| Typing `pause for 1h` + Enter                | `setHalted` called with `true`; toast title `"Paused — standing by."`; description starts with `"until "`.                                                                                                                                 |
| Typing `resume` + Enter                      | `setHalted` called with `false`; toast title `"Resumed — back to scanning."`.                                                                                                                                                              |
| Typing `raise daily budget to $200` + Enter  | `setHalted` NOT called; `router.push` NOT called; toast title `"Got it."`, description matches `Acting on "raise daily budget to $200".` (the `instruction` fallback contract — confirms ad-ops free-form does NOT trigger a side effect). |
| Typing `follow up with Maya tonight` + Enter | `setHalted` NOT called; `router.push` NOT called; toast title `"Got it."` (followup folded into instruction).                                                                                                                              |
| Typing `stop offering free consults` + Enter | `router.push` called with `"/settings?focus=rules"`; toast fires `"Opening rules."` + detail.                                                                                                                                              |
| Escape clears the input                      | After typing "pause", pressing Escape: input value is empty and no dispatch fires.                                                                                                                                                         |
| Composer is disabled when halted             | `haltCtx.halted === true` makes the input `disabled`; placeholder reads `"Halted — resume to send instructions"`.                                                                                                                          |

### Extended test — `apps/dashboard/src/lib/cockpit/__tests__/riley-action-dispatcher.test.tsx`

The existing 9 cases continue to pass (palette path is preserved as a `kind === "command"` discriminator). Add a new `describe("composer path — ParsedAction", …)` block:

| Case                               | Assertion                                                            |
| ---------------------------------- | -------------------------------------------------------------------- |
| pause action                       | `setHalted(true)`; toast `"Paused — standing by." + /^until /`.      |
| resume action                      | `setHalted(false)`; toast `"Resumed — back to scanning."`.           |
| halt action                        | `setHalted(true)`; toast `"Halted — stopped everything."`.           |
| brief action                       | No `setHalted`, no `push`; toast brief-stub copy.                    |
| rule action                        | `push("/settings?focus=rules")`; toast `"Opening rules."` + detail.  |
| followup action                    | No `setHalted`, no `push`; toast `"Got it."` + detail.               |
| handoff action                     | No `setHalted`, no `push`; toast `"Got it."` + detail.               |
| context action                     | No `setHalted`, no `push`; toast `"Got it."` + detail.               |
| instruction action                 | No `setHalted`, no `push`; toast `"Got it."` + detail.               |
| single-owner toast (composer path) | One `toast` call per dispatched ParsedAction across all kinds above. |

The palette tests are updated to call the dispatcher with a wrapped command (`dispatch({ kind: "command", commandId: "pause-1h", ... })`) instead of the raw `RileyCommand` — mirrors the new page-level wrapping. No assertion logic changes.

---

## Architectural invariants (all carried from Alex A.5 + Riley B.3-followup)

1. **Toast boundary locked at exactly one owner.** Only `useRileyActionDispatcher` imports `useToast`. `<Composer>`, `<CommandPalette>`, and `<Topbar>` never do. Verified post-merge by `rg "useToast" apps/dashboard/src/components/cockpit/{composer,command-palette,topbar}.tsx` returning zero matches.
2. **Adapter boundary unchanged.** Zero new imports of `Recommendation` / `AuditEntry` / `@switchboard/db` / `@prisma` under `apps/dashboard/src/components/cockpit/**` or `apps/dashboard/src/hooks/use-riley-*`. Pre-merge grep:
   ```bash
   rg "Recommendation|AuditEntry|@switchboard/db|@prisma" \
      apps/dashboard/src/components/cockpit \
      apps/dashboard/src/hooks
   ```
   Expected: same match count as `main` baseline.
3. **Surface-agnostic backend.** Zero edits under `packages/`, `apps/api`, `apps/chat`, `apps/mcp-server`. This slice is dashboard-only.
4. **Staging-driven Confirm/Undo.** Inherited from `<Composer>`: typing stages a parsed-action chip; Escape clears; Enter commits. No in-toast Undo button, no `setTimeout` rollback. Reversal happens by typing the opposite phrase (e.g., `resume` after a `pause`).
5. **Pure-presentation parser.** `parseCommand` extension is regex-only; no side effects. The agent-prefix groups are non-capturing and consume zero characters when absent, so every existing Alex parse arm continues to match identically.
6. **Honest-impact copy.** All toast titles describe what Riley did, never causal claims. The `instruction` fallback explicitly says `Acting on "<raw>"` rather than implying a successful mutation.

---

## What does NOT ship

Explicit non-goals:

- ❌ **Approval-card workflow for campaign-targeted NL.** Phrases like "pause Cold Interests" or "scale BR-Whitening 20%" fall through to `instruction` — no campaign lookup, no approval enqueuing. That workflow is a separate slice (would need a campaign-resolution server endpoint, an approval-creation path from the composer, and decline/dismiss semantics distinct from the existing recommendation engine).
- ❌ **Riley-specific NL parser.** No `riley-parse-command.ts`. The decision (locked in the brainstorm) is parser-reuse + dispatcher-side discrimination. If Riley grows ad-ops-specific NL ("scale X by Y%") in a future slice, that slice can either add parser arms (preferred, keeps the parser shared) or fork.
- ❌ **Composer chip preview for Riley-distinct kinds.** The chip preview at `composer.tsx:99-118` shows `parsed.icon + parsed.label`. Since Riley uses the same `parseCommand`, the chip rendering is identical to Alex. No Riley-specific chip styling in this slice.
- ❌ **Voice/copy overrides for shared kinds.** Riley reuses Alex's `toastVoice` for `pause`, `halt`, `rule`. Only `resume` and `instruction`-folded kinds get Riley-specific copy. A future "Riley voice pass" could swap more kinds; this slice does not.
- ❌ **B.3 reviewer follow-ups.** Riley `statusColor`/`statusPulse` halted-arg fix and `<Identity>` hardcoded "Alex" name on `/riley` are still separate one-line PRs.
- ❌ **Wave B PRs 2–6.** Bake-period gated; orthogonal.
- ❌ **New mutation paths or schema.** Zero `packages/` edits.

---

## Dependencies

- ✅ Alex A.5 merged (#542, `5a4fe7dc`) — `<Composer>` component, `parseCommand`, `toastVoice`, `ParsedAction` type, dispatcher pattern. All present on `main`.
- ✅ Riley B.3-followup merged (#548, `994f5e0e`) — `useRileyActionDispatcher`, `Topbar.paletteLabel`, palette wiring. The dispatcher signature changes in this slice; the hook's call sites (only `riley-cockpit-page.tsx`) update in lock-step.
- ✅ Riley B.2a merged (#493, `221d711f`) — `missionInteractive` + `onOpenMission` already plumbed to `<Identity>`. `onShowMission` callback unchanged.

No blocking docs PRs.

---

## Risks specific to this slice

1. **Folded `followup`/`handoff`/`context` kinds could surprise an operator.** A Riley operator typing "follow up with the medspa lead at noon" sees the same `"Got it."` toast they'd see for any unrecognized phrase, not a Riley-specific "Riley doesn't manage contact threads" message. **Mitigation:** the `instruction` copy carries the raw input ("Acting on 'follow up with the medspa lead at noon'") so the operator sees that nothing-specific happened. A future slice can add a Riley-side "I can't follow up with contacts — try Alex" guidance toast for these kinds if real operators ask for it; v1 keeps the surface honest without piling on guidance.
2. **`rule` routing pulls the operator off `/riley`.** `router.push("/settings?focus=rules")` navigates away from the cockpit. This is symmetric with Alex's behavior and with Riley's `open-rules` palette command — operators expect rule-edit phrases to take them to the rule surface. **Mitigation:** noted in PR text; if usability feedback during pilot pushes for inline rule editing, that's a separate UX slice.
3. **Composer + palette double-dispatch.** The page mounts both the live `<Composer>` and the `<CommandPalette>`. A future maintainer could route the palette's `onSelect` through the composer's `onDispatch` (creating a chain) — at which point single-owner toast becomes load-bearing. **Mitigation:** the dispatcher's top-level `kind === "command"` discriminator is explicit; the inline comment notes the boundary. The composer and palette tests both assert exactly-one `toast` call.
4. **`pause Riley for 1h` regex change is non-trivial.** The non-capturing optional group is correct but a regex-edit-by-eye risk; a typo could allow `pauseroost for 1h` or break `pause alex`. **Mitigation:** the parse-command test adds explicit cases for `pause riley for 1h`, `pause alex for 1h`, and the existing `pause alex` regression — total of 22 parse-command tests, all green before commit.
5. **`composer.tsx` chip rendering for `instruction` kind.** The chip preview shows `parsed.icon + parsed.label` — for `instruction`, that's `"→ instruction"`. Two characters of noise the operator sees while typing a campaign-targeted phrase. **Mitigation:** not a blocker; the chip is small (`fontSize: 11`) and consistent with Alex's behavior. A future "honest chip" pass could suppress the chip for `instruction` kind.

---

## Test contract

- **Vitest, `apps/dashboard`**:
  - `lib/cockpit/__tests__/parse-command.test.ts` — +6 cases (5 agent-prefix arms + 1 Alex regression). Total 35 cases.
  - `lib/cockpit/__tests__/riley-action-dispatcher.test.tsx` — palette-path cases updated to wrap commands as `ParsedAction`; new composer-path describe block (10 cases). Total ~20 cases.
  - `components/cockpit/__tests__/riley-cockpit-page.test.tsx` — new composer-adoption describe block (9 cases).
- **Adapter-boundary grep** (gate): no new `Recommendation|AuditEntry|@switchboard/db|@prisma` imports under `components/cockpit/**` or `hooks/use-riley-*`.
- **Single-owner toast grep** (gate): `rg "useToast" apps/dashboard/src/components/cockpit/{composer,command-palette,topbar}.tsx` returns zero matches.
- `pnpm typecheck`, `pnpm lint`, `pnpm --filter @switchboard/dashboard test`, `pnpm --filter @switchboard/dashboard build` (per `feedback_dashboard_build_not_in_ci`), `pnpm format:check` (per `ci-prettier-not-in-local-lint`) all clean before the PR opens.

---

## What comes after this slice

- **Riley `statusColor`/`statusPulse` halted-arg fix** — small separate PR (B.3 reviewer follow-up).
- **`<Identity>` per-agent name + avatar** — separate slice; B.1 deferred.
- **External Meta Ads Manager link** — gated on per-org Meta URL plumbing at dispatcher level.
- **Approval-card workflow for campaign-targeted NL** — separate brainstorm if pilot operators ask for it. Would need campaign-name resolution (Meta API or a Riley-side cache), approval-creation path from the composer (currently approvals only originate server-side from the recommendation engine), and decline/dismiss semantics. Significant scope.
- **Riley voice pass** — if operator feedback shows Alex's `toastVoice` reads wrong for additional kinds on `/riley` (currently only `resume` is overridden), a dedicated Riley voice helper can be split out. Cosmetic.
