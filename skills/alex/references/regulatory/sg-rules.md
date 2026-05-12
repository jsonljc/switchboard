---
jurisdiction: SG
vertical: medspa
clinicType: medical
appliesTo: regulatory
riskLevel: critical
lastReviewedAt: "2026-05-10"
owner: jasonli
sources:
  - "https://www.moh.gov.sg/licensing-and-regulation/regulations-guidelines-and-circulars/details/guidelines-on-aesthetic-practices-for-doctors"
  - "https://www.smc.gov.sg/for-professionals/regulations-guidelines-circulars/ethical-code-and-ethical-guidelines-and-handbook-on-medical-ethics/"
  - "https://www.hsa.gov.sg/therapeutic-products/advertisements"
---

# SG aesthetic clinic — must-not-say & must-substantiate

> **TODO — Phase 1a placeholder for governance contract.** Phase 1b-1 populates the deterministic banned-phrase list; Phase 1b-2 populates the claim-classification rules.

## Sources

HCSA Advertisement Regulations 2021 (MOH); SMC ECEG 2016; HSA therapeutic products advertising rules; SMC Guidelines on Aesthetic Practices for Doctors (2008/2016).

## Must not say (high-level)

- Patient testimonials or endorsements
- Before/after images
- Superlatives ("best", "leading", "most effective")
- Comparative claims against other clinics
- Unsubstantiated efficacy claims or guarantees
- Urgency tactics ("only N slots today!")
- Public advertising of List B procedures

## Must substantiate

- Efficacy claims: require approved compliance claim
- Safety claims: require approved compliance claim
- Doctor credentials / device approvals: require regulatory_public_source

## Runtime banned-phrase enforcement

The deterministic safety gate enforces banned-phrase rules at the
harness layer. The runtime tables are authoritative; this markdown is
explanatory.

- Source: `packages/core/src/governance/banned-phrases/{common,sg}.ts`
- Categories: `superlative`, `guarantee`, `medical_claim`, `urgency`, `testimonial`
- Each entry maps to a `GovernanceVerdict.reasonCode` (see
  `REASON_CODE_BY_CATEGORY` in the same package).
- 1b-1 ships conservative seed entries. Phase 1b-1.5 expands them with
  HSA / SMC / HCSA / MOH input.

The pre-input escalation-trigger tables for SG live at
`packages/core/src/governance/escalation-triggers/{common,sg}.ts` with
the same authoring contract.

## Runtime claim classification (Phase 1b-2)

Every outbound model message that survives 1b-1's banned-phrase scanner is
sentence-classified by `ClaimClassifierHook` (Haiku 4.5 with prompt caching).
The classifier maps each sentence to one of:

`efficacy | safety-claim | superiority | urgency | testimonial | medical-advice | diagnosis | credentials | none`

Layer 3 substantiation tiers per claim type:

| Claim type                                      | Required source                                                        | If missing                      |
| ----------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------- |
| efficacy / safety-claim / superiority / urgency | `approved_compliance_claim` (operator-authored, named reviewer, <180d) | Rewrite to non-claim template   |
| credentials                                     | `regulatory_public_source` (curated SG: HSA / MOH / SMC entries)       | Escalate                        |
| testimonial / medical-advice / diagnosis        | none — never auto-answer                                               | Escalate                        |
| safety-claim                                    | also accepts `regulatory_public_source`                                | Rewrite if neither tier matches |
| none                                            | n/a                                                                    | Allow                           |

Source-of-truth (TS modules):

- Claim-type enum: `packages/schemas/src/claim-classifier.ts`
- Regulatory entries (SG): `packages/core/src/governance/classifier/regulatory-sources/sg.ts`
- Rewrite templates (SG): `packages/core/src/governance/classifier/rewrite-templates/sg.ts`
- Substantiation resolver: `packages/core/src/governance/classifier/substantiation-resolver.ts`
- Hook: `packages/core/src/skill-runtime/hooks/claim-classifier.ts`

This markdown is not parsed at runtime; it documents the runtime behavior for
operator and reviewer reference. Update both this file and the TS modules
together when authoring new rules.

## Runtime PDPA consent gate (Phase 1c)

Runtime enforcement layered atop the prompt-level rules above. **Sources of truth (TS, not markdown):**

- AI disclosure copy: `packages/core/src/consent/disclosure-copy.ts` (versioned `AI_DISCLOSURE_VERSIONS` in `packages/schemas/src/pdpa-consent.ts`).
- Revocation keyword tables: `packages/core/src/consent/revocation-keywords/{common,sg,my}.ts`.
- Revocation acknowledgment copy: `packages/core/src/consent/revocation-ack.ts`.
- Consent state mutation surface: `packages/core/src/consent/consent-service.ts`.
- Outbound consent gate: `packages/core/src/skill-runtime/hooks/pdpa-consent-gate.ts`.
- Pre-input revocation gate: `packages/core/src/channel-gateway/consent-revocation-gate.ts`.

The runtime hook detects whether your first outbound includes the disclosure copy verbatim (substring match). If it does not in enforce mode, a `disclosure_not_shown` warning verdict is emitted. The hook NEVER blocks on disclosure validation — this is a tuning signal, not a content gate.

Revocation keywords are intentionally narrow. False-positive revoke is worse than missed revoke (1b-1 escalation triggers catch nuanced complaints). Tighten patterns before broadening.

## Phase 3 lifecycle observation

Conversation lifecycle (mechanical states only in Phase 3a) is tracked in `packages/core/src/conversation-lifecycle/`. Operators reviewing Alex behavior may consult `ConversationLifecycleSnapshot` for current state and `ConversationLifecycleTransition` for the path. Lifecycle is observation-only — it does not gate Alex outbounds. Re-engagement requests that lifecycle generates still flow through the 1c PDPA consent gate and the 1d WhatsApp window/template gate.

## Phase 3b lifecycle observation

The qualification sidecar is observational — it never affects whether a message
can be sent. SG outbound rules (PDPA-compatible messaging opt-in, WhatsApp 24h
window, regulated-claim substantiation) are unchanged by Phase 3b.

Operator-confirmed disqualification: a lead is only marked `disqualified` after
an operator clicks Confirm in /operator. The agent surfaces candidates; it does
not auto-disqualify.
