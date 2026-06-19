import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import type { ReactNode } from "react";

// Radix Select does not drive cleanly in jsdom (no pointer-capture stubs here),
// so shim the UI primitive to native buttons. Only the presentation primitive
// is mocked; the component's connect-wiring logic stays real.
vi.mock("@/components/ui/select", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const OnChange = React.createContext<(v: string) => void>(() => {});
  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value?: string;
      onValueChange?: (v: string) => void;
      children: ReactNode;
    }) =>
      React.createElement(
        OnChange.Provider,
        { value: onValueChange ?? (() => {}) },
        React.createElement("div", { "data-value": value ?? "" }, children),
      ),
    SelectTrigger: ({ children }: { children: ReactNode }) =>
      React.createElement("div", null, children),
    SelectValue: ({ placeholder }: { placeholder?: string }) =>
      React.createElement("span", null, placeholder ?? null),
    SelectContent: ({ children }: { children: ReactNode }) =>
      React.createElement("div", null, children),
    SelectItem: ({ value, children }: { value: string; children: ReactNode }) => {
      const onValueChange = React.useContext(OnChange);
      return React.createElement(
        "button",
        { type: "button", role: "option", onClick: () => onValueChange(value) },
        children,
      );
    },
  };
});

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1" }, status: "authenticated" }),
}));

const useOrgDeploymentId = vi.fn();
vi.mock("@/hooks/use-deployments", () => ({
  useOrgDeploymentId: () => useOrgDeploymentId(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { ConnectionsList } from "../connections-list";

function wrap(node: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(createElement(QueryClientProvider, { client: qc }, node));
}

function openMetaAdsConnectForm() {
  fireEvent.click(screen.getByRole("button", { name: /new connection/i }));
  fireEvent.click(screen.getByRole("option", { name: /meta ads/i }));
}

describe("ConnectionsList - Meta OAuth connect wiring", () => {
  let realLocation: Location;
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ connections: [] }) });
    realLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { href: "" },
    });
  });
  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: realLocation,
    });
  });

  it("sends the resolved deploymentId to the Meta authorize URL", () => {
    useOrgDeploymentId.mockReturnValue({ deploymentId: "dep_1", isLoading: false, isError: false });
    wrap(<ConnectionsList />);
    openMetaAdsConnectForm();
    fireEvent.click(screen.getByRole("button", { name: /connect with meta/i }));
    expect(window.location.href).toBe(
      "/api/dashboard/connections/facebook/authorize?deploymentId=dep_1",
    );
  });

  it("disables the connect button + explains when the org has no deployment (so authorize never 400s)", () => {
    useOrgDeploymentId.mockReturnValue({ deploymentId: null, isLoading: false, isError: false });
    wrap(<ConnectionsList />);
    openMetaAdsConnectForm();
    expect(screen.getByRole("button", { name: /connect with meta/i })).toBeDisabled();
    expect(screen.getByText(/deploy an agent/i)).toBeInTheDocument();
  });
});

describe("ConnectionsList - WhatsApp embedded signup surface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ connections: [] }) });
    useOrgDeploymentId.mockReturnValue({ deploymentId: null, isLoading: false, isError: false });
    vi.stubEnv("NEXT_PUBLIC_META_APP_ID", "test-app");
    vi.stubEnv("NEXT_PUBLIC_META_CONFIG_ID", "test-cfg");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function selectWhatsApp() {
    fireEvent.click(screen.getByRole("button", { name: /new connection/i }));
    fireEvent.click(screen.getByRole("option", { name: /^whatsapp$/i }));
  }

  it("replaces the generic credential form with the branded WhatsApp step", () => {
    wrap(<ConnectionsList />);
    selectWhatsApp();

    // Branded one-click surface is present...
    expect(screen.getByRole("heading", { name: /connect whatsapp business/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect WhatsApp" })).toBeInTheDocument();

    // ...and none of the api_key / paste-a-token chrome that muddies App Review.
    expect(screen.queryByText(/auth type/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/display name/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/credential key/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/accesstoken/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create connection/i })).not.toBeInTheDocument();
  });
});

describe("ConnectionsList - load failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgDeploymentId.mockReturnValue({ deploymentId: null, isLoading: false, isError: false });
    // The hook throws `Failed to fetch connections` — that raw string must never
    // reach the screen (audit: channels "Failed to load / Retry" finding).
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) });
  });

  it("shows a calm alert (never the raw error) with a retry when the list fails to load", async () => {
    wrap(<ConnectionsList />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Couldn't load")).toBeInTheDocument();
    expect(screen.getByText("We couldn't reach your connections.")).toBeInTheDocument();
    expect(screen.queryByText(/failed to fetch connections/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
