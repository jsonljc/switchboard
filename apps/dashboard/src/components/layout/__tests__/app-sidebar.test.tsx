import { describe, it, expect } from "vitest";
import { buildSidebarSections } from "../app-sidebar";

describe("buildSidebarSections", () => {
  it("always shows the three primary destinations + Settings", () => {
    const s = buildSidebarSections({ miraEnabled: false, liveToolIds: [] });
    expect(s.primary.map((i) => i.href)).toEqual(["/", "/inbox", "/results"]);
    expect(s.settings.href).toBe("/settings");
  });
  it("dedupes a tools item whose href duplicates a primary destination", () => {
    const s = buildSidebarSections({
      miraEnabled: false,
      liveToolIds: ["contacts", "automations", "reports"],
    });
    expect(s.tools.map((i) => i.href)).toEqual(["/contacts", "/automations"]); // 'reports'→/results deduped
  });
  it("includes Mira only when enabled", () => {
    expect(
      buildSidebarSections({ miraEnabled: false, liveToolIds: [] }).tools.find(
        (i) => i.href === "/mira",
      ),
    ).toBeUndefined();
    expect(
      buildSidebarSections({ miraEnabled: true, liveToolIds: [] }).tools.find(
        (i) => i.href === "/mira",
      ),
    ).toBeDefined();
  });
  it("includes Full reports (/reports) only when the reports tool is live", () => {
    expect(
      buildSidebarSections({ miraEnabled: false, liveToolIds: [] }).tools.find(
        (i) => i.href === "/reports",
      ),
    ).toBeUndefined();
    expect(
      buildSidebarSections({ miraEnabled: false, liveToolIds: ["reports"] }).tools.find(
        (i) => i.href === "/reports",
      ),
    ).toBeDefined();
  });
});
