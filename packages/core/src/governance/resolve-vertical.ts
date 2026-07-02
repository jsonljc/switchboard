import { z } from "zod";
import type { GovernanceConfig } from "@switchboard/schemas";
import { DEFAULT_VERTICAL, VERTICALS, type Vertical } from "../vertical.js";

const VerticalSchema = z.enum(VERTICALS);

/**
 * Resolve the vertical a governance config runs under.
 *
 * Mirrors resolveConsentStateConfig: read the passthrough `vertical` marker,
 * validate it against the Vertical union, and fail-SAFE to DEFAULT_VERTICAL
 * (medspa) on absence or corruption. Absence resolves to medspa, which keeps
 * every existing config byte-identical (no config carries a marker today).
 * Corruption resolves to medspa too, the over-restrictive (safe) direction: a
 * bad marker falls to the strictest seed floor, never to a looser or empty one.
 *
 * The gates thread this into the (vertical, jurisdiction) loaders so a config's
 * pack marker selects its floor/pack tables with no call-site change.
 */
export function resolveVertical(config: GovernanceConfig | null): Vertical {
  const raw = (config as unknown as Record<string, unknown> | null)?.vertical;
  // Absence (no marker, including an explicit null) resolves to the default with
  // no log: the byte-identical path for every config that carries no marker
  // today. Mirrors resolveConsentStateConfig's `safeParse(raw ?? {})` coalescing.
  if (raw === undefined || raw === null) return DEFAULT_VERTICAL;
  const parsed = VerticalSchema.safeParse(raw);
  if (!parsed.success) {
    // Log ONLY the Zod issue path+code (no raw value; the marker carries no PII)
    // so a corrupt marker is not silently coerced. Mirrors resolveConsentStateConfig.
    console.error(
      "[resolve-vertical] corrupt vertical marker; failing safe to the default vertical",
      { issues: parsed.error.issues.map((i) => ({ path: i.path, code: i.code })) },
    );
    return DEFAULT_VERTICAL;
  }
  return parsed.data;
}
