import { ArticlePage, loadArticle } from '@/components/article-view'
import { MainPage } from '@/components/main-page'
import { MAIN_PAGE, imageSrc, titleFromSegments, wikiHref } from '@/lib/links'
import { MAIN_PAGE_METADATA, pageMetadata } from '@/lib/seo'
import type { Metadata } from 'next'

type Props = { params: Promise<{ title: string[] }> }

/**
 * Each article's <head>, matching Wikipedia's: articles are indexable with
 * their stored title's URL as canonical, and a missing article or special
 * page is `noindex,nofollow`. The article read is the same one the page
 * streams (`loadArticle` runs once per render), so metadata adds no query.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const title = titleFromSegments((await params).title)
  if (title === MAIN_PAGE) return MAIN_PAGE_METADATA
  if (title.startsWith('Special:')) return pageMetadata(`${title} - Wikipedia`, { index: false })
  const loaded = await loadArticle(title).catch(() => null)
  if (loaded?.kind === 'article') {
    const { title: stored, image } = loaded.article
    return pageMetadata(`${stored} - Wikipedia`, { canonical: wikiHref(stored), image: image ? imageSrc(image) : undefined })
  }
  if (loaded?.kind === 'redirect') return pageMetadata(`${loaded.to} - Wikipedia`, { canonical: wikiHref(loaded.to) })
  return pageMetadata(`${title} - Wikipedia`, { canonical: wikiHref(title), index: false })
}

export default async function WikiPage({ params }: Props) {
  const title = titleFromSegments((await params).title)
  if (title === MAIN_PAGE) return <MainPage />
  // Keyed by title, so moving between articles shows the new page's streamed shell at once.
  return <ArticlePage key={title} title={title} />
}
