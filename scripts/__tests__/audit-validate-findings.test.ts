import { describe, it, expect } from "vitest";
import { validateFindings } from "../audit-validate-findings.js";

const validDoc = `---
surface: 01-dashboard-core
discovered_at: HEAD
---

# Dashboard core — Findings

## Coverage
Checked: A — see findings below

## DC-01

- **Surface:** /console
- **Sub-surface:** queue zone
- **Dimension:** D
- **Severity:** High
- **Affects:** all users
- **Status:** Open
- **Discovered-at:** HEAD
- **Effort:** S

**What:**
Empty queue renders nothing.

**Evidence:**
- File: apps/dashboard/src/components/console/console-view.tsx:142
- Repro: Visit /console with no escalations.

**Fix:**
Render EmptyState component.
`;

describe("validateFindings", () => {
  it("accepts a valid findings doc", () => {
    const result = validateFindings(validDoc);
    expect(result.errors).toEqual([]);
  });

  it("rejects a finding missing a required field", () => {
    const bad = validDoc.replace("- **Severity:** High\n", "");
    const result = validateFindings(bad);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/DC-01.*Severity/)]),
    );
  });

  it("rejects a Launch-blocker with only one evidence type", () => {
    const bad = validDoc
      .replace("- **Severity:** High", "- **Severity:** Launch-blocker")
      .replace(
        "- File: apps/dashboard/src/components/console/console-view.tsx:142\n- Repro: Visit /console with no escalations.",
        "- Repro: Visit /console with no escalations.",
      );
    const result = validateFindings(bad);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/DC-01.*evidence/i)]),
    );
  });

  it("rejects an unknown severity", () => {
    const bad = validDoc.replace("- **Severity:** High", "- **Severity:** Critical");
    const result = validateFindings(bad);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/DC-01.*Severity.*Critical/)]),
    );
  });

  it("rejects an unknown dimension", () => {
    const bad = validDoc.replace("- **Dimension:** D", "- **Dimension:** Z");
    const result = validateFindings(bad);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/DC-01.*Dimension.*Z/)]),
    );
  });

  it("rejects an unknown status", () => {
    const bad = validDoc.replace("- **Status:** Open", "- **Status:** WIP");
    const result = validateFindings(bad);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/DC-01.*Status.*WIP/)]),
    );
  });

  it("rejects a placeholder left in", () => {
    const bad = validDoc.replace("queue zone", "<zone>");
    const result = validateFindings(bad);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/DC-01.*placeholder/i)]),
    );
  });
});
