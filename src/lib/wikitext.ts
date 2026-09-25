import { anchorId } from '@/lib/links'

/**
 * The dump stores each article as plain text: one paragraph per line, blank
 * lines between most of them, list items indented by a space, section headings
 * on their own short line (usually with a trailing space), and the article's
 * categories as the final run of lines. Markup, tables, infoboxes and
 * references were stripped upstream, and heading levels were not kept, so every
 * heading is rendered as a section heading.
 */
export type Block = { kind: 'paragraph'; text: string } | { kind: 'list'; items: string[] } | { kind: 'heading'; text: string; id: string }

export type Section = { id: string; title: string }

export type ParsedArticle = {
  /** Paragraphs and lists before the first heading. */
  blocks: Block[]
  sections: Section[]
  categories: string[]
}

const TERMINAL = /[.!?:;,"”'’)\]]$/
/** Short empty sections the dump keeps a heading for, never categories. */
const SECTION_NAMES = /^(references|notes|citations|footnotes|sources|bibliography|see also|external links|further reading|works cited|explanatory notes)$/i

/**
 * The dump dropped pronunciations and foreign-language names but kept their
 * brackets and separators: "Albert Einstein ( ; ; 14 March 1879 …)",
 * "The Paris Commune (, ) was". Remove what is left of them for display.
 */
function tidy(text: string): string {
  return text
    .replace(/\s*\(\s*(?:[;,:]\s*)*\)/g, '')
    .replace(/\(\s*(?:[;,]\s*)+/g, '(')
    .replace(/\s+([,;.])/g, '$1')
    .replace(/ {2,}/g, ' ')
}

function isBlank(line: string | undefined): boolean {
  return line === undefined || line.trim() === ''
}

function looksLikeTitle(text: string, maxLength: number): boolean {
  return text.length > 0 && text.length <= maxLength && !TERMINAL.test(text) && /^[\p{Lu}\p{N}"'(]/u.test(text)
}

/**
 * Headings are short, unpunctuated lines: marked by a trailing space, or
 * standing alone after a blank line and before a blank line or a list.
 */
function isHeading(lines: string[], i: number): boolean {
  const line = lines[i]
  if (line.startsWith(' ')) return false
  const text = line.trim()
  if (line.endsWith(' ')) return looksLikeTitle(text, 90) && text.split(/\s+/).length <= 12 && !/;|\((?:born |c?\.?\s?\d{4})/.test(text)
  const next = lines[i + 1]
  return isBlank(lines[i - 1]) && (isBlank(next) || next.startsWith(' ')) && looksLikeTitle(text, 80) && text.split(/\s+/).length <= 10
}

/** The trailing run of bare lines after the last blank line: `Anti-capitalism`, `Libertarianism`, … */
function splitCategories(lines: string[]): { body: string[]; categories: string[] } {
  let start = lines.length
  while (start > 0 && !isBlank(lines[start - 1])) start--
  const run = lines.slice(start).map((line) => line.trim())
  const plausible = run.length > 0 && start > 0 && run.every((line) => !lines[start].startsWith(' ') && looksLikeTitle(line, 120))
  if (!plausible || (run.length === 1 && SECTION_NAMES.test(run[0]))) return { body: lines, categories: [] }
  return { body: lines.slice(0, start), categories: run }
}

export function parseArticle(text: string): ParsedArticle {
  const { body, categories } = splitCategories(text.replace(/\r/g, '').split('\n'))
  const blocks: Block[] = []
  const sections: Section[] = []
  const used = new Map<string, number>()

  for (let i = 0; i < body.length; i++) {
    const line = body[i]
    if (isBlank(line)) continue

    // The first line is always the lead sentence, even when it is short.
    if (blocks.length > 0 && isHeading(body, i)) {
      const title = line.trim()
      const base = anchorId(title)
      const seen = used.get(base) ?? 0
      used.set(base, seen + 1)
      const id = seen ? `${base}_${seen + 1}` : base
      blocks.push({ kind: 'heading', text: title, id })
      sections.push({ id, title })
      continue
    }

    if (line.startsWith(' ')) {
      const last = blocks.at(-1)
      if (last?.kind === 'list' && !isBlank(body[i - 1])) last.items.push(tidy(line.trim()))
      else blocks.push({ kind: 'list', items: [tidy(line.trim())] })
      continue
    }

    blocks.push({ kind: 'paragraph', text: tidy(line.trim()) })
  }

  return { blocks, sections, categories }
}

/** The lead, cut at a paragraph boundary near `maxChars`: for the Main Page and previews. */
export function leadParagraphs(text: string, maxChars: number): string[] {
  const out: string[] = []
  let length = 0
  for (const block of parseArticle(text).blocks) {
    if (block.kind === 'heading') break
    if (block.kind !== 'paragraph') continue
    if (out.length > 0 && length + block.text.length > maxChars) break
    out.push(block.text)
    length += block.text.length
  }
  return out
}

/** The first sentence of the lead, for search suggestions and "Did you know". */
export function firstSentence(text: string, maxChars = 240): string {
  const lead = leadParagraphs(text, maxChars)[0] ?? ''
  // A period after an initial or a common abbreviation ("K. Sankaran Nair", "St. Louis") does not end the sentence.
  const match = lead.match(/^.+?(?<!\b(?:\p{L}|Mr|Mrs|Ms|Dr|St|Jr|Sr|Inc|Ltd|Co|No|vs|Mt|Ft))[.!?](?=\s+[\p{Lu}"“(]|$)/u)
  const sentence = (match?.[0] ?? lead).trim()
  return sentence.length > maxChars ? `${sentence.slice(0, maxChars - 1).trimEnd()}…` : sentence
}

/** Items of the lists under the named section (and any matching sections right after it), e.g. the "Events" of a date article. */
export function sectionItems(text: string, heading: RegExp): string[] {
  const items: string[] = []
  let inside = false
  for (const block of parseArticle(text).blocks) {
    if (block.kind === 'heading') {
      // Consecutive matching sections ("Saints", "Pre-Schism Western saints") count as one.
      const matches = heading.test(block.text)
      if (inside && !matches && items.length > 0) break
      inside = matches
    } else if (inside && block.kind === 'list') {
      items.push(...block.items)
    }
  }
  return items
}
