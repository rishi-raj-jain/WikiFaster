'use client'

import { useLazyOpen } from '@/components/lazy-open'
import { usePrefs } from '@/components/prefs'
import { SearchField } from '@/components/search-field'
import { Button } from '@/components/ui/button'
import { cn } from 'cn'
import { ArrowLeftIcon, GlassesIcon, MenuIcon, SearchIcon } from 'lucide-react'
import Link from 'next/link'
import { lazy, Suspense, useState } from 'react'

/** The wordmark: small-caps serif "Wikipedia" over the tagline, as in Vector 2022. */
function Logo() {
  return (
    <Link href="/" className="flex shrink-0 flex-col justify-center leading-none text-emphasized no-underline! hover:no-underline" aria-label="Main Page">
      <span className="font-serif text-[1.4rem] leading-none tracking-[0.04em] [font-variant:small-caps]">Wikipedia</span>
      <span className="mt-1 font-serif text-[0.72rem] leading-none tracking-[0.01em]">The Free Encyclopedia</span>
    </Link>
  )
}

const loadMenus = () => import('@/components/header-menus')
const MainMenu = lazy(() => loadMenus().then((m) => ({ default: m.MainMenu })))
const AppearanceMenu = lazy(() => loadMenus().then((m) => ({ default: m.AppearanceMenu })))

/** The hamburger. Its menu's code loads on first use (`useLazyOpen`). */
function MainMenuButton() {
  const [opened, trigger] = useLazyOpen(loadMenus)
  const button = (
    <Button variant="ghost" size="icon" aria-label="Main menu" className="size-8 shrink-0 rounded-xs hover:bg-accent" {...(opened ? {} : trigger)}>
      <MenuIcon className="size-5" />
    </Button>
  )
  if (!opened) return button
  return (
    <Suspense fallback={button}>
      <MainMenu />
    </Suspense>
  )
}

/** The glasses button. Its popover's code loads on first use (`useLazyOpen`). */
function AppearanceButton({ className }: { className: string }) {
  const [opened, trigger] = useLazyOpen(loadMenus)
  const button = (
    <Button variant="ghost" size="icon" aria-label="Appearance" className={className} {...(opened ? {} : trigger)}>
      <GlassesIcon className="size-5" />
    </Button>
  )
  if (!opened) return button
  return (
    <Suspense fallback={button}>
      <AppearanceMenu className={className} />
    </Suspense>
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
    <header className="wiki-gutter mx-auto flex h-[66px] w-full max-w-(--wiki-page-max) items-center gap-4 bg-background">
      {searching ? (
        <div className="flex w-full items-center gap-2 min-[1120px]:hidden">
          <Button variant="ghost" size="icon" aria-label="Close search" onClick={() => setSearching(false)} className="size-8 shrink-0 rounded-xs">
            <ArrowLeftIcon className="size-5" />
          </Button>
          <SearchField autoFocus onDone={() => setSearching(false)} />
        </div>
      ) : null}

      <div className={cn('flex min-w-0 flex-1 items-center gap-4', searching && 'max-[1119px]:hidden')}>
        <MainMenuButton />
        <Logo />
        <SearchField className="ml-3 hidden w-full max-w-[500px] min-[1120px]:block" />
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Search Wikipedia" onClick={() => setSearching(true)} className="size-8 rounded-xs min-[1120px]:hidden">
            <SearchIcon className="size-5" />
          </Button>
          <AppearanceButton className={cn('size-8 rounded-xs', prefs.appearance === 'pinned' && 'min-[1120px]:hidden')} />
        </div>
      </div>
    </header>
  )
}
