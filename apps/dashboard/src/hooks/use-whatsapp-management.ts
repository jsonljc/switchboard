"use client";

import { useQuery } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WhatsAppAccountData {
  connection: {
    status: "connected" | "incomplete" | "needs_attention" | "not_connected";
    externalAccountId: string | null;
    primaryPhoneNumberId: string | null;
    connectedAt: string | null;
    testRecipients: string[];
  };
  account: {
    id: string | null;
    name: string | null;
    currency: string | null;
    timezoneId: string | null;
    reviewStatus: string | null;
    templateNamespace: string | null;
  };
  readiness: {
    status: "ready" | "needs_attention" | "incomplete" | "not_connected";
    reasons: string[];
  };
}

export interface WhatsAppPhoneNumber {
  id: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  qualityBadge: "good" | "warning" | "bad" | "unknown";
  messagingLimitTier: string | null;
  status: string | null;
  platformType: string | null;
  codeVerificationStatus: string | null;
  isOfficialBusinessAccount: boolean | null;
  isPrimaryForSwitchboard: boolean;
}

export interface WhatsAppTemplate {
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
  hasBody: boolean;
  hasButtons: boolean;
  rejectedReason: string | null;
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchAccount(): Promise<WhatsAppAccountData> {
  const res = await fetch("/api/dashboard/whatsapp/account");
  if (!res.ok) throw new Error("Failed to fetch WhatsApp account");
  return res.json();
}

async function fetchPhoneNumbers(): Promise<{ phoneNumbers: WhatsAppPhoneNumber[] }> {
  const res = await fetch("/api/dashboard/whatsapp/phone-numbers");
  if (!res.ok) throw new Error("Failed to fetch WhatsApp phone numbers");
  return res.json();
}

async function fetchTemplates(): Promise<{ templates: WhatsAppTemplate[] }> {
  const res = await fetch("/api/dashboard/whatsapp/templates");
  if (!res.ok) throw new Error("Failed to fetch WhatsApp templates");
  return res.json();
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useWhatsAppAccount() {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.whatsappManagement.account() ?? ["__disabled_wa_account__"],
    queryFn: fetchAccount,
    enabled: !!keys,
    staleTime: 30_000,
    retry: 1,
  });
}

export function useWhatsAppPhoneNumbers(enabled = true) {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.whatsappManagement.phoneNumbers() ?? ["__disabled_wa_phones__"],
    queryFn: fetchPhoneNumbers,
    enabled: !!keys && enabled,
    staleTime: 30_000,
    retry: 1,
  });
}

export function useWhatsAppTemplates(enabled = true) {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.whatsappManagement.templates() ?? ["__disabled_wa_templates__"],
    queryFn: fetchTemplates,
    enabled: !!keys && enabled,
    staleTime: 30_000,
    retry: 1,
  });
}
