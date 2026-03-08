// ---------------------------------------------------------------------------
// Catalog Health Checker — Diagnoses product catalog health and issues
// ---------------------------------------------------------------------------

import type { CatalogHealth } from "./types.js";

export class CatalogHealthChecker {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
  ) {}

  /**
   * Check the health of a product catalog by fetching diagnostics and product review statuses.
   */
  async check(catalogId: string): Promise<CatalogHealth> {
    // 1. Fetch catalog info and diagnostics
    const diagnosticsUrl =
      `${this.baseUrl}/${catalogId}?` +
      `fields=id,name,product_count` +
      `&access_token=${this.accessToken}`;

    const catalogData = await this.fetchJson(diagnosticsUrl);

    const catalogName = String(catalogData.name ?? "");
    const totalProducts = Number(catalogData.product_count ?? 0);

    // 2. Fetch diagnostic summary
    const diagUrl =
      `${this.baseUrl}/${catalogId}/diagnostics?` +
      `access_token=${this.accessToken}`;

    let diagnostics: CatalogHealth["diagnostics"] = [];
    try {
      const diagData = await this.fetchJson(diagUrl);
      const diagItems = (diagData.data ?? []) as Array<Record<string, unknown>>;
      diagnostics = diagItems.map((item) => ({
        type: String(item.type ?? ""),
        count: Number(item.num_items ?? 0),
        severity: String(item.severity ?? "info"),
      }));
    } catch {
      // Diagnostics endpoint may not be available for all catalogs
    }

    // 3. Fetch product review statuses
    let approvedProducts = 0;
    let rejectedProducts = 0;
    let pendingProducts = 0;

    try {
      const productsUrl =
        `${this.baseUrl}/${catalogId}/products?` +
        `fields=review_status,errors` +
        `&limit=500` +
        `&access_token=${this.accessToken}`;

      const productsData = await this.fetchJson(productsUrl);
      const products = (productsData.data ?? []) as Array<Record<string, unknown>>;

      for (const product of products) {
        const status = String(product.review_status ?? "pending");
        switch (status) {
          case "approved":
            approvedProducts++;
            break;
          case "rejected":
            rejectedProducts++;
            break;
          default:
            pendingProducts++;
            break;
        }
      }

      // If fewer products returned than total, estimate proportions
      if (products.length > 0 && products.length < totalProducts) {
        const ratio = totalProducts / products.length;
        approvedProducts = Math.round(approvedProducts * ratio);
        rejectedProducts = Math.round(rejectedProducts * ratio);
        pendingProducts = Math.max(0, totalProducts - approvedProducts - rejectedProducts);
      }
    } catch {
      // Fall back to total count if products endpoint fails
      approvedProducts = totalProducts;
    }

    const errorRate = totalProducts > 0 ? rejectedProducts / totalProducts : 0;

    // Generate issues and recommendations
    const issues: string[] = [];
    const recommendations: string[] = [];

    if (rejectedProducts > 0) {
      issues.push(
        `${rejectedProducts} product(s) are rejected (${(errorRate * 100).toFixed(1)}% error rate).`,
      );
      recommendations.push(
        "Review rejected products and fix data quality issues (missing fields, policy violations).",
      );
    }

    if (pendingProducts > totalProducts * 0.1) {
      issues.push(
        `${pendingProducts} product(s) are pending review (${((pendingProducts / totalProducts) * 100).toFixed(1)}%).`,
      );
      recommendations.push(
        "Large number of pending products. Ensure feed is properly configured and recent uploads are complete.",
      );
    }

    if (errorRate > 0.05) {
      recommendations.push(
        "Error rate exceeds 5%. Consider running a feed validation tool before uploading.",
      );
    }

    for (const diag of diagnostics) {
      if (diag.severity === "error" || diag.severity === "critical") {
        issues.push(`${diag.type}: ${diag.count} item(s) affected (severity: ${diag.severity}).`);
      }
    }

    if (issues.length === 0) {
      recommendations.push("Catalog health is good. No issues detected.");
    }

    return {
      catalogId,
      catalogName,
      totalProducts,
      approvedProducts,
      rejectedProducts,
      pendingProducts,
      errorRate: Math.round(errorRate * 10000) / 10000,
      diagnostics,
      issues,
      recommendations,
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
