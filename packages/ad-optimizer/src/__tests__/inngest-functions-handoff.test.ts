// Verifies executeWeeklyAudit threads the bootstrap-injected handoff submitter into
// the AuditRunner. AuditRunner is mocked so we capture its constructor deps directly
// (the existing inngest-functions.test.ts uses the real runner and cannot mock it).
import { describe, it, expect, vi, beforeEach } from "vitest";

const { auditRunnerCtor } = vi.hoisted(() => ({ auditRunnerCtor: vi.fn() }));

vi.mock("../audit-runner.js", () => ({
  AuditRunner: class {
    constructor(deps: unknown) {
      auditRunnerCtor(deps);
    }
    run = vi.fn().mockResolvedValue({ recommendations: [] });
  },
}));
vi.mock("inngest", () => ({
  Inngest: vi.fn().mockImplementation(() => ({ createFunction: vi.fn() })),
}));

import { executeWeeklyAudit, type CronDependencies } from "../inngest-functions.js";
import type { RecommendationHandoffSubmitter } from "../recommendation-handoff-dispatch.js";

function makeStep() {
  return { run: vi.fn((_name: string, fn: () => unknown) => fn()) };
}

function makeDeps(extra: Partial<CronDependencies> = {}): CronDependencies {
  return {
    listActiveDeployments: vi
      .fn()
      .mockResolvedValue([{ id: "dep-1", organizationId: "org-1", inputConfig: {} }]),
    getDeploymentCredentials: vi.fn().mockResolvedValue({ accessToken: "t", accountId: "a" }),
    createAdsClient: vi.fn().mockReturnValue({}),
    createCrmProvider: vi.fn().mockReturnValue({}),
    createInsightsProvider: vi.fn().mockReturnValue({}),
    saveAuditReport: vi.fn().mockResolvedValue(undefined),
    ...extra,
  };
}

describe("executeWeeklyAudit — Riley -> agent handoff threading", () => {
  beforeEach(() => {
    auditRunnerCtor.mockClear();
  });

  it("threads recommendationHandoffSubmitter into the AuditRunner when configured", async () => {
    const submitter: RecommendationHandoffSubmitter = vi.fn(async () => {});
    const deps = makeDeps({
      recommendationEmitter: vi.fn().mockResolvedValue({ surface: "queue", id: "r1" }),
      recommendationHandoffSubmitter: submitter,
    });
    await executeWeeklyAudit(makeStep() as never, deps);
    expect(auditRunnerCtor).toHaveBeenCalledTimes(1);
    expect(auditRunnerCtor.mock.calls[0]![0].recommendationHandoffSubmitter).toBe(submitter);
  });

  it("omits the submitter from the AuditRunner when not configured (back-compat)", async () => {
    await executeWeeklyAudit(makeStep() as never, makeDeps());
    expect(auditRunnerCtor.mock.calls[0]![0].recommendationHandoffSubmitter).toBeUndefined();
  });
});
