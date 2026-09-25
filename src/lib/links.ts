/** This app's source code. */
export const SOURCE_URL = 'https://github.com/rishi-raj-jain/wiki-faster'

/** Where the app is served, for canonical links and structured data: set NEXT_PUBLIC_SITE_URL, or Vercel's production domain is used. */
export const SITE_URL = 'https://wiki-faster.vercel.app'

/** Every article's text is CC BY-SA 4.0, as on Wikipedia. */
export const LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/deed.en'

/** `Albert Einstein` -> `/wiki/Albert_Einstein`, keeping `/`, `:` and `,` readable the way Wikipedia does. */
export function wikiHref(title: string): string {
  const slug = encodeURIComponent(title.replace(/ /g, '_')).replace(/%2F/g, '/').replace(/%3A/g, ':').replace(/%2C/g, ',')
  return `/wiki/${slug}`
}

/** The inverse of {@link wikiHref} for the `[...title]` route segments. */
export function titleFromSegments(segments: string[]): string {
  return segments
    .map((segment) => decodeURIComponent(segment))
    .join('/')
    .replace(/_/g, ' ')
    .trim()
}

export const MAIN_PAGE = 'Main Page'
export const SPECIAL_RANDOM = 'Special:Random'
export const SPECIAL_SEARCH = 'Special:Search'

/** The search results page. `fulltext` skips the jump to an exactly matching title. */
export function searchHref(query: string, options: { page?: number; fulltext?: boolean } = {}): string {
  const params = new URLSearchParams({ search: query })
  if (options.fulltext) params.set('fulltext', '1')
  if (options.page && options.page > 1) params.set('page', String(options.page))
  return `${wikiHref(SPECIAL_SEARCH)}?${params}`
}

/** Heading text -> fragment id, as MediaWiki builds them (`See also` -> `See_also`). */
export function anchorId(text: string): string {
  return text.trim().replace(/\s+/g, '_')
}

/** An article's lead image: its file name, and the key prefix of its copy in the "assets" bucket once the images function has made one. */
export type ImageRef = { file: string; stored: string | null }

/** The one thumbnail width the site shows and the images function copies, a size Wikimedia renders ahead of time. */
const WIDTH = 250

/** The public "assets" bucket (set from AWS_ENDPOINT_URL_S3 in next.config.ts), or empty to always use Wikimedia. */
const ASSETS_URL = process.env.NEXT_PUBLIC_ASSETS_URL ?? ''

/**
 * A lead image at 250px: the copy in Neon Object Storage when there is one,
 * otherwise Wikipedia's file redirect, which finds the file on Commons or on
 * English Wikipedia and sends the browser to its thumbnail.
 */
export function imageSrc(image: ImageRef): string {
  if (image.stored && ASSETS_URL) return `${ASSETS_URL}/${image.stored}/${WIDTH}`
  return `https://en.wikipedia.org/w/index.php?title=Special:Redirect/file/${encodeURIComponent(image.file)}&width=${WIDTH}`
}

/** The image's file page on Wikipedia, which credits its author and license. */
export function filePageUrl(image: ImageRef): string {
  return `https://en.wikipedia.org/wiki/File:${encodeURIComponent(image.file)}`
}
