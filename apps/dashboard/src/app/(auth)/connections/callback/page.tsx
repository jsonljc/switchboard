"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";

/**
 * Landing page for the Meta / Google OAuth round-trip. The API callback leg
 * redirects here as `${DASHBOARD_URL}/connections/callback?connected=true&deploymentId=...`
 * once it has stored the encrypted credentials, so this page only confirms the
 * outcome and points the operator back to their connections.
 */
export function ConnectionCallback() {
  const params = useSearchParams();
  const connected = params.get("connected") === "true";
  const deploymentId = params.get("deploymentId");
  // Both the Facebook and Google Calendar callback legs land here; the Google leg
  // tags itself with `service`, the Meta leg omits it.
  const productLabel = params.get("service") === "google_calendar" ? "Google Calendar" : "Meta";
  const keys = useScopedQueryKeys();
  const queryClient = useQueryClient();

  useEffect(() => {
    // Mark the connections list stale so its "Connected" badge refetches when
    // the operator returns. Only on success, and only once the session-scoped
    // keys are available.
    if (connected && keys) {
      queryClient.invalidateQueries({ queryKey: keys.connections.all() });
    }
  }, [connected, keys, queryClient]);

  return (
    <div className="mx-auto max-w-md py-16">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {connected ? (
              <>
                <CheckCircle className="h-5 w-5 text-green-600" />
                Connected
              </>
            ) : (
              <>
                <AlertTriangle className="h-5 w-5 text-yellow-600" />
                Connection not confirmed
              </>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {connected ? (
            <p className="text-sm text-muted-foreground">
              {productLabel} is connected
              {deploymentId ? ` for deployment ${deploymentId}` : ""}. You can head back to your
              connections.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              We could not confirm the connection. Head back and try connecting again from your
              connections.
            </p>
          )}
          <Button asChild className="w-full">
            <Link href="/settings/channels">Return to connections</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ConnectionsCallbackPage() {
  return (
    <Suspense fallback={null}>
      <ConnectionCallback />
    </Suspense>
  );
}
