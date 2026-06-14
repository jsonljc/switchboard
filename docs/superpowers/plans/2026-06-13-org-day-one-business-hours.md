# Org Day-One Business Hours Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed a schema-valid default `businessHours` at org provisioning so a freshly provisioned
org resolves `LocalCalendarProvider` (not Noop) and the booking loop works out of the box
(pilot-spine F-01).

**Architecture:** Promote the existing private `DEFAULT_BUSINESS_HOURS` constant into
`packages/schemas` (Layer 1) as the single source of truth, repoint the Google factory at it, and
write it into both org-config CREATE sites (dashboard signup + API lazy config-create). Pin the
producer -> consumer seam with a schema `safeParse` test and a factory resolution test, both driven
from the REAL constant.

**Tech Stack:** TypeScript, Zod (`@switchboard/schemas`), Prisma, Fastify (`apps/api`), Next.js
(`apps/dashboard`), Vitest.

**Conventions:** ESM `.js` extensions on relative imports (NOT on package imports, NOT in
dashboard). No em-dashes anywhere. Commit subjects lowercase. After editing `packages/schemas`,
rebuild it (`pnpm --filter @switchboard/schemas build`) before app typecheck/tests see the new
export.

---

### Task 1: Canonical `DEFAULT_BUSINESS_HOURS` in schemas + seam pin

**Files:**

- Modify: `packages/schemas/src/calendar.ts` (after the `BusinessHoursConfig` type, ~line 83)
- Test: `packages/schemas/src/__tests__/calendar.test.ts`

- [ ] **Step 1: Write the failing test.** Append to `calendar.test.ts` (confirm the existing import
      line pulls from `../calendar.js`; add `DEFAULT_BUSINESS_HOURS` to it):

```ts
describe("DEFAULT_BUSINESS_HOURS", () => {
  it("satisfies BusinessHoursConfigSchema (producer/consumer seam pin)", () => {
    // The calendar provider factory casts the stored businessHours to BusinessHoursConfig
    // WITHOUT validating it, so the seeded default must satisfy the contract the slot
    // generator and LocalCalendarProvider consume. Drive this from the REAL constant.
    expect(BusinessHoursConfigSchema.safeParse(DEFAULT_BUSINESS_HOURS).success).toBe(true);
  });

  it("uses the Asia/Singapore weekday default the pilot wedge expects", () => {
    expect(DEFAULT_BUSINESS_HOURS.timezone).toBe("Asia/Singapore");
    expect(DEFAULT_BUSINESS_HOURS.days.map((d) => d.day)).toEqual([1, 2, 3, 4, 5]);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**
      Run: `pnpm --filter @switchboard/schemas test -- calendar`
      Expected: FAIL (`DEFAULT_BUSINESS_HOURS` is not exported).

- [ ] **Step 3: Add the constant** in `calendar.ts` immediately after the
      `export type BusinessHoursConfig = ...` line:

```ts
/**
 * Canonical default business hours seeded into OrganizationConfig at org provisioning so a fresh
 * org resolves LocalCalendarProvider (not Noop) and the booking loop works with no operator action
 * and no external calendar credentials. Asia/Singapore matches the SG/MY pilot wedge and the
 * BookingSchema timezone default; Mon-Fri 09:00-18:00. Operators can refine hours later. This is the
 * single source of truth, also consumed by the Google calendar factory's fallback default.
 */
export const DEFAULT_BUSINESS_HOURS: BusinessHoursConfig = {
  timezone: "Asia/Singapore",
  days: [
    { day: 1, open: "09:00", close: "18:00" },
    { day: 2, open: "09:00", close: "18:00" },
    { day: 3, open: "09:00", close: "18:00" },
    { day: 4, open: "09:00", close: "18:00" },
    { day: 5, open: "09:00", close: "18:00" },
  ],
  defaultDurationMinutes: 30,
  bufferMinutes: 15,
  slotIncrementMinutes: 30,
};
```

- [ ] **Step 4: Run the test, verify it passes.**
      Run: `pnpm --filter @switchboard/schemas test -- calendar`
      Expected: PASS.

- [ ] **Step 5: Rebuild schemas so the apps can import the new export.**
      Run: `pnpm --filter @switchboard/schemas build`
      Expected: build success.

- [ ] **Step 6: Commit.**

```bash
git add packages/schemas/src/calendar.ts packages/schemas/src/__tests__/calendar.test.ts
git commit -m "feat(schemas): add canonical DEFAULT_BUSINESS_HOURS constant"
```

---

### Task 2: Repoint the Google calendar factory at the shared constant

**Files:**

- Modify: `apps/api/src/bootstrap/google-calendar-factory.ts:1,9-21,42`
- Test (regression): `apps/api/src/bootstrap/__tests__/google-calendar-factory.test.ts`

- [ ] **Step 1: Replace the private constant with the import.** Change the top import (currently
      `import type { CalendarProvider, BusinessHoursConfig } from "@switchboard/schemas";`) to also value-
      import the constant, and DELETE the local `const DEFAULT_BUSINESS_HOURS = {...}` block (lines 9-21):

```ts
import type { CalendarProvider, BusinessHoursConfig } from "@switchboard/schemas";
import { DEFAULT_BUSINESS_HOURS } from "@switchboard/schemas";
import { GoogleCalendarAdapter } from "@switchboard/core/calendar";
```

Leave `businessHours: opts.businessHours ?? DEFAULT_BUSINESS_HOURS` (line 42) unchanged.

- [ ] **Step 2: Run the existing factory test, verify it stays green** (this is the regression guard
      on the consolidation; behavior is identical).
      Run: `pnpm --filter @switchboard/api test -- google-calendar-factory`
      Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add apps/api/src/bootstrap/google-calendar-factory.ts
git commit -m "refactor(api): source google calendar default from shared constant"
```

---

### Task 3: Seed the default in the API lazy config-create + factory seam test

**Files:**

- Modify: `apps/api/src/routes/organizations.ts:4-10` (imports), `:67-76` (GET /config create branch)
- Modify: `apps/api/src/bootstrap/__tests__/calendar-provider-factory.test.ts` (seam test)
- Test: `apps/api/src/__tests__/api-organizations.test.ts` (config auto-create assertion)

- [ ] **Step 1: Write the failing factory seam test.** Append to
      `calendar-provider-factory.test.ts` (add the schemas import at the top of the file):

```ts
import { DEFAULT_BUSINESS_HOURS } from "@switchboard/schemas";

describe("createCalendarProviderFactory: provisioning default resolves Local", () => {
  it("resolves LocalCalendarProvider (not Noop) for a fresh org seeded with DEFAULT_BUSINESS_HOURS", async () => {
    const prisma = makePrisma({ "org-fresh": { businessHours: DEFAULT_BUSINESS_HOURS } });
    const factory = createCalendarProviderFactory({
      prismaClient: prisma as never,
      logger: silentLogger,
      env: {}, // no Google creds: the only way to leave Noop is the seeded business hours
    });

    const provider = await factory("org-fresh");

    expect(isNoopCalendarProvider(provider)).toBe(false);
  });
});
```

- [ ] **Step 2: Write the failing config-create assertion.** In `api-organizations.test.ts`, find
      the GET `/config` auto-create test (the one asserting `organizationConfig.upsert` is called) and
      add to its `create` expectation that `businessHours` equals the default. Add the import
      `import { DEFAULT_BUSINESS_HOURS } from "@switchboard/schemas";` and assert, e.g.:

```ts
expect(mockPrisma.organizationConfig.upsert).toHaveBeenCalledWith(
  expect.objectContaining({
    create: expect.objectContaining({ businessHours: DEFAULT_BUSINESS_HOURS }),
  }),
);
```

- [ ] **Step 3: Run both, verify they fail.**
      Run: `pnpm --filter @switchboard/api test -- calendar-provider-factory api-organizations`
      Expected: the seam test PASSES already (it drives the factory directly with the default, which is
      the consumer behavior we are pinning); the api-organizations assertion FAILS (create branch omits
      `businessHours`). If the seam test somehow fails, stop and investigate before proceeding.

- [ ] **Step 4: Add the producer.** In `organizations.ts`, add the import and set the field in the
      GET `/config` upsert `create` branch (after `provisioningStatus: "pending",`):

```ts
import { DEFAULT_BUSINESS_HOURS } from "@switchboard/schemas";
// ...
        create: {
          id: orgId,
          name: "",
          runtimeType: "http",
          runtimeConfig: {},
          governanceProfile: "guarded",
          onboardingComplete: false,
          managedChannels: [],
          provisioningStatus: "pending",
          businessHours: DEFAULT_BUSINESS_HOURS,
        },
```

- [ ] **Step 5: Run the tests, verify they pass.**
      Run: `pnpm --filter @switchboard/api test -- calendar-provider-factory api-organizations`
      Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/api/src/routes/organizations.ts \
  apps/api/src/bootstrap/__tests__/calendar-provider-factory.test.ts \
  apps/api/src/__tests__/api-organizations.test.ts
git commit -m "fix(api): seed default business hours on lazy org config create"
```

---

### Task 4: Seed the default in the dashboard self-serve signup path

**Files:**

- Modify: `apps/dashboard/src/lib/provision-dashboard-user.ts:3-4,25-34`
- Test: `apps/dashboard/src/lib/__tests__/provision-dashboard-user.test.ts` (new)

- [ ] **Step 1: Write the failing test.** Create the new test file. Mock `prisma.$transaction` to
      run its callback against a `tx` of spies, give the mock prisma `orgAgentEnablement.upsert` so the
      real `seedOrgDayOneAgents` post-commit call is a no-op, and set `CREDENTIALS_ENCRYPTION_KEY`
      (mirror `crypto.test.ts`) so the in-transaction `encryptApiKey` works (or `vi.mock("../crypto")`
      if the key setup is awkward; pick whichever matches the existing dashboard test idiom):

```ts
import { describe, it, expect, vi, beforeAll } from "vitest";
import { DEFAULT_BUSINESS_HOURS } from "@switchboard/schemas";
import { provisionDashboardUser } from "../provision-dashboard-user";

beforeAll(() => {
  // encryptApiKey (called inside the provisioning transaction) needs a valid key.
  process.env.CREDENTIALS_ENCRYPTION_KEY ||= "0".repeat(64);
});

function makeTxPrisma() {
  const tx = {
    organizationConfig: { create: vi.fn(async () => ({})) },
    principal: { create: vi.fn(async () => ({})) },
    identitySpec: { create: vi.fn(async () => ({})) },
    dashboardUser: { create: vi.fn(async () => ({ id: "du_1" })) },
  };
  const prisma = {
    $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    orgAgentEnablement: { upsert: vi.fn(async () => ({})) },
  };
  return { prisma, tx };
}

describe("provisionDashboardUser business hours seeding (F-01)", () => {
  it("creates the org config with the default business hours so a fresh org books out of the box", async () => {
    const { prisma, tx } = makeTxPrisma();

    await provisionDashboardUser(prisma as never, { email: "owner@clinic.test" });

    const createArg = (tx.organizationConfig.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(createArg.data.businessHours).toEqual(DEFAULT_BUSINESS_HOURS);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**
      Run: `pnpm --filter @switchboard/dashboard test -- provision-dashboard-user`
      Expected: FAIL (`businessHours` is undefined on the create data). If it fails on the crypto key or
      module resolution instead, fix the harness first (read `crypto.test.ts` for the key idiom), then
      re-run until it fails for the RIGHT reason (missing `businessHours`).

- [ ] **Step 3: Add the producer.** In `provision-dashboard-user.ts` add the import and the field:

```ts
import { seedOrgDayOneAgents } from "@switchboard/db";
import { DEFAULT_BUSINESS_HOURS } from "@switchboard/schemas";
// ...
await tx.organizationConfig.create({
  data: {
    id: orgId,
    name: displayName,
    runtimeType: "managed",
    governanceProfile: "guarded",
    onboardingComplete: false,
    provisioningStatus: "pending",
    businessHours: DEFAULT_BUSINESS_HOURS,
  },
});
```

- [ ] **Step 4: Run the test, verify it passes.**
      Run: `pnpm --filter @switchboard/dashboard test -- provision-dashboard-user`
      Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/src/lib/provision-dashboard-user.ts \
  apps/dashboard/src/lib/__tests__/provision-dashboard-user.test.ts
git commit -m "fix(dashboard): seed default business hours at self-serve signup"
```

---

### Task 5: Full verification gate

- [ ] **Step 1: Typecheck the whole repo.**
      Run: `pnpm typecheck`
      Expected: PASS. If it reports missing `DEFAULT_BUSINESS_HOURS` from `@switchboard/schemas`, run
      `pnpm reset` (stale Layer-1 dist) then re-run.

- [ ] **Step 2: Run the touched package suites.**
      Run: `pnpm --filter @switchboard/schemas test` then `pnpm --filter @switchboard/api test` then
      `pnpm --filter @switchboard/dashboard test`
      Expected: PASS (db-integrity files may fail locally only because Postgres is down; that is the
      environmental baseline, not a regression).

- [ ] **Step 3: Dashboard production build (the only thing that catches dashboard import gaps).**
      Run: `pnpm --filter @switchboard/dashboard build`
      Expected: build success.

- [ ] **Step 4: Whole-repo build, lint, format.**
      Run: `pnpm build` then `pnpm lint` then `pnpm format:check`
      Expected: all PASS. Run `pnpm format:write` (or prettier on the touched files) if format:check
      flags anything, then re-commit.

- [ ] **Step 5: Commit any format fixups, then proceed to code review.**

```bash
git add -A && git commit -m "chore: formatting" --no-verify || echo "nothing to format"
```

---

## Self-review (against the spec)

- Spec goal "fresh org resolves Local not Noop" -> Task 3 seam test + Task 1 pin. Covered.
- Spec "seed at both create sites" -> Task 3 (API) + Task 4 (dashboard). Covered.
- Spec "consolidate existing default into schemas, repoint google factory" -> Task 1 + Task 2.
  Covered.
- Spec "producer-population in same PR (not inert)" -> producers in Task 3/4 ship with the tests.
  Covered.
- Spec "no migration / idempotent" -> no schema change; writes only in create branches. Covered.
- Type consistency: `DEFAULT_BUSINESS_HOURS: BusinessHoursConfig` defined in Task 1, imported by
  Tasks 2/3/4 with the same name. Consistent.
- Out-of-scope items (settings route, backfill, F-02/F-16) have no tasks, as intended.
