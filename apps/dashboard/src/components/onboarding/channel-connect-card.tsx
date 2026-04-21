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
    { label: "Phone number", key: "phone", type: "tel" },
    { label: "API key", key: "apiKey", type: "password" },
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

  const channelFields = CHANNEL_FIELDS[channel] ?? [];
  const allFieldsFilled = channelFields.every((f) => (fields[f.key] ?? "").trim().length > 0);

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
                  onChange={(e) => setFields({ ...fields, [field.key]: e.target.value })}
                  className="h-[48px]"
                />
              </div>
            ))}
            <Button
              onClick={() => {
                onConnect(fields);
                setExpanded(false);
              }}
              disabled={isConnecting || !allFieldsFilled}
              className="h-[48px] rounded-lg px-6 text-[16px]"
              style={{ backgroundColor: "var(--sw-text-primary)", color: "white" }}
            >
              {isConnecting ? "Connecting..." : "Connect"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
