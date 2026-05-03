"use client";

import type { RecommendationCard } from "../console-data";
import { useToast } from "../use-toast";
import { capitalize, RichTextSpan } from "./rich-text";

interface Props {
  card: RecommendationCard;
  resolving: boolean;
  onResolve: () => void;
}

export function RecommendationCardView({ card, resolving, onResolve }: Props) {
  const { showToast } = useToast();

  // Visual-only until recommendation backend lands —
  // see docs/superpowers/specs/2026-05-03-console-frame-phase-2-design.md
  // (no API mutation; card reappears on next refetch).
  // Title uses the label as-is (title-case from the mapper) to match the
  // Halt toast convention (`Halted` / `Resumed`) and avoid a stylistic clash.
  const fire = (label: string, detail: string) => {
    showToast({ title: label, detail, undoable: false });
    onResolve();
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
        <div className="qactions">
          <button
            className="btn btn-primary-graphite"
            type="button"
            onClick={() => fire(card.primary.label, card.action)}
          >
            {card.primary.label}
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => fire(card.secondary.label, card.action)}
          >
            {card.secondary.label}
          </button>
          <button
            className="btn btn-text"
            type="button"
            onClick={() => fire(card.dismiss.label, card.action)}
          >
            {card.dismiss.label}
          </button>
        </div>
      </div>
    </article>
  );
}
