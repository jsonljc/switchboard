import type { PrismaDbClient } from "../prisma-db.js";
import type {
  ProductIdentity,
  ProductImage,
  ProductImageViewType,
  ProductLockStatus,
  ProductQualityTier,
} from "@switchboard/schemas";

export interface CreateProductIdentityInput {
  orgId: string;
  title: string;
  sourceUrl?: string;
  description?: string;
  brandName?: string;
  sku?: string;
  packageType?: string;
  canonicalPackageText?: string;
  qualityTier?: ProductQualityTier;
  lockStatus?: ProductLockStatus;
}

export interface AddProductImageInput {
  viewType: ProductImageViewType;
  uri: string;
  approvedForGeneration: boolean;
  hasReadableLabel?: boolean;
  ocrText?: string;
  backgroundType?: string;
}

export class PrismaProductIdentityStore {
  constructor(private prisma: PrismaDbClient) {}

  async create(input: CreateProductIdentityInput): Promise<ProductIdentity> {
    return this.prisma.productIdentity.create({
      data: {
        orgId: input.orgId,
        title: input.title,
        sourceUrl: input.sourceUrl,
        description: input.description,
        brandName: input.brandName,
        sku: input.sku,
        packageType: input.packageType,
        canonicalPackageText: input.canonicalPackageText,
        qualityTier: input.qualityTier ?? "url_imported",
        lockStatus: input.lockStatus ?? "draft",
      },
    }) as unknown as ProductIdentity;
  }

  async getById(id: string): Promise<ProductIdentity | null> {
    return this.prisma.productIdentity.findUnique({
      where: { id },
    }) as unknown as ProductIdentity | null;
  }

  async addImage(productIdentityId: string, input: AddProductImageInput): Promise<ProductImage> {
    return this.prisma.productImage.create({
      data: {
        productIdentityId,
        viewType: input.viewType,
        uri: input.uri,
        approvedForGeneration: input.approvedForGeneration,
        hasReadableLabel: input.hasReadableLabel,
        ocrText: input.ocrText,
        backgroundType: input.backgroundType,
      },
    }) as unknown as ProductImage;
  }

  async listImages(productIdentityId: string): Promise<ProductImage[]> {
    return this.prisma.productImage.findMany({
      where: { productIdentityId },
      orderBy: { createdAt: "asc" },
    }) as unknown as ProductImage[];
  }
}
