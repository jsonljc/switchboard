// apps/dashboard/src/components/cockpit/__tests__/composer-placeholder.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ComposerPlaceholder } from "../composer-placeholder.js";

describe("ComposerPlaceholder", () => {
  it("renders the placeholder copy", () => {
    render(<ComposerPlaceholder halted={false} />);
    expect(screen.getByText(/Tell Alex what to do — coming soon/i)).toBeInTheDocument();
  });

  it("renders halted copy when halted", () => {
    render(<ComposerPlaceholder halted />);
    expect(screen.getByText(/Halted — resume to send instructions/i)).toBeInTheDocument();
  });
});
