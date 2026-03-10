"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { useToast } from "@/components/ui/use-toast";
import { SpendLimitsForm } from "@/components/settings/spend-limits-form";
import { ForbiddenList } from "@/components/settings/forbidden-list";
import { GovernanceMode } from "@/components/settings/governance-mode";
import { Skeleton } from "@/components/ui/skeleton";
import { useIdentity, useUpdateIdentity } from "@/hooks/use-identity";

export default function BoundariesPage() {
  const { status } = useSession();
  const { data, isLoading } = useIdentity();
  const updateIdentity = useUpdateIdentity();
  const { toast } = useToast();

  if (status === "unauthenticated") redirect("/login");

  const spec = data?.spec;

  const handleSave = (field: string, value: unknown) => {
    if (!spec) return;
    updateIdentity.mutate(
      { id: spec.id, [field]: value },
      {
        onSuccess: () =>
          toast({
            title: "Saved",
            description: "Your boundaries were updated.",
          }),
        onError: (err) =>
          toast({
            title: "Update failed",
            description: err.message,
            variant: "destructive",
          }),
      },
    );
  };

  if (status === "loading" || isLoading || !spec) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Boundaries</h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          Decide what your operator can do alone and what always comes back to you.
        </p>
      </section>

      <GovernanceMode
        currentMode={spec.governanceProfile ?? "guarded"}
        onSave={(mode) => handleSave("governanceProfile", mode)}
        isLoading={updateIdentity.isPending}
      />

      <SpendLimitsForm
        defaultValues={spec.globalSpendLimits}
        onSubmit={(values) => handleSave("globalSpendLimits", values)}
        isLoading={updateIdentity.isPending}
      />

      <ForbiddenList
        currentForbidden={spec.forbiddenBehaviors}
        onSave={(values) => handleSave("forbiddenBehaviors", values)}
        isLoading={updateIdentity.isPending}
      />
    </div>
  );
}
