"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface ChannelConnectCardProps {
  channel: string;
  label: string;
  description: string;
  recommended: boolean;
  isConnected: boolean;
  comingSoon: boolean;
  onConnect: (credentials: Record<string, string>) => void;
  isConnecting?: boolean;
}

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  whatsapp: (
    <svg
      data-testid="channel-icon-whatsapp"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  ),
  telegram: (
    <svg
      data-testid="channel-icon-telegram"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  ),
  webchat: (
    <svg
      data-testid="channel-icon-webchat"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
};

const CHANNEL_FIELDS: Record<string, { label: string; key: string; type: string }[]> = {
  whatsapp: [
    { label: "Phone Number ID", key: "phoneNumberId", type: "text" },
    { label: "WhatsApp Cloud API Access Token", key: "token", type: "password" },
  ],
  telegram: [{ label: "Bot token", key: "botToken", type: "password" }],
};

export function ChannelConnectCard({
  channel,
  label,
  description,
  recommended,
  isConnected,
  comingSoon,
  onConnect,
  isConnecting,
}: ChannelConnectCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [showGuide, setShowGuide] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testError, setTestError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    verifiedName?: string;
    displayPhoneNumber?: string;
  } | null>(null);

  const channelFields = CHANNEL_FIELDS[channel] ?? [];
  const isWhatsApp = channel === "whatsapp";
  const canTest = isWhatsApp && fields.token && fields.phoneNumberId;
  const canSave = isWhatsApp ? testStatus === "success" : true;

  async function handleTestConnection() {
    setTestStatus("testing");
    setTestError(null);
    setTestResult(null);

    try {
      const res = await fetch("/api/dashboard/connections/whatsapp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: fields.token,
          phoneNumberId: fields.phoneNumberId,
        }),
      });
      const data = await res.json();

      if (data.success) {
        setTestStatus("success");
        setTestResult({
          verifiedName: data.verifiedName,
          displayPhoneNumber: data.displayPhoneNumber,
        });
      } else {
        setTestStatus("error");
        setTestError(data.error || "Connection test failed");
      }
    } catch {
      setTestStatus("error");
      setTestError("Could not reach Meta's servers. Check your network and try again.");
    }
  }

  return (
    <div className="border-b last:border-b-0" style={{ borderColor: "var(--sw-border)" }}>
      <div className="flex items-center justify-between px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <div style={{ color: "var(--sw-text-muted)", width: 20, height: 20 }}>
              {CHANNEL_ICONS[channel]}
            </div>
            <span className="text-[16px] font-semibold" style={{ color: "var(--sw-text-primary)" }}>
              {label}
            </span>
            {recommended && (
              <span
                className="rounded-full px-2 py-0.5 text-[12px]"
                style={{ color: "var(--sw-accent)", backgroundColor: "rgba(160, 120, 80, 0.1)" }}
              >
                Recommended
              </span>
            )}
          </div>
          <p className="text-[14px]" style={{ color: "var(--sw-text-secondary)" }}>
            {description}
          </p>
        </div>
        {comingSoon ? (
          <span className="text-[14px]" style={{ color: "var(--sw-text-muted)" }}>
            Coming soon
          </span>
        ) : isConnected ? (
          <span className="text-[14px]" style={{ color: "hsl(145, 45%, 42%)" }}>
            Connected ✓
          </span>
        ) : (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[14px]"
            style={{ color: "var(--sw-accent)" }}
          >
            Connect →
          </button>
        )}
      </div>
      {expanded && !isConnected && (
        <div className="border-t px-5 py-4" style={{ borderColor: "var(--sw-border)" }}>
          <div className="space-y-3">
            {isWhatsApp && (
              <div className="mb-3">
                <button
                  type="button"
                  onClick={() => setShowGuide(!showGuide)}
                  className="text-[13px] underline"
                  style={{ color: "var(--sw-accent)" }}
                >
                  {showGuide ? "Hide guide" : "Where do I find these?"}
                </button>
                {showGuide && (
                  <div
                    className="mt-2 rounded-lg p-3 text-[13px] space-y-1"
                    style={{
                      backgroundColor: "rgba(160, 120, 80, 0.05)",
                      color: "var(--sw-text-secondary)",
                    }}
                  >
                    <p>
                      <strong>Phone Number ID</strong> — A numeric ID for your WhatsApp business
                      phone number. Find it in Meta Business Suite → WhatsApp → API Setup.
                    </p>
                    <p>
                      <strong>Access Token</strong> — A temporary or permanent token from the same
                      API Setup page. Use a permanent token for production.
                    </p>
                    <p>Your Meta Business account must have WhatsApp Cloud API access enabled.</p>
                    <p>
                      <a
                        href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                        style={{ color: "var(--sw-accent)" }}
                      >
                        Meta Cloud API documentation →
                      </a>
                    </p>
                  </div>
                )}
              </div>
            )}
            {channelFields.map((field) => (
              <div key={field.key}>
                <label
                  htmlFor={`${channel}-${field.key}`}
                  className="mb-1 block text-[14px]"
                  style={{ color: "var(--sw-text-secondary)" }}
                >
                  {field.label}
                </label>
                <Input
                  id={`${channel}-${field.key}`}
                  type={field.type}
                  value={fields[field.key] ?? ""}
                  onChange={(e) => {
                    setFields({ ...fields, [field.key]: e.target.value });
                    if (testStatus !== "idle") {
                      setTestStatus("idle");
                      setTestError(null);
                      setTestResult(null);
                    }
                  }}
                  className="h-[48px]"
                />
              </div>
            ))}
            {testStatus === "success" && testResult && (
              <div
                className="rounded-lg p-3 text-[13px]"
                style={{ backgroundColor: "rgba(34, 197, 94, 0.08)", color: "hsl(145, 45%, 42%)" }}
              >
                ✓ Connected to <strong>{testResult.verifiedName || "WhatsApp Business"}</strong>
                {testResult.displayPhoneNumber && ` (${testResult.displayPhoneNumber})`}
              </div>
            )}

            {testStatus === "error" && testError && (
              <div
                className="rounded-lg p-3 text-[13px]"
                style={{ backgroundColor: "rgba(229, 72, 77, 0.08)", color: "hsl(358, 75%, 59%)" }}
              >
                {testError}
              </div>
            )}
            <div className="flex gap-3">
              {isWhatsApp && (
                <Button
                  onClick={handleTestConnection}
                  disabled={!canTest || testStatus === "testing"}
                  variant="outline"
                  className="h-[48px] flex-1 rounded-lg px-6 text-[14px]"
                >
                  {testStatus === "testing" ? "Testing…" : "Test Connection"}
                </Button>
              )}
              <Button
                onClick={() => {
                  onConnect(fields);
                  setExpanded(false);
                }}
                disabled={isConnecting || !canSave}
                className="h-[48px] flex-1 rounded-lg px-6 text-[16px]"
                style={{ backgroundColor: "var(--sw-text-primary)", color: "white" }}
              >
                {isConnecting ? "Connecting..." : "Connect"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
