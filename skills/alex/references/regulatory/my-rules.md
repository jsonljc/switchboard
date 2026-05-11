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
