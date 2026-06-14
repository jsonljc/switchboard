import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MiraNeedsAttention } from "../mira-needs-attention";
import type { MiraDeskItem } from "@switchboard/core";

const item = (over: Partial<MiraDeskItem>): MiraDeskItem => ({
  id: "i",
  title: "Botox promo",
  stage: "production",
  state: "approved_draft",
  updatedAt: "2026-06-12",
  awaitingGo: false,
  problem: "publish_failed",
  ...over,
});

describe("MiraNeedsAttention", () => {
  it("renders nothing in the happy path (no failures to attend to)", () => {
    const { container } = render(<MiraNeedsAttention items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("surfaces a dead-lettered publish with the plain Meta message", () => {
    render(<MiraNeedsAttention items={[item({ id: "pf" })]} />);
    expect(screen.getByText(/publishing to meta failed/i)).toBeInTheDocument();
  });

  it("links each item to its detail page so the operator can see what happened", () => {
    render(<MiraNeedsAttention items={[item({ id: "job-7", title: "Lip filler promo" })]} />);
    const link = screen.getByRole("link", { name: /lip filler promo/i });
    expect(link.getAttribute("href")).toBe("/mira/creatives/job-7");
  });
});
