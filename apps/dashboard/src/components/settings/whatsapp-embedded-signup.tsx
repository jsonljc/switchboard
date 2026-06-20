"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, Loader2, ShieldCheck, Lock, ChevronRight } from "lucide-react";

interface Props {
  _metaAppId: string;
  metaConfigId: string;
  onSuccess?: (data: { wabaId: string; phoneNumberId: string; connectionId: string }) => void;
  // Fired once the moment the onboard succeeds, before the confirmation card is
  // dismissed, so the connections list can refresh regardless of how it is closed.
  onConnected?: () => void;
}

type Status = "idle" | "connecting" | "processing" | "success" | "error";

interface SuccessPayload {
  wabaId: string;
  phoneNumberId: string;
  connectionId: string;
  verifiedName?: string;
  displayPhoneNumber?: string;
}

// WhatsApp wordmark glyph (lucide dropped brand icons). Decorative; fill follows text color.
function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.247-.694.247-1.289.173-1.413-.074-.124-.272-.198-.57-.347M12.05 21.785h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.999-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884a9.82 9.82 0 0 1 6.988 2.898 9.82 9.82 0 0 1 2.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885m8.413-18.297A11.82 11.82 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.88 11.88 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.82 11.82 0 0 0-3.48-8.413" />
    </svg>
  );
}

const STEPS: { title: string; detail: string }[] = [
  {
    title: "Sign in with Meta",
    detail: "A secure Meta window opens. Your password is never shared with Switchboard.",
  },
  {
    title: "Choose your Business Account",
    detail: "Select an existing WhatsApp Business Account or create one.",
  },
  { title: "Verify your number", detail: "Confirm the phone number, then you are live." },
];

export function WhatsAppEmbeddedSignup({
  _metaAppId,
  metaConfigId,
  onSuccess,
  onConnected,
}: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [pinOpen, setPinOpen] = useState(false);
  const [pinRequired, setPinRequired] = useState(false);
  const [result, setResult] = useState<SuccessPayload | null>(null);

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
        // Non-JSON / unrelated message, ignore.
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
          // No code (user closed/cancelled the dialog), nothing to onboard.
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
              wabaId: data.wabaId,
              phoneNumberId: data.phoneNumberId,
              connectionId: data.connectionId,
              verifiedName: data.verifiedName,
              displayPhoneNumber: data.displayPhoneNumber,
            });
            // Refresh the list the moment the onboard lands, so the new WhatsApp
            // appears whether the card is dismissed via Done or the dialog close.
            onConnected?.();
          } else {
            const needsPin = data.code === "whatsapp_registration_pin_required";
            setPinRequired(needsPin);
            // Surface the otherwise-hidden PIN field so the operator can recover.
            if (needsPin) setPinOpen(true);
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
  }, [metaConfigId, pin, onConnected]);

  const busy = status === "connecting" || status === "processing";

  if (status === "success" && result) {
    return (
      <div className="px-7 pb-7 pt-10 text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-[#e9f9f0] text-[#0b7a4b]">
          <CheckCircle className="h-7 w-7" aria-hidden="true" />
        </div>
        <h2 className="text-xl font-semibold tracking-tight">WhatsApp Business connected</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Your agent can now send and receive on this number.
        </p>
        <div className="mt-5 flex items-center gap-3 rounded-xl border border-border p-3 text-left">
          <div className="grid h-10 w-10 flex-none place-items-center rounded-[11px] bg-gradient-to-br from-[#2bdf6f] to-[#008069]">
            <WhatsAppGlyph className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              {result.verifiedName || "WhatsApp"}
            </div>
            {result.displayPhoneNumber && (
              <div className="font-mono text-xs text-muted-foreground">
                {result.displayPhoneNumber}
              </div>
            )}
          </div>
          <Badge variant="positive" className="ml-auto">
            Verified
          </Badge>
        </div>
        <Button
          variant="action"
          type="button"
          className="mt-5 w-full"
          onClick={() =>
            onSuccess?.({
              wabaId: result.wabaId,
              phoneNumberId: result.phoneNumberId,
              connectionId: result.connectionId,
            })
          }
        >
          Done
        </Button>
      </div>
    );
  }

  return (
    <div>
      {/* Branded crown, full-bleed inside the (p-0) dialog */}
      <div className="border-b border-border/60 bg-gradient-to-b from-[#e9f9f0] to-card px-7 pb-5 pt-9 text-center">
        <div className="mx-auto mb-3.5 grid h-14 w-14 place-items-center rounded-[16px] bg-gradient-to-br from-[#2bdf6f] to-[#008069] shadow-[var(--shadow-3)]">
          <WhatsAppGlyph className="h-8 w-8 text-white" />
        </div>
        <span className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-[#cdeede] bg-card/70 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[#0b7a4b]">
          <ShieldCheck className="h-3 w-3" aria-hidden="true" />
          Secure sign-in with Meta
        </span>
        <h2 className="text-xl font-semibold tracking-tight">Connect WhatsApp Business</h2>
        <p className="mx-auto mt-1.5 max-w-[34ch] text-sm leading-relaxed text-muted-foreground">
          Link your WhatsApp Business Account in one step. You will sign in with Meta and choose the
          number your agent sends from.
        </p>
      </div>

      <div className="px-7 pb-6 pt-5">
        {/* What happens next */}
        <ol className="space-y-3.5">
          {STEPS.map((step, i) => (
            <li key={step.title} className="grid grid-cols-[26px_1fr] gap-3">
              <span className="grid h-[26px] w-[26px] place-items-center rounded-full border border-[#cdeede] bg-[#e9f9f0] text-xs font-bold text-[#0b7a4b]">
                {i + 1}
              </span>
              <div>
                <div className="text-[13px] font-semibold leading-snug">{step.title}</div>
                <div className="mt-0.5 text-xs leading-snug text-muted-foreground">
                  {step.detail}
                </div>
              </div>
            </li>
          ))}
        </ol>

        {/* Trust line */}
        <div className="mt-4 flex items-center gap-2.5 rounded-md bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5 flex-none text-[#0b7a4b]" aria-hidden="true" />
          <span>
            <span className="font-semibold text-foreground">Encrypted and revocable.</span>{" "}
            Credentials are stored encrypted, and you can disconnect anytime.
          </span>
        </div>

        {error && (
          <div className="mt-4 flex items-center gap-2 text-sm text-destructive">
            <XCircle className="h-4 w-4 flex-none" aria-hidden="true" />
            {error}
          </div>
        )}

        <Button
          type="button"
          onClick={handleConnect}
          disabled={busy}
          className="mt-4 h-11 w-full gap-2 bg-[#008069] text-white hover:bg-[#00715c]"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {status === "connecting" ? "Opening Meta..." : "Setting up..."}
            </>
          ) : (
            <>
              <WhatsAppGlyph className="h-[18px] w-[18px] text-white" />
              Connect WhatsApp
            </>
          )}
        </Button>

        {/* Optional 2SV PIN, tucked behind a disclosure so the default is one clean button */}
        <div className="mt-3.5">
          <button
            type="button"
            aria-expanded={pinOpen}
            aria-controls="wa-2sv-panel"
            onClick={() => setPinOpen((o) => !o)}
            className="flex w-max items-center gap-1.5 rounded-md py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronRight
              className={`h-3.5 w-3.5 transition-transform ${pinOpen ? "rotate-90" : ""}`}
              aria-hidden="true"
            />
            My number already has two-step verification
          </button>
          <div id="wa-2sv-panel" hidden={!pinOpen} className="pt-2">
            <label htmlFor="wa-2sv-pin" className="text-xs font-medium">
              Two-step verification PIN
            </label>
            <input
              id="wa-2sv-pin"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              aria-invalid={pinRequired}
              placeholder="6-digit PIN"
              className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm tracking-[0.3em] aria-[invalid=true]:border-destructive"
            />
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              Enter the existing 6-digit PIN registered to your WhatsApp number. Most numbers do not
              have one, leave this closed if unsure.
            </p>
          </div>
        </div>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-muted-foreground">
          By continuing you will be redirected to Meta to authorize access.
          <br />
          Powered by the WhatsApp Business Platform.
        </p>
      </div>
    </div>
  );
}
