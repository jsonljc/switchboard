import { describe, it, expect, vi } from "vitest";
import { CoverageValidator } from "./coverage-validator.js";

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
    // 200 + 100 / (200+100+300) = 50% covered (excluding web)
    expect(result.coveragePct).toBeCloseTo(0.5, 2);
  });
});
