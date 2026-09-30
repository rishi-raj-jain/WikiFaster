import { db } from '@/db'
import { articles } from '@/db/schema'
import { wikiHref } from '@/lib/links'
import { asc, gte, sql } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'

/**
 * Special:Random, served at `/wiki/Special:Random` through a rewrite in
 * `next.config.ts`. It sends nothing until the pick is in, then answers with
 * an HTTP redirect to it. `connection()` makes the pick per request.
 */
export const instant = false

/**
 * Seeks the primary key from a random id between the smallest and largest, so
 * the pick costs one index probe instead of `ORDER BY random()` over 6.4M rows.
 */
export default async function RandomPage(): Promise<never> {
  await connection()
  const [random] = await db
    .select({ title: articles.title })
    .from(articles)
    .where(gte(articles.id, sql`(SELECT min(id) + floor(random() * (max(id) - min(id)))::bigint FROM articles)`))
    .orderBy(asc(articles.id))
    .limit(1)
  redirect(random ? wikiHref(random.title) : '/')
}
