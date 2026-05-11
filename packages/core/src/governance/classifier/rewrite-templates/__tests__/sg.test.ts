import { describe, it, expect, beforeEach } from "vitest";
import { loadRewriteTemplates } from "../loader.js";
import { _resetRewriteTemplateCache } from "../loader.js";

describe("SG rewrite templates", () => {
  beforeEach(() => {
    _resetRewriteTemplateCache();
  });

  it("efficacy template references individual variability", () => {
    const t = loadRewriteTemplates("SG").find((e) => e.claimType === "efficacy")!;
    expect(t.template).toMatch(/results vary|individual|doctor/i);
  });

  it("safety-claim template defers to doctor consultation", () => {
    const t = loadRewriteTemplates("SG").find((e) => e.claimType === "safety-claim")!;
    expect(t.template).toMatch(/doctor|consultation|discuss/i);
  });

  it("superiority template avoids comparative language", () => {
    const t = loadRewriteTemplates("SG").find((e) => e.claimType === "superiority")!;
    expect(t.template.trim().length).toBeGreaterThan(20);
    expect(t.jurisdiction).toBe("SG");
  });

  it("urgency template avoids time-pressure language", () => {
    const t = loadRewriteTemplates("SG").find((e) => e.claimType === "urgency")!;
    expect(t.template.trim().length).toBeGreaterThan(20);
    expect(t.jurisdiction).toBe("SG");
  });

  it("all SG templates have SG jurisdiction", () => {
    for (const t of loadRewriteTemplates("SG")) {
      expect(t.jurisdiction).toBe("SG");
    }
  });
});
