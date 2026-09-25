import { NeonLogo } from '@/components/logos'
import { formatMs } from '@/lib/format'
import { cn } from 'cn'

function Dot() {
  return (
    <span aria-hidden="true" className="text-(--neon-subtle)">
      ·
    </span>
  )
}

function Metric({ value, label, accent = false }: { value: string; label: React.ReactNode; accent?: boolean }) {
  return (
    <span className="whitespace-nowrap">
      <span className={cn('font-(family-name:--font-neon-mono) font-medium tabular-nums', accent ? 'text-(--neon-green)' : 'text-(--neon-text)')}>{value}</span> <span className="text-(--neon-subtle)">{label}</span>
    </span>
  )
}

/**
 * The bar under the tab bar on every page, in Neon UI's dark style: how long
 * the queries took, including the round trips to Neon.
 * `status` stands in for the numbers until there are some ("querying…"), and
 * `dim` fades stale numbers while a new query runs.
 */
export function DbTimingBar({ totalMs, status, dim = false }: { totalMs?: number; status?: string; dim?: boolean }) {
  return (
    <div
      role="status"
      className="mt-3 flex flex-col gap-1 rounded-[0.5rem] border border-(--neon-border) bg-(--neon-bg) px-3.5 py-2 text-sm leading-snug text-(--neon-text) sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2.5"
    >
      <a href="https://neon.com" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 font-semibold whitespace-nowrap text-(--neon-text)! hover:no-underline">
        <NeonLogo className="h-[1.2em] w-auto" />
        <span>Postgres</span>
      </a>
      {/* On a phone the metrics get their own line, so no dot leads a wrapped row. */}
      <span className="max-sm:hidden">
        <Dot />
      </span>
      {status || totalMs == null ? (
        <span className="text-(--neon-subtle)">{status}</span>
      ) : (
        <span className={cn('flex flex-wrap items-center gap-x-2.5 *:transition-opacity', dim && '*:opacity-50')}>
          <Metric value={`${formatMs(totalMs)} ms`} label="total" accent />
        </span>
      )}
    </div>
  )
}
