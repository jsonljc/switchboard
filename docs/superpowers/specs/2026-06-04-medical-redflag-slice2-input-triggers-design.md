# Medical Red-Flag Slice 2: Deterministic Input-Layer Triggers (Design Spec)

- **Date:** 2026-06-04
- **Status:** Draft (pending user review at check-in #1)
- **Branch:** `feat/alex-medical-redflag-slice2` (spec + plan + code in one branch, per session directive)
- **Verified against:** `origin/main` @ `81f0325f`
- **Predecessors:** #791/#793 (Slice 1, prompt-only), #843 (freeze-gate trigger narrowing), #870 (observe-mode activation + medspa pilot seed)

---

## 1. Problem

The 2026-06-01 baseline verification (3-agent adversarial workflow + live-code checks)
proved that three medical red-flag categories slip past BOTH defense layers in a medspa
product:

1. **Anticoagulants / blood thinners** (+ injectable treatment): bleeding/hematoma risk.
2. **Changing / darkening / suspicious mole or lesion**: classic melanoma warning; lasering
   an evolving lesion can delay a cancer diagnosis.
3. **Recent in-area surgery** (+ energy device): energy on healing post-surgical tissue.

They slip the **deterministic pre-input gate** because `escalation-triggers/common.ts` has
no patterns for them (re-verified on `origin/main` @ `81f0325f`: the table covers
pregnancy/breastfeeding, prior adverse reaction, major conditions, mental health, minors,
complaints, competitor-negative, treatment combos; nothing for the three above). They
historically slipped **Alex's prose layer** too; #791 closed the prose side (SKILL.md
red-flag block), but a prompt rule is probabilistic. This slice makes the deterministic
floor real for all three.

**Why now:** #870 (merged 2026-06-04, squash `b0c1a30b`) seeded the medspa pilot with
`deterministicGate.mode: "observe"` via `MEDSPA_PILOT_GOVERNANCE_CONFIG`. The pre-input
gate now runs log-only against real pilot traffic. New trigger patterns start emitting
`escalation_trigger` verdicts + `switchboard_governance_verdicts_total` telemetry the
moment they land, with zero lead-visible change. The off-to-enforce flip stays the ops
change it already is.

## 2. Verify-first findings (what moved under the 2026-06-01 snapshot)

| Claim from task framing | Current reality on `origin/main` @ `81f0325f` | Consequence |
|---|---|---|
| 3 trigger gaps exist in `common.ts` | **Still true.** Last taxonomy touch is #843 (`e8bf6712`); no anticoagulant/lesion/surgery patterns | Core scope stands |
| `claim-boundaries.md:31` counter-instructs escalation | **Stale.** #791 already replaced the closing line with the red-flag carve-out ("a genuine medical red flag ... is not a claims question: escalate it") | **Dropped from scope** |
| SKILL.md needs defense-in-depth wording | **Done.** #791 shipped the full tool-call-first block (`skills/alex/SKILL.md:283-333`) listing all four red flags, negative examples, consult-redirect carve-outs | **Dropped from scope** |
| Deterministic-gate handoffs hardcode `compliance_concern` | **True**, but in the input gate's own inline builder (`pre-input-gate.ts:342-360`, two call sites at `:176` and `:328`), not the shared `handoff/build-handoff-package.ts` (that one serves the four OUTPUT gates + consent service and stays untouched) | Reason mapping is surgically scoped to the input gate |
| #870 observe seed + verdict counter on main | **Confirmed.** `packages/db/src/seed/medspa-governance-config.ts:10-13` (SG/medical via `buildObserveGovernanceConfig`), counter wired via `PrismaGovernanceVerdictStore` `onWrite` at both bootstraps (`gateway-bridge.ts:142-144`) | Telemetry-first rollout rides existing machinery |
| `medical_safety` needs a dashboard label | **Already labeled** ("Medical red flag", `handoff-detail-sheet.tsx:15-26`, exhaustive `Record<HandoffReason, string>`) | No dashboard change; full `pnpm typecheck` confirms |

**Slice ranking sanity (task d):** still the highest-leverage shippable slice. It is the
only candidate that is simultaneously (a) a bright-line patient-safety gap, (b) made
immediately observable by #870's observe seed (bake data accrues from merge day), and
(c) disjoint from every active session (Riley v3 = ad-optimizer; Mira slice-2 = creative
pipeline; parked approvals = platform/approval path; aesthetic = dashboard CSS). WhatsApp
observe-verdict normalization matters only before the `whatsappWindow` enforce flip
(later in the rollout order); ops bake actions are ops, not code. No re-rank.

## 3. The live path (mapped, for reviewers)

```
apps/chat gateway-bridge.ts
  wires: createAgentDeploymentGovernanceResolver, loadEscalationTriggers,
         PrismaGovernanceVerdictStore({onWrite: recordGovernanceVerdictMetric}),
         InMemoryGovernancePostureCache, PrismaHandoffStore, status-setter adapter
  startup-asserts all six deps (gateway-bridge.ts:224-237)
        |
        v
ChannelGateway.handleIncoming -> runPreInputGate (channel-gateway.ts:286-297)
  resolve governanceConfig -> resolveGovernanceMode (schemas/governance-config.ts:24)
  mode off:     return false, persist nothing
  mode observe: scan -> verdict {action: allow, auditLevel: warning} -> return false (submit proceeds)
  mode enforce: scan -> verdict {action: escalate, auditLevel: critical}
                -> status human_override -> handoff (reason hardcoded compliance_concern)
                -> replySink.send(jurisdiction template) -> return true (submit skipped)
  resolver error + cached enforce posture: fail-closed scan path (pre-input-gate.ts:210-340)
        |
        v
scanForEscalationTriggers (per-sentence; per-ENTRY negation suppression)
  over loadEscalationTriggers(jurisdiction) = COMMON + (SG | MY)
```

The trigger taxonomy's only non-test consumers are `REASON_CODE_BY_TRIGGER`
(`escalation-triggers/types.ts:19`, exhaustive `Record`) and the gate itself.
`runPreInputGate` has exactly one caller. Blast radius is fully enumerable.

## 4. Design

### 4.1 Three new trigger categories + entries (the core)

Extend `EscalationTriggerCategory` with three members and add one `common.ts` entry per
category (these are universal medical-safety concerns, not jurisdiction-specific, so they
belong in the COMMON table; SG/MY tables untouched):

| Category | Entry id | Verdict reason (`REASON_CODE_BY_TRIGGER`) |
|---|---|---|
| `anticoagulant_use` | `anticoagulant_use` | `medical_safety_trigger` |
| `suspicious_lesion` | `suspicious_lesion` | `medical_safety_trigger` |
| `recent_procedure` | `recent_procedure` | `medical_safety_trigger` |

`REASON_CODE_BY_TRIGGER` is an exhaustive `Record`, so the compiler forces the mapping
(one of the adversarial bites). `GovernanceVerdictReason.medical_safety_trigger` already
exists (the #791 seam-reuse finding); **no schemas change anywhere in this slice**.

**Pattern philosophy (calibration, locked to Slice-1 list):**

- **High precision, conservative recall.** Over-firing drowns medspa staff once enforce
  flips. Every pattern requires either an unambiguous term (warfarin, melanoma,
  "blood thinners", "post-op") or a compound condition (lesion noun + change qualifier;
  surgery noun + recency marker).
- **The disclosure alone fires; no same-sentence treatment co-occurrence required.**
  The locked Slice-1 list phrases two flags as compounds ("anticoagulants + injectable",
  "recent surgery + energy device"). A per-sentence scanner cannot see the compound in
  the dominant real flow: Alex asks "any medications?" and the lead answers "warfarin"
  in a bare reply. The conversation supplies the treatment context (every medspa intake
  is a treatment inquiry), so requiring the treatment term in the same sentence would
  structurally miss the qualification-answer flow that motivated this slice. The
  change-qualifier on lesions and the recency-marker on surgery preserve precision where
  the noun alone genuinely is ambiguous ("remove a mole" is a routine service request;
  "a mole that's been darkening" is the red flag). This is a deliberate, flagged
  calibration call; the observe bake measures real-world fire rates before any enforce
  flip, and patterns can be tightened on data without an ops round-trip.
- **Controlled/managed conditions stay consult-redirects.** Nothing here matches
  thyroid/Hashimoto/lupus or any managed-condition phrasing; the locked Slice-1
  calibration is not broadened.
- **Negation + third-party guards on every entry** (the #843 style): self-negation
  ("I'm not on blood thinners") and family attribution ("my mum had a melanoma") with
  tight windows, curly-apostrophe tolerant (`don['’]?t`). Deliberate asymmetry on
  cessation: "stopped warfarin last month" is NOT suppressed (recent cessation before a
  procedure is itself a clinician question), unlike pregnancy's "no longer pregnant"
  (definitively resolved state).
- Present-tense discipline applies where first-person state is claimed (mirrors the
  #843 minor-trigger lesson).

**Sketch of the entries** (exact regexes finalized in implementation with a fixture per
pattern; this is the calibration intent):

`anticoagulant_use`:
- class terms, fire alone: `blood thinner(s)/thinning`, `anticoagulant(s)`, `antiplatelet(s)`
- named drugs, fire alone: warfarin, coumadin, heparin, apixaban/Eliquis,
  rivaroxaban/Xarelto, dabigatran/Pradaxa, edoxaban, clopidogrel/Plavix
- aspirin ONLY in therapy phrasing ("on/taking/prescribed (daily|low-dose|baby) aspirin",
  "aspirin daily/everyday/therapy/regimen"); a casual "took an aspirin for my headache"
  stays silent
- negations: not/never/don't/do not/haven't + term (window ~16 chars); third-party
  relative + term

`suspicious_lesion`:
- lesion noun (mole/spot/patch/birthmark/freckle/lesion/growth/lump/bump) + change or
  concern qualifier in the same clause, both orders ("mole that's been darkening",
  "suspicious mole"); qualifier list: changing/changed, growing/grown, darker/darkening,
  bigger, bleeding/bled, itchy/itching, crusty/crusting, scabbing, flaky, painful/hurts,
  raised, irregular, asymmetric, uneven, jagged, suspicious, concerning, worrying,
  weird/strange/odd, newly appeared
- `new mole/lesion/growth` (tight adjacency only; "new spot" excluded because acne/
  pigmentation "new dark spots" are routine medspa requests)
- `melanoma(s)` fires alone ("skin cancer" already fires today via the `cancer` pattern
  in `sensitive_keyword_medical_condition`)
- negations: stable/unchanged disclosures ("hasn't changed"); third-party relative +
  lesion noun
- routine pigmentation/melasma/"dark spots" requests stay silent by construction (no
  change qualifier)

`recent_procedure`:
- "just/recently had|got|underwent" + surgical noun (surgery, operation, procedure,
  facelift, liposuction/lipo, rhinoplasty/nose job, blepharoplasty/eyelid surgery,
  tummy tuck/abdominoplasty, implants, thread lift)
- surgical noun + recency marker ("3 weeks ago", "last month", "this week"); months
  bounded to ~six ("14 months ago" is not "recent")
- healing-state disclosures: "post-op", "recovering/healing from <surgical noun>",
  "still have stitches/sutures", "stitches from"
- future/desire phrasing never fires ("want a nose job", "surgery next month": no
  past-tense verb or past recency marker)
- negations: "no/never/haven't had surgery"; third-party relative + surgical noun

### 4.2 Handoff reason mapping (the #791 seam-reuse finding)

`buildInputHandoffPackage` (`pre-input-gate.ts:342`) hardcodes `reason:
"compliance_concern"` for every enforce-mode block. Route it through the trigger
category instead, derived from the single source of truth:

```ts
// escalation-triggers/types.ts
export function handoffReasonForTriggerCategory(category: EscalationTriggerCategory): HandoffReason {
  return REASON_CODE_BY_TRIGGER[category] === "medical_safety_trigger"
    ? "medical_safety"
    : "compliance_concern";
}
```

- `buildInputHandoffPackage` gains a `reason` parameter; both call sites (main enforce
  path `:176`, fail-closed path `:328`) pass
  `handoffReasonForTriggerCategory(firstEntry.category)`.
- Deriving from `REASON_CODE_BY_TRIGGER` (instead of a second exhaustive Record) keeps
  one calibration axis: a future category is medical iff its verdict reason says so.
- **Scope note (flagged):** this also routes the two existing medical categories
  (`pregnancy_breastfeeding`, `prior_adverse_reaction`) to `medical_safety`. That is the
  semantically correct label (#791 added the reason for exactly this), the dashboard
  label exists, and the change is invisible until enforce mode runs somewhere (observe
  never creates handoffs; nothing runs enforce today). Non-medical categories
  (complaints, competitor, combos, sensitive keywords incl. minors/mental-health) keep
  `compliance_concern`, exactly today's behavior; broadening their labels is not this
  slice.
- `renderHandoffTemplate` ignores `reasonCode` (jurisdiction-only output, reserved
  parameter), so the lead-visible enforce text is unchanged even in enforce.
- Existing test pin flips visibly: `channel-gateway-deterministic-gate.test.ts:377`
  (`expect(handoffPkg.reason).toBe("compliance_concern")` for a pregnancy match) is
  updated to `"medical_safety"`, which documents the behavior change in the diff.

### 4.3 Per-MATCH negation suppression (the #843 documented limitation, folded in)

**Decision: include it.** The optional item from the task framing lands cleanly here and
is load-bearing for the new entries' negation safety.

Today the scanner suppresses an entry for a whole sentence when ANY negation matches
that sentence (`escalation-trigger-scanner.ts:62`). WhatsApp messages are frequently
punctuation-free run-ons (the splitter only breaks on `[.!?\n]`), so one suppressing
clause swallows a genuine disclosure in the same breath:

- "I'm not on aspirin but I do take warfarin daily" → anticoagulant entry suppressed
  entirely (the warfarin disclosure is lost)
- "my mum had cancer and I have diabetes" → the #843-documented over-suppression

**New semantics:** a pattern occurrence is suppressed iff its span **overlaps** a
negation match span in the same sentence; the entry matches iff any pattern has any
unsuppressed occurrence (first such occurrence reported).

- Overlap (not containment) is required for correctness of windowed negations: in
  "I'd rather not combine botox and filler", the negation span ends at "combine" while
  the pattern span runs to "filler"; containment would un-suppress it (a regression),
  overlap keeps it suppressed.
- Every existing suppression test keeps passing (the negation span always overlaps the
  occurrence it guards, by construction of the `negword [window] term` regex shape).
  The only behavior flips are disjoint-clause sentences, which start firing: that is
  precisely the bug #843 documented, in the safe direction (recall on genuine
  disclosures), and it lands under observe on the pilot.
- Implementation: collect all negation spans per sentence (global regex scan), iterate
  pattern occurrences per pattern (not just the first), skip overlapped ones.
  ~40 lines in the scanner, zero signature changes.

### 4.4 What does NOT change (hard boundaries)

- **No mode flips, no new knobs.** `deterministicGate.mode` semantics, the observe
  machinery, `buildObserveGovernanceConfig`, the seed, and the verdict-store `onWrite`
  metric slot are untouched. No new env flag, no operator dial.
- **INPUT layer only.** The four afterSkill output gates, `handoff/build-handoff-package.ts`
  (their shared builder), the claim classifier (locked baseline `6aed7131cf224c76` +
  prompt-hash, #631 bake), and `skill-runtime/**` are untouched.
- **No schemas/db/dashboard/apps changes.** The slice is `packages/core` + tests
  (+ this spec/plan). No migration (no schema fields touched), no eval-harness change.
- **No skills prose changes.** #791 already shipped both prose items (verified §2).
  `skillContentHash` is metadata-only (stamped at `--write-baseline`, never gates), so
  even prose edits would not force a baseline regen; moot here.
- **Lead-visible behavior is byte-identical at merge and under the seeded observe
  posture.** Off-mode deployments: gate returns before scanning. Observe (the pilot):
  scan + verdict write only; submit proceeds with the unchanged message; no handoff, no
  status flip, no reply-sink call. Enforce: not seeded anywhere; behavior changes there
  are the (already documented) point of the slice and remain ops-gated.

### 4.5 Slice-2 hook decision: pre-input taxonomy extension is sufficient; no ContraindicationGateHook

The #791 spec §7 designed a deferred afterSkill `ContraindicationGateHook` on the
premise that "no hook phase currently receives the inbound lead message." That premise
described the skill-runtime hook contract, but the platform already has an input-layer
deterministic net **upstream of the executor**: `runPreInputGate` scans every inbound
lead message between identity resolution and `platformIngress.submit()`, wired live in
`apps/chat` with a startup assertion on all six deps (the 2026-06-01 finding: "the gate
EXISTS, do not build a Slice-2 hook"). Evidence-based comparison:

| | Pre-input gate (extend) | ContraindicationGateHook (build) |
|---|---|---|
| Sees inbound lead text | Yes, raw, pre-submit | Needs `afterSkill(ctx, result, messages)` contract extension across executor + all hooks |
| Enforcement point | Before Alex generates (lead never gets an un-flagged reply) | After generation (intercepts the reply) |
| Detection granularity | Single message | Single message (identical; "latest lead message(s)") |
| New surface | 3 enum members + entries | New hook + contract change + idempotency guard + wiring |
| Rollout | Rides #870 observe -> bake -> enforce | New activation path to design |

The hook adds no detection capability (same single-message granularity), enforces at a
weaker point, and requires a contract change; the gate extension is strictly cheaper and
strictly earlier. **Skip the hook.** The one capability neither layer has, cross-message
accumulation (red flag split across turns: "I'm on medication" ... "the blood ones"),
is real but out of scope for a deterministic regex net at either seam; the prompt layer
(#791's SKILL.md block, which sees full conversation context) is the net for that, and
the observe bake will show whether a stateful accumulator is ever worth building.

## 5. Test strategy (load-bearing; the #843 lesson)

The alex-conversation eval drives the executor, not the channel gateway, so it cannot
see any of this (it runs ungoverned `[]` hooks by design). Coverage lives at three
layers, all blocking vitest:

1. **Trigger-unit layer** (`escalation-triggers/__tests__/common.test.ts` pattern):
   a fixture block per new entry: fires on canonical phrasings (incl. curly-apostrophe +
   run-on/no-punctuation forms), silent on negations, third-party attribution,
   controlled-condition phrasings, routine service requests ("remove a mole", "dark
   spots from acne", "want a nose job", "took an aspirin yesterday"), and adult/
   non-recency uses. Update the loader exhaustive-category test (6 -> 9) and entry-floor
   expectations.
2. **Scanner layer** (`escalation-trigger-scanner.test.ts`): per-match overlap
   semantics: disjoint-clause sentences fire ("not on aspirin but warfarin daily",
   "my mum had cancer and I have diabetes"), overlapped occurrences stay suppressed
   ("rather not combine botox and filler"), multi-occurrence iteration, string-pattern
   parity.
3. **Real-gate integration layer** (`channel-gateway-deterministic-gate.test.ts`, new
   describe block following the existing "freeze-gate live path" pattern): drives
   `ChannelGateway.handleIncoming` with the REAL `loadEscalationTriggers` and a resolver
   returning the REAL seeded posture `buildObserveGovernanceConfig({jurisdiction: "SG",
   clinicType: "medical"})` (the same factory call the #870 seed pins via its
   producer-parity test, so the test posture IS the seeded posture by construction):
   - observe + each of the 3 red-flag messages: verdict `{action: "allow", auditLevel:
     "warning", reasonCode: "medical_safety_trigger", sourceGuard: "escalation_trigger"}`
     persisted, `details.matchCategory` correct, **submit called with the unchanged
     text, normal AI reply sent, no handoff, no status flip** (proves log-only +
     byte-identical lead behavior under the seeded posture)
   - enforce variant (the future ops flip): submit NOT called, handoff saved with
     `reason: "medical_safety"`, status `human_override`, jurisdiction template sent
   - fail-closed cached-enforce path carries the medical reason too
4. **Adversarial bite (demonstrated, not assumed):** during implementation, (a) remove
   one new pattern -> trigger-unit + integration tests red; (b) revert the
   `REASON_CODE_BY_TRIGGER` entry -> typecheck red (exhaustive Record); (c) revert the
   handoff-reason call-site -> integration test red. Evidence recorded in the PR body.

## 6. Acceptance criteria

1. The 3 verified red-flag gaps are caught deterministically at the input layer with
   high precision: negation, third-party, and controlled-condition guards proven by
   trigger-unit tests; per-match scanner semantics proven at the scanner layer.
2. Enforce-mode handoffs for medical trigger categories carry `reason: "medical_safety"`
   (both gate paths); non-medical categories unchanged; dashboard typecheck green with
   zero dashboard changes.
3. Behavior is byte-identical at merge and log-only under the seeded observe posture,
   proven by the real-gate integration test using `buildObserveGovernanceConfig` (the
   real seeded posture), not a hand-built config literal.
4. At least one adversarial bite demonstrated (pattern removal reds tests; evidence in
   PR).
5. Classifier baseline/prompt-hash and alex-conversation baseline untouched (no files
   under `governance/classifier/**`, no eval fixtures/harness changes).
6. Full local gate green modulo documented flakes (chat gateway-bridge-attribution under
   full-suite load; db pg_advisory/ledger/greeting without local Postgres; `Eval - Claim
   Classifier` red on main = #631 bake, not ours).
7. This spec records the ContraindicationGateHook build-vs-skip decision with evidence
   (§4.5).
8. PR open to `main`, NO auto-merge; spec + plan + code in one branch.

## 7. Rollout posture

Unchanged from #870's staged doctrine: merge = silent for off-mode deployments, log-only
on the observe-seeded pilot. Bake reads `GovernanceVerdict` rows
(`sourceGuard = "escalation_trigger"`, `details.matchCategory` in the three new values)
plus `switchboard_governance_verdicts_total{source_guard="escalation_trigger"}`. The
enforce flip remains a deliberate ops config change, reviewed against bake data
(fire-rate per category; tighten patterns first if any category is noisy). Reminder from
#870 (unchanged by this slice): `deterministicGate.mode` is shared by this input scanner
and the output safety gate; decouple before any deterministicGate enforce flip if the
two layers need different postures.
