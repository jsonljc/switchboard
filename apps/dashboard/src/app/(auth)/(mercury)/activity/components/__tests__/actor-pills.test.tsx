import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActorPills } from "../actor-pills.js";

const COUNTS = { user: 5, agent: 12, system: 7, service_account: 3 };

describe("ActorPills", () => {
  it("renders four pills with counts", () => {
    render(<ActorPills value={null} counts={COUNTS} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /User/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Agent/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /System/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Service/ })).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("renders the muted helper line about specific-actor filtering", () => {
    render(<ActorPills value={null} counts={COUNTS} onChange={() => {}} />);
    expect(
      screen.getByText(/Specific actor filtering \(e\.g\. just Alex\) is not yet available/),
    ).toBeInTheDocument();
  });

  it("the active pill carries aria-pressed=true", () => {
    render(<ActorPills value="agent" counts={COUNTS} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /Agent/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /User/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("clicking an inactive pill fires onChange with the new actor type", async () => {
    const onChange = vi.fn();
    render(<ActorPills value="agent" counts={COUNTS} onChange={onChange} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /User/ }));
    expect(onChange).toHaveBeenCalledWith("user");
  });

  it("clicking the active pill deselects (fires onChange with null)", async () => {
    const onChange = vi.fn();
    render(<ActorPills value="agent" counts={COUNTS} onChange={onChange} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /Agent/ }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
