# Riley Cockpit B.2a — Mission Popover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Riley's mission popover by adding a Riley branch to the existing `mission.ts` aggregator and adapting `RileyCockpitPage` to mirror Alex's popover wiring. Zero schema changes. Zero KPI/ROI work. Zero new mutation paths.

**Architecture:** Backend gains a `buildRileyMissionResponse` pure builder alongside the existing `buildAlexMissionResponse`; the Fastify route handler branches on `agentId` and removes the Riley 404 short-circuit. Dashboard `RileyCockpitPage` adds `useAgentMission("riley")`, local `missionOpen` state, and conditionally mounts the existing agent-agnostic `<MissionPopover>` component — with the popover's `aria-label` parameterized so it reads "Riley mission" on Riley's page. Riley targets (`avgValueCents`, `targetCpbCents`) are read from `AgentRoster.config` JSON via the same `readNumberKey` helper Alex uses for rules; the typed-column migration is deferred to B.2b alongside KPI/ROI consumers.

**Tech Stack:** Fastify (api), Next.js 14 App Router + React 18 (dashboard), Vitest + @testing-library/react, TypeScript (ESM, `.js` extensions in relative imports per `CLAUDE.md`; dashboard imports omit `.js` per `feedback_dashboard_no_js_on_any_import`). Prisma is mocked in tests per `feedback_api_test_mocked_prisma`.

**Parent docs:**
- [`docs/superpowers/plans/2026-05-15-riley-cockpit-b2a-slice-brief.md`](./2026-05-15-riley-cockpit-b2a-slice-brief.md) — scope and rationale for the B.2 split.
- [`docs/superpowers/specs/2026-05-14-riley-cockpit-wave-a-slicing-design.md`](../specs/2026-05-14-riley-cockpit-wave-a-slicing-design.md) — §Slice B.2 (authoritative spec; B.2a is the mission-only subset).
- [`docs/superpowers/specs/2026-05-13-riley-cockpit-home-design.md`](../specs/2026-05-13-riley-cockpit-home-design.md) — Riley target spec (mission row copy, `roasSource` semantics, `RILEY_ROLE`).
- [`docs/superpowers/plans/2026-05-14-alex-cockpit-a2-slice-brief.md`](./2026-05-14-alex-cockpit-a2-slice-brief.md) — A.2 brief; B.2a is the Riley side of the same contract.
- [`docs/superpowers/plans/2026-05-14-riley-cockpit-b1-implementation.md`](./2026-05-14-riley-cockpit-b1-implementation.md) — B.1 template for audit + boundary discipline.

> **The slicing spec is authoritative.** If anything in this plan expands B.2a's scope beyond the slice brief — new mutation paths, KPI/ROI work, schema migration, Day-1 narrator for Riley — the spec wins and the conflicting text in this plan is wrong. Resolve in favor of the slicing spec and flag the discrepancy.

---

## Precondition: Verify Alex A.2 and Riley B.1 are merged to `main`

Before starting Task 1, verify the worktree branched off `main` after both A.2 (PR #485, `67eb0618`) and B.1 (PR #488, `5ef3910a`) merged.

- [ ] **Step 0a: Verify A.2 artifacts exist**

Run:

```bash
ls apps/api/src/routes/agent-home/mission.ts \
   apps/api/src/routes/agent-home/__tests__/mission.test.ts \
   apps/dashboard/src/components/cockpit/mission-popover.tsx \
   apps/dashboard/src/hooks/use-agent-mission.ts \
   apps/dashboard/src/lib/cockpit/mission-types.ts \
   apps/dashboard/src/app/api/dashboard/agents/\[agentId\]/mission/route.ts
```

Expected: all 6 files exist. If any is missing, A.2 has not merged. **Stop.**

- [ ] **Step 0b: Verify B.1 artifacts exist**

Run:

```bash
ls apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx \
   apps/dashboard/src/lib/cockpit/riley/riley-config.ts \
   apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx
```

Expected: all 3 files exist. If any is missing, B.1 has not merged. **Stop.**

- [ ] **Step 0c: Verify current Riley 404 short-circuit is in place**

Run:

```bash
grep -n "Riley wiring lands in its own slice" apps/api/src/routes/agent-home/mission.ts
```

Expected: one match around line 186. If the line is missing, A.2's Riley short-circuit was removed by another PR — investigate before proceeding.

- [ ] **Step 0d: Verify baseline tests pass**

Run:

```bash
pnpm --filter @switchboard/api test -- --run mission && \
  pnpm --filter @switchboard/dashboard test -- --run cockpit
```

Expected: all green. If anything fails on baseline, fix or escalate before adding new code.

---

## File Structure

### Files created

None. B.2a modifies only files that exist on main.

### Files modified

| Path | Responsibility | Why touched |
|---|---|---|
| `apps/api/src/routes/agent-home/mission.ts` | Add `RILEY_ROLE`/`RILEY_PIPELINE`/`RILEY_COMPOSER_PLACEHOLDER` constants; add `buildRileyMissionResponse` builder; refactor route handler to branch on `agentId`; remove Riley 404 short-circuit. | Riley aggregator branch. |
| `apps/api/src/routes/agent-home/__tests__/mission.test.ts` | Add `describe("buildRileyMissionResponse", ...)` block (8 cases); add `describe("mission route — Riley", ...)` block (3 cases); invert the existing `"404 for non-Alex agents at A.2"` test to assert Riley returns 200 and Mira returns 404. | Test coverage for Riley branch. |
| `apps/dashboard/src/components/cockpit/mission-popover.tsx` | Add optional `agentLabel` prop (default `"Alex"`); use it in `aria-label`. | Pop-over previously hard-coded `"Alex mission"`; Riley needs `"Riley mission"`. |
| `apps/dashboard/src/components/cockpit/__tests__/mission-popover.test.tsx` | Add `agentLabel` test cases (default + explicit Riley). | Coverage for the new prop. |
| `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx` | Call `useAgentMission("riley")`; add `missionOpen` state; pass `missionInteractive` + `onOpenMission` to `<Identity>`; mount `<MissionPopover agentLabel="Riley">` conditionally on `mission.data`. | Riley page wires the popover. |
| `apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx` | Add a `useAgentMission` mock alongside existing hook mocks; add `describe("RileyCockpitPage — B.2a mission popover", ...)` block (3 cases: non-interactive when undefined, popover toggle, popover shows Riley rows). | Coverage for the page wiring. |

### Files explicitly NOT modified

- `apps/dashboard/src/hooks/use-agent-mission.ts` — already `agentKey`-parameterized.
- `apps/dashboard/src/lib/cockpit/mission-types.ts` — `agentKey` union already includes `"riley"`.
- `apps/dashboard/src/lib/api-client/governance.ts` — `getMission(agentKey)` already parameterized.
- `apps/dashboard/src/app/api/dashboard/agents/[agentId]/mission/route.ts` — proxy forwards any `agentKey` upstream.
- `apps/dashboard/src/components/cockpit/identity.tsx` — `onOpenMission` + `missionInteractive` props already exist (added by A.2). Riley reuses as-is.
- `apps/dashboard/src/components/cockpit/empty-state.tsx` — Riley does not render Day-1 narrator (see slice brief §What does NOT ship).
- `apps/dashboard/src/lib/cockpit/riley/**` — adapter boundary unchanged.
- `apps/dashboard/src/lib/cockpit/riley/riley-config.ts` — `RILEY_MISSION_SUBTITLE` stays as the static "Optimizing Meta Ads" label visible behind the popover.
- Any Prisma schema, migration, seed, or `@switchboard/schemas` file.

---

## Adapter boundary (unchanged from B.1)

B.2a adds **zero** new imports of `Recommendation` / `AuditEntry` / `@switchboard/db` / `@prisma` / `@switchboard/schemas/recommendations` / `@switchboard/schemas/audit` to `components/cockpit/**` or `hooks/use-riley-*`. The `useAgentMission` hook is exempt from the rule already (it returns a typed wire shape from `mission-types.ts`, not Prisma).

Pre-merge grep gate (Task 12 verifies):

```bash
rg "Recommendation|AuditEntry|@switchboard/db|@prisma" \
   apps/dashboard/src/components/cockpit \
   apps/dashboard/src/hooks
```

Expected: same set of matches as on `main` before B.2a — no new matches.

---

## Task 1: Add Riley constants to `mission.ts`

**Files:**
- Modify: `apps/api/src/routes/agent-home/mission.ts` (add three new constants near the existing `ALEX_*` constants around line 64)

- [ ] **Step 1: Add Riley constants**

Open `apps/api/src/routes/agent-home/mission.ts`. After the existing block:

```ts
const ALEX_ROLE = "SDR · qualify inbound leads, book tours";
const ALEX_PIPELINE = "Tours pipeline · single funnel";
const ALEX_COMPOSER_PLACEHOLDER = "Tell Alex what to do — coming soon";
```

Add:

```ts
const RILEY_ROLE = "Ad optimizer · score, recommend, never act without your approval";
const RILEY_PIPELINE = "Ad sets · all campaigns";
const RILEY_COMPOSER_PLACEHOLDER = "Tell Riley what to do — coming soon";
const CRM_PROVIDER_SERVICE_ID = "crm-data-provider";
```

- [ ] **Step 2: Verify file compiles**

Run:

```bash
pnpm --filter @switchboard/api typecheck
```

Expected: PASS. Constants are unreferenced but valid TypeScript.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/agent-home/mission.ts
git commit -m "feat(riley-cockpit): add Riley aggregator constants (B.2a)

Adds RILEY_ROLE, RILEY_PIPELINE, RILEY_COMPOSER_PLACEHOLDER, and
CRM_PROVIDER_SERVICE_ID to mission.ts. Copy sourced from the Riley
target spec (target spec line 110 and §575 - mission row sample).
Used in Task 2 by buildRileyMissionResponse."
```

---

## Task 2: Write failing test for `buildRileyMissionResponse` (cold state)

**Files:**
- Modify: `apps/api/src/routes/agent-home/__tests__/mission.test.ts` (append new `describe` block after the `buildAlexMissionResponse` block ending around line 142)

- [ ] **Step 1: Add the failing test**

Append to `apps/api/src/routes/agent-home/__tests__/mission.test.ts` immediately after the closing `});` of the `describe("buildAlexMissionResponse", ...)` block:

```ts
import { buildRileyMissionResponse } from "../mission.js";

describe("buildRileyMissionResponse", () => {
  const baseInputs = {
    roster: {
      id: "ros-riley-1",
      organizationId: "org-1",
      agentRole: "ad-optimizer",
      displayName: "Riley",
      description: "",
      status: "active",
      tier: "starter",
      config: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    org: { id: "org-1", name: "HotPod Yoga" },
    connections: [] as Array<{ serviceId: string; status: string }>,
  };

  it("returns Riley display fields when nothing is connected", () => {
    const out = buildRileyMissionResponse(baseInputs);
    expect(out.agentKey).toBe("riley");
    expect(out.displayName).toBe("Riley");
    expect(out.mission.role).toBe(
      "Ad optimizer · score, recommend, never act without your approval",
    );
    expect(out.mission.pipeline).toBe("Ad sets · all campaigns");
    expect(out.mission.brand).toBe("HotPod Yoga · —");
    expect(out.mission.channels.map((c) => c.kind)).toEqual(["meta-ads"]);
    expect(out.mission.channels[0]).toEqual({
      kind: "meta-ads",
      label: "Meta Ads",
      status: "off",
    });
    expect(out.mission.rules).toBeNull();
    expect(out.targets).toEqual({
      avgValueCents: null,
      targetCpbCents: null,
      roasSource: "deterministic",
    });
    expect(out.composerPlaceholder).toBe("Tell Riley what to do — coming soon");
    expect(out.commands).toEqual([]);
    // Riley setup array has 2 rows: meta and rules. No inbox/cal.
    expect(out.setup.map((r) => r.key)).toEqual(["meta", "rules"]);
    expect(out.setup.every((row) => row.done === false)).toBe(true);
    expect(out.setup.find((row) => row.key === "meta")?.primary).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @switchboard/api test -- --run mission
```

Expected: FAIL with `buildRileyMissionResponse is not exported from "../mission.js"` (or a TypeScript error if `tsc` runs first).

- [ ] **Step 3: Commit the failing test**

```bash
git add apps/api/src/routes/agent-home/__tests__/mission.test.ts
git commit -m "test(riley-cockpit): failing test for Riley cold-state aggregator (B.2a)"
```

---

## Task 3: Implement `buildRileyMissionResponse` (minimal — make Task 2 pass)

**Files:**
- Modify: `apps/api/src/routes/agent-home/mission.ts` (add new exported function after `buildAlexMissionResponse`, around line 158)

- [ ] **Step 1: Write the minimal implementation**

In `apps/api/src/routes/agent-home/mission.ts`, immediately after the closing `}` of `buildAlexMissionResponse`, add:

```ts
export function buildRileyMissionResponse(inputs: {
  roster: RosterInput;
  org: OrgInput;
  connections: ConnectionInput[];
}): MissionAggregatorResponse {
  const { roster, org, connections } = inputs;

  const metaConnection = connections.find((c) => c.serviceId === "meta-ads");
  const metaDone = !!metaConnection;
  const metaStatus: MissionChannelStatus = metaConnection
    ? mapConnectionStatus(metaConnection.status)
    : "off";

  const crmConnection = connections.find((c) => c.serviceId === CRM_PROVIDER_SERVICE_ID);
  const roasSource: "deterministic" | "crm" = crmConnection ? "crm" : "deterministic";

  const avgValueCents = readNumberKey(roster.config, "avgValueCents");
  const targetCpbCents = readNumberKey(roster.config, "targetCpbCents");
  const targetsDone = avgValueCents !== null && targetCpbCents !== null;

  const brandName = org.name.trim().length > 0 ? org.name : "(unnamed organization)";

  const setupRows: MissionSetupRow[] = [
    { key: "meta", done: metaDone },
    { key: "rules", done: targetsDone },
  ];
  const firstUndone = setupRows.find((row) => !row.done);
  if (firstUndone) firstUndone.primary = true;

  return {
    agentKey: "riley",
    displayName: roster.displayName,
    mission: {
      role: RILEY_ROLE,
      pipeline: RILEY_PIPELINE,
      brand: `${brandName} · —`,
      channels: [{ kind: "meta-ads", label: "Meta Ads", status: metaStatus }],
      rules: null,
    },
    composerPlaceholder: RILEY_COMPOSER_PLACEHOLDER,
    commands: [],
    targets: { avgValueCents, targetCpbCents, roasSource },
    setup: setupRows,
  };
}
```

- [ ] **Step 2: Run the cold-state test**

Run:

```bash
pnpm --filter @switchboard/api test -- --run mission
```

Expected: the new cold-state test passes. All existing Alex tests still green.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/agent-home/mission.ts
git commit -m "feat(riley-cockpit): buildRileyMissionResponse cold-state branch (B.2a)

Mirrors buildAlexMissionResponse. Reads Meta Ads + crm-data-provider
Connection rows; reads avgValueCents/targetCpbCents from
AgentRoster.config JSON (typed column migration deferred to B.2b).
Setup array carries meta + rules rows only (Riley has no inbox/cal).
mission.rules is always null for Riley."
```

---

## Task 4: Add Riley aggregator tests — connection statuses

**Files:**
- Modify: `apps/api/src/routes/agent-home/__tests__/mission.test.ts` (append to the `buildRileyMissionResponse` describe block)

- [ ] **Step 1: Write the tests**

Inside the `describe("buildRileyMissionResponse", ...)` block, add:

```ts
  it("marks meta done when a Meta Ads Connection exists; status='ok' when connected", () => {
    const out = buildRileyMissionResponse({
      ...baseInputs,
      connections: [{ serviceId: "meta-ads", status: "connected" }],
    });
    expect(out.mission.channels[0]?.status).toBe("ok");
    expect(out.setup.find((row) => row.key === "meta")?.done).toBe(true);
    // primary shifts to rules (next un-done row)
    expect(out.setup.find((row) => row.key === "rules")?.primary).toBe(true);
  });

  it("marks Meta Ads status='warn' when Connection is degraded", () => {
    const out = buildRileyMissionResponse({
      ...baseInputs,
      connections: [{ serviceId: "meta-ads", status: "degraded" }],
    });
    expect(out.mission.channels[0]?.status).toBe("warn");
  });

  it("sets roasSource='crm' when a crm-data-provider Connection exists", () => {
    const out = buildRileyMissionResponse({
      ...baseInputs,
      connections: [
        { serviceId: "meta-ads", status: "connected" },
        { serviceId: "crm-data-provider", status: "connected" },
      ],
    });
    expect(out.targets.roasSource).toBe("crm");
  });

  it("keeps roasSource='deterministic' when no crm-data-provider Connection exists", () => {
    const out = buildRileyMissionResponse({
      ...baseInputs,
      connections: [{ serviceId: "meta-ads", status: "connected" }],
    });
    expect(out.targets.roasSource).toBe("deterministic");
  });
```

- [ ] **Step 2: Run tests**

Run:

```bash
pnpm --filter @switchboard/api test -- --run mission
```

Expected: all 5 Riley aggregator tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/agent-home/__tests__/mission.test.ts
git commit -m "test(riley-cockpit): Riley aggregator status/source coverage (B.2a)"
```

---

## Task 5: Add Riley aggregator tests — targets + brand fallback

**Files:**
- Modify: `apps/api/src/routes/agent-home/__tests__/mission.test.ts`

- [ ] **Step 1: Write the tests**

Inside the `describe("buildRileyMissionResponse", ...)` block, add:

```ts
  it("reads avgValueCents/targetCpbCents from roster.config", () => {
    const out = buildRileyMissionResponse({
      ...baseInputs,
      roster: {
        ...baseInputs.roster,
        config: { avgValueCents: 12000, targetCpbCents: 2500 },
      },
    });
    expect(out.targets.avgValueCents).toBe(12000);
    expect(out.targets.targetCpbCents).toBe(2500);
    expect(out.setup.find((row) => row.key === "rules")?.done).toBe(true);
  });

  it("returns null targets and rules-row undone when only one threshold is present", () => {
    const out = buildRileyMissionResponse({
      ...baseInputs,
      roster: {
        ...baseInputs.roster,
        config: { avgValueCents: 12000 },
      },
    });
    expect(out.targets.avgValueCents).toBe(12000);
    expect(out.targets.targetCpbCents).toBeNull();
    expect(out.setup.find((row) => row.key === "rules")?.done).toBe(false);
  });

  it("returns null targets when config is a non-object primitive", () => {
    const out = buildRileyMissionResponse({
      ...baseInputs,
      roster: { ...baseInputs.roster, config: "invalid" as unknown },
    });
    expect(out.targets.avgValueCents).toBeNull();
    expect(out.targets.targetCpbCents).toBeNull();
  });

  it("falls back to '(unnamed organization)' when org.name missing", () => {
    const out = buildRileyMissionResponse({
      ...baseInputs,
      org: { id: "org-1", name: "" },
    });
    expect(out.mission.brand).toBe("(unnamed organization) · —");
  });
```

- [ ] **Step 2: Run tests**

Run:

```bash
pnpm --filter @switchboard/api test -- --run mission
```

Expected: all Riley builder tests pass (9 total).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/agent-home/__tests__/mission.test.ts
git commit -m "test(riley-cockpit): Riley aggregator targets + brand-fallback (B.2a)"
```

---

## Task 6: Invert the route's Riley-404 test and wire Riley in the route handler

**Files:**
- Modify: `apps/api/src/routes/agent-home/__tests__/mission.test.ts` (existing route describe block)
- Modify: `apps/api/src/routes/agent-home/mission.ts` (route handler near line 178)

- [ ] **Step 1: Invert the existing route test**

In `apps/api/src/routes/agent-home/__tests__/mission.test.ts`, find the test:

```ts
  it("404 for non-Alex agents at A.2", async () => {
    const app = await buildApp(buildPrismaStub({}));
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/riley/mission",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(404);
  });
```

Replace it with two tests:

```ts
  it("200 returns Riley aggregator on /agents/riley/mission", async () => {
    const prisma = buildPrismaStub({
      roster: {
        id: "ros-riley-1",
        organizationId: "org-1",
        agentRole: "ad-optimizer",
        displayName: "Riley",
        description: "",
        status: "active",
        tier: "starter",
        config: { avgValueCents: 12000, targetCpbCents: 2500 },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      org: { id: "org-1", name: "HotPod Yoga" },
      connections: [
        { serviceId: "meta-ads", status: "connected" },
        { serviceId: "crm-data-provider", status: "connected" },
      ],
    });
    const app = await buildApp(prisma);
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/riley/mission",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      agentKey: string;
      mission: { role: string; brand: string; channels: Array<{ kind: string }> };
      targets: { roasSource: string };
    };
    expect(body.agentKey).toBe("riley");
    expect(body.mission.role).toBe(
      "Ad optimizer · score, recommend, never act without your approval",
    );
    expect(body.mission.brand).toBe("HotPod Yoga · —");
    expect(body.mission.channels.map((c) => c.kind)).toEqual(["meta-ads"]);
    expect(body.targets.roasSource).toBe("crm");
    // Riley aggregator does NOT call managedChannel.findMany.
    expect(prisma.managedChannel.findMany).not.toHaveBeenCalled();
  });

  it("404 for agents that are not Alex or Riley (e.g. Mira)", async () => {
    const app = await buildApp(buildPrismaStub({}));
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/mira/mission",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(404);
  });
```

- [ ] **Step 2: Run the new route tests (expect failures)**

Run:

```bash
pnpm --filter @switchboard/api test -- --run mission
```

Expected: the new `200 returns Riley aggregator` test FAILS with status 404 (route still has the Riley short-circuit). The Mira 404 test passes. All builder tests still pass.

- [ ] **Step 3: Update the route handler — Riley branch**

In `apps/api/src/routes/agent-home/mission.ts`, locate the route handler:

```ts
    if (!ALEX_RILEY_ONLY.includes(agentId as (typeof ALEX_RILEY_ONLY)[number])) {
      return reply.code(404).send({ error: "Agent not available on home" });
    }
    if (agentId !== "alex") {
      // Riley wiring lands in its own slice; A.2 ships Alex only.
      return reply.code(404).send({ error: "Mission aggregator not available for this agent yet" });
    }
```

Remove the second `if (agentId !== "alex")` block entirely. Then locate the `Promise.all` block:

```ts
      const [roster, org, connections, managedChannels] = await Promise.all([
        app.prisma.agentRoster.findFirst({
          where: { organizationId: orgId, agentRole: "responder" },
        }),
        app.prisma.organizationConfig.findUnique({ where: { id: orgId } }),
        app.prisma.connection.findMany({
          where: { organizationId: orgId },
          select: { serviceId: true, status: true },
        }),
        app.prisma.managedChannel.findMany({
          where: { organizationId: orgId },
          select: { channel: true, status: true },
        }),
      ]);

      if (!roster) {
        return reply.code(404).send({ error: "Alex roster not provisioned for this org" });
      }

      const response = buildAlexMissionResponse({
        roster: roster as unknown as Parameters<typeof buildAlexMissionResponse>[0]["roster"],
        org: { id: orgId, name: org?.name ?? "" },
        connections,
        managedChannels,
      });
      return reply.code(200).send(response);
```

Replace it with an `agentId`-branched version:

```ts
      const rosterRole = agentId === "alex" ? "responder" : "ad-optimizer";
      const [roster, org, connections, managedChannels] = await Promise.all([
        app.prisma.agentRoster.findFirst({
          where: { organizationId: orgId, agentRole: rosterRole },
        }),
        app.prisma.organizationConfig.findUnique({ where: { id: orgId } }),
        app.prisma.connection.findMany({
          where: { organizationId: orgId },
          select: { serviceId: true, status: true },
        }),
        agentId === "alex"
          ? app.prisma.managedChannel.findMany({
              where: { organizationId: orgId },
              select: { channel: true, status: true },
            })
          : Promise.resolve([] as Array<{ channel: string; status: string }>),
      ]);

      if (!roster) {
        const label = agentId === "alex" ? "Alex" : "Riley";
        return reply
          .code(404)
          .send({ error: `${label} roster not provisioned for this org` });
      }

      const response =
        agentId === "alex"
          ? buildAlexMissionResponse({
              roster: roster as unknown as Parameters<typeof buildAlexMissionResponse>[0]["roster"],
              org: { id: orgId, name: org?.name ?? "" },
              connections,
              managedChannels,
            })
          : buildRileyMissionResponse({
              roster: roster as unknown as Parameters<typeof buildRileyMissionResponse>[0]["roster"],
              org: { id: orgId, name: org?.name ?? "" },
              connections,
            });
      return reply.code(200).send(response);
```

Notes:
- `agentRole` for Riley is `"ad-optimizer"` — verify by reading `packages/db/prisma/seed.ts` or the `AgentRoster` seed if it exists. If the actual seed uses a different value, swap the literal and update Task 2's `baseInputs.roster.agentRole` accordingly.
- The `managedChannel.findMany` short-circuit avoids a useless DB query on Riley. The promise resolves to `[]` so the `Promise.all` tuple shape is preserved.

- [ ] **Step 4: Run the route tests**

Run:

```bash
pnpm --filter @switchboard/api test -- --run mission
```

Expected: all tests pass — Riley returns 200 with the expected body, Mira returns 404, Alex tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/agent-home/mission.ts \
        apps/api/src/routes/agent-home/__tests__/mission.test.ts
git commit -m "feat(riley-cockpit): wire Riley branch into mission route (B.2a)

Removes the agentId !== \"alex\" 404 short-circuit. Route handler now
branches on agentId: agentRole='responder' for Alex, 'ad-optimizer'
for Riley; ManagedChannel.findMany short-circuited for Riley (Riley
has no inbox surface). Riley returns 200 with the Riley-shaped
MissionAggregatorResponse. Mira still 404s (not in ALEX_RILEY_ONLY)."
```

---

## Task 7: Verify Riley `AgentRoster.agentRole` literal

**Files:**
- Read only: `packages/db/prisma/seed.ts` (or wherever Riley's AgentRoster is created)

- [ ] **Step 1: Find the canonical Riley agentRole**

Run:

```bash
grep -rn "agentRole" packages/db/prisma/ apps/api/src/ apps/dashboard/src/ \
  | grep -iE "(riley|ad-optimizer|ad_optimizer|adOptimizer)" | head -20
```

Inspect output. The canonical literal should be `"ad-optimizer"` per the kebab-case roster convention (Alex is `"responder"`). If the codebase shows a different literal (e.g., `"ad_optimizer"` or `"ad-optimization"`), update `mission.ts` Task 6 Step 3 and `mission.test.ts` Task 2 Step 1 to match.

- [ ] **Step 2: If a mismatch was found, rerun mission tests**

Run:

```bash
pnpm --filter @switchboard/api test -- --run mission
```

Expected: all green.

- [ ] **Step 3: Commit if a literal was corrected; otherwise skip**

If a change was needed:

```bash
git add apps/api/src/routes/agent-home/mission.ts \
        apps/api/src/routes/agent-home/__tests__/mission.test.ts
git commit -m "fix(riley-cockpit): align AgentRoster.agentRole literal with seed (B.2a)"
```

---

## Task 8: Parameterize `MissionPopover.aria-label`

**Files:**
- Modify: `apps/dashboard/src/components/cockpit/mission-popover.tsx`
- Modify: `apps/dashboard/src/components/cockpit/__tests__/mission-popover.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `apps/dashboard/src/components/cockpit/__tests__/mission-popover.test.tsx` (after the existing tests):

```ts
describe("MissionPopover — agentLabel prop (B.2a)", () => {
  const MISSION = {
    role: "Ad optimizer · score, recommend, never act without your approval",
    pipeline: "Ad sets · all campaigns",
    brand: "HotPod Yoga · —",
    channels: [{ kind: "meta-ads" as const, label: "Meta Ads", status: "ok" as const }],
    rules: null,
  };

  it('defaults aria-label to "Alex mission" when no agentLabel prop is passed', () => {
    render(<MissionPopover open={true} onClose={() => {}} mission={MISSION} />);
    expect(screen.getByRole("dialog", { name: /Alex mission/i })).toBeInTheDocument();
  });

  it('uses agentLabel when provided ("Riley mission")', () => {
    render(
      <MissionPopover open={true} onClose={() => {}} mission={MISSION} agentLabel="Riley" />,
    );
    expect(screen.getByRole("dialog", { name: /Riley mission/i })).toBeInTheDocument();
  });
});
```

(If the existing test file does not already import `screen` and `render` from `@testing-library/react`, add the import. Also import `MissionPopover` from `../mission-popover` as the existing tests do.)

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @switchboard/dashboard test -- --run mission-popover
```

Expected: the second test FAILS (component does not accept `agentLabel`); TypeScript error on the prop.

- [ ] **Step 3: Add the prop**

In `apps/dashboard/src/components/cockpit/mission-popover.tsx`, update the `Props` type:

```ts
type Props = {
  open: boolean;
  onClose: () => void;
  mission: MissionAggregatorResponse["mission"];
  /** B.2a: agent label used in the dialog aria-label. Defaults to "Alex". */
  agentLabel?: string;
};
```

Update the component signature:

```ts
export function MissionPopover({ open, onClose, mission, agentLabel = "Alex" }: Props) {
```

And change the aria-label:

```tsx
      aria-label={`${agentLabel} mission`}
```

(Replace the existing `aria-label="Alex mission"` literal.)

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @switchboard/dashboard test -- --run mission-popover
```

Expected: PASS. All existing Alex tests still green.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/cockpit/mission-popover.tsx \
        apps/dashboard/src/components/cockpit/__tests__/mission-popover.test.tsx
git commit -m "feat(cockpit): MissionPopover accepts optional agentLabel prop (B.2a)

Defaults to \"Alex\" so existing call sites are unchanged. Riley page
(Task 9) passes agentLabel=\"Riley\" so the dialog reads \"Riley mission\"
to screen readers."
```

---

## Task 9: Wire mission popover into `RileyCockpitPage`

**Files:**
- Modify: `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx`

- [ ] **Step 1: Update the file**

Replace the contents of `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx` with:

```tsx
// apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx
"use client";

import { useState } from "react";
import { T } from "./tokens";
import { Topbar } from "./topbar";
import { Identity } from "./identity";
import { ApprovalBlock } from "./approval-block";
import { ActivityStream, type ActivityFilter } from "./activity-stream";
import { ComposerPlaceholder } from "./composer-placeholder";
import { MissionPopover } from "./mission-popover";
import { RILEY_MISSION_SUBTITLE, RILEY_TABS } from "@/lib/cockpit/riley/riley-config";
import { useRileyApprovals } from "@/hooks/use-riley-approvals";
import { useRileyStatus } from "@/hooks/use-riley-status";
import { useRileyActivity } from "@/hooks/use-riley-activity";
import { useAgentMission } from "@/hooks/use-agent-mission";
import { useHalt } from "@/components/layout/halt/halt-context";
import type { ApprovalView } from "./types";

export function RileyCockpitPage() {
  const haltCtx = useHalt();
  const { approvals } = useRileyApprovals();
  const statusKey = useRileyStatus();
  const { rows: activityRows } = useRileyActivity();
  const mission = useAgentMission("riley");
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [missionOpen, setMissionOpen] = useState(false);

  return (
    <div
      style={{
        background: T.bg,
        color: T.ink,
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <Topbar paletteEnabled={false} compact tabs={RILEY_TABS} />
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ position: "relative" }}>
          <Identity
            statusKey={statusKey}
            halted={haltCtx.halted}
            subtitle={RILEY_MISSION_SUBTITLE}
            line={null}
            onHaltToggle={haltCtx.toggleHalt}
            missionInteractive={!!mission.data}
            onOpenMission={() => setMissionOpen((o) => !o)}
          />
          {mission.data ? (
            <MissionPopover
              open={missionOpen}
              onClose={() => setMissionOpen(false)}
              mission={mission.data.mission}
              agentLabel="Riley"
            />
          ) : null}
        </div>
        {approvals.length > 0 && (
          <ApprovalBlock
            data={approvals as ApprovalView[]}
            onResolve={(_verdict, _idx) => {
              // B.1 stops at view assembly; resolution wires up at a future slice.
            }}
          />
        )}
        <ActivityStream rows={activityRows} filter={filter} setFilter={setFilter} />
      </div>
      <ComposerPlaceholder halted={haltCtx.halted} />
    </div>
  );
}
```

What changed from B.1:
1. New imports: `MissionPopover`, `useAgentMission`.
2. New hook call: `useAgentMission("riley")`.
3. New `missionOpen` state.
4. `<Identity>` is wrapped in a `position: relative` div to anchor the popover.
5. `missionInteractive={!!mission.data}` + `onOpenMission` props passed to `<Identity>`.
6. `<MissionPopover agentLabel="Riley" ... />` conditionally mounted.
7. **No** `<EmptyState>` branch (Riley uses B.1's synthetic activity rows for cold state).
8. **No** ActivityStream gating — the activity stream always renders, regardless of `mission.data`.

- [ ] **Step 2: Typecheck**

Run:

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: PASS.

- [ ] **Step 3: Verify B.1's existing Riley tests still pass**

Run:

```bash
pnpm --filter @switchboard/dashboard test -- --run riley-cockpit-page
```

Expected: existing B.1 tests FAIL — `useAgentMission` is not mocked yet. They will be fixed in Task 10.

That failure is expected at this step. Do not commit yet — finish Task 10 first to keep the working tree green.

---

## Task 10: Update `RileyCockpitPage` tests for mission wiring

**Files:**
- Modify: `apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx`

- [ ] **Step 1: Add the `useAgentMission` mock**

In `apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx`, near the other `vi.mock` calls at the top of the file (after the `useRileyActivity` mock and before `import { RileyCockpitPage }`), add:

```ts
import type { MissionAggregatorResponse } from "@/lib/cockpit/mission-types";

let missionData: MissionAggregatorResponse | undefined = undefined;

vi.mock("@/hooks/use-agent-mission", () => ({
  useAgentMission: () => ({ data: missionData, isLoading: false, isError: false }),
}));
```

- [ ] **Step 2: Run existing tests to confirm they pass again**

Run:

```bash
pnpm --filter @switchboard/dashboard test -- --run riley-cockpit-page
```

Expected: existing B.1 tests all pass (they default to `missionData === undefined`, so the popover branch is inert).

- [ ] **Step 3: Add the B.2a popover test block**

Append to `apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx`:

```tsx
// --- B.2a: mission popover ---

import { fireEvent, waitFor } from "@testing-library/react";

const RILEY_MISSION_DATA: MissionAggregatorResponse = {
  agentKey: "riley",
  displayName: "Riley",
  mission: {
    role: "Ad optimizer · score, recommend, never act without your approval",
    pipeline: "Ad sets · all campaigns",
    brand: "HotPod Yoga · —",
    channels: [{ kind: "meta-ads", label: "Meta Ads", status: "ok" }],
    rules: null,
  },
  composerPlaceholder: "Tell Riley what to do — coming soon",
  commands: [],
  targets: { avgValueCents: 12000, targetCpbCents: 2500, roasSource: "deterministic" },
  setup: [
    { key: "meta", done: true },
    { key: "rules", done: true },
  ],
};

describe("RileyCockpitPage — B.2a mission popover", () => {
  it("keeps the subtitle non-interactive while mission data is undefined", () => {
    missionData = undefined;
    wrap(<RileyCockpitPage />);
    // The subtitle text is rendered as plain text, not a button.
    expect(screen.queryByRole("button", { name: /Optimizing Meta Ads/i })).not.toBeInTheDocument();
    expect(screen.getAllByText(/Optimizing Meta Ads/i).length).toBeGreaterThanOrEqual(1);
  });

  it("makes the subtitle clickable once mission data loads and toggles the popover", async () => {
    missionData = RILEY_MISSION_DATA;
    wrap(<RileyCockpitPage />);
    const subtitle = await screen.findByRole("button", { name: /Optimizing Meta Ads/i });
    fireEvent.click(subtitle);
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: /Riley mission/i })).toBeInTheDocument(),
    );
    // Click again — popover closes.
    fireEvent.click(subtitle);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /Riley mission/i })).not.toBeInTheDocument(),
    );
    missionData = undefined;
  });

  it("renders Riley-shaped mission rows inside the popover", async () => {
    missionData = RILEY_MISSION_DATA;
    wrap(<RileyCockpitPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Optimizing Meta Ads/i }));
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: /Riley mission/i })).toBeInTheDocument(),
    );
    // Each eyebrow appears verbatim.
    expect(screen.getByText(/Ad optimizer · score, recommend, never act without your approval/i))
      .toBeInTheDocument();
    expect(screen.getByText(/Ad sets · all campaigns/i)).toBeInTheDocument();
    expect(screen.getByText(/HotPod Yoga · —/i)).toBeInTheDocument();
    // No RULES row for Riley (mission.rules is null).
    expect(screen.queryByText(/^RULES$/)).not.toBeInTheDocument();
    missionData = undefined;
  });

  it("does NOT render the Day-1 EmptyState (Riley uses synthetic activity rows for cold state)", () => {
    missionData = {
      ...RILEY_MISSION_DATA,
      setup: [
        { key: "meta", done: false, primary: true },
        { key: "rules", done: false },
      ],
    };
    wrap(<RileyCockpitPage />);
    expect(screen.queryByTestId("cockpit-empty-state")).not.toBeInTheDocument();
    missionData = undefined;
  });
});
```

- [ ] **Step 4: Run the page tests**

Run:

```bash
pnpm --filter @switchboard/dashboard test -- --run riley-cockpit-page
```

Expected: all tests pass — B.1 cases plus the 4 new B.2a cases.

- [ ] **Step 5: Commit Task 9 + Task 10 together**

```bash
git add apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx \
        apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx
git commit -m "feat(riley-cockpit): wire mission popover on /riley (B.2a)

Adds useAgentMission(\"riley\"), missionOpen state, and conditional
<MissionPopover agentLabel=\"Riley\"> mount to RileyCockpitPage. Identity
subtitle becomes interactive only when mission data has loaded. No
EmptyState branch — Riley cold state stays served by B.1 synthetic
activity rows. Tests cover non-interactive default, popover toggle,
Riley-shaped rows, no-EmptyState invariant."
```

---

## Task 11: Adapter-boundary grep gate

**Files:**
- Read only

- [ ] **Step 1: Run the grep**

Run:

```bash
rg "Recommendation|AuditEntry|@switchboard/db|@prisma" \
   apps/dashboard/src/components/cockpit \
   apps/dashboard/src/hooks
```

Expected output: same matches as on `main` before B.2a, with **no** new matches in `components/cockpit/` or `hooks/use-riley-*`. Allowed matches:
- Type imports of `ApprovalView`/`ActivityRow`/`CockpitStatus` from `./types` (these are view-models, not substrate).
- Imports referencing recommendation/audit identifiers inside `lib/cockpit/riley/**` (out of scope for this grep).

- [ ] **Step 2: Diff the grep result against `main`**

Run:

```bash
git diff origin/main -- apps/dashboard/src/components/cockpit apps/dashboard/src/hooks \
  | grep -E '^\+import|^\+from' | grep -E "Recommendation|AuditEntry|@switchboard/db|@prisma"
```

Expected: empty output (no new offending imports added by B.2a).

- [ ] **Step 3: If anything new appeared, fix or escalate**

If new substrate imports leak into `components/cockpit/` or `hooks/use-riley-*`, B.2a has violated the adapter boundary — go back to Task 9 and fix the leaked file. The popover does not need any Prisma or Recommendation imports.

---

## Task 12: Workspace-wide checks

**Files:**
- Read only

- [ ] **Step 1: Typecheck the full monorepo**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 2: Lint**

Run:

```bash
pnpm lint
```

Expected: PASS. If a new lint error fires, fix in place — do not suppress with `eslint-disable`. The B.1 `no-restricted-imports` rule should not trigger for B.2a's diffs because none of the new code imports substrate.

- [ ] **Step 3: Run the focused test suites**

Run:

```bash
pnpm --filter @switchboard/api test -- --run mission && \
  pnpm --filter @switchboard/dashboard test -- --run "mission-popover|riley-cockpit-page"
```

Expected: all green.

- [ ] **Step 4: Run the full @switchboard/api test suite**

Run:

```bash
pnpm --filter @switchboard/api test
```

Expected: all green. If `prisma-greeting-signal-store`, `prisma-work-trace-store-integrity`, or `prisma-ledger-storage` fail with the `pg_advisory_xact_lock` void issue, those are pre-existing flakes per `feedback_db_integrity_tests_pg_advisory_lock` — they don't block B.2a, but flag them in the PR description.

- [ ] **Step 5: Run the full @switchboard/dashboard test suite**

Run:

```bash
pnpm --filter @switchboard/dashboard test
```

Expected: all green.

- [ ] **Step 6: Dashboard `next build`**

Run:

```bash
pnpm --filter @switchboard/dashboard build
```

Expected: PASS. Per `feedback_dashboard_build_not_in_ci`, the dashboard `next build` is NOT run in CI; if any `.js`-extension regression slipped past typecheck/vitest, this will catch it. **This step is required before claiming B.2a complete.**

- [ ] **Step 7: Verify branch hygiene**

Run:

```bash
git branch --show-current && git status --short && git log --oneline origin/main..HEAD
```

Expected: branch is `feat/riley-cockpit-b2a`, working tree is clean, and the commit log shows 6–8 focused commits matching the task structure above. No commits should touch files outside the scope declared in §File Structure.

---

## Self-review checklist

Run through these before opening the PR:

- [ ] **Spec coverage:** Every "What ships" item from the slice brief has a corresponding task: Riley aggregator branch (Task 3, 4, 5), Riley 404 removed (Task 6), targets from config (Task 5), `roasSource` detection (Task 4), popover wiring (Task 9), test contract (Tasks 2/4/5/6/10), `aria-label` parameterized (Task 8).
- [ ] **Non-goals respected:** No KPI strip, no ROI bar, no `/metrics` extension, no `AgentRoster` migration, no `EmptyState` for Riley, no new mutation paths, no `RecommendationPresentation` schema changes. Search the diff: `git diff origin/main -- '*KPIStrip*' '*ROIBar*' '*migration*' '*metrics*' 'packages/schemas/**'` should return nothing.
- [ ] **Adapter boundary holds:** Task 11 ran clean.
- [ ] **No `console.log`, no `any`, no unused vars without `_` prefix** — `pnpm lint` passes.
- [ ] **Type consistency:** `MissionAggregatorResponse.agentKey` is `"alex" | "riley"`; both branches honor it. `setup` array shape (2 rows for Riley, 4 for Alex) is consistent across builder + tests + page mock.
- [ ] **Test gotchas observed:** API tests use mocked Prisma per `feedback_api_test_mocked_prisma`. Dashboard imports omit `.js` per `feedback_dashboard_no_js_on_any_import`. Dashboard `next build` ran locally per `feedback_dashboard_build_not_in_ci`.
- [ ] **No `.js` extensions added** in any dashboard import added by this slice (mission-popover, riley-cockpit-page, mission-popover test, riley-cockpit-page test).
- [ ] **Branch context verified pre-commit** per CLAUDE.md §Branch & Worktree Doctrine.

---

## PR description checklist

When opening the PR to `main`:

- [ ] Title: `feat(riley-cockpit): B.2a — mission popover wiring at /riley`
- [ ] Body: links to slice brief + slicing spec + Alex A.2 PR #485 + Riley B.1 PR #488.
- [ ] Body: explicit list of the B.2b deferrals (KPI strip, ROI bar, `/metrics` extension, `AgentRoster` migration). Reference the slice brief.
- [ ] Body: flag the pre-existing `prisma-*` integrity-test flakes if they reproduced in Task 12 Step 4, with the `feedback_db_integrity_tests_pg_advisory_lock` reference.
- [ ] Body: confirm the adapter-boundary grep (Task 11) and the local `pnpm --filter @switchboard/dashboard build` (Task 12 Step 6) both passed.
- [ ] Body: note that the Riley specs (target / slicing / parity) and B.1 plan are still on `docs/riley-cockpit-home-spec` and should land on `main` either ahead of or alongside this PR for the in-plan links to resolve.

---

## What comes after B.2a

- **B.2b** — KPI strip + ROI bar + `AgentRoster.avgValueCents`/`targetCpbCents` columns migration + `/api/dashboard/agents/[agentId]/metrics` extension + `metrics-riley.ts` typed branch. Plan written when Alex A.3 lands.
- **B.3** — Riley voice + composer + command palette + accent application (per slicing spec §Slice B.3).
- **Wave B** — doctrine workstream (WorkTrace mirror, PlatformIngress route, outcome attribution, learning memory) tracked in `2026-05-14-riley-agent-infra-parity-design.md`.
