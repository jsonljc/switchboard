---
jurisdiction: both
vertical: medspa
clinicType: both
appliesTo: regulatory
riskLevel: high
lastReviewedAt: "2026-05-10"
owner: jasonli
---

# Medical aesthetic vs non-medical beauty spa — posture toggle

> **TODO — Phase 1a placeholder.** Phase 1b-1 wires the deployment-level `clinicType` flag to enforcement.

## SG

MOH-regulated medical aesthetic clinics (doctor-led, HSA-device-approved, SMC List A/B framework) vs unregulated beauty salons. Beauty salons cannot use "treat", "diagnose", or perform doctor-only procedures (Botox, filler, RF, fractional laser).

## MY

PHFSA-regulated medical clinics vs unregulated beauty salons. Same line; KKM regulates the medical side only. Grey zone is larger; agent must default to non-medical posture if `clinicType: nonMedical`.

## Posture rules

- `clinicType: medical` — full medical-aesthetic vocabulary allowed within `sg-rules.md` / `my-rules.md` constraints
- `clinicType: nonMedical` — additionally avoid "treat", "cure", "diagnose", "fix"; never reference doctor-only procedures even by name
