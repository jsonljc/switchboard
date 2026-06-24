# Robin v1 — Arm the governed no-show recovery gate (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the `no_show` attendance signal into a governed `robin.recovery_campaign.send` campaign intent that PARKS for mandatory manager approval, proven end-to-end against a real deployment resolver — the producer→consumer seam — while deferring the live patient send, the cron initiator, the `recovery.mode` flag, and the dedup migration to a later slice.

**Architecture:** Robin is a governed _capability_ (a campaign intent + a seeded approval gate + reads), NOT an LLM agent shell and NOT an `AgentDeployment`. A no-show cohort read assembles into one `robin.recovery_campaign.send` workflow intent submitted through `PlatformIngress` by the seeded `{id:"system",type:"system"}` principal; a seeded anchored allow + mandatory `require_approval` policy pair (mirroring Riley's budget reallocation) parks every campaign. Because Robin has no deployment by design, the intent resolves to a synthetic `platform-direct` context via an extended carve-out (the documented fix for the `deployment_not_found` landmine), which is safe because `platform-direct` (trust `supervised`/0) cannot relax a mandatory approval. This slice mirrors Riley's first act-leg slice: register the intent + seed the policy + a fail-closed placeholder executor, proven to PARK; the real executor (consent-gated send) and the cron initiator land next.

**Tech Stack:** TypeScript monorepo (pnpm + Turborepo), Zod (schemas), Prisma (db), Fastify (apps/api), Vitest. ESM, `.js` extensions on relative imports.

## Global Constraints

- **Mutations enter ONLY through `PlatformIngress.submit()`**; `WorkTrace` is canonical; no bypass paths.
- **Cron/automation actor MUST be the seeded `{ id: "system", type: "system" }` principal** verbatim — a bespoke `system:<x>` id is hard-denied (GovernanceGate) and silently never runs.
- **The campaign intent MUST PARK**, so it MUST NOT be `system_auto_approved` (that short-circuits the gate). `approvalPolicy: "always"` is decorative (not gate-consumed); the SEEDED `require_approval` policy is the real gate.
- **Never seed allow without require_approval (or vice-versa)**: allow-alone EXECUTES with no human; approval-alone default-denies. Seed both as one both-or-neither unit, org-scoped, anchored regex `^robin\.recovery_campaign\.send$`.
- **The campaign intent is NON-financial** (no outbound spend): NOT on `FINANCIAL_AUTO_APPROVE_DENYLIST`, carries no `spendAmount`.
- **Every read/write leg is org-scoped** (F12 / IDOR): any `*Store`/`*Reader` read keyed on a bare id needs an `organizationId` filter.
- **NaN-safe** math; no `console.log` (use `console.warn`/`console.error`); no `any`; ESM `.js` import extensions; Prettier (semi, double quotes, 2-space, trailing commas, 100 width); unused vars prefixed `_`.
- **Conventional Commits, lowercase subject** (commitlint `subject-case`).
- **NO em-dashes anywhere** (copy, comments, commit messages) — user's "--" AI-tell rule. Use `-` or restructure.
- **Co-located `*.test.ts`**; db tests use MOCKED Prisma (CI has no Postgres) — mirror `prisma-booking-store.test.ts`.
- **Before claiming green:** run FULL `pnpm typecheck` + `pnpm test` + `pnpm --filter @switchboard/api test` + `pnpm --filter @switchboard/db test` (a core change must typecheck api AND chat), `pnpm lint`, `pnpm format:check`, `pnpm arch:check`, `pnpm build`, `CI=1 npx tsx scripts/local-verify-fast.ts`, `pnpm eval:governance`, em-dash grep on the FULL three-dot diff.
- **This slice trips governance + ingress stop-globs -> SURFACE for human merge (do NOT auto-merge).**

## Scope: IN vs DEFERRED

**IN (this slice):** the `findNoShowRecoveryCandidates` list read; the pure `selectRecoveryCandidates` filter; the `RobinRecoveryCampaignParams` payload schema; the `robin.recovery_campaign.send` intent constant + submit-request builder; the intent registration + a fail-closed placeholder executor; the seeded allow + require_approval policy pair wired into org provisioning; the `deployment_not_found` carve-out fix; the real-gate PARKS test against a real resolver.

**DEFERRED (explicitly, to the "patient outreach" slice the user named):** the Inngest cron initiator; the consent-gated WhatsApp send executor (replaces the placeholder); the `governanceConfig.recovery.mode` flag + resolver (lands with the cron, its consumer — shipping it now would be an inert flag, violating producer-population); the `RobinRecoverySend` dedup model + migration (lands with the send). Safety in this slice is by construction: no prod path submits the intent (no cron), and the placeholder executor sends nothing.

**Parallel-PR note:** PR #1166 (`feat/robin-recovery-candidates-observe`, OPEN) ships S1's observe tile + a _count_ read and also touches `packages/db/src/stores/prisma-booking-store.ts`. This branch is cut off fresh `origin/main` (no #1166), so it adds the _list_ read `findNoShowRecoveryCandidates` independently. Expect a trivial additive merge in that file when both land. Use three-dot diffs (`git diff origin/main...HEAD`).

---

### Task 1: Recovery campaign payload schema (`RobinRecoveryCampaignParams`)

**Files:**

- Create: `packages/schemas/src/robin-recovery.ts`
- Modify: `packages/schemas/src/index.ts` (add `export * from "./robin-recovery.js";`)
- Test: `packages/schemas/src/__tests__/robin-recovery.test.ts`

**Interfaces:**

- Produces: `RecoveryCandidateSchema` / `RecoveryCandidate` ({ bookingId, contactId, service, startsAt (ISO), attendeeName? }); `RobinRecoveryCampaignParamsSchema` / `RobinRecoveryCampaignParams` ({ windowFrom, windowTo, candidates[] (min 1), recipientCount }). Consumed by Task 4 (builder) and Task 8 (test).

- [ ] **Step 1: Write the failing test**

```ts
// packages/schemas/src/__tests__/robin-recovery.test.ts
import { describe, it, expect } from "vitest";
import { RobinRecoveryCampaignParamsSchema, RecoveryCandidateSchema } from "../robin-recovery.js";

const candidate = {
  bookingId: "bk_1",
  contactId: "ct_1",
  service: "Botox consult",
  startsAt: "2026-06-10T09:00:00.000Z",
  attendeeName: "Jamie",
};

describe("RobinRecoveryCampaignParamsSchema", () => {
  it("accepts a non-empty cohort with a matching recipientCount", () => {
    const parsed = RobinRecoveryCampaignParamsSchema.safeParse({
      windowFrom: "2026-06-01T00:00:00.000Z",
      windowTo: "2026-06-08T00:00:00.000Z",
      candidates: [candidate],
      recipientCount: 1,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an empty cohort (an empty campaign must never park)", () => {
    const parsed = RobinRecoveryCampaignParamsSchema.safeParse({
      windowFrom: "2026-06-01T00:00:00.000Z",
      windowTo: "2026-06-08T00:00:00.000Z",
      candidates: [],
      recipientCount: 0,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a recipientCount that disagrees with the cohort size", () => {
    const parsed = RobinRecoveryCampaignParamsSchema.safeParse({
      windowFrom: "2026-06-01T00:00:00.000Z",
      windowTo: "2026-06-08T00:00:00.000Z",
      candidates: [candidate],
      recipientCount: 5,
    });
    expect(parsed.success).toBe(false);
  });

  it("RecoveryCandidateSchema rejects a blank bookingId", () => {
    expect(RecoveryCandidateSchema.safeParse({ ...candidate, bookingId: "" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/schemas test robin-recovery`
Expected: FAIL ("Cannot find module ../robin-recovery.js" / export missing).

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/schemas/src/robin-recovery.ts
import { z } from "zod";

/**
 * One no-show recovery target, frozen into the campaign the manager approves. attendeeName is
 * for the approval card only; the recipient phone is resolved at dispatch from contactId (the
 * consent-gated send slice), never frozen here, so consent is re-validated at send time.
 */
export const RecoveryCandidateSchema = z.object({
  bookingId: z.string().min(1),
  contactId: z.string().min(1),
  service: z.string().min(1),
  startsAt: z.string().datetime(),
  attendeeName: z.string().nullable().optional(),
});
export type RecoveryCandidate = z.infer<typeof RecoveryCandidateSchema>;

/**
 * Parameters for a robin.recovery_campaign.send intent: the frozen cohort plus the window it was
 * assembled over. recipientCount is the blast radius surfaced on the approval card and MUST equal
 * the cohort size. A campaign with zero candidates is invalid (it must never park).
 */
export const RobinRecoveryCampaignParamsSchema = z
  .object({
    windowFrom: z.string().datetime(),
    windowTo: z.string().datetime(),
    candidates: z.array(RecoveryCandidateSchema).min(1),
    recipientCount: z.number().int().nonnegative(),
  })
  .refine((p) => p.recipientCount === p.candidates.length, {
    message: "recipientCount must equal the number of candidates",
    path: ["recipientCount"],
  });
export type RobinRecoveryCampaignParams = z.infer<typeof RobinRecoveryCampaignParamsSchema>;
```

- [ ] **Step 4: Add the barrel export**

In `packages/schemas/src/index.ts`, add alongside the other `export * from` lines:

```ts
export * from "./robin-recovery.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @switchboard/schemas test robin-recovery`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/robin-recovery.ts packages/schemas/src/index.ts packages/schemas/src/__tests__/robin-recovery.test.ts
git commit -m "feat(schemas): add robin recovery campaign params schema"
```

---

### Task 2: No-show recovery-candidate list read (`findNoShowRecoveryCandidates`)

**Files:**

- Modify: `packages/db/src/stores/prisma-booking-store.ts` (add a method to `PrismaBookingStore`, after `countMaturedAttendance` ~line 301)
- Test: `packages/db/src/stores/__tests__/prisma-booking-store.test.ts` (add a describe block; mirror the existing mocked-Prisma pattern in this file)

**Interfaces:**

- Produces: `PrismaBookingStore.findNoShowRecoveryCandidates(input: { orgId: string; from: Date; to: Date }): Promise<Array<{ bookingId: string; contactId: string; service: string; startsAt: Date; attendeeName: string | null }>>`. Consumed by the future cron; exercised by Task 8.

- [ ] **Step 1: Write the failing test**

Open `packages/db/src/stores/__tests__/prisma-booking-store.test.ts`, read its existing mock-Prisma setup (how it stubs `prisma.booking.findMany`/`count`), and add (adapt the mock-construction helper name to the one already in the file):

```ts
describe("findNoShowRecoveryCandidates", () => {
  it("queries org-scoped no_show bookings in the window and maps rows", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([
        {
          id: "bk_1",
          contactId: "ct_1",
          service: "Botox",
          startsAt: new Date("2026-06-03T09:00:00Z"),
          attendeeName: "Jamie",
        },
      ]);
    // Reuse this file's existing prisma-mock factory; only booking.findMany is needed here.
    const store = new PrismaBookingStore({ booking: { findMany } } as unknown as PrismaClient);

    const rows = await store.findNoShowRecoveryCandidates({
      orgId: "org_1",
      from: new Date("2026-06-01T00:00:00Z"),
      to: new Date("2026-06-08T00:00:00Z"),
    });

    expect(findMany).toHaveBeenCalledTimes(1);
    const arg = findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      organizationId: "org_1",
      attendance: "no_show",
      startsAt: { gte: new Date("2026-06-01T00:00:00Z"), lt: new Date("2026-06-08T00:00:00Z") },
    });
    expect(arg.take).toBe(1000);
    expect(rows).toEqual([
      {
        bookingId: "bk_1",
        contactId: "ct_1",
        service: "Botox",
        startsAt: new Date("2026-06-03T09:00:00Z"),
        attendeeName: "Jamie",
      },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/db test prisma-booking-store`
Expected: FAIL (`findNoShowRecoveryCandidates is not a function`).

- [ ] **Step 3: Write minimal implementation**

In `packages/db/src/stores/prisma-booking-store.ts`, after `countMaturedAttendance` (the last method, ~line 301), add:

```ts
  // Org-scoped list of no-show bookings in a window, the cohort Robin's recovery campaign targets.
  // On the @@index([organizationId, attendance]) (purpose-built for this query). Bounded like
  // findUpcomingConfirmed so a backlog cannot blow up the cohort. attendeeName is denormalized on
  // Booking (display only); the recipient phone is resolved at send time from contactId, never here.
  async findNoShowRecoveryCandidates(input: {
    orgId: string;
    from: Date;
    to: Date;
  }): Promise<
    Array<{
      bookingId: string;
      contactId: string;
      service: string;
      startsAt: Date;
      attendeeName: string | null;
    }>
  > {
    const SCAN_LIMIT = 1000;
    const rows = await this.prisma.booking.findMany({
      where: {
        organizationId: input.orgId,
        attendance: "no_show",
        startsAt: { gte: input.from, lt: input.to },
      },
      orderBy: { startsAt: "asc" },
      take: SCAN_LIMIT,
      select: { id: true, contactId: true, service: true, startsAt: true, attendeeName: true },
    });
    return rows.map((r) => ({
      bookingId: r.id,
      contactId: r.contactId,
      service: r.service,
      startsAt: r.startsAt,
      attendeeName: r.attendeeName,
    }));
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/db test prisma-booking-store`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/prisma-booking-store.ts packages/db/src/stores/__tests__/prisma-booking-store.test.ts
git commit -m "feat(db): add org-scoped no-show recovery-candidate list read"
```

---

### Task 3: Pure cohort filter (`selectRecoveryCandidates`)

**Files:**

- Create: `packages/core/src/recovery/select-recovery-candidates.ts`
- Create/Modify: `packages/core/src/recovery/index.ts` (barrel) and ensure it is re-exported from `packages/core/src/index.ts` if that is how core exposes subdirs (check the existing `reports`/`consent` pattern and follow it)
- Test: `packages/core/src/recovery/select-recovery-candidates.test.ts`

**Interfaces:**

- Consumes: `RecoveryCandidateInput` shape = the Task 2 row shape (bookingId, contactId, service, startsAt, attendeeName).
- Produces: `selectRecoveryCandidates(candidates: RecoveryCandidateInput[], opts: { existingFutureBookingContactIds: ReadonlySet<string> }): RecoveryCandidateInput[]`. Consumed by the future cron; exercised by Task 8.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/recovery/select-recovery-candidates.test.ts
import { describe, it, expect } from "vitest";
import { selectRecoveryCandidates } from "./select-recovery-candidates.js";

const c = (bookingId: string, contactId: string) => ({
  bookingId,
  contactId,
  service: "svc",
  startsAt: new Date("2026-06-03T09:00:00Z"),
  attendeeName: null,
});

describe("selectRecoveryCandidates", () => {
  it("excludes contacts who already hold a future booking (already rebooked)", () => {
    const out = selectRecoveryCandidates([c("bk_1", "ct_1"), c("bk_2", "ct_2")], {
      existingFutureBookingContactIds: new Set(["ct_2"]),
    });
    expect(out.map((x) => x.contactId)).toEqual(["ct_1"]);
  });

  it("dedupes to one recovery attempt per contact (keeps the first by input order)", () => {
    const out = selectRecoveryCandidates([c("bk_1", "ct_1"), c("bk_2", "ct_1")], {
      existingFutureBookingContactIds: new Set(),
    });
    expect(out).toHaveLength(1);
    expect(out[0].bookingId).toBe("bk_1");
  });

  it("returns empty for an empty cohort", () => {
    expect(selectRecoveryCandidates([], { existingFutureBookingContactIds: new Set() })).toEqual(
      [],
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test select-recovery-candidates`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/recovery/select-recovery-candidates.ts
export interface RecoveryCandidateInput {
  bookingId: string;
  contactId: string;
  service: string;
  startsAt: Date;
  attendeeName: string | null;
}

/**
 * Pure, deterministic selection of the no-show recovery cohort. Drops contacts who already hold a
 * future booking (they self-rebooked, no recovery needed) and de-duplicates to one attempt per
 * contact (keeps the first in input order; the caller orders by startsAt). The future-booking set
 * is supplied by the caller (a batched org-scoped read lands with the cron slice). No I/O, no Date
 * math, NaN-free.
 */
export function selectRecoveryCandidates(
  candidates: RecoveryCandidateInput[],
  opts: { existingFutureBookingContactIds: ReadonlySet<string> },
): RecoveryCandidateInput[] {
  const seen = new Set<string>();
  const out: RecoveryCandidateInput[] = [];
  for (const candidate of candidates) {
    if (opts.existingFutureBookingContactIds.has(candidate.contactId)) continue;
    if (seen.has(candidate.contactId)) continue;
    seen.add(candidate.contactId);
    out.push(candidate);
  }
  return out;
}
```

- [ ] **Step 4: Create the barrel + wire core export**

`packages/core/src/recovery/index.ts`:

```ts
export * from "./select-recovery-candidates.js";
```

Then mirror how core exposes other subdir barrels: if `packages/core/src/index.ts` re-exports sibling domains (e.g. `export * from "./reports/index.js"`), add `export * from "./recovery/index.js"`. If core instead exposes subpath entrypoints via `package.json` `exports`, follow that pattern instead. Verify by grepping `packages/core/src/index.ts` and `packages/core/package.json` for how `reports` is exposed and match it exactly.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test select-recovery-candidates`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/recovery/
git commit -m "feat(core): add pure no-show recovery cohort filter"
```

---

### Task 4: Intent constant + campaign submit-request builder

**Files:**

- Create: `apps/api/src/services/workflows/robin-recovery-request.ts`
- Test: `apps/api/src/services/workflows/__tests__/robin-recovery-request.test.ts`

**Interfaces:**

- Consumes: `RobinRecoveryCampaignParamsSchema` (Task 1); `RecoveryCandidateInput` (Task 3, the `Date`-based filter-output shape); `CanonicalSubmitRequest` (`@switchboard/core/platform`).
- Produces: `ROBIN_RECOVERY_SEND_INTENT = "robin.recovery_campaign.send"`; `buildRecoveryCampaignSubmitRequest(input: RecoveryCampaignSubmitInput): CanonicalSubmitRequest | null`. The builder accepts `Date`-based candidates (the read/filter output) and serializes `startsAt` to ISO at the payload boundary, so the seam is one continuous `Date` flow from read -> filter -> build. Consumed by Tasks 5, 7, 8.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/services/workflows/__tests__/robin-recovery-request.test.ts
import { describe, it, expect } from "vitest";
import {
  buildRecoveryCampaignSubmitRequest,
  ROBIN_RECOVERY_SEND_INTENT,
} from "../robin-recovery-request.js";

// Date-based candidate (the read/filter output shape), NOT the ISO payload shape.
const candidate = {
  bookingId: "bk_1",
  contactId: "ct_1",
  service: "Botox",
  startsAt: new Date("2026-06-03T09:00:00.000Z"),
  attendeeName: "Jamie",
};

describe("buildRecoveryCampaignSubmitRequest", () => {
  it("returns null for an empty cohort (an empty campaign must never park)", () => {
    expect(
      buildRecoveryCampaignSubmitRequest({
        organizationId: "org_1",
        windowFrom: new Date("2026-06-01T00:00:00Z"),
        windowTo: new Date("2026-06-08T00:00:00Z"),
        candidates: [],
      }),
    ).toBeNull();
  });

  it("builds a system-principal, schedule-trigger, parked-intent request with no targetHint", () => {
    const req = buildRecoveryCampaignSubmitRequest({
      organizationId: "org_1",
      windowFrom: new Date("2026-06-01T00:00:00Z"),
      windowTo: new Date("2026-06-08T00:00:00Z"),
      candidates: [candidate],
    });
    expect(req).not.toBeNull();
    expect(req!.intent).toBe(ROBIN_RECOVERY_SEND_INTENT);
    expect(req!.actor).toEqual({ id: "system", type: "system" });
    expect(req!.trigger).toBe("schedule");
    expect(req!.targetHint).toBeUndefined(); // robin has no deployment; resolves to platform-direct
    expect((req!.parameters as { recipientCount: number }).recipientCount).toBe(1);
    expect(req!.idempotencyKey).toBe("mutate:robin:org_1:2026-06-01:recovery");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/api test robin-recovery-request`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/api/src/services/workflows/robin-recovery-request.ts
import type { CanonicalSubmitRequest } from "@switchboard/core/platform";
import type { RecoveryCandidateInput } from "@switchboard/core";
import { RobinRecoveryCampaignParamsSchema } from "@switchboard/schemas";

// Robin v1 no-show recovery campaign. Registered in bootstrap/contained-workflows.ts (workflow
// mode, NOT system_auto_approved so it PARKS), gated by the seeded allow + require_approval policy
// pair (packages/db/src/seed/robin-recovery-governance.ts), and resolved to platform-direct by the
// carve-out in app.ts (Robin has no deployment). The executor is a fail-closed placeholder until
// the consent-gated send slice; the cron initiator lands then too. Non-financial (no spend).
export const ROBIN_RECOVERY_SEND_INTENT = "robin.recovery_campaign.send";

export interface RecoveryCampaignSubmitInput {
  organizationId: string;
  windowFrom: Date;
  windowTo: Date;
  candidates: RecoveryCandidateInput[]; // Date-based (the read/filter output)
}

/**
 * Build the canonical submit request for one no-show recovery campaign. Mirrors
 * buildRileyBudgetSubmitRequest: the seeded `{ id: "system", type: "system" }` principal verbatim
 * (a bespoke system:<x> hard-denies), trigger "schedule", a deterministic per-org-per-window
 * idempotency key. Accepts the Date-based filter output and serializes startsAt to ISO at the
 * payload boundary (the frozen cohort is JSON). Returns NULL on an empty cohort (defense in depth:
 * an empty campaign must never park). NO targetHint: Robin has no deployment, so the ingress
 * resolver derives slug "robin" and the platform-direct carve-out (app.ts) resolves it. The frozen
 * `candidates` is exactly what the human approves and the bindingHash content-binds; the executor
 * re-validates consent per recipient at dispatch (the send slice), never bypassing it.
 */
export function buildRecoveryCampaignSubmitRequest(
  input: RecoveryCampaignSubmitInput,
): CanonicalSubmitRequest | null {
  if (input.candidates.length === 0) return null;
  const candidates = input.candidates.map((c) => ({
    bookingId: c.bookingId,
    contactId: c.contactId,
    service: c.service,
    startsAt: c.startsAt.toISOString(),
    attendeeName: c.attendeeName ?? null,
  }));
  const parameters = {
    windowFrom: input.windowFrom.toISOString(),
    windowTo: input.windowTo.toISOString(),
    candidates,
    recipientCount: candidates.length,
  };
  const parsed = RobinRecoveryCampaignParamsSchema.safeParse(parameters);
  if (!parsed.success) return null;
  const windowDay = input.windowFrom.toISOString().slice(0, 10);
  return {
    organizationId: input.organizationId,
    actor: { id: "system", type: "system" },
    intent: ROBIN_RECOVERY_SEND_INTENT,
    parameters: parsed.data,
    trigger: "schedule",
    surface: { surface: "api" },
    idempotencyKey: `mutate:robin:${input.organizationId}:${windowDay}:recovery`,
  };
}
```

Note: confirm the `CanonicalSubmitRequest` field names (`trigger`, `surface`, `idempotencyKey`, `targetHint?`) against `riley-budget-submit-request.ts` (verified shape) and the type def; adjust if the type requires an explicit `targetHint: undefined` vs omission. Confirm the `@switchboard/core` import path for `RecoveryCandidateInput` matches Task 3's barrel wiring (if core uses subpath exports, import from the matching subpath, e.g. `@switchboard/core/recovery`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/api test robin-recovery-request`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/workflows/robin-recovery-request.ts apps/api/src/services/workflows/__tests__/robin-recovery-request.test.ts
git commit -m "feat(api): add robin recovery campaign submit-request builder"
```

---

### Task 5: Register the intent + fail-closed placeholder executor

**Files:**

- Create: `apps/api/src/bootstrap/robin-recovery-executor.ts`
- Modify: `apps/api/src/bootstrap/contained-workflows.ts` (import + build the executor ~line 275, add to the `handlers` Map ~line 423, add to the `workflowIntents` array ~line 574)
- Test: `apps/api/src/bootstrap/__tests__/robin-recovery-executor.test.ts`

**Interfaces:**

- Consumes: `ROBIN_RECOVERY_SEND_INTENT` (Task 4); `WorkflowHandler` (`@switchboard/core/platform`).
- Produces: `buildRobinRecoverySendExecutor(): { intent: string; handler: WorkflowHandler }`. The intent is registered as a `workflow`-mode, non-`system_auto_approved`, `["schedule"]`-trigger intent.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/bootstrap/__tests__/robin-recovery-executor.test.ts
import { describe, it, expect } from "vitest";
import { buildRobinRecoverySendExecutor } from "../robin-recovery-executor.js";
import { ROBIN_RECOVERY_SEND_INTENT } from "../../services/workflows/robin-recovery-request.js";

describe("buildRobinRecoverySendExecutor", () => {
  it("registers under the recovery intent", () => {
    expect(buildRobinRecoverySendExecutor().intent).toBe(ROBIN_RECOVERY_SEND_INTENT);
  });

  it("is a fail-closed placeholder (the live send lands in a later slice)", async () => {
    const { handler } = buildRobinRecoverySendExecutor();
    const result = await handler.execute(
      {} as Parameters<typeof handler.execute>[0],
      {} as Parameters<typeof handler.execute>[1],
    );
    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("ROBIN_RECOVERY_SEND_NOT_WIRED");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/api test robin-recovery-executor`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/api/src/bootstrap/robin-recovery-executor.ts
import type { WorkflowHandler } from "@switchboard/core/platform";
import { ROBIN_RECOVERY_SEND_INTENT } from "../services/workflows/robin-recovery-request.js";

/**
 * Placeholder executor for robin.recovery_campaign.send. This slice ARMS the governed path (intent
 * + seeded require_approval policy + deployment resolution), proven to PARK; the live consent-gated
 * WhatsApp send lands in a later slice. Fail-closed, mirroring Riley's reallocate EXECUTOR_NOT_WIRED
 * first-slice placeholder: on the not-yet-reachable approve+dispatch it records a loud failure
 * rather than silently "completing" a campaign that sent nothing. No prod path submits this intent
 * yet (the cron lands with the send), so this runs only under test.
 */
export function buildRobinRecoverySendExecutor(): { intent: string; handler: WorkflowHandler } {
  return {
    intent: ROBIN_RECOVERY_SEND_INTENT,
    handler: {
      async execute() {
        return {
          outcome: "failed" as const,
          summary:
            "Robin recovery send is not wired yet; the consent-gated send lands in a later slice.",
          error: {
            code: "ROBIN_RECOVERY_SEND_NOT_WIRED",
            message:
              "robin.recovery_campaign.send dispatch is deferred to the consent-gated send slice.",
          },
        };
      },
    },
  };
}
```

- [ ] **Step 4: Wire into `contained-workflows.ts`**

(a) Near the other executor builds (after `rileyBudgetExecutor`, ~line 275), add:

```ts
const robinRecoverySendExecutor = buildRobinRecoverySendExecutor();
```

and add the import at the top of the file (with the other `./...executor.js` imports):

```ts
import { buildRobinRecoverySendExecutor } from "./robin-recovery-executor.js";
```

(b) In the `handlers` Map (~line 423, after the `conversation.reminder.send` entry), add:

```ts
    [robinRecoverySendExecutor.intent, robinRecoverySendExecutor.handler],
```

(c) In the `workflowIntents` array (~line 574, after the `conversation.reminder.send` entry, before the closing `];`), add:

```ts
    {
      // Robin v1 no-show recovery campaign (the mass-outbound approval gate). A platform-initiated
      // (cron/system) batch proactive send: deliberately NOT system_auto_approved, so the seeded
      // require_approval(mandatory) policy (db seed robin-recovery-governance.ts) parks every
      // campaign for a human. approvalPolicy here is decorative (the policy engine reads
      // policyApprovalOverride). Non-financial (no outbound spend; not on the financial denylist).
      // The executor is a fail-closed placeholder until the consent-gated send slice; the cron
      // initiator lands then too. Schedule-trigger-only (cron), not reachable from the public API.
      intent: robinRecoverySendExecutor.intent,
      workflowId: robinRecoverySendExecutor.intent,
      budgetClass: "cheap",
      approvalPolicy: "always",
      allowedTriggers: ["schedule"],
    },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/api test robin-recovery-executor`
Expected: PASS (2 tests).
Run: `pnpm --filter @switchboard/api typecheck` (confirm the `contained-workflows.ts` wiring type-checks).
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/bootstrap/robin-recovery-executor.ts apps/api/src/bootstrap/__tests__/robin-recovery-executor.test.ts apps/api/src/bootstrap/contained-workflows.ts
git commit -m "feat(api): register robin recovery campaign intent with a fail-closed placeholder executor"
```

---

### Task 6: Seed the allow + require_approval policy pair (the gate) + wire into provisioning

**Files:**

- Create: `packages/db/src/seed/robin-recovery-governance.ts`
- Modify: `packages/db/src/seed/provision-org-agents.ts` (call `seedRobinRecoveryPolicies` in the ALWAYS-RUN branch of `provisionOrgAgentDeployments`, before the `if (!opts.mira) return` at ~line 157)
- Modify: `packages/db/src/index.ts` (export `seedRobinRecoveryPolicies` + the builders, mirroring how `seedRileyReallocatePolicies` is exported, if it is)
- Test: `packages/db/src/seed/__tests__/robin-recovery-governance.test.ts`

**Interfaces:**

- Produces: `seedRobinRecoveryPolicies(client, organizationId): Promise<void>`; `buildRobinRecoveryAllowPolicyInput(orgId)`, `buildRobinRecoveryApprovalPolicyInput(orgId)`, `robinRecoveryAllowPolicyId(orgId)`, `robinRecoveryApprovalPolicyId(orgId)`. Consumed by Task 8 (the gate test seeds these) and org provisioning.

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/src/seed/__tests__/robin-recovery-governance.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  buildRobinRecoveryAllowPolicyInput,
  buildRobinRecoveryApprovalPolicyInput,
  seedRobinRecoveryPolicies,
} from "../robin-recovery-governance.js";

describe("robin recovery governance policies", () => {
  it("the allow policy is an anchored allow for the recovery intent", () => {
    const p = buildRobinRecoveryAllowPolicyInput("org_1");
    expect(p.effect).toBe("allow");
    expect(p.rule.conditions[0]).toMatchObject({
      field: "actionType",
      operator: "matches",
      value: "^robin\\.recovery_campaign\\.send$",
    });
  });

  it("the approval policy is mandatory require_approval for the recovery intent", () => {
    const p = buildRobinRecoveryApprovalPolicyInput("org_1");
    expect(p.effect).toBe("require_approval");
    expect(p.approvalRequirement).toBe("mandatory");
  });

  it("seeds BOTH policies (never one without the other)", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    await seedRobinRecoveryPolicies({ policy: { upsert } } as never, "org_1");
    expect(upsert).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/db test robin-recovery-governance`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation** (mirror `riley-budget-governance.ts` exactly)

```ts
// packages/db/src/seed/robin-recovery-governance.ts
import type { PrismaDbClient } from "../prisma-db.js";

// Anchored + escaped: the rule-evaluator does an unanchored new RegExp(value).test(actionType).
const ROBIN_RECOVERY_RULE = {
  conditions: [
    {
      field: "actionType",
      operator: "matches" as const,
      value: "^robin\\.recovery_campaign\\.send$",
    },
  ],
};

export function robinRecoveryAllowPolicyId(organizationId: string): string {
  return `policy_allow_robin_recovery_${organizationId}`;
}

export function buildRobinRecoveryAllowPolicyInput(organizationId: string) {
  return {
    id: robinRecoveryAllowPolicyId(organizationId),
    name: "Allow Robin no-show recovery campaign self-submission",
    description:
      "Robin's governed recovery campaign is governed by mandatory approval, not hard-denied.",
    organizationId,
    priority: 50,
    active: true,
    rule: ROBIN_RECOVERY_RULE,
    effect: "allow",
  };
}

export function robinRecoveryApprovalPolicyId(organizationId: string): string {
  return `policy_require_approval_robin_recovery_${organizationId}`;
}

export function buildRobinRecoveryApprovalPolicyInput(organizationId: string) {
  return {
    id: robinRecoveryApprovalPolicyId(organizationId),
    name: "Require human approval for a Robin no-show recovery campaign",
    description:
      "A Robin recovery campaign is a mass proactive patient send and always requires mandatory human approval.",
    organizationId,
    priority: 40,
    active: true,
    rule: ROBIN_RECOVERY_RULE,
    effect: "require_approval",
    approvalRequirement: "mandatory",
  };
}

/**
 * Seed the allow + mandatory-approval recovery policies as one both-or-neither unit (mirrors
 * seedRileyReallocatePolicies). Load-bearing together: allow alone would EXECUTE a mass patient
 * send with no human; approval alone default-denies. The caller owns the transaction boundary
 * (provisionOrgAgentDeployments passes the tx client) so a crash between upserts cannot leave
 * allow-alone. Idempotent on the deterministic per-org ids; safe to re-run.
 */
export async function seedRobinRecoveryPolicies(
  client: PrismaDbClient,
  organizationId: string,
): Promise<void> {
  const { id: allowId, ...allowData } = buildRobinRecoveryAllowPolicyInput(organizationId);
  await client.policy.upsert({
    where: { id: allowId },
    create: { id: allowId, ...allowData },
    update: allowData,
  });

  const { id: approvalId, ...approvalData } = buildRobinRecoveryApprovalPolicyInput(organizationId);
  await client.policy.upsert({
    where: { id: approvalId },
    create: { id: approvalId, ...approvalData },
    update: approvalData,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/db test robin-recovery-governance`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire into org provisioning (producer-population, ALWAYS-RUN)**

In `packages/db/src/seed/provision-org-agents.ts`, inside `provisionOrgAgentDeployments`, add the import at the top:

```ts
import { seedRobinRecoveryPolicies } from "./robin-recovery-governance.js";
```

and add the call after the Riley line (`const riley = ...`, ~line 156) and BEFORE `if (!opts.mira) return { riley };` (~line 157):

```ts
// Robin v1: arm the governed no-show recovery campaign gate for every org (day-one, like
// Riley). Seeds the allow + mandatory-approval pair so a submitted recovery campaign PARKS for
// a human instead of hard-denying. Idempotent. The recovery.mode flag (default off) + the cron
// initiator land in a later slice, so this gate is dormant until then (nothing submits the
// intent yet). Producer-population in the same PR: the gate is never seeded inert.
await seedRobinRecoveryPolicies(tx, orgId);
```

- [ ] **Step 6: Verify ALL provisioning paths are covered (anti-inert)**

Run: `rg -n "seedRileyReallocatePolicies|seedRileyAdOptimizerDeployment" --type ts -g '!*.test.ts'`
For EVERY non-test call site that seeds the Riley reallocate gate for an org (e.g. a dev/demo seed in `packages/db/prisma/seed-marketplace.ts` for `org_demo`, if present), add a sibling `seedRobinRecoveryPolicies(<client>, <orgId>)` call so Robin's gate is non-inert for every org Riley's is. Add the export to `packages/db/src/index.ts` if the Riley equivalents are exported there. (If the only org-provision path is `provisionOrgAgentDeployments`, Step 5 suffices; this step confirms it.)

- [ ] **Step 7: Run db tests + commit**

Run: `pnpm --filter @switchboard/db test`
Expected: PASS.

```bash
git add packages/db/src/seed/robin-recovery-governance.ts packages/db/src/seed/provision-org-agents.ts packages/db/src/seed/__tests__/robin-recovery-governance.test.ts packages/db/src/index.ts
git commit -m "feat(db): seed robin recovery approval gate and arm it in org provisioning"
```

---

### Task 7: Fix the `deployment_not_found` landmine (platform-direct carve-out)

**Files:**

- Modify: `apps/api/src/bootstrap/platform-deployment-resolver.ts` (generalize the option `isOperatorMutationIntent` -> `isPlatformDirectIntent` + update the doc comment + the call at line 37)
- Modify: `apps/api/src/app.ts` (extend the predicate at ~line 783 to also match `ROBIN_RECOVERY_SEND_INTENT`; import the constant)
- Test: `apps/api/src/bootstrap/__tests__/platform-deployment-resolver.test.ts` (create if absent)

**Interfaces:**

- Consumes: `ROBIN_RECOVERY_SEND_INTENT` (Task 4).
- Produces: `resolveAuthoritativeDeployment(resolver, { isPlatformDirectIntent })` resolves `robin.recovery_campaign.send` to the `platform-direct` context (deploymentId `"platform-direct"`, trustLevel `"supervised"`) instead of throwing `deployment_not_found`.

**Why safe:** `platform-direct` is trust `supervised`/score 0 (the least autonomous context). The campaign is gated by a seeded `mandatory` `require_approval` policy, which survives any trust posture (per Riley's "mandatory survives the autonomous lever"), so resolving Robin to platform-direct can only make the gate MORE conservative, never auto-approve. This mirrors the #1119 carve-out for operator_mutation crons.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/bootstrap/__tests__/platform-deployment-resolver.test.ts
import { describe, it, expect, vi } from "vitest";
import { resolveAuthoritativeDeployment } from "../platform-deployment-resolver.js";
import { ROBIN_RECOVERY_SEND_INTENT } from "../../services/workflows/robin-recovery-request.js";

// A prod-like resolver: it THROWS for any unseeded slug (Robin has no deployment). The test-server
// null-resolver masks this; here we exercise the real throw so the carve-out is actually proven.
const throwingResolver = {
  resolveByOrgAndSlug: vi.fn(async (_org: string, slug: string) => {
    throw new Error(`deployment not found for slug "${slug}"`);
  }),
};

const robinIsPlatformDirect = (intent: string) => intent === ROBIN_RECOVERY_SEND_INTENT;

describe("resolveAuthoritativeDeployment platform-direct carve-out", () => {
  it("resolves robin.recovery_campaign.send to platform-direct (no deployment_not_found throw)", async () => {
    const resolver = resolveAuthoritativeDeployment(throwingResolver as never, {
      isPlatformDirectIntent: robinIsPlatformDirect,
    });
    const ctx = await resolver.resolve({
      organizationId: "org_1",
      intent: ROBIN_RECOVERY_SEND_INTENT,
      actor: { id: "system", type: "system" },
      parameters: {},
    } as never);
    expect(ctx.deploymentId).toBe("platform-direct");
    expect(throwingResolver.resolveByOrgAndSlug).not.toHaveBeenCalled();
  });

  it("still throws for an unseeded NON-carve-out workflow intent (no accidental broadening)", async () => {
    const resolver = resolveAuthoritativeDeployment(throwingResolver as never, {
      isPlatformDirectIntent: robinIsPlatformDirect,
    });
    await expect(
      resolver.resolve({
        organizationId: "org_1",
        intent: "some.other.intent",
        actor: { id: "system", type: "system" },
        parameters: {},
      } as never),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/api test platform-deployment-resolver`
Expected: FAIL (`isPlatformDirectIntent` option does not exist; the resolver still uses `isOperatorMutationIntent`, so it calls `resolveByOrgAndSlug` and throws on the first case).

- [ ] **Step 3: Generalize the resolver option**

In `apps/api/src/bootstrap/platform-deployment-resolver.ts`:

- Rename the interface field and its doc comment:

```ts
export interface ResolveAuthoritativeDeploymentOptions {
  /**
   * Predicate identifying non-skill, platform-initiated intents that resolve to a platform-direct
   * DeploymentContext instead of the strict skillSlug lookup. Two classes qualify:
   *  - operator_mutation intents (cron/owner; e.g. ledger/receipt/booking), which are
   *    system_auto_approved so deployment trust is never consulted; and
   *  - Robin's no-show recovery campaign (robin.recovery_campaign.send): a cron-initiated, no-agent
   *    capability that PARKS via a seeded mandatory require_approval policy. platform-direct
   *    (supervised/0) cannot relax that mandatory gate, so resolving it here is the honest result
   *    AND avoids the deployment_not_found throw that would otherwise leave the gate inert in prod
   *    (its slug "robin" has no seeded deployment). Skill intents still resolve their real
   *    deployment (and still throw if it is missing).
   */
  isPlatformDirectIntent?: (intent: string) => boolean;
}
```

- Update the call inside `resolve` (line 37):

```ts
if (options?.isPlatformDirectIntent?.(request.intent)) return platformDirect();
```

- [ ] **Step 4: Extend the app.ts predicate**

In `apps/api/src/app.ts`, add the import (with the other workflow intent imports):

```ts
import { ROBIN_RECOVERY_SEND_INTENT } from "./services/workflows/robin-recovery-request.js";
```

and change the options object passed to `resolveAuthoritativeDeployment` (~line 780):

```ts
    deploymentResolver: resolveAuthoritativeDeployment(deploymentResolver, {
      // Non-skill, platform-initiated intents resolve to platform-direct rather than a strict
      // skillSlug lookup that throws deployment_not_found for their intent prefix:
      //  - operator_mutation crons (Ledger/receipt/booking), system_auto_approved; and
      //  - Robin's no-show recovery campaign, which PARKS via a seeded mandatory require_approval
      //    policy (platform-direct supervised/0 cannot relax mandatory, so this is safe).
      isPlatformDirectIntent: (intent) =>
        intentRegistry.lookup(intent)?.defaultMode === "operator_mutation" ||
        intent === ROBIN_RECOVERY_SEND_INTENT,
    }),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/api test platform-deployment-resolver`
Expected: PASS (2 tests).
Run: `rg -n "isOperatorMutationIntent" apps packages` -> expect ZERO remaining references (the rename is complete; `test-server.ts` passes a null resolver with no options, so it is unaffected).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/bootstrap/platform-deployment-resolver.ts apps/api/src/app.ts apps/api/src/bootstrap/__tests__/platform-deployment-resolver.test.ts
git commit -m "fix(api): resolve robin recovery campaign to platform-direct so its gate is not prod-inert"
```

---

### Task 8: The real-gate PARKS test (the pinned end-to-end proof)

**Files:**

- Create: `apps/api/src/__tests__/robin-recovery-gate.test.ts`

**Interfaces:**

- Consumes: everything above. Proves the FULL seam against a real (non-null) resolver.

**Goal of this test (the anti-inert proof the spec pins):** a `robin.recovery_campaign.send` campaign, assembled from a no-show cohort and submitted through a real `PlatformIngress` whose deployment resolver THROWS for unseeded slugs, MUST (a) NOT return `deployment_not_found` (proving the carve-out), and (b) PARK with `require_approval` (proving the seeded gate). Plus: allow-policy-alone EXECUTES (proving the approval policy is load-bearing). Do NOT use the `buildTestServer` null-resolver harness for the resolver leg (it masks A0); wire a resolver that throws for "robin".

- [ ] **Step 1: Read the closest existing harness**

Read `apps/api/src/__tests__/riley-reallocate-gate.test.ts` (gate construction, `allowPolicy()`/`approvalPolicy()`, the `{ id: "system", type: "system" }` actor, the WorkUnit shape) and `apps/api/src/__tests__/test-server.ts` / the nearest full-`PlatformIngress` submit test (e.g. `routes/__tests__/revenue-ingress.test.ts`) for how to construct a `PlatformIngress` with an in-memory policy set, the seeded system identity, an entitled entitlement resolver, a trace store, and a lifecycle service. The park-vs-execute distinction lives in the gate; the deployment_not_found-vs-resolve distinction lives in the resolver passed to ingress.

- [ ] **Step 2: Write the failing test**

Construct a `PlatformIngress` (mirror `app.ts` wiring; reuse helpers from the harnesses above) with:

- `intentRegistry` registering `robin.recovery_campaign.send` (workflow mode, not `system_auto_approved`, allowedTriggers `["schedule"]`) via the same registration shape as `contained-workflows.ts`;
- a governance gate loaded with `buildRobinRecoveryAllowPolicyInput("org_1")` + `buildRobinRecoveryApprovalPolicyInput("org_1")` (Task 6);
- `deploymentResolver: resolveAuthoritativeDeployment(throwingResolver, { isPlatformDirectIntent: (i) => i === ROBIN_RECOVERY_SEND_INTENT })` where `throwingResolver.resolveByOrgAndSlug` throws (Task 7 pattern);
- the seeded system identity, an entitled entitlement resolver, an in-memory trace store, and a lifecycle service (so `approvalRequired` is returned).

```ts
// apps/api/src/__tests__/robin-recovery-gate.test.ts
import { describe, it, expect } from "vitest";
import { buildRecoveryCampaignSubmitRequest } from "../services/workflows/robin-recovery-request.js";
import { selectRecoveryCandidates } from "@switchboard/core";
import {
  buildRobinRecoveryAllowPolicyInput,
  buildRobinRecoveryApprovalPolicyInput,
} from "@switchboard/db";
// ...plus the ingress/gate construction helpers identified in Step 1.

// Simulates findNoShowRecoveryCandidates output (Date-based rows) so the test drives the FULL seam:
// no-show rows -> selectRecoveryCandidates -> buildRecoveryCampaignSubmitRequest -> ingress.
const noShowRows = [
  {
    bookingId: "bk_1",
    contactId: "ct_1",
    service: "Botox",
    startsAt: new Date("2026-06-03T09:00:00Z"),
    attendeeName: "Jamie",
  },
];

const seamRequest = () => {
  const cohort = selectRecoveryCandidates(noShowRows, {
    existingFutureBookingContactIds: new Set(),
  });
  return buildRecoveryCampaignSubmitRequest({
    organizationId: "org_1",
    windowFrom: new Date("2026-06-01T00:00:00Z"),
    windowTo: new Date("2026-06-08T00:00:00Z"),
    candidates: cohort,
  })!;
};

describe("robin recovery campaign gate (real resolver, full seam)", () => {
  it("wires no-show rows into a campaign that PARKS for approval and never returns deployment_not_found", async () => {
    const ingress = buildIngress({
      policies: [
        buildRobinRecoveryAllowPolicyInput("org_1"),
        buildRobinRecoveryApprovalPolicyInput("org_1"),
      ],
    });
    const res = await ingress.submit(seamRequest());
    // The carve-out worked: no deployment_not_found.
    expect("error" in res && (res as { error?: { type?: string } }).error?.type).not.toBe(
      "deployment_not_found",
    );
    // The seeded gate worked: it parked.
    expect(
      "approvalRequired" in res && (res as { approvalRequired?: boolean }).approvalRequired,
    ).toBe(true);
  });

  it("EXECUTES (does not park) with allow alone, proving the approval policy is load-bearing", async () => {
    const ingress = buildIngress({ policies: [buildRobinRecoveryAllowPolicyInput("org_1")] });
    const res = await ingress.submit(seamRequest());
    expect(
      "approvalRequired" in res && (res as { approvalRequired?: boolean }).approvalRequired,
    ).toBeFalsy();
  });
});
```

Implement `buildIngress(...)` in the test file by mirroring the harness from Step 1 (do not invent new production code; this is test-only wiring). The placeholder executor from Task 5 is registered so the allow-alone case can dispatch without `WORKFLOW_NOT_REGISTERED`; assert only park-vs-execute, not the (fail-closed) dispatch outcome. The `seamRequest()` helper drives the producer->consumer wire end to end (no-show rows -> filter -> build -> submit), so this test is the integration proof of the slice's headline claim.

- [ ] **Step 3: Run test to verify it fails first for the right reason**

Temporarily build the ingress resolver WITHOUT the `isPlatformDirectIntent` option to confirm the test catches the prod failure: the first assertion should fail with a `deployment_not_found`. Then restore the option and confirm it passes. (This proves the test genuinely guards A0, not a masked null-resolver pass.)

Run: `pnpm --filter @switchboard/api test robin-recovery-gate`
Expected: with the option present, PASS (2 tests); without it, the parks test FAILs on `deployment_not_found`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/__tests__/robin-recovery-gate.test.ts
git commit -m "test(api): prove robin recovery campaign parks against a real deployment resolver"
```

---

## Final verification (run ALL from the worktree before surfacing)

- [ ] `pnpm reset` if any "missing export" false alarms from stale lower-layer artifacts, then:
- [ ] `pnpm typecheck` (FULL; a core/schemas change must typecheck api AND chat)
- [ ] `pnpm test` (all packages)
- [ ] `pnpm --filter @switchboard/db test` and `pnpm --filter @switchboard/api test` (store-tightening / spy fan-out)
- [ ] `pnpm lint` and `pnpm format:check` (CI runs prettier; local lint does not)
- [ ] `pnpm arch:check` (raw-line >600 gate, .ts only)
- [ ] `pnpm build` (catches dashboard `.js`-import omissions and tsc-over-tests TS2493)
- [ ] `CI=1 npx tsx scripts/local-verify-fast.ts` (route-allowlist / env-allowlist debt — expect NONE: the cron is deferred so no new mutating route; the intent submits via ingress, not a bypass route)
- [ ] `pnpm eval:governance` (the seeded policy is governance; confirm 26/26 or current baseline still green — this slice adds a seeded org-policy path, NOT a skill-runtime eval fixture, so no new fixture is expected; verify)
- [ ] `pnpm db:check-drift` is N/A (no schema change in this slice — the dedup model/migration is deferred)
- [ ] Em-dash grep on the full three-dot diff: `git diff origin/main...HEAD | rg -n "\b--\b|[—–]"` -> expect none in added lines
- [ ] `git diff --stat origin/main...HEAD` -> confirm only the intended files; confirm the only stop-globs touched are governance (policy seed, intent registration) + ingress (deployment resolver) as expected

## Disposition

Trips governance + ingress stop-globs -> **SURFACE merge-ready (human merge call), do NOT auto-merge** (this slice touches governance/ingress). Get an independent fresh-context review (superpowers:requesting-code-review) with a final integration pass tracing the producer->consumer seam (no_show read -> selectRecoveryCandidates -> buildRecoveryCampaignSubmitRequest -> ingress -> seeded gate -> parks); pin it with the Task 8 real-resolver test. Fix Critical/Important findings. Then open the PR against `main` and report it (GATE 2).

## Deferred follow-ups (name them in the PR body, do not build here)

1. The consent-gated WhatsApp send executor (replaces the placeholder; reuses `evaluateProactiveSendEligibility` + org-scoped `ContactConsentReader`, resolves phone from `contactId` at dispatch, fail-closed when ineligible) + the `RobinRecoverySend` dedup model + migration.
2. The Inngest recovery cron (mirror `appointment-reminder-dispatch`): per enforce-mode org, assemble the cohort (`findNoShowRecoveryCandidates` + a NEW batched `findUpcomingContactIds(orgId, contactIds[])` + `selectRecoveryCandidates`) and submit one campaign via ingress (seeded system principal), handling the `"approvalRequired" in res` park branch.
3. The `governanceConfig.recovery.mode` flag + `resolveRecoveryConfig` (default off; mirror `resolveConsentStateConfig`), shipped WITH the cron (its consumer) so it is never inert.
4. SEPARATE pre-existing prod bug (NOT Robin's job): `conversation.reminder.send` / `conversation.followup.send` / `meta.lead.greeting.send` hit the same `deployment_not_found` gap (slugs `conversation`/`meta` unseeded) -> proactive sends inert in prod. Recommend its own fix slice.
