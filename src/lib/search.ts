import { measureDb } from '@/db'
import { analyzeQuery, countMatches, PAGE_SIZE, searchArticles, searchMode, type MatchCount, type QueryAnalysis, type SearchHit, type SearchMode } from '@/lib/queries'

/** One page of results with its exact total, as `/api/search` returns it. */
export type SearchPayload = {
  q: string
  page: number
  rows: SearchHit[]
  mode: SearchMode
  count: MatchCount | null
  /** Server wall time for the results and the count, including the round trips to Neon. */
  ms: number
  /** Time spent inside Postgres, summed over every query the search ran. */
  dbMs: number
  /** How many queries that was. */
  queries: number
  error: string | null
  /** The query the rows are for when a typo was auto-corrected, else null. */
  corrected: string | null
  /** "Did you mean" for the typed query, when it was not applied. */
  suggestion: string | null
}

export function pageNumber(page: string | null | undefined): number {
  return Math.min(1000, Math.max(1, Number(page) || 1))
}

/** Stands in for the analysis while it runs in parallel: any non-empty tsquery selects full text. */
const ASSUME_FULLTEXT: QueryAnalysis = { tsquery: '?', suggestion: null }

/**
 * One database round trip in the common case: the query analysis (stopwords,
 * typo suggestion), the full-text results and the exact count all start
 * together. Only when every word turns out to be a stopword is the search redone
 * as a title match. Short queries are prefix matches and need no analysis.
 */
async function searchWithCount(q: string, page: number) {
  const started = performance.now()
  const count = (analysis: QueryAnalysis) => countMatches(q, analysis, searchMode(q, analysis)).catch(() => null)
  if (q.length <= 2) {
    const analysis: QueryAnalysis = { tsquery: '', suggestion: null }
    const [result, total] = await Promise.all([searchArticles(q, page, analysis), count(analysis)])
    return { analysis, result, count: total, ms: performance.now() - started }
  }
  const [analysis, fulltext, fulltextCount] = await Promise.all([analyzeQuery(q), searchArticles(q, page, ASSUME_FULLTEXT), count(ASSUME_FULLTEXT)])
  if (analysis.tsquery !== '') return { analysis, result: fulltext, count: fulltextCount, ms: performance.now() - started }
  const [result, total] = await Promise.all([searchArticles(q, page, analysis), count(analysis)])
  return { analysis, result, count: total, ms: performance.now() - started }
}

/**
 * Runs a search and its count. When the typed words match little and a word
 * looks like a typo, the correction is searched instead, the way a search
 * engine would ("Showing results for einstein"), unless `verbatim` is set.
 */
export async function runSearch(q: string, page: number, verbatim = false): Promise<SearchPayload> {
  const { value, dbMs, queries, totalMs } = await measureDb(() => searchOnce(q, page, verbatim))
  return { ...value, ms: totalMs, dbMs, queries }
}

async function searchOnce(q: string, page: number, verbatim: boolean): Promise<Omit<SearchPayload, 'dbMs' | 'queries'>> {
  const empty = { q, page, rows: [], mode: 'fulltext' as const, count: null, ms: 0, corrected: null, suggestion: null }
  if (!q) return { ...empty, error: null }
  try {
    const typed = await searchWithCount(q, page)
    const suggestion = typed.analysis.suggestion
    // Like Wikipedia, a likely typo is corrected when the typed words match
    // little: no full page of results, or only a handful of articles in total.
    const sparse = typed.result.rows.length < PAGE_SIZE || (typed.count?.count != null && typed.count.count < 50)
    if (sparse && page === 1 && suggestion && !verbatim) {
      const fixed = await searchWithCount(suggestion, page)
      return { ...empty, rows: fixed.result.rows, mode: fixed.result.mode, count: fixed.count, ms: typed.ms + fixed.ms, error: null, corrected: suggestion }
    }
    return { ...empty, rows: typed.result.rows, mode: typed.result.mode, count: typed.count, ms: typed.ms, error: null, suggestion }
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : 'Search failed' }
  }
}
