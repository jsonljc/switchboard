# CUX P1-C Inbox Detail — PR3b (Handoff Detail Sheet) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the PR3a `inbox-handoff-guard` placeholder with a real handoff detail drill-in — a `HandoffDetailSheet` that fetches the escalation, renders the lead / where-it-stands / live conversation, and lets the operator reply (handing the thread back) or mark the handoff resolved — degrading gracefully where backend snapshot data is empty today.

**Architecture:** The sheet is a single mounted instance (no list loop), so it **owns its read query** (`useEscalationDetail(sourceRef.sourceId)`) and renders its own loading / error / data states. It is **presentational for mutations** — it receives `onReply`/`onResolve` callbacks. A screen-level `HandoffDetailItem` wrapper (mirroring PR3a's `ApprovalDetailItem`) owns the mutation hooks (`useEscalationReply` + new `useEscalationResolve`), the toasts, and the decision-feed invalidation, and passes those callbacks down. This keeps mutation ownership consistent with PR3a and the sheet fully testable.

**Tech Stack:** Next.js 14 (App Router) · React · TanStack Query · Vitest + React Testing Library · TypeScript (ESM, `.js`-less `@/` alias imports in dashboard).

---

## Context the implementer must hold

- **PR3a is merged** (`61e1f2ae` on `origin/main`). `inbox-screen.tsx` already mounts `ApprovalDetailSheet` for `kind === "approval"`; the `kind === "handoff"` branch is currently `<div className="inbox-handoff-guard">Handoff detail coming next.</div>`. **PR3b replaces only that branch.**
- **Frontend-bounded.** Wire to endpoints that exist today; render real data where present, degrade where absent. **No backend changes.** The three backend follow-up buckets in the spec are OUT OF SCOPE — if wiring hits a true blocker, STOP and report the exact blocker; do not expand scope.
- **Do not touch** the merged PR2 `InboxDecisionCard` or the PR3a `ApprovalDetailSheet` visuals. **Do not port CSS** — that is the later PR4 polish slice. Ship plain classnames (the `ds-*` / `sheet` / `ds-thread` classnames from the prototype are fine as bare strings; no `.css`/module work here).
- **Visual source of truth** (gzip share link expired, files persist on disk): `/tmp/sbinboxv2/switchboard/project/inbox-v2/detail-handoff.jsx` (+ `components.jsx`, `data.js`). Match the visual output; do **not** copy the `window.SBInbox` global-script structure. The prototype uses `turn.content` + `turn.role === "lead"` — the **real** contract uses `turn.text` + `role === "user"` (see traps below); adapt.
- Spec on `main`: `docs/superpowers/specs/2026-05-26-cux-p1c-inbox-detail-design.md` (handoff field-by-field WIRE/DEGRADE/DEFER table + the 5 traps + PR3b section).

## Correctness traps (bake into impl + tests)

1. **Conversation turns use `text`, not `content`.** Role **`"user"` = the LEAD** (not `"lead"`), **`"owner"` = the operator/agent**. Tolerate unknown roles (render generically, never crash). `timestamp` is ISO → `relativeTime(timestamp, nowMs)`.
2. **Reply** → `POST /api/dashboard/escalations/:id/reply { message }` → `200 { escalation, replySent:true }` OR **`502 { escalation, replySent:false }`** — the reply **IS persisted on 502**; surface "saved — couldn't deliver right now" (do not treat 502 as failure). Use the existing `useEscalationReply` 200/502 split.
3. **Resolve** → `POST /api/dashboard/escalations/:id/resolve { resolutionNote? }` → `200`. `resolutionNote` is optional.
4. **`leadSnapshot` / `qualificationSnapshot` / `conversationSummary` are mostly EMPTY today** (producers stub them — `leadSnapshot` carries only `channel`). Render-if-present and degrade gracefully. The **live conversation thread + composer + reply/resolve all work now** (thread is live-fetched from `conversationState`).
5. **Reply/resolve hit ESCALATION endpoints** keyed by `decision.sourceRef.sourceId` (the escalation/handoff id), **NOT** recommendations.

## Backend reality (verified on `origin/main`, 2026-05-26)

- `GET /api/dashboard/escalations/[id]` proxy → `client.getEscalation(id)` → `{ escalation, conversationHistory }`. The `escalation` object shape (from `apps/api/src/routes/escalations.ts`): `{ id, sessionId, leadId, status, reason, conversationSummary, leadSnapshot, qualificationSnapshot, slaDeadlineAt (ISO), acknowledgedAt (ISO|null), resolutionNote (string|null), resolvedAt (ISO|null), createdAt (ISO), updatedAt (ISO) }`. `conversationHistory` is the raw JSONB `messages` array (untyped turns).
- `reason` ∈ `HandoffReasonSchema` (`packages/schemas/src/handoff.ts`): `human_requested | max_turns_exceeded | complex_objection | negative_sentiment | compliance_concern | booking_failure | escalation_timeout | missing_knowledge | outside_whatsapp_window`.
- `POST /api/dashboard/escalations/[id]/reply` proxy preserves the 200/502 split verbatim. **`useEscalationReply(id)` already exists** and returns `{ send(message) → Promise<{ ok, escalation, error? }>, isPending }` (`ok:false` = the 502 saved-but-undelivered branch).
- `POST /api/dashboard/escalations/[id]/resolve` proxy → `client.resolveEscalation(id, resolutionNote?)`. **No resolve hook exists** — this plan adds `useEscalationResolve` mirroring the reply hook's shape and invalidation.
- `useEscalationReply` is **not yet consumed by any component** — PR3b is its first consumer.
- Query-key factory (`apps/dashboard/src/lib/query-keys.ts`) has `escalations.all()` only, and `decisions.all()` / `decisions.feed(agentKey)`. This plan adds `escalations.detail(id)`.

## File Structure

| File | Responsibility |
| --- | --- |
| `apps/dashboard/src/lib/query-keys.ts` (modify) | Add `escalations.detail(id)` scoped key. |
| `apps/dashboard/src/hooks/use-escalation-detail.ts` (create) | `useQuery` read against the GET proxy → `{ escalation, conversationHistory }`; defensive response types. |
| `apps/dashboard/src/hooks/use-escalation-resolve.ts` (create) | `useMutation` against the resolve proxy; invalidates `escalations.all()`. |
| `apps/dashboard/src/components/inbox/handoff-detail-sheet.tsx` (create) | `HandoffDetailSheet` (owns the read query) + `HandoffSkeleton` + `HandoffFetchError` + local `REASON_LABELS`. Presentational for mutations (`onReply`/`onResolve` callbacks). |
| `apps/dashboard/src/components/inbox/inbox-screen.tsx` (modify) | Add `HandoffDetailItem` wrapper owning the mutation hooks + toasts + feed invalidation; replace the `inbox-handoff-guard` branch with it. |
| co-located `__tests__/*.test.ts(x)` | One per new/changed unit. |

## Reused helpers (do NOT re-implement)

- `relativeTime(iso, nowMs)`, `dueIn(iso, nowMs)` — `@/lib/decisions/time` (PR2).
- `InboxAgentAvatar` — `@/components/inbox/inbox-agent-avatar` (PR2).
- `AGENT_REGISTRY[agentKey]?.displayName` — `@switchboard/schemas`.
- `useScopedQueryKeys()` — `@/hooks/use-query-keys` (returns `null` when no session; guard with `enabled: !!keys` / `if (keys)`).
- `useEscalationReply(id)` — `@/hooks/use-escalation-reply` (200/502 split).

---

## Task 1: Add `escalations.detail(id)` query key

**Files:**
- Modify: `apps/dashboard/src/lib/query-keys.ts` (the `escalations` block, ~line 86)
- Test: `apps/dashboard/src/lib/__tests__/query-keys.test.ts` (extend if present; create if absent)

- [ ] **Step 1: Write the failing test**

Append to (or create) `apps/dashboard/src/lib/__tests__/query-keys.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { scopedKeys } from "@/lib/query-keys";

describe("scopedKeys escalations", () => {
  it("scopes escalations.all by org", () => {
    expect(scopedKeys("org_1").escalations.all()).toEqual(["org_1", "escalations"]);
  });

  it("scopes escalations.detail by org + id", () => {
    expect(scopedKeys("org_1").escalations.detail("esc_9")).toEqual([
      "org_1",
      "escalations",
      "detail",
      "esc_9",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test query-keys`
Expected: FAIL — `escalations.detail is not a function`.

- [ ] **Step 3: Add the key**

In `apps/dashboard/src/lib/query-keys.ts`, change the `escalations` block to:

```ts
  escalations: {
    all: () => [orgId, "escalations"] as const,
    detail: (id: string) => [orgId, "escalations", "detail", id] as const,
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test query-keys`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/lib/query-keys.ts apps/dashboard/src/lib/__tests__/query-keys.test.ts
git commit -m "feat(inbox): add escalations.detail query key"
```

---

## Task 2: `useEscalationDetail` read hook + response types

**Files:**
- Create: `apps/dashboard/src/hooks/use-escalation-detail.ts`
- Test: `apps/dashboard/src/hooks/__tests__/use-escalation-detail.test.tsx`

The hook mirrors `use-decision-feed.ts` (scoped query key, `enabled: !!keys`, fetch a proxy URL, throw on non-ok). It defines **defensive** local types for the response because the upstream turns are raw JSONB (`conversationHistory` is `unknown[]` from the api-client) and the snapshots are mostly empty today.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import React from "react";

vi.mock("@/hooks/use-query-keys", () => ({
  useScopedQueryKeys: () => ({
    escalations: {
      all: () => ["org_1", "escalations"],
      detail: (id: string) => ["org_1", "escalations", "detail", id],
    },
  }),
}));

import { useEscalationDetail } from "../use-escalation-detail";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("useEscalationDetail", () => {
  it("fetches the escalation detail proxy by id", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        escalation: { id: "esc_9", reason: "complex_objection", status: "pending" },
        conversationHistory: [{ role: "user", text: "Hi", timestamp: "2026-05-25T09:00:00Z" }],
      }),
    });

    const { result } = renderHook(() => useEscalationDetail("esc_9"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith("/api/dashboard/escalations/esc_9");
    expect(result.current.data?.escalation.id).toBe("esc_9");
    expect(result.current.data?.conversationHistory).toHaveLength(1);
  });

  it("throws on non-ok so the sheet can render its error state", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    const { result } = renderHook(() => useEscalationDetail("esc_err"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("is disabled when id is empty", () => {
    const { result } = renderHook(() => useEscalationDetail(""), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test use-escalation-detail`
Expected: FAIL — cannot resolve `../use-escalation-detail`.

- [ ] **Step 3: Write the hook**

Create `apps/dashboard/src/hooks/use-escalation-detail.ts`:

```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";

/**
 * Defensive response types for GET /api/dashboard/escalations/:id.
 *
 * The upstream `conversationHistory` is raw JSONB (`unknown[]` at the
 * api-client boundary) and the snapshot fields are stubbed/empty for most
 * current producers — so every field below the escalation id is optional and
 * the sheet renders if-present. See the PR3b plan's correctness traps:
 *   - turns use `text` (not `content`); role "user" = lead, "owner" = operator.
 */
export interface ConversationTurn {
  role?: string;
  text?: string;
  timestamp?: string;
}

export interface LeadSnapshot {
  leadId?: string;
  name?: string;
  phone?: string;
  email?: string;
  serviceInterest?: string;
  channel?: string;
  source?: string;
}

export interface QualificationSnapshot {
  qualificationStage?: string;
  leadScore?: number;
  signalsCaptured?: Record<string, unknown>;
}

export interface ConversationSummary {
  turnCount?: number;
  keyTopics?: string[];
  objectionHistory?: string[];
  sentiment?: string;
  suggestedOpening?: string;
}

export interface EscalationDetail {
  id: string;
  reason?: string;
  status?: string;
  slaDeadlineAt?: string;
  acknowledgedAt?: string | null;
  resolvedAt?: string | null;
  resolutionNote?: string | null;
  createdAt?: string;
  leadSnapshot?: LeadSnapshot;
  qualificationSnapshot?: QualificationSnapshot;
  conversationSummary?: ConversationSummary;
}

export interface EscalationDetailResponse {
  escalation: EscalationDetail;
  conversationHistory: ConversationTurn[];
}

async function fetchEscalationDetail(id: string): Promise<EscalationDetailResponse> {
  const res = await fetch(`/api/dashboard/escalations/${id}`);
  if (!res.ok) throw new Error(`Failed to load escalation (HTTP ${res.status})`);
  return res.json();
}

/**
 * Read query for a single escalation detail. Owned by the HandoffDetailSheet
 * (single mounted instance — never list-iterated). Mirrors `use-decision-feed`:
 * scoped query key + `enabled` guard so it never fires without a session or id.
 */
export function useEscalationDetail(id: string) {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.escalations.detail(id) ?? ["__disabled_escalation_detail__", id],
    queryFn: () => fetchEscalationDetail(id),
    enabled: !!keys && !!id,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test use-escalation-detail`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/hooks/use-escalation-detail.ts apps/dashboard/src/hooks/__tests__/use-escalation-detail.test.tsx
git commit -m "feat(inbox): add useEscalationDetail read hook"
```

---

## Task 3: `useEscalationResolve` mutation hook

**Files:**
- Create: `apps/dashboard/src/hooks/use-escalation-resolve.ts`
- Test: `apps/dashboard/src/hooks/__tests__/use-escalation-resolve.test.tsx`

Mirrors `use-escalation-reply.ts` minus the 502 branch (resolve returns 200). Posts `{ resolutionNote }`, invalidates `escalations.all()` on success, and exposes `{ resolve(note?) → Promise<void>, isPending }`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import React from "react";

const invalidateSpy = vi.fn();

vi.mock("@/hooks/use-query-keys", () => ({
  useScopedQueryKeys: () => ({
    escalations: { all: () => ["org_1", "escalations"] },
  }),
}));

import { useEscalationResolve } from "../use-escalation-resolve";

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(client, "invalidateQueries").mockImplementation(invalidateSpy);
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  invalidateSpy.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("useEscalationResolve", () => {
  it("posts the resolutionNote and invalidates escalations on success", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ escalation: { id: "e1" } }) });
    const { result } = renderHook(() => useEscalationResolve("e1"), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.resolve("handled by phone");
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dashboard/escalations/e1/resolve",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ resolutionNote: "handled by phone" }),
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["org_1", "escalations"] });
  });

  it("sends an undefined note when none provided", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ escalation: { id: "e1" } }) });
    const { result } = renderHook(() => useEscalationResolve("e1"), { wrapper: makeWrapper() });
    await act(async () => {
      await result.current.resolve();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dashboard/escalations/e1/resolve",
      expect.objectContaining({ body: JSON.stringify({ resolutionNote: undefined }) }),
    );
  });

  it("throws on non-ok", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    const { result } = renderHook(() => useEscalationResolve("e1"), { wrapper: makeWrapper() });
    await expect(result.current.resolve("x")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test use-escalation-resolve`
Expected: FAIL — cannot resolve `../use-escalation-resolve`.

- [ ] **Step 3: Write the hook**

Create `apps/dashboard/src/hooks/use-escalation-resolve.ts`:

```ts
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";

/**
 * Mutation hook for marking an escalation resolved.
 *
 * Wraps POST /api/dashboard/escalations/:id/resolve which proxies to the
 * upstream `/api/escalations/:id/resolve`. The upstream returns 200
 * `{ escalation }` on success; `resolutionNote` is optional and persisted
 * (audit log only). Unlike reply there is no 502 branch — resolve does not
 * touch the channel adapter.
 *
 * Invalidates the escalations cache on success. Decision-feed invalidation
 * (so the resolved handoff drops out of the inbox) is the caller's
 * responsibility — see HandoffDetailItem in inbox-screen.tsx.
 */
export function useEscalationResolve(escalationId: string) {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();

  const mutation = useMutation({
    mutationFn: async (resolutionNote?: string): Promise<void> => {
      const res = await fetch(`/api/dashboard/escalations/${escalationId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolutionNote }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Resolve failed (HTTP ${res.status})`);
      }
    },
    onSuccess: () => {
      if (keys) queryClient.invalidateQueries({ queryKey: keys.escalations.all() });
    },
  });

  return {
    resolve: (resolutionNote?: string) => mutation.mutateAsync(resolutionNote),
    isPending: mutation.isPending,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test use-escalation-resolve`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/hooks/use-escalation-resolve.ts apps/dashboard/src/hooks/__tests__/use-escalation-resolve.test.tsx
git commit -m "feat(inbox): add useEscalationResolve mutation hook"
```

---

## Task 4: `HandoffDetailSheet` — read query + render (skeleton / error / data)

**Files:**
- Create: `apps/dashboard/src/components/inbox/handoff-detail-sheet.tsx`
- Test: `apps/dashboard/src/components/inbox/__tests__/handoff-detail-sheet.test.tsx`

This task builds the sheet's **read + render**: it owns `useEscalationDetail`, renders `HandoffSkeleton` while loading, `HandoffFetchError` (with retry) on error, and the full detail (header / lead / where-it-stands / conversation) on data. Mutations are wired in **Task 5** — for now the component accepts `onReply`/`onResolve` props and renders the composer/resolve UI as inert (the wiring + tests land next task). Port the visual structure from `detail-handoff.jsx`, adapting the trap fields.

**Prop contract (final — Task 5 fills in the behavior):**

```ts
export interface HandoffDetailSheetProps {
  decision: Decision;
  nowMs?: number;
  /** Resolves with whether the reply was delivered now (false = 502 saved-but-undelivered). */
  onReply: (message: string) => Promise<{ delivered: boolean }>;
  /** Resolves when the handoff is marked resolved. */
  onResolve: (resolutionNote?: string) => Promise<void>;
  onClose: () => void;
}
```

- [ ] **Step 1: Write the failing test (render states + trap mapping)**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { Decision } from "@/lib/decisions/types";

const refetchMock = vi.fn();
let detailState: {
  data?: unknown;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
};

vi.mock("@/hooks/use-escalation-detail", () => ({
  useEscalationDetail: () => detailState,
}));

vi.mock("@/components/inbox/inbox-agent-avatar", () => ({
  InboxAgentAvatar: ({ agentKey }: { agentKey: string }) => (
    <span data-testid="agent-avatar" data-agent-key={agentKey} />
  ),
}));

import { HandoffDetailSheet } from "../handoff-detail-sheet";

const NOW = new Date("2026-05-25T09:42:00Z").getTime();

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: "dec_h1",
    kind: "handoff",
    agentKey: "alex",
    humanSummary: "Maya is price-shopping the combo.",
    presentation: { primaryLabel: "", secondaryLabel: "", dismissLabel: "", dataLines: [] },
    urgencyScore: 90,
    createdAt: "2026-05-25T09:30:00Z",
    threadHref: null,
    sourceRef: { kind: "handoff", sourceId: "esc_9" },
    meta: { slaDeadlineAt: "2026-05-25T09:53:00Z" },
    ...overrides,
  };
}

function richPayload() {
  return {
    escalation: {
      id: "esc_9",
      reason: "complex_objection",
      status: "pending",
      slaDeadlineAt: "2026-05-25T09:53:00Z",
      leadSnapshot: {
        name: "Maya Reyes",
        channel: "WhatsApp",
        serviceInterest: "Lip filler combo",
        phone: "+1 (415) 555-0117",
      },
      qualificationSnapshot: { qualificationStage: "Booking-intent", leadScore: 78 },
      conversationSummary: {
        turnCount: 8,
        keyTopics: ["Pricing", "Combo discount"],
        objectionHistory: ["Glow quoted me $900."],
        sentiment: "Frustrated",
        suggestedOpening: "Hi Maya — Dana here.",
      },
    },
    conversationHistory: [
      { role: "user", text: "Why is yours $300 more?", timestamp: "2026-05-25T09:30:00Z" },
      { role: "owner", text: "Let me explain the difference.", timestamp: "2026-05-25T09:35:00Z" },
    ],
  };
}

const noop = () => Promise.resolve({ delivered: true });
const noopResolve = () => Promise.resolve();

beforeEach(() => {
  refetchMock.mockReset();
  detailState = { isLoading: false, isError: false, refetch: refetchMock };
});

describe("HandoffDetailSheet — states", () => {
  it("renders the skeleton while loading", () => {
    detailState = { isLoading: true, isError: false, refetch: refetchMock };
    render(
      <HandoffDetailSheet decision={makeDecision()} onReply={noop} onResolve={noopResolve} onClose={() => {}} nowMs={NOW} />,
    );
    expect(screen.getByTestId("handoff-skeleton")).toBeInTheDocument();
  });

  it("renders the fetch error with a retry that calls refetch", () => {
    detailState = { isLoading: false, isError: true, refetch: refetchMock };
    render(
      <HandoffDetailSheet decision={makeDecision()} onReply={noop} onResolve={noopResolve} onClose={() => {}} nowMs={NOW} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(refetchMock).toHaveBeenCalled();
  });
});

describe("HandoffDetailSheet — data render", () => {
  beforeEach(() => {
    detailState = { data: richPayload(), isLoading: false, isError: false, refetch: refetchMock };
  });

  it("maps the reason enum to a plain-English chip", () => {
    render(
      <HandoffDetailSheet decision={makeDecision()} onReply={noop} onResolve={noopResolve} onClose={() => {}} nowMs={NOW} />,
    );
    expect(screen.getByText("Tricky objection")).toBeInTheDocument();
    expect(screen.getByText(/is handing this to you/i)).toBeInTheDocument();
  });

  it("renders the lead snapshot when present", () => {
    render(
      <HandoffDetailSheet decision={makeDecision()} onReply={noop} onResolve={noopResolve} onClose={() => {}} nowMs={NOW} />,
    );
    expect(screen.getByText("Maya Reyes")).toBeInTheDocument();
    expect(screen.getByText(/Lip filler combo/)).toBeInTheDocument();
  });

  it("maps turn roles: user → lead first name, owner → agent name; uses text not content", () => {
    render(
      <HandoffDetailSheet decision={makeDecision()} onReply={noop} onResolve={noopResolve} onClose={() => {}} nowMs={NOW} />,
    );
    const thread = screen.getByTestId("handoff-thread");
    expect(within(thread).getByText("Why is yours $300 more?")).toBeInTheDocument();
    expect(within(thread).getByText("Maya")).toBeInTheDocument(); // user → lead first name
    expect(within(thread).getByText("Alex")).toBeInTheDocument(); // owner → agent name
  });

  it("renders where-it-stands topics / objections / suggested opening when present", () => {
    render(
      <HandoffDetailSheet decision={makeDecision()} onReply={noop} onResolve={noopResolve} onClose={() => {}} nowMs={NOW} />,
    );
    expect(screen.getByText("Pricing")).toBeInTheDocument();
    expect(screen.getByText(/Glow quoted me \$900\./)).toBeInTheDocument();
    expect(screen.getByText(/Hi Maya — Dana here\./)).toBeInTheDocument();
  });

  it("degrades when snapshots are empty — still shows reason, SLA, and live thread", () => {
    detailState = {
      data: {
        escalation: { id: "esc_9", reason: "human_requested", status: "pending", slaDeadlineAt: "2026-05-25T09:53:00Z", leadSnapshot: { channel: "WhatsApp" }, conversationSummary: {} },
        conversationHistory: [{ role: "user", text: "Can I talk to a person?", timestamp: "2026-05-25T09:40:00Z" }],
      },
      isLoading: false,
      isError: false,
      refetch: refetchMock,
    };
    render(
      <HandoffDetailSheet decision={makeDecision()} onReply={noop} onResolve={noopResolve} onClose={() => {}} nowMs={NOW} />,
    );
    expect(screen.getByText("They asked for you")).toBeInTheDocument();
    expect(screen.getByText("Can I talk to a person?")).toBeInTheDocument();
    // No topics block, no suggested-opening button when summary empty
    expect(screen.queryByRole("button", { name: /start with this/i })).not.toBeInTheDocument();
  });

  it("tolerates an unknown turn role without crashing", () => {
    detailState = {
      data: {
        escalation: { id: "esc_9", reason: "human_requested", status: "pending", conversationSummary: {} },
        conversationHistory: [{ role: "system", text: "session reset", timestamp: "2026-05-25T09:00:00Z" }],
      },
      isLoading: false,
      isError: false,
      refetch: refetchMock,
    };
    render(
      <HandoffDetailSheet decision={makeDecision()} onReply={noop} onResolve={noopResolve} onClose={() => {}} nowMs={NOW} />,
    );
    expect(screen.getByText("session reset")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test handoff-detail-sheet`
Expected: FAIL — cannot resolve `../handoff-detail-sheet`.

- [ ] **Step 3: Write the component**

Create `apps/dashboard/src/components/inbox/handoff-detail-sheet.tsx`. Note the adaptations from the prototype: `turn.text` (not `content`), `role === "user"` → lead, `role === "owner"` → agent, others → role label; lead/summary fields render-if-present. Composer + resolve UI render but their handlers are wired in Task 5 (the `send`/`resolve` calls below already call the props, and Task 5 adds the 200/502 inline branch + state).

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { AGENT_REGISTRY } from "@switchboard/schemas";
import { relativeTime, dueIn } from "@/lib/decisions/time";
import { useEscalationDetail } from "@/hooks/use-escalation-detail";
import { InboxAgentAvatar } from "./inbox-agent-avatar";
import type { Decision } from "@/lib/decisions/types";
import type { ConversationTurn } from "@/hooks/use-escalation-detail";

// Reason enum → plain-English chip (no red/yellow/green; identity-color system).
const REASON_LABELS: Record<string, string> = {
  human_requested: "They asked for you",
  max_turns_exceeded: "Conversation stalled",
  complex_objection: "Tricky objection",
  negative_sentiment: "Tone turned",
  compliance_concern: "Compliance question",
  booking_failure: "Booking didn't go through",
  escalation_timeout: "Waiting too long",
  missing_knowledge: "Needs your knowledge",
  outside_whatsapp_window: "Outside WhatsApp window",
};

const VISIBLE_RECENT = 3;

export interface HandoffDetailSheetProps {
  decision: Decision;
  nowMs?: number;
  /** Resolves with whether the reply was delivered now (false = 502 saved-but-undelivered). */
  onReply: (message: string) => Promise<{ delivered: boolean }>;
  /** Resolves when the handoff is marked resolved. */
  onResolve: (resolutionNote?: string) => Promise<void>;
  onClose: () => void;
}

function SheetShell({
  agentKey,
  onClose,
  children,
}: {
  agentKey: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="sheet ds"
      data-agent={agentKey}
      data-kind="handoff"
      data-open="true"
      role="dialog"
      aria-modal="true"
    >
      <span className="sheet-handle" />
      <button type="button" className="sheet-close" onClick={onClose} aria-label="Close detail">
        ×
      </button>
      {children}
    </div>
  );
}

function HandoffSkeleton({ agentKey, onClose }: { agentKey: string; onClose: () => void }) {
  return (
    <SheetShell agentKey={agentKey} onClose={onClose}>
      <div className="sheet-body ds-body ds-loading" data-testid="handoff-skeleton">
        <div className="ds-sk ds-sk-head" />
        <div className="ds-sk ds-sk-line" />
        <div className="ds-sk ds-sk-card" />
        <div className="ds-sk ds-sk-bubble" />
      </div>
    </SheetShell>
  );
}

function HandoffFetchError({
  agentKey,
  onClose,
  onRetry,
}: {
  agentKey: string;
  onClose: () => void;
  onRetry: () => void;
}) {
  return (
    <SheetShell agentKey={agentKey} onClose={onClose}>
      <div className="sheet-body ds-body ds-fetch-error">
        <div className="ds-eyebrow">Couldn&apos;t load this handoff</div>
        <p>The connection dropped on the way to your team. The list is still safe — try again.</p>
        <button type="button" className="ds-action ds-action-secondary" onClick={onRetry}>
          Try again
        </button>
      </div>
    </SheetShell>
  );
}

export function HandoffDetailSheet({
  decision,
  nowMs = Date.now(),
  onReply,
  onResolve,
  onClose,
}: HandoffDetailSheetProps) {
  const agentName = AGENT_REGISTRY[decision.agentKey]?.displayName ?? decision.agentKey;
  const { data, isLoading, isError, refetch } = useEscalationDetail(decision.sourceRef.sourceId);

  const [draft, setDraft] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [expandThread, setExpandThread] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveNote, setResolveNote] = useState("");
  const [sending, setSending] = useState(false);
  const [resolving, setResolving] = useState(false);
  // Task 5 adds: const [undelivered, setUndelivered] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // Reset composer/resolve state when the open decision changes.
  useEffect(() => {
    setDraft("");
    setSeeded(false);
    setExpandThread(false);
    setResolveOpen(false);
    setResolveNote("");
    setSending(false);
    setResolving(false);
  }, [decision.id]);

  if (isLoading) return <HandoffSkeleton agentKey={decision.agentKey} onClose={onClose} />;
  if (isError || !data)
    return (
      <HandoffFetchError
        agentKey={decision.agentKey}
        onClose={onClose}
        onRetry={() => void refetch()}
      />
    );

  const { escalation, conversationHistory } = data;
  const reasonLabel = (escalation.reason && REASON_LABELS[escalation.reason]) || escalation.reason || "Handed to you";
  const due = dueIn(escalation.slaDeadlineAt, nowMs);

  const lead = escalation.leadSnapshot ?? {};
  const qual = escalation.qualificationSnapshot ?? {};
  const conv = escalation.conversationSummary ?? {};
  const topics = conv.keyTopics ?? [];
  const objections = conv.objectionHistory ?? [];
  const leadFirstName = lead.name ? lead.name.split(/\s/)[0] : "the lead";

  const turns: ConversationTurn[] = Array.isArray(conversationHistory) ? conversationHistory : [];
  const visibleThread = expandThread
    ? turns
    : turns.slice(Math.max(0, turns.length - VISIBLE_RECENT));
  const hiddenCount = turns.length - visibleThread.length;

  const whoFor = (role?: string) =>
    role === "user" ? (lead.name ? leadFirstName : "Lead") : role === "owner" ? agentName : role || "—";

  const useSuggested = () => {
    if (conv.suggestedOpening) {
      setDraft(conv.suggestedOpening);
      setSeeded(true);
      setTimeout(() => taRef.current?.focus(), 30);
    }
  };

  // Task 5 replaces the bodies below with the 200/502 branch + close-on-success.
  const send = async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      await onReply(draft.trim());
    } finally {
      setSending(false);
    }
  };
  const doResolve = async () => {
    if (resolving) return;
    setResolving(true);
    try {
      await onResolve(resolveNote.trim() || undefined);
    } finally {
      setResolving(false);
    }
  };

  return (
    <SheetShell agentKey={decision.agentKey} onClose={onClose}>
      <div className="sheet-body ds-body">
        {/* 1. HEADER */}
        <header className="ds-head">
          <div className="ds-head-id">
            <InboxAgentAvatar agentKey={decision.agentKey} size={36} />
            <div className="ds-head-id-text">
              <div className="ds-head-line">
                <span className="ds-head-name" data-agent={decision.agentKey}>
                  {agentName}
                </span>
                <span className="ds-head-needs">is handing this to you</span>
              </div>
              <div className="ds-head-reason-row">
                <span className="ds-reason-chip">{reasonLabel}</span>
                {due && (
                  <>
                    <span className="ds-dot">·</span>
                    <span className="ds-sla" data-due={due.state}>
                      {due.label}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* 2. THE LEAD */}
        <section className="ds-section ds-lead-section">
          <div className="ds-eyebrow">The lead</div>
          <div className="ds-lead-card">
            <div className="ds-lead-name-row">
              <span className="ds-lead-name">{lead.name ?? "Lead details pending"}</span>
              {lead.channel && <span className="ds-lead-channel">via {lead.channel}</span>}
            </div>
            {lead.serviceInterest && (
              <div className="ds-lead-interest">
                <span className="ds-eyebrow-inline">Asking about</span>
                <span>{lead.serviceInterest}</span>
              </div>
            )}
            {(lead.phone || lead.email) && (
              <div className="ds-lead-contact">
                {lead.phone && (
                  <span>
                    <span className="ds-eyebrow-inline">Phone</span> {lead.phone}
                  </span>
                )}
                {lead.email && (
                  <span>
                    <span className="ds-eyebrow-inline">Email</span> {lead.email}
                  </span>
                )}
              </div>
            )}
            {lead.source && (
              <div className="ds-lead-source">
                <span className="ds-eyebrow-inline">First touch</span>
                <span>{lead.source}</span>
              </div>
            )}
            {(qual.qualificationStage || typeof qual.leadScore === "number") && (
              <div className="ds-qual-line">
                {qual.qualificationStage && (
                  <span className="ds-qual-stage">{qual.qualificationStage}</span>
                )}
                {typeof qual.leadScore === "number" && (
                  <>
                    <span className="ds-dot">·</span>
                    <span className="ds-qual-score">Lead score {qual.leadScore}</span>
                  </>
                )}
              </div>
            )}
          </div>
        </section>

        {/* 3. WHERE IT STANDS */}
        {(conv.sentiment ||
          typeof conv.turnCount === "number" ||
          topics.length > 0 ||
          objections.length > 0 ||
          conv.suggestedOpening) && (
          <section className="ds-section ds-where-section">
            <div className="ds-eyebrow">Where it stands</div>
            <div className="ds-where-meta">
              {conv.sentiment && (
                <span className="ds-where-meta-cell">
                  <span className="ds-eyebrow-inline">Tone</span>
                  <span className="ds-sentiment-word">{conv.sentiment}</span>
                </span>
              )}
              {typeof conv.turnCount === "number" && (
                <span className="ds-where-meta-cell">
                  <span className="ds-eyebrow-inline">Turns</span>
                  <span>{conv.turnCount}</span>
                </span>
              )}
            </div>
            {topics.length > 0 && (
              <div className="ds-where-block">
                <span className="ds-eyebrow-inline">Topics</span>
                <ul className="ds-tag-row">
                  {topics.map((t, i) => (
                    <li key={i} className="ds-tag">
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {objections.length > 0 && (
              <div className="ds-where-block">
                <span className="ds-eyebrow-inline">What they pushed back on</span>
                <ul className="ds-objection-list">
                  {objections.map((o, i) => (
                    <li key={i}>“{o}”</li>
                  ))}
                </ul>
              </div>
            )}
            {conv.suggestedOpening && (
              <div className="ds-suggested">
                <div className="ds-suggested-head">
                  <span className="ds-eyebrow-inline">Suggested opening</span>
                  <span className="ds-suggested-by">— from {agentName}</span>
                </div>
                <p className="ds-suggested-text">{conv.suggestedOpening}</p>
                <button
                  type="button"
                  className="ds-suggested-use"
                  onClick={useSuggested}
                  disabled={seeded}
                  data-seeded={seeded ? "true" : "false"}
                >
                  {seeded ? "Loaded into reply ↓" : "Start with this"}
                </button>
              </div>
            )}
          </section>
        )}

        {/* 4. CONVERSATION */}
        <section className="ds-section ds-thread-section">
          <div className="ds-eyebrow">
            Conversation
            <span className="ds-eyebrow-meta">{turns.length} messages</span>
          </div>
          {hiddenCount > 0 && (
            <button
              type="button"
              className="ds-thread-expand"
              onClick={() => setExpandThread(true)}
            >
              Show {hiddenCount} earlier {hiddenCount === 1 ? "message" : "messages"}
            </button>
          )}
          <ol className="ds-thread" data-testid="handoff-thread">
            {visibleThread.map((turn, i) => (
              <li key={i} className="ds-turn" data-role={turn.role}>
                <div className="ds-turn-meta">
                  <span className="ds-turn-who">{whoFor(turn.role)}</span>
                  <span className="ds-turn-time">{relativeTime(turn.timestamp, nowMs)}</span>
                </div>
                <div className="ds-turn-bubble">{turn.text}</div>
              </li>
            ))}
          </ol>
        </section>

        {/* 5. COMPOSER */}
        <section className="ds-section ds-composer-section">
          <div className="ds-eyebrow">Your reply</div>
          <div className="ds-composer">
            <textarea
              ref={taRef}
              className="ds-composer-textarea"
              rows={6}
              placeholder={`Write to ${leadFirstName}. ${agentName} hands the thread back to you the moment you send.`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="ds-composer-meta">
              <span>
                Sends to {leadFirstName}
                {lead.channel ? ` on ${lead.channel}` : ""} · {agentName} stops replying.
              </span>
              <span className="ds-composer-count" data-warn={draft.length > 600 ? "true" : undefined}>
                {draft.length}
              </span>
            </div>
          </div>
        </section>

        {/* Resolve note (collapsed by default) */}
        {resolveOpen && (
          <section className="ds-section ds-resolve-section">
            <div className="ds-eyebrow">Mark resolved</div>
            <textarea
              className="ds-resolve-note"
              rows={2}
              placeholder="Optional — note what you did (audit log only)"
              value={resolveNote}
              onChange={(e) => setResolveNote(e.target.value)}
            />
            <div className="ds-resolve-actions">
              <button
                type="button"
                className="ds-action ds-action-secondary"
                onClick={() => setResolveOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ds-action ds-action-secondary ds-action-resolve"
                onClick={() => void doResolve()}
                disabled={resolving}
              >
                Mark resolved
              </button>
            </div>
          </section>
        )}
      </div>

      {/* Docked actions */}
      <footer className="ds-actions">
        <button
          type="button"
          className="ds-action ds-action-dismiss"
          onClick={() => setResolveOpen((v) => !v)}
          data-toggled={resolveOpen ? "true" : undefined}
        >
          Mark resolved
        </button>
        <button
          type="button"
          className="ds-action ds-action-primary ds-action-send"
          onClick={() => void send()}
          disabled={!draft.trim() || sending}
        >
          Send &amp; hand back to {agentName}
        </button>
      </footer>
    </SheetShell>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test handoff-detail-sheet`
Expected: PASS (all render-state + trap-mapping cases).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/inbox/handoff-detail-sheet.tsx apps/dashboard/src/components/inbox/__tests__/handoff-detail-sheet.test.tsx
git commit -m "feat(inbox): handoff detail sheet read + render with trap mapping"
```

---

## Task 5: Reply (200/502 branch) + resolve wiring inside the sheet

**Files:**
- Modify: `apps/dashboard/src/components/inbox/handoff-detail-sheet.tsx`
- Modify: `apps/dashboard/src/components/inbox/__tests__/handoff-detail-sheet.test.tsx`

Wire the composer + resolve to the `onReply`/`onResolve` callbacks. On reply: `await onReply(draft)` → `{ delivered }`. If `delivered`, close the sheet (parent toasts). If **not** delivered (502 saved-but-undelivered), keep the sheet open and show an inline "saved — couldn't deliver right now" banner (do NOT close, do NOT treat as error). On resolve: `await onResolve(note)` → close on success.

- [ ] **Step 1: Add the failing behavior tests**

Append to `handoff-detail-sheet.test.tsx` (inside the data-render `describe`, reusing `richPayload`):

```tsx
describe("HandoffDetailSheet — reply & resolve", () => {
  beforeEach(() => {
    detailState = { data: richPayload(), isLoading: false, isError: false, refetch: refetchMock };
  });

  it("loads the suggested opening into the composer", () => {
    render(
      <HandoffDetailSheet decision={makeDecision()} onReply={noop} onResolve={noopResolve} onClose={() => {}} nowMs={NOW} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /start with this/i }));
    expect(screen.getByPlaceholderText(/Write to Maya/)).toHaveValue("Hi Maya — Dana here.");
  });

  it("sends the reply and closes when delivered", async () => {
    const onReply = vi.fn(() => Promise.resolve({ delivered: true }));
    const onClose = vi.fn();
    render(
      <HandoffDetailSheet decision={makeDecision()} onReply={onReply} onResolve={noopResolve} onClose={onClose} nowMs={NOW} />,
    );
    fireEvent.change(screen.getByPlaceholderText(/Write to Maya/), { target: { value: "On a call now." } });
    fireEvent.click(screen.getByRole("button", { name: /hand back to Alex/i }));
    await waitFor(() => expect(onReply).toHaveBeenCalledWith("On a call now."));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("keeps the sheet open and shows the saved-but-undelivered banner on 502", async () => {
    const onReply = vi.fn(() => Promise.resolve({ delivered: false }));
    const onClose = vi.fn();
    render(
      <HandoffDetailSheet decision={makeDecision()} onReply={onReply} onResolve={noopResolve} onClose={onClose} nowMs={NOW} />,
    );
    fireEvent.change(screen.getByPlaceholderText(/Write to Maya/), { target: { value: "Hi." } });
    fireEvent.click(screen.getByRole("button", { name: /hand back to Alex/i }));
    await waitFor(() => expect(screen.getByText(/couldn't deliver/i)).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("opens the resolve note, resolves, and closes", async () => {
    const onResolve = vi.fn(() => Promise.resolve());
    const onClose = vi.fn();
    render(
      <HandoffDetailSheet decision={makeDecision()} onReply={noop} onResolve={onResolve} onClose={onClose} nowMs={NOW} />,
    );
    // Footer "Mark resolved" toggles the note section open.
    fireEvent.click(screen.getAllByRole("button", { name: /^mark resolved$/i })[0]);
    fireEvent.change(screen.getByPlaceholderText(/note what you did/i), {
      target: { value: "Closed by phone." },
    });
    // The in-section "Mark resolved" dispatches.
    const resolveButtons = screen.getAllByRole("button", { name: /^mark resolved$/i });
    fireEvent.click(resolveButtons[resolveButtons.length - 1]);
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith("Closed by phone."));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
```

Add `waitFor` to the testing-library import at the top of the file:

```tsx
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm --filter @switchboard/dashboard test handoff-detail-sheet`
Expected: the four new cases FAIL (no banner on 502; sheet doesn't close on delivered/resolve).

- [ ] **Step 3: Wire the handlers**

In `handoff-detail-sheet.tsx`, add the undelivered state next to the other `useState`s:

```tsx
  const [undelivered, setUndelivered] = useState(false);
```

Add `setUndelivered(false);` to the reset `useEffect` body. Then replace the `send` / `doResolve` bodies with:

```tsx
  const send = async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    setUndelivered(false);
    try {
      const { delivered } = await onReply(draft.trim());
      if (delivered) {
        onClose();
      } else {
        setUndelivered(true); // 502 — reply saved, channel delivery failed
      }
    } finally {
      setSending(false);
    }
  };
  const doResolve = async () => {
    if (resolving) return;
    setResolving(true);
    try {
      await onResolve(resolveNote.trim() || undefined);
      onClose();
    } finally {
      setResolving(false);
    }
  };
```

Add the inline banner inside `.ds-composer-section`, right after the `.ds-composer-meta` block (still inside `.ds-composer`):

```tsx
            {undelivered && (
              <div className="ds-banner" data-state="undelivered" role="status">
                Saved — but we couldn&apos;t deliver it to {leadFirstName} right now. Try again, or
                reach out directly.
              </div>
            )}
```

(The `send` button's `onClick` already calls `void send()` and the resolve button calls `void doResolve()` from Task 4 — no footer change needed.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/dashboard test handoff-detail-sheet`
Expected: PASS (all render + reply/resolve cases).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/inbox/handoff-detail-sheet.tsx apps/dashboard/src/components/inbox/__tests__/handoff-detail-sheet.test.tsx
git commit -m "feat(inbox): wire handoff reply 200/502 + resolve in detail sheet"
```

---

## Task 6: Wire `HandoffDetailItem` into `inbox-screen.tsx` (replace the guard)

**Files:**
- Modify: `apps/dashboard/src/components/inbox/inbox-screen.tsx`
- Modify: `apps/dashboard/src/components/inbox/__tests__/inbox-screen.test.tsx`

Add a screen-level `HandoffDetailItem` wrapper (mirroring `ApprovalDetailItem`) that owns the mutation hooks (`useEscalationReply` + `useEscalationResolve`), the toasts, and decision-feed invalidation, and renders `HandoffDetailSheet`. Replace the `inbox-handoff-guard` div with it. The wrapper maps the reply hook's `{ ok }` → the sheet's `{ delivered }` contract, toasts on both branches, and invalidates `decisions.all()` so the handled handoff leaves the inbox.

- [ ] **Step 1: Update the screen test**

In `inbox-screen.test.tsx`, add hook mocks near the existing `vi.mock` block:

```tsx
const escalationDetailState = {
  data: {
    escalation: { id: "esc_9", reason: "human_requested", status: "pending", conversationSummary: {}, leadSnapshot: { channel: "WhatsApp" } },
    conversationHistory: [],
  },
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};
vi.mock("@/hooks/use-escalation-detail", () => ({
  useEscalationDetail: () => escalationDetailState,
}));
const sendMock = vi.fn(() => Promise.resolve({ ok: true, escalation: { id: "esc_9" } }));
const resolveMock = vi.fn(() => Promise.resolve());
vi.mock("@/hooks/use-escalation-reply", () => ({
  useEscalationReply: () => ({ send: sendMock, isPending: false }),
}));
vi.mock("@/hooks/use-escalation-resolve", () => ({
  useEscalationResolve: () => ({ resolve: resolveMock, isPending: false }),
}));
```

Add a test that opening a handoff renders the real sheet (no more guard):

```tsx
it("opens the handoff detail sheet when a handoff card is tapped (no guard placeholder)", () => {
  feedByKey = (agentKey) =>
    agentKey === null
      ? { data: { decisions: [handoffDecision] }, isLoading: false, isError: false, refetch: vi.fn() }
      : { data: { decisions: [handoffDecision] }, isLoading: false, isError: false, refetch: vi.fn() };

  render(<InboxScreen />);
  // Open the detail (the InboxDecisionItem exposes an open affordance — reuse the
  // existing card-tap target the suite already uses for approvals).
  fireEvent.click(screen.getByText(handoffDecision.humanSummary));

  expect(screen.queryByText(/handoff detail coming next/i)).not.toBeInTheDocument();
  expect(screen.getByText(/is handing this to you/i)).toBeInTheDocument();
});
```

Add the `handoffDecision` fixture alongside the existing `makeDecision` helper:

```tsx
const handoffDecision = makeDecision({
  id: "dec_h1",
  kind: "handoff",
  humanSummary: "Maya is price-shopping the combo.",
  sourceRef: { kind: "handoff", sourceId: "esc_9" },
  meta: { slaDeadlineAt: "2026-05-25T09:53:00Z" },
});
```

> Implementer note: match the suite's existing open-affordance. The current `inbox-screen.test.tsx` already drives `InboxDecisionItem.onOpenDetail` for approvals — open the handoff the same way that suite opens an approval (inspect the existing approval-open test and reuse its trigger), rather than inventing a new selector.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test inbox-screen`
Expected: FAIL — the guard text is still rendered / the sheet is not present.

- [ ] **Step 3: Add the wrapper and replace the guard**

In `inbox-screen.tsx`, add imports:

```tsx
import { useQueryClient } from "@tanstack/react-query";
import { useEscalationReply } from "@/hooks/use-escalation-reply";
import { useEscalationResolve } from "@/hooks/use-escalation-resolve";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import { HandoffDetailSheet } from "@/components/inbox/handoff-detail-sheet";
```

Add the wrapper component above `InboxScreen` (next to `ApprovalDetailItem`):

```tsx
// ── HandoffDetailItem ──────────────────────────────────────────────────────────
// Mounted ONLY when a handoff detail is open — owns the reply/resolve hooks +
// toasts + decision-feed invalidation, so the sheet stays presentational and no
// hook runs inside the list loop. Mirrors ApprovalDetailItem.

interface HandoffDetailItemProps {
  decision: Decision;
  onClose: () => void;
}

function HandoffDetailItem({ decision, onClose }: HandoffDetailItemProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  const escalationId = decision.sourceRef.sourceId;
  const reply = useEscalationReply(escalationId);
  const resolve = useEscalationResolve(escalationId);

  const agentName = AGENT_REGISTRY[decision.agentKey]?.displayName ?? decision.agentKey;

  const invalidateFeed = () => {
    if (keys) void queryClient.invalidateQueries({ queryKey: keys.decisions.all() });
  };

  const handleReply = async (message: string): Promise<{ delivered: boolean }> => {
    const result = await reply.send(message); // { ok, escalation, error? } — ok:false = 502
    invalidateFeed(); // the escalation is released on both 200 and 502
    if (result.ok) {
      toast({ title: "Handed back", description: `${agentName} stopped replying.` });
    } else {
      toast({
        title: "Saved — not delivered",
        description: "We couldn't deliver the reply right now.",
      });
    }
    return { delivered: result.ok };
  };

  const handleResolve = async (resolutionNote?: string): Promise<void> => {
    await resolve.resolve(resolutionNote);
    invalidateFeed();
    toast({ title: "Marked resolved" });
  };

  return (
    <HandoffDetailSheet
      decision={decision}
      onReply={handleReply}
      onResolve={handleResolve}
      onClose={onClose}
    />
  );
}
```

Replace the guard branch:

```tsx
      {open?.kind === "handoff" && (
        <div className="inbox-handoff-guard">Handoff detail coming next.</div>
      )}
```

with:

```tsx
      {open?.kind === "handoff" && (
        <HandoffDetailItem decision={open.decision} onClose={() => setOpen(null)} />
      )}
```

- [ ] **Step 4: Run the screen + the full inbox suite**

Run: `pnpm --filter @switchboard/dashboard test inbox-screen`
Expected: PASS.

Then the whole slice (no regressions):

Run: `pnpm --filter @switchboard/dashboard test inbox decisions home escalation handoff`
Expected: PASS — Home + PR2 + the PR3a approval sheet/screen suites all green.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/inbox/inbox-screen.tsx apps/dashboard/src/components/inbox/__tests__/inbox-screen.test.tsx
git commit -m "feat(inbox): mount handoff detail sheet, replace pr3a guard"
```

---

## Final verification (before opening the PR)

Run from the worktree root:

- [ ] `pnpm --filter @switchboard/dashboard test inbox decisions home escalation handoff` — full slice green; Home + PR2 + PR3a approval suites unchanged.
- [ ] `pnpm typecheck` — clean (run `pnpm reset` first only if it reports stale `@switchboard/*` exports).
- [ ] `pnpm format:check` — clean (CI runs prettier; local lint does not — this catches it).
- [ ] `pnpm --filter @switchboard/dashboard build` — `next build` (NOT in CI; only it catches `.js`-less import + RSC boundary issues).
- [ ] **Grep-guard:** confirm no stray `inbox-handoff-guard` remains and the sheet is wired:
  - `git grep -n "inbox-handoff-guard" apps/dashboard/src` → empty.
  - `git grep -n "HandoffDetailSheet\|useEscalationDetail\|useEscalationResolve" apps/dashboard/src` → present in the expected files only.

## Invariants (must hold across every task)

- **No backend changes.** If wiring hits a true blocker, STOP and report it; do not expand scope into the three spec follow-up buckets.
- **No CSS work** — plain classnames only (PR4 polish ports `inbox.css`).
- **Do not touch** the merged PR2 `InboxDecisionCard` or the PR3a `ApprovalDetailSheet` visuals.
- **Home swipe must not regress**; `isError`-before-empty in the screen stays held.
- Lowercase commit subjects (commitlint rejects uppercase).
- Reply/resolve hit ESCALATION endpoints keyed by `sourceRef.sourceId`, never recommendations.

## Self-review (completed against the spec)

- **Spec coverage:** read hook (Task 2) ✓ · resolve hook (Task 3, spec's "resolve dispatch") ✓ · header/lead/where-it-stands/conversation render + degrade (Task 4) ✓ · reply 200/502 + suggested-opening + resolve (Task 5) ✓ · screen wiring replacing the guard + feed invalidation + toasts (Task 6) ✓. All five correctness traps land in Task 4 (text/role/timestamp, unknown-role tolerance, degrade) and Task 5/6 (reply 200/502, resolve, escalation-id source). The four DEFER-data snapshot sections render-if-present.
- **Placeholder scan:** every code step shows full code; no "add error handling"/"similar to" stubs.
- **Type consistency:** `onReply: (message) => Promise<{ delivered: boolean }>` and `onResolve: (note?) => Promise<void>` are used identically in Tasks 4, 5, and 6; `useEscalationDetail` return is consumed as `{ data, isLoading, isError, refetch }` in Task 4 and mocked with that exact shape in Tasks 4 & 6; `useEscalationResolve` exposes `{ resolve, isPending }` consistently in Tasks 3 & 6; `escalations.detail(id)` defined in Task 1 is consumed in Task 2.
