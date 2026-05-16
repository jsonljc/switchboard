import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { auditSeedCounts, runMain, type SeedCountState } from "../check-seed-counts.js";

vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({
    organizationConfig: { count: vi.fn().mockResolvedValue(0) },
    agentRoster: { count: vi.fn().mockResolvedValue(0) },
    contact: { count: vi.fn().mockResolvedValue(0) },
    opportunity: { count: vi.fn().mockResolvedValue(0) },
    auditEntry: { count: vi.fn().mockResolvedValue(0) },
    approvalRecord: { count: vi.fn().mockResolvedValue(0) },
    scheduledTriggerRecord: { count: vi.fn().mockResolvedValue(0) },
    $disconnect: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe("auditSeedCounts state machine", () => {
  const originalUrl = process.env["DATABASE_URL"];
  afterEach(() => {
    if (originalUrl) process.env["DATABASE_URL"] = originalUrl;
    else delete process.env["DATABASE_URL"];
  });

  it("returns SKIP-NO-URL when DATABASE_URL is unset", async () => {
    delete process.env["DATABASE_URL"];
    const result = await auditSeedCounts();
    expect(result.state).toBe("SKIP-NO-URL" satisfies SeedCountState);
  });

  it("returns SKIP-UNREACHABLE when Prisma throws and propagates the error message", async () => {
    process.env["DATABASE_URL"] = "postgresql://localhost/none";
    const disconnect = vi.fn().mockResolvedValue(undefined);
    // Force the first .count() to throw; the result depends only on hitting the catch.
    vi.mocked(PrismaClient).mockImplementationOnce(
      () =>
        ({
          organizationConfig: { count: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) },
          agentRoster: { count: vi.fn().mockResolvedValue(0) },
          contact: { count: vi.fn().mockResolvedValue(0) },
          opportunity: { count: vi.fn().mockResolvedValue(0) },
          auditEntry: { count: vi.fn().mockResolvedValue(0) },
          approvalRecord: { count: vi.fn().mockResolvedValue(0) },
          scheduledTriggerRecord: { count: vi.fn().mockResolvedValue(0) },
          $disconnect: disconnect,
        }) as unknown as InstanceType<typeof PrismaClient>,
    );
    const result = await auditSeedCounts();
    expect(result.state).toBe("SKIP-UNREACHABLE" satisfies SeedCountState);
    expect(result.unreachableReason).toContain("ECONNREFUSED");
  });
});

describe("runMain exit codes", () => {
  const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`exit:${code ?? 0}`);
  });
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

  beforeEach(() => {
    exitSpy.mockClear();
    stderrSpy.mockClear();
    stdoutSpy.mockClear();
  });

  it("exits 0 on SKIP without --strict-db", async () => {
    delete process.env["DATABASE_URL"];
    await expect(runMain({ strictDb: false })).rejects.toThrow("exit:0");
  });

  it("exits 1 on SKIP with --strict-db and prints recovery hint", async () => {
    delete process.env["DATABASE_URL"];
    await expect(runMain({ strictDb: true })).rejects.toThrow("exit:1");
    const combined = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(combined).toMatch(/DATABASE_URL missing or DB unreachable/);
    expect(combined).toMatch(/pnpm local:setup/);
    expect(combined).toMatch(/pnpm db:migrate && pnpm db:seed/);
  });

  it("exits 0 on PASS", async () => {
    process.env["DATABASE_URL"] = "postgresql://localhost/none";
    const auditMock = vi.fn().mockResolvedValue({
      state: "PASS",
      counts: {
        org: 1,
        agents: 7,
        contacts: 8,
        opportunities: 8,
        auditEntries: 17,
        approvalRecords: 2,
        scheduledTriggers: 2,
      },
      unmet: [],
    });
    await expect(runMain({ strictDb: false, _auditFn: auditMock })).rejects.toThrow("exit:0");
  });

  it("exits 1 on FAIL with --strict-db unaffected", async () => {
    process.env["DATABASE_URL"] = "postgresql://localhost/none";
    const auditMock = vi.fn().mockResolvedValue({
      state: "FAIL",
      counts: {
        org: 1,
        agents: 0,
        contacts: 0,
        opportunities: 0,
        auditEntries: 0,
        approvalRecords: 0,
        scheduledTriggers: 0,
      },
      unmet: [{ key: "agents", expected: 2, actual: 0 }],
    });
    await expect(runMain({ strictDb: false, _auditFn: auditMock })).rejects.toThrow("exit:1");
    await expect(runMain({ strictDb: true, _auditFn: auditMock })).rejects.toThrow("exit:1");
  });
});
