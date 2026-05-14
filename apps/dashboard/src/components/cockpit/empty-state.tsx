// apps/dashboard/src/components/cockpit/empty-state.tsx
"use client";

import { T } from "./tokens";
import type { MissionAggregatorResponse } from "@/lib/cockpit/mission-types";

const DEFAULT_PRICE = 89;
const DEFAULT_REFUND = 200;

const SETUP_LABEL: Record<MissionAggregatorResponse["setup"][number]["key"], string> = {
  meta: "Connect Meta Ads",
  inbox: "Connect HotPod inbox",
  cal: "Connect tour calendar",
  rules: "Review pricing & escalation",
};

export function shouldRenderEmptyState(setup: MissionAggregatorResponse["setup"]): boolean {
  if (setup.length === 0) return false;
  return setup.every((row) => !row.done);
}

type Props = {
  rules: MissionAggregatorResponse["mission"]["rules"];
  setup: MissionAggregatorResponse["setup"];
  onConnect: (key: MissionAggregatorResponse["setup"][number]["key"]) => void;
};

export function EmptyState({ rules, setup, onConnect }: Props) {
  const price = rules?.priceApprovalThreshold ?? DEFAULT_PRICE;
  const refund = rules?.refundEscalationFloor ?? DEFAULT_REFUND;
  const primary = setup.find((row) => row.primary);

  return (
    <section
      data-testid="cockpit-empty-state"
      className="my-6 flex flex-col gap-4"
      style={{ color: T.ink }}
    >
      <article
        className="rounded-lg border p-5"
        style={{ background: T.amberPaper, borderColor: T.hair }}
      >
        <header className="mb-2 text-[10px] uppercase tracking-wider" style={{ color: T.ink3 }}>
          Alex · just now
        </header>
        <p className="text-base leading-snug" style={{ color: T.ink }}>
          I'm set up and quiet. Connect Meta Ads and I'll pull the first leads in under a minute.
        </p>
        <p className="mt-2 text-base leading-snug" style={{ color: T.ink2 }}>
          Then I'll qualify, reply, and book tours under your standing rules. I'll only interrupt
          you for pricing decisions over ${price} and refunds over ${refund}.
        </p>
        {primary && (
          <div className="mt-4">
            <span
              data-testid="next-move-pill"
              className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs"
              style={{ background: T.amber, color: T.paper }}
            >
              <span className="font-semibold uppercase tracking-wider">Next move</span>
              <span>{SETUP_LABEL[primary.key]}</span>
            </span>
          </div>
        )}
      </article>

      <ul className="flex flex-col gap-2">
        {setup.map((row) => (
          <li key={row.key}>
            <button
              type="button"
              data-testid={`setup-row-${row.key}`}
              data-primary={row.primary ? "true" : "false"}
              onClick={() => onConnect(row.key)}
              className="flex w-full items-center justify-between rounded-md border px-4 py-3 text-left"
              style={{
                borderColor: row.primary ? T.amber : T.hair,
                background: row.primary ? T.amberPaper : T.paper,
                color: T.ink,
              }}
            >
              <span className="text-sm">{SETUP_LABEL[row.key]}</span>
              <span className="text-xs" style={{ color: T.ink3 }}>
                {row.done ? "done" : "todo"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
