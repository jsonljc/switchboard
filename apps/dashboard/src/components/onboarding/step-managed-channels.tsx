"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const CHANNEL_OPTIONS = [
  {
    value: "telegram",
    label: "Telegram",
    description: "Connect a Telegram bot to your organization.",
    instructions: [
      "Open Telegram and message @BotFather",
      "Send /newbot and follow the prompts to create a bot",
      "Copy the bot token provided by BotFather",
    ],
    fields: [
      { key: "botToken", label: "Bot Token", placeholder: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11", required: true },
      { key: "webhookSecret", label: "Webhook Secret (optional)", placeholder: "A secret string for webhook verification", required: false },
    ],
  },
  {
    value: "slack",
    label: "Slack",
    description: "Connect a Slack app to your organization.",
    instructions: [
      "Go to api.slack.com/apps and create a new app",
      "Under OAuth & Permissions, add chat:write and app_mentions:read scopes",
      "Install the app to your workspace and copy the Bot User OAuth Token",
      "Under Basic Information, copy the Signing Secret",
    ],
    fields: [
      { key: "botToken", label: "Bot User OAuth Token", placeholder: "xoxb-...", required: true },
      { key: "signingSecret", label: "Signing Secret", placeholder: "Your app's signing secret", required: true },
    ],
  },
];

interface StepManagedChannelsProps {
  selectedChannels: string[];
  onChannelsChange: (channels: string[]) => void;
  channelCredentials: Record<string, Record<string, string>>;
  onCredentialsChange: (channel: string, creds: Record<string, string>) => void;
}

export function StepManagedChannels({
  selectedChannels,
  onChannelsChange,
  channelCredentials,
  onCredentialsChange,
}: StepManagedChannelsProps) {
  const toggleChannel = (value: string) => {
    if (selectedChannels.includes(value)) {
      onChannelsChange(selectedChannels.filter((c) => c !== value));
    } else {
      onChannelsChange([...selectedChannels, value]);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Select which messaging channels to connect. You can add more later.
      </p>

      {CHANNEL_OPTIONS.map((option) => {
        const isSelected = selectedChannels.includes(option.value);
        const creds = channelCredentials[option.value] ?? {};

        return (
          <div key={option.value} className="space-y-3">
            <button
              type="button"
              onClick={() => toggleChannel(option.value)}
              className={`w-full text-left p-4 rounded-lg border transition-colors ${
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50 hover:bg-muted/50"
              }`}
            >
              <div className="flex items-center gap-2">
                <div className={`w-4 h-4 rounded border flex items-center justify-center ${
                  isSelected ? "bg-primary border-primary" : "border-muted-foreground"
                }`}>
                  {isSelected && <span className="text-primary-foreground text-xs">✓</span>}
                </div>
                <span className="font-medium text-sm">{option.label}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1 ml-6">{option.description}</p>
            </button>

            {isSelected && (
              <div className="ml-4 p-4 rounded-lg border border-dashed space-y-4">
                <div>
                  <p className="text-xs font-medium mb-2">Setup instructions:</p>
                  <ol className="list-decimal list-inside text-xs text-muted-foreground space-y-1">
                    {option.instructions.map((instruction, i) => (
                      <li key={i}>{instruction}</li>
                    ))}
                  </ol>
                </div>

                {option.fields.map((field) => (
                  <div key={field.key} className="space-y-1.5">
                    <Label htmlFor={`${option.value}-${field.key}`} className="text-xs">
                      {field.label}
                    </Label>
                    <Input
                      id={`${option.value}-${field.key}`}
                      type="password"
                      placeholder={field.placeholder}
                      value={creds[field.key] ?? ""}
                      onChange={(e) => {
                        onCredentialsChange(option.value, {
                          ...creds,
                          [field.key]: e.target.value,
                        });
                      }}
                      className="font-mono text-xs"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
