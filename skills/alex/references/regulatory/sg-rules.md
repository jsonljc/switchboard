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
