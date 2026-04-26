"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";

declare global {
  interface Window {
    FB?: {
      init(params: { appId: string; cookie: boolean; xfbml: boolean; version: string }): void;
      login(
        callback: (response: { authResponse?: { accessToken: string } }) => void,
        params: {
          config_id: string;
          response_type: string;
          override_default_response_type: boolean;
          extras: Record<string, unknown>;
        },
      ): void;
    };
  }
}

interface Props {
  _metaAppId: string;
  metaConfigId: string;
  onSuccess?: (data: { wabaId: string; phoneNumberId: string; connectionId: string }) => void;
}

type Status = "idle" | "connecting" | "processing" | "success" | "error";

export function WhatsAppEmbeddedSignup({ _metaAppId, metaConfigId, onSuccess }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    verifiedName?: string;
    displayPhoneNumber?: string;
  } | null>(null);

  const handleConnect = useCallback(() => {
    if (!window.FB) {
      setError("Meta SDK not loaded. Please refresh the page.");
      setStatus("error");
      return;
    }

    setStatus("connecting");
    setError(null);

    window.FB.login(
      async (response) => {
        if (!response.authResponse?.accessToken) {
          setStatus("idle");
          return;
        }

        setStatus("processing");

        try {
          const res = await fetch("/api/dashboard/connections/whatsapp-embedded", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ esToken: response.authResponse.accessToken }),
          });

          const data = await res.json();

          if (data.success) {
            setStatus("success");
            setResult({
              verifiedName: data.verifiedName,
              displayPhoneNumber: data.displayPhoneNumber,
            });
            onSuccess?.({
              wabaId: data.wabaId,
              phoneNumberId: data.phoneNumberId,
              connectionId: data.connectionId,
            });
          } else {
            setError(data.error || "Onboarding failed");
            setStatus("error");
          }
        } catch {
          setError("Could not complete setup. Please try again.");
          setStatus("error");
        }
      },
      {
        config_id: metaConfigId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          feature: "whatsapp_embedded_signup",
          sessionInfoVersion: "2",
        },
      },
    );
  }, [metaConfigId, onSuccess]);

  return (
    <Card>
      <CardContent className="p-6">
        {status === "success" && result ? (
          <div className="flex items-center gap-3">
            <CheckCircle className="h-5 w-5 text-green-500" />
            <div>
              <p className="font-medium">WhatsApp Connected</p>
              <p className="text-sm text-muted-foreground">
                {result.verifiedName} ({result.displayPhoneNumber})
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Connect your WhatsApp Business Account in one click. You&apos;ll select or create a
              business account and verify your phone number.
            </p>
            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <XCircle className="h-4 w-4" />
                {error}
              </div>
            )}
            <Button
              onClick={handleConnect}
              disabled={status === "connecting" || status === "processing"}
              className="w-full"
            >
              {status === "connecting" || status === "processing" ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {status === "connecting" ? "Opening Meta..." : "Setting up..."}
                </>
              ) : (
                "Connect WhatsApp"
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
