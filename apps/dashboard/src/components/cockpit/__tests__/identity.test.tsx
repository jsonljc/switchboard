// apps/dashboard/src/components/cockpit/__tests__/identity.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Identity } from "../identity";
import type { CockpitStatus } from "../types";
import { ALEX_VARIANTS } from "@/components/cockpit/sprite/alex-variants";

const BASE_PROPS = {
  statusKey: "WORKING" as const,
  halted: false,
  subtitle: "SDR · Consultations pipeline · Acme Medspa",
  line: null,
  onHaltToggle: () => {},
};

describe("Identity", () => {
  it("renders the agent name 'Alex' and a status pill", () => {
    render(
      <Identity
        statusKey="WORKING"
        halted={false}
        subtitle="SDR · Consultations pipeline · Acme Medspa"
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
        subtitle="SDR · Consultations pipeline · Acme Medspa"
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
        subtitle="SDR · Consultations pipeline"
        line={null}
        onHaltToggle={() => {}}
      />,
    );
    expect(screen.getByText("SDR · Consultations pipeline")).toBeInTheDocument();
    // No button or anchor wrapping the subtitle — popover lands at A.2.
    expect(container.querySelector("[data-mission-trigger]")).toBeNull();
  });
});

describe("Identity — mission interactive subtitle (A.2)", () => {
  it("renders subtitle as plain text by default (A.1 behavior preserved)", () => {
    render(<Identity {...BASE_PROPS} subtitle="SDR · Consultations pipeline · Acme Medspa" />);
    const subtitle = screen.getByText("SDR · Consultations pipeline · Acme Medspa");
    expect(subtitle.tagName.toLowerCase()).not.toBe("button");
  });

  it("renders subtitle as a button and calls onOpenMission when interactive", () => {
    const onOpenMission = vi.fn();
    render(
      <Identity
        {...BASE_PROPS}
        subtitle="SDR · Consultations pipeline · Acme Medspa"
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
      <Identity
        {...BASE_PROPS}
        subtitle="SDR · Consultations pipeline · Acme Medspa"
        missionInteractive
      />,
    );
    const subtitle = screen.getByText("SDR · Consultations pipeline · Acme Medspa");
    expect(subtitle.tagName.toLowerCase()).not.toBe("button");
  });
});

describe("Identity — per-agent name + avatar accent (B.3 cleanup)", () => {
  it("defaults to 'Alex' when displayName is not provided", () => {
    render(<Identity {...BASE_PROPS} />);
    expect(screen.getByText("Alex")).toBeInTheDocument();
  });

  it("renders the provided displayName in place of the hardcoded 'Alex'", () => {
    render(<Identity {...BASE_PROPS} displayName="Riley" />);
    expect(screen.getByText("Riley")).toBeInTheDocument();
    expect(screen.queryByText("Alex")).not.toBeInTheDocument();
  });

  it("avatar uses the first character of displayName when overridden", () => {
    const { container } = render(<Identity {...BASE_PROPS} displayName="Riley" />);
    // Avatar letter is rendered inside the AvatarFrame's span; query by exact text.
    expect(container.textContent).toContain("R");
  });

  it("avatar honors avatarAccent override (soft → background, deep → letter color)", () => {
    const { container } = render(
      <Identity
        {...BASE_PROPS}
        displayName="Riley"
        avatarAccent={{ soft: "#ECD4C8", deep: "#7E4533" }}
      />,
    );
    // Find the AvatarFrame div — it's the first descendant with inline background.
    const avatarDiv = container.querySelector('div[style*="background"]') as HTMLElement;
    expect(avatarDiv).not.toBeNull();
    expect(avatarDiv.getAttribute("style")).toContain("rgb(236, 212, 200)"); // #ECD4C8
    const letterSpan = avatarDiv.querySelector("span") as HTMLElement;
    expect(letterSpan.getAttribute("style")).toContain("rgb(126, 69, 51)"); // #7E4533
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

describe("Identity — sprite avatar wiring (Commit #3)", () => {
  it("renders a sprite SVG when bundle + variant + spriteState are passed", () => {
    const { container } = render(
      <Identity
        statusKey="WORKING"
        halted={false}
        subtitle="SDR · Consultations pipeline"
        line={null}
        onHaltToggle={() => {}}
        bundle={ALEX_VARIANTS}
        variant="classic"
        spriteState="draft"
      />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("falls back to the letter avatar when bundle/variant doesn't resolve", () => {
    const { container, getByText } = render(
      <Identity
        statusKey="WORKING"
        halted={false}
        subtitle="…"
        line={null}
        onHaltToggle={() => {}}
        bundle={ALEX_VARIANTS}
        variant="does-not-exist"
        spriteState="idle"
      />,
    );
    expect(getByText("A")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("falls back to the letter avatar when bundle is omitted entirely (pre-migration callers)", () => {
    const { container, getByText } = render(
      <Identity
        statusKey="WORKING"
        halted={false}
        subtitle="…"
        line={null}
        onHaltToggle={() => {}}
      />,
    );
    expect(getByText("A")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });
});
