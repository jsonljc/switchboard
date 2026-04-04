"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { useListing, useDeployListing } from "@/hooks/use-marketplace";
import { DeployWizardShell } from "@/components/marketplace/deploy-wizard-shell";
import { DeployStepConfig } from "@/components/marketplace/deploy-step-config";
import { DeployStepConnect } from "@/components/marketplace/deploy-step-connect";
import { DeployStepGovernance } from "@/components/marketplace/deploy-step-governance";

const STEPS = ["Configure", "Connect", "Governance"];

export default function DeployPage() {
  const { id } = useParams<{ id: string }>();
  const { status } = useSession();
  const router = useRouter();
  const { toast } = useToast();
  const { data: listingData, isLoading } = useListing(id);
  const deployMutation = useDeployListing();

  const [step, setStep] = useState(0);

  // Step 1: Config
  const [inputConfig, setInputConfig] = useState({
    taskDescription: "",
    acceptanceCriteria: "",
    outputFormat: "",
  });

  // Step 2: Connections
  const [connectionIds, setConnectionIds] = useState<string[]>([]);

  // Step 3: Governance
  const [governance, setGovernance] = useState({
    requireApproval: false,
    dailySpendLimit: "",
    maxTasksPerDay: "10",
    autoPauseBelow: "30",
  });

  if (status === "unauthenticated") redirect("/login");

  if (status === "loading" || isLoading) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const listing = listingData;
  if (!listing) {
    return (
      <div className="py-16 text-center">
        <p className="text-[15px] text-foreground font-medium">Agent not found.</p>
      </div>
    );
  }

  const handleDeploy = async () => {
    try {
      await deployMutation.mutateAsync({
        listingId: id,
        config: {
          inputConfig,
          governanceSettings: {
            requireApproval: governance.requireApproval,
            dailySpendLimit: governance.dailySpendLimit
              ? parseFloat(governance.dailySpendLimit) || null
              : null,
            maxTasksPerDay: governance.maxTasksPerDay
              ? parseInt(governance.maxTasksPerDay, 10) || null
              : null,
            autoPauseBelow: governance.autoPauseBelow
              ? parseInt(governance.autoPauseBelow, 10) || null
              : null,
          },
          connectionIds,
        },
      });
      toast({
        title: "Agent deployed",
        description: `${listing.name} is now active in your workspace.`,
      });
      router.push("/marketplace");
    } catch (err) {
      toast({
        title: "Deploy failed",
        description: err instanceof Error ? err.message : "Something went wrong",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <button
        onClick={() => router.push(`/marketplace/${id}`)}
        className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors duration-fast"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {listing.name}
      </button>

      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
          Deploy {listing.name}
        </h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          Set up this agent for your workspace in three steps.
        </p>
      </div>

      <DeployWizardShell
        steps={STEPS}
        currentStep={step}
        canProceed={true}
        isSubmitting={deployMutation.isPending}
        onBack={() => setStep((s) => Math.max(0, s - 1))}
        onNext={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
        onDeploy={handleDeploy}
      >
        {step === 0 && <DeployStepConfig config={inputConfig} onChange={setInputConfig} />}
        {step === 1 && (
          <DeployStepConnect selectedIds={connectionIds} onChange={setConnectionIds} />
        )}
        {step === 2 && <DeployStepGovernance config={governance} onChange={setGovernance} />}
      </DeployWizardShell>
    </div>
  );
}
