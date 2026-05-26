import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { goodFixture } from "@/app/(auth)/(mercury)/reports/fixtures";
import { ManagedComparison } from "./managed-comparison";

describe("ManagedComparison", () => {
  const data = goodFixture.managedComparison!; // { ads:{managed,unmanaged,delta}, conversations:{...}, source }

  it("renders BOTH managed and unmanaged sides (a before/after, not a flat block)", () => {
    render(<ManagedComparison data={data} />);
    expect(screen.getAllByText(/Managed/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Unmanaged/i).length).toBeGreaterThan(0);
  });
  it("renders a source-driven caption and NEVER the upsell framing", () => {
    const { container } = render(<ManagedComparison data={data} />);
    expect(container.textContent?.toLowerCase()).toMatch(
      /with us|without|baseline|similar accounts/,
    );
    expect(container.textContent).not.toMatch(/if you had us run this/i);
  });
  it("filters absent metrics rather than fabricating them", () => {
    const adsOnly = { ...data, conversations: null };
    const { container } = render(<ManagedComparison data={adsOnly} />);
    expect(container.textContent).not.toMatch(/Replies handled/i);
  });
  it("returns null when both pairs are null and no emptyMessage", () => {
    const { container } = render(
      <ManagedComparison data={{ ads: null, conversations: null, source: "in-period-cohort" }} />,
    );
    expect(container.firstChild).toBeNull();
  });
  it("shows emptyMessage when both pairs null but a message is present", () => {
    render(
      <ManagedComparison
        data={{
          ads: null,
          conversations: null,
          source: "in-period-cohort",
          emptyMessage: "Not enough history yet.",
        }}
      />,
    );
    expect(screen.getByText("Not enough history yet.")).toBeInTheDocument();
  });
});
