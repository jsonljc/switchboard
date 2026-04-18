import type { AdConversionDispatcher, DispatchResult } from "./ad-conversion-dispatcher.js";
import type { ConversionEvent } from "../events/conversion-bus.js";
import type { ConversionStage } from "@switchboard/schemas";

interface GoogleOfflineConfig {
  customerId: string;
  conversionActionMapping: Partial<Record<ConversionStage, string>>;
}

interface UploadInput {
  gclid: string;
  conversionDateTime: string;
  conversionValue?: number;
  currencyCode?: string;
  conversionAction: string;
}

type UploadFn = (input: UploadInput) => Promise<{ accepted: boolean; errorMessage?: string }>;

export class GoogleOfflineDispatcher implements AdConversionDispatcher {
  readonly platform = "google_offline";
  private readonly config: GoogleOfflineConfig;
  private readonly uploadFn: UploadFn;

  constructor(config: GoogleOfflineConfig, uploadFn: UploadFn) {
    this.config = config;
    this.uploadFn = uploadFn;
  }

  canDispatch(event: ConversionEvent): boolean {
    const gclid = event.metadata?.["gclid"];
    if (!gclid) return false;
    return !!this.config.conversionActionMapping[event.type];
  }

  async dispatch(event: ConversionEvent): Promise<DispatchResult> {
    const gclid = event.metadata["gclid"] as string;
    const conversionAction = this.config.conversionActionMapping[event.type]!;

    const result = await this.uploadFn({
      gclid,
      conversionDateTime: event.occurredAt.toISOString(),
      conversionValue: event.value || undefined,
      currencyCode: "SGD",
      conversionAction,
    });

    return {
      accepted: result.accepted,
      errorMessage: result.errorMessage,
    };
  }
}
