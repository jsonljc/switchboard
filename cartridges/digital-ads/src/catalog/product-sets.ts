// ---------------------------------------------------------------------------
// Product Set Manager — CRUD operations for catalog product sets
// ---------------------------------------------------------------------------

import type { ProductSet } from "./types.js";

export class ProductSetManager {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
  ) {}

  /**
   * List all product sets for a catalog.
   */
  async list(catalogId: string): Promise<ProductSet[]> {
    const url =
      `${this.baseUrl}/${catalogId}/product_sets?` +
      `fields=id,name,product_count,filter` +
      `&access_token=${this.accessToken}`;

    const data = await this.fetchJson(url);
    const sets = (data.data ?? []) as Array<Record<string, unknown>>;

    return sets.map((s) => ({
      id: String(s.id),
      name: String(s.name ?? ""),
      productCount: Number(s.product_count ?? 0),
      filter: (s.filter as Record<string, unknown>) ?? null,
    }));
  }

  /**
   * Create a new product set within a catalog.
   */
  async create(
    catalogId: string,
    params: { name: string; filter: Record<string, unknown> },
  ): Promise<ProductSet> {
    const url =
      `${this.baseUrl}/${catalogId}/product_sets?` +
      `access_token=${this.accessToken}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: params.name,
        filter: params.filter,
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const error = body.error as Record<string, unknown> | undefined;
      throw new Error(
        `Meta API error: ${(error?.message as string) ?? `HTTP ${response.status}`}`,
      );
    }

    const result = (await response.json()) as Record<string, unknown>;

    return {
      id: String(result.id),
      name: params.name,
      productCount: 0,
      filter: params.filter,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async fetchJson(url: string): Promise<Record<string, unknown>> {
    const response = await fetch(url);
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const error = body.error as Record<string, unknown> | undefined;
      throw new Error(
        `Meta API error: ${(error?.message as string) ?? `HTTP ${response.status}`}`,
      );
    }
    return (await response.json()) as Record<string, unknown>;
  }
}
