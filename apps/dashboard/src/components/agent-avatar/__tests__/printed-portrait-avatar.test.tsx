// apps/dashboard/src/components/agent-avatar/__tests__/printed-portrait-avatar.test.tsx
import { describe, it, expect } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { PrintedPortraitAvatar, crispSpriteSize } from "../printed-portrait-avatar";

describe("crispSpriteSize", () => {
  // A 24-unit sprite reads as even pixels ONLY at an integer multiple of 24.
  // crispSpriteSize snaps the inset plate to such a multiple, clamped so it
  // never exceeds the chip box, with a sub-1x floor for tiny chips.

  it("snaps a 56px chip to a clean 2x sprite (48px)", () => {
    expect(crispSpriteSize(56)).toBe(48);
  });

  it("snaps a 52px chip to a clean 2x sprite (48px)", () => {
    expect(crispSpriteSize(52)).toBe(48);
  });

  it("fills a 48px chip at exactly 2x (48px)", () => {
    expect(crispSpriteSize(48)).toBe(48);
  });

  it("clamps a 44px chip down to 1x (24px) so the plate never exceeds the box", () => {
    // 44*0.82=36 rounds toward 48, but 48 would overflow a 44px box -> clamp to 24.
    expect(crispSpriteSize(44)).toBe(24);
  });

  it("renders a 36px chip at a crisp 1x (24px) instead of an aliased 30px", () => {
    expect(crispSpriteSize(36)).toBe(24);
  });

  it("keeps tiny chips below 1x (no overflow): 26 -> 21, 22 -> 18", () => {
    expect(crispSpriteSize(26)).toBe(21);
    expect(crispSpriteSize(22)).toBe(18);
  });

  it("returns an exact integer multiple of 24 for any chip that can hold >=1x", () => {
    for (let box = 30; box <= 200; box++) {
      expect(crispSpriteSize(box) % 24).toBe(0);
    }
  });

  it("never exceeds the chip box", () => {
    for (let box = 8; box <= 200; box++) {
      expect(crispSpriteSize(box)).toBeLessThanOrEqual(box);
    }
  });

  it("honors a custom inset ratio", () => {
    // inset 1 = no ground reveal: a 48px box holds a 48px (2x) sprite.
    expect(crispSpriteSize(48, 1)).toBe(48);
  });
});

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

  it("renders the inner sprite at a crisp integer-multiple scale (number mode)", () => {
    // 56px chip -> clean 2x (48px) sprite; 36px chip -> crisp 1x (24px).
    const big = render(<PrintedPortraitAvatar agentKey="alex" size={56} />);
    expect(big.container.querySelector("svg")?.getAttribute("width")).toBe("48");
    const small = render(<PrintedPortraitAvatar agentKey="alex" size={36} />);
    expect(small.container.querySelector("svg")?.getAttribute("width")).toBe("24");
  });

  it("is decorative (root aria-hidden) so adjacent name text is not duplicated", () => {
    const { container } = render(<PrintedPortraitAvatar agentKey="alex" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute("aria-hidden")).toBe("true");
  });

  it('size="fill" makes the box fluid (data contract; sizing lives in CSS)', () => {
    const { container } = render(<PrintedPortraitAvatar agentKey="alex" size="fill" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.dataset.size).toBe("fill");
    // No fixed inline px box in fill mode.
    expect(root.style.width).toBe("");
    expect(root.style.height).toBe("");
    // Sprite still renders, scaled to the box.
    expect(container.querySelector("svg")?.getAttribute("width")).toBe("100%");
  });

  it("number mode is unchanged (no data-size, fixed px box)", () => {
    const { container } = render(<PrintedPortraitAvatar agentKey="alex" size={44} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.dataset.size).toBeUndefined();
    expect(root.style.width).toBe("44px");
  });

  it("hero prop applies the hero frame variant (data contract)", () => {
    const { container } = render(<PrintedPortraitAvatar agentKey="riley" size="fill" hero />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.dataset.hero).toBe("true");
    const chip = render(<PrintedPortraitAvatar agentKey="riley" size={28} />);
    expect((chip.container.firstElementChild as HTMLElement).dataset.hero).toBeUndefined();
  });
});
