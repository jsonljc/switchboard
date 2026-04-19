import type { ConversionEvent } from "@switchboard/schemas";

export interface DispatchResult {
  accepted: boolean;
  errorMessage?: string;
  responsePayload?: unknown;
}

export interface AdConversionDispatcher {
  readonly platform: string;
  canDispatch(event: ConversionEvent): boolean;
  dispatch(event: ConversionEvent): Promise<DispatchResult>;
}
