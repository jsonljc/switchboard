"use client";

import "./console.css";
import Link from "next/link";
import { useState } from "react";
import { ApprovalSlideOver } from "./slide-overs/approval-slide-over";
import { EscalationSlideOver } from "./slide-overs/escalation-slide-over";
import type {
  ApprovalGateCard,
  ConsoleData,
  EscalationCard,
  QueueCard,
  RecommendationCard,
  RichText,
} from "./console-data";

function RichTextSpan({ value }: { value: RichText }) {
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

function EscalationCardView({ card, onPrimary }: { card: EscalationCard; onPrimary: () => void }) {
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

function RecommendationCardView({ card }: { card: RecommendationCard }) {
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

function ApprovalGateCardView({
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

function QueueCardView({
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

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function ConsoleView({ data }: { data: ConsoleData }) {
  const { opStrip, numbers, queueLabel, queue, agents, novaPanel, activity } = data;
  const [slideOver, setSlideOver] = useState<
    | { kind: "approval"; approvalId: string; bindingHash: string }
    | { kind: "escalation"; escalationId: string }
    | null
  >(null);

  return (
    <div data-v6-console>
      {/* ZONE 1 — Operating strip */}
      <header className="opstrip">
        <div className="opstrip-row">
          <div className="op-left">
            <span className="brand">Switchboard</span>
            <span className="sep">·</span>
            <span className="org">{opStrip.orgName}</span>
            <span className="sep">·</span>
            <span>{opStrip.now}</span>
          </div>
          <div className="op-right">
            <span className="op-live">
              <span className="pulse" aria-hidden="true" />
              {opStrip.dispatch === "live" ? "Live" : "Halted"}
            </span>
          </div>
        </div>
      </header>

      <main className="console-main">
        {/* ZONE 1.5 — Numbers strip */}
        <section aria-label="At-a-glance numbers" className="numbers">
          {numbers.cells.map((cell) => (
            <div
              key={cell.label}
              className={`num-cell${cell.tone ? ` tone-${cell.tone}` : ""}${cell.placeholder ? " placeholder" : ""}`}
            >
              <span className="n-label">{cell.label}</span>
              <span className="n-value">{cell.value}</span>
              <span className="n-delta">
                <RichTextSpan value={cell.delta} />
              </span>
            </div>
          ))}
        </section>

        {/* ZONE 2 — Queue */}
        <section aria-label="Queue">
          <div className="queue-head">
            <Link className="label" href="/escalations">
              Queue
            </Link>
            <span className="count">{queueLabel.count}</span>
          </div>
          <div className="queue">
            {queue.map((card) => (
              <QueueCardView
                key={card.id}
                card={card}
                onApprovalPrimary={(c) =>
                  setSlideOver({
                    kind: "approval",
                    approvalId: c.approvalId,
                    bindingHash: c.bindingHash,
                  })
                }
                onEscalationPrimary={(c) =>
                  setSlideOver({
                    kind: "escalation",
                    escalationId: c.escalationId,
                  })
                }
              />
            ))}
          </div>
        </section>

        {/* ZONE 3 — Agents strip + expanded panel */}
        <section className="zone3" aria-label="Agents">
          <div className="zone-head">
            <span className="label">Agents</span>
          </div>

          <div className="agent-strip">
            {agents.map((a) => (
              <button
                key={a.key}
                className={`agent-col${a.active ? " active" : ""}`}
                type="button"
                aria-pressed={a.active ? "true" : undefined}
                aria-label={a.active ? `${a.name} panel open` : `Open ${a.name} panel`}
              >
                <span className="a-name">{a.name}</span>
                <span className="a-stat">{a.primaryStat}</span>
                <span className="a-sub">
                  <RichTextSpan value={a.subStat} />
                  {a.pendingDot && <span className="pending-dot" aria-hidden="true" />}
                </span>
                <Link
                  className="a-view"
                  href={a.viewLink.href}
                  onClick={(e) => e.stopPropagation()}
                >
                  {a.viewLink.label}
                </Link>
              </button>
            ))}
          </div>

          {/* Expanded Nova panel */}
          <div className="panel">
            <div className="panel-head">
              <span>
                <span className="label">Nova</span> <span className="sep">·</span> Ad actions
              </span>
              <span className="meta">
                <b>{novaPanel.spendDisplay}</b> spent today <span className="sep">·</span>{" "}
                <b>{novaPanel.draftsPending}</b> drafts pending
              </span>
            </div>

            <table className="adset">
              <thead>
                <tr>
                  <th>Ad set</th>
                  <th className="num">Spend</th>
                  <th className="num">CTR</th>
                  <th className="center">7-day</th>
                  <th>Recommended</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {novaPanel.rows.map((row) => (
                  <tr key={row.id} className={row.pausePending ? "pause-pending" : undefined}>
                    <td>{row.name}</td>
                    <td className="num mono">{row.spend}</td>
                    <td className="num mono">{row.ctr}</td>
                    <td
                      className={`spark ${row.sparkDirection === "flat" ? "" : row.sparkDirection}`}
                    >
                      {row.spark}
                    </td>
                    <td className="action">{row.recommended}</td>
                    <td className="status">{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {novaPanel.draftNote && (
              <a className="panel-note" href={novaPanel.draftNote.queueAnchor}>
                <span className="msg">
                  <em>{novaPanel.draftNote.actionLabel}</em> on{" "}
                  <b>{novaPanel.draftNote.adSetName}</b> — approve in queue above ↑
                </span>
                <span className="anchor">go to queue</span>
              </a>
            )}

            <div className="panel-foot">
              <span className="stats">
                <span>
                  <b>{novaPanel.spendDisplay}</b> spent
                </span>
                <span className="sep">·</span>
                <span>
                  conf <b>{novaPanel.confidenceDisplay}</b>
                </span>
                <span className="sep">·</span>
                <span>
                  <b>{novaPanel.setsTracked}</b> sets tracked
                </span>
              </span>
              <a className="pill-graphite" href={novaPanel.fullViewHref}>
                View full ad actions →
              </a>
            </div>
          </div>
        </section>

        {/* ZONE 4 — Activity trail */}
        <section className="zone4" aria-label="Activity">
          <div className="zone-head">
            <span className="label">Activity</span>
            <span>+{activity.moreToday} more today ↓</span>
          </div>

          <div className="activity" tabIndex={0}>
            {activity.rows.map((row) => (
              <div className="act-row" key={row.id}>
                <span className="act-time">{row.time}</span>
                <span className="act-agent">{capitalize(row.agent)}</span>
                <span className="act-msg">
                  <RichTextSpan value={row.message} />
                </span>
                {row.cta ? (
                  <a className="act-cta" href={row.cta.href}>
                    {row.cta.label}
                  </a>
                ) : (
                  <Link className="act-arrow" href="/conversations">
                    →
                  </Link>
                )}
              </div>
            ))}
          </div>
        </section>
      </main>

      {slideOver?.kind === "approval" && (
        <ApprovalSlideOver
          approvalId={slideOver.approvalId}
          bindingHash={slideOver.bindingHash}
          open
          onOpenChange={(open) => {
            if (!open) setSlideOver(null);
          }}
        />
      )}

      {slideOver?.kind === "escalation" && (
        <EscalationSlideOver
          escalationId={slideOver.escalationId}
          open
          onOpenChange={(open) => {
            if (!open) setSlideOver(null);
          }}
        />
      )}
    </div>
  );
}
