"use client";

import { useState } from "react";
import type { RecommendationCard } from "../console-data";
import { useRecommendationAction } from "@/hooks/use-recommendation-action";
import { capitalize, RichTextSpan } from "./rich-text";

interface Props {
  card: RecommendationCard;
  resolving: boolean;
  onResolve: () => void;
}

export function RecommendationCardView({ card, resolving, onResolve }: Props) {
  const action = useRecommendationAction(card.id);
  const [error, setError] = useState<string | null>(null);

  const fire = async (kind: "primary" | "secondary" | "dismiss") => {
    setError(null);
    try {
      await action[kind]();
      onResolve();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    }
  };

  return (
    <article
      id={`q-${card.id}`}
      className={`qcard recommendation${resolving ? " is-resolving" : ""}`}
    >
      <div>
        <div className="qhead">
          <span className="who">
            <span className="type">Recommendation</span>
            <span className="sep">·</span>
            <span className="agent">{capitalize(card.agent)}</span>
          </span>
          <span className="timer">
            <span className="urgent">{card.timer.label}</span> · conf{" "}
            <span className="conf">{card.timer.confidence}</span>
          </span>
        </div>
        <h3 className="rec-action">{card.action}</h3>
        <ul className="rec-data">
          {card.dataLines.map((line, i) => (
            <li key={i}>
              <RichTextSpan value={line} />
            </li>
          ))}
        </ul>
        {error && <div className="qerror">{error}</div>}
        <div className="qactions">
          <button
            className="btn btn-primary-graphite"
            type="button"
            disabled={action.isPending}
            onClick={() => fire("primary")}
          >
            {card.primary.label}
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            disabled={action.isPending}
            onClick={() => fire("secondary")}
          >
            {card.secondary.label}
          </button>
          <button
            className="btn btn-text"
            type="button"
            disabled={action.isPending}
            onClick={() => fire("dismiss")}
          >
            {card.dismiss.label}
          </button>
        </div>
      </div>
    </article>
  );
}
