// apps/dashboard/src/components/cockpit/mission-popover.tsx
"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { T } from "./tokens";
import { Dot } from "./dot";
import type {
  MissionAggregatorResponse,
  MissionChannel,
  MissionChannelStatus,
} from "@/lib/cockpit/mission-types";

const STATUS_TO_LABEL: Record<MissionChannelStatus, string> = {
  ok: "connected",
  warn: "degraded",
  off: "not connected",
};

const STATUS_TO_COLOR: Record<MissionChannelStatus, string> = {
  ok: T.green,
  warn: T.amber,
  off: T.ink5,
};

type Props = {
  open: boolean;
  onClose: () => void;
  mission: MissionAggregatorResponse["mission"];
  agentLabel?: string;
};

export function MissionPopover({ open, onClose, mission, agentLabel = "Alex" }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onMouseDown(e: MouseEvent) {
      if (!containerRef.current) return;
      if (e.target instanceof Node && !containerRef.current.contains(e.target)) {
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const rulesCopy =
    mission.rules !== null
      ? `Pricing approvals over $${mission.rules.priceApprovalThreshold} · refunds over $${mission.rules.refundEscalationFloor}`
      : null;

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label={`${agentLabel} mission`}
      className="absolute z-30 mt-2 w-[min(420px,calc(100vw-2rem))] rounded-lg border shadow-lg"
      style={{ background: T.paper, borderColor: T.hair, color: T.ink }}
    >
      <div className="divide-y" style={{ borderColor: T.hair }}>
        <MissionRow eyebrow="ROLE" value={mission.role} />
        <MissionRow eyebrow="PIPELINE" value={mission.pipeline} />
        <MissionRow eyebrow="BRAND" value={mission.brand} />
        <ChannelsRow channels={mission.channels} />
        {rulesCopy ? <MissionRow eyebrow="RULES" value={rulesCopy} /> : null}
      </div>
      <div
        className="flex items-center justify-end p-3 text-sm"
        style={{ borderTop: `1px solid ${T.hair}` }}
      >
        <Link
          href="/settings"
          className="rounded px-2 py-1 underline-offset-2 hover:underline"
          style={{ color: T.amberDeep }}
        >
          Edit configuration
        </Link>
      </div>
    </div>
  );
}

function MissionRow({ eyebrow, value }: { eyebrow: string; value: string }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 px-4 py-3">
      <div
        data-eyebrow={eyebrow}
        className="text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: T.ink3 }}
      >
        {eyebrow}
      </div>
      <div className="text-sm" style={{ color: T.ink }}>
        {value}
      </div>
    </div>
  );
}

function ChannelsRow({ channels }: { channels: MissionChannel[] }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 px-4 py-3">
      <div
        data-eyebrow="CHANNELS"
        className="text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: T.ink3 }}
      >
        CHANNELS
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        {channels.map((channel) => (
          <li key={channel.kind} className="flex items-center gap-2">
            <Dot
              color={STATUS_TO_COLOR[channel.status]}
              size={8}
              aria-label={`${channel.label}: ${STATUS_TO_LABEL[channel.status]}`}
            />
            <span style={{ color: T.ink }}>{channel.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
