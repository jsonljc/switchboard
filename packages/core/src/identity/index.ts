export { resolveIdentity, applyCompetenceAdjustments } from "./spec.js";
export type { ResolvedIdentity } from "./spec.js";
export { getActiveOverlays } from "./overlay.js";
export { canActAs, resolveApprovers } from "./principals.js";
export { GOVERNANCE_PROFILE_PRESETS, automationLevelToProfile } from "./governance-presets.js";
export type { GovernanceProfilePreset } from "./governance-presets.js";
export { normalizePhone, normalizeEmail } from "./normalize.js";
export { ContactMerger } from "./contact-merger.js";
export type { ContactCandidate, MergeResult, ContactMergerPort } from "./contact-merger.js";
