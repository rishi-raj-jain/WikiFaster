import { ArticleShell } from '@/components/loading'
import { db } from '@/db'
import { articles } from '@/db/schema'
import { wikiHref } from '@/lib/links'
import { asc, gte, sql } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { Suspense } from 'react'

/**
 * Special:Random, served at `/wiki/Special:Random` through a rewrite in
 * `next.config.ts`. It shows a blank article until the pick is in, then
 * redirects to it. `connection()` makes the pick per request.
 */
export default function RandomPage() {
  return (
    <Suspense fallback={<ArticleShell title={null} />}>
      <RandomRedirect />
    </Suspense>
  )
}

/**
 * Seeks the primary key from a random id between the smallest and largest, so
 * the pick costs one index probe instead of `ORDER BY random()` over 6.4M rows.
 */
async function RandomRedirect(): Promise<never> {
  await connection()
  const [random] = await db
    .select({ title: articles.title })
    .from(articles)
    .where(gte(articles.id, sql`(SELECT min(id) + floor(random() * (max(id) - min(id)))::bigint FROM articles)`))
    .orderBy(asc(articles.id))
    .limit(1)
  redirect(random ? wikiHref(random.title) : '/')
}
