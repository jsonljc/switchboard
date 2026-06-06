import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { MiraHeader } from "../mira-header";

describe("MiraHeader", () => {
  it("renders the printed-portrait sprite, not a letter monogram", () => {
    const { container } = render(
      <MiraHeader halted={false} subtitle="Creative drafts, ready for your review" line={null} />,
    );
    const avatar = container.querySelector('[data-agent="mira"]');
    expect(avatar).not.toBeNull();
    expect(avatar!.getAttribute("data-sprite-state")).toBe("idle");
    expect(screen.getByText("Mira")).toBeInTheDocument();
  });

  it("drives the draft sprite state from working status", () => {
    const { container } = render(
      <MiraHeader status="working" halted={false} subtitle="sub" line={null} />,
    );
    expect(container.querySelector('[data-agent="mira"]')!.getAttribute("data-sprite-state")).toBe(
      "draft",
    );
  });

  it("upgrades the subtitle to a mission button only after hydration (no SSR mismatch)", async () => {
    const onOpenMission = vi.fn();
    render(
      <MiraHeader
        halted={false}
        subtitle="Creative drafts, ready for your review"
        line={null}
        missionInteractive
        onOpenMission={onOpenMission}
      />,
    );
    await waitFor(() => expect(screen.getByTitle("Edit Mira's mission")).toBeInTheDocument());
    screen.getByTitle("Edit Mira's mission").click();
    expect(onOpenMission).toHaveBeenCalled();
  });

  it("renders no halt button (the masthead owns halt)", () => {
    render(<MiraHeader halted={false} subtitle="sub" line={null} />);
    expect(screen.queryByText(/halt/i)).toBeNull();
  });

  it("renders the greeting line when present", () => {
    render(<MiraHeader halted={false} subtitle="sub" line="You've got 3 drafts" />);
    expect(screen.getByText("You've got 3 drafts")).toBeInTheDocument();
  });

  it("server-renders plain subtitle text with no mission button (SSR-safe first paint)", () => {
    const html = renderToStaticMarkup(
      <MiraHeader
        halted={false}
        subtitle="Creative drafts, ready for your review"
        line={null}
        missionInteractive
        onOpenMission={() => {}}
      />,
    );
    expect(html).toContain("Creative drafts, ready for your review");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Edit Mira's mission");
  });

  it("exposes the agent name as the page heading", () => {
    render(<MiraHeader halted={false} subtitle="sub" line={null} />);
    expect(screen.getByRole("heading", { level: 1, name: "Mira" })).toBeInTheDocument();
  });
});
