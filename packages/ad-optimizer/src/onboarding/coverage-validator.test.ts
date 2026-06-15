import { describe, it, expect, vi } from "vitest";
import { CoverageValidator, isCoverageSufficient } from "./coverage-validator.js";

describe("CoverageValidator", () => {
  it("classifies campaigns by destination type and reports coverage", async () => {
    const adsClient = {
      listCampaigns: vi.fn().mockResolvedValue([
        { id: "c1", destination_type: "WHATSAPP", spend: 200 },
        { id: "c2", destination_type: "ON_AD", spend: 100 }, // Instant Form
        { id: "c3", destination_type: "WEBSITE", spend: 300 },
      ]),
    };
    const intakeStore = {
      hasRecentLead: vi
        .fn()
        .mockImplementation(async (sourceType: string) => sourceType === "ctwa"),
    };
    const validator = new CoverageValidator({ adsClient, intakeStore });
    const result = await validator.validate({ orgId: "o1", accountId: "a1" });

    expect(result.bySource.ctwa.campaigns).toBe(1);
    expect(result.bySource.ctwa.tracking).toBe("verified");
    expect(result.bySource.instant_form.tracking).toBe("no_recent_traffic");
    expect(result.bySource.web.tracking).toBe("v2_pending");
    // Only ctwa is verified (200); instant_form is no_recent_traffic so its 100 is
    // uncredited; web (300) is never covered. covered 200 / total 600 = 33%.
    expect(result.coveragePct).toBeCloseTo(0.333, 2);
  });

  it("uncredits a source with no recent leads, so a zero-lead account abstains", async () => {
    const adsClient = {
      listCampaigns: vi
        .fn()
        .mockResolvedValue([{ id: "c1", destination_type: "WHATSAPP", spend: 500 }]),
    };
    const intakeStore = { hasRecentLead: vi.fn().mockResolvedValue(false) };
    const validator = new CoverageValidator({ adsClient, intakeStore });
    const result = await validator.validate({ orgId: "o1", accountId: "a1" });

    expect(result.bySource.ctwa.tracking).toBe("no_recent_traffic");
    // No verified tracked source -> covered spend is 0 -> the gate abstains.
    expect(result.coveragePct).toBe(0);
    expect(isCoverageSufficient(result)).toBe(false);
  });
});

describe("isCoverageSufficient", () => {
  it("passes at or above the 50% coverage floor", () => {
    expect(isCoverageSufficient({ bySource: {} as never, coveragePct: 0.6 })).toBe(true);
    expect(isCoverageSufficient({ bySource: {} as never, coveragePct: 0.5 })).toBe(true);
  });
  it("fails below the floor", () => {
    expect(isCoverageSufficient({ bySource: {} as never, coveragePct: 0.2 })).toBe(false);
  });
});
