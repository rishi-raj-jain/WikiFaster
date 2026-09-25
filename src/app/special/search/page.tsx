import { FOOTER_LINKS, Footer, LICENSE_LINE, PageLayout, TitleBar } from '@/components/page-layout'
import { SearchResults } from '@/components/search-results'
import { SPECIAL_SEARCH, searchHref, wikiHref } from '@/lib/links'
import { canonicalTitle } from '@/lib/queries'
import { pageNumber } from '@/lib/search'
import { pageMetadata } from '@/lib/seo'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

function one(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Special:Search, served at `/wiki/Special:Search` through a rewrite in
 * `next.config.ts`. It reads the query string and renders on every request.
 * Like Wikipedia, it is `noindex,nofollow` with the search URL as canonical.
 */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = one((await searchParams).search).trim()
  return pageMetadata(q ? `${q} - Search results - Wikipedia` : 'Search - Wikipedia', { canonical: q ? searchHref(q, { fulltext: true }) : wikiHref(SPECIAL_SEARCH), index: false })
}

/** An exact title goes straight to the article (Wikipedia's "Go"), unless `fulltext` is set. */
export default async function SearchPage({ searchParams }: Props) {
  const params = await searchParams
  const q = one(params.search).trim().slice(0, 300)
  const exact = q ? await canonicalTitle(q) : null
  if (exact && !one(params.fulltext)) redirect(wikiHref(exact))
  return (
    <PageLayout footer={<Footer lines={[LICENSE_LINE]} links={FOOTER_LINKS} />}>
      <TitleBar title="Search results" left={[{ label: 'Special page', selected: true }]} />
      <SearchResults initialQuery={q} initialPage={pageNumber(one(params.page))} exactTitle={exact} />
    </PageLayout>
  )
}
