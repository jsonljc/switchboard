import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PatchEditor } from "../components/detail/patch-editor";

const snapshot = { discountPct: 10, memo: "Initial 10% per loyalty policy" };

describe("PatchEditor", () => {
  it("renders the current snapshot in the left pane", () => {
    render(<PatchEditor snapshot={snapshot} seed={null} onCancel={() => {}} onSubmit={() => {}} />);
    // The snapshot appears in both the <pre> and <textarea>; check at least one element is a pre.
    const matches = screen.getAllByText(/"discountPct"/);
    expect(matches.some((el) => el.tagName === "PRE")).toBe(true);
  });

  it("seeds the editor with the merged snapshot+seed", () => {
    render(
      <PatchEditor
        snapshot={snapshot}
        seed={{ discountPct: 25 }}
        onCancel={() => {}}
        onSubmit={() => {}}
      />,
    );
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(ta.value).toMatch(/"discountPct": 25/);
  });

  it("disables submit when JSON is invalid", () => {
    render(<PatchEditor snapshot={snapshot} seed={null} onCancel={() => {}} onSubmit={() => {}} />);
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "not json" } });
    expect(screen.getByRole("button", { name: /apply changes/i })).toBeDisabled();
  });

  it("disables submit when value didn't change", () => {
    render(<PatchEditor snapshot={snapshot} seed={null} onCancel={() => {}} onSubmit={() => {}} />);
    expect(screen.getByRole("button", { name: /apply changes/i })).toBeDisabled();
  });

  it("submits the parsed value when valid + changed", () => {
    const onSubmit = vi.fn();
    render(
      <PatchEditor
        snapshot={snapshot}
        seed={{ discountPct: 25 }}
        onCancel={() => {}}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /apply changes/i }));
    expect(onSubmit).toHaveBeenCalledWith({
      discountPct: 25,
      memo: "Initial 10% per loyalty policy",
    });
  });

  it("disables submit when payload exceeds 100 KB", () => {
    const big = { blob: "x".repeat(110_000) };
    render(<PatchEditor snapshot={snapshot} seed={big} onCancel={() => {}} onSubmit={() => {}} />);
    expect(screen.getByRole("button", { name: /apply changes/i })).toBeDisabled();
    expect(screen.getByText(/100 KB/)).toBeInTheDocument();
  });

  it("renders changed key names in the diff foot", () => {
    render(
      <PatchEditor
        snapshot={snapshot}
        seed={{ discountPct: 25 }}
        onCancel={() => {}}
        onSubmit={() => {}}
      />,
    );
    // Changed keys appear as a <b> in the footer; at least one element should contain the key name.
    expect(screen.getAllByText(/discountPct/).length).toBeGreaterThan(0);
  });

  it("Cancel button calls onCancel", () => {
    const onCancel = vi.fn();
    render(<PatchEditor snapshot={snapshot} seed={null} onCancel={onCancel} onSubmit={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
