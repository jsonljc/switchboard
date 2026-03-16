// ---------------------------------------------------------------------------
// Google Offline Conversions Dispatcher — uploads ConversionBus events to Google Ads
// ---------------------------------------------------------------------------

import type { ConversionBus, ConversionEvent } from "@switchboard/core";
import type { CrmProvider } from "@switchboard/schemas";

interface OfflineConversion {
  gclid: string;
  conversionAction: string;
  conversionDateTime: string;
  conversionValue: number;
  currencyCode: string;
}

export interface GoogleOfflineDispatcherConfig {
  uploadConversion: (conversion: OfflineConversion) => Promise<{ success: boolean }>;
  crmProvider: CrmProvider;
  conversionActionId: string;
  currencyCode?: string;
}

export class GoogleOfflineDispatcher {
  private config: GoogleOfflineDispatcherConfig;

  constructor(config: GoogleOfflineDispatcherConfig) {
    this.config = config;
  }

  register(bus: ConversionBus): void {
    bus.subscribe("*", (event) => {
      void this.handleEvent(event);
    });
  }

  async handleEvent(event: ConversionEvent): Promise<void> {
    const contact = await this.config.crmProvider.getContact(event.contactId);
    if (!contact?.gclid) return;

    try {
      await this.config.uploadConversion({
        gclid: contact.gclid,
        conversionAction: this.config.conversionActionId,
        conversionDateTime: event.timestamp.toISOString().replace("T", " ").replace("Z", "+00:00"),
        conversionValue: event.value,
        currencyCode: this.config.currencyCode ?? "SGD",
      });
    } catch {
      // Non-critical — don't block the event bus
    }
  }
}
