// apps/dashboard/src/components/cockpit/__tests__/identity.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Identity } from "../identity";
import type { CockpitStatus } from "../types";

const BASE_PROPS = {
  statusKey: "WORKING" as const,
  halted: false,
  subtitle: "SDR · Tours pipeline · HotPod",
  line: null,
  onHaltToggle: () => {},
};

describe("Identity", () => {
  it("renders the agent name 'Alex' and a status pill", () => {
    render(
      <Identity
        statusKey="WORKING"
        halted={false}
        subtitle="SDR · Tours pipeline · HotPod"
        line={null}
        onHaltToggle={() => {}}
      />,
    );
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByText("WORKING")).toBeInTheDocument();
  });

  it("renders an optional greeting line when provided", () => {
    render(
      <Identity
        statusKey="WORKING"
        halted={false}
        subtitle="SDR · Tours pipeline · HotPod"
        line="Three leads in motion."
        onHaltToggle={() => {}}
      />,
    );
    expect(screen.getByText("Three leads in motion.")).toBeInTheDocument();
  });

  it("renders Halt button when not halted; Resume when halted", () => {
    const { rerender } = render(
      <Identity
        statusKey="WORKING"
        halted={false}
        subtitle="x"
        line={null}
        onHaltToggle={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /halt/i })).toBeInTheDocument();
    rerender(
      <Identity statusKey="WORKING" halted subtitle="x" line={null} onHaltToggle={() => {}} />,
    );
    expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument();
  });

  it("invokes onHaltToggle when the halt button is clicked", () => {
    const handler = vi.fn();
    render(
      <Identity
        statusKey="WORKING"
        halted={false}
        subtitle="x"
        line={null}
        onHaltToggle={handler}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /halt/i }));
    expect(handler).toHaveBeenCalledOnce();
  });

  it("renders the subtitle as plain non-interactive text at A.1", () => {
    const { container } = render(
      <Identity
        statusKey="WORKING"
        halted={false}
        subtitle="SDR · Tours pipeline"
        line={null}
        onHaltToggle={() => {}}
      />,
    );
    expect(screen.getByText("SDR · Tours pipeline")).toBeInTheDocument();
    // No button or anchor wrapping the subtitle — popover lands at A.2.
    expect(container.querySelector("[data-mission-trigger]")).toBeNull();
  });
});

describe("Identity — mission interactive subtitle (A.2)", () => {
  it("renders subtitle as plain text by default (A.1 behavior preserved)", () => {
    render(<Identity {...BASE_PROPS} subtitle="SDR · Tours pipeline · HotPod" />);
    const subtitle = screen.getByText("SDR · Tours pipeline · HotPod");
    expect(subtitle.tagName.toLowerCase()).not.toBe("button");
  });

  it("renders subtitle as a button and calls onOpenMission when interactive", () => {
    const onOpenMission = vi.fn();
    render(
      <Identity
        {...BASE_PROPS}
        subtitle="SDR · Tours pipeline · HotPod"
        missionInteractive
        onOpenMission={onOpenMission}
      />,
    );
    const btn = screen.getByRole("button", { name: /SDR/i });
    fireEvent.click(btn);
    expect(onOpenMission).toHaveBeenCalledTimes(1);
  });

  it("does not render subtitle as button when only missionInteractive is set (no handler)", () => {
    render(
      <Identity {...BASE_PROPS} subtitle="SDR · Tours pipeline · HotPod" missionInteractive />,
    );
    const subtitle = screen.getByText("SDR · Tours pipeline · HotPod");
    expect(subtitle.tagName.toLowerCase()).not.toBe("button");
  });
});

describe("Identity — colorFor / pulseFor pass-through (B.3 prep)", () => {
  it("forwards colorFor / pulseFor through to StatusPill", () => {
    const colorFor = vi.fn((_s: CockpitStatus, _halted: boolean) => "rgb(184, 108, 80)");
    const pulseFor = vi.fn((_s: CockpitStatus, _halted: boolean) => false);
    render(
      <Identity
        statusKey="WAITING"
        halted={false}
        subtitle="Optimizing Meta Ads"
        line={null}
        onHaltToggle={() => {}}
        colorFor={colorFor}
        pulseFor={pulseFor}
      />,
    );
    expect(colorFor).toHaveBeenCalledWith("WAITING", false);
    expect(pulseFor).toHaveBeenCalledWith("WAITING", false);
  });
});
