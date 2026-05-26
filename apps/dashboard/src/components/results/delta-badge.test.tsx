import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DeltaBadge } from "./delta-badge";

describe("DeltaBadge", () => {
  it("renders nothing when delta is null", () => {
    const { container } = render(<DeltaBadge delta={null} />);
    expect(container.firstChild).toBeNull();
  });
  it("renders the delta text (which carries the glyph)", () => {
    const { getByText } = render(<DeltaBadge delta={{ kind: "pos", text: "↑ 18%" }} />);
    expect(getByText("↑ 18%")).toBeInTheDocument();
  });
  it("exposes the delta kind via a data attribute (for kind-specific styling)", () => {
    const { getByText } = render(<DeltaBadge delta={{ kind: "neg", text: "↓ 6%" }} />);
    expect(getByText("↓ 6%").getAttribute("data-kind")).toBe("neg");
  });
});
