import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const useWhatsAppAccountMock = vi.fn();
const useWhatsAppPhoneNumbersMock = vi.fn();
const useWhatsAppTemplatesMock = vi.fn();

vi.mock("@/hooks/use-whatsapp-management", () => ({
  useWhatsAppAccount: () => useWhatsAppAccountMock(),
  useWhatsAppPhoneNumbers: () => useWhatsAppPhoneNumbersMock(),
  useWhatsAppTemplates: () => useWhatsAppTemplatesMock(),
}));

vi.mock("../whatsapp-send-test", () => ({
  WhatsAppSendTest: () => createElement("div", { "data-testid": "send-test" }),
}));

vi.mock("../whatsapp-template-create", () => ({
  CreateTemplateDialog: () => createElement("button", { type: "button" }, "Create template"),
}));

import { WhatsAppManagement } from "../whatsapp-management";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrap(node: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(createElement(QueryClientProvider, { client: qc }, node));
}

const baseAccount = {
  readiness: { status: "ready" as const, reasons: [] },
  connection: {
    status: "connected",
    connectedAt: "2026-01-01T00:00:00Z",
    primaryPhoneNumberId: "phone-id-1",
    testRecipients: [],
  },
  account: {
    name: "Test WABA",
    reviewStatus: "approved",
    templateNamespace: "ns-test",
    currency: "USD",
  },
};

function mockReady() {
  useWhatsAppAccountMock.mockReturnValue({
    isLoading: false,
    error: null,
    data: baseAccount,
    refetch: vi.fn(),
  });
  useWhatsAppPhoneNumbersMock.mockReturnValue({
    isLoading: false,
    error: null,
    data: { phoneNumbers: [] },
    refetch: vi.fn(),
  });
  useWhatsAppTemplatesMock.mockReturnValue({
    isLoading: false,
    error: null,
    data: { templates: [] },
    refetch: vi.fn(),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WhatsAppManagement - StatePanel empty states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders StatePanel (role=status) for empty phone numbers", () => {
    mockReady();
    wrap(<WhatsAppManagement />);

    // StatePanel renders with role=status; the heading carries the title text
    expect(
      screen.getByRole("heading", { name: /no phone numbers registered/i }),
    ).toBeInTheDocument();
    // should NOT show old plain-text fallback
    expect(screen.queryByText("No phone numbers registered.")).not.toBeInTheDocument();
  });

  it("renders StatePanel (role=status) for empty templates", () => {
    mockReady();
    wrap(<WhatsAppManagement />);

    // StatePanel renders with role=status; the heading carries the title text
    expect(
      screen.getByRole("heading", { name: /no message templates found/i }),
    ).toBeInTheDocument();
    // old icon+paragraph fallback must be gone
    expect(screen.queryByText("No message templates found.")).not.toBeInTheDocument();
  });

  it("renders StatePanel (role=alert) + retry button for phone numbers error", () => {
    const refetch = vi.fn();
    useWhatsAppAccountMock.mockReturnValue({
      isLoading: false,
      error: null,
      data: baseAccount,
      refetch: vi.fn(),
    });
    useWhatsAppPhoneNumbersMock.mockReturnValue({
      isLoading: false,
      error: new Error("network error"),
      data: undefined,
      refetch,
    });
    useWhatsAppTemplatesMock.mockReturnValue({
      isLoading: false,
      error: null,
      data: { templates: [] },
      refetch: vi.fn(),
    });

    wrap(<WhatsAppManagement />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/phone numbers unavailable/i)).toBeInTheDocument();

    const retryBtn = screen.getAllByRole("button", { name: /try again/i })[0];
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("renders StatePanel (role=alert) + retry button for templates error", () => {
    const refetch = vi.fn();
    useWhatsAppAccountMock.mockReturnValue({
      isLoading: false,
      error: null,
      data: baseAccount,
      refetch: vi.fn(),
    });
    useWhatsAppPhoneNumbersMock.mockReturnValue({
      isLoading: false,
      error: null,
      data: { phoneNumbers: [] },
      refetch: vi.fn(),
    });
    useWhatsAppTemplatesMock.mockReturnValue({
      isLoading: false,
      error: new Error("network error"),
      data: undefined,
      refetch,
    });

    wrap(<WhatsAppManagement />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/templates unavailable/i)).toBeInTheDocument();

    const retryBtn = screen.getAllByRole("button", { name: /try again/i })[0];
    fireEvent.click(retryBtn);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("renders StatePanel (role=alert) + retry button for account-level error", () => {
    const refetch = vi.fn();
    useWhatsAppAccountMock.mockReturnValue({
      isLoading: false,
      error: new Error("timeout"),
      data: undefined,
      refetch,
    });
    useWhatsAppPhoneNumbersMock.mockReturnValue({
      isLoading: false,
      error: null,
      data: undefined,
      refetch: vi.fn(),
    });
    useWhatsAppTemplatesMock.mockReturnValue({
      isLoading: false,
      error: null,
      data: undefined,
      refetch: vi.fn(),
    });

    wrap(<WhatsAppManagement />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/whatsapp account unavailable/i)).toBeInTheDocument();

    const retryBtn = screen.getByRole("button", { name: /try again/i });
    fireEvent.click(retryBtn);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
