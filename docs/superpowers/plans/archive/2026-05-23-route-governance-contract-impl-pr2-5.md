# Route Governance Contract v1 — Impl PR-2.5 Plan: routeTemplates Extraction + Cross-App-Type Tooling

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the surface-decoupling + tooling tail of Phase 3A: eliminate the surface-URL string literals in `packages/core/**` by routing them through a `RouteTemplates` dependency, add the cross-app-type doctrine line to `docs/DOCTRINE.md`, and ship a `check-routes` advisory rule that flags local app-side declarations duplicating `@switchboard/schemas` exports.

**Architecture:** PR-2 already moved the cross-app value types (ApprovalRecord, Handoff, ConversationState, projections, OperatorOverview) into `@switchboard/schemas`. PR-2.5 builds on that foundation in three independent slices:

1. **routeTemplates** — `RouteTemplates` interface in core defines the contract for surface-URL emission; surface adapters in `apps/api/` construct the `dashboardRouteTemplates` constant and inject it into the three affected projections (`listContactsForBrowse`, `adaptRecommendation`, `adaptHandoff`). After this slice, core never contains a literal `/contacts/...` URL.
2. **Doctrine line** — `docs/DOCTRINE.md` gains a new non-negotiable invariant: cross-app types live in `@switchboard/schemas`. The line is the human-side companion to slice 3's mechanical check.
3. **Cross-app-types check** — a new advisory in `.agent/tools/` that scans `apps/*/src/**/*.ts(x)` (excluding `__tests__/`) for **exported** local `interface` / `type` declarations whose name matches a known `@switchboard/schemas` export. Inline suppression via `// route-governance: local-view-model` covers deliberately-narrower local shapes (e.g. `MinimalApprovalRecord`, `ApprovalRecordForResponse`). The advisory ships in warning mode wired into the existing CI step that already runs the route-class advisory; PR-4 will flip both to error mode together.

**Tech Stack:** TypeScript (strict), Vitest (TDD), ts-morph (AST walking — already in use in `.agent/tools/`), pnpm/Turborepo monorepo, GitHub Actions (CI advisory wiring).

**Consumes:** `docs/superpowers/specs/2026-05-16-route-governance-contract-v1.md` Sections 8.5 + 8.6 + §11 crosswalk + §12 PR-2 / PR-4 envelope. PR-2 (`docs/superpowers/plans/2026-05-22-route-governance-contract-impl-pr2.md`, merged via #...) is a prerequisite for the **schema-name list** used by slice 3 (the relocated types must already exist in `@switchboard/schemas` before the check can match against them). PR-1 (#614, merged 2026-05-22 → `5617dbf0`) supplies the `check-routes --mode=warn-touched` invocation we extend in slice 3.

**Scope decision — split out of PR-2:** the original spec §12 PR-2 envelope bundled (a) cross-app type relocation, (b) routeTemplates extraction, (c) doctrine line + check-routes warning rule. PR-2 shipped (a); PR-2.5 ships (b) + (c). Splitting was reviewer-driven — three architectural concerns in one PR was scope bloat. The slices are independent: each can land separately if needed, but bundling them keeps the "surface decoupling + tooling" theme intact for review.

**Out of scope:**

- Store-layer mutation contract sweep (PR-3).
- `verdictStore.save as any` removal (PR-3).
- `@route-class:` header backfill for the remaining ~63 routes (PR-4).
- Flipping any `check-routes` advisory rule from warning to error (PR-4 — flips both route-class and cross-app-types together once the backfill is done).
- Dynamic enumeration of `@switchboard/schemas` exports inside the check rule (PR-4 swap; PR-2.5 uses a static, hand-curated `SCHEMAS_EXPORT_NAMES` set scoped to types relocated in PR-2 + the few obvious cross-app names that already live in schemas).
- Migrating tests under `__tests__/` away from local types — the rule skips test files by design (test-only view models are not a doctrine violation; they don't escape the test boundary).
- Removal of the `DashboardOverview` / `HandoffPackage` / etc. back-compat aliases introduced in PR-2 (PR-4 — gated on grepping zero remaining references first).

---

## Schema boundary rule

This plan inherits PR-2's "Schema boundary rule" verbatim. No new schemas are added here; no Date-vs-string decisions are made. The single exception is the `SCHEMAS_EXPORT_NAMES` set in slice 3 — that is a `Set<string>` of TypeScript identifier names, not a Zod schema, and has no boundary concerns.

If a Task code-block in this plan shows `z.coerce.date()` or any other schema definition, that's a plan bug — PR-2.5 does not introduce schemas. Flag and skip.

---

## Pre-flight verification — done during plan-writing

Captured here so the implementing agent does not redo this work and so future reviewers can audit the assumptions.

| Question                                                                                                                   | Answer (verified 2026-05-23 on `main` at `1af0d522`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How many `/contacts/` URL literals exist in `packages/core/src/**`?                                                        | **3, not 4.** Verified with `rg -n '/contacts/' packages/core/src --type ts`: `contacts/list.ts:63` (`detailHref: \`/contacts/${c.id}\``), `decisions/adapters/recommendation-adapter.ts:48` (`/contacts/${contactId}/conversations`), `decisions/adapters/handoff-adapter.ts:22` (`/contacts/${contact?.id}/conversations/${thread.id}`). The 4th site mentioned in the PR-2 plan's preflight ("contacts/detail.ts") **does not exist** — `detail.ts`has the URL only in a doc comment (line 39, "Composite read-side projection for`/contacts/[id]`"), which the rule must NOT match (doc comments are not contract violations). PR-2.5 closes 3 literal sites. |
| Where are these 3 projections called from?                                                                                 | `listContactsForBrowse` ← `apps/api/src/routes/dashboard-contacts.ts:43` (single caller). `adaptRecommendation` ← `apps/api/src/routes/decisions.ts:42` (`recs.map(adaptRecommendation)`). `adaptHandoff` ← `apps/api/src/routes/decisions.ts:45-49` (called from a `.map` callback that builds the third arg). No other callers in the codebase.                                                                                                                                                                                                                                                                                                                 |
| Does the current `check-routes` infra support adding a new advisory?                                                       | Yes. `.agent/tools/check-routes.ts:127` defines `runRouteClassAdvisory(opts)` returning `{ warnings, exitCode: 0 }`. PR-2.5 adds a sibling `runCrossAppTypesAdvisory(opts)` with the same shape and runs both from the `--mode=warn-touched` CLI branch. The CI step (`.github/workflows/ci.yml:312-314`) already invokes `--mode=warn-touched` with `continue-on-error: true` — no workflow edit needed.                                                                                                                                                                                                                                                         |
| Does `docs/DOCTRINE.md` already have a cross-app-types section?                                                            | **No.** Invariants 1–10 cover control plane, lifecycle, persistence, governance, deployment context, idempotency, dead-letters, human override, tools, channels. PR-2.5 adds an 11th invariant.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| What local exports exist in `apps/*/src/**` that the new rule should NOT false-positive on?                                | Two known deliberately-narrower shapes: `MinimalApprovalRecord` (`apps/mcp-server/src/server.ts:101`) and `ApprovalRecordForResponse` (`packages/core/src/approval/respond-to-approval.ts:81` — though this is in core, not apps; the rule scope is `apps/*/src/**` so it's not in scope anyway). Both have names **different** from any `@switchboard/schemas` export, so name-equality matching cannot fire on them. The inline suppression directive (`// route-governance: local-view-model`) is the escape hatch if a future deliberately-narrower shape adopts a colliding name.                                                                            |
| Does `apps/*/src/**` contain any existing exported declaration whose name matches a current `@switchboard/schemas` export? | After PR-2 lands, **no** — PR-2 explicitly removes the local `interface ApprovalRecord` / `interface Handoff` / `interface ConversationStateData` / `interface ConversationSummary` declarations. The new rule running on the post-PR-2 tree should produce zero warnings on `main` at PR-2.5-baseline. The advisory's first real-world hit will be the next regression. This is verified in Task 8 Step 8 (run advisory against the full `apps/*/src/**` tree).                                                                                                                                                                                                  |
| Where does `dashboardRouteTemplates` live?                                                                                 | New file `apps/api/src/lib/route-templates.ts`. Core (layer 3) defines the **interface** in `packages/core/src/lib/route-templates.ts`; the **constant** lives in apps/api (layer 5) per the surface-agnostic-backend principle. The chat and dashboard apps do not need to construct their own copy in PR-2.5 because they do not call the three core projections that consume `RouteTemplates`.                                                                                                                                                                                                                                                                 |

### Collision risk with cockpit-v2

The cockpit-v2 sprite system landed 2026-05-22 (#612, `cb9b828c`). PR-2.5 touches:

- `packages/core/src/contacts/list.ts` + tests (no cockpit overlap)
- `packages/core/src/decisions/adapters/{recommendation,handoff}-adapter.ts` + tests (no cockpit overlap)
- `apps/api/src/routes/{dashboard-contacts,decisions}.ts` (no cockpit overlap — cockpit lives under `apps/dashboard/src/components/cockpit/**`)
- `apps/api/src/lib/route-templates.ts` (new file)
- `docs/DOCTRINE.md` (no overlap)
- `.agent/tools/**` (no overlap)

Grep `apps/dashboard/src/components/cockpit` for `RouteTemplates`, `dashboardRouteTemplates`, `adaptRecommendation`, `adaptHandoff`, `listContactsForBrowse`: **0 hits**. No coordination with the cockpit owner required.

### Collision risk with consent-enforcement PR #596

PR #596 is code-complete in a worktree at `.claude/worktrees/consent-enforcement` (branch `worktree-consent-enforcement` at `f4f62b8a`) but **not merged** as of 2026-05-22. Its touched files are entirely in the channel-gateway / dispatch path — no overlap with PR-2.5's core projections, decisions adapters, or `.agent/tools/` changes. PR-2.5 can land first or second; ordering does not matter.

---

## File structure

### Create

| Path                                                      | Responsibility                                                                                                                                                                                                                                                        |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/lib/route-templates.ts`                | `RouteTemplates` interface (3 methods: `contactDetail`, `contactConversations`, `contactConversationDetail`) + re-export from `packages/core/src/index.ts`. No constant.                                                                                              |
| `packages/core/src/lib/__tests__/route-templates.test.ts` | Type-shape test: a hand-written fake implementing the interface compiles and returns string outputs. Smoke-only — the contract is enforced structurally by TypeScript.                                                                                                |
| `apps/api/src/lib/route-templates.ts`                     | `dashboardRouteTemplates: RouteTemplates` constant returning the current dashboard URL shape (`/contacts/<id>`, `/contacts/<id>/conversations`, `/contacts/<id>/conversations/<threadId>`).                                                                           |
| `apps/api/src/lib/__tests__/route-templates.test.ts`      | Sanity tests asserting each method emits the expected exact URL string for fixed inputs. Locks the URL contract; if a dashboard route ever changes, this test fails first.                                                                                            |
| `.agent/tools/cross-app-types-check.ts`                   | New advisory: `runCrossAppTypesAdvisory({ touchedFiles, repoRoot })` returns `{ warnings: ValidatorWarning[], exitCode: 0 }`. Scans `apps/*/src/**/*.ts(x)` for exported declarations colliding with `SCHEMAS_EXPORT_NAMES`. Honors the inline suppression directive. |
| `.agent/tools/__tests__/cross-app-types-check.test.ts`    | TDD tests for the advisory: exported-vs-local, name-equality, suppression directive, test-file skip, apps-only scope, message format.                                                                                                                                 |

### Modify

| Path                                                                            | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/index.ts`                                                    | Add `export type { RouteTemplates } from "./lib/route-templates.js";` so `import type { RouteTemplates } from "@switchboard/core"` works for the apps/api adapter file. **`export type`, not `export *`** — `RouteTemplates` is interface-only with no runtime value; using the type-only form makes that explicit and prevents accidental runtime imports.                                                                                                                                                                                                                                   |
| `packages/core/src/contacts/list.ts`                                            | Add `routeTemplates: RouteTemplates` to `ListContactsDeps`. Replace `detailHref: \`/contacts/${c.id}\``(line 63) with`detailHref: deps.routeTemplates.contactDetail(c.id)`. Import `RouteTemplates`from`../lib/route-templates.js`.                                                                                                                                                                                                                                                                                                                                                           |
| `packages/core/src/contacts/__tests__/list.test.ts`                             | Helper at top of file builds a fixture `routeTemplates` matching the production dashboard shape. Every existing `listContactsForBrowse(...)` call passes the fixture. The existing assertion `["/contacts/c-abc", "/contacts/c-def"]` (line 202) remains unchanged — the fixture preserves the URL shape.                                                                                                                                                                                                                                                                                     |
| `packages/core/src/decisions/adapters/recommendation-adapter.ts`                | Add `deps: { routeTemplates: RouteTemplates }` as second parameter. Replace `\`/contacts/${contactId}/conversations\``(line 48) with`deps.routeTemplates.contactConversations(contactId)`. Import `RouteTemplates`from`../../lib/route-templates.js`.                                                                                                                                                                                                                                                                                                                                         |
| `packages/core/src/decisions/adapters/__tests__/recommendation-adapter.test.ts` | Add a `routeTemplates` fixture and pass it as the second arg in every `adaptRecommendation(...)` call. Add one new assertion verifying `threadHref === "/contacts/c-maya/conversations"` for a recommendation with a `contactId` (current test does not assert threadHref).                                                                                                                                                                                                                                                                                                                   |
| `packages/core/src/decisions/adapters/handoff-adapter.ts`                       | Add `deps: { routeTemplates: RouteTemplates }` as fourth parameter. **Tighten the `threadHref` guard** from `thread ? ...` to `thread && contact?.id ? ...` so a missing contact resolves to `null` instead of producing the malformed URL `/contacts//conversations/<id>`. This is a deliberate, narrow behaviour change — the pre-injection literal already produced `/contacts/undefined/conversations/<id>` when contact was null, and PR-2.5 should not formalise a broken shape while it's already touching this contract. Import `RouteTemplates` from `../../lib/route-templates.js`. |
| `packages/core/src/decisions/adapters/__tests__/handoff-adapter.test.ts`        | Add a `routeTemplates` fixture and pass it as the fourth arg in every `adaptHandoff(...)` call. Add TWO new assertions: (a) `threadHref === "/contacts/c-maya/conversations/t-maya"` when both contact and thread are present (current test only asserts the null-thread branch); (b) `threadHref === null` when thread is present but contact is null — locks the tightened guard against silent regression to `/contacts//...`.                                                                                                                                                             |
| `apps/api/src/routes/dashboard-contacts.ts`                                     | Import `dashboardRouteTemplates` from `../lib/route-templates.js`. Replace `{ contactStore: app.contactStore }` (line 45) with `{ contactStore: app.contactStore, routeTemplates: dashboardRouteTemplates }`.                                                                                                                                                                                                                                                                                                                                                                                 |
| `apps/api/src/routes/decisions.ts`                                              | Import `dashboardRouteTemplates`. Replace `recs.map(adaptRecommendation)` (line 42) with `recs.map((r) => adaptRecommendation(r, { routeTemplates: dashboardRouteTemplates }))`. Replace the `adaptHandoff(h, contact, thread)` call (lines 45-49) with `adaptHandoff(h, ..., { routeTemplates: dashboardRouteTemplates })`.                                                                                                                                                                                                                                                                  |
| `docs/DOCTRINE.md`                                                              | Insert a new invariant `### 11. Cross-app types live in @switchboard/schemas` between current §10 (Channel is ingress, not architecture) and the `Legacy Bridge Registry` section. Body: the doctrine line per spec §8.6 + a sentence pointing to the `cross-app-types-check` advisory.                                                                                                                                                                                                                                                                                                       |
| `.agent/tools/check-routes.ts`                                                  | (1) Import `runCrossAppTypesAdvisory` from `./cross-app-types-check.js`. (2) In the `--mode=warn-touched` CLI branch, run BOTH advisories and merge their warnings into a single GitHub-Actions warning stream. Final exit code stays `0` (advisory-only).                                                                                                                                                                                                                                                                                                                                    |
| `.agent/tools/__tests__/check-routes-warn-mode.test.ts`                         | Add one new test: when `touchedFiles` includes a fixture file that would trigger a cross-app-types warning, the merged advisory output contains it.                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### Untouched but worth noting

- `packages/core/src/contacts/detail.ts` — no `/contacts/` URL **literal** in code, only in a docstring comment (`line 39`). PR-2.5 does not touch this file. The new check rule does NOT match doc comments (it matches `interface` / `type` declarations).
- `apps/mcp-server/src/server.ts:101` (`MinimalApprovalRecord`) — different name from `ApprovalRecord`, so the cross-app-types rule does not flag it. No annotation needed.
- `packages/core/src/approval/respond-to-approval.ts:81` (`ApprovalRecordForResponse`) — in core, not apps; rule scope excludes core. Not flagged.
- `apps/chat/src/conversation/state.ts` — after PR-2, this file re-exports `ConversationStateData` and `ConversationMessage` from schemas (PR-2 Task 6). Re-exports are not local declarations, so the cross-app-types rule does not flag them.
- The chat + dashboard apps do not construct their own `RouteTemplates` constant. They do not import the three affected core projections directly — the dashboard goes through the api, and chat does not surface contact URLs. If a future change adds a chat/dashboard caller, that caller's PR is responsible for constructing its own `chatRouteTemplates` / `dashboardClientRouteTemplates`.
- The cross-app-types rule's `SCHEMAS_EXPORT_NAMES` set is hand-curated at 15-25 entries (the PR-2 relocated types plus a few obvious cross-app names that already lived in schemas). Dynamic enumeration via ts-morph scanning `packages/schemas/src/index.ts` is a PR-4 follow-up — fine for PR-2.5 to ship static, per the spec author's note.

---

## Implementation tasks

### Task 0: Preflight — confirm pre-flight verification results

This task is a hard blocker — if any assumption in the "Pre-flight verification" table is now stale (a later PR moved a file or removed a URL literal), the subsequent tasks may misfire.

**Files:** read-only audit.

- [ ] **Step 1: Confirm `main` HEAD.**

Run:

```bash
git -C /Users/jasonli/switchboard log --oneline -1 origin/main
```

Expected: `1af0d522 docs(audit): route governance contract v1 — impl PR-2 plan (#616)` OR a later commit. If the head is different, scan the new commits for movement of `packages/core/src/contacts/list.ts`, `packages/core/src/decisions/adapters/recommendation-adapter.ts`, `packages/core/src/decisions/adapters/handoff-adapter.ts`, `apps/api/src/routes/dashboard-contacts.ts`, `apps/api/src/routes/decisions.ts`, or `.agent/tools/check-routes.ts`. If a file has moved or its URL literal has been removed, update the plan inline and proceed.

- [ ] **Step 2: Confirm PR-2 has landed (schemas-name dependency).**

The cross-app-types check in slice 3 lists `ApprovalRecord`, `Handoff`, `OperatorOverview`, etc. in `SCHEMAS_EXPORT_NAMES`. These names exist in `@switchboard/schemas` only after PR-2 lands.

Run:

```bash
node -e "const s = require('@switchboard/schemas'); console.log(['ApprovalRecord','Handoff','OperatorOverview','ConversationSummary','ConversationDetail'].map(n => [n, typeof s[n]]))" 2>&1 | tail -5
```

Expected: every name returns `"function"` (Zod schemas are functions) or `"object"` (types are erased at runtime; only schemas show up). If ANY name is missing — meaning the type-only export from schemas is fine but the **schema** is missing — PR-2 has not yet landed. Stop and re-sequence.

Alternative grep-based verification (works even when the package is not built):

```bash
rg -n 'export (const|type|interface) (ApprovalRecord|Handoff|OperatorOverview|ConversationSummary|ConversationDetail)(Schema)?\b' packages/schemas/src --type ts | head -20
```

Expected: at least one hit per name. If a name is missing, PR-2 either has not landed or is reverted; stop.

- [ ] **Step 3: Re-grep the 3 surface-URL literal sites in core.**

Run:

```bash
rg -n '/contacts/' packages/core/src --type ts | grep -v __tests__ | grep -v 'Composite read-side projection'
```

Expected output (3 hits, exactly):

```
packages/core/src/contacts/list.ts:63:    detailHref: `/contacts/${c.id}`,
packages/core/src/decisions/adapters/recommendation-adapter.ts:48:  return typeof contactId === "string" ? `/contacts/${contactId}/conversations` : null;
packages/core/src/decisions/adapters/handoff-adapter.ts:22:    threadHref: thread ? `/contacts/${contact?.id}/conversations/${thread.id}` : null,
```

If any line number has drifted, update the corresponding task's edit anchor. If a 4th literal has appeared, add a sub-task to migrate it.

- [ ] **Step 4: Re-grep the call sites in apps/api.**

Run:

```bash
rg -n 'listContactsForBrowse|adaptRecommendation|adaptHandoff' apps/api/src --type ts | grep -v __tests__
```

Expected: 1 call site each (`apps/api/src/routes/dashboard-contacts.ts:43`, `apps/api/src/routes/decisions.ts:42` for adaptRecommendation, `apps/api/src/routes/decisions.ts:45` for adaptHandoff). If a second caller has appeared, add a sub-task to inject `dashboardRouteTemplates` at that call site too.

- [ ] **Step 5: Confirm `.agent/tools/check-routes.ts` still has the `--mode=warn-touched` branch.**

Run:

```bash
rg -n 'warn-touched' .agent/tools/check-routes.ts
```

Expected: one hit at `.agent/tools/check-routes.ts:173`. If absent, slice 3's wiring assumption is wrong — re-read the file before extending.

- [ ] **Step 6: No commit.** This is a verification-only task. If anything changed, fix the affected task inline and proceed.

---

### Task 1: Introduce the `RouteTemplates` interface in core

The interface is a thin contract — 3 methods, no logic. Pure type relocation: core establishes the dependency type, apps wire the implementation.

**Files:**

- Create: `packages/core/src/lib/route-templates.ts`.
- Create: `packages/core/src/lib/__tests__/route-templates.test.ts`.
- Modify: `packages/core/src/index.ts`.

- [ ] **Step 1: Write a failing structural test.**

Create `packages/core/src/lib/__tests__/route-templates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { RouteTemplates } from "../route-templates.js";

describe("RouteTemplates interface", () => {
  it("accepts an implementation matching the documented shape", () => {
    const fake: RouteTemplates = {
      contactDetail: (id) => `/x/${id}`,
      contactConversations: (id) => `/x/${id}/c`,
      contactConversationDetail: (id, threadId) => `/x/${id}/c/${threadId}`,
    };
    expect(fake.contactDetail("a")).toBe("/x/a");
    expect(fake.contactConversations("b")).toBe("/x/b/c");
    expect(fake.contactConversationDetail("d", "t")).toBe("/x/d/c/t");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm --filter @switchboard/core test -- --run packages/core/src/lib/__tests__/route-templates.test.ts 2>&1 | tail -10`
Expected: FAIL — `Cannot find module ../route-templates.js`.

- [ ] **Step 3: Implement the interface.**

Create `packages/core/src/lib/route-templates.ts`:

```ts
/**
 * Surface-URL emission contract injected into core projections so that
 * `packages/core/**` never contains a literal route URL. The constant lives
 * in `apps/api/src/lib/route-templates.ts`; chat and dashboard apps that
 * later need their own URLs construct their own constants.
 *
 * Route Governance Contract v1 §8.5 (surface-URL strings in core).
 */
export interface RouteTemplates {
  /** `/contacts/<id>` — the contact detail page. */
  contactDetail(id: string): string;
  /** `/contacts/<id>/conversations` — the contact's thread list. */
  contactConversations(id: string): string;
  /** `/contacts/<id>/conversations/<threadId>` — a single thread within the contact. */
  contactConversationDetail(id: string, threadId: string): string;
}
```

- [ ] **Step 4: Re-export from core's barrel.**

Add to `packages/core/src/index.ts`, near the other `lib/*` re-exports (search for `from "./lib/`):

```ts
export type { RouteTemplates } from "./lib/route-templates.js";
```

Use **`export type`**, not `export *`. `RouteTemplates` is interface-only with no runtime value — the type-only form makes that explicit and prevents accidental runtime imports through the barrel. (If you find a future contributor wrote `export * from "./lib/route-templates.js"` and `import { RouteTemplates }` — drop the `type` keyword — fix it; the consumer should use `import type` and the barrel should use `export type`.)

- [ ] **Step 5: Run the test to verify it passes.**

Run: `pnpm --filter @switchboard/core test -- --run packages/core/src/lib/__tests__/route-templates.test.ts 2>&1 | tail -10`
Expected: PASS — 1 case green.

- [ ] **Step 6: Build core to verify the barrel export.**

Run:

```bash
pnpm --filter @switchboard/core build 2>&1 | tail -10
```

Expected: clean build.

- [ ] **Step 7: Commit.**

```bash
git add packages/core/src/lib/route-templates.ts packages/core/src/lib/__tests__/route-templates.test.ts packages/core/src/index.ts
git commit -m "$(cat <<'EOF'
feat(core): introduce RouteTemplates interface for surface-URL injection

Three-method contract (contactDetail, contactConversations,
contactConversationDetail) that core projections consume as a dep, so
`packages/core/**` no longer contains literal route URLs.

The constant implementation lives in apps/api (next commit). Route
Governance Contract v1 §8.5.
EOF
)"
```

---

### Task 2: Introduce `dashboardRouteTemplates` constant in apps/api

The constant is the surface-side implementation. Living in `apps/api/src/lib/` keeps the URL shape inside the layer that owns the dashboard contract (layer 5), per the surface-agnostic-backend principle.

**Files:**

- Create: `apps/api/src/lib/route-templates.ts`.
- Create: `apps/api/src/lib/__tests__/route-templates.test.ts`.

- [ ] **Step 1: Write failing tests.**

Create `apps/api/src/lib/__tests__/route-templates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dashboardRouteTemplates } from "../route-templates.js";

describe("dashboardRouteTemplates", () => {
  it("contactDetail returns /contacts/<id>", () => {
    expect(dashboardRouteTemplates.contactDetail("c-abc")).toBe("/contacts/c-abc");
  });

  it("contactConversations returns /contacts/<id>/conversations", () => {
    expect(dashboardRouteTemplates.contactConversations("c-abc")).toBe(
      "/contacts/c-abc/conversations",
    );
  });

  it("contactConversationDetail returns /contacts/<id>/conversations/<threadId>", () => {
    expect(dashboardRouteTemplates.contactConversationDetail("c-abc", "t-1")).toBe(
      "/contacts/c-abc/conversations/t-1",
    );
  });

  it("does not crash on empty id (constant-level safety, even though no PR-2.5 caller passes empty)", () => {
    // adaptHandoff in PR-2.5 tightens its guard so it never calls this with
    // an empty contact id (it returns null instead). The constant must still
    // not crash on empty inputs in case a future caller is less careful —
    // this is a safety lock, not a contract some caller actively depends on.
    expect(dashboardRouteTemplates.contactConversationDetail("", "t-1")).toBe(
      "/contacts//conversations/t-1",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm --filter @switchboard/api test -- --run apps/api/src/lib/__tests__/route-templates.test.ts 2>&1 | tail -10`
Expected: FAIL — `Cannot find module ../route-templates.js`.

- [ ] **Step 3: Implement the constant.**

Create `apps/api/src/lib/route-templates.ts`:

```ts
import type { RouteTemplates } from "@switchboard/core";

/**
 * The dashboard's URL shape, injected into core projections at the API
 * boundary. This is the single source of truth for `/contacts/...` URLs
 * emitted by `listContactsForBrowse`, `adaptRecommendation`, and
 * `adaptHandoff`.
 *
 * If the dashboard renames `/contacts` → `/people` (etc.), update this
 * constant; core does not need to change.
 *
 * Route Governance Contract v1 §8.5.
 */
export const dashboardRouteTemplates: RouteTemplates = {
  contactDetail: (id) => `/contacts/${id}`,
  contactConversations: (id) => `/contacts/${id}/conversations`,
  contactConversationDetail: (id, threadId) => `/contacts/${id}/conversations/${threadId}`,
};
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `pnpm --filter @switchboard/api test -- --run apps/api/src/lib/__tests__/route-templates.test.ts 2>&1 | tail -10`
Expected: PASS — 4 cases green.

- [ ] **Step 5: Typecheck the api package.**

Run:

```bash
pnpm --filter @switchboard/api typecheck 2>&1 | tail -10
```

Expected: clean. If the `import type { RouteTemplates } from "@switchboard/core"` fails to resolve, `pnpm reset` to rebuild core's dist (the new export from Task 1 needs to be visible to api).

- [ ] **Step 6: Commit.**

```bash
git add apps/api/src/lib/route-templates.ts apps/api/src/lib/__tests__/route-templates.test.ts
git commit -m "$(cat <<'EOF'
feat(api): add dashboardRouteTemplates constant for core projections

Single source of truth for /contacts/... URLs that core projections
emit. Wired into listContactsForBrowse + adaptRecommendation +
adaptHandoff in the next three commits.

Route Governance Contract v1 §8.5.
EOF
)"
```

---

### Task 3: Inject `routeTemplates` into `listContactsForBrowse`

First of three projections. After this commit, `packages/core/src/contacts/list.ts` has zero `/contacts/` URL literals.

**Files:**

- Modify: `packages/core/src/contacts/list.ts`.
- Modify: `packages/core/src/contacts/__tests__/list.test.ts`.
- Modify: `apps/api/src/routes/dashboard-contacts.ts`.

- [ ] **Step 1: Update the existing list-test fixture to pass `routeTemplates`.**

In `packages/core/src/contacts/__tests__/list.test.ts`, add near the top of the file (just below the existing imports):

```ts
import type { RouteTemplates } from "@switchboard/core";

const testRouteTemplates: RouteTemplates = {
  contactDetail: (id) => `/contacts/${id}`,
  contactConversations: (id) => `/contacts/${id}/conversations`,
  contactConversationDetail: (id, threadId) => `/contacts/${id}/conversations/${threadId}`,
};
```

Then update **every** call to `listContactsForBrowse(...)` in the file to pass `routeTemplates` in the deps object. The grep for these is:

```bash
rg -n 'listContactsForBrowse\(' packages/core/src/contacts/__tests__/list.test.ts
```

For each call like `await listContactsForBrowse({ orgId, query }, { contactStore })`, change to:

```ts
await listContactsForBrowse({ orgId, query }, { contactStore, routeTemplates: testRouteTemplates });
```

The existing assertion `expect(result.rows.map((r) => r.detailHref)).toEqual(["/contacts/c-abc", "/contacts/c-def"])` (line 202) stays untouched — `testRouteTemplates.contactDetail` produces the same shape as the inline literal it replaces.

- [ ] **Step 2: Run the existing test suite to verify it still passes against the unchanged production code.**

Run: `pnpm --filter @switchboard/core test -- --run packages/core/src/contacts/__tests__/list.test.ts 2>&1 | tail -10`
Expected: PASS. The test now passes `routeTemplates` but the production code doesn't read it yet — passing it through an unused deps slot is fine, the type sig hasn't tightened.

Wait — actually the deps type **will** error because `routeTemplates` isn't yet in `ListContactsDeps`. So step 2's expected result is: FAIL (typecheck) — `Object literal may only specify known properties, and 'routeTemplates' does not exist in type 'ListContactsDeps'`. This is the failing-test signal that drives Step 3.

Run + actual expected:

```
FAIL packages/core/src/contacts/__tests__/list.test.ts
TS2353: Object literal may only specify known properties, and 'routeTemplates' does not exist in type ...
```

- [ ] **Step 3: Add `routeTemplates` to `ListContactsDeps` and use it.**

In `packages/core/src/contacts/list.ts`:

(a) Add import after the existing imports:

```ts
import type { RouteTemplates } from "../lib/route-templates.js";
```

(b) Extend the deps interface (currently at lines 24-26):

```ts
export interface ListContactsDeps {
  contactStore: Pick<ContactStore, "listForBrowse">;
  routeTemplates: RouteTemplates;
}
```

(c) Replace line 63 (`detailHref: \`/contacts/${c.id}\``) with:

```ts
    detailHref: deps.routeTemplates.contactDetail(c.id),
```

- [ ] **Step 4: Run the list test to verify it passes.**

Run: `pnpm --filter @switchboard/core test -- --run packages/core/src/contacts/__tests__/list.test.ts 2>&1 | tail -10`
Expected: PASS — all existing assertions (including `["/contacts/c-abc", "/contacts/c-def"]`) hold because `testRouteTemplates.contactDetail` produces an identical shape.

- [ ] **Step 5: Wire `dashboardRouteTemplates` into the api route.**

In `apps/api/src/routes/dashboard-contacts.ts`:

(a) Add import after line 4:

```ts
import { dashboardRouteTemplates } from "../lib/route-templates.js";
```

(b) Replace the deps object at line 45 (`{ contactStore: app.contactStore }`) with:

```ts
        { contactStore: app.contactStore, routeTemplates: dashboardRouteTemplates },
```

- [ ] **Step 6: Typecheck core + api.**

Run:

```bash
pnpm --filter @switchboard/core typecheck 2>&1 | tail -10
pnpm --filter @switchboard/api typecheck 2>&1 | tail -10
```

Expected: both clean.

- [ ] **Step 7: Run the core + api test suites.**

Run:

```bash
pnpm --filter @switchboard/core test -- --run 2>&1 | tail -10
pnpm --filter @switchboard/api test -- --run 2>&1 | tail -10
```

Expected: both green. If the api suite has an integration test that hits `/api/dashboard/contacts` end-to-end (`apps/api/src/__tests__/api-dashboard-contacts.test.ts` or similar), it picks up the wired `dashboardRouteTemplates` automatically — no test change needed there.

- [ ] **Step 8: Verify the URL literal is gone from `list.ts`.**

Run:

```bash
rg -n '/contacts/' packages/core/src/contacts/list.ts
```

Expected: zero hits.

- [ ] **Step 9: Commit.**

```bash
git add packages/core/src/contacts/list.ts packages/core/src/contacts/__tests__/list.test.ts apps/api/src/routes/dashboard-contacts.ts
git commit -m "$(cat <<'EOF'
refactor(core): inject RouteTemplates into listContactsForBrowse

Replaces literal /contacts/<id> in core/contacts/list.ts:63 with
deps.routeTemplates.contactDetail(c.id). The api route wires the
dashboardRouteTemplates constant at the boundary.

Route Governance Contract v1 §8.5 — surface-URL string 1 of 3 removed
from core.
EOF
)"
```

---

### Task 4: Inject `routeTemplates` into `adaptRecommendation`

Second of three projections. The signature gains a second parameter (deps object).

**Files:**

- Modify: `packages/core/src/decisions/adapters/recommendation-adapter.ts`.
- Modify: `packages/core/src/decisions/adapters/__tests__/recommendation-adapter.test.ts`.
- Modify: `apps/api/src/routes/decisions.ts` (partial — handoff edit happens in Task 5).

- [ ] **Step 1: Update the recommendation-adapter test fixture.**

In `packages/core/src/decisions/adapters/__tests__/recommendation-adapter.test.ts`, add after the existing imports (line 3):

```ts
import type { RouteTemplates } from "@switchboard/core";

const testRouteTemplates: RouteTemplates = {
  contactDetail: (id) => `/contacts/${id}`,
  contactConversations: (id) => `/contacts/${id}/conversations`,
  contactConversationDetail: (id, threadId) => `/contacts/${id}/conversations/${threadId}`,
};
const deps = { routeTemplates: testRouteTemplates };
```

Then update **every** call to `adaptRecommendation(...)` in the file to pass `deps` as the second argument. Current call sites (verified during plan-writing): lines 44, 50, 57, 63, 71, 77.

Change each `adaptRecommendation(makeRec(...))` to `adaptRecommendation(makeRec(...), deps)`.

Also add ONE new assertion at the end of the `describe("adaptRecommendation", () => { ... })` block:

```ts
it("emits threadHref from routeTemplates when contactId is present", () => {
  const decision = adaptRecommendation(makeRec(), deps);
  expect(decision.threadHref).toBe("/contacts/c-maya/conversations");
});

it("emits null threadHref when targetEntities lacks contactId", () => {
  const decision = adaptRecommendation(makeRec({ targetEntities: {} }), deps);
  expect(decision.threadHref).toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm --filter @switchboard/core test -- --run packages/core/src/decisions/adapters/__tests__/recommendation-adapter.test.ts 2>&1 | tail -20`

Expected: FAIL — TypeScript errors that `adaptRecommendation` does not accept a second argument, OR (if the typecheck slips) the new `threadHref` assertions fail because the inline literal still produces the expected shape (so they'd actually pass — but the typecheck failure should fire first).

If TypeScript catches the second-arg passing because the current sig is single-arg, that's the failing-test signal. If TypeScript is forgiving (it isn't here — single-arg function called with two args is a TS error), the assertion failure is the signal. Either way, this step's purpose is to confirm the test sees a red state before Step 3.

- [ ] **Step 3: Update `adaptRecommendation` signature and use `deps.routeTemplates`.**

In `packages/core/src/decisions/adapters/recommendation-adapter.ts`:

(a) Add import at the top:

```ts
import type { RouteTemplates } from "../../lib/route-templates.js";
```

(b) Change the function signature (line 12):

```ts
export function adaptRecommendation(
  row: Recommendation,
  deps: { routeTemplates: RouteTemplates },
): Decision {
```

(c) Update `deriveThreadHref` to accept and use `routeTemplates` (current lines 45-49):

```ts
function deriveThreadHref(row: Recommendation, routeTemplates: RouteTemplates): string | null {
  if (!row.targetEntities) return null;
  const contactId = row.targetEntities["contactId"];
  return typeof contactId === "string" ? routeTemplates.contactConversations(contactId) : null;
}
```

(d) Update the caller (line 22) inside `adaptRecommendation`:

```ts
    threadHref: deriveThreadHref(row, deps.routeTemplates),
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `pnpm --filter @switchboard/core test -- --run packages/core/src/decisions/adapters/__tests__/recommendation-adapter.test.ts 2>&1 | tail -10`
Expected: PASS — all existing assertions plus the two new `threadHref` assertions green.

- [ ] **Step 5: Update the api caller.**

In `apps/api/src/routes/decisions.ts`:

(a) Add the import (if not already present from a future Task 5 step):

```ts
import { dashboardRouteTemplates } from "../lib/route-templates.js";
```

(b) Replace line 42 (`...recs.map(adaptRecommendation),`) with:

```ts
    ...recs.map((r) => adaptRecommendation(r, { routeTemplates: dashboardRouteTemplates })),
```

- [ ] **Step 6: Typecheck core + api.**

Run:

```bash
pnpm --filter @switchboard/core typecheck 2>&1 | tail -10
pnpm --filter @switchboard/api typecheck 2>&1 | tail -10
```

Expected: both clean.

- [ ] **Step 7: Verify the URL literal is gone from `recommendation-adapter.ts`.**

Run:

```bash
rg -n '/contacts/' packages/core/src/decisions/adapters/recommendation-adapter.ts
```

Expected: zero hits.

- [ ] **Step 8: Commit.**

```bash
git add packages/core/src/decisions/adapters/recommendation-adapter.ts packages/core/src/decisions/adapters/__tests__/recommendation-adapter.test.ts apps/api/src/routes/decisions.ts
git commit -m "$(cat <<'EOF'
refactor(core): inject RouteTemplates into adaptRecommendation

Replaces literal /contacts/<id>/conversations in deriveThreadHref with
routeTemplates.contactConversations(contactId). The api decisions
route wires dashboardRouteTemplates at the .map call site.

Route Governance Contract v1 §8.5 — surface-URL string 2 of 3 removed
from core.
EOF
)"
```

---

### Task 5: Inject `routeTemplates` into `adaptHandoff`

Third of three projections. The signature gains a fourth parameter (deps object). After this commit, `packages/core/src/**` has zero `/contacts/` URL literals.

**Files:**

- Modify: `packages/core/src/decisions/adapters/handoff-adapter.ts`.
- Modify: `packages/core/src/decisions/adapters/__tests__/handoff-adapter.test.ts`.
- Modify: `apps/api/src/routes/decisions.ts`.

- [ ] **Step 1: Update the handoff-adapter test fixture.**

In `packages/core/src/decisions/adapters/__tests__/handoff-adapter.test.ts`, add after the existing imports (line 4):

```ts
import type { RouteTemplates } from "@switchboard/core";

const testRouteTemplates: RouteTemplates = {
  contactDetail: (id) => `/contacts/${id}`,
  contactConversations: (id) => `/contacts/${id}/conversations`,
  contactConversationDetail: (id, threadId) => `/contacts/${id}/conversations/${threadId}`,
};
const deps = { routeTemplates: testRouteTemplates };
```

Then update **every** call to `adaptHandoff(...)` in the file to pass `deps` as the fourth argument. Verified call sites during plan-writing: lines 39, 45, 50, 56, 61, 66, 73, 80, 85, 90.

Change each `adaptHandoff(makeHandoff(), contact, thread)` → `adaptHandoff(makeHandoff(), contact, thread, deps)`. (Apply the same transform to `adaptHandoff(makeHandoff(), null, thread)`, `adaptHandoff(makeHandoff(), contact, null)`, etc.)

Also add ONE new assertion at the end of the `describe("adaptHandoff", () => { ... })` block:

```ts
it("emits threadHref from routeTemplates when both contact and thread are present", () => {
  const decision = adaptHandoff(makeHandoff(), contact, thread, deps);
  expect(decision.threadHref).toBe("/contacts/c-maya/conversations/t-maya");
});

it("threadHref is null when thread is present but contact is null (no malformed /contacts// URL)", () => {
  // Pre-injection code produced `/contacts/undefined/conversations/<id>` here.
  // PR-2.5 deliberately tightens the guard: missing contact resolves to null
  // rather than formalising the broken /contacts// shape via the routeTemplates
  // call. This test locks the new behaviour.
  const decision = adaptHandoff(makeHandoff(), null, thread, deps);
  expect(decision.threadHref).toBeNull();
});
```

(The existing `it("threadHref is null when thread is null", ...)` at line 89 covers the null-thread branch. The first new test covers the both-present branch; the second new test covers the new contact-null branch and locks the deliberate behaviour tightening.)

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm --filter @switchboard/core test -- --run packages/core/src/decisions/adapters/__tests__/handoff-adapter.test.ts 2>&1 | tail -20`

Expected: FAIL — TypeScript errors that `adaptHandoff` accepts only 3 parameters but is called with 4. This is the failing-test signal.

- [ ] **Step 3: Update `adaptHandoff` signature and use `deps.routeTemplates`.**

In `packages/core/src/decisions/adapters/handoff-adapter.ts`:

(a) Add import at the top:

```ts
import type { RouteTemplates } from "../../lib/route-templates.js";
```

(b) Change the function signature (line 7):

```ts
export function adaptHandoff(
  row: HandoffPackage,
  contact: Contact | null,
  thread: ConversationThread | null,
  deps: { routeTemplates: RouteTemplates },
): Decision {
```

(c) Replace line 22 (`threadHref: thread ? \`/contacts/${contact?.id}/conversations/${thread.id}\` : null,`) with:

```ts
    threadHref:
      thread && contact?.id
        ? deps.routeTemplates.contactConversationDetail(contact.id, thread.id)
        : null,
```

**Deliberate behaviour tightening.** The pre-injection literal produced `/contacts/undefined/conversations/<id>` when `contact` was null but `thread` was present — a malformed URL that no surface can render usefully. PR-2.5 is already touching this contract and should not formalise a broken shape, so the guard now resolves contact-missing to `null` (matching the existing `thread === null` branch). The narrower guard is locked by the new contact-null assertion added in Step 1.

After this edit, `dashboardRouteTemplates.contactConversationDetail("", "t")` is unreachable from `adaptHandoff` — but the Task 2 empty-id test still locks the constant's own behaviour for any future caller. Both contracts stay consistent.

- [ ] **Step 4: Run the test to verify it passes.**

Run: `pnpm --filter @switchboard/core test -- --run packages/core/src/decisions/adapters/__tests__/handoff-adapter.test.ts 2>&1 | tail -10`
Expected: PASS — all existing assertions plus both new assertions ("both contact and thread present" → URL; "contact null, thread present" → null) green.

- [ ] **Step 5: Update the api caller.**

In `apps/api/src/routes/decisions.ts`, replace the `adaptHandoff(...)` call (current lines 45-49):

```ts
return adaptHandoff(
  h,
  leadId ? (contacts.get(leadId) ?? null) : null,
  leadId ? (threads.get(leadId) ?? null) : null,
  { routeTemplates: dashboardRouteTemplates },
);
```

(The `dashboardRouteTemplates` import was already added in Task 4 Step 5.)

- [ ] **Step 6: Typecheck core + api.**

Run:

```bash
pnpm --filter @switchboard/core typecheck 2>&1 | tail -10
pnpm --filter @switchboard/api typecheck 2>&1 | tail -10
```

Expected: both clean.

- [ ] **Step 7: Verify the URL literal is gone from `handoff-adapter.ts`.**

Run:

```bash
rg -n '/contacts/' packages/core/src/decisions/adapters/handoff-adapter.ts
```

Expected: zero hits.

- [ ] **Step 8: Commit.**

```bash
git add packages/core/src/decisions/adapters/handoff-adapter.ts packages/core/src/decisions/adapters/__tests__/handoff-adapter.test.ts apps/api/src/routes/decisions.ts
git commit -m "$(cat <<'EOF'
refactor(core): inject RouteTemplates into adaptHandoff

Replaces literal /contacts/<id>/conversations/<threadId> in the
handoff adapter with routeTemplates.contactConversationDetail. The
api decisions route wires dashboardRouteTemplates.

Tightens the guard: threadHref is now null when contact is missing,
instead of producing the malformed /contacts/undefined/... that the
pre-injection literal silently emitted. Locked by a new test.

Route Governance Contract v1 §8.5 — surface-URL string 3 of 3 removed
from core. packages/core/src now has zero literal /contacts/... URLs
(verified in next task).
EOF
)"
```

---

### Task 6: Grep-clean verification — zero `/contacts/` literals in core/src

Gate task. No code change; no commit. Confirms slice 1 is complete before moving on to slices 2 + 3.

**Files:** read-only verification.

- [ ] **Step 1: Grep for any remaining `/contacts/` literal in core source.**

Run:

```bash
rg -n '/contacts/' packages/core/src --type ts | grep -v __tests__ | grep -v 'Composite read-side projection'
```

Expected: **zero hits**. The doc comment in `packages/core/src/contacts/detail.ts:39` is filtered out by the second grep; the test fixture literals are filtered by `__tests__`.

If any hit appears, find which projection still emits it and add a sub-task to migrate it the same way as Tasks 3-5.

- [ ] **Step 2: Grep test fixtures to confirm they pass `routeTemplates` everywhere.**

Run:

```bash
rg -n 'adaptRecommendation\(|adaptHandoff\(|listContactsForBrowse\(' packages/core/src --type ts | grep __tests__
```

Expected: every call site either uses `testRouteTemplates` (passed via `deps` or as the last argument) or is preceded by a `deps` definition that includes it. If a call still passes only the original arg set, the typecheck would have failed earlier — this grep is a belt-and-braces verification.

- [ ] **Step 3: Run the full core + api test suites to confirm slice 1 is green end-to-end.**

Run:

```bash
pnpm --filter @switchboard/core test -- --run 2>&1 | tail -15
pnpm --filter @switchboard/api test -- --run 2>&1 | tail -15
```

Expected: both green. If a previously-untouched test (e.g. an integration test that mocks the decisions endpoint) regresses, it's because the route wiring change in Task 4/5 surfaced a fixture gap — fix the fixture in this task and commit as a follow-up step inside this task.

- [ ] **Step 4: No commit.** This is a verification-only task. The PR description should reference the grep output as evidence of slice 1 completion.

---

### Task 7: Add the cross-app-types doctrine line to `docs/DOCTRINE.md`

Slice 2 is one focused edit: a new non-negotiable invariant added between the existing §10 (Channel is ingress) and the Legacy Bridge Registry section.

**Files:**

- Modify: `docs/DOCTRINE.md`.

- [ ] **Step 1: Locate the insertion point.**

The current file structure (verified during plan-writing): `### 10. Channel is ingress, not architecture` at line 91, then the `---` separator at line 97, then `## Legacy Bridge Registry` at line 99.

Run:

```bash
sed -n '91,99p' docs/DOCTRINE.md
```

Expected: 10's heading, body paragraph, current state paragraph, separator, registry heading. If this layout has shifted, locate the equivalent boundary before editing.

- [ ] **Step 2: Insert the new invariant.**

Insert between the `---` separator (line 97 in the verified snapshot) and the `## Legacy Bridge Registry` header. The new section content:

```markdown
### 11. Cross-app types live in `@switchboard/schemas`

A type declared in `apps/api/`, `apps/chat/`, or `apps/dashboard/` that is also defined elsewhere — by name, by shape, or by structural duplication — is a contract violation. The single source of truth for any value type that crosses an app boundary is `@switchboard/schemas`.

**Why:** Local redeclarations drift. The same `interface ApprovalRecord` declared in three apps will, over time, develop three different shapes, and the seams between them become silent corruption sites. Centralising in `@switchboard/schemas` makes the contract the artifact that has to change, not the consumer.

**Enforcement:** `check-routes`'s cross-app-types advisory (`.agent/tools/cross-app-types-check.ts`) flags new local `export interface` / `export type` declarations whose name matches a `@switchboard/schemas` export. Inline suppression via `// route-governance: local-view-model` on the line above the declaration is permitted for deliberately narrower local shapes (e.g. `MinimalApprovalRecord` in the MCP server) — those are not violations, they are intentionally narrower views.

**Current state:** Warning mode (PR-2.5). PR-4 flips to error mode after the full `@route-class` backfill so the cross-app-types rule and the route-class matrix flip enforcement together.
```

Place a blank line before the heading and a blank line after the "Current state" paragraph so it sits cleanly inside the markdown flow.

- [ ] **Step 3: Verify the edit.**

Run:

```bash
sed -n '91,130p' docs/DOCTRINE.md
```

Expected: §10 → blank → `---` → blank → `### 11. Cross-app types live in @switchboard/schemas` → body → blank → `---` → `## Legacy Bridge Registry`. Confirm the four-paragraph body is intact and the markdown renders (no broken backticks, no unclosed code blocks).

- [ ] **Step 4: Run prettier on the doc to match repo formatting.**

Run:

```bash
pnpm exec prettier --write docs/DOCTRINE.md 2>&1 | tail -5
```

Expected: file is reformatted (or left unchanged). If prettier alters anything other than whitespace, review before committing.

- [ ] **Step 5: Commit.**

```bash
git add docs/DOCTRINE.md
git commit -m "$(cat <<'EOF'
docs(doctrine): add invariant 11 — cross-app types live in @switchboard/schemas

Closes the human-side companion to the check-routes cross-app-types
advisory (next commit). Per Route Governance Contract v1 §8.6.
EOF
)"
```

---

### Task 8: Implement the cross-app-types check rule (TDD)

The advisory scans `apps/*/src/**/*.ts(x)` (excluding `__tests__/`) for **exported** local `interface` / `type` declarations whose name matches a known `@switchboard/schemas` export. Honors `// route-governance: local-view-model` inline suppression. Returns warnings + always exit code 0 (warning mode).

**Files:**

- Create: `.agent/tools/cross-app-types-check.ts`.
- Create: `.agent/tools/__tests__/cross-app-types-check.test.ts`.

- [ ] **Step 1: Write failing tests covering every requirement.**

Create `.agent/tools/__tests__/cross-app-types-check.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runCrossAppTypesAdvisory } from "../cross-app-types-check.js";

function makeFixtureRepo(files: Record<string, string>): string {
  const root = join(tmpdir(), `cat-check-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

describe("runCrossAppTypesAdvisory", () => {
  it("flags exported local interface that duplicates a schemas export name", async () => {
    const root = makeFixtureRepo({
      "apps/api/src/foo.ts": `export interface ApprovalRecord { id: string; }`,
    });
    const result = await runCrossAppTypesAdvisory({
      touchedFiles: ["apps/api/src/foo.ts"],
      repoRoot: root,
    });
    expect(result.exitCode).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].path).toBe("apps/api/src/foo.ts");
    expect(result.warnings[0].message).toContain("ApprovalRecord");
    expect(result.warnings[0].message).toContain("@switchboard/schemas");
    expect(result.warnings[0].message).toContain("import");
  });

  it("flags exported local type alias the same way", async () => {
    const root = makeFixtureRepo({
      "apps/dashboard/src/lib/x.ts": `export type Handoff = { id: string };`,
    });
    const result = await runCrossAppTypesAdvisory({
      touchedFiles: ["apps/dashboard/src/lib/x.ts"],
      repoRoot: root,
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].message).toContain("Handoff");
  });

  it("does NOT flag non-exported (local-only) declarations", async () => {
    const root = makeFixtureRepo({
      "apps/api/src/foo.ts": `interface ApprovalRecord { id: string; }`,
    });
    const result = await runCrossAppTypesAdvisory({
      touchedFiles: ["apps/api/src/foo.ts"],
      repoRoot: root,
    });
    expect(result.warnings).toEqual([]);
  });

  it("does NOT flag a name that doesn't match any schemas export", async () => {
    const root = makeFixtureRepo({
      "apps/api/src/foo.ts": `export interface MinimalApprovalRecord { id: string; }`,
    });
    const result = await runCrossAppTypesAdvisory({
      touchedFiles: ["apps/api/src/foo.ts"],
      repoRoot: root,
    });
    expect(result.warnings).toEqual([]);
  });

  it("honors // route-governance: local-view-model suppression directive", async () => {
    const root = makeFixtureRepo({
      "apps/api/src/foo.ts": [
        "// route-governance: local-view-model",
        "export interface ApprovalRecord { id: string; }",
      ].join("\n"),
    });
    const result = await runCrossAppTypesAdvisory({
      touchedFiles: ["apps/api/src/foo.ts"],
      repoRoot: root,
    });
    expect(result.warnings).toEqual([]);
  });

  it("skips files under __tests__/", async () => {
    const root = makeFixtureRepo({
      "apps/api/src/__tests__/foo.test.ts": `export interface ApprovalRecord { id: string; }`,
    });
    const result = await runCrossAppTypesAdvisory({
      touchedFiles: ["apps/api/src/__tests__/foo.test.ts"],
      repoRoot: root,
    });
    expect(result.warnings).toEqual([]);
  });

  it("skips files outside apps/*/src/**", async () => {
    const root = makeFixtureRepo({
      "packages/core/src/foo.ts": `export interface ApprovalRecord { id: string; }`,
      "scripts/foo.ts": `export interface ApprovalRecord { id: string; }`,
    });
    const result = await runCrossAppTypesAdvisory({
      touchedFiles: ["packages/core/src/foo.ts", "scripts/foo.ts"],
      repoRoot: root,
    });
    expect(result.warnings).toEqual([]);
  });

  it("returns exit code 0 even with warnings (advisory-only mode)", async () => {
    const root = makeFixtureRepo({
      "apps/api/src/foo.ts": `export interface ApprovalRecord { id: string; }`,
    });
    const result = await runCrossAppTypesAdvisory({
      touchedFiles: ["apps/api/src/foo.ts"],
      repoRoot: root,
    });
    expect(result.exitCode).toBe(0);
  });

  it("returns no warnings when no touched files match the scope", async () => {
    const root = makeFixtureRepo({});
    const result = await runCrossAppTypesAdvisory({
      touchedFiles: [],
      repoRoot: root,
    });
    expect(result.warnings).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  it("flags multiple declarations in one file", async () => {
    const root = makeFixtureRepo({
      "apps/api/src/foo.ts": [
        "export interface ApprovalRecord { id: string; }",
        "export type Handoff = { id: string };",
      ].join("\n"),
    });
    const result = await runCrossAppTypesAdvisory({
      touchedFiles: ["apps/api/src/foo.ts"],
      repoRoot: root,
    });
    expect(result.warnings).toHaveLength(2);
    const names = result.warnings.map((w) => w.message);
    expect(names.some((m) => m.includes("ApprovalRecord"))).toBe(true);
    expect(names.some((m) => m.includes("Handoff"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run:

```bash
cd .agent/tools && pnpm exec vitest run __tests__/cross-app-types-check.test.ts 2>&1 | tail -20 && cd ../..
```

Expected: FAIL — `Cannot find module '../cross-app-types-check.js'`.

- [ ] **Step 3: Implement `runCrossAppTypesAdvisory`.**

Create `.agent/tools/cross-app-types-check.ts`:

```ts
import {
  Project,
  type SourceFile,
  type InterfaceDeclaration,
  type TypeAliasDeclaration,
} from "ts-morph";
import { join } from "path";
import type { ValidatorWarning } from "./route-class-validator.js";

/**
 * Static enumeration of @switchboard/schemas export names that are
 * load-bearing cross-app value types. Hand-curated for PR-2.5; PR-4
 * may swap to a dynamic enumeration that walks
 * packages/schemas/src/index.ts via ts-morph.
 *
 * The set covers:
 *   - Types relocated by PR-2 (ApprovalRecord, ApprovalState, Handoff,
 *     ConversationState, ConversationSummary, ConversationDetail,
 *     ConversationRow, ConversationListResult, OperatorOverview, plus
 *     the DashboardOverview back-compat alias).
 *   - A few obvious cross-app names that already lived in schemas
 *     before PR-2 (Contact, ConversationThread, Recommendation,
 *     Decision, Opportunity, ContactBrowseRow).
 *
 * Names NOT in this set (e.g. MinimalApprovalRecord,
 * ApprovalRecordForResponse) are deliberately-narrower local shapes
 * and are not flagged.
 */
const SCHEMAS_EXPORT_NAMES: ReadonlySet<string> = new Set([
  "ApprovalRecord",
  "ApprovalState",
  "ApprovalStatus",
  "QuorumState",
  "QuorumEntry",
  "Handoff",
  "HandoffStatus",
  "HandoffReason",
  "LeadSnapshot",
  "QualificationSnapshot",
  "ConversationState",
  "ConversationMessage",
  "ConversationSummary",
  "ConversationDetail",
  "ConversationRow",
  "ConversationListResult",
  "OperatorOverview",
  "DashboardOverview",
  "Contact",
  "ConversationThread",
  "Recommendation",
  "Decision",
  "Opportunity",
  "ContactBrowseRow",
]);

const APP_SRC_RX = /^apps\/(api|chat|dashboard|mcp-server)\/src\//;
const TESTS_RX = /\/__tests__\//;
const SUPPRESS_DIRECTIVE_RX = /\/\/\s*route-governance:\s*local-view-model\b/;

export interface CrossAppTypesAdvisoryOptions {
  /** Repo-relative paths to scan. */
  touchedFiles: string[];
  /** Absolute repo root. */
  repoRoot: string;
}

export interface CrossAppTypesAdvisoryResult {
  warnings: ValidatorWarning[];
  exitCode: 0;
}

export async function runCrossAppTypesAdvisory(
  opts: CrossAppTypesAdvisoryOptions,
): Promise<CrossAppTypesAdvisoryResult> {
  const inScope = opts.touchedFiles.filter(
    (f) => APP_SRC_RX.test(f) && !TESTS_RX.test(f) && (f.endsWith(".ts") || f.endsWith(".tsx")),
  );
  if (inScope.length === 0) return { warnings: [], exitCode: 0 };

  const project = new Project({ useInMemoryFileSystem: false });
  const warnings: ValidatorWarning[] = [];

  for (const repoPath of inScope) {
    const abs = join(opts.repoRoot, repoPath);
    let sf: SourceFile;
    try {
      sf = project.addSourceFileAtPath(abs);
    } catch {
      continue; // file missing — skip silently
    }
    warnings.push(...scanFile(sf, repoPath));
  }

  return { warnings, exitCode: 0 };
}

function scanFile(sf: SourceFile, repoPath: string): ValidatorWarning[] {
  const out: ValidatorWarning[] = [];
  for (const decl of [...sf.getInterfaces(), ...sf.getTypeAliases()]) {
    if (!decl.isExported()) continue;
    const name = decl.getName();
    if (!SCHEMAS_EXPORT_NAMES.has(name)) continue;
    if (hasSuppressDirective(decl)) continue;
    out.push({
      path: repoPath,
      message: `local '${name}' duplicates @switchboard/schemas export — import { ${name} } from "@switchboard/schemas" instead, or annotate the declaration with '// route-governance: local-view-model' if a deliberately narrower local shape`,
    });
  }
  return out;
}

function hasSuppressDirective(decl: InterfaceDeclaration | TypeAliasDeclaration): boolean {
  // ts-morph: getLeadingCommentRanges returns the comments immediately above
  // the declaration node. Single-line comments lose newlines; we just need to
  // match the directive regex against their text.
  const ranges = decl.getLeadingCommentRanges();
  for (const r of ranges) {
    if (SUPPRESS_DIRECTIVE_RX.test(r.getText())) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run:

```bash
cd .agent/tools && pnpm exec vitest run __tests__/cross-app-types-check.test.ts 2>&1 | tail -15 && cd ../..
```

Expected: all 10 cases PASS.

- [ ] **Step 5: Type-check the .agent/tools directory.**

Run:

```bash
cd .agent/tools && pnpm exec tsc --noEmit 2>&1 | tail -10 && cd ../..
```

Expected: clean. If `ValidatorWarning` import fails, verify the export from `route-class-validator.ts` is reachable; it is exported (verified during plan-writing at line 18).

- [ ] **Step 6: Run the advisory against the real `apps/\*/src/**` tree as a smoke test.\*\*

Run:

```bash
cd .agent/tools && pnpm exec tsx -e '
import { runCrossAppTypesAdvisory } from "./cross-app-types-check.js";
import { execSync } from "child_process";
import { resolve } from "path";

const repoRoot = resolve("../..");
const touched = execSync("git -C " + repoRoot + " ls-files apps", { encoding: "utf8" }).split("\n").filter(Boolean);
const result = await runCrossAppTypesAdvisory({ touchedFiles: touched, repoRoot });
console.log("warnings:", result.warnings.length);
for (const w of result.warnings) console.log(w.path + ": " + w.message);
' 2>&1 | tail -20 && cd ../..
```

Expected: **zero warnings on the post-PR-2 baseline.** PR-2 already removed the local `interface ApprovalRecord` / `Handoff` / `ConversationStateData` / `ConversationSummary` declarations. If the advisory finds any hit, either:

(a) PR-2 missed a consumer migration — go fix it in this PR-2.5 (it's still a cross-app-type duplicate); OR
(b) `SCHEMAS_EXPORT_NAMES` includes a name that is also a deliberately-narrower local shape elsewhere — in which case the rule scope is wrong; refine the set.

Either way, do not commit until baseline is zero.

- [ ] **Step 7: Commit.**

```bash
git add .agent/tools/cross-app-types-check.ts .agent/tools/__tests__/cross-app-types-check.test.ts
git commit -m "$(cat <<'EOF'
feat(check-routes): cross-app-types advisory in warning mode

Scans apps/*/src/** for exported local interface/type declarations
whose name matches a @switchboard/schemas export. Honors inline
'// route-governance: local-view-model' suppression. Warning-only
(exit 0); PR-4 flips both this and the route-class advisory to error.

Route Governance Contract v1 §8.6.
EOF
)"
```

---

### Task 9: Wire the new advisory into `check-routes.ts --mode=warn-touched`

The new advisory runs alongside the existing route-class advisory in the same CI step. Both produce GitHub-Actions warnings; both keep exit code 0.

**Files:**

- Modify: `.agent/tools/check-routes.ts`.
- Modify: `.agent/tools/__tests__/check-routes-warn-mode.test.ts`.

- [ ] **Step 1: Write a failing test for the integration.**

Append to `.agent/tools/__tests__/check-routes-warn-mode.test.ts`:

```ts
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("runRouteClassAdvisory + cross-app-types integration (via CLI surface)", () => {
  // This is exercised via runCrossAppTypesAdvisory directly in the
  // sibling test file. Here we just confirm both advisories share the
  // same touched-files scope without interfering with each other.
  it("cross-app-types advisory and route-class advisory return independently", async () => {
    const { runRouteClassAdvisory } = await import("../check-routes.js");
    const { runCrossAppTypesAdvisory } = await import("../cross-app-types-check.js");

    const routeOnly = await runRouteClassAdvisory({
      touchedFiles: ["apps/api/src/routes/recommendations.ts"],
      repoRoot: process.cwd(),
    });
    const crossOnly = await runCrossAppTypesAdvisory({
      touchedFiles: ["apps/api/src/routes/recommendations.ts"],
      repoRoot: process.cwd(),
    });

    expect(routeOnly.exitCode).toBe(0);
    expect(crossOnly.exitCode).toBe(0);
    expect(Array.isArray(routeOnly.warnings)).toBe(true);
    expect(Array.isArray(crossOnly.warnings)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test.**

Run:

```bash
cd .agent/tools && pnpm exec vitest run __tests__/check-routes-warn-mode.test.ts 2>&1 | tail -15 && cd ../..
```

Expected: PASS — both functions exist and return the expected shape. This test exists to lock the contract; the CLI integration is exercised in Step 4.

- [ ] **Step 3: Extend the `--mode=warn-touched` CLI branch.**

In `.agent/tools/check-routes.ts`, at the top of the file add the import:

```ts
import { runCrossAppTypesAdvisory } from "./cross-app-types-check.js";
```

Then replace the existing `if (mode === "warn-touched") { ... }` block (current lines 173-182) with:

```ts
if (mode === "warn-touched") {
  const touched = detectTouchedFiles();
  const [routeClass, crossAppTypes] = await Promise.all([
    runRouteClassAdvisory({ repoRoot, touchedFiles: touched }),
    runCrossAppTypesAdvisory({ repoRoot, touchedFiles: touched }),
  ]);
  const merged = [...routeClass.warnings, ...crossAppTypes.warnings];
  for (const w of merged) {
    console.warn(`::warning file=${w.path}::${w.message}`);
  }
  if (merged.length > 0) {
    console.warn(
      `\n${merged.length} advisory warning(s) — ${routeClass.warnings.length} route-class, ${crossAppTypes.warnings.length} cross-app-types.`,
    );
  }
  process.exit(0);
}
```

Two notes:

(a) The original `runRouteClassAdvisory` signature accepts an optional `touchedFiles`. We now compute `touched` once (via the existing `detectTouchedFiles()` helper) and pass it explicitly to both advisories so they see identical scope.

(b) The exit code is hard-coded `0` because both are warning mode. PR-4 will replace this branch with an error-mode path that returns non-zero.

- [ ] **Step 4: Smoke-test the CLI on a touched-files diff.**

Run a CLI invocation against a synthetic touched-files set:

```bash
cd .agent/tools && pnpm exec tsx check-routes.ts --mode=warn-touched 2>&1 | tail -10 && cd ../..
```

Expected: exit 0. May or may not emit warnings depending on `git diff --name-only origin/main...HEAD` at the time of the run. If you've only made PR-2.5 commits so far, the touched routes are very limited and the advisory output should be near-empty.

- [ ] **Step 5: Verify the existing warn-mode tests still pass.**

Run:

```bash
cd .agent/tools && pnpm exec vitest run 2>&1 | tail -15 && cd ../..
```

Expected: full test suite green, including the existing 3 tests in `check-routes-warn-mode.test.ts` and the new integration test from Step 1.

- [ ] **Step 6: Commit.**

```bash
git add .agent/tools/check-routes.ts .agent/tools/__tests__/check-routes-warn-mode.test.ts
git commit -m "$(cat <<'EOF'
feat(check-routes): wire cross-app-types advisory into --mode=warn-touched

The same CI step that already runs the route-class advisory now also
runs the cross-app-types advisory. Both warning-only; both exit 0. The
CI workflow (.github/workflows/ci.yml step 'Route class advisory')
needs no change — the new advisory rides the existing invocation.

Route Governance Contract v1 §8.6.
EOF
)"
```

---

### Task 10: End-to-end verification

**Files:** none touched — verification only.

- [ ] **Step 1: Run the full monorepo build.**

```bash
pnpm reset 2>&1 | tail -10
pnpm build 2>&1 | tail -30
```

Expected: clean build. `pnpm reset` is mandatory because PR-2.5 touches core's barrel (`packages/core/src/index.ts` gained a `RouteTemplates` re-export in Task 1) — stale `dist/` artifacts cause spurious "missing export" errors per the CLAUDE.md note.

- [ ] **Step 2: Run the full test suite.**

```bash
pnpm test 2>&1 | tail -40
```

Expected: green. If a flake fires per the memory hits (e.g., `prisma-work-trace-store-integrity` advisory-lock flake or `bootstrap-smoke` npm-warning flake), confirm it reproduces on baseline `main` and is not a PR-2.5 regression.

- [ ] **Step 3: Run typecheck across the monorepo.**

```bash
pnpm typecheck 2>&1 | tail -30
```

Expected: green.

- [ ] **Step 4: Run the dashboard Next build (CI does NOT run this).**

```bash
pnpm --filter @switchboard/dashboard build 2>&1 | tail -30
```

Expected: green. Per `feedback_dashboard_build_not_in_ci.md` — Next.js extension-related regressions slip past CI's lint+typecheck unless verified locally. PR-2.5 does not touch dashboard source (the only dashboard collision would be if cockpit-v2 added an import path that pulled the new core re-export through a `.js` extension; verified during plan-writing it does not).

- [ ] **Step 5: Run `pnpm format:check` (CI runs this; local `pnpm lint` does not).**

```bash
pnpm format:check 2>&1 | tail -10
```

Expected: green. Per `feedback_ci_prettier_not_in_local_lint.md`. If `docs/DOCTRINE.md` is flagged, re-run prettier on it (Task 7 Step 4 should have handled this, but a follow-up commit at this step is acceptable if needed).

- [ ] **Step 6: Verify the grep state is clean.**

```bash
# Zero /contacts/ URL literals in core source:
rg -n '/contacts/' packages/core/src --type ts | grep -v __tests__ | grep -v 'Composite read-side projection'

# DOCTRINE has the new invariant:
grep -n '11. Cross-app types live in `@switchboard/schemas`' docs/DOCTRINE.md

# The new advisory file exists and is wired:
ls .agent/tools/cross-app-types-check.ts
grep -n 'runCrossAppTypesAdvisory' .agent/tools/check-routes.ts
```

Expected:

- First grep: zero hits.
- Second grep: one hit (the heading).
- Third grep: file present, advisory imported AND called in the warn-touched branch.

- [ ] **Step 7: Run the advisory against the real `apps/\*/src/**` tree one more time.\*\*

```bash
cd .agent/tools && pnpm exec tsx -e '
import { runCrossAppTypesAdvisory } from "./cross-app-types-check.js";
import { execSync } from "child_process";
import { resolve } from "path";
const repoRoot = resolve("../..");
const touched = execSync("git -C " + repoRoot + " ls-files apps", { encoding: "utf8" }).split("\n").filter(Boolean);
const result = await runCrossAppTypesAdvisory({ touchedFiles: touched, repoRoot });
console.log("warnings:", result.warnings.length);
for (const w of result.warnings) console.log(w.path + ": " + w.message);
' 2>&1 | tail -20 && cd ../..
```

Expected: zero warnings. (Same as Task 8 Step 6, re-run after final commits.)

- [ ] **Step 8: No new commit.** Verification is a gate, not a code change. Open the PR after this step passes.

---

## Self-review

Performed after the plan was written, against the spec sections it consumes.

**Spec coverage (PR-2.5 portion):**

- §8.5 Surface-URL strings — Tasks 1 + 2 + 3 + 4 + 5 + 6.
- §8.6 Doctrine line — Task 7.
- §8.6 Cross-app-types check rule — Tasks 8 + 9.
- §11 crosswalk row 3.9 (Surface-URL strings in core) — closed by Tasks 3-5.
- §11 crosswalk row 3.15 (Untyped Graph API response) — out of scope (PR-3).
- §12 PR-2 envelope (the portion deferred from PR-2) — fully covered by Tasks 1-9.

**Type consistency:**

- `RouteTemplates` is the canonical interface name throughout. `dashboardRouteTemplates` is the canonical constant name.
- `RouteTemplates` is exposed as **type-only** via the core barrel (`export type { RouteTemplates } from "./lib/route-templates.js"`) and consumed as type-only at every call site (`import type { RouteTemplates }`). Interface has no runtime value; using `export type` / `import type` prevents accidental runtime imports.
- The three method names — `contactDetail`, `contactConversations`, `contactConversationDetail` — appear identically in Task 1 (interface), Task 2 (constant), Task 3-5 (call sites), and the test fixtures. Single source of truth.
- `runCrossAppTypesAdvisory` has the same shape as the existing `runRouteClassAdvisory` (`{ touchedFiles, repoRoot } → { warnings, exitCode: 0 }`) so the CLI integration in Task 9 is symmetric.
- `ValidatorWarning` is the shared warning shape (imported from `route-class-validator.ts`); both advisories produce the same structured output.

**Deliberate behaviour changes (flagged in PR description):**

- `adaptHandoff`'s `threadHref` now returns `null` when `contact?.id` is missing, instead of producing the malformed `/contacts/undefined/conversations/<id>` that the pre-injection literal silently emitted. The tightening lives in Task 5 Step 3 and is locked by a dedicated test added in Task 5 Step 1 (contact-null branch). No other call sites depended on the malformed URL — `decisions.ts` is the sole caller, and the dashboard route cannot render `/contacts/undefined/...` usefully. Reviewer should confirm the no-other-caller assumption with one grep at PR time: `rg -n 'threadHref' apps packages --type ts | grep -v __tests__`.

**No placeholders:** searched the document — no TBD, no "implement later", no "similar to Task N" without the code shown. Every code block in every step is concrete.

**Collision risk audited:** cockpit-v2 (0 hits in `apps/dashboard/src/components/cockpit/**`); consent-enforcement worktree (no file overlap). Plan is safe to execute concurrently with both.

**Scope discipline:** the three slices (routeTemplates, doctrine, check rule) are independent. If reviewer feedback wants to split, slice 1 (Tasks 1-6) + slice 2 (Task 7) + slice 3 (Tasks 8-9) can each become their own PR with no rework. Bundling them in a single PR is the recommended default — the theme ("surface decoupling + tooling") is coherent and the review surface is small.

**Reviewer-feedback application:** the original PR-2 plan's pre-feedback for the cross-app-types rule called out four tightenings — all four are now in slice 3:

1. ✅ Only flag EXPORTED local decls (`decl.isExported()` gate in `scanFile`).
2. ✅ Inline suppression via `// route-governance: local-view-model` (Task 8 Step 3's `hasSuppressDirective`).
3. ✅ Message includes schema export name + import suggestion (Task 8 Step 1 test asserts both substrings).
4. ✅ Skip `__tests__/` and files outside `apps/*/src/**` (Task 8 Step 3's `APP_SRC_RX` + `TESTS_RX` gates; Task 8 Step 1 tests cover both).

**Reviewer-feedback application — surface-URL count:** the spec / brief mentioned 4 sites; pre-flight verification proved there are 3 (the 4th in `contacts/detail.ts` is a doc comment, not code). The "Pre-flight verification" table above explicitly records this, so the implementing agent doesn't waste time hunting a 4th literal.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-23-route-governance-contract-impl-pr2-5.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task with two-stage review. PR-2.5's slices are independent and the tasks within each slice are tightly sequenced, so the per-task isolation is a clean fit.

2. **Inline Execution** — execute tasks sequentially via `superpowers:executing-plans` with batch checkpoints. Reasonable if reviewer prefers a single linear log; the 10 tasks are small enough to fit comfortably in one session.

Which approach?
