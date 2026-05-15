import type { LegacyKpiInput } from "./legacy-shapes";

interface MetricsViewModelLike {
  hero: { value: number };
  targets: { avgValueCents: number | null; targetCpbCents: number | null };
  spendCents: number | null;
  leads: number;
  qualifiedPct: number;
  bookedDelta: string | null;
  leadsDelta: string | null;
  qualifiedDelta: string | null;
}

function centsToDollars(cents: number | null): number | null {
  return cents === null ? null : Math.round(cents / 100);
}

export function metricsViewModelToLegacyKpiInput(vm: MetricsViewModelLike): LegacyKpiInput {
  return {
    booked: vm.hero.value,
    bookedDelta: vm.bookedDelta,
    leads: vm.leads,
    leadsDelta: vm.leadsDelta,
    qualifiedPct: vm.qualifiedPct,
    qualifiedDelta: vm.qualifiedDelta,
    spend: centsToDollars(vm.spendCents),
    avgValue: centsToDollars(vm.targets.avgValueCents),
    target: centsToDollars(vm.targets.targetCpbCents),
  };
}
