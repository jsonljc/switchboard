import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { goodFixture, quietFixture } from "@/app/(auth)/(mercury)/reports/fixtures";
import { buildResultsModel } from "./results-model";
import { WhatsWorking } from "./whats-working";

describe("WhatsWorking", () => {
  const model = buildResultsModel(goodFixture);

  it("renders Riley's funnel narrative read (marker + text)", () => {
    const { container } = render(<WhatsWorking model={model} />);
    expect(container.textContent).toContain(goodFixture.funnelNarrative.text);
    expect(container.textContent).toContain(goodFixture.funnelNarrative.marker);
  });
  it("names the strongest campaign with its roas", () => {
    const { container } = render(<WhatsWorking model={model} />);
    expect(container.textContent).toContain(model.bestCampaign!.name);
  });
  it("flags the worst campaign when its roas < 1", () => {
    const { container } = render(<WhatsWorking model={model} />);
    // goodFixture worst (min roas among spend>0) is underwater (<1) → mentioned
    expect(model.worstCampaign!.roas).toBeLessThan(1);
    expect(container.textContent).toContain(model.worstCampaign!.name);
  });
  it("does NOT flag a worst campaign when all roas >= 1", () => {
    const quiet = buildResultsModel(quietFixture); // all quiet campaigns have roas >= 1
    const { container } = render(<WhatsWorking model={quiet} />);
    expect(quiet.worstCampaign!.roas).toBeGreaterThanOrEqual(1);
    expect(container.textContent?.toLowerCase()).not.toContain("underwater");
  });
  it("does not name the same campaign as both strongest and underwater (single spending campaign)", () => {
    // One spending campaign with roas < 1 → best === worst; the laggard clause must be suppressed.
    const single = buildResultsModel({
      ...goodFixture,
      campaigns: [
        { ...goodFixture.campaigns[0], name: "Solo-Campaign", spend: 100, revenue: 50, roas: 0.5 },
      ],
    });
    expect(single.bestCampaign).toBe(single.worstCampaign); // same reference
    const { container } = render(<WhatsWorking model={single} />);
    expect(container.textContent).toContain("Solo-Campaign"); // still named as strongest
    expect(container.textContent?.toLowerCase()).not.toContain("underwater");
  });
});
