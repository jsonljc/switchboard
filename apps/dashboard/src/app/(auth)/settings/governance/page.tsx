"use client";

import { PageTitle } from "@/components/layout/page-title";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { GovernanceGates, type GateCardModel } from "@/components/settings/governance-gates";
import { GovernanceMarket } from "@/components/settings/governance-market";
import {
  useGovernanceObserveReview,
  useGovernanceEnforceReadiness,
  useGovernanceMarket,
  useSetGovernanceGateMode,
  useSetGovernanceMarket,
} from "@/hooks/use-governance-gates";
import type {
  GovernanceGateUnit,
  GovernanceMode,
  Jurisdiction,
  ClinicType,
} from "@switchboard/schemas";

const ZERO_REVIEW = {
  wouldBlock: 0,
  wouldRewrite: 0,
  wouldEscalate: 0,
  wouldTemplate: 0,
  total: 0,
};

export default function GovernancePage() {
  const review = useGovernanceObserveReview("alex");
  const readiness = useGovernanceEnforceReadiness("alex");
  const market = useGovernanceMarket("alex");
  const setMode = useSetGovernanceGateMode("alex");
  const setMarket = useSetGovernanceMarket("alex");
  const { toast } = useToast();

  // Gate loading on !data && !error (a disabled/in-flight query is pending+idle, not isLoading).
  const reviewSettled = !!review.data || !!review.error;
  const readinessSettled = !!readiness.data || !!readiness.error;
  const marketSettled = !!market.data || !!market.error;
  if (!reviewSettled || !readinessSettled || !marketSettled) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (!readiness.data) {
    return (
      <div className="space-y-6">
        <PageTitle eyebrow="Compliance" sub="Per-gate enforcement for Alex.">
          Governance gates
        </PageTitle>
        <div className="rounded-lg border border-border bg-surface p-6 text-center space-y-2">
          <p className="font-medium text-foreground">Couldn&apos;t load governance gates</p>
          <p className="text-[14px] text-muted-foreground">
            Reload the page, or contact support if this persists.
          </p>
        </div>
      </div>
    );
  }

  const reviewUnits = review.data?.units;
  const gates: GateCardModel[] = readiness.data.units.map((u) => ({
    unit: u.unit,
    currentMode: u.currentMode,
    ready: u.ready,
    blockingReason: u.blockingReason,
    producer: u.producer,
    review: reviewUnits?.[u.unit] ?? ZERO_REVIEW,
  }));

  const pendingUnit: GovernanceGateUnit | null = setMode.isPending
    ? (setMode.variables?.unit ?? null)
    : null;

  function onFlip(unit: GovernanceGateUnit, mode: GovernanceMode) {
    setMode.mutate(
      { unit, mode },
      {
        onSuccess: () => toast({ title: `Gate set to ${mode}` }),
        onError: (e) =>
          toast({
            title: "Couldn't update gate",
            description: e instanceof Error ? e.message : undefined,
          }),
      },
    );
  }

  function onSaveMarket(jurisdiction: Jurisdiction, clinicType: ClinicType) {
    setMarket.mutate(
      { jurisdiction, clinicType },
      {
        onSuccess: () => toast({ title: `Market set to ${jurisdiction} / ${clinicType}` }),
        onError: (e) =>
          toast({
            title: "Couldn't update market",
            description: e instanceof Error ? e.message : undefined,
          }),
      },
    );
  }

  return (
    <div className="space-y-6">
      <PageTitle
        eyebrow="Compliance"
        sub="Review what each safety gate would do, then enforce it once its inputs are ready. Observe is the safe default; enforce is reversible."
      >
        Governance gates
      </PageTitle>
      <GovernanceMarket
        current={market.data ?? { jurisdiction: null, clinicType: null }}
        pending={setMarket.isPending}
        onSave={onSaveMarket}
      />
      <GovernanceGates gates={gates} pendingUnit={pendingUnit} onFlip={onFlip} />
    </div>
  );
}
