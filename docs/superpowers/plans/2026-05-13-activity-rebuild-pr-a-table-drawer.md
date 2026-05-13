# /activity rebuild — PR-A (table + drawer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the forensic table + drawer rebuild of `/activity`, with editorial header and v2 fixtures, leaving the existing filter chips and empty-state error swap in place (PR-B and PR-C respectively).

**Architecture:** Replace the existing v1 `<table>`-based row + `LabeledField` drawer with a div-grid table carrying explicit ARIA grid roles, a chevron-only-interactive row (the row body stays selectable text per H1), and a sectioned drawer that surfaces hash chain, evidence pointers, the explicit `storageRef` absence, and envelope/trace cross-links. The backend (`AuditEntryBrowseRow`, `OPERATIONAL_AUDIT_EVENT_TYPES`, `GET /api/dashboard/activity`) is frozen — no schema, route, or env-flag changes. The existing `useActivityList` hook, `filter-chips.tsx`, and `empty-state.tsx` are untouched (PR-B and PR-C land those).

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind via CSS Modules, vitest + @testing-library/react + @testing-library/user-event, `AuditEntryBrowseRow` schema from `@switchboard/schemas`.

**Spec:** `docs/superpowers/specs/2026-05-13-activity-rebuild-design.md` (PR #448 on `main`). This plan implements only the PR-A slice defined in spec §13.

**Hard invariants this PR introduces** (per spec §12): H1 (row body selectable), H2 (no `storageRef`), H3 (no snapshot values), H4 (copy buttons never throw).

---

## File structure

PR-A touches the table, drawer, header, fixtures, format helpers, CSS module, and the page entry. Each file has one clear responsibility.

**Modified files**

| Path | Responsibility |
|---|---|
| `apps/dashboard/src/app/(auth)/(mercury)/activity/components/format.ts` | Time formatters (`fmtClock`, `fmtRel`, `fmtFullISO`), event-type → band classifier (`eventBand`), copy hook (`useCopier`). Existing `formatCell` / `formatDrawer` / `truncate` / `hashPrefix` retained for the page (used by PR-A's row only where compatible). |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/components/activity-row.tsx` | Rewritten as a div-grid row with band-dot event badge, 3-letter actor glyph, entity stack, summary with `+N redacted` pill, left-edge risk hairline + right-edge amber tint, chevron-only button (H1). |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/components/activity-row-drawer.tsx` | Rewritten as a 6-section drawer: Timestamp, Visibility/classification, Snapshot keys, Evidence pointers (with explicit `storageRef` absence note), Hash chain (with `view previous ↓`), References (envelope + trace with copy + `open ↗`). |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/components/activity-table.tsx` | Rewritten as a div-grid table with explicit ARIA grid roles, a row-ref map, and a `scrollToRow(id)` function exposed to the drawer for `view previous ↓`. |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/components/header.tsx` | Rewritten as an editorial topbar + page-head with the plain `Audit log` title and a single `last ledger entry` status tile (hidden when `appliedFilters` is non-empty — narrowing arrives in PR-B; in PR-A the tile is always visible because no narrowing yet). |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/fixtures.ts` | Extended to the 30-row v2 distribution: 22 distinct event types across all 4 bands, all 4 actor types, mix of risk, 4 with envelopeId, 2 with notable `redactedKeyCount`, one `event.published` outside the operational allowlist. |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/activity.module.css` | Rewritten to declare the editorial paper tokens (`--paper`, `--ink-2/3/4/5`, `--hair`, `--amber`, `--amber-paper`, `--amber-deep`) at `.activityPage` scope and style the new div-grid table + drawer + header. Existing class names dropped for the rewritten components; classes still consumed by `filter-chips.tsx`, `empty-state.tsx`, and `pagination-footer.tsx` are preserved. |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/activity-page.tsx` | Minor integration: render the new `<ActivityHeader />`, pass row `now` anchor and table refs through, keep existing filter chips + empty state. |

**New files**

| Path | Responsibility |
|---|---|
| `apps/dashboard/src/app/(auth)/(mercury)/activity/components/__tests__/activity-row.test.tsx` | Co-located tests for chevron-only interactivity (H1 regression guard), band-dot per event band, actor glyph per type, risk hairline data-attr per category, `+N redacted` inline pill behaviour. |
| `apps/dashboard/src/app/(auth)/(mercury)/activity/components/__tests__/header.test.tsx` | Co-located tests for the editorial header — title text is `Audit log` (plain, no italic), single status tile renders relative time, no other tiles. |

**Files left alone in PR-A**

- `apps/dashboard/src/app/(auth)/(mercury)/activity/components/filter-chips.tsx` — PR-B replaces.
- `apps/dashboard/src/app/(auth)/(mercury)/activity/components/empty-state.tsx` — PR-C rewrites.
- `apps/dashboard/src/app/(auth)/(mercury)/activity/components/pagination-footer.tsx` — PR-C restyles.
- `apps/dashboard/src/app/(auth)/(mercury)/activity/hooks/use-activity-list.ts` — backend-frozen.
- `apps/dashboard/src/app/(auth)/(mercury)/activity/page.tsx` — server entry; unchanged.
- All existing tests under `__tests__/` are **updated** (existing drawer + table + page tests will break against the rewritten components and need regeneration); none are deleted outright.

---

## Workflow

Per CLAUDE.md doctrine: this PR-A implementation runs in **its own worktree** off `main`, on a fresh branch. The plan and spec already live on `main` via separate focused PRs. The implementer should:

```bash
# from /Users/jasonli/switchboard (main checkout)
git fetch origin main
git worktree add .worktrees/activity-rebuild-pr-a -b feat/activity-rebuild-pr-a-table-drawer origin/main
cd .worktrees/activity-rebuild-pr-a
pnpm worktree:init
pnpm install   # if not already installed via worktree:init
```

Verify the spec and plan are present on this branch (they merged via the prior PRs):

```bash
ls docs/superpowers/specs/2026-05-13-activity-rebuild-design.md
ls docs/superpowers/plans/2026-05-13-activity-rebuild-pr-a-table-drawer.md
```

Commit cadence: one commit per task (TDD red → green → commit). Conventional Commits required by commitlint.

---

### Task 1: Extend fixtures.ts to the v2 distribution

**Files:**
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/activity/fixtures.ts`

The existing fixtures cover 7-ish rows. The locked design distributes 30 rows across 22 distinct event types in all 4 bands, includes 4 envelope-bearing rows, 2 redacted-count rows, 1 out-of-allowlist row, and threads a full hash chain head-to-tail. The 30-row reference distribution is enumerated in `docs/design-prompts/locked/switchboard/project/activity-v2/data.js` — port it to TypeScript, preserving the order (DESC by timestamp) and the chain-link invariant (`rows[i].previousEntryHash === rows[i+1].entryHash`).

- [ ] **Step 1: Write the fixture-shape test**

Append to a new file `apps/dashboard/src/app/(auth)/(mercury)/activity/__tests__/fixtures.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { AuditEntryBrowseRowSchema, OPERATIONAL_AUDIT_EVENT_TYPES } from "@switchboard/schemas";
import { ACTIVITY_FIXTURES } from "../fixtures.js";

describe("ACTIVITY_FIXTURES (v2 distribution)", () => {
  it("contains exactly 30 rows", () => {
    expect(ACTIVITY_FIXTURES).toHaveLength(30);
  });

  it("every row parses against AuditEntryBrowseRowSchema", () => {
    for (const row of ACTIVITY_FIXTURES) {
      expect(() => AuditEntryBrowseRowSchema.parse(row)).not.toThrow();
    }
  });

  it("is DESC-ordered by timestamp", () => {
    for (let i = 0; i < ACTIVITY_FIXTURES.length - 1; i++) {
      const a = new Date(ACTIVITY_FIXTURES[i]!.timestamp).getTime();
      const b = new Date(ACTIVITY_FIXTURES[i + 1]!.timestamp).getTime();
      expect(a).toBeGreaterThanOrEqual(b);
    }
  });

  it("threads a head-to-tail hash chain (rows[i].previousEntryHash === rows[i+1].entryHash)", () => {
    for (let i = 0; i < ACTIVITY_FIXTURES.length - 1; i++) {
      expect(ACTIVITY_FIXTURES[i]!.previousEntryHash).toBe(ACTIVITY_FIXTURES[i + 1]!.entryHash);
    }
  });

  it("covers all 4 actor types", () => {
    const types = new Set(ACTIVITY_FIXTURES.map((r) => r.actorType));
    expect(types).toEqual(new Set(["user", "agent", "system", "service_account"]));
  });

  it("includes at least 22 distinct event types", () => {
    const evts = new Set(ACTIVITY_FIXTURES.map((r) => r.eventType));
    expect(evts.size).toBeGreaterThanOrEqual(22);
  });

  it("includes at least one row outside the operational allowlist", () => {
    const operational = new Set<string>(OPERATIONAL_AUDIT_EVENT_TYPES);
    const offAllowlist = ACTIVITY_FIXTURES.filter((r) => !operational.has(r.eventType));
    expect(offAllowlist.length).toBeGreaterThanOrEqual(1);
  });

  it("includes at least 4 rows with envelopeId set", () => {
    const withEnvelope = ACTIVITY_FIXTURES.filter((r) => r.envelopeId !== null);
    expect(withEnvelope.length).toBeGreaterThanOrEqual(4);
  });

  it("includes at least 2 rows with redactedKeyCount > 0", () => {
    const redacted = ACTIVITY_FIXTURES.filter((r) => r.redactedKeyCount > 0);
    expect(redacted.length).toBeGreaterThanOrEqual(2);
  });

  it("covers all 5 risk categories at least once", () => {
    const risks = new Set(ACTIVITY_FIXTURES.map((r) => r.riskCategory));
    expect(risks).toEqual(new Set(["none", "low", "medium", "high", "critical"]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/dashboard test fixtures.test.ts
```

Expected: most assertions fail (current fixtures have ~7 rows).

- [ ] **Step 3: Port the 30-row distribution from data.js to fixtures.ts**

Open `docs/design-prompts/locked/switchboard/project/activity-v2/data.js` and translate every sketch row into the `AuditEntryBrowseRow` shape, preserving:
- DESC timestamp order anchored at `2026-05-09T14:23:11+08:00`,
- Full hash chain (`entryHash` and `previousEntryHash` deterministic over a seed; the locked file already does this with its `hash64(seed)` helper — port the helper inline at the top of `fixtures.ts`),
- 16-char `hashPrefix` for each evidence pointer (`hash.slice(0, 16)`),
- `redactedKeyCount` set per the sketch (5 and 7 for the two notable rows),
- One `event.published` row outside the operational allowlist.

Replace the entire body of `fixtures.ts` with the 30-row array. Keep the existing top-of-file comment header but extend it to mention the v2 distribution invariants. The fixture must still export the same `ACTIVITY_FIXTURES` symbol as a typed `AuditEntryBrowseRow[]`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/dashboard test fixtures.test.ts
```

Expected: all 9 assertions pass.

- [ ] **Step 5: Re-run the existing tests that consume fixtures**

```bash
pnpm --filter @switchboard/dashboard test
```

Expected: existing tests under `__tests__/activity-page.test.tsx` and `__tests__/use-activity-list.test.tsx` continue to pass against the larger fixture (they should be fixture-shape-agnostic; if any test hard-codes a count of fixture rows, update it to match the new 30-row total).

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/fixtures.ts \
        apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/__tests__/fixtures.test.ts
git commit -m "test(dashboard): activity fixtures v2 distribution (30 rows, full chain)"
```

---

### Task 2: Add new time + band formatters to format.ts

**Files:**
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/activity/components/format.ts`
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/activity/components/__tests__/format.test.ts`

Add four new pure functions for the v2 row + drawer: `fmtClock(iso, tz?)`, `fmtRel(deltaMs)`, `fmtFullISO(iso, tz?)`, `eventBand(eventType)`.

**Orphaning note:** the existing `formatCell` and `formatDrawer` are consumed only by the v1 row + drawer that Tasks 4–6 will rewrite. After PR-A lands, both become orphaned (and `truncate` / `hashPrefix` likely too, if nothing else outside `/activity` imports them). Leave them in `format.ts` for this task — deletion lands in PR-C's cleanup pass once we've confirmed no other surface imports them.

- [ ] **Step 1: Write the failing tests**

Append to `apps/dashboard/src/app/(auth)/(mercury)/activity/components/__tests__/format.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { fmtClock, fmtRel, fmtFullISO, eventBand } from "../format.js";

describe("fmtClock", () => {
  it("renders HH:MM:SS in the resolved tz", () => {
    expect(fmtClock("2026-05-10T06:23:11.000Z", "UTC")).toBe("06:23:11");
  });

  it("returns '—' for invalid input", () => {
    expect(fmtClock("not-a-date")).toBe("—");
  });
});

describe("fmtRel", () => {
  it.each([
    [0, "0s ago"],
    [500, "0s ago"],
    [5_000, "5s ago"],
    [60_000, "1m ago"],
    [60 * 60 * 1000, "1h ago"],
    [24 * 60 * 60 * 1000, "1d ago"],
    [3 * 24 * 60 * 60 * 1000, "3d ago"],
  ])("returns %s ms as %s", (deltaMs, expected) => {
    expect(fmtRel(deltaMs)).toBe(expected);
  });

  it("clamps negative deltas to '0s ago'", () => {
    expect(fmtRel(-1000)).toBe("0s ago");
  });
});

describe("fmtFullISO", () => {
  it("returns {date, time, tz} components in the resolved tz", () => {
    const r = fmtFullISO("2026-05-10T06:23:11.420Z", "UTC");
    expect(r.date).toBe("2026-05-10");
    expect(r.time).toBe("06:23:11.420");
    expect(r.tz).toBe("+00:00");
  });

  it("returns dashes for invalid input", () => {
    const r = fmtFullISO("not-a-date");
    expect(r.date).toBe("—");
    expect(r.time).toBe("—");
    expect(r.tz).toBe("");
  });
});

describe("eventBand", () => {
  it.each([
    ["action.proposed", "action"],
    ["action.executed", "action"],
    ["identity.created", "identity"],
    ["overlay.activated", "identity"],
    ["policy.updated", "identity"],
    ["connection.revoked", "identity"],
    ["competence.promoted", "identity"],
    ["delegation.chain_resolved", "identity"],
    ["entity.linked", "identity"],
    ["event.published", "event"],
    ["event.reaction.triggered", "event"],
    ["agent.activated", "agent"],
    ["agent.emergency-halted", "agent"],
    ["work_trace.persisted", "agent"],
    ["work_trace.integrity_override", "agent"],
  ])("classifies %s as band %s", (eventType, band) => {
    expect(eventBand(eventType)).toBe(band);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @switchboard/dashboard test format.test.ts
```

Expected: import errors — the new functions are not yet exported.

- [ ] **Step 3: Add the four functions**

Append to `apps/dashboard/src/app/(auth)/(mercury)/activity/components/format.ts`:

```typescript
/**
 * Mono clock display for the row's TIME column — "HH:MM:SS" in the resolved tz.
 * Defensive against bad input; returns "—" rather than throwing.
 */
export function fmtClock(iso: string, orgTimezone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const tz = orgTimezone ?? browserTimezone();
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: FALLBACK_TZ,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(d);
  }
}

/**
 * Relative-time display — "Xs / Xm / Xh / Xd ago". Negative deltas clamp to 0s.
 * The caller computes `Date.now() - new Date(row.timestamp).getTime()` and
 * passes the result in.
 */
export function fmtRel(deltaMs: number): string {
  const ms = Math.max(0, deltaMs);
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/**
 * Drawer full-ISO breakdown. Returns the three parts the drawer wants to render
 * separately (with the TZ in a muted style). The locked design renders this as
 * "{date} · {time} {tz}".
 */
export function fmtFullISO(
  iso: string,
  orgTimezone?: string,
): { date: string; time: string; tz: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "—", time: "—", tz: "" };
  const tz = orgTimezone ?? browserTimezone();
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZoneName: "longOffset",
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const date = `${get("year")}-${get("month")}-${get("day")}`;
    const ms = String(d.getMilliseconds()).padStart(3, "0");
    const time = `${get("hour")}:${get("minute")}:${get("second")}.${ms}`;
    // longOffset emits "GMT+08:00"; strip the "GMT" prefix.
    const offset = get("timeZoneName").replace(/^GMT/, "") || "+00:00";
    return { date, time, tz: offset };
  } catch {
    return { date: "—", time: "—", tz: "" };
  }
}

/**
 * Event-band classifier — collapses the 45 event types into 4 bands for the
 * dot-color in the row's event-type badge. Bands match the locked design's
 * combobox grouping.
 */
export function eventBand(
  eventType: string,
): "action" | "identity" | "event" | "agent" {
  if (eventType.startsWith("action.")) return "action";
  if (eventType.startsWith("event.")) return "event";
  if (eventType.startsWith("agent.") || eventType.startsWith("work_trace.")) {
    return "agent";
  }
  return "identity";
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/dashboard test format.test.ts
```

Expected: all assertions pass. If `Intl.DateTimeFormat` produces `"24"` for midnight (locale quirk) the `fmtClock` test might need `"24:23:11"` accepted; if so, switch the locale to `"en-GB"` in the implementation.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/format.ts \
        apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/__tests__/format.test.ts
git commit -m "feat(dashboard): activity format helpers — fmtClock, fmtRel, fmtFullISO, eventBand"
```

---

### Task 3: Add the `useCopier` clipboard hook

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/activity/components/use-copier.ts`
- Create: `apps/dashboard/src/app/(auth)/(mercury)/activity/components/__tests__/use-copier.test.tsx`

The drawer has multiple copy buttons (`copy hash` × N, `copy entryHash`, `copy previousEntryHash`, `copy envelopeId`, `copy traceId`). Each button tracks its own 1.1s "copied" state. Pull this out into a reusable hook so each button stays small. Must satisfy H4: never throws when clipboard is unavailable.

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/app/(auth)/(mercury)/activity/components/__tests__/use-copier.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCopier } from "../use-copier.js";

describe("useCopier", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    // Restore clipboard
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      writable: true,
      configurable: true,
    });
  });

  it("starts with copied=null", () => {
    const { result } = renderHook(() => useCopier());
    expect(result.current[0]).toBeNull();
  });

  it("sets copied=<key> when clipboard write succeeds", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useCopier());
    await act(async () => {
      result.current[1]("entryHash", "abc123");
    });
    expect(writeText).toHaveBeenCalledWith("abc123");
    expect(result.current[0]).toBe("entryHash");
  });

  it("clears copied after 1100ms", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() => useCopier());
    await act(async () => {
      result.current[1]("entryHash", "abc123");
    });
    expect(result.current[0]).toBe("entryHash");
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(result.current[0]).toBeNull();
  });

  it("does NOT throw when navigator.clipboard is missing (H4)", () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() => useCopier());
    expect(() => result.current[1]("entryHash", "abc123")).not.toThrow();
    // Visual feedback still flips so the user sees acknowledgement.
    expect(result.current[0]).toBe("entryHash");
  });

  it("does NOT throw when clipboard.writeText rejects (H4)", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() => useCopier());
    await act(async () => {
      result.current[1]("entryHash", "abc123");
    });
    expect(result.current[0]).toBe("entryHash");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/dashboard test use-copier.test.tsx
```

Expected: cannot find module `../use-copier`.

- [ ] **Step 3: Implement the hook**

Create `apps/dashboard/src/app/(auth)/(mercury)/activity/components/use-copier.ts`:

```typescript
import { useCallback, useEffect, useState } from "react";

/**
 * useCopier — tracks which copy button was last clicked (`copied` key) and
 * clears it after 1.1s. Clipboard write is fire-and-forget — failures never
 * throw (H4 per spec §12), and the visual "copied" state flips regardless so
 * the user always sees acknowledgement.
 */
export function useCopier(): readonly [string | null, (key: string, text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (copied === null) return undefined;
    const t = setTimeout(() => setCopied(null), 1100);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = useCallback((key: string, text: string) => {
    // H4: never throw. Wrap the optional-chain in a try/catch in case the
    // browser's clipboard implementation throws synchronously.
    try {
      const write = navigator?.clipboard?.writeText?.(text);
      // Swallow async failures too.
      if (write && typeof write.catch === "function") {
        write.catch(() => {
          /* clipboard denied / unavailable */
        });
      }
    } catch {
      /* clipboard threw synchronously */
    }
    setCopied(key);
  }, []);

  return [copied, copy] as const;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/dashboard test use-copier.test.tsx
```

Expected: all 5 assertions pass.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/use-copier.ts \
        apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/__tests__/use-copier.test.tsx
git commit -m "feat(dashboard): useCopier hook — clipboard write with 1.1s flash (H4-safe)"
```

---

### Task 4: Rewrite `activity-row.tsx` — chevron-only, band-dot, glyph, risk hairline

**Files:**
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/activity/components/activity-row.tsx`
- Create: `apps/dashboard/src/app/(auth)/(mercury)/activity/components/__tests__/activity-row.test.tsx`

The row carries no `onClick` on its body (H1). The chevron is a real `<button>` that toggles the drawer. The row body renders five cells: time, event badge, actor glyph + id, entity stack, summary with `+N redacted`. Risk indication is via `data-risk` and pseudo-elements styled in the CSS module.

**Behavior change vs v1:** the v1 row displays a truncated `actorType:actorId.slice(0, 8)` (e.g. `agent:agent_al`). The v2 row displays the full `actorId` (e.g. `agent_alex_001`) with CSS `text-overflow: ellipsis` handling overflow. Same for entity. Tests in Step 1 expect the full id text. Likewise, the v2 row's `onToggle` signature changes from `() => void` to `(id: string) => void` — the row calls `onToggle(row.id)` directly instead of relying on the parent to wrap.

- [ ] **Step 1: Write the failing tests**

Create `apps/dashboard/src/app/(auth)/(mercury)/activity/components/__tests__/activity-row.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuditEntryBrowseRow } from "@switchboard/schemas";
import { ActivityRow } from "../activity-row.js";

const baseRow: AuditEntryBrowseRow = {
  id: "audit_test_001",
  eventType: "action.executed",
  timestamp: "2026-05-10T06:23:11.000Z",
  actorType: "agent",
  actorId: "agent_alex_001",
  entityType: "calendar_event",
  entityId: "cal_evt_9921",
  riskCategory: "low",
  visibilityLevel: "org",
  summary: "Booked appointment for contact CTC:abcd1234",
  snapshotKeys: ["actionType"],
  redactedKeyCount: 0,
  evidencePointers: [],
  entryHash: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
  previousEntryHash: null,
  envelopeId: null,
  traceId: null,
};

const NOW_MS = new Date("2026-05-10T06:24:11.000Z").getTime();

describe("ActivityRow", () => {
  it("renders time, event type, actor id, entity id, summary", () => {
    render(
      <ActivityRow row={baseRow} isOpen={false} isTarget={false} onToggle={() => {}} now={NOW_MS} />,
    );
    expect(screen.getByText("06:23:11")).toBeInTheDocument();
    expect(screen.getByText("1m ago")).toBeInTheDocument();
    expect(screen.getByText("action.executed")).toBeInTheDocument();
    expect(screen.getByText("agent_alex_001")).toBeInTheDocument();
    expect(screen.getByText("cal_evt_9921")).toBeInTheDocument();
    expect(screen.getByText(/Booked appointment for contact/)).toBeInTheDocument();
  });

  it("H1: row body has no onClick handler and no role='button'", () => {
    const onToggle = vi.fn();
    const { container } = render(
      <ActivityRow row={baseRow} isOpen={false} isTarget={false} onToggle={onToggle} now={NOW_MS} />,
    );
    const row = container.querySelector("[data-rowid]");
    expect(row).toBeInTheDocument();
    expect(row?.getAttribute("role")).not.toBe("button");
    expect(row?.getAttribute("onclick")).toBeNull();
    expect(row?.getAttribute("tabindex")).toBeNull();
  });

  it("H1: clicking summary text does NOT toggle the drawer (regression guard)", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <ActivityRow row={baseRow} isOpen={false} isTarget={false} onToggle={onToggle} now={NOW_MS} />,
    );
    await user.click(screen.getByText(/Booked appointment for contact/));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("chevron button toggles drawer when clicked", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <ActivityRow row={baseRow} isOpen={false} isTarget={false} onToggle={onToggle} now={NOW_MS} />,
    );
    await user.click(screen.getByRole("button", { name: /toggle details/i }));
    expect(onToggle).toHaveBeenCalledWith("audit_test_001");
  });

  it("chevron button toggles drawer when Enter or Space pressed", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <ActivityRow row={baseRow} isOpen={false} isTarget={false} onToggle={onToggle} now={NOW_MS} />,
    );
    const chevron = screen.getByRole("button", { name: /toggle details/i });
    chevron.focus();
    await user.keyboard("{Enter}");
    expect(onToggle).toHaveBeenCalledTimes(1);
    await user.keyboard(" ");
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it("event badge carries the correct data-band attribute per band", () => {
    const cases: Array<[AuditEntryBrowseRow["eventType"], string]> = [
      ["action.executed", "action"],
      ["identity.created", "identity"],
      ["event.published", "event"],
      ["agent.activated", "agent"],
    ];
    for (const [eventType, band] of cases) {
      const { container, unmount } = render(
        <ActivityRow
          row={{ ...baseRow, eventType }}
          isOpen={false}
          isTarget={false}
          onToggle={() => {}}
          now={NOW_MS}
        />,
      );
      expect(container.querySelector(`[data-band="${band}"]`)).toBeInTheDocument();
      unmount();
    }
  });

  it("actor glyph renders USR/AGT/SYS/SVC per actor type", () => {
    const cases: Array<[AuditEntryBrowseRow["actorType"], string]> = [
      ["user", "USR"],
      ["agent", "AGT"],
      ["system", "SYS"],
      ["service_account", "SVC"],
    ];
    for (const [actorType, glyph] of cases) {
      const { unmount } = render(
        <ActivityRow
          row={{ ...baseRow, actorType }}
          isOpen={false}
          isTarget={false}
          onToggle={() => {}}
          now={NOW_MS}
        />,
      );
      expect(screen.getByText(glyph)).toBeInTheDocument();
      unmount();
    }
  });

  it("row carries data-risk for each risk category", () => {
    const cases: Array<AuditEntryBrowseRow["riskCategory"]> = [
      "none",
      "low",
      "medium",
      "high",
      "critical",
    ];
    for (const risk of cases) {
      const { container, unmount } = render(
        <ActivityRow
          row={{ ...baseRow, riskCategory: risk }}
          isOpen={false}
          isTarget={false}
          onToggle={() => {}}
          now={NOW_MS}
        />,
      );
      expect(container.querySelector(`[data-risk="${risk}"]`)).toBeInTheDocument();
      unmount();
    }
  });

  it("renders +N redacted pill when redactedKeyCount > 0", () => {
    render(
      <ActivityRow
        row={{ ...baseRow, redactedKeyCount: 5 }}
        isOpen={false}
        isTarget={false}
        onToggle={() => {}}
        now={NOW_MS}
      />,
    );
    expect(screen.getByText(/\+5 redacted/i)).toBeInTheDocument();
  });

  it("does NOT render +N redacted pill when redactedKeyCount = 0", () => {
    render(
      <ActivityRow row={baseRow} isOpen={false} isTarget={false} onToggle={() => {}} now={NOW_MS} />,
    );
    expect(screen.queryByText(/redacted/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/dashboard test activity-row.test.tsx
```

Expected: tests fail — the rewritten row doesn't exist yet (or fails the H1 checks because the existing v1 row uses `<tr>` markup, not the div-grid shape).

- [ ] **Step 3: Rewrite `activity-row.tsx`**

Replace the entire file with:

```tsx
"use client";

import type { AuditEntryBrowseRow } from "@switchboard/schemas";
import styles from "../activity.module.css";
import { fmtClock, fmtRel, eventBand } from "./format.js";

const ACTOR_GLYPH: Record<AuditEntryBrowseRow["actorType"], string> = {
  user: "USR",
  agent: "AGT",
  system: "SYS",
  service_account: "SVC",
};

const ACTOR_LABEL: Record<AuditEntryBrowseRow["actorType"], string> = {
  user: "User",
  agent: "Agent",
  system: "System",
  service_account: "Service",
};

export interface ActivityRowProps {
  row: AuditEntryBrowseRow;
  isOpen: boolean;
  isTarget: boolean;
  onToggle: (id: string) => void;
  /** Wall-clock "now" anchor in ms used to compute the relative-time string. */
  now: number;
  /** Optional ref for the row's outermost element — used for scrollToRow(id). */
  rowRef?: (el: HTMLDivElement | null) => void;
  orgTimezone?: string;
}

/**
 * One row in the /activity div-grid table.
 *
 * H1 (spec §12): the row body has NO onClick, NO role="button", NO tabIndex.
 * The chevron is the only interactive element — operators must be able to
 * select identifiers out of the summary cell without collapsing the row.
 */
export function ActivityRow({
  row,
  isOpen,
  isTarget,
  onToggle,
  now,
  rowRef,
  orgTimezone,
}: ActivityRowProps) {
  const ts = new Date(row.timestamp).getTime();
  const band = eventBand(row.eventType);
  const glyph = ACTOR_GLYPH[row.actorType];
  const label = ACTOR_LABEL[row.actorType];
  const rowClass = [styles.arow, isOpen ? styles.arowOpen : "", isTarget ? styles.arowTarget : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={rowRef}
      role="row"
      data-rowid={row.id}
      data-risk={row.riskCategory}
      className={rowClass}
    >
      <div role="cell" className={styles.colTime}>
        <span className={styles.colTimeClock}>{fmtClock(row.timestamp, orgTimezone)}</span>
        <span className={styles.colTimeRel}>{fmtRel(now - ts)}</span>
      </div>

      <div role="cell" className={styles.colEvent}>
        <span className={styles.evtBadge} data-band={band}>
          <span className={styles.evtBand} aria-hidden="true" />
          <span className={styles.evtText}>{row.eventType}</span>
        </span>
      </div>

      <div role="cell" className={styles.colActor}>
        <span
          className={styles.actorGlyph}
          data-actor={row.actorType}
          title={label}
          aria-label={label}
        >
          {glyph}
        </span>
        <span className={styles.colActorId} title={row.actorId}>
          {row.actorId}
        </span>
      </div>

      <div role="cell" className={styles.colEntity}>
        <span className={styles.colEntityType}>{row.entityType}</span>
        <span className={styles.colEntityId} title={row.entityId}>
          {row.entityId}
        </span>
      </div>

      <div role="cell" className={styles.colSummary} title={row.summary}>
        {row.summary}
        {row.redactedKeyCount > 0 && (
          <span className={styles.redactedBadge}>+{row.redactedKeyCount} redacted</span>
        )}
      </div>

      <div role="cell" className={styles.colChevron}>
        <button
          type="button"
          className={styles.chevronButton}
          aria-expanded={isOpen}
          aria-controls={`activity-drawer-${row.id}`}
          aria-label={`Toggle details for entry ${row.id}`}
          onClick={() => onToggle(row.id)}
        >
          <span aria-hidden="true" className={isOpen ? styles.chevronOpen : styles.chevron}>
            ›
          </span>
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add the matching CSS classes (skeleton only)**

The full CSS rewrite happens in Task 7. For now, append the minimal class hooks to `activity.module.css` so the row renders without crashing. These will be re-styled (or replaced) in Task 7 — the test suite only cares about role + data attrs + text content, not visual fidelity yet.

Append to `apps/dashboard/src/app/(auth)/(mercury)/activity/activity.module.css`:

```css
/* Activity v2 row scaffolding — visual rewrite lands in Task 7 */
.arow { display: grid; grid-template-columns: 96px minmax(180px, 220px) minmax(150px, 180px) minmax(150px, 180px) 1fr 24px; gap: 14px; align-items: center; padding: 12px 12px 12px 14px; }
.arowOpen { background: #FAF4E8; }
.arowTarget { animation: targetFlash 1.6s ease; }
@keyframes targetFlash { 0%, 30% { background: #FAF4E8; } 100% { background: transparent; } }
.colTime { display: flex; flex-direction: column; gap: 2px; }
.colTimeClock { font-family: var(--font-mono, ui-monospace, monospace); }
.colTimeRel { font-family: var(--font-mono, ui-monospace, monospace); opacity: 0.6; }
.colEvent { min-width: 0; }
.evtBadge { display: inline-flex; align-items: center; gap: 7px; padding: 4px 9px; border: 1px solid rgba(14,12,10,0.16); border-radius: 2px; }
.evtBand { width: 5px; height: 5px; border-radius: 50%; background: #C8BEAE; flex-shrink: 0; }
.evtBadge[data-band="action"] .evtBand { background: hsl(30 55% 46%); }
.evtBadge[data-band="identity"] .evtBand { background: #6B6052; }
.evtBadge[data-band="event"] .evtBand { background: #C8BEAE; }
.evtBadge[data-band="agent"] .evtBand { background: #0E0C0A; }
.evtText { font-family: var(--font-mono, ui-monospace, monospace); white-space: nowrap; }
.colActor { display: flex; align-items: center; gap: 9px; min-width: 0; font-family: var(--font-mono, ui-monospace, monospace); }
.actorGlyph { width: 28px; height: 18px; border: 1px solid rgba(14,12,10,0.16); border-radius: 1px; display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-mono, ui-monospace, monospace); font-size: 9.5px; font-weight: 700; }
.colActorId { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.colEntity { display: flex; flex-direction: column; gap: 2px; min-width: 0; font-family: var(--font-mono, ui-monospace, monospace); }
.colEntityType { font-size: 10px; text-transform: uppercase; opacity: 0.6; }
.colEntityId { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.colSummary { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.redactedBadge { display: inline-block; margin-left: 8px; padding: 1px 6px; border: 1px dashed rgba(14,12,10,0.4); border-radius: 999px; font-family: var(--font-mono, ui-monospace, monospace); font-size: 9.5px; }
.colChevron { display: inline-flex; align-items: center; justify-content: center; }
.chevronButton { background: transparent; border: none; padding: 0; cursor: pointer; }
.chevron { display: inline-block; }
.chevronOpen { display: inline-block; transform: rotate(90deg); }
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/dashboard test activity-row.test.tsx
```

Expected: all assertions pass.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/activity-row.tsx \
        apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/__tests__/activity-row.test.tsx \
        apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/activity.module.css
git commit -m "feat(dashboard): activity-row v2 — chevron-only, band-dot, actor glyph (H1)"
```

---

### Task 5: Rewrite `activity-row-drawer.tsx` — Timestamp + Classification + Snapshot sections

**Files:**
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/activity/components/activity-row-drawer.tsx`
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/activity/__tests__/activity-row-drawer.test.tsx` (replace contents)

The drawer is a 6-section grid. Tasks 5 and 6 together rewrite it. Task 5 covers sections 1–3 (Timestamp, Visibility/classification, Snapshot keys). Task 6 covers sections 4–6 (Evidence, Hash chain, References).

- [ ] **Step 1: Replace `__tests__/activity-row-drawer.test.tsx` with the v2 test surface (sections 1–3 only for now)**

Open `apps/dashboard/src/app/(auth)/(mercury)/activity/__tests__/activity-row-drawer.test.tsx` and replace its body with:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AuditEntryBrowseRow } from "@switchboard/schemas";
import { ActivityRowDrawer } from "../components/activity-row-drawer.js";

const makeRow = (overrides: Partial<AuditEntryBrowseRow> = {}): AuditEntryBrowseRow => ({
  id: "audit_test_001",
  eventType: "action.approved",
  timestamp: "2026-05-10T06:23:11.420Z",
  actorType: "user",
  actorId: "user_kim_principal",
  entityType: "approval_envelope",
  entityId: "env_2f1a08c4",
  riskCategory: "critical",
  visibilityLevel: "org",
  summary: "Operator signed refund of SGD 4,820 to client #SG-44120",
  snapshotKeys: ["actionType", "approvalId", "decisionId", "envelopeId", "correlationId"],
  redactedKeyCount: 5,
  evidencePointers: [],
  entryHash: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
  previousEntryHash: "0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a",
  envelopeId: null,
  traceId: null,
  ...overrides,
});

afterEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    value: undefined,
    writable: true,
    configurable: true,
  });
});

describe("ActivityRowDrawer — Timestamp section", () => {
  it("renders the full ISO date, time, and tz", () => {
    render(
      <ActivityRowDrawer
        row={makeRow()}
        allRows={[]}
        onScrollToRow={() => {}}
        orgTimezone="UTC"
      />,
    );
    expect(screen.getByText("2026-05-10")).toBeInTheDocument();
    expect(screen.getByText("06:23:11.420")).toBeInTheDocument();
    expect(screen.getByText("+00:00")).toBeInTheDocument();
  });

  it("carries the local-tz prose note", () => {
    render(
      <ActivityRowDrawer
        row={makeRow()}
        allRows={[]}
        onScrollToRow={() => {}}
        orgTimezone="UTC"
      />,
    );
    expect(screen.getByText(/stored as ISO-8601 UTC on the entry/i)).toBeInTheDocument();
  });
});

describe("ActivityRowDrawer — Visibility · classification section", () => {
  it("renders visibility, risk, and eventType inline", () => {
    render(
      <ActivityRowDrawer
        row={makeRow()}
        allRows={[]}
        onScrollToRow={() => {}}
        orgTimezone="UTC"
      />,
    );
    expect(screen.getByText("org")).toBeInTheDocument();
    expect(screen.getByText("critical")).toBeInTheDocument();
    expect(screen.getByText("action.approved")).toBeInTheDocument();
  });

  it("carries the server-filtered visibility prose note", () => {
    render(
      <ActivityRowDrawer
        row={makeRow()}
        allRows={[]}
        onScrollToRow={() => {}}
        orgTimezone="UTC"
      />,
    );
    expect(screen.getByText(/visibilityLevel is server-filtered/i)).toBeInTheDocument();
  });
});

describe("ActivityRowDrawer — Snapshot keys section", () => {
  it("renders one chip per snapshot key", () => {
    render(
      <ActivityRowDrawer
        row={makeRow()}
        allRows={[]}
        onScrollToRow={() => {}}
        orgTimezone="UTC"
      />,
    );
    for (const key of ["actionType", "approvalId", "decisionId", "envelopeId", "correlationId"]) {
      expect(screen.getByText(key)).toBeInTheDocument();
    }
  });

  it("renders the +N redacted pill when redactedKeyCount > 0", () => {
    render(
      <ActivityRowDrawer
        row={makeRow()}
        allRows={[]}
        onScrollToRow={() => {}}
        orgTimezone="UTC"
      />,
    );
    expect(screen.getByText(/\+5 redacted/i)).toBeInTheDocument();
  });

  it("renders 'no snapshot keys recorded' when snapshotKeys is empty", () => {
    render(
      <ActivityRowDrawer
        row={makeRow({ snapshotKeys: [], redactedKeyCount: 0 })}
        allRows={[]}
        onScrollToRow={() => {}}
        orgTimezone="UTC"
      />,
    );
    expect(screen.getByText(/no snapshot keys recorded/i)).toBeInTheDocument();
  });

  it("H3: snapshot VALUES are never rendered", () => {
    // The fixture intentionally carries a key name "envelopeId" but no value.
    // The drawer must render only the *name* "envelopeId" as a chip, never an id.
    const { container } = render(
      <ActivityRowDrawer
        row={makeRow({ snapshotKeys: ["envelopeId", "approvalId"], envelopeId: null })}
        allRows={[]}
        onScrollToRow={() => {}}
        orgTimezone="UTC"
      />,
    );
    // The drawer should not contain any obviously-id-shaped text in the
    // snapshot section beyond the key names themselves.
    const snapshotSection = container.querySelector("[data-section='snapshot']");
    expect(snapshotSection).toBeInTheDocument();
    expect(snapshotSection?.textContent).not.toMatch(/env_/);
    expect(snapshotSection?.textContent).not.toMatch(/SGD/);
  });

  it("H2: storageRef is never rendered, even if injected into the row", () => {
    // AuditEntryBrowseRow doesn't carry storageRef, but defense-in-depth:
    // hand-craft a row that ALSO has a storageRef field on its evidence
    // pointers (extra TS-cast) and verify the drawer never renders it.
    const tainted = {
      ...makeRow(),
      evidencePointers: [
        {
          type: "pointer" as const,
          hash: "abc",
          hashPrefix: "abc",
          storageRef: "s3://buckets/super-secret/path",
        },
      ],
    } as unknown as AuditEntryBrowseRow;
    const { container } = render(
      <ActivityRowDrawer
        row={tainted}
        allRows={[]}
        onScrollToRow={() => {}}
        orgTimezone="UTC"
      />,
    );
    expect(container.textContent).not.toContain("s3://");
    expect(container.textContent).not.toContain("super-secret");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @switchboard/dashboard test activity-row-drawer.test.tsx
```

Expected: the existing v1 drawer doesn't match the new structure — most assertions fail.

- [ ] **Step 3: Rewrite the drawer (sections 1–3 only)**

Replace `apps/dashboard/src/app/(auth)/(mercury)/activity/components/activity-row-drawer.tsx` with:

```tsx
"use client";

import type { AuditEntryBrowseRow } from "@switchboard/schemas";
import styles from "../activity.module.css";
import { fmtFullISO } from "./format.js";

export interface ActivityRowDrawerProps {
  row: AuditEntryBrowseRow;
  /** All currently-rendered rows — used by the chain-anchor "view previous ↓"
   *  affordance (Task 6) to find the predecessor row on the same page. */
  allRows: AuditEntryBrowseRow[];
  onScrollToRow: (id: string) => void;
  orgTimezone?: string;
}

/**
 * Inline drawer for an /activity row.
 *
 * Hard invariants from spec §12:
 *  H2: never renders evidencePointers[].storageRef.
 *  H3: never renders snapshot VALUES — only allowlisted key NAMES.
 *  H4: copy buttons never throw (handled in useCopier).
 */
export function ActivityRowDrawer({ row, allRows, onScrollToRow, orgTimezone }: ActivityRowDrawerProps) {
  // Suppress unused-var lint until Task 6 wires these into the chain section.
  void allRows;
  void onScrollToRow;

  const iso = fmtFullISO(row.timestamp, orgTimezone);

  return (
    <div
      id={`activity-drawer-${row.id}`}
      role="region"
      aria-label={`Audit entry detail for ${row.id}`}
      className={styles.drawer}
    >
      <div className={styles.drawerInner}>
        {/* Section 1: Timestamp */}
        <div className={styles.dsection}>
          <span className={styles.dsectionLabel}>Timestamp</span>
          <span className={styles.dsectionFullIso}>
            {iso.date} <span className={styles.dsectionTz}>·</span> {iso.time}{" "}
            <span className={styles.dsectionTz}>{iso.tz}</span>
          </span>
          <span className={styles.dsectionNote}>
            stored as ISO-8601 UTC on the entry; rendered in your browser's local timezone.
          </span>
        </div>

        {/* Section 2: Visibility · classification */}
        <div className={styles.dsection}>
          <span className={styles.dsectionLabel}>Visibility · classification</span>
          <span className={styles.dsectionFullIso}>
            visibility:&nbsp;<b>{row.visibilityLevel}</b>
            &nbsp;<span className={styles.dsectionTz}>·</span>&nbsp; risk:&nbsp;
            <b>{row.riskCategory}</b>
            &nbsp;<span className={styles.dsectionTz}>·</span>&nbsp; event:&nbsp;
            <b>{row.eventType}</b>
          </span>
          <span className={styles.dsectionNote}>
            visibilityLevel is server-filtered; the client only ever sees rows it's authorized to read.
          </span>
        </div>

        {/* Section 3: Snapshot keys */}
        <div className={`${styles.dsection} ${styles.dsectionFull}`} data-section="snapshot">
          <span className={styles.dsectionLabel}>
            Snapshot keys <span className={styles.dsectionLabelDim}>(allowlist · values redacted)</span>
          </span>
          <div className={styles.snapKeys}>
            {row.snapshotKeys.length === 0 ? (
              <span className={styles.evnone}>no snapshot keys recorded</span>
            ) : (
              row.snapshotKeys.map((k) => (
                <span key={k} className={styles.snapKey}>
                  {k}
                </span>
              ))
            )}
            {row.redactedKeyCount > 0 && (
              <span className={styles.snapRedacted}>+{row.redactedKeyCount} redacted</span>
            )}
          </div>
          <span className={styles.dsectionNote}>
            Full snapshot values stay on the server. Only allowlisted key <em>names</em> appear here
            (
            <span className={styles.dsectionMono}>
              id, kind, source, actionType, decisionId, recommendationId, approvalId, envelopeId,
              agentKey, targetEntityType, targetEntityId, correlationId, traceId
            </span>
            ); everything else is rolled into the redacted count.
          </span>
        </div>

        {/* Sections 4–6 (Evidence, Hash chain, References) land in Task 6 */}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add the matching CSS classes (skeleton)**

Append to `activity.module.css`:

```css
/* Activity v2 drawer scaffolding — visual rewrite lands in Task 7 */
.drawer { background: #F9F4E8; border-top: 1px solid rgba(14,12,10,0.08); border-bottom: 1px solid rgba(14,12,10,0.08); }
.drawerInner { padding: 22px 18px 26px 28px; display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 28px 36px; }
@media (max-width: 980px) { .drawerInner { grid-template-columns: 1fr; gap: 26px; } }
.dsection { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.dsectionFull { grid-column: 1 / -1; }
.dsectionLabel { font-family: var(--font-mono, ui-monospace, monospace); font-size: 10px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; opacity: 0.6; }
.dsectionLabelDim { opacity: 0.55; font-weight: 600; }
.dsectionFullIso { font-family: var(--font-mono, ui-monospace, monospace); font-size: 13px; }
.dsectionTz { opacity: 0.5; }
.dsectionNote { font-size: 12px; opacity: 0.7; font-style: italic; margin-top: 2px; }
.dsectionMono { font-family: var(--font-mono, ui-monospace, monospace); font-style: normal; }
.snapKeys { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.snapKey { font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; padding: 3px 8px; background: #FFF; border: 1px solid rgba(14,12,10,0.08); border-radius: 2px; }
.snapRedacted { font-family: var(--font-mono, ui-monospace, monospace); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; padding: 3px 8px; border: 1px dashed rgba(14,12,10,0.4); border-radius: 2px; opacity: 0.7; }
.evnone { font-size: 12.5px; opacity: 0.6; font-style: italic; }
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/dashboard test activity-row-drawer.test.tsx
```

Expected: all assertions in Tasks-5 test surface pass. The H2 and H3 tests pass even though sections 4–6 aren't built yet — `storageRef` is never referenced anywhere in the source, and snapshot values are never read off the row.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/activity-row-drawer.tsx \
        apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/__tests__/activity-row-drawer.test.tsx \
        apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/activity.module.css
git commit -m "feat(dashboard): activity drawer v2 — timestamp/classification/snapshot (H2, H3)"
```

---

### Task 6: Add drawer sections 4–6 — Evidence, Hash chain, References

**Files:**
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/activity/components/activity-row-drawer.tsx`
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/activity/__tests__/activity-row-drawer.test.tsx`

- [ ] **Step 1: Extend the drawer test surface with sections 4–6 assertions**

Append to `activity-row-drawer.test.tsx`:

```typescript
import userEvent from "@testing-library/user-event";

describe("ActivityRowDrawer — Evidence pointers section", () => {
  it("renders one evidence row per pointer with hash prefix highlighted", () => {
    render(
      <ActivityRowDrawer
        row={makeRow({
          evidencePointers: [
            {
              type: "pointer",
              hash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
              hashPrefix: "abcdef0123456789",
            },
            {
              type: "inline",
              hash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
              hashPrefix: "0123456789abcdef",
            },
          ],
        })}
        allRows={[]}
        onScrollToRow={() => {}}
        orgTimezone="UTC"
      />,
    );
    expect(screen.getByText("pointer")).toBeInTheDocument();
    expect(screen.getByText("inline")).toBeInTheDocument();
    expect(screen.getAllByText(/copy hash/i)).toHaveLength(2);
  });

  it("renders the absence note for storageRef", () => {
    render(
      <ActivityRowDrawer
        row={makeRow()}
        allRows={[]}
        onScrollToRow={() => {}}
        orgTimezone="UTC"
      />,
    );
    expect(screen.getByText(/storageRef.*intentionally absent/i)).toBeInTheDocument();
  });

  it("renders 'no evidence pointers attached' when list is empty", () => {
    render(
      <ActivityRowDrawer
        row={makeRow({ evidencePointers: [] })}
        allRows={[]}
        onScrollToRow={() => {}}
        orgTimezone="UTC"
      />,
    );
    expect(screen.getByText(/no evidence pointers attached/i)).toBeInTheDocument();
  });

  it("H4: copy hash button does not throw when clipboard is unavailable", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    render(
      <ActivityRowDrawer
        row={makeRow({
          evidencePointers: [
            {
              type: "pointer",
              hash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
              hashPrefix: "abcdef0123456789",
            },
          ],
        })}
        allRows={[]}
        onScrollToRow={() => {}}
        orgTimezone="UTC"
      />,
    );
    const btn = screen.getByRole("button", { name: /copy hash/i });
    await expect(user.click(btn)).resolves.not.toThrow();
  });
});

describe("ActivityRowDrawer — Hash chain section", () => {
  it("renders entryHash and previousEntryHash in full", () => {
    const row = makeRow();
    render(
      <ActivityRowDrawer row={row} allRows={[]} onScrollToRow={() => {}} orgTimezone="UTC" />,
    );
    expect(screen.getByText(row.entryHash)).toBeInTheDocument();
    expect(screen.getByText(row.previousEntryHash as string)).toBeInTheDocument();
  });

  it("renders genesis tag when previousEntryHash is null", () => {
    render(
      <ActivityRowDrawer
        row={makeRow({ previousEntryHash: null })}
        allRows={[]}
        onScrollToRow={() => {}}
        orgTimezone="UTC"
      />,
    );
    expect(screen.getByText(/genesis \(no predecessor\)/i)).toBeInTheDocument();
  });

  it("renders 'view previous ↓' when predecessor row is on the page, off-page tag otherwise", () => {
    const target = makeRow({
      id: "audit_target",
      entryHash: "previoushash_target",
    });
    const child = makeRow({
      id: "audit_child",
      previousEntryHash: "previoushash_target",
    });
    const { rerender } = render(
      <ActivityRowDrawer
        row={child}
        allRows={[target, child]}
        onScrollToRow={() => {}}
        orgTimezone="UTC"
      />,
    );
    expect(screen.getByRole("button", { name: /view previous/i })).toBeInTheDocument();

    rerender(
      <ActivityRowDrawer row={child} allRows={[child]} onScrollToRow={() => {}} orgTimezone="UTC" />,
    );
    expect(screen.queryByRole("button", { name: /view previous/i })).not.toBeInTheDocument();
    expect(screen.getByText(/off-page/i)).toBeInTheDocument();
  });

  it("clicking 'view previous ↓' calls onScrollToRow with the predecessor's id", async () => {
    const user = userEvent.setup();
    const onScrollToRow = vi.fn();
    const target = makeRow({ id: "audit_target", entryHash: "previoushash_target" });
    const child = makeRow({ id: "audit_child", previousEntryHash: "previoushash_target" });
    render(
      <ActivityRowDrawer
        row={child}
        allRows={[target, child]}
        onScrollToRow={onScrollToRow}
        orgTimezone="UTC"
      />,
    );
    await user.click(screen.getByRole("button", { name: /view previous/i }));
    expect(onScrollToRow).toHaveBeenCalledWith("audit_target");
  });
});

describe("ActivityRowDrawer — References section", () => {
  it("renders envelope id with copy + open link when set", () => {
    render(
      <ActivityRowDrawer
        row={makeRow({ envelopeId: "env_xyz_123" })}
        allRows={[]}
        onScrollToRow={() => {}}
        orgTimezone="UTC"
      />,
    );
    expect(screen.getByText("env_xyz_123")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /open ↗/i });
    expect(link).toHaveAttribute("href", "/approvals/env_xyz_123");
  });

  it("renders 'no approval envelope' italic when envelopeId is null", () => {
    render(
      <ActivityRowDrawer
        row={makeRow({ envelopeId: null })}
        allRows={[]}
        onScrollToRow={() => {}}
        orgTimezone="UTC"
      />,
    );
    expect(screen.getByText(/no approval envelope/i)).toBeInTheDocument();
  });

  it("renders trace id with /traces/ link when set", () => {
    render(
      <ActivityRowDrawer
        row={makeRow({ traceId: "trace_abc_456" })}
        allRows={[]}
        onScrollToRow={() => {}}
        orgTimezone="UTC"
      />,
    );
    const link = screen.getByRole("link", { name: /open ↗/i });
    expect(link).toHaveAttribute("href", "/traces/trace_abc_456");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @switchboard/dashboard test activity-row-drawer.test.tsx
```

Expected: section-4/5/6 assertions fail — drawer doesn't render those sections yet.

- [ ] **Step 3: Add sections 4–6 to the drawer**

Open `apps/dashboard/src/app/(auth)/(mercury)/activity/components/activity-row-drawer.tsx`. Drop the `void allRows; void onScrollToRow;` lines added in Task 5, then add the three sections inside `<div className={styles.drawerInner}>` after the snapshot section:

```tsx
        {/* Section 4: Evidence pointers */}
        <div className={`${styles.dsection} ${styles.dsectionFull}`}>
          <span className={styles.dsectionLabel}>Evidence pointers</span>
          {row.evidencePointers.length === 0 ? (
            <span className={styles.evnone}>no evidence pointers attached</span>
          ) : (
            <div className={styles.evlist}>
              {row.evidencePointers.map((e, i) => (
                <EvidenceRow key={i} index={i} pointer={e} />
              ))}
            </div>
          )}
          <div className={styles.absenceNote}>
            <b>storageRef</b> intentionally absent — evidence reference is held server-side.
            Surface the absence, not a redacted placeholder; clients fetch evidence via
            authenticated <span className={styles.dsectionMono}>/api/evidence/:hash</span>.
          </div>
        </div>

        {/* Section 5: Hash chain */}
        <div className={`${styles.dsection} ${styles.dsectionFull}`}>
          <span className={styles.dsectionLabel}>Hash chain · integrity anchor</span>
          <ChainBlock row={row} allRows={allRows} onScrollToRow={onScrollToRow} />
        </div>

        {/* Section 6: References */}
        <div className={`${styles.dsection} ${styles.dsectionFull}`}>
          <span className={styles.dsectionLabel}>References</span>
          <div className={styles.linkpair}>
            <RefRow
              label="Envelope"
              value={row.envelopeId}
              copyKey="env"
              hrefBase="/approvals/"
              emptyLabel="no approval envelope"
            />
            <RefRow
              label="Trace"
              value={row.traceId}
              copyKey="tr"
              hrefBase="/traces/"
              emptyLabel="no correlation trace"
            />
          </div>
        </div>
```

Then add three helper components above the `ActivityRowDrawer` function in the same file:

```tsx
import { useMemo } from "react";
import { useCopier } from "./use-copier.js";

function CopyBtn({
  copyKey,
  text,
  label = "copy",
}: {
  copyKey: string;
  text: string;
  label?: string;
}) {
  const [copied, copy] = useCopier();
  return (
    <button
      type="button"
      className={`${styles.copybtn} ${copied === copyKey ? styles.copybtnCopied : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        copy(copyKey, text);
      }}
    >
      {copied === copyKey ? "copied" : label}
    </button>
  );
}

function EvidenceRow({
  pointer,
  index,
}: {
  pointer: { type: "inline" | "pointer"; hash: string; hashPrefix: string };
  index: number;
}) {
  const rest = pointer.hash.slice(16);
  return (
    <div className={styles.evrow}>
      <span className={styles.evtype}>{pointer.type}</span>
      <span className={styles.evhash} title={pointer.hash}>
        <span className={styles.evhashPrefix}>{pointer.hashPrefix}</span>
        <span className={styles.evhashRest}>{rest}</span>
      </span>
      <CopyBtn copyKey={`ev${index}`} text={pointer.hash} label="copy hash" />
    </div>
  );
}

function ChainBlock({
  row,
  allRows,
  onScrollToRow,
}: {
  row: AuditEntryBrowseRow;
  allRows: AuditEntryBrowseRow[];
  onScrollToRow: (id: string) => void;
}) {
  const prev = useMemo(
    () =>
      row.previousEntryHash
        ? allRows.find((r) => r.entryHash === row.previousEntryHash) ?? null
        : null,
    [row.previousEntryHash, allRows],
  );

  return (
    <div className={styles.chain}>
      <div className={styles.chainRow}>
        <span className={styles.dsectionLabel}>Entry hash</span>
        <span className={styles.chainHash}>{row.entryHash}</span>
        <CopyBtn copyKey="eh" text={row.entryHash} />
      </div>
      <div className={`${styles.chainRow} ${row.previousEntryHash === null ? styles.chainAnchor : ""}`}>
        <span className={styles.dsectionLabel}>Previous</span>
        <span className={styles.chainHash}>
          {row.previousEntryHash ?? "— genesis (no predecessor) —"}
        </span>
        <span className={styles.chainActions}>
          {row.previousEntryHash && (
            <>
              <CopyBtn copyKey="ph" text={row.previousEntryHash} />
              {prev ? (
                <button
                  type="button"
                  className={`${styles.copybtn} ${styles.copybtnPrimary}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onScrollToRow(prev.id);
                  }}
                >
                  view previous ↓
                </button>
              ) : (
                <span className={styles.evnone}>off-page</span>
              )}
            </>
          )}
        </span>
      </div>
    </div>
  );
}

function RefRow({
  label,
  value,
  copyKey,
  hrefBase,
  emptyLabel,
}: {
  label: string;
  value: string | null;
  copyKey: string;
  hrefBase: string;
  emptyLabel: string;
}) {
  return (
    <div className={`${styles.linkrow} ${value === null ? styles.linkrowEmpty : ""}`}>
      <span className={styles.dsectionLabel}>{label}</span>
      <span className={styles.linkrowVal}>{value ?? emptyLabel}</span>
      {value !== null && (
        <>
          <CopyBtn copyKey={copyKey} text={value} />
          <a
            className={styles.openlink}
            href={`${hrefBase}${value}`}
            onClick={(e) => e.stopPropagation()}
          >
            open ↗
          </a>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add the matching CSS classes**

Append to `activity.module.css`:

```css
/* Evidence rows */
.evlist { display: flex; flex-direction: column; gap: 10px; }
.evrow { display: grid; grid-template-columns: 56px minmax(0,1fr) auto; gap: 12px; align-items: center; padding: 8px 10px; background: #FFF; border: 1px solid rgba(14,12,10,0.08); border-radius: 2px; }
.evtype { font-family: var(--font-mono, ui-monospace, monospace); font-size: 9.5px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; opacity: 0.6; }
.evhash { font-family: var(--font-mono, ui-monospace, monospace); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.evhashPrefix { font-weight: 600; }
.evhashRest { opacity: 0.4; }
.absenceNote { font-family: var(--font-mono, ui-monospace, monospace); font-size: 10.5px; opacity: 0.7; padding: 8px 10px; border: 1px dashed rgba(14,12,10,0.16); border-radius: 2px; }

/* Hash chain */
.chain { display: flex; flex-direction: column; gap: 12px; padding: 14px 0; border-top: 1px solid #0E0C0A; border-bottom: 1px solid #0E0C0A; }
.chainRow { display: grid; grid-template-columns: 100px minmax(0,1fr) auto; gap: 14px; align-items: center; }
.chainHash { font-family: var(--font-mono, ui-monospace, monospace); font-size: 12.5px; word-break: break-all; line-height: 1.45; }
.chainAnchor .chainHash { opacity: 0.6; font-style: italic; }
.chainActions { display: inline-flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }

/* References */
.linkpair { display: flex; flex-direction: column; gap: 8px; }
.linkrow { display: grid; grid-template-columns: 92px minmax(0,1fr) auto auto; gap: 10px; align-items: center; padding: 8px 10px; background: #FFF; border: 1px solid rgba(14,12,10,0.08); border-radius: 2px; }
.linkrowEmpty { background: transparent; border: 1px dashed rgba(14,12,10,0.16); }
.linkrowVal { font-family: var(--font-mono, ui-monospace, monospace); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.linkrowEmpty .linkrowVal { font-style: italic; opacity: 0.6; }
.openlink { font-family: var(--font-mono, ui-monospace, monospace); font-size: 9.5px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; padding: 5px 10px; border: 1px solid #0E0C0A; border-radius: 2px; text-decoration: none; color: inherit; }
.openlink:hover { background: #0E0C0A; color: #FFF; }

/* Copy buttons */
.copybtn { font-family: var(--font-mono, ui-monospace, monospace); font-size: 9.5px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; padding: 5px 10px; border: 1px solid rgba(14,12,10,0.16); border-radius: 2px; background: transparent; cursor: pointer; }
.copybtnCopied { background: hsl(30 55% 46%); color: #FFF; border-color: hsl(30 55% 46%); }
.copybtnPrimary { border-color: #0E0C0A; }
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/dashboard test activity-row-drawer.test.tsx
```

Expected: all assertions across sections 1–6 pass.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/activity-row-drawer.tsx \
        apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/__tests__/activity-row-drawer.test.tsx \
        apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/activity.module.css
git commit -m "feat(dashboard): activity drawer v2 — evidence, hash chain, references (H4)"
```

---

### Task 7: Rewrite `activity-table.tsx` — div-grid, ARIA roles, scrollToRow

**Files:**
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/activity/components/activity-table.tsx`
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/activity/__tests__/activity-table.test.tsx`

The table is a div-grid container with `role="table"`, a `role="rowgroup"` header strip, and a `role="rowgroup"` body that hosts both rows and (when expanded) inline drawers. It owns the row-ref map and exposes a `scrollToRow(id)` to the drawer so `view previous ↓` can call back.

- [ ] **Step 1: Replace `activity-table.test.tsx` body**

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuditEntryBrowseRow } from "@switchboard/schemas";
import { ActivityTable } from "../components/activity-table";

const makeRow = (overrides: Partial<AuditEntryBrowseRow>): AuditEntryBrowseRow => ({
  id: "audit_test_x",
  eventType: "action.executed",
  timestamp: "2026-05-10T06:23:11.000Z",
  actorType: "agent",
  actorId: "agent_alex_001",
  entityType: "calendar_event",
  entityId: "cal_evt_9921",
  riskCategory: "low",
  visibilityLevel: "org",
  summary: "Booked appointment",
  snapshotKeys: [],
  redactedKeyCount: 0,
  evidencePointers: [],
  entryHash: "0xtargethash",
  previousEntryHash: null,
  envelopeId: null,
  traceId: null,
  ...overrides,
});

const NOW_MS = new Date("2026-05-10T06:30:00.000Z").getTime();

describe("ActivityTable", () => {
  it("renders ARIA grid roles: role='table', two rowgroups, columnheaders, rows", () => {
    const rows = [makeRow({ id: "a" }), makeRow({ id: "b" })];
    const { container } = render(
      <ActivityTable rows={rows} expandedId={null} onToggle={() => {}} now={NOW_MS} />,
    );
    expect(container.querySelector("[role='table']")).toBeInTheDocument();
    expect(container.querySelectorAll("[role='rowgroup']")).toHaveLength(2);
    expect(container.querySelectorAll("[role='columnheader']").length).toBeGreaterThanOrEqual(5);
    expect(container.querySelectorAll("[role='row']").length).toBeGreaterThanOrEqual(rows.length + 1);
  });

  it("renders the drawer inline when expandedId matches a row id", () => {
    const rows = [makeRow({ id: "audit_a" }), makeRow({ id: "audit_b" })];
    render(<ActivityTable rows={rows} expandedId="audit_a" onToggle={() => {}} now={NOW_MS} />);
    expect(screen.getByRole("region", { name: /audit_a/i })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /audit_b/i })).not.toBeInTheDocument();
  });

  it("calls onToggle with the row id when chevron is clicked", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const rows = [makeRow({ id: "audit_a" })];
    render(<ActivityTable rows={rows} expandedId={null} onToggle={onToggle} now={NOW_MS} />);
    await user.click(screen.getByRole("button", { name: /toggle details/i }));
    expect(onToggle).toHaveBeenCalledWith("audit_a");
  });

  it("'view previous ↓' in an expanded drawer scrolls to the predecessor row", async () => {
    const user = userEvent.setup();
    const target = makeRow({ id: "audit_target", entryHash: "0xtargethash" });
    const child = makeRow({
      id: "audit_child",
      entryHash: "0xchildhash",
      previousEntryHash: "0xtargethash",
    });
    const scrollSpy = vi.fn();
    // jsdom doesn't implement scrollIntoView — stub it on the prototype.
    Element.prototype.scrollIntoView = scrollSpy;
    render(
      <ActivityTable
        rows={[target, child]}
        expandedId="audit_child"
        onToggle={() => {}}
        now={NOW_MS}
      />,
    );
    await user.click(screen.getByRole("button", { name: /view previous/i }));
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/dashboard test activity-table.test.tsx
```

Expected: existing `<table>`-based v1 fails — different markup shape.

- [ ] **Step 3: Rewrite `activity-table.tsx`**

Replace the entire file with:

```tsx
"use client";

import { useRef } from "react";
import type { AuditEntryBrowseRow } from "@switchboard/schemas";
import styles from "../activity.module.css";
import { ActivityRow } from "./activity-row.js";
import { ActivityRowDrawer } from "./activity-row-drawer.js";

export interface ActivityTableProps {
  rows: AuditEntryBrowseRow[];
  expandedId: string | null;
  onToggle: (id: string) => void;
  /** Wall-clock anchor in ms for row relative-time. */
  now: number;
  /** Row id to flash after a scroll, if any (1.6s amber-paper). */
  targetId?: string | null;
  orgTimezone?: string;
}

/**
 * Div-grid table for /activity rows. Explicit ARIA grid roles per spec §5.3.
 *
 * Owns the row-ref map and exposes a scrollToRow function to the drawer for
 * "view previous ↓".
 */
export function ActivityTable({
  rows,
  expandedId,
  onToggle,
  now,
  targetId,
  orgTimezone,
}: ActivityTableProps) {
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  function scrollToRow(id: string) {
    const el = rowRefs.current[id];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div role="table" aria-label="Activity entries" className={styles.tableWrap}>
      <div role="rowgroup">
        <div role="row" className={styles.tableHead}>
          <span role="columnheader" className={styles.tableHeadCol}>
            Time
          </span>
          <span role="columnheader" className={styles.tableHeadCol}>
            Event
          </span>
          <span role="columnheader" className={styles.tableHeadCol}>
            Actor
          </span>
          <span role="columnheader" className={styles.tableHeadCol}>
            Entity
          </span>
          <span role="columnheader" className={styles.tableHeadCol}>
            Summary
          </span>
          <span role="columnheader" className={styles.tableHeadCol} aria-hidden="true">
            ·
          </span>
        </div>
      </div>
      <div role="rowgroup">
        {rows.map((row) => (
          <RowAndDrawer
            key={row.id}
            row={row}
            rows={rows}
            isOpen={expandedId === row.id}
            isTarget={targetId === row.id}
            onToggle={onToggle}
            onScrollToRow={scrollToRow}
            now={now}
            rowRef={(el) => {
              rowRefs.current[row.id] = el;
            }}
            orgTimezone={orgTimezone}
          />
        ))}
      </div>
    </div>
  );
}

function RowAndDrawer({
  row,
  rows,
  isOpen,
  isTarget,
  onToggle,
  onScrollToRow,
  now,
  rowRef,
  orgTimezone,
}: {
  row: AuditEntryBrowseRow;
  rows: AuditEntryBrowseRow[];
  isOpen: boolean;
  isTarget: boolean;
  onToggle: (id: string) => void;
  onScrollToRow: (id: string) => void;
  now: number;
  rowRef: (el: HTMLDivElement | null) => void;
  orgTimezone?: string;
}) {
  return (
    <>
      <ActivityRow
        row={row}
        isOpen={isOpen}
        isTarget={isTarget}
        onToggle={onToggle}
        now={now}
        rowRef={rowRef}
        orgTimezone={orgTimezone}
      />
      {isOpen && (
        <ActivityRowDrawer
          row={row}
          allRows={rows}
          onScrollToRow={onScrollToRow}
          orgTimezone={orgTimezone}
        />
      )}
    </>
  );
}
```

- [ ] **Step 4: Add the matching CSS classes**

Append to `activity.module.css`:

```css
/* Activity v2 table shell */
.tableWrap { max-width: 74rem; margin: 0 auto; padding: 22px 28px 16px; }
.tableHead { display: grid; grid-template-columns: 96px minmax(180px,220px) minmax(150px,180px) minmax(150px,180px) 1fr 24px; gap: 14px; align-items: end; padding: 0 12px 10px 14px; border-bottom: 1px solid #0E0C0A; }
.tableHeadCol { font-family: var(--font-mono, ui-monospace, monospace); font-size: 10px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; opacity: 0.6; }
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/dashboard test activity-table.test.tsx
```

Expected: all assertions pass.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/activity-table.tsx \
        apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/__tests__/activity-table.test.tsx \
        apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/activity.module.css
git commit -m "feat(dashboard): activity-table v2 — div-grid, ARIA roles, scrollToRow"
```

---

### Task 8: Rewrite `header.tsx` — editorial topbar + plain Audit log + single tile

**Files:**
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/activity/components/header.tsx`
- Create: `apps/dashboard/src/app/(auth)/(mercury)/activity/components/__tests__/header.test.tsx`

In PR-A there is no narrowing yet (filter chips are unchanged), so the `last ledger entry` tile is always visible. The tile's value derives from `rows[0].timestamp` when rows are present, otherwise the tile hides. The narrowing-aware hide-when-`appliedFilters` lands in PR-B.

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/app/(auth)/(mercury)/activity/components/__tests__/header.test.tsx`:

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActivityHeader } from "../header.js";

describe("ActivityHeader", () => {
  it("renders the page title as plain 'Audit log' (no italic accent)", () => {
    const { container } = render(<ActivityHeader lastLedgerEntryIso={null} />);
    const title = screen.getByRole("heading", { level: 1 });
    expect(title).toHaveTextContent("Audit log");
    // The title element itself contains no <em> or <i>.
    expect(title.querySelector("em")).toBeNull();
    expect(title.querySelector("i")).toBeNull();
    // No element inside the page-head carries the editorial-italic class.
    expect(container.querySelector("[data-accent='italic']")).toBeNull();
  });

  it("renders the eyebrow 'Mercury Tools · /activity'", () => {
    render(<ActivityHeader lastLedgerEntryIso={null} />);
    expect(screen.getByText(/Mercury Tools · \/activity/)).toBeInTheDocument();
  });

  it("renders the prose subhead about default operational scope", () => {
    render(<ActivityHeader lastLedgerEntryIso={null} />);
    expect(
      screen.getByText(/By default this shows the operator-visible actions/),
    ).toBeInTheDocument();
  });

  it("renders the last ledger entry tile when lastLedgerEntryIso is set", () => {
    render(<ActivityHeader lastLedgerEntryIso="2026-05-10T06:23:11.000Z" />);
    expect(screen.getByText(/last ledger entry/i)).toBeInTheDocument();
    expect(screen.getByText(/chain head/i)).toBeInTheDocument();
  });

  it("hides the last ledger entry tile when lastLedgerEntryIso is null", () => {
    render(<ActivityHeader lastLedgerEntryIso={null} />);
    expect(screen.queryByText(/last ledger entry/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/dashboard test header.test.tsx
```

Expected: header is the v1 shape, no Audit log heading, no eyebrow.

- [ ] **Step 3: Rewrite `header.tsx`**

Replace the entire file with:

```tsx
"use client";

import styles from "../activity.module.css";
import { fmtRel } from "./format.js";

export interface ActivityHeaderProps {
  /** ISO timestamp of the most recent ledger entry available to the page (typically rows[0].timestamp).
   *  Null hides the tile. PR-B extends this with a narrowing-aware override. */
  lastLedgerEntryIso: string | null;
}

export function ActivityHeader({ lastLedgerEntryIso }: ActivityHeaderProps) {
  const lastRel = lastLedgerEntryIso
    ? fmtRel(Date.now() - new Date(lastLedgerEntryIso).getTime())
    : null;

  return (
    <header className={styles.pageHeadWrap}>
      <div className={styles.pageHead}>
        <div className={styles.pageHeadLead}>
          <span className={styles.eyebrow}>Mercury Tools · /activity</span>
          <h1 className={styles.pageTitle}>Audit log</h1>
          <p className={styles.pageSub}>
            Every mutation by every actor — user, agent, service account, system — lands here,
            hash-chained. By default this shows the operator-visible actions; switch to All to
            inspect the full audit vocabulary.
          </p>
        </div>
        {lastRel !== null && (
          <div className={styles.pageMeta}>
            <div className={styles.statTile}>
              <span className={styles.eyebrow}>last ledger entry</span>
              <span className={styles.statTileV}>{lastRel}</span>
              <span className={styles.statTileSub}>chain head · verified</span>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Add the matching CSS classes**

Append to `activity.module.css`:

```css
/* Activity v2 page head */
.pageHeadWrap { background: transparent; }
.pageHead { max-width: 74rem; margin: 0 auto; padding: 36px 28px 22px; display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 32px; align-items: flex-end; }
@media (max-width: 860px) { .pageHead { grid-template-columns: 1fr; gap: 22px; } }
.pageHeadLead { min-width: 0; }
.eyebrow { font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; opacity: 0.6; display: inline-block; }
.pageTitle { font-family: var(--font-display, "Source Serif 4", serif); font-size: clamp(34px, 4.2vw, 48px); font-weight: 500; letter-spacing: -0.014em; line-height: 1.02; margin-top: 10px; }
.pageSub { font-family: var(--font-sans, "Inter", sans-serif); font-size: 14.5px; opacity: 0.7; margin-top: 12px; max-width: 44em; line-height: 1.55; }
.pageMeta { display: grid; gap: 0 36px; align-items: end; }
.statTile { display: flex; flex-direction: column; gap: 5px; min-width: 4.5rem; }
.statTileV { font-family: var(--font-mono, ui-monospace, monospace); font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; }
.statTileSub { font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; opacity: 0.6; letter-spacing: 0.02em; }
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/dashboard test header.test.tsx
```

Expected: all assertions pass.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/header.tsx \
        apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/components/__tests__/header.test.tsx \
        apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/activity.module.css
git commit -m "feat(dashboard): activity header v2 — plain Audit log + single status tile"
```

---

### Task 9: Wire the new components into `activity-page.tsx`

**Files:**
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/activity/activity-page.tsx`
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/activity/__tests__/activity-page.test.tsx`

The page entry continues to hold scope + URL + cursor state and continues to render the existing `<FilterChips />` and `<EmptyState />`. The only changes: replace `<ActivityHeader />` props, switch to the new `<ActivityTable />` shape with `now` + `expandedId`, drop the `drawerId`-based row props.

- [ ] **Step 1: Update the page test to match the new wiring**

In `__tests__/activity-page.test.tsx`, update assertions that previously looked for the v1 column-cell shape (`Audit log` heading, mono event-type column, chevron button). Run the existing test suite to see which assertions break, fix them to match the v2 API. Specifically expect:

- The heading is "Audit log" (was: "Activity").
- Chevron buttons exist with `aria-label` matching `/toggle details/i`.
- Selecting summary text does not toggle drawers (re-asserts H1 at the page level).

(The full new test list is in spec §9. Add only those that touch the page-level integration here; row-level + drawer-level tests are already covered in Tasks 4–6.)

- [ ] **Step 2: Run the failing test**

```bash
pnpm --filter @switchboard/dashboard test activity-page.test.tsx
```

Expected: assertions fail until the page is wired up.

- [ ] **Step 3: Update `activity-page.tsx`**

Find the existing return block (the `<div className={styles.activityPage}>...`) and:

1. Replace `<ActivityHeader />` with `<ActivityHeader lastLedgerEntryIso={rows[0]?.timestamp ?? null} />`.
2. Add `const [expandedId, setExpandedId] = useState<string | null>(null);` near the other useState declarations if not already present (the spec's filter-change reset effect already clears `expandedRowId`; rename it consistently to `expandedId` to match the new ActivityTable prop).
3. Replace the `<ActivityTable rows={rows} expandedRowId={…} onToggleRow={…} />` block with:

```tsx
<ActivityTable
  rows={rows}
  expandedId={expandedId}
  onToggle={(id) => setExpandedId((cur) => (cur === id ? null : id))}
  now={Date.now()}
/>
```

4. Leave `<FilterChips />`, `<EmptyState />`, `<PaginationFooter />`, and the loading/error/empty branches untouched — those are PR-B and PR-C concerns.

The full replacement block:

```tsx
return (
  <div className={styles.activityPage}>
    <ActivityHeader lastLedgerEntryIso={rows[0]?.timestamp ?? null} />

    <section className={`${styles.section} ${styles.page}`}>
      <div className={styles.toolbar}>
        <FilterChips
          scope={effectiveScope}
          onChipChange={onChipChange}
          onClearFilters={onClearFiltersPreserveScope}
        />
      </div>

      {isLoading ? (
        <div className={styles.skeletonTable} role="status" aria-label="Loading activity">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={styles.skeletonRow} />
          ))}
        </div>
      ) : isError ? (
        <EmptyState variant="filtered" onClear={() => void refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState variant={emptyVariant} onClear={hasFilters ? onResetToDefault : undefined} />
      ) : (
        <ActivityTable
          rows={rows}
          expandedId={expandedId}
          onToggle={(id) => setExpandedId((cur) => (cur === id ? null : id))}
          now={Date.now()}
        />
      )}

      {showPagination && (
        <PaginationFooter
          canGoPrev={prevCursorStack.length > 0}
          canGoNext={!!nextCursor}
          onPrev={onPrev}
          onNext={onNext}
        />
      )}
    </section>
  </div>
);
```

Drop the `titleRow` + `pageTitle` block (the new `<ActivityHeader />` carries the title).

- [ ] **Step 4: Run all activity tests**

```bash
pnpm --filter @switchboard/dashboard test 'apps/dashboard/src/app/\(auth\)/\(mercury\)/activity'
```

Expected: every test under the `/activity` directory passes.

- [ ] **Step 5: Build + typecheck the dashboard**

```bash
pnpm typecheck
pnpm --filter @switchboard/dashboard build
```

Expected: both succeed. Per `memory/feedback_dashboard_build_not_in_ci.md`, `next build` is not in CI, so this local check is the canonical guard against `.js`-extension regressions and other Next-time errors.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/activity-page.tsx \
        apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/__tests__/activity-page.test.tsx
git commit -m "feat(dashboard): wire activity v2 components into page (PR-A integration)"
```

---

### Task 10: Editorial paper tokens + final CSS pass

**Files:**
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/activity/activity.module.css`

Tasks 4–8 appended skeleton CSS classes with inlined hex values. Now consolidate them: declare the editorial paper tokens at the top of the module under `.activityPage` scope (per spec §10 #15: no edits to `globals.css`), then replace inline hex values with token references.

- [ ] **Step 1: Add the token block at the top of the CSS module**

Add at the top of `activity.module.css` (after any existing comment header):

```css
.activityPage {
  /* Editorial paper + ink palette — scoped to this surface only.
     Wave 1.5 decides whether to lift these into globals.css. Spec §10 #15. */
  --paper:        hsl(45 25% 98%);
  --paper-warm:   hsl(42 32% 95%);
  --paper-raised: #FFFFFF;
  --paper-deep:   hsl(40 22% 93%);
  --ink:          #0E0C0A;
  --ink-2:        #3A332B;
  --ink-3:        #6B6052;
  --ink-4:        #A39786;
  --ink-5:        #C8BEAE;
  --hair:        rgba(14, 12, 10, 0.08);
  --hair-soft:   rgba(14, 12, 10, 0.04);
  --hair-strong: rgba(14, 12, 10, 0.16);
  --amber:        hsl(30 55% 46%);
  --amber-deep:   hsl(30 60% 32%);
  --amber-soft:   hsl(38 70% 86%);
  --amber-paper:  hsl(42 70% 92%);

  background: var(--paper);
  color: var(--ink);
}
```

- [ ] **Step 2: Replace inline hex with token references**

Using a manual sweep (or `sed`), replace inline values added in Tasks 4–8:
- `#0E0C0A` → `var(--ink)`
- `#FFF` and `#FFFFFF` (only inside `.activityPage` rules) → `var(--paper-raised)`
- `rgba(14,12,10,0.08)` → `var(--hair)`
- `rgba(14,12,10,0.16)` → `var(--hair-strong)`
- `rgba(14,12,10,0.4)` → keep or replace with `var(--ink-3)` if visually equivalent
- `#FAF4E8` → `var(--amber-paper)`
- `#F9F4E8` → `var(--paper-warm)`
- `hsl(30 55% 46%)` → `var(--amber)`
- `#C8BEAE` → `var(--ink-5)`
- `#6B6052` → `var(--ink-3)`

Verify each replacement preserves the visual: `pnpm --filter @switchboard/dashboard dev` + open `http://localhost:3002/activity`, spot-check the rebuilt page against `docs/design-prompts/locked/switchboard/project/activity-v2/Activity.html` rendered in a browser.

- [ ] **Step 3: Re-run the full dashboard test suite**

```bash
pnpm --filter @switchboard/dashboard test
```

Expected: all activity tests still pass; no regressions in `/contacts`, `/automations`, `/reports`, or any non-activity surface (the CSS module is scoped to `/activity` and should not leak).

- [ ] **Step 4: Re-run typecheck + build**

```bash
pnpm typecheck
pnpm --filter @switchboard/dashboard build
```

Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/\(mercury\)/activity/activity.module.css
git commit -m "style(dashboard): activity v2 — editorial paper tokens (scoped, no globals.css)"
```

---

### Task 11: Lint + final guard pass + open PR

**Files:**
- None (verification + PR open).

- [ ] **Step 1: Typecheck, test, build (real gates — `pnpm lint` is stubbed for dashboard)**

The dashboard's `lint` script is a stub that echoes a deprecation message and exits 0 (see `apps/dashboard/package.json:scripts.lint` — Next 16 deprecated `next lint`). It is not a real gate. The three commands below are the real gates:

```bash
pnpm typecheck                              # schemas + db build then tsc --noEmit
pnpm --filter @switchboard/dashboard test   # vitest run, all dashboard tests
pnpm --filter @switchboard/dashboard build  # next build — NOT in CI, must run locally
```

Expected: all three succeed. If any fail, fix in place and add the fix as an additional commit (do not amend). The `build` step is the canonical guard against `.js`-extension regressions (per `memory/feedback_dashboard_build_not_in_ci.md`).

- [ ] **Step 2: Verify hard invariants by manual UI walk**

```bash
pnpm --filter @switchboard/dashboard dev
```

Open `http://localhost:3002/activity` in a browser. Confirm by hand:

- **H1.** Drag-select an id out of a summary cell — the row does NOT toggle. Click the chevron — the row toggles. Tab to a chevron, press Enter — the row toggles. (Manual; the test suite already automates H1 via the `activity-row.test.tsx` regression guard.)
- **H2.** Expand a row, inspect-element on the drawer, search for `storageRef` — zero matches.
- **H3.** Inspect-element on the snapshot section — only key names appear; no ids, no SGD figures, no email addresses.
- **H4.** Open browser dev tools → Application → Site Settings → block clipboard access. Reload, expand a row, click `copy hash` — the button flashes "copied" without an error in the console.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin feat/activity-rebuild-pr-a-table-drawer
```

- [ ] **Step 4: Open the PR**

```bash
gh pr create --base main --title "feat(dashboard): /activity rebuild PR-A — table + drawer" --body "$(cat <<'EOF'
## Summary

PR-A of three (see spec §13). Ships the forensic core of the /activity rebuild:
editorial header with plain Audit log title, div-grid table with ARIA roles
and chevron-only interactivity (H1), sectioned drawer with snapshot key chips,
evidence rows with copy-hash (H2 absence note), hash chain with view-previous
↓ scroll, and envelope/trace cross-links with copy + open. Backend is frozen.

Filter chips and empty/error states are unchanged in this PR — PR-B replaces
the filter strip, PR-C swaps the error to a non-unmounting banner.

## Hard invariants introduced

- H1 — row body is non-interactive; chevron is the only button.
- H2 — storageRef is never rendered.
- H3 — snapshot values are never rendered.
- H4 — copy buttons never throw.

## Test plan

- [ ] Activity tests pass (`pnpm --filter @switchboard/dashboard test`)
- [ ] Dashboard builds (`pnpm --filter @switchboard/dashboard build`) — note CI does not run `next build`.
- [ ] Manual H1–H4 walk per plan Task 11 Step 2.
- [ ] Visual diff against locked design at `docs/design-prompts/locked/switchboard/project/activity-v2/Activity.html`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Verify the PR was created**

```bash
gh pr view --web
```

Confirm the PR body is intact, the diff is sized appropriately (10–12 commits, ~1500–2000 line change), and the title and body match.

---

## Self-review

After all 11 tasks land:

1. **Spec coverage:** Every PR-A item in spec §13 maps to a task:
   - Editorial header → Task 8.
   - Div-grid table + ARIA roles → Task 7.
   - Chevron-only row + risk hairline + actor glyph + band-dot → Task 4.
   - Sectioned drawer (6 sections) → Tasks 5 + 6.
   - `format.ts` extension → Task 2.
   - `useCopier` hook → Task 3.
   - Fixtures v2 distribution → Task 1.
   - Editorial paper tokens declared in CSS module only → Task 10.
   - Page integration → Task 9.
   - Lint/typecheck/build gate + PR open → Task 11.

2. **Out-of-scope items deliberately untouched:** filter-chips.tsx (PR-B), empty-state.tsx (PR-C), error-banner / stale-pill / pagination-footer (PR-C), backend (frozen). No task touches these.

3. **Hard invariants** H1–H4 are introduced by PR-A and tested at the component level (Tasks 3, 4, 5, 6) and asserted manually in Task 11.

4. **Type consistency:** `ActivityRowProps`, `ActivityRowDrawerProps`, `ActivityTableProps`, `ActivityHeaderProps` are defined exactly once each. `now`, `expandedId`, `onToggle`, `orgTimezone` prop names are consistent across tasks 4 → 7 → 9.

5. **No placeholders:** every step has runnable code or commands. No "implement appropriate X" or "similar to Task N" gaps.

If any of the above fails during implementation, stop and update this plan (it's on `main`; revise via a follow-up PR rather than diverging on the implementation branch).
