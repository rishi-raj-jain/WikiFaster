import { DbTimingBar, addTiming, type Timing } from '@/components/db-timing'
import { LinkTimingBar, LinkedList, type LinkCheck } from '@/components/linked-list'
import { ARTICLE_TABS, ArticleShell, Tagline, articleViewTabs, wikipediaUrl } from '@/components/loading'
import { FOOTER_LINKS, Footer, LICENSE_LINE, PageLayout, TitleBar } from '@/components/page-layout'
import { TocButton, TocSidebar } from '@/components/toc'
import { measureDb } from '@/db'
import { queueUncopiedImages } from '@/lib/image-copies'
import { canonicalTitle, existingTitles, readArticle, type ArticleRecord } from '@/lib/queries'
import { SEE_ALSO, linkTitles } from '@/lib/article-links'
import { LICENSE_URL, SITE_URL, filePageUrl, imageSrc, searchHref, wikiHref, type ImageRef } from '@/lib/links'
import { JsonLd } from '@/lib/seo'
import { firstSentence, parseArticle, type Block, type ParsedArticle } from '@/lib/wikitext'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'

/** The lead's first mention of the title in bold, as every Wikipedia article opens ("**Anarchism** is …"). */
function Lead({ text, title }: { text: string; title: string }) {
  const bare = title.replace(/\s*\(.*\)$/, '')
  const at = text.toLowerCase().indexOf(bare.toLowerCase())
  if (!bare || at < 0 || at > 200) return <p>{text}</p>
  return (
    <p>
      {text.slice(0, at)}
      <b>{text.slice(at, at + bare.length)}</b>
      {text.slice(at + bare.length)}
    </p>
  )
}

/**
 * The lead image, floated right where an infobox's image would be, and linked
 * to its file page on Wikipedia, which credits the author and license.
 */
function LeadImage({ image, title }: { image: ImageRef; title: string }) {
  return (
    <figure className="wiki-lead-image">
      <a href={filePageUrl(image)} target="_blank" rel="noreferrer" title="Image credit and license on Wikipedia">
        <img src={imageSrc(image)} alt={title} decoding="async" fetchPriority="high" />
      </a>
    </figure>
  )
}

/**
 * A disambiguation page ("AB, Ab, or ab may refer to:") lists other articles,
 * one per line, as "Title, description" or "Title – description".
 */
const DISAMBIGUATION = /\b(?:may|can|might) (?:also )?(?:refer to|mean|stand for)\b/i

function isDisambiguation(blocks: Block[]): boolean {
  const lead = blocks.find((block) => block.kind === 'paragraph')
  return lead?.kind === 'paragraph' && DISAMBIGUATION.test(lead.text)
}

function PlainList({ items }: { items: string[] }) {
  return (
    <ul>
      {items.map((item, j) => (
        <li key={j}>{item}</li>
      ))}
    </ul>
  )
}

/** The article text. Lists of links show as plain text first (the same text, so nothing moves) and gain their links when the second query returns. */
function Blocks({ blocks, title, check, disambiguation }: { blocks: Block[]; title: string; check: Promise<LinkCheck>; disambiguation: boolean }) {
  let section = ''
  let leadDone = false
  return blocks.map((block, i) => {
    if (block.kind === 'heading') {
      section = block.text
      return (
        <h2 key={i} id={block.id} className="wiki-heading">
          {block.text}
        </h2>
      )
    }
    if (block.kind === 'paragraph') {
      if (!leadDone) {
        leadDone = true
        return <Lead key={i} text={block.text} title={title} />
      }
      return <p key={i}>{block.text}</p>
    }
    const seeAlso = SEE_ALSO.test(section)
    if (!seeAlso && !disambiguation) return <PlainList key={i} items={block.items} />
    return (
      <Suspense key={i} fallback={<PlainList items={block.items} />}>
        <LinkedList items={block.items} seeAlso={seeAlso} check={check} />
      </Suspense>
    )
  })
}

/** The titles alphabetically before and after this one, for the previous/next links. */
type Neighbours = { prev: string | null; next: string | null }

type Loaded =
  | ({ kind: 'article'; article: ArticleRecord; parsed: ParsedArticle; disambiguation: boolean; timing: Timing } & Neighbours)
  | { kind: 'redirect'; to: string; timing: Timing }
  | ({ kind: 'missing'; timing: Timing } & Neighbours)

/**
 * Reads and parses the article once per request, for the metadata and every
 * streamed part (React's `cache` shares the call within one render only). A
 * miss looks for the stored spelling ("albert einstein" -> Albert Einstein).
 */
export const loadArticle = async (title: string): Promise<Loaded> => {
  const {
    value: { article, prev, next },
    ...timing
  } = await measureDb(() => readArticle(title))
  if (article) {
    const parsed = parseArticle(article.text)
    return { kind: 'article', article, parsed, disambiguation: isDisambiguation(parsed.blocks), timing, prev, next }
  }
  const { value: canonical, ...lookup } = await measureDb(() => canonicalTitle(title))
  const total = addTiming(timing, lookup)
  return canonical && canonical !== title ? { kind: 'redirect', to: canonical, timing: total } : { kind: 'missing', timing: total, prev, next }
}

/**
 * Which of the page's link targets exist: the second query, sent as soon as
 * the article is parsed. Never rejects. Handed to the browser as a promise.
 */
async function checkLinks(page: Promise<Loaded>): Promise<LinkCheck> {
  const loaded = await page.catch(() => null)
  if (loaded?.kind !== 'article') return { titles: [], dbMs: 0, totalMs: 0, queries: 0 }
  const { value, ...timing } = await measureDb(() => existingTitles(linkTitles(loaded.parsed.blocks, loaded.disambiguation)).catch(() => new Set<string>()))
  return { titles: [...value], ...timing }
}

function Missing({ title }: { title: string }) {
  return (
    <div className="border-border-subtle bg-secondary mt-4 border px-4 py-3">
      <p className="my-0!">
        <b>Wikipedia does not have an article with this exact name.</b> Please <Link href={searchHref(title, { fulltext: true })}>search for {title} in Wikipedia</Link> to check for alternative titles or spellings.
      </p>
    </div>
  )
}

/** Previous and next articles in title order, at the foot of the page. */
function NeighbourLinks({ prev, next }: Neighbours) {
  if (!prev && !next) return null
  return (
    <nav aria-label="Previous and next articles" className="border-border mt-8 grid grid-cols-2 gap-4 border-t pt-3 text-sm leading-snug">
      {prev ? (
        <Link href={wikiHref(prev)} rel="prev" className="min-w-0">
          <span className="text-subtle block text-xs">← Previous article</span>
          <span className="block truncate">{prev}</span>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link href={wikiHref(next)} rel="next" className="min-w-0 text-right">
          <span className="text-subtle block text-xs">Next article →</span>
          <span className="block truncate">{next}</span>
        </Link>
      ) : null}
    </nav>
  )
}

function ArticleBody({ loaded, check }: { loaded: Extract<Loaded, { kind: 'article' }>; check: Promise<LinkCheck> }) {
  const { article, parsed, disambiguation } = loaded
  return (
    <>
      {article.image ? <LeadImage image={article.image} title={article.title} /> : null}
      <Blocks blocks={parsed.blocks} title={article.title} check={check} disambiguation={disambiguation} />
      <NeighbourLinks prev={loaded.prev} next={loaded.next} />
      {parsed.categories.length > 0 ? (
        <div className="wiki-catlinks">
          <span>Categories</span>:{' '}
          <ul>
            {parsed.categories.map((category) => (
              <li key={category}>
                <Link href={searchHref(category, { fulltext: true })}>{category}</Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  )
}

/**
 * Wikipedia's Article structured data: name, URL, a one-line headline and the
 * authors, plus the original article it is based on and its license.
 */
function articleJsonLd(article: ArticleRecord) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    name: article.title,
    url: `${SITE_URL}${wikiHref(article.title)}`,
    headline: firstSentence(article.text, 110),
    ...(article.image ? { image: imageSrc(article.image) } : {}),
    author: { '@type': 'Organization', name: 'Contributors to Wikimedia projects' },
    isBasedOn: wikipediaUrl(article.title),
    license: LICENSE_URL,
  }
}

/**
 * Everything the article query unlocks, revealed in one step: the text,
 * Contents, the Contents button and the timing bar. (React spaces separate
 * reveals about 300 ms apart, so parts that wait on the same query share a
 * boundary.) The link lists and the link check's timing stream in after.
 */
async function ArticleContent({ title, page, check }: { title: string; page: Promise<Loaded>; check: Promise<LinkCheck> }) {
  const loaded = await page
  if (loaded.kind === 'redirect') redirect(wikiHref(loaded.to))
  if (loaded.kind === 'article') queueUncopiedImages([loaded.article])
  const sections = loaded.kind === 'article' ? loaded.parsed.sections : []
  const original = wikipediaUrl(title)
  return (
    <PageLayout toc={sections.length > 0 ? <TocSidebar sections={sections} /> : undefined} footer={<Footer lines={[LICENSE_LINE]} links={[{ label: 'Original article', href: original }, ...FOOTER_LINKS]} />}>
      <TitleBar title={loaded.kind === 'article' ? loaded.article.title : title} tocButton={<TocButton sections={sections} />} left={ARTICLE_TABS} right={articleViewTabs(title)} />
      <Suspense fallback={<DbTimingBar {...loaded.timing} />}>
        <LinkTimingBar timing={loaded.timing} check={check} />
      </Suspense>
      {loaded.kind === 'article' ? <JsonLd data={articleJsonLd(loaded.article)} /> : null}
      <div className="wiki-body">
        <Tagline />
        {loaded.kind === 'article' ? (
          <ArticleBody loaded={loaded} check={check} />
        ) : (
          <>
            <Missing title={title} />
            <NeighbourLinks prev={loaded.prev} next={loaded.next} />
          </>
        )}
      </div>
    </PageLayout>
  )
}

/**
 * An article, streamed in three steps: the shell (title, tabs, Contents
 * heading) at once, then everything the article query unlocks, then the
 * links once the link check returns.
 */
export function ArticlePage({ title }: { title: string }) {
  const page = loadArticle(title)
  const check = checkLinks(page)
  return (
    <Suspense fallback={<ArticleShell title={title} />}>
      <ArticleContent title={title} page={page} check={check} />
    </Suspense>
  )
}
