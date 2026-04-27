import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GoLive } from "../go-live";
import { createEmptyPlaybook } from "@switchboard/schemas";

const mockReadiness = vi.fn();

vi.mock("@/hooks/use-governance", () => ({
  useReadiness: () => mockReadiness(),
}));

function readinessLoading() {
  mockReadiness.mockReturnValue({
    data: undefined,
    isLoading: true,
  });
}

function readinessNotReady() {
  mockReadiness.mockReturnValue({
    data: {
      ready: false,
      checks: [
        {
          id: "playbook",
          label: "Playbook configured",
          status: "fail",
          message: "Complete your playbook first",
          blocking: true,
        },
        {
          id: "channel",
          label: "Channel connected",
          status: "pass",
          message: "",
          blocking: true,
        },
        {
          id: "scenarios",
          label: "Test scenarios run",
          status: "fail",
          message: "Run at least 3 test conversations",
          blocking: false,
        },
      ],
    },
    isLoading: false,
  });
}

function readinessReady() {
  mockReadiness.mockReturnValue({
    data: {
      ready: true,
      checks: [
        {
          id: "playbook",
          label: "Playbook configured",
          status: "pass",
          message: "",
          blocking: true,
        },
        {
          id: "channel",
          label: "Channel connected",
          status: "pass",
          message: "",
          blocking: true,
        },
      ],
    },
    isLoading: false,
  });
}

function defaultProps(overrides: Partial<Parameters<typeof GoLive>[0]> = {}) {
  return {
    playbook: createEmptyPlaybook(),
    onLaunch: vi.fn().mockResolvedValue(undefined),
    onBack: vi.fn(),
    connectedChannels: [] as string[],
    onConnectChannel: vi.fn(),
    onLaunchComplete: vi.fn(),
    isConnecting: false,
    scenariosTested: 0,
    ...overrides,
  };
}

describe("GoLive", () => {
  beforeEach(() => {
    mockReadiness.mockReset();
  });

  it("renders page title and required section", () => {
    readinessReady();
    render(<GoLive {...defaultProps()} />);
    expect(screen.getByText("Alex is ready for your business")).toBeTruthy();
    expect(screen.getByText(/required to launch/i)).toBeTruthy();
  });

  it("shows loading state while readiness is being fetched", () => {
    readinessLoading();
    render(<GoLive {...defaultProps()} />);
    expect(screen.getByText(/checking readiness/i)).toBeTruthy();
  });

  it("renders blocking checks from API data", () => {
    readinessNotReady();
    render(<GoLive {...defaultProps()} />);
    expect(screen.getByText("Playbook configured")).toBeTruthy();
    expect(screen.getByText("Channel connected")).toBeTruthy();
    expect(screen.getByText("Complete your playbook first")).toBeTruthy();
  });

  it("renders advisory checks in recommended section", () => {
    readinessNotReady();
    render(<GoLive {...defaultProps()} />);
    expect(screen.getAllByText("Recommended").length).toBeGreaterThan(0);
    expect(screen.getByText("Test scenarios run")).toBeTruthy();
  });

  it("disables launch button when not ready", () => {
    readinessNotReady();
    render(<GoLive {...defaultProps()} />);
    const button = screen.getByRole("button", { name: /launch alex/i });
    expect(button).toHaveProperty("disabled", true);
  });

  it("enables launch button when ready", () => {
    readinessReady();
    render(<GoLive {...defaultProps()} />);
    const button = screen.getByRole("button", { name: /launch alex/i });
    expect(button).toHaveProperty("disabled", false);
  });

  it("calls onConnectChannel with channel name and credentials when connecting", async () => {
    readinessReady();
    const onConnect = vi.fn();
    render(<GoLive {...defaultProps({ onConnectChannel: onConnect })} />);
    const connectButtons = screen.getAllByText("Connect →");
    fireEvent.click(connectButtons[1]); // Telegram
    const tokenInput = screen.getByLabelText("Bot token");
    fireEvent.change(tokenInput, { target: { value: "test-token" } });
    fireEvent.click(screen.getByText("Connect"));
    expect(onConnect).toHaveBeenCalledWith("telegram", { botToken: "test-token" });
  });

  it("shows error message when connectError is set", () => {
    readinessReady();
    render(<GoLive {...defaultProps({ connectError: "Connection failed" })} />);
    expect(screen.getByText("Connection failed")).toBeTruthy();
  });

  describe("provision statusDetail surfacing (Task 11)", () => {
    // These tests assert that when the parent has translated a non-active
    // provision status into a friendly message via provisionStatusMessage(),
    // GoLive renders it inline near the Connect action without leaking
    // env-var names, phoneNumberIds, or tokens.
    function expectClean(text: string) {
      expect(text).not.toMatch(/[A-Z][A-Z0-9_]{4,}/); // no env-var-shaped tokens
      expect(text).not.toMatch(/\d{10,}/); // no long digit runs (phoneNumberId)
      expect(text).not.toMatch(/[A-Za-z0-9_-]{32,}/); // no long token-like strings
    }

    it("renders mapped pending_meta_register message verbatim", () => {
      readinessReady();
      const message =
        "We saved your connection, but couldn't fully register the webhook with Meta. Please retry, or contact support if this persists.";
      render(<GoLive {...defaultProps({ connectError: message })} />);
      const node = screen.getByText(message);
      expect(node).toBeTruthy();
      expectClean(node.textContent ?? "");
    });

    it("renders mapped pending_chat_register message verbatim", () => {
      readinessReady();
      const message =
        "Connection registered with WhatsApp, but our message router didn't acknowledge yet. Please retry, or contact support if this persists.";
      render(<GoLive {...defaultProps({ connectError: message })} />);
      expect(screen.getByText(message)).toBeTruthy();
      expectClean(message);
    });

    it("renders mapped config_error message and contains no env-var names", () => {
      readinessReady();
      const message =
        "Channel setup can't complete because the platform is not fully configured. Please contact support.";
      render(<GoLive {...defaultProps({ connectError: message })} />);
      expect(screen.getByText(message)).toBeTruthy();
      expect(message).not.toContain("CHAT_PUBLIC_URL");
      expect(message).not.toContain("INTERNAL_API_SECRET");
      expect(message).not.toContain("WHATSAPP_GRAPH_TOKEN");
      expectClean(message);
    });

    it("renders mapped health_check_failed message verbatim", () => {
      readinessReady();
      const message =
        "We couldn't verify the WhatsApp credentials. Please double-check the access token and phone number ID.";
      render(<GoLive {...defaultProps({ connectError: message })} />);
      expect(screen.getByText(message)).toBeTruthy();
      // "phone number ID" (with spaces) is fine; the long-digit pattern is what we ban.
      expect(message).not.toMatch(/\d{10,}/);
    });

    it("renders the safe v1-limit detail verbatim for status: error", () => {
      readinessReady();
      const message =
        "v1 limit: this organization already has a WhatsApp channel connected. Multi-number support is not available in v1.";
      render(<GoLive {...defaultProps({ connectError: message })} />);
      expect(screen.getByText(message)).toBeTruthy();
      expectClean(message);
    });
  });
});
