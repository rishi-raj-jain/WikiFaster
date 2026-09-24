/** Milliseconds with one decimal below 10 ("0.8", "12"). */
export function formatMs(ms: number): string {
  return ms < 10 ? ms.toFixed(1) : ms.toFixed(0)
}
