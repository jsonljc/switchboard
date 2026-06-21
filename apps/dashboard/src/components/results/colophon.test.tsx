import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Colophon } from "./colophon";

describe("Colophon", () => {
  it("shows the full three-point caveat and the Sample badge", () => {
    const { container } = render(
      <Colophon
        period="MAY 1 — MAY 26"
        label="THIS MONTH"
        isLive={false}
        generatedAt={new Date("2026-05-26T08:55:00Z")}
      />,
    );
    const text = container.textContent?.toLowerCase() ?? "";
    expect(text).toContain("booked");
    expect(text).toContain("not collected");
    expect(text).toMatch(/cost comparisons are illustrative/);
    expect(text).toMatch(/singapore.market median salary/);
    expect(container.textContent).toMatch(/Sample data/i);
  });
  it("shows the Live badge when isLive", () => {
    const { container } = render(
      <Colophon period="MAY 1 — MAY 26" label="THIS MONTH" isLive generatedAt={new Date()} />,
    );
    expect(container.textContent).toMatch(/Live data/i);
  });
});
