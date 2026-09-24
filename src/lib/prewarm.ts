import { neon } from '@neondatabase/serverless'

/**
 * Every index the schema defines (`src/db/schema.ts`), then the small tables
 * search reads. Indexes go first so the search structures are warm before
 * anything else. The `articles` heap and its TOAST (article text, ~15 GB) are
 * left to warm on demand. Keep this in step with the schema when an index is
 * added or dropped.
 */
const RELATIONS = [
  // articles: lookups by id and title
  'articles_pkey',
  'articles_title_key',
  'articles_title_prefix_idx',
  'articles_title_trgm_idx',
  // articles: BM25 ranking (titles, then full text)
  'articles_title_bm25',
  'articles_search_bm25',
  // articles: boolean-match GIN (filters and exact counts)
  'articles_search_gin',
  // search_terms: typo lexicon
  'search_terms_pkey',
  'search_terms_word_trgm',
  // site_stats: Main Page article count
  'site_stats_pkey',
  // tables
  'search_terms',
  'site_stats',
]

/**
 * Where the compute keeps its cache, per the Neon docs: below 18 CU, shared
 * buffers plus the Local File Cache (LFC) on local disk, which every read from
 * storage (pg_prewarm's included) fills; from 18 CU, the LFC is off and the
 * whole cache is shared buffers (75% of RAM, huge pages). The `neon` extension's
 * `neon_stat_file_cache` view reports the LFC when it is on.
 */
export async function cacheReport(databaseUrl: string) {
  const sql = neon(databaseUrl)
  await sql`CREATE EXTENSION IF NOT EXISTS neon`
  const [settings] = await sql`SELECT current_setting('shared_buffers') AS shared_buffers, current_setting('neon.file_cache_size_limit') AS lfc_limit`
  const [lfc] = await sql`SELECT file_cache_hits, file_cache_misses, file_cache_hit_ratio FROM neon_stat_file_cache`
  const lfcOn = String(settings.lfc_limit) !== '0MB'
  return { sharedBuffers: String(settings.shared_buffers), lfcLimit: String(settings.lfc_limit), lfcOn, lfc: lfcOn ? lfc : null }
}

export async function prewarm(databaseUrl: string) {
  const sql = neon(databaseUrl)
  await sql`CREATE EXTENSION IF NOT EXISTS pg_prewarm`
  await sql`CREATE EXTENSION IF NOT EXISTS neon`
  let total = 0
  const results: Array<{ rel: string; blocks: number; ms: number; error?: string }> = []
  for (const rel of RELATIONS) {
    const started = performance.now()
    try {
      const rows = await sql`SELECT pg_prewarm(${rel}::regclass) AS blocks`
      const blocks = Number(rows[0].blocks)
      total += blocks
      results.push({ rel, blocks, ms: performance.now() - started })
    } catch (err) {
      results.push({ rel, blocks: 0, ms: performance.now() - started, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { total, results, mb: Math.round((total * 8) / 1024) }
}
