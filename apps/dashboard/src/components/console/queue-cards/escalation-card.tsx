"use client";

import { useState } from "react";
import type { EscalationCard } from "../console-data";
import { capitalize, RichTextSpan } from "./rich-text";
import { TranscriptPanel } from "./transcript-panel";
import { ReplyForm } from "./reply-form";

interface Props {
  card: EscalationCard;
  resolving: boolean;
  onResolve: () => void;
}

export function EscalationCardView({ card, resolving, onResolve }: Props) {
  const [expanded, setExpanded] = useState(false);

  // Primary label is "Reply" (per console-mappers.ts) — there is no default
  // templated message. Both the caret toggle and the primary button just
  // expand the panel; the actual send happens via <ReplyForm>'s Send button
  // after the operator types a message.
  const expand = () => setExpanded(true);

  return (
    <article id={`q-${card.id}`} className={`qcard escalation${resolving ? " is-resolving" : ""}`}>
      <div>
        <div className="qhead">
          <span className="who">
            <span className="type">Escalation</span>
            <span className="sep">·</span>
            <span className="agent">{capitalize(card.agent)}</span>
          </span>
          <span className="timer">
            <span className="urgent">{card.timer.label}</span> · {card.timer.ageDisplay}
          </span>
        </div>
        <h3 className="esc-name">{card.contactName}</h3>
        <div className="esc-channel">{card.channel}</div>
        <p className="esc-issue">
          <RichTextSpan value={card.issue} />
        </p>
        <button
          className={`esc-reply${expanded ? " is-open" : ""}`}
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          Reply inline <span className="caret">▾</span>
        </button>
        {expanded && (
          <div className="esc-panel">
            <TranscriptPanel escalationId={card.escalationId} />
            <ReplyForm
              escalationId={card.escalationId}
              channelName={card.channel}
              onSent={onResolve}
            />
          </div>
        )}
        <div className="qactions">
          <button className="btn btn-primary-coral" type="button" onClick={expand}>
            {card.primary.label}
          </button>
          <button className="btn btn-ghost" type="button">
            {card.secondary.label}
          </button>
          <button className="btn btn-text" type="button">
            {card.selfHandle.label}
          </button>
        </div>
      </div>
    </article>
  );
}
