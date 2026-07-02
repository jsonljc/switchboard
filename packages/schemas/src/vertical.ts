/**
 * Vertical axis for the governance loaders (banned phrases, escalation triggers)
 * and the recommendation urgency scorer. Promoted from core (L1 S2-2) so the L1
 * regulatory-profile registry can type `loaderVertical` without a layer violation:
 * core re-exports these same symbols from `../vertical.js`, so every existing core
 * importer resolves unchanged.
 *
 * `medspa` is the seed (reference-tenant) vertical: those subsystems key on it so
 * a later vertical pack can layer its own tables / LTV band without a call-site
 * change. The vocabulary mirrors the schemas `reference-metadata` vertical enum
 * (minus "none", which never carries governance data).
 *
 * Single source: the type derives from VERTICALS so the runtime list (used by
 * resolveVertical's marker validation) and the union can never drift apart.
 */
export const VERTICALS = ["medspa", "dental", "fitness", "generic"] as const;
export type Vertical = (typeof VERTICALS)[number];

/**
 * Default vertical. Every existing caller keys on this, so re-keying the loaders
 * and the scorer on (vertical, jurisdiction) leaves medspa behavior byte-identical.
 */
export const DEFAULT_VERTICAL: Vertical = "medspa";
