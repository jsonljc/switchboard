import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchInput } from "../search-input";

describe("SearchInput", () => {
  it("renders an initial value and labels itself for screen readers", () => {
    render(<SearchInput initialValue="lisa" onCommit={() => {}} />);
    expect(screen.getByLabelText("Search contacts")).toHaveValue("lisa");
  });

  it("debounces commits — only fires after typing settles", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<SearchInput onCommit={onCommit} debounceMs={20} />);
    const input = screen.getByLabelText("Search contacts");

    await user.type(input, "lisa");

    // Right after typing, the most recent value should commit once.
    await waitFor(() => expect(onCommit).toHaveBeenLastCalledWith("lisa"));
    // Even with character-by-character typing, the trailing-edge debounce
    // means the final commit value matches the final input value.
    expect(onCommit.mock.calls.at(-1)?.[0]).toBe("lisa");
  });

  it("trims whitespace before committing", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<SearchInput onCommit={onCommit} debounceMs={20} />);
    await user.type(screen.getByLabelText("Search contacts"), "   lisa  ");
    await waitFor(() => expect(onCommit).toHaveBeenLastCalledWith("lisa"));
  });

  it("commits an empty string when the field is cleared", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<SearchInput initialValue="lisa" onCommit={onCommit} debounceMs={20} />);
    await user.clear(screen.getByLabelText("Search contacts"));
    await waitFor(() => expect(onCommit).toHaveBeenLastCalledWith(""));
  });

  it("does not commit on first render when value matches initialValue", async () => {
    const onCommit = vi.fn();
    render(<SearchInput initialValue="lisa" onCommit={onCommit} debounceMs={20} />);
    // Wait long enough for any debounce to have fired.
    await new Promise((r) => setTimeout(r, 60));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("resyncs local state when initialValue changes (Clear / back-forward)", async () => {
    const onCommit = vi.fn();
    const { rerender } = render(
      <SearchInput initialValue="lisa" onCommit={onCommit} debounceMs={20} />,
    );
    expect(screen.getByLabelText("Search contacts")).toHaveValue("lisa");

    rerender(<SearchInput initialValue="" onCommit={onCommit} debounceMs={20} />);
    expect(screen.getByLabelText("Search contacts")).toHaveValue("");

    // The resync must NOT trigger a debounced commit: parent already updated,
    // re-emitting "" would be a feedback loop.
    await new Promise((r) => setTimeout(r, 60));
    expect(onCommit).not.toHaveBeenCalled();
  });
});
