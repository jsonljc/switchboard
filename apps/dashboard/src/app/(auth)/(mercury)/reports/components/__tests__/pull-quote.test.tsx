import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { PullQuote } from "../pull-quote";

const q = {
  pre: "Your team earned you ",
  value: "S$14,720",
  mid: " in attributed pipeline this month against ",
  cost: "S$612",
  post: " paid. Riley caught the dip.",
};

describe("PullQuote", () => {
  it("renders all five slots in order", () => {
    const { container } = render(<PullQuote q={q} />);
    const text = container.textContent ?? "";
    expect(text.indexOf("Your team earned you")).toBeLessThan(text.indexOf("S$14,720"));
    expect(text.indexOf("S$14,720")).toBeLessThan(text.indexOf("in attributed pipeline"));
    expect(text.indexOf("S$612")).toBeLessThan(text.indexOf("paid"));
  });

  it("wraps value and cost in em spans", () => {
    const { container } = render(<PullQuote q={q} />);
    const ems = container.querySelectorAll('[class*="em"]');
    expect(ems.length).toBe(2);
    expect(ems[0]?.textContent).toBe("S$14,720");
    expect(ems[1]?.textContent).toBe("S$612");
  });

  it("never renders a bare $", () => {
    const { container } = render(<PullQuote q={q} />);
    expect(container.textContent).not.toMatch(/(?<!S)\$/);
  });
});
