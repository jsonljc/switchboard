"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";

interface Props {
  _metaAppId: string;
  metaConfigId: string;
  onSuccess?: (data: { wabaId: string; phoneNumberId: string; connectionId: string }) => void;
}

type Status = "idle" | "connecting" | "processing" | "success" | "error";

export function WhatsAppEmbeddedSignup({ _metaAppId, metaConfigId, onSuccess }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [pinRequired, setPinRequired] = useState(false);
  const [result, setResult] = useState<{
    verifiedName?: string;
    displayPhoneNumber?: string;
  } | null>(null);

  // The ESU SDK delivers the selected WABA + phone-number-id out-of-band via a
  // window `message` event (sessionInfoVersion 2), separately from the FB.login
  // callback that returns the OAuth code. Capture it here and read it when the
  // code arrives. The origin is validated so a hostile frame cannot inject ids.
  const sessionInfoRef = useRef<{ wabaId?: string; phoneNumberId?: string }>({});
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (
        event.origin !== "https://www.facebook.com" &&
        event.origin !== "https://web.facebook.com"
      ) {
        return;
      }
      try {
        const parsed = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (parsed?.type === "WA_EMBEDDED_SIGNUP" && parsed?.data) {
          sessionInfoRef.current = {
            wabaId: parsed.data.waba_id,
            phoneNumberId: parsed.data.phone_number_id,
          };
        }
      } catch {
        // Non-JSON / unrelated message — ignore.
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const handleConnect = useCallback(() => {
    if (!window.FB) {
      setError("Meta SDK not loaded. Please refresh the page.");
      setStatus("error");
      return;
    }

    setStatus("connecting");
    setError(null);
    setPinRequired(false);
    // Clear any session info captured by a prior (cancelled) attempt so stale
    // ids can't ride along with this attempt's code.
    sessionInfoRef.current = {};

    window.FB.login(
      async (response) => {
        const code = response.authResponse?.code;
        if (!code) {
          // No code (user closed/cancelled the dialog) — nothing to onboard.
          setStatus("idle");
          return;
        }

        setStatus("processing");

        try {
          const { wabaId, phoneNumberId } = sessionInfoRef.current;
          const res = await fetch("/api/dashboard/connections/whatsapp-embedded", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code, wabaId, phoneNumberId, ...(pin ? { pin } : {}) }),
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
            setPinRequired(data.code === "whatsapp_registration_pin_required");
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
  }, [metaConfigId, onSuccess, pin]);

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
            <div className="space-y-1">
              <label htmlFor="wa-2sv-pin" className="text-sm font-medium">
                Two-step verification PIN (optional)
              </label>
              <input
                id="wa-2sv-pin"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                aria-invalid={pinRequired}
                placeholder="Only if your number already has one"
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
              <p className="text-xs text-muted-foreground">
                If your WhatsApp number already has two-step verification, enter its existing
                6-digit PIN. Leave blank otherwise.
              </p>
            </div>
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
