import { z } from "zod";

// ---------------------------------------------------------------------------
// CRM Contact
// ---------------------------------------------------------------------------

export const CrmContactSchema = z.object({
  id: z.string().min(1),
  externalId: z.string().nullable(),
  channel: z.string().nullable(),
  email: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  company: z.string().nullable(),
  phone: z.string().nullable(),
  tags: z.array(z.string()),
  status: z.string(),
  assignedStaffId: z.string().nullable(),
  sourceAdId: z.string().nullable(),
  sourceCampaignId: z.string().nullable(),
  gclid: z.string().nullable(),
  fbclid: z.string().nullable(),
  ttclid: z.string().nullable(),
  normalizedPhone: z.string().nullable(),
  normalizedEmail: z.string().nullable(),
  utmSource: z.string().nullable().optional(),
  consentStatus: z.string().nullable().optional(),
  consentRevokedAt: z.string().nullable().optional(),
  consentGrantedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  properties: z.record(z.unknown()),
});
export type CrmContact = z.infer<typeof CrmContactSchema>;

// ---------------------------------------------------------------------------
// CRM Activity
// ---------------------------------------------------------------------------

export const CrmActivitySchema = z.object({
  id: z.string().min(1),
  type: z.string(),
  subject: z.string().nullable(),
  body: z.string().nullable(),
  contactIds: z.array(z.string()),
  dealIds: z.array(z.string()),
  createdAt: z.string(),
});
export type CrmActivity = z.infer<typeof CrmActivitySchema>;

// ---------------------------------------------------------------------------
// CRM Deal (minimal)
// ---------------------------------------------------------------------------

export const CrmDealSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  stage: z.string(),
  value: z.number().nullable(),
  contactIds: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CrmDeal = z.infer<typeof CrmDealSchema>;

// ---------------------------------------------------------------------------
// CRM Health Check
// ---------------------------------------------------------------------------

export const CrmHealthCheckSchema = z.object({
  status: z.enum(["connected", "disconnected", "degraded"]),
  latencyMs: z.number(),
  error: z.string().nullable(),
  capabilities: z.array(z.string()),
});
export type CrmHealthCheck = z.infer<typeof CrmHealthCheckSchema>;

// ---------------------------------------------------------------------------
// CRM Provider Interface
// ---------------------------------------------------------------------------

export interface CrmProvider {
  searchContacts: (query: string) => Promise<CrmContact[]>;
  getContact: (id: string) => Promise<CrmContact | null>;
  findByExternalId: (externalId: string, channel: string) => Promise<CrmContact | null>;
  createContact: (data: Partial<CrmContact>) => Promise<CrmContact>;
  updateContact: (id: string, data: Partial<CrmContact>) => Promise<CrmContact>;
  archiveContact: (id: string) => Promise<void>;
  listDeals: (contactId: string) => Promise<CrmDeal[]>;
  createDeal: (data: Partial<CrmDeal>) => Promise<CrmDeal>;
  archiveDeal: (id: string) => Promise<void>;
  listActivities: (contactId: string) => Promise<CrmActivity[]>;
  logActivity: (data: Partial<CrmActivity>) => Promise<CrmActivity>;
  getPipelineStatus: () => Promise<Array<{ stage: string; count: number }>>;
  healthCheck: () => Promise<CrmHealthCheck>;
}

// ---------------------------------------------------------------------------
// Lead Profile (accumulated from conversation turns)
// ---------------------------------------------------------------------------

export const LeadProfileSchema = z
  .object({
    name: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    company: z.string().nullable().optional(),
    intent: z.string().nullable().optional(),
    budget: z.string().nullable().optional(),
    timeline: z.string().nullable().optional(),
    source: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .passthrough();
export type LeadProfile = z.infer<typeof LeadProfileSchema>;
