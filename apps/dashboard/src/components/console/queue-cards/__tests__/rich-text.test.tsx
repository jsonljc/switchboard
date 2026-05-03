import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { RichTextSpan, capitalize } from "../rich-text";

describe("RichTextSpan", () => {
  it("renders plain string segments", () => {
    const { container } = render(<RichTextSpan value={["hello ", "world"]} />);
    expect(container.textContent).toBe("hello world");
  });

  it("wraps {bold} segments in <b>", () => {
    const { container } = render(<RichTextSpan value={[{ bold: "bold" }]} />);
    expect(container.querySelector("b")?.textContent).toBe("bold");
  });

  it("wraps {coral} segments in <em>", () => {
    const { container } = render(<RichTextSpan value={[{ coral: "warn" }]} />);
    expect(container.querySelector("em")?.textContent).toBe("warn");
  });
});

describe("capitalize", () => {
  it("uppercases the first letter", () => {
    expect(capitalize("alex")).toBe("Alex");
  });

  it("returns empty string for empty input", () => {
    expect(capitalize("")).toBe("");
  });
});
