import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AppShell, CHROME_HIDDEN_PATHS } from "../app-shell.js";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("@/hooks/use-org-config", () => ({
  useOrgConfig: () => ({ data: { config: { onboardingComplete: true } }, isLoading: false }),
}));

vi.mock("@/components/layout/owner-shell", () => ({
  OwnerShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="owner-shell">{children}</div>
  ),
}));

vi.mock("next/dynamic", () => ({
  default: (_loader: () => Promise<{ DevPanel: React.FC }>) => {
    // Return a simple wrapper that renders nothing in tests
    const Component = () => <div data-testid="dev-panel" />;
    Component.displayName = "DynamicDevPanel";
    return Component;
  },
}));

describe("AppShell", () => {
  it("always renders OwnerShell for authenticated routes", () => {
    render(
      <AppShell>
        <span>content</span>
      </AppShell>,
    );
    expect(screen.getByTestId("owner-shell")).toBeDefined();
    expect(screen.getByText("content")).toBeDefined();
  });

  it("does not render StaffShell", () => {
    render(
      <AppShell>
        <span>content</span>
      </AppShell>,
    );
    expect(screen.queryByTestId("staff-shell")).toBeNull();
  });
});

describe("app-shell CHROME_HIDDEN_PATHS", () => {
  it("does not include /console (operator's home at v1; needs OwnerTabs)", () => {
    expect(CHROME_HIDDEN_PATHS).not.toContain("/console");
  });

  it("still hides chrome for /login, /onboarding, /setup", () => {
    expect(CHROME_HIDDEN_PATHS).toContain("/login");
    expect(CHROME_HIDDEN_PATHS).toContain("/onboarding");
    expect(CHROME_HIDDEN_PATHS).toContain("/setup");
  });
});
