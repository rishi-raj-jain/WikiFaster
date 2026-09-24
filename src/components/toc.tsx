'use client'

import { PinnableHeader } from '@/components/pinnable-header'
import { usePrefs } from '@/components/prefs'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { Section } from '@/lib/wikitext'
import { cn } from 'cn'
import { ListIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

const TOP = '(Top)'

/** Tracks the section whose heading was last scrolled past, like Vector's bold active entry. */
function useActiveSection(sections: Section[]): string {
  const [active, setActive] = useState('')
  useEffect(() => {
    const headings = sections.map((section) => document.getElementById(section.id)).filter((el): el is HTMLElement => el != null)
    if (headings.length === 0) return
    const update = () => {
      let current = ''
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top <= 80) current = heading.id
        else break
      }
      setActive(current)
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [sections])
  return active
}

function TocList({ sections, onNavigate }: { sections: Section[]; onNavigate?: () => void }) {
  const active = useActiveSection(sections)
  const entries = [{ id: '', title: TOP }, ...sections]
  return (
    <ul className="mt-1 text-sm">
      {entries.map((section) => (
        <li key={section.id || 'top'}>
          <a
            href={section.id ? `#${section.id}` : '#'}
            onClick={(event) => {
              if (!section.id) {
                event.preventDefault()
                window.scrollTo({ top: 0 })
                history.replaceState(null, '', window.location.pathname + window.location.search)
              }
              onNavigate?.()
            }}
            className={cn('block py-1.5 leading-snug', section.id === active ? 'text-foreground! font-bold' : section.id ? '' : 'text-foreground!')}
          >
            {section.title}
          </a>
        </li>
      ))}
    </ul>
  )
}

/** The pinned Contents column: sticky, scrolling on its own when the list is long. */
export function TocSidebar({ sections }: { sections: Section[] }) {
  const { setPref } = usePrefs()
  return (
    <nav aria-label="Contents" className="sticky top-6 pl-4 text-sm">
      <ScrollArea className="max-h-[calc(100dvh-3rem)] [&>[data-slot=scroll-area-viewport]]:max-h-[inherit]">
        <div className="pr-3">
          <PinnableHeader label="Contents" pinned onToggle={() => setPref('toc', 'hidden')} />
          <TocList sections={sections} />
        </div>
      </ScrollArea>
    </nav>
  )
}

/**
 * The list icon left of the title, shown when Contents is not pinned (and
 * always below 1120px). While the sections stream in (`sections` is null) it
 * holds its place, disabled, so the title does not move when they arrive.
 */
export function TocButton({ sections }: { sections: Section[] | null }) {
  const { prefs, setPref } = usePrefs()
  const [open, setOpen] = useState(false)
  const className = cn('mr-2 size-8 shrink-0 self-center rounded-xs', prefs.toc === 'pinned' && 'min-[1120px]:hidden')
  if (sections === null) {
    return (
      <Button variant="ghost" size="icon" disabled aria-label="Loading the table of contents" className={className}>
        <ListIcon className="size-5" />
      </Button>
    )
  }
  if (sections.length === 0) return null
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="ghost" size="icon" aria-label="Toggle the table of contents" className={className} />}>
        <ListIcon className="size-5" />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="ring-border-subtle w-72 rounded-xs p-0 shadow-[0_4px_12px_rgba(0,0,0,0.15)] ring-1">
        <ScrollArea className="max-h-[70dvh] [&>[data-slot=scroll-area-viewport]]:max-h-[inherit]">
          <div className="px-4 py-3">
            <PinnableHeader label="Contents" pinned={false} onToggle={() => setPref('toc', 'pinned')} />
            <TocList sections={sections} onNavigate={() => setOpen(false)} />
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
