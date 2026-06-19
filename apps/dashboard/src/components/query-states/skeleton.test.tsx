import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Skeleton } from "./skeleton";

describe("Skeleton", () => {
  it("forwards className for sizing", () => {
    const { container } = render(<Skeleton className="h-48" data-testid="sk" />);
    const el = container.querySelector('[data-testid="sk"]');
    expect(el).not.toBeNull();
    expect(el).toHaveClass("h-48");
  });

  it("is aria-hidden by default (decorative; the region owns role=status)", () => {
    const { container } = render(<Skeleton />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("spreads arbitrary div props", () => {
    const { container } = render(<Skeleton data-testid="sk" style={{ width: "55%" }} />);
    const el = container.querySelector('[data-testid="sk"]') as HTMLElement;
    expect(el.style.width).toBe("55%");
  });
});
