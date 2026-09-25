import { SearchShell } from '@/components/loading'
import { Footer, FOOTER_LINKS, LICENSE_LINE, PageLayout, TitleBar } from '@/components/page-layout'
import { SearchResults } from '@/components/search-results'
import { db } from '@/db'
import { articles } from '@/db/schema'
import { searchHref, SPECIAL_SEARCH, wikiHref } from '@/lib/links'
import { pageNumber } from '@/lib/search'
import { pageMetadata } from '@/lib/seo'
import { sql } from 'drizzle-orm'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

function one(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Special:Search, served at `/wiki/Special:Search` through a rewrite in
 * `next.config.ts`. The query string is only known per request, so the page
 * streams: the search shell first, then the results or the jump to an article.
 * Like Wikipedia, it is `noindex,nofollow` with the search URL as canonical.
 */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = one((await searchParams).search).trim()
  return pageMetadata(q ? `${q} - Search results - Wikipedia` : 'Search - Wikipedia', { canonical: q ? searchHref(q, { fulltext: true }) : wikiHref(SPECIAL_SEARCH), index: false })
}

export default function SearchPage({ searchParams }: Props) {
  return (
    <Suspense fallback={<SearchShell />}>
      <Search searchParams={searchParams} />
    </Suspense>
  )
}

/**
 * An exact title in any case goes straight to the article (Wikipedia's "Go"),
 * unless `fulltext` is set. The stored spelling is found through the
 * lower(title) index, preferring the one typed exactly.
 */
async function Search({ searchParams }: Props) {
  const params = await searchParams
  const q = one(params.search).trim().slice(0, 300)
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
  return (
    <PageLayout footer={<Footer lines={[LICENSE_LINE]} links={FOOTER_LINKS} />}>
      <TitleBar title="Search results" left={[{ label: 'Special page', selected: true }]} />
      <SearchResults initialQuery={q} initialPage={pageNumber(one(params.page))} exactTitle={exact} />
    </PageLayout>
  )
}
