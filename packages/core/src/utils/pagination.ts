/**
 * Pagination utility types and helpers.
 */

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface PaginationParams {
  limit: number;
  offset: number;
}

/**
 * Extract and validate limit/offset from a request query object.
 * Returns sanitized pagination params with defaults.
 */
export function paginationParams(
  query: Record<string, string | undefined>,
  defaults: { limit?: number; maxLimit?: number } = {},
): PaginationParams {
  const maxLimit = defaults.maxLimit ?? 100;
  const defaultLimit = defaults.limit ?? 20;

  let limit = parseInt(query["limit"] ?? String(defaultLimit), 10);
  if (isNaN(limit) || limit < 1) limit = defaultLimit;
  if (limit > maxLimit) limit = maxLimit;

  let offset = parseInt(query["offset"] ?? "0", 10);
  if (isNaN(offset) || offset < 0) offset = 0;

  return { limit, offset };
}

/**
 * Build a PaginatedResult from an items array and total count.
 */
export function paginate<T>(
  items: T[],
  total: number,
  params: PaginationParams,
): PaginatedResult<T> {
  return {
    items,
    total,
    limit: params.limit,
    offset: params.offset,
    hasMore: params.offset + items.length < total,
  };
}
