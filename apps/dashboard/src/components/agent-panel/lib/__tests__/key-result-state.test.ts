import { describe, expect, it } from "vitest";
import {
  selectKeyResult,
  coreSetupIncomplete,
} from "@/components/agent-panel/lib/key-result-state";
import type { MissionAggregatorResponse } from "@/lib/cockpit/mission-types";

const vm = (over = {}) =>
  ({
    hero: { kind: "ad-leads", value: 32, comparator: {} },
    spendCents: 142000,
    targets: { targetCpbCents: 3500, avgValueCents: 38000 },
    roi: {
      degraded: true,
      degradedHint: "",
      label: "cost per booked",
      comparator: { value: "$44 per booked", target: "target $35" },
    },
    ...over,
  }) as any;
const slot = (data: any, isError = false) => ({ data, isError });

describe("coreSetupIncomplete", () => {
  it("true when the primary setup row is not done", () => {
    const m = {
      setup: [
        { key: "meta", done: false, primary: true },
        { key: "rules", done: true },
      ],
    } as unknown as MissionAggregatorResponse;
    expect(coreSetupIncomplete(m, "riley")).toBe(true);
  });
  it("false when primary is done even if a non-core row is incomplete", () => {
    const m = {
      setup: [
        { key: "meta", done: true, primary: true },
        { key: "rules", done: false },
      ],
    } as unknown as MissionAggregatorResponse;
    expect(coreSetupIncomplete(m, "riley")).toBe(false);
  });
  it("falls back to the agent's core key when no row is flagged primary", () => {
    const m = {
      setup: [
        { key: "meta", done: false },
        { key: "rules", done: true },
      ],
    } as unknown as MissionAggregatorResponse;
    expect(coreSetupIncomplete(m, "riley")).toBe(true); // riley core = meta
  });
});

describe("selectKeyResult", () => {
  it("paused with no data → all-null graceful shape (no fabricated values)", () => {
    const r = selectKeyResult({
      agentKey: "alex",
      halted: true,
      mission: undefined,
      all: slot(undefined),
      week: slot(undefined),
    });
    expect(r.kind).toBe("paused");
    if (r.kind === "paused") {
      expect(r.hero).toBeNull();
      expect(r.scope).toBeNull();
      expect(r.spendCents).toBeNull();
      expect(r.targets).toBeNull();
    }
  });
  it("paused wins — returns paused with whatever real figure is available (never fabricated 0)", () => {
    const r = selectKeyResult({
      agentKey: "alex",
      halted: true,
      mission: undefined,
      all: slot(vm()),
      week: slot(vm()),
    });
    expect(r.kind).toBe("paused");
    if (r.kind === "paused") expect(r.hero?.value).toBe(32);
  });
  it("core setup incomplete (not paused) → activation", () => {
    const m = { setup: [{ key: "meta", done: false, primary: true }] } as any;
    const r = selectKeyResult({
      agentKey: "riley",
      halted: false,
      mission: m,
      all: slot(undefined),
      week: slot(undefined),
    });
    expect(r.kind).toBe("activation");
  });
  it("window=all present → lifetime scope", () => {
    const r = selectKeyResult({
      agentKey: "riley",
      halted: false,
      mission: undefined,
      all: slot(vm({ hero: { kind: "ad-leads", value: 214, comparator: {} } })),
      week: slot(vm()),
    });
    expect(r.kind === "proof" && r.scope).toBe("lifetime");
    if (r.kind === "proof") expect(r.hero.value).toBe(214);
  });
  it("window=all 400/absent → week scope (week label), NOT error", () => {
    const r = selectKeyResult({
      agentKey: "riley",
      halted: false,
      mission: undefined,
      all: slot(undefined, true),
      week: slot(vm()),
    });
    expect(r.kind === "proof" && r.scope).toBe("week");
  });
  it("week ALSO fails → error (week failure is the hero error)", () => {
    const r = selectKeyResult({
      agentKey: "riley",
      halted: false,
      mission: undefined,
      all: slot(undefined, true),
      week: slot(undefined, true),
    });
    expect(r.kind).toBe("error");
  });
  it("true zero is preserved as proof, not error", () => {
    const r = selectKeyResult({
      agentKey: "alex",
      halted: false,
      mission: undefined,
      all: slot(undefined),
      week: slot(vm({ hero: { kind: "tours-booked", value: 0, comparator: {} } })),
    });
    expect(r.kind === "proof" && r.hero.value).toBe(0);
  });

  it("threads roi into proof state (lifetime)", () => {
    const r = selectKeyResult({
      agentKey: "riley",
      halted: false,
      mission: undefined,
      all: slot(vm()),
      week: slot(vm()),
    });
    expect(r.kind === "proof" && r.roi?.comparator).toEqual({
      value: "$44 per booked",
      target: "target $35",
    });
  });

  it("threads roi into paused state", () => {
    const r = selectKeyResult({
      agentKey: "riley",
      halted: true,
      mission: undefined,
      all: slot(vm()),
      week: slot(vm()),
    });
    expect(r.kind === "paused" && r.roi?.label).toBe("cost per booked");
  });
});
