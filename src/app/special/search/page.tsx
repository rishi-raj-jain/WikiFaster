import { Footer, FOOTER_LINKS, LICENSE_LINE, PageLayout, TitleBar } from '@/components/page-layout'
import { SearchResults } from '@/components/search-results'
import { db } from '@/db'
import { articles } from '@/db/schema'
import { queueUncopiedImages } from '@/lib/image-copies'
import { searchHref, SPECIAL_SEARCH, wikiHref } from '@/lib/links'
import { pageNumber, runSearch } from '@/lib/search'
import { pageMetadata } from '@/lib/seo'
import { sql } from 'drizzle-orm'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

function one(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Special:Search, served at `/wiki/Special:Search` through a rewrite in
 * `next.config.ts`. The query string is only known per request, so nothing
 * here is cached: every visit queries Neon, and the page is sent whole once
 * the results (or the jump to an article) are ready, never streamed.
 * Like Wikipedia, it is `noindex,nofollow` with the search URL as canonical.
 */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = one((await searchParams).search).trim()
  return pageMetadata(q ? `${q} - Search results - Wikipedia` : 'Search - Wikipedia', { canonical: q ? searchHref(q, { fulltext: true }) : wikiHref(SPECIAL_SEARCH), index: false })
}

/** Reads the query string outside any Suspense boundary, so the page waits for the results instead of streaming. */
export const instant = false

/**
 * An exact title in any case goes straight to the article (Wikipedia's "Go"),
 * unless `fulltext` is set. The stored spelling is found through the
 * lower(title) index, preferring the one typed exactly. Otherwise the results
 * are rendered here, in the page, rather than fetched by the browser after it loads.
 */
export default async function SearchPage({ searchParams }: Props) {
  const params = await searchParams
  const q = one(params.search).trim().slice(0, 300)
  const page = pageNumber(one(params.page))
  const [found] = q
    ? await db
        .select({ title: articles.title })
        .from(articles)
        .where(sql`lower(${articles.title}) = lower(${q})`)
        .orderBy(sql`${articles.title} = ${q} DESC`)
        .limit(1)
    : []
  const exact = found?.title ?? null
  if (exact && !one(params.fulltext)) redirect(wikiHref(exact))
  const payload = q ? await runSearch(q, page) : null
  if (payload) queueUncopiedImages(payload.rows)
  return (
    <PageLayout footer={<Footer lines={[LICENSE_LINE]} links={FOOTER_LINKS} />}>
      <TitleBar title="Search results" left={[{ label: 'Special page', selected: true }]} />
      <SearchResults initialQuery={q} initialPage={page} exactTitle={exact} initialPayload={payload} />
    </PageLayout>
  )
}
