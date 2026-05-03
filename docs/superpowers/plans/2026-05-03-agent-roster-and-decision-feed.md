# Agent Roster + Decision Feed (Slice A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the foundational backend for the agent-first redesign — naming reconciliation, an `AGENT_REGISTRY` const, an `OrgAgentEnablement` table, a 2-source Decision Feed (Recommendations + Handoffs), and the matching frontend hook + view-model bridge.

**Architecture:** Per `docs/superpowers/specs/2026-05-03-agent-roster-and-decision-feed-design.md`. Four PRs, each independently shippable: (1) renames + registry, (2) enablement table + `useAgentFirstNav` column + read endpoint, (3) Decision Feed core + endpoint, (4) frontend wires.

**Tech Stack:** TypeScript, pnpm + Turborepo, Prisma (Postgres), Fastify, Vitest, Next.js 14 + TanStack React Query, Zod.

**Vertical:** med spa / beauty clinic / dental aesthetic (affects prose composer copy + recommendation dollar cap).

**Locked decisions** (from spec §2): all 7 §8 questions answered B/A/A/A/A/A/A. `DecisionKind = "approval" | "handoff"` (escalation deferred). Host org table is `OrganizationConfig` (no `Organization`).

---

## Pre-flight checks

Before starting Task 1, verify the working state:

- [ ] **Step 1: Confirm branch + worktree state**

```bash
git branch --show-current
git status --short
```

Expected branch: `docs/agent-first-redesign-roadmap` or a fresh worktree branch off `main`. Working tree clean.

- [ ] **Step 2: Build the world to confirm a green starting state**

```bash
pnpm install && pnpm reset && pnpm typecheck && pnpm test
```

`pnpm reset` is required because the rename in PR 1 changes generated artifacts under `packages/schemas/dist`. Expected: all green. If broken, stop and diagnose before proceeding.

---

# PR 1 — Naming reconciliation + AGENT_REGISTRY

**Branch:** create `feat/agent-registry` off `main` (or current working branch).
**Diff target:** ~80 lines net.
**Outcome:** `packages/schemas/src/agents.ts` is the single source of truth; `nova` and `jordan` no longer appear in code.

---

### Task 1.1: Create `packages/schemas/src/agents.ts`

**Files:**

- Create: `packages/schemas/src/agents.ts`
- Create: `packages/schemas/src/__tests__/agents.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/schemas/src/__tests__/agents.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AGENT_REGISTRY, AGENT_KEYS, AgentKeySchema, getAgent, isAgentKey } from "../agents.js";

describe("AGENT_REGISTRY", () => {
  it("contains exactly alex / riley / mira", () => {
    expect(AGENT_KEYS).toEqual(["alex", "riley", "mira"]);
  });

  it("alex is day-one with marketing orange accent", () => {
    expect(AGENT_REGISTRY.alex.displayName).toBe("Alex");
    expect(AGENT_REGISTRY.alex.role).toBe("lead-to-speed");
    expect(AGENT_REGISTRY.alex.launchTier).toBe("day-one");
    expect(AGENT_REGISTRY.alex.accent).toMatch(/^hsl\(/);
    expect(AGENT_REGISTRY.alex.slug).toBe("alex");
  });

  it("riley is day-one with warm clay accent", () => {
    expect(AGENT_REGISTRY.riley.displayName).toBe("Riley");
    expect(AGENT_REGISTRY.riley.role).toBe("ad-optimizer");
    expect(AGENT_REGISTRY.riley.launchTier).toBe("day-one");
  });

  it("mira is day-thirty (deferred)", () => {
    expect(AGENT_REGISTRY.mira.displayName).toBe("Mira");
    expect(AGENT_REGISTRY.mira.role).toBe("creative");
    expect(AGENT_REGISTRY.mira.launchTier).toBe("day-thirty");
  });

  it("slug equals key for every agent (Q4 = A)", () => {
    for (const key of AGENT_KEYS) {
      expect(AGENT_REGISTRY[key].slug).toBe(key);
    }
  });
});

describe("AgentKeySchema", () => {
  it("accepts each registry key", () => {
    for (const key of AGENT_KEYS) {
      expect(AgentKeySchema.safeParse(key).success).toBe(true);
    }
  });

  it("rejects stale names nova and jordan", () => {
    expect(AgentKeySchema.safeParse("nova").success).toBe(false);
    expect(AgentKeySchema.safeParse("jordan").success).toBe(false);
  });

  it("rejects unknown keys", () => {
    expect(AgentKeySchema.safeParse("zoe").success).toBe(false);
    expect(AgentKeySchema.safeParse("").success).toBe(false);
  });
});

describe("getAgent / isAgentKey", () => {
  it("getAgent returns the registry entry", () => {
    expect(getAgent("alex")).toBe(AGENT_REGISTRY.alex);
  });

  it("isAgentKey is a type guard", () => {
    expect(isAgentKey("alex")).toBe(true);
    expect(isAgentKey("nova")).toBe(false);
    expect(isAgentKey("")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/schemas test agents.test
```

Expected: FAIL — `Cannot find module '../agents.js'`.

- [ ] **Step 3: Create the registry file**

Create `packages/schemas/src/agents.ts`:

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

// Derived from AGENT_REGISTRY — adding a new agent to the const auto-extends
// validation. Do NOT maintain a parallel list.
export const AgentKeySchema = z.enum(AGENT_KEYS as unknown as [AgentKey, ...AgentKey[]]);

export function getAgent(key: AgentKey): AgentRegistryEntry {
  return AGENT_REGISTRY[key];
}

export function isAgentKey(s: string): s is AgentKey {
  return Object.prototype.hasOwnProperty.call(AGENT_REGISTRY, s);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/schemas test agents.test
```

Expected: PASS — all 11 assertions green.

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/agents.ts packages/schemas/src/__tests__/agents.test.ts
git commit -m "feat(schemas): add AGENT_REGISTRY const + AgentKeySchema (Slice A foundation)"
```

---

### Task 1.2: Re-export AgentKey/AgentKeySchema from `recommendations.ts`

**Files:**

- Modify: `packages/schemas/src/recommendations.ts:25-26`

- [ ] **Step 1: Replace the inline enum with a re-export**

In `packages/schemas/src/recommendations.ts`, replace lines 25-26:

```diff
- export const AgentKeySchema = z.enum(["nova", "alex", "mira"]);
- export type AgentKey = z.infer<typeof AgentKeySchema>;
+ export { AgentKeySchema, type AgentKey } from "./agents.js";
```

- [ ] **Step 2: Run schemas tests to confirm the re-export resolves**

```bash
pnpm --filter @switchboard/schemas test
```

Expected: existing fixtures using `agentKey: "nova"` will FAIL (they're stale). That's intentional — the fixture rename happens in Task 1.3.

- [ ] **Step 3: Do NOT commit yet** — the package is in a broken state until Task 1.3 fixes the fixtures. Hold the diff in the working tree.

---

### Task 1.3: Update test fixtures (replace `nova` → `alex`)

**Files:**

- Modify: `packages/schemas/src/__tests__/recommendations.test.ts` — 4 `agentKey: "nova"` occurrences (lines 74, 95, 111, 127 per the spec; verify with grep)
- Modify: `packages/core/src/recommendations/__tests__/emit.test.ts` — 1 occurrence
- Modify: `packages/core/src/recommendations/__tests__/act.test.ts` — 2 occurrences (lines 9, 30)
- Modify: `apps/api/src/__tests__/api-recommendations.test.ts:21` — 1 occurrence (`agentKey: "nova"` in `seedRecommendation` fixture)
- Modify: `apps/api/src/__tests__/api-recommendations-isolation.test.ts` — verify with grep, replace any `"nova"`

- [ ] **Step 1: Find every fixture occurrence**

```bash
grep -rn 'agentKey: "nova"' packages/ apps/ 2>/dev/null | grep -v dist
```

- [ ] **Step 2: Replace each occurrence**

For each match, replace `agentKey: "nova"` with `agentKey: "alex"`. The `"rejects unknown agentKey"` test in `recommendations.test.ts:107-112` already uses `"zoe"` as the unknown — leave that test unchanged (it still passes because `"zoe"` remains unknown).

- [ ] **Step 3: Run all tests across schemas + core + api**

```bash
pnpm --filter @switchboard/schemas test
pnpm --filter @switchboard/core test
pnpm --filter @switchboard/api test
```

Expected: all green. If any test still mentions `"nova"`, fix it now. If `agentKey: "jordan"` shows up anywhere, replace with `"mira"`.

- [ ] **Step 4: Commit**

```bash
git add packages/schemas/src/recommendations.ts \
        packages/schemas/src/__tests__/recommendations.test.ts \
        packages/core/src/recommendations/__tests__/emit.test.ts \
        packages/core/src/recommendations/__tests__/act.test.ts \
        apps/api/src/__tests__/api-recommendations.test.ts \
        apps/api/src/__tests__/api-recommendations-isolation.test.ts
git commit -m "refactor(schemas): re-export AgentKey from agents.ts; rename nova→alex in fixtures"
```

---

### Task 1.4: Wire `agents.ts` into the schemas barrel export

**Files:**

- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Add the export line**

The schemas barrel uses `export * from "./<file>.js"`. Add the new line in alphabetical position (after `./agent-types.js`):

```diff
  export * from "./principals.js";
+ export * from "./agents.js";
  export * from "./agent-types.js";
```

- [ ] **Step 2: Verify other packages can import from `@switchboard/schemas`**

```bash
pnpm --filter @switchboard/schemas build
pnpm --filter @switchboard/core typecheck
```

Expected: green. The core package now resolves `import { AgentKey } from "@switchboard/schemas"` via the new barrel line.

- [ ] **Step 3: Commit**

```bash
git add packages/schemas/src/index.ts
git commit -m "chore(schemas): export agents.ts from package barrel"
```

---

### Task 1.5: Update `agent-mark.tsx` (rename Jordan → Mira; kill SLUG_TO_AGENT + AGENT_DISPLAY_NAMES)

**Files:**

- Modify: `apps/dashboard/src/components/character/agent-mark.tsx`

- [ ] **Step 1: Find every importer of `AGENT_DISPLAY_NAMES` and `SLUG_TO_AGENT`**

```bash
grep -rn "AGENT_DISPLAY_NAMES\|SLUG_TO_AGENT" apps/dashboard/src 2>/dev/null
```

Note the call-sites — Step 4 below has to update them.

- [ ] **Step 2: Rewrite `agent-mark.tsx`**

Replace the file contents:

```tsx
import { cn } from "@/lib/utils";
import { type AgentKey, getAgent } from "@switchboard/schemas";

export type AgentId = AgentKey;
export type AgentMarkSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE_PX: Record<AgentMarkSize, number> = {
  xs: 24,
  sm: 40,
  md: 64,
  lg: 120,
  xl: 160,
};

interface AgentMarkProps {
  agent: AgentId;
  size?: AgentMarkSize;
  className?: string;
  monochrome?: boolean;
}

// Display name lookup helper for any caller that previously read AGENT_DISPLAY_NAMES.
export function agentDisplayName(key: AgentKey): string {
  return getAgent(key).displayName;
}

// ── Alex — Lead-to-Speed ──
// Visual: alert, scanning. Motif: signal / radar lines.
function AlexMark() {
  return (
    <>
      <circle cx="28" cy="18" r="10" fill="currentColor" />
      <path d="M 17 31 L 40 31 L 37 57 L 20 57 Z" fill="currentColor" />
      <line
        x1="40"
        y1="13"
        x2="47"
        y2="8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.45"
      />
      <line
        x1="42"
        y1="18"
        x2="50"
        y2="18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.45"
      />
      <line
        x1="40"
        y1="23"
        x2="47"
        y2="28"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.45"
      />
    </>
  );
}

// ── Riley — Ad Optimizer ──
// Visual: grounded, forward-moving. Motif: arrow / momentum.
function RileyMark() {
  return (
    <>
      <circle cx="32" cy="18" r="10" fill="currentColor" />
      <rect x="22" y="31" width="20" height="26" rx="2" fill="currentColor" />
      <polyline
        points="46,46 54,51 46,56"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.45"
      />
    </>
  );
}

// ── Mira — Creative ──
// Visual: open, generative. Motif: orbit / loop.
// NOTE: Slice A keeps the existing wave-loop SVG body (was Jordan's). Slice B1
// will swap in the proper portrait per the agent-home brief §9 portrait spec.
function MiraMark() {
  return (
    <>
      <circle cx="32" cy="17" r="11" fill="currentColor" />
      <path
        d="M 18 31 C 14 39 15 51 20 56 Q 26 60 32 57 Q 38 60 44 56 C 49 51 50 39 46 31 Z"
        fill="currentColor"
      />
    </>
  );
}

export function AgentMark({ agent, size = "md", className, monochrome = false }: AgentMarkProps) {
  const px = SIZE_PX[size];
  const Mark = agent === "alex" ? AlexMark : agent === "riley" ? RileyMark : MiraMark;

  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn(className)}
      style={{
        color: monochrome ? "#1A1714" : "var(--sw-text-secondary, #6B6560)",
        flexShrink: 0,
      }}
    >
      <Mark />
    </svg>
  );
}
```

- [ ] **Step 3: Update each importer of `AGENT_DISPLAY_NAMES`**

For every match found in Step 1, replace `AGENT_DISPLAY_NAMES[key]` with `agentDisplayName(key)` (or directly `getAgent(key).displayName` if you prefer). For every match of `SLUG_TO_AGENT[slug]`, replace with `isAgentKey(slug) ? slug : null` (URL slug now equals key).

- [ ] **Step 4: Run dashboard typecheck**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: green. Any leftover `"jordan"` literal will surface as a TypeScript error against the new `AgentKey` type — fix each.

- [ ] **Step 5: Run dashboard tests**

```bash
pnpm --filter @switchboard/dashboard test
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/character/agent-mark.tsx
# Plus any updated importer files from Step 3
git commit -m "refactor(dashboard): agent-mark uses AGENT_REGISTRY (Jordan→Mira; drop slug map)"
```

---

### Task 1.6: Rename Nova → Riley in the pricing design doc

**Files:**

- Modify: `docs/superpowers/specs/2026-04-29-pricing-and-website-direction-design.md`

- [ ] **Step 1: Find every Nova mention**

```bash
grep -n "Nova\|nova" docs/superpowers/specs/2026-04-29-pricing-and-website-direction-design.md
```

- [ ] **Step 2: Replace `Nova` → `Riley` (case-preserving where applicable)**

Use a careful find/replace. `Mira` is already correct in this doc — leave it.

- [ ] **Step 3: Spot-check the result**

```bash
grep -nE "Nova|nova" docs/superpowers/specs/2026-04-29-pricing-and-website-direction-design.md
```

Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-04-29-pricing-and-website-direction-design.md
git commit -m "docs(pricing): rename Nova → Riley to match locked agent names"
```

---

### Task 1.7: Final PR 1 verification

- [ ] **Step 1: Full-repo typecheck + test sweep**

```bash
pnpm typecheck && pnpm test
```

Expected: all green.

- [ ] **Step 2: Confirm no stale names remain**

```bash
grep -rnE '"(nova|jordan|Nova|Jordan)"' packages/ apps/ docs/ 2>/dev/null | grep -v dist | grep -v node_modules
```

Expected: empty (or only false positives in unrelated contexts — review each).

- [ ] **Step 3: Push the branch + open PR 1**

```bash
git push -u origin feat/agent-registry
gh pr create --title "feat(schemas): AGENT_REGISTRY + naming reconciliation (Slice A PR 1)" --body "$(cat <<'EOF'
## Summary

PR 1 of 4 for Slice A. Establishes `AGENT_REGISTRY` as the single source of truth for agent identity and reconciles all stale names (Nova, Jordan) across the codebase.

- New file: `packages/schemas/src/agents.ts` — registry const, `AgentKey` type, `AgentKeySchema` (derived from registry), `getAgent` / `isAgentKey` helpers.
- `packages/schemas/src/recommendations.ts` re-exports AgentKey from `agents.ts` (kills the parallel `["nova","alex","mira"]` enum).
- `apps/dashboard/src/components/character/agent-mark.tsx` rewired to read from `AGENT_REGISTRY` (Jordan SVG renamed to Mira; `SLUG_TO_AGENT` and `AGENT_DISPLAY_NAMES` removed).
- Test fixtures replaced: `agentKey: "nova"` → `agentKey: "alex"` across schemas/core/api.
- Pricing design doc: `Nova` → `Riley`.

Spec: `docs/superpowers/specs/2026-05-03-agent-roster-and-decision-feed-design.md`

## Test plan

- [ ] `pnpm typecheck` green
- [ ] `pnpm test` green
- [ ] No stale `"nova" | "jordan"` agentKey strings anywhere in `packages/` or `apps/`
- [ ] `agent-mark.tsx` renders Mira correctly in the dashboard

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

PR 1 is shippable on its own. Wait for review/merge before starting PR 2 to keep the dependency graph clean.

---

# PR 2 — `OrgAgentEnablement` table + `useAgentFirstNav` column + `GET /api/dashboard/agents`

**Branch:** `feat/org-agent-enablement` off `main` (after PR 1 merges).
**Outcome:** every org has explicit per-agent enablement rows. Dashboard can ask the API "which agents does this org have?"

---

### Task 2.1: Add Prisma model + column + migration

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (line 408 area for `OrganizationConfig`; add new model below)

- [ ] **Step 1: Add `useAgentFirstNav` to `OrganizationConfig`**

In `packages/db/prisma/schema.prisma`, inside the `OrganizationConfig` model (line 408), add the column after `entitlementOverride`:

```prisma
  useAgentFirstNav     Boolean         @default(false)
```

- [ ] **Step 2: Add the new `OrgAgentEnablement` model**

Append after `OrganizationConfig` (before `WebhookEventLog`):

```prisma
// ── Agent-First Redesign: per-org agent enablement ──
// Slice A — see docs/superpowers/specs/2026-05-03-agent-roster-and-decision-feed-design.md
// agentKey is intentionally String (not enum) — validated by AgentKeySchema at write time.
model OrgAgentEnablement {
  id        String   @id @default(uuid())
  orgId     String
  agentKey  String   // "alex" | "riley" | "mira"
  status    String   @default("enabled") // enabled | coming_soon | disabled
  enabledAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([orgId, agentKey])
  @@index([orgId])
}
```

- [ ] **Step 3: Generate the migration**

```bash
pnpm --filter @switchboard/db exec prisma migrate dev --create-only --name add_org_agent_enablement
```

Expected: a new directory under `packages/db/prisma/migrations/<timestamp>_add_org_agent_enablement/` containing `migration.sql`.

- [ ] **Step 4: Append the backfill SQL to the generated migration**

Open the generated `migration.sql` and append:

```sql
-- Backfill: enable Alex + Riley for every existing OrganizationConfig.
-- Mira intentionally not seeded (launchTier = day-thirty per AGENT_REGISTRY).
INSERT INTO "OrgAgentEnablement" ("id", "orgId", "agentKey", "status", "enabledAt", "updatedAt")
SELECT gen_random_uuid(), oc.id, agent_key, 'enabled', NOW(), NOW()
FROM "OrganizationConfig" oc, (VALUES ('alex'), ('riley')) AS agents(agent_key)
ON CONFLICT ("orgId", "agentKey") DO NOTHING;
```

- [ ] **Step 5: Apply the migration + regenerate the Prisma client**

```bash
pnpm --filter @switchboard/db exec prisma migrate deploy
pnpm --filter @switchboard/db exec prisma generate
```

If you don't have a local Postgres, use `prisma migrate dev` instead (which applies + generates in one step). Per `CLAUDE.md`, run `pnpm db:check-drift` to confirm schema-vs-migration alignment.

- [ ] **Step 6: Build the world**

```bash
pnpm reset && pnpm typecheck
```

Expected: green. The new Prisma types are now available (`prisma.orgAgentEnablement.*`).

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): add OrgAgentEnablement model + OrganizationConfig.useAgentFirstNav (Slice A PR 2)"
```

---

### Task 2.2: Define `OrgAgentEnablementStore` interface in core

**Files:**

- Create: `packages/core/src/agents/org-agent-enablement-store.ts`
- Create: `packages/core/src/agents/index.ts`

- [ ] **Step 1: Create the interface file**

Create `packages/core/src/agents/org-agent-enablement-store.ts`:

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

- [ ] **Step 2: Create the directory's barrel**

Create `packages/core/src/agents/index.ts`:

```ts
export type {
  EnablementStatus,
  OrgAgentEnablementRow,
  OrgAgentEnablementStore,
} from "./org-agent-enablement-store.js";
```

- [ ] **Step 3: Re-export from the core package barrel**

Open `packages/core/src/index.ts` and add:

```ts
export * from "./agents/index.js";
```

- [ ] **Step 4: Typecheck core**

```bash
pnpm --filter @switchboard/core typecheck
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agents/ packages/core/src/index.ts
git commit -m "feat(core): add OrgAgentEnablementStore interface"
```

---

### Task 2.3: Implement in-memory store

**Files:**

- Create: `packages/db/src/stores/in-memory-org-agent-enablement-store.ts`
- Create: `packages/db/src/stores/__tests__/in-memory-org-agent-enablement-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/stores/__tests__/in-memory-org-agent-enablement-store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createInMemoryOrgAgentEnablementStore } from "../in-memory-org-agent-enablement-store.js";

describe("InMemoryOrgAgentEnablementStore", () => {
  it("starts empty", async () => {
    const store = createInMemoryOrgAgentEnablementStore();
    expect(await store.list("org-1")).toEqual([]);
  });

  it("enable upserts a row with status='enabled' and timestamps", async () => {
    const store = createInMemoryOrgAgentEnablementStore();
    const row = await store.enable("org-1", "alex");
    expect(row.orgId).toBe("org-1");
    expect(row.agentKey).toBe("alex");
    expect(row.status).toBe("enabled");
    expect(row.enabledAt).toBeInstanceOf(Date);
  });

  it("enable is idempotent on (orgId, agentKey)", async () => {
    const store = createInMemoryOrgAgentEnablementStore();
    const a = await store.enable("org-1", "alex");
    const b = await store.enable("org-1", "alex");
    expect(b.id).toBe(a.id);
    expect((await store.list("org-1")).length).toBe(1);
  });

  it("list scopes by orgId", async () => {
    const store = createInMemoryOrgAgentEnablementStore();
    await store.enable("org-1", "alex");
    await store.enable("org-2", "riley");
    expect(await store.list("org-1")).toHaveLength(1);
    expect((await store.list("org-1"))[0]!.agentKey).toBe("alex");
    expect(await store.list("org-2")).toHaveLength(1);
  });

  it("setStatus updates an existing row", async () => {
    const store = createInMemoryOrgAgentEnablementStore();
    await store.enable("org-1", "mira");
    await store.setStatus("org-1", "mira", "disabled");
    const rows = await store.list("org-1");
    expect(rows[0]!.status).toBe("disabled");
  });

  it("setStatus is a no-op if no row exists", async () => {
    const store = createInMemoryOrgAgentEnablementStore();
    await expect(store.setStatus("org-1", "mira", "disabled")).resolves.toBeUndefined();
    expect(await store.list("org-1")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/db test in-memory-org-agent-enablement-store
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

Create `packages/db/src/stores/in-memory-org-agent-enablement-store.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { AgentKey } from "@switchboard/schemas";
import type {
  EnablementStatus,
  OrgAgentEnablementRow,
  OrgAgentEnablementStore,
} from "@switchboard/core";

interface Mutable extends OrgAgentEnablementRow {}

export function createInMemoryOrgAgentEnablementStore(): OrgAgentEnablementStore {
  const rows: Mutable[] = [];

  function find(orgId: string, agentKey: AgentKey): Mutable | undefined {
    return rows.find((r) => r.orgId === orgId && r.agentKey === agentKey);
  }

  return {
    async list(orgId) {
      return rows.filter((r) => r.orgId === orgId).map((r) => ({ ...r }));
    },
    async enable(orgId, agentKey) {
      const existing = find(orgId, agentKey);
      if (existing) {
        existing.status = "enabled";
        existing.updatedAt = new Date();
        return { ...existing };
      }
      const now = new Date();
      const row: Mutable = {
        id: randomUUID(),
        orgId,
        agentKey,
        status: "enabled" as EnablementStatus,
        enabledAt: now,
        updatedAt: now,
      };
      rows.push(row);
      return { ...row };
    },
    async setStatus(orgId, agentKey, status) {
      const existing = find(orgId, agentKey);
      if (!existing) return;
      existing.status = status;
      existing.updatedAt = new Date();
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/db test in-memory-org-agent-enablement-store
```

Expected: PASS — all 6 assertions green.

- [ ] **Step 5: Export from db barrel**

Open `packages/db/src/index.ts` and add:

```ts
export { createInMemoryOrgAgentEnablementStore } from "./stores/in-memory-org-agent-enablement-store.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/stores/in-memory-org-agent-enablement-store.ts \
        packages/db/src/stores/__tests__/in-memory-org-agent-enablement-store.test.ts \
        packages/db/src/index.ts
git commit -m "feat(db): in-memory OrgAgentEnablementStore implementation"
```

---

### Task 2.4: Implement Prisma store

**Files:**

- Create: `packages/db/src/stores/prisma-org-agent-enablement-store.ts`
- Create: `packages/db/src/stores/__tests__/prisma-org-agent-enablement-store.test.ts`

- [ ] **Step 1: Write the failing tests using mocked Prisma**

Per project memory: db tests use mocked Prisma, mirroring `prisma-workflow-store.test.ts`. Create `packages/db/src/stores/__tests__/prisma-org-agent-enablement-store.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { PrismaOrgAgentEnablementStore } from "../prisma-org-agent-enablement-store.js";

function mockPrisma() {
  return {
    orgAgentEnablement: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe("PrismaOrgAgentEnablementStore", () => {
  it("list calls findMany with orgId filter and orderBy enabledAt asc", async () => {
    const prisma = mockPrisma();
    (prisma.orgAgentEnablement.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "row-1",
        orgId: "org-1",
        agentKey: "alex",
        status: "enabled",
        enabledAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      },
    ]);
    const store = new PrismaOrgAgentEnablementStore(prisma);
    const rows = await store.list("org-1");
    expect(prisma.orgAgentEnablement.findMany).toHaveBeenCalledWith({
      where: { orgId: "org-1" },
      orderBy: { enabledAt: "asc" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.agentKey).toBe("alex");
  });

  it("enable calls upsert keyed on (orgId, agentKey)", async () => {
    const prisma = mockPrisma();
    (prisma.orgAgentEnablement.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "row-1",
      orgId: "org-1",
      agentKey: "riley",
      status: "enabled",
      enabledAt: new Date(),
      updatedAt: new Date(),
    });
    const store = new PrismaOrgAgentEnablementStore(prisma);
    await store.enable("org-1", "riley");
    expect(prisma.orgAgentEnablement.upsert).toHaveBeenCalledWith({
      where: { orgId_agentKey: { orgId: "org-1", agentKey: "riley" } },
      create: expect.objectContaining({
        orgId: "org-1",
        agentKey: "riley",
        status: "enabled",
      }),
      update: { status: "enabled" },
    });
  });

  it("setStatus calls update keyed on (orgId, agentKey)", async () => {
    const prisma = mockPrisma();
    (prisma.orgAgentEnablement.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const store = new PrismaOrgAgentEnablementStore(prisma);
    await store.setStatus("org-1", "mira", "disabled");
    expect(prisma.orgAgentEnablement.update).toHaveBeenCalledWith({
      where: { orgId_agentKey: { orgId: "org-1", agentKey: "mira" } },
      data: { status: "disabled" },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/db test prisma-org-agent-enablement-store
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the Prisma store**

Create `packages/db/src/stores/prisma-org-agent-enablement-store.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import type { AgentKey } from "@switchboard/schemas";
import type {
  EnablementStatus,
  OrgAgentEnablementRow,
  OrgAgentEnablementStore,
} from "@switchboard/core";

export class PrismaOrgAgentEnablementStore implements OrgAgentEnablementStore {
  constructor(private prisma: PrismaClient) {}

  async list(orgId: string): Promise<OrgAgentEnablementRow[]> {
    const rows = await this.prisma.orgAgentEnablement.findMany({
      where: { orgId },
      orderBy: { enabledAt: "asc" },
    });
    return rows.map(toRow);
  }

  async enable(orgId: string, agentKey: AgentKey): Promise<OrgAgentEnablementRow> {
    const row = await this.prisma.orgAgentEnablement.upsert({
      where: { orgId_agentKey: { orgId, agentKey } },
      create: { orgId, agentKey, status: "enabled" },
      update: { status: "enabled" },
    });
    return toRow(row);
  }

  async setStatus(orgId: string, agentKey: AgentKey, status: EnablementStatus): Promise<void> {
    await this.prisma.orgAgentEnablement.update({
      where: { orgId_agentKey: { orgId, agentKey } },
      data: { status },
    });
  }
}

function toRow(row: {
  id: string;
  orgId: string;
  agentKey: string;
  status: string;
  enabledAt: Date;
  updatedAt: Date;
}): OrgAgentEnablementRow {
  return {
    id: row.id,
    orgId: row.orgId,
    agentKey: row.agentKey as AgentKey,
    status: row.status as EnablementStatus,
    enabledAt: row.enabledAt,
    updatedAt: row.updatedAt,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/db test prisma-org-agent-enablement-store
```

Expected: PASS — all 3 assertions green.

- [ ] **Step 5: Export from db barrel**

Append to `packages/db/src/index.ts`:

```ts
export { PrismaOrgAgentEnablementStore } from "./stores/prisma-org-agent-enablement-store.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/stores/prisma-org-agent-enablement-store.ts \
        packages/db/src/stores/__tests__/prisma-org-agent-enablement-store.test.ts \
        packages/db/src/index.ts
git commit -m "feat(db): Prisma OrgAgentEnablementStore implementation"
```

---

### Task 2.5: Create the day-one-agents seed helper

**Files:**

- Create: `packages/db/src/seed/seed-org-day-one-agents.ts`
- Create: `packages/db/src/seed/__tests__/seed-org-day-one-agents.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/seed/__tests__/seed-org-day-one-agents.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { seedOrgDayOneAgents } from "../seed-org-day-one-agents.js";

function mockPrisma() {
  return {
    orgAgentEnablement: {
      upsert: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient;
}

describe("seedOrgDayOneAgents", () => {
  it("upserts an enabled row for each day-one agent (Alex + Riley)", async () => {
    const prisma = mockPrisma();
    await seedOrgDayOneAgents(prisma, "org-new");
    const calls = (prisma.orgAgentEnablement.upsert as ReturnType<typeof vi.fn>).mock.calls;
    const seededKeys = calls.map((c) => c[0].where.orgId_agentKey.agentKey).sort();
    expect(seededKeys).toEqual(["alex", "riley"]);
  });

  it("does NOT seed Mira (launchTier=day-thirty)", async () => {
    const prisma = mockPrisma();
    await seedOrgDayOneAgents(prisma, "org-new");
    const calls = (prisma.orgAgentEnablement.upsert as ReturnType<typeof vi.fn>).mock.calls;
    const seededKeys = calls.map((c) => c[0].where.orgId_agentKey.agentKey);
    expect(seededKeys).not.toContain("mira");
  });

  it("is idempotent — re-running for the same org does not throw", async () => {
    const prisma = mockPrisma();
    await seedOrgDayOneAgents(prisma, "org-new");
    await expect(seedOrgDayOneAgents(prisma, "org-new")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/db test seed-org-day-one-agents
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `packages/db/src/seed/seed-org-day-one-agents.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { AGENT_REGISTRY, type AgentKey } from "@switchboard/schemas";

/**
 * Seeds OrgAgentEnablement rows for every day-one agent for a freshly created org.
 * Idempotent — safe to call multiple times. Mira (day-thirty) is intentionally
 * not seeded; she's enabled in a follow-up backfill 30 days post-launch.
 *
 * Call this from every site that creates an OrganizationConfig:
 *   - packages/db/prisma/seed.ts (dev seed)
 *   - apps/api/src/routes/organizations.ts (signup/upsert path)
 */
export async function seedOrgDayOneAgents(prisma: PrismaClient, orgId: string): Promise<void> {
  const dayOneKeys = (Object.keys(AGENT_REGISTRY) as AgentKey[]).filter(
    (key) => AGENT_REGISTRY[key].launchTier === "day-one",
  );
  await Promise.all(
    dayOneKeys.map((agentKey) =>
      prisma.orgAgentEnablement.upsert({
        where: { orgId_agentKey: { orgId, agentKey } },
        create: { orgId, agentKey, status: "enabled" },
        update: {}, // no-op on re-run
      }),
    ),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/db test seed-org-day-one-agents
```

Expected: PASS — all 3 assertions green.

- [ ] **Step 5: Export from db barrel**

Append to `packages/db/src/index.ts`:

```ts
export { seedOrgDayOneAgents } from "./seed/seed-org-day-one-agents.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/seed/ packages/db/src/index.ts
git commit -m "feat(db): seedOrgDayOneAgents helper for new-org enablement"
```

---

### Task 2.6: Wire the seed helper into every org-creation site

**Files:**

- Modify: `packages/db/prisma/seed.ts` (around line 60-70 — after `prisma.organizationConfig.upsert`)
- Modify: `apps/api/src/routes/organizations.ts:58` — wherever `prisma.organizationConfig.upsert` is called

- [ ] **Step 1: Re-find every org-creation call-site**

```bash
grep -rn "prisma.organizationConfig.upsert\|prisma.organizationConfig.create" packages/ apps/ 2>/dev/null | grep -v dist | grep -v __tests__
```

Note every match — Step 2 must update each.

- [ ] **Step 2: For each match, add a `seedOrgDayOneAgents` call after the upsert + set `useAgentFirstNav: true` for new orgs**

For `packages/db/prisma/seed.ts` (around line 61), modify:

```diff
  await prisma.organizationConfig.upsert({
    where: { id: "org_dev" },
    create: {
      id: "org_dev",
      name: "Dev Organization",
+     useAgentFirstNav: true,
    },
    update: {},
  });
+ await seedOrgDayOneAgents(prisma, "org_dev");
  console.log("Seeded organization config: org_dev");
```

Add the import at the top of `seed.ts`:

```ts
import { seedOrgDayOneAgents } from "../src/seed/seed-org-day-one-agents.js";
```

For `apps/api/src/routes/organizations.ts`, find the `prisma.organizationConfig.upsert` call and:

- In the `create` branch, add `useAgentFirstNav: true` (so newly created orgs get the new nav).
- After the upsert resolves, if the operation was a `create` (not `update`), call `await seedOrgDayOneAgents(app.prisma, orgId)`. The simplest approach: always call `seedOrgDayOneAgents` after the upsert — the helper is idempotent so re-runs on existing orgs are safe.

```diff
+ import { seedOrgDayOneAgents } from "@switchboard/db";

  const config = await app.prisma.organizationConfig.upsert({
    where: { id: orgId },
    create: {
      id: orgId,
      name: body.name,
+     useAgentFirstNav: true,
      // …other create fields
    },
    update: {
      // …existing update fields (do NOT overwrite useAgentFirstNav on update)
    },
  });
+ await seedOrgDayOneAgents(app.prisma, orgId);
```

- [ ] **Step 3: Typecheck + run the seed test path**

```bash
pnpm --filter @switchboard/db build
pnpm --filter @switchboard/api typecheck
pnpm --filter @switchboard/api test routes
```

Expected: green.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/seed.ts apps/api/src/routes/organizations.ts
git commit -m "feat(api,db): seed day-one agent enablement at org-creation sites"
```

---

### Task 2.7: Implement `GET /api/dashboard/agents` endpoint

**Files:**

- Create: `apps/api/src/routes/dashboard-agents.ts`
- Modify: `apps/api/src/bootstrap/routes.ts` (register the new route)
- Modify: `apps/api/src/app.ts` (decorate `app.orgAgentEnablementStore` for prod)
- Modify: `apps/api/src/__tests__/test-server.ts` (decorate the in-memory store for tests)
- Create: `apps/api/src/__tests__/api-dashboard-agents.test.ts`

- [ ] **Step 1: Write the failing endpoint test**

Create `apps/api/src/__tests__/api-dashboard-agents.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildTestServer, type TestContext } from "./test-server.js";

describe("GET /api/dashboard/agents", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await buildTestServer();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it("returns Mira as coming_soon when no enablement rows exist", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents",
      headers: { "x-org-id": "org-empty" }, // adapt to your auth header / dev defaults
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { agents: Array<{ key: string; status: string }> };
    expect(body.agents.map((a) => a.key)).toEqual(["alex", "riley", "mira"]);
    const mira = body.agents.find((a) => a.key === "mira")!;
    expect(mira.status).toBe("coming_soon");
  });

  it("returns enabled status for agents that have rows", async () => {
    await ctx.app.orgAgentEnablementStore!.enable("org-1", "alex");
    await ctx.app.orgAgentEnablementStore!.enable("org-1", "riley");
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents",
      headers: { "x-org-id": "org-1" },
    });
    const body = res.json() as { agents: Array<{ key: string; status: string }> };
    expect(body.agents.find((a) => a.key === "alex")!.status).toBe("enabled");
    expect(body.agents.find((a) => a.key === "riley")!.status).toBe("enabled");
    expect(body.agents.find((a) => a.key === "mira")!.status).toBe("coming_soon");
  });

  it("includes registry metadata (displayName, accent, slug, role, launchTier)", async () => {
    await ctx.app.orgAgentEnablementStore!.enable("org-1", "alex");
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents",
      headers: { "x-org-id": "org-1" },
    });
    const body = res.json() as { agents: Array<Record<string, unknown>> };
    const alex = body.agents.find((a) => a.key === "alex")!;
    expect(alex.displayName).toBe("Alex");
    expect(alex.accent).toMatch(/^hsl\(/);
    expect(alex.slug).toBe("alex");
    expect(alex.role).toBe("lead-to-speed");
    expect(alex.launchTier).toBe("day-one");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/api test api-dashboard-agents
```

Expected: FAIL — route returns 404 (not registered) or 503 (no store decorated).

- [ ] **Step 3: Decorate the store in test-server.ts**

Open `apps/api/src/__tests__/test-server.ts` and:

1. Add to the `TestContext`'s `app` typing (around line 82):

```ts
orgAgentEnablementStore?: import("@switchboard/core").OrgAgentEnablementStore;
```

2. Inside `buildTestServer()` (around line 250 where `recommendationStore` is created), add:

```ts
const orgAgentEnablementStore = createInMemoryOrgAgentEnablementStore();
app.decorate("orgAgentEnablementStore", orgAgentEnablementStore);
```

Add the import:

```ts
import { createInMemoryOrgAgentEnablementStore } from "@switchboard/db";
```

- [ ] **Step 4: Decorate the store in production app.ts**

Open `apps/api/src/app.ts` (around line 486 where `recommendationStore` is decorated), add:

```ts
import { PrismaOrgAgentEnablementStore } from "@switchboard/db";
// …
const orgAgentEnablementStore = new PrismaOrgAgentEnablementStore(prisma);
app.decorate("orgAgentEnablementStore", orgAgentEnablementStore);
```

Add the type to the FastifyInstance augmentation (find where `recommendationStore` is typed in the augmentation block):

```ts
declare module "fastify" {
  interface FastifyInstance {
    // …
    orgAgentEnablementStore?: import("@switchboard/core").OrgAgentEnablementStore;
  }
}
```

(If the augmentation lives in a separate `.d.ts` file, add it there instead.)

- [ ] **Step 5: Implement the route**

Create `apps/api/src/routes/dashboard-agents.ts`:

```ts
import type { FastifyPluginAsync } from "fastify";
import { AGENT_REGISTRY, AGENT_KEYS, type AgentKey } from "@switchboard/schemas";
import { requireOrganizationScope } from "../utils/require-org.js";

export const dashboardAgentsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/",
    {
      schema: {
        description: "List enabled + coming-soon agents for the current org.",
        tags: ["Dashboard"],
      },
    },
    async (request, reply) => {
      if (!app.orgAgentEnablementStore) {
        return reply
          .code(503)
          .send({ error: "OrgAgentEnablement store unavailable", statusCode: 503 });
      }
      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const rows = await app.orgAgentEnablementStore.list(orgId);
      const byKey = new Map(rows.map((r) => [r.agentKey, r]));

      const agents = AGENT_KEYS.map((key) => {
        const meta = AGENT_REGISTRY[key];
        const row = byKey.get(key);
        return {
          key,
          slug: meta.slug,
          role: meta.role,
          displayName: meta.displayName,
          accent: meta.accent,
          launchTier: meta.launchTier,
          status: row?.status ?? "coming_soon",
          enabledAt: row?.enabledAt?.toISOString() ?? null,
        };
      });
      return reply.code(200).send({ agents });
    },
  );
};
```

- [ ] **Step 6: Register the route**

In `apps/api/src/bootstrap/routes.ts` (after the recommendations registration around line 57):

```diff
+ import { dashboardAgentsRoutes } from "../routes/dashboard-agents.js";
  // …
+ await app.register(dashboardAgentsRoutes, { prefix: "/api/dashboard/agents" });
```

- [ ] **Step 7: Run the test again to verify it passes**

```bash
pnpm --filter @switchboard/api test api-dashboard-agents
```

Expected: PASS — all 3 assertions green.

- [ ] **Step 8: Add a cross-tenant isolation test**

Append to `apps/api/src/__tests__/api-dashboard-agents.test.ts`:

```ts
describe("cross-tenant isolation", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await buildTestServer();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it("does not leak enablement rows from another org", async () => {
    await ctx.app.orgAgentEnablementStore!.enable("org-A", "alex");
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents",
      headers: { "x-org-id": "org-B" },
    });
    const body = res.json() as { agents: Array<{ key: string; status: string }> };
    // Org B has no rows — every agent should read coming_soon.
    expect(body.agents.find((a) => a.key === "alex")!.status).toBe("coming_soon");
  });
});
```

Run again:

```bash
pnpm --filter @switchboard/api test api-dashboard-agents
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/routes/dashboard-agents.ts \
        apps/api/src/bootstrap/routes.ts \
        apps/api/src/app.ts \
        apps/api/src/__tests__/test-server.ts \
        apps/api/src/__tests__/api-dashboard-agents.test.ts
git commit -m "feat(api): GET /api/dashboard/agents endpoint + cross-tenant isolation test"
```

---

### Task 2.8: Surface `useAgentFirstNav` in `GET /api/dashboard/organizations`

**Files:**

- Modify: `apps/api/src/routes/organizations.ts` (the GET handler that returns the org payload)

- [ ] **Step 1: Find the GET endpoint that returns the org config**

```bash
grep -nE "app\.get" apps/api/src/routes/organizations.ts
```

Identify the handler that returns the current org's config payload.

- [ ] **Step 2: Add `useAgentFirstNav` to the response shape**

In the handler, find the response object construction and add:

```ts
useAgentFirstNav: config.useAgentFirstNav,
```

Where `config` is the `OrganizationConfig` row read from Prisma.

- [ ] **Step 3: Add a test asserting the field is in the response**

Find or create `apps/api/src/__tests__/api-dashboard-organizations.test.ts`. Add:

```ts
it("includes useAgentFirstNav in the org payload", async () => {
  // Seed an org with the flag set
  // ...
  const res = await ctx.app.inject({ method: "GET", url: "/api/dashboard/organizations" });
  const body = res.json();
  expect(body).toHaveProperty("useAgentFirstNav");
  expect(typeof body.useAgentFirstNav).toBe("boolean");
});
```

- [ ] **Step 4: Run + commit**

```bash
pnpm --filter @switchboard/api test
git add apps/api/src/routes/organizations.ts apps/api/src/__tests__/api-dashboard-organizations.test.ts
git commit -m "feat(api): expose useAgentFirstNav in /api/dashboard/organizations payload"
```

---

### Task 2.9: PR 2 verification + push

- [ ] **Step 1: Full sweep**

```bash
pnpm reset && pnpm typecheck && pnpm test
pnpm db:check-drift
```

Expected: green; no schema drift.

- [ ] **Step 2: Push + open PR 2**

```bash
git push -u origin feat/org-agent-enablement
gh pr create --title "feat(db,api): OrgAgentEnablement table + /api/dashboard/agents (Slice A PR 2)" --body "$(cat <<'EOF'
## Summary

PR 2 of 4 for Slice A. Adds the per-org agent enablement table, the `useAgentFirstNav` column on `OrganizationConfig`, and the `GET /api/dashboard/agents` endpoint that the agent-first nav reads.

- New Prisma model `OrgAgentEnablement(id, orgId, agentKey, status, enabledAt, updatedAt)` with `@@unique([orgId, agentKey])`.
- New column `OrganizationConfig.useAgentFirstNav Boolean @default(false)`.
- Migration includes a backfill seeding Alex + Riley for every existing org (Mira intentionally not seeded — `launchTier: "day-thirty"`).
- `OrgAgentEnablementStore` interface in `@switchboard/core`; in-memory + Prisma implementations in `@switchboard/db`.
- `seedOrgDayOneAgents(prisma, orgId)` helper invoked at every org-creation site (`packages/db/prisma/seed.ts`, `apps/api/src/routes/organizations.ts`). New orgs also get `useAgentFirstNav: true`.
- New endpoint `GET /api/dashboard/agents` merges registry metadata with per-org enablement rows. Mira shows up as `"coming_soon"` until day +30 backfill.
- `GET /api/dashboard/organizations` payload now includes `useAgentFirstNav`.
- Cross-tenant isolation test added.

Spec: `docs/superpowers/specs/2026-05-03-agent-roster-and-decision-feed-design.md`

## Test plan

- [ ] `pnpm typecheck && pnpm test` green
- [ ] `pnpm db:check-drift` reports no drift
- [ ] Manual: `curl /api/dashboard/agents` for a seeded dev org returns Alex + Riley enabled and Mira coming_soon

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

PR 2 is shippable independently of PRs 3 + 4. Wait for review/merge before starting PR 3.

---

# PR 3 — Decision Feed (core + endpoint)

**Branch:** `feat/decision-feed` off `main` after PR 2 merges.
**Outcome:** `GET /api/dashboard/agents/:key/decisions` and `GET /api/dashboard/decisions` return a unified, ranked list of Recommendation + Handoff decisions.

---

### Task 3.1: Add `ContactStore.listByIds()` batch method

**Files:**

- Modify: `packages/db/src/stores/prisma-contact-store.ts` (interface + class)
- Modify: `packages/db/src/stores/__tests__/prisma-contact-store.test.ts` (or create if missing)

- [ ] **Step 1: Find the existing ContactStore test or create one**

```bash
ls packages/db/src/stores/__tests__/prisma-contact-store.test.ts 2>/dev/null
```

If absent, create the test file with the same mocked-Prisma pattern as the workflow store.

- [ ] **Step 2: Write the failing test**

Add to (or create) `packages/db/src/stores/__tests__/prisma-contact-store.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { PrismaContactStore } from "../prisma-contact-store.js";

describe("PrismaContactStore.listByIds", () => {
  function mockPrisma(rows: Array<Record<string, unknown>>) {
    return {
      contact: { findMany: vi.fn().mockResolvedValue(rows) },
    } as unknown as PrismaClient;
  }

  it("returns a Map keyed by contact id", async () => {
    const prisma = mockPrisma([
      {
        id: "c1",
        organizationId: "org-1",
        name: "Maya",
        phone: null,
        email: null,
        primaryChannel: "whatsapp",
        firstTouchChannel: null,
        source: null,
        attribution: null,
        roles: ["lead"],
        stage: "new",
        firstContactAt: new Date(),
        lastActivityAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "c2",
        organizationId: "org-1",
        name: "Jordan",
        phone: null,
        email: null,
        primaryChannel: "whatsapp",
        firstTouchChannel: null,
        source: null,
        attribution: null,
        roles: ["lead"],
        stage: "new",
        firstContactAt: new Date(),
        lastActivityAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const store = new PrismaContactStore(prisma);
    const result = await store.listByIds("org-1", ["c1", "c2"]);
    expect(result.size).toBe(2);
    expect(result.get("c1")?.name).toBe("Maya");
    expect(result.get("c2")?.name).toBe("Jordan");
  });

  it("returns an empty Map for empty input (no DB call)", async () => {
    const prisma = mockPrisma([]);
    const store = new PrismaContactStore(prisma);
    const result = await store.listByIds("org-1", []);
    expect(result.size).toBe(0);
    expect(prisma.contact.findMany).not.toHaveBeenCalled();
  });

  it("filters by orgId for tenant isolation", async () => {
    const prisma = mockPrisma([]);
    const store = new PrismaContactStore(prisma);
    await store.listByIds("org-1", ["c1"]);
    expect(prisma.contact.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", id: { in: ["c1"] } },
    });
  });
});
```

- [ ] **Step 3: Run to verify FAIL**

```bash
pnpm --filter @switchboard/db test prisma-contact-store
```

Expected: FAIL — `listByIds` not defined.

- [ ] **Step 4: Add the method to the interface + class**

In `packages/db/src/stores/prisma-contact-store.ts`, find the `ContactStore` interface (around line 28) and add:

```ts
listByIds(orgId: string, ids: string[]): Promise<Map<string, Contact>>;
```

In the `PrismaContactStore` class, add the implementation:

```ts
async listByIds(orgId: string, ids: string[]): Promise<Map<string, Contact>> {
  if (ids.length === 0) return new Map();
  const rows = await this.prisma.contact.findMany({
    where: { organizationId: orgId, id: { in: ids } },
  });
  return new Map(rows.map((r) => [r.id, this.mapRow(r)]));
}
```

(Use whatever helper the existing class uses to map a Prisma row to a `Contact` — match the existing pattern in the file.)

- [ ] **Step 5: Run to verify PASS**

```bash
pnpm --filter @switchboard/db test prisma-contact-store
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/stores/prisma-contact-store.ts \
        packages/db/src/stores/__tests__/prisma-contact-store.test.ts
git commit -m "feat(db): add ContactStore.listByIds batch method"
```

---

### Task 3.2: Add `ConversationThreadStore.listByContactIds()` batch method

**Files:**

- Modify: `packages/core/src/conversations/thread-store.ts` (interface)
- Modify: `packages/db/src/stores/prisma-thread-store.ts` (implementation)
- Modify: `packages/db/src/stores/__tests__/prisma-thread-store.test.ts` (or create)

- [ ] **Step 1: Write the failing test**

Add to (or create) `packages/db/src/stores/__tests__/prisma-thread-store.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { PrismaConversationThreadStore } from "../prisma-thread-store.js";

describe("PrismaConversationThreadStore.listByContactIds", () => {
  function mockPrisma(rows: Array<Record<string, unknown>>) {
    return {
      conversationThread: { findMany: vi.fn().mockResolvedValue(rows) },
    } as unknown as PrismaClient;
  }

  it("returns a Map keyed by contactId", async () => {
    const prisma = mockPrisma([
      {
        id: "t1",
        contactId: "c1",
        organizationId: "org-1",
        stage: "new",
        assignedAgent: "alex",
        agentContext: {},
        currentSummary: "",
        followUpSchedule: {},
        lastOutcomeAt: null,
        messageCount: 0,
        firstAgentMessageAt: null,
        threadStatus: "open",
        opportunityId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const store = new PrismaConversationThreadStore(prisma);
    const result = await store.listByContactIds("org-1", ["c1"]);
    expect(result.get("c1")?.assignedAgent).toBe("alex");
  });

  it("returns empty Map for empty input (no DB call)", async () => {
    const prisma = mockPrisma([]);
    const store = new PrismaConversationThreadStore(prisma);
    const result = await store.listByContactIds("org-1", []);
    expect(result.size).toBe(0);
    expect(prisma.conversationThread.findMany).not.toHaveBeenCalled();
  });

  it("filters by orgId for tenant isolation", async () => {
    const prisma = mockPrisma([]);
    const store = new PrismaConversationThreadStore(prisma);
    await store.listByContactIds("org-1", ["c1"]);
    expect(prisma.conversationThread.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", contactId: { in: ["c1"] } },
    });
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm --filter @switchboard/db test prisma-thread-store
```

Expected: FAIL — method not defined.

- [ ] **Step 3: Add the method to the interface**

In `packages/core/src/conversations/thread-store.ts`:

```ts
export interface ConversationThreadStore {
  // …existing methods
  listByContactIds(orgId: string, contactIds: string[]): Promise<Map<string, ConversationThread>>;
}
```

- [ ] **Step 4: Implement in the Prisma store**

In `packages/db/src/stores/prisma-thread-store.ts`, add:

```ts
async listByContactIds(
  orgId: string,
  contactIds: string[],
): Promise<Map<string, ConversationThread>> {
  if (contactIds.length === 0) return new Map();
  const rows = await this.prisma.conversationThread.findMany({
    where: { organizationId: orgId, contactId: { in: contactIds } },
  });
  // Use the existing row→ConversationThread mapper that getByContact uses.
  return new Map(rows.map((r) => [r.contactId, this.mapRow(r)]));
}
```

(Match whatever mapping helper `getByContact` uses in the same file.)

- [ ] **Step 5: Run + commit**

```bash
pnpm --filter @switchboard/core typecheck
pnpm --filter @switchboard/db test prisma-thread-store
git add packages/core/src/conversations/thread-store.ts \
        packages/db/src/stores/prisma-thread-store.ts \
        packages/db/src/stores/__tests__/prisma-thread-store.test.ts
git commit -m "feat(db,core): add ConversationThreadStore.listByContactIds batch method"
```

---

### Task 3.3: Define the `Decision` type

**Files:**

- Create: `packages/core/src/decisions/types.ts`

- [ ] **Step 1: Create the file**

```ts
import type { AgentKey } from "@switchboard/schemas";

// Slice A: 2 kinds. "escalation" reserved for a future slice — see spec §1.
// When EscalationRecord is promoted to a first-class operator-facing decision, add it here.
export type DecisionKind = "approval" | "handoff";

export interface DecisionPresentation {
  primaryLabel: string;
  secondaryLabel: string;
  dismissLabel: string;
  dataLines: ReadonlyArray<unknown>;
}

export interface Decision {
  /** Namespaced ("approval:abc" / "handoff:def") so frontend can use it as a single React key. */
  id: string;
  kind: DecisionKind;
  orgId: string;
  agentKey: AgentKey;
  /** The serif sentence that displays on the card. */
  humanSummary: string;
  presentation: DecisionPresentation;
  /** 0..100, computed by per-kind scorer (urgency.ts). */
  urgencyScore: number;
  createdAt: Date;
  /** "View thread →" target; null if no thread. */
  threadHref: string | null;
  /** For action dispatch — the original row's id + kind. */
  sourceRef: { kind: DecisionKind; sourceId: string };
  meta: {
    contactName?: string;
    /** Handoffs only. */
    slaDeadlineAt?: Date;
    /** Recommendations only. */
    riskLevel?: "low" | "medium" | "high";
    /** Recommendations only. */
    undoableUntil?: Date;
  };
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @switchboard/core typecheck
```

Expected: green.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/decisions/types.ts
git commit -m "feat(core): add Decision type (kinds: approval | handoff)"
```

---

### Task 3.4: Implement urgency scoring + sort comparator

**Files:**

- Create: `packages/core/src/decisions/urgency.ts`
- Create: `packages/core/src/decisions/__tests__/urgency.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/decisions/__tests__/urgency.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { scoreRecommendation, scoreHandoff, decisionSortComparator } from "../urgency.js";
import type { Decision } from "../types.js";

const baseRec = {
  id: "r1",
  orgId: "org-1",
  agentKey: "riley" as const,
  intent: "recommendation.ad_set_pause",
  action: "pause",
  humanSummary: "test",
  parameters: {},
  targetEntities: null,
  sourceAgent: "riley",
  sourceWorkflow: null,
  surface: "queue" as const,
  status: "pending" as const,
  actedBy: null,
  actedAt: null,
  note: null,
  createdAt: new Date(),
  expiresAt: null,
  undoableUntil: null,
};

describe("scoreRecommendation", () => {
  it("returns ~95 for high confidence + max dollar cap", () => {
    const score = scoreRecommendation({
      ...baseRec,
      confidence: 0.95,
      dollarsAtRisk: 5000,
      riskLevel: "low",
    });
    expect(score).toBe(95);
  });

  it("saturates dollar factor at $2000 (vertical: med spa LTV)", () => {
    const at2k = scoreRecommendation({
      ...baseRec,
      confidence: 0.9,
      dollarsAtRisk: 2000,
      riskLevel: "low",
    });
    const at5k = scoreRecommendation({
      ...baseRec,
      confidence: 0.9,
      dollarsAtRisk: 5000,
      riskLevel: "low",
    });
    expect(at2k).toBe(at5k);
  });

  it("high-risk floor lifts low-base scores to 60", () => {
    const score = scoreRecommendation({
      ...baseRec,
      confidence: 0.3,
      dollarsAtRisk: 50,
      riskLevel: "high",
    });
    expect(score).toBe(60);
  });

  it("medium-risk floor lifts to 40", () => {
    const score = scoreRecommendation({
      ...baseRec,
      confidence: 0.1,
      dollarsAtRisk: 0,
      riskLevel: "medium",
    });
    expect(score).toBe(40);
  });

  it("low-risk has no floor", () => {
    const score = scoreRecommendation({
      ...baseRec,
      confidence: 0,
      dollarsAtRisk: 0,
      riskLevel: "low",
    });
    expect(score).toBe(0);
  });
});

describe("scoreHandoff", () => {
  const baseHandoff = {
    id: "h1",
    organizationId: "org-1",
    sessionId: "s1",
    leadId: "c1",
    status: "pending",
    reason: "human_requested",
    leadSnapshot: {},
    qualificationSnapshot: {},
    conversationSummary: {},
    acknowledgedAt: null,
    resolutionNote: null,
    resolvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("returns 100 for past-SLA handoffs", () => {
    const score = scoreHandoff({ ...baseHandoff, slaDeadlineAt: new Date(Date.now() - 60_000) });
    expect(score).toBe(100);
  });

  it("returns 30 for handoffs 24h+ in the future", () => {
    const score = scoreHandoff({
      ...baseHandoff,
      slaDeadlineAt: new Date(Date.now() + 25 * 3_600_000),
    });
    expect(score).toBe(30);
  });

  it("ramps linearly between 0h and 24h (12h ≈ 65)", () => {
    const score = scoreHandoff({
      ...baseHandoff,
      slaDeadlineAt: new Date(Date.now() + 12 * 3_600_000),
    });
    expect(score).toBeGreaterThanOrEqual(64);
    expect(score).toBeLessThanOrEqual(66);
  });
});

describe("decisionSortComparator", () => {
  function makeDecision(
    score: number,
    createdAtMs: number,
    kind: "approval" | "handoff" = "approval",
  ): Decision {
    return {
      id: `${kind}:${score}-${createdAtMs}`,
      kind,
      orgId: "org-1",
      agentKey: "alex",
      humanSummary: "x",
      presentation: { primaryLabel: "p", secondaryLabel: "s", dismissLabel: "d", dataLines: [] },
      urgencyScore: score,
      createdAt: new Date(createdAtMs),
      threadHref: null,
      sourceRef: { kind, sourceId: "x" },
      meta: {},
    };
  }

  it("sorts descending by urgencyScore", () => {
    const a = makeDecision(50, 1000);
    const b = makeDecision(80, 2000);
    expect(decisionSortComparator(a, b)).toBeGreaterThan(0);
  });

  it("tiebreak: older createdAt wins", () => {
    const older = makeDecision(50, 1000);
    const newer = makeDecision(50, 2000);
    expect(decisionSortComparator(older, newer)).toBeLessThan(0);
  });

  it("integration: real-world ordering puts past-SLA handoff above big-money rec", () => {
    const handoffPastSla = makeDecision(100, Date.now(), "handoff");
    const bigRec = makeDecision(85, Date.now(), "approval");
    const smallRec = makeDecision(60, Date.now(), "approval");
    const sorted = [smallRec, bigRec, handoffPastSla].sort(decisionSortComparator);
    expect(sorted[0]!.kind).toBe("handoff");
    expect(sorted[1]!.urgencyScore).toBe(85);
    expect(sorted[2]!.urgencyScore).toBe(60);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm --filter @switchboard/core test urgency
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `urgency.ts`**

Create `packages/core/src/decisions/urgency.ts`:

```ts
import type { Recommendation } from "../recommendations/types.js";
import type { Decision } from "./types.js";

// Vertical-tuned: $2k cap reflects med spa / beauty / dental LTV bands.
// Botox/fillers $400-1200, hydrafacial $200-500, Invisalign $4-8k.
// $2k captures "moderately significant" without letting one Invisalign rec dominate.
const DOLLAR_CAP = 2_000;
const RISK_FLOOR: Record<"low" | "medium" | "high", number> = {
  low: 0,
  medium: 40,
  high: 60,
};

export function scoreRecommendation(row: Recommendation): number {
  const dollarFactor = Math.min(row.dollarsAtRisk / DOLLAR_CAP, 1);
  const base = row.confidence * dollarFactor * 100;
  const floor = RISK_FLOOR[row.riskLevel];
  return Math.round(Math.max(base, floor));
}

// Handoff row shape (from packages/core/src/handoff/types.ts HandoffPackage).
// Typed minimally here — only the fields the scorer reads.
export interface HandoffLike {
  slaDeadlineAt: Date;
}

export function scoreHandoff(row: HandoffLike): number {
  const hoursUntilSla = (row.slaDeadlineAt.getTime() - Date.now()) / 3_600_000;
  if (hoursUntilSla <= 0) return 100;
  if (hoursUntilSla >= 24) return 30;
  return Math.round(100 - (hoursUntilSla / 24) * 70);
}

export const decisionSortComparator = (a: Decision, b: Decision): number => {
  if (b.urgencyScore !== a.urgencyScore) return b.urgencyScore - a.urgencyScore;
  return +a.createdAt - +b.createdAt; // older first as tiebreaker
};
```

- [ ] **Step 4: Run to verify PASS**

```bash
pnpm --filter @switchboard/core test urgency
```

Expected: PASS — all assertions green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/decisions/urgency.ts \
        packages/core/src/decisions/__tests__/urgency.test.ts
git commit -m "feat(core): urgency scorers (recommendation, handoff) + sort comparator"
```

---

### Task 3.5: Implement `agent-key-resolver.ts`

**Files:**

- Create: `packages/core/src/decisions/agent-key-resolver.ts`
- Create: `packages/core/src/decisions/__tests__/agent-key-resolver.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/decisions/__tests__/agent-key-resolver.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveAgentKey } from "../agent-key-resolver.js";

describe("resolveAgentKey", () => {
  it("maps canonical names directly", () => {
    expect(resolveAgentKey("alex")).toBe("alex");
    expect(resolveAgentKey("riley")).toBe("riley");
    expect(resolveAgentKey("mira")).toBe("mira");
  });

  it("maps role aliases", () => {
    expect(resolveAgentKey("lead-specialist")).toBe("alex");
    expect(resolveAgentKey("speed-to-lead")).toBe("alex");
    expect(resolveAgentKey("ad-optimizer")).toBe("riley");
    expect(resolveAgentKey("creative-director")).toBe("mira");
  });

  it("is case-insensitive", () => {
    expect(resolveAgentKey("ALEX")).toBe("alex");
    expect(resolveAgentKey("Riley")).toBe("riley");
  });

  it("defaults to alex when sourceAgent is null/undefined/empty", () => {
    expect(resolveAgentKey(null)).toBe("alex");
    expect(resolveAgentKey(undefined)).toBe("alex");
    expect(resolveAgentKey("")).toBe("alex");
  });

  it("defaults to alex for unknown strings", () => {
    expect(resolveAgentKey("unknown-bot")).toBe("alex");
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm --filter @switchboard/core test agent-key-resolver
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `packages/core/src/decisions/agent-key-resolver.ts`:

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

/**
 * Maps free-form sourceAgent / assignedAgent strings to the canonical AgentKey.
 * Default-to-Alex is deliberate: Alex owns the lead-to-consultation surface
 * where almost all handoffs originate in the launch vertical (med spa /
 * beauty / dental aesthetic).
 */
export function resolveAgentKey(sourceAgent: string | null | undefined): AgentKey {
  if (!sourceAgent) return "alex";
  return SOURCE_AGENT_TO_KEY[sourceAgent.toLowerCase()] ?? "alex";
}
```

- [ ] **Step 4: Run to verify PASS + commit**

```bash
pnpm --filter @switchboard/core test agent-key-resolver
git add packages/core/src/decisions/agent-key-resolver.ts \
        packages/core/src/decisions/__tests__/agent-key-resolver.test.ts
git commit -m "feat(core): agent-key-resolver maps free-form strings to AgentKey"
```

---

### Task 3.6: Implement `recommendation-adapter.ts`

**Files:**

- Create: `packages/core/src/decisions/adapters/recommendation-adapter.ts`
- Create: `packages/core/src/decisions/adapters/__tests__/recommendation-adapter.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/decisions/adapters/__tests__/recommendation-adapter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { adaptRecommendation } from "../recommendation-adapter.js";
import type { Recommendation } from "../../../recommendations/types.js";

function makeRec(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: "rec-1",
    orgId: "org-1",
    agentKey: "riley",
    intent: "recommendation.ad_set_pause",
    action: "pause",
    humanSummary: "Pause Q2-Lookalikes — frequency hit 4.8.",
    confidence: 0.85,
    dollarsAtRisk: 400,
    riskLevel: "medium",
    surface: "queue",
    status: "pending",
    parameters: {
      __recommendation: {
        action: "pause",
        presentation: {
          primaryLabel: "Pause",
          secondaryLabel: "Reduce 50%",
          dismissLabel: "Dismiss",
          dataLines: ["frequency 4.8", "CPA up 96%"],
        },
      },
    },
    targetEntities: { contactId: "c-maya", contactName: "Maya R." },
    sourceAgent: "riley",
    sourceWorkflow: null,
    actedBy: null,
    actedAt: null,
    note: null,
    createdAt: new Date("2026-05-01T12:00:00Z"),
    expiresAt: null,
    undoableUntil: null,
    ...overrides,
  };
}

describe("adaptRecommendation", () => {
  it("namespaces the id as 'approval:<sourceId>'", () => {
    const decision = adaptRecommendation(makeRec());
    expect(decision.id).toBe("approval:rec-1");
    expect(decision.sourceRef).toEqual({ kind: "approval", sourceId: "rec-1" });
  });

  it("passes through humanSummary, agentKey, orgId", () => {
    const decision = adaptRecommendation(makeRec());
    expect(decision.humanSummary).toBe("Pause Q2-Lookalikes — frequency hit 4.8.");
    expect(decision.agentKey).toBe("riley");
    expect(decision.orgId).toBe("org-1");
  });

  it("extracts presentation from parameters.__recommendation", () => {
    const decision = adaptRecommendation(makeRec());
    expect(decision.presentation.primaryLabel).toBe("Pause");
    expect(decision.presentation.dataLines).toEqual(["frequency 4.8", "CPA up 96%"]);
  });

  it("uses fallback presentation when parameters.__recommendation is missing", () => {
    const decision = adaptRecommendation(makeRec({ parameters: {} }));
    expect(decision.presentation.primaryLabel).toBe("Approve");
    expect(decision.presentation.secondaryLabel).toBe("Edit");
    expect(decision.presentation.dismissLabel).toBe("Dismiss");
  });

  it("populates meta with riskLevel and undoableUntil", () => {
    const undoableUntil = new Date("2026-05-01T13:00:00Z");
    const decision = adaptRecommendation(makeRec({ undoableUntil }));
    expect(decision.meta.riskLevel).toBe("medium");
    expect(decision.meta.undoableUntil).toBe(undoableUntil);
  });

  it("populates meta.contactName from targetEntities", () => {
    const decision = adaptRecommendation(makeRec());
    expect(decision.meta.contactName).toBe("Maya R.");
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm --filter @switchboard/core test recommendation-adapter
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `packages/core/src/decisions/adapters/recommendation-adapter.ts`:

```ts
import type { Recommendation } from "../../recommendations/types.js";
import type { Decision, DecisionPresentation } from "../types.js";
import { scoreRecommendation } from "../urgency.js";

const FALLBACK_PRESENTATION: DecisionPresentation = {
  primaryLabel: "Approve",
  secondaryLabel: "Edit",
  dismissLabel: "Dismiss",
  dataLines: [],
};

export function adaptRecommendation(row: Recommendation): Decision {
  return {
    id: `approval:${row.id}`,
    kind: "approval",
    orgId: row.orgId,
    agentKey: row.agentKey,
    humanSummary: row.humanSummary,
    presentation: extractPresentation(row.parameters),
    urgencyScore: scoreRecommendation(row),
    createdAt: row.createdAt,
    threadHref: deriveThreadHref(row),
    sourceRef: { kind: "approval", sourceId: row.id },
    meta: {
      contactName: extractContactName(row.targetEntities),
      riskLevel: row.riskLevel,
      undoableUntil: row.undoableUntil ?? undefined,
    },
  };
}

function extractPresentation(parameters: Record<string, unknown>): DecisionPresentation {
  const meta = parameters?.__recommendation as { presentation?: DecisionPresentation } | undefined;
  return meta?.presentation ?? FALLBACK_PRESENTATION;
}

function extractContactName(targetEntities: Record<string, unknown> | null): string | undefined {
  if (!targetEntities) return undefined;
  const name = targetEntities.contactName;
  return typeof name === "string" ? name : undefined;
}

function deriveThreadHref(row: Recommendation): string | null {
  if (!row.targetEntities) return null;
  const contactId = row.targetEntities.contactId;
  return typeof contactId === "string" ? `/contacts/${contactId}/conversations` : null;
}
```

- [ ] **Step 4: Run + commit**

```bash
pnpm --filter @switchboard/core test recommendation-adapter
git add packages/core/src/decisions/adapters/recommendation-adapter.ts \
        packages/core/src/decisions/adapters/__tests__/recommendation-adapter.test.ts
git commit -m "feat(core): recommendation-adapter — Recommendation → Decision pass-through"
```

---

### Task 3.7: Implement `handoff-adapter.ts`

**Files:**

- Create: `packages/core/src/decisions/adapters/handoff-adapter.ts`
- Create: `packages/core/src/decisions/adapters/__tests__/handoff-adapter.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/decisions/adapters/__tests__/handoff-adapter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { adaptHandoff } from "../handoff-adapter.js";
import type { HandoffPackage } from "../../../handoff/types.js";
import type { ConversationThread } from "@switchboard/schemas";

function makeHandoff(overrides: Partial<HandoffPackage> = {}): HandoffPackage {
  return {
    id: "h-1",
    organizationId: "org-1",
    sessionId: "s-1",
    leadId: "c-maya",
    status: "pending" as const,
    reason: "human_requested",
    leadSnapshot: {},
    qualificationSnapshot: {},
    conversationSummary: {},
    slaDeadlineAt: new Date(Date.now() + 4 * 3_600_000), // 4h out
    acknowledgedAt: null,
    resolutionNote: null,
    resolvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as HandoffPackage;
}

const contact = { id: "c-maya", name: "Maya R." } as { id: string; name: string | null };
const thread = {
  id: "t-maya",
  contactId: "c-maya",
  assignedAgent: "alex",
} as unknown as ConversationThread;

describe("adaptHandoff", () => {
  it("namespaces id as 'handoff:<sourceId>'", () => {
    const decision = adaptHandoff(makeHandoff(), contact as any, thread);
    expect(decision.id).toBe("handoff:h-1");
    expect(decision.sourceRef).toEqual({ kind: "handoff", sourceId: "h-1" });
  });

  it("uses contact.name in humanSummary", () => {
    const decision = adaptHandoff(makeHandoff(), contact as any, thread);
    expect(decision.humanSummary).toContain("Maya R.");
  });

  it("falls back to 'A lead' when contact is null", () => {
    const decision = adaptHandoff(makeHandoff(), null, thread);
    expect(decision.humanSummary).toContain("A lead");
  });

  it("resolves agentKey from thread.assignedAgent", () => {
    const rileyThread = { ...thread, assignedAgent: "riley" } as ConversationThread;
    const decision = adaptHandoff(makeHandoff(), contact as any, rileyThread);
    expect(decision.agentKey).toBe("riley");
  });

  it("defaults agentKey to alex when thread is null", () => {
    const decision = adaptHandoff(makeHandoff(), contact as any, null);
    expect(decision.agentKey).toBe("alex");
  });

  it("composes presentation labels", () => {
    const decision = adaptHandoff(makeHandoff(), contact as any, thread);
    expect(decision.presentation.primaryLabel).toBe("Take this one");
    expect(decision.presentation.secondaryLabel).toBe("Snooze");
    expect(decision.presentation.dismissLabel).toBe("Mark resolved");
  });

  it("populates meta.slaDeadlineAt + meta.contactName", () => {
    const handoff = makeHandoff();
    const decision = adaptHandoff(handoff, contact as any, thread);
    expect(decision.meta.slaDeadlineAt).toBe(handoff.slaDeadlineAt);
    expect(decision.meta.contactName).toBe("Maya R.");
  });

  it("composes 'asked to talk to a human' for human_requested reason", () => {
    const decision = adaptHandoff(
      makeHandoff({ reason: "human_requested" }),
      contact as any,
      thread,
    );
    expect(decision.humanSummary).toContain("talk to a human");
  });

  it("composes 'going back and forth' for max_turns_exceeded reason", () => {
    const decision = adaptHandoff(
      makeHandoff({ reason: "max_turns_exceeded" }),
      contact as any,
      thread,
    );
    expect(decision.humanSummary).toContain("back and forth");
  });

  it("threadHref is null when thread is null", () => {
    const decision = adaptHandoff(makeHandoff(), contact as any, null);
    expect(decision.threadHref).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm --filter @switchboard/core test handoff-adapter
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `packages/core/src/decisions/adapters/handoff-adapter.ts`:

```ts
import type { ConversationThread } from "@switchboard/schemas";
import type { HandoffPackage } from "../../handoff/types.js";
import type { Contact } from "@switchboard/schemas";
import type { Decision, DecisionPresentation } from "../types.js";
import { scoreHandoff } from "../urgency.js";
import { resolveAgentKey } from "../agent-key-resolver.js";

export function adaptHandoff(
  row: HandoffPackage,
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
    presentation: composeHandoffPresentation(),
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

function composeHandoffSummary(row: HandoffPackage, contact: Contact | null): string {
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

function composeHandoffPresentation(): DecisionPresentation {
  return {
    primaryLabel: "Take this one",
    secondaryLabel: "Snooze",
    dismissLabel: "Mark resolved",
    dataLines: [],
  };
}
```

> **Note:** if `Contact` isn't already exported from `@switchboard/schemas`, import it from wherever the existing code does (likely `packages/db/src/stores/prisma-contact-store.ts` re-exports a `Contact` type). Adjust the import path to match.

- [ ] **Step 4: Run + commit**

```bash
pnpm --filter @switchboard/core test handoff-adapter
git add packages/core/src/decisions/adapters/handoff-adapter.ts \
        packages/core/src/decisions/adapters/__tests__/handoff-adapter.test.ts
git commit -m "feat(core): handoff-adapter — Handoff → Decision with prose composition"
```

---

### Task 3.8: Add the decisions barrel export

**Files:**

- Create: `packages/core/src/decisions/index.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create the barrel**

```ts
export type { Decision, DecisionKind, DecisionPresentation } from "./types.js";
export {
  scoreRecommendation,
  scoreHandoff,
  decisionSortComparator,
  type HandoffLike,
} from "./urgency.js";
export { resolveAgentKey } from "./agent-key-resolver.js";
export { adaptRecommendation } from "./adapters/recommendation-adapter.js";
export { adaptHandoff } from "./adapters/handoff-adapter.js";
```

- [ ] **Step 2: Re-export from core barrel**

In `packages/core/src/index.ts`:

```ts
export * from "./decisions/index.js";
```

- [ ] **Step 3: Build + commit**

```bash
pnpm --filter @switchboard/core build
git add packages/core/src/decisions/index.ts packages/core/src/index.ts
git commit -m "feat(core): decisions module barrel export"
```

---

### Task 3.9: Implement the read endpoint

**Files:**

- Create: `apps/api/src/routes/decisions.ts`
- Modify: `apps/api/src/bootstrap/routes.ts` (register both prefixes)
- Modify: `apps/api/src/app.ts` (decorate `app.handoffStore`, `app.contactStore`, `app.threadStore` if not already decorated)
- Modify: `apps/api/src/__tests__/test-server.ts` (decorate test versions)
- Create: `apps/api/src/__tests__/api-decisions.test.ts`
- Create: `apps/api/src/__tests__/api-decisions-isolation.test.ts`

- [ ] **Step 1: Verify which stores are already decorated on `app`**

```bash
grep -nE "app\.decorate.*Store" apps/api/src/app.ts apps/api/src/__tests__/test-server.ts | head -20
```

`recommendationStore` is already wired (PR 2 task 2.7). For `handoffStore`, `contactStore`, `threadStore`: if not wired in `app.ts`, add them. The Prisma instances are created in `bootstrap/skill-mode.ts:65-72` for skill mode — copy that pattern to `app.ts` if needed.

- [ ] **Step 2: Wire the missing stores in `app.ts` (production)**

```ts
import {
  PrismaContactStore,
  PrismaHandoffStore,
  PrismaConversationThreadStore,
} from "@switchboard/db";

const contactStore = new PrismaContactStore(prisma);
const handoffStore = new PrismaHandoffStore(prisma);
const threadStore = new PrismaConversationThreadStore(prisma);
app.decorate("contactStore", contactStore);
app.decorate("handoffStore", handoffStore);
app.decorate("threadStore", threadStore);
```

Augment the FastifyInstance interface:

```ts
declare module "fastify" {
  interface FastifyInstance {
    contactStore?: ContactStore;
    handoffStore?: HandoffStore;
    threadStore?: ConversationThreadStore;
  }
}
```

- [ ] **Step 3: Wire the in-memory equivalents in `test-server.ts`**

For tests, you can either:

- Use the Prisma stores with the existing Prisma mock from the test bootstrap, OR
- Add lightweight in-memory implementations for `Contact`, `Handoff`, `ConversationThread` if missing.

Most likely the test server already has access to these via the Prisma mock; just ensure the fields are decorated. Look at how `escalations-cross-tenant.test.ts` accesses `app.prisma.handoff` for guidance — that pattern continues to work.

- [ ] **Step 4: Write the failing endpoint tests**

Create `apps/api/src/__tests__/api-decisions.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildTestServer, type TestContext } from "./test-server.js";
import { emitRecommendation } from "@switchboard/core";

describe("GET /api/dashboard/agents/:key/decisions", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await buildTestServer();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it("returns recommendations for the agent (kind: 'approval')", async () => {
    await emitRecommendation(ctx.app.recommendationStore!, {
      orgId: "org-1",
      agentKey: "riley",
      intent: "recommendation.ad_set_pause",
      action: "pause",
      humanSummary: "Pause Q2-LA",
      confidence: 0.6,
      dollarsAtRisk: 400,
      riskLevel: "medium",
      parameters: {},
      presentation: {
        primaryLabel: "Pause",
        secondaryLabel: "Reduce 50%",
        dismissLabel: "Dismiss",
        dataLines: [],
      },
    });
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/riley/decisions",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { decisions: Array<{ kind: string; agentKey: string }> };
    expect(body.decisions).toHaveLength(1);
    expect(body.decisions[0]!.kind).toBe("approval");
    expect(body.decisions[0]!.agentKey).toBe("riley");
  });

  it("filters by agent key (decisions for other agents are excluded)", async () => {
    await emitRecommendation(ctx.app.recommendationStore!, {
      orgId: "org-1",
      agentKey: "alex",
      intent: "recommendation.lead_reply",
      action: "approve",
      humanSummary: "Approve reply to Maya",
      confidence: 0.7,
      dollarsAtRisk: 100,
      riskLevel: "low",
      parameters: {},
      presentation: {
        primaryLabel: "Approve",
        secondaryLabel: "Edit",
        dismissLabel: "Dismiss",
        dataLines: [],
      },
    });
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/riley/decisions",
      headers: { "x-org-id": "org-1" },
    });
    const body = res.json() as { decisions: Array<unknown> };
    expect(body.decisions).toHaveLength(0);
  });

  it("includes counts in the response", async () => {
    await emitRecommendation(ctx.app.recommendationStore!, {
      orgId: "org-1",
      agentKey: "alex",
      intent: "recommendation.x",
      action: "x",
      humanSummary: "x",
      confidence: 0.6,
      dollarsAtRisk: 100,
      riskLevel: "low",
      parameters: {},
      presentation: { primaryLabel: "a", secondaryLabel: "b", dismissLabel: "c", dataLines: [] },
    });
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/decisions",
      headers: { "x-org-id": "org-1" },
    });
    const body = res.json() as { counts: { total: number; approval: number; handoff: number } };
    expect(body.counts.total).toBeGreaterThanOrEqual(1);
    expect(body.counts).toHaveProperty("approval");
    expect(body.counts).toHaveProperty("handoff");
  });
});
```

- [ ] **Step 5: Run to verify FAIL**

```bash
pnpm --filter @switchboard/api test api-decisions
```

Expected: FAIL — route 404.

- [ ] **Step 6: Implement the route**

Create `apps/api/src/routes/decisions.ts`:

```ts
import type { FastifyPluginAsync } from "fastify";
import {
  type Decision,
  adaptRecommendation,
  adaptHandoff,
  decisionSortComparator,
} from "@switchboard/core";
import { type AgentKey, isAgentKey } from "@switchboard/schemas";
import { requireOrganizationScope } from "../utils/require-org.js";

async function listDecisions(
  app: import("fastify").FastifyInstance,
  orgId: string,
  agentKey: AgentKey | null,
): Promise<{
  decisions: Decision[];
  counts: { total: number; approval: number; handoff: number };
}> {
  if (!app.recommendationStore || !app.handoffStore || !app.contactStore || !app.threadStore) {
    throw new Error("Decision feed dependencies not wired");
  }
  const [recs, handoffs] = await Promise.all([
    app.recommendationStore.listBySurface({
      orgId,
      surface: "queue",
      status: "pending",
      limit: 50,
    }),
    app.handoffStore.listPending(orgId),
  ]);

  const contactIds = handoffs.map((h) => h.leadId).filter((x): x is string => !!x);
  const [contacts, threads] = await Promise.all([
    app.contactStore.listByIds(orgId, contactIds),
    app.threadStore.listByContactIds(orgId, contactIds),
  ]);

  const decisions: Decision[] = [
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

function serializeDecision(d: Decision) {
  return {
    ...d,
    createdAt: d.createdAt.toISOString(),
    meta: {
      ...d.meta,
      slaDeadlineAt: d.meta.slaDeadlineAt?.toISOString(),
      undoableUntil: d.meta.undoableUntil?.toISOString(),
    },
  };
}

export const decisionsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/agents/:key/decisions",
    {
      schema: {
        description: "Decision feed for one agent (recommendations + handoffs).",
        tags: ["Dashboard"],
        params: {
          type: "object",
          properties: { key: { type: "string" } },
          required: ["key"],
        },
      },
    },
    async (request, reply) => {
      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;
      const { key } = request.params as { key: string };
      if (!isAgentKey(key)) {
        return reply.code(400).send({ error: `Unknown agent key: ${key}`, statusCode: 400 });
      }
      const result = await listDecisions(app, orgId, key);
      return reply.code(200).send({
        decisions: result.decisions.map(serializeDecision),
        counts: result.counts,
      });
    },
  );

  app.get(
    "/decisions",
    {
      schema: {
        description: "Cross-agent inbox feed (recommendations + handoffs).",
        tags: ["Dashboard"],
      },
    },
    async (request, reply) => {
      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;
      const result = await listDecisions(app, orgId, null);
      return reply.code(200).send({
        decisions: result.decisions.map(serializeDecision),
        counts: result.counts,
      });
    },
  );
};
```

- [ ] **Step 7: Register both prefixes**

In `apps/api/src/bootstrap/routes.ts`:

```diff
+ import { decisionsRoutes } from "../routes/decisions.js";
  // …
+ // Two prefixes share the same plugin (per-agent + cross-agent paths).
+ await app.register(decisionsRoutes, { prefix: "/api/dashboard" });
```

The plugin's two routes are `/agents/:key/decisions` and `/decisions`, so both resolve correctly under `/api/dashboard`.

- [ ] **Step 8: Run to verify PASS**

```bash
pnpm --filter @switchboard/api test api-decisions
```

Expected: PASS.

- [ ] **Step 9: Add the cross-tenant isolation test**

Create `apps/api/src/__tests__/api-decisions-isolation.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildTestServer, type TestContext } from "./test-server.js";
import { emitRecommendation } from "@switchboard/core";

describe("GET /api/dashboard/decisions — cross-tenant isolation", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await buildTestServer();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it("does not leak decisions from another org", async () => {
    await emitRecommendation(ctx.app.recommendationStore!, {
      orgId: "org-A",
      agentKey: "alex",
      intent: "recommendation.x",
      action: "x",
      humanSummary: "secret-A",
      confidence: 0.6,
      dollarsAtRisk: 100,
      riskLevel: "low",
      parameters: {},
      presentation: { primaryLabel: "p", secondaryLabel: "s", dismissLabel: "d", dataLines: [] },
    });
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/decisions",
      headers: { "x-org-id": "org-B" },
    });
    const body = res.json() as { decisions: Array<{ humanSummary: string }> };
    const summaries = body.decisions.map((d) => d.humanSummary);
    expect(summaries).not.toContain("secret-A");
  });
});
```

Run + commit:

```bash
pnpm --filter @switchboard/api test api-decisions-isolation
git add apps/api/src/routes/decisions.ts \
        apps/api/src/bootstrap/routes.ts \
        apps/api/src/app.ts \
        apps/api/src/__tests__/test-server.ts \
        apps/api/src/__tests__/api-decisions.test.ts \
        apps/api/src/__tests__/api-decisions-isolation.test.ts
git commit -m "feat(api): GET /api/dashboard/[agents/:key/]decisions endpoint + isolation"
```

---

### Task 3.10: PR 3 verification + push

- [ ] **Step 1: Full sweep**

```bash
pnpm reset && pnpm typecheck && pnpm test
```

Expected: green.

- [ ] **Step 2: Push + open PR 3**

```bash
git push -u origin feat/decision-feed
gh pr create --title "feat(core,api): 2-source Decision Feed (Slice A PR 3)" --body "$(cat <<'EOF'
## Summary

PR 3 of 4 for Slice A. Ships the unified Decision type, two source adapters (recommendation pass-through + handoff prose composition), per-kind urgency scoring, and the read endpoint that merges them.

- New module `packages/core/src/decisions/` with `Decision` type, `urgency.ts` (two scorers + sort comparator), `agent-key-resolver.ts`, `adapters/{recommendation,handoff}-adapter.ts`.
- Vertical-tuned: $2k recommendation dollar cap reflects med spa / beauty / dental LTV bands.
- New batch methods: `ContactStore.listByIds(orgId, ids)` and `ConversationThreadStore.listByContactIds(orgId, contactIds)` to avoid N+1.
- New routes: `GET /api/dashboard/agents/:key/decisions` (per-agent) and `GET /api/dashboard/decisions` (cross-agent inbox).
- DecisionKind union is `"approval" | "handoff"` — escalation deferred per spec §1 (EscalationRecord is internal telemetry today).
- Cross-tenant isolation test added.

Spec: `docs/superpowers/specs/2026-05-03-agent-roster-and-decision-feed-design.md`

## Test plan

- [ ] `pnpm typecheck && pnpm test` green
- [ ] Manual: `curl /api/dashboard/agents/alex/decisions` for a seeded dev org returns the right shape

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

PR 3 is shippable independently of PR 4. Wait for review/merge before PR 4.

---

# PR 4 — Frontend wires (hook + view-model)

**Branch:** `feat/decision-feed-frontend` off `main` after PR 3 merges.
**Outcome:** dashboard has a `useDecisionFeed` hook + view-model bridge ready for the Slice B2 Decision Card UI to consume.

---

### Task 4.1: Extend `scopedKeys` with the `decisions` family

**Files:**

- Modify: `apps/dashboard/src/lib/query-keys.ts` (the `scopedKeys` factory)

- [ ] **Step 1: Add the decisions family**

In `apps/dashboard/src/lib/query-keys.ts`, inside the `scopedKeys = (orgId: string) => ({ ... })` factory, add (in alphabetical position):

```ts
decisions: {
  all: () => [orgId, "decisions"] as const,
  feed: (agentKey: string | null) =>
    [orgId, "decisions", "feed", agentKey ?? "all"] as const,
},
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @switchboard/dashboard typecheck
git add apps/dashboard/src/lib/query-keys.ts
git commit -m "feat(dashboard): scopedKeys.decisions family for the decision feed cache"
```

---

### Task 4.2: Create the frontend `Decision` types

**Files:**

- Create: `apps/dashboard/src/lib/decisions/types.ts`

- [ ] **Step 1: Create the file**

```ts
import type { AgentKey } from "@switchboard/schemas";

// Slice A: 2 kinds (matches the backend type — see spec §1).
export type DecisionKind = "approval" | "handoff";

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
  /** ISO string — backend serializes Date → string for the wire. */
  createdAt: string;
  threadHref: string | null;
  sourceRef: { kind: DecisionKind; sourceId: string };
  meta: {
    contactName?: string;
    /** ISO string. */
    slaDeadlineAt?: string;
    riskLevel?: "low" | "medium" | "high";
    /** ISO string. */
    undoableUntil?: string;
  };
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @switchboard/dashboard typecheck
git add apps/dashboard/src/lib/decisions/types.ts
git commit -m "feat(dashboard): frontend Decision types (Date → ISO string mirror)"
```

---

### Task 4.3: Create the view-model bridge

**Files:**

- Create: `apps/dashboard/src/lib/decisions/map-to-decision-card.ts`
- Create: `apps/dashboard/src/lib/decisions/__tests__/map-to-decision-card.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import { mapToDecisionCard } from "../map-to-decision-card.js";
import type { Decision } from "../types.js";

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: "approval:rec-1",
    kind: "approval",
    agentKey: "alex",
    humanSummary: "Should I send Maya the membership comparison?",
    presentation: {
      primaryLabel: "Yes, send it",
      secondaryLabel: "Not yet",
      dismissLabel: "Dismiss",
      dataLines: [],
    },
    urgencyScore: 78,
    createdAt: new Date(Date.now() - 2 * 24 * 3_600_000).toISOString(),
    threadHref: "/contacts/maya/conversations",
    sourceRef: { kind: "approval", sourceId: "rec-1" },
    meta: { contactName: "Maya R." },
    ...overrides,
  };
}

describe("mapToDecisionCard", () => {
  it("composes the folio kindLabel with the index", () => {
    const props = mapToDecisionCard(makeDecision(), 0);
    expect(props.folio.kindLabel).toBe("DECISION 1");
  });

  it("composes a HANDOFF kindLabel for handoff kind", () => {
    const props = mapToDecisionCard(
      makeDecision({ kind: "handoff", sourceRef: { kind: "handoff", sourceId: "h-1" } }),
      0,
    );
    expect(props.folio.kindLabel).toBe("HANDOFF 1");
  });

  it("includes contact name in the right folio", () => {
    const props = mapToDecisionCard(makeDecision(), 0);
    expect(props.folio.rightFolio).toContain("MAYA R.");
  });

  it("uses '—' when contactName missing", () => {
    const props = mapToDecisionCard(makeDecision({ meta: {} }), 0);
    expect(props.folio.rightFolio).toContain("—");
  });

  it("passes pill labels through unchanged", () => {
    const props = mapToDecisionCard(makeDecision(), 0);
    expect(props.primaryLabel).toBe("Yes, send it");
    expect(props.secondaryLabel).toBe("Not yet");
    expect(props.dismissLabel).toBe("Dismiss");
  });

  it("passes threadHref through", () => {
    const props = mapToDecisionCard(makeDecision(), 0);
    expect(props.threadHref).toBe("/contacts/maya/conversations");
  });

  it("preserves source for action dispatch", () => {
    const props = mapToDecisionCard(makeDecision(), 0);
    expect(props.source).toEqual({ kind: "approval", sourceId: "rec-1" });
  });

  it("handoff right folio mentions DUE for SLA", () => {
    const slaIso = new Date(Date.now() + 4 * 3_600_000).toISOString();
    const props = mapToDecisionCard(
      makeDecision({
        kind: "handoff",
        sourceRef: { kind: "handoff", sourceId: "h-1" },
        meta: { contactName: "Priya M.", slaDeadlineAt: slaIso },
      }),
      0,
    );
    expect(props.folio.rightFolio).toContain("DUE");
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm --filter @switchboard/dashboard test map-to-decision-card
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `apps/dashboard/src/lib/decisions/map-to-decision-card.ts`:

```ts
import type { Decision, DecisionKind } from "./types.js";

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

function kindToFolioLabel(kind: DecisionKind): string {
  switch (kind) {
    case "approval":
      return "DECISION";
    case "handoff":
      return "HANDOFF";
  }
}

function composeRightFolio(d: Decision): string {
  const name = d.meta.contactName?.toUpperCase() ?? "—";
  if (d.kind === "handoff" && d.meta.slaDeadlineAt) {
    return `${name} · DUE ${formatRelative(new Date(d.meta.slaDeadlineAt))}`;
  }
  return `${name} — ${formatRelative(new Date(d.createdAt))} AGO`;
}

function formatRelative(target: Date): string {
  const diffMs = Math.abs(target.getTime() - Date.now());
  const hours = diffMs / 3_600_000;
  if (hours < 1) return `${Math.round(diffMs / 60_000)}M`;
  if (hours < 24) return `${Math.round(hours)}H`;
  return `${Math.round(hours / 24)}D`;
}
```

- [ ] **Step 4: Run + commit**

```bash
pnpm --filter @switchboard/dashboard test map-to-decision-card
git add apps/dashboard/src/lib/decisions/map-to-decision-card.ts \
        apps/dashboard/src/lib/decisions/__tests__/map-to-decision-card.test.ts
git commit -m "feat(dashboard): mapToDecisionCard view-model bridge for B2 cards"
```

---

### Task 4.4: Create the action dispatcher

**Files:**

- Create: `apps/dashboard/src/lib/decisions/dispatch-action.ts`
- Create: `apps/dashboard/src/lib/decisions/__tests__/dispatch-action.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { dispatchDecisionAction } from "../dispatch-action.js";

beforeEach(() => {
  global.fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }) as unknown as typeof fetch;
});

describe("dispatchDecisionAction", () => {
  it("approval primary calls POST /api/recommendations/:id/act with action='primary'", async () => {
    await dispatchDecisionAction({ kind: "approval", sourceId: "rec-1" }, "primary");
    expect(fetch).toHaveBeenCalledWith(
      "/api/recommendations/rec-1/act",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"action":"primary"'),
      }),
    );
  });

  it("approval includes optional note in payload", async () => {
    await dispatchDecisionAction({ kind: "approval", sourceId: "rec-1" }, "secondary", {
      note: "n",
    });
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1]!.body);
    expect(body.note).toBe("n");
  });

  it("handoff primary calls /api/escalations/:id/reply (NOT /api/handoffs/*)", async () => {
    await dispatchDecisionAction({ kind: "handoff", sourceId: "h-1" }, "primary", {
      message: "Got it.",
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/escalations/h-1/reply",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"message":"Got it."'),
      }),
    );
  });

  it("handoff secondary/dismiss call /api/escalations/:id/resolve", async () => {
    await dispatchDecisionAction({ kind: "handoff", sourceId: "h-1" }, "secondary", {
      resolutionNote: "snooze",
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/escalations/h-1/resolve",
      expect.objectContaining({ method: "POST" }),
    );
    await dispatchDecisionAction({ kind: "handoff", sourceId: "h-1" }, "dismiss");
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/escalations/h-1/resolve",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("handoff primary with no message sends empty string (B2 must surface composer)", async () => {
    await dispatchDecisionAction({ kind: "handoff", sourceId: "h-1" }, "primary");
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1]!.body);
    expect(body.message).toBe("");
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm --filter @switchboard/dashboard test dispatch-action
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `apps/dashboard/src/lib/decisions/dispatch-action.ts`:

```ts
import type { DecisionKind } from "./types.js";

/**
 * Slice B2 will define richer types for action payloads. Slice A locks only
 * the dispatch contract — sourceRef.kind drives which existing route to hit.
 *
 * IMPORTANT: handoff actions go through /api/escalations/:id/{reply|resolve}
 * (legacy naming — the route operates on Handoff rows; see spec §9). There
 * is NO /api/handoffs/* route.
 */
export async function dispatchDecisionAction(
  source: { kind: DecisionKind; sourceId: string },
  action: "primary" | "secondary" | "dismiss",
  payload?: { message?: string; resolutionNote?: string; note?: string },
): Promise<void> {
  switch (source.kind) {
    case "approval":
      await fetch(`/api/recommendations/${source.sourceId}/act`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: payload?.note }),
      });
      return;

    case "handoff":
      // primary → reply (operator takes over)
      // secondary/dismiss → resolve
      // The reply payload requires a message; if absent, B2's UI must surface a composer first.
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

- [ ] **Step 4: Run + commit**

```bash
pnpm --filter @switchboard/dashboard test dispatch-action
git add apps/dashboard/src/lib/decisions/dispatch-action.ts \
        apps/dashboard/src/lib/decisions/__tests__/dispatch-action.test.ts
git commit -m "feat(dashboard): dispatchDecisionAction routes to existing per-kind endpoints"
```

---

### Task 4.5: Create `useDecisionFeed` hook

**Files:**

- Create: `apps/dashboard/src/hooks/use-decision-feed.ts`

- [ ] **Step 1: Implement the hook**

(No test for this file — it's a thin React Query wrapper following the same pattern as `useApprovals`. Existing dashboard hook tests don't unit-test the wrappers themselves; they test the components that consume them.)

```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import type { AgentKey } from "@switchboard/schemas";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
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

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @switchboard/dashboard typecheck
git add apps/dashboard/src/hooks/use-decision-feed.ts
git commit -m "feat(dashboard): useDecisionFeed hook + useInboxCount derived hook"
```

---

### Task 4.6: PR 4 verification + push

- [ ] **Step 1: Full sweep**

```bash
pnpm typecheck && pnpm test
```

Expected: green.

- [ ] **Step 2: Manual smoke check (optional but recommended)**

If you have a local dev stack running:

```bash
pnpm dev
# In another terminal, after seeding a recommendation for org_dev:
curl -s http://localhost:3000/api/dashboard/agents/alex/decisions \
  -H "x-org-id: org_dev" | jq
```

Expected: a JSON response with `decisions` (array) and `counts`.

- [ ] **Step 3: Push + open PR 4**

```bash
git push -u origin feat/decision-feed-frontend
gh pr create --title "feat(dashboard): useDecisionFeed hook + view-model bridge (Slice A PR 4)" --body "$(cat <<'EOF'
## Summary

PR 4 of 4 for Slice A — the final piece. Adds the React Query hook that consumes the Decision Feed endpoint, the `Decision` type mirror, the `mapToDecisionCard` view-model bridge, and the `dispatchDecisionAction` function that routes button clicks to the right existing per-kind endpoint.

- New hook: `useDecisionFeed(agentKey)` — refetches every 60s like `useApprovals`.
- New helper hook: `useInboxCount()` derived from the cross-agent feed.
- `scopedKeys.decisions` family added.
- Frontend `Decision` type (Date → ISO string mirror).
- `mapToDecisionCard(decision, index)` produces props for the (Slice B2) card UI.
- `dispatchDecisionAction` routes:
  - approval → `POST /api/recommendations/:id/act`
  - handoff primary → `POST /api/escalations/:id/reply`
  - handoff secondary/dismiss → `POST /api/escalations/:id/resolve`

No card UI lands here — that's Slice B2.

Spec: `docs/superpowers/specs/2026-05-03-agent-roster-and-decision-feed-design.md`

## Test plan

- [ ] `pnpm typecheck && pnpm test` green
- [ ] Manual: with a seeded recommendation, `useDecisionFeed("alex")` resolves and returns the row in the test harness or via dev server

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

# Plan self-review

Cross-checking the plan against the spec:

**1. Spec coverage:**

| Spec section                                        | Implemented in                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------- |
| §4 AGENT_REGISTRY                                   | Task 1.1                                                              |
| §5 OrgAgentEnablement model + backfill              | Task 2.1                                                              |
| §5 OrgAgentEnablementStore interface                | Task 2.2                                                              |
| §5 In-memory + Prisma stores                        | Tasks 2.3, 2.4                                                        |
| §5 Backfill + seed helper                           | Tasks 2.1 (SQL), 2.5 (helper), 2.6 (call-sites)                       |
| §5 GET /api/dashboard/agents                        | Task 2.7                                                              |
| §6 Decision type                                    | Task 3.3                                                              |
| §7.1 recommendation-adapter                         | Task 3.6                                                              |
| §7.2 handoff-adapter                                | Task 3.7                                                              |
| §7.3 agent-key-resolver                             | Task 3.5                                                              |
| §8 urgency.ts                                       | Task 3.4                                                              |
| §9 read endpoint                                    | Task 3.9                                                              |
| §10 frontend hook + types + view-model + dispatcher | Tasks 4.2, 4.3, 4.4, 4.5                                              |
| §10 query-keys family                               | Task 4.1                                                              |
| §11 naming reconciliation                           | Tasks 1.2, 1.3, 1.5, 1.6                                              |
| §12 useAgentFirstNav column                         | Task 2.1 (column), 2.6 (set true on create), 2.8 (surface in payload) |
| §13 PR sequencing                                   | Tasks 1.7, 2.9, 3.10, 4.6                                             |
| §14 vertical fit                                    | Task 3.4 ($2k cap), Task 3.7 (handoff prose), Task 3.5 (default-Alex) |
| §15 testing                                         | Each task has a test step; cross-tenant tests in 2.7, 3.9             |

No gaps. Every spec requirement maps to at least one task.

**2. Placeholder scan:** No "TBD", "TODO", or "implement later" instructions. Every step shows actual code, exact commands, or specific file diffs.

**3. Type consistency:**

- `AgentKey` defined in Task 1.1, consumed identically in 1.2, 2.2, 2.3, 2.4, 3.3, 3.5, 4.1, 4.2.
- `OrgAgentEnablementStore` defined in 2.2, implemented in 2.3 + 2.4, consumed in 2.7.
- `Decision` defined in 3.3 (core) and 4.2 (frontend mirror); used in 3.6, 3.7, 3.9, 4.3, 4.5.
- `decisionSortComparator` defined in 3.4, used in 3.9.
- `dispatchDecisionAction` test in 4.4 matches implementation; references real routes (`/api/recommendations/:id/act`, `/api/escalations/:id/{reply|resolve}`).
- `seedOrgDayOneAgents` defined in 2.5, consumed in 2.6 with the correct signature `(prisma, orgId)`.

All consistent.

---

## Plan complete and saved to `docs/superpowers/plans/2026-05-03-agent-roster-and-decision-feed.md`

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for high-velocity execution with quality checkpoints.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review. Best when you want to follow along closely.

**Which approach?**
