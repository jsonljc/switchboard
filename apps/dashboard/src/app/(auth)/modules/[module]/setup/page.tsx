"use client";

import { useParams, useSearchParams } from "next/navigation";
import { notFound } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { MODULE_IDS, MODULE_LABELS, SLUG_TO_MODULE } from "@/lib/module-types";
import type { ModuleId } from "@/lib/module-types";
import { ModuleSetupWizard } from "@/components/modules/module-setup-wizard";

export default function ModuleSetupPage() {
  const params = useParams<{ module: string }>();
  const searchParams = useSearchParams();
  const moduleSlug = params.module;

  if (!MODULE_IDS.includes(moduleSlug as ModuleId)) {
    notFound();
  }

  const moduleId = moduleSlug as ModuleId;
  const initialStep = searchParams.get("step") ?? undefined;
  const deploymentIdFromCallback = searchParams.get("deploymentId") ?? undefined;

  const { data, isLoading } = useQuery({
    queryKey: ["deployment-for-module", moduleId],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/marketplace/deployments");
      if (!res.ok) return { deployments: [] };
      const json = await res.json();
      return json as { deployments: Array<{ id: string; listingId: string }> };
    },
    enabled: !deploymentIdFromCallback,
  });

  const matchingDeployments = (data?.deployments ?? []).filter((d) => {
    const mapped = SLUG_TO_MODULE[d.listingId];
    return mapped === moduleId || d.listingId === moduleId;
  });

  const deploymentId = deploymentIdFromCallback ?? matchingDeployments[0]?.id;

  if (!isLoading && !deploymentIdFromCallback && matchingDeployments.length > 1) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center text-sm text-muted-foreground">
          Multiple deployments found for this module. Please contact support.
        </div>
      </div>
    );
  }

  if (!isLoading && !deploymentId) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center text-sm text-muted-foreground">
          No deployment found for this module. Please deploy the module first from the{" "}
          <a href="/dashboard" className="underline">
            dashboard
          </a>
          .
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <ModuleSetupWizard
        moduleId={moduleId}
        label={MODULE_LABELS[moduleId]}
        initialStep={initialStep}
        deploymentId={deploymentId}
      />
    </div>
  );
}
