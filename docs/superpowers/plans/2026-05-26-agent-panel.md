# Agent Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the read-only agent-panel sheet (Alex/Riley/Mira) that answers "is my employee doing its job, and does it need anything?" — opened from Team Pulse (and later Inbox/Results), riding the shared Radix `Sheet`, mutating nothing.

**Architecture:** Trust-critical derivation lives in **pure functions** (`selectKeyResult`, `composeStatusLine`, `composeActivityVoice`, `labelForHeroKind`, `formatCents`, `coreSetupIncomplete`) unit-tested without rendering (PR 1). Thin slot components consume them and wire the existing hooks (PR 2). Entry points are isolated (PR 3). Visual styling is ported from `prototype-ref/agent-panel/panel/panel.css` mapping prototype tokens → the real `--agent-*`/`--action`/`--ink`/`--canvas`/`--font-home-*` tokens.

**Tech Stack:** Next 14 (App Router), React 18, TanStack Query, Radix `Sheet`, vitest + @testing-library/react, CSS Modules. ESM, `@/` import alias, no `.js` on imports.

**Authoritative inputs:** spec `docs/superpowers/specs/2026-05-26-agent-panel-design.md` (esp. the **Codebase reconciliation**, **state matrix**, **copy contract**, **must-test**). Visual ref: `prototype-ref/agent-panel/` (read-only; do not commit; its `window.SBP` shapes are fabricated — use the real types below).

**Real shapes (verified):** `GreetingViewModel.segments: ProseSegment[]` (`{kind:"text"|"accent";text}`), `signal.oldestOpenItemAgeHours: number|null`; `HeroMetric = {kind:"tours-booked"|"ad-leads"|"creatives-shipped"|"revenue-attributed"; value; comparator}` (no `unit`); `MetricsViewModelWire.{spendCents:number|null, targets:{avgValueCents,targetCpbCents}}`; `Decision.{humanSummary, meta.contactName, sourceRef, kind}`; `DecisionFeedResponse.counts.total`; `ActivityRow.{time,kind,head,who?,...}` (18-kind enum); `AgentStateEntry.{activityStatus:string, lastActionAt:string|null}`; `MissionSetupRow.{key,done,primary?}`; `useHalt(): {halted:boolean,...}` (global only). Per-agent `busyAgeHoursThreshold`: Alex 24, Riley 12.

---

## File structure

```
apps/dashboard/src/components/agent-panel/
  agent-panel.tsx              — orchestrator; takes agentKey; renders Mira-vs-setup-agent
  agent-panel.module.css       — ported styles (token-mapped)
  identity-status.tsx          — slot ①
  key-result.tsx               — slot ② (proof/activation/zero/error/paused)
  open-decisions.tsx           — slot ③
  work-log.tsx                 — slot ④
  mira-panel.tsx               — honest "Not set up" body
  lib/
    agent-display.ts           — name/role label map + labelForHeroKind
    format.ts                  — formatCents + relativeTime
    status-line.ts             — composeStatusLine (health + presence)
    key-result-state.ts        — selectKeyResult + coreSetupIncomplete (the state machine)
    activity-voice.ts          — composeActivityVoice
  __tests__/                   — co-located tests for each of the above
apps/dashboard/src/hooks/use-agent-metrics.ts   — MODIFY: accept window: "week"|"all"
apps/dashboard/src/components/home/team-pulse.tsx — MODIFY: chips → buttons that open the panel
(drawer/open-state) — per-surface LOCAL open-state preferred; do NOT extend the Inbox-local RightDrawerKind (Task 6 discovery decides)
```

Pure logic in `lib/` is framework-free and fully unit-tested; components are thin.

---

# PR 1 — shell + state contract (infrastructure)

Goal: prove the panel can't become a route/tab/control surface (sheet only), handle Mira honestly, and land the tested pure-logic contract. **PR 1 is logic + shell, not just infrastructure** — no live *hook wiring* yet, but the pure business-state derivation (incl. the mission/setup semantics in Task 4) is included and tested.

### Task 1: Agent display map + hero-kind label

**Files:**
- Create: `apps/dashboard/src/components/agent-panel/lib/agent-display.ts`
- Test: `apps/dashboard/src/components/agent-panel/lib/__tests__/agent-display.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, expect, it } from "vitest";
import { agentDisplay, labelForHeroKind } from "@/components/agent-panel/lib/agent-display";

describe("agentDisplay", () => {
  it("maps each agent to display name + role copy (not the internal slug)", () => {
    expect(agentDisplay.alex).toEqual({ name: "Alex", role: "Lead response" });
    expect(agentDisplay.riley).toEqual({ name: "Riley", role: "Ad optimizer" });
    expect(agentDisplay.mira).toEqual({ name: "Mira", role: "Creative" });
  });
});

describe("labelForHeroKind", () => {
  it("renders medspa-correct labels from kind (never 'tours')", () => {
    expect(labelForHeroKind("tours-booked")).toBe("consults booked");
    expect(labelForHeroKind("ad-leads")).toBe("leads");
    expect(labelForHeroKind("creatives-shipped")).toBe("creatives shipped");
    expect(labelForHeroKind("revenue-attributed")).toBe("attributed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm --filter @switchboard/dashboard test agent-display` → FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**
```ts
import type { HeroMetric } from "@/lib/cockpit/metrics-types";

export type PanelAgentKey = "alex" | "riley" | "mira";

export const agentDisplay: Record<PanelAgentKey, { name: string; role: string }> = {
  alex: { name: "Alex", role: "Lead response" },
  riley: { name: "Riley", role: "Ad optimizer" },
  mira: { name: "Mira", role: "Creative" },
};

export function labelForHeroKind(kind: HeroMetric["kind"]): string {
  switch (kind) {
    case "tours-booked":
      return "consults booked";
    case "ad-leads":
      return "leads";
    case "creatives-shipped":
      return "creatives shipped";
    case "revenue-attributed":
      return "attributed";
  }
}
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm --filter @switchboard/dashboard test agent-display` → PASS.

- [ ] **Step 5: Commit** — `git add apps/dashboard/src/components/agent-panel/lib/agent-display.ts apps/dashboard/src/components/agent-panel/lib/__tests__/agent-display.test.ts && git commit -m "feat(agent-panel): agent display map + hero-kind labels"`

### Task 2: Money + relative-time formatters

**Files:**
- Create: `apps/dashboard/src/components/agent-panel/lib/format.ts`
- Test: `apps/dashboard/src/components/agent-panel/lib/__tests__/format.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, expect, it } from "vitest";
import { formatCents, relativeTime } from "@/components/agent-panel/lib/format";

describe("formatCents", () => {
  it("divides by 100 and never renders raw cents", () => {
    expect(formatCents(142000)).toBe("$1,420");
    expect(formatCents(3500)).toBe("$35");
    expect(formatCents(4438)).toBe("$44.38");
  });
  it("returns null for null (never coerces to $0)", () => {
    expect(formatCents(null)).toBeNull();
  });
  it("renders a true zero as $0", () => {
    expect(formatCents(0)).toBe("$0");
  });
});

describe("relativeTime", () => {
  it("formats minutes/hours ago from a fixed now", () => {
    const now = new Date("2026-05-25T15:42:00Z").getTime();
    expect(relativeTime("2026-05-25T15:30:00Z", now)).toBe("12m ago");
    expect(relativeTime("2026-05-25T13:42:00Z", now)).toBe("2h ago");
  });
  it("returns null for null", () => {
    expect(relativeTime(null, Date.now())).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm --filter @switchboard/dashboard test agent-panel/lib/__tests__/format` → FAIL.

- [ ] **Step 3: Write minimal implementation**
```ts
export function formatCents(cents: number | null): string | null {
  if (cents == null) return null;
  const dollars = cents / 100;
  const whole = dollars % 1 === 0;
  return `$${dollars.toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function relativeTime(iso: string | null, nowMs: number): string | null {
  if (!iso) return null;
  const diffMin = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 60_000));
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const h = Math.round(diffMin / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
```

- [ ] **Step 4: Run test** → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(agent-panel): cents + relative-time formatters"`

### Task 3: composeStatusLine (forward health + backward presence)

**Files:**
- Create: `apps/dashboard/src/components/agent-panel/lib/status-line.ts`
- Test: `apps/dashboard/src/components/agent-panel/lib/__tests__/status-line.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, expect, it } from "vitest";
import { composeStatusLine } from "@/components/agent-panel/lib/status-line";

const NOW = new Date("2026-05-25T15:42:00Z").getTime();
const state = (over: Partial<{ activityStatus: string; lastActionAt: string | null }> = {}) => ({
  activityStatus: "working",
  lastActionAt: "2026-05-25T15:30:00Z",
  ...over,
});

describe("composeStatusLine", () => {
  it("fresh oldest item → 'Nothing old is waiting' + presence secondary", () => {
    const r = composeStatusLine({ oldestOpenItemAgeHours: 2, fallingBehindHours: 12, state: state(), nowMs: NOW });
    expect(r.health).toBe("Nothing old is waiting");
    expect(r.presence).toBe("Last action 12m ago");
  });
  it("aging past threshold → 'Oldest lead has waited Nh'", () => {
    const r = composeStatusLine({ oldestOpenItemAgeHours: 14, fallingBehindHours: 12, state: state(), nowMs: NOW });
    expect(r.health).toBe("Oldest lead has waited 14h");
  });
  it("null signal → presence only, never a fabricated health read", () => {
    const r = composeStatusLine({ oldestOpenItemAgeHours: null, fallingBehindHours: 12, state: state(), nowMs: NOW });
    expect(r.health).toBeNull();
    expect(r.presence).toBe("Last action 12m ago");
  });
  it("no recorded action → stale presence copy", () => {
    const r = composeStatusLine({ oldestOpenItemAgeHours: null, fallingBehindHours: 12, state: state({ lastActionAt: null }), nowMs: NOW });
    expect(r.presence).toBe("No recorded action in 24h");
  });
});
```

- [ ] **Step 2: Run test** → FAIL.

- [ ] **Step 3: Write minimal implementation**
```ts
export interface StatusLineInput {
  oldestOpenItemAgeHours: number | null;
  fallingBehindHours: number;
  state: { lastActionAt: string | null } | null;
  nowMs: number;
}
export interface StatusLine {
  health: string | null;
  presence: string | null;
}

export function composeStatusLine(input: StatusLineInput): StatusLine {
  const { oldestOpenItemAgeHours: age, fallingBehindHours, state, nowMs } = input;

  let health: string | null = null;
  if (age != null) {
    health = age >= fallingBehindHours ? `Oldest lead has waited ${Math.round(age)}h` : "Nothing old is waiting";
  }

  let presence: string | null = null;
  const last = state?.lastActionAt ?? null;
  if (last) {
    const diffMin = Math.max(0, Math.round((nowMs - new Date(last).getTime()) / 60_000));
    presence = diffMin < 60 ? `Last action ${Math.max(1, diffMin)}m ago` : `Last action ${Math.round(diffMin / 60)}h ago`;
  } else {
    presence = "No recorded action in 24h";
  }
  return { health, presence };
}
```

- [ ] **Step 4: Run test** → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(agent-panel): status-line health+presence composer"`

### Task 4: selectKeyResult — the slot-② state machine (highest-value)

**Files:**
- Create: `apps/dashboard/src/components/agent-panel/lib/key-result-state.ts`
- Test: `apps/dashboard/src/components/agent-panel/lib/__tests__/key-result-state.test.ts`

Encodes the spec precedence: **paused → core-setup-incomplete → (window=all then week) → error**, with the label bound to the window that returned.

- [ ] **Step 1: Write the failing test**
```ts
import { describe, expect, it } from "vitest";
import { selectKeyResult, coreSetupIncomplete } from "@/components/agent-panel/lib/key-result-state";
import type { MissionAggregatorResponse } from "@/lib/cockpit/mission-types";

const vm = (over = {}) => ({ hero: { kind: "ad-leads", value: 32, comparator: {} }, spendCents: 142000, targets: { targetCpbCents: 3500, avgValueCents: 38000 }, ...over } as any);
const slot = (data: any, isError = false) => ({ data, isError });

describe("coreSetupIncomplete", () => {
  it("true when the primary setup row is not done", () => {
    const m = { setup: [{ key: "meta", done: false, primary: true }, { key: "rules", done: true }] } as unknown as MissionAggregatorResponse;
    expect(coreSetupIncomplete(m, "riley")).toBe(true);
  });
  it("false when primary is done even if a non-core row is incomplete", () => {
    const m = { setup: [{ key: "meta", done: true, primary: true }, { key: "rules", done: false }] } as unknown as MissionAggregatorResponse;
    expect(coreSetupIncomplete(m, "riley")).toBe(false);
  });
  it("falls back to the agent's core key when no row is flagged primary", () => {
    const m = { setup: [{ key: "meta", done: false }, { key: "rules", done: true }] } as unknown as MissionAggregatorResponse;
    expect(coreSetupIncomplete(m, "riley")).toBe(true); // riley core = meta
  });
});

describe("selectKeyResult", () => {
  it("paused wins — returns paused with whatever real figure is available (never fabricated 0)", () => {
    const r = selectKeyResult({ agentKey: "alex", halted: true, mission: undefined, all: slot(vm()), week: slot(vm()) });
    expect(r.kind).toBe("paused");
    if (r.kind === "paused") expect(r.hero?.value).toBe(32);
  });
  it("core setup incomplete (not paused) → activation", () => {
    const m = { setup: [{ key: "meta", done: false, primary: true }] } as any;
    const r = selectKeyResult({ agentKey: "riley", halted: false, mission: m, all: slot(undefined), week: slot(undefined) });
    expect(r.kind).toBe("activation");
  });
  it("window=all present → lifetime scope", () => {
    const r = selectKeyResult({ agentKey: "riley", halted: false, mission: undefined, all: slot(vm({ hero: { kind: "ad-leads", value: 214, comparator: {} } })), week: slot(vm()) });
    expect(r.kind === "proof" && r.scope).toBe("lifetime");
    if (r.kind === "proof") expect(r.hero.value).toBe(214);
  });
  it("window=all 400/absent → week scope (week label), NOT error", () => {
    const r = selectKeyResult({ agentKey: "riley", halted: false, mission: undefined, all: slot(undefined, true), week: slot(vm()) });
    expect(r.kind === "proof" && r.scope).toBe("week");
  });
  it("week ALSO fails → error (week failure is the hero error)", () => {
    const r = selectKeyResult({ agentKey: "riley", halted: false, mission: undefined, all: slot(undefined, true), week: slot(undefined, true) });
    expect(r.kind).toBe("error");
  });
  it("true zero is preserved as proof, not error", () => {
    const r = selectKeyResult({ agentKey: "alex", halted: false, mission: undefined, all: slot(undefined), week: slot(vm({ hero: { kind: "tours-booked", value: 0, comparator: {} } })) });
    expect(r.kind === "proof" && r.hero.value).toBe(0);
  });
});
```

- [ ] **Step 2: Run test** → FAIL.

- [ ] **Step 3: Write minimal implementation**
```ts
import type { MissionAggregatorResponse } from "@/lib/cockpit/mission-types";
import type { MetricsViewModelWire } from "@/lib/cockpit/metrics-types";

const CORE_KEY: Record<"alex" | "riley", string> = { alex: "inbox", riley: "meta" };

export function coreSetupIncomplete(
  mission: MissionAggregatorResponse | undefined,
  agentKey: "alex" | "riley",
): boolean {
  if (!mission) return false; // unknown setup ≠ blocked; metrics/zero rules handle it
  const primary = mission.setup.find((s) => s.primary);
  if (primary) return !primary.done;
  const core = mission.setup.find((s) => s.key === CORE_KEY[agentKey]);
  return core ? !core.done : false;
}

type Slot = { data?: MetricsViewModelWire; isError: boolean };
export type KeyResultState =
  | { kind: "paused"; hero: MetricsViewModelWire["hero"] | null; spendCents: number | null; targets: MetricsViewModelWire["targets"] | null; scope: "lifetime" | "week" | null }
  | { kind: "activation" }
  | { kind: "error" }
  | { kind: "proof"; scope: "lifetime" | "week"; hero: MetricsViewModelWire["hero"]; spendCents: number | null; targets: MetricsViewModelWire["targets"] };

export function selectKeyResult(input: {
  agentKey: "alex" | "riley";
  halted: boolean;
  mission: MissionAggregatorResponse | undefined;
  all: Slot;
  week: Slot;
}): KeyResultState {
  const { agentKey, halted, mission, all, week } = input;
  const pick = all.data ?? week.data ?? null;
  if (halted) {
    return {
      kind: "paused",
      hero: pick?.hero ?? null,
      spendCents: pick?.spendCents ?? null,
      targets: pick?.targets ?? null,
      scope: all.data ? "lifetime" : week.data ? "week" : null,
    };
  }
  if (coreSetupIncomplete(mission, agentKey)) return { kind: "activation" };
  if (all.data) return { kind: "proof", scope: "lifetime", hero: all.data.hero, spendCents: all.data.spendCents, targets: all.data.targets };
  if (week.data) return { kind: "proof", scope: "week", hero: week.data.hero, spendCents: week.data.spendCents, targets: week.data.targets };
  return { kind: "error" };
}
```

- [ ] **Step 4: Run test** → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(agent-panel): selectKeyResult state machine + coreSetupIncomplete"`

### Task 5: composeActivityVoice (first-person work-log)

**Files:**
- Create: `apps/dashboard/src/components/agent-panel/lib/activity-voice.ts`
- Test: `apps/dashboard/src/components/agent-panel/lib/__tests__/activity-voice.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, expect, it } from "vitest";
import { composeActivityVoice, KNOWN_ACTIVITY_KINDS } from "@/components/agent-panel/lib/activity-voice";

describe("composeActivityVoice", () => {
  it("replied with who", () => {
    expect(composeActivityVoice({ time: "", kind: "replied", head: "about Botox pricing", who: "Maya R." }))
      .toBe("I replied to Maya R. about Botox pricing");
  });
  it("booked with who", () => {
    expect(composeActivityVoice({ time: "", kind: "booked", head: "for Thu 2pm", who: "Jen T." }))
      .toBe("I booked Jen T.'s consult for Thu 2pm");
  });
  it("unknown kind falls back to the head verbatim (no crash)", () => {
    expect(composeActivityVoice({ time: "", kind: "observed", head: "a spend anomaly" } as any))
      .toBe("I noted a spend anomaly");
  });
  it("every known ActivityKind returns a non-empty sentence (no silent gaps)", () => {
    for (const kind of KNOWN_ACTIVITY_KINDS) {
      expect(composeActivityVoice({ time: "", kind, head: "the thing", who: "X" }).length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test** → FAIL.

- [ ] **Step 3: Write minimal implementation** (cover the common kinds; safe default for the rest of the 18-kind enum)
```ts
import type { ActivityRow } from "@switchboard/schemas/cockpit-activity";

export function composeActivityVoice(row: ActivityRow): string {
  const who = row.who;
  switch (row.kind) {
    case "replied": return who ? `I replied to ${who} ${row.head}` : `I replied to a lead ${row.head}`;
    case "booked": return who ? `I booked ${who}'s consult ${row.head}` : `I booked a consult ${row.head}`;
    case "qualified": return `I qualified ${row.head}`;
    case "sent": return `I sent ${row.head}`;
    case "escalated": return who ? `I escalated ${who} to you — ${row.head}` : `I escalated to you — ${row.head}`;
    case "paused": return `I paused ${row.head}`;
    case "scaled": return `I scaled ${row.head}`;
    case "shifted":
    case "rotated":
    case "restructured": return `I adjusted ${row.head}`;
    default: return `I noted ${row.head}`;
  }
}
```
(Confirm the `@switchboard/schemas/cockpit-activity` import path matches the package's exports map; if not, import `ActivityRow`/`ActivityKind` from where `use-agent-activity-cockpit.ts` imports them.)

Also export a completeness-guarded kind list so the exhaustiveness test can't silently miss one:
```ts
const ACTIVITY_KINDS = {
  booked: 1, qualified: 1, replied: 1, sent: 1, started: 1, connected: 1, waiting: 1, escalated: 1,
  passed: 1, watching: 1, reviewing: 1, paused: 1, scaled: 1, rotated: 1, shifted: 1, restructured: 1,
  alert: 1, observed: 1,
} satisfies Record<ActivityKind, 1>; // TS errors here if a kind is missing — keeps the list synced to the enum
export const KNOWN_ACTIVITY_KINDS = Object.keys(ACTIVITY_KINDS) as ActivityKind[];
```

- [ ] **Step 4: Run test** → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(agent-panel): first-person activity voice composer"`

### Task 6: Sheet shell + drawer-kind + AgentPanel skeleton

**Files:**
- Create: `apps/dashboard/src/components/agent-panel/agent-panel.tsx`, `agent-panel.module.css`
- Test: `apps/dashboard/src/components/agent-panel/__tests__/agent-panel.test.tsx`
- (Possibly Modify a shared drawer-state module — ONLY per the Step 1 discovery.)

- [ ] **Step 1: Discovery — drawer/open-state ownership (do NOT couple to Inbox).** The panel opens from Home, Inbox, AND Results, so it must not depend on Inbox internals. Inspect `components/inbox/inbox-drawer.tsx` + its `RightDrawerKind`. If that state is **Inbox-local**, do NOT extend it — `AgentPanel` is a self-contained `Sheet` taking `agentKey/open/onOpenChange`, and each host surface owns its own local open-state (default; most decoupled). Reuse a shared model ONLY if a genuinely dashboard-level one already exists. Record the decision in the PR description.

- [ ] **Step 2: Write the failing test** (skeleton render gated on `open`, + the sheet a11y contract)
```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentPanel } from "@/components/agent-panel/agent-panel";

describe("AgentPanel shell", () => {
  it("renders the dialog with the agent name when open", () => {
    render(<AgentPanel agentKey="alex" open onOpenChange={() => {}} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Alex")).toBeInTheDocument();
  });
  it("exposes a reachable close control (Radix Sheet a11y contract)", () => {
    render(<AgentPanel agentKey="alex" open onOpenChange={() => {}} />);
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
  });
});
```
(Esc-to-close + focus-trap are delegated to the Radix `Sheet` — assert `role="dialog"` + the close control here; don't re-test Radix internals.)

- [ ] **Step 3: Implement** the self-contained `AgentPanel` (props-driven `open`/`onOpenChange`; **no Inbox / drawer-kind coupling**) using the shared `Sheet` with `side="bottom"`:
```tsx
"use client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { InboxAgentAvatar } from "@/components/inbox/inbox-agent-avatar";
import { agentDisplay, type PanelAgentKey } from "./lib/agent-display";
import { MiraPanel } from "./mira-panel";
import styles from "./agent-panel.module.css";

export function AgentPanel({ agentKey, open, onOpenChange }: {
  agentKey: PanelAgentKey; open: boolean; onOpenChange: (next: boolean) => void;
}) {
  const display = agentDisplay[agentKey];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className={styles.panel}>
        <SheetHeader>
          <SheetTitle className={styles.idRow}>
            <InboxAgentAvatar agentKey={agentKey} size={44} />
            <span>{display.name}</span>
            <span className={styles.role}>{display.role}</span>
          </SheetTitle>
        </SheetHeader>
        {agentKey === "mira" ? <MiraPanel /> : <div data-testid="agent-panel-body" />}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: Port CSS** into `agent-panel.module.css` from `prototype-ref/agent-panel/panel/panel.css` (the `.ap*` rules), mapping prototype tokens → real tokens: `--coral/--teal/--violet`→`hsl(var(--agent-{key}))`, `--serif`→`var(--font-home-serif)`, `--sans`→`var(--font-home-sans)`, `--ink-1..4`→`hsl(var(--ink))` ramp, `--good`→`hsl(var(--agent-active))`, drop `--critical` (no red), `--amber`(status)→`hsl(var(--agent-attention))`, action→`hsl(var(--action))`. Phone-first bottom sheet.

- [ ] **Step 5: Run test** — `pnpm --filter @switchboard/dashboard test agent-panel.test` → PASS.

- [ ] **Step 6: Commit** — `git commit -m "feat(agent-panel): sheet shell + agent-panel drawer kind"`

### Task 7: Mira honest "Not set up" panel

**Files:** Create `apps/dashboard/src/components/agent-panel/mira-panel.tsx`; Test `__tests__/mira-panel.test.tsx`

- [ ] **Step 1: Write the failing test**
```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MiraPanel } from "@/components/agent-panel/mira-panel";

describe("MiraPanel", () => {
  it("states the truth and offers no 'Set up' / dead-link CTA", () => {
    const { container } = render(<MiraPanel />);
    expect(screen.getByText("Mira isn't set up yet")).toBeInTheDocument();
    expect(screen.queryByText(/set up mira/i)).not.toBeInTheDocument();
    expect(container.querySelector('a[href^="#"]')).toBeNull(); // no dead anchors
  });
});
```

- [ ] **Step 2: Run test** → FAIL.

- [ ] **Step 3: Implement** (no data hooks — Mira's body is static truth)
```tsx
export function MiraPanel() {
  return (
    <div className="mira-body">
      <h3><em>Mira isn't set up yet</em></h3>
      <p>Mira handles creative and content. She becomes available as your workspace grows.</p>
      {/* Forward action: link to a REAL informational destination if one exists; otherwise
          informational text only. Never a dead "#" link, never a "Set up Mira" CTA. */}
    </div>
  );
}
```
Discovery: check for a real "what Mira does" help/marketing destination. If it exists, add `Learn what Mira does` as a link to it; if not, leave the informational copy above (no dead link).

- [ ] **Step 4: Run test** → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(agent-panel): honest Mira not-set-up panel"`

### Task 8: Team Pulse entry point

**Files:** Modify `apps/dashboard/src/components/home/team-pulse.tsx`; Test its `__tests__`.

- [ ] **Step 1: Write the failing test** — clicking a chip opens the panel for that agent.
```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TeamPulse } from "@/components/home/team-pulse";

it("a chip is a button that opens the agent panel", () => {
  const onOpen = vi.fn();
  render(<TeamPulse /* existing props */ onOpenAgent={onOpen} />);
  fireEvent.click(screen.getByTestId("agent-chip-alex"));
  expect(onOpen).toHaveBeenCalledWith("alex");
});
```

- [ ] **Step 2: Run test** → FAIL.

- [ ] **Step 3: Implement** — convert each chip `div` to a `<button type="button">` with `onClick={() => onOpenAgent(key)}`. Thread `onOpenAgent` from the Home page, which **owns the `AgentPanel` open-state locally** (Task 6's decoupled model) and renders `<AgentPanel>`. If `TeamPulse` is server-rendered or far from Home's client state, add a tiny client wrapper that owns/receives the handler rather than prop-drilling. Keep `data-testid`/`data-agent`. No routing, no Inbox-drawer coupling — sheet only.

- [ ] **Step 4: Run test** → PASS. Then `pnpm --filter @switchboard/dashboard test team-pulse` (existing tests still green).

- [ ] **Step 5: Commit** — `git commit -m "feat(home): Team Pulse chips open the agent panel"`

- [ ] **PR 1 gate:** `pnpm --filter @switchboard/dashboard test`, `pnpm typecheck`, `pnpm --filter @switchboard/dashboard build`, `pnpm format:check` → all green. Open PR off `main`.

---

# PR 2 — Alex/Riley data slots (the trust PR)

All launch-blocking tests live here. Each slot wires a real hook and consumes the PR 1 utilities.

### Task 9: Extend useAgentMetrics to accept `window`

**Files:** Modify `apps/dashboard/src/hooks/use-agent-metrics.ts`; Test `hooks/__tests__/use-agent-metrics.test.tsx`.

- [ ] **Step 1: Write the failing test** — passing `"all"` requests `?window=all` and surfaces a 400 as `isError` (so the caller can fall back).
```tsx
// mock fetch; assert the URL includes window=all, and that a 400 → isError true, data undefined.
```
(Mirror the `use-agent-greeting.test.tsx` mock-fetch + QueryClient wrapper pattern.)

- [ ] **Step 2: Run test** → FAIL.

- [ ] **Step 3: Implement** — change the hook signature to `useAgentMetrics(agentKey, window: "week" | "all" = "week")`, put `window` in the query key + the request URL. Do NOT change existing call sites' behavior (default stays `"week"`).

- [ ] **Step 4: Run test** → PASS (+ existing metrics tests green).

- [ ] **Step 5: Commit** — `git commit -m "feat(hooks): useAgentMetrics accepts window=week|all"`

### Task 10: Identity + status slot (must-test: greeting segments, paused)

**Files:** Create `identity-status.tsx`; Test `__tests__/identity-status.test.tsx`.

- [ ] **Step 1: Write failing tests** — (a) renders all `text`+`accent` segments joined (not just the first); (b) health primary + presence secondary from `composeStatusLine`; (c) when `halted`, shows "Paused" badge + "Paused from your workspace controls" and NO health read.
```tsx
// mock useAgentGreeting → segments:[{kind:"text",text:"Steady morning — "},{kind:"accent",text:"answered every lead"}]
// assert full sentence present; mock useHalt → {halted:true} asserts badge + status copy, no "Nothing old is waiting".
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — consume `useAgentGreeting`, `useAgentState` (select the agent's entry), `useHalt`; join `segments.map(s=>s.text)`; call `composeStatusLine` with `fallingBehindHours` = {alex:24, riley:12}; render paused branch when `halted`. Verdict fallback "No update yet".

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(agent-panel): identity + health/presence status slot"`

### Task 11: Key-result slot (must-tests: window fallback+label, zero/error/null, paused non-zero, cents)

**Files:** Create `key-result.tsx`; Test `__tests__/key-result.test.tsx`.

- [ ] **Step 1: Write failing tests** (the launch-blockers) — drive `selectKeyResult` via mocked `useAgentMetrics("all")` / `useAgentMetrics("week")` / `useAgentMission` / `useHalt`:
```tsx
// 1. all 400 + week ok → renders week value under "this week" label, NOT "since you hired".
// 2. all ok → renders lifetime value under "since you hired Alex".
// 3. all 400 + week 503 → "Couldn't load this week's number".
// 4. week value 0 → "0 booked this week" (true zero shows; not error, not null).
// 5. halted + week value 12 → shows 12 + "No new actions are going out while paused", muted; no glow.
// 6. Riley CPL beat: spendCents 142000 / 32 leads + targetCpbCents 3500 → "$44.38 per lead · $9.38 over your $35 target" (neutral, never green).
// 7. halted + core setup incomplete + week value 12 → paused composition WINS (shows 12 + "No new actions… while paused" + a small setup note), NOT the activation block.
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `key-result.tsx` — call both `useAgentMetrics(agentKey, "all")` and `useAgentMetrics(agentKey, "week")`, `useAgentMission`, `useHalt`; pass to `selectKeyResult`; render per `kind`:
  - `proof` → `value` + `labelForHeroKind(hero.kind)`; eyebrow "since you hired {name}" (lifetime) / "this week" (week); Riley CPL beat composed via `formatCents` (over/under in words).
  - `activation` → tinted CTA from mission.
  - `paused` → real figure (muted) + "No new actions are going out while paused"; if also core-incomplete, a small setup note beneath.
  - `error` → "Couldn't load this week's number".
  - non-core gap (set up, proof, a non-primary setup/channel incomplete) → proof + inline nudge.

- [ ] **Step 4: Run** → PASS (all 6 launch-blockers green).

- [ ] **Step 5: Commit** — `git commit -m "feat(agent-panel): key-result slot (cumulative/week/activation/paused, honest fallbacks)"`

### Task 12: Open-decisions slot (must-test: count equivalence)

**Files:** Create `open-decisions.tsx`; Test `__tests__/open-decisions.test.tsx`.

- [ ] **Step 1: Write failing tests** — (a) count from `useDecisionFeed(agentKey).counts.total`; (b) gist composed from `humanSummary`/`meta.contactName`; (c) row click calls the open-decision-detail handler with `sourceRef`; (d) fetch error → "Couldn't load decisions" (never "0/nothing"); (e) equivalence: same fixture, panel's `counts.total` for alex equals the agent-scoped feed.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — `useDecisionFeed(agentKey)`; render `counts.total` + a row per decision (gist from `humanSummary`), each a button → opens the existing decision-detail sheet via `sourceRef`. Error/empty per copy contract. No approve/reject controls.

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(agent-panel): open-decisions slot routing to decision-detail"`

### Task 13: Work-log slot (cents-in-head + cap + voice)

**Files:** Create `work-log.tsx`; Test `__tests__/work-log.test.tsx`.

- [ ] **Step 1: Write failing tests** — (a) renders ≤5 rows via `composeActivityVoice`; (b) "See all in Results →" footer present; (c) error → "Couldn't load recent work", empty → "No actions in the last 24 hours"; (d) any cents-bearing figure in `head`/`body` is formatted via `formatCents` (verify whether the wire sends cents here — if `head` is pre-formatted text, assert it renders verbatim; if numeric cents, assert ÷100).

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — `useAgentActivityCockpit(agentKey)`; `rows.slice(0,5).map(composeActivityVoice)`; "since you last looked" header; footer link to Results.

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(agent-panel): recent work-log slot"`

### Task 14: Assemble panel body + freshness foot + state-matrix integration test

**Files:** Modify `agent-panel.tsx` (replace the `data-testid="agent-panel-body"` placeholder with the 4 slots + freshness foot); Test `__tests__/agent-panel.matrix.test.tsx`.

- [ ] **Step 1: Write failing test** — one integration test per state-matrix row (loading / normal-active / metrics-400 / fetch-error / true-zero / paused / setup-blocked / mira), asserting the canonical strings from the copy contract appear and the forbidden ones don't (e.g., paused row asserts no "Nothing old is waiting"; metrics-400 asserts "this week" not "since you hired").

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — compose `<IdentityStatus/> <KeyResult/> <OpenDecisions/> <WorkLog/>` + freshness foot (`as of {clock}`); ensure one slot's error never blanks the others.

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(agent-panel): assemble slots + freshness + state-matrix coverage"`

- [ ] **PR 2 gate:** full dashboard test + typecheck + build + format:check green. Open PR off `main`.

---

# PR 3 — cross-surface entry points (surface wiring only)

### Task 15: Inbox agent-avatar entry

**Files:** Modify the Inbox surface where agent avatars/chips render; Test the entry.

- [ ] **Step 1:** Write failing test — clicking an agent avatar in the Inbox opens the agent panel for that agent (drawer state `{kind:"agent-panel", agentKey}`).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement — attach the open-panel handler to the existing `InboxAgentAvatar`/chip; reuse the drawer state; do not alter Inbox decision logic.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit — `git commit -m "feat(inbox): agent avatar opens the agent panel"`

### Task 16: Results agent-chip entry

**Files:** Modify the Results surface where an agent chip/avatar renders; Test the entry.

- [ ] **Step 1:** Locate the agent chip/avatar in the Results components; write a failing test that clicking it opens `{ kind: "agent-panel", agentKey }` via the drawer state.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Attach the open-panel handler to the Results agent chip (reuse the PR 1 drawer state; do not alter Results data/charts).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit — `git commit -m "feat(results): agent chip opens the agent panel"`

- [ ] **PR 3 gate:** full dashboard test + typecheck + build + format:check green. Open PR off `main`.

---

## Notes for the implementer

- **Read the spec's Codebase reconciliation first** — it lists the real shapes; the prototype's `window.SBP` shapes are fabricated.
- **CSS is ported, not invented** — `prototype-ref/agent-panel/panel/panel.css` is the visual source; map tokens as in Task 6. Do not redefine `:root` tokens in `globals.css`.
- **Verify two unknowns while wiring:** (a) `MissionSetupRow.primary` semantics (is it the core/blocking step?) — `coreSetupIncomplete` already falls back to the per-agent core key if not; (b) whether `ActivityRow.head` ever carries raw cents — format if so.
- **Read-only forever:** no mutating control, no route, no tab. If a task tempts you to add one, stop.
