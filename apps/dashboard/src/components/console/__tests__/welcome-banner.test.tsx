import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WelcomeBanner } from "../welcome-banner";

describe("WelcomeBanner", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = "";
  });

  it("renders heading + 3 step buttons + close button when not dismissed", () => {
    render(<WelcomeBanner />);
    expect(
      screen.getByRole("heading", { name: /welcome to your switchboard/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /1\..*decide what's in queue/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /2\..*check what each agent is doing/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /3\..*scan the activity trail/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dismiss welcome/i })).toBeInTheDocument();
  });

  it("renders nothing once dismissed (localStorage already set)", () => {
    window.localStorage.setItem("sb_welcome_dismissed", "1");
    const { container } = render(<WelcomeBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("clicking close persists dismissal and unmounts the banner", async () => {
    const user = userEvent.setup();
    render(<WelcomeBanner />);
    await user.click(screen.getByRole("button", { name: /dismiss welcome/i }));
    expect(window.localStorage.getItem("sb_welcome_dismissed")).toBe("1");
    expect(
      screen.queryByRole("heading", { name: /welcome to your switchboard/i }),
    ).not.toBeInTheDocument();
  });

  it("clicking step 1 scrolls Queue section into view", async () => {
    const user = userEvent.setup();
    const queue = document.createElement("section");
    queue.setAttribute("aria-label", "Queue");
    queue.scrollIntoView = vi.fn();
    document.body.appendChild(queue);
    render(<WelcomeBanner />);
    await user.click(screen.getByRole("button", { name: /1\..*decide what's in queue/i }));
    expect(queue.scrollIntoView).toHaveBeenCalled();
    expect(queue.classList.contains("is-flashing")).toBe(true);
  });
});
