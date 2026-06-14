# F-02 Fresh Org Entitlement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A freshly provisioned organization is `entitled: true` and can take mutating actions out of the box, instead of being permanently 402-blocked by the billing entitlement gate.

**Architecture:** Pure producer-population. The entitlement gate (`evaluateEntitlement`) and its three enforcement chokepoints are already correct; the gap is that no provisioning path supplies an entitling value. Set `entitlementOverride: true` (the documented comped-pilot field) at the two canonical org create-sites. The API lazy-create defaults are extracted into one small documented module so the comp has a single trusted source and `organizations.ts` drops clear of its 600-line arch limit. No schema change, so no migration. Comping entitlement does not touch governance spend or approval gates.

**Tech Stack:** TypeScript monorepo (pnpm + Turborepo), Prisma, Fastify (apps/api), Next.js (apps/dashboard), Vitest. Spec: `docs/superpowers/specs/2026-06-14-fresh-org-entitlement-design.md`.

---

## File structure

Source:

- `apps/dashboard/src/lib/provision-dashboard-user.ts`: add `entitlementOverride: true` inline to the `organizationConfig.create` data (self-serve signup, the real path).
- `apps/api/src/lib/org-config-defaults.ts` (NEW): exports `LAZY_ORG_CONFIG_CREATE_DEFAULTS`, the single documented source of the lazy `GET /config` create defaults, including `entitlementOverride: true`.
- `apps/api/src/routes/organizations.ts`: replace the inline lazy-create object with a spread of the new const; drop the now-unused `DEFAULT_BUSINESS_HOURS` import. Net about minus ten lines (598 to about 588), off the 600-line cliff.

Tests:

- `apps/dashboard/src/lib/__tests__/provision-dashboard-user.test.ts`: producer + seam + called-once guard.
- `apps/api/src/lib/__tests__/org-config-defaults.test.ts` (NEW): defaults-source seam.
- `apps/api/src/__tests__/api-organizations.test.ts`: assert the lazy `upsert` create includes `entitlementOverride: true`.
- `apps/api/src/middleware/__tests__/billing-guard.integration.test.ts`: real-chokepoint regression (fresh DB row through the real resolver and guard returns 200, not 402).

No schema/migration. No new env var. No consumer test added (the existing `entitlement.test.ts` "override wins" loop already covers the `none` + override tuple).

---

### Task 1: Dashboard provisioning producer (self-serve signup)

**Files:**

- Modify: `apps/dashboard/src/lib/provision-dashboard-user.ts` (the `organizationConfig.create` data block)
- Test: `apps/dashboard/src/lib/__tests__/provision-dashboard-user.test.ts`

- [ ] **Step 1: Write the failing test**

Add the import after line 2 (`import { DEFAULT_BUSINESS_HOURS } from "@switchboard/schemas";`):

```ts
import { evaluateEntitlement } from "@switchboard/core/billing";
```

Append this describe block to the end of the file (after the existing F-01 describe). It reuses the module-level `makeTxPrisma` and `TEST_SECRET`:

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

    // Exactly one config create, so reading call[0] is not fragile.
    expect(tx.organizationConfig.create as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
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
Expected: FAIL on `expect(createArg.data.entitlementOverride).toBe(true)` (receives `undefined`). Confirm it fails for THAT reason, not an import error.

- [ ] **Step 3: Write minimal implementation**

In `apps/dashboard/src/lib/provision-dashboard-user.ts`, the create data ends with the F-01 line:

```ts
        // F-01: seed valid default business hours so a fresh org resolves
        // LocalCalendarProvider (not Noop) and the booking loop works out of the box.
        businessHours: DEFAULT_BUSINESS_HOURS,
      },
```

Insert immediately after `businessHours: DEFAULT_BUSINESS_HOURS,` (before the closing `},`):

```ts
        // F-02: comp the pilot org so a freshly provisioned org is entitled and can act
        // out of the box. entitlementOverride is the documented comped-pilot field. Set
        // ONLY by trusted provisioning; launch/pilot-only, unwound at billing-live. See
        // docs/superpowers/specs/2026-06-14-fresh-org-entitlement-design.md
        entitlementOverride: true,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- provision-dashboard-user`
Expected: PASS (F-01 and F-02 describes both green).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/lib/provision-dashboard-user.ts \
  apps/dashboard/src/lib/__tests__/provision-dashboard-user.test.ts
git commit -m "fix(billing): entitle fresh orgs at dashboard provisioning (F-02)"
```

---

### Task 2: Extract the API lazy-create defaults into a documented module

**Files:**

- Create: `apps/api/src/lib/org-config-defaults.ts`
- Test: `apps/api/src/lib/__tests__/org-config-defaults.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/__tests__/org-config-defaults.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { evaluateEntitlement } from "@switchboard/core/billing";
import { DEFAULT_BUSINESS_HOURS } from "@switchboard/schemas";
import { LAZY_ORG_CONFIG_CREATE_DEFAULTS } from "../org-config-defaults.js";

describe("LAZY_ORG_CONFIG_CREATE_DEFAULTS (F-02)", () => {
  it("carries the F-01 business hours and the F-02 comped-pilot override", () => {
    expect(LAZY_ORG_CONFIG_CREATE_DEFAULTS.businessHours).toEqual(DEFAULT_BUSINESS_HOURS);
    expect(LAZY_ORG_CONFIG_CREATE_DEFAULTS.entitlementOverride).toBe(true);
  });

  it("makes a fresh org (default 'none' status) entitled via the override", () => {
    // Seam from the producer-of-record: the defaults source evaluates to entitled.
    expect(
      evaluateEntitlement({
        subscriptionStatus: "none",
        entitlementOverride: LAZY_ORG_CONFIG_CREATE_DEFAULTS.entitlementOverride,
      }),
    ).toEqual({ entitled: true, reason: "override" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/api test -- org-config-defaults`
Expected: FAIL to resolve `../org-config-defaults.js` (module does not exist yet).

- [ ] **Step 3: Create the module**

Create `apps/api/src/lib/org-config-defaults.ts`:

```ts
import { DEFAULT_BUSINESS_HOURS } from "@switchboard/schemas";

/**
 * Default OrganizationConfig fields seeded by the lazy `GET /config` upsert when an
 * already-authenticated org has no config row yet. One documented source so future
 * fresh-org defaults do not pressure the organizations.ts line budget.
 *
 * Safety (F-02): this is reached only after requireOrganizationScope authenticates the
 * caller, and the handler returns 403 unless the URL orgId equals authOrgId, so it can
 * only ever comp the caller's OWN authenticated org. Authentication is minted only by
 * trusted provisioning (provisionDashboardUser creates the API key alongside the config
 * row). See docs/superpowers/specs/2026-06-14-fresh-org-entitlement-design.md.
 *
 * F-02: `entitlementOverride: true` comps the pilot org so a fresh org is entitled out of
 * the box. Launch/pilot only; billing-live must clear or classify these overrides (see
 * the spec's "Required follow-up at billing-live").
 */
export const LAZY_ORG_CONFIG_CREATE_DEFAULTS = {
  name: "",
  runtimeType: "http",
  runtimeConfig: {},
  governanceProfile: "guarded",
  onboardingComplete: false,
  managedChannels: [] as string[],
  provisioningStatus: "pending",
  businessHours: DEFAULT_BUSINESS_HOURS,
  entitlementOverride: true,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/api test -- org-config-defaults`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/org-config-defaults.ts apps/api/src/lib/__tests__/org-config-defaults.test.ts
git commit -m "feat(api): add documented fresh-org config defaults with pilot comp (F-02)"
```

---

### Task 3: Wire the lazy GET /config route to the defaults module

**Files:**

- Modify: `apps/api/src/routes/organizations.ts` (imports + the lazy `upsert` create branch)
- Test: `apps/api/src/__tests__/api-organizations.test.ts:105-140`

- [ ] **Step 1: Write the failing test**

In the existing `it("auto-creates default config when none exists", ...)`, add `entitlementOverride: true` to the `create` objectContaining so it reads:

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

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/api test -- api-organizations`
Expected: FAIL on the `toHaveBeenCalledWith` objectContaining (the route's `create` payload does not yet include `entitlementOverride: true`).

- [ ] **Step 3: Wire the route to the defaults**

In `apps/api/src/routes/organizations.ts`:

a. Remove the now-unused business-hours import (line 11):

```ts
import { DEFAULT_BUSINESS_HOURS } from "@switchboard/schemas";
```

b. Add the defaults import alongside the other route imports (keep import grouping consistent with the file):

```ts
import { LAZY_ORG_CONFIG_CREATE_DEFAULTS } from "../lib/org-config-defaults.js";
```

c. Replace the inline lazy-create object. The current block is:

```ts
const config = await app.prisma.organizationConfig.upsert({
  where: { id: orgId },
  create: {
    id: orgId,
    name: "",
    runtimeType: "http",
    runtimeConfig: {},
    governanceProfile: "guarded",
    onboardingComplete: false,
    managedChannels: [],
    provisioningStatus: "pending",
    businessHours: DEFAULT_BUSINESS_HOURS, // F-01: resolve Local (not Noop) for fresh orgs
  },
  update: {},
});
```

Replace it with:

```ts
const config = await app.prisma.organizationConfig.upsert({
  where: { id: orgId },
  // F-02: comped pilot defaults (entitlementOverride) live in one documented,
  // trusted-path-only source. See ../lib/org-config-defaults.ts.
  create: { id: orgId, ...LAZY_ORG_CONFIG_CREATE_DEFAULTS },
  update: {},
});
```

- [ ] **Step 4: Verify the arch line budget and typecheck**

Run: `wc -l apps/api/src/routes/organizations.ts && pnpm arch:check 2>&1 | tail -5 && pnpm typecheck 2>&1 | tail -5`
Expected: `organizations.ts` is about 588 lines (well under 599); arch:check passes; typecheck clean. If typecheck complains about the spread assignability (for example `managedChannels`), the module already annotates `[] as string[]`; widen other field annotations there, not at the call site.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @switchboard/api test -- api-organizations`
Expected: PASS (existing config tests still green; the create now includes `entitlementOverride: true`).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/organizations.ts apps/api/src/__tests__/api-organizations.test.ts
git commit -m "fix(billing): entitle fresh orgs at lazy config provisioning (F-02)"
```

---

### Task 4: Real enforcement chokepoint regression

**Files:**

- Test: `apps/api/src/middleware/__tests__/billing-guard.integration.test.ts`

This proves the exact tuple a fresh org is provisioned with survives the real resolver and guard. It passes immediately (the gate already entitles `override`); it is a regression pin so a future change to the gate or resolver cannot silently re-block the fresh-org tuple. Tasks 1 to 3 prove the producers WRITE this tuple; this proves the gate ACCEPTS it.

- [ ] **Step 1: Add the regression test**

Add the resolver import after the existing type import block (top of the file):

```ts
import { PrismaBillingEntitlementResolver } from "../../services/billing-entitlement-resolver.js";
```

Add this `it` inside the `describe("billingGuard integration", ...)` block:

```ts
it("allows POST from a freshly provisioned org's real config row through the real resolver (F-02)", async () => {
  // The exact tuple provisioning writes: schema-default "none" status + comped override.
  const fakePrisma = {
    organizationConfig: {
      findUnique: async () => ({ subscriptionStatus: "none", entitlementOverride: true }),
    },
  };
  const resolver = new PrismaBillingEntitlementResolver(fakePrisma as never);
  app = await makeApp(resolver);

  const res = await app.inject({ method: "POST", url: "/api/actions/propose" });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ ok: true });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter @switchboard/api test -- billing-guard.integration`
Expected: PASS (the fresh-org tuple resolves to entitled and the guard allows the mutating POST).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/middleware/__tests__/billing-guard.integration.test.ts
git commit -m "test(billing): pin fresh-org tuple through the real entitlement chokepoint (F-02)"
```

---

### Task 5: Full verification gate, skeptical review, PR

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

- [ ] **Step 2: Skeptical diff review**

Run: `git diff origin/main...HEAD`
Confirm: dashboard inline override; new `org-config-defaults.ts` + test; `organizations.ts` uses the spread and dropped the `DEFAULT_BUSINESS_HOURS` import; api-organizations asserts the override; guard regression added; spec + plan docs. No schema change, no migration, no unrelated edits. The comp appears only at the two trusted producer sites.

- [ ] **Step 3: Adversarial code-review subagent, then push and open PR**

Dispatch an adversarial reviewer, triage its findings skeptically, fix real issues, then:

```bash
git push -u origin fix/fresh-org-entitlement
gh pr create --base main --title "fix(billing): entitle fresh pilot orgs at provisioning (F-02)" --body "<composed at PR time: problem, fix, trusted-path safety, billing-live follow-up, test coverage>"
```

---

## Notes for the implementer

- **No migration.** Schema defaults (`subscriptionStatus="none"`, `entitlementOverride=false`) stay unchanged; the fix is producer-set, which keeps defaults correct for non-provisioning create paths, legacy rows, and the billing-live future.
- **Two trusted producers only.** The comp is set at `provisionDashboardUser` and the auth-scoped lazy `GET /config` (via the defaults module). It is launch/pilot-only and must be unwound at billing-live (spec: "Required follow-up at billing-live").
- **Out of scope (do not fold in):** OAuth `createUser` (`auth.ts`) is not launch-mode gated (F-05). Also F-09, F-20.
- **Conventions:** commit subjects start lowercase; no em-dashes anywhere; `@switchboard/*` imports take no `.js` extension; relative imports in apps/api use `.js`, dashboard relative imports do not.
