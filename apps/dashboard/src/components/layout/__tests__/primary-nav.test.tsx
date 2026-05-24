import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
import { PrimaryNav } from "../primary-nav";

describe("PrimaryNav", () => {
  it("renders exactly Home, Inbox, Results", () => {
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
});
