# Tier 4: "Trust surfaces" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read [`2026-06-10-riley-remediation-00-overview.md`](./2026-06-10-riley-remediation-00-overview.md) first for the shared guardrails, the answered open decisions (esp. decision #3, remove the zombie widget), and the cross-slice integration review. They are not repeated here.

**Goal:** Make every Riley surface a real customer touches _true_. Today an Operator Chat widget sits on every authed page promising to "pause low-performing ads" and 404s on every message; the cockpit's cost-per-booked line either hides itself or divides Riley's spend by Alex's organic bookings; and the one surface that would actually earn trust, talking to the money agent, does not exist. This tier removes the lie, fixes the number, and designs the surface (it does not build it).

**Architecture:** Three independent slices. PR 4.1 deletes a dead component chain (a removal, scoped to the newly-orphaned set). PR 4.2 changes one read-model denominator from "all org bookings" to "ad-attributed bookings" and replaces a hidden line with an explicit "target not configured" state. PR 4.3 is a design document only, no code and no TDD, because a conversational Riley that can _act_ is blocked on a runtime gap (`feedback_skill_runtime_two_constraint_regimes`) that this plan deliberately does not open.

**Tech Stack:** Next.js 14 (apps/dashboard, Vitest + Testing Library, jsdom), Prisma (packages/db), `@switchboard/core` read-model (`agent-home`), Fastify (apps/api metrics route).

---

## Verified findings (this tier)

| #                              | Status    | Pinned location                                                                                                                                                                                                                                                                                                                                                                     | Plan owner           |
| ------------------------------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| D8-1                           | CONFIRMED | mount `apps/dashboard/src/app/(auth)/layout.tsx:4,22` (`OperatorChatWidget`, `HIDDEN_PATHS=[]`); chain `components/operator-chat/{operator-chat-widget,use-operator-chat,message-bubble}.tsx` -> proxy `app/api/dashboard/operator-chat/route.ts` -> client `lib/api-client/agents.ts:208-213` (`sendOperatorCommand` -> `POST /api/operator/command`, route removed in `f5299e53`) | PR 4.1 (remove)      |
| D8-3 (denominator half)        | CONFIRMED | denom `packages/core/src/agent-home/metrics-riley.ts:32-37,108` (`countBookingsCreated` = ALL org bookings, lockstep comment `:19-22`); store wiring `apps/api/src/routes/agent-home/metrics.ts:84-90`; attribution columns present `packages/db/src/stores/prisma-conversion-record-store.ts:236-240` (`type:"booked"` + `sourceCampaignId`/`sourceChannel`)                       | PR 4.2               |
| D8-3 (unconfigured-state half) | CONFIRMED | hide `apps/dashboard/src/components/agent-panel/key-result.tsx:166-170,191` (`hasRoiProof` gates on `target !== "—"`); target source `metrics-riley.ts:114-116` (`targetCpbCents` -> `targetLabel`)                                                                                                                                                                                 | PR 4.2               |
| D8-2                           | CONFIRMED | skill-mode loads alex+mira only `apps/api/src/bootstrap/skill-mode.ts:139-150`; `executorBySlug` = `["creative", composeExecutor]` only `:748`; orphan tools `apps/api/src/tools/ad-optimizer/{ads-data,ads-analytics}.ts`; orphan builders `packages/core/src/skill-runtime/builders/{ad-optimizer,ad-optimizer-interactive}.ts` (barrel-exported, no prod consumer)               | PR 4.3 (design only) |

**Cross-ref to Tier 0:** D8-3 has two halves split across tiers. **Tier 0 PR 0.4 seeds `roster.config.targetCpbCents`** (the producer half; without it the line has no target and renders "—"). **This tier (PR 4.2) fixes what the cockpit SHOWS** when that target is present (a real CAC computed against Riley's own bookings) and what it shows when it is absent (an explicit unconfigured state, not a hidden line). PR 4.2's denominator change is independent of Tier 0 and can land first; its unconfigured-state change is most visible _after_ 0.4 seeds a target, but does not depend on it.

---

## File structure (what each PR creates/modifies)

- **PR 4.1**, DELETE: `apps/dashboard/src/components/operator-chat/` (whole dir: `operator-chat-widget.tsx`, `use-operator-chat.ts`, `message-bubble.tsx`, `__tests__/operator-chat-widget.test.tsx`), `apps/dashboard/src/app/api/dashboard/operator-chat/` (whole dir: `route.ts`, `__tests__/route.test.ts`). MODIFY: `apps/dashboard/src/app/(auth)/layout.tsx` (drop import + mount), `apps/dashboard/src/lib/api-client/agents.ts` (drop `sendOperatorCommand`), `apps/dashboard/src/app/__tests__/token-governance.test.ts` (drop the now-dead `"components/operator-chat/"` residual-allowlist string). CREATE: `apps/dashboard/src/app/(auth)/__tests__/auth-layout-no-operator-chat.test.tsx` (regression guard).
- **PR 4.2**, MODIFY: `packages/core/src/agent-home/metrics-types.ts` (add `countAdAttributedBookings` to `MetricsSignalStore`), `packages/core/src/agent-home/metrics-riley.ts` (use it for the CAC denominator; emit an explicit unconfigured target), `apps/dashboard/src/components/agent-panel/key-result.tsx` (render the unconfigured state), `apps/api/src/routes/agent-home/metrics.ts` (wire the new store method), `packages/db/src/stores/prisma-conversion-record-store.ts` (add `countAdAttributedBookings`). TEST: the four co-located `*.test.ts(x)` for each.
- **PR 4.3**, CREATE: `docs/superpowers/specs/2026-06-10-conversational-riley-design.md` (design only, no code).

---

## PR 4.1: Remove the zombie Operator Chat widget (D8-1; decision #3)

**Why (decision #3):** A broken affordance on **every authed page** is anti-trust. The widget advertises "pause low-performing ads" (`operator-chat-widget.tsx:59-61`) and its empty-state copy invites it, but `sendCommand` -> proxy -> `client.sendOperatorCommand` -> `POST /api/operator/command`, and that route was **removed in `f5299e53`**. The api now only registers operator _intents_ into the IntentRegistry (`bootstrap/operator-intents.ts`), reachable through `PlatformIngress`, never as that HTTP route. So every message 404s, surfaces "Sorry, something went wrong" (`use-operator-chat.ts:52-60`), and teaches the operator the product is broken. Conversational Riley is the _right_ version of this surface, and it is PR 4.3's design item, not a reason to keep a dead single-tenant relic alive.

**The full dead chain (verified, delete top-to-bottom):**

1. Mount: `app/(auth)/layout.tsx:4` (import) + `:22` (`<OperatorChatWidget />`).
2. Widget: `components/operator-chat/operator-chat-widget.tsx` (imports `useOperatorChat`, `MessageBubble`; `HIDDEN_PATHS=[]` so it is never hidden).
3. Hook: `components/operator-chat/use-operator-chat.ts` (`fetch("/api/dashboard/operator-chat")`).
4. Bubble: `components/operator-chat/message-bubble.tsx` (only consumer is the widget; re-exports the `ChatMessage` type from the hook).
5. Proxy: `app/api/dashboard/operator-chat/route.ts` (calls `client.sendOperatorCommand`).
6. Client method: `lib/api-client/agents.ts:208-213` (`sendOperatorCommand` -> dead `/api/operator/command`).

**CAUTION, `feedback_build_typechecks_dead_files`:** deleting a module breaks `next build` if **any** on-disk file still imports it (orphans included; the build type-checks dead files). So the removal MUST be scoped to the _newly-orphaned set_ and proven by a grep that no surviving file imports any deleted symbol. The verified importer set today is exactly: the layout, the widget, the hook, the bubble, the proxy, the client, the two co-located tests, and one **string-literal** mention in `token-governance.test.ts:371` (a CSS-residual path-allowlist; a string, not an import, so it will not break the build, but it becomes dead and should be removed in the same PR).

**Files:**

- Delete: `apps/dashboard/src/components/operator-chat/` (entire directory, including `__tests__/operator-chat-widget.test.tsx`), `apps/dashboard/src/app/api/dashboard/operator-chat/` (entire directory, including `__tests__/route.test.ts`).
- Modify: `apps/dashboard/src/app/(auth)/layout.tsx`, `apps/dashboard/src/lib/api-client/agents.ts`, `apps/dashboard/src/app/__tests__/token-governance.test.ts`.
- Create: `apps/dashboard/src/app/(auth)/__tests__/auth-layout-no-operator-chat.test.tsx`.

- [ ] **Step 1: Write the failing regression test FIRST**, `app/(auth)/__tests__/auth-layout-no-operator-chat.test.tsx`. This pins the removal so a future restore re-reds. It asserts (a) the operator-chat directories are gone, and (b) no surviving source file references the dead symbols (the load-bearing build-safety check).

```tsx
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import fg from "fast-glob";

const SRC = join(__dirname, "..", "..", "..", ".."); // apps/dashboard/src

describe("operator-chat widget removal (D8-1)", () => {
  it("the operator-chat component directory is gone", () => {
    const hits = fg.sync("components/operator-chat/**/*", { cwd: SRC });
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("the operator-chat proxy route is gone", () => {
    const hits = fg.sync("app/api/dashboard/operator-chat/**/*", { cwd: SRC });
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("no surviving file imports the removed symbols (build would type-check them)", () => {
    const files = fg.sync(["**/*.ts", "**/*.tsx"], { cwd: SRC, absolute: true });
    const offenders: string[] = [];
    const FORBIDDEN =
      /OperatorChatWidget|useOperatorChat|operator-chat|sendOperatorCommand|\/api\/operator\/command/;
    for (const f of files) {
      if (f.includes("auth-layout-no-operator-chat")) continue; // this guard names them on purpose
      if (FORBIDDEN.test(readFileSync(f, "utf8"))) offenders.push(f.slice(f.indexOf("/src/") + 1));
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("the authed layout source no longer mounts the widget", () => {
    const layout = readFileSync(join(SRC, "app/(auth)/layout.tsx"), "utf8");
    expect(layout).not.toContain("OperatorChatWidget");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**, `pnpm --filter dashboard test auth-layout-no-operator-chat` -> FAIL on every assertion (the dir exists, the route exists, importers exist, the layout mounts the widget). Confirm `fast-glob` is already a dashboard dev-dep; if not, the simpler form uses `node:fs` `existsSync` on the two directories and a `readdirSync` walk for the import sweep. Do not add a dependency just for the guard.

- [ ] **Step 3: Delete the two directories**, `git rm -r apps/dashboard/src/components/operator-chat apps/dashboard/src/app/api/dashboard/operator-chat`. This removes the widget, hook, bubble, proxy, and both co-located test files (the deleted tests no longer apply; the new guard supersedes them).

- [ ] **Step 4: Drop the mount**, in `app/(auth)/layout.tsx` remove line 4 (`import { OperatorChatWidget } ...`) and line 22 (`<OperatorChatWidget />`). The surrounding `<DataModeProvider>`/`<Toaster>` tree is unchanged.

- [ ] **Step 5: Drop the client method**, in `lib/api-client/agents.ts` remove the `// Operator` comment and the `sendOperatorCommand` method (`:207-213`). Grep confirms its only caller was the now-deleted proxy route.

- [ ] **Step 6: Clean the dead residual-allowlist entry**, in `app/__tests__/token-governance.test.ts` remove `"components/operator-chat/"` from `BUILTIN_RESIDUALS` (`:371`) and trim the comment at `:363` that references "the flag-hidden operator-chat widget #825". This is hygiene: a path-allowlist for a directory that no longer exists. (It is a string literal, so leaving it would not break the build, but it would rot.)

- [ ] **Step 7: Verify the guard passes and the build type-checks**, `pnpm --filter dashboard test auth-layout-no-operator-chat` -> PASS; then `pnpm --filter dashboard test` (full dashboard suite, confirms no other test imported the chain). `next build` is the only thing that catches a missing `.js`-less import, so run `pnpm --filter dashboard build` to prove no surviving file references a deleted module (`feedback_build_typechecks_dead_files`, `feedback_dashboard_no_js_on_any_import`).

- [ ] **Step 8: Commit**, `git commit -m "fix(dashboard): remove dead operator-chat widget that 404s on every message"`

**Acceptance:** the operator-chat component dir and proxy route are gone; no surviving file references `OperatorChatWidget`/`useOperatorChat`/`sendOperatorCommand`/`/api/operator/command`; the authed layout renders without the widget; `pnpm --filter dashboard build` succeeds. **A drive-by, independent of every other PR in this plan set; ship anytime.**

---

## PR 4.2: Fix the CAC denominator and show an explicit "target not configured" state (D8-3)

**Why:** Two truth bugs in the same cockpit line.

1. **The denominator is wrong.** `metrics-riley.ts:108` computes `cac = spendCents / bookings` where `bookings = countBookingsCreated({ excludeStatuses:["cancelled"] })`, which is **every** org booking (organic + Alex's inbound + walk-ins), deliberately kept "in lockstep with Alex's booking hero" (`:19-22`). So a clinic where Alex books 40 consults organically and Riley books 2 from ads divides Riley's whole spend by 42, reporting a CAC about 20x too low. The number flatters Riley with Alex's work. The fix: divide Riley's spend by **ad-attributed** bookings, the `booked` ConversionRecords that carry ad/source attribution (`sourceCampaignId` or `sourceChannel` present). The store already filters exactly this shape for trueROAS (`prisma-conversion-record-store.ts:236-240`); we add the count sibling.

2. **The "no target" state is a hidden line, not an explicit one.** `key-result.tsx:166` gates the ROI line on `roi.comparator.target !== "—"`, and `metrics-riley.ts:116` emits `targetLabel = "—"` whenever `targetCpbCents` is null. So an un-configured org sees **nothing** where the cost-per-booked proof should be, indistinguishable from "Riley has no data." The fix: when a real CAC exists but no target is configured, render an explicit, neutral "no target set" affordance (still never green/red; Riley marks all ROI degraded by design) instead of silently dropping the line. Tier 0 PR 0.4 seeds the target so this state is the _fallback_, not the default, but it must read truthfully when an operator clears the target or for any org provisioned before 0.4.

**Files:**

- Modify: `packages/core/src/agent-home/metrics-types.ts` (add `countAdAttributedBookings` to `MetricsSignalStore`; `PerAgentBuilderInput` unchanged), `packages/core/src/agent-home/metrics-riley.ts` (denominator + unconfigured marker), `apps/dashboard/src/components/agent-panel/key-result.tsx` (render unconfigured), `apps/api/src/routes/agent-home/metrics.ts` (wire), `packages/db/src/stores/prisma-conversion-record-store.ts` (add the count method).
- Test: `packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts` (extend), `packages/core/src/agent-home/__tests__/metrics-riley.test.ts` (extend), `apps/dashboard/src/components/agent-panel/__tests__/key-result.test.tsx` (extend or create).

### 4.2a: Store, count ad-attributed booked conversions

- [ ] **Step 1: Failing store test**, extend `prisma-conversion-record-store.test.ts` (mirror its existing mocked-Prisma style; CI has no Postgres). Assert the new method counts only `booked`, `origin:"live"` records that carry attribution, and scopes the WHERE by org + window.

```ts
it("countAdAttributedBookings counts only booked+live records carrying ad attribution", async () => {
  const count = vi.fn().mockResolvedValue(3);
  const store = new PrismaConversionRecordStore({ conversionRecord: { count } } as never);
  const from = new Date("2026-05-01T00:00:00.000Z");
  const to = new Date("2026-05-08T00:00:00.000Z");

  await store.countAdAttributedBookings({ orgId: "org_1", from, to });

  expect(count).toHaveBeenCalledWith({
    where: {
      organizationId: "org_1",
      type: "booked",
      origin: "live",
      occurredAt: { gte: from, lte: to },
      OR: [{ sourceCampaignId: { not: null } }, { sourceChannel: { not: null } }],
    },
  });
});

it("returns the raw count (no organic/Alex bookings can satisfy the attribution predicate)", async () => {
  const count = vi.fn().mockResolvedValue(2);
  const store = new PrismaConversionRecordStore({ conversionRecord: { count } } as never);
  await expect(
    store.countAdAttributedBookings({
      orgId: "org_1",
      from: new Date(0),
      to: new Date(1),
    }),
  ).resolves.toBe(2);
});
```

- [ ] **Step 2: Verify fail**, `pnpm --filter @switchboard/db test prisma-conversion-record-store` -> FAIL: `countAdAttributedBookings` not a function.

- [ ] **Step 3: Implement the method** in `prisma-conversion-record-store.ts`, beside `queryBookedValueCentsByCampaign` (reuse its exact `type:"booked"` + `origin:"live"` predicate so the two stay consistent; the difference is we accept _any_ attribution axis, not only `sourceCampaignId`, because a channel-attributed booking is still Riley's):

```ts
/**
 * Count booked conversions in the window that carry ad/source attribution
 * (a present sourceCampaignId OR sourceChannel). This is Riley's CAC
 * denominator: only ad-attributed bookings, NEVER Alex's organic bookings,
 * which carry no source. `origin:"live"` excludes fixtures, matching
 * queryBookedValueCentsByCampaign. Window is closed [from, to] to match the
 * read-model's weekStart..weekEnd bounds.
 */
async countAdAttributedBookings(query: {
  orgId: string;
  from: Date;
  to: Date;
}): Promise<number> {
  return this.prisma.conversionRecord.count({
    where: {
      organizationId: query.orgId,
      type: "booked",
      origin: "live",
      occurredAt: { gte: query.from, lte: query.to },
      OR: [{ sourceCampaignId: { not: null } }, { sourceChannel: { not: null } }],
    },
  });
}
```

- [ ] **Step 4: Verify pass**, `pnpm --filter @switchboard/db test prisma-conversion-record-store` -> PASS.

### 4.2b: Read-model, use the ad-attributed denominator and emit an unconfigured marker

- [ ] **Step 5: Add the store method to the interface**, in `metrics-types.ts`, add to `MetricsSignalStore`:

```ts
countAdAttributedBookings(input: {
  orgId: string;
  from: Date;
  to: Date;
}): Promise<number>;
```

This is a producer/consumer seam: the interface (consumer) and the Prisma impl (producer, 4.2a) must agree. A `MetricsSignalStore` mock in any existing test that omits it will now fail typecheck; that is the desired pin (`feedback_per_slice_review_misses_cross_slice_seams`). Update those mocks in Step 8.

- [ ] **Step 6: Failing read-model test**, extend `metrics-riley.test.ts`. The existing `makeStore` helper returns a `MetricsSignalStore`; add `countAdAttributedBookings` to it and prove the CAC divides by THAT, not `countBookingsCreated`. The current suite (roi rules 1-4) keys CAC off `bookingsThisWeek`; the fix re-keys it off ad-attributed bookings, so add a discriminating case where the two differ:

```ts
it("CAC denominator is AD-ATTRIBUTED bookings, not all org bookings (D8-3)", async () => {
  const week = buildWeekContext(WED_NOW, TZ);
  // 42 total org bookings (Alex's organic dominate), only 2 ad-attributed to Riley.
  const store = makeStore({ leadsThisWeek: 60, bookingsThisWeek: 42 });
  (store.getMetaSpendCents as ReturnType<typeof vi.fn>).mockResolvedValue(40000); // $400
  (store.countAdAttributedBookings as ReturnType<typeof vi.fn>).mockResolvedValue(2);
  const vm = await buildRileyMetricsViewModel({
    orgId: "org-1",
    week,
    store,
    targets: { avgValueCents: null, targetCpbCents: 5000 },
  });
  // $400 / 2 ad-attributed = $200, NOT $400 / 42 which is about $10.
  expect(vm.roi).toEqual({
    degraded: true,
    degradedHint: "",
    label: "cost per booked",
    comparator: { value: "$200 per booked", target: "target $50" },
  });
});

it("zero ad-attributed bookings reads 'No bookings attributed yet' even if Alex booked organically", async () => {
  const week = buildWeekContext(WED_NOW, TZ);
  const store = makeStore({ leadsThisWeek: 60, bookingsThisWeek: 30 }); // Alex booked 30
  (store.getMetaSpendCents as ReturnType<typeof vi.fn>).mockResolvedValue(40000);
  (store.countAdAttributedBookings as ReturnType<typeof vi.fn>).mockResolvedValue(0);
  const vm = await buildRileyMetricsViewModel({
    orgId: "org-1",
    week,
    store,
    targets: { avgValueCents: null, targetCpbCents: 5000 },
  });
  expect(vm.roi).toMatchObject({ degradedHint: "No bookings attributed yet" });
});

it("real CAC but no target configured: comparator carries the value and an explicit no-target marker", async () => {
  const week = buildWeekContext(WED_NOW, TZ);
  const store = makeStore({ leadsThisWeek: 60, bookingsThisWeek: 5 });
  (store.getMetaSpendCents as ReturnType<typeof vi.fn>).mockResolvedValue(20000);
  (store.countAdAttributedBookings as ReturnType<typeof vi.fn>).mockResolvedValue(4);
  const vm = await buildRileyMetricsViewModel({
    orgId: "org-1",
    week,
    store,
    targets: { avgValueCents: null, targetCpbCents: null }, // unconfigured
  });
  // value is real ($50); target is the explicit unconfigured sentinel, not the bare "—".
  expect(vm.roi).toMatchObject({
    comparator: { value: "$50 per booked", target: "target not set" },
  });
});
```

- [ ] **Step 7: Implement in `metrics-riley.ts`:**
  - Replace the `bookingsP = store.countBookingsCreated({...})` call (`:32-37`) with `store.countAdAttributedBookings({ orgId, from: week.weekStart, to: week.weekEnd })`. Keep the destructured `bookings` name so the downstream `cac`/roi logic at `:108,139,147` is untouched.
  - **Delete the now-stale `EXCLUDE_STATUSES` constant and its lockstep comment (`:19-22`).** Riley no longer shares Alex's denominator, and leaving a "must match metrics-alex" comment that is no longer true is exactly the rot `feedback_per_slice_review_misses_cross_slice_seams` warns about. (Alex's hero is unaffected; `metrics-alex.ts` keeps its own `countBookingsCreated` call.)
  - Replace the unconfigured target sentinel: `const targetLabel = targetDollars !== null ? \`target $${targetDollars}\` : "target not set";`(was`"—"`). This makes the "no target" state explicit and lets the cockpit distinguish it from a missing value (4.2c reads it).

- [ ] **Step 8: Update every `MetricsSignalStore` mock** that the new interface method now breaks, at minimum the inline stores in `metrics-riley.test.ts` (the `makeStore` helper plus the two ad-hoc stores in the "voice divergence" block) and any Alex/Mira metrics tests that construct a bare store literal. Add `countAdAttributedBookings: vi.fn(async () => 0)` so they typecheck. **Run `pnpm --filter @switchboard/core test` AND `pnpm typecheck`**; the interface change ripples through every consumer (a `feedback_store_tightening_gate_needs_app_tests` analog).

### 4.2c: Cockpit, render the explicit unconfigured state

- [ ] **Step 9: Failing cockpit test**, `agent-panel/__tests__/key-result.test.tsx`. The component reads `roi.comparator` off the metrics hook; mock `useAgentMetrics` to return a proof result whose `roi.comparator = { value: "$50 per booked", target: "target not set" }` and assert the line renders the value AND a muted "no target set" affordance, never a blank line, never green/red. Pair it with the inverse: a real value plus real target still renders the `value · target` line as today.

```tsx
it("renders an explicit 'no target set' affordance when CAC exists but target is unconfigured", () => {
  mockMetrics("riley", {
    proof: {
      hero: { kind: "ad-leads", value: 12 },
      roi: { comparator: { value: "$50 per booked", target: "target not set" } },
    },
  });
  render(<KeyResult agentKey="riley" />);
  expect(screen.getByText(/\$50 per booked/)).toBeDefined();
  expect(screen.getByText(/no target set/i)).toBeDefined();
  // never a status color
  expect(screen.queryByText(/on target|over target/i)).toBeNull();
});

it("still renders the value-and-target line when both are present", () => {
  mockMetrics("riley", {
    proof: {
      hero: { kind: "ad-leads", value: 12 },
      roi: { comparator: { value: "$50 per booked", target: "target $40" } },
    },
  });
  render(<KeyResult agentKey="riley" />);
  expect(screen.getByText(/\$50 per booked · target \$40/)).toBeDefined();
});
```

- [ ] **Step 10: Verify fail**, `pnpm --filter dashboard test key-result`. With the new `"target not set"` sentinel the existing `hasRoiProof` gate (`:166`, which requires `target !== "—"`) now passes through, so the rendered line would read `$50 per booked · target not set`. First decide the copy, then adjust `hasRoiProof`/`rileyRoiLine` (`:166-170,191`) so: value present + `target === "target not set"` renders `{value}` on the proof line plus a separate muted `data-testid="riley-no-target"` hint reading "Set a cost-per-booked target to track Riley's efficiency"; value present + real target keeps the joined `value · target` line; value absent stays hidden (the "—" value case is still a non-render, unchanged). Keep the neutral-ink rule (the file's own `:190` comment: never green/red).

- [ ] **Step 11: Verify pass + cockpit smoke**, `pnpm --filter dashboard test key-result` -> PASS. Confirm the dashboard coverage gate (40/35/40/40, **not** CLAUDE.md's global, per `feedback_dashboard_coverage_threshold`) still holds.

### 4.2d: Wire the new store method through the metrics route

- [ ] **Step 12: Wire in `apps/api/src/routes/agent-home/metrics.ts`**, the route builds the `MetricsSignalStore` literal at `:83-102`. Add `countAdAttributedBookings: ({ orgId: o, from, to }) => conversionStore.countAdAttributedBookings({ orgId: o, from, to })`, constructing a `PrismaConversionRecordStore` (the route already reaches conversion data via `reportStores.conversions` for `countByType`; confirm whether that is a `PrismaConversionRecordStore` exposing the new method, or whether to add `new PrismaConversionRecordStore(prisma)`; reuse the existing instance if `reportStores.conversions` is one). Mira ignores it (no roster denominator); a bare `() => 0` default in any test harness without a Prisma client is fine.

- [ ] **Step 13: Run api + core + db + dashboard tests, typecheck, format**, `pnpm typecheck && pnpm --filter @switchboard/core test && pnpm --filter @switchboard/db test && pnpm --filter @switchboard/api test && pnpm --filter dashboard test`. The interface change touches three layers; the seam test (Step 6) plus a real-store unit (Step 1) pin both ends. Commit: `git commit -m "fix: riley CAC divides spend by ad-attributed bookings, shows explicit no-target state"`

**Acceptance:** Riley's cockpit CAC divides spend by ad-attributed bookings (a clinic where Alex books organically no longer flatters Riley's CAC); zero ad-attributed bookings reads "No bookings attributed yet" regardless of organic bookings; an org with a real CAC but no configured target sees an explicit "no target set" affordance, not a hidden line. **Pairs with Tier 0 PR 0.4 (which seeds `targetCpbCents`); the denominator change is independent and may land first. Integration-review seam: the new `countAdAttributedBookings` producer (Prisma) feeding the `MetricsSignalStore` consumer (read-model) is pinned by a real-store unit plus an interface-mock parity check.**

**Optional stretch (D8-4, surface per-source economics):** the store already groups booked value by `sourceCampaignId` (`queryBookedStatsByCampaign`) and exposes source axes by `sourceChannel` (`leadsBySource` shape). A follow-up could surface a per-source cost-per-booked breakdown in the cockpit (which campaign/channel earns its spend). Out of scope for this PR; noted so the data path is on record. Mark **M, post-pilot**.

---

## PR 4.3: Conversational Riley (DESIGN DOCUMENT ONLY, no code, no TDD)

> **This PR ships one markdown file and nothing else.** It is a design, deliberately not an implementation, because making Riley _act_ conversationally is blocked on a runtime gap this plan does not open. Mark it **L / post-pilot**. It deserves a real design, not a resurrected single-tenant relic (this is the right answer to the surface PR 4.1 deleted, per decision #3).

Create `docs/superpowers/specs/2026-06-10-conversational-riley-design.md` capturing the four sections below. No `- [ ]` TDD steps, no test code; a design has none until it is scoped into its own plan.

### The surface (why it is worth designing)

"Talk to the money agent" is a north-star trust surface: an operator asks Riley _in plain language_ "why did you pause the Tuesday campaign?", "what would happen if I doubled the budget on the high-intent set?", "show me what's underperforming", and Riley answers from real Meta data, with its real diagnosis, and (eventually) proposes a governed action the operator can approve in-thread. This is the affordance the deleted Operator Chat widget _gestured at_ ("pause low-performing ads") but never delivered. Done right it is the single most legible "this agent is working for me" moment in the product. Done as a single-tenant HTTP relic, it is anti-trust, which is why PR 4.1 removed the old one rather than repairing it.

### The wiring (what exists, what is missing)

Riley already has the _pieces_ of a conversational runtime; they have **zero production consumers** and are wired into nothing but their own tests and barrel exports:

- **Tools:** `apps/api/src/tools/ad-optimizer/ads-data.ts` (`createAdsDataTool`: `get-campaign-insights`, account summary, CAPI dispatch; needs an `adsClient`/`capiClient`) and `ads-analytics.ts` (`createAdsAnalyticsTool`: `diagnose`, `comparePeriods`, `analyzeFunnel`, `detectSaturation`, `analyzeCreatives`; pure functions over `@switchboard/ad-optimizer`, no deps, `effectCategory:"read"`). Both return `SkillTool`.
- **Builders:** `packages/core/src/skill-runtime/builders/ad-optimizer.ts` (`adOptimizerBuilder` + `AD_OPTIMIZER_CONTRACT`, a `BatchContextContract`) and `ad-optimizer-interactive.ts` (`adOptimizerInteractiveBuilder`). Both are exported from `builders/index.ts` but **imported by no prod code**; only the builder barrel re-exports them and their own `__tests__`.

The missing wiring, by analogy to how alex+mira are mounted in `apps/api/src/bootstrap/skill-mode.ts`:

1. **Register the skill.** There must be a `skills/riley/SKILL.md` whose frontmatter `slug` is the runtime identity that matches Riley's seeded deployment `skillSlug` (`ad-optimizer`). Today `loadSkill` is called only for `"alex"` and `"mira"` (`skill-mode.ts:139-150`); a Riley skill would join `skillsBySlug` and `registerSkillIntents`. (`feedback_skill_md_loader_traps`: dotted-triple body tokens break API boot via `validateToolReferences`; frontmatter slug is runtime identity, dir name is cosmetic. Ship a real-file loader test when this is built.)
2. **Register a Riley executor.** `executorBySlug` currently maps only `["creative", composeExecutor]` (`:748`); a conversational Riley needs its own executor entry keyed on `"ad-optimizer"` (a read-focused diagnose/explain executor, mounting `createAdsAnalyticsTool` + `createAdsDataTool` with a live `MetaAdsClient`). The default conversation executor (which alex rides) is the starting point.
3. **Mount the builder + tools.** Pass `adOptimizerBuilder`/`adOptimizerInteractiveBuilder` to the `builderRegistry` and the two ads tools to the executor's tool set, exactly as the alex/creative builders are registered today.
4. **Governance recipe.** Per `feedback_new_skill_intent_governance_recipe`: default-deny means a Riley skill needs a seeded anchored allow policy, an entitlement gate on every submit, and (for non-conversation surfaces) an `executorBySlug` entry. Tier 0's seeder already seeds Riley's deployment plus pause/handoff policies; a conversational Riley would need its _conversation_ intent seeded too.

### The hard gotcha (`feedback_skill_runtime_two_constraint_regimes`), why this is L, not M

A conversational Riley that only _reads_ (diagnose, explain, compare) is tractable: the analytics tool is `effectCategory:"read"` and the data tool's insight ops are read-only. But a conversational Riley that can **act** (pause a campaign, shift budget) collides head-on with the runtime's two-constraint-regime gap:

- **Governance `ExecutionConstraints` never reach the skill-mode executor.** The executor runs `DEFAULT_SKILL_RUNTIME_POLICY`, a parallel regime; the governance constraints object that the GovernanceGate evaluates is never plumbed into the loop.
- **`router = undefined` in skill-mode** (`skill-mode.ts` constructor). Every turn is flat Sonnet; the `ModelRouter` is built but unwired.
- **Mid-loop approval parking is structurally unrepresentable.** `modes/skill-mode.ts` has only `completed`/`failed` outcomes; a hook returning `pending_approval` mid-conversation is re-injected as tool output and the loop _continues_. There is no pause-and-resume ReAct. So a conversational Riley cannot say "I'd pause this, approve?" and actually park the action on the WorkTrace lifecycle the way the cron pause path does. Building that is a quarter-scale rebuild of the submission/parking lifecycle (the same gap Tier 5 must respect for autonomy).

**Therefore:** a _read-only_ conversational Riley (answers questions, never mutates) is a real, shippable surface that does **not** need this gap closed. An _acting_ conversational Riley (proposes and parks governed actions in-thread) is blocked on closing the mid-loop-parking gap and must follow **Tier 5** (the act-leg prerequisites). The design doc must state this fork explicitly and recommend shipping the read-only surface first.

### Test strategy (outline only, no code here)

- **Loader pin:** a real-file `loadSkill("riley", …)` test asserting the frontmatter slug equals the seeded deployment `skillSlug` (`ad-optimizer`) and that the SKILL.md body passes `validateToolReferences` at boot (`feedback_skill_md_loader_traps`).
- **Read-only executor:** an executor test (mirroring the alex/compose executor tests) that a "why is the Tuesday campaign underperforming?" turn invokes `ads-analytics.diagnose` against a fixture insight set and renders Riley's real diagnosis, with **no** mutating tool reachable (assert the tool set the executor is constructed with contains only `read` ops).
- **Governance seam:** a provisioning/seed test that the Riley _conversation_ intent is seeded allow + entitlement-gated (the `feedback_new_skill_intent_governance_recipe` default-deny check), so a fresh org can actually reach the surface.
- **Act-leg explicitly deferred:** the design names, but does NOT test, the parking path; that is Tier 5's domain. No test in the read-only slice should exercise a mutate-and-park flow, because the runtime cannot represent it yet.

**Dependency note:** PR 4.3 depends on **nothing** in this plan (it is a doc). The _implementation_ it describes depends on Tier 0 (seeded Riley deployment + a Riley conversation intent + entitlement) for the surface to be reachable, and, for the acting variant only, on **Tier 5** (mid-loop parking / act-leg guards). Ship the read-only design first; gate the acting design behind Tier 5.

- [ ] **Step 1: Write the design doc** with the four sections above. No code, no tests.
- [ ] **Step 2: Commit**, `git commit -m "docs(spec): conversational riley design (read-only first; acting blocked on tier 5)"`

**Acceptance:** a design spec exists that (a) names the surface and why it earns trust, (b) enumerates the exact existing tools/builders and the precise skill-mode wiring to mount them, (c) states the mid-loop-parking runtime gap and the read-only-vs-acting fork, and (d) outlines a test strategy without prescribing code. It explicitly defers the acting variant to Tier 5.

---

## Tier 4 dependencies & sequencing

- **PR 4.1 (widget removal):** independent of everything; a drive-by, ship anytime.
- **PR 4.2 (denominator + unconfigured state):** the denominator change is independent; the unconfigured-state change is most _visible_ after Tier 0 PR 0.4 seeds `targetCpbCents`, but does not block on it. Reads truthfully whether or not 0.4 has landed.
- **PR 4.3 (design doc):** independent (it is a doc). The implementation it describes is post-pilot and gated behind Tier 0 (reachability) and Tier 5 (acting variant).
- **No cross-PR ordering within this tier is required.** All three can land in parallel.

## Self-review (per writing-plans)

- **Spec coverage:** every Tier-4 finding maps to a PR. D8-1 -> 4.1 (full removal TDD), D8-3 denominator + unconfigured-state -> 4.2 (full TDD across store/read-model/cockpit/route), D8-2 -> 4.3 (design only, no TDD, as scoped). D8-4 is captured as a marked optional stretch on 4.2. The Tier 0 / Tier 4 split of D8-3 (seed half vs show half) is stated in the findings table and 4.2's "Why".
- **Proportional fidelity honored:** 4.1 and 4.2 carry real, runnable test code pinned to verified file:line behavior (the `makeStore` helper, the `hasRoiProof` gate, the conversion-record store predicate). 4.3 carries an interface + the runtime gotcha + a test-strategy outline and explicitly no `- [ ]` code steps.
- **Guardrails:** dashboard imports omit `.js` and only `next build` catches a missing extension (4.1 Step 7 runs the build as the removal proof, the load-bearing check for `feedback_build_typechecks_dead_files`); dashboard coverage is 40/35/40/40 (4.2 Step 11); `NEXT_PUBLIC_*` is read statically (no dynamic env introduced here). `feedback_per_slice_review_misses_cross_slice_seams` is honored by the `MetricsSignalStore` interface-mock parity pin (4.2 Steps 5-8).
- **Placeholder scan:** the only conditional is 4.2 Step 12's "confirm whether `reportStores.conversions` is already a `PrismaConversionRecordStore`", flagged as an execution-time grep, not a placeholder; the change itself is shown.
- **Type consistency:** `countAdAttributedBookings({ orgId, from, to }): Promise<number>` has the same signature in the store impl (4.2a), the `MetricsSignalStore` interface (4.2b), and the route wiring (4.2d).
- **No em-dashes** in any prose above (`feedback_no_em_dashes`); the only `—` characters remaining are inside code/string-literals (`"—"`, the cost-per-booked sentinels) that are the actual rendered values in the codebase.
- **Open risk flagged for execution:** before 4.2 Step 12, confirm the metrics route's `reportStores.conversions` exposes (or can be swapped to a `PrismaConversionRecordStore` that exposes) the new method; if `reportStores.conversions` is a narrower store type, construct `new PrismaConversionRecordStore(prisma)` directly in the route. Quick grep at execution time.
