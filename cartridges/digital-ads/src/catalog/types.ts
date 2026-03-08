// ---------------------------------------------------------------------------
// Catalog Health Types
// ---------------------------------------------------------------------------

export interface CatalogHealth {
  catalogId: string;
  catalogName: string;
  totalProducts: number;
  approvedProducts: number;
  rejectedProducts: number;
  pendingProducts: number;
  errorRate: number;
  diagnostics: Array<{ type: string; count: number; severity: string }>;
  issues: string[];
  recommendations: string[];
}

export interface ProductSet {
  id: string;
  name: string;
  productCount: number;
  filter: Record<string, unknown> | null;
}
