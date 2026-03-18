// ---------------------------------------------------------------------------
// Sales Closer — Dependency types (injected at construction time)
// ---------------------------------------------------------------------------

export interface AvailableSlot {
  startTime: string;
  endTime: string;
  providerId: string;
  providerName?: string;
}

export interface ContactInfo {
  contactId: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}

/**
 * Dependencies injected into the Sales Closer handler.
 * The app layer wires these from cartridge implementations.
 */
export interface SalesCloserDeps {
  /** Check available appointment slots. READ — no governance needed. */
  getAvailableSlots?: (params: {
    serviceType: string;
    durationMinutes: number;
    date?: string;
  }) => Promise<AvailableSlot[]>;

  /** Look up contact info. READ — no governance needed. */
  getContact?: (contactId: string) => Promise<ContactInfo | null>;
}
