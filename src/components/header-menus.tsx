'use client'

import { AppearancePanel } from '@/components/appearance-panel'
import { GithubMark } from '@/components/logos'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { MAIN_PAGE, searchHref, SOURCE_URL, SPECIAL_RANDOM, wikiHref } from '@/lib/links'
import { GlassesIcon, MenuIcon } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

/**
 * The header's menus, loaded on first use (see `useLazyOpen` in the header),
 * so each mounts open.
 */

/** The hamburger's "Main menu", with Wikipedia's Navigation section. */
export function MainMenu() {
  return (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Main menu" className="size-8 shrink-0 rounded-xs hover:bg-accent" />}>
        <MenuIcon className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={8} className="w-56 rounded-xs p-0 py-2 shadow-[0_4px_12px_rgba(0,0,0,0.15)] ring-1 ring-border-subtle">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-4 py-1.5 text-sm font-bold text-emphasized">Main menu</DropdownMenuLabel>
          <DropdownMenuSeparator className="mx-4 bg-divider" />
          <DropdownMenuLabel className="px-4 pt-2 pb-1 text-sm text-subtle">Navigation</DropdownMenuLabel>
          <DropdownMenuItem render={<Link href="/" />} className="rounded-none px-4 py-1.5 text-sm text-link">
            {MAIN_PAGE}
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link href={wikiHref(SPECIAL_RANDOM)} />} className="rounded-none px-4 py-1.5 text-sm text-link">
            Random article
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link href={searchHref('', { fulltext: true })} />} className="rounded-none px-4 py-1.5 text-sm text-link">
            Search
          </DropdownMenuItem>
          <DropdownMenuSeparator className="mx-4 my-1 bg-divider" />
          <DropdownMenuItem render={<a href={SOURCE_URL} target="_blank" rel="noreferrer" />} className="gap-2 rounded-none px-4 py-1.5 text-sm text-link">
            <GithubMark className="size-4" /> View source
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The glasses button's Appearance popover, for when Appearance is not pinned to the right column. */
export function AppearanceMenu({ className }: { className: string }) {
  const [open, setOpen] = useState(true)
  return (
    // Closes when Appearance moves to the sidebar, since that hides this button.
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="ghost" size="icon" aria-label="Appearance" className={className} />}>
        <GlassesIcon className="size-5" />
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-60 rounded-xs p-4 shadow-[0_4px_12px_rgba(0,0,0,0.15)] ring-1 ring-border-subtle">
        <AppearancePanel pinned={false} onMove={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}
