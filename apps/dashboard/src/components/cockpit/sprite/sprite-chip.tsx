import type { CSSProperties } from "react";
import { T } from "../tokens";
import { AnimatedSprite } from "./animated-sprite";
import type { SpriteState, SpriteVariantKey, VariantBundle } from "./types";

export interface SpriteChipProps {
  bundle: VariantBundle;
  variant: SpriteVariantKey;
  state: SpriteState;
  size?: number;
  accentSoft: string;
  fallbackDeep?: string;
  fallbackLetter: string;
}

function chipStyle(size: number, accentSoft: string): CSSProperties {
  return {
    width: size,
    height: size,
    borderRadius: 4,
    background: accentSoft,
    display: "inline-grid",
    placeItems: "center",
    overflow: "hidden",
    verticalAlign: "middle",
    flexShrink: 0,
  };
}

export function SpriteChip({
  bundle,
  variant,
  state,
  size = 22,
  accentSoft,
  fallbackDeep = T.ink,
  fallbackLetter,
}: SpriteChipProps) {
  const frames = bundle[variant]?.states[state];
  const palette = bundle[variant]?.palette;
  if (!frames || frames.length === 0 || !palette) {
    return (
      <span style={chipStyle(size, accentSoft)}>
        <span style={{ fontWeight: 700, fontSize: Math.round(size * 0.42), color: fallbackDeep }}>
          {fallbackLetter}
        </span>
      </span>
    );
  }
  return (
    <span style={chipStyle(size, accentSoft)}>
      <AnimatedSprite frames={frames} palette={palette} size={size - 2} />
    </span>
  );
}
