'use client'

import { NeonLogo } from '@/components/logos'
import { useStartNavigation } from '@/components/pending-navigation'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import { InputGroup, InputGroupAddon } from '@/components/ui/input-group'
import { formatMs } from '@/lib/format'
import { searchHref, wikiHref } from '@/lib/links'
import { Command as CommandPrimitive } from 'cmdk'
import { cn } from 'cn'
import { SearchIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

type Suggestion = { title: string; description: string }
type Suggestions = { suggestions: Suggestion[]; dbMs: number; ms: number }

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

const FULLTEXT = '__search_pages_containing__'

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
 * The header search box. Every keystroke asks `/api/suggest`
 * for titles, aborting the request before it. Enter goes to the typed text,
 * which opens the article of that exact title or the results page, unless the
 * user arrowed into the list first, as on Wikipedia.
 */
export function SearchBox({ autoFocus = false, onDone, className }: { autoFocus?: boolean; onDone?: () => void; className?: string }) {
  const router = useRouter()
  const startNavigation = useStartNavigation()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Suggestion[]>([])
  const [ms, setMs] = useState<number | null>(null)
  const [selected, setSelected] = useState('')
  const [navigated, setNavigated] = useState(false)
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

  return (
    <div ref={rootRef} className={cn('relative w-full', className)}>
      <Command shouldFilter={false} value={selected} onValueChange={setSelected} loop className="overflow-visible rounded-none! bg-transparent p-0">
        <form
          role="search"
          action="/wiki/Special:Search"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <ButtonGroup className="w-full">
            <InputGroup className="bg-background h-8 rounded-l-xs rounded-r-none border-(--wiki-input-border) has-[[data-slot=input-group-control]:focus-visible]:shadow-[inset_0_0_0_1px_var(--wiki-progressive)] has-[[data-slot=input-group-control]:focus-visible]:ring-0">
              <InputGroupAddon className="text-subtle pl-2.5">
                <SearchIcon className="size-4.5" />
              </InputGroupAddon>
              <CommandPrimitive.Input
                data-slot="input-group-control"
                name="search"
                value={q}
                autoFocus={autoFocus}
                onValueChange={(value) => {
                  setQ(value)
                  setOpen(true)
                  setNavigated(false)
                }}
                onFocus={() => setOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') setNavigated(true)
                  if (event.key === 'Escape') {
                    setOpen(false)
                    onDone?.()
                  }
                  // Enter searches the typed text unless a suggestion was chosen with the arrows.
                  if (event.key === 'Enter' && !navigated) {
                    event.preventDefault()
                    event.stopPropagation()
                    submit()
                  }
                }}
                placeholder="Search Wikipedia"
                aria-label="Search Wikipedia"
                autoComplete="off"
                spellCheck={false}
                className="h-full min-w-0 flex-1 bg-transparent pr-2 pl-1 text-sm outline-none placeholder:text-(--wiki-placeholder)"
              />
            </InputGroup>
            <Button type="submit" variant="outline" className="bg-secondary text-foreground hover:bg-background h-8 rounded-l-none rounded-r-xs border-(--wiki-input-border) px-3 text-sm font-bold">
              Search
            </Button>
          </ButtonGroup>
        </form>

        {showList ? (
          <CommandList data-navigated={navigated} className="border-border-subtle bg-popover absolute top-full right-0 left-0 z-50 max-h-none border shadow-[0_4px_12px_rgba(0,0,0,0.15)] sm:right-auto sm:w-full">
            <CommandEmpty className="hidden" />
            {ms != null ? <SuggestTiming ms={ms} count={items.length} /> : null}
            {items.length > 0 ? (
              <CommandGroup className="p-0">
                {items.map((item) => (
                  <CommandItem
                    key={item.title}
                    value={item.title}
                    onSelect={() => go(wikiHref(item.title))}
                    className="[[data-navigated=true]_&]:data-selected:bg-accent flex-col items-start gap-0 rounded-none px-3 py-2 data-selected:bg-transparent"
                  >
                    <span className="text-foreground text-[0.95rem]">
                      <Highlight title={item.title} query={term} />
                    </span>
                    {item.description ? <span className="text-subtle line-clamp-1 text-xs">{item.description}</span> : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            <CommandItem
              value={FULLTEXT}
              onSelect={() => go(searchHref(term, { fulltext: true }))}
              className="border-divider [[data-navigated=true]_&]:data-selected:bg-accent gap-3 rounded-none border-t px-3 py-2.5 data-selected:bg-transparent"
            >
              <SearchIcon className="text-subtle size-4.5" />
              <span className="min-w-0 text-sm">
                Search for pages containing <strong className="break-all">{term}</strong>
              </span>
            </CommandItem>
          </CommandList>
        ) : null}
      </Command>
    </div>
  )
}
