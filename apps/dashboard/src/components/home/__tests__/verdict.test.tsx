import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Verdict } from "../verdict";
import type { VerdictModel } from "../types";

const activeModel: VerdictModel = {
  shape: "active",
  eyebrow: "Tuesday, May 26 · 9:47 AM",
  salutation: "Good morning, Dana",
  line: { pre: "One thing needs you. ", em: "Alex", post: " has it ready." },
  proof: "4 open leads · oldest waiting 12 min · 2 of 3 working",
  accentAgent: "alex",
};

const calmModel: VerdictModel = {
  shape: "calm",
  eyebrow: "Tuesday, May 26 · 9:47 AM",
  salutation: "Good morning, Dana",
  line: { pre: "", em: "All caught up.", post: " Your team's running clean." },
  proof: "4 open enquiries · 2 of 3 working",
  accentAgent: undefined,
};

const fallbackModel: VerdictModel = {
  shape: "fallback",
  eyebrow: "Tuesday, May 26 · 9:47 AM",
  salutation: "Good morning, Dana",
  line: "Your team is on shift.",
  proof: "We don't have a read on today yet.",
};

describe("Verdict component", () => {
  describe("renders base content", () => {
    it("renders the eyebrow text", () => {
      render(<Verdict model={activeModel} />);
      expect(screen.getByText("Tuesday, May 26 · 9:47 AM")).toBeInTheDocument();
    });

    it("renders the salutation", () => {
      render(<Verdict model={activeModel} />);
      expect(screen.getByText("Good morning, Dana")).toBeInTheDocument();
    });

    it("renders the proof", () => {
      render(<Verdict model={activeModel} />);
      expect(
        screen.getByText("4 open leads · oldest waiting 12 min · 2 of 3 working"),
      ).toBeInTheDocument();
    });
  });

  describe("ACTIVE shape", () => {
    it("renders the em text in an accent span", () => {
      render(<Verdict model={activeModel} />);
      const emEl = screen.getByText("Alex");
      expect(emEl.tagName.toLowerCase()).toBe("span");
    });

    it("renders pre and post text around the accent span", () => {
      render(<Verdict model={activeModel} />);
      // The heading should contain all three parts
      const heading = screen.getByRole("heading", { level: 1 });
      expect(heading.textContent).toContain("One thing needs you.");
      expect(heading.textContent).toContain("Alex");
      expect(heading.textContent).toContain("has it ready.");
    });

    it("applies agent identity color via inline style on the accent span", () => {
      render(<Verdict model={activeModel} />);
      const emEl = screen.getByText("Alex");
      expect(emEl).toHaveStyle({ color: "hsl(var(--agent-alex))" });
    });

    it("marks shape with data-shape='active'", () => {
      render(<Verdict model={activeModel} />);
      const section = screen.getByRole("region");
      expect(section).toHaveAttribute("data-shape", "active");
    });
  });

  describe("CALM shape", () => {
    it("renders the all-clear em text", () => {
      render(<Verdict model={calmModel} />);
      expect(screen.getByText("All caught up.")).toBeInTheDocument();
    });

    it("renders the post text", () => {
      render(<Verdict model={calmModel} />);
      const heading = screen.getByRole("heading", { level: 1 });
      expect(heading.textContent).toContain("running clean");
    });

    it("no inline color style on em when accentAgent is undefined", () => {
      render(<Verdict model={calmModel} />);
      const emEl = screen.getByText("All caught up.");
      // When no accentAgent, span should not have inline color
      expect(emEl).not.toHaveStyle({ color: "hsl(var(--agent-alex))" });
      expect(emEl).not.toHaveStyle({ color: "hsl(var(--agent-riley))" });
      expect(emEl).not.toHaveStyle({ color: "hsl(var(--agent-mira))" });
    });

    it("calm em has no inline style attribute (class default provides neutral ink, not agent coral)", () => {
      // HF2(b): .accent class default was changed from hsl(var(--agent-alex)) to var(--ink).
      // CALM verdict passes accentAgent: undefined → no inline style is applied → falls through to class.
      // Verify no inline color leaks onto the em span.
      render(<Verdict model={calmModel} />);
      const emEl = screen.getByText("All caught up.");
      // No inline style attribute should be present at all (Verdict only sets style when accentAgent is defined)
      expect(emEl.style.color).toBe("");
    });

    it("marks shape with data-shape='calm'", () => {
      render(<Verdict model={calmModel} />);
      const section = screen.getByRole("region");
      expect(section).toHaveAttribute("data-shape", "calm");
    });
  });

  describe("FALLBACK shape", () => {
    it("renders the fallback line as plain text (no accent span)", () => {
      render(<Verdict model={fallbackModel} />);
      const heading = screen.getByRole("heading", { level: 1 });
      expect(heading.textContent).toBe("Your team is on shift.");
    });

    it("renders fallback proof", () => {
      render(<Verdict model={fallbackModel} />);
      expect(screen.getByText("We don't have a read on today yet.")).toBeInTheDocument();
    });

    it("marks shape with data-shape='fallback'", () => {
      render(<Verdict model={fallbackModel} />);
      const section = screen.getByRole("region");
      expect(section).toHaveAttribute("data-shape", "fallback");
    });
  });
});
