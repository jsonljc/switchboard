"use client";

import { DecisionCard } from "@/components/decisions/decision-card";
import { mapToDecisionCard } from "@/lib/decisions/map-to-decision-card";
import type { Decision } from "@/lib/decisions/types";

/**
 * Fixtures translated from `~/.claude/design-bundles/alex-home-design/.../alex-home.jsx`
 * (the `decisions = [...]` array around line 229). Each entry is shaped as a
 * Decision so the preview also exercises the mapToDecisionCard bridge.
 */
const NOW = Date.now();

const fixtures: Array<{ decision: Decision; why: string }> = [
  {
    decision: {
      id: "approval:rec-maya",
      kind: "approval",
      agentKey: "alex",
      humanSummary:
        "Should I send Maya the membership comparison she asked for? She wants to see the 6-month vs annual breakdown before Saturday's tour.",
      presentation: {
        primaryLabel: "Yes, send it",
        secondaryLabel: "Not yet",
        dismissLabel: "Dismiss",
        dataLines: [],
      },
      urgencyScore: 78,
      createdAt: new Date(NOW - 2 * 24 * 3_600_000).toISOString(),
      threadHref: "#thread-maya",
      sourceRef: { kind: "approval", sourceId: "rec-maya" },
      meta: { contactName: "Maya R." },
    },
    why: "Maya opened the pricing page three times this week and asked specifically. The comparison is exactly what closes this kind of lead.",
  },
  {
    decision: {
      id: "approval:rec-jordan",
      kind: "approval",
      agentKey: "alex",
      humanSummary:
        "Jordan asked about pricing for a 6-month plan. I drafted a reply quoting your standard rate plus the founding-member discount.",
      presentation: {
        primaryLabel: "Approve",
        secondaryLabel: "Edit reply",
        dismissLabel: "Dismiss",
        dataLines: [],
      },
      urgencyScore: 60,
      createdAt: new Date(NOW - 4 * 3_600_000).toISOString(),
      threadHref: "#thread-jordan",
      sourceRef: { kind: "approval", sourceId: "rec-jordan" },
      meta: { contactName: "Jordan F." },
    },
    why: "Jordan mentioned the founding-member tier in his intake form. Quoting it now matches what you promised at sign-up.",
  },
  {
    decision: {
      id: "handoff:h-priya",
      kind: "handoff",
      agentKey: "alex",
      humanSummary:
        "Priya wants to talk to a human about an injury question — shoulder rehab, not in our standard scope. Should I take this one or pass it to you?",
      presentation: {
        primaryLabel: "Take this one",
        secondaryLabel: "Send to me later",
        dismissLabel: "Dismiss",
        dataLines: [],
      },
      urgencyScore: 88,
      createdAt: new Date(NOW - 6 * 3_600_000).toISOString(),
      threadHref: "#thread-priya",
      sourceRef: { kind: "handoff", sourceId: "h-priya" },
      meta: {
        contactName: "Priya M.",
        slaDeadlineAt: new Date(NOW + 4 * 3_600_000).toISOString(),
        riskLevel: "medium",
      },
    },
    why: "Injury questions are above my certification threshold. You usually want to handle these personally — but it's end of week, so I asked.",
  },
];

export default function DecisionsPreviewPage() {
  return (
    <main
      style={{
        maxWidth: 640,
        margin: "0 auto",
        padding: "48px 24px 96px",
        display: "flex",
        flexDirection: "column",
        gap: 24,
      }}
    >
      <aside
        style={{
          fontFamily: "var(--mono)",
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--ink-3)",
          border: "1px dashed var(--hairline)",
          padding: "12px 14px",
          borderRadius: 6,
        }}
      >
        Preview — DecisionCard component, fixtures from alex-home.jsx. Delete this route once the
        agent home page lands.
      </aside>

      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 16,
          fontFamily: "var(--mono)",
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "hsl(20 10% 12% / 0.55)",
          paddingBottom: 14,
          borderBottom: "1px solid var(--hairline)",
        }}
      >
        <span>Needs you</span>
        <span>{fixtures.length} items</span>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {fixtures.map(({ decision, why }, index) => {
          const props = mapToDecisionCard(decision, index);
          return (
            <DecisionCard
              key={decision.id}
              {...props}
              why={why}
              onPrimary={() => console.warn(`primary:${decision.id}`)}
              onSecondary={() => console.warn(`secondary:${decision.id}`)}
              onDismiss={() => console.warn(`dismiss:${decision.id}`)}
            />
          );
        })}
      </div>
    </main>
  );
}
