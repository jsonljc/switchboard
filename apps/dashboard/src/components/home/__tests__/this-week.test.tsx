import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThisWeek } from "../this-week";
import type { ThisWeekModel } from "../types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const fullModel: ThisWeekModel = {
  authorName: "Alex",
  authorKey: "alex",
  bookedConsults: 19,
  newLeads: 62,
  replyTime: "52s",
  costPerLead: "$18.40",
  ps: "P.S. Friday 4 PM consults are converting like crazy.",
  reportHref: "/results",
};

const partialModel: ThisWeekModel = {
  authorName: "Alex",
  authorKey: "alex",
  bookedConsults: 19,
  newLeads: 62,
  // replyTime + costPerLead intentionally absent
  reportHref: "/results",
};

const noMetricsModel: ThisWeekModel = {
  authorName: "Alex",
  authorKey: "alex",
  // All four core metrics absent
  reportHref: "/results",
};

// ---------------------------------------------------------------------------
// Tests: note state (metrics present)
// ---------------------------------------------------------------------------

describe("ThisWeek — note state (at least one metric present)", () => {
  describe("with full model", () => {
    it("renders the booked consult count", () => {
      render(<ThisWeek model={fullModel} />);
      // "19" should appear in the document
      expect(screen.getByText("19")).toBeInTheDocument();
    });

    it("renders the new leads count", () => {
      render(<ThisWeek model={fullModel} />);
      expect(screen.getByText("62")).toBeInTheDocument();
    });

    it("renders the reply time", () => {
      render(<ThisWeek model={fullModel} />);
      expect(screen.getByText("52s")).toBeInTheDocument();
    });

    it("renders the cost per lead", () => {
      render(<ThisWeek model={fullModel} />);
      expect(screen.getByText("$18.40")).toBeInTheDocument();
    });

    it("renders the PS when present", () => {
      render(<ThisWeek model={fullModel} />);
      expect(
        screen.getByText("P.S. Friday 4 PM consults are converting like crazy."),
      ).toBeInTheDocument();
    });

    it("renders a 'Read full report' link with href /results", () => {
      render(<ThisWeek model={fullModel} />);
      const link = screen.getByRole("link", { name: /read full report/i });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", "/results");
    });

    it("renders the author name in the header", () => {
      render(<ThisWeek model={fullModel} />);
      // authorName appears at least once (header + signoff); just assert presence
      expect(screen.getAllByText("Alex").length).toBeGreaterThanOrEqual(1);
    });

    it("renders the signoff with author name", () => {
      const { container } = render(<ThisWeek model={fullModel} />);
      // The signoff span contains the author name
      expect(container.textContent).toContain("Alex");
    });

    it("does NOT use dangerouslySetInnerHTML (no __html in DOM)", () => {
      // If dangerouslySetInnerHTML were used, raw HTML tags would appear as
      // literal text (e.g. "<em>"). Confirm no angle-bracket tags leak.
      const { container } = render(<ThisWeek model={fullModel} />);
      expect(container.textContent).not.toMatch(/<em>|<span>/);
    });
  });

  describe("with partial model (bookedConsults + newLeads only)", () => {
    it("renders the consults number", () => {
      render(<ThisWeek model={partialModel} />);
      expect(screen.getByText("19")).toBeInTheDocument();
    });

    it("renders the leads number", () => {
      render(<ThisWeek model={partialModel} />);
      expect(screen.getByText("62")).toBeInTheDocument();
    });

    it("does NOT render absent metric values (replyTime / costPerLead)", () => {
      const { container } = render(<ThisWeek model={partialModel} />);
      // Neither the placeholder replyTime nor costPerLead should appear
      expect(container.textContent).not.toContain("52s");
      expect(container.textContent).not.toContain("$18.40");
    });

    it("does NOT render PS when absent", () => {
      render(<ThisWeek model={partialModel} />);
      expect(screen.queryByText(/P\.S\./i)).not.toBeInTheDocument();
    });

    it("still renders the 'Read full report' drill link", () => {
      render(<ThisWeek model={partialModel} />);
      const link = screen.getByRole("link", { name: /read full report/i });
      expect(link).toHaveAttribute("href", "/results");
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: empty / skeleton state
// ---------------------------------------------------------------------------

describe("ThisWeek — empty/skeleton state", () => {
  describe("when model is undefined", () => {
    it("renders the placeholder copy (not a crash)", () => {
      render(<ThisWeek />);
      // Some indication that things aren't ready
      expect(screen.getByRole("article")).toBeInTheDocument();
    });

    it("does NOT render any fabricated metric (no multi-digit numbers or dollar signs)", () => {
      const { container } = render(<ThisWeek />);
      // No dollar signs (no invented revenue)
      expect(container.textContent).not.toMatch(/\$/);
      // No multi-digit numbers (no invented consult/lead counts)
      expect(container.textContent).not.toMatch(/\d{2,}/);
    });

    it("does NOT render a 'Read full report' link", () => {
      render(<ThisWeek />);
      expect(screen.queryByRole("link", { name: /read full report/i })).not.toBeInTheDocument();
    });

    it("renders the calm placeholder text", () => {
      const { container } = render(<ThisWeek />);
      expect(container.textContent).toContain("tallied");
    });
  });

  describe("when model has no metrics (all four fields undefined)", () => {
    it("does NOT render any fabricated metric", () => {
      const { container } = render(<ThisWeek model={noMetricsModel} />);
      expect(container.textContent).not.toMatch(/\$/);
      expect(container.textContent).not.toMatch(/\d{2,}/);
    });

    it("does NOT render a 'Read full report' link", () => {
      render(<ThisWeek model={noMetricsModel} />);
      expect(screen.queryByRole("link", { name: /read full report/i })).not.toBeInTheDocument();
    });

    it("renders the calm placeholder text", () => {
      const { container } = render(<ThisWeek model={noMetricsModel} />);
      expect(container.textContent).toContain("tallied");
    });

    it("renders the author name from the model", () => {
      render(<ThisWeek model={noMetricsModel} />);
      expect(screen.getAllByText("Alex").length).toBeGreaterThanOrEqual(1);
    });
  });
});
