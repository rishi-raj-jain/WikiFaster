import type { Metadata } from 'next'

/**
 * A page's metadata the way Wikipedia writes its <head>: the full title as
 * both <title> and og:title, og:type website, a canonical URL, no meta
 * description, and `max-image-preview:standard` for crawlers. Search pages
 * and missing articles are `noindex,nofollow`.
 */
export function pageMetadata(fullTitle: string, { canonical, index = true, description }: { canonical?: string; index?: boolean; description?: string } = {}): Metadata {
  return {
    title: { absolute: fullTitle },
    description,
    openGraph: { title: fullTitle, type: 'website', description },
    robots: { index, follow: index, 'max-image-preview': 'standard' },
    alternates: canonical ? { canonical } : undefined,
  }
}

/** The Main Page, served at both `/` and `/wiki/Main_Page`, with `/wiki/Main_Page` as the canonical URL (Wikipedia redirects `/` there). */
export const MAIN_PAGE_METADATA = pageMetadata('Wikipedia, the free encyclopedia', {
  canonical: '/wiki/Main_Page',
  description: 'All of English Wikipedia, served live from Neon Postgres with BM25 search.',
})

/** JSON-LD as a script tag, with `<` escaped so article text cannot close it early. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />
}
