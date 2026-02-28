"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SimulationForm } from "@/components/simulate/simulation-form";
import { DecisionTrace } from "@/components/simulate/decision-trace";
import { useCartridges } from "@/hooks/use-cartridges";
import { AlertTriangle, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SimulateResult } from "@/lib/api-client";

export default function SimulatePage() {
  const { data: session, status: authStatus } = useSession();
  const { data: cartridgesData, isLoading: cartridgesLoading, isError, error, refetch } = useCartridges();
  const [result, setResult] = useState<SimulateResult | null>(null);
  const [simError, setSimError] = useState<string | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);

  if (authStatus === "unauthenticated") redirect("/login");

  const principalId = (session?.user as any)?.principalId ?? "agent-001";

  const handleSubmit = async (data: {
    actionType: string;
    parameters: Record<string, unknown>;
    principalId: string;
    cartridgeId: string;
  }) => {
    setIsSimulating(true);
    setSimError(null);
    setResult(null);
    try {
      const res = await fetch("/api/dashboard/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Simulation failed (${res.status})`);
      }
      const json: SimulateResult = await res.json();
      setResult(json);
    } catch (err: any) {
      setSimError(err.message);
    } finally {
      setIsSimulating(false);
    }
  };

  if (isError) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Simulate</h1>
        <Card className="border-destructive">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-destructive mb-2">
              <AlertTriangle className="h-4 w-4" />
              <span className="font-medium">Failed to load cartridges</span>
            </div>
            <p className="text-sm text-muted-foreground mb-4">{(error as Error)?.message}</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FlaskConical className="h-6 w-6" />
          Simulate
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Test how your policies evaluate actions before they happen. Select an action type, set parameters, and see the full decision trace.
        </p>
      </div>

      {cartridgesLoading ? (
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {/* Left column: form */}
          <Card>
            <CardContent className="p-6">
              <SimulationForm
                cartridges={cartridgesData?.cartridges ?? []}
                defaultPrincipalId={principalId}
                isLoading={isSimulating}
                onSubmit={handleSubmit}
              />
            </CardContent>
          </Card>

          {/* Right column: results */}
          <div className="space-y-4">
            {isSimulating && <Skeleton className="h-64" />}
            {simError && (
              <Card className="border-destructive">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm font-medium">Simulation Error</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{simError}</p>
                </CardContent>
              </Card>
            )}
            {result && !isSimulating && <DecisionTrace result={result} />}
            {!result && !isSimulating && !simError && (
              <Card>
                <CardContent className="p-6 text-center text-muted-foreground">
                  <FlaskConical className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Select an action and run a simulation to see results here.</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
