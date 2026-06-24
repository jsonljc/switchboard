# D3-1 Booked-Value Resolution Metric Implementation Plan

> **For agentic workers:** ephemeral build-loop scratch (uncommitted). TDD, RED proof per step.

**Goal:** Emit a per-booking-attempt observability metric capturing the booked-value resolution OUTCOME, so the prod match-vs-abstain rate (and WHY it abstains) is visible without a credentialed walkthrough.

**Architecture:** New counter `bookedValueResolution{orgId, outcome}` registered in all 4 metric sites (core interface + in-memory + api prom + chat prom). A new PURE `classifyBookedValue(input)` co-located in `booking-value.ts` returns `{ valueCents, outcome }`; its `valueCents` DELEGATES to the unchanged `resolveBookedValueCents` (single source of truth, never fabricates). The impure async wrapper `resolveBookedValueForBooking` emits `getMetrics().bookedValueResolution.inc({ orgId, outcome })` exactly once per call and adds the two async-level outcomes (`no_lookup`, `read_error`). `calendar-book.ts` (the F12 booking file) is UNTOUCHED — smaller blast radius.

**Outcome taxonomy (6):** `resolved` (matched + real positive price -> value stamped) | `no_playbook` (lookup wired, no/empty services) | `no_match` (playbook present, booked service not in it — the catalog-alignment effectiveness signal) | `matched_unpriced` (matched a service, no usable positive price) | `no_lookup` (no getServicesForOrg dep wired; ~never in prod) | `read_error` (the playbook read threw).

**Tech Stack:** TypeScript (ESM, `.js` relative imports), Vitest, pnpm + Turborepo. Layers schemas -> sdk -> core -> db -> apps.

**Invariants preserved:** `resolveBookedValueCents` byte-for-byte unchanged (pure, no metrics import, public API consumed in packages/db); never-fabricate intact (value single-sourced via delegation); F12 calendar family (locks/IDOR/double-book) untouched (no edit to calendar-book.ts source); bounded label cardinality (orgId + 6 fixed outcomes; the free-text service string is NOT a label).

---

### Task 1: pure `classifyBookedValue` + `BookedValueOutcome` (RED first)

**Files:**

- Modify: `packages/core/src/skill-runtime/tools/booking-value.ts`
- Test: `packages/core/src/skill-runtime/tools/booking-value.test.ts` (extend)

- [ ] **1.1 Write failing tests** — append to `booking-value.test.ts` a `describe("classifyBookedValue")` block:

```ts
describe("classifyBookedValue", () => {
  const services = [
    svc({ id: "botox", name: "Botox", price: 250 }),
    svc({ id: "consult", name: "Consultation" }),
  ];

  it("resolved: matched + priced -> value + outcome:resolved", () => {
    expect(classifyBookedValue({ service: "Botox", services })).toEqual({
      valueCents: 25000,
      outcome: "resolved",
    });
  });
  it("no_playbook: undefined services", () => {
    expect(classifyBookedValue({ service: "x", services: undefined })).toEqual({
      valueCents: null,
      outcome: "no_playbook",
    });
  });
  it("no_playbook: empty services", () => {
    expect(classifyBookedValue({ service: "x", services: [] })).toEqual({
      valueCents: null,
      outcome: "no_playbook",
    });
  });
  it("no_match: playbook present, service not in it (alignment miss)", () => {
    expect(classifyBookedValue({ service: "Dermaplaning", services })).toEqual({
      valueCents: null,
      outcome: "no_match",
    });
  });
  it("matched_unpriced: matched a service with no usable price", () => {
    expect(classifyBookedValue({ service: "Consultation", services })).toEqual({
      valueCents: null,
      outcome: "matched_unpriced",
    });
  });
  it("matched_unpriced: matched but non-finite/non-positive price", () => {
    expect(
      classifyBookedValue({ service: "z", services: [svc({ id: "z", price: Number.NaN })] })
        .outcome,
    ).toBe("matched_unpriced");
    expect(
      classifyBookedValue({ service: "z", services: [svc({ id: "z", price: 0 })] }).outcome,
    ).toBe("matched_unpriced");
  });

  // ALIGNMENT SEAM (divergence guard): outcome === "resolved" iff value is non-null,
  // and value === resolveBookedValueCents for every case (single source of truth).
  it("ALIGNMENT: outcome:resolved iff valueCents non-null, and value tracks the resolver", () => {
    const cases: ResolveBookedValueInput[] = [
      { service: "Botox", services },
      { service: "Consultation", services },
      { service: "Dermaplaning", services },
      { service: "x", services: [] },
      { service: "x", services: undefined },
      { service: "z", services: [svc({ id: "z", price: 0 })] },
    ];
    for (const c of cases) {
      const { valueCents, outcome } = classifyBookedValue(c);
      expect(valueCents).toBe(resolveBookedValueCents(c));
      expect(outcome === "resolved").toBe(valueCents !== null);
    }
  });
});
```

Add to imports: `import { resolveBookedValueCents, classifyBookedValue } from "./booking-value.js";` and `import type { ResolveBookedValueInput } from "./booking-value.js";`

- [ ] **1.2 Run RED** — `pnpm --filter @switchboard/core test -- booking-value`. Expected: FAIL (`classifyBookedValue` not exported). CAPTURE the failing excerpt.

- [ ] **1.3 Implement** in `booking-value.ts` (do NOT touch `resolveBookedValueCents`; add ABOVE the async wrapper, below the pure resolver):

```ts
/**
 * The outcome of a booked-value resolution, for the bookedValueResolution
 * observability metric. `resolved` populated a real positive value; every other
 * outcome ABSTAINS (valueCents null) for a distinct reason. The first four are
 * decided synchronously by classifyBookedValue; `no_lookup` and `read_error` are
 * added by the async wrapper (no services lookup wired / the read threw).
 */
export type BookedValueOutcome =
  | "resolved"
  | "no_playbook"
  | "no_match"
  | "matched_unpriced"
  | "no_lookup"
  | "read_error";

/** The subset of outcomes decided purely from (service, services). */
export type SyncBookedValueOutcome = Exclude<BookedValueOutcome, "no_lookup" | "read_error">;

/**
 * Classify a (service, services) pair into the resolved value PLUS the reason.
 * Pure (no metrics). valueCents DELEGATES to resolveBookedValueCents so the cents
 * are single-sourced and the never-fabricate contract is inherited verbatim; this
 * function only adds an explanatory outcome label for observability. The match
 * predicate mirrors the resolver's exact id/name rule; the alignment test pins
 * outcome === "resolved" <=> valueCents !== null so the two cannot drift in a way
 * that would mislabel a populated value.
 */
export function classifyBookedValue(input: ResolveBookedValueInput): {
  valueCents: number | null;
  outcome: SyncBookedValueOutcome;
} {
  const { service, services } = input;
  const valueCents = resolveBookedValueCents(input);
  if (!services || services.length === 0) return { valueCents, outcome: "no_playbook" };
  const target = normalize(service);
  const matched = services.some((s) => s.id === service || normalize(s.name) === target);
  if (!matched) return { valueCents, outcome: "no_match" };
  return { valueCents, outcome: valueCents === null ? "matched_unpriced" : "resolved" };
}
```

- [ ] **1.4 Run GREEN** — `pnpm --filter @switchboard/core test -- booking-value`. Expected: PASS.
- [ ] **1.5 Commit** — `feat(core): classify booked-value resolution outcome (pure, value delegates to resolver)`

---

### Task 2: register the `bookedValueResolution` counter in all 4 sites

**Files:**

- Modify: `packages/core/src/telemetry/metrics.ts` (interface + createInMemoryMetrics)
- Modify: `apps/api/src/metrics.ts` (PromCounter)
- Modify: `apps/chat/src/bootstrap/metrics.ts` (PromCounter)

- [ ] **2.1** `metrics.ts` interface — after `bookingConsentBlocked: Counter;` (the booking cluster), insert:

```ts
/** D3-1 — booked-value resolution OUTCOME per booking.create attempt. Makes the
 *  prod match-vs-abstain rate observable: outcome in {resolved, no_playbook,
 *  no_match, matched_unpriced, no_lookup, read_error}. Observability-only; the
 *  resolver still abstains (null value) for every non-resolved outcome. Labeled
 *  by orgId + outcome. */
bookedValueResolution: Counter;
```

- [ ] **2.2** `metrics.ts` `createInMemoryMetrics()` — after `bookingConsentBlocked: new InMemoryCounter(),` insert:

```ts
    bookedValueResolution: new InMemoryCounter(),
```

- [ ] **2.3** `apps/api/src/metrics.ts` — after the `bookingConsentBlocked` PromCounter block, before `policyContextSlotEmpty`, insert:

```ts
    bookedValueResolution: new PromCounter(
      "switchboard_booked_value_resolution_total",
      "Booked-value resolution outcome per booking.create attempt; outcome in {resolved, no_playbook, no_match, matched_unpriced, no_lookup, read_error}",
      ["orgId", "outcome"],
    ),
```

- [ ] **2.4** `apps/chat/src/bootstrap/metrics.ts` — SAME insertion as 2.3, same position.

- [ ] **2.5 typecheck** — `pnpm --filter @switchboard/core typecheck` (interface satisfied by in-memory). The api/chat prom impls are type-checked by `pnpm build` at VERIFY; missing a prom site reds the build (type safety net = producer-population enforcement).
- [ ] **2.6 Commit** — `feat(core): register bookedValueResolution metric in all metric registries`

---

### Task 3: wrapper emits the metric (RED via metrics spy)

**Files:**

- Modify: `packages/core/src/skill-runtime/tools/booking-value.ts` (the async wrapper only)
- Test: `packages/core/src/skill-runtime/tools/booking-value.test.ts` (extend)

- [ ] **3.1 Write failing tests** — append a `describe("resolveBookedValueForBooking (metric emission)")` block. Imports to add: `import { setMetrics, createInMemoryMetrics } from "../../telemetry/metrics.js";` and `vi, afterEach` from vitest; and `resolveBookedValueForBooking` to the booking-value import.

```ts
describe("resolveBookedValueForBooking (metric emission)", () => {
  const services = [
    svc({ id: "botox", name: "Botox", price: 250 }),
    svc({ id: "consult", name: "Consultation" }),
  ];
  afterEach(() => setMetrics(createInMemoryMetrics()));

  async function withSpy() {
    const metrics = createInMemoryMetrics();
    const spy = vi.spyOn(metrics.bookedValueResolution, "inc");
    setMetrics(metrics);
    return spy;
  }

  it("resolved: emits {orgId, outcome:resolved} and returns the value", async () => {
    const spy = await withSpy();
    const v = await resolveBookedValueForBooking(async () => services, "Botox", "org_1");
    expect(v).toBe(25000);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ orgId: "org_1", outcome: "resolved" });
  });
  it("no_match: emits outcome:no_match, returns null", async () => {
    const spy = await withSpy();
    expect(
      await resolveBookedValueForBooking(async () => services, "Dermaplaning", "org_1"),
    ).toBeNull();
    expect(spy).toHaveBeenCalledWith({ orgId: "org_1", outcome: "no_match" });
  });
  it("no_playbook: emits outcome:no_playbook for empty services", async () => {
    const spy = await withSpy();
    expect(await resolveBookedValueForBooking(async () => [], "x", "org_1")).toBeNull();
    expect(spy).toHaveBeenCalledWith({ orgId: "org_1", outcome: "no_playbook" });
  });
  it("matched_unpriced: emits outcome:matched_unpriced", async () => {
    const spy = await withSpy();
    expect(
      await resolveBookedValueForBooking(async () => services, "Consultation", "org_1"),
    ).toBeNull();
    expect(spy).toHaveBeenCalledWith({ orgId: "org_1", outcome: "matched_unpriced" });
  });
  it("no_lookup: emits outcome:no_lookup when no getServicesForOrg dep", async () => {
    const spy = await withSpy();
    expect(await resolveBookedValueForBooking(undefined, "x", "org_1")).toBeNull();
    expect(spy).toHaveBeenCalledWith({ orgId: "org_1", outcome: "no_lookup" });
  });
  it("read_error: emits outcome:read_error when the read throws, returns null (booking not blocked)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const spy = await withSpy();
    const v = await resolveBookedValueForBooking(
      async () => {
        throw new Error("db down");
      },
      "x",
      "org_1",
    );
    expect(v).toBeNull();
    expect(spy).toHaveBeenCalledWith({ orgId: "org_1", outcome: "read_error" });
    warn.mockRestore();
  });
});
```

- [ ] **3.2 Run RED** — `pnpm --filter @switchboard/core test -- booking-value`. Expected: FAIL (no `.inc` calls yet / spy not called). CAPTURE excerpt.

- [ ] **3.3 Implement** — rewrite ONLY the async wrapper body (keep signature `Promise<number | null>`); add `import { getMetrics } from "../../telemetry/metrics.js";`:

```ts
export async function resolveBookedValueForBooking(
  getServicesForOrg: GetServicesForOrg | undefined,
  service: string,
  orgId: string,
): Promise<number | null> {
  if (!getServicesForOrg) {
    getMetrics().bookedValueResolution.inc({ orgId, outcome: "no_lookup" });
    return null;
  }
  let services: readonly PlaybookService[] | undefined;
  try {
    services = await getServicesForOrg(orgId);
  } catch (err) {
    console.warn("[calendar-book] playbook value lookup failed; booked value abstains", err);
    getMetrics().bookedValueResolution.inc({ orgId, outcome: "read_error" });
    return null;
  }
  const { valueCents, outcome } = classifyBookedValue({ service, services });
  getMetrics().bookedValueResolution.inc({ orgId, outcome });
  return valueCents;
}
```

- [ ] **3.4 Run GREEN** — `pnpm --filter @switchboard/core test -- booking-value`. Expected: PASS.
- [ ] **3.5 Commit** — `feat(core): emit bookedValueResolution metric from the booking-value wrapper`

---

### Task 4: producer-with-consumer SEAM test through REAL booking.create

**Files:**

- Test: `packages/core/src/skill-runtime/tools/calendar-book.test.ts` (extend the `booking.create booked-value (D3-1)` describe, ~line 607)

- [ ] **4.1 Write the seam tests** — inside the existing describe (PRICED_SERVICES, buildToolWithValueCapture, input, beforeEach already does `setMetrics(createInMemoryMetrics())`). Drive the REAL booking.create and assert the metric increments with the right outcome. Add a metrics spy per test:

```ts
it("SEAM: a matched playbook service emits bookedValueResolution{outcome:resolved} via real booking.create", async () => {
  const metrics = createInMemoryMetrics();
  const spy = vi.spyOn(metrics.bookedValueResolution, "inc");
  setMetrics(metrics);
  const { t } = buildToolWithValueCapture({
    getServicesForOrg: async () => PRICED_SERVICES,
    existingOpp: { id: "opp_1", estimatedValue: 45000 },
  });
  const result = await t.operations["booking.create"]!.execute({ ...input, service: "Botox" });
  expect(result.status).toBe("success");
  expect(spy).toHaveBeenCalledWith({ orgId: "org_trusted", outcome: "resolved" });
});

it("SEAM: a service NOT in the playbook emits bookedValueResolution{outcome:no_match}", async () => {
  const metrics = createInMemoryMetrics();
  const spy = vi.spyOn(metrics.bookedValueResolution, "inc");
  setMetrics(metrics);
  const { t } = buildToolWithValueCapture({
    getServicesForOrg: async () => PRICED_SERVICES, // only "Botox"
    existingOpp: { id: "opp_1", estimatedValue: 45000 },
  });
  const result = await t.operations["booking.create"]!.execute({
    ...input,
    service: "Dermaplaning",
  });
  expect(result.status).toBe("success");
  expect(spy).toHaveBeenCalledWith({ orgId: "org_trusted", outcome: "no_match" });
});
```

(Resolve the exact `existingOpp`/`buildToolWithValueCapture` option names + `input`/`org_trusted` constants by reading lines 607-770 at execution; mirror the existing tests there verbatim.)

- [ ] **4.2 Run** — `pnpm --filter @switchboard/core test -- calendar-book`. Expected: PASS (producer = real booking.create through the real wrapper; consumer = the metric). If the orgId label differs from `org_trusted`, read the harness ctx and correct.
- [ ] **4.3 Commit** — `test(core): lock the booked-value resolution metric at the booking.create seam`

---

### VERIFY (dispatched fresh-context; see build-loop phase 4)

Gates: typecheck; `pnpm test` + `pnpm --filter @switchboard/core test` + `--filter @switchboard/api test` + `--filter @switchboard/chat test` (api/chat touched); lint; format:check; arch:check; `CI=1 npx tsx scripts/local-verify-fast.ts`; `pnpm build` (api+chat touched). NO eval (observability only; does not touch the decision/conversation engine). Security gate `pnpm audit --audit-level=high`. Then a FRESH-CONTEXT independent review (diff + criteria + lessons only), triaged with receiving-code-review. Merge only if zero findings >= warn AND no merge-stop glob touched.

**Merge-stop glob check:** diff touches `booking-value.ts`, `metrics.ts` (x3), 2 test files. None match prisma/auth/billing/consent/credential/governance/send/allowlist. Re-run `git diff origin/main...HEAD --name-only` at CONVERGE to confirm.
