'use client'

import { PinnableHeader } from '@/components/pinnable-header'
import { usePrefs } from '@/components/prefs'
import { TocList } from '@/components/toc'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { Section } from '@/lib/wikitext'
import { ListIcon } from 'lucide-react'
import { useState } from 'react'

/** The Contents popover behind the list icon, loaded on first use (see `TocButton`), so it mounts open. */
export default function TocPopover({ sections, className }: { sections: Section[]; className: string }) {
  const { setPref } = usePrefs()
  const [open, setOpen] = useState(true)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="ghost" size="icon" aria-label="Toggle the table of contents" className={className} />}>
        <ListIcon className="size-5" />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-72 rounded-xs p-0 shadow-[0_4px_12px_rgba(0,0,0,0.15)] ring-1 ring-border-subtle">
        <div className="max-h-[70dvh] [scrollbar-width:thin] overflow-y-auto overscroll-contain">
          <div className="px-4 py-3">
            <PinnableHeader
              label="Contents"
              pinned={false}
              onToggle={() => {
                // Moving Contents to the sidebar hides this button, so the popover closes too.
                setPref('toc', 'pinned')
                setOpen(false)
              }}
            />
            <TocList sections={sections} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
