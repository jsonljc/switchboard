# Alex Cockpit A.2 — Mission Popover + Cold-State Narrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `GET /api/dashboard/agents/[agentId]/mission` aggregator, the dashboard proxy, the `use-agent-mission` hook, the clickable mission popover on the identity row, and the cold-state narrator + 4-row setup checklist.

**Architecture:** Fastify route at `apps/api/src/routes/agent-home/mission.ts` reads `AgentRoster` + `OrganizationConfig` + `Connection` + `ManagedChannel` rows via `app.prisma` and returns a typed view-model. The dashboard proxy at `apps/dashboard/src/app/api/dashboard/agents/[agentId]/mission/route.ts` calls the new `apiClient.getMission(agentKey)` method. React Query hook `use-agent-mission.ts` consumes it. The shell extends `<Identity>` with two optional props (`onOpenMission` + `missionInteractive`) so A.1's static call sites stay valid. `<MissionPopover>` mounts beside `<Identity>` in `cockpit-page.tsx`; `<EmptyState>` renders before the activity stream when every `setup[]` row is undone.

**Heads-up — fixture vs live in dev:** A.2's mission aggregator is not behind a `NEXT_PUBLIC_*_LIVE` flag — it hits the real Fastify endpoint via the same `getApiClient()` path as `/greeting`. If the dev API is not running, the hook surfaces a fetch error and the identity subtitle stays non-interactive (graceful degradation). No new env vars.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript (ESM, `.js` extensions in **api/core/schemas/db** relative imports only — dashboard imports omit `.js` per `feedback_dashboard_no_js_on_any_import`), Fastify + Zod for the aggregator, Vitest + `@testing-library/react`, Prisma for DB reads.

**Parent spec:** [`docs/superpowers/specs/2026-05-14-alex-cockpit-home-design.md`](../specs/2026-05-14-alex-cockpit-home-design.md) (§Implementation slices → A.2; §Backend changes §3)
**Slice brief:** [`2026-05-14-alex-cockpit-a2-slice-brief.md`](./2026-05-14-alex-cockpit-a2-slice-brief.md) (scope + what does NOT ship)

> **The slice brief is authoritative.** If anything in this implementation plan appears to expand A.2's scope beyond the brief — new files, new behaviors, new props — the brief wins and the conflicting text in this plan is wrong. Resolve in favor of the brief and flag the discrepancy.

---

## File Structure

### Created files

| Path                                                                                    | Responsibility                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/routes/agent-home/mission.ts`                                             | Fastify route: `GET /agents/:agentId/mission`. Reads `AgentRoster`, `OrganizationConfig`, `Connection`, `ManagedChannel` for the org; produces the view-model. 404 for non-Alex agents at A.2. |
| `apps/api/src/routes/agent-home/__tests__/mission.test.ts`                              | Connection-present + absent paths; channel status mapping; defensive `rules: null`; non-Alex 404; missing prisma 503.                                                                          |
| `apps/dashboard/src/app/api/dashboard/agents/[agentId]/mission/route.ts`                | Next.js dashboard proxy. Calls `apiClient.getMission(agentId)`.                                                                                                                                |
| `apps/dashboard/src/app/api/dashboard/agents/[agentId]/mission/__tests__/route.test.ts` | 401 / 200 / error paths via mocked apiClient.                                                                                                                                                  |
| `apps/dashboard/src/lib/cockpit/mission-types.ts`                                       | Wire shape TS types for the dashboard: `MissionAggregatorResponse`, `MissionChannel`, `MissionChannelKind`, `MissionChannelStatus`, `MissionRules`, `MissionTargets`, `MissionSetupRow`.       |
| `apps/dashboard/src/lib/cockpit/__tests__/mission-types.test.ts`                        | Compile-time type assertions via `expectTypeOf`.                                                                                                                                               |
| `apps/dashboard/src/hooks/use-agent-mission.ts`                                         | React Query hook. 60 s refetch + refetch on `useHalt()` halted toggle.                                                                                                                         |
| `apps/dashboard/src/hooks/__tests__/use-agent-mission.test.tsx`                         | Mounts the hook with mocked fetch; refetch on halt; error surfacing.                                                                                                                           |
| `apps/dashboard/src/components/cockpit/mission-popover.tsx`                             | Anchored popover; 5 rows (Role/Pipeline/Brand/Channels/Rules); footer "Edit configuration". Outside-click + Escape close.                                                                      |
| `apps/dashboard/src/components/cockpit/__tests__/mission-popover.test.tsx`              | All rows render; `rules == null` hides Rules row; channel-dot color per status; Escape + outside-click close; settings link.                                                                   |
| `apps/dashboard/src/components/cockpit/empty-state.tsx`                                 | Narrator card + 4-row setup checklist. Renders only when `every(setup[].done === false)`. Threshold templating from `mission.rules` or locked-design defaults (`$89` / `$200`).                |
| `apps/dashboard/src/components/cockpit/__tests__/empty-state.test.tsx`                  | Render rules + default-threshold branches; primary row pickup; onConnect deep-link href; conditional render.                                                                                   |

### Modified files

| Path                                                                    | Change                                                                                                                                                                     |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/bootstrap/routes.ts`                                      | Register `missionRoute` next to `metricsRoute` under `/api/dashboard`.                                                                                                     |
| `apps/dashboard/src/lib/api-client/governance.ts`                       | Add `getMission(agentKey)` method below `getGreeting`.                                                                                                                     |
| `apps/dashboard/src/components/cockpit/identity.tsx`                    | Add optional props `onOpenMission?: () => void` and `missionInteractive?: boolean`; subtitle becomes a `<button>` when both are set (otherwise stays plain text).          |
| `apps/dashboard/src/components/cockpit/__tests__/identity.test.tsx`     | Add cases: interactive subtitle calls `onOpenMission`; non-interactive default unchanged.                                                                                  |
| `apps/dashboard/src/components/cockpit/cockpit-page.tsx`                | Call `useAgentMission(agentKey)`; manage `missionOpen` state; mount `<MissionPopover>`; render `<EmptyState>` (replacing activity stream) when mission signals cold state. |
| `apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx` | Add: mission-loaded → subtitle clickable; EmptyState renders when all setup undone; activity stream hidden in cold state.                                                  |

### Test files

Co-located under `__tests__/` per directory. The api package's test path is `apps/api/src/routes/agent-home/__tests__/mission.test.ts`. The dashboard package's tests live under each module's `__tests__/`.

---

## Cross-task references

These are referenced by multiple tasks. Defined once here:

**Path constants:**

- Fastify route root: `apps/api/src/routes/agent-home/`
- Dashboard cockpit components: `apps/dashboard/src/components/cockpit/`
- Dashboard cockpit lib: `apps/dashboard/src/lib/cockpit/`
- Test runners:
  - Single dashboard file: `pnpm --filter @switchboard/dashboard test -- <path>`
  - Single api file: `pnpm --filter @switchboard/api test -- <path>`
  - Full dashboard: `pnpm --filter @switchboard/dashboard test`
  - Full api: `pnpm --filter @switchboard/api test`

**Wire shape (canonical — must match in `mission.ts` and `mission-types.ts`):**

```ts
type MissionChannelKind = "meta-ads" | "whatsapp" | "telegram" | "slack" | "calendar";
type MissionChannelStatus = "ok" | "warn" | "off";

type MissionChannel = {
  kind: MissionChannelKind;
  label: string;
  status: MissionChannelStatus;
};

type MissionRules = {
  priceApprovalThreshold: number;
  refundEscalationFloor: number;
} | null;

type MissionTargets = {
  avgValueCents: number | null;
  targetCpbCents: number | null;
  roasSource: "deterministic" | "crm";
};

type MissionSetupRow = {
  key: "meta" | "inbox" | "cal" | "rules";
  done: boolean;
  primary?: boolean;
};

type MissionAggregatorResponse = {
  agentKey: "alex" | "riley";
  displayName: string;
  mission: {
    role: string;
    pipeline: string;
    brand: string;
    channels: MissionChannel[];
    rules: MissionRules;
  };
  composerPlaceholder: string;
  commands: never[]; // A.5 wires this
  targets: MissionTargets;
  setup: MissionSetupRow[];
};
```

**Pre-flight (run once before Task 1):**

```bash
# Base off feat/alex-cockpit-a1 because A.1's PR (#475) is still open against docs/alex-cockpit-home-spec.
# GitHub auto-retargets the PR base as the underlying stack merges.
git fetch origin feat/alex-cockpit-a1
git worktree add -b feat/alex-cockpit-a2 \
  /Users/jasonli/switchboard/.worktrees/alex-cockpit-a2 \
  origin/feat/alex-cockpit-a1
cd /Users/jasonli/switchboard/.worktrees/alex-cockpit-a2
pnpm worktree:init
```

Expected: `.env` copied, dev ports cleared, `pnpm db:migrate` runs (or skips if Postgres unreachable — fine for this UI + Fastify branch).

---

## Commit strategy

The tasks below are TDD-granular. **Commit at 5 group boundaries** — not after every task:

| Commit                               | Covers tasks                                                                                | Subject                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1 — backend aggregator               | 1–4 (Fastify route Zod params, mission builder, route, bootstrap registration, route tests) | `feat(cockpit): mission aggregator endpoint for Alex (A.2)`                         |
| 2 — dashboard wire                   | 5–8 (mission-types, getMission client, proxy route, use-agent-mission hook)                 | `feat(cockpit): wire mission aggregator to dashboard hook (A.2)`                    |
| 3 — popover + empty-state components | 9–10 (mission-popover, empty-state)                                                         | `feat(cockpit): mission popover + Day-1 narrator/setup checklist (A.2)`             |
| 4 — page composition                 | 11–12 (Identity prop extension, cockpit-page integration)                                   | `feat(cockpit): make identity subtitle clickable, render cold-state narrator (A.2)` |
| 5 — full verification + PR           | 13 (verification, push, PR)                                                                 | (no commit — verification only)                                                     |

Within each group, **stage incrementally** (`git add ...`) but **defer `git commit` to the boundary task**. Per-task "Step 5: Commit" blocks below show what to stage; the actual `git commit` runs only at Tasks 4, 8, 10, 12.

---

## Tasks

### Task 1: Mission builder (pure function in the route module)

**Files:**

- Create: `apps/api/src/routes/agent-home/mission.ts` (initial scaffold — builder function only)
- Test: `apps/api/src/routes/agent-home/__tests__/mission.test.ts` (only the builder test at this step)

We split this into "builder function" (this task) and "route wire-up" (Task 3) so the builder can be tested without Fastify scaffolding. The builder takes the four data sources as injected reads and returns the response shape — easy to fixture.

- [ ] **Step 1: Write failing test**

```ts
// apps/api/src/routes/agent-home/__tests__/mission.test.ts
import { describe, it, expect } from "vitest";
import { buildAlexMissionResponse } from "../mission.js";

describe("buildAlexMissionResponse", () => {
  const baseInputs = {
    roster: {
      id: "ros-1",
      organizationId: "org-1",
      agentRole: "responder",
      displayName: "Alex",
      description: "",
      status: "active",
      tier: "starter",
      config: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    org: { id: "org-1", name: "HotPod Yoga" },
    connections: [] as Array<{ serviceId: string; status: string }>,
    managedChannels: [] as Array<{ channel: string; status: string }>,
  };

  it("returns Alex display fields when nothing is connected", () => {
    const out = buildAlexMissionResponse(baseInputs);
    expect(out.agentKey).toBe("alex");
    expect(out.displayName).toBe("Alex");
    expect(out.mission.role).toBe("SDR · qualify inbound leads, book tours");
    expect(out.mission.pipeline).toBe("Tours pipeline · single funnel");
    expect(out.mission.brand).toBe("HotPod Yoga · —");
    expect(out.mission.channels.map((c) => c.kind)).toEqual(["meta-ads", "whatsapp", "calendar"]);
    expect(out.mission.channels.find((c) => c.kind === "meta-ads")?.status).toBe("off");
    expect(out.mission.rules).toBeNull();
    expect(out.targets).toEqual({
      avgValueCents: null,
      targetCpbCents: null,
      roasSource: "deterministic",
    });
    expect(out.commands).toEqual([]);
    expect(out.setup.every((row) => row.done === false)).toBe(true);
    expect(out.setup.find((row) => row.key === "meta")?.primary).toBe(true);
  });

  it("marks meta done when a Meta Ads Connection exists", () => {
    const out = buildAlexMissionResponse({
      ...baseInputs,
      connections: [{ serviceId: "meta-ads", status: "connected" }],
    });
    expect(out.mission.channels.find((c) => c.kind === "meta-ads")?.status).toBe("ok");
    expect(out.setup.find((row) => row.key === "meta")?.done).toBe(true);
    // primary shifts to inbox (next un-done row)
    expect(out.setup.find((row) => row.key === "inbox")?.primary).toBe(true);
  });

  it("marks Meta Ads status='warn' when Connection is degraded", () => {
    const out = buildAlexMissionResponse({
      ...baseInputs,
      connections: [{ serviceId: "meta-ads", status: "degraded" }],
    });
    expect(out.mission.channels.find((c) => c.kind === "meta-ads")?.status).toBe("warn");
  });

  it("marks inbox done when any ManagedChannel exists; status='ok' if active", () => {
    const out = buildAlexMissionResponse({
      ...baseInputs,
      managedChannels: [{ channel: "whatsapp", status: "active" }],
    });
    expect(out.mission.channels.find((c) => c.kind === "whatsapp")?.status).toBe("ok");
    expect(out.setup.find((row) => row.key === "inbox")?.done).toBe(true);
  });

  it("marks inbox status='warn' when ManagedChannel error/provisioning", () => {
    const out = buildAlexMissionResponse({
      ...baseInputs,
      managedChannels: [{ channel: "whatsapp", status: "error" }],
    });
    expect(out.mission.channels.find((c) => c.kind === "whatsapp")?.status).toBe("warn");
  });

  it("emits rules when AgentRoster.config carries thresholds", () => {
    const out = buildAlexMissionResponse({
      ...baseInputs,
      roster: {
        ...baseInputs.roster,
        config: { priceApprovalThreshold: 120, refundEscalationFloor: 250 },
      },
    });
    expect(out.mission.rules).toEqual({
      priceApprovalThreshold: 120,
      refundEscalationFloor: 250,
    });
    expect(out.setup.find((row) => row.key === "rules")?.done).toBe(true);
  });

  it("falls back to '(unnamed organization)' when org.name missing", () => {
    const out = buildAlexMissionResponse({
      ...baseInputs,
      org: { id: "org-1", name: "" },
    });
    expect(out.mission.brand).toBe("(unnamed organization) · —");
  });

  it("composer placeholder is static A.2 copy", () => {
    const out = buildAlexMissionResponse(baseInputs);
    expect(out.composerPlaceholder).toBe("Tell Alex what to do — coming soon");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/api test -- src/routes/agent-home/__tests__/mission.test.ts
```

Expected: `Cannot find module '../mission.js'`.

- [ ] **Step 3: Implement the builder (route handler comes in Task 3)**

```ts
// apps/api/src/routes/agent-home/mission.ts
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { AgentKeySchema } from "@switchboard/schemas";
import { requireOrganizationScope } from "../../utils/require-org.js";

const ParamsSchema = z.object({ agentId: AgentKeySchema });

type RosterInput = {
  id: string;
  organizationId: string;
  agentRole: string;
  displayName: string;
  description: string;
  status: string;
  tier: string;
  config: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type OrgInput = { id: string; name: string };
type ConnectionInput = { serviceId: string; status: string };
type ManagedChannelInput = { channel: string; status: string };

export type MissionChannelKind = "meta-ads" | "whatsapp" | "telegram" | "slack" | "calendar";
export type MissionChannelStatus = "ok" | "warn" | "off";
export type MissionChannel = {
  kind: MissionChannelKind;
  label: string;
  status: MissionChannelStatus;
};

export type MissionRules = {
  priceApprovalThreshold: number;
  refundEscalationFloor: number;
} | null;

export type MissionTargets = {
  avgValueCents: number | null;
  targetCpbCents: number | null;
  roasSource: "deterministic" | "crm";
};

export type MissionSetupRow = {
  key: "meta" | "inbox" | "cal" | "rules";
  done: boolean;
  primary?: boolean;
};

export type MissionAggregatorResponse = {
  agentKey: "alex" | "riley";
  displayName: string;
  mission: {
    role: string;
    pipeline: string;
    brand: string;
    channels: MissionChannel[];
    rules: MissionRules;
  };
  composerPlaceholder: string;
  commands: never[];
  targets: MissionTargets;
  setup: MissionSetupRow[];
};

const ALEX_ROLE = "SDR · qualify inbound leads, book tours";
const ALEX_PIPELINE = "Tours pipeline · single funnel";
const ALEX_COMPOSER_PLACEHOLDER = "Tell Alex what to do — coming soon";

function mapConnectionStatus(status: string): MissionChannelStatus {
  if (status === "connected") return "ok";
  if (status === "degraded") return "warn";
  return "off";
}

function mapManagedChannelStatus(status: string): MissionChannelStatus {
  if (status === "active") return "ok";
  if (status === "error" || status === "provisioning") return "warn";
  return "off";
}

function readNumberKey(config: unknown, key: string): number | null {
  if (config === null || typeof config !== "object") return null;
  const value = (config as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function buildAlexMissionResponse(inputs: {
  roster: RosterInput;
  org: OrgInput;
  connections: ConnectionInput[];
  managedChannels: ManagedChannelInput[];
}): MissionAggregatorResponse {
  const { roster, org, connections, managedChannels } = inputs;

  const metaConnection = connections.find((c) => c.serviceId === "meta-ads");
  const metaDone = !!metaConnection;
  const metaStatus: MissionChannelStatus = metaConnection
    ? mapConnectionStatus(metaConnection.status)
    : "off";

  // Pick the first ManagedChannel (any inbox kind) as the inbox surface for Alex.
  const inboxChannel = managedChannels[0];
  const inboxDone = !!inboxChannel;
  const inboxKind: MissionChannelKind =
    inboxChannel?.channel === "telegram"
      ? "telegram"
      : inboxChannel?.channel === "slack"
        ? "slack"
        : "whatsapp";
  const inboxStatus: MissionChannelStatus = inboxChannel
    ? mapManagedChannelStatus(inboxChannel.status)
    : "off";

  // Calendar: no canonical Connection serviceId exists yet (see slice brief — risk
  // "Calendar Connection.serviceId ambiguity"). v1 surfaces the channel as "off".
  // When a calendar integration ships, this read becomes a Connection lookup.
  const calDone = false;
  const calStatus: MissionChannelStatus = "off";

  const priceApprovalThreshold = readNumberKey(roster.config, "priceApprovalThreshold");
  const refundEscalationFloor = readNumberKey(roster.config, "refundEscalationFloor");
  const rules: MissionRules =
    priceApprovalThreshold !== null && refundEscalationFloor !== null
      ? { priceApprovalThreshold, refundEscalationFloor }
      : null;
  const rulesDone = rules !== null;

  const brandName = org.name.trim().length > 0 ? org.name : "(unnamed organization)";

  const setupRows: MissionSetupRow[] = [
    { key: "meta", done: metaDone },
    { key: "inbox", done: inboxDone },
    { key: "cal", done: calDone },
    { key: "rules", done: rulesDone },
  ];
  const firstUndone = setupRows.find((row) => !row.done);
  if (firstUndone) firstUndone.primary = true;

  return {
    agentKey: "alex",
    displayName: roster.displayName,
    mission: {
      role: ALEX_ROLE,
      pipeline: ALEX_PIPELINE,
      brand: `${brandName} · —`,
      channels: [
        { kind: "meta-ads", label: "Meta Ads", status: metaStatus },
        { kind: inboxKind, label: inboxLabel(inboxKind), status: inboxStatus },
        { kind: "calendar", label: "Tour calendar", status: calStatus },
      ],
      rules,
    },
    composerPlaceholder: ALEX_COMPOSER_PLACEHOLDER,
    commands: [],
    targets: { avgValueCents: null, targetCpbCents: null, roasSource: "deterministic" },
    setup: setupRows,
  };
}

function inboxLabel(kind: MissionChannelKind): string {
  if (kind === "telegram") return "Telegram inbox";
  if (kind === "slack") return "Slack inbox";
  return "WhatsApp inbox";
}

// Route handler lands in Task 3 — Fastify scaffolding kept separate so the
// builder above can be tested without injecting the app.
export const missionRoute: FastifyPluginAsync = async (_app) => {
  // Implemented in Task 3.
};

// Suppress unused-export lint until Task 3 wires the route.
export const __INTERNAL_PARAMS_SCHEMA = ParamsSchema;
export const __INTERNAL_REQUIRE_ORG = requireOrganizationScope;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/api test -- src/routes/agent-home/__tests__/mission.test.ts
```

Expected: all 8 assertions in the suite pass.

- [ ] **Step 5: Stage (commit deferred to Task 4)**

```bash
git add apps/api/src/routes/agent-home/mission.ts \
        apps/api/src/routes/agent-home/__tests__/mission.test.ts
```

---

### Task 2: Route handler

**Files:**

- Modify: `apps/api/src/routes/agent-home/mission.ts` — replace the placeholder route plugin with the real handler.
- Modify: `apps/api/src/routes/agent-home/__tests__/mission.test.ts` — add Fastify route tests on top of the builder tests.

- [ ] **Step 1: Add failing route tests at the bottom of the existing test file**

Append to `apps/api/src/routes/agent-home/__tests__/mission.test.ts`:

```ts
import Fastify from "fastify";
import { vi } from "vitest";
import { missionRoute } from "../mission.js";

type PrismaStub = {
  agentRoster: { findFirst: ReturnType<typeof vi.fn> };
  organizationConfig: { findUnique: ReturnType<typeof vi.fn> };
  connection: { findMany: ReturnType<typeof vi.fn> };
  managedChannel: { findMany: ReturnType<typeof vi.fn> };
};

function buildPrismaStub(opts: {
  roster?: unknown;
  org?: unknown;
  connections?: unknown[];
  managedChannels?: unknown[];
}): PrismaStub {
  return {
    agentRoster: { findFirst: vi.fn().mockResolvedValue(opts.roster ?? null) },
    organizationConfig: { findUnique: vi.fn().mockResolvedValue(opts.org ?? null) },
    connection: { findMany: vi.fn().mockResolvedValue(opts.connections ?? []) },
    managedChannel: { findMany: vi.fn().mockResolvedValue(opts.managedChannels ?? []) },
  };
}

async function buildApp(prisma: PrismaStub | null) {
  const app = Fastify({ logger: false });
  app.decorate("authDisabled", true);
  app.decorate("organizationIdFromAuth", undefined as string | undefined);
  app.decorate("principalIdFromAuth", undefined as string | undefined);
  app.decorate("prisma", prisma);
  app.addHook("onRequest", async (req) => {
    (req as unknown as { organizationIdFromAuth?: string }).organizationIdFromAuth = undefined;
    (req as unknown as { principalIdFromAuth?: string }).principalIdFromAuth = undefined;
  });
  await app.register(missionRoute, { prefix: "/api/dashboard" });
  return app;
}

describe("mission route", () => {
  it("404 for non-Alex agents at A.2", async () => {
    const app = await buildApp(buildPrismaStub({}));
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/riley/mission",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("400 on unknown agentId", async () => {
    const app = await buildApp(buildPrismaStub({}));
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/zzz/mission",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("503 when prisma is unavailable", async () => {
    const app = await buildApp(null);
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/mission",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(503);
  });

  it("404 when the AgentRoster row does not exist", async () => {
    const prisma = buildPrismaStub({ roster: null, org: { id: "org-1", name: "Acme" } });
    const app = await buildApp(prisma);
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/mission",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("200 returns the aggregator shape on the happy path", async () => {
    const prisma = buildPrismaStub({
      roster: {
        id: "ros-1",
        organizationId: "org-1",
        agentRole: "responder",
        displayName: "Alex",
        description: "",
        status: "active",
        tier: "starter",
        config: { priceApprovalThreshold: 89, refundEscalationFloor: 200 },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      org: { id: "org-1", name: "HotPod Yoga" },
      connections: [{ serviceId: "meta-ads", status: "connected" }],
      managedChannels: [{ channel: "whatsapp", status: "active" }],
    });
    const app = await buildApp(prisma);
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/mission",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { mission: { brand: string; rules: unknown } };
    expect(body.mission.brand).toBe("HotPod Yoga · —");
    expect(body.mission.rules).toEqual({ priceApprovalThreshold: 89, refundEscalationFloor: 200 });
    expect(prisma.agentRoster.findFirst).toHaveBeenCalledWith({
      where: { organizationId: "org-1", agentRole: "responder" },
    });
    expect(prisma.connection.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1" },
      select: { serviceId: true, status: true },
    });
    expect(prisma.managedChannel.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1" },
      select: { channel: true, status: true },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @switchboard/api test -- src/routes/agent-home/__tests__/mission.test.ts
```

Expected: the new route-test block fails (`statusCode` mismatches; handler not implemented yet). The existing builder tests still pass.

- [ ] **Step 3: Implement the route handler — replace the bottom of `apps/api/src/routes/agent-home/mission.ts`**

Replace **the entire `missionRoute` export AND the two `__INTERNAL_*` exports** with:

```ts
const ALEX_RILEY_ONLY = ["alex", "riley"] as const;

export const missionRoute: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request) => {
    if (app.authDisabled === true) {
      const headerVal = request.headers["x-org-id"];
      if (typeof headerVal === "string" && headerVal.trim()) {
        request.organizationIdFromAuth = headerVal.trim();
      } else if (!request.organizationIdFromAuth) {
        request.organizationIdFromAuth = "default";
      }
      if (!request.principalIdFromAuth) {
        request.principalIdFromAuth = "default";
      }
    }
  });

  app.get("/agents/:agentId/mission", async (request, reply) => {
    const params = ParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid agentId" });

    const { agentId } = params.data;
    if (!ALEX_RILEY_ONLY.includes(agentId as (typeof ALEX_RILEY_ONLY)[number])) {
      return reply.code(404).send({ error: "Agent not available on home" });
    }
    if (agentId !== "alex") {
      // Riley wiring lands in its own slice; A.2 ships Alex only.
      return reply.code(404).send({ error: "Mission aggregator not available for this agent yet" });
    }

    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    if (!app.prisma) {
      return reply.code(503).send({ error: "Prisma unavailable" });
    }

    try {
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
    } catch (err) {
      app.log.error({ err }, "mission aggregator failed");
      return reply.code(500).send({ error: "Mission aggregator failed" });
    }
  });
};
```

Remove the two `__INTERNAL_*` exports — they were placeholders to keep TS happy while the route was stubbed.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/api test -- src/routes/agent-home/__tests__/mission.test.ts
```

Expected: all builder + route tests pass.

- [ ] **Step 5: Stage**

```bash
git add apps/api/src/routes/agent-home/mission.ts \
        apps/api/src/routes/agent-home/__tests__/mission.test.ts
```

---

### Task 3: Register the route in the Fastify bootstrap

**Files:**

- Modify: `apps/api/src/bootstrap/routes.ts`

- [ ] **Step 1: Locate the existing `metricsRoute` registration in `routes.ts`**

```bash
grep -n "metricsRoute" apps/api/src/bootstrap/routes.ts
```

Expected: lines around 63 (import) and 94 (register).

- [ ] **Step 2: Add the import + registration**

Add to the top-of-file imports next to `metricsRoute`:

```ts
import { missionRoute } from "../routes/agent-home/mission.js";
```

Add the registration immediately after the `metricsRoute` registration (matching the existing comment pattern):

```ts
// missionRoute: GET /api/dashboard/agents/:agentId/mission — agent-home mission aggregator
await app.register(missionRoute, { prefix: "/api/dashboard" });
```

- [ ] **Step 3: Run the api test suite to confirm route registration plays nicely with the rest of the app**

```bash
pnpm --filter @switchboard/api test
```

Expected: all green, including any startup smoke test that loads the bootstrap.

- [ ] **Step 4: Stage**

```bash
git add apps/api/src/bootstrap/routes.ts
```

---

### Task 4: Commit boundary — backend aggregator

**Files:** none (commit).

- [ ] **Step 1: Verify staged changes**

```bash
git status --short
```

Expected: 3 modified/new files under `apps/api/src/routes/agent-home/` + `apps/api/src/bootstrap/routes.ts`.

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(cockpit): mission aggregator endpoint for Alex (A.2)

Adds GET /api/dashboard/agents/:agentId/mission. Reads AgentRoster +
OrganizationConfig + Connection + ManagedChannel for the org and emits a
typed response with mission rows, channel status dots, defensive rules
parsing, and setup checklist flags. Riley returns 404 until its own slice
wires it.
EOF
)"
```

Expected: commit succeeds; commitlint accepts the conventional-commits subject.

---

### Task 5: Dashboard wire — mission types

**Files:**

- Create: `apps/dashboard/src/lib/cockpit/mission-types.ts`
- Test: `apps/dashboard/src/lib/cockpit/__tests__/mission-types.test.ts`

- [ ] **Step 1: Write failing type-assertion test**

```ts
// apps/dashboard/src/lib/cockpit/__tests__/mission-types.test.ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  MissionAggregatorResponse,
  MissionChannel,
  MissionChannelKind,
  MissionChannelStatus,
  MissionRules,
  MissionSetupRow,
  MissionTargets,
} from "../mission-types";

describe("cockpit mission types", () => {
  it("MissionChannelKind covers the five canonical kinds", () => {
    expectTypeOf<MissionChannelKind>().toEqualTypeOf<
      "meta-ads" | "whatsapp" | "telegram" | "slack" | "calendar"
    >();
  });

  it("MissionChannelStatus is the three-state union", () => {
    expectTypeOf<MissionChannelStatus>().toEqualTypeOf<"ok" | "warn" | "off">();
  });

  it("MissionRules is nullable", () => {
    expectTypeOf<MissionRules>().toEqualTypeOf<{
      priceApprovalThreshold: number;
      refundEscalationFloor: number;
    } | null>();
  });

  it("MissionSetupRow exposes key/done/primary?", () => {
    expectTypeOf<MissionSetupRow>().toEqualTypeOf<{
      key: "meta" | "inbox" | "cal" | "rules";
      done: boolean;
      primary?: boolean;
    }>();
  });

  it("MissionTargets carries the three v1 fields", () => {
    expectTypeOf<MissionTargets>().toEqualTypeOf<{
      avgValueCents: number | null;
      targetCpbCents: number | null;
      roasSource: "deterministic" | "crm";
    }>();
  });

  it("MissionAggregatorResponse composes the above into the wire shape", () => {
    expectTypeOf<MissionAggregatorResponse>().toMatchTypeOf<{
      agentKey: "alex" | "riley";
      displayName: string;
      mission: {
        role: string;
        pipeline: string;
        brand: string;
        channels: MissionChannel[];
        rules: MissionRules;
      };
      composerPlaceholder: string;
      commands: never[];
      targets: MissionTargets;
      setup: MissionSetupRow[];
    }>();
  });
});
```

Note: dashboard imports omit `.js` extensions per `feedback_dashboard_no_js_on_any_import` — the import above is `"../mission-types"`, not `"../mission-types.js"`.

- [ ] **Step 2: Run test, expect FAIL ("Cannot find module")**

```bash
pnpm --filter @switchboard/dashboard test -- src/lib/cockpit/__tests__/mission-types.test.ts
```

- [ ] **Step 3: Implement the types**

```ts
// apps/dashboard/src/lib/cockpit/mission-types.ts
export type MissionChannelKind = "meta-ads" | "whatsapp" | "telegram" | "slack" | "calendar";
export type MissionChannelStatus = "ok" | "warn" | "off";

export type MissionChannel = {
  kind: MissionChannelKind;
  label: string;
  status: MissionChannelStatus;
};

export type MissionRules = {
  priceApprovalThreshold: number;
  refundEscalationFloor: number;
} | null;

export type MissionTargets = {
  avgValueCents: number | null;
  targetCpbCents: number | null;
  roasSource: "deterministic" | "crm";
};

export type MissionSetupRow = {
  key: "meta" | "inbox" | "cal" | "rules";
  done: boolean;
  primary?: boolean;
};

export type MissionAggregatorResponse = {
  agentKey: "alex" | "riley";
  displayName: string;
  mission: {
    role: string;
    pipeline: string;
    brand: string;
    channels: MissionChannel[];
    rules: MissionRules;
  };
  composerPlaceholder: string;
  commands: never[];
  targets: MissionTargets;
  setup: MissionSetupRow[];
};
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/lib/cockpit/__tests__/mission-types.test.ts
```

Expected: 6 passing assertions.

- [ ] **Step 5: Stage**

```bash
git add apps/dashboard/src/lib/cockpit/mission-types.ts \
        apps/dashboard/src/lib/cockpit/__tests__/mission-types.test.ts
```

---

### Task 6: Add `getMission` to the API client

**Files:**

- Modify: `apps/dashboard/src/lib/api-client/governance.ts`

The existing `getGreeting` method is the model (see file lines around 338). No test for the client method directly — its shape is exercised by the proxy-route test in Task 7.

- [ ] **Step 1: Open the file and find `getGreeting`**

```bash
grep -n "getGreeting" apps/dashboard/src/lib/api-client/governance.ts
```

Expected: line ~338.

- [ ] **Step 2: Add the import and the method below `getGreeting`**

At the top of the file, alongside other type imports from `@/lib/agent-home/types` (the existing pattern in the file), add an import for `MissionAggregatorResponse`:

```ts
import type { MissionAggregatorResponse } from "@/lib/cockpit/mission-types";
```

Below `getGreeting`'s closing brace, insert:

```ts
  async getMission(agentKey: string): Promise<MissionAggregatorResponse> {
    return this.request<MissionAggregatorResponse>(
      `/api/dashboard/agents/${encodeURIComponent(agentKey)}/mission`,
    );
  }
```

- [ ] **Step 3: Run the dashboard typecheck**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: clean (the new method's types compose).

- [ ] **Step 4: Stage**

```bash
git add apps/dashboard/src/lib/api-client/governance.ts
```

---

### Task 7: Dashboard proxy route

**Files:**

- Create: `apps/dashboard/src/app/api/dashboard/agents/[agentId]/mission/route.ts`
- Test: `apps/dashboard/src/app/api/dashboard/agents/[agentId]/mission/__tests__/route.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/dashboard/src/app/api/dashboard/agents/[agentId]/mission/__tests__/route.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/get-api-client", () => ({
  getApiClient: vi.fn(),
}));
vi.mock("@/lib/require-dashboard-session", () => ({
  requireDashboardSession: vi.fn().mockResolvedValue(undefined),
}));

import { getApiClient } from "@/lib/get-api-client";
import { requireDashboardSession } from "@/lib/require-dashboard-session";
import { GET } from "../route";

function makeReq(url = "http://x/api/dashboard/agents/alex/mission"): Request {
  return new Request(url);
}

describe("per-agent mission dashboard proxy", () => {
  it("returns 401 when no session", async () => {
    (requireDashboardSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Unauthorized"),
    );
    const res = await GET(makeReq(), { params: Promise.resolve({ agentId: "alex" }) });
    expect(res.status).toBe(401);
  });

  it("calls getMission(agentKey) and returns 200 with body", async () => {
    const getMission = vi.fn().mockResolvedValue({
      agentKey: "alex",
      displayName: "Alex",
      mission: {
        role: "SDR · qualify inbound leads, book tours",
        pipeline: "Tours pipeline · single funnel",
        brand: "Acme · —",
        channels: [],
        rules: null,
      },
      composerPlaceholder: "Tell Alex what to do — coming soon",
      commands: [],
      targets: { avgValueCents: null, targetCpbCents: null, roasSource: "deterministic" },
      setup: [
        { key: "meta", done: false, primary: true },
        { key: "inbox", done: false },
        { key: "cal", done: false },
        { key: "rules", done: false },
      ],
    });
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ getMission });
    (requireDashboardSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      undefined,
    );

    const res = await GET(makeReq(), { params: Promise.resolve({ agentId: "alex" }) });
    expect(res.status).toBe(200);
    expect(getMission).toHaveBeenCalledWith("alex");
    const body = (await res.json()) as { mission: { brand: string } };
    expect(body.mission.brand).toBe("Acme · —");
  });

  it("returns 500 when upstream throws", async () => {
    const getMission = vi.fn().mockRejectedValue(new Error("boom"));
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ getMission });
    (requireDashboardSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      undefined,
    );

    const res = await GET(makeReq(), { params: Promise.resolve({ agentId: "alex" }) });
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- src/app/api/dashboard/agents/\[agentId\]/mission/__tests__/route.test.ts
```

Expected: `Cannot find module '../route'`.

- [ ] **Step 3: Implement the proxy**

```ts
// apps/dashboard/src/app/api/dashboard/agents/[agentId]/mission/route.ts
import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireDashboardSession } from "@/lib/require-dashboard-session";

function errorResponse(err: unknown) {
  const status = err instanceof Error && err.message === "Unauthorized" ? 401 : 500;
  return NextResponse.json(err instanceof Error ? { error: err.message } : { error: "unknown" }, {
    status,
  });
}

/**
 * Dashboard proxy for `GET /api/dashboard/agents/:agentKey/mission`.
 *
 * Param name is `agentId` to match the sibling per-agent routes — Next.js
 * rejects different dynamic-segment slugs at the same path level.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    await requireDashboardSession();
    const client = await getApiClient();
    const { agentId } = await params;
    const data = await client.getMission(agentId);
    return NextResponse.json(data);
  } catch (err: unknown) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/app/api/dashboard/agents/\[agentId\]/mission/__tests__/route.test.ts
```

Expected: all 3 tests pass.

- [ ] **Step 5: Stage**

```bash
git add apps/dashboard/src/app/api/dashboard/agents/\[agentId\]/mission/route.ts \
        apps/dashboard/src/app/api/dashboard/agents/\[agentId\]/mission/__tests__/route.test.ts
```

---

### Task 8: `use-agent-mission` hook + commit boundary

**Files:**

- Create: `apps/dashboard/src/hooks/use-agent-mission.ts`
- Test: `apps/dashboard/src/hooks/__tests__/use-agent-mission.test.tsx`

The hook mirrors `use-agent-greeting.ts` (60 s refetch interval, `useScopedQueryKeys` gating) but also re-keys on `useHalt().halted` so refetching happens when the operator pauses/resumes Alex. Per the spec §3 / §slice brief.

- [ ] **Step 1: Inspect the existing greeting hook for the patterns to mirror**

```bash
cat apps/dashboard/src/hooks/use-agent-greeting.ts
```

Note: `useScopedQueryKeys()` produces the per-tenant cache key; if it returns `null` the query is disabled. We add `keys.mission(agentKey)` — but `use-query-keys.ts` doesn't have a `mission` slot yet. Add it.

- [ ] **Step 2: Extend `use-query-keys.ts` with a `mission` namespace**

```bash
grep -n "greeting:" apps/dashboard/src/hooks/use-query-keys.ts
```

Locate the existing `greeting` entry and mirror it. Add (next to it):

```ts
    mission: {
      detail: (agentKey: string) => [...root, "mission", agentKey] as const,
    },
```

If the file already exports a typed key registry, follow the existing pattern; do not invent a new shape. The exact insertion location varies — keep alphabetical order if the file uses it.

- [ ] **Step 3: Write failing hook test**

```tsx
// apps/dashboard/src/hooks/__tests__/use-agent-mission.test.tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/hooks/use-query-keys", () => ({
  useScopedQueryKeys: () => ({
    mission: { detail: (k: string) => ["test", "mission", k] as const },
  }),
}));

let mockHalted = false;
vi.mock("@/components/halt/halt-provider", () => ({
  useHalt: () => ({ halted: mockHalted, setHalted: vi.fn() }),
}));

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  mockHalted = false;
});

import { useAgentMission } from "../use-agent-mission";

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("useAgentMission", () => {
  it("fetches the per-agent mission endpoint and surfaces data", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          agentKey: "alex",
          displayName: "Alex",
          mission: { role: "x", pipeline: "y", brand: "z", channels: [], rules: null },
          composerPlaceholder: "",
          commands: [],
          targets: { avgValueCents: null, targetCpbCents: null, roasSource: "deterministic" },
          setup: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const { result } = renderHook(() => useAgentMission("alex"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.data?.agentKey).toBe("alex"));
    expect(fetchMock).toHaveBeenCalledWith("/api/dashboard/agents/alex/mission");
  });

  it("surfaces error when the fetch fails", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    const { result } = renderHook(() => useAgentMission("alex"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
```

- [ ] **Step 4: Run test, expect FAIL (`Cannot find module '../use-agent-mission'`)**

```bash
pnpm --filter @switchboard/dashboard test -- src/hooks/__tests__/use-agent-mission.test.tsx
```

- [ ] **Step 5: Implement the hook**

```ts
// apps/dashboard/src/hooks/use-agent-mission.ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import { useHalt } from "@/components/halt/halt-provider";
import type { MissionAggregatorResponse } from "@/lib/cockpit/mission-types";

async function fetchMission(agentKey: string): Promise<MissionAggregatorResponse> {
  const url = `/api/dashboard/agents/${encodeURIComponent(agentKey)}/mission`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load mission: ${res.status}`);
  }
  return (await res.json()) as MissionAggregatorResponse;
}

export function useAgentMission(agentKey: string) {
  const keys = useScopedQueryKeys();
  const { halted } = useHalt();
  const query = useQuery({
    queryKey: keys
      ? [...keys.mission.detail(agentKey), halted ? "halted" : "live"]
      : ["__disabled_mission__"],
    queryFn: () => fetchMission(agentKey),
    refetchInterval: 60_000,
    enabled: !!keys,
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}
```

If the actual `useHalt` import path differs from `@/components/halt/halt-provider`, use the path that A.1's `cockpit-page.tsx` imports from — A.1 already established the canonical import path. Adjust the test's `vi.mock` target to match.

- [ ] **Step 6: Run test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/hooks/__tests__/use-agent-mission.test.tsx
```

Expected: 2 passing.

- [ ] **Step 7: Run typecheck across dashboard to confirm nothing else broke**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

- [ ] **Step 8: Stage and commit boundary**

```bash
git add apps/dashboard/src/hooks/use-agent-mission.ts \
        apps/dashboard/src/hooks/__tests__/use-agent-mission.test.tsx \
        apps/dashboard/src/hooks/use-query-keys.ts \
        apps/dashboard/src/lib/cockpit/mission-types.ts \
        apps/dashboard/src/lib/cockpit/__tests__/mission-types.test.ts \
        apps/dashboard/src/lib/api-client/governance.ts \
        "apps/dashboard/src/app/api/dashboard/agents/[agentId]/mission/route.ts" \
        "apps/dashboard/src/app/api/dashboard/agents/[agentId]/mission/__tests__/route.test.ts"

git commit -m "$(cat <<'EOF'
feat(cockpit): wire mission aggregator to dashboard hook (A.2)

Adds mission-types, apiClient.getMission, the per-agent proxy route, and
useAgentMission — a React Query hook that refetches when the halt flag
toggles. Hook gating mirrors useAgentGreeting.
EOF
)"
```

Expected: commit succeeds.

---

### Task 9: Mission popover component

**Files:**

- Create: `apps/dashboard/src/components/cockpit/mission-popover.tsx`
- Test: `apps/dashboard/src/components/cockpit/__tests__/mission-popover.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/dashboard/src/components/cockpit/__tests__/mission-popover.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MissionPopover } from "../mission-popover";
import type { MissionAggregatorResponse } from "@/lib/cockpit/mission-types";

const baseMission: MissionAggregatorResponse["mission"] = {
  role: "SDR · qualify inbound leads, book tours",
  pipeline: "Tours pipeline · single funnel",
  brand: "HotPod Yoga · —",
  channels: [
    { kind: "meta-ads", label: "Meta Ads", status: "ok" },
    { kind: "whatsapp", label: "WhatsApp inbox", status: "warn" },
    { kind: "calendar", label: "Tour calendar", status: "off" },
  ],
  rules: { priceApprovalThreshold: 89, refundEscalationFloor: 200 },
};

describe("MissionPopover", () => {
  it("renders all 5 rows including Rules when rules present", () => {
    render(<MissionPopover open onClose={() => {}} mission={baseMission} />);
    expect(screen.getByText(/ROLE/i)).toBeInTheDocument();
    expect(screen.getByText(/PIPELINE/i)).toBeInTheDocument();
    expect(screen.getByText(/BRAND/i)).toBeInTheDocument();
    expect(screen.getByText(/CHANNELS/i)).toBeInTheDocument();
    expect(screen.getByText(/RULES/i)).toBeInTheDocument();
    expect(screen.getByText(/Pricing approvals over \$89/)).toBeInTheDocument();
    expect(screen.getByText(/refunds over \$200/)).toBeInTheDocument();
  });

  it("hides Rules row when mission.rules is null", () => {
    render(<MissionPopover open onClose={() => {}} mission={{ ...baseMission, rules: null }} />);
    expect(screen.queryByText(/RULES/i)).not.toBeInTheDocument();
  });

  it("renders one channel dot per channel with the right aria-label per status", () => {
    render(<MissionPopover open onClose={() => {}} mission={baseMission} />);
    expect(screen.getByLabelText("Meta Ads: connected")).toBeInTheDocument();
    expect(screen.getByLabelText("WhatsApp inbox: degraded")).toBeInTheDocument();
    expect(screen.getByLabelText("Tour calendar: not connected")).toBeInTheDocument();
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(<MissionPopover open onClose={onClose} mission={baseMission} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders an 'Edit configuration' link pointing at /settings", () => {
    render(<MissionPopover open onClose={() => {}} mission={baseMission} />);
    const link = screen.getByRole("link", { name: /Edit configuration/i });
    expect(link.getAttribute("href")).toBe("/settings");
  });

  it("renders nothing when open=false", () => {
    const { container } = render(
      <MissionPopover open={false} onClose={() => {}} mission={baseMission} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/mission-popover.test.tsx
```

- [ ] **Step 3: Implement the component**

```tsx
// apps/dashboard/src/components/cockpit/mission-popover.tsx
"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { T } from "./tokens";
import { Dot } from "./dot";
import type {
  MissionAggregatorResponse,
  MissionChannel,
  MissionChannelStatus,
} from "@/lib/cockpit/mission-types";

const STATUS_TO_LABEL: Record<MissionChannelStatus, string> = {
  ok: "connected",
  warn: "degraded",
  off: "not connected",
};

const STATUS_TO_COLOR: Record<MissionChannelStatus, string> = {
  ok: T.green,
  warn: T.amber,
  off: T.ink5,
};

type Props = {
  open: boolean;
  onClose: () => void;
  mission: MissionAggregatorResponse["mission"];
};

export function MissionPopover({ open, onClose, mission }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onMouseDown(e: MouseEvent) {
      if (!containerRef.current) return;
      if (e.target instanceof Node && !containerRef.current.contains(e.target)) {
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const rulesCopy =
    mission.rules !== null
      ? `Pricing approvals over $${mission.rules.priceApprovalThreshold} · refunds over $${mission.rules.refundEscalationFloor}`
      : null;

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label="Alex mission"
      className="absolute z-30 mt-2 w-[min(420px,calc(100vw-2rem))] rounded-lg border shadow-lg"
      style={{ background: T.paper, borderColor: T.hair, color: T.ink }}
    >
      <div className="divide-y" style={{ borderColor: T.hair }}>
        <MissionRow eyebrow="ROLE" value={mission.role} />
        <MissionRow eyebrow="PIPELINE" value={mission.pipeline} />
        <MissionRow eyebrow="BRAND" value={mission.brand} />
        <ChannelsRow channels={mission.channels} />
        {rulesCopy ? <MissionRow eyebrow="RULES" value={rulesCopy} /> : null}
      </div>
      <div
        className="flex items-center justify-end p-3 text-sm"
        style={{ borderTop: `1px solid ${T.hair}` }}
      >
        <Link
          href="/settings"
          className="rounded px-2 py-1 underline-offset-2 hover:underline"
          style={{ color: T.amberDeep }}
        >
          Edit configuration →
        </Link>
      </div>
    </div>
  );
}

function MissionRow({ eyebrow, value }: { eyebrow: string; value: string }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: T.ink3 }}>
        {eyebrow}
      </div>
      <div className="text-sm" style={{ color: T.ink }}>
        {value}
      </div>
    </div>
  );
}

function ChannelsRow({ channels }: { channels: MissionChannel[] }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: T.ink3 }}>
        CHANNELS
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        {channels.map((channel) => (
          <li key={channel.kind} className="flex items-center gap-2">
            <Dot
              color={STATUS_TO_COLOR[channel.status]}
              size={8}
              aria-label={`${channel.label}: ${STATUS_TO_LABEL[channel.status]}`}
            />
            <span style={{ color: T.ink }}>{channel.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

If `<Dot>` (created in A.1) does not currently accept `aria-label` and the test fails on that selector, extend `dot.tsx` to forward an optional `aria-label` prop in the same task — the change is one line and keeps A.1 components shippable.

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/mission-popover.test.tsx
```

Expected: all 6 cases pass. If the `Dot` aria-label assertion fails, add `aria-label` forwarding to `dot.tsx` and re-run.

- [ ] **Step 5: Stage**

```bash
git add apps/dashboard/src/components/cockpit/mission-popover.tsx \
        apps/dashboard/src/components/cockpit/__tests__/mission-popover.test.tsx
# Only if dot.tsx needed the aria-label forward:
git add apps/dashboard/src/components/cockpit/dot.tsx
```

---

### Task 10: Empty-state component + commit boundary

**Files:**

- Create: `apps/dashboard/src/components/cockpit/empty-state.tsx`
- Test: `apps/dashboard/src/components/cockpit/__tests__/empty-state.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/dashboard/src/components/cockpit/__tests__/empty-state.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EmptyState, shouldRenderEmptyState } from "../empty-state";
import type { MissionAggregatorResponse } from "@/lib/cockpit/mission-types";

const setupAllUndone: MissionAggregatorResponse["setup"] = [
  { key: "meta", done: false, primary: true },
  { key: "inbox", done: false },
  { key: "cal", done: false },
  { key: "rules", done: false },
];

const setupPartialDone: MissionAggregatorResponse["setup"] = [
  { key: "meta", done: true },
  { key: "inbox", done: false, primary: true },
  { key: "cal", done: false },
  { key: "rules", done: false },
];

describe("shouldRenderEmptyState", () => {
  it("returns true only when every setup row is undone", () => {
    expect(shouldRenderEmptyState(setupAllUndone)).toBe(true);
    expect(shouldRenderEmptyState(setupPartialDone)).toBe(false);
    expect(shouldRenderEmptyState([])).toBe(false);
  });
});

describe("EmptyState", () => {
  it("templates thresholds from mission.rules when present", () => {
    render(
      <EmptyState
        rules={{ priceApprovalThreshold: 120, refundEscalationFloor: 250 }}
        setup={setupAllUndone}
        onConnect={vi.fn()}
      />,
    );
    expect(screen.getByText(/pricing decisions over \$120/i)).toBeInTheDocument();
    expect(screen.getByText(/refunds over \$250/i)).toBeInTheDocument();
  });

  it("falls back to locked-design defaults when rules == null", () => {
    render(<EmptyState rules={null} setup={setupAllUndone} onConnect={vi.fn()} />);
    expect(screen.getByText(/pricing decisions over \$89/i)).toBeInTheDocument();
    expect(screen.getByText(/refunds over \$200/i)).toBeInTheDocument();
  });

  it("renders 4 setup rows with the primary row highlighted", () => {
    render(<EmptyState rules={null} setup={setupAllUndone} onConnect={vi.fn()} />);
    const rows = screen.getAllByTestId(/^setup-row-/);
    expect(rows).toHaveLength(4);
    const primary = screen.getByTestId("setup-row-meta");
    expect(primary.getAttribute("data-primary")).toBe("true");
    expect(screen.getByTestId("setup-row-inbox").getAttribute("data-primary")).toBe("false");
  });

  it("invokes onConnect with the row key when a setup row is clicked", () => {
    const onConnect = vi.fn();
    render(<EmptyState rules={null} setup={setupAllUndone} onConnect={onConnect} />);
    fireEvent.click(screen.getByTestId("setup-row-inbox"));
    expect(onConnect).toHaveBeenCalledWith("inbox");
  });

  it("shows the NEXT MOVE pill from the primary row", () => {
    render(<EmptyState rules={null} setup={setupAllUndone} onConnect={vi.fn()} />);
    expect(screen.getByText(/NEXT MOVE/i)).toBeInTheDocument();
    expect(screen.getByText(/Connect Meta Ads/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/empty-state.test.tsx
```

- [ ] **Step 3: Implement the component**

```tsx
// apps/dashboard/src/components/cockpit/empty-state.tsx
"use client";

import { T } from "./tokens";
import type { MissionAggregatorResponse } from "@/lib/cockpit/mission-types";

const DEFAULT_PRICE = 89;
const DEFAULT_REFUND = 200;

const SETUP_LABEL: Record<MissionAggregatorResponse["setup"][number]["key"], string> = {
  meta: "Connect Meta Ads",
  inbox: "Connect HotPod inbox",
  cal: "Connect tour calendar",
  rules: "Review pricing & escalation",
};

export function shouldRenderEmptyState(setup: MissionAggregatorResponse["setup"]): boolean {
  if (setup.length === 0) return false;
  return setup.every((row) => !row.done);
}

type Props = {
  rules: MissionAggregatorResponse["mission"]["rules"];
  setup: MissionAggregatorResponse["setup"];
  onConnect: (key: MissionAggregatorResponse["setup"][number]["key"]) => void;
};

export function EmptyState({ rules, setup, onConnect }: Props) {
  const price = rules?.priceApprovalThreshold ?? DEFAULT_PRICE;
  const refund = rules?.refundEscalationFloor ?? DEFAULT_REFUND;
  const primary = setup.find((row) => row.primary);
  const primaryLabel = primary ? SETUP_LABEL[primary.key] : "Connect Meta Ads";

  return (
    <section
      data-testid="cockpit-empty-state"
      className="my-6 flex flex-col gap-4"
      style={{ color: T.ink }}
    >
      <article
        className="rounded-lg border p-5"
        style={{ background: T.amberPaper, borderColor: T.hair }}
      >
        <header className="mb-2 text-[10px] uppercase tracking-wider" style={{ color: T.ink3 }}>
          Alex · just now
        </header>
        <p className="text-base leading-snug" style={{ color: T.ink }}>
          I'm set up and quiet. Connect Meta Ads and I'll pull the first leads in under a minute.
        </p>
        <p className="mt-2 text-base leading-snug" style={{ color: T.ink2 }}>
          Then I'll qualify, reply, and book tours under your standing rules. I'll only interrupt
          you for pricing decisions over ${price} and refunds over ${refund}.
        </p>
        <div className="mt-4">
          <span
            className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs"
            style={{
              background: T.amber,
              color: T.paper,
            }}
          >
            <span className="font-semibold uppercase tracking-wider">Next move</span>
            <span>{primaryLabel}</span>
          </span>
        </div>
      </article>

      <ul className="flex flex-col gap-2">
        {setup.map((row) => (
          <li key={row.key}>
            <button
              type="button"
              data-testid={`setup-row-${row.key}`}
              data-primary={row.primary ? "true" : "false"}
              onClick={() => onConnect(row.key)}
              className="flex w-full items-center justify-between rounded-md border px-4 py-3 text-left"
              style={{
                borderColor: row.primary ? T.amber : T.hair,
                background: row.primary ? T.amberPaper : T.paper,
                color: T.ink,
              }}
            >
              <span className="text-sm">{SETUP_LABEL[row.key]}</span>
              <span className="text-xs" style={{ color: T.ink3 }}>
                {row.done ? "done" : "todo"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/empty-state.test.tsx
```

Expected: 7 passing.

- [ ] **Step 5: Stage and commit boundary**

```bash
git add apps/dashboard/src/components/cockpit/empty-state.tsx \
        apps/dashboard/src/components/cockpit/__tests__/empty-state.test.tsx

git commit -m "$(cat <<'EOF'
feat(cockpit): mission popover + Day-1 narrator/setup checklist (A.2)

Adds <MissionPopover> (Role/Pipeline/Brand/Channels/Rules rows with status
dots, Escape + outside-click close, "Edit configuration" → /settings) and
<EmptyState> (warm-paper narrator card templated from rules thresholds plus
a 4-row setup checklist that routes setup clicks via onConnect). Threshold
defaults match the locked design when rules is null.
EOF
)"
```

Expected: commit succeeds.

---

### Task 11: Extend `<Identity>` with optional mission-interactive props

**Files:**

- Modify: `apps/dashboard/src/components/cockpit/identity.tsx`
- Modify: `apps/dashboard/src/components/cockpit/__tests__/identity.test.tsx`

- [ ] **Step 1: Open `identity.tsx` and locate the subtitle render**

```bash
grep -n "subtitle" apps/dashboard/src/components/cockpit/identity.tsx
```

A.1 renders the subtitle as plain text (`<div>{subtitle}</div>` or `<p>{subtitle}</p>`). We're extending its prop interface and switching to a `<button>` when both new props are set.

- [ ] **Step 2: Add the new test cases to the existing identity test**

Append to `apps/dashboard/src/components/cockpit/__tests__/identity.test.tsx`:

```tsx
import { fireEvent, screen } from "@testing-library/react";
// (existing imports already cover render + the rest)

describe("Identity — mission interactive subtitle (A.2)", () => {
  it("renders subtitle as plain text by default (A.1 behavior preserved)", () => {
    // Render with the existing A.1 prop set, no missionInteractive prop.
    // Asserts the subtitle is NOT a button.
    // ...assemble same baseline render the A.1 tests use, then:
    const subtitle = screen.getByText(/SDR/i);
    expect(subtitle.tagName.toLowerCase()).not.toBe("button");
  });

  it("renders subtitle as a button and calls onOpenMission when interactive", () => {
    const onOpenMission = vi.fn();
    // Render with missionInteractive + onOpenMission set.
    // ...adapt the baseline render to pass: missionInteractive, onOpenMission
    fireEvent.click(screen.getByRole("button", { name: /SDR/i }));
    expect(onOpenMission).toHaveBeenCalledTimes(1);
  });
});
```

The above sketch reuses the test scaffolding the A.1 identity test already established — the actual render-helper invocation in this codebase varies. Read the existing test to confirm the helper name, then mirror it.

- [ ] **Step 3: Run test, expect FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/identity.test.tsx
```

- [ ] **Step 4: Extend the `<Identity>` component**

Extend the `IdentityProps` type with two optional fields:

```ts
type IdentityProps = {
  // ... existing A.1 props
  onOpenMission?: () => void;
  missionInteractive?: boolean;
};
```

Replace the subtitle render with the conditional:

```tsx
{
  missionInteractive && onOpenMission ? (
    <button
      type="button"
      onClick={onOpenMission}
      className="text-left underline-offset-2 hover:underline"
      style={{ color: T.ink3 }}
    >
      {subtitle}
    </button>
  ) : (
    <div style={{ color: T.ink3 }}>{subtitle}</div>
  );
}
```

Do **not** change any existing prop or render — A.1 call sites must continue to compile and behave identically.

- [ ] **Step 5: Run test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/identity.test.tsx
```

Expected: existing tests + 2 new tests all pass.

- [ ] **Step 6: Stage**

```bash
git add apps/dashboard/src/components/cockpit/identity.tsx \
        apps/dashboard/src/components/cockpit/__tests__/identity.test.tsx
```

---

### Task 12: Compose `<MissionPopover>` and `<EmptyState>` into `cockpit-page.tsx` + commit boundary

**Files:**

- Modify: `apps/dashboard/src/components/cockpit/cockpit-page.tsx`
- Modify: `apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx`

- [ ] **Step 1: Open `cockpit-page.tsx` and study A.1's composition**

```bash
cat apps/dashboard/src/components/cockpit/cockpit-page.tsx
```

A.1 renders `<Topbar/><Identity/><ApprovalBlock?/><ActivityStream/><ComposerPlaceholder/>`. A.2 needs to:

1. Call `useAgentMission(agentKey)` next to the existing hook calls.
2. Hold a local `missionOpen` state.
3. Pass `missionInteractive={!!mission.data}` + `onOpenMission={() => setMissionOpen(o => !o)}` into `<Identity>`.
4. Render `<MissionPopover open={missionOpen} onClose={() => setMissionOpen(false)} mission={mission.data.mission}/>` as a positioned sibling beneath `<Identity>` (wrap them in a relatively-positioned `<div>` so the popover anchors).
5. Compute `coldState = mission.data ? shouldRenderEmptyState(mission.data.setup) : false`.
6. Render `<EmptyState rules={mission.data.mission.rules} setup={mission.data.setup} onConnect={(key) => router.push(`/setup?step=${key}`)} />` between the identity row and the approval block when `coldState` is true. **Hide `<ActivityStream/>` in cold state.** Keep `<ComposerPlaceholder/>` visible.

Use Next.js `useRouter` from `next/navigation` for the deep-link push (matches the existing dashboard conventions; check `cockpit-page.tsx`'s existing imports first — if it already pulls `useRouter`, reuse it).

- [ ] **Step 2: Add failing tests to the existing cockpit-page test**

Append to `apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx`:

```tsx
describe("CockpitPage — A.2 mission + empty-state", () => {
  it("makes the subtitle clickable once mission data loads and toggles the popover", async () => {
    // Configure mocks so useAgentMission returns a fully-populated mission.
    // (Mirror the A.1 test's mock setup — adjust to inject mission data.)
    // ...
    // After render + waitFor for the mission data:
    const subtitle = await screen.findByRole("button", { name: /SDR/i });
    fireEvent.click(subtitle);
    expect(await screen.findByRole("dialog", { name: /Alex mission/i })).toBeInTheDocument();
  });

  it("renders EmptyState (and hides activity stream) when setup is all-undone", async () => {
    // useAgentMission returns setup with every row done:false
    // ...
    expect(await screen.findByTestId("cockpit-empty-state")).toBeInTheDocument();
    expect(screen.queryByTestId("cockpit-activity-stream")).not.toBeInTheDocument();
  });

  it("renders the activity stream (and not EmptyState) when at least one setup row is done", async () => {
    // useAgentMission returns setup with meta done:true
    // ...
    expect(await screen.findByTestId("cockpit-activity-stream")).toBeInTheDocument();
    expect(screen.queryByTestId("cockpit-empty-state")).not.toBeInTheDocument();
  });
});
```

If `<ActivityStream>` does not already set `data-testid="cockpit-activity-stream"`, add it as part of this task — it's a single attribute and aligns with the `cockpit-empty-state` test-id pattern.

- [ ] **Step 3: Run test, expect FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/cockpit-page.test.tsx
```

- [ ] **Step 4: Implement the composition changes**

Inside `CockpitPage`:

```tsx
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAgentMission } from "@/hooks/use-agent-mission";
import { MissionPopover } from "./mission-popover";
import { EmptyState, shouldRenderEmptyState } from "./empty-state";

// inside the component:
const mission = useAgentMission(agentKey);
const router = useRouter();
const [missionOpen, setMissionOpen] = useState(false);

const coldState = mission.data ? shouldRenderEmptyState(mission.data.setup) : false;
```

In the JSX:

```tsx
<div className="relative">
  <Identity
    {/* existing A.1 props */}
    missionInteractive={!!mission.data}
    onOpenMission={() => setMissionOpen((o) => !o)}
  />
  {mission.data ? (
    <MissionPopover
      open={missionOpen}
      onClose={() => setMissionOpen(false)}
      mission={mission.data.mission}
    />
  ) : null}
</div>

{coldState && mission.data ? (
  <EmptyState
    rules={mission.data.mission.rules}
    setup={mission.data.setup}
    onConnect={(key) => router.push(`/setup?step=${key}`)}
  />
) : (
  <ActivityStream {/* existing A.1 props */} />
)}
```

If the existing render keeps the approval block before the activity stream, preserve that — the cold-state branch replaces **only** the activity stream, not the approval block.

- [ ] **Step 5: Run test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/cockpit-page.test.tsx
```

Expected: existing tests + 3 new tests all pass.

- [ ] **Step 6: Run the full dashboard test suite**

```bash
pnpm --filter @switchboard/dashboard test
```

Expected: green.

- [ ] **Step 7: Stage and commit boundary**

```bash
git add apps/dashboard/src/components/cockpit/cockpit-page.tsx \
        apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx
# Only if activity-stream test-id was added:
git add apps/dashboard/src/components/cockpit/activity-stream.tsx

git commit -m "$(cat <<'EOF'
feat(cockpit): make identity subtitle clickable, render cold-state narrator (A.2)

Wires useAgentMission into CockpitPage. The identity subtitle becomes a
popover trigger once mission data loads. When every setup row is undone,
EmptyState replaces the activity stream and routes setup-row clicks to
/setup?step={key}.
EOF
)"
```

Expected: commit succeeds.

---

### Task 13: Full verification + PR open

**Files:** none (verification + PR creation).

- [ ] **Step 1: Run the api test suite**

```bash
pnpm --filter @switchboard/api test
```

Expected: green.

- [ ] **Step 2: Run the dashboard test suite**

```bash
pnpm --filter @switchboard/dashboard test
```

Expected: green.

- [ ] **Step 3: Run workspace typecheck**

```bash
pnpm typecheck
```

Expected: clean. If errors mention `.js` extensions in dashboard imports, re-check `feedback_dashboard_no_js_on_any_import` — dashboard imports must omit `.js`.

- [ ] **Step 4: Run lint**

```bash
pnpm lint
```

Expected: clean.

- [ ] **Step 5: Run the dashboard build (NOT in CI — see `feedback_dashboard_build_not_in_ci`)**

```bash
pnpm --filter @switchboard/dashboard build
```

Expected: build succeeds. If it fails on `.js` extensions in relative imports, drop them.

- [ ] **Step 6: Manual smoke**

```bash
pnpm dev
```

- Visit `http://localhost:3002/alex` against a clean tenant — narrator + 4 setup rows visible; subtitle is clickable; popover opens; Escape closes.
- Visit `http://localhost:3002/riley` — legacy block-based home renders unchanged. (`getMission` returns 404 for Riley; the cockpit isn't on this route yet.)
- Toggle Halt — pill turns red, mission popover still openable; mission data refetches on halt-toggle.
- DB tweak: add a Meta Ads row to the org's `Connection` table — narrator may disappear (only if at least one setup row is `done`, which makes `shouldRenderEmptyState` return false). Verify with the dashboard.

- [ ] **Step 7: Push the branch and open a stacked PR**

```bash
git push -u origin feat/alex-cockpit-a2

gh pr create \
  --base feat/alex-cockpit-a1 \
  --title "feat(cockpit): A.2 mission popover + Day-1 narrator" \
  --body "$(cat <<'EOF'
## Summary

- New `GET /api/dashboard/agents/:agentId/mission` aggregator + dashboard proxy + `useAgentMission` hook
- `<MissionPopover>`: 5 rows (Role/Pipeline/Brand/Channels/Rules) with status dots; "Edit configuration" → `/settings`; Escape + outside-click close
- `<EmptyState>`: Day-1 narrator + 4-row setup checklist templated from `mission.rules` (or locked-design defaults when `rules` is null)
- `<Identity>` gains optional `onOpenMission` + `missionInteractive` props (A.1 call sites unchanged)
- `CockpitPage` mounts the popover and renders `<EmptyState>` in place of the activity stream when every setup row is undone
- No schema migrations. No new persistence. Status pill vocabulary unchanged (`IDLE / WORKING / WAITING / HALTED`). Composer stays inert. KPI/ROI/activity richness/command palette all stay deferred.

Stacked on top of #475 (A.1 shell + basic composition). GitHub will auto-retarget this PR's base as #474 + #475 merge into `main`.

## Test plan

- [x] `pnpm --filter @switchboard/api test` — green (new mission route tests)
- [x] `pnpm --filter @switchboard/dashboard test` — green (mission types, hook, popover, empty-state, identity, cockpit-page tests)
- [x] `pnpm typecheck` — clean
- [x] `pnpm lint` — clean
- [x] `pnpm --filter @switchboard/dashboard build` — succeeds (dashboard build not in CI per project memory)
- [ ] Manual: `/alex` cold state shows narrator + 4 setup rows
- [ ] Manual: subtitle click → popover opens → Esc closes; outside-click closes
- [ ] Manual: with Meta Ads `Connection` row in DB, narrator hides (and only if no other rows force EmptyState)
- [ ] Manual: `/riley` legacy unchanged

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR opens against `feat/alex-cockpit-a1` (stacked). Return the PR URL.

---

## Summary

Five commits across the slice, each addressing one cohesive concern:

1. **Backend aggregator** (Tasks 1–4) — Fastify route + builder function + bootstrap registration.
2. **Dashboard wire** (Tasks 5–8) — types, API client method, proxy route, hook.
3. **Popover + empty-state** (Tasks 9–10) — both reusable components.
4. **Page composition** (Tasks 11–12) — Identity prop extension + cockpit-page integration.
5. **Verification + PR** (Task 13) — full check before opening.

## Test plan

Each task above carries its own failing-test → green-test cycle. The composed test plan is:

- `apps/api/src/routes/agent-home/__tests__/mission.test.ts` — builder happy/edge paths + Fastify route 200/400/404/503.
- `apps/dashboard/src/lib/cockpit/__tests__/mission-types.test.ts` — compile-time type assertions.
- `apps/dashboard/src/app/api/dashboard/agents/[agentId]/mission/__tests__/route.test.ts` — proxy 200/401/500.
- `apps/dashboard/src/hooks/__tests__/use-agent-mission.test.tsx` — fetch + error.
- `apps/dashboard/src/components/cockpit/__tests__/mission-popover.test.tsx` — 5-row render, status dots, rules visibility, Escape + outside-click close, settings link.
- `apps/dashboard/src/components/cockpit/__tests__/empty-state.test.tsx` — threshold templating, primary highlight, onConnect deep-link, conditional render.
- `apps/dashboard/src/components/cockpit/__tests__/identity.test.tsx` — interactive subtitle when both new props are set; default A.1 behavior unchanged.
- `apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx` — popover toggling; cold-state EmptyState rendering; activity-stream gating.

## Self-review

**Spec coverage:** Every A.2 ship-item from the parent spec (§Implementation slices → A.2; §Backend changes §3) maps to a task above:

- Mission aggregator endpoint → Tasks 1–4.
- `use-agent-mission.ts` hook → Task 8.
- `mission-popover.tsx` + 5 rows + status dots → Task 9.
- Identity prop extension (`onOpenMission?` + `missionInteractive?`) → Task 11.
- "Edit configuration" → `/settings` deep link → Task 9.
- `empty-state.tsx` + 4-row setup checklist + `/setup?step={key}` deep link → Task 10 + Task 12.
- Client-side narrator templating from mission data (no `narratorState` persistence) → Task 10.

A.2 "does NOT ship" items from the slice brief are absent from this plan — verified.

**Placeholder scan:** No `TBD` / `TODO` / "implement later" / "similar to Task N". Two task instructions ("adapt the baseline render" in Task 11, "mirror the A.1 test's mock setup" in Task 12) refer to existing scaffolding in test files this PR also modifies — the engineer must reuse the pattern that lives in the file already rather than this plan duplicating it. The actual code under test (component props, imports, render calls) is fully specified.

**Type consistency:** `MissionChannelKind`, `MissionChannelStatus`, `MissionChannel`, `MissionRules`, `MissionTargets`, `MissionSetupRow`, `MissionAggregatorResponse` are defined once in Task 5 (dashboard) and Task 1 (api). The two definitions are byte-identical by design (no shared package — the dashboard package can't import from `apps/api/src`). `buildAlexMissionResponse` input signature is locked at Task 1 and re-used at Task 2's route handler. `useAgentMission`'s return type comes from `MissionAggregatorResponse` — referenced by name in popover (Task 9), empty-state (Task 10), and cockpit-page (Task 12).

**Note on duplicated types:** The slice brief acknowledges this duplication and accepts it for A.2 — promoting the shape to `packages/schemas` is a separate small refactor that doesn't belong in the slice's risk surface. If a future slice (e.g. A.3 metrics extension) needs the same shape, that slice's plan can include the move.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-14-alex-cockpit-a2-implementation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — A fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.
