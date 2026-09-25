import { type ArticleRecord } from '@/components/article-view'
import { DbTimingBar } from '@/components/db-timing'
import { GithubMark, NeonLogo, VercelMark } from '@/components/logos'
import { Footer, FOOTER_LINKS, LICENSE_LINE, PageLayout, TitleBar } from '@/components/page-layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/db'
import { articles, leadImage, siteStats } from '@/db/schema'
import { queueUncopiedImages } from '@/lib/image-copies'
import { filePageUrl, imageSrc, SOURCE_URL, SPECIAL_RANDOM, wikiHref } from '@/lib/links'
import { firstSentence, leadParagraphs, sectionItems } from '@/lib/wikitext'
import { cn } from 'cn'
import { getTableColumns, inArray, sql } from 'drizzle-orm'
import Link from 'next/link'

/** Links the first mention of `title` inside `text` in bold, the way Main Page blurbs do. */
function Blurb({ text, title, italic = false }: { text: string; title: string; italic?: boolean }) {
  const bare = title.replace(/\s*\(.*\)$/, '')
  const at = text.toLowerCase().indexOf(bare.toLowerCase())
  const link = (label: string) => (
    <Link href={wikiHref(title)} className={cn('font-bold', italic && 'italic')}>
      {label}
    </Link>
  )
  if (at < 0) {
    return (
      <>
        {link(title)}: {text}
      </>
    )
  }
  return (
    <>
      {text.slice(0, at)}
      {link(text.slice(at, at + bare.length))}
      {text.slice(at + bare.length)}
    </>
  )
}

/**
 * Picks `count` random articles of at least `minBytes`, with the first
 * `leadChars` characters of their text. Each pick seeks the primary key from a
 * random id between the smallest and largest, so it costs one index probe
 * instead of `ORDER BY random()` over 6.4M rows. `random()` is computed per
 * outer row (the `g * 0` keeps it from being hoisted), and the seek compares
 * against that plain value so it stays an index condition. Two picks can land
 * on the same article, so duplicates are dropped and fewer than `count` may
 * come back.
 */
async function randomArticles(count: number, minBytes: number, leadChars: number): Promise<ArticleRecord[]> {
  const { rows } = await db.execute<ArticleRecord>(sql`
    WITH bounds AS MATERIALIZED (SELECT min(id) AS lo, max(id) - min(id) AS span FROM articles)
    SELECT a.id::int AS id, a.url, a.title, a.text, a.image
    FROM bounds
    CROSS JOIN generate_series(1, ${count}::int) g
    CROSS JOIN LATERAL (SELECT bounds.lo + floor(random() * bounds.span)::bigint + g * 0 AS pick) r
    CROSS JOIN LATERAL (
      SELECT id, url, title, left(text, ${leadChars}::int) AS text, ${leadImage()} AS image FROM articles
      WHERE id >= r.pick AND octet_length(text) >= ${minBytes}::int
      ORDER BY id LIMIT 1
    ) a`)
  const seen = new Set<number>()
  return rows.filter((row) => !seen.has(row.id) && seen.add(row.id))
}

/**
 * The article for the date ("September 24"), whose Events list feeds "On this
 * day". The dump has no plain date articles, so the day's Eastern Orthodox
 * liturgics page is the fallback.
 */
async function dateArticle(date: Date): Promise<ArticleRecord | null> {
  const day = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })
  const titles = [day, `${day} (Eastern Orthodox liturgics)`]
  const rows = await db
    .select({ ...getTableColumns(articles), image: leadImage() })
    .from(articles)
    .where(inArray(articles.title, titles))
  return rows.sort((a, b) => titles.indexOf(a.title) - titles.indexOf(b.title))[0] ?? null
}

/** Exact article count from the trigger-maintained `site_stats` row. */
async function ArticleCount({ data }: { data: Promise<{ articles: number }[]> }) {
  const count = await data.then((rows) => rows[0]?.articles ?? null).catch(() => null)
  if (count == null) return <>Millions of</>
  return <Link href={wikiHref(SPECIAL_RANDOM)}>{count.toLocaleString()}</Link>
}

/**
 * "From today's featured article": a random substantial article, new on each render,
 * with its lead image on the left. Candidates with an image go first.
 */
async function Featured({ data }: { data: Promise<ArticleRecord[]> }) {
  const candidates = await data
  const readable = candidates.filter((candidate) => !LIST_PAGE.test(candidate.title) && isFact(firstSentence(candidate.text, 400)))
  const article = readable.find((candidate) => candidate.image) ?? readable[0] ?? candidates[0]
  if (!article) return null
  queueUncopiedImages([article])
  const [first, ...rest] = leadParagraphs(article.text, 1100)
  return (
    <div className="flow-root">
      {article.image ? (
        <a href={filePageUrl(article.image)} target="_blank" rel="noreferrer" title="Image credit and license on Wikipedia" className="float-left mt-1 mr-3 mb-1">
          <img src={imageSrc(article.image)} alt={article.title} decoding="async" className="max-h-40 w-[100px] border border-border-subtle bg-white object-contain" />
        </a>
      ) : null}
      <p>
        <Blurb text={first ?? ''} title={article.title} italic />
      </p>
      {rest.map((paragraph, i) => (
        <p key={i} className="mt-2">
          {paragraph}
        </p>
      ))}
      <p className="mt-2">
        (
        <Link href={wikiHref(article.title)} className="font-bold italic">
          Full article…
        </Link>
        )
      </p>
    </div>
  )
}

/** Lists, outlines and indexes make poor Main Page blurbs. */
const LIST_PAGE = /^(lists?|outline|index|timeline|glossary) of\b/i

/** A lead sentence that reads as a fact: a real clause, not a list heading or a fragment. */
function isFact(sentence: string): boolean {
  return sentence.length >= 60 && /\b(is|was|are|were|has|had)\b/.test(sentence) && !/[:;]$/.test(sentence) && !/^the following\b/i.test(sentence)
}

/** "Did you know …": the opening sentence of random articles, phrased as questions. */
async function DidYouKnow({ data }: { data: Promise<ArticleRecord[]> }) {
  const picks = await data
  const facts = picks.map((article) => ({ article, sentence: firstSentence(article.text, 220).replace(/[.!]$/, '') })).filter((fact) => !LIST_PAGE.test(fact.article.title) && isFact(fact.sentence))
  return (
    <ul className="ml-5 list-disc space-y-1">
      {facts.slice(0, 6).map(({ article, sentence }) => (
        <li key={article.id}>
          … that <Blurb text={sentence} title={article.title} />?
        </li>
      ))}
    </ul>
  )
}

/** A few random articles with their opening line, in place of "In the news". */
async function RandomArticles({ data }: { data: Promise<ArticleRecord[]> }) {
  const picks = await data
  return (
    <ul className="ml-5 list-disc space-y-1">
      {picks.map((article) => (
        <li key={article.id}>
          <Blurb text={firstSentence(article.text, 180)} title={article.title} />
        </li>
      ))}
      <li className="list-none pt-1 text-right font-bold">
        <Link href={wikiHref(SPECIAL_RANDOM)}>Another random article</Link>
      </li>
    </ul>
  )
}

/** "On this day": today's events, or the saints and feasts of the day when the dump has no events list. */
async function OnThisDay({ data, today }: { data: Promise<ArticleRecord | null>; today: Date }) {
  const article = await data
  if (!article) return <p>No article for today's date.</p>
  const events = sectionItems(article.text, /^events$/i)
  const items = events.length ? events : sectionItems(article.text, /saints/i)
  const step = Math.max(1, Math.floor(items.length / 6))
  const picked = items.filter((_, i) => i % step === 0).slice(0, 6)
  const day = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })
  return (
    <div>
      <p>
        <b>{day}</b>
        {events.length ? null : (
          <>
            {' '}
            in the <Link href={wikiHref(article.title)}>Eastern Orthodox liturgical calendar</Link>
          </>
        )}
      </p>
      <ul className="mt-1 ml-5 list-disc space-y-1">
        {picked.map((item) => {
          const match = item.match(/^(\d{1,4}(?:\s?BC)?)\s+[–-]\s+(.*)$/)
          return (
            <li key={item}>
              {match ? (
                <>
                  <b>{match[1]}</b> – {match[2]}
                </>
              ) : (
                item
              )}
            </li>
          )
        })}
      </ul>
      <p className="mt-2 text-right font-bold">
        <Link href={wikiHref(article.title)}>More commemorations…</Link>
      </p>
    </div>
  )
}

/**
 * The timing bar for the whole page, once all five queries are in. They start
 * together at `started`, so the total is how long the slowest one took.
 */
async function MainTiming({ queries, started }: { queries: Promise<unknown>[]; started: number }) {
  const ok = await Promise.all(queries).then(
    () => true,
    () => false,
  )
  return ok ? <DbTimingBar totalMs={performance.now() - started} /> : <DbTimingBar status="the queries failed" />
}

function Box({ title, tone, children }: { title: string; tone: 'green' | 'blue'; children: React.ReactNode }) {
  return (
    <Card className={cn('gap-0 rounded-none py-0 shadow-none ring-0', tone === 'green' ? 'bg-(--wiki-mp-green-bg)' : 'bg-(--wiki-mp-blue-bg)')}>
      <CardHeader className="px-2 pt-2">
        <CardTitle
          className={cn(
            'border px-2 py-1 font-sans text-[1.2rem] leading-snug font-bold text-emphasized',
            tone === 'green' ? 'border-(--wiki-mp-green-head-border) bg-(--wiki-mp-green-head)' : 'border-(--wiki-mp-blue-head-border) bg-(--wiki-mp-blue-head)',
          )}
        >
          <h2>{title}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-2 pt-2 pb-3 text-(length:--wiki-font-size) leading-(--wiki-line-height)">{children}</CardContent>
    </Card>
  )
}

/**
 * The Main Page. Its five queries start at once, each its own round trip, and
 * each box renders from its own. The pages that use it cache the whole render
 * until revalidated (`use cache`), so it is sent complete and the picks stay put.
 */
export function MainPage() {
  const today = new Date()
  const started = performance.now()
  const count = db
    .select({ articles: siteStats.articles })
    .from(siteStats)
    .limit(1)
    .then((rows) => rows)
  // A substantial article for "From today's featured article", with a few spares in case one reads badly.
  const featured = randomArticles(4, 20_000, 6000)
  // Enough candidates that six opening sentences read as facts.
  const didYouKnow = randomArticles(14, 3000, 1500)
  const random = randomArticles(6, 1500, 1200)
  const onThisDay = dateArticle(today)
  return (
    <PageLayout footer={<Footer lines={[LICENSE_LINE]} links={FOOTER_LINKS} />}>
      <TitleBar hideTitle title="Main Page" left={[{ label: 'Main Page', selected: true }]} right={[{ label: 'Read', selected: true }]} />
      <MainTiming queries={[count, featured, didYouKnow, random, onThisDay]} started={started} />
      <section className="mt-4 border border-border-subtle bg-secondary px-4 py-4 text-center">
        <h1 className="text-[1.8rem] leading-tight text-emphasized">
          Welcome to <Link href="/">Wikipedia</Link>,
        </h1>
        <p className="text-md my-4">
          served live from{' '}
          <a href="https://neon.com" target="_blank" rel="noreferrer" className="whitespace-nowrap text-foreground! underline">
            <NeonLogo className="inline-block h-[1.15em] w-auto align-[-0.2em]" /> Postgres
          </a>{' '}
          <a className="underline" href="https://neon.com/docs/extensions/lakebase-text" target="_blank" rel="noreferrer">
            with BM25 ranking
          </a>{' '}
          and deployed on{' '}
          <a href="https://vercel.com" target="_blank" rel="noreferrer" className="whitespace-nowrap text-foreground! underline">
            <VercelMark className="inline-block h-[0.9em] w-auto align-[-0.05em]" /> Vercel
          </a>
          .
        </p>
        <p className="mt-1.5 text-sm">
          <a href={SOURCE_URL} target="_blank" rel="noreferrer" className="font-bold">
            <GithubMark className="inline-block h-[1.05em] w-[1.05em] align-[-0.15em]" /> View source
          </a>
        </p>
        <p className="mt-0.5 text-[0.8125rem]">
          <ArticleCount data={count} /> articles in <Link href="/">English</Link>
        </p>
      </section>

      <div className="mt-2 grid gap-2 lg:grid-cols-[minmax(0,55fr)_minmax(0,45fr)]">
        <div className="flex flex-col gap-2 border border-(--wiki-mp-green-border) bg-(--wiki-mp-green-bg)">
          <Box title="From today's featured article" tone="green">
            <Featured data={featured} />
          </Box>
          <Box title="Did you know ..." tone="green">
            <DidYouKnow data={didYouKnow} />
          </Box>
        </div>
        <div className="flex flex-col gap-2 border border-(--wiki-mp-blue-border) bg-(--wiki-mp-blue-bg)">
          <Box title="Random articles" tone="blue">
            <RandomArticles data={random} />
          </Box>
          <Box title="On this day" tone="blue">
            <OnThisDay data={onThisDay} today={today} />
          </Box>
        </div>
      </div>
    </PageLayout>
  )
}
