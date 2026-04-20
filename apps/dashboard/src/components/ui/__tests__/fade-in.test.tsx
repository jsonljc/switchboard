import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { FadeIn } from "../fade-in";

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    vi.fn().mockImplementation((callback) => ({
      observe: vi.fn((el) => {
        callback([{ isIntersecting: true, target: el }]);
      }),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    })),
  );
});

describe("FadeIn", () => {
  it("renders children", () => {
    const { getByText } = render(<FadeIn>hello</FadeIn>);
    expect(getByText("hello")).toBeInTheDocument();
  });

  it("applies visible styles when intersecting", () => {
    const { container } = render(<FadeIn>content</FadeIn>);
    const div = container.firstChild as HTMLElement;
    expect(div.style.opacity).toBe("1");
    expect(div.style.transform).toBe("translateY(0)");
  });

  it("forwards className to wrapper div", () => {
    const { container } = render(<FadeIn className="test-class">x</FadeIn>);
    expect((container.firstChild as HTMLElement).classList.contains("test-class")).toBe(true);
  });

  it("applies delay to transition", () => {
    const { container } = render(<FadeIn delay={120}>x</FadeIn>);
    const div = container.firstChild as HTMLElement;
    expect(div.style.transition).toContain("120ms");
  });
});
