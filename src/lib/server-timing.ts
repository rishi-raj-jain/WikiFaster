/** A `Server-Timing` header (shown in the browser's network panel): server time including the round trips to Neon. */
export function serverTiming(totalMs: number): string {
  return `total;dur=${totalMs.toFixed(1)};desc="Server incl. Neon round trips"`
}
