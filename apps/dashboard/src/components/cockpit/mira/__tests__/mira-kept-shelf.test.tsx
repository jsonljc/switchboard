import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MiraKeptShelf } from "../mira-kept-shelf";
import type { MiraDeskItem } from "@switchboard/core";

const unkeep = vi.fn();
vi.mock("@/hooks/use-review-decision", () => ({
  useReviewDecision: () => ({ mutate: unkeep, isPending: false }),
}));

const a = (id: string): MiraDeskItem => ({
  id,
  title: `Draft ${id}`,
  stage: "complete",
  state: "approved_draft",
  thumbnailUrl: `t-${id}`,
  updatedAt: "2026-05-26",
});

describe("MiraKeptShelf", () => {
  beforeEach(() => unkeep.mockClear());

  it("shows kept drafts with the neutral 'sending to Riley comes later' sub-copy — and NO red/blocked status chip", () => {
    render(<MiraKeptShelf items={[a("1"), a("2")]} />);
    expect(screen.getByText(/sending to riley comes later/i)).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(
      screen.queryByText(/unavailable|blocked|in use|winner|fatigued/i),
    ).not.toBeInTheDocument();
  });

  it("un-keeps an item (reversible)", () => {
    render(<MiraKeptShelf items={[a("1")]} />);
    fireEvent.click(screen.getByRole("button", { name: /un-?keep/i }));
    expect(unkeep).toHaveBeenCalledWith({ id: "1", decision: null }, expect.anything());
  });

  it("renders the empty state with no forbidden status words", () => {
    render(<MiraKeptShelf items={[]} />);
    expect(screen.getByText(/drafts you keep will live here/i)).toBeInTheDocument();
  });
});
