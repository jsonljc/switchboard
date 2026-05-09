import type { ContactDetailResponse } from "@switchboard/schemas";

// Keys MUST match D1's list fixture ids exactly so clicking a row in fixture
// mode resolves to a populated detail page. The three rows collectively
// exercise every section's empty-path: lisa is rich, maya has no opportunities
// or open decisions, priya has no threads or revenue events.
const NOW = new Date("2026-05-09T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000).toISOString();
const daysAgo = (d: number) => hoursAgo(d * 24);

export const CONTACT_DETAIL_FIXTURES: Record<string, ContactDetailResponse> = {
  "fx-lisa": {
    profile: {
      id: "fx-lisa",
      displayName: "Lisa K.",
      primaryChannel: "whatsapp",
      stage: "active",
      phone: "+6591234567",
      email: "lisa@example.com",
      source: "instagram-spring",
      sourceType: "ctwa",
      attributionSummary: 'ad set "spring 2026"',
      messagingConsent: {
        optedIn: true,
        optedInAt: daysAgo(8),
        source: "ctwa",
        optedOutAt: null,
      },
      firstContactAt: daysAgo(8),
      lastActivityAt: hoursAgo(3),
    },
    opportunities: [
      {
        id: "fx-opp-lisa-1",
        serviceName: "Wedding day",
        stage: "interested",
        estimatedValue: 4800,
        openedAt: daysAgo(5),
        closedAt: null,
      },
    ],
    threads: [
      {
        id: "fx-thread-lisa",
        assignedAgent: "alex",
        summary: "Following up on the wedding-day quote.",
        lastMessageAt: hoursAgo(3),
      },
    ],
    openDecisions: [
      {
        id: "fx-rec-lisa-1",
        kind: "approval",
        agentKey: "alex",
        title: "Send the prepared wedding quote PDF to Lisa.",
        createdAt: hoursAgo(5),
      },
    ],
    revenueEvents: [
      {
        id: "fx-rev-lisa-1",
        amount: 800,
        currency: "SGD",
        type: "deposit",
        status: "confirmed",
        recordedAt: daysAgo(2),
      },
    ],
  },
  "fx-maya": {
    profile: {
      id: "fx-maya",
      displayName: "Maya T.",
      primaryChannel: "whatsapp",
      stage: "customer",
      phone: "+6598765432",
      email: null,
      source: null,
      sourceType: null,
      attributionSummary: null,
      messagingConsent: {
        optedIn: true,
        optedInAt: daysAgo(34),
        source: "organic_inbound",
        optedOutAt: null,
      },
      firstContactAt: daysAgo(34),
      lastActivityAt: daysAgo(1),
    },
    opportunities: [],
    threads: [
      {
        id: "fx-thread-maya",
        assignedAgent: "riley",
        summary: "Repeat customer — checked in.",
        lastMessageAt: daysAgo(1),
      },
    ],
    openDecisions: [],
    revenueEvents: [
      {
        id: "fx-rev-maya-1",
        amount: 1200,
        currency: "SGD",
        type: "payment",
        status: "confirmed",
        recordedAt: daysAgo(20),
      },
      {
        id: "fx-rev-maya-2",
        amount: 800,
        currency: "SGD",
        type: "payment",
        status: "confirmed",
        recordedAt: daysAgo(2),
      },
    ],
  },
  "fx-priya": {
    profile: {
      id: "fx-priya",
      displayName: "Priya S.",
      primaryChannel: "telegram",
      stage: "dormant",
      phone: null,
      email: "priya@example.com",
      source: "ad-q2-lookalikes",
      sourceType: "ctwa",
      attributionSummary: 'campaign "q2 lookalikes"',
      messagingConsent: {
        optedIn: false,
        optedInAt: null,
        source: null,
        optedOutAt: null,
      },
      firstContactAt: daysAgo(118),
      lastActivityAt: daysAgo(62),
    },
    opportunities: [
      {
        id: "fx-opp-priya-1",
        serviceName: "Engagement shoot",
        stage: "lost",
        estimatedValue: 1200,
        openedAt: daysAgo(110),
        closedAt: daysAgo(70),
      },
    ],
    threads: [],
    openDecisions: [
      {
        id: "fx-handoff-priya-1",
        kind: "handoff",
        agentKey: null,
        title: "Handoff awaiting reply",
        createdAt: daysAgo(62),
      },
    ],
    revenueEvents: [],
  },
};
