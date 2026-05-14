import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EventTypeCombobox } from "../event-type-combobox.js";

const BANDS = {
  "Action lifecycle": ["action.executed", "action.failed"],
  "Identity & governance": ["identity.created", "policy.updated"],
  "Events & reactions": ["event.published"],
  "Agent & WorkTrace": ["agent.activated", "work_trace.persisted"],
} as const;

const COUNTS: Record<string, number> = {
  "action.executed": 4,
  "action.failed": 1,
  "identity.created": 2,
  "policy.updated": 0,
  "event.published": 1,
  "agent.activated": 0,
  "work_trace.persisted": 3,
};

describe("EventTypeCombobox", () => {
  it("does not render the popover initially", () => {
    render(<EventTypeCombobox value={null} bands={BANDS} counts={COUNTS} onChange={() => {}} />);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("opening shows grouped band headers and all options", async () => {
    render(<EventTypeCombobox value={null} bands={BANDS} counts={COUNTS} onChange={() => {}} />);
    await userEvent.setup().click(screen.getByRole("combobox"));
    expect(screen.getByText(/Action lifecycle/)).toBeInTheDocument();
    expect(screen.getByText(/Identity & governance/)).toBeInTheDocument();
    expect(screen.getByText(/Events & reactions/)).toBeInTheDocument();
    expect(screen.getByText(/Agent & WorkTrace/)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /action\.executed/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /work_trace\.persisted/ })).toBeInTheDocument();
  });

  it("each option displays its `· N on this page` count suffix", async () => {
    render(<EventTypeCombobox value={null} bands={BANDS} counts={COUNTS} onChange={() => {}} />);
    await userEvent.setup().click(screen.getByRole("combobox"));
    const option = screen.getByRole("option", { name: /action\.executed/ });
    expect(within(option).getByText(/4 on this page/)).toBeInTheDocument();
  });

  it("typing filters options by substring (no band headers, no <em>)", async () => {
    const { container } = render(
      <EventTypeCombobox value={null} bands={BANDS} counts={COUNTS} onChange={() => {}} />,
    );
    const input = screen.getByRole("combobox");
    await userEvent.setup().type(input, "action");
    expect(screen.getByRole("option", { name: /action\.executed/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /action\.failed/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /identity\.created/ })).toBeNull();
    expect(screen.queryByText(/Action lifecycle/)).toBeNull();
    expect(container.querySelector("em")).toBeNull();
  });

  it("clicking an option fires onChange with the value and closes the popover", async () => {
    const onChange = vi.fn();
    render(<EventTypeCombobox value={null} bands={BANDS} counts={COUNTS} onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: /action\.failed/ }));
    expect(onChange).toHaveBeenCalledWith("action.failed");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("ArrowDown moves highlight; Enter selects the highlighted option", async () => {
    const onChange = vi.fn();
    render(<EventTypeCombobox value={null} bands={BANDS} counts={COUNTS} onChange={onChange} />);
    const input = screen.getByRole("combobox");
    const user = userEvent.setup();
    await user.click(input);
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    // Flattened order: action.executed, action.failed, identity.created, ...
    // Two ArrowDowns from -1 → index 1 = action.failed.
    expect(onChange).toHaveBeenCalledWith("action.failed");
  });

  it("Escape closes the popover without firing onChange", async () => {
    const onChange = vi.fn();
    render(<EventTypeCombobox value={null} bands={BANDS} counts={COUNTS} onChange={onChange} />);
    const input = screen.getByRole("combobox");
    const user = userEvent.setup();
    await user.click(input);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("the × clear button fires onChange(null)", async () => {
    const onChange = vi.fn();
    render(
      <EventTypeCombobox
        value="action.executed"
        bands={BANDS}
        counts={COUNTS}
        onChange={onChange}
      />,
    );
    const clear = screen.getByRole("button", { name: /clear event type/i });
    await userEvent.setup().click(clear);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("selected option is marked with aria-selected=true in the popover", async () => {
    render(
      <EventTypeCombobox
        value="action.executed"
        bands={BANDS}
        counts={COUNTS}
        onChange={() => {}}
      />,
    );
    await userEvent.setup().click(screen.getByRole("combobox"));
    const opt = screen.getByRole("option", { name: /action\.executed/ });
    expect(opt).toHaveAttribute("aria-selected", "true");
  });
});
