"use client";

import { useState } from "react";
import { AgentMark } from "@/components/character/agent-mark";
import { ChannelConnectCard } from "./channel-connect-card";
import { LaunchSequence } from "./launch-sequence";
import type { Playbook } from "@switchboard/schemas";

interface GoLiveProps {
  playbook: Playbook;
  onLaunch: () => void;
  onBack: () => void;
  connectedChannels: string[];
  scenariosTested: number;
}

export function GoLive({
  playbook,
  onLaunch,
  onBack,
  connectedChannels,
  scenariosTested,
}: GoLiveProps) {
  const [launched, setLaunched] = useState(false);
  const hasChannel = connectedChannels.length > 0;
  const serviceCount = playbook.services.length;
  const recommended = playbook.channels.recommended ?? "whatsapp";

  const playbookSummary = [
    `${serviceCount} service${serviceCount !== 1 ? "s" : ""}`,
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
        <LaunchSequence channel={connectedChannels[0] ?? "WhatsApp"} onComplete={() => {}} />
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
                onConnect={() => {}}
              />
              <ChannelConnectCard
                channel="telegram"
                label="Telegram"
                description="Alternative messaging"
                recommended={recommended === "telegram"}
                isConnected={connectedChannels.includes("telegram")}
                comingSoon={false}
                onConnect={() => {}}
              />
              <ChannelConnectCard
                channel="webchat"
                label="Web Chat"
                description="Embed on your website"
                recommended={false}
                isConnected={false}
                comingSoon={true}
                onConnect={() => {}}
              />
            </div>
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
            onClick={() => {
              setLaunched(true);
              onLaunch();
            }}
            disabled={!hasChannel}
            className="h-[52px] min-w-[200px] rounded-lg text-[16px] font-semibold transition-all duration-200"
            style={{
              backgroundColor: "var(--sw-accent)",
              color: "white",
              opacity: hasChannel ? 1 : 0.35,
              cursor: hasChannel ? "pointer" : "default",
            }}
          >
            Launch Alex
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
