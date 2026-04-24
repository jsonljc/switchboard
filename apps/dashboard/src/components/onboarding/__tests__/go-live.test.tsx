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
});
