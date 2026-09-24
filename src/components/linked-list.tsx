'use client'

import { DbTimingBar, addTiming, type Timing } from '@/components/db-timing'
import Link from 'next/link'
import { linkedEntry, splitSeeAlso } from '@/lib/article-links'
import { wikiHref } from '@/lib/links'
import { use } from 'react'

/** The link check's answer: the targets that exist, and what the query cost. */
export type LinkCheck = Timing & { titles: string[] }

/**
 * A "See also" or disambiguation list, once the link check returns. It reads
 * the same promise as every other list and the timing bar, so they all fill in
 * at the same moment instead of one reveal after another.
 */
export function LinkedList({ items, seeAlso, check }: { items: string[]; seeAlso: boolean; check: Promise<LinkCheck> }) {
  const existing = new Set(use(check).titles)
  return (
    <ul>
      {items.map((item, j) => {
        if (seeAlso) {
          // "See also" always links, red when the article is missing, as on Wikipedia.
          const { title: target, rest } = splitSeeAlso(item)
          return (
            <li key={j}>
              <Link href={wikiHref(target)} className={existing.has(target) ? undefined : 'new'} title={existing.has(target) ? target : `${target} (page does not exist)`}>
                {target}
              </Link>
              {rest}
            </li>
          )
        }
        // Disambiguation entries link only when the article exists.
        const entry = linkedEntry(item, existing)
        if (!entry) return <li key={j}>{item}</li>
        return (
          <li key={j}>
            <Link href={wikiHref(entry.target)} title={entry.target}>
              {entry.target}
            </Link>
            {entry.rest}
          </li>
        )
      })}
    </ul>
  )
}

/** The timing bar once the link check is in: the article query plus the link check. */
export function LinkTimingBar({ timing, check }: { timing: Timing; check: Promise<LinkCheck> }) {
  return <DbTimingBar {...addTiming(timing, use(check))} />
}
