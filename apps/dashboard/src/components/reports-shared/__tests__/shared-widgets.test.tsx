import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { goodFixture } from "@/app/(auth)/(mercury)/reports/fixtures";

// ─── Funnel ───────────────────────────────────────────────────────────────────
// Import from shared location (RED until funnel.tsx is created here)
import { Funnel } from "../funnel";

// ─── ManagedComparison ────────────────────────────────────────────────────────
import { ManagedComparison } from "../managed-comparison";

// ─── Colophon ─────────────────────────────────────────────────────────────────
import { Colophon } from "../colophon";

const funnelRows = goodFixture.funnel;
const funnelNarrative = goodFixture.funnelNarrative;

const mcData = goodFixture.managedComparison!;

const colophonBase = {
  period: "MAY 1 — MAY 31",
  generatedAt: new Date("2026-05-31T08:00:00Z"),
};

// ─── Funnel tests ─────────────────────────────────────────────────────────────

describe("shared Funnel", () => {
  it("renders every stage label from wire data", () => {
    const { container } = render(<Funnel rows={funnelRows} narrative={funnelNarrative} />);
    for (const row of funnelRows) {
      expect(container.textContent).toContain(row.stage);
    }
  });

  it("renders the section eyebrow 'Funnel'", () => {
    const { container } = render(<Funnel rows={funnelRows} narrative={funnelNarrative} />);
    expect(container.textContent).toContain("Funnel");
  });

  it("renders the caption 'five stages · proportional'", () => {
    const { container } = render(<Funnel rows={funnelRows} narrative={funnelNarrative} />);
    expect(container.textContent).toContain("five stages");
    expect(container.textContent).toContain("proportional");
  });

  it("renders the narrative marker from the byline", () => {
    const { container } = render(<Funnel rows={funnelRows} narrative={funnelNarrative} />);
    expect(container.textContent).toContain(funnelNarrative.marker);
  });

  it("does not crash on a zero-n row (empty bar)", () => {
    const rows = [{ stage: "Leads", n: 0, label: "0", delta: null }];
    const { container } = render(
      <Funnel rows={rows} narrative={{ marker: "test", text: "quiet period" }} />,
    );
    expect(container.textContent).toContain("Leads");
  });

  it("accepts the same FunnelRowData[] shape that both surfaces provide", () => {
    const { container } = render(<Funnel rows={goodFixture.funnel} narrative={funnelNarrative} />);
    expect(container.textContent).toContain(goodFixture.funnel[0].stage);
  });
});

// ─── ManagedComparison tests ──────────────────────────────────────────────────

describe("shared ManagedComparison", () => {
  it("renders Managed and Unmanaged sides", () => {
    render(<ManagedComparison data={mcData} />);
    expect(screen.getAllByText(/Managed/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Unmanaged/i).length).toBeGreaterThan(0);
  });

  it("renders source-driven caption", () => {
    const { container } = render(<ManagedComparison data={mcData} />);
    expect(container.textContent?.toLowerCase()).toMatch(
      /with us|without|baseline|similar accounts/,
    );
  });

  it("filters absent metrics rather than fabricating them", () => {
    const adsOnly = { ...mcData, conversations: null };
    const { container } = render(<ManagedComparison data={adsOnly} />);
    expect(container.textContent).not.toMatch(/Replies handled/i);
  });

  it("returns null when both pairs are null and no emptyMessage", () => {
    const { container } = render(
      <ManagedComparison data={{ ads: null, conversations: null, source: "in-period-cohort" }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows emptyMessage when both null but message present", () => {
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

// ─── Colophon tests ───────────────────────────────────────────────────────────

describe("shared Colophon", () => {
  it("renders the period string", () => {
    render(<Colophon {...colophonBase} />);
    expect(screen.getByText("MAY 1 — MAY 31")).toBeInTheDocument();
  });

  it("renders 'Sample data' when isLive is false", () => {
    const { container } = render(<Colophon {...colophonBase} isLive={false} />);
    expect(container.textContent).toMatch(/Sample data/i);
  });

  it("renders 'Live data' when isLive is true", () => {
    const { container } = render(<Colophon {...colophonBase} isLive />);
    expect(container.textContent).toMatch(/Live data/i);
  });

  it("renders caveat covering attribution window, booked-not-collected, and cost methodology", () => {
    const { container } = render(<Colophon {...colophonBase} />);
    const text = container.textContent?.toLowerCase() ?? "";
    expect(text).toMatch(/attribution|30.day/);
    expect(text).toMatch(/booked|not collected/);
    expect(text).toMatch(/cost comparisons are illustrative/);
    expect(text).toMatch(/singapore.market median salary/);
  });

  it("renders the org name when provided", () => {
    const { container } = render(<Colophon {...colophonBase} org="Aurora Aesthetics" />);
    expect(container.textContent).toContain("Aurora Aesthetics");
  });

  it("renders a lowercase label when provided", () => {
    const { container } = render(<Colophon {...colophonBase} label="THIS MONTH" />);
    expect(container.textContent).toContain("this month");
  });

  it("renders without org or label (minimal shape)", () => {
    const { container } = render(<Colophon {...colophonBase} />);
    expect(container.firstChild).not.toBeNull();
  });
});
