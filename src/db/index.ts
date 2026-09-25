import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { AsyncLocalStorage } from 'node:async_hooks'
import * as schema from './schema'

/**
 * The app talks to Neon over the stateless SQL-over-HTTP transport, so every
 * request is a self-contained round trip with no connection to pool. Nothing
 * is cached: every page and API response queries Postgres live.
 */
function databaseUrl(): string {
  const url = process.env.DATABASE_URL_UNPOOLED
  if (!url) throw new Error('Set DATABASE_URL_UNPOOLED to a Neon connection string.')
  return url
}

export const sql = neon(databaseUrl())

/** Kept for schema-typed access and future ORM use; queries are written in SQL in `src/lib/queries.ts`. */
export const db = drizzle(sql, { schema })

export type Timed<T> = { rows: T; ms: number }

/** Runs `fn` and reports how long it took, so the UI can show live query latency. */
export async function timed<T>(fn: () => Promise<T>): Promise<Timed<T>> {
  const started = performance.now()
  const rows = await fn()
  return { rows, ms: performance.now() - started }
}

type DbTally = { ms: number; queries: number }

const tally = new AsyncLocalStorage<DbTally>()

/** Adds a round trip's Postgres-side time (and how many statements it ran) to the {@link measureDb} call it runs inside, if any. */
export function recordDbTime(ms: number, queries = 1) {
  const current = tally.getStore()
  if (!current) return
  current.ms += ms
  current.queries += queries
}

export type DbTimed<T> = {
  value: T
  /** Time spent inside Postgres, summed over every query `fn` ran (measured with clock_timestamp, so no network). */
  dbMs: number
  queries: number
  /** Wall time on the server, including every round trip to Neon. */
  totalMs: number
}

/** Runs `fn` and reports the Postgres time of every query it made, next to the total time. */
export async function measureDb<T>(fn: () => Promise<T>): Promise<DbTimed<T>> {
  const current: DbTally = { ms: 0, queries: 0 }
  const started = performance.now()
  const value = await tally.run(current, fn)
  return { value, dbMs: current.ms, queries: current.queries, totalMs: performance.now() - started }
}
