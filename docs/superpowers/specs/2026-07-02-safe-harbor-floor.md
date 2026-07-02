# Universal Safe-Harbor Floor (Design Spec)

> **Status: BASELINE (owner-approved 2026-07-02).** The three Open Questions in
> Section 6 are RESOLVED = yes: build the floor's primitives now on the current
> (pre-L1) config model (Q1), express them via the reused Slice-2 `generic`
> vertical loader seam + the existing claim-boundary gate (Q2), and go spec-first
> with the SH-1..SH-5 implementation series to follow (Q3). This doc is the design
> baseline the implementation PRs consume; it lives on `main`.
>
> Dependencies #1380 (pack selector) and #1381 (loader re-key + `Vertical` type)
> are now MERGED (Slices 3 and 2). Section 2 was written against their post-merge
> shape and re-verified against `main` before SH-1.

## 1. Why (design intent)

USER DECISION 2026-07-01: full open self-serve, all verticals; the governed
platform substrate IS the product. Every self-serve agent must be safe by
construction the moment it boots, **before any vertical pack applies**. The
mechanism for that is the **universal safe-harbor floor**: the conservative
default governance envelope every agent gets with no pack. A vertical pack is an
UPGRADE layered OVER the floor (it may unlock vetted `enforce` behavior); a pack
is NEVER a prerequisite to onboard.

The floor's CONTENT is already decided by the product owner and is out of scope
here. This spec designs the MECHANISM. The content is, verbatim from
`project_open_self_serve.md`:

- (a) **observe-mode by default**: watched, recommends, never autonomously
  acts/enforces;
- (b) **generic claim-boundaries**: never diagnose, never guarantee outcomes,
  no financial or legal advice, always disclose it is an AI, escalate to a human
  on regulated topics;
- (c) the **existing consent/PDPA gate**.

Design intent hubs: `project_open_self_serve.md`,
`project_vertical_pack_extraction.md`, `project_b2b2c_pivot.md`.

## 2. Ground truth (current code, and what it already gives us)

The floor assembles almost entirely from primitives that already exist. Two of
those primitives landed in **recently-merged** PRs (#1380, #1381); the floor's
implementation builds on them (see Dependencies).

**Governance config (`packages/schemas/src/governance-config.ts`, on `main`):**

- `buildObserveGovernanceConfig({ jurisdiction, clinicType })` (~L283) returns
  the canonical all-gates-observe posture: `deterministicGate`, `claimClassifier`,
  `consentState`, `whatsappWindow` all `mode: "observe"`, lifecycle tagging off.
- `resolveGovernanceMode(config)` (~L40) returns `deterministicGate.mode ?? "off"`.
- The schema is `.passthrough()` (~L32), so sub-blocks like `consentState` and a
  new `vertical` marker ride as JSON without a Prisma migration. This is the
  established extension pattern (`resolveConsentStateConfig`, `resolveRecoveryConfig`).
- `JURISDICTIONS = ["SG","MY"]` and `CLINIC_TYPES = ["medical","nonMedical"]` are
  **closed unions** (~L11, L15). `currencyForJurisdiction` (~L242) carries an
  `assertNever` chokepoint: these are the surfaces L1 opens, and the reason the
  pre-L1 floor is SG/MY-only.

**Provisioning selector (`packages/db/src/seed/pack-governance-config.ts`, PR #1380, MERGED):**

- `selectPackGovernanceConfig({ vertical, market })` is the single routing point
  both seeders (`provision-org-agents.ts` in db, `ensure-alex-listing.ts` in api)
  now consult instead of hardcoding `MEDSPA_PILOT_GOVERNANCE_CONFIG`.
- `ProvisioningVertical = "medspa"` (a closed union with an exhaustive `switch` +
  `assertNever`), default `medspa` / `SG`. The default returns the exact
  `MEDSPA_PILOT_GOVERNANCE_CONFIG` constant **by reference**, so every existing
  org is byte-identical.

**Re-keyed loaders (`packages/core/src/...`, PR #1381, MERGED):**

- `packages/core/src/vertical.ts`: `Vertical = "medspa" | "dental" | "fitness" |
  "generic"`, `DEFAULT_VERTICAL = "medspa"`. Deliberately a LOCAL core type, NOT
  an L1 schema union, so the seam stays additive and reversible until the L1
  VerticalPack registry lands.
- `loadBannedPhrases(jurisdiction, vertical = DEFAULT_VERTICAL)` and
  `loadEscalationTriggers(...)` merge
  `COMMON_..._BY_VERTICAL[vertical] ?? COMMON_...` + the jurisdiction table, cache
  keyed `` `${vertical}:${jurisdiction}` ``.
- The maps ship one entry today: `COMMON_BANNED_PHRASES_BY_VERTICAL = { medspa:
  COMMON_BANNED_PHRASES }`. **`generic` / `fitness` / `dental` are absent, so they
  fall through `??` to the medspa base tables today** (over-restrict; "safe
  direction until that vertical's pack lands"). So `generic` is presently a
  medspa clone, not a floor. Completing the floor means giving `generic` its own
  intended tables and closing the merge's fail-open hole.
- `decisions/urgency.ts`: `dollarCapForVertical(vertical)` = `DOLLAR_CAP_BY_VERTICAL[vertical]
  ?? DEFAULT_DOLLAR_CAP` (2000). Same per-vertical seam.

**The gates that consume the loaders (the "claim-boundary gate"):**

- Output / `afterSkill`: `DeterministicSafetyGateHook`
  (`packages/core/src/skill-runtime/hooks/deterministic-safety-gate.ts`). Dep
  type `bannedPhraseLoader: (jurisdiction: "SG"|"MY") => ...` (L51); call sites
  `bannedPhraseLoader(config.jurisdiction)` (L134) and
  `bannedPhraseLoader(posture.jurisdiction)` (L240, cached-enforce path). Posture
  cache remembers `{ mode, jurisdiction, clinicType }` (L124).
- Input: channel-gateway `pre-input-gate.ts`. `escalationTriggerLoader(governance.jurisdiction)`
  (L101) and `escalationTriggerLoader(posture.jurisdiction)` (L263).

**Prompt / persona splice (`composePackBody`, Slice 1, on `main`):**

- `packages/core/src/skill-runtime/pack-composer.ts:32` splices
  `<!-- @pack:<slot> -->` markers with the bytes of `<packDir>/<slot>.md`,
  **fail-closed** on orphan marker / missing file / malformed slot / empty file.
  Today the only pack block is `skills/alex/packs/medspa/safety-escalation.md`.

**Consent/PDPA gate (reused as-is):** `resolveConsentStateConfig`
(governance-config.ts), `deriveConsentStatus`, and
`evaluateProactiveSendEligibility`
(`packages/core/src/notifications/proactive-eligibility.ts`). Observe by default
via `buildObserveGovernanceConfig`. No change; the floor inherits it.

**The merge gate (`evals/skill-prompt-golden/`):** renders ONLY the medspa
system prompt: `loadSkill("alex")` -> `resolveParameters` -> `buildSystemPrompt`
across four `vertical: "medspa"` fixtures (SG/MY x facts present/absent). It is
model-free, DB-free, and **does not execute the governance config resolver, the
loaders, or the provisioning selector.** ZERO snapshot diff is the merge gate on
every pack slice.

### Dependencies

This spec is designed against the POST-#1380/#1381 code shape. Both PRs are now
MERGED (Slices 3 and 2 of the pack-extraction workstream). The floor's
implementation PRs build on #1380 (pack selector) and #1381 (loader re-key +
`Vertical` type); Section 2 was re-verified against the merged `main` shape
before SH-1.

## 3. The floor, as three reused seams

The floor is not a new subsystem. It is a specific configuration of three
seams that already exist:

| Floor content | Seam it rides | New code |
| --- | --- | --- |
| (a) observe-mode default | `buildObserveGovernanceConfig` + a floor config factory the selector returns | a `buildSafeHarborFloorConfig` wrapper + a `selectPackGovernanceConfig` floor case |
| (b) pattern-scannable claim-boundaries (guarantee / diagnose / superlative) + universal escalation triggers | the `generic` vertical tables in the re-keyed loaders, consumed by the existing deterministic + pre-input gates | `generic` loader tables + `resolveVertical(config)` + fail-closed merge + gate wiring |
| (b) affirmative / advice boundaries (disclose AI, no financial-legal advice, escalate on regulated topics) | the prompt/persona floor via `composePackBody` on the no-pack path | a `packs/<floor>/` safety block for self-serve skills |
| (c) consent/PDPA | `consentState` + `deriveConsentStatus` + `evaluateProactiveSendEligibility` | none (reused as-is) |

The split between the loader floor (pattern-scannable) and the prompt floor
(affirmative/advice) is load-bearing for the byte-identical invariant; see D2.

## 4. Design decisions

### D1. Where the floor lives, and how a self-serve agent boots into it (pre-L1)

Pre-L1, a self-serve agent is provisioned through the same two seeders as every
existing org, both of which now route through `selectPackGovernanceConfig`
(#1380). The floor is added as an explicit selector case:

1. Extend `ProvisioningVertical` from `"medspa"` to include the floor vertical
   (recommend `"generic"`). The exhaustive `switch` + `assertNever` forces a
   declared posture for it (a pack can never ship postureless).
2. Add a floor config factory `buildSafeHarborFloorConfig({ jurisdiction })` in
   `packages/schemas`, mirroring `buildObserveGovernanceConfig`'s single-source
   discipline. It returns `buildObserveGovernanceConfig({ jurisdiction,
   clinicType: "nonMedical" })` plus a passthrough marker `vertical: "generic"`.
   `nonMedical` is the less-medical-assuming pre-L1 placeholder for `clinicType`
   (fitness is explicitly `nonMedical`); the marker is what the gates read to
   thread the loader vertical.
3. The `selectPackGovernanceConfig` `"generic"` case returns
   `buildSafeHarborFloorConfig({ market })`. The `medspa` case and the
   `medspa`/`SG` default are UNCHANGED (still the `MEDSPA_PILOT_GOVERNANCE_CONFIG`
   constant by reference).
4. Add `resolveVertical(config): Vertical` in core, mirroring
   `resolveConsentStateConfig`: read `config.vertical`, `safeParse` against the
   `Vertical` union, **fail-safe to `DEFAULT_VERTICAL` (`medspa`)** on absence or
   corruption. Absence -> medspa is what makes existing configs byte-identical;
   corruption -> medspa is the over-restrictive (safe) direction.
5. The two gates thread `resolveVertical(config)` into the loaders (D3).

A self-serve onboarding that selects no vetted pack provisions
`vertical: "generic"` -> floor config -> `generic` loader tables + the no-pack
prompt block. An onboarding that selects the medspa pack is unchanged.

Pre-L1 scope limit: the closed `JURISDICTIONS` union + the
`currencyForJurisdiction` `assertNever` mean the pre-L1 floor supports SG/MY
markets only. Other markets are unlocked by L1 (D5), not by this floor work.
This is consistent with Q1 (build primitives now, L1 generalizes).

### D2. Why medspa stays BYTE-IDENTICAL on the golden harness

The invariant: applying the floor must produce ZERO diff on the four medspa
golden snapshots. It holds by **disjoint resolution paths**, because every floor
artifact lives on the `generic` / no-pack path, and medspa resolves the exact
same objects and files it resolves today:

- The golden harness renders only the medspa SKILL PROMPT. It never executes the
  governance config resolver, the banned-phrase/escalation loaders, or the
  provisioning selector. Therefore the loader-floor, config-factory, gate-wiring,
  and provisioning PRs change **zero bytes the harness renders**, so the golden is
  green by non-participation. (Those PRs prove "medspa behavior unchanged" with
  loader/gate/provisioning UNIT tests, not with the golden.)
- Medspa's loader resolution is untouched: it threads `vertical: "medspa"` (its
  config has no `vertical` marker -> `resolveVertical` -> `medspa`), reads
  `COMMON_BANNED_PHRASES_BY_VERTICAL["medspa"]` verbatim. We ADD a `generic` key;
  we never touch the `medspa` key or medspa's merged array.
- Medspa's provisioning is untouched: `selectPackGovernanceConfig` still returns
  `MEDSPA_PILOT_GOVERNANCE_CONFIG` by reference for `medspa`/`SG`.
- The ONLY PR that can touch a rendered prompt is the prompt-floor PR. Its floor
  block is authored under a distinct pack path (e.g. `packs/generic/` or a
  self-serve skill) that no medspa fixture references. The four fixtures all
  render `skills/alex/packs/medspa/safety-escalation.md` -> unchanged. Disjoint
  render paths -> the medspa snapshot cannot move.

One-line argument: *medspa resolves `vertical: "medspa"` on every seam (loader
table, observe config, pack block) verbatim; the floor is authored only on the
disjoint `generic`/no-pack path medspa never selects, and the golden renders the
medspa prompt, not the loaders or config, so the snapshot cannot move.*

### D3. Reuse the `generic` vertical seam + the existing claim-boundary gate, NOT a new primitive

Recommended, and justified against the code:

- The Slice-2 loaders ALREADY key on `(vertical, jurisdiction)` and the
  `Vertical` union ALREADY carries a `generic` member with a per-vertical
  `_BY_VERTICAL` table map. The floor is exactly "the tables `generic` resolves
  to." We are not inventing the seam; we are completing it (giving `generic` its
  own intended tables instead of the medspa fallback, and closing the merge
  hole).
- The consuming claim-boundary gate ALREADY exists: `DeterministicSafetyGateHook`
  (banned phrases, output) and `pre-input-gate` (escalation triggers, input).
  Threading `resolveVertical(config)` into their loader calls is a one-argument
  change at `deterministic-safety-gate.ts:134,240` and `pre-input-gate.ts:101,263`
  plus adding `vertical` to the posture-cache entry (`deterministic-safety-gate.ts:124`)
  so the cached-enforce path threads the same vertical.
- observe/enforce posture and the consent gate ALREADY exist in
  `governance-config.ts`.

A new governance primitive would duplicate the loader + gate machinery and add a
SECOND governance evaluation, violating Doctrine invariant #4 (governance runs
once) and #5 (deployment context resolved once at ingress). Reuse wins
decisively. The only genuinely new artifacts are: the `generic` loader tables
(content), `resolveVertical`, the merge hardening (D4), the floor config factory,
the two-call-site wiring, and the no-pack prompt block.

Boundary note: "disclose AI", "no financial/legal advice", and "escalate on
regulated topics" that are affirmative or not cleanly pattern-scannable ride the
**prompt floor** (`composePackBody` no-pack block), not the loader. This keeps
the loader floor a strict SUBSET of what medspa already bans (D4), which is what
lets the fail-closed invariant hold without perturbing medspa.

### D4. Upgrade semantics: packs layer OVER the floor, fail-CLOSED

Invariant: a pack may ADD boundaries; a pack may NEVER remove a floor safety
boundary. Two hazards, both addressed:

**Hazard 1: the empty-array fail-OPEN trap** (flagged in the #1381 review and in
`project_vertical_pack_extraction.md`). `_BY_VERTICAL[v] ?? FLOOR` only falls
back on `undefined`. If a future pack registers `_BY_VERTICAL["fitness"] = []`,
then `[] ?? FLOOR` is `[]` (empty is not nullish) and the floor is DROPPED, so
fitness would run with no banned phrases / no escalation triggers.

The note's suggested fix `[...(byV[v] ?? []), ...FLOOR]` closes the hole but is
**unsafe as written for medspa**: if `FLOOR` shares ids with the medspa table
(which it must, being a subset of medspa's entries), the concatenation contains
duplicate ids and the loader's existing id-uniqueness assertion THROWS for
medspa. So we do NOT concatenate the floor into the medspa array.

**Recommended mechanism: disjoint resolution + a length-aware fallback + a
load-time floor-manifest assertion:**

1. Resolve per vertical, never re-merging medspa's array:
   - a REGISTERED, non-empty pack table (e.g. `medspa`) resolves verbatim;
   - an ABSENT or EMPTY table (`fitness: []`, or an unregistered vertical)
     resolves to the `generic` floor tables, using a length check (`table.length > 0`),
     not `??`, so `[]` cannot yield the empty set. This is the fail-closed
     replacement for the `?? FLOOR` form.
2. Enforce "pack cannot remove a floor boundary" with a load-time assertion over
   a small explicit **floor manifest** (a set of required coverage: category +
   canonical probe, e.g. a guarantee probe, a diagnosis/medical-claim probe, a
   superlative probe, and the universal escalation categories). At load, assert
   every registered pack's merged table satisfies every manifest requirement,
   else THROW (fail-closed at build/preflight, the same posture as
   `composePackBody`). An empty pack table trivially fails the manifest, giving a
   second, independent guard against Hazard 1.

Acceptance criterion that keeps the recommendation byte-identical: the floor
manifest MUST be authored so **medspa passes the assertion with zero edits**
(medspa already bans guarantee / medical-claim / superlative and carries the
universal escalation categories). If a candidate floor requirement is not
already covered by medspa's loader tables (e.g. an explicit financial/legal
banned phrase), it does NOT go in the loader manifest; it rides the prompt floor
(D3). This is why the loader floor is a subset of medspa.

**Hazard 2: silent regression of current deployments.** #1381 makes an
unregistered vertical fall back to medspa; the floor changes that fallback to
`generic`. This regresses nothing, because every CURRENT deployment resolves
`medspa` (registered); only NEW self-serve (`generic`) deployments take the new
path.

Alternative considered (structural union, `dedupeById([...pack, ...FLOOR])`):
makes the floor structurally un-droppable without an assertion, but requires the
floor's ids to be a strict subset of every pack's ids so dedupe collapses medspa
to its current set, which puts medspa's byte-identical guarantee at the mercy of
floor-authoring precision. Rejected as primary: the disjoint form never touches
medspa's array at all, so a floor-authoring mistake can perturb `generic` but can
never move the medspa snapshot. Revisit the union form once the floor is proven a
strict id-subset of medspa.

### D5. The L1 seam, and the provisioning precedence trap

**How the floor becomes the universal default at L1 (generalize, not rewrite):**
L1 replaces the closed `clinicType` + `SG|MY` jurisdiction unions with an open
`regulatoryProfileId` + a VerticalPack registry, behind a compat shim. Because
the floor is already expressed pre-L1 as (i) the `generic` vertical in the
loaders and (ii) the floor config the selector returns, L1 generalizes by:

- making the floor the **default profile** the registry returns for any open
  `regulatoryProfileId` with no vetted pack (the `selectPackGovernanceConfig`
  exhaustive `switch` becomes a registry lookup whose default branch is the
  floor);
- mapping an open profile to a loader `vertical` (`generic` for unpacked
  profiles); the loader seam already keys on `vertical`, so no loader call-site
  change;
- keeping `resolveVertical`, the floor config factory, the fail-closed merge, and
  the manifest assertion in place unchanged.

So L1 swaps the closed union for the open registry while the floor primitives
stay put. Building them now (Q1) is what makes L1 a generalization rather than a
from-scratch design.

**Precedence trap to reconcile (from the #1380 review).** On the api hot path,
`ensure-alex-listing.ts` resolves
`opts.governanceSeedContext ? buildObserveGovernanceConfig(seedContext) :
selectPackGovernanceConfig({ vertical, market })`. Because
`organizations.ts:77` ALWAYS passes a truthy `governanceSeedContext`
(`deriveAlexGovernanceSeedContext` never returns undefined), the pack selector is
shadowed on the primary onboarding path and is reached in prod only via the
provision safety-net with default vertical/market. Consequence for the floor: a
self-serve `generic` agent onboarded via the api hot path would be **silently
stamped a medspa-shaped (`clinicType: "medical"`) observe config**, not the
floor. The floor's provisioning wiring MUST reconcile this precedence, either
route `deriveAlexGovernanceSeedContext` itself through the pack/floor selector,
or invert the ternary so a threaded vertical/profile wins. This is the same
reconciliation L1 already owns; do it in the floor's provisioning PR if the floor
ships before L1, and treat it as a shared prerequisite.

## 5. Proposed PR series

Each PR is PR-sized, independently reviewable, and green on both gates: the
golden harness (`evals/skill-prompt-golden`, medspa byte-identical) and the
package's own tests. Loader/config/provisioning PRs are golden-green by
non-participation (D2); the prompt-floor PR is golden-green by disjoint render.

| PR | Scope | Layer | Deliverable |
| --- | --- | --- | --- |
| SH-1 | Fail-closed loader merge | core | Close the empty-array `?? FLOOR` hole (length-aware fallback) + the floor-manifest superset assertion. No new content; medspa resolution unchanged. |
| SH-2 | `generic` floor tables + `resolveVertical` | core + schemas | Author `generic` banned-phrase + escalation tables (the loader floor subset) and `resolveVertical(config)`. `generic` now resolves the intended floor instead of the medspa fallback. |
| SH-3 | Thread vertical through the gates | core | `deterministic-safety-gate` + `pre-input-gate` pass `resolveVertical(config)` (and cache `vertical` in the posture entry) into the loaders. Floor deployments load the generic floor at runtime; medspa -> medspa. |
| SH-4 | Floor observe config + provisioning case | schemas + db + api | `buildSafeHarborFloorConfig`, `selectPackGovernanceConfig` `generic` case, extend `ProvisioningVertical`; reconcile the `governanceSeedContext` precedence (D5). Default medspa/SG unchanged. |
| SH-5 | Prompt floor (no-pack block) | skills + core | A no-pack safety block (`disclose AI` / `no financial-legal advice` / `escalate on regulated topics`) spliced via `composePackBody` for self-serve skills. Disjoint from the medspa block. |

Sequencing within the series: SH-1 first (the guard lands before any generic
content, so the seam is fail-closed even with no `generic` tables yet). SH-2 and
SH-3 are the loader floor. SH-4 is the provisioning boot path. SH-5 is the
persona floor and is the only one that renders a prompt.

Scope flag on SH-5: whether self-serve reuses the `alex` skill or a distinct
generic skill affects where the no-pack block lives. If self-serve ships a
separate skill, SH-5 authors that skill's floor block and is fully disjoint from
`alex`; if it reuses `alex`, SH-5 adds a no-pack render branch. Resolve during
SH-5 brainstorming, not here.

Out of the floor's scope (do NOT bundle): the L1 open-`regulatoryProfileId`
refactor (its own costed series), the fitness pack content, self-serve billing,
and T&S/KYC. The floor is the prerequisite envelope those land on top of.

## 6. Open questions (RESOLVED 2026-07-02)

**Q1. Sequencing.** Build the floor's primitives NOW on the current
(pre-L1) config model, applied to the `generic`/medspa-default selector; L1 later
generalizes them to the universal default.
**RESOLVED (owner, 2026-07-02): yes.** The primitives (generic loader tables, floor config
factory, `resolveVertical`, fail-closed merge, manifest assertion) are additive
and reversible on the current model, harness-guarded on every PR. L1 then swaps
the closed unions for the open registry with the floor already in place (D5), so
L1 is a generalization, not a rewrite. Pre-L1 scope is SG/MY-only, which is
acceptable for the first open-self-serve markets.

**Q2. Mechanism.** Express the floor's claim-boundaries via the `generic`
vertical loader seam + the existing claim-boundary gate (reuse Slice-2), not a
new governance primitive.
**RESOLVED (owner, 2026-07-02): yes.** The `(vertical, jurisdiction)` loaders, the `generic`
member, and the deterministic + pre-input gates already exist; the floor
completes that seam. A new primitive would duplicate the machinery and add a
second governance pass, violating Doctrine #4/#5 (D3). Affirmative boundaries
that are not pattern-scannable ride the reused `composePackBody` prompt floor.

**Q3. Output.** Spec-first (this PR), implement after review.
**RESOLVED (owner, 2026-07-02): yes.** The mechanism has real fail-closed and byte-identical
hazards (the empty-array trap, the id-uniqueness assertion interaction, the
provisioning precedence shadow) that are cheaper to settle in review than in
code. Land this spec, confirm Q1/Q2, then open SH-1.

## 7. Key risks

- **Empty-array fail-open** (`_BY_VERTICAL[v] ?? FLOOR`): a pack registering `[]`
  drops the floor. Closed by SH-1 (length-aware fallback + manifest assertion).
- **Byte-identical fragility**: any change that unions floor entries INTO the
  medspa array (the naive `[...pack, ...FLOOR]`, or a structural union with
  non-shared ids) risks the medspa id-uniqueness assert or snapshot. Mitigated by
  disjoint resolution (medspa's array is never re-merged) + the acceptance
  criterion that medspa passes the manifest unchanged.
- **Provisioning precedence shadow**: `governanceSeedContext` shadows the pack
  selector on the api hot path, so a `generic` agent could be silently stamped a
  medspa-medical config. Must be reconciled in SH-4 (shared prerequisite with L1).
- **Pre-L1 market limit**: the closed jurisdiction union + `currencyForJurisdiction`
  `assertNever` restrict the pre-L1 floor to SG/MY. Other markets await L1.
- **Prompt-floor skill coupling**: the no-pack block's home depends on whether
  self-serve reuses `alex`; resolve in SH-5, keep disjoint from the medspa block.
- **Dependency on merged PRs**: #1380 and #1381 (now merged) are the design
  baseline; Section 2 was re-verified against merged `main` before SH-1.

## 8. Non-goals

Floor CONTENT (the exact banned phrases, escalation patterns, manifest probes,
and persona copy), decided by the owner, authored in SH-2/SH-5 against the
mechanism here. The L1 refactor, fitness pack, billing, and T&S/KYC are separate
initiatives that consume the floor.
