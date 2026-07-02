# Minimal L1 Open-`regulatoryProfileId` Refactor Implementation Plan (RESCOPED)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan one PR-slice at a time, golden-gated, with a fresh reviewer per slice. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open the two closed governance axes the self-serve dollar path needs (`regulatoryProfileId` and `market`) into fail-closed registries with a `generic` default, so a stranger from any door or market onboards safe-by-construction, while every medspa golden snapshot stays byte-identical.

**Architecture:** Additive compat shim. Two registries in `packages/schemas` (Layer 1) become the single source for the profile and market axes; the merged safe-harbor floor primitives (`resolveVertical`, `buildSafeHarborFloorConfig`, the `generic` loader tables, the fail-closed merge, the `generic` provisioning case, the SH-4 precedence reconciliation) are *generalized*, not rebuilt. The pre-existing closed unions stay alive as the seed-registry entries, the loader jurisdiction axis, and the legacy-config fallback. Their removal is the deferred "cut L1 tail" (Section 8), not part of this minimal series.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Zod, pnpm + Turborepo, Vitest, Prisma (JSON column, already `String` at rest).

## Status and provenance

- **Status:** RESCOPED per `docs/superpowers/specs/2026-07-02-one-product-many-doors-design.md` Section 8 (owner-approved). Supersedes the DRAFT decomposition of the same filename (the 9-PR series). This document is the authoritative execution plan for build slice **S2** of the one-product-many-doors roadmap.
- **Re-baselined against merged `main`:** the safe-harbor floor SH-1..SH-5 (#1386..#1390) is now MERGED. Roughly half of the DRAFT's L1 slices were pre-built by the floor; those slices shrink here from "build" to "generalize" or "assert". All code anchors below were verified against `main` @ `712bd27fb` (not the DRAFT's pre-floor assumptions).
- **Consumes (all on `main`):** the floor spec `docs/superpowers/specs/2026-07-02-safe-harbor-floor.md` (D5 = this seam), and the merged floor primitives.

## Global Constraints

Every task's requirements implicitly include this section.

- **Byte-identical merge gate (ALL slices):** the four medspa golden snapshots move ZERO bytes. Run it explicitly before every commit and in review: `pnpm exec vitest run --config evals/vitest.config.ts skill-prompt-golden` (5 `it()` cases, 4 snapshot files). Do NOT rely on CI paths-filter alone: the golden's filter keys on `packages/core/src/skill-runtime/**` and `skills/alex/**`, so a `governance/**` or `schemas/**`-only PR may not trigger it in CI. The local run is the gate.
- **Per-package typecheck before every commit:** `pnpm --filter <pkg> exec tsc --noEmit` for each touched package (pre-commit hooks are eslint + prettier ONLY). For app packages that consume changed lower packages, rebuild the lower `dist` first or run `pnpm reset` once.
- **Layer rules (Doctrine):** schemas imports no `@switchboard/*`; core imports schemas (not db); db imports schemas + core. Both registries live in `packages/schemas`. Promoting `Vertical` to schemas respects this (core re-exports it).
- **Fail-closed directions (never fail-open):** unknown/unregistered `market` -> `null` currency (no charge) and `null` PDPA regime (no proactive send, no revocation ack); unknown `regulatoryProfileId` -> the `generic` floor; absent marker -> `medspa` (legacy byte-identical); corrupt marker -> the safe default. An unknown key must never silently resolve to a *guessed* currency, the MY PDPA table, or a looser floor.
- **Compat shim discipline:** the closed unions (`JURISDICTIONS`, `CLINIC_TYPES`, `JurisdictionSchema`, `ClinicTypeSchema`, `currencyForJurisdiction` + its `assertNever`) are NOT edited in this series. They remain the seed-registry values, the loader `"SG"|"MY"` jurisdiction axis, and the legacy fallback. Their removal is Section 8 (deferred).
- **medspa is a REGISTERED profile, never the fallback.** medspa resolves its own tables/config/prompt verbatim (`MEDSPA_PILOT_GOVERNANCE_CONFIG` by reference). The floor is authored only on the disjoint `generic`/unregistered path medspa never selects.
- **Surface-before-merge (owner review):** every slice touches a CODEOWNERS-gated path (`packages/core/`, `packages/db/` are explicit; `packages/schemas/` and `apps/api/` fall under the `* @jsonljc` catch-all), so each PR requires owner review and human merge automatically. There is no separate glob file to edit. Each slice is an independently reviewable, revertible PR.
- **Style:** no em-dashes; no `any` (use `unknown`); no `console.log` (use `console.warn`/`console.error`); double quotes, semicolons, 2-space indent, trailing commas, 100-char width; conventional commits; co-located `*.test.ts`; keep files under 400 lines.

---

## 1. Why (design intent, rescoped)

The product is ONE governed booking agent any appointment-taking business self-serves onto (one-product-many-doors spec, Section 1-3). Verticals are marketing doors and onboarding presets, NOT governance objects. The pack concept is dissolved into a **curated regulatory-profile registry** whose only launch entries are `generic` (the safe-harbor floor, the default for every new tenant) and `medspa` (the existing vetted profile, enforce path intact). There is NO pack-authoring surface, now or in onboarding, until customer demand justifies authoring a new vetted profile (a rare, platform-curated event, not a self-serve capability).

Two closed axes on `GovernanceConfig` block open self-serve because a new profile or market is a *compile error*:

- `clinicType` / the loader `vertical` (regulatory posture and claim-boundary tables), and
- `jurisdiction` (currency, PDPA regime, loader jurisdiction), whose currency map (`currencyForJurisdiction`) carries an `assertNever` that *throws* on an unknown market.

This series opens exactly what the dollar path (ad-click -> Stripe receipt) needs:

1. **Open `regulatoryProfileId` with a `generic` default** so a door or self-serve signup threads a profile that resolves to the floor (registered -> that profile; unregistered -> `generic`; absent -> `medspa` legacy), and a future vetted profile is a *registry addition*, not a 98-file recompile.
2. **Open `market` for currency (fail-closed)** so the global web-widget door does not crash for a non-SG/MY visitor: an unregistered market yields `null` currency (no charge) and `null` PDPA regime (no send), the safe direction the `assertNever` protects, now without a throw on the hot path.

Everything else the DRAFT proposed (removing the closed unions, the full `clinicType`-read sweep, the operator set-market re-expression, any fitness/new-pack authoring) is either the deferred cleanup tail (Section 8) or cut by the rescope.

## 2. Ground truth on `main` (verified @ 712bd27fb)

### 2.1 What the merged floor already gives us (do NOT rebuild)

| Primitive | Site (on `main`) | What it does |
| --- | --- | --- |
| `resolveVertical(config)` | `packages/core/src/governance/resolve-vertical.ts:20` | Reads the passthrough `vertical` marker; `safeParse` vs `z.enum(VERTICALS)`; fail-safe to `DEFAULT_VERTICAL` ("medspa") on absence/corruption. |
| `VERTICALS` / `Vertical` / `DEFAULT_VERTICAL` | `packages/core/src/vertical.ts:15,16,22` | `["medspa","dental","fitness","generic"]`; type derives from the array; default "medspa". **Core-local today.** |
| `resolveVerticalTable(byV, v, floor)` | `packages/core/src/vertical.ts:35` | Length-aware fail-closed fallback (`table.length > 0 ? table : floor`), closes the empty-array fail-open. |
| Loader floor + manifest | `packages/core/src/governance/floor-manifest.ts` (`assertFloorCoverage`, `BANNED_PHRASE_FLOOR_MANIFEST`, `ESCALATION_FLOOR_MANIFEST`) | Load-time superset assertion; medspa passes with zero edits. |
| `generic` loader tables | `banned-phrases/common.ts` (`GENERIC_COMMON_BANNED_PHRASES`), `escalation-triggers/common.ts` (`GENERIC_COMMON_ESCALATION_TRIGGERS`); loaders at `governance/{banned-phrases,escalation-triggers}/loader.ts` | `loadBannedPhrases(jurisdiction, vertical=medspa)` / `loadEscalationTriggers(...)`; fallback floor is now GENERIC (SH-2); cache keyed `` `${vertical}:${jurisdiction}` ``. |
| `SafeHarborFloorConfig` + `buildSafeHarborFloorConfig({jurisdiction})` | `packages/schemas/src/governance-config.ts:316,318` | `buildObserveGovernanceConfig({jurisdiction, clinicType:"nonMedical"})` + passthrough `vertical:"generic"`. |
| `selectPackGovernanceConfig({vertical?, market?})` | `packages/db/src/seed/pack-governance-config.ts:57` | Closed switch: `ProvisioningVertical="medspa"|"generic"` (`:17`), `ProvisioningMarket=Jurisdiction` (`:24`). medspa/SG -> `MEDSPA_PILOT_GOVERNANCE_CONFIG` by reference (`:64-70`); generic -> `buildSafeHarborFloorConfig({jurisdiction:market})` (`:71-76`); `default` -> inline `never` guard + throw (`:77-82`). |
| SH-4 precedence reconciliation | `apps/api/src/lib/ensure-alex-listing.ts:90-100` (comment `:79-89`) | 3-way `if(opts.vertical){selector} else if(seedContext){buildObserve} else {selector default}`. An explicit `vertical` now wins over the always-truthy `governanceSeedContext`; the seedContext jurisdiction is demoted to a market fallback. |
| `GovernancePosture.vertical?` | `packages/core/src/governance/posture-cache.ts:16` | SH-3 added the optional cached vertical; absent -> `DEFAULT_VERTICAL`. |

### 2.2 The closed axes and their consumers (what this series opens)

- **Closed unions:** `governance-config.ts:11` `JURISDICTIONS`, `:15` `CLINIC_TYPES`, `:19-20` `JurisdictionSchema`/`ClinicTypeSchema`, `:24-25` config fields, `:32` `.passthrough()`, `:221-224` `ObserveGovernanceConfigInput`, `:227` `SupportedCurrency = "SGD"|"MYR"`, `:242-253` `currencyForJurisdiction` (chokepoint #1, `assertNever` `:248-250`), `:257-272` `ObserveGovernanceConfig` literal type, `:283-302` `buildObserveGovernanceConfig`.
- **Currency runtime call site (the only one):** `apps/api/src/bootstrap/resolve-currency.ts:14-21` (fail-closed `null` at `:19`; `currencyForJurisdiction(resolution.config.jurisdiction)` at `:20`). `SupportedCurrency` is held only as `Promise<SupportedCurrency|null>` by `deposit-link-wiring.ts:5,47`, `packages/core/src/skill-runtime/tools/deposit-link.ts:9,39` (in CORE, not api), `calendar-book-types.ts:9,138`. No consumer switches on the union, so widening it later is low-blast; we DEFER widening (Q4).
- **Provisioning chokepoint #2:** the inline `never` guard in `selectPackGovernanceConfig` (`pack-governance-config.ts:77-82`). Seeders: `provision-org-agents.ts:85-88` (db twin, unconditional selector) and `ensure-alex-listing.ts:90-100` (api, precedence-reconciled). `deriveAlexGovernanceSeedContext` (`alex-governance-seed-context.ts:13-19`) always returns `{jurisdiction, clinicType:"medical"}`; `organizations.ts:77-79` (primary) passes seedContext only, `:328-331` (safety-net) passes no opts. `MEDSPA_PILOT_GOVERNANCE_CONFIG` at `medspa-governance-config.ts:10`.
- **PDPA cast-coupling (Group G, the safety hazard):** exactly **4 Class-A sites** cast the org market as the PDPA regime and MUST decouple: `skill-runtime/hooks/pdpa-consent-gate.ts:99-102`, `channel-gateway/consent-enforcement-gate.ts:104-105`, `channel-gateway/consent-revocation-gate.ts:66` AND `:111`. `PdpaJurisdiction` (`packages/schemas/src/pdpa-consent.ts:3-4`) is a SEPARATE `z.enum(["SG","MY"])` that only coincides with `Jurisdiction` today; opening the org market makes each cast unsound. Degradation is asymmetric and fail-OPEN: `REVOCATION_ACK[unknown]` (`consent/revocation-ack.ts:10`) -> `undefined` -> unguarded `replySink.send(undefined)`; `DISCLOSURE_COPY[unknown]` (`consent/disclosure-copy.ts:18`) -> `undefined`; `revocation-keywords/loader.ts:16-17` -> a `j === "SG" ? sg : my` ternary that silently falls to the MY table for ANY non-SG key. So the decouple needs explicit null-handling, not a bare cast swap.
  - **Do NOT touch** the 6 Class-B casts (`row.pdpaJurisdiction as PdpaJurisdiction` in `consent-service.ts:263,334`, `issue-receipted-booking.ts:129`, `prisma-contact-consent-reader.ts:33`, `prisma-consent-store.ts:49`, `prisma-receipted-booking-store.ts:188`): those read a per-CONTACT stored regime, a different axis, unaffected by opening the org market.
- **`Vertical` blast radius:** 14 non-test source files import `vertical.js`/`resolve-vertical.js`, ALL inside `packages/core` (zero apps/evals reach). Promoting `Vertical` to schemas + re-exporting from core's `vertical.ts` keeps all 14 unchanged.

### 2.3 The byte-identical spine (re-verified on `main`)

The golden harness (`evals/skill-prompt-golden/render.ts`) executes only `loadSkill("alex") -> resolveParameters -> buildSystemPrompt`. A grep of the entire executed set (10 core + 5 eval files) for `clinicType | jurisdiction | currencyFor | SupportedCurrency | regulatoryProfileId | selectPackGovernanceConfig | loadBannedPhrases | loadEscalationTriggers | resolveVertical | GovernanceConfig` returns ZERO hits. `getGovernanceConstraints` returns a static `MANDATORY RULES` string with no axis dependence. Therefore every registry/config/loader/provisioning artifact this series adds changes zero bytes the golden renders: **golden-green by non-participation.** medspa BEHAVIOR-equivalence (stronger than prompt-equivalence) is proven per-slice by targeted unit tests using `toBe` (reference identity), not the golden.

## 3. Scope decision (READ THIS)

This series is **additive-minimal**: it opens the two axes fail-closed and routes the runtime dollar-path consumers (currency, PDPA, provisioning, profile-resolution) through the registries. It does NOT remove the closed unions, and it does NOT sweep the ~38 inline-literal files.

Rationale: the build-admission rule is "no work item enters the critical path unless it sits between an ad click and a Stripe receipt." The additive resolvers ARE that path; the union-removal is pure cleanup that unblocks nothing further and is the single non-additive, highest-blast PR. It is the "cut L1 tail" the strategy defers until after the first payment (Section 8). The additive slices are a **strict prefix** of the full compat shim, so deferring the removal costs no rework: the removal PR simply appends when the owner calls for it.

Correction to the DRAFT's framing: the union-removal sweep is ~38 non-test files (31 for `"SG"|"MY"`, 8 for `"medical"|"nonMedical"`), NOT 98. The "~98/100 files" figure is the broad `jurisdiction`/`clinicType` *identifier* footprint, most of which merely carries the value as data and needs no change.

## 4. File structure

New files (all Layer 1 schemas, single-responsibility):

- `packages/schemas/src/market-registry.ts`: `MarketId`, `Market`, the SG/MY seed map, `currencyForMarket`, `resolveMarket`.
- `packages/schemas/src/regulatory-profile-registry.ts`: `RegulatoryProfileId`, `RegulatoryProfile`, the `generic`+`medspa` seed map, `resolveRegulatoryProfile`.
- `packages/schemas/src/vertical.ts`: the promoted `VERTICALS`/`Vertical`/`DEFAULT_VERTICAL` (core `vertical.ts` re-exports from here).

Modified (surgical): `governance-config.ts` (wrapper + marker types), the two seeders + selector, `resolve-currency.ts`, the 4 PDPA Class-A sites, the two loaders' JSDoc, and test files. Each slice below names its exact set.

---

## S2-0: Riders (close the two known floor gaps)

**Layer:** core. **Byte-identical because:** adds a test and edits two comments; no rendered byte or resolved value changes. Merges FIRST (lowest risk, scope-independent).

**Files:**
- Create/extend test: `packages/core/src/governance/resolve-vertical.test.ts` (add the cross-package seam case) OR a new `packages/core/src/governance/floor-seam.test.ts`.
- Modify: `packages/core/src/governance/banned-phrases/loader.ts` (JSDoc `~:33-34`), `packages/core/src/governance/escalation-triggers/loader.ts` (JSDoc `~:36-37`).

**Interfaces:**
- Consumes: `buildSafeHarborFloorConfig` from `@switchboard/schemas`; `resolveVertical` from `./resolve-vertical.js`.
- Produces: nothing new (guard + docs).

- [ ] **Step 1 (f1): Write the failing cross-package seam test.** The schemas literal `vertical:"generic"` (in `buildSafeHarborFloorConfig`) and the core `z.enum(VERTICALS)` (in `resolveVertical`) are pinned only independently today; a rename on either silently degrades every self-serve tenant to the medspa fail-safe with no signal. Assert the wiring end to end:

```ts
import { describe, it, expect } from "vitest";
import { buildSafeHarborFloorConfig } from "@switchboard/schemas";
import { resolveVertical } from "./resolve-vertical.js";

describe("floor seam: schemas factory -> core resolver", () => {
  it("resolves the safe-harbor floor config to the generic vertical (SG and MY)", () => {
    expect(resolveVertical(buildSafeHarborFloorConfig({ jurisdiction: "SG" }))).toBe("generic");
    expect(resolveVertical(buildSafeHarborFloorConfig({ jurisdiction: "MY" }))).toBe("generic");
  });
});
```

- [ ] **Step 2:** Run it: `pnpm --filter @switchboard/core exec vitest run governance/resolve-vertical.test.ts` (or the new file). Expected: PASS today (this pins current behavior; it is a regression guard, and it FAILS the moment either side is renamed).
- [ ] **Step 3 (f2): Fix the stale JSDoc on both loaders.** Both function JSDocs still say a vertical without tables "inherits the medspa seed floor"; since SH-2 the fallback is the GENERIC floor (the inline comment at `loader.ts:43-45`/`:47-49` already says so). Change the JSDoc line in each to: "A vertical without its own table resolves the GENERIC safe-harbor floor (SH-2), the over-restrictive safe direction until that vertical's pack lands." (Match wording to the correct inline comment.)
- [ ] **Step 4:** `pnpm --filter @switchboard/core exec tsc --noEmit`; core tests; golden gate. Expected: all green, golden 4/4 byte-identical.
- [ ] **Step 5: Commit.** `git commit -m "test(core): pin the floor config->generic cross-package seam; fix stale loader floor JSDoc (L1 f1/f2)"`

> Note: S2-2 additionally hardens f1 at compile time by typing the floor marker against `Vertical` (belt-and-suspenders). The runtime test here remains the primary guard (it also catches a wrong marker VALUE that still type-checks).

---

## S2-1: Market registry + `currencyForMarket` (open market, fail-closed)

**Layer:** schemas. **Byte-identical because:** SG/MY are seeded to reproduce the exact currency; `currencyForJurisdiction` becomes a thin wrapper; no consumer is repointed yet; golden non-participation.

**Files:**
- Create: `packages/schemas/src/market-registry.ts`, `packages/schemas/src/market-registry.test.ts`.
- Modify: `packages/schemas/src/governance-config.ts` (turn `currencyForJurisdiction` into a wrapper; keep its signature), `packages/schemas/src/index.ts` (export the registry).

**Interfaces produced (consumed by S2-2..S2-6):**

```ts
export type MarketId = string; // open, registry-validated
export interface Market {
  id: MarketId;
  currency: SupportedCurrency;           // stays "SGD" | "MYR" (Q4 defer)
  pdpaJurisdiction: PdpaJurisdiction | null; // null => no PDPA regime => fail-closed
  loaderJurisdiction: "SG" | "MY";       // maps an open market to the existing loader tables
  timezone: string;
}
export function currencyForMarket(id: MarketId): SupportedCurrency | null; // null for unregistered
export function resolveMarket(idOrConfig: MarketId | GovernanceConfig | null): Market | null;
```

Seeds: `SG {SGD, SG, SG, "Asia/Singapore"}`, `MY {MYR, MY, MY, "Asia/Kuala_Lumpur"}`.

- [ ] **Step 1: Write failing tests.** `currencyForMarket("SG")==="SGD"`, `currencyForMarket("MY")==="MYR"`, `currencyForMarket("TH")===null`, `currencyForMarket("")===null`; a **parity test** `for (const j of JURISDICTIONS) expect(currencyForMarket(j)).toBe(currencyForJurisdiction(j))`; `resolveMarket("SG")?.pdpaJurisdiction==="SG"`, `resolveMarket("TH")===null`.
- [ ] **Step 2:** Run tests, verify they fail (module not found).
- [ ] **Step 3: Implement `market-registry.ts`.** A frozen `Record<string, Market>` seed map + the two functions; `currencyForMarket` returns `SEED[id]?.currency ?? null`; `resolveMarket` accepts an id or reads `config.market` marker then the legacy `config.jurisdiction`, returning `SEED[key] ?? null`. No `assertNever`; unknown -> null.
- [ ] **Step 4: Rewrite `currencyForJurisdiction` as a wrapper** that delegates to `currencyForMarket`, preserving its `(j: Jurisdiction): SupportedCurrency` signature and non-null guarantee for SG/MY (e.g. `const c = currencyForMarket(j); if (!c) { /* unreachable for Jurisdiction */ throw ... }`). Keep the `assertNever` semantics for the closed union at the wrapper boundary until Section 8.
- [ ] **Step 5:** Run tests (PASS), `pnpm --filter @switchboard/schemas exec tsc --noEmit`, schemas tests, golden gate. Then rebuild schemas `dist` and re-typecheck core/db/api that import `SupportedCurrency` (`pnpm reset` if needed).
- [ ] **Step 6: Confirm review + gate.** No glob to add: `packages/schemas/**` is owner-reviewed via CODEOWNERS (`* @jsonljc`). Note the new schemas file is NOT under any eval-job paths-filter in `ci.yml`, so the golden does not auto-run in CI for a schemas-only diff: the local golden run (Global Constraints) is the gate.
- [ ] **Step 7: Commit.** `git commit -m "feat(schemas): market registry + currencyForMarket (fail-closed), currencyForJurisdiction delegates (L1 S2-1)"`

---

## S2-2: Regulatory-profile registry + `resolveRegulatoryProfile` + promote `Vertical`

**Layer:** schemas (+ core re-export). **Byte-identical because:** the registry is added and read by no runtime consumer yet; `resolveVertical`'s call shape is unchanged (re-export); medspa resolves its own profile; golden non-participation.

**Files:**
- Create: `packages/schemas/src/vertical.ts` (promoted `VERTICALS`/`Vertical`/`DEFAULT_VERTICAL`), `packages/schemas/src/regulatory-profile-registry.ts`, `packages/schemas/src/regulatory-profile-registry.test.ts`.
- Modify: `packages/core/src/vertical.ts` (re-export the promoted symbols; keep `resolveVerticalTable` here), `packages/schemas/src/governance-config.ts` (type the floor marker against `Vertical`: `SafeHarborFloorConfig = ObserveGovernanceConfig & { vertical: Extract<Vertical, "generic"> }` so a `VERTICALS` rename breaks compilation), `packages/schemas/src/index.ts`.

**Interfaces produced:**

```ts
export interface RegulatoryProfile {
  id: RegulatoryProfileId;                 // = string, open, registry-validated
  loaderVertical: Vertical;                // "medspa" | "generic" for the two seeds
  clinicType: "medical" | "nonMedical";    // compat value gate consumers read
  buildObservePosture: (market: MarketId) => ObserveGovernanceConfig;
  displayName: string;
}
export function resolveRegulatoryProfile(id: RegulatoryProfileId): RegulatoryProfile; // unknown -> generic
```

Seeds (ONLY these two; no fitness, no authoring surface): `generic {loaderVertical:"generic", clinicType:"nonMedical", buildObservePosture: (m)=>buildSafeHarborFloorConfig({jurisdiction: resolveMarket(m)?.loaderJurisdiction ?? "SG"}), displayName:"Generic (safe-harbor floor)"}`; `medspa {loaderVertical:"medspa", clinicType:"medical", buildObservePosture: (m)=> m==="SG" ? MEDSPA_PILOT-equivalent : buildObserveGovernanceConfig({jurisdiction: loaderJurisdiction, clinicType:"medical"}), displayName:"Medspa (aesthetic clinics)"}`.

> Cross-layer note: `MEDSPA_PILOT_GOVERNANCE_CONFIG` lives in `packages/db`. schemas cannot import db. Keep the by-reference medspa/SG identity in the db selector (S2-4), NOT in the schemas registry: the registry's medspa `buildObservePosture` returns a value-equal observe config, and the db selector keeps returning the `MEDSPA_PILOT_GOVERNANCE_CONFIG` constant by reference for medspa/SG. The parity test asserts value-equality (`toEqual`) at the schemas layer and reference-identity (`toBe`) at the db layer (S2-4).

- [ ] **Step 1: Write failing tests.** `resolveRegulatoryProfile("medspa")` -> `{loaderVertical:"medspa", clinicType:"medical"}`; `resolveRegulatoryProfile("generic")` -> `{loaderVertical:"generic", clinicType:"nonMedical"}`; `resolveRegulatoryProfile("fitness")` (unregistered) -> the generic profile; `resolveRegulatoryProfile("")` -> generic. A parity test: the generic profile's `buildObservePosture("SG")` `toEqual` `buildSafeHarborFloorConfig({jurisdiction:"SG"})`.
- [ ] **Step 2:** Run, verify fail.
- [ ] **Step 3: Promote `Vertical` to schemas.** Move `VERTICALS`/`Vertical`/`DEFAULT_VERTICAL` into `packages/schemas/src/vertical.ts` (verbatim values). In `packages/core/src/vertical.ts`, `export { VERTICALS, DEFAULT_VERTICAL, type Vertical } from "@switchboard/schemas";` and keep `resolveVerticalTable` local. Verify all 14 core importers still resolve.
- [ ] **Step 4: Implement `regulatory-profile-registry.ts`** with the frozen seed map + `resolveRegulatoryProfile(id)` returning `SEED[id] ?? SEED.generic`.
- [ ] **Step 5: Harden the floor marker type** in `governance-config.ts` (Extract against `Vertical`); confirm it still compiles (the literal `"generic"` is a `Vertical` member).
- [ ] **Step 6:** Tests PASS; `tsc --noEmit` for schemas AND core (the re-export seam); rebuild dist; golden gate. (Owner review via CODEOWNERS; no glob to add.)
- [ ] **Step 7: Commit.** `git commit -m "feat(schemas): curated regulatory-profile registry (generic+medspa) + promote Vertical (L1 S2-2)"`

---

## S2-3: Config markers + config-level resolvers

**Layer:** schemas. **Byte-identical because:** markers are optional passthrough (like `vertical`); a config with no markers resolves medspa + legacy jurisdiction identically.

**Files:** Modify `packages/schemas/src/governance-config.ts` (document the optional `regulatoryProfileId?`/`market?` passthrough markers; add config overloads), add tests.

**Interfaces produced:**

```ts
// Overloads that accept a config and read its markers, with legacy fallback:
export function resolveRegulatoryProfile(config: GovernanceConfig | null): RegulatoryProfile;
// reads config.regulatoryProfileId (unknown -> generic); else resolveVertical(config)-derived profile
export function resolveMarket(config: GovernanceConfig | null): Market | null;
// reads config.market (unknown -> null); else config.jurisdiction (legacy SG/MY)
```

- [ ] **Step 1: Write failing tests.** Legacy medspa config (`{jurisdiction:"SG", clinicType:"medical"}`, no markers) -> `resolveRegulatoryProfile(config).loaderVertical==="medspa"`, `resolveMarket(config)?.id==="SG"`. Marker-present: `{...base, regulatoryProfileId:"generic", market:"MY"}` -> generic profile + MY market. Unknown markers: `regulatoryProfileId:"salon"` -> generic; `market:"TH"` -> null. A `resolveVertical`-consistency test: `resolveRegulatoryProfile(config).loaderVertical === resolveVertical(config)` for absent-marker configs.
- [ ] **Step 2:** Run, verify fail.
- [ ] **Step 3: Implement the config overloads.** `resolveMarket(config)` reads `(config as ...).market` marker via `safeParse`-style guarded read then `config.jurisdiction`; `resolveRegulatoryProfile(config)` reads the `regulatoryProfileId` marker then falls back to `resolveVertical(config)` mapped to a profile. Fail-closed per the directions in Global Constraints.
- [ ] **Step 4:** Tests PASS; `tsc`; golden gate.
- [ ] **Step 5: Commit.** `git commit -m "feat(schemas): optional regulatoryProfileId/market config markers + config resolvers (L1 S2-3)"`

> S2-2 and S2-3 MAY merge into one PR if a reviewer prefers; they are split for review size. The config overloads need the marker convention, so keep this order.

---

## S2-4: Route currency + provisioning through the registries (the dollar-path open)

**Layer:** core + api + db. **Byte-identical because:** SG/MY seeded reproduce the same currency and the same medspa/SG config by reference; unknown market/profile fail closed; golden non-participation. This is the slice that actually opens provisioning + currency.

**Files:**
- Modify: `apps/api/src/bootstrap/resolve-currency.ts` (route through `resolveMarket`/`currencyForMarket`).
- Modify: `packages/db/src/seed/pack-governance-config.ts` (generalize the closed switch to a registry lookup; open the input types), and both seeders' option types (`provision-org-agents.ts`, `apps/api/src/lib/ensure-alex-listing.ts`) to accept `regulatoryProfileId`/`market: string`.
- Tests: selector tests (`toBe` for medspa/SG by-reference), a precedence-assertion test, resolve-currency tests.

**Transformations (exact):**
- `resolve-currency.ts:20`: `currencyForJurisdiction(resolution.config.jurisdiction)` -> `currencyForMarket(resolveMarket(resolution.config)?.id ?? resolution.config.jurisdiction)`. The existing `null` short-circuit at `:19` stays; an unknown market now returns `null` (no charge) instead of throwing.
- `pack-governance-config.ts`: replace the `switch (vertical)` + inline `never` with `resolveRegulatoryProfile(regulatoryProfileId).buildObservePosture(market)`; the `default`/unknown branch is now the `generic` floor (never a throw). PRESERVE the medspa/SG by-reference return: special-case medspa/SG to return `MEDSPA_PILOT_GOVERNANCE_CONFIG` (the constant) so `toBe` holds. Open `PackProvisioningInput` to `{ regulatoryProfileId?: string; market?: string }` (keep `vertical`/`market` accepted as deprecated aliases during the window if any internal caller still passes them; the two seeders are the only callers).
- Both seeders: widen their option types to `regulatoryProfileId?`/`market?` (default medspa/SG). The api precedence branch (`ensure-alex-listing.ts:90-100`) KEEPS its SH-4 shape; only the field names generalize.

- [ ] **Step 1: Write failing tests.** `selectPackGovernanceConfig({regulatoryProfileId:"medspa", market:"SG"})` `toBe` `MEDSPA_PILOT_GOVERNANCE_CONFIG`; `{regulatoryProfileId:"generic", market:"SG"}` `toEqual` `buildSafeHarborFloorConfig({jurisdiction:"SG"})`; `{regulatoryProfileId:"salon", market:"SG"}` (unknown) -> generic floor (no throw); `{market:"TH"}` unknown market -> generic floor with `loaderJurisdiction` SG fallback, NO throw. Precedence-assertion test: a threaded `regulatoryProfileId` on `ensureAlexListingForOrg` wins over `governanceSeedContext` (assert the SH-4 reconciliation still holds; do not modify it). resolve-currency: `"SG"`->`"SGD"`, unresolved->`null`, unknown market->`null`.
- [ ] **Step 2:** Run, verify fail.
- [ ] **Step 3: Implement** the three transformations above.
- [ ] **Step 4:** Tests PASS; `tsc --noEmit` for db, core, AND api (consumer); rebuild db/core dist; golden gate; run `apps/api` tests.
- [ ] **Step 5: Commit.** `git commit -m "feat(db,api,core): route currency + provisioning through the market/profile registries (L1 S2-4)"`

> MAY split into S2-4a (resolve-currency) and S2-4b (provisioning selector + seeders) if the diff is large; each is independently golden-green.

---

## S2-5: PDPA decouple, null-safe (make opening the market SAFE)

**Layer:** core. **Byte-identical because:** SG/MY seeded markets resolve the same `pdpaJurisdiction`, so every current deployment is unchanged; only an unregistered market hits the new null path. Golden non-participation.

**Files:** Modify `packages/core/src/skill-runtime/hooks/pdpa-consent-gate.ts` (`:99`), `packages/core/src/channel-gateway/consent-enforcement-gate.ts` (`:104`), `packages/core/src/channel-gateway/consent-revocation-gate.ts` (`:66`, `:111`). Tests co-located per gate.

**Transformations:** replace each `... config.jurisdiction as PdpaJurisdiction` (org-market->PDPA) with `resolveMarket(config)?.pdpaJurisdiction` (SG/MY -> same regime; unknown -> `null`), and add explicit null-handling so `null` fails CLOSED at each consuming site:
- `consent-revocation-gate.ts:66` (`revocationKeywordLoader(...)`): if `pdpaJurisdiction` is `null`, SKIP revocation-keyword matching (do not call the loader; treat as no-regime -> the revocation feature is inert for that market, the safe direction). This closes the `revocation-keywords/loader.ts:17` silent-MY fallback.
- `consent-revocation-gate.ts:111` (`REVOCATION_ACK[...]`): if `null`, do NOT send an ack (`REVOCATION_ACK[null]` would be `undefined`).
- `consent-enforcement-gate.ts:104`: this cast is `(consent.pdpaJurisdiction ?? resolution.config.jurisdiction) as PdpaJurisdiction` (per-contact wins). Replace the org-market fallback with `resolveMarket(config)?.pdpaJurisdiction`; if the resulting jurisdiction is `null`, fail closed on the downstream regime-specific behavior (no undefined table read).
- `pdpa-consent-gate.ts:99`: `resolveContactJurisdiction(consent, config.jurisdiction as PdpaJurisdiction)`: replace the org fallback with `resolveMarket(config)?.pdpaJurisdiction`; ensure `resolveContactJurisdiction` handles a `null` fallback (no `DISCLOSURE_COPY[undefined]`; skip disclosure for a no-regime market).
- Leave `PdpaJurisdictionSchema` closed. Do NOT touch the 6 Class-B casts.

- [ ] **Step 1: Write failing tests** per gate: SG config -> `"SG"` regime (unchanged behavior); a config with `market:"TH"` (unregistered) -> `null` regime -> no revocation-keyword match, no ack send, no disclosure copy read, no MY fallback. Assert no `undefined` reaches `replySink.send`.
- [ ] **Step 2:** Run, verify fail (the current casts would send undefined / fall to MY).
- [ ] **Step 3: Implement** the four transformations with null guards.
- [ ] **Step 4:** Tests PASS; `tsc --noEmit` core; golden gate.
- [ ] **Step 5: Commit.** `git commit -m "fix(core): decouple PDPA regime from the org market, fail-closed on unknown market (L1 S2-5)"`

---

## S2-6: Openness acceptance proof (the series' acceptance criterion)

**Layer:** evals + db (test-only). **Byte-identical because:** the proof provisions an unregistered profile + unknown market on the disjoint `generic` path; medspa snapshots are untouched.

**Files:** Create a provisioning + resolution test (mirror the db store test pattern that mocks Prisma; see `prisma-workflow-store.test.ts` for the shape) proving open coexistence.

- [ ] **Step 1: Write the coexistence test.** An UNREGISTERED profile string (`regulatoryProfileId:"fitness"`, a bare string, NOT a registered pack) + a non-SG/MY market (`market:"TH"`) both resolve GREEN, alongside a medspa org: (a) `selectPackGovernanceConfig({regulatoryProfileId:"fitness", market:"TH"})` -> the generic floor config (nonMedical, observe), no throw; (b) `resolveRegulatoryProfile` -> generic, `loaderVertical:"generic"` -> the loaders resolve the GENERIC floor tables via the SH-1 length-aware fallback (never re-merging medspa's array, so the id-uniqueness assert cannot trip); (c) `currencyForMarket("TH") === null` (fail-closed no charge); (d) `resolveMarket("TH")?.pdpaJurisdiction` is `null` (no send); (e) the medspa golden stays 4/4 byte-identical.
- [ ] **Step 2:** Run; verify green; run the golden gate to confirm zero medspa drift.
- [ ] **Step 3: Commit.** `git commit -m "test(evals,db): prove an unregistered profile + unknown market boot the fail-closed floor alongside byte-identical medspa (L1 S2-6)"`

---

## 5. Sequencing and interfaces between slices

Order: **S2-0 -> S2-1 -> S2-2 -> S2-3 -> S2-4 -> S2-5 -> S2-6.** S2-1 (market) and S2-2 (profile) are independent registries and could be parallel, but S2-3 needs both markers, S2-4 needs S2-1+S2-2+S2-3, S2-5 needs S2-1's `resolveMarket`, and S2-6 needs all. Each slice is golden-green and revertible on its own. Because these mostly touch the DB `String`-at-rest JSON column and schemas types (not the closed unions), any slice rolls back by plain revert with the legacy path still authoritative.

## 6. Byte-identical invariant (per-slice one-liners)

- S2-0: a test + two comments; renders nothing.
- S2-1: SG/MY currency reproduced; `currencyForJurisdiction` delegates; no consumer repointed.
- S2-2: registry added, unread; `resolveVertical` re-exported unchanged; medspa profile value-equal.
- S2-3: markers optional passthrough; absent-marker configs resolve medspa + legacy jurisdiction.
- S2-4: medspa/SG returns `MEDSPA_PILOT_GOVERNANCE_CONFIG` by reference (`toBe`); unknown fails closed.
- S2-5: SG/MY -> same PDPA regime; only unknown markets take the null path.
- S2-6: proof runs on the disjoint generic path; medspa untouched.

The golden renders the medspa prompt, not the loaders/config/registries; every slice is green by non-participation, proven per-slice by unit tests.

## 7. Risks, rollback, gates

- **Empty-array / silent-MY fail-open (PDPA):** the loader empty-array trap is already closed (SH-1 `resolveVerticalTable`); the PDPA silent-MY trap is closed by S2-5's null-handling. Both are the highest-severity hazards; each has an explicit test.
- **Provisioning precedence shadow (shared with SH-4):** already reconciled at `ensure-alex-listing.ts:90-100`. S2-4 ASSERTS it with a test; it does not re-do it. If a future refactor touches the api ternary, that test guards it.
- **Cross-layer medspa identity:** the by-reference `MEDSPA_PILOT_GOVERNANCE_CONFIG` lives in db; keep the reference-return in the db selector, value-equality in the schemas registry (S2-2 note). The `toBe` selector test is the guard.
- **`SupportedCurrency` stays `"SGD"|"MYR"`** (Q4): `currencyForMarket` fail-closes unknown markets to `null`, so no third currency is needed on this path.
- **Golden CI trigger gap:** run the golden LOCALLY as the gate on every slice (Global Constraints); do not trust the paths-filter for `governance/**`/`schemas/**`-only diffs.
- **Rollback:** every slice is additive; a plain `git revert` restores the legacy path (closed unions are still authoritative throughout). There is no non-additive PR in this minimal series.

## 8. Deferred: the "cut L1 tail" (designed, NOT built in S2)

Per one-product-many-doors Section 9, these are deferred until after the first payment. They are pure cleanup or operator surface; none sits on the ad-click -> Stripe path. The additive resolvers above are already the runtime path, so nothing here unblocks a capability.

- **Final union-removal PR (the DRAFT's L1-8):** remove `JurisdictionSchema`/`ClinicTypeSchema`/`JURISDICTIONS`/`CLINIC_TYPES` + `currencyForJurisdiction` + its `assertNever`; widen `GovernanceConfig.{jurisdiction,clinicType}` (or rename to `market`/`regulatoryProfileId`) + the `governance-verdict.ts:63-64` inline enums to registry-validated strings; repoint the remaining `config.clinicType` reads to `resolveRegulatoryProfile(config).clinicType`; collapse `whatsapp-registry.ts:3` `Jurisdiction` to a documented `MarketId` subset; add a grep-clean CI gate over the ~38 inline-literal files. Revertible (the DB is `String` at rest; removal is dead-code deletion).
- **Operator set-market intent re-expression (Q5, back-compat window):** `set-market-in-config.ts:34-39` `GovernanceSetMarketParametersSchema`, the `governance-set-market`/`governance-get-market` routes, the operator-intent handler, and `prisma-governance-market-writer.ts` accept `market`/`regulatoryProfileId` with a deprecation window still accepting old `jurisdiction`/`clinicType` field names. Operator surface, not the stranger dollar path.
- **`phone.ts` / `normalizeToE164` region widening** (per-contact market derivation from phone code): only needed when a real non-SG/MY market is authored.
- **Any new vetted regulatory profile CONTENT + authoring:** cut by the rescope (curated registry, no authoring surface) until customer demand justifies a platform-authored profile.

## 9. Open questions (RESOLVED per one-product-many-doors Section 8)

1. Sequencing vs the floor: **L1 after the floor** (done; floor merged, L1 generalizes it).
2. Registry home: **both registries in `packages/schemas`**, promote `Vertical` (S2-2).
3. Profile vs market: **two orthogonal keys, two registries**.
4. Widen `SupportedCurrency`: **defer** (kept `"SGD"|"MYR"`; `currencyForMarket` fail-closes unknown to null).
5. Operator set-market: **re-express with a back-compat window** (deferred to Section 8, design recorded).

One scoping decision is owner-confirmable at review (Section 3): whether the final union-removal PR is part of S2 or the deferred tail. This plan defers it (additive-minimal, dollar-path); the additive slices are a strict prefix, so appending the removal later is zero-rework.

## 10. Non-goals

Everything in Section 8; the fitness/any pack content; self-serve billing; T&S/KYC; opening a real third MARKET (new currency/timezone/phone-code/loader tables); the `reference-metadata`/`phone` vocabulary reconciliation beyond the PDPA decouple. Those consume L1; they are not L1.
