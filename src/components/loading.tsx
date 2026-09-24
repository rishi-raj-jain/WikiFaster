import { DbTimingBar } from '@/components/db-timing'
import { PageLayout, TitleBar, type Tab } from '@/components/page-layout'
import { TocButton, TocSidebar } from '@/components/toc'
import { Skeleton } from '@/components/ui/skeleton'
import { MAIN_PAGE, wikiHref } from '@/lib/links'

function Lines({ count, offset = 0 }: { count: number; offset?: number }) {
  return (
    <div className="flex flex-col gap-2.5">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="bg-divider h-3.5 rounded-xs" style={{ width: `${70 + (((i + offset) * 13) % 30)}%` }} />
      ))}
    </div>
  )
}

/** Placeholder paragraphs while an article's text streams in. */
export function ArticleBodyLoading() {
  return (
    <div aria-busy className="mt-4">
      <Lines count={5} />
      <div className="mt-6">
        <Lines count={4} offset={3} />
      </div>
      <Skeleton className="bg-divider mt-8 mb-4 h-6 w-1/3 rounded-xs" />
      <Lines count={6} offset={5} />
    </div>
  )
}

/** Placeholder result rows for the search page. */
export function ResultsLoading({ rows = 6 }: { rows?: number }) {
  return (
    <ul aria-busy className="flex flex-col gap-6">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex flex-col gap-2">
          <Skeleton className="bg-divider h-4.5 rounded-xs" style={{ width: `${30 + ((i * 17) % 35)}%` }} />
          <Skeleton className="bg-divider h-3.5 w-11/12 rounded-xs" />
          <Skeleton className="bg-divider h-3.5 w-3/4 rounded-xs" />
          <Skeleton className="bg-divider h-3 w-40 rounded-xs" />
        </li>
      ))}
    </ul>
  )
}

/** Placeholder for one Main Page box body. */
export function BoxLoading({ lines = 6 }: { lines?: number }) {
  return (
    <div aria-busy className="p-2">
      <Lines count={lines} />
    </div>
  )
}

export function wikipediaUrl(title: string): string {
  return `https://en.wikipedia.org${wikiHref(title)}`
}

export const ARTICLE_TABS: Tab[] = [{ label: 'Article', selected: true }]

export function articleViewTabs(title: string | null): Tab[] {
  return title
    ? [
        { label: 'Read', selected: true },
        { label: 'View on Wikipedia', href: wikipediaUrl(title), external: true },
      ]
    : [{ label: 'Read', selected: true }]
}

export function Tagline() {
  return <div className="text-foreground mt-2 mb-2 text-sm leading-relaxed">From Wikipedia, the free encyclopedia</div>
}

/**
 * An article's first paint: the real title, the Contents heading and
 * placeholders. The server streams it before the article query returns, and a
 * link click draws the same thing at once, so one hands over to the other
 * without a jump. `title` is null when it is not known yet (Special:Random).
 */
export function ArticleShell({ title }: { title: string | null }) {
  return (
    <PageLayout toc={<TocSidebar sections={[]} />}>
      <TitleBar title={title ?? <Skeleton className="bg-divider my-2 inline-block h-8 w-64 rounded-xs align-middle" />} tocButton={<TocButton sections={null} />} left={ARTICLE_TABS} right={articleViewTabs(title)} />
      <DbTimingBar status="querying…" />
      <div className="wiki-body">
        <Tagline />
        <ArticleBodyLoading />
      </div>
    </PageLayout>
  )
}

export function MainShell() {
  return (
    <PageLayout>
      <TitleBar hideTitle title={MAIN_PAGE} left={[{ label: MAIN_PAGE, selected: true }]} right={[{ label: 'Read', selected: true }]} />
      <DbTimingBar status="querying…" />
      <ArticleBodyLoading />
    </PageLayout>
  )
}

export function SearchShell() {
  return (
    <PageLayout>
      <TitleBar title="Search results" left={[{ label: 'Special page', selected: true }]} />
      <DbTimingBar status="querying…" />
      <div className="mt-6 max-w-[760px]">
        <ResultsLoading />
      </div>
    </PageLayout>
  )
}
