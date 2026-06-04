import { describe, it, expect, vi } from "vitest";
import {
  bucketContent,
  executeCreativeTasteSweep,
  CREATIVE_TASTE_SWEEP_FAILURE_PARAMS,
  CANDIDATE_FETCH_CAP,
} from "../services/cron/creative-taste-sweep.js";
import { CANONICAL_KEY_PATTERN, computeConfidenceScore } from "@switchboard/schemas";

vi.mock("inngest", () => ({
  Inngest: vi.fn().mockImplementation(() => ({ createFunction: vi.fn().mockReturnValue({}) })),
}));

const HOOKS = {
  hooks: [
    {
      angleRef: "0",
      text: "What if?",
      type: "question",
      platformScore: 9,
      rationale: "r",
    },
  ],
  topCombos: [{ angleRef: "0", hookRef: "0", score: 9 }],
};

function candidate(over: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    organizationId: "org-1",
    deploymentId: "dep-1",
    mode: "polished",
    stageOutputs: { hooks: HOOKS },
    reviewDecision: "kept",
    reviewDecidedAt: new Date("2026-06-03T10:00:00.000Z"),
    tasteCapturedAt: null,
    ...over,
  };
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    failure: {
      auditLedger: { record: vi.fn().mockResolvedValue({}) },
      operatorAlerter: { alert: vi.fn().mockResolvedValue(undefined) },
      inngest: { send: vi.fn().mockResolvedValue(undefined) },
    },
    jobStore: {
      listTasteCandidates: vi.fn().mockResolvedValue([candidate()]),
      setTasteCapturedAt: vi.fn().mockResolvedValue(undefined),
    },
    memoryStore: {
      findByCategoryAndCanonicalKey: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "mem-1", sourceCount: 1 }),
      incrementConfidence: vi.fn().mockResolvedValue({ id: "mem-1", sourceCount: 2 }),
      countByDeployment: vi.fn().mockResolvedValue(0),
      findEvictionCandidate: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

describe("bucketContent", () => {
  it("is a PURE function of the bucket (no per-job text)", () => {
    expect(bucketContent("kept", "polished", "question")).toBe(
      "Operator kept polished creatives with question-style hooks",
    );
    expect(bucketContent("passed", "ugc", "none")).toBe(
      "Operator passed ugc creatives with no leading hook",
    );
  });
});

describe("canonical key grammar", () => {
  it("every decision x mode x hook bucket matches CANONICAL_KEY_PATTERN", () => {
    for (const decision of ["kept", "passed"]) {
      for (const mode of ["polished", "ugc"]) {
        for (const hook of ["pattern_interrupt", "question", "bold_statement", "none"]) {
          expect(`taste:${decision}_${mode}_${hook}`).toMatch(CANONICAL_KEY_PATTERN);
        }
      }
    }
  });
});

describe("executeCreativeTasteSweep", () => {
  it("first observation creates the bucket at the standard curve with deterministic content", async () => {
    const d = deps();
    const out = await executeCreativeTasteSweep(d as never);

    expect(d.memoryStore.findByCategoryAndCanonicalKey).toHaveBeenCalledWith(
      "org-1",
      "dep-1",
      "taste",
      "taste:kept_polished_question",
    );
    expect(d.memoryStore.create).toHaveBeenCalledWith({
      organizationId: "org-1",
      deploymentId: "dep-1",
      category: "taste",
      canonicalKey: "taste:kept_polished_question",
      content: "Operator kept polished creatives with question-style hooks",
      confidence: computeConfidenceScore(1, false),
    });
    expect(out).toMatchObject({ candidates: 1, captured: 1, bucketsCreated: 1 });
  });

  it("repeat observation increments the bucket (standard curve over sourceCount + 1)", async () => {
    const d = deps({
      memoryStore: {
        ...deps().memoryStore,
        findByCategoryAndCanonicalKey: vi
          .fn()
          .mockResolvedValue([{ id: "mem-1", sourceCount: 2, confidence: 0.6 }]),
        create: vi.fn(),
        incrementConfidence: vi.fn().mockResolvedValue({ id: "mem-1", sourceCount: 3 }),
      },
    });
    const out = await executeCreativeTasteSweep(d as never);

    expect(d.memoryStore.incrementConfidence).toHaveBeenCalledWith(
      "org-1",
      "mem-1",
      computeConfidenceScore(3, false),
    );
    expect(d.memoryStore.create).not.toHaveBeenCalled();
    expect(out).toMatchObject({ bucketsIncremented: 1 });
  });

  it("defensively picks the highest-sourceCount row if a bucket ever splits", async () => {
    const d = deps({
      memoryStore: {
        ...deps().memoryStore,
        findByCategoryAndCanonicalKey: vi.fn().mockResolvedValue([
          { id: "mem-low", sourceCount: 1, confidence: 0.5 },
          { id: "mem-high", sourceCount: 4, confidence: 0.7 },
        ]),
        incrementConfidence: vi.fn().mockResolvedValue({ id: "mem-high", sourceCount: 5 }),
      },
    });
    await executeCreativeTasteSweep(d as never);

    expect(d.memoryStore.incrementConfidence).toHaveBeenCalledWith(
      "org-1",
      "mem-high",
      computeConfidenceScore(5, false),
    );
  });

  it("watermarks with the OBSERVED reviewDecidedAt, never wall-clock", async () => {
    const d = deps();
    await executeCreativeTasteSweep(d as never);

    expect(d.jobStore.setTasteCapturedAt).toHaveBeenCalledWith(
      "org-1",
      "job-1",
      new Date("2026-06-03T10:00:00.000Z"),
    );
  });

  it("a kept-then-passed re-decision lands in the PASSED bucket without retracting kept", async () => {
    const d = deps({
      jobStore: {
        listTasteCandidates: vi
          .fn()
          .mockResolvedValue([
            candidate({ reviewDecision: "passed", tasteCapturedAt: new Date("2026-06-01") }),
          ]),
        setTasteCapturedAt: vi.fn().mockResolvedValue(undefined),
      },
    });
    await executeCreativeTasteSweep(d as never);

    expect(d.memoryStore.findByCategoryAndCanonicalKey).toHaveBeenCalledWith(
      "org-1",
      "dep-1",
      "taste",
      "taste:passed_polished_question",
    );
    expect(d.memoryStore.delete).not.toHaveBeenCalled();
  });

  it("one bad job skips (per-job try/catch), the run continues, watermark NOT advanced for it", async () => {
    const memoryStore = deps().memoryStore;
    memoryStore.create = vi
      .fn()
      .mockRejectedValueOnce(new Error("db hiccup"))
      .mockResolvedValue({ id: "mem-2", sourceCount: 1 });
    const d = deps({
      jobStore: {
        listTasteCandidates: vi
          .fn()
          .mockResolvedValue([candidate({ id: "job-bad" }), candidate({ id: "job-good" })]),
        setTasteCapturedAt: vi.fn().mockResolvedValue(undefined),
      },
      memoryStore,
    });

    const out = await executeCreativeTasteSweep(d as never);

    expect(out).toMatchObject({ candidates: 2, captured: 1, skippedFailures: 1 });
    expect(d.jobStore.setTasteCapturedAt).toHaveBeenCalledTimes(1);
    expect(d.jobStore.setTasteCapturedAt).toHaveBeenCalledWith(
      "org-1",
      "job-good",
      expect.any(Date),
    );
  });

  it("P2002 on create (concurrent duplicate) re-finds the bucket and increments instead", async () => {
    const p2002 = Object.assign(new Error("unique violation"), { code: "P2002" });
    const memoryStore = deps().memoryStore;
    memoryStore.findByCategoryAndCanonicalKey = vi
      .fn()
      .mockResolvedValueOnce([]) // first look: no bucket
      .mockResolvedValueOnce([{ id: "mem-raced", sourceCount: 1, confidence: 0.5 }]); // re-find
    memoryStore.create = vi.fn().mockRejectedValue(p2002);
    memoryStore.incrementConfidence = vi
      .fn()
      .mockResolvedValue({ id: "mem-raced", sourceCount: 2 });
    const d = deps({ memoryStore });

    const out = await executeCreativeTasteSweep(d as never);

    expect(d.memoryStore.incrementConfidence).toHaveBeenCalledWith(
      "org-1",
      "mem-raced",
      computeConfidenceScore(2, false),
    );
    expect(out).toMatchObject({ captured: 1, bucketsIncremented: 1, bucketsCreated: 0 });
  });

  it("at the 500 cap: evicts only when the newcomer beats the candidate", async () => {
    const memoryStore = deps().memoryStore;
    memoryStore.countByDeployment = vi.fn().mockResolvedValue(500);
    memoryStore.findEvictionCandidate = vi
      .fn()
      .mockResolvedValue({ id: "weakest", confidence: 0.4 });
    const d = deps({ memoryStore });

    const out = await executeCreativeTasteSweep(d as never);

    expect(d.memoryStore.delete).toHaveBeenCalledWith("org-1", "weakest");
    expect(d.memoryStore.create).toHaveBeenCalled();
    expect(out).toMatchObject({ evictions: 1, bucketsCreated: 1 });
  });

  it("at the cap with a stronger candidate: drops the gesture's memory but still watermarks (observed)", async () => {
    const memoryStore = deps().memoryStore;
    memoryStore.countByDeployment = vi.fn().mockResolvedValue(500);
    memoryStore.findEvictionCandidate = vi
      .fn()
      .mockResolvedValue({ id: "strong", confidence: 0.9 });
    const d = deps({ memoryStore });

    const out = await executeCreativeTasteSweep(d as never);

    expect(d.memoryStore.delete).not.toHaveBeenCalled();
    expect(d.memoryStore.create).not.toHaveBeenCalled();
    expect(out).toMatchObject({ drops: 1, captured: 1 });
    expect(d.jobStore.setTasteCapturedAt).toHaveBeenCalled(); // gesture observed; memory full
  });

  it("locks the Class-E failure contract and the fetch cap", () => {
    expect(CREATIVE_TASTE_SWEEP_FAILURE_PARAMS).toEqual({
      functionId: "creative-taste-sweep",
      eventDomain: "creative.taste",
      riskCategory: "low",
      alert: false,
      emitEvent: false,
    });
    expect(CANDIDATE_FETCH_CAP).toBe(500);
  });

  it("empty candidate set is a graceful no-op", async () => {
    const d = deps({
      jobStore: {
        listTasteCandidates: vi.fn().mockResolvedValue([]),
        setTasteCapturedAt: vi.fn(),
      },
    });
    const out = await executeCreativeTasteSweep(d as never);
    expect(out).toMatchObject({ candidates: 0, captured: 0 });
    expect(d.memoryStore.create).not.toHaveBeenCalled();
  });
});
