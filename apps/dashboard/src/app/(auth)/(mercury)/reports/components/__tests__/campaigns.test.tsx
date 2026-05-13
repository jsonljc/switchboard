import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { Campaigns } from "../campaigns";
import type { CampaignRow } from "@switchboard/schemas";

const rows: CampaignRow[] = [
  {
    name: "Spring-Hydrafacial",
    spend: 620,
    impressions: 138400,
    inlineLinkClicks: 1842,
    costPerInlineLinkClick: 0.34,
    inlineLinkClickCtr: 0.0133,
    leads: 88,
    revenue: 6240,
    cpl: 7.05,
    clickToLeadRate: 0.0478,
    roas: 10.06,
  },
  {
    name: "Lookalike-Q2-Wide",
    spend: 412,
    impressions: 58900,
    inlineLinkClicks: 318,
    costPerInlineLinkClick: 1.3,
    inlineLinkClickCtr: 0.0054,
    leads: 9,
    revenue: 190,
    cpl: 45.78,
    clickToLeadRate: 0.0283,
    roas: 0.46,
  },
  {
    name: "Dead-Row",
    spend: 248,
    impressions: 38800,
    inlineLinkClicks: 0,
    costPerInlineLinkClick: 0,
    inlineLinkClickCtr: 0,
    leads: 0,
    revenue: 0,
    cpl: null,
    clickToLeadRate: null,
    roas: 0.0,
  },
];

describe("Campaigns", () => {
  it("renders rows default-sorted by revenue desc", () => {
    render(<Campaigns campaigns={rows} />);
    const dataRows = screen.getAllByRole("row").slice(1, 1 + rows.length);
    expect(dataRows[0]?.textContent).toContain("Spring-Hydrafacial");
    expect(dataRows[dataRows.length - 1]?.textContent).toContain("Dead-Row");
  });

  it("flips sort direction when active header is clicked twice", () => {
    render(<Campaigns campaigns={rows} />);
    // Mobile cards also contain "Spend" labels — scope to the columnheader role.
    const headers = screen.getAllByRole("columnheader");
    const spendHeader = headers.find((h) => /^Spend/.test(h.textContent ?? ""));
    expect(spendHeader).toBeTruthy();
    fireEvent.click(spendHeader!); // desc
    let dataRows = screen.getAllByRole("row").slice(1, 1 + rows.length);
    expect(dataRows[0]?.textContent).toContain("Spring-Hydrafacial");
    fireEvent.click(spendHeader!); // asc — lowest spend first (Dead-Row = 248)
    dataRows = screen.getAllByRole("row").slice(1, 1 + rows.length);
    expect(dataRows[0]?.textContent).toContain("Dead-Row");
  });

  it("dead row gets the muted treatment, not red", () => {
    const { container } = render(<Campaigns campaigns={rows} />);
    expect(container.innerHTML).not.toMatch(/#f00|#ff0000|:\s*red\b/i);
    expect(container.querySelector('[class*="dead"]')).toBeTruthy();
  });

  it("totals row renders without S$NaN for null CPC/CPL handling", () => {
    const onlyNullCpcRow: CampaignRow[] = [
      {
        name: "All-Null",
        spend: 100,
        impressions: 1000,
        inlineLinkClicks: 0,
        costPerInlineLinkClick: 0,
        inlineLinkClickCtr: 0,
        leads: 0,
        revenue: 0,
        cpl: null,
        clickToLeadRate: null,
        roas: 0,
      },
    ];
    const { container } = render(<Campaigns campaigns={onlyNullCpcRow} />);
    expect(container.textContent).not.toContain("NaN");
  });

  it("never emits a bare $", () => {
    const { container } = render(<Campaigns campaigns={rows} />);
    expect(container.textContent).not.toMatch(/(?<!S)\$/);
  });

  it("renders revenue '—' for zero revenue", () => {
    render(<Campaigns campaigns={rows} />);
    // Both the table and the mobile-card list render "Dead-Row" text; scope to the table.
    const table = screen.getByRole("table");
    const deadRow = within(table).getByText("Dead-Row").closest("tr");
    expect(deadRow).toBeTruthy();
    expect(within(deadRow as HTMLElement).getAllByText("—").length).toBeGreaterThan(0);
  });
});
