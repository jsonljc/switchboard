import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProseSegments } from "../prose-segments";

describe("ProseSegments", () => {
  it("renders text and accent segments inline", () => {
    render(
      <ProseSegments
        segments={[
          { kind: "text", text: "Three leads. " },
          { kind: "accent", text: "Maya" },
          { kind: "text", text: " first." },
        ]}
      />,
    );
    const accent = screen.getByText("Maya");
    expect(accent.tagName).toBe("SPAN");
    expect(accent).toHaveClass("accent");
  });

  it("renders nothing for empty segments", () => {
    const { container } = render(<ProseSegments segments={[]} />);
    expect(container.firstChild?.textContent).toBe("");
  });
});
