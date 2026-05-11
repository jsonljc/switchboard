import { describe, it, expect } from "vitest";
import { renderHandoffTemplate } from "../handoff-template.js";

describe("renderHandoffTemplate", () => {
  it("renders the SG template", () => {
    const out = renderHandoffTemplate({ jurisdiction: "SG", reasonCode: "medical_safety_trigger" });
    expect(out).toMatchInlineSnapshot(
      `"Thanks for sharing that — this is something the clinic team should advise on directly. I'll get them to follow up with you shortly."`,
    );
  });

  it("renders the MY template", () => {
    const out = renderHandoffTemplate({ jurisdiction: "MY", reasonCode: "compliance_concern" });
    expect(out).toMatchInlineSnapshot(
      `"Thanks for sharing that — this is something the clinic team should advise on directly. I'll have them follow up with you shortly."`,
    );
  });

  it("returns the same SG string regardless of reasonCode in 1b-1", () => {
    const a = renderHandoffTemplate({ jurisdiction: "SG", reasonCode: "banned_phrase" });
    const b = renderHandoffTemplate({ jurisdiction: "SG", reasonCode: "sensitive_inbound" });
    expect(a).toBe(b);
  });
});
