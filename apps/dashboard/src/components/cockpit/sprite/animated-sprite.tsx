import type { CSSProperties } from "react";
import type { AnimFrame, Palette } from "./types";
import { PixelSprite } from "./pixel-sprite";
import { useFrameCycle } from "./use-frame-cycle";

export interface AnimatedSpriteProps {
  frames: readonly AnimFrame[];
  palette: Palette;
  /** Box size in px, or "fill" to scale to the parent box (fluid hero scale). */
  size: number | "fill";
  playing?: boolean;
  style?: CSSProperties;
}

export function AnimatedSprite({ frames, palette, size, playing, style }: AnimatedSpriteProps) {
  const rows = useFrameCycle(frames, { playing });
  if (!rows) return null;
  return <PixelSprite rows={rows} palette={palette} size={size} style={style} />;
}
