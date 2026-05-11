---
jurisdiction: MY
vertical: medspa
clinicType: medical
appliesTo: regulatory
riskLevel: critical
lastReviewedAt: "2026-05-10"
owner: jasonli
sources:
  - "https://mmc.gov.my/wp-content/uploads/2019/11/MMC-Aesthetic-Guidelines-2015.pdf"
  - "https://pharmacy.moh.gov.my/sites/default/files/document-upload/advertising-guidelines-healthcare-facilities-and-services-mab-3.2023.pdf"
---

# MY aesthetic clinic — must-not-say & must-substantiate

> **TODO — Phase 1a placeholder for governance contract.** Phase 1b-1/1b-2 populate enforcement detail.

## Sources

Medicine (Advertisement and Sale) Act 1956; MAB approval regime; PHFSA 1998 (KKM); MMC Guidelines on the Ethical Aspects of Aesthetic Medical Practice (2015); KKM Advertising Guidelines for Healthcare Facilities and Services (2023).

## Must not say (high-level)

- Aesthetic service ads without MAB approval
- Superlatives or absolutes ("best", "guaranteed", "100%", "permanent")
- Comparative claims (direct or implied)
- Misleading testimonials or before/after content without compliance review
- Operating aesthetic medical procedures outside a PHFSA-registered facility

## Must substantiate

- Efficacy / safety / superiority: require approved compliance claim
- Doctor APC / LCP for aesthetic medicine: require regulatory_public_source

## Runtime banned-phrase enforcement

The deterministic safety gate enforces banned-phrase rules at the
harness layer. The runtime tables are authoritative; this markdown is
explanatory.

- Source: `packages/core/src/governance/banned-phrases/{common,my}.ts`
- Categories: `superlative`, `guarantee`, `medical_claim`, `urgency`, `testimonial`
- Each entry maps to a `GovernanceVerdict.reasonCode` (see
  `REASON_CODE_BY_CATEGORY` in the same package).
- 1b-1 ships conservative seed entries. Phase 1b-1.5 expands them with
  MAB / MMC / KKM / APC/LCP input.

The pre-input escalation-trigger tables for MY live at
`packages/core/src/governance/escalation-triggers/{common,my}.ts` with
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
| credentials                                     | `regulatory_public_source` (curated MY: MDA / KKM / MMC / MAB entries) | Escalate                        |
| testimonial / medical-advice / diagnosis        | none — never auto-answer                                               | Escalate                        |
| safety-claim                                    | also accepts `regulatory_public_source`                                | Rewrite if neither tier matches |
| none                                            | n/a                                                                    | Allow                           |

Source-of-truth (TS modules):

- Claim-type enum: `packages/schemas/src/claim-classifier.ts`
- Regulatory entries (MY): `packages/core/src/governance/classifier/regulatory-sources/my.ts`
- Rewrite templates (MY): `packages/core/src/governance/classifier/rewrite-templates/my.ts`
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
