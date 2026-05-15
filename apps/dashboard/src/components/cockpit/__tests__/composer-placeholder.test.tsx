// apps/dashboard/src/components/cockpit/__tests__/composer-placeholder.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ComposerPlaceholder } from "../composer-placeholder";

describe("ComposerPlaceholder", () => {
  it("renders the placeholder copy", () => {
    render(<ComposerPlaceholder halted={false} />);
    expect(screen.getByText(/Tell Alex what to do — coming soon/i)).toBeInTheDocument();
  });

  it("renders halted copy when halted", () => {
    render(<ComposerPlaceholder halted />);
    expect(screen.getByText(/Halted — resume to send instructions/i)).toBeInTheDocument();
  });

  it("renders Alex sender + Alex copy when overrides are absent", () => {
    const { container } = render(<ComposerPlaceholder halted={false} />);
    expect(container.textContent).toContain("→ ALEX");
    expect(container.textContent).toContain("Tell Alex what to do — coming soon");
  });

  it("renders override sender + override copy when supplied", () => {
    const { container } = render(
      <ComposerPlaceholder
        halted={false}
        senderLabel="RILEY"
        placeholderCopy="Tell Riley what to do — pause the Cold Interests adset, raise daily budget to $200…"
      />,
    );
    expect(container.textContent).toContain("→ RILEY");
    expect(container.textContent).toContain("Tell Riley what to do");
    expect(container.textContent).not.toContain("Tell Alex");
  });

  it("preserves halted copy regardless of placeholderCopy override", () => {
    const { container } = render(
      <ComposerPlaceholder halted={true} senderLabel="RILEY" placeholderCopy="anything" />,
    );
    expect(container.textContent).toContain("Halted — resume to send instructions");
    expect(container.textContent).not.toContain("anything");
  });

  it("uses accentColor for the sender label when supplied", () => {
    const { container } = render(
      <ComposerPlaceholder halted={false} senderLabel="RILEY" accentColor="rgb(126, 69, 51)" />,
    );
    const sender = Array.from(container.querySelectorAll("span")).find((s) =>
      (s.textContent ?? "").includes("→ RILEY"),
    ) as HTMLElement | undefined;
    expect(sender).toBeDefined();
    expect(sender!.style.color.toLowerCase()).toBe("rgb(126, 69, 51)");
  });
});
