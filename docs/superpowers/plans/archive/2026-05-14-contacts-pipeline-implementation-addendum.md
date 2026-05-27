# Contacts Pipeline Implementation — 2026-05-14 Addendum

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to execute the underlying plan.

> **⚠️ DO NOT IMPLEMENT FROM THIS ADDENDUM ALONE.** This document only replaces the pre-flight steps and adds guardrails. The actual implementation tasks (schemas, hooks, components, tests) live in `docs/superpowers/plans/2026-05-13-contacts-pipeline-implementation.md`. After running the replacement pre-flight below, open that plan and execute it from Task 1 onward. If you cannot find that file, STOP — do not improvise.

**Goal:** Re-validate the previously-written implementation plan at `docs/superpowers/plans/2026-05-13-contacts-pipeline-implementation.md` against `main` as of 2026-05-14, capture the one piece of drift (the worktree pre-flight), and harden the guardrails for the three highest-risk areas (PR scope creep, drawer mutual exclusion, currency unit, wire-shape drift).

**Architecture:** No new implementation content. The 2026-05-13 plan is the source of truth. This addendum is a short pointer + a worktree-pre-flight override + five guardrails.

---

## Audit result (2026-05-14)

The 2026-05-13 implementation plan was written against `main` after PR #450 merged its spec + plan. Re-checking each precondition the plan assumes:

| Precondition                                                                                                                                                                 | State on `main` @ 2026-05-14                        | Verdict         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------- |
| `apps/dashboard/src/app/(auth)/(mercury)/contacts/hooks/use-contacts-list.ts` exists (to be deleted)                                                                         | Still present                                       | ✅ matches plan |
| `apps/dashboard/src/app/(auth)/(mercury)/contacts/components/{contact-row,contacts-table,filter-chips,search-input,pagination-footer,empty-state}.tsx` exist (to be deleted) | All present                                         | ✅ matches plan |
| `packages/schemas/src/pipeline-board.ts` does NOT exist (to be created)                                                                                                      | Absent                                              | ✅ matches plan |
| `apps/dashboard/src/lib/query-keys.ts` has no `opportunities` namespace (to be added)                                                                                        | Absent                                              | ✅ matches plan |
| `apps/dashboard/src/components/layout/right-drawer-context.tsx` does NOT exist (to be created)                                                                               | Absent                                              | ✅ matches plan |
| `apps/dashboard/src/app/(auth)/(mercury)/contacts/[id]/` is untouched and stable                                                                                             | Present, unchanged since D1.5                       | ✅ matches plan |
| `OpportunitySchema` and `PrismaOpportunityStore.updateStage` exist for the eventual backend PR                                                                               | Both present                                        | ✅ matches plan |
| `NEXT_PUBLIC_CONTACTS_LIVE` gate is the live-mode flag                                                                                                                       | Still wired through `isMercuryToolLive("contacts")` | ✅ matches plan |

**The plan still applies as-written.** No tasks need to be added, removed, or re-ordered.

---

## The one drift: worktree pre-flight is stale

The plan's "Pre-flight: verify environment" section (Steps 1–3) assumes the engineer is already inside the worktree at `.worktrees/pipeline-spec` on branch `docs/contacts-pipeline-spec`. That branch was the **spec** branch and merged into `main` as PR #450 on 2026-05-13. It no longer exists locally as a working branch.

### Replacement pre-flight (use this in place of Steps 1–3 in the 2026-05-13 plan)

- [ ] **Step 1: Cut a fresh worktree from `main`**

```bash
git fetch origin main
git worktree add -b feat/contacts-pipeline-pr-c1 \
  /Users/jasonli/switchboard/.worktrees/pipeline-pr-c1 origin/main
cd /Users/jasonli/switchboard/.worktrees/pipeline-pr-c1
pnpm worktree:init
```

Expected: worktree exists, `.env` copied, deps installed, migrations applied if Postgres reachable.

- [ ] **Step 2: Confirm worktree + branch**

```bash
git rev-parse --show-toplevel
git branch --show-current
```

Expected:

```
/Users/jasonli/switchboard/.worktrees/pipeline-pr-c1
feat/contacts-pipeline-pr-c1
```

If you see anything else, STOP — per `CLAUDE.md` "One branch per worktree."

- [ ] **Step 3: Confirm starting tree is clean + baseline passes**

```bash
git status --short
pnpm typecheck
pnpm --filter @switchboard/dashboard test
```

Expected: empty status, typecheck clean, dashboard tests pass. If typecheck fails with missing exports from `@switchboard/schemas` / `@switchboard/db` / `@switchboard/core`, run `pnpm reset` first.

Then proceed to **Task 1: Pipeline-board schemas** in the 2026-05-13 plan, unchanged.

---

## Guardrail 1: PR-C1 is frontend-on-fixtures only — hard no-backend rule

Spec §11 sequences PR-C1 (this plan; frontend on fixtures) → PR-C2 (backend `GET /api/dashboard/opportunities` + `PATCH /:id/stage` + audit emission via `PlatformIngress.submit()`) → PR-C3 (flip `NEXT_PUBLIC_CONTACTS_LIVE=true`). PR-C2 needs its own spec + plan. PR-C3 is a small env-config flip.

**PR-C1 must NOT create or modify:**

- Fastify routes for opportunities (anything under `apps/api/src/routes/dashboard-opportunit*` or similar)
- `PrismaOpportunityStore` mutation paths (e.g., `updateStage`); reading the file to confirm signatures is fine, modifying it is not
- `PlatformIngress.submit()` or any audit-emission code path
- Any deploy env file (`.env*`, `vercel.json`, `render.yaml`, `railway.json`)
- Any value of `NEXT_PUBLIC_CONTACTS_LIVE` — it stays OFF when PR-C1 merges

**Self-check before opening the PR-C1 PR:**

```bash
git fetch origin main
git diff origin/main -- apps/api/ packages/core/src/governance/ packages/db/src/stores/prisma-opportunity-store.ts | wc -l
# Expected: 0
git diff origin/main | grep -i 'NEXT_PUBLIC_CONTACTS_LIVE' || echo 'OK: flag unchanged'
# Expected: 'OK: flag unchanged' or only test-file refs
```

If either check fails, the change exceeds PR-C1 scope — split it out before merging.

---

## Guardrail 2: Drawer mutual exclusion has explicit split triggers

Spec §2 OPEN-27 keeps `InboxDrawer` mutual-exclusion in PR-C1 scope with the smallest possible cross-cutting change (state-source only, no visual diff). Acceptance criterion 9 is the load-bearing test: "InboxDrawer has zero visual diff."

**Split the `InboxDrawer` change into a follow-up PR-C1b if ANY of these is true:**

1. Wiring mutual exclusion requires touching more than `InboxDrawer`'s mount point + the new `right-drawer-context.tsx`. Touching `InboxDrawer`'s internals (markup, styles, animation, focus management) is a split trigger — the spec authorizes only the state-source swap.
2. Any existing test that renders `InboxDrawer` needs more than wrapping in `<RightDrawerProvider>` to keep passing. A required test-harness rewrite is a split trigger.
3. Any snapshot/visual regression on a page that uses `InboxDrawer` changes. Even one pixel is a split trigger.
4. The change introduces a new prop, new context consumer outside the two drawers, or new behavior toggle. The spec scopes the change to a `kind` field on a single context — anything wider is a split trigger.

**If split**, accept "both right-side drawers can be open at once" as a documented v1 known-issue (spec §2 OPEN-27 explicitly authorizes this). PR-C1 still ships the new opportunity drawer; PR-C1b adds the mutual exclusion later.

---

## Guardrail 3: Currency formatter must lock the storage unit with a test, not a comment

Spec §6.6 names this risk explicitly: `Opportunity.estimatedValue` and `Opportunity.revenueTotal` are typed `z.number().int()` with no unit annotation in `OpportunitySchema`. A 100× error renders silently — every value on the board would be wrong.

The 2026-05-13 plan's formatter task already calls for verification. Strengthen it with a **regression test**, not just a code comment:

```ts
// In components/__tests__/format.test.ts (the existing/new format test file):
import { formatSGD } from "../format.js";
import { OpportunitySchema } from "@switchboard/schemas";

// Lock the storage unit. If a future schema change reinterprets the field,
// this test fires before the visual regression does.
describe("formatSGD currency unit", () => {
  it("treats Opportunity.estimatedValue as the unit confirmed during PR-C1 implementation", () => {
    // After tracing one real Opportunity row through seed/store/projection (per spec §6.6),
    // record the verified unit in this test. Example assertions for each possible answer:
    //   If dollars: formatSGD(1234) === "S$1,234"
    //   If cents:   formatSGD(123400) === "S$1,234"
    // Pick ONE based on the actual verified unit and remove the other branch.
    expect(formatSGD(<verified-value-for-1234-sgd>)).toBe("S$1,234");
  });
});
```

**PR-C1 PR body must state:**

- Confirmed storage unit for `Opportunity.estimatedValue` (dollars vs cents)
- Confirmed storage unit for `Opportunity.revenueTotal`
- How the implementer verified it (seed file path / Prisma query / commit reference)
- Pointer to the locking test in `format.test.ts`

If you cannot answer the first three before writing the formatter, **stop and trace one real row first.** No formatter body without the verification.

---

## Guardrail 4: Schema contract test must include a realistic PR-C2 wire-shape fixture

The 2026-05-13 plan's Task 1 already adds schema tests for `PipelineBoardOpportunitySchema`. Strengthen those tests by adding **one additional fixture that represents the wire shape PR-C2 will eventually return** — joined from a real `Opportunity` row plus a minimal `Contact` projection per spec §6.1.

```ts
// packages/schemas/src/pipeline-board.test.ts — additional case:

// Locked PR-C2 wire shape. If PR-C2's projection drifts from this, the test
// fires before integration testing does. This fixture is intentionally maximal:
// every optional field is populated, no defaults, no nulls except where the
// spec marks the field nullable.
const PR_C2_REPRESENTATIVE_PAYLOAD = {
  rows: [
    {
      // ... a full PipelineBoardOpportunity row including every field
      //     from spec §6.1, with realistic SGD-medspa values
    },
  ],
};

it("accepts the locked PR-C2 wire shape", () => {
  expect(() => PipelineBoardResponseSchema.parse(PR_C2_REPRESENTATIVE_PAYLOAD)).not.toThrow();
});
```

This fixture **does not have to predict PR-C2's exact JSON envelope**; it just has to lock spec §6.1's field-by-field shape. When PR-C2 lands and a developer accidentally renames a field or changes a type, this test fires.

---

## Guardrail 5: Flag safety checklist

The PR-C1 PR template / description must include:

```markdown
## Flag safety

- [ ] No deploy env file changed (`.env*`, `vercel.json`, etc.)
- [ ] `NEXT_PUBLIC_CONTACTS_LIVE` value unchanged in any non-test file
- [ ] Local `NEXT_PUBLIC_CONTACTS_LIVE=true` smoke-test recorded (or marked N/A if backend not running)
- [ ] PR-C2 (backend) tracked as separate PR or issue
- [ ] PR-C3 (flag flip) tracked as separate ops task
```

---

## Pointer

Go to: `docs/superpowers/plans/2026-05-13-contacts-pipeline-implementation.md`. Start at Task 1 after running the replacement pre-flight above. When you write the formatter, schema, or `InboxDrawer` change, return to this addendum's guardrails 2–4 first.
