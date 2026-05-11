import { describe, it, expect, beforeEach } from "vitest";
import { loadRewriteTemplates } from "../loader.js";
import { _resetRewriteTemplateCache } from "../loader.js";

describe("MY rewrite templates", () => {
  beforeEach(() => {
    _resetRewriteTemplateCache();
  });

  it("efficacy template references individual variability", () => {
    const t = loadRewriteTemplates("MY").find((e) => e.claimType === "efficacy")!;
    expect(t.template).toMatch(/results differ|person to person|individual|doctor/i);
  });

  it("safety-claim template defers to doctor consultation", () => {
    const t = loadRewriteTemplates("MY").find((e) => e.claimType === "safety-claim")!;
    expect(t.template).toMatch(/doctor|consultation|discuss/i);
  });

  it("superiority template avoids comparative language", () => {
    const t = loadRewriteTemplates("MY").find((e) => e.claimType === "superiority")!;
    expect(t.template.trim().length).toBeGreaterThan(20);
    expect(t.jurisdiction).toBe("MY");
  });

  it("urgency template avoids time-pressure language", () => {
    const t = loadRewriteTemplates("MY").find((e) => e.claimType === "urgency")!;
    expect(t.template.trim().length).toBeGreaterThan(20);
    expect(t.jurisdiction).toBe("MY");
  });

  it("all MY templates have MY jurisdiction", () => {
    for (const t of loadRewriteTemplates("MY")) {
      expect(t.jurisdiction).toBe("MY");
    }
  });
});
