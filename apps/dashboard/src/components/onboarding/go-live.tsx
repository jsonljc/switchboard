"use client";

import { useState } from "react";
import { AgentMark } from "@/components/character/agent-mark";
import { ChannelConnectCard } from "./channel-connect-card";
import { LaunchSequence } from "./launch-sequence";
import type { Playbook } from "@switchboard/schemas";

interface GoLiveProps {
  playbook: Playbook;
  onLaunch: () => Promise<void>;
  onBack: () => void;
  connectedChannels: string[];
  scenariosTested: number;
  onConnectChannel: (channel: string, credentials: Record<string, string>) => void;
  onLaunchComplete: () => void;
  isConnecting: boolean;
  connectError?: string;
}

export function GoLive({
  playbook,
  onLaunch,
  onBack,
  connectedChannels,
  scenariosTested,
  onConnectChannel,
  onLaunchComplete,
  isConnecting,
  connectError,
}: GoLiveProps) {
  const [launched, setLaunched] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const hasChannel = connectedChannels.length > 0;
  const serviceCount = playbook.services.length;
  const recommended = playbook.channels.recommended ?? "whatsapp";

  const WEEKDAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
  const WEEKDAY_ABBRS: Record<string, string> = {
    mon: "Mon",
    tue: "Tue",
    wed: "Wed",
    thu: "Thu",
    fri: "Fri",
    sat: "Sat",
    sun: "Sun",
  };

  const hoursSummary = (() => {
    const scheduledDays = WEEKDAY_ORDER.filter((d) => d in playbook.hours.schedule);
    if (scheduledDays.length === 0) return "";

    const formatTime = (t: string) => {
      const [h, m] = t.split(":");
      const hour = parseInt(h, 10);
      const suffix = hour >= 12 ? "pm" : "am";
      const display = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
      return m === "00" ? `${display}${suffix}` : `${display}:${m}${suffix}`;
    };

    const firstHours = playbook.hours.schedule[scheduledDays[0]];
    const [open, close] = firstHours.split("-");
    const range = open && close ? `${formatTime(open)}-${formatTime(close)}` : firstHours;

    const firstAbbr = WEEKDAY_ABBRS[scheduledDays[0]];
    const lastAbbr = WEEKDAY_ABBRS[scheduledDays[scheduledDays.length - 1]];

    let contiguous = true;
    for (let i = 1; i < scheduledDays.length; i++) {
      if (
        WEEKDAY_ORDER.indexOf(scheduledDays[i]) !==
        WEEKDAY_ORDER.indexOf(scheduledDays[i - 1]) + 1
      ) {
        contiguous = false;
        break;
      }
    }

    const dayLabel =
      scheduledDays.length <= 2
        ? scheduledDays.map((d) => WEEKDAY_ABBRS[d]).join(", ")
        : contiguous
          ? `${firstAbbr}-${lastAbbr}`
          : scheduledDays.map((d) => WEEKDAY_ABBRS[d]).join(", ");

    return `${dayLabel} ${range}`;
  })();

  const playbookSummary = [
    `${serviceCount} service${serviceCount !== 1 ? "s" : ""}`,
    hoursSummary,
    playbook.approvalMode.bookingApproval === "ask_before_booking" ? "Approval-first" : "Auto-book",
    ...connectedChannels.map((c) => c.charAt(0).toUpperCase() + c.slice(1)),
  ]
    .filter(Boolean)
    .join(" · ");

  if (launched) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ backgroundColor: "var(--sw-base)" }}
      >
        <LaunchSequence
          channel={connectedChannels[0] ?? "WhatsApp"}
          onComplete={onLaunchComplete}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col" style={{ backgroundColor: "var(--sw-base)" }}>
      <div className="fixed left-6 top-6 z-10">
        <span
          className="text-[16px] font-semibold"
          style={{ fontFamily: "var(--font-display)", color: "var(--sw-text-primary)" }}
        >
          Switchboard
        </span>
      </div>
      <div className="flex flex-1 items-center justify-center" style={{ paddingBottom: "10vh" }}>
        <div className="mx-auto w-full max-w-[520px] px-6 text-center">
          <div className="mb-8 flex justify-center">
            <AgentMark agent="alex" size="lg" />
          </div>
          <h1
            className="mb-10 text-[32px] font-semibold leading-[40px]"
            style={{ fontFamily: "var(--font-display)", color: "var(--sw-text-primary)" }}
          >
            Alex is ready for your business
          </h1>

          <div className="mb-8 text-left">
            <p
              className="mb-3 text-[13px] font-medium uppercase tracking-[0.05em]"
              style={{ color: "var(--sw-text-muted)" }}
            >
              Required to launch
            </p>
            <div
              className="mb-1 flex items-center justify-between text-[16px]"
              style={{ color: "var(--sw-text-primary)" }}
            >
              <span>Playbook complete</span>
              <span style={{ color: "hsl(145, 45%, 42%)" }}>✓</span>
            </div>
            <div
              className="mb-4 flex items-center justify-between text-[16px]"
              style={{ color: "var(--sw-text-primary)" }}
            >
              <span>At least one channel connected</span>
              {hasChannel && <span style={{ color: "hsl(145, 45%, 42%)" }}>✓</span>}
            </div>
            <div className="rounded-xl border" style={{ borderColor: "var(--sw-border)" }}>
              <ChannelConnectCard
                channel="whatsapp"
                label="WhatsApp"
                description="Your customers' primary channel"
                recommended={recommended === "whatsapp"}
                isConnected={connectedChannels.includes("whatsapp")}
                comingSoon={false}
                onConnect={(creds) => onConnectChannel("whatsapp", creds)}
                isConnecting={isConnecting}
              />
              <ChannelConnectCard
                channel="telegram"
                label="Telegram"
                description="Alternative messaging"
                recommended={recommended === "telegram"}
                isConnected={connectedChannels.includes("telegram")}
                comingSoon={false}
                onConnect={(creds) => onConnectChannel("telegram", creds)}
                isConnecting={isConnecting}
              />
              <ChannelConnectCard
                channel="webchat"
                label="Web Chat"
                description="Embed on your website"
                recommended={false}
                isConnected={false}
                comingSoon={true}
                onConnect={(creds) => onConnectChannel("webchat", creds)}
              />
            </div>
            {connectError && (
              <p className="mt-2 text-[14px]" style={{ color: "hsl(0, 70%, 50%)" }}>
                {connectError}
              </p>
            )}
          </div>

          <div className="mb-8 text-left">
            <p
              className="mb-3 text-[13px] font-medium uppercase tracking-[0.05em]"
              style={{ color: "var(--sw-text-muted)" }}
            >
              Good to have
            </p>
            <div
              className="mb-1 flex items-center justify-between text-[16px]"
              style={{ color: "var(--sw-text-primary)" }}
            >
              <span>{scenariosTested} scenarios tested</span>
              {scenariosTested > 0 && <span style={{ color: "hsl(145, 45%, 42%)" }}>✓</span>}
            </div>
            <div
              className="flex items-center justify-between text-[16px]"
              style={{ color: "var(--sw-text-primary)" }}
            >
              <span>Approval mode reviewed</span>
              {playbook.approvalMode.status === "ready" && (
                <span style={{ color: "hsl(145, 45%, 42%)" }}>✓</span>
              )}
            </div>
          </div>

          {playbookSummary && (
            <div
              className="mb-8 rounded-lg p-4 text-[14px]"
              style={{ backgroundColor: "var(--sw-surface)", color: "var(--sw-text-secondary)" }}
            >
              {playbookSummary}
            </div>
          )}

          <button
            onClick={async () => {
              setIsLaunching(true);
              try {
                await onLaunch();
                setLaunched(true);
              } catch {
                setIsLaunching(false);
              }
            }}
            disabled={!hasChannel || isLaunching}
            className="h-[52px] min-w-[200px] rounded-lg text-[16px] font-semibold transition-all duration-200"
            style={{
              backgroundColor: "var(--sw-accent)",
              color: "white",
              opacity: hasChannel && !isLaunching ? 1 : 0.35,
              cursor: hasChannel && !isLaunching ? "pointer" : "default",
            }}
          >
            {isLaunching ? "Launching..." : "Launch Alex"}
          </button>
          {!hasChannel && (
            <p className="mt-2 text-[14px]" style={{ color: "var(--sw-text-muted)" }}>
              Connect a channel to launch.
            </p>
          )}
          <div className="mt-4">
            <button
              onClick={onBack}
              className="text-[14px]"
              style={{ color: "var(--sw-text-muted)" }}
            >
              ← Back to training
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
