/**
 * Vertical axis for the governance loaders (banned phrases, escalation triggers)
 * and the recommendation urgency scorer.
 *
 * `medspa` is the seed (reference-tenant) vertical: those subsystems key on it so
 * a later vertical pack can layer its own tables / LTV band without a call-site
 * change. Kept as a LOCAL core type (deliberately NOT an L1 schema union) so
 * this seam stays additive and fully reversible until the VerticalPack registry
 * lands. The vocabulary mirrors the schemas `reference-metadata` vertical enum
 * (minus "none", which never carries governance data).
 */
export type Vertical = "medspa" | "dental" | "fitness" | "generic";

/**
 * Default vertical. Every existing caller keys on this, so re-keying the loaders
 * and the scorer on (vertical, jurisdiction) leaves medspa behavior byte-identical.
 */
export const DEFAULT_VERTICAL: Vertical = "medspa";
