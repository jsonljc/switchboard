import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { goodFixture } from "@/app/(auth)/(mercury)/reports/fixtures";
import { CampaignsSection } from "./campaigns-section";

describe("CampaignsSection", () => {
  it("renders one entry per campaign with dollar money (no bare $)", () => {
    const { container } = render(
      <CampaignsSection campaigns={goodFixture.campaigns} layout="mobile" />,
    );
    for (const c of goodFixture.campaigns) expect(container.textContent).toContain(c.name);
    expect(container.textContent).not.toMatch(/(?<!S)\$/);
  });
  it("shows footer totals (sum revenue) on desktop", () => {
    const { container } = render(
      <CampaignsSection campaigns={goodFixture.campaigns} layout="desktop" />,
    );
    expect(container.textContent).toContain("Total");
    expect(container.textContent).toContain("S$14,720"); // Σ campaign revenue
  });
  it("renders '—' for a null-cpl campaign", () => {
    const onlyNull = goodFixture.campaigns.filter((c) => c.cpl === null);
    expect(onlyNull.length).toBeGreaterThan(0);
    const { container } = render(<CampaignsSection campaigns={onlyNull} layout="mobile" />);
    expect(container.textContent).toContain("—");
  });
  it("re-sorts without crashing when a desktop sort control is used", () => {
    render(<CampaignsSection campaigns={goodFixture.campaigns} layout="desktop" />);
    fireEvent.click(screen.getByRole("button", { name: /spend/i }));
    expect(screen.getByText(/Campaign/i)).toBeInTheDocument();
  });
  it("renders a calm empty-state when there are no campaigns", () => {
    const { container } = render(<CampaignsSection campaigns={[]} layout="mobile" />);
    expect(container.textContent?.toLowerCase()).toMatch(/no campaign|connect meta/i);
  });
});
