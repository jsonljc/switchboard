import type { Contact, ContactStage } from "@switchboard/schemas";

export interface CreateContactInput {
  organizationId: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  primaryChannel: "whatsapp" | "telegram" | "dashboard";
  firstTouchChannel?: string | null;
  source?: string | null;
  attribution?: Record<string, unknown> | null;
  roles?: string[];
}

export interface ContactFilters {
  stage?: ContactStage;
  source?: string;
  limit?: number;
  offset?: number;
}

export interface ContactStore {
  create(input: CreateContactInput): Promise<Contact>;
  findById(orgId: string, id: string): Promise<Contact | null>;
  findByPhone(orgId: string, phone: string): Promise<Contact | null>;
  updateStage(orgId: string, id: string, stage: ContactStage): Promise<Contact>;
  updateLastActivity(orgId: string, id: string): Promise<void>;
  list(orgId: string, filters?: ContactFilters): Promise<Contact[]>;
}
