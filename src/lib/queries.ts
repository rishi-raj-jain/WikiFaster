import { db, recordDbTime, sql, timed } from '@/db'
import { articles, SEARCH_TSV, siteStats } from '@/db/schema'
import type { ImageRef } from '@/lib/links'
import { asc, desc, eq, gt, inArray, lt, sql as dsql } from 'drizzle-orm'

export const PAGE_SIZE = 20

/**
 * `lakebase_bm25` scores at most this many candidates per query
 * (`lakebase_bm25.default_limit`, hard-capped at 65535 by the extension), so it
 * also bounds how deep relevance-ranked results can page.
 */
const MAX_CANDIDATES = 65535
const BM25_INDEX = 'articles_search_bm25'
const TITLE_BM25_INDEX = 'articles_title_bm25'
/** How many strong title matches lead the first page, ahead of the body ranking. */
const TITLE_BOOST = 3

type Row = Record<string, unknown>

/** `image` is the article's lead image, or null when it has none. */
export type ArticleRecord = { id: number; url: string; title: string; text: string; image: ImageRef | null }
export type Suggestion = { id: number; title: string; description: string; image: ImageRef | null }
export type SearchHit = { id: number; title: string; snippet: string; bytes: number; words: number; image: ImageRef | null }

/** How the query was matched, which decides the index that serves it. */
export type SearchMode = 'fulltext' | 'prefix' | 'title'

/**
 * What Postgres makes of the query text, resolved once per request. `tsquery`
 * is the parsed `websearch_to_tsquery` ('' when every word is a stopword), and
 * `suggestion` is a spelling correction from the title lexicon.
 */
export type QueryAnalysis = { tsquery: string; suggestion: string | null }

export type SearchResult = { rows: SearchHit[]; mode: SearchMode; ms: number }
export type MatchCount = { count: number | null; exact: boolean; ms: number }

function asInt(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

function push(values: unknown[], value: unknown): string {
  values.push(value)
  return `$${values.length}`
}

/**
 * A prefix as a `text_pattern_ops` range (`'ab'` -> `['ab', 'ac']`). Written out
 * explicitly so only the btree prefix index can serve it; a `LIKE 'ab%'` may be
 * sent to the trigram index, which cannot use fewer than three characters.
 */
function prefixRange(q: string): [string, string] {
  const lo = q.toLowerCase()
  const last = lo.codePointAt(lo.length - 1) ?? 0
  return [lo, lo.slice(0, -1) + String.fromCodePoint(last + 1)]
}

/** Escapes regex metacharacters so user text matches literally inside `~`. */
function regexLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Escapes `%`, `_` and `\` so user text matches literally inside LIKE. */
function likeLiteral(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`)
}

type Settings = Record<string, string | number>
/** Relevance: page off the ranked BM25 stream, never a bitmap + sort or a seq scan. */
const RANKED: Settings = { enable_bitmapscan: 'off', enable_seqscan: 'off' }
/** Sparse matches: collect them all through GIN, then sort. */
const BITMAP: Settings = { enable_indexscan: 'off', enable_seqscan: 'off', work_mem: '64MB' }

/** No search query may run longer than this, whatever plan it ends up with. */
const STATEMENT_TIMEOUT_MS = 5000

/** Marks the start of the timed statement inside the transaction (transaction-local setting). */
const MARK = `SELECT set_config('wiki.started', clock_timestamp()::text, true)`
/** Postgres-side milliseconds since {@link MARK}: execution and building the result, no network. */
const ELAPSED = `SELECT (extract(epoch FROM clock_timestamp() - current_setting('wiki.started')::timestamptz) * 1000)::float8 AS ms`

type Statement = { text: string; values: unknown[] }

/**
 * Runs `statements` in one transaction, so one HTTP round trip however many
 * there are: `SET LOCAL` for `settings` and a statement timeout, then the
 * statements between two clock reads, so each round trip reports how long
 * Postgres itself spent on it (see `measureDb`). SET cannot be parameterized,
 * so every setting is an internal constant or a computed integer, never user text.
 */
async function runAll(settings: Settings | null, statements: Statement[]): Promise<Row[][]> {
  const entries = Object.entries({ statement_timeout: STATEMENT_TIMEOUT_MS, ...settings })
  const result = (await sql.transaction([
    ...entries.map(([key, value]) => sql.query(`SET LOCAL ${key} = '${value}'`)),
    sql.query(MARK),
    ...statements.map((statement) => sql.query(statement.text, statement.values)),
    sql.query(ELAPSED),
  ])) as Row[][]
  recordDbTime(Number(result.at(-1)?.[0]?.ms) || 0, statements.length)
  return result.slice(entries.length + 1, entries.length + 1 + statements.length)
}

async function run(settings: Settings | null, text: string, values: unknown[] = []): Promise<Row[]> {
  const [rows] = await runAll(settings, [{ text, values }])
  return rows
}

/** A query built with Drizzle, as a statement for {@link runAll}. */
function built(query: { toSQL(): { sql: string; params: unknown[] } }): Statement {
  const { sql: text, params } = query.toSQL()
  return { text, values: params }
}

/** Runs a query built with Drizzle through {@link run}, so it is timed like every other query. */
async function runBuilt(query: { toSQL(): { sql: string; params: unknown[] } }): Promise<Row[]> {
  const { text, values } = built(query)
  return run(null, text, values)
}

function asImage(value: unknown): ImageRef | null {
  if (!value || typeof value !== 'object') return null
  const { file, stored } = value as Record<string, unknown>
  return typeof file === 'string' ? { file, stored: typeof stored === 'string' ? stored : null } : null
}

/**
 * The lead image of the row aliased `alias`, as a JSON `image` column
 * (`{ file, stored }`): one probe of the `article_images` primary key, null
 * when the article has none.
 */
function imageExpression(alias: string): string {
  return `(SELECT json_build_object('file', file, 'stored', stored) FROM article_images WHERE article_images.id = ${alias}.id)`
}

function imageOf(alias: string): string {
  return `${imageExpression(alias)} AS image`
}

function asArticle(row: Row): ArticleRecord {
  return { id: asInt(row.id), url: String(row.url), title: String(row.title), text: String(row.text), image: asImage(row.image) }
}

// ---------------------------------------------------------------------------
// Articles

const ARTICLE_COLUMNS = {
  id: articles.id,
  url: articles.url,
  title: articles.title,
  text: articles.text,
  // Written out in SQL: Drizzle renders both ids as a bare "id", which the subquery would read as its own.
  image: dsql.raw(imageExpression('articles')).as('image'),
}

/** An article and its alphabetical neighbours (the titles just before and after it), for the previous/next links. */
export type ArticleRead = { article: ArticleRecord | null; prev: string | null; next: string | null }

/**
 * Reads the article and its neighbours in one round trip. The neighbours are
 * one step backward and forward along the unique title index
 * (`articles_title_key`, index-only), so they cost well under a millisecond
 * and work for a missing title too: they show where it would sit.
 */
export async function readArticle(title: string): Promise<ArticleRead> {
  const [rows, before, after] = await runAll(null, [
    built(db.select(ARTICLE_COLUMNS).from(articles).where(eq(articles.title, title)).limit(1)),
    built(db.select({ title: articles.title }).from(articles).where(lt(articles.title, title)).orderBy(desc(articles.title)).limit(1)),
    built(db.select({ title: articles.title }).from(articles).where(gt(articles.title, title)).orderBy(asc(articles.title)).limit(1)),
  ])
  return { article: rows[0] ? asArticle(rows[0]) : null, prev: before[0] ? String(before[0].title) : null, next: after[0] ? String(after[0].title) : null }
}

/** The stored spelling of a title typed in any case ("albert einstein" -> "Albert Einstein"), via the lower(title) index. */
export async function canonicalTitle(title: string): Promise<string | null> {
  const [row] = await runBuilt(
    db
      .select({ title: articles.title })
      .from(articles)
      .where(dsql`lower(${articles.title}) = lower(${title})`)
      .orderBy(dsql`${articles.title} = ${title} DESC`)
      .limit(1),
  )
  return row ? String(row.title) : null
}

/** Which of `titles` exist, so "See also" links render blue or red like on Wikipedia. */
export async function existingTitles(titles: string[]): Promise<Set<string>> {
  if (titles.length === 0) return new Set()
  const rows = await runBuilt(db.select({ title: articles.title }).from(articles).where(inArray(articles.title, titles)))
  return new Set(rows.map((row) => String(row.title)))
}

/**
 * Picks `count` random articles of at least `minBytes`. Each pick seeks the
 * primary key from a random id between the smallest and largest, so it costs
 * one index probe instead of `ORDER BY random()` over 6.4M rows. `random()` is
 * computed per outer row (the `g * 0` keeps it from being hoisted), and the
 * seek compares against that plain value so it stays an index condition.
 */
function randomArticlesStatement(count: number, minBytes: number, leadChars: number): Statement {
  return {
    text: `WITH bounds AS (SELECT min(id) AS lo, max(id) - min(id) AS span FROM articles)
     SELECT a.id, a.url, a.title, a.text, a.image
     FROM generate_series(1, $1::int) g
     CROSS JOIN bounds
     CROSS JOIN LATERAL (SELECT bounds.lo + floor(random() * bounds.span)::bigint + g * 0 AS pick) r
     CROSS JOIN LATERAL (
       SELECT id, url, title, left(text, $3::int) AS text, ${imageOf('articles')} FROM articles
       WHERE id >= r.pick AND octet_length(text) >= $2::int
       ORDER BY id LIMIT 1
     ) a`,
    values: [count, minBytes, leadChars],
  }
}

/** Two picks can land on the same article; keep the first. */
function uniqueArticles(rows: Row[]): ArticleRecord[] {
  const seen = new Set<number>()
  return rows.map(asArticle).filter((row) => !seen.has(row.id) && seen.add(row.id))
}

export async function randomArticles(count: number, minBytes = 0, leadChars = 2000): Promise<ArticleRecord[]> {
  const { text, values } = randomArticlesStatement(count, minBytes, leadChars)
  return uniqueArticles(await run(null, text, values))
}

export async function randomTitle(): Promise<string | null> {
  const [row] = await randomArticles(1, 0, 0)
  return row?.title ?? null
}

/** Exact article count for the Main Page, from the trigger-maintained `site_stats` row. */
function articleCountStatement(): Statement {
  return built(db.select({ articles: siteStats.articles }).from(siteStats).limit(1))
}

// ---------------------------------------------------------------------------
// Search-box suggestions

/**
 * Suggestions as the user types, like Wikipedia's search dropdown:
 *   1. titles starting with the text (`articles_title_prefix_idx`), exact match
 *      first, then the longest articles, a stand-in for popularity;
 *   2. then titles containing it (`articles_title_trgm_idx`);
 *   3. then, if still nothing, titles that look like a misspelling of it
 *      (trigram similarity on the same index).
 */
export async function suggest(term: string, limit = 10): Promise<Suggestion[]> {
  const q = term.trim().toLowerCase()
  if (!q) return []
  const found = new Map<string, Suggestion>()
  const add = (rows: Row[]) =>
    rows.forEach((row) => {
      const title = String(row.title)
      if (found.size < limit && !found.has(title)) found.set(title, { id: asInt(row.id), title, description: String(row.lead ?? ''), image: asImage(row.image) })
    })

  add(
    await run(
      null,
      `SELECT id, title, left(text, 400) AS lead, ${imageOf('prefix')} FROM (
         SELECT id, title, text FROM articles WHERE lower(title) LIKE $1 ORDER BY lower(title) USING ~<~ LIMIT 200
       ) prefix
       ORDER BY lower(title) = $2 DESC, pg_column_size(text) DESC
       LIMIT $3`,
      [`${likeLiteral(q)}%`, q, limit],
    ),
  )
  if (found.size < limit && q.length >= 3) {
    add(
      await run(
        null,
        `SELECT id, title, left(text, 400) AS lead, ${imageOf('contains')} FROM (
           SELECT id, title, text FROM articles WHERE lower(title) LIKE $1 LIMIT 200
         ) contains
         ORDER BY pg_column_size(text) DESC
         LIMIT $2`,
        [`%${likeLiteral(q)}%`, limit],
      ),
    )
  }
  if (found.size === 0 && q.length >= 4) {
    add(
      await run(
        { 'pg_trgm.similarity_threshold': 0.45 },
        `SELECT id, title, left(text, 400) AS lead, ${imageOf('articles')} FROM articles
         WHERE lower(title) % $1
         ORDER BY similarity(lower(title), $1) DESC, pg_column_size(text) DESC
         LIMIT $2`,
        [q, limit],
      ),
    )
  }
  return [...found.values()]
}

// ---------------------------------------------------------------------------
// Full search

export async function analyzeQuery(q: string): Promise<QueryAnalysis> {
  if (q.length <= 2) return { tsquery: '', suggestion: null }
  const [tsquery, suggestion] = await Promise.all([run(null, `SELECT websearch_to_tsquery('english', $1)::text AS tsq`, [q]).then((rows) => String(rows[0]?.tsq ?? '')), suggestCorrection(q)])
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
    const rows = await run(
      { 'pg_trgm.similarity_threshold': 0.2 },
      `SELECT string_agg(coalesce(best.word, w.word), ' ' ORDER BY w.ord) AS corrected,
              coalesce(bool_or(best.word IS NOT NULL), false) AS changed
       FROM unnest(regexp_split_to_array(lower(trim($1)), '\\s+')) WITH ORDINALITY AS w(word, ord)
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
       ) best ON true`,
      [q],
    )
    return rows[0]?.changed ? String(rows[0].corrected) : null
  } catch {
    return null
  }
}

/** The words BM25 should rank by: the query minus its `-negated` words and phrases. */
function rankingText(q: string): string {
  return q.replace(/(^|\s)-("[^"]*"|\S+)/g, ' ').trim() || q
}

const MATCH = `${SEARCH_TSV} @@ websearch_to_tsquery('english', $1)`
const TITLE_TSV = `to_tsvector('english', title)`

/**
 * `ts_headline` with control characters as match markers, so the snippet is
 * rendered as text with <b> spans in React and never as HTML from the database.
 */
const HEADLINE = `ts_headline('english', left(text, 8000), websearch_to_tsquery('english', $1), 'StartSel=\u0001, StopSel=\u0002, MaxFragments=2, MaxWords=18, MinWords=8, FragmentDelimiter=" … "')`

/** Size and word count for the result's gray data line ("14 KB (1,519 words)"). */
const STATS = `octet_length(text) AS bytes, length(text) - length(replace(text, ' ', '')) + 1 AS words`

function asHit(row: Row): SearchHit {
  return { id: asInt(row.id), title: String(row.title), snippet: String(row.snippet ?? ''), bytes: asInt(row.bytes), words: asInt(row.words), image: asImage(row.image) }
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
async function titleMatches(q: string): Promise<Row[]> {
  return run(
    { ...RANKED, 'lakebase_bm25.default_limit': 100 },
    `SELECT id, title, ${HEADLINE} AS snippet, ${STATS}, ${imageOf('boosted')} FROM (
       SELECT id, title, text FROM (
         SELECT id, title, text FROM articles
         ORDER BY ${TITLE_TSV} <@> to_bm25query(to_tsvector('english', $2), '${TITLE_BM25_INDEX}') LIMIT 100
       ) candidates
       WHERE ${TITLE_TSV} @@ websearch_to_tsquery('english', $1)
       ORDER BY lower(title) = lower($1) DESC, octet_length(text) DESC
       LIMIT ${TITLE_BOOST}
     ) boosted`,
    [q, rankingText(q)],
  )
}

/**
 * The body ranking: the top candidates are read off `articles_search_bm25` and
 * kept when they match every word, skipping the boosted title matches. When
 * that leaves the page short (a rare AND, a phrase), the matches are few by
 * definition, so they are collected through `articles_search_gin` and ranked
 * exactly. Snippets are built only for the rows on the page.
 */
async function bodyMatches(q: string, offset: number, limit: number, skip: number[]): Promise<Row[]> {
  if (limit <= 0) return []
  const candidates = Math.min(MAX_CANDIDATES, offset + limit + skip.length + 20) | 0
  const bm25 = `${SEARCH_TSV} <@> to_bm25query(to_tsvector('english', $2), '${BM25_INDEX}')`
  const values = [q, rankingText(q), limit, Math.max(0, offset), skip]
  // One plain word: every BM25 candidate contains it, so the all-words check
  // (which re-parses the article) is skipped. Otherwise it runs on the stream in
  // rank order and stops as soon as the page is full.
  const hit = /^[^\s"-]+$/.test(q.trim()) ? 'true' : MATCH
  const window = (size: number) =>
    run(
      { ...RANKED, 'lakebase_bm25.default_limit': size },
      `SELECT id, title, ${HEADLINE} AS snippet, ${STATS}, ${imageOf('page')} FROM (
         SELECT id, title, text, pos FROM (
           SELECT id, title, text, row_number() OVER () AS pos
           FROM (SELECT id, title, text FROM articles ORDER BY ${bm25} LIMIT ${size}) candidates
         ) scored
         WHERE id <> ALL($5::bigint[]) AND ${hit} LIMIT $3 OFFSET $4
       ) page ORDER BY pos`,
      values,
    )
  let ranked = await window(candidates)
  // Short page: several words that rarely appear together. A wider window of
  // the ranked stream usually fills it, still without a sort over every match.
  if (ranked.length < limit) ranked = await window(Math.min(MAX_CANDIDATES, candidates * 10 + 500) | 0)
  if (ranked.length === limit) return ranked
  return run(
    BITMAP,
    `SELECT id, title, ${HEADLINE} AS snippet, ${STATS}, ${imageOf('page')} FROM (
       SELECT id, title, text FROM articles WHERE ${MATCH} AND id <> ALL($5::bigint[])
       ORDER BY ${bm25} LIMIT $3 OFFSET $4
     ) page`,
    values,
  )
}

export async function searchArticles(q: string, page: number, analysis: QueryAnalysis): Promise<SearchResult> {
  const offset = (page - 1) * PAGE_SIZE
  const mode = searchMode(q, analysis)

  if (mode === 'prefix') {
    const { rows, ms } = await timed(() =>
      run(
        null,
        `SELECT id, title, left(text, 300) AS snippet, ${STATS}, ${imageOf('articles')} FROM articles
         WHERE lower(title) ~>=~ $1 AND lower(title) ~<~ $2 ORDER BY lower(title) USING ~<~ LIMIT $3 OFFSET $4`,
        [...prefixRange(q), PAGE_SIZE, offset],
      ),
    )
    return { rows: rows.map(asHit), mode: 'prefix', ms }
  }

  if (mode === 'title') {
    const { rows, ms } = await timed(() =>
      run(
        null,
        // Exact title first, then whole-word phrase matches ("The Who" before
        // "The Whores"), then the most substantial articles.
        `SELECT id, title, left(text, 300) AS snippet, ${STATS}, ${imageOf('articles')} FROM articles
         WHERE lower(title) LIKE $1
         ORDER BY lower(title) = $2 DESC, lower(title) ~ $3 DESC, octet_length(text) DESC, title LIMIT $4 OFFSET $5`,
        [`%${likeLiteral(q.toLowerCase())}%`, q.toLowerCase(), `(^|\\W)${regexLiteral(q.toLowerCase())}($|\\W)`, PAGE_SIZE, offset],
      ),
    )
    return { rows: rows.map(asHit), mode: 'title', ms }
  }

  const { rows, ms } = await timed(async () => {
    if (page === 1) {
      // Title matches and the body ranking are independent here, so both run at
      // once; the body over-fetches by the boost size and duplicates are dropped.
      const [boosted, body] = await Promise.all([titleMatches(q), bodyMatches(q, 0, PAGE_SIZE, [])])
      const ids = new Set(boosted.map((row) => asInt(row.id)))
      return [...boosted, ...body.filter((row) => !ids.has(asInt(row.id)))].slice(0, PAGE_SIZE)
    }
    // Later pages continue the body ranking after the boosted titles, which it skips.
    const boosted = await titleMatches(q)
    return bodyMatches(
      q,
      offset - boosted.length,
      PAGE_SIZE,
      boosted.map((row) => asInt(row.id)),
    )
  })
  return { rows: rows.map(asHit), mode: 'fulltext', ms }
}

type PlanNode = { 'Node Type'?: string; 'Index Name'?: string; 'Actual Rows'?: number; 'Plan Rows'?: number; Plans?: PlanNode[] }

function explainRoot(rows: Row[]): PlanNode | null {
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
async function bitmapCount(where: string, index: string, values: unknown[]): Promise<number | null> {
  try {
    const rows = await run({ enable_seqscan: 'off', enable_indexscan: 'off' }, `EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF, FORMAT JSON) SELECT 1 FROM articles WHERE ${where} LIMIT 1`, values)
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
  const [check] = await run(null, `SELECT bool_and(numnode(plainto_tsquery('english', w)) > 0) AS ok FROM unnest($1::text[]) w`, [negatives])
  if (!check?.ok) return null
  const subsets = Array.from({ length: 1 << negatives.length }, (_, mask) => negatives.filter((_, i) => mask & (1 << i)))
  const counts = await Promise.all(subsets.map((subset) => bitmapCount(`${SEARCH_TSV} @@ plainto_tsquery('english', $1)`, 'articles_search_gin', [[...positives, ...subset].join(' ')])))
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
export async function countMatches(q: string, analysis: QueryAnalysis, mode: SearchMode): Promise<MatchCount> {
  const started = performance.now()
  const done = (count: number | null, exact: boolean): MatchCount => ({ count, exact, ms: performance.now() - started })

  if (mode === 'prefix') return done(await bitmapCount(`lower(title) ~>=~ $1 AND lower(title) ~<~ $2`, 'articles_title_prefix_idx', prefixRange(q)), true)

  if (mode === 'title') {
    const rows = await run({ statement_timeout: COUNT_TIMEOUT_MS }, `SELECT count(*)::int AS n FROM articles WHERE lower(title) LIKE $1`, [`%${likeLiteral(q.toLowerCase())}%`]).catch(() => null)
    return done(rows ? asInt(rows[0]?.n) : null, rows != null)
  }

  // Quotes and hyphens become phrase operators and a leading minus a negation,
  // which GIN cannot answer without rechecking the table. Decided from the raw
  // text so the count never waits for the query analysis.
  if (!/["-]/.test(q)) {
    const exact = await bitmapCount(MATCH, 'articles_search_gin', [q])
    if (exact != null) return done(exact, true)
  }

  // Plain words with up to three `-negated` words: exact from GIN alone by
  // inclusion-exclusion, e.g. |quantum and not mechanics| =
  // |quantum| - |quantum and mechanics|, so no article is re-parsed.
  const negated = await negationCount(q)
  if (negated != null) return done(negated, true)

  // Otherwise race an exact count through GIN plus a table recheck against
  // the exact GIN count of all the positive words combined, an upper bound
  // shown as "about N" when the recheck runs out of time.
  const words = rankingText(q).replace(/["-]/g, ' ')
  const [exact, bound] = await Promise.all([
    run({ ...BITMAP, statement_timeout: COUNT_TIMEOUT_MS }, `SELECT count(*)::int AS n FROM articles WHERE ${MATCH}`, [q])
      .then((rows) => asInt(rows[0]?.n))
      .catch(() => null),
    bitmapCount(`${SEARCH_TSV} @@ plainto_tsquery('english', $1)`, 'articles_search_gin', [words]),
  ])
  return exact != null ? done(exact, true) : done(bound, false)
}

// ---------------------------------------------------------------------------
// Main Page

/**
 * The article for today's date ("September 24"), whose Events list feeds "On
 * this day". The dump has no plain date articles, so the Eastern Orthodox
 * liturgical calendar page for the day is the fallback.
 */
/** The date's article ("September 24"), or its Eastern Orthodox liturgics page when the dump has no plain one. */
function dateTitles(date: Date): string[] {
  const day = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })
  return [day, `${day} (Eastern Orthodox liturgics)`]
}

function dateArticleStatement(titles: string[]): Statement {
  return built(db.select(ARTICLE_COLUMNS).from(articles).where(inArray(articles.title, titles)))
}

function firstDateArticle(rows: Row[], titles: string[]): ArticleRecord | null {
  return rows.map(asArticle).sort((a, b) => titles.indexOf(a.title) - titles.indexOf(b.title))[0] ?? null
}

export type MainPageData = { count: number | null; featured: ArticleRecord[]; didYouKnow: ArticleRecord[]; random: ArticleRecord[]; onThisDay: ArticleRecord | null }

/**
 * Everything the Main Page shows, in one round trip: five statements in one
 * transaction (about 3 ms in Postgres). One request instead of five means one
 * connection to set up on a cold start and one network round trip when warm.
 */
export async function mainPageData(today: Date): Promise<MainPageData> {
  const titles = dateTitles(today)
  const [count, featured, didYouKnow, random, onThisDay] = await runAll(null, [
    articleCountStatement(),
    // A substantial article for "From today's featured article", with a few spares in case one reads badly.
    randomArticlesStatement(4, 20_000, 6000),
    // Enough candidates that six opening sentences read as facts.
    randomArticlesStatement(14, 3000, 1500),
    randomArticlesStatement(6, 1500, 1200),
    dateArticleStatement(titles),
  ])
  return {
    count: count[0] ? asInt(count[0].articles) : null,
    featured: uniqueArticles(featured),
    didYouKnow: uniqueArticles(didYouKnow),
    random: uniqueArticles(random),
    onThisDay: firstDateArticle(onThisDay, titles),
  }
}

// ---------------------------------------------------------------------------
// Image copies

/**
 * Queues articles whose lead image is still served from Wikimedia, for the
 * images function to copy into the bucket. Viewed articles go first
 * (priority 0), so one already waiting in the backfill moves to the front. Not
 * timed: it runs after the response, outside every page's database time.
 */
export async function queueImageCopies(ids: number[]): Promise<void> {
  if (ids.length === 0) return
  await sql.query(
    `INSERT INTO image_queue (id) SELECT unnest($1::bigint[])
     ON CONFLICT (id) DO UPDATE SET priority = 0 WHERE image_queue.priority > 0`,
    [ids],
  )
}
