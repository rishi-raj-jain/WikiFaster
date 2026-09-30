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
 * `next.config.ts`. The shell paints at once; the pick runs per request inside
 * Suspense so the redirect is a meta refresh the client router follows. A
 * redirect thrown outside Suspense is cached as a 307 with no Location, which
 * leaves the pending skeleton up forever.
 */
export default function RandomPage() {
  return (
    <>
      <ArticleShell title={null} />
      <Suspense fallback={null}>
        <RandomRedirect />
      </Suspense>
    </>
  )
}

/**
 * Seeks the primary key from a random id between the smallest and largest, so
 * the pick costs one index probe instead of `ORDER BY random()` over 6.4M rows.
 * `connection()` keeps the pick out of the static shell and off prefetches.
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
