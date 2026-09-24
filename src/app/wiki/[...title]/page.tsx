import { ArticlePage, loadArticle } from '@/components/article-view'
import { MainPage } from '@/components/main-page'
import { FOOTER_LINKS, Footer, LICENSE_LINE, PageLayout, TitleBar } from '@/components/page-layout'
import { SearchResults } from '@/components/search-results'
import { MAIN_PAGE, SPECIAL_RANDOM, SPECIAL_SEARCH, searchHref, titleFromSegments, wikiHref } from '@/lib/links'
import { canonicalTitle, randomTitle } from '@/lib/queries'
import { pageNumber } from '@/lib/search'
import { MAIN_PAGE_METADATA, pageMetadata } from '@/lib/seo'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

type Props = { params: Promise<{ title: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

function one(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Each route's <head>, matching Wikipedia's: search and special pages are
 * `noindex,nofollow` with the search URL as canonical, articles are indexable
 * with their stored title's URL as canonical, and a missing article is
 * `noindex,nofollow`. The article read is the same one the page streams
 * (`loadArticle` runs once per request), so metadata adds no query.
 */
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const title = titleFromSegments((await params).title)
  if (title === MAIN_PAGE) return MAIN_PAGE_METADATA
  if (title === SPECIAL_SEARCH) {
    const q = one((await searchParams).search).trim()
    return pageMetadata(q ? `${q} - Search results - Wikipedia` : 'Search - Wikipedia', { canonical: q ? searchHref(q, { fulltext: true }) : wikiHref(SPECIAL_SEARCH), index: false })
  }
  if (title.startsWith('Special:')) return pageMetadata(`${title} - Wikipedia`, { index: false })
  const loaded = await loadArticle(title).catch(() => null)
  if (loaded?.kind === 'article') return pageMetadata(`${loaded.article.title} - Wikipedia`, { canonical: wikiHref(loaded.article.title) })
  if (loaded?.kind === 'redirect') return pageMetadata(`${loaded.to} - Wikipedia`, { canonical: wikiHref(loaded.to) })
  return pageMetadata(`${title} - Wikipedia`, { canonical: wikiHref(title), index: false })
}

/** Special:Search: an exact title goes straight to the article (Wikipedia's "Go"), unless `fulltext` is set. */
async function Search({ searchParams }: { searchParams: Props['searchParams'] }) {
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

export default async function WikiPage({ params, searchParams }: Props) {
  const title = titleFromSegments((await params).title)
  if (title === MAIN_PAGE) return <MainPage />
  if (title === SPECIAL_RANDOM) {
    const random = await randomTitle()
    redirect(random ? wikiHref(random) : '/')
  }
  if (title === SPECIAL_SEARCH) return <Search searchParams={searchParams} />
  // Keyed by title, so moving between articles shows the new page's streamed shell at once.
  return <ArticlePage key={title} title={title} />
}
