# F-02 Fresh Org Entitlement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A freshly provisioned organization is `entitled: true` and can take mutating actions out of the box, instead of being permanently 402-blocked by the billing entitlement gate.

**Architecture:** Pure producer-population. The entitlement gate (`evaluateEntitlement`) and its three enforcement chokepoints are already correct; the gap is that no provisioning path supplies an entitling value. Set `entitlementOverride: true` (the documented comped-pilot field) at the two canonical org create-sites, mirroring exactly how F-01 (#1024) seeded `businessHours` at the same two sites. No schema change, so no migration. Comping entitlement does not touch governance spend or approval gates.

**Tech Stack:** TypeScript monorepo (pnpm + Turborepo), Prisma, Fastify (apps/api), Next.js (apps/dashboard), Vitest. Spec: `docs/superpowers/specs/2026-06-14-fresh-org-entitlement-design.md`.

---

## File structure

Modify (producers):

- `apps/dashboard/src/lib/provision-dashboard-user.ts`: add `entitlementOverride: true` to the `organizationConfig.create` data (self-serve signup, the real path).
- `apps/api/src/routes/organizations.ts`: add `entitlementOverride: true` to the lazy `GET /config` upsert `create` branch (defense-in-depth path). HARD CONSTRAINT: this file is 598 lines and the arch-check hard limit is 600 (`wc -l` must stay <= 599), so the edit must add exactly one physical line.

Modify (tests):

- `apps/dashboard/src/lib/__tests__/provision-dashboard-user.test.ts`: producer + seam test.
- `apps/api/src/__tests__/api-organizations.test.ts`: extend "auto-creates default config" with producer + seam assertions.
- `packages/core/src/billing/__tests__/entitlement.test.ts`: named regression pin for the fresh-org tuple.

No new files. No schema/migration. No new env var.

---

### Task 1: Dashboard provisioning producer (self-serve signup)

**Files:**

- Modify: `apps/dashboard/src/lib/provision-dashboard-user.ts:34-36`
- Test: `apps/dashboard/src/lib/__tests__/provision-dashboard-user.test.ts`

- [ ] **Step 1: Write the failing test**

Add the `evaluateEntitlement` import to the existing import block at the top of the test file (after line 2, `import { DEFAULT_BUSINESS_HOURS } from "@switchboard/schemas";`):

```ts
import { evaluateEntitlement } from "@switchboard/core/billing";
```

Append this new describe block to the end of the file (after the existing F-01 describe closes at line 52). It reuses the module-level `makeTxPrisma` and `TEST_SECRET` helpers:

```ts
describe("provisionDashboardUser entitlement seeding (F-02)", () => {
  let savedEnv: string | undefined;

  beforeAll(() => {
    savedEnv = process.env.CREDENTIALS_ENCRYPTION_KEY;
    process.env.CREDENTIALS_ENCRYPTION_KEY = TEST_SECRET;
  });

  afterAll(() => {
    if (savedEnv !== undefined) {
      process.env.CREDENTIALS_ENCRYPTION_KEY = savedEnv;
    } else {
      delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    }
  });

  it("comps the org so a freshly provisioned org is entitled out of the box", async () => {
    const { prisma, tx } = makeTxPrisma();

    await provisionDashboardUser(prisma as never, { email: "owner@clinic.test" });

    const createArg = (tx.organizationConfig.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    // Producer: provisioning sets the comped-pilot override.
    expect(createArg.data.entitlementOverride).toBe(true);

    // Seam from real producer output: the values a fresh org is provisioned with
    // evaluate to entitled. The producer omits subscriptionStatus, so it falls to
    // the schema default "none".
    expect(
      evaluateEntitlement({
        subscriptionStatus: createArg.data.subscriptionStatus ?? "none",
        entitlementOverride: createArg.data.entitlementOverride,
      }),
    ).toEqual({ entitled: true, reason: "override" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- provision-dashboard-user`
Expected: FAIL on `expect(createArg.data.entitlementOverride).toBe(true)` (receives `undefined`), because the producer does not yet set the field. Confirm it fails for THAT reason (not an import/module error).

- [ ] **Step 3: Write minimal implementation**

In `apps/dashboard/src/lib/provision-dashboard-user.ts`, the current create data ends with the F-01 businessHours line:

```ts
        // F-01: seed valid default business hours so a fresh org resolves
        // LocalCalendarProvider (not Noop) and the booking loop works out of the box.
        businessHours: DEFAULT_BUSINESS_HOURS,
      },
```

Insert the override field immediately after `businessHours: DEFAULT_BUSINESS_HOURS,` (before the closing `},`):

```ts
        // F-02: comp the pilot org so a freshly provisioned org is entitled and can
        // act out of the box. entitlementOverride is the documented comped-pilot field
        // (schema.prisma). Billing is off during the pilot; the billing-live milestone
        // flips provisioning to a real trial/checkout and clears pilot-era overrides.
        // See docs/superpowers/specs/2026-06-14-fresh-org-entitlement-design.md
        entitlementOverride: true,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- provision-dashboard-user`
Expected: PASS (both the F-01 and the new F-02 describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/lib/provision-dashboard-user.ts \
  apps/dashboard/src/lib/__tests__/provision-dashboard-user.test.ts
git commit -m "fix(billing): entitle fresh orgs at dashboard provisioning (F-02)"
```

---

### Task 2: API lazy-config provisioning producer (defense-in-depth)

**Files:**

- Modify: `apps/api/src/routes/organizations.ts:77` (one physical line only; see line-limit constraint)
- Test: `apps/api/src/__tests__/api-organizations.test.ts:105-140`

- [ ] **Step 1: Write the failing test**

Add the `evaluateEntitlement` import after line 16 (`import { DEFAULT_BUSINESS_HOURS } from "@switchboard/schemas";`):

```ts
import { evaluateEntitlement } from "@switchboard/core/billing";
```

In the existing test `it("auto-creates default config when none exists", ...)`, add `entitlementOverride: true` to the `create` objectContaining (immediately after the `businessHours: DEFAULT_BUSINESS_HOURS,` line at 135) so the asserted block reads:

```ts
          create: expect.objectContaining({
            id: "org_test",
            onboardingComplete: false,
            provisioningStatus: "pending",
            // F-01: a fresh org must be seeded with valid default business hours so the
            // calendar provider factory resolves Local (not Noop) and bookings work.
            businessHours: DEFAULT_BUSINESS_HOURS,
            // F-02: a fresh org must be comped so it is entitled out of the box.
            entitlementOverride: true,
          }),
```

Then, immediately after the `expect(mockPrisma.organizationConfig.upsert).toHaveBeenCalledWith(...)` assertion closes (after line 139), add the seam pin:

```ts
// Seam from real producer output: the lazy-create values evaluate to entitled.
const createArg = mockPrisma.organizationConfig.upsert.mock.calls[0]![0].create;
expect(
  evaluateEntitlement({
    subscriptionStatus: createArg.subscriptionStatus ?? "none",
    entitlementOverride: createArg.entitlementOverride,
  }),
).toEqual({ entitled: true, reason: "override" });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/api test -- api-organizations`
Expected: FAIL on the `toHaveBeenCalledWith` objectContaining (the `create` payload lacks `entitlementOverride: true`) and/or the seam assertion (`evaluateEntitlement` of `entitlementOverride: undefined` returns blocked). Confirm it fails for THAT reason.

- [ ] **Step 3: Write minimal implementation**

In `apps/api/src/routes/organizations.ts`, the lazy create branch currently ends with the F-01 businessHours line at 77:

```ts
          businessHours: DEFAULT_BUSINESS_HOURS, // F-01: resolve Local (not Noop) for fresh orgs
        },
        update: {},
```

Insert exactly ONE physical line after the `businessHours` line (the file is at the 600-line arch limit, so a single line keeps it at 599):

```ts
          entitlementOverride: true, // F-02: comp pilot org so it is entitled out of the box
```

- [ ] **Step 4: Verify the line budget did not blow the arch limit**

Run: `wc -l apps/api/src/routes/organizations.ts && pnpm arch:check 2>&1 | tail -5`
Expected: `wc -l` is 599 (not 600+), and arch:check passes. If `wc -l` is 600 or more, do NOT proceed; instead extract the lazy-create default object into a small co-located constant at the top of the file (a module-level `const FRESH_ORG_CONFIG_DEFAULTS = { ... }` referenced in the `create:` branch), which removes more lines than it adds, then re-run this step.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @switchboard/api test -- api-organizations`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/organizations.ts apps/api/src/__tests__/api-organizations.test.ts
git commit -m "fix(billing): entitle fresh orgs at lazy config provisioning (F-02)"
```

---

### Task 3: Core consumer seam regression pin

**Files:**

- Test: `packages/core/src/billing/__tests__/entitlement.test.ts`

This documents the exact fresh-org tuple at the consumer layer. It passes immediately because `evaluateEntitlement` already short-circuits on `entitlementOverride`; it exists to lock the seam so a future refactor that reorders the override check cannot silently re-block fresh orgs.

- [ ] **Step 1: Add the regression pin**

Insert this `it` block inside the existing `describe("evaluateEntitlement", ...)` (for example after the "entitlementOverride wins regardless of status" case at line 23):

```ts
it("a freshly provisioned pilot org (default 'none' status + comped override) is entitled (F-02)", () => {
  // Pins the F-02 producer/consumer seam: provisioning leaves subscriptionStatus
  // at the schema default "none" and sets entitlementOverride true, which must
  // resolve to entitled so a fresh org can act out of the box.
  expect(evaluateEntitlement({ subscriptionStatus: "none", entitlementOverride: true })).toEqual({
    entitled: true,
    reason: "override",
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- entitlement`
Expected: PASS (all cases green, including the new F-02 pin).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/billing/__tests__/entitlement.test.ts
git commit -m "test(billing): pin fresh-org entitlement seam (F-02)"
```

---

### Task 4: Full verification gate and skeptical self-review

**Files:** none (verification only).

- [ ] **Step 1: Run the full local gate**

Run each and confirm green (the Postgres-down baseline of 3 db-integrity files, work-trace / ledger / greeting, is environmental, not a regression):

```bash
pnpm typecheck
pnpm --filter @switchboard/core --filter @switchboard/db --filter @switchboard/api test
pnpm --filter @switchboard/dashboard build
pnpm build
pnpm lint
pnpm format:check
pnpm arch:check
CI=1 pnpm local:verify:fast
```

Expected: typecheck clean; core/api green; db shows only the 3 known integrity failures; dashboard build OK; build 10/10; lint/format/arch/local-verify all pass.

- [ ] **Step 2: Skeptical diff review**

Run: `git diff origin/main...HEAD`
Confirm: only the two producer one-field additions, the three test changes, and the spec/plan docs. No schema change, no migration, no unrelated edits. `entitlementOverride: true` appears at both create-sites. The seam tests drive `evaluateEntitlement` from captured producer output, not hand-set fixtures.

- [ ] **Step 3: Push and open PR**

```bash
git push -u origin fix/fresh-org-entitlement
gh pr create --base main --title "fix(billing): entitle fresh pilot orgs at provisioning (F-02)" --body "<see PR body in execution>"
```

---

## Notes for the implementer

- **No migration.** Schema defaults (`subscriptionStatus="none"`, `entitlementOverride=false`) intentionally stay unchanged. The fix is producer-set, which is strictly narrower than flipping a schema default and keeps the defaults correct for non-provisioning create paths, legacy rows, and the billing-live future.
- **Why both sites.** F-01 (#1024) seeded `businessHours` at both `provisionDashboardUser` and the `organizations.ts` lazy-create branch so that an org created by either path is correct. F-02 mirrors that so an org is entitled regardless of which path created it.
- **Out of scope (do not fold in):** OAuth `createUser` (`auth.ts`) is not launch-mode gated, a registration-gating gap that belongs to F-05, flagged in the spec. Also F-09, F-20.
- **Conventions:** commit subjects start lowercase; no em-dashes anywhere; `@switchboard/*` imports take no `.js` extension; relative imports in apps/api use `.js`, dashboard relative imports do not.
