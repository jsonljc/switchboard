"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

export interface ContactEntry {
  id: string;
  externalId: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  channel: string | null;
  status: string;
  assignedStaffId: string | null;
  sourceAdId: string | null;
  createdAt: string;
}

export interface DealEntry {
  id: string;
  name: string;
  stage: string;
  amount: number | null;
  contactId: string | null;
  createdAt: string;
}

export type LeadStage = "NEW" | "QUALIFIED" | "BOOKED" | "LOST";

const STAGE_MAP: Record<string, LeadStage> = {
  consultation_booked: "BOOKED",
  booked: "BOOKED",
  appointment_scheduled: "BOOKED",
  qualified: "QUALIFIED",
  lead: "NEW",
  new: "NEW",
  closed_lost: "LOST",
  lost: "LOST",
};

export interface LeadEntry {
  contact: ContactEntry;
  deal: DealEntry | null;
  stage: LeadStage;
  displayName: string;
}

async function fetchLeads(): Promise<LeadEntry[]> {
  const [contactsRes, dealsRes] = await Promise.all([
    fetch("/api/dashboard/crm/contacts?limit=100"),
    fetch("/api/dashboard/crm/deals?limit=100"),
  ]);

  const contactsData = (contactsRes.ok ? await contactsRes.json() : { data: [] }) as {
    data: ContactEntry[];
  };
  const dealsData = (dealsRes.ok ? await dealsRes.json() : { data: [] }) as {
    data: DealEntry[];
  };

  const contacts = Array.isArray(contactsData.data) ? contactsData.data : [];
  const deals = Array.isArray(dealsData.data) ? dealsData.data : [];

  // Index deals by contactId for O(1) lookup
  const dealByContactId = new Map<string, DealEntry>();
  for (const deal of deals) {
    if (deal.contactId) dealByContactId.set(deal.contactId, deal);
  }

  return contacts.map((contact) => {
    const deal = dealByContactId.get(contact.id) ?? null;
    const stageKey = (deal?.stage ?? contact.status ?? "").toLowerCase();
    const stage: LeadStage = STAGE_MAP[stageKey] ?? "NEW";
    const displayName =
      [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.email || "Unknown";
    return { contact, deal, stage, displayName };
  });
}

export function useLeads(params?: { search?: string }) {
  return useQuery({
    queryKey: [...queryKeys.crm.contacts(), params?.search],
    queryFn: fetchLeads,
    refetchInterval: 60_000,
  });
}
