// apps/dashboard/src/lib/data-mode/server.ts
//
// Server-only data-mode resolver. Throws at compile time if imported from
// a "use client" file (defense in depth on top of the file-split rule).

import "server-only";
import { cookies } from "next/headers";
import { DATA_MODE_COOKIE, resolveDataMode, type DataMode } from "./shared";

/**
 * Read the current data mode on the server. RSC + route handlers only.
 * Source: 'sw.data-mode' cookie, validated against production-safety guards
 * in shared.ts.
 */
export async function getDataMode(): Promise<DataMode> {
  const store = await cookies();
  return resolveDataMode(store.get(DATA_MODE_COOKIE)?.value, process.env);
}
