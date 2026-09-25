import type { Block } from '@/lib/wikitext'

/**
 * Which lines of an article link to other articles. Shared by the server,
 * which looks the targets up, and the browser, which draws the links once the
 * lookup returns.
 */
export const SEE_ALSO = /^see also$/i

/** "Anarchy Archives – an online research center" -> link text and the trailing description. */
export function splitSeeAlso(item: string): { title: string; rest: string } {
  const match = item.match(/^(.+?)(\s+[–—-]\s+.*)$/)
  return match ? { title: match[1].trim(), rest: match[2] } : { title: item, rest: '' }
}

/**
 * Titles an entry may link to, most specific first: the text before the first
 * comma ("Able Seaman (occupation)"), the same without a trailing
 * parenthetical ("Air Berlin (IATA airline code AB)" -> "Air Berlin"), and
 * the text before a dash.
 */
function entryTitles(item: string): string[] {
  const beforeComma = item.split(/,\s/)[0].trim()
  const bare = beforeComma.replace(/\s*\([^)]*\)$/, '').trim()
  const beforeDash = item.split(/\s+[–—-]\s+/)[0].trim()
  return [...new Set([beforeComma, bare, beforeDash])].filter((title) => title.length > 0 && title.length <= 200)
}

/** The existing article an entry starts with, if any, and the rest of the line. */
export function linkedEntry(item: string, links: Set<string>): { target: string; rest: string } | null {
  const target = entryTitles(item).find((title) => links.has(title) && item.startsWith(title))
  return target ? { target, rest: item.slice(target.length) } : null
}

/**
 * Every title the page may link to, looked up in one query: "See also" targets
 * (blue when they exist, red when not) and, on disambiguation pages, the
 * candidate titles of every entry.
 */
export function linkTitles(blocks: Block[], disambiguation: boolean): string[] {
  const titles: string[] = []
  let section = ''
  for (const block of blocks) {
    if (block.kind === 'heading') section = block.text
    else if (block.kind === 'list' && SEE_ALSO.test(section)) titles.push(...block.items.map((item) => splitSeeAlso(item).title))
    else if (block.kind === 'list' && disambiguation) titles.push(...block.items.flatMap(entryTitles))
  }
  return [...new Set(titles)]
}
