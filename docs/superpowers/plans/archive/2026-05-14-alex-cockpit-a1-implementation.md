# Alex Cockpit A.1 — Shell + Basic Composition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the shared cockpit shell and the smallest Alex composition that renders at `/alex`, using only existing data sources (no new API routes, no schema changes, no command palette, no KPI/ROI, no old-component deletion).

**Architecture:** New `apps/dashboard/src/components/cockpit/` directory hosts the shared shell components (Topbar, Identity, status pill, ApprovalBlock, ActivityStream, composer placeholder, CockpitPage). Adapters in `apps/dashboard/src/lib/cockpit/` translate existing hook outputs (`usePendingApprovals`, `useAgentActivity`, `useAgentGreeting`, `useHalt`) into the shell's view-models. `agent-home-client.tsx` branches on `agentKey === "alex"` → `<CockpitPage>`; other agents fall through to a renamed `LegacyAgentHomeClient`. No backend changes.

**Heads-up — fixture vs live in dev:** `usePendingApprovals` is gated by `isMercuryToolLive("approvals")` which reads `NEXT_PUBLIC_APPROVALS_LIVE`. The env var is **false by default**, which means the cockpit will render the Mercury approval fixtures (not real backend data) when running `pnpm dev` out of the box. This is the existing behavior of `/approvals` and is not a bug. To exercise A.1 against the real `/api/dashboard/approvals` endpoint, set `NEXT_PUBLIC_APPROVALS_LIVE=true` in `apps/dashboard/.env.local`. A.1 does not change this gating.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript (ESM, `.js` extensions in relative imports per `CLAUDE.md`), Vitest + `@testing-library/react`, Tailwind for layout primitives only (page-local cockpit tokens live in `tokens.ts`, not promoted to globals).

**Parent spec:** [`docs/superpowers/specs/2026-05-14-alex-cockpit-home-design.md`](../specs/2026-05-14-alex-cockpit-home-design.md) (§Implementation slices → A.1)
**Slice brief:** [`2026-05-14-alex-cockpit-a1-slice-brief.md`](./2026-05-14-alex-cockpit-a1-slice-brief.md) (scope + what does NOT ship)

> **The slice brief is authoritative.** If anything in this implementation plan appears to expand A.1's scope beyond the brief — new files, new behaviors, new props — the brief wins and the conflicting text in this plan is wrong. Resolve in favor of the brief and flag the discrepancy.

---

## File Structure

### Created files

| Path                                                                         | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/dashboard/src/components/cockpit/tokens.ts`                            | Page-local color tokens (`T = { bg, paper, ink, ink2..ink5, hair, hairSoft, amber*, green, red, blue }`). Not promoted to globals — see spec §Visual tokens.                                                                                                                                                                                                                                                                                                                                               |
| `apps/dashboard/src/components/cockpit/kind-meta.ts`                         | `KIND_META` table — Alex activity-kind labels/colors (`booked`/`qualified`/`replied`/`sent`/`started`/`connected`/`waiting`/`escalated`/`passed`). Riley kinds added by Riley's PR.                                                                                                                                                                                                                                                                                                                        |
| `apps/dashboard/src/components/cockpit/types.ts`                             | `CockpitStatus` union, `ApprovalView` (Alex+Riley union types; A.1 only exercises Alex variant), `ActivityRow`, `ThreadMessage`, `MissionViewModel` (typed but populated statically at A.1).                                                                                                                                                                                                                                                                                                               |
| `apps/dashboard/src/components/cockpit/dot.tsx`                              | `<Dot color pulse size />` primitive. Reused by status pill and (later) channel dots.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/dashboard/src/components/cockpit/status-pill.tsx`                      | `<StatusPill statusKey halted />` — dot + label, pulse rules per Alex config.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `apps/dashboard/src/components/cockpit/topbar.tsx`                           | `<Topbar paletteEnabled={false} compact />` — brand mark + wordmark, tabs from `alex-config`, "Tell Alex…" affordance rendered **disabled** (no click handler, no keyboard shortcut) at A.1; flips to enabled at A.5.                                                                                                                                                                                                                                                                                      |
| `apps/dashboard/src/components/cockpit/identity.tsx`                         | `<Identity statusKey halted subtitle line onHaltToggle compact />` — avatar frame, name, status pill, plain non-interactive subtitle, optional `line` from greeting hook, Halt button. **No `onEditMission` prop at A.1.**                                                                                                                                                                                                                                                                                 |
| `apps/dashboard/src/components/cockpit/approval-card.tsx`                    | `<ApprovalCard data idx total onResolve variant compact />` — eyebrow + title + body + quote + risk + primary/secondary buttons.                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/dashboard/src/components/cockpit/approval-block.tsx`                   | `<ApprovalBlock data onResolve variant compact />` — array-tolerant wrapper that maps to `<ApprovalCard>`.                                                                                                                                                                                                                                                                                                                                                                                                 |
| `apps/dashboard/src/components/cockpit/activity-row.tsx`                     | `<ActivityRow item open toggle variant compact />` — collapsed-only render at A.1 (expand-to-preview gated false at A.1).                                                                                                                                                                                                                                                                                                                                                                                  |
| `apps/dashboard/src/components/cockpit/activity-stream.tsx`                  | `<ActivityStream data filter setFilter openSet toggleOpen variant compact />` — filter buttons (`all` / `booked` / `escalations`) + rows; empty-state placeholder.                                                                                                                                                                                                                                                                                                                                         |
| `apps/dashboard/src/components/cockpit/composer-placeholder.tsx`             | Static inert bar "Tell Alex what to do — coming soon". Replaced by real composer at A.5.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/dashboard/src/components/cockpit/cockpit-page.tsx`                     | Top-level composition reading existing hooks, passing view-models to shell components.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/dashboard/src/lib/cockpit/alex-config.ts`                              | `ALEX_ACCENT`, static `ALEX_MISSION_SUBTITLE`, `statusColor`, `statusPulse`, `animState`, `tabs`. Ported from `alex-config.jsx` minus mission rows / commands / composer placeholder / toastVoice (those land later).                                                                                                                                                                                                                                                                                      |
| `apps/dashboard/src/lib/cockpit/legacy-pending-approval-to-approval-view.ts` | Pure adapter: `(approval: PendingApproval) => AlexApprovalView`. Maps `riskCategory` → cockpit urgency, projects `summary` to `title`, carries `bindingHash`/`createdAt`. **Limitation:** the existing wire shape doesn't carry `kind` — every approval surfaces as `kind: "pricing"` (the generic approval card). Rich kind classification (refund / regulatory / safety-gate / escalation) waits for `Approval.payload.kind` in A.5. The `legacy` prefix flags this as the pre-schema-extension adapter. |
| `apps/dashboard/src/lib/cockpit/activity-kind-map.ts`                        | Pure adapter: `(translatedAction: TranslatedAction) => ActivityRow`. Maps existing `eventType` strings to cockpit `ActivityKind`.                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/dashboard/src/lib/cockpit/relative-age.ts`                             | Client-side relative-age formatter ("4 min ago", "2 h ago", "Fri"). Independent of `packages/core/src/agent-home/relative-age.ts` (server-side).                                                                                                                                                                                                                                                                                                                                                           |
| `apps/dashboard/src/hooks/use-cockpit-status.ts`                             | `deriveAlexStatusA1(input)` pure derivation + React hook wrapping `useHalt`/`usePendingApprovals`/`useAgentActivity`.                                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/dashboard/src/app/(auth)/[agentKey]/legacy-agent-home-client.tsx`      | Verbatim copy of today's `agent-home-client.tsx` body. Deleted at A.6.                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### Modified files

| Path                                                                            | Change                                                                                               |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `apps/dashboard/src/app/(auth)/[agentKey]/agent-home-client.tsx`                | Replace body with per-agent branch: `agentKey === "alex" ? <CockpitPage> : <LegacyAgentHomeClient>`. |
| `apps/dashboard/src/app/(auth)/[agentKey]/__tests__/agent-home-client.test.tsx` | Add test asserting branch behavior; existing assertions follow the legacy client.                    |

### Test files (created with their subjects)

Each component / adapter / hook gets a co-located test under `__tests__/`. Test paths follow each created file's directory.

---

## Cross-task references

These are referenced by multiple tasks. Defined once here:

**Path constants:**

- Cockpit components root: `apps/dashboard/src/components/cockpit/`
- Cockpit lib root: `apps/dashboard/src/lib/cockpit/`
- Test runner: `pnpm --filter @switchboard/dashboard test`
- Single-file test: `pnpm --filter @switchboard/dashboard test -- <path>`

**Pre-flight (run once before Task 1):**

```bash
git worktree add -b feat/alex-cockpit-a1 /Users/jasonli/switchboard/.worktrees/alex-cockpit-a1 main
cd /Users/jasonli/switchboard/.worktrees/alex-cockpit-a1
pnpm worktree:init
```

Expected: `.env` copied, dev ports cleared, `pnpm db:migrate` runs (or skips if Postgres unreachable — fine for this UI-only branch).

---

## Commit strategy

The 20 tasks below are TDD-granular for clarity. **Commit at 5 group boundaries** — not after every task:

| Commit                | Covers tasks                                                                                                                  | Subject                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1 — foundations       | 1–5 (tokens, types, kind-meta, alex-config, relative-age)                                                                     | `feat(cockpit): foundations — tokens, types, kind-meta, config, relative-age (A.1)`          |
| 2 — adapters + status | 6–8 (legacy-pending-approval adapter, activity-kind-map, use-cockpit-status)                                                  | `feat(cockpit): adapters + status derivation (A.1)`                                          |
| 3 — components        | 9–17 (dot, status-pill, topbar, identity, approval-card, approval-block, activity-row, activity-stream, composer-placeholder) | `feat(cockpit): shell components — identity, approval, activity, composer placeholder (A.1)` |
| 4 — page composition  | 18 (cockpit-page)                                                                                                             | `feat(cockpit): compose CockpitPage reading existing hooks (A.1)`                            |
| 5 — page branching    | 19 (agent-home-client branch + legacy file)                                                                                   | `feat(cockpit): branch /alex to CockpitPage; preserve legacy for riley/mira (A.1)`           |

Within each group, **stage incrementally** (`git add ...`) but **defer `git commit` to the boundary task**. The per-task "Step 5: Commit" entries below show what to stage; the actual `git commit` invocation runs only at Tasks 5, 8, 17, 18, 19.

If a per-task commit-step block below shows `git commit -m ...` and the task is not a boundary, treat it as the stage-only subset — drop the commit line until the group boundary.

## Tasks

### Task 1: Tokens

**Files:**

- Create: `apps/dashboard/src/components/cockpit/tokens.ts`
- Test: `apps/dashboard/src/components/cockpit/__tests__/tokens.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/dashboard/src/components/cockpit/__tests__/tokens.test.ts
import { describe, it, expect } from "vitest";
import { T } from "../tokens.js";

describe("cockpit tokens", () => {
  it("exports the canonical color palette from the locked design", () => {
    expect(T.bg).toBe("#FAF8F2");
    expect(T.paper).toBe("#FFFFFF");
    expect(T.ink).toBe("#0E0C0A");
    expect(T.amber).toBe("#B8782E");
    expect(T.amberDeep).toBe("#7C4F1C");
    expect(T.green).toBe("#3F7A36");
    expect(T.red).toBe("#A03A2E");
    expect(T.blue).toBe("#3A5A80");
  });
});
```

- [ ] **Step 2: Run test, expect FAIL ("Cannot find module")**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/tokens.test.ts
```

Expected: `Cannot find module '../tokens.js'` or similar.

- [ ] **Step 3: Implement**

```ts
// apps/dashboard/src/components/cockpit/tokens.ts
export const T = {
  bg: "#FAF8F2",
  paper: "#FFFFFF",
  ink: "#0E0C0A",
  ink2: "#3A332B",
  ink3: "#6B6052",
  ink4: "#A39786",
  ink5: "#C8BEAE",
  hair: "rgba(14, 12, 10, 0.08)",
  hairSoft: "rgba(14, 12, 10, 0.04)",
  amber: "#B8782E",
  amberDeep: "#7C4F1C",
  amberSoft: "#F1E2C2",
  amberPaper: "#FBF1D6",
  green: "#3F7A36",
  red: "#A03A2E",
  blue: "#3A5A80",
} as const;

export type CockpitToken = keyof typeof T;
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/tokens.test.ts
```

Expected: 1 passing.

- [ ] **Step 5: Stage (commit deferred to group boundary)**

```bash
git add apps/dashboard/src/components/cockpit/tokens.ts apps/dashboard/src/components/cockpit/__tests__/tokens.test.ts
git commit -m "feat(cockpit): add page-local color tokens (A.1)"
```

---

### Task 2: Types

**Files:**

- Create: `apps/dashboard/src/components/cockpit/types.ts`
- Test: `apps/dashboard/src/components/cockpit/__tests__/types.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/dashboard/src/components/cockpit/__tests__/types.test.ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  CockpitStatus,
  ApprovalView,
  ActivityRow,
  ActivityKind,
  ThreadMessage,
  MissionViewModel,
} from "../types.js";

describe("cockpit types", () => {
  it("CockpitStatus union covers A.1 + Riley + future TALKING", () => {
    expectTypeOf<CockpitStatus>().toEqualTypeOf<
      "IDLE" | "WORKING" | "TALKING" | "WAITING" | "WATCHING" | "REVIEWING" | "HALTED"
    >();
  });

  it("ApprovalView carries the shared base shape", () => {
    const sample: ApprovalView = {
      id: "appr_1",
      kind: "pricing",
      urgency: "this_week",
      askedAt: "4 min ago",
      title: "Send Jordan the founding-member rate?",
      presentation: { primaryLabel: "Accept & send", dismissLabel: "Decline" },
      primary: "Accept & send",
      secondary: "Decline",
      primaryAction: { kind: "respond", bindingHash: "abc", verdict: "accept" },
    };
    expectTypeOf(sample.id).toEqualTypeOf<string>();
  });

  it("ActivityRow has time/kind/head plus optional body/preview", () => {
    const sample: ActivityRow = { time: "11:58", kind: "replied", head: "Devon K." };
    expectTypeOf(sample.body).toEqualTypeOf<string | undefined>();
    expectTypeOf(sample.preview).toEqualTypeOf<ThreadMessage[] | undefined>();
  });

  it("ActivityKind includes Alex kinds", () => {
    const kinds: ActivityKind[] = [
      "booked",
      "qualified",
      "replied",
      "sent",
      "started",
      "connected",
      "waiting",
      "escalated",
      "passed",
    ];
    expect(kinds).toHaveLength(9);
  });

  it("MissionViewModel rows tuple optionally carries a dot color", () => {
    const vm: MissionViewModel = {
      subtitle: "SDR · Tours pipeline · HotPod",
      title: "What is Alex configured for?",
      rows: [
        ["ROLE", "SDR · qualify inbound leads, book tours"],
        ["CHANNELS", "Meta Ads", "ok"],
      ],
    };
    expectTypeOf(vm.rows[0]).toBeArray();
  });
});
```

(Note: `expectTypeOf` requires `vitest` ≥ 0.x with the type API; if the project doesn't have it, the test asserts shape via sample-typed values only. `expect` is still in scope for the `kinds.toHaveLength` assertion. If `expectTypeOf` is unavailable, drop that line and rely on the sample-value tests.)

- [ ] **Step 2: Run test, expect FAIL ("Cannot find module")**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/types.test.ts
```

Expected: missing module error.

- [ ] **Step 3: Implement**

```ts
// apps/dashboard/src/components/cockpit/types.ts

export type CockpitStatus =
  | "IDLE"
  | "WORKING"
  | "TALKING"
  | "WAITING"
  | "WATCHING"
  | "REVIEWING"
  | "HALTED";

export interface MissionViewModel {
  subtitle: string;
  title: string;
  rows: Array<[string, string] | [string, string, "ok" | "warn" | "off"]>;
}

export type AlexApprovalKind =
  | "pricing"
  | "refund"
  | "qualification"
  | "regulatory"
  | "safety-gate"
  | "escalation";

export type RileyApprovalKind =
  | "pause"
  | "scale"
  | "refresh_creative"
  | "restructure"
  | "shift_budget_to_source"
  | "switch_optimization_event"
  | "harden_capi_attribution"
  | "hold"
  | "add_creative"
  | "review_budget"
  | "signal_health_group";

export type ApprovalUrgency = "immediate" | "this_week" | "next_cycle";

interface ApprovalViewBase {
  id: string;
  urgency: ApprovalUrgency;
  askedAt: string;
  title: string;
  body?: string;
  quote?: string;
  quoteFrom?: string;
  risk?: string;
  presentation: { primaryLabel: string; dismissLabel: string };
  primary: string;
  secondary: string;
  tertiaryLabel?: string;
  acceptToast?: string;
  declineToast?: string;
}

export type AlexApprovalView = ApprovalViewBase & {
  kind: AlexApprovalKind;
  primaryAction:
    | { kind: "respond"; bindingHash: string; verdict: "accept" | "deny" }
    | { kind: "internal"; intent: string; parameters: Record<string, unknown> };
};

export type RileyApprovalView = ApprovalViewBase & {
  kind: RileyApprovalKind;
  campaign:
    | { kind: "campaign"; name: string; id: string }
    | { kind: "account"; pixelId: string; breaches: number };
  confidence: number;
  learningPhaseImpact: "no impact" | "will reset learning";
  reversible: boolean;
  primaryAction:
    | { kind: "internal"; intent: string; parameters: Record<string, unknown> }
    | { kind: "external"; url: string; service: "meta" | "google" };
};

export type ApprovalView = AlexApprovalView | RileyApprovalView;

export interface ThreadMessage {
  from: string;
  text: string;
}

export type ActivityKind =
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

export interface ActivityRow {
  time: string;
  kind: ActivityKind;
  head: string;
  body?: string;
  who?: string;
  preview?: ThreadMessage[];
  replyable?: boolean;
  tag?: string;
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/types.test.ts
```

Expected: passing. If `expectTypeOf` is missing, remove those lines — sample-value typing still serves as compile-time validation.

- [ ] **Step 5: Stage (commit deferred to group boundary)**

```bash
git add apps/dashboard/src/components/cockpit/types.ts apps/dashboard/src/components/cockpit/__tests__/types.test.ts
git commit -m "feat(cockpit): add shared shell type definitions (A.1)"
```

---

### Task 3: Kind meta table

**Files:**

- Create: `apps/dashboard/src/components/cockpit/kind-meta.ts`
- Test: `apps/dashboard/src/components/cockpit/__tests__/kind-meta.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/dashboard/src/components/cockpit/__tests__/kind-meta.test.ts
import { describe, it, expect } from "vitest";
import { KIND_META, lookupKindMeta } from "../kind-meta.js";

describe("KIND_META", () => {
  it("includes all 9 Alex activity kinds", () => {
    const keys = Object.keys(KIND_META);
    for (const k of [
      "booked",
      "qualified",
      "replied",
      "sent",
      "started",
      "connected",
      "waiting",
      "escalated",
      "passed",
    ]) {
      expect(keys).toContain(k);
    }
  });

  it("does NOT include Riley kinds at A.1 (Riley PR adds them)", () => {
    const keys = Object.keys(KIND_META);
    for (const k of [
      "watching",
      "reviewing",
      "paused",
      "scaled",
      "rotated",
      "shifted",
      "restructured",
      "alert",
    ]) {
      expect(keys).not.toContain(k);
    }
  });

  it("`booked` uses amberDeep + amberSoft background", () => {
    expect(KIND_META.booked).toMatchObject({ label: "BOOKED", color: "#7C4F1C", bg: "#F1E2C2" });
  });

  it("`escalated` uses red", () => {
    expect(KIND_META.escalated).toMatchObject({ label: "TO YOU", color: "#A03A2E" });
  });

  it("`waiting` carries an amberDeep color with amberSoft background", () => {
    expect(KIND_META.waiting).toMatchObject({ label: "WAITING", color: "#7C4F1C", bg: "#F1E2C2" });
  });

  it("lookupKindMeta returns the Alex entry for a known kind", () => {
    expect(lookupKindMeta("booked")).toMatchObject({ label: "BOOKED" });
  });

  it("lookupKindMeta falls back to a neutral entry for an unmapped kind", () => {
    expect(lookupKindMeta("watching")).toMatchObject({ label: "WATCHING" });
  });
});
```

- [ ] **Step 2: Run test, expect FAIL ("Cannot find module")**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/kind-meta.test.ts
```

- [ ] **Step 3: Implement**

```ts
// apps/dashboard/src/components/cockpit/kind-meta.ts
import { T } from "./tokens.js";
import type { ActivityKind } from "./types.js";

export interface KindMetaEntry {
  label: string;
  color: string;
  bg: string;
  pulse?: boolean;
}

// A.1 ships Alex kinds only. Riley kinds (watching / reviewing / paused / scaled
// / rotated / shifted / restructured / alert) are typed in ActivityKind for
// shell prop-type compatibility but are NOT populated here. Riley's PR adds the
// entries when it wires Riley's activity stream.
export const KIND_META: Partial<Record<ActivityKind, KindMetaEntry>> = {
  booked: { label: "BOOKED", color: T.amberDeep, bg: T.amberSoft },
  qualified: { label: "QUALIFIED", color: T.amber, bg: T.amberSoft },
  replied: { label: "REPLIED", color: T.ink2, bg: "rgba(14,12,10,0.05)" },
  sent: { label: "SENT", color: T.ink3, bg: "rgba(14,12,10,0.04)" },
  started: { label: "STARTED", color: T.ink3, bg: "rgba(14,12,10,0.04)" },
  connected: { label: "LEADS IN", color: T.blue, bg: "rgba(58,90,128,0.08)" },
  waiting: { label: "WAITING", color: T.amberDeep, bg: T.amberSoft },
  escalated: { label: "TO YOU", color: T.red, bg: "rgba(160,58,46,0.08)" },
  passed: { label: "PASSED", color: T.ink4, bg: "rgba(14,12,10,0.04)" },
};

const NEUTRAL_FALLBACK: KindMetaEntry = {
  label: "",
  color: T.ink3,
  bg: "rgba(14,12,10,0.04)",
};

// Centralized lookup so renderers never have to handle the Partial<> nullability
// at call sites. Unknown kinds (e.g. a Riley row leaking into Alex's stream
// before Riley's PR lands) render with the uppercased kind name and neutral
// styling — no crash.
export function lookupKindMeta(kind: ActivityKind): KindMetaEntry {
  const entry = KIND_META[kind];
  if (entry) return entry;
  return { ...NEUTRAL_FALLBACK, label: kind.toUpperCase() };
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/kind-meta.test.ts
```

- [ ] **Step 5: Stage (commit deferred to group boundary)**

```bash
git add apps/dashboard/src/components/cockpit/kind-meta.ts apps/dashboard/src/components/cockpit/__tests__/kind-meta.test.ts
git commit -m "feat(cockpit): add KIND_META table for activity rows (A.1)"
```

---

### Task 4: Alex config

**Files:**

- Create: `apps/dashboard/src/lib/cockpit/alex-config.ts`
- Test: `apps/dashboard/src/lib/cockpit/__tests__/alex-config.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/dashboard/src/lib/cockpit/__tests__/alex-config.test.ts
import { describe, it, expect } from "vitest";
import { ALEX_CONFIG, statusColor, statusPulse, animState } from "../alex-config.js";

describe("alex-config", () => {
  it("uses warm amber accent", () => {
    expect(ALEX_CONFIG.accent.base).toBe("#B8782E");
    expect(ALEX_CONFIG.accent.deep).toBe("#7C4F1C");
  });

  it("exposes Alex/Riley/Mira tabs with Alex active and Mira muted", () => {
    expect(ALEX_CONFIG.tabs).toEqual([
      { name: "Alex", active: true },
      { name: "Riley" },
      { name: "Mira", muted: true },
    ]);
  });

  it("statusColor returns red when halted regardless of key", () => {
    expect(statusColor("WORKING", true)).toBe("#A03A2E");
    expect(statusColor("WAITING", true)).toBe("#A03A2E");
  });

  it("statusColor returns green for WORKING, amber for WAITING, grey for IDLE", () => {
    expect(statusColor("WORKING", false)).toBe("#3F7A36");
    expect(statusColor("WAITING", false)).toBe("#B8782E");
    expect(statusColor("IDLE", false)).toBe("#A39786");
  });

  it("statusPulse pulses only on WORKING/WAITING and never when halted", () => {
    expect(statusPulse("WORKING", false)).toBe(true);
    expect(statusPulse("WAITING", false)).toBe(true);
    expect(statusPulse("IDLE", false)).toBe(false);
    expect(statusPulse("WORKING", true)).toBe(false);
  });

  it("animState returns 'sleep' when halted, 'draft' when working/waiting, 'idle' otherwise", () => {
    expect(animState("WORKING", true)).toBe("sleep");
    expect(animState("WORKING", false)).toBe("draft");
    expect(animState("WAITING", false)).toBe("draft");
    expect(animState("IDLE", false)).toBe("idle");
  });
});
```

- [ ] **Step 2: Run test, expect FAIL ("Cannot find module")**

```bash
pnpm --filter @switchboard/dashboard test -- src/lib/cockpit/__tests__/alex-config.test.ts
```

- [ ] **Step 3: Implement**

```ts
// apps/dashboard/src/lib/cockpit/alex-config.ts
import { T } from "@/components/cockpit/tokens.js";
import type { CockpitStatus } from "@/components/cockpit/types.js";

export const ALEX_CONFIG = {
  name: "Alex",
  accent: {
    base: "#B8782E",
    deep: "#7C4F1C",
    soft: "#F1E2C2",
    paper: "#FBF1D6",
  },
  tabs: [{ name: "Alex", active: true }, { name: "Riley" }, { name: "Mira", muted: true }] as const,
  missionSubtitle: "SDR · Tours pipeline",
  needsYouLabel: "Alex needs you",
} as const;

export function statusColor(key: CockpitStatus, halted: boolean): string {
  if (halted) return T.red;
  if (key === "WORKING" || key === "TALKING") return T.green;
  if (key === "WAITING") return T.amber;
  return T.ink4;
}

export function statusPulse(key: CockpitStatus, halted: boolean): boolean {
  if (halted) return false;
  return key === "WORKING" || key === "WAITING" || key === "TALKING";
}

export function animState(key: CockpitStatus, halted: boolean): "sleep" | "draft" | "idle" {
  if (halted) return "sleep";
  if (key === "WORKING" || key === "WAITING" || key === "TALKING") return "draft";
  return "idle";
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/lib/cockpit/__tests__/alex-config.test.ts
```

- [ ] **Step 5: Stage (commit deferred to group boundary)**

```bash
git add apps/dashboard/src/lib/cockpit/alex-config.ts apps/dashboard/src/lib/cockpit/__tests__/alex-config.test.ts
git commit -m "feat(cockpit): add Alex static config + status helpers (A.1)"
```

---

### Task 5: Relative-age helper

**Files:**

- Create: `apps/dashboard/src/lib/cockpit/relative-age.ts`
- Test: `apps/dashboard/src/lib/cockpit/__tests__/relative-age.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/dashboard/src/lib/cockpit/__tests__/relative-age.test.ts
import { describe, it, expect } from "vitest";
import { relativeAge } from "../relative-age.js";

const NOW = new Date("2026-05-14T12:00:00Z");

describe("relativeAge", () => {
  it("returns 'just now' for < 60s ago", () => {
    expect(relativeAge(new Date("2026-05-14T11:59:30Z"), NOW)).toBe("just now");
  });
  it("returns N min ago for < 1h", () => {
    expect(relativeAge(new Date("2026-05-14T11:56:00Z"), NOW)).toBe("4 min ago");
  });
  it("returns N h ago for < 24h", () => {
    expect(relativeAge(new Date("2026-05-14T08:00:00Z"), NOW)).toBe("4 h ago");
  });
  it("returns 'Yesterday' for < 48h", () => {
    expect(relativeAge(new Date("2026-05-13T12:00:00Z"), NOW)).toBe("Yesterday");
  });
  it("returns weekday for < 7d", () => {
    expect(relativeAge(new Date("2026-05-09T12:00:00Z"), NOW)).toBe("Sat");
  });
  it("returns ISO date for older", () => {
    expect(relativeAge(new Date("2026-04-01T12:00:00Z"), NOW)).toBe("2026-04-01");
  });
});
```

- [ ] **Step 2: Run test, expect FAIL ("Cannot find module")**

```bash
pnpm --filter @switchboard/dashboard test -- src/lib/cockpit/__tests__/relative-age.test.ts
```

- [ ] **Step 3: Implement**

```ts
// apps/dashboard/src/lib/cockpit/relative-age.ts
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function relativeAge(then: Date, now: Date = new Date()): string {
  const deltaMs = now.getTime() - then.getTime();
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 2) return "Yesterday";
  if (days < 7) return WEEKDAYS[then.getUTCDay()]!;
  return then.toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/lib/cockpit/__tests__/relative-age.test.ts
```

- [ ] **Step 5: Stage + Commit 1 (group boundary — foundations)**

```bash
git add apps/dashboard/src/lib/cockpit/relative-age.ts apps/dashboard/src/lib/cockpit/__tests__/relative-age.test.ts
git commit -m "feat(cockpit): foundations — tokens, types, kind-meta, config, relative-age (A.1)"
```

Files in this commit (staged across Tasks 1–5):

- `apps/dashboard/src/components/cockpit/tokens.ts` + test
- `apps/dashboard/src/components/cockpit/types.ts` + test
- `apps/dashboard/src/components/cockpit/kind-meta.ts` + test
- `apps/dashboard/src/lib/cockpit/alex-config.ts` + test
- `apps/dashboard/src/lib/cockpit/relative-age.ts` + test

---

### Task 6: Legacy pending-approval → ApprovalView adapter

**Files:**

- Create: `apps/dashboard/src/lib/cockpit/legacy-pending-approval-to-approval-view.ts`
- Test: `apps/dashboard/src/lib/cockpit/__tests__/legacy-pending-approval-to-approval-view.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/dashboard/src/lib/cockpit/__tests__/legacy-pending-approval-to-approval-view.test.ts
import { describe, it, expect } from "vitest";
import { legacyPendingApprovalToApprovalView } from "../legacy-pending-approval-to-approval-view.js";
import type { PendingApproval } from "@/lib/api-client-types";

const NOW = new Date("2026-05-14T12:00:00Z");

function makePending(overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    id: "appr_1",
    summary: "Send Jordan the founding-member rate?",
    riskCategory: "medium",
    status: "pending",
    envelopeId: "env_1",
    expiresAt: "2026-05-14T13:00:00Z",
    bindingHash: "hash_abc",
    createdAt: "2026-05-14T11:56:00Z",
    ...overrides,
  };
}

describe("legacyPendingApprovalToApprovalView", () => {
  it("maps a low-risk pricing approval to this_week urgency with respond action", () => {
    const view = legacyPendingApprovalToApprovalView(makePending({ riskCategory: "low" }), NOW);
    expect(view.urgency).toBe("this_week");
    expect(view.title).toBe("Send Jordan the founding-member rate?");
    expect(view.askedAt).toBe("4 min ago");
    expect(view.primaryAction).toEqual({
      kind: "respond",
      bindingHash: "hash_abc",
      verdict: "accept",
    });
    expect(view.kind).toBe("pricing");
  });

  it("maps a high-risk approval to immediate urgency", () => {
    const view = legacyPendingApprovalToApprovalView(makePending({ riskCategory: "high" }), NOW);
    expect(view.urgency).toBe("immediate");
  });

  it("maps a critical-risk approval to immediate urgency", () => {
    const view = legacyPendingApprovalToApprovalView(
      makePending({ riskCategory: "critical" }),
      NOW,
    );
    expect(view.urgency).toBe("immediate");
  });

  it("carries the binding hash and id through to the view", () => {
    const view = legacyPendingApprovalToApprovalView(
      makePending({ id: "appr_xyz", bindingHash: "hash_xyz" }),
      NOW,
    );
    expect(view.id).toBe("appr_xyz");
    if (view.primaryAction.kind === "respond") {
      expect(view.primaryAction.bindingHash).toBe("hash_xyz");
    }
  });

  it("populates presentation primary/secondary labels with defaults", () => {
    const view = legacyPendingApprovalToApprovalView(makePending(), NOW);
    expect(view.primary).toBe("Accept");
    expect(view.secondary).toBe("Decline");
    expect(view.presentation).toEqual({ primaryLabel: "Accept", dismissLabel: "Decline" });
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- src/lib/cockpit/__tests__/legacy-pending-approval-to-approval-view.test.ts
```

- [ ] **Step 3: Implement**

```ts
// apps/dashboard/src/lib/cockpit/legacy-pending-approval-to-approval-view.ts
import type { PendingApproval } from "@/lib/api-client-types";
import type {
  AlexApprovalView,
  AlexApprovalKind,
  ApprovalUrgency,
} from "@/components/cockpit/types.js";
import { relativeAge } from "./relative-age.js";

function urgencyForRisk(risk: string): ApprovalUrgency {
  if (risk === "critical" || risk === "high") return "immediate";
  return "this_week";
}

// A.1 only renders the wire-level shape from /api/dashboard/approvals.
// Richer kind classification (refund / regulatory / safety-gate / escalation)
// requires Approval.payload.kind which lands at A.5 with the schema additions.
// Until then, every wire approval surfaces as kind = "pricing".
function inferKind(_: PendingApproval): AlexApprovalKind {
  return "pricing";
}

/**
 * Adapter from the pre-schema-extension `PendingApproval` wire shape into the
 * cockpit's `AlexApprovalView`. The `legacy` prefix is intentional: A.5 ships
 * `Approval.payload.kind` + `body` + `quote` + `quoteFrom`, at which point a
 * sibling adapter (e.g. `richApprovalToApprovalView`) reads those fields and
 * surfaces the full set of approval kinds. This function is the A.1 bridge —
 * keep it until the schema-aware adapter is the only one called.
 */
export function legacyPendingApprovalToApprovalView(
  approval: PendingApproval,
  now: Date = new Date(),
): AlexApprovalView {
  const created = new Date(approval.createdAt);
  return {
    id: approval.id,
    kind: inferKind(approval),
    urgency: urgencyForRisk(approval.riskCategory),
    askedAt: relativeAge(created, now),
    title: approval.summary,
    presentation: { primaryLabel: "Accept", dismissLabel: "Decline" },
    primary: "Accept",
    secondary: "Decline",
    primaryAction: { kind: "respond", bindingHash: approval.bindingHash, verdict: "accept" },
  };
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/lib/cockpit/__tests__/legacy-pending-approval-to-approval-view.test.ts
```

- [ ] **Step 5: Stage (commit deferred to group boundary)**

```bash
git add apps/dashboard/src/lib/cockpit/legacy-pending-approval-to-approval-view.ts apps/dashboard/src/lib/cockpit/__tests__/legacy-pending-approval-to-approval-view.test.ts
git commit -m "feat(cockpit): add PendingApproval → ApprovalView adapter (A.1)"
```

---

### Task 7: Activity kind map

**Files:**

- Create: `apps/dashboard/src/lib/cockpit/activity-kind-map.ts`
- Test: `apps/dashboard/src/lib/cockpit/__tests__/activity-kind-map.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/dashboard/src/lib/cockpit/__tests__/activity-kind-map.test.ts
import { describe, it, expect } from "vitest";
import { translatedActionToActivityRow } from "../activity-kind-map.js";
import type { TranslatedAction } from "@/hooks/use-agent-activity";

const NOW = new Date("2026-05-14T12:00:00Z");

function makeAction(overrides: Partial<TranslatedAction> = {}): TranslatedAction {
  return {
    id: "a1",
    agentRole: "alex",
    text: "Confirmed Saturday 10 AM tour",
    icon: "success",
    timestamp: "2026-05-14T11:42:00Z",
    eventType: "booking.created",
    entityType: "Booking",
    entityId: "b1",
    ...overrides,
  };
}

describe("translatedActionToActivityRow", () => {
  it("maps booking.created → booked kind", () => {
    const row = translatedActionToActivityRow(makeAction(), NOW);
    expect(row.kind).toBe("booked");
    expect(row.head).toBe("Confirmed Saturday 10 AM tour");
  });

  it("maps lifecycle qualified events → qualified", () => {
    const row = translatedActionToActivityRow(
      makeAction({ eventType: "lifecycle.qualified" }),
      NOW,
    );
    expect(row.kind).toBe("qualified");
  });

  it("maps message.sent → replied", () => {
    const row = translatedActionToActivityRow(makeAction({ eventType: "message.sent" }), NOW);
    expect(row.kind).toBe("replied");
  });

  it("maps approval.created → waiting", () => {
    const row = translatedActionToActivityRow(makeAction({ eventType: "approval.created" }), NOW);
    expect(row.kind).toBe("waiting");
  });

  it("maps escalate events → escalated", () => {
    const row = translatedActionToActivityRow(makeAction({ eventType: "escalation.created" }), NOW);
    expect(row.kind).toBe("escalated");
  });

  it("falls back to sent for unknown eventTypes", () => {
    const row = translatedActionToActivityRow(makeAction({ eventType: "unknown.thing" }), NOW);
    expect(row.kind).toBe("sent");
  });

  it("renders absolute time HH:MM for same-day, weekday for older", () => {
    const sameDay = translatedActionToActivityRow(
      makeAction({ timestamp: "2026-05-14T11:42:00Z" }),
      NOW,
    );
    expect(sameDay.time).toMatch(/^\d{2}:\d{2}$/);
    const oldRow = translatedActionToActivityRow(
      makeAction({ timestamp: "2026-05-09T11:42:00Z" }),
      NOW,
    );
    expect(oldRow.time).toBe("Sat");
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- src/lib/cockpit/__tests__/activity-kind-map.test.ts
```

- [ ] **Step 3: Implement**

```ts
// apps/dashboard/src/lib/cockpit/activity-kind-map.ts
import type { TranslatedAction } from "@/hooks/use-agent-activity";
import type { ActivityKind, ActivityRow } from "@/components/cockpit/types.js";

const KIND_RULES: Array<{ test: (e: string) => boolean; kind: ActivityKind }> = [
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
  { test: (e) => e === "message.sent" || e === "message.replied", kind: "replied" },
  { test: (e) => e === "message.batch_sent" || e === "campaign.sent", kind: "sent" },
  { test: (e) => e === "system.daily_scan_started" || e === "system.run.started", kind: "started" },
  { test: (e) => e === "lead.created" || e === "leads.ingested", kind: "connected" },
];

function classify(eventType: string): ActivityKind {
  for (const rule of KIND_RULES) {
    if (rule.test(eventType)) return rule.kind;
  }
  return "sent";
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

export function translatedActionToActivityRow(
  action: TranslatedAction,
  now: Date = new Date(),
): ActivityRow {
  return {
    time: formatTime(action.timestamp, now),
    kind: classify(action.eventType),
    head: action.text,
  };
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/lib/cockpit/__tests__/activity-kind-map.test.ts
```

- [ ] **Step 5: Stage (commit deferred to group boundary)**

```bash
git add apps/dashboard/src/lib/cockpit/activity-kind-map.ts apps/dashboard/src/lib/cockpit/__tests__/activity-kind-map.test.ts
git commit -m "feat(cockpit): add TranslatedAction → ActivityRow adapter (A.1)"
```

---

### Task 8: Status derivation hook

**Files:**

- Create: `apps/dashboard/src/hooks/use-cockpit-status.ts`
- Test: `apps/dashboard/src/hooks/__tests__/use-cockpit-status.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/dashboard/src/hooks/__tests__/use-cockpit-status.test.ts
import { describe, it, expect } from "vitest";
import { deriveAlexStatusA1 } from "../use-cockpit-status.js";

const NOW = new Date("2026-05-14T12:00:00Z");

describe("deriveAlexStatusA1", () => {
  it("returns HALTED when halted is true regardless of other inputs", () => {
    expect(
      deriveAlexStatusA1({
        halted: true,
        pendingApprovals: 5,
        recentActivityAt: NOW,
        inQuietHours: false,
        now: NOW,
      }),
    ).toBe("HALTED");
  });

  it("returns WAITING when one or more approvals are pending", () => {
    expect(
      deriveAlexStatusA1({
        halted: false,
        pendingApprovals: 1,
        recentActivityAt: null,
        inQuietHours: false,
        now: NOW,
      }),
    ).toBe("WAITING");
  });

  it("returns WORKING when recent activity exists within the 15-minute window", () => {
    const recent = new Date("2026-05-14T11:50:00Z");
    expect(
      deriveAlexStatusA1({
        halted: false,
        pendingApprovals: 0,
        recentActivityAt: recent,
        inQuietHours: false,
        now: NOW,
      }),
    ).toBe("WORKING");
  });

  it("returns IDLE when activity is older than 15 minutes", () => {
    const old = new Date("2026-05-14T11:30:00Z");
    expect(
      deriveAlexStatusA1({
        halted: false,
        pendingApprovals: 0,
        recentActivityAt: old,
        inQuietHours: false,
        now: NOW,
      }),
    ).toBe("IDLE");
  });

  it("returns IDLE when there is no recent activity", () => {
    expect(
      deriveAlexStatusA1({
        halted: false,
        pendingApprovals: 0,
        recentActivityAt: null,
        inQuietHours: false,
        now: NOW,
      }),
    ).toBe("IDLE");
  });

  it("returns IDLE even when in quiet hours (no WORKING signal)", () => {
    expect(
      deriveAlexStatusA1({
        halted: false,
        pendingApprovals: 0,
        recentActivityAt: null,
        inQuietHours: true,
        now: NOW,
      }),
    ).toBe("IDLE");
  });

  it("prioritizes HALTED over WAITING", () => {
    expect(
      deriveAlexStatusA1({
        halted: true,
        pendingApprovals: 3,
        recentActivityAt: null,
        inQuietHours: false,
        now: NOW,
      }),
    ).toBe("HALTED");
  });

  it("prioritizes WAITING over WORKING", () => {
    const recent = new Date("2026-05-14T11:55:00Z");
    expect(
      deriveAlexStatusA1({
        halted: false,
        pendingApprovals: 1,
        recentActivityAt: recent,
        inQuietHours: false,
        now: NOW,
      }),
    ).toBe("WAITING");
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- src/hooks/__tests__/use-cockpit-status.test.ts
```

- [ ] **Step 3: Implement**

```ts
// apps/dashboard/src/hooks/use-cockpit-status.ts
"use client";

import { useMemo } from "react";
import type { CockpitStatus } from "@/components/cockpit/types.js";

export interface DeriveStatusInput {
  halted: boolean;
  pendingApprovals: number;
  recentActivityAt: Date | null;
  inQuietHours: boolean;
  now: Date;
}

const WORKING_WINDOW_MS = 15 * 60_000;

export function deriveAlexStatusA1(input: DeriveStatusInput): CockpitStatus {
  if (input.halted) return "HALTED";
  if (input.pendingApprovals > 0) return "WAITING";
  if (
    input.recentActivityAt &&
    input.now.getTime() - input.recentActivityAt.getTime() < WORKING_WINDOW_MS
  ) {
    return "WORKING";
  }
  return "IDLE";
}

export interface CockpitStatusHookInput {
  halted: boolean;
  pendingApprovals: number;
  recentActivityAt: Date | null;
  inQuietHours?: boolean;
}

export function useCockpitStatusAlex(input: CockpitStatusHookInput): CockpitStatus {
  return useMemo(
    () =>
      deriveAlexStatusA1({
        halted: input.halted,
        pendingApprovals: input.pendingApprovals,
        recentActivityAt: input.recentActivityAt,
        inQuietHours: input.inQuietHours ?? false,
        now: new Date(),
      }),
    [input.halted, input.pendingApprovals, input.recentActivityAt?.getTime(), input.inQuietHours],
  );
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/hooks/__tests__/use-cockpit-status.test.ts
```

- [ ] **Step 5: Stage + Commit 2 (group boundary — adapters + status derivation)**

```bash
git add apps/dashboard/src/hooks/use-cockpit-status.ts apps/dashboard/src/hooks/__tests__/use-cockpit-status.test.ts
git commit -m "feat(cockpit): adapters + status derivation (A.1)"
```

Files in this commit (staged across Tasks 6–8):

- `apps/dashboard/src/lib/cockpit/legacy-pending-approval-to-approval-view.ts` + test
- `apps/dashboard/src/lib/cockpit/activity-kind-map.ts` + test
- `apps/dashboard/src/hooks/use-cockpit-status.ts` + test

---

### Task 9: Dot primitive

**Files:**

- Create: `apps/dashboard/src/components/cockpit/dot.tsx`
- Test: `apps/dashboard/src/components/cockpit/__tests__/dot.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/dashboard/src/components/cockpit/__tests__/dot.test.tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Dot } from "../dot.js";

describe("Dot", () => {
  it("renders a single dot with the given color (no pulse layer)", () => {
    const { container } = render(<Dot color="#3F7A36" />);
    const spans = container.querySelectorAll("span");
    expect(spans.length).toBe(2); // wrapper + filled dot
  });

  it("renders the pulse layer when pulse=true", () => {
    const { container } = render(<Dot color="#B8782E" pulse />);
    const spans = container.querySelectorAll("span");
    expect(spans.length).toBe(3); // wrapper + pulse + filled dot
  });

  it("honors a custom size", () => {
    const { container } = render(<Dot color="#A03A2E" size={9} />);
    const wrapper = container.querySelector("span") as HTMLSpanElement;
    expect(wrapper.style.width).toBe("9px");
    expect(wrapper.style.height).toBe("9px");
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/dot.test.tsx
```

- [ ] **Step 3: Implement**

```tsx
// apps/dashboard/src/components/cockpit/dot.tsx
import type { CSSProperties } from "react";

export interface DotProps {
  color: string;
  pulse?: boolean;
  size?: number;
}

export function Dot({ color, pulse, size = 7 }: DotProps) {
  const wrapStyle: CSSProperties = {
    position: "relative",
    display: "inline-block",
    width: size,
    height: size,
  };
  const layerStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    borderRadius: "50%",
    background: color,
  };
  return (
    <span style={wrapStyle}>
      {pulse && <span style={{ ...layerStyle, animation: "ck-pulse 1.6s ease-out infinite" }} />}
      <span style={layerStyle} />
    </span>
  );
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/dot.test.tsx
```

- [ ] **Step 5: Stage (commit deferred to group boundary)**

```bash
git add apps/dashboard/src/components/cockpit/dot.tsx apps/dashboard/src/components/cockpit/__tests__/dot.test.tsx
git commit -m "feat(cockpit): add Dot primitive (A.1)"
```

---

### Task 10: Status pill

**Files:**

- Create: `apps/dashboard/src/components/cockpit/status-pill.tsx`
- Test: `apps/dashboard/src/components/cockpit/__tests__/status-pill.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/dashboard/src/components/cockpit/__tests__/status-pill.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusPill } from "../status-pill.js";

describe("StatusPill", () => {
  it("renders WORKING when status is WORKING and not halted", () => {
    render(<StatusPill statusKey="WORKING" halted={false} />);
    expect(screen.getByText("WORKING")).toBeInTheDocument();
  });

  it("renders HALTED when halted regardless of statusKey", () => {
    render(<StatusPill statusKey="WAITING" halted />);
    expect(screen.getByText("HALTED")).toBeInTheDocument();
  });

  it("renders WAITING label", () => {
    render(<StatusPill statusKey="WAITING" halted={false} />);
    expect(screen.getByText("WAITING")).toBeInTheDocument();
  });

  it("renders IDLE label", () => {
    render(<StatusPill statusKey="IDLE" halted={false} />);
    expect(screen.getByText("IDLE")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/status-pill.test.tsx
```

- [ ] **Step 3: Implement**

```tsx
// apps/dashboard/src/components/cockpit/status-pill.tsx
import { Dot } from "./dot.js";
import { statusColor, statusPulse } from "@/lib/cockpit/alex-config.js";
import type { CockpitStatus } from "./types.js";

export interface StatusPillProps {
  statusKey: CockpitStatus;
  halted: boolean;
}

export function StatusPill({ statusKey, halted }: StatusPillProps) {
  const color = statusColor(statusKey, halted);
  const pulse = statusPulse(statusKey, halted);
  const label = halted ? "HALTED" : statusKey;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <Dot color={color} pulse={pulse} />
      <span
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: "0.14em",
          color,
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
    </span>
  );
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/status-pill.test.tsx
```

- [ ] **Step 5: Stage (commit deferred to group boundary)**

```bash
git add apps/dashboard/src/components/cockpit/status-pill.tsx apps/dashboard/src/components/cockpit/__tests__/status-pill.test.tsx
git commit -m "feat(cockpit): add StatusPill component (A.1)"
```

---

### Task 11: Topbar

**Files:**

- Create: `apps/dashboard/src/components/cockpit/topbar.tsx`
- Test: `apps/dashboard/src/components/cockpit/__tests__/topbar.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/dashboard/src/components/cockpit/__tests__/topbar.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Topbar } from "../topbar.js";

describe("Topbar", () => {
  it("renders Alex/Riley/Mira tabs", () => {
    render(<Topbar paletteEnabled={false} compact={false} />);
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByText("Riley")).toBeInTheDocument();
    expect(screen.getByText("Mira")).toBeInTheDocument();
  });

  it("renders the Switchboard wordmark in non-compact mode", () => {
    render(<Topbar paletteEnabled={false} compact={false} />);
    expect(screen.getByText("Switchboard")).toBeInTheDocument();
  });

  it("hides the Switchboard wordmark in compact mode", () => {
    render(<Topbar paletteEnabled={false} compact />);
    expect(screen.queryByText("Switchboard")).not.toBeInTheDocument();
  });

  it("renders the 'Tell Alex…' affordance as disabled when paletteEnabled is false", () => {
    render(<Topbar paletteEnabled={false} compact={false} />);
    const btn = screen.getByText("Tell Alex…").closest("button")!;
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-disabled", "true");
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/topbar.test.tsx
```

- [ ] **Step 3: Implement**

```tsx
// apps/dashboard/src/components/cockpit/topbar.tsx
import { T } from "./tokens.js";
import { ALEX_CONFIG } from "@/lib/cockpit/alex-config.js";

export interface TopbarProps {
  /**
   * Whether the command-palette affordance is wired. A.1 ships `false`
   * (palette UI lands at A.5). When false, the "Tell Alex…" button renders
   * disabled with no click handler — keyboard shortcuts also do not register.
   */
  paletteEnabled: boolean;
  /** Optional click handler invoked when paletteEnabled is true. */
  onOpenPalette?: () => void;
  compact?: boolean;
}

function Mark() {
  return (
    <svg width="20" height="20" viewBox="0 0 22 22">
      <rect x="1.5" y="1.5" width="19" height="19" rx="4" fill={T.ink} />
      <circle cx="7" cy="11" r="1.6" fill="#fff" />
      <circle cx="15" cy="11" r="1.6" fill="#fff" />
      <path
        d="M 7 11 Q 11 6.5, 15 11"
        stroke={T.amber}
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Tab({ name, active, muted }: { name: string; active?: boolean; muted?: boolean }) {
  return (
    <span
      style={{
        padding: "5px 10px",
        borderRadius: 4,
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        color: active ? T.ink : muted ? T.ink4 : T.ink3,
        background: active ? "rgba(14,12,10,0.05)" : "transparent",
        cursor: "pointer",
      }}
    >
      {name}
    </span>
  );
}

export function Topbar({ paletteEnabled, onOpenPalette, compact = false }: TopbarProps) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: compact ? "12px 18px" : "14px 28px",
        borderBottom: `1px solid ${T.hair}`,
        background: T.bg,
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: compact ? 14 : 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Mark />
          {!compact && (
            <span
              style={{ fontWeight: 600, fontSize: 14, color: T.ink, letterSpacing: "-0.005em" }}
            >
              Switchboard
            </span>
          )}
        </div>
        <nav style={{ display: "flex", gap: 2 }}>
          {ALEX_CONFIG.tabs.map((t) => (
            <Tab
              key={t.name}
              name={t.name}
              active={"active" in t ? t.active : false}
              muted={"muted" in t ? t.muted : false}
            />
          ))}
        </nav>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: compact ? 8 : 12 }}>
        <button
          onClick={paletteEnabled ? onOpenPalette : undefined}
          disabled={!paletteEnabled}
          aria-disabled={!paletteEnabled}
          title={paletteEnabled ? undefined : "Coming soon"}
          style={{
            background: "transparent",
            border: `1px solid ${T.hair}`,
            padding: "5px 10px 5px 12px",
            borderRadius: 4,
            cursor: paletteEnabled ? "pointer" : "default",
            opacity: paletteEnabled ? 1 : 0.55,
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: "inherit",
          }}
        >
          <span style={{ fontSize: 12.5, color: T.ink3 }}>Tell Alex…</span>
          <span
            style={{
              fontFamily: "JetBrains Mono",
              fontSize: 10.5,
              color: T.ink4,
              padding: "1px 5px",
              border: `1px solid ${T.hair}`,
              borderRadius: 3,
            }}
          >
            ⌘K
          </span>
        </button>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: T.ink,
            color: "#fff",
            display: "grid",
            placeItems: "center",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          M
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/topbar.test.tsx
```

- [ ] **Step 5: Stage (commit deferred to group boundary)**

```bash
git add apps/dashboard/src/components/cockpit/topbar.tsx apps/dashboard/src/components/cockpit/__tests__/topbar.test.tsx
git commit -m "feat(cockpit): add Topbar with brand mark + agent tabs (A.1)"
```

---

### Task 12: Identity row

**Files:**

- Create: `apps/dashboard/src/components/cockpit/identity.tsx`
- Test: `apps/dashboard/src/components/cockpit/__tests__/identity.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/dashboard/src/components/cockpit/__tests__/identity.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Identity } from "../identity.js";

describe("Identity", () => {
  it("renders the agent name 'Alex' and a status pill", () => {
    render(
      <Identity
        statusKey="WORKING"
        halted={false}
        subtitle="SDR · Tours pipeline · HotPod"
        line={null}
        onHaltToggle={() => {}}
      />,
    );
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByText("WORKING")).toBeInTheDocument();
  });

  it("renders an optional greeting line when provided", () => {
    render(
      <Identity
        statusKey="WORKING"
        halted={false}
        subtitle="SDR · Tours pipeline · HotPod"
        line="Three leads in motion."
        onHaltToggle={() => {}}
      />,
    );
    expect(screen.getByText("Three leads in motion.")).toBeInTheDocument();
  });

  it("renders Halt button when not halted; Resume when halted", () => {
    const { rerender } = render(
      <Identity
        statusKey="WORKING"
        halted={false}
        subtitle="x"
        line={null}
        onHaltToggle={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /halt/i })).toBeInTheDocument();
    rerender(
      <Identity statusKey="WORKING" halted subtitle="x" line={null} onHaltToggle={() => {}} />,
    );
    expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument();
  });

  it("invokes onHaltToggle when the halt button is clicked", () => {
    const handler = vi.fn();
    render(
      <Identity
        statusKey="WORKING"
        halted={false}
        subtitle="x"
        line={null}
        onHaltToggle={handler}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /halt/i }));
    expect(handler).toHaveBeenCalledOnce();
  });

  it("renders the subtitle as plain non-interactive text at A.1", () => {
    const { container } = render(
      <Identity
        statusKey="WORKING"
        halted={false}
        subtitle="SDR · Tours pipeline"
        line={null}
        onHaltToggle={() => {}}
      />,
    );
    expect(screen.getByText("SDR · Tours pipeline")).toBeInTheDocument();
    // No button or anchor wrapping the subtitle — popover lands at A.2.
    expect(container.querySelector("[data-mission-trigger]")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/identity.test.tsx
```

- [ ] **Step 3: Implement**

```tsx
// apps/dashboard/src/components/cockpit/identity.tsx
import { T } from "./tokens.js";
import { ALEX_CONFIG } from "@/lib/cockpit/alex-config.js";
import { StatusPill } from "./status-pill.js";
import type { CockpitStatus } from "./types.js";

export interface IdentityProps {
  statusKey: CockpitStatus;
  halted: boolean;
  subtitle: string;
  line: string | null;
  /** Click handler for the Halt / Resume button. Receives no argument. */
  onHaltToggle: () => void;
  compact?: boolean;
  // A.2 will add `onOpenMission?: () => void` + `missionInteractive?: boolean`
  // so the subtitle becomes a clickable mission-popover trigger. Do not add
  // either prop at A.1 — the subtitle is plain text.
}

function AvatarFrame({ size = 64 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.18),
        background: ALEX_CONFIG.accent.soft,
        border: `1px solid ${T.hair}`,
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
        boxShadow: "inset 0 -8px 14px rgba(14,12,10,0.04)",
        overflow: "hidden",
      }}
    >
      <span style={{ fontWeight: 700, fontSize: size * 0.42, color: ALEX_CONFIG.accent.deep }}>
        {ALEX_CONFIG.name[0]}
      </span>
    </div>
  );
}

export function Identity({
  statusKey,
  halted,
  subtitle,
  line,
  onHaltToggle,
  compact = false,
}: IdentityProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: compact ? 12 : 16,
        padding: compact ? "18px 18px 14px" : "24px 28px 18px",
      }}
    >
      <AvatarFrame size={compact ? 52 : 64} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: compact ? 18 : 22,
              fontWeight: 600,
              color: T.ink,
              letterSpacing: "-0.015em",
            }}
          >
            {ALEX_CONFIG.name}
          </span>
          <StatusPill statusKey={statusKey} halted={halted} />
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 12.5,
            color: T.ink3,
            fontFamily: "JetBrains Mono",
            letterSpacing: "0.02em",
          }}
        >
          {subtitle}
        </div>
        {line && (
          <p
            style={{
              margin: "12px 0 0",
              fontSize: compact ? 13.5 : 14,
              lineHeight: 1.5,
              color: T.ink2,
              maxWidth: 640,
            }}
          >
            {line}
          </p>
        )}
      </div>
      <button
        onClick={onHaltToggle}
        style={{
          background: "transparent",
          border: `1px solid ${T.hair}`,
          padding: "6px 12px",
          borderRadius: 4,
          cursor: "pointer",
          fontSize: 11.5,
          fontWeight: 600,
          color: halted ? T.green : T.red,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          fontFamily: "inherit",
        }}
      >
        {halted ? "▶ Resume" : "⏸ Halt"}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/identity.test.tsx
```

- [ ] **Step 5: Stage (commit deferred to group boundary)**

```bash
git add apps/dashboard/src/components/cockpit/identity.tsx apps/dashboard/src/components/cockpit/__tests__/identity.test.tsx
git commit -m "feat(cockpit): add Identity row with status pill + halt button (A.1)"
```

---

### Task 13: Approval card

**Files:**

- Create: `apps/dashboard/src/components/cockpit/approval-card.tsx`
- Test: `apps/dashboard/src/components/cockpit/__tests__/approval-card.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/dashboard/src/components/cockpit/__tests__/approval-card.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ApprovalCard } from "../approval-card.js";
import type { AlexApprovalView } from "../types.js";

const fixture: AlexApprovalView = {
  id: "appr_1",
  kind: "pricing",
  urgency: "this_week",
  askedAt: "4 min ago",
  title: "Send Jordan the founding-member rate?",
  body: "Alex wants to offer $89/mo on a 6-month — your founding rate, normally $119.",
  quote: "I'm honestly in if the price is right.",
  quoteFrom: "Jordan F. · 11:53",
  presentation: { primaryLabel: "Accept & send", dismissLabel: "Decline" },
  primary: "Accept & send",
  secondary: "Decline",
  primaryAction: { kind: "respond", bindingHash: "hash_abc", verdict: "accept" },
};

describe("ApprovalCard", () => {
  it("renders title, body, quote, and the Alex 'needs you' eyebrow", () => {
    render(<ApprovalCard data={fixture} idx={0} total={1} onResolve={() => {}} />);
    expect(screen.getByText(fixture.title)).toBeInTheDocument();
    expect(screen.getByText(/founding-member rate/i)).toBeInTheDocument();
    expect(screen.getByText(/Jordan F\. · 11:53/)).toBeInTheDocument();
    expect(screen.getByText(/Alex needs you/i)).toBeInTheDocument();
  });

  it("invokes onResolve('accept', 0) when primary button is clicked", () => {
    const handler = vi.fn();
    render(<ApprovalCard data={fixture} idx={0} total={1} onResolve={handler} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept & send" }));
    expect(handler).toHaveBeenCalledWith("accept", 0);
  });

  it("invokes onResolve('decline', 0) when secondary button is clicked", () => {
    const handler = vi.fn();
    render(<ApprovalCard data={fixture} idx={0} total={1} onResolve={handler} />);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(handler).toHaveBeenCalledWith("decline", 0);
  });

  it("shows the 'N of M' indicator when there are multiple cards", () => {
    render(<ApprovalCard data={fixture} idx={1} total={3} onResolve={() => {}} />);
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
  });

  it("renders without a quote when one isn't provided", () => {
    const noQuote: AlexApprovalView = { ...fixture, quote: undefined, quoteFrom: undefined };
    render(<ApprovalCard data={noQuote} idx={0} total={1} onResolve={() => {}} />);
    expect(screen.queryByText(/Jordan F\./)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/approval-card.test.tsx
```

- [ ] **Step 3: Implement**

```tsx
// apps/dashboard/src/components/cockpit/approval-card.tsx
import { T } from "./tokens.js";
import type { ApprovalView } from "./types.js";

export interface ApprovalCardProps {
  data: ApprovalView;
  idx: number;
  total: number;
  onResolve: (verdict: "accept" | "decline", idx: number) => void;
  compact?: boolean;
}

export function ApprovalCard({ data, idx, total, onResolve, compact = false }: ApprovalCardProps) {
  return (
    <section
      style={{
        padding: compact ? "16px 18px" : "20px 22px",
        background: T.amberPaper,
        borderRadius: 8,
        border: `1px solid ${T.amberSoft}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.14em",
            color: T.amberDeep,
            textTransform: "uppercase",
          }}
        >
          Alex needs you
        </span>
        <span style={{ fontFamily: "JetBrains Mono", fontSize: 11, color: T.amberDeep }}>
          · {data.askedAt}
        </span>
        {total > 1 && (
          <>
            <span style={{ flex: 1 }} />
            <span
              style={{
                fontFamily: "JetBrains Mono",
                fontSize: 11,
                color: T.amberDeep,
                fontWeight: 600,
              }}
            >
              {idx + 1} of {total}
            </span>
          </>
        )}
      </div>
      <h2
        style={{
          margin: 0,
          fontSize: compact ? 17 : 19,
          fontWeight: 600,
          color: T.ink,
          letterSpacing: "-0.01em",
          lineHeight: 1.3,
        }}
      >
        {data.title}
      </h2>
      {data.body && (
        <p
          style={{
            margin: "8px 0 0",
            maxWidth: 640,
            fontSize: 13.5,
            lineHeight: 1.5,
            color: T.ink2,
          }}
        >
          {data.body}
        </p>
      )}
      {data.quote && (
        <div
          style={{
            margin: "12px 0 0",
            padding: "10px 14px",
            background: "rgba(255,255,255,0.55)",
            borderRadius: 4,
            border: `1px solid ${T.amberSoft}`,
            fontSize: 13.5,
            lineHeight: 1.5,
            color: T.ink2,
          }}
        >
          <span style={{ color: T.amber, fontWeight: 600, marginRight: 3 }}>"</span>
          {data.quote}
          <span style={{ color: T.amber, fontWeight: 600, marginLeft: 3 }}>"</span>
          {data.quoteFrom && (
            <div
              style={{ marginTop: 4, fontFamily: "JetBrains Mono", fontSize: 10.5, color: T.ink4 }}
            >
              — {data.quoteFrom}
            </div>
          )}
        </div>
      )}
      {data.risk && (
        <div
          style={{
            marginTop: 10,
            fontFamily: "JetBrains Mono",
            fontSize: 11,
            color: T.amberDeep,
            letterSpacing: "0.04em",
          }}
        >
          ⚠ {data.risk}
        </div>
      )}
      <div
        style={{ marginTop: 14, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
      >
        <button
          onClick={() => onResolve("accept", idx)}
          style={{
            background: T.amber,
            color: "#fff",
            border: `1px solid ${T.amberDeep}`,
            padding: "8px 16px",
            borderRadius: 4,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {data.primary}
        </button>
        <button
          onClick={() => onResolve("decline", idx)}
          style={{
            background: "#fff",
            color: T.ink,
            border: `1px solid ${T.hair}`,
            padding: "8px 14px",
            borderRadius: 4,
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {data.secondary}
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/approval-card.test.tsx
```

- [ ] **Step 5: Stage (commit deferred to group boundary)**

```bash
git add apps/dashboard/src/components/cockpit/approval-card.tsx apps/dashboard/src/components/cockpit/__tests__/approval-card.test.tsx
git commit -m "feat(cockpit): add ApprovalCard component (A.1)"
```

---

### Task 14: Approval block

**Files:**

- Create: `apps/dashboard/src/components/cockpit/approval-block.tsx`
- Test: `apps/dashboard/src/components/cockpit/__tests__/approval-block.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/dashboard/src/components/cockpit/__tests__/approval-block.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ApprovalBlock } from "../approval-block.js";
import type { AlexApprovalView } from "../types.js";

function makeView(id: string, title: string): AlexApprovalView {
  return {
    id,
    kind: "pricing",
    urgency: "this_week",
    askedAt: "now",
    title,
    presentation: { primaryLabel: "Accept", dismissLabel: "Decline" },
    primary: "Accept",
    secondary: "Decline",
    primaryAction: { kind: "respond", bindingHash: "h", verdict: "accept" },
  };
}

describe("ApprovalBlock", () => {
  it("returns null when the data array is empty", () => {
    const { container } = render(<ApprovalBlock data={[]} onResolve={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one card per item in the array", () => {
    render(
      <ApprovalBlock
        data={[makeView("a", "First"), makeView("b", "Second")]}
        onResolve={() => {}}
      />,
    );
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("forwards (verdict, idx) to the resolver", () => {
    const handler = vi.fn();
    render(<ApprovalBlock data={[makeView("a", "Only")]} onResolve={handler} />);
    screen.getByRole("button", { name: "Accept" }).click();
    expect(handler).toHaveBeenCalledWith("accept", 0);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/approval-block.test.tsx
```

- [ ] **Step 3: Implement**

```tsx
// apps/dashboard/src/components/cockpit/approval-block.tsx
import { ApprovalCard } from "./approval-card.js";
import type { ApprovalView } from "./types.js";

export interface ApprovalBlockProps {
  data: ApprovalView[];
  onResolve: (verdict: "accept" | "decline", idx: number) => void;
  compact?: boolean;
}

export function ApprovalBlock({ data, onResolve, compact = false }: ApprovalBlockProps) {
  if (data.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: compact ? 12 : 14,
        margin: compact ? "16px 18px 0" : "20px 28px 0",
      }}
    >
      {data.map((item, i) => (
        <ApprovalCard
          key={item.id}
          data={item}
          idx={i}
          total={data.length}
          onResolve={onResolve}
          compact={compact}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/approval-block.test.tsx
```

- [ ] **Step 5: Stage (commit deferred to group boundary)**

```bash
git add apps/dashboard/src/components/cockpit/approval-block.tsx apps/dashboard/src/components/cockpit/__tests__/approval-block.test.tsx
git commit -m "feat(cockpit): add ApprovalBlock array-tolerant wrapper (A.1)"
```

---

### Task 15: Activity row

**Files:**

- Create: `apps/dashboard/src/components/cockpit/activity-row.tsx`
- Test: `apps/dashboard/src/components/cockpit/__tests__/activity-row.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/dashboard/src/components/cockpit/__tests__/activity-row.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActivityRow } from "../activity-row.js";
import type { ActivityRow as ActivityRowType } from "../types.js";

describe("ActivityRow", () => {
  it("renders time, kind label, and head", () => {
    const item: ActivityRowType = {
      time: "11:42",
      kind: "booked",
      head: "Maya R. confirmed Saturday tour",
    };
    render(<ActivityRow item={item} open={false} toggle={() => {}} />);
    expect(screen.getByText("11:42")).toBeInTheDocument();
    expect(screen.getByText("BOOKED")).toBeInTheDocument();
    expect(screen.getByText("Maya R. confirmed Saturday tour")).toBeInTheDocument();
  });

  it("renders the qualified kind label", () => {
    const item: ActivityRowType = { time: "10:30", kind: "qualified", head: "Devon K." };
    render(<ActivityRow item={item} open={false} toggle={() => {}} />);
    expect(screen.getByText("QUALIFIED")).toBeInTheDocument();
  });

  it("renders the escalated kind label as 'TO YOU'", () => {
    const item: ActivityRowType = { time: "09:30", kind: "escalated", head: "Refund request" };
    render(<ActivityRow item={item} open={false} toggle={() => {}} />);
    expect(screen.getByText("TO YOU")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/activity-row.test.tsx
```

- [ ] **Step 3: Implement**

```tsx
// apps/dashboard/src/components/cockpit/activity-row.tsx
import { T } from "./tokens.js";
import { lookupKindMeta } from "./kind-meta.js";
import { Dot } from "./dot.js";
import type { ActivityRow as ActivityRowType } from "./types.js";

export interface ActivityRowProps {
  item: ActivityRowType;
  open: boolean;
  toggle: () => void;
  compact?: boolean;
}

export function ActivityRow({ item, compact = false }: ActivityRowProps) {
  const meta = lookupKindMeta(item.kind);
  return (
    <li style={{ borderBottom: `1px solid ${T.hairSoft}` }}>
      <div
        style={{
          display: "grid",
          width: "100%",
          boxSizing: "border-box",
          gridTemplateColumns: compact ? "46px 96px 1fr" : "54px 112px 1fr",
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
        <span style={{ fontSize: compact ? 13 : 13.5, lineHeight: 1.45, color: T.ink }}>
          {item.head}
        </span>
      </div>
    </li>
  );
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/activity-row.test.tsx
```

- [ ] **Step 5: Stage (commit deferred to group boundary)**

```bash
git add apps/dashboard/src/components/cockpit/activity-row.tsx apps/dashboard/src/components/cockpit/__tests__/activity-row.test.tsx
git commit -m "feat(cockpit): add ActivityRow (collapsed-only at A.1) (A.1)"
```

---

### Task 16: Activity stream

**Files:**

- Create: `apps/dashboard/src/components/cockpit/activity-stream.tsx`
- Test: `apps/dashboard/src/components/cockpit/__tests__/activity-stream.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/dashboard/src/components/cockpit/__tests__/activity-stream.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ActivityStream } from "../activity-stream.js";
import type { ActivityRow } from "../types.js";

const rows: ActivityRow[] = [
  { time: "11:42", kind: "booked", head: "Maya R. confirmed" },
  { time: "10:55", kind: "replied", head: "Tom W. answered" },
  { time: "09:30", kind: "escalated", head: "Refund request" },
];

describe("ActivityStream", () => {
  it("renders all rows when filter is 'all'", () => {
    render(<ActivityStream rows={rows} filter="all" setFilter={() => {}} />);
    expect(screen.getByText("Maya R. confirmed")).toBeInTheDocument();
    expect(screen.getByText("Tom W. answered")).toBeInTheDocument();
    expect(screen.getByText("Refund request")).toBeInTheDocument();
  });

  it("filters to bookings only when filter is 'booked'", () => {
    render(<ActivityStream rows={rows} filter="booked" setFilter={() => {}} />);
    expect(screen.getByText("Maya R. confirmed")).toBeInTheDocument();
    expect(screen.queryByText("Tom W. answered")).not.toBeInTheDocument();
    expect(screen.queryByText("Refund request")).not.toBeInTheDocument();
  });

  it("filters to escalations + waiting when filter is 'escalations'", () => {
    render(<ActivityStream rows={rows} filter="escalations" setFilter={() => {}} />);
    expect(screen.queryByText("Maya R. confirmed")).not.toBeInTheDocument();
    expect(screen.getByText("Refund request")).toBeInTheDocument();
  });

  it("invokes setFilter when a filter button is clicked", () => {
    const handler = vi.fn();
    render(<ActivityStream rows={rows} filter="all" setFilter={handler} />);
    fireEvent.click(screen.getByRole("button", { name: /booked/i }));
    expect(handler).toHaveBeenCalledWith("booked");
  });

  it("renders the empty-state copy when no rows match the filter", () => {
    render(<ActivityStream rows={[]} filter="all" setFilter={() => {}} />);
    expect(screen.getByText(/nothing here yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/activity-stream.test.tsx
```

- [ ] **Step 3: Implement**

```tsx
// apps/dashboard/src/components/cockpit/activity-stream.tsx
import { T } from "./tokens.js";
import { ActivityRow as ActivityRowComponent } from "./activity-row.js";
import type { ActivityRow } from "./types.js";

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

export function ActivityStream({ rows, filter, setFilter, compact = false }: ActivityStreamProps) {
  const filtered = rows.filter((r) => matchesFilter(r, filter));
  return (
    <section style={{ padding: compact ? "16px 18px 28px" : "20px 28px 28px" }}>
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
        {filtered.map((row, i) => (
          <ActivityRowComponent
            key={`${row.time}-${row.head}-${i}`}
            item={row}
            open={false}
            toggle={() => {}}
            compact={compact}
          />
        ))}
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

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/activity-stream.test.tsx
```

- [ ] **Step 5: Stage (commit deferred to group boundary)**

```bash
git add apps/dashboard/src/components/cockpit/activity-stream.tsx apps/dashboard/src/components/cockpit/__tests__/activity-stream.test.tsx
git commit -m "feat(cockpit): add ActivityStream with filter buttons (A.1)"
```

---

### Task 17: Composer placeholder

**Files:**

- Create: `apps/dashboard/src/components/cockpit/composer-placeholder.tsx`
- Test: `apps/dashboard/src/components/cockpit/__tests__/composer-placeholder.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// apps/dashboard/src/components/cockpit/__tests__/composer-placeholder.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ComposerPlaceholder } from "../composer-placeholder.js";

describe("ComposerPlaceholder", () => {
  it("renders the placeholder copy", () => {
    render(<ComposerPlaceholder halted={false} />);
    expect(screen.getByText(/Tell Alex what to do — coming soon/i)).toBeInTheDocument();
  });

  it("renders halted copy when halted", () => {
    render(<ComposerPlaceholder halted />);
    expect(screen.getByText(/Halted — resume to send instructions/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/composer-placeholder.test.tsx
```

- [ ] **Step 3: Implement**

```tsx
// apps/dashboard/src/components/cockpit/composer-placeholder.tsx
import { T } from "./tokens.js";

export interface ComposerPlaceholderProps {
  halted: boolean;
  compact?: boolean;
}

export function ComposerPlaceholder({ halted, compact = false }: ComposerPlaceholderProps) {
  return (
    <div
      style={{
        borderTop: `1px solid ${T.hair}`,
        background: T.bg,
        padding: compact ? "10px 18px 12px" : "12px 28px 14px",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: T.paper,
          border: `1px solid ${T.hair}`,
          borderRadius: 6,
          padding: "5px 14px",
          opacity: halted ? 0.55 : 1,
        }}
      >
        <span
          style={{
            fontFamily: "JetBrains Mono",
            fontSize: 11,
            color: T.ink4,
            letterSpacing: "0.08em",
          }}
        >
          → ALEX
        </span>
        <span style={{ fontSize: 13, color: T.ink4, padding: "8px 0" }}>
          {halted ? "Halted — resume to send instructions" : "Tell Alex what to do — coming soon"}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/composer-placeholder.test.tsx
```

- [ ] **Step 5: Stage + Commit 3 (group boundary — shell components)**

```bash
git add apps/dashboard/src/components/cockpit/composer-placeholder.tsx apps/dashboard/src/components/cockpit/__tests__/composer-placeholder.test.tsx
git commit -m "feat(cockpit): shell components — identity, approval, activity, composer placeholder (A.1)"
```

Files in this commit (staged across Tasks 9–17):

- `dot.tsx`, `status-pill.tsx`, `topbar.tsx`, `identity.tsx`,
  `approval-card.tsx`, `approval-block.tsx`,
  `activity-row.tsx`, `activity-stream.tsx`, `composer-placeholder.tsx`
  (plus their `__tests__/` siblings)

---

### Task 18: Cockpit page composition

**Files:**

- Create: `apps/dashboard/src/components/cockpit/cockpit-page.tsx`
- Test: `apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx`

This task wires the shell components together. Hook mocks make the test isolated from network/auth.

- [ ] **Step 1: Write failing test**

```tsx
// apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock data hooks before importing the page.
vi.mock("@/app/(auth)/(mercury)/approvals/hooks/use-approvals", () => ({
  usePendingApprovals: () => ({ data: { approvals: [] }, isLoading: false }),
}));

vi.mock("@/hooks/use-agent-activity", () => ({
  useAgentActivity: () => ({ data: { roster: [], states: [], actions: [] }, isLoading: false }),
}));

vi.mock("@/hooks/use-agent-greeting", () => ({
  useAgentGreeting: () => ({ data: null, isLoading: false }),
}));

const toggleHaltMock = vi.fn();
let haltedState = false;

vi.mock("@/components/layout/halt/halt-context", () => ({
  useHalt: () => ({
    halted: haltedState,
    setHalted: vi.fn(),
    toggleHalt: toggleHaltMock,
  }),
}));

import { CockpitPage } from "../cockpit-page.js";

describe("CockpitPage", () => {
  beforeEach(() => {
    toggleHaltMock.mockClear();
    haltedState = false;
  });

  it("renders Topbar, Identity, and ActivityStream in the cold state", () => {
    render(<CockpitPage />);
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByText("IDLE")).toBeInTheDocument();
    expect(screen.getByText(/Nothing here yet/i)).toBeInTheDocument();
  });

  it("does not render ApprovalBlock when no pending approvals", () => {
    render(<CockpitPage />);
    expect(screen.queryByText(/Alex needs you/i)).not.toBeInTheDocument();
  });

  it("clicking the Halt button calls useHalt().toggleHalt()", () => {
    render(<CockpitPage />);
    fireEvent.click(screen.getByRole("button", { name: /halt/i }));
    expect(toggleHaltMock).toHaveBeenCalledOnce();
  });

  it("renders the HALTED status pill when useHalt() reports halted", () => {
    haltedState = true;
    render(<CockpitPage />);
    expect(screen.getByText("HALTED")).toBeInTheDocument();
    expect(screen.getByText(/Halted — resume to send instructions/i)).toBeInTheDocument();
    // Halt button toggles to Resume when halted
    expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument();
  });

  it("consumes the existing HaltProvider (does not re-root)", () => {
    // The cockpit page must not wrap children in a new HaltProvider — it
    // reads via useHalt(). This test guards against accidental re-rooting
    // by asserting the mocked context hook is the source of truth: if
    // CockpitPage rendered its own provider, the mock would be shadowed
    // and the halted: true variant above would not flow through.
    haltedState = true;
    render(<CockpitPage />);
    expect(screen.getByText("HALTED")).toBeInTheDocument();
  });
});
```

Note: add `beforeEach` to the vitest imports at the top: `import { describe, it, expect, vi, beforeEach } from "vitest";`

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/cockpit-page.test.tsx
```

- [ ] **Step 3: Implement**

```tsx
// apps/dashboard/src/components/cockpit/cockpit-page.tsx
"use client";

import { useState, useMemo } from "react";
import { T } from "./tokens.js";
import { Topbar } from "./topbar.js";
import { Identity } from "./identity.js";
import { ApprovalBlock } from "./approval-block.js";
import { ActivityStream, type ActivityFilter } from "./activity-stream.js";
import { ComposerPlaceholder } from "./composer-placeholder.js";
import { ALEX_CONFIG } from "@/lib/cockpit/alex-config.js";
import { legacyPendingApprovalToApprovalView } from "@/lib/cockpit/legacy-pending-approval-to-approval-view.js";
import { translatedActionToActivityRow } from "@/lib/cockpit/activity-kind-map.js";
import { useCockpitStatusAlex } from "@/hooks/use-cockpit-status.js";
import { usePendingApprovals } from "@/app/(auth)/(mercury)/approvals/hooks/use-approvals";
import { useAgentActivity } from "@/hooks/use-agent-activity";
import { useAgentGreeting } from "@/hooks/use-agent-greeting";
import { useHalt } from "@/components/layout/halt/halt-context";

export function CockpitPage() {
  const haltCtx = useHalt();
  const approvalsQ = usePendingApprovals();
  const activityQ = useAgentActivity(1);
  const greetingQ = useAgentGreeting("alex");
  const [filter, setFilter] = useState<ActivityFilter>("all");

  const now = useMemo(() => new Date(), []);

  const approvals = (approvalsQ.data?.approvals ?? []).map((a) =>
    legacyPendingApprovalToApprovalView(a, now),
  );
  const activityRows = (activityQ.data?.actions ?? [])
    .filter((a) => a.agentRole === "alex" || a.agentRole === "unknown")
    .map((a) => translatedActionToActivityRow(a, now));

  const recentActivityAt =
    activityRows.length > 0 ? new Date(activityQ.data!.actions[0]!.timestamp) : null;

  const statusKey = useCockpitStatusAlex({
    halted: haltCtx.halted,
    pendingApprovals: approvals.length,
    recentActivityAt,
  });

  const line = greetingQ.data?.segments
    ? greetingQ.data.segments
        .map((s) => s.text)
        .join(" ")
        .trim() || null
    : null;

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
      <Topbar paletteEnabled={false} />
      <div style={{ flex: 1, overflowY: "auto" }}>
        <Identity
          statusKey={statusKey}
          halted={haltCtx.halted}
          subtitle={ALEX_CONFIG.missionSubtitle}
          line={line}
          onHaltToggle={haltCtx.toggleHalt}
        />
        {/* A.3 inserts <KPIStrip kpis={kpis} collapsed={approvals.length > 0} />
            here, between Identity and the approval block. A.1 renders nothing
            in this region — no empty <div /> placeholder. */}
        {approvals.length > 0 && (
          <ApprovalBlock
            data={approvals}
            onResolve={(_verdict, _idx) => {
              // A.1 stops at view assembly; resolution wires up at A.5 once
              // useRespondToApproval is integrated into the cockpit. Until
              // then the buttons are visually present but inert.
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

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- src/components/cockpit/__tests__/cockpit-page.test.tsx
```

- [ ] **Step 5: Commit 4 (group boundary — page composition)**

```bash
git add apps/dashboard/src/components/cockpit/cockpit-page.tsx apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx
git commit -m "feat(cockpit): compose CockpitPage reading existing hooks (A.1)"
```

---

### Task 19: Page branching

**Files:**

- Modify: `apps/dashboard/src/app/(auth)/[agentKey]/agent-home-client.tsx`
- Create: `apps/dashboard/src/app/(auth)/[agentKey]/legacy-agent-home-client.tsx`
- Modify: `apps/dashboard/src/app/(auth)/[agentKey]/__tests__/agent-home-client.test.tsx`

- [ ] **Step 1: Move existing body to legacy file**

Create `legacy-agent-home-client.tsx` containing the current body of `agent-home-client.tsx`, renamed:

```tsx
// apps/dashboard/src/app/(auth)/[agentKey]/legacy-agent-home-client.tsx
"use client";

import type { AgentKey } from "@switchboard/schemas";
import { AgentBlockBoundary } from "@/components/agent-home/agent-block-boundary";
import { GreetingBlock } from "@/components/agent-home/greeting-block";
import { NeedsYouBlock } from "@/components/agent-home/needs-you-block";
import { WinsBlock } from "@/components/agent-home/wins-block";
import { MetricsBlock } from "@/components/agent-home/metrics-block";
import { PipelineBlock } from "@/components/agent-home/pipeline-block";
import { useAgentGreeting } from "@/hooks/use-agent-greeting";
import { useAgentWins } from "@/hooks/use-agent-wins";
import { useAgentMetrics } from "@/hooks/use-agent-metrics";
import { useAgentPipeline } from "@/hooks/use-agent-pipeline";

export function LegacyAgentHomeClient({ agentKey }: { agentKey: AgentKey }) {
  const greeting = useAgentGreeting(agentKey);
  const wins = useAgentWins(agentKey);
  const metrics = useAgentMetrics(agentKey);
  const pipeline = useAgentPipeline(agentKey);

  if (!greeting.data || !wins.data || !metrics.data || !pipeline.data) return null;

  return (
    <>
      <AgentBlockBoundary key={`${agentKey}-greeting`}>
        <GreetingBlock vm={greeting.data} agentKey={agentKey} />
      </AgentBlockBoundary>
      <AgentBlockBoundary key={`${agentKey}-needs-you`}>
        <NeedsYouBlock agentKey={agentKey} />
      </AgentBlockBoundary>
      <AgentBlockBoundary key={`${agentKey}-wins`}>
        <WinsBlock vm={wins.data} agentKey={agentKey} />
      </AgentBlockBoundary>
      <AgentBlockBoundary key={`${agentKey}-metrics`}>
        <MetricsBlock vm={metrics.data} agentKey={agentKey} />
      </AgentBlockBoundary>
      <AgentBlockBoundary key={`${agentKey}-pipeline`}>
        <PipelineBlock vm={pipeline.data} />
      </AgentBlockBoundary>
    </>
  );
}
```

- [ ] **Step 2: Update `agent-home-client.tsx` to branch**

```tsx
// apps/dashboard/src/app/(auth)/[agentKey]/agent-home-client.tsx
"use client";

import type { AgentKey } from "@switchboard/schemas";
import { CockpitPage } from "@/components/cockpit/cockpit-page.js";
import { LegacyAgentHomeClient } from "./legacy-agent-home-client";

export function AgentHomeClient({ agentKey }: { agentKey: AgentKey }) {
  if (agentKey === "alex") return <CockpitPage />;
  return <LegacyAgentHomeClient agentKey={agentKey} />;
}
```

- [ ] **Step 3: Update the existing test to assert branching**

Open `apps/dashboard/src/app/(auth)/[agentKey]/__tests__/agent-home-client.test.tsx`. Wrap the existing mocks and assertions inside a `describe("LegacyAgentHomeClient via /riley", ...)` block. Add a new `describe("CockpitPage via /alex", ...)` block:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/app/(auth)/(mercury)/approvals/hooks/use-approvals", () => ({
  usePendingApprovals: () => ({ data: { approvals: [] }, isLoading: false }),
}));
vi.mock("@/hooks/use-agent-activity", () => ({
  useAgentActivity: () => ({ data: { roster: [], states: [], actions: [] }, isLoading: false }),
}));
vi.mock("@/hooks/use-agent-greeting", () => ({
  useAgentGreeting: () => ({ data: null, isLoading: false }),
}));
vi.mock("@/components/layout/halt/halt-context", () => ({
  useHalt: () => ({ halted: false, setHalted: vi.fn(), toggleHalt: vi.fn() }),
}));

// Existing mocks for use-decision-feed, use-agent-wins, use-agent-pipeline,
// use-agent-metrics remain — the legacy branch still uses them.

import { AgentHomeClient } from "../agent-home-client";

describe("AgentHomeClient", () => {
  it("renders the cockpit when agentKey is 'alex'", () => {
    render(<AgentHomeClient agentKey="alex" />);
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByText("IDLE")).toBeInTheDocument();
  });

  it("renders the legacy client for 'riley'", () => {
    // The existing legacy assertions go here; they live unchanged from before
    // this PR. The point of this test is to assert the branching dispatched
    // to legacy code, not to re-test the legacy code's internals.
    render(<AgentHomeClient agentKey="riley" />);
    // Existing assertion shape — kept consistent with the prior file.
    // (Sample: the legacy client renders the greeting fallback when data is null;
    // exact assertion depends on the prior test file's expectations.)
  });
});
```

- [ ] **Step 4: Run tests, expect PASS for the alex branch (legacy test details preserved from prior file)**

```bash
pnpm --filter @switchboard/dashboard test -- src/app/\(auth\)/\[agentKey\]/__tests__/agent-home-client.test.tsx
```

Expected: alex-branch test passes. Legacy-branch test continues to pass with the same assertions it had before the PR (preserve the prior file's assertions verbatim — the only change is moving them under the new describe block and adding the alex-branch test).

- [ ] **Step 5: Commit 5 (group boundary — page branching)**

```bash
git add apps/dashboard/src/app/\(auth\)/\[agentKey\]/agent-home-client.tsx \
        apps/dashboard/src/app/\(auth\)/\[agentKey\]/legacy-agent-home-client.tsx \
        apps/dashboard/src/app/\(auth\)/\[agentKey\]/__tests__/agent-home-client.test.tsx
git commit -m "feat(cockpit): branch /alex to CockpitPage; preserve legacy for riley/mira (A.1)"
```

---

### Task 20: Full verification + PR open

**Files:** none (verification + PR creation)

- [ ] **Step 1: Run the full dashboard test suite**

```bash
pnpm --filter @switchboard/dashboard test
```

Expected: all new + existing tests pass.

- [ ] **Step 2: Run typecheck across the workspace**

```bash
pnpm typecheck
```

Expected: clean. If errors point at missing exports from cockpit modules, re-check `.js` extension on relative imports per `CLAUDE.md`.

- [ ] **Step 3: Run lint**

```bash
pnpm lint
```

Expected: clean. Address any `no-explicit-any` / unused-var lints — A.1 should have none since adapters are fully typed.

- [ ] **Step 4: Run dashboard build (CI does not — per memory `feedback_dashboard_build_not_in_ci`)**

```bash
pnpm --filter @switchboard/dashboard build
```

Expected: build succeeds. This catches `.js`-extension regressions and Next.js-specific compile issues that vitest misses.

- [ ] **Step 5: Manual smoke test**

Start the dev stack:

```bash
pnpm dev
```

Navigate to:

- `http://localhost:3002/alex` — should render the cockpit with amber accent, Alex tab active, status pill `IDLE` (or `WAITING` if seed data has pending approvals).
- `http://localhost:3002/riley` — should render the legacy block-based home unchanged.

Click the Halt button on `/alex` — status pill should turn red and read `HALTED`; composer placeholder copy should change to halted variant.

- [ ] **Step 6: Open PR**

```bash
git push -u origin feat/alex-cockpit-a1
gh pr create --title "feat(cockpit): A.1 shell + basic Alex composition" --body "$(cat <<'EOF'
## Summary

- New shared cockpit shell under `apps/dashboard/src/components/cockpit/` (Topbar, Identity, status pill, ApprovalBlock, ActivityStream, composer placeholder, CockpitPage)
- Adapters (`legacy-pending-approval-to-approval-view.ts`, `activity-kind-map.ts`) translate existing `usePendingApprovals` + `useAgentActivity` outputs into the shell's view-models
- `/alex` route now renders `<CockpitPage>`; `/riley` and `/mira` continue with `LegacyAgentHomeClient`
- Status pill uses A.1 vocabulary (`IDLE / WORKING / WAITING / HALTED`) — `TALKING` ships when conversation-grain backend signals are present
- No new API routes, no schema changes, no Prisma migrations, no command palette, no KPI/ROI, no old-component deletion
- Follows the Phase A slice plan in [the parent spec](docs/superpowers/specs/2026-05-14-alex-cockpit-home-design.md) §Implementation slices

## Test plan

- [x] `pnpm --filter @switchboard/dashboard test` — green
- [x] `pnpm typecheck` — clean
- [x] `pnpm lint` — clean
- [x] `pnpm --filter @switchboard/dashboard build` — succeeds (dashboard build is not in CI per project memory)
- [ ] Manual: `/alex` renders cockpit with all 4 status states reachable
- [ ] Manual: `/riley` and `/mira` continue to render legacy
- [ ] Manual: Halt button toggles status pill + composer copy

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review

**Spec coverage:** Every A.1 ship-item from `2026-05-14-alex-cockpit-home-design.md` §Implementation slices is covered by a task above (Tasks 1–19). A.1's "does not ship" items are absent from this plan — verified.

**Placeholder scan:** No `TBD` / `TODO` / "implement later" / "similar to Task N". The single `// A.5 wires the palette` comment in Task 18 is a concrete pointer to a named future slice, not a deferred-implementation marker — the no-op button it annotates is the actual A.1 behavior (palette is not in A.1's scope).

**Type consistency:** `CockpitStatus`, `ApprovalView`, `ActivityRow`, `ActivityKind`, `ApprovalUrgency`, `AlexApprovalKind`, `RileyApprovalKind` are defined once in Task 2 and referenced by exact name in every subsequent task. `legacyPendingApprovalToApprovalView`, `translatedActionToActivityRow`, `deriveAlexStatusA1`, `statusColor`, `statusPulse`, `animState` are defined in their own task and imported with the same names downstream. Hook input/output shapes match: `usePendingApprovals` returns `{ data: { approvals: PendingApproval[] }}`; `useAgentActivity` returns `{ data: { actions: TranslatedAction[] }}` — verified against current code in §Tasks 6 + 7.

**Note on the `legacy-branch test details preserved`** wording in Task 19/Step 3: the writing-plans skill flags "Similar to Task N" as a red-flag pattern. The text here is **not** that pattern — it explicitly instructs the engineer to preserve the existing assertions from the prior test file verbatim because reproducing them mid-plan would duplicate test code that already exists and that this PR is not changing. The instruction is to move-not-rewrite. If the engineer prefers to inline the existing assertions for clarity, that's fine; the behavior under test is unchanged.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-14-alex-cockpit-a1-implementation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
