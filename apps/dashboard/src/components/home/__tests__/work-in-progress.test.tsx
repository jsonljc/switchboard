import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkInProgress } from "../work-in-progress";
import type { WorkInProgressItem } from "../types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const chainItem: WorkInProgressItem = {
  id: "wip-1",
  primaryAgent: "riley",
  chain: ["riley", "mira", "alex"],
  text: "Offer drafted · 8 leads queued",
};

const simpleItem: WorkInProgressItem = {
  id: "wip-2",
  primaryAgent: "alex",
  chain: null,
  text: "Booking follow-up in progress",
};

const singleChainItem: WorkInProgressItem = {
  id: "wip-3",
  primaryAgent: "alex",
  chain: ["alex"], // only 1 agent — treated as simple (no real handoff)
  text: "Single-agent task",
};

const twoChainItem: WorkInProgressItem = {
  id: "wip-4",
  primaryAgent: "riley",
  chain: ["riley", "alex"],
  text: "Budget reallocation queued for Alex",
};

// ---------------------------------------------------------------------------
// Tests: item with a real multi-agent chain (chain ≥2)
// ---------------------------------------------------------------------------

describe("WorkInProgress — chain item (chain.length >= 2)", () => {
  it("renders all three agent names in order", () => {
    render(<WorkInProgress items={[chainItem]} />);
    expect(screen.getByRole("heading", { name: /work in progress/i })).toBeInTheDocument();
    const text = screen.getByRole("list").textContent ?? "";
    const rileyIdx = text.indexOf("Riley");
    const miraIdx = text.indexOf("Mira");
    const alexIdx = text.indexOf("Alex");
    // All three present.
    expect(rileyIdx).toBeGreaterThanOrEqual(0);
    expect(miraIdx).toBeGreaterThanOrEqual(0);
    expect(alexIdx).toBeGreaterThanOrEqual(0);
    // Correct order.
    expect(rileyIdx).toBeLessThan(miraIdx);
    expect(miraIdx).toBeLessThan(alexIdx);
  });

  it("renders the outcome text as well", () => {
    render(<WorkInProgress items={[chainItem]} />);
    expect(screen.getByText(/Offer drafted/)).toBeInTheDocument();
  });

  it("sets data-handoff='true' on the row", () => {
    const { container } = render(<WorkInProgress items={[chainItem]} />);
    const row = container.querySelector("li");
    expect(row).toHaveAttribute("data-handoff", "true");
  });

  it("sets data-agent to primaryAgent on the row", () => {
    const { container } = render(<WorkInProgress items={[chainItem]} />);
    const row = container.querySelector("li");
    expect(row).toHaveAttribute("data-agent", "riley");
  });

  it("renders a two-agent chain correctly (riley → alex)", () => {
    render(<WorkInProgress items={[twoChainItem]} />);
    const text = screen.getByRole("list").textContent ?? "";
    expect(text.indexOf("Riley")).toBeLessThan(text.indexOf("Alex"));
    expect(screen.getByText(/Budget reallocation/)).toBeInTheDocument();
    const { container } = render(<WorkInProgress items={[twoChainItem]} />);
    expect(container.querySelector("li")).toHaveAttribute("data-handoff", "true");
  });
});

// ---------------------------------------------------------------------------
// Tests: item with chain=null (simple form)
// ---------------------------------------------------------------------------

describe("WorkInProgress — simple item (chain=null)", () => {
  it("renders the outcome text", () => {
    render(<WorkInProgress items={[simpleItem]} />);
    expect(screen.getByText("Booking follow-up in progress")).toBeInTheDocument();
  });

  it("does NOT render agent chain names beyond the single primary agent", () => {
    render(<WorkInProgress items={[simpleItem]} />);
    // For a simple item with primaryAgent=alex and no chain:
    // "Alex" should not appear as a chain-rendered name (no chain names visible)
    // The row text is just the plain text string — no agent name interpolated.
    const list = screen.getByRole("list");
    // The text content should contain the outcome but no chain separator "→"
    expect(list.textContent).not.toContain("→");
    // And specifically no Mira or Riley names (which would indicate leaking chain rendering)
    expect(list.textContent).not.toContain("Mira");
    expect(list.textContent).not.toContain("Riley");
  });

  it("sets data-handoff='false' on the row", () => {
    const { container } = render(<WorkInProgress items={[simpleItem]} />);
    const row = container.querySelector("li");
    expect(row).toHaveAttribute("data-handoff", "false");
  });

  it("sets data-agent to primaryAgent on the row", () => {
    const { container } = render(<WorkInProgress items={[simpleItem]} />);
    const row = container.querySelector("li");
    expect(row).toHaveAttribute("data-agent", "alex");
  });
});

// ---------------------------------------------------------------------------
// Tests: chain with only 1 agent (treated as simple — no typed handoff)
// ---------------------------------------------------------------------------

describe("WorkInProgress — chain with < 2 agents (treated as simple)", () => {
  it("sets data-handoff='false' when chain has only 1 entry", () => {
    const { container } = render(<WorkInProgress items={[singleChainItem]} />);
    const row = container.querySelector("li");
    expect(row).toHaveAttribute("data-handoff", "false");
  });

  it("renders the text without chain separator", () => {
    render(<WorkInProgress items={[singleChainItem]} />);
    const list = screen.getByRole("list");
    expect(list.textContent).not.toContain("→");
    expect(screen.getByText("Single-agent task")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: empty list
// ---------------------------------------------------------------------------

describe("WorkInProgress — empty state", () => {
  it("renders 'No active handoffs right now.' when items is empty", () => {
    render(<WorkInProgress items={[]} />);
    expect(screen.getByText("No active handoffs right now.")).toBeInTheDocument();
  });

  it("renders NO list items when items is empty", () => {
    const { container } = render(<WorkInProgress items={[]} />);
    expect(container.querySelectorAll("li")).toHaveLength(0);
  });
});
