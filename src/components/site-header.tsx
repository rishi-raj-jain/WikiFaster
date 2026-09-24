'use client'

import { AppearancePanel } from '@/components/appearance-panel'
import { GithubMark } from '@/components/logos'
import { usePrefs } from '@/components/prefs'
import { SearchBox } from '@/components/search-box'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { MAIN_PAGE, SOURCE_URL, SPECIAL_RANDOM, searchHref, wikiHref } from '@/lib/links'
import { cn } from 'cn'
import { ArrowLeftIcon, GlassesIcon, MenuIcon, SearchIcon } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

/** The wordmark: small-caps serif "Wikipedia" over the tagline, as in Vector 2022. */
function Logo() {
  return (
    <Link href="/" className="text-emphasized flex shrink-0 flex-col justify-center leading-none no-underline! hover:no-underline" aria-label="Main Page">
      <span className="font-serif text-[1.4rem] leading-none tracking-[0.04em] [font-variant:small-caps]">Wikipedia</span>
      <span className="mt-1 font-serif text-[0.72rem] leading-none tracking-[0.01em]">The Free Encyclopedia</span>
    </Link>
  )
}

/** The hamburger's "Main menu", with Wikipedia's Navigation section. */
function MainMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Main menu" className="hover:bg-accent size-8 shrink-0 rounded-xs" />}>
        <MenuIcon className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={8} className="ring-border-subtle w-56 rounded-xs p-0 py-2 shadow-[0_4px_12px_rgba(0,0,0,0.15)] ring-1">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-emphasized px-4 py-1.5 text-sm font-bold">Main menu</DropdownMenuLabel>
          <DropdownMenuSeparator className="bg-divider mx-4" />
          <DropdownMenuLabel className="text-subtle px-4 pt-2 pb-1 text-sm">Navigation</DropdownMenuLabel>
          <DropdownMenuItem render={<Link href="/" />} className="text-link rounded-none px-4 py-1.5 text-sm">
            {MAIN_PAGE}
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link href={wikiHref(SPECIAL_RANDOM)} />} className="text-link rounded-none px-4 py-1.5 text-sm">
            Random article
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link href={searchHref('', { fulltext: true })} />} className="text-link rounded-none px-4 py-1.5 text-sm">
            Search
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-divider mx-4 my-1" />
          <DropdownMenuItem render={<a href={SOURCE_URL} target="_blank" rel="noreferrer" />} className="text-link gap-2 rounded-none px-4 py-1.5 text-sm">
            <GithubMark className="size-4" /> View source
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Vector 2022's header. From 1120px the search box sits inline; below that it
 * collapses to an icon that expands the box across the header. The glasses
 * button opens Appearance when it is not pinned to the right column.
 */
export function SiteHeader() {
  const [searching, setSearching] = useState(false)
  const { prefs } = usePrefs()

  return (
    <header className="wiki-gutter bg-background mx-auto flex h-[66px] w-full max-w-(--wiki-page-max) items-center gap-4">
      {searching ? (
        <div className="flex w-full items-center gap-2 min-[1120px]:hidden">
          <Button variant="ghost" size="icon" aria-label="Close search" onClick={() => setSearching(false)} className="size-8 shrink-0 rounded-xs">
            <ArrowLeftIcon className="size-5" />
          </Button>
          <SearchBox autoFocus onDone={() => setSearching(false)} />
        </div>
      ) : null}

      <div className={cn('flex min-w-0 flex-1 items-center gap-4', searching && 'max-[1119px]:hidden')}>
        <MainMenu />
        <Logo />
        <SearchBox className="ml-3 hidden max-w-[500px] min-[1120px]:block" />
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Search Wikipedia" onClick={() => setSearching(true)} className="size-8 rounded-xs min-[1120px]:hidden">
            <SearchIcon className="size-5" />
          </Button>
          <Popover>
            <PopoverTrigger render={<Button variant="ghost" size="icon" aria-label="Appearance" className={cn('size-8 rounded-xs', prefs.appearance === 'pinned' && 'min-[1120px]:hidden')} />}>
              <GlassesIcon className="size-5" />
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={8} className="ring-border-subtle w-60 rounded-xs p-4 shadow-[0_4px_12px_rgba(0,0,0,0.15)] ring-1">
              <AppearancePanel pinned={false} />
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </header>
  )
}
