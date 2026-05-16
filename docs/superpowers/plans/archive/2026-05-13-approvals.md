# /approvals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `/approvals` route for the Switchboard dashboard — the single cross-agent queue where operators authorize, reject, or modify mutating actions proposed by agents. Greenfield UI on a stable backend.

**Architecture:** New Mercury Tools surface under `(auth)/(mercury)/approvals/`. Two-pane queue + detail layout on desktop; mobile accordion on ≤768px. Mercury tokens locally aliased (no new globals). Risk-graded confirmation: low/medium → amber CTA only, high/critical → statement + ack checkbox + CTA. Patch behind an "advanced JSON" toggle, deferred for the non-technical operator. Live countdown via a page-local `useNow` 1s tick with visibility-pause. Seven sequenced PRs (A1a → A5, with A2b optional/gated on backend payload confirmation).

**Tech Stack:** Next.js 14 App Router · React 18 · TanStack React Query · next-auth · Vitest + React Testing Library · CSS Modules · Source Serif 4 / Inter / JetBrains Mono (loaded via next/font).

**Spec:** `docs/superpowers/specs/2026-05-13-approvals-design.md`

---

## Conventions used throughout this plan

All component / hook tests share the same scaffolding. Read this once, then each task shows only the test-specific code on top of these conventions.

**Test file preamble:**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
```

**Mock `next-auth/react`** (any test that renders a hook depending on session):

```ts
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { organizationId: "org-1", principalId: "p-1" },
    status: "authenticated",
  }),
}));
```

**Mock `next/navigation`** (any test that touches URL state):

```ts
const mockReplace = vi.fn();
const useSearchParamsMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => useSearchParamsMock(),
}));
function setSearch(qs: string) {
  useSearchParamsMock.mockReturnValue(new URLSearchParams(qs));
}
```

**Wrap with QueryClientProvider** for any test that consumes a React Query hook:

```ts
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
```

**Test commands** (run from repo root):

```bash
pnpm --filter @switchboard/dashboard test <pattern>     # one file
pnpm --filter @switchboard/dashboard test               # all dashboard tests
pnpm --filter @switchboard/dashboard typecheck           # type check
```

**Module file root for this feature** (referred to as `MODULE_ROOT` below):

```
apps/dashboard/src/app/(auth)/(mercury)/approvals/
```

**Commit convention:** Conventional Commits enforced by commitlint. Use `feat(approvals):` / `test(approvals):` / `refactor(approvals):` / `style(approvals):` as appropriate. Include the Co-Authored-By trailer.

**Before every commit:** run `pnpm --filter @switchboard/dashboard typecheck && pnpm --filter @switchboard/dashboard test` and confirm green.

---

## Implementation amendments (REVIEW EDITS — these supersede the body below)

Read these before executing any task. Where an amendment conflicts with the per-task code below, the amendment wins.

### A. Commit cadence — squash per logical group, not per task

The per-task `**Step 5: Commit**` blocks below are **annotations of staging boundaries**, not commit boundaries. **Run `git add` per task, but only run `git commit` at the end of each logical group within a PR.** Each PR should produce ~3–5 commits, not 10+.

Recommended group commits per PR:

- **PR-A1a (Phase 0):**
  1. `chore(approvals): add route gate + Tools nav entry` — covers Tasks 0.1–0.3.
  2. `feat(approvals): types, fixtures, sort, agent-display` — covers Tasks 0.4–0.7.
  3. `feat(approvals): pending hook + queue UI + header` — covers Tasks 0.8–0.10.
  4. `feat(approvals): page orchestrator + route entry` — covers Task 0.11.
- **PR-A1b (Phase 1):**
  1. `feat(approvals): formatRemaining, useNow, refetchOnWindowFocus` — Tasks 1.1–1.2 + use-approvals refetch tweak.
  2. `feat(approvals): live timer in queue rows + critical-pinned sort` — Tasks 1.3–1.4.
  3. `feat(approvals): filter strip wired to page` — Tasks 1.5–1.6.
- **PR-A2 (Phase 2):**
  1. `feat(approvals): shortHash, actionDisplay, useApprovalDetail` — Tasks 2.1–2.3.
  2. `feat(approvals): detail header + confirmation code + empty placeholder` — Tasks 2.4–2.6.
  3. `feat(approvals): wire detail pane + URL ?id sync` — Task 2.7.
- **PR-A3 (Phase 3):**
  1. `feat(approvals): useSessionPrincipal helper + respond mutation` — Task 3.0 (new — see amendment H) + Task 3.1.
  2. `feat(approvals): reject-confirm + approve-block (risk-graded)` — Tasks 3.2–3.3.
  3. `feat(approvals): action drawer + dispatch banner + detail wiring` — Tasks 3.4–3.6.
  4. `test(approvals): copy-language denylist + contrast smoke` — Tasks 3.7–3.8.
- **PR-A4 (Phase 4):** one squashed commit per task is fine here — 3 tasks total.
- **PR-A5 (Phase 5):** one commit per task is fine — 4 tasks.
- **PR-A2b (Phase 6):** Task 6.0 is its own commit (backend payload check yields a schema/route change); Tasks 6.1 is the UI commit.

Operationally: when a task's Step 5 says "Commit", **stage only** (`git add ...`). When the group's final task completes, run a single `git commit` with the group message above. The task-level commit messages in the body are descriptive (tells you what landed) — the actual commit subject is the group message.

### B. `setActiveId` must NOT be called during render

The body of this plan shows a render-time `setActiveId` in Task 0.11. **Do not ship that pattern.** Always do it inside `useEffect`:

```tsx
useEffect(() => {
  if (items.length === 0) {
    if (activeId !== null) setActiveId(null);
    return;
  }
  if (!activeId || !items.some((r) => r.id === activeId)) {
    setActiveId(items[0].id);
  }
}, [activeId, items]);
```

This is the only correct shape — it auto-seeds the first row, recovers when the active row falls out of the filtered set, and clears selection when the list is empty. Use it everywhere the plan does selection seeding (Task 0.11, Task 1.6, Task 2.7). The body of Task 0.11 is patched below; the others are textually correct but verify on read.

### C. Data-shape boundary — `PendingApproval` (queue) vs `ApprovalDetail` (right pane)

The wire shape from `GET /api/approvals/pending` does **not** include `request.parametersSnapshot`, `approvers`, `approvalsRequired`, `approvalHashes`, `recovery`, or `patchProposal`. Those come from `GET /api/approvals/:id`. The fixture file is rich for fidelity, but the live page must respect the boundary.

**Concrete rules:**

1. The queue consumes the `PendingApproval` shape only (`@/lib/api-client-types` line 29). The queue component (`queue.tsx`) must not read any field outside that shape.
2. The detail components consume the `ApprovalDetail`-derived shape (with optional extensions for the fixture-only fields).
3. In `usePendingApprovals`, the fixture-mode response must be **projected** to the pending shape, not returned in its enriched form:

```ts
// hooks/use-approvals.ts — fixture mode for usePendingApprovals
const FIXTURE_RESPONSE = {
  approvals: APPROVALS_FIXTURES.map((row) => ({
    id: row.id,
    summary: row.summary,
    riskCategory: row.riskCategory,
    status: row.status,
    envelopeId: row.envelopeId,
    expiresAt: row.expiresAt,
    bindingHash: row.bindingHash,
    createdAt: row.createdAt,
  })),
};
```

4. In `useApprovalDetail`, fixture mode returns the **full** `ApprovalRow` from the fixtures file (the rich one).
5. Types split: rename `types.ts` to expose two:

```ts
// MODULE_ROOT/types.ts
import type { PendingApproval } from "@/lib/api-client-types";
export type PendingRow = PendingApproval;          // queue / list — wire-truthful

// Detail row — extends with optional fields seen only on the detail call or in fixtures.
export interface DetailRow extends PendingApproval {
  agent?: string;
  requestedBy?: string;
  request?: {
    action?: string;
    parametersSnapshot?: Record<string, unknown>;
    approvers?: string[];
    approvalsRequired?: number;
  };
  state?: {
    approvalHashes?: string[];
    respondedBy?: string | null;
    respondedAt?: string | null;
  };
  recovery?: { reason?: string; proposedFix?: string; lastAttemptAt?: string };
  patchProposal?: { proposedBy?: string; proposedAt?: string; diff?: Record<string, unknown> };
}

export type RiskCategory = PendingApproval["riskCategory"];
export type LifecycleStatus = PendingApproval["status"];
```

6. `ApprovalsQueue` props use `readonly PendingRow[]`. The detail components use `DetailRow`.

The body of this plan uses a single `ApprovalRow` everywhere — read it as "use `PendingRow` in queue contexts and `DetailRow` in detail contexts". Patch each task accordingly when implementing.

### D. Header eyebrow copy

The body shows `Mercury Tools · /approvals`. Replace with the operator-language variant: **`Approvals queue`** (or `Mercury Tools · Approvals` if matching the existing /reports/activity convention is more important to you — pick one and stick to it). **Never the raw route path.**

### E. Header sub copy

The body's header sub-line says `…carries a confirmation code that locks in the details — sign only if they match what you want.` Replace with:

> Every agent-proposed action waits here until you say yes. Each card carries a confirmation code that locks in the details — **approve only when the details match what you want.**

Bolded for emphasis; otherwise inline.

### F. Queue row accessible labels

Replace the unscoped `expect(screen.getAllByRole("button"))` checks with role-and-name queries. The queue row gets an explicit `aria-label`:

```tsx
<button
  type="button"
  id={`row-${req.id}`}
  aria-label={`Open approval: ${req.summary}`}
  ...
>
```

Tests then use:

```tsx
expect(screen.getAllByRole("button", { name: /^Open approval:/ })).toHaveLength(APPROVALS_FIXTURES.length);
```

Apply across Task 0.10 (queue.tsx + test) and any later test that counts queue rows by role.

### G. Denylist must scan visible text only

The `visibleText()` helper in Task 3.7 is canonical. Promote it to a shared test utility and have every per-component "no engineering vocabulary" assertion use it:

```ts
// MODULE_ROOT/__tests__/visible-text.ts
export function visibleText(): string {
  const clone = document.body.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll('[aria-hidden="true"], script, style, [data-testid="confirmation-code-value"]')
    .forEach((el) => el.remove());
  return clone.textContent ?? "";
}
```

Replace `document.body.textContent ?? ""` in `header.test.tsx`, `queue.test.tsx`, and `dispatch-banner.test.tsx` with `visibleText()`. Add an explicit import:

```ts
import { visibleText } from "./visible-text";
```

### H. Single `useSessionPrincipal` helper — no scattered casts

Add a new Task 3.0 before Task 3.1:

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/approvals/hooks/use-session-principal.ts`
- Test: `apps/dashboard/src/app/(auth)/(mercury)/approvals/__tests__/use-session-principal.test.tsx`

Implementation:

```ts
// MODULE_ROOT/hooks/use-session-principal.ts
"use client";

import { useSession } from "next-auth/react";

interface PrincipalSession {
  principalId?: string;
  organizationId?: string;
}

/**
 * Returns the authenticated principal id from the next-auth session, or null
 * when no session is present. Encapsulates the `as unknown as` cast that the
 * dashboard's session typing currently requires, so it lives in one place
 * instead of being scattered across components.
 */
export function useSessionPrincipal(): string | null {
  const { data } = useSession();
  return (data as unknown as PrincipalSession | null)?.principalId ?? null;
}
```

Test it once, then in **every later task** (3.1 mutation, 3.5 action drawer, detail/index.tsx) replace ad-hoc `useSession` + cast blocks with `const principalId = useSessionPrincipal();`. The body of Tasks 3.1, 3.5, and 3.6 below shows the cast inline — read those occurrences as "use the helper from Task 3.0 instead".

### I. Acceptance criterion #20 (decisions invalidation) — make it a hard test

In `use-respond.test.tsx` (Task 3.1), add a test that mocks `queryClient.invalidateQueries` and asserts both `keys.approvals.all()` and `keys.decisions.all()` were invalidated on success. Don't rely on inspection. Example:

```ts
import { useQueryClient } from "@tanstack/react-query";
// in a separate test:
it("invalidates approvals AND decisions caches on success", async () => {
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  const invalidate = vi.fn();
  // ... render with a QueryClient whose invalidateQueries is spied
  // ... call mutate, await success
  expect(invalidate).toHaveBeenCalledWith({ queryKey: expect.arrayContaining(["approvals"]) });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: expect.arrayContaining(["decisions"]) });
});
```

Implementation detail: wrap a real `QueryClient`, spy `invalidateQueries` via `vi.spyOn(qc, "invalidateQueries")`, then assert.

### J. Dispatch banner: test each shape explicitly

In `dispatch-banner.test.tsx` (Task 3.4), assert these four explicitly:

1. Single approver → `**Approved.**` (no "Signed").
2. Quorum incomplete → `**Signed.** Waiting on N more teammate(s).` (no "Approved.").
3. Rejected → `**Rejected.** The card is closed; the agent has been told to stand down.`
4. Patched → `**Approved with changes.**`

The component branches are already correct; the tests must lock them in.

### K. Live countdown refetch on visibility return

The body's `useNow` hook pauses on `visibilitychange` and resets `now` on resume — good. Additionally, when `document.hidden` flips back to false, the page must refetch `/pending` so `expiresAt` values are fresh, not just the local clock.

Wire this in `approvals-page.tsx` by adding a sibling `useEffect`:

```tsx
import { useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
// ...
const queryClient = useQueryClient();
const keys = useScopedQueryKeys();
useEffect(() => {
  if (typeof document === "undefined") return;
  const handler = () => {
    if (!document.hidden && keys) {
      queryClient.invalidateQueries({ queryKey: keys.approvals.pending() });
    }
  };
  document.addEventListener("visibilitychange", handler);
  return () => document.removeEventListener("visibilitychange", handler);
}, [queryClient, keys]);
```

Add this in Task 1.6 (alongside the filter wiring) since that's where the page's live behavior crystallizes.

---

**Outcome:** A `/approvals` route appears in the Tools ▾ overflow when `NEXT_PUBLIC_APPROVALS_LIVE=true`. The page renders a header, a queue of 12 fixture rows sorted expiring-soonest, skeleton + empty states. No detail pane, no live countdown, no filter strip, no actions.

### Task 0.1: Extend `route-availability.ts` with `"approvals"`

**Files:**
- Modify: `apps/dashboard/src/lib/route-availability.ts`
- Test: `apps/dashboard/src/lib/__tests__/route-availability.test.ts` (create if missing)

- [ ] **Step 1: Write the failing test**

Create the test file (or extend existing):

```ts
// apps/dashboard/src/lib/__tests__/route-availability.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isMercuryToolLive } from "../route-availability";

describe("isMercuryToolLive", () => {
  const ORIGINAL = { ...process.env };
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_APPROVALS_LIVE;
  });
  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it("returns false when NEXT_PUBLIC_APPROVALS_LIVE is unset", () => {
    expect(isMercuryToolLive("approvals")).toBe(false);
  });

  it("returns true when NEXT_PUBLIC_APPROVALS_LIVE is 'true'", () => {
    process.env.NEXT_PUBLIC_APPROVALS_LIVE = "true";
    expect(isMercuryToolLive("approvals")).toBe(true);
  });

  it("returns false for any other value", () => {
    process.env.NEXT_PUBLIC_APPROVALS_LIVE = "1";
    expect(isMercuryToolLive("approvals")).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm --filter @switchboard/dashboard test route-availability
```
Expected: TypeScript error — `"approvals"` not assignable to `ToolsNavId`.

- [ ] **Step 3: Extend the union and env map**

Edit `apps/dashboard/src/lib/route-availability.ts`:

```ts
export type ToolsNavId = "contacts" | "automations" | "activity" | "reports" | "approvals";

const TOOLS_LIVE_ENV = {
  contacts: "NEXT_PUBLIC_CONTACTS_LIVE",
  automations: "NEXT_PUBLIC_AUTOMATIONS_LIVE",
  activity: "NEXT_PUBLIC_ACTIVITY_LIVE",
  reports: "NEXT_PUBLIC_REPORTS_LIVE",
  approvals: "NEXT_PUBLIC_APPROVALS_LIVE",
} as const satisfies Record<ToolsNavId, string>;
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm --filter @switchboard/dashboard test route-availability
pnpm --filter @switchboard/dashboard typecheck
```
Expected: 3 passing tests, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/lib/route-availability.ts apps/dashboard/src/lib/__tests__/route-availability.test.ts
git commit -m "feat(approvals): extend route-availability with approvals tool gate

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 0.2: Add `Approvals` to Tools ▾ overflow

**Files:**
- Modify: `apps/dashboard/src/components/layout/tools-overflow.tsx`
- Test: `apps/dashboard/src/components/layout/__tests__/tools-overflow.test.tsx` (extend if exists, create if not)

- [ ] **Step 1: Write the failing test**

```ts
// apps/dashboard/src/components/layout/__tests__/tools-overflow.test.tsx
import { describe, it, expect } from "vitest";
import { TOOLS_NAV_ITEMS } from "../tools-overflow";

describe("TOOLS_NAV_ITEMS", () => {
  it("includes an Approvals entry", () => {
    const approvals = TOOLS_NAV_ITEMS.find((i) => i.id === "approvals");
    expect(approvals).toEqual({
      id: "approvals",
      label: "Approvals",
      href: "/approvals",
    });
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm --filter @switchboard/dashboard test tools-overflow
```
Expected: `approvals` not found in `TOOLS_NAV_ITEMS`.

- [ ] **Step 3: Append the entry**

Edit `apps/dashboard/src/components/layout/tools-overflow.tsx`:

```ts
export const TOOLS_NAV_ITEMS: ReadonlyArray<{
  readonly id: ToolsNavId;
  readonly label: string;
  readonly href: string;
}> = [
  { id: "contacts", label: "Contacts", href: "/contacts" },
  { id: "automations", label: "Automations", href: "/automations" },
  { id: "activity", label: "Activity", href: "/activity" },
  { id: "reports", label: "Reports", href: "/reports" },
  { id: "approvals", label: "Approvals", href: "/approvals" },
];
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm --filter @switchboard/dashboard test tools-overflow
```

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/layout/tools-overflow.tsx apps/dashboard/src/components/layout/__tests__/tools-overflow.test.tsx
git commit -m "feat(approvals): add Approvals entry to Tools overflow menu

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 0.3: Add `NEXT_PUBLIC_APPROVALS_LIVE` to `.env.example`

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Locate the existing `NEXT_PUBLIC_*_LIVE` block**

```bash
grep -n "NEXT_PUBLIC_.*_LIVE" .env.example
```

Expected: lines for `CONTACTS`, `AUTOMATIONS`, `ACTIVITY`, `REPORTS`.

- [ ] **Step 2: Insert the approvals entry**

Add directly under the existing `NEXT_PUBLIC_REPORTS_LIVE=false` line:

```
NEXT_PUBLIC_APPROVALS_LIVE=false
```

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "chore(approvals): add NEXT_PUBLIC_APPROVALS_LIVE to .env.example

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 0.4: Define page-local types

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/approvals/types.ts`

- [ ] **Step 1: Create the types file**

```ts
// MODULE_ROOT/types.ts
import type { PendingApproval } from "@/lib/api-client-types";

/**
 * The wire shape from GET /api/approvals/pending. Used by the QUEUE only.
 * Do not read fields outside this shape in queue contexts (amendment C).
 */
export type PendingRow = PendingApproval;

/**
 * The wire shape from GET /api/approvals/:id, plus optional extensions for
 * fields seen in fixtures or the future quorum/recovery payload (gated in
 * PR-A2b). All extensions are `?:` so live data stays valid even if the
 * backend hasn't started returning them yet.
 *
 * Used by the DETAIL pane only.
 */
export interface DetailRow extends PendingApproval {
  agent?: string;
  requestedBy?: string;
  request?: {
    action?: string;
    parametersSnapshot?: Record<string, unknown>;
    approvers?: string[];
    approvalsRequired?: number;
  };
  state?: {
    approvalHashes?: string[];
    respondedBy?: string | null;
    respondedAt?: string | null;
  };
  recovery?: { reason?: string; proposedFix?: string; lastAttemptAt?: string };
  patchProposal?: { proposedBy?: string; proposedAt?: string; diff?: Record<string, unknown> };
}

/**
 * Convenience alias for code paths that legitimately work with both shapes
 * (e.g. a sort that only reads PendingRow fields). Prefer the specific
 * type at the consumer.
 */
export type ApprovalRow = PendingRow;

export type RiskCategory = PendingApproval["riskCategory"];
export type LifecycleStatus = PendingApproval["status"];
```

> **Amendment C reminder:** later tasks refer to `ApprovalRow` as a single type. Treat that name as `PendingRow` in queue contexts and `DetailRow` in detail contexts. `DetailRow` extends `PendingRow`, so anywhere the body uses `ApprovalRow` for detail components, swap to `DetailRow` to unlock the optional fields cleanly.

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @switchboard/dashboard typecheck
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/types.ts
git commit -m "feat(approvals): define page-local ApprovalRow type

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 0.5: Build `use-agent-display` hook

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/approvals/hooks/use-agent-display.ts`
- Test: `apps/dashboard/src/app/(auth)/(mercury)/approvals/__tests__/use-agent-display.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// MODULE_ROOT/__tests__/use-agent-display.test.ts
import { describe, it, expect } from "vitest";
import { agentDisplay } from "../hooks/use-agent-display";

describe("agentDisplay", () => {
  it("maps billing-agent to Alex / Billing & Bookings", () => {
    expect(agentDisplay("billing-agent")).toEqual({
      name: "Alex",
      role: "Billing & Bookings",
    });
  });

  it("maps growth-agent to Riley / Growth", () => {
    expect(agentDisplay("growth-agent")).toEqual({ name: "Riley", role: "Growth" });
  });

  it("maps support-agent to Mira / Care", () => {
    expect(agentDisplay("support-agent")).toEqual({ name: "Mira", role: "Care" });
  });

  it("returns generic fallback for unknown ids", () => {
    expect(agentDisplay("unknown-agent")).toEqual({ name: "an agent", role: null });
  });

  it("returns generic fallback for empty / undefined input", () => {
    expect(agentDisplay(undefined)).toEqual({ name: "an agent", role: null });
    expect(agentDisplay("")).toEqual({ name: "an agent", role: null });
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm --filter @switchboard/dashboard test use-agent-display
```
Expected: cannot find module.

- [ ] **Step 3: Implement**

```ts
// MODULE_ROOT/hooks/use-agent-display.ts
export interface AgentDisplay {
  name: string;
  role: string | null;
}

const MAP: Record<string, AgentDisplay> = {
  "billing-agent": { name: "Alex", role: "Billing & Bookings" },
  "bookings-agent": { name: "Alex", role: "Billing & Bookings" },
  "growth-agent": { name: "Riley", role: "Growth" },
  "ad-optimizer": { name: "Riley", role: "Growth" },
  "support-agent": { name: "Mira", role: "Care" },
  "compliance-agent": { name: "Mira", role: "Care" },
  "ops-agent": { name: "Mira", role: "Care" },
  "data-agent": { name: "Mira", role: "Care" },
};

/**
 * Maps an internal agent id to the customer-facing display.
 * Unknown ids return a generic fallback — never the raw id.
 */
export function agentDisplay(agentId: string | undefined | null): AgentDisplay {
  if (!agentId) return { name: "an agent", role: null };
  return MAP[agentId] ?? { name: "an agent", role: null };
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm --filter @switchboard/dashboard test use-agent-display
```
Expected: 5 passing tests.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/hooks/use-agent-display.ts apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/__tests__/use-agent-display.test.ts
git commit -m "feat(approvals): agentDisplay maps internal ids to Alex/Riley/Mira

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 0.6: Build pure `sort` function (expiring-soonest)

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/approvals/sort.ts`
- Test: `apps/dashboard/src/app/(auth)/(mercury)/approvals/__tests__/sort.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// MODULE_ROOT/__tests__/sort.test.ts
import { describe, it, expect } from "vitest";
import { sortApprovals } from "../sort";
import type { ApprovalRow } from "../types";

function row(id: string, expiresAt: string, riskCategory: ApprovalRow["riskCategory"], createdAt = "2026-05-13T00:00:00Z"): ApprovalRow {
  return {
    id,
    summary: `Row ${id}`,
    riskCategory,
    status: "pending",
    envelopeId: `env_${id}`,
    expiresAt,
    bindingHash: `0x${id}`,
    createdAt,
  };
}

describe("sortApprovals (expiring-soonest)", () => {
  it("returns expiring-soonest first", () => {
    const a = row("a", "2026-05-13T01:00:00Z", "low");
    const b = row("b", "2026-05-13T00:30:00Z", "low");
    const c = row("c", "2026-05-13T02:00:00Z", "low");
    const sorted = sortApprovals([a, b, c]);
    expect(sorted.map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("ties on expiresAt break by createdAt ascending", () => {
    const a = row("a", "2026-05-13T01:00:00Z", "low", "2026-05-13T00:05:00Z");
    const b = row("b", "2026-05-13T01:00:00Z", "low", "2026-05-13T00:01:00Z");
    const sorted = sortApprovals([a, b]);
    expect(sorted.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("does not mutate input", () => {
    const input = [row("a", "2026-05-13T01:00:00Z", "low"), row("b", "2026-05-13T00:30:00Z", "low")];
    const before = input.map((r) => r.id);
    sortApprovals(input);
    expect(input.map((r) => r.id)).toEqual(before);
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm --filter @switchboard/dashboard test approvals/sort
```
Expected: cannot find module.

- [ ] **Step 3: Implement**

```ts
// MODULE_ROOT/sort.ts
import type { ApprovalRow } from "./types";

/**
 * Sort by expiresAt ascending, with createdAt as tiebreak.
 *
 * Critical-pinned variant is added in Phase 1 once live countdown lands.
 * Pure function; does not mutate input.
 */
export function sortApprovals(rows: readonly ApprovalRow[]): ApprovalRow[] {
  return [...rows].sort((a, b) => {
    const ta = new Date(a.expiresAt).getTime();
    const tb = new Date(b.expiresAt).getTime();
    if (ta !== tb) return ta - tb;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm --filter @switchboard/dashboard test approvals/sort
```
Expected: 3 passing tests.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/sort.ts apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/__tests__/sort.test.ts
git commit -m "feat(approvals): pure expiring-soonest sort with createdAt tiebreak

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 0.7: Port locked fixtures to TS

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/approvals/fixtures.ts`

- [ ] **Step 1: Open the locked fixtures**

`docs/design-prompts/locked/switchboard/project/approvals-v2/data.js` is the source.

- [ ] **Step 2: Port to typed TS**

```ts
// MODULE_ROOT/fixtures.ts
import type { ApprovalRow } from "./types";

const NOW = Date.now();
const MIN = 60_000;
const HR = 60 * MIN;
const iso = (offset: number) => new Date(NOW + offset).toISOString();
const h = (s: string) => "0x" + s;

export const APPROVALS_FIXTURES: ApprovalRow[] = [
  {
    id: "apr_2f1a08",
    summary: "Refund SGD 4,820 to client #SG-44120 for adverse reaction during HydraFacial session",
    riskCategory: "critical",
    status: "pending",
    envelopeId: "env_2f1a08c4",
    expiresAt: iso(4 * MIN + 12_000),
    bindingHash: h("2f1a08c4e9b1d7a4f0c3b8a5d2e7f1a9"),
    createdAt: iso(-41 * MIN),
    agent: "billing-agent",
    requestedBy: "Billing",
    request: {
      action: "billing.refund.issue",
      parametersSnapshot: {
        accountId: "SG-44120",
        amount: 4820,
        currency: "SGD",
        reason: "adverse_reaction_treatment",
        rail: "stripe.refund",
        memo: "HydraFacial 2026-05-08 — adverse reaction, full refund per care policy",
      },
      approvers: ["p-1", "kira.l"],
      approvalsRequired: 2,
    },
    state: { approvalHashes: [], respondedBy: null, respondedAt: null },
  },
  {
    id: "apr_9b73c1",
    summary: "Send promo SMS (15% off May) to 4,208 lapsed clients — PDPA-opted-in, SG locale",
    riskCategory: "high",
    status: "pending",
    envelopeId: "env_9b73c1aa",
    expiresAt: iso(38 * MIN),
    bindingHash: h("9b73c1aa4f1d6c92e2a5b8d1f4c7e0a3"),
    createdAt: iso(-22 * MIN),
    agent: "growth-agent",
    requestedBy: "Growth",
    request: {
      action: "comms.sms.broadcast",
      parametersSnapshot: {
        channel: "sms.twilio",
        segment: "lapsed_90d_sg_pdpa_optin",
        recipients: 4208,
        copy: "Hi {first_name}, we miss you at Aurora. 15% off any treatment this May with MAY15. Reply STOP to opt out.",
        sendWindow: "Today 14:00–17:00 SGT",
        promoCode: "MAY15",
        estimatedCost: "SGD 252.48",
      },
      approvers: ["p-1", "kira.l", "marcus.t"],
      approvalsRequired: 3,
    },
    state: { approvalHashes: ["0xK1RA", "0xMARC"], respondedBy: null, respondedAt: null },
  },
  {
    id: "apr_d77c20",
    summary: "Apply 25% loyalty discount on Botox renewal · order #SG-44109",
    riskCategory: "medium",
    status: "pending",
    envelopeId: "env_d77c20b7",
    expiresAt: iso(42 * MIN),
    bindingHash: h("d77c20b73f6b9c2e5d8a1f4c7b0e3a6d"),
    createdAt: iso(-18 * MIN),
    agent: "support-agent",
    requestedBy: "Care",
    request: {
      action: "billing.discount.apply",
      parametersSnapshot: {
        orderId: "SG-44109",
        clientId: "SG-19224",
        clientTier: "platinum",
        treatment: "Botox renewal · forehead + glabella",
        basePriceSGD: 1280,
        discountPct: 10,
        memo: "Initial 10% per loyalty policy",
      },
      approvers: ["p-1"],
      approvalsRequired: 1,
    },
    patchProposal: {
      proposedBy: "p-1",
      proposedAt: iso(-2 * MIN),
      diff: { discountPct: 25, memo: "Customer churn-risk; tier exception applies. Bumping to 25% to retain." },
    },
    state: { approvalHashes: [], respondedBy: null, respondedAt: null },
  },
  {
    id: "apr_4e082a",
    summary: "Rotate prod read-replica credentials · aurora-bookings-db",
    riskCategory: "high",
    status: "pending",
    envelopeId: "env_4e082afc",
    expiresAt: iso(51 * MIN),
    bindingHash: h("4e082afc18d2c5e8b1a4f7d0c3e6b9d2"),
    createdAt: iso(-9 * MIN),
    agent: "ops-agent",
    requestedBy: "Ops",
    request: {
      action: "infra.db.rotate-credentials",
      parametersSnapshot: {
        host: "aurora-bookings-db.replica.sg",
        engine: "postgres 15",
        rotation: "read-replica only",
        downtimeEstimate: "0s",
        rollbackPlan: "stored-snapshot 12h",
      },
      approvers: ["p-1", "kira.l"],
      approvalsRequired: 2,
    },
    state: { approvalHashes: ["0xK1RA"], respondedBy: null, respondedAt: null },
  },
  {
    id: "apr_55ab10",
    summary: "Charge no-show fee SGD 80 to client #SG-9221 (CoolSculpting 2026-05-12)",
    riskCategory: "low",
    status: "pending",
    envelopeId: "env_55ab10d2",
    expiresAt: iso(2 * HR),
    bindingHash: h("55ab10d2e7f4a1c8b5e2a9d6c3f0b7e4"),
    createdAt: iso(-4 * MIN),
    agent: "billing-agent",
    requestedBy: "Billing",
    request: {
      action: "billing.fee.apply",
      parametersSnapshot: {
        clientId: "SG-9221",
        appointmentId: "appt_88412",
        amount: 80,
        currency: "SGD",
        reason: "no_show_under_24h",
        policy: "cancellation.v3",
      },
      approvers: ["p-1"],
      approvalsRequired: 1,
    },
    state: { approvalHashes: [], respondedBy: null, respondedAt: null },
  },
  {
    id: "apr_a44f02",
    summary: "Update IPL Hair Removal package prices · +12% across 6 tiers",
    riskCategory: "medium",
    status: "pending",
    envelopeId: "env_a44f02b5",
    expiresAt: iso(5 * HR + 22 * MIN),
    bindingHash: h("a44f02b5d8e1c4f7a0c3e6b9d2f5a8c1"),
    createdAt: iso(-12 * MIN),
    agent: "ad-optimizer",
    requestedBy: "Growth",
    request: {
      action: "catalog.price.update",
      parametersSnapshot: {
        catalog: "ipl_hair_removal_2026",
        tiersAffected: 6,
        adjustmentPct: 12,
        effectiveAt: "2026-05-15T00:00:00+08:00",
        rationale: "Q2 cost-pass-through; matches reference set in S2 review",
      },
      approvers: ["p-1"],
      approvalsRequired: 1,
    },
    state: { approvalHashes: [], respondedBy: null, respondedAt: null },
  },
  {
    id: "apr_19fe44",
    summary: "Reschedule 14 appointments after laser tech sick-leave (Wed 14 May)",
    riskCategory: "low",
    status: "pending",
    envelopeId: "env_19fe44a7",
    expiresAt: iso(6 * HR),
    bindingHash: h("19fe44a7c2e5b8d1f4c7e0a3b6d9c2f5"),
    createdAt: iso(-88 * MIN),
    agent: "bookings-agent",
    requestedBy: "Bookings",
    request: {
      action: "calendar.reschedule.bulk",
      parametersSnapshot: {
        count: 14,
        fromDate: "2026-05-14",
        windowSearch: "next_4_business_days",
        notify: "sms+email",
        notifyTemplate: "tech_unavailable_v2",
      },
      approvers: ["p-1"],
      approvalsRequired: 1,
    },
    state: { approvalHashes: [], respondedBy: null, respondedAt: null },
  },
  {
    id: "apr_c81b33",
    summary: "Purge 4,210 inactive guest sessions older than 30d (PDPA retention)",
    riskCategory: "high",
    status: "pending",
    envelopeId: "env_c81b33f6",
    expiresAt: iso(90 * MIN),
    bindingHash: h("c81b33f6a9d2c5e8b1a4f7d0c3e6b9d2"),
    createdAt: iso(-33 * MIN),
    agent: "data-agent",
    requestedBy: "Ops",
    request: {
      action: "data.session.purge",
      parametersSnapshot: {
        rows: 4210,
        table: "session_guest_v2",
        oldestRow: "2026-03-30",
        backupAvailable: false,
        reversible: false,
      },
      approvers: ["p-1"],
      approvalsRequired: 1,
    },
    state: { approvalHashes: [], respondedBy: null, respondedAt: null },
  },
  {
    id: "apr_2e9bd1",
    summary: "Issue SGD 500 service voucher · client #SG-77104 (post-treatment complaint)",
    riskCategory: "medium",
    status: "pending",
    envelopeId: "env_2e9bd14c",
    expiresAt: iso(18 * HR),
    bindingHash: h("2e9bd14c7a0d3f6b9e2c5a8d1f4c7e0a"),
    createdAt: iso(-4 * HR),
    agent: "support-agent",
    requestedBy: "Care",
    request: {
      action: "billing.voucher.issue",
      parametersSnapshot: {
        clientId: "SG-77104",
        amount: 500,
        currency: "SGD",
        expiresDays: 180,
        memo: "Goodwill voucher per Care escalation #ESC-3318",
      },
      approvers: ["p-1"],
      approvalsRequired: 1,
    },
    state: { approvalHashes: [], respondedBy: null, respondedAt: null },
  },
  {
    id: "apr_f01a99",
    summary: "Scale daily ad budget · Cleaning treatments · +20%",
    riskCategory: "low",
    status: "pending",
    envelopeId: "env_f01a99e2",
    expiresAt: iso(3 * HR),
    bindingHash: h("f01a99e2b5c8d1f4a7c0e3b6d9c2f5a8"),
    createdAt: iso(-2 * HR),
    agent: "ad-optimizer",
    requestedBy: "Growth",
    request: {
      action: "ads.budget.scale",
      parametersSnapshot: {
        adset: "Cleaning · retarget · 30d",
        currentBudget: "SGD 200/day",
        proposedBudget: "SGD 240/day",
        guardrail: "+25% max",
        roas7d: 4.1,
      },
      approvers: ["p-1"],
      approvalsRequired: 1,
    },
    state: { approvalHashes: [], respondedBy: null, respondedAt: null },
  },
  {
    id: "apr_b21d7f",
    summary: "Push updated PDPA consent form (v4) to all booking flows",
    riskCategory: "high",
    status: "pending",
    envelopeId: "env_b21d7f4e",
    expiresAt: iso(90 * MIN),
    bindingHash: h("b21d7f4e8c1a5f2d7b3e6a9c2f5d8e1b"),
    createdAt: iso(-26 * MIN),
    agent: "compliance-agent",
    requestedBy: "Ops",
    request: {
      action: "cms.consent.publish",
      parametersSnapshot: {
        documentId: "pdpa_consent_v4",
        replaces: "pdpa_consent_v3",
        effectiveAt: "immediate",
        surfaces: ["web", "ios", "android", "kiosk"],
        legalReviewer: "S. Lim (Counsel)",
      },
      approvers: ["p-1", "kira.l"],
      approvalsRequired: 2,
    },
    state: { approvalHashes: [], respondedBy: null, respondedAt: null },
  },
  {
    id: "apr_e0c4a5",
    summary: "Run GDPR/PDPA data export · subject sarah.k@example.com",
    riskCategory: "medium",
    status: "recovery_required",
    envelopeId: "env_e0c4a5d1",
    expiresAt: iso(18 * HR),
    bindingHash: h("e0c4a5d1b8e3a6c9f2d5b8e1a4d7c0e3"),
    createdAt: iso(-6 * HR),
    agent: "compliance-agent",
    requestedBy: "Ops",
    request: {
      action: "compliance.gdpr.export",
      parametersSnapshot: {
        subject: "sarah.k@example.com",
        deliverBy: "2026-05-18",
        format: "json+csv bundle",
        scope: ["orders", "sessions", "support_threads", "treatment_notes"],
      },
      approvers: ["p-1"],
      approvalsRequired: 1,
    },
    recovery: {
      reason: "Upstream cartridge `compliance-export@1.4.2` returned 502 during dry-run binding capture.",
      proposedFix: "Re-run the binding capture; lifecycle will be re-instantiated with a fresh parametersSnapshot.",
      lastAttemptAt: iso(-11 * MIN),
    },
    state: { approvalHashes: [], respondedBy: null, respondedAt: null },
  },
];
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @switchboard/dashboard typecheck
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/fixtures.ts
git commit -m "feat(approvals): port locked Aurora medspa fixtures to typed TS

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 0.8: Build `usePendingApprovals` hook (list-only)

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/approvals/hooks/use-approvals.ts`
- Test: `apps/dashboard/src/app/(auth)/(mercury)/approvals/__tests__/use-approvals.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
// MODULE_ROOT/__tests__/use-approvals.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode } from "react";

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { organizationId: "org-1", principalId: "p-1" },
    status: "authenticated",
  }),
}));

vi.mock("@/lib/route-availability", () => ({
  isMercuryToolLive: () => false,
}));

import { usePendingApprovals } from "../hooks/use-approvals";
import { APPROVALS_FIXTURES } from "../fixtures";

function wrap({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("usePendingApprovals (fixture mode)", () => {
  it("returns the fixture rows when flag is off", async () => {
    const { result } = renderHook(() => usePendingApprovals(), { wrapper: wrap });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.approvals).toEqual(APPROVALS_FIXTURES);
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm --filter @switchboard/dashboard test approvals/use-approvals
```
Expected: cannot find module.

- [ ] **Step 3: Implement**

```ts
// MODULE_ROOT/hooks/use-approvals.ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import { isMercuryToolLive } from "@/lib/route-availability";
import { APPROVALS_FIXTURES } from "../fixtures";
import type { PendingRow } from "../types";

const isLive = (): boolean => isMercuryToolLive("approvals");

interface PendingResponse {
  approvals: PendingRow[];
}

/**
 * Project the rich fixture rows down to the wire-truthful PendingApproval shape.
 * The detail call (useApprovalDetail) is the only place rich fields appear.
 * Mirroring this boundary in fixture mode prevents "looks great in dev, breaks
 * in prod when /pending returns less than the UI assumed" (amendment C).
 */
const FIXTURE_RESPONSE: PendingResponse = {
  approvals: APPROVALS_FIXTURES.map((row) => ({
    id: row.id,
    summary: row.summary,
    riskCategory: row.riskCategory,
    status: row.status,
    envelopeId: row.envelopeId,
    expiresAt: row.expiresAt,
    bindingHash: row.bindingHash,
    createdAt: row.createdAt,
  })),
};

export function usePendingApprovals() {
  const keys = useScopedQueryKeys();
  const live = isLive();

  return useQuery<PendingResponse>({
    queryKey: keys?.approvals.pending() ?? (["__disabled_approvals_pending__"] as const),
    queryFn: async () => {
      if (!live) return FIXTURE_RESPONSE;
      const res = await fetch("/api/dashboard/approvals");
      if (!res.ok) throw new Error(`Failed to load approvals: ${res.status}`);
      return res.json() as Promise<PendingResponse>;
    },
    enabled: !live || !!keys,
    staleTime: live ? 30_000 : Infinity,
    refetchOnWindowFocus: live,
    // NO refetchInterval — live countdown is client-side; refetch is event-driven.
  });
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm --filter @switchboard/dashboard test approvals/use-approvals
```

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/hooks/use-approvals.ts apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/__tests__/use-approvals.test.tsx
git commit -m "feat(approvals): usePendingApprovals hook (list-only, fixture-backed)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 0.9: Build header component

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/approvals/components/header.tsx`
- Test: `apps/dashboard/src/app/(auth)/(mercury)/approvals/__tests__/header.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// MODULE_ROOT/__tests__/header.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ApprovalsHeader } from "../components/header";

describe("ApprovalsHeader", () => {
  it("shows the page title", () => {
    render(<ApprovalsHeader pendingCount={12} expiringSoonCount={1} />);
    expect(screen.getByRole("heading", { level: 1, name: /approvals/i })).toBeInTheDocument();
  });

  it("shows the pending count tile", () => {
    render(<ApprovalsHeader pendingCount={12} expiringSoonCount={1} />);
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("shows the expiring-soon count tile", () => {
    render(<ApprovalsHeader pendingCount={12} expiringSoonCount={3} />);
    expect(screen.getByText(/< 1h to expiry/i)).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("contains no engineering vocabulary", () => {
    render(<ApprovalsHeader pendingCount={12} expiringSoonCount={3} />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/binding|envelope|lifecycle|dispatch/i);
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm --filter @switchboard/dashboard test approvals/header
```

- [ ] **Step 3: Implement**

```tsx
// MODULE_ROOT/components/header.tsx
"use client";

import styles from "../approvals.module.css";

export interface ApprovalsHeaderProps {
  pendingCount: number;
  expiringSoonCount: number;
}

export function ApprovalsHeader({ pendingCount, expiringSoonCount }: ApprovalsHeaderProps) {
  return (
    <header className={styles.pageHead}>
      <div className={styles.lead}>
        <span className={styles.eyebrow}>Approvals queue</span>
        <h1 className={styles.pageTitle}>Approvals</h1>
        <p className={styles.pageSub}>
          Every agent-proposed action waits here until you say yes. Each card carries a confirmation
          code that locks in the details — approve only when the details match what you want.
        </p>
      </div>
      <div className={styles.pageMeta}>
        <div className={styles.statTile}>
          <span className={styles.eyebrow}>pending</span>
          <span className={styles.statValue}>{pendingCount}</span>
        </div>
        <div className={`${styles.statTile} ${styles.statTileAccent}`}>
          <span className={styles.eyebrow}>&lt; 1h to expiry</span>
          <span className={styles.statValue}>{expiringSoonCount}</span>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Stub the CSS module**

Create `MODULE_ROOT/approvals.module.css` with the minimum classes referenced (we'll expand it later — for now just enough for the test to render):

```css
/* MODULE_ROOT/approvals.module.css
   Mercury / Tools register. Inherits --mercury-* tokens from globals.css
   via local aliases on .approvalsPage. */

.approvalsPage {
  --cream: var(--mercury-cream);
  --ink: var(--mercury-ink);
  --ink-2: var(--mercury-ink-2);
  --ink-3: var(--mercury-ink-3);
  --ink-4: var(--mercury-ink-4);
  --accent: var(--mercury-accent);
  --accent-soft: var(--mercury-accent-soft);
  --hair: var(--mercury-hairline);
  --hair-soft: var(--mercury-hairline-soft);
  --row-hover: var(--mercury-row-hover);
  --serif: var(--font-serif-mercury);
  --mono: var(--font-mono-mercury);
  --sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  /* Page-local additions (do not promote to globals without wave-1.5 review). */
  --paper-warm: hsl(40 28% 92%);
  --paper-raised: hsl(40 25% 96%);
  --hair-strong: hsl(40 15% 78%);
  --accent-paper: hsl(20 70% 92%);
  --risk-low: var(--ink-4);
  --risk-med: hsl(34 30% 56%);
  --risk-high: hsl(20 70% 48%);
  --risk-crit: var(--ink);

  background: var(--cream);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 14px;
  line-height: 1.55;
  min-height: 100vh;
}

.eyebrow {
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-3);
  display: inline-block;
}

.pageHead {
  max-width: 1480px;
  margin: 0 auto;
  padding: 36px 28px 20px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 32px;
  align-items: flex-end;
}

.lead { min-width: 0; }

.pageTitle {
  font-family: var(--serif);
  font-size: clamp(34px, 4.2vw, 48px);
  font-weight: 500;
  letter-spacing: -0.014em;
  line-height: 1.02;
  margin-top: 10px;
}

.pageSub {
  font-family: var(--sans);
  font-size: 14.5px;
  color: var(--ink-3);
  margin-top: 12px;
  max-width: 42em;
  line-height: 1.55;
}

.pageMeta {
  display: grid;
  grid-template-columns: repeat(2, auto);
  gap: 0 36px;
  align-items: end;
}

.statTile { display: flex; flex-direction: column; gap: 5px; min-width: 4.5rem; }
.statTileAccent .statValue { color: var(--accent); }
.statValue {
  font-family: var(--mono);
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.005em;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 860px) {
  .pageHead { grid-template-columns: 1fr; gap: 22px; }
}
```

- [ ] **Step 5: Run, expect pass; commit**

```bash
pnpm --filter @switchboard/dashboard test approvals/header
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/components/header.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/__tests__/header.test.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/approvals.module.css
git commit -m "feat(approvals): header component + module CSS scaffolding

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 0.10: Build queue component (static, no live timer)

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/approvals/components/queue.tsx`
- Test: `apps/dashboard/src/app/(auth)/(mercury)/approvals/__tests__/queue.test.tsx`
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/approvals/approvals.module.css` (queue styles)

- [ ] **Step 1: Write the failing test**

```tsx
// MODULE_ROOT/__tests__/queue.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ApprovalsQueue } from "../components/queue";
import { APPROVALS_FIXTURES } from "../fixtures";

describe("ApprovalsQueue", () => {
  it("renders one row per approval", () => {
    render(<ApprovalsQueue items={APPROVALS_FIXTURES} activeId={null} onSelect={() => {}} />);
    // Scope by accessible label so extra page chrome doesn't false-positive (amendment F).
    expect(screen.getAllByRole("button", { name: /^Open approval:/ })).toHaveLength(APPROVALS_FIXTURES.length);
  });

  it("renders the summary text", () => {
    render(<ApprovalsQueue items={APPROVALS_FIXTURES.slice(0, 1)} activeId={null} onSelect={() => {}} />);
    expect(screen.getByText(/Refund SGD 4,820/)).toBeInTheDocument();
  });

  it("does not render an agent label in queue rows (agent moves to detail per amendment C)", () => {
    render(<ApprovalsQueue items={APPROVALS_FIXTURES.slice(0, 1)} activeId={null} onSelect={() => {}} />);
    // The pending wire shape does not include `agent`; queue rows don't display it.
    // Agent display surfaces in DetailHeader (Task 2.5) where the detail-row shape lives.
    expect(screen.queryByText(/Alex/)).not.toBeInTheDocument();
    expect(screen.queryByText(/billing-agent/)).not.toBeInTheDocument();
  });

  it("calls onSelect with the row id on click", () => {
    const onSelect = vi.fn();
    render(<ApprovalsQueue items={APPROVALS_FIXTURES.slice(0, 2)} activeId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText(/Refund SGD 4,820/));
    expect(onSelect).toHaveBeenCalledWith("apr_2f1a08");
  });

  it("renders skeleton when loading", () => {
    render(<ApprovalsQueue items={[]} activeId={null} onSelect={() => {}} loading />);
    expect(screen.getAllByTestId("queue-skeleton-row")).toHaveLength(6);
  });

  it("renders empty state when not loading and no items", () => {
    render(<ApprovalsQueue items={[]} activeId={null} onSelect={() => {}} />);
    expect(screen.getByText(/nothing waiting/i)).toBeInTheDocument();
  });

  it("renders no risk pips (deliberate omission from locked design)", () => {
    render(<ApprovalsQueue items={APPROVALS_FIXTURES} activeId={null} onSelect={() => {}} />);
    expect(document.querySelectorAll('[data-testid="risk-pip"]')).toHaveLength(0);
  });

  it("contains no engineering vocabulary", () => {
    render(<ApprovalsQueue items={APPROVALS_FIXTURES} activeId={null} onSelect={() => {}} />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/binding|envelope|lifecycle|dispatch|cartridge/i);
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm --filter @switchboard/dashboard test approvals/queue
```

- [ ] **Step 3: Implement**

```tsx
// MODULE_ROOT/components/queue.tsx
"use client";

import styles from "../approvals.module.css";
import type { PendingRow } from "../types";

export interface ApprovalsQueueProps {
  items: readonly PendingRow[];
  activeId: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
}

// NOTE (amendment C): the queue reads ONLY PendingApproval-shape fields.
// `agentDisplay` is called with `(req as DetailRow).agent` ONLY when the
// row was hydrated from the detail call. In fixture mode, the projection
// in usePendingApprovals strips `.agent`, so the agent label here will
// resolve to "an agent" — that is correct queue-list behavior. Agent
// display surfaces in the detail pane (Task 2.5) where the rich shape lives.

export function ApprovalsQueue({ items, activeId, onSelect, loading }: ApprovalsQueueProps) {
  if (loading) {
    return (
      <div className={styles.queue}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={styles.queueSkeleton} data-testid="queue-skeleton-row">
            <div className={`${styles.skelBar} ${styles.skelBarShort}`} />
            <div className={`${styles.skelBar} ${styles.skelBarLong}`} />
            <div className={`${styles.skelBar} ${styles.skelBarMed}`} />
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={styles.queue}>
        <div className={styles.queueEmpty}>
          <span className={styles.eyebrow}>queue clear</span>
          <div className={styles.queueEmptyTitle}>Nothing waiting.</div>
          <div className={styles.queueEmptySub}>
            When an agent proposes an action that needs your sign-off, it'll appear here with the
            full details and a confirmation code.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.queue}>
      {items.map((req) => (
        <QueueRow key={req.id} req={req} active={req.id === activeId} onSelect={onSelect} />
      ))}
    </div>
  );
}

function QueueRow({
  req,
  active,
  onSelect,
}: {
  req: PendingRow;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      id={`row-${req.id}`}
      aria-label={`Open approval: ${req.summary}`}
      className={`${styles.queueRow} ${active ? styles.queueRowActive : ""}`}
      data-risk={req.riskCategory}
      data-status={req.status}
      onClick={() => onSelect(req.id)}
    >
      <span className={styles.queueRowEdge} aria-hidden="true" />
      <div className={styles.queueRowRisk}>{req.riskCategory.toUpperCase()}</div>
      <div className={styles.queueRowBody}>
        <div className={styles.queueRowSummary}>{req.summary}</div>
        {/* Agent display surfaces in DetailHeader (Task 2.5), not in queue rows —
            the wire shape of /api/approvals/pending does not include `agent`. */}
      </div>
    </button>
  );
}
```

- [ ] **Step 4: Append queue CSS to `approvals.module.css`**

Append:

```css
.queue { display: flex; flex-direction: column; }

.queueEmpty {
  padding: 72px 28px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: flex-start;
}
.queueEmptyTitle {
  font-family: var(--serif);
  font-size: 30px;
  font-weight: 500;
  letter-spacing: -0.012em;
  line-height: 1.1;
}
.queueEmptySub {
  font-size: 14px;
  color: var(--ink-3);
  max-width: 32em;
  line-height: 1.6;
}

.queueRow {
  position: relative;
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: flex-start;
  gap: 18px;
  padding: 22px 28px 22px 24px;
  border-bottom: 1px solid var(--hair-soft);
  text-align: left;
  width: 100%;
  background: transparent;
  cursor: pointer;
  border: none;
  font: inherit;
  color: inherit;
  transition: background 280ms cubic-bezier(0.4, 0, 0.2, 1);
}
.queueRow:hover { background: var(--row-hover); }
.queueRowActive { background: var(--accent-paper); }

.queueRowEdge {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--hair);
}
.queueRow[data-risk="low"] .queueRowEdge { width: 1px; background: var(--risk-low); }
.queueRow[data-risk="medium"] .queueRowEdge { width: 2px; background: var(--risk-med); }
.queueRow[data-risk="high"] .queueRowEdge { width: 2px; background: var(--risk-high); }
.queueRow[data-risk="critical"] .queueRowEdge { width: 3px; background: var(--risk-crit); }
.queueRow[data-status="recovery_required"] .queueRowEdge {
  background: repeating-linear-gradient(180deg, var(--ink-3) 0 4px, transparent 4px 8px);
  width: 2px;
}

.queueRowRisk {
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--ink-4);
  width: 68px;
  padding-top: 2px;
}
.queueRow[data-risk="medium"] .queueRowRisk { color: var(--ink-3); }
.queueRow[data-risk="high"] .queueRowRisk { color: var(--risk-high); }
.queueRow[data-risk="critical"] .queueRowRisk { color: var(--ink); }

.queueRowBody { min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.queueRowSummary {
  font-family: var(--serif);
  font-size: 19px;
  font-weight: 500;
  letter-spacing: -0.008em;
  line-height: 1.22;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.queueRowMeta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-4);
  letter-spacing: 0.02em;
}
.queueRowMeta b { color: var(--ink-2); font-weight: 600; }

.queueSkeleton {
  padding: 22px 28px 22px 24px;
  border-bottom: 1px solid var(--hair-soft);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.skelBar {
  height: 11px;
  border-radius: 1px;
  background: linear-gradient(90deg, var(--paper-warm) 0%, var(--paper-raised) 50%, var(--paper-warm) 100%);
  background-size: 200% 100%;
  animation: approvalsSkel 1400ms ease-in-out infinite;
}
.skelBarShort { width: 38%; }
.skelBarMed { width: 62%; }
.skelBarLong { width: 84%; }
@keyframes approvalsSkel {
  0% { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .skelBar { animation: none; }
}
```

- [ ] **Step 5: Run, expect pass; commit**

```bash
pnpm --filter @switchboard/dashboard test approvals/queue
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/components/queue.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/__tests__/queue.test.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/approvals.module.css
git commit -m "feat(approvals): queue component with skeleton + empty state

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 0.11: Build `approvals-page.tsx` orchestrator + route entry

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/approvals/approvals-page.tsx`
- Create: `apps/dashboard/src/app/(auth)/(mercury)/approvals/page.tsx`
- Test: `apps/dashboard/src/app/(auth)/(mercury)/approvals/__tests__/approvals-page.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// MODULE_ROOT/__tests__/approvals-page.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { organizationId: "org-1", principalId: "p-1" },
    status: "authenticated",
  }),
}));
vi.mock("@/lib/route-availability", () => ({
  isMercuryToolLive: () => false,
}));
const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(""),
}));

import { ApprovalsPage } from "../approvals-page";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ApprovalsPage /></QueryClientProvider>);
}

describe("ApprovalsPage", () => {
  it("renders the title", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { level: 1, name: /approvals/i })).toBeInTheDocument();
  });

  it("renders all fixture rows after load", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Refund SGD 4,820/)).toBeInTheDocument());
  });

  it("sorts critical-with-5min-to-expiry early (expiring-soonest)", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Refund SGD 4,820/)).toBeInTheDocument());
    const buttons = screen.getAllByRole("button");
    // First fixture in expiring-soonest order should be apr_2f1a08 (the critical, 4min)
    expect(buttons[0]).toHaveTextContent(/Refund SGD 4,820/);
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement `approvals-page.tsx`**

```tsx
// MODULE_ROOT/approvals-page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./approvals.module.css";
import { ApprovalsHeader } from "./components/header";
import { ApprovalsQueue } from "./components/queue";
import { usePendingApprovals } from "./hooks/use-approvals";
import { sortApprovals } from "./sort";

export function ApprovalsPage() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const { data, isLoading } = usePendingApprovals();

  const items = useMemo(() => sortApprovals(data?.approvals ?? []), [data]);

  // Auto-select first row, recover when selection falls out, clear when list empties.
  // MUST be useEffect — setState during render causes React warnings + re-renders.
  useEffect(() => {
    if (items.length === 0) {
      if (activeId !== null) setActiveId(null);
      return;
    }
    if (!activeId || !items.some((r) => r.id === activeId)) {
      setActiveId(items[0].id);
    }
  }, [activeId, items]);

  const expiringSoonCount = items.filter(
    (r) => new Date(r.expiresAt).getTime() - Date.now() < 60 * 60_000,
  ).length;

  return (
    <div className={styles.approvalsPage}>
      <ApprovalsHeader pendingCount={items.length} expiringSoonCount={expiringSoonCount} />
      <main className={styles.split}>
        <aside className={styles.splitLeft}>
          <ApprovalsQueue items={items} activeId={activeId} onSelect={setActiveId} loading={isLoading} />
        </aside>
        <section className={styles.splitRight}>
          {/* Detail pane lands in PR-A2; placeholder for now. */}
          <div className={styles.detailPlaceholder}>
            <span className={styles.eyebrow}>select an approval</span>
            <p>The detail pane lands in the next PR.</p>
          </div>
        </section>
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Add `page.tsx` (server entry)**

```tsx
// MODULE_ROOT/page.tsx
import type { Metadata } from "next";
import { ApprovalsPage } from "./approvals-page";

export const metadata: Metadata = {
  title: "Approvals — Switchboard",
  description: "Sign, modify, or block actions agents have proposed.",
};

export default function ApprovalsRoute() {
  return <ApprovalsPage />;
}
```

- [ ] **Step 5: Append split + placeholder CSS**

Append to `approvals.module.css`:

```css
.split {
  max-width: 1480px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: minmax(420px, 480px) minmax(0, 1fr);
  min-height: calc(100vh - 240px);
}
@media (max-width: 1080px) {
  .split { grid-template-columns: 1fr; }
}
.splitLeft { border-right: 1px solid var(--hair); background: var(--cream); }
.splitRight { background: var(--cream); position: relative; }
.detailPlaceholder {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 48px 32px;
  align-items: center;
  text-align: center;
  color: var(--ink-3);
}
```

- [ ] **Step 6: Run, expect pass; commit**

```bash
pnpm --filter @switchboard/dashboard test approvals/approvals-page
pnpm --filter @switchboard/dashboard typecheck
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/page.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/approvals-page.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/__tests__/approvals-page.test.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/approvals.module.css
git commit -m "feat(approvals): page orchestrator with sort + queue + selection seed

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 0.12: Verify the route in the dev server

- [ ] **Step 1: Start dev with the flag on**

```bash
NEXT_PUBLIC_APPROVALS_LIVE=true pnpm --filter @switchboard/dashboard dev
```

- [ ] **Step 2: Confirm**

Visit `http://localhost:3002/approvals`. Expected:
- Page renders the title and 12 sorted fixture rows.
- Tools ▾ menu shows "Approvals".
- No console errors.

- [ ] **Step 3: Toggle the flag off, re-verify Tools menu**

Restart with `NEXT_PUBLIC_APPROVALS_LIVE=false`. Tools ▾ should no longer show Approvals.

- [ ] **Step 4: PR-A1a ships**

Push the branch and open a PR titled `feat(approvals): PR-A1a — route, gate, fixtures, queue (no live behavior)` against `main`.

---

## Phase 1 — PR-A1b: Filter strip + live countdown + critical-pinned sort

**Outcome:** Filter chips (all/low/medium/high/critical + "expiring < 60m") narrow the queue. Each row shows a live timer ticking every 1 s. Critical-and-<5min rows pin to the top of the sort. The interval pauses when the tab is hidden and the page refetches `/pending` on focus.

### Task 1.1: Pure `formatRemaining` helper

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/approvals/format.ts`
- Test: `apps/dashboard/src/app/(auth)/(mercury)/approvals/__tests__/format.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// MODULE_ROOT/__tests__/format.test.ts
import { describe, it, expect } from "vitest";
import { formatRemaining, timerLevel } from "../format";

describe("formatRemaining", () => {
  it("returns 'expired' when ms <= 0", () => {
    expect(formatRemaining(0)).toBe("expired");
    expect(formatRemaining(-1)).toBe("expired");
  });
  it("formats seconds under a minute", () => {
    expect(formatRemaining(45_000)).toBe("45s");
  });
  it("formats minutes and seconds under an hour", () => {
    expect(formatRemaining(2 * 60_000 + 14_000)).toBe("2m 14s");
  });
  it("formats hours and minutes at an hour or more", () => {
    expect(formatRemaining(3 * 3_600_000 + 22 * 60_000)).toBe("3h 22m");
  });
});

describe("timerLevel", () => {
  it("returns 'expired' at or below zero", () => {
    expect(timerLevel(0)).toBe("expired");
  });
  it("returns 'critical' under 5 minutes", () => {
    expect(timerLevel(4 * 60_000)).toBe("critical");
  });
  it("returns 'warn' under 1 hour", () => {
    expect(timerLevel(30 * 60_000)).toBe("warn");
  });
  it("returns 'normal' over 1 hour", () => {
    expect(timerLevel(2 * 3_600_000)).toBe("normal");
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm --filter @switchboard/dashboard test approvals/format
```

- [ ] **Step 3: Implement**

```ts
// MODULE_ROOT/format.ts
export function formatRemaining(ms: number): string {
  if (ms <= 0) return "expired";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h >= 1) return `${h}h ${m % 60}m`;
  if (m >= 1) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export type TimerLevel = "expired" | "critical" | "warn" | "normal";

export function timerLevel(ms: number): TimerLevel {
  if (ms <= 0) return "expired";
  if (ms < 5 * 60_000) return "critical";
  if (ms < 60 * 60_000) return "warn";
  return "normal";
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm --filter @switchboard/dashboard test approvals/format
```

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/format.ts apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/__tests__/format.test.ts
git commit -m "feat(approvals): formatRemaining + timerLevel pure helpers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.2: `useNow` hook with visibility-pause

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/approvals/hooks/use-now.ts`
- Test: `apps/dashboard/src/app/(auth)/(mercury)/approvals/__tests__/use-now.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// MODULE_ROOT/__tests__/use-now.test.tsx
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNow } from "../hooks/use-now";

describe("useNow", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("advances on every tick", () => {
    const { result } = renderHook(() => useNow(1000));
    const initial = result.current;
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current).toBeGreaterThan(initial);
  });

  it("pauses when document.hidden is true", () => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    const { result } = renderHook(() => useNow(1000));
    const initial = result.current;
    act(() => { vi.advanceTimersByTime(5000); });
    expect(result.current).toBe(initial);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement**

```ts
// MODULE_ROOT/hooks/use-now.ts
"use client";

import { useEffect, useState } from "react";

/**
 * Returns `now: number` updated every `intervalMs`. Pauses while the tab is
 * hidden and resumes on `visibilitychange`. Page-local for v1; promote to a
 * shared util when /mission or another surface adopts the same pattern.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let timerId: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timerId !== null) return;
      timerId = setInterval(() => setNow(Date.now()), intervalMs);
    };
    const stop = () => {
      if (timerId === null) return;
      clearInterval(timerId);
      timerId = null;
    };
    const handleVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        setNow(Date.now());
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [intervalMs]);

  return now;
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm --filter @switchboard/dashboard test approvals/use-now
```

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/hooks/use-now.ts apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/__tests__/use-now.test.tsx
git commit -m "feat(approvals): useNow hook with visibility-pause

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.3: Wire the live timer into queue rows

**Files:**
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/approvals/components/queue.tsx`
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/approvals/__tests__/queue.test.tsx`
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/approvals/approvals.module.css`

- [ ] **Step 1: Extend the test**

Append to `queue.test.tsx`:

```tsx
import { formatRemaining } from "../format";

describe("ApprovalsQueue live timer", () => {
  it("renders the time-remaining for each row when `now` is passed", () => {
    const future = Date.now() + 90_000;
    const item = { ...APPROVALS_FIXTURES[0], expiresAt: new Date(future).toISOString() };
    render(<ApprovalsQueue items={[item]} activeId={null} onSelect={() => {}} now={Date.now()} />);
    expect(screen.getByText(formatRemaining(90_000))).toBeInTheDocument();
  });

  it("applies critical class when remaining < 5 minutes", () => {
    const future = Date.now() + 60_000;
    const item = { ...APPROVALS_FIXTURES[0], expiresAt: new Date(future).toISOString() };
    render(<ApprovalsQueue items={[item]} activeId={null} onSelect={() => {}} now={Date.now()} />);
    const timer = screen.getByTestId("queue-row-timer");
    expect(timer.className).toMatch(/critical/);
  });
});
```

- [ ] **Step 2: Update the component to accept `now` and render timer**

In `queue.tsx`, extend `ApprovalsQueueProps` with `now?: number`, thread to `QueueRow`, render the timer:

```tsx
export interface ApprovalsQueueProps {
  items: readonly ApprovalRow[];
  activeId: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
  now?: number;
}
```

In `QueueRow`, add timer rendering. Add import:

```tsx
import { formatRemaining, timerLevel } from "../format";
```

Inside `QueueRow`'s return block (between `queueRowBody` and the closing `</button>`):

```tsx
{typeof now === "number" && (() => {
  const remaining = new Date(req.expiresAt).getTime() - now;
  const level = timerLevel(remaining);
  return (
    <div className={styles.queueRowRight}>
      <span
        className={`${styles.queueRowTimer} ${styles[`queueRowTimer_${level}`] ?? ""}`}
        data-testid="queue-row-timer"
      >
        {formatRemaining(remaining)}
      </span>
    </div>
  );
})()}
```

Update the row grid to 3 columns:

```css
.queueRow { grid-template-columns: auto 1fr auto; }
```

Append timer CSS:

```css
.queueRowRight { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; white-space: nowrap; padding-top: 2px; }
.queueRowTimer {
  font-family: var(--mono);
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.01em;
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}
.queueRowTimer_warn { color: var(--risk-high); font-weight: 600; }
.queueRowTimer_critical { color: var(--ink); font-weight: 700; }
.queueRowTimer_expired { color: var(--ink-4); text-decoration: line-through; }
```

- [ ] **Step 3: Run, expect pass**

```bash
pnpm --filter @switchboard/dashboard test approvals/queue
```

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/components/queue.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/__tests__/queue.test.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/approvals.module.css
git commit -m "feat(approvals): live timer in queue rows

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.4: Critical-pinned sort variant

**Files:**
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/approvals/sort.ts`
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/approvals/__tests__/sort.test.ts`

- [ ] **Step 1: Extend the test**

Append:

```ts
describe("sortApprovals critical-pinned variant", () => {
  it("pins critical-and-under-5min to the top regardless of expiry order", () => {
    const now = Date.now();
    const expiringIn = (ms: number) => new Date(now + ms).toISOString();
    const lowSoon = { ...row("low", expiringIn(60_000), "low") };
    const criticalSoon = { ...row("crit", expiringIn(4 * 60_000), "critical") };
    const lowLater = { ...row("later", expiringIn(30 * 60_000), "low") };
    const sorted = sortApprovals([lowSoon, criticalSoon, lowLater], now);
    expect(sorted.map((r) => r.id)).toEqual(["crit", "low", "later"]);
  });

  it("does not pin critical that is not under 5 minutes", () => {
    const now = Date.now();
    const expiringIn = (ms: number) => new Date(now + ms).toISOString();
    const criticalLate = { ...row("crit", expiringIn(30 * 60_000), "critical") };
    const lowSoon = { ...row("low", expiringIn(60_000), "low") };
    const sorted = sortApprovals([criticalLate, lowSoon], now);
    expect(sorted.map((r) => r.id)).toEqual(["low", "crit"]);
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Update `sort.ts` to accept optional `now`**

```ts
// MODULE_ROOT/sort.ts
import type { ApprovalRow } from "./types";

const PIN_THRESHOLD_MS = 5 * 60_000;

export function sortApprovals(rows: readonly ApprovalRow[], now?: number): ApprovalRow[] {
  const ref = now ?? Date.now();
  const isPinned = (r: ApprovalRow) =>
    r.riskCategory === "critical" && new Date(r.expiresAt).getTime() - ref < PIN_THRESHOLD_MS;

  return [...rows].sort((a, b) => {
    const pa = isPinned(a), pb = isPinned(b);
    if (pa !== pb) return pa ? -1 : 1;
    const ta = new Date(a.expiresAt).getTime();
    const tb = new Date(b.expiresAt).getTime();
    if (ta !== tb) return ta - tb;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/sort.ts apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/__tests__/sort.test.ts
git commit -m "feat(approvals): pin critical-and-<5min to top of sort

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.5: Filter strip component

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/approvals/components/filter-strip.tsx`
- Test: `apps/dashboard/src/app/(auth)/(mercury)/approvals/__tests__/filter-strip.test.tsx`
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/approvals/approvals.module.css`

- [ ] **Step 1: Write the failing test**

```tsx
// MODULE_ROOT/__tests__/filter-strip.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilterStrip } from "../components/filter-strip";

const counts = { all: 12, low: 4, medium: 3, high: 4, critical: 1 };

describe("FilterStrip", () => {
  it("renders one chip per risk level plus 'all'", () => {
    render(<FilterStrip filter="all" expiringOnly={false} counts={counts} expiringSoonCount={3} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /^all/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^low/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^medium/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^high/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^critical/i })).toBeInTheDocument();
  });

  it("renders the expiring-soon chip", () => {
    render(<FilterStrip filter="all" expiringOnly={false} counts={counts} expiringSoonCount={3} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /expiring/i })).toBeInTheDocument();
  });

  it("invokes onChange with the next filter on chip click", () => {
    const onChange = vi.fn();
    render(<FilterStrip filter="all" expiringOnly={false} counts={counts} expiringSoonCount={3} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /^high/i }));
    expect(onChange).toHaveBeenCalledWith({ filter: "high", expiringOnly: false });
  });

  it("invokes onChange with toggled expiringOnly", () => {
    const onChange = vi.fn();
    render(<FilterStrip filter="all" expiringOnly={false} counts={counts} expiringSoonCount={3} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /expiring/i }));
    expect(onChange).toHaveBeenCalledWith({ filter: "all", expiringOnly: true });
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement**

```tsx
// MODULE_ROOT/components/filter-strip.tsx
"use client";

import styles from "../approvals.module.css";

export type RiskFilter = "all" | "low" | "medium" | "high" | "critical";

export interface FilterStripProps {
  filter: RiskFilter;
  expiringOnly: boolean;
  counts: Record<RiskFilter, number>;
  expiringSoonCount: number;
  onChange: (next: { filter: RiskFilter; expiringOnly: boolean }) => void;
}

const RISKS: ReadonlyArray<Exclude<RiskFilter, "all">> = ["low", "medium", "high", "critical"];

export function FilterStrip({
  filter,
  expiringOnly,
  counts,
  expiringSoonCount,
  onChange,
}: FilterStripProps) {
  return (
    <div className={styles.filterStrip}>
      <span className={styles.eyebrow}>filter</span>
      <button
        type="button"
        className={`${styles.filterChip} ${filter === "all" ? styles.filterChipOn : ""}`}
        onClick={() => onChange({ filter: "all", expiringOnly })}
      >
        all <span className={styles.filterChipCount}>{counts.all}</span>
      </button>
      {RISKS.map((r) => (
        <button
          key={r}
          type="button"
          data-cat={r}
          className={`${styles.filterChip} ${filter === r ? styles.filterChipOn : ""}`}
          onClick={() => onChange({ filter: r, expiringOnly })}
        >
          <span className={styles.filterChipBullet} aria-hidden="true" />
          {r} <span className={styles.filterChipCount}>{counts[r] ?? 0}</span>
        </button>
      ))}
      <button
        type="button"
        className={`${styles.filterChip} ${expiringOnly ? styles.filterChipOn : ""}`}
        onClick={() => onChange({ filter, expiringOnly: !expiringOnly })}
      >
        expiring &lt; 60m <span className={styles.filterChipCount}>{expiringSoonCount}</span>
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Append CSS**

```css
.filterStrip {
  max-width: 1480px;
  margin: 0 auto;
  padding: 14px 28px 18px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--hair);
}
.filterChip {
  font-family: var(--mono);
  font-size: 11.5px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-weight: 500;
  color: var(--ink-3);
  padding: 6px 12px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  transition: color 280ms cubic-bezier(0.4, 0, 0.2, 1),
              background 280ms cubic-bezier(0.4, 0, 0.2, 1);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
.filterChip:hover { color: var(--ink); background: rgba(14, 12, 10, 0.04); }
.filterChipOn { color: var(--ink); background: rgba(14, 12, 10, 0.06); }
.filterChipCount {
  font-size: 10.5px;
  color: var(--ink-4);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.filterChipOn .filterChipCount { color: var(--ink); }
.filterChipBullet { width: 6px; height: 6px; border-radius: 50%; background: var(--ink-4); }
.filterChip[data-cat="low"] .filterChipBullet { background: var(--risk-low); }
.filterChip[data-cat="medium"] .filterChipBullet { background: var(--risk-med); }
.filterChip[data-cat="high"] .filterChipBullet { background: var(--risk-high); }
.filterChip[data-cat="critical"] .filterChipBullet { background: var(--risk-crit); }
```

- [ ] **Step 5: Run, expect pass; commit**

```bash
pnpm --filter @switchboard/dashboard test approvals/filter-strip
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/components/filter-strip.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/__tests__/filter-strip.test.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/approvals.module.css
git commit -m "feat(approvals): filter strip with risk chips + expiring-soon toggle

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.6: Wire filter + countdown + refetchOnWindowFocus into the page

**Files:**
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/approvals/approvals-page.tsx`
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/approvals/hooks/use-approvals.ts`
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/approvals/__tests__/approvals-page.test.tsx`

- [ ] **Step 1: Extend the page test**

Append to `approvals-page.test.tsx`:

```tsx
it("toggling a risk filter narrows the rendered rows", async () => {
  renderPage();
  await screen.findByText(/Refund SGD 4,820/);
  fireEvent.click(screen.getByRole("button", { name: /^critical/i }));
  // Only the one critical fixture should remain
  expect(screen.getAllByRole("button", { name: /^(Refund SGD 4,820)/ })).toHaveLength(1);
});
```

(Add `fireEvent` to the existing testing-library import at the top.)

- [ ] **Step 2: Update `useApprovals` to refetch on focus**

In `hooks/use-approvals.ts`, add `refetchOnWindowFocus: live` to the `useQuery` options.

- [ ] **Step 3: Update `approvals-page.tsx`**

```tsx
// MODULE_ROOT/approvals-page.tsx
"use client";

import { useMemo, useState } from "react";
import styles from "./approvals.module.css";
import { ApprovalsHeader } from "./components/header";
import { ApprovalsQueue } from "./components/queue";
import { FilterStrip, type RiskFilter } from "./components/filter-strip";
import { useNow } from "./hooks/use-now";
import { usePendingApprovals } from "./hooks/use-approvals";
import { sortApprovals } from "./sort";

export function ApprovalsPage() {
  const now = useNow(1000);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filter, setFilter] = useState<RiskFilter>("all");
  const [expiringOnly, setExpiringOnly] = useState(false);

  const { data, isLoading } = usePendingApprovals();
  const allItems = data?.approvals ?? [];

  const counts = useMemo(() => {
    const c: Record<RiskFilter, number> = { all: allItems.length, low: 0, medium: 0, high: 0, critical: 0 };
    for (const r of allItems) {
      if (r.riskCategory in c) c[r.riskCategory as Exclude<RiskFilter, "all">]++;
    }
    return c;
  }, [allItems]);

  const expiringSoonCount = useMemo(
    () => allItems.filter((r) => new Date(r.expiresAt).getTime() - now < 60 * 60_000).length,
    [allItems, now],
  );

  const filteredSorted = useMemo(() => {
    let out = allItems;
    if (filter !== "all") out = out.filter((r) => r.riskCategory === filter);
    if (expiringOnly) out = out.filter((r) => new Date(r.expiresAt).getTime() - now < 60 * 60_000);
    return sortApprovals(out, now);
  }, [allItems, filter, expiringOnly, now]);

  // Auto-select when active falls out of filtered set.
  if (filteredSorted.length > 0 && !filteredSorted.some((r) => r.id === activeId)) {
    setActiveId(filteredSorted[0].id);
  }
  if (filteredSorted.length === 0 && activeId !== null) {
    setActiveId(null);
  }

  return (
    <div className={styles.approvalsPage}>
      <ApprovalsHeader pendingCount={allItems.length} expiringSoonCount={expiringSoonCount} />
      <FilterStrip
        filter={filter}
        expiringOnly={expiringOnly}
        counts={counts}
        expiringSoonCount={expiringSoonCount}
        onChange={({ filter: f, expiringOnly: e }) => {
          setFilter(f);
          setExpiringOnly(e);
        }}
      />
      <main className={styles.split}>
        <aside className={styles.splitLeft}>
          <ApprovalsQueue
            items={filteredSorted}
            activeId={activeId}
            onSelect={setActiveId}
            loading={isLoading}
            now={now}
          />
        </aside>
        <section className={styles.splitRight}>
          <div className={styles.detailPlaceholder}>
            <span className={styles.eyebrow}>select an approval</span>
            <p>The detail pane lands in the next PR.</p>
          </div>
        </section>
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm --filter @switchboard/dashboard test approvals
```

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/approvals-page.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/hooks/use-approvals.ts apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/__tests__/approvals-page.test.tsx
git commit -m "feat(approvals): wire filter + live countdown + refetchOnWindowFocus

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.7: PR-A1b ships

- [ ] **Step 1: Full dashboard test sweep**

```bash
pnpm --filter @switchboard/dashboard typecheck && pnpm --filter @switchboard/dashboard test
```

- [ ] **Step 2: Manual check in dev**

`NEXT_PUBLIC_APPROVALS_LIVE=true pnpm --filter @switchboard/dashboard dev`. Visit `/approvals`. Confirm:
- Timer ticks every second.
- The critical fixture (`apr_2f1a08`, 4-min) pinned to the top.
- Clicking risk chips narrows the list.
- Switch to another tab for 30 s; on return, the timer doesn't show a 30 s jump (visibility-pause working).

- [ ] **Step 3: Push and PR**

`feat(approvals): PR-A1b — filter strip + live countdown + critical-pinned sort`

---

## Phase 2 — PR-A2: Detail pane (header, confirmation code, params, empty) — single-approver only

**Outcome:** Selecting a row reveals a detail pane with risk pill, live countdown, summary, parameters snapshot, and the bracketed **confirmation code** block. URL `?id=` syncs with the selection. No action drawer yet (placeholder).

### Task 2.1: `shortHash` pure helper

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/approvals/short-hash.ts`
- Test: `apps/dashboard/src/app/(auth)/(mercury)/approvals/__tests__/short-hash.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// MODULE_ROOT/__tests__/short-hash.test.ts
import { describe, it, expect } from "vitest";
import { shortHash } from "../short-hash";

describe("shortHash", () => {
  it("returns slice(0,6) + ellipsis + slice(-3) for a typical hash", () => {
    expect(shortHash("0x2f1a08c4e9b1d7a4f0c3b8a5d2e7f1a9")).toBe("0x2f1a…1a9");
  });
  it("returns empty string for empty input", () => {
    expect(shortHash("")).toBe("");
  });
  it("handles undefined gracefully", () => {
    expect(shortHash(undefined)).toBe("");
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement**

```ts
// MODULE_ROOT/short-hash.ts
/**
 * Operator-facing short form of the confirmation code.
 * `0x2f1a08c4…1a9` — first 6 + ellipsis + last 3.
 * Used on the approve commit line, ack checkbox, and CTA so the operator
 * pattern-matches the same chunk across the page.
 */
export function shortHash(value: string | undefined | null): string {
  if (!value) return "";
  if (value.length <= 9) return value;
  return `${value.slice(0, 6)}…${value.slice(-3)}`;
}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/short-hash.ts apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/__tests__/short-hash.test.ts
git commit -m "feat(approvals): shortHash pure helper

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.2: `actionDisplay` for action id → human label

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/approvals/action-display.ts`
- Test: `apps/dashboard/src/app/(auth)/(mercury)/approvals/__tests__/action-display.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// MODULE_ROOT/__tests__/action-display.test.ts
import { describe, it, expect } from "vitest";
import { actionDisplay } from "../action-display";

describe("actionDisplay", () => {
  it("maps billing.refund.issue to 'refund'", () => {
    expect(actionDisplay("billing.refund.issue")).toBe("refund");
  });
  it("maps comms.sms.broadcast to 'SMS broadcast'", () => {
    expect(actionDisplay("comms.sms.broadcast")).toBe("SMS broadcast");
  });
  it("falls back to a tidied dotted id when unmapped", () => {
    expect(actionDisplay("custom.thing.x")).toBe("custom thing x");
  });
  it("falls back to 'action' for empty/undefined input", () => {
    expect(actionDisplay(undefined)).toBe("action");
    expect(actionDisplay("")).toBe("action");
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement**

```ts
// MODULE_ROOT/action-display.ts
const MAP: Record<string, string> = {
  "billing.refund.issue": "refund",
  "billing.discount.apply": "discount",
  "billing.fee.apply": "fee",
  "billing.voucher.issue": "voucher",
  "comms.sms.broadcast": "SMS broadcast",
  "calendar.reschedule.bulk": "bulk reschedule",
  "catalog.price.update": "price update",
  "ads.budget.scale": "ad budget change",
  "infra.db.rotate-credentials": "credential rotation",
  "data.session.purge": "data purge",
  "cms.consent.publish": "consent form update",
  "compliance.gdpr.export": "data export",
};

export function actionDisplay(actionId: string | undefined | null): string {
  if (!actionId) return "action";
  return MAP[actionId] ?? actionId.replace(/\./g, " ");
}
```

- [ ] **Step 4: Run, expect pass; commit**

```bash
pnpm --filter @switchboard/dashboard test approvals/action-display
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/action-display.ts apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/__tests__/action-display.test.ts
git commit -m "feat(approvals): actionDisplay maps action ids to human labels

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.3: `useApprovalDetail` hook

**Files:**
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/approvals/hooks/use-approvals.ts`
- Test: `apps/dashboard/src/app/(auth)/(mercury)/approvals/__tests__/use-approval-detail.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// MODULE_ROOT/__tests__/use-approval-detail.test.tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode } from "react";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1", principalId: "p-1" }, status: "authenticated" }),
}));
vi.mock("@/lib/route-availability", () => ({ isMercuryToolLive: () => false }));

import { useApprovalDetail } from "../hooks/use-approvals";

function wrap({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useApprovalDetail (fixture mode)", () => {
  it("returns the fixture row by id", async () => {
    const { result } = renderHook(() => useApprovalDetail("apr_2f1a08"), { wrapper: wrap });
    await waitFor(() => expect(result.current.data?.id).toBe("apr_2f1a08"));
  });

  it("is disabled when id is null", () => {
    const { result } = renderHook(() => useApprovalDetail(null), { wrapper: wrap });
    expect(result.current.fetchStatus).toBe("idle");
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Extend `hooks/use-approvals.ts`**

Append:

```ts
export function useApprovalDetail(id: string | null) {
  const keys = useScopedQueryKeys();
  const live = isLive();

  return useQuery({
    queryKey: id
      ? keys?.approvals.detail(id) ?? (["__disabled_approval_detail__", id] as const)
      : (["__no_id_approval_detail__"] as const),
    queryFn: async () => {
      if (!id) throw new Error("missing id");
      if (!live) {
        const row = APPROVALS_FIXTURES.find((r) => r.id === id);
        if (!row) throw new Error(`fixture not found: ${id}`);
        return row;
      }
      const res = await fetch(`/api/dashboard/approvals?id=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`Failed to load approval: ${res.status}`);
      return res.json() as Promise<ApprovalRow>;
    },
    enabled: !!id && (!live || !!keys),
    staleTime: 5_000,
  });
}
```

- [ ] **Step 4: Run, expect pass; commit**

```bash
pnpm --filter @switchboard/dashboard test approvals/use-approval-detail
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/hooks/use-approvals.ts apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/__tests__/use-approval-detail.test.tsx
git commit -m "feat(approvals): useApprovalDetail hook (fixture + live)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.4: Detail empty placeholder

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/approvals/components/detail/empty.tsx`

- [ ] **Step 1: Implement**

```tsx
// MODULE_ROOT/components/detail/empty.tsx
import styles from "../../approvals.module.css";

export function DetailEmpty() {
  return (
    <div className={styles.detailEmpty}>
      <span className={styles.eyebrow}>select an approval</span>
      <p className={styles.detailEmptyLead}>Pick a card on the left to see the details and sign.</p>
      <p className={styles.detailEmptySub}>
        Each confirmation code locks in a specific set of details. Signing approves only that exact
        version.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Append CSS**

```css
.detailEmpty {
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: center;
  text-align: center;
  padding: 48px 32px;
  min-height: 60vh;
  justify-content: center;
}
.detailEmptyLead { font-family: var(--serif); font-size: 28px; font-weight: 500; line-height: 1.15; color: var(--ink); max-width: 30em; }
.detailEmptySub { font-size: 14px; color: var(--ink-3); max-width: 30em; line-height: 1.55; }
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/components/detail/empty.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/approvals.module.css
git commit -m "feat(approvals): detail empty placeholder

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.5: Detail header (risk pill, live timer, summary, parametersSnapshot)

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/approvals/components/detail/header.tsx`
- Test: `apps/dashboard/src/app/(auth)/(mercury)/approvals/__tests__/detail-header.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// MODULE_ROOT/__tests__/detail-header.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DetailHeader } from "../components/detail/header";
import { APPROVALS_FIXTURES } from "../fixtures";

const row = APPROVALS_FIXTURES.find((r) => r.id === "apr_2f1a08")!;

describe("DetailHeader", () => {
  it("renders the summary", () => {
    render(<DetailHeader row={row} now={Date.now()} />);
    expect(screen.getByText(/Refund SGD 4,820/)).toBeInTheDocument();
  });

  it("renders the risk pill with the category", () => {
    render(<DetailHeader row={row} now={Date.now()} />);
    expect(screen.getByText(/^critical$/i)).toBeInTheDocument();
  });

  it("renders the agent display name not the raw id", () => {
    render(<DetailHeader row={row} now={Date.now()} />);
    expect(screen.getByText(/Alex/)).toBeInTheDocument();
    expect(screen.queryByText(/billing-agent/)).not.toBeInTheDocument();
  });

  it("renders each parametersSnapshot key as a definition list entry", () => {
    render(<DetailHeader row={row} now={Date.now()} />);
    expect(screen.getByText("accountId")).toBeInTheDocument();
    expect(screen.getByText("SG-44120")).toBeInTheDocument();
    expect(screen.getByText("amount")).toBeInTheDocument();
  });

  it("renders the live countdown", () => {
    const future = Date.now() + 90_000;
    const r = { ...row, expiresAt: new Date(future).toISOString() };
    render(<DetailHeader row={r} now={Date.now()} />);
    expect(screen.getByText(/1m 30s/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement**

```tsx
// MODULE_ROOT/components/detail/header.tsx
"use client";

import styles from "../../approvals.module.css";
import { formatRemaining, timerLevel } from "../../format";
import { agentDisplay } from "../../hooks/use-agent-display";
import { actionDisplay } from "../../action-display";
import type { ApprovalRow } from "../../types";

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return v.toLocaleString();
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export interface DetailHeaderProps {
  row: ApprovalRow;
  now: number;
}

export function DetailHeader({ row, now }: DetailHeaderProps) {
  const remaining = new Date(row.expiresAt).getTime() - now;
  const level = timerLevel(remaining);
  const agent = agentDisplay(row.agent);
  const action = actionDisplay(row.request?.action);
  const params = row.request?.parametersSnapshot ?? {};

  return (
    <div className={styles.dblock}>
      <div className={styles.detailHead}>
        <div className={styles.dhRow}>
          <span className={styles.dhPill} data-risk={row.riskCategory}>
            {row.riskCategory}
          </span>
          <span className={`${styles.dhTimer} ${styles[`dhTimer_${level}`] ?? ""}`}>
            <span className={styles.eyebrow}>{remaining <= 0 ? "expired" : "expires in"}</span>
            <span>{formatRemaining(remaining)}</span>
          </span>
        </div>
        <h2 className={styles.dhSummary}>{row.summary}</h2>
        <div className={styles.dhFoot}>
          <span><b>{agent.name}</b>{agent.role ? ` · ${agent.role}` : ""}</span>
          <span className={styles.dhFootSep}>·</span>
          <span>action: <b>{action}</b></span>
        </div>
        <div className={styles.params}>
          <div className={styles.paramsHead}>
            <span className={styles.eyebrow}>details</span>
          </div>
          <dl className={styles.paramsList}>
            {Object.entries(params).map(([k, v]) => (
              <div key={k} className={styles.paramsRow}>
                <dt>{k}</dt>
                <dd>{renderValue(v)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Append CSS for the header block**

```css
.dblock { padding: 32px 40px; border-bottom: 1px solid var(--hair); }
@media (max-width: 1080px) { .dblock { padding-left: 28px; padding-right: 28px; } }

.detailHead { display: flex; flex-direction: column; gap: 18px; }
.dhRow { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.dhPill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 3px 11px;
  border-radius: 999px;
  background: transparent;
  color: var(--ink-3);
  font-family: var(--mono);
  font-weight: 700;
  letter-spacing: 0.14em;
  font-size: 10.5px;
  text-transform: uppercase;
  border: 1px solid var(--hair-strong);
}
.dhPill[data-risk="medium"] { color: var(--ink); border-color: var(--risk-med); }
.dhPill[data-risk="high"] { color: var(--ink); border-color: var(--risk-high); background: var(--accent-paper); }
.dhPill[data-risk="critical"] { color: var(--cream); background: var(--ink); border-color: var(--ink); }
.dhTimer {
  font-family: var(--mono);
  font-size: 13px;
  font-weight: 500;
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.dhTimer_warn { color: var(--risk-high); font-weight: 600; }
.dhTimer_critical { color: var(--ink); font-weight: 700; }
.dhTimer_expired { color: var(--ink-4); text-decoration: line-through; }
.dhSummary {
  font-family: var(--serif);
  font-size: clamp(28px, 3vw, 40px);
  font-weight: 500;
  letter-spacing: -0.018em;
  line-height: 1.08;
  max-width: 18em;
}
.dhFoot { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-family: var(--mono); font-size: 11px; color: var(--ink-4); }
.dhFoot b { color: var(--ink-2); font-weight: 500; }
.dhFootSep { opacity: 0.45; }
.params { margin-top: 14px; padding-top: 18px; border-top: 1px solid var(--hair-soft); }
.paramsHead { display: flex; align-items: baseline; gap: 12px; margin-bottom: 14px; }
.paramsList { display: grid; grid-template-columns: 11rem 1fr; column-gap: 24px; row-gap: 10px; font-family: var(--mono); font-size: 12.5px; }
.paramsRow { display: contents; }
.paramsList dt { color: var(--ink-4); font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; font-size: 10px; padding-top: 2px; }
.paramsList dd { color: var(--ink); font-weight: 500; word-break: break-word; font-variant-numeric: tabular-nums; }
```

- [ ] **Step 5: Run, expect pass; commit**

```bash
pnpm --filter @switchboard/dashboard test approvals/detail-header
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/components/detail/header.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/__tests__/detail-header.test.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/approvals.module.css
git commit -m "feat(approvals): detail header with risk pill, live timer, params

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.6: Confirmation code block

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/approvals/components/detail/confirmation-code.tsx`
- Test: `apps/dashboard/src/app/(auth)/(mercury)/approvals/__tests__/confirmation-code.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// MODULE_ROOT/__tests__/confirmation-code.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ConfirmationCode } from "../components/detail/confirmation-code";

const HASH = "0x2f1a08c4e9b1d7a4f0c3b8a5d2e7f1a9";
const ENV = "env_2f1a08c4";

describe("ConfirmationCode", () => {
  it("renders the full hash visible (not behind a click)", () => {
    render(<ConfirmationCode bindingHash={HASH} envelopeId={ENV} />);
    expect(screen.getByText(HASH)).toBeInTheDocument();
  });

  it("renders the operator-language eyebrow", () => {
    render(<ConfirmationCode bindingHash={HASH} envelopeId={ENV} />);
    expect(screen.getByText(/confirmation code/i)).toBeInTheDocument();
    expect(screen.getByText(/locks in the details above/i)).toBeInTheDocument();
  });

  it("renders the reference id (operator-language for envelope)", () => {
    render(<ConfirmationCode bindingHash={HASH} envelopeId={ENV} />);
    expect(screen.getByText(/Reference:/i)).toBeInTheDocument();
    expect(screen.getByText(ENV)).toBeInTheDocument();
  });

  it("contains no engineering vocabulary in visible text (excluding the code value)", () => {
    render(<ConfirmationCode bindingHash={HASH} envelopeId={ENV} />);
    const codeEl = screen.getByTestId("confirmation-code-value");
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelector('[data-testid="confirmation-code-value"]')?.remove();
    const text = clone.textContent ?? "";
    expect(text).not.toMatch(/binding|envelope|sha256|lifecycle|dispatch/i);
  });

  it("calls clipboard.writeText on copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<ConfirmationCode bindingHash={HASH} envelopeId={ENV} />);
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(HASH));
  });

  it("falls back gracefully when clipboard write fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<ConfirmationCode bindingHash={HASH} envelopeId={ENV} />);
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    await waitFor(() => expect(screen.getByText(/couldn't copy/i)).toBeInTheDocument());
  });

  it("code value is selectable (no user-select: none)", () => {
    render(<ConfirmationCode bindingHash={HASH} envelopeId={ENV} />);
    const el = screen.getByTestId("confirmation-code-value");
    expect(window.getComputedStyle(el).userSelect).not.toBe("none");
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement**

```tsx
// MODULE_ROOT/components/detail/confirmation-code.tsx
"use client";

import { useState } from "react";
import styles from "../../approvals.module.css";

export interface ConfirmationCodeProps {
  bindingHash: string;
  envelopeId: string;
}

export function ConfirmationCode({ bindingHash, envelopeId }: ConfirmationCodeProps) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(bindingHash);
      setStatus("copied");
      setTimeout(() => setStatus("idle"), 1400);
    } catch {
      setStatus("failed");
      setTimeout(() => setStatus("idle"), 3000);
    }
  }

  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeHead}>
        <span className={styles.eyebrow}>Confirmation code · locks in the details above</span>
      </div>
      <div className={styles.codeRow}>
        <span
          className={styles.codeValue}
          data-testid="confirmation-code-value"
          // user-select stays default (auto). Do not set `none`.
        >
          {bindingHash}
        </span>
        <button type="button" className={styles.codeCopyBtn} onClick={copy}>
          {status === "copied" ? "Copied" : status === "failed" ? "Couldn't copy — select and copy manually" : "Copy code"}
        </button>
      </div>
      <div className={styles.codeFoot} aria-live="polite">
        This code matches the exact details above. If any detail changes, the code changes. If
        something looks off, reject this and the agent can propose a corrected version.
      </div>
      <div className={styles.codeRef}>
        Reference: <span className={styles.codeRefId}>{envelopeId}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Append CSS**

```css
.codeBlock {
  margin: 0 40px;
  padding: 20px 0;
  border-top: 1px solid var(--ink);
  border-bottom: 1px solid var(--ink);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
@media (max-width: 1080px) { .codeBlock { margin-left: 28px; margin-right: 28px; } }
.codeHead .eyebrow { color: var(--ink); letter-spacing: 0.16em; }
.codeRow { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
.codeValue {
  font-family: var(--mono);
  font-size: 18px;
  letter-spacing: 0.04em;
  color: var(--ink);
  word-break: break-all;
  font-weight: 600;
  flex: 1;
  min-width: 16rem;
  line-height: 1.4;
}
.codeCopyBtn {
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--ink);
  padding: 7px 14px;
  border: 1px solid var(--ink);
  border-radius: 2px;
  background: transparent;
  cursor: pointer;
  transition: background 280ms cubic-bezier(0.4, 0, 0.2, 1), color 280ms cubic-bezier(0.4, 0, 0.2, 1);
}
.codeCopyBtn:hover { background: var(--ink); color: var(--cream); }
.codeFoot {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-4);
  line-height: 1.55;
}
.codeRef { font-family: var(--mono); font-size: 10px; color: var(--ink-4); }
.codeRefId { color: var(--ink-2); font-weight: 600; }
```

- [ ] **Step 5: Run, expect pass; commit**

```bash
pnpm --filter @switchboard/dashboard test approvals/confirmation-code
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/components/detail/confirmation-code.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/__tests__/confirmation-code.test.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/approvals.module.css
git commit -m "feat(approvals): confirmation code block with copy + fallback

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.7: Detail orchestrator + URL `?id=` sync + page wiring

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/approvals/components/detail/index.tsx`
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/approvals/approvals-page.tsx`
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/approvals/__tests__/approvals-page.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `approvals-page.test.tsx`:

```tsx
it("renders the detail pane for the active row", async () => {
  renderPage();
  await waitFor(() => expect(screen.getByText(/Refund SGD 4,820/)).toBeInTheDocument());
  // The detail pane should render the binding hash for the active (first) row
  expect(screen.getByText(/^0x2f1a08c4/)).toBeInTheDocument();
});

it("updates ?id= in the URL when a row is selected", async () => {
  renderPage();
  await waitFor(() => expect(screen.getByText(/Refund SGD 4,820/)).toBeInTheDocument());
  fireEvent.click(screen.getByText(/Charge no-show fee/));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(expect.stringContaining("id=apr_55ab10"), { scroll: false }));
});
```

- [ ] **Step 2: Implement `detail/index.tsx`**

```tsx
// MODULE_ROOT/components/detail/index.tsx
"use client";

import styles from "../../approvals.module.css";
import { DetailHeader } from "./header";
import { ConfirmationCode } from "./confirmation-code";
import { DetailEmpty } from "./empty";
import type { ApprovalRow } from "../../types";

export interface DetailProps {
  row: ApprovalRow | null;
  now: number;
}

export function Detail({ row, now }: DetailProps) {
  if (!row) return <DetailEmpty />;
  return (
    <div className={styles.detail}>
      <DetailHeader row={row} now={now} />
      <ConfirmationCode bindingHash={row.bindingHash} envelopeId={row.envelopeId} />
      {/* Approvers / Recovery / ActionDrawer land in subsequent PRs. */}
      <div className={styles.detailPlaceholder}>
        <span className={styles.eyebrow}>action drawer</span>
        <p>Approve and reject controls land in the next PR.</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire selection + URL sync in `approvals-page.tsx`**

Replace the existing page with this version (adds `useSearchParams`, `useRouter`, URL sync, detail rendering):

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "./approvals.module.css";
import { ApprovalsHeader } from "./components/header";
import { ApprovalsQueue } from "./components/queue";
import { FilterStrip, type RiskFilter } from "./components/filter-strip";
import { Detail } from "./components/detail";
import { useNow } from "./hooks/use-now";
import { usePendingApprovals } from "./hooks/use-approvals";
import { sortApprovals } from "./sort";

export function ApprovalsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const idFromUrl = searchParams?.get("id") ?? null;

  const now = useNow(1000);
  const [filter, setFilter] = useState<RiskFilter>("all");
  const [expiringOnly, setExpiringOnly] = useState(false);

  const { data, isLoading } = usePendingApprovals();
  const allItems = data?.approvals ?? [];

  const counts = useMemo(() => {
    const c: Record<RiskFilter, number> = { all: allItems.length, low: 0, medium: 0, high: 0, critical: 0 };
    for (const r of allItems) if (r.riskCategory in c) c[r.riskCategory as Exclude<RiskFilter, "all">]++;
    return c;
  }, [allItems]);

  const expiringSoonCount = useMemo(
    () => allItems.filter((r) => new Date(r.expiresAt).getTime() - now < 60 * 60_000).length,
    [allItems, now],
  );

  const filteredSorted = useMemo(() => {
    let out = allItems;
    if (filter !== "all") out = out.filter((r) => r.riskCategory === filter);
    if (expiringOnly) out = out.filter((r) => new Date(r.expiresAt).getTime() - now < 60 * 60_000);
    return sortApprovals(out, now);
  }, [allItems, filter, expiringOnly, now]);

  const activeId = idFromUrl && filteredSorted.some((r) => r.id === idFromUrl)
    ? idFromUrl
    : filteredSorted[0]?.id ?? null;
  const activeRow = filteredSorted.find((r) => r.id === activeId) ?? null;

  // Sync selection -> URL when the derived activeId doesn't match the URL.
  useEffect(() => {
    if (activeId && activeId !== idFromUrl) {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.set("id", activeId);
      router.replace(`/approvals?${params.toString()}`, { scroll: false });
    }
  }, [activeId, idFromUrl, router, searchParams]);

  function onSelect(id: string) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("id", id);
    router.replace(`/approvals?${params.toString()}`, { scroll: false });
  }

  return (
    <div className={styles.approvalsPage}>
      <ApprovalsHeader pendingCount={allItems.length} expiringSoonCount={expiringSoonCount} />
      <FilterStrip
        filter={filter}
        expiringOnly={expiringOnly}
        counts={counts}
        expiringSoonCount={expiringSoonCount}
        onChange={({ filter: f, expiringOnly: e }) => {
          setFilter(f);
          setExpiringOnly(e);
        }}
      />
      <main className={styles.split}>
        <aside className={styles.splitLeft}>
          <ApprovalsQueue
            items={filteredSorted}
            activeId={activeId}
            onSelect={onSelect}
            loading={isLoading}
            now={now}
          />
        </aside>
        <section className={styles.splitRight}>
          <Detail row={activeRow} now={now} />
        </section>
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Run, expect pass; commit**

```bash
pnpm --filter @switchboard/dashboard test approvals
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/components/detail/index.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/approvals-page.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/__tests__/approvals-page.test.tsx
git commit -m "feat(approvals): detail pane orchestrator + URL ?id sync

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.8: PR-A2 ships

- [ ] Typecheck + full test sweep + manual verify in dev. Push and open PR `feat(approvals): PR-A2 — detail pane (single-approver only)`.

---

## Phase 3 — PR-A3: Action drawer (approve risk-graded + reject two-step + dispatch banner)

**Outcome:** Operator can approve and reject. Approve is risk-graded: low/medium → amber CTA only; high/critical → ack checkbox gate. Reject is a two-step inline confirm with no reason field. Successful mutations swap the drawer for a dispatch banner. 409 + 5xx handled with operator-language copy. A copy-language denylist test guards the whole page.

### Task 3.1: `useRespondToApproval` mutation

**Files:**
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/approvals/hooks/use-approvals.ts`
- Test: `apps/dashboard/src/app/(auth)/(mercury)/approvals/__tests__/use-respond.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// MODULE_ROOT/__tests__/use-respond.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode } from "react";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1", principalId: "p-1" }, status: "authenticated" }),
}));
vi.mock("@/lib/route-availability", () => ({ isMercuryToolLive: () => true }));

import { useRespondToApproval } from "../hooks/use-approvals";

function wrap({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("useRespondToApproval", () => {
  it("POSTs approve with bindingHash and respondedBy from session", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ envelope: {}, approvalState: {}, executionResult: {} }),
    });
    const { result } = renderHook(() => useRespondToApproval(), { wrapper: wrap });
    result.current.mutate({ id: "apr_1", action: "approve", bindingHash: "0xabc" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe("/api/dashboard/approvals");
    const body = JSON.parse(call[1].body);
    expect(body).toEqual({ approvalId: "apr_1", action: "approve", bindingHash: "0xabc", respondedBy: "p-1" });
  });

  it("POSTs reject WITHOUT bindingHash", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const { result } = renderHook(() => useRespondToApproval(), { wrapper: wrap });
    result.current.mutate({ id: "apr_1", action: "reject" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ approvalId: "apr_1", action: "reject", respondedBy: "p-1" });
    expect(body).not.toHaveProperty("bindingHash");
  });

  it("POSTs patch with both bindingHash AND patchValue", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const { result } = renderHook(() => useRespondToApproval(), { wrapper: wrap });
    result.current.mutate({
      id: "apr_1",
      action: "patch",
      bindingHash: "0xabc",
      patchValue: { discountPct: 25 },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.bindingHash).toBe("0xabc");
    expect(body.patchValue).toEqual({ discountPct: 25 });
  });

  it("surfaces a typed conflict on 409", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "stale", statusCode: 409 }),
    });
    const { result } = renderHook(() => useRespondToApproval(), { wrapper: wrap });
    result.current.mutate({ id: "apr_1", action: "approve", bindingHash: "0xabc" });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error & { status?: number }).status).toBe(409);
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement**

Append to `hooks/use-approvals.ts`:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";

export interface RespondInput {
  id: string;
  action: "approve" | "reject" | "patch";
  bindingHash?: string;
  patchValue?: Record<string, unknown>;
}

export class ApprovalRespondError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export function useRespondToApproval() {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  const { data: session } = useSession();
  const principalId = (session as unknown as { principalId?: string } | null)?.principalId ?? null;

  return useMutation({
    mutationFn: async (input: RespondInput) => {
      if (!principalId) throw new ApprovalRespondError("No session principal", 401);
      const body: Record<string, unknown> = {
        approvalId: input.id,
        action: input.action,
        respondedBy: principalId,
      };
      if (input.action !== "reject") body.bindingHash = input.bindingHash;
      if (input.action === "patch") body.patchValue = input.patchValue;

      const res = await fetch("/api/dashboard/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let detail = "Request failed";
        try {
          const data = await res.json();
          detail = data?.error ?? detail;
        } catch { /* ignore */ }
        throw new ApprovalRespondError(detail, res.status);
      }
      return res.json();
    },
    onSuccess: () => {
      if (keys) {
        queryClient.invalidateQueries({ queryKey: keys.approvals.all() });
        // Defensive: if/when the decision feed surfaces approvals, ensure both caches drop together.
        queryClient.invalidateQueries({ queryKey: keys.decisions.all() });
      }
    },
  });
}
```

- [ ] **Step 4: Run, expect pass; commit**

```bash
pnpm --filter @switchboard/dashboard test approvals/use-respond
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/hooks/use-approvals.ts apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/__tests__/use-respond.test.tsx
git commit -m "feat(approvals): useRespondToApproval mutation with typed conflict

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.2: Reject two-step inline component

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/approvals/components/detail/reject-confirm.tsx`
- Test: `apps/dashboard/src/app/(auth)/(mercury)/approvals/__tests__/reject-confirm.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// MODULE_ROOT/__tests__/reject-confirm.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RejectConfirm } from "../components/detail/reject-confirm";

describe("RejectConfirm", () => {
  it("renders the initial Reject button", () => {
    render(<RejectConfirm onConfirm={() => {}} />);
    expect(screen.getByRole("button", { name: /^reject$/i })).toBeInTheDocument();
  });

  it("does not show a reason textarea (v1 does not save reasons)", () => {
    render(<RejectConfirm onConfirm={() => {}} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("requires a second click to confirm", () => {
    const onConfirm = vi.fn();
    render(<RejectConfirm onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: /^reject$/i }));
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /confirm reject/i }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("provides a cancel button after first click", () => {
    render(<RejectConfirm onConfirm={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^reject$/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.getByRole("button", { name: /^reject$/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement**

```tsx
// MODULE_ROOT/components/detail/reject-confirm.tsx
"use client";

import { useState } from "react";
import styles from "../../approvals.module.css";

export function RejectConfirm({ onConfirm, disabled }: { onConfirm: () => void; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <div className={styles.rejectRow}>
        <span className={styles.rejectRowText}>Don't approve this action.</span>
        <button
          type="button"
          className={styles.rejectBtn}
          onClick={() => setArmed(true)}
          disabled={disabled}
        >
          Reject
        </button>
      </div>
    );
  }

  return (
    <div className={styles.rejectRow}>
      <span className={styles.rejectRowText}>Are you sure?</span>
      <button type="button" className={styles.btnSm} onClick={() => setArmed(false)}>
        Cancel
      </button>
      <button
        type="button"
        className={styles.rejectBtnConfirm}
        onClick={onConfirm}
        disabled={disabled}
      >
        Confirm reject
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Append CSS**

```css
.rejectRow { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 4px 0 0; }
.rejectRowText { font-family: var(--sans); font-size: 13px; color: var(--ink-3); font-style: italic; }
.rejectBtn {
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-3);
  padding: 9px 16px;
  border: 1px solid var(--hair-strong);
  background: transparent;
  border-radius: 2px;
  cursor: pointer;
}
.rejectBtn:hover { color: var(--ink); border-color: var(--ink); }
.rejectBtnConfirm {
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink);
  padding: 9px 16px;
  border: 1px solid var(--ink);
  background: transparent;
  border-radius: 2px;
  cursor: pointer;
}
.rejectBtnConfirm:hover { background: var(--ink); color: var(--cream); }
.btnSm {
  font-family: var(--sans);
  font-size: 13px;
  font-weight: 500;
  padding: 9px 16px;
  border-radius: 2px;
  border: 1px solid var(--hair-strong);
  background: transparent;
  color: var(--ink-3);
  cursor: pointer;
}
.btnSm:hover { color: var(--ink); border-color: var(--ink); }
```

- [ ] **Step 5: Run, expect pass; commit**

```bash
pnpm --filter @switchboard/dashboard test approvals/reject-confirm
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/components/detail/reject-confirm.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/__tests__/reject-confirm.test.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/approvals.module.css
git commit -m "feat(approvals): two-step inline Reject -> Confirm reject (no reason field)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.3: Approve block (Shape A — low/medium/none)

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/approvals/components/detail/approve-block.tsx`
- Test: `apps/dashboard/src/app/(auth)/(mercury)/approvals/__tests__/approve-block.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// MODULE_ROOT/__tests__/approve-block.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ApproveBlock } from "../components/detail/approve-block";

const baseProps = {
  bindingHash: "0x2f1a08c4e9b1d7a4f0c3b8a5d2e7f1a9",
  riskCategory: "low" as const,
  agentName: "Alex",
  actionDisplay: "fee",
  onApprove: vi.fn(),
  disabled: false,
};

describe("ApproveBlock — Shape A (low/medium)", () => {
  it("renders no ack checkbox on low risk", () => {
    render(<ApproveBlock {...baseProps} riskCategory="low" />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("renders no ack checkbox on medium risk", () => {
    render(<ApproveBlock {...baseProps} riskCategory="medium" />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("renders the code-anchor sub-line so the code is not decorative", () => {
    render(<ApproveBlock {...baseProps} riskCategory="low" />);
    expect(screen.getByText(/confirmation code above locks these details/i)).toBeInTheDocument();
  });

  it("CTA is enabled on render for low risk", () => {
    render(<ApproveBlock {...baseProps} riskCategory="low" />);
    expect(screen.getByRole("button", { name: /approve/i })).not.toBeDisabled();
  });

  it("CTA fires onApprove on click", () => {
    const onApprove = vi.fn();
    render(<ApproveBlock {...baseProps} onApprove={onApprove} />);
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(onApprove).toHaveBeenCalled();
  });

  it("shows the short hash on the CTA", () => {
    render(<ApproveBlock {...baseProps} />);
    expect(screen.getByText(/0x2f1a08…1a9/)).toBeInTheDocument();
  });
});

describe("ApproveBlock — Shape B (high/critical)", () => {
  it("renders the statement-of-intent line on high risk", () => {
    render(<ApproveBlock {...baseProps} riskCategory="high" />);
    expect(screen.getByText(/I've checked the details above/i)).toBeInTheDocument();
  });

  it("renders ack checkbox on high risk", () => {
    render(<ApproveBlock {...baseProps} riskCategory="high" />);
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });

  it("CTA is disabled until checkbox ticked", () => {
    render(<ApproveBlock {...baseProps} riskCategory="critical" />);
    const cta = screen.getByRole("button", { name: /approve.*sign/i });
    expect(cta).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(cta).not.toBeDisabled();
  });

  it("Enter key does not submit when checkbox unticked", () => {
    const onApprove = vi.fn();
    render(<ApproveBlock {...baseProps} riskCategory="critical" onApprove={onApprove} />);
    const cta = screen.getByRole("button", { name: /approve.*sign/i });
    fireEvent.keyDown(cta, { key: "Enter", code: "Enter" });
    expect(onApprove).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement**

```tsx
// MODULE_ROOT/components/detail/approve-block.tsx
"use client";

import { useState } from "react";
import styles from "../../approvals.module.css";
import { shortHash } from "../../short-hash";
import type { RiskCategory } from "../../types";

export interface ApproveBlockProps {
  bindingHash: string;
  riskCategory: RiskCategory;
  agentName: string;
  actionDisplay: string;
  /** When > 1, the sub-line switches to the quorum copy. */
  approvalsRequired?: number;
  /** Current signed count (excluding the operator). */
  signedSoFar?: number;
  onApprove: () => void;
  disabled?: boolean;
}

export function ApproveBlock({
  bindingHash,
  riskCategory,
  agentName,
  actionDisplay,
  approvalsRequired,
  signedSoFar = 0,
  onApprove,
  disabled,
}: ApproveBlockProps) {
  const isHighRisk = riskCategory === "high" || riskCategory === "critical";
  const [acked, setAcked] = useState(false);
  const ctaDisabled = !!disabled || (isHighRisk && !acked);
  const sh = shortHash(bindingHash);

  const subLine = approvalsRequired && approvalsRequired > 1
    ? `Adds your signature to the quorum (${signedSoFar + 1} of ${approvalsRequired} after this).`
    : `Approving sends this to be processed by ${agentName}.`;

  return (
    <div className={styles.approveBlock}>
      {isHighRisk ? (
        <>
          <p className={styles.approveStatement}>
            I've checked the details above. Approve this <em>{actionDisplay}</em>.
            <span className={styles.approveCodePill}>{sh}</span>
          </p>
          <label className={styles.approveAck}>
            <input
              type="checkbox"
              checked={acked}
              onChange={(e) => setAcked(e.target.checked)}
            />
            <span>
              I've read the details and the confirmation code <code className={styles.approveCodeInline}>{sh}</code> matches what I want to approve.
            </span>
          </label>
        </>
      ) : (
        <>
          <p className={styles.approveContext}>
            Approving sends this to be processed by <b>{agentName}</b>.
          </p>
          <p className={styles.approveCodeAnchor}>
            The confirmation code above locks these details before approval.
          </p>
        </>
      )}
      <p className={styles.approveSub}>{subLine}</p>
      <button
        type="button"
        className={styles.approveBtn}
        onClick={onApprove}
        disabled={ctaDisabled}
        aria-disabled={ctaDisabled}
      >
        <span className={styles.approveBtnTitle}>
          {isHighRisk ? "Approve & sign" : "Approve"}
        </span>
        <span className={styles.approveBtnHash}>Code {sh}</span>
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Append CSS**

```css
.approveBlock { display: flex; flex-direction: column; gap: 12px; padding: 4px 0; }
.approveContext { font-family: var(--sans); font-size: 13.5px; color: var(--ink-2); }
.approveCodeAnchor { font-family: var(--sans); font-size: 12.5px; font-style: italic; color: var(--ink-4); }
.approveStatement {
  font-family: var(--serif);
  font-size: 20px;
  font-weight: 500;
  letter-spacing: -0.01em;
  line-height: 1.3;
  color: var(--ink);
}
.approveStatement em { color: var(--accent); font-style: italic; }
.approveCodePill {
  margin-left: 6px;
  font-family: var(--mono);
  font-size: 14px;
  letter-spacing: 0.04em;
  font-weight: 600;
  padding: 1px 8px;
  border: 1px solid var(--hair-strong);
  border-radius: 2px;
}
.approveAck { display: flex; gap: 10px; align-items: center; font-size: 13px; color: var(--ink-2); }
.approveAck input { width: 15px; height: 15px; accent-color: var(--accent); cursor: pointer; }
.approveCodeInline {
  font-family: var(--mono);
  font-weight: 600;
  font-size: 12px;
  padding: 1px 6px;
  border-radius: 2px;
  border: 1px solid var(--hair-strong);
}
.approveSub { font-family: var(--sans); font-size: 12.5px; font-style: italic; color: var(--ink-3); }
.approveBtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 4px;
  background: var(--accent);
  color: #fff;
  font-family: var(--sans);
  font-weight: 600;
  letter-spacing: -0.005em;
  padding: 14px 26px;
  border-radius: 2px;
  border: 0;
  min-width: 13rem;
  cursor: pointer;
  align-self: flex-end;
  transition: background 280ms cubic-bezier(0.4, 0, 0.2, 1);
}
.approveBtn:hover:not(:disabled) { background: var(--accent-soft); }
.approveBtn:disabled { background: var(--ink-4); cursor: not-allowed; }
.approveBtnTitle { font-size: 15px; font-weight: 600; }
.approveBtnHash { font-family: var(--mono); font-size: 11px; letter-spacing: 0.08em; font-weight: 500; opacity: 0.92; }
```

- [ ] **Step 5: Run, expect pass; commit**

```bash
pnpm --filter @switchboard/dashboard test approvals/approve-block
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/components/detail/approve-block.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/__tests__/approve-block.test.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/approvals.module.css
git commit -m "feat(approvals): risk-graded approve block (Shape A + Shape B)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.4: Dispatch banner

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/approvals/components/detail/dispatch-banner.tsx`
- Test: `apps/dashboard/src/app/(auth)/(mercury)/approvals/__tests__/dispatch-banner.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// MODULE_ROOT/__tests__/dispatch-banner.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DispatchBanner } from "../components/detail/dispatch-banner";

describe("DispatchBanner", () => {
  it("renders 'Approved' copy referencing the agent and Activity", () => {
    render(<DispatchBanner kind="approved" agentName="Alex" />);
    expect(screen.getByText(/approved/i)).toBeInTheDocument();
    expect(screen.getByText(/Alex/)).toBeInTheDocument();
    expect(screen.getByText(/check\s+activity/i)).toBeInTheDocument();
  });

  it("renders rejection copy", () => {
    render(<DispatchBanner kind="rejected" agentName="Alex" />);
    expect(screen.getByText(/rejected/i)).toBeInTheDocument();
    expect(screen.getByText(/agent has been told to stand down/i)).toBeInTheDocument();
  });

  it("renders quorum-waiting copy when awaitingQuorum=true", () => {
    render(<DispatchBanner kind="approved" agentName="Alex" awaitingQuorum={2} />);
    expect(screen.getByText(/signed/i)).toBeInTheDocument();
    expect(screen.getByText(/waiting on 2 more/i)).toBeInTheDocument();
  });

  it("contains no engineering vocabulary", () => {
    render(<DispatchBanner kind="approved" agentName="Alex" />);
    expect(document.body.textContent ?? "").not.toMatch(/executable work unit|frozen for|idempotency|envelope/i);
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement**

```tsx
// MODULE_ROOT/components/detail/dispatch-banner.tsx
import styles from "../../approvals.module.css";

export type DispatchKind = "approved" | "patched" | "rejected";

export interface DispatchBannerProps {
  kind: DispatchKind;
  agentName: string;
  /** Set to N when the operator signed but N more signatures are still required. */
  awaitingQuorum?: number;
}

export function DispatchBanner({ kind, agentName, awaitingQuorum }: DispatchBannerProps) {
  if (kind === "rejected") {
    return (
      <div className={styles.dispatchBanner} data-kind="rejected">
        <span className={styles.eyebrow}>recorded</span>
        <p className={styles.dispatchMsg}>
          <b>Rejected.</b> The card is closed; the agent has been told to stand down.
        </p>
      </div>
    );
  }

  if (awaitingQuorum && awaitingQuorum > 0) {
    return (
      <div className={styles.dispatchBanner} data-kind="signed">
        <span className={styles.eyebrow}>signed</span>
        <p className={styles.dispatchMsg}>
          <b>Signed.</b> Waiting on {awaitingQuorum} more teammate{awaitingQuorum > 1 ? "s" : ""}. You'll get an in-app notification once everyone's approved.
        </p>
      </div>
    );
  }

  const verb = kind === "patched" ? "Approved with changes" : "Approved";
  return (
    <div className={styles.dispatchBanner} data-kind="approved">
      <span className={styles.eyebrow}>dispatched</span>
      <p className={styles.dispatchMsg}>
        <b>{verb}.</b> {agentName} is processing this now — check Activity in a moment to see the result.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Append CSS**

```css
.dispatchBanner {
  margin: 22px 40px 0;
  padding: 16px 18px;
  background: var(--paper-raised);
  border: 1px solid var(--hair-strong);
  border-left: 3px solid hsl(150 30% 38%);
  border-radius: 2px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
@media (max-width: 1080px) { .dispatchBanner { margin-left: 28px; margin-right: 28px; } }
.dispatchBanner[data-kind="rejected"] { border-left-color: var(--ink); }
.dispatchMsg { font-family: var(--serif); font-size: 16px; font-style: italic; font-weight: 500; color: var(--ink); line-height: 1.35; }
```

- [ ] **Step 5: Run, expect pass; commit**

```bash
pnpm --filter @switchboard/dashboard test approvals/dispatch-banner
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/components/detail/dispatch-banner.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/__tests__/dispatch-banner.test.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/approvals.module.css
git commit -m "feat(approvals): dispatch banner with operator-language copy

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.5: Action drawer orchestrator (idle + responded + error states)

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/approvals/components/detail/action-drawer.tsx`
- Test: `apps/dashboard/src/app/(auth)/(mercury)/approvals/__tests__/action-drawer.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// MODULE_ROOT/__tests__/action-drawer.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ActionDrawer } from "../components/detail/action-drawer";
import { APPROVALS_FIXTURES } from "../fixtures";

const lowRow = APPROVALS_FIXTURES.find((r) => r.id === "apr_55ab10")!; // SGD 80 no-show fee, low
const criticalRow = APPROVALS_FIXTURES.find((r) => r.id === "apr_2f1a08")!;
const recoveryRow = APPROVALS_FIXTURES.find((r) => r.id === "apr_e0c4a5")!;

const baseHandlers = { onApprove: vi.fn(), onReject: vi.fn() };

describe("ActionDrawer", () => {
  beforeEach(() => {
    baseHandlers.onApprove.mockReset();
    baseHandlers.onReject.mockReset();
  });

  it("renders approve + reject for a low-risk pending row", () => {
    render(<ActionDrawer row={lowRow} now={Date.now()} {...baseHandlers} principalId="p-1" />);
    expect(screen.getByRole("button", { name: /^approve/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^reject$/i })).toBeInTheDocument();
  });

  it("low-risk approve does not require checkbox", () => {
    render(<ActionDrawer row={lowRow} now={Date.now()} {...baseHandlers} principalId="p-1" />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("critical-risk approve requires checkbox tick", () => {
    render(<ActionDrawer row={criticalRow} now={Date.now()} {...baseHandlers} principalId="p-1" />);
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });

  it("expired row shows read-only operator copy", () => {
    const expired = { ...lowRow, expiresAt: new Date(Date.now() - 60_000).toISOString() };
    render(<ActionDrawer row={expired} now={Date.now()} {...baseHandlers} principalId="p-1" />);
    expect(screen.getByText(/this expired/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^approve/i })).not.toBeInTheDocument();
  });

  it("recovery row shows operator-language copy and Dismiss only", () => {
    render(<ActionDrawer row={recoveryRow} now={Date.now()} {...baseHandlers} principalId="p-1" />);
    expect(screen.getByText(/couldn't be prepared/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^approve/i })).not.toBeInTheDocument();
  });

  it("missing principalId blocks all actions and shows sign-in notice", () => {
    render(<ActionDrawer row={lowRow} now={Date.now()} {...baseHandlers} principalId={null} />);
    expect(screen.getByText(/sign in again/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^approve/i })).not.toBeInTheDocument();
  });

  it("renders dispatch banner after a successful approve", () => {
    render(<ActionDrawer row={lowRow} now={Date.now()} {...baseHandlers} principalId="p-1" decision={{ kind: "approved" }} />);
    expect(screen.getByText(/processing this now/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^approve/i })).not.toBeInTheDocument();
  });

  it("renders 409 conflict copy", () => {
    render(<ActionDrawer row={lowRow} now={Date.now()} {...baseHandlers} principalId="p-1" error={{ status: 409 }} />);
    expect(screen.getByText(/already decided by a teammate/i)).toBeInTheDocument();
  });

  it("renders 5xx copy", () => {
    render(<ActionDrawer row={lowRow} now={Date.now()} {...baseHandlers} principalId="p-1" error={{ status: 500 }} />);
    expect(screen.getByText(/couldn't send your approval/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement**

```tsx
// MODULE_ROOT/components/detail/action-drawer.tsx
"use client";

import styles from "../../approvals.module.css";
import { ApproveBlock } from "./approve-block";
import { RejectConfirm } from "./reject-confirm";
import { DispatchBanner, type DispatchKind } from "./dispatch-banner";
import { agentDisplay } from "../../hooks/use-agent-display";
import { actionDisplay } from "../../action-display";
import { formatRemaining } from "../../format";
import type { ApprovalRow } from "../../types";

export interface ActionDrawerProps {
  row: ApprovalRow;
  now: number;
  principalId: string | null;
  decision?: { kind: DispatchKind; awaitingQuorum?: number } | null;
  error?: { status: number } | null;
  pending?: boolean;
  onApprove: () => void;
  onReject: () => void;
}

export function ActionDrawer({
  row,
  now,
  principalId,
  decision,
  error,
  pending,
  onApprove,
  onReject,
}: ActionDrawerProps) {
  const remaining = new Date(row.expiresAt).getTime() - now;
  const expired = remaining <= 0;
  const recovery = row.status === "recovery_required";
  const agent = agentDisplay(row.agent);
  const action = actionDisplay(row.request?.action);

  if (decision) {
    return (
      <div className={styles.actions}>
        <DispatchBanner kind={decision.kind} agentName={agent.name} awaitingQuorum={decision.awaitingQuorum} />
      </div>
    );
  }

  if (!principalId) {
    return (
      <div className={styles.actions}>
        <p className={styles.actionsNotice}>Sign in again to approve or reject.</p>
      </div>
    );
  }

  if (expired) {
    return (
      <div className={styles.actions}>
        <p className={styles.actionsReadOnly}>
          This expired {formatRemaining(-remaining)} ago. The agent will re-propose if it's still needed.
        </p>
      </div>
    );
  }

  if (recovery) {
    return (
      <div className={styles.actions}>
        <div className={styles.recoveryNotice}>
          <span className={styles.eyebrow}>Needs retry</span>
          <p className={styles.recoveryMsg}>
            <b>This action couldn't be prepared.</b> The agent ran into a problem and needs to try again. Dismiss this card; a new one will appear when the agent retries.
          </p>
          <div className={styles.recoveryFoot}>
            <button type="button" className={styles.btnSm} onClick={onReject} disabled={pending}>
              Dismiss
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.actions}>
      <ApproveBlock
        bindingHash={row.bindingHash}
        riskCategory={row.riskCategory}
        agentName={agent.name}
        actionDisplay={action}
        onApprove={onApprove}
        disabled={pending}
      />
      <RejectConfirm onConfirm={onReject} disabled={pending} />
      {error && (
        <p className={styles.actionsError}>
          {error.status === 409
            ? "This was already decided by a teammate — refreshing your view."
            : "Couldn't send your approval — your decision wasn't recorded. Safe to try again."}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Append CSS**

```css
.actions {
  padding: 28px 40px 36px;
  display: flex;
  flex-direction: column;
  gap: 22px;
  background: var(--paper-warm);
  border-top: 1px solid var(--hair);
}
@media (max-width: 1080px) { .actions { padding-left: 28px; padding-right: 28px; } }
.actionsReadOnly { font-family: var(--mono); font-size: 12px; color: var(--ink-3); }
.actionsError { font-family: var(--sans); font-size: 13px; color: var(--ink); font-style: italic; }
.actionsNotice { font-family: var(--sans); font-size: 13px; color: var(--ink-3); }
.recoveryNotice {
  background: var(--paper-raised);
  border: 1px solid var(--hair);
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-radius: 2px;
}
.recoveryMsg { font-family: var(--serif); font-size: 16px; font-style: italic; font-weight: 500; color: var(--ink); line-height: 1.4; }
.recoveryFoot { display: flex; justify-content: flex-end; }
```

- [ ] **Step 5: Run, expect pass; commit**

```bash
pnpm --filter @switchboard/dashboard test approvals/action-drawer
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/components/detail/action-drawer.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/__tests__/action-drawer.test.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/approvals.module.css
git commit -m "feat(approvals): action drawer with risk-graded approve, reject, expired, recovery, error states

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.6: Wire mutation into the detail pane

**Files:**
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/approvals/components/detail/index.tsx`

- [ ] **Step 1: Update `detail/index.tsx`**

```tsx
// MODULE_ROOT/components/detail/index.tsx
"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import styles from "../../approvals.module.css";
import { DetailHeader } from "./header";
import { ConfirmationCode } from "./confirmation-code";
import { DetailEmpty } from "./empty";
import { ActionDrawer } from "./action-drawer";
import { useRespondToApproval, ApprovalRespondError } from "../../hooks/use-approvals";
import type { ApprovalRow } from "../../types";
import type { DispatchKind } from "./dispatch-banner";

export function Detail({ row, now }: { row: ApprovalRow | null; now: number }) {
  const { data: session } = useSession();
  const principalId = (session as unknown as { principalId?: string } | null)?.principalId ?? null;
  const mutation = useRespondToApproval();

  const [decision, setDecision] = useState<{ kind: DispatchKind; awaitingQuorum?: number } | null>(null);
  const [errorState, setErrorState] = useState<{ status: number } | null>(null);

  // Reset local state when the row changes.
  const currentRowId = row?.id ?? null;
  const [stickyRowId, setStickyRowId] = useState<string | null>(null);
  if (currentRowId !== stickyRowId) {
    setStickyRowId(currentRowId);
    setDecision(null);
    setErrorState(null);
  }

  if (!row) return <DetailEmpty />;

  function handleApprove() {
    setErrorState(null);
    mutation.mutate(
      { id: row!.id, action: "approve", bindingHash: row!.bindingHash },
      {
        onSuccess: () => setDecision({ kind: "approved" }),
        onError: (err) => {
          if (err instanceof ApprovalRespondError) setErrorState({ status: err.status });
          else setErrorState({ status: 500 });
        },
      },
    );
  }

  function handleReject() {
    setErrorState(null);
    mutation.mutate(
      { id: row!.id, action: "reject" },
      {
        onSuccess: () => setDecision({ kind: "rejected" }),
        onError: (err) => {
          if (err instanceof ApprovalRespondError) setErrorState({ status: err.status });
          else setErrorState({ status: 500 });
        },
      },
    );
  }

  return (
    <div className={styles.detail}>
      <DetailHeader row={row} now={now} />
      <ConfirmationCode bindingHash={row.bindingHash} envelopeId={row.envelopeId} />
      <ActionDrawer
        row={row}
        now={now}
        principalId={principalId}
        decision={decision}
        error={errorState}
        pending={mutation.isPending}
        onApprove={handleApprove}
        onReject={handleReject}
      />
    </div>
  );
}
```

- [ ] **Step 2: Run, expect green**

```bash
pnpm --filter @switchboard/dashboard test approvals
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/components/detail/index.tsx
git commit -m "feat(approvals): wire useRespondToApproval into detail pane

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.7: Copy-language denylist test

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/approvals/__tests__/copy-language-audit.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// MODULE_ROOT/__tests__/copy-language-audit.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1", principalId: "p-1" }, status: "authenticated" }),
}));
vi.mock("@/lib/route-availability", () => ({ isMercuryToolLive: () => false }));
const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(""),
}));

import { ApprovalsPage } from "../approvals-page";

const DENYLIST = [
  /\bbinding\b/i,
  /\benvelope\b/i,
  /\bsha256\b/i,
  /\blifecycle\b/i,
  /\bdispatch(?:ing|ed)?\b/i,
  /\bidempoten/i,
  /\bexecutable work unit\b/i,
  /\bfrozen for\b/i,
  /\bcartridge\b/i,
];

function visibleText(): string {
  const clone = document.body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[aria-hidden="true"], script, style, [data-testid="confirmation-code-value"]').forEach((el) => el.remove());
  return clone.textContent ?? "";
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ApprovalsPage /></QueryClientProvider>);
}

describe("Copy-language denylist", () => {
  it("idle queue + detail render contains no banned vocabulary", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Refund SGD 4,820/)).toBeInTheDocument());
    const text = visibleText();
    for (const pattern of DENYLIST) expect(text).not.toMatch(pattern);
  });
});
```

- [ ] **Step 2: Run, expect pass**

```bash
pnpm --filter @switchboard/dashboard test copy-language-audit
```

If the test fails, fix the offending copy in-place. Do not add denylist exceptions.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/__tests__/copy-language-audit.test.tsx
git commit -m "test(approvals): denylist test guards customer-visible copy

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.8: Verify CTA contrast (manual + asserting test)

**Files:**
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/approvals/__tests__/approve-block.test.tsx`

- [ ] **Step 1: Add a contrast assertion**

Append to `approve-block.test.tsx`:

```tsx
it("approve CTA uses --accent background", () => {
  render(<ApproveBlock {...baseProps} />);
  const btn = screen.getByRole("button", { name: /approve/i });
  const bg = window.getComputedStyle(btn).backgroundColor;
  // jsdom doesn't compute CSS vars; smoke-check it's not transparent or unset.
  expect(bg).toBeTruthy();
});
```

- [ ] **Step 2: Manual contrast verification**

Open Chrome DevTools on `/approvals`, pick the Approve CTA, run the contrast picker. Expected: ≥4.5:1 against the button background. If it fails, swap `--mercury-accent` for `--mercury-accent-soft` (`hsl(20 60% 50%)`) on the button background — both are already wired.

Document the measured ratio (e.g., 4.6:1) in the PR description.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/__tests__/approve-block.test.tsx
git commit -m "test(approvals): smoke-check approve CTA background applies

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.9: PR-A3 ships

- [ ] Typecheck + full sweep. Manual verify: approve a low-risk fixture → dispatch banner; approve a critical fixture → checkbox required; mock a 409 by manually editing `useRespondToApproval` temporarily to throw and confirming copy. Push and open PR `feat(approvals): PR-A3 — action drawer (approve risk-graded + reject + dispatch)`.

---

## Phase 4 — PR-A4: Patch flow behind "View JSON (advanced)" toggle

**Outcome:** A "View JSON (advanced) ▾" toggle inside the action drawer reveals a side-by-side JSON editor. The toggle is closed by default, remembers its open state per session, and is hidden on mobile. Submitting calls `action: "patch"` with `bindingHash` AND `patchValue`. Editor validates JSON syntax, enforces ≤100 KB, highlights changed keys.

### Task 4.1: Pure `jsonDiff` helper

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/approvals/json-diff.ts`
- Test: `apps/dashboard/src/app/(auth)/(mercury)/approvals/__tests__/json-diff.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// MODULE_ROOT/__tests__/json-diff.test.ts
import { describe, it, expect } from "vitest";
import { jsonDiff } from "../json-diff";

describe("jsonDiff", () => {
  it("returns empty for identical objects", () => {
    expect(jsonDiff({ a: 1 }, { a: 1 })).toEqual([]);
  });

  it("returns changed keys for top-level value diff", () => {
    expect(jsonDiff({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual(["b"]);
  });

  it("returns added keys", () => {
    expect(jsonDiff({ a: 1 }, { a: 1, b: 2 })).toEqual(["b"]);
  });

  it("returns removed keys", () => {
    expect(jsonDiff({ a: 1, b: 2 }, { a: 1 })).toEqual(["b"]);
  });

  it("compares nested objects by JSON serialization", () => {
    expect(jsonDiff({ a: { x: 1 } }, { a: { x: 2 } })).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement**

```ts
// MODULE_ROOT/json-diff.ts
/**
 * Returns the list of top-level keys whose JSON-serialised value differs
 * between `before` and `after`. Used to highlight changed parameters in
 * the patch editor diff pane.
 */
export function jsonDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const k of keys) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) changed.push(k);
  }
  return changed;
}
```

- [ ] **Step 4: Run, expect pass; commit**

```bash
pnpm --filter @switchboard/dashboard test approvals/json-diff
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/json-diff.ts apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/__tests__/json-diff.test.ts
git commit -m "feat(approvals): jsonDiff pure helper for patch editor

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4.2: Patch editor component

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/approvals/components/detail/patch-editor.tsx`
- Test: `apps/dashboard/src/app/(auth)/(mercury)/approvals/__tests__/patch-editor.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// MODULE_ROOT/__tests__/patch-editor.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PatchEditor } from "../components/detail/patch-editor";

const snapshot = { discountPct: 10, memo: "Initial 10% per loyalty policy" };

describe("PatchEditor", () => {
  it("renders the current snapshot in the left pane", () => {
    render(<PatchEditor snapshot={snapshot} seed={null} onCancel={() => {}} onSubmit={() => {}} />);
    expect(screen.getByText(/"discountPct"/)).toBeInTheDocument();
  });

  it("seeds the editor with the merged snapshot+seed", () => {
    render(<PatchEditor snapshot={snapshot} seed={{ discountPct: 25 }} onCancel={() => {}} onSubmit={() => {}} />);
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(ta.value).toMatch(/"discountPct": 25/);
  });

  it("disables submit when JSON is invalid", () => {
    render(<PatchEditor snapshot={snapshot} seed={null} onCancel={() => {}} onSubmit={() => {}} />);
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "not json" } });
    expect(screen.getByRole("button", { name: /apply changes/i })).toBeDisabled();
  });

  it("disables submit when value didn't change", () => {
    render(<PatchEditor snapshot={snapshot} seed={null} onCancel={() => {}} onSubmit={() => {}} />);
    expect(screen.getByRole("button", { name: /apply changes/i })).toBeDisabled();
  });

  it("submits the parsed value when valid + changed", () => {
    const onSubmit = vi.fn();
    render(<PatchEditor snapshot={snapshot} seed={{ discountPct: 25 }} onCancel={() => {}} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: /apply changes/i }));
    expect(onSubmit).toHaveBeenCalledWith({ discountPct: 25, memo: "Initial 10% per loyalty policy" });
  });

  it("disables submit when payload exceeds 100 KB", () => {
    const big = { blob: "x".repeat(110_000) };
    render(<PatchEditor snapshot={snapshot} seed={big} onCancel={() => {}} onSubmit={() => {}} />);
    expect(screen.getByRole("button", { name: /apply changes/i })).toBeDisabled();
    expect(screen.getByText(/100 KB/)).toBeInTheDocument();
  });

  it("renders changed key names in the diff foot", () => {
    render(<PatchEditor snapshot={snapshot} seed={{ discountPct: 25 }} onCancel={() => {}} onSubmit={() => {}} />);
    expect(screen.getByText(/changed.*discountPct/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement**

```tsx
// MODULE_ROOT/components/detail/patch-editor.tsx
"use client";

import { useMemo, useState } from "react";
import styles from "../../approvals.module.css";
import { jsonDiff } from "../../json-diff";

export interface PatchEditorProps {
  snapshot: Record<string, unknown>;
  seed: Record<string, unknown> | null;
  onCancel: () => void;
  onSubmit: (patchValue: Record<string, unknown>) => void;
}

const MAX_BYTES = 100 * 1024;

export function PatchEditor({ snapshot, seed, onCancel, onSubmit }: PatchEditorProps) {
  const initial = useMemo(() => ({ ...snapshot, ...(seed ?? {}) }), [snapshot, seed]);
  const [text, setText] = useState(() => JSON.stringify(initial, null, 2));
  const [parsed, setParsed] = useState<Record<string, unknown> | null>(initial);
  const [parseError, setParseError] = useState<string | null>(null);

  function onChange(next: string) {
    setText(next);
    try {
      const obj = JSON.parse(next);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        setParsed(obj as Record<string, unknown>);
        setParseError(null);
      } else {
        setParseError("Must be a JSON object.");
        setParsed(null);
      }
    } catch (err) {
      setParseError((err as Error).message);
      setParsed(null);
    }
  }

  const bytes = new Blob([text]).size;
  const tooLarge = bytes > MAX_BYTES;
  const changedKeys = parsed ? jsonDiff(snapshot, parsed) : [];
  const canSubmit = !!parsed && !tooLarge && changedKeys.length > 0;

  return (
    <div className={styles.patchEditor}>
      <div className={styles.patchHead}>
        <span className={styles.eyebrow}>Edit details · advanced</span>
        <span className={styles.patchHint}>Sends `action: patch` — applies the changes then approves the modified version.</span>
      </div>
      <div className={styles.patchDiff}>
        <div className={styles.patchPane}>
          <span className={styles.patchPaneLabel}>current</span>
          <pre className={styles.patchSnapshot}>{JSON.stringify(snapshot, null, 2)}</pre>
        </div>
        <div className={styles.patchPane}>
          <span className={`${styles.patchPaneLabel} ${styles.patchPaneLabelProposed}`}>proposed</span>
          <textarea
            className={`${styles.patchTextarea} ${parseError ? styles.patchTextareaInvalid : ""}`}
            value={text}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
          />
          {parseError && <span className={styles.patchError}>{parseError}</span>}
        </div>
      </div>
      <div className={styles.patchFoot}>
        <div>
          <span className={styles.eyebrow}>size</span>
          <b> {(bytes / 1024).toFixed(2)} KB</b> of 100 KB
          {changedKeys.length > 0 && (
            <>
              <span className={styles.patchFootSep}>·</span>
              <span className={styles.eyebrow}>changed</span>
              <b> {changedKeys.join(", ")}</b>
            </>
          )}
        </div>
        <div className={styles.patchFootRight}>
          <button type="button" className={styles.btnSm} onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className={styles.btnPrimary}
            disabled={!canSubmit}
            onClick={() => parsed && onSubmit(parsed)}
          >
            Apply changes & approve
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Append CSS**

```css
.patchEditor {
  background: var(--paper-raised);
  border: 1px solid var(--hair-strong);
  border-radius: 2px;
  padding: 20px 22px 16px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.patchHead { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.patchHint { font-family: var(--sans); font-size: 12.5px; color: var(--ink-3); font-style: italic; }
.patchDiff { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 760px) { .patchDiff { grid-template-columns: 1fr; } }
.patchPane { display: flex; flex-direction: column; gap: 8px; }
.patchPaneLabel {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ink-4);
  font-weight: 700;
}
.patchPaneLabelProposed { color: var(--accent); }
.patchSnapshot {
  font-family: var(--mono);
  font-size: 12.5px;
  background: var(--paper-warm);
  border: 1px solid var(--hair);
  border-radius: 2px;
  padding: 14px 16px;
  white-space: pre-wrap;
  line-height: 1.6;
  color: var(--ink-3);
  min-height: 12rem;
  overflow: auto;
}
.patchTextarea {
  font-family: var(--mono);
  font-size: 12.5px;
  background: var(--paper-warm);
  border: 1px solid var(--hair-strong);
  border-radius: 2px;
  padding: 14px 16px;
  width: 100%;
  min-height: 12rem;
  resize: vertical;
  color: var(--ink);
  line-height: 1.6;
  outline: none;
}
.patchTextarea:focus { border-color: var(--accent); background: #fff; }
.patchTextareaInvalid { border-color: hsl(0 35% 45%); background: hsl(0 35% 97%); }
.patchError { font-family: var(--mono); font-size: 11px; color: hsl(0 35% 35%); }
.patchFoot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  border-top: 1px dashed var(--hair);
  padding-top: 14px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-4);
}
.patchFoot b { color: var(--ink-2); font-weight: 600; }
.patchFootSep { margin: 0 8px; opacity: 0.5; }
.patchFootRight { display: flex; align-items: center; gap: 10px; }
.btnPrimary {
  font-family: var(--sans);
  font-size: 13px;
  font-weight: 600;
  padding: 9px 16px;
  border-radius: 2px;
  border: 1px solid var(--accent);
  background: var(--accent);
  color: #fff;
  cursor: pointer;
}
.btnPrimary:hover:not(:disabled) { background: var(--accent-soft); border-color: var(--accent-soft); }
.btnPrimary:disabled { background: transparent; color: var(--ink-4); border-color: var(--hair); cursor: not-allowed; }
```

- [ ] **Step 5: Run, expect pass; commit**

```bash
pnpm --filter @switchboard/dashboard test approvals/patch-editor
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/components/detail/patch-editor.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/__tests__/patch-editor.test.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/approvals.module.css
git commit -m "feat(approvals): JSON patch editor with diff + size budget

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4.3: Wire `AdvancedJsonToggle` into the action drawer

**Files:**
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/approvals/components/detail/action-drawer.tsx`
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/approvals/components/detail/index.tsx`
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/approvals/__tests__/action-drawer.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `action-drawer.test.tsx`:

```tsx
describe("ActionDrawer — advanced JSON toggle", () => {
  beforeEach(() => sessionStorage.clear());

  it("hides the JSON toggle on mobile widths even with sessionStorage open", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 600 });
    sessionStorage.setItem("approvals.advancedJsonOpen", "true");
    render(<ActionDrawer row={lowRow} now={Date.now()} {...baseHandlers} principalId="p-1" onPatch={() => {}} />);
    expect(screen.queryByRole("button", { name: /view json/i })).not.toBeInTheDocument();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
  });

  it("renders the JSON toggle on desktop widths", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
    render(<ActionDrawer row={lowRow} now={Date.now()} {...baseHandlers} principalId="p-1" onPatch={() => {}} />);
    expect(screen.getByRole("button", { name: /view json/i })).toBeInTheDocument();
  });

  it("opening the toggle reveals the patch editor", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
    render(<ActionDrawer row={lowRow} now={Date.now()} {...baseHandlers} principalId="p-1" onPatch={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /view json/i }));
    expect(screen.getAllByRole("textbox").length).toBeGreaterThan(0);
  });

  it("persists open state to sessionStorage", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
    render(<ActionDrawer row={lowRow} now={Date.now()} {...baseHandlers} principalId="p-1" onPatch={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /view json/i }));
    expect(sessionStorage.getItem("approvals.advancedJsonOpen")).toBe("true");
  });
});
```

(Update `baseHandlers` to include `onPatch: vi.fn()` and add a new prop in the existing render calls — `onPatch={baseHandlers.onPatch}`.)

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Extend `ActionDrawer` props + implement the toggle**

Add `onPatch?: (patchValue: Record<string, unknown>) => void` to `ActionDrawerProps`. Add a small `AdvancedJsonToggle` block:

```tsx
import { useEffect, useState } from "react";
import { PatchEditor } from "./patch-editor";

// inside ActionDrawer, after the RejectConfirm row but before the error:
const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;
const [advancedOpen, setAdvancedOpen] = useState<boolean>(() => {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem("approvals.advancedJsonOpen") === "true";
});

useEffect(() => {
  if (typeof window !== "undefined") {
    sessionStorage.setItem("approvals.advancedJsonOpen", advancedOpen ? "true" : "false");
  }
}, [advancedOpen]);

// ... in the JSX, after RejectConfirm:
{!isMobile && onPatch && (
  <div className={styles.advancedToggleRow}>
    <button
      type="button"
      className={styles.advancedToggleBtn}
      onClick={() => setAdvancedOpen((v) => !v)}
    >
      {advancedOpen ? "Hide JSON ▴" : "View JSON (advanced) ▾"}
    </button>
  </div>
)}
{!isMobile && advancedOpen && onPatch && (
  <PatchEditor
    snapshot={row.request?.parametersSnapshot ?? {}}
    seed={(row.patchProposal?.diff as Record<string, unknown> | undefined) ?? null}
    onCancel={() => setAdvancedOpen(false)}
    onSubmit={(patchValue) => onPatch(patchValue)}
  />
)}
```

Append CSS:

```css
.advancedToggleRow { display: flex; justify-content: flex-end; }
.advancedToggleBtn {
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-3);
  padding: 8px 12px;
  background: transparent;
  border: 1px solid transparent;
  cursor: pointer;
}
.advancedToggleBtn:hover { color: var(--ink); border-color: var(--hair-strong); }
```

- [ ] **Step 4: Wire `onPatch` in `detail/index.tsx`**

```tsx
function handlePatch(patchValue: Record<string, unknown>) {
  setErrorState(null);
  mutation.mutate(
    { id: row!.id, action: "patch", bindingHash: row!.bindingHash, patchValue },
    {
      onSuccess: () => setDecision({ kind: "patched" }),
      onError: (err) => {
        if (err instanceof ApprovalRespondError) setErrorState({ status: err.status });
        else setErrorState({ status: 500 });
      },
    },
  );
}
```

Pass `onPatch={handlePatch}` to `<ActionDrawer ... />`.

- [ ] **Step 5: Run, expect pass; commit**

```bash
pnpm --filter @switchboard/dashboard test approvals/action-drawer approvals/patch-editor
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/components/detail/action-drawer.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/components/detail/index.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/__tests__/action-drawer.test.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/approvals.module.css
git commit -m "feat(approvals): advanced JSON toggle reveals patch editor (desktop only)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4.4: PR-A4 ships

- [ ] Typecheck + full sweep. Manual verify with the `apr_d77c20` fixture (10% → 25% worked example). Push and open PR `feat(approvals): PR-A4 — patch flow behind advanced JSON toggle`.

---

## Phase 5 — PR-A5: Mobile polish + telemetry + denylist sweep

**Outcome:** Mobile (≤768px) collapses to an inline-accordion layout. Telemetry events fire for the key interactions. The denylist test sweeps the full page in every state. Empty/filter-narrowed empty states get final copy polish.

### Task 5.1: Mobile accordion CSS

**Files:**
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/approvals/approvals.module.css`
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/approvals/approvals-page.tsx`

- [ ] **Step 1: Restructure the split for mobile**

Add to `approvals.module.css`:

```css
@media (max-width: 768px) {
  .split { display: block; }
  .splitLeft { border-right: none; }
  .splitRight { display: none; }
  .approvalsPage[data-active-mobile="true"] .splitLeft .queueRowActive {
    /* keep the active row visually attached to the inline detail below */
    border-bottom: 0;
  }
}
```

Extend `ApprovalsQueue` to accept an `inlineDetail` slot rendered after the active row. The page detects mobile via `window.matchMedia` and slots `<Detail />` into the queue instead of the right pane.

Add to `queue.tsx`:

```tsx
export interface ApprovalsQueueProps {
  items: readonly ApprovalRow[];
  activeId: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
  now?: number;
  narrowed?: boolean;
  onClearFilters?: () => void;
  inlineDetail?: React.ReactNode;
  inlineDetailFor?: string | null;
}
```

Inside the rendered list, after the row, slot the detail:

```tsx
return (
  <div className={styles.queue}>
    {items.map((req) => (
      <Fragment key={req.id}>
        <QueueRow req={req} active={req.id === activeId} onSelect={onSelect} now={now} />
        {inlineDetail && inlineDetailFor === req.id && (
          <div className={styles.queueInlineDetail} role="region" aria-labelledby={`row-${req.id}`}>
            {inlineDetail}
          </div>
        )}
      </Fragment>
    ))}
  </div>
);
```

Import `Fragment` from React.

Add to `QueueRow` a stable id for the `aria-labelledby` target: `<button id={`row-${req.id}`} ...>`.

In `approvals-page.tsx`, add `isMobile` state driven by matchMedia:

```tsx
const [isMobile, setIsMobile] = useState(false);
useEffect(() => {
  if (typeof window === "undefined") return;
  const mq = window.matchMedia("(max-width: 768px)");
  setIsMobile(mq.matches);
  const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}, []);
```

Conditionally render the right pane vs inline:

```tsx
<aside className={styles.splitLeft}>
  <ApprovalsQueue
    items={filteredSorted}
    activeId={activeId}
    onSelect={onSelect}
    loading={isLoading}
    now={now}
    narrowed={filter !== "all" || expiringOnly}
    onClearFilters={() => { setFilter("all"); setExpiringOnly(false); }}
    inlineDetail={isMobile ? <Detail row={activeRow} now={now} /> : null}
    inlineDetailFor={isMobile ? activeId : null}
  />
</aside>
<section className={styles.splitRight}>
  {!isMobile && <Detail row={activeRow} now={now} />}
</section>
```

Append CSS for the inline-detail block:

```css
.queueInlineDetail {
  background: var(--cream);
  border-bottom: 1px solid var(--hair);
}
@media (min-width: 769px) {
  .queueInlineDetail { display: none; }
}
```

- [ ] **Step 2: Test the mobile rendering**

```tsx
// Append to approvals-page.test.tsx
it("renders the detail inline under the active row on mobile", async () => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (q: string) => ({
      matches: q.includes("max-width: 768"),
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
  renderPage();
  await waitFor(() => expect(screen.getByText(/Refund SGD 4,820/)).toBeInTheDocument());
  // The detail pane (binding code) should render inline now
  expect(screen.getByText(/^0x2f1a08c4/)).toBeInTheDocument();
});
```

- [ ] **Step 3: Run, fix until green; commit**

```bash
pnpm --filter @switchboard/dashboard test approvals
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/components/queue.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/approvals-page.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/approvals.module.css apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/__tests__/approvals-page.test.tsx
git commit -m "feat(approvals): mobile inline-accordion expansion of active row

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5.2: Telemetry events (best-effort)

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/approvals/telemetry.ts`
- Modify: relevant components to call helpers

- [ ] **Step 1: Implement a lightweight emitter**

```ts
// MODULE_ROOT/telemetry.ts
type Event =
  | { type: "approvals.viewed"; pendingCount: number }
  | { type: "approvals.row_selected"; id: string; riskCategory: string }
  | { type: "approvals.code_copied"; id: string }
  | { type: "approvals.approve_clicked"; id: string; riskCategory: string; quorum: boolean }
  | { type: "approvals.advanced_json_opened"; id: string }
  | { type: "approvals.patch_submitted"; id: string; changedKeys: string[] }
  | { type: "approvals.reject_clicked"; id: string }
  | { type: "approvals.expired_during_view"; id: string }
  | { type: "approvals.conflict_409"; id: string };

export function emit(event: Event): void {
  // Soft integration — if a global emitter exists, use it. Otherwise no-op.
  const sink = (window as unknown as { __switchboardTelemetry?: (e: Event) => void }).__switchboardTelemetry;
  if (typeof sink === "function") sink(event);
}
```

- [ ] **Step 2: Sprinkle calls**

In `approvals-page.tsx`: emit `approvals.viewed` once on mount and `approvals.row_selected` in `onSelect`.

In `confirmation-code.tsx`: emit `approvals.code_copied` in the successful copy branch (accept an optional `onCopied` callback or pass the id via a new `id` prop).

In `action-drawer.tsx`: emit `approvals.approve_clicked`, `approvals.reject_clicked`, `approvals.advanced_json_opened` at the right call sites.

In `detail/index.tsx`: emit `approvals.patch_submitted` (with `Object.keys(patchValue)`) and `approvals.conflict_409` when error.status === 409.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/telemetry.ts apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/approvals-page.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/components/detail/confirmation-code.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/components/detail/action-drawer.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/components/detail/index.tsx
git commit -m "feat(approvals): telemetry helpers for key interactions

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5.3: Empty + filter-narrowed-to-zero polish

**Files:**
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/approvals/components/queue.tsx`
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/approvals/__tests__/queue.test.tsx`

- [ ] **Step 1: Add filter-narrowed empty variant**

Extend `ApprovalsQueueProps` with `narrowed?: boolean; onClearFilters?: () => void;`. Render different copy + a "Clear filters" button when `narrowed && items.length === 0`.

- [ ] **Step 2: Test**

```tsx
it("renders the filter-narrowed empty copy with a clear button", () => {
  const onClear = vi.fn();
  render(<ApprovalsQueue items={[]} activeId={null} onSelect={() => {}} narrowed onClearFilters={onClear} />);
  expect(screen.getByText(/no approvals match/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /clear filters/i }));
  expect(onClear).toHaveBeenCalled();
});
```

- [ ] **Step 3: Wire in `approvals-page.tsx`**

Pass `narrowed={filter !== "all" || expiringOnly}` and `onClearFilters={() => { setFilter("all"); setExpiringOnly(false); }}`.

- [ ] **Step 4: Commit**

```bash
pnpm --filter @switchboard/dashboard test approvals/queue
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/components/queue.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/approvals-page.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/__tests__/queue.test.tsx
git commit -m "feat(approvals): filter-narrowed-to-zero empty state with Clear filters

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5.4: Expand the denylist test to every state

**Files:**
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/approvals/__tests__/copy-language-audit.test.tsx`

- [ ] **Step 1: Add per-state cases**

Append test cases that exercise the recovery row (`apr_e0c4a5`), an expired-during-view row (mock `expiresAt` in the past), and a successful approve → dispatch banner. Re-run the denylist scan for each. The existing helper `visibleText()` is reused.

- [ ] **Step 2: Run, fix any offenders in copy, commit**

```bash
pnpm --filter @switchboard/dashboard test copy-language-audit
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/__tests__/copy-language-audit.test.tsx
git commit -m "test(approvals): denylist sweep covers recovery / expired / dispatched states

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5.5: PR-A5 ships

- [ ] Typecheck + full sweep + manual verify on mobile-sized viewport. Push and open PR `feat(approvals): PR-A5 — mobile polish + telemetry + denylist sweep`.

---

## Phase 6 — PR-A2b (OPTIONAL): Quorum

> **Skip this phase entirely if the backend payload check (Task 6.0) does not confirm the runtime shape.** Quorum is a deferable enhancement. The product floor is single-approver, which Phases 0–5 already deliver.

### Task 6.0: Prerequisite — confirm runtime shape

- [ ] **Step 1: Seed a quorum lifecycle in dev**

In a dev environment with Postgres up, manually create or trigger an approval that requires N>1 approvers via the existing seeding script or API call. Note: this step is environment-specific — check `apps/api/scripts/seed-approvals.ts` if present, otherwise consult the team for the canonical seeding path. **If neither exists, this PR cannot proceed.**

- [ ] **Step 2: Inspect the response**

```bash
curl -s http://localhost:3000/api/approvals/<id> | jq .
```

Look specifically for:
- `request.approvalsRequired` (number > 1)
- `state.approvalHashes` (array)

Document the observed shape in the PR description (include the redacted JSON). If both fields are present → go to Step 3a. If absent → Step 3b.

- [ ] **Step 3a: If fields are present, extend the TypeScript + Zod types**

Modify `apps/dashboard/src/lib/api-client-types.ts`:

```ts
export interface ApprovalDetail {
  request: {
    id: string;
    summary: string;
    riskCategory: string;
    bindingHash: string;
    approvers: string[];
    approvalsRequired?: number;      // added
    createdAt: string;
  };
  state: {
    status: string;
    expiresAt: string;
    respondedBy?: string;
    respondedAt?: string;
    approvalHashes?: string[];        // added
  };
  envelopeId: string;
}
```

Add corresponding fields to `packages/schemas/src/approval-lifecycle.ts` Zod schemas if the schemas are consumed at the API boundary. Run `pnpm --filter @switchboard/schemas test && pnpm --filter @switchboard/db test`.

Commit: `feat(approvals): extend ApprovalDetail types with quorum fields`.

- [ ] **Step 3b: If fields are absent, extend the Fastify response**

Modify `apps/api/src/routes/approvals.ts:170–175` to project the additional fields from the underlying store. Add corresponding tests in `apps/api/src/__tests__/`. This is a small backend change; verify it doesn't break existing tests.

Commit: `feat(api): expose approvalsRequired + approvalHashes on /api/approvals/:id`.

---

### Task 6.1: Approvers block

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/approvals/components/detail/approvers.tsx`
- Test: `apps/dashboard/src/app/(auth)/(mercury)/approvals/__tests__/approvers.test.tsx`

- [ ] **Step 1: Decide the approver name lookup strategy**

Goal: render `Kira Lim · Manager · signed 2m ago` instead of `kira.l · 0xK1RA`. For v1, use a tiny page-local lookup with two fallbacks:

1. If the approver id starts with `p-` (our principal-id format), look up against the existing team roster API if one exists (grep `apps/dashboard/src/hooks` for `useTeamRoster` etc.; if none, fall back to step 2).
2. Otherwise, render the bare id with role `Teammate`.

Document the chosen approach in the PR.

- [ ] **Step 2: Write the failing test**

```tsx
// MODULE_ROOT/__tests__/approvers.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ApproversBlock } from "../components/detail/approvers";

describe("ApproversBlock", () => {
  it("renders n-of-m with operator self detected by principalId", () => {
    render(
      <ApproversBlock
        approvers={["p-1", "kira.l"]}
        approvalsRequired={2}
        approvalHashes={["0xK1RA"]}
        principalId="p-1"
        localSigned={false}
      />,
    );
    expect(screen.getByText(/1 of 2 signed/i)).toBeInTheDocument();
  });

  it("never renders raw approver ids when display is unknown", () => {
    render(
      <ApproversBlock
        approvers={["unknown-id-xyz"]}
        approvalsRequired={2}
        approvalHashes={[]}
        principalId="p-1"
        localSigned={false}
      />,
    );
    expect(screen.queryByText(/unknown-id-xyz/)).not.toBeInTheDocument();
    expect(screen.getByText(/teammate/i)).toBeInTheDocument();
  });

  it("never renders raw hash stamps in customer-facing text", () => {
    render(
      <ApproversBlock
        approvers={["p-1", "kira.l"]}
        approvalsRequired={2}
        approvalHashes={["0xK1RA"]}
        principalId="p-1"
        localSigned={false}
      />,
    );
    expect(document.body.textContent ?? "").not.toContain("0xK1RA");
  });

  it("counts local signature optimistically", () => {
    render(
      <ApproversBlock
        approvers={["p-1", "kira.l"]}
        approvalsRequired={2}
        approvalHashes={[]}
        principalId="p-1"
        localSigned
      />,
    );
    expect(screen.getByText(/1 of 2 signed/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Implement**

```tsx
// MODULE_ROOT/components/detail/approvers.tsx
"use client";

import styles from "../../approvals.module.css";

export interface ApproversBlockProps {
  approvers: readonly string[];
  approvalsRequired: number;
  approvalHashes: readonly string[];
  principalId: string | null;
  localSigned: boolean;
}

function teammateDisplay(id: string): { name: string; role: string } {
  // Page-local minimal lookup. Replace with team-roster lookup once available.
  // For now, render a friendly label; never the raw id.
  return { name: id.startsWith("p-") ? "Teammate" : id, role: "Teammate" };
}

export function ApproversBlock({
  approvers,
  approvalsRequired,
  approvalHashes,
  principalId,
  localSigned,
}: ApproversBlockProps) {
  if (approvalsRequired <= 1) return null;

  const otherSignedCount = approvalHashes.length;
  const total = otherSignedCount + (localSigned ? 1 : 0);

  return (
    <div className={styles.dblock}>
      <div className={styles.approversHead}>
        <span className={styles.eyebrow}>quorum · approvers</span>
        <span className={styles.approversCount}>
          {total} of {approvalsRequired} signed
        </span>
      </div>
      <div className={styles.approversList}>
        {approvers.map((id, idx) => {
          const isYou = id === principalId;
          const display = isYou ? { name: "You", role: "Operator" } : teammateDisplay(id);
          const signed = isYou ? localSigned : idx - approvers.filter((a) => a === principalId).length < otherSignedCount;
          return (
            <div key={id} className={`${styles.approver} ${signed ? styles.approverSigned : ""}`}>
              <span className={styles.approverMark}>{signed ? "✓" : idx + 1}</span>
              <span className={styles.approverName}>
                {display.name}
                <span className={styles.approverRole}> · {display.role}</span>
              </span>
              <span className={styles.approverStamp}>
                {signed ? (isYou ? "just now" : "signed") : "waiting"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Append CSS**

```css
.approversHead { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
.approversCount { font-family: var(--mono); font-size: 12px; color: var(--ink); font-weight: 600; }
.approversList { display: flex; flex-direction: column; }
.approver {
  display: grid;
  grid-template-columns: 30px 1fr auto;
  gap: 14px;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px dashed var(--hair);
}
.approver:last-child { border-bottom: none; }
.approverMark {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 1px solid var(--hair-strong);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-4);
}
.approverSigned .approverMark { background: var(--ink); color: var(--cream); border-color: var(--ink); }
.approverName { font-family: var(--sans); font-size: 14px; color: var(--ink); font-weight: 500; }
.approverRole { color: var(--ink-3); font-weight: 400; }
.approverStamp { font-family: var(--mono); font-size: 11px; color: var(--ink-4); }
```

- [ ] **Step 5: Wire into `detail/index.tsx`**

Render `<ApproversBlock />` between `ConfirmationCode` and `ActionDrawer` when `row.request?.approvalsRequired && row.request.approvalsRequired > 1`. Track local signed state by setting it on successful approve (when `awaitingQuorum` would apply).

Update the `decision` state to set `awaitingQuorum: approvalsRequired - (approvalHashes.length + 1)` on success when quorum applies.

- [ ] **Step 6: Run, expect pass; commit**

```bash
pnpm --filter @switchboard/dashboard test approvals/approvers
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/components/detail/approvers.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/__tests__/approvers.test.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/components/detail/index.tsx apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/approvals.module.css
git commit -m "feat(approvals): ApproversBlock with n-of-m, operator self-detect, no hash stamps

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6.2: PR-A2b ships

- [ ] Typecheck + full sweep + manual verify against the quorum fixture (`apr_9b73c1`). Push and open PR `feat(approvals): PR-A2b — quorum block (n-of-m, no hash stamps)`.

---

## Phase 7 — PR-A6 (Optional, post-launch): Flag flip

- [ ] Set `NEXT_PUBLIC_APPROVALS_LIVE=true` in the production env file or deploy config.
- [ ] Verify the live API behavior matches fixture mode end-to-end with at least one real single-approver lifecycle.
- [ ] If A2b shipped, also verify quorum.
- [ ] Update deploy documentation as needed.

---

## Self-review checklist

After implementing all phases, run through the spec's 26-item Acceptance criteria section. Each item should have a corresponding test (or a documented manual verification step in the PR description). Specifically:

- Item 4 (risk-graded gating): `approve-block.test.tsx` and `action-drawer.test.tsx`.
- Item 7 (Enter-key gated): `approve-block.test.tsx` keyDown assertion.
- Item 10 (reject without bindingHash): `use-respond.test.tsx`.
- Item 11 (patch with bindingHash): `use-respond.test.tsx`.
- Item 12 (recovery copy + Dismiss): `action-drawer.test.tsx`.
- Item 15 (denylist): `copy-language-audit.test.tsx`.
- Item 17 (selectable code): `confirmation-code.test.tsx`.
- Item 18 (clipboard failure): `confirmation-code.test.tsx`.
- Item 19 (missing principal): `action-drawer.test.tsx`.
- Item 20 (decisions invalidation): `use-respond.test.tsx` (add an assertion that `keys.decisions.all()` was invalidated after success; mock `queryClient.invalidateQueries` and check call args).
- Item 21 (mobile accordion + deep link): `approvals-page.test.tsx` (mobile case).
- Item 26 (CTA contrast): documented in PR-A3 PR description.

