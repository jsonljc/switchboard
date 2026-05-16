import { describe, it, expect } from "vitest";
import { buildAlexMissionResponse } from "../mission.js";

/**
 * CI guard: the rendered mission response for an Alex roster must not
 * contain any of the legacy "tours pipeline" framings or the leaked
 * tenant brand "HotPod". Asserting against the rendered response (not
 * the raw constants) catches future drift if ALEX_ROLE / ALEX_PIPELINE
 * are ever moved to config or templated.
 *
 * Companion test: apps/dashboard/src/__tests__/cockpit-copy-hygiene.test.ts.
 */

const BANNED = ["HotPod", "Tours pipeline", "book tours", "tour value", "tour calendar"] as const;

function collectStrings(value: unknown, acc: string[] = []): string[] {
  if (typeof value === "string") {
    acc.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, acc);
  } else if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value)) {
      collectStrings((value as Record<string, unknown>)[key], acc);
    }
  }
  return acc;
}

describe("mission copy hygiene", () => {
  it("buildAlexMissionResponse output contains no banned legacy/tenant phrases", () => {
    const out = buildAlexMissionResponse({
      roster: {
        id: "ros-1",
        organizationId: "org-1",
        agentRole: "responder",
        displayName: "Alex",
        description: "",
        status: "active",
        tier: "starter",
        config: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      org: { id: "org-1", name: "Acme Medspa" },
      connections: [],
      managedChannels: [],
    });

    const allStrings = collectStrings(out);
    const offenders: Array<{ phrase: string; value: string }> = [];
    for (const phrase of BANNED) {
      const lc = phrase.toLowerCase();
      for (const s of allStrings) {
        if (s.toLowerCase().includes(lc)) {
          offenders.push({ phrase, value: s });
        }
      }
    }

    if (offenders.length > 0) {
      const formatted = offenders.map((o) => `  "${o.phrase}" in: ${o.value}`).join("\n");
      throw new Error(
        `Found ${offenders.length} banned phrase(s) in buildAlexMissionResponse output. ` +
          `Offenders:\n${formatted}`,
      );
    }
    expect(offenders).toEqual([]);
  });
});
