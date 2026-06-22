import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TeamBand, teamStatusLabel } from "../team-band";
import type { TeamBandAgent } from "../types";

const AGENTS: TeamBandAgent[] = [
  { key: "alex", name: "Alex", setUp: true, status: "working", halted: false },
  { key: "riley", name: "Riley", setUp: true, status: "idle", halted: false },
  { key: "mira", name: "Mira", setUp: false, setupLoading: false, status: "idle", halted: false },
];

describe("teamStatusLabel", () => {
  it("is honest per state and never fabricates", () => {
    expect(
      teamStatusLabel({ key: "alex", name: "Alex", setUp: true, status: "working", halted: false }),
    ).toBe("Working");
    expect(
      teamStatusLabel({ key: "riley", name: "Riley", setUp: true, status: "idle", halted: false }),
    ).toBe("Ready");
    expect(
      teamStatusLabel({
        key: "alex",
        name: "Alex",
        setUp: true,
        status: "waiting_approval",
        halted: false,
      }),
    ).toBe("Needs you");
    expect(
      teamStatusLabel({ key: "alex", name: "Alex", setUp: true, status: "error", halted: false }),
    ).toBe("Needs you");
    expect(
      teamStatusLabel({ key: "alex", name: "Alex", setUp: true, status: "working", halted: true }),
    ).toBe("Asleep");
    expect(
      teamStatusLabel({
        key: "mira",
        name: "Mira",
        setUp: false,
        setupLoading: false,
        status: "idle",
        halted: false,
      }),
    ).toBe("Not set up yet");
    expect(
      teamStatusLabel({
        key: "mira",
        name: "Mira",
        setUp: false,
        setupLoading: true,
        status: "idle",
        halted: false,
      }),
    ).toBe("Checking setup");
  });
});

describe("<TeamBand>", () => {
  it("renders all three crew names", () => {
    render(<TeamBand agents={AGENTS} />);
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByText("Riley")).toBeInTheDocument();
    expect(screen.getByText("Mira")).toBeInTheDocument();
  });

  it("shows Mira's honest not-set-up status (a trust signal, not a dead end)", () => {
    render(<TeamBand agents={AGENTS} />);
    expect(screen.getByText("Not set up yet")).toBeInTheDocument();
  });

  it("folds the live status into the tile's accessible name (not hidden from screen readers)", () => {
    render(<TeamBand agents={AGENTS} />);
    expect(screen.getByRole("button", { name: "Open Mira, Not set up yet" })).toBeInTheDocument();
  });

  it("each tile is a button that opens that agent's panel", () => {
    const onOpen = vi.fn();
    render(<TeamBand agents={AGENTS} onOpenAgent={onOpen} />);
    fireEvent.click(screen.getByTestId("team-mate-mira"));
    expect(onOpen).toHaveBeenCalledWith("mira");
    fireEvent.click(screen.getByTestId("team-mate-alex"));
    expect(onOpen).toHaveBeenCalledWith("alex");
  });

  it("animates exactly one avatar (the first working agent) - the motion budget", () => {
    const two: TeamBandAgent[] = [
      { key: "alex", name: "Alex", setUp: true, status: "working", halted: false },
      { key: "riley", name: "Riley", setUp: true, status: "working", halted: false },
      { key: "mira", name: "Mira", setUp: true, status: "idle", halted: false },
    ];
    const { container } = render(<TeamBand agents={two} />);
    const playing = container.querySelectorAll('[data-playing="true"]');
    expect(playing.length).toBe(1);
    expect((playing[0] as HTMLElement).dataset.agent).toBe("alex");
  });

  it("halt suppresses all motion (no breathing avatar)", () => {
    const halted = AGENTS.map((a) => ({ ...a, halted: true }));
    const { container } = render(<TeamBand agents={halted} />);
    expect(container.querySelectorAll('[data-playing="true"]').length).toBe(0);
  });

  it("renders no tiles for an empty crew", () => {
    const { container } = render(<TeamBand agents={[]} />);
    expect(container.querySelectorAll("[data-testid^='team-mate-']").length).toBe(0);
  });

  it("renders the poster surface with one cell per agent", () => {
    render(<TeamBand agents={AGENTS} />);
    expect(screen.getByTestId("team-poster")).toBeInTheDocument();
  });

  it("celebrates each agent with an honest role line", () => {
    render(<TeamBand agents={AGENTS} />);
    expect(screen.getByText("Front desk")).toBeInTheDocument();
    expect(screen.getByText("Ad analyst")).toBeInTheDocument();
    expect(screen.getByText("The maker")).toBeInTheDocument();
  });

  it("features exactly the focal working agent (the same one that breathes)", () => {
    const two: TeamBandAgent[] = [
      { key: "alex", name: "Alex", setUp: true, status: "working", halted: false },
      { key: "riley", name: "Riley", setUp: true, status: "working", halted: false },
      { key: "mira", name: "Mira", setUp: true, status: "idle", halted: false },
    ];
    render(<TeamBand agents={two} />);
    expect(screen.getByTestId("team-mate-alex").dataset.featured).toBe("true");
    expect(screen.getByTestId("team-mate-riley").dataset.featured).toBe("false");
    expect(screen.getByTestId("team-mate-mira").dataset.featured).toBe("false");
  });

  it("features nobody when nobody is genuinely working (positive evidence only)", () => {
    render(<TeamBand agents={AGENTS.map((a) => ({ ...a, status: "idle" as const }))} />);
    expect(document.querySelectorAll('[data-featured="true"]')).toHaveLength(0);
  });

  it("frames the poster with decorative riso registration crop-marks", () => {
    render(<TeamBand agents={AGENTS} />);
    const marks = screen.getByTestId("poster-registration");
    expect(marks).toBeInTheDocument();
    // Decorative print-reference chrome: hidden from assistive tech.
    expect(marks.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders the portraits in fluid hero mode", () => {
    const { container } = render(<TeamBand agents={AGENTS} />);
    const heroAvatars = container.querySelectorAll('[data-hero="true"][data-size="fill"]');
    expect(heroAvatars).toHaveLength(3);
  });
});
