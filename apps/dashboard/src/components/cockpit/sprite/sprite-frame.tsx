import type { CSSProperties } from "react";
import { T } from "../tokens";
import { AnimatedSprite } from "./animated-sprite";
import type { SpriteState, SpriteVariantKey, VariantBundle } from "./types";

export interface SpriteFrameProps {
  bundle: VariantBundle;
  variant: SpriteVariantKey;
  state: SpriteState;
  size: number;
  /** Background color of the rounded frame (e.g., T.amberSoft for Alex). */
  accentSoft: string;
  /** Color of the fallback letter glyph (e.g., T.amberDeep for Alex). */
  fallbackDeep?: string;
  /** Letter rendered if variant/state lookup fails. "A" / "R" / etc. */
  fallbackLetter: string;
}

function frameStyle(size: number, accentSoft: string): CSSProperties {
  return {
    width: size,
    height: size,
    borderRadius: Math.round(size * 0.18),
    background: accentSoft,
    border: `1px solid ${T.hair}`,
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    boxShadow: "inset 0 -8px 14px hsl(var(--shadow-color) / 0.04)",
    overflow: "hidden",
  };
}

export function SpriteFrame({
  bundle,
  variant,
  state,
  size,
  accentSoft,
  fallbackDeep = T.ink,
  fallbackLetter,
}: SpriteFrameProps) {
  const frames = bundle[variant]?.states[state];
  const palette = bundle[variant]?.palette;
  if (!frames || frames.length === 0 || !palette) {
    return (
      <div style={frameStyle(size, accentSoft)}>
        <span style={{ fontWeight: 700, fontSize: size * 0.42, color: fallbackDeep }}>
          {fallbackLetter}
        </span>
      </div>
    );
  }
  return (
    <div style={frameStyle(size, accentSoft)}>
      <AnimatedSprite frames={frames} palette={palette} size={size - 6} />
    </div>
  );
}
