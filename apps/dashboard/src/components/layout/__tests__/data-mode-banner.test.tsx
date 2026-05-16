// apps/dashboard/src/components/layout/__tests__/data-mode-banner.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataModeBanner } from "../data-mode-banner";
import { DataModeProvider } from "@/lib/data-mode/client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe("DataModeBanner", () => {
  it("renders the short label when mode is 'demo'", () => {
    render(
      <DataModeProvider mode="demo">
        <DataModeBanner />
      </DataModeProvider>,
    );
    expect(screen.getByText(/demo data mode/i)).toBeInTheDocument();
  });

  it("renders nothing when mode is 'live'", () => {
    const { container } = render(
      <DataModeProvider mode="live">
        <DataModeBanner />
      </DataModeProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("does not announce as an error (no role='alert')", () => {
    render(
      <DataModeProvider mode="demo">
        <DataModeBanner />
      </DataModeProvider>,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("exposes longer copy via title attribute for hover", () => {
    render(
      <DataModeProvider mode="demo">
        <DataModeBanner />
      </DataModeProvider>,
    );
    const banner = screen.getByText(/demo data mode/i);
    const titled = banner.closest("[title]");
    expect(titled).not.toBeNull();
    expect(titled?.getAttribute("title")).toMatch(/live systems are not being queried/i);
  });
});
