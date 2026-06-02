import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Verdict } from "../verdict";
import type { VerdictModel } from "../types";
import { checkA11y } from "@/test-a11y";

// The Home verdict hero is the first thing an operator reads each session; its
// three shapes (active / calm / fallback) must be structurally accessible.

const models: Record<string, VerdictModel> = {
  active: {
    shape: "active",
    eyebrow: "Tuesday, May 26 · 9:47 AM",
    salutation: "Good morning, Dana",
    line: { pre: "One thing needs you. ", em: "Alex", post: " has it ready." },
    proof: "4 open leads · oldest waiting 12 min · 2 of 3 working",
    accentAgent: "alex",
  },
  calm: {
    shape: "calm",
    eyebrow: "Tuesday, May 26 · 9:47 AM",
    salutation: "Good morning, Dana",
    line: { pre: "", em: "All caught up.", post: " Your team's running clean." },
    proof: "4 open enquiries · 2 of 3 working",
    accentAgent: undefined,
  },
  fallback: {
    shape: "fallback",
    eyebrow: "Tuesday, May 26 · 9:47 AM",
    salutation: "Good morning, Dana",
    line: "Your team is on shift.",
    proof: "We don't have a read on today yet.",
  },
};

describe("Verdict — accessibility", () => {
  it.each(Object.keys(models))("has no axe violations (%s shape)", async (shape) => {
    const { container } = render(<Verdict model={models[shape]!} />);
    expect(await checkA11y(container)).toHaveNoViolations();
  });
});
