import { describe, it, expect } from "vitest";
import {
  CanonicalKeySchema,
  MEDSPA_CANONICAL_KEYS,
  isKnownCanonicalKey,
  CANONICAL_KEY_PATTERN,
} from "../canonical-keys.js";

describe("CanonicalKeySchema", () => {
  it("accepts a well-formed slug matching ^[a-z_]+:[a-z0-9_]+$", () => {
    expect(CanonicalKeySchema.safeParse("objection:downtime_work").success).toBe(true);
    expect(CanonicalKeySchema.safeParse("scheduling:availability").success).toBe(true);
  });

  it("rejects malformed slugs", () => {
    expect(CanonicalKeySchema.safeParse("Objection:Downtime").success).toBe(false); // uppercase
    expect(CanonicalKeySchema.safeParse("downtime").success).toBe(false); // missing namespace
    expect(CanonicalKeySchema.safeParse("objection:").success).toBe(false); // empty subkey
    expect(CanonicalKeySchema.safeParse("objection:downtime-work").success).toBe(false); // hyphen
    expect(CANONICAL_KEY_PATTERN.test("objection:price_value")).toBe(true);
  });

  it("MEDSPA_CANONICAL_KEYS contains the spec-defined enum", () => {
    expect(MEDSPA_CANONICAL_KEYS).toContain("objection:downtime_work");
    expect(MEDSPA_CANONICAL_KEYS).toContain("objection:redness_side_effects");
    expect(MEDSPA_CANONICAL_KEYS).toContain("objection:aftercare_restrictions");
    expect(MEDSPA_CANONICAL_KEYS).toContain("objection:pain");
    expect(MEDSPA_CANONICAL_KEYS).toContain("objection:price_value");
    expect(MEDSPA_CANONICAL_KEYS).toContain("objection:results_proof");
    expect(MEDSPA_CANONICAL_KEYS).toContain("objection:safety_credentials");
    expect(MEDSPA_CANONICAL_KEYS).toContain("scheduling:availability");
    expect(MEDSPA_CANONICAL_KEYS).toContain("scheduling:location_access");
  });

  it("isKnownCanonicalKey accepts enum members and rejects unknown slugs", () => {
    expect(isKnownCanonicalKey("objection:downtime_work", MEDSPA_CANONICAL_KEYS)).toBe(true);
    expect(isKnownCanonicalKey("objection:made_up", MEDSPA_CANONICAL_KEYS)).toBe(false);
    expect(isKnownCanonicalKey("unknown", MEDSPA_CANONICAL_KEYS)).toBe(false);
  });
});
