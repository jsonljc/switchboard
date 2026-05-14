// apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { MissionAggregatorResponse } from "@/lib/cockpit/mission-types";

// Mock data hooks before importing the page.
vi.mock("@/app/(auth)/(mercury)/approvals/hooks/use-approvals", () => ({
  usePendingApprovals: () => ({ data: { approvals: [] }, isLoading: false }),
}));

vi.mock("@/hooks/use-agent-activity", () => ({
  useAgentActivity: () => ({ data: { roster: [], states: [], actions: [] }, isLoading: false }),
}));

vi.mock("@/hooks/use-agent-greeting", () => ({
  useAgentGreeting: () => ({ data: null, isLoading: false }),
}));

const toggleHaltMock = vi.fn();
let haltedState = false;

vi.mock("@/components/layout/halt/halt-context", () => ({
  useHalt: () => ({
    halted: haltedState,
    setHalted: vi.fn(),
    toggleHalt: toggleHaltMock,
  }),
}));

let missionData: MissionAggregatorResponse | undefined = undefined;

vi.mock("@/hooks/use-agent-mission", () => ({
  useAgentMission: () => ({
    data: missionData,
    isLoading: false,
    isError: false,
  }),
}));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { CockpitPage } from "../cockpit-page";

const FULL_MISSION_ALL_UNDONE: MissionAggregatorResponse = {
  agentKey: "alex",
  displayName: "Alex",
  mission: {
    role: "SDR · qualify inbound leads, book tours",
    pipeline: "Tours pipeline · single funnel",
    brand: "HotPod Yoga · —",
    channels: [],
    rules: null,
  },
  composerPlaceholder: "Tell Alex what to do — coming soon",
  commands: [],
  targets: { avgValueCents: null, targetCpbCents: null, roasSource: "deterministic" },
  setup: [
    { key: "meta", done: false, primary: true },
    { key: "inbox", done: false },
    { key: "cal", done: false },
    { key: "rules", done: false },
  ],
};

const MISSION_PARTIAL_DONE: MissionAggregatorResponse = {
  ...FULL_MISSION_ALL_UNDONE,
  setup: [
    { key: "meta", done: true },
    { key: "inbox", done: false, primary: true },
    { key: "cal", done: false },
    { key: "rules", done: false },
  ],
};

describe("CockpitPage", () => {
  beforeEach(() => {
    toggleHaltMock.mockClear();
    pushMock.mockClear();
    haltedState = false;
    missionData = undefined;
  });

  it("renders Topbar, Identity, and ActivityStream in the cold state", () => {
    render(<CockpitPage />);
    // Topbar tab "Alex" + Identity name "Alex" = 2 matches
    expect(screen.getAllByText("Alex").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Switchboard")).toBeInTheDocument();
    expect(screen.getByText("IDLE")).toBeInTheDocument();
    expect(screen.getByText(/Nothing here yet/i)).toBeInTheDocument();
  });

  it("does not render ApprovalBlock when no pending approvals", () => {
    render(<CockpitPage />);
    expect(screen.queryByText(/Alex needs you/i)).not.toBeInTheDocument();
  });

  it("clicking the Halt button calls useHalt().toggleHalt()", () => {
    render(<CockpitPage />);
    fireEvent.click(screen.getByRole("button", { name: /halt/i }));
    expect(toggleHaltMock).toHaveBeenCalledOnce();
  });

  it("renders the HALTED status pill when useHalt() reports halted", () => {
    haltedState = true;
    render(<CockpitPage />);
    expect(screen.getByText("HALTED")).toBeInTheDocument();
    expect(screen.getByText(/Halted — resume to send instructions/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument();
  });

  it("consumes the existing HaltProvider (does not re-root)", () => {
    haltedState = true;
    render(<CockpitPage />);
    expect(screen.getByText("HALTED")).toBeInTheDocument();
  });
});

describe("CockpitPage — A.2 mission + empty-state", () => {
  beforeEach(() => {
    toggleHaltMock.mockClear();
    pushMock.mockClear();
    haltedState = false;
    missionData = undefined;
  });

  it("makes the subtitle clickable once mission data loads and toggles the popover", async () => {
    missionData = FULL_MISSION_ALL_UNDONE;
    render(<CockpitPage />);
    // The subtitle should be a button when mission data is present.
    const subtitle = await screen.findByRole("button", { name: /SDR/i });
    fireEvent.click(subtitle);
    // The mission popover should open (has role=dialog with aria-label "Alex mission").
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: /Alex mission/i })).toBeInTheDocument(),
    );
  });

  it("renders EmptyState (and hides activity stream) when setup is all-undone", async () => {
    missionData = FULL_MISSION_ALL_UNDONE;
    render(<CockpitPage />);
    expect(await screen.findByTestId("cockpit-empty-state")).toBeInTheDocument();
    expect(screen.queryByTestId("cockpit-activity-stream")).not.toBeInTheDocument();
  });

  it("renders the activity stream (and not EmptyState) when at least one setup row is done", async () => {
    missionData = MISSION_PARTIAL_DONE;
    render(<CockpitPage />);
    expect(await screen.findByTestId("cockpit-activity-stream")).toBeInTheDocument();
    expect(screen.queryByTestId("cockpit-empty-state")).not.toBeInTheDocument();
  });
});
