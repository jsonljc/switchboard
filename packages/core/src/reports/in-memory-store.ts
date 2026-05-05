import type {
  ReportCacheStore,
  ReportCacheRow,
  PdfCacheStore,
  PdfCacheRow,
  BaselineStore,
  BaselineRow,
  BaselineDimension,
} from "./interfaces.js";

function key(orgId: string, window: string): string {
  return `${orgId}::${window}`;
}

export function createInMemoryReportCacheStore(): ReportCacheStore {
  const rows = new Map<string, ReportCacheRow>();
  return {
    async findByKey(orgId, window) {
      return rows.get(key(orgId, window)) ?? null;
    },
    async upsert(row) {
      rows.set(key(row.organizationId, row.window), row);
    },
    async invalidate(orgId, window) {
      rows.delete(key(orgId, window));
    },
  };
}

export function createInMemoryPdfCacheStore(): PdfCacheStore {
  const rows = new Map<string, PdfCacheRow>();
  return {
    async findByKey(orgId, window) {
      return rows.get(key(orgId, window)) ?? null;
    },
    async upsert(row) {
      rows.set(key(row.organizationId, row.window), row);
    },
    async invalidate(orgId, window) {
      rows.delete(key(orgId, window));
    },
  };
}

function baselineKey(
  row: Pick<BaselineRow, "organizationId" | "dimension" | "metric" | "periodStart" | "periodEnd">,
): string {
  return `${row.organizationId}::${row.dimension}::${row.metric}::${row.periodStart.toISOString()}::${row.periodEnd.toISOString()}`;
}

export function createInMemoryBaselineStore(): BaselineStore {
  const rows = new Map<string, BaselineRow>();
  return {
    async listByDimension(orgId: string, dimension: BaselineDimension) {
      const out: BaselineRow[] = [];
      for (const r of rows.values()) {
        if (r.organizationId === orgId && r.dimension === dimension) {
          out.push(r);
        }
      }
      return out;
    },
    async insertMany(incoming) {
      for (const r of incoming) {
        rows.set(baselineKey(r), { ...r });
      }
    },
  };
}
