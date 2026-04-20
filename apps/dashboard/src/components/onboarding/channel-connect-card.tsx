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
}

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
}: ChannelConnectCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});

  const channelFields = CHANNEL_FIELDS[channel] ?? [];

  return (
    <div className="border-b last:border-b-0" style={{ borderColor: "var(--sw-border)" }}>
      <div className="flex items-center justify-between px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
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
                  className="mb-1 block text-[14px]"
                  style={{ color: "var(--sw-text-secondary)" }}
                >
                  {field.label}
                </label>
                <Input
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
              className="h-[48px] rounded-lg px-6 text-[16px]"
              style={{ backgroundColor: "var(--sw-text-primary)", color: "white" }}
            >
              Connect
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
