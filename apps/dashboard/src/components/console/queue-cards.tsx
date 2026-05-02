"use client";

import type {
  ApprovalGateCard,
  EscalationCard,
  QueueCard,
  RecommendationCard,
  RichText,
} from "./console-data";

export function RichTextSpan({ value }: { value: RichText }) {
  return (
    <>
      {value.map((seg, i) => {
        if (typeof seg === "string") return <span key={i}>{seg}</span>;
        if ("bold" in seg) return <b key={i}>{seg.bold}</b>;
        return (
          <em key={i} style={{ fontStyle: "normal" }}>
            {seg.coral}
          </em>
        );
      })}
    </>
  );
}

export function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function EscalationCardView({
  card,
  onPrimary,
}: {
  card: EscalationCard;
  onPrimary: () => void;
}) {
  return (
    <article className="qcard escalation">
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
        <button className="esc-reply" type="button" onClick={onPrimary}>
          Reply inline <span className="caret">▾</span>
        </button>
        <div className="qactions">
          <button className="btn btn-primary-coral" type="button">
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

export function RecommendationCardView({ card }: { card: RecommendationCard }) {
  return (
    <article className="qcard recommendation" id={card.id}>
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
          <button className="btn btn-primary-graphite" type="button">
            {card.primary.label}
          </button>
          <button className="btn btn-ghost" type="button">
            {card.secondary.label}
          </button>
          <button className="btn btn-text" type="button">
            {card.dismiss.label}
          </button>
        </div>
      </div>
    </article>
  );
}

export function ApprovalGateCardView({
  card,
  onPrimary,
}: {
  card: ApprovalGateCard;
  onPrimary: () => void;
}) {
  return (
    <article className="qcard approval-gate">
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
        <div className="qactions">
          <button className="btn btn-primary-graphite" type="button" onClick={onPrimary}>
            {card.primary.label}
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

export function QueueCardView({
  card,
  onApprovalPrimary,
  onEscalationPrimary,
}: {
  card: QueueCard;
  onApprovalPrimary: (card: ApprovalGateCard) => void;
  onEscalationPrimary: (card: EscalationCard) => void;
}) {
  switch (card.kind) {
    case "escalation":
      return <EscalationCardView card={card} onPrimary={() => onEscalationPrimary(card)} />;
    case "recommendation":
      return <RecommendationCardView card={card} />;
    case "approval_gate":
      return <ApprovalGateCardView card={card} onPrimary={() => onApprovalPrimary(card)} />;
  }
}
