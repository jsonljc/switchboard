import { describe, it, expect } from "vitest";
import { probeServices, type ProbeDeps, type ProbeTarget } from "../dev-ready.js";

const TARGETS: ProbeTarget[] = [
  { port: 3000, path: "/health" },
  { port: 3001, path: "/health" },
  { port: 3002, path: "/api/dashboard/health" },
];

function makeFakeDeps(overrides: Partial<ProbeDeps> = {}): {
  deps: ProbeDeps;
  logs: string[];
  errs: string[];
  clock: { value: number };
} {
  const logs: string[] = [];
  const errs: string[] = [];
  const clock = { value: 0 };
  const deps: ProbeDeps = {
    fetchImpl: async () => ({ ok: true }),
    intervalMs: 100,
    timeoutMs: 1_000,
    fetchTimeoutMs: 100,
    log: (m) => logs.push(m),
    errLog: (m) => errs.push(m),
    now: () => clock.value,
    sleep: async (ms: number) => {
      clock.value += ms;
    },
    ...overrides,
  };
  return { deps, logs, errs, clock };
}

describe("probeServices", () => {
  it("reports all ports ready when fetch succeeds on the first cycle", async () => {
    const { deps, logs, errs } = makeFakeDeps();
    const result = await probeServices(TARGETS, deps);
    expect(result.allReady).toBe(true);
    expect([...result.readyPorts].sort()).toEqual([3000, 3001, 3002]);
    expect(result.timedOutPorts).toEqual([]);
    expect(logs).toEqual(
      expect.arrayContaining([":3000 ready", ":3001 ready", ":3002 ready", "All services ready ✓"]),
    );
    expect(errs).toEqual([]);
  });

  it("times out and prints a recovery hint per unready port when nothing responds", async () => {
    const { deps, logs, errs } = makeFakeDeps({
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    const result = await probeServices(TARGETS, deps);
    expect(result.allReady).toBe(false);
    expect(result.readyPorts).toEqual([]);
    expect([...result.timedOutPorts].sort()).toEqual([3000, 3001, 3002]);
    expect(logs).not.toContain("All services ready ✓");
    expect(errs).toContain("Timed out waiting for :3000 — is `pnpm dev` running?");
    expect(errs).toContain("Timed out waiting for :3001 — is `pnpm dev` running?");
    expect(errs).toContain("Timed out waiting for :3002 — is `pnpm dev` running?");
  });

  it("reports timeout only for unready ports when some succeed", async () => {
    const { deps, logs, errs } = makeFakeDeps({
      fetchImpl: async (url: string) => {
        if (url.includes(":3000")) return { ok: true };
        throw new Error("ECONNREFUSED");
      },
    });
    const result = await probeServices(TARGETS, deps);
    expect(result.allReady).toBe(false);
    expect(result.readyPorts).toEqual([3000]);
    expect([...result.timedOutPorts].sort()).toEqual([3001, 3002]);
    expect(logs).toContain(":3000 ready");
    expect(logs).not.toContain("All services ready ✓");
    expect(errs).toContain("Timed out waiting for :3001 — is `pnpm dev` running?");
    expect(errs).toContain("Timed out waiting for :3002 — is `pnpm dev` running?");
  });

  it("treats a non-2xx response as not-ready and continues polling until success", async () => {
    let cycle = 0;
    const { deps, logs } = makeFakeDeps({
      intervalMs: 50,
      timeoutMs: 5_000,
      fetchImpl: async () => {
        // First two cycles return ok:false (e.g. 503 during boot); third returns ok:true.
        cycle++;
        return { ok: cycle > 6 };
      },
    });
    const result = await probeServices(TARGETS, deps);
    expect(result.allReady).toBe(true);
    expect(logs).toContain("All services ready ✓");
  });
});
