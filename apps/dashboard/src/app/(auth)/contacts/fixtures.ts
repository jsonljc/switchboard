import type { ContactBrowseRow, ContactsListResponse } from "@switchboard/schemas";

const NOW = new Date("2026-05-09T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000).toISOString();
const daysAgo = (d: number) => hoursAgo(d * 24);

export const CONTACTS_FIXTURE_ROWS: ContactBrowseRow[] = [
  {
    id: "fx-lisa",
    displayName: "Lisa K.",
    stage: "active",
    primaryChannel: "whatsapp",
    source: "instagram-spring",
    lastActivityAt: hoursAgo(3),
    firstContactAt: daysAgo(8),
    opportunityCount: 1,
    detailHref: "/contacts/fx-lisa",
  },
  {
    id: "fx-marcus",
    displayName: "Marcus T.",
    stage: "customer",
    primaryChannel: "whatsapp",
    source: null,
    lastActivityAt: daysAgo(1),
    firstContactAt: daysAgo(34),
    opportunityCount: 0,
    detailHref: "/contacts/fx-marcus",
  },
  {
    id: "fx-priya",
    displayName: "Priya S.",
    stage: "dormant",
    primaryChannel: "telegram",
    source: "ad-q2-lookalikes",
    lastActivityAt: daysAgo(62),
    firstContactAt: daysAgo(118),
    opportunityCount: 0,
    detailHref: "/contacts/fx-priya",
  },
];

export const CONTACTS_FIXTURE_PAGE: ContactsListResponse = {
  rows: CONTACTS_FIXTURE_ROWS,
  nextCursor: null,
  hasMore: false,
};
