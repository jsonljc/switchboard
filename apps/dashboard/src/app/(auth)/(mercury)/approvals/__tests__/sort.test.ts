import { describe, it, expect } from "vitest";
import { sortApprovals } from "../sort";
import type { ApprovalRow } from "../types";

function row(
  id: string,
  expiresAt: string,
  riskCategory: ApprovalRow["riskCategory"],
  createdAt = "2026-05-13T00:00:00Z",
): ApprovalRow {
  return {
    id,
    summary: `Row ${id}`,
    riskCategory,
    status: "pending",
    envelopeId: `env_${id}`,
    expiresAt,
    bindingHash: `0x${id}`,
    createdAt,
  };
}

describe("sortApprovals (expiring-soonest)", () => {
  it("returns expiring-soonest first", () => {
    const a = row("a", "2026-05-13T01:00:00Z", "low");
    const b = row("b", "2026-05-13T00:30:00Z", "low");
    const c = row("c", "2026-05-13T02:00:00Z", "low");
    const sorted = sortApprovals([a, b, c]);
    expect(sorted.map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("ties on expiresAt break by createdAt ascending", () => {
    const a = row("a", "2026-05-13T01:00:00Z", "low", "2026-05-13T00:05:00Z");
    const b = row("b", "2026-05-13T01:00:00Z", "low", "2026-05-13T00:01:00Z");
    const sorted = sortApprovals([a, b]);
    expect(sorted.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("does not mutate input", () => {
    const input = [
      row("a", "2026-05-13T01:00:00Z", "low"),
      row("b", "2026-05-13T00:30:00Z", "low"),
    ];
    const before = input.map((r) => r.id);
    sortApprovals(input);
    expect(input.map((r) => r.id)).toEqual(before);
  });
});
