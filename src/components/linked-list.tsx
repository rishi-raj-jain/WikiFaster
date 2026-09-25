import { linkedEntry, splitSeeAlso } from '@/lib/article-links'
import { wikiHref } from '@/lib/links'
import Link from 'next/link'

/** A "See also" or disambiguation list, linked by the link check: `existing` holds the targets that exist. */
export function LinkedList({ items, seeAlso, existing }: { items: string[]; seeAlso: boolean; existing: Set<string> }) {
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
