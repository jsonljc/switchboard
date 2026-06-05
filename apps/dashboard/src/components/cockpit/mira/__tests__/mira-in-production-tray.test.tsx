import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MiraInProductionTray } from "../mira-in-production-tray";
import type { MiraDeskItem } from "@switchboard/core";

const item = (over: Partial<MiraDeskItem>): MiraDeskItem => ({
  id: "i",
  title: "Botox promo",
  stage: "production",
  state: "in_production",
  updatedAt: "2026-05-26",
  awaitingGo: false,
  ...over,
});

describe("MiraInProductionTray", () => {
  it("links every item to its detail page (slice-3 spec 3.4: the pre-video gate path)", () => {
    render(<MiraInProductionTray items={[item({ id: "job-9" })]} />);
    const link = screen.getByRole("link", { name: /botox promo/i });
    expect(link.getAttribute("href")).toBe("/mira/creatives/job-9");
  });

  it("shows 'Waiting for your go-ahead' for items parked at an approval gate", () => {
    render(<MiraInProductionTray items={[item({ awaitingGo: true })]} />);
    expect(screen.getByText(/waiting for your go-ahead/i)).toBeInTheDocument();
  });

  it("shows ugc phase copy for ugc items (never the frozen polished stage)", () => {
    render(<MiraInProductionTray items={[item({ stage: "trends", ugcPhase: "production" })]} />);
    expect(screen.getByText(/filming the clip/i)).toBeInTheDocument();
    expect(screen.queryByText(/writing concept/i)).toBeNull();
  });

  it("shows plain stage copy per item by default", () => {
    render(<MiraInProductionTray items={[item({ id: "a", stage: "production" })]} />);
    expect(screen.getByText(/drafting/i)).toBeInTheDocument();
    expect(screen.queryByText(/storyboard|inngest|stage/i)).not.toBeInTheDocument();
  });

  it("surfaces a problem message only when a problem is present", () => {
    render(<MiraInProductionTray items={[item({ id: "b", problem: "quality_failed" })]} />);
    expect(screen.getByText(/failed a quality check/i)).toBeInTheDocument();
  });

  it("renders the calm empty state when there is nothing in production", () => {
    render(<MiraInProductionTray items={[]} />);
    expect(screen.getByText(/not working on anything/i)).toBeInTheDocument();
  });
});
