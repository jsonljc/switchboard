// packages/schemas/src/provider-capabilities.ts
import { z } from "zod";

export const ProviderRole = z.enum(["production", "narrow_use", "planned", "tooling"]);
export type ProviderRole = z.infer<typeof ProviderRole>;

export const ApiMaturity = z.enum(["high", "medium", "low"]);
export type ApiMaturity = z.infer<typeof ApiMaturity>;

export const IdentityStrength = z.enum(["high", "medium", "low"]);
export type IdentityStrength = z.infer<typeof IdentityStrength>;

export const ProviderCapabilityProfileSchema = z.object({
  provider: z.string(),
  role: ProviderRole,
  identityStrength: IdentityStrength,
  supportsIdentityObject: z.boolean(),
  supportsReferenceImages: z.boolean(),
  supportsFirstLastFrame: z.boolean(),
  supportsExtension: z.boolean(),
  supportsMotionTransfer: z.boolean(),
  supportsMultiShot: z.boolean(),
  supportsAudioDrivenTalkingHead: z.boolean(),
  supportsProductTextIntegrity: z.boolean(),
  apiMaturity: ApiMaturity,
  seedSupport: z.boolean(),
  versionPinning: z.boolean(),
});
export type ProviderCapabilityProfile = z.infer<typeof ProviderCapabilityProfileSchema>;
