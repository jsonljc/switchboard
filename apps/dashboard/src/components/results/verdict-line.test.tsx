import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { VerdictLine } from "./verdict-line";

const pq = {
  pre: "Your team booked ",
  value: "S$14,720",
  mid: " against ",
  cost: "S$612",
  post: "Riley caught the dip early.",
};

describe("VerdictLine", () => {
  it("renders the value and cost emphasized", () => {
    render(<VerdictLine pullquote={pq} />);
    expect(screen.getByText("S$14,720")).toBeInTheDocument();
    expect(screen.getByText("S$612")).toBeInTheDocument();
  });
  it("attributes the narrative post to a Riley byline", () => {
    render(<VerdictLine pullquote={pq} />);
    expect(screen.getByText(/Riley caught the dip early\./)).toBeInTheDocument();
    expect(screen.getByText(/—\s*Riley/i)).toBeInTheDocument();
  });
  it("renders only the numbers sentence when post is empty (no dangling byline)", () => {
    render(<VerdictLine pullquote={{ ...pq, post: "" }} />);
    expect(screen.queryByText(/—\s*Riley/i)).toBeNull();
  });
});
