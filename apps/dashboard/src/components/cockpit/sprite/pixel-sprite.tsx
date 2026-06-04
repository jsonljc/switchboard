import type { CSSProperties, ReactElement } from "react";
import type { Frame, Palette } from "./types";
import { SPRITE_SIZE } from "./build-sprite";

export interface PixelSpriteProps {
  rows: Frame;
  palette: Palette;
  /** Box size in px, or "fill" to scale to the parent box (fluid hero scale). */
  size: number | "fill";
  style?: CSSProperties;
}

/** SVG renderer for one 24×24 sprite frame. One `<rect>` per opaque pixel.
 *  Decorative; always aria-hidden. */
export function PixelSprite({ rows, palette, size, style }: PixelSpriteProps) {
  const rects: ReactElement[] = [];
  for (let y = 0; y < SPRITE_SIZE; y++) {
    const row = rows[y] ?? "";
    for (let x = 0; x < SPRITE_SIZE; x++) {
      const ch = row[x];
      if (!ch || ch === "." || ch === " ") continue;
      const color = palette[ch];
      if (!color) continue;
      rects.push(<rect key={`${x}_${y}`} x={x} y={y} width={1.02} height={1.02} fill={color} />);
    }
  }
  return (
    <svg
      width={size === "fill" ? "100%" : size}
      height={size === "fill" ? "100%" : size}
      viewBox={`0 0 ${SPRITE_SIZE} ${SPRITE_SIZE}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      style={{ display: "block", ...style }}
    >
      {rects}
    </svg>
  );
}
