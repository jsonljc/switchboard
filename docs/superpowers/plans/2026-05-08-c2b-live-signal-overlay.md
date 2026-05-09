# C2b — Live Signal Overlay + Console Tree Retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the static `Live` / `Halted` pip in the editorial header into a Radix Popover trigger that renders system state, a Halt/Resume action, and a read-only preview of the last 10 audit events agent-tagged. Then delete the entire dormant `components/console/` tree, `app/(auth)/console/` route, the `/console` middleware entries, and residual JSDoc references.

**Architecture:** New `LiveSignalPopover` client component reads `useHalt()` and `useAudit()` and renders its own popover via a thin `@radix-ui/react-popover` wrapper at `components/ui/popover.tsx`. Audit entries are sorted newest-first defensively before slicing to 10. Two halt controls (header button + popover button) bind to one `useHalt()` source of truth. Tree deletion happens last so any unexpected regression caught before deletion is easy to diagnose.

**Tech Stack:** Next.js App Router, TypeScript, Radix `@radix-ui/react-popover` (new dependency), vitest + React Testing Library, existing `useAudit` hook.

**Spec:** [`docs/superpowers/specs/2026-05-08-live-signal-overlay-and-console-retirement-design.md`](../specs/2026-05-08-live-signal-overlay-and-console-retirement-design.md) — sections §1, §3, §4, §5.2, §5.3, §6.3 cover this PR.

**Pre-condition:** C2a has merged to `main`. The `halt/` cluster, global keyboard shortcuts, editorial HelpOverlay, and `/console` redirect shim are all in place. Verify by checking `git log main --oneline | grep "C2a"` returns the merge commit before starting.

---

## File Structure

**New files:**

- `apps/dashboard/src/components/ui/popover.tsx` — Radix Popover wrapper
- `apps/dashboard/src/components/layout/live-signal-popover.tsx` — the popover component
- `apps/dashboard/src/components/layout/live-signal-popover.css` — popover-scoped styles
- `apps/dashboard/src/components/layout/__tests__/live-signal-popover.test.tsx` — component tests

**Modified files:**

- `apps/dashboard/package.json` — add `@radix-ui/react-popover` dependency
- `apps/dashboard/src/components/layout/editorial-auth-shell.tsx` — replace static `live-pip` span with `<LiveSignalPopover />`
- `apps/dashboard/src/middleware.ts` — drop `/console` from `AUTH_PAGE_PREFIXES` and matcher
- `apps/dashboard/src/components/operator-chat/operator-chat-widget.tsx` — drop `/console` from `HIDDEN_PATHS`
- `apps/dashboard/src/hooks/use-approval-action.ts` — drop `/console` JSDoc reference
- `apps/dashboard/src/hooks/use-escalation-reply.ts` — drop `/console` JSDoc reference

**Deleted files / directories:**

- `apps/dashboard/src/app/(auth)/console/` — entire directory (redirect shim + redirect test)
- `apps/dashboard/src/components/console/` — entire tree (zones, queue-cards, helpers, tests, the C2a re-export shims)

---

## Task 1: Add `@radix-ui/react-popover` dependency

The Sheet primitive uses `@radix-ui/react-dialog`. Popover needs its own package — verified absent from `apps/dashboard/package.json` during plan write.

- [ ] **Step 1: Install the package**

```bash
pnpm --filter @switchboard/dashboard add @radix-ui/react-popover
```

This updates `apps/dashboard/package.json` and `pnpm-lock.yaml`.

- [ ] **Step 2: Verify the install**

```bash
grep "react-popover" apps/dashboard/package.json
```

Expected: a line like `"@radix-ui/react-popover": "^1.x.x"`.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/package.json pnpm-lock.yaml
git commit -m "chore(dashboard): add @radix-ui/react-popover for live signal popover (c2b)"
```

---

## Task 2: Create the Popover UI primitive

Mirrors the existing `components/ui/sheet.tsx` pattern: thin Radix wrapper exporting `Popover`, `PopoverTrigger`, `PopoverContent` (and `PopoverClose` if needed).

**Files:**

- Create: `apps/dashboard/src/components/ui/popover.tsx`

- [ ] **Step 1: Write the wrapper**

```tsx
// apps/dashboard/src/components/ui/popover.tsx
"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverClose = PopoverPrimitive.Close;
const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverClose, PopoverAnchor, PopoverContent };
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/ui/popover.tsx
git commit -m "feat(dashboard): add Popover UI primitive wrapping @radix-ui/react-popover (c2b)"
```

---

## Task 3: Write failing tests for `LiveSignalPopover` — pip + state-aware aria

Tests cover the spec §5.2 acceptance list. Split across multiple files would be over-engineering — one test file with describe blocks per concern.

**Files:**

- Create: `apps/dashboard/src/components/layout/__tests__/live-signal-popover.test.tsx`

- [ ] **Step 1: Write the test file scaffolding plus the first 6 tests (DOM contract, aria, halt action)**

```tsx
// apps/dashboard/src/components/layout/__tests__/live-signal-popover.test.tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HaltProvider } from "../halt/halt-context";
import { LiveSignalPopover } from "../live-signal-popover";
import type { AuditEntryResponse } from "@/hooks/use-audit";

vi.mock("@/hooks/use-audit", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/use-audit")>("@/hooks/use-audit");
  return {
    ...actual,
    useAudit: vi.fn(),
  };
});

import { useAudit } from "@/hooks/use-audit";

function makeEntry(overrides: Partial<AuditEntryResponse> = {}): AuditEntryResponse {
  return {
    id: overrides.id ?? `e-${Math.random().toString(36).slice(2, 8)}`,
    eventType: overrides.eventType ?? "alex.action.taken",
    timestamp: overrides.timestamp ?? "2026-05-08T12:00:00.000Z",
    actorType: "agent",
    actorId: overrides.actorId ?? "alex",
    entityType: "decision",
    entityId: "d-1",
    riskCategory: "low",
    summary: overrides.summary ?? "did a thing",
    snapshot: {},
    envelopeId: null,
    ...overrides,
  };
}

function setUseAudit(opts: {
  isLoading?: boolean;
  isError?: boolean;
  entries?: AuditEntryResponse[];
}) {
  vi.mocked(useAudit).mockReturnValue({
    data: opts.entries ? { entries: opts.entries, total: opts.entries.length } : undefined,
    isLoading: opts.isLoading ?? false,
    isError: opts.isError ?? false,
    error: null,
    refetch: vi.fn(),
    // The following fields are required by the React Query return type but not exercised here.
  } as unknown as ReturnType<typeof useAudit>);
}

function renderPopover({ initialHalted = false }: { initialHalted?: boolean } = {}) {
  if (initialHalted) {
    window.localStorage.setItem("sb_halt_state", "1");
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <HaltProvider>
        <LiveSignalPopover />
      </HaltProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(useAudit).mockReset();
  setUseAudit({ entries: [] });
});

describe("LiveSignalPopover — pip (trigger)", () => {
  it("preserves the existing live-pip DOM contract", () => {
    setUseAudit({ entries: [] });
    const { container } = renderPopover();
    const pip = container.querySelector("button.live-pip");
    expect(pip).not.toBeNull();
    expect(pip!.querySelector("span.pulse")).not.toBeNull();
    expect(pip!.textContent).toContain("Live");
  });

  it("aria-label reads 'System live — open live signal' when not halted", () => {
    renderPopover({ initialHalted: false });
    const pip = screen.getByRole("button", { name: /system live/i });
    expect(pip).toHaveAttribute("aria-label", "System live — open live signal");
  });

  it("aria-label reads 'System halted — open live signal' when halted", () => {
    renderPopover({ initialHalted: true });
    const pip = screen.getByRole("button", { name: /system halted/i });
    expect(pip).toHaveAttribute("aria-label", "System halted — open live signal");
  });

  it("trigger has 'live-pip halted' class when halted", () => {
    const { container } = renderPopover({ initialHalted: true });
    const pip = container.querySelector("button.live-pip");
    expect(pip).not.toBeNull();
    expect(pip!.className).toContain("halted");
  });
});

describe("LiveSignalPopover — halt action", () => {
  it("flips state and labels in lockstep when Halt is clicked", async () => {
    const user = userEvent.setup();
    const { container } = renderPopover({ initialHalted: false });
    await user.click(screen.getByRole("button", { name: /system live/i }));

    const halt = await screen.findByRole("button", { name: /^Halt$/ });
    await user.click(halt);

    // After click: pip text now Halted; popover label flips
    expect(container.querySelector("button.live-pip")!.textContent).toContain("Halted");
    expect(within(screen.getByRole("dialog")).getByText(/system halted/i)).toBeInTheDocument();
    // Halt button label flips to Resume
    expect(screen.getByRole("button", { name: /^Resume$/ })).toBeInTheDocument();
    expect(window.localStorage.getItem("sb_halt_state")).toBe("1");
  });

  it("Resume from halted flips state back", async () => {
    const user = userEvent.setup();
    renderPopover({ initialHalted: true });
    await user.click(screen.getByRole("button", { name: /system halted/i }));
    await user.click(screen.getByRole("button", { name: /^Resume$/ }));
    expect(window.localStorage.getItem("sb_halt_state")).toBe("0");
  });
});
```

- [ ] **Step 2: Add the remaining tests (auto-close inversion, list states, accessibility)**

Append to the same file:

```tsx
describe("LiveSignalPopover — popover does not auto-close on halt", () => {
  it("popover stays open after Halt click", async () => {
    const user = userEvent.setup();
    renderPopover({ initialHalted: false });
    await user.click(screen.getByRole("button", { name: /system live/i }));
    await user.click(await screen.findByRole("button", { name: /^Halt$/ }));
    // Popover still open
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("LiveSignalPopover — recent activity preview", () => {
  it("caps rendered events at 10", async () => {
    const user = userEvent.setup();
    setUseAudit({
      entries: Array.from({ length: 25 }, (_, i) =>
        makeEntry({
          id: `e-${i}`,
          timestamp: new Date(Date.UTC(2026, 4, 8, 12, 0, 25 - i)).toISOString(),
        }),
      ),
    });
    renderPopover();
    await user.click(screen.getByRole("button", { name: /system live/i }));
    const list = within(screen.getByRole("dialog")).getByRole("list");
    expect(list.querySelectorAll("li").length).toBe(10);
  });

  it("renders 'Reading the trail…' while loading with no cached data", async () => {
    const user = userEvent.setup();
    setUseAudit({ isLoading: true });
    renderPopover();
    await user.click(screen.getByRole("button", { name: /system live/i }));
    expect(within(screen.getByRole("dialog")).getByText(/reading the trail/i)).toBeInTheDocument();
    // Status header + Halt button still render
    expect(screen.getByRole("button", { name: /^Halt$/ })).toBeInTheDocument();
  });

  it("renders 'Couldn't load activity.' on error", async () => {
    const user = userEvent.setup();
    setUseAudit({ isError: true });
    renderPopover();
    await user.click(screen.getByRole("button", { name: /system live/i }));
    expect(
      within(screen.getByRole("dialog")).getByText(/couldn't load activity/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Halt$/ })).toBeInTheDocument();
  });

  it("renders 'Nothing to report.' when entries is empty", async () => {
    const user = userEvent.setup();
    setUseAudit({ entries: [] });
    renderPopover();
    await user.click(screen.getByRole("button", { name: /system live/i }));
    expect(within(screen.getByRole("dialog")).getByText(/nothing to report/i)).toBeInTheDocument();
  });

  it("event rows are read-only — no <a> or <button> descendants in row", async () => {
    const user = userEvent.setup();
    setUseAudit({ entries: [makeEntry({ id: "only-one", summary: "did a thing" })] });
    renderPopover();
    await user.click(screen.getByRole("button", { name: /system live/i }));
    const dialog = screen.getByRole("dialog");
    const list = within(dialog).getByRole("list");
    const items = list.querySelectorAll("li");
    expect(items.length).toBe(1);
    expect(items[0].querySelector("a")).toBeNull();
    expect(items[0].querySelector("button")).toBeNull();
  });
});

describe("LiveSignalPopover — accessibility", () => {
  it("Esc closes the popover", async () => {
    const user = userEvent.setup();
    renderPopover();
    await user.click(screen.getByRole("button", { name: /system live/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("popover content has accessible name 'Live signal'", async () => {
    const user = userEvent.setup();
    renderPopover();
    await user.click(screen.getByRole("button", { name: /system live/i }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-label", "Live signal");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
pnpm --filter @switchboard/dashboard test live-signal-popover.test
```

Expected: FAIL — `Cannot find module '../live-signal-popover'`.

---

## Task 4: Implement `LiveSignalPopover`

The component composes Popover + Halt + Audit with a defensive newest-first sort. Co-located formatter helpers (no console-tree imports).

**Files:**

- Create: `apps/dashboard/src/components/layout/live-signal-popover.tsx`
- Create: `apps/dashboard/src/components/layout/live-signal-popover.css`

- [ ] **Step 1: Write the component**

```tsx
// apps/dashboard/src/components/layout/live-signal-popover.tsx
"use client";

import { useState } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { useHalt } from "./halt/halt-context";
import { useAudit, type AuditEntryResponse } from "@/hooks/use-audit";
import "./live-signal-popover.css";

const RECENT_LIMIT = 10;

type AgentTag = "alex" | "riley" | "mira" | "system";

function agentTagFromActor(entry: AuditEntryResponse): AgentTag {
  const key = `${entry.actorId ?? ""} ${entry.eventType ?? ""}`.toLowerCase();
  if (key.includes("alex")) return "alex";
  if (key.includes("riley")) return "riley";
  if (key.includes("mira")) return "mira";
  return "system";
}

function capitalize(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function humanizeEventType(eventType: string): string {
  return eventType.replace(/^[^.]+\./, "").replace(/[._]/g, " ");
}

function formatHHMM(timestamp: string): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function rowLabel(entry: AuditEntryResponse): string {
  const summary = entry.summary?.trim();
  if (summary) return summary;
  return humanizeEventType(entry.eventType);
}

function EventRow({ entry }: { entry: AuditEntryResponse }) {
  const tag = agentTagFromActor(entry);
  return (
    <li className="event-row" data-agent={tag}>
      <span className="event-time">{formatHHMM(entry.timestamp)}</span>
      <span className="event-agent">{capitalize(tag)}</span>
      <span className="event-msg">{rowLabel(entry)}</span>
    </li>
  );
}

export function LiveSignalPopover() {
  const [open, setOpen] = useState(false);
  const { halted, toggleHalt } = useHalt();
  const { data, isLoading, isError } = useAudit();

  const entries = (data?.entries ?? [])
    .slice() // don't mutate React Query cache
    .sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""))
    .slice(0, RECENT_LIMIT);

  const stateLabel = halted ? "Halted" : "Live";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`live-pip${halted ? " halted" : ""}`}
          aria-label={`System ${stateLabel.toLowerCase()} — open live signal`}
          aria-expanded={open}
        >
          <span className="pulse" aria-hidden="true" />
          {stateLabel}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        role="dialog"
        aria-label="Live signal"
        className="live-popover"
        sideOffset={8}
      >
        <header className="live-popover-head">
          <span className={`status-dot${halted ? " halted" : ""}`} aria-hidden="true" />
          <span className="status-label font-display">System {stateLabel.toLowerCase()}</span>
          <button type="button" className="halt-action" onClick={toggleHalt} aria-pressed={halted}>
            {halted ? "Resume" : "Halt"}
          </button>
        </header>
        <section className="recent-events" aria-label="Recent activity">
          {isLoading && (
            <p className="muted-state">
              <em>Reading the trail…</em>
            </p>
          )}
          {isError && (
            <p className="muted-state">
              <em>Couldn't load activity.</em>
            </p>
          )}
          {!isLoading && !isError && entries.length === 0 && (
            <p className="muted-state">
              <em>Nothing to report.</em>
            </p>
          )}
          {!isLoading && !isError && entries.length > 0 && (
            <ul className="event-list">
              {entries.map((e) => (
                <EventRow key={e.id} entry={e} />
              ))}
            </ul>
          )}
        </section>
        <footer className="shortcut-hint">
          <kbd>?</kbd> shortcuts · <kbd>Esc</kbd> close
        </footer>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Write the popover-scoped CSS**

```css
/* apps/dashboard/src/components/layout/live-signal-popover.css */

.live-popover {
  width: 22rem;
  max-width: calc(100vw - 2rem);
  max-height: 28rem;
  background: var(--ambient-cream, #f9f7f2);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.live-popover-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.live-popover-head .status-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  /* Match the existing global .live-pip .pulse green (globals.css:559) */
  background: hsl(140 50% 38%);
}

.live-popover-head .status-dot.halted {
  /* Match the existing .folio-link.is-halt halted token (globals.css:606) */
  background: hsl(0 75% 50%);
}

.live-popover-head .status-label {
  flex: 1;
  font-size: 0.95rem;
}

.live-popover-head .halt-action {
  font-size: 0.85rem;
  padding: 0.25rem 0.6rem;
  border: 1px solid currentColor;
  border-radius: 0.25rem;
  background: transparent;
  cursor: pointer;
}

.live-popover .recent-events {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.live-popover .muted-state {
  font-size: 0.85rem;
  opacity: 0.65;
  margin: 0;
}

.live-popover .event-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.live-popover .event-row {
  display: grid;
  grid-template-columns: auto auto 1fr;
  gap: 0.5rem;
  font-size: 0.8rem;
  opacity: 0.85;
}

.live-popover .event-row .event-time {
  font-variant-numeric: tabular-nums;
  opacity: 0.6;
}

.live-popover .event-row .event-agent {
  font-weight: 500;
}

.live-popover .shortcut-hint {
  font-size: 0.75rem;
  opacity: 0.55;
  border-top: 1px solid currentColor;
  padding-top: 0.5rem;
}

.live-popover .shortcut-hint kbd {
  font-family: inherit;
  font-size: 0.75rem;
  padding: 0 0.25rem;
  border: 1px solid currentColor;
  border-radius: 0.2rem;
  opacity: 0.7;
}

/* Halted-state pip: pulse becomes a static dot, color shifts.
   The base .live-pip styling (size, ring animation, base green) lives in
   globals.css:549-578; we don't redefine it here. We only override for the
   halted state, suppressing the ::after ring animation and shifting the dot
   color to match the existing .folio-link.is-halt halted token. */
.live-pip.halted .pulse {
  background: hsl(0 75% 50%);
}
.live-pip.halted .pulse::after {
  animation: none;
  border-color: hsl(0 75% 50% / 0.4);
}
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/dashboard test live-signal-popover.test
```

Expected: PASS — all 13 assertions.

If any test fails on the timestamp-sorting assertion, ensure `Task 4 Step 1`'s `.sort()` is applied before `.slice(0, RECENT_LIMIT)` and that the test fixtures use timestamps that exercise the sort.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/layout/live-signal-popover.tsx
git add apps/dashboard/src/components/layout/live-signal-popover.css
git add apps/dashboard/src/components/layout/__tests__/live-signal-popover.test.tsx
git commit -m "feat(dashboard): LiveSignalPopover — pip becomes Radix Popover trigger with read-only activity preview (c2b)"
```

---

## Task 5: Replace static `live-pip` span with `<LiveSignalPopover />` in editorial header

**Files:**

- Modify: `apps/dashboard/src/components/layout/editorial-auth-shell.tsx`

- [ ] **Step 1: Add the import**

At the top:

```ts
import { LiveSignalPopover } from "./live-signal-popover";
```

- [ ] **Step 2: Replace the static span**

Find this block in `EditorialAuthShellInner`:

```tsx
<div className="header-actions">
  <span className="live-pip">
    <span className="pulse" />
    Live
  </span>
  <InboxLinkClient />
  <HaltButtonClient />
  <span className="me-chip">M</span>
</div>
```

(Note: post-C1, `<InboxLinkClient />` was replaced with `<InboxDrawer />`. The exact import depends on what landed via #393. Use whatever the current symbol is; do NOT change it in this task.)

Replace the static `<span className="live-pip">…</span>` with:

```tsx
<LiveSignalPopover />
```

The `<HaltButtonClient />` and `<span className="me-chip">M</span>` siblings stay. The header right-cluster order is now `[Live (popover) ▸ Inbox ▸ Halt ▸ Me]`.

- [ ] **Step 3: Run lint, typecheck, dashboard tests**

```bash
pnpm --filter @switchboard/dashboard lint
pnpm --filter @switchboard/dashboard typecheck
pnpm --filter @switchboard/dashboard test
```

Expected: clean.

- [ ] **Step 4: Manual smoke test**

Start the dev server: `pnpm --filter @switchboard/dashboard dev`

1. Visit `http://localhost:3002/` — click `Live` pip. Expected: popover opens anchored under the pip; status reads `System live`; `Halt` button visible.
2. Click `Halt`. Expected: pip text flips to `Halted`; popover header reads `System halted`; button label becomes `Resume`. **Popover stays open.**
3. Press `Esc`. Expected: popover closes. Pip still reads `Halted`.
4. Reload the page. Expected: pip still reads `Halted` (state persisted via `sb_halt_state`). Click pip; click `Resume`. Pip flips back to `Live`.
5. Visit `/alex`, `/riley`. Repeat steps 1, 2, 3 to confirm the pip works on every editorial page. Header layout (right cluster: `Live ▸ Inbox ▸ Halt ▸ Me`) should not shift visually.
6. Open the popover on a page with audit data (any editorial page after some activity); verify `Reading the trail…` flashes briefly, then a list of up to 10 recent events renders. Open it again — second open is instant from React Query cache.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/layout/editorial-auth-shell.tsx
git commit -m "feat(dashboard): mount LiveSignalPopover in editorial header (replaces static live-pip span) (c2b)"
```

---

## Task 6: Delete the `/console` route directory

The route's only content is the C2a redirect shim plus its test. The pip is now the canonical Live entry point.

**Files:**

- Delete: `apps/dashboard/src/app/(auth)/console/` (entire directory)

- [ ] **Step 1: Remove the directory**

```bash
git rm -r apps/dashboard/src/app/\(auth\)/console
```

- [ ] **Step 2: Verify no compile errors**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: clean. Nothing imports from `app/(auth)/console/` in production code.

- [ ] **Step 3: Verify the route deletion does not break the build**

Run typecheck and the full dashboard test suite:

```bash
pnpm --filter @switchboard/dashboard typecheck
pnpm --filter @switchboard/dashboard test
```

Expected: clean. **Do not assert on `/console` HTTP behavior at this point** — `/console` is still in the middleware allowlist (until Task 8), and the exact response (Next 404 vs. middleware-mediated path) is implementation-dependent on Next's matcher resolution order. The authoritative `/console` 404 verification happens in **Task 10 Step 3** after middleware cleanup.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(dashboard): delete /console route directory (c2b)"
```

---

## Task 7: Delete the entire `components/console/` tree

This is the largest single change in the PR. The tree is dormant — nothing in production renders any console-tree component, and the C2a re-export shims at `halt-context.tsx` and `use-keyboard-shortcuts.ts` only existed to keep the dormant tree type-checking.

**Files:**

- Delete: `apps/dashboard/src/components/console/` (entire tree, including `__tests__/`, `zones/`, `queue-cards/`, helpers, the C2a shims)

- [ ] **Step 1: Verify no external module imports remain**

```bash
git grep -n "@/components/console" apps/dashboard/src
```

Expected: hits **only** inside `components/console/` itself. If any external import remains (e.g., a forgotten layout import), fix it before proceeding.

- [ ] **Step 2: Remove the tree**

```bash
git rm -r apps/dashboard/src/components/console
```

- [ ] **Step 3: Run typecheck**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: clean. If a typecheck error surfaces a missed external import, restore the affected file from `git stash` or `git checkout HEAD~1`, retarget the import, then re-run this task.

- [ ] **Step 4: Run dashboard tests**

```bash
pnpm --filter @switchboard/dashboard test
```

Expected: clean. The deleted tests were all internal to the console tree.

- [ ] **Step 5: Commit**

```bash
git commit -m "chore(dashboard): delete entire components/console/ tree (c2b)"
```

---

## Task 8: Remove `/console` from middleware

After the route is gone, keeping `/console` in the middleware allowlist serves no purpose.

**Files:**

- Modify: `apps/dashboard/src/middleware.ts`

- [ ] **Step 1: Remove `/console` from `AUTH_PAGE_PREFIXES`**

In `apps/dashboard/src/middleware.ts`, find the array `AUTH_PAGE_PREFIXES` (around line 13-30). Delete the line:

```ts
  "/console",
```

- [ ] **Step 2: Remove `/console/:path*` from the `matcher`**

In the same file, find `export const config = { matcher: [...] }` (around line 116-137). Delete the line:

```ts
    "/console/:path*",
```

- [ ] **Step 3: Run middleware tests**

```bash
pnpm --filter @switchboard/dashboard test middleware
```

Expected: any existing middleware tests should still pass. Verify no test asserts a `/console` path is in the protected list.

- [ ] **Step 4: Verify dev behavior**

Restart the dev server. Visit `/console` — expected: Next.js 404 (no middleware redirect, no route, no shim).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/middleware.ts
git commit -m "chore(dashboard): drop /console from middleware allowlist + matcher (c2b)"
```

---

## Task 9: Clean up residual `/console` references

Three remaining mentions of `/console` exist outside the (now-deleted) console tree:

1. `apps/dashboard/src/components/operator-chat/operator-chat-widget.tsx:8` — `HIDDEN_PATHS = ["/console"]`
2. `apps/dashboard/src/hooks/use-approval-action.ts` — JSDoc comment listing `/console` as a surface
3. `apps/dashboard/src/hooks/use-escalation-reply.ts` — JSDoc comment listing `/console` as a surface

- [ ] **Step 1: Remove `/console` from `HIDDEN_PATHS` in `operator-chat-widget.tsx`**

Open the file. Change:

```ts
const HIDDEN_PATHS = ["/console"];
```

to:

```ts
const HIDDEN_PATHS: readonly string[] = [];
```

(Keep the constant in place; future paths may join it. Empty array is correct now.)

- [ ] **Step 2: Update the JSDoc in `use-approval-action.ts`**

Open `apps/dashboard/src/hooks/use-approval-action.ts`. Find the comment block around line 15 listing `/console` as a surface. Delete the bullet referencing `/console`. (Other surfaces may stay if listed.)

- [ ] **Step 3: Update the JSDoc in `use-escalation-reply.ts`**

Open `apps/dashboard/src/hooks/use-escalation-reply.ts`. Find the comment block around line 17 listing `/console` as a surface. Delete the bullet referencing `/console`.

- [ ] **Step 4: Verify all `/console` references are gone**

```bash
git grep -nE "components/console|/console" apps/dashboard/src
```

Expected: zero hits. If any incidental hit appears (test snapshot, framework-generated path), review it explicitly — most likely a stale string in a test fixture that should also be cleaned up.

- [ ] **Step 5: Run full dashboard tests**

```bash
pnpm --filter @switchboard/dashboard test
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/operator-chat/operator-chat-widget.tsx
git add apps/dashboard/src/hooks/use-approval-action.ts
git add apps/dashboard/src/hooks/use-escalation-reply.ts
git commit -m "chore(dashboard): drop residual /console references in operator-chat-widget and hook JSDocs (c2b)"
```

---

## Task 10: Final acceptance verification

Verification-only task. Catches anything missed and asserts the C2b acceptance criteria from spec §6.3.

- [ ] **Step 1: Run full lint + typecheck + dashboard tests**

```bash
pnpm --filter @switchboard/dashboard lint
pnpm --filter @switchboard/dashboard typecheck
pnpm --filter @switchboard/dashboard test
```

Expected: all clean.

- [ ] **Step 2: Final grep audit**

```bash
git grep -nE "components/console|/console" apps/dashboard/src
```

Expected: zero runtime/source references. Any incidental hit (test snapshot, framework-generated path string) must be explicitly reviewed.

- [ ] **Step 3: Manual smoke test (dev server)**

`pnpm --filter @switchboard/dashboard dev`

1. **`/console` returns 404.** Visit `http://localhost:3002/console`. Expected: Next.js 404. No redirect, no shim.
2. **Pip is interactive on every editorial page.** Visit `/`, `/alex`, `/riley`. On each: click the `Live` pip → popover opens anchored under it.
3. **Halt action lockstep.** Click `Halt` inside the popover. Expected: pip text flips `Live` → `Halted`; popover header label flips `System live` → `System halted`; button label flips `Halt` → `Resume`. Popover stays open.
4. **Halt persists across reload.** With `Halted` state set, reload the page. Expected: pip still reads `Halted`; popover (when reopened) still shows `Resume`.
5. **Header layout invariant.** Visually compare the editorial header right cluster across `/`, `/alex`, `/riley`. Expected: same width, same padding, same rhythm — `Live ▸ Inbox ▸ Halt ▸ Me`. No visible shift between editorial pages or between halted/non-halted states.
6. **Activity preview behavior.** With audit data present, open the popover. Expected: list of up to 10 recent events agent-tagged. Verify rows are static (no clickable affordances). With no audit data, expect `Nothing to report.`. With error simulated (e.g., kill backend), expect `Couldn't load activity.`.
7. **Esc closes.** Open the popover; press `Esc`. Expected: popover closes; focus returns to the pip.
8. **Global shortcuts still work.** Press `H` from anywhere on an editorial page. Expected: pip flips. Press `?`. Expected: HelpOverlay opens.

- [ ] **Step 4: Open the C2b PR**

```bash
gh pr create --base main --title "feat(dashboard): C2b — live signal overlay + console tree retirement" --body "$(cat <<'EOF'
## Summary

- New `LiveSignalPopover` component: pip becomes a Radix Popover trigger with system-state, Halt/Resume action, and a read-only preview of last 10 audit events agent-tagged
- Activity preview is defensively sorted newest-first before slicing — does not depend on `useAudit()` ordering
- `<PopoverContent>` carries explicit `role="dialog"` + `aria-label="Live signal"` (not relying on Radix defaults)
- Delete entire `components/console/` tree (~2000 LOC) and `app/(auth)/console/` route
- Drop `/console` from middleware allowlist + matcher
- Clean residual `/console` references in `operator-chat-widget.tsx` and two hook JSDocs

Per spec: `docs/superpowers/specs/2026-05-08-live-signal-overlay-and-console-retirement-design.md` §1, §3, §4, §5.2, §6.3

## Test plan

- [ ] `pnpm lint && pnpm typecheck && pnpm --filter @switchboard/dashboard test` clean
- [ ] All 13 `live-signal-popover.test.tsx` assertions pass
- [ ] `/console` returns Next 404 (no redirect, no shim)
- [ ] Pip is interactive on `/`, `/alex`, `/riley`
- [ ] Halt action: pip + popover label + button label flip in lockstep; popover stays open
- [ ] Halt persists across reload via `sb_halt_state`
- [ ] Activity preview: max 10 rows; loading/error/empty copy matches spec
- [ ] Event rows are static (no `<a>` or `<button>` descendants)
- [ ] Esc closes the popover; focus returns to the pip
- [ ] Global `H` / `?` still work everywhere
- [ ] `git grep -nE "components/console|/console" apps/dashboard/src` returns zero runtime/source hits
- [ ] Header layout right cluster (`Live ▸ Inbox ▸ Halt ▸ Me`) does not shift visually before/after merge

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## C2b complete

After this plan executes and the PR merges:

- The editorial header pip is the canonical Live entry point
- The console tree is fully retired
- Halt has exactly one source of truth and two equally-bound controls (header button + popover button)
- The "Live = pulse, Inbox = decisions, Agent homes = workspaces, Activity = Phase D" doctrine is encoded in the codebase, not just in the spec
