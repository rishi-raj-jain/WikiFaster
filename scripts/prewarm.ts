/**
 * Load every search index into the compute's cache with pg_prewarm, so the
 * first searches after a restart do not read ~12 GB of index from storage.
 * Reads from storage fill Neon's Local File Cache on computes that have one;
 * large computes keep the whole cache in shared buffers. Rerun after the
 * compute restarts, suspends or changes size.
 *
 *   npm run db:prewarm
 */

import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import { unpooledUrl } from './env'

type Sql = NeonQueryFunction<false, false>

/**
 * Every index the schema defines (`src/db/schema.ts`), plus the small tables'
 * primary keys. The `articles` heap and its TOAST (article text, ~15 GB) are
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
]

async function prewarm(sql: Sql) {
  await sql`CREATE EXTENSION IF NOT EXISTS pg_prewarm`
  let total = 0
  for (const rel of RELATIONS) {
    const started = performance.now()
    try {
      const rows = (await sql`SELECT pg_prewarm(${rel}::regclass) AS blocks`) as { blocks: number }[]
      const blocks = Number(rows[0].blocks)
      total += blocks
      console.log(`  prewarmed ${rel}: ${blocks} blocks (${((performance.now() - started) / 1000).toFixed(1)}s)`)
    } catch (err) {
      console.log(`  ✗ ${rel}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  console.log(`Done. Warmed ${total} blocks (~${Math.round((total * 8) / 1024)} MB).`)
}

/**
 * Where the compute keeps its cache, per the Neon docs: below 18 CU, shared
 * buffers plus the Local File Cache (LFC) on local disk, which every read from
 * storage (pg_prewarm's included) fills; from 18 CU, the LFC is off and the
 * whole cache is shared buffers (75% of RAM, huge pages). The `neon` extension's
 * `neon_stat_file_cache` view reports the LFC when it is on.
 */
async function reportCache(sql: Sql) {
  await sql`CREATE EXTENSION IF NOT EXISTS neon`
  const [settings] = (await sql`SELECT current_setting('shared_buffers') AS shared_buffers, current_setting('neon.file_cache_size_limit') AS lfc_limit`) as { shared_buffers: string; lfc_limit: string }[]
  if (settings.lfc_limit === '0MB') {
    console.log(`Cache: shared_buffers ${settings.shared_buffers}. Local File Cache is off on this compute size, so everything above is held in shared buffers.`)
    return
  }
  const [lfc] = (await sql`SELECT file_cache_hit_ratio FROM neon_stat_file_cache`) as { file_cache_hit_ratio: number | null }[]
  console.log(`Cache: shared_buffers ${settings.shared_buffers} + Local File Cache up to ${settings.lfc_limit}, hit ratio ${lfc?.file_cache_hit_ratio ?? 'n/a'}%`)
}

async function main() {
  const sql = neon(unpooledUrl())
  await prewarm(sql)
  await reportCache(sql)
}

main()
