/**
 * CRM Activity Cadence Advisor — identifies contacts with no recent activity
 * and overdue follow-ups.
 */

import type { CrmContact, CrmActivity } from "../providers/crm-provider.js";

export interface ActivityCadenceInput {
  contacts: CrmContact[];
  activities: CrmActivity[];
  organizationId: string;
}

export interface ActivityCadenceFinding {
  type: "dormant_contacts" | "overdue_followups" | "activity_decline" | "unengaged_leads";
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  metric?: number;
  affectedContactIds: string[];
  recommendation: string;
}

export class ActivityCadenceAdvisor {
  private dormantThresholdDays: number;
  private followupThresholdDays: number;

  constructor(config?: {
    dormantThresholdDays?: number;
    followupThresholdDays?: number;
  }) {
    this.dormantThresholdDays = config?.dormantThresholdDays ?? 30;
    this.followupThresholdDays = config?.followupThresholdDays ?? 7;
  }

  analyze(input: ActivityCadenceInput): ActivityCadenceFinding[] {
    const findings: ActivityCadenceFinding[] = [];
    const activeContacts = input.contacts.filter((c) => c.status === "active");

    if (activeContacts.length === 0) return findings;

    // Build last-activity-per-contact map
    const lastActivityMap = new Map<string, { timestamp: number; type: string }>();
    for (const activity of input.activities) {
      for (const contactId of activity.contactIds) {
        const activityTime = new Date(activity.createdAt).getTime();
        const current = lastActivityMap.get(contactId);
        if (!current || activityTime > current.timestamp) {
          lastActivityMap.set(contactId, {
            timestamp: activityTime,
            type: activity.type,
          });
        }
      }
    }

    const now = Date.now();
    const dormantMs = this.dormantThresholdDays * 24 * 60 * 60 * 1000;
    const followupMs = this.followupThresholdDays * 24 * 60 * 60 * 1000;

    // 1. Dormant contacts — no activity in dormantThresholdDays
    const dormantContacts = activeContacts.filter((contact) => {
      const last = lastActivityMap.get(contact.id);
      if (!last) return true; // Never had activity
      return now - last.timestamp > dormantMs;
    });

    if (dormantContacts.length > 0) {
      const pct = (dormantContacts.length / activeContacts.length) * 100;
      findings.push({
        type: "dormant_contacts",
        severity: pct > 50 ? "critical" : "warning",
        title: `${dormantContacts.length} Dormant Contact${dormantContacts.length > 1 ? "s" : ""}`,
        description: `${dormantContacts.length} of ${activeContacts.length} active contacts (${pct.toFixed(0)}%) have had no activity in ${this.dormantThresholdDays}+ days.`,
        metric: dormantContacts.length,
        affectedContactIds: dormantContacts.map((c) => c.id),
        recommendation: `Launch a re-engagement campaign or archive truly inactive contacts. Top dormant: ${dormantContacts
          .slice(0, 3)
          .map((c) => `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || c.email || c.id)
          .join(", ")}.`,
      });
    }

    // 2. Overdue follow-ups — contacts with recent activity but no follow-up
    const overdueContacts = activeContacts.filter((contact) => {
      const last = lastActivityMap.get(contact.id);
      if (!last) return false; // No activity at all → handled by dormant
      const timeSince = now - last.timestamp;
      // Has recent-ish activity (within dormant window) but overdue for follow-up
      return timeSince > followupMs && timeSince <= dormantMs;
    });

    if (overdueContacts.length > 0) {
      findings.push({
        type: "overdue_followups",
        severity: overdueContacts.length > 10 ? "warning" : "info",
        title: `${overdueContacts.length} Overdue Follow-up${overdueContacts.length > 1 ? "s" : ""}`,
        description: `${overdueContacts.length} contacts need follow-up (last activity ${this.followupThresholdDays}-${this.dormantThresholdDays} days ago).`,
        metric: overdueContacts.length,
        affectedContactIds: overdueContacts.map((c) => c.id),
        recommendation: "Schedule follow-up calls or emails for overdue contacts to maintain engagement.",
      });
    }

    // 3. Unengaged leads — contacts created recently but never contacted
    const recentMs = 14 * 24 * 60 * 60 * 1000; // 14 days
    const unengagedLeads = activeContacts.filter((contact) => {
      const createdAt = new Date(contact.createdAt).getTime();
      const isRecent = now - createdAt < recentMs;
      const hasActivity = lastActivityMap.has(contact.id);
      return isRecent && !hasActivity;
    });

    if (unengagedLeads.length > 0) {
      findings.push({
        type: "unengaged_leads",
        severity: unengagedLeads.length > 5 ? "warning" : "info",
        title: `${unengagedLeads.length} Unengaged New Lead${unengagedLeads.length > 1 ? "s" : ""}`,
        description: `${unengagedLeads.length} contacts were created in the last 14 days but have never been contacted.`,
        metric: unengagedLeads.length,
        affectedContactIds: unengagedLeads.map((c) => c.id),
        recommendation: "Speed to lead matters — contact new leads within 24 hours for best conversion rates.",
      });
    }

    // 4. Activity volume decline
    const activityDecline = this.checkActivityDecline(input.activities);
    if (activityDecline) {
      findings.push(activityDecline);
    }

    return findings;
  }

  private checkActivityDecline(activities: CrmActivity[]): ActivityCadenceFinding | null {
    if (activities.length < 10) return null;

    const now = Date.now();
    const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
    const twoWeeksMs = 14 * 24 * 60 * 60 * 1000;

    const thisWeek = activities.filter((a) => {
      const t = new Date(a.createdAt).getTime();
      return now - t <= oneWeekMs;
    }).length;

    const lastWeek = activities.filter((a) => {
      const t = new Date(a.createdAt).getTime();
      return now - t > oneWeekMs && now - t <= twoWeeksMs;
    }).length;

    if (lastWeek > 0 && thisWeek < lastWeek * 0.5) {
      const declinePct = ((lastWeek - thisWeek) / lastWeek) * 100;
      return {
        type: "activity_decline",
        severity: declinePct > 75 ? "critical" : "warning",
        title: "Activity Volume Declining",
        description: `Activity dropped ${declinePct.toFixed(0)}% week-over-week (${thisWeek} this week vs ${lastWeek} last week).`,
        metric: declinePct,
        affectedContactIds: [],
        recommendation: "Team activity is declining. Review workload distribution and ensure outreach cadences are being maintained.",
      };
    }

    return null;
  }
}
