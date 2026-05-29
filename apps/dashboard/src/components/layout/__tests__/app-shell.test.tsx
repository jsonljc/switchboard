import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppShell, ONBOARDING_EXEMPT_PATHS } from "../app-shell";

const pathnameRef = { current: "/contacts" };
const replaceMock = vi.fn();
const orgConfigMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameRef.current,
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock("@/hooks/use-org-config", () => ({
  useOrgConfig: (enabled?: boolean) => orgConfigMock(enabled),
}));

const devPanelProps: { current: Record<string, unknown> } = { current: {} };

vi.mock("next/dynamic", () => ({
  default: (_loader: () => Promise<{ DevPanel: React.FC<Record<string, unknown>> }>) => {
    const Component = (props: Record<string, unknown>) => {
      devPanelProps.current = props;
      return <div data-testid="dev-panel" />;
    };
    Component.displayName = "DynamicDevPanel";
    return Component;
  },
}));

vi.mock("../data-mode-banner", () => ({
  DataModeBanner: () => <div data-testid="data-mode-banner" />,
}));

// The editorial shell is mounted by AppShell itself now (one shared shell for all
// authed routes). Mock it to a recognizable marker so these tests assert AppShell's
// branch decision — "does this route get the shell?" — without pulling the real
// shell's whole client subtree (providers, nav, popovers). The shell's own
// behavior is covered by editorial-auth-shell.test.tsx.
vi.mock("../editorial-shell-boundary", () => ({
  EditorialShellBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../editorial-auth-shell", () => ({
  EditorialAuthShellInner: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="editorial-shell">
      <main>{children}</main>
    </div>
  ),
}));

beforeEach(() => {
  pathnameRef.current = "/contacts";
  replaceMock.mockReset();
  orgConfigMock.mockReset();
  orgConfigMock.mockReturnValue({
    data: { config: { onboardingComplete: true } },
    isLoading: false,
  });
});

describe("AppShell shell-mount branches", () => {
  it("mounts the shared editorial shell on editorial paths", () => {
    pathnameRef.current = "/alex";
    render(
      <AppShell>
        <span>editorial-content</span>
      </AppShell>,
    );
    expect(screen.getByTestId("editorial-shell")).toBeInTheDocument();
    expect(screen.getByText("editorial-content")).toBeDefined();
  });

  it("mounts the shared editorial shell on Mercury paths", () => {
    pathnameRef.current = "/contacts";
    render(
      <AppShell>
        <span>mercury-content</span>
      </AppShell>,
    );
    expect(screen.getByTestId("editorial-shell")).toBeInTheDocument();
    expect(screen.getByText("mercury-content")).toBeDefined();
  });

  it("mounts the shared editorial shell on Mercury detail paths", () => {
    pathnameRef.current = "/contacts/abc-123";
    render(
      <AppShell>
        <span>detail-content</span>
      </AppShell>,
    );
    expect(screen.getByTestId("editorial-shell")).toBeInTheDocument();
  });

  it("mounts the shared editorial shell on /settings (gains the unified header)", () => {
    pathnameRef.current = "/settings";
    render(
      <AppShell>
        <span>settings-content</span>
      </AppShell>,
    );
    expect(screen.getByTestId("editorial-shell")).toBeInTheDocument();
    expect(screen.getByText("settings-content")).toBeDefined();
  });

  it("mounts the shared editorial shell on the authed home (/)", () => {
    pathnameRef.current = "/";
    render(
      <AppShell>
        <span>home-content</span>
      </AppShell>,
    );
    expect(screen.getByTestId("editorial-shell")).toBeInTheDocument();
  });

  it("renders /onboarding chrome-free (no editorial shell, no app-header)", () => {
    pathnameRef.current = "/onboarding";
    render(
      <AppShell>
        <span>onboarding-content</span>
      </AppShell>,
    );
    expect(screen.queryByTestId("editorial-shell")).toBeNull();
    expect(screen.getByText("onboarding-content")).toBeDefined();
  });

  it("renders /onboarding sub-paths chrome-free (prefix match)", () => {
    pathnameRef.current = "/onboarding/step-2";
    render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    expect(screen.queryByTestId("editorial-shell")).toBeNull();
  });

  it("renders /operator chrome-free (no customer app-header)", () => {
    pathnameRef.current = "/operator";
    render(
      <AppShell>
        <span>operator-content</span>
      </AppShell>,
    );
    expect(screen.queryByTestId("editorial-shell")).toBeNull();
    expect(screen.getByText("operator-content")).toBeDefined();
  });

  it("renders /operator sub-paths chrome-free (prefix match)", () => {
    pathnameRef.current = "/operator/reports";
    render(
      <AppShell>
        <span>operator-reports-content</span>
      </AppShell>,
    );
    expect(screen.queryByTestId("editorial-shell")).toBeNull();
    expect(screen.getByText("operator-reports-content")).toBeDefined();
  });

  it("/login is NOT chrome-free in AppShell (it is a top-level route that never reaches AppShell)", () => {
    // /login lives in app/login/page.tsx outside the (auth) group — it never
    // reaches AppShell in production. It was removed from CHROME_FREE_PATHS
    // because that entry was dead. If /login ever did reach AppShell it would
    // render the editorial shell, which is acceptable (the route itself guards
    // access). The important invariant is that /onboarding and /operator are
    // chrome-free, tested above.
    pathnameRef.current = "/login";
    render(
      <AppShell>
        <span>login-content</span>
      </AppShell>,
    );
    // /login is NOT in CHROME_FREE_PATHS — it would get the editorial shell
    // if it ever reached AppShell (it doesn't in practice).
    expect(screen.getByTestId("editorial-shell")).toBeInTheDocument();
  });

  it("does not match chrome-free prefix-collisions (treats /onboardingx as shelled)", () => {
    // Guards the canonical `pathname === p || pathname.startsWith(p + "/")` shape
    // against an accidental drop of the trailing slash, which would silently
    // strip chrome from paths that merely share a prefix with /onboarding.
    pathnameRef.current = "/onboardingx";
    render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    expect(screen.getByTestId("editorial-shell")).toBeInTheDocument();
  });

  it("source does not reference OwnerShell or OwnerTabs", () => {
    // Source-text guardrail against re-introducing legacy chrome via dynamic
    // import or string-keyed lookup. owner-shell.tsx is already deleted, so
    // a static import would also fail typecheck — this is defense-in-depth.
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    const path = require("node:path") as typeof import("node:path");
    const source = fs.readFileSync(path.join(__dirname, "../app-shell.tsx"), "utf8");
    expect(source).not.toContain("OwnerShell");
    expect(source).not.toContain("OwnerTabs");
  });
});

describe("ONBOARDING_EXEMPT_PATHS membership (gating, not chrome)", () => {
  it("contains only login/onboarding — not Mercury surfaces or settings", () => {
    expect(ONBOARDING_EXEMPT_PATHS).toEqual(["/login", "/onboarding"]);
  });
});

describe("Onboarding-redirect behavior", () => {
  it("does not redirect while org-config is loading", () => {
    pathnameRef.current = "/contacts";
    orgConfigMock.mockReturnValue({ data: undefined, isLoading: true });
    render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("redirects from a Mercury surface when onboarding is incomplete", () => {
    pathnameRef.current = "/contacts";
    orgConfigMock.mockReturnValue({
      data: { config: { onboardingComplete: false } },
      isLoading: false,
    });
    render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    expect(replaceMock).toHaveBeenCalledWith("/onboarding");
  });

  it("redirects from /settings when onboarding is incomplete", () => {
    pathnameRef.current = "/settings";
    orgConfigMock.mockReturnValue({
      data: { config: { onboardingComplete: false } },
      isLoading: false,
    });
    render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    expect(replaceMock).toHaveBeenCalledWith("/onboarding");
  });

  it("does not redirect from /onboarding (exempt)", () => {
    pathnameRef.current = "/onboarding";
    orgConfigMock.mockReturnValue({
      data: { config: { onboardingComplete: false } },
      isLoading: false,
    });
    render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("does not redirect from /login (exempt)", () => {
    pathnameRef.current = "/login";
    orgConfigMock.mockReturnValue({
      data: { config: { onboardingComplete: false } },
      isLoading: false,
    });
    render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("does not redirect from the gate-exempt /mira cockpit", () => {
    pathnameRef.current = "/mira";
    orgConfigMock.mockReturnValue({
      data: { config: { onboardingComplete: false } },
      isLoading: false,
    });
    render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("redirects from the retired /alex path when onboarding is incomplete (no longer gate-exempt)", () => {
    // /alex was retired; it is no longer in ONBOARDING_GATE_EXEMPT_EXACT and is
    // gated like any other path (in production it redirects to /?agent=alex,
    // which is itself gated as "/").
    pathnameRef.current = "/alex";
    orgConfigMock.mockReturnValue({
      data: { config: { onboardingComplete: false } },
      isLoading: false,
    });
    render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    expect(replaceMock).toHaveBeenCalledWith("/onboarding");
  });

  it("redirects from / (Home) when onboarding is incomplete", () => {
    // Home is NOT exempt from the onboarding gate — an authenticated but
    // not-yet-onboarded user landing on / must be routed to /onboarding.
    pathnameRef.current = "/";
    orgConfigMock.mockReturnValue({
      data: { config: { onboardingComplete: false } },
      isLoading: false,
    });
    render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    expect(replaceMock).toHaveBeenCalledWith("/onboarding");
  });

  it("does not redirect when onboarding is complete", () => {
    pathnameRef.current = "/contacts";
    orgConfigMock.mockReturnValue({
      data: { config: { onboardingComplete: true } },
      isLoading: false,
    });
    render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("skips org-config fetch on the gate-exempt /mira cockpit", () => {
    pathnameRef.current = "/mira";
    render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    expect(orgConfigMock).toHaveBeenCalledWith(false);
  });

  it("skips org-config fetch on onboarding-exempt paths", () => {
    pathnameRef.current = "/login";
    render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    expect(orgConfigMock).toHaveBeenCalledWith(false);
  });

  it("fetches org-config on Mercury surfaces (gating active)", () => {
    pathnameRef.current = "/contacts";
    render(
      <AppShell>
        <span>x</span>
      </AppShell>,
    );
    expect(orgConfigMock).toHaveBeenCalledWith(true);
  });
});

describe("AppShell — dataModeControlsAllowed prop forwarding", () => {
  it("forwards dataModeControlsAllowed=true to DevPanel in the shell branch", () => {
    pathnameRef.current = "/alex";
    render(
      <AppShell dataModeControlsAllowed={true}>
        <span>x</span>
      </AppShell>,
    );
    expect(devPanelProps.current.dataModeControlsAllowed).toBe(true);
  });

  it("forwards dataModeControlsAllowed=false to DevPanel in the chrome-free branch", () => {
    pathnameRef.current = "/onboarding";
    render(
      <AppShell dataModeControlsAllowed={false}>
        <span>x</span>
      </AppShell>,
    );
    expect(devPanelProps.current.dataModeControlsAllowed).toBe(false);
  });
});

describe("AppShell — DataModeBanner mounted in both branches", () => {
  it("mounts DataModeBanner in the shell branch", () => {
    pathnameRef.current = "/alex";
    render(
      <AppShell dataModeControlsAllowed={false}>
        <span>x</span>
      </AppShell>,
    );
    expect(screen.getByTestId("data-mode-banner")).toBeInTheDocument();
  });

  it("mounts DataModeBanner in the chrome-free branch", () => {
    pathnameRef.current = "/onboarding";
    render(
      <AppShell dataModeControlsAllowed={false}>
        <span>x</span>
      </AppShell>,
    );
    expect(screen.getByTestId("data-mode-banner")).toBeInTheDocument();
  });
});
