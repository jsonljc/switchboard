export interface ServiceFieldConfig {
  key: string;
  label: string;
  type: "text" | "password";
  required: boolean;
  placeholder: string;
  helpText?: string;
}

export const SERVICE_FIELD_CONFIGS: Record<string, ServiceFieldConfig[]> = {
  "meta-ads": [
    {
      key: "accessToken",
      label: "Access Token",
      type: "password",
      required: true,
      placeholder: "System User token from Meta Business Suite",
      helpText: "Go to Business Settings > System Users > Generate Token",
    },
    {
      key: "accountId",
      label: "Ad Account ID",
      type: "text",
      required: true,
      placeholder: "act_123456789",
      helpText: "Found in Ads Manager > Account Overview",
    },
    {
      key: "pixelId",
      label: "Pixel ID",
      type: "text",
      required: false,
      placeholder: "123456789",
      helpText: "Found in Events Manager (optional)",
    },
  ],
};
