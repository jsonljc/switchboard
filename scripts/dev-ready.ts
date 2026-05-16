#!/usr/bin/env tsx
/**
 * Polls local dev services until ready, or times out.
 *
 * Targets: :3000/health (api), :3001/health (chat),
 *          :3002/api/dashboard/health (dashboard).
 *
 * Polls each at 500ms intervals. Prints `:PORT ready` per-port as each
 * becomes responsive and `All services ready ✓` once all three respond.
 * On 90s timeout, prints a recovery hint per still-unready port and
 * exits non-zero.
 *
 * Designed as an optional companion to `pnpm dev` in a second terminal pane.
 */

export interface ProbeTarget {
  port: number;
  path: string;
}

export interface ProbeDeps {
  fetchImpl: (url: string, signal: AbortSignal) => Promise<{ ok: boolean }>;
  intervalMs: number;
  timeoutMs: number;
  fetchTimeoutMs: number;
  log: (msg: string) => void;
  errLog: (msg: string) => void;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export interface ProbeResult {
  allReady: boolean;
  readyPorts: number[];
  timedOutPorts: number[];
}

export const DEFAULT_TARGETS: ProbeTarget[] = [
  { port: 3000, path: "/health" },
  { port: 3001, path: "/health" },
  { port: 3002, path: "/api/dashboard/health" },
];

export async function probeServices(
  targets: ProbeTarget[],
  deps: ProbeDeps,
): Promise<ProbeResult> {
  const start = deps.now();
  const ready = new Set<number>();

  while (deps.now() - start < deps.timeoutMs) {
    const unready = targets.filter((t) => !ready.has(t.port));
    await Promise.all(
      unready.map(async (t) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), deps.fetchTimeoutMs);
        try {
          const res = await deps.fetchImpl(
            `http://localhost:${t.port}${t.path}`,
            controller.signal,
          );
          if (res.ok && !ready.has(t.port)) {
            ready.add(t.port);
            deps.log(`:${t.port} ready`);
          }
        } catch {
          // Connection refused, aborted, or other transient error — keep polling.
        } finally {
          clearTimeout(timer);
        }
      }),
    );
    if (ready.size === targets.length) {
      deps.log("All services ready ✓");
      return {
        allReady: true,
        readyPorts: [...ready],
        timedOutPorts: [],
      };
    }
    await deps.sleep(deps.intervalMs);
  }

  const timedOut = targets.filter((t) => !ready.has(t.port)).map((t) => t.port);
  for (const port of timedOut) {
    deps.errLog(`Timed out waiting for :${port} — is \`pnpm dev\` running?`);
  }
  return {
    allReady: false,
    readyPorts: [...ready],
    timedOutPorts: timedOut,
  };
}
