"use client";

import { useState } from "react";
import type { ApprovalGateCard } from "../console-data";
import { useApprovalAction } from "@/hooks/use-approval-action";
import { capitalize } from "./rich-text";

interface Props {
  card: ApprovalGateCard;
  resolving: boolean;
  onResolve: () => void;
}

export function ApprovalGateCardView({ card, resolving, onResolve }: Props) {
  const { approve, reject, isPending } = useApprovalAction(card.approvalId);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      onResolve();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval action failed");
    }
  };

  return (
    <article
      id={`q-${card.id}`}
      className={`qcard approval-gate${resolving ? " is-resolving" : ""}`}
    >
      <div>
        <div className="qhead">
          <span className="who">
            <span className="type">Approval Gate</span>
            <span className="sep">·</span>
            <span className="agent">{capitalize(card.agent)}</span>
          </span>
          <span className="timer">
            <span className="stage">{card.timer.stageLabel}</span> · {card.timer.ageDisplay}
          </span>
        </div>
        <h3 className="gate-job">{card.jobName}</h3>
        <div className="gate-prog">
          <span>{card.stageProgress}</span>
          <span className="sep">·</span>
          <span>{card.stageDetail}</span>
          <span className="sep">·</span>
          <span className="countdown">{card.countdown}</span>
        </div>
        {error && (
          <p role="alert" className="qerror">
            Approval failed — {error}
          </p>
        )}
        <div className="qactions">
          <button
            className="btn btn-primary-graphite"
            type="button"
            disabled={isPending}
            onClick={() => run(() => approve(card.bindingHash))}
          >
            {card.primary.label}
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            disabled={isPending}
            onClick={() => run(() => reject(card.bindingHash))}
          >
            Reject
          </button>
        </div>
      </div>
      <div className="qside">
        <button className="stop" type="button">
          {card.stop.label}
        </button>
      </div>
    </article>
  );
}
