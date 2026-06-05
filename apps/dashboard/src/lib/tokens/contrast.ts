/**
 * WCAG 2.x relative-luminance contrast for HSL-triplet design tokens.
 *
 * Inputs are the raw triplet form stored in globals.css, e.g. "30 58% 41%"
 * (the value a token holds and that is consumed as `hsl(var(--x))`). This lets
 * the token drift-guard assert real contrast ratios against shipped values
 * instead of eyeballing screenshots (spec §4.6).
 */

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

/** Parse a CSS HSL triplet like "30 58% 41%" (no hsl() wrapper). */
export function parseHslTriple(triple: string): Hsl {
  const m = triple.trim().match(/^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%$/);
  if (!m) {
    throw new Error(`Not an HSL triple: "${triple}"`);
  }
  return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) };
}

/** HSL (h in degrees, s/l in percent) → sRGB channels in [0, 1]. */
export function hslToRgb({ h, s, l }: Hsl): [number, number, number] {
  const sN = s / 100;
  const lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = lN - c / 2;
  return [r + m, g + m, b + m];
}

/** sRGB channel [0, 1] → linearized component for luminance. */
function linearize(channel: number): number {
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of an HSL triple. */
export function relativeLuminance(triple: string): number {
  const [r, g, b] = hslToRgb(parseHslTriple(triple));
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/** WCAG contrast ratio (≥ 1) between two HSL triples. Order-independent. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}
