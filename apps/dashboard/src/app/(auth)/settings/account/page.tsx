"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { SpendLimitsForm } from "@/components/settings/spend-limits-form";
import { ForbiddenList } from "@/components/settings/forbidden-list";
import { GovernanceMode } from "@/components/settings/governance-mode";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIdentity, useUpdateIdentity } from "@/hooks/use-identity";
import { useOrgConfig, useUpdateOrgConfig } from "@/hooks/use-org-config";
import { useAgentRoster, useUpdateAgentRoster } from "@/hooks/use-agents";
import { useToast } from "@/components/ui/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

export default function SettingsAccountPage() {
  const { status } = useSession();
  const { data, isLoading, isError, error, refetch } = useIdentity();
  const updateIdentity = useUpdateIdentity();
  const { data: orgData } = useOrgConfig();
  const updateOrgConfig = useUpdateOrgConfig();
  const { data: rosterData } = useAgentRoster();
  const updateAgent = useUpdateAgentRoster();
  const { toast } = useToast();

  const [businessName, setBusinessName] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [nameInitialized, setNameInitialized] = useState(false);
  const { theme, setTheme } = useTheme();

  if (status === "unauthenticated") redirect("/login");

  const spec = data?.spec;
  const orgConfig = orgData?.config;
  const primaryOperator = rosterData?.roster?.find((a) => a.agentRole === "primary_operator");

  // Initialize local state from server data
  if (orgConfig && !nameInitialized) {
    setBusinessName(orgConfig.name ?? "");
    setOperatorName(primaryOperator?.displayName ?? "");
    setNameInitialized(true);
  }

  const handleSave = (field: string, value: unknown) => {
    if (!spec) return;
    updateIdentity.mutate(
      { id: spec.id, [field]: value },
      {
        onSuccess: () =>
          toast({
            title: "Settings saved",
            description: `${field} updated successfully.`,
          }),
        onError: (err) =>
          toast({
            title: "Error",
            description: err.message,
            variant: "destructive",
          }),
      },
    );
  };

  const handleSaveGeneral = () => {
    if (businessName.trim() && businessName !== orgConfig?.name) {
      updateOrgConfig.mutate({ name: businessName.trim() });
    }
    if (primaryOperator && operatorName.trim() && operatorName !== primaryOperator.displayName) {
      updateAgent.mutate({
        id: primaryOperator.id,
        displayName: operatorName.trim(),
      });
    }
    toast({ title: "Saved", description: "Your changes have been saved." });
  };

  if (isError) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Account</h1>
        <div className="rounded-lg border border-border bg-surface p-6">
          <div className="flex items-center gap-2 text-destructive mb-2">
            <AlertTriangle className="h-4 w-4" />
            <span className="font-medium">Failed to load settings</span>
          </div>
          <p className="text-[15px] text-muted-foreground mb-4">{(error as Error)?.message}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Account</h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          Your business, your assistant, and how they work together.
        </p>
      </section>

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="boundaries">How your assistant works</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-6 mt-4">
          <Card>
            <CardContent className="p-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="settings-business-name">Business Name</Label>
                <Input
                  id="settings-business-name"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="settings-operator-name">AI Operator Name</Label>
                <Input
                  id="settings-operator-name"
                  value={operatorName}
                  onChange={(e) => setOperatorName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Theme</Label>
                <div className="flex gap-2">
                  {(["light", "dark", "system"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTheme(t)}
                      className={cn(
                        "px-4 py-2 rounded-lg text-[13px] font-medium border transition-all duration-default",
                        theme === t
                          ? "bg-surface border-foreground/70 text-foreground shadow-sm"
                          : "bg-surface-raised border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <Button onClick={handleSaveGeneral} size="sm">
                Save Changes
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="boundaries" className="space-y-6 mt-4">
          {spec && (
            <>
              <SpendLimitsForm
                defaultValues={spec.globalSpendLimits}
                onSubmit={(values) => handleSave("globalSpendLimits", values)}
                isLoading={updateIdentity.isPending}
              />

              <GovernanceMode
                currentMode={spec.governanceProfile ?? "guarded"}
                onSave={(mode) => handleSave("governanceProfile", mode)}
                isLoading={updateIdentity.isPending}
              />

              <ForbiddenList
                currentForbidden={spec.forbiddenBehaviors}
                onSave={(values) => handleSave("forbiddenBehaviors", values)}
                isLoading={updateIdentity.isPending}
              />
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
