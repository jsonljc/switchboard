import { describe, it, expect } from "vitest";
import { buildMarketRead } from "../governance-get-market.js";
import { buildObserveGovernanceConfig } from "@switchboard/schemas";

const seeded = buildObserveGovernanceConfig({ jurisdiction: "MY", clinicType: "nonMedical" });

describe("buildMarketRead", () => {
  it("returns the deployment's current market for the org's Alex deployment", async () => {
    const out = await buildMarketRead(
      { findAlexDeployment: async () => ({ id: "dep-1", governanceConfig: seeded }) },
      "org-1",
    );
    expect(out).toEqual({ jurisdiction: "MY", clinicType: "nonMedical" });
  });

  it("returns notFound when the org has no Alex deployment (org scope)", async () => {
    const out = await buildMarketRead({ findAlexDeployment: async () => null }, "org-1");
    expect(out).toEqual({ notFound: true });
  });

  it("returns null market (never a guessed default) when the stored config is corrupt", async () => {
    const out = await buildMarketRead(
      { findAlexDeployment: async () => ({ id: "dep-1", governanceConfig: { bogus: 1 } }) },
      "org-1",
    );
    expect(out).toEqual({ jurisdiction: null, clinicType: null });
  });

  it("passes the authenticated org through to the deployment lookup", async () => {
    const seen: string[] = [];
    await buildMarketRead(
      {
        findAlexDeployment: async (org) => {
          seen.push(org);
          return null;
        },
      },
      "org-XYZ",
    );
    expect(seen).toEqual(["org-XYZ"]);
  });
});
