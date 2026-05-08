# Inbox Drawer (Phase C1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the count-only `InboxLinkClient` placeholder in the editorial header with a working right-side drawer that lists every pending Decision (recommendations + handoffs) across all agents the org has enabled, reusing the existing `DecisionCard`, `useDecisionFeed`, and `dispatchDecisionAction` plumbing without backend changes.

**Architecture:** Single self-contained client component `InboxDrawer` owning local open/closed state via `useState`. Trigger button preserves the existing `folio-link` DOM contract (regression-tested) so the editorial header doesn't shift visually. Drawer content reuses Radix-based `Sheet` primitive (`side="right"`, `sm:max-w-[28rem]`). Per-item agent label composed at the drawer call site (`${displayName} · ${folio.kindLabel}`) via call-site override, leaving `mapToDecisionCard` and `DecisionCard` untouched. Per-agent accent color piped into a CSS custom property (`--inbox-agent-accent`) so drawer CSS stays generic. Auto-close on inbox-zero is action-driven (a `useRef` flips only after a successful in-session dispatch) and resets on every open/close transition. Tenant-null state renders the trigger as a real `disabled` button.

**Tech Stack:** Next.js 14 App Router, React 18, TanStack React Query, Radix UI (`@radix-ui/react-dialog` via `components/ui/sheet.tsx`), Tailwind, vitest + `@testing-library/react`, `@switchboard/schemas` (`AGENT_REGISTRY`).

**Spec:** `docs/superpowers/specs/2026-05-08-inbox-drawer-c1-design.md`

---

## File structure

| Path                                                                            | Action | Responsibility                                                                                                                                                                    |
| ------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/dashboard/src/components/layout/inbox-drawer.tsx`                         | CREATE | The new client component (trigger + Sheet + list + auto-close logic). Sole source of truth for inbox UI.                                                                          |
| `apps/dashboard/src/components/layout/inbox-drawer.css`                         | CREATE | Drawer-specific tokens (per-agent accent dot via `--inbox-agent-accent`, list spacing). Editorial register tokens stay in `globals.css`.                                          |
| `apps/dashboard/src/components/layout/__tests__/inbox-drawer.test.tsx`          | CREATE | Unit tests for header DOM contract, aria-label cases, tenant-null disabled trigger, list states, agent-label composition, action dispatch, auto-close semantics, accessible name. |
| `apps/dashboard/src/components/layout/editorial-auth-shell.tsx`                 | MODIFY | Replace one import (`InboxLinkClient` → `InboxDrawer`) and one element.                                                                                                           |
| `apps/dashboard/src/hooks/use-decision-feed.ts`                                 | MODIFY | Delete the orphaned `useInboxCount` export.                                                                                                                                       |
| `apps/dashboard/src/app/(auth)/[agentKey]/__tests__/agent-home-client.test.tsx` | MODIFY | Remove the `useInboxCount: () => 0` mock entry (the hook no longer exists).                                                                                                       |
| `apps/dashboard/src/components/layout/inbox-link-client.tsx`                    | DELETE | Responsibility moves into `InboxDrawer`'s trigger button.                                                                                                                         |

No edits to `packages/core`, `packages/schemas`, `packages/db`, or `apps/api` — this is a Layer-5 (apps) PR per the dependency rules in `CLAUDE.md`.

---

## Task 0: Setup the implementation branch

**Files:** none (branch operation only)

- [ ] **Step 1: Confirm starting point and create branch**

Run from the repo root:

```bash
git checkout main
git pull origin main
git status --short
git log --oneline -3
```

Expected: working tree clean (or only `.claude/settings.local.json` modified — that's pre-existing). Top of `main` should include `cb4e48eb feat(redesign): PR-S6 — Slice B cutover` or later.

```bash
git checkout -b feat/inbox-drawer-c1
git branch --show-current
```

Expected: `feat/inbox-drawer-c1`.

- [ ] **Step 2: Run a baseline build/test to confirm green starting state**

```bash
pnpm install
pnpm --filter @switchboard/dashboard typecheck
pnpm --filter @switchboard/dashboard test
```

Expected: typecheck clean, all tests pass. If any failures, do **not** proceed — diagnose first; the plan assumes a clean baseline.

- [ ] **Step 3: Confirm the spec is on this branch**

```bash
ls docs/superpowers/specs/2026-05-08-inbox-drawer-c1-design.md
```

Expected: file exists. The spec was committed to `main` via the `docs/inbox-drawer-c1-spec` PR before this branch was created.

(No commit on this task — branch creation is the only state change.)

---

## Task 1: Header DOM contract test (failing first) + minimal trigger

This task does TDD on the highest-value regression test: the editorial header's `folio-link` DOM must not visibly change when we swap `InboxLinkClient` for `InboxDrawer`. We start with a minimal trigger-only component to satisfy this contract; later tasks layer the drawer content.

**Files:**

- Create: `apps/dashboard/src/components/layout/inbox-drawer.tsx`
- Create: `apps/dashboard/src/components/layout/inbox-drawer.css`
- Test: `apps/dashboard/src/components/layout/__tests__/inbox-drawer.test.tsx`

- [ ] **Step 1: Write the failing header-contract test**

Create `apps/dashboard/src/components/layout/__tests__/inbox-drawer.test.tsx` with:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// ---------- Stable top-level mocks (no resetModules / doMock anywhere) ----------

// Feed: a mutable variable that tests reassign before render/rerender.
let mockFeed: {
  data:
    | { decisions: unknown[]; counts: { total: number; approval: number; handoff: number } }
    | undefined;
  isLoading: boolean;
  isError: boolean;
} = {
  data: { decisions: [], counts: { total: 3, approval: 2, handoff: 1 } },
  isLoading: false,
  isError: false,
};
vi.mock("@/hooks/use-decision-feed", () => ({
  useDecisionFeed: () => mockFeed,
}));

// Tenant: a mutable variable, mocked at the hook layer (not next-auth) so the
// component's call to useTenantContext() flips behavior directly.
let mockTenant: { orgId: string; keys: unknown } | null = {
  orgId: "org-1",
  keys: {},
};
vi.mock("@/hooks/use-query-keys", () => ({
  useTenantContext: () => mockTenant,
}));

// Dispatch: a stable spy that tests inspect.
const dispatchMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/decisions/dispatch-action", () => ({
  dispatchDecisionAction: (...args: unknown[]) => dispatchMock(...args),
}));

// DecisionCard: a single mock that exposes folio.kindLabel as a data attr and
// surfaces onPrimary / onSecondary as test-id'd buttons. Used by Tasks 5–7.
vi.mock("@/components/decisions/decision-card", () => ({
  DecisionCard: ({
    folio,
    serifSentence,
    onPrimary,
    onSecondary,
  }: {
    folio: { kindLabel: string };
    serifSentence?: string;
    onPrimary?: () => void;
    onSecondary?: () => void;
  }) => (
    <article data-testid="mock-decision-card" data-folio-kind-label={folio.kindLabel}>
      <p>{serifSentence}</p>
      <button data-testid="card-primary" onClick={onPrimary}>
        primary
      </button>
      <button data-testid="card-secondary" onClick={onSecondary}>
        secondary
      </button>
    </article>
  ),
}));

import { InboxDrawer } from "../inbox-drawer";

beforeEach(() => {
  // Reset mutable mock state to the default tenant-present, empty-feed shape.
  mockTenant = { orgId: "org-1", keys: {} };
  mockFeed = {
    data: { decisions: [], counts: { total: 3, approval: 2, handoff: 1 } },
    isLoading: false,
    isError: false,
  };
  dispatchMock.mockReset();
  dispatchMock.mockResolvedValue(undefined);
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("InboxDrawer — header DOM contract", () => {
  it("preserves the folio-link trigger DOM (pip + label + separator + count)", () => {
    mockFeed = {
      data: { decisions: [], counts: { total: 3, approval: 2, handoff: 1 } },
      isLoading: false,
      isError: false,
    };
    const { container } = render(<InboxDrawer />, { wrapper });

    const trigger = container.querySelector("button.folio-link");
    expect(trigger).not.toBeNull();
    expect(trigger?.querySelector("span.pip")).not.toBeNull();
    expect(trigger?.textContent).toContain("Inbox");
    expect(trigger?.textContent).toContain("·");
    const num = trigger?.querySelector("span.num");
    expect(num?.textContent).toBe("3");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @switchboard/dashboard test src/components/layout/__tests__/inbox-drawer.test.tsx
```

Expected: FAIL with `Cannot find module '../inbox-drawer'`.

- [ ] **Step 3: Create the empty drawer-specific CSS file**

Create `apps/dashboard/src/components/layout/inbox-drawer.css` with the initial scaffold — content gets added in later tasks:

```css
/* =========================================================
   Inbox Drawer — editorial register.
   Editorial tokens (typography, hairlines, ambient cream)
   live in globals.css. Drawer-specific styling only here.
   ========================================================= */

.inbox-drawer {
  background: var(--ambient-cream, hsl(40 25% 94%));
}

.inbox-item {
  position: relative;
}

.inbox-item::before {
  content: "";
  position: absolute;
  top: 24px;
  left: -10px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--inbox-agent-accent, transparent);
}
```

- [ ] **Step 4: Implement the minimal `InboxDrawer` (trigger only)**

Create `apps/dashboard/src/components/layout/inbox-drawer.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Sheet, SheetTrigger } from "@/components/ui/sheet";
import { useDecisionFeed } from "@/hooks/use-decision-feed";
import "./inbox-drawer.css";

export function InboxDrawer() {
  const [open, setOpen] = useState(false);
  const { data } = useDecisionFeed(null);

  const total = data?.counts.total ?? 0;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="folio-link"
          aria-label={total > 0 ? `Inbox, ${total} item${total === 1 ? "" : "s"}` : "Inbox, empty"}
        >
          {total > 0 && <span className="pip" />}
          <span>Inbox</span>
          {total > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="num">{total}</span>
            </>
          )}
        </button>
      </SheetTrigger>
    </Sheet>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter @switchboard/dashboard test src/components/layout/__tests__/inbox-drawer.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/layout/inbox-drawer.tsx \
        apps/dashboard/src/components/layout/inbox-drawer.css \
        apps/dashboard/src/components/layout/__tests__/inbox-drawer.test.tsx
git commit -m "feat(dashboard): inbox drawer — minimal trigger preserving header DOM contract"
```

---

## Task 2: Aria-label count cases + tenant-null disabled trigger

**Files:**

- Modify: `apps/dashboard/src/components/layout/__tests__/inbox-drawer.test.tsx`
- Modify: `apps/dashboard/src/components/layout/inbox-drawer.tsx`

- [ ] **Step 1: Add the aria-label and tenant-null tests**

Append to the test file (inside the existing `describe` block, after the header-contract test):

```tsx
describe("InboxDrawer — trigger aria-label", () => {
  it("reads 'Inbox, empty' when total is 0", () => {
    mockFeed = {
      data: { decisions: [], counts: { total: 0, approval: 0, handoff: 0 } },
      isLoading: false,
      isError: false,
    };
    render(<InboxDrawer />, { wrapper });
    expect(screen.getByRole("button", { name: "Inbox, empty" })).toBeInTheDocument();
  });

  it("reads 'Inbox, 1 item' when total is 1", () => {
    mockFeed = {
      data: { decisions: [], counts: { total: 1, approval: 1, handoff: 0 } },
      isLoading: false,
      isError: false,
    };
    render(<InboxDrawer />, { wrapper });
    expect(screen.getByRole("button", { name: "Inbox, 1 item" })).toBeInTheDocument();
  });

  it("reads 'Inbox, 3 items' when total is 3", () => {
    mockFeed = {
      data: { decisions: [], counts: { total: 3, approval: 2, handoff: 1 } },
      isLoading: false,
      isError: false,
    };
    render(<InboxDrawer />, { wrapper });
    expect(screen.getByRole("button", { name: "Inbox, 3 items" })).toBeInTheDocument();
  });
});

describe("InboxDrawer — tenant-null trigger", () => {
  it("renders the trigger disabled when tenant context is null", async () => {
    mockTenant = null;
    mockFeed = {
      data: undefined,
      isLoading: false,
      isError: false,
    };
    const user = userEvent.setup();
    render(<InboxDrawer />, { wrapper });

    const trigger = screen.getByRole("button", { name: "Inbox, empty" });
    expect(trigger).toBeDisabled();

    // Clicking a disabled button must not open the dialog.
    await user.click(trigger);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify the disabled test fails (others may pass already)**

```bash
pnpm --filter @switchboard/dashboard test src/components/layout/__tests__/inbox-drawer.test.tsx
```

Expected: aria-label tests likely PASS (the existing impl already covers them); the tenant-null test FAILs because `disabled` is not yet wired.

- [ ] **Step 3: Wire tenant gate into the trigger**

Modify `apps/dashboard/src/components/layout/inbox-drawer.tsx` to consume `useTenantContext` and pass `disabled`:

```tsx
"use client";

import { useState } from "react";
import { Sheet, SheetTrigger } from "@/components/ui/sheet";
import { useDecisionFeed } from "@/hooks/use-decision-feed";
import { useTenantContext } from "@/hooks/use-query-keys";
import "./inbox-drawer.css";

export function InboxDrawer() {
  const [open, setOpen] = useState(false);
  const { data } = useDecisionFeed(null);
  const tenant = useTenantContext();

  const total = data?.counts.total ?? 0;
  const tenantReady = !!tenant;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="folio-link"
          disabled={!tenantReady}
          aria-label={total > 0 ? `Inbox, ${total} item${total === 1 ? "" : "s"}` : "Inbox, empty"}
        >
          {total > 0 && <span className="pip" />}
          <span>Inbox</span>
          {total > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="num">{total}</span>
            </>
          )}
        </button>
      </SheetTrigger>
    </Sheet>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @switchboard/dashboard test src/components/layout/__tests__/inbox-drawer.test.tsx
```

Expected: PASS for header contract, all three aria-label cases, and tenant-null disabled.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/layout/inbox-drawer.tsx \
        apps/dashboard/src/components/layout/__tests__/inbox-drawer.test.tsx
git commit -m "feat(dashboard): inbox drawer — aria-label cases + tenant-null disabled trigger"
```

---

## Task 3: Drawer chrome (Sheet content shell + a11y title/description)

**Files:**

- Modify: `apps/dashboard/src/components/layout/__tests__/inbox-drawer.test.tsx`
- Modify: `apps/dashboard/src/components/layout/inbox-drawer.tsx`

- [ ] **Step 1: Add the accessible-name test**

Append to the test file:

```tsx
describe("InboxDrawer — accessibility", () => {
  it("opens a dialog with accessible name 'Inbox' when the trigger is clicked", async () => {
    mockFeed = {
      data: { decisions: [], counts: { total: 0, approval: 0, handoff: 0 } },
      isLoading: false,
      isError: false,
    };
    render(<InboxDrawer />, { wrapper });
    const trigger = screen.getByRole("button", { name: /^Inbox/ });
    trigger.click();

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAccessibleName("Inbox");
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter @switchboard/dashboard test src/components/layout/__tests__/inbox-drawer.test.tsx
```

Expected: FAIL — no `dialog` role appears because `SheetContent` isn't mounted yet.

- [ ] **Step 3: Add SheetContent shell with title + description**

Update `apps/dashboard/src/components/layout/inbox-drawer.tsx`:

```tsx
"use client";

import { useState } from "react";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useDecisionFeed } from "@/hooks/use-decision-feed";
import { useTenantContext } from "@/hooks/use-query-keys";
import "./inbox-drawer.css";

function describeTotal(total: number, isLoading: boolean, isError: boolean): string {
  if (isLoading) return "Reading…";
  if (isError) return "Couldn't load.";
  if (total === 0) return "You're caught up.";
  return `${total} pending across your team.`;
}

export function InboxDrawer() {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useDecisionFeed(null);
  const tenant = useTenantContext();

  const total = data?.counts.total ?? 0;
  const tenantReady = !!tenant;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="folio-link"
          disabled={!tenantReady}
          aria-label={total > 0 ? `Inbox, ${total} item${total === 1 ? "" : "s"}` : "Inbox, empty"}
        >
          {total > 0 && <span className="pip" />}
          <span>Inbox</span>
          {total > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="num">{total}</span>
            </>
          )}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="inbox-drawer sm:max-w-[28rem]">
        <SheetHeader>
          <SheetTitle className="font-display">Inbox</SheetTitle>
          <SheetDescription>{describeTotal(total, isLoading, isError)}</SheetDescription>
        </SheetHeader>
        {/* List body added in Task 4 */}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @switchboard/dashboard test src/components/layout/__tests__/inbox-drawer.test.tsx
```

Expected: PASS, including the new accessible-name test.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/layout/inbox-drawer.tsx \
        apps/dashboard/src/components/layout/__tests__/inbox-drawer.test.tsx
git commit -m "feat(dashboard): inbox drawer — SheetContent shell with editorial title + accessible description"
```

---

## Task 4: List body — loading, error, empty states

**Files:**

- Modify: `apps/dashboard/src/components/layout/__tests__/inbox-drawer.test.tsx`
- Modify: `apps/dashboard/src/components/layout/inbox-drawer.tsx`

- [ ] **Step 1: Add list-state tests**

Append to the test file:

```tsx
describe("InboxDrawer — list states", () => {
  it("renders 'Reading your inbox…' when the feed is loading and has no cached data", async () => {
    mockFeed = {
      data: undefined,
      isLoading: true,
      isError: false,
    };
    render(<InboxDrawer />, { wrapper });
    screen.getByRole("button", { name: /^Inbox/ }).click();
    expect(await screen.findByText(/Reading your inbox/i)).toBeInTheDocument();
  });

  it("renders 'Couldn't load your inbox.' when the feed errored", async () => {
    mockFeed = {
      data: undefined,
      isLoading: false,
      isError: true,
    };
    render(<InboxDrawer />, { wrapper });
    screen.getByRole("button", { name: /^Inbox/ }).click();
    expect(await screen.findByText(/Couldn't load your inbox\./i)).toBeInTheDocument();
  });

  it("renders the editorial empty-state copy when total is 0", async () => {
    mockFeed = {
      data: { decisions: [], counts: { total: 0, approval: 0, handoff: 0 } },
      isLoading: false,
      isError: false,
    };
    render(<InboxDrawer />, { wrapper });
    screen.getByRole("button", { name: /^Inbox/ }).click();
    expect(
      await screen.findByText(
        /You're caught up across your team\. I'll write again when something needs you\./i,
      ),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
pnpm --filter @switchboard/dashboard test src/components/layout/__tests__/inbox-drawer.test.tsx
```

Expected: FAIL — list body is empty in the SheetContent.

- [ ] **Step 3: Add the list-body rendering branch**

Replace the `{/* List body added in Task 4 */}` comment in `inbox-drawer.tsx` with:

```tsx
{
  isLoading && !data ? (
    <p className="empty-state">
      <em>Reading your inbox…</em>
    </p>
  ) : isError ? (
    <p className="empty-state">
      <em>Couldn&apos;t load your inbox.</em>
    </p>
  ) : total === 0 ? (
    <p className="empty-state">
      <em>
        You&apos;re caught up across your team. I&apos;ll write again when something needs you.
      </em>
    </p>
  ) : (
    <div className="decisions" data-testid="inbox-list">
      {/* Populated list added in Task 5 */}
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @switchboard/dashboard test src/components/layout/__tests__/inbox-drawer.test.tsx
```

Expected: PASS for all three list-state cases.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/layout/inbox-drawer.tsx \
        apps/dashboard/src/components/layout/__tests__/inbox-drawer.test.tsx
git commit -m "feat(dashboard): inbox drawer — loading/error/empty states with editorial copy"
```

---

## Task 5: Populated list — DecisionCard with composed agent label + accent variable

This task wires `mapToDecisionCard` and `DecisionCard`, with the agent name composed at the call site and the accent piped via `--inbox-agent-accent`. We mock `DecisionCard` so the test asserts the drawer's composition behavior, not `DecisionCard`'s internals (per spec §5.1 test 7).

**Files:**

- Modify: `apps/dashboard/src/components/layout/__tests__/inbox-drawer.test.tsx`
- Modify: `apps/dashboard/src/components/layout/inbox-drawer.tsx`

- [ ] **Step 1: Add the populated-list test**

(No new mock needed — the top-level `DecisionCard` mock from the test file's preamble already exposes `data-folio-kind-label`.)

Append to the test file:

```tsx
describe("InboxDrawer — populated list", () => {
  it("renders one DecisionCard per item with the agent name prefix and accent variable", async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();
    mockFeed = {
      data: {
        decisions: [
          {
            id: "approval:rec-1",
            kind: "approval",
            orgId: "org-1",
            agentKey: "alex",
            humanSummary: "A new lead just walked in.",
            presentation: {
              primaryLabel: "Reply",
              secondaryLabel: "Skip",
              dismissLabel: "Dismiss",
              dataLines: [],
            },
            urgencyScore: 80,
            createdAt: now,
            threadHref: null,
            sourceRef: { kind: "approval", sourceId: "rec-1" },
            meta: { contactName: "Sam Lee", riskLevel: "low" },
          },
          {
            id: "handoff:hand-1",
            kind: "handoff",
            orgId: "org-1",
            agentKey: "riley",
            humanSummary: "Conversation needs a human.",
            presentation: {
              primaryLabel: "Take over",
              secondaryLabel: "Resolve",
              dismissLabel: "Dismiss",
              dataLines: [],
            },
            urgencyScore: 60,
            createdAt: now,
            threadHref: "/contacts/c1/conversations/t1",
            sourceRef: { kind: "handoff", sourceId: "hand-1" },
            meta: { contactName: "Jay Park" },
          },
        ],
        counts: { total: 2, approval: 1, handoff: 1 },
      },
      isLoading: false,
      isError: false,
    };

    render(<InboxDrawer />, { wrapper });
    await user.click(screen.getByRole("button", { name: /^Inbox/ }));

    const cards = await screen.findAllByTestId("mock-decision-card");
    expect(cards).toHaveLength(2);
    // Assert the drawer-added prefix only; the suffix is mapToDecisionCard's
    // contract, tested elsewhere. This isolates C1's responsibility.
    expect(cards[0].getAttribute("data-folio-kind-label")).toContain("Alex ·");
    expect(cards[1].getAttribute("data-folio-kind-label")).toContain("Riley ·");

    const list = screen.getByTestId("inbox-list");
    const wrappers = list.querySelectorAll(".inbox-item");
    expect(wrappers).toHaveLength(2);
    expect(wrappers[0].getAttribute("data-agent")).toBe("alex");
    expect(wrappers[1].getAttribute("data-agent")).toBe("riley");

    const alexAccent = (wrappers[0] as HTMLElement).style.getPropertyValue("--inbox-agent-accent");
    const rileyAccent = (wrappers[1] as HTMLElement).style.getPropertyValue("--inbox-agent-accent");
    expect(alexAccent).toBe("hsl(20 90% 55%)");
    expect(rileyAccent).toBe("hsl(15 45% 50%)");
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter @switchboard/dashboard test src/components/layout/__tests__/inbox-drawer.test.tsx
```

Expected: FAIL — list body still has the placeholder comment, no cards render.

- [ ] **Step 3: Implement the populated list**

Update `apps/dashboard/src/components/layout/inbox-drawer.tsx`:

```tsx
"use client";

import { useState, type CSSProperties } from "react";
import { AGENT_REGISTRY } from "@switchboard/schemas";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { DecisionCard } from "@/components/decisions/decision-card";
import { useDecisionFeed } from "@/hooks/use-decision-feed";
import { useTenantContext } from "@/hooks/use-query-keys";
import { mapToDecisionCard } from "@/lib/decisions/map-to-decision-card";
import "./inbox-drawer.css";

function describeTotal(total: number, isLoading: boolean, isError: boolean): string {
  if (isLoading) return "Reading…";
  if (isError) return "Couldn't load.";
  if (total === 0) return "You're caught up.";
  return `${total} pending across your team.`;
}

export function InboxDrawer() {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useDecisionFeed(null);
  const tenant = useTenantContext();

  const decisions = data?.decisions ?? [];
  const total = data?.counts.total ?? 0;
  const tenantReady = !!tenant;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="folio-link"
          disabled={!tenantReady}
          aria-label={total > 0 ? `Inbox, ${total} item${total === 1 ? "" : "s"}` : "Inbox, empty"}
        >
          {total > 0 && <span className="pip" />}
          <span>Inbox</span>
          {total > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="num">{total}</span>
            </>
          )}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="inbox-drawer sm:max-w-[28rem]">
        <SheetHeader>
          <SheetTitle className="font-display">Inbox</SheetTitle>
          <SheetDescription>{describeTotal(total, isLoading, isError)}</SheetDescription>
        </SheetHeader>
        {isLoading && !data ? (
          <p className="empty-state">
            <em>Reading your inbox…</em>
          </p>
        ) : isError ? (
          <p className="empty-state">
            <em>Couldn&apos;t load your inbox.</em>
          </p>
        ) : total === 0 ? (
          <p className="empty-state">
            <em>
              You&apos;re caught up across your team. I&apos;ll write again when something needs
              you.
            </em>
          </p>
        ) : (
          <div className="decisions" data-testid="inbox-list">
            {decisions.map((d, i) => {
              const card = mapToDecisionCard(d, i);
              const agent = AGENT_REGISTRY[d.agentKey];
              const agentName = agent?.displayName ?? d.agentKey;
              const folioWithAgent = {
                ...card.folio,
                kindLabel: `${agentName} · ${card.folio.kindLabel}`,
              };
              return (
                <div
                  key={d.id}
                  data-agent={d.agentKey}
                  className="inbox-item"
                  style={{ "--inbox-agent-accent": agent?.accent } as CSSProperties}
                >
                  <DecisionCard {...card} folio={folioWithAgent} />
                </div>
              );
            })}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @switchboard/dashboard test src/components/layout/__tests__/inbox-drawer.test.tsx
```

Expected: PASS, including the new populated-list test. (TypeScript may complain about `decisions[i]`'s type — `useDecisionFeed`'s return type is `Decision[]`. The mock returns plain objects shaped like `Decision`, which is enough for the drawer's call site to compile against `Decision`.)

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/layout/inbox-drawer.tsx \
        apps/dashboard/src/components/layout/__tests__/inbox-drawer.test.tsx
git commit -m "feat(dashboard): inbox drawer — populated list with composed agent label + accent variable"
```

---

## Task 6: Action dispatch with per-item agentKey

**Files:**

- Modify: `apps/dashboard/src/components/layout/__tests__/inbox-drawer.test.tsx`
- Modify: `apps/dashboard/src/components/layout/inbox-drawer.tsx`

- [ ] **Step 1: Add the dispatch test**

(`dispatchMock` and the `DecisionCard` mock are already declared at the top of the test file.)

Append to the test file:

```tsx
describe("InboxDrawer — action dispatch", () => {
  it("invokes dispatchDecisionAction with the per-item agentKey on primary click", async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();
    mockFeed = {
      data: {
        decisions: [
          {
            id: "handoff:hand-1",
            kind: "handoff",
            orgId: "org-1",
            agentKey: "riley",
            humanSummary: "Conversation needs a human.",
            presentation: {
              primaryLabel: "Take over",
              secondaryLabel: "Resolve",
              dismissLabel: "Dismiss",
              dataLines: [],
            },
            urgencyScore: 60,
            createdAt: now,
            threadHref: null,
            sourceRef: { kind: "handoff", sourceId: "hand-1" },
            meta: { contactName: "Jay Park" },
          },
        ],
        counts: { total: 1, approval: 0, handoff: 1 },
      },
      isLoading: false,
      isError: false,
    };

    render(<InboxDrawer />, { wrapper });
    await user.click(screen.getByRole("button", { name: /^Inbox/ }));
    await user.click(await screen.findByTestId("card-primary"));

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    const callArgs = dispatchMock.mock.calls[0];
    expect(callArgs[0]).toEqual({ kind: "handoff", sourceId: "hand-1" });
    expect(callArgs[1]).toBe("primary");
    expect(callArgs[3]).toMatchObject({
      orgId: "org-1",
      agentKey: "riley",
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter @switchboard/dashboard test src/components/layout/__tests__/inbox-drawer.test.tsx
```

Expected: FAIL — `DecisionCard` currently receives no `onPrimary` from the drawer.

- [ ] **Step 3: Wire `handleAction` into the populated list**

Update `inbox-drawer.tsx` to import the dispatcher and `useQueryClient`, and pass action handlers to `DecisionCard`:

```tsx
"use client";

import { useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AGENT_REGISTRY } from "@switchboard/schemas";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { DecisionCard } from "@/components/decisions/decision-card";
import { useDecisionFeed } from "@/hooks/use-decision-feed";
import { useTenantContext } from "@/hooks/use-query-keys";
import { mapToDecisionCard } from "@/lib/decisions/map-to-decision-card";
import { dispatchDecisionAction } from "@/lib/decisions/dispatch-action";
import type { Decision } from "@/lib/decisions/types";
import "./inbox-drawer.css";

// Note: Decision.agentKey is already typed as AgentKey upstream
// (apps/dashboard/src/lib/decisions/types.ts). No cast needed at this call site.

function describeTotal(total: number, isLoading: boolean, isError: boolean): string {
  if (isLoading) return "Reading…";
  if (isError) return "Couldn't load.";
  if (total === 0) return "You're caught up.";
  return `${total} pending across your team.`;
}

export function InboxDrawer() {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useDecisionFeed(null);
  const tenant = useTenantContext();
  const queryClient = useQueryClient();

  const decisions = data?.decisions ?? [];
  const total = data?.counts.total ?? 0;
  const tenantReady = !!tenant;

  async function handleAction(d: Decision, action: "primary" | "secondary"): Promise<void> {
    if (!tenant) return;
    await dispatchDecisionAction(d.sourceRef, action, undefined, {
      queryClient,
      orgId: tenant.orgId,
      agentKey: d.agentKey,
    });
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="folio-link"
          disabled={!tenantReady}
          aria-label={total > 0 ? `Inbox, ${total} item${total === 1 ? "" : "s"}` : "Inbox, empty"}
        >
          {total > 0 && <span className="pip" />}
          <span>Inbox</span>
          {total > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="num">{total}</span>
            </>
          )}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="inbox-drawer sm:max-w-[28rem]">
        <SheetHeader>
          <SheetTitle className="font-display">Inbox</SheetTitle>
          <SheetDescription>{describeTotal(total, isLoading, isError)}</SheetDescription>
        </SheetHeader>
        {isLoading && !data ? (
          <p className="empty-state">
            <em>Reading your inbox…</em>
          </p>
        ) : isError ? (
          <p className="empty-state">
            <em>Couldn&apos;t load your inbox.</em>
          </p>
        ) : total === 0 ? (
          <p className="empty-state">
            <em>
              You&apos;re caught up across your team. I&apos;ll write again when something needs
              you.
            </em>
          </p>
        ) : (
          <div className="decisions" data-testid="inbox-list">
            {decisions.map((d, i) => {
              const card = mapToDecisionCard(d, i);
              const agent = AGENT_REGISTRY[d.agentKey];
              const agentName = agent?.displayName ?? d.agentKey;
              const folioWithAgent = {
                ...card.folio,
                kindLabel: `${agentName} · ${card.folio.kindLabel}`,
              };
              return (
                <div
                  key={d.id}
                  data-agent={d.agentKey}
                  className="inbox-item"
                  style={{ "--inbox-agent-accent": agent?.accent } as CSSProperties}
                >
                  <DecisionCard
                    {...card}
                    folio={folioWithAgent}
                    onPrimary={() => void handleAction(d, "primary")}
                    onSecondary={() => void handleAction(d, "secondary")}
                  />
                </div>
              );
            })}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @switchboard/dashboard test src/components/layout/__tests__/inbox-drawer.test.tsx
```

Expected: PASS, including the new dispatch test.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/layout/inbox-drawer.tsx \
        apps/dashboard/src/components/layout/__tests__/inbox-drawer.test.tsx
git commit -m "feat(dashboard): inbox drawer — wire dispatchDecisionAction with per-item agentKey"
```

---

## Task 7: Auto-close on inbox-zero (action-driven, with bidirectional ref reset)

This is the most subtle behavior in the spec. Tests cover three cases: positive (acted → count 0 → drawer closes), negative (count drops to 0 without action → drawer stays open), and ref reset (close after acting, reopen, count drops to 0 without action → drawer stays open).

**Files:**

- Modify: `apps/dashboard/src/components/layout/__tests__/inbox-drawer.test.tsx`
- Modify: `apps/dashboard/src/components/layout/inbox-drawer.tsx`

- [ ] **Step 1: Add the auto-close tests**

Append to the test file:

```tsx
describe("InboxDrawer — auto-close on inbox-zero", () => {
  function makeOneItemFeed() {
    const now = new Date().toISOString();
    return {
      data: {
        decisions: [
          {
            id: "approval:rec-1",
            kind: "approval",
            orgId: "org-1",
            agentKey: "alex",
            humanSummary: "Lead.",
            presentation: {
              primaryLabel: "Reply",
              secondaryLabel: "Skip",
              dismissLabel: "Dismiss",
              dataLines: [],
            },
            urgencyScore: 80,
            createdAt: now,
            threadHref: null,
            sourceRef: { kind: "approval", sourceId: "rec-1" },
            meta: {},
          },
        ],
        counts: { total: 1, approval: 1, handoff: 0 },
      },
      isLoading: false,
      isError: false,
    };
  }
  const emptyFeed = {
    data: { decisions: [], counts: { total: 0, approval: 0, handoff: 0 } },
    isLoading: false,
    isError: false,
  };

  it("closes the drawer when count hits 0 AFTER a successful in-session action", async () => {
    const user = userEvent.setup();
    mockFeed = makeOneItemFeed();
    const { rerender } = render(<InboxDrawer />, { wrapper });

    await user.click(screen.getByRole("button", { name: /^Inbox/ }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await user.click(await screen.findByTestId("card-primary"));
    // The dispatcher promise resolves on the next microtask; wait for the spy
    // so we know the in-session ref has flipped before the rerender.
    await waitFor(() => expect(dispatchMock).toHaveBeenCalledTimes(1));

    // Simulate the post-dispatch refetch: count goes to 0.
    mockFeed = emptyFeed;
    rerender(<InboxDrawer />);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("stays open when count drops to 0 without a successful in-session action", async () => {
    const user = userEvent.setup();
    mockFeed = makeOneItemFeed();
    const { rerender } = render(<InboxDrawer />, { wrapper });

    await user.click(screen.getByRole("button", { name: /^Inbox/ }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    // Another surface clears the inbox; user did not act inside the drawer.
    mockFeed = emptyFeed;
    rerender(<InboxDrawer />);

    // Give effects a tick to run, then assert the drawer stayed open.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("resets the in-session-action flag when the drawer closes manually", async () => {
    const user = userEvent.setup();
    // Dispatcher resolves but feed still shows the item — drawer stays open after action.
    mockFeed = makeOneItemFeed();
    const { rerender } = render(<InboxDrawer />, { wrapper });

    await user.click(screen.getByRole("button", { name: /^Inbox/ }));
    await user.click(await screen.findByTestId("card-primary"));
    await waitFor(() => expect(dispatchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // User closes manually via Escape — Radix listens at document, userEvent fires it correctly.
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // Reopen with the item still present.
    await user.click(screen.getByRole("button", { name: /^Inbox/ }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    // Feed drops to 0 without acting — drawer must stay open (ref reset on close).
    mockFeed = emptyFeed;
    rerender(<InboxDrawer />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
```

(`beforeEach`, `userEvent`, and `waitFor` are already imported at the top of the test file from Task 1's preamble.)

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter @switchboard/dashboard test src/components/layout/__tests__/inbox-drawer.test.tsx
```

Expected: the positive case FAILS (drawer stays open after action when count drops); negative case may pass coincidentally; reset case FAILS for the same reason as positive.

- [ ] **Step 3: Add the auto-close logic**

In `inbox-drawer.tsx`, add a `useRef` and two `useEffect`s. Update the imports and add the hooks at the top of the component:

```tsx
import { useEffect, useRef, useState, type CSSProperties } from "react";
```

Inside `InboxDrawer`, add after the existing state/hook declarations:

```tsx
const actedInSessionRef = useRef(false);

// Reset the session-action flag on every open/close transition (in either direction).
useEffect(() => {
  actedInSessionRef.current = false;
}, [open]);

// Auto-close when the inbox hits zero AFTER a successful in-session action.
useEffect(() => {
  if (open && total === 0 && actedInSessionRef.current) {
    setOpen(false);
  }
}, [open, total]);
```

Then update `handleAction` to flip the ref only after a successful dispatch. Don't wrap with try/catch — propagate errors to match the existing dispatcher contract used by the Needs You block. If dispatch rejects, the ref simply doesn't flip and the caller's promise rejects (React swallows the unhandled rejection from the `void` call site, same as the Needs You block).

```tsx
async function handleAction(d: Decision, action: "primary" | "secondary"): Promise<void> {
  if (!tenant) return;
  await dispatchDecisionAction(d.sourceRef, action, undefined, {
    queryClient,
    orgId: tenant.orgId,
    agentKey: d.agentKey,
  });
  actedInSessionRef.current = true;
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @switchboard/dashboard test src/components/layout/__tests__/inbox-drawer.test.tsx
```

Expected: PASS, including all three auto-close cases.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/layout/inbox-drawer.tsx \
        apps/dashboard/src/components/layout/__tests__/inbox-drawer.test.tsx
git commit -m "feat(dashboard): inbox drawer — action-driven auto-close with bidirectional ref reset"
```

---

## Task 8: Wire `InboxDrawer` into the editorial header

**Files:**

- Modify: `apps/dashboard/src/components/layout/editorial-auth-shell.tsx`

- [ ] **Step 1: Replace the import and the element**

Open `apps/dashboard/src/components/layout/editorial-auth-shell.tsx`. Change one import line and one JSX element.

Replace:

```tsx
import { InboxLinkClient } from "./inbox-link-client";
```

with:

```tsx
import { InboxDrawer } from "./inbox-drawer";
```

Replace:

```tsx
<InboxLinkClient />
```

with:

```tsx
<InboxDrawer />
```

- [ ] **Step 2: Run typecheck and the editorial-auth-shell tests**

```bash
pnpm --filter @switchboard/dashboard typecheck
pnpm --filter @switchboard/dashboard test src/components/layout/__tests__/editorial-auth-shell.test.tsx
```

Expected: typecheck clean. Existing editorial-auth-shell tests pass — they were not asserting on `InboxLinkClient` specifically; if any do, update them to expect `InboxDrawer` (likely just a string match in the rendered output if the test does a smoke render).

If the editorial-auth-shell test fails because it asserts that `InboxLinkClient` renders, update the assertion to look for a button with class `folio-link` and the text `Inbox` — the user-visible contract is what we promised to preserve.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/layout/editorial-auth-shell.tsx
git commit -m "feat(dashboard): editorial-auth-shell uses InboxDrawer in place of placeholder"
```

---

## Task 9: Delete `inbox-link-client.tsx` and remove orphaned `useInboxCount`

**Files:**

- Delete: `apps/dashboard/src/components/layout/inbox-link-client.tsx`
- Modify: `apps/dashboard/src/hooks/use-decision-feed.ts`
- Modify: `apps/dashboard/src/app/(auth)/[agentKey]/__tests__/agent-home-client.test.tsx`

- [ ] **Step 1: Verify nothing else imports the file or hook**

```bash
git grep -n "inbox-link-client" apps/dashboard/src
git grep -n "useInboxCount" apps/dashboard/src
```

Expected:

- `inbox-link-client` matches only the file itself (the editorial-shell import was removed in Task 8).
- `useInboxCount` matches only `apps/dashboard/src/hooks/use-decision-feed.ts` (the export) and `apps/dashboard/src/app/(auth)/[agentKey]/__tests__/agent-home-client.test.tsx:10` (the mock).

If any other consumer appears, **stop**: investigate whether C1 has a missed dependency before deleting.

- [ ] **Step 2: Delete the file**

```bash
git rm apps/dashboard/src/components/layout/inbox-link-client.tsx
```

- [ ] **Step 3: Remove the `useInboxCount` export**

Open `apps/dashboard/src/hooks/use-decision-feed.ts`. Delete the trailing block:

```ts
export function useInboxCount(): number {
  const { data } = useDecisionFeed(null);
  return data?.counts.total ?? 0;
}
```

The file's remaining responsibility is `useDecisionFeed` only.

- [ ] **Step 4: Remove the test mock entry**

Open `apps/dashboard/src/app/(auth)/[agentKey]/__tests__/agent-home-client.test.tsx`. Find line 10 (or thereabouts) — it's part of a `vi.mock("@/hooks/use-decision-feed", () => ({ … }))` factory. Remove the line:

```ts
useInboxCount: () => 0,
```

(Leave the rest of the factory untouched; only the `useInboxCount` entry goes.)

- [ ] **Step 5: Verify nothing references the deleted symbols**

```bash
git grep -n "inbox-link-client" apps/dashboard/src
git grep -n "useInboxCount" apps/dashboard/src
```

Expected: no matches.

- [ ] **Step 6: Run typecheck + the affected tests**

```bash
pnpm --filter @switchboard/dashboard typecheck
pnpm --filter @switchboard/dashboard test src/components/layout/__tests__/inbox-drawer.test.tsx \
                                          src/app/\(auth\)/\[agentKey\]/__tests__/agent-home-client.test.tsx
```

Expected: typecheck clean, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/hooks/use-decision-feed.ts \
        apps/dashboard/src/app/\(auth\)/\[agentKey\]/__tests__/agent-home-client.test.tsx
git commit -m "chore(dashboard): delete inbox-link-client.tsx + remove orphaned useInboxCount"
```

---

## Task 10: Final verification + visual smoke

**Files:** none (verification only)

- [ ] **Step 1: Run the full dashboard suite**

```bash
pnpm --filter @switchboard/dashboard lint
pnpm --filter @switchboard/dashboard typecheck
pnpm --filter @switchboard/dashboard test
```

Expected: clean lint, clean typecheck, all tests pass.

- [ ] **Step 2: Inspection — confirm no second fetch path**

```bash
grep -n "useDecisionFeed" apps/dashboard/src/components/layout/inbox-drawer.tsx
grep -n "useInboxCount\|inbox-link-client" apps/dashboard/src
```

Expected: exactly one `useDecisionFeed(null)` in `inbox-drawer.tsx`. Zero matches for `useInboxCount` or `inbox-link-client` anywhere in `apps/dashboard/src`.

- [ ] **Step 3: Inspection — confirm header diff scope**

```bash
git diff main -- apps/dashboard/src/components/layout/editorial-auth-shell.tsx
```

Expected: the only changes are one import swap (`InboxLinkClient` → `InboxDrawer`) and one element swap (`<InboxLinkClient />` → `<InboxDrawer />`). No formatter-only lines that aren't tied to those two edits.

- [ ] **Step 4: Visual smoke (manual)**

Start the dev stack and verify the drawer in a browser:

```bash
# In one shell:
pnpm --filter @switchboard/api dev
# In another shell:
pnpm --filter @switchboard/dashboard dev
```

Open `http://localhost:3002/alex` (sign in if needed). Then:

1. Confirm the editorial header shows `Inbox` (with a count chip if there are pending decisions). The trigger should look identical to before — no layout shift compared to `main`.
2. Click `Inbox`. A right-side drawer slides in. Title reads `Inbox` in the display serif. Description summarizes the count.
3. If decisions exist, each row shows `${AgentName} · DECISION N` (or `HANDOFF N`) in the folio, with a small accent dot in the agent's brand color.
4. Click a card's primary action. The item disappears from the drawer (existing dispatcher invalidation refetches the feed).
5. If you happen to clear the last item, verify the drawer auto-closes after a beat. If you clear the inbox from another tab/surface (without acting in the drawer), the drawer should stay open.
6. Press `Esc` — drawer closes.
7. With no tenant (sign out, navigate back), confirm the trigger renders disabled and clicking does nothing.

If any of those visual checks fail, fix before proceeding.

- [ ] **Step 5: Push the branch and open the PR**

```bash
git push -u origin feat/inbox-drawer-c1
```

Open a PR against `main` titled `feat(dashboard): C1 — inbox drawer (cross-agent decisions overlay)` with the spec and plan referenced in the description, plus the visual smoke checklist as the test plan.

---

## Self-review — spec coverage

Walking through `docs/superpowers/specs/2026-05-08-inbox-drawer-c1-design.md` section by section to confirm every requirement is implemented:

- §1.1 / 1.2 / 1.3 — scope and dependencies are descriptive; no implementation gaps.
- §1.4 Q1 (right-side sheet) — Task 3 (`SheetContent side="right"`).
- §1.4 Q2 (single urgency-sorted list, agent chip) — Task 5 (list iterates `decisions` in API order; Task 5 composes the agent chip).
- §1.4 Q3 (reuse DecisionCard) — Tasks 5 + 6 (drawer mounts `DecisionCard` directly).
- §1.4 Q4 (auto-close action-driven) — Task 7.
- §1.4 Q5 (threadHref reused) — passes through `mapToDecisionCard` → `DecisionCard` (no special handling required; covered by spreading `{...card}` in Task 5).
- §1.4 Q6 (editorial empty/loading copy) — Task 4.
- §1.4 Q7 (no new gating) — no task; the editorial shell is already prod-visible after PR-S6.
- §1.4 Q8 (Mira naturally absent) — no task; Mira authors no decisions in v1.
- §1.4 Q9 (local useState, no provider) — Task 1 / 7.
- §1.4 Q10 (agent label composed at call site, untouched mapToDecisionCard) — Task 5.
- §1.4 Q11 (real `disabled` button when tenant null) — Task 2.
- §2.1 file layout — every file in the table maps to a task (1, 8, 9).
- §3.1–3.5 sketch and data flow — Tasks 1, 3, 5, 6, 7.
- §4.1 drawer chrome — Tasks 3 + 5 (CSS class + width override).
- §4.2 trigger button — Tasks 1 + 2.
- §4.3 polling unchanged — no task needed (we don't add polling; we consume the existing 60s `refetchInterval`).
- §4.4 keyboard / a11y — Task 3 (SheetTitle/Description); Task 7 step 1 covers Escape via the manual smoke and the auto-close-reset test.
- §5.1 required tests 1–11:
  - 1 (header DOM contract) → Task 1
  - 2 (aria-label cases) → Task 2
  - 3 (tenant-null disabled) → Task 2
  - 4 (empty state) → Task 4
  - 5 (loading state) → Task 4
  - 6 (error state) → Task 4
  - 7 (populated list, composed label, accent var) → Task 5
  - 8 (per-item agentKey dispatch) → Task 6
  - 9 (auto-close positive + negative) → Task 7
  - 10 (ref reset) → Task 7
  - 11 (accessible name) → Task 3
- §5.2 inspection-only acceptance — Task 10 steps 2 + 3.
- §6.2 acceptance criteria — Task 10.
- §7 risks — covered by tests in Tasks 1, 2, 7.
- §8 out-of-scope — explicitly not implemented; no tasks.

No gaps. No placeholders in the plan.
