import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const mockUsePathname = vi.fn(() => "/");
vi.mock("next/navigation", () => ({ usePathname: () => mockUsePathname() }));

const mockEnabled = vi.fn().mockReturnValue({ enabled: false });
vi.mock("@/hooks/use-mira-enabled", () => ({ useMiraEnabled: () => mockEnabled() }));

import { PrimaryNav } from "../primary-nav";

describe("PrimaryNav", () => {
  beforeEach(() => {
    mockUsePathname.mockReturnValue("/");
    mockEnabled.mockReturnValue({ enabled: false });
  });

  it("renders exactly Home, Inbox, Results when Mira is not enabled", () => {
    render(<PrimaryNav />);
    expect(screen.getByRole("link", { name: /home/i })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: /inbox/i })).toHaveAttribute("href", "/inbox");
    expect(screen.getByRole("link", { name: /results/i })).toHaveAttribute("href", "/results");
    expect(screen.queryByRole("link", { name: /team|alex|riley|mira/i })).toBeNull();
  });

  it("marks Home active on /", () => {
    render(<PrimaryNav />);
    expect(screen.getByRole("link", { name: /home/i })).toHaveAttribute("aria-current", "page");
  });

  it("does NOT mark Home active when pathname is /inbox", () => {
    mockUsePathname.mockReturnValue("/inbox");
    render(<PrimaryNav />);
    const homeLink = screen.getByRole("link", { name: /home/i });
    expect(homeLink).not.toHaveAttribute("aria-current");
  });

  it("includes Mira when the org has her enabled", () => {
    mockEnabled.mockReturnValue({ enabled: true });
    render(<PrimaryNav />);
    expect(screen.getByRole("link", { name: "Mira" })).toHaveAttribute("href", "/mira");
  });

  it("omits Mira when not enabled", () => {
    mockEnabled.mockReturnValue({ enabled: false });
    render(<PrimaryNav />);
    expect(screen.queryByRole("link", { name: "Mira" })).toBeNull();
  });

  it("keeps the three core tabs in order", () => {
    mockEnabled.mockReturnValue({ enabled: false });
    render(<PrimaryNav />);
    const labels = screen.getAllByRole("link").map((l) => l.textContent);
    expect(labels).toEqual(["Home", "Inbox", "Results"]);
  });
});
