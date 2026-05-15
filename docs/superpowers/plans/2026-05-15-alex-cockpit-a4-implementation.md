# Alex Cockpit A.4 — Activity Richness + Thread Previews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Alex cockpit's full activity stream — server-side translator (`packages/core/src/agent-home/cockpit-activity-translator.ts`) that consumes the audit ledger + a batched `ActivityPreviewReader`, a new per-agent endpoint (`GET /api/dashboard/agents/[agentId]/activity`), a new TanStack Query hook (`use-agent-activity-cockpit.ts`), a new `<ThreadPreview>` component, and an expansion-capable `<ActivityRow>` that renders `body` + thread excerpt + "Tell Alex about {firstName}" + "Send as me" affordances. The cockpit page swaps from `useAgentActivity` + the client-side kind-map to the new hook; the legacy hook + kind-map stay in place until A.6 retires the agent-home block components.

**Architecture:** Five layers move in lockstep without crossing the adapter boundary or the surface-agnostic backend invariant. **Core** declares `CockpitActivityRow` + `ActivityPreviewReader` interface + a pure translator that batches preview fetches via a single `readRecentBatch` call. **DB** implements `PrismaActivityPreviewReader`. **API** registers the new Fastify route under `agent-home/`, wires `PrismaActivityPreviewReader` + the audit query, and asserts compile-time shape-equivalence between `CockpitActivityRow` and the dashboard's `ActivityRow`. **Dashboard proxy** mirrors the existing per-agent proxy pattern. **Dashboard adapters/components** add the hook, the `<ThreadPreview>` component, and the expansion behavior on `<ActivityRow>` + `<ActivityStream>`. No Prisma migration. No new Zod schemas. No new mutation paths.

**Tech Stack:** Vitest (all layers), TypeScript ESM (relative imports carry `.js` per `CLAUDE.md`; dashboard imports omit `.js` per `feedback_dashboard_no_js_on_any_import`), Next.js 14 App Router + React 18 + `@tanstack/react-query` (dashboard), Fastify (api), Prisma (db). All five layers use the mocked-Prisma test pattern (`feedback_api_test_mocked_prisma.md`).

**Parent docs:**
- [`docs/superpowers/plans/2026-05-15-alex-cockpit-a4-slice-brief.md`](./2026-05-15-alex-cockpit-a4-slice-brief.md) — scope, what-ships-vs-defers, risks.
- [`docs/superpowers/specs/2026-05-14-alex-cockpit-home-design.md`](../specs/2026-05-14-alex-cockpit-home-design.md) — §A.4, §Activity stream, §Backend changes §5 (authoritative).
- [`docs/superpowers/plans/2026-05-15-riley-cockpit-b3-implementation.md`](./2026-05-15-riley-cockpit-b3-implementation.md) — structural template (B.3 precedent for layered TDD slice).
- [`docs/superpowers/plans/2026-05-14-alex-cockpit-a2-implementation.md`](./2026-05-14-alex-cockpit-a2-implementation.md) — mission popover plan (A.2 sibling that introduced the per-agent endpoint pattern A.4 extends).
- [`docs/superpowers/plans/2026-05-15-alex-cockpit-a3-implementation.md`](./2026-05-15-alex-cockpit-a3-implementation.md) — KPI/ROI plan (A.3 sibling that introduced `getAgentTargets` and the `apps/api/src/lib/*-provider.ts` wiring pattern A.4 mirrors).

> **The umbrella spec is authoritative.** If anything in this plan expands A.4's scope beyond the slice brief — new activity kinds, server-side filters, new mutation paths, inline-send wiring, Riley preview wiring — the spec wins and the conflicting text in this plan is wrong. Resolve in favor of the umbrella spec and flag the discrepancy.

---

## Precondition checks

Run before Task 1.

- [ ] **Step 0a: Confirm worktree, branch, and base.**

```bash
git branch --show-current
git status --short
git log --oneline origin/main..HEAD
```

Expected: branch `feat/alex-cockpit-a4` (implementation branch, not the docs branch). Status clean. The log shows zero commits ahead of `origin/main` at start of implementation. If commits exist, verify they belong to this slice; otherwise stop.

- [ ] **Step 0b: Verify A.3 artifacts exist on `main`.**

```bash
ls apps/dashboard/src/components/cockpit/cockpit-page.tsx \
   apps/dashboard/src/components/cockpit/activity-stream.tsx \
   apps/dashboard/src/components/cockpit/activity-row.tsx \
   apps/dashboard/src/components/cockpit/types.ts \
   apps/dashboard/src/hooks/use-agent-activity.ts \
   apps/dashboard/src/lib/cockpit/activity-kind-map.ts \
   packages/core/src/agent-home/targets.ts \
   packages/db/src/prisma-message-history-reader.ts \
   apps/api/src/routes/agent-home/mission.ts \
   apps/api/src/routes/agent-home/metrics.ts
```

Expected: all 10 files exist. If any is missing, the A.3 baseline has shifted — stop and investigate.

- [ ] **Step 0c: Verify `ActivityRow` already declares the full superset.**

```bash
grep -n "body\|who\|preview\|replyable\|tag" apps/dashboard/src/components/cockpit/types.ts
```

Expected: the lines `body?: string`, `who?: string`, `preview?: ThreadMessage[]`, `replyable?: boolean`, `tag?: string` exist under `interface ActivityRow`. A.4 populates fields the type already declares.

- [ ] **Step 0d: Verify `ConversationMessage` model + index.**

```bash
grep -n "model ConversationMessage\|@@index.*contactId" packages/db/prisma/schema.prisma
```

Expected: `model ConversationMessage` exists with `@@index([contactId, orgId])`. The translator's batched query relies on this index.

- [ ] **Step 0e: Verify `cockpit-page.tsx` still consumes `useAgentActivity` + the client-side kind-map.**

```bash
grep -n "useAgentActivity\|translatedActionToActivityRow" \
  apps/dashboard/src/components/cockpit/cockpit-page.tsx
```

Expected: both symbols imported and called. A.4 replaces the call site; if another PR already migrated it, investigate before adding redundant code.

- [ ] **Step 0f: Verify baseline tests pass.**

```bash
pnpm --filter @switchboard/core test -- --run agent-home && \
  pnpm --filter @switchboard/db test -- --run prisma && \
  pnpm --filter @switchboard/api test -- --run agent-home && \
  pnpm --filter @switchboard/dashboard test -- --run cockpit
```

Expected: all green. Pre-existing `prisma-work-trace-store-integrity` / `prisma-greeting-signal-store` flakes may be ignored if they reproduce on the baseline branch (per `feedback_db_integrity_tests_pg_advisory_lock.md`).

- [ ] **Step 0g: Verify dev stack builds.**

```bash
pnpm reset
pnpm typecheck
```

Expected: clean. `pnpm reset` clears stale `dist/` + regenerates Prisma + rebuilds schemas → core → db (per `CLAUDE.md` reset doctrine). Skipping this step before adding new core/db exports causes false-alarm "main is broken" typechecks.

---

## File Structure

### Files created

| Path | Responsibility |
|---|---|
| `packages/core/src/agent-home/activity-preview-reader.ts` | `ActivityPreviewReader` interface + `ThreadMessageRecord` type. Pure types, no runtime. |
| `packages/core/src/agent-home/__tests__/activity-preview-reader.test.ts` | In-memory stub asserting interface shape compiles. |
| `packages/core/src/agent-home/contact-snapshot-extractors.ts` | Per-event-type pure functions: `extractContactRef(eventType, snapshot)` returning `{ contactId, displayName } \| null`. |
| `packages/core/src/agent-home/__tests__/contact-snapshot-extractors.test.ts` | One case per event type + unknown-event fallback + malformed-snapshot tolerance. |
| `packages/core/src/agent-home/cockpit-activity-row.ts` | `CockpitActivityRow` + `CockpitThreadMessage` type declarations (Layer 3 mirror of the dashboard's `ActivityRow` / `ThreadMessage`). |
| `packages/core/src/agent-home/cockpit-activity-translator.ts` | `translateAuditToCockpitActivity(args)`: audit entries + preview reader → `CockpitActivityRow[]`. Owns batched preview fetch, kind classification, body templates, `who` resolution. |
| `packages/core/src/agent-home/__tests__/cockpit-activity-translator.test.ts` | Per-kind translation, batched fetch, `expandPreview=false` short-circuit, missing-contact fallback, malformed-audit tolerance. |
| `packages/db/src/prisma-activity-preview-reader.ts` | `class PrismaActivityPreviewReader implements ActivityPreviewReader` — Prisma impl with batched `readRecentBatch`. |
| `packages/db/src/__tests__/prisma-activity-preview-reader.test.ts` | Mocked-Prisma single + batch reads. |
| `apps/api/src/lib/cockpit-activity-deps.ts` | Dependency wiring: builds an `ActivityPreviewReader` from a `PrismaClient` + binds the audit query function. |
| `apps/api/src/routes/agent-home/activity.ts` | Fastify route `GET /agents/:agentId/activity`. |
| `apps/api/src/routes/agent-home/__tests__/activity.test.ts` | Route unit test using in-memory audit fixture + mocked Prisma. |
| `apps/api/src/__tests__/api-cockpit-activity.test.ts` | Server-level integration via `buildTestServer`. |
| `apps/api/src/__tests__/cockpit-activity-row-mirror.test.ts` | Compile-time shape-equivalence assertion: `CockpitActivityRow` (core) ≡ `ActivityRow` (dashboard). |
| `apps/dashboard/src/app/api/dashboard/agents/[agentId]/activity/route.ts` | Next.js proxy. |
| `apps/dashboard/src/app/api/dashboard/agents/[agentId]/activity/__tests__/route.test.ts` | Proxy auth + happy path. |
| `apps/dashboard/src/hooks/use-agent-activity-cockpit.ts` | TanStack Query hook returning `{ rows: ActivityRow[] }`. |
| `apps/dashboard/src/hooks/__tests__/use-agent-activity-cockpit.test.ts` | Hook wiring + query key + 30s refetch. |
| `apps/dashboard/src/components/cockpit/thread-preview.tsx` | `<ThreadPreview messages who contactId />` component. |
| `apps/dashboard/src/components/cockpit/__tests__/thread-preview.test.tsx` | Render + "Send as me" navigation. |

### Files modified

| Path | Change | Why touched |
|---|---|---|
| `packages/core/src/index.ts` | Add barrel exports for `ActivityPreviewReader`, `CockpitActivityRow`, `CockpitThreadMessage`, `translateAuditToCockpitActivity`, `extractContactRef`. | Layer 3 surface. |
| `packages/db/src/index.ts` | Add barrel export for `PrismaActivityPreviewReader`. | Layer 4 surface. |
| `apps/api/src/bootstrap/routes.ts` | Register the new `agent-home/activity.ts` route under the existing `agent-home` group. | Wiring. |
| `apps/dashboard/src/components/cockpit/types.ts` | Add optional `id?: string` field and `contactId?: string` field to `ActivityRow`. | Wire-shape extension. |
| `apps/dashboard/src/components/cockpit/activity-row.tsx` | Replace unused `_open` / `_toggle` with real expansion state. Render `body`, `<ThreadPreview>`, "Tell Alex about" affordance, chevron. | Core of the slice. |
| `apps/dashboard/src/components/cockpit/__tests__/activity-row.test.tsx` | Extend / create. | Coverage. |
| `apps/dashboard/src/components/cockpit/activity-stream.tsx` | Manage per-row open state keyed by `row.id ?? legacy-key`. Forward `open` + `toggle` to `<ActivityRow>`. | Open-state owner. |
| `apps/dashboard/src/components/cockpit/__tests__/activity-stream.test.tsx` | Extend. | Coverage. |
| `apps/dashboard/src/components/cockpit/cockpit-page.tsx` | Replace `useAgentActivity` + `translatedActionToActivityRow` with `useAgentActivityCockpit`. | Call-site swap. |
| `apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx` | Extend. | Coverage. |

### Files explicitly NOT modified

- `apps/dashboard/src/hooks/use-agent-activity.ts` — legacy hook stays mounted; A.6 deletes after zero-reference verification.
- `apps/dashboard/src/lib/cockpit/activity-kind-map.ts` — legacy translator stays mounted; A.6 deletes.
- `apps/dashboard/src/components/activity/event-translator.ts` — legacy event-to-text; untouched.
- `apps/api/src/routes/dashboard-activity.ts` — legacy `/api/dashboard/activity` browse view; untouched.
- `apps/api/src/services/activity-translator.ts` — feeds the legacy browse view; untouched.
- `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx` — Riley's stream stays on its B.1 baseline; Riley does not consume A.4.
- `apps/dashboard/src/components/cockpit/kind-meta.ts` — kinds unchanged.
- `apps/dashboard/src/components/cockpit/cockpit-page.tsx` props or composition order — only the activity-source swap.
- `packages/db/prisma/schema.prisma` — no migration. `ConversationMessage` already has the needed columns + index.
- `packages/schemas/**` — no schema layer changes.

---

## Adapter-boundary invariant (unchanged from A.1–A.3 and Riley B.1/B.3)

A.4 adds **zero** new imports of `Recommendation` / `AuditEntry` / `@switchboard/db` / `@prisma` / `@switchboard/schemas/recommendations` / `@switchboard/schemas/audit` under `apps/dashboard/src/components/cockpit/**` or `apps/dashboard/src/hooks/use-agent-*`. The new `use-agent-activity-cockpit.ts` consumes the wire shape `{ rows: ActivityRow[] }` from the Next.js proxy. The Prisma `ConversationMessage` model is read **only** under `packages/db/src/prisma-activity-preview-reader.ts`.

Pre-merge grep gate (Task 14):

```bash
rg "Recommendation|AuditEntry|@switchboard/db|@prisma" \
   apps/dashboard/src/components/cockpit \
   apps/dashboard/src/hooks
```

Expected: same set of matches as `main` before A.4 — no new matches.

## Surface-agnostic backend invariant (per `feedback_surface_agnostic_backend.md`)

Core / schemas / db packages do not reference UI surfaces. The translator lives in `packages/core/src/agent-home/` and consumes audit-domain types + the `ActivityPreviewReader` interface — no `apps/dashboard` imports. The Prisma reader lives in `packages/db/src/` and depends only on `@switchboard/core`. `CockpitActivityRow` is declared in core; the dashboard's `ActivityRow` is a parallel declaration. The mirror assertion lives in **`apps/api`** (Layer 5), where cross-layer imports are permitted.

---

## Body-copy template table (locked)

The translator emits `body` strings per kind. **All lines are first-person from Alex or descriptive of the operator-relevant state. No causal-impact claims** (honest-impact-language guardrail carries from B.2 / B.3).

| Kind | Body template | Source for `{...}` interpolations |
|---|---|---|
| `booked` | `"Calendar held. {note ?? ''}"`.trim() | `snapshot.booking.note` |
| `qualified` | Last inbound excerpt (≤120 chars) or `"Qualified."` if no inbound | `previewReader` first inbound message |
| `replied` | Reply summary (≤120 chars) or `"Replied."` | `snapshot.message.summary` or first outbound message |
| `sent` | `"{templateName} · {filter ?? ''}".trim()` | `snapshot.template.name`, `snapshot.template.filter` |
| `started` | `"Quiet hours: {quietHours}"` if `snapshot.quietHours`, else `"Daily run begins."` | `snapshot.quietHours` |
| `connected` | `"{N} new leads · {source}"` if `snapshot.batch.count`, else `"New leads pulled."` | `snapshot.batch.count`, `snapshot.batch.source` |
| `waiting` | `snapshot.approval.summary ?? "Awaiting your call."` | `snapshot.approval.summary` |
| `escalated` | `snapshot.escalation.reason ?? "Routed to your inbox."` | `snapshot.escalation.reason` |
| `passed` | `snapshot.disqualification.reason ?? "Passed."` | `snapshot.disqualification.reason` |

Empty/missing fallback values are the **right column**. The translator never emits `body: ""` — if the template resolves to empty, `body` is omitted entirely (the row stays head-only).

---

## Head-copy template table (locked)

The translator emits `head` strings — already partially-implemented by the legacy `event-translator.ts` for `TranslatedAction.text`. A.4 re-derives heads from snapshot data to gain `{contactName}` interpolation that the legacy translator lacks.

| Kind | Head template |
|---|---|
| `booked` | `"{contactDisplayName} confirmed {service} {when}"` (fallback `"Booking confirmed"`) |
| `qualified` | `"{contactDisplayName} qualified — {qualifier}"` (fallback `"Lead qualified"`) |
| `replied` | `"{contactDisplayName} · {topic}"` (fallback `"Reply sent"`) |
| `sent` | `"Morning batch · {N} follow-ups"` (fallback `"Batch sent"`) |
| `started` | `"Daily run begins"` (no interpolation) |
| `connected` | `"Pulled {N} new leads from {source}"` (fallback `"New leads pulled"`) |
| `waiting` | `"Awaiting your call on {topic}"` (fallback `"Awaiting your call"`) |
| `escalated` | `"{topic} from {contactDisplayName} → your inbox"` (fallback `"Escalated to your inbox"`) |
| `passed` | `"{contactDisplayName} — {reason}"` (fallback `"Passed"`) |

`{service}` / `{when}` / `{qualifier}` / `{topic}` / `{N}` / `{source}` / `{reason}` come from `snapshot.*`. Missing values trigger the fallback — never an empty head.

---

## Tasks

### Task 1: Declare `ActivityPreviewReader` interface in core

**Files:**
- Create: `packages/core/src/agent-home/activity-preview-reader.ts`
- Create: `packages/core/src/agent-home/__tests__/activity-preview-reader.test.ts`

- [ ] **Step 1: Write the failing test.**

Create `packages/core/src/agent-home/__tests__/activity-preview-reader.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type {
  ActivityPreviewReader,
  ThreadMessageRecord,
} from "../activity-preview-reader.js";

describe("ActivityPreviewReader", () => {
  it("compiles against an in-memory stub", async () => {
    const stub: ActivityPreviewReader = {
      async readRecentBatch({ contactIds, orgId, limit }) {
        const out: Record<string, ThreadMessageRecord[]> = {};
        for (const id of contactIds) {
          out[id] = [
            {
              from: "contact",
              text: `hello from ${id} in ${orgId}`,
              createdAt: new Date(0).toISOString(),
            },
          ].slice(0, limit);
        }
        return out;
      },
    };
    const result = await stub.readRecentBatch({
      contactIds: ["c1", "c2"],
      orgId: "o1",
      limit: 4,
    });
    expect(result.c1).toHaveLength(1);
    expect(result.c2![0]!.text).toContain("c2");
  });
});
```

Run: `pnpm --filter @switchboard/core test -- --run activity-preview-reader` — expect compile error (file doesn't exist).

- [ ] **Step 2: Create `packages/core/src/agent-home/activity-preview-reader.ts`.**

```ts
export interface ThreadMessageRecord {
  from: "contact" | "alex" | "operator";
  text: string;
  createdAt: string;
}

export interface ActivityPreviewReader {
  readRecentBatch(args: {
    contactIds: readonly string[];
    orgId: string;
    limit: number;
  }): Promise<Record<string, ThreadMessageRecord[]>>;
}
```

Run the test — expect green.

- [ ] **Step 3: Add barrel exports.**

Edit `packages/core/src/index.ts` to export the new types:

```ts
export type {
  ActivityPreviewReader,
  ThreadMessageRecord,
} from "./agent-home/activity-preview-reader.js";
```

Verify: `pnpm --filter @switchboard/core typecheck` clean.

- [ ] **Step 4: Commit.**

Commit message:

```
feat(core): A.4 — ActivityPreviewReader interface for batched thread previews

Layer 3 surface-agnostic contract. Consumed by the cockpit activity
translator (next task) and implemented by PrismaActivityPreviewReader
(packages/db, task 4). readRecentBatch is the canonical batched-fetch
shape — one Prisma findMany per request, regardless of how many unique
contacts the audit window references.
```

---

### Task 2: Add `contact-snapshot-extractors.ts` in core

**Files:**
- Create: `packages/core/src/agent-home/contact-snapshot-extractors.ts`
- Create: `packages/core/src/agent-home/__tests__/contact-snapshot-extractors.test.ts`

- [ ] **Step 1: Write the failing test.**

Create `packages/core/src/agent-home/__tests__/contact-snapshot-extractors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { extractContactRef } from "../contact-snapshot-extractors.js";

describe("extractContactRef", () => {
  it("reads contactId from booking.create snapshot", () => {
    expect(
      extractContactRef("booking.create", {
        booking: { contactId: "c-123", contactDisplayName: "Maya Lin" },
      }),
    ).toEqual({ contactId: "c-123", displayName: "Maya Lin" });
  });

  it("reads contactId from lifecycle.qualified snapshot", () => {
    expect(
      extractContactRef("lifecycle.qualified", {
        contactId: "c-456",
        contact: { displayName: "Jordan F." },
      }),
    ).toEqual({ contactId: "c-456", displayName: "Jordan F." });
  });

  it("reads contactId from message.sent snapshot", () => {
    expect(
      extractContactRef("message.sent", {
        message: { contactId: "c-789", contactDisplayName: "Sam R." },
      }),
    ).toEqual({ contactId: "c-789", displayName: "Sam R." });
  });

  it("reads contactId from approval.created snapshot", () => {
    expect(
      extractContactRef("approval.created", {
        approval: { contactId: "c-321", contactDisplayName: "Pat K." },
      }),
    ).toEqual({ contactId: "c-321", displayName: "Pat K." });
  });

  it("reads contactId from escalation.created snapshot", () => {
    expect(
      extractContactRef("escalation.created", {
        contactId: "c-654",
        contactDisplayName: "Robin L.",
      }),
    ).toEqual({ contactId: "c-654", displayName: "Robin L." });
  });

  it("returns null for unknown event type", () => {
    expect(extractContactRef("system.unknown.event", { foo: "bar" })).toBeNull();
  });

  it("returns null for malformed snapshot (no contactId anywhere)", () => {
    expect(extractContactRef("booking.create", {})).toBeNull();
  });

  it("returns null when contactId is not a string", () => {
    expect(
      extractContactRef("booking.create", {
        booking: { contactId: 123, contactDisplayName: "X" },
      }),
    ).toBeNull();
  });
});
```

Run: expect compile error.

- [ ] **Step 2: Create `packages/core/src/agent-home/contact-snapshot-extractors.ts`.**

```ts
export interface ContactRef {
  contactId: string;
  displayName: string;
}

type ExtractorFn = (snapshot: Record<string, unknown>) => ContactRef | null;

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function fromNestedKey(key: string): ExtractorFn {
  return (snapshot) => {
    const nested = asRecord(snapshot[key]);
    if (!nested) return null;
    const contactId = asString(nested.contactId);
    const displayName = asString(nested.contactDisplayName);
    if (!contactId || !displayName) return null;
    return { contactId, displayName };
  };
}

function fromTopLevel(): ExtractorFn {
  return (snapshot) => {
    const contactId = asString(snapshot.contactId);
    if (!contactId) return null;
    const displayName =
      asString(snapshot.contactDisplayName) ??
      asString(asRecord(snapshot.contact)?.displayName ?? null);
    if (!displayName) return null;
    return { contactId, displayName };
  };
}

const EXTRACTORS: Record<string, ExtractorFn> = {
  "booking.create": fromNestedKey("booking"),
  "booking.confirmed": fromNestedKey("booking"),
  "lifecycle.qualified": fromTopLevel(),
  "lifecycle.qualified.advanced": fromTopLevel(),
  "lifecycle.disqualified": fromTopLevel(),
  "lifecycle.passed": fromTopLevel(),
  "message.sent": fromNestedKey("message"),
  "message.replied": fromNestedKey("message"),
  "message.batch_sent": fromNestedKey("message"),
  "approval.created": fromNestedKey("approval"),
  "escalation.created": fromTopLevel(),
  "escalation.opened": fromTopLevel(),
  "lead.created": fromTopLevel(),
  "leads.ingested": fromTopLevel(),
};

export function extractContactRef(
  eventType: string,
  snapshot: Record<string, unknown>,
): ContactRef | null {
  const extractor = EXTRACTORS[eventType];
  if (!extractor) return null;
  try {
    return extractor(snapshot);
  } catch {
    return null;
  }
}
```

Run: expect green.

- [ ] **Step 3: Add barrel export + commit.**

Add to `packages/core/src/index.ts`:

```ts
export { extractContactRef } from "./agent-home/contact-snapshot-extractors.js";
export type { ContactRef } from "./agent-home/contact-snapshot-extractors.js";
```

Commit:

```
feat(core): A.4 — contact snapshot extractors per event type

Pure functions mapping audit snapshot shapes to { contactId, displayName }.
Handles both nested-key shapes (booking.*, message.*, approval.*) and
top-level shapes (lifecycle.*, escalation.*, leads.*). Unknown event
types and malformed snapshots return null — translator falls back to a
contact-less row.
```

---

### Task 3: Declare `CockpitActivityRow` type in core

**Files:**
- Create: `packages/core/src/agent-home/cockpit-activity-row.ts`

- [ ] **Step 1: Create the type file.**

```ts
export type CockpitActivityKind =
  | "booked"
  | "qualified"
  | "replied"
  | "sent"
  | "started"
  | "connected"
  | "waiting"
  | "escalated"
  | "passed"
  | "watching"
  | "reviewing"
  | "paused"
  | "scaled"
  | "rotated"
  | "shifted"
  | "restructured"
  | "alert";

export interface CockpitThreadMessage {
  from: "contact" | "alex" | "operator";
  text: string;
}

export interface CockpitActivityRow {
  id?: string;
  time: string;
  kind: CockpitActivityKind;
  head: string;
  body?: string;
  who?: string;
  contactId?: string;
  preview?: CockpitThreadMessage[];
  replyable?: boolean;
  tag?: string;
}
```

> Note: `CockpitThreadMessage` deliberately omits `createdAt` because the cockpit UI does not render per-message timestamps. The Prisma reader returns `createdAt` (used for ordering); the translator drops it from the row shape.

- [ ] **Step 2: Add barrel export.**

```ts
export type {
  CockpitActivityKind,
  CockpitActivityRow,
  CockpitThreadMessage,
} from "./agent-home/cockpit-activity-row.js";
```

- [ ] **Step 3: Commit.**

```
feat(core): A.4 — CockpitActivityRow type mirror

Layer 3 mirror of the dashboard's ActivityRow shape. Translator emits
this type; dashboard types.ts maintains the structurally-identical
ActivityRow. apps/api enforces shape equivalence at compile time
(task 13).
```

---

### Task 4: Implement `PrismaActivityPreviewReader` in db

**Files:**
- Create: `packages/db/src/prisma-activity-preview-reader.ts`
- Create: `packages/db/src/__tests__/prisma-activity-preview-reader.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write the failing test.**

Create `packages/db/src/__tests__/prisma-activity-preview-reader.test.ts`. Mirror the mocked-Prisma pattern from `packages/db/src/__tests__/prisma-message-history-reader.test.ts`.

```ts
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { PrismaActivityPreviewReader } from "../prisma-activity-preview-reader.js";

function buildPrismaMock(rows: Array<{
  contactId: string;
  direction: "inbound" | "outbound";
  content: string;
  createdAt: Date;
  metadata: Record<string, unknown>;
}>) {
  return {
    conversationMessage: {
      findMany: vi.fn(async ({ where, orderBy: _orderBy, take: _take }) => {
        const contactIds: string[] = where.contactId.in ?? [where.contactId];
        return rows
          .filter((r) => contactIds.includes(r.contactId))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }),
    },
  } as unknown as PrismaClient;
}

describe("PrismaActivityPreviewReader", () => {
  it("returns one bucket per contactId, ordered desc", async () => {
    const now = new Date("2026-05-15T10:00:00Z");
    const prisma = buildPrismaMock([
      {
        contactId: "c1",
        direction: "inbound",
        content: "earlier",
        createdAt: new Date(now.getTime() - 60_000),
        metadata: {},
      },
      {
        contactId: "c1",
        direction: "outbound",
        content: "later",
        createdAt: now,
        metadata: {},
      },
      {
        contactId: "c2",
        direction: "inbound",
        content: "hello",
        createdAt: now,
        metadata: {},
      },
    ]);

    const reader = new PrismaActivityPreviewReader(prisma);
    const result = await reader.readRecentBatch({
      contactIds: ["c1", "c2"],
      orgId: "org-1",
      limit: 4,
    });

    expect(result.c1).toHaveLength(2);
    expect(result.c1![0]!.text).toBe("later");
    expect(result.c1![0]!.from).toBe("alex");
    expect(result.c1![1]!.from).toBe("contact");
    expect(result.c2).toHaveLength(1);
    expect(result.c2![0]!.text).toBe("hello");
  });

  it("maps metadata.author='operator' to from='operator' on outbound", async () => {
    const prisma = buildPrismaMock([
      {
        contactId: "c1",
        direction: "outbound",
        content: "operator wrote",
        createdAt: new Date(),
        metadata: { author: "operator" },
      },
    ]);
    const reader = new PrismaActivityPreviewReader(prisma);
    const result = await reader.readRecentBatch({
      contactIds: ["c1"],
      orgId: "org-1",
      limit: 4,
    });
    expect(result.c1![0]!.from).toBe("operator");
  });

  it("returns empty array for contactIds with no messages", async () => {
    const prisma = buildPrismaMock([]);
    const reader = new PrismaActivityPreviewReader(prisma);
    const result = await reader.readRecentBatch({
      contactIds: ["c1"],
      orgId: "org-1",
      limit: 4,
    });
    expect(result.c1).toEqual([]);
  });

  it("issues a single findMany call regardless of contactIds count", async () => {
    const prisma = buildPrismaMock([]);
    const reader = new PrismaActivityPreviewReader(prisma);
    await reader.readRecentBatch({
      contactIds: ["c1", "c2", "c3", "c4"],
      orgId: "org-1",
      limit: 4,
    });
    expect((prisma.conversationMessage.findMany as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });
});
```

Run: `pnpm --filter @switchboard/db test -- --run prisma-activity-preview-reader` — expect compile error.

- [ ] **Step 2: Create `packages/db/src/prisma-activity-preview-reader.ts`.**

```ts
import type { PrismaClient } from "@prisma/client";
import type {
  ActivityPreviewReader,
  ThreadMessageRecord,
} from "@switchboard/core";

export class PrismaActivityPreviewReader implements ActivityPreviewReader {
  constructor(private readonly prisma: PrismaClient) {}

  async readRecentBatch(args: {
    contactIds: readonly string[];
    orgId: string;
    limit: number;
  }): Promise<Record<string, ThreadMessageRecord[]>> {
    if (args.contactIds.length === 0) return {};

    const rows = await this.prisma.conversationMessage.findMany({
      where: {
        contactId: { in: [...args.contactIds] },
        orgId: args.orgId,
      },
      orderBy: { createdAt: "desc" },
      // Over-fetch so each contact's bucket has enough rows even when one
      // contact dominates. Final per-bucket slice happens after grouping.
      take: args.contactIds.length * args.limit,
      select: {
        contactId: true,
        direction: true,
        content: true,
        createdAt: true,
        metadata: true,
      },
    });

    const buckets: Record<string, ThreadMessageRecord[]> = {};
    for (const id of args.contactIds) buckets[id] = [];

    for (const row of rows) {
      const bucket = buckets[row.contactId];
      if (!bucket || bucket.length >= args.limit) continue;
      bucket.push({
        from: resolveFrom(row.direction, row.metadata as Record<string, unknown>),
        text: row.content,
        createdAt: row.createdAt.toISOString(),
      });
    }

    return buckets;
  }
}

function resolveFrom(
  direction: string,
  metadata: Record<string, unknown>,
): "contact" | "alex" | "operator" {
  if (direction === "inbound") return "contact";
  if (metadata && metadata.author === "operator") return "operator";
  return "alex";
}
```

Run: expect green.

- [ ] **Step 3: Add barrel export.**

Add to `packages/db/src/index.ts`:

```ts
export { PrismaActivityPreviewReader } from "./prisma-activity-preview-reader.js";
```

- [ ] **Step 4: Commit.**

```
feat(db): A.4 — PrismaActivityPreviewReader (batched recent-message reader)

Single findMany keyed by contactId IN […] + orgId, take = N×limit
to ensure per-bucket fullness, group-by in memory. Outbound rows with
metadata.author='operator' map to from='operator'; all other outbound
map to from='alex'. Inbound always maps to from='contact'.
```

---

### Task 5: Implement `cockpit-activity-translator.ts` in core

**Files:**
- Create: `packages/core/src/agent-home/cockpit-activity-translator.ts`
- Create: `packages/core/src/agent-home/__tests__/cockpit-activity-translator.test.ts`

- [ ] **Step 1: Write the failing test.**

Create the test. Pattern: build an in-memory `ActivityPreviewReader` stub, build a fixture set of audit entries spanning the canonical kinds, assert per-row shape + batched fetch + short-circuit behavior.

```ts
import { describe, expect, it, vi } from "vitest";
import {
  translateAuditToCockpitActivity,
  type AuditEntryForTranslator,
} from "../cockpit-activity-translator.js";
import type { ActivityPreviewReader } from "../activity-preview-reader.js";

function reader(
  data: Record<string, Array<{ from: "contact" | "alex" | "operator"; text: string }>>,
): { reader: ActivityPreviewReader; calls: ReturnType<typeof vi.fn> } {
  const calls = vi.fn();
  return {
    calls,
    reader: {
      async readRecentBatch(args) {
        calls(args);
        const out: Record<string, ReturnType<ActivityPreviewReader["readRecentBatch"]> extends Promise<infer R> ? R[string] : never> = {};
        for (const id of args.contactIds) {
          out[id] = (data[id] ?? []).map((m) => ({
            ...m,
            createdAt: new Date(0).toISOString(),
          }));
        }
        return out;
      },
    },
  };
}

const NOW = new Date("2026-05-15T11:58:00Z");

describe("translateAuditToCockpitActivity", () => {
  it("translates booking.create with contact ref + preview", async () => {
    const audit: AuditEntryForTranslator[] = [
      {
        id: "a1",
        eventType: "booking.create",
        timestamp: NOW.toISOString(),
        actorType: "agent",
        actorId: "alex",
        snapshot: {
          booking: {
            contactId: "c1",
            contactDisplayName: "Maya Lin",
            service: "Pilates intro",
            when: "Sat 2pm",
            note: "Wants studio tour first",
          },
        },
      },
    ];
    const r = reader({ c1: [{ from: "contact", text: "Can I tour first?" }] });
    const rows = await translateAuditToCockpitActivity({
      entries: audit,
      previewReader: r.reader,
      orgId: "org-1",
      limit: 50,
      expandPreview: true,
      now: NOW,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "a1",
      kind: "booked",
      who: "Maya Lin",
      contactId: "c1",
      replyable: true,
    });
    expect(rows[0]!.head).toContain("Maya Lin");
    expect(rows[0]!.head).toContain("Pilates intro");
    expect(rows[0]!.body).toContain("Wants studio tour first");
    expect(rows[0]!.preview).toHaveLength(1);
    expect(r.calls).toHaveBeenCalledTimes(1);
  });

  it("batches preview fetches: 1 call for N unique contacts", async () => {
    const audit: AuditEntryForTranslator[] = [
      {
        id: "a1",
        eventType: "booking.create",
        timestamp: NOW.toISOString(),
        actorType: "agent",
        actorId: "alex",
        snapshot: { booking: { contactId: "c1", contactDisplayName: "A" } },
      },
      {
        id: "a2",
        eventType: "lifecycle.qualified",
        timestamp: NOW.toISOString(),
        actorType: "agent",
        actorId: "alex",
        snapshot: { contactId: "c2", contactDisplayName: "B" },
      },
      {
        id: "a3",
        eventType: "message.sent",
        timestamp: NOW.toISOString(),
        actorType: "agent",
        actorId: "alex",
        snapshot: { message: { contactId: "c3", contactDisplayName: "C" } },
      },
    ];
    const r = reader({});
    await translateAuditToCockpitActivity({
      entries: audit,
      previewReader: r.reader,
      orgId: "org-1",
      limit: 50,
      expandPreview: true,
      now: NOW,
    });
    expect(r.calls).toHaveBeenCalledTimes(1);
    expect(r.calls.mock.calls[0]![0].contactIds.sort()).toEqual(["c1", "c2", "c3"]);
  });

  it("skips preview fetch entirely when expandPreview=false", async () => {
    const audit: AuditEntryForTranslator[] = [
      {
        id: "a1",
        eventType: "booking.create",
        timestamp: NOW.toISOString(),
        actorType: "agent",
        actorId: "alex",
        snapshot: { booking: { contactId: "c1", contactDisplayName: "A" } },
      },
    ];
    const r = reader({});
    const rows = await translateAuditToCockpitActivity({
      entries: audit,
      previewReader: r.reader,
      orgId: "org-1",
      limit: 50,
      expandPreview: false,
      now: NOW,
    });
    expect(r.calls).not.toHaveBeenCalled();
    expect(rows[0]!.preview).toBeUndefined();
    expect(rows[0]!.replyable).toBe(false);
  });

  it("emits contact-less row when extractor returns null", async () => {
    const audit: AuditEntryForTranslator[] = [
      {
        id: "a1",
        eventType: "system.daily_scan_started",
        timestamp: NOW.toISOString(),
        actorType: "system",
        actorId: "cron",
        snapshot: { quietHours: "21:00–07:00 PT" },
      },
    ];
    const r = reader({});
    const rows = await translateAuditToCockpitActivity({
      entries: audit,
      previewReader: r.reader,
      orgId: "org-1",
      limit: 50,
      expandPreview: true,
      now: NOW,
    });
    expect(rows[0]!.kind).toBe("started");
    expect(rows[0]!.who).toBeUndefined();
    expect(rows[0]!.contactId).toBeUndefined();
    expect(rows[0]!.preview).toBeUndefined();
    expect(rows[0]!.replyable).toBe(false);
  });

  it("respects limit", async () => {
    const audit: AuditEntryForTranslator[] = Array.from({ length: 100 }, (_, i) => ({
      id: `a${i}`,
      eventType: "booking.create",
      timestamp: NOW.toISOString(),
      actorType: "agent",
      actorId: "alex",
      snapshot: { booking: { contactId: `c${i}`, contactDisplayName: `Name ${i}` } },
    }));
    const r = reader({});
    const rows = await translateAuditToCockpitActivity({
      entries: audit,
      previewReader: r.reader,
      orgId: "org-1",
      limit: 25,
      expandPreview: true,
      now: NOW,
    });
    expect(rows).toHaveLength(25);
  });
});
```

Run: expect compile error.

- [ ] **Step 2: Create `packages/core/src/agent-home/cockpit-activity-translator.ts`.**

```ts
import type { ActivityPreviewReader } from "./activity-preview-reader.js";
import { extractContactRef } from "./contact-snapshot-extractors.js";
import type {
  CockpitActivityKind,
  CockpitActivityRow,
  CockpitThreadMessage,
} from "./cockpit-activity-row.js";

export interface AuditEntryForTranslator {
  id: string;
  eventType: string;
  timestamp: string;
  actorType: string;
  actorId: string;
  snapshot: Record<string, unknown>;
}

export interface TranslateAuditToCockpitActivityArgs {
  entries: readonly AuditEntryForTranslator[];
  previewReader: ActivityPreviewReader;
  orgId: string;
  limit: number;
  expandPreview: boolean;
  now?: Date;
}

const KIND_RULES: Array<{
  test: (e: string) => boolean;
  kind: CockpitActivityKind;
}> = [
  { test: (e) => e.startsWith("booking."), kind: "booked" },
  {
    test: (e) => e === "lifecycle.qualified" || e === "lifecycle.qualified.advanced",
    kind: "qualified",
  },
  {
    test: (e) => e.startsWith("lifecycle.disqualified") || e === "lifecycle.passed",
    kind: "passed",
  },
  { test: (e) => e === "approval.created", kind: "waiting" },
  { test: (e) => e.startsWith("escalation."), kind: "escalated" },
  { test: (e) => e === "message.batch_sent" || e === "campaign.sent", kind: "sent" },
  { test: (e) => e === "message.sent" || e === "message.replied", kind: "replied" },
  { test: (e) => e === "system.daily_scan_started" || e === "system.run.started", kind: "started" },
  { test: (e) => e === "lead.created" || e === "leads.ingested", kind: "connected" },
];

function classify(eventType: string): CockpitActivityKind {
  for (const rule of KIND_RULES) if (rule.test(eventType)) return rule.kind;
  return "replied";
}

function formatTime(timestamp: string, now: Date): string {
  const then = new Date(timestamp);
  const sameDay = then.toISOString().slice(0, 10) === now.toISOString().slice(0, 10);
  if (sameDay) {
    const hh = String(then.getUTCHours()).padStart(2, "0");
    const mm = String(then.getUTCMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  const days = Math.floor((now.getTime() - then.getTime()) / (24 * 3600 * 1000));
  if (days < 7) {
    const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return WEEKDAYS[then.getUTCDay()]!;
  }
  return then.toISOString().slice(5, 10);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function deepKey(snapshot: Record<string, unknown>, top: string, leaf: string): string | null {
  const nested = snapshot[top];
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return asString((nested as Record<string, unknown>)[leaf]);
  }
  return null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildHead(
  kind: CockpitActivityKind,
  snapshot: Record<string, unknown>,
  contactName: string | null,
): string {
  const name = contactName ?? "";
  switch (kind) {
    case "booked": {
      const service = deepKey(snapshot, "booking", "service");
      const when = deepKey(snapshot, "booking", "when");
      if (name && service && when) return `${name} confirmed ${service} ${when}`;
      return "Booking confirmed";
    }
    case "qualified": {
      const qualifier = asString(snapshot.qualifier);
      if (name && qualifier) return `${name} qualified — ${qualifier}`;
      if (name) return `${name} qualified`;
      return "Lead qualified";
    }
    case "replied": {
      const topic = asString(snapshot.topic) ?? deepKey(snapshot, "message", "topic");
      if (name && topic) return `${name} · ${topic}`;
      if (name) return `${name} replied`;
      return "Reply sent";
    }
    case "sent": {
      const n = asNumber(deepKey(snapshot, "message", "count") as unknown) ??
                asNumber(snapshot.count);
      if (n) return `Morning batch · ${n} follow-ups`;
      return "Batch sent";
    }
    case "started": {
      return "Daily run begins";
    }
    case "connected": {
      const n = asNumber(snapshot.count) ?? asNumber(deepKey(snapshot, "batch", "count") as unknown);
      const source = asString(snapshot.source) ?? asString(deepKey(snapshot, "batch", "source") as unknown);
      if (n && source) return `Pulled ${n} new leads from ${source}`;
      if (n) return `Pulled ${n} new leads`;
      return "New leads pulled";
    }
    case "waiting": {
      const topic =
        asString(snapshot.topic) ?? deepKey(snapshot, "approval", "topic");
      if (topic) return `Awaiting your call on ${topic}`;
      return "Awaiting your call";
    }
    case "escalated": {
      const topic = asString(snapshot.topic) ?? deepKey(snapshot, "escalation", "topic");
      if (name && topic) return `${topic} from ${name} → your inbox`;
      if (topic) return `${topic} → your inbox`;
      return "Escalated to your inbox";
    }
    case "passed": {
      const reason = asString(snapshot.reason) ?? deepKey(snapshot, "disqualification", "reason");
      if (name && reason) return `${name} — ${reason}`;
      if (name) return `${name}`;
      return "Passed";
    }
    default:
      return "";
  }
}

function buildBody(
  kind: CockpitActivityKind,
  snapshot: Record<string, unknown>,
  preview: CockpitThreadMessage[] | undefined,
): string | undefined {
  switch (kind) {
    case "booked": {
      const note = deepKey(snapshot, "booking", "note");
      return note ? `Calendar held. ${note}` : "Calendar held.";
    }
    case "qualified": {
      const inbound = preview?.find((m) => m.from === "contact")?.text;
      return inbound ? inbound.slice(0, 120) : "Qualified.";
    }
    case "replied": {
      const summary = asString(snapshot.summary) ?? deepKey(snapshot, "message", "summary");
      if (summary) return summary.slice(0, 120);
      const outbound = preview?.find((m) => m.from === "alex")?.text;
      return outbound ? outbound.slice(0, 120) : undefined;
    }
    case "sent": {
      const tmpl = asString(snapshot.template) ?? deepKey(snapshot, "template", "name");
      const filter = asString(snapshot.filter) ?? deepKey(snapshot, "template", "filter");
      const joined = [tmpl, filter].filter(Boolean).join(" · ");
      return joined || undefined;
    }
    case "started": {
      const quietHours = asString(snapshot.quietHours);
      return quietHours ? `Quiet hours: ${quietHours}` : "Daily run begins.";
    }
    case "connected": {
      const n = asNumber(snapshot.count);
      const source = asString(snapshot.source);
      if (n && source) return `${n} new leads · ${source}`;
      return "New leads pulled.";
    }
    case "waiting": {
      return (
        asString(snapshot.summary) ??
        deepKey(snapshot, "approval", "summary") ??
        "Awaiting your call."
      );
    }
    case "escalated": {
      return (
        asString(snapshot.reason) ??
        deepKey(snapshot, "escalation", "reason") ??
        "Routed to your inbox."
      );
    }
    case "passed": {
      return (
        asString(snapshot.reason) ??
        deepKey(snapshot, "disqualification", "reason") ??
        "Passed."
      );
    }
    default:
      return undefined;
  }
}

function buildTag(kind: CockpitActivityKind, snapshot: Record<string, unknown>): string | undefined {
  if (kind === "sent") {
    const n = asNumber(deepKey(snapshot, "message", "count") as unknown) ?? asNumber(snapshot.count);
    if (n) return `+${n}`;
  }
  return undefined;
}

function dropCreatedAt(records: Array<{ from: "contact" | "alex" | "operator"; text: string; createdAt: string }>): CockpitThreadMessage[] {
  return records.map((r) => ({ from: r.from, text: r.text }));
}

export async function translateAuditToCockpitActivity(
  args: TranslateAuditToCockpitActivityArgs,
): Promise<CockpitActivityRow[]> {
  const now = args.now ?? new Date();
  const sliced = args.entries.slice(0, args.limit);

  type Staged = {
    entry: AuditEntryForTranslator;
    kind: CockpitActivityKind;
    contactRef: ReturnType<typeof extractContactRef>;
  };
  const staged: Staged[] = sliced.map((entry) => ({
    entry,
    kind: classify(entry.eventType),
    contactRef: extractContactRef(entry.eventType, entry.snapshot),
  }));

  const uniqueContactIds = Array.from(
    new Set(staged.map((s) => s.contactRef?.contactId).filter((v): v is string => !!v)),
  );

  const previews: Record<string, CockpitThreadMessage[]> = {};
  if (args.expandPreview && uniqueContactIds.length > 0) {
    const batch = await args.previewReader.readRecentBatch({
      contactIds: uniqueContactIds,
      orgId: args.orgId,
      limit: 4,
    });
    for (const id of uniqueContactIds) {
      previews[id] = dropCreatedAt(batch[id] ?? []);
    }
  }

  return staged.map(({ entry, kind, contactRef }) => {
    const preview = contactRef ? previews[contactRef.contactId] : undefined;
    const row: CockpitActivityRow = {
      id: entry.id,
      time: formatTime(entry.timestamp, now),
      kind,
      head: buildHead(kind, entry.snapshot, contactRef?.displayName ?? null),
    };
    const body = buildBody(kind, entry.snapshot, preview);
    if (body) row.body = body;
    if (contactRef) {
      row.who = contactRef.displayName;
      row.contactId = contactRef.contactId;
    }
    if (preview && preview.length > 0) {
      row.preview = preview;
      row.replyable = true;
    } else {
      row.replyable = false;
    }
    const tag = buildTag(kind, entry.snapshot);
    if (tag) row.tag = tag;
    return row;
  });
}
```

Run: expect green.

- [ ] **Step 3: Add barrel export + commit.**

Add to `packages/core/src/index.ts`:

```ts
export {
  translateAuditToCockpitActivity,
} from "./agent-home/cockpit-activity-translator.js";
export type {
  AuditEntryForTranslator,
  TranslateAuditToCockpitActivityArgs,
} from "./agent-home/cockpit-activity-translator.js";
```

Commit:

```
feat(core): A.4 — cockpit activity translator with batched preview fetch

translateAuditToCockpitActivity consumes audit entries + an
ActivityPreviewReader, classifies kind, extracts contact refs, fetches
previews in one batched call per request, and emits the cockpit-shape
ActivityRow. expandPreview=false short-circuits the reader entirely;
rows without an extractable contactId surface as contact-less
(replyable=false, no preview).
```

---

### Task 6: Add Fastify route `/agents/:agentId/activity`

**Files:**
- Create: `apps/api/src/lib/cockpit-activity-deps.ts`
- Create: `apps/api/src/routes/agent-home/activity.ts`
- Create: `apps/api/src/routes/agent-home/__tests__/activity.test.ts`
- Create: `apps/api/src/__tests__/api-cockpit-activity.test.ts`
- Modify: `apps/api/src/bootstrap/routes.ts`

- [ ] **Step 1: Write the deps wiring helper.**

Create `apps/api/src/lib/cockpit-activity-deps.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import {
  PrismaActivityPreviewReader,
} from "@switchboard/db";
import type {
  ActivityPreviewReader,
  AuditEntryForTranslator,
} from "@switchboard/core";

export interface CockpitActivityDeps {
  previewReader: ActivityPreviewReader;
  fetchAuditEntries: (args: {
    orgId: string;
    agentActorId: string;
    limit: number;
  }) => Promise<AuditEntryForTranslator[]>;
}

export function buildCockpitActivityDeps(
  prisma: PrismaClient,
): CockpitActivityDeps {
  return {
    previewReader: new PrismaActivityPreviewReader(prisma),
    async fetchAuditEntries({ orgId, agentActorId, limit }) {
      const rows = await prisma.auditEntry.findMany({
        where: {
          orgId,
          actorId: agentActorId,
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          eventType: true,
          createdAt: true,
          actorType: true,
          actorId: true,
          snapshot: true,
        },
      });
      return rows.map((r) => ({
        id: r.id,
        eventType: r.eventType,
        timestamp: r.createdAt.toISOString(),
        actorType: r.actorType,
        actorId: r.actorId,
        snapshot: r.snapshot as Record<string, unknown>,
      }));
    },
  };
}
```

> **Note:** The `agentActorId` parameter is the canonical actor handle for Alex (`"alex"`) or Riley (`"riley"`). Today's audit emitters use these literal strings; verify with `grep -n "actorId.*\"alex\"\\|actorId.*\"riley\"" apps/api/src apps/chat/src packages/core/src` and confirm before implementing. If the canonical handle is a UUID instead, swap to an `agentRole` filter or join through `AgentRoster`. Plan executor: **verify and lock at task time, do not assume.**

- [ ] **Step 2: Write the route + failing test.**

Create `apps/api/src/routes/agent-home/__tests__/activity.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { cockpitActivityRoutes } from "../activity.js";
import type { CockpitActivityDeps } from "../../../lib/cockpit-activity-deps.js";

function buildDeps(): { deps: CockpitActivityDeps; fetchSpy: ReturnType<typeof vi.fn>; readerSpy: ReturnType<typeof vi.fn> } {
  const fetchSpy = vi.fn(async () => []);
  const readerSpy = vi.fn(async () => ({}));
  return {
    fetchSpy,
    readerSpy,
    deps: {
      previewReader: { readRecentBatch: readerSpy },
      fetchAuditEntries: fetchSpy,
    },
  };
}

async function buildApp(deps: CockpitActivityDeps): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate("authDisabled", true);
  app.decorateRequest("organizationIdFromAuth", "");
  app.addHook("preHandler", async (request) => {
    if (!request.organizationIdFromAuth) request.organizationIdFromAuth = "org-test";
  });
  await app.register(cockpitActivityRoutes(deps), { prefix: "/api/dashboard/agents" });
  await app.ready();
  return app;
}

describe("GET /api/dashboard/agents/:agentId/activity", () => {
  it("returns 200 with empty rows when no audit", async () => {
    const { deps } = buildDeps();
    const app = await buildApp(deps);
    const res = await app.inject({ method: "GET", url: "/api/dashboard/agents/alex/activity" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ rows: [] });
  });

  it("clamps limit to max 200", async () => {
    const { deps, fetchSpy } = buildDeps();
    const app = await buildApp(deps);
    await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/activity?limit=9999",
    });
    expect(fetchSpy.mock.calls[0]![0].limit).toBe(200);
  });

  it("returns 400 for unknown agentId", async () => {
    const { deps } = buildDeps();
    const app = await buildApp(deps);
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/jordan/activity",
    });
    expect(res.statusCode).toBe(400);
  });

  it("skips preview fetch when expandPreview=false", async () => {
    const { deps, fetchSpy, readerSpy } = buildDeps();
    fetchSpy.mockResolvedValueOnce([
      {
        id: "a1",
        eventType: "booking.create",
        timestamp: new Date().toISOString(),
        actorType: "agent",
        actorId: "alex",
        snapshot: { booking: { contactId: "c1", contactDisplayName: "A" } },
      },
    ]);
    const app = await buildApp(deps);
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/activity?expandPreview=false",
    });
    expect(res.statusCode).toBe(200);
    expect(readerSpy).not.toHaveBeenCalled();
    expect(res.json().rows[0].preview).toBeUndefined();
    expect(res.json().rows[0].replyable).toBe(false);
  });
});
```

- [ ] **Step 3: Implement `apps/api/src/routes/agent-home/activity.ts`.**

```ts
import type { FastifyPluginAsync, FastifyPluginCallback } from "fastify";
import { z } from "zod";
import {
  translateAuditToCockpitActivity,
  type CockpitActivityRow,
} from "@switchboard/core";
import { AgentKeySchema } from "@switchboard/schemas";
import type { CockpitActivityDeps } from "../../lib/cockpit-activity-deps.js";

const ParamsSchema = z.object({ agentId: AgentKeySchema });
const QuerySchema = z.object({
  limit: z
    .union([z.string().regex(/^\d+$/).transform((s) => parseInt(s, 10)), z.number()])
    .optional(),
  expandPreview: z
    .union([z.literal("false"), z.literal("true"), z.boolean()])
    .optional(),
});

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export function cockpitActivityRoutes(deps: CockpitActivityDeps): FastifyPluginAsync {
  const plugin: FastifyPluginAsync = async (app) => {
    app.get("/:agentId/activity", async (request, reply) => {
      const orgId = request.organizationIdFromAuth;
      if (!orgId) return reply.code(401).send({ error: "Org context required" });

      const params = ParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid agentId" });
      }
      const query = QuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({ error: "Invalid query" });
      }
      const rawLimit = typeof query.data.limit === "number" ? query.data.limit : DEFAULT_LIMIT;
      const limit = Math.min(Math.max(1, rawLimit), MAX_LIMIT);
      const expandPreview =
        query.data.expandPreview === false || query.data.expandPreview === "false"
          ? false
          : true;

      const entries = await deps.fetchAuditEntries({
        orgId,
        agentActorId: params.data.agentId,
        limit,
      });

      const rows: CockpitActivityRow[] = await translateAuditToCockpitActivity({
        entries,
        previewReader: deps.previewReader,
        orgId,
        limit,
        expandPreview,
      });

      return reply.code(200).send({ rows });
    });
  };
  return plugin;
}
```

Run: `pnpm --filter @switchboard/api test -- --run agent-home/activity` — expect green.

- [ ] **Step 4: Register the route in `apps/api/src/bootstrap/routes.ts`.**

Find the existing `agent-home` registration block (mission/metrics/pipeline/wins) and add the activity route alongside it. Build the deps once and pass them in.

```ts
import { cockpitActivityRoutes } from "../routes/agent-home/activity.js";
import { buildCockpitActivityDeps } from "../lib/cockpit-activity-deps.js";

// ...
const cockpitActivityDeps = buildCockpitActivityDeps(prisma);
await app.register(cockpitActivityRoutes(cockpitActivityDeps), {
  prefix: "/api/dashboard/agents",
});
```

- [ ] **Step 5: Write the server-level integration test.**

Create `apps/api/src/__tests__/api-cockpit-activity.test.ts` mirroring the existing `api-metrics.test.ts` pattern. Use mocked Prisma; assert end-to-end `GET /api/dashboard/agents/alex/activity` returns `{ rows: CockpitActivityRow[] }` with `preview` populated when ConversationMessage rows exist.

- [ ] **Step 6: Commit.**

```
feat(api): A.4 — GET /api/dashboard/agents/:agentId/activity

New per-agent endpoint emitting CockpitActivityRow[] directly. Reads
audit entries scoped to the agent's actorId, batches preview fetches
via ActivityPreviewReader (one Prisma findMany per request),
short-circuits the reader when expandPreview=false. Limit clamps to
[1, 200] with default 50. agentId validates against AgentKeySchema.
```

---

### Task 7: Add the compile-time shape-equivalence test in `apps/api`

**Files:**
- Create: `apps/api/src/__tests__/cockpit-activity-row-mirror.test.ts`

- [ ] **Step 1: Create the test.**

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { CockpitActivityRow } from "@switchboard/core";
// Cross-layer import permitted under apps/* per CLAUDE.md §Dependency Layers.
// This is the only place the mirror is enforced.
import type { ActivityRow as DashboardActivityRow } from "../../../../apps/dashboard/src/components/cockpit/types.js";

describe("CockpitActivityRow ≡ ActivityRow (dashboard)", () => {
  it("core type is assignable to dashboard type", () => {
    expectTypeOf<CockpitActivityRow>().toMatchTypeOf<DashboardActivityRow>();
  });

  it("dashboard type is assignable to core type", () => {
    expectTypeOf<DashboardActivityRow>().toMatchTypeOf<CockpitActivityRow>();
  });
});
```

> **Plan executor note:** if the cross-layer relative import path resolves incorrectly (Next.js path aliases, tsconfig isolation), an alternative is to declare a sibling test in `apps/dashboard` that imports `CockpitActivityRow` from `@switchboard/core` and runs the same assertion. The location does not matter — the assertion must exist *somewhere* in the build to catch drift. Pick whichever resolves cleanly under `pnpm --filter ... typecheck`.

- [ ] **Step 2: Run + verify.**

```bash
pnpm --filter @switchboard/api typecheck
pnpm --filter @switchboard/api test -- --run cockpit-activity-row-mirror
```

Both clean. If they fail, the type drift must be resolved before continuing.

- [ ] **Step 3: Commit.**

```
test(api): A.4 — compile-time mirror between CockpitActivityRow and dashboard ActivityRow

Enforces shape equivalence at typecheck time. Drift in either direction
fails the build.
```

---

### Task 8: Extend dashboard `ActivityRow` type with `id` + `contactId`

**Files:**
- Modify: `apps/dashboard/src/components/cockpit/types.ts`

- [ ] **Step 1: Add the fields.**

Edit `apps/dashboard/src/components/cockpit/types.ts:102-111` to add `id?: string;` and `contactId?: string;` to the `ActivityRow` interface. Final shape:

```ts
export interface ActivityRow {
  id?: string;
  time: string;
  kind: ActivityKind;
  head: string;
  body?: string;
  who?: string;
  contactId?: string;
  preview?: ThreadMessage[];
  replyable?: boolean;
  tag?: string;
}
```

- [ ] **Step 2: Verify mirror test still passes.**

```bash
pnpm --filter @switchboard/api test -- --run cockpit-activity-row-mirror
```

Both directions clean.

- [ ] **Step 3: Commit.**

```
feat(dashboard): A.4 — ActivityRow gains optional id + contactId

id is the stable React key for per-row open state across refetches.
contactId drives the /contacts/[contactId]?note=open deep link
("Tell Alex about {firstName}" affordance, rendered when contactId is
present).
```

---

### Task 9: Add Next.js proxy route

**Files:**
- Create: `apps/dashboard/src/app/api/dashboard/agents/[agentId]/activity/route.ts`
- Create: `apps/dashboard/src/app/api/dashboard/agents/[agentId]/activity/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test.**

Mirror `apps/dashboard/src/app/api/dashboard/agents/[agentId]/mission/__tests__/route.test.ts` if it exists; otherwise create from scratch. Verify the route requires session and proxies to the Fastify API client.

- [ ] **Step 2: Implement the route.**

```ts
import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { proxyError } from "@/lib/proxy-error";

export async function GET(
  request: Request,
  { params }: { params: { agentId: string } },
) {
  try {
    await requireSession();
    const client = await getApiClient();
    const url = new URL(request.url);
    const limit = url.searchParams.get("limit") ?? undefined;
    const expandPreview = url.searchParams.get("expandPreview") ?? undefined;

    const data = await client.getAgentActivityCockpit(params.agentId, {
      limit: limit ? Number(limit) : undefined,
      expandPreview: expandPreview === "false" ? false : true,
    });

    return NextResponse.json(data);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
```

- [ ] **Step 3: Add `getAgentActivityCockpit` to the API client.**

Locate the client at `apps/dashboard/src/lib/api-client.ts` (or wherever `getAgentMission` lives). Add:

```ts
async getAgentActivityCockpit(
  agentId: string,
  opts: { limit?: number; expandPreview?: boolean } = {},
): Promise<{ rows: ActivityRow[] }> {
  const qs = new URLSearchParams();
  if (typeof opts.limit === "number") qs.set("limit", String(opts.limit));
  if (opts.expandPreview === false) qs.set("expandPreview", "false");
  return this.fetch(`/api/dashboard/agents/${encodeURIComponent(agentId)}/activity?${qs.toString()}`);
}
```

> **Plan executor note:** the existing API client surface may use a different method-naming or fetch-helper pattern. Match the existing pattern for `getAgentMission` / `getAgentMetrics` exactly. Do not introduce a new shape.

- [ ] **Step 4: Commit.**

```
feat(dashboard): A.4 — Next.js proxy /api/dashboard/agents/[agentId]/activity

Mirrors the existing per-agent proxy pattern (mission, metrics, etc.).
Forwards limit + expandPreview to the Fastify endpoint.
```

---

### Task 10: Add `useAgentActivityCockpit` hook

**Files:**
- Create: `apps/dashboard/src/hooks/use-agent-activity-cockpit.ts`
- Create: `apps/dashboard/src/hooks/__tests__/use-agent-activity-cockpit.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { useAgentActivityCockpit } from "../use-agent-activity-cockpit";

const fetchMock = vi.fn();
beforeEach(() => {
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockReset();
});
afterEach(() => {
  fetchMock.mockRestore?.();
});

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // eslint-disable-next-line react/display-name
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("useAgentActivityCockpit", () => {
  it("calls /api/dashboard/agents/[agentId]/activity and returns rows", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        rows: [
          { id: "a1", time: "11:58", kind: "booked", head: "Maya confirmed Pilates Sat 2pm" },
        ],
      }),
    });
    const { result } = renderHook(() => useAgentActivityCockpit("alex"), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(fetchMock.mock.calls[0]![0]).toContain("/api/dashboard/agents/alex/activity");
    expect(result.current.data?.rows).toHaveLength(1);
  });

  it("encodes expandPreview=false when caller passes it", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ rows: [] }) });
    renderHook(
      () => useAgentActivityCockpit("alex", { expandPreview: false }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]![0])).toContain("expandPreview=false");
  });
});
```

- [ ] **Step 2: Implement the hook.**

```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import type { ActivityRow } from "@/components/cockpit/types";

export interface UseAgentActivityCockpitOpts {
  limit?: number;
  expandPreview?: boolean;
}

async function fetchActivity(
  agentId: string,
  opts: UseAgentActivityCockpitOpts,
): Promise<{ rows: ActivityRow[] }> {
  const qs = new URLSearchParams();
  if (typeof opts.limit === "number") qs.set("limit", String(opts.limit));
  if (opts.expandPreview === false) qs.set("expandPreview", "false");
  const url = `/api/dashboard/agents/${encodeURIComponent(agentId)}/activity${
    qs.toString() ? `?${qs.toString()}` : ""
  }`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch cockpit activity: ${res.status}`);
  return res.json();
}

export function useAgentActivityCockpit(
  agentId: string,
  opts: UseAgentActivityCockpitOpts = {},
) {
  const keys = useScopedQueryKeys();
  const limit = opts.limit ?? 50;
  const expandPreview = opts.expandPreview ?? true;
  return useQuery({
    queryKey: keys
      ? [...keys.agents.activityCockpit(agentId), limit, expandPreview]
      : ["__disabled_agents_activity_cockpit__", agentId, limit, expandPreview],
    queryFn: () => fetchActivity(agentId, { limit, expandPreview }),
    refetchInterval: 30_000,
    enabled: !!keys,
  });
}
```

> **Plan executor note:** `useScopedQueryKeys` does not currently expose `agents.activityCockpit(agentId)`. Add the helper:
>
> ```ts
> // apps/dashboard/src/hooks/use-query-keys.ts
> agents: {
>   // ...existing
>   activityCockpit: (agentId: string) => ["agents", "activity-cockpit", agentId] as const,
> }
> ```
>
> Mirror the existing helper shape exactly.

- [ ] **Step 3: Run tests + commit.**

```bash
pnpm --filter @switchboard/dashboard test -- --run use-agent-activity-cockpit
```

Commit:

```
feat(dashboard): A.4 — useAgentActivityCockpit hook

TanStack Query hook keyed on agentId + limit + expandPreview. 30s
refetch interval matches legacy useAgentActivity. Returns { rows:
ActivityRow[] } directly; no client-side translator (server emits the
cockpit shape).
```

---

### Task 11: Add `<ThreadPreview>` component

**Files:**
- Create: `apps/dashboard/src/components/cockpit/thread-preview.tsx`
- Create: `apps/dashboard/src/components/cockpit/__tests__/thread-preview.test.tsx`

- [ ] **Step 1: Write the failing test.**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThreadPreview } from "../thread-preview";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

describe("<ThreadPreview>", () => {
  it("renders messages in order with from labels", () => {
    render(
      <ThreadPreview
        contactId="c1"
        who="Maya Lin"
        messages={[
          { from: "contact", text: "Can I tour first?" },
          { from: "alex", text: "Sat at 2pm works." },
        ]}
      />,
    );
    expect(screen.getByText("Can I tour first?")).toBeInTheDocument();
    expect(screen.getByText("Sat at 2pm works.")).toBeInTheDocument();
  });

  it("routes to /contacts/[id]?takeover=true on Send-as-me", async () => {
    const user = userEvent.setup();
    render(
      <ThreadPreview
        contactId="c1"
        who="Maya Lin"
        messages={[{ from: "contact", text: "hi" }]}
      />,
    );
    await user.click(screen.getByRole("button", { name: /send as me/i }));
    expect(pushMock).toHaveBeenCalledWith("/contacts/c1?takeover=true");
  });

  it("renders nothing when messages is empty", () => {
    const { container } = render(
      <ThreadPreview contactId="c1" who="Maya Lin" messages={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Implement.**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { T } from "./tokens";
import type { ThreadMessage } from "./types";

export interface ThreadPreviewProps {
  contactId: string;
  who: string;
  messages: ThreadMessage[];
}

const FROM_LABEL: Record<ThreadMessage["from"], string> = {
  contact: "",
  alex: "Alex",
  operator: "You",
};

export function ThreadPreview({ contactId, who, messages }: ThreadPreviewProps) {
  const router = useRouter();
  if (messages.length === 0) return null;
  return (
    <div
      style={{
        background: T.hairSoft,
        borderRadius: 6,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        margin: "8px 0 12px",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: m.from === "contact" ? T.ink3 : T.ink2,
                minWidth: 44,
              }}
            >
              {m.from === "contact" ? who : FROM_LABEL[m.from]}
            </span>
            <span style={{ fontSize: 13, lineHeight: 1.45, color: T.ink }}>{m.text}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={() => router.push(`/contacts/${encodeURIComponent(contactId)}?takeover=true`)}
          style={{
            background: T.paper,
            border: `1px solid ${T.hair}`,
            borderRadius: 4,
            padding: "6px 12px",
            fontSize: 12,
            fontWeight: 600,
            color: T.ink2,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Send as me
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run tests + commit.**

```
feat(dashboard): A.4 — ThreadPreview component (inline excerpt + send-as-me link)

Renders 3–4 messages with from labels (contact gets the contact's
display name; alex/operator get fixed labels). "Send as me" routes to
/contacts/[id]?takeover=true; no inline-send wiring at A.4 per umbrella
spec §Out of scope item 9.
```

---

### Task 12: Extend `<ActivityRow>` with expansion + affordances

**Files:**
- Modify: `apps/dashboard/src/components/cockpit/activity-row.tsx`
- Modify (or create): `apps/dashboard/src/components/cockpit/__tests__/activity-row.test.tsx`

- [ ] **Step 1: Write the failing test.**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActivityRow } from "../activity-row";
import type { ActivityRow as ActivityRowType } from "../types";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const baseRow: ActivityRowType = {
  id: "a1",
  time: "11:58",
  kind: "booked",
  head: "Maya Lin confirmed Pilates intro Sat 2pm",
  body: "Calendar held. Wants studio tour first",
  who: "Maya Lin",
  contactId: "c1",
  preview: [
    { from: "contact", text: "Can I tour first?" },
    { from: "alex", text: "Sat at 2pm works." },
  ],
  replyable: true,
};

function setup(row: Partial<ActivityRowType>, open = false) {
  const toggle = vi.fn();
  render(
    <ul>
      <ActivityRow item={{ ...baseRow, ...row }} open={open} toggle={toggle} />
    </ul>,
  );
  return { toggle };
}

describe("<ActivityRow>", () => {
  it("renders head when collapsed", () => {
    setup({}, false);
    expect(screen.getByText(/Maya Lin confirmed/)).toBeInTheDocument();
    expect(screen.queryByText("Wants studio tour first")).not.toBeInTheDocument();
  });

  it("shows expand chevron when replyable", () => {
    setup({}, false);
    expect(screen.getByRole("button", { name: /expand/i })).toBeInTheDocument();
  });

  it("hides expand chevron when replyable=false", () => {
    setup({ replyable: false, preview: undefined }, false);
    expect(screen.queryByRole("button", { name: /expand/i })).not.toBeInTheDocument();
  });

  it("clicking chevron toggles open", async () => {
    const user = userEvent.setup();
    const { toggle } = setup({}, false);
    await user.click(screen.getByRole("button", { name: /expand/i }));
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("renders body + preview + 'Tell Alex about' when open", () => {
    setup({}, true);
    expect(screen.getByText(/Calendar held/)).toBeInTheDocument();
    expect(screen.getByText("Can I tour first?")).toBeInTheDocument();
    expect(screen.getByText(/Tell Alex about Maya/i)).toBeInTheDocument();
  });

  it("'Tell Alex about {firstName}' routes to /contacts/[id]?note=open", async () => {
    const user = userEvent.setup();
    setup({}, true);
    await user.click(screen.getByText(/Tell Alex about Maya/i));
    expect(pushMock).toHaveBeenCalledWith("/contacts/c1?note=open");
  });

  it("hides 'Tell Alex about' when contactId missing", () => {
    setup({ contactId: undefined }, true);
    expect(screen.queryByText(/Tell Alex about/i)).not.toBeInTheDocument();
  });

  it("renders tag span when tag present", () => {
    setup({ tag: "+12" }, false);
    expect(screen.getByText("+12")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement.**

Replace the body of `apps/dashboard/src/components/cockpit/activity-row.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { T } from "./tokens";
import { lookupKindMeta } from "./kind-meta";
import { Dot } from "./dot";
import { ThreadPreview } from "./thread-preview";
import type { ActivityRow as ActivityRowType } from "./types";

export interface ActivityRowProps {
  item: ActivityRowType;
  open: boolean;
  toggle: () => void;
  compact?: boolean;
}

function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

export function ActivityRow({ item, open, toggle, compact = false }: ActivityRowProps) {
  const router = useRouter();
  const meta = lookupKindMeta(item.kind);
  const expandable = item.replyable === true;
  return (
    <li style={{ borderBottom: `1px solid ${T.hairSoft}` }}>
      <div
        style={{
          display: "grid",
          width: "100%",
          boxSizing: "border-box",
          gridTemplateColumns: compact ? "46px 96px 1fr 24px" : "54px 112px 1fr 28px",
          gap: compact ? 10 : 14,
          alignItems: "baseline",
          padding: "11px 0",
        }}
      >
        <span
          style={{
            fontFamily: "JetBrains Mono",
            fontSize: 11,
            color: T.ink4,
            letterSpacing: "0.02em",
            whiteSpace: "nowrap",
          }}
        >
          {item.time}
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            height: 18,
            padding: "0 7px",
            borderRadius: 3,
            background: meta.bg,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.1em",
            color: meta.color,
            textTransform: "uppercase",
            justifySelf: "start",
            whiteSpace: "nowrap",
          }}
        >
          {meta.pulse && <Dot color={meta.color} pulse size={5} />}
          {meta.label}
        </span>
        <span
          style={{
            fontSize: compact ? 13 : 13.5,
            lineHeight: 1.45,
            color: T.ink,
            display: "flex",
            gap: 8,
            alignItems: "baseline",
          }}
        >
          <span>{item.head}</span>
          {item.tag ? (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: T.ink4,
                fontFamily: "JetBrains Mono",
              }}
            >
              {item.tag}
            </span>
          ) : null}
        </span>
        {expandable ? (
          <button
            type="button"
            aria-label={open ? "Collapse" : "Expand"}
            onClick={toggle}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: 12,
              color: T.ink4,
              padding: "2px 6px",
            }}
          >
            {open ? "▴" : "▾"}
          </button>
        ) : (
          <span />
        )}
      </div>
      {open ? (
        <div style={{ padding: "0 0 12px", display: "flex", flexDirection: "column", gap: 8 }}>
          {item.body ? (
            <p style={{ fontSize: 13, lineHeight: 1.5, color: T.ink2, margin: 0 }}>{item.body}</p>
          ) : null}
          {item.preview && item.contactId && item.who ? (
            <ThreadPreview
              contactId={item.contactId}
              who={item.who}
              messages={item.preview}
            />
          ) : null}
          {item.who && item.contactId ? (
            <button
              type="button"
              onClick={() =>
                router.push(`/contacts/${encodeURIComponent(item.contactId!)}?note=open`)
              }
              style={{
                background: "transparent",
                border: "none",
                color: T.ink3,
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
                textAlign: "left",
                padding: 0,
                fontFamily: "inherit",
              }}
            >
              Tell Alex about {firstName(item.who)}
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
```

- [ ] **Step 3: Run tests + commit.**

```
feat(dashboard): A.4 — ActivityRow expansion + body + preview + affordances

When open, renders body line, ThreadPreview (when preview + contactId
present), and "Tell Alex about {firstName}" link to /contacts/[id]
?note=open. Chevron hidden when replyable=false (Riley fallback).
Tag span renders inline next to head when present.
```

---

### Task 13: Manage open state in `<ActivityStream>`

**Files:**
- Modify: `apps/dashboard/src/components/cockpit/activity-stream.tsx`
- Modify (or create): `apps/dashboard/src/components/cockpit/__tests__/activity-stream.test.tsx`

- [ ] **Step 1: Write the failing test.**

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActivityStream } from "../activity-stream";

const rows = [
  {
    id: "a1",
    time: "11:58",
    kind: "booked" as const,
    head: "Maya Lin confirmed",
    body: "Calendar held.",
    who: "Maya Lin",
    contactId: "c1",
    preview: [{ from: "contact" as const, text: "hi" }],
    replyable: true,
  },
  {
    id: "a2",
    time: "11:30",
    kind: "qualified" as const,
    head: "Jordan F. qualified",
    body: "Looking soon.",
    who: "Jordan F.",
    contactId: "c2",
    preview: [{ from: "contact" as const, text: "yo" }],
    replyable: true,
  },
];

describe("<ActivityStream>", () => {
  it("keeps each row's open state independent", async () => {
    const user = userEvent.setup();
    render(<ActivityStream rows={rows} filter="all" setFilter={() => {}} />);
    const expandButtons = screen.getAllByRole("button", { name: /expand/i });
    await user.click(expandButtons[0]!);
    expect(screen.getByText("Calendar held.")).toBeInTheDocument();
    expect(screen.queryByText("Looking soon.")).not.toBeInTheDocument();
  });

  it("filter chips preserve open state on switch back to 'all'", async () => {
    const user = userEvent.setup();
    let filter: "all" | "booked" | "escalations" = "all";
    const setFilter = (f: typeof filter) => {
      filter = f;
    };
    const { rerender } = render(
      <ActivityStream rows={rows} filter={filter} setFilter={setFilter} />,
    );
    const expandButtons = screen.getAllByRole("button", { name: /expand/i });
    await user.click(expandButtons[0]!);
    rerender(<ActivityStream rows={rows} filter="booked" setFilter={setFilter} />);
    rerender(<ActivityStream rows={rows} filter="all" setFilter={setFilter} />);
    expect(screen.getByText("Calendar held.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement.**

Replace the body of `apps/dashboard/src/components/cockpit/activity-stream.tsx`:

```tsx
"use client";

import { useState, useCallback } from "react";
import { T } from "./tokens";
import { ActivityRow as ActivityRowComponent } from "./activity-row";
import type { ActivityRow } from "./types";

export type ActivityFilter = "all" | "booked" | "escalations";

export interface ActivityStreamProps {
  rows: ActivityRow[];
  filter: ActivityFilter;
  setFilter: (f: ActivityFilter) => void;
  compact?: boolean;
}

const FILTERS: ActivityFilter[] = ["all", "booked", "escalations"];

function matchesFilter(row: ActivityRow, filter: ActivityFilter): boolean {
  if (filter === "all") return true;
  if (filter === "booked") return row.kind === "booked";
  if (filter === "escalations") return row.kind === "escalated" || row.kind === "waiting";
  return true;
}

function rowKey(row: ActivityRow, index: number): string {
  return row.id ?? `${row.time}-${row.head}-${index}`;
}

export function ActivityStream({ rows, filter, setFilter, compact = false }: ActivityStreamProps) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = useCallback((key: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const filtered = rows.filter((r) => matchesFilter(r, filter));
  return (
    <section
      data-testid="cockpit-activity-stream"
      style={{ padding: compact ? "16px 18px 28px" : "20px 28px 28px" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          paddingBottom: 10,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.14em",
            color: T.ink3,
            textTransform: "uppercase",
          }}
        >
          Activity
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          {FILTERS.map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                fontSize: 11.5,
                color: filter === k ? T.ink : T.ink3,
                fontWeight: filter === k ? 600 : 500,
                padding: "4px 8px",
                borderRadius: 4,
                textTransform: "capitalize",
                fontFamily: "inherit",
              }}
            >
              {k}
            </button>
          ))}
        </div>
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {filtered.map((row, i) => {
          const key = rowKey(row, i);
          return (
            <ActivityRowComponent
              key={key}
              item={row}
              open={open.has(key)}
              toggle={() => toggle(key)}
              compact={compact}
            />
          );
        })}
        {filtered.length === 0 && (
          <li
            style={{
              padding: "20px 0",
              fontSize: 13,
              color: T.ink4,
              fontFamily: "JetBrains Mono",
              letterSpacing: "0.02em",
            }}
          >
            Nothing here yet.
          </li>
        )}
      </ul>
    </section>
  );
}
```

- [ ] **Step 3: Commit.**

```
feat(dashboard): A.4 — ActivityStream owns per-row open state

useState<Set<string>> keyed by row.id (with legacy fallback). toggle
adds/removes per row. Filter switches preserve open state — the Set is
not cleared when the filter changes, only the rendered subset changes.
```

---

### Task 14: Wire `cockpit-page.tsx` to the new hook

**Files:**
- Modify: `apps/dashboard/src/components/cockpit/cockpit-page.tsx`
- Modify: `apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx` (add a case)

- [ ] **Step 1: Swap the hook.**

Edit `apps/dashboard/src/components/cockpit/cockpit-page.tsx`:

- Remove import: `import { translatedActionToActivityRow } from "@/lib/cockpit/activity-kind-map";`
- Remove import: `import { useAgentActivity } from "@/hooks/use-agent-activity";`
- Add import: `import { useAgentActivityCockpit } from "@/hooks/use-agent-activity-cockpit";`
- Replace `const activityQ = useAgentActivity(1);` with `const activityQ = useAgentActivityCockpit("alex", { limit: 50, expandPreview: true });`
- Replace the `rawAlexActions` + `activityRows` derivation with:

```ts
const activityRows = activityQ.data?.rows ?? [];
const recentActivityAt =
  activityRows.length > 0
    ? // The new wire shape carries `time` (formatted) but not `timestamp`.
      // recentActivityAt is used by useCockpitStatusAlex to drive WORKING.
      // Server emits rows sorted desc by entry timestamp, so the first
      // row's timestamp is the most recent.
      // We need a raw timestamp here — extend the wire shape if status
      // derivation matters. For A.4, derive a Date from the formatted
      // string when same-day (HH:MM), else fall back to `now`.
      parseTimeOrNow(activityRows[0]!.time, now)
    : null;
```

> **Plan executor note:** `recentActivityAt` feeds `useCockpitStatusAlex` to drive the `WORKING` status pill. The current implementation reads `rawAlexActions[0].timestamp` directly. After the swap, the wire shape only carries formatted `time` strings. Two clean options:
>
> 1. **Extend wire shape:** add `timestampIso: string` to `CockpitActivityRow` (and the dashboard mirror) so the page can read it directly. Cleanest; one schema delta.
> 2. **Re-fetch raw audit:** keep `useAgentActivity` mounted *only* to drive status (it returns `TranslatedAction.timestamp`). Adds a duplicate query.
>
> Pick **option 1.** It's a 1-line wire shape extension; the translator already has the ISO timestamp in scope. The mirror test catches drift.
>
> **Action:** edit `packages/core/src/agent-home/cockpit-activity-row.ts` to add `timestampIso?: string;`, edit the translator to populate it from `entry.timestamp`, edit `apps/dashboard/src/components/cockpit/types.ts` to add the same field, and use `new Date(activityRows[0]!.timestampIso!)` directly. Drop the `parseTimeOrNow` helper.

After the swap, the page reads:

```ts
const activityRows = activityQ.data?.rows ?? [];
const recentActivityAt =
  activityRows.length > 0 && activityRows[0]!.timestampIso
    ? new Date(activityRows[0]!.timestampIso!)
    : null;
```

- [ ] **Step 2: Update the cockpit-page test to assert the new hook.**

- [ ] **Step 3: Run all dashboard tests + the local Next.js build.**

```bash
pnpm --filter @switchboard/dashboard test
pnpm --filter @switchboard/dashboard build
```

Per `feedback_dashboard_build_not_in_ci.md`: `next build` is not in CI; run it locally before declaring done. `.js`-extension regressions slip past `typecheck` + `vitest`.

- [ ] **Step 4: Commit.**

```
feat(dashboard): A.4 — cockpit-page consumes useAgentActivityCockpit

Drops the client-side translator path (use-agent-activity +
translatedActionToActivityRow). Server emits ActivityRow[] directly.
Legacy useAgentActivity + activity-kind-map remain mounted for the
agent-home block components (deleted at A.6). recentActivityAt now
reads the new timestampIso field carried in the wire row.
```

---

### Task 15: Pre-merge gates

- [ ] **Step 1: Adapter-boundary grep gate.**

```bash
rg "Recommendation|AuditEntry|@switchboard/db|@prisma" \
   apps/dashboard/src/components/cockpit \
   apps/dashboard/src/hooks
```

Expected: same match set as `main` before A.4. The new `use-agent-activity-cockpit.ts` imports `ActivityRow` from `@/components/cockpit/types` only.

- [ ] **Step 2: Surface-agnostic backend grep gate.**

```bash
rg "apps/dashboard|@/components|@/hooks" packages/core packages/db packages/schemas
```

Expected: no matches. Core/db/schemas never reference UI surfaces.

- [ ] **Step 3: Mirror assertion.**

```bash
pnpm --filter @switchboard/api typecheck
pnpm --filter @switchboard/api test -- --run cockpit-activity-row-mirror
```

Expected: clean.

- [ ] **Step 4: Full test sweep.**

```bash
pnpm reset
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @switchboard/dashboard build
```

Per `CLAUDE.md`: `pnpm reset` clears any stale `dist/` artifacts before the typecheck pass. Per `feedback_dashboard_build_not_in_ci.md`: the dashboard build is the only gate that catches `.js`-extension regressions in Next.js imports.

- [ ] **Step 5: Verify against running dev stack (per `feedback_verify_against_codebase.md` and the UI-testing CLAUDE.md guidance).**

```bash
pnpm dev
# Open http://localhost:3002/alex
# Steady state (post-onboarding org):
#   - Activity rows show head + time + kind chip (collapsed).
#   - Replyable rows show a chevron on the right.
#   - Click chevron → row expands with body + preview (3–4 messages) + "Tell Alex about {firstName}" + ThreadPreview "Send as me" button.
#   - "Send as me" navigates to /contacts/[id]?takeover=true.
#   - "Tell Alex about {firstName}" navigates to /contacts/[id]?note=open.
#   - Filter chips (all / booked / escalations) preserve open state on toggle.
#   - Halt does not affect activity stream rendering.
# Cold state (no Connection, no setup):
#   - EmptyState renders instead of ActivityStream (A.2 behavior unchanged).
```

If `/alex` shows "Couldn't load org config" or a blank stream, check `feedback_dev_stack.md` and `project_console_org_config_drift.md` before diagnosing the slice.

- [ ] **Step 6: PR description checklist (paste into the PR body).**

```markdown
## A.4 — Activity richness + thread previews

### Layers shipped

- **Core** — `ActivityPreviewReader` interface + `extractContactRef` + `CockpitActivityRow` type + `translateAuditToCockpitActivity` batched translator.
- **DB** — `PrismaActivityPreviewReader` with a single batched `findMany` per request.
- **API** — `GET /api/dashboard/agents/:agentId/activity?limit=N&expandPreview=true/false`; bootstrap registration; `apps/api/src/lib/cockpit-activity-deps.ts` wiring helper; compile-time mirror between `CockpitActivityRow` (core) and `ActivityRow` (dashboard).
- **Dashboard proxy + hook** — `apps/dashboard/src/app/api/dashboard/agents/[agentId]/activity/route.ts`; `useAgentActivityCockpit`; `agents.activityCockpit(agentId)` query key.
- **Components** — `<ThreadPreview>`; expansion + body + preview + "Tell Alex about {firstName}" affordance on `<ActivityRow>`; per-row open-state Set in `<ActivityStream>`; `<CockpitPage>` consumes the new hook.

### Decision locks

- No new schema (`ActivityRow` superset was declared at A.1; no Prisma migration; `ConversationMessage` covers preview reads via the existing `@@index([contactId, orgId])`).
- Server-side translator only (no client-side kind-map for the cockpit path).
- Legacy `useAgentActivity` + `activity-kind-map` remain mounted for `agent-home-client.tsx` (Riley's `/[agentKey]` path) until A.6.
- Inline reply is a route push to `/contacts/[id]?takeover=true`; no inline-send API call.
- "Tell Alex about {firstName}" routes to `/contacts/[id]?note=open`; no inline-note API call.
- Riley does not consume A.4; Riley's stream stays collapsed.

### Honest-impact-language review

- [ ] Body templates describe what Alex did, never causal impact.
- [ ] Head templates describe state transitions, not improvements.
- [ ] No "saved you $X" or "improved Y" copy anywhere in the slice.

### Test contract

- [ ] Core translator green (per-kind, batched fetch, short-circuit, contact-less fallback)
- [ ] Core extractor green (per event type)
- [ ] DB reader green (mocked Prisma; single + batch + ordered desc)
- [ ] API route green (happy path, limit clamp, agent filter, expandPreview off)
- [ ] Dashboard proxy + hook green
- [ ] ThreadPreview + ActivityRow + ActivityStream + CockpitPage green
- [ ] Mirror assertion green (CockpitActivityRow ≡ ActivityRow)
- [ ] Pre-merge adapter-boundary grep gate clean
- [ ] Pre-merge surface-agnostic grep gate clean
- [ ] `pnpm --filter @switchboard/dashboard build` clean (per `feedback_dashboard_build_not_in_ci.md`)

### What does NOT ship here

(Mirror the slice brief's §"What does NOT ship at A.4" list. Keep the closed-bullets format so reviewers can grep for "❌" and confirm the line.)

### Downstream

- Riley B.2b / B.3-followup: unaffected.
- A.5 (composer + palette): unblocked. A.5 ships independently.
- A.6 (cleanup): deletes legacy `useAgentActivity` + `activity-kind-map` after this slice has been stable in production.
```

- [ ] **Step 7: Commit the PR description as a docs reference (optional).**

If the team's PR template lives in `.github/PULL_REQUEST_TEMPLATE/`, no commit needed. Otherwise the checklist above goes verbatim into the GitHub PR description.

---

## Risk Watchlist

These are the same risks listed in the slice brief, with the implementation-side mitigations called out at the relevant tasks:

| # | Risk | Mitigation | Task |
|---|---|---|---|
| 1 | N+1 ConversationMessage queries | Single `findMany` keyed by `contactId IN [...]`; unit-tested with 4-contact fixture. | 4, 5 |
| 2 | Audit snapshot variance per event | Per-kind extractors with per-event-type unit cases; unknown returns null. | 2 |
| 3 | Preview author labeling | `metadata.author` override for operator; default `alex`/`contact` from direction. | 4 |
| 4 | React key drift across refetch | `row.id` from audit entry id; fallback to legacy key for backward compat. | 8, 13 |
| 5 | Expand state survives refetch | Open `Set<string>` is keyed by `row.id`; refetch reuses keys. | 13 |
| 6 | Narrow-viewport thread preview | Reuses cockpit content width; preview text wraps; "Send as me" full-width. | 11 |
| 7 | Honest-impact language regression | Locked body/head template tables; copy review in PR checklist. | 5 (tables) |
| 8 | `/contacts/[id]?takeover=true` route | Pre-existing route; verified-stable; A.4 only ships the link. | 11 |
| 9 | `recentActivityAt` loses raw timestamp | Add `timestampIso` to the wire shape (1-line schema delta; mirror test catches drift). | 5, 14 |
| 10 | `agentActorId` resolution (Alex vs Riley) | Locked at task time per `apps/api/src/lib/cockpit-activity-deps.ts` note; verify against existing audit emitter actorId conventions before implementation. | 6 |

---

## Out-of-band guardrails

Carry-over from prior cockpit slices and CLAUDE.md memories:

- **Worktree discipline (`CLAUDE.md` §Branch & Worktree Doctrine):** This slice runs on its own implementation branch; `docs/alex-cockpit-a4-plan` (the slice brief PR) is a separate docs branch and must merge to `main` before this implementation branch is rebased. Do not stack the two.
- **Test alignment (`feedback_api_test_mocked_prisma.md`):** API + db tests use mocked Prisma. No real Postgres needed.
- **Migrate discipline (`feedback_prisma_migrate_dev_tty.md`):** Not relevant — A.4 ships no migration. If a future slice changes that, use `migrate diff` + `migrate deploy`, never `migrate dev`.
- **Module size (`CLAUDE.md`):** `cockpit-activity-translator.ts` should stay under 400 lines (warn) / 600 lines (error). The locked code above is ≈230 lines — well within limits.
- **Reset before typecheck (`CLAUDE.md`):** If `pnpm typecheck` reports missing exports after editing `packages/core/src/index.ts`, run `pnpm reset` and retry — turbo's stale `dist/` is the usual cause.
- **Dashboard imports omit `.js` (`feedback_dashboard_no_js_on_any_import.md`):** All imports in `apps/dashboard/**` are extensionless; the `.js` requirement applies to `packages/**` only.
- **Dashboard build is not in CI (`feedback_dashboard_build_not_in_ci.md`):** `pnpm --filter @switchboard/dashboard build` is the only way to catch a regression — run it locally before opening the PR.

---

## Estimated effort

Five layers, 14 implementation tasks + 1 gates task. Estimated 6–8 hours for a focused executor using `superpowers:subagent-driven-development`. Risk concentration is at Task 5 (translator) and Task 14 (page swap + timestampIso wire-shape extension); both have well-defined precedents in the codebase (A.3's `legacyTiles`/`legacyRoi` pattern; A.2's mission aggregator wire shape).
