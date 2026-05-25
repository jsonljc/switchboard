"use client";

import { useSession } from "next-auth/react";
import { AGENT_REGISTRY, type AgentKey } from "@switchboard/schemas";
import { useDecisionFeed } from "@/hooks/use-decision-feed";
import { useAgentGreeting } from "@/hooks/use-agent-greeting";
import { useAgentRoster, useAgentState } from "@/hooks/use-agents";
import { useAgentMetrics } from "@/hooks/use-agent-metrics";
import { useAgentActivityCockpit } from "@/hooks/use-agent-activity-cockpit";
import { useAgentMission } from "@/hooks/use-agent-mission";
import { useGovernanceStatus } from "@/hooks/use-governance";
import type { Decision } from "@/lib/decisions/types";
import { Verdict } from "./verdict";
import { composeVerdict } from "./compose-verdict";
import { NeedsYou } from "./needs-you";
import { NeedsYouCard } from "./needs-you-card";
import { TeamPulse } from "./team-pulse";
import { ThisWeek } from "./this-week";
import { WhileYouSlept } from "./while-you-slept";
import { WorkInProgress } from "./work-in-progress";
import { Permissions } from "./permissions";
import type {
  PermissionsModel,
  TeamPulseAgent,
  ThisWeekModel,
  VerdictSignals,
  WhileYouSleptRow,
  WorkInProgressItem,
} from "./types";
import styles from "./home.module.css";

// Working statuses, per lib/agent-status.ts. An agent is only "working" with
// positive evidence (and never while the org is halted).
const WORKING_STATUSES = new Set(["working", "analyzing"]);

/** First name only — the verdict salutation is warm, not formal. */
function firstName(full: string | null | undefined): string | undefined {
  if (!full) return undefined;
  const trimmed = full.trim();
  if (!trimmed) return undefined;
  return trimmed.split(/\s+/)[0];
}

/** cents → "$NN" (whole dollars). null/0-leads inputs yield undefined. */
function centsPerLeadToDisplay(spendCents: number | null, leads: number): string | undefined {
  if (spendCents === null || leads <= 0) return undefined;
  const perLead = Math.round(spendCents / leads / 100);
  return `$${perLead}`;
}

export function HomePage() {
  const session = useSession();
  const decisionFeed = useDecisionFeed(null);
  const alexGreeting = useAgentGreeting("alex");
  const rileyGreeting = useAgentGreeting("riley");
  const roster = useAgentRoster();
  const agentState = useAgentState();
  const alexMetrics = useAgentMetrics("alex");
  const alexActivity = useAgentActivityCockpit("alex");
  const alexMission = useAgentMission("alex");
  const governance = useGovernanceStatus();

  // ── Halt state (a halted/paused agent is NEVER "working") ──────────────────
  const isHalted = Boolean(governance.data?.haltedAt);

  // ── Decisions (drives composition order + Verdict) ─────────────────────────
  const decisions: Decision[] = decisionFeed.data?.decisions ?? [];
  const decisionCount = decisionFeed.data?.counts?.total ?? decisions.length;
  const decisionFeedAvailable = !decisionFeed.isError && decisionFeed.data !== undefined;
  const topDecision = decisions[0];
  const topAgentKey = topDecision?.agentKey;
  const topAgentName = topAgentKey ? AGENT_REGISTRY[topAgentKey]?.displayName : undefined;

  // ── Open leads / oldest wait (alex + riley greetings; mira 404s) ───────────
  const greetingSignals = [alexGreeting.data?.signal, rileyGreeting.data?.signal].filter(
    (s): s is NonNullable<typeof s> => Boolean(s),
  );
  const openLeadCount = greetingSignals.reduce((sum, s) => sum + (s.inboxCount ?? 0), 0);
  const oldestHours = greetingSignals
    .map((s) => s.oldestOpenItemAgeHours)
    .filter((h): h is number => typeof h === "number");
  // Signal is in HOURS — convert to minutes so the "min" copy is honest.
  const oldestWaitMin = oldestHours.length > 0 ? Math.round(Math.max(...oldestHours) * 60) : null;

  // ── Team Pulse (canonical alex/riley/mira from the registry) ───────────────
  // The roster endpoint returns a legacy seed (Ava/Monitor/...) whose roles do
  // not map to canonical agent keys, so presence is keyed off the registry's
  // launchTier (day-one = set up; day-thirty = Mira, honestly "not set up").
  // Working status needs positive evidence we can attribute to a canonical
  // agent; the legacy state rows give none, so chips stay idle (never a
  // fabricated "working") and any halt forces idle.
  const rosterStateAvailable =
    (!roster.isError && roster.data !== undefined) ||
    (!agentState.isError && agentState.data !== undefined);
  const hasWorkingState =
    !isHalted &&
    Boolean(agentState.data?.states?.some((s) => WORKING_STATUSES.has(s.activityStatus)));

  const teamPulseAgents: TeamPulseAgent[] = (Object.keys(AGENT_REGISTRY) as AgentKey[]).map(
    (key) => {
      const entry = AGENT_REGISTRY[key];
      const setUp = entry.launchTier === "day-one";
      return {
        key,
        name: entry.displayName,
        status: setUp && hasWorkingState ? "working" : "idle",
        setUp,
      };
    },
  );
  const setUpCount = teamPulseAgents.filter((a) => a.setUp).length;
  const workingCount = teamPulseAgents.filter((a) => a.status === "working").length;

  // ── Verdict signals (honest; fallback when core signals are unavailable) ───
  // The proof line always prints "N of M working" + open leads, so the verdict
  // can only render honestly when BOTH the decision feed AND the roster/state
  // that back those numbers are available; otherwise we show the fallback.
  const verdictUnavailable = !decisionFeedAvailable || !rosterStateAvailable;
  const verdictSignals: VerdictSignals = {
    decisionCount,
    openLeadCount,
    oldestWaitMin,
    workingCount,
    setUpCount,
    ownerName: firstName(session.data?.user?.name),
    topAgentName,
    topAgentKey,
    unavailable: verdictUnavailable,
  };
  const verdict = composeVerdict(verdictSignals);

  // ── This Week (Alex metrics; undefined → skeleton, never fabricated) ───────
  let thisWeek: ThisWeekModel | undefined;
  if (!alexMetrics.isError && alexMetrics.data) {
    const m = alexMetrics.data;
    thisWeek = {
      authorName: AGENT_REGISTRY.alex.displayName,
      authorKey: "alex",
      // Alex's hero is the booked-consultations count.
      bookedConsults: typeof m.hero?.value === "number" ? m.hero.value : undefined,
      newLeads: typeof m.leads === "number" ? m.leads : undefined,
      // No honest reply-time field exists on the metrics wire — leave it unset
      // rather than invent one. Cost per lead is derived from real spend/leads.
      costPerLead: centsPerLeadToDisplay(m.spendCents, m.leads),
      reportHref: "/results",
    };
  }

  // ── While You Slept (Alex activity rows; empty if none) ────────────────────
  // ActivityRow has no agentKey; rows come from Alex's feed, so attribute to alex.
  const whileYouSleptRows: WhileYouSleptRow[] =
    !alexActivity.isError && alexActivity.data
      ? alexActivity.data.rows.map((row) => ({
          agentKey: "alex" as AgentKey,
          time: row.time,
          text: row.head,
        }))
      : [];

  // ── Work in Progress: no real typed-handoff trace source in P1-A, so chain is
  // never synthesized. We have no honest WIP source yet → empty list. ─────────
  const workInProgressItems: WorkInProgressItem[] = [];

  // ── Permissions (Alex mission rules/role → conservative plain English) ─────
  let permissions: PermissionsModel | undefined;
  if (!alexMission.isError && alexMission.data) {
    const rules = alexMission.data.mission.rules;
    const summary = rules
      ? `${AGENT_REGISTRY.alex.displayName} asks before any price over $${rules.priceApprovalThreshold} or a refund over $${rules.refundEscalationFloor}.`
      : // Conservative TRUE default — no fabricated dollar limits.
        "Your team checks with you before anything that spends money or messages a client.";
    permissions = { summary, adjustHref: "/settings" };
  } else {
    // Mission unavailable → conservative true default (still no specific limits).
    permissions = {
      summary: "Your team checks with you before anything that spends money or messages a client.",
      adjustHref: "/settings",
    };
  }

  // ── Composition (LOAD-BEARING ordering) ────────────────────────────────────
  const isCalm = decisionCount === 0;

  const verdictNode = <Verdict key="verdict" model={verdict} />;
  const needsYouNode = (
    <NeedsYou
      key="needs-you"
      decisions={decisions}
      renderItem={(decision, index) => <NeedsYouCard decision={decision} index={index} />}
    />
  );
  const teamPulseNode = <TeamPulse key="team-pulse" agents={teamPulseAgents} />;
  const thisWeekNode = <ThisWeek key="this-week" model={thisWeek} />;
  const whileYouSleptNode = <WhileYouSlept key="while-you-slept" rows={whileYouSleptRows} />;
  const workInProgressNode = <WorkInProgress key="work-in-progress" items={workInProgressItems} />;
  const permissionsNode = <Permissions key="permissions" model={permissions} />;

  // ACTIVE: Verdict → NeedsYou → TeamPulse → ThisWeek → WhileYouSlept → WIP → Permissions
  // CALM:   Verdict → ThisWeek (promoted) → TeamPulse → WhileYouSlept → WIP → Permissions
  //         (NeedsYou is not rendered when empty)
  const modules = isCalm
    ? [
        verdictNode,
        thisWeekNode,
        teamPulseNode,
        whileYouSleptNode,
        workInProgressNode,
        permissionsNode,
      ]
    : [
        verdictNode,
        needsYouNode,
        teamPulseNode,
        thisWeekNode,
        whileYouSleptNode,
        workInProgressNode,
        permissionsNode,
      ];

  return <div className={styles.column}>{modules}</div>;
}
