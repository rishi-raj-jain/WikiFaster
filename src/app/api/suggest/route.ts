import { db } from '@/db'
import { leadImage } from '@/db/schema'
import { queueUncopiedImages } from '@/lib/image-copies'
import type { ImageRef } from '@/lib/links'
import { likeLiteral, trigramSearchable } from '@/lib/search/results'
import { serverTiming } from '@/lib/server-timing'
import { firstSentence } from '@/lib/wikitext'
import { sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'

/** Every query stops at its statement timeout, so no request needs longer than this. */
export const maxDuration = 300

const LIMIT = 10

type Row = { id: number; title: string; lead: string; image: ImageRef | null }

/**
 * Search-box suggestions (title, a one-line description from the lead, the lead
 * image) and how long they took, like Wikipedia's search dropdown:
 *   1. titles starting with the text (`articles_title_prefix_idx`), exact match
 *      first, then the longest articles, a stand-in for popularity;
 *   2. then titles containing it (`articles_title_trgm_idx`);
 *   3. then, if still nothing, titles that look like a misspelling of it
 *      (trigram similarity on the same index).
 */
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get('q') ?? '').slice(0, 200).trim().toLowerCase()
  const started = performance.now()
  const found = new Map<string, Row>()
  const add = (rows: Row[]) => rows.forEach((row) => found.size < LIMIT && !found.has(row.title) && found.set(row.title, row))
  try {
    if (q) {
      const prefix = await db.execute<Row>(sql`
        SELECT id::int AS id, title, left(text, 400) AS lead, ${leadImage('prefix')} AS image FROM (
          SELECT id, title, text FROM articles WHERE lower(title) LIKE ${`${likeLiteral(q)}%`} ORDER BY lower(title) USING ~<~ LIMIT 200
        ) prefix
        ORDER BY lower(title) = ${q} DESC, pg_column_size(text) DESC
        LIMIT ${LIMIT}`)
      add(prefix.rows)
    }
    if (q && found.size < LIMIT && trigramSearchable(q)) {
      const contains = await db.execute<Row>(sql`
        SELECT id::int AS id, title, left(text, 400) AS lead, ${leadImage('contains')} AS image FROM (
          SELECT id, title, text FROM articles WHERE lower(title) LIKE ${`%${likeLiteral(q)}%`} LIMIT 200
        ) contains
        ORDER BY pg_column_size(text) DESC
        LIMIT ${LIMIT}`)
      add(contains.rows)
    }
    if (found.size === 0 && q.length >= 4 && trigramSearchable(q)) {
      const [, similar] = await db.batch([
        db.execute(sql`SELECT set_config('pg_trgm.similarity_threshold', '0.45', true), set_config('statement_timeout', '5000', true)`),
        db.execute<Row>(sql`
          SELECT id::int AS id, title, left(text, 400) AS lead, ${leadImage()} AS image FROM articles
          WHERE lower(title) % ${q}
          ORDER BY similarity(lower(title), ${q}) DESC, pg_column_size(text) DESC
          LIMIT ${LIMIT}`),
      ])
      add(similar.rows)
    }
  } catch {
    // Show whatever was found before the failure.
  }
  const ms = performance.now() - started
  const rows = [...found.values()]
  queueUncopiedImages(rows)
  const suggestions = rows.map((row) => ({ title: row.title, description: firstSentence(row.lead, 90), image: row.image }))
  return Response.json({ suggestions, ms }, { headers: { 'Server-Timing': serverTiming(ms) } })
}
