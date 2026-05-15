// Pure (apps-agnostic) Inngest function for daily pattern decay. Lives in
// packages/core because the decay policy is domain logic; the Prisma store
// is INJECTED at the apps/api bootstrap boundary so this file does not
// cross the schemas → core → db dependency layer (Layer 3 → Layer 4 is
// forbidden — see CLAUDE.md "Dependency Layers").
import type { Counter } from "../telemetry/metrics.js";

export interface PatternDecayMemoryStore {
  decayStale(input: {
    cutoffDate: Date;
    decayAmount: number;
    floor: number;
    startOfDay: Date;
  }): Promise<number>;
}

export interface PatternDecayDependencies {
  memoryStore: PatternDecayMemoryStore;
  now: () => Date;
  windowDays: number;
  decayAmount: number;
  floor: number;
  metrics: { outcomePatternsDecayed: Counter };
}

export interface StepTools {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfUtcDay(d: Date): Date {
  const copy = new Date(d);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

export async function executeDailyPatternDecay(
  step: StepTools,
  deps: PatternDecayDependencies,
): Promise<void> {
  const now = deps.now();
  const startOfDay = startOfUtcDay(now);
  const cutoffDate = new Date(now.getTime() - deps.windowDays * MS_PER_DAY);

  const decayedCount = await step.run("decay-stale-patterns", () =>
    deps.memoryStore.decayStale({
      cutoffDate,
      decayAmount: deps.decayAmount,
      floor: deps.floor,
      startOfDay,
    }),
  );

  // decayStale returns a single scalar (Prisma updateMany count), so the
  // counter emits aggregate labels rather than splitting by tier/category.
  // Spec only forbids deploymentId on this counter; aggregate/all honors it.
  deps.metrics.outcomePatternsDecayed.inc(
    { deploymentTier: "aggregate", canonicalCategory: "all" },
    decayedCount,
  );
}
