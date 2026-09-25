'use client'

import { NeonLogo } from '@/components/logos'
import { useStartNavigation } from '@/components/pending-navigation'
import { SearchForm } from '@/components/search-form'
import { formatMs } from '@/lib/format'
import { imageSrc, searchHref, wikiHref, type ImageRef } from '@/lib/links'
import { cn } from 'cn'
import { ImageIcon, SearchIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState } from 'react'

type Suggestion = { title: string; description: string; image: ImageRef | null }
type Suggestions = { suggestions: Suggestion[]; ms: number }

/** A suggestion's lead image as a square, or an image icon in its place, as in Wikipedia's search dropdown. */
function Thumbnail({ image }: { image: ImageRef | null }) {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xs border border-border-subtle bg-secondary text-subtle">
      {image ? <img src={imageSrc(image)} alt="" decoding="async" className="size-full bg-white object-cover" /> : <ImageIcon className="size-5" />}
    </span>
  )
}

/** The top of the dropdown, in the Neon bar's style: how long Postgres took to find these titles, and how many it found. */
function SuggestTiming({ ms, count }: { ms: number; count: number }) {
  return (
    <div className="flex items-center gap-2 border-b border-(--neon-border) bg-(--neon-bg) px-3 py-1.5 text-xs text-(--neon-text)">
      <NeonLogo className="h-[1.15em] w-auto" />
      <span className="font-semibold">Postgres</span>
      <span aria-hidden="true" className="text-(--neon-subtle)">
        ·
      </span>
      <span className="font-(family-name:--font-neon-mono) font-medium text-(--neon-green) tabular-nums">{formatMs(ms)} ms</span>
      <span aria-hidden="true" className="text-(--neon-subtle)">
        ·
      </span>
      <span>
        <span className="font-(family-name:--font-neon-mono) font-medium tabular-nums">{count}</span> <span className="text-(--neon-subtle)">{count === 1 ? 'result' : 'results'}</span>
      </span>
    </div>
  )
}

/** Bolds the part of `title` that matches what was typed, like Wikipedia's dropdown. */
function Highlight({ title, query }: { title: string; query: string }) {
  const at = title.toLowerCase().indexOf(query.trim().toLowerCase())
  if (!query.trim() || at < 0) return <>{title}</>
  const end = at + query.trim().length
  return (
    <>
      {title.slice(0, at)}
      <strong>{title.slice(at, end)}</strong>
      {title.slice(end)}
    </>
  )
}

/**
 * The header search box, a combobox: every keystroke asks `/api/suggest` for
 * titles, aborting the request before it. The arrow keys move through the
 * suggestions and the "pages containing" row. Enter goes to the highlighted
 * row, or else to the typed text, which opens the article of that exact title
 * or the results page, as on Wikipedia.
 */
export function SearchBox({ autoFocus = false, initialQuery = '', onDone, className }: { autoFocus?: boolean; initialQuery?: string; onDone?: () => void; className?: string }) {
  const router = useRouter()
  const startNavigation = useStartNavigation()
  const [q, setQ] = useState(initialQuery)
  const [open, setOpen] = useState(initialQuery !== '')
  const [items, setItems] = useState<Suggestion[]>([])
  const [ms, setMs] = useState<number | null>(null)
  /** The highlighted row: a suggestion's index, `items.length` for "pages containing", or -1 for none. */
  const [active, setActive] = useState(-1)
  const listId = useId()
  const abortRef = useRef<AbortController | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    abortRef.current?.abort()
    const term = q.trim()
    if (!term) {
      setItems([])
      setMs(null)
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    fetch(`/api/suggest?q=${encodeURIComponent(term)}`, { signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<Suggestions>) : null))
      .then((result) => {
        setItems(result?.suggestions ?? [])
        setMs(result ? result.ms : null)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [q])

  // Close the dropdown on a click anywhere else.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => !rootRef.current?.contains(event.target as Node) && setOpen(false)
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  function go(href: string) {
    setOpen(false)
    onDone?.()
    startNavigation(href)
    router.push(href)
  }

  /** Enter: straight to the article when a suggestion is that exact title, saving the redirect round trip; otherwise Special:Search decides. */
  function submit() {
    const term = q.trim()
    if (!term) return
    const exact = items.find((item) => item.title === term) ?? items.find((item) => item.title.toLowerCase() === term.toLowerCase())
    go(exact ? wikiHref(exact.title) : searchHref(term))
  }

  const term = q.trim()
  const showList = open && term.length > 0
  const rows = items.length + 1
  const optionId = (i: number) => `${listId}-${i}`

  function choose(i: number) {
    go(i < items.length ? wikiHref(items[i].title) : searchHref(term, { fulltext: true }))
  }

  return (
    <div ref={rootRef} className={cn('relative w-full', className)}>
      <SearchForm
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
        input={{
          role: 'combobox',
          'aria-expanded': showList,
          'aria-controls': listId,
          'aria-autocomplete': 'list',
          'aria-activedescendant': showList && active >= 0 ? optionId(active) : undefined,
          value: q,
          autoFocus,
          onChange: (event) => {
            setQ(event.target.value)
            setOpen(true)
            setActive(-1)
          },
          onFocus: (event) => {
            setOpen(true)
            // Handed over from the plain box mid-word: keep the caret at the end.
            const end = event.target.value.length
            event.target.setSelectionRange(end, end)
          },
          onKeyDown: (event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              if (!showList) return setOpen(true)
              const step = event.key === 'ArrowDown' ? 1 : -1
              setActive((i) => (i < 0 ? (step > 0 ? 0 : rows - 1) : (i + step + rows) % rows))
            }
            if (event.key === 'Escape') {
              setOpen(false)
              setActive(-1)
              onDone?.()
            }
            // Enter searches the typed text unless a row was chosen with the arrows.
            if (event.key === 'Enter' && showList && active >= 0) {
              event.preventDefault()
              choose(active)
            }
          },
        }}
      />

      {showList ? (
        <div className="absolute top-full right-0 left-0 z-50 border border-border-subtle bg-popover text-popover-foreground shadow-[0_4px_12px_rgba(0,0,0,0.15)] sm:right-auto sm:w-full">
          {ms != null ? <SuggestTiming ms={ms} count={items.length} /> : null}
          <ul id={listId} role="listbox" aria-label="Suggestions">
            {items.map((item, i) => (
              <li
                key={item.title}
                id={optionId(i)}
                role="option"
                aria-selected={active === i}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(i)}
                className={cn('flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-accent', active === i && 'bg-accent')}
              >
                <Thumbnail image={item.image} />
                <span className="flex min-w-0 flex-col">
                  <span className="text-[0.95rem] text-foreground">
                    <Highlight title={item.title} query={term} />
                  </span>
                  {item.description ? <span className="line-clamp-1 text-xs text-subtle">{item.description}</span> : null}
                </span>
              </li>
            ))}
            <li
              id={optionId(items.length)}
              role="option"
              aria-selected={active === items.length}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => choose(items.length)}
              className={cn('flex cursor-pointer items-center gap-3 border-t border-divider px-3 py-2.5 hover:bg-accent', active === items.length && 'bg-accent')}
            >
              <SearchIcon className="size-4.5 shrink-0 text-subtle" />
              <span className="min-w-0 text-sm">
                Search for pages containing <strong className="break-all">{term}</strong>
              </span>
            </li>
          </ul>
        </div>
      ) : null}
    </div>
  )
}
