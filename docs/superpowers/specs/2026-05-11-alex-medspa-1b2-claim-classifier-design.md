# Alex SG/MY Medspa — Phase 1b-2: Claim Classifier & Substantiation Tiers

**Date:** 2026-05-11
**Status:** Draft (post-brainstorm, pre-plan)
**Parent spec:** `docs/superpowers/specs/2026-05-10-alex-medspa-sg-my-design.md` (§3.1 Layer 2 + Layer 3, §3.4, Phasing 1b-2 row, Operability)
**Builds on:** Phase 1a (`docs/superpowers/plans/2026-05-10-alex-medspa-phase-1a.md`, PR #409) and Phase 1b-1 (`docs/superpowers/specs/2026-05-10-alex-medspa-1b1-deterministic-gate-design.md`). Both must be on the working branch before 1b-2 implementation begins. Spec and plan can be authored against 1a/1b-1 as references without either being merged.

## Problem

Phase 1b-1 ships the deterministic safety net — banned-phrase tables and escalation triggers run before model output reaches the user. That layer catches obvious violations (`"100% guaranteed"`, `"cures acne"`) but is intentionally blind to subtler claims that survive the substring/regex pass. An efficacy statement like *"Most clients see visible slimming after one session"* contains no banned word; under 1b-1 alone it emits unchallenged.

In SG/MY medical aesthetic contexts, that kind of unsubstantiated efficacy or comparative claim is exactly what triggers HSA/MAB/MOH advertising violations. Operator-typed content is not, by itself, a sufficient substantiation source for regulated claims: an operator may type *"visible slimming after one session"* into a service description, but Alex repeating it is the regulatory event.

Phase 1b-2 ships the semantic layer that sits on top of 1b-1's deterministic gate:

- **Layer 2 — claim classifier.** Lightweight cheap-model (Haiku 4.5) call that classifies each sentence that survived Layer 1 into a small enum of claim types.
- **Layer 3 — substantiation requirement.** Per claim type, look up a matching source from one of three tiers (`operator_business_fact` / `approved_compliance_claim` / `regulatory_public_source`). If a required source is missing, rewrite the sentence to a non-claim template or escalate, per claim type.
- **Latency fallback.** If classification can't complete in time, fall back to `block + escalate` — never silently emit.
- **Rewrite as fat-data.** Per-`(claimType, jurisdiction)` rewrite templates live in TS modules, mirroring the 1b-1 banned-phrase pattern. No second model call for rewriting.
- **Audit completeness.** Every classifier verdict stamps `promptVersion`, `promptHash`, `model`, `claimType`, `jurisdiction`, and `classifierSchemaVersion` into `GovernanceVerdict.details` so a future regression is traceable to a specific prompt and model version.

## Scope

**In scope (Phase 1b-2):**

1. **New `ClaimClassifierHook`** registered in the skill-runtime hook chain immediately after `DeterministicSafetyGateHook`. Composes — does not extend — the 1b-1 hook.
2. **Classifier prompt artifact** — versioned TS module with system prompt, claim-type enum, structured-output schema, and a stable `promptVersion`/`promptHash` exported alongside.
3. **Per-sentence classification** via the 1b-1 sentence splitter (extracted to a shared utility), parallel Anthropic calls within a per-turn latency budget (default 800 ms).
4. **Prompt caching** — system prompt + claim-type schema marked as the cache-eligible block on every classifier call.
5. **`ApprovedComplianceClaim` Prisma model + `ApprovedComplianceClaimStore`** — operator-authored compliance claims with named reviewer, `reviewedAt`, `jurisdiction`, optional `validUntil`, optional `serviceId`. Authored via seed/admin script in 1b-2; UI is Phase 2.
6. **`RegulatoryPublicSource` reference data** — TS-backed per-jurisdiction tables of approved devices, doctor-credential lookup paths, and clinic-licence registries. Cited curated constants, not live-fetched.
7. **Substantiation resolver** with per-claim-type tier dispatch, jurisdiction-filtered substring match, staleness check (180 days, mirroring 1a's reference-metadata window), and an in-memory LRU cache (keyed by `(claimText-hash, jurisdiction)`) for match results only.
8. **Rewrite template registry** — per-`(claimType, jurisdiction)` non-claim phrasing templates as TS modules with `id` and `notes`, same authoring contract as 1b-1 banned-phrase tables.
9. **`governanceConfig.claimClassifier` sub-block** — `{ mode: "off" | "observe" | "enforce", latencyBudgetMs: number, model: string }`. Lands on the existing `GovernanceConfigSchema` via `passthrough()` — no Prisma migration for the config column itself.
10. **`GovernanceVerdictReasonSchema` extensions** — `unsupported_claim_rewritten`, `unsupported_claim_escalated`, `claim_substantiation_stale`, `classifier_error` (new alongside existing `classifier_timeout`).
11. **Offline eval harness (`pnpm classifier-eval`)** — golden-set fixture runner that re-executes the classifier prompt across Haiku 4.5 and Sonnet 4.6 and reports cross-model disagreement. Soft CI gate, parallel to 1b-1's `pnpm reference-audit`.
12. **Test fixtures** — per-jurisdiction, per-claim-type positives + true-negatives; substantiation-tier resolution per claim type; latency-fallback behavior; LRU cache invariants; verdict-details stamping.

**Out of scope (deferred, do not bleed in):**

- **Phase 1c** — PDPA consent state machine, AI disclosure versioning, consent-gated outbound.
- **Phase 1d** — WhatsApp 24h window detection, template registration.
- **Phase 1b-1.5** — regulatory expansion of 1b-1 banned-phrase / escalation-trigger seed tables.
- **Phase 2** — operator UI for authoring `ApprovedComplianceClaim` rows. v1 authoring is seed or admin script.
- **Phase 3** — outcome tagging, pattern detection, recommendations surfacing of repeat classifier rewrites.
- **Cache-invalidation on `ApprovedComplianceClaim` upsert.** v1 LRU caches match results only; a non-match is *not* cached. New rows take effect on next lookup. Caching non-matches is a Phase 3 optimization.
- **Operator dashboard surface** for browsing `ApprovedComplianceClaim` or classifier verdicts. The stores exist; UI is Phase 2/3.
- **Embedding-based semantic match.** Substring match against jurisdiction-filtered `claimText` is the v1 strategy.
- **Model-generated rewrites.** Rewriting uses deterministic per-`(claimType, jurisdiction)` templates only. A second model call would add latency + cost + nondeterminism + a second failure mode.
- **Real "fetch live HSA registry" integration.** `RegulatoryPublicSource` is curated TS constants with `sources: string[]` citations.
- **Per-claim-type mode override.** `governanceConfig.claimClassifier.mode` is flat (off/observe/enforce for the whole hook). Per-claim-type promotion is a Phase 3 ergonomic.

## Architecture summary

One additional harness hook. Runs in the skill-runtime chain after the 1b-1 deterministic gate, before the trace-persistence hook.

```
                  ┌────────────────────────────────────────────────────────┐
inbound ──────────►│ channel-gateway: pre-input escalation-trigger gate   │ (1b-1)
                  │   └─ PlatformIngress.submit() ──► skill runtime      │
                  └────────────────────────────────────────────────────────┘
                                                                 │
                                                                 ▼
                  ┌────────────────────────────────────────────────────────┐
                  │ skill runtime: SkillExecutorImpl                     │
                  │   ├─ skill.execute(...)                              │
                  │   ├─ DeterministicSafetyGateHook.afterSkill          │ (1b-1)
                  │   │     match? → block + handoff                     │
                  │   ├─ ClaimClassifierHook.afterSkill                  │ ← NEW (1b-2)
                  │   │     split sentences (post-1b-1 output)           │
                  │   │     parallel classify (Haiku 4.5, prompt-cached) │
                  │   │     ├─ none → allow                              │
                  │   │     ├─ rewriteable → swap sentence with template │
                  │   │     ├─ escalate-class → block + handoff          │
                  │   │     └─ timeout/error → block + handoff           │
                  │   └─ TracePersistenceHook.afterSkill                 │
                  └────────────────────────────────────────────────────────┘
                                                                 │
                                                                 ▼
                                                            replySink.send()
```

The 1b-1 deterministic gate runs first so obvious banned content never reaches the classifier — saves model latency and keeps the classifier's input distribution closer to the borderline cases it was prompted for. Trace receives the post-classifier output; pre-rewrite original sentences are captured in `GovernanceVerdict.originalText` and `details.originalSentence`.

## Design decisions

| Decision | Choice | Rationale |
|---|---|---|
| Hook placement | New `ClaimClassifierHook`, registered after `DeterministicSafetyGateHook` and before `TracePersistenceHook` | Single-responsibility: deterministic table-matching and probabilistic classification are separable concerns with different blame surfaces. Independent feature-flag, independent verdict-stamping, independent rollout. Layer 1 short-circuit saves classifier latency on obvious blocks. |
| Classification granularity | Per-sentence (reusing 1b-1's sentence splitter, extracted to shared util) | Tight blast radius: one unsupported claim is rewritten without tainting the rest of the message. Multiple sentences = parallel calls within one turn budget. |
| Cheap model | Haiku 4.5 (`claude-haiku-4-5-20251001`) with prompt caching | Cheapest, fastest, sufficient for sentence-level classification. System prompt + claim-type schema is the cache-eligible block; per-turn input is the cache miss. 5-minute TTL amortizes cost across high-traffic conversations. Configurable per-deployment via `governanceConfig.claimClassifier.model` for future upgrade to Sonnet without code change. |
| Latency budget | Per-turn total (default 800 ms) with parallel `Promise.allSettled` calls; budget exhaustion mid-turn → remaining sentences fall back to `block + escalate` with `reasonCode: "classifier_timeout"` | Long messages don't compound latency. Conservative on incompletion: the design must never silently emit. |
| Mode vocabulary | Reuse 1b-1's `off | observe | enforce` (`governanceConfig.claimClassifier.mode`) | One vocabulary for operators. `observe` persists verdicts with `action: "allow"` and `auditLevel: "warning"`; `enforce` rewrites/escalates with `auditLevel: "critical"`. Same posture-cache pattern as 1b-1 (shared instance). |
| Rewrite mechanism | Deterministic per-`(claimType, jurisdiction)` templates in a TS table | Mirrors 1b-1 banned-phrase fat-data pattern. Predictable, cheap, no second model call, auditable in PR review. Bland prose is acceptable — the rewrite IS the safe phrasing. |
| Substantiation match | Jurisdiction-filtered case-insensitive substring of stored `claimText` in the classified sentence, optional `serviceId` filter when surrounding context references a known service | Deterministic, debuggable, no embedding infra. Operators author conservative `claimText` that mirrors expected prose. Embedding fallback rejected for 1b-2 (Phase 3 if coverage is sparse). |
| Substantiation cache | In-memory LRU (bounded 5000 entries) keyed by `(sha256(claimText), jurisdiction)`, **match-only** (no non-match caching in 1b-2) | Per-process / per-instance trade-off mirrors 1b-1's `GovernancePostureCache`. Caching non-matches would require invalidation on `ApprovedComplianceClaim.upsert` — deferred. New approved claims take effect on the next lookup. |
| Claim-type enum (Layer 2 output) | `efficacy | safety-claim | superiority | urgency | testimonial | medical-advice | diagnosis | credentials | none` — extends parent spec by adding `credentials` | Parent spec's enum did not name a category for *"Dr. X is APC-licensed"* or *"this device is HSA-approved"*; `safety-claim` was the loose catch-all. Adding `credentials` lets Layer 3 dispatch credentials claims to `regulatory_public_source` cleanly. The other eight values match the parent spec verbatim. |
| New `GovernanceVerdictReason` entries | `unsupported_claim_rewritten`, `unsupported_claim_escalated`, `claim_substantiation_stale`, `classifier_error` (`classifier_timeout` already reserved in 1a) | Specific to 1b-2 classifier outcomes. Keeps 1b-1's generic `unsupported_claim` reserved for the deterministic banned-phrase case; classifier-driven outcomes get richer downstream analytics. `classifier_error` is distinct from `classifier_timeout` — the former is API failure, the latter is budget exhaustion. |
| Verdict detail stamping | Every classifier verdict carries `promptVersion`, `promptHash`, `model`, `claimType`, `jurisdiction`, `classifierSchemaVersion`, `originalSentence`, `rewrittenSentence?`, `matchedSourceId?`, `matchedSourceType?` in `GovernanceVerdict.details` | Audit completeness. A future regression ("why did the classifier flag this last Thursday?") is traceable to a specific prompt+model version. Eval harness consumes these fields to detect drift. |
| Source-of-truth split | Classifier prompt + claim-type enum + rewrite templates + regulatory tables are all TS modules under `packages/core/src/governance/classifier/`. Operator-facing prose in `skills/alex/references/regulatory/{sg,my}-rules.md` references the TS file paths. | Same as 1b-1: TS is the runtime data; markdown is documentation. Reference markdown can drift in tone; the enum, templates, and resolver behavior are what the hook enforces. |
| Substantiation staleness | `reviewedAt < now - 180 days` OR `validUntil < now` → treat as missing, action depends on claim type. Persist verdict with `reasonCode: "claim_substantiation_stale"` so the analytics distinguish "no source" from "stale source." | 180-day window mirrors 1a's reference-metadata staleness window for consistency. Stale ≠ missing for operator triage (stale = needs re-review; missing = needs authoring). |
| Eval harness | Offline `pnpm classifier-eval` runs the golden set across Haiku 4.5 + Sonnet 4.6, reports per-model accuracy and inter-model disagreement. Soft CI gate (warns, not blocks). Not a runtime cost. | Skillify philosophy: the classifier prompt is the artifact. Cross-model eval at test time catches drift; at runtime it's wasted latency. Soft gate keeps the seed evolve-able without blocking unrelated work. |
| Hook ordering | `DeterministicSafetyGateHook` → `ClaimClassifierHook` → `TracePersistenceHook` | Deterministic gate first (short-circuit obvious blocks; the classifier never sees them). Trace last (sees the post-classifier output; the verdict store is the canonical record of pre-rewrite content). The 1b-1 hook-ordering decision rules apply identically. |
| Posture-cache scoping | Each hook gets **its own** `GovernancePostureCache` instance (same type, separate state). Resolver is shared. | A shared single-instance cache would create a fail-closed bug: when hook A is in observe and hook B is in enforce, the last-write wins; on a later resolver-error, hook A would incorrectly fail-closed because the cache says enforce. Per-hook instances keep each gate's last-known mode independent. Both gates use the cache only for their own fail-closed decision. Resolver is still shared (one DB read per turn warms both gates' decisions on success). |

## Section 1 — Schema changes

### 1.1 Extend `GovernanceVerdictReasonSchema`

`packages/schemas/src/governance-verdict.ts`:

```ts
export const GovernanceVerdictReasonSchema = z.enum([
  "allowed",
  "banned_phrase",
  "unsupported_claim",
  "medical_safety_trigger",
  "sensitive_inbound",
  "compliance_concern",
  "governance_unavailable",
  "outside_whatsapp_window",
  "consent_missing",
  "classifier_timeout",
  "classifier_error",                // NEW (1b-2): Anthropic API failure (not timeout)
  "unsupported_claim_rewritten",     // NEW (1b-2): Layer 3 rewrote — claim sentence swapped for template
  "unsupported_claim_escalated",     // NEW (1b-2): Layer 3 escalated — claim type non-rewriteable or no template
  "claim_substantiation_stale",      // NEW (1b-2): source existed but reviewedAt > 180d or validUntil < now
]);
```

`unsupported_claim` (1b-1) stays reserved for the deterministic banned-phrase scanner's `superlative` / `guarantee` / `medical_claim` categories. 1b-2 classifier-driven outcomes use the new `unsupported_claim_*` reasons so analytics can separate deterministic from probabilistic enforcement.

### 1.2 Extend `GovernanceConfigSchema` (via `passthrough`)

`packages/schemas/src/governance-config.ts` — no file-level change. The 1b-1 schema's `.passthrough()` already accepts an arbitrary `claimClassifier` sub-block at runtime. 1b-2 defines a Zod refinement that callers use at the hook boundary:

```ts
// packages/schemas/src/governance-config.ts (additive)

export const ClaimClassifierConfigSchema = z
  .object({
    mode: GovernanceModeSchema.default("off"),
    latencyBudgetMs: z.number().int().positive().default(800),
    model: z.string().default("claude-haiku-4-5-20251001"),
  })
  .default({});

export type ClaimClassifierConfig = z.infer<typeof ClaimClassifierConfigSchema>;

/** Resolver helper — single source of truth for the classifier sub-block. */
export function resolveClaimClassifierConfig(
  config: GovernanceConfig | null,
): ClaimClassifierConfig {
  const raw = (config as unknown as Record<string, unknown> | null)?.claimClassifier;
  return ClaimClassifierConfigSchema.parse(raw ?? {});
}
```

`resolveClaimClassifierConfig(null)` returns `{ mode: "off", latencyBudgetMs: 800, model: "claude-haiku-4-5-20251001" }`. Hook treats `mode: "off"` as a pure pass-through (no scan, no verdict, no model call). No `DEFAULT_CLAIM_CLASSIFIER_CONFIG` constant is exported; use the resolver.

No Prisma migration for the config column itself — 1b-1 already established `governanceConfig Json?` on `AgentDeployment`. The `claimClassifier` sub-block lives inside that JSON.

### 1.3 New `ApprovedComplianceClaim` Prisma model

`packages/db/prisma/schema.prisma`:

```prisma
model ApprovedComplianceClaim {
  id            String   @id @default(cuid())
  deploymentId  String
  jurisdiction  String   // "SG" | "MY"
  claimType     String   // matches ClaimTypeSchema enum
  claimText     String   @db.Text   // operator-authored canonical claim text (substring-matched)
  reviewedBy    String   // free text — reviewer name + role
  reviewedAt    DateTime
  validUntil    DateTime?
  serviceId     String?  // optional scope to a specific Service
  notes         String?  @db.Text
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  deployment    AgentDeployment @relation(fields: [deploymentId], references: [id], onDelete: Cascade)
  service       Service?        @relation(fields: [serviceId], references: [id], onDelete: SetNull)

  @@index([deploymentId, jurisdiction, claimType])
  @@index([deploymentId, serviceId])
  @@index([deploymentId, validUntil])
}
```

Migration steps (use `prisma migrate diff --from-url --to-schema-datamodel --script` then `migrate deploy`, per the established TTY-free workflow):

1. `CREATE TABLE "ApprovedComplianceClaim"` with FKs to `AgentDeployment` and `Service`.

No data backfill. Existing deployments start with zero approved claims; the resolver returns "no source" for every claim until operators (or seeds) populate the table.

`pnpm db:check-drift` must pass before commit. If Postgres is unreachable in the spec author's environment, follow 1a's pattern: skip locally and document in the PR body.

### 1.4 `ClaimType` and classifier-output schemas

`packages/schemas/src/claim-classifier.ts` (new file):

```ts
import { z } from "zod";

export const ClaimTypeSchema = z.enum([
  "efficacy",
  "safety-claim",
  "superiority",
  "urgency",
  "testimonial",
  "medical-advice",
  "diagnosis",
  "credentials",      // NEW vs parent spec — Layer 3 dispatches to regulatory_public_source
  "none",
]);
export type ClaimType = z.infer<typeof ClaimTypeSchema>;

export const ClassifierSentenceResultSchema = z.object({
  sentence: z.string(),
  claimType: ClaimTypeSchema,
  confidence: z.number().min(0).max(1),
});
export type ClassifierSentenceResult = z.infer<typeof ClassifierSentenceResultSchema>;

export const CLASSIFIER_SCHEMA_VERSION = "1.0.0" as const;
```

`CLASSIFIER_SCHEMA_VERSION` is stamped into every verdict. A future change to the output shape bumps this string; the eval harness can flag historical fixtures that asserted against the old shape.

### 1.5 `SubstantiationSource` type

`packages/schemas/src/substantiation.ts` (new file):

```ts
export const SubstantiationSourceTypeSchema = z.enum([
  "operator_business_fact",
  "approved_compliance_claim",
  "regulatory_public_source",
]);
export type SubstantiationSourceType = z.infer<typeof SubstantiationSourceTypeSchema>;

export const SubstantiationResolutionSchema = z.object({
  status: z.enum(["matched", "stale", "missing"]),
  sourceType: SubstantiationSourceTypeSchema.optional(),
  sourceId: z.string().optional(),
  matchedText: z.string().optional(),
});
export type SubstantiationResolution = z.infer<typeof SubstantiationResolutionSchema>;
```

## Section 2 — Substantiation sources

### 2.1 Tier 1 — `operator_business_fact`

Reads from the existing `Service` model (1a-shipped `ServiceSchema` fields). Required for claim types that aren't actually claims in the regulated sense — they're facts (price, duration, availability, booking policy, address, hours).

**In 1b-2 specifically, no Layer 2 claim type dispatches to `operator_business_fact`.** The parent spec's enforcement matrix names price/duration/availability/booking as `operator_business_fact`-requiring categories, but those are *upstream skill concerns* — Alex's SKILL.md handles "if BusinessFacts.price is unset, escalate" before generating output. The Layer 2 classifier enum (`efficacy | safety-claim | superiority | urgency | testimonial | medical-advice | diagnosis | credentials | none`) does not contain a "price" claim type, so Tier 1 is reserved here for Phase 2+ extensions where the resolver might cross-check skill-generated prices against `Service.price`. 1b-2 wires the tier into the resolver enum but does not consume it.

### 2.2 Tier 2 — `approved_compliance_claim`

New Prisma model (Section 1.3). Operator-authored, jurisdiction-scoped, with named reviewer + `reviewedAt`. Substring-matched against the classifier-flagged sentence (case-insensitive). Optional `serviceId` narrows scope: if the surrounding skill output references a known `Service.id`, the resolver prefers a `serviceId`-scoped claim over a global one for the same `(jurisdiction, claimType)`.

**Authoring path in 1b-2:** seed file (`packages/db/prisma/seed-approved-compliance-claims.ts`) + a one-off admin script under `scripts/`. UI is Phase 2.

**Resolution policy:**

- For a sentence classified as `efficacy | safety-claim | superiority | urgency`, the resolver looks up rows where `deploymentId` matches the current deployment AND `jurisdiction` matches AND `claimType` matches AND `claimText` is a substring of the sentence (lowercased).
- `serviceId` filter applies only when the skill output's `serviceContext` (added in 1b-2; see Section 6.4) identifies a specific service. Without service context, the resolver matches global rows (where `serviceId IS NULL`).
- Staleness: if `validUntil` is set and `< now`, OR `reviewedAt < now - 180 days`, the resolution returns `{ status: "stale" }` and verdict `reasonCode: "claim_substantiation_stale"`. Stale claims are treated as missing for action selection (rewrite or escalate per claim type).

### 2.3 Tier 3 — `regulatory_public_source`

TS-backed reference data per jurisdiction. Used for `credentials` claim type and as a backstop for `safety-claim` when the operator hasn't authored an `approved_compliance_claim`.

```ts
// packages/core/src/governance/classifier/regulatory-sources/types.ts

export type RegulatoryPublicSourceCategory =
  | "approved_device"           // HSA / MDA device approvals
  | "approved_clinic_claim"     // MOH / KKM clinic-licensed claim language
  | "doctor_credential_path"    // SMC / MMC / APC / LCP lookup pattern
  | "named_certification";      // ISO, GMP, etc. — public certifications

export interface RegulatoryPublicSourceEntry {
  id: string;                   // stable, e.g., "hsa_thermage_flx_approval"
  category: RegulatoryPublicSourceCategory;
  patterns: ReadonlyArray<string | RegExp>;   // substrings / regexes matched against the sentence
  jurisdiction: "SG" | "MY";
  authority: string;            // "HSA" | "MDA" | "MOH" | "KKM" | "SMC" | "MMC" | etc.
  sources: ReadonlyArray<string>;             // URLs / doc references for the curator
  notes?: string;
}
```

**Authoring contract** mirrors 1b-1's banned-phrase pattern:

- Strings are case-insensitive substring matches.
- RegExps are normalized at loader boundary (always `i`, never `g`) — same `normalizeRegex` utility as 1b-1.
- `id` unique within the merged jurisdiction set; loader asserts at boot.
- `sources` is reviewer evidence, not parsed at runtime.

**Layout:**

```
packages/core/src/governance/classifier/regulatory-sources/
  types.ts
  sg.ts        // HSA approved devices, SG-licensed claim language, SMC credential lookup
  my.ts        // MDA approved devices, MY-licensed claim language, MMC + APC credential lookup
  loader.ts    // loadRegulatoryPublicSources(j: "SG" | "MY"): readonly RegulatoryPublicSourceEntry[]
  index.ts
```

**Initial content policy:** conservative seed (≥3 entries per category per jurisdiction), real baseline patterns any reasonable medspa-compliance reviewer would recognize. Not exhaustive. A Phase 1b-2.5 (or rolled into 1b-1.5) regulatory review expands later. The seed comments include a follow-up note naming the reviewer.

### 2.4 Enforcement matrix (Layer 3)

| Claim type (Layer 2) | Required source tier | If matched | If stale | If missing |
|---|---|---|---|---|
| `efficacy` | `approved_compliance_claim` | allow | rewrite + `claim_substantiation_stale` | rewrite + `unsupported_claim_rewritten` |
| `safety-claim` | `approved_compliance_claim` OR `regulatory_public_source` (either) | allow | rewrite + `claim_substantiation_stale` | rewrite + `unsupported_claim_rewritten` |
| `superiority` | `approved_compliance_claim` | allow | rewrite + `claim_substantiation_stale` | rewrite + `unsupported_claim_rewritten` |
| `urgency` | `approved_compliance_claim` (rare) | allow | rewrite + `claim_substantiation_stale` | rewrite + `unsupported_claim_rewritten` |
| `testimonial` | None — testimonials are not substantiatable in this regulatory frame | n/a | n/a | escalate + `unsupported_claim_escalated` |
| `medical-advice` | None — never auto-answer | n/a | n/a | escalate + `unsupported_claim_escalated` |
| `diagnosis` | None — never auto-answer | n/a | n/a | escalate + `unsupported_claim_escalated` |
| `credentials` | `regulatory_public_source` | allow | n/a (regulatory entries don't expire on the operator side) | escalate + `unsupported_claim_escalated` (rewriting credentials would be misleading) |
| `none` | n/a | allow | n/a | n/a |

Notes:

- `safety-claim` accepts either source tier: a doctor's named statement reviewed and stored as `approved_compliance_claim` *or* a public regulatory citation matching a `regulatory_public_source` entry. First match wins; preference order is `approved_compliance_claim` then `regulatory_public_source`.
- `credentials` does *not* dispatch to rewrite. A credentials claim ("Dr. X is APC-licensed") is either true and substantiatable via the public registry pattern, or it must be escalated — a non-claim rewrite would be misleading ("the doctor will introduce themselves during consultation" is acceptable but the original credential claim cannot be silently softened).
- `testimonial` is also caught by 1b-1's banned-phrase `testimonial` category for the obvious cases ("many clients say"). The classifier catches subtler testimonial shapes that didn't match the substring tables. Always escalates — there is no template that rewrites a testimonial into a non-testimonial.

## Section 3 — Classifier

### 3.1 Prompt artifact

`packages/core/src/governance/classifier/prompt.ts` (new file):

```ts
import { ClaimTypeSchema, CLASSIFIER_SCHEMA_VERSION } from "@switchboard/schemas";
import { createHash } from "node:crypto";

export const CLASSIFIER_PROMPT_VERSION = "claim-classifier@1.0.0" as const;

export const CLASSIFIER_SYSTEM_PROMPT = `You are a regulatory claim-type classifier for medical aesthetic and beauty spa marketing copy in Singapore and Malaysia.

Given a single sentence from an AI assistant's outbound message, classify it into exactly one of these claim types:
- efficacy: claims about treatment results, outcomes, or effectiveness
- safety-claim: claims about safety, side effects, recovery, suitability
- superiority: comparative or superlative claims about clinic, doctor, treatment, or device
- urgency: time-bounded scarcity or pressure
- testimonial: claims that reference what other clients have said, felt, or experienced
- medical-advice: recommendations for treatment, diagnosis, or care plans
- diagnosis: statements identifying or naming a medical condition the user has
- credentials: claims about doctor qualifications, device approvals, or clinic licensing
- none: neutral facts (booking logistics, address, hours), questions, or non-claim conversation

Respond with structured JSON only. No commentary.

The schema version is ${CLASSIFIER_SCHEMA_VERSION}. Confidence is a number in [0, 1].
`.trim();

export const CLASSIFIER_CLAIM_TYPE_SCHEMA_FOR_TOOL = ClaimTypeSchema.options;

/** Stable hash of the system prompt + claim-type schema. Stamped into every verdict. */
export const CLASSIFIER_PROMPT_HASH = createHash("sha256")
  .update(CLASSIFIER_SYSTEM_PROMPT)
  .update(JSON.stringify(CLASSIFIER_CLAIM_TYPE_SCHEMA_FOR_TOOL))
  .digest("hex")
  .slice(0, 16);
```

`CLASSIFIER_PROMPT_VERSION` is a human-readable version string maintained by the author. `CLASSIFIER_PROMPT_HASH` is a derived 16-char SHA256 prefix that catches version-string-without-content-change errors (or content-change-without-version-bump errors) at PR review.

A future prompt change bumps `CLASSIFIER_PROMPT_VERSION` to e.g. `claim-classifier@1.1.0`. The eval harness records `(promptVersion, promptHash)` against its golden-set fixture results so historical accuracy is replayable.

### 3.2 Structured-output call shape

Anthropic SDK tool use is the structured-output mechanism. `packages/core/src/governance/classifier/anthropic-classifier.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import {
  CLASSIFIER_SYSTEM_PROMPT,
  CLASSIFIER_PROMPT_VERSION,
  CLASSIFIER_PROMPT_HASH,
} from "./prompt.js";
import {
  ClassifierSentenceResultSchema,
  CLASSIFIER_SCHEMA_VERSION,
  type ClassifierSentenceResult,
  type ClaimType,
} from "@switchboard/schemas";

export interface ClassifierCallResult {
  result: ClassifierSentenceResult;
  promptVersion: string;
  promptHash: string;
  schemaVersion: string;
  model: string;
}

export interface AnthropicClaimClassifier {
  classify(input: {
    sentence: string;
    model: string;
    signal: AbortSignal;
  }): Promise<ClassifierCallResult>;
}

const CLASSIFIER_TOOL = {
  name: "classify_claim",
  description: "Classify a single sentence into one regulatory claim type.",
  input_schema: {
    type: "object" as const,
    properties: {
      claimType: {
        type: "string" as const,
        enum: [
          "efficacy",
          "safety-claim",
          "superiority",
          "urgency",
          "testimonial",
          "medical-advice",
          "diagnosis",
          "credentials",
          "none",
        ],
      },
      confidence: { type: "number" as const, minimum: 0, maximum: 1 },
    },
    required: ["claimType", "confidence"],
  },
};

export function createAnthropicClaimClassifier(
  client: Anthropic,
): AnthropicClaimClassifier {
  return {
    async classify({ sentence, model, signal }): Promise<ClassifierCallResult> {
      const response = await client.messages.create(
        {
          model,
          max_tokens: 256,
          system: [
            {
              type: "text",
              text: CLASSIFIER_SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          tools: [
            {
              ...CLASSIFIER_TOOL,
              cache_control: { type: "ephemeral" },
            },
          ],
          tool_choice: { type: "tool", name: "classify_claim" },
          messages: [{ role: "user", content: sentence }],
        },
        { signal },
      );

      const toolUse = response.content.find((b) => b.type === "tool_use");
      if (!toolUse || toolUse.type !== "tool_use" || toolUse.name !== "classify_claim") {
        throw new Error("Classifier response missing classify_claim tool use");
      }

      const parsed = ClassifierSentenceResultSchema.parse({
        sentence,
        claimType: (toolUse.input as { claimType: ClaimType }).claimType,
        confidence: (toolUse.input as { confidence: number }).confidence,
      });

      return {
        result: parsed,
        promptVersion: CLASSIFIER_PROMPT_VERSION,
        promptHash: CLASSIFIER_PROMPT_HASH,
        schemaVersion: CLASSIFIER_SCHEMA_VERSION,
        model,
      };
    },
  };
}
```

**Prompt caching:** both the system prompt and the tool definition carry `cache_control: { type: "ephemeral" }`. The 5-minute TTL amortizes cost across high-traffic conversations. On the cache miss path (first call after restart, or after 5 minutes idle), the cost is the standard Haiku 4.5 input rate; subsequent calls within the window pay the cache-hit rate.

`tool_choice: { type: "tool", name: "classify_claim" }` forces structured output — the model cannot return free-form text.

### 3.3 Sentence splitter

The 1b-1 sentence splitter (`packages/core/src/governance/scanner/escalation-trigger-scanner.ts` — the local `splitSentences` helper) is extracted to a shared utility:

```
packages/core/src/governance/text/sentence-splitter.ts   // NEW (1b-2)
  export function splitSentences(text: string): readonly string[];
```

1b-2 task imports it from both gates (1b-1's escalation-trigger scanner re-points its import, no behavior change) and the classifier hook. Extraction is mechanical; the 1b-1 test suite for the splitter migrates verbatim.

### 3.4 Per-turn budget and parallel calls

`packages/core/src/governance/classifier/run-classifier.ts`:

```ts
export interface RunClassifierInput {
  sentences: readonly string[];
  model: string;
  latencyBudgetMs: number;
  classifier: AnthropicClaimClassifier;
}

export type ClassifierOutcome =
  | { status: "classified"; result: ClassifierCallResult }
  | { status: "timeout"; sentence: string }
  | { status: "error"; sentence: string; error: Error };

export async function runClassifier(
  input: RunClassifierInput,
): Promise<readonly ClassifierOutcome[]>;
```

Implementation:

- A single `AbortController` is constructed with `setTimeout(() => abort(), latencyBudgetMs)`.
- All `sentences` are dispatched in parallel via `Promise.allSettled(sentences.map((s) => classifier.classify({ sentence: s, model, signal: ctrl.signal })))`.
- Settled results map to `ClassifierOutcome`:
  - Fulfilled → `{ status: "classified", result }`.
  - Rejected with `AbortError` → `{ status: "timeout", sentence }`.
  - Rejected with any other error → `{ status: "error", sentence, error }`.
- The hook receives the full array preserving input order.

Latency-fallback action selection happens at the hook layer (Section 6), not inside `runClassifier`. The runner is pure dispatch + outcome shaping.

### 3.5 Classifier-error vs classifier-timeout vs none

The three sentence-level outcomes the hook must handle distinctly:

| Outcome | What it means | Hook action (enforce) | Verdict reasonCode |
|---|---|---|---|
| `{ status: "classified", result: { claimType: "none" } }` | Classifier ran, returned `none` | allow sentence | (no verdict — clean pass) |
| `{ status: "classified", result: { claimType: <other> } }` | Layer 2 fired; Layer 3 runs next | per enforcement matrix | per enforcement matrix |
| `{ status: "timeout" }` | Budget exhausted before this sentence resolved | block whole message + escalate | `classifier_timeout` |
| `{ status: "error" }` | Anthropic API call failed (network, 5xx, schema-parse failure) | block whole message + escalate | `classifier_error` |

In `observe` mode all four outcomes persist a verdict with `action: "allow"` and `auditLevel: "warning"` (the timeout/error cases let the message through with logging — operator gets a signal without a block).

## Section 4 — Substantiation resolver

### 4.1 Interface

`packages/core/src/governance/classifier/substantiation-resolver.ts`:

```ts
export interface SubstantiationResolverInput {
  sentence: string;
  claimType: ClaimType;
  jurisdiction: "SG" | "MY";
  deploymentId: string;
  serviceContext: { serviceId: string } | null;
}

export interface SubstantiationResolver {
  resolve(input: SubstantiationResolverInput): Promise<SubstantiationResolution>;
}
```

`SubstantiationResolution` shape from Section 1.5: `{ status: "matched" | "stale" | "missing", sourceType?, sourceId?, matchedText? }`.

### 4.2 Dispatch table

```ts
const SOURCE_TIERS_BY_CLAIM_TYPE: Record<ClaimType, ReadonlyArray<SubstantiationSourceType>> = {
  efficacy:         ["approved_compliance_claim"],
  "safety-claim":   ["approved_compliance_claim", "regulatory_public_source"],
  superiority:      ["approved_compliance_claim"],
  urgency:          ["approved_compliance_claim"],
  testimonial:      [],   // never substantiatable
  "medical-advice": [],
  diagnosis:        [],
  credentials:      ["regulatory_public_source"],
  none:             [],   // never reached
};
```

The resolver walks the tier list in declared order; first `matched` or `stale` resolution wins. If all tiers return `missing`, final resolution is `{ status: "missing" }`.

### 4.3 `approved_compliance_claim` lookup

Repository pattern, interface in core / impl in db:

```ts
// packages/core/src/governance/classifier/approved-compliance-claim-store.ts

export interface ApprovedComplianceClaimQuery {
  deploymentId: string;
  jurisdiction: "SG" | "MY";
  claimType: ClaimType;
  serviceId?: string | null;
}

export interface ApprovedComplianceClaimRecord {
  id: string;
  deploymentId: string;
  jurisdiction: "SG" | "MY";
  claimType: ClaimType;
  claimText: string;
  reviewedBy: string;
  reviewedAt: string;
  validUntil: string | null;
  serviceId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovedComplianceClaimStore {
  list(query: ApprovedComplianceClaimQuery): Promise<ApprovedComplianceClaimRecord[]>;
}
```

Implementation in `packages/db/src/prisma-approved-compliance-claim-store.ts`. Querying logic:

1. If `query.serviceId` provided, fetch rows where `serviceId === query.serviceId OR serviceId === null` for the given `(deploymentId, jurisdiction, claimType)`. Service-scoped rows take precedence in the resolution loop.
2. Else, fetch rows where `serviceId IS NULL`.

The resolver iterates returned rows (service-scoped first, then global) and tests `lowercase(sentence).includes(lowercase(claim.claimText))`. First hit wins.

**Staleness check:** before returning `{ status: "matched" }`, evaluate `claim.validUntil < now` or `claim.reviewedAt < now - 180_DAYS`. If stale, return `{ status: "stale", sourceType, sourceId, matchedText }`. The hook treats stale as missing for action selection but with distinct `reasonCode: "claim_substantiation_stale"`.

### 4.4 `regulatory_public_source` lookup

In-memory pattern table loaded by `loadRegulatoryPublicSources(jurisdiction)` (Section 2.3). For each entry, run the same case-insensitive substring / normalized-regex check against the sentence. First hit returns `{ status: "matched", sourceType: "regulatory_public_source", sourceId: entry.id, matchedText: ... }`.

Regulatory public sources do not have a staleness concept in 1b-2 (they're curated TS, not operator-owned) — but the entries' `notes` may include a "reviewed-by-date" comment for the curator. Phase 1b-2.5 may add a runtime staleness field; out of scope here.

### 4.5 LRU cache

`packages/core/src/governance/classifier/substantiation-cache.ts`:

```ts
export interface SubstantiationCache {
  get(key: SubstantiationCacheKey): SubstantiationResolution | undefined;
  set(key: SubstantiationCacheKey, value: SubstantiationResolution): void;
}

export interface SubstantiationCacheKey {
  claimTextHash: string;     // sha256(lowercase(sentence)) — short prefix is sufficient
  jurisdiction: "SG" | "MY";
  claimType: ClaimType;
  deploymentId: string;
}

export interface InMemoryLRUOptions {
  maxEntries: number;        // default 5000
}

export function createInMemoryLRU(opts?: InMemoryLRUOptions): SubstantiationCache;
```

**Cache policy in 1b-2:**

- **Cache `matched` resolutions only.** Stale and missing are never cached.
- Key incorporates `deploymentId` so a multi-tenant deployment cannot serve another tenant's match.
- LRU eviction at `maxEntries` (default 5000) — bounded memory.
- Invalidation on `ApprovedComplianceClaim` upsert is **out of scope** in 1b-2. The cache stores only matches, so a new approved claim that *would* match an unseen sentence does not need invalidation (cache miss = re-resolve). A new approved claim that supersedes an existing match would require the cache entry's stored `sourceId` to be invalidated; for the v1 traffic envelope this is a known limitation. Documented in Open Questions.

### 4.6 Resolver implementation outline

```ts
export function createSubstantiationResolver(deps: {
  approvedClaimStore: ApprovedComplianceClaimStore;
  regulatoryLoader: (j: "SG" | "MY") => readonly RegulatoryPublicSourceEntry[];
  cache: SubstantiationCache;
  clock: () => Date;
}): SubstantiationResolver;
```

Flow:

1. Compute `cacheKey = { claimTextHash: sha256(lower(sentence)).slice(0, 32), jurisdiction, claimType, deploymentId }`.
2. `cached = cache.get(cacheKey)` → if present, return.
3. For each `sourceType` in `SOURCE_TIERS_BY_CLAIM_TYPE[claimType]`:
   - `approved_compliance_claim` → query store, iterate rows, substring-check, evaluate staleness, return first hit.
   - `regulatory_public_source` → load jurisdiction table, iterate entries, substring/regex-check, return first hit.
4. No tier matched → return `{ status: "missing" }`.
5. If final resolution is `{ status: "matched", ... }`, `cache.set(cacheKey, resolution)`.

## Section 5 — Rewrite templates

### 5.1 Types

`packages/core/src/governance/classifier/rewrite-templates/types.ts`:

```ts
export interface RewriteTemplateEntry {
  id: string;                  // stable, e.g., "efficacy_results_vary_sg"
  jurisdiction: "SG" | "MY";
  claimType: Extract<ClaimType, "efficacy" | "safety-claim" | "superiority" | "urgency">;
  template: string;            // verbatim replacement sentence
  notes?: string;
}
```

`claimType` is constrained at the type level to the four rewriteable types (`testimonial | medical-advice | diagnosis | credentials | none` are never rewritten — see enforcement matrix in Section 2.4).

### 5.2 Layout

```
packages/core/src/governance/classifier/rewrite-templates/
  types.ts
  sg.ts
  my.ts
  loader.ts        // loadRewriteTemplates(j: "SG" | "MY"): readonly RewriteTemplateEntry[]
  index.ts
```

Loader returns `Object.freeze([...entries])` and asserts unique `id` at boot.

### 5.3 Selection policy

The hook picks a template via `(jurisdiction, claimType)`. If multiple entries match (a future-proofing for tenant overrides), the first in declared order wins. If no entry matches, the hook escalates — a missing template is a definition-of-done failure, not a runtime fallback to silent emit.

### 5.4 Seed content (1b-2 conservative seed)

Minimum one template per `(claimType, jurisdiction)` for the four rewriteable claim types. Sample (SG):

| Claim type | Template |
|---|---|
| `efficacy` | "Results vary between individuals — the doctor will go through what's realistic for you during consultation." |
| `safety-claim` | "Suitability and side effects depend on your skin and health — please discuss with the doctor during consultation." |
| `superiority` | "We can share what makes our approach a fit for you — the doctor will walk through it during consultation." |
| `urgency` | "Let me know when works for you and I'll check availability with the team." |

MY variants follow the same shape with adjusted register. All eight (4 × 2) seed templates ship in the PR. Authors include a one-line `notes` field on each entry naming the regulatory frame the template avoids (e.g., `"HSA — avoids implied outcome guarantee"`).

## Section 6 — `ClaimClassifierHook`

### 6.1 Dependencies

`packages/core/src/skill-runtime/hooks/claim-classifier.ts`:

```ts
export interface ClaimClassifierHookDeps {
  governanceConfigResolver: GovernanceConfigResolver;
  postureCache: GovernancePostureCache;
  classifier: AnthropicClaimClassifier;
  substantiationResolver: SubstantiationResolver;
  rewriteLoader: (j: "SG" | "MY") => readonly RewriteTemplateEntry[];
  verdictStore: GovernanceVerdictStore;
  handoffStore: HandoffStore;
  conversationStore: ConversationStateStore;
  splitSentences: (text: string) => readonly string[];
  clock: () => Date;
}

export class ClaimClassifierHook implements SkillHook {
  constructor(deps: ClaimClassifierHookDeps);
  async afterSkill(ctx: AfterSkillContext): Promise<AfterSkillOutcome>;
}
```

Shares the `GovernanceConfigResolver` with the 1b-1 deterministic gate (one bootstrap-constructed instance — the resolver itself is stateless and a single DB read warms both gates' decisions). **The `GovernancePostureCache` is NOT shared** — see Decision table and Section 6.7. Each hook receives its own cache instance. Shares `verdictStore`, `handoffStore`, `conversationStore`. Adds `classifier`, `substantiationResolver`, `rewriteLoader`, `splitSentences`.

### 6.2 Service context (`AfterSkillContext` extension)

The substantiation resolver's `serviceContext` parameter requires the hook to know which `Service` (if any) the skill output references. 1a's `ServiceSchema` is already in place. 1b-2 extends `AfterSkillContext` with an optional `serviceContext: { serviceId: string } | null`.

**How `serviceContext` is populated:** the skill runtime is the owner. When the skill invokes a tool that operates on a known `Service` (e.g., `services.lookup`, `calendar-book`), the runtime threads the service id into the context. If no service-scoped tool was invoked this turn, `serviceContext` is `null` and the resolver uses global `serviceId IS NULL` rows only.

This is a small skill-runtime extension. The plan task that touches `skill-runtime/types.ts` adds the field as `serviceContext?: { serviceId: string } | null` and updates the executor to populate it from the last service-scoped tool call's parameters in the turn. Out of scope for 1b-2: cross-message service tracking (carrying `serviceContext` across multiple turns of the same conversation).

### 6.3 Flow

```ts
async afterSkill(ctx: AfterSkillContext): Promise<AfterSkillOutcome> {
  // Step 1 — config resolution
  const resolution = await this.deps.governanceConfigResolver(ctx.deploymentId);
  if (resolution.status === "missing") return passThrough(ctx);
  if (resolution.status === "error") return this.handleResolverError(ctx);

  const config = resolution.config;
  const classifierConfig = resolveClaimClassifierConfig(config);
  if (classifierConfig.mode === "off") return passThrough(ctx);

  this.deps.postureCache.remember(ctx.deploymentId, {
    mode: classifierConfig.mode,            // posture cache stores the deterministic-gate mode;
    jurisdiction: config.jurisdiction,      // see Section 6.7 for the cache-shape nuance
    clinicType: config.clinicType,
  });

  // Step 2 — sentence enumeration across all output messages
  const sentences = ctx.skillOutput.messages.flatMap((m) =>
    this.deps.splitSentences(m.text).map((s) => ({ messageIndex: m.index, sentence: s }))
  );
  if (sentences.length === 0) return passThrough(ctx);

  // Step 3 — parallel classification within latency budget
  const outcomes = await runClassifier({
    sentences: sentences.map((s) => s.sentence),
    model: classifierConfig.model,
    latencyBudgetMs: classifierConfig.latencyBudgetMs,
    classifier: this.deps.classifier,
  });

  // Step 4 — collate per-sentence actions
  const sentenceActions = await Promise.all(
    outcomes.map((outcome, i) =>
      this.decideSentenceAction({
        outcome,
        meta: sentences[i],
        config,
        ctx,
      })
    )
  );

  // Step 5 — apply actions (rewrite in place / block whole message / allow)
  // see Section 6.4
}
```

### 6.4 Per-sentence action decision

`decideSentenceAction` returns one of:

```ts
type SentenceAction =
  | { kind: "allow" }
  | { kind: "rewrite"; replacement: string; verdict: GovernanceVerdict; details: GovernanceVerdictDetails }
  | { kind: "escalate"; verdict: GovernanceVerdict; details: GovernanceVerdictDetails };
```

Decision logic:

1. **`outcome.status === "timeout"`** → `{ kind: "escalate", reasonCode: "classifier_timeout" }`.
2. **`outcome.status === "error"`** → `{ kind: "escalate", reasonCode: "classifier_error" }`.
3. **`outcome.result.claimType === "none"`** → `{ kind: "allow" }`.
4. **`outcome.result.claimType ∈ { testimonial, medical-advice, diagnosis }`** → `{ kind: "escalate", reasonCode: "unsupported_claim_escalated" }`. No Layer 3 lookup (matrix shows `Required source = None`).
5. **Otherwise** — invoke `substantiationResolver.resolve(...)`. Based on resolution:
   - `matched` → `{ kind: "allow" }`.
   - `stale` → if claim type is rewriteable, `{ kind: "rewrite", reasonCode: "claim_substantiation_stale" }`. If `credentials`, `{ kind: "escalate", reasonCode: "claim_substantiation_stale" }`.
   - `missing` → if `credentials`, escalate. Otherwise rewrite with `reasonCode: "unsupported_claim_rewritten"`.

For rewrite actions, the hook calls `rewriteLoader(config.jurisdiction)` and selects the entry matching `claimType`. If no entry exists, the hook escalates instead — a missing template is treated as a definition-of-done failure (logged via `console.error`, reasonCode falls back to `unsupported_claim_escalated`). This last branch must never fire in practice because Section 5.4 requires seed coverage for all four rewriteable types.

### 6.5 Verdict-detail stamping

Every classifier-driven verdict's `details` carries:

```ts
{
  promptVersion: "claim-classifier@1.0.0",
  promptHash: <16-char sha256 prefix>,
  schemaVersion: "1.0.0",
  model: "claude-haiku-4-5-20251001",
  claimType: <Layer 2 output>,
  confidence: <0..1>,
  originalSentence: <the classified sentence>,
  rewrittenSentence?: <only on rewrite>,
  matchedSourceId?: <only on matched / stale>,
  matchedSourceType?: "approved_compliance_claim" | "regulatory_public_source",
  matchedText?: <substring that matched, on matched / stale>,
}
```

Timeout / error verdicts omit `promptVersion`/`promptHash`/`model`/`claimType`/`confidence` — those fields are only meaningful when the call completed.

### 6.6 Whole-message vs sentence-level effects

A single message may contain a mix of `allow`, `rewrite`, and `escalate` outcomes. Policy:

- **Any `escalate`** → block the whole message (replace all messages with the 1b-1 handoff template, flip conversation to `human_override`, save handoff). One classifier verdict is persisted per escalating sentence; the handoff payload references the *first* escalating verdict's id.
- **All `allow` + any `rewrite`** → apply rewrites in place (sentence swap inside the original message text). No `human_override` flip. One verdict per rewrite.
- **All `allow`** → pass output through unchanged. No verdicts persisted.

**Why "any escalate → block whole message":** mirrors 1b-1's conservative policy. An escalation-class claim (medical advice, diagnosis, testimonial) anywhere in the output signals the model's reasoning is off, not just one sentence. Permissive partial-emission is reachable later if observability shows the policy is too aggressive.

### 6.7 Posture-cache scoping (per-hook)

The 1b-1 `GovernancePostureCache` interface is reused unchanged:

```ts
interface GovernancePostureCache {
  remember(deploymentId: string, posture: GovernancePosture): void;
  lastKnown(deploymentId: string): GovernancePosture | undefined;
}
```

Each hook receives its **own instance** of this cache, both constructed in `skill-mode.ts` bootstrap. The implementation is `InMemoryGovernancePostureCache` (1b-1's existing `Map`-backed impl); a second instance is a one-line construction.

**Why per-hook, not shared:** if both hooks shared one cache, hook A (observe) writing after hook B (enforce) would overwrite B's stored `mode = "enforce"` with `mode = "observe"`. A subsequent resolver-error on hook B's path would consult the cache, see `observe`, and fail open — when it should have failed closed. The converse also breaks: hook A in observe consulting a hook-B-written `enforce` would fail closed on its own observe-mode posture. Per-hook caches give each gate an independent record of its own last-known mode.

**Same `jurisdiction` and `clinicType`** across both caches for the same deployment (the resolver returns one config; both hooks copy `{ jurisdiction, clinicType }` from it). The shared cost — two `Map.set` per turn instead of one — is negligible.

**Fail-closed handoff render** in either hook uses the locally-cached `jurisdiction` and `clinicType`. No cross-hook coordination required.

### 6.8 Other failure modes

- **`substantiationResolver.resolve` throws** → log via `console.error`, treat as `{ status: "missing" }` for that sentence (most conservative). Verdict reasonCode `unsupported_claim_rewritten` or `unsupported_claim_escalated` per claim type. The error is captured in `details.notes` for triage.
- **`approvedClaimStore.list` throws** (inside resolver) → resolver catches and surfaces as the above.
- **`rewriteLoader` throws** (boot-time normalization should prevent this at scan time) → `console.error`, treat as escalate.
- **`verdictStore.save` throws** → log, still apply the rewrite/escalate. Same priority as 1b-1: emission integrity > persistence completeness > observability detail.
- **`handoffStore.save` throws** → log, still apply the block.

## Section 7 — Hook registration

`apps/api/src/bootstrap/skill-mode.ts`: construct `ClaimClassifierHook` and add to the hook array **after** `DeterministicSafetyGateHook` and **before** `TracePersistenceHook`. The 1b-1 hook-ordering verification (`packages/core/src/skill-runtime/types.ts` confirmed registration-array order) carries over — same plan-task definition-of-done.

Bootstrap also constructs:

- `AnthropicClaimClassifier` instance (shared Anthropic client; the chat / agent-runtime adapters reuse a process-level client today — same one).
- `SubstantiationResolver` with `ApprovedComplianceClaimStore` (Prisma), `loadRegulatoryPublicSources`, and an `InMemoryLRU` cache (`maxEntries: 5000`).
- `rewriteLoader` is a thin function `(j) => loadRewriteTemplates(j)`.
- A **second** `InMemoryGovernancePostureCache` instance for the classifier hook (the 1b-1 instance stays scoped to `DeterministicSafetyGateHook` and `ChannelGateway` pre-input gate).

All construction lives in `skill-mode.ts` alongside the 1b-1 wiring. No new bootstrap file.

## Section 8 — Eval harness

`pnpm classifier-eval` (new script in `packages/core` or a top-level `scripts/`). Offline, not part of `pnpm test` / `pnpm typecheck`. Soft CI gate.

**Input:** `packages/core/src/governance/classifier/eval/golden-set.ts` — a fixture of `{ sentence, jurisdiction, expectedClaimType, notes }` records (≥40 entries spanning all 9 claim types).

**Run:**

1. For each fixture, invoke the Anthropic classifier with `model = claude-haiku-4-5-20251001`.
2. Repeat with `model = claude-sonnet-4-6` (or current Sonnet GA at time of run).
3. Tabulate per-model accuracy vs `expectedClaimType` and inter-model disagreement count.
4. Emit a JSON report (`eval-results.json`) and a Markdown summary on stdout.

**Soft gate:**

- Per-model accuracy ≥85% on the golden set → green.
- Accuracy 70–85% → warn (non-blocking).
- Accuracy <70% → red (still non-blocking in 1b-2, but PR description must acknowledge).
- Inter-model disagreement >25% → warn (signal that the prompt may be under-specified).

**Why soft, not hard:** the golden set is curated by humans and may itself drift. Promoting to a hard gate is a Phase 3 maturity step once the seed and prompt have stabilized.

**Cost containment:** the harness runs against `ANTHROPIC_API_KEY` and consumes tokens. It's manual (not on every PR) — run it on PRs that touch the prompt or claim-type enum. Document this in the PR template / repo README.

## Section 9 — Test fixture coverage

Per the 1a/1b-1 pattern, all runtime assertions go through `GovernanceVerdict` shape.

| Surface | Fixture coverage |
|---|---|
| `ClaimTypeSchema`, `ClassifierSentenceResultSchema`, `CLASSIFIER_SCHEMA_VERSION` | Round-trip for each claim type; rejects unknown; schema-version constant exported |
| `GovernanceVerdictReasonSchema` extension | Accepts `unsupported_claim_rewritten`, `unsupported_claim_escalated`, `claim_substantiation_stale`, `classifier_error`; existing reasons still parse |
| `ClaimClassifierConfigSchema` + `resolveClaimClassifierConfig` | Round-trip for each mode; defaults applied when sub-block absent; passthrough preserves unknown sub-blocks |
| `ApprovedComplianceClaim` Prisma store | Round-trip save → list-by-deployment-jurisdiction-claimType; serviceId-scoped vs global precedence; staleness boundary (`validUntil` and `reviewedAt > 180d`) round-trips |
| `RegulatoryPublicSourceEntry` loader | Per jurisdiction: unique-id invariant throws at boot; regex normalization removes `g` flag; deterministic order snapshot of merged loader output |
| Substantiation resolver | Per claim type: `matched` / `stale` / `missing` for each tier; service-scoped beats global; first-match-wins ordering; staleness boundary; resolver throw → caller-treated-as-missing |
| Substantiation LRU cache | match cached, stale/missing not cached; LRU eviction at `maxEntries`; multi-tenant key isolation (deploymentId in key) |
| `splitSentences` (extracted util) | 1b-1 test suite migrates verbatim; cross-import test from both gates and classifier hook |
| `AnthropicClaimClassifier` (mocked SDK) | Successful tool-use response parses; missing `tool_use` block throws; non-tool-use content rejected; cache_control on system+tools verified in request payload (assert against the captured `messages.create` argument); abort signal propagates as `AbortError` |
| `runClassifier` | All-classified happy path; partial-timeout (3 sentences, 1 timed out); all-error; preserves input order in output |
| Rewrite template loader | Per jurisdiction: all four rewriteable claim types have a template; unique-id invariant; deterministic order |
| `ClaimClassifierHook` | Mode matrix (off/observe/enforce) × outcome matrix (none, rewriteable-matched, rewriteable-missing, rewriteable-stale, escalate-class, timeout, error) × jurisdiction (SG, MY). Asserts: verdict shape including all `details` stamps, rewrite-in-place vs whole-message block, `human_override` flip on escalate, handoff save on escalate, parallel dispatch (not serial) |
| Hook ordering | `ClaimClassifierHook` runs after `DeterministicSafetyGateHook`; classifier never invoked when 1b-1 gate has already blocked (i.e., `ctx.skillOutput` already replaced with handoff template at classifier-hook entry) |
| Posture-cache scoping | Each hook reads/writes ONLY its own cache instance; 1b-1's cache is unaffected by classifier-hook writes; classifier's cache is unaffected by 1b-1 writes; resolver-error fail-closed in either hook uses ITS OWN cached `jurisdiction`/`clinicType` for handoff render. Mixed-mode regression test: 1b-1 = observe + classifier = enforce, force resolver error → 1b-1 fails open (correct), classifier fails closed (correct). |
| Persistence-failure fail-open-of-action | `verdictStore.save` throws after classification → rewrite/escalate still applied; `handoffStore.save` throws → conversation status still flipped |
| Service-context propagation | Skill runtime threads `serviceId` from service-scoped tool calls into `AfterSkillContext.serviceContext`; null when no service-scoped tool fired; substantiation resolver consumes correctly |

## Section 10 — Operability

**Per-deployment activation.** Set `agentDeployment.governanceConfig.claimClassifier = { mode: "observe", latencyBudgetMs: 800, model: "claude-haiku-4-5-20251001" }` to start collecting verdicts on real traffic. Tune by reviewing `auditLevel: "warning"` verdicts in the store. Flip to `"enforce"` once the rewrite distribution and false-positive rate are acceptable. Roll back by flipping to `"off"`.

**Independent layers.** A deployment can enable the deterministic gate (`governanceConfig.deterministicGate.mode = "enforce"`) and leave the classifier in observe (or off) while authoring `ApprovedComplianceClaim` rows. The reverse is also valid but rare — the classifier should generally run alongside or behind the deterministic gate.

**Conservative rollout pattern.**

1. Enable both layers in `observe` mode.
2. Author `ApprovedComplianceClaim` rows for the top efficacy / safety / superiority claims appearing in observed verdicts.
3. Author `RegulatoryPublicSource` entries (PR-reviewed) for the credential / device claims that should be allowed.
4. Promote deterministic gate to `enforce`.
5. After 2–4 weeks of observe-mode classifier data, promote classifier to `enforce`.

**Audit signal.** `auditLevel: "critical"` classifier verdicts in enforce mode are the high-priority signal. `auditLevel: "warning"` (observe) is the tuning signal. Eval-harness output is the prompt-drift signal.

**Cost envelope.** Per-turn cost in enforce mode is roughly `(N sentences) × (Haiku 4.5 input rate × small prompt + cached) + (LRU hit-rate avoidance)`. At the v1 pilot envelope (single tenant, low QPS), this is order-of-cents per day. Operational alerting on classifier cost is a Phase 3 concern.

**No load-bearing CI gates added in 1b-2.** The eval harness is soft (manual, per-PR-on-prompt-change). `pnpm classifier-eval` does not run in CI by default.

## Out of scope (verbatim restatement)

- Phase 1c — PDPA consent state machine, AI disclosure, consent-gated outbound
- Phase 1d — WhatsApp 24h window detection, template registration
- Phase 1b-1.5 — regulatory expansion of 1b-1 banned-phrase / escalation-trigger seed tables
- Phase 2 — operator UI for authoring `ApprovedComplianceClaim` rows
- Phase 3 — outcome tagging, pattern detection, recommendations surfacing of repeat classifier rewrites
- Cache-invalidation on `ApprovedComplianceClaim` upsert (cache stores matches only; new rows take effect on next miss)
- Operator dashboard surface for browsing classifier verdicts or approved compliance claims
- Embedding-based semantic match for substantiation (substring is v1)
- Model-generated rewrites (deterministic templates only)
- Real "fetch live HSA / MDA / SMC registry" integration (curated TS constants in `RegulatoryPublicSource`)
- Per-claim-type mode override (`governanceConfig.claimClassifier.mode` is flat in 1b-2)
- Persistent / cross-instance LRU cache (per-process; same trade-off as 1b-1's posture cache)
- Cross-message service-context tracking (single-turn `serviceContext` only)
- Hard CI gate on `pnpm classifier-eval` (soft only; manual)
- Phase 1b-2.5 staleness on `RegulatoryPublicSource` (out of scope; entries are static TS in 1b-2)

## Open questions

1. **`Service` reference resolution from skill output.** Section 6.2 says the runtime threads `serviceId` from service-scoped tool calls into `AfterSkillContext.serviceContext`. The exact list of "service-scoped tools" in the current skill runtime (`services.lookup`, `calendar-book`, others?) needs to be enumerated in the plan task that touches `skill-runtime/types.ts`. If the runtime doesn't currently track tool-call → service-id correlation, the plan task adds it as part of the wiring step, not deferred.

2. **`ApprovedComplianceClaim` seed authorship.** 1b-2 ships an empty store. Operators (or the regulatory reviewer named in 1b-1.5) need to author rows for the pilot tenant. The PR description should call out a follow-up note: target tenant, expected first 10 claims, author. Not blocking 1b-2 merge.

3. **Eval-harness cost discipline.** `pnpm classifier-eval` consumes tokens on real Anthropic API. The script should require an explicit `EVAL=1` env flag (or similar) to prevent accidental runs in pre-commit hooks. Plan task implements the guard.

4. **Multi-message classifier dispatch.** Section 6.3 collects all sentences across all output messages into a single parallel batch under one budget. A skill output with 3 messages × 5 sentences is 15 parallel calls within 800 ms. If real-world traffic shows this is too aggressive (Anthropic rate limits or pathological latency), a follow-up tightens to a per-message sub-budget. 1b-2 ships the simpler single-batch policy and notes the upgrade path.

5. **Confidence threshold.** The classifier returns a `confidence` field. 1b-2 does not gate on it — a low-confidence `claimType: efficacy` still triggers the rewrite path. A future tuning step could escalate (rather than rewrite) when `confidence < 0.5`. Captured here as a knob the eval harness can inform.
