// apps/dashboard/src/components/agent-avatar/__tests__/printed-portrait-avatar.test.tsx
import { describe, it, expect } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { PrintedPortraitAvatar } from "../printed-portrait-avatar";

describe("<PrintedPortraitAvatar>", () => {
  it("renders the pixel sprite SVG for alex and riley", () => {
    const alex = render(<PrintedPortraitAvatar agentKey="alex" />);
    expect(alex.container.querySelector("svg")).not.toBeNull();
    const riley = render(<PrintedPortraitAvatar agentKey="riley" />);
    expect(riley.container.querySelector("svg")).not.toBeNull();
  });

  it("renders the pixel sprite SVG for mira (no letter fallback)", () => {
    const { container, queryByText } = render(<PrintedPortraitAvatar agentKey="mira" />);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(queryByText("M")).toBeNull();
  });

  it("renders Mira's sprite when working and resolves the draft sprite-state", () => {
    const { container, queryByText } = render(
      <PrintedPortraitAvatar agentKey="mira" status="working" />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(queryByText("M")).toBeNull();
    expect((container.firstElementChild as HTMLElement).dataset.spriteState).toBe("draft");
  });

  it("exposes resolved sprite-state and pip as data attributes from status", () => {
    const { container } = render(<PrintedPortraitAvatar agentKey="alex" status="working" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.dataset.spriteState).toBe("draft");
    expect(root.dataset.pip).toBe("active");
    expect(root.dataset.agent).toBe("alex");
  });

  it("halted overrides status -> sleep + locked pip", () => {
    const { container } = render(
      <PrintedPortraitAvatar agentKey="riley" status="working" halted />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.dataset.spriteState).toBe("sleep");
    expect(root.dataset.pip).toBe("locked");
  });

  it("renders a status pip element by default and omits it when showPip is false", () => {
    const withPip = render(<PrintedPortraitAvatar agentKey="alex" status="idle" />);
    expect(withPip.container.querySelectorAll("[data-pip]").length).toBe(2);
    const noPip = render(<PrintedPortraitAvatar agentKey="alex" status="idle" showPip={false} />);
    expect(noPip.container.querySelectorAll("[data-pip]").length).toBe(1);
  });

  it("data-playing reflects status and the one-breathing-avatar budget", () => {
    const working = render(<PrintedPortraitAvatar agentKey="alex" status="working" />);
    expect((working.container.firstElementChild as HTMLElement).dataset.playing).toBe("true");
    const idle = render(<PrintedPortraitAvatar agentKey="alex" status="idle" />);
    expect((idle.container.firstElementChild as HTMLElement).dataset.playing).toBe("false");
    const halted = render(<PrintedPortraitAvatar agentKey="alex" status="working" halted />);
    expect((halted.container.firstElementChild as HTMLElement).dataset.playing).toBe("false");
    const budgeted = render(
      <PrintedPortraitAvatar agentKey="alex" status="working" allowMotion={false} />,
    );
    expect((budgeted.container.firstElementChild as HTMLElement).dataset.playing).toBe("false");
  });

  it("holds still under prefers-reduced-motion even when working", async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      const { container } = render(<PrintedPortraitAvatar agentKey="alex" status="working" />);
      await waitFor(() =>
        expect((container.firstElementChild as HTMLElement).dataset.playing).toBe("false"),
      );
    } finally {
      window.matchMedia = original;
    }
  });

  it("applies the requested size to the root box", () => {
    const { container } = render(<PrintedPortraitAvatar agentKey="alex" size={44} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.width).toBe("44px");
    expect(root.style.height).toBe("44px");
  });

  it("is decorative (root aria-hidden) so adjacent name text is not duplicated", () => {
    const { container } = render(<PrintedPortraitAvatar agentKey="alex" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute("aria-hidden")).toBe("true");
  });
});
