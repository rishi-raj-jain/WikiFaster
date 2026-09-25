import { db } from '@/db'
import { leadImage, SEARCH_TSV } from '@/db/schema'
import type { ImageRef } from '@/lib/links'
import { sql } from 'drizzle-orm'

export const PAGE_SIZE = 20

/**
 * `lakebase_bm25` scores at most this many candidates per query
 * (`lakebase_bm25.default_limit`, hard-capped at 65535 by the extension), so it
 * also bounds how deep relevance-ranked results can page.
 */
const MAX_CANDIDATES = 65535
/** How many strong title matches lead the first page, ahead of the body ranking. */
const TITLE_BOOST = 3

export type SearchHit = { id: number; title: string; snippet: string; bytes: number; words: number; image: ImageRef | null }

/** How the query was matched, which decides the index that serves it. */
export type SearchMode = 'fulltext' | 'prefix' | 'title'

/**
 * What Postgres makes of the query text, resolved once per request. `tsquery`
 * is the parsed `websearch_to_tsquery` ('' when every word is a stopword), and
 * `suggestion` is a spelling correction from the title lexicon.
 */
export type QueryAnalysis = { tsquery: string; suggestion: string | null }

export type SearchResult = { rows: SearchHit[]; mode: SearchMode }

/**
 * Whether `text` has a run of three letters or digits, the least the trigram
 * index needs to serve `LIKE '%…%'` or `%` similarity. Without one, Postgres
 * would scan every article, so those queries are skipped instead.
 */
export function trigramSearchable(text: string): boolean {
  return /[\p{L}\p{N}]{3}/u.test(text)
}

/** Escapes `%`, `_` and `\` so user text matches literally inside LIKE. */
export function likeLiteral(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/**
 * A prefix as a `text_pattern_ops` range (`'ab'` -> `['ab', 'ac']`). Written out
 * explicitly so only the btree prefix index can serve it; a `LIKE 'ab%'` may be
 * sent to the trigram index, which cannot use fewer than three characters.
 */
export function prefixRange(q: string): [string, string] {
  const lo = q.toLowerCase()
  const last = lo.codePointAt(lo.length - 1) ?? 0
  return [lo, lo.slice(0, -1) + String.fromCodePoint(last + 1)]
}

/** Escapes regex metacharacters so user text matches literally inside `~`. */
function regexLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Planner settings, applied transaction-locally by a statement batched ahead of
 * the query (`db.batch` sends both in one round trip). Relevance pages off the
 * ranked BM25 stream of `limit` candidates, never a bitmap + sort or a seq scan.
 */
function ranked(limit: number) {
  return db.execute(
    sql`SELECT set_config('enable_bitmapscan', 'off', true), set_config('enable_seqscan', 'off', true), set_config('lakebase_bm25.default_limit', ${String(limit)}, true), set_config('statement_timeout', '5000', true)`,
  )
}

/** Sparse matches: collect them all through GIN, then sort, stopping after `timeoutMs`. */
export function bitmap(timeoutMs = 5000) {
  return db.execute(sql`SELECT set_config('enable_indexscan', 'off', true), set_config('enable_seqscan', 'off', true), set_config('work_mem', '64MB', true), set_config('statement_timeout', ${String(timeoutMs)}, true)`)
}

/** Stops a query that could read many rows after `timeoutMs`. */
export function timeout(timeoutMs = 5000) {
  return db.execute(sql`SELECT set_config('statement_timeout', ${String(timeoutMs)}, true)`)
}

export async function analyzeQuery(q: string): Promise<QueryAnalysis> {
  if (q.length <= 2) return { tsquery: '', suggestion: null }
  const [tsquery, suggestion] = await Promise.all([db.execute<{ tsq: string }>(sql`SELECT websearch_to_tsquery('english', ${q})::text AS tsq`).then(({ rows }) => rows[0]?.tsq ?? ''), suggestCorrection(q)])
  return { tsquery, suggestion }
}

/**
 * Typo tolerance, as in hn-search. `search_terms` is a lexicon of title words
 * with their document counts, trigram-indexed. Each plain word is matched to a
 * lexicon word within an edit distance that grows with the word: 1 edit up to 5
 * letters, 2 up to 7, and 3 from 8 letters ("einstien" -> "einstein").
 * Swapping two neighbouring letters counts as one edit. A replacement is only
 * offered when it is at least 50x more common than the typed word, so rare but
 * real words are left alone. Returns null when nothing changes or the lexicon
 * is empty.
 */
async function suggestCorrection(q: string): Promise<string | null> {
  try {
    const [, { rows }] = await db.batch([
      db.execute(sql`SELECT set_config('pg_trgm.similarity_threshold', '0.2', true), set_config('statement_timeout', '5000', true)`),
      db.execute<{ corrected: string; changed: boolean }>(sql`SELECT string_agg(coalesce(best.word, w.word), ' ' ORDER BY w.ord) AS corrected,
              coalesce(bool_or(best.word IS NOT NULL), false) AS changed
       FROM unnest(regexp_split_to_array(lower(trim(${q})), '\\s+')) WITH ORDINALITY AS w(word, ord)
       CROSS JOIN LATERAL (SELECT coalesce((SELECT k.ndoc FROM search_terms k WHERE k.word = w.word), 0) AS ndoc) typed
       LEFT JOIN LATERAL (
         -- Only rare words can be typos worth fixing: a correction must be 50x
         -- more common, so a word in 100+ titles is left alone. These guards
         -- reference only the outer word, so Postgres runs them as one-time
         -- filters and skips the lexicon scans for common words ("black").
         SELECT c.word FROM (
           SELECT t.word, t.ndoc, levenshtein(t.word, w.word) AS dist FROM search_terms t
           WHERE typed.ndoc < 100 AND length(w.word) >= 4 AND w.word ~ '^[a-z]+$' AND t.word % w.word
           UNION ALL
           SELECT t.word, t.ndoc, 1 FROM generate_series(1, length(w.word) - 1) i
           JOIN search_terms t ON t.word = substr(w.word, 1, i - 1) || substr(w.word, i + 1, 1) || substr(w.word, i, 1) || substr(w.word, i + 2)
           WHERE typed.ndoc < 100 AND length(w.word) >= 4 AND w.word ~ '^[a-z]+$'
         ) c
         WHERE c.word <> w.word
           AND c.dist <= CASE WHEN length(w.word) <= 5 THEN 1 WHEN length(w.word) <= 7 THEN 2 ELSE 3 END
           AND c.ndoc >= greatest(20, 50 * typed.ndoc)
         ORDER BY c.dist, c.ndoc DESC
         LIMIT 1
       ) best ON true`),
    ])
    return rows[0]?.changed ? rows[0].corrected : null
  } catch {
    return null
  }
}

/** The words BM25 should rank by: the query minus its `-negated` words and phrases. */
export function rankingText(q: string): string {
  return q.replace(/(^|\s)-("[^"]*"|\S+)/g, ' ').trim() || q
}

/** The query's words matched against the full-text document, as both search indexes are built on it. */
export function match(q: string) {
  return sql`${sql.raw(SEARCH_TSV)} @@ websearch_to_tsquery('english', ${q})`
}

/**
 * `ts_headline` with control characters as match markers, so the snippet is
 * rendered as text with <b> spans in React and never as HTML from the database.
 */
function headline(q: string) {
  return sql`ts_headline('english', left(text, 8000), websearch_to_tsquery('english', ${q}), 'StartSel=\u0001, StopSel=\u0002, MaxFragments=2, MaxWords=18, MinWords=8, FragmentDelimiter=" … "')`
}

/** Size and word count for the result's gray data line ("14 KB (1,519 words)"). */
const STATS = sql.raw(`octet_length(text) AS bytes, length(text) - length(replace(text, ' ', '')) + 1 AS words`)

/** Which index a query goes to (see {@link searchArticles}). */
export function searchMode(q: string, analysis: QueryAnalysis): SearchMode {
  if (q.length <= 2) return 'prefix'
  return analysis.tsquery === '' ? 'title' : 'fulltext'
}

/**
 * Up to {@link TITLE_BOOST} articles whose title contains every query word,
 * read off `articles_title_bm25` (top 100 by title BM25), then ordered with an
 * exact title first and the most substantial article next. Article size is the
 * stand-in for Wikipedia's popularity signal: "einstein" leads with "Albert
 * Einstein" rather than "Einstein (surname)".
 */
async function titleMatches(q: string): Promise<SearchHit[]> {
  const [, { rows }] = await db.batch([
    ranked(100),
    db.execute<SearchHit>(sql`
      SELECT id::int AS id, title, ${headline(q)} AS snippet, ${STATS}, ${leadImage('boosted')} AS image FROM (
        SELECT id, title, text FROM (
          SELECT id, title, text FROM articles
          ORDER BY to_tsvector('english', title) <@> to_bm25query(to_tsvector('english', ${rankingText(q)}), 'articles_title_bm25') LIMIT 100
        ) candidates
        WHERE to_tsvector('english', title) @@ websearch_to_tsquery('english', ${q})
        ORDER BY lower(title) = lower(${q}) DESC, octet_length(text) DESC
        LIMIT ${sql.raw(String(TITLE_BOOST))}
      ) boosted`),
  ])
  return rows
}

/**
 * The body ranking: the top candidates are read off `articles_search_bm25` and
 * kept when they match every word, skipping the boosted title matches. When
 * that leaves the page short (a rare AND, a phrase), the matches are few by
 * definition, so they are collected through `articles_search_gin` and ranked
 * exactly. Snippets are built only for the rows on the page.
 */
async function bodyMatches(q: string, offset: number, limit: number, skip: number[]): Promise<SearchHit[]> {
  if (limit <= 0) return []
  const candidates = Math.min(MAX_CANDIDATES, offset + limit + skip.length + 20) | 0
  const bm25 = sql`${sql.raw(SEARCH_TSV)} <@> to_bm25query(to_tsvector('english', ${rankingText(q)}), 'articles_search_bm25')`
  // One plain word: every BM25 candidate contains it, so the all-words check
  // (which re-parses the article) is skipped. Otherwise it runs on the stream in
  // rank order and stops as soon as the page is full.
  const hit = /^[^\s"-]+$/.test(q.trim()) ? sql`true` : match(q)
  const window = async (size: number) => {
    const [, { rows }] = await db.batch([
      ranked(size),
      db.execute<SearchHit>(sql`
        SELECT id::int AS id, title, ${headline(q)} AS snippet, ${STATS}, ${leadImage('page')} AS image FROM (
          SELECT id, title, text, pos FROM (
            SELECT id, title, text, row_number() OVER () AS pos
            FROM (SELECT id, title, text FROM articles ORDER BY ${bm25} LIMIT ${sql.raw(String(size))}) candidates
          ) scored
          WHERE id <> ALL(${sql.param(skip)}::bigint[]) AND ${hit} LIMIT ${limit} OFFSET ${Math.max(0, offset)}
        ) page ORDER BY pos`),
    ])
    return rows
  }
  let rows = await window(candidates)
  // Short page: several words that rarely appear together. A wider window of
  // the ranked stream usually fills it, still without a sort over every match.
  if (rows.length < limit) rows = await window(Math.min(MAX_CANDIDATES, candidates * 10 + 500) | 0)
  if (rows.length === limit) return rows
  const [, exact] = await db.batch([
    bitmap(),
    db.execute<SearchHit>(sql`
      SELECT id::int AS id, title, ${headline(q)} AS snippet, ${STATS}, ${leadImage('page')} AS image FROM (
        SELECT id, title, text FROM articles WHERE ${match(q)} AND id <> ALL(${sql.param(skip)}::bigint[])
        ORDER BY ${bm25} LIMIT ${limit} OFFSET ${Math.max(0, offset)}
      ) page`),
  ])
  return exact.rows
}

/**
 * One page of results. Which index serves it depends on the query:
 *
 * - **1-2 characters**: title prefix through `articles_title_prefix_idx`.
 * - **only stopwords** ("the who", "to be or not to be"): the english tsvector
 *   indexed none of those words, so titles containing the phrase are matched
 *   through the trigram index instead.
 * - **full text**: the top candidates are read off `articles_search_bm25` and
 *   kept when they match every word. When that leaves the page short (a rare
 *   AND, a phrase), the matches are few by definition, so they are collected
 *   through `articles_search_gin` and ranked exactly.
 *
 * Snippets are built only for the rows on the page.
 */
export async function searchArticles(q: string, page: number, analysis: QueryAnalysis): Promise<SearchResult> {
  const offset = (page - 1) * PAGE_SIZE
  const mode = searchMode(q, analysis)

  if (mode === 'prefix') {
    const [lo, hi] = prefixRange(q)
    const { rows } = await db.execute<SearchHit>(sql`
      SELECT id::int AS id, title, left(text, 300) AS snippet, ${STATS}, ${leadImage()} AS image FROM articles
      WHERE lower(title) ~>=~ ${lo} AND lower(title) ~<~ ${hi} ORDER BY lower(title) USING ~<~ LIMIT ${PAGE_SIZE} OFFSET ${offset}`)
    return { rows, mode: 'prefix' }
  }

  if (mode === 'title') {
    if (!trigramSearchable(q)) return { rows: [], mode: 'title' }
    const lower = q.toLowerCase()
    const [, { rows }] = await db.batch([
      timeout(),
      // Exact title first, then whole-word phrase matches ("The Who" before
      // "The Whores"), then the most substantial articles.
      db.execute<SearchHit>(sql`
        SELECT id::int AS id, title, left(text, 300) AS snippet, ${STATS}, ${leadImage()} AS image FROM articles
        WHERE lower(title) LIKE ${`%${likeLiteral(lower)}%`}
        ORDER BY lower(title) = ${lower} DESC, lower(title) ~ ${`(^|\\W)${regexLiteral(lower)}($|\\W)`} DESC, octet_length(text) DESC, title LIMIT ${PAGE_SIZE} OFFSET ${offset}`),
    ])
    return { rows, mode: 'title' }
  }

  if (page === 1) {
    // Title matches and the body ranking are independent here, so both run at
    // once; the body over-fetches by the boost size and duplicates are dropped.
    const [boosted, body] = await Promise.all([titleMatches(q), bodyMatches(q, 0, PAGE_SIZE, [])])
    const ids = new Set(boosted.map((row) => row.id))
    return { rows: [...boosted, ...body.filter((row) => !ids.has(row.id))].slice(0, PAGE_SIZE), mode: 'fulltext' }
  }
  // Later pages continue the body ranking after the boosted titles, which it skips.
  const boosted = await titleMatches(q)
  const rows = await bodyMatches(
    q,
    offset - boosted.length,
    PAGE_SIZE,
    boosted.map((row) => row.id),
  )
  return { rows, mode: 'fulltext' }
}
