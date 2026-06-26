# Alex MY-market readiness (P2-B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a real Malaysia (MY) medspa clinic sellable end-to-end through Alex: correct currency at every money surface, per-lead PDPA jurisdiction from the `+60` phone, captured org market, MY persona, and MYR dashboard display.

**Architecture:** Currency is a pure derivation of the org's market (`currencyForJurisdiction(jurisdiction)`), resolved per-request through the existing `governanceConfigResolver` so money and governance gates read one source of truth. The org market lives only in `governanceConfig.jurisdiction` (captured via a new `governance.set_market` operator-mutation; no new columns). Per-lead jurisdiction routes through one `resolveContactJurisdiction` chokepoint. Spec: `docs/superpowers/specs/2026-06-26-alex-my-market-design.md`.

**Tech Stack:** TypeScript monorepo (pnpm + Turbo), Zod schemas (L1), core skill-runtime (L3), Prisma/db (L4), Fastify api + Next dashboard (L5), vitest.

## Global Constraints

- ESM only; `.js` extensions in relative imports (except Next.js). No `any` (use `unknown`). No `console.log` (use `console.warn`/`console.error`).
- Prettier: semi, double quotes, 2-space, trailing commas, 100 char width. Conventional Commits.
- Layer rule: schemas imports no `@switchboard/*`; core imports schemas+sdk (NOT db); db imports schemas+core. Money tools live in core and take INJECTED resolvers (core never reads the DB directly).
- Pre-commit runs eslint+prettier ONLY. Before each commit run `pnpm --filter <pkg> exec tsc --noEmit` for every touched package. In a fresh Postgres-down worktree run `pnpm install` + `pnpm db:generate` + `pnpm build` once first. Rebuild a lower package's `dist` after editing it before typechecking a consumer.
- Currency values are the literal strings `"SGD"` and `"MYR"` (ISO-4217). Jurisdiction enum is `"SG" | "MY"`. clinicType enum is `"medical" | "nonMedical"`.
- Money safety invariant: a deployment whose currency cannot be resolved must NEVER produce a charge. Prove fail-closed with a test that asserts the payment port is not called.
- Gate merges on real `gh pr checks` conclusions; "Eval - Claim Classifier" is non-required and persistently red (billing) — do not chase it.

---

## Slice / PR map (decomposition)

1. **Currency derivation boundary** (schemas + core + api) — the safety-critical core. DETAILED BELOW; execute first.
2. **Org market capture + governanceConfig update path** (schemas + db + api + dashboard).
3. **Per-lead PDPA jurisdiction from `+60`** (core; possibly schemas helper).
4. **Alex MY persona + quoted-currency consistency** (skills + core builder).
5. **Dashboard MYR display + revenue-recording currency verify** (dashboard + core).

Each slice is its own branch + PR off `origin/main`, fresh worktree, fresh-context review, CI-green before merge.

---

# Slice 1: Currency derivation boundary

**Branch:** `feat/alex-my-currency-boundary`

**Outcome:** The deposit charge and the booked-value stamp derive their currency per-request from the org's `governanceConfig.jurisdiction` via one shared resolver, fail-closed (no charge when unresolvable). Behaviour for every existing SG org is unchanged (SG -> SGD).

### Task 1.1: `currencyForJurisdiction` primitive (schemas)

**Files:**

- Modify: `packages/schemas/src/governance-config.ts` (add the function + `SupportedCurrency` type near `ObserveGovernanceConfigInput`)
- Test: `packages/schemas/src/__tests__/currency-for-jurisdiction.test.ts` (new; match existing schemas test dir convention — verify whether tests are co-located `*.test.ts` or under `__tests__/` and follow it)
- Export: `packages/schemas/src/index.ts` (add re-export if the barrel does not use `export *` for governance-config)

**Interfaces:**

- Produces: `type SupportedCurrency = "SGD" | "MYR"` and `function currencyForJurisdiction(jurisdiction: "SG" | "MY"): SupportedCurrency`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { currencyForJurisdiction } from "../governance-config.js";

describe("currencyForJurisdiction", () => {
  it("maps SG to SGD", () => {
    expect(currencyForJurisdiction("SG")).toBe("SGD");
  });
  it("maps MY to MYR", () => {
    expect(currencyForJurisdiction("MY")).toBe("MYR");
  });
});
```

- [ ] **Step 2: Run test, verify it fails** — `pnpm --filter @switchboard/schemas test currency-for-jurisdiction` → FAIL (not exported).

- [ ] **Step 3: Implement (total, no default branch — exhaustiveness enforced)**

```ts
export type SupportedCurrency = "SGD" | "MYR";

/**
 * The clinic's settlement currency, derived from its single market. 1:1 by
 * product definition (SG->SGD, MY->MYR). Total over the jurisdiction enum with
 * NO default branch: adding a jurisdiction without a currency is a compile error,
 * so a new market can never silently charge the wrong currency.
 */
export function currencyForJurisdiction(jurisdiction: "SG" | "MY"): SupportedCurrency {
  switch (jurisdiction) {
    case "SG":
      return "SGD";
    case "MY":
      return "MYR";
  }
}
```

- [ ] **Step 4: Run test, verify it passes.** Confirm the barrel re-exports it: check `packages/schemas/src/index.ts` exports `currencyForJurisdiction` + `SupportedCurrency` (add an explicit line if the barrel cherry-picks).

- [ ] **Step 5: `pnpm --filter @switchboard/schemas exec tsc --noEmit`; then commit.**

```bash
git add packages/schemas/src/governance-config.ts packages/schemas/src/__tests__/currency-for-jurisdiction.test.ts packages/schemas/src/index.ts
git commit -m "feat(schemas): add currencyForJurisdiction(jurisdiction) primitive"
```

### Task 1.2: deposit-link resolves currency per-request, fail-closed (core)

**Files:**

- Modify: `packages/core/src/skill-runtime/tools/deposit-link.ts` (replace `defaultCurrency: string` dep with a resolver; resolve at execute via `ctx.deploymentId`; fail-closed)
- Test: `packages/core/src/skill-runtime/tools/deposit-link.test.ts` (extend)

**Interfaces:**

- Consumes: `SupportedCurrency`, `currencyForJurisdiction` (Task 1.1)
- Produces: `DepositLinkToolDeps.resolveCurrency: (deploymentId: string) => Promise<SupportedCurrency | null>` (replaces `defaultCurrency`)

- [ ] **Step 1: Write failing tests** (rebuild schemas dist first if needed: `pnpm --filter @switchboard/schemas build`):

```ts
// MY deployment charges MYR
it("charges in the currency derived from the deployment jurisdiction (MY -> MYR)", async () => {
  const createDepositLink = vi.fn(async () => ({
    url: "u",
    externalReference: "r",
    amountCents: 5000,
  }));
  const port = { createDepositLink } as unknown as PaymentPort;
  const factory = createDepositLinkToolFactory({
    paymentPortFactory: async () => port,
    findById: async () => ({ id: "b1", organizationId: "org1", status: "confirmed" }),
    depositAmountCents: 5000,
    resolveCurrency: async () => "MYR",
  });
  const tool = factory({
    orgId: "org1",
    deploymentId: "dep1",
    sessionId: "s",
  } as SkillRequestContext);
  const res = await tool.operations["deposit.issue"].execute({ bookingId: "b1" });
  expect(res.ok).toBe(true);
  expect(createDepositLink).toHaveBeenCalledWith(expect.objectContaining({ currency: "MYR" }));
});

// fail-closed: currency unresolvable -> NO port call, fail result
it("fails closed and does not call the payment port when currency cannot be resolved", async () => {
  const createDepositLink = vi.fn();
  const port = { createDepositLink } as unknown as PaymentPort;
  const factory = createDepositLinkToolFactory({
    paymentPortFactory: async () => port,
    findById: async () => ({ id: "b1", organizationId: "org1", status: "confirmed" }),
    depositAmountCents: 5000,
    resolveCurrency: async () => null,
  });
  const tool = factory({
    orgId: "org1",
    deploymentId: "dep1",
    sessionId: "s",
  } as SkillRequestContext);
  const res = await tool.operations["deposit.issue"].execute({ bookingId: "b1" });
  expect(res.ok).toBe(false);
  expect(res.error?.code).toBe("CURRENCY_UNRESOLVED");
  expect(createDepositLink).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run, verify fail** (deps shape mismatch / behaviour).

- [ ] **Step 3: Implement.** Change `DepositLinkToolDeps`: remove `defaultCurrency: string`, add `resolveCurrency: (deploymentId: string) => Promise<SupportedCurrency | null>`. In `execute`, after the `confirmed` check and BEFORE `paymentPortFactory`:

```ts
const currency = await deps.resolveCurrency(ctx.deploymentId);
if (!currency) {
  return fail(
    "CURRENCY_UNRESOLVED",
    "The clinic's billing currency is not configured; a deposit cannot be issued.",
    {
      retryable: false,
      modelRemediation:
        "Do not ask the customer to pay. Hand off so an operator can finish billing setup.",
    },
  );
}
const port = await deps.paymentPortFactory(orgId);
const link = await port.createDepositLink({
  bookingId,
  organizationId: orgId,
  amountCents: deps.depositAmountCents,
  currency,
});
```

- [ ] **Step 4: Run tests, verify pass.**

- [ ] **Step 5: `pnpm --filter @switchboard/core exec tsc --noEmit`; commit.**

```bash
git commit -am "feat(core): deposit-link resolves currency per-deployment, fail-closed"
```

### Task 1.3: calendar-book resolves currency per-request, abstains (core)

**Files:**

- Modify: `packages/core/src/skill-runtime/tools/calendar-book.ts` (replace `defaultCurrency: string` dep at line 138 with the resolver; resolve once per execute; use at lines ~466/530; null -> stamp currency null)
- Test: `packages/core/src/skill-runtime/tools/calendar-book.test.ts` (extend)

**Interfaces:**

- Consumes: `SupportedCurrency`, `currencyForJurisdiction`
- Produces: `CalendarBookToolDeps.resolveCurrency: (deploymentId: string) => Promise<SupportedCurrency | null>` (replaces `defaultCurrency`)

- [ ] **Step 1: Write failing tests** — MY deployment stamps `currency:"MYR"` on the ReceiptedBooking/receipt write; unresolvable -> currency null AND booking still created (mirror the existing value-abstain assertions in this file).

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement.** Replace the `defaultCurrency` dep with `resolveCurrency`. At the top of the durable write path, resolve `const currency = await deps.resolveCurrency(ctx.deploymentId);` and substitute `deps.defaultCurrency` -> `currency` at both stamp sites. A null currency stamps `currency: null` (do NOT block the booking).

- [ ] **Step 4: Run tests, verify pass.**

- [ ] **Step 5: `pnpm --filter @switchboard/core exec tsc --noEmit`; commit.**

```bash
git commit -am "feat(core): calendar-book stamps currency per-deployment, abstains when unresolvable"
```

### Task 1.4: wire `resolveCurrency` from the existing resolver (api)

**Files:**

- Modify: `apps/api/src/bootstrap/deposit-link-wiring.ts` (drop `PILOT_DEPOSIT_CURRENCY` + `defaultCurrency`; add `resolveCurrency` to `DepositLinkWiringDeps`; pass through)
- Modify: `apps/api/src/bootstrap/skill-mode.ts` (build one `resolveCurrency` from `governanceConfigResolver`; inject into both the calendar-book factory at ~line 438 and the deposit-link factory at ~line 461)
- Test: `apps/api/src/bootstrap/__tests__/resolve-currency.test.ts` (new) for the resolver mapping; extend deposit-link-wiring test if present.

**Interfaces:**

- Consumes: `governanceConfigResolver` (`skill-mode.ts:186`), `currencyForJurisdiction`
- Produces: `resolveCurrency: (deploymentId: string) => Promise<SupportedCurrency | null>` wired to both factories

- [ ] **Step 1: Write failing test** for the resolver builder:

```ts
// resolved -> currency; missing/error -> null
it("derives currency from a resolved config and returns null otherwise", async () => {
  const make = (res) => buildResolveCurrency(async () => res);
  expect(await make({ status: "resolved", config: { jurisdiction: "MY" } })("d")).toBe("MYR");
  expect(await make({ status: "resolved", config: { jurisdiction: "SG" } })("d")).toBe("SGD");
  expect(await make({ status: "missing" })("d")).toBeNull();
  expect(await make({ status: "error", error: new Error("x") })("d")).toBeNull();
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** a small exported `buildResolveCurrency(resolver: GovernanceConfigResolver)` helper (in `skill-mode.ts` or a sibling `resolve-currency.ts`):

```ts
export function buildResolveCurrency(resolver: GovernanceConfigResolver) {
  return async (deploymentId: string): Promise<SupportedCurrency | null> => {
    const r = await resolver(deploymentId);
    return r.status === "resolved" ? currencyForJurisdiction(r.config.jurisdiction) : null;
  };
}
```

Wire `const resolveCurrency = buildResolveCurrency(governanceConfigResolver);` and inject into the calendar-book deps (replace `defaultCurrency: "SGD"`) and `buildDepositLinkToolFactory` (replace the removed default). Delete `PILOT_DEPOSIT_CURRENCY`.

- [ ] **Step 4: Run tests.** Then build the lower packages so apps/api typechecks against fresh dist: `pnpm --filter @switchboard/schemas build && pnpm --filter @switchboard/core build`, then `pnpm --filter @switchboard/api exec tsc --noEmit`.

- [ ] **Step 5: Commit.**

```bash
git commit -am "feat(api): wire per-deployment currency resolver into money tools; retire SGD hardcode"
```

### Task 1.5: full verification + PR

- [ ] Run `pnpm --filter @switchboard/schemas test && pnpm --filter @switchboard/core test && pnpm --filter @switchboard/api test`.
- [ ] Run `pnpm test` (full) if the worktree has Postgres; otherwise the per-package runs above plus `pnpm typecheck`.
- [ ] Confirm no remaining `"SGD"` literal in the deposit/calendar money path: `grep -rn '"SGD"' apps/api/src/bootstrap packages/core/src/skill-runtime/tools` should show only test fixtures / unrelated sites.
- [ ] Push, open PR, gate on `gh pr checks` (required green; ignore non-required "Eval - Claim Classifier").

**Acceptance:** MY deployment charges MYR + stamps MYR; SG unchanged; unresolvable config -> no charge (port not called), booking still records (currency null). No migration.

---

# Slice 2: Org market capture + governanceConfig update path

**Branch:** `feat/alex-my-market-capture`

**Files:**

- Create: `packages/schemas/src/set-market-in-config.ts` + test — pure `setMarketInConfig(config, { jurisdiction, clinicType })`, sub-block/sibling-preserving spread (mirror `set-gate-mode-in-config.ts:14-27`).
- Create: `packages/db/src/stores/prisma-governance-market-writer.ts` + test — `PrismaGovernanceMarketWriter` with SELECT...FOR UPDATE, org-scoped (mirror `prisma-governance-gate-mode-writer.ts:46-72`; db tests mock Prisma).
- Create: `apps/api/src/bootstrap/operator-intents/governance-set-market.ts` + test — `governance.set_market` intent, `system_auto_approved`, NO readiness probe (mirror `governance-set-gate-mode.ts`). Register in all required intent locations.
- Modify dashboard: a market control (jurisdiction SG|MY, clinicType medical|nonMedical) at onboarding and/or `/settings/governance`; proxy route; `use-...` hook (mirror `use-governance-gates`).

**Interfaces:**

- Produces: `setMarketInConfig(config: GovernanceConfig, market: { jurisdiction: "SG"|"MY"; clinicType: "medical"|"nonMedical" }): GovernanceConfig`; intent params `{ deploymentId, jurisdiction, clinicType }`.

**Tests / acceptance:** writer preserves every gate-mode sub-block and other top-level keys; lost-update safe (concurrent writes serialize via FOR UPDATE); org-scoped (cannot write another org's deployment); intent updates jurisdiction/clinicType end-to-end; UI flips an org to MY and currency (Slice 1) then resolves MYR.

**Gotchas:** new env var -> env-allowlist; mutating route goes through PlatformIngress.submit (operator-mutation) so no route-allowlist; new metrics counter (if any) -> all 3 registries; do NOT readiness-gate market (it is a declaration, not a producer-gated capability — unlike the enforce flip). Do NOT change the dual seeders' SG/medical default.

---

# Slice 3: Per-lead PDPA jurisdiction from `+60`

**Branch:** `feat/alex-per-lead-jurisdiction`

**Files:**

- Create: `resolveContactJurisdiction` helper + test (core, e.g. `packages/core/src/consent/resolve-contact-jurisdiction.ts`): `(contact: { pdpaJurisdiction?: string|null; phoneE164?: string|null }, orgDefault: "SG"|"MY") => "SG"|"MY"` = `contact.pdpaJurisdiction ?? jurisdictionFromE164(contact.phoneE164) ?? orgDefault`.
- Modify the consent-data sites to route jurisdiction through the helper instead of `config.jurisdiction`: `pdpa-consent-gate.ts`, `consent-enforcement-gate.ts`, `consent-revocation-gate.ts`, and the first-touch template selection (`whatsapp-window-gate.ts` / `proactive-eligibility`). Leave output-claim gates (banned-phrase/claim/price) reading `config.jurisdiction` unchanged.

**Interfaces:**

- Consumes: `jurisdictionFromE164` (`packages/schemas/src/phone.ts:76`)
- Produces: `resolveContactJurisdiction(contact, orgDefault)`

**Tests / acceptance:** `+60` contact at an SG-default org resolves MY for the PDPA path; a stamped `pdpaJurisdiction` takes precedence over the phone; null phone + null stamp falls back to org; applied consistently so no spurious `ConsentJurisdictionMismatch`. Verify the consent gate passes the per-lead value into `ConsentService.ensureJurisdictionStamped`.

**Gotchas:** stamping is immutable + throws on mismatch — the helper must be the SINGLE source so the same contact always resolves the same jurisdiction. Confirm the contact's `phoneE164` is available at each gate (it is on the contact record fetched by orgId+contactId).

---

# Slice 4: Alex MY persona + quoted-currency consistency

**Branch:** `feat/alex-my-persona`

**Files:**

- Modify `skills/alex/SKILL.md`: factor the "Local Tone (Singapore English)" block (122-129) into a jurisdiction-selected slot; add a Malaysian-English tone variant; change "Price in SGD" to currency-neutral.
- Modify `packages/core/src/skill-runtime/builders/alex.ts`: select the tone block by org jurisdiction; make `FALLBACK_TZ` jurisdiction-aware (`Asia/Kuala_Lumpur` for MY, `Asia/Singapore` for SG); inject the org-derived currency (`currencyForJurisdiction`) so quotes match the deposit.
- Modify `context-resolver.ts:45`: render service prices in the org currency rather than the per-service `svc.currency` field (stop reading the drift-prone field authoritatively).

**Tests / acceptance:** an MY deployment's assembled prompt contains the MY tone block, `Asia/Kuala_Lumpur` fallback, and MYR-quoted prices; SG unchanged. Builder unit tests assert the jurisdiction branch (the eval harness is mock-tool-blind, so cover via unit tests).

---

# Slice 5: Dashboard MYR display + revenue-recording currency verify

**Branch:** `feat/alex-my-dashboard-currency`

**Files:**

- Modify `apps/dashboard/src/lib/money.tsx`: `formatMoney(value, currency: SupportedCurrency = "SGD")` — symbol/locale by currency (RM/`en-MY` for MYR, S$/`en-SG` for SGD); update the `<Money>` component to accept currency.
- Thread currency into payloads that are currency-blind: `home-summary.ts:67` (derive from jurisdiction instead of hardcoded `"SGD"`), opportunities, decision risk. Update the matching dashboard call sites to pass currency through.
- Verify revenue recording: confirm `payment.record_verified` uses Stripe's authoritative currency (already returned by `retrievePayment`); make the `RecordRevenueInputSchema` default derive from jurisdiction where currency is omitted, or document why the Stripe value suffices.

**Tests / acceptance:** `formatMoney(1234, "MYR")` renders RM; home-summary for an MY org emits MYR and the KPI strip shows RM; revenue events already carrying currency render it. No payload silently assumes SGD.

---

## Self-review notes

- Spec coverage: every row of the spec's money-surface inventory (section 4) maps to a slice above. Currency primitive + deposit + booked value = Slice 1; capture/update = Slice 2; per-lead = Slice 3; quote/persona = Slice 4; display + revenue = Slice 5.
- Type consistency: `SupportedCurrency`, `currencyForJurisdiction`, and `resolveCurrency: (deploymentId) => Promise<SupportedCurrency | null>` are used identically across Tasks 1.1-1.4; `resolveContactJurisdiction` and `setMarketInConfig` signatures are fixed in Slices 3/2.
- No migration in Slice 1 (currency columns exist; new function is pure). Slice 2 adds no columns (single source = governanceConfig). Confirm with `pnpm db:check-drift` if any Prisma file is touched.
