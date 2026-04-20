import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FaqAccordion } from "../faq-accordion";

const ITEMS = [
  { question: "Is it free?", answer: "No, it starts at $49/month." },
  { question: "Can I cancel?", answer: "Yes, anytime." },
];

describe("FaqAccordion", () => {
  it("renders all questions", () => {
    render(<FaqAccordion items={ITEMS} />);
    expect(screen.getByText("Is it free?")).toBeInTheDocument();
    expect(screen.getByText("Can I cancel?")).toBeInTheDocument();
  });

  it("hides answers by default", () => {
    render(<FaqAccordion items={ITEMS} />);
    expect(screen.queryByText("No, it starts at $49/month.")).not.toBeVisible();
  });

  it("shows answer when question is clicked", async () => {
    const user = userEvent.setup();
    render(<FaqAccordion items={ITEMS} />);
    await user.click(screen.getByText("Is it free?"));
    expect(screen.getByText("No, it starts at $49/month.")).toBeVisible();
  });

  it("hides answer when clicked again", async () => {
    const user = userEvent.setup();
    render(<FaqAccordion items={ITEMS} />);
    await user.click(screen.getByText("Is it free?"));
    await user.click(screen.getByText("Is it free?"));
    expect(screen.queryByText("No, it starts at $49/month.")).not.toBeVisible();
  });
});
