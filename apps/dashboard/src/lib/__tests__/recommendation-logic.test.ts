import { describe, it, expect } from "vitest";
import { pickRecommendation } from "../recommendation-logic";
import type { ModuleStatus } from "../module-types";

function makeStatus(id: string, state: string): ModuleStatus {
  return {
    id: id as ModuleStatus["id"],
    state: state as ModuleStatus["state"],
    label: id,
    subtext: "",
    cta: { label: "", href: "" },
    lastUpdated: new Date().toISOString(),
  };
}

describe("pickRecommendation", () => {
  it("prioritizes connection_broken over everything", () => {
    const modules = [
      makeStatus("lead-to-booking", "live"),
      makeStatus("creative", "connection_broken"),
      makeStatus("ad-optimizer", "not_setup"),
    ];
    const rec = pickRecommendation(modules);
    expect(rec.moduleId).toBe("creative");
    expect(rec.type).toBe("fix");
  });

  it("suggests closing a loop when neighbor is live", () => {
    const modules = [
      makeStatus("lead-to-booking", "live"),
      makeStatus("creative", "not_setup"),
      makeStatus("ad-optimizer", "not_setup"),
    ];
    const rec = pickRecommendation(modules);
    expect(rec.moduleId).toBe("ad-optimizer");
  });

  it("defaults to lead-to-booking when nothing is live", () => {
    const modules = [
      makeStatus("lead-to-booking", "not_setup"),
      makeStatus("creative", "not_setup"),
      makeStatus("ad-optimizer", "not_setup"),
    ];
    const rec = pickRecommendation(modules);
    expect(rec.moduleId).toBe("lead-to-booking");
  });

  it("returns all-live message when everything is live", () => {
    const modules = [
      makeStatus("lead-to-booking", "live"),
      makeStatus("creative", "live"),
      makeStatus("ad-optimizer", "live"),
    ];
    const rec = pickRecommendation(modules);
    expect(rec.type).toBe("all_live");
  });
});
