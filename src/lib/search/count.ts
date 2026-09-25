import { db } from '@/db'
import { SEARCH_TSV } from '@/db/schema'
import { sql, type SQL } from 'drizzle-orm'
import { bitmap, likeLiteral, match, prefixRange, rankingText, timeout, trigramSearchable, type SearchMode } from './results'

export type MatchCount = { count: number | null; exact: boolean }

type PlanNode = { 'Node Type'?: string; 'Index Name'?: string; 'Actual Rows'?: number; 'Plan Rows'?: number; Plans?: PlanNode[] }

function explainRoot(rows: Record<string, unknown>[]): PlanNode | null {
  const cell = rows[0]?.['QUERY PLAN']
  const plan = typeof cell === 'string' ? JSON.parse(cell) : cell
  return plan?.[0]?.Plan ?? null
}

function bitmapRows(node: PlanNode | null, index: string): number | null {
  if (!node) return null
  if (node['Node Type'] === 'Bitmap Index Scan' && node['Index Name'] === index && typeof node['Actual Rows'] === 'number') return Math.round(node['Actual Rows'])
  for (const child of node.Plans ?? []) {
    const found = bitmapRows(child, index)
    if (found != null) return found
  }
  return null
}

/**
 * Exact match count read from an index alone. A bitmap index scan reports how
 * many row pointers it produced, and when the index answers the predicate
 * without a recheck, that is the number of matching rows, found without
 * visiting the table. `EXPLAIN ANALYZE` of a one-row probe exposes it.
 */
async function bitmapCount(where: SQL, index: string): Promise<number | null> {
  try {
    const [, { rows }] = await db.batch([
      db.execute(sql`SELECT set_config('enable_seqscan', 'off', true), set_config('enable_indexscan', 'off', true), set_config('statement_timeout', '5000', true)`),
      db.execute(sql`EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF, FORMAT JSON) SELECT 1 FROM articles WHERE ${where} LIMIT 1`),
    ])
    return bitmapRows(explainRoot(rows), index)
  } catch {
    return null
  }
}

/** Exact counting of matches that need the table (phrases, negations) is abandoned after this long. */
const COUNT_TIMEOUT_MS = 1500

/**
 * `words -neg1 -neg2` as an exact count from GIN bitmap counts alone, or null
 * when the query has phrases, hyphens, more than three negations, or a negated
 * stopword (which websearch_to_tsquery ignores, so subtracting it would be wrong).
 */
async function negationCount(q: string): Promise<number | null> {
  const tokens = q.trim().match(/-?"[^"]*"|\S+/g) ?? []
  const negatives = tokens.filter((token) => token.startsWith('-') && token.length > 1).map((token) => token.slice(1))
  const positives = tokens.filter((token) => !token.startsWith('-'))
  if (negatives.length === 0 || negatives.length > 3 || positives.length === 0) return null
  if ([...positives, ...negatives].some((token) => /["-]/.test(token))) return null
  const { rows } = await db.execute<{ ok: boolean | null }>(sql`SELECT bool_and(numnode(plainto_tsquery('english', w)) > 0) AS ok FROM unnest(${sql.param(negatives)}::text[]) w`)
  if (!rows[0]?.ok) return null
  const subsets = Array.from({ length: 1 << negatives.length }, (_, mask) => negatives.filter((_, i) => mask & (1 << i)))
  const counts = await Promise.all(subsets.map((subset) => bitmapCount(sql`${sql.raw(SEARCH_TSV)} @@ plainto_tsquery('english', ${[...positives, ...subset].join(' ')})`, 'articles_search_gin')))
  if (counts.some((n) => n == null)) return null
  return subsets.reduce((total, subset, i) => total + (subset.length % 2 ? -1 : 1) * (counts[i] as number), 0)
}

/**
 * The total for "Results 1 – 20 of N".
 *
 * - Plain words: exact, from `articles_search_gin` alone, at any size
 *   ("war" counts ~500k articles in tens of milliseconds).
 * - Prefixes: exact, from the btree prefix index alone.
 * - Stopword-only title matches: exact `count(*)`; trigram matches are few.
 * - Negated words: exact, by inclusion-exclusion over GIN counts.
 * - Phrases and hyphenated words need the table to recheck word positions, so
 *   an exact count races a timeout, with the exact count of all the words
 *   combined (an upper bound) as the fallback.
 */
export async function countMatches(q: string, mode: SearchMode): Promise<MatchCount> {
  if (mode === 'prefix') {
    const [lo, hi] = prefixRange(q)
    return { count: await bitmapCount(sql`lower(title) ~>=~ ${lo} AND lower(title) ~<~ ${hi}`, 'articles_title_prefix_idx'), exact: true }
  }

  if (mode === 'title') {
    if (!trigramSearchable(q)) return { count: 0, exact: true }
    const count = await db
      .batch([timeout(COUNT_TIMEOUT_MS), db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM articles WHERE lower(title) LIKE ${`%${likeLiteral(q.toLowerCase())}%`}`)])
      .then(([, { rows }]) => rows[0]?.n ?? 0)
      .catch(() => null)
    return { count, exact: count != null }
  }

  // Quotes and hyphens become phrase operators and a leading minus a negation,
  // which GIN cannot answer without rechecking the table. Decided from the raw
  // text so the count never waits for the query analysis.
  if (!/["-]/.test(q)) {
    const exact = await bitmapCount(match(q), 'articles_search_gin')
    if (exact != null) return { count: exact, exact: true }
  }

  // Plain words with up to three `-negated` words: exact from GIN alone by
  // inclusion-exclusion, e.g. |quantum and not mechanics| =
  // |quantum| - |quantum and mechanics|, so no article is re-parsed.
  const negated = await negationCount(q)
  if (negated != null) return { count: negated, exact: true }

  // Otherwise race an exact count through GIN plus a table recheck against
  // the exact GIN count of all the positive words combined, an upper bound
  // shown as "about N" when the recheck runs out of time.
  const words = rankingText(q).replace(/["-]/g, ' ')
  const [exact, bound] = await Promise.all([
    db
      .batch([bitmap(COUNT_TIMEOUT_MS), db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM articles WHERE ${match(q)}`)])
      .then(([, { rows }]) => rows[0]?.n ?? 0)
      .catch(() => null),
    bitmapCount(sql`${sql.raw(SEARCH_TSV)} @@ plainto_tsquery('english', ${words})`, 'articles_search_gin'),
  ])
  return exact != null ? { count: exact, exact: true } : { count: bound, exact: false }
}
