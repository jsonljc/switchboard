import { AI_DISCLOSURE_VERSIONS, type PdpaJurisdiction } from "@switchboard/schemas";

/**
 * Versioned AI disclosure copy per jurisdiction.
 *
 * SG is a transparency disclosure aligned with PDPC's 2024 AI advisory.
 * MY includes the consent prompt because MY PDPA requires explicit consent
 * before personal-data processing.
 *
 * v1 deterministic heuristic, not compliance-proof validation — punctuation,
 * whitespace, and markdown drift will break PdpaConsentGateHook substring
 * detection. Hardened detection is deferred until disclosure copy stabilizes.
 *
 * Regulatory-review handoff: conservative seed copy. See
 * `docs/superpowers/plans/2026-05-11-alex-medspa-1c-followups.md` for the
 * named reviewer + target window before pilot.
 */
export const DISCLOSURE_COPY: Record<PdpaJurisdiction, { version: string; text: string }> = {
  SG: {
    version: AI_DISCLOSURE_VERSIONS.SG,
    text: "Hi, I'm Alex — the clinic's AI assistant. I can help with bookings and general questions, and a clinic team member will step in for anything medical.",
  },
  MY: {
    version: AI_DISCLOSURE_VERSIONS.MY,
    text: "Hi, I'm Alex — the clinic's AI assistant. To follow up with you and share booking info, the clinic needs your okay to process your details. Reply OK to continue, or STOP at any time to opt out.",
  },
};
