import { lookUpArticle, type ArticleRecord } from '@/components/article-view'
import { SITE_URL, titleFromSegments, wikiHref } from '@/lib/links'
import { Footer, Frame, leadImageData, OG, ogResponse, Wordmark } from '@/lib/og'
import { firstSentence } from '@/lib/wikitext'

/** Title sizes by length, so short titles fill the card and long ones fit in two lines. */
function titleSize(title: string): number {
  if (title.length <= 18) return 96
  if (title.length <= 32) return 78
  if (title.length <= 56) return 62
  return 50
}

/** The article the title leads to: itself, or the stored spelling it redirects to. */
async function articleFor(title: string): Promise<ArticleRecord | null> {
  const found = await lookUpArticle(title)
  if (found.kind === 'article') return found.article
  if (found.kind !== 'redirect') return null
  const target = await lookUpArticle(found.to)
  return target.kind === 'article' ? target.article : null
}

/**
 * An article's social card (see `ogImageHref`): its title, opening sentence
 * and lead image under the WikiFaster name. Browsers and the CDN keep each
 * card for a day, like the pages.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ title: string[] }> }) {
  const title = titleFromSegments((await params).title)
  const article = await articleFor(title).catch(() => null)
  const image = article?.image ? await leadImageData(article.image) : null
  const heading = article?.title ?? title
  const summary = article ? firstSentence(article.text, 220) : 'Not in the English Wikipedia dump of 1 November 2023.'
  return ogResponse(
    <Frame>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <Wordmark size={40} />
        <div style={{ display: 'flex', fontSize: 26, color: OG.subtle }}>From Wikipedia, the free encyclopedia</div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 56 }}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 26 }}>
          <div style={{ display: 'block', fontSize: titleSize(heading), fontWeight: 700, letterSpacing: '-0.035em', lineHeight: 1.05, lineClamp: 2 }}>{heading}</div>
          <div style={{ display: 'block', fontSize: 30, lineHeight: 1.4, color: OG.subtle, lineClamp: 3 }}>{summary}</div>
        </div>
        {image ? (
          <div style={{ display: 'flex', width: 280, height: 280, flexShrink: 0, alignItems: 'center', justifyContent: 'center', padding: 12, borderRadius: 18, background: '#ffffff', border: `1px solid ${OG.border}` }}>
            <img src={image} width={256} height={256} style={{ objectFit: 'contain' }} alt="" />
          </div>
        ) : null}
      </div>

      <Footer left={`${new URL(SITE_URL).host}${decodeURIComponent(wikiHref(heading))}`} logoHeight={34} />
    </Frame>,
    { 'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800' },
  )
}
