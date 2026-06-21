import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import type { ReactNode } from "react";

// Radix Select does not drive cleanly in jsdom (no pointer-capture stubs here),
// so shim the UI primitive to native buttons. Only the presentation primitive
// is mocked; the component's add-channel logic stays real.
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

const useOrgConfig = vi.fn();
vi.mock("@/hooks/use-org-config", () => ({
  useOrgConfig: () => useOrgConfig(),
}));

const useManagedChannels = vi.fn();
const provisionMutate = vi.fn();
const deleteMutate = vi.fn();
vi.mock("@/hooks/use-managed-channels", () => ({
  useManagedChannels: () => useManagedChannels(),
  useProvision: () => ({ mutate: provisionMutate, isPending: false }),
  useDeleteChannel: () => ({ mutate: deleteMutate, isPending: false }),
}));

vi.mock("@/hooks/use-whatsapp-management", () => ({
  useWhatsAppPhoneNumbers: () => ({ data: undefined }),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { ChannelManagement } from "../channel-management";

function wrap(node: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(createElement(QueryClientProvider, { client: qc }, node));
}

describe("ChannelManagement - WhatsApp manual token form removal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgConfig.mockReturnValue({
      data: { config: { runtimeType: "managed" } },
      isLoading: false,
    });
    useManagedChannels.mockReturnValue({
      data: { channels: [] },
      isLoading: false,
    });
  });

  function openAddChannel() {
    fireEvent.click(screen.getByRole("button", { name: /add channel/i }));
  }

  it("does not offer WhatsApp in the Add Channel picker (no manual token paste path)", () => {
    wrap(<ChannelManagement />);
    openAddChannel();

    // Telegram and Slack remain selectable via the manual provision form...
    expect(screen.getByRole("option", { name: /^telegram$/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^slack$/i })).toBeInTheDocument();

    // ...but WhatsApp is no longer an option, so the manual token surface is unreachable.
    expect(screen.queryByRole("option", { name: /^whatsapp$/i })).not.toBeInTheDocument();
  });

  it("never renders the manual WhatsApp Access Token / Phone Number ID / App Secret inputs", () => {
    wrap(<ChannelManagement />);
    openAddChannel();

    // Even if a stale "whatsapp" selection were attempted, none of the credential
    // chrome that muddies Meta App Review may appear on this surface.
    expect(screen.queryByLabelText(/access token/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/phone number id/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/app secret/i)).not.toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(/whatsapp cloud api access token/i),
    ).not.toBeInTheDocument();
  });

  it("keeps the Manage deep-link for an already-provisioned WhatsApp channel", () => {
    useManagedChannels.mockReturnValue({
      data: {
        channels: [
          {
            id: "ch-wa-1",
            channel: "whatsapp",
            botUsername: null,
            status: "active",
            statusDetail: null,
            lastHealthCheck: null,
          },
        ],
      },
      isLoading: false,
    });

    wrap(<ChannelManagement />);

    const manageLink = screen.getByRole("link", { name: /manage/i });
    expect(manageLink).toHaveAttribute("href", "/settings/channels/whatsapp");
  });

  it("still provisions Telegram through the manual form", () => {
    wrap(<ChannelManagement />);
    openAddChannel();

    fireEvent.click(screen.getByRole("option", { name: /^telegram$/i }));
    fireEvent.change(screen.getByLabelText(/bot token/i), {
      target: { value: "tg-token-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^provision$/i }));

    expect(provisionMutate).toHaveBeenCalledTimes(1);
    expect(provisionMutate.mock.calls[0][0]).toEqual({
      channels: [{ channel: "telegram", botToken: "tg-token-123" }],
    });
  });

  it("renders StatePanel (role=status) when no channels are provisioned", () => {
    // channels is already [] from the beforeEach setup
    wrap(<ChannelManagement />);

    // StatePanel with role=status should be present
    const panel = screen.getByRole("status");
    expect(panel).toBeInTheDocument();

    // Heading text from our new StatePanel
    expect(screen.getByRole("heading", { name: /no channels yet/i })).toBeInTheDocument();

    // Old plain-text fallback must NOT appear
    expect(screen.queryByText("No channels provisioned yet.")).not.toBeInTheDocument();
  });
});
