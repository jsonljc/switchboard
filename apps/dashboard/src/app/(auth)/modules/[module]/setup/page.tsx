"use client";

import { useParams, useSearchParams } from "next/navigation";
import { notFound } from "next/navigation";
import { MODULE_IDS, MODULE_LABELS } from "@/lib/module-types";
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

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <ModuleSetupWizard
        moduleId={moduleId}
        label={MODULE_LABELS[moduleId]}
        initialStep={initialStep}
      />
    </div>
  );
}
