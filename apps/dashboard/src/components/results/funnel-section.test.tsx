import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { goodFixture } from "@/app/(auth)/(mercury)/reports/fixtures";
import { FunnelSection } from "./funnel-section";

describe("FunnelSection", () => {
  it("renders each stage label straight from the wire", () => {
    const { container } = render(
      <FunnelSection funnel={goodFixture.funnel} narrative={goodFixture.funnelNarrative} />,
    );
    for (const row of goodFixture.funnel) expect(container.textContent).toContain(row.stage);
  });

  it("renders the section eyebrow 'Funnel'", () => {
    const { container } = render(
      <FunnelSection funnel={goodFixture.funnel} narrative={goodFixture.funnelNarrative} />,
    );
    expect(container.textContent).toContain("Funnel");
  });

  it("renders the caption 'five stages · proportional'", () => {
    const { container } = render(
      <FunnelSection funnel={goodFixture.funnel} narrative={goodFixture.funnelNarrative} />,
    );
    expect(container.textContent).toContain("five stages");
    expect(container.textContent).toContain("proportional");
  });

  it("renders the funnel narrative byline (marker)", () => {
    const { container } = render(
      <FunnelSection funnel={goodFixture.funnel} narrative={goodFixture.funnelNarrative} />,
    );
    expect(container.textContent).toContain(goodFixture.funnelNarrative.marker);
  });
  it("does not crash on a zero-n row (empty bar)", () => {
    const z = {
      funnel: [{ stage: "Impressions", n: 0, label: "—", delta: null }],
      narrative: goodFixture.funnelNarrative,
    };
    const { container } = render(<FunnelSection funnel={z.funnel} narrative={z.narrative} />);
    expect(container.textContent).toContain("Impressions");
  });
});
