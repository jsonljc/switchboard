import { normalizePhone, normalizeEmail } from "./normalize.js";
import type { CrmContact } from "@switchboard/schemas";

export interface ContactCandidate {
  phone?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  channel: string;
  externalId: string;
  sourceAdId?: string;
  sourceCampaignId?: string;
  gclid?: string;
  fbclid?: string;
  ttclid?: string;
  utmSource?: string;
  organizationId?: string;
  properties?: Record<string, unknown>;
}

export interface MergeResult {
  contact: CrmContact;
  isNew: boolean;
}

/**
 * Port interface for contact persistence operations needed by the merger.
 * Implemented by PrismaCrmProvider at the app layer.
 */
export interface ContactMergerPort {
  findByNormalizedPhone(phone: string): Promise<CrmContact | null>;
  findByNormalizedEmail(email: string): Promise<CrmContact | null>;
  createContact(data: Record<string, unknown>): Promise<CrmContact>;
  updateContact(id: string, data: Record<string, unknown>): Promise<CrmContact>;
  addAlias(contactId: string, channel: string, externalId: string): Promise<void>;
}

export class ContactMerger {
  constructor(private readonly port: ContactMergerPort) {}

  async resolveContact(candidate: ContactCandidate): Promise<MergeResult> {
    const normPhone = candidate.phone ? normalizePhone(candidate.phone) : null;
    const normEmail = candidate.email ? normalizeEmail(candidate.email) : null;

    // 1. Try phone match first
    let existing: CrmContact | null = null;
    if (normPhone) {
      existing = await this.port.findByNormalizedPhone(normPhone);
    }

    // 2. Fall back to email
    if (!existing && normEmail) {
      existing = await this.port.findByNormalizedEmail(normEmail);
    }

    // 3. Match found — merge
    if (existing) {
      const enrichment: Record<string, unknown> = {};

      // Fill nulls only
      if (!existing.email && candidate.email) {
        enrichment.email = candidate.email;
        enrichment.normalizedEmail = normEmail;
      }
      if (!existing.phone && candidate.phone) {
        enrichment.phone = candidate.phone;
        enrichment.normalizedPhone = normPhone;
      }
      if (!existing.firstName && candidate.firstName) {
        enrichment.firstName = candidate.firstName;
      }
      if (!existing.lastName && candidate.lastName) {
        enrichment.lastName = candidate.lastName;
      }

      // First-touch attribution: copy only if existing has none
      if (!existing.sourceAdId && candidate.sourceAdId) {
        enrichment.sourceAdId = candidate.sourceAdId;
      }
      if (!existing.sourceCampaignId && candidate.sourceCampaignId) {
        enrichment.sourceCampaignId = candidate.sourceCampaignId;
      }
      if (!existing.gclid && candidate.gclid) enrichment.gclid = candidate.gclid;
      if (!existing.fbclid && candidate.fbclid) enrichment.fbclid = candidate.fbclid;
      if (!existing.ttclid && candidate.ttclid) enrichment.ttclid = candidate.ttclid;

      if (Object.keys(enrichment).length > 0) {
        const updated = await this.port.updateContact(existing.id, enrichment);
        await this.port.addAlias(existing.id, candidate.channel, candidate.externalId);
        return { contact: updated, isNew: false };
      }

      await this.port.addAlias(existing.id, candidate.channel, candidate.externalId);
      return { contact: existing, isNew: false };
    }

    // 4. No match — create new
    const contact = await this.port.createContact({
      phone: candidate.phone,
      email: candidate.email,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      channel: candidate.channel,
      externalId: candidate.externalId,
      normalizedPhone: normPhone,
      normalizedEmail: normEmail,
      sourceAdId: candidate.sourceAdId,
      sourceCampaignId: candidate.sourceCampaignId,
      gclid: candidate.gclid,
      fbclid: candidate.fbclid,
      ttclid: candidate.ttclid,
      utmSource: candidate.utmSource,
      organizationId: candidate.organizationId,
      properties: candidate.properties ?? {},
    });

    await this.port.addAlias(contact.id, candidate.channel, candidate.externalId);
    return { contact, isNew: true };
  }
}
