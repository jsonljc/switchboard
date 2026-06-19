import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { Input } from "../input";

describe("Input", () => {
  it("uses the amber action focus ring (editorial register), not the legacy ink ring", () => {
    const { container } = render(<Input />);
    const input = container.querySelector("input");
    expect(input).not.toBeNull();
    const className = input!.className;
    // Focus state speaks the editorial register: amber --action, never the legacy --ring ink.
    expect(className).toContain("focus-visible:ring-action");
    expect(className).not.toContain("focus-visible:ring-ring");
  });
});
