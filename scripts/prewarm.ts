/**
 * Load every search index into the compute's cache with pg_prewarm, so the
 * first searches after a restart do not read ~12 GB of index from storage.
 * Reads from storage fill Neon's Local File Cache on computes that have one;
 * large computes keep the whole cache in shared buffers. Rerun after the
 * compute restarts, suspends or changes size.
 *
 *   npm run db:prewarm
 */

import { cacheReport, prewarm } from '../src/lib/prewarm'
import { unpooledUrl } from './env'

async function main() {
  const url = unpooledUrl()
  const { total, results, mb } = await prewarm(url)
  for (const row of results) {
    console.log(row.error ? `  ✗ ${row.rel}: ${row.error}` : `  prewarmed ${row.rel}: ${row.blocks} blocks (${(row.ms / 1000).toFixed(1)}s)`)
  }
  console.log(`Done. Warmed ${total} blocks (~${mb} MB).`)
  const cache = await cacheReport(url)
  if (cache.lfcOn) {
    console.log(`Cache: shared_buffers ${cache.sharedBuffers} + Local File Cache up to ${cache.lfcLimit}, hit ratio ${cache.lfc?.file_cache_hit_ratio ?? 'n/a'}%`)
  } else {
    console.log(`Cache: shared_buffers ${cache.sharedBuffers}; Local File Cache is off on this compute size, so everything above is held in shared buffers.`)
  }
}

main()
