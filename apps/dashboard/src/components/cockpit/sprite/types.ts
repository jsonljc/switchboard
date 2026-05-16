// Sprite type definitions for cockpit v2 pixel avatars.
// All keys are runtime strings; the cockpit hard-codes one variant per agent
// (see DEFAULT_ALEX_VARIANT / DEFAULT_RILEY_VARIANT) so users never type these.

export type SpriteState = "idle" | "draft" | "sleep" | "won";

/** Bundle-scoped variant key. ALEX_VARIANTS has classic/operator/cozy/agent;
 *  RILEY_VARIANTS has analyst/trader/bot. Use `string` at the type level
 *  (callers always pass a literal constant); runtime lookup against the bundle
 *  is the source of truth. */
export type SpriteVariantKey = string;

/** A single frame: 24 strings of 24 chars each. `.` and ` ` = transparent;
 *  other chars are palette keys. Frame builders enforce 24-char rows. */
export type Frame = readonly string[];

/** Palette: single-char key → CSS color string. */
export type Palette = Readonly<Record<string, string>>;

/** One animation frame in a cycle: the frame grid + how long it stays on screen. */
export interface AnimFrame {
  rows: Frame;
  dur: number;
}

export interface VariantDef {
  /** Human-readable name (e.g., "Alex Classic"). Not rendered today; kept for
   *  future Settings / debug surfaces. */
  name: string;
  /** Short blurb explaining the variant. Future Settings copy. */
  blurb: string;
  palette: Palette;
  states: Record<SpriteState, readonly AnimFrame[]>;
}

export type VariantBundle = Readonly<Record<SpriteVariantKey, VariantDef>>;

/** A drawing command for buildSprite / mergeSprite. Test-only / future-author-only;
 *  product code consumes pre-built Frame arrays, not commands. */
export type SpriteCommand =
  | readonly ["rect", number, number, number, number, string]
  | readonly ["row", number, number, string]
  | readonly ["col", number, number, string]
  | readonly ["px", number, number, string]
  | readonly ["clear", number, number, number, number]
  | readonly ["rows", number, number, readonly string[]];
