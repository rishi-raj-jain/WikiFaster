/** This app's source code. */
export const SOURCE_URL = 'https://github.com/rishi-raj-jain/WikiFaster'

/** Where the app is served, for canonical links, structured data and the OpenSearch description. */
export const SITE_URL = 'https://wikifaster.vercel.app'

/** WikiFaster's social card (`src/app/og.png`), the `og:image` of every page without a lead image. */
export const OG_IMAGE = { url: '/og.png', width: 1200, height: 630, alt: 'WikiFaster: all of English Wikipedia in Neon Postgres, deployed on Vercel' }

/** Every article's text is CC BY-SA 4.0, as on Wikipedia. */
export const LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/deed.en'

/** `Albert Einstein` -> `Albert_Einstein`, keeping `/`, `:` and `,` readable the way Wikipedia does. */
function slug(title: string): string {
  return encodeURIComponent(title.replace(/ /g, '_')).replace(/%2F/g, '/').replace(/%3A/g, ':').replace(/%2C/g, ',')
}

/** `Albert Einstein` -> `/wiki/Albert_Einstein`. */
export function wikiHref(title: string): string {
  return `/wiki/${slug(title)}`
}

/** An article's social card (`src/app/og/[...title]`), 1200×630 like {@link OG_IMAGE}. */
export function ogImageHref(title: string): string {
  return `/og/${slug(title)}`
}

/** The same article on Wikipedia. */
export function wikipediaUrl(title: string): string {
  return `https://en.wikipedia.org${wikiHref(title)}`
}

/**
 * Percent-decodes a URL segment, or returns it as is when it is not valid
 * encoding. Next.js hands a page its `params` still encoded
 * (`Jon_N%C3%B8rgaard`) but `generateMetadata` decoded (`Jon_Nørgaard`), so
 * this has to accept both.
 */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/** The inverse of {@link wikiHref} for the `[...title]` route segments, encoded or not, in NFC like every stored title. */
export function titleFromSegments(segments: string[]): string {
  return segments.map(decodeSegment).join('/').replace(/_/g, ' ').trim().normalize('NFC')
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
export const IMAGE_WIDTH = 250

/** The public "assets" bucket (set from AWS_ENDPOINT_URL_S3 in next.config.ts), or empty to always use Wikimedia. */
export const ASSETS_URL = process.env.NEXT_PUBLIC_ASSETS_URL ?? ''

/** Wikipedia's file redirect, which finds the file on Commons or on English Wikipedia and sends the browser to its thumbnail. */
function wikimediaSrc(image: ImageRef): string {
  return `https://en.wikipedia.org/w/index.php?title=Special:Redirect/file/${encodeURIComponent(image.file)}&width=${IMAGE_WIDTH}`
}

/**
 * A lead image at 250px, as pages show it: the copy in Neon Object Storage
 * when there is one, through this site's `/assets` route so the CDN keeps it
 * next to the visitor (the bucket is in one region), otherwise Wikimedia's.
 */
export function imageSrc(image: ImageRef): string {
  if (image.stored && ASSETS_URL) return `/assets/${image.stored}/${IMAGE_WIDTH}`
  return wikimediaSrc(image)
}

/** The same image at its source, for the server to fetch and for structured data. */
export function imageSourceUrl(image: ImageRef): string {
  if (image.stored && ASSETS_URL) return `${ASSETS_URL}/${image.stored}/${IMAGE_WIDTH}`
  return wikimediaSrc(image)
}

/** The image's file page on Wikipedia, which credits its author and license. */
export function filePageUrl(image: ImageRef): string {
  return `https://en.wikipedia.org/wiki/File:${encodeURIComponent(image.file)}`
}
