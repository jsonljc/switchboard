# Alex SG/MY Medspa — Phase 1b-1: Deterministic Safety Gate

**Date:** 2026-05-10
**Status:** Draft (post-brainstorm, pre-plan)
**Parent spec:** `docs/superpowers/specs/2026-05-10-alex-medspa-sg-my-design.md` (sections 3.1 Layer 1, 3.2, 3.4, Phasing 1b-1 row, Operability)
**Builds on:** Phase 1a (`docs/superpowers/plans/2026-05-10-alex-medspa-phase-1a.md`, PR #409). 1a foundation — `GovernanceVerdictSchema`, `ReferenceMetadataSchema`, fat-skill directory at `skills/alex/`, extended `ServiceSchema` — must be on `main` (or cherry-picked into the implementation worktree) before 1b-1 implementation begins. Spec and plan can be authored against 1a as a reference without 1a being merged.

## Problem

Alex's regulatory safety today is entirely prompt-discipline. In SG/MY medical aesthetic and beauty spa contexts, prompt-discipline at scale leaks: an HSA / SMC / HCSA / MAB / MMC / KKM violation is not recoverable, and the cost of one false outbound efficacy claim or one missed pregnancy disclosure dwarfs the cost of a few false-positive escalations.

Phase 1b-1 ships the **deterministic** safety layer — two harness-level guards that run on every Alex turn, independent of model behavior. The guards are pattern-matched, fast, and bounded. They are not a substitute for the Phase 1b-2 claim classifier, the Phase 1c consent state machine, or the Phase 1d WhatsApp window check; they are the safety net those phases sit on top of.

## Scope

**In scope (Phase 1b-1):**

1. **Pre-output banned-phrase scanner** (harness `SkillHook.afterSkill()` hook): scan every outbound model message against per-jurisdiction banned-phrase tables before `replySink.send()`. On match: block emit, replace with deterministic handoff template, mark conversation `human_override`, persist `GovernanceVerdict`, save `HandoffPackage`.
2. **Pre-input escalation-trigger scanner** (channel-gateway inline check): scan every inbound user message against per-jurisdiction trigger tables before `PlatformIngress.submit()`. On match: skip model invocation, emit deterministic handoff template, mark conversation `human_override`, persist `GovernanceVerdict`, save `HandoffPackage`.
3. **`GovernanceConfigSchema`** on `AgentDeployment` carrying `jurisdiction`, `clinicType`, and `deterministicGate.mode` (`"off" | "observe" | "enforce"`). One Prisma migration adds a nullable `governanceConfig Json?` column.
4. **`GovernanceVerdictStore`** — Prisma table + repository for persisted verdicts, queryable by deployment, conversation, action, reason, source. The 1a-shipped `GovernanceVerdictSchema` is the core row shape; the table adds a `details Json?` column for fine-grained match analytics (`matchCategory`, `matchId`, `matchedText`).
5. **Banned-phrase and escalation-trigger tables** — TS modules under `packages/core/src/governance/`, structured as categorized hybrids, split as `common.ts + sg.ts + my.ts` per table.
6. **Deterministic handoff template** rendering — per-jurisdiction prose, no model involvement.
7. **Schema extensions** to `GovernanceVerdictReasonSchema` (add `sensitive_inbound`, `compliance_concern`) and `GovernanceVerdictSourceSchema` (add `banned_phrase_scanner`, `claim_classifier`; remove `claim_scanner`).
8. **Test fixtures** asserted against `GovernanceVerdict` shape per the 1a fixture pattern.

**Out of scope (deferred, do not bleed into 1b-1):**

- **Phase 1b-2** — claim classifier (Layer 2), substantiation tiers (Layer 3), rewrite policy, classifier latency fallback. Banned-phrase categories with `severity: "rewrite_in_1b2"` are still treated as `block` in 1b-1.
- **Phase 1c** — PDPA consent state machine, AI disclosure versioning, consent-gated outbound.
- **Phase 1d** — WhatsApp 24h window detection, template registration, template re-engagement.
- **Phase 2** — knowledge onboarding UX, gap-fill form, completeness indicator.
- **Phase 3** — outcome tagging, pattern detection, recommendations surfacing of repeat banned-phrase categories.
- **Operator dashboard surface** for browsing/searching `GovernanceVerdict` rows. The store exists; the UI does not.
- **Rewriting** banned content. 1b-1 only blocks. Rewrite is a 1b-2 concern paired with the classifier.
- **Sentence-level filtering.** 1b-1 is message-level: a single match blocks the whole outbound message. Sentence-level partial emission is unsafe without the 1b-2 classifier.

## Architecture summary

Two harness guards. Both wrap an Alex turn:

```
                  ┌────────────────────────────────────────────────────────┐
inbound ──────────►│ channel-gateway: identity resolve                    │
                  │   ├─ pre-input gate (escalation-trigger-scanner)     │  ← NEW (1b-1)
                  │   │     match? → handoff + human_override + verdict; │
                  │   │             skip submit()                         │
                  │   └─ PlatformIngress.submit() ──► skill runtime      │
                  └────────────────────────────────────────────────────────┘
                                                                 │
                                                                 ▼
                  ┌────────────────────────────────────────────────────────┐
                  │ skill runtime: SkillExecutorImpl                     │
                  │   ├─ skill.execute(...)                              │
                  │   ├─ TracePersistenceHook.afterSkill                 │
                  │   └─ DeterministicSafetyGateHook.afterSkill          │  ← NEW (1b-1)
                  │         match in any output message?                  │
                  │         → block + handoff + human_override + verdict │
                  └────────────────────────────────────────────────────────┘
                                                                 │
                                                                 ▼
                                                            replySink.send()
```

Both guards consult `deployment.governanceConfig.deterministicGate.mode`:
- `"off"` → no scan, no verdict, no handoff. Pure pass-through.
- `"observe"` → scan; on match, persist verdict with `action: "allow"` and `auditLevel: "warning"`; pass through (do not block, do not escalate).
- `"enforce"` → scan; on match, block/escalate per the flows below; persist verdict with `action: "block"` (pre-output) or `action: "escalate"` (pre-input) and `auditLevel: "critical"`.

No verdict is persisted on a clean no-match outcome. The store contains only events.

## Design decisions

| Decision | Choice | Rationale |
|---|---|---|
| Banned-phrase table shape | Categorized hybrid: `{ category, patterns, severity, notes? }` | Categories map cleanly to `GovernanceVerdict.reasonCode` and pre-position structure 1b-2 needs. Strings are case-insensitive substrings; regexes catch shape patterns. |
| Common-vs-jurisdiction split | `common.ts` baseline + `sg.ts`/`my.ts` extensions; loader merges | "guaranteed", "permanent", "best", "cure" apply in both jurisdictions. DRY beats duplicate. SG/MY add jurisdiction-specific entries (e.g., HSA device names, MAB-prohibited terms). |
| Source of truth | TS tables authoritative; `skills/alex/references/regulatory/{sg,my}-rules.md` is operator-facing prose | Tables are runtime data for runtime guards. Markdown is documentation; not load-bearing, not auto-generated, not parsed. Both can drift; the table is what the gate enforces. |
| Block behavior on banned-phrase match | Block + escalate (symmetric with pre-input gate) | Conservative. Operator sees blocked text in `GovernanceVerdict.originalText` and can author a corrective `approved_compliance_claim` in 1b-2 or a knowledge-base entry. Generic-fallback risks silent loops; sentence-drop risks emitting incoherent stubs. |
| Mode field | `mode: "off" \| "observe" \| "enforce"` only — no separate `enabled` flag | A single field eliminates the `enabled: false, mode: "enforce"` ambiguity. Default `"off"`. Tenants opt in by flipping mode. |
| Feature-flag mechanism | `governanceConfig.deterministicGate.mode` IS the flag | Per-deployment compliance posture is a tenant configuration, not a product rollout. No global flag system needed. |
| `GovernanceVerdictSourceSchema` change | Replace `claim_scanner` with `banned_phrase_scanner`; add `claim_classifier` for 1b-2 | `claim_scanner` was a 1a placeholder. The 1b-1 guard is specifically a banned-phrase scanner, not a claim scanner — the latter is the 1b-2 classifier. Cleaner audit analytics. |
| `GovernanceVerdictReasonSchema` extension | Add `sensitive_inbound` and `compliance_concern` | `medical_safety_trigger` should not be overloaded. Pregnancy / adverse reaction / active medical condition are medical-safety. Multi-treatment combos and sensitive keywords are operator-risk (`sensitive_inbound`). Complaints and competitor-negative are compliance (`compliance_concern`). Cleaner downstream analytics. |
| Banned-phrase category → reasonCode mapping | All outbound categories → `unsupported_claim` (superlative, guarantee, medical_claim) or `banned_phrase` (urgency, testimonial). `medical_safety_trigger` reserved for inbound. | An outbound *"this cures acne"* is an unsupported claim, not a safety trigger. `medical_safety_trigger` semantically belongs to inbound user-volunteered safety context. |
| Verdict persistence policy | Persist only when a guard matched — no row-per-clean-output | Row-per-turn audit logs become unreadable at scale. Match-only persistence keeps the store as an event log. Clean-rate metrics, if needed later, come from sampled allows or aggregate counters — not the verdict table. |
| `HandoffReason` for both guards | Reuse existing `compliance_concern` | Coarse handoff routing is sufficient in 1b-1. Per-category routing is structured detail that lives in `GovernanceVerdict.reasonCode`, `sourceGuard`, and category — not the handoff envelope. |
| Hook integration | `SkillHook.afterSkill()` mirroring `TracePersistenceHook` shape; **runs before** `TracePersistenceHook` | Existing pattern. `apps/api/src/bootstrap/skill-mode.ts` is the single registration site. Gate-first ordering means the trace never sees unsafe pre-block text — it sees only the post-block output (the handoff template when blocked). The original model output is captured in `GovernanceVerdict.originalText`, so the audit story is complete via the verdict store; the trace stays an unregulated artifact. |
| Resolver failure semantics | Discriminated `{ status: "resolved" \| "missing" \| "error" }` return. On `"error"`, fall back to a per-process sticky cache of last-known mode. Fail closed only if last known was `enforce` (or `observe` for the input gate); fail open otherwise. | A naive "throw → fail closed everywhere" would let one transient `AgentDeploymentStore` blip pause every Alex conversation globally. Sticky cache constrains the closed-fail to deployments already known to be governed. |
| Pre-input gate location | Inline in `channel-gateway.ts` between identity resolution and `platformIngress.submit()` | The gate must short-circuit submission. A skill-runtime hook is too late — the skill has already been invoked. |
| Conversation pause | Reuse existing `conversationStore.setConversationStatus(sessionId, "human_override")` | Gateway already suppresses further AI emit when status is `human_override` (`channel-gateway.ts:44–57, 149–154`). No new pause mechanism. |
| Handoff payload | Reuse existing `HandoffPackage` + `HandoffStore.save()` | `HandoffReason.compliance_concern` already exists. No new handoff type. |
| `GovernanceVerdictStore` | New Prisma table `GovernanceVerdict` + repository following the prisma-store pattern | 1a shipped the schema, not the persistence layer. 1b-1 emits the first verdicts, so the store lands here. |

## Section 1 — Schema changes

### 1.1 Extend `GovernanceVerdictReasonSchema`

`packages/schemas/src/governance-verdict.ts`:

```ts
export const GovernanceVerdictReasonSchema = z.enum([
  "allowed",
  "banned_phrase",
  "unsupported_claim",
  "medical_safety_trigger",
  "sensitive_inbound",         // NEW: multi-treatment combos, sensitive keywords (inbound)
  "compliance_concern",        // NEW: prior complaint, competitor-negative (inbound)
  "outside_whatsapp_window",
  "consent_missing",
  "classifier_timeout",
]);
```

### 1.2 Update `GovernanceVerdictSourceSchema`

```ts
export const GovernanceVerdictSourceSchema = z.enum([
  "banned_phrase_scanner",     // RENAMED from claim_scanner
  "claim_classifier",          // NEW: reserved for 1b-2
  "escalation_trigger",
  "consent_gate",
  "whatsapp_window",
]);
```

`claim_scanner` is removed. 1a only shipped the Zod schema — there is no `GovernanceVerdict` Prisma table yet (1b-1 creates it), so no persisted rows can reference `claim_scanner`. The only callers are 1a's fixture tests, which 1b-1 updates as part of the same task that updates the enum.

### 1.3 New `GovernanceConfigSchema`

`packages/schemas/src/governance-config.ts` (new file):

```ts
import { z } from "zod";

export const GovernanceModeSchema = z.enum(["off", "observe", "enforce"]);
export type GovernanceMode = z.infer<typeof GovernanceModeSchema>;

export const GovernanceConfigSchema = z
  .object({
    jurisdiction: z.enum(["SG", "MY"]),
    clinicType: z.enum(["medical", "nonMedical"]),
    deterministicGate: z
      .object({
        mode: GovernanceModeSchema.default("off"),
      })
      .default({}),
  })
  .passthrough();   // 1c (consent), 1d (whatsapp window) extend without migration

export type GovernanceConfig = z.infer<typeof GovernanceConfigSchema>;

/** Resolver helper. Single source of truth for "what mode is this deployment in?". */
export function resolveGovernanceMode(
  config: GovernanceConfig | null,
): GovernanceMode {
  return config?.deterministicGate?.mode ?? "off";
}
```

`jurisdiction` and `clinicType` are required when `governanceConfig` is present. Deployments without `governanceConfig` (the migration default for existing rows) are treated as `mode: "off"` and never invoke the gate — `jurisdiction`/`clinicType` are not consulted because no scan runs.

`passthrough` lets 1c/1d add `consent` / `whatsappWindow` blocks without a Prisma migration. Each new sub-block goes through its own Zod refinement at use site.

No `DEFAULT_GOVERNANCE_CONFIG` is exported. The schema requires `jurisdiction` and `clinicType` if `governanceConfig` is present, so a partial default would either lie about the type or carry placeholder jurisdiction/clinicType values that mask programming errors. Use `resolveGovernanceMode(null)` (returns `"off"`) at call sites that need a default mode, and require operators to set `jurisdiction` + `clinicType` explicitly when they enable the gate.

### 1.4 Prisma migration

`packages/db/prisma/schema.prisma`:

```prisma
model AgentDeployment {
  // ...existing fields...
  governanceConfig Json?
}

model GovernanceVerdict {
  id              String   @id @default(cuid())
  deploymentId    String
  conversationId  String
  action          String
  reasonCode      String
  jurisdiction    String
  clinicType      String
  sourceGuard     String
  originalText    String?  @db.Text
  emittedText     String?  @db.Text
  auditLevel      String
  decidedAt       DateTime
  modelLatencyMs  Int?
  details         Json?    // { matchCategory, matchId, matchedText } — fine-grained analytics; not in GovernanceVerdictSchema
  createdAt       DateTime @default(now())

  deployment      AgentDeployment @relation(fields: [deploymentId], references: [id], onDelete: Cascade)

  @@index([deploymentId, decidedAt])
  @@index([conversationId, decidedAt])
  @@index([deploymentId, sourceGuard, decidedAt])
}
```

Migration steps (use `prisma migrate diff --from-url --to-schema-datamodel --script` then `migrate deploy`, per the established TTY-free workflow):

1. `ALTER TABLE "AgentDeployment" ADD COLUMN "governanceConfig" JSONB`.
2. `CREATE TABLE "GovernanceVerdict"` with FK to `AgentDeployment`.

No data backfill is required. 1a never persisted verdicts (the table is created here), and `governanceConfig` is nullable with `mode: "off"` semantics for null. `pnpm db:check-drift` must pass before commit. If Postgres is unreachable in the spec author's environment (no Docker / no `DATABASE_URL`), follow 1a's pattern: skip locally and document in the PR body.

### 1.5 Resolver shape and failure semantics

The gate calls a `GovernanceConfigResolver`. The resolver returns a discriminated union, not a `GovernanceConfig | null`, so callers can distinguish "no config (treat as off)" from "read failed (apply fail-safe rule)":

```ts
export type GovernanceConfigResolution =
  | { status: "resolved"; config: GovernanceConfig }
  | { status: "missing" }
  | { status: "error"; error: Error };

export type GovernanceConfigResolver = (
  deploymentId: string,
) => Promise<GovernanceConfigResolution>;
```

A naive "throw → fail closed" rule would let one transient `AgentDeploymentStore` outage pause every Alex conversation globally, including conversations on deployments that have no governance enabled. To constrain the closed-fail to deployments already known to be governed, both gates wrap the resolver with a per-process **last-known-mode cache**:

```ts
export interface ModeCache {
  remember(deploymentId: string, mode: GovernanceMode): void;
  lastKnown(deploymentId: string): GovernanceMode | undefined;
}
```

Implementation: a `Map<string, GovernanceMode>` (no eviction needed in 1b-1; deployments are bounded; cache reset on process restart is acceptable because the resolver succeeds on warm cache anyway).

**Decision rules per resolution status:**

| Status | Output gate (pre-emit) | Input gate (pre-submit) |
|---|---|---|
| `resolved` | Use `config.deterministicGate.mode`. Update cache. | Same. |
| `missing` | `mode = "off"`. Pass through. Do not persist verdict. | Same. |
| `error`, last-known cache miss or `"off"` | Pass through (fail open). Log. Do not persist. | Pass through (fail open). Log. Do not persist. |
| `error`, last-known cache `"observe"` | Pass through. Log. Do not persist. | Pass through. Log. Do not persist. |
| `error`, last-known cache `"enforce"` | **Fail closed**: replace output with handoff template, flip status to `human_override`, save handoff, persist verdict with `auditLevel: "critical"`, `reasonCode: "classifier_timeout"` (reused for resolver failure pending a dedicated reason in 1c+). | **Fail closed**: skip `submit()`, send handoff template, flip status to `human_override`, save handoff, persist verdict (same fields). |

Reusing `classifier_timeout` for resolver failure is a small semantic stretch but avoids adding a one-off reason just for this edge. 1c can promote it to a dedicated `governance_unavailable` reason if needed.

The cache is in-process only. A first request to a freshly-restarted instance for an enforce-mode deployment whose config read fails falls in the "cache miss → fail open" bucket. This is an accepted trade-off: the alternative (persistent cache or a separate cheap "is governed?" lookup) doubles infrastructure cost for a rare transient-failure case. The risk is bounded — one request can leak during a resolver outage on the very first turn after restart, only for deployments not yet warmed.

## Section 2 — Banned-phrase tables

### 2.1 Types

`packages/core/src/governance/banned-phrases/types.ts`:

```ts
export type BannedPhraseCategory =
  | "superlative"        // "best", "leading", "#1", "no.1"
  | "guarantee"          // "guaranteed", "100%", "permanent", "lifetime"
  | "medical_claim"      // "cure", "treats", "fixes <condition>"
  | "urgency"            // "limited slots", "today only", "expires soon"
  | "testimonial";       // "many clients say", "we've heard from"

export type BannedPhraseSeverity = "block" | "rewrite_in_1b2";

export interface BannedPhraseEntry {
  id: string;            // stable, e.g., "guarantee_100pct", "superlative_best"
  category: BannedPhraseCategory;
  patterns: ReadonlyArray<string | RegExp>;
  severity: BannedPhraseSeverity;
  notes?: string;
}
```

`severity: "rewrite_in_1b2"` is currently treated identically to `"block"` in 1b-1; the field exists so 1b-2 can author rewrite-eligible entries without a schema migration. `id` is required so verdicts can reference exactly which entry triggered (via `verdict.details.matchId`), enabling later analytics like "this `guarantee_lifetime` entry fires 40× more than any other — author may need to revisit the marketing copy that prompts it."

### 2.2 Layout

```
packages/core/src/governance/banned-phrases/
  types.ts
  common.ts        // jurisdiction-agnostic baseline (superlatives, guarantees, generic urgency)
  sg.ts            // SG-specific (HSA-prohibited device claims, MOH-restricted terms)
  my.ts            // MY-specific (MAB-prohibited terms, KKM-restricted device claims)
  loader.ts        // mergeForJurisdiction(j: "SG" | "MY"): readonly BannedPhraseEntry[]
  index.ts
```

`loader.ts` exports a memoized `loadBannedPhrases(jurisdiction: "SG" | "MY")` that returns `Object.freeze([...common, ...jurisdictionEntries])`. Memoization is per-process; tables are static module-level constants and require no runtime invalidation.

### 2.3 Category → reasonCode mapping

```ts
const REASON_CODE_BY_CATEGORY: Record<BannedPhraseCategory, GovernanceVerdictReason> = {
  superlative:    "unsupported_claim",
  guarantee:      "unsupported_claim",
  medical_claim:  "unsupported_claim",
  urgency:        "banned_phrase",
  testimonial:    "banned_phrase",
};
```

`medical_safety_trigger` is intentionally not in this map — it is reserved for inbound triggers.

### 2.4 Authoring contract

- Strings are case-insensitive substring matches against the scanned text.
- RegExps are normalized at scanner load: a fresh `RegExp(pattern.source, ensureFlags(pattern.flags, "i"))` is constructed without the `g` flag — see Section 4 for why. Authors are responsible for word-boundary anchors where required to avoid false positives (e.g., `/\bbest\b/i`, not `/best/i`, to skip "bestseller").
- `id` must be unique within the merged jurisdiction set (`common ∪ sg` or `common ∪ my`). Loader asserts uniqueness at boot; duplicate IDs throw.
- Each entry's `notes` is a one-line authoring rationale (e.g., `"HSA — devices not approved for skin lightening claims"`). Used by reviewers, not by runtime.
- The reference markdown at `skills/alex/references/regulatory/{sg,my}-rules.md` should mention the categories and reference the TS file path; it is not the source of truth and can drift in tone, but the categories must match.

### 2.5 Initial content policy

The 1b-1 PR ships **conservative seed tables, not placeholders.** Each category must include real baseline patterns that any reasonable medspa-compliance reviewer would block on sight. These are not exhaustive; they are floor-of-acceptable. A regulatory review pass (Phase 1b-1.5, scoped separately and likely owned by a regulatory consultant or named reviewer) can expand them later.

**Minimum seed per category, per jurisdiction file** (common.ts entries count toward the floor):

| Category | Minimum entries | Examples (common; SG/MY add jurisdiction-specific) |
|---|---|---|
| `superlative` | 5 | `\bbest\b`, `\b#?1\b` (with anchors), `leading`, `top`, `unmatched` |
| `guarantee` | 5 | `guaranteed`, `100%`, `permanent`, `lifetime`, `no side effects`, `painless` |
| `medical_claim` | 5 | `cure`, `cures`, `fixes <condition>`, `treats <condition>`, `eliminates <condition>` |
| `urgency` | 3 | `limited slots today`, `today only`, `last chance`, `expires (today\|tonight)` |
| `testimonial` | 3 | `many clients say`, `we've heard`, `our clients all`, `every client` |

These seed entries are deliberately phrased to false-negative on legitimate use ("this is our best practice for follow-up" passes `\bbest\b` only because we anchor; the word *does* match — authors must accept this and rely on context: "the *best results*" should be a model failure that the test fixture covers explicitly). The principle: **better to escalate one false positive than emit one violation.**

The plan task that authors these seeds must include a comment block in each table file pointing to the regulatory-review handoff: who owns the next pass, when it's expected, and what's intentionally over-broad pending review.

## Section 3 — Escalation triggers

### 3.1 Types

`packages/core/src/governance/escalation-triggers/types.ts`:

```ts
export type EscalationTriggerCategory =
  | "pregnancy_breastfeeding"
  | "prior_adverse_reaction"
  | "prior_complaint"
  | "competitor_negative"
  | "multi_treatment_combo"
  | "sensitive_keyword";

export interface EscalationTriggerEntry {
  id: string;            // stable, e.g., "pregnancy", "competitor_negative_clinic"
  category: EscalationTriggerCategory;
  patterns: ReadonlyArray<string | RegExp>;
  /**
   * Optional per-entry negations. If any negation matches in the SAME sentence
   * as a trigger pattern, the trigger is suppressed. Required for entries
   * where the negated form is a common false positive ("I'm not pregnant",
   * "no longer breastfeeding", "I've never had a complaint about this clinic").
   */
  negations?: ReadonlyArray<string | RegExp>;
}
```

Negations are paired per entry (not table-wide) because the negated form depends on the trigger's wording. `pregnancy_breastfeeding` needs `["not pregnant", "no longer pregnant", "never been pregnant", "not breastfeeding", "no longer breastfeeding"]`; `prior_complaint` needs `["no complaints", "never complained", "no prior complaints"]`. Authors maintain the negation set alongside the patterns.

The output gate's `BannedPhraseEntry` does not have a negation field. Model output that says "we cannot guarantee X" still contains "guarantee" — but in 1b-1, the conservative posture is to escalate; an over-cautious block is acceptable and the model can be re-instructed via prompt. 1b-2's classifier handles intent more cleanly than negation patterns can.

### 3.2 Layout

```
packages/core/src/governance/escalation-triggers/
  types.ts
  common.ts
  sg.ts
  my.ts
  loader.ts        // mergeForJurisdiction(j): readonly EscalationTriggerEntry[]
  index.ts
```

Same merge model as banned phrases.

### 3.3 Category → reasonCode mapping

```ts
const REASON_CODE_BY_TRIGGER: Record<EscalationTriggerCategory, GovernanceVerdictReason> = {
  pregnancy_breastfeeding: "medical_safety_trigger",
  prior_adverse_reaction:  "medical_safety_trigger",
  prior_complaint:         "compliance_concern",
  competitor_negative:     "compliance_concern",
  multi_treatment_combo:   "sensitive_inbound",
  sensitive_keyword:       "sensitive_inbound",
};
```

## Section 4 — Scanners

### 4.1 RegExp normalization (shared)

Both scanners normalize input regexes at the loader boundary, not at scan time:

```ts
function normalizeRegex(p: RegExp): RegExp {
  // Always case-insensitive; never global (g would make .test/.exec stateful
  // across calls because lastIndex persists on a shared regex instance).
  const flags = p.flags.replace(/g/g, "");
  return new RegExp(p.source, flags.includes("i") ? flags : flags + "i");
}
```

This runs once per pattern at table-load (in the loader's freeze step), so scanners receive only normalized regexes. String patterns are matched via `text.toLowerCase().includes(p.toLowerCase())`.

### 4.2 Banned-phrase scanner

`packages/core/src/governance/scanner/banned-phrase-scanner.ts`:

```ts
export interface BannedPhraseMatch {
  entry: BannedPhraseEntry;
  matched: string;       // the substring or RegExp.exec()[0] that matched
  index: number;         // start index in the scanned text
}

export function scanForBannedPhrases(
  text: string,
  entries: ReadonlyArray<BannedPhraseEntry>,
): BannedPhraseMatch[];
```

Pure function. Returns all matches across all entries for diagnostics / fixture authoring. Caller decides what to do with multiple matches (1b-1: any match → block; `reasonCode` comes from the first match's category, `details.matchId` records the specific entry).

### 4.3 Escalation-trigger scanner (sentence-bounded, negation-aware)

```ts
export interface EscalationTriggerMatch {
  entry: EscalationTriggerEntry;
  matched: string;
  index: number;          // start index in the original text
  sentence: string;       // sentence containing the match
}

export function scanForEscalationTriggers(
  text: string,
  entries: ReadonlyArray<EscalationTriggerEntry>,
): EscalationTriggerMatch[];
```

The trigger scanner splits `text` into sentences (greedy split on `[.!?\n]+` with whitespace tolerance) and for each `(sentence, entry)` pair:

1. If `entry.negations` matches anywhere in the sentence → skip this `(sentence, entry)`.
2. Otherwise scan `entry.patterns` against the sentence; on match, record with the sentence and original-text offset.

This pairing keeps negation reasoning local: "I'm not pregnant but my friend is" does not trigger `pregnancy_breastfeeding` for the user, even though "pregnant" appears.

Sentence splitting is intentionally crude. A sentence-tokenizer dependency is overkill for inbound chat text, which is short and informal. Edge cases (no punctuation, "..." at end, embedded URLs) are accepted false-positive risk and are covered by true-negative fixtures.

Both scanners are pure, synchronous, allocation-light. False-negative risk is the authoring quality of the tables and negations; false-positive risk is mitigated by anchored regex authoring, sentence-bounded scoping for triggers, and the per-jurisdiction true-negative fixture sets.

## Section 5 — Handoff template

`packages/core/src/governance/handoff-template.ts`:

```ts
export interface HandoffTemplateInput {
  jurisdiction: "SG" | "MY";
  reasonCode: GovernanceVerdictReason;
}

export function renderHandoffTemplate(input: HandoffTemplateInput): string;
```

Per-jurisdiction prose, no model involvement, no operator-configurable strings in 1b-1.

**SG (default):**
> Thanks for sharing that — because this involves a clinic-side detail, I'll get the team to advise you directly. They'll be in touch shortly.

**MY (default):**
> Thanks for sharing that — because this is something the clinic team should advise on, I'll have them get in touch with you directly. They'll reach out soon.

The function returns the same string regardless of `reasonCode` in 1b-1; the parameter is included so 1b-2 can specialize per reason without a signature change. Snapshot tests assert exact strings per jurisdiction.

## Section 6 — `GovernanceVerdictStore`

`packages/core/src/governance/governance-verdict-store/types.ts`:

```ts
export interface GovernanceVerdictDetails {
  matchCategory?: string;     // e.g., "guarantee", "pregnancy_breastfeeding"
  matchId?: string;           // BannedPhraseEntry.id or EscalationTriggerEntry.id
  matchedText?: string;       // the substring/regex match
  sentence?: string;          // input gate only — sentence containing the match
}

export interface GovernanceVerdictRecord extends GovernanceVerdict {
  id: string;
  deploymentId: string;
  details: GovernanceVerdictDetails | null;
  createdAt: string;
}

export interface SaveGovernanceVerdictInput extends GovernanceVerdict {
  deploymentId: string;
  details?: GovernanceVerdictDetails;
}

export interface GovernanceVerdictStore {
  save(input: SaveGovernanceVerdictInput): Promise<GovernanceVerdictRecord>;
  listByConversation(conversationId: string): Promise<GovernanceVerdictRecord[]>;
  listByDeployment(
    deploymentId: string,
    options?: { since?: string; limit?: number },
  ): Promise<GovernanceVerdictRecord[]>;
}
```

`details` is intentionally not part of `GovernanceVerdictSchema` (the 1a Zod schema). It is store-layer metadata for analytics, not a contract on the verdict event itself. Storing it as a typed JSON column lets future fields (e.g., 1b-2's `claimType`, 1c's `consentVersion`) extend without schema migration.

`packages/core/src/governance/governance-verdict-store/prisma-governance-verdict-store.ts` implements the interface using the Prisma client, mirroring the existing prisma-store conventions.

The store does not enforce policy. Callers (the gate hook, the gateway pre-input check) decide whether to persist.

## Section 7 — Pre-output gate hook

`packages/core/src/skill-runtime/hooks/deterministic-safety-gate.ts`:

```ts
export interface DeterministicSafetyGateHookDeps {
  governanceConfigResolver: GovernanceConfigResolver;
  bannedPhraseLoader: (jurisdiction: "SG" | "MY") => readonly BannedPhraseEntry[];
  verdictStore: GovernanceVerdictStore;
  handoffStore: HandoffStore;
  conversationStore: ConversationStateStore;
  modeCache: ModeCache;
  clock: () => Date;
}

export class DeterministicSafetyGateHook implements SkillHook {
  constructor(deps: DeterministicSafetyGateHookDeps);
  async afterSkill(ctx: AfterSkillContext): Promise<AfterSkillOutcome>;
}
```

`AfterSkillOutcome` either passes the original output through, or replaces it with the handoff template. Mirrors `TracePersistenceHook` shape.

**Hook ordering:** `DeterministicSafetyGateHook` must run **before** `TracePersistenceHook` (see Section 9). The trace receives the post-block output; the unsafe pre-block text never lands in the trace store. The pre-block original is captured in `GovernanceVerdict.originalText` so the audit story is complete via the verdict store alone.

**Flow inside `afterSkill`:**

1. `resolution = await governanceConfigResolver(deploymentId)`.
2. **`resolution.status === "missing"`** or resolved-with-`mode === "off"` → return original output unchanged. Do not persist.
3. **`resolution.status === "error"`** → consult `modeCache.lastKnown(deploymentId)`. If `"enforce"` → fail closed (jump to step 6 with `reasonCode: "classifier_timeout"` and `originalText` = the joined message texts). Else → log and return original output unchanged (fail open). Do not persist on the fail-open branch.
4. **`resolution.status === "resolved"`** → `modeCache.remember(deploymentId, mode)`. Load banned phrases for `config.jurisdiction`.
5. For each outbound message in `ctx.skillOutput.messages`, run `scanForBannedPhrases`. Collect all matches.
6. **No matches:** return original output unchanged. Do not persist.
7. **One or more matches** (or fail-closed from step 3):
   - First match's category → `reasonCode` via `REASON_CODE_BY_CATEGORY`. `originalText` = matched message text. `emittedText` = handoff template (`enforce` or fail-closed) or matched message (`observe`).
   - `details = { matchCategory, matchId: entry.id, matchedText: match.matched }`.
   - Build `GovernanceVerdict` with `sourceGuard: "banned_phrase_scanner"`, `auditLevel: "critical"` (enforce / fail-closed) or `"warning"` (observe).
   - `verdictStore.save({ ...verdict, deploymentId, details })`.
   - **`mode === "observe"`:** verdict's `action: "allow"`. Return original output unchanged.
   - **`mode === "enforce"` or fail-closed:** verdict's `action: "block"`. Replace `ctx.skillOutput.messages` with a single message containing the handoff template. `conversationStore.setConversationStatus(sessionId, "human_override")`. `handoffStore.save({ reason: "compliance_concern", payload: { verdictId, sourceGuard, reasonCode, matchId } })`. Return modified output.

**Other failure modes (besides resolver):**
- `verdictStore.save` throws → `console.error`, but still apply the block/handoff actions. Persistence failure must not cause a banned phrase to leak.
- `handoffStore.save` throws → `console.error`, but still apply the block. Conversation status is still flipped; the operator sees the conversation paused even if the handoff envelope is missing.
- `bannedPhraseLoader` throws (boot-time normalization should make this impossible at scan time, but for completeness) → fail closed in `enforce` mode, fail open in `observe` mode. Treat as a `classifier_timeout` reasonCode for the verdict.

The deliberate priority: emission integrity > persistence completeness > observability detail. Block first, then try to record.

## Section 8 — Pre-input gate (channel-gateway)

Insertion point: `packages/core/src/channel-gateway/channel-gateway.ts` between identity resolution (`~line 164`) and `platformIngress.submit()` (`~line 218`). The gate is a private method on `ChannelGateway`, not a hook, because the gateway must short-circuit and not emit anything else for this turn.

**Dependencies added to `ChannelGateway` constructor:**
- `governanceConfigResolver: GovernanceConfigResolver`
- `escalationTriggerLoader: (jurisdiction) => readonly EscalationTriggerEntry[]`
- `verdictStore: GovernanceVerdictStore`
- `modeCache: ModeCache` (shared instance with the output gate, so warm cache spans both gates)
- `handoffStore: HandoffStore` (likely already wired)
- (`conversationStore` and `replySink` are already present)

**Flow:**

1. `resolution = await governanceConfigResolver(deploymentId)`.
2. **`resolution.status === "missing"`** or resolved-with-`mode === "off"` → proceed to `platformIngress.submit()`. Do not persist.
3. **`resolution.status === "error"`** → consult `modeCache.lastKnown(deploymentId)`. If `"enforce"` → fail closed (skip submit, build a verdict with `reasonCode: "classifier_timeout"` and `originalText` = inbound, send handoff, persist). Else → log and proceed to `platformIngress.submit()` (fail open). Do not persist on the fail-open branch.
4. **`resolution.status === "resolved"`** → `modeCache.remember(deploymentId, mode)`. Load triggers for `config.jurisdiction`.
5. `scanForEscalationTriggers(inboundText, triggers)`.
6. **No matches:** proceed to `platformIngress.submit()`. Do not persist.
7. **Match** (or fail-closed from step 3):
   - First match → category → `reasonCode` via `REASON_CODE_BY_TRIGGER`. `originalText` = inbound text. `emittedText` = handoff template (`enforce` or fail-closed) or inbound text (`observe`).
   - `details = { matchCategory, matchId: entry.id, matchedText: match.matched, sentence: match.sentence }`.
   - Build verdict with `sourceGuard: "escalation_trigger"`, `auditLevel: "critical"` (enforce / fail-closed) or `"warning"` (observe).
   - `verdictStore.save({ ...verdict, deploymentId, details })`.
   - **`mode === "observe"`:** verdict `action: "allow"`. Proceed to `platformIngress.submit()`.
   - **`mode === "enforce"` or fail-closed:** verdict `action: "escalate"`. `conversationStore.setConversationStatus(sessionId, "human_override")`. `handoffStore.save({ reason: "compliance_concern", payload: { verdictId, sourceGuard, reasonCode, matchId } })`. `replySink.send(handoffTemplate)`. **Do not call `platformIngress.submit()`.** Return.

**Other failure modes (besides resolver):**
- `verdictStore.save` throws → log, but still apply the escalation. Same priority as the output gate.
- `escalationTriggerLoader` throws → fail closed in `enforce` mode (a true rare condition; the loader runs at boot and is otherwise idempotent), fail open in `observe`.

## Section 9 — Hook registration

`apps/api/src/bootstrap/skill-mode.ts` (~line 216): construct `DeterministicSafetyGateHook` and add to the hook array passed to `SkillExecutorImpl`. **Order matters: `DeterministicSafetyGateHook` runs before `TracePersistenceHook`.** The trace receives the post-block output (the handoff template when blocked); the unsafe pre-block text never lands in trace storage. The pre-block original is captured in `GovernanceVerdict.originalText` and `GovernanceVerdict.details.matchedText`, so the audit story is complete via the verdict store alone — no JOIN with trace required for the unsafe text.

This ordering decision keeps the trace store an unregulated artifact: trace consumers (debugging, analytics, replay) only ever see emitted output. The verdict store is the regulated artifact; access controls and retention policies attach to it specifically.

The plan task that wires registration must verify the existing hook framework respects array order. Reading `packages/core/src/skill-runtime/types.ts:224–233` and `SkillExecutorImpl`'s afterSkill iteration is the first step. If the framework does not guarantee order, an explicit `priority` field or an inserted-position parameter is added in the same task — not deferred.

`ChannelGateway` construction (also in `skill-mode.ts` or its dependencies) gains the new dependencies. `governanceConfigResolver` is a thin adapter over `AgentDeploymentStore.findById(deploymentId)` that wraps:
- the row's `governanceConfig` JSON, validated through `GovernanceConfigSchema`, into `{ status: "resolved", config }` on success;
- a null `governanceConfig` field (or no row) into `{ status: "missing" }`;
- a thrown DB error into `{ status: "error", error }`.

The `ModeCache` is a single shared `Map`-backed instance constructed at bootstrap and injected into both gates so a successful resolution by either gate warms the cache for the other.

## Section 10 — Test fixture coverage

Per the 1a pattern, all assertions go through `GovernanceVerdict` shape — no freeform output matches.

| Surface | Fixture coverage |
|---|---|
| `GovernanceConfigSchema` | Round-trip for each mode; `resolveGovernanceMode(null)` returns `"off"`; rejects unknown jurisdiction/clinicType; passthrough preserves unknown sub-blocks |
| `GovernanceVerdictReasonSchema` extension | Accepts `sensitive_inbound` and `compliance_concern`; existing reasons still parse |
| `GovernanceVerdictSourceSchema` change | Accepts `banned_phrase_scanner` and `claim_classifier`; rejects `claim_scanner` |
| RegExp normalization | `/foo/g` → matched as `/foo/i`; `/Bar/i` preserved; stateful-regex repeated-call test (same loader-loaded entry hits the same input twice without `lastIndex` drift) |
| Banned-phrase tables | Per jurisdiction: 30+ positive (≥5 per category, **conservative seed per Section 2.5**), 50+ true-negative near-miss strings, unique-`id` invariant at loader boot, deterministic ordering of merged loader output |
| Escalation-trigger tables | Per jurisdiction: 10+ positive across all six categories, 20+ true-negative including negation cases (`"I'm not pregnant"` does not trigger; `"my friend had a complaint"` does; `"never had a complaint"` does not). Unique-`id` invariant at loader boot. |
| `scanForBannedPhrases` | Pure-function unit tests — case-insensitivity, multiple matches in one text, regex edge cases, `details.matchId` populated correctly |
| `scanForEscalationTriggers` | Sentence-bounded scoping; per-entry negation suppression; multi-sentence text with one trigger and one negation in different sentences (only the unblocked sentence triggers) |
| `renderHandoffTemplate` | Snapshot per jurisdiction; reasonCode parameter does not change output in 1b-1 |
| `GovernanceVerdictStore` | Round-trip save → list-by-conversation → list-by-deployment; index sanity (since/limit); `details` JSON round-trip |
| `DeterministicSafetyGateHook` | Mode matrix: enforce/observe/off × match/no-match × jurisdiction (12 cases). Asserts: output replacement, conversation status flip, handoff save, verdict persisted with correct reasonCode/sourceGuard/details |
| Pre-input gate (channel-gateway) | Same 12-case matrix. Asserts: `platformIngress.submit()` not called on enforce-match; handoff template sent; verdict persisted; status flipped |
| Hook ordering | `DeterministicSafetyGateHook` runs before `TracePersistenceHook`. Trace store sees emitted (post-block) output only; never sees pre-block unsafe text |
| Resolver failure × cache matrix | `error` + cold cache → fail open (no verdict). `error` + cache `"off"` → fail open. `error` + cache `"observe"` → fail open (consistent with observe-mode pass-through). `error` + cache `"enforce"` → fail closed (verdict with `reasonCode: "classifier_timeout"`, handoff sent). Coverage for both gates. |
| `ModeCache` | Shared instance across both gates; warm-write by either gate makes the other read-warm; `lastKnown` returns `undefined` on miss |
| Persistence-failure fail-open-of-block | `verdictStore.save` throws after match → block/escalate still applied; logged. `handoffStore.save` throws → status still flipped |

## Section 11 — Operability

**Per-deployment activation.** Set `agentDeployment.governanceConfig.deterministicGate.mode = "observe"` to start collecting verdicts on real traffic. Tune banned-phrase tables based on observed false positives. Flip to `"enforce"` once the false-positive rate is acceptable. Roll back by flipping to `"off"`.

**Verdict log.** Queryable via `GovernanceVerdictStore.listByDeployment` and `listByConversation`. The 1b-1 spec ships the store, not a UI. Operators can inspect via direct DB query or Prisma Studio until the dashboard surface lands (out of scope; possibly Phase 3).

**Audit signal.** `auditLevel: "critical"` verdicts in enforce mode are the high-priority signal for the future operator dashboard. `auditLevel: "warning"` (observe-mode matches) is the tuning signal.

**No load-bearing CI gates added in 1b-1.** The reference-audit script from 1a remains a soft gate. The banned-phrase tables don't have an equivalent audit script in 1b-1 — adding one (e.g., `pnpm banned-phrase-audit` for cross-jurisdiction sanity, deduplication, regex linting) is a low-priority follow-up.

## Out of scope (verbatim restatement)

- Phase 1b-2 — claim classifier, substantiation tiers, rewrite policy, classifier latency fallback
- Phase 1c — PDPA consent state machine, AI disclosure, consent-gated outbound
- Phase 1d — WhatsApp 24h window detection, template registration
- Phase 2 — knowledge onboarding UX
- Phase 3 — outcome tagging, pattern detection, recommendations surfacing
- Operator dashboard surface for browsing `GovernanceVerdict` rows
- Rewriting banned content (1b-1 only blocks)
- Sentence-level filtering of outbound (1b-1 is message-level on output; sentence-bounded on input only because that's where negations matter)
- A separate global feature-flag system (mode field IS the flag)
- Operator-configurable handoff template strings
- Per-tenant banned-phrase customization (tables are repo-level in 1b-1)
- Persistent / cross-instance `ModeCache` (per-process is sufficient for the 1b-1 pilot envelope; see Open Question 1)
- Phase 1b-1.5 regulatory expansion of the seed tables (set up the handoff in 1b-1, do the work in 1b-1.5)
- Negation patterns on the output gate's banned-phrase entries (relies on the 1b-2 classifier for intent reasoning)

## Open questions

1. **Persistent `ModeCache`.** The current spec uses a per-process in-memory cache. A horizontally-scaled deployment with N instances has N cold caches. For the 1b-1 traffic envelope (single-tenant pilot, low QPS) this is fine. If the pilot scales before 1b-2 lands, a Redis-backed cache (or just a separate cheap "is this deployment governed?" flag on `AgentDeployment` that the resolver consults independently) is the upgrade path. Surfaced here as a known limit, not a 1b-1 blocker.

2. **Hook framework order guarantee.** Section 9 asserts `DeterministicSafetyGateHook` runs before `TracePersistenceHook`. The plan task that wires registration must read `packages/core/src/skill-runtime/types.ts:224–233` and confirm `SkillExecutorImpl` iterates hooks in registration-array order. If it does not, the same task adds a `priority` (or equivalent) field — this is not a deferral, it is part of the registration task's definition of done.

3. **Phase 1b-1.5 regulatory review handoff.** Section 2.5 says the seed tables are conservative but not exhaustive, and a regulatory review pass expands them. That review is a separate scoped phase (1b-1.5). The 1b-1 PR should include a short follow-up note (file or PR description) naming what the regulatory reviewer needs to expand and a target window. Out of scope to do the review *in* 1b-1; in scope to set it up.

4. **Multi-message outputs.** A skill output may contain multiple messages. Section 7 says "any match in any message → block all messages and emit handoff." This is the conservative policy chosen for 1b-1: a banned phrase mid-conversation signals that the model's reasoning is off, not just one sentence. A more permissive policy (emit clean messages, replace only the offending message) is reachable later if observability shows the conservative policy is too aggressive.
