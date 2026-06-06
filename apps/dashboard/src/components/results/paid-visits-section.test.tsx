import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import type { PaidVisitRow } from "@switchboard/schemas";
import { PaidVisitsSection } from "./paid-visits-section";

const ctwa: PaidVisitRow = {
  bookingId: "bk-1",
  amountMajor: 500,
  currency: "SGD",
  campaignId: "camp-1",
  campaignName: "Spring Promo",
  attributionBasis: "ctwa_captured",
  paidAt: "2026-06-01T00:00:00.000Z",
};
const missing: PaidVisitRow = {
  bookingId: "bk-2",
  amountMajor: 120.5,
  currency: "SGD",
  campaignId: null,
  campaignName: null,
  attributionBasis: "campaign_missing",
  paidAt: "2026-06-02T00:00:00.000Z",
};

describe("PaidVisitsSection", () => {
  it("renders one line per paid visit with honest CTWA attribution copy (never 'proven')", () => {
    const { container } = render(<PaidVisitsSection visits={[ctwa]} />);
    expect(container.textContent).toContain("Spring Promo");
    expect(container.textContent).toContain("linked to campaign");
    expect(container.textContent).toContain("via CTWA attribution");
    expect(container.textContent?.toLowerCase()).not.toContain("proven");
  });

  it("shows money as S$ with cents and no bare $", () => {
    const { container } = render(<PaidVisitsSection visits={[ctwa]} />);
    expect(container.textContent).toContain("S$500.00");
    expect(container.textContent).not.toMatch(/(?<!S)\$/);
  });

  it("renders campaign_missing honestly (not blank, not 0, not as attributed)", () => {
    const { container } = render(<PaidVisitsSection visits={[missing]} />);
    expect(container.textContent?.toLowerCase()).toContain("campaign not captured");
    expect(container.textContent).not.toContain("via CTWA attribution");
    expect(container.textContent).toContain("S$120.50");
  });

  it("renders a calm empty-state when there are no paid visits", () => {
    const { container } = render(<PaidVisitsSection visits={[]} />);
    expect(container.textContent?.toLowerCase()).toMatch(/no paid visits|once a deposit/);
  });
});
