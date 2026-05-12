import { describe, expect, it } from "vitest";
import {
  GovernanceConfigSchema,
  LifecycleTaggingQualificationConfigSchema,
  resolveLifecycleQualificationConfig,
} from "../governance-config.js";

describe("lifecycleTagging.qualification", () => {
  it("accepts on/off modes alongside mechanical", () => {
    const config = GovernanceConfigSchema.parse({
      jurisdiction: "SG",
      clinicType: "medical",
      lifecycleTagging: {
        mechanical: { mode: "on" },
        qualification: { mode: "on" },
      },
    });
    const lifecycleTagging = (config as unknown as Record<string, unknown>)?.lifecycleTagging as
      | Record<string, { mode: string }>
      | undefined;
    expect(lifecycleTagging?.qualification?.mode).toBe("on");
  });

  it("defaults to off when omitted", () => {
    const config = GovernanceConfigSchema.parse({
      jurisdiction: "SG",
      clinicType: "medical",
      lifecycleTagging: { mechanical: { mode: "on" } },
    });
    expect(resolveLifecycleQualificationConfig(config)).toEqual({ mode: "off" });
  });

  it("rejects unknown mode values via sub-schema", () => {
    // lifecycleTagging is a passthrough block on GovernanceConfigSchema; validation
    // of the qualification sub-block happens via LifecycleTaggingQualificationConfigSchema.
    expect(() => LifecycleTaggingQualificationConfigSchema.parse({ mode: "maybe" })).toThrow();
  });

  it("resolveLifecycleQualificationConfig returns the configured mode", () => {
    const config = GovernanceConfigSchema.parse({
      jurisdiction: "SG",
      clinicType: "medical",
      lifecycleTagging: { qualification: { mode: "on" } },
    });
    expect(resolveLifecycleQualificationConfig(config)).toEqual({ mode: "on" });
  });

  it("returns mode=off when config is null", () => {
    expect(resolveLifecycleQualificationConfig(null)).toEqual({ mode: "off" });
  });

  it("returns mode=off when lifecycleTagging sub-block is absent", () => {
    const config = GovernanceConfigSchema.parse({
      jurisdiction: "SG",
      clinicType: "medical",
    });
    expect(resolveLifecycleQualificationConfig(config)).toEqual({ mode: "off" });
  });
});
