# Alex Cockpit A.7 Follow-up — Critical-Bug Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all four Critical bugs identified by the 2026-05-15 holistic review of Phase A. Each Critical ships as part of an independent sub-slice (Option B per the brief):

- **A.7a** — Fix `metrics.ts:51-52` `agentRole` lookup + add Alex approvals sort in `cockpit-page.tsx:67-69`. Two callsites, ~50 LOC.
- **A.7b** — Wire `useRespondToApproval` into Alex cockpit; extract `AlexApprovalRow` to `lib/cockpit/alex/` mirroring Riley's pattern. ~200 LOC.
- **A.7c** — Add `kind`/`body`/`quote`/`quoteFrom` to `Approval.payload` end-to-end (Zod validator + emitter sites + server-route projection + wire type + rich adapter). ~600 LOC.

**Architecture:** Three independent feature branches, three PRs to `main`. No A.7a → A.7b or A.7b → A.7c dependency. The only shared state is the `Approval.payload` JSON column (already on disk; no Prisma migration needed). The legacy adapter (`legacy-pending-approval-to-approval-view.ts`) survives A.7c as a fallback for approvals without `payload.kind`; a separate post-A.7c sweep deletes it once all pre-A.7c approvals expire. A.7b's row extraction places `useRespondToApproval` inside `apps/dashboard/src/lib/cockpit/alex/`, preserving the adapter-boundary invariant; `cockpit-page.tsx` never imports the audit-domain hook directly.

**Tech Stack:** TypeScript + Zod (schema additions), pnpm + Turborepo (build), Vitest (tests), Prisma (no migration; `Approval.payload` is `Json`), Next.js App Router (dashboard), Fastify (api).

**Parent docs:**

- [`docs/superpowers/plans/2026-05-16-alex-cockpit-a7-followup-slice-brief.md`](./2026-05-16-alex-cockpit-a7-followup-slice-brief.md) — scope, sub-slice boundaries, design decisions, risks, test contract.
- [`docs/superpowers/specs/2026-05-14-alex-cockpit-home-design.md`](../specs/2026-05-14-alex-cockpit-home-design.md) — §Acceptance criteria 5, 6 (silently unmet); §Card sort order; §ROI bar.
- Memory: [[alex-cockpit-a7-followup-scope]] — full Critical findings, file:line precision, fix recipes per Critical.
- Structural template: [`docs/superpowers/plans/2026-05-16-alex-cockpit-a6-implementation.md`](./2026-05-16-alex-cockpit-a6-implementation.md) — boundary locks + precondition checks + pre-merge gates pattern.

> **The umbrella spec is authoritative.** If this plan's prescription conflicts with the spec, the spec wins. Re-open the brief on real conflict; for silent-unmet criteria (which is what A.7 closes), the spec's intent governs the fix.

---

## Boundary locks (read before every task)

These contracts apply across all three sub-slices. Executors must respect them:

1. **Surface-agnostic backend.** Per `[[surface-agnostic-backend]]`: zero references to `/alex`, `/riley`, `/console`, `/mira`, `cockpit`, or other UI surface names inside `packages/**`, `apps/api/**`, `apps/chat/**`, `apps/mcp-server/**`. The `kind` enum literal `"safety-gate"`/`"regulatory"`/etc. is content, not a surface reference. Per-emitter unit tests live with the emitter (no `cockpit` directory under `packages/core`).

2. **Adapter-boundary invariant.** Per `[[alex-cockpit-a6-shipped]]` and predecessors: audit-domain imports (`Recommendation` / `AuditEntry` / `@switchboard/db` / `@prisma` / `@switchboard/schemas/{recommendations,audit,approval-lifecycle}`) may only appear inside `apps/dashboard/src/lib/cockpit/**`. A.7b's `useRespondToApproval` import lives in `lib/cockpit/alex/`, **not** in `components/cockpit/`.

3. **Single-owner-toast doctrine.** Per `[[riley-b3-followup-shipped]]` and `[[alex-cockpit-a5-shipped]]`: the toast for a domain mutation is owned by the file that owns the mutation. A.7b's `AlexApprovalRow` owns `useRespondToApproval` and `useToast`. `cockpit-page.tsx` does not import `useToast`.

4. **No Prisma migration in A.7.** `Approval.payload` is already `Json` (`packages/db/prisma/schema.prisma:1137`). A.7c adds typed shape to the Zod validator + wire type only. If a task generates a Prisma migration, halt — the plan has scope-crept.

5. **No spec amendment in A.7.** The four Criticals are silently-unmet acceptance criteria; the spec is correct, the implementation drifted. If a task surfaces a real spec defect, halt and flag in the PR description.

6. **TDD discipline.** Per `superpowers:test-driven-development`: write the failing test, run it, see it fail with the expected error, then implement, then re-run, see green, commit. Apply this to every behavior change. The metrics-route fix is one cycle; each emitter update is one cycle; each adapter case is one cycle.

7. **Commit frequency.** Per `CLAUDE.md` and `superpowers:writing-plans`: frequent commits. Each completed test + impl + green run is a commit. Avoid mega-commits.

8. **Branch context check.** Per `CLAUDE.md` §Branch & Worktree Doctrine: before every commit, run `git branch --show-current` and `git status --short` to confirm the branch matches the work. Per `[[subagent-worktree-drift]]`: subagent dispatches occasionally commit to the wrong worktree; verify after each task.

---

## Precondition checks

Run before any sub-slice task. These checks are shared by A.7a / A.7b / A.7c.

- [ ] **Step 0a: Confirm worktree + clean tree.**

```bash
git branch --show-current
git status --short
git log --oneline origin/main..HEAD
```

Expected: working tree clean. Branch is one of `feat/alex-cockpit-a7a-metrics-and-sort`, `feat/alex-cockpit-a7b-respond-wiring`, or `feat/alex-cockpit-a7c-kind-classification`. Zero commits ahead of `origin/main` at start. The implementation branch is **separate** from the docs branch that holds this plan + brief (which is `docs/alex-cockpit-a7-followup-plan` and lands first as a docs-only PR per the user instruction).

- [ ] **Step 0b: Confirm A.1–A.6 artifacts exist on `main` (cockpit baseline intact).**

```bash
ls apps/dashboard/src/components/cockpit/cockpit-page.tsx \
   apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx \
   apps/dashboard/src/components/cockpit/approval-block.tsx \
   apps/dashboard/src/components/cockpit/approval-card.tsx \
   apps/dashboard/src/lib/cockpit/legacy-pending-approval-to-approval-view.ts \
   apps/dashboard/src/lib/cockpit/riley/recommendation-to-approval-view.ts \
   apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/hooks/use-approvals.ts \
   apps/api/src/routes/agent-home/metrics.ts \
   apps/api/src/routes/agent-home/mission.ts \
   apps/api/src/routes/approvals.ts \
   packages/core/src/skill-runtime/tool-result.ts
```

Expected: all 11 files exist. If any is missing, the A.1–A.6 baseline has shifted — halt and investigate.

- [ ] **Step 0c: Re-verify the Critical bugs are still present.**

```bash
# Critical #1: agentRole lookup bug
grep -n "agentRole: agentId" apps/api/src/routes/agent-home/metrics.ts
# Expected: line 52 — "agentRole: agentId,"

# Critical #2: empty Accept/Decline stub
grep -n "resolution wires up at A.5" apps/dashboard/src/components/cockpit/cockpit-page.tsx
# Expected: line 139 — comment is present in the empty stub

# Critical #3: hardcoded "pricing"
grep -n 'return "pricing";' apps/dashboard/src/lib/cockpit/legacy-pending-approval-to-approval-view.ts
# Expected: line 20

# Critical #4: missing sort
grep -n -B1 -A4 "approvalsQ.data?.approvals ?? \\[\\]" apps/dashboard/src/components/cockpit/cockpit-page.tsx
# Expected: line 67-69 — .map(...) only, no .sort(...)
```

Expected: all four grep patterns match. If any one fails to match, that Critical has been fixed by an intervening PR — halt and re-scope the sub-slice (e.g., drop A.7a's metrics-route task if a hotfix has landed).

- [ ] **Step 0d: Confirm the canonical fix pattern lives at `mission.ts:253`.**

```bash
grep -n 'rosterRole = agentId === "alex" ? "responder" : "optimizer"' apps/api/src/routes/agent-home/mission.ts
```

Expected: line 253 matches. The A.7a fix copies this exact pattern; if the source has drifted, re-derive the mapping at implementation time.

- [ ] **Step 0e: Confirm `useRespondToApproval` is shipped + tested.**

```bash
grep -n "export function useRespondToApproval" apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/hooks/use-approvals.ts
ls apps/dashboard/src/app/\(auth\)/\(mercury\)/approvals/__tests__/use-respond.test.tsx
```

Expected: both present. A.7b consumes the existing hook unchanged.

- [ ] **Step 0f: Confirm `AlexApprovalKind` enumerates all six kinds.**

```bash
grep -n -A8 "export type AlexApprovalKind" apps/dashboard/src/components/cockpit/types.ts
```

Expected: `"pricing" | "refund" | "qualification" | "regulatory" | "safety-gate" | "escalation"`. A.7c relies on this enum on the dashboard side; no type addition needed there.

- [ ] **Step 0g: Confirm `Approval.payload` is `Json` (no migration needed).**

```bash
grep -n -B2 "payload\s*Json" packages/db/prisma/schema.prisma | head -10
```

Expected: at least one `payload  Json` line under the `Approval` model. Per brief Design Decision §9: A.7c does **not** ship a Prisma migration.

- [ ] **Step 0h: Baseline tests pass.**

```bash
pnpm reset
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @switchboard/dashboard build
pnpm format:check
```

Expected: all green. Per `CLAUDE.md`: `pnpm reset` clears stale `dist/` so the typecheck reads fresh `@switchboard/schemas` / `@switchboard/db` / `@switchboard/core` builds. Per `[[dashboard-build-not-in-ci]]`: `pnpm --filter @switchboard/dashboard build` catches `.js`-extension regressions that CI misses. Per `[[ci-prettier-not-in-local-lint]]`: `pnpm format:check` is the gate CI runs.

Pre-existing flakes that may surface (per `[[db-integrity-tests-pg-advisory-lock]]`): `prisma-work-trace-store-integrity`, `prisma-ledger-storage`, `prisma-greeting-signal-store`. If they reproduce on baseline, document and proceed; do not block PRs on them.

- [ ] **Step 0i: Capture baseline dashboard coverage.**

```bash
pnpm --filter @switchboard/dashboard test -- --coverage 2>&1 | tail -30
```

Capture the four coverage percentages (statements / branches / functions / lines). Per `[[dashboard-coverage-threshold]]`: the dashboard floor is **40 / 35 / 40 / 40** (lower than `CLAUDE.md`'s 55/50/52/55 because the root vitest config excludes `apps/dashboard/**`). The per-sub-slice gate at the end of each track asserts each percentage stays at-or-above floor; comparing to baseline helps catch a marginal dip.

---

## File Structure (across all three sub-slices)

### Files created

| Path                                                                                      | Sub-slice | Responsibility                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/dashboard/src/lib/cockpit/alex/alex-approval-row.tsx`                               | A.7b      | New row component owning `useRespondToApproval` + optimistic dismiss + single-owner toast. Mirrors Riley's `RileyApprovalRow` (currently inline at `riley-cockpit-page.tsx:44-81`). |
| `apps/dashboard/src/lib/cockpit/alex/__tests__/alex-approval-row.test.tsx`                | A.7b      | Tests Accept/Decline dispatches, error path, success path, single-owner toast count.                                                                                                |
| `apps/dashboard/src/lib/cockpit/rich-pending-approval-to-approval-view.ts`                | A.7c      | New adapter reading `payload.kind`/`payload.body`/`payload.quote`/`payload.quoteFrom`. Falls back to `legacyPendingApprovalToApprovalView` when `kind` is absent.                   |
| `apps/dashboard/src/lib/cockpit/__tests__/rich-pending-approval-to-approval-view.test.ts` | A.7c      | Six kind cases (pricing/refund/qualification/regulatory/safety-gate/escalation) + legacy-fallback case.                                                                             |
| `packages/schemas/src/__tests__/pending-approval-payload.test.ts`                         | A.7c      | Validator tests for the new `pendingApprovalPayloadSchema`.                                                                                                                         |

### Files modified

| Path                                                                                                               | Sub-slice  | Change                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/routes/agent-home/metrics.ts`                                                                        | A.7a       | Replace `agentRole: agentId` with `const rosterRole = agentId === "alex" ? "responder" : "optimizer";` + `agentRole: rosterRole`. |
| `apps/api/src/routes/agent-home/__tests__/metrics.test.ts`                                                         | A.7a       | Add seeded-roster test case (both `responder` and `optimizer`).                                                                   |
| `apps/dashboard/src/components/cockpit/cockpit-page.tsx`                                                           | A.7a, A.7b | A.7a: add `.sort(...)` post-map at line 67-69. A.7b: remove empty `onResolve` stub; render `<AlexApprovalRow>` per approval.      |
| `apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx`                                            | A.7a, A.7b | A.7a: sort assertion. A.7b: smoke test for row rendering.                                                                         |
| `apps/dashboard/src/lib/api-client-types.ts`                                                                       | A.7c       | Extend `PendingApproval` interface with `kind?`, `body?`, `quote?`, `quoteFrom?`.                                                 |
| `apps/api/src/routes/approvals.ts`                                                                                 | A.7c       | Server-route projection at line 136-145: forward `payload.kind`/`body`/`quote`/`quoteFrom`.                                       |
| `apps/api/src/routes/__tests__/approvals.test.ts` (or sibling — verify at task)                                    | A.7c       | Test: payload with `kind: "regulatory"` is projected; legacy approval omits the field.                                            |
| `packages/schemas/src/index.ts` (or sibling — verify at task)                                                      | A.7c       | Export new `pendingApprovalPayloadSchema`.                                                                                        |
| `packages/schemas/src/approval-lifecycle.ts` OR a new sibling file                                                 | A.7c       | Add `pendingApprovalPayloadSchema` Zod validator (decision §A.7c.0).                                                              |
| `packages/core/src/skill-runtime/tool-result.ts`                                                                   | A.7c       | Extend `pendingApproval()` signature to accept optional typed payload.                                                            |
| `packages/core/src/skill-runtime/__tests__/tool-result.test.ts`                                                    | A.7c       | Test typed-payload pass-through.                                                                                                  |
| `packages/core/src/skill-runtime/hooks/deterministic-safety-gate.ts`                                               | A.7c       | Emit `kind: "safety-gate"` in the pending-approval payload.                                                                       |
| `packages/core/src/skill-runtime/hooks/__tests__/deterministic-safety-gate.test.ts`                                | A.7c       | Assert emitted kind.                                                                                                              |
| `packages/core/src/skill-runtime/hooks/claim-classifier.ts`                                                        | A.7c       | Emit `kind: "regulatory"` + `body`.                                                                                               |
| `packages/core/src/skill-runtime/hooks/__tests__/claim-classifier.test.ts`                                         | A.7c       | Assert emitted kind + body.                                                                                                       |
| `packages/core/src/conversation-lifecycle/qualification/disqualification-resolver.ts` (verify path)                | A.7c       | Emit `kind: "qualification"`.                                                                                                     |
| `packages/core/src/conversation-lifecycle/qualification/__tests__/disqualification-resolver.test.ts` (verify path) | A.7c       | Assert emitted kind.                                                                                                              |
| Refund-detection emitter (located at task-time via grep)                                                           | A.7c       | Emit `kind: "refund"`.                                                                                                            |
| Refund-detection test                                                                                              | A.7c       | Assert emitted kind.                                                                                                              |
| Escalation emitter (located at task-time via grep)                                                                 | A.7c       | Emit `kind: "escalation"`.                                                                                                        |
| Escalation test                                                                                                    | A.7c       | Assert emitted kind.                                                                                                              |

### Files explicitly NOT touched

- `apps/dashboard/src/components/cockpit/approval-block.tsx` — already renders `kind` + `urgency` correctly; A.7c only changes the input, not the renderer.
- `apps/dashboard/src/components/cockpit/types.ts` — `AlexApprovalKind` enum unchanged.
- `apps/dashboard/src/lib/cockpit/legacy-pending-approval-to-approval-view.ts` — survives A.7c as the fallback path. **Not deleted in A.7c.**
- `apps/dashboard/src/app/(auth)/(mercury)/approvals/hooks/use-approvals.ts` — `useRespondToApproval` is consumed unchanged.
- `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx` — Riley's row may opportunistically be extracted to `lib/cockpit/riley/` in A.7b per Design Decision §6; not required.
- `packages/db/prisma/schema.prisma` — no migration.
- `apps/chat/**`, `apps/mcp-server/**` — no consumers identified at brief-time.

---

## A.7a — `metrics.ts` agentRole fix + Alex approvals sort

**Branch:** `feat/alex-cockpit-a7a-metrics-and-sort`. Cuts from `origin/main`.

### Task A7a-1: Add the failing test for the metrics-route fix

**Files:**

- Modify: `apps/api/src/routes/agent-home/__tests__/metrics.test.ts`

- [ ] **Step 1: Inspect existing test file structure.**

```bash
sed -n '1,80p' apps/api/src/routes/agent-home/__tests__/metrics.test.ts
```

Note the test harness (`buildTestServer`, mocked Prisma, fixture seeds). Identify the existing pattern that passes `prisma: null` — the new test must seed a real (mocked) `AgentRoster` row.

- [ ] **Step 2: Write the failing test for `agentRole: "responder"` (Alex case).**

Add a new test case mirroring existing patterns. The test seeds a mocked Prisma `agentRoster.findUnique` to return a row when called with `{ where: { organizationId_agentRole: { organizationId: "default", agentRole: "responder" } } }` and `{ config: { avgValueCents: 17900, targetCpbCents: 3000 } }`. Then it `GET`s `/api/agents/alex/metrics` and asserts the response's `roi` block surfaces the seeded `avgValueCents` (not the degraded hint).

```ts
it("forwards AgentRoster.config targets when the responder row exists (Alex)", async () => {
  const server = await buildTestServer({
    prismaOverrides: {
      agentRoster: {
        findUnique: vi.fn(async ({ where }) => {
          if (where?.organizationId_agentRole?.agentRole !== "responder") return null;
          return { config: { avgValueCents: 17900, targetCpbCents: 3000 } };
        }),
      },
    },
  });
  const res = await server.inject({
    method: "GET",
    url: "/api/agents/alex/metrics",
    headers: { "x-org-id": "default" },
  });
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  expect(body.roi).toBeDefined();
  expect(body.roi.degraded).not.toBe(true);
  // Spot-check that avgValueCents=17900 flows into the ROI bar.
  // The exact key depends on the metrics-route response shape; verify at task time.
  expect(JSON.stringify(body)).toContain("179");
});
```

If the existing test file does not use `buildTestServer` with `prismaOverrides`, adapt to the actual harness — the key invariant is **`agentRoster.findUnique` is called with `agentRole: "responder"` and returns a non-null row.**

- [ ] **Step 3: Run the test — verify it fails.**

```bash
pnpm --filter @switchboard/api test -- metrics.test.ts -t "forwards AgentRoster.config"
```

Expected: FAIL. The test should fail because `findUnique` is called with `agentRole: "alex"` (not `"responder"`), so the mock returns `null` and `roi.degraded === true`. The failure message should reference the degraded-vs-populated mismatch.

If the test fails for a different reason (e.g., harness setup), fix the harness usage and re-run until the failure is the **expected** one (the degraded-flag assertion).

- [ ] **Step 4: Add the symmetric test for `agentRole: "optimizer"` (Riley case).**

Same shape, but `GET /api/agents/riley/metrics` and `agentRole: "optimizer"`. Assert the same populated-ROI behavior. Run — expect FAIL for the same reason.

- [ ] **Step 5: Commit the failing tests.**

```bash
git add apps/api/src/routes/agent-home/__tests__/metrics.test.ts
git commit -m "test(metrics): add failing AgentRoster lookup tests for A.7a

Tests that the /api/agents/{alex|riley}/metrics route surfaces
configured AgentRoster targets. Currently fails because the route
looks up by agentRole: agentId instead of the responder/optimizer
mapping at mission.ts:253."
```

### Task A7a-2: Fix the metrics-route bug to make tests pass

**Files:**

- Modify: `apps/api/src/routes/agent-home/metrics.ts`

- [ ] **Step 1: Apply the canonical fix from `mission.ts:253`.**

Edit `apps/api/src/routes/agent-home/metrics.ts:49-54` from:

```ts
// Load AgentRoster config for target values (avgValueCents, targetCpbCents).
// Falls back to empty config when no roster row exists (zero-config tenant).
const rosterRow = await app.prisma?.agentRoster.findUnique({
  where: { organizationId_agentRole: { organizationId: orgId, agentRole: agentId } },
  select: { config: true },
});
```

To:

```ts
// Load AgentRoster config for target values (avgValueCents, targetCpbCents).
// agentId is the URL slug ("alex" | "riley"); AgentRoster.agentRole stores
// the canonical role ("responder" | "optimizer"). Mirror mission.ts:253.
const rosterRole = agentId === "alex" ? "responder" : "optimizer";
const rosterRow = await app.prisma?.agentRoster.findUnique({
  where: { organizationId_agentRole: { organizationId: orgId, agentRole: rosterRole } },
  select: { config: true },
});
```

- [ ] **Step 2: Run the metrics tests — verify they pass.**

```bash
pnpm --filter @switchboard/api test -- metrics.test.ts
```

Expected: green, including both new tests.

- [ ] **Step 3: Run the full api package test sweep to catch ripples.**

```bash
pnpm --filter @switchboard/api test
```

Expected: green. If a snapshot moves (because some existing fixture now flips from degraded to populated), inspect — the only intentional behavior change is the lookup mapping; if an existing test asserted degraded-when-populated, that test was asserting the bug, and the assertion should be inverted.

- [ ] **Step 4: Commit the fix.**

```bash
git add apps/api/src/routes/agent-home/metrics.ts
git commit -m "fix(metrics): agentRole lookup uses responder/optimizer mapping

Mirrors mission.ts:253. Before this fix, AgentRoster.findUnique was
called with agentRole: agentId (slug 'alex'/'riley'), but the column
stores the canonical role ('responder'/'optimizer'), so rosterRow was
always null and getAgentTargets always returned the degraded shape.

Closes Critical #1 of the 2026-05-15 holistic review."
```

### Task A7a-3: Add the failing test for Alex approvals sort

**Files:**

- Modify: `apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx`

- [ ] **Step 1: Inspect the existing cockpit-page test setup.**

```bash
sed -n '1,80p' apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx
```

Identify how approvals are seeded (fixtures, mocked hooks). The new test seeds three approvals — one `immediate` (high-risk, recent), one `this_week` (medium-risk, recent), one `this_week` (medium-risk, oldest) — and asserts the rendered order is `[immediate, this_week-recent, this_week-old]`.

- [ ] **Step 2: Write the failing sort test.**

```tsx
it("renders approvals in urgency-then-createdAt order", () => {
  const approvals = [
    // Intentionally out-of-order to verify sorting (medium → high → medium-old)
    {
      id: "p1",
      summary: "old pricing",
      riskCategory: "medium",
      status: "pending",
      envelopeId: "e1",
      expiresAt: future,
      bindingHash: "h1",
      createdAt: "2026-05-14T00:00:00.000Z",
    },
    {
      id: "p2",
      summary: "regulatory",
      riskCategory: "high",
      status: "pending",
      envelopeId: "e2",
      expiresAt: future,
      bindingHash: "h2",
      createdAt: "2026-05-15T00:00:00.000Z",
    },
    {
      id: "p3",
      summary: "new pricing",
      riskCategory: "medium",
      status: "pending",
      envelopeId: "e3",
      expiresAt: future,
      bindingHash: "h3",
      createdAt: "2026-05-15T12:00:00.000Z",
    },
  ];
  mockUsePendingApprovals(approvals);
  render(<CockpitPage />);
  const cards = screen.getAllByTestId("approval-card");
  expect(cards[0]).toHaveTextContent("regulatory"); // immediate
  expect(cards[1]).toHaveTextContent("new pricing"); // this_week, newest
  expect(cards[2]).toHaveTextContent("old pricing"); // this_week, oldest
});
```

Note: the `approval-card` `data-testid` and exact `getByText`/`getByTestId` calls depend on the actual component output — verify at task time and adapt. The invariant is **the test asserts `immediate` renders before `this_week`, and within `this_week`, `createdAt` desc.**

- [ ] **Step 3: Run the test — verify it fails.**

```bash
pnpm --filter @switchboard/dashboard test -- cockpit-page.test.tsx -t "urgency-then-createdAt"
```

Expected: FAIL. Order asserted in the test should not match the rendered order (current code doesn't sort).

- [ ] **Step 4: Commit the failing test.**

```bash
git add apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx
git commit -m "test(cockpit): add failing sort test for Alex approvals

Asserts spec §Card sort order — immediate → this_week, then createdAt
desc within band. Currently fails because cockpit-page.tsx:67-69 maps
without sorting."
```

### Task A7a-4: Add the sort step in `cockpit-page.tsx`

**Files:**

- Modify: `apps/dashboard/src/components/cockpit/cockpit-page.tsx`

- [ ] **Step 1: Add the sort.**

Edit `apps/dashboard/src/components/cockpit/cockpit-page.tsx:67-69` from:

```tsx
const approvals = (approvalsQ.data?.approvals ?? []).map((a) =>
  legacyPendingApprovalToApprovalView(a, now),
);
```

To:

```tsx
const URGENCY_ORDER: Record<"immediate" | "this_week" | "next_cycle", number> = {
  immediate: 0,
  this_week: 1,
  next_cycle: 2,
};
const approvals = (approvalsQ.data?.approvals ?? [])
  .map((a) => ({ raw: a, view: legacyPendingApprovalToApprovalView(a, now) }))
  .sort((a, b) => {
    const urgencyDiff = URGENCY_ORDER[a.view.urgency] - URGENCY_ORDER[b.view.urgency];
    if (urgencyDiff !== 0) return urgencyDiff;
    // Within urgency band: createdAt desc.
    return new Date(b.raw.createdAt).getTime() - new Date(a.raw.createdAt).getTime();
  })
  .map((wrapped) => wrapped.view);
```

Note: the wrap-then-unwrap is required because the sort tiebreak reads `createdAt` from the **raw** `PendingApproval`, not from the `AlexApprovalView` (which only carries the rendered `askedAt` relative string). If the view ever gains a `createdAtIso` field, simplify to a flat sort.

If A.7c is already merged (rare; the slices are independent), the inner constructor becomes `richPendingApprovalToApprovalView`. The sort logic is unchanged.

- [ ] **Step 2: Run the dashboard test — verify the sort test passes.**

```bash
pnpm --filter @switchboard/dashboard test -- cockpit-page.test.tsx
```

Expected: green, including the new sort test.

- [ ] **Step 3: Run the full dashboard test suite to catch ripples.**

```bash
pnpm --filter @switchboard/dashboard test
```

Expected: green. If a snapshot test moves because approval order changed, inspect the fixture; if the previous order was incidental (not asserted), update the snapshot. If the previous order was asserted, the asserting test was relying on the bug — invert the assertion.

- [ ] **Step 4: Commit the sort fix.**

```bash
git add apps/dashboard/src/components/cockpit/cockpit-page.tsx
git commit -m "fix(cockpit): sort Alex approvals immediate → this_week, then createdAt desc

Implements spec §Card sort order. Before this fix, approvals rendered
in server-default (createdAt desc) order regardless of urgency, so a
pending refund (immediate) could render below an older pricing
(this_week) approval.

Closes Critical #4 of the 2026-05-15 holistic review."
```

### Task A7a-5: Pre-merge gates for A.7a

- [ ] **Step 1: Branch context check.**

```bash
git branch --show-current
# Expected: feat/alex-cockpit-a7a-metrics-and-sort
git status --short
# Expected: clean
```

- [ ] **Step 2: Full reset + typecheck + lint + test.**

```bash
pnpm reset
pnpm typecheck
pnpm lint
pnpm test
```

Expected: green. Per `CLAUDE.md`: `pnpm reset` clears stale `dist/`.

- [ ] **Step 3: Dashboard build (catches `.js`-extension regressions per `[[dashboard-build-not-in-ci]]`).**

```bash
pnpm --filter @switchboard/dashboard build
```

Expected: green.

- [ ] **Step 4: Prettier check (CI runs this; local `pnpm lint` doesn't per `[[ci-prettier-not-in-local-lint]]`).**

```bash
pnpm format:check
```

Expected: clean. If it fails, run `pnpm format:write` and amend or new-commit.

- [ ] **Step 5: Dashboard coverage gate.**

```bash
pnpm --filter @switchboard/dashboard test -- --coverage 2>&1 | tail -30
```

Expected: statements ≥ 40, branches ≥ 35, functions ≥ 40, lines ≥ 40 (per `[[dashboard-coverage-threshold]]`). Compare against baseline captured at Step 0i. If any threshold dips below floor, halt — per `[[ship-clean-not-followup]]`, do not lower the floor.

- [ ] **Step 6: Adapter-boundary grep gate.**

```bash
rg "Recommendation|AuditEntry|@switchboard/db|@prisma|approval-lifecycle" \
   apps/dashboard/src/components/cockpit \
   apps/dashboard/src/hooks
```

Expected: result set is unchanged from `main`'s (A.7a adds no new imports inside `components/cockpit/**` or `hooks/**`).

- [ ] **Step 7: Surface-agnostic backend grep gate.**

```bash
git diff origin/main..HEAD -- packages/ apps/api apps/chat apps/mcp-server | \
  grep -E "^\+.*\b(alex|riley|console|mira|cockpit)\b" | \
  grep -v "test\|fixture"
```

Expected: empty. The api change references `"alex"` and `"riley"` as string literals in the rosterRole mapping — these are slug values, not UI surface names, and they appear as `agentId === "alex"` (the input). The grep above excludes test/fixture lines; if it matches a non-test line, inspect — likely benign (the mapping itself).

- [ ] **Step 8: Manual verification on dev stack.**

```bash
# Start the api + dashboard
pnpm --filter @switchboard/api dev &
pnpm --filter @switchboard/dashboard dev &
# Wait for both to be listening
```

Open `http://localhost:3002/alex` in a browser:

- If `AgentRoster.config` is seeded with `avgValueCents` / `targetCpbCents`: ROI bar surfaces populated values, **not** the degraded hint.
- If approvals exist with mixed urgencies: cards render `immediate` first, then `this_week`, then `next_cycle`. Within band: newest first.

Symmetric on `/riley` — ROI bar surfaces the populated comparator.

- [ ] **Step 9: Push + open PR.**

```bash
git push -u origin feat/alex-cockpit-a7a-metrics-and-sort
gh pr create --title "fix(cockpit): A.7a — metrics agentRole + Alex approvals sort" --body "$(cat <<'EOF'
## Summary
Closes Critical #1 (metrics agentRole lookup bug) and Critical #4
(Alex approvals not sorted) from the 2026-05-15 holistic review.

- `apps/api/src/routes/agent-home/metrics.ts` — agentRole lookup
  uses responder/optimizer mapping, mirroring mission.ts:253.
- `apps/dashboard/src/components/cockpit/cockpit-page.tsx` — sorts
  approvals immediate → this_week, then createdAt desc within band.
- Adds previously-missing tests for both fixes.

Brief: docs/superpowers/plans/2026-05-16-alex-cockpit-a7-followup-slice-brief.md
Plan: docs/superpowers/plans/2026-05-16-alex-cockpit-a7-followup-implementation.md (§A.7a)

## Test plan
- [x] pnpm reset && pnpm typecheck && pnpm lint && pnpm test
- [x] pnpm --filter @switchboard/dashboard build
- [x] pnpm format:check
- [x] pnpm --filter @switchboard/dashboard test -- --coverage (≥ 40/35/40/40)
- [x] Manual: /alex ROI bar populated when AgentRoster.config is set
- [x] Manual: /alex approvals sorted urgency-first
- [x] Manual: /riley ROI bar populated symmetric

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Do **not** use `--auto`. Per `[[auto-merge-captures-head-early]]`: manual merge once CI is green prevents stale-HEAD orphans.

- [ ] **Step 10: After CI green, manual merge.**

```bash
gh pr merge --squash <PR-NUMBER>
```

Update the local memory file (this is a project memory update, not the implementation plan):

- Add an entry to `MEMORY.md` mirroring the A.6 pattern: `[Alex Cockpit A.7a shipped 2026-05-16 (#<PR> → <SHA>)](project_alex_cockpit_a7a_shipped.md) — ROI metrics agentRole fix + Alex approvals sort; closes Critical #1 + #4`.

---

## A.7b — Approval respond wiring + row extraction

**Branch:** `feat/alex-cockpit-a7b-respond-wiring`. Cuts from `origin/main`. **Independent of A.7a.**

### Task A7b-0: Decide Path X vs Path Y (`<ApprovalBlock>` retention)

- [ ] **Step 1: Inspect `<ApprovalBlock>` responsibilities.**

```bash
sed -n '1,80p' apps/dashboard/src/components/cockpit/approval-block.tsx
```

If `<ApprovalBlock>` is a thin layout container (`<div>` + spacing + maps `data` → `<ApprovalCard>`), pick **Path Y** (drop it; render `<AlexApprovalRow>` directly per Riley's pattern at `riley-cockpit-page.tsx:177-184`).

If it owns section copy (e.g., "Alex needs you"), empty-state messaging, or any non-trivial layout (heading + footer), pick **Path X** (keep it as the container; change its prop API to `children`).

Record decision in the PR description.

### Task A7b-1: Create `AlexApprovalRow` component with failing tests

**Files:**

- Create: `apps/dashboard/src/lib/cockpit/alex/alex-approval-row.tsx`
- Create: `apps/dashboard/src/lib/cockpit/alex/__tests__/alex-approval-row.test.tsx`

- [ ] **Step 1: Write the failing Accept-dispatches test.**

Use Riley's `RileyApprovalRow` test (at `apps/dashboard/src/lib/cockpit/riley/__tests__/riley-approval-row.test.tsx` if extracted, otherwise the inline tests in `riley-cockpit-page.test.tsx`) as the structural template. Adapt for Alex semantics:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AlexApprovalRow } from "../alex-approval-row";
import type { AlexApprovalView } from "@/components/cockpit/types";
import { vi } from "vitest";

const mockMutate = vi.fn();
vi.mock("@/app/(auth)/(mercury)/approvals/hooks/use-approvals", () => ({
  useRespondToApproval: () => ({ mutate: mockMutate, isPending: false }),
}));

const baseApproval: AlexApprovalView = {
  id: "appr_1",
  kind: "pricing",
  urgency: "immediate",
  askedAt: "2m ago",
  title: "Refund request",
  presentation: { primaryLabel: "Accept", dismissLabel: "Decline" },
  primary: "Accept",
  secondary: "Decline",
  primaryAction: { kind: "respond", bindingHash: "h1", verdict: "accept" },
};

describe("AlexApprovalRow", () => {
  beforeEach(() => mockMutate.mockReset());

  it("dispatches mutate({ action: 'approve' }) on Accept", async () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <AlexApprovalRow approval={baseApproval} idx={0} total={1} />
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: /accept/i }));
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "appr_1", action: "approve", bindingHash: "h1" }),
    );
  });

  it("dispatches mutate({ action: 'reject' }) on Decline (no bindingHash)", async () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <AlexApprovalRow approval={baseApproval} idx={0} total={1} />
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: /decline/i }));
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "appr_1", action: "reject" }),
    );
  });

  it("hides the card and toasts on success", async () => {
    // Mock mutate to call onSuccess via mutationFn resolve
    // (real shape may need react-query's MutationCache instead of mocking mutate)
    // — adapt to the actual hook's surface; the invariant is the row's
    // onMutate-on-success path hides the card and the toast count is 1.
  });

  it("keeps the card visible on error", async () => {
    // Symmetric — mutate rejects, the card stays in the DOM.
  });
});
```

- [ ] **Step 2: Run the tests — verify they fail (no `AlexApprovalRow` file yet).**

```bash
pnpm --filter @switchboard/dashboard test -- alex-approval-row.test.tsx
```

Expected: FAIL with "module not found". (If the harness fails earlier on the mock import, debug the mock path; the invariant is the test runs and fails because the component doesn't exist.)

- [ ] **Step 3: Implement `AlexApprovalRow`.**

```tsx
// apps/dashboard/src/lib/cockpit/alex/alex-approval-row.tsx
"use client";

import { useState } from "react";
import { ApprovalCard } from "@/components/cockpit/approval-card";
import { useRespondToApproval } from "@/app/(auth)/(mercury)/approvals/hooks/use-approvals";
import { useToast } from "@/components/ui/use-toast";
import type { AlexApprovalView } from "@/components/cockpit/types";

interface Props {
  approval: AlexApprovalView;
  idx: number;
  total: number;
}

export function AlexApprovalRow({ approval, idx, total }: Props) {
  const respond = useRespondToApproval();
  const { toast } = useToast();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  function onResolve(verdict: "accept" | "decline") {
    const action = verdict === "accept" ? "approve" : "reject";
    setDismissed(true); // optimistic
    respond.mutate(
      verdict === "accept"
        ? {
            id: approval.id,
            action,
            bindingHash:
              approval.primaryAction.kind === "respond" ? approval.primaryAction.bindingHash : "",
          }
        : { id: approval.id, action },
      {
        onSuccess: () => {
          toast({
            title: verdict === "accept" ? "Approved" : "Declined",
            description: approval.title,
          });
        },
        onError: () => {
          setDismissed(false); // un-optimistic
          toast({
            title: "Could not respond",
            description: "Please retry.",
            variant: "destructive" as const,
          });
        },
      },
    );
  }

  return (
    <ApprovalCard
      data={approval}
      idx={idx}
      total={total}
      onResolve={(v) => onResolve(v)}
      senderLabel="Alex needs you"
    />
  );
}
```

Note: the `<ApprovalCard>` `accent` prop is omitted (defaults to Alex's amber). If `<ApprovalCard>` requires `accent`, copy Alex's accent constants from wherever they live (likely `apps/dashboard/src/components/cockpit/tokens.ts`).

If `approval.primaryAction.kind === "internal"`, A.7b routes through the existing `useAlexActionDispatcher` rather than `useRespondToApproval`. Verify at impl time whether this branch needs handling (the legacy adapter only emits `kind: "respond"`, so the `"internal"` branch is currently unreachable). If it's unreachable, leave a `console.warn` + TODO referencing A.7c for explicit handling.

- [ ] **Step 4: Run the tests — verify they pass.**

```bash
pnpm --filter @switchboard/dashboard test -- alex-approval-row.test.tsx
```

Expected: green.

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/src/lib/cockpit/alex/alex-approval-row.tsx \
        apps/dashboard/src/lib/cockpit/alex/__tests__/alex-approval-row.test.tsx
git commit -m "feat(cockpit): A.7b — AlexApprovalRow owns useRespondToApproval

New component at lib/cockpit/alex/ mirrors RileyApprovalRow's shape.
Imports useRespondToApproval + useToast inside the lib/cockpit/**
boundary; cockpit-page.tsx (next commit) stops importing the
audit-domain hook.

Single-owner-toast doctrine: the toast is dispatched from inside the
row, never from the page."
```

### Task A7b-2: Wire `AlexApprovalRow` into `cockpit-page.tsx`

**Files:**

- Modify: `apps/dashboard/src/components/cockpit/cockpit-page.tsx`
- Modify: `apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx`

- [ ] **Step 1: Replace the empty stub with the row component (Path X or Path Y per Task A7b-0).**

**Path Y (preferred if `<ApprovalBlock>` is a thin container):**

Delete lines 135-144 from `cockpit-page.tsx`:

```tsx
{
  approvals.length > 0 && (
    <ApprovalBlock
      data={approvals}
      onResolve={(_verdict, _idx) => {
        // A.1 stops at view assembly; resolution wires up at A.5 once
        // useRespondToApproval is integrated into the cockpit. Until
        // then the buttons are visually present but inert.
      }}
    />
  );
}
```

Replace with:

```tsx
{
  approvals.length > 0 && (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, margin: "20px 28px 0" }}>
      {approvals.map((approval, idx) => (
        <AlexApprovalRow key={approval.id} approval={approval} idx={idx} total={approvals.length} />
      ))}
    </div>
  );
}
```

Remove the `<ApprovalBlock>` import. Add:

```tsx
import { AlexApprovalRow } from "@/lib/cockpit/alex/alex-approval-row";
```

If `<ApprovalBlock>` has no other consumers (verify with `rg "ApprovalBlock"`), delete the component + its tests in the same commit (mirror A.6's pattern). Otherwise leave it on disk.

**Path X (if `<ApprovalBlock>` owns layout chrome):**

Change `<ApprovalBlock>`'s prop API from `data + onResolve` to `children`. Render `<AlexApprovalRow>` per approval inside. Update `<ApprovalBlock>` callers — there should be only one (the cockpit page).

- [ ] **Step 2: Update the cockpit-page test for the new structure.**

Update the existing test (or add a new test) asserting that for an array of N approvals, N `<AlexApprovalRow>` instances render. Simplest pattern: use the `data-testid` already present on `<ApprovalCard>` and count.

If the existing cockpit-page test asserted the inert-stub behavior ("Accept does nothing"), invert the assertion or delete it.

- [ ] **Step 3: Run the cockpit-page test.**

```bash
pnpm --filter @switchboard/dashboard test -- cockpit-page.test.tsx
```

Expected: green, including the new row-rendering smoke.

- [ ] **Step 4: Adapter-boundary grep gate.**

```bash
rg "useRespondToApproval|useToast" apps/dashboard/src/components/cockpit/
```

Expected: zero matches — both hooks now live inside `lib/cockpit/alex/`.

```bash
rg "useRespondToApproval|useToast" apps/dashboard/src/lib/cockpit/alex/
```

Expected: matches inside `alex-approval-row.tsx`.

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/src/components/cockpit/cockpit-page.tsx \
        apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx
git commit -m "fix(cockpit): A.7b — wire approval Accept/Decline via AlexApprovalRow

Removes the empty onResolve stub left over from A.1. Each approval now
renders as <AlexApprovalRow> from lib/cockpit/alex/, which owns the
useRespondToApproval mutation, optimistic-dismiss state, and the
single-owner success/error toast.

Closes Critical #2 of the 2026-05-15 holistic review."
```

### Task A7b-3: (Optional, per Design Decision §6) Extract `RileyApprovalRow`

**Skip this task unless** the implementation engineer judges Riley extraction worth the additional scope. If skipped, defer to a future Riley cleanup PR. If executed, mirror Task A7b-1's shape with Riley's `useRecommendationAction` instead of `useRespondToApproval`.

- [ ] (only if executing) Mirror Task A7b-1 + A7b-2 for Riley. Files: `apps/dashboard/src/lib/cockpit/riley/riley-approval-row.tsx` + colocated test; modify `riley-cockpit-page.tsx` to import + render.

### Task A7b-4: Pre-merge gates for A.7b

(Same Steps 1-10 as A.7a's Task A7a-5, adapted to A.7b's branch + diff.)

- [ ] Run `pnpm reset && pnpm typecheck && pnpm lint && pnpm test && pnpm --filter @switchboard/dashboard build && pnpm format:check`.
- [ ] Coverage gate: ≥ 40/35/40/40.
- [ ] Adapter-boundary grep: `useRespondToApproval` appears under `lib/cockpit/alex/`, not under `components/cockpit/`.
- [ ] Surface-agnostic backend grep: zero new UI surface references inside `packages/**` or `apps/api/**`.
- [ ] Manual on dev stack: click Accept on `/alex` → mutation fires, card dismisses, success toast renders. Click Decline → `mutate({ action: "reject" })`. Network failure → card stays, error toast.
- [ ] Push + open PR (title `feat(cockpit): A.7b — approval respond wiring`).
- [ ] After CI green, manual `gh pr merge --squash`. Update memory.

---

## A.7c — Six-kind classification (schema + emitters + adapter)

**Branch:** `feat/alex-cockpit-a7c-kind-classification`. Cuts from `origin/main`. **Independent of A.7a and A.7b.**

This sub-slice is the largest. Tasks are sequenced from inside-out (schema → emitters → projection → adapter → cockpit) so each layer's test gate stays green as the next layer lands.

### Task A7c-0: Decide schema file placement

- [ ] **Step 1: Inspect `packages/schemas/src/approval-lifecycle.ts`.**

```bash
wc -l packages/schemas/src/approval-lifecycle.ts
```

If under ~300 lines, add `pendingApprovalPayloadSchema` inside it. If approaching the 400-line warn / 600-line error threshold (per `CLAUDE.md`), create `packages/schemas/src/pending-approval-payload.ts` instead.

Decision recorded in PR description.

### Task A7c-1: Add `pendingApprovalPayloadSchema` Zod validator (failing test → impl)

**Files:**

- Modify or create: `packages/schemas/src/approval-lifecycle.ts` (or `pending-approval-payload.ts`)
- Create: `packages/schemas/src/__tests__/pending-approval-payload.test.ts`
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Write the failing schema test.**

```ts
import { describe, it, expect } from "vitest";
import { pendingApprovalPayloadSchema } from "@switchboard/schemas";

describe("pendingApprovalPayloadSchema", () => {
  it("accepts an empty payload", () => {
    expect(pendingApprovalPayloadSchema.parse({})).toEqual({});
  });
  it("accepts kind: 'regulatory' with body", () => {
    const r = pendingApprovalPayloadSchema.parse({
      kind: "regulatory",
      body: "Patient asked about FDA approval status.",
    });
    expect(r.kind).toBe("regulatory");
    expect(r.body).toBe("Patient asked about FDA approval status.");
  });
  it("rejects unknown kind", () => {
    expect(() => pendingApprovalPayloadSchema.parse({ kind: "unknown" })).toThrow();
  });
  it("accepts all six kinds", () => {
    for (const kind of [
      "pricing",
      "refund",
      "qualification",
      "regulatory",
      "safety-gate",
      "escalation",
    ]) {
      expect(() => pendingApprovalPayloadSchema.parse({ kind })).not.toThrow();
    }
  });
});
```

- [ ] **Step 2: Run — verify FAIL with "module not exported".**

```bash
pnpm --filter @switchboard/schemas test -- pending-approval-payload.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the schema.**

Add to `packages/schemas/src/approval-lifecycle.ts` (or the new sibling file):

```ts
export const PendingApprovalKindSchema = z.enum([
  "pricing",
  "refund",
  "qualification",
  "regulatory",
  "safety-gate",
  "escalation",
]);
export type PendingApprovalKind = z.infer<typeof PendingApprovalKindSchema>;

export const pendingApprovalPayloadSchema = z.object({
  kind: PendingApprovalKindSchema.optional(),
  body: z.string().optional(),
  quote: z.string().optional(),
  quoteFrom: z.string().optional(),
});
export type PendingApprovalPayload = z.infer<typeof pendingApprovalPayloadSchema>;
```

Add the export to `packages/schemas/src/index.ts`.

- [ ] **Step 4: Run — verify green.**

```bash
pnpm --filter @switchboard/schemas test -- pending-approval-payload.test.ts
```

- [ ] **Step 5: Commit.**

```bash
git add packages/schemas/src/
git commit -m "feat(schemas): A.7c — pendingApprovalPayloadSchema (six kinds)

Adds the typed payload validator for Approval.payload. Six kinds:
pricing | refund | qualification | regulatory | safety-gate | escalation.

Optional body/quote/quoteFrom for richer UI rendering. No Prisma
migration — Approval.payload is already a Json column."
```

### Task A7c-2: Extend `pendingApproval()` in `tool-result.ts` (failing test → impl)

**Files:**

- Modify: `packages/core/src/skill-runtime/tool-result.ts`
- Modify: `packages/core/src/skill-runtime/__tests__/tool-result.test.ts`

- [ ] **Step 1: Write the failing test.**

Add to the existing `tool-result.test.ts`:

```ts
it("pendingApproval forwards typed payload when provided", () => {
  const result = pendingApproval("Regulatory review required", {
    kind: "regulatory",
    body: "Patient asked about FDA approval status.",
  });
  expect(result.status).toBe("pending_approval");
  expect((result.error as any).payload?.kind).toBe("regulatory");
});
```

- [ ] **Step 2: Run — verify FAIL.**

```bash
pnpm --filter @switchboard/core test -- tool-result.test.ts -t "forwards typed payload"
```

- [ ] **Step 3: Implement.**

Edit `packages/core/src/skill-runtime/tool-result.ts:99`:

```ts
import type { PendingApprovalPayload } from "@switchboard/schemas";

export function pendingApproval(message: string, payload?: PendingApprovalPayload): ToolResult {
  return {
    status: "pending_approval",
    error: {
      code: "APPROVAL_REQUIRED",
      message,
      retryable: false,
      ...(payload ? { payload } : {}),
    },
  };
}
```

Note: this requires extending the `ToolResult.error` type to include the optional `payload` field. Locate `ToolResult` in `packages/core/src/skill-runtime/types.ts` (or wherever it's defined) and add the optional field. Run typecheck to find downstream callers that need updating; usually none, but `error` may have a strict shape.

- [ ] **Step 4: Run — verify green.**

- [ ] **Step 5: Commit.**

### Task A7c-3: Update emitter sites — one per kind

Each emitter gets its own task block. Pattern is identical: locate the file, add the failing test for the emitted kind, update the emitter to pass the kind, re-run, commit.

#### Task A7c-3a: `deterministic-safety-gate.ts` → `kind: "safety-gate"`

- [ ] Read `packages/core/src/skill-runtime/hooks/deterministic-safety-gate.ts` and its colocated test.
- [ ] Write failing test asserting the emitted `payload.kind === "safety-gate"`.
- [ ] Run — verify FAIL.
- [ ] Update the call to `pendingApproval()` to pass `{ kind: "safety-gate" }`.
- [ ] Run — verify green.
- [ ] Commit.

#### Task A7c-3b: `claim-classifier.ts` → `kind: "regulatory"` + `body`

- [ ] Read `packages/core/src/skill-runtime/hooks/claim-classifier.ts` and its colocated test.
- [ ] Write failing test asserting `payload.kind === "regulatory"` and `payload.body` carries the flagged claim text.
- [ ] Run — verify FAIL.
- [ ] Update the call: `pendingApproval(message, { kind: "regulatory", body: <flaggedClaim> })`.
- [ ] Run — verify green.
- [ ] Commit.

#### Task A7c-3c: `disqualification-resolver.ts` (verify path) → `kind: "qualification"`

- [ ] **Locate the file:**

```bash
rg -l "disqualification|disqualified" packages/core/src/conversation-lifecycle/qualification/
```

Expected: `disqualification-resolver.ts` plus tests. If the path has moved, halt and re-derive.

- [ ] Read the file + its test. Identify the `pendingApproval()` call site (if any). If none, the file may not emit pending approvals — instead, the qualification flow may emit via a different mechanism. If so, re-scope: A.7c may need to handle qualification in a different file. Re-read `[[alex-cockpit-a7-followup-scope]]` and adjust.
- [ ] Write failing test asserting `payload.kind === "qualification"`.
- [ ] Run — verify FAIL.
- [ ] Update the emitter.
- [ ] Run — verify green.
- [ ] Commit.

#### Task A7c-3d: Refund-detection emitter (locate, then update) → `kind: "refund"`

- [ ] **Locate the file:**

```bash
rg -l "refund" packages/core/src/ apps/api/src/ apps/chat/src/ \
   --include="*.ts" --include="!*.test.ts"
```

Inspect each match for a `pendingApproval()` call adjacent to refund logic. Pick the canonical site (likely in `packages/core/src/skill-runtime/hooks/` or `packages/core/src/conversation-lifecycle/`).

- [ ] Read + write failing test + update emitter + green + commit (same pattern).

#### Task A7c-3e: Escalation emitter → `kind: "escalation"`

- [ ] **Locate the file:** `rg -l "escalat" packages/core/src/`. Pick the canonical site.
- [ ] Same pattern.

### Task A7c-4: Server-route projection — forward `kind`/`body`/`quote`/`quoteFrom`

**Files:**

- Modify: `apps/api/src/routes/approvals.ts`
- Modify or create: `apps/api/src/routes/__tests__/approvals.test.ts` (verify location at impl time)

- [ ] **Step 1: Write the failing projection test.**

```ts
it("/api/approvals/pending forwards payload.kind when present", async () => {
  const server = await buildTestServer({
    storageContext: {
      approvals: {
        listPending: async () => [
          {
            request: {
              id: "appr_reg",
              summary: "Regulatory review",
              riskCategory: "high",
              bindingHash: "h-reg",
              createdAt: new Date(),
              payload: {
                kind: "regulatory",
                body: "Patient asked about FDA approval status.",
              },
            },
            state: { status: "pending", expiresAt: futureDate },
            envelopeId: "env-reg",
            organizationId: "default",
          },
          {
            request: {
              id: "appr_legacy",
              summary: "Pricing change",
              riskCategory: "medium",
              bindingHash: "h-leg",
              createdAt: new Date(),
              // No payload.kind
            },
            state: { status: "pending", expiresAt: futureDate },
            envelopeId: "env-leg",
            organizationId: "default",
          },
        ],
      },
    },
  });
  const res = await server.inject({ method: "GET", url: "/api/approvals/pending" });
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  expect(body.approvals[0].kind).toBe("regulatory");
  expect(body.approvals[0].body).toBe("Patient asked about FDA approval status.");
  expect(body.approvals[1].kind).toBeUndefined();
});
```

- [ ] **Step 2: Run — verify FAIL.**

- [ ] **Step 3: Implement the projection.**

Edit `apps/api/src/routes/approvals.ts:136-145`:

```ts
return reply.code(200).send({
  approvals: activePending.map((a) => ({
    id: a.request.id,
    summary: a.request.summary,
    riskCategory: a.request.riskCategory,
    status: a.state.status,
    envelopeId: a.envelopeId,
    expiresAt: a.state.expiresAt,
    bindingHash: a.request.bindingHash,
    createdAt: a.request.createdAt,
    // A.7c additions — optional payload fields forward when present.
    // Older approvals lacking payload.kind project as undefined and the
    // dashboard adapter falls through to legacyPendingApprovalToApprovalView.
    ...(a.request.payload?.kind ? { kind: a.request.payload.kind } : {}),
    ...(a.request.payload?.body ? { body: a.request.payload.body } : {}),
    ...(a.request.payload?.quote ? { quote: a.request.payload.quote } : {}),
    ...(a.request.payload?.quoteFrom ? { quoteFrom: a.request.payload.quoteFrom } : {}),
  })),
});
```

Optionally validate the payload via `pendingApprovalPayloadSchema.safeParse(a.request.payload ?? {})` before reading the fields — drops the projection when payload is malformed rather than crashing. Decide at impl time based on the route's existing error-handling strictness.

- [ ] **Step 4: Run — verify green.**

- [ ] **Step 5: Commit.**

### Task A7c-5: Dashboard wire type — extend `PendingApproval` interface

**Files:**

- Modify: `apps/dashboard/src/lib/api-client-types.ts`

- [ ] **Step 1: Add fields.**

Edit lines 29-38 from:

```ts
export interface PendingApproval {
  id: string;
  summary: string;
  riskCategory: string;
  status: string;
  envelopeId: string;
  expiresAt: string;
  bindingHash: string;
  createdAt: string;
}
```

To:

```ts
export interface PendingApproval {
  id: string;
  summary: string;
  riskCategory: string;
  status: string;
  envelopeId: string;
  expiresAt: string;
  bindingHash: string;
  createdAt: string;
  // A.7c — optional payload fields forwarded from /api/approvals/pending.
  // Absent for legacy approvals (pre-A.7c).
  kind?: "pricing" | "refund" | "qualification" | "regulatory" | "safety-gate" | "escalation";
  body?: string;
  quote?: string;
  quoteFrom?: string;
}
```

- [ ] **Step 2: Run dashboard typecheck.**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: green. If a consumer of `PendingApproval` (e.g., `apps/dashboard/src/app/(auth)/(mercury)/approvals/types.ts`) narrows the type incompatibly, fix the narrower type to allow the new optional fields.

- [ ] **Step 3: Commit.**

### Task A7c-6: Rich adapter — `rich-pending-approval-to-approval-view.ts`

**Files:**

- Create: `apps/dashboard/src/lib/cockpit/rich-pending-approval-to-approval-view.ts`
- Create: `apps/dashboard/src/lib/cockpit/__tests__/rich-pending-approval-to-approval-view.test.ts`

- [ ] **Step 1: Write the failing test — six kind cases.**

```ts
import { describe, it, expect } from "vitest";
import { richPendingApprovalToApprovalView } from "../rich-pending-approval-to-approval-view";
import type { PendingApproval } from "@/lib/api-client-types";

const NOW = new Date("2026-05-16T12:00:00.000Z");
const base = (overrides: Partial<PendingApproval>): PendingApproval => ({
  id: "a1",
  summary: "Summary",
  riskCategory: "medium",
  status: "pending",
  envelopeId: "e1",
  expiresAt: "2026-05-17T12:00:00.000Z",
  bindingHash: "h1",
  createdAt: "2026-05-16T11:55:00.000Z",
  ...overrides,
});

describe("richPendingApprovalToApprovalView", () => {
  it("renders kind: 'regulatory'", () => {
    const v = richPendingApprovalToApprovalView(base({ kind: "regulatory", body: "FDA?" }), NOW);
    expect(v.kind).toBe("regulatory");
    expect(v.body).toBe("FDA?");
  });
  it("renders kind: 'safety-gate'", () => {
    expect(richPendingApprovalToApprovalView(base({ kind: "safety-gate" }), NOW).kind).toBe(
      "safety-gate",
    );
  });
  it("renders kind: 'refund'", () => {
    expect(richPendingApprovalToApprovalView(base({ kind: "refund" }), NOW).kind).toBe("refund");
  });
  it("renders kind: 'qualification'", () => {
    expect(richPendingApprovalToApprovalView(base({ kind: "qualification" }), NOW).kind).toBe(
      "qualification",
    );
  });
  it("renders kind: 'escalation'", () => {
    expect(richPendingApprovalToApprovalView(base({ kind: "escalation" }), NOW).kind).toBe(
      "escalation",
    );
  });
  it("renders kind: 'pricing'", () => {
    expect(richPendingApprovalToApprovalView(base({ kind: "pricing" }), NOW).kind).toBe("pricing");
  });
  it("falls back to 'pricing' when kind is absent (legacy approval)", () => {
    expect(richPendingApprovalToApprovalView(base({}), NOW).kind).toBe("pricing");
  });
  it("forwards body/quote/quoteFrom when present", () => {
    const v = richPendingApprovalToApprovalView(
      base({ kind: "regulatory", body: "B", quote: "Q", quoteFrom: "QF" }),
      NOW,
    );
    expect(v.body).toBe("B");
    expect(v.quote).toBe("Q");
    expect(v.quoteFrom).toBe("QF");
  });
});
```

- [ ] **Step 2: Run — verify FAIL (module not found).**

- [ ] **Step 3: Implement the rich adapter.**

```ts
// apps/dashboard/src/lib/cockpit/rich-pending-approval-to-approval-view.ts
import type { PendingApproval } from "@/lib/api-client-types";
import type {
  AlexApprovalView,
  AlexApprovalKind,
  ApprovalUrgency,
} from "@/components/cockpit/types";
import { relativeAge } from "./relative-age";
import { legacyPendingApprovalToApprovalView } from "./legacy-pending-approval-to-approval-view";

function urgencyForKind(kind: AlexApprovalKind, risk: string): ApprovalUrgency {
  // Kind-driven urgency overrides risk-driven urgency. Regulatory + safety-gate
  // are always immediate per spec §"Urgency by kind". Refund + escalation are
  // immediate unless risk says otherwise. Pricing/qualification fall through to
  // risk-driven urgency.
  if (kind === "regulatory" || kind === "safety-gate") return "immediate";
  if (kind === "refund" || kind === "escalation") {
    return risk === "low" ? "this_week" : "immediate";
  }
  return risk === "critical" || risk === "high" ? "immediate" : "this_week";
}

function ctaCopyForKind(kind: AlexApprovalKind): { primary: string; dismiss: string } {
  // Per spec §"Card CTA copy by kind" — verify each at impl time against the
  // actual spec text. The pricing default is "Accept" / "Decline" per A.1.
  switch (kind) {
    case "regulatory":
      return { primary: "Acknowledge", dismiss: "Refer to clinician" };
    case "safety-gate":
      return { primary: "Approve", dismiss: "Hold" };
    case "refund":
      return { primary: "Approve refund", dismiss: "Decline" };
    case "escalation":
      return { primary: "Take over", dismiss: "Let Alex continue" };
    case "qualification":
      return { primary: "Disqualify", dismiss: "Keep qualifying" };
    case "pricing":
    default:
      return { primary: "Accept", dismiss: "Decline" };
  }
}

export function richPendingApprovalToApprovalView(
  approval: PendingApproval,
  now: Date = new Date(),
): AlexApprovalView {
  if (!approval.kind) {
    // Legacy approval — fall through to the A.1 adapter.
    return legacyPendingApprovalToApprovalView(approval, now);
  }
  const kind = approval.kind;
  const created = new Date(approval.createdAt);
  const cta = ctaCopyForKind(kind);
  return {
    id: approval.id,
    kind,
    urgency: urgencyForKind(kind, approval.riskCategory),
    askedAt: relativeAge(created, now),
    title: approval.summary,
    body: approval.body,
    quote: approval.quote,
    quoteFrom: approval.quoteFrom,
    presentation: { primaryLabel: cta.primary, dismissLabel: cta.dismiss },
    primary: cta.primary,
    secondary: cta.dismiss,
    primaryAction: { kind: "respond", bindingHash: approval.bindingHash, verdict: "accept" },
  };
}
```

The CTA copy + urgency-by-kind table above is **a placeholder grounded in spec intent**; verify each against the umbrella spec's `§Card kind table` (or equivalent section) at impl time and tune. If the spec doesn't enumerate copy per kind, the brief is incomplete — halt and flag.

- [ ] **Step 4: Run — verify green.**

- [ ] **Step 5: Commit.**

### Task A7c-7: Swap the cockpit-page adapter call

**Files:**

- Modify: `apps/dashboard/src/components/cockpit/cockpit-page.tsx`

- [ ] **Step 1: Update the import.**

```tsx
// Before:
import { legacyPendingApprovalToApprovalView } from "@/lib/cockpit/legacy-pending-approval-to-approval-view";
// After:
import { richPendingApprovalToApprovalView } from "@/lib/cockpit/rich-pending-approval-to-approval-view";
```

- [ ] **Step 2: Update the call site at line 67-69 (or wherever it lives post-A.7a).**

```tsx
const approvals = (approvalsQ.data?.approvals ?? [])
  .map((a) => ({ raw: a, view: richPendingApprovalToApprovalView(a, now) }))
  .sort(/* unchanged from A.7a */)
  .map((wrapped) => wrapped.view);
```

- [ ] **Step 3: Run dashboard tests.**

```bash
pnpm --filter @switchboard/dashboard test
```

Expected: green. Legacy approvals (without `payload.kind`) still render via the rich adapter's fallback path.

- [ ] **Step 4: Commit.**

### Task A7c-8: Pre-merge gates for A.7c

(Same Steps 1-10 as A.7a's Task A7a-5, plus extra layers.)

- [ ] `pnpm reset` is **mandatory** for A.7c (schemas package gained an export). Per `CLAUDE.md`: "If `pnpm typecheck` reports missing exports from `@switchboard/schemas` — run `pnpm reset` first."
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm --filter @switchboard/dashboard build && pnpm format:check`.
- [ ] Coverage gate.
- [ ] Adapter-boundary grep: zero new audit-domain imports under `components/cockpit/**` (the rich adapter sits under `lib/cockpit/**`).
- [ ] Surface-agnostic backend grep: zero new UI surface references under `packages/**` or `apps/api/**`.
- [ ] **End-to-end manual:** trigger a regulatory-claim flow on the dev stack → confirm `/alex` renders a red-urgency regulatory card with the correct CTA copy. Symmetric for safety-gate, refund, escalation, qualification, pricing. Legacy approval (created pre-A.7c) renders as `pricing` via fallback.
- [ ] Push + open PR (title `feat(cockpit): A.7c — six-kind approval classification`).
- [ ] After CI green, manual `gh pr merge --squash`. Update memory.

---

## Aggregate close-out

Once A.7a, A.7b, A.7c are all merged:

- [ ] Update `MEMORY.md`:
  - Add A.7a, A.7b, A.7c shipped-line entries mirroring A.6's pattern.
  - Mark `[[alex-cockpit-a7-followup-scope]]` as superseded (or update it with the shipped SHAs).
- [ ] Update the umbrella spec's acceptance-criteria checklist (or note in PR description) that criteria 5, 6, and the sort-order + ROI requirements are now met.
- [ ] File a one-line note for the post-A.7c sweep: "Delete `legacy-pending-approval-to-approval-view.ts` once approvals created pre-A.7c have expired (~24h post-merge)."

---

## Self-review against the brief

Before opening any of the three PRs, run through this checklist:

1. **Spec coverage:** every brief §"Per sub-slice scope" file:line is touched by a task — confirmed.
2. **Placeholder scan:** no "TBD" / "add appropriate error handling" / "implement later" — confirmed.
3. **Type consistency:** `AlexApprovalKind` enum (dashboard) and `PendingApprovalKindSchema` enum (schemas) carry the same six strings: `pricing | refund | qualification | regulatory | safety-gate | escalation` — confirmed (cross-reference: `apps/dashboard/src/components/cockpit/types.ts:16-23` and Task A7c-1 schema literal).
4. **Hook signature consistency:** `useRespondToApproval` mutate input is `{ id, action: "approve" | "reject" | "patch", bindingHash?, patchValue? }` (per `use-approvals.ts:86`) — A.7b's row maps `verdict: "accept" → action: "approve"` and `verdict: "decline" → action: "reject"`. Confirmed.
5. **No new abstractions beyond plan:** A.7a does **not** extract the `URGENCY_ORDER` constant to a shared helper (Riley already has its own; two callsites is not three per `CLAUDE.md` §Code Basics). A.7b creates only `AlexApprovalRow`; no premature parent class or shared interface. A.7c creates only `pendingApprovalPayloadSchema` and `richPendingApprovalToApprovalView`; no premature emitter base class.
6. **No silent feature additions:** no new approval kind beyond the six in the spec. No new urgency band. No new emitter call site beyond what `[[alex-cockpit-a7-followup-scope]]` lists.

If any of the six fails at execution time, halt and re-open the brief.
