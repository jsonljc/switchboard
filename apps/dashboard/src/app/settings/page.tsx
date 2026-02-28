"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { SpendLimitsForm } from "@/components/settings/spend-limits-form";
import { RiskToleranceSettings } from "@/components/settings/risk-tolerance";
import { ForbiddenList } from "@/components/settings/forbidden-list";
import { GovernanceMode } from "@/components/settings/governance-mode";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useIdentity, useUpdateIdentity } from "@/hooks/use-identity";
import { useToast } from "@/components/ui/use-toast";
import { Server, AlertTriangle } from "lucide-react";

export default function SettingsPage() {
  const { status } = useSession();
  const { data, isLoading, isError, error, refetch } = useIdentity();
  const updateIdentity = useUpdateIdentity();
  const { toast } = useToast();

  if (status === "unauthenticated") redirect("/login");

  const spec = data?.spec;

  const handleSave = (field: string, value: unknown) => {
    if (!spec) return;
    updateIdentity.mutate(
      { id: spec.id, [field]: value },
      {
        onSuccess: () => toast({ title: "Settings saved", description: `${field} updated successfully.` }),
        onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
      }
    );
  };

  if (isError) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Settings</h1>
        <Card className="border-destructive">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-destructive mb-2">
              <AlertTriangle className="h-4 w-4" />
              <span className="font-medium">Failed to load settings</span>
            </div>
            <p className="text-sm text-muted-foreground mb-4">{(error as Error)?.message}</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Settings</h1>
        <Link href="/settings/system">
          <Button variant="outline" size="sm" className="gap-2">
            <Server className="h-4 w-4" />
            System Health
          </Button>
        </Link>
      </div>

      {spec && (
        <>
          <SpendLimitsForm
            defaultValues={spec.globalSpendLimits}
            onSubmit={(values) => handleSave("globalSpendLimits", values)}
            isLoading={updateIdentity.isPending}
          />

          <RiskToleranceSettings
            currentValues={spec.riskTolerance}
            onSave={(values) => handleSave("riskTolerance", values)}
            isLoading={updateIdentity.isPending}
          />

          <ForbiddenList
            currentForbidden={spec.forbiddenBehaviors}
            onSave={(values) => handleSave("forbiddenBehaviors", values)}
            isLoading={updateIdentity.isPending}
          />

          <GovernanceMode
            currentMode={spec.governanceProfile ?? "guarded"}
            onSave={(mode) => handleSave("governanceProfile", mode)}
            isLoading={updateIdentity.isPending}
          />
        </>
      )}

      {!spec && !isLoading && (
        <div className="text-center py-12 text-muted-foreground">
          <p>No identity spec found. Complete onboarding first.</p>
        </div>
      )}
    </div>
  );
}
