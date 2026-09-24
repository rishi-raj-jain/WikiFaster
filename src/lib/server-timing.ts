/**
 * A `Server-Timing` header (shown in the browser's network panel): time inside
 * Postgres, and total server time including the round trips to Neon.
 */
export function serverTiming(dbMs: number, totalMs: number): string {
  return `db;dur=${dbMs.toFixed(2)};desc="Postgres", total;dur=${totalMs.toFixed(1)};desc="Server incl. Neon round trips"`
}
