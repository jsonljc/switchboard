"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { AGENT_REGISTRY, type AgentKey } from "@switchboard/schemas";
import { useDecisionFeed } from "@/hooks/use-decision-feed";
import { useAgentGreeting } from "@/hooks/use-agent-greeting";
import { useAgentRoster, useAgentState } from "@/hooks/use-agents";
import { useAgentMetrics } from "@/hooks/use-agent-metrics";
import { useAgentActivityCockpit } from "@/hooks/use-agent-activity-cockpit";
import { useAgentMission } from "@/hooks/use-agent-mission";
import { useMiraEnabled } from "@/hooks/use-mira-enabled";
import { useGovernanceStatus } from "@/hooks/use-governance";
import type { Decision } from "@/lib/decisions/types";
import { AgentPanel } from "@/components/agent-panel/agent-panel";
import { AGENT_ROLE_FOR_KEY, type PanelAgentKey } from "@/components/agent-panel/lib/agent-display";
import { coreSetupIncomplete } from "@/components/agent-panel/lib/key-result-state";
import { Verdict } from "./verdict";
import { composeVerdict } from "./compose-verdict";
import { NeedsYou } from "./needs-you";
import { NeedsYouCard } from "./needs-you-card";
import { TeamBand } from "./team-band";
import { ThisWeek } from "./this-week";
import { WhileYouSlept } from "./while-you-slept";
import { WorkInProgress } from "./work-in-progress";
import { Permissions } from "./permissions";
import type {
  PermissionsModel,
  TeamBandAgent,
  ThisWeekModel,
  VerdictSignals,
  WhileYouSleptRow,
  WorkInProgressItem,
} from "./types";
import type { AgentActivity } from "@/components/agent-avatar/agent-status-visual";
import type { DerivedAgentStateEntry } from "@/lib/api-client-types";
import { HomeModuleBoundary } from "./home-module-boundary";
import styles from "./home.module.css";

// Returns "idle" when state is unavailable (the honest floor: a "Working" claim and the breathing animation both require a real working status; the verdict's working clause is separately gated by rosterStateAvailable).
/** Real per-agent activity. Mira (no role row) is never inferred working here. */
function statusForAgent(
  key: AgentKey,
  states: DerivedAgentStateEntry[] | undefined,
): AgentActivity {
  const role = AGENT_ROLE_FOR_KEY[key];
  if (!role) return "idle";
  return states?.find((s) => s.agentRole === role)?.activityStatus ?? "idle";
}

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

export interface HomePageProps {
  /**
   * Agent to auto-open the panel for on mount, from the `/?agent=` deep-link
   * (e.g. the retired /alex and /riley routes redirect here). null = no panel.
   */
  initialAgent?: PanelAgentKey | null;
}

export function HomePage({ initialAgent = null }: HomePageProps = {}) {
  const router = useRouter();
  const [panelAgent, setPanelAgent] = useState<PanelAgentKey | null>(initialAgent);

  const session = useSession();
  const decisionFeed = useDecisionFeed(null);
  const alexGreeting = useAgentGreeting("alex");
  const rileyGreeting = useAgentGreeting("riley");
  const roster = useAgentRoster();
  const agentState = useAgentState();
  const alexMetrics = useAgentMetrics("alex");
  const alexActivity = useAgentActivityCockpit("alex", { limit: 4 });
  const alexMission = useAgentMission("alex");
  const rileyMission = useAgentMission("riley");
  const miraEnabled = useMiraEnabled();
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

  // ── Open leads / oldest wait (alex + riley greetings; mira non-2xx ⇒ skipped) ──
  const greetingSignals = [alexGreeting.data?.signal, rileyGreeting.data?.signal].filter(
    (s): s is NonNullable<typeof s> => Boolean(s),
  );
  const openLeadCount = greetingSignals.reduce((sum, s) => sum + (s.inboxCount ?? 0), 0);
  const oldestHours = greetingSignals
    .map((s) => s.oldestOpenItemAgeHours)
    .filter((h): h is number => typeof h === "number");
  // Signal is in HOURS — convert to minutes so the "min" copy is honest.
  const oldestWaitMin = oldestHours.length > 0 ? Math.round(Math.max(...oldestHours) * 60) : null;

  // ── Team Band (canonical alex/riley/mira from the registry) ────────────────
  // Presence (`setUp`) reflects REAL per-agent enablement: alex/riley derive it
  // from mission core-completion (e.g. inbox / Meta connected), so an org that
  // hasn't connected an agent's core channel sees it honestly "Not set up" —
  // not the old static launchTier flag. Mira uses useMiraEnabled (probe the
  // gated mission endpoint: 2xx ⇒ enabled, non-2xx ⇒ not enabled). When a mission hook is
  // loading or errored, fall back to launchTier rather than flipping to a
  // transient "Not set up".
  // Working status is attributed PER AGENT via the legacy state rows (keyed by
  // agentRole — alex=responder, riley=optimizer). Mira has no role row, so it is
  // never inferred working from this endpoint. The TeamBand renders "Asleep" on
  // halt; here we keep the raw per-agent status and let the band + the
  // working-count clause below apply the halt gate.
  const rosterStateAvailable =
    (!roster.isError && roster.data !== undefined) ||
    (!agentState.isError && agentState.data !== undefined);

  const teamBandAgents: TeamBandAgent[] = (Object.keys(AGENT_REGISTRY) as AgentKey[]).map((key) => {
    const entry = AGENT_REGISTRY[key];
    let setUp: boolean;
    let setupLoading = false;
    if (key === "alex" && alexMission.data) {
      setUp = !coreSetupIncomplete(alexMission.data, "alex");
    } else if (key === "riley" && rileyMission.data) {
      setUp = !coreSetupIncomplete(rileyMission.data, "riley");
    } else if (key === "mira") {
      setUp = miraEnabled.enabled === true;
      setupLoading = miraEnabled.enabled === undefined; // probe unresolved: never flash "Not set up"
    } else {
      setUp = entry.launchTier === "day-one";
    }
    return {
      key,
      name: entry.displayName,
      setUp,
      setupLoading,
      status: statusForAgent(key, agentState.data?.states),
      halted: isHalted,
    };
  });
  const setUpCount = teamBandAgents.filter((a) => a.setUp).length;
  const workingCount = teamBandAgents.filter(
    (a) => a.setUp && !a.halted && (a.status === "working" || a.status === "analyzing"),
  ).length;

  // ── Verdict signals (honest; fallback when core signals are unavailable) ───
  // The verdict shape (active/calm/fallback) depends ONLY on the decision feed.
  // The working-count clause in the proof line depends on roster/state — when
  // those are down, the clause is simply omitted (workingCount/setUpCount left
  // undefined) so the verdict shape is not dragged to fallback by a roster blip.
  const verdictUnavailable = !decisionFeedAvailable;
  const verdictSignals: VerdictSignals = {
    decisionCount,
    openLeadCount,
    oldestWaitMin,
    workingCount: rosterStateAvailable ? workingCount : undefined,
    setUpCount: rosterStateAvailable ? setUpCount : undefined,
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
  // Only enter CALM layout when the feed is live AND reports zero decisions.
  // A feed-error state also yields decisionCount=0 — do NOT show the all-clear
  // CALM promotion in that case; fall through to the ACTIVE layout where
  // NeedsYou renders null (empty decisions = nothing shown).
  const isCalm = decisionFeedAvailable && decisionCount === 0;

  const verdictNode = (
    <HomeModuleBoundary key="verdict">
      <Verdict model={verdict} />
    </HomeModuleBoundary>
  );
  const needsYouNode = (
    <HomeModuleBoundary key="needs-you">
      <NeedsYou
        decisions={decisions}
        renderItem={(decision, index) => <NeedsYouCard decision={decision} index={index} />}
      />
    </HomeModuleBoundary>
  );
  const teamBandNode = (
    <HomeModuleBoundary key="team-band">
      <TeamBand agents={teamBandAgents} onOpenAgent={setPanelAgent} />
    </HomeModuleBoundary>
  );
  const thisWeekNode = (
    <HomeModuleBoundary key="this-week">
      <ThisWeek model={thisWeek} />
    </HomeModuleBoundary>
  );
  const whileYouSleptNode = (
    <HomeModuleBoundary key="while-you-slept">
      <WhileYouSlept rows={whileYouSleptRows} />
    </HomeModuleBoundary>
  );
  const workInProgressNode = (
    <HomeModuleBoundary key="work-in-progress">
      <WorkInProgress items={workInProgressItems} />
    </HomeModuleBoundary>
  );
  const permissionsNode = (
    <HomeModuleBoundary key="permissions">
      <Permissions model={permissions} />
    </HomeModuleBoundary>
  );

  // ACTIVE: Verdict → NeedsYou → TeamBand → ThisWeek → WhileYouSlept → WIP → Permissions
  // CALM:   Verdict → ThisWeek (promoted) → TeamBand → WhileYouSlept → WIP → Permissions
  //         (NeedsYou is not rendered when empty)
  const modules = isCalm
    ? [
        verdictNode,
        thisWeekNode,
        teamBandNode,
        whileYouSleptNode,
        workInProgressNode,
        permissionsNode,
      ]
    : [
        verdictNode,
        needsYouNode,
        teamBandNode,
        thisWeekNode,
        whileYouSleptNode,
        workInProgressNode,
        permissionsNode,
      ];

  // Bento split (desktop only — display:contents below lg keeps the flat mobile order):
  // hero = verdict (modules[0]); main = next N "active" modules; rail = the quiet remainder.
  const [heroNode, ...restNodes] = modules;
  const mainCount = isCalm ? 2 : 3; // active: NeedsYou, TeamBand, ThisWeek · calm: ThisWeek, TeamBand
  const mainNodes = restNodes.slice(0, mainCount);
  const railNodes = restNodes.slice(mainCount);

  return (
    <>
      <div className={styles.column}>
        {heroNode}
        <div className={styles.bento}>
          <div className={styles.bentoMain}>{mainNodes}</div>
          <div className={styles.bentoRail}>{railNodes}</div>
        </div>
      </div>
      {panelAgent && (
        <AgentPanel
          key={panelAgent}
          agentKey={panelAgent}
          open
          onOpenChange={(o) => {
            if (!o) setPanelAgent(null);
          }}
          onSeeAll={() => router.push("/results")}
          // TODO: deep-link to the decision-detail sheet when the Inbox detail workstream lands (open the specific decision via sourceRef).
          onOpenDecision={() => router.push("/inbox")}
          onActivate={() => router.push("/settings/channels")}
        />
      )}
    </>
  );
}
