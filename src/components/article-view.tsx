import { DbTimingBar } from '@/components/db-timing'
import { LinkedList } from '@/components/linked-list'
import { ARTICLE_TABS, ArticleShell, articleViewTabs, Tagline } from '@/components/loading'
import { Footer, FOOTER_LINKS, LICENSE_LINE, PageLayout, TitleBar } from '@/components/page-layout'
import { TocButton, TocSidebar } from '@/components/toc'
import { db } from '@/db'
import { articles, leadImage } from '@/db/schema'
import { linkTitles, SEE_ALSO } from '@/lib/article-links'
import { queueUncopiedImages } from '@/lib/image-copies'
import { filePageUrl, imageSourceUrl, imageSrc, LICENSE_URL, searchHref, SITE_URL, wikiHref, wikipediaUrl, type ImageRef } from '@/lib/links'
import { JsonLd } from '@/lib/seo'
import { firstSentence, parseArticle, type Block, type ParsedArticle } from '@/lib/wikitext'
import { asc, desc, eq, getTableColumns, gt, inArray, lt, sql } from 'drizzle-orm'
import Link from 'next/link'
import { permanentRedirect } from 'next/navigation'
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

/** The article text, with "See also" and disambiguation lists linked by the link check (`links`). */
function Blocks({ blocks, title, links, disambiguation }: { blocks: Block[]; title: string; links: Set<string>; disambiguation: boolean }) {
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
    return <LinkedList key={i} items={block.items} seeAlso={seeAlso} existing={links} />
  })
}

/** `image` is the article's lead image, or null when it has none. */
export type ArticleRecord = { id: number; url: string; title: string; text: string; image: ImageRef | null }

/** The titles alphabetically before and after this one, for the previous/next links. */
type Neighbours = { prev: string | null; next: string | null }

/** What the database has for a title: the article, the stored spelling to redirect to, or nothing. */
type ArticleLookup = ({ kind: 'article'; article: ArticleRecord } & Neighbours) | { kind: 'redirect'; to: string } | ({ kind: 'missing' } & Neighbours)

/**
 * Reads the article and its neighbours in one round trip (a transaction of
 * three statements). The neighbours are one step backward and forward along
 * the unique title index, so they cost well under a millisecond and work for a
 * missing title too: they show where it would sit. A miss then looks for the
 * stored spelling ("albert einstein" -> Albert Einstein). Wikipedia titles are
 * at most 255 bytes, so a longer one is missing without a query.
 */
export async function lookUpArticle(title: string): Promise<ArticleLookup> {
  if (Buffer.byteLength(title) > 255) return { kind: 'missing', prev: null, next: null }
  const [rows, before, after] = await db.batch([
    db
      .select({ ...getTableColumns(articles), image: leadImage() })
      .from(articles)
      .where(eq(articles.title, title))
      .limit(1),
    db.select({ title: articles.title }).from(articles).where(lt(articles.title, title)).orderBy(desc(articles.title)).limit(1),
    db.select({ title: articles.title }).from(articles).where(gt(articles.title, title)).orderBy(asc(articles.title)).limit(1),
  ])
  const prev = before[0]?.title ?? null
  const next = after[0]?.title ?? null
  if (rows[0]) return { kind: 'article', article: rows[0], prev, next }
  const [stored] = await db
    .select({ title: articles.title })
    .from(articles)
    .where(sql`lower(${articles.title}) = lower(${title})`)
    .orderBy(sql`${articles.title} = ${title} DESC`)
    .limit(1)
  return stored && stored.title !== title ? { kind: 'redirect', to: stored.title } : { kind: 'missing', prev, next }
}

function Missing({ title }: { title: string }) {
  return (
    <div className="mt-4 border border-border-subtle bg-secondary px-4 py-3">
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
    <nav aria-label="Previous and next articles" className="mt-8 grid grid-cols-2 gap-4 border-t border-border pt-3 text-sm leading-snug">
      {prev ? (
        <Link href={wikiHref(prev)} rel="prev" className="min-w-0">
          <span className="block text-xs text-subtle">← Previous article</span>
          <span className="block truncate">{prev}</span>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link href={wikiHref(next)} rel="next" className="min-w-0 text-right">
          <span className="block text-xs text-subtle">Next article →</span>
          <span className="block truncate">{next}</span>
        </Link>
      ) : null}
    </nav>
  )
}

function ArticleBody({ article, parsed, disambiguation, links, prev, next }: { article: ArticleRecord; parsed: ParsedArticle; disambiguation: boolean; links: Set<string> } & Neighbours) {
  return (
    <>
      {article.image ? <LeadImage image={article.image} title={article.title} /> : null}
      <Blocks blocks={parsed.blocks} title={article.title} links={links} disambiguation={disambiguation} />
      <NeighbourLinks prev={prev} next={next} />
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
    ...(article.image ? { image: imageSourceUrl(article.image) } : {}),
    author: { '@type': 'Organization', name: 'Contributors to Wikimedia projects' },
    isBasedOn: wikipediaUrl(article.title),
    license: LICENSE_URL,
  }
}

function Redirect({ to }: { to: string }): never {
  permanentRedirect(wikiHref(to))
}

/**
 * Another spelling of a title: the target's blank article, and the redirect
 * thrown inside a Suspense boundary. Next caches a redirect thrown outside one
 * as a 307 with no Location header, and inside one as the page with a meta
 * refresh (immediate for a permanent redirect), which the client router also
 * follows.
 */
function RedirectPage({ to }: { to: string }) {
  return (
    <>
      <ArticleShell title={to} />
      <Suspense fallback={null}>
        <Redirect to={to} />
      </Suspense>
    </>
  )
}

/**
 * An article page: the article, then the link check, rendered in one pass.
 * The route caches the whole page (`use cache`) and renders it without a
 * Suspense boundary, so the article is in the first paint. The timing bar adds
 * up the time spent waiting on the two queries.
 */
export async function ArticlePage({ title }: { title: string }) {
  let started = performance.now()
  const found = await lookUpArticle(title)
  let ms = performance.now() - started
  if (found.kind === 'redirect') return <RedirectPage to={found.to} />

  const article = found.kind === 'article' ? found.article : null
  const parsed = article ? parseArticle(article.text) : null
  const disambiguation = parsed ? isDisambiguation(parsed.blocks) : false
  if (article) queueUncopiedImages([article])

  // Which "See also" and disambiguation targets exist, so they render blue or red like on Wikipedia.
  const targets = parsed ? linkTitles(parsed.blocks, disambiguation) : []
  let links = new Set<string>()
  if (targets.length > 0) {
    started = performance.now()
    const rows = await db
      .select({ title: articles.title })
      .from(articles)
      .where(inArray(articles.title, targets))
      .catch(() => [])
    ms += performance.now() - started
    links = new Set(rows.map((row) => row.title))
  }

  const sections = parsed?.sections ?? []
  return (
    <PageLayout toc={sections.length > 0 ? <TocSidebar sections={sections} /> : undefined} footer={<Footer lines={[LICENSE_LINE]} links={[{ label: 'Original article', href: wikipediaUrl(title) }, ...FOOTER_LINKS]} />}>
      <TitleBar title={article?.title ?? title} tocButton={<TocButton sections={sections} />} left={ARTICLE_TABS} right={articleViewTabs(title)} />
      <DbTimingBar totalMs={ms} />
      {article ? <JsonLd data={articleJsonLd(article)} /> : null}
      <div className="wiki-body">
        <Tagline />
        {article && parsed ? (
          <ArticleBody article={article} parsed={parsed} disambiguation={disambiguation} links={links} prev={found.prev} next={found.next} />
        ) : (
          <>
            <Missing title={title} />
            <NeighbourLinks prev={found.prev} next={found.next} />
          </>
        )}
      </div>
    </PageLayout>
  )
}
