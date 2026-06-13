# Agent activityStatus time-decay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `deriveAgentStates` from showing a stale "Working"/"Analyzing" indicator by decaying transient statuses to "idle" once the last action is older than a fixed inactivity window.

**Architecture:** Read-time decay inside the existing pure function `deriveAgentStates`. Add an injectable `now` (default `new Date()`), a module constant `ACTIVITY_STATUS_STALE_MS`, and a finite-guarded helper `decayTransientStatus`. No schema change, no consumer change (output stays within the existing status union).

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Vitest. Package `@switchboard/db`.

---

## File Structure

- Modify: `packages/db/src/storage/agent-state-deriver.ts`: add constant + helper, thread `now`, apply decay.
- Modify: `packages/db/src/storage/__tests__/agent-state-deriver.test.ts`: add a `time-decay` describe block with a fixed injected clock.

No other files. The single caller `apps/api/src/routes/agents.ts:178` keeps calling `deriveAgentStates(entries)` (the new `now` parameter defaults). Dashboard consumers switch on the status string and are unaffected.

---

### Task 1: Read-time decay of transient agent statuses

**Files:**

- Modify: `packages/db/src/storage/agent-state-deriver.ts`
- Test: `packages/db/src/storage/__tests__/agent-state-deriver.test.ts`

- [ ] **Step 1: Write the failing tests**

Update the import at the top of `agent-state-deriver.test.ts`:

```ts
import { deriveAgentStates, ACTIVITY_STATUS_STALE_MS } from "../agent-state-deriver.js";
```

Append this describe block to `agent-state-deriver.test.ts`:

```ts
describe("activityStatus time-decay", () => {
  const NOW = new Date("2026-06-13T12:00:00.000Z");
  const ago = (ms: number) => new Date(NOW.getTime() - ms);

  it("decays a stale working status to idle past the inactivity window", () => {
    const states = deriveAgentStates(
      [
        {
          eventType: "action.proposed",
          timestamp: ago(ACTIVITY_STATUS_STALE_MS + 60_000),
          summary: "Proposed campaign budget increase",
        },
      ],
      NOW,
    );
    const strategist = states.get("strategist")!;
    expect(strategist.activityStatus).toBe("idle");
    expect(strategist.lastActionSummary).toBe("Proposed campaign budget increase");
  });

  it("keeps a recent working status active within the window", () => {
    const states = deriveAgentStates(
      [
        {
          eventType: "action.proposed",
          timestamp: ago(60_000),
          summary: "Proposed campaign budget increase",
        },
      ],
      NOW,
    );
    expect(states.get("strategist")!.activityStatus).toBe("working");
  });

  it("keeps working exactly at the threshold and decays just past it", () => {
    const atThreshold = deriveAgentStates(
      [
        {
          eventType: "action.proposed",
          timestamp: ago(ACTIVITY_STATUS_STALE_MS),
          summary: "Proposed campaign budget increase",
        },
      ],
      NOW,
    );
    expect(atThreshold.get("strategist")!.activityStatus).toBe("working");

    const pastThreshold = deriveAgentStates(
      [
        {
          eventType: "action.proposed",
          timestamp: ago(ACTIVITY_STATUS_STALE_MS + 1),
          summary: "Proposed campaign budget increase",
        },
      ],
      NOW,
    );
    expect(pastThreshold.get("strategist")!.activityStatus).toBe("idle");
  });

  it("does not decay waiting_approval even when stale", () => {
    const states = deriveAgentStates(
      [
        {
          eventType: "action.pending_approval",
          timestamp: ago(ACTIVITY_STATUS_STALE_MS * 10),
          summary: "Campaign budget increase needs approval",
        },
      ],
      NOW,
    );
    expect(states.get("strategist")!.activityStatus).toBe("waiting_approval");
  });

  it("does not decay error even when stale", () => {
    const states = deriveAgentStates(
      [
        {
          eventType: "action.error",
          timestamp: ago(ACTIVITY_STATUS_STALE_MS * 10),
          summary: "Campaign update failed",
        },
      ],
      NOW,
    );
    expect(states.get("strategist")!.activityStatus).toBe("error");
  });

  it("decays to idle when the timestamp is invalid (NaN-guarded comparison)", () => {
    const states = deriveAgentStates(
      [
        {
          eventType: "action.proposed",
          timestamp: new Date(NaN),
          summary: "Proposed campaign budget increase",
        },
      ],
      NOW,
    );
    expect(states.get("strategist")!.activityStatus).toBe("idle");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @switchboard/db exec vitest run src/storage/__tests__/agent-state-deriver.test.ts`
Expected: the import of `ACTIVITY_STATUS_STALE_MS` fails (undefined) and/or the decay cases fail because the current code never decays a stale "working" event.

- [ ] **Step 3: Implement the constant, helper, and injectable clock**

In `packages/db/src/storage/agent-state-deriver.ts`, add after `STATUS_FROM_EVENT` (around line 37):

```ts
/** Inactivity window after which a transient "in progress" status is treated as stale. */
export const ACTIVITY_STATUS_STALE_MS = 10 * 60_000; // 10 minutes

/** Statuses asserting the agent is actively doing something right now. */
const TRANSIENT_STATUSES = new Set<DerivedAgentState["activityStatus"]>(["working", "analyzing"]);

/**
 * Decays a transient "working"/"analyzing" status to "idle" once the last action is
 * older than ACTIVITY_STATUS_STALE_MS. Non-transient statuses (waiting_approval, error,
 * idle) are returned unchanged: an outstanding approval or a recorded error is a real
 * state, not a stale in-progress claim.
 *
 * The elapsed comparison is finite-guarded so a missing or invalid timestamp decays to
 * idle rather than silently reading as fresh (a raw `elapsed > stale` is false for NaN).
 */
function decayTransientStatus(
  status: DerivedAgentState["activityStatus"],
  lastActionAt: Date | null,
  now: Date,
): DerivedAgentState["activityStatus"] {
  if (!TRANSIENT_STATUSES.has(status)) return status;
  if (!lastActionAt) return "idle";
  const elapsed = now.getTime() - lastActionAt.getTime();
  if (!Number.isFinite(elapsed) || elapsed > ACTIVITY_STATUS_STALE_MS) return "idle";
  return status;
}
```

Change the signature and `todayStart` of `deriveAgentStates`:

```ts
export function deriveAgentStates(
  entries: AuditEntryRow[],
  now: Date = new Date(),
): Map<string, DerivedAgentState> {
  const states = new Map<string, DerivedAgentState>();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
```

In the entry loop, replace the status assignment line:

```ts
state.activityStatus = STATUS_FROM_EVENT[entry.eventType] ?? "idle";
```

with:

```ts
const rawStatus = STATUS_FROM_EVENT[entry.eventType] ?? "idle";
state.activityStatus = decayTransientStatus(rawStatus, state.lastActionAt, now);
```

(`state.lastActionAt` was set to `new Date(entry.timestamp)` two lines above, so the decay compares this entry's timestamp against `now`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @switchboard/db exec vitest run src/storage/__tests__/agent-state-deriver.test.ts`
Expected: PASS, all cases (original 8 plus the 6 new decay cases).

- [ ] **Step 5: Typecheck the package**

Run: `pnpm --filter @switchboard/db typecheck`
Expected: PASS. (Confirms the union typing on `TRANSIENT_STATUSES` and the new export.)

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/storage/agent-state-deriver.ts packages/db/src/storage/__tests__/agent-state-deriver.test.ts
git commit -m "fix(db): decay stale agent activityStatus to idle"
```

---

## Verification gate (after Task 1)

Run from the worktree root, all must be green (the three Postgres-only db integrity files fail locally because Postgres is down; that is the pre-existing baseline, not a regression):

- `pnpm typecheck`
- `pnpm --filter @switchboard/db test` (deriver suite green; only the known work-trace/ledger/greeting Postgres tests fail)
- `pnpm --filter @switchboard/api test` (transparent consumer; confirm no regression)
- `pnpm build`
- `pnpm lint`
- `pnpm format:check`

## Self-review notes

- **Spec coverage:** every spec decision maps to Task 1 (read-time decay, 10-min `ACTIVITY_STATUS_STALE_MS`, decay `working`/`analyzing` only, `waiting_approval`/`error` untouched, injectable `now`, finite/NaN guard, no migration, no consumer change).
- **No placeholders:** all steps contain runnable code and exact commands.
- **Type consistency:** helper name `decayTransientStatus`, constant `ACTIVITY_STATUS_STALE_MS`, and set `TRANSIENT_STATUSES` are used identically in the test import and the implementation.
