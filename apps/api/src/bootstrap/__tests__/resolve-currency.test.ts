import { describe, it, expect } from "vitest";
import { buildResolveCurrency } from "../resolve-currency.js";
import { buildObserveGovernanceConfig } from "@switchboard/schemas";
import type { GovernanceConfigResolver } from "@switchboard/core/skill-runtime";

/** Build a resolveCurrency over a resolver that always returns the given resolution. */
function over(resolution: Awaited<ReturnType<GovernanceConfigResolver>>) {
  return buildResolveCurrency(async () => resolution);
}

describe("buildResolveCurrency", () => {
  it("derives MYR from a resolved MY config", async () => {
    const resolve = over({
      status: "resolved",
      config: buildObserveGovernanceConfig({ jurisdiction: "MY", clinicType: "medical" }),
    });
    expect(await resolve("dep_1")).toBe("MYR");
  });

  it("derives SGD from a resolved SG config", async () => {
    const resolve = over({
      status: "resolved",
      config: buildObserveGovernanceConfig({ jurisdiction: "SG", clinicType: "medical" }),
    });
    expect(await resolve("dep_1")).toBe("SGD");
  });

  it("returns null (fail-closed) when the config is missing", async () => {
    const resolve = over({ status: "missing" });
    expect(await resolve("dep_1")).toBeNull();
  });

  it("returns null (fail-closed) when the config errors", async () => {
    const resolve = over({ status: "error", error: new Error("boom") });
    expect(await resolve("dep_1")).toBeNull();
  });

  it("passes the deploymentId through to the underlying resolver", async () => {
    const seen: string[] = [];
    const resolve = buildResolveCurrency(async (deploymentId) => {
      seen.push(deploymentId);
      return { status: "missing" };
    });
    await resolve("dep_42");
    expect(seen).toEqual(["dep_42"]);
  });
});
