# L1 Open-`regulatoryProfileId` Refactor: Staged PR Series (DRAFT)

> **Status: DRAFT, pending owner decisions.** A decomposition spec, not an
> implementation manual. It resolves the blast radius, the compat-shim
> mechanism, and the bounded PR series that opens Layer 1, but the Open
> Questions at the end must be confirmed before any implementation PR opens.
> No product/runtime code changes here.
>
> Authority: SURFACE-before-merge. Land this as a focused docs PR to `main`;
> do not merge until reviewed. This is the riskiest surface in the codebase
> (`packages/schemas/src/governance-config.ts` is the money chokepoint), so the
> decomposition is deliberately conservative and byte-identical-first.

## 1. Why (design intent)

USER DECISION 2026-07-01: full open self-serve, all verticals. Any service
business signs up and goes live, safe by construction via the universal
safe-harbor floor, with vertical packs as upgrades. That posture requires
Layer 1 to stop hard-coding the seed vertical's regulatory shape. Today
`GovernanceConfig` carries two **closed** unions, `JURISDICTIONS = ["SG","MY"]`
and `CLINIC_TYPES = ["medical","nonMedical"]`, and every money surface resolves
currency through a single `assertNever` switch (`currencyForJurisdiction`). Open
self-serve cannot ship while a new profile or market is a compile error.

This refactor replaces the closed `clinicType` + `JurisdictionSchema` /
`ClinicTypeSchema` unions with an **open `regulatoryProfileId` backed by a
VerticalPack registry** and an **open `market` backed by a Market registry**,
**behind a compat shim**, such that (a) the medspa golden-master stays
BYTE-IDENTICAL through every PR, and (b) a NON-MEDICAL (fitness) profile
coexists green, which is the proof the system is genuinely open.

Design intent hubs: `project_open_self_serve.md`,
`project_vertical_pack_extraction.md`, `project_b2b2c_pivot.md`. This spec is a
strict generalization of the safe-harbor floor spec (`#1383`,
`docs/superpowers/specs/2026-07-02-safe-harbor-floor.md`): the floor is L1's
DEFAULT profile (Section 6, and the floor spec's D5). L1 generalizes the floor's
primitives; it does not rewrite them.

## 2. Ground truth (verified against code, not memory)

**On `main`:** `packages/schemas/src/governance-config.ts` defines the two
closed unions (`JURISDICTIONS` L11, `CLINIC_TYPES` L15, `JurisdictionSchema`
L19, `ClinicTypeSchema` L20) and the single money chokepoint
`currencyForJurisdiction` (L242-253, `assertNever` at L248-250). `.passthrough()`
(L32) is the established extension seam for optional sub-blocks/markers
(`resolveConsentStateConfig`, `resolveRecoveryConfig`).

**Two dependency PRs, OPEN, design against their merged shape:**

- **#1380** (`feat/pack-slice3-provisioning`) adds
  `packages/db/src/seed/pack-governance-config.ts`:
  `selectPackGovernanceConfig({ vertical, market })` with a closed
  `ProvisioningVertical = "medspa"` and an exhaustive `switch (vertical)` +
  `assertNever`. `ProvisioningMarket = Jurisdiction` (imports the L1 union).
  Default medspa/SG returns `MEDSPA_PILOT_GOVERNANCE_CONFIG` **by reference**.
- **#1381** (`feat/pack-slice2-loader-rekey`) adds
  `packages/core/src/vertical.ts`:
  `Vertical = "medspa" | "dental" | "fitness" | "generic"`,
  `DEFAULT_VERTICAL = "medspa"` (a deliberately LOCAL core type, "NOT an L1
  schema union... until the VerticalPack registry lands"). The banned-phrase /
  escalation loaders re-key on `(vertical, jurisdiction)`; `jurisdiction` stays
  an inline `"SG"|"MY"` first positional param.

**Safe-harbor floor (#1383), OPEN, the direct predecessor:** builds
`resolveVertical(config)` (fail-safe to `DEFAULT_VERTICAL`),
`buildSafeHarborFloorConfig`, the `generic` loader tables, the fail-closed
loader merge (SH-1), the load-time floor-manifest assertion, the `generic`
`selectPackGovernanceConfig` case (SH-4), and the `governanceSeedContext`
precedence reconciliation (SH-4). L1 consumes all of these.

**The golden merge gate (`evals/skill-prompt-golden/`):** renders ONLY the
medspa system PROMPT: `render.ts` runs
`loadSkill("alex") -> resolveParameters(skill, fixture) -> buildSystemPrompt`.
`fixtures.ts` varies persona/businessFacts/playbook/locale (SG/MY x facts). It is
model-free and DB-free. Verified by grep: `buildSystemPrompt` (`system-prompt.ts`),
`skill-executor.ts`, and `builders/` reference **none** of `clinicType`,
`jurisdiction`, `currencyFor*`, `SupportedCurrency`, or `regulatoryProfileId`. So
the golden does not execute `GovernanceConfig`, the currency function, the
loaders, the registry, or the provisioning selector. This non-participation is
the spine of the byte-identical argument (Section 5).

## 3. Blast-radius inventory (the load-bearing part)

98 distinct source files (excluding docs/dist/tests) reference
`clinicType` / `jurisdiction` / the schemas or currency symbols, split
core 47, apps/api 21, db 13, schemas 9, apps/dashboard 7, apps/chat 1. Grouped
by role below. Two facts shrink the risk dramatically:

- **Only two type-level exhaustive chokepoints exist over these unions:**
  `currencyForJurisdiction` (schemas, on `main`) and `selectPackGovernanceConfig`
  (db, arriving with #1380). `clinicType` is **never** exhaustively switched
  anywhere; it is only carried as data. (The one other `switch (vertical)`,
  `apps/api/src/routes/scheduled-reports.ts:177`, is unrelated: `vertical` there
  is already `z.string().default("commerce")` mapping report types to legacy
  cartridge ids, with a safe `default`. Out of scope, and a precedent that
  open-string + fail-safe-default already lives in this codebase.)
- **The database is already open at rest.** `schema.prisma` stores
  `jurisdiction String` / `clinicType String` (L1175-1176 `GovernanceVerdict`;
  L1196 `ApprovedComplianceClaim`, indexed L1208; L2278 nullable). The closed
  unions live ONLY in the TS/Zod layer. Opening them needs **no destructive DB
  migration**; old SG/MY rows still parse when the Zod validator widens.

### Group A: closed-union definitions (schemas, Layer 1) - the source

| Symbol | Site |
| --- | --- |
| `JURISDICTIONS`, `Jurisdiction` | `governance-config.ts:11-12` |
| `CLINIC_TYPES`, `ClinicType` | `governance-config.ts:15-16` |
| `JurisdictionSchema`, `ClinicTypeSchema` | `governance-config.ts:19-20` |
| `GovernanceConfigSchema.{jurisdiction,clinicType}` | `governance-config.ts:24-25` |
| `ObserveGovernanceConfigInput` | `governance-config.ts:221-224` |
| `SupportedCurrency = "SGD"\|"MYR"` | `governance-config.ts:227` |
| **`currencyForJurisdiction` (assertNever chokepoint #1)** | `governance-config.ts:242-253` (switch 243-252, `never` 249) |
| `ObserveGovernanceConfig` literal type | `governance-config.ts:257-272` (fields 258-259) |
| `buildObserveGovernanceConfig` | `governance-config.ts:283-302` |
| `setMarketInConfig` + `GovernanceSetMarketParametersSchema` (operator intent params) | `set-market-in-config.ts:20-31, 34-39` (imports 3-8) |

### Group B: parallel / adjacent closed unions (schemas) - coupled, not the primary target

| Symbol | Site | Relationship |
| --- | --- | --- |
| `PdpaJurisdictionSchema = z.enum(["SG","MY"])`, `PdpaJurisdiction` | `pdpa-consent.ts:3-4,20,67` | Per-contact PDPA regime. **Cast-coupled** to the org `jurisdiction` (Group C casts). A real legal-regime enum; L1 keeps it closed but DECOUPLES it (Section 4.4). |
| Inline `jurisdiction: z.enum(["SG","MY"])`, `clinicType: z.enum(["medical","nonMedical"])` | `governance-verdict.ts:63-64` | DB-persisted audit event (Prisma `String` cols). Widen the Zod validator; back-compatible with stored rows. |
| 4-value `jurisdiction`/`vertical`/`clinicType` enums | `reference-metadata.ts:9-11` | Skill-reference frontmatter. Independent axis, **already** carries `fitness`/`generic`/`both`/`none`. L1 reconciles vocabulary; no behavior coupling. |
| `jurisdictionFromE164` (+65->SG, +60->MY), SG/MY phone normalization | `phone.ts:30,42,48,68,76-79` | Per-contact market derivation from phone country code. Opening markets beyond SG/MY needs more country codes; on the `PdpaJurisdiction` sub-axis. |
| Governance-config comment | `marketplace.ts:73` | Comment only. |

### Group C: type-import consumers of `Jurisdiction`/`ClinicType` (widen with the type)

| Layer | Sites |
| --- | --- |
| apps/api | `routes/governance-set-market.ts:14,93,97` (safeParse both); `routes/governance-get-market.ts:10,14-15`; `bootstrap/operator-intents/governance-set-market.ts:12-13,24-25`; `lib/ensure-alex-listing.ts:14,24`; `lib/alex-governance-seed-context.ts:13-18` (always returns `clinicType:"medical"`, never undefined) |
| apps/dashboard | `settings/governance/page.tsx:18-19,96`; `components/settings/governance-market.tsx:22,24,28,33,40-45,61,73,93`; `hooks/use-governance-gates.ts:8-9,67-70`; `lib/api-client/governance.ts:13-14,72-73,266-296` |
| packages/core | `notifications/proactive-eligibility.ts:8,25,30`; `skill-runtime/hooks/whatsapp-window-gate.ts:10,23,327-329,402-403`; `skill-runtime/templates/whatsapp-registry.ts:3` (**core-local dup** `Jurisdiction="SG"\|"MY"`), `:33,259,327` |
| packages/db | `stores/prisma-governance-market-writer.ts:5-6,16-17,55` |

### Group D: currency chokepoint consumers

| Symbol | Sites |
| --- | --- |
| `currencyForJurisdiction` | def `governance-config.ts:242`; **only runtime call site** `apps/api/src/bootstrap/resolve-currency.ts:20` (already fail-closed: returns `null` on unresolved config) |
| `SupportedCurrency` | `apps/api/src/bootstrap/deposit-link-wiring.ts:5,47`; `resolve-currency.ts:1,16-17`; `packages/core/src/skill-runtime/tools/calendar-book-types.ts:9,138`; `deposit-link.ts:9,39` |

### Group E: inline structural duplicates (compiler-INVISIBLE - the real hazard)

These hardcode the union rather than importing the type, so the compiler will
NOT flag them when the schema type widens. Each must be widened deliberately.

| Literal | Sites |
| --- | --- |
| `"medical" \| "nonMedical"` | `posture-cache.ts:6`; `consent/consent-service.ts:84`; `skill-runtime/hooks/claim-classifier.ts:90(cast),149,340,382,436`; `pdpa-consent-gate.ts:280`; `price-claim-gate.ts:116`; `whatsapp-window-gate.ts:24,329,403`; `governance-config.ts:223,259`; `governance-verdict.ts:64`; `reference-metadata.ts:11` |
| `"SG" \| "MY"` | `posture-cache.ts:5`; `whatsapp-registry.ts:3`; `governance-config.ts:258`; `governance-verdict.ts:63`; the loaders' `jurisdiction` param (`banned-phrases/loader.ts`, `escalation-triggers/loader.ts`, #1381) |
| reads `config.clinicType` as data (no widen, but re-point to derived value in Group-6 PR) | `consent-enforcement-gate.ts:51,72,88,116`; `consent-revocation-gate.ts:41,63,82`; `pre-input-gate.ts:94,119,286`; `deterministic-safety-gate.ts:127,152,256`; `pdpa-consent-gate.ts:62,81,118,158,176,230,261`; `price-claim-gate.ts:70,92,94,101,124,129`; `whatsapp-window-gate.ts:116,137,160,280,303,338,391,418`; `claim-classifier.ts:75,95,114,129,185,197,349,398,448`; `consent-service.ts:100,145` |

### Group F: DB persistence (already `String` at rest - Zod validator is the only closed gate)

`schema.prisma:1175-1176,1196,1208,2278`; `prisma-governance-verdict-store.ts:17,36,81`;
`prisma-governance-market-writer.ts:17,55`; `seed/medspa-governance-config.ts:12`;
`governance-verdict.ts:63-64` (the Zod enum that must widen).

### Group G: PDPA cast-coupling sites (unsound the moment org `jurisdiction` opens)

`config.jurisdiction as PdpaJurisdiction` treats the org market as the PDPA
regime. Once org `jurisdiction`/`market` is an open string, this cast silently
indexes PDPA tables with an unknown key (e.g. `REVOCATION_ACK["TH"]` ->
`undefined`). These MUST be re-routed through the Market registry (Section 4.4):

- `skill-runtime/hooks/pdpa-consent-gate.ts:101`
- `channel-gateway/consent-enforcement-gate.ts:105`
- `channel-gateway/consent-revocation-gate.ts:66,111`

### The two assertNever / exhaustive chokepoints (full list)

1. `currencyForJurisdiction` - `packages/schemas/src/governance-config.ts:248-250` (ON MAIN, the money chokepoint).
2. `selectPackGovernanceConfig` - `packages/db/src/seed/pack-governance-config.ts` (`switch (vertical)` + `assertNever`, ARRIVES with #1380).

Both become fail-closed registry lookups (Section 4.1, 4.2). No third exists over these unions.

## 4. Compat-shim design

The end-state replaces `clinicType` with an open `regulatoryProfileId: string`
backed by a **VerticalPack registry**, and opens `jurisdiction` into an open
`market: string` backed by a **Market registry**. Both registries live in
`packages/schemas` (Layer 1, no internal deps) so core, db, and apps consume one
source and the current core-local `Vertical` + `whatsapp-registry.Jurisdiction`
duplicates collapse into it (a Doctrine #11 improvement, not new drift).

The shim is the SAME additive pattern the codebase already uses for optional
config sub-blocks: **passthrough markers + a fail-closed resolver**, exactly as
the safe-harbor floor does for `vertical` via `resolveVertical`. The closed
unions are NOT edited mid-series; they are kept alive as the seed registry
entries and the legacy-field fallback, and are removed only in the final PR once
every consumer routes through the registry.

**Two open keys, both registry-validated, both fail-closed:**

- `regulatoryProfileId` generalizes the trio (`Vertical` core-local +
  `ProvisioningVertical` db + `ClinicType` schemas) into ONE open key. The
  VerticalPack entry declares the loader `vertical`, the `clinicType`-compat
  value that gate consumers read, and the observe-config factory.
- `market` generalizes `Jurisdiction`. The Market entry declares `currency`,
  `pdpaJurisdiction`, the loader jurisdiction, and timezone.

```
// packages/schemas/src/vertical-pack-registry.ts  (new, L1-2)
type RegulatoryProfileId = string;               // open, registry-validated
interface VerticalPack {
  id: RegulatoryProfileId;
  loaderVertical: Vertical;                       // promoted from core (#1381)
  clinicType: "medical" | "nonMedical";           // compat value gates read
  buildObservePosture: (market: MarketId) => ObserveGovernanceConfig;
  displayName: string;
}
// seeds: medspa {medspa, medical}, generic {generic, nonMedical}  = THE FLOOR,
//        fitness {fitness, nonMedical}
resolveRegulatoryProfile(idOrConfig): VerticalPack   // fail-closed (4.3)

// packages/schemas/src/market-registry.ts  (new, L1-1)
type MarketId = string;                          // open, registry-validated
interface Market {
  id: MarketId;
  currency: SupportedCurrency;
  pdpaJurisdiction: PdpaJurisdiction | null;      // null => no PDPA regime
  loaderJurisdiction: "SG" | "MY";                // maps to existing loader tables
  timezone: string;
}
// seeds: SG {SGD, SG, SG, Asia/Singapore}, MY {MYR, MY, MY, Asia/Kuala_Lumpur}
currencyForMarket(id): SupportedCurrency | null      // fail-closed (4.1)
resolveMarket(idOrConfig): Market | null
```

### 4.1 Chokepoint #1: `currencyForJurisdiction` (the money surface)

Migration story, explicit because this is the highest-liability chokepoint:

1. L1-1 introduces `currencyForMarket(id: MarketId): SupportedCurrency | null`,
   a Market-registry lookup. Seeded SG->SGD, MY->MYR. An **unregistered market
   returns `null`**, never a guessed currency. `SupportedCurrency` stays
   `"SGD"|"MYR"` (widening to more ISO-4217 codes is demand-pulled when a real
   third market lands, not on this critical path).
2. `currencyForJurisdiction(j: Jurisdiction)` is retained as a thin wrapper
   `=> currencyForMarket(j)` (non-null for SG/MY by construction) so no consumer
   breaks mid-series. A load-time parity test asserts
   `currencyForMarket(j) === currencyForJurisdiction(j)` for every `j` in
   `JURISDICTIONS` (byte-identical by construction).
3. L1-4 switches the ONE runtime call site
   (`resolve-currency.ts:20`) to
   `currencyForMarket(resolveMarket(config)?.id ?? config.jurisdiction)`. That
   function already turns `null` into a refusal (deposit) or a null currency
   stamp (calendar-book). So an unknown market fails closed to **no charge**,
   which is the safe direction the current `assertNever` protects, now without a
   throw on the hot path.
4. L1-8 removes `currencyForJurisdiction` and its `assertNever`; the registry
   lookup is the sole path.

Byte-identical: SG->SGD, MY->MYR are seeded; medspa (SG) resolves SGD
identically at every step.

### 4.2 Chokepoint #2: `selectPackGovernanceConfig` (provisioning)

The #1380 `switch (vertical)` + `assertNever` becomes a registry lookup
`resolveRegulatoryProfile(regulatoryProfileId).buildObservePosture(market)`,
whose **default branch is the floor profile** (`generic`). This is precisely the
safe-harbor SH-4 move; L1 generalizes it from a closed switch (one `medspa` case)
to an open registry (any profile, default floor). The `medspa`/`SG` path still
returns `MEDSPA_PILOT_GOVERNANCE_CONFIG` **by reference** (byte-identical). An
unregistered profile provisions the conservative floor, never a throw.

### 4.3 `resolveRegulatoryProfile` fail-closed policy (two-case default)

- **Absent marker** (legacy config, no `regulatoryProfileId`): resolve via the
  existing `resolveVertical(config)` (which already returns `medspa` when no
  `vertical` marker is present) -> the **medspa** profile. This is what keeps
  every existing org byte-identical.
- **Present but unregistered** id: resolve to the **`generic`/floor** profile
  (over-restrict; an unknown open profile is an untrusted stranger).
- **Present and registered**: that profile.

Both defaults are the safe direction, mirroring `resolveConsentStateConfig`'s
fail-safe coercion. `resolveMarket` is analogous: absent -> `config.jurisdiction`
(legacy), unknown -> `null` -> fail-closed currency/PDPA (no charge, no
proactive send).

### 4.4 The PDPA cast-coupling (Group G) - decouple, do not co-open

`config.jurisdiction as PdpaJurisdiction` (3 gate files) assumes org market ==
PDPA regime. Opening the org market makes the cast unsound. L1-4 replaces each
cast with `resolveMarket(config)?.pdpaJurisdiction`, which is `SG`/`MY` for the
seeded markets (byte-identical) and `null` for a market with no PDPA regime. The
consuming gates already fail closed on a null jurisdiction (no proactive send,
via `evaluateProactiveSendEligibility`), so the decoupling is safe.
`PdpaJurisdictionSchema` stays a closed enum (SG/MY PDPA are real, distinct legal
regimes); it is decoupled from the open org market, not opened.

### 4.5 The core-local duplicates - collapse, do not widen in place

`packages/core/src/skill-runtime/templates/whatsapp-registry.ts:3`
(`Jurisdiction = "SG"|"MY"`) is a legitimate SUBSET (markets where WhatsApp is
live, gated per-vertical by Meta review), not an accidental dup. L1-8 documents
it as `WhatsAppMarket subset-of MarketId` and keeps it closed; a market without
WA support yields no WA template (the `whatsapp-window-gate` already handles
that). The core-local `Vertical` (#1381) is promoted to schemas in L1-2 and
`resolveVertical` re-exported, so the loaders keep their existing call shape.

## 5. Byte-identical invariant

**Core argument (holds identically for every L1 PR):** the golden harness
renders only the medspa system PROMPT, assembled from skill markdown + persona +
businessFacts + playbook + locale + a pinned datetime (Section 2, verified). It
never executes `GovernanceConfig`, `currencyFor*`, the loaders, the registries,
the provisioning selector, or any gate. Therefore every L1 artifact
(config-shape markers, the two registries, `currencyForMarket`, the resolvers,
the selector rewrite, the seeder threading, and the gate reads) changes **zero
bytes the golden renders**. Every L1 PR is golden-green by NON-PARTICIPATION.

Medspa BEHAVIOR-equivalence (stronger than prompt-equivalence) is proven
per-PR by **targeted unit tests**, not the golden:

- `currencyForMarket("SG") === "SGD"`, `currencyForMarket("MY") === "MYR"`, and
  `=== currencyForJurisdiction(j)` for all `JURISDICTIONS` (L1-1).
- `resolveRegulatoryProfile(<legacy medspa config>)` yields
  `{ clinicType: "medical", loaderVertical: "medspa" }` (L1-2, L1-3).
- `selectPackGovernanceConfig({ vertical:"medspa", market:"SG" })` returns
  `MEDSPA_PILOT_GOVERNANCE_CONFIG` by reference (`toBe`, not `toEqual`) (L1-5).
- `loadBannedPhrases("SG","medspa")` / `("MY","medspa")` return the same set,
  order, and frozen instance as before (L1-6, inherited from #1381).

The only PRs that could move a rendered prompt edit `skills/alex/**` or the
persona/system-prompt machinery. L1 touches NONE (the persona floor block is
SH-5, already out of L1 scope). Per-PR one-line arguments appear in Section 7.

## 6. Fitness coexistence proof (the openness acceptance)

A minimal non-medical VerticalPack, registered ALONGSIDE medspa:

```
fitness: {
  id: "fitness",
  loaderVertical: "fitness",                 // #1381 Vertical already has it
  clinicType: "nonMedical",                  // compat value gates read
  buildObservePosture: (market) =>
    buildObserveGovernanceConfig({ jurisdiction: market, clinicType: "nonMedical" }),
  displayName: "Fitness / Wellness",
}
```

It resolves green without touching the medspa snapshot because every seam is
disjoint:

- **Loader:** `loaderVertical: "fitness"` is absent from the `_BY_VERTICAL`
  maps, so it resolves the `generic`/floor tables (post-SH-2) via the SH-1
  fail-closed length-aware fallback. It never reads or re-merges medspa's array,
  so the loader's id-uniqueness assert cannot trip for medspa.
- **Config:** `buildObservePosture` returns a fresh object, never the
  `MEDSPA_PILOT_GOVERNANCE_CONFIG` constant, so medspa's by-reference identity is
  untouched.
- **Currency:** fitness in SG resolves SGD from the seeded market (fitness does
  NOT require opening a new market, so the currency chokepoint stays SG/MY-only
  for this proof).
- **Golden:** renders medspa only; fitness has its own unit/eval fixtures.

L1-7 lands this as a provisioning + resolution test that boots a fitness org
green next to medspa, proving the system is genuinely open with zero medspa
snapshot movement. This is the acceptance criterion for the whole series.

## 7. The bounded PR series

Each PR is PR-sized, independently reviewable, golden-green (by
non-participation), and harness-guarded. The compat shim keeps the closed unions
authoritative for un-migrated consumers until L1-8, so any PR before the last
rolls back by a plain revert. Ordering dependency: **the safe-harbor floor
(#1383, SH-1..SH-5) lands first** (it builds `resolveVertical`, the floor config,
the generic tables, the fail-closed merge, the manifest assertion, and the
`generic` selector case + the `governanceSeedContext` reconciliation). L1
generalizes those; if the floor slips, L1-2/L1-5 must build `resolveVertical` and
own the precedence fix themselves.

| PR | Scope | Layer | Done-condition | Byte-identical because |
| --- | --- | --- | --- | --- |
| **L1-0** | Parity harness + merge-stop globs | schemas/evals/ci | Parity test asserts the seed registries reproduce `currencyForJurisdiction` for all `JURISDICTIONS` and medspa/`generic`/fitness profiles' `clinicType`+`loaderVertical`; merge-stop globs extend to `*registry*`/`*regulatory-profile*`/`*market-registry*` | No product code; guard only |
| **L1-1** | Market registry + `currencyForMarket` | schemas | `currencyForMarket("SG")==="SGD"`/`("MY")==="MYR"`; `currencyForJurisdiction` delegates; parity test green | Seeded SG/MY; wrapper preserves the old fn; no consumer change; golden non-participation |
| **L1-2** | VerticalPack registry + `resolveRegulatoryProfile` + promote `Vertical` to schemas | schemas | `resolveRegulatoryProfile(medspa)` -> `{medical, medspa}`; absent-marker config -> medspa; unknown id -> `generic` | Registry added, no consumer reads it yet; `resolveVertical` re-exported unchanged |
| **L1-3** | Optional `regulatoryProfileId?`/`market?` passthrough markers + `resolveMarket(config)` + config-level `resolveRegulatoryProfile(config)` | schemas | Existing config (no markers) resolves medspa + its `jurisdiction`; marker-present resolves the marker | Markers optional + passthrough (like `vertical`); legacy fallback identical |
| **L1-4** | Currency + PDPA-cast call sites route through the registry | core+api | `resolve-currency.ts` uses `currencyForMarket(resolveMarket(config))`; the 3 `as PdpaJurisdiction` casts use `resolveMarket(config)?.pdpaJurisdiction`; unknown market -> null -> refusal/no-send | SG/MY seeded -> same currency + same PDPA regime; golden non-participation |
| **L1-5** | Provisioning selector -> registry + precedence reconcile + onboarding threading | db+api | `selectPackGovernanceConfig` is a registry lookup (default=floor); `deriveAlexGovernanceSeedContext` routed through the registry (or ternary inverted) so a threaded profile is not shadowed; both seeders take `regulatoryProfileId`/`market` (default medspa/SG) | medspa/SG -> `MEDSPA_PILOT` by reference; default path unchanged |
| **L1-6** | Gate/consumer reads derive `clinicType` from the profile; widen the inline dups + posture cache | core (may split 6a gates / 6b consent / 6c whatsapp+classifier) | Every `config.clinicType` read and inline `"medical"\|"nonMedical"` becomes `resolveRegulatoryProfile(config).clinicType`; posture cache widened | medspa config -> profile `clinicType:"medical"`, identical value; golden non-participation |
| **L1-7** | Fitness coexistence proof | evals+db | A fitness org provisions + resolves green (floor tables, nonMedical, SGD) alongside medspa; medspa snapshots untouched | Disjoint seams (Section 6); medspa golden byte-identical |
| **L1-8** | FINAL: remove the closed unions | schemas + fan-out | Remove `JurisdictionSchema`/`ClinicTypeSchema`/`JURISDICTIONS`/`CLINIC_TYPES` + `currencyForJurisdiction` + its `assertNever`; widen config fields, `GovernanceSetMarketParametersSchema`, `governance-verdict` inline enums to registry-validated strings; collapse `whatsapp-registry.Jurisdiction` to a documented `MarketId` subset; grep-clean CI gate asserts no remaining consumer | Every consumer already routes through the registry (L1-1..L1-6); removal is dead-code deletion; golden non-participation |

**Split note (L1-6):** the 47 core consumers may exceed a comfortable single
review. Split by subsystem seam (gates / consent / whatsapp+classifier), each a
self-contained golden-green PR reading the derived value. Treat the series as
9-11 PRs.

## 8. Risks, rollback, and gates

- **Compiler-invisible inline dups (Group E).** Widening the schema type does
  NOT flag the hardcoded `"SG"|"MY"` / `"medical"|"nonMedical"` sites. Mitigation:
  L1-8's grep-clean CI gate enumerates the literals and fails if any remain
  outside the registry; L1-6 migrates them explicitly with the inventory as the
  checklist.
- **PDPA cast unsoundness (Group G).** The biggest silent-corruption risk:
  opening the org market before re-routing the casts would index PDPA tables with
  an unknown key. Mitigation: L1-4 does the cast re-route in the SAME PR that
  first lets a non-SG/MY market resolve; markets stay SG/MY-seeded until then.
- **assertNever removal ordering.** `currencyForJurisdiction`'s `assertNever` is
  the money guard. It is NOT removed until L1-8, after `currencyForMarket`'s
  fail-closed null path is the sole runtime path (L1-4) and proven. The
  fail-closed direction (unknown market -> no charge) is strictly safer than the
  current throw.
- **Provisioning precedence shadow (shared with SH-4).**
  `deriveAlexGovernanceSeedContext` always returns `clinicType:"medical"` and
  `organizations.ts:77` always passes it, so a threaded `regulatoryProfileId`
  would be silently dropped on the hot path. L1-5 reconciles it (route the
  derivation through the registry, or invert the ternary). If SH-4 landed first,
  L1-5 asserts the reconciliation rather than re-doing it.
- **Dependency on open PRs.** #1380, #1381, and the #1383 floor are the design
  baseline. Re-verify Section 2 against merged code before L1-0; if a seam
  changed shape, re-key the affected PR.
- **Rollback.** L1-0..L1-7 are additive; revert the single PR (legacy path still
  authoritative). L1-8 is the one non-additive PR; it is gated on the grep-clean
  check + full test + golden green, and its revert restores the unions (pure code
  re-addition, no data migration since the DB is already `String` at rest).
- **CI/eval gate per PR:** the golden
  (`pnpm exec vitest run --config evals/vitest.config.ts skill-prompt-golden`,
  medspa byte-identical) + the package's own unit tests + `pnpm typecheck` for
  every touched package (per the build-loop gotchas: pre-commit is
  eslint+prettier only). L1-6/L1-8 additionally run the affected app packages.

## 9. Open questions (owner to confirm)

1. **Sequencing vs. the safe-harbor floor.** Recommend L1 lands AFTER the floor
   (#1383) so L1 generalizes existing primitives rather than building
   `resolveVertical` + the precedence fix twice. **Recommendation: yes** (matches
   floor D5). If open self-serve needs a non-SG/MY MARKET before the floor is
   done, L1-1 (Market registry) can lead, since it is independent of the profile
   axis.
2. **Registry home.** Recommend both registries in `packages/schemas` (Layer 1),
   collapsing the core-local `Vertical` + `whatsapp-registry.Jurisdiction` dups
   into one source. **Recommendation: yes** (Doctrine #11 + layer rules). Confirm
   promoting `Vertical` to schemas is acceptable (the #1381 note explicitly
   anticipates it "when the VerticalPack registry lands").
3. **`regulatoryProfileId` vs. `market` as ONE key or TWO.** Recommend TWO
   orthogonal keys (profile drives boundaries/posture; market drives
   currency/PDPA/loader-jurisdiction), because a composite id explodes the space
   (medspa-sg, medspa-my, fitness-sg, ...) and couples currency to vertical.
   **Recommendation: two keys, two registries.**
4. **Widen `SupportedCurrency` now or later?** Recommend keeping it `"SGD"|"MYR"`
   through this series and widening to a branded ISO-4217 string only when a real
   third market is authored. **Recommendation: defer** (keeps the money type
   narrow; `currencyForMarket` already fail-closes unknown markets to null).
5. **`GovernanceSetMarketParametersSchema` (operator intent) shape.** The
   operator "set market" intent validates `jurisdiction` + `clinicType` today.
   Recommend L1-8 re-expresses it as `market` + `regulatoryProfileId`
   (registry-validated), with a back-compat accepting the old field names during
   a deprecation window. **Recommendation: yes, back-compat window.**

## 10. Non-goals

The fitness pack CONTENT (banned phrases, escalation patterns, persona copy),
self-serve billing, T&S/KYC, per-vertical WhatsApp template review, opening a
real third MARKET (new currency/timezone/phone-code/loader tables), and the
`reference-metadata`/`pdpa`/`phone` vocabulary reconciliation beyond decoupling
(Section 4.4). Those consume L1; they are not L1. The safe-harbor floor's own
content (SH-2/SH-5) is likewise out of scope; L1 assumes it as the default
profile.
