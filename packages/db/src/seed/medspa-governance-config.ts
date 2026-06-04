import { buildObserveGovernanceConfig } from "@switchboard/schemas";

/**
 * Seeded governance posture for the medspa pilot (Glow Aesthetics): Singapore
 * jurisdiction, medical clinic, every gate in observe (strictly log-only).
 * Seeding this is what makes the four afterSkill gates RUN; the off->enforce
 * flip stays a deliberate per-gate ops config update gated on the observe bake.
 * See docs/superpowers/specs/2026-06-04-alex-governance-observe-activation-design.md.
 */
export const MEDSPA_PILOT_GOVERNANCE_CONFIG = buildObserveGovernanceConfig({
  jurisdiction: "SG",
  clinicType: "medical",
});
