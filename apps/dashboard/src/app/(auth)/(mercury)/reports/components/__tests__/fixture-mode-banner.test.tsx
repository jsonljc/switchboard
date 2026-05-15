import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { FixtureModeBanner } from "../fixture-mode-banner";

describe("FixtureModeBanner", () => {
  it("renders the demo-data label when NEXT_PUBLIC_REPORTS_LIVE is not 'true'", () => {
    vi.stubEnv("NEXT_PUBLIC_REPORTS_LIVE", "false");
    const { getByText } = render(<FixtureModeBanner />);
    expect(getByText(/demo data/i)).toBeTruthy();
  });

  it("renders nothing when NEXT_PUBLIC_REPORTS_LIVE === 'true'", () => {
    vi.stubEnv("NEXT_PUBLIC_REPORTS_LIVE", "true");
    const { container } = render(<FixtureModeBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the demo-data label when the flag is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_REPORTS_LIVE", "");
    const { getByText } = render(<FixtureModeBanner />);
    expect(getByText(/demo data/i)).toBeTruthy();
  });
});
