# Console Wiring — Option B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `/console` to existing backend hooks where the data already exists. Render real queue, agents strip, and activity. Mark numbers-strip cells the backend can't yet serve as `—`. Defer schema extensions to option C.

**Architecture:** Pure mapper functions in a new `console-mappers.ts` translate raw hook output (`useDashboardOverview`, `useEscalations`, `useOrgConfig`, `useModuleStatus`, `useAudit`) into the existing `ConsoleData` view-model. The `use-console-data.ts` hook composes those mappers behind the same `{ data, isLoading, error }` interface. The view branches on those flags to render skeletons / error / live UI.

**Tech Stack:** Next.js 16 App Router, React Query (TanStack), TypeScript, Vitest + React Testing Library, Tailwind, scoped CSS. All exist already.

**Spec:** [`docs/superpowers/specs/2026-04-30-console-as-home-dashboard-design.md`](../specs/2026-04-30-console-as-home-dashboard-design.md), section "Phasing → Option B".

---

## File structure

| File                                                                      | What                                                                                                                                                                                                                                   | Status                |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `apps/dashboard/src/components/console/console-mappers.ts`                | Pure mapper functions: `mapOpStrip`, `mapNumbersStrip`, `mapEscalationCard`, `mapApprovalGateCard`, `mapQueue`, `mapAgents`, `mapActivity`. No React, no hooks. Trivially unit-testable.                                               | Create                |
| `apps/dashboard/src/components/console/__tests__/console-mappers.test.ts` | Co-located mapper tests, one per mapper. Vitest.                                                                                                                                                                                       | Create                |
| `apps/dashboard/src/components/console/use-console-data.ts`               | Becomes the hook composer: pulls raw data from `useDashboardOverview` / `useEscalations` / `useOrgConfig` / `useModuleStatus` / `useAudit`, runs mappers, returns `{ data, isLoading, error }`.                                        | Modify (rewrite body) |
| `apps/dashboard/src/components/console/console-data.ts`                   | Adds `"system"` to `AgentKey` union (for unattributed activity rows). Adds optional `placeholder?: boolean` to `NumbersCell` so the view can grey-out `—` cells. Keeps the `consoleFixture` export for tests + Storybook-style review. | Modify                |
| `apps/dashboard/src/components/console/console-view.tsx`                  | Renders `placeholder` cells with muted styling. Renders agent name with the `system` case (uppercase `SYSTEM`). Adds simple loading skeleton + error banner branches when `isLoading` / `error` is set.                                | Modify                |
| `apps/dashboard/src/components/console/console.css`                       | Adds `.num-cell.placeholder` class (muted value color). Adds `.console-loading` skeleton + `.console-error` banner classes.                                                                                                            | Modify                |
| `apps/dashboard/src/components/console/__tests__/console-view.test.tsx`   | One render test using the fixture: asserts headline elements present, placeholder cells render `—`, loading + error branches mount.                                                                                                    | Create                |

Files **not** touched: `apps/dashboard/src/app/(auth)/console/page.tsx` (the route), the dashboard overview API route, any schema in `packages/schemas`. Option C touches those.

## Hook reference (read once before starting)

| Hook                     | Returns                                                                                                                                                                                                                                                                                                                                                                                                                                             | Used for                                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `useDashboardOverview()` | `{ data: DashboardOverview, isLoading, isError, error }` per `apps/dashboard/src/hooks/use-dashboard-overview.ts:13`. Schema: `packages/schemas/src/dashboard.ts:3`.                                                                                                                                                                                                                                                                                | numbers strip (leads, appointments), approval-gate queue cards (filter `approvals` by `riskCategory`), greeting if needed |
| `useEscalations()`       | `{ data: { escalations: EscalationRow[] }, isLoading, isError }` per `apps/dashboard/src/hooks/use-escalations.ts:6`. Row shape from `apps/api/src/routes/escalations.ts:48-63`: `{ id, sessionId, leadId, status, reason, conversationSummary, leadSnapshot, qualificationSnapshot, slaDeadlineAt, acknowledgedAt, resolutionNote, resolvedAt, createdAt, updatedAt }`. `leadSnapshot` is a JSON object — `leadSnapshot.name` is the contact name. | escalation queue cards                                                                                                    |
| `useOrgConfig()`         | `{ data: { config: { name, currency, ... } } }` per `apps/dashboard/src/hooks/use-org-config.ts`.                                                                                                                                                                                                                                                                                                                                                   | operating strip org name, currency for revenue formatting                                                                 |
| `useModuleStatus()`      | per-module `{ enabled: boolean }` keyed by module slug per `apps/dashboard/src/hooks/use-module-status.ts`. Modules of interest: `chat-replies` (Alex), `ad-optimizer` (Nova), `creative-pipeline` (Mira).                                                                                                                                                                                                                                          | agent strip active/inactive cells; recommendation cards in queue (skip if module disabled)                                |
| `useAudit()`             | `{ entries: AuditEntryResponse[], error? }` per `apps/dashboard/src/hooks/use-audit.ts`. Each entry has `{ id, actorId, action, ... }`. No `agent` field — must synthesize.                                                                                                                                                                                                                                                                         | activity trail                                                                                                            |

If a hook's exact shape doesn't match the description above, inspect the file and adapt; don't guess.

---

## Task 1: Pre-flight — branch + baseline

**Files:** none modified.

- [ ] **Step 1:** Switch to the implementation branch.

  ```bash
  git checkout feat/console-preview
  git status --short
  ```

  Expected: clean tree (no uncommitted changes); HEAD = the `/console preview` commit.

- [ ] **Step 2:** Verify baseline typecheck passes.

  ```bash
  cd /Users/jasonli/switchboard
  pnpm --filter @switchboard/dashboard typecheck
  ```

  Expected: PASS. If it fails, run `pnpm reset` first (per `CLAUDE.md`), then retry.

- [ ] **Step 3:** Verify baseline tests pass.

  ```bash
  pnpm --filter @switchboard/dashboard test
  ```

  Expected: all 295+ tests pass.

- [ ] **Step 4:** Read the five hook files listed in _Hook reference_ above to confirm shapes. Don't write notes — load them into context for the next tasks.

---

## Task 2: Add `"system"` to `AgentKey`; add `placeholder` to `NumbersCell`

**Files:**

- Modify: `apps/dashboard/src/components/console/console-data.ts`

- [ ] **Step 1:** Edit `console-data.ts`. Replace the `AgentKey` line with the union including `"system"`, and add `placeholder` to `NumbersCell`.

  ```ts
  // Replace:
  export type AgentKey = "alex" | "nova" | "mira";
  // With:
  export type AgentKey = "alex" | "nova" | "mira" | "system";
  ```

  ```ts
  // Replace the NumbersCell type with:
  export type NumbersCell = {
    label: string;
    value: string;
    delta: RichText;
    tone?: "good" | "coral" | "neutral";
    /** When true, render value as muted "—" placeholder; data not yet wired. */
    placeholder?: boolean;
  };
  ```

- [ ] **Step 2:** Run typecheck.

  ```bash
  pnpm --filter @switchboard/dashboard typecheck
  ```

  Expected: PASS. (The fixture doesn't use `placeholder`; "system" is a new union member nothing constructs yet.)

- [ ] **Step 3:** Commit.

  ```bash
  git add apps/dashboard/src/components/console/console-data.ts
  git commit -m "feat(dashboard): extend console view-model — AgentKey adds 'system', NumbersCell adds placeholder flag"
  ```

---

## Task 3: Create `console-mappers.ts` skeleton + first failing mapper test

**Files:**

- Create: `apps/dashboard/src/components/console/console-mappers.ts`
- Create: `apps/dashboard/src/components/console/__tests__/console-mappers.test.ts`

- [ ] **Step 1:** Create the mappers file with empty stubs (typed but unimplemented).

  ```ts
  // apps/dashboard/src/components/console/console-mappers.ts
  import type {
    ActivityRow,
    AgentKey,
    AgentStripEntry,
    ApprovalGateCard,
    ConsoleData,
    EscalationCard,
    NumbersStrip,
    OpStrip,
    QueueCard,
  } from "./console-data";

  // ── Op strip ──────────────────────────────────────────────────────────────
  export function mapOpStrip(orgName: string, now: Date, dispatch: "live" | "halted"): OpStrip {
    throw new Error("not implemented");
  }

  // ── Numbers strip ─────────────────────────────────────────────────────────
  export type NumbersInput = {
    leadsToday: number;
    leadsYesterday: number;
    bookingsToday: Array<{ startsAt: string; contactName: string }>;
  };
  export function mapNumbersStrip(input: NumbersInput): NumbersStrip {
    throw new Error("not implemented");
  }

  // ── Queue ─────────────────────────────────────────────────────────────────
  export type EscalationApiRow = {
    id: string;
    leadSnapshot?: { name?: string; channel?: string } | null;
    reason?: string | null;
    conversationSummary?: string | null;
    createdAt: string;
  };
  export function mapEscalationCard(row: EscalationApiRow, now: Date): EscalationCard {
    throw new Error("not implemented");
  }

  export type ApprovalApiRow = {
    id: string;
    summary: string;
    riskContext: string | null;
    riskCategory: string;
    createdAt: string;
  };
  export function mapApprovalGateCard(row: ApprovalApiRow, now: Date): ApprovalGateCard {
    throw new Error("not implemented");
  }

  export function mapQueue(
    escalations: EscalationApiRow[],
    approvals: ApprovalApiRow[],
    now: Date,
  ): QueueCard[] {
    throw new Error("not implemented");
  }

  // ── Agents ────────────────────────────────────────────────────────────────
  export type ModuleEnablementMap = {
    alex: boolean;
    nova: boolean;
    mira: boolean;
  };
  export function mapAgents(modules: ModuleEnablementMap): AgentStripEntry[] {
    throw new Error("not implemented");
  }

  // ── Activity ──────────────────────────────────────────────────────────────
  export type AuditEntry = {
    id: string;
    action: string;
    actorId: string | null;
    createdAt: string;
    metadata?: Record<string, unknown> | null;
  };
  export function mapActivity(entries: AuditEntry[]): { moreToday: number; rows: ActivityRow[] } {
    throw new Error("not implemented");
  }

  // ── Top-level composer ────────────────────────────────────────────────────
  export type MapConsoleInput = {
    orgName: string;
    now: Date;
    dispatch: "live" | "halted";
    leadsToday: number;
    leadsYesterday: number;
    bookingsToday: Array<{ startsAt: string; contactName: string }>;
    escalations: EscalationApiRow[];
    approvals: ApprovalApiRow[];
    modules: ModuleEnablementMap;
    auditEntries: AuditEntry[];
  };
  export function mapConsoleData(input: MapConsoleInput): ConsoleData {
    throw new Error("not implemented");
  }
  ```

- [ ] **Step 2:** Create the test file with the first failing test.

  ```ts
  // apps/dashboard/src/components/console/__tests__/console-mappers.test.ts
  import { describe, expect, it } from "vitest";
  import { mapOpStrip } from "../console-mappers";

  describe("mapOpStrip", () => {
    it("formats now as 'Day HH:MM AM/PM' and passes through orgName + dispatch", () => {
      const now = new Date("2026-04-30T10:42:00");
      const result = mapOpStrip("Aurora Dental", now, "live");
      expect(result.orgName).toBe("Aurora Dental");
      expect(result.dispatch).toBe("live");
      // e.g. "Thu 10:42 AM"
      expect(result.now).toMatch(/^[A-Z][a-z]{2} \d{1,2}:\d{2} (AM|PM)$/);
    });
  });
  ```

- [ ] **Step 3:** Run the test — confirm it fails.

  ```bash
  pnpm --filter @switchboard/dashboard test src/components/console/__tests__/console-mappers.test.ts
  ```

  Expected: FAIL with `Error: not implemented`.

- [ ] **Step 4:** Commit the failing scaffold.

  ```bash
  git add apps/dashboard/src/components/console/console-mappers.ts apps/dashboard/src/components/console/__tests__/console-mappers.test.ts
  git commit -m "test(dashboard): scaffold console-mappers with failing mapOpStrip test"
  ```

---

## Task 4: Implement `mapOpStrip`

**Files:**

- Modify: `apps/dashboard/src/components/console/console-mappers.ts`

- [ ] **Step 1:** Replace the body of `mapOpStrip`.

  ```ts
  export function mapOpStrip(orgName: string, now: Date, dispatch: "live" | "halted"): OpStrip {
    const day = now.toLocaleDateString("en-US", { weekday: "short" });
    const time = now.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return { orgName, now: `${day} ${time}`, dispatch };
  }
  ```

- [ ] **Step 2:** Run the test — confirm it passes.

  ```bash
  pnpm --filter @switchboard/dashboard test src/components/console/__tests__/console-mappers.test.ts
  ```

  Expected: 1 test pass.

- [ ] **Step 3:** Commit.

  ```bash
  git add apps/dashboard/src/components/console/console-mappers.ts
  git commit -m "feat(dashboard): mapOpStrip — format now as 'Day HH:MM AM/PM'"
  ```

---

## Task 5: Implement `mapNumbersStrip` (2 real cells, 3 placeholders)

**Files:**

- Modify: `apps/dashboard/src/components/console/console-mappers.ts`
- Modify: `apps/dashboard/src/components/console/__tests__/console-mappers.test.ts`

- [ ] **Step 1:** Add the failing tests at the bottom of `console-mappers.test.ts`.

  ```ts
  import { mapNumbersStrip } from "../console-mappers";

  describe("mapNumbersStrip", () => {
    const baseInput = { leadsToday: 7, leadsYesterday: 5, bookingsToday: [] };

    it("returns 5 cells", () => {
      const result = mapNumbersStrip(baseInput);
      expect(result.cells).toHaveLength(5);
    });

    it("Leads cell uses today vs yesterday delta", () => {
      const result = mapNumbersStrip(baseInput);
      const leads = result.cells.find((c) => c.label === "Leads today");
      expect(leads?.value).toBe("7");
      expect(leads?.placeholder).not.toBe(true);
      expect(leads?.tone).toBe("good"); // 7 > 5
    });

    it("Leads cell tone is coral when down vs yesterday", () => {
      const result = mapNumbersStrip({ ...baseInput, leadsToday: 3 });
      const leads = result.cells.find((c) => c.label === "Leads today");
      expect(leads?.tone).toBe("coral");
    });

    it("Appointments cell shows count + next time", () => {
      const result = mapNumbersStrip({
        ...baseInput,
        bookingsToday: [
          { startsAt: "2026-04-30T11:00:00", contactName: "Sarah" },
          { startsAt: "2026-04-30T14:30:00", contactName: "Marisol" },
        ],
      });
      const appts = result.cells.find((c) => c.label === "Appointments");
      expect(appts?.value).toBe("2");
      // delta should reference "11:00" and "Sarah"
      const text = JSON.stringify(appts?.delta);
      expect(text).toContain("11:00");
      expect(text).toContain("Sarah");
    });

    it("Revenue / Spend / Reply Time are placeholder cells", () => {
      const result = mapNumbersStrip(baseInput);
      const rev = result.cells.find((c) => c.label === "Revenue today");
      const spend = result.cells.find((c) => c.label === "Spend today");
      const reply = result.cells.find((c) => c.label === "Reply time");
      for (const cell of [rev, spend, reply]) {
        expect(cell?.placeholder).toBe(true);
        expect(cell?.value).toBe("—");
      }
    });
  });
  ```

- [ ] **Step 2:** Run tests — confirm 4 new tests fail.

  ```bash
  pnpm --filter @switchboard/dashboard test src/components/console/__tests__/console-mappers.test.ts
  ```

- [ ] **Step 3:** Implement `mapNumbersStrip`.

  ```ts
  export function mapNumbersStrip(input: NumbersInput): NumbersStrip {
    const leadsDelta = input.leadsToday - input.leadsYesterday;
    const leadsTone = leadsDelta >= 0 ? "good" : "coral";
    const leadsArrow = leadsDelta >= 0 ? "↑" : "↓";
    const leadsAbs = Math.abs(leadsDelta);

    const appts = input.bookingsToday.length;
    const next = input.bookingsToday[0];
    const nextTime = next
      ? new Date(next.startsAt).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: false,
        })
      : null;

    return {
      cells: [
        {
          label: "Revenue today",
          value: "—",
          delta: ["pending option C"],
          tone: "neutral",
          placeholder: true,
        },
        {
          label: "Leads today",
          value: String(input.leadsToday),
          delta: [`${leadsArrow} `, { bold: String(leadsAbs) }, " vs yesterday"],
          tone: leadsTone,
        },
        {
          label: "Appointments",
          value: String(appts),
          delta: next
            ? ["next: ", { bold: nextTime ?? "" }, ` · ${next.contactName}`]
            : ["none scheduled"],
          tone: "neutral",
        },
        {
          label: "Spend today",
          value: "—",
          delta: ["pending option C"],
          tone: "neutral",
          placeholder: true,
        },
        {
          label: "Reply time",
          value: "—",
          delta: ["pending option C"],
          tone: "neutral",
          placeholder: true,
        },
      ],
    };
  }
  ```

- [ ] **Step 4:** Run tests — confirm all 5 in `mapNumbersStrip` block pass.

- [ ] **Step 5:** Commit.

  ```bash
  git add apps/dashboard/src/components/console/console-mappers.ts apps/dashboard/src/components/console/__tests__/console-mappers.test.ts
  git commit -m "feat(dashboard): mapNumbersStrip — 2 real cells (leads, appointments), 3 placeholders"
  ```

---

## Task 6: Implement `mapEscalationCard` + `mapApprovalGateCard`

**Files:**

- Modify: `apps/dashboard/src/components/console/console-mappers.ts`
- Modify: `apps/dashboard/src/components/console/__tests__/console-mappers.test.ts`

- [ ] **Step 1:** Add the failing tests.

  ```ts
  import { mapApprovalGateCard, mapEscalationCard } from "../console-mappers";

  describe("mapEscalationCard", () => {
    it("maps a pending escalation row to an EscalationCard", () => {
      const row = {
        id: "esc-1",
        leadSnapshot: { name: "Sarah", channel: "WhatsApp" },
        reason: "Asking about a 15% discount.",
        conversationSummary: null,
        createdAt: "2026-04-30T10:38:00",
      };
      const now = new Date("2026-04-30T10:42:00");
      const card = mapEscalationCard(row, now);
      expect(card.kind).toBe("escalation");
      expect(card.id).toBe("esc-1");
      expect(card.contactName).toBe("Sarah");
      expect(card.channel).toBe("WhatsApp");
      expect(card.timer.ageDisplay).toContain("min ago");
      expect(card.timer.label).toBe("Urgent");
      expect(card.agent).toBe("alex");
      // issue should contain the reason text as a string segment
      expect(card.issue.some((s) => typeof s === "string" && s.includes("15%"))).toBe(true);
    });

    it("falls back to 'Unknown' contact and '—' channel when leadSnapshot is missing", () => {
      const card = mapEscalationCard(
        {
          id: "esc-2",
          leadSnapshot: null,
          reason: "x",
          conversationSummary: null,
          createdAt: "2026-04-30T10:00:00",
        },
        new Date("2026-04-30T10:42:00"),
      );
      expect(card.contactName).toBe("Unknown");
      expect(card.channel).toBe("—");
    });
  });

  describe("mapApprovalGateCard", () => {
    it("maps a creative-risk approval row to an ApprovalGateCard", () => {
      const row = {
        id: "apr-1",
        summary: "Campaign 01 — Dental UGC Series",
        riskContext: "Hooks ready",
        riskCategory: "creative",
        createdAt: "2026-04-30T08:42:00", // 2h ago
      };
      const now = new Date("2026-04-30T10:42:00");
      const card = mapApprovalGateCard(row, now);
      expect(card.kind).toBe("approval_gate");
      expect(card.jobName).toBe("Campaign 01 — Dental UGC Series");
      expect(card.timer.stageLabel).toBe("Hooks ready");
      expect(card.timer.ageDisplay).toContain("h ago");
      expect(card.agent).toBe("mira");
      // stage progress + countdown stay synthesized until option C
      expect(card.stageProgress).toBe("—");
      expect(card.countdown).toBe("—");
    });
  });
  ```

- [ ] **Step 2:** Run tests — confirm new tests fail.

- [ ] **Step 3:** Implement both mappers + a small `formatAge` helper. Add to the bottom of `console-mappers.ts` above the closing of the file:

  ```ts
  function formatAge(createdAt: string, now: Date): string {
    const ms = now.getTime() - new Date(createdAt).getTime();
    const min = Math.floor(ms / 60_000);
    if (min < 1) return "just now";
    if (min < 60) return `${min} min ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const days = Math.floor(hr / 24);
    return `${days}d ago`;
  }

  export function mapEscalationCard(row: EscalationApiRow, now: Date): EscalationCard {
    const contactName = row.leadSnapshot?.name?.trim() || "Unknown";
    const channel = row.leadSnapshot?.channel?.trim() || "—";
    const reasonText = row.reason?.trim() || row.conversationSummary?.trim() || "";
    return {
      kind: "escalation",
      id: row.id,
      agent: "alex",
      contactName,
      channel,
      timer: { label: "Urgent", ageDisplay: formatAge(row.createdAt, now) },
      issue: [reasonText],
      primary: { label: "Reply" },
      secondary: { label: "Hold the line" },
      selfHandle: { label: "I'll handle this" },
    };
  }

  export function mapApprovalGateCard(row: ApprovalApiRow, now: Date): ApprovalGateCard {
    return {
      kind: "approval_gate",
      id: row.id,
      agent: "mira",
      jobName: row.summary,
      timer: {
        stageLabel: row.riskContext?.trim() || "Approval needed",
        ageDisplay: formatAge(row.createdAt, now),
      },
      stageProgress: "—",
      stageDetail: row.riskContext?.trim() || "",
      countdown: "—",
      primary: { label: "Review →" },
      stop: { label: "Stop campaign" },
    };
  }
  ```

- [ ] **Step 4:** Run tests — confirm pass.

- [ ] **Step 5:** Commit.

  ```bash
  git add apps/dashboard/src/components/console/console-mappers.ts apps/dashboard/src/components/console/__tests__/console-mappers.test.ts
  git commit -m "feat(dashboard): mapEscalationCard + mapApprovalGateCard with synthesized stage/countdown"
  ```

---

## Task 7: Implement `mapQueue` (composes the row mappers + filters)

**Files:**

- Modify: `apps/dashboard/src/components/console/console-mappers.ts`
- Modify: `apps/dashboard/src/components/console/__tests__/console-mappers.test.ts`

- [ ] **Step 1:** Add the failing tests.

  ```ts
  import { mapQueue } from "../console-mappers";

  describe("mapQueue", () => {
    const now = new Date("2026-04-30T10:42:00");

    it("emits escalation cards before approval gate cards", () => {
      const queue = mapQueue(
        [
          {
            id: "e1",
            leadSnapshot: { name: "X" },
            reason: "r",
            conversationSummary: null,
            createdAt: "2026-04-30T10:30:00",
          },
        ],
        [
          {
            id: "a1",
            summary: "Campaign 1",
            riskContext: "Hooks ready",
            riskCategory: "creative",
            createdAt: "2026-04-30T09:00:00",
          },
        ],
        now,
      );
      expect(queue).toHaveLength(2);
      expect(queue[0].kind).toBe("escalation");
      expect(queue[1].kind).toBe("approval_gate");
    });

    it("filters approvals to creative-risk only", () => {
      const queue = mapQueue(
        [],
        [
          {
            id: "a1",
            summary: "x",
            riskContext: null,
            riskCategory: "low",
            createdAt: "2026-04-30T10:00:00",
          },
          {
            id: "a2",
            summary: "y",
            riskContext: "Hooks ready",
            riskCategory: "creative",
            createdAt: "2026-04-30T10:00:00",
          },
        ],
        now,
      );
      expect(queue).toHaveLength(1);
      expect((queue[0] as { id: string }).id).toBe("a2");
    });

    it("returns [] when both inputs empty", () => {
      expect(mapQueue([], [], now)).toEqual([]);
    });
  });
  ```

- [ ] **Step 2:** Run tests — confirm fail.

- [ ] **Step 3:** Implement.

  ```ts
  export function mapQueue(
    escalations: EscalationApiRow[],
    approvals: ApprovalApiRow[],
    now: Date,
  ): QueueCard[] {
    const escCards = escalations.map((e) => mapEscalationCard(e, now));
    const gateCards = approvals
      .filter((a) => a.riskCategory === "creative")
      .map((a) => mapApprovalGateCard(a, now));
    // Recommendation cards are not exposed by the backend in option B; option C wires them.
    return [...escCards, ...gateCards];
  }
  ```

- [ ] **Step 4:** Run tests — confirm pass.

- [ ] **Step 5:** Commit.

  ```bash
  git add apps/dashboard/src/components/console/console-mappers.ts apps/dashboard/src/components/console/__tests__/console-mappers.test.ts
  git commit -m "feat(dashboard): mapQueue composes escalation + creative-risk approvals (no recommendations until C)"
  ```

---

## Task 8: Implement `mapAgents`

**Files:**

- Modify: `apps/dashboard/src/components/console/console-mappers.ts`
- Modify: `apps/dashboard/src/components/console/__tests__/console-mappers.test.ts`

- [ ] **Step 1:** Add the failing tests.

  ```ts
  import { mapAgents } from "../console-mappers";

  describe("mapAgents", () => {
    it("returns 3 entries (Alex / Nova / Mira) with viewLink hrefs", () => {
      const result = mapAgents({ alex: true, nova: true, mira: true });
      expect(result).toHaveLength(3);
      expect(result.map((a) => a.key)).toEqual(["alex", "nova", "mira"]);
      expect(result[0].viewLink.href).toBe("/conversations");
      expect(result[1].viewLink.href).toBe("/modules/ad-optimizer");
      expect(result[2].viewLink.href).toBe("/modules/creative");
    });

    it("makes Nova the active panel when enabled, otherwise Alex", () => {
      expect(mapAgents({ alex: true, nova: true, mira: true }).find((a) => a.active)?.key).toBe(
        "nova",
      );
      expect(mapAgents({ alex: true, nova: false, mira: true }).find((a) => a.active)?.key).toBe(
        "alex",
      );
    });

    it("does not render synthesized stats — they read 'pending'", () => {
      const result = mapAgents({ alex: true, nova: true, mira: true });
      // primaryStat should reflect pending state — option B does not have today-stats
      expect(result.every((a) => a.primaryStat === "pending option C")).toBe(true);
    });
  });
  ```

- [ ] **Step 2:** Run tests — confirm fail.

- [ ] **Step 3:** Implement.

  ```ts
  export function mapAgents(modules: ModuleEnablementMap): AgentStripEntry[] {
    const activeKey: AgentKey = modules.nova ? "nova" : modules.alex ? "alex" : "mira";
    return (
      [
        { key: "alex", name: "Alex", href: "/conversations", label: "view conversations →" },
        { key: "nova", name: "Nova", href: "/modules/ad-optimizer", label: "view ad actions →" },
        { key: "mira", name: "Mira", href: "/modules/creative", label: "view creative →" },
      ] as const
    ).map((a) => ({
      key: a.key,
      name: a.name,
      primaryStat: "pending option C",
      subStat: ["—"],
      viewLink: { label: a.label, href: a.href },
      active: a.key === activeKey,
    }));
  }
  ```

- [ ] **Step 4:** Run tests — confirm pass.

- [ ] **Step 5:** Commit.

  ```bash
  git add apps/dashboard/src/components/console/console-mappers.ts apps/dashboard/src/components/console/__tests__/console-mappers.test.ts
  git commit -m "feat(dashboard): mapAgents — three entries with active-by-module-priority, stats pending option C"
  ```

---

## Task 9: Implement `mapActivity` (synthesized agent attribution)

**Files:**

- Modify: `apps/dashboard/src/components/console/console-mappers.ts`
- Modify: `apps/dashboard/src/components/console/__tests__/console-mappers.test.ts`

- [ ] **Step 1:** Add the failing tests.

  ```ts
  import { mapActivity } from "../console-mappers";

  describe("mapActivity", () => {
    const today = new Date().toISOString();

    it("formats createdAt to HH:MM and synthesizes agent from action prefix", () => {
      const result = mapActivity([
        {
          id: "1",
          action: "alex.replied",
          actorId: "agent:alex",
          createdAt: "2026-04-30T10:42:00",
        },
        {
          id: "2",
          action: "nova.draft.created",
          actorId: "agent:nova",
          createdAt: "2026-04-30T10:38:00",
        },
        { id: "3", action: "system.audit.tick", actorId: null, createdAt: "2026-04-30T10:00:00" },
      ]);
      expect(result.rows).toHaveLength(3);
      expect(result.rows[0].agent).toBe("alex");
      expect(result.rows[0].time).toBe("10:42");
      expect(result.rows[1].agent).toBe("nova");
      expect(result.rows[2].agent).toBe("system");
    });

    it("caps moreToday at total entries from today minus 9 displayed", () => {
      const entries = Array.from({ length: 14 }, (_, i) => ({
        id: `e${i}`,
        action: "alex.replied",
        actorId: "agent:alex",
        createdAt: today,
      }));
      const result = mapActivity(entries);
      expect(result.rows).toHaveLength(9);
      expect(result.moreToday).toBe(5);
    });
  });
  ```

- [ ] **Step 2:** Run tests — confirm fail.

- [ ] **Step 3:** Implement.

  ```ts
  function agentForAction(action: string, actorId: string | null): AgentKey {
    const key = (actorId ?? action).toLowerCase();
    if (key.includes("alex")) return "alex";
    if (key.includes("nova")) return "nova";
    if (key.includes("mira")) return "mira";
    return "system";
  }

  function formatHHMM(createdAt: string): string {
    return new Date(createdAt).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  function isToday(createdAt: string, now: Date): boolean {
    const d = new Date(createdAt);
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  }

  export function mapActivity(entries: AuditEntry[]): { moreToday: number; rows: ActivityRow[] } {
    const now = new Date();
    const todayEntries = entries.filter((e) => isToday(e.createdAt, now));
    const displayed = entries.slice(0, 9);
    const moreToday = Math.max(0, todayEntries.length - displayed.length);
    const rows: ActivityRow[] = displayed.map((e) => ({
      id: e.id,
      time: formatHHMM(e.createdAt),
      agent: agentForAction(e.action, e.actorId),
      message: [e.action.replace(/^[^.]+\./, "").replace(/[._]/g, " ")],
    }));
    return { moreToday, rows };
  }
  ```

- [ ] **Step 4:** Run tests — confirm pass.

- [ ] **Step 5:** Commit.

  ```bash
  git add apps/dashboard/src/components/console/console-mappers.ts apps/dashboard/src/components/console/__tests__/console-mappers.test.ts
  git commit -m "feat(dashboard): mapActivity — synthesized agent attribution, top-9 with moreToday count"
  ```

---

## Task 10: Implement `mapConsoleData` (top-level composer)

**Files:**

- Modify: `apps/dashboard/src/components/console/console-mappers.ts`
- Modify: `apps/dashboard/src/components/console/__tests__/console-mappers.test.ts`

- [ ] **Step 1:** Add the failing test.

  ```ts
  import { mapConsoleData } from "../console-mappers";

  describe("mapConsoleData", () => {
    it("composes all sections into a ConsoleData shape", () => {
      const result = mapConsoleData({
        orgName: "Aurora Dental",
        now: new Date("2026-04-30T10:42:00"),
        dispatch: "live",
        leadsToday: 7,
        leadsYesterday: 5,
        bookingsToday: [{ startsAt: "2026-04-30T11:00:00", contactName: "Sarah" }],
        escalations: [],
        approvals: [],
        modules: { alex: true, nova: true, mira: true },
        auditEntries: [],
      });
      expect(result.opStrip.orgName).toBe("Aurora Dental");
      expect(result.numbers.cells).toHaveLength(5);
      expect(result.queue).toEqual([]);
      expect(result.queueLabel.count).toBe("0 pending");
      expect(result.agents).toHaveLength(3);
      expect(result.activity.rows).toEqual([]);
      // Nova panel stays fixture-shaped in option B (visual-only until C)
      expect(result.novaPanel.rows.length).toBeGreaterThan(0);
    });
  });
  ```

- [ ] **Step 2:** Run tests — confirm fail.

- [ ] **Step 3:** Implement. The Nova panel keeps the fixture shape until option C; import it from `console-data.ts`.

  ```ts
  import { consoleFixture } from "./console-data";

  export function mapConsoleData(input: MapConsoleInput): ConsoleData {
    const queue = mapQueue(input.escalations, input.approvals, input.now);
    return {
      opStrip: mapOpStrip(input.orgName, input.now, input.dispatch),
      numbers: mapNumbersStrip({
        leadsToday: input.leadsToday,
        leadsYesterday: input.leadsYesterday,
        bookingsToday: input.bookingsToday,
      }),
      queueLabel: { count: `${queue.length} pending` },
      queue,
      agents: mapAgents(input.modules),
      novaPanel: consoleFixture.novaPanel, // option C replaces this with real ad-set aggregation
      activity: mapActivity(input.auditEntries),
    };
  }
  ```

- [ ] **Step 4:** Run all mapper tests — confirm pass.

  ```bash
  pnpm --filter @switchboard/dashboard test src/components/console/__tests__/console-mappers.test.ts
  ```

- [ ] **Step 5:** Commit.

  ```bash
  git add apps/dashboard/src/components/console/console-mappers.ts apps/dashboard/src/components/console/__tests__/console-mappers.test.ts
  git commit -m "feat(dashboard): mapConsoleData top-level composer; Nova panel stays fixture until option C"
  ```

---

## Task 11: Rewrite `use-console-data.ts` to compose real hooks

**Files:**

- Modify: `apps/dashboard/src/components/console/use-console-data.ts`

- [ ] **Step 1:** Replace the entire file.

  ```ts
  "use client";

  import { useDashboardOverview } from "@/hooks/use-dashboard-overview";
  import { useEscalations } from "@/hooks/use-escalations";
  import { useOrgConfig } from "@/hooks/use-org-config";
  import { useModuleStatus } from "@/hooks/use-module-status";
  import { useAudit } from "@/hooks/use-audit";
  import type { ConsoleData } from "./console-data";
  import { consoleFixture } from "./console-data";
  import {
    mapConsoleData,
    type ApprovalApiRow,
    type AuditEntry,
    type EscalationApiRow,
  } from "./console-mappers";

  /**
   * Single composer for the Console view-model.
   *
   * Option B (this file): wires real hooks where the backend already serves
   * the data. Numbers cells the backend can't yet produce render as `—`.
   * Recommendation cards aren't emitted (no `nova.drafts` feed yet).
   * Per-agent today-stats render as "pending option C".
   *
   * Option C (future): extends `DashboardOverview` to add
   * revenueToday / spendToday / replyTime / per-agent today-stats /
   * approval-gate stage progress / recommendation confidence /
   * activity agent attribution / aggregated ad-set rows.
   */
  export function useConsoleData(): {
    data: ConsoleData;
    isLoading: boolean;
    error: Error | null;
  } {
    const overview = useDashboardOverview();
    const escalations = useEscalations();
    const org = useOrgConfig();
    const modules = useModuleStatus();
    const audit = useAudit();

    const isLoading =
      overview.isLoading ||
      escalations.isLoading ||
      org.isLoading ||
      modules.isLoading ||
      audit.isLoading;

    const error =
      (overview.error as Error | null) ??
      (escalations.error as Error | null) ??
      (org.error as Error | null) ??
      (modules.error as Error | null) ??
      (audit.error as Error | null) ??
      null;

    if (isLoading || error || !overview.data || !org.data) {
      return { data: consoleFixture, isLoading, error };
    }

    const escalationRows: EscalationApiRow[] =
      (escalations.data as { escalations?: EscalationApiRow[] } | undefined)?.escalations ?? [];
    const approvalRows: ApprovalApiRow[] = overview.data.approvals as ApprovalApiRow[];
    const auditEntries: AuditEntry[] = (audit.entries ?? []) as AuditEntry[];

    const moduleMap = {
      alex: Boolean(
        (modules.data as { "chat-replies"?: { enabled?: boolean } })?.["chat-replies"]?.enabled,
      ),
      nova: Boolean(
        (modules.data as { "ad-optimizer"?: { enabled?: boolean } })?.["ad-optimizer"]?.enabled,
      ),
      mira: Boolean(
        (modules.data as { "creative-pipeline"?: { enabled?: boolean } })?.["creative-pipeline"]
          ?.enabled,
      ),
    };

    const todayStr = new Date().toDateString();
    const bookingsToday = overview.data.bookings
      .filter((b) => new Date(b.startsAt).toDateString() === todayStr)
      .map((b) => ({ startsAt: b.startsAt, contactName: b.contactName }));

    const data = mapConsoleData({
      orgName: (org.data as { config?: { name?: string } })?.config?.name ?? "Switchboard",
      now: new Date(),
      dispatch: "live", // halt-state read in next phase via useDispatchStatus or org config
      leadsToday: overview.data.stats.newInquiriesToday,
      leadsYesterday: overview.data.stats.newInquiriesYesterday,
      bookingsToday,
      escalations: escalationRows,
      approvals: approvalRows,
      modules: moduleMap,
      auditEntries,
    });

    return { data, isLoading: false, error: null };
  }
  ```

- [ ] **Step 2:** Run typecheck.

  ```bash
  pnpm --filter @switchboard/dashboard typecheck
  ```

  Expected: PASS. If `useAudit` returns a different shape than the `entries` field used above, update the destructure to match the actual return.

- [ ] **Step 3:** Run all dashboard tests.

  ```bash
  pnpm --filter @switchboard/dashboard test
  ```

  Expected: PASS. Existing console tests still pass since the fixture path is preserved when data is loading.

- [ ] **Step 4:** Commit.

  ```bash
  git add apps/dashboard/src/components/console/use-console-data.ts
  git commit -m "feat(dashboard): wire useConsoleData to real hooks with fixture fallback during loading/error"
  ```

---

## Task 12: View handles `placeholder` numbers cells (muted styling)

**Files:**

- Modify: `apps/dashboard/src/components/console/console.css`
- Modify: `apps/dashboard/src/components/console/console-view.tsx`

- [ ] **Step 1:** Add the placeholder class to `console.css`. Find the existing `.num-cell` block and add this rule below it (before the `@media` query):

  ```css
  [data-v6-console] .num-cell.placeholder .n-value {
    color: var(--c-text-4);
    font-weight: 500;
  }
  [data-v6-console] .num-cell.placeholder .n-delta {
    color: var(--c-text-4);
    font-style: italic;
  }
  ```

- [ ] **Step 2:** Update `console-view.tsx` to add the `placeholder` class. Find the numbers section render block and replace the `className` expression:

  ```tsx
  // Replace:
  <div key={cell.label} className={`num-cell${cell.tone ? ` tone-${cell.tone}` : ""}`}>
  // With:
  <div
    key={cell.label}
    className={`num-cell${cell.tone ? ` tone-${cell.tone}` : ""}${cell.placeholder ? " placeholder" : ""}`}
  >
  ```

- [ ] **Step 3:** Run typecheck + tests.

  ```bash
  pnpm --filter @switchboard/dashboard typecheck && pnpm --filter @switchboard/dashboard test src/components/console
  ```

  Expected: PASS.

- [ ] **Step 4:** Commit.

  ```bash
  git add apps/dashboard/src/components/console/console.css apps/dashboard/src/components/console/console-view.tsx
  git commit -m "feat(dashboard): muted styling for placeholder numbers cells"
  ```

---

## Task 13: View handles loading + error states

**Files:**

- Modify: `apps/dashboard/src/components/console/console.css`
- Modify: `apps/dashboard/src/app/(auth)/console/page.tsx`

- [ ] **Step 1:** Add minimal loading + error styles to `console.css` at the bottom.

  ```css
  [data-v6-console] .console-error {
    margin: 1rem 2rem;
    padding: 1rem 1.25rem;
    border-left: 2px solid var(--c-coral);
    background: var(--c-coral-soft);
    font-family: var(--c-mono);
    font-size: 12px;
    color: var(--c-text-2);
  }
  [data-v6-console] .console-error b {
    color: var(--c-text);
    font-weight: 600;
  }
  ```

- [ ] **Step 2:** Update `(auth)/console/page.tsx` to render an error banner when the hook returns one. Loading state continues to show the fixture (a calm fallback), per the hook's contract.

  ```tsx
  "use client";

  import { useSession } from "next-auth/react";
  import { redirect } from "next/navigation";
  import { ConsoleView } from "@/components/console/console-view";
  import { useConsoleData } from "@/components/console/use-console-data";

  export default function ConsolePage() {
    const { status } = useSession();
    const { data, error } = useConsoleData();

    if (status === "unauthenticated") redirect("/login");

    return (
      <>
        {error && (
          <div data-v6-console>
            <div className="console-error">
              <b>Couldn&apos;t load live data.</b> Showing the last known shape.
            </div>
          </div>
        )}
        <ConsoleView data={data} />
      </>
    );
  }
  ```

- [ ] **Step 3:** Run typecheck.

- [ ] **Step 4:** Commit.

  ```bash
  git add apps/dashboard/src/components/console/console.css apps/dashboard/src/app/\(auth\)/console/page.tsx
  git commit -m "feat(dashboard): /console renders an error banner above the view when any hook fails"
  ```

---

## Task 14: ConsoleView render test (golden path)

**Files:**

- Create: `apps/dashboard/src/components/console/__tests__/console-view.test.tsx`

- [ ] **Step 1:** Create the test file.

  ```tsx
  import { describe, expect, it } from "vitest";
  import { render, screen } from "@testing-library/react";
  import { ConsoleView } from "../console-view";
  import { consoleFixture } from "../console-data";

  describe("ConsoleView", () => {
    it("renders all four zones with fixture data", () => {
      render(<ConsoleView data={consoleFixture} />);
      expect(screen.getByText(/Switchboard/)).toBeInTheDocument();
      expect(screen.getByText(/Aurora Dental/)).toBeInTheDocument();
      expect(screen.getByText("Queue")).toBeInTheDocument();
      expect(screen.getByText("Agents")).toBeInTheDocument();
      expect(screen.getByText("Activity")).toBeInTheDocument();
    });

    it("renders 5 number cells", () => {
      const { container } = render(<ConsoleView data={consoleFixture} />);
      expect(container.querySelectorAll(".num-cell")).toHaveLength(5);
    });

    it("renders a placeholder cell when data.numbers has placeholder=true", () => {
      const data = {
        ...consoleFixture,
        numbers: {
          cells: [
            ...consoleFixture.numbers.cells.slice(0, 4),
            { label: "Reply time", value: "—", delta: ["pending"], placeholder: true },
          ],
        },
      };
      const { container } = render(<ConsoleView data={data} />);
      const placeholder = container.querySelector(".num-cell.placeholder");
      expect(placeholder).not.toBeNull();
      expect(placeholder?.textContent).toContain("—");
    });
  });
  ```

- [ ] **Step 2:** Run the test.

  ```bash
  pnpm --filter @switchboard/dashboard test src/components/console/__tests__/console-view.test.tsx
  ```

  Expected: PASS (3 tests).

- [ ] **Step 3:** Commit.

  ```bash
  git add apps/dashboard/src/components/console/__tests__/console-view.test.tsx
  git commit -m "test(dashboard): ConsoleView renders four zones, 5 cells, and respects placeholder flag"
  ```

---

## Task 15: Manual verification + final sweep

**Files:** none modified.

- [ ] **Step 1:** Start the dashboard dev server.

  ```bash
  cd /Users/jasonli/switchboard
  pnpm --filter @switchboard/dashboard dev
  ```

- [ ] **Step 2:** Visit `http://localhost:3002/console` in a browser. Verify:
  - Org name reads from your seeded `useOrgConfig` (not literal "Aurora Dental").
  - Numbers strip: Leads + Appointments cells show real data; Revenue / Spend / Reply time render `—` in muted style with italic "pending option C" delta.
  - Queue: any seeded escalations render as escalation cards; any creative-risk approvals render as approval-gate cards. If your seed has neither, the queue shows "0 pending" and is empty.
  - Agents: 3 cells, with one marked active (Nova if its module is enabled).
  - Activity: real audit rows with HH:MM time + synthesized agent prefix.

- [ ] **Step 3:** Run the full dashboard test suite.

  ```bash
  pnpm --filter @switchboard/dashboard test
  ```

  Expected: PASS (295+ existing tests + new mapper + view tests).

- [ ] **Step 4:** Run typecheck.

  ```bash
  pnpm --filter @switchboard/dashboard typecheck
  ```

  Expected: PASS.

- [ ] **Step 5:** Stop the dev server. Push the branch.

  ```bash
  git push -u origin feat/console-preview
  ```

- [ ] **Step 6:** Open a PR to `main` (separate from the spec PR #323).

  ```bash
  gh pr create --base main --title "feat(dashboard): /console wired to backend hooks (option B)" --body "$(cat <<'EOF'
  ```

## Summary

Wires `/console` to existing dashboard hooks per [option B](../docs/superpowers/specs/2026-04-30-console-as-home-dashboard-design.md#option-b--wire-what-backend-exposes-today). Numbers-strip cells the backend can't yet serve render as muted `—` placeholders. Recommendation cards and per-agent today-stats wait for option C schema extensions.

## Test plan

- [ ] `pnpm --filter @switchboard/dashboard typecheck` passes
- [ ] `pnpm --filter @switchboard/dashboard test` passes (mappers, view, hook composition)
- [ ] `/console` renders org name, real escalations, real approval-gate cards, real activity rows; placeholder cells show `—`
- [ ] Loading state renders the fixture; error banner appears when any underlying hook fails
      EOF
      )"

  ```

  Expected: PR URL printed.
  ```

---

## Self-review checklist

(Done by the plan author, 2026-04-30.)

- **Spec coverage:** Each option-B bullet from the spec maps to a task. opStrip → Task 4. numbers strip → Task 5. queue (escalations + creative approvals) → Tasks 6-7. agents → Task 8. activity → Task 9. Top-level composer → Task 10. Hook wiring → Task 11. Loading/error UX → Tasks 12-13. Tests → 14. Manual verify → 15.
- **Placeholder scan:** No "TBD" / "TODO" / "implement later" in tasks. The Nova panel intentionally stays as fixture per the spec; option C task list (separate plan) addresses it.
- **Type consistency:** `EscalationApiRow`, `ApprovalApiRow`, `AuditEntry`, `ModuleEnablementMap`, `MapConsoleInput`, `NumbersInput` are all defined in `console-mappers.ts` (Task 3) and consumed unchanged in Tasks 4-11. `AgentKey` extension (Task 2) is referenced in `mapActivity` (Task 9) and `console-view.tsx` (Task 13 via `capitalize`) — verify the existing `capitalize` call handles `"system"` → `"System"`. The current `capitalize(s)` works generically; no change needed.
- **Risk:** the exact shape of `useAudit().entries` and `useModuleStatus().data` may not match what's described above. Task 11 Step 2 calls this out — the engineer adapts the destructure on a typecheck failure.
