import { ArticlePage, lookUpArticle } from '@/components/article-view'
import { MainPage } from '@/components/main-page'
import { MAIN_PAGE, ogImageHref, titleFromSegments, wikiHref } from '@/lib/links'
import { MAIN_PAGE_METADATA, pageMetadata } from '@/lib/seo'
import type { Metadata } from 'next'
import { cacheLife, cacheTag } from 'next/cache'

type Props = { params: Promise<{ title: string[] }> }

/**
 * Prerenders the Main Page at build. Every other title is rendered on its
 * first visit and then served from the cache until it is revalidated, since
 * each page is `use cache`.
 */
export function generateStaticParams() {
  return [{ title: ['Main_Page'] }]
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return titleMetadata(titleFromSegments((await params).title))
}

/**
 * Each article's <head>, matching Wikipedia's: articles are indexable with
 * their stored title's URL as canonical, and a missing article or special
 * page is `noindex,nofollow`. Cached and tagged like the page.
 */
async function titleMetadata(title: string): Promise<Metadata> {
  'use cache'
  cacheLife('forever')
  cacheTag('wiki', title)
  if (title === MAIN_PAGE) return MAIN_PAGE_METADATA
  if (title.startsWith('Special:')) return pageMetadata(`${title} - Wikipedia`, { index: false })
  const loaded = await lookUpArticle(title).catch(() => null)
  if (loaded?.kind === 'article') {
    const stored = loaded.article.title
    return pageMetadata(`${stored} - Wikipedia`, { canonical: wikiHref(stored), image: ogImageHref(stored) })
  }
  if (loaded?.kind === 'redirect') return pageMetadata(`${loaded.to} - Wikipedia`, { canonical: wikiHref(loaded.to) })
  return pageMetadata(`${title} - Wikipedia`, { canonical: wikiHref(title), index: false })
}

/**
 * Rendered without a Suspense boundary, so the whole article is in the first
 * paint. React outlines a finished boundary over 12.8 KB and holds its reveal
 * until 300 ms after the fallback paints, so a streamed shell would make even
 * a cached page show a skeleton first. A title's first visit waits for the
 * server instead (a link click still draws the shell at once, see
 * PendingNavigation), and every visit after it gets the cached page as is.
 */
export const instant = false

export default async function WikiPage({ params }: Props) {
  const title = titleFromSegments((await params).title)
  // Keyed by title, so moving between articles starts the page's client state afresh.
  return <TitlePage key={title} title={title} />
}

/**
 * The whole page for one title, cached until it is revalidated. It is tagged
 * with its title and with `wiki`, so `/api/revalidate` can refresh one page or
 * all of them (Wikipedia titles start with a capital, so no title is `wiki`).
 */
async function TitlePage({ title }: { title: string }) {
  'use cache'
  cacheLife('forever')
  cacheTag('wiki', title)
  return title === MAIN_PAGE ? <MainPage /> : <ArticlePage title={title} />
}
