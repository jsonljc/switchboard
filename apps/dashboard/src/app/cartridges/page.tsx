"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { CartridgeCard } from "@/components/cartridges/cartridge-card";
import { useCartridges } from "@/hooks/use-cartridges";
import { AlertTriangle, Box } from "lucide-react";

export default function CartridgesPage() {
  const { status } = useSession();
  const { data, isLoading, isError, error, refetch } = useCartridges();

  if (status === "unauthenticated") redirect("/login");

  if (isError) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Cartridges</h1>
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
          <Box className="h-6 w-6" />
          Cartridges
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Registered integrations and their available actions.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      ) : (data?.cartridges ?? []).length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>No cartridges registered</p>
          <p className="text-xs mt-1">Cartridges are code-level plugins registered at server startup.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {data!.cartridges.map((cartridge) => (
            <CartridgeCard key={cartridge.id} cartridge={cartridge} />
          ))}
        </div>
      )}
    </div>
  );
}
