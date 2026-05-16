# Alex — SG/MY Medical Aesthetic & Beauty Spa Vertical Adaptation

**Date:** 2026-05-10
**Status:** Draft (post-brainstorm, pre-plan)
**Approach:** Fat-skill directory + thin runtime governance guards
**Supersedes:** Earlier informal "Approach A — data-layer deepening" working draft (2026-05-10). The Zod-typed `MarketProfile` schema and three-phase scope from that draft are replaced by the structure below.

## Problem

Alex's current sales/CS conversation style is generic and entirely prompt-disciplined. To convert med spa, medical aesthetic, and beauty spa leads in Singapore and Malaysia on WhatsApp/Instagram DM without regulatory or safety failure, Alex needs:

1. **Runtime regulatory governance** — banned-language, claim-substantiation, and mandatory-escalation enforced *outside* the prompt, on every model output.
2. **Per-deployment compliance posture** — medical aesthetic clinic vs non-medical beauty salon is a deployment flag, not a per-message decision; SG vs MY toggles different jurisdictional rule sets.
3. **Channel-aware routing** — WhatsApp 24-hour session window vs template-only re-engagement is product logic in the harness, not prompt content.
4. **First-class consent state** — for SG, AI disclosure as a transparency / consent-risk control with versioned audit state (Singapore PDPC's 2024 AI advisory is guidelines, not statute — the disclosure is a defensible posture, not a statutory mandate); for MY, explicit consent captured before personal-data processing per PDPA. Tracked as state, not copy.
5. **Vertical voice + conversation craft as data, not code** — SG/MY voice, code-switching norms, intent-class playbooks (price-shop / problem-led / branded-request / aftercare / re-engagement) live as reference markdown loaded just-in-time, not as Zod schemas.

The architecture stays vertical-agnostic; SG/MY medspa is the first instantiation. Med spa specifically because regulatory complexity and conversational nuance compound here — if the architecture works in SG/MY medspa, it generalizes to any vertical with claim-substantiation and consent constraints (financial advice, healthcare, regulated retail).

## Architecture summary

**Thin harness, fat skill** following Anthropic's progressive-disclosure pattern. Single Alex skill becomes a *directory* — thin `SKILL.md` orchestrator (≤500 lines, cache-friendly), fat `references/` loaded just-in-time per intent and jurisdiction. Governance moves to harness-level runtime guards that pre-process every model output before it leaves the system.

```
packages/sdk/skills/alex/
├── SKILL.md                              # ≤500 lines, identity + 4-phase flow + escalation triggers
├── references/
│   ├── markets/
│   │   ├── sg-medspa.md                  # SG voice, code-switching, pacing
│   │   └── my-medspa.md                  # MY voice, Manglish/Bahasa Rojak, pacing
│   ├── regulatory/
│   │   ├── sg-rules.md                   # HCSA + SMC + HSA must-not-say + must-substantiate
│   │   ├── my-rules.md                   # MMC + MAB + KKM + APC/LCP rules
│   │   └── medical-vs-non-medical.md     # Posture toggle reference
│   ├── conversation-patterns/
│   │   ├── price-shop.md
│   │   ├── problem-led.md
│   │   ├── branded-request.md
│   │   └── aftercare.md
│   └── whatsapp-window.md                # Session vs template, Meta categories, button types
└── scripts/                              # Optional deterministic helpers (Phase 2+)
```

The harness does not change shape — Switchboard's existing skill runtime + PlatformIngress already match the "thin harness" pattern. New harness components are governance *tools* (pre-output filters, escalation routing, window check) plugged into the existing flow.

## Design decisions

| Decision | Choice | Rationale |
|---|---|---|
| Skill organization | Fat-skill directory with thin SKILL.md + references/ | Anthropic progressive-disclosure pattern; no context cost for unloaded references; SKILL.md stays cache-friendly |
| Market voice | Reference markdown, **not** Zod schema | `warmupLength: 1` is editorial guess without eval calibration; prose drives the model directly without adding parameters that can drift from intent |
| Governance enforcement | Runtime harness guards on every output | Prompt discipline fails in regulated verticals at scale (Qualtrics 2026: AI CS fails 4× more than other AI); SMC/HCSA/MAB violations are not recoverable |
| Compliance posture | Per-deployment flag (`medical` \| `nonMedical`) | Stable across conversation; affects allowed language surface; not a model decision |
| Consent | First-class state machine | MY PDPA requires explicit consent before personal-data processing; SG PDPC 2024 AI advisory frames AI disclosure as a transparency control. Versioned audit state for both is the defensible posture; copy-only treatment is brittle |
| Generic industry knowledge | None — operator-confirmed only | Generic medspa facts contradict business-specific reality; voice/pattern is generic, *facts* are not |
| Medical knowledge structure | Free-text only on operator side | Structured efficacy fields generate liability; aftercare/pre-care is operator-authored prose |
| Knowledge onboarding (v1) | URL + raw-text paste only | PDF/Instagram extraction is high-risk and high-cost; descope to v1.5+ |
| Multi-agent decomposition | Rejected | 40% of multi-agent pilots fail in 6 months (TechAhead); reliability paradox 95%⁵=77%; coordination tax exceeds gain at this scope |
| Pattern detection surface | Existing Recommendations v1 | New pattern-detection module would compete with shipped recommendations surface for operator attention |
| Markets in v1 | SG, MY medspa only | Architecture supports more; pre-building speculative markets violates YAGNI |
| Channels in v1 | WhatsApp + Instagram DM | Lemon8/Xiaohongshu inbound deferred; both are research channels for leads, not direct DM channels for clinics |

## Section 1 — SKILL.md (thin orchestrator)

`SKILL.md` body holds:
- Identity: who Alex is, what Alex does NOT do (no medical advice, no efficacy guarantees, no before/after sharing)
- 4-phase flow (Respond → Qualify → Convert → Book) — kept from current Alex
- Tool set: `crm-query`, `crm-write`, `calendar-book`, `escalate` — unchanged
- Bucket A/B/C operating boundaries — unchanged
- Reference-load triggers (when to consult `references/markets/*`, `references/conversation-patterns/*`)
- Mandatory escalation rules — duplicated here for the model's awareness even though enforcement is in the harness

Frontmatter strictly `name` + `description` per Anthropic spec (≤1024 chars, third-person, includes both *what* and *when*).

## Section 2 — Reference file governance contract

Every file under `references/` carries metadata frontmatter for auditability and drift control:

```yaml
---
jurisdiction: SG | MY | both | none
vertical: medspa | dental | fitness | generic
clinicType: medical | nonMedical | both
appliesTo: voice | regulatory | pattern | channel
riskLevel: low | medium | high | critical
lastReviewedAt: 2026-05-10
owner: <github-handle>
sources:
  - <url or doc reference>
---
```

`riskLevel: critical` references (regulatory must-not-say lists) require sign-off in PR review. `lastReviewedAt` older than 180 days surfaces as a recommendation in the operator dashboard. The metadata is consumed by a CI check (`pnpm reference-audit`) and by the Phase 3 pattern-detection that suggests "regulatory-rule X hasn't been reviewed since Y."

## Section 3 — Runtime governance guards

Three new tools in the Alex harness, called pre-emit on every model output:

### 3.1 Claim scanner (three layers)

Layer 1 — **Prohibited phrase / category scan.** Substring + regex match against jurisdiction's banned list (e.g., "guaranteed", "100%", "permanent", "best", "fix", "cure", "no side effects", "painless", testimonial-shape patterns). Fast, deterministic, no LLM. Per-jurisdiction tables live in `packages/core/governance/banned-phrases/{sg,my}.ts`.

Layer 2 — **Claim-type classification.** Lightweight model call (cheap model, e.g., Haiku) that classifies any sentence-level claim into: `efficacy | superiority | urgency | testimonial | medical-advice | diagnosis | safety-claim | none`. Operates only on sentences that survive Layer 1.

Layer 3 — **Substantiation requirement.** Operator-typed content is *not* a sufficient substantiation source for regulated claims. A clinic operator may type "visible slimming after one session" into a service description, but that does not entitle Alex to repeat it. Substantiation resolves against three tiered sources, and the source required depends on claim type:

```ts
type SubstantiationSource =
  | "operator_business_fact"      // prices, duration, booking policy, address, hours
  | "approved_compliance_claim"   // reviewed efficacy/safety/comparative claim with named reviewer + reviewedAt + jurisdiction
  | "regulatory_public_source";   // HSA/MDA device approval, MOH/KKM clinic licence, doctor APC/LCP, public certifications
```

Enforcement matrix:

| Claim type | Required source | If missing/stale |
|---|---|---|
| Price / duration / availability / booking policy | `operator_business_fact` | Block + escalate |
| Doctor credentials / device approval / clinic licence | `regulatory_public_source` | Block + escalate |
| Efficacy / safety / superiority / urgency / comparative | `approved_compliance_claim` (must exist + still valid) | Rewrite to non-claim, or escalate |
| Diagnosis / suitability assessment / adverse-reaction handling | None — escalate. Never auto-answer. | Escalate |

The example *"Most clients see visible slimming after one session"* passes Layer 1 (no banned word), Layer 2 classifies as `efficacy`, Layer 3 looks for a matching `approved_compliance_claim` — none exists, so action = `rewrite` to "individual results vary; the doctor will advise during consultation." Even if the operator typed exactly that sentence into a service description, the lack of a reviewed compliance claim is the gating signal.

Failure mode: if Layer 2/3 cannot classify in time (latency budget exceeded), fall back to `block + escalate` — never silently emit. Conservative default. Logged as a quality-of-service metric.

### 3.2 Mandatory escalation triggers

Detected pre-response on inbound, not post-response. Triggers:

- Pregnancy / breastfeeding mentions
- Prior adverse reaction or complication history
- Active medical condition affecting suitability
- Complaint about prior treatment (own or competitor's)
- Competitor naming with negative context
- Multi-treatment combination questions
- Any keyword from the per-jurisdiction sensitive list

On trigger, Alex emits a deterministic handoff message (template, not generated) and creates an escalation:

> "Thanks for sharing that — because this involves a medical or safety detail, I'll get the clinic team to advise you directly. They'll be in touch shortly."

The handoff message is a template per market with localized voice (SG vs MY phrasing). It is *not* a model generation. After emit, the conversation is flagged for human handoff in the operator's queue. Alex does not continue the conversation until a human releases it back.

### 3.3 WhatsApp window check

Pre-emit: determine whether the conversation is in the 24h customer-service window (last inbound from user within 24h) or outside. Inside: free-form. Outside: select an approved template by intent class (`appointment-confirm`, `appointment-reminder`, `aftercare-checkin`, `re-engagement-offer`, `consult-followup`). Templates are jurisdiction-tagged and pre-approved by Meta with HSA/MOH/MAB-compliant copy.

If a free-form response is generated for a conversation outside the window, the harness blocks emit and falls back to the closest matching template (or escalates if no template fits). This is a hard gate.

### 3.4 GovernanceDecision (audit + observability backbone)

Every guard emits a `GovernanceDecision` record on every output. This is the unified event shape that powers audit logs, evals, dashboard visibility, and debug traces. Without it, each guard logs ad-hoc and observability degrades over time.

```ts
type GovernanceDecision = {
  action: "allow" | "rewrite" | "block" | "escalate" | "template_required";
  reasonCode:
    | "allowed"
    | "banned_phrase"
    | "unsupported_claim"
    | "medical_safety_trigger"
    | "outside_whatsapp_window"
    | "consent_missing"
    | "classifier_timeout";
  jurisdiction: "SG" | "MY";
  clinicType: "medical" | "nonMedical";
  sourceGuard: "claim_scanner" | "consent_gate" | "whatsapp_window" | "escalation_trigger";
  originalText?: string;
  emittedText?: string;
  auditLevel: "info" | "warning" | "critical";
  decidedAt: string;          // ISO timestamp
  conversationId: string;
  modelLatencyMs?: number;    // populated for classifier-backed decisions
};
```

Persisted to the WorkTrace audit log (existing surface). `auditLevel: "critical"` decisions surface on the operator dashboard. The decision shape doubles as the **test fixture format** — every governance test asserts an expected `GovernanceDecision` rather than a freeform output match. This is what makes the guard system testable, replayable, and debuggable as it grows.

## Section 4 — BusinessFacts service-field extension

Unchanged from earlier draft. Reproduced here for completeness.

```ts
ServiceSchema = z.object({
  // existing
  name: z.string(),
  description: z.string().optional(),
  durationMinutes: z.number().optional(),
  price: z.number().optional(),
  currency: z.string().optional(),

  // new — operator-authored, optional, no clinical structure
  bookingBehavior: z.enum(["book_directly", "consultation_only", "ask_first"]).optional(),
  prepInstructions: z.string().optional(),
  aftercareNotes: z.string().optional(),
  idealFor: z.string().optional(),
  notSuitableFor: z.string().optional(),
  popularCombinations: z.array(z.string()).optional(),
  consultationRequired: z.boolean().optional(),
});
```

All fields optional. Alex works without them. No structured medical/clinical fields — operator owns free-text content. Alex never generates medical claims from structured data.

## Section 5 — PDPA consent state

First-class state on the lead conversation (`packages/db` + `packages/schemas`):

```ts
ConsentStateSchema = z.object({
  aiDisclosureShownAt: z.string().datetime().optional(),
  aiDisclosureVersion: z.string().optional(),
  marketingConsentStatus: z.enum(["pending", "granted", "denied", "revoked"]),
  dataProcessingConsentStatus: z.enum(["pending", "granted", "denied", "revoked"]),
  consentJurisdiction: z.enum(["SG", "MY"]),
  consentSource: z.enum(["whatsapp_quick_reply", "ig_dm_reply", "web_form", "operator_recorded"]),
  consentVersion: z.string(),                // copy version that was shown
  consentRecordedAt: z.string().datetime().optional(),
  revokedAt: z.string().datetime().optional(),
  revocationReason: z.string().optional(),
});
```

State machine:
- New conversation, jurisdiction = SG → `aiDisclosureShownAt` set on first outbound (disclosure included in opener as a transparency control aligned with PDPC's 2024 AI advisory — this is a defensible posture, not a statutory requirement); `marketingConsentStatus` may stay `pending` (PDPA SG allows deemed consent for narrow B2B; explicit consent is required for marketing communications)
- New conversation, jurisdiction = MY → opener includes explicit-consent prompt with quick-reply buttons; `dataProcessingConsentStatus` must be `granted` before any data processing beyond the operational minimum; `marketingConsentStatus` must be `granted` before any marketing template send
- Outbound emit gate: if jurisdiction = MY and `dataProcessingConsentStatus !== granted`, harness allows only consent-prompt and operational responses; blocks any other outbound until consent is granted or the conversation is closed
- Revocation: `revokedAt` set immediately suppresses all non-operational outbound; audit-trail entry written

Disclosure copy lives in `references/regulatory/{sg,my}-rules.md` and is versioned. A change to disclosure copy creates a new `aiDisclosureVersion`; pre-existing leads are not retroactively migrated but new outbound under their conversation surfaces a re-disclosure if material.

## Section 6 — Knowledge onboarding (URL + paste only, v1)

- Operator pastes a URL or raw text into the dashboard
- Existing `website-scan.ts` extracts what it can; raw-text path is a no-op extractor that just stores the text for the gap-fill form
- Each extracted field gets a confidence score (`high | medium | low`)
- Pre-filled gap-fill form shows confirmed (high), please-verify (medium), and missing (low/empty) fields
- On submit: `BusinessFacts` saved, knowledge entries created, Alex live on next conversation

PDF and Instagram-page extraction descoped to a v1.5 (Phase 2.5) item if and when there's evidence operators want it. URL + paste covers the realistic onboarding path for SG/MY clinic websites and pasted brochure content.

## Section 7 — Pattern detection on Recommendations v1

Conversation outcome tagging extends the existing conversion bus (`inquiry → qualified → booked`) with `stalled` (24h no response after Alex's last reply) and `escalated` (handoff fired).

Periodic analysis (daily batch) per deployment surfaces:
- Knowledge gaps: questions Alex escalated or could not answer, grouped by topic
- Drop-off patterns: last topic/phase before stalled
- Objection frequency vs booking rate
- Winning-pattern deltas: what differs in conversations that booked vs didn't

Output: ranked items pushed to **the existing Recommendations v1 surface** as a new recommendation type (`alex_knowledge_gap`, `alex_pattern_insight`). No new operator surface. Action handlers (e.g., "Add knowledge" → opens knowledge editor pre-filled) wire into existing recommendation action UI.

This is suggestion only — operator decides. Alex does not change its own behavior. No A/B testing. No real-time adaptation.

## Phasing

| Phase | Scope | Surface | Parallel-safe with slices A–E? |
|---|---|---|---|
| **1a** | Skill directory refactor + SG/MY references + BusinessFacts service-field extension + `GovernanceDecision` type | `packages/sdk/skills/alex/`, `packages/schemas` | Yes |
| **1b-1** | Deterministic safety gate: banned-phrase/category scanner, mandatory escalation triggers, deterministic handoff template, `GovernanceDecision` audit emission | `packages/core/governance/`, harness pre-emit | Yes |
| **1b-2** | Claim classifier (Layer 2) + substantiation tiers (Layer 3) + latency fallback + rewrite/block/escalate policy | `packages/core/governance/`, harness pre-emit | Yes |
| **1c** | PDPA consent state machine + jurisdiction-tagged disclosure/consent copy + outbound gates | `packages/db`, `packages/schemas`, `packages/core` | Yes |
| **1d** | WhatsApp window detection + template registration + template re-engagement playbook | `apps/chat`, `packages/core`, template authoring | Yes |
| **2** | Knowledge onboarding (URL + raw-text paste) — gap-fill form + completeness indicator | `apps/dashboard` | **No** — competes with Next.js slice work |
| **3** | Outcome tagging + pattern detection batched into Recommendations v1 | `packages/core` | Yes |

**Sequencing rationale:**
- 1a unblocks everything else by establishing the skill layout, the metadata contract, and the `GovernanceDecision` type that subsequent guards emit
- 1b-1 (deterministic gate) ships before 1b-2 (classifier) so the obvious hard-gates land independently of subjective classifier behavior; 1b-1 alone is a meaningful safety win
- 1c and 1d parallelizable with 1b-1 after 1a — independent PRs by different sessions
- 1b-2 lands after 1b-1 as a strict refinement on the same surface
- 2 deferred until post-launch (or until slices A–E land) — major dashboard surface
- 3 can ride alongside 1b–1d once outcome-tagging extension lands; pattern surfacing follows

Each of 1a–1d is independently shippable behind a feature flag scoped to a single tenant for early validation.

## Operability

**Feature flag.** All Phase 1 work ships behind `alexMedspaSgMyGovernanceV1`, default off, enabled per-tenant during pilot. Each phase landing flips a sub-flag so individual components can be rolled back without reverting the whole stack:

- `alexMedspaSgMyGovernanceV1.skillRefactor` — 1a
- `alexMedspaSgMyGovernanceV1.deterministicGate` — 1b-1
- `alexMedspaSgMyGovernanceV1.claimClassifier` — 1b-2
- `alexMedspaSgMyGovernanceV1.consentState` — 1c
- `alexMedspaSgMyGovernanceV1.whatsappWindow` — 1d

**Test fixtures per phase.** Each phase ships with a fixture set asserted against `GovernanceDecision`:

| Phase | Fixture coverage |
|---|---|
| 1a | Skill metadata loads correctly; reference frontmatter validates against governance contract; BusinessFacts schema migration round-trips; `GovernanceDecision` schema round-trips |
| 1b-1 | 30+ banned-phrase positives per jurisdiction; 10+ escalation-trigger positives; 50+ true-negatives (false-positive guard); deterministic handoff template renders correctly per market |
| 1b-2 | 20+ unsupported-claim positives per claim type; 20+ supported-claim true-negatives; classifier latency budget asserted; fallback-to-block on classifier timeout; substantiation tier resolution per claim type |
| 1c | Consent state transitions exhaustive; outbound gate blocks correctly when MY `dataProcessingConsentStatus !== granted`; AI-disclosure version migration; revocation suppresses non-operational outbound |
| 1d | 24h-window detection on synthetic conversation timelines; template selection per intent class; outside-window block when no template fits; template content passes claim-scanner |
| 3 | Outcome tagging for each terminal state (booked / qualified-not-booked / stalled / escalated / disqualified); recommendation generation for each pattern type; integration with existing Recommendations v1 surface |

**Audit trail.** Every `GovernanceDecision` lands in WorkTrace. `auditLevel: "critical"` decisions also emit a high-priority audit signal that surfaces in the operator dashboard. Pattern detection in Phase 3 reads the decision log to surface emergent compliance risks ("Alex has been blocking efficacy claims for treatment X 12 times this week — consider authoring an `approved_compliance_claim` or removing the marketing copy that prompts the question").

## Out of scope

- PDF, Instagram-page, or Lemon8/Xiaohongshu extraction
- Structured market profiles as Zod schemas (`MarketProfile` from earlier draft)
- Multi-agent intent router or worker decomposition
- Manychat/SleekFlow-style template builder UI for operators (templates authored in repo for v1)
- Before/after image handling (escalate; never auto-share)
- Tamil voice
- Mandarin pure-text DM handling (defer until SG/MY English + Singlish/Manglish baseline lands)
- Automated A/B testing of conversation strategies
- Self-modifying skills (Alex editing its own SKILL.md)
- Markets beyond SG/MY
- Verticals beyond medspa (architecture supports them; pre-building violates YAGNI)
- Real-time pattern adaptation (batch-only, operator-mediated)
- Lemon8/Xiaohongshu inbound channels — research channels only, not DM endpoints

## Open questions

1. **Design partner.** Spec assumes SG/MY medspa is committed direction. Without a named pilot operator, eval signal in Phase 3 will be slow. Resolving who the design partner is gates how aggressively to spec the eval methodology.
2. **Eval methodology.** No formal eval loop in this spec. Reference voice and conversation-pattern files are editorial guesses today. Phase 3 outcome tagging eventually feeds back, but the connection from "warmupLength=2 booked higher" to "edit `references/markets/my-medspa.md`" is manual. Whether to formalize this loop now or post-launch is open.
3. **Template authoring ownership.** WhatsApp templates require Meta approval and HSA/MOH/MAB compliance. Are templates authored by Switchboard staff per tenant, or is this a self-serve operator surface? Affects Phase 1d scope.
4. **`riskLevel: critical` PR review.** Who is the regulatory reviewer for SG vs MY rule changes? In absence of a named human, the CI check is a soft gate.
5. **Branch + PR strategy.** Per CLAUDE.md, specs land on `main` via focused PRs, not feature branches. Current worktree is on `docs/automations-d2-spec`; this spec needs its own branch (`docs/alex-medspa-sg-my-spec`) before commit.
