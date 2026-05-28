import type { MissionAggregatorResponse } from "@/lib/cockpit/mission-types";
import type { MetricsViewModelWire } from "@/lib/cockpit/metrics-types";

const CORE_KEY: Record<"alex" | "riley", string> = { alex: "inbox", riley: "meta" };

export function coreSetupIncomplete(
  mission: MissionAggregatorResponse | undefined,
  agentKey: "alex" | "riley",
): boolean {
  if (!mission) return false; // unknown setup ≠ blocked; metrics/zero rules handle it
  const primary = mission.setup.find((s) => s.primary);
  if (primary) return !primary.done;
  const core = mission.setup.find((s) => s.key === CORE_KEY[agentKey]);
  return core ? !core.done : false;
}

type Slot = { data?: MetricsViewModelWire; isError: boolean };

export type KeyResultState =
  | {
      kind: "paused";
      hero: MetricsViewModelWire["hero"] | null;
      spendCents: number | null;
      targets: MetricsViewModelWire["targets"] | null;
      scope: "lifetime" | "week" | null;
    }
  | { kind: "activation" }
  | { kind: "error" }
  | {
      kind: "proof";
      scope: "lifetime" | "week";
      hero: MetricsViewModelWire["hero"];
      spendCents: number | null;
      targets: MetricsViewModelWire["targets"];
    };

export function selectKeyResult(input: {
  agentKey: "alex" | "riley";
  halted: boolean;
  mission: MissionAggregatorResponse | undefined;
  all: Slot;
  week: Slot;
}): KeyResultState {
  const { agentKey, halted, mission, all, week } = input;
  const pick = all.data ?? week.data ?? null;
  if (halted) {
    return {
      kind: "paused",
      hero: pick?.hero ?? null,
      spendCents: pick?.spendCents ?? null,
      targets: pick?.targets ?? null,
      scope: all.data ? "lifetime" : week.data ? "week" : null,
    };
  }
  if (coreSetupIncomplete(mission, agentKey)) return { kind: "activation" };
  if (all.data)
    return {
      kind: "proof",
      scope: "lifetime",
      hero: all.data.hero,
      spendCents: all.data.spendCents,
      targets: all.data.targets,
    };
  if (week.data)
    return {
      kind: "proof",
      scope: "week",
      hero: week.data.hero,
      spendCents: week.data.spendCents,
      targets: week.data.targets,
    };
  return { kind: "error" };
}
