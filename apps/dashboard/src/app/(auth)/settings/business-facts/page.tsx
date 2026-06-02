"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { BusinessFactsForm } from "@/components/settings/business-facts/business-facts-form";
import {
  emptyBusinessFacts,
  type BusinessFactsForm as BusinessFactsFormValues,
} from "@/components/settings/business-facts/scaffold";
import { useOrgDeploymentId } from "@/hooks/use-deployments";
import {
  useBusinessFacts,
  useUpsertBusinessFacts,
  BusinessFactsValidationError,
} from "@/hooks/use-business-facts";
import type { BusinessFacts } from "@switchboard/schemas";

export default function BusinessFactsPage() {
  const { deploymentId, isLoading: depLoading } = useOrgDeploymentId();
  const facts = useBusinessFacts(deploymentId);
  const upsert = useUpsertBusinessFacts(deploymentId);
  const { toast } = useToast();

  // Loading: deployment resolving OR (deployment present but facts not yet settled).
  // Gate facts loading on !data && !error (not isLoading — a disabled query is pending+idle).
  // When deploymentId is null and not loading, skip facts loading check (no fetch was issued).
  const factsSettled = !!facts.data || !!facts.error;
  if (depLoading || (deploymentId !== null && !factsSettled)) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-64" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  // Zero-deployment: org has no deployed agent yet
  if (!depLoading && deploymentId === null) {
    return (
      <div className="space-y-6">
        <section>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Business facts</h1>
          <p className="text-[15px] text-muted-foreground mt-1">
            Tell your agent about your business so it can answer customers accurately.
          </p>
        </section>
        <div className="rounded-lg border border-border bg-surface p-6 text-center space-y-2">
          <p className="font-medium text-foreground">Deploy an agent first</p>
          <p className="text-[14px] text-muted-foreground">
            Business facts attach to an agent deployment. Set up your agent to get started.
          </p>
        </div>
      </div>
    );
  }

  // Error fetching facts
  if (facts.error) {
    return (
      <div className="space-y-6">
        <section>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Business facts</h1>
          <p className="text-[15px] text-muted-foreground mt-1">
            Tell your agent about your business so it can answer customers accurately.
          </p>
        </section>
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Failed to load business facts. Please refresh and try again.
        </div>
      </div>
    );
  }

  const status = facts.data!.status;
  const saved = facts.data!.facts;

  const base = emptyBusinessFacts();
  const defaultValues: BusinessFactsFormValues =
    status === "present" && saved
      ? ({
          ...base,
          ...saved,
          openingHours: { ...base.openingHours, ...saved.openingHours },
          bookingPolicies: { ...base.bookingPolicies, ...saved.bookingPolicies },
        } as BusinessFactsFormValues)
      : base;

  const handleSubmit = (payload: BusinessFacts) => {
    upsert.mutate(payload, {
      onSuccess: () => toast({ title: "Business facts saved" }),
      onError: (e) =>
        toast({
          variant: "destructive",
          title: "Couldn't save",
          description:
            e instanceof BusinessFactsValidationError
              ? "Some fields are invalid — please review and try again."
              : "Something went wrong saving your facts.",
        }),
    });
  };

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Business facts</h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          Tell your agent about your business so it can answer customers accurately.
        </p>
      </section>

      <BusinessFactsForm
        defaultValues={defaultValues}
        malformed={status === "malformed"}
        isSaving={upsert.isPending}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
