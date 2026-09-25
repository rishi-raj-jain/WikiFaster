import { wikiHref } from '@/lib/links'
import { randomTitle } from '@/lib/queries'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'

/**
 * Special:Random, served at `/wiki/Special:Random` through a rewrite in
 * `next.config.ts`. `connection()` keeps it out of every cache, so each visit
 * picks a new article.
 */
export default async function RandomPage() {
  await connection()
  const random = await randomTitle()
  redirect(random ? wikiHref(random) : '/')
}
