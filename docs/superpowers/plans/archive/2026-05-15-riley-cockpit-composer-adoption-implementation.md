# Riley Cockpit — Composer Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inert `<ComposerPlaceholder>` on `/riley` with the live `<Composer>`, extend `parseCommand` to recognize `pause Riley for 1h` style phrasing, widen `useRileyActionDispatcher` from `(RileyCommand) => void` to `(ParsedAction) => void` so palette commands and composer-parsed actions flow through the same shape, and fold `followup`/`handoff`/`context` kinds into the honest `instruction` toast (Riley has no contact-thread surface).

**Architecture:** Mirror Alex A.5's two-level dispatcher pattern — a top-level discriminator on `kind === "command" + commandId` (palette path) and a shared `handleParsedKind` for the composer path. Both palette commands and composer input land in the same single-owner-toast hook. The parser stays shared; Riley's NL behaves identically to Alex's for the kinds Riley honors, and the dispatcher folds Alex-shaped contact-thread kinds into the honest `instruction` toast. Zero schema changes, zero package edits.

**Tech Stack:** Next.js 14 App Router, React 18, TanStack Query, Vitest + Testing Library, shadcn/ui `useToast`.

**Parent design:** [Riley Cockpit — Composer adoption on `/riley`](./2026-05-15-riley-cockpit-composer-adoption-slice-brief.md)

---

## File map

**Modify:**

- `apps/dashboard/src/lib/cockpit/parse-command.ts` — extend three pause regexes (`PAUSE_FOR`, `PAUSE_WORD`, `PAUSE_UNTIL`) and one bare regex (`PAUSE_BARE`) to accept an optional `(alex|riley)` agent-name prefix.
- `apps/dashboard/src/lib/cockpit/__tests__/parse-command.test.ts` — add 6 cases (5 Riley prefix arms + 1 Alex symmetry regression).
- `apps/dashboard/src/lib/cockpit/riley-action-dispatcher.ts` — widen exported `RileyActionDispatcher` from `(RileyCommand) => void` to `(ParsedAction) => void`; restructure body with top-level palette discriminator + shared `handleParsedKind`.
- `apps/dashboard/src/lib/cockpit/__tests__/riley-action-dispatcher.test.tsx` — update existing 9 palette-path cases to wrap commands as `ParsedAction`; add a new `describe("composer path — ParsedAction", …)` block (10 cases).
- `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx` — swap `<ComposerPlaceholder>` for `<Composer>`, wrap palette `onSelect` command as `ParsedAction`, remove `ComposerPlaceholder` import.
- `apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx` — add a new `describe("RileyCockpitPage — composer adoption", …)` block (9 cases).

**Do NOT touch:**

- `packages/**`, `apps/api/**`, `apps/chat/**`, `apps/mcp-server/**` (surface-agnostic backend invariant).
- `apps/dashboard/src/components/cockpit/composer.tsx` (already agent-agnostic at the prop layer).
- `apps/dashboard/src/components/cockpit/command-palette.tsx` (B.3-followup already relaxed the filter).
- `apps/dashboard/src/components/cockpit/topbar.tsx` (B.3-followup already added `paletteLabel`).
- `apps/dashboard/src/lib/cockpit/alex-action-dispatcher.ts`, `apps/dashboard/src/lib/cockpit/alex-toast-voice.ts` (Riley reuses them via import — no edits).
- `apps/dashboard/src/components/cockpit/composer-placeholder.tsx` (still used by tests / `/alex` cold state if any; no removal in this slice).

---

## Task 1: Extend `parseCommand` to admit optional `(alex|riley)` agent-name prefix

**Files:**

- Modify: `apps/dashboard/src/lib/cockpit/parse-command.ts`
- Test: `apps/dashboard/src/lib/cockpit/__tests__/parse-command.test.ts`

- [ ] **Step 1: Write the failing tests**

Append at the end of the `describe("parseCommand", …)` block in `apps/dashboard/src/lib/cockpit/__tests__/parse-command.test.ts`:

```ts
it("pause riley for 1h", () => {
  const r = parseCommand("pause riley for 1h");
  expect(r.kind).toBe("pause");
  expect(r.label).toMatch(/1h/);
  expect(r.detail).toMatch(/^until /);
});

it("pause riley 30m", () => {
  const r = parseCommand("pause riley 30m");
  expect(r.kind).toBe("pause");
  expect(r.label).toMatch(/30m/);
});

it("pause riley an hour (word quantifier with agent prefix)", () => {
  const r = parseCommand("pause riley an hour");
  expect(r.kind).toBe("pause");
  expect(r.label).toMatch(/1h/);
});

it("pause riley until 3pm", () => {
  const r = parseCommand("pause riley until 3pm");
  expect(r.kind).toBe("pause");
  expect(r.detail).toContain("3pm");
});

it("pause riley (bare)", () => {
  const r = parseCommand("pause riley");
  expect(r.kind).toBe("pause");
  expect(r.detail).toBe("until you resume");
});

it("pause alex for 1h (symmetric Alex prefix in PAUSE_FOR)", () => {
  // Regression: PAUSE_FOR previously did not admit a name between
  // 'pause' and the duration. The widening also fixes the Alex form.
  const r = parseCommand("pause alex for 1h");
  expect(r.kind).toBe("pause");
  expect(r.label).toMatch(/1h/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/switchboard && pnpm --filter @switchboard/dashboard test -- src/lib/cockpit/__tests__/parse-command.test.ts
```

Expected: the 6 new tests fail with `kind === "instruction"` (the current parser falls through because the regexes don't admit a name between `pause` and the duration/until/digit).

- [ ] **Step 3: Widen the four pause regexes**

In `apps/dashboard/src/lib/cockpit/parse-command.ts`, replace lines 3–6:

```ts
const PAUSE_FOR = /^pause\s+(?:for\s+)?(\d+)\s*(min|m|h|hour|hours)\b/i;
const PAUSE_WORD =
  /^pause\s+(?:for\s+)?(half\s+an?|an|one|two|three|four|five|six)\s+(hour|hours|min|minute|minutes)\b/i;
const PAUSE_UNTIL = /^pause\s+until\s+(.+)$/i;
const PAUSE_BARE = /^pause(?:\s+alex)?$/i;
```

with:

```ts
const PAUSE_FOR = /^pause\s+(?:(?:alex|riley)\s+)?(?:for\s+)?(\d+)\s*(min|m|h|hour|hours)\b/i;
const PAUSE_WORD =
  /^pause\s+(?:(?:alex|riley)\s+)?(?:for\s+)?(half\s+an?|an|one|two|three|four|five|six)\s+(hour|hours|min|minute|minutes)\b/i;
const PAUSE_UNTIL = /^pause\s+(?:(?:alex|riley)\s+)?until\s+(.+)$/i;
const PAUSE_BARE = /^pause(?:\s+(?:alex|riley))?$/i;
```

The added `(?:(?:alex|riley)\s+)?` group is non-capturing and optional. Every existing match arm continues to match identically when the operator does not type a name. No capture groups shift.

- [ ] **Step 4: Run the full parse-command test suite**

```bash
cd ~/switchboard && pnpm --filter @switchboard/dashboard test -- src/lib/cockpit/__tests__/parse-command.test.ts
```

Expected: all 35 tests pass (29 original + 6 new). No prior test breaks because the optional group consumes zero characters when absent.

- [ ] **Step 5: Commit**

```bash
cd ~/switchboard && git add apps/dashboard/src/lib/cockpit/parse-command.ts \
  apps/dashboard/src/lib/cockpit/__tests__/parse-command.test.ts
git commit -m "feat(cockpit): parse-command admits optional (alex|riley) prefix on pause"
```

---

## Task 2: Widen `useRileyActionDispatcher` to accept `ParsedAction`

**Files:**

- Modify: `apps/dashboard/src/lib/cockpit/riley-action-dispatcher.ts`
- Test: `apps/dashboard/src/lib/cockpit/__tests__/riley-action-dispatcher.test.tsx`

- [ ] **Step 1: Update existing palette-path tests to wrap commands as `ParsedAction`**

In `apps/dashboard/src/lib/cockpit/__tests__/riley-action-dispatcher.test.tsx`, replace the `cmd(id)` helper (lines 22–26) so it returns a `ParsedAction`-shaped command rather than the raw `RileyCommand`:

```tsx
import type { ParsedAction } from "@/components/cockpit/types";

function cmd(id: string): ParsedAction {
  const found = RILEY_COMMANDS.find((c) => c.id === id);
  if (!found) throw new Error(`unknown RILEY_COMMANDS id: ${id}`);
  return {
    kind: "command",
    icon: "·",
    label: found.label,
    detail: "",
    raw: "",
    commandId: found.id,
  };
}
```

The 9 existing palette-path test bodies do not change — they continue to call `result.current(cmd("..."))`. The dispatcher's behavior for these inputs is preserved.

- [ ] **Step 2: Add a new `describe("composer path — ParsedAction", …)` block**

Append at the end of `apps/dashboard/src/lib/cockpit/__tests__/riley-action-dispatcher.test.tsx` (after the existing `describe("useRileyActionDispatcher", …)` closing brace):

```tsx
import { parseCommand } from "../parse-command";

describe("useRileyActionDispatcher — composer path (ParsedAction)", () => {
  let onShowMission: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setHalted.mockReset();
    push.mockReset();
    toast.mockReset();
    onShowMission = vi.fn();
  });

  it("pause kind: setHalted(true) + toastVoice projection", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    act(() => result.current(parseCommand("pause for 1h")));
    expect(setHalted).toHaveBeenCalledWith(true);
    expect(toast).toHaveBeenCalledTimes(1);
    const payload = toast.mock.calls[0]![0] as { title: string; description?: string };
    expect(payload.title).toBe("Paused — standing by.");
    expect(payload.description).toMatch(/^until /);
  });

  it("resume kind: setHalted(false) + Riley copy", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    act(() => result.current(parseCommand("resume")));
    expect(setHalted).toHaveBeenCalledWith(false);
    expect(toast).toHaveBeenCalledWith({ title: "Resumed — back to scanning." });
  });

  it("halt kind: setHalted(true) + Alex toastVoice", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    act(() => result.current(parseCommand("halt")));
    expect(setHalted).toHaveBeenCalledWith(true);
    expect(toast).toHaveBeenCalledWith({ title: "Halted — stopped everything." });
  });

  it("brief kind: toast-only stub", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    act(() => result.current(parseCommand("brief me at EOD")));
    expect(setHalted).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({
      title: "Noted — brief stub.",
      description: "I'll surface scheduled briefs when that ships.",
    });
  });

  it("rule kind: router.push + toastVoice", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    act(() => result.current(parseCommand("stop offering free consults")));
    expect(push).toHaveBeenCalledWith("/settings?focus=rules");
    expect(toast).toHaveBeenCalledTimes(1);
    const payload = toast.mock.calls[0]![0] as { title: string };
    expect(payload.title).toBe("Opening rules.");
  });

  it("followup kind folds into instruction toast (no side effects)", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    act(() => result.current(parseCommand("follow up with Maya tonight")));
    expect(setHalted).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    const payload = toast.mock.calls[0]![0] as { title: string; description: string };
    expect(payload.title).toBe("Got it.");
    expect(payload.description).toMatch(/Acting on/);
  });

  it("handoff kind folds into instruction toast (no side effects)", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    act(() => result.current(parseCommand("reply to Maya")));
    expect(setHalted).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(toast.mock.calls[0]![0]).toMatchObject({ title: "Got it." });
  });

  it("context kind folds into instruction toast (no side effects)", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    act(() => result.current(parseCommand("tell alex about Maya")));
    expect(setHalted).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(toast.mock.calls[0]![0]).toMatchObject({ title: "Got it." });
  });

  it("instruction kind (ad-ops free-form): toast-only, no side effects", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    act(() => result.current(parseCommand("raise daily budget to $200")));
    expect(setHalted).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    const payload = toast.mock.calls[0]![0] as { title: string; description: string };
    expect(payload.title).toBe("Got it.");
    expect(payload.description).toContain('Acting on "raise daily budget to $200".');
  });

  it("composer path fires exactly one toast per dispatch (single-owner doctrine)", () => {
    const { result } = renderHook(() => useRileyActionDispatcher({ onShowMission }));
    const phrases = [
      "pause for 1h",
      "resume",
      "halt",
      "brief me",
      "stop offering X",
      "follow up with Y",
      "reply to Y",
      "tell alex about Y",
      "raise daily budget to $200",
    ];
    for (const phrase of phrases) {
      toast.mockReset();
      act(() => result.current(parseCommand(phrase)));
      expect(toast).toHaveBeenCalledTimes(1);
    }
  });
});
```

- [ ] **Step 3: Run tests to verify the composer-path block fails (palette block should still pass)**

```bash
cd ~/switchboard && pnpm --filter @switchboard/dashboard test -- src/lib/cockpit/__tests__/riley-action-dispatcher.test.tsx
```

Expected: the 10 composer-path tests fail because the current dispatcher signature is `(command: RileyCommand) => void` and rejects a `ParsedAction` whose `kind !== "command"`. The 9 palette-path tests continue to pass under the new `cmd()` helper because `{ kind: "command", commandId, ... }` still routes through the existing `switch (command.id)` body **only if we update the dispatcher first** — they will fail until Step 4 lands. Both blocks must turn green together.

- [ ] **Step 4: Rewrite the dispatcher with the two-level structure**

Replace the entire contents of `apps/dashboard/src/lib/cockpit/riley-action-dispatcher.ts` with:

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
  /**
   * Force-opens the mission popover. Wired from the page's
   * `setMissionOpen(true)`. The page's existing `onOpenMission` prop on
   * `<Identity>` is a toggle; using the toggle here would close the
   * popover if the operator opened it from Identity first. Force-open is
   * the operator-correct semantics for the "Open targets" intent.
   */
  onShowMission: () => void;
}

export type RileyActionDispatcher = (action: ParsedAction) => void;

// Palette command-id → synthetic NL phrase. parseCommand projects the
// phrase into a ParsedAction whose `pause` arm carries the wall-clock
// detail (e.g. "until 3:23 PM"). Mirrors Alex's PER_ID_NL pattern in
// alex-action-dispatcher.ts.
const PER_ID_NL: Record<string, string> = {
  "pause-1h": "pause for 1h",
  resume: "resume",
};

// Palette command-id → route + inline toast title. Per-id routes so
// future Riley palette entries can declare their own settings deep
// links without a new switch arm.
const PER_ID_ROUTE: Record<string, { path: string; title: string }> = {
  "open-meta": { path: "/settings?focus=channels", title: "Opening Meta connection." },
  "open-rules": { path: "/settings?focus=rules", title: "Opening rules." },
};

/**
 * Single owner of toast firing on /riley. Both the command palette (via
 * { kind: "command", commandId }) and the live <Composer> (via parsed
 * actions from parseCommand) flow through this hook. The shared
 * <CommandPalette>, <Composer>, and <Topbar> MUST NOT import useToast
 * directly — double-toasts on dispatch are the failure mode this
 * boundary prevents.
 */
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
          router.push(route.path);
          toast({ title: route.title });
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
        toast({
          title: "Got it.",
          description: `Acting on "${action.detail || action.label}".`,
        });
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
      // Riley-specific resume copy. toastVoice's Alex idiom ("picking up
      // where I left off") reads wrong on /riley's scan mental model.
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
      // Riley has no contact-thread surface; followup/handoff/context
      // fold into the same honest "Got it." instruction toast. Same copy
      // whether the operator typed "fu Maya" or "raise daily budget".
      toast({
        title: "Got it.",
        description: `Acting on "${action.detail || action.label}".`,
      });
      return;
    case "command":
      // Unreachable — the top-level palette discriminator handles this
      // kind. Defensive fallthrough avoids exhaustiveness errors.
      return;
  }
}
```

- [ ] **Step 5: Run the full dispatcher test suite**

```bash
cd ~/switchboard && pnpm --filter @switchboard/dashboard test -- src/lib/cockpit/__tests__/riley-action-dispatcher.test.tsx
```

Expected: all 19 tests pass (9 palette-path + 10 composer-path).

- [ ] **Step 6: Commit**

```bash
cd ~/switchboard && git add apps/dashboard/src/lib/cockpit/riley-action-dispatcher.ts \
  apps/dashboard/src/lib/cockpit/__tests__/riley-action-dispatcher.test.tsx
git commit -m "feat(riley-cockpit): widen dispatcher to (ParsedAction) for composer path"
```

---

## Task 3: Swap `<ComposerPlaceholder>` for `<Composer>` on `/riley`

**Files:**

- Modify: `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx`
- Test: `apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append at the end of `apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx` (after the closing brace of the last `describe(...)` block):

```tsx
describe("RileyCockpitPage — composer adoption", () => {
  beforeEach(() => {
    haltState.halted = false;
    rileyApprovalsState.approvals = [];
    rileyStatusState.status = "IDLE";
    rileyActivityState.rows = [];
    metricsState.data = null;
    metricsState.isLoading = false;
    metricsState.isError = false;
    metricsState.error = null;
    missionData = undefined;
    actionCalls.length = 0;
    toast.mockReset();
    mockConfig.rejectPrimary = false;
  });

  function renderPage() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={client}>
        <RileyCockpitPage />
      </QueryClientProvider>,
    );
  }

  it("renders the live Composer (not the placeholder)", () => {
    renderPage();
    expect(screen.getByRole("textbox", { name: "Composer input" })).toBeInTheDocument();
  });

  it("Composer placeholder is Riley's locked copy", () => {
    renderPage();
    const input = screen.getByRole("textbox", { name: "Composer input" });
    expect(input).toHaveAttribute(
      "placeholder",
      "Tell Riley what to do — pause the Cold Interests adset, raise daily budget to $200…",
    );
  });

  it("typing 'pause for 1h' + Enter dispatches a pause toast", async () => {
    renderPage();
    const input = screen.getByRole("textbox", { name: "Composer input" });
    fireEvent.change(input, { target: { value: "pause for 1h" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    const payload = toast.mock.calls[0]![0] as { title: string; description?: string };
    expect(payload.title).toBe("Paused — standing by.");
    expect(payload.description).toMatch(/^until /);
  });

  it("typing 'resume' + Enter fires Riley-specific resume copy", async () => {
    renderPage();
    const input = screen.getByRole("textbox", { name: "Composer input" });
    fireEvent.change(input, { target: { value: "resume" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(toast).toHaveBeenCalledWith({ title: "Resumed — back to scanning." });
  });

  it("ad-ops free-form ('raise daily budget to $200') falls through to instruction (no mutation)", async () => {
    renderPage();
    const input = screen.getByRole("textbox", { name: "Composer input" });
    fireEvent.change(input, { target: { value: "raise daily budget to $200" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    const payload = toast.mock.calls[0]![0] as { title: string; description: string };
    expect(payload.title).toBe("Got it.");
    expect(payload.description).toContain('Acting on "raise daily budget to $200".');
  });

  it("'follow up with Maya tonight' folds into instruction toast", async () => {
    renderPage();
    const input = screen.getByRole("textbox", { name: "Composer input" });
    fireEvent.change(input, { target: { value: "follow up with Maya tonight" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(toast.mock.calls[0]![0]).toMatchObject({ title: "Got it." });
  });

  it("'stop offering free consults' + Enter routes to rules and toasts", async () => {
    renderPage();
    const input = screen.getByRole("textbox", { name: "Composer input" });
    fireEvent.change(input, { target: { value: "stop offering free consults" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    const payload = toast.mock.calls[0]![0] as { title: string };
    expect(payload.title).toBe("Opening rules.");
  });

  it("Escape clears the staged input without dispatching", () => {
    renderPage();
    const input = screen.getByRole("textbox", { name: "Composer input" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "pause" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("");
    expect(toast).not.toHaveBeenCalled();
  });

  it("Composer is disabled when halted", () => {
    haltState.halted = true;
    renderPage();
    const input = screen.getByRole("textbox", { name: "Composer input" });
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute("placeholder", "Halted — resume to send instructions");
  });
});
```

The new `describe` reuses the module-level mocks already declared at the top of the file (`haltState`, `rileyApprovalsState`, `rileyStatusState`, `rileyActivityState`, `metricsState`, `missionData`, `toast`, etc.). It does not re-declare any of them.

Note: `haltState.setHalted` is `vi.fn()` (line 11 of the existing test file). The composer-adoption tests assert toast firing rather than `setHalted` invocation, because the page mounts `<Composer>` which calls `dispatch(action)` — the `setHalted` call happens inside the dispatcher, but the dispatcher's `useHalt` mock returns the same `vi.fn()`. To assert `setHalted` directly the test would need to hoist a named spy; toast assertions are equivalent in load-bearing-ness and keep the test concise.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/switchboard && pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/riley-cockpit-page.test.tsx
```

Expected: the 9 new tests fail. The current page renders `<ComposerPlaceholder>` (a `<span>`, not an `<input>`), so `getByRole("textbox", { name: "Composer input" })` throws "Unable to find an element."

- [ ] **Step 3: Swap the placeholder for the live Composer**

In `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx`:

1. **Remove** the import on line 12: `import { ComposerPlaceholder } from "./composer-placeholder";`
2. **Add** the live Composer import (placed alphabetically among the cockpit imports, after the `Composer` family of imports):

```tsx
import { Composer } from "./composer";
```

3. **Replace** the `<ComposerPlaceholder>` block (lines 187–192) with the live `<Composer>`:

```tsx
<Composer
  placeholder={RILEY_COMPOSER_PLACEHOLDER}
  onDispatch={(action) => dispatch(action)}
  halted={haltCtx.halted}
  senderLabel="RILEY"
  accentColor={RILEY_ACCENT.deep}
/>
```

4. **Update** the `<CommandPalette>` `onSelect` callback (lines 193–201) to wrap the command as a `ParsedAction`:

```tsx
<CommandPalette
  open={paletteOpen}
  onClose={() => setPaletteOpen(false)}
  commands={RILEY_COMMANDS}
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

This `onSelect` body is identical to `cockpit-page.tsx:164-175` — Alex's pattern.

- [ ] **Step 4: Run the full riley-cockpit-page test suite**

```bash
cd ~/switchboard && pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/riley-cockpit-page.test.tsx
```

Expected: all riley-cockpit-page tests pass — the 9 new composer-adoption tests plus every existing case (B.1, B.2a, B.2b, B.3, B.3-followup). The B.3-followup palette tests continue to pass because the palette `onSelect` wrapping into a `ParsedAction` still dispatches with `kind: "command" + commandId`, which the new dispatcher routes through the same palette path.

- [ ] **Step 5: Commit**

```bash
cd ~/switchboard && git add apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx \
  apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx
git commit -m "feat(riley-cockpit): adopt live Composer on /riley"
```

---

## Task 4: Run all verification gates

**Files:** none (verification only).

- [ ] **Step 1: Typecheck**

```bash
cd ~/switchboard && pnpm typecheck
```

Expected: 18/18 turbo tasks succeed. If a `Cannot find name 'ComposerPlaceholder'` or `ParsedAction` mismatch appears, return to Task 3 — likely a missed import update or a leftover reference.

- [ ] **Step 2: Dashboard test suite**

```bash
cd ~/switchboard && pnpm --filter @switchboard/dashboard test
```

Expected: all dashboard tests pass (B.3-followup landed at 1682/1682; this slice adds ~25 new cases for a total around 1707).

- [ ] **Step 3: Dashboard `next build` (per `feedback_dashboard_build_not_in_ci`)**

```bash
cd ~/switchboard && pnpm --filter @switchboard/dashboard build
```

Expected: clean build. CI does NOT run `next build` for the dashboard — this gate catches `.js`-extension regressions and other Next-only build errors that pass `typecheck` + `vitest`.

- [ ] **Step 4: Prettier format check (per `feedback_ci_prettier_not_in_local_lint`)**

```bash
cd ~/switchboard && pnpm format:check
```

Expected: clean. Local `pnpm lint` does NOT run prettier; CI's lint job does.

- [ ] **Step 5: Adapter-boundary grep gate**

```bash
cd ~/switchboard && rg "Recommendation|AuditEntry|@switchboard/db|@prisma" \
  apps/dashboard/src/components/cockpit \
  apps/dashboard/src/hooks \
  | wc -l
```

Expected: same match count as `main` baseline (currently 50). If the count differs, a new import slipped in — back it out.

- [ ] **Step 6: Single-owner-toast grep gate**

```bash
cd ~/switchboard && rg "useToast|rileyToast" \
  apps/dashboard/src/components/cockpit/composer.tsx \
  apps/dashboard/src/components/cockpit/command-palette.tsx \
  apps/dashboard/src/components/cockpit/topbar.tsx
```

Expected: zero matches. The dispatcher is the sole owner.

- [ ] **Step 7: Push branch and open PR**

```bash
cd ~/switchboard && git push -u origin <branch-name>
gh pr create --base main --title "feat(riley-cockpit): composer adoption on /riley" --body "$(cat <<'EOF'
## Summary

- Swap `<ComposerPlaceholder>` for the live `<Composer>` on `/riley`.
- Extend `parseCommand` to accept `pause Riley for 1h` / `pause Alex for 1h` (optional `(alex|riley)` agent-name prefix on PAUSE_FOR/PAUSE_WORD/PAUSE_UNTIL/PAUSE_BARE).
- Widen `useRileyActionDispatcher` from `(RileyCommand) => void` to `(ParsedAction) => void` with a two-level switch (palette discriminator + shared `handleParsedKind`). Symmetric with Alex's dispatcher.
- Fold `followup`/`handoff`/`context` kinds into the honest `instruction` toast — Riley has no contact-thread surface; ad-ops free-form ("raise daily budget to \$200") also falls through to instruction.
- Single-owner-toast doctrine preserved: `<Composer>` and `<CommandPalette>` never import `useToast`.

Implements [docs/superpowers/plans/2026-05-15-riley-cockpit-composer-adoption-slice-brief.md](docs/superpowers/plans/2026-05-15-riley-cockpit-composer-adoption-slice-brief.md).

## Test plan

- [x] `pnpm typecheck` — clean
- [x] `pnpm --filter @switchboard/dashboard test` — all dashboard tests pass
- [x] `pnpm --filter @switchboard/dashboard build` — clean (per `dashboard-build-not-in-ci`)
- [x] `pnpm format:check` — clean (per `ci-prettier-not-in-local-lint`)
- [x] Adapter-boundary grep — match count unchanged from main baseline
- [x] Single-owner-toast grep — zero matches in composer.tsx / command-palette.tsx / topbar.tsx
EOF
)"
```

(The actual PR body is filled at PR-creation time. The branch name `feat/riley-cockpit-composer-adoption` is suggested but not mandatory.)

---

## Forced-deviation log (fill at PR time)

This plan locks the structure. If implementation requires deviations from these locked snippets, flag each in the PR description per `feedback_ship_clean_not_followup`. Likely sources of deviation:

1. **Test mocks** — the new `describe("RileyCockpitPage — composer adoption", …)` block may need to reset additional mocks (e.g. `actionCalls.length = 0`) that the existing test file maintains. Use the `beforeEach` body verbatim above; if a hoisted mock is missing, copy the matching reset from the B.3-followup describe block.
2. **`setHalted` spy isolation** — if a reviewer wants direct `setHalted` assertions (rather than toast-as-proxy), hoist a named spy and re-mock `@/components/layout/halt/halt-context` at the top of the new describe. The plan opts for toast assertions to keep the slice diff small and to match the dispatcher's single-owner contract.
3. **Composer chip preview** — if the chip rendering for `instruction` kind reads noisy in the running app (visible `→ instruction` chip while typing campaign-targeted NL), a one-line suppression in `composer.tsx` (return `null` from the chip when `parsed.kind === "instruction"`) would be the smallest fix. Out of scope unless a reviewer flags it; not a blocker.
