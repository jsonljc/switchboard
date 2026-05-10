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
4. **`GovernanceVerdictStore`** — Prisma table + repository for persisted verdicts, queryable by deployment, conversation, action, reason, source. The 1a-shipped `GovernanceVerdictSchema` is the row shape.
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
| Hook integration | `SkillHook.afterSkill()` mirroring `TracePersistenceHook` shape | Existing pattern. `apps/api/src/bootstrap/skill-mode.ts` is the single registration site. |
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

export const DEFAULT_GOVERNANCE_CONFIG: Pick<
  GovernanceConfig,
  "deterministicGate"
> = {
  deterministicGate: { mode: "off" },
};
```

`jurisdiction` and `clinicType` are required when `governanceConfig` is present. Deployments without `governanceConfig` (the migration default for existing rows) are treated as `mode: "off"` and never invoke the gate — `jurisdiction`/`clinicType` are not consulted because no scan runs.

`passthrough` lets 1c/1d add `consent` / `whatsappWindow` blocks without a Prisma migration. Each new sub-block goes through its own Zod refinement at use site.

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
  category: BannedPhraseCategory;
  patterns: ReadonlyArray<string | RegExp>;
  severity: BannedPhraseSeverity;
  notes?: string;
}
```

`severity: "rewrite_in_1b2"` is currently treated identically to `"block"` in 1b-1; the field exists so 1b-2 can author rewrite-eligible entries without a schema migration.

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

- Strings are case-insensitive substring matches against the entire output text.
- RegExps are run with the `i` flag; authors are responsible for word-boundary anchors where required to avoid false positives (e.g., `/\bbest\b/i`, not `/best/i`, to skip "bestseller").
- Each entry's `notes` is a one-line authoring rationale (e.g., `"HSA — devices not approved for skin lightening claims"`). Used by reviewers, not by runtime.
- The reference markdown at `skills/alex/references/regulatory/{sg,my}-rules.md` should mention the categories and reference the TS file path; it is not the source of truth and can drift in tone, but the categories must match.

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
}
```

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

### 4.1 Banned-phrase scanner

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

Pure function. Returns all matches across all entries for diagnostics / fixture authoring. Caller decides what to do with multiple matches (1b-1: any match → block; reasonCode comes from the first match's category).

### 4.2 Escalation-trigger scanner

Mirror shape:

```ts
export interface EscalationTriggerMatch {
  entry: EscalationTriggerEntry;
  matched: string;
  index: number;
}

export function scanForEscalationTriggers(
  text: string,
  entries: ReadonlyArray<EscalationTriggerEntry>,
): EscalationTriggerMatch[];
```

Both scanners are pure, synchronous, allocation-light. False-negative risk is the authoring quality of the tables; false-positive risk is mitigated by anchored regex authoring and a true-negative fixture set per jurisdiction.

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
export interface GovernanceVerdictRecord extends GovernanceVerdict {
  id: string;
  deploymentId: string;
  createdAt: string;
}

export interface SaveGovernanceVerdictInput extends GovernanceVerdict {
  deploymentId: string;
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

`packages/core/src/governance/governance-verdict-store/prisma-governance-verdict-store.ts` implements the interface using the Prisma client, mirroring the existing prisma-store conventions.

The store does not enforce policy. Callers (the gate hook, the gateway pre-input check) decide whether to persist.

## Section 7 — Pre-output gate hook

`packages/core/src/skill-runtime/hooks/deterministic-safety-gate.ts`:

```ts
export interface DeterministicSafetyGateHookDeps {
  governanceConfigResolver: (deploymentId: string) => Promise<GovernanceConfig | null>;
  bannedPhraseLoader: (jurisdiction: "SG" | "MY") => readonly BannedPhraseEntry[];
  verdictStore: GovernanceVerdictStore;
  handoffStore: HandoffStore;
  conversationStore: ConversationStateStore;
  clock: () => Date;
}

export class DeterministicSafetyGateHook implements SkillHook {
  constructor(deps: DeterministicSafetyGateHookDeps);
  async afterSkill(ctx: AfterSkillContext): Promise<AfterSkillOutcome>;
}
```

`AfterSkillOutcome` either passes the original output through, or replaces it with the handoff template. Mirrors `TracePersistenceHook` shape.

**Flow inside `afterSkill`:**

1. Resolve `governanceConfig` for the deployment. If null or `mode === "off"` → return original output unchanged. Do not persist.
2. Load banned phrases for `jurisdiction`.
3. For each outbound message in `ctx.skillOutput.messages`, run `scanForBannedPhrases`.
4. **No matches across all messages:** return original output unchanged. Do not persist.
5. **One or more matches:**
   - First match's category → `reasonCode`. `originalText` = the matched message text. `emittedText` = handoff template (`enforce`) or matched message (`observe`).
   - Build `GovernanceVerdict` with `sourceGuard: "banned_phrase_scanner"`, `auditLevel: "critical"` (enforce) or `"warning"` (observe).
   - `verdictStore.save({ ...verdict, deploymentId })`.
   - **`mode === "observe"`:** verdict's `action: "allow"`. Return original output unchanged.
   - **`mode === "enforce"`:** verdict's `action: "block"`. Replace `ctx.skillOutput.messages` with a single message containing the handoff template. `conversationStore.setConversationStatus(sessionId, "human_override")`. `handoffStore.save({ reason: "compliance_concern", payload: { verdictId, sourceGuard, reasonCode } })`. Return modified output.

**Failure modes:**
- `governanceConfigResolver` throws → `console.error`, return original output (fail-open in 1b-1; the channel-gateway pre-input gate is the primary defense and cannot suffer the same fail-open risk because it controls submission). Logged as a quality-of-service metric.
- `verdictStore.save` throws → `console.error`, but still apply the block/handoff actions. Persistence failure must not cause a banned phrase to leak.
- `handoffStore.save` throws → `console.error`, but still apply the block. Conversation status is still flipped; the operator sees the conversation paused even if the handoff envelope is missing. A manual nudge from the operator can then advance the conversation.

The fail-open / fail-closed asymmetry is deliberate: the most important guarantee is "banned phrase does not get emitted in enforce mode," and that holds even if persistence fails. Persistence is best-effort; emission is not.

## Section 8 — Pre-input gate (channel-gateway)

Insertion point: `packages/core/src/channel-gateway/channel-gateway.ts` between identity resolution (`~line 164`) and `platformIngress.submit()` (`~line 218`). The gate is a private method on `ChannelGateway`, not a hook, because the gateway must short-circuit and not emit anything else for this turn.

**Dependencies added to `ChannelGateway` constructor:**
- `governanceConfigResolver: (deploymentId: string) => Promise<GovernanceConfig | null>`
- `escalationTriggerLoader: (jurisdiction) => readonly EscalationTriggerEntry[]`
- `verdictStore: GovernanceVerdictStore`
- `handoffStore: HandoffStore` (likely already wired)
- (`conversationStore` and `replySink` are already present)

**Flow:**

1. Resolve `governanceConfig`. If null or `mode === "off"` → proceed to `platformIngress.submit()`.
2. Load triggers for jurisdiction.
3. `scanForEscalationTriggers(inboundText, triggers)`.
4. **No matches:** proceed to `platformIngress.submit()`.
5. **Match:**
   - First match → category → `reasonCode`. `originalText` = inbound text. `emittedText` = handoff template (`enforce`) or inbound text (`observe`).
   - Build verdict with `sourceGuard: "escalation_trigger"`, `auditLevel: "critical"` (enforce) or `"warning"` (observe).
   - `verdictStore.save(...)`.
   - **`mode === "observe"`:** verdict `action: "allow"`. Proceed to `platformIngress.submit()`.
   - **`mode === "enforce"`:** verdict `action: "escalate"`. `conversationStore.setConversationStatus(sessionId, "human_override")`. `handoffStore.save({ reason: "compliance_concern", payload: { verdictId, sourceGuard, reasonCode } })`. `replySink.send(handoffTemplate)`. **Do not call `platformIngress.submit()`.** Return.

**Failure modes:**
- `governanceConfigResolver` throws in `enforce` mode → fail closed: skip submission, send handoff, log error. The pre-input gate is the only barrier between an inbound trigger and the model; failing open here would defeat the gate's purpose.
- `verdictStore.save` throws → log, but still apply the escalation. Same priority order as the output gate.

## Section 9 — Hook registration

`apps/api/src/bootstrap/skill-mode.ts` (~line 216): construct `DeterministicSafetyGateHook` and add to the hook array passed to `SkillExecutorImpl`. Order matters: `DeterministicSafetyGateHook` must run **after** `TracePersistenceHook` so the trace persistence sees the original (pre-block) output. Otherwise the audit trail would lose the unsanitized text that the verdict's `originalText` is meant to capture from the trace.

`ChannelGateway` construction (also in `skill-mode.ts` or its dependencies) gains the new dependencies. `governanceConfigResolver` is a thin adapter over the `AgentDeploymentStore`.

## Section 10 — Test fixture coverage

Per the 1a pattern, all assertions go through `GovernanceVerdict` shape — no freeform output matches.

| Surface | Fixture coverage |
|---|---|
| `GovernanceConfigSchema` | Round-trip for each mode; default population; rejects unknown jurisdiction/clinicType; passthrough preserves unknown sub-blocks |
| `GovernanceVerdictReasonSchema` extension | Accepts `sensitive_inbound` and `compliance_concern`; existing reasons still parse |
| `GovernanceVerdictSourceSchema` change | Accepts `banned_phrase_scanner` and `claim_classifier`; rejects `claim_scanner` |
| Banned-phrase tables | Per jurisdiction: 30+ positive (≥5 per category), 50+ true-negative near-miss strings, deterministic ordering of merged loader output |
| Escalation-trigger tables | Per jurisdiction: 10+ positive across all six categories, 20+ true-negative (e.g., `"I'm not pregnant"` does not trigger; `"my friend had a complaint"` does) |
| `scanForBannedPhrases` / `scanForEscalationTriggers` | Pure-function unit tests — case-insensitivity, multiple matches in one text, regex edge cases |
| `renderHandoffTemplate` | Snapshot per jurisdiction; reasonCode parameter does not change output in 1b-1 |
| `GovernanceVerdictStore` | Round-trip save → list-by-conversation → list-by-deployment; index sanity (since/limit) |
| `DeterministicSafetyGateHook` | Mode matrix: enforce/observe/off × match/no-match × jurisdiction (12 cases). Asserts: output replacement, conversation status flip, handoff save, verdict persisted with correct reasonCode and sourceGuard |
| Pre-input gate (channel-gateway) | Same 12-case matrix. Asserts: `platformIngress.submit()` not called on enforce-match; handoff template sent; verdict persisted; status flipped |
| Hook ordering | Trace persistence sees pre-block output; verdict store sees the same `originalText` |
| Fail-open/fail-closed | Output gate: governanceConfigResolver throws → original output emitted (fail-open). Input gate: governanceConfigResolver throws in enforce → submit() not called, handoff sent (fail-closed). Both: verdictStore.save throws → block/escalate still applied |

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
- Sentence-level filtering (1b-1 is message-level)
- A separate global feature-flag system (mode field IS the flag)
- Operator-configurable handoff template strings
- Per-tenant banned-phrase customization (tables are repo-level in 1b-1)

## Open questions

1. **Hook execution order with `TracePersistenceHook`.** Section 9 asserts the deterministic gate must run after the trace hook so the audit trail captures the pre-block text. The plan task that wires this should verify the existing hook framework respects array order — if not, an `order` field or explicit `dependsOn` may be required.
2. **Backfill for existing `AgentDeployment` rows.** The migration leaves `governanceConfig` nullable, treated as `mode: "off"`. The first medspa pilot tenant gets the field set explicitly. No bulk backfill is needed for non-medspa deployments. If a non-medspa deployment later needs the gate, the operator UI for setting `governanceConfig` is part of the medspa onboarding flow (Phase 2) or a manual DB write until then.
3. **Authoring the initial banned-phrase tables.** The spec specifies the table shape and authoring contract, not the contents. The plan should include a placeholder pass: enough entries per category (≥5 each) to exercise the test fixtures, with a clear comment that production-ready content is a Phase 1b-1.5 review pass with regulatory input. The 1a reference markdowns under `skills/alex/references/regulatory/` already capture the must-not-say language and can be the authoring source.
4. **Multi-message outputs.** A skill output may contain multiple messages. Section 7 says "any match in any message → block all messages and emit handoff." That is conservative. A more permissive policy would emit clean messages and replace only the offending message with the handoff. 1b-1 picks the conservative policy: a banned phrase mid-conversation is a signal that the model's reasoning is off, not just one sentence. The plan can make this configurable later if observability shows it is too aggressive.
