# Alex MY-market readiness (P2-B): per-org currency + per-lead jurisdiction

**Date:** 2026-06-26
**Status:** Design (approved by the activation owner; derive-currency-from-jurisdiction, two jurisdiction scopes)
**Branch:** `docs/alex-my-market` (this doc) -> implementation branches consume it from `main`

## 1. Problem

Alex (the medspa SDR) is sellable end-to-end only in Singapore. A real Malaysian
clinic cannot be onboarded safely today:

- The deposit charge and the booked-value stamp are hardcoded SGD
  (`apps/api/src/bootstrap/deposit-link-wiring.ts:17` `PILOT_DEPOSIT_CURRENCY = "SGD"`,
  `apps/api/src/bootstrap/skill-mode.ts:438` `defaultCurrency: "SGD"`). A MY clinic
  would quote MYR but collect SGD, or vice versa. This is a financial-correctness
  defect, not a cosmetic one.
- The org's market (jurisdiction `SG|MY`, clinicType) is never captured at
  onboarding. `OrganizationConfig` stores no jurisdiction column, and the seed
  derivation `deriveAlexGovernanceSeedContext` reads `OrganizationConfig.businessHours`,
  which is never written, so it always returns `SG/medical`
  (`apps/api/src/lib/alex-governance-seed-context.ts:13`). Every real org's gates and
  telemetry are mislabelled SG regardless of the actual market.
- A lead's PDPA jurisdiction is stamped from the org default rather than the lead's
  own `+60`/`+65` phone, so a Malaysian data subject can be tagged under the wrong
  data-protection regime.
- The persona prescribes Singapore-English tone and an `Asia/Singapore` timezone
  fallback (`skills/alex/SKILL.md:122-129`, `packages/core/src/skill-runtime/builders/alex.ts:131`).
- The dashboard hardcodes `S$` (`apps/dashboard/src/lib/money.tsx`).

The good news, verified against `main` (`c08896737`): the hard machinery already
exists. `jurisdictionFromE164` maps `+65->SG`, `+60->MY`
(`packages/schemas/src/phone.ts:76`). The MY banned-phrase ruleset is real, not a
stub (`packages/core/src/governance/banned-phrases/my.ts`). `Contact.pdpaJurisdiction`
is a first-class, indexed, immutable-after-stamp column consumed across receipts,
consent, and proactive eligibility. `ReceiptedBooking.currency` and `Receipt.currency`
are nullable columns (no migration to store per-transaction currency). The MY handoff
grammar and the SG/MY qualification sidecar already exist. What is missing is the
_wiring_: deriving currency and per-lead jurisdiction from values that already exist,
and a path to capture the org's market.

## 2. Current state (verified against `origin/main` c08896737)

**Currency flow today.**

| Surface               | Site                                                             | Currency source today                                                      |
| --------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Deposit charge        | `packages/core/src/skill-runtime/tools/deposit-link.ts:119`      | injected `deps.defaultCurrency`, wired to `PILOT_DEPOSIT_CURRENCY = "SGD"` |
| Booked-value stamp    | `packages/core/src/skill-runtime/tools/calendar-book.ts:466,530` | injected `deps.defaultCurrency`, wired to `"SGD"` at `skill-mode.ts:438`   |
| Quoted price (prompt) | `packages/core/src/skill-runtime/context-resolver.ts:45`         | per-service `svc.currency` (BusinessFacts, default SGD)                    |
| Dashboard display     | `apps/dashboard/src/lib/money.tsx`, `home-summary.ts:67`         | hardcoded `S$` / `currency:"SGD"`                                          |
| Revenue recording     | `RecordRevenueInputSchema`, `LifecycleRevenueEvent`              | `.default("SGD")`; verified payment uses Stripe's authoritative currency   |

Both money tool factories are constructed ONCE at app bootstrap (global, not per-org),
so currency cannot be fixed by swapping the constant; it must resolve per-request.

**Per-request resolution already exists.** `SkillRequestContext` carries both `orgId`
and `deploymentId` (`packages/core/src/skill-runtime/types.ts:419`). The gates obtain
their `config.jurisdiction` from `governanceConfigResolver`
(`apps/api/src/bootstrap/skill-mode.ts:186`), a `(deploymentId) => Resolution`
function reading `AgentDeployment.governanceConfig`
(`packages/core/src/governance/governance-config-resolver.ts`). The money tools have
`ctx.deploymentId` and can use the same resolver, so money and gates read one source.

**Jurisdiction consumers.** All five afterSkill gates plus two channel-gateway gates
read jurisdiction. Output-claim gates (banned-phrase `deterministic-safety-gate.ts:133`,
claim-classifier, price) read `config.jurisdiction`. Consent/PDPA gates
(`pdpa-consent-gate.ts`, `consent-enforcement-gate.ts`, `consent-revocation-gate.ts`)
read `config.jurisdiction` and pass it to `ConsentService`, which stamps
`Contact.pdpaJurisdiction` (`consent-service.ts:108-124`). `jurisdictionFromE164`
exists but has zero call sites in governance.

**Market capture.** `OrganizationConfig` (Prisma, `schema.prisma`) has no
jurisdiction/clinicType/currency. Onboarding (`apps/dashboard/.../onboarding`,
`business-facts-step.tsx`) captures serviceArea/USP/etc., not market. The
governanceConfig market is updatable safely in principle: `setGateModeInConfig`
(`packages/schemas/src/set-gate-mode-in-config.ts:24-25`) preserves sibling fields via
spread, and `PrismaGovernanceGateModeWriter` uses SELECT...FOR UPDATE, org-scoped
(`packages/db/src/stores/prisma-governance-gate-mode-writer.ts:50-71`). There is no
operator path that writes jurisdiction/clinicType.

## 3. Design decisions (load-bearing)

### (a) Currency is DERIVED from jurisdiction, never separately stored.

`currencyForJurisdiction(jurisdiction: "SG"|"MY"): "SGD"|"MYR"` is a total pure
function in `@switchboard/schemas` (Layer 1), exhaustive over the enum with no default
branch. A clinic occupies exactly one market and settles one Stripe currency
(`SG->SGD`, `MY->MYR`); the mapping is 1:1 in this product. Deriving from the single
market value that already exists (`governanceConfig.jurisdiction`) makes "MY clinic
charged in SGD" structurally impossible: there is no second field to drift. A
hypothetical third currency (e.g. USD) is YAGNI for SG/MY medspa and, if ever needed,
becomes a deliberate enum extension that the compiler forces every call site to handle.

Rejected: a per-org or per-service explicit currency field. The per-service
`Service.currency` field already exists and is exactly the drift vector to retire
(an operator could set a MY clinic's service to "SGD" while the deposit charges MYR).
Authoritative currency for what Alex quotes and what the deposit charges becomes the
org-derived value; the per-service field is no longer read for those.

### (b) Two jurisdiction scopes, cleanly split.

- **Org jurisdiction** (`governanceConfig.jurisdiction`) = the clinic's market. Drives
  currency, persona/tone, timezone fallback, the output-claim gates, and is the
  fallback for per-lead resolution.
- **Per-lead jurisdiction** = `contact.pdpaJurisdiction ?? jurisdictionFromE164(contact.phoneE164) ?? orgJurisdiction`.
  Drives the contact-data surfaces: PDPA-consent, consent enforcement/revocation, and
  first-touch WhatsApp template selection.

One-line rule: _what Alex may SAY is governed by the clinic's market (org); how Alex
treats THIS person's data and reaches them is governed by that person's market
(per-lead)._ This matches the documented intent of `jurisdictionFromE164` ("the
stamped jurisdiction, when present, always takes precedence over this phone-derived
guess"). It also keeps the output-claim gates unchanged (a SG clinic stays
HSA-governed even when messaging a `+60` lead, which it would disqualify as
out-of-area anyway), minimising blast radius.

The derivation must be applied through ONE helper (`resolveContactJurisdiction`) at
every consent site, because `Contact.pdpaJurisdiction` is immutable after first stamp
and `ConsentService` throws `ConsentJurisdictionMismatch` on a differing write. A
single consistent chokepoint guarantees a contact is always stamped the same way, so
no spurious mismatch arises.

### (c) The deposit-link hardcode is parameterized fail-closed.

Both money tools take an injected `resolveCurrency: (deploymentId) => Promise<SupportedCurrency | null>`
in place of the static `defaultCurrency`. apps/api wires it to the existing
`governanceConfigResolver`: resolved -> `currencyForJurisdiction(config.jurisdiction)`;
missing/error -> `null`.

- **deposit-link** (the actual charge): `null` -> return `fail("CURRENCY_UNRESOLVED", ...)`
  and make NO `createDepositLink` call. No charge is strictly safer than a wrong-currency
  charge. For a seeded org this branch is unreachable (P2-A guarantees a config); the
  fail-closed path exists for defence in depth and is asserted by test.
- **calendar-book** (the value stamp): `null` -> abstain (leave `currency`/value null,
  booking still succeeds), mirroring its existing best-effort valuation. Currency is
  stamped from jurisdiction independently of whether the service is priced, so a
  null currency means only "jurisdiction unresolvable," never "service unpriced."

Both tools use the SAME `resolveCurrency`, so the deposit and the booked value cannot
disagree.

### (d) Onboarding captures market; one writer is both capture and update path.

A new operator-mutation intent `governance.set_market` (mirrors `governance.set_gate_mode`:
`system_auto_approved`, audited, reversible) writes `governanceConfig.jurisdiction` and
`clinicType` via a pure `setMarketInConfig` (sub-block-preserving spread, mirrors
`setGateModeInConfig`) and a `PrismaGovernanceMarketWriter` (SELECT...FOR UPDATE,
org-scoped, mirrors the gate-mode writer). Unlike the enforce flip, NO readiness probe
gates it: market is an operator declaration of fact, not a producer-gated capability.

`governanceConfig.jurisdiction` stays the single source of truth. No new
`OrganizationConfig` columns, so no two-copy drift. The dual seeders
(`ensureAlexListingForOrg`, `ensureAlexForOrg`) keep their safe `SG/medical` observe
default as a pre-capture placeholder; the operator's onboarding selection overrides it
the moment it is set. Because observe never blocks a reply, the brief SG-default window
before capture is harmless and pre-go-live. The seeders are therefore NOT changed,
sidestepping the dual-seeder twin-drift gotcha for this workstream.

## 4. Money surface inventory and slice ownership

| Surface                             | Fix                                          | Slice      |
| ----------------------------------- | -------------------------------------------- | ---------- |
| Deposit charge currency             | resolve per-request, fail-closed             | 1          |
| Booked-value stamp currency         | resolve per-request, abstain                 | 1          |
| `currencyForJurisdiction` primitive | new L1 pure fn                               | 1          |
| Org market capture + update path    | `set_market` intent + writer + UI            | 2          |
| Per-lead PDPA jurisdiction          | `resolveContactJurisdiction` chokepoint      | 3          |
| Quoted-price currency (prompt)      | org currency, not per-service field          | 4          |
| Persona MY tone + timezone          | jurisdiction-selected                        | 4          |
| Dashboard money display             | parameterize `formatMoney` + thread currency | 5          |
| Revenue-recording currency          | verify Stripe-authoritative + derive default | 5 (verify) |

## 5. Components (Slice 1, the safety-critical core)

1. **`currencyForJurisdiction` + `SupportedCurrency`** (`@switchboard/schemas`, new).
   Pure, total over `"SG"|"MY"`. Co-located parity test.
2. **deposit-link tool** (`packages/core/.../tools/deposit-link.ts`, modify). Replace
   `defaultCurrency: string` dep with `resolveCurrency: (deploymentId) => Promise<SupportedCurrency | null>`.
   Resolve at execute via `ctx.deploymentId`; `null` -> `fail` with no port call.
3. **calendar-book tool** (`packages/core/.../tools/calendar-book.ts`, modify). Same
   resolver dep; `null` -> abstain on currency.
4. **apps/api wiring** (`deposit-link-wiring.ts`, `skill-mode.ts`, modify). Build
   `resolveCurrency` from the existing `governanceConfigResolver` and inject into both
   factories. Retire `PILOT_DEPOSIT_CURRENCY` and the `defaultCurrency:"SGD"` literal.

## 6. Data flow (Slice 1)

```
calendar.book (MY deployment)
  -> resolveCurrency(ctx.deploymentId)
       -> governanceConfigResolver(deploymentId) = {resolved, jurisdiction:"MY"}
       -> currencyForJurisdiction("MY") = "MYR"
  -> ReceiptedBooking.currency = "MYR" (value stamped MYR; abstains if unpriced)

deposit.issue (same booking)
  -> resolveCurrency(ctx.deploymentId) = "MYR"
  -> port.createDepositLink({ currency: "MYR", amountCents })

deposit.issue (config missing/corrupt)
  -> resolveCurrency = null
  -> fail("CURRENCY_UNRESOLVED"); NO createDepositLink call  // fail-closed
```

## 7. Safety: currency-can't-be-wrong, and how it is proven

1. **Structural.** `currencyForJurisdiction` is total over the enum with no default;
   adding a jurisdiction without a currency is a compile error. Parity test asserts
   `SG->SGD`, `MY->MYR`.
2. **Fail-closed (the required test).** deposit-link with a deployment whose config is
   missing or corrupt -> `resolveCurrency` returns null -> the tool returns
   `fail("CURRENCY_UNRESOLVED")` and the injected payment port's `createDepositLink`
   is asserted NOT called (spy). No wrong-currency, no any-currency charge.
3. **Cross-tool consistency.** A MY deployment: deposit charges MYR AND the booked
   value is stamped MYR (same resolver). An SG deployment: both SGD (behaviour
   unchanged for every existing org).

## 8. Testing strategy (Slice 1)

- `currency-for-jurisdiction.test.ts` (schemas): `SG->SGD`, `MY->MYR`; type-level
  exhaustiveness.
- `deposit-link.test.ts` (core, extend): MY deployment -> `createDepositLink` called
  with `currency:"MYR"`; SG -> `"SGD"`; missing/corrupt config -> `fail` and port spy
  NOT called.
- `calendar-book.test.ts` (core, extend): MY deployment -> ReceiptedBooking stamped
  `currency:"MYR"`; unresolvable -> currency null, booking still created.
- Wiring smoke (apps/api): `resolveCurrency` maps resolver outcomes to currency/null.

Verification: `pnpm --filter @switchboard/schemas|core|api exec tsc --noEmit` + targeted
tests + `pnpm test`. No schema migration (currency columns already exist; the new
function is pure).

## 9. Scope

**In scope (whole workstream):** per-org currency derivation at every money surface;
org market capture + update path; per-lead PDPA jurisdiction from `+60`; MY persona
tone + timezone; dashboard MYR.

**Slice 1 only:** the deposit charge and booked-value currency boundary, the
`currencyForJurisdiction` primitive, and the fail-closed proof.

**Explicitly deferred / out of scope:**

- Per-org deposit AMOUNT (`PILOT_DEPOSIT_AMOUNT_CENTS` stays a pilot constant; only its
  currency is corrected). Magnitude (RM 50 vs SGD 50) is a pilot/operator call, not a
  correctness defect.
- Retiring the per-service `Service.currency` field from the schema/UI (slice 4 stops
  reading it authoritatively; full removal is a later cleanup).
- Multi-currency clinics / a single org serving both markets with two Stripe currencies
  (not a real single-clinic scenario).
- Riley/Mira jurisdiction (separate agents; reuse the same primitives when needed).

## 10. Risks and limitations

- A MY clinic's Stripe Connect account must support MYR settlement (operational
  prerequisite; the code passes the ISO currency, Stripe enforces account capability).
- Existing contacts already stamped `SG` with a `+60` phone will NOT be re-stamped
  (immutability by design); the consistent chokepoint only changes NEW stamps. Rare
  pre-launch; acceptable.
- The SG-default seed window before onboarding capture mislabels observe telemetry
  briefly; harmless because observe never blocks and it is corrected at go-live.
