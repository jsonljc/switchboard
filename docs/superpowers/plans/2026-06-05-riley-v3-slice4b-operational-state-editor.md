# Riley v3 Slice 4b: Operational-State Operator Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The operator can view the latest operational-state confirmation (with an honest freshness line) and record a NEW append-only confirmation, including promo/closure windows with org-timezone date conversion and an "everything still accurate" re-confirm, from the existing business-facts settings surface.

**Architecture:** A new control-plane Fastify route file (`marketplace-operational-state.ts`, GET latest + POST confirm) following the business-facts route conventions exactly; a per-endpoint Next proxy route + `SwitchboardClient` methods + a React Query hook; a sibling card section on `/settings/business-facts` built from a pure form model (tri-state dimensions, confirm-toggled interval lists) with local-date-to-instant conversion at the edge using the org timezone. Every save calls `PrismaOperationalStateStore.recordConfirmation` (INSERT-only; 4a ships no update API and 4b adds none).

**Tech Stack:** Fastify 5 (mocked-Prisma vitest, flat `__tests__`), Next.js 14 App Router proxies, TanStack Query, Radix UI primitives, `Intl.DateTimeFormat` for timezone math (no new dependency).

**Consumes:** spec `docs/superpowers/specs/2026-06-03-riley-v3-control-plane.md` (2.1 net-new paragraph, defer-list item 5 note, 7.4); roadmap `docs/superpowers/plans/2026-06-03-riley-v3-control-plane.md` (Slice 4b); the shipped 4a plan `docs/superpowers/plans/2026-06-04-riley-v3-slice4a-operational-state.md` (decisions A-D). Slices 1 (#867), 2 (#876), 3 (#886), 4a (#895, squash c19957e3) are merged and consumed as-is.

**Scope fence (4b only):** editor UI + Next proxy route + API route + tests. NO 4c consumption (zero diff under `packages/ad-optimizer` and `packages/core/src/recommendations`; `RevenueState.businessContextFreshness` stays `"unknown"`, `businessContextStable` stays `"unknown"`, `corroborated` stays never-emitted). NO `packages/schemas` or `packages/db` changes (the brainstorm found no schema gap). NO new store write methods, NO PlatformIngress caller, NO cockpit revival. `getConfirmationsOverlappingWindow` is 4c's read and is called nowhere in this slice.

---

## Settled design decisions (the load-bearing part)

All anchors re-derived against live `origin/main` at `3008e2b2` (2026-06-05).

### Decision A: placement is a SIBLING section on `/settings/business-facts`, not a BusinessFactsForm extension

The spec's defer-list item 5 sanctions "an operator business-context editor" as "small, targeted extensions of existing operator surfaces". The existing operator editing surface for org-level business knowledge is `apps/dashboard/src/app/(auth)/settings/business-facts/page.tsx` (shipped #828). The new editor renders as a sibling `<OperationalStateSection>` card below `<BusinessFactsForm>` on that page, with its own component directory (`components/settings/operational-state/`), its own hook, its own proxy route, and its own POST payload.

It is deliberately NOT merged into `BusinessFactsSchema`, the RHF form, or the PUT payload: the live business-facts write replaces the whole `BusinessConfig.config` blob, so in-blob operational fields would be erasable by any unrelated identity edit. That is the exact data-loss hazard 4a's sibling-table design exists to avoid (4a Decision A). The business-facts form components and the `BusinessFactsSchema` are byte-untouched by this slice (grep-proven in Task 7); only `page.tsx` changes, to render the sibling section and pass it the org timezone the page already fetches.

### Decision B: POST (append) on a new control-plane route file, not PUT (upsert) on marketplace.ts

- **POST, not PUT.** The business-facts precedent uses PUT because its store is an upsert (idempotent replace). A confirmation is the opposite contract: every save creates a NEW row, and re-sending the same payload deliberately produces a different result (a fresh freshness anchor). POST is the honest verb for append. The in-prefix precedent for create-returning-201 is `POST /tasks` (`marketplace.ts:383-407`, returns `201 { task }`); the new route returns `201 { confirmation }`. The "everything still accurate" action is the SAME POST with the latest state verbatim: that re-record IS the freshness re-anchor, no separate endpoint, no update API.
- **New file, not marketplace.ts.** `marketplace.ts` is 788 lines with an `eslint-disable max-lines` legacy-debt marker (arch-check flags it 🟡); growing it is wrong. New file `apps/api/src/routes/marketplace-operational-state.ts` (sibling naming precedent: `marketplace-persona.ts`), registered under the same `/api/marketplace` prefix in `bootstrap/routes.ts`, so URLs stay in the deployment-anchored family: `GET|POST /api/marketplace/deployments/:id/operational-state`.
- **Route class:** `// @route-class: control-plane` first line (owner-controlled platform configuration, same class as marketplace.ts; enforced by `.agent/tools/check-routes.ts --mode=error` in CI). It is a settings write, NOT PlatformIngress (4a Decision D: operational-state confirmations are settings writes, not revenue actions).
- **Conventions copied exactly from `marketplace.ts:325-380`:** 503 when `!app.prisma`; org from `request.organizationIdFromAuth` (401 when absent); deployment `:id` anchors org ownership with 404 on missing-or-mismatch (no existence leak); `OperationalStateSchema.safeParse` to 400 with `issues`; stores constructed inline per-request.

### Decision C: confirmedAt is route-supplied server time; confirmedBy is the authenticated principal

- `confirmedAt = new Date()` computed in the API route handler at the moment it processes the authenticated save. The client never sends a timestamp (no clock skew, no forgeability); the store REQUIRES the value explicitly (4a honesty floor: nothing fabricates one implicitly), and the route is the operator-action moment by construction.
- `confirmedBy = request.principalIdFromAuth`, the identity the route actually has: the auth middleware (`apps/api/src/middleware/auth.ts:179,192,215`) populates it from `API_KEY_METADATA` for static keys and from the per-user `DashboardUser.principalId` for dashboard-generated keys (the dashboard's `getApiClient` sends the logged-in user's own key, so a dashboard save carries that user's principal). When absent (e.g. dev fallback key without metadata), the route omits it and the row stores NULL; the UI then renders the freshness line without a "by" clause. No identity is invented.

### Decision D: timezone conversion at the edge, half-open day boundaries in the org timezone

4a stores ISO-8601 instants; operators think in local dates ("promo June 1-15"). Conversion happens client-side in the form layer via a pure, test-pinned util using `Intl.DateTimeFormat` (no new dependency; the dashboard has no date library):

- The org timezone is `BusinessFacts.timezone` (`packages/schemas/src/marketplace.ts:276`), which the page already fetches for the sibling form; fallback `"Asia/Singapore"`, mirroring the alex builder (`packages/core/src/skill-runtime/builders/alex.ts:107`). An invalid stored timezone string also degrades to the fallback (`ensureTimeZone`), so a malformed facts row cannot crash the editor.
- **Day-boundary rule (pinned by tests):** the operator's dates are INCLUSIVE local dates. `start` converts to 00:00:00.000 of the start date in the org timezone. `end` converts to 00:00:00.000 of the day AFTER the inclusive end date in the org timezone, producing a half-open `[start, end)` interval that covers the entire final local day with no 23:59:59 gap. A single-day window (start = end date) therefore yields a valid interval (end is strictly after start, satisfying the 4a schema refine). Open-ended ("until further notice") omits `end`.
- DST correctness: the two-pass offset technique converges across DST transitions; pinned with an `America/New_York` spring-forward test alongside the fixed-offset `Asia/Singapore` cases.

### Decision E: validity is DERIVED; the roadmap's "carries a validity interval" wording is satisfied structurally

Restating so the roadmap line cannot mislead a reviewer: in the shipped 4a model a confirmation's validity interval is derived from row succession (`[confirmedAt_i, confirmedAt_{i+1})`), never stored, and explicit promo/closure bounds live INSIDE the state payload. This slice adds NO `validUntil` field, no schema change, and no migration. A new confirmation "carries" its validity interval by being appended: the previous row's derived interval closes at the new row's `confirmedAt`.

### Decision F: form honesty semantics

- **Absent = unconfirmed, never pre-checked.** For a never-confirmed org every dimension starts unset: the three enum selects show a "Not confirming" placeholder (and offer an explicit "Not confirming" item so a selection is reversible), and both interval lists start unconfirmed. Nothing defaults to "open"/"normal".
- **Pre-fill from the LATEST confirmation is allowed** (it restates what the operator last said, which is exactly what "everything still accurate" re-records); a fresh org has nothing to pre-fill so nothing is fabricated.
- **`[]` vs absent is a first-class UI distinction.** Each interval list has a "Confirm ..." checkbox: unchecked = the field is ABSENT from the payload (not confirming); checked with zero rows = explicit `[]` ("operator confirmed none", surfaced as "You are confirming there are none active"); checked with rows = the windows.
- **A note alone never satisfies a confirmation, at every layer.** UI: the submit button is disabled and a helper line explains why whenever the serialized payload confirms no dimension (the pure serializer returns `null` for note-only models). Proxy + API route: `OperationalStateSchema.safeParse` rejects note-only with 400. Store: Zod refine. DB: `nonempty_state_check`. The first two are this slice's tests; the last two are 4a's, already pinned.
- **Read-back honesty:** `getLatest` degrades malformed rows to `null`; the GET response is `{ confirmation: null }` and the UI renders the same honest absence as never-confirmed ("Never confirmed"). No fallback to older rows (4a store contract), no fabricated current state.

### Decision G: no demo-mode branch, deliberately

The data-mode infrastructure (`apps/dashboard/src/lib/data-mode/`) drives the layout banner only; the business-facts settings surface has zero demo branching and always talks to the live proxy (verified: no `data-mode` import anywhere under `components/settings/business-facts/` or the page). The sibling operational-state section follows the surface it lives on: live-path only, no `if (demo)` branch needed because no demo rendering exists here. If demo mode ever reaches this surface, the demo-mutations-branch-explicitly rule applies then.

### Eval gates and the alex-eval environmental blocker

- `pnpm eval:riley` (12+10+6) and `pnpm eval:governance` (26): baseline captured GREEN pre-change (`/tmp/4b-baselines/eval-riley.txt`, `/tmp/4b-baselines/eval-governance.txt`); re-run + byte-diff post-change. Nothing under `evals/`, `packages/ad-optimizer`, or `packages/core` is touched, so byte-unchanged is also provable from the diff.
- `pnpm eval:alex-conversation` remains environmentally blocked (verified 2026-06-05 in this worktree: exits 0 with "alex-conversation eval skipped: ANTHROPIC_API_KEY is not available"). Static proof chain in lieu of a model run: `BusinessFactsSchema`, `PrismaBusinessFactsStore`, the alex builder, and `evals/` are byte-untouched (diff-proven in Task 7); core suite green; the dashboard page change passes its own suite + `next build`.

### Known pre-existing failures (not blockers, not ours)

`pnpm --filter @switchboard/db test` fails 9 tests across exactly 3 files at clean baseline `3008e2b2` (work-trace integrity 6, ledger 2, greeting 1): the known local-PG shared-DB trio. Gate = no NEW failures. Known CI noise: chat gateway-bridge-attribution flake, api-auth prod-hardening flake (rerun before investigating), Eval Claim Classifier 401 on main pushes (informational).

---

## File structure

```
apps/api/src/routes/marketplace-operational-state.ts                          (create ~105 lines)
apps/api/src/routes/__tests__/marketplace-operational-state.test.ts           (create ~230 lines)
apps/api/src/bootstrap/routes.ts                                              (modify +2 lines)
apps/dashboard/src/lib/api-client/marketplace.ts                              (modify +30 lines)
apps/dashboard/src/lib/query-keys.ts                                          (modify +2 lines)
apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/operational-state/route.ts  (create ~60 lines)
apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/operational-state/__tests__/route.test.ts  (create ~80 lines)
apps/dashboard/src/hooks/use-operational-state.ts                             (create ~95 lines)
apps/dashboard/src/hooks/__tests__/use-operational-state.test.ts              (create ~110 lines)
apps/dashboard/src/components/settings/operational-state/local-date.ts        (create ~95 lines)
apps/dashboard/src/components/settings/operational-state/form-model.ts        (create ~120 lines)
apps/dashboard/src/components/settings/operational-state/interval-list-editor.tsx (create ~140 lines)
apps/dashboard/src/components/settings/operational-state/operational-state-form.tsx (create ~190 lines)
apps/dashboard/src/components/settings/operational-state/operational-state-section.tsx (create ~120 lines)
apps/dashboard/src/components/settings/operational-state/__tests__/local-date.test.ts (create ~110 lines)
apps/dashboard/src/components/settings/operational-state/__tests__/form-model.test.ts (create ~150 lines)
apps/dashboard/src/components/settings/operational-state/__tests__/operational-state-section.test.tsx (create ~230 lines)
apps/dashboard/src/app/(auth)/settings/business-facts/page.tsx                (modify ~+12 lines)
apps/dashboard/src/app/__tests__/settings-business-facts-page.test.tsx        (modify ~+25 lines)
docs/superpowers/plans/2026-06-05-riley-v3-slice4b-operational-state-editor.md (this file; rides in the PR per 4a precedent)
```

All files under the 600-line arch ceiling and the 400-line warn line. New-file count justification: the component directory mirrors the sibling `business-facts/` decomposition (form + sections + pure scaffold); the pure modules (`local-date.ts`, `form-model.ts`) carry the honesty semantics and are unit-tested without DOM machinery. Dashboard imports omit `.js` (relative AND `@/`); api files use ESM `.js` relative imports. No `any`.

---

## Task 0: Commit the approved plan

**Files:**

- Create: `docs/superpowers/plans/2026-06-05-riley-v3-slice4b-operational-state-editor.md` (this document)

- [ ] **Step 0.1: Verify branch context, then commit the plan doc**

```bash
git branch --show-current   # expect: worktree-riley-v3-slice4b-operational-state-editor
git status --short          # expect: only this plan doc (do NOT stage .claude/settings.local.json)
git add docs/superpowers/plans/2026-06-05-riley-v3-slice4b-operational-state-editor.md
git commit -m "docs(plans): riley v3 slice 4b operational-state editor plan"
```

Note: lint-staged may reformat the markdown; if the commit fails with reformatted files, `git add` again and re-commit.

---

## Task 1: API route (`@switchboard/api`)

**Files:**

- Create: `apps/api/src/routes/__tests__/marketplace-operational-state.test.ts`
- Create: `apps/api/src/routes/marketplace-operational-state.ts`
- Modify: `apps/api/src/bootstrap/routes.ts`

- [ ] **Step 1.1: Write the failing route test**

Create `apps/api/src/routes/__tests__/marketplace-operational-state.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

const mockDeploymentStore = { findById: vi.fn() };
const mockOperationalStateStore = { getLatest: vi.fn(), recordConfirmation: vi.fn() };

vi.mock("@switchboard/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@switchboard/db")>()),
  PrismaDeploymentStore: vi.fn(() => mockDeploymentStore),
  PrismaOperationalStateStore: vi.fn(() => mockOperationalStateStore),
}));

import { marketplaceOperationalStateRoutes } from "../marketplace-operational-state.js";

const CONFIRMATION = {
  id: "osc_1",
  organizationId: "org-1",
  state: { staffing: "shortfall" },
  confirmedBy: "principal-7",
  confirmedAt: new Date("2026-06-05T02:00:00.000Z"),
  createdAt: new Date("2026-06-05T02:00:00.000Z"),
};

function buildApp(orgId: string | null, principalId?: string): FastifyInstance {
  const app = Fastify();
  app.decorate("prisma", {} as never);
  app.addHook("onRequest", async (req) => {
    (req as unknown as { organizationIdFromAuth: string | null }).organizationIdFromAuth = orgId;
    if (principalId !== undefined) {
      (req as unknown as { principalIdFromAuth?: string }).principalIdFromAuth = principalId;
    }
  });
  app.register(marketplaceOperationalStateRoutes);
  return app;
}

describe("POST /deployments/:id/operational-state", () => {
  beforeEach(() => vi.clearAllMocks());

  it("records a confirmation keyed to the authed org with route-supplied confirmedAt and the auth principal", async () => {
    mockDeploymentStore.findById.mockResolvedValue({ id: "dep-1", organizationId: "org-1" });
    mockOperationalStateStore.recordConfirmation.mockResolvedValue(CONFIRMATION);
    const app = buildApp("org-1", "principal-7");
    const before = Date.now();
    const res = await app.inject({
      method: "POST",
      url: "/deployments/dep-1/operational-state",
      payload: { staffing: "shortfall" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().confirmation.id).toBe("osc_1");
    const [orgArg, stateArg, optsArg] =
      mockOperationalStateStore.recordConfirmation.mock.calls[0] ?? [];
    expect(orgArg).toBe("org-1");
    expect(stateArg).toEqual({ staffing: "shortfall" });
    expect(optsArg.confirmedBy).toBe("principal-7");
    // confirmedAt is the route's own clock at handling time, never client input.
    expect(optsArg.confirmedAt).toBeInstanceOf(Date);
    expect(optsArg.confirmedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(optsArg.confirmedAt.getTime()).toBeLessThanOrEqual(Date.now());
    await app.close();
  });

  it("strips client-supplied confirmedAt/confirmedBy and never forwards them to the store", async () => {
    mockDeploymentStore.findById.mockResolvedValue({ id: "dep-1", organizationId: "org-1" });
    mockOperationalStateStore.recordConfirmation.mockResolvedValue(CONFIRMATION);
    const app = buildApp("org-1", "principal-7");
    const res = await app.inject({
      method: "POST",
      url: "/deployments/dep-1/operational-state",
      payload: { staffing: "shortfall", confirmedAt: "2020-01-01T00:00:00.000Z" },
    });
    // OperationalStateSchema is a plain z.object (strips unknown keys), so the
    // stale timestamp never reaches the store; the parsed state carries only
    // operational dimensions. confirmedAt remains exclusively the route's own
    // clock (pinned in the first POST test).
    expect(res.statusCode).toBe(201);
    const [, stateArg] = mockOperationalStateStore.recordConfirmation.mock.calls[0] ?? [];
    expect(stateArg).toEqual({ staffing: "shortfall" });
    await app.close();
  });

  it("omits confirmedBy entirely when auth carries no principal (stores NULL, invents nothing)", async () => {
    mockDeploymentStore.findById.mockResolvedValue({ id: "dep-1", organizationId: "org-1" });
    mockOperationalStateStore.recordConfirmation.mockResolvedValue({
      ...CONFIRMATION,
      confirmedBy: null,
    });
    const app = buildApp("org-1");
    const res = await app.inject({
      method: "POST",
      url: "/deployments/dep-1/operational-state",
      payload: { staffing: "shortfall" },
    });
    expect(res.statusCode).toBe(201);
    const [, , optsArg] = mockOperationalStateStore.recordConfirmation.mock.calls[0] ?? [];
    expect(Object.prototype.hasOwnProperty.call(optsArg, "confirmedBy")).toBe(false);
    await app.close();
  });

  it("accepts explicit empty arrays (operator confirmed NONE, distinct from absent)", async () => {
    mockDeploymentStore.findById.mockResolvedValue({ id: "dep-1", organizationId: "org-1" });
    mockOperationalStateStore.recordConfirmation.mockResolvedValue({
      ...CONFIRMATION,
      state: { promoWindows: [], closures: [] },
    });
    const app = buildApp("org-1");
    const res = await app.inject({
      method: "POST",
      url: "/deployments/dep-1/operational-state",
      payload: { promoWindows: [], closures: [] },
    });
    expect(res.statusCode).toBe(201);
    const [, stateArg] = mockOperationalStateStore.recordConfirmation.mock.calls[0] ?? [];
    expect(stateArg).toEqual({ promoWindows: [], closures: [] });
    await app.close();
  });

  it("each save is a fresh recordConfirmation call (append-only; no update API exists)", async () => {
    mockDeploymentStore.findById.mockResolvedValue({ id: "dep-1", organizationId: "org-1" });
    mockOperationalStateStore.recordConfirmation.mockResolvedValue(CONFIRMATION);
    const app = buildApp("org-1");
    const payload = { staffing: "shortfall" };
    await app.inject({ method: "POST", url: "/deployments/dep-1/operational-state", payload });
    await app.inject({ method: "POST", url: "/deployments/dep-1/operational-state", payload });
    expect(mockOperationalStateStore.recordConfirmation).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it("rejects a note-only payload (400) and does NOT write (a note alone is not a confirmation)", async () => {
    mockDeploymentStore.findById.mockResolvedValue({ id: "dep-1", organizationId: "org-1" });
    const app = buildApp("org-1");
    const res = await app.inject({
      method: "POST",
      url: "/deployments/dep-1/operational-state",
      payload: { note: "all quiet" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().issues).toBeDefined();
    expect(mockOperationalStateStore.recordConfirmation).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects an empty payload (400) and does NOT write", async () => {
    mockDeploymentStore.findById.mockResolvedValue({ id: "dep-1", organizationId: "org-1" });
    const app = buildApp("org-1");
    const res = await app.inject({
      method: "POST",
      url: "/deployments/dep-1/operational-state",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(mockOperationalStateStore.recordConfirmation).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects unknown enum values (400) and does NOT write", async () => {
    mockDeploymentStore.findById.mockResolvedValue({ id: "dep-1", organizationId: "org-1" });
    const app = buildApp("org-1");
    const res = await app.inject({
      method: "POST",
      url: "/deployments/dep-1/operational-state",
      payload: { operatingStatus: "closed" },
    });
    expect(res.statusCode).toBe(400);
    expect(mockOperationalStateStore.recordConfirmation).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects a cross-org deployment id (404, no existence leak) and does NOT write", async () => {
    mockDeploymentStore.findById.mockResolvedValue({ id: "dep-1", organizationId: "org-OTHER" });
    const app = buildApp("org-1");
    const res = await app.inject({
      method: "POST",
      url: "/deployments/dep-1/operational-state",
      payload: { staffing: "shortfall" },
    });
    expect(res.statusCode).toBe(404);
    expect(mockOperationalStateStore.recordConfirmation).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 401 when unauthenticated and does NOT write", async () => {
    const app = buildApp(null);
    const res = await app.inject({
      method: "POST",
      url: "/deployments/dep-1/operational-state",
      payload: { staffing: "shortfall" },
    });
    expect(res.statusCode).toBe(401);
    expect(mockOperationalStateStore.recordConfirmation).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("GET /deployments/:id/operational-state", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the latest confirmation for the authed org", async () => {
    mockDeploymentStore.findById.mockResolvedValue({ id: "dep-1", organizationId: "org-1" });
    mockOperationalStateStore.getLatest.mockResolvedValue(CONFIRMATION);
    const app = buildApp("org-1");
    const res = await app.inject({ method: "GET", url: "/deployments/dep-1/operational-state" });
    expect(res.statusCode).toBe(200);
    expect(mockOperationalStateStore.getLatest).toHaveBeenCalledWith("org-1");
    const body = res.json();
    expect(body.confirmation.state).toEqual({ staffing: "shortfall" });
    expect(body.confirmation.confirmedAt).toBe("2026-06-05T02:00:00.000Z");
    await app.close();
  });

  it("returns { confirmation: null } when the org has never confirmed (honest absence)", async () => {
    mockDeploymentStore.findById.mockResolvedValue({ id: "dep-1", organizationId: "org-1" });
    mockOperationalStateStore.getLatest.mockResolvedValue(null);
    const app = buildApp("org-1");
    const res = await app.inject({ method: "GET", url: "/deployments/dep-1/operational-state" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ confirmation: null });
    await app.close();
  });

  it("rejects a cross-org deployment id with 404 (no existence leak)", async () => {
    mockDeploymentStore.findById.mockResolvedValue({ id: "dep-1", organizationId: "org-OTHER" });
    const app = buildApp("org-1");
    const res = await app.inject({ method: "GET", url: "/deployments/dep-1/operational-state" });
    expect(res.statusCode).toBe(404);
    expect(mockOperationalStateStore.getLatest).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 401 when unauthenticated", async () => {
    const app = buildApp(null);
    const res = await app.inject({ method: "GET", url: "/deployments/dep-1/operational-state" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
```

- [ ] **Step 1.2: Run the test, verify it fails on the missing module**

```bash
pnpm --filter @switchboard/api test -- marketplace-operational-state
```

Expected: FAIL with `Cannot find module '../marketplace-operational-state.js'` (or equivalent resolve error).

- [ ] **Step 1.3: Implement the route**

Create `apps/api/src/routes/marketplace-operational-state.ts`:

```ts
// @route-class: control-plane
// ---------------------------------------------------------------------------
// Operational-state confirmations (Riley v3 slice 4b; spec 2.1 net-new
// paragraph + 7.4; substrate shipped in 4a, #895).
//
// Org-scoped settings writes following the business-facts conventions
// (marketplace.ts): org from request.organizationIdFromAuth, deployment :id
// anchors org ownership with 404 on mismatch (no existence leak), Zod
// safeParse -> 400, stores constructed inline. NOT PlatformIngress: a
// confirmation is a settings write, not a revenue action.
//
// POST is append-only by contract: every save calls recordConfirmation
// (INSERT-only; the store deliberately ships no update API). Re-sending the
// same state IS the freshness re-anchor ("everything still accurate").
// confirmedAt is this route's clock at handling time (the operator action
// moment); the client never supplies it. confirmedBy is the authenticated
// principal when auth carries one; nothing invents an identity.
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import { OperationalStateSchema } from "@switchboard/schemas";
import { PrismaDeploymentStore, PrismaOperationalStateStore } from "@switchboard/db";

export const marketplaceOperationalStateRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>(
    "/deployments/:id/operational-state",
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgId = request.organizationIdFromAuth;
      if (!orgId) {
        return reply.code(401).send({ error: "Authentication required", statusCode: 401 });
      }

      const { id } = request.params;
      const deploymentStore = new PrismaDeploymentStore(app.prisma);
      const deployment = await deploymentStore.findById(id);
      if (!deployment || deployment.organizationId !== orgId) {
        return reply.code(404).send({ error: "Deployment not found", statusCode: 404 });
      }

      const store = new PrismaOperationalStateStore(app.prisma);
      // getLatest degrades malformed rows to null (honest absence); the UI
      // renders null as "never confirmed", never a fabricated default.
      const confirmation = await store.getLatest(orgId);
      return reply.send({ confirmation });
    },
  );

  app.post<{ Params: { id: string }; Body: unknown }>(
    "/deployments/:id/operational-state",
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgId = request.organizationIdFromAuth;
      if (!orgId) {
        return reply.code(401).send({ error: "Authentication required", statusCode: 401 });
      }

      const { id } = request.params;
      const deploymentStore = new PrismaDeploymentStore(app.prisma);
      const deployment = await deploymentStore.findById(id);
      if (!deployment || deployment.organizationId !== orgId) {
        return reply.code(404).send({ error: "Deployment not found", statusCode: 404 });
      }

      const parsed = OperationalStateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Invalid operational state",
          issues: parsed.error.issues,
          statusCode: 400,
        });
      }

      const store = new PrismaOperationalStateStore(app.prisma);
      const principalId = request.principalIdFromAuth;
      const confirmation = await store.recordConfirmation(orgId, parsed.data, {
        confirmedAt: new Date(),
        ...(principalId ? { confirmedBy: principalId } : {}),
      });
      return reply.code(201).send({ confirmation });
    },
  );
};
```

Modify `apps/api/src/bootstrap/routes.ts`: next to the `marketplaceRoutes` import add

```ts
import { marketplaceOperationalStateRoutes } from "../routes/marketplace-operational-state.js";
```

and directly after the `await app.register(marketplaceRoutes, { prefix: "/api/marketplace" });` line add

```ts
await app.register(marketplaceOperationalStateRoutes, { prefix: "/api/marketplace" });
```

- [ ] **Step 1.4: Run the route tests, verify green**

```bash
pnpm --filter @switchboard/api test -- marketplace-operational-state
```

Expected: PASS (all 14 tests).

- [ ] **Step 1.5: Full api suite + typecheck + route-class check, verify green**

```bash
pnpm --filter @switchboard/api test
pnpm typecheck
pnpm exec tsx .agent/tools/check-routes.ts --mode=error
```

Expected: api suite green (1451 baseline + 14 new); typecheck clean; check-routes green (the new file's first line is a valid `@route-class` header).

- [ ] **Step 1.6: Commit**

```bash
git add apps/api/src/routes/marketplace-operational-state.ts \
        apps/api/src/routes/__tests__/marketplace-operational-state.test.ts \
        apps/api/src/bootstrap/routes.ts
git commit -m "feat(api): operational-state confirmation routes (riley v3 slice 4b)"
```

---

## Task 2: Dashboard plumbing (client methods, query key, Next proxy, hook)

**Files:**

- Modify: `apps/dashboard/src/lib/api-client/marketplace.ts` (after `upsertBusinessFacts`, ~line 97)
- Modify: `apps/dashboard/src/lib/query-keys.ts` (inside the `marketplace` block, after `businessFacts`)
- Create: `apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/operational-state/route.ts`
- Create: `apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/operational-state/__tests__/route.test.ts`
- Create: `apps/dashboard/src/hooks/use-operational-state.ts`
- Create: `apps/dashboard/src/hooks/__tests__/use-operational-state.test.ts`

- [ ] **Step 2.1: Write the failing hook test**

Create `apps/dashboard/src/hooks/__tests__/use-operational-state.test.ts` (mirrors `use-business-facts.test.ts`):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import type { ReactNode } from "react";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1" }, status: "authenticated" }),
}));
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

const WIRE_CONFIRMATION = {
  id: "osc_1",
  organizationId: "org-1",
  state: { staffing: "shortfall" },
  confirmedBy: "principal-7",
  confirmedAt: "2026-06-05T02:00:00.000Z",
  createdAt: "2026-06-05T02:00:00.000Z",
};

describe("useOperationalState / useRecordOperationalState", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads { confirmation } from the proxy", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ confirmation: WIRE_CONFIRMATION }),
    });
    const { useOperationalState } = await import("@/hooks/use-operational-state");
    const { result } = renderHook(() => useOperationalState("dep_1"), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/dashboard/marketplace/deployments/dep_1/operational-state",
    );
    expect(result.current.data?.confirmation?.state).toEqual({ staffing: "shortfall" });
  });

  it("reads honest absence ({ confirmation: null }) without fabricating a default", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ confirmation: null }),
    });
    const { useOperationalState } = await import("@/hooks/use-operational-state");
    const { result } = renderHook(() => useOperationalState("dep_1"), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.confirmation).toBeNull();
  });

  it("is disabled (no fetch) when deploymentId is null", async () => {
    const { useOperationalState } = await import("@/hooks/use-operational-state");
    renderHook(() => useOperationalState(null), { wrapper: createWrapper() });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("POSTs the state and surfaces 400 details as OperationalStateValidationError", async () => {
    mockFetch.mockResolvedValueOnce({
      status: 400,
      ok: false,
      json: () => Promise.resolve({ error: "Validation failed", details: { formErrors: [] } }),
    });
    const { useRecordOperationalState, OperationalStateValidationError } =
      await import("@/hooks/use-operational-state");
    const { result } = renderHook(() => useRecordOperationalState("dep_1"), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await expect(result.current.mutateAsync({ note: "only a note" })).rejects.toBeInstanceOf(
        OperationalStateValidationError,
      );
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/dashboard/marketplace/deployments/dep_1/operational-state",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ note: "only a note" }) }),
    );
  });

  it("POST success resolves with the created confirmation", async () => {
    mockFetch.mockResolvedValueOnce({
      status: 201,
      ok: true,
      json: () => Promise.resolve({ confirmation: WIRE_CONFIRMATION }),
    });
    const { useRecordOperationalState } = await import("@/hooks/use-operational-state");
    const { result } = renderHook(() => useRecordOperationalState("dep_1"), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      const out = await result.current.mutateAsync({ staffing: "shortfall" });
      expect(out.confirmation.id).toBe("osc_1");
    });
  });

  it("does not POST when deploymentId is null (fails locally before fetch)", async () => {
    const { useRecordOperationalState } = await import("@/hooks/use-operational-state");
    const { result } = renderHook(() => useRecordOperationalState(null), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await expect(result.current.mutateAsync({ staffing: "shortfall" })).rejects.toThrow(
        /deploymentId/i,
      );
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2.2: Run the hook test, verify it fails on the missing module**

```bash
pnpm --filter @switchboard/dashboard test -- use-operational-state
```

Expected: FAIL with a module-resolve error for `@/hooks/use-operational-state`.

- [ ] **Step 2.3: Implement the query key, client methods, proxy route, and hook**

Modify `apps/dashboard/src/lib/query-keys.ts`: inside the `marketplace` block, directly after the `businessFacts` entry, add:

```ts
    operationalState: (deploymentId: string) =>
      [orgId, "marketplace", "operational-state", deploymentId] as const,
```

Modify `apps/dashboard/src/lib/api-client/marketplace.ts`: directly after the `upsertBusinessFacts` method, add:

```ts
  async getLatestOperationalState(deploymentId: string) {
    return this.request<{
      confirmation: {
        id: string;
        organizationId: string;
        state: Record<string, unknown>;
        confirmedBy: string | null;
        confirmedAt: string;
        createdAt: string;
      } | null;
    }>(`/api/marketplace/deployments/${deploymentId}/operational-state`);
  }

  async recordOperationalState(deploymentId: string, state: Record<string, unknown>) {
    return this.request<{
      confirmation: {
        id: string;
        organizationId: string;
        state: Record<string, unknown>;
        confirmedBy: string | null;
        confirmedAt: string;
        createdAt: string;
      };
    }>(`/api/marketplace/deployments/${deploymentId}/operational-state`, {
      method: "POST",
      body: JSON.stringify(state),
    });
  }
```

Create `apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/operational-state/route.ts` (mirrors the business-facts proxy):

```ts
import { NextRequest, NextResponse } from "next/server";
import { OperationalStateSchema } from "@switchboard/schemas";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { proxyError } from "@/lib/proxy-error";
import { requireDashboardSession } from "@/lib/require-dashboard-session";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();
    const { id } = await params;
    await requireDashboardSession();
    const client = await getApiClient();
    const data = await client.getLatestOperationalState(id);
    return NextResponse.json({ confirmation: data.confirmation ?? null });
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();
    const { id } = await params;
    const body = await request.json();
    const parsed = OperationalStateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten(), statusCode: 400 },
        { status: 400 },
      );
    }

    await requireDashboardSession();
    const client = await getApiClient();
    const data = await client.recordOperationalState(id, parsed.data);
    return NextResponse.json({ confirmation: data.confirmation }, { status: 201 });
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
```

Create `apps/dashboard/src/hooks/use-operational-state.ts`:

```ts
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import type { OperationalState } from "@switchboard/schemas";

/**
 * Wire shape of a persisted confirmation after it crossed the JSON boundary
 * (Date columns serialize to ISO strings). Named -Wire so the cross-app-types
 * advisory does not flag a collision with the schemas-level
 * OperationalStateConfirmation (whose timestamps are Dates).
 */
export interface OperationalStateConfirmationWire {
  id: string;
  organizationId: string;
  state: OperationalState;
  confirmedBy: string | null;
  confirmedAt: string;
  createdAt: string;
}

export interface OperationalStateResponse {
  confirmation: OperationalStateConfirmationWire | null;
}

/** Thrown when the proxy rejects the payload (HTTP 400); carries the zod flatten() details. */
export class OperationalStateValidationError extends Error {
  details: unknown;
  constructor(details: unknown) {
    super("Operational state validation failed");
    this.name = "OperationalStateValidationError";
    this.details = details;
  }
}

async function fetchLatestOperationalState(
  deploymentId: string,
): Promise<OperationalStateResponse> {
  const res = await fetch(
    `/api/dashboard/marketplace/deployments/${deploymentId}/operational-state`,
  );
  if (!res.ok) throw new Error("Failed to fetch operational state");
  return res.json();
}

export function useOperationalState(deploymentId: string | null) {
  const keys = useScopedQueryKeys();
  const enabled = !!keys && !!deploymentId;
  return useQuery({
    queryKey:
      keys && deploymentId
        ? keys.marketplace.operationalState(deploymentId)
        : ["__disabled_operational_state__"],
    queryFn: () => fetchLatestOperationalState(deploymentId as string),
    enabled,
  });
}

export function useRecordOperationalState(deploymentId: string | null) {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: async (
      state: OperationalState,
    ): Promise<{ confirmation: OperationalStateConfirmationWire }> => {
      if (!deploymentId) {
        throw new Error("Cannot record operational state without a deploymentId");
      }
      const res = await fetch(
        `/api/dashboard/marketplace/deployments/${deploymentId}/operational-state`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(state),
        },
      );
      if (res.status === 400) {
        const body = await res.json().catch(() => ({}));
        throw new OperationalStateValidationError((body as { details?: unknown })?.details ?? body);
      }
      if (!res.ok) throw new Error("Failed to record operational state");
      return res.json();
    },
    onSuccess: () => {
      if (keys && deploymentId) {
        queryClient.invalidateQueries({
          queryKey: keys.marketplace.operationalState(deploymentId),
        });
      }
    },
  });
}
```

- [ ] **Step 2.4: Write the direct proxy-handler test (the honesty seam gets its own coverage)**

Create `apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/operational-state/__tests__/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const recordOperationalState = vi.fn();
const getLatestOperationalState = vi.fn();
vi.mock("@/lib/session", () => ({ requireSession: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/require-dashboard-session", () => ({
  requireDashboardSession: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/get-api-client", () => ({
  getApiClient: vi.fn().mockResolvedValue({ recordOperationalState, getLatestOperationalState }),
}));

import { GET, POST } from "../route";

const params = { params: Promise.resolve({ id: "dep_1" }) };

function postRequest(body: unknown) {
  return new Request(
    "http://localhost/api/dashboard/marketplace/deployments/dep_1/operational-state",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("operational-state proxy route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a note-only payload at the proxy (400) and never reaches the backend client", async () => {
    const res = await POST(postRequest({ note: "only a note" }) as never, params);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.details).toBeDefined();
    expect(recordOperationalState).not.toHaveBeenCalled();
  });

  it("rejects an empty payload at the proxy (400) and never reaches the backend client", async () => {
    const res = await POST(postRequest({}) as never, params);
    expect(res.status).toBe(400);
    expect(recordOperationalState).not.toHaveBeenCalled();
  });

  it("forwards a valid confirmation and returns 201 with the created row", async () => {
    recordOperationalState.mockResolvedValue({
      confirmation: { id: "osc_1", state: { staffing: "shortfall" } },
    });
    const res = await POST(postRequest({ staffing: "shortfall" }) as never, params);
    expect(res.status).toBe(201);
    expect(recordOperationalState).toHaveBeenCalledWith("dep_1", { staffing: "shortfall" });
  });

  it("GET passes honest absence through as { confirmation: null }", async () => {
    getLatestOperationalState.mockResolvedValue({ confirmation: null });
    const res = await GET(
      new Request(
        "http://localhost/api/dashboard/marketplace/deployments/dep_1/operational-state",
      ) as never,
      params,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ confirmation: null });
  });
});
```

- [ ] **Step 2.5: Run the hook + proxy tests + proxy completeness, verify green**

```bash
pnpm --filter @switchboard/dashboard test -- use-operational-state
pnpm --filter @switchboard/dashboard test -- operational-state/__tests__/route
pnpm --filter @switchboard/dashboard test -- proxy-route-completeness
pnpm typecheck
```

Expected: hook tests PASS (6, including the null-deploymentId guard); proxy-handler tests PASS (4); proxy-route-completeness PASS (the new browser fetch path resolves to the new proxy route file); typecheck clean.

- [ ] **Step 2.6: Commit**

```bash
git add apps/dashboard/src/lib/api-client/marketplace.ts \
        apps/dashboard/src/lib/query-keys.ts \
        "apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/operational-state" \
        apps/dashboard/src/hooks/use-operational-state.ts \
        apps/dashboard/src/hooks/__tests__/use-operational-state.test.ts
git commit -m "feat(dashboard): operational-state proxy route, client methods, query hook (riley v3 slice 4b)"
```

---

## Task 3: Local-date conversion at the timezone edge (pure util)

**Files:**

- Create: `apps/dashboard/src/components/settings/operational-state/__tests__/local-date.test.ts`
- Create: `apps/dashboard/src/components/settings/operational-state/local-date.ts`

- [ ] **Step 3.1: Write the failing util test**

Create `apps/dashboard/src/components/settings/operational-state/__tests__/local-date.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  ensureTimeZone,
  instantToInclusiveEndDate,
  instantToLocalDate,
  localDateToInstant,
} from "../local-date";

describe("localDateToInstant", () => {
  it("converts a start date to local midnight in the org timezone (Asia/Singapore, UTC+8)", () => {
    expect(localDateToInstant("2026-06-01", "Asia/Singapore", "start")).toBe(
      "2026-05-31T16:00:00.000Z",
    );
  });

  it("converts an INCLUSIVE end date to the start of the NEXT local day (half-open interval)", () => {
    // Promo "June 1-15" covers all of June 15 SGT; end = June 16 00:00 SGT.
    expect(localDateToInstant("2026-06-15", "Asia/Singapore", "end")).toBe(
      "2026-06-15T16:00:00.000Z",
    );
  });

  it("a single-day window yields end strictly after start (satisfies the 4a schema refine)", () => {
    const start = localDateToInstant("2026-06-01", "Asia/Singapore", "start");
    const end = localDateToInstant("2026-06-01", "Asia/Singapore", "end");
    expect(Date.parse(end)).toBeGreaterThan(Date.parse(start));
  });

  it("handles UTC", () => {
    expect(localDateToInstant("2026-06-01", "UTC", "start")).toBe("2026-06-01T00:00:00.000Z");
    expect(localDateToInstant("2026-06-01", "UTC", "end")).toBe("2026-06-02T00:00:00.000Z");
  });

  it("handles a DST spring-forward boundary (America/New_York, 2025-03-09)", () => {
    // Midnight Mar 9 is still EST (UTC-5); midnight Mar 10 is EDT (UTC-4).
    expect(localDateToInstant("2025-03-09", "America/New_York", "start")).toBe(
      "2025-03-09T05:00:00.000Z",
    );
    expect(localDateToInstant("2025-03-09", "America/New_York", "end")).toBe(
      "2025-03-10T04:00:00.000Z",
    );
  });

  it("rejects a malformed date string", () => {
    expect(() => localDateToInstant("june 1", "Asia/Singapore", "start")).toThrow();
    expect(() => localDateToInstant("2026-6-1", "Asia/Singapore", "start")).toThrow();
  });
});

describe("instantToLocalDate / instantToInclusiveEndDate", () => {
  it("renders an instant as the local date in the org timezone", () => {
    expect(instantToLocalDate("2026-05-31T16:00:00.000Z", "Asia/Singapore")).toBe("2026-06-01");
  });

  it("round-trips a start date", () => {
    const instant = localDateToInstant("2026-06-01", "Asia/Singapore", "start");
    expect(instantToLocalDate(instant, "Asia/Singapore")).toBe("2026-06-01");
  });

  it("recovers the INCLUSIVE end date from an exclusive end instant", () => {
    const instant = localDateToInstant("2026-06-15", "Asia/Singapore", "end");
    expect(instantToInclusiveEndDate(instant, "Asia/Singapore")).toBe("2026-06-15");
  });
});

describe("ensureTimeZone", () => {
  it("passes a valid IANA zone through", () => {
    expect(ensureTimeZone("America/New_York")).toBe("America/New_York");
  });

  it("falls back to Asia/Singapore for missing or invalid zones (mirrors the alex builder)", () => {
    expect(ensureTimeZone(undefined)).toBe("Asia/Singapore");
    expect(ensureTimeZone("")).toBe("Asia/Singapore");
    expect(ensureTimeZone("Mars/Olympus_Mons")).toBe("Asia/Singapore");
  });

  it("conversion entry points harden invalid zones to the fallback instead of throwing", () => {
    // Asia/Singapore fallback: June 1 local midnight is May 31 16:00 UTC.
    expect(localDateToInstant("2026-06-01", "Mars/Olympus_Mons", "start")).toBe(
      "2026-05-31T16:00:00.000Z",
    );
    expect(instantToLocalDate("2026-05-31T16:00:00.000Z", "Mars/Olympus_Mons")).toBe("2026-06-01");
  });
});
```

- [ ] **Step 3.2: Run the test, verify it fails on the missing module**

```bash
pnpm --filter @switchboard/dashboard test -- local-date
```

Expected: FAIL with a module-resolve error for `../local-date`.

- [ ] **Step 3.3: Implement the util**

Create `apps/dashboard/src/components/settings/operational-state/local-date.ts`:

```ts
// Pure local-date <-> instant conversion at the org-timezone edge (Riley v3
// slice 4b). The 4a substrate stores ISO-8601 instants; operators think in
// inclusive local dates ("promo June 1-15"). Day-boundary rule, pinned by
// tests: start = 00:00:00.000 of the start date in the org timezone; end =
// 00:00:00.000 of the day AFTER the inclusive end date, producing a half-open
// [start, end) interval that covers the whole final local day with no
// 23:59:59 gap. No date library: Intl.DateTimeFormat only.

const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FALLBACK_TZ = "Asia/Singapore";

/**
 * Org timezone with the same fallback the alex builder uses. An invalid
 * stored timezone string (free-text BusinessFacts field) degrades to the
 * fallback instead of crashing the editor.
 */
export function ensureTimeZone(timeZone: string | undefined): string {
  if (!timeZone) return FALLBACK_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return FALLBACK_TZ;
  }
}

/** Offset of `timeZone` from UTC at the given instant, in ms (second precision). */
function tzOffsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instantMs);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * Convert an operator-local INCLUSIVE date to an ISO-8601 instant in the org
 * timezone. boundary "start" = local midnight of that date; boundary "end" =
 * local midnight of the NEXT day (half-open interval; see module note).
 * Two-pass offset refinement converges across DST transitions.
 */
export function localDateToInstant(
  date: string,
  timeZone: string,
  boundary: "start" | "end",
): string {
  if (!LOCAL_DATE_RE.test(date)) throw new Error(`invalid local date: ${date}`);
  // Harden at the lowest layer: an invalid zone degrades to the fallback here
  // too, so a non-section caller cannot crash on a malformed BusinessFacts
  // timezone.
  const tz = ensureTimeZone(timeZone);
  const [y, m, d] = date.split("-").map(Number);
  const dayUtcMidnight = Date.UTC(
    y as number,
    (m as number) - 1,
    (d as number) + (boundary === "end" ? 1 : 0),
  );
  let offset = tzOffsetMs(dayUtcMidnight, tz);
  let instant = dayUtcMidnight - offset;
  offset = tzOffsetMs(instant, tz);
  instant = dayUtcMidnight - offset;
  return new Date(instant).toISOString();
}

/** Local calendar date (YYYY-MM-DD) of an instant in the org timezone. */
export function instantToLocalDate(iso: string, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD. Same lowest-layer hardening as
  // localDateToInstant: invalid zones degrade to the fallback.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ensureTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/**
 * Recover the operator-facing INCLUSIVE end date from an exclusive end
 * instant: the instant 1ms earlier falls inside the last covered local day.
 */
export function instantToInclusiveEndDate(iso: string, timeZone: string): string {
  return instantToLocalDate(new Date(Date.parse(iso) - 1).toISOString(), timeZone);
}
```

- [ ] **Step 3.4: Run the tests, verify green**

```bash
pnpm --filter @switchboard/dashboard test -- local-date
pnpm typecheck
```

Expected: PASS (12 tests); typecheck clean.

- [ ] **Step 3.5: Commit**

```bash
git add apps/dashboard/src/components/settings/operational-state/local-date.ts \
        apps/dashboard/src/components/settings/operational-state/__tests__/local-date.test.ts
git commit -m "feat(dashboard): org-timezone local-date conversion for operational state (riley v3 slice 4b)"
```

---

## Task 4: Form model (pure honesty semantics)

**Files:**

- Create: `apps/dashboard/src/components/settings/operational-state/__tests__/form-model.test.ts`
- Create: `apps/dashboard/src/components/settings/operational-state/form-model.ts`

- [ ] **Step 4.1: Write the failing form-model test**

Create `apps/dashboard/src/components/settings/operational-state/__tests__/form-model.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  emptyOperationalStateForm,
  intervalDraftError,
  prefillFromState,
  serializeOperationalStateForm,
} from "../form-model";

const TZ = "Asia/Singapore";

describe("emptyOperationalStateForm", () => {
  it("starts every dimension UNCONFIRMED (honesty floor: no fabricated defaults)", () => {
    const model = emptyOperationalStateForm();
    expect(model.operatingStatus).toBe("");
    expect(model.staffing).toBe("");
    expect(model.inventory).toBe("");
    expect(model.confirmPromoWindows).toBe(false);
    expect(model.confirmClosures).toBe(false);
    expect(model.promoWindows).toEqual([]);
    expect(model.closures).toEqual([]);
    expect(model.note).toBe("");
  });
});

describe("serializeOperationalStateForm", () => {
  it("returns null for the empty model (confirming nothing is not a confirmation)", () => {
    expect(serializeOperationalStateForm(emptyOperationalStateForm(), TZ)).toBeNull();
  });

  it("returns null for a note-only model (a note alone never satisfies a confirmation)", () => {
    const model = { ...emptyOperationalStateForm(), note: "all quiet" };
    expect(serializeOperationalStateForm(model, TZ)).toBeNull();
  });

  it("omits unconfirmed dimensions entirely (absent, never a fabricated value)", () => {
    const model = { ...emptyOperationalStateForm(), staffing: "shortfall" as const };
    const state = serializeOperationalStateForm(model, TZ);
    expect(state).toEqual({ staffing: "shortfall" });
    expect(Object.prototype.hasOwnProperty.call(state, "operatingStatus")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(state, "promoWindows")).toBe(false);
  });

  it("confirm-toggled empty list serializes as [] (operator confirmed NONE, distinct from absent)", () => {
    const model = { ...emptyOperationalStateForm(), confirmPromoWindows: true };
    expect(serializeOperationalStateForm(model, TZ)).toEqual({ promoWindows: [] });
  });

  it("converts interval drafts to org-timezone instants with half-open day boundaries", () => {
    const model = {
      ...emptyOperationalStateForm(),
      confirmPromoWindows: true,
      promoWindows: [
        { startDate: "2026-06-01", endDate: "2026-06-15", openEnded: false, label: "june glow" },
      ],
    };
    expect(serializeOperationalStateForm(model, TZ)).toEqual({
      promoWindows: [
        {
          start: "2026-05-31T16:00:00.000Z",
          end: "2026-06-15T16:00:00.000Z",
          label: "june glow",
        },
      ],
    });
  });

  it("omits end for an open-ended interval and label when blank", () => {
    const model = {
      ...emptyOperationalStateForm(),
      confirmClosures: true,
      closures: [{ startDate: "2026-06-20", endDate: "", openEnded: true, label: "  " }],
    };
    const state = serializeOperationalStateForm(model, TZ);
    expect(state?.closures).toEqual([{ start: "2026-06-19T16:00:00.000Z" }]);
  });

  it("attaches a trimmed note alongside a confirmed dimension", () => {
    const model = {
      ...emptyOperationalStateForm(),
      inventory: "outage" as const,
      note: "  filler restock due friday  ",
    };
    expect(serializeOperationalStateForm(model, TZ)).toEqual({
      inventory: "outage",
      note: "filler restock due friday",
    });
  });
});

describe("prefillFromState", () => {
  it("maps the latest confirmed state back onto the form, leaving unconfirmed dimensions unset", () => {
    const model = prefillFromState(
      {
        staffing: "shortfall",
        promoWindows: [
          {
            start: "2026-05-31T16:00:00.000Z",
            end: "2026-06-15T16:00:00.000Z",
            label: "june glow",
          },
        ],
      },
      TZ,
    );
    expect(model.staffing).toBe("shortfall");
    expect(model.operatingStatus).toBe("");
    expect(model.inventory).toBe("");
    expect(model.confirmPromoWindows).toBe(true);
    expect(model.promoWindows).toEqual([
      { startDate: "2026-06-01", endDate: "2026-06-15", openEnded: false, label: "june glow" },
    ]);
    expect(model.confirmClosures).toBe(false);
  });

  it("distinguishes confirmed-none ([]) from absent when prefilling", () => {
    const model = prefillFromState({ promoWindows: [] }, TZ);
    expect(model.confirmPromoWindows).toBe(true);
    expect(model.promoWindows).toEqual([]);
    expect(model.confirmClosures).toBe(false);
  });

  it("prefills an open-ended interval", () => {
    const model = prefillFromState({ closures: [{ start: "2026-06-19T16:00:00.000Z" }] }, TZ);
    expect(model.closures).toEqual([
      { startDate: "2026-06-20", endDate: "", openEnded: true, label: "" },
    ]);
  });
});

describe("intervalDraftError", () => {
  it("requires a start date", () => {
    expect(intervalDraftError({ startDate: "", endDate: "", openEnded: true, label: "" })).toMatch(
      /start date/i,
    );
  });

  it("requires an end date unless open-ended", () => {
    expect(
      intervalDraftError({ startDate: "2026-06-01", endDate: "", openEnded: false, label: "" }),
    ).toMatch(/end date/i);
    expect(
      intervalDraftError({ startDate: "2026-06-01", endDate: "", openEnded: true, label: "" }),
    ).toBeNull();
  });

  it("rejects an end date before the start date but allows a single-day window", () => {
    expect(
      intervalDraftError({
        startDate: "2026-06-15",
        endDate: "2026-06-01",
        openEnded: false,
        label: "",
      }),
    ).toMatch(/before/i);
    expect(
      intervalDraftError({
        startDate: "2026-06-01",
        endDate: "2026-06-01",
        openEnded: false,
        label: "",
      }),
    ).toBeNull();
  });
});
```

- [ ] **Step 4.2: Run the test, verify it fails on the missing module**

```bash
pnpm --filter @switchboard/dashboard test -- form-model
```

Expected: FAIL with a module-resolve error for `../form-model`.

- [ ] **Step 4.3: Implement the form model**

Create `apps/dashboard/src/components/settings/operational-state/form-model.ts`:

```ts
// Pure form model for the operational-state editor (Riley v3 slice 4b).
// Carries the form honesty semantics so they are unit-testable without DOM
// machinery: absent dimension = unconfirmed (never a pre-checked
// "open"/"normal"); confirm-toggled [] = operator confirmed NONE, distinct
// from absent; a note alone never serializes to a confirmation.

import type { OperationalInterval, OperationalState } from "@switchboard/schemas";
import { instantToInclusiveEndDate, instantToLocalDate, localDateToInstant } from "./local-date";

const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface IntervalDraft {
  /** Inclusive local start date (YYYY-MM-DD) in the org timezone. */
  startDate: string;
  /** Inclusive local end date; ignored when openEnded. */
  endDate: string;
  /** "Until further notice": serializes with no end bound. */
  openEnded: boolean;
  label: string;
}

export interface OperationalStateFormModel {
  operatingStatus: "" | "open" | "temporarily_closed";
  staffing: "" | "normal" | "shortfall";
  inventory: "" | "normal" | "outage";
  /** Checked = the operator IS confirming this list ([] = confirmed none). */
  confirmPromoWindows: boolean;
  promoWindows: IntervalDraft[];
  confirmClosures: boolean;
  closures: IntervalDraft[];
  note: string;
}

/** HONESTY FLOOR: every dimension starts unconfirmed; nothing defaults to "open"/"normal". */
export function emptyOperationalStateForm(): OperationalStateFormModel {
  return {
    operatingStatus: "",
    staffing: "",
    inventory: "",
    confirmPromoWindows: false,
    promoWindows: [],
    confirmClosures: false,
    closures: [],
    note: "",
  };
}

export function emptyIntervalDraft(): IntervalDraft {
  return { startDate: "", endDate: "", openEnded: false, label: "" };
}

/** Human-readable validation message for one draft, or null when valid. */
export function intervalDraftError(draft: IntervalDraft): string | null {
  if (!LOCAL_DATE_RE.test(draft.startDate)) return "Start date is required";
  if (!draft.openEnded) {
    if (!LOCAL_DATE_RE.test(draft.endDate)) {
      return "End date is required (or mark as open-ended)";
    }
    // Lexical compare is correct for YYYY-MM-DD. Same-day is a valid
    // single-day window: the end converts to the start of the NEXT local day.
    if (draft.endDate < draft.startDate) return "End date must not be before the start date";
  }
  return null;
}

function draftToInterval(draft: IntervalDraft, timeZone: string): OperationalInterval {
  const label = draft.label.trim();
  return {
    start: localDateToInstant(draft.startDate, timeZone, "start"),
    ...(draft.openEnded ? {} : { end: localDateToInstant(draft.endDate, timeZone, "end") }),
    ...(label !== "" ? { label } : {}),
  };
}

function intervalToDraft(interval: OperationalInterval, timeZone: string): IntervalDraft {
  return {
    startDate: instantToLocalDate(interval.start, timeZone),
    endDate: interval.end ? instantToInclusiveEndDate(interval.end, timeZone) : "",
    openEnded: interval.end === undefined,
    label: interval.label ?? "",
  };
}

/**
 * Serialize the form to an OperationalState payload, or null when the model
 * confirms NO operational dimension (the empty and note-only cases). The
 * editor disables submit on null; the proxy, route, store, and DB CHECK all
 * reject the same payloads independently. Callers must validate interval
 * drafts (intervalDraftError) before serializing.
 */
export function serializeOperationalStateForm(
  model: OperationalStateFormModel,
  timeZone: string,
): OperationalState | null {
  const state: OperationalState = {};
  if (model.operatingStatus !== "") state.operatingStatus = model.operatingStatus;
  if (model.staffing !== "") state.staffing = model.staffing;
  if (model.inventory !== "") state.inventory = model.inventory;
  if (model.confirmPromoWindows) {
    state.promoWindows = model.promoWindows.map((d) => draftToInterval(d, timeZone));
  }
  if (model.confirmClosures) {
    state.closures = model.closures.map((d) => draftToInterval(d, timeZone));
  }
  const note = model.note.trim();
  if (note !== "") state.note = note;

  const confirmsAnything =
    state.operatingStatus !== undefined ||
    state.staffing !== undefined ||
    state.inventory !== undefined ||
    state.promoWindows !== undefined ||
    state.closures !== undefined;
  return confirmsAnything ? state : null;
}

/** Map the LATEST confirmed state back onto the form (pre-filling from the latest confirmation is allowed; unconfirmed dimensions stay unset). */
export function prefillFromState(
  state: OperationalState,
  timeZone: string,
): OperationalStateFormModel {
  return {
    operatingStatus: state.operatingStatus ?? "",
    staffing: state.staffing ?? "",
    inventory: state.inventory ?? "",
    confirmPromoWindows: state.promoWindows !== undefined,
    promoWindows: (state.promoWindows ?? []).map((i) => intervalToDraft(i, timeZone)),
    confirmClosures: state.closures !== undefined,
    closures: (state.closures ?? []).map((i) => intervalToDraft(i, timeZone)),
    note: state.note ?? "",
  };
}
```

- [ ] **Step 4.4: Run the tests, verify green**

```bash
pnpm --filter @switchboard/dashboard test -- form-model
pnpm typecheck
```

Expected: PASS (13 tests); typecheck clean.

- [ ] **Step 4.5: Commit**

```bash
git add apps/dashboard/src/components/settings/operational-state/form-model.ts \
        apps/dashboard/src/components/settings/operational-state/__tests__/form-model.test.ts
git commit -m "feat(dashboard): operational-state form model with honesty semantics (riley v3 slice 4b)"
```

---

## Task 5: Editor UI (section, form, interval editor) + page wiring

**Files:**

- Create: `apps/dashboard/src/components/settings/operational-state/__tests__/operational-state-section.test.tsx`
- Create: `apps/dashboard/src/components/settings/operational-state/interval-list-editor.tsx`
- Create: `apps/dashboard/src/components/settings/operational-state/operational-state-form.tsx`
- Create: `apps/dashboard/src/components/settings/operational-state/operational-state-section.tsx`
- Modify: `apps/dashboard/src/app/(auth)/settings/business-facts/page.tsx`
- Modify: `apps/dashboard/src/app/__tests__/settings-business-facts-page.test.tsx`

- [ ] **Step 5.1: Write the failing section test**

Create `apps/dashboard/src/components/settings/operational-state/__tests__/operational-state-section.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const useOperationalState = vi.fn();
const useRecordOperationalState = vi.fn();
vi.mock("@/hooks/use-operational-state", () => ({
  useOperationalState: (...args: unknown[]) => useOperationalState(...args),
  useRecordOperationalState: (...args: unknown[]) => useRecordOperationalState(...args),
  OperationalStateValidationError: class extends Error {},
}));
const toast = vi.fn();
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast }) }));

import { OperationalStateSection } from "../operational-state-section";

const WIRE_CONFIRMATION = {
  id: "osc_1",
  organizationId: "org-1",
  state: { staffing: "shortfall" as const },
  confirmedBy: "principal-7",
  confirmedAt: "2026-06-04T02:00:00.000Z",
  createdAt: "2026-06-04T02:00:00.000Z",
};

function mount() {
  return render(<OperationalStateSection deploymentId="dep_1" timezone="Asia/Singapore" />);
}

describe("OperationalStateSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRecordOperationalState.mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  it("gates loading on !data && !error, not isLoading (no false form on a disabled query)", () => {
    useOperationalState.mockReturnValue({ data: undefined, error: null, isLoading: false });
    mount();
    expect(screen.queryByRole("button", { name: /confirm operational state/i })).toBeNull();
  });

  it("renders honest absence for a never-confirmed org: no fabricated defaults, no re-confirm shortcut", () => {
    useOperationalState.mockReturnValue({ data: { confirmation: null }, error: null });
    mount();
    expect(screen.getByText(/never confirmed/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /everything still accurate/i })).toBeNull();
    // All three enum dimensions start at the "Not confirming" placeholder.
    expect(screen.getAllByText(/not confirming/i).length).toBeGreaterThanOrEqual(3);
    // Nothing confirmed yet, so submit is disabled.
    expect(screen.getByRole("button", { name: /confirm operational state/i })).toBeDisabled();
  });

  it("renders a load failure honestly instead of an empty form", () => {
    useOperationalState.mockReturnValue({ data: undefined, error: new Error("boom") });
    mount();
    expect(screen.getByText(/failed to load operational state/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /confirm operational state/i })).toBeNull();
  });

  it("shows the freshness line (when + who) for the latest confirmation", () => {
    useOperationalState.mockReturnValue({
      data: { confirmation: WIRE_CONFIRMATION },
      error: null,
    });
    mount();
    // 2026-06-04T02:00Z is 10:00 in Asia/Singapore.
    expect(screen.getByText(/last confirmed/i)).toBeInTheDocument();
    expect(screen.getByText(/10:00/)).toBeInTheDocument();
    expect(screen.getByText(/by principal-7/i)).toBeInTheDocument();
  });

  it("omits the by-clause when confirmedBy is null (no invented identity)", () => {
    useOperationalState.mockReturnValue({
      data: { confirmation: { ...WIRE_CONFIRMATION, confirmedBy: null } },
      error: null,
    });
    mount();
    expect(screen.getByText(/last confirmed/i)).toBeInTheDocument();
    expect(screen.queryByText(/by /i)).toBeNull();
  });

  it("'everything still accurate' re-records the latest state VERBATIM (fresh confirmedAt is server-side)", () => {
    const mutate = vi.fn();
    useRecordOperationalState.mockReturnValue({ mutate, isPending: false });
    useOperationalState.mockReturnValue({
      data: { confirmation: WIRE_CONFIRMATION },
      error: null,
    });
    mount();
    fireEvent.click(screen.getByRole("button", { name: /everything still accurate/i }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]).toEqual(WIRE_CONFIRMATION.state);
  });

  it("confirming 'none active' submits an explicit [] (distinct from absent)", () => {
    const mutate = vi.fn();
    useRecordOperationalState.mockReturnValue({ mutate, isPending: false });
    useOperationalState.mockReturnValue({ data: { confirmation: null }, error: null });
    mount();
    const submit = screen.getByRole("button", { name: /confirm operational state/i });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/confirm current promotions/i));
    expect(screen.getByText(/confirming there are none active/i)).toBeInTheDocument();
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]).toEqual({ promoWindows: [] });
  });

  it("a window with dates submits org-timezone instants (conversion at the edge)", () => {
    const mutate = vi.fn();
    useRecordOperationalState.mockReturnValue({ mutate, isPending: false });
    useOperationalState.mockReturnValue({ data: { confirmation: null }, error: null });
    mount();
    fireEvent.click(screen.getByLabelText(/confirm current promotions/i));
    fireEvent.click(screen.getByRole("button", { name: /add promotion/i }));
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: "2026-06-01" } });
    fireEvent.change(screen.getByLabelText(/end date/i), { target: { value: "2026-06-15" } });
    fireEvent.change(screen.getByLabelText(/label/i), { target: { value: "june glow" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm operational state/i }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      promoWindows: [
        { start: "2026-05-31T16:00:00.000Z", end: "2026-06-15T16:00:00.000Z", label: "june glow" },
      ],
    });
  });

  it("a note alone never enables submit (note-only saves impossible at the UI layer)", () => {
    const mutate = vi.fn();
    useRecordOperationalState.mockReturnValue({ mutate, isPending: false });
    useOperationalState.mockReturnValue({ data: { confirmation: null }, error: null });
    mount();
    fireEvent.change(screen.getByLabelText(/note/i), { target: { value: "all quiet" } });
    expect(screen.getByRole("button", { name: /confirm operational state/i })).toBeDisabled();
    expect(screen.getByText(/note alone is not a confirmation/i)).toBeInTheDocument();
  });

  it("prefills the form from the latest confirmation and submits the operator's restated state", () => {
    const mutate = vi.fn();
    useRecordOperationalState.mockReturnValue({ mutate, isPending: false });
    useOperationalState.mockReturnValue({
      data: { confirmation: WIRE_CONFIRMATION },
      error: null,
    });
    mount();
    // staffing: "shortfall" is prefilled, so the form already confirms a
    // dimension and submit is enabled without further interaction.
    const submit = screen.getByRole("button", { name: /confirm operational state/i });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(mutate.mock.calls[0]?.[0]).toEqual({ staffing: "shortfall" });
  });

  it("an invalid interval blocks submit with a message", () => {
    useRecordOperationalState.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useOperationalState.mockReturnValue({ data: { confirmation: null }, error: null });
    mount();
    fireEvent.click(screen.getByLabelText(/confirm current promotions/i));
    fireEvent.click(screen.getByRole("button", { name: /add promotion/i }));
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: "2026-06-15" } });
    fireEvent.change(screen.getByLabelText(/end date/i), { target: { value: "2026-06-01" } });
    expect(screen.getByText(/must not be before the start date/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirm operational state/i })).toBeDisabled();
  });
});
```

- [ ] **Step 5.2: Run the test, verify it fails on the missing module**

```bash
pnpm --filter @switchboard/dashboard test -- operational-state-section
```

Expected: FAIL with a module-resolve error for `../operational-state-section`.

- [ ] **Step 5.3: Implement the interval list editor**

Create `apps/dashboard/src/components/settings/operational-state/interval-list-editor.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { emptyIntervalDraft, intervalDraftError, type IntervalDraft } from "./form-model";

interface IntervalListEditorProps {
  idPrefix: string;
  confirmLabel: string;
  noneNotice: string;
  addLabel: string;
  confirmed: boolean;
  drafts: IntervalDraft[];
  onChange: (confirmed: boolean, drafts: IntervalDraft[]) => void;
}

/**
 * Confirm-toggled interval list. Unchecked = the operator is NOT confirming
 * this dimension (absent from the payload); checked with zero rows = an
 * explicit "none active" ([]); checked with rows = the windows, entered as
 * inclusive local dates.
 */
export function IntervalListEditor({
  idPrefix,
  confirmLabel,
  noneNotice,
  addLabel,
  confirmed,
  drafts,
  onChange,
}: IntervalListEditorProps) {
  const updateDraft = (index: number, patch: Partial<IntervalDraft>) => {
    onChange(
      confirmed,
      drafts.map((d, i) => (i === index ? { ...d, ...patch } : d)),
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Checkbox
          id={`${idPrefix}-confirm`}
          checked={confirmed}
          onCheckedChange={(checked) => onChange(checked === true, drafts)}
        />
        <Label htmlFor={`${idPrefix}-confirm`}>{confirmLabel}</Label>
      </div>

      {confirmed && drafts.length === 0 && (
        <p className="text-[13px] text-muted-foreground">{noneNotice}</p>
      )}

      {confirmed &&
        drafts.map((draft, index) => {
          const error = intervalDraftError(draft);
          return (
            <div key={index} className="rounded-md border border-border p-3 space-y-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor={`${idPrefix}-${index}-start`}>Start date</Label>
                  <Input
                    id={`${idPrefix}-${index}-start`}
                    type="date"
                    value={draft.startDate}
                    onChange={(e) => updateDraft(index, { startDate: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${idPrefix}-${index}-end`}>End date</Label>
                  <Input
                    id={`${idPrefix}-${index}-end`}
                    type="date"
                    value={draft.endDate}
                    disabled={draft.openEnded}
                    onChange={(e) => updateDraft(index, { endDate: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`${idPrefix}-${index}-open-ended`}
                  checked={draft.openEnded}
                  onCheckedChange={(checked) => updateDraft(index, { openEnded: checked === true })}
                />
                <Label htmlFor={`${idPrefix}-${index}-open-ended`}>
                  Open-ended (until further notice)
                </Label>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${idPrefix}-${index}-label`}>Label</Label>
                <Input
                  id={`${idPrefix}-${index}-label`}
                  placeholder="e.g. june glow promo"
                  value={draft.label}
                  onChange={(e) => updateDraft(index, { label: e.target.value })}
                />
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  onChange(
                    confirmed,
                    drafts.filter((_, i) => i !== index),
                  )
                }
              >
                Remove
              </Button>
            </div>
          );
        })}

      {confirmed && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange(confirmed, [...drafts, emptyIntervalDraft()])}
        >
          {addLabel}
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 5.4: Implement the form**

Create `apps/dashboard/src/components/settings/operational-state/operational-state-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import { INVENTORY_VALUES, OPERATING_STATUS_VALUES, STAFFING_VALUES } from "@switchboard/schemas";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  intervalDraftError,
  serializeOperationalStateForm,
  type OperationalStateFormModel,
} from "./form-model";
import { IntervalListEditor } from "./interval-list-editor";
import type { OperationalState } from "@switchboard/schemas";

/** Sentinel for the explicit "Not confirming" select item (Radix forbids empty-string values). */
const UNSET = "__not_confirming__";

const OPERATING_STATUS_LABELS: Record<(typeof OPERATING_STATUS_VALUES)[number], string> = {
  open: "Open",
  temporarily_closed: "Temporarily closed",
};
const STAFFING_LABELS: Record<(typeof STAFFING_VALUES)[number], string> = {
  normal: "Normal",
  shortfall: "Shortfall",
};
const INVENTORY_LABELS: Record<(typeof INVENTORY_VALUES)[number], string> = {
  normal: "Normal",
  outage: "Outage",
};

interface EnumDimensionProps<V extends string> {
  id: string;
  label: string;
  value: "" | V;
  values: readonly V[];
  labels: Record<V, string>;
  onChange: (value: "" | V) => void;
}

function EnumDimension<V extends string>({
  id,
  label,
  value,
  values,
  labels,
  onChange,
}: EnumDimensionProps<V>) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value === "" ? undefined : value}
        onValueChange={(v) => onChange(v === UNSET ? "" : (v as V))}
      >
        <SelectTrigger id={id}>
          {/* HONESTY FLOOR: unset renders as "Not confirming", never a
              pre-checked "open"/"normal". */}
          <SelectValue placeholder="Not confirming" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNSET}>Not confirming</SelectItem>
          {values.map((v) => (
            <SelectItem key={v} value={v}>
              {labels[v]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

interface OperationalStateFormProps {
  initial: OperationalStateFormModel;
  timezone: string;
  isSaving: boolean;
  onSubmit: (state: OperationalState) => void;
}

export function OperationalStateForm({
  initial,
  timezone,
  isSaving,
  onSubmit,
}: OperationalStateFormProps) {
  const [model, setModel] = useState<OperationalStateFormModel>(initial);

  const intervalsValid =
    (!model.confirmPromoWindows || model.promoWindows.every((d) => !intervalDraftError(d))) &&
    (!model.confirmClosures || model.closures.every((d) => !intervalDraftError(d)));
  const serialized = intervalsValid ? serializeOperationalStateForm(model, timezone) : null;
  const noteOnly = serialized === null && model.note.trim() !== "";

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (serialized) onSubmit(serialized);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <EnumDimension
          id="operatingStatus"
          label="Operating status"
          value={model.operatingStatus}
          values={OPERATING_STATUS_VALUES}
          labels={OPERATING_STATUS_LABELS}
          onChange={(v) => setModel({ ...model, operatingStatus: v })}
        />
        <EnumDimension
          id="staffing"
          label="Staffing"
          value={model.staffing}
          values={STAFFING_VALUES}
          labels={STAFFING_LABELS}
          onChange={(v) => setModel({ ...model, staffing: v })}
        />
        <EnumDimension
          id="inventory"
          label="Inventory"
          value={model.inventory}
          values={INVENTORY_VALUES}
          labels={INVENTORY_LABELS}
          onChange={(v) => setModel({ ...model, inventory: v })}
        />
      </div>

      <IntervalListEditor
        idPrefix="promoWindows"
        confirmLabel="Confirm current promotions"
        noneNotice="You are confirming there are none active."
        addLabel="Add promotion"
        confirmed={model.confirmPromoWindows}
        drafts={model.promoWindows}
        onChange={(confirmed, drafts) =>
          setModel({ ...model, confirmPromoWindows: confirmed, promoWindows: drafts })
        }
      />

      <IntervalListEditor
        idPrefix="closures"
        confirmLabel="Confirm current closures"
        noneNotice="You are confirming there are none active."
        addLabel="Add closure"
        confirmed={model.confirmClosures}
        drafts={model.closures}
        onChange={(confirmed, drafts) =>
          setModel({ ...model, confirmClosures: confirmed, closures: drafts })
        }
      />

      <div className="space-y-1">
        <Label htmlFor="operational-note">Note (optional)</Label>
        <Textarea
          id="operational-note"
          placeholder="Context for this confirmation"
          value={model.note}
          onChange={(e) => setModel({ ...model, note: e.target.value })}
        />
        {noteOnly && (
          <p className="text-xs text-muted-foreground">
            A note alone is not a confirmation. Confirm at least one dimension above.
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={serialized === null || isSaving}>
          Confirm operational state
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 5.5: Implement the section**

Create `apps/dashboard/src/components/settings/operational-state/operational-state-section.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import {
  OperationalStateValidationError,
  useOperationalState,
  useRecordOperationalState,
} from "@/hooks/use-operational-state";
import type { OperationalState } from "@switchboard/schemas";
import { emptyOperationalStateForm, prefillFromState } from "./form-model";
import { ensureTimeZone } from "./local-date";
import { OperationalStateForm } from "./operational-state-form";

interface OperationalStateSectionProps {
  deploymentId: string;
  timezone: string;
}

/**
 * Sibling of the business-facts editor (Riley v3 slice 4b), NOT part of its
 * form or PUT payload: operational state is an append-only stream of dated
 * confirmations (4a), so every save here POSTs a NEW confirmation row.
 * "Everything still accurate" re-records the latest state verbatim; the
 * fresh confirmedAt the route assigns IS the freshness re-anchor.
 */
export function OperationalStateSection({ deploymentId, timezone }: OperationalStateSectionProps) {
  const latest = useOperationalState(deploymentId);
  const record = useRecordOperationalState(deploymentId);
  const { toast } = useToast();
  const tz = ensureTimeZone(timezone);

  const save = (state: OperationalState) => {
    record.mutate(state, {
      onSuccess: () => toast({ title: "Operational state confirmed" }),
      onError: (e) =>
        toast({
          variant: "destructive",
          title: "Couldn't confirm",
          description:
            e instanceof OperationalStateValidationError
              ? "Some fields are invalid. Please review and try again."
              : "Something went wrong recording your confirmation.",
        }),
    });
  };

  // RQ gotcha: gate on !data && !error, never isLoading alone (a disabled
  // query is pending+idle with isLoading=false).
  if (!latest.data && !latest.error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Operational state</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32" />
        </CardContent>
      </Card>
    );
  }

  if (latest.error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Operational state</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">
            Failed to load operational state. Please refresh and try again.
          </p>
        </CardContent>
      </Card>
    );
  }

  const confirmation = latest.data?.confirmation ?? null;
  const freshness = confirmation
    ? new Intl.DateTimeFormat("en-SG", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: tz,
      }).format(new Date(confirmation.confirmedAt))
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Operational state</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {confirmation ? (
            <p className="text-[14px] text-muted-foreground">
              Last confirmed {freshness}
              {confirmation.confirmedBy ? ` by ${confirmation.confirmedBy}` : ""}
            </p>
          ) : (
            <p className="text-[14px] text-muted-foreground">
              Never confirmed. Riley treats operational context as unknown until you confirm it.
            </p>
          )}
          {confirmation && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={record.isPending}
              onClick={() => save(confirmation.state)}
            >
              Everything still accurate
            </Button>
          )}
        </div>

        <OperationalStateForm
          key={confirmation?.id ?? "never-confirmed"}
          initial={
            confirmation ? prefillFromState(confirmation.state, tz) : emptyOperationalStateForm()
          }
          timezone={tz}
          isSaving={record.isPending}
          onSubmit={save}
        />
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5.6: Run the section test, verify green**

```bash
pnpm --filter @switchboard/dashboard test -- operational-state-section
```

Expected: PASS (11 tests). If Radix Select/Checkbox interactions misbehave under jsdom, the failing affordance must be re-expressed through accessible roles/labels, not skipped; the form-model tests already pin the serialization semantics independently.

- [ ] **Step 5.7: Wire the section into the settings page + update the page test**

Modify `apps/dashboard/src/app/(auth)/settings/business-facts/page.tsx`:

1. Add the import:

```tsx
import { OperationalStateSection } from "@/components/settings/operational-state/operational-state-section";
```

2. In the final return, after `<BusinessFactsForm ... />`, add:

```tsx
{
  deploymentId && (
    <OperationalStateSection
      deploymentId={deploymentId}
      timezone={(saved?.timezone as string | undefined) ?? "Asia/Singapore"}
    />
  );
}
```

(`saved` is the existing `facts.data!.facts` local; for a missing/malformed facts row it is null and the fallback applies, mirroring the alex builder.)

Modify `apps/dashboard/src/app/__tests__/settings-business-facts-page.test.tsx`: next to the existing `vi.mock` calls add

```tsx
vi.mock("@/components/settings/operational-state/operational-state-section", () => ({
  OperationalStateSection: ({ timezone }: { timezone: string }) => (
    <div data-testid="operational-state-section" data-timezone={timezone} />
  ),
}));
```

and add two tests inside the existing `describe`:

```tsx
it("renders the operational-state sibling section when a deployment exists", () => {
  useOrgDeploymentId.mockReturnValue({ deploymentId: "dep_1", isLoading: false, isError: false });
  useBusinessFacts.mockReturnValue({ data: { facts: null, status: "missing" }, error: null });
  render(<BusinessFactsPage />);
  expect(screen.getByTestId("operational-state-section")).toBeInTheDocument();
  expect(screen.getByTestId("operational-state-section").dataset.timezone).toBe("Asia/Singapore");
});

it("passes the saved org timezone to the operational-state section", () => {
  useOrgDeploymentId.mockReturnValue({ deploymentId: "dep_1", isLoading: false, isError: false });
  useBusinessFacts.mockReturnValue({
    data: {
      status: "present",
      facts: { businessName: "Saved Clinic", timezone: "America/New_York" },
    },
    error: null,
  });
  render(<BusinessFactsPage />);
  expect(screen.getByTestId("operational-state-section").dataset.timezone).toBe("America/New_York");
});
```

- [ ] **Step 5.8: Run the page test + full dashboard suite + typecheck + next build**

```bash
pnpm --filter @switchboard/dashboard test -- settings-business-facts-page
pnpm --filter @switchboard/dashboard test
pnpm typecheck
pnpm --filter @switchboard/dashboard build
```

Expected: page tests green (existing + 2 new); full dashboard suite green (2097 baseline + ~41 new); typecheck clean; `next build` green (this is what catches a stray `.js` import suffix).

- [ ] **Step 5.9: Commit**

```bash
git add apps/dashboard/src/components/settings/operational-state \
        "apps/dashboard/src/app/(auth)/settings/business-facts/page.tsx" \
        apps/dashboard/src/app/__tests__/settings-business-facts-page.test.tsx
git commit -m "feat(dashboard): operational-state editor section on the business-facts surface (riley v3 slice 4b)"
```

---

## Task 6: Real-app verification (visual + append-only proof)

**Files:** none (evidence only; tick checkboxes + record evidence in this doc)

- [ ] **Step 6.1: Launch the stack detached**

```bash
# API (no dotenv; load root .env explicitly). Do NOT run the worktree-init port-killer.
lsof -ti :3000 >/dev/null 2>&1 && echo "PORT 3000 BUSY (another session?) - investigate before killing anything" || true
(cd apps/api && nohup node --env-file=../../.env ../../node_modules/.bin/tsx src/server.ts > /tmp/4b-api.log 2>&1 &) && disown || true
# Dashboard dev server on :3002
(cd apps/dashboard && nohup pnpm dev > /tmp/4b-dash.log 2>&1 &) && disown || true
sleep 8
curl -s http://localhost:3000/health
curl -s -o /dev/null -w "%{http_code}" http://localhost:3002/settings/business-facts
```

Expected: health OK; dashboard 200 (DEV_BYPASS_AUTH=true in `apps/dashboard/.env.local`; if redirected to /login, re-check the env-sync corruption fix).

- [ ] **Step 6.2: Baseline DB state + before-screenshot**

```bash
PGPASSWORD=switchboard psql -h localhost -U switchboard -d switchboard -tc \
  'SELECT count(*) FROM "OperationalStateConfirmation";'
```

Record the count (expect 0 for a fresh table). Screenshot the surface headlessly (playwright-core + system Chrome from /tmp, then Read the PNG): the section must show "Never confirmed", all selects at "Not confirming", submit disabled.

- [ ] **Step 6.3: Save a confirmation through the real UI**

Drive the browser: select Staffing = Shortfall, check "Confirm current promotions", add a promotion 2026-06-01 to 2026-06-15 labelled "june glow", submit. Screenshot the after state: freshness line "Last confirmed ..." appears.

```bash
PGPASSWORD=switchboard psql -h localhost -U switchboard -d switchboard -tc \
  'SELECT count(*), max("confirmedBy") FROM "OperationalStateConfirmation";'
```

Expected: count = baseline + 1; `confirmedBy` is the dev principal (or NULL under the dev fallback key, also honest).

- [ ] **Step 6.4: Prove append-only via the re-confirm action**

Click "Everything still accurate". Then:

```bash
PGPASSWORD=switchboard psql -h localhost -U switchboard -d switchboard -tc \
  'SELECT count(*) FROM "OperationalStateConfirmation";'
PGPASSWORD=switchboard psql -h localhost -U switchboard -d switchboard -c \
  'SELECT id, "staffing", "promoWindows"::text, "confirmedAt" FROM "OperationalStateConfirmation" ORDER BY "confirmedAt";'
```

Expected: count = baseline + 2 (TWO rows from two saves, same state, different `confirmedAt`): the definition-of-done append proof. Screenshot the refreshed freshness line.

- [ ] **Step 6.5: Stop the dev servers; record evidence in this doc; commit**

```bash
# kill only the PIDs we started (from the nohup logs), not the ports
git add docs/superpowers/plans/2026-06-05-riley-v3-slice4b-operational-state-editor.md
git commit -m "docs(plans): record slice-4b real-app verification evidence"
```

---

## Task 7: Full verification sweep (gates, scope-fence proofs, evals)

- [ ] **Step 7.1: Full build + typecheck + suites**

```bash
pnpm build && pnpm typecheck
pnpm --filter @switchboard/schemas test
pnpm --filter @switchboard/db test          # gate: no NEW failures beyond the PG trio
pnpm --filter @switchboard/core test
pnpm --filter @switchboard/api test
pnpm --filter @switchboard/dashboard test
```

- [ ] **Step 7.2: Eval gates, byte-comparison against baseline**

```bash
pnpm eval:riley > /tmp/4b-post-eval-riley.txt 2>&1; echo "exit: $?"
pnpm eval:governance > /tmp/4b-post-eval-governance.txt 2>&1; echo "exit: $?"
diff /tmp/4b-baselines/eval-riley.txt /tmp/4b-post-eval-riley.txt && echo "riley BYTE-UNCHANGED"
diff /tmp/4b-baselines/eval-governance.txt /tmp/4b-post-eval-governance.txt && echo "governance BYTE-UNCHANGED"
pnpm eval:alex-conversation > /tmp/4b-post-eval-alex.txt 2>&1; echo "exit: $?"; tail -3 /tmp/4b-post-eval-alex.txt
```

Expected: riley + governance exit 0 and byte-identical. Alex eval: if still env-blocked, record the skip line and rely on the static proof chain (substrate untouched, diff-proven below).

- [ ] **Step 7.3: Scope-fence grep proofs (record output in the PR body)**

```bash
git fetch origin main
# 1. The complete diff surface: must list ONLY the files in "File structure":
git diff --stat origin/main...HEAD
# 2. Zero diff under the fenced trees (4c untouched; no substrate changes):
git diff origin/main...HEAD -- packages/ evals/ | head -5                      # expect empty
# 3. Business-facts form, schema, and store byte-untouched:
git diff origin/main...HEAD -- apps/dashboard/src/components/settings/business-facts packages/schemas/src/marketplace.ts packages/db/src/stores/prisma-business-facts-store.ts | head -5   # expect empty
# 4. No PlatformIngress caller in the diff:
git diff origin/main...HEAD | grep -i "platformingress"                        # expect no code matches (plan prose only)
# 5. The 4c read is called nowhere in this slice:
git diff origin/main...HEAD | grep "getConfirmationsOverlappingWindow"         # expect no matches (exit 1)
# 6. Reserved unknowns still unknown (no consumer flips):
git diff origin/main...HEAD -- packages/ad-optimizer packages/core/src/recommendations | head -5   # expect empty
```

- [ ] **Step 7.4: Lint, format, arch-check, route-class (separate CI jobs local lint does not cover)**

```bash
pnpm lint
pnpm format:check
pnpm arch:check
pnpm exec tsx .agent/tools/check-routes.ts --mode=error
```

- [ ] **Step 7.5: Code review**

Invoke `superpowers:requesting-code-review` against `git diff origin/main...HEAD`. Review focus: honesty floors from the UI inward (no default-open precheck anywhere; note-only save impossible at UI, proxy, route, store, DB; absence renders as never-confirmed), org-scoping (404 on cross-org, org never from the body), timezone day-boundary correctness, append-only contract (no update API touched), scope fence. Address findings or push back with reasoning (receiving-code-review discipline); re-run Task 7 gates after any change.

- [ ] **Step 7.6: Commit the evidence**

```bash
git add docs/superpowers/plans/2026-06-05-riley-v3-slice4b-operational-state-editor.md
git commit -m "docs(plans): record slice-4b verification evidence"
```

---

## Task 8: Land the PR

- [ ] **Step 8.1:** `git fetch origin main`; rebase onto live `origin/main`; re-run `pnpm build && pnpm typecheck` plus the api + dashboard suites after any rebase with upstream movement. Three-dot diffs only.
- [ ] **Step 8.2:** Push the branch; open ONE focused PR titled `feat(api,dashboard): riley v3 slice 4b operational-state operator editor`. Body: decisions A-G summary, honesty-floor proofs, append-only real-app evidence (two rows from two saves), scope-fence grep outputs, eval results incl. the alex-eval env blocker + static proof chain, "4c consumption is the follow-on slice".
- [ ] **Step 8.3:** Enable auto-merge (squash). Watch required checks. Known noise: chat gateway-bridge-attribution flake, api-auth prod-hardening flake (rerun before investigating), Eval Claim Classifier 401 (informational).
- [ ] **Step 8.4:** Post-merge: verify the first NON-CANCELLED completed main CI run whose tree contains the squash commit.

## Task 9: Teardown + memory + report

- [ ] **Step 9.1:** Same-day teardown: exit + remove the worktree, `git worktree prune`, delete the branch local + remote.
- [ ] **Step 9.2:** Update memory: 4b shipped (operator editor on the business-facts surface; POST-append + server confirmedAt + principal confirmedBy + half-open org-tz day boundaries); NEXT = 4c consumption (flips `businessContextFreshness`/`businessContextStable` via `getConfirmationsOverlappingWindow` vs `windowStartedAt`/`windowEndedAt` and unlocks `corroborated`).
- [ ] **Step 9.3:** Final report to the user.

---

## Real-app verification evidence (recorded 2026-06-05)

Environment note: the standard shared dev DB has `subscriptionStatus: "none"` and no `entitlementOverride` for `org_dev`, so the billing guard (402 "Active subscription required") blocks EVERY mutating API route in local dev, not just this slice's. Mutating shared-DB billing state was out of bounds, so verification ran on a scratch database (`switchboard_4b`: migrate deploy + seed + `entitlementOverride=true` there only), with this branch's API on :3000 and dashboard on :3012 (a parallel session held :3002; left untouched). The scratch DB was dropped after verification.

- BEFORE (screenshot): section renders "Never confirmed. Riley treats operational context as unknown until you confirm it."; all three selects at "Not confirming"; both confirm checkboxes unchecked; submit disabled; no "Everything still accurate" button. `SELECT count(*)` = 0.
- SAVE via the real UI (Staffing = Shortfall; Confirm current promotions; window 2026-06-01 to 2026-06-15 labelled "june glow"): success toast "Operational state confirmed"; freshness line "Last confirmed 5 Jun 2026, 8:31 am by principal_dev"; form prefilled from the latest confirmation; "Everything still accurate" appeared. Row 1: `staffing=shortfall`, `promoWindows=[{start: 2026-05-31T16:00:00.000Z, end: 2026-06-15T16:00:00.000Z, label: "june glow"}]` (exact half-open org-tz day boundaries: June 1 00:00 SGT / June 16 00:00 SGT), `confirmedBy=principal_dev` (the real auth principal), server-side `confirmedAt 00:31:08.718Z`.
- APPEND PROOF: clicking "Everything still accurate" produced a SECOND row with byte-identical state and a fresh `confirmedAt 00:31:36.191Z`. Two saves = two rows; nothing updated in place.
- Incidental notes: the API initially ran a stale pre-Task-1 dist (404 on the new route); rebuilt and restarted. A browser console warning "Select is changing from uncontrolled to controlled" appears on first dimension selection (Radix value undefined to value); cosmetic, matching the UNSET-sentinel design.

## Self-review (spec/handoff coverage)

- Spec 2.1 net-new paragraph (operator-editable operational-state source): Task 5 editor writes through Task 1's route into the 4a store; no other writer.
- Spec defer-list item 5 note (editor = extension of an existing surface, not a new dashboard): Decision A; only `page.tsx` changes on the existing surface.
- Spec 7.4 (freshness = staleness of the input itself): every save is a new `recordConfirmation` with route-supplied `confirmedAt`; "everything still accurate" re-records rather than touching any `updatedAt`.
- Roadmap Slice 4b lines ("operator can confirm/update operational state", "confirmation carries a validity interval", "editor save path; confirmation timestamp persisted"): Tasks 1-6; the validity-interval wording is satisfied by derived succession (Decision E), restated so nobody invents a `validUntil`.
- 4a handoff decisions A-D consumed: sibling store untouched (A), append-only derived validity (B: POST-only, no update API), field set unchanged (C: UI options come from the exported `*_VALUES` constants), write-path convention followed exactly (D: marketplace business-facts conventions, NOT PlatformIngress).
- Honesty floors: emptyOperationalStateForm test (no fabricated defaults), note-only null serialization + disabled submit + route 400 tests, [] vs absent pinned at form-model, route, and section layers; getLatest-null renders never-confirmed; no backfill, no auto-confirm on view, no writer other than the explicit operator action (grep proofs Task 7.3).
- Placeholder scan: no TBDs; every code step shows complete code. Type consistency: `marketplaceOperationalStateRoutes`, `useOperationalState`/`useRecordOperationalState`, `OperationalStateConfirmationWire`, `serializeOperationalStateForm`/`prefillFromState`/`intervalDraftError`/`emptyIntervalDraft`, `localDateToInstant`/`instantToLocalDate`/`instantToInclusiveEndDate`/`ensureTimeZone` used identically across tasks.
