import { z } from "zod";

export const IdentityTierSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type IdentityTier = z.infer<typeof IdentityTierSchema>;

export const ProductQualityTierSchema = z.enum(["url_imported", "verified", "canonical"]);
export type ProductQualityTier = z.infer<typeof ProductQualityTierSchema>;

export const ProductLockStatusSchema = z.enum(["draft", "verified", "locked", "deprecated"]);
export type ProductLockStatus = z.infer<typeof ProductLockStatusSchema>;

export const ProductDimensionsSchema = z.object({
  h: z.number().positive(),
  w: z.number().positive(),
  d: z.number().positive(),
});
export type ProductDimensions = z.infer<typeof ProductDimensionsSchema>;

export const ProductColorSpecSchema = z.object({
  primaryHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  secondaryHex: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  pantone: z.string().optional(),
});
export type ProductColorSpec = z.infer<typeof ProductColorSpecSchema>;

export const ProductIdentitySchema = z.object({
  id: z.string(),
  orgId: z.string(),
  sourceUrl: z.string().url().nullable().optional(),
  title: z.string(),
  description: z.string().nullable().optional(),
  brandName: z.string().nullable().optional(),
  sku: z.string().nullable().optional(),
  packageType: z.string().nullable().optional(),
  canonicalPackageText: z.string().nullable().optional(),
  dimensionsMm: ProductDimensionsSchema.nullable().optional(),
  colorSpec: ProductColorSpecSchema.nullable().optional(),
  logoAssetId: z.string().nullable().optional(),
  qualityTier: ProductQualityTierSchema,
  lockStatus: ProductLockStatusSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type ProductIdentity = z.infer<typeof ProductIdentitySchema>;

export const ProductImageViewTypeSchema = z.enum([
  "hero_front",
  "back",
  "side",
  "three_quarter",
  "macro_label",
  "transparent_cutout",
  "logo",
  "fallback_scraped",
]);
export type ProductImageViewType = z.infer<typeof ProductImageViewTypeSchema>;

export const ProductImageSchema = z.object({
  id: z.string(),
  productIdentityId: z.string(),
  viewType: ProductImageViewTypeSchema,
  uri: z.string(),
  resolution: z
    .object({ width: z.number().int().positive(), height: z.number().int().positive() })
    .nullable()
    .optional(),
  hasReadableLabel: z.boolean().nullable().optional(),
  ocrText: z.string().nullable().optional(),
  backgroundType: z.string().nullable().optional(),
  approvedForGeneration: z.boolean(),
  createdAt: z.coerce.date(),
});
export type ProductImage = z.infer<typeof ProductImageSchema>;

export const ConsentRecordSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  personName: z.string(),
  scopeOfUse: z.array(z.string()).min(1),
  territory: z.array(z.string()).min(1),
  mediaTypes: z.array(z.string()).min(1),
  revocable: z.boolean(),
  revoked: z.boolean(),
  recordingUri: z.string().nullable().optional(),
  effectiveAt: z.coerce.date(),
  expiresAt: z.coerce.date().nullable().optional(),
  revokedAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type ConsentRecord = z.infer<typeof ConsentRecordSchema>;

export const ProductQcResultSchema = z.object({
  id: z.string(),
  productIdentityId: z.string(),
  assetRecordId: z.string(),
  logoSimilarityScore: z.number().min(0).max(1).nullable().optional(),
  packageOcrMatchScore: z.number().min(0).max(1).nullable().optional(),
  colorDeltaScore: z.number().min(0).nullable().optional(),
  geometryMatchScore: z.number().min(0).max(1).nullable().optional(),
  scaleConfidence: z.number().min(0).max(1).nullable().optional(),
  passFail: z.enum(["pass", "fail", "warn"]),
  warnings: z.array(z.string()),
  createdAt: z.coerce.date(),
});
export type ProductQcResult = z.infer<typeof ProductQcResultSchema>;
