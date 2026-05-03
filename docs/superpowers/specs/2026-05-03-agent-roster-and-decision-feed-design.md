# Agent Roster + Decision Feed (Slice A) — Design Spec

**Date:** 2026-05-03
**Slice:** A — naming reconciliation + agent registry + **2-source decision feed** (Recommendations + Handoffs)
**Status:** Brainstorm complete + codebase reconciliation pass applied (2026-05-03); awaiting user review before writing-plans.
**Roadmap:** `docs/superpowers/specs/2026-05-03-agent-first-redesign-roadmap.md`
**Launch vertical:** med spa / beauty clinic / dental aesthetic.

---

## 1. Scope

Slice A delivers four foundations the rest of the agent-first redesign builds on:

1. **Naming reconciliation** — the canonical agent names are Alex / Riley / Mira (locked, no more changes). Three places in the code still use stale names; this slice fixes them.
2. **`AGENT_REGISTRY`** — one new file (`packages/schemas/src/agents.ts`) exporting a `const` that is the single source of truth for agent identity, color, slug, and launch tier.
3. **`OrgAgentEnablement` table** — a small new Prisma table recording, per org, which agents are enabled. New table; the 5 existing agent-related tables (`AgentRoster`, `AgentState`, `AgentRegistration`, `AgentListing`, `AgentDeployment`) are deliberately left untouched.
4. **2-source Decision feed** — a unified read endpoint that merges Approvals (recommendations) and Handoffs into one ranked list of `Decision` rows, with per-kind urgency scoring and at-read-time prose composition.

**Codebase reconciliation note (2026-05-03).** The roadmap §1.3 calls out _three_ decision sources (Approvals + Escalations + Handoffs). After auditing the codebase, only two are operator-actionable today:

- `PendingActionRecord` (recommendations) — has `humanSummary`, `presentation`, `act` endpoint at `/api/recommendations/:id/act`.
- `Handoff` table — exposed (confusingly) at `/api/escalations/*`. The route operates on `Handoff` rows, not on `EscalationRecord` rows.
- `EscalationRecord` is **internal telemetry** today: written only by `packages/core/src/skill-runtime/tools/booking-failure-handler.ts`, read only by `apps/api/src/bootstrap/skill-mode.ts` for internal diagnostic skim. It has no act endpoint and is not currently surfaced to operators.

Slice A ships the two-source feed and **defers escalation promotion** to a later slice. The `DecisionKind` union is `"approval" | "handoff"` — escalation will be added when EscalationRecord becomes operator-actionable (its own slice: needs an act endpoint, additional emitter coverage, and operator-facing statuses).

**Out of scope** (per roadmap §9):

- The Decision Card visual UI (Phase B2)
- Wins feed, greeting, metrics, pipeline blocks
- `/reports` (parallel slice)
- Cleanup of the 5 existing agent tables
- **Promotion of `EscalationRecord` to a first-class operator-facing decision kind** (deferred — own slice)

---

## 2. The 7 open questions, locked

| #   | Question                         | Decision                                                                                                                                                                                                                                           |
| --- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `AGENT_REGISTRY` shape           | **B**: `{ key, slug, role, displayName, accent, launchTier }` — no `domain`, no `voiceProfile`, no `capabilities`.                                                                                                                                 |
| 2   | `OrgAgentEnablement` storage     | **A**: new table `OrgAgentEnablement(orgId, agentKey, status, enabledAt)`. The 5 existing tables stay as-is.                                                                                                                                       |
| 3   | Per-org enablement on launch day | **A**: day-one agents only (Alex + Riley). Mira does not appear in nav until day +30 backfill.                                                                                                                                                     |
| 4   | Slug map                         | **A**: kill the existing `SLUG_TO_AGENT` map. URLs are `/[key]` directly (`/alex`, `/riley`, `/mira`). The `slug` field on the registry is kept for forward-compat.                                                                                |
| 5   | Decision-feed adapter shape      | **A**: read-time projection. Adapter generates `humanSummary` + `presentation` for handoffs (which don't store them). Recommendations pass through. No schema migrations on `Handoff`. (Escalation adapter deferred — see §1 reconciliation note.) |
| 6   | Urgency scoring                  | **A**: per-kind scorers each producing 0–100; merge-sort by score desc, tiebreak by `createdAt` asc.                                                                                                                                               |
| 7   | `useAgentFirstNav` flag scope    | **A**: org-level (`Organization.useAgentFirstNav: Boolean`). May move to user-level later.                                                                                                                                                         |

---

## 3. Architecture overview

```
packages/schemas/src/agents.ts          — AGENT_REGISTRY const + AgentKey type + AgentKeySchema
packages/db/prisma/schema.prisma        — + OrgAgentEnablement model
packages/db/src/stores/                  — + prisma-org-agent-enablement-store.ts
packages/core/src/agents/                — + OrgAgentEnablementStore interface
packages/core/src/decisions/             — NEW directory
  ├─ types.ts                            — Decision type (kinds: "approval" | "handoff")
  ├─ urgency.ts                          — two scorers + sort comparator
  ├─ agent-key-resolver.ts               — sourceAgent (string) → AgentKey enum
  ├─ adapters/
  │   ├─ recommendation-adapter.ts
  │   └─ handoff-adapter.ts
  └─ index.ts
apps/api/src/routes/dashboard-agents.ts  — NEW: GET /api/dashboard/agents
apps/api/src/routes/decisions.ts         — NEW: GET /api/dashboard/agents/:key/decisions + GET /api/dashboard/decisions
apps/dashboard/src/hooks/use-decision-feed.ts        — NEW
apps/dashboard/src/lib/decisions/                    — NEW
  ├─ types.ts
  ├─ map-to-decision-card.ts
  └─ dispatch-action.ts
```

Layer placement obeys CLAUDE.md dependency rules: `schemas` (Layer 1) → `core` (Layer 3) → `db` (Layer 4) → `apps/*` (Layer 5).

---

## 4. `AGENT_REGISTRY` (locked: Q1 = B)

**`packages/schemas/src/agents.ts`** (new file):

```ts
import { z } from "zod";

export const AGENT_REGISTRY = {
  alex: {
    key: "alex",
    slug: "alex",
    role: "lead-to-speed",
    displayName: "Alex",
    accent: "hsl(20 90% 55%)", // marketing orange
    launchTier: "day-one",
  },
  riley: {
    key: "riley",
    slug: "riley",
    role: "ad-optimizer",
    displayName: "Riley",
    accent: "hsl(15 45% 50%)", // warm clay
    launchTier: "day-one",
  },
  mira: {
    key: "mira",
    slug: "mira",
    role: "creative",
    displayName: "Mira",
    accent: "hsl(265 30% 35%)", // ink violet
    launchTier: "day-thirty",
  },
} as const;

export type AgentKey = keyof typeof AGENT_REGISTRY;
export type AgentRegistryEntry = (typeof AGENT_REGISTRY)[AgentKey];

export const AGENT_KEYS = Object.keys(AGENT_REGISTRY) as readonly AgentKey[];

export const AgentKeySchema = z.enum(AGENT_KEYS as unknown as [AgentKey, ...AgentKey[]]);

export function getAgent(key: AgentKey): AgentRegistryEntry {
  return AGENT_REGISTRY[key];
}

export function isAgentKey(s: string): s is AgentKey {
  return s in AGENT_REGISTRY;
}
```

Re-exported from `packages/schemas/src/index.ts`. The existing `AgentKeySchema` in `packages/schemas/src/recommendations.ts:25` is removed and replaced by `export { AgentKeySchema, type AgentKey } from "./agents.js"`.

**Adding a fourth agent later** is purely additive: add a row to `AGENT_REGISTRY`, run a one-line backfill INSERT for existing orgs (only if `launchTier === "day-one"`), and add per-agent content (portrait, voice profile, prose tweaks). No schema migration, no Prisma enum expansion, no endpoint changes.

---

## 5. `OrgAgentEnablement` table (locked: Q2 = A)

**Codebase note.** The host org model is `OrganizationConfig` (`packages/db/prisma/schema.prisma:408`), not `Organization`. There is no separate `Organization` table — `OrganizationConfig.id` is the orgId. `OrganizationConfig.purchasedAgents: String[]` exists but its semantics are billing-scoped (which agents an org has paid for); we deliberately add a separate `OrgAgentEnablement` table because _enabled_ and _purchased_ are distinct concerns (an org may have purchased Mira but not be enabled until day +30).

**`packages/db/prisma/schema.prisma`** (new model):

```prisma
model OrgAgentEnablement {
  id          String   @id @default(uuid())
  orgId       String
  agentKey    String   // "alex" | "riley" | "mira" — validated by AgentKeySchema at write time
  status      String   @default("enabled") // enabled | coming_soon | disabled
  enabledAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([orgId, agentKey])
  @@index([orgId])
}
```

**Why `String` not Prisma enum:** Prisma enums require a migration to add a value; the Zod schema (`AgentKeySchema`, derived from `AGENT_REGISTRY`) does the validation at the application boundary. Same pattern as `PendingActionRecord.intent` and `EscalationRecord.priority`.

**Why a new table instead of extending `AgentRoster`:** `AgentRoster.agentRole` carries a 7-value vocabulary (`strategist | monitor | responder | optimizer | booker | guardian | primary_operator`) that does not map 1:1 to Alex / Riley / Mira. The 5 existing agent tables overlap and need a future cleanup; Slice A walks past that swamp by adding one narrow purpose-built table next to it.

**Store interface** in `packages/core/src/agents/org-agent-enablement-store.ts` (new directory, named `agents`):

```ts
import type { AgentKey } from "@switchboard/schemas";

export type EnablementStatus = "enabled" | "coming_soon" | "disabled";

export interface OrgAgentEnablementRow {
  id: string;
  orgId: string;
  agentKey: AgentKey;
  status: EnablementStatus;
  enabledAt: Date;
  updatedAt: Date;
}

export interface OrgAgentEnablementStore {
  list(orgId: string): Promise<OrgAgentEnablementRow[]>;
  enable(orgId: string, agentKey: AgentKey): Promise<OrgAgentEnablementRow>;
  setStatus(orgId: string, agentKey: AgentKey, status: EnablementStatus): Promise<void>;
}
```

Two implementations: `packages/db/src/stores/prisma-org-agent-enablement-store.ts` (production) and `packages/db/src/stores/in-memory-org-agent-enablement-store.ts` (tests, mirroring `in-memory-recommendation-store.ts`).

**Backfill for existing orgs** lives in the same migration file as the schema change. `OrganizationConfig.id` is the orgId:

```sql
INSERT INTO "OrgAgentEnablement" ("id", "orgId", "agentKey", "status", "enabledAt", "updatedAt")
SELECT gen_random_uuid(), "id", agent_key, 'enabled', NOW(), NOW()
FROM "OrganizationConfig", (VALUES ('alex'), ('riley')) AS agents(agent_key)
ON CONFLICT ("orgId", "agentKey") DO NOTHING;
```

**New-org seed:** there is no `OrganizationStore` interface; orgs are created via direct `prisma.organizationConfig.upsert(...)` calls. The implementation plan must locate every org-creation call-site (search `prisma.organizationConfig.upsert` / `.create`) and add a follow-up insert seeding day-one `OrgAgentEnablement` rows. Known sites to audit: `packages/db/prisma/seed.ts:61`, `apps/api/src/routes/organizations.ts:58`. Prefer extracting a small `seedOrgDayOneAgents(prisma, orgId)` helper in `packages/db/src/seed/seed-org-day-one-agents.ts` so all sites share one implementation.

**Read endpoint** `GET /api/dashboard/agents` in new `apps/api/src/routes/dashboard-agents.ts`:

```json
{
  "agents": [
    {
      "key": "alex",
      "slug": "alex",
      "displayName": "Alex",
      "role": "lead-to-speed",
      "accent": "hsl(20 90% 55%)",
      "launchTier": "day-one",
      "status": "enabled",
      "enabledAt": "..."
    },
    { "key": "riley", "...": "...", "status": "enabled" },
    { "key": "mira", "...": "...", "status": "coming_soon", "enabledAt": null }
  ]
}
```

Endpoint logic: resolve `orgId` via existing `requireOrganizationScope`, list rows, merge with `AGENT_REGISTRY` (any registry entry without a row → `status: "coming_soon"`), return ordered by registry insertion order.

---

## 6. The unified `Decision` type (locked: Q5 = A)

**`packages/core/src/decisions/types.ts`**:

```ts
import type { AgentKey } from "@switchboard/schemas";

// Slice A: 2 kinds. "escalation" reserved for a future slice (see §1 reconciliation note).
// When EscalationRecord is promoted to a first-class operator-facing decision, add it here.
export type DecisionKind = "approval" | "handoff";

export interface DecisionPresentation {
  primaryLabel: string;
  secondaryLabel: string;
  dismissLabel: string;
  dataLines: ReadonlyArray<unknown>;
}

export interface Decision {
  id: string; // namespaced: "approval:abc" / "escalation:xyz" / "handoff:def"
  kind: DecisionKind;
  orgId: string;
  agentKey: AgentKey;
  humanSummary: string; // the serif sentence on the card
  presentation: DecisionPresentation;
  urgencyScore: number; // 0..100, computed by per-kind scorer
  createdAt: Date;
  threadHref: string | null; // "View thread →" target; null if no thread
  sourceRef: { kind: DecisionKind; sourceId: string }; // for action dispatch
  meta: {
    contactName?: string;
    slaDeadlineAt?: Date; // handoffs only
    riskLevel?: "low" | "medium" | "high"; // recommendations only
    undoableUntil?: Date; // recommendations only
  };
}
```

**`id` is namespaced** (`"approval:abc"`) so the frontend can use it as a single React key without collision risk between sources.

**`meta` is the small escape hatch** for kind-specific UI bits. If it grows past ~5 fields, split into a discriminated union `kindMeta: ApprovalMeta | EscalationMeta | HandoffMeta`.

---

## 7. The two adapters (locked: Q5 = A)

Both live in `packages/core/src/decisions/adapters/`. Each takes the raw row (plus eager-loaded contact / conversation as needed) and returns a `Decision`.

### 7.1 `recommendation-adapter.ts`

Recs already carry `humanSummary` + `presentation` (stored in `parameters.__recommendation` per existing `emit.ts` pattern). Pass-through:

```ts
export function adaptRecommendation(row: Recommendation): Decision {
  const presentation = extractPresentation(row.parameters);
  return {
    id: `approval:${row.id}`,
    kind: "approval",
    orgId: row.orgId,
    agentKey: row.agentKey,
    humanSummary: row.humanSummary,
    presentation,
    urgencyScore: scoreRecommendation(row),
    createdAt: row.createdAt,
    threadHref: deriveThreadHref(row), // from row.targetEntities.contactId, if present
    sourceRef: { kind: "approval", sourceId: row.id },
    meta: {
      contactName: extractContactName(row.targetEntities),
      riskLevel: row.riskLevel,
      undoableUntil: row.undoableUntil ?? undefined,
    },
  };
}
```

### 7.2 `handoff-adapter.ts`

`Handoff` has no `agentKey` and no prose. Agent attribution is a 2-hop indirect lookup:

```
Handoff.leadId → Contact.id → ConversationThread.contactId → ConversationThread.assignedAgent
```

Each hop is nullable; default-to-Alex if any link is missing.

```ts
export function adaptHandoff(
  row: Handoff,
  contact: Contact | null,
  thread: ConversationThread | null,
): Decision {
  const agentKey = thread?.assignedAgent ? resolveAgentKey(thread.assignedAgent) : "alex";
  return {
    id: `handoff:${row.id}`,
    kind: "handoff",
    orgId: row.organizationId,
    agentKey,
    humanSummary: composeHandoffSummary(row, contact),
    presentation: composeHandoffPresentation(row),
    urgencyScore: scoreHandoff(row),
    createdAt: row.createdAt,
    threadHref: thread ? `/contacts/${contact?.id}/conversations/${thread.id}` : null,
    sourceRef: { kind: "handoff", sourceId: row.id },
    meta: {
      contactName: contact?.name ?? undefined,
      slaDeadlineAt: row.slaDeadlineAt,
    },
  };
}

function composeHandoffSummary(row: Handoff, contact: Contact | null): string {
  const who = contact?.name ?? "A lead";
  switch (row.reason) {
    case "human_requested":
      return `${who} asked to talk to a human about their consultation.`;
    case "max_turns_exceeded":
      return `${who} has been going back and forth — I think you should take this one.`;
    default:
      return `${who} needs a human to take over.`;
  }
}

function composeHandoffPresentation(_row: Handoff): DecisionPresentation {
  return {
    primaryLabel: "Take this one",
    secondaryLabel: "Snooze",
    dismissLabel: "Release back to Alex",
    dataLines: [],
  };
}
```

### 7.3 `agent-key-resolver.ts`

Maps free-form `sourceAgent` / `assignedAgent` strings to enum `AgentKey`:

```ts
import type { AgentKey } from "@switchboard/schemas";

const SOURCE_AGENT_TO_KEY: Record<string, AgentKey> = {
  alex: "alex",
  "lead-specialist": "alex",
  "speed-to-lead": "alex",
  riley: "riley",
  "ad-optimizer": "riley",
  mira: "mira",
  "creative-director": "mira",
};

export function resolveAgentKey(sourceAgent: string | null | undefined): AgentKey {
  if (!sourceAgent) return "alex";
  return SOURCE_AGENT_TO_KEY[sourceAgent.toLowerCase()] ?? "alex";
}
```

Default-to-Alex is deliberate: Alex owns the lead-to-consultation surface where almost all handoffs originate in the launch vertical.

---

## 8. Urgency scoring (locked: Q6 = A)

**`packages/core/src/decisions/urgency.ts`** — two small pure functions, each returning a 0–100 integer. (A `scoreEscalation` function will land alongside the future escalation adapter; the patterns documented here are the template.)

### 8.1 `scoreRecommendation`

```ts
export function scoreRecommendation(row: Recommendation): number {
  // Vertical-tuned: $2k cap reflects med spa / beauty / dental LTV bands.
  const dollarFactor = Math.min(row.dollarsAtRisk / 2000, 1);
  const base = row.confidence * dollarFactor * 100;
  // High-risk floor: never sinks below 60 even if dollar-small / low confidence.
  const riskFloor = { low: 0, medium: 40, high: 60 }[row.riskLevel];
  return Math.round(Math.max(base, riskFloor));
}
```

Tunable: dollar cap (`$2000`) and risk-floor table. Both are inline constants — change in this file, run unit tests, ship.

### 8.2 `scoreHandoff`

```ts
export function scoreHandoff(row: Handoff): number {
  const hoursUntilSla = (row.slaDeadlineAt.getTime() - Date.now()) / 3_600_000;
  if (hoursUntilSla <= 0) return 100;
  if (hoursUntilSla >= 24) return 30;
  return Math.round(100 - (hoursUntilSla / 24) * 70);
}
```

### 8.3 Cross-kind merge

```ts
export const decisionSortComparator = (a: Decision, b: Decision): number => {
  if (b.urgencyScore !== a.urgencyScore) return b.urgencyScore - a.urgencyScore;
  return +a.createdAt - +b.createdAt; // older first as tiebreaker
};
```

### 8.4 Tests

`packages/core/src/decisions/__tests__/urgency.test.ts`:

- One test per scorer (recommendation, handoff) covering each enum value, boundary conditions (0 / max), and edge cases (risk-floor wins, past-SLA peg, 24h+ floor).
- One integration test with 6–8 mixed-kind decisions asserting the final sorted order matches an expected human-triage ordering.
- Tests are pure — no Prisma, no DB. Plain object inputs.

---

## 9. The read endpoint

**`apps/api/src/routes/decisions.ts`** (new):

```
GET /api/dashboard/agents/:key/decisions   — per-agent feed
GET /api/dashboard/decisions               — cross-agent inbox feed
```

Both routes:

```ts
async function listDecisions(
  orgId: string,
  agentKey: AgentKey | null,
): Promise<{
  decisions: Decision[];
  counts: { total: number; approval: number; handoff: number };
}> {
  const [recs, handoffs] = await Promise.all([
    // Only `queue` surface — `shadow_action` recs are auto-applied (no operator approval needed)
    // and `dropped` recs never persist. The decision feed is "things that need a human."
    recommendationStore.listBySurface({ orgId, surface: "queue", status: "pending", limit: 50 }),
    // HandoffStore.listPending(orgId) returns pending handoffs for the org. The existing
    // interface has no status / limit params; if 50+ pending handoffs becomes common,
    // extend the interface in a follow-up.
    handoffStore.listPending(orgId),
  ]);

  // Eager-load for prose composition. Both helpers below are NEW methods Slice A adds:
  //   ContactStore.listByIds(orgId, ids)            — single findMany({ where: { id: { in } } })
  //   ConversationThreadStore.listByContactIds(...) — single findMany({ where: { contactId: { in } } })
  // These avoid N+1 calls in the read path.
  const contactIds = handoffs.map((h) => h.leadId).filter((x): x is string => !!x);
  const contacts = await contactStore.listByIds(orgId, contactIds);
  const threads = await threadStore.listByContactIds(orgId, contactIds);

  const decisions = [
    ...recs.map(adaptRecommendation),
    ...handoffs.map((h) =>
      adaptHandoff(
        h,
        h.leadId ? (contacts.get(h.leadId) ?? null) : null,
        h.leadId ? (threads.get(h.leadId) ?? null) : null,
      ),
    ),
  ];

  const filtered = agentKey ? decisions.filter((d) => d.agentKey === agentKey) : decisions;
  filtered.sort(decisionSortComparator);

  const counts = {
    total: filtered.length,
    approval: filtered.filter((d) => d.kind === "approval").length,
    handoff: filtered.filter((d) => d.kind === "handoff").length,
  };
  return { decisions: filtered, counts };
}
```

Wire response — `Decision.createdAt` and `meta.slaDeadlineAt` / `meta.undoableUntil` serialize to ISO strings. The frontend type mirrors with `string` instead of `Date`.

**Cross-tenant isolation test** required (`apps/api/src/__tests__/api-decisions-isolation.test.ts`), mirroring `api-recommendations-isolation.test.ts`.

**No new act endpoint in Slice A.** Each kind already has its own act route — the frontend dispatches by `decision.sourceRef.kind`. A unified `POST /api/decisions/:id/act` would invent a new contract before B2 reveals what shape it should take — defer. The actual existing routes:

- **Approval** (recommendation): `POST /api/recommendations/:id/act` (body: `{ action: "primary" | "secondary" | "dismiss" | "confirm" | "undo" }`).
- **Handoff**: there is no `/api/handoffs/*` route. Handoff actions are at `POST /api/escalations/:id/reply` (body: `{ message }`) and `POST /api/escalations/:id/resolve` (body: `{ resolutionNote? }`). The route is named "escalations" for legacy reasons but operates on `Handoff` rows (verified at `apps/api/src/routes/escalations.ts:42`, `:170`, `:280`, `:305`).

---

## 10. Frontend hook + view-model

**`apps/dashboard/src/hooks/use-decision-feed.ts`** (new):

```ts
"use client";
import { useQuery } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import type { AgentKey } from "@switchboard/schemas";
import type { Decision } from "@/lib/decisions/types";

interface DecisionFeedResponse {
  decisions: Decision[];
  counts: { total: number; approval: number; handoff: number };
}

async function fetchDecisionFeed(agentKey: AgentKey | null): Promise<DecisionFeedResponse> {
  const url = agentKey ? `/api/dashboard/agents/${agentKey}/decisions` : `/api/dashboard/decisions`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to load decisions");
  return res.json();
}

export function useDecisionFeed(agentKey: AgentKey | null) {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.decisions.feed(agentKey) ?? ["__disabled_decision_feed__"],
    queryFn: () => fetchDecisionFeed(agentKey),
    refetchInterval: 60_000,
    enabled: !!keys,
  });
}

export function useInboxCount(): number {
  const { data } = useDecisionFeed(null);
  return data?.counts.total ?? 0;
}
```

`apps/dashboard/src/lib/query-keys.ts` — extend the `scopedKeys(orgId)` factory with a `decisions` family. (The hook `apps/dashboard/src/hooks/use-query-keys.ts` is a thin `useScopedQueryKeys()` wrapper around this factory; the actual key shapes live in the `lib/query-keys.ts` factory.)

```ts
decisions: {
  all: () => [orgId, "decisions"] as const,
  feed: (agentKey: AgentKey | null) =>
    [orgId, "decisions", "feed", agentKey ?? "all"] as const,
},
```

**`apps/dashboard/src/lib/decisions/types.ts`** — frontend mirror of the wire shape (Date → string):

```ts
import type { AgentKey } from "@switchboard/schemas";

export type DecisionKind = "approval" | "handoff"; // see §1 reconciliation note

export interface DecisionPresentation {
  primaryLabel: string;
  secondaryLabel: string;
  dismissLabel: string;
  dataLines: ReadonlyArray<unknown>;
}

export interface Decision {
  id: string;
  kind: DecisionKind;
  agentKey: AgentKey;
  humanSummary: string;
  presentation: DecisionPresentation;
  urgencyScore: number;
  createdAt: string;
  threadHref: string | null;
  sourceRef: { kind: DecisionKind; sourceId: string };
  meta: {
    contactName?: string;
    slaDeadlineAt?: string;
    riskLevel?: "low" | "medium" | "high";
    undoableUntil?: string;
  };
}
```

**`apps/dashboard/src/lib/decisions/map-to-decision-card.ts`** — view-model bridge to the (Slice B2) Decision Card UI:

```ts
export interface DecisionCardProps {
  folio: { kindLabel: string; rightFolio: string };
  serifSentence: string;
  primaryLabel: string;
  secondaryLabel: string;
  dismissLabel: string;
  threadHref: string | null;
  source: { kind: DecisionKind; sourceId: string };
}

export function mapToDecisionCard(decision: Decision, index: number): DecisionCardProps {
  return {
    folio: {
      kindLabel: `${kindToFolioLabel(decision.kind)} ${index + 1}`,
      rightFolio: composeRightFolio(decision),
    },
    serifSentence: decision.humanSummary,
    primaryLabel: decision.presentation.primaryLabel,
    secondaryLabel: decision.presentation.secondaryLabel,
    dismissLabel: decision.presentation.dismissLabel,
    threadHref: decision.threadHref,
    source: decision.sourceRef,
  };
}
```

**`apps/dashboard/src/lib/decisions/dispatch-action.ts`** — locks the action-dispatch contract for Slice B2 to call:

```ts
// Slice B2 will define richer types for action payloads (e.g. { message } for reply).
// Slice A locks only the dispatch contract — sourceRef.kind drives which existing route to hit.
export async function dispatchDecisionAction(
  source: { kind: DecisionKind; sourceId: string },
  action: "primary" | "secondary" | "dismiss",
  payload?: { message?: string; resolutionNote?: string; note?: string },
): Promise<void> {
  switch (source.kind) {
    case "approval":
      // POST /api/recommendations/:id/act — body: { action: "primary"|"secondary"|"dismiss"|"confirm"|"undo", note? }
      await fetch(`/api/recommendations/${source.sourceId}/act`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: payload?.note }),
      });
      return;
    case "handoff":
      // /api/handoffs/* does NOT exist. Handoff acts go through /api/escalations/:id/{reply|resolve}
      // (legacy naming — the route operates on Handoff rows; see §1 reconciliation note + §9).
      // Action mapping for Slice B2's "Take this one" / "Snooze" / "Mark resolved" pills:
      //   primary    → POST /reply      (body: { message })  — operator takes over with a reply
      //   secondary  → POST /resolve    (body: { resolutionNote? }) with snooze semantics
      //   dismiss    → POST /resolve    (body: { resolutionNote? }) with mark-resolved semantics
      // The reply payload requires a message body; if absent, B2 must surface an inline composer.
      if (action === "primary") {
        await fetch(`/api/escalations/${source.sourceId}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: payload?.message ?? "" }),
        });
      } else {
        await fetch(`/api/escalations/${source.sourceId}/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resolutionNote: payload?.resolutionNote }),
        });
      }
      return;
  }
}
```

**Cache invalidation** — after a successful dispatch, the caller (B2) invalidates `keys.decisions.feed(agentKey)` to refetch. Same pattern as `useEscalations`.

---

## 11. Naming reconciliation (the rename PR)

Stale references and their fix targets:

| File                                                                        | Current                                                                    | Target                                                                   |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `packages/schemas/src/recommendations.ts:25`                                | `AgentKeySchema = z.enum(["nova", "alex", "mira"])`                        | `export { AgentKeySchema, type AgentKey } from "./agents.js"`            |
| `apps/dashboard/src/components/character/agent-mark.tsx:3`                  | `AgentId = "alex" \| "riley" \| "jordan"`                                  | `import type { AgentKey }; type AgentId = AgentKey`                      |
| `apps/dashboard/src/components/character/agent-mark.tsx:6-10`               | `SLUG_TO_AGENT["nurture-specialist"] = "jordan"`                           | Removed entirely (Q4 = A)                                                |
| `apps/dashboard/src/components/character/agent-mark.tsx:12-16`              | `AGENT_DISPLAY_NAMES.jordan = "Jordan"`                                    | Removed; callers use `getAgent(key).displayName`                         |
| `apps/dashboard/src/components/character/agent-mark.tsx:105`                | `function JordanMark()`                                                    | `function MiraMark()` (same SVG body for now; B1 swaps in real portrait) |
| `apps/dashboard/src/components/character/agent-mark.tsx:121`                | `agent === "alex" ? AlexMark : agent === "riley" ? RileyMark : JordanMark` | `... : MiraMark`                                                         |
| `packages/schemas/src/__tests__/recommendations.test.ts`                    | 4× `agentKey: "nova"`                                                      | `agentKey: "alex"`                                                       |
| `packages/core/src/recommendations/__tests__/emit.test.ts`                  | `agentKey: "nova"`                                                         | `agentKey: "alex"`                                                       |
| `packages/core/src/recommendations/__tests__/act.test.ts`                   | 2× `agentKey: "nova"`                                                      | `agentKey: "alex"`                                                       |
| `packages/core/src/recommendations/in-memory-store.ts`                      | (no rename — uses `input.agentKey` generically)                            | (no change)                                                              |
| `packages/core/src/recommendations/emit.ts`                                 | (no rename)                                                                | (no change)                                                              |
| `docs/superpowers/specs/2026-04-29-pricing-and-website-direction-design.md` | `Nova`                                                                     | `Riley`                                                                  |

Importers of `AGENT_DISPLAY_NAMES` and `SLUG_TO_AGENT` outside `agent-mark.tsx` will surface as TypeScript errors after the rename — fix each call site (`getAgent(key).displayName` for the former, direct `key` resolution for the latter).

The escalation-emitter and recommendation-emitter call-sites that pass agent identity already use `agentKey` strings; renaming the enum changes type-validation but not call-site shape. Tests will catch any literal `"nova"` strings still floating around.

---

## 12. `useAgentFirstNav` flag (locked: Q7 = A)

**Codebase note.** The host org model is `OrganizationConfig` (line 408 of `schema.prisma`), not `Organization` — there is no separate `Organization` table.

**`packages/db/prisma/schema.prisma`** — `OrganizationConfig` model gets:

```prisma
useAgentFirstNav Boolean @default(false)
```

A one-column migration. The column default is `false` so **existing** orgs are unaffected (their nav doesn't change just because the column appeared). **New** orgs get `true` set explicitly at the org-creation site (the same `prisma.organizationConfig.upsert(...)` call that's updated to seed `OrgAgentEnablement` day-one rows). This split honors the roadmap §7 rule: "default for new orgs after launch day = true; existing orgs keep old nav until manually migrated."

The launch-day flip for existing orgs is a Phase D5 concern, not Slice A — Slice A only ensures the column exists and that the create-path sets it correctly.

`GET /api/dashboard/organizations` (existing endpoint at `apps/api/src/routes/organizations.ts`) returns the column as part of the org payload. The dashboard reads it where the nav is rendered — though no nav code uses it yet in Slice A; the column existing is the contract.

May move to user-level later (`UserSetting` table) if the dual-coexist period reveals the need.

---

## 13. PR sequencing

Four PRs, each independently shippable:

**PR 1 — Naming reconciliation (~80 line diff).**

- New: `packages/schemas/src/agents.ts`
- Updated: `packages/schemas/src/recommendations.ts:25-26`
- Updated: `apps/dashboard/src/components/character/agent-mark.tsx`
- Updated: `docs/superpowers/specs/2026-04-29-pricing-and-website-direction-design.md` (Nova → Riley)
- Test fixtures updated. `pnpm test && pnpm typecheck` clean.

**PR 2 — `OrgAgentEnablement` table + `useAgentFirstNav` column + read endpoint.**

- New: Prisma model `OrgAgentEnablement` + migration (with backfill SQL).
- New Prisma column: `OrganizationConfig.useAgentFirstNav Boolean @default(false)` (same migration; goes on `OrganizationConfig` per §12 — there is no separate `Organization` model).
- New: `packages/core/src/agents/org-agent-enablement-store.ts` (interface).
- New: `packages/db/src/stores/{prisma,in-memory}-org-agent-enablement-store.ts` (implementations).
- New: `packages/db/src/seed/seed-org-day-one-agents.ts` — small helper invoked at every org-creation site so the seed logic is shared.
- New: `apps/api/src/routes/dashboard-agents.ts`.
- Updated: every `prisma.organizationConfig.upsert(...) / .create(...)` call-site to (a) call `seedOrgDayOneAgents(prisma, orgId)` AND (b) set `useAgentFirstNav: true` for new orgs. Known sites: `packages/db/prisma/seed.ts:61` (dev seed) and `apps/api/src/routes/organizations.ts:58` (signup/upsert path). The implementation plan must do a fresh `grep -rn "prisma.organizationConfig" apps packages` to confirm no other site is missed.
- Updated: `GET /api/dashboard/organizations` payload to include `useAgentFirstNav`.
- Tests: `apps/api/src/__tests__/api-dashboard-agents.test.ts` + cross-tenant isolation.
- Run `pnpm db:check-drift` before commit.

**PR 3 — Decision feed core + endpoint.**

- New: `packages/core/src/decisions/` — `types.ts`, `urgency.ts` (two scorers), `agent-key-resolver.ts`, `adapters/{recommendation-adapter,handoff-adapter}.ts`, `index.ts`.
- New methods on existing stores (Slice A adds these, both single-line `findMany` calls):
  - `ContactStore.listByIds(orgId: string, ids: string[]): Promise<Map<string, Contact>>` in `packages/db/src/stores/prisma-contact-store.ts`.
  - `ConversationThreadStore.listByContactIds(orgId: string, contactIds: string[]): Promise<Map<string, ConversationThread>>` — interface in `packages/core/src/conversations/thread-store.ts`, impl in `packages/db/src/stores/prisma-thread-store.ts`.
- New: `apps/api/src/routes/decisions.ts` — two routes (per-agent + cross-agent).
- Tests: per-adapter (recommendation, handoff), per-scorer, cross-kind merge integration test, cross-tenant isolation (`apps/api/src/__tests__/api-decisions-isolation.test.ts`).

**PR 4 — Frontend wires.**

- New: `apps/dashboard/src/hooks/use-decision-feed.ts`.
- New: `apps/dashboard/src/lib/decisions/{types,map-to-decision-card,dispatch-action}.ts`.
- Updated: `apps/dashboard/src/lib/query-keys.ts` — extend the `scopedKeys(orgId)` factory with a `decisions` family. (The hook `apps/dashboard/src/hooks/use-query-keys.ts` is unchanged; it returns the factory.)
- No backend changes (column + endpoint already shipped in PRs 2 + 3).

PR 1 must merge before PR 2-4 begin (everything else imports from the new registry). PR 2-4 can land in any order; each handles graceful degradation (PR 4's hook returns no data if PR 3's endpoint isn't live yet).

---

## 14. Vertical fit (med spa / beauty clinic / dental aesthetic)

Three Slice A choices depend on launch-vertical assumptions:

**14.1 Handoff prose composer** — the switch in `composeHandoffSummary` (handoff-adapter.ts) keeps the language consultation-flavored (`"asked to talk to a human about their consultation"`) rather than tour-flavored. The vertical's lead-to-handoff path is consultation-driven for aesthetics (Botox / fillers / laser / Invisalign). The reason codes (`human_requested`, `max_turns_exceeded`) are codebase-defined and unchanged; only the surface copy is vertical-tuned.

(When EscalationRecord is promoted in a future slice, its prose composer should mirror this pattern with vertical-flavored branches — `medical_history`, `contraindication_check`, `before_after_request`, `financing_inquiry` — in addition to the generic reasons. Documented here so the future slice doesn't have to re-discover the vocabulary.)

**14.2 Recommendation urgency dollar cap** — `scoreRecommendation` uses `$2000` as the saturation point for `dollarsAtRisk`. Vertical median LTV bands: Botox/fillers $400-1200, hydrafacial / facial treatments $200-500, Invisalign / body contouring $4-8k. $2k captures the "moderately significant call" range without letting one Invisalign rec dominate the feed.

**14.3 Default-fallback agent for unattributed handoffs** — `resolveAgentKey()` defaults to `"alex"` when `sourceAgent` is null/unknown. Correct for this vertical: all day-one human-handoff traffic originates in lead-to-consultation (Alex's surface). Riley's domain is budget-side, not lead-side; Mira's is creative pipeline.

**Serving a different vertical later** (HVAC, legal, B2B SaaS):

- Update the `composeHandoffSummary` switch (and the future `composeEscalationSummary` once that slice ships).
- Re-tune the dollar cap.
- Possibly change the `resolveAgentKey()` default.

All three live in narrow well-named files. No schema migration. No customer-facing data migration.

**Vertical-agnostic by design:** the `Decision` type, the adapter pattern, the urgency scorer's _shape_ (per-kind 0–100 → merge sort), the API contract, the frontend hook, the view-model bridge.

---

## 15. Testing requirements

- **Schema tests** (`packages/schemas/src/__tests__/agents.test.ts`): registry has expected keys; `AgentKeySchema` accepts each key + rejects unknowns; `getAgent` / `isAgentKey` behave.
- **Recommendation rename smoke test:** `agentKey: "nova"` is rejected; `agentKey: "alex" | "riley" | "mira"` accepted.
- **Store tests** (per the project memory note: db tests use mocked Prisma, not real Postgres): `prisma-org-agent-enablement-store.test.ts` mirrors `prisma-workflow-store.test.ts` pattern.
- **Adapter tests**: one per adapter (recommendation, handoff) — happy path + nullable contact / thread / agent attribution.
- **Urgency tests**: per-scorer (recommendation, handoff) enum coverage + cross-kind merge ordering.
- **Store-method tests**: `ContactStore.listByIds` and `ConversationThreadStore.listByContactIds` happy path + empty-input + cross-org-isolation.
- **API tests** (`apps/api/src/__tests__/`): cross-tenant isolation for both new endpoints; happy-path responses match the documented wire shape.
- **Type-check before commit**: `pnpm typecheck` and `pnpm reset` if Prisma client is stale.
- **`pnpm db:check-drift`** required before committing Prisma schema changes (CLAUDE.md).

---

## 16. References

- Roadmap: `docs/superpowers/specs/2026-05-03-agent-first-redesign-roadmap.md`
- Recommendations v1: `docs/superpowers/specs/2026-05-03-recommendations-backend-v1-design.md`
- Pricing direction (will be updated by PR 1): `docs/superpowers/specs/2026-04-29-pricing-and-website-direction-design.md`
- Agent-home design brief (orphan commit `d7f03e7a`, recovered to `/tmp/agent-home-design.md` for context — not on `main`)
- Reports design brief (orphan commit `f28d3dc2`, recovered to `/tmp/reports-design.md` for context — not on `main`)
- CLAUDE.md — project instructions and dependency rules
- Project memory:
  - `[Recommendations v1 shipped, surface-agnostic]` — PRs #356/#357
  - `[Two-register design split]` — editorial vs Mercury
  - `[Surface-agnostic backend]` — core/schemas/db/ad-optimizer must not reference UI surfaces
  - `[db tests use mocked Prisma, not real Postgres]` — testing pattern
- Stashed-but-not-on-main commits worth landing as a side PR (one option):
  - `d7f03e7a` — agent-home design rename (Marcus → Mira)
  - `f28d3dc2` — `/reports` design brief
  - `b4f5b25b` — Riley agent home brief
  - `1fcc4093` — Riley responsive + header iconography patch
  - `d05783b7` — agent rename (jess → Riley)
  - `011bb2c4` — editorial-modern hybrid + Tools tier
