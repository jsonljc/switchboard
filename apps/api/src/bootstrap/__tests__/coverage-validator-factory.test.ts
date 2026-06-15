import { describe, it, expect, vi } from "vitest";
import { isCoverageSufficient } from "@switchboard/ad-optimizer";
import {
  buildCoverageValidator,
  buildCreateCoverageValidator,
} from "../coverage-validator-factory.js";

const WHATSAPP_500 = [{ id: "c1", destination_type: "WHATSAPP", spend: 500 }];

describe("buildCoverageValidator", () => {
  it("abstains when the only tracked source has no recent leads", async () => {
    const validator = buildCoverageValidator({
      listCampaigns: vi.fn().mockResolvedValue(WHATSAPP_500),
      hasRecentLead: vi.fn().mockResolvedValue(false),
    });
    const report = await validator.validate({ orgId: "org_1", accountId: "act_1" });
    expect(isCoverageSufficient(report)).toBe(false);
  });

  it("passes when a tracked source has recent leads covering enough spend", async () => {
    const validator = buildCoverageValidator({
      listCampaigns: vi.fn().mockResolvedValue(WHATSAPP_500),
      hasRecentLead: vi.fn().mockResolvedValue(true),
    });
    const report = await validator.validate({ orgId: "org_1", accountId: "act_1" });
    expect(isCoverageSufficient(report)).toBe(true);
  });
});

describe("buildCreateCoverageValidator", () => {
  it("resolves the deployment's org and queries the intake store with it", async () => {
    const findById = vi.fn().mockResolvedValue({ organizationId: "org_1" });
    const hasRecentLead = vi.fn().mockResolvedValue(false);
    const create = buildCreateCoverageValidator({
      deploymentStore: { findById },
      leadIntakeStore: { hasRecentLead },
      makeAdsClient: () => ({ listCampaigns: vi.fn().mockResolvedValue(WHATSAPP_500) }),
    });
    const validator = create("dep-1", { accessToken: "t", accountId: "act_1" });
    const report = await validator.validate({ orgId: "org_1", accountId: "act_1" });

    expect(isCoverageSufficient(report)).toBe(false); // no recent leads -> abstain
    expect(findById).toHaveBeenCalledWith("dep-1");
    expect(hasRecentLead).toHaveBeenCalledWith("org_1", "ctwa", 7);
  });

  it("passes when the resolved org has recent leads covering enough spend", async () => {
    const create = buildCreateCoverageValidator({
      deploymentStore: { findById: vi.fn().mockResolvedValue({ organizationId: "org_1" }) },
      leadIntakeStore: { hasRecentLead: vi.fn().mockResolvedValue(true) },
      makeAdsClient: () => ({ listCampaigns: vi.fn().mockResolvedValue(WHATSAPP_500) }),
    });
    const validator = create("dep-1", { accessToken: "t", accountId: "act_1" });
    const report = await validator.validate({ orgId: "org_1", accountId: "act_1" });
    expect(isCoverageSufficient(report)).toBe(true);
  });

  it("FAIL-SAFE: abstains and never consults the intake store when the org is unresolvable", async () => {
    const hasRecentLead = vi.fn().mockResolvedValue(true); // would say yes if asked...
    const create = buildCreateCoverageValidator({
      deploymentStore: { findById: vi.fn().mockResolvedValue(null) }, // ...but org is unresolvable
      leadIntakeStore: { hasRecentLead },
      makeAdsClient: () => ({ listCampaigns: vi.fn().mockResolvedValue(WHATSAPP_500) }),
    });
    const validator = create("dep-1", { accessToken: "t", accountId: "act_1" });
    const report = await validator.validate({ orgId: "org_1", accountId: "act_1" });
    expect(isCoverageSufficient(report)).toBe(false);
    expect(hasRecentLead).not.toHaveBeenCalled();
  });
});
