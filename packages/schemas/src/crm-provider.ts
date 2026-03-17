import type { ConnectionHealth } from "./cartridge.js";

export interface CrmContact {
  id: string;
  externalId: string | null;
  channel: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  phone: string | null;
  tags: string[];
  status: "active" | "archived";
  assignedStaffId: string | null;
  sourceAdId: string | null;
  sourceCampaignId: string | null;
  gclid: string | null;
  fbclid: string | null;
  ttclid: string | null;
  utmSource: string | null;
  createdAt: string;
  updatedAt: string;
  properties: Record<string, unknown>;
}

export interface CrmDeal {
  id: string;
  name: string;
  stage: string;
  pipeline: string;
  amount: number | null;
  closeDate: string | null;
  contactIds: string[];
  assignedStaffId: string | null;
  createdAt: string;
  updatedAt: string;
  properties: Record<string, unknown>;
}

export interface CrmActivity {
  id: string;
  type: "note" | "email" | "call" | "meeting" | "task";
  subject: string | null;
  body: string | null;
  contactIds: string[];
  dealIds: string[];
  createdAt: string;
}

export interface CrmPipelineStage {
  id: string;
  label: string;
  displayOrder: number;
  dealCount: number;
  totalValue: number;
}

export interface CrmProvider {
  // Read
  searchContacts(query: string, limit?: number): Promise<CrmContact[]>;
  getContact(contactId: string): Promise<CrmContact | null>;
  findByExternalId(externalId: string, channel?: string): Promise<CrmContact | null>;
  listDeals(filters?: {
    contactId?: string;
    pipeline?: string;
    stage?: string;
  }): Promise<CrmDeal[]>;
  listActivities(filters?: {
    contactId?: string;
    dealId?: string;
    type?: string;
  }): Promise<CrmActivity[]>;
  getPipelineStatus(pipelineId?: string): Promise<CrmPipelineStage[]>;

  // Write
  createContact(data: {
    externalId?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    company?: string;
    phone?: string;
    channel?: string;
    assignedStaffId?: string;
    sourceAdId?: string;
    sourceCampaignId?: string;
    fbclid?: string;
    ttclid?: string;
    utmSource?: string;
    properties?: Record<string, unknown>;
  }): Promise<CrmContact>;
  updateContact(contactId: string, data: Record<string, unknown>): Promise<CrmContact>;
  archiveContact(contactId: string): Promise<void>;
  createDeal(data: {
    name: string;
    pipeline?: string;
    stage?: string;
    amount?: number;
    contactIds?: string[];
    assignedStaffId?: string;
  }): Promise<CrmDeal>;
  archiveDeal(dealId: string): Promise<void>;
  logActivity(data: {
    type: CrmActivity["type"];
    subject?: string;
    body?: string;
    contactIds?: string[];
    dealIds?: string[];
  }): Promise<CrmActivity>;

  // Health
  healthCheck(): Promise<ConnectionHealth>;
}
