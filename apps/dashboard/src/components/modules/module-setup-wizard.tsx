"use client";

import { useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ModuleId } from "@/lib/module-types";
import { ConvertLeadsSetup } from "./convert-leads-setup";
import { CreateAdsSetup } from "./create-ads-setup";
import { ImproveSpendSetup } from "./improve-spend-setup";

interface ModuleSetupWizardProps {
  moduleId: ModuleId;
  label: string;
  initialStep?: string;
}

export function ModuleSetupWizard({ moduleId, label, initialStep }: ModuleSetupWizardProps) {
  const router = useRouter();

  const handleComplete = useCallback(() => {
    router.push(`/modules/${moduleId}`);
  }, [router, moduleId]);

  return (
    <div className="w-full max-w-lg">
      <div className="mb-8">
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          &larr; Back to Home
        </Link>
        <h1 className="mt-4 text-2xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
          Set up {label}
        </h1>
      </div>

      {moduleId === "lead-to-booking" && (
        <ConvertLeadsSetup initialStep={initialStep} onComplete={handleComplete} />
      )}
      {moduleId === "creative" && (
        <CreateAdsSetup initialStep={initialStep} onComplete={handleComplete} />
      )}
      {moduleId === "ad-optimizer" && (
        <ImproveSpendSetup initialStep={initialStep} onComplete={handleComplete} />
      )}
    </div>
  );
}
