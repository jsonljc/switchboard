import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Colophon } from "./colophon";

describe("Colophon", () => {
  it("shows the attribution caveat (booked, not collected) and the Sample badge", () => {
    const { container } = render(
      <Colophon
        period="MAY 1 — MAY 26"
        label="THIS MONTH"
        isLive={false}
        generatedAt={new Date("2026-05-26T08:55:00Z")}
      />,
    );
    expect(container.textContent?.toLowerCase()).toContain("booked");
    expect(container.textContent?.toLowerCase()).toContain("not collected");
    expect(container.textContent).toMatch(/Sample data/i);
  });
  it("shows the Live badge when isLive", () => {
    const { container } = render(
      <Colophon period="MAY 1 — MAY 26" label="THIS MONTH" isLive generatedAt={new Date()} />,
    );
    expect(container.textContent).toMatch(/Live data/i);
  });
});
