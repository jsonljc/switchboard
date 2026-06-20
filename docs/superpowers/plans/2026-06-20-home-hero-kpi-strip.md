# Home Hero KPI Strip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Home hero KPI strip that leads with this week's real attributed booking value (S$), bookings, and awaiting-approval, with honest per-tile states.

**Architecture:** A new org-level `HomeSummary` read model in core reuses `buildWeekContext` + two narrow `ConversionRecord` aggregations (db) to populate a tile-state-union schema, exposed via a thin api route the dashboard proxies; the `HomeKpiStrip` component renders from the tile `state` (not `{data,error}` guessing) and composes the live decision-feed approval count.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes outside Next), Zod (`@switchboard/schemas`), Prisma (`@switchboard/db`), Fastify (`apps/api`), Next 14 + React Query (`apps/dashboard`), vitest.

## Global Constraints

- Money is in CENTS end to end; the ONLY cents→dollars conversion is the UI `<Money value={cents / 100} />`. (verbatim from spec §6)
- Revenue inclusion rule (LOCKED, Decision 1A + 2A + booked-only): `organizationId == orgId`, `type == "booked"`, `origin == "live"`, `value != null && value >= 0`, `occurredAt ∈ [from, to)` half-open. NO `sourceCampaignId` filter (all booked value, not ad-only). (spec §3.1)
- Single timestamp anchor: `ConversionRecord.occurredAt` (producer-set event time), half-open interval. (spec §3.3)
- Org timezone from `getOrgTimezone(prisma, orgId)` (fallback `Asia/Singapore`); week boundary via `buildWeekContext(now, timezone)`. (spec §3.3)
- Currency is the literal `"SGD"` (no org currency field exists). (spec §4.4)
- v1 ships DELTAS, defers BOTH sparklines (under Decision 2A neither is free); documented follow-up. (plan refinement of spec §4.6)
- Layers: schemas → core → db → api → dashboard; no UI types in core/db; no cycles. (spec §9)
- No em-dashes anywhere; lowercase Conventional Commit subjects; dashboard coverage floor 40/35/40/40; co-located `*.test.ts(x)`.

**Locked §10 decisions** (flip with a localized swap if the user changes them): 1A (all booked value), 2A (bookings = same booked ConversionRecords), booked-stage-only, sparklines-deferred. If 1B (ad-attributed): add `OR: [{ sourceCampaignId: { not: null } }, { sourceChannel: { not: null } }]` to BOTH db where-clauses in Task 2 and relabel the tile. If 2B (Booking-model count): replace `countBookedConversionsForWindow` usage with the existing `countBookingsCreated` and accept the timestamp note.

---

## File structure

- `packages/schemas/src/home-summary.ts` (CREATE) — `HomeSummary` + `homeSummaryMetric` tile-state union + Zod. One responsibility: the wire contract.
- `packages/schemas/src/index.ts` (MODIFY) — barrel-export the new module.
- `packages/schemas/src/__tests__/home-summary.test.ts` (CREATE) — parse + cents-guard.
- `packages/db/src/stores/prisma-conversion-record-store.ts` (MODIFY) — add two narrow aggregations.
- `packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts` (MODIFY) — org-isolation, stage/origin filter, null-value, window tests.
- `packages/core/src/agent-home/home-summary.ts` (CREATE) — `HomeSummarySignals` interface + `buildHomeSummary` read model (owns all semantics).
- `packages/core/src/agent-home/__tests__/home-summary.test.ts` (CREATE) — builder: value/count/comparator/empty/unavailable.
- `apps/api/src/routes/agent-home/home-summary.ts` (CREATE) — `GET /home/summary` Fastify plugin.
- `apps/api/src/routes/agent-home/index.ts` (MODIFY) — register the plugin (mirror metrics route registration).
- `apps/dashboard/src/app/api/dashboard/home/summary/route.ts` (CREATE) — Next proxy.
- `apps/dashboard/src/lib/get-api-client.ts` (MODIFY) — add `getHomeSummary()` client method.
- `apps/dashboard/src/hooks/use-home-summary.ts` (CREATE) — React-Query hook.
- `apps/dashboard/src/components/home/home-kpi-strip.tsx` (CREATE) + `home-kpi-strip.module.css` (CREATE) — the strip.
- `apps/dashboard/src/components/home/__tests__/home-kpi-strip.test.tsx` (CREATE) — render + state tests.
- `apps/dashboard/src/components/home/home-page.tsx` (MODIFY) — mount strip as hero, remove `WorkInProgress`.

Tasks map to the spec's 5 PR-slices: Task 1 = slice 1; Tasks 2+3 = slice 2 (backend producer); Task 4 = slice 3; Task 5 = slice 4; Task 6 = slice 5.

---

### Task 1: HomeSummary schema + semantic lock

**Files:**
- Create: `packages/schemas/src/home-summary.ts`
- Modify: `packages/schemas/src/index.ts`
- Test: `packages/schemas/src/__tests__/home-summary.test.ts`

**Interfaces:**
- Produces: `HomeSummarySchema`, `type HomeSummary`, `type HomeSummaryMetric<T>` (the discriminated union `ready | empty | unavailable`). Money/count values are `z.number().int()`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/schemas/src/__tests__/home-summary.test.ts
import { describe, expect, it } from "vitest";
import { HomeSummarySchema } from "../home-summary.js";

const ready = {
  attributedValueCents: {
    state: "ready",
    value: 480000,
    comparator: { window: "week", value: 300000 },
    freshness: { generatedAt: "2026-06-20T00:00:00.000Z", window: "week", dataSource: "live" },
  },
  bookings: {
    state: "ready",
    value: 5,
    comparator: { window: "week", value: 3 },
    freshness: { generatedAt: "2026-06-20T00:00:00.000Z", window: "week", dataSource: "live" },
  },
  currency: "SGD",
  generatedAt: "2026-06-20T00:00:00.000Z",
} as const;

describe("HomeSummarySchema", () => {
  it("parses a ready payload with cents money + comparator", () => {
    const parsed = HomeSummarySchema.safeParse(ready);
    expect(parsed.success).toBe(true);
  });

  it("parses empty + unavailable tile states", () => {
    expect(
      HomeSummarySchema.safeParse({
        ...ready,
        attributedValueCents: { state: "empty", reason: "no_current_week_bookings" },
        bookings: { state: "unavailable", reason: "store_unreachable" },
      }).success,
    ).toBe(true);
  });

  it("rejects a fractional (dollar-valued) cents field (cents-guard)", () => {
    expect(
      HomeSummarySchema.safeParse({
        ...ready,
        attributedValueCents: { ...ready.attributedValueCents, value: 4800.5 },
      }).success,
    ).toBe(false);
  });

  it("rejects a non-SGD currency", () => {
    expect(HomeSummarySchema.safeParse({ ...ready, currency: "USD" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/schemas test home-summary`
Expected: FAIL — cannot import `../home-summary.js` (module not found).

- [ ] **Step 3: Write the schema**

```typescript
// packages/schemas/src/home-summary.ts
import { z } from "zod";

export const HomeFreshnessSchema = z.object({
  generatedAt: z.string().datetime(),
  window: z.literal("week"),
  dataSource: z.enum(["live", "fixture"]),
});
export type HomeFreshness = z.infer<typeof HomeFreshnessSchema>;

// A tile carries its own state so the UI renders from the contract, never from
// ad-hoc {data,error} interpretation. `value` (and the comparator value) are the
// caller's unit: cents for money, a count for bookings. v1 has no sparkline.
function homeSummaryMetric<T extends z.ZodTypeAny>(value: T) {
  return z.discriminatedUnion("state", [
    z.object({
      state: z.literal("ready"),
      value,
      comparator: z.object({ window: z.literal("week"), value }).optional(),
      freshness: HomeFreshnessSchema,
    }),
    z.object({
      state: z.literal("empty"),
      reason: z.enum(["no_current_week_bookings", "no_prior_week_baseline"]),
    }),
    z.object({ state: z.literal("unavailable"), reason: z.string() }),
  ]);
}

const CentsMetricSchema = homeSummaryMetric(z.number().int());
const CountMetricSchema = homeSummaryMetric(z.number().int().min(0));

export const HomeSummarySchema = z.object({
  // CENTS. The dashboard performs the single /100 conversion at render.
  attributedValueCents: CentsMetricSchema,
  bookings: CountMetricSchema,
  currency: z.literal("SGD"),
  generatedAt: z.string().datetime(),
});

export type HomeSummary = z.infer<typeof HomeSummarySchema>;
export type HomeSummaryCentsMetric = z.infer<typeof CentsMetricSchema>;
export type HomeSummaryCountMetric = z.infer<typeof CountMetricSchema>;
```

- [ ] **Step 4: Barrel-export it**

Add to `packages/schemas/src/index.ts` (follow the existing `export * from "./<name>.js";` ordering):

```typescript
export * from "./home-summary.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/schemas test home-summary`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/home-summary.ts packages/schemas/src/index.ts packages/schemas/src/__tests__/home-summary.test.ts
git commit -m "feat(schemas): home summary tile-state contract for the home kpi strip"
```

---

### Task 2: ConversionRecord aggregations (db)

**Files:**
- Modify: `packages/db/src/stores/prisma-conversion-record-store.ts` (add two methods to `PrismaConversionRecordStore`)
- Test: `packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts`

**Interfaces:**
- Produces (on `PrismaConversionRecordStore`):
  - `sumAttributedBookedValueCentsForWindow(input: { orgId: string; from: Date; to: Date }): Promise<number>` — cents sum of booked+live rows in `[from, to)`; `0` when none.
  - `countBookedConversionsForWindow(input: { orgId: string; from: Date; to: Date }): Promise<number>` — count of the SAME rows.

- [ ] **Step 1: Write the failing tests** (append to the existing describe block, reusing its `makePrisma()` / `beforeEach` from the file header shown in patterns)

```typescript
// packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts (append)
describe("home-summary aggregations", () => {
  const from = new Date("2026-06-15T00:00:00.000Z");
  const to = new Date("2026-06-22T00:00:00.000Z"); // half-open upper bound

  it("sumAttributedBookedValueCentsForWindow sums booked+live value in cents, org-scoped, half-open", async () => {
    const aggMock = prisma.conversionRecord.aggregate as ReturnType<typeof vi.fn>;
    aggMock.mockResolvedValue({ _sum: { value: 480000 } });

    const result = await store.sumAttributedBookedValueCentsForWindow({ orgId: "org_1", from, to });

    expect(result).toBe(480000);
    expect(aggMock).toHaveBeenCalledWith({
      where: {
        organizationId: "org_1",
        type: "booked",
        origin: "live",
        value: { gte: 0 },
        occurredAt: { gte: from, lt: to },
      },
      _sum: { value: true },
    });
  });

  it("returns 0 when the window has no booked rows (null _sum)", async () => {
    (prisma.conversionRecord.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
      _sum: { value: null },
    });
    expect(
      await store.sumAttributedBookedValueCentsForWindow({ orgId: "org_1", from, to }),
    ).toBe(0);
  });

  it("countBookedConversionsForWindow counts the same booked+live rows, org-scoped, half-open", async () => {
    const countMock = prisma.conversionRecord.count as ReturnType<typeof vi.fn>;
    countMock.mockResolvedValue(5);

    const result = await store.countBookedConversionsForWindow({ orgId: "org_1", from, to });

    expect(result).toBe(5);
    expect(countMock).toHaveBeenCalledWith({
      where: {
        organizationId: "org_1",
        type: "booked",
        origin: "live",
        occurredAt: { gte: from, lt: to },
      },
    });
  });
});
```

Note: org isolation, stage (`type:"booked"`), origin (`live`), non-negative value, and the half-open `lt` window are all asserted via `toHaveBeenCalledWith` — a leaked org / wrong stage / closed interval fails the assertion.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/db test prisma-conversion-record-store`
Expected: FAIL — `store.sumAttributedBookedValueCentsForWindow is not a function`.

- [ ] **Step 3: Implement the two methods** (add inside the `PrismaConversionRecordStore` class, next to `countAdAttributedBookings`)

```typescript
  /**
   * Cents sum of attributed booking value in the half-open window [from, to).
   * Booked-stage, live-origin, non-negative value, org-scoped. Returns 0 when
   * the window is empty (Prisma yields _sum.value === null). Anchored on
   * occurredAt (the producer-set event time). Money stays in cents.
   */
  async sumAttributedBookedValueCentsForWindow(input: {
    orgId: string;
    from: Date;
    to: Date;
  }): Promise<number> {
    const agg = await this.prisma.conversionRecord.aggregate({
      where: {
        organizationId: input.orgId,
        type: "booked",
        origin: "live",
        value: { gte: 0 },
        occurredAt: { gte: input.from, lt: input.to },
      },
      _sum: { value: true },
    });
    return agg._sum.value ?? 0;
  }

  /** Count of the SAME booked+live rows the value sum covers (aligned anchor). */
  async countBookedConversionsForWindow(input: {
    orgId: string;
    from: Date;
    to: Date;
  }): Promise<number> {
    return this.prisma.conversionRecord.count({
      where: {
        organizationId: input.orgId,
        type: "booked",
        origin: "live",
        occurredAt: { gte: input.from, lt: input.to },
      },
    });
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/db test prisma-conversion-record-store`
Expected: PASS (3 new tests + existing green).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/prisma-conversion-record-store.ts packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts
git commit -m "feat(db): booked-conversion value sum + count aggregations for the home summary"
```

---

### Task 3: HomeSummary read model (core)

**Files:**
- Create: `packages/core/src/agent-home/home-summary.ts`
- Test: `packages/core/src/agent-home/__tests__/home-summary.test.ts`

**Interfaces:**
- Consumes: `HomeSummary` type (schemas), `buildWeekContext(now, timezone)` (core `./metrics-buckets.js`).
- Produces:
  - `interface HomeSummarySignals { sumAttributedBookedValueCentsForWindow(i): Promise<number>; countBookedConversionsForWindow(i): Promise<number>; }` (i = `{ orgId; from: Date; to: Date }`). `PrismaConversionRecordStore` satisfies it structurally.
  - `buildHomeSummary(input: { orgId: string; now: Date; timezone: string; signals: HomeSummarySignals }): Promise<HomeSummary>` — owns every semantic decision (status filter lives in the signals impl; the builder owns windowing + comparator + state).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/agent-home/__tests__/home-summary.test.ts
import { describe, expect, it } from "vitest";
import { buildHomeSummary, type HomeSummarySignals } from "../home-summary.js";

function signals(over: Partial<Record<"valueThis" | "valuePrev" | "countThis" | "countPrev", number>>): HomeSummarySignals {
  const v = { valueThis: 480000, valuePrev: 300000, countThis: 5, countPrev: 3, ...over };
  return {
    sumAttributedBookedValueCentsForWindow: ({ from }) =>
      Promise.resolve(from.getTime() >= new Date("2026-06-15").getTime() ? v.valueThis : v.valuePrev),
    countBookedConversionsForWindow: ({ from }) =>
      Promise.resolve(from.getTime() >= new Date("2026-06-15").getTime() ? v.countThis : v.countPrev),
  };
}

const NOW = new Date("2026-06-18T08:00:00.000Z"); // a Thursday
const TZ = "Asia/Singapore";

describe("buildHomeSummary", () => {
  it("returns ready cents value + count with prior-week comparators", async () => {
    const s = await buildHomeSummary({ orgId: "org_1", now: NOW, timezone: TZ, signals: signals({}) });
    expect(s.currency).toBe("SGD");
    expect(s.attributedValueCents.state).toBe("ready");
    if (s.attributedValueCents.state === "ready") {
      expect(s.attributedValueCents.value).toBe(480000);
      expect(s.attributedValueCents.comparator?.value).toBe(300000);
    }
    expect(s.bookings.state).toBe("ready");
    if (s.bookings.state === "ready") expect(s.bookings.value).toBe(5);
  });

  it("reports empty (no_current_week_bookings) when this week is zero", async () => {
    const s = await buildHomeSummary({
      orgId: "org_1", now: NOW, timezone: TZ,
      signals: signals({ valueThis: 0, countThis: 0 }),
    });
    expect(s.attributedValueCents.state).toBe("empty");
    expect(s.bookings.state).toBe("empty");
    if (s.bookings.state === "empty") expect(s.bookings.reason).toBe("no_current_week_bookings");
  });

  it("omits the comparator (no +inf) when there is no prior-week baseline", async () => {
    const s = await buildHomeSummary({
      orgId: "org_1", now: NOW, timezone: TZ,
      signals: signals({ valuePrev: 0, countPrev: 0 }),
    });
    if (s.attributedValueCents.state === "ready") expect(s.attributedValueCents.comparator).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test home-summary`
Expected: FAIL — cannot import `../home-summary.js`.

- [ ] **Step 3: Implement the builder**

```typescript
// packages/core/src/agent-home/home-summary.ts
import type { HomeSummary } from "@switchboard/schemas";
import { buildWeekContext } from "./metrics-buckets.js";

export interface HomeSummarySignals {
  sumAttributedBookedValueCentsForWindow(input: {
    orgId: string;
    from: Date;
    to: Date;
  }): Promise<number>;
  countBookedConversionsForWindow(input: { orgId: string; from: Date; to: Date }): Promise<number>;
}

export interface BuildHomeSummaryInput {
  orgId: string;
  now: Date;
  timezone: string;
  signals: HomeSummarySignals;
}

export async function buildHomeSummary(input: BuildHomeSummaryInput): Promise<HomeSummary> {
  const { orgId, now, timezone, signals } = input;
  const week = buildWeekContext(now, timezone);
  const generatedAt = now.toISOString();
  const freshness = { generatedAt, window: "week" as const, dataSource: "live" as const };

  const [valueThis, valuePrev, countThis, countPrev] = await Promise.all([
    signals.sumAttributedBookedValueCentsForWindow({ orgId, from: week.weekStart, to: week.weekEnd }),
    signals.sumAttributedBookedValueCentsForWindow({ orgId, from: week.prevWeekStart, to: week.prevWeekEnd }),
    signals.countBookedConversionsForWindow({ orgId, from: week.weekStart, to: week.weekEnd }),
    signals.countBookedConversionsForWindow({ orgId, from: week.prevWeekStart, to: week.prevWeekEnd }),
  ]);

  return {
    attributedValueCents:
      valueThis > 0
        ? {
            state: "ready",
            value: valueThis,
            ...(valuePrev > 0 ? { comparator: { window: "week" as const, value: valuePrev } } : {}),
            freshness,
          }
        : { state: "empty", reason: "no_current_week_bookings" },
    bookings:
      countThis > 0
        ? {
            state: "ready",
            value: countThis,
            ...(countPrev > 0 ? { comparator: { window: "week" as const, value: countPrev } } : {}),
            freshness,
          }
        : { state: "empty", reason: "no_current_week_bookings" },
    currency: "SGD",
    generatedAt,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test home-summary`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agent-home/home-summary.ts packages/core/src/agent-home/__tests__/home-summary.test.ts
git commit -m "feat(core): home summary read model (org weekly booked value + count)"
```

---

### Task 4: API route + dashboard proxy + hook

**Files:**
- Create: `apps/api/src/routes/agent-home/home-summary.ts`
- Modify: `apps/api/src/routes/agent-home/index.ts` (register; mirror how `metricsRoute` is registered)
- Create: `apps/dashboard/src/app/api/dashboard/home/summary/route.ts`
- Modify: `apps/dashboard/src/lib/get-api-client.ts` (add `getHomeSummary()`)
- Create: `apps/dashboard/src/hooks/use-home-summary.ts`
- Test: `apps/api/src/routes/agent-home/__tests__/home-summary.test.ts`

**Interfaces:**
- Consumes: `buildHomeSummary` + `HomeSummarySignals` (core), `PrismaConversionRecordStore` (db), `getOrgTimezone` (api), `requireOrganizationScope` (api), `HomeSummarySchema` (schemas).
- Produces: api `GET /home/summary` → `{ summary: HomeSummary }`; dashboard `GET /api/dashboard/home/summary` → `HomeSummary`; client `getHomeSummary(): Promise<HomeSummary>`; `useHomeSummary(): { data?: HomeSummary; isLoading; isError; error }`.

- [ ] **Step 1: Write the failing api route test** (mirror an existing `apps/api/src/routes/agent-home/__tests__/*.test.ts` harness)

```typescript
// apps/api/src/routes/agent-home/__tests__/home-summary.test.ts
import { describe, expect, it } from "vitest";
import { buildTestApp } from "../../../test-helpers/build-test-app.js"; // use the harness the metrics route test uses

describe("GET /home/summary", () => {
  it("returns a schema-valid summary scoped to the session org", async () => {
    const app = await buildTestApp(); // seeds org + a booked conversion this week
    const res = await app.inject({ method: "GET", url: "/home/summary", headers: { "x-org-id": "org_1" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summary.currency).toBe("SGD");
    expect(["ready", "empty"]).toContain(body.summary.attributedValueCents.state);
  });
});
```

(If the agent-home tests use a different injection/auth harness, match it exactly — read a sibling test in that folder before writing.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @switchboard/api test home-summary`
Expected: FAIL — 404 (route not registered).

- [ ] **Step 3: Implement the api route** (mirror `apps/api/src/routes/agent-home/metrics.ts` auth + store instantiation)

```typescript
// apps/api/src/routes/agent-home/home-summary.ts
import type { FastifyPluginAsync } from "fastify";
import { PrismaConversionRecordStore } from "@switchboard/db";
import { buildHomeSummary, type HomeSummarySignals } from "@switchboard/core";
import { getOrgTimezone } from "../../lib/org-timezone.js";
import { requireOrganizationScope } from "../../lib/org-scope.js"; // same helper metrics.ts uses

export const homeSummaryRoute: FastifyPluginAsync = async (app) => {
  app.get("/home/summary", async (request, reply) => {
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const prisma = app.prisma;
    if (!prisma) return reply.code(200).send({ summary: unavailableSummary(new Date()) });

    const timezone = await getOrgTimezone(prisma, orgId);
    const conversions = new PrismaConversionRecordStore(prisma);
    const signals: HomeSummarySignals = {
      sumAttributedBookedValueCentsForWindow: (i) =>
        conversions.sumAttributedBookedValueCentsForWindow(i),
      countBookedConversionsForWindow: (i) => conversions.countBookedConversionsForWindow(i),
    };

    try {
      const summary = await buildHomeSummary({ orgId, now: new Date(), timezone, signals });
      return reply.code(200).send({ summary });
    } catch (err) {
      app.log.error({ err }, "home summary projection failed");
      return reply.code(500).send({ error: "Home summary projection failed" });
    }
  });
};

function unavailableSummary(now: Date) {
  const generatedAt = now.toISOString();
  return {
    attributedValueCents: { state: "unavailable" as const, reason: "store_unavailable" },
    bookings: { state: "unavailable" as const, reason: "store_unavailable" },
    currency: "SGD" as const,
    generatedAt,
  };
}
```

- [ ] **Step 4: Register the route** — in `apps/api/src/routes/agent-home/index.ts`, add next to the existing `app.register(metricsRoute)` (read the file; match its registration style):

```typescript
import { homeSummaryRoute } from "./home-summary.js";
// ... inside the plugin:
await app.register(homeSummaryRoute);
```

- [ ] **Step 5: Run the api test to verify it passes**

Run: `pnpm --filter @switchboard/api test home-summary`
Expected: PASS.

- [ ] **Step 6: Add the dashboard client method** — in `apps/dashboard/src/lib/get-api-client.ts` (or the client class it returns), mirror `getReport`:

```typescript
async getHomeSummary(): Promise<HomeSummary> {
  return this.request<HomeSummary>("/home/summary", (raw) => {
    const parsed = (raw as { summary: unknown }).summary;
    return HomeSummarySchema.parse(parsed); // validate at the producer boundary
  });
}
```

(Import `HomeSummary`, `HomeSummarySchema` from `@switchboard/schemas`. Match the client's actual request helper signature — read the file.)

- [ ] **Step 7: Add the proxy route** (mirror `apps/dashboard/src/app/api/dashboard/reports/route.ts`)

```typescript
// apps/dashboard/src/app/api/dashboard/home/summary/route.ts
import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { proxyError } from "@/lib/proxy-error";

export async function GET() {
  try {
    await requireSession();
    const client = await getApiClient();
    const data = await client.getHomeSummary();
    return NextResponse.json(data);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
```

- [ ] **Step 8: Add the hook** (mirror `use-agent-metrics.ts`; validate at the client boundary)

```typescript
// apps/dashboard/src/hooks/use-home-summary.ts
"use client";
import { useQuery } from "@tanstack/react-query";
import { HomeSummarySchema, type HomeSummary } from "@switchboard/schemas";
import { useScopedQueryKeys } from "./use-query-keys";

export interface HomeSummaryQuery {
  data?: HomeSummary;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

export function useHomeSummary(): HomeSummaryQuery {
  const keys = useScopedQueryKeys();
  const query = useQuery({
    queryKey: keys?.homeSummary.feed() ?? ["__disabled_home_summary__"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/home/summary");
      if (!res.ok) throw new Error(`Home summary fetch failed (HTTP ${res.status})`);
      return HomeSummarySchema.parse(await res.json());
    },
    enabled: !!keys,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: (query.error as Error | null) ?? null,
  };
}
```

(Add a `homeSummary.feed()` entry to the scoped-query-keys factory `use-query-keys.ts`, mirroring `metrics.feed`.)

- [ ] **Step 9: Verify the seam + commit**

Run: `pnpm --filter @switchboard/api test home-summary && pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS.

```bash
git add apps/api/src/routes/agent-home/home-summary.ts apps/api/src/routes/agent-home/index.ts apps/api/src/routes/agent-home/__tests__/home-summary.test.ts apps/dashboard/src/app/api/dashboard/home/summary/route.ts apps/dashboard/src/lib/get-api-client.ts apps/dashboard/src/hooks/use-home-summary.ts apps/dashboard/src/hooks/use-query-keys.ts
git commit -m "feat(api): home summary endpoint + dashboard proxy and hook"
```

---

### Task 5: HomeKpiStrip component

**Files:**
- Create: `apps/dashboard/src/components/home/home-kpi-strip.tsx` + `home-kpi-strip.module.css`
- Test: `apps/dashboard/src/components/home/__tests__/home-kpi-strip.test.tsx`

**Interfaces:**
- Consumes: `useHomeSummary()` (Task 4), `useDecisionFeed(null)` (existing), `<Money>` (`@/lib/money`), `DeltaBadge` (`@/components/results/delta-badge`), `StatePanel`/`Skeleton` (`@/components/query-states`).
- Produces: `export function HomeKpiStrip(): JSX.Element`.

- [ ] **Step 1: Write the failing render test** (mock the two hooks)

```typescript
// apps/dashboard/src/components/home/__tests__/home-kpi-strip.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { HomeKpiStrip } from "../home-kpi-strip";

const summary = vi.fn();
const decisions = vi.fn();
vi.mock("@/hooks/use-home-summary", () => ({ useHomeSummary: () => summary() }));
vi.mock("@/hooks/use-decision-feed", () => ({ useDecisionFeed: () => decisions() }));

const freshness = { generatedAt: "2026-06-20T00:00:00.000Z", window: "week", dataSource: "live" };

describe("HomeKpiStrip", () => {
  it("renders attributed value as S$ from cents, plus bookings and awaiting-approval", () => {
    summary.mockReturnValue({
      data: {
        attributedValueCents: { state: "ready", value: 480000, comparator: { window: "week", value: 300000 }, freshness },
        bookings: { state: "ready", value: 5, comparator: { window: "week", value: 3 }, freshness },
        currency: "SGD",
        generatedAt: freshness.generatedAt,
      },
      isLoading: false, isError: false, error: null,
    });
    decisions.mockReturnValue({ data: { counts: { approval: 2 } }, isLoading: false, isError: false, error: null });

    render(<HomeKpiStrip />);
    expect(screen.getByText("S$4,800")).toBeInTheDocument(); // 480000 cents
    expect(screen.getByText("Attributed booking value")).toBeInTheDocument();
    expect(screen.getByText(/Booked this week, not yet collected/)).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // awaiting approval count
  });

  it("renders the honest empty state for the value tile (never S$0)", () => {
    summary.mockReturnValue({
      data: {
        attributedValueCents: { state: "empty", reason: "no_current_week_bookings" },
        bookings: { state: "empty", reason: "no_current_week_bookings" },
        currency: "SGD", generatedAt: freshness.generatedAt,
      },
      isLoading: false, isError: false, error: null,
    });
    decisions.mockReturnValue({ data: { counts: { approval: 0 } }, isLoading: false, isError: false, error: null });

    render(<HomeKpiStrip />);
    expect(screen.getByText(/No attributed bookings yet this week/)).toBeInTheDocument();
    expect(screen.queryByText(/S\$0/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test home-kpi-strip`
Expected: FAIL — cannot resolve `../home-kpi-strip`.

- [ ] **Step 3: Implement the component**

```tsx
// apps/dashboard/src/components/home/home-kpi-strip.tsx
"use client";
import Link from "next/link";
import type { HomeSummaryCentsMetric, HomeSummaryCountMetric } from "@switchboard/schemas";
import { useHomeSummary } from "@/hooks/use-home-summary";
import { useDecisionFeed } from "@/hooks/use-decision-feed";
import { Money } from "@/lib/money";
import { DeltaBadge } from "@/components/results/delta-badge";
import { StatePanel, Skeleton } from "@/components/query-states";
import styles from "./home-kpi-strip.module.css";

function toDelta(current: number, prev?: number) {
  if (prev === undefined) return null;
  const diff = current - prev;
  if (diff === 0) return { kind: "flat" as const, text: "0" };
  return { kind: diff > 0 ? ("up" as const) : ("down" as const), text: `${diff > 0 ? "+" : ""}${diff}` };
}

export function HomeKpiStrip() {
  const summary = useHomeSummary();
  const decisions = useDecisionFeed(null);

  if (summary.isLoading) return <Skeleton className={styles.stripSkeleton} />;
  if (summary.isError || !summary.data)
    return (
      <StatePanel
        role="alert"
        eyebrow="Couldn't load"
        title="We couldn't reach this week's numbers."
        body="This is usually momentary. Try again in a moment."
      />
    );

  const { attributedValueCents, bookings } = summary.data;
  const approval = decisions.data?.counts.approval ?? null;

  return (
    <section className={styles.strip} aria-label="This week">
      <ValueTile metric={attributedValueCents} />
      <CountTile metric={bookings} label="Bookings" />
      <ApprovalTile count={approval} />
    </section>
  );
}

function ValueTile({ metric }: { metric: HomeSummaryCentsMetric }) {
  return (
    <div className={styles.tile} data-kind="value">
      <span className={styles.eyebrow}>Attributed booking value</span>
      {metric.state === "ready" ? (
        <>
          <span className={styles.figure}>
            <Money value={metric.value / 100} />
          </span>
          <DeltaBadge delta={toDelta(metric.value / 100, metric.comparator && metric.comparator.value / 100)} />
          <span className={styles.sub}>Booked this week, not yet collected</span>
        </>
      ) : metric.state === "empty" ? (
        <span className={styles.empty}>
          No attributed bookings yet this week. When an agent creates one, its booked value will appear here.
        </span>
      ) : (
        <span className={styles.empty}>Not available right now.</span>
      )}
    </div>
  );
}

function CountTile({ metric, label }: { metric: HomeSummaryCountMetric; label: string }) {
  return (
    <div className={styles.tile} data-kind="count">
      <span className={styles.eyebrow}>{label}</span>
      {metric.state === "ready" ? (
        <>
          <span className={styles.figure}>{metric.value}</span>
          <DeltaBadge delta={toDelta(metric.value, metric.comparator?.value)} />
        </>
      ) : (
        <span className={styles.empty}>None yet this week.</span>
      )}
    </div>
  );
}

function ApprovalTile({ count }: { count: number | null }) {
  return (
    <Link href="/operator" className={styles.actionTile} data-kind="approval">
      <span className={styles.eyebrow}>Awaiting your approval</span>
      <span className={styles.figure}>{count ?? "—"}</span>
      <span className={styles.cta}>Review queue</span>
    </Link>
  );
}
```

- [ ] **Step 4: Write the module CSS** (editorial register; the approval tile is visually distinct — no figure-delta grammar, a CTA)

```css
/* apps/dashboard/src/components/home/home-kpi-strip.module.css */
.strip { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 1px; background: var(--border); border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; }
.tile, .actionTile { display: flex; flex-direction: column; gap: 6px; padding: 18px 20px; background: var(--canvas); }
.actionTile { text-decoration: none; color: inherit; transition: background 120ms; }
.actionTile:hover { background: var(--canvas-2); }
.eyebrow { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-3); }
.figure { font-family: var(--font-serif); font-size: 30px; font-weight: 600; letter-spacing: -0.02em; color: var(--ink); font-variant-numeric: tabular-nums; }
.sub, .empty { font-size: 12px; color: var(--ink-3); }
.cta { font-size: 12px; color: var(--action); font-weight: 600; }
.stripSkeleton { height: 96px; border-radius: var(--radius-sm); }
@media (max-width: 720px) { .strip { grid-template-columns: 1fr; } }
```

- [ ] **Step 5: Run the render tests to verify they pass**

Run: `pnpm --filter @switchboard/dashboard test home-kpi-strip`
Expected: PASS (2 tests). Confirm `S$4,800` (the cents→dollars pin) renders.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/home/home-kpi-strip.tsx apps/dashboard/src/components/home/home-kpi-strip.module.css apps/dashboard/src/components/home/__tests__/home-kpi-strip.test.tsx
git commit -m "feat(dashboard): home kpi strip component with honest per-tile states"
```

---

### Task 6: Mount the strip + remove WorkInProgress

**Files:**
- Modify: `apps/dashboard/src/components/home/home-page.tsx`
- Test: `apps/dashboard/src/components/home/__tests__/home-page.test.tsx` (the existing Home test; add/adjust)

**Interfaces:**
- Consumes: `HomeKpiStrip` (Task 5).

- [ ] **Step 1: Write the failing test** (the strip mounts as the hero; WorkInProgress is gone)

```typescript
// add to apps/dashboard/src/components/home/__tests__/home-page.test.tsx
it("mounts the hero KPI strip and no longer renders WorkInProgress", () => {
  // render HomePage with the standard test providers used by sibling tests
  renderHome(); // use the file's existing render helper
  expect(screen.getByLabelText("This week")).toBeInTheDocument(); // the strip section
  expect(screen.queryByText(/Work in progress/i)).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test home-page`
Expected: FAIL — strip not mounted / WorkInProgress still present.

- [ ] **Step 3: Edit `home-page.tsx`**

1. Add the import: `import { HomeKpiStrip } from "./home-kpi-strip";`
2. Remove the `WorkInProgress` import, the `workInProgressItems` computation, and the `workInProgressNode`.
3. Remove `workInProgressNode` from BOTH the `isCalm` and active `modules` arrays.
4. Mount the strip as the hero, above the bento. Replace the `return (...)` head:

```tsx
  return (
    <>
      <div className={styles.column}>
        <HomeKpiStrip />
        {heroNode}
        <div className={styles.bento}>
          <div className={styles.bentoMain}>{mainNodes}</div>
          <div className={styles.bentoRail}>{railNodes}</div>
        </div>
      </div>
      {panelAgent && <AgentPanel /* ...existing props... */ />}
    </>
  );
```

(Keep `heroNode`/`mainNodes`/`railNodes` exactly as they are; the strip is prepended. If `WorkInProgress`/`workInProgressItems` are now unused anywhere, delete the now-orphaned `work-in-progress.tsx` only if nothing else imports it — grep first.)

- [ ] **Step 4: Run the Home tests to verify they pass**

Run: `pnpm --filter @switchboard/dashboard test home-page`
Expected: PASS.

- [ ] **Step 5: Full verify + before/after screenshots**

Run: `pnpm --filter @switchboard/dashboard test && pnpm --filter @switchboard/dashboard build`
Expected: PASS / compiled. Capture before/after Home screenshots (headless-Chrome harness) for the PR.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/home/home-page.tsx apps/dashboard/src/components/home/__tests__/home-page.test.tsx
git commit -m "feat(dashboard): mount the home kpi strip as hero and drop the empty work-in-progress module"
```

---

## Self-Review

**Spec coverage:** §3.1 inclusion rule → Task 2 where-clauses + tests. §3.2 aligned bookings → Task 2 `countBookedConversionsForWindow` + Task 3 builder. §3.3 anchor/interval/timezone → Task 2 (`occurredAt`, `lt`) + Task 3 (`buildWeekContext`). §3.4 approval to-do tile → Task 5 `ApprovalTile` (no delta, CTA). §3.5 copy → Task 5 tests pin the exact strings. §4.1 tile-state union → Task 1. §4.4 SGD literal → Task 1 (`z.literal`) + Task 3. §4.5 transport + dual-boundary validation → Task 4 (client `.parse` + hook `.parse`). §4.6 sparkline-optional → deferred (Global Constraints + plan note). §5 UI/placement → Tasks 5-6. §7 tests → Tasks 1-6 (org isolation, stage/origin, null value, prior-week baseline, cents-guard, render states). §8 5-PR mapping → noted. §9 layers → file structure honors schemas→core→db→api→dashboard.

**Placeholder scan:** no "TBD"/"add error handling"/"similar to". Two steps say "mirror the sibling test/registration and read the file first" (4.1 harness, 4.4 client request helper) — these are real instructions to match an existing idiom whose exact signature the executor must read, not skipped code.

**Type consistency:** `HomeSummary`/`HomeSummaryCentsMetric`/`HomeSummaryCountMetric` (Task 1) are consumed unchanged in Tasks 3-5; `sumAttributedBookedValueCentsForWindow`/`countBookedConversionsForWindow` keep one signature across Tasks 2-4; `buildHomeSummary` input shape matches the api route call in Task 4.

Known follow-ups (documented, out of v1): both sparklines (need per-bucket aggregation under Decision 2A); a fixture/demo `dataSource:"fixture"` path; receipted/paid revenue (separate workstream).
