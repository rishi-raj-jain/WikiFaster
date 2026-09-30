'use client'

import { DbTimingBar } from '@/components/db-timing'
import { ResultsLoading } from '@/components/loading'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination'
import { imageSrc, searchHref, wikiHref } from '@/lib/links'
import type { SearchHit, SearchPayload } from '@/lib/search'
import { cn } from 'cn'
import { SearchIcon, XIcon } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

/** Results per page. The same as `PAGE_SIZE` in src/lib/search/results.ts, which is server-only. */
const PAGE_SIZE = 20

/** Renders a ts_headline snippet whose matches are wrapped in \u0001…\u0002, as text with bold spans. */
function Snippet({ text }: { text: string }) {
  const parts = text.replace(/\s+/g, ' ').split(/(\u0001[^\u0002]*\u0002)/)
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('\u0001') ? (
          <span key={i} className="wiki-searchmatch">
            {part.slice(1, -1)}
          </span>
        ) : (
          part
        ),
      )}
    </>
  )
}

/** A result, with its lead image on the left when the article has one, as on Special:Search. */
function Result({ hit }: { hit: SearchHit }) {
  return (
    <li className="flex min-w-0 gap-3">
      {hit.image ? (
        <Link href={wikiHref(hit.title)} tabIndex={-1} aria-hidden className="shrink-0">
          <img src={imageSrc(hit.image)} alt="" loading="lazy" decoding="async" className="size-24 rounded-xs border border-border-subtle bg-white object-cover" />
        </Link>
      ) : null}
      <div className="min-w-0">
        <div className="text-[1.0625rem] leading-snug">
          <Link href={wikiHref(hit.title)}>{hit.title}</Link>
        </div>
        <div className="mt-0.5 text-sm leading-[1.6] text-foreground">
          <Snippet text={hit.snippet} />
        </div>
        <div className="mt-0.5 text-[0.8125rem] text-subtle">
          {Math.max(1, Math.round(hit.bytes / 1024)).toLocaleString()} KB ({hit.words.toLocaleString()} words)
        </div>
      </div>
    </li>
  )
}

function Pages({ page, total, onPage, q }: { page: number; total: number; onPage: (page: number) => void; q: string }) {
  const last = Math.max(1, Math.min(1000, Math.ceil(total / PAGE_SIZE)))
  if (last <= 1) return null
  const from = Math.max(1, Math.min(page - 2, last - 4))
  const pages = Array.from({ length: Math.min(5, last) }, (_, i) => from + i)
  const link = (target: number) => ({
    href: searchHref(q, { page: target, fulltext: true }),
    onClick: (event: React.MouseEvent) => {
      event.preventDefault()
      onPage(target)
    },
  })
  return (
    <Pagination className="mt-8 justify-start">
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious {...link(page - 1)} aria-disabled={page <= 1} className={cn('rounded-xs', page <= 1 && 'pointer-events-none opacity-40')} />
        </PaginationItem>
        {pages.map((target) => (
          <PaginationItem key={target}>
            <PaginationLink {...link(target)} isActive={target === page} className="rounded-xs">
              {target}
            </PaginationLink>
          </PaginationItem>
        ))}
        <PaginationItem>
          <PaginationNext {...link(page + 1)} aria-disabled={page >= last} className={cn('rounded-xs', page >= last && 'pointer-events-none opacity-40')} />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  )
}

function Summary({ payload }: { payload: SearchPayload }) {
  const { count, rows, page } = payload
  if (!count || count.count == null || rows.length === 0) return null
  const first = (page - 1) * PAGE_SIZE + 1
  return (
    <p className="text-[0.8125rem] text-subtle">
      Results {first.toLocaleString()} – {(first + rows.length - 1).toLocaleString()} of {count.exact ? '' : 'about '}
      <b className="text-foreground">{count.count.toLocaleString()}</b>
    </p>
  )
}

/** The timing bar for the latest search: stale numbers fade while the next query runs. */
function SearchTiming({ q, payload, loading }: { q: string; payload: SearchPayload | null; loading: boolean }) {
  if (!q) return <DbTimingBar status="type to search, every keystroke queries Postgres" />
  if (!payload || payload.error) return <DbTimingBar status={loading ? 'querying…' : 'the query failed'} />
  return <DbTimingBar totalMs={payload.ms} dim={loading} />
}

/**
 * Special:Search. The server renders the first results into the page
 * (`initialPayload`), so they show before any script runs. After that, results
 * come from `/api/search`, one request per keystroke, query or page, with no
 * debounce: each new request aborts the one before it. The rows and their
 * exact total arrive together. The URL mirrors the query, so back/forward walk
 * the submitted searches.
 */
export function SearchResults({ initialQuery, initialPage, exactTitle, initialPayload }: { initialQuery: string; initialPage: number; exactTitle: string | null; initialPayload: SearchPayload | null }) {
  const [input, setInput] = useState(initialQuery)
  const [query, setQuery] = useState({ q: initialQuery, page: initialPage, verbatim: false })
  const [payload, setPayload] = useState<SearchPayload | null>(initialPayload)
  const [loading, setLoading] = useState(Boolean(initialQuery) && !initialPayload)
  const abortRef = useRef<AbortController | null>(null)
  const topRef = useRef<HTMLDivElement>(null)
  // The query the server already answered, compared by identity so going back to it later fetches afresh.
  const served = useRef(initialPayload ? query : null)

  useEffect(() => {
    abortRef.current?.abort()
    if (query === served.current) return
    if (!query.q) {
      setPayload(null)
      setLoading(false)
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    const params = new URLSearchParams({ q: query.q, page: String(query.page) })
    if (query.verbatim) params.set('verbatim', '1')
    fetch(`/api/search?${params}`, { signal: controller.signal })
      .then((response) => response.json() as Promise<SearchPayload>)
      .then((next) => {
        setPayload(next)
        setLoading(false)
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setPayload({ q: query.q, page: query.page, rows: [], mode: 'fulltext', count: null, ms: 0, error: err instanceof Error ? err.message : 'Search failed', corrected: null, suggestion: null })
        setLoading(false)
      })
    return () => controller.abort()
  }, [query])

  // Back/forward between searches made on this page.
  useEffect(() => {
    const onPop = () => {
      const params = new URLSearchParams(window.location.search)
      const q = params.get('search') ?? ''
      setInput(q)
      setQuery({ q, page: Math.max(1, Number(params.get('page')) || 1), verbatim: false })
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  /**
   * Runs a search right away: no debounce, the previous request is aborted.
   * Typing replaces the URL; submitting, paging and links push a history entry.
   */
  function search(q: string, page = 1, verbatim = false, replace = false) {
    const href = searchHref(q, { page, fulltext: true })
    if (href !== window.location.pathname + window.location.search) window.history[replace ? 'replaceState' : 'pushState'](null, '', href)
    document.title = q ? `${q} - Search results - Wikipedia` : 'Search - Wikipedia'
    setQuery({ q, page, verbatim })
    if (page > 1 || query.page > 1) topRef.current?.scrollIntoView({ block: 'start' })
  }

  const rows = payload?.rows ?? []
  const shownQuery = payload?.corrected ?? query.q

  return (
    <div ref={topRef} className="scroll-mt-4">
      <SearchTiming q={query.q} payload={payload} loading={loading} />
      <form
        role="search"
        className="mt-4 max-w-[700px]"
        onSubmit={(event) => {
          event.preventDefault()
          search(input.trim())
        }}
      >
        <ButtonGroup className="w-full">
          <InputGroup className="h-9 rounded-l-xs rounded-r-none border-(--wiki-input-border) has-[[data-slot=input-group-control]:focus-visible]:shadow-[inset_0_0_0_1px_var(--wiki-progressive)] has-[[data-slot=input-group-control]:focus-visible]:ring-0">
            <InputGroupAddon className="pl-2.5 text-subtle">
              <SearchIcon className="size-4.5" />
            </InputGroupAddon>
            <InputGroupInput
              name="search"
              value={input}
              onChange={(event) => {
                const text = event.target.value
                setInput(text)
                // Every keystroke is a query, except ones that do not change it (spaces).
                if (text.trim() !== query.q) search(text.trim(), 1, false, true)
              }}
              aria-label="Search Wikipedia"
              placeholder="Search Wikipedia"
              autoComplete="off"
              spellCheck={false}
              className="text-sm md:text-sm"
            />
            {input ? (
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-xs"
                  aria-label="Clear"
                  onClick={() => {
                    setInput('')
                    search('', 1, false, true)
                  }}
                  className="rounded-full text-subtle"
                >
                  <XIcon />
                </InputGroupButton>
              </InputGroupAddon>
            ) : null}
          </InputGroup>
          <Button type="submit" className="h-9 rounded-l-none rounded-r-xs px-3.5 font-bold hover:bg-(--wiki-progressive-hover)">
            Search
          </Button>
        </ButtonGroup>
      </form>

      {query.q && payload && !loading ? (
        <div className="mt-5 flex flex-col gap-3">
          {exactTitle && query.q === initialQuery && query.page === 1 ? (
            <p className="text-sm">
              There is a page named &quot;<Link href={wikiHref(exactTitle)}>{exactTitle}</Link>&quot; on Wikipedia
            </p>
          ) : !exactTitle && query.q === initialQuery && query.page === 1 ? (
            <p className="text-sm italic">
              The page &quot;
              <Link href={wikiHref(query.q)} className="new">
                {query.q}
              </Link>
              &quot; does not exist. Check the search results below to see whether the topic is already covered.
            </p>
          ) : null}
          {payload.corrected ? (
            <p className="text-sm">
              Showing results for <b className="italic">{payload.corrected}</b>. Search instead for{' '}
              <a
                href={searchHref(query.q, { fulltext: true })}
                onClick={(event) => {
                  event.preventDefault()
                  search(query.q, 1, true)
                }}
              >
                {query.q}
              </a>
              .
            </p>
          ) : payload.suggestion ? (
            <p className="text-sm">
              Did you mean:{' '}
              <a
                href={searchHref(payload.suggestion, { fulltext: true })}
                onClick={(event) => {
                  event.preventDefault()
                  setInput(payload.suggestion!)
                  search(payload.suggestion!)
                }}
                className="font-bold italic"
              >
                {payload.suggestion}
              </a>
            </p>
          ) : null}
          <Summary payload={payload} />
        </div>
      ) : null}

      <div className="mt-6 max-w-[760px]">
        {loading && rows.length === 0 ? (
          <ResultsLoading />
        ) : payload?.error ? (
          <p className="text-sm text-destructive">{payload.error}</p>
        ) : query.q && payload && rows.length === 0 ? (
          <p className="text-sm">There were no results matching the query.</p>
        ) : (
          <div className={cn('transition-opacity', loading && 'opacity-50 delay-100')}>
            <ul className="flex flex-col gap-6">
              {rows.map((hit) => (
                <Result key={hit.id} hit={hit} />
              ))}
            </ul>
            {payload?.count?.count ? <Pages page={query.page} total={payload.count.count} q={shownQuery} onPage={(page) => search(query.q, page, query.verbatim)} /> : null}
          </div>
        )}
      </div>
    </div>
  )
}
