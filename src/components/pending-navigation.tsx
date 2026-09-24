'use client'

import { ArticleShell, MainShell, SearchShell } from '@/components/loading'
import { MAIN_PAGE, SPECIAL_RANDOM, SPECIAL_SEARCH, titleFromSegments } from '@/lib/links'
import { usePathname } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'

const StartContext = createContext<(href: string) => void>(() => {})

/** Shows the pending page for a navigation started in code (`router.push`), as a link click does on its own. */
export function useStartNavigation() {
  return useContext(StartContext)
}

function titleOf(pathname: string): string {
  if (!pathname.startsWith('/wiki/')) return MAIN_PAGE
  try {
    return titleFromSegments(pathname.slice('/wiki/'.length).split('/'))
  } catch {
    return pathname.slice('/wiki/'.length)
  }
}

/** The page being navigated to, drawn the moment the link is clicked: the same shells the server streams first. */
function PendingPage({ pathname }: { pathname: string }) {
  const title = titleOf(pathname)
  if (title === MAIN_PAGE) return <MainShell />
  if (title === SPECIAL_SEARCH) return <SearchShell />
  return <ArticleShell title={title === SPECIAL_RANDOM ? null : title} />
}

/**
 * Makes every navigation visible at once: a click on a link to another page
 * swaps the current page for that page's placeholder until the router commits
 * the server's streamed response. The header stays, and its search box starts
 * navigations through {@link useStartNavigation}. Clicks that stay on the same
 * path (search paging, "Did you mean") are left to their handlers.
 */
export function PendingNavigation({ header, children }: { header: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname()
  const [pending, setPending] = useState<{ from: string; to: string } | null>(null)

  // The router committed the new page: drop the placeholder in the same render.
  if (pending && pending.from !== pathname) setPending(null)

  const start = useCallback(
    (href: string) => {
      const url = new URL(href, window.location.href)
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return
      setPending({ from: pathname, to: url.pathname })
      window.scrollTo(0, 0)
    },
    [pathname],
  )

  // Link clicks that the router took over (it calls preventDefault), in the bubble phase so that has happened.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = (event.target as Element | null)?.closest?.('a[href]')
      if (anchor instanceof HTMLAnchorElement && (!anchor.target || anchor.target === '_self')) start(anchor.href)
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [start])

  return (
    <StartContext value={start}>
      {header}
      <div hidden={pending != null}>{children}</div>
      {pending ? <PendingPage pathname={pending.to} /> : null}
    </StartContext>
  )
}
