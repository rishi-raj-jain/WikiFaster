import { DbTimingBar } from '@/components/db-timing'
import { BoxLoading } from '@/components/loading'
import { GithubMark, NeonLogo, VercelMark } from '@/components/logos'
import { measureDb, type DbTimed } from '@/db'
import { FOOTER_LINKS, Footer, LICENSE_LINE, PageLayout, TitleBar } from '@/components/page-layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SOURCE_URL, SPECIAL_RANDOM, filePageUrl, imageSrc, wikiHref } from '@/lib/links'
import { queueUncopiedImages } from '@/lib/image-copies'
import { mainPageData, type MainPageData } from '@/lib/queries'
import { firstSentence, leadParagraphs, sectionItems } from '@/lib/wikitext'
import { cn } from 'cn'
import Link from 'next/link'
import { Suspense } from 'react'

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

/** The one round trip every part of the page reads from. */
type Data = Promise<DbTimed<MainPageData>>

async function ArticleCount({ data }: { data: Data }) {
  const count = await data.then(({ value }) => value.count).catch(() => null)
  if (count == null) return <>Millions of</>
  return <Link href={wikiHref(SPECIAL_RANDOM)}>{count.toLocaleString()}</Link>
}

/**
 * "From today's featured article": a random substantial article, new on every
 * load, with its lead image on the left. Candidates with an image go first.
 */
async function Featured({ data }: { data: Data }) {
  const candidates = (await data).value.featured
  const readable = candidates.filter((candidate) => !LIST_PAGE.test(candidate.title) && isFact(firstSentence(candidate.text, 400)))
  const article = readable.find((candidate) => candidate.image) ?? readable[0] ?? candidates[0]
  if (!article) return null
  queueUncopiedImages([article])
  const [first, ...rest] = leadParagraphs(article.text, 1100)
  return (
    <>
      <div className="flow-root">
        {article.image ? (
          <a href={filePageUrl(article.image)} target="_blank" rel="noreferrer" title="Image credit and license on Wikipedia" className="float-left mt-1 mr-3 mb-1">
            <img src={imageSrc(article.image)} alt={article.title} decoding="async" className="border-border-subtle max-h-40 w-[100px] border bg-white object-contain" />
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
    </>
  )
}

/** A lead sentence that reads as a fact: a real clause, not a list heading or a fragment. */
/** Lists, outlines and indexes make poor Main Page blurbs. */
const LIST_PAGE = /^(lists?|outline|index|timeline|glossary) of\b/i

function isFact(sentence: string): boolean {
  return sentence.length >= 60 && /\b(is|was|are|were|has|had)\b/.test(sentence) && !/[:;]$/.test(sentence) && !/^the following\b/i.test(sentence)
}

/** "Did you know …": the opening sentence of random articles, phrased as questions. */
async function DidYouKnow({ data }: { data: Data }) {
  const articles = (await data).value.didYouKnow
  const facts = articles.map((article) => ({ article, sentence: firstSentence(article.text, 220).replace(/[.!]$/, '') })).filter((fact) => !LIST_PAGE.test(fact.article.title) && isFact(fact.sentence))
  return (
    <>
      <ul className="ml-5 list-disc space-y-1">
        {facts.slice(0, 6).map(({ article, sentence }) => (
          <li key={article.id}>
            … that <Blurb text={sentence} title={article.title} />?
          </li>
        ))}
      </ul>
    </>
  )
}

/** A few random articles with their opening line, in place of "In the news". */
async function RandomArticles({ data }: { data: Data }) {
  const articles = (await data).value.random
  return (
    <>
      <ul className="ml-5 list-disc space-y-1">
        {articles.map((article) => (
          <li key={article.id}>
            <Blurb text={firstSentence(article.text, 180)} title={article.title} />
          </li>
        ))}
        <li className="list-none pt-1 text-right font-bold">
          <Link href={wikiHref(SPECIAL_RANDOM)}>Another random article</Link>
        </li>
      </ul>
    </>
  )
}

/** "On this day": today's events, or the saints and feasts of the day when the dump has no events list. */
async function OnThisDay({ data, today }: { data: Data; today: Date }) {
  const article = (await data).value.onThisDay
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

/** The timing bar for the whole page: its five queries, sent as one round trip. */
async function MainTiming({ data }: { data: Data }) {
  const timing = await data.catch(() => null)
  if (!timing) return <DbTimingBar status="the queries failed" />
  return <DbTimingBar dbMs={timing.dbMs} totalMs={timing.totalMs} queries={timing.queries} />
}

function Box({ title, tone, children, lines }: { title: string; tone: 'green' | 'blue'; children: React.ReactNode; lines?: number }) {
  return (
    <Card className={cn('gap-0 rounded-none py-0 shadow-none ring-0', tone === 'green' ? 'bg-(--wiki-mp-green-bg)' : 'bg-(--wiki-mp-blue-bg)')}>
      <CardHeader className="px-2 pt-2">
        <CardTitle
          className={cn(
            'text-emphasized border px-2 py-1 font-sans text-[1.2rem] leading-snug font-bold',
            tone === 'green' ? 'border-(--wiki-mp-green-head-border) bg-(--wiki-mp-green-head)' : 'border-(--wiki-mp-blue-head-border) bg-(--wiki-mp-blue-head)',
          )}
        >
          <h2>{title}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-2 pt-2 pb-3 text-(length:--wiki-font-size) leading-(--wiki-line-height)">
        <Suspense fallback={<BoxLoading lines={lines} />}>{children}</Suspense>
      </CardContent>
    </Card>
  )
}

/**
 * The Main Page. Everything on it comes from one round trip to Postgres
 * (`mainPageData`), started here and shared by the boxes and the timing bar,
 * which stream in through their Suspense boundaries. Refreshing picks new
 * random articles.
 */
export function MainPage() {
  const today = new Date()
  const data = measureDb(() => mainPageData(today))
  return (
    <PageLayout footer={<Footer lines={[LICENSE_LINE]} links={FOOTER_LINKS} />}>
      <TitleBar hideTitle title="Main Page" left={[{ label: 'Main Page', selected: true }]} right={[{ label: 'Read', selected: true }]} />
      <Suspense fallback={<DbTimingBar status="querying…" />}>
        <MainTiming data={data} />
      </Suspense>
      <section className="border-border-subtle bg-secondary mt-4 border px-4 py-4 text-center">
        <h1 className="text-emphasized text-[1.8rem] leading-tight">
          Welcome to <Link href="/">Wikipedia</Link>,
        </h1>
        <p className="text-md my-4">
          served live from{' '}
          <a href="https://neon.com" target="_blank" rel="noreferrer" className="text-foreground! whitespace-nowrap underline">
            <NeonLogo className="inline-block h-[1.15em] w-auto align-[-0.2em]" /> Postgres
          </a>{' '}
          <a className="underline" href="https://neon.com/docs/extensions/lakebase-text" target="_blank" rel="noreferrer">
            with BM25 ranking
          </a>{' '}
          and deployed on{' '}
          <a href="https://vercel.com" target="_blank" rel="noreferrer" className="text-foreground! whitespace-nowrap underline">
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
          <Suspense fallback={<span className="text-subtle">counting…</span>}>
            <ArticleCount data={data} />
          </Suspense>{' '}
          articles in <Link href="/">English</Link>
        </p>
      </section>

      <div className="mt-2 grid gap-2 lg:grid-cols-[minmax(0,55fr)_minmax(0,45fr)]">
        <div className="flex flex-col gap-2 border border-(--wiki-mp-green-border) bg-(--wiki-mp-green-bg)">
          <Box title="From today's featured article" tone="green" lines={9}>
            <Featured data={data} />
          </Box>
          <Box title="Did you know ..." tone="green" lines={6}>
            <DidYouKnow data={data} />
          </Box>
        </div>
        <div className="flex flex-col gap-2 border border-(--wiki-mp-blue-border) bg-(--wiki-mp-blue-bg)">
          <Box title="Random articles" tone="blue" lines={6}>
            <RandomArticles data={data} />
          </Box>
          <Box title="On this day" tone="blue" lines={5}>
            <OnThisDay data={data} today={today} />
          </Box>
        </div>
      </div>
    </PageLayout>
  )
}
